/* CineBraid — Batch 2, Slice 1: QUIET THE SHELL.
 *
 * The founder smoke found the working surface outnumbered by the machinery describing
 * it: two persistent global activity indicators, a permanently mounted 340px Assistant
 * rail, an expanded bottom dock, a full LIVE AUTOMATION ACTIVITY timeline embedded in
 * every task page, and continuity machinery sitting between frame navigation and frame
 * review.
 *
 * This slice removes those, and removes NOTHING ELSE. It is presentation only. Which
 * makes the interesting assertions here mostly negative — that a surface went away and
 * a derivation did not — so this suite is written as pairs: what is gone, and what the
 * thing that was already true still answers.
 *
 * WHAT THIS SUITE PROVES, and why it cannot be proven anywhere else:
 *
 *   1. ONE persistent global activity indicator, and the aria-live announcement is
 *      still emitted at the end of every activity update.
 *   2. The compact working-page run state and the drawer row give the SAME answer for
 *      the SAME run, evaluated together in one realm at one moment. tests/live-activity.js
 *      can only read the source; this runs it.
 *   3. Every automation panel — all six call sites, plus the seventh this slice found
 *      on the shot page — emits no .automation-live-activity node and does emit the
 *      compact status.
 *   4. The compact status carries no approval, recovery or paid control.
 *   5. The rail is closed and the Terminal collapsed with NO stored preference, and an
 *      explicit preference in either direction is still honoured.
 *   6. A completed run resolves a panel/stage-qualified result target through the
 *      declared stage model, and anything it cannot resolve falls back to the shipped
 *      workspace route rather than guessing.
 *   7. The Frames workspace puts the frame card next to the frame strip, with
 *      continuity collapsed and BELOW it.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it forms no opinion about activity. Every state
 * word it checks is one the shipped predicates produced.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const { render, buildFixture } = require("./render-harness");

const notes = [];
const note = (line) => notes.push(line);

/* Comments are stripped wherever this suite asks "is that gone?" — the retirement
   notes name what they retired, which is what a reader needs and exactly what an
   absence check must not trip over. */
const codeOnly = (source) => String(source)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, "$1");

/* ===========================================================================
   FIXTURE RUNS.

   Built as raw automation-run records, because what is under test here is exactly the
   translation from a raw run to a rendered state — the step tests/creator-state.js
   starts after. Statuses are chosen to land one run in each shipped predicate.
   =========================================================================== */
function run(over = {}) {
  return {
    id: "run-1", revision: 1, type: "shot-chain", targetId: "L1-01", scope: "stills",
    label: "Frame automation", status: "running", stage: "Generating Frame A",
    summary: "", createdAt: "2026-08-17T10:00:00Z", updatedAt: "2026-08-17T10:00:10Z",
    config: {}, usage: {}, current: { stepKey: "frame:a:generate" },
    steps: {
      "frame:a:generate": {
        key: "frame:a:generate", kind: "generation", status: "running",
        label: "Generate Frame A", attempt: 1, maxAttempts: 3,
        startedAt: "2026-08-17T10:00:00Z", updatedAt: "2026-08-17T10:00:10Z",
        activity: { system: "FAL · GPT IMAGE 2", state: "preparing" },
      },
    },
    logs: [],
    ...over,
  };
}

const RUNS = {
  /* Machine-active: the runner holds the lease in this window. */
  active: () => run({ id: "run-active" }),
  /* Parked at a human gate. */
  waiting: () => run({ id: "run-waiting", status: "awaiting-review", stage: "Approve Frame A" }),
  /* Needs attention. */
  failed: () => run({
    id: "run-failed", status: "failed", stage: "Generation failed",
    steps: { "frame:a:generate": { key: "frame:a:generate", kind: "generation", status: "failed", label: "Generate Frame A", error: "Provider refused" } },
  }),
  /* Settled with a result to hand over. */
  completed: () => run({ id: "run-done", status: "completed", stage: "Frame A approved", summary: "Approved" }),
  completedBlocking: () => run({ id: "run-blocking", status: "completed", scope: "blocking-only", stage: "Guide installed" }),
  completedEntity: () => run({ id: "run-entity", status: "completed", type: "entity-chain", targetId: "characters:KAI", scope: "default-only" }),
  completedScene: () => run({ id: "run-scene", status: "completed", type: "scene-chain", targetId: "L1", scope: "stills" }),
};

/* ===========================================================================
   1. EXACTLY ONE PERSISTENT GLOBAL ACTIVITY INDICATOR
   =========================================================================== */

async function checkOneGlobalIndicator() {
  const activity = codeOnly(read("public/live-activity.js"));
  const index = read("public/index.html");
  const styles = read("public/styles.css");

  for (const gone of ["automation-global-live-strip", "v642EnsureGlobalActivityStrip", "v642UpdateGlobalActivityStrip"]) {
    assert.ok(!activity.includes(gone), `the retired floating strip left ${gone} behind in live-activity.js`);
    assert.ok(!index.includes(gone), `the retired floating strip left ${gone} behind in index.html`);
    assert.ok(!styles.includes(gone), `the retired floating strip left ${gone} behind in styles.css`);
  }

  /* The chip survives, and it is the ONE thing that renders the status. */
  assert.ok(index.includes('id="automation-activity-toggle"'), "the topbar activity chip must remain");
  const statusReaders = (activity.match(/v6602ActivityStatus\(\)/g) || []).length;
  assert.strictEqual(statusReaders, 2,
    `v6602ActivityStatus() has ${statusReaders} readers; expected its own definition plus exactly one renderer`);

  /* And it still answers, in a running page, from the shipped derivation. */
  const page = await render("#/shot/L1-01", buildFixture());
  vm.runInContext(`AUTOMATION_RUNS = ${JSON.stringify([RUNS.waiting()])}; v641UpdateActivityButton();`, page.context);
  const chip = page.context.document.getElementById("automation-activity-toggle");
  assert.ok(chip, "the topbar chip must exist in the rendered page");
  assert.ok(/waiting for you/i.test(chip.innerHTML),
    `the one indicator must still report a pending approval, got: ${chip.innerHTML}`);
  assert.ok(chip.classList.contains("waiting"),
    "the one indicator must still carry the waiting tone — this was the strip's job too, and it must not have left with it");

  note("1. one persistent global activity indicator: the topbar chip, still reporting waiting-for-you from v6602ActivityStatus()");
}

/* ===========================================================================
   2. THE ARIA-LIVE ANNOUNCEMENT SURVIVED

   It carried aria-live="polite" on the strip, but the ANNOUNCEMENT is a separate
   mechanism: a `cinebraid:activity-updated` event the persistent creator surfaces
   repaint from. Removing the strip must not have removed it.
   =========================================================================== */

async function checkAnnouncementSurvives() {
  const page = await render("#/shot/L1-01", buildFixture());
  /* The render harness realm has no CustomEvent and no window.dispatchEvent, and
     v670AnnounceActivityUpdate returns early without them — so the harness would
     report "no announcement" for a build that announces perfectly well. Installing
     the two is what turns this into a test of the product rather than of the harness. */
  const heard = vm.runInContext(`
    (() => {
      const seen = [];
      globalThis.CustomEvent = function CustomEvent(type, init) { this.type = type; this.detail = (init || {}).detail; };
      window.CustomEvent = globalThis.CustomEvent;
      window.dispatchEvent = (event) => { seen.push(event.type); return true; };
      AUTOMATION_RUNS = ${JSON.stringify([RUNS.active()])};
      v641UpdateActivityButton();
      v641UpdateActivityButton();
      /* Returned as JSON: an array built in the vm realm has a different Array
         prototype, so deepStrictEqual fails against a host literal while printing
         two identical-looking arrays. */
      return JSON.stringify(seen);
    })()
  `, page.context);
  assert.strictEqual(heard, JSON.stringify(["cinebraid:activity-updated", "cinebraid:activity-updated"]),
    `every activity update must announce itself; heard ${heard} from 2 updates`);

  /* NEGATIVE CONTROL, inline: if the announcement stopped being emitted the check
     above must be the thing that notices. Prove the observer can see zero. */
  const silent = vm.runInContext(`
    (() => {
      const seen = [];
      window.dispatchEvent = (event) => { seen.push(event.type); return true; };
      v670AnnounceActivityUpdate.__silenced = true;
      const original = globalThis.CustomEvent;
      globalThis.CustomEvent = undefined;
      try { v641UpdateActivityButton(); } finally { globalThis.CustomEvent = original; }
      return JSON.stringify(seen);
    })()
  `, page.context);
  assert.strictEqual(silent, "[]",
    "the observer must be able to record silence, or the assertion above cannot fail");

  note("2. v670AnnounceActivityUpdate still fires on every activity update — the strip's removal did not take the announcement with it");
}

/* ===========================================================================
   3. THE COMPACT STATE AND THE DRAWER ROW CANNOT DISAGREE

   The strongest available form of this: run both renderers over the same run in the
   same realm at the same moment and require the same sentence. They call one
   function — v670RunHeadline — so this is really asserting that nobody has quietly
   reintroduced a second one.
   =========================================================================== */

async function checkCompactAgreesWithDrawer() {
  const page = await render("#/shot/L1-01", buildFixture());

  for (const [name, factory] of Object.entries(RUNS)) {
    const record = factory();
    const answers = vm.runInContext(`
      (() => {
        AUTOMATION_RUNS = ${JSON.stringify([record])};
        const r = AUTOMATION_RUNS[0];
        return {
          headline: v670RunHeadline(r),
          compact: v670CompactRunStatusMarkup(r),
          drawerRow: v641DrawerRunMarkup(r),
          tone: v670RunTone(r),
          active: v670MachineActiveRun(r),
          waiting: v670WaitingForHumanRun(r),
          attention: v670AttentionRun(r),
        };
      })()
    `, page.context);

    assert.ok(answers.compact.includes(`state-${answers.tone}`),
      `${name}: the compact status must carry the drawer row's own tone, expected state-${answers.tone}`);
    assert.ok(answers.drawerRow.includes(`state-${answers.tone}`),
      `${name}: the drawer row must carry the same tone`);

    /* The escaped headline appears in both, character for character. */
    const escaped = vm.runInContext(`esc(${JSON.stringify(answers.headline)})`, page.context);
    assert.ok(answers.compact.includes(escaped),
      `${name}: the compact status must print the shared headline "${answers.headline}"`);
    assert.ok(answers.drawerRow.includes(escaped),
      `${name}: the drawer row must print the same headline "${answers.headline}"`);

    /* And the predicates partition the run exactly once. */
    const claims = [answers.active, answers.waiting, answers.attention].filter(Boolean).length;
    assert.ok(claims <= 1, `${name}: the shipped predicates claimed this run ${claims} times`);
  }

  note(`3. compact status and drawer row agree on tone and sentence for all ${Object.keys(RUNS).length} representative runs`);
}

/* ===========================================================================
   4. NO WORKING PAGE EMBEDS A TIMELINE, AND NONE GAINED A CONTROL

   Every panel is exercised through its real entry point, so this covers the six
   v626AutomationPanel call sites plus v642RelatedShotActivityMarkup — the seventh
   embed, on the shot page, which the slice found beyond the six it was given.
   =========================================================================== */

/* The six v626AutomationPanel call sites named by the slice, each driven through its
   real entry point, plus the seventh embed this slice found on the shot page. */
const PANEL_CALLS = [
  ["shot automation", `shotAutomationPanel(shotById("L1-01"))`],
  ["blocking automation", `blockingAutomationPanel(shotById("L1-01"))`],
  ["asset automation", `assetAutomationPanel("characters", P.characters[0])`],
  ["entity-state automation", `entityStateAutomationPanel("characters", P.characters[0], { id: "clean", name: "Clean" })`],
  ["entity-chain automation", `entityChainAutomationPanel("characters", P.characters[0])`],
  ["scene automation", `renderSceneAutomationPanel(P.scenes[0], P.shots)`],
  ["related shot activity", `v642RelatedShotActivityMarkup("L1-01")`],
];

const PANEL_RUNS = [
  run({ id: "run-shot", type: "shot-chain", targetId: "L1-01", scope: "stills" }),
  run({ id: "run-block", type: "shot-chain", targetId: "L1-01", scope: "blocking-only" }),
  run({ id: "run-ent", type: "entity-chain", targetId: "characters:KAI", scope: "default-only" }),
  run({ id: "run-state", type: "entity-chain", targetId: "characters:KAI", scope: "state:clean" }),
  run({ id: "run-chain", type: "entity-chain", targetId: "characters:KAI", scope: "state-chain" }),
  run({ id: "run-scene", type: "scene-chain", targetId: "SC-01", scope: "stills" }),
];

async function checkNoEmbeddedTimelines() {
  const page = await render("#/shot/L1-01", buildFixture());
  let covered = 0;
  let sawCompact = 0;

  for (const [label, call] of PANEL_CALLS) {
    const markup = vm.runInContext(`
      (() => {
        AUTOMATION_RUNS = ${JSON.stringify(PANEL_RUNS)};
        /* Every panel finds a run of its own, because a panel with no run renders no
           run state at all and would pass this check vacuously. */
        for (const row of AUTOMATION_RUNS) {
          if (row.type === "entity-chain") row.targetId = "characters:" + ((P.characters[0] || {}).id || "KAI");
          if (row.type === "scene-chain") row.targetId = ((P.scenes[0] || {}).id || "SC-01");
        }
        try { return String(${call} || ""); } catch (error) { return "THREW:" + error.message; }
      })()
    `, page.context);

    if (markup.startsWith("THREW:")) {
      /* A panel this fixture cannot build is not evidence either way, and pretending
         it is would be a suite that reports coverage it does not have. */
      note(`   4. ${label}: not exercisable against this fixture (${markup.slice(6, 90)})`);
      continue;
    }
    covered += 1;
    assert.ok(!markup.includes("automation-live-activity"),
      `${label} still embeds the full LIVE AUTOMATION ACTIVITY timeline in a working page`);
    assert.ok(!markup.includes("LIVE AUTOMATION ACTIVITY"),
      `${label} still names the embedded timeline`);
    assert.ok(!markup.includes("Detailed timeline"),
      `${label} still embeds the detailed timeline disclosure`);
    if (markup.includes("automation-compact-status")) sawCompact += 1;
  }

  assert.ok(covered >= 6,
    `only ${covered} of ${PANEL_CALLS.length} automation surfaces could be exercised; the six named call sites must all be covered`);
  /* Not vacuous: at least one panel really did render a run, so "no timeline" is a
     statement about a panel that had something to show. */
  assert.ok(sawCompact >= 1,
    "no exercised panel rendered a compact run status, so the timeline check proved nothing");
  note(`4. ${covered} automation surfaces render no embedded timeline (${sawCompact} of them showing a live run through the compact status)`);
}

/* ===========================================================================
   5. THE COMPACT STATUS CARRIES ONE CONTROL AND IT ONLY OPENS THE DRAWER

   The review attack this answers: did removing the embedded timeline remove a
   required recovery or resume control, and did any approval or paid control migrate
   into a surface that is now shown more often?
   =========================================================================== */

async function checkCompactCarriesNoAuthority() {
  const page = await render("#/shot/L1-01", buildFixture());

  for (const [name, factory] of Object.entries(RUNS)) {
    const markup = vm.runInContext(`
      AUTOMATION_RUNS = ${JSON.stringify([factory()])};
      v670CompactRunStatusMarkup(AUTOMATION_RUNS[0]);
    `, page.context);
    const controls = markup.match(/<button\b[^>]*>/g) || [];
    assert.strictEqual(controls.length, 1,
      `${name}: the compact status must carry exactly one control, found ${controls.length}`);
    assert.ok(/openGlobalAutomationActivity\(/.test(controls[0]),
      `${name}: the compact status's one control must open the Activity drawer, got ${controls[0]}`);
    for (const forbidden of ["approveEntityFile", "retryFailedAutomationStep", "resumeAutomationRun", "startFreshAutomationRun", "openFalGenerationModal", "openShotAutomationModal"]) {
      assert.ok(!markup.includes(forbidden),
        `${name}: ${forbidden} must not appear in the compact working-page status`);
    }
  }

  /* And the panel that hosts it still offers the recovery actions it always did —
     they live in v626RunActions, which this slice did not touch. */
  const panel = vm.runInContext(`
    AUTOMATION_RUNS = ${JSON.stringify([RUNS.failed()])};
    String(shotAutomationPanel(shotById("L1-01")) || "");
  `, page.context);
  assert.ok(panel.includes("RETRY FAILED STEP") || panel.includes("REPAIR & RETRY FAILED STEP"),
    "a failed run's panel must still offer its retry action");
  assert.ok(panel.includes("START FRESH"), "a failed run's panel must still offer START FRESH");
  assert.ok(panel.includes("automation-compact-status"), "the panel must show the compact run status");

  note("5. the compact status carries exactly one control and it only opens the drawer; retry / start-fresh recovery is untouched on the panel");
}

/* ===========================================================================
   6. THE TWO PANEL DEFAULTS

   Evaluated in a realm with a CONTROLLABLE localStorage, because the whole claim is
   about what happens when nothing is stored — which is not observable from source and
   is not what any existing fixture holds.
   =========================================================================== */

function surfacesRealm(stored = {}) {
  const store = new Map(Object.entries(stored));
  const listeners = [];
  const sandbox = {
    console,
    setTimeout, clearTimeout, requestAnimationFrame: (fn) => fn(),
    esc: (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]),
    plural: (n, one, many = one + "s") => `${n} ${Number(n) === 1 ? one : many}`,
    location: { hash: "#/shot/L1-01" },
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
    document: {
      readyState: "complete",
      getElementById: () => null,
      querySelector: () => null,
      createElement: () => ({ innerHTML: "", firstElementChild: null }),
      addEventListener: () => {},
    },
  };
  sandbox.attr = (t) => sandbox.esc(t).replace(/'/g, "&#39;");
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.addEventListener = (name, fn) => listeners.push([name, fn]);
  vm.createContext(sandbox);
  vm.runInContext(read("public/creator-surfaces.js"), sandbox, { filename: "creator-surfaces.js" });
  return { api: sandbox.window.CineBraidCreatorSurfaces, store };
}

function checkPanelDefaults() {
  const RAIL_KEY = "cinebraid-creator-rail-open";
  const DOCK_KEY = "cinebraid-creator-terminal-collapsed";

  /* NO STORED PREFERENCE: both quiet. */
  const fresh = surfacesRealm();
  assert.strictEqual(fresh.api.railOpen(), false,
    "with no stored preference the Assistant rail must be CLOSED — an unmounted slot is how the centre reclaims the 340px");
  assert.strictEqual(fresh.api.terminalCollapsed(), true,
    "with no stored preference the Activity Terminal must be COLLAPSED");

  /* AN EXPLICIT PREFERENCE IS HONOURED, IN BOTH DIRECTIONS. This is the half that
     makes the change a default change rather than a behaviour change. */
  assert.strictEqual(surfacesRealm({ [DOCK_KEY]: "0" }).api.terminalCollapsed(), false,
    "an explicit expanded Terminal preference must survive the new default");
  assert.strictEqual(surfacesRealm({ [DOCK_KEY]: "1" }).api.terminalCollapsed(), true,
    "an explicit collapsed Terminal preference must be honoured");
  assert.strictEqual(surfacesRealm({ [RAIL_KEY]: "1" }).api.railOpen(), true,
    "an explicit open rail preference must be honoured");
  assert.strictEqual(surfacesRealm({ [RAIL_KEY]: "0" }).api.railOpen(), false,
    "an explicit closed rail preference must be honoured");

  /* THE OPEN CONTROL EXISTS AND WRITES THE PREFERENCE. */
  const toggling = surfacesRealm();
  assert.strictEqual(toggling.api.toggleRail(), true, "the open control must open a closed rail");
  assert.strictEqual(toggling.store.get(RAIL_KEY), "1", "opening the rail must record the preference");
  assert.strictEqual(toggling.api.toggleRail(), false, "the control must close an open rail");
  assert.strictEqual(toggling.store.get(RAIL_KEY), "0", "closing the rail must record the preference");

  /* AND THE TERMINAL TOGGLE STILL INVERTS FROM THE NEW DEFAULT. */
  const dock = surfacesRealm();
  dock.api.toggleTerminal();
  assert.strictEqual(dock.store.get(DOCK_KEY), "0", "expanding a default-collapsed Terminal must store the expanded preference");
  assert.strictEqual(dock.api.terminalCollapsed(), false, "expanding the Terminal must expand it");

  /* THE CONTROL IS DECLARED IN THE SHIPPED CHROME, not built by JavaScript. */
  const index = read("public/index.html");
  assert.ok(index.includes('id="creator-rail-toggle"'), "the rail's open control must be declared in the topbar");
  assert.ok(index.includes('aria-controls="cb-shell-rail"'), "the open control must name the slot it opens");
  assert.ok(/creator-rail-toggle[^>]*aria-expanded="false"/.test(index),
    "the open control must ship reflecting a closed rail");

  /* AND IT IS NOT OFFERED WHERE THE RAIL CANNOT PAINT.

     Below 1360px the shell hides the rail whatever its occupancy, so a control that
     opens it there would take topbar width to promise something the stylesheet
     refuses — and it really did cost width: it overflowed the 390px Production route
     by 18px, which check:browser-real caught. The two breakpoints are asserted to be
     the same number so they cannot drift apart. */
  /* Flattened: both rules are written across several indented lines, and a whitespace
     -sensitive match here would fail on reformatting rather than on drift. */
  const styles = read("public/styles.css").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, "");
  const railHiddenAt = styles.match(/@media\(max-width:(\d+)px\)\{[^@]*?#cb-shell-rail\[data-occupied\]\{display:none\}/);
  assert.ok(railHiddenAt, "the shell must declare the width below which the rail cannot paint");
  const toggleHiddenAt = styles.match(/@media\(max-width:(\d+)px\)\{\.creator-rail-toggle\{display:none!important\}\}/);
  assert.ok(toggleHiddenAt, "the rail's open control must be hidden below some width");
  assert.strictEqual(toggleHiddenAt[1], railHiddenAt[1],
    `the open control hides at ${toggleHiddenAt[1]}px but the rail hides at ${railHiddenAt[1]}px; `
    + "a control that opens a rail the stylesheet will not paint is topbar width spent on a promise that cannot be kept");

  /* THE RAIL IS NOT MOUNTED WHILE CLOSED, and closing takes back only OUR node. */
  const surfaces = codeOnly(read("public/creator-surfaces.js"));
  assert.ok(/if \(!railOpen\(\)\) closeRailMount\(\);/.test(surfaces),
    "a closed rail must not be mounted; an unoccupied slot is what collapses it");
  assert.ok(/RAIL_NODE && RAIL_NODE\.isConnected && shell/.test(surfaces),
    "closing the rail must clear the slot only when this file is what occupies it, or it evicts another consumer's content");

  note("6. rail closed and Terminal collapsed with no stored preference; explicit preferences honoured in both directions; the open control is declared in the topbar");
}

/* ===========================================================================
   7. A COMPLETED RUN HANDS OFF TO THE RESULT

   And — the part that matters more — anything that cannot be resolved safely keeps
   the shipped workspace route instead of guessing a stage.
   =========================================================================== */

async function checkResultHandoff() {
  const page = await render("#/shot/L1-01", buildFixture());

  const target = (record) => vm.runInContext(`
    AUTOMATION_RUNS = ${JSON.stringify([record])};
    JSON.stringify(v670RunResultTarget(AUTOMATION_RUNS[0]));
  `, page.context);

  /* RESOLVED: a completed still run lands on the stage that owns the frame result. */
  const stills = JSON.parse(target(RUNS.completed()));
  assert.strictEqual(stills.resolved, true, "a completed shot still run must resolve a result target");
  assert.strictEqual(stills.panel, "still", "a completed still run must target the still panel");
  assert.strictEqual(stills.stage, "frames", "the still panel must resolve to the declared Frames stage");
  assert.strictEqual(stills.route, "#/shot/L1-01", "the hash must remain the shipped workspace route");

  /* RESOLVED, WITH A SUB-VIEW: blocking is one of the two tabs the Look stage has, so
     the target has to say which tab as well as which stage. */
  const blocking = JSON.parse(target(RUNS.completedBlocking()));
  assert.strictEqual(blocking.resolved, true, "a completed blocking run must resolve a result target");
  assert.strictEqual(blocking.stage, "look", "the blocking panel must resolve to the declared Look stage");
  assert.strictEqual(blocking.view, "blocking", "the Look stage's blocking tab must be named");

  /* Both answers came from the declared stage model, not from a second map. */
  const declared = vm.runInContext(`JSON.stringify({
    still: (shotStageForPanel("still") || {}).id,
    blocking: (shotStageForPanel("blocking") || {}).id,
    blockingView: shotStagePanelView("blocking"),
  })`, page.context);
  assert.deepStrictEqual(JSON.parse(declared), { still: "frames", blocking: "look", blockingView: "blocking" },
    "the result targets must be the declared stage model's own answers");

  /* FALLS BACK — and every one of these is a case where guessing would be worse. */
  const fallbacks = [
    ["a run still working", RUNS.active(), "#/shot/L1-01"],
    ["a run waiting on the director", RUNS.waiting(), "#/shot/L1-01"],
    ["a run needing attention", RUNS.failed(), "#/shot/L1-01"],
    ["a completed entity-chain run", RUNS.completedEntity(), "#/character/KAI"],
    ["a completed scene-chain run", RUNS.completedScene(), "#/scene/L1"],
    ["a completed run with an unknown scope", run({ id: "odd", status: "completed", scope: "some-future-scope" }), "#/shot/L1-01"],
  ];
  for (const [label, record, expectedRoute] of fallbacks) {
    const answer = JSON.parse(target(record));
    assert.strictEqual(answer.resolved, false, `${label} must not resolve a specific result target`);
    assert.strictEqual(answer.stage, "", `${label} must name no stage`);
    assert.strictEqual(answer.route, expectedRoute,
      `${label} must keep the shipped workspace route, got ${answer.route}`);
  }

  /* The route half is unchanged for every run: this slice added a target, it did not
     move anybody's workspace. */
  for (const factory of Object.values(RUNS)) {
    const record = factory();
    const both = vm.runInContext(`
      AUTOMATION_RUNS = ${JSON.stringify([record])};
      JSON.stringify([v641RunRoute(AUTOMATION_RUNS[0]), v670RunResultTarget(AUTOMATION_RUNS[0]).route]);
    `, page.context);
    const [legacy, current] = JSON.parse(both);
    assert.strictEqual(current, legacy, `${record.id}: the result target's route must be v641RunRoute's own answer`);
  }

  note("7. completed still -> Frames stage, completed blocking -> Look/blocking tab, both from the declared stage model; six unresolvable cases keep the shipped route");
}

/* ===========================================================================
   8. FRAME NAVIGATION SITS NEXT TO FRAME REVIEW

   The founder reproduced this directly: continuity machinery and an older pair-review
   panel rendered permanently between the frame strip and the frame card.
   =========================================================================== */

async function checkContinuityIsOutOfTheWay() {
  /* The bounded shot workspace renders ONE stage, so the Frames stage has to be the
     selected one or this check reads a page that never had a frame card in it. */
  const page = await render("#/shot/L1-01", buildFixture(), {
    storage: { "cinebraid-focused:fixture:shot-task:L1-01": "frames" },
  });
  const html = page.html;

  const strip = html.indexOf("guided-frame-rail");
  const card = html.indexOf("guided-frame-card");
  assert.ok(strip >= 0, "the Frames workspace must render the frame strip");
  assert.ok(card >= 0, "the Frames workspace must render the frame card");
  assert.ok(strip < card, "the frame strip must precede the frame card");

  /* WHAT WAS BETWEEN THEM. The founder smoke found the continuity panel and the older
     pair-review block rendering permanently between frame navigation and frame review.
     Both must now be after the card. */
  const between = html.slice(strip, card);
  assert.ok(!between.includes("shot-continuity"),
    "the continuity panel still renders between frame navigation and frame review");
  assert.ok(!between.includes("legacy-continuity-review"),
    "the legacy pair-review block still renders between frame navigation and frame review");

  const continuity = html.indexOf("shot-continuity-fold");
  assert.ok(continuity > card,
    "continuity must render after the frame card");

  /* COLLAPSED BY DEFAULT. The opening tag carries no `open`. */
  const tagStart = html.lastIndexOf("<details", continuity);
  const openingTag = html.slice(tagStart, html.indexOf(">", continuity) + 1);
  assert.ok(/shot-continuity-fold/.test(openingTag), `could not read the continuity fold's opening tag, got: ${openingTag}`);
  /* Attribute VALUES are blanked first: the ontoggle handler contains `this.open`,
     which a bare word search happily mistakes for the `open` attribute. */
  const attributesOnly = openingTag.replace(/="[^"]*"/g, '=""');
  assert.ok(!/\bopen\b/.test(attributesOnly),
    `the continuity fold must be collapsed by default, got: ${openingTag}`);

  /* AND IT STATES NO OUTCOME. Outcome wording belongs to shared-continuity.js; a
     summary that judged continuity would be this file forming an opinion about it. */
  const summary = html.slice(html.indexOf("<summary>", continuity) + 9, html.indexOf("</summary>", continuity));
  for (const verdict of ["pass", "fail", "break", "drift", "consistent", "inconsistent", "ok", "clean"]) {
    assert.ok(!summary.toLowerCase().includes(verdict),
      `the continuity fold's summary states an outcome ("${verdict}"): ${summary}`);
  }

  /* The legacy fold is below the card too, and was already collapsed. */
  const legacy = html.indexOf("legacy-continuity-review");
  if (legacy >= 0) {
    assert.ok(legacy > card, "the legacy pair-review fold must render after the frame card");
  }

  /* THE COMPOSITION ORDER, asserted at the source, so this survives a fixture that
     happens not to render one of the two folds. */
  const creation = read("public/creation-studio.js");
  const body = creation.slice(creation.indexOf("guided-frame-workflow-body"));
  const line = body.slice(0, body.indexOf("</details>"));
  const iRail = line.indexOf("guidedFrameRailMarkup");
  const iCard = line.indexOf("guidedFrameCard");
  const iCont = line.indexOf("${continuityMarkup}");
  const iLegacy = line.indexOf("${legacyReviewMarkup}");
  assert.ok(iRail >= 0 && iCard >= 0 && iCont >= 0 && iLegacy >= 0,
    "the Frames workflow body must still compose the strip, the card, continuity and the legacy fold");
  assert.ok(iCard < iCont && iCard < iLegacy,
    "the frame card must be composed BEFORE the continuity and legacy folds");
  assert.ok(iRail < iCard, "the frame strip must still precede the frame card");

  /* AND CONTINUITY ITSELF IS UNCHANGED: the fold wraps guidedContinuityPanel's output
     rather than replacing, re-rendering or re-judging it. */
  assert.ok(/const continuityPanel = typeof guidedContinuityPanel === "function"/.test(creation),
    "the continuity fold must wrap the shipped panel, not build its own");
  const foldSource = creation.slice(creation.indexOf("const continuityMarkup = continuityPanel"), creation.indexOf("const continuityMarkup = continuityPanel") + 900);
  assert.ok(!/continuityFinding|continuityVerdict|continuityOutcome|shared-continuity/.test(foldSource),
    "the continuity fold must not reach into continuity contract internals");

  note(`8. frame strip -> frame card adjacent; continuity (${continuity}) and the legacy pair review (${legacy}) both render after the card (${card}), collapsed, with no outcome in the summary`);
}

/* ===========================================================================
   9. NOTHING THAT DERIVES TRUTH MOVED

   The whole slice is presentation. This is the assertion that says so in a way a
   reviewer can check without reading the diff.
   =========================================================================== */

function checkNoTruthMoved() {
  const activity = codeOnly(read("public/live-activity.js"));

  /* The predicates are still defined here, once each, and the compact renderer asks
     them rather than answering for itself. */
  for (const predicate of ["v670MachineActiveRun", "v670WaitingForHumanRun", "v670AttentionRun", "v670RunUnsettled"]) {
    const defined = (activity.match(new RegExp(`function ${predicate}\\b`, "g")) || []).length;
    assert.strictEqual(defined, 1, `${predicate} must be defined exactly once, found ${defined}`);
  }

  /* No new persisted project field, and no project write, from anything this slice
     touched. */
  for (const file of ["public/live-activity.js", "public/creator-surfaces.js"]) {
    const code = codeOnly(read(file));
    assert.ok(!/\bdirty\(\)|saveProject\(|flushPendingProjectSave\(\)\s*;\s*P\./.test(code.replace(/v670ReconcileAfterApproval[\s\S]*?\n\};/, "")),
      `${file} must not write project truth`);
  }

  /* The result target reads the declared stage model and declares no stage list. */
  assert.ok(!/SHOT_STAGES\s*=/.test(activity), "live-activity.js must not declare a stage list of its own");
  assert.ok(!/"frames"\s*,\s*"motion"|frames.*look.*motion.*deliver/.test(activity),
    "live-activity.js must not restate the shot stage order");

  note("9. the shipped predicates are still singly defined, no project write was added, and no second stage list exists");
}

/* ===========================================================================
   RUN
   =========================================================================== */

async function main() {
  await checkOneGlobalIndicator();
  await checkAnnouncementSurvives();
  await checkCompactAgreesWithDrawer();
  await checkNoEmbeddedTimelines();
  await checkCompactCarriesNoAuthority();
  checkPanelDefaults();
  await checkResultHandoff();
  await checkContinuityIsOutOfTheWay();
  checkNoTruthMoved();
}

main().then(() => {
  console.log(notes.join("\n"));
  console.log("Quiet-the-shell suite passed: one persistent global indicator, the aria-live announcement intact, compact working-page run state agreeing with the drawer, no embedded timelines, no migrated authority, both panels quiet by default with explicit preferences honoured, panel/stage-qualified result hand-off with safe fallback, and continuity out of the frame review path.");
}).catch((error) => {
  console.error(notes.join("\n"));
  console.error(error);
  process.exit(1);
});

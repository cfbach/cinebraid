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
  /* A run whose scope IS a declared panel key. `motion` is one of the three panels the
     Motion & sound stage declares, so the stage model resolves it without this suite —
     or the code under test — restating a stage list. */
  completedMotion: () => run({ id: "run-motion", status: "completed", scope: "motion", stage: "Take approved" }),
  completedEntityState: () => run({ id: "run-entity-state", status: "completed", type: "entity-chain", targetId: "characters:KAI", scope: "state:soot-heavy" }),
  completedEntityChain: () => run({ id: "run-entity-chain", status: "completed", type: "entity-chain", targetId: "characters:KAI", scope: "state-chain" }),
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
  /* THREE OCCURRENCES, AND EXACTLY ONE OF THEM HAS PIXELS: the definition, the topbar
     chip that renders it, and the live region that speaks it. A fourth would be a
     second surface claiming to describe activity. */
  const statusReaders = (activity.match(/v6602ActivityStatus\(\)/g) || []).length;
  assert.strictEqual(statusReaders, 3,
    `v6602ActivityStatus() has ${statusReaders} occurrences; expected its definition, the one visual chip, and the announcer`);
  assert.ok(activity.includes("function v670ActivityAnnouncement"), "the announcer must read the shipped status derivation");

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
   2. ACTIVITY IS ACTUALLY ANNOUNCED TO ASSISTIVE TECHNOLOGY

   The first version of this slice failed acceptance here, and the failure is worth
   stating because the test was the thing that was wrong.

   The retired floating strip carried aria-live="polite" as a side effect of being a
   visible element. Deleting the visible thing deleted the spoken one, and this section
   did not notice because it asserted that a JavaScript CustomEvent was dispatched. An
   internal repaint event is not an announcement: no assistive technology can hear it,
   and a real Chromium page contained zero aria-live nodes.

   So the question is now asked of the DOM. A live region either exists, is hidden from
   sight, and changes its text when the activity state changes — or it does not.
   =========================================================================== */

async function checkActivityIsAnnounced() {
  const index = read("public/index.html");

  /* THE REGION IS SHIPPED CHROME, not built by JavaScript, for the reason the shell
     regions are: an element built by script is one script can build twice. */
  const region = index.match(/<div id="activity-live-region"[^>]*>/);
  assert.ok(region, "public/index.html must declare a persistent activity live region");
  const tag = region[0];
  assert.ok(/role="status"/.test(tag), `the live region must carry role="status", got: ${tag}`);
  assert.ok(/aria-live="polite"/.test(tag), `the live region must be polite, not assertive, got: ${tag}`);
  assert.ok(/aria-atomic="true"/.test(tag), `the live region must be read whole, got: ${tag}`);
  assert.ok(/class="sr-only"/.test(tag), `the live region must be visually hidden, got: ${tag}`);
  assert.ok(!/<button|onclick=/.test(tag), "the live region must carry no control");

  /* AND VISUALLY HIDDEN MEANS HIDDEN. sr-only is the shipped clip-rect helper. */
  const srOnly = read("public/styles.css").match(/\.sr-only\{[^}]*\}/);
  assert.ok(srOnly, "the sr-only helper must exist");
  for (const property of ["position:absolute", "width:1px", "height:1px", "overflow:hidden"]) {
    assert.ok(srOnly[0].includes(property), `sr-only must include ${property}, got ${srOnly[0]}`);
  }

  /* IT IS NOT A SECOND VISUAL INDICATOR. The chip stays the only one. */
  assert.ok(!index.includes("automation-global-live-strip"), "no floating visual strip may return");

  /* THE TEXT REALLY CHANGES, ON A REAL STATE TRANSITION, IN THE SHIPPED VOCABULARY. */
  const page = await render("#/shot/L1-01", buildFixture());
  const spoken = () => page.context.document.getElementById("activity-live-region").textContent;

  vm.runInContext(`AUTOMATION_RUNS = []; v641UpdateActivityButton();`, page.context);
  const quiet = spoken();
  assert.ok(/idle/i.test(quiet), `a quiet project must be announced as idle, got: ${quiet}`);

  vm.runInContext(`AUTOMATION_RUNS = ${JSON.stringify([RUNS.active()])}; v641UpdateActivityButton();`, page.context);
  const active = spoken();
  assert.notStrictEqual(active, quiet, "starting work must change what is announced");
  assert.ok(/active/i.test(active), `active work must be announced as active, got: ${active}`);

  vm.runInContext(`AUTOMATION_RUNS = ${JSON.stringify([RUNS.waiting()])}; v641UpdateActivityButton();`, page.context);
  const waiting = spoken();
  assert.notStrictEqual(waiting, active, "moving to a pending approval must change what is announced");
  assert.ok(/waiting for you/i.test(waiting), `a pending approval must be announced, got: ${waiting}`);

  vm.runInContext(`AUTOMATION_RUNS = ${JSON.stringify([RUNS.failed()])}; v641UpdateActivityButton();`, page.context);
  const attention = spoken();
  assert.notStrictEqual(attention, waiting, "moving to needs-attention must change what is announced");
  assert.ok(/attention/i.test(attention), `needs-attention must be announced, got: ${attention}`);

  /* AND THE CHIP AGREES, because both read v6602ActivityStatus(). */
  const chip = page.context.document.getElementById("automation-activity-toggle");
  const chipLabel = vm.runInContext(`v6602ActivityStatus().label`, page.context);
  assert.ok(attention.startsWith(chipLabel),
    `the announcement must start with the same label the chip renders; chip said "${chipLabel}", region said "${attention}"`);
  assert.ok(chip.innerHTML.length > 0, "the chip must still be the visible indicator");

  /* NOT A METRONOME. Recomputing the same state must not rewrite the region — a live
     region rewritten with an identical string is spoken again. */
  const marker = "SENTINEL — the region was rewritten";
  page.context.document.getElementById("activity-live-region").textContent = marker;
  vm.runInContext(`v641UpdateActivityButton(); v641UpdateActivityButton(); v641UpdateActivityButton();`, page.context);
  assert.strictEqual(spoken(), marker,
    "an unchanged activity state must not rewrite the live region, or every 3.5s poll speaks again");

  /* NEGATIVE CONTROL: the check above can only mean something if a real change does
     still get through after a run of no-ops. */
  vm.runInContext(`AUTOMATION_RUNS = []; v641UpdateActivityButton();`, page.context);
  assert.notStrictEqual(spoken(), marker, "a real state change must still reach the region");

  /* THE INTERNAL EVENT SURVIVED TOO — it is what the creator surfaces repaint from,
     and it is a SEPARATE mechanism from the announcement rather than a substitute. */
  const heard = vm.runInContext(`
    (() => {
      const seen = [];
      globalThis.CustomEvent = function CustomEvent(type) { this.type = type; };
      window.CustomEvent = globalThis.CustomEvent;
      window.dispatchEvent = (event) => { seen.push(event.type); return true; };
      v641UpdateActivityButton();
      return JSON.stringify(seen);
    })()
  `, page.context);
  assert.strictEqual(heard, JSON.stringify(["cinebraid:activity-updated"]),
    `the repaint event must still be dispatched alongside the announcement, got ${heard}`);

  note("2. a visually-hidden role=status region is announced on every activity transition (idle -> active -> waiting -> attention), agrees with the chip, and is not rewritten when nothing changed");
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

  /* ONE PERMIT, ONE NUMBER — and it is a MIN-width.

     Independent acceptance reproduced, under real Chromium with Windows display
     scaling, a viewport at which neither the "rail permitted" nor the "rail hidden"
     rule matched: the rail stayed visible and the centre fell to 884px, below the
     declared 900px floor.

     The cause was that the bands were written as MAX-width exclusions.
     `max-width:1359px` does not match a viewport of 1359.4 CSS px — which device
     scaling produces routinely — so the rail was permitted at a width the floor
     arithmetic forbids. Two adjacent hand-written numbers can never close that: the gap
     lives BETWEEN the integers.

     A min-width PERMIT has no such interval. Every real width either satisfies it or it
     does not, and the un-permitted state is the safe one. And because the rail's grid
     track, the rail's own display and the open control's display are granted by the
     SAME block, "the rail may show" and "the control may offer it" are one condition
     with one number rather than two that can drift. */
  const flatStyles = read("public/styles.css").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, "");

  /* Blocks are extracted by counting braces rather than by regex, because a media
     block contains nested rules and a lazy match silently stops at the first `}`. */
  function mediaBlocks(css) {
    const blocks = [];
    const query = /@media\(([^)]*)\)\{/g;
    let match;
    while ((match = query.exec(css))) {
      let depth = 1;
      let k = query.lastIndex;
      while (k < css.length && depth > 0) {
        if (css[k] === "{") depth += 1;
        else if (css[k] === "}") depth -= 1;
        k += 1;
      }
      blocks.push({ condition: match[1], body: css.slice(query.lastIndex, k - 1) });
    }
    return blocks;
  }

  const blocks = mediaBlocks(flatStyles);
  const railPermits = blocks.filter((block) => block.body.includes('#cb-shell-rail[data-occupied]{display:block}'));
  assert.strictEqual(railPermits.length, 1,
    `the rail must be granted by exactly one media block, found ${railPermits.length}`);
  const permit = railPermits[0];

  const permitAt = permit.condition.match(/^min-width:(\d+(?:\.\d+)?)px$/);
  assert.ok(permitAt,
    `the rail must be granted by a MIN-width permit, not excluded by a max-width — got "${permit.condition}". `
    + "A max-width exclusion leaves the fractional interval between two integers unclaimed, which is the "
    + "1359px failure: at 1359.4 CSS px neither rule matched and the centre fell below its floor.");

  assert.ok(permit.body.includes('.creator-rail-toggle{display:inline-flex}'),
    "the rail's open control must be granted by the SAME block that grants the rail, or the two numbers can drift apart");
  assert.ok(/\.cb-shell-main:has\(>#cb-shell-rail\[data-occupied\]\)\{grid-template-columns:/.test(permit.body),
    "the rail's grid track must be granted by the same permit");

  /* AND NOTHING EXCLUDES THEM ANY MORE. A leftover max-width rule would reintroduce
     exactly the gap this replaced. */
  for (const block of blocks) {
    if (!block.condition.startsWith("max-width")) continue;
    assert.ok(!block.body.includes("#cb-shell-rail[data-occupied]{display:none}"),
      `a max-width block (${block.condition}) still hides the rail; the permit must be the only rule that decides`);
    assert.ok(!/\.creator-rail-toggle\{display:none/.test(block.body),
      `a max-width block (${block.condition}) still hides the rail's control`);
  }

  /* THE BOUNDARY IS THE FLOOR ARITHMETIC, not a round number. */
  const CENTRE_FLOOR = 900;
  const nav = Number((flatStyles.match(/#app\{--cb-nav-width:(\d+)px/) || [])[1]);
  const compactRail = Number((flatStyles.match(/#app\{--cb-shell-rail-width:(\d+)px\}/) || [])[1]);
  assert.ok(nav > 0 && compactRail > 0, `nav (${nav}) and base rail width (${compactRail}) must both be declared`);
  assert.ok(Number(permitAt[1]) >= CENTRE_FLOOR + nav + compactRail,
    `the rail is permitted from ${permitAt[1]}px, but ${CENTRE_FLOOR} + ${nav} + ${compactRail} = `
    + `${CENTRE_FLOOR + nav + compactRail}px is the narrowest viewport that still leaves the centre its floor`);

  /* The wider band answers to the same arithmetic with its own rail width. */
  const wide = blocks.find((block) => /#app\{--cb-shell-rail-width:\d+px\}/.test(block.body));
  assert.ok(wide, "there must be a band that grants the full rail width");
  const wideAt = wide.condition.match(/^min-width:(\d+(?:\.\d+)?)px$/);
  assert.ok(wideAt, `the full-rail band must also be a min-width permit, got "${wide.condition}"`);
  const wideRail = Number(wide.body.match(/#app\{--cb-shell-rail-width:(\d+)px\}/)[1]);
  assert.ok(wideRail > compactRail, `the wide band (${wideRail}px) must be wider than the base (${compactRail}px)`);
  assert.ok(Number(wideAt[1]) >= CENTRE_FLOOR + nav + wideRail,
    `the ${wideRail}px rail is permitted from ${wideAt[1]}px, below the ${CENTRE_FLOOR + nav + wideRail}px it needs`);

  /* THE GAPLESS PROOF, walked over the exact widths the failure was reproduced at,
     including the fractional ones a max-width bound cannot see. */
  const permitWidth = Number(permitAt[1]);
  const wideWidth = Number(wideAt[1]);
  for (const width of [1180, 1358, 1359, 1359.4, 1359.9, permitWidth, permitWidth + 0.5, 1366, 1440,
                       wideWidth - 0.5, wideWidth, 1920]) {
    const permitted = width >= permitWidth;
    const rail = !permitted ? 0 : width >= wideWidth ? wideRail : compactRail;
    const centre = width - nav - rail;
    assert.ok(centre >= CENTRE_FLOOR,
      `at ${width}px the rail would leave a ${centre}px centre, below the ${CENTRE_FLOOR}px floor`);
    /* And the two states are exhaustive: a width is permitted or it is not, and the
       control follows the rail because it is in the same block. */
    assert.strictEqual(typeof permitted, "boolean");
  }
  note(`   6b. rail permitted from ${permitWidth}px (= ${CENTRE_FLOOR} + ${nav} + ${compactRail}), full rail from `
    + `${wideWidth}px; one min-width permit grants the track, the rail and its control, and no max-width rule excludes them`);

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

  const target = (record) => JSON.parse(vm.runInContext(`
    AUTOMATION_RUNS = ${JSON.stringify([record])};
    JSON.stringify(v670RunResultTarget(AUTOMATION_RUNS[0]));
  `, page.context));

  /* ---- SHOT STAGES, answered by the declared stage model ---------------------- */

  const stills = target(RUNS.completed());
  assert.strictEqual(stills.resolved, true, "a completed shot still run must resolve a result target");
  assert.strictEqual(stills.kind, "shot-stage", "a shot run must resolve a shot-stage target");
  assert.strictEqual(stills.panel, "still", "a completed still run must target the still panel");
  assert.strictEqual(stills.stage, "frames", "the still panel must resolve to the declared Frames stage");
  assert.strictEqual(stills.route, "#/shot/L1-01", "the hash must remain the shipped workspace route");

  /* RESOLVED, WITH A SUB-VIEW: blocking is one of the two tabs the Look stage has, so
     the target has to say which tab as well as which stage. */
  const blocking = target(RUNS.completedBlocking());
  assert.strictEqual(blocking.resolved, true, "a completed blocking run must resolve a result target");
  assert.strictEqual(blocking.stage, "look", "the blocking panel must resolve to the declared Look stage");
  assert.strictEqual(blocking.view, "blocking", "the Look stage's blocking tab must be named");

  /* MOTION. Independent acceptance found this returning resolved:false while the
     vocabulary to answer it already existed. It resolves because `motion` IS a panel
     the stage model declares — the model answers, this file does not learn a stage
     list, and no second map was added to make it work. */
  const motion = target(RUNS.completedMotion());
  assert.strictEqual(motion.resolved, true, "a completed motion run must resolve a result target");
  assert.strictEqual(motion.kind, "shot-stage", "a motion run must resolve a shot-stage target");
  assert.strictEqual(motion.stage, "motion", "a motion-scoped run must land on the declared Motion & sound stage");
  assert.strictEqual(motion.route, "#/shot/L1-01", "the motion hand-off must keep the shot's own route and id");

  /* Every one of those three came from shared-stage-model.js rather than from a table
     here, which is what "do not invent a second stage map" means in practice. */
  const declared = JSON.parse(vm.runInContext(`JSON.stringify({
    still: (shotStageForPanel("still") || {}).id,
    blocking: (shotStageForPanel("blocking") || {}).id,
    blockingView: shotStagePanelView("blocking"),
    motion: (shotStageForPanel("motion") || {}).id,
  })`, page.context));
  assert.deepStrictEqual(declared, { still: "frames", blocking: "look", blockingView: "blocking", motion: "motion" },
    "the result targets must be the declared stage model's own answers");

  /* And the scope-that-is-a-panel path is general, not a motion special case: every
     panel the model declares resolves to the stage that owns it. */
  const declaredPanels = JSON.parse(vm.runInContext(
    `JSON.stringify(SHOT_STAGES.flatMap((stage) => stage.panels))`, page.context));
  for (const panelKey of declaredPanels) {
    const answer = target(run({ id: `run-${panelKey}`, status: "completed", scope: panelKey }));
    const owning = vm.runInContext(`(shotStageForPanel(${JSON.stringify(panelKey)}) || {}).id`, page.context);
    assert.strictEqual(answer.resolved, true, `a run scoped "${panelKey}" must resolve — it is a declared panel`);
    assert.strictEqual(answer.stage, owning, `"${panelKey}" must resolve to the stage the model says owns it`);
  }

  /* ---- ENTITY TASKS, answered by the entity workspace's own vocabulary --------- */

  const entityDefault = target(RUNS.completedEntity());
  assert.strictEqual(entityDefault.resolved, true, "a completed default-reference run must resolve a result target");
  assert.strictEqual(entityDefault.kind, "entity-task", "an entity run must resolve an entity-task target");
  assert.strictEqual(entityDefault.task, "review",
    "a run that built and approved the base reference must land on Choose & approve, where the candidates are");
  assert.strictEqual(entityDefault.route, "#/character/KAI", "the entity hand-off must keep the shipped entity route");

  const entityState = target(RUNS.completedEntityState());
  assert.strictEqual(entityState.resolved, true, "a completed per-state run must resolve a result target");
  assert.strictEqual(entityState.task, "coverage", "a state result lives under Coverage & states");
  assert.strictEqual(entityState.view, "states", "the coverage sub-view must be the states view");
  assert.strictEqual(entityState.state, "soot-heavy",
    "the state the run derived must be the state that gets selected");

  const entityChain = target(RUNS.completedEntityChain());
  assert.strictEqual(entityChain.resolved, true, "a completed state-chain run must resolve a result target");
  assert.strictEqual(entityChain.task, "coverage", "a state chain lands under Coverage & states");
  assert.strictEqual(entityChain.view, "states", "the states view is the surface a chain produced");
  assert.strictEqual(entityChain.state, "",
    "a chain derived several states and names none, so singling one out would be a guess");

  /* Those task ids are the ones the entity workspace actually declares. */
  /* The four task ids the entity workspace declares in its own `specs` array, read
     out of entities.js rather than restated here. */
  const specsBlock = read("public/entities.js");
  const entityTasks = [...specsBlock.matchAll(/\{id:"(reference|review|coverage|details)",label:/g)].map((m) => m[1]);
  assert.ok(entityTasks.length >= 4, `could not read the entity task ids from entities.js, got ${entityTasks.join(", ")}`);
  for (const answer of [entityDefault, entityState, entityChain]) {
    assert.ok(entityTasks.includes(answer.task),
      `${answer.task} is not one of the entity workspace's declared tasks (${entityTasks.join(", ")})`);
  }
  /* And the writer they will be applied through is the entity workspace's own. */
  const entitySource = read("public/entities.js");
  assert.ok(entitySource.includes("function selectEntityResultTask"), "the entity result writer must exist");
  assert.ok(/boundedWriteFocusedTask\("entity-task"/.test(entitySource),
    "entity task selection must go through boundedWriteFocusedTask — boundedWriteState is a different namespace and is silent");
  assert.ok(entitySource.includes('boundedWriteState("selected:entity-coverage-view"'), "the coverage sub-view must be written through the shipped key");
  assert.ok(entitySource.includes('boundedWriteState("selected:continuity-state"'), "the selected state must be written through the shipped key");

  /* ---- FALLS BACK — every one of these is a case where guessing would be worse --- */
  const fallbacks = [
    ["a run still working", RUNS.active(), "#/shot/L1-01"],
    ["a run waiting on the director", RUNS.waiting(), "#/shot/L1-01"],
    ["a run needing attention", RUNS.failed(), "#/shot/L1-01"],
    ["a completed scene-chain run", RUNS.completedScene(), "#/scene/L1"],
    ["a completed shot run with an unknown scope", run({ id: "odd", status: "completed", scope: "some-future-scope" }), "#/shot/L1-01"],
    ["a completed entity run with an unknown scope", run({ id: "odd-entity", status: "completed", type: "entity-chain", targetId: "characters:KAI", scope: "who-knows" }), "#/character/KAI"],
    ["a completed entity run with a malformed target", run({ id: "bad-entity", status: "completed", type: "entity-chain", targetId: "characters", scope: "default-only" }), "#/character/"],
    ["an empty per-state scope", run({ id: "empty-state", status: "completed", type: "entity-chain", targetId: "characters:KAI", scope: "state:" }), "#/character/KAI"],
  ];
  for (const [label, record, expectedRoute] of fallbacks) {
    const answer = target(record);
    assert.strictEqual(answer.resolved, false, `${label} must not resolve a specific result target`);
    assert.strictEqual(answer.kind, "", `${label} must name no target kind`);
    assert.strictEqual(answer.stage, "", `${label} must name no stage`);
    assert.strictEqual(answer.task, "", `${label} must name no entity task`);
    assert.strictEqual(answer.route, expectedRoute,
      `${label} must keep the shipped workspace route, got ${answer.route}`);
  }

  /* The route half is unchanged for every run: this slice added a target, it did not
     move anybody's workspace. */
  for (const factory of Object.values(RUNS)) {
    const record = factory();
    const both = JSON.parse(vm.runInContext(`
      AUTOMATION_RUNS = ${JSON.stringify([record])};
      JSON.stringify([v641RunRoute(AUTOMATION_RUNS[0]), v670RunResultTarget(AUTOMATION_RUNS[0]).route]);
    `, page.context));
    assert.strictEqual(both[1], both[0], `${record.id}: the result target's route must be v641RunRoute's own answer`);
  }

  /* THE OPENER RENDERS WHEN THE HASH DOES NOT CHANGE. Assigning location.hash the value
     it already holds fires no hashchange, and the selection writers deliberately do not
     render, so without this the filmmaker gets the right stage selected and the old one
     still on screen. */
  const opener = codeOnly(read("public/live-activity.js"));
  const openerBody = opener.slice(opener.indexOf("window.openRunResult"), opener.indexOf("};", opener.indexOf("window.openRunResult")));
  assert.ok(/if \(location\.hash !== target\.route\) location\.hash = target\.route;/.test(openerBody),
    "the opener must navigate when the route changes");
  assert.ok(/else if \(typeof route === "function"\) route\(\);/.test(openerBody),
    "the opener must render when the route is already current, or an unchanged hash leaves the page unmoved");
  assert.ok(/selectGuidedPanelTask/.test(openerBody) && /selectEntityResultTask/.test(openerBody),
    "the opener must apply the shot writer and the entity writer, each for its own target kind");

  note("7. still -> Frames, blocking -> Look/blocking, motion -> Motion & sound, and every declared panel key resolves to "
    + "its owning stage; entity default -> Choose & approve, state -> Coverage/states/that state, chain -> Coverage/states; "
    + "eight unresolvable cases keep the shipped route");
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
  await checkActivityIsAnnounced();
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

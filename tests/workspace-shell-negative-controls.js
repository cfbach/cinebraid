/* Negative controls for tests/workspace-shell.js.
 *
 * A guarantee nobody has watched fail is a guarantee nobody has tested. Each control
 * below reintroduces one specific way the creator workspace shell could be wrong — IN
 * MEMORY, by mutating a copy of the shipped source, so nothing on disk is touched and no
 * control can be "restored" by a checkout that also discards real work — and then proves
 * the matching assertion actually notices.
 *
 * Each control carries a PROBE RECEIPT: the mutation asserts the text it is replacing
 * was really present, so a control cannot quietly become a no-op when the source is
 * refactored and start "passing" against nothing.
 *
 * EVERY CONTROL BREAKS A DIFFERENT MECHANISM, and names the check that has to fail. That
 * is the point: O2's assertions are mostly structural, and structural assertions are the
 * easiest kind to write in a form that cannot fail. A control that fires for the same
 * reason as its neighbour is proving one thing twice and nothing once.
 *
 * WHAT IS NOT HERE. Node identity across a stage change, real scroll containment and
 * page-growth behaviour are properties of a live document; their negative controls live
 * in tests/workspace-shell-real-browser.py, which reconstructs the shell per stage and
 * unbounds the dock inside a running Chromium and requires both to be caught.
 *
 * NO PROJECT DATA IS TOUCHED, NO PAID CALL AND NO PROVIDER CALL.
 */

const assert = require("assert");

const suite = require("./workspace-shell.js");
const { SOURCES } = suite;

const notes = [];
const note = (line) => notes.push(line);

/* A mutation that must find what it is replacing. */
function mutate(source, needle, replacement, label, expected = 1) {
  const hits = source.split(needle).length - 1;
  assert.strictEqual(hits, expected,
    `probe receipt: ${label} expected ${expected} occurrence(s) of its anchor, found ${hits}. `
    + "The control is no longer mutating the live path and must be rewritten.");
  return source.split(needle).join(replacement);
}

/* Which exported checks have actually been driven, recorded as the controls run so the
   coverage assertion at the end reads what happened rather than a hand-maintained list
   that can drift away from it. */
const EXERCISED = new Set();
let CONTROL_COUNT = 0;

/* Runs one named check against a mutated source record and requires it to fail.
   A control that passes is a control that has stopped controlling anything. */
function control(label, checkName, patch, expectation) {
  CONTROL_COUNT += 1;
  EXERCISED.add(checkName);
  assert.strictEqual(typeof suite[checkName], "function",
    `${label} names ${checkName}, which tests/workspace-shell.js does not export`);
  const sources = { ...SOURCES, ...patch };
  let failed = false;
  let message = "";
  try {
    suite[checkName](sources);
  } catch (error) {
    if (error instanceof assert.AssertionError) {
      failed = true;
      message = String(error.message).split("\n")[0];
    } else {
      throw error;
    }
  }
  assert.ok(failed,
    `${label}: ${checkName} accepted the broken shell. ${expectation}`);
  note(`  ${label} — ${checkName} failed as required`);
  return message;
}

/* ===========================================================================
   OVERFLOW OWNERSHIP — the section where a silent regression is most expensive,
   because the symptom (a horizontally scrolling page, a dock covering the primary
   action) appears far from the rule that caused it.
   =========================================================================== */

function overflowControls() {
  note("Overflow ownership:");

  control("C1 the centre track loses its min-width:0 floor", "checkOverflowOwnership",
    { styles: mutate(SOURCES.styles,
        ".cb-shell-main{display:grid;grid-template-columns:minmax(0,1fr)}",
        ".cb-shell-main{display:grid;grid-template-columns:1fr}",
        "C1") },
    "A plain 1fr lets a wide child inside #main widen the grid track and put a horizontal scrollbar on the whole page.");

  control("C2 the rail stretches instead of starting", "checkOverflowOwnership",
    { styles: mutate(SOURCES.styles,
        /* The offsets became variables in O4, when the rail stopped being the only
           surface pinning beneath the topbar. The control is unchanged in meaning: it
           removes align-self:start and nothing else. */
        "align-self:start;max-height:calc(100vh - var(--cb-topbar-stop)",
        "max-height:calc(100vh - var(--cb-topbar-stop)",
        "C2") },
    "A stretched grid item is exactly as tall as its area, so position:sticky has nothing to move within and the rail scrolls away with the page.");

  control("C3 the dock re-enters document flow", "checkOverflowOwnership",
    { styles: mutate(SOURCES.styles, "#cb-shell-dock{position:fixed;", "#cb-shell-dock{position:static;", "C3") },
    "An in-flow dock is pushed to the document bottom and its content lengthens the page — the exact runaway the fixed positioning exists to prevent.");

  control("C4 the dock body may refuse to shrink", "checkOverflowOwnership",
    { styles: mutate(SOURCES.styles,
        "#cb-shell-dock>.cb-shell-slot-body{flex:1;min-height:0;",
        "#cb-shell-dock>.cb-shell-slot-body{flex:1;",
        "C4") },
    "Without min-height:0 the flex item refuses to shrink below its content, defeating the dock's max-height and its internal scroll with it.");

  control("C5 the dock stops reserving the space it covers", "checkOverflowOwnership",
    { styles: mutate(SOURCES.styles,
        "#workspace{padding-bottom:var(--cb-dock-reserve,0px)}",
        "#workspace{padding-bottom:0}",
        "C5") },
    "A fixed dock cannot push anything, so without the reservation it permanently hides the bottom of the centre workspace.");

  control("C6 the rail becomes unbounded", "checkOverflowOwnership",
    { styles: mutate(SOURCES.styles,
        "max-height:calc(100vh - var(--cb-topbar-stop) - var(--cb-bar-height,0px) - var(--cb-dock-reserve,0px));overflow-y:auto",
        "overflow-y:auto", "C6") },
    "An unbounded rail lets an Assistant conversation set the page height.");

  /* The rail's width and its two thresholds are one piece of arithmetic, added in O3
     when the rail acquired content. Each control breaks the relation a different way. */
  /* THE CONTROL THIS BATCH MOST NEEDED, twice over. Acceptance first reproduced a
     fractional gap between two max-width integers, then — in HEADED Windows Chromium,
     where scrollbars consume layout width — a viewport band permitting a rail the
     centre could not afford. Both faults are the same mistake: deciding from the
     viewport instead of from the space the centre and the rail actually share. This
     puts a width band back in charge and requires the check to catch it. */
  control("C6a the rail permit goes back to a viewport width band", "checkRailWidthBands",
    { styles: mutate(SOURCES.styles,
        '#workspace[data-rail-width][data-creator-shell="1"] #cb-shell-rail[data-occupied]{display:block}',
        '@media(min-width:1360px){#workspace[data-creator-shell="1"] #cb-shell-rail[data-occupied]{display:block}}',
        "C6a") },
    "A media query answers to the viewport, and a classic vertical scrollbar consumes layout width the viewport still counts: at a nominal 1360px viewport the rail was permitted and the centre rendered 884.8px, below its floor. Headless Chromium overlays its scrollbars and never showed it.");

  control("C6b the stylesheet states a rail width of its own", "checkRailWidthBands",
    { styles: mutate(SOURCES.styles,
        '#workspace[data-creator-shell="1"] .creator-rail-toggle{display:inline-flex}',
        '#workspace[data-creator-shell="1"] .creator-rail-toggle{display:inline-flex}\n#app{--cb-shell-rail-width:340px}',
        "C6b") },
    "A width declared here is a second opinion about a measured quantity: the grid would use one number while the decision to show a rail at all used another.");

  control("C6c the arithmetic stops leaving the centre its floor", "checkRailWidthBands",
    { declaration: mutate(SOURCES.declaration,
        "  const SHELL_CENTRE_FLOOR = 900;",
        "  const SHELL_CENTRE_FLOOR = 700;",
        "C6c") },
    "The floor is the viewport width the component rules stack at; lowering it does not widen anything, it just stops reporting that the centre has entered a band nothing was laid out for.");

  control("C6d turning the rail on stops reserving room for a scrollbar", "checkRailWidthBands",
    { declaration: mutate(SOURCES.declaration,
        "      const required = SHELL_CENTRE_FLOOR + width + (held === width ? 0 : band);",
        "      const required = SHELL_CENTRE_FLOOR + width;",
        "C6d") },
    "Without the band a rail can be granted at exactly the floor, reflow the narrower centre into a scrollbar, fall under the floor, disappear, release the scrollbar and be granted again — which is a flicker, not a layout.");
}

/* ===========================================================================
   THE NAVIGATION WIDTH — one declaration, read twice. The failure this prevents is
   silent at 100% UI scale and wrong everywhere else.
   =========================================================================== */

function navigationWidthControls() {
  note("Navigation width:");

  control("C7 the dock hard-codes an inset", "checkNavigationWidthSource",
    { styles: mutate(SOURCES.styles, "left:var(--cb-nav-width,0px);", "left:256px;", "C7") },
    "The stylesheet contains five navigation widths and four are dead cascade layers; any literal is wrong at some width and cannot follow a UI-scale change.");

  control("C8 the grid stops reading the shared declaration", "checkNavigationWidthSource",
    { styles: mutate(SOURCES.styles,
        "#app{--cb-nav-width:220px;grid-template-columns:var(--cb-nav-width) minmax(0,1fr)}",
        "#app{--cb-nav-width:220px;grid-template-columns:220px minmax(0,1fr)}",
        "C8") },
    "If the grid does not consume the variable, the dock and the navigation are two numbers that merely happen to agree today.");

  /* The anchor carries its comment because `#app{--cb-nav-width:0px}` is no longer
     unique: the print block zeroes it too, so that the late top-level rule cannot leave
     a 220px empty gutter down the side of every printed page. Mutating both would be
     testing two unrelated things at once. */
  control("C9 the overlay breakpoint stops zeroing the inset", "checkNavigationWidthSource",
    { styles: mutate(SOURCES.styles,
        "  /* The navigation is an overlay drawer here, not a column. It reserves nothing. */\n  #app{--cb-nav-width:0px}",
        "  #app{--cb-nav-width:220px}",
        "C9") },
    "Below 900px #rail is a fixed off-canvas drawer and the workspace starts at the viewport edge; a non-zero inset leaves a dead 220px band beside the dock on every phone.");

  control("C10 the rejected runtime measurement returns", "checkNavigationWidthSource",
    { runtime: mutate(SOURCES.runtime,
        "  function measure() {\n    const host = variableHost();",
        "  function measure() {\n    const host = variableHost();\n    const left = shellRoot().getBoundingClientRect().left;",
        "C10") },
    "#app carries zoom:var(--ui-scale); a post-zoom pixel value written back inside the zoomed subtree is scaled a second time, so the dock misses the navigation at every scale except 100%.");
}

/* ===========================================================================
   ROUTE ELIGIBILITY — one answer, naming real routes, leaving nothing undecided.
   =========================================================================== */

function eligibilityControls() {
  note("Route eligibility:");

  control("C11 Settings inherits the creator shell", "checkRouteEligibility",
    { declaration: mutate(SOURCES.declaration, '    "reports",\n  ]);', '    "reports",\n    "settings",\n  ]);', "C11") },
    "Settings configures the application; persistent production tools there would describe work the surface cannot do.");

  control("C12 a route is silently left undecided", "checkRouteEligibility",
    { declaration: mutate(SOURCES.declaration, '    "reports",\n  ]);', "  ]);", "C12") },
    "A route in neither the eligible list nor the exclusions is a surface nobody chose — precisely the scattered-exception state the single declaration replaced.");

  control("C13 the eligible list names a route that does not exist", "checkRouteEligibility",
    { declaration: mutate(SOURCES.declaration, '    "reports",\n  ]);', '    "reports",\n    "timeline",\n  ]);', "C13") },
    "An eligibility list that names routes public/app.js cannot reach is not a contract.");

  control("C14 an exclusion stops recording why", "checkRouteEligibility",
    { declaration: mutate(SOURCES.declaration,
        'settings: "Settings configures the application; it is not a production task, and persistent production tools there would be describing work the surface cannot do.",',
        'settings: "no",',
        "C14") },
    "An exclusion without a reason reads as an oversight somebody later corrects by accident.");

  note("Derivation:");

  control("C15 presence stops depending on an open project", "checkDerivation",
    { declaration: mutate(SOURCES.declaration,
        '    if (!hasProject) return { present: false, view, reason: "no-project" };',
        "",
        "C15") },
    "The first-run and project-failure screens render into #main on #/production, which IS an eligible route — deriving presence from the route alone puts an Assistant rail beside 'no project is open'.");
}

/* ===========================================================================
   STRUCTURE, OWNERSHIP AND STATE
   =========================================================================== */

function structuralControls() {
  note("Structure and ownership:");

  control("C16 a second rail region is appended", "checkMarkup",
    { markup: mutate(SOURCES.markup,
        '<aside id="cb-shell-rail" class="cb-shell-slot" data-shell-slot="rail" aria-label="Braidy"><div class="cb-shell-slot-body"></div></aside>',
        '<aside id="cb-shell-rail" class="cb-shell-slot" data-shell-slot="rail" aria-label="Braidy"><div class="cb-shell-slot-body"></div></aside>'
        + '<aside id="cb-shell-rail" class="cb-shell-slot" data-shell-slot="rail" aria-label="Braidy"><div class="cb-shell-slot-body"></div></aside>',
        "C16") },
    "Two nodes with the same region id is a second shell, and the one a consumer mounted into is then decided by document order.");

  control("C17 the rail is moved inside the centre", "checkMarkup",
    { markup: mutate(SOURCES.markup,
        '<main id="main"></main>\n      <aside id="cb-shell-rail"',
        '<main id="main"><aside id="cb-shell-rail"',
        "C17") },
    "#main's innerHTML is replaced on every route render, so a rail inside it is destroyed by the first stage change — the whole defect O2 exists to remove.");

  control("C18 the dock is shipped with placeholder chrome", "checkEmptyAndPresence",
    { markup: mutate(SOURCES.markup,
        '<div id="cb-shell-dock" class="cb-shell-slot" data-shell-slot="dock" aria-label="Activity terminal"><div class="cb-shell-slot-body"></div></div>',
        '<div id="cb-shell-dock" class="cb-shell-slot" data-shell-slot="dock" aria-label="Activity terminal"><div class="cb-shell-slot-body">ACTIVITY TERMINAL — COMING SOON</div></div>',
        "C18") },
    "A dead labelled rectangle promising a feature that does not exist is a claim this build cannot support.");

  control("C19 an empty slot paints anyway", "checkEmptyAndPresence",
    { styles: mutate(SOURCES.styles, ".cb-shell-slot{display:none;", ".cb-shell-slot{display:block;", "C19") },
    "An empty region that occupies space is the dead chrome O2 is required not to ship.");

  /* The anchor gained `[data-rail-width]` when the rail permit stopped being a width
     band and became a measured attribute. The control is unchanged in meaning: it drops
     the shell-PRESENCE condition and nothing else. */
  control("C20 retained content paints on an excluded surface", "checkEmptyAndPresence",
    { styles: mutate(SOURCES.styles,
        '#workspace[data-rail-width][data-creator-shell="1"] #cb-shell-rail[data-occupied]{display:block}',
        '#workspace[data-rail-width] #cb-shell-rail[data-occupied]{display:block}',
        "C20") },
    "Mounted content is retained across navigation so an Assistant conversation survives a visit to Settings; without the presence condition it would also be VISIBLE there.");

  control("C21 the shell runtime persists its own state", "checkNoShadowState",
    { runtime: mutate(SOURCES.runtime,
        "  function clearSlot(name) {",
        '  function rememberRail() { localStorage.setItem("assistantRailOpen", "1"); }\n  function clearSlot(name) {',
        "C21") },
    "Shell presence is a page layout; persisting it would turn the page's shape into production state.");

  control("C22 the runtime starts constructing regions", "checkRuntimeOwnership",
    { runtime: mutate(SOURCES.runtime,
        "  function shellRoot() {",
        "  function buildRail() { return document.createElement(\"aside\"); }\n  function shellRoot() {",
        "C22") },
    "A region built by JavaScript is a region JavaScript can build twice, and cross-render node identity then depends on every future caller remembering to check.");

  control("C23 the renderer is coupled to the shell", "checkRuntimeOwnership",
    { app: mutate(SOURCES.app,
        '    $("#main").innerHTML = rendered;',
        '    $("#main").innerHTML = rendered;\n    window.CineBraidShell?.syncCreatorShell();',
        "C23") },
    "The shell must react to the render, not be driven by it; a renderer that knows the shell is a renderer the next shell change has to edit.");

  /* C24 and C24b drove the anchoring of the floating activity strip, which Batch 2
     Slice 1 retired in favour of the single topbar chip. The rule they enforced
     survives in a stronger, absence-shaped form — live-activity.js must not insert a
     persistent banner beside the Main region at all — so the control brings the strip
     BACK and requires checkRuntimeOwnership to catch it. A rule stated as "never
     again" needs a control that tries it again. */
  control("C24 a persistent live banner is inserted beside the Main region again", "checkRuntimeOwnership",
    { activity: mutate(SOURCES.activity,
        "function v641UpdateActivityButton() {",
        "function v642RebuildGlobalActivityStrip() {\n  const strip = document.createElement(\"button\");\n  strip.id = \"automation-global-live-strip\";\n  const anchor = document.getElementById(\"cb-shell-main\");\n  const parent = anchor?.parentNode;\n  if (anchor && parent) parent.insertBefore(strip, anchor);\n}\nfunction v641UpdateActivityButton() {",
        "C24") },
    "Two persistent global indicators for one derivation is two places to look for one sentence, and an in-flow banner beside the two-track Main region is how the workspace came to render at 340px.");

  note("The region declaration and the mount contract:");

  control("C26 the shell offers to mount into the centre", "checkDeclaration",
    { declaration: mutate(SOURCES.declaration, "      mountable: false,", "      mountable: true,", "C26") },
    "The centre belongs to the current production workspace and public/app.js replaces its innerHTML wholesale; a shell that mounts there is a second writer of the same element.");

  control("C27 an empty region stops collapsing", "checkDeclaration",
    { declaration: mutate(SOURCES.declaration,
        '      owner: "a future Activity Terminal",\n      purpose: "Persistent bottom slot beneath the whole workspace.",\n      mountable: true,\n      collapsesWhenEmpty: true,',
        '      owner: "a future Activity Terminal",\n      purpose: "Persistent bottom slot beneath the whole workspace.",\n      mountable: true,\n      collapsesWhenEmpty: false,',
        "C27") },
    "A dock declared to persist while empty is a permanent band of dead chrome at the bottom of every creator surface.");

  control("C28 the mount contract loses an entry point", "checkMountContract",
    { runtime: mutate(SOURCES.runtime, "    mountSlot,\n    clearSlot,", "    clearSlot,", "C28") },
    "O3 has to be able to put a node in a slot; a contract missing mountSlot forces the Assistant to reach for the DOM directly and re-decide the layout.");

  note("Stage agnosticism:");

  control("C25 the shell acquires an opinion about a stage", "checkStageAgnostic",
    { runtime: mutate(SOURCES.runtime,
        '  const MAIN_REGION_ID = "cb-shell-main";',
        '  const MAIN_REGION_ID = "cb-shell-main";\n  const DEFAULT_STAGE = "frames";',
        "C25") },
    "The shell must stay present and unchanged while the centre moves between stages; a shell that can name a stage can be made to depend on one.");
}

/* ===========================================================================
   THE CONTROL OF THE CONTROLS.

   Every check the suite exports must be exercised by at least one control above.
   Without this, adding a new assertion and forgetting to break it leaves an untested
   guarantee that looks tested — which is the failure mode this whole file exists for.
   =========================================================================== */

function checkEveryAssertionIsControlled() {
  const exported = Object.keys(suite).filter((key) => key.startsWith("check"));
  const uncontrolled = exported.filter((name) => !EXERCISED.has(name));
  assert.deepStrictEqual(uncontrolled, [],
    `these checks in tests/workspace-shell.js have no negative control and could be passing vacuously: ${uncontrolled.join(", ")}`);
  note(`Coverage: ${CONTROL_COUNT} controls exercise all ${exported.length} exported checks (${exported.join(", ")})`);
}

function main() {
  overflowControls();
  navigationWidthControls();
  eligibilityControls();
  structuralControls();
  checkEveryAssertionIsControlled();
  console.log(notes.join("\n"));
  console.log("creator workspace shell negative controls passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}

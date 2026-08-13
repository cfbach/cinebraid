/* O2 — the persistent creator workspace shell.
 *
 * THE STATEMENT THIS SUITE EXISTS TO MAKE TRUE, in one line: CineBraid has one place
 * to put the Assistant and one place to put the Activity Terminal, and neither of the
 * five filmmaking stages has to know either place exists.
 *
 * WHAT WAS ACTUALLY THE PROBLEM BEFORE O2. The shipped page had exactly one content
 * slot, `#main`, and public/app.js's route() replaces its innerHTML wholesale — including
 * on the renders caused by moving between the five declared shot stages, which do not
 * change the hash at all. So anything that has to survive a stage change could not be
 * built by a stage, and there was nowhere else to build it. O2 does not fill the two new
 * places; it establishes that they exist, that they are the SAME NODES afterwards, and
 * that neither of them can lengthen or widen the page.
 *
 * WHAT THIS SUITE REFUSES TO DO. It does not assert that a declared constant equals
 * itself. Every check below either drives the shipped derivation in
 * public/shared-workspace-shell.js, reads the shipped markup and stylesheet that the
 * browser actually loads, or pins a structural property that
 * tests/workspace-shell-negative-controls.js can point a mutation at. Section 3 in
 * particular cross-checks the declared eligible views against the REAL route table in
 * public/views.js, so a list naming a route that does not exist fails here.
 *
 * WHAT IS PROVEN IN CHROMIUM INSTEAD, and why it is not here: node identity across a
 * stage change, real scroll containment, and the absence of horizontal overflow are
 * statements about a live document. tests/render-harness.js's FakeElement neither
 * parses HTML nor tracks node identity, so those live in
 * tests/workspace-shell-real-browser.py.
 *
 * NO PROJECT DATA IS TOUCHED — nothing here opens a project or starts a server.
 * NO PAID CALL AND NO PROVIDER CALL: nothing here makes a request at all.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

/* Line endings are normalised on read: this repository checks out with
   core.autocrlf=true, so every public file arrives with CRLF and a multi-line anchor
   written with \n would match nothing and take the assertion's meaning with it. */
const readSource = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

const DECLARATION_FILE = path.join(PUBLIC, "shared-workspace-shell.js");
const RUNTIME_FILE = path.join(PUBLIC, "workspace-shell.js");
const MARKUP_FILE = path.join(PUBLIC, "index.html");
const STYLE_FILE = path.join(PUBLIC, "styles.css");
const VIEWS_FILE = path.join(PUBLIC, "views.js");

const SOURCES = {
  declaration: readSource(DECLARATION_FILE),
  runtime: readSource(RUNTIME_FILE),
  markup: readSource(MARKUP_FILE),
  styles: readSource(STYLE_FILE),
  views: readSource(VIEWS_FILE),
  /* Read into the same record as the rest so a negative control can mutate them
     in memory. public/app.js is here to prove it stays ignorant of the shell;
     public/live-activity.js is here because it holds the one call O2 had to change. */
  app: readSource(path.join(PUBLIC, "app.js")),
  activity: readSource(path.join(PUBLIC, "live-activity.js")),
};

const notes = [];
const note = (line) => notes.push(line);

/* ===========================================================================
   HELPERS

   loadDeclaration evaluates the shared module in a fresh realm so the negative
   controls can load a MUTATED copy without writing to disk. Values that cross the
   realm boundary are spread into host arrays before comparison — a vm-realm Array
   fails assert.deepStrictEqual against a host literal while printing identically,
   which is a failure mode worth not rediscovering.
   =========================================================================== */

function loadDeclaration(source = SOURCES.declaration) {
  const sandbox = { module: { exports: {} }, window: undefined, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "shared-workspace-shell.js" });
  return sandbox.module.exports;
}

/* Strips comments so a check about CODE cannot be satisfied — or broken — by prose.
   This matters here: the modules discuss the Assistant and the Terminal at length in
   their headers, and a naive substring search would confuse describing a thing with
   implementing it. */
function codeOnly(source) {
  return String(source).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/* Finds one element by id in the markup and returns its full outer text, by counting
   the tag's own opens and closes. Used to ask "is #main inside the Main region" as a
   containment question rather than a substring-ordering coincidence. */
function elementBlock(markup, tag, id) {
  const open = new RegExp(`<${tag}\\b[^>]*\\bid="${id}"[^>]*>`);
  const start = markup.search(open);
  assert.notStrictEqual(start, -1, `expected markup to contain <${tag} id="${id}">`);
  const openTag = new RegExp(`<${tag}\\b`, "g");
  const closeTag = new RegExp(`</${tag}>`, "g");
  let depth = 0;
  let cursor = start;
  while (cursor < markup.length) {
    openTag.lastIndex = cursor;
    closeTag.lastIndex = cursor;
    const nextOpen = openTag.exec(markup);
    const nextClose = closeTag.exec(markup);
    if (!nextClose) break;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      cursor = nextOpen.index + nextOpen[0].length;
      continue;
    }
    depth -= 1;
    cursor = nextClose.index + nextClose[0].length;
    if (depth === 0) return markup.slice(start, cursor);
  }
  throw new assert.AssertionError({ message: `unbalanced <${tag}> while reading #${id}` });
}

const occurrences = (haystack, needle) => haystack.split(needle).length - 1;

/* Stylesheet with comments removed and whitespace collapsed, so a structural rule can
   be matched exactly without the prose that explains it changing the answer. */
const flattenCss = (styles) => String(styles).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, "");

/* Every rule in the stylesheet that sets `display` to something other than `none` on a
   shell slot — that is, every rule that can make a slot appear. Returned as
   {selector, body} pairs so an assertion can inspect what each reveal actually requires
   rather than whether some matching string exists anywhere in the file. */
function revealRules(styles) {
  const flat = flattenCss(styles);
  const rules = [];
  for (const match of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    /* A rule that opened a media block carries the `@media(...){` prefix in its
       selector capture; the condition is not part of the selector. */
    const selector = match[1].replace(/^.*\{/, "");
    const body = match[2];
    if (!/cb-shell-(rail|dock)/.test(selector)) continue;
    const display = /(?:^|;)display:([^;]+)/.exec(body);
    if (!display || display[1] === "none") continue;
    rules.push({ selector, body });
  }
  return rules;
}

/* One CSS declaration block for a selector, whitespace-normalised. Read off the
   stylesheet the browser actually loads rather than a copy, so a rule that was edited
   in one place and not the other cannot pass. */
function ruleBody(styles, selector) {
  const index = styles.indexOf(selector + "{");
  assert.notStrictEqual(index, -1, `expected stylesheet to declare \`${selector}\``);
  const end = styles.indexOf("}", index);
  assert.notStrictEqual(end, -1, `unterminated rule for \`${selector}\``);
  return styles.slice(index + selector.length + 1, end).replace(/\s+/g, "");
}

/* ===========================================================================
   1. THE REGION DECLARATION

   Three regions, named, with the centre adopting the SHIPPED element rather than
   introducing a rival content slot. The adoption is the load-bearing part: a second
   content region would mean every view renderer had to be told which one to use.
   =========================================================================== */

function checkDeclaration(sources = SOURCES) {
  const Shell = loadDeclaration(sources.declaration);
  const names = [...Shell.SHELL_SLOT_NAMES];
  assert.deepStrictEqual(names, ["center", "rail", "dock"],
    `the shell must declare exactly the three regions O3 will mount into, found ${names.join(", ")}`);

  const center = Shell.shellSlot("center");
  assert.strictEqual(center.element, "main",
    "the centre region must adopt the shipped #main element — a second content slot would force every view renderer to choose between them");
  assert.strictEqual(center.mountable, false,
    "the centre is owned by the current production workspace; the shell must not offer to mount into it");
  assert.strictEqual(center.collapsesWhenEmpty, false, "the centre must never collapse");
  assert.strictEqual(center.scroll, "document",
    "the centre must keep scrolling with the document — moving the scroll owner would unstick #rail and #topbar");

  for (const name of ["rail", "dock"]) {
    const slot = Shell.shellSlot(name);
    assert.strictEqual(slot.mountable, true, `${name} must be mountable by a future consumer`);
    assert.strictEqual(slot.collapsesWhenEmpty, true,
      `${name} must collapse when empty — a permanent labelled rectangle promising a feature that does not exist is a claim this build cannot support`);
    assert.strictEqual(slot.scroll, "self",
      `${name} must own its own scrolling, or its future content volume becomes page length`);
  }

  const mountable = [...Shell.MOUNTABLE_SLOT_NAMES];
  assert.deepStrictEqual(mountable, ["rail", "dock"],
    "exactly the rail and the dock may be mounted into");
  assert.strictEqual(Shell.shellSlotElementId("rail"), "cb-shell-rail");
  assert.strictEqual(Shell.shellSlotElementId("dock"), "cb-shell-dock");
  assert.strictEqual(Shell.shellSlot("nonsense"), null, "an undeclared region must resolve to nothing");
  note(`Regions: ${names.join(" · ")} — centre adopts #main, rail and dock collapse when empty and own their scrolling`);
}

/* ===========================================================================
   2. THE SHELL IS STAGE-AGNOSTIC

   The reason O2 exists is that a stage must not have to build the Assistant rail. The
   converse has to hold too: the shell must not know what a stage is. If either module
   mentions a declared stage id in CODE, the shell has acquired an opinion about
   filmmaking and the next batch will have to unpick it.
   =========================================================================== */

function checkStageAgnostic(sources = SOURCES) {
  const { SHOT_STAGE_IDS } = require(path.join(PUBLIC, "shared-stage-model.js"));
  const stageIds = [...SHOT_STAGE_IDS];
  assert.ok(stageIds.length >= 5, "expected the O1 stage model to declare its stages");
  for (const file of ["declaration", "runtime"]) {
    const code = codeOnly(sources[file]);
    for (const id of stageIds) {
      const hit = new RegExp(`["'\`]${id}["'\`]`).test(code);
      assert.ok(!hit,
        `public/${file === "declaration" ? "shared-workspace-shell" : "workspace-shell"}.js names the stage "${id}" in code. `
        + "The shell must remain present and unchanged while the centre moves between stages; a shell that can name a stage can be made to depend on one.");
    }
  }
  note(`Stage-agnostic: neither shell module names any of the ${stageIds.length} declared stages (${stageIds.join(", ")}) in code`);
}

/* ===========================================================================
   3. ROUTE ELIGIBILITY IS ONE ANSWER, AND IT NAMES REAL ROUTES

   The declared eligible views are cross-checked against the ACTUAL route table in
   public/views.js. This is the check that stops the list drifting into fiction: a
   surface the shell claims to serve but which public/app.js cannot route to would
   otherwise sit here looking correct forever.
   =========================================================================== */

function routeTableKeys(viewsSource) {
  const start = viewsSource.indexOf("const ROUTES = {");
  assert.notStrictEqual(start, -1, "expected public/views.js to declare ROUTES");
  const end = viewsSource.indexOf("\n};", start);
  assert.notStrictEqual(end, -1, "expected the ROUTES table to terminate");
  const block = viewsSource.slice(start, end);
  const keys = [...block.matchAll(/^ {2}(?:async )?([a-zA-Z_$][\w$]*)\(/gm)].map((match) => match[1]);
  assert.ok(keys.length >= 15,
    `parsed only ${keys.length} route keys from public/views.js — the parser has drifted and every eligibility claim below would be vacuous`);
  return keys;
}

function checkRouteEligibility(sources = SOURCES) {
  const Shell = loadDeclaration(sources.declaration);
  const routes = routeTableKeys(sources.views);
  const eligible = [...Shell.CREATOR_SHELL_VIEWS];
  const excluded = [...Shell.EXCLUDED_SHELL_VIEW_NAMES];

  for (const view of eligible) {
    assert.ok(routes.includes(view),
      `the shell claims "${view}" is a creator workspace, but public/views.js has no such route. `
      + "An eligibility list that names routes the app cannot reach is not a contract, it is a wish.");
    assert.ok(Shell.isCreatorShellView(view), `declared eligible view "${view}" must answer true`);
  }
  for (const view of excluded) {
    assert.ok(routes.includes(view),
      `the shell excludes "${view}", but no such route exists — an exclusion for a route nobody can reach hides nothing`);
    assert.ok(!Shell.isCreatorShellView(view), `excluded view "${view}" must answer false`);
    assert.ok(String(Shell.EXCLUDED_SHELL_VIEWS[view]).length > 30,
      `exclusion of "${view}" must record WHY, so it reads as a decision rather than an oversight`);
  }

  /* Every route is decided one way or the other. A route in neither list is a surface
     nobody chose, which is exactly the scattered-exception state this replaced. */
  const undecided = routes.filter((view) => !eligible.includes(view) && !excluded.includes(view));
  assert.deepStrictEqual(undecided, [],
    `these routes are neither declared creator workspaces nor declared exclusions: ${undecided.join(", ")}`);

  assert.ok(excluded.includes("settings"),
    "Settings configures the application and must not inherit persistent production tools");
  assert.ok(excluded.includes("create"),
    "the new-project bootstrap surface must not inherit the shell — there is no production to assist with yet");
  assert.ok(!Shell.isCreatorShellView(""), "an empty view name must not be eligible");
  assert.ok(!Shell.isCreatorShellView("no-such-route"), "an unrecognised view must not be eligible");

  note(`Eligibility: ${eligible.length} creator routes and ${excluded.length} declared exclusions decide all ${routes.length} routes in public/views.js, with nothing undecided`);
  return { eligible, excluded, routes };
}

/* ===========================================================================
   4. THE DERIVATION, INCLUDING THE CASE THE ROUTE NAME CANNOT ANSWER

   `hasProject` is a separate fact from the view name because the first-run screen and
   the project-failure screen both render into `#main` on `#/production`, which IS an
   eligible route. Deriving presence from the route alone would put an Assistant rail
   beside "no project is open".
   =========================================================================== */

function checkDerivation(sources = SOURCES) {
  const Shell = loadDeclaration(sources.declaration);
  const seen = new Set();
  const observe = (facts, expectPresent, expectReason, why) => {
    const state = Shell.creatorShellState(facts);
    assert.strictEqual(state.present, expectPresent, why);
    assert.strictEqual(state.reason, expectReason, `${why} (reason)`);
    seen.add(`${expectPresent ? "present" : expectReason}`);
    return state;
  };

  observe({ view: "shot", hasProject: true }, true, "",
    "an open project on the shot workspace is the central creator surface");
  observe({ view: "production", hasProject: true }, true, "",
    "the production home is a creator surface");
  observe({ view: "reports", hasProject: true }, true, "",
    "reports is production history and remains a creator surface");
  observe({ view: "settings", hasProject: true }, false, "excluded-view",
    "Settings must be refused even with a project open");
  observe({ view: "create", hasProject: true }, false, "excluded-view",
    "the bootstrap surface must be refused even with a project open");
  observe({ view: "shot", hasProject: false }, false, "no-project",
    "the project-failure and first-run screens render on eligible routes with no project and must not get the shell");
  observe({ view: "production", hasProject: false }, false, "no-project",
    "first run renders on #/production with no project");
  observe({ view: "totally-unknown", hasProject: true }, false, "unknown-view",
    "an unrecognised route must fall through to ineligible — a surface gains the shell by being named, never by being unrecognised");

  /* The no-project case must beat the excluded case, or the reason a caller is shown
     depends on the order two independent facts happened to be tested in. */
  observe({ view: "settings", hasProject: false }, false, "no-project",
    "with no project open, that is the reason — regardless of which surface is showing");

  observe({}, false, "no-project", "an empty fact record must be refused rather than defaulting to present");

  assert.deepStrictEqual([...seen].sort(), ["excluded-view", "no-project", "present", "unknown-view"],
    "every declared outcome of the derivation must be exercised — an unreached branch is an untested branch");
  note(`Derivation: all ${seen.size} declared outcomes exercised (${[...seen].sort().join(", ")})`);
}

/* ===========================================================================
   5. THE SHIPPED MARKUP

   Exactly one shell, exactly one of each region, and the containment the architecture
   depends on: the rail is INSIDE the Main region beside the centre, the dock is OUTSIDE
   it beneath both. These are read from public/index.html because that is the file the
   browser loads — the regions are static markup precisely so single-instance and
   cross-render identity are true by construction rather than by every future caller
   remembering to check.
   =========================================================================== */

function checkMarkup(sources = SOURCES) {
  const markup = sources.markup;
  for (const id of ["cb-shell-main", "cb-shell-rail", "cb-shell-dock", "main", "workspace"]) {
    assert.strictEqual(occurrences(markup, `id="${id}"`), 1,
      `public/index.html must contain exactly one element with id="${id}" — a duplicated region is a second shell`);
  }

  const workspace = elementBlock(markup, "section", "workspace");
  const region = elementBlock(markup, "div", "cb-shell-main");

  assert.ok(workspace.includes('id="cb-shell-main"'), "the Main region must live inside the shell root #workspace");
  assert.ok(workspace.includes('id="cb-shell-dock"'), "the dock must live inside the shell root #workspace");
  assert.ok(workspace.includes('id="topbar"'), "#topbar must remain inside #workspace, unmoved");

  assert.ok(region.includes('id="main"'),
    "the centre workspace must sit inside the Main region — it is the region's whole purpose");
  assert.ok(region.includes('id="cb-shell-rail"'),
    "the rail must sit inside the Main region beside the centre");
  /* Beside the centre, not within it. This is the assertion the whole batch turns on:
     #main's innerHTML is replaced on every route render — including every stage change —
     so a rail nested inside it is destroyed by the first thing the filmmaker does.
     Containment in the region does not imply exclusion from the centre, because the
     centre is itself inside the region, which is why this is checked separately. */
  const centre = elementBlock(markup, "main", "main");
  assert.ok(!centre.includes('id="cb-shell-rail"'),
    "the rail must NOT be inside #main — public/app.js replaces #main's innerHTML on every render, so a rail in there cannot survive a stage change");
  assert.ok(!centre.includes('id="cb-shell-dock"'),
    "the dock must NOT be inside #main, for the same reason");
  assert.ok(!/\S/.test(centre.replace(/^<main[^>]*>/, "").replace(/<\/main>$/, "")),
    "#main must ship empty — its contents are owned entirely by the route renderer");
  assert.ok(!region.includes('id="cb-shell-dock"'),
    "the dock must NOT be inside the Main region — it belongs beneath the centre and the rail both, as a sibling of the region");

  /* The slot body is what occupancy is measured on, so it has to exist for both. */
  for (const id of ["cb-shell-rail", "cb-shell-dock"]) {
    const slot = elementBlock(markup, id === "cb-shell-rail" ? "aside" : "div", id);
    assert.ok(/class="cb-shell-slot-body"/.test(slot),
      `#${id} must carry a .cb-shell-slot-body — occupancy is a question about that element's children`);
    assert.strictEqual(occurrences(slot, "cb-shell-slot-body"), 1, `#${id} must have exactly one slot body`);
  }

  /* Nothing is pre-filled. O2 ships the places, not the things that go in them. */
  const railBody = elementBlock(markup, "aside", "cb-shell-rail");
  assert.ok(/<div class="cb-shell-slot-body"><\/div>/.test(railBody),
    "the rail slot must ship empty — O2 must not ship placeholder Assistant chrome");
  const dockBody = elementBlock(markup, "div", "cb-shell-dock");
  assert.ok(/<div class="cb-shell-slot-body"><\/div>/.test(dockBody),
    "the dock slot must ship empty — O2 must not ship placeholder Terminal chrome");

  /* Both modules must actually be loaded, or every claim above is about a file the
     browser never reads. */
  assert.ok(/<script src="shared-workspace-shell\.js/.test(markup), "the shell declaration must be loaded by index.html");
  assert.ok(/<script src="workspace-shell\.js/.test(markup), "the shell runtime must be loaded by index.html");
  assert.ok(markup.indexOf("shared-workspace-shell.js") < markup.indexOf('src="workspace-shell.js'),
    "the declaration must load before the runtime that reads it");

  /* The Activity drawer is untouched, and remains a sibling of the workspace rather
     than anything the shell owns. */
  assert.ok(/id="automation-activity-drawer"/.test(markup), "the existing Activity drawer must survive O2");
  assert.ok(!workspace.includes("automation-activity-drawer"),
    "the Activity drawer must NOT be absorbed into the shell — it is a temporary overlay, not the persistent dock");

  note("Markup: one shell root, one Main region, one centre, one rail inside the region, one dock outside it, both slots shipped empty");
}

/* ===========================================================================
   6. OVERFLOW OWNERSHIP

   The strictest section, because ambiguity here is what turns three stacked regions
   into nested-page chaos. Each claim names the mechanism, not the appearance.
   =========================================================================== */

function checkOverflowOwnership(sources = SOURCES) {
  const styles = sources.styles;

  const region = ruleBody(styles, ".cb-shell-main");
  assert.ok(/grid-template-columns:minmax\(0,1fr\)/.test(region),
    "the Main region's centre track must be minmax(0,1fr). A plain 1fr lets a wide child inside #main widen the track and put a horizontal scrollbar on the whole page.");
  const withRail = ruleBody(styles, ".cb-shell-main:has(>#cb-shell-rail[data-occupied])");
  assert.ok(/grid-template-columns:minmax\(0,1fr\)var\(--cb-shell-rail-width/.test(withRail),
    "with the rail mounted the centre must keep its minmax(0,1fr) floor and the rail must take a bounded width");

  assert.ok(/\.cb-shell-main>#main\{[^}]*min-width:0/.test(flattenCss(styles)),
    "#main must carry min-width:0 as a grid item, or its content sets the track width");

  const rail = ruleBody(styles, "#cb-shell-rail");
  assert.ok(/position:sticky/.test(rail), "the rail must be sticky so it stays beside the work while the document scrolls");
  assert.ok(/align-self:start/.test(rail),
    "the rail must be align-self:start — a stretched grid item is exactly as tall as its area, leaving position:sticky nothing to move within");
  assert.ok(/overflow-y:auto/.test(rail), "the rail must own its own vertical scrolling");
  assert.ok(/max-height:calc\(100vh/.test(rail),
    "the rail must be bounded to the viewport, or an unbounded Assistant conversation lengthens the page");
  assert.ok(/min-width:0/.test(ruleBody(styles, ".cb-shell-slot")), "a slot must not force the grid wider than its track");

  const dock = ruleBody(styles, "#cb-shell-dock");
  assert.ok(/position:fixed/.test(dock),
    "the dock must be out of document flow — that is the mechanism by which future Terminal volume cannot lengthen the page");
  assert.ok(/max-height:min\(/.test(dock), "the dock's height must be bounded");
  assert.ok(/bottom:0/.test(dock), "the dock must sit at the viewport bottom, not the document bottom");

  const dockBody = ruleBody(styles, "#cb-shell-dock>.cb-shell-slot-body");
  assert.ok(/min-height:0/.test(dockBody),
    "the dock body needs min-height:0 or the flex item refuses to shrink below its content and the max-height is defeated");
  assert.ok(/overflow-y:auto/.test(dockBody), "the dock must own its own vertical scrolling");

  assert.ok(/#workspace\{[^}]*padding-bottom:var\(--cb-dock-reserve/.test(flattenCss(styles)),
    "a fixed dock cannot push anything, so the space it covers must be given back explicitly — otherwise it hides the bottom of the centre workspace");

  note("Overflow: centre keeps minmax(0,1fr) + min-width:0, rail is sticky/bounded/self-scrolling, dock is fixed/bounded/self-scrolling and reserves its space back");
}

/* ===========================================================================
   7. THE NAVIGATION WIDTH HAS ONE SOURCE

   The dock is fixed to the viewport and has to start where the navigation rail ends.
   That number is declared once and read twice. It is checked here rather than left to
   the browser because the failure it prevents — a dock overlapping the navigation, or
   floating away from it at a non-default UI scale — is silent.
   =========================================================================== */

function checkNavigationWidthSource(sources = SOURCES) {
  const flat = flattenCss(sources.styles);
  assert.ok(/#app\{--cb-nav-width:\d+px;grid-template-columns:var\(--cb-nav-width\)minmax\(0,1fr\)\}/.test(flat),
    "the #app grid must consume --cb-nav-width, so the grid and the dock read one declaration");
  assert.ok(/#cb-shell-dock\{[^}]*left:var\(--cb-nav-width/.test(flat),
    "the dock's left edge must be --cb-nav-width, not a literal — the shipped stylesheet contains five different navigation widths and four of them are dead cascade layers");
  assert.ok(/@media\(max-width:900px\)\{#app\{--cb-nav-width:0px\}\}/.test(flat),
    "below 900px #app is display:block and #rail becomes a fixed off-canvas drawer, so the workspace starts at the viewport edge and the inset must be zero");

  /* The rejected alternative must stay rejected. Measuring #workspace and writing the
     result back into a `left` inside #app is wrong rather than merely redundant,
     because #app carries zoom:var(--ui-scale) and the value is then scaled twice. */
  const runtime = codeOnly(sources.runtime);
  assert.ok(!/getBoundingClientRect\(\)\.left/.test(runtime),
    "the runtime must not measure a left edge. #app carries zoom:var(--ui-scale); a post-zoom pixel value written back inside the zoomed subtree is scaled a second time, so the dock misses the navigation at every UI scale except 100%.");
  assert.ok(!/--cb-shell-inset-left/.test(runtime),
    "the measured inset variable was replaced by the declared --cb-nav-width and must not return");
  assert.ok(!/--cb-shell-inset-left/.test(sources.styles),
    "the stylesheet must not still reference the withdrawn inset variable");

  note("Navigation width: --cb-nav-width declared once, consumed by both the #app grid and the dock, zeroed where the navigation becomes an overlay");
}

/* ===========================================================================
   8. EMPTY MEANS ABSENT, AND PRESENCE IS NOT OCCUPANCY

   Both conditions are required to paint a slot. This is what stops retained Assistant
   content from appearing on Settings simply because it survived the trip there.
   =========================================================================== */

function checkEmptyAndPresence(sources = SOURCES) {
  const styles = sources.styles;
  assert.ok(/^display:none/.test(ruleBody(styles, ".cb-shell-slot")),
    "an unmounted slot must render nothing — collapsed-until-mounted is what keeps O2 from shipping dead chrome");

  /* EVERY rule that makes a slot visible must carry both conditions. Asserting that one
     such selector merely EXISTS somewhere in the file is not enough — the same selector
     also appears in the 1180px block where it sets display:none, so a reveal rule could
     drop the presence condition while the string check went on passing. This walks the
     rules instead and inspects each one that actually turns a slot on. */
  const reveals = revealRules(styles);
  for (const id of ["cb-shell-rail", "cb-shell-dock"]) {
    const forSlot = reveals.filter((rule) => rule.selector.includes(`#${id}`));
    assert.ok(forSlot.length > 0, `nothing in the stylesheet ever makes #${id} visible`);
    for (const rule of forSlot) {
      assert.ok(rule.selector.includes('[data-creator-shell="1"]'),
        `#${id} is made visible by \`${rule.selector}\`, which does not require an eligible surface. `
        + "Mounted content is retained across navigation so an Assistant conversation survives a visit to Settings; without this condition it would also be VISIBLE there.");
      assert.ok(rule.selector.includes("[data-occupied]"),
        `#${id} is made visible by \`${rule.selector}\`, which does not require mounted content — that is an empty region painting dead chrome`);
    }
  }

  /* No giant empty rectangle and no promise of a feature that does not exist. Scoped to
     the two slots rather than the whole document: index.html legitimately carries a
     `placeholder` attribute on the canon search box, and a check broad enough to catch
     that is a check that will be loosened rather than obeyed. */
  const forbidden = [/COMING SOON/i, /ACTIVITY TERMINAL/i, /ASSISTANT<|>Assistant</i, /placeholder/i, /empty-state/i];
  const slots = {
    "#cb-shell-rail": elementBlock(sources.markup, "aside", "cb-shell-rail"),
    "#cb-shell-dock": elementBlock(sources.markup, "div", "cb-shell-dock"),
  };
  for (const [id, block] of Object.entries(slots)) {
    /* The aria-label names the region for assistive technology; it is not rendered
       chrome, so it is removed before looking for rendered chrome. */
    const rendered = block.replace(/aria-label="[^"]*"/g, "");
    for (const pattern of forbidden) {
      assert.ok(!pattern.test(rendered),
        `${id} must ship no rendered chrome (${pattern}) — O2 provides the place, not the thing that goes in it`);
    }
    assert.ok(!/>[^<]*[A-Za-z][^<]*</.test(rendered),
      `${id} must contain no text at all — an empty slot that paints a word is a slot the filmmaker will ask about`);
  }

  note("Empty slots: display:none by default; painting requires an eligible surface AND mounted content, so retained content stays invisible on Settings");
}

/* ===========================================================================
   9. NO SHADOW STATE

   Shell presence is a page layout, not production truth. A persisted field would make
   "is the rail open" a property of the film.
   =========================================================================== */

function checkNoShadowState(sources = SOURCES) {
  for (const key of ["declaration", "runtime"]) {
    const code = codeOnly(sources[key]);
    const file = key === "declaration" ? "shared-workspace-shell.js" : "workspace-shell.js";
    for (const forbidden of ["localStorage", "sessionStorage", "fetch(", "dirty(", "queueProjectSave", "XMLHttpRequest"]) {
      assert.ok(!code.includes(forbidden),
        `public/${file} must not use ${forbidden}. Shell presence is a page layout; persisting it would turn the page's shape into production state, and reaching the network would make a layout module a request path.`);
    }
    for (const field of ["assistantRailOpen", "terminalHeight", "creatorWorkspaceLayout", "currentShellMode"]) {
      assert.ok(!code.includes(field), `public/${file} must not introduce the persisted field ${field}`);
    }
  }
  /* The declaration must be incapable of reaching a document at all — it is the half
     that has to be readable from Node, and tests/workspace-shell.js loads it in a realm
     with no DOM. The check is for ACCESS (`document.`, `window.`), not for the word:
     the declaration legitimately contains `scroll: "document"`, which names the scroll
     owner and is exactly the kind of declared fact this module exists to hold. */
  const declarationCode = codeOnly(sources.declaration);
  for (const access of ["document.", "window.", "localStorage", "getElementById"]) {
    assert.ok(!declarationCode.includes(access),
      `the declaration must not reach the DOM (found \`${access}\`); it is loaded from Node with no document present`);
  }
  loadDeclaration(sources.declaration);
  note("No shadow state: neither module stores, persists, fetches or marks the project dirty; the declaration cannot reach the DOM at all");
}

/* ===========================================================================
   10. THE RUNTIME DOES NOT BUILD REGIONS, AND DOES NOT DRIVE THE RENDERER

   Two properties that together are the lifecycle guarantee. The runtime creates no
   element, so there is no path by which a rerender produces a second shell; and
   public/app.js's route() is not modified, so the renderer stays ignorant of the shell.
   =========================================================================== */

function checkRuntimeOwnership(sources = SOURCES) {
  const code = codeOnly(sources.runtime);
  assert.ok(!/createElement|insertAdjacent|appendChild\s*\(\s*document\.create/.test(code),
    "the runtime must not construct shell regions. They are static markup so that 'the rail is the same node it was before the stage changed' is true by construction rather than by convention.");
  assert.ok(/replaceChildren/.test(code),
    "mounting must replace rather than append — two Assistants in one rail is not a state any caller wants, and an API that permits it will eventually produce it");

  for (const signal of ["hashchange", "cinebraid:route-rendered", "load"]) {
    assert.ok(code.includes(signal), `the runtime must react to ${signal} rather than being driven by the renderer`);
  }

  const app = sources.app;
  assert.ok(!/workspace-shell|CineBraidShell|creatorShellState|cb-shell-/.test(app),
    "public/app.js must not know the shell exists. The shell reacts to the render; the renderer does not drive the shell, which is what keeps the centre replaceable without the shell noticing.");

  /* The one production file O2 had to adjust, and the reason, pinned so a later
     refactor cannot silently restore the crash. */
  const activity = sources.activity;
  assert.ok(!/workspace\.insertBefore\(strip,\s*main\)/.test(activity),
    "live-activity.js must not assume #main is a direct child of #workspace — it is now inside the Main region, and insertBefore would throw NotFoundError on a node that is not the parent's child");
  assert.ok(/main\?\.parentNode/.test(activity),
    "the live strip must anchor to #main's actual parent so it survives the shell's nesting");

  note("Ownership: the runtime creates no region and public/app.js never names the shell; the one dependent call in live-activity.js now anchors to #main's real parent");
}

/* ===========================================================================
   11. THE MOUNT CONTRACT IS SMALL AND CLOSED
   =========================================================================== */

function checkMountContract(sources = SOURCES) {
  const code = codeOnly(sources.runtime);
  const exported = ["slot", "slotHasContent", "mountSlot", "clearSlot", "isShellPresent", "syncCreatorShell"];
  const block = code.slice(code.indexOf("window.CineBraidShell"));
  for (const name of exported) {
    assert.ok(new RegExp(`\\b${name}\\b`).test(block), `the shell contract must expose ${name}`);
  }
  assert.ok(/mountableNames\(\)\.includes/.test(code),
    "mountSlot and clearSlot must refuse an undeclared region rather than silently doing nothing recognisable");
  assert.ok(!/eval\(|new Function/.test(code), "the shell must not evaluate code");
  note(`Mount contract: ${exported.length} exported entry points, refusing undeclared regions`);
}

/* ===========================================================================
   RUN
   =========================================================================== */

function runAll(sources = SOURCES) {
  checkDeclaration(sources);
  checkStageAgnostic(sources);
  checkRouteEligibility(sources);
  checkDerivation(sources);
  checkMarkup(sources);
  checkOverflowOwnership(sources);
  checkNavigationWidthSource(sources);
  checkEmptyAndPresence(sources);
  checkNoShadowState(sources);
  checkRuntimeOwnership(sources);
  checkMountContract(sources);
}

if (require.main === module) {
  try {
    runAll();
    console.log(notes.join("\n"));
    console.log("creator workspace shell assertions passed");
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = {
  SOURCES,
  readSource,
  loadDeclaration,
  runAll,
  checkDeclaration,
  checkStageAgnostic,
  checkRouteEligibility,
  checkDerivation,
  checkMarkup,
  checkOverflowOwnership,
  checkNavigationWidthSource,
  checkEmptyAndPresence,
  checkNoShadowState,
  checkRuntimeOwnership,
  checkMountContract,
};

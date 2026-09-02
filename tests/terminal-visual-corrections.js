/* THE A1 VISUAL DOGFOOD CORRECTIONS, HELD BY BEHAVIOUR.
 *
 * A founder-style pass over the real running app produced one reported blocker and four
 * corrections. This suite pins what was actually changed, and — for the reported blocker
 * — pins the thing that was ALREADY TRUE, because that is where the real risk now lies.
 *
 * ON THE BLOCKER. The dock was reported unscrollable. It was not: .cb-shell-slot-body
 * has always been the scroll container, and the Terminal deliberately does not open a
 * second one inside it. The tempting "fix" was to give .cb-terminal-rows its own
 * overflow, which would have nested a scroller inside a scroller and produced a short
 * inner pane that traps the wheel — a real regression introduced to solve an unreal
 * problem. SCROLL-1..3 exist so that mistake cannot be made quietly later.
 *
 * NO PROJECT DATA IS TOUCHED. NO PROVIDER, MODEL OR PAID CALL IS POSSIBLE.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const { render, buildFixture } = require("./render-harness");
const { terminalHtml, assistantHtml } = require("./terminal-view");

let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks += 1; };
const eq = (a, b, message) => { assert.strictEqual(a, b, message); checks += 1; };

/* ---- reading the stylesheet as rules, not as a haystack ------------------- */
/* COMMENTS ARE STRIPPED FIRST, and that is not tidiness. This stylesheet documents
   itself heavily, so a rule is usually preceded by a comment — and a reader that took
   the text before the brace verbatim saw "/* ... *​/ .cb-terminal-row" and matched
   nothing. The rules it then failed to find were the DESKTOP ones. */
const CSS = fs.readFileSync(path.join(ROOT, "public", "styles.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");
/* Every declaration block whose selector LIST contains `selector` exactly, so
   `.a,.b{...}` answers for `.a` and `.foo-bar{...}` never answers for `.foo`.
   Blocks come back in file order, so the first match for a property is the base rule
   and any @media override follows it. */
function declarationsFor(selector) {
  const out = [];
  for (const chunk of CSS.split("}")) {
    const brace = chunk.lastIndexOf("{");
    if (brace < 0) continue;
    const selectors = chunk.slice(0, brace).split(/[{;]/).pop()
      .split(",").map((part) => part.trim().replace(/\s+/g, " "));
    if (selectors.includes(selector)) out.push(chunk.slice(brace + 1));
  }
  /* A SELECTOR THAT MATCHES NOTHING MUST NOT READ AS "THE PROPERTY IS ABSENT".
     Half the checks below are negative — "this must NOT declare its own overflow" —
     and every one of them would pass against a stylesheet where the rule had simply
     been renamed. Silence is the wrong answer here, so it is an error. */
  if (!out.length) {
    throw new Error(`no CSS rule found for "${selector}". Every check against it would pass vacuously; `
      + "the selector has moved and this suite must be updated.");
  }
  return out.join(";");
}

/* ---- building runs the Terminal will actually classify -------------------- */
const FAR = "2099-01-01T00:00:00Z";
const FAILED_STEP = (error) => ({
  "scene-correction:pkg:round-1:generate": {
    key: "scene-correction:pkg:round-1:generate", kind: "generation", status: "failed",
    label: "Correct SCENE-01", error,
    completedAt: "2026-08-26T10:05:00Z", updatedAt: "2026-08-26T10:05:00Z",
  },
});
const failedRun = (id, over = {}) => ({
  id, revision: 1, type: "scene-chain", targetId: "SCENE-01", scope: "correction:pkg",
  label: "Scene continuity correction", status: "failed", stage: "Needs attention",
  summary: "The correction pass could not finish.", logs: [], config: {}, usage: {},
  createdAt: "2026-08-26T10:00:00Z", updatedAt: "2026-08-26T10:05:00Z",
  steps: FAILED_STEP("Provider returned 502."),
  ...over,
});
const runningRun = (id) => ({
  id, revision: 1, type: "shot-chain", targetId: "L1-01", scope: "stills",
  label: "L1-01 stills", status: "running", stage: "Frame A", summary: "Working.",
  runnerId: "r1", leaseExpiresAt: FAR, heartbeatAt: FAR,
  steps: {}, logs: [], config: {}, usage: {},
  createdAt: "2026-08-26T10:00:00Z", updatedAt: "2026-08-26T10:01:00Z",
});

async function realm(runs) {
  const context = (await render("#/production", buildFixture(), { creatorSurfaces: true })).context;
  vm.runInContext(`AUTOMATION_RUNS = ${JSON.stringify(runs)};`, context);
  return context;
}
const countOf = (haystack, needle) => haystack.split(needle).length - 1;

async function main() {
  /* =======================================================================
     BL-1 — THE DOCK SCROLLS, AND IT SCROLLS IN EXACTLY ONE PLACE.
     ======================================================================= */
  /* Dock-scoped by design: the bar and rail slots are not scroll containers, so the
     rule that carries the Terminal is the one under #cb-shell-dock. */
  const slotBody = declarationsFor("#cb-shell-dock>.cb-shell-slot-body");
  ok(/overflow-y:\s*auto/.test(slotBody),
    "SCROLL-1: the dock slot body must be the scroll container for the Terminal");
  ok(/min-height:\s*0/.test(slotBody),
    "SCROLL-1: and must be allowed to shrink below its content, or it never scrolls");

  for (const selector of [".cb-terminal-rows", ".cb-terminal-mount", ".cb-terminal"]) {
    const decls = declarationsFor(selector);
    ok(!/overflow-y:\s*(auto|scroll)/.test(decls),
      `SCROLL-2: ${selector} must not open a second scroller inside the dock slot body`);
  }
  ok(/min-height:\s*0/.test(declarationsFor(".cb-terminal-mount")),
    "SCROLL-3: the mount must have a flex floor of 0 so the ancestor scroller receives the overflow");

  /* =======================================================================
     C-1 — EQUIVALENT FAILURES COLLAPSE. NOTHING ELSE DOES.
     ======================================================================= */
  const six = [1, 2, 3, 4, 5, 6].map((n) => failedRun(`run-dup-${n}`));
  const grouped = terminalHtml(await realm(six));

  eq(countOf(grouped, 'data-cb-group="6"'), 1,
    "GROUP-1: six equivalent failures must present as one group of six");
  eq(countOf(grouped, "cb-terminal-group-count"), 1,
    "GROUP-1: and say the multiplier once rather than repeating the sentence six times");

  for (const n of [1, 2, 3, 4, 5, 6]) {
    ok(grouped.includes(`run:run-dup-${n}`),
      `GROUP-2: run-dup-${n} must still be present as its own row inside the group`);
  }
  eq(countOf(grouped, 'class="cb-terminal-row tone-'), 6,
    "GROUP-2: grouping is presentation — all six underlying rows are still rendered");

  /* G5. A group-level control that dismissed six runs from one click would be a bulk
     authority action wearing a tidy-up's clothes. The six per-row dismisses remain. */
  const summary = grouped.slice(grouped.indexOf("<summary"), grouped.indexOf("</summary>"));
  ok(!/dismissAutomationActivityRun/.test(summary),
    "GROUP-4: the group header must offer no dismiss of its own");
  eq(countOf(grouped, "dismissAutomationActivityRun("), 6,
    "GROUP-4: each underlying run keeps its own dismiss, and there are still six of them");
  for (const n of [1, 2, 3, 4, 5, 6]) {
    ok(grouped.includes(`dismissAutomationActivityRun('run-dup-${n}')`),
      `GROUP-4: and each dismiss still names the single run it dismisses (run-dup-${n})`);
  }

  /* Failures that are not the same failure must not be merged. Two axes, one at a time,
     so a signature that quietly stopped reading one of them is caught. */
  const distinct = [
    failedRun("run-a"),
    failedRun("run-b", { targetId: "SCENE-02" }),
    failedRun("run-c", { steps: FAILED_STEP("Provider returned 429.") }),
  ];
  const spread = terminalHtml(await realm(distinct));
  /* A groupable failure always gets the same container — that is what lets the reconciler
     keep its node as members arrive and leave — so "not collapsed" is three groups of one
     rather than no group at all, and each has its own key. */
  eq(countOf(spread, 'data-cb-group="1"'), 3,
    "GROUP-3: a different target or a different error is a different failure and must not collapse");
  eq(new Set([...spread.matchAll(/data-activity-key="(failure-group:[a-f0-9]+)"/g)].map((m) => m[1])).size, 3,
    "GROUP-3: and each keeps a signature key of its own");
  eq(countOf(spread, 'class="cb-terminal-row tone-'), 3, "GROUP-3: all three stay visible as themselves");

  /* Live and finished work never collapses, however alike it looks: each running row is
     one live thing, and hiding progress behind a multiplier is the opposite of the point. */
  const live = terminalHtml(await realm([runningRun("run-live-1"), runningRun("run-live-2")]));
  eq(countOf(live, "data-cb-group"), 0, "GROUP-5: running rows must never group");

  /* GROUP-6 — THE GROUP HEADER IS A ROW, NOT A PARAGRAPH. Shipped without this, the
     summary fell out of the log's four columns: the multiplier wrapped onto its own
     line and the header carried no tone stripe, so the one line that stands for six
     runs was the least legible line in the dock. */
  const rowGrid = (declarationsFor(".cb-terminal-row").match(/grid-template-columns:([^;]+)/) || [])[1];
  const groupGrid = (declarationsFor(".cb-terminal-group>summary").match(/grid-template-columns:([^;]+)/) || [])[1];
  ok(rowGrid && groupGrid, "GROUP-6: both a row and a group header must declare their columns");
  eq(groupGrid, rowGrid, "GROUP-6: the group header must sit in the same columns as the rows it stands for");
  for (const tone of ["attention", "working", "waiting"]) {
    ok(/border-left-color/.test(declarationsFor(`.cb-terminal-group.tone-${tone}`)),
      `GROUP-6: a ${tone} group must carry the same left tone stripe a ${tone} row does`);
  }
  ok(/white-space:\s*nowrap/.test(declarationsFor(".cb-terminal-group-count")),
    "GROUP-6: the multiplier is the point of the collapse and must not wrap");

  /* GROUP-7 — A LONE FAILURE MUST BE VISIBLE. The container is a <details> so a failure
     signature keeps one DOM node as members arrive and leave. A closed <details> hides its
     content through the browser's own content slot, which author CSS cannot reliably
     reopen — so a single-member group rendered without `open` is counted in the header,
     explained in the footer, and shown nowhere. That is exactly what shipped in the first
     draft of this container and what a screenshot, not a test, caught. */
  const lone = terminalHtml(await realm([failedRun("lone-1")]));
  eq(countOf(lone, 'data-cb-group="1"'), 1, "GROUP-7: one failure is one group of one");
  ok(/<details class="cb-terminal-group[^>]*data-cb-group="1"[^>]*\sopen>/.test(lone),
    "GROUP-7: a single-member group must render open, or its only row is invisible");
  ok(/display:\s*none/.test(declarationsFor('.cb-terminal-group[data-cb-group="1"]>summary')),
    "GROUP-7: and it must show no disclosure furniture, because there is nothing to disclose");
  /* A group that DOES have members to collapse must not be forced open, or the collapse
     the whole feature exists for never happens. */
  const many = terminalHtml(await realm([1, 2, 3].map((n) => failedRun(`many-${n}`))));
  ok(/<details class="cb-terminal-group[^>]*data-cb-group="3"[^>]*>/.test(many)
    && !/<details class="cb-terminal-group[^>]*data-cb-group="3"[^>]*\sopen>/.test(many),
    "GROUP-7: a real group starts collapsed, which is the accepted appearance");

  /* =======================================================================
     C-2 / C-3 — SAY THE QUIET FACT ONCE, AND DO NOT BOUND NOTHING.
     ======================================================================= */
  const idleContext = await realm([]);
  const idleRail = assistantHtml(idleContext);
  eq(countOf(idleRail, "No runs or generation jobs are active."), 1,
    "IDLE-1: at idle the Assistant must state the quiet fact exactly once");
  ok(/Decisions that need you are shown in Production\./.test(idleRail),
    "IDLE-1: while keeping the pointer to where decisions live");
  ok(!/Open Activity/i.test(idleRail), "IDLE-1: and offering no Open Activity control");

  const idleDock = terminalHtml(idleContext);
  ok(!/Showing the \d+ most recent/.test(idleDock),
    "ZERO-1: with nothing recorded there is no bound to explain");
  ok(/Full run history in Reports/.test(idleDock),
    "ZERO-1: the way to the full record is still offered");
  ok(/No recorded activity in this project yet\./.test(idleDock),
    "ZERO-1: and the empty state still says so plainly");

  ok(/Showing the 1 most recent event\./.test(terminalHtml(await realm([runningRun("run-one")]))),
    "ZERO-1: once there IS something to bound, the bound is stated — and in the singular");

  /* =======================================================================
     C-4 — THE SHOT INSPECTOR READS THE SHIPPED CLASSIFIER, NOT A FIXED COLOUR.
     ======================================================================= */
  const context = await realm([]);
  const tone = (run) => vm.runInContext(`window.v670RunTone(${JSON.stringify(run)})`, context);
  eq(tone(runningRun("t")), "active", "TONE-1: a machine-active run is the working tone");
  eq(tone({ status: "awaiting-review" }), "review", "TONE-1: a run parked on a person is not");
  ok(tone(runningRun("t")) !== tone({ status: "awaiting-review" }),
    "TONE-1: so one fixed colour cannot honestly serve both");

  const inspector = fs.readFileSync(path.join(ROOT, "public", "focused-workspaces.js"), "utf8");
  ok(inspector.includes("window.v670RunTone(run)"),
    "TONE-1: the inspector card must take its tone from that classifier rather than a second one");

  const alert = declarationsFor(".focused-inspector-alert");
  ok(!/rgba\(244,\s*170,\s*75/.test(alert),
    "TONE-1: the card must no longer hardcode amber for every run state");
  ok(/--op-working/.test(declarationsFor(".focused-inspector-alert.state-active")),
    "TONE-1: machine-active must paint from the operational working token");
  ok(/--op-waiting/.test(declarationsFor(".focused-inspector-alert.state-review")),
    "TONE-1: and waiting-on-a-person keeps the waiting token");

  /* =======================================================================
     FOUNDER SPOT-CHECK — THE ASSISTANT ENTRY POINT.

     Reported from the founder's own start.bat runtime: the topbar had Add, Idle,
     Saved and Search canon, and no Assistant control at all. The button was in the
     markup and paint() had enabled it; ONE CSS rule hid it, gated on whether there
     was room for a 240px rail beside a 900px centre. Below roughly a 1400px viewport
     there is not — a 1366 laptop, or any 1920 panel at 150% Windows scaling — so the
     deterministic Assistant became unreachable with nothing said about why.

     Room to DOCK and the existence of the Assistant are different questions. These
     checks hold them apart.
     ======================================================================= */

  /* ENTRY-1 — the control is gated on the shell, and on nothing narrower. */
  ok(/display:\s*inline-flex/.test(declarationsFor('#workspace[data-creator-shell="1"] .creator-rail-toggle')),
    "ENTRY-1: the Assistant control must be shown whenever the creator shell is present");
  const toggleRules = CSS.split("}").filter((chunk) => /\.creator-rail-toggle/.test(chunk.split("{")[0] || ""));
  const widthGated = toggleRules.filter((chunk) => /\[data-rail-width\]/.test(chunk.split("{")[0] || ""));
  eq(widthGated.length, 0,
    "ENTRY-1: no rule may gate the Assistant control on there being room to dock the rail");

  /* ENTRY-6 — the one floor, and it is a phone floor rather than a laptop one. Showing
     the control at every width overflowed the topbar below about 500px. The rule that
     takes it away again must therefore sit in the phone regime: a floor that crept back
     up into laptop territory would be the original defect returning by another route. */
  /* Matched on the SCOPED rule, not on ".creator-rail-toggle{display:none". The base
     rule at the top of the control's styling opens with exactly that declaration, and a
     looser pattern reads it as the floor and reports whatever @media block it happens to
     sit after. */
  const WITHDRAWN = /\[data-creator-shell="1"\]\s*\.creator-rail-toggle\s*\{\s*display:\s*none/;
  const floors = CSS.split("@media").filter((block) => WITHDRAWN.test(block))
    .map((block) => Number((block.match(/max-width:\s*(\d+)px/) || [])[1]))
    .filter((width) => width > 0);
  eq(floors.length, 1, "ENTRY-6: the control must be withdrawn in exactly one place, and by a max-width");
  ok(floors[0] <= 760,
    `ENTRY-6: the control must survive every laptop width; it is withdrawn at ${floors[0]}px`);

  /* ENTRY-2 — and the stylesheet agrees with the code. paint() enables the button on
     context.shellPresent; a CSS gate that is stricter than that is how the control went
     missing while every JavaScript-level test still passed. */
  const surfaces = fs.readFileSync(path.join(ROOT, "public", "creator-surfaces.js"), "utf8");
  ok(/syncRailToggle\(context\.shellPresent\)/.test(surfaces),
    "ENTRY-2: the code must enable the control on shell presence");

  /* ENTRY-3 — where it cannot dock, it opens OVER the workspace. Docking a 240px rail
     beside a centre already at its 900px floor would push the centre under the floor
     the shell declares, so at those widths the rail is taken out of flow instead. */
  const overlay = declarationsFor('#workspace[data-creator-shell="1"]:not([data-rail-width]) #cb-shell-rail[data-occupied]');
  ok(/position:\s*fixed/.test(overlay),
    "ENTRY-3: below the docking width the rail must not take width from the centre");
  ok(/display:\s*block/.test(overlay), "ENTRY-3: and must actually be shown there");
  /* The two-column grid stays gated on the docking width, so this cannot become a
     second way to shrink the centre. */
  ok(/\[data-rail-width\]/.test(
    CSS.split("}").find((chunk) => /grid-template-columns:minmax\(0,1fr\) var\(--cb-shell-rail-width/.test(chunk)) || ""),
    "ENTRY-3: the docked two-column layout must remain gated on the docking width");

  /* ENTRY-4 — WITH NO MODEL CONFIGURED, THE DETERMINISTIC ASSISTANT IS STILL A
     SURFACE. The harness realm has no Braidy at all, which is the same condition as
     the founder's assistant.provider = "none": braidyBlock() contributes nothing and
     everything below it must render byte-for-byte as it always did. */
  const withRun = assistantHtml(await realm([runningRun("entry-run")]));
  ok(!/braidy/i.test(withRun), "ENTRY-4: the model block is absent in this realm, as it is with no provider");
  ok(/class="cb-assistant"/.test(withRun), "ENTRY-4: the deterministic Assistant still renders");
  ok(/<header class="cb-assistant-head">[\s\S]*?<b>[^<]+<\/b>/.test(withRun),
    "ENTRY-4: with a headline sentence interpreting the current state");
  ok(/data-cb-section="counts"[\s\S]*?1 running/.test(withRun),
    "ENTRY-4: and useful counts");

  /* ENTRY-5 — and it is still NOT the operational ledger. The Assistant may not regrow
     a per-run feed, and it may not offer an unconditional way into Activity. */
  eq(countOf(withRun, "cb-terminal-row"), 0, "ENTRY-5: no per-run rows may return to the Assistant");
  eq(countOf(withRun, "data-activity-key"), 0, "ENTRY-5: nor per-run activity keys");
  ok(!/Open Activity/i.test(withRun), "ENTRY-5: and no unconditional Open Activity control");

  /* =======================================================================
     ENROLLMENT — ONE AUTHORITATIVE LIST.

     Registering a suite in package.json makes it reachable by name. It does not make it
     RUN. Review found these two suites registered and absent from tests/run-full-check.js,
     which is the difference between a guard and a guard nobody consults: the suite would
     have gone red at some future edit and nothing would have said so.
     ======================================================================= */
  const runner = fs.readFileSync(path.join(ROOT, "tests", "run-full-check.js"), "utf8");
  const enrolled = new Set((runner.match(/"check:[a-z0-9-]+"/g) || []).map((name) => name.slice(1, -1)));
  const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts || {};
  for (const suite of ["check:terminal-visual", "check:terminal-visual-negative",
    "check:shell-ownership", "check:creator-surface-optin"]) {
    ok(scripts[suite], `ENROLL: ${suite} must be a registered script`);
    ok(enrolled.has(suite), `ENROLL: ${suite} is registered but never run by tests/run-full-check.js`);
  }

  console.log(`A1 visual dogfood corrections: ${checks} checks.`);
  console.log("Scroll ownership, failure grouping, idle copy, empty bound, inspector tone,");
  console.log("Assistant entry point reachable with no model configured.");
  console.log("No project data was touched. Provider calls made: 0.");
}

main().catch((error) => { console.error(error); process.exit(1); });

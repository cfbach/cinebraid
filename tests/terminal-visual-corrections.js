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
  eq(countOf(spread, "data-cb-group"), 0,
    "GROUP-3: a different target or a different error is a different failure and must not collapse");
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

  console.log(`A1 visual dogfood corrections: ${checks} checks.`);
  console.log("Scroll ownership, failure grouping, idle copy, empty bound, inspector tone.");
  console.log("No project data was touched. Provider calls made: 0.");
}

main().catch((error) => { console.error(error); process.exit(1); });

/* NEGATIVE CONTROLS FOR THE A1 VISUAL DOGFOOD CORRECTIONS.
 *
 * tests/terminal-visual-corrections.js is green. That is worth exactly nothing until
 * each of its checks has been shown to go red for the defect it names. Every control
 * below reintroduces ONE of the five defects the visual pass found, IN MEMORY, renders
 * the real surfaces from the broken source, and requires the corresponding property to
 * be violated.
 *
 * WHY THESE ARE RENDER CONTROLS. Four of the five defects were things a reader SAW —
 * the same sentence six times, the same sentence twice, a sentence about nothing, a
 * colour that meant nothing. A control that only grepped the source would pass against
 * a renderer that had quietly stopped calling the code it was grepping. So the runs go
 * through collectActivityFacts() -> creatorState() -> terminalMarkup(), and the
 * assertions are about the markup a filmmaker would have been looking at.
 *
 * THE TWO CSS CONTROLS ARE TEXT CONTROLS, and honestly so: Node has no cascade, so the
 * strongest available claim is about the shipped rules themselves. They are the same
 * detector the suite uses, run over a mutated stylesheet.
 *
 * NOTHING IN THE WORKING TREE IS WRITTEN. NO PROJECT DATA IS TOUCHED. NO PROVIDER,
 * MODEL OR PAID CALL IS POSSIBLE.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const { render, buildFixture } = require("./render-harness");
const { terminalHtml, assistantHtml } = require("./terminal-view");

let controls = 0;
const notes = [];

/* LINE ENDINGS ARE NORMALISED BEFORE ANYTHING IS MATCHED. Git hands this worktree CRLF
   on checkout while the anchors below are written with LF, so a multi-line anchor that
   is perfectly correct still finds zero occurrences — and the probe receipt then reports
   a moved anchor when nothing has moved. Normalise once, match once. */
const toLF = (text) => String(text).split("\r\n").join("\n");

/* THE PROBE RECEIPT. A control whose anchor has moved is not a passing control — it is
   a control that stopped mutating anything. It must fail loudly and by name. */
function anchored(rawText, rawNeedle, rawReplacement, label, expected = 1) {
  const text = toLF(rawText);
  const needle = toLF(rawNeedle);
  const replacement = toLF(rawReplacement);
  const hits = text.split(needle).length - 1;
  if (hits !== expected) {
    throw new Error(`probe receipt: ${label} expected ${expected} occurrence(s) of its anchor, found ${hits}. `
      + "The control is no longer mutating the live path and must be rewritten.");
  }
  return text.split(needle).join(replacement);
}

/* A mutateSource hook that rewrites ONE public file and passes every other through. */
const only = (target, needle, replacement, label, expected) => (file, source) =>
  (file === target ? anchored(source, needle, replacement, label, expected) : source);

/* ---- the same fixtures the positive suite uses --------------------------- */
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

const vm = require("vm");
async function realm(runs, mutateSource) {
  const context = (await render("#/production", buildFixture(),
    { creatorSurfaces: true, ...(mutateSource ? { mutateSource } : {}) })).context;
  vm.runInContext(`AUTOMATION_RUNS = ${JSON.stringify(runs)};`, context);
  return context;
}
const countOf = (haystack, needle) => haystack.split(needle).length - 1;

/* A control passes when the property HELD before the mutation and BROKE after it.
   Asserting only the broken half would let a control pass against a check that was
   never true in the first place. */
async function control(label, { before, after }) {
  assert.ok(before, `${label}: the property must hold on the shipped source, or the control proves nothing`);
  assert.ok(after, `${label}: the mutation landed but the check did not notice — the check is not real`);
  controls += 1;
  notes.push(label);
}

const SURFACES = "creator-surfaces.js";

/* ---- the stylesheet detector, lifted from the suite it is proving --------- */
function declarationsFor(css, selector) {
  const out = [];
  for (const chunk of css.replace(/\/\*[\s\S]*?\*\//g, "").split("}")) {
    const brace = chunk.lastIndexOf("{");
    if (brace < 0) continue;
    const selectors = chunk.slice(0, brace).split(/[{;]/).pop()
      .split(",").map((part) => part.trim().replace(/\s+/g, " "));
    if (selectors.includes(selector)) out.push(chunk.slice(brace + 1));
  }
  if (!out.length) {
    throw new Error(`no CSS rule found for "${selector}"; the control cannot prove anything against it.`);
  }
  return out.join(";");
}

async function main() {
  const six = [1, 2, 3, 4, 5, 6].map((n) => failedRun(`run-dup-${n}`));

  /* =====================================================================
     NC-V1 — GROUPING REVERTS. Six equivalent failures print six times.
     ===================================================================== */
  {
    const shipped = terminalHtml(await realm(six));
    const broken = terminalHtml(await realm(six, only(SURFACES,
      "groupRows(rows).map(terminalGroupMarkup)", "rows.map(terminalRow)", "NC-V1")));
    await control("NC-V1 GROUP-1: equivalent failures must collapse", {
      before: countOf(shipped, 'data-cb-group="6"') === 1,
      after: countOf(broken, "data-cb-group") === 0 && countOf(broken, 'class="cb-terminal-row tone-') === 6,
    });
  }

  /* =====================================================================
     NC-V2 — THE GROUP SWALLOWS ITS MEMBERS. This is the failure mode the
     brief singled out: a tidy surface that has actually hidden five runs.
     ===================================================================== */
  {
    const shipped = terminalHtml(await realm(six));
    const broken = terminalHtml(await realm(six, only(SURFACES,
      '<div class="cb-terminal-group-rows">${entry.members.map(terminalRow).join("")}</div>',
      '<div class="cb-terminal-group-rows"></div>', "NC-V2")));
    await control("NC-V2 GROUP-2: every underlying row survives grouping", {
      before: [1, 2, 3, 4, 5, 6].every((n) => shipped.includes(`run:run-dup-${n}`)),
      after: countOf(broken, 'class="cb-terminal-row tone-') === 0
        && !broken.includes("run:run-dup-6"),
    });
  }

  /* =====================================================================
     NC-V3 — THE SIGNATURE STOPS READING THE ERROR, so a 502 and a 429 on the
     same step become "the same failure" and one of them disappears from view.
     ===================================================================== */
  {
    const distinct = [
      failedRun("run-a"),
      failedRun("run-b", { steps: FAILED_STEP("Provider returned 429.") }),
    ];
    const shipped = terminalHtml(await realm(distinct));
    const broken = terminalHtml(await realm(distinct, only(SURFACES,
      `fact.technical && fact.technical.error && fact.technical.error.state === "known"\n        ? fact.technical.error.value : "",`,
      `"",`, "NC-V3")));
    await control("NC-V3 GROUP-3: a different error is a different failure", {
      before: countOf(shipped, "data-cb-group") === 0,
      after: countOf(broken, 'data-cb-group="2"') === 1,
    });
  }

  /* =====================================================================
     NC-V4 — LIVE WORK BECOMES GROUPABLE, and two running jobs hide behind one
     multiplier. Collapsing progress is the opposite of what grouping is for.
     ===================================================================== */
  {
    const live = [runningRun("run-live-1"), runningRun("run-live-2")];
    const shipped = terminalHtml(await realm(live));
    const broken = terminalHtml(await realm(live, only(SURFACES,
      `const GROUPABLE = new Set(["needs-attention"]);`,
      `const GROUPABLE = new Set(["needs-attention", "machine-active"]);`, "NC-V4")));
    await control("NC-V4 GROUP-5: running rows never group", {
      before: countOf(shipped, "data-cb-group") === 0,
      after: countOf(broken, 'data-cb-group="2"') === 1,
    });
  }

  /* =====================================================================
     NC-V5 — A GROUP-LEVEL DISMISS APPEARS. One click, six runs dismissed: a
     bulk authority action wearing a tidy-up's clothes (brief, G5).
     ===================================================================== */
  {
    const shipped = terminalHtml(await realm(six));
    const broken = terminalHtml(await realm(six, only(SURFACES,
      `<span class="cb-terminal-group-count">`,
      `<button type="button" onclick="entry.members.forEach((m) => dismissAutomationActivityRun(m.id))">DISMISS ALL</button><span class="cb-terminal-group-count">`,
      "NC-V5")));
    const summaryOf = (html) => html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
    await control("NC-V5 GROUP-4: the group header offers no dismiss of its own", {
      before: !/dismissAutomationActivityRun/.test(summaryOf(shipped)),
      after: /dismissAutomationActivityRun/.test(summaryOf(broken)),
    });
  }

  /* =====================================================================
     NC-V6 — THE IDLE SENTENCE IS SAID TWICE AGAIN.
     ===================================================================== */
  {
    const shipped = assistantHtml(await realm([]));
    const broken = assistantHtml(await realm([], only(SURFACES,
      `<p>Decisions that need you are shown in Production.</p>`,
      `<p>No runs or generation jobs are active. Decisions that need you are shown in Production.</p>`,
      "NC-V6")));
    await control("NC-V6 IDLE-1: the quiet fact is stated once", {
      before: countOf(shipped, "No runs or generation jobs are active.") === 1,
      after: countOf(broken, "No runs or generation jobs are active.") === 2,
    });
  }

  /* =====================================================================
     NC-V7 — "SHOWING THE 0 MOST RECENT EVENTS" COMES BACK: a bound explained
     for a list that has nothing in it.
     ===================================================================== */
  {
    const shipped = terminalHtml(await realm([]));
    const broken = terminalHtml(await realm([], only(SURFACES,
      "rows.length ? `<span>${esc(`Showing the ${rows.length} most recent event${rows.length === 1 ? \"\" : \"s\"}.`)}</span>` : \"\"",
      "`<span>${esc(`Showing the ${rows.length} most recent event${rows.length === 1 ? \"\" : \"s\"}.`)}</span>`",
      "NC-V7")));
    await control("NC-V7 ZERO-1: nothing recorded means no bound to explain", {
      before: !/Showing the \d+ most recent/.test(shipped),
      after: /Showing the 0 most recent events\./.test(broken),
    });
  }

  /* =====================================================================
     THE TWO STYLESHEET CONTROLS.
     ===================================================================== */
  const css = fs.readFileSync(path.join(ROOT, "public", "styles.css"), "utf8");

  /* NC-V8 — a second scroller opens inside the dock slot body. This is the change I
     nearly shipped to "fix" a blocker that did not exist, and it is exactly what
     SCROLL-2 is standing guard over. */
  {
    const broken = anchored(css,
      ".cb-terminal-rows{display:flex;flex-direction:column;min-width:0}",
      ".cb-terminal-rows{display:flex;flex-direction:column;min-width:0;overflow-y:auto}",
      "NC-V8");
    await control("NC-V8 SCROLL-2: no nested scroller inside the dock slot body", {
      before: !/overflow-y:\s*(auto|scroll)/.test(declarationsFor(css, ".cb-terminal-rows")),
      after: /overflow-y:\s*(auto|scroll)/.test(declarationsFor(broken, ".cb-terminal-rows")),
    });
  }

  /* NC-V11 — the group header falls out of the log's columns, which is exactly how it
     first shipped: the multiplier wrapped under the message instead of sitting at the
     right edge. This is the defect the correction pass caught by LOOKING, so it gets a
     control rather than a promise. */
  {
    const broken = anchored(css,
      ".cb-terminal-group>summary{display:grid;grid-template-columns:56px 96px minmax(0,1fr) minmax(0,auto);",
      ".cb-terminal-group>summary{display:block;",
      "NC-V11");
    const gridOf = (text) => (declarationsFor(text, ".cb-terminal-group>summary").match(/grid-template-columns:([^;]+)/) || [])[1];
    const rowGrid = (declarationsFor(css, ".cb-terminal-row").match(/grid-template-columns:([^;]+)/) || [])[1];
    await control("NC-V11 GROUP-6: the group header sits in the row columns", {
      before: Boolean(rowGrid) && gridOf(css) === rowGrid,
      after: gridOf(broken) !== rowGrid,
    });
  }

  /* NC-V9 — the fixed amber returns, and every run state is painted as a warning. */
  {
    const broken = anchored(css,
      ".focused-inspector-alert{border:1px solid color-mix(in srgb,var(--op-idle) 45%,var(--line))!important}",
      ".focused-inspector-alert{border:1px solid rgba(244,170,75,.45)!important}",
      "NC-V9");
    await control("NC-V9 TONE-1: the inspector card does not hardcode amber", {
      before: !/rgba\(244,\s*170,\s*75/.test(declarationsFor(css, ".focused-inspector-alert")),
      after: /rgba\(244,\s*170,\s*75/.test(declarationsFor(broken, ".focused-inspector-alert")),
    });
  }

  /* NC-V10 — the inspector stops consuming the shipped classifier and goes back to one
     class for every state. */
  {
    const focused = fs.readFileSync(path.join(ROOT, "public", "focused-workspaces.js"), "utf8");
    const broken = anchored(focused,
      '<section class="focused-inspector-alert${typeof window.v670RunTone === "function" ? ` state-${window.v670RunTone(run)}` : ""}">',
      '<section class="focused-inspector-alert">',
      "NC-V10");
    await control("NC-V10 TONE-1: the card takes its tone from the shipped classifier", {
      before: focused.includes("window.v670RunTone(run)"),
      after: !broken.includes("window.v670RunTone(run)"),
    });
  }

  /* NC-V12 — THE ASSISTANT ENTRY POINT GOES BACK BEHIND THE DOCKING WIDTH. This is the
     exact rule the founder hit: the control was in the markup, paint() had enabled it,
     and one stylesheet line removed it from every viewport under roughly 1400px. */
  {
    const broken = anchored(css,
      '#workspace[data-creator-shell="1"] .creator-rail-toggle{display:inline-flex}',
      "#workspace[data-rail-width] .creator-rail-toggle{display:inline-flex}",
      "NC-V12");
    const gatedOnDockingWidth = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").split("}")
      .filter((chunk) => /\.creator-rail-toggle/.test(chunk.split("{")[0] || ""))
      .some((chunk) => /\[data-rail-width\]/.test(chunk.split("{")[0] || ""));
    await control("NC-V12 ENTRY-1: the control is not gated on room to dock", {
      before: !gatedOnDockingWidth(css),
      after: gatedOnDockingWidth(broken),
    });
  }

  /* NC-V13 — the rail stops being taken out of flow where it cannot dock, so opening it
     at 1280 would either push the centre under its declared 900px floor or land the
     Assistant below the whole page. */
  {
    const selector = '#workspace[data-creator-shell="1"]:not([data-rail-width]) #cb-shell-rail[data-occupied]';
    const broken = anchored(css, "display:block;position:fixed;z-index:44;", "display:block;", "NC-V13");
    await control("NC-V13 ENTRY-3: where it cannot dock, the rail leaves the flow", {
      before: /position:\s*fixed/.test(declarationsFor(css, selector)),
      after: !/position:\s*fixed/.test(declarationsFor(broken, selector)),
    });
  }

  /* NC-V14 — the phone floor creeps back up into laptop territory. This is the original
     defect wearing a media query: at max-width:1400px the control would be gone from
     exactly the 1366 and 1280 machines the founder reported it missing from. */
  {
    const broken = anchored(css,
      '@media(max-width:720px){#workspace[data-creator-shell="1"] .creator-rail-toggle{display:none}}',
      '@media(max-width:1400px){#workspace[data-creator-shell="1"] .creator-rail-toggle{display:none}}',
      "NC-V14");
    /* Scoped rule only: the control's BASE rule also opens with display:none, and a
       looser pattern would read that instead and never notice the mutation. */
    const floorOf = (text) => {
      const block = text.replace(/\/\*[\s\S]*?\*\//g, "").split("@media")
        .find((b) => /\[data-creator-shell="1"\]\s*\.creator-rail-toggle\s*\{\s*display:\s*none/.test(b));
      return block ? Number((block.match(/max-width:\s*(\d+)px/) || [])[1]) : 0;
    };
    await control("NC-V14 ENTRY-6: the withdrawal point stays in the phone regime", {
      before: floorOf(css) > 0 && floorOf(css) <= 760,
      after: floorOf(broken) > 760,
    });
  }

  console.log(`A1 visual dogfood negative controls: ${controls} controls, all fired.`);
  for (const note of notes) console.log(`  - ${note}`);
  console.log("Nothing on disk was modified. No project data was touched. Provider calls made: 0.");
}

main().catch((error) => { console.error(error); process.exit(1); });

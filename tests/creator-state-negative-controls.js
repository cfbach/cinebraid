/* Negative controls for tests/creator-state.js.
 *
 * A guarantee nobody has watched fail is a guarantee nobody has tested. Each control
 * below reintroduces ONE specific way O3 could be wrong — IN MEMORY, by mutating a copy
 * of the shipped source, so nothing on disk is touched and no control can be "restored"
 * by a checkout that also discards real work — and then proves the matching assertion
 * actually notices.
 *
 * Each control carries a PROBE RECEIPT: the mutation asserts the text it is replacing
 * was really present at an exact occurrence count, so a control cannot quietly become a
 * no-op when the source is refactored and start "passing" against nothing.
 *
 * EVERY CONTROL BREAKS A DIFFERENT MECHANISM and names the check that has to fail. Two
 * controls that fire for the same reason prove one thing twice and nothing once.
 *
 * THE FOUR THE BRIEF ASKED FOR ARE ALL HERE and are marked: the Assistant recomputing
 * waiting state (C1, C5), the Terminal treating awaiting-review as active (C7), the
 * stage hardcoded instead of read from O1 (C12), and an unknown cost rendered as zero
 * (C8, C9). Rail destruction during a stage switch and a Terminal that grows the page
 * are properties of a live document; their controls are in
 * tests/creator-surfaces-real-browser.py.
 *
 * NO PROJECT DATA IS TOUCHED, NO SERVER IS STARTED, NO REQUEST IS MADE.
 */

const assert = require("assert");

const suite = require("./creator-state.js");
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

const EXERCISED = new Set();
let CONTROL_COUNT = 0;

/* Runs one named check against a mutated source record and requires it to fail. A
   control that passes is a control that has stopped controlling anything. */
function control(label, checkName, patch, expectation) {
  CONTROL_COUNT += 1;
  EXERCISED.add(checkName);
  assert.strictEqual(typeof suite[checkName], "function",
    `${label} names ${checkName}, which tests/creator-state.js does not export`);
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
      /* A control that makes the source throw rather than assert has broken the file
         instead of breaking the guarantee, and proves nothing about the check. */
      throw new Error(`${label}: ${checkName} threw ${error.name} instead of failing an assertion — the mutation broke the module rather than the property.\n${error.message}`);
    }
  }
  assert.ok(failed, `${label}: ${checkName} accepted the broken build. ${expectation}`);
  note(`  ${label} — ${checkName}: ${message}`);
  return message;
}

/* ===========================================================================
   CLASSIFICATION — the section where a silent regression costs the most, because
   both surfaces would be wrong in the same convincing way.
   =========================================================================== */

function classificationControls() {
  note("Classification is delegated, not repeated:");

  /* BRIEF CONTROL: "Assistant recomputes waiting state incorrectly -> test must fail." */
  control("C1 the bucket is decided from the status string instead of the verdicts", "checkRepresentativeStates",
    { projection: mutate(SOURCES.projection,
        `    if (raw.machineActive === true) return { kind: "machine-active", reason: "" };`,
        `    if (raw.machineActive === true || status === "awaiting-review") return { kind: "machine-active", reason: "" };`,
        "C1") },
    "A run parked at a human gate would be counted as machine work again — the exact defect Production-State Honesty removed, reappearing one layer up.");

  control("C2 the attention vocabulary drifts from the shipped predicate", "checkClassificationIsDelegated",
    { projection: mutate(SOURCES.projection,
        `const CREATOR_ATTENTION_RUN_STATUSES = deepFreeze(["failed", "interrupted", "cancelled"]);`,
        `const CREATOR_ATTENTION_RUN_STATUSES = deepFreeze(["failed", "cancelled"]);`,
        "C2") },
    "An interrupted run would reach needs-attention with no reason token and be rendered without the sentence that explains it.");

  control("C3 the activity layer grows a second copy of the attention list", "checkClassificationIsDelegated",
    { activity: mutate(SOURCES.activity,
        "  const attention = runs.filter(v670AttentionRun);",
        `  const attention = runs.filter((run) => ["failed", "interrupted", "cancelled"].includes(run.status));`,
        "C3") },
    "Four copies of this list is how the machine-active predicate drifted from its meaning; the drawer and the Terminal would be free to disagree about which runs are broken.");

  control("C4 an unresolved submission is demoted to a routine settled row", "checkClassificationIsDelegated",
    { projection: mutate(SOURCES.projection,
        `    if (status === "UNRESOLVED") return { kind: "needs-attention", reason: "submission-unresolved" };`,
        `    if (status === "UNRESOLVED") return { kind: "informational", reason: "" };`,
        "C4") },
    "A submission whose outcome is unknown may be running and may have been charged; hiding it invites the one action that buys the shot twice.");
}

/* ===========================================================================
   THE RENDERERS
   =========================================================================== */

function rendererControls() {
  note("The renderers read the projection and nothing else:");

  /* BRIEF CONTROL: the Assistant recomputing rather than reading. */
  control("C5 the Assistant reaches for the run list directly", "checkRenderersReadOnlyTheProjection",
    { surfaces: mutate(SOURCES.surfaces,
        "  function assistantMarkup(state) {\n    const kind = state.headline.kind;",
        "  function assistantMarkup(state) {\n    const live = (typeof AUTOMATION_RUNS === \"undefined\" ? [] : AUTOMATION_RUNS).length;\n    void live;\n    const kind = state.headline.kind;",
        "C5") },
    "A renderer that can read the raw runs can classify them, and two renderers that can classify will eventually classify differently.");

  control("C6 the Terminal asks the machine-active predicate itself", "checkRenderersReadOnlyTheProjection",
    { surfaces: mutate(SOURCES.surfaces,
        "  function terminalRow(fact) {\n    const tone = TERMINAL_TONE[fact.kind] || \"idle\";",
        "  function terminalRow(fact) {\n    const tone = (typeof v670MachineActiveRun === \"function\" && v670MachineActiveRun(fact)) ? \"working\" : TERMINAL_TONE[fact.kind] || \"idle\";",
        "C6") },
    "The Terminal would be answering \"is this running\" for itself instead of reading the one answer both surfaces share.");

  /* BRIEF CONTROL: "Terminal treats awaiting-review as active -> fail." */
  control("C7 the Terminal labels an approval gate as running", "checkTerminalRendering",
    { surfaces: mutate(SOURCES.surfaces,
        `    "waiting-human:approval-required": "AWAITING REVIEW",`,
        `    "waiting-human:approval-required": "RUNNING",`,
        "C7") },
    "A gate labelled RUNNING is the original dogfood defect: the machine has stopped and the screen says it has not.");
}

/* ===========================================================================
   MONEY
   =========================================================================== */

function costControls() {
  note("Cost is read, never invented:");

  /* BRIEF CONTROL: "unknown cost rendered as zero -> fail." */
  control("C8 an unknown cost is rendered as a zero amount", "checkTerminalRendering",
    { surfaces: mutate(SOURCES.surfaces,
        `    if (cost.state === "unknown") return "cost not priced";\n    return "cost not recorded";`,
        `    if (cost.state === "unknown") return "est $0.00";\n    return "est $0.00";`,
        "C8") },
    "$0.00 is a claim about what a render cost. A metered job with no applicable rate and a row that predates cost recording are both unknown, and neither is free.");

  control("C9 a missing accounting record becomes an amount", "checkCostSemantics",
    { projection: mutate(SOURCES.projection,
        `    if (!estimate) return deepFreeze({ state: "not-recorded", amount: null, unit: "", basis: "" });`,
        `    if (!estimate) return deepFreeze({ state: "not-recorded", amount: 0, unit: "usd", basis: "" });`,
        "C9") },
    "An amount of 0 on an unrecorded row is what every downstream formatter will print as $0.00, however careful the formatter is.");

  control("C10 the browser reaches for a configured rate", "checkCostSemantics",
    { projection: mutate(SOURCES.projection,
        "  function creatorCostFact(job) {\n    const accounting",
        "  function creatorCostFact(job) {\n    const estimatedCostPerImage = job && job.rate;\n    void estimatedCostPerImage;\n    const accounting",
        "C10") },
    "A historical estimate recomputed from today's rate silently rewrites what a project spent every time somebody edits Settings.");
}

/* ===========================================================================
   THE STAGE
   =========================================================================== */

function stageControls() {
  note("The stage comes from O1:");

  control("C11 a recommendation is invented where the model declared none", "checkRepresentativeStates",
    { projection: mutate(SOURCES.projection,
        `    if (!stage.recommendedNext)\n      return { kind: "none", reason: "no-honest-recommendation", stageId: stage.id, label: "" };`,
        `    if (!stage.recommendedNext && stage.next.length)\n      return { kind: "stage", reason: "declared-next-stage", stageId: stage.next[0], label: "" };`,
        "C11") },
    "recommendedNext === \"\" is the declared model refusing to guess for an undecided shot. Filling it in makes the rail confident about a decision the filmmaker has not made.");

  /* BRIEF CONTROL: "current stage hardcoded instead of O1 -> fail." */
  control("C12 the runtime works the stage out for itself", "checkStageIsConsumed",
    { surfaces: mutate(SOURCES.surfaces,
        "      const facts = shotStageModelFacts(shot, takes);",
        "      const facts = { requiredFramesApproved: (shot.keyframes || []).every((frame) => frame.winner), frameApprovedCount: (shot.keyframes || []).length };",
        "C12") },
    "A second assembler over the same shot is a second opinion about what stage the filmmaker is in, and the taskbar and the rail would drift apart exactly as five stage lists once did.");
}

/* ===========================================================================
   THE HISTORY POLICY
   =========================================================================== */

function historyControls() {
  note("The history window is bounded and says so:");

  control("C13 running work is truncated to fit the window", "checkHistoryPolicy",
    { projection: mutate(SOURCES.projection,
        "    const working = facts.filter((fact) => fact.kind === \"machine-active\").sort(byRecency);",
        "    const working = facts.filter((fact) => fact.kind === \"machine-active\").sort(byRecency).slice(0, 5);",
        "C13") },
    "Capping what is running is a silent lie about the machine — the one thing a production surface must never be wrong about.");

  control("C14 omissions are dropped instead of reported", "checkHistoryPolicy",
    { projection: mutate(SOURCES.projection,
        "      omitted: {\n        attention: Math.max(0, attentionAll.length - attention.length),\n        recent: Math.max(0, recentAll.length - recent.length),\n      },",
        "      omitted: { attention: 0, recent: 0 },",
        "C14") },
    "A bounded surface that truncates silently reads as a complete one, which is worse than showing nothing.");
}

/* ===========================================================================
   ISOLATION AND THE SHELL
   =========================================================================== */

function isolationControls() {
  note("Nothing is stored, polled, spent or reached into:");

  control("C15 the surfaces install a poll of their own", "checkNoPersistenceNoNetworkNoPaid",
    { surfaces: mutate(SOURCES.surfaces,
        "  window.CineBraidCreatorSurfaces = {",
        "  setInterval(paint, 3500);\n  window.CineBraidCreatorSurfaces = {",
        "C15") },
    "Activity is already polled by public/live-activity.js; a second clock over the same data is how two surfaces start showing different moments of the same production.");

  control("C16 the Assistant writes its interpretation back into the project", "checkNoPersistenceNoNetworkNoPaid",
    { surfaces: mutate(SOURCES.surfaces,
        "    STALE = false;\n    const state = projection();",
        "    STALE = false;\n    const state = projection();\n    if (context.hasProject && false) P.assistantHeadline = state.headline.kind;",
        "C16") },
    "An interpretation persisted into a project has become production state, and the next reader cannot tell it from something a human decided.");

  control("C17 the rail grows a paid generation button", "checkAssistantRendering",
    { surfaces: mutate(SOURCES.surfaces,
        /* Anchored on the footer's opening tag alone. A1 removed the button this
           control used to mutate, and the replacement must not carry a `${...}` of
           its own — this file is JavaScript, and the surrounding template would
           interpolate it here rather than leaving it in the source being broken. */
        `<footer class="cb-assistant-foot">`,
        `<footer class="cb-assistant-foot"><button type="button" class="cb-assistant-action" onclick="openFalGenerationModal('frame','','')">Generate</button>`,
        "C17") },
    "A narration surface that can spend money turns an interpretation of state into a purchase, one click from a sentence CineBraid wrote itself.");

  control("C18 the surfaces set the shell's own reservation", "checkShellIntegration",
    { surfaces: mutate(SOURCES.surfaces,
        "  function remeasureShell() {\n    const shell = window.CineBraidShell;",
        "  function remeasureShell() {\n    document.documentElement.style.setProperty(\"--cb-dock-reserve\", \"200px\");\n    const shell = window.CineBraidShell;",
        "C18") },
    "Two writers for one measurement is how the dock and the space it reserves come to disagree, and the symptom — a dead band or a hidden control — appears nowhere near the cause.");

  /* C19 drove checkActivityStripStaysOutOfTheGrid, which went with the floating
     activity strip in Batch 2 Slice 1. Its replacement guards the rule that changed
     in its place: the runtime may persist the two PANEL preferences and nothing
     else. Relaxing a count from one to two without a control is how a third value
     arrives unnoticed. */
  control("C19 the runtime persists a third value beside the two panel preferences", "checkNoPersistenceNoNetworkNoPaid",
    { surfaces: mutate(SOURCES.surfaces,
        /* A1 gave the collapsed preference a single writer, because the expand verb
           the retired drawer's callers now use sets the same key. The control follows
           it there: one writer is exactly what makes a third value visible. */
        `    try { localStorage.setItem(TERMINAL_COLLAPSED_KEY, next ? "1" : "0"); } catch {}`,
        `    try { localStorage.setItem(TERMINAL_COLLAPSED_KEY, next ? "1" : "0"); } catch {}\n    try { localStorage.setItem("cinebraid-creator-last-seen-run", "run-1"); } catch {}`,
        "C19") },
    "A panel preference is not production state, but a remembered run id is: the moment the rail persists what it saw, two readers of the same activity can disagree about what is new.");

  control("C20 a generation job is given an attempt number it never recorded", "checkDeclaredLimitations",
    { projection: mutate(SOURCES.projection,
        `      attempt: raw.attemptApplicable === false\n        ? creatorNotApplicable("job-attempt")\n        : creatorKnownCount(raw.attempt),`,
        `      attempt: creatorKnownCount(raw.attempt),`,
        "C19") },
    "A retry is a new job row with a new id; presenting several rows as one attempt sequence invents a linkage the ledger does not record.");
}

/* ===========================================================================
   RUN
   =========================================================================== */

function main() {
  classificationControls();
  rendererControls();
  costControls();
  stageControls();
  historyControls();
  isolationControls();

  /* Coverage, read off what actually ran rather than from a hand-maintained list that
     can drift away from it. A check with no control is a check that has never been
     watched fail, and the two here are named with their reason. */
  const exported = Object.keys(suite).filter((name) => name.startsWith("check"));
  const uncontrolled = exported.filter((name) => !EXERCISED.has(name));
  assert.deepStrictEqual(uncontrolled.sort(), ["checkProjectionContract"],
    `every exported check needs a control except the ones deliberately excused; uncontrolled: ${uncontrolled.join(", ")}`);
  note("");
  note(`checkProjectionContract is deliberately uncontrolled: it asserts freezing, input immutability and token closure, each of which is already the mechanism another control breaks through — C1 and C11 both run through its normalisation, and a mutation that unfroze the output would fail every check at once rather than that one.`);
  note(`${CONTROL_COUNT} controls, ${EXERCISED.size} of ${exported.length} exported checks driven to failure.`);
}

try {
  main();
  console.log(notes.join("\n"));
  console.log("creator-state negative controls passed");
} catch (error) {
  console.error(error);
  process.exit(1);
}

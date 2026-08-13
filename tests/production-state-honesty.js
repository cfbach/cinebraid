/* Production-state honesty: is CineBraid truthful about what is happening RIGHT NOW?
 *
 * P4 made CineBraid truthful about MEDIA. Generation Truth made it truthful about what
 * it would GENERATE. This suite guards the third question a filmmaker asks a running
 * production tool - "is the machine working, or is it waiting for me?" - and the four
 * places the shipped build answered it wrongly.
 *
 * Every defect below was reproduced in a real Chromium before it was repaired; the
 * receipts are in docs/architecture/CINEBRAID_PRODUCTION_STATE_HONESTY_2026-08-13.md.
 *
 *   A  AWAITING-REVIEW COUNTED AS ACTIVE. The literal ["running", "awaiting-review"]
 *      appeared in six readers across public/live-activity.js - the toolbar count, the
 *      docked strip, the drawer heading, the ACTIVE NOW section, the row spinner and
 *      the poll gate. A run parked at a human approval gate therefore raised the global
 *      Active count, sat in ACTIVE NOW and span, while nothing was running at all.
 *
 *   B  THE CLOCK NEVER STOPPED. v641ElapsedLabel falls back to Date.now() when a step
 *      carries no completedAt, and v627PauseForHumanReview parked a step at
 *      `needs-review` without stamping one. Finished machine work counted upward for
 *      as long as the director took to look at it.
 *
 *   E  AN ABANDONED RUN LOOKED BUSY. Found while mapping A: a run whose tab closed
 *      stays at status `running` with a lapsed lease. Nobody is driving it - which
 *      v626StatusLabel already knew, and said as READY TO RESUME - yet every aggregate
 *      counted it as live work and span a spinner over it indefinitely.
 *
 *   D  A VISIBLE BLOCKING ATTEMPT WAS INVISIBLE TO ITS REVIEWER. The shot-level console
 *      DISPLAYED every attempt on the shot, GATED itself on that full list, and then
 *      asked a reader that returns only attempts with no blockingFrameId. On a shot
 *      whose attempts all belonged to frames it offered REVIEW ALL WITH AI and answered
 *      the click with "Add at least one blocking attempt first" - the dogfood symptom.
 *
 * WHAT IS NOT TESTED HERE. Element detachment across the 3500 ms drawer refresh needs
 * a DOM that parses HTML and tracks node identity; tests/render-harness.js FakeElement
 * does neither. This suite guards the CONTRACT that makes reconciliation possible -
 * every drawer row carries a stable data-activity-key - and
 * tests/production-state-honesty-real-browser.py proves the behaviour in Chromium.
 *
 * NO PAID CALL AND NO PROVIDER CALL. Everything runs against the render harness.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const { render, buildFixture } = require("./render-harness");

const readLF = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
const notes = [];
const note = (line) => notes.push(line);

function seconds(offset) {
  return new Date(Date.now() + offset * 1000).toISOString();
}

/* The four run records every activity surface has to tell apart. Their shapes are the
   ones the writers really persist: v627PauseForHumanReview leaves `awaiting-review`
   with a `needs-review` step, and a lease is a runnerId plus an expiry. */
function runFixtures() {
  return [
    {
      id: "run-waiting", type: "shot-chain", targetId: "L1-01", scope: "stills",
      label: "Parked at a human gate", status: "awaiting-review", stage: "Approve Frame A",
      phase: "human-review", summary: "CineBraid paused before approval.",
      createdAt: seconds(-600), updatedAt: seconds(-540), completedAt: "",
      runnerId: "", leaseExpiresAt: "",
      current: { stepKey: "frame:frame-a:round-1:review" },
      config: { maxImages: 21 }, usage: {},
      steps: { "frame:frame-a:round-1:review": {
        key: "frame:frame-a:round-1:review", kind: "frame-review", status: "needs-review",
        label: "Frame A review", startedAt: seconds(-600), updatedAt: seconds(-540) } },
      logs: [],
    },
    {
      id: "run-orphan", type: "shot-chain", targetId: "L1-02", scope: "stills",
      label: "Abandoned by a closed tab", status: "running", stage: "Generating Frame A",
      summary: "", createdAt: seconds(-1200), updatedAt: seconds(-900), completedAt: "",
      runnerId: "runner-that-went-away", leaseAcquiredAt: seconds(-1200), leaseExpiresAt: seconds(-540),
      current: { stepKey: "frame:frame-a:round-1:generate" }, config: { maxImages: 21 }, usage: {},
      steps: { "frame:frame-a:round-1:generate": {
        key: "frame:frame-a:round-1:generate", kind: "generation", status: "running",
        label: "Generate Frame A", startedAt: seconds(-1200), updatedAt: seconds(-900) } },
      logs: [],
    },
    {
      id: "run-live", type: "shot-chain", targetId: "L1-03", scope: "stills",
      label: "Genuinely running elsewhere", status: "running", stage: "Generating",
      summary: "", createdAt: seconds(-120), updatedAt: seconds(-30), completedAt: "",
      runnerId: "runner-alive", leaseAcquiredAt: seconds(-120), leaseExpiresAt: seconds(240),
      current: { stepKey: "frame:frame-a:round-1:generate" }, config: { maxImages: 21 }, usage: {},
      steps: { "frame:frame-a:round-1:generate": {
        key: "frame:frame-a:round-1:generate", kind: "generation", status: "running",
        label: "Generate Frame A", startedAt: seconds(-120), updatedAt: seconds(-30) } },
      logs: [],
    },
    {
      id: "run-failed", type: "scene-chain", targetId: "SC-01", scope: "correction:pkg",
      label: "Dismissable failure", status: "failed", stage: "Needs attention",
      summary: "Correction failed.", createdAt: seconds(-2000), updatedAt: seconds(-1900),
      completedAt: "", current: { stepKey: "scene-correction:pkg:round-1:generate" },
      config: { maxImages: 9 }, usage: {},
      steps: { "scene-correction:pkg:round-1:generate": {
        key: "scene-correction:pkg:round-1:generate", kind: "generation", status: "failed",
        label: "Generate correction", error: "Missing source provenance.",
        startedAt: seconds(-2000), updatedAt: seconds(-1900) } },
      logs: [],
    },
  ];
}

/* A shot whose ONLY blocking attempt belongs to Frame B - the dogfood shape. */
function framedBlockingFixture() {
  const project = buildFixture();
  /* The base fixture's animatic frame is also a blocking row (blockingMediaRows takes
     blocking-frame, storyboard and animatic-frame alike) and carries no frame binding,
     so it would sit in the opening pool. Unlink it from the shot to get the shape the
     dogfood pass hit: every blocking attempt on this shot belongs to a frame. */
  for (const asset of project.mediaAssets) {
    asset.links = (asset.links || []).filter((link) => !(link.targetType === "shot" && link.targetId === "L1-01"));
  }
  project.mediaAssets.push({
    id: "blocking-frame-b",
    file: "L1-01_FRAME_B_BLOCKING.png",
    storagePath: "shots/L1-01/blocking/L1-01_FRAME_B_BLOCKING.png",
    title: "L1-01 - Frame B blocking",
    kind: "image",
    links: [{ id: "blocking-link-b", targetType: "shot", targetId: "L1-01", role: "blocking-frame",
              blockingState: "returned", blockingVersion: "B01", blockingFrameId: "frame-b",
              generationInput: false, order: 1 }],
  });
  return project;
}

async function withRuns(hash = "#/shot/L1-01", project = buildFixture(), storage = undefined) {
  const view = await render(hash, project, storage ? { storage } : {});
  view.context.AUTOMATION_RUNS = runFixtures();
  vm.runInContext(`AUTOMATION_RUNS = ${JSON.stringify(runFixtures())};`, view.context);
  return view;
}

async function main() {
  /* ---------------------------------------------------------------------------
     1 / 4 / E  ONE PREDICATE DECIDES WHO IS ACTIVE
     --------------------------------------------------------------------------- */
  const view = await withRuns();
  const partition = vm.runInContext(`(() => ({
    active: AUTOMATION_RUNS.filter(v670MachineActiveRun).map((run) => run.id),
    waiting: AUTOMATION_RUNS.filter(v670WaitingForHumanRun).map((run) => run.id),
    unsettled: AUTOMATION_RUNS.filter(v670RunUnsettled).map((run) => run.id),
  }))()`, view.context);

  assert.deepStrictEqual(Array.from(partition.active).map(String), ["run-live"],
    "only a run whose lease is live may count as machine-active");
  assert.deepStrictEqual(Array.from(partition.waiting).map(String).sort(), ["run-orphan", "run-waiting"],
    "a human gate and a lapsed lease are both waiting for the director");
  assert.deepStrictEqual(Array.from(partition.unsettled).map(String).sort(), ["run-live", "run-orphan", "run-waiting"],
    "the poll gate must stay open for waiting work as well as running work");
  note("machine-active is one predicate: leased and running, nothing else");

  const status = vm.runInContext("v6602ActivityStatus()", view.context);
  assert.strictEqual(status.label, "Activity · 1 active",
    `the aggregate must count only live work, got ${JSON.stringify(status.label)}`);
  assert.strictEqual(status.tone, "active", "live work keeps the active tone");
  note(`global status with 1 running + 2 stopped runs: ${JSON.stringify(status.label)}`);

  /* Nothing running, one approval pending: the aggregate must say so rather than
     falling through to a failure count the director cannot act on. */
  const waitingOnly = await render("#/shot/L1-01", buildFixture());
  vm.runInContext(`AUTOMATION_RUNS = ${JSON.stringify(runFixtures().filter((run) => run.id !== "run-live"))};`, waitingOnly.context);
  const waitingStatus = vm.runInContext("v6602ActivityStatus()", waitingOnly.context);
  assert.strictEqual(waitingStatus.tone, "waiting",
    `a pending approval must have its own tone, got ${JSON.stringify(waitingStatus.tone)}`);
  assert(waitingStatus.label.includes("waiting for you"),
    `the toolbar must name the wait in the director's terms, got ${JSON.stringify(waitingStatus.label)}`);
  assert(!/\bactive\b/.test(waitingStatus.label),
    `nothing is running, so the word "active" must not appear: ${JSON.stringify(waitingStatus.label)}`);
  note(`with no machine work: ${JSON.stringify(waitingStatus.label)}`);

  /* ---------------------------------------------------------------------------
     2  WAITING FOR YOU IS ITS OWN SECTION, AND IT DOES NOT SPIN
     --------------------------------------------------------------------------- */
  const drawerHtml = vm.runInContext(
    `V641_ACTIVITY_DRAWER_OPEN = true; v641RenderActivityDrawer();
     document.getElementById("automation-activity-drawer").innerHTML`, view.context);
  const activeSection = drawerHtml.split("ACTIVE NOW")[1].split("WAITING FOR YOU")[0];
  const waitingSection = drawerHtml.split("WAITING FOR YOU")[1].split("PREVIOUS FAILURES")[0];

  assert(drawerHtml.includes("WAITING FOR YOU"), "the drawer must separate work waiting on a person");
  assert(activeSection.includes("run-live"), "ACTIVE NOW must keep genuinely running work");
  assert(!activeSection.includes("run-waiting"), "an approval gate must leave ACTIVE NOW");
  assert(!activeSection.includes("run-orphan"), "an abandoned run must leave ACTIVE NOW");
  assert(waitingSection.includes("run-waiting") && waitingSection.includes("run-orphan"),
    "both stopped runs belong in WAITING FOR YOU");
  assert(!waitingSection.includes('class="spin"'),
    "nothing waiting on a person may render a spinner");
  assert(waitingSection.includes("Waiting for you"),
    "a waiting row must say so in words, not only by placement");
  assert(waitingSection.includes("Resume Run"),
    "an abandoned run must name the action that restarts it");
  assert(drawerHtml.includes("1 operation active"),
    "the drawer heading must count only live work");
  note("the drawer separates ACTIVE NOW from WAITING FOR YOU, and only the former spins");

  /* ---------------------------------------------------------------------------
     3 / 4  THE CLOCK STOPS AT THE HUMAN GATE AND NOWHERE ELSE
     --------------------------------------------------------------------------- */
  const clocks = vm.runInContext(`(() => {
    const parked = AUTOMATION_RUNS.find((run) => run.id === "run-waiting").steps["frame:frame-a:round-1:review"];
    const live = AUTOMATION_RUNS.find((run) => run.id === "run-live").steps["frame:frame-a:round-1:generate"];
    const failed = AUTOMATION_RUNS.find((run) => run.id === "run-failed").steps["scene-correction:pkg:round-1:generate"];
    return {
      parkedEnd: v670StepEndTimestamp(parked),
      parkedUpdatedAt: parked.updatedAt,
      liveEnd: v670StepEndTimestamp(live),
      parkedLabel: v670StepElapsedLabel(parked),
      failedEnd: v670StepEndTimestamp(failed),
    };
  })()`, view.context);

  assert.strictEqual(clocks.parkedEnd, clocks.parkedUpdatedAt,
    "a step parked at a gate with no completedAt must freeze at the last runner touch");
  assert.strictEqual(clocks.liveEnd, "",
    "a running step must keep measuring against now");
  assert(/^\d\d:\d\d$/.test(clocks.parkedLabel), "the frozen label must still read as a duration");
  assert.notStrictEqual(clocks.failedEnd, "", "a failed step must not keep counting either");

  /* The same step, asked twice across real time. The frozen one may not move; the
     running one must. */
  const before = vm.runInContext(`(() => {
    const parked = AUTOMATION_RUNS.find((run) => run.id === "run-waiting").steps["frame:frame-a:round-1:review"];
    const live = AUTOMATION_RUNS.find((run) => run.id === "run-live").steps["frame:frame-a:round-1:generate"];
    return { parked: v670StepElapsedLabel(parked), live: v670StepElapsedLabel(live) };
  })()`, view.context);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const after = vm.runInContext(`(() => {
    const parked = AUTOMATION_RUNS.find((run) => run.id === "run-waiting").steps["frame:frame-a:round-1:review"];
    const live = AUTOMATION_RUNS.find((run) => run.id === "run-live").steps["frame:frame-a:round-1:generate"];
    return { parked: v670StepElapsedLabel(parked), live: v670StepElapsedLabel(live) };
  })()`, view.context);
  assert.strictEqual(before.parked, after.parked,
    `the human-gate clock must not advance (${before.parked} -> ${after.parked})`);
  assert.notStrictEqual(before.live, after.live,
    `genuinely running work must keep counting (${before.live} -> ${after.live})`);
  note(`elapsed across 1.1s: parked ${before.parked} -> ${after.parked}, running ${before.live} -> ${after.live}`);

  /* THE WRITER, not only the reader. A step parked by the real pause helper must
     record when its machine work ended, so a fresh run needs no reader fallback. */
  const writer = await render("#/shot/L1-01", buildFixture(), {
    /* The run store, echoing back what was written - the harness default answers
       {ok:true} with no run body, which is not the shape v626SaveRun reads. */
    fetch: async (url, options, respond) =>
      String(url).startsWith("/api/automation/runs") && options.method === "PUT"
        ? respond({ run: JSON.parse(options.body) })
        : null,
  });
  const stamped = await vm.runInContext(`(async () => {
    const run = { id: "writer-run", revision: 1, type: "shot-chain", targetId: "L1-01", scope: "stills",
      status: "running", stage: "", steps: {}, logs: [], usage: {}, config: {}, current: {} };
    const step = v626Step(run, "frame:frame-a:round-1:review", "frame-review", "Frame A review");
    step.startedAt = new Date(Date.now() - 30000).toISOString();
    try { await v627PauseForHumanReview(run, step, "Approve Frame A"); }
    catch (error) { if (!error.reviewRequired) throw error; }
    return { status: step.status, completedAt: step.completedAt, runStatus: run.status };
  })()`, writer.context);
  assert.strictEqual(stamped.status, "needs-review", "the pause helper still parks the step");
  assert.strictEqual(stamped.runStatus, "awaiting-review", "the pause helper still parks the run");
  assert(stamped.completedAt, "the pause helper must stamp when machine work ended");
  note("v627PauseForHumanReview now records the machine-stop boundary it creates");

  /* The scene child-review gate is the second writer of the same pause. */
  const sceneSource = readLF("public/scene-automation.js");
  assert(/step\.status = "needs-review"; step\.completedAt = step\.completedAt \|\| v626Now\(\)/.test(sceneSource),
    "the scene child-review gate must stamp its machine-stop boundary too");

  /* ---------------------------------------------------------------------------
     5  EVERY DRAWER ROW IS ADDRESSABLE, WHICH IS WHAT LETS THE PAINTER RECONCILE
     --------------------------------------------------------------------------- */
  const rowKeys = [...drawerHtml.matchAll(/data-activity-key="([^"]+)"/g)].map((match) => match[1]);
  const runRows = [...drawerHtml.matchAll(/data-run-id="([^"]+)"/g)].map((match) => match[1]);
  assert(rowKeys.length >= runRows.length && runRows.length > 0,
    "every drawer run row must carry a reconciliation key");
  for (const id of runRows) assert(rowKeys.includes(`run:${id}`), `run row ${id} is missing its key`);
  assert.strictEqual(new Set(rowKeys).size, rowKeys.length,
    "reconciliation keys must be unique or the painter would collapse rows");
  const activitySource = readLF("public/live-activity.js");
  assert(activitySource.includes("v670PaintDrawer(drawer, shell)"),
    "the drawer must paint through the reconciling painter");
  assert(!/drawer\.innerHTML = `<div class="automation-drawer-shell"/.test(activitySource),
    "the drawer must not go back to replacing its whole innerHTML on every poll");
  assert(activitySource.includes("v670DomCanReconcile"),
    "the painter must probe the DOM rather than assume it can reconcile");
  note(`drawer rows carry ${rowKeys.length} unique reconciliation keys`);

  /* ---------------------------------------------------------------------------
     5b  THE PATCH ITSELF: does it change what changed, and keep what did not?

     v670PatchElement is the whole guarantee - "the row survives its own content
     changing" - so it is exercised directly here against a minimal node model rather
     than inferred from markup. The model implements exactly the DOM surface the
     function uses, which is also a statement of how small that surface is.

     The behavioural proof in a real browser lives in the real-browser suite; this is
     the algorithm's own checklist, including the ways a patcher silently goes wrong:
     stale text, stale attributes, attributes that should have been REMOVED, and
     structure that changed shape.
     --------------------------------------------------------------------------- */
  const patch = view.context.v670PatchElement;
  assert.strictEqual(typeof patch, "function", "the drawer painter must expose its element patcher");

  let nodeSeq = 0;
  const text = (value) => ({ id: ++nodeSeq, nodeType: 3, nodeName: "#text", nodeValue: value, childNodes: [] });
  function el(tagName, attributes = {}, children = []) {
    const node = {
      id: ++nodeSeq, nodeType: 1, nodeName: tagName.toUpperCase(), tagName: tagName.toUpperCase(),
      attributes: new Map(Object.entries(attributes)), childNodes: [...children],
      getAttributeNames() { return [...this.attributes.keys()]; },
      getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; },
      hasAttribute(name) { return this.attributes.has(name); },
      setAttribute(name, value) { this.attributes.set(name, String(value)); },
      removeAttribute(name) { this.attributes.delete(name); },
      appendChild(child) { this.childNodes.push(child); return child; },
      removeChild(child) { this.childNodes = this.childNodes.filter((row) => row !== child); return child; },
      replaceChild(next, previous) {
        this.childNodes = this.childNodes.map((row) => (row === previous ? next : row));
        return previous;
      },
    };
    return node;
  }
  const flatten = (node) => node.nodeType === 3 ? String(node.nodeValue)
    : node.childNodes.map(flatten).join("");

  /* A run row: a header with a label, a paragraph, and a footer holding the control. */
  const button = el("button", { class: "ghost-btn", onclick: "dismiss('a')" }, [text("DISMISS")]);
  const label = el("b", {}, [text("Dismissable failure")]);
  const paragraph = el("p", { class: "note" }, [text("Generate correction")]);
  const live = el("article", { class: "automation-drawer-run state-failed", "data-activity-key": "run:a", "data-stale": "1" },
    [el("header", {}, [label]), paragraph, el("footer", {}, [button])]);

  const nextButton = el("button", { class: "ghost-btn", onclick: "dismiss('a')" }, [text("DISMISS")]);
  const nextLabel = el("b", {}, [text("Dismissable failure (retry 2)")]);
  /* Same tag, different attribute AND a removed one; plus a changed text child. */
  const nextParagraph = el("p", { class: "note warn" }, [text("Generate correction - retry scheduled")]);
  const next = el("article", { class: "automation-drawer-run state-review", "data-activity-key": "run:a" },
    [el("header", {}, [nextLabel]), nextParagraph, el("footer", {}, [nextButton])]);

  patch(live, next);

  assert.strictEqual(live.getAttribute("class"), "automation-drawer-run state-review",
    "a changed class must actually change");
  assert.strictEqual(live.getAttribute("data-stale"), null,
    "an attribute absent from the new markup must be REMOVED, not left behind");
  assert.strictEqual(live.getAttribute("data-activity-key"), "run:a", "the key must survive the patch");
  assert.strictEqual(flatten(live.childNodes[0]), "Dismissable failure (retry 2)",
    "changed text must update rather than go stale");
  assert.strictEqual(live.childNodes[1].getAttribute("class"), "note warn",
    "a changed descendant attribute must update");
  assert.strictEqual(flatten(live.childNodes[1]), "Generate correction - retry scheduled",
    "changed descendant text must update");
  assert.strictEqual(live.childNodes[0].childNodes[0], label,
    "an element whose tag is unchanged must be patched, not replaced");
  assert.strictEqual(live.childNodes[2].childNodes[0], button,
    "AN UNCHANGED CONTROL MUST KEEP ITS NODE IDENTITY - this is the whole guarantee");
  note("v670PatchElement updates changed text/attributes, removes dropped attributes, and keeps the control node");

  /* Structure that genuinely changed shape: a different tag cannot be patched into
     place, so it must be replaced - and an added child must arrive. */
  const staleSpan = el("span", {}, [text("old")]);
  const structural = el("div", {}, [staleSpan]);
  const structuralNext = el("div", {}, [el("em", {}, [text("new")]), el("i", {}, [text("added")])]);
  patch(structural, structuralNext);
  assert.strictEqual(structural.childNodes.length, 2, "an added child must be appended");
  assert.notStrictEqual(structural.childNodes[0], staleSpan, "a child whose tag changed must be replaced");
  assert.strictEqual(structural.childNodes[0].nodeName, "EM", "the replacement must be the new element");
  assert.strictEqual(flatten(structural.childNodes[1]), "added", "the appended child must carry its content");

  /* And a removed child must be removed, not orphaned on screen. */
  const shrinking = el("div", {}, [el("b", {}, [text("keep")]), el("b", {}, [text("drop")])]);
  const keeper = shrinking.childNodes[0];
  patch(shrinking, el("div", {}, [el("b", {}, [text("keep")])]));
  assert.strictEqual(shrinking.childNodes.length, 1, "a removed child must be removed");
  assert.strictEqual(shrinking.childNodes[0], keeper, "the surviving child must keep its identity");
  note("v670PatchElement replaces only what changed shape, appends additions, and removes departures");

  /* The manual-activity row is the one that ticks, so it must be keyed too or a
     ticking timer would still take an unrelated row's controls with it. */
  const manualKeyed = vm.runInContext(`(() => {
    const id = v641StartManualActivity("VISION AI · TEST", "Keyed manual row", "working");
    v641RenderActivityDrawer();
    const html = document.getElementById("automation-activity-drawer").innerHTML;
    return html.includes('data-activity-key="manual:' + id + '"');
  })()`, view.context);
  assert(manualKeyed, "manual activity rows must carry a reconciliation key");

  /* ---------------------------------------------------------------------------
     7 / 8  THE BLOCKING POOLS, AND WHAT EACH READER IS ALLOWED TO SEE
     --------------------------------------------------------------------------- */
  const framed = await render("#/shot/L1-01", framedBlockingFixture(), {
    storage: { "cinebraid-focused:fixture:shot-task:L1-01": "look" },
  });
  const pools = vm.runInContext(`(() => {
    const shot = shotById("L1-01");
    const all = blockingAttemptPools(shot);
    return {
      displayed: all.rows.map((row) => row.asset.id),
      opening: all.opening.map((row) => row.asset.id),
      framedFrames: [...all.framed.keys()],
      openingReader: v664BlockingRowsForReview(shot, "").map((row) => row.asset.id),
      frameReader: v664BlockingRowsForReview(shot, "frame-b").map((row) => row.asset.id),
      otherFrameReader: v664BlockingRowsForReview(shot, "frame-a").map((row) => row.asset.id),
    };
  })()`, framed.context);

  assert.deepStrictEqual(Array.from(pools.displayed).map(String), ["blocking-frame-b"],
    "the panel still displays the frame-bound attempt");
  assert.deepStrictEqual(Array.from(pools.openingReader).map(String), [],
    "the opening pool must stay free of frame-bound attempts");
  assert.deepStrictEqual(Array.from(pools.frameReader).map(String), ["blocking-frame-b"],
    "the frame's own reader must see the attempt bound to it");
  assert.deepStrictEqual(Array.from(pools.otherFrameReader).map(String), [],
    "another frame's reader must not see it - the partition is real and stays real");
  note("blocking pools: opening and per-frame stay separate, and each reader sees its own");

  const panel = framed.context.document.getElementById("main").innerHTML;
  assert(!panel.includes("REVIEW ALL WITH AI"),
    "the shot console must not offer REVIEW ALL over an empty opening pool - this is the dogfood defect");
  assert(panel.includes("REVIEW FRAME B WITH AI"),
    "a visible frame-bound attempt must have a reviewer that can actually read it");
  assert(panel.includes("No opening composition options yet"),
    "the console must explain why it has nothing to compare rather than showing a dead button");
  note("a shot whose attempts all belong to a frame offers the frame's reviewer, not a dead REVIEW ALL");

  /* Both pools populated: the shot console comes back, still scoped to the opening
     pool, and still says what it is leaving out. */
  const mixedProject = framedBlockingFixture();
  mixedProject.mediaAssets.push({
    id: "blocking-opening", file: "L1-01_BLOCKING_B01.png",
    storagePath: "shots/L1-01/blocking/L1-01_BLOCKING_B01.png",
    title: "L1-01 - opening blocking", kind: "image",
    links: [{ id: "blocking-link-open", targetType: "shot", targetId: "L1-01", role: "blocking-frame",
              blockingState: "returned", blockingVersion: "B02", generationInput: false, order: 2 }],
  });
  const mixed = await render("#/shot/L1-01", mixedProject, {
    storage: { "cinebraid-focused:fixture:shot-task:L1-01": "look" },
  });
  const mixedPanel = mixed.context.document.getElementById("main").innerHTML;
  const mixedPools = vm.runInContext(`(() => {
    const shot = shotById("L1-01");
    return {
      opening: v664BlockingRowsForReview(shot, "").map((row) => row.asset.id),
      frameB: v664BlockingRowsForReview(shot, "frame-b").map((row) => row.asset.id),
    };
  })()`, mixed.context);
  assert.deepStrictEqual(Array.from(mixedPools.opening).map(String), ["blocking-opening"],
    "the opening reader takes the unassigned attempt only");
  assert.deepStrictEqual(Array.from(mixedPools.frameB).map(String), ["blocking-frame-b"],
    "the frame reader takes the bound attempt only");
  assert(mixedPanel.includes("REVIEW ALL WITH AI"), "a populated opening pool restores the shot console");
  assert(mixedPanel.includes("REVIEW FRAME B WITH AI"), "the frame reviewer stays available alongside it");
  assert(mixedPanel.includes("belongs to a specific frame") || mixedPanel.includes("belong to a specific frame"),
    "the shot console must name the attempts it is not scoring");
  note("with both pools populated each console reviews its own, and says which is which");

  /* A review stored at shot level must still be readable from a card that has since
     been bound to a frame - otherwise the badge silently reads NOT REVIEWED. */
  const badge = vm.runInContext(`(() => {
    const shot = shotById("L1-01");
    const store = v664BlockingReviewStore(shot);
    store["opening"] = { items: { "blocking-frame-b": { assetId: "blocking-frame-b", score: 91, pass: true, notes: "Scored before it was bound." } } };
    const framedLookup = blockingAttemptReviewFor(shot, "blocking-frame-b", "frame-b");
    store["frame-b"] = { items: { "blocking-frame-b": { assetId: "blocking-frame-b", score: 77, pass: false, notes: "Scored as a Frame B endpoint." } } };
    const scopedLookup = blockingAttemptReviewFor(shot, "blocking-frame-b", "frame-b");
    return { fallbackScore: framedLookup?.score || 0, scopedScore: scopedLookup?.score || 0 };
  })()`, mixed.context);
  assert.strictEqual(badge.fallbackScore, 91,
    "a card must fall back to the shot-level review when its frame has none");
  assert.strictEqual(badge.scopedScore, 77,
    "the frame's own review must win once it exists");
  note("the attempt card reads its frame's review first and the shot-level one as fallback");

  console.log(notes.map((line) => `  · ${line}`).join("\n"));
  console.log("Production-state honesty suite passed: one machine-active predicate, a distinct waiting-for-you state, "
    + "a clock that stops at the human gate, keyed drawer rows, and blocking pools whose readers match what they display.");
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});

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
const { terminalHtml, runTone } = require("./terminal-view");

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
  /* A1: the Activity Terminal is the operational surface these checks read. */
  const view = await render(hash, project, storage ? { storage, creatorSurfaces: true } : { creatorSurfaces: true });
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
  const drawerHtml = terminalHtml(view.context);
  /* The separation is the classifier's verdict, carried on the row. */
  assert.strictEqual(runTone(view.context, "run-live"), "working",
    "genuinely running work must be classified as working");
  assert.strictEqual(runTone(view.context, "run-waiting"), "waiting",
    "an approval gate must not be classified as machine work");
  assert.strictEqual(runTone(view.context, "run-orphan"), "waiting",
    "an abandoned run must not be classified as machine work");
  /* A waiting row does not spin. Read from the rows themselves rather than from a
     section slice, because there are no longer sections to slice between. */
  const waitingRows = drawerHtml.split("<article").filter((row) => /tone-waiting/.test(row));
  assert(waitingRows.length >= 2, "both stopped runs must appear as waiting rows");
  assert(waitingRows.every((row) => !row.includes('class="spin"')),
    "nothing waiting on a person may render a spinner");
  assert(waitingRows.some((row) => /AWAITING REVIEW|STOPPED/.test(row)),
    "a waiting row must say so in words, not only by tone");
  /* A1 kept the restart action task-local with v626RunActions, which is the only
     owner holding this run's type, targetId, scope and lease. */
  assert(fs.readFileSync(path.join(ROOT, "public/automation.js"), "utf8").includes("RESUME RUN"),
    "an abandoned run must name the action that restarts it");
  assert(drawerHtml.includes("1 running"),
    "the Terminal summary must count only live work");
  note("the Terminal classifies running apart from waiting, and only the former spins");

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
  /* A1: data-run-id was the drawer card's attribute. The Terminal row carries the
     reconciliation key itself, which is the thing the painter actually addresses. */
  /* Every ADDRESSABLE UNIT carries a key, and a failure group is one of them: the group
     container is what the reconciler holds on to while its members come and go, so it is
     keyed too and the count of keys legitimately exceeds the count of rows. What must
     hold is that no row is left unaddressable. */
  const rowKeys = [...drawerHtml.matchAll(/data-activity-key="([^"]+)"/g)].map((match) => match[1]);
  const rowCount = (drawerHtml.match(/<article class="cb-terminal-row/g) || []).length;
  const groupCount = (drawerHtml.match(/<details class="cb-terminal-group/g) || []).length;
  assert(rowCount > 0, "the Terminal must render the rows this section is about");
  assert.strictEqual(rowKeys.length, rowCount + groupCount,
    "every Terminal row and every failure group must carry a reconciliation key");
  assert.strictEqual(new Set(rowKeys).size, rowKeys.length,
    "reconciliation keys must be unique, or the reconciler cannot tell two units apart");
  /* The three runs this section set up are each addressable by their own key. */
  for (const id of ["run-live", "run-waiting", "run-orphan"]) {
    assert(rowKeys.includes(`run:${id}`), `run row ${id} is missing its key`);
  }
  assert.strictEqual(new Set(rowKeys).size, rowKeys.length,
    "reconciliation keys must be unique or the painter would collapse rows");
  /* A1: the reconciling painter outlived the surface it was written for. The
     Terminal patches through the same v670PatchElement rather than replacing its
     markup, which is what keeps a control from detaching under the pointer on the
     3.5s tick — the defect the painter exists for, on the surface that now owns it. */
  const surfacesSource = readLF("public/creator-surfaces.js");
  assert(surfacesSource.includes("v670PatchElement(node.firstElementChild, next)"),
    "the Activity Terminal must paint through the reconciling painter");
  assert(surfacesSource.includes("if (!canReconcile) { node.innerHTML = markup; return; }"),
    "replacing the whole markup must stay the FALLBACK, not the path");
  assert(surfacesSource.includes("v670DomCanReconcile"),
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
      attributes: new Map(Object.entries(attributes)), childNodes: [...children], parentNode: null,
      getAttributeNames() { return [...this.attributes.keys()]; },
      getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; },
      hasAttribute(name) { return this.attributes.has(name); },
      setAttribute(name, value) { this.attributes.set(name, String(value)); },
      removeAttribute(name) { this.attributes.delete(name); },
      /* The keyed layer asks for ELEMENT children and inserts before a sibling; the
         positional walk asks for all childNodes. Both surfaces are modelled so this
         checklist covers both paths rather than only the one it was written for. */
      get children() { return this.childNodes.filter((row) => row.nodeType === 1); },
      get firstChild() { return this.childNodes[0] || null; },
      get previousSibling() {
        const parent = this.parentNode;
        if (!parent) return null;
        const index = parent.childNodes.indexOf(this);
        return index > 0 ? parent.childNodes[index - 1] : null;
      },
      get outerHTML() {
        const attrs = [...this.attributes].map(([k, v]) => ` ${k}="${v}"`).join("");
        const inner = this.childNodes.map((row) => row.nodeType === 3 ? String(row.nodeValue) : row.outerHTML).join("");
        return `<${tagName}${attrs}>${inner}</${tagName}>`;
      },
      insertBefore(child, reference) {
        this.childNodes = this.childNodes.filter((row) => row !== child);
        const index = reference ? this.childNodes.indexOf(reference) : this.childNodes.length;
        this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, child);
        child.parentNode = this;
        return child;
      },
      remove() { if (this.parentNode) this.parentNode.removeChild(this); },
      appendChild(child) { this.childNodes.push(child); child.parentNode = this; return child; },
      removeChild(child) { this.childNodes = this.childNodes.filter((row) => row !== child); child.parentNode = null; return child; },
      replaceChild(next, previous) {
        this.childNodes = this.childNodes.map((row) => (row === previous ? next : row));
        return previous;
      },
    };
    for (const child of node.childNodes) child.parentNode = node;
    return node;
  }
  const flatten = (node) => node.nodeType === 3 ? String(node.nodeValue)
    : node.childNodes.map(flatten).join("");

  /* A run row: a header with a label, a paragraph, and a footer holding the control. */
  const button = el("button", { class: "ghost-btn", onclick: "dismiss('a')" }, [text("DISMISS")]);
  const label = el("b", {}, [text("Dismissable failure")]);
  const paragraph = el("p", { class: "note" }, [text("Generate correction")]);
  const live = el("article", { class: "cb-terminal-row tone-attention", "data-activity-key": "run:a", "data-stale": "1" },
    [el("header", {}, [label]), paragraph, el("footer", {}, [button])]);

  const nextButton = el("button", { class: "ghost-btn", onclick: "dismiss('a')" }, [text("DISMISS")]);
  const nextLabel = el("b", {}, [text("Dismissable failure (retry 2)")]);
  /* Same tag, different attribute AND a removed one; plus a changed text child. */
  const nextParagraph = el("p", { class: "note warn" }, [text("Generate correction - retry scheduled")]);
  const next = el("article", { class: "cb-terminal-row tone-waiting", "data-activity-key": "run:a" },
    [el("header", {}, [nextLabel]), nextParagraph, el("footer", {}, [nextButton])]);

  patch(live, next);

  assert.strictEqual(live.getAttribute("class"), "cb-terminal-row tone-waiting",
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

  /* ---------------------------------------------------------------------------
     5c  THE KEYED LAYER: does a row keep its node when the LIST changes shape?

     5b proves a row survives its own content changing. That is a different claim from
     this one, and the difference is where the A1 Terminal was wrong: the patcher walked
     children BY POSITION, so inserting a row above another shifted every node down one
     and quietly re-pointed row 2's DISMISS button at row 3's run. Nothing threw; the
     button simply belonged to somebody else.

     The rows carry data-activity-key. These check that the key, not the position, is
     what decides which live node a new row becomes.
     --------------------------------------------------------------------------- */
  const keyedRow = (key, label_) => el("article", { class: "cb-terminal-row", "data-activity-key": key },
    [el("b", {}, [text(label_)]), el("button", { onclick: `dismiss('${key}')` }, [text("DISMISS")])]);

  const listLive = el("div", { class: "cb-terminal-rows" }, [keyedRow("run:a", "A"), keyedRow("run:b", "B")]);
  const nodeA = listLive.childNodes[0], nodeB = listLive.childNodes[1];
  const buttonB = nodeB.childNodes[1];
  /* A new run arrives ABOVE both, which is exactly the shift that used to retarget. */
  const listNext = el("div", { class: "cb-terminal-rows" },
    [keyedRow("run:x", "X"), keyedRow("run:a", "A"), keyedRow("run:b", "B (retry 2)")]);
  patch(listLive, listNext);

  assert.strictEqual(listLive.childNodes.length, 3, "the inserted row must arrive");
  assert.strictEqual(listLive.childNodes.map((row) => row.getAttribute("data-activity-key")).join(","),
    "run:x,run:a,run:b", "the keyed order must follow the new markup");
  assert.strictEqual(listLive.childNodes[1], nodeA, "run:a must keep its node across an insertion above it");
  assert.strictEqual(listLive.childNodes[2], nodeB, "run:b must keep its node across an insertion above it");
  assert.strictEqual(nodeB.childNodes[1], buttonB,
    "AND ITS CONTROL - a positional patcher hands this button to whichever run took its index");
  assert.strictEqual(buttonB.getAttribute("onclick"), "dismiss('run:b')",
    "the surviving control must still act on the run it belongs to");
  assert.strictEqual(flatten(nodeB.childNodes[0]), "B (retry 2)", "the surviving row still updates its own content");

  /* Reordering moves the surviving nodes rather than rebuilding them. */
  const reordered = el("div", { class: "cb-terminal-rows" },
    [keyedRow("run:b", "B"), keyedRow("run:a", "A"), keyedRow("run:x", "X")]);
  patch(listLive, reordered);
  assert.strictEqual(listLive.childNodes.map((row) => row.getAttribute("data-activity-key")).join(","),
    "run:b,run:a,run:x", "a reorder must be applied");
  assert.strictEqual(listLive.childNodes[0], nodeB, "a reordered row keeps its node");
  assert.strictEqual(listLive.childNodes[1], nodeA, "so does the row it moved past");

  /* A row that genuinely leaves is removed, and the survivors keep their nodes. */
  const shrunk = el("div", { class: "cb-terminal-rows" }, [keyedRow("run:a", "A")]);
  patch(listLive, shrunk);
  assert.strictEqual(listLive.childNodes.length, 1, "a row absent from the new markup must be removed");
  assert.strictEqual(listLive.childNodes[0], nodeA, "and the surviving row must still be the same node");
  note("v670PatchElement reconciles a keyed list by key: insert, reorder and remove all preserve node identity");

  /* And a removed child must be removed, not orphaned on screen. */
  const shrinking = el("div", {}, [el("b", {}, [text("keep")]), el("b", {}, [text("drop")])]);
  const keeper = shrinking.childNodes[0];
  patch(shrinking, el("div", {}, [el("b", {}, [text("keep")])]));
  assert.strictEqual(shrinking.childNodes.length, 1, "a removed child must be removed");
  assert.strictEqual(shrinking.childNodes[0], keeper, "the surviving child must keep its identity");
  note("v670PatchElement replaces only what changed shape, appends additions, and removes departures");

  /* The manual-activity row is the one that ticks, so it must be keyed too or a
     ticking timer would still take an unrelated row's controls with it. */
  const manualId = vm.runInContext(
    `v641StartManualActivity("VISION AI · TEST", "Keyed manual row", "working")`, view.context);
  const manualKeyed = terminalHtml(view.context).includes(`data-activity-key="manual:${manualId}"`);
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

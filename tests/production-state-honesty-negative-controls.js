/* Negative controls for tests/production-state-honesty.js.
 *
 * A guarantee nobody has watched fail is a guarantee nobody has tested. Each control
 * below reintroduces one of the defects this batch removed - IN MEMORY, through the
 * render harness's mutateSource hook, so nothing on disk is touched and no control can
 * be "restored" by a checkout that also discards real work - and then proves the
 * repaired behaviour disappears with it.
 *
 * Each control carries a PROBE RECEIPT: the mutation asserts that the text it is
 * replacing was actually present, so a control cannot quietly become a no-op when the
 * source is refactored and start "passing" against nothing.
 *
 * WHAT IS NOT CONTROLLED HERE. The drawer's element-reconciliation repair needs a DOM
 * that parses HTML and tracks node identity, which FakeElement is not; its negative
 * control lives in tests/production-state-honesty-real-browser.py, where the painter is
 * replaced with the old whole-innerHTML behaviour inside the running page.
 */

const assert = require("assert");
const vm = require("vm");
const { render, buildFixture } = require("./render-harness");

const notes = [];
const note = (line) => notes.push(line);

function seconds(offset) {
  return new Date(Date.now() + offset * 1000).toISOString();
}

const RUNS = [
  { id: "run-waiting", type: "shot-chain", targetId: "L1-01", scope: "stills", label: "Parked",
    status: "awaiting-review", stage: "Approve Frame A", createdAt: seconds(-600), updatedAt: seconds(-540),
    completedAt: "", runnerId: "", leaseExpiresAt: "", current: { stepKey: "s" }, config: {}, usage: {},
    steps: { s: { key: "s", kind: "frame-review", status: "needs-review", label: "Frame A review",
                  startedAt: seconds(-600), updatedAt: seconds(-540) } }, logs: [] },
  { id: "run-orphan", type: "shot-chain", targetId: "L1-02", scope: "stills", label: "Abandoned",
    status: "running", stage: "Generating", createdAt: seconds(-1200), updatedAt: seconds(-900),
    completedAt: "", runnerId: "runner-gone", leaseExpiresAt: seconds(-540), current: { stepKey: "s" },
    config: {}, usage: {},
    steps: { s: { key: "s", kind: "generation", status: "running", label: "Generate",
                  startedAt: seconds(-1200), updatedAt: seconds(-900) } }, logs: [] },
  { id: "run-live", type: "shot-chain", targetId: "L1-03", scope: "stills", label: "Running",
    status: "running", stage: "Generating", createdAt: seconds(-120), updatedAt: seconds(-30),
    completedAt: "", runnerId: "runner-alive", leaseExpiresAt: seconds(240), current: { stepKey: "s" },
    config: {}, usage: {},
    steps: { s: { key: "s", kind: "generation", status: "running", label: "Generate",
                  startedAt: seconds(-120), updatedAt: seconds(-30) } }, logs: [] },
];

/* A mutation that must find what it is replacing. The count is asserted so a control
   cannot silently degrade into changing nothing.

   Line endings are normalised first: this repository checks out with core.autocrlf=true,
   so every public/*.js file reaches the harness with CRLF, and a multi-line anchor
   written with \n would match nothing and take the whole suite's meaning with it. */
function replacing(file, target, needle, replacement, expected = 1) {
  return (name, contents) => {
    if (name !== file) return contents;
    const source = contents.replace(/\r\n/g, "\n");
    const hits = source.split(needle).length - 1;
    assert.strictEqual(hits, expected,
      `probe receipt: ${target} expected ${expected} occurrence(s) of its anchor in ${file}, found ${hits}. `
      + "The control is no longer mutating the live path and must be rewritten.");
    return source.split(needle).join(replacement);
  };
}

function framedBlockingFixture() {
  const project = buildFixture();
  for (const asset of project.mediaAssets) {
    asset.links = (asset.links || []).filter((link) => !(link.targetType === "shot" && link.targetId === "L1-01"));
  }
  project.mediaAssets.push({
    id: "blocking-frame-b", file: "L1-01_FRAME_B_BLOCKING.png",
    storagePath: "shots/L1-01/blocking/L1-01_FRAME_B_BLOCKING.png",
    title: "L1-01 - Frame B blocking", kind: "image",
    links: [{ id: "blocking-link-b", targetType: "shot", targetId: "L1-01", role: "blocking-frame",
              blockingState: "returned", blockingVersion: "B01", blockingFrameId: "frame-b",
              generationInput: false, order: 1 }],
  });
  return project;
}

/* Runs the body and requires it to throw an AssertionError mentioning `because`. */
async function mustFail(label, because, body) {
  let failure = null;
  try { await body(); }
  catch (error) { failure = error; }
  assert(failure, `NEGATIVE CONTROL DID NOT FIRE: ${label}. The guarantee is not actually being tested.`);
  assert(String(failure.message).includes(because),
    `NEGATIVE CONTROL FIRED FOR THE WRONG REASON: ${label}\n  wanted: ${because}\n  got:    ${failure.message}`);
  note(`${label} -> ${failure.message.split("\n")[0]}`);
}

async function main() {
  /* ---- 1. put `awaiting-review` back into the machine-active predicate ---- */
  await mustFail(
    "counting a human gate as active",
    "awaiting-review must not count as machine-active",
    async () => {
      const view = await render("#/shot/L1-01", buildFixture(), {
        mutateSource: replacing("live-activity.js", "control 1",
          'function v670MachineActiveRun(run) {\n  if (run?.status !== "running") return false;',
          'function v670MachineActiveRun(run) {\n  if (run?.status === "awaiting-review") return true;\n  if (run?.status !== "running") return false;'),
      });
      vm.runInContext(`AUTOMATION_RUNS = ${JSON.stringify(RUNS)};`, view.context);
      const active = Array.from(vm.runInContext(
        "AUTOMATION_RUNS.filter(v670MachineActiveRun).map((run) => run.id)", view.context)).map(String);
      assert(!active.includes("run-waiting"),
        `awaiting-review must not count as machine-active, got ${JSON.stringify(active)}`);
    });

  /* ---- 2. let an abandoned run keep claiming to be live ---- */
  await mustFail(
    "counting an abandoned run as active",
    "a lapsed lease must not count as machine-active",
    async () => {
      const view = await render("#/shot/L1-01", buildFixture(), {
        mutateSource: replacing("live-activity.js", "control 2",
          "  if (!run?.runnerId) return false;\n  const expires = Date.parse(run.leaseExpiresAt || \"\");\n  return !Number.isFinite(expires) || expires <= Date.now();",
          "  return false;"),
      });
      vm.runInContext(`AUTOMATION_RUNS = ${JSON.stringify(RUNS)};`, view.context);
      const active = Array.from(vm.runInContext(
        "AUTOMATION_RUNS.filter(v670MachineActiveRun).map((run) => run.id)", view.context)).map(String);
      assert(!active.includes("run-orphan"),
        `a lapsed lease must not count as machine-active, got ${JSON.stringify(active)}`);
    });

  /* ---- 3. drop WAITING FOR YOU back into ACTIVE NOW ---- */
  await mustFail(
    "merging the waiting section back into ACTIVE NOW",
    "an approval gate must stay out of ACTIVE NOW",
    async () => {
      const view = await render("#/shot/L1-01", buildFixture(), {
        mutateSource: replacing("live-activity.js", "control 3",
          "  const activeRuns = runs.filter(v670MachineActiveRun);\n  const waitingRuns = runs.filter(v670WaitingForHumanRun);",
          "  const activeRuns = runs.filter((run) => v670MachineActiveRun(run) || v670WaitingForHumanRun(run));\n  const waitingRuns = [];",
          /* The same two lines open v6602ActivityStatus and v641RenderActivityDrawer.
             Both are mutated on purpose: merging the two notions in one reader and not
             the other is a state the product never had. */
          2),
      });
      vm.runInContext(`AUTOMATION_RUNS = ${JSON.stringify(RUNS)};`, view.context);
      const html = vm.runInContext(
        `V641_ACTIVITY_DRAWER_OPEN = true; v641RenderActivityDrawer();
         document.getElementById("automation-activity-drawer").innerHTML`, view.context);
      const activeSection = html.split("ACTIVE NOW")[1].split("WAITING FOR YOU")[0];
      assert(!activeSection.includes("run-waiting"),
        "an approval gate must stay out of ACTIVE NOW");
    });

  /* ---- 4. let the elapsed clock fall back to now for a parked step ---- */
  await mustFail(
    "restarting the clock at the human gate",
    "the human-gate clock must not advance",
    async () => {
      const view = await render("#/shot/L1-01", buildFixture(), {
        mutateSource: replacing("live-activity.js", "control 4",
          "function v670StepEndTimestamp(step) {\n  if (v670MachineActiveStep(step)) return \"\";\n  return step?.completedAt || step?.updatedAt || step?.startedAt || \"\";",
          "function v670StepEndTimestamp(step) {\n  return step?.completedAt || \"\";"),
      });
      vm.runInContext(`AUTOMATION_RUNS = ${JSON.stringify(RUNS)};`, view.context);
      const read = () => vm.runInContext(
        `v670StepElapsedLabel(AUTOMATION_RUNS.find((run) => run.id === "run-waiting").steps.s)`, view.context);
      const before = read();
      await new Promise((resolve) => setTimeout(resolve, 1100));
      assert.strictEqual(before, read(), "the human-gate clock must not advance");
    });

  /* ---- 5. stop the writer stamping the machine-stop boundary ---- */
  await mustFail(
    "leaving the human gate unstamped",
    "the pause helper must stamp when machine work ended",
    async () => {
      const view = await render("#/shot/L1-01", buildFixture(), {
        mutateSource: replacing("automation.js", "control 5",
          "  step.completedAt = step.completedAt || v626Now();\n  step.updatedAt = v626Now();\n  run.status = \"awaiting-review\";",
          "  step.updatedAt = v626Now();\n  run.status = \"awaiting-review\";"),
        fetch: async (url, options, respond) =>
          String(url).startsWith("/api/automation/runs") && options.method === "PUT"
            ? respond({ run: JSON.parse(options.body) }) : null,
      });
      const stamped = await vm.runInContext(`(async () => {
        const run = { id: "writer-run", revision: 1, type: "shot-chain", targetId: "L1-01", scope: "stills",
          status: "running", stage: "", steps: {}, logs: [], usage: {}, config: {}, current: {} };
        const step = v626Step(run, "s", "frame-review", "Frame A review");
        step.startedAt = new Date(Date.now() - 30000).toISOString();
        try { await v627PauseForHumanReview(run, step, "Approve"); }
        catch (error) { if (!error.reviewRequired) throw error; }
        return { completedAt: step.completedAt || "" };
      })()`, view.context);
      assert(stamped.completedAt, "the pause helper must stamp when machine work ended");
    });

  /* ---- 6. take the reconciliation keys off the drawer rows ---- */
  await mustFail(
    "removing the drawer reconciliation keys",
    "every drawer run row must carry a reconciliation key",
    async () => {
      const view = await render("#/shot/L1-01", buildFixture(), {
        mutateSource: replacing("live-activity.js", "control 6",
          ' data-activity-key="run:${attr(run.id)}"', ""),
      });
      vm.runInContext(`AUTOMATION_RUNS = ${JSON.stringify(RUNS)};`, view.context);
      const html = vm.runInContext(
        `V641_ACTIVITY_DRAWER_OPEN = true; v641RenderActivityDrawer();
         document.getElementById("automation-activity-drawer").innerHTML`, view.context);
      const runRows = [...html.matchAll(/data-run-id="([^"]+)"/g)].map((match) => match[1]);
      assert(runRows.length, "the control needs at least one drawer row to check");
      for (const id of runRows) {
        assert(html.includes(`data-activity-key="run:${id}"`),
          "every drawer run row must carry a reconciliation key");
      }
    });

  /* ---- 6b. go back to replacing a keyed row whose content changed ----
     The defect the CI browser gate exposed: keeping the node only when the markup was
     byte-identical, which protects exactly the case that never needed protecting. */
  await mustFail(
    "replacing a keyed row instead of patching it",
    "AN UNCHANGED CONTROL MUST KEEP ITS NODE IDENTITY",
    async () => {
      const view = await render("#/shot/L1-01", buildFixture(), {
        mutateSource: replacing("live-activity.js", "control 6b",
          "    if (liveKid.nodeType === 1) { v670PatchElement(liveKid, nextKid); continue; }",
          "    if (liveKid.nodeType === 1) { live.replaceChild(nextKid, liveKid); continue; }"),
      });
      const probe = vm.runInContext(`(() => {
        const make = (tag, attrs, kids) => { const node = { nodeType: 1, nodeName: tag.toUpperCase(),
          attributes: new Map(Object.entries(attrs || {})), childNodes: kids || [],
          getAttributeNames() { return [...this.attributes.keys()]; },
          getAttribute(n) { return this.attributes.has(n) ? this.attributes.get(n) : null; },
          hasAttribute(n) { return this.attributes.has(n); },
          setAttribute(n, v) { this.attributes.set(n, String(v)); },
          removeAttribute(n) { this.attributes.delete(n); },
          appendChild(c) { this.childNodes.push(c); return c; },
          removeChild(c) { this.childNodes = this.childNodes.filter((r) => r !== c); return c; },
          replaceChild(next, prev) { this.childNodes = this.childNodes.map((r) => (r === prev ? next : r)); return prev; } };
          return node; };
        const button = make("button", { class: "ghost-btn" }, []);
        const live = make("article", { "data-activity-key": "run:a" }, [button]);
        const next = make("article", { "data-activity-key": "run:a" }, [make("button", { class: "ghost-btn" }, [])]);
        v670PatchElement(live, next);
        return live.childNodes[0] === button;
      })()`, view.context);
      assert(probe, "AN UNCHANGED CONTROL MUST KEEP ITS NODE IDENTITY across a patch");
    });

  /* ---- 6c. stop removing attributes the new markup dropped ---- */
  await mustFail(
    "leaving a dropped attribute behind",
    "an attribute absent from the new markup must be removed",
    async () => {
      const view = await render("#/shot/L1-01", buildFixture(), {
        mutateSource: replacing("live-activity.js", "control 6c",
          "  for (const name of live.getAttributeNames()) if (!next.hasAttribute(name)) live.removeAttribute(name);",
          "  /* control 6c: attribute removal disabled */"),
      });
      const stale = vm.runInContext(`(() => {
        const make = (attrs) => ({ nodeType: 1, nodeName: "ARTICLE",
          attributes: new Map(Object.entries(attrs || {})), childNodes: [],
          getAttributeNames() { return [...this.attributes.keys()]; },
          getAttribute(n) { return this.attributes.has(n) ? this.attributes.get(n) : null; },
          hasAttribute(n) { return this.attributes.has(n); },
          setAttribute(n, v) { this.attributes.set(n, String(v)); },
          removeAttribute(n) { this.attributes.delete(n); },
          appendChild(c) { this.childNodes.push(c); return c; },
          removeChild(c) { this.childNodes = this.childNodes.filter((r) => r !== c); return c; },
          replaceChild(next, prev) { this.childNodes = this.childNodes.map((r) => (r === prev ? next : r)); return prev; } });
        const live = make({ "data-activity-key": "run:a", "data-stale": "1" });
        v670PatchElement(live, make({ "data-activity-key": "run:a" }));
        return live.getAttribute("data-stale");
      })()`, view.context);
      assert.strictEqual(stale, null, "an attribute absent from the new markup must be removed");
    });

  /* ---- 7. gate the blocking console on rows it does not review ---- */
  await mustFail(
    "gating REVIEW ALL on attempts it cannot read",
    "must not offer REVIEW ALL over an empty opening pool",
    async () => {
      const view = await render("#/shot/L1-01", framedBlockingFixture(), {
        storage: { "cinebraid-focused:fixture:shot-task:L1-01": "look" },
        mutateSource: replacing("creation-studio.js", "control 7",
          "  const reviewConsole = openingRows.length ?", "  const reviewConsole = pools.rows.length ?"),
      });
      const panel = view.context.document.getElementById("main").innerHTML;
      assert(!panel.includes("REVIEW ALL WITH AI"),
        "must not offer REVIEW ALL over an empty opening pool");
    });

  /* ---- 8. flatten the partition the runner depends on ---- */
  await mustFail(
    "flattening frame-bound attempts into the opening pool",
    "the opening pool must stay free of frame-bound attempts",
    async () => {
      const view = await render("#/shot/L1-01", framedBlockingFixture(), {
        storage: { "cinebraid-focused:fixture:shot-task:L1-01": "look" },
        mutateSource: replacing("automation.js", "control 8",
          '  return blockingMediaRows(shot).filter(({ link }) => target ? String(link.blockingFrameId || "") === target : !String(link.blockingFrameId || ""));',
          "  return blockingMediaRows(shot).filter(({ link }) => target ? String(link.blockingFrameId || \"\") === target : true);"),
      });
      const opening = Array.from(vm.runInContext(
        `v664BlockingRowsForReview(shotById("L1-01"), "").map((row) => row.asset.id)`, view.context)).map(String);
      assert.deepStrictEqual(opening, [],
        `the opening pool must stay free of frame-bound attempts, got ${JSON.stringify(opening)}`);
    });

  console.log(notes.map((line) => `  · ${line}`).join("\n"));
  console.log(`Production-state honesty negative controls passed: ${notes.length} mutations of the live path each `
    + "carried a probe receipt and each turned the suite red for its own reason.");
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});

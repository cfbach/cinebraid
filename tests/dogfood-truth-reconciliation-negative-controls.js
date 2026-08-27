/* CineBraid — Dogfood Remediation Slice 0: NEGATIVE CONTROLS.
 *
 * tests/dogfood-truth-reconciliation.js asserts that live production truth
 * dominates stale run, workflow and presentation state. Most of those assertions
 * are the shape that most often CANNOT fail:
 *
 *   "the banner says the goal is satisfied"    passes if a class name is present
 *   "no RESUME MISSING VIEWS control"          passes against a blank page
 *   "no paid request may be quoted"            passes if the quote never renders
 *   "the child is not attention"               passes if the predicate crashes to false
 *   "the paid control is disabled"             passes if no control is drawn at all
 *
 * So every control below BREAKS THE PRODUCT DELIBERATELY, in a file patched for
 * the duration of the control, and requires the corresponding assertion to catch
 * it. Each control PROVES the break landed and prints the literal bad state
 * BEFORE it judges the detector: a probe guarded by the same assert() it is
 * testing reports success while mutating nothing, which is a real lesson this
 * repository has already paid for.
 *
 *   NC-D1   the coverage banner reads the stored status again, so a satisfied
 *           goal keeps saying NEEDS ATTENTION beside a board that says 0 missing
 *   NC-D2   the resume control is drawn from the stored status, so a satisfied
 *           goal still offers the paid dialog
 *   NC-D3   the reconciliation suppresses on an unknown coverage answer, so a
 *           caller that cannot establish the requirement silently hides the run
 *   NC-D4   the spend plan reads the retired `approvedFile` key again, so every
 *           assigned view is priced as a paid request
 *   NC-D5   the coverage start handler stamps its run record before asking, so a
 *           refused submission still overwrites the reference's automation state
 *   NC-D6   the run record outranks approved frames again, so an approved frame
 *           reports Running
 *   NC-D7   stage navigation follows the colour again, so the stage holding a
 *           live run's controls stops being where the shot opens
 *   NC-D8   a route that needs no frame counts a fraction of a requirement that
 *           does not exist
 *   NC-D9   a skipped optional stage claims attention again for guides nobody
 *           chose
 *   NC-D10  Deliver infers its prerequisite from a lifecycle label again, so an
 *           approved still is told to approve a still
 *   NC-D11  the attention verdict ignores parent health, so a child under
 *           automatic recovery is a red NEEDS ATTENTION row
 *   NC-D12  the drawer paints a healthy run's past step failure as an error
 *   NC-D13  severity ignores recovery, so a retried step is attention
 *   NC-D14  the H3 paid control ignores package freshness, so OUT OF DATE sits
 *           beside an enabled GENERATE
 *   NC-D15  the H3 dispatch boundary ignores package freshness, so a
 *           programmatically opened dialog spends on a stale package
 *   NC-D16  the freshness gate refuses an UNRECORDED snapshot too, so every
 *           package compiled before dependencies were captured is blocked
 *
 * Nothing here contacts a provider, spends anything, or writes to a project. The
 * patched files are restored from their ORIGINAL BYTES in a `finally` — never by
 * `git checkout`, which this repository has already lost unstaged work to.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const readLF = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");

const results = [];
const literals = [];

/* ---------------------------------------------------------------- machinery */

/* Require a body to throw an AssertionError. A control that passes here has
   proved its detector fires; a control that does NOT throw has found a blind
   spot and fails this suite. */
async function expectRed(id, body) {
  let threw = null;
  try { await body(); } catch (error) { threw = error; }
  assert.ok(threw, `${id}: the defect was introduced and NOTHING caught it — that assertion cannot fail`);
  assert.ok(threw instanceof assert.AssertionError || /AssertionError/.test(String(threw && threw.name)),
    `${id}: the detector must fail by assertion, not by crashing (${threw && threw.message})`);
  return threw;
}

/* Every module this suite reaches is loaded through `require` (the shared
   projections) or evaluated by the render harness from disk (the browser files),
   so a control patches the file itself and restores the original bytes. Both the
   probe and the detector then see the same broken product. */
const CACHE_KEYS = ["shared-coverage", "shared-stage-model", "render-harness", "dogfood-truth-reconciliation"];
function dropCaches() {
  for (const key of Object.keys(require.cache)) {
    if (CACHE_KEYS.some((name) => key.includes(name))) delete require.cache[key];
  }
}

async function patchedFiles(editsByFile, body) {
  const originals = new Map();
  try {
    for (const [file, edits] of Object.entries(editsByFile)) {
      const absolute = path.join(ROOT, file);
      const original = fs.readFileSync(absolute, "utf8");
      originals.set(absolute, original);
      /* ANCHORS ARE NORMALISED TO LF BEFORE MATCHING. A `\n` in a source anchor
         matches zero times in a normal Windows checkout, which would abort the
         control and every `&&` entry behind it while looking like a pass. */
      let next = original.replace(/\r\n/g, "\n");
      for (const [from, to] of edits) {
        assert.ok(next.includes(from), `patch target not found in ${file}: ${from.slice(0, 110)}`);
        next = next.replace(from, to);
      }
      fs.writeFileSync(absolute, next);
    }
    dropCaches();
    await body();
  } finally {
    for (const [absolute, original] of originals) fs.writeFileSync(absolute, original);
    dropCaches();
  }
}

/* Re-require the suite so its helpers and its detectors are bound to whatever the
   patched files now say. Without this a control judges a detector that closed
   over the unpatched copy. */
function freshSuite() {
  dropCaches();
  return require("./dogfood-truth-reconciliation");
}

async function control({ id, defect, files, probe, guard }) {
  await patchedFiles(files, async () => {
    const literal = await probe(freshSuite());
    assert.ok(literal, `${id}: the probe must produce the literal bad state, not merely run`);
    literals.push(`${id} → ${literal}`);
    await expectRed(id, () => guard(freshSuite()));
  });
  results.push(`${id} · ${defect}`);
}

/* ============================================================ COVERAGE (A/F/G)
   =========================================================================== */

/* The banner's live read, replaced by the stored read it used to have. */
const BANNER_READS_STORED = {
  "public/entities.js": [[
    `  const live = typeof coverageRunState === "function" ? coverageRunState(list, entity, run) : null;`,
    `  const live = null;`,
  ]],
};

async function nc1() {
  await control({
    id: "NC-D1",
    defect: "the coverage banner reads the stored status again, so a satisfied goal keeps saying NEEDS ATTENTION",
    files: BANNER_READS_STORED,
    probe: async (suite) => {
      const board = await suite.openCoverageBoard(suite.coverageFixture({ missing: [] }));
      const banner = suite.coverageBanner(board.html());
      assert.ok(/NEEDS ATTENTION/.test(banner), "NC-D1: the defect did not land — the banner is still reconciled");
      return `banner over 0 missing required views: ${banner.match(/<b>[^<]*<\/b>/)}`;
    },
    guard: (suite) => suite.main(),
  });
}

async function nc2() {
  await control({
    id: "NC-D2",
    defect: "the resume control is drawn from the stored status, so a satisfied goal still offers the paid dialog",
    files: {
      "public/entities.js": [[
        `  const resume = status === "needs-attention" && (!live || !live.known || live.goal === "outstanding");`,
        `  const resume = String(run.status || "") === "needs-attention";`,
      ]],
    },
    probe: async (suite) => {
      const board = await suite.openCoverageBoard(suite.coverageFixture({ missing: [] }));
      assert.ok(/RESUME MISSING VIEWS/.test(board.html()),
        "NC-D2: the defect did not land — the resume control is still withheld");
      return "RESUME MISSING VIEWS offered with 0 required views missing";
    },
    guard: (suite) => suite.main(),
  });
}

async function nc3() {
  await control({
    id: "NC-D3",
    defect: "the reconciliation suppresses on an unknown coverage answer, so an unestablished requirement hides the run",
    files: {
      "public/shared-coverage.js": [[
        `    const known = it.known !== false && Number.isFinite(missing) && missing >= 0;`,
        `    const known = true;`,
      ]],
    },
    probe: async () => {
      const Coverage = require("../public/shared-coverage.js");
      /* A caller that says "I could not establish this" while carrying a zero —
         a partial projection, a coverage set that has not loaded. With the gate
         removed the zero is believed and the run is silently stood down. */
      const answer = Coverage.coverageRunReconciliation({ status: "needs-attention", missingRequired: 2 }, { known: false, missingRequired: 0 });
      assert.strictEqual(answer.goal, "satisfied",
        "NC-D3: the defect did not land — an unknown answer is still unknown");
      return `an unestablished coverage answer now reports ${answer.goal} and offersGeneration=${answer.offersGeneration}`;
    },
    guard: (suite) => suite.main(),
  });
}

async function nc4() {
  await control({
    id: "NC-D4",
    defect: "the spend plan reads the retired approvedFile key, so every assigned view is priced as a paid request",
    files: {
      "public/coverage-automation.js": [[
        `.filter((slot) => isRequiredCoverage(slot) && !slotSelectedFile(slot) && !slot.retired).length : 0;`,
        `.filter((slot) => isRequiredCoverage(slot) && !slot.approvedFile && !slot.retired).length : 0;`,
      ]],
    },
    probe: async (suite) => {
      /* The EXPRESSION arm, which is where the retired key is actually read: the
         angle arm is handed a set missingCoverageSlots() has already filtered. */
      const board = await suite.openCoverageBoard(suite.coverageFixture({ missingExpressions: ["worried"] }));
      const context = board.rendered.context;
      context.openCoverageExpressionAutomation("KAI");
      context.document.getElementById("coverage-mode").value = "individual";
      context.document.getElementById("coverage-sheet-type").value = "expressions";
      context.updateCoverageAutomationPlan();
      const plan = context.document.getElementById("coverage-spend-plan").innerHTML;
      assert.ok(/4 paid requests/.test(plan), `NC-D4: the defect did not land — the quote still reads selections: ${plan}`);
      return `one missing expression priced as: ${plan.match(/Confirmed first submission: [^<]*/)}`;
    },
    guard: (suite) => suite.main(),
  });
}

async function nc5() {
  await control({
    id: "NC-D5",
    defect: "the coverage start handler stamps its run record before asking, so a refused submission overwrites automation state",
    files: {
      "public/coverage-automation.js": [[
        `    if (!requestCount) return toast(\`Every required \${sheetType === "expressions" ? "expression" : "view"} already has an image selected.\`);`,
        `    /* control: the refusal is moved behind the record write, as it was */`,
      ]],
    },
    probe: async (suite) => {
      const board = await suite.openCoverageBoard(suite.coverageFixture({ missing: [] }));
      const context = board.rendered.context;
      context.openCoverageAutomationModal("characters", "KAI", "individual");
      context.document.getElementById("coverage-mode").value = "individual";
      const before = vm.runInContext(`JSON.stringify(P.characters.find((r) => r.id === "KAI").coverageAutomation)`, context);
      await context.startCoverageAutomation(true);
      const after = vm.runInContext(`JSON.stringify(P.characters.find((r) => r.id === "KAI").coverageAutomation)`, context);
      assert.notStrictEqual(after, before, "NC-D5: the defect did not land — the record is still untouched");
      return `a zero-request submission rewrote the run record to status=${JSON.parse(after).status}`;
    },
    guard: (suite) => suite.main(),
  });
}

/* ================================================================ STAGE (B/C)
   =========================================================================== */

async function nc6() {
  await control({
    id: "NC-D6",
    defect: "the run record outranks approved frames again, so an approved frame reports Running",
    files: {
      "public/shared-stage-model.js": [[
        `    if (completion === "complete" && facts.activityStatus)`,
        `    if (false && facts.activityStatus)`,
      ]],
    },
    probe: async (suite) => {
      const Stage = require("../public/shared-stage-model.js");
      const state = Stage.shotStageState("frames", { ...suite.APPROVED_FRAMES_FACTS, activityStatus: "running" });
      assert.strictEqual(state.statusKey, "running",
        "NC-D6: the defect did not land — approved frames still dominate");
      return `an approved required frame under a running run reports statusKey=${state.statusKey} tone=${state.tone}`;
    },
    guard: (suite) => suite.main(),
  });
}

async function nc7() {
  await control({
    id: "NC-D7",
    defect: "stage navigation follows the colour again, so a completed stage carrying a live run stops being where the shot opens",
    files: {
      "public/shared-stage-model.js": [[
        `    const working = states.find((state) => state.activity);
    if (working) return working.id;`,
        `    /* control: navigation is read off the tone again */`,
      ]],
    },
    probe: async (suite) => {
      const Stage = require("../public/shared-stage-model.js");
      const id = Stage.recommendedShotStageId({ ...suite.APPROVED_FRAMES_FACTS, activityStatus: "running" });
      assert.notStrictEqual(id, "frames", "NC-D7: the defect did not land — frames is still recommended");
      return `a shot whose live run is on Frames now opens on "${id}"`;
    },
    guard: (suite) => suite.main(),
  });
}

async function nc8() {
  await control({
    id: "NC-D8",
    defect: "a route that needs no frame counts a fraction of a requirement that does not exist",
    files: {
      "public/shared-stage-model.js": [[
        `        statusKey: retainedFramesComplete ? "approved" : facts.frameApprovedCount ? "inProgress" : "notRequired",`,
        `        statusKey: retainedFramesComplete ? "approved" : facts.frameApprovedCount ? "inProgress" : "notStarted",`,
      ]],
    },
    probe: async (suite) => {
      const stages = await suite.shotStages(suite.shotFixture("r2v"), []);
      const frames = stages.byId.frames;
      assert.strictEqual(frames.statusKey, "notStarted",
        "NC-D8: the defect did not land — the stage still reports Not required");
      return `an r2v shot that needs no authored frame reports statusKey=${frames.statusKey}`;
    },
    guard: (suite) => suite.main(),
  });
}

async function nc9() {
  await control({
    id: "NC-D9",
    defect: "a skipped optional stage claims attention again for guides nobody chose",
    files: {
      "public/shared-stage-model.js": [[
        `      if (stage.optional && facts.downstreamAuthorityApproved) {`,
        `      if (false) {`,
      ]],
    },
    probe: async (suite) => {
      const moved = suite.shotFixture("i2v");
      moved.shots[0].keyframes = [moved.shots[0].keyframes[0]];
      moved.shots[0].clips = [];
      moved.mediaAssets.push({
        id: "blocking-skipped", file: "L1-01_BLOCKING_B01.png", storagePath: "shots/L1-01/blocking/L1-01_BLOCKING_B01.png",
        title: "L1-01 blocking B01", kind: "image", notes: "",
        links: [{ id: "blocking-link-skipped", targetType: "shot", targetId: "L1-01", role: "blocking-frame", blockingState: "returned", blockingVersion: "B01", generationInput: false, order: 1 }],
      });
      const stages = await suite.shotStages(moved, ["FRAME_A.png"]);
      assert.strictEqual(stages.byId.look.tone, "attention",
        "NC-D9: the defect did not land — the optional stage still stands down");
      return `a skipped optional stage on a shot with approved frames reports tone=${stages.byId.look.tone} statusKey=${stages.byId.look.statusKey}`;
    },
    guard: (suite) => suite.main(),
  });
}

async function nc10() {
  await control({
    id: "NC-D10",
    defect: "Deliver infers its prerequisite from a lifecycle label again, so an approved still is told to approve a still",
    files: {
      "public/shared-stage-model.js": [[
        `    if (facts.approvedResultAvailable || facts.lifecycleKey === "motion-approved" || facts.lifecycleKey === "still-ready")`,
        `    if (facts.lifecycleKey === "motion-approved" || facts.lifecycleKey === "still-ready")`,
      ]],
    },
    probe: async (suite) => {
      const animate = suite.shotFixture("i2v");
      animate.shots[0].keyframes = [animate.shots[0].keyframes[0]];
      const stages = await suite.shotStages(animate, ["FRAME_A.png"]);
      assert.strictEqual(stages.byId.deliver.availability, "blocked",
        "NC-D10: the defect did not land — Deliver still asks the prerequisite");
      return `a shot with an approved still reports deliver=${stages.byId.deliver.availability} "${stages.byId.deliver.blockedReason}"`;
    },
    guard: (suite) => suite.main(),
  });
}

/* ================================================================ SEVERITY (D)
   =========================================================================== */

async function nc11() {
  await control({
    id: "NC-D11",
    defect: "the attention verdict ignores parent health, so a child under automatic recovery is a red NEEDS ATTENTION row",
    files: {
      "public/live-activity.js": [[
        `  return ["failed", "interrupted", "cancelled"].includes(run?.status) && !v670RunnerWentAway(run) && !v670RunRecovering(run);`,
        `  return ["failed", "interrupted", "cancelled"].includes(run?.status) && !v670RunnerWentAway(run);`,
      ]],
    },
    probe: async (suite) => {
      const rendered = await suite.shotStages(suite.shotFixture("i2v"), ["FRAME_A.png"]);
      const verdict = JSON.parse(vm.runInContext(`(() => {
        AUTOMATION_RUNS = ${JSON.stringify(suite.PARENT_RUN("failed", "running"))};
        const child = AUTOMATION_RUNS.find((row) => row.id === "scene-child");
        return JSON.stringify({ attention: v670AttentionRun(child), recovering: v670RunRecovering(child) });
      })()`, rendered.rendered.context));
      assert.strictEqual(verdict.attention, true,
        "NC-D11: the defect did not land — the recovering child is still excluded");
      return `a child being retried inside a machine-active parent reports attention=${verdict.attention} (recovering=${verdict.recovering})`;
    },
    guard: (suite) => suite.main(),
  });
}

async function nc12() {
  await control({
    id: "NC-D12",
    defect: "the drawer paints a healthy run's past step failure as an error the director is handed",
    files: {
      "public/live-activity.js": [[
        `\${failed?.error && unhealthy ? \``,
        `\${failed?.error ? \``,
      ]],
    },
    probe: async (suite) => {
      const rendered = await suite.shotStages(suite.shotFixture("i2v"), ["FRAME_A.png"]);
      const html = (() => {
        vm.runInContext(`AUTOMATION_RUNS = ${JSON.stringify([{
          id: "solo-running", type: "shot-chain", targetId: "L1-01", scope: "stills", label: "Continuing run",
          status: "running", stage: "Frame B", summary: "Still working.", createdAt: "2026-08-26T10:00:00Z", updatedAt: "2026-08-26T10:06:00Z",
          runnerId: "runner-2", leaseExpiresAt: "2099-01-01T00:00:00Z", heartbeatAt: "2026-08-26T10:06:00Z",
          config: {}, usage: {}, logs: [],
          steps: { "frame:frame-a:round-1:generate": { key: "frame:frame-a:round-1:generate", kind: "generation", status: "failed", label: "Generate Frame A", error: "Provider returned 502." } },
        }])}; V641_ACTIVITY_DRAWER_OPEN = true; v641RenderActivityDrawer();`, rendered.rendered.context);
        return rendered.rendered.context.document.getElementById("automation-activity-drawer").innerHTML;
      })();
      assert.ok(/automation-drawer-error/.test(html),
        "NC-D12: the defect did not land — the healthy run still shows no error style");
      return `a running run with a past failed step is painted: ${html.match(/<small class="automation-drawer-error">[^<]*<\/small>/)}`;
    },
    guard: (suite) => suite.main(),
  });
}

async function nc13() {
  await control({
    id: "NC-D13",
    defect: "severity ignores recovery, so a retried step is attention while the automation continues",
    files: {
      "public/shared-stage-model.js": [[
        `      const recovering = facts.activityHealth === "recovering" || facts.activityHealth === "healthy";`,
        `      const recovering = false;`,
      ]],
    },
    probe: async () => {
      const Stage = require("../public/shared-stage-model.js");
      const state = Stage.shotStageState("frames", {
        routeRequirementsKnown: true, requiredFrameCount: 2, requiredFramesApproved: false,
        frameTotal: 2, frameApprovedCount: 1, activityStatus: "failed", activityHealth: "recovering",
      });
      assert.strictEqual(state.tone, "attention",
        "NC-D13: the defect did not land — recovery is still neutral");
      return `a stage under active recovery reports tone=${state.tone} statusKey=${state.statusKey}`;
    },
    guard: (suite) => suite.main(),
  });
}

/* =============================================================== FRESHNESS (E)
   =========================================================================== */

async function nc14() {
  await control({
    id: "NC-D14",
    defect: "the H3 paid control ignores package freshness, so OUT OF DATE sits beside an enabled GENERATE",
    files: {
      "public/fal-generation.js": [[
        `  if (freshness && freshness.recorded && !freshness.current)
    return \`<button class="approve-btn h3-generate-btn" disabled`,
        `  if (false)
    return \`<button class="approve-btn h3-generate-btn" disabled`,
      ]],
    },
    probe: async (suite) => {
      const view = await suite.openMotionStage(suite.motionPackageFixture({ stale: true }), ["FRAME_A.png"]);
      const action = vm.runInContext(`(() => {
        const shot = P.shots.find((row) => row.id === "L1-01");
        const build = resolvePromptBuildList(P, ensureShotCreation(shot).motionPromptBuilds)[0];
        return falH3MotionPromptAction("L1-01", build.id, { id: build.profileId, name: build.profileName, family: "minimax-h3", mode: "i2v" });
      })()`, view.rendered.context);
      assert.ok(/openFalH3MotionModal/.test(action),
        "NC-D14: the defect did not land — the paid control is still withheld");
      return `an out-of-date package draws: ${action}`;
    },
    guard: (suite) => suite.main(),
  });
}

async function nc15() {
  await control({
    id: "NC-D15",
    defect: "the H3 dispatch boundary ignores package freshness, so a programmatically opened dialog spends on a stale package",
    files: {
      "public/fal-generation.js": [[
        `  if (gateFreshness && gateFreshness.recorded && !gateFreshness.current)`,
        `  if (false)`,
      ]],
    },
    probe: async (suite) => {
      const view = await suite.openMotionStage(suite.motionPackageFixture({ stale: true }), ["FRAME_A.png"]);
      /* The refusal MESSAGE is the observable, because the harness has no live
         provider behind the route and a suite that only counted POSTs could not
         tell "refused for the right reason" from "the stub answered nothing". */
      const said = await vm.runInContext(`(async () => {
        const heard = [];
        const priorToast = toast;
        toast = (message) => { heard.push(String(message)); };
        try {
          window._falH3MotionRequest = { shotId: "L1-01", buildId: "build-h3-1", profileId: "minimax-h3/i2v", prompt: "x", compiledPrompt: "x" };
          window._falH3Submitting = false;
          document.getElementById("fal-h3-prompt-editor").value = "The worker turns from the panel and walks out of frame.";
          await startFalH3MotionGeneration();
        } finally { toast = priorToast; }
        return JSON.stringify(heard);
      })()`, view.rendered.context);
      assert.ok(!/out of date/i.test(said),
        `NC-D15: the defect did not land — the dispatch boundary still refuses: ${said}`);
      /* What the handler says INSTEAD is a downstream gate — the aspect check on
         a hand-built request. That is the proof: with the freshness question
         removed, an out-of-date package is no longer stopped here and execution
         carries on past the point that was supposed to end it. */
      return `a stale package walked past the freshness gate at the paid boundary; the next thing to stop it was ${said}`;
    },
    guard: (suite) => suite.main(),
  });
}

async function nc16() {
  await control({
    id: "NC-D16",
    defect: "the freshness gate refuses an unrecorded snapshot too, blocking every package compiled before dependencies were captured",
    /* TWO EDITS, because the `recorded` conjunct only bites once something can
       report an absence AS staleness. The first arms exactly that — a plausible
       future rule that treats "nothing was recorded" as a reason — and the second
       drops the guard that would still have let it through. Together they produce
       the defect this control is named for: a package nobody can check is refused
       on evidence nobody has. */
    files: {
      "public/review-provenance.js": [[
        `  const saved = pack?.dependencySnapshot;
  if (!saved) return [];`,
        `  const saved = pack?.dependencySnapshot;
  if (!saved) return ["no dependency snapshot was recorded"];`,
      ]],
      "public/fal-generation.js": [[
        `  if (freshness && freshness.recorded && !freshness.current)
    return \`<button class="approve-btn h3-generate-btn" disabled`,
        `  if (freshness && !freshness.current)
    return \`<button class="approve-btn h3-generate-btn" disabled`,
      ]],
    },
    probe: async (suite) => {
      const view = await suite.openMotionStage(suite.motionPackageFixture({ recorded: false }), ["FRAME_A.png"]);
      const action = vm.runInContext(`(() => {
        const shot = P.shots.find((row) => row.id === "L1-01");
        const build = resolvePromptBuildList(P, ensureShotCreation(shot).motionPromptBuilds)[0];
        return falH3MotionPromptAction("L1-01", build.id, { id: build.profileId, name: build.profileName, family: "minimax-h3", mode: "i2v" });
      })()`, view.rendered.context);
      assert.ok(/data-h3-generate-blocked/.test(action),
        "NC-D16: the defect did not land — an unrecorded snapshot is still not treated as stale");
      return `an uncheckable package is blocked with reasons="${(action.match(/data-h3-stale-reasons="([^"]*)"/) || [])[1]}"`;
    },
    guard: (suite) => suite.main(),
  });
}

/* ==================================================================== runner */

async function main() {
  await nc1();
  await nc2();
  await nc3();
  await nc4();
  await nc5();
  await nc6();
  await nc7();
  await nc8();
  await nc9();
  await nc10();
  await nc11();
  await nc12();
  await nc13();
  await nc14();
  await nc15();
  await nc16();

  /* THE TREE IS BACK. Each control restores its files in a `finally`, and these
     read the bytes on disk rather than trusting that it happened. */
  assert.ok(readLF("public/shared-coverage.js").includes("function coverageRunReconciliation(run, coverage) {"),
    "public/shared-coverage.js was not restored");
  assert.ok(readLF("public/coverage-automation.js").includes("const state = coverageRunState(list, entity);"),
    "public/coverage-automation.js was not restored");
  assert.ok(readLF("public/entities.js").includes(`const live = typeof coverageRunState === "function" ? coverageRunState(list, entity, run) : null;`),
    "public/entities.js was not restored");
  assert.ok(readLF("public/shared-stage-model.js").includes(`if (completion === "complete" && facts.activityStatus)`),
    "public/shared-stage-model.js was not restored");
  assert.ok(readLF("public/live-activity.js").includes("function v670RunRecovering(run) {"),
    "public/live-activity.js was not restored");
  assert.ok(readLF("public/fal-generation.js").includes("if (gateFreshness && gateFreshness.recorded && !gateFreshness.current)"),
    "public/fal-generation.js was not restored");

  /* AND THE PRODUCT IS GREEN ON THE RESTORED TREE, which is the only proof that
     every control above was measuring its own defect rather than a leftover. */
  await freshSuite().main();

  console.log(`Dogfood truth reconciliation negative controls passed — ${results.length} defects introduced, ${results.length} caught:`);
  for (const line of results) console.log("  " + line);
  console.log("  literal bad states produced:");
  for (const line of literals) console.log("    " + line);
  console.log("  tree restored · no provider call · no paid call · nothing written to any project");
}

module.exports = { main };

if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});

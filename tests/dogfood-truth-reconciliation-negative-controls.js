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
 *   NC-D15  the H3 dispatch boundary ignores package freshness, so an
 *           out-of-date package reaches POST /api/generation/fal/jobs
 *   NC-D16  the freshness gate refuses an UNRECORDED snapshot too, so every
 *           package compiled before dependencies were captured is blocked
 *   NC-D17  the submission handler derives its request list from the angle board
 *           again, so an expression task submits an angle
 *   NC-D18  the dispatch boundary stops checking that a slot belongs to the
 *           group its request declares
 *
 * EVERY CONTROL DECLARES WHICH DETECTOR IT EXPECTS. `expect` is a regular
 * expression over the detector's own message, and a failure that does not match
 * it fails THIS suite. Independent review found the previous helper accepting any
 * AssertionError, which is a weaker claim than it reads as: a control that armed
 * one defect and tripped an unrelated assertion elsewhere reported success while
 * the protection it named went untested. The message that actually fired is
 * printed beside every control, so the pairing can be read rather than trusted.
 *
 * Nothing here contacts a provider, spends anything, or writes to a project. The
 * patched files are restored from their ORIGINAL BYTES in a `finally` — never by
 * `git checkout`, which this repository has already lost unstaged work to.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { terminalHtml } = require("./terminal-view");

const ROOT = path.resolve(__dirname, "..");
const readLF = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");

const results = [];
const literals = [];
/* What the intended detector actually said, printed beside the defect it caught. */
const caughtBy = [];

/* ---------------------------------------------------------------- machinery */

/* Require a body to fail, BY ASSERTION, FOR THE INTENDED REASON.
 *
 * HOLD BLOCKER 2, part B. This used to accept any AssertionError, which is a
 * weaker claim than it reads as: a control that armed one defect and tripped an
 * unrelated assertion somewhere else in the suite reported success. The suite
 * would then be green while the protection it named was untested.
 *
 * Every control now declares `expect` — a regular expression over the detector's
 * own message — and a failure that does not match it is a FAILURE OF THE CONTROL,
 * reported with what actually fired so the mismatch can be read rather than
 * guessed at. This is the same `expect:` discipline
 * tests/founder-smoke-p0-trust-negative-controls.js already applies. */
async function expectRed(id, expect, body) {
  assert.ok(expect instanceof RegExp, `${id}: a control must declare which detector it expects to fire`);
  let threw = null;
  try { await body(); } catch (error) { threw = error; }
  assert.ok(threw, `${id}: the defect was introduced and NOTHING caught it — that assertion cannot fail`);
  assert.ok(threw instanceof assert.AssertionError || /AssertionError/.test(String(threw && threw.name)),
    `${id}: the detector must fail by assertion, not by crashing (${threw && threw.message})`);
  const message = String((threw && threw.message) || "");
  assert.ok(expect.test(message),
    `${id}: the suite went red for the WRONG REASON. Expected ${expect} but the detector said: ${message.slice(0, 400)}`);
  return message;
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

async function control({ id, defect, files, probe, guard, expect }) {
  await patchedFiles(files, async () => {
    const literal = await probe(freshSuite());
    assert.ok(literal, `${id}: the probe must produce the literal bad state, not merely run`);
    literals.push(`${id} → ${literal}`);
    const caught = await expectRed(id, expect, () => guard(freshSuite()));
    caughtBy.push(`${id} ← ${caught.split("\n")[0].slice(0, 150)}`);
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
    expect: /the banner must report the live goal/,
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
    expect: /a satisfied goal must expose no resume-missing-views control/,
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
    expect: /an unestablished coverage answer must stay unknown/,
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
    expect: /the quote must price an empty work set at nothing/,
    defect: "the spend plan reads the retired approvedFile key, so every assigned view is priced as a paid request",
    files: {
      "public/coverage-automation.js": [[
        `      .filter((slot) => slot && !slot.retired && isRequiredCoverage(slot) && !slotSelectedFile(slot));`,
        `      .filter((slot) => slot && !slot.retired && isRequiredCoverage(slot) && !slot.approvedFile);`,
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

/* NC-D5 — RETIRED, AND MOVED RATHER THAN DROPPED.
 *
 * It guarded "a refused submission must not stamp a new run record over the old one", by
 * removing the early zero-work guard in startCoverageAutomation() and watching
 * entity.coverageAutomation get overwritten with `status: "starting"` for work that never
 * happened.
 *
 * That harm is no longer reachable from this file. Paid Request Truth V1 made the run
 * record SERVER-OWNED — public/coverage-automation.js no longer writes it at all, and
 * server.js's prepareSuccessor() restores the authoritative copy over anything an
 * ordinary save carries — so there is no browser line whose removal stamps a run. A
 * control kept pointing at a line that cannot cause its harm is a control reporting on
 * guards it is not testing, which is the failure mode the harness self-checks exist for.
 *
 * The property did not go away with it. Two controls in
 * tests/paid-request-truth-negative-controls.js hold it now, at the seams that own it:
 *
 *   - "a coverage route that records its run before it validates the request" — the same
 *     defect, exactly: a refused request stamping a run;
 *   - "a paid surface granted by state a generic project save can write" — the ownership
 *     rule that stops anything else authoring one.
 *
 * Deleted here rather than weakened, and named so the deletion is auditable. */

/* ================================================================ STAGE (B/C)
   =========================================================================== */

async function nc6() {
  await control({
    id: "NC-D6",
    expect: /an approved frame must not be headlined by a run status/,
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
    expect: /a stage carrying a live run must still be the recommended destination/,
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
    expect: /Frames must say Not required rather than Not started/,
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
    expect: /a skipped optional stage says Optional/,
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
    expect: /Deliver must not be blocked while an approved result exists/,
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
    expect: /the child must not claim the director's attention/,
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
    expect: /a healthy run must not paint a past step failure as a fault the director is handed/,
    defect: "the Terminal paints a healthy run's past step failure as an error the director is handed",
    /* A1 moved this guard with the surface. The drawer chose its error STYLE from run
       health; the Terminal row chooses it from the row's own tone, which is the same
       verdict from the same predicates. Breaking it styles every recorded message as a
       fault, including one a still-running run already retried past. */
    files: {
      "public/creator-surfaces.js": [[
        `tone === "attention" ? "cb-terminal-error" : "cb-terminal-note"`,
        `"cb-terminal-error"`,
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
        }])}; `, rendered.rendered.context);
        return terminalHtml(rendered.rendered.context);
      })();
      assert.ok(/cb-terminal-error/.test(html),
        "NC-D12: the defect did not land — the healthy run still shows no error style");
      return `a running run with a past failed step is painted: ${html.match(/<small class="cb-terminal-error">[^<]*<\/small>/)}`;
    },
    guard: (suite) => suite.main(),
  });
}

async function nc13() {
  await control({
    id: "NC-D13",
    expect: /failed[/]recovering: status key/,
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
    expect: /an out-of-date package must not carry an enabled paid control/,
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

/* NC-D15 — REBUILT FOR THE HOLD REVIEW.
 *
 * The first version hand-built `window._falH3MotionRequest` and, with the gate
 * removed, watched the request stop at the ASPECT check on that half-built
 * object. It therefore proved only that ONE EARLIER GATE HAD BEEN PASSED — not
 * that a stale package would actually reach the seam that spends money.
 *
 * This drives the REAL dialog on a fixture whose every unrelated prerequisite is
 * valid, and the suite's own E2 asserts that a CURRENT package on that same
 * fixture does reach `/api/generation/fal/jobs` with `purpose: "motion-h3"`. So
 * with the freshness protection removed the stale package must land there too —
 * and the probe below captures the literal unsafe request that arrives. */
async function nc15() {
  await control({
    id: "NC-D15",
    expect: /the boundary that spends money must fail closed on a stale package/,
    defect: "the H3 dispatch boundary ignores package freshness, so an out-of-date package reaches the paid route",
    files: {
      "public/fal-generation.js": [[
        `  if (gateFreshness && gateFreshness.recorded && !gateFreshness.current)`,
        `  if (false)`,
      ]],
    },
    probe: async (suite) => {
      const stale = await suite.openRealH3Dialog({ stale: true });
      /* THE MUTATION IS ARMED AND THE STALENESS IS REAL: the dialog still names
         it, because only the DISPATCH gate was removed. */
      assert.ok(/This compiled package is out of date/.test(stale.dialog()),
        "NC-D15: the fixture is not stale, so nothing about freshness is under test");
      const sent = await stale.submit();
      assert.strictEqual(sent.jobs.length, 1,
        `NC-D15: the defect did not land — the stale package still never reached the paid route (${JSON.stringify(sent.said)})`);
      const request = sent.jobs[0];
      assert.strictEqual(request.purpose, "motion-h3", "NC-D15: what landed must be the paid motion request itself");
      return `an out-of-date package reached POST /api/generation/fal/jobs: ${JSON.stringify({
        purpose: request.purpose,
        shotId: request.shotId,
        sourceBuildId: request.sourceBuildId,
        packageId: request.packageId,
        durationSeconds: request.durationSeconds,
        staleReasons: stale.staleReasons(),
      })}`;
    },
    guard: (suite) => suite.main(),
  });
}

async function nc16() {
  await control({
    id: "NC-D16",
    expect: /an uncheckable package keeps its paid action/,
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

/* ==================================================== HOLD BLOCKER 1 CONTROLS
   Two protections were added because independent review found the quote and the
   submission handler deriving work from different owners. Each gets a control
   that puts the split back. */

async function nc17() {
  await control({
    id: "NC-D17",
    expect: /an expression task with nothing missing must contact no generation route/,
    defect: "the submission handler derives its request list from the angle board again, so an expression task submits angles",
    files: {
      /* BOTH HALVES OF THE HELD CANDIDATE'S BEHAVIOUR, because they were one
         defect: the request list came from the angle board AND the payload
         declared the angle group, which is why the group check at the dispatch
         boundary saw a coherent request and let it through. Arming only the
         first would be caught by the second protection and would report a
         defect the reviewer never observed. */
      "public/coverage-automation.js": [[
        `    const requestedSlots = mode === "individual" ? missingCoverageWork(req.list, entity, sheetType) : [];`,
        `    const requestedSlots = mode === "individual" ? missingCoverageSlots(req.list, entity, false) : [];`,
      ], [
        `coverageSheetType: sheetType === "expressions" ? "expressions" : "", coverageMode: mode, requestCount, maximumImages: imageCount, slot,`,
        `coverageSheetType: "", slot,`,
      ]],
    },
    probe: async (suite) => {
      /* The reviewer's observation A, exactly: expressions complete, one angle
         missing, and the EXPRESSION dialog driven. */
      const run = await suite.submitCoverageTask(
        suite.coverageFixture({ missing: ["rear"], missingExpressions: [] }),
        { sheetType: "expressions" },
      );
      assert.ok(/data-coverage-spend-plan="none"/.test(run.quote),
        "NC-D17: the quote is no longer saying there is nothing to submit, so the split is not what is under test");
      assert.strictEqual(run.requests.length, 1,
        `NC-D17: the defect did not land — the handler still submitted nothing: ${JSON.stringify(run.requests)}`);
      const after = JSON.parse(run.after);
      return `the expression dialog quoted "No paid request to submit" and the handler POSTed ${run.requests[0].targetCoverageSlotId} `
        + `[${run.requests[0].coverageSheetType}], rewriting the run record to status=${after.status}`;
    },
    guard: (suite) => suite.main(),
  });
}

async function nc18() {
  await control({
    id: "NC-D18",
    expect: /an angle slot submitted under the expression group must be refused/,
    defect: "the dispatch boundary stops checking that a slot belongs to the group its request declares",
    files: {
      "public/coverage-automation.js": [[
        `    if (options.coverageJobType === "slot") {\n      const group = String(options.coverageSheetType || "") === "expressions" ? "expressions" : "angles";`,
        `    if (false) {\n      const group = String(options.coverageSheetType || "") === "expressions" ? "expressions" : "angles";`,
      ]],
    },
    probe: async (suite) => {
      const board = await suite.openCoverageBoard(suite.coverageFixture({ missing: ["rear"], missingExpressions: ["worried"] }), {
        fetch: async (url, init = {}, respond) => {
          /* Coverage dispatch is a SERVER operation now — the browser asks
             /api/generation/fal/coverage/jobs to run it. */
          if (String(url) !== "/api/generation/fal/coverage/jobs" || init.method !== "POST") return null;
          return respond({ ok: true, job: { id: "control-job", status: "IN_QUEUE", ...JSON.parse(init.body) } });
        },
      });
      const said = JSON.parse(await vm.runInContext(`(async () => {
        const api = window.__CINEBRAID_COVERAGE_AUTOMATION;
        const entity = P.characters.find((row) => row.id === "KAI");
        const angle = ensureCoverageSlots("characters", entity).find((row) => row.id === "rear");
        try {
          await api.submitCoverageJob("characters", entity, {
            prompt: "control", outputCount: 3, resolution: "4k", aspectRatio: "1:1",
            coverageJobType: "slot", coverageSheetType: "expressions", slot: angle,
            clientRequestId: "control-cross-group",
          });
          return JSON.stringify({ submitted: true });
        } catch (error) { return JSON.stringify({ submitted: false, message: String((error && error.message) || error) }); }
      })()`, board.rendered.context));
      assert.strictEqual(said.submitted, true,
        `NC-D18: the defect did not land — the boundary still refuses (${said.message})`);
      const reached = board.posts
        .filter((row) => String(row.url).includes("/api/generation/"))
        .map((row) => JSON.parse(row.body));
      assert.strictEqual(reached.length, 1, "NC-D18: the cross-group request must actually reach the paid route");
      return `the angle slot ${reached[0].targetCoverageSlotId} reached the paid route declared as `
        + `coverageSheetType=${reached[0].coverageSheetType}`;
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
  await nc17();
  await nc18();

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

  console.log(`Dogfood truth reconciliation negative controls passed — ${results.length} defects introduced, ${results.length} caught by their intended detector:`);
  for (const line of results) console.log("  " + line);
  console.log("  the detector that fired:");
  for (const line of caughtBy) console.log("    " + line);
  console.log("  literal bad states produced:");
  for (const line of literals) console.log("    " + line);
  console.log("  tree restored · no provider call · no paid call · nothing written to any project");
}

module.exports = { main };

if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});

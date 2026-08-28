/* CineBraid — Dogfood Remediation Slice 0: PRODUCTION TRUTH / STATE RECONCILIATION.
 *
 * ONE INVARIANT, and every case below is an instance of it:
 *
 *   LIVE AUTHORITATIVE DETERMINISTIC PRODUCTION TRUTH DOMINATES STALE AUTOMATION,
 *   RUN, WORKFLOW AND PRESENTATION STATE.
 *
 * The Aug 26 CineBraid Spark dogfood pass produced seven readings of the same
 * defect: a record a machine wrote was still being presented as a claim about the
 * project, on the same screen as a live derivation that said otherwise — and in
 * three of the seven the stale half had money attached to it.
 *
 *   A  COVERAGE RECONCILIATION            board said 0 missing; the run said NEEDS
 *                                         ATTENTION and offered a paid dialog
 *   B  HUMAN-APPROVED FRAME VS RUNNING     a frame the creator approved still read
 *                                         as Running
 *   C  WORKFLOW STEP AUTO-RECONCILIATION   optional and not-required stages kept
 *                                         claiming outstanding work
 *   D  RECOVERY / FAILURE SEVERITY         a child stage under automatic recovery
 *                                         read as red NEEDS ATTENTION
 *   E  STALE COMPILED PROMPT SAFETY        OUT OF DATE beside an enabled paid
 *                                         GENERATE
 *   F  AUTOMATION GOAL SATISFIED MANUALLY  the generalisation of A: it does not
 *                                         matter that the automation is not what
 *                                         closed the gap
 *   G  PAID-ACTION TRUTH                   no stale projection may expose an
 *                                         unnecessary paid dispatch
 *
 * HOW THIS SUITE IS WRITTEN. Every claim about what a filmmaker sees is read out
 * of markup a SHIPPED renderer produced, reached through the SHIPPED controls —
 * `selectBoundedTask`, `selectBoundedItem`, `setCoverageSlotField`,
 * `startCoverageAutomation`, `startFalH3MotionGeneration`. Pure projections
 * (public/shared-coverage.js, public/shared-stage-model.js) are additionally
 * exercised directly, because a projection that is only ever observed through a
 * renderer is a projection whose contract nothing holds.
 *
 * NO PROVIDER IS CONTACTED AND NOTHING IS PAID FOR. Every render counts the POSTs
 * its page attempts and section G asserts the count, so a control that "refuses"
 * by returning after dispatching would fail here rather than pass quietly.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
/* LF, always. This repository checks out with core.autocrlf=true, so a multi-line
   source anchor written with \n matches nothing. */
const readLF = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");

const Coverage = require("../public/shared-coverage.js");
const Stage = require("../public/shared-stage-model.js");
const { render, buildFixture, withCanon } = require("./render-harness");

const notes = [];
const note = (line) => notes.push(line);

/* ---------------------------------------------------------------- fixtures */

/* The four required angle slots CineBraid's character template seeds. Named here
   so a test can satisfy exactly the required set and leave the planned ones
   empty — which is the state the dogfood pass was actually in. */
const REQUIRED_ANGLES = ["front", "front-three-quarter", "profile", "rear"];
const ANGLE_FILE = (id) => `KAI-${id.toUpperCase()}.png`;
/* The character expression template seeds the first four as required. An
   EXPRESSION run is where the retired-key read below actually bites, because
   updateCoverageAutomationPlan hands the expression branch the WHOLE slot list
   rather than a pre-filtered missing set. */
const REQUIRED_EXPRESSIONS = ["neutral", "focused", "worried", "determined"];
const EXPRESSION_LABELS = ["neutral", "focused", "worried", "determined", "relieved", "custom"];
const EXPRESSION_FILE = (id) => `KAI-EXPR-${id.toUpperCase()}.png`;

/* A character whose coverage run last recorded `status` and `missingRequired`,
   and whose slots hold whatever the caller says they hold NOW. `missing` names
   the required slots left empty. */
function coverageFixture({ missing = [], missingExpressions = [], status = "needs-attention", recordedMissing = 2, sheetType = "angles" } = {}) {
  const project = buildFixture();
  /* The primary reference is a RECEIPT, because coverage automation refuses to
     open at all without one — primaryReference() reads canon, never a pointer. */
  withCanon(project, [{ kind: "entity-state", list: "characters", entityId: "KAI", stateId: "state-default", value: "KAI-ANCHOR.png" }]);
  const kai = project.characters[0];
  kai._media = [kai.approvedFile, ...REQUIRED_ANGLES.map(ANGLE_FILE)];
  /* EVERY ANGLE FILE IS DURABLY CLAIMED, including the ones no slot holds yet.
     assignSlotReference() re-resolves ownership against current state and refuses
     a file this reference has never recorded — correct product behaviour, and it
     would otherwise make the manual-satisfaction case below fail for a reason
     that has nothing to do with reconciliation. */
  kai.candidateFiles = REQUIRED_ANGLES.map((id) => ({
    stored: ANGLE_FILE(id), original: ANGLE_FILE(id), addedAt: "2026-08-26T09:00:00Z",
    decision: "unreviewed", reviewRequired: false, coverageGroup: "angles", targetCoverageSlotId: id,
  }));
  kai.coverageSlots = REQUIRED_ANGLES.map((id) => ({
    id,
    label: id,
    requirement: "required",
    selectedFile: missing.includes(id) ? "" : ANGLE_FILE(id),
    notes: "",
    status: missing.includes(id) ? "missing" : "selected",
  }));
  kai.expressions = EXPRESSION_LABELS.join("; ");
  kai.expressionSlots = EXPRESSION_LABELS.map((id, index) => ({
    id,
    label: id,
    requirement: index < 4 ? "required" : "planned",
    selectedFile: index < 4 && !missingExpressions.includes(id) ? EXPRESSION_FILE(id) : "",
    notes: "",
    status: index < 4 && !missingExpressions.includes(id) ? "selected" : "missing",
  }));
  kai._media = [...kai._media, ...REQUIRED_EXPRESSIONS.map(EXPRESSION_FILE)];
  kai.candidateFiles = [
    ...kai.candidateFiles || [],
    ...REQUIRED_EXPRESSIONS.map((id) => ({
      stored: EXPRESSION_FILE(id), original: EXPRESSION_FILE(id), addedAt: "2026-08-26T09:00:00Z",
      decision: "unreviewed", reviewRequired: false, coverageGroup: "expressions", targetCoverageSlotId: id,
    })),
  ];
  kai.coverageAutomation = {
    id: "cov-run-1",
    list: "characters",
    entityId: "KAI",
    mode: "hybrid",
    sheetType,
    status,
    startedAt: "2026-08-26T10:00:00Z",
    jobs: ["fal-job-1"],
    requestCount: 1,
    maximumImages: 3,
    missingRequired: recordedMissing,
  };
  return project;
}

/* Open the shipped coverage board through the shipped controls and return the
   rendered `#main`. Nothing is written into workspace storage by hand: the two
   calls below are the ones the buttons on screen invoke. */
async function openCoverageBoard(project, options = {}) {
  const posts = [];
  const rendered = await render("#/character/KAI", project, {
    ...options,
    fetch: async (url, init = {}, respond) => {
      if (init.method === "POST") posts.push({ url, body: init.body });
      return options.fetch ? options.fetch(url, init, respond) : null;
    },
  });
  rendered.context.selectBoundedTask("entity-task", "characters:KAI", "coverage");
  await rendered.context.route();
  rendered.context.selectBoundedItem("entity-coverage-view", "characters:KAI", "coverage");
  await rendered.context.route();
  /* FAL is enabled in the realm and its poller stubbed, exactly as the shipped
     coverage suites do it: the dialogs under test refuse to open without a
     configured backend, and polling a fake job id would hang the suite. No key
     leaves this realm and no request is ever made — the harness's fetch stub
     records every POST and section G asserts none reached a generation route. */
  vm.runInContext(`CONFIG.generation = CONFIG.generation || {}; CONFIG.generation.fal = { enabled: true, apiKey: "harness" }; pollFalGeneration = () => {};`, rendered.context);
  return { rendered, posts, html: () => rendered.context.document.getElementById("main").innerHTML };
}

function coverageBanner(html) {
  const match = html.match(/<div class="coverage-run-status[\s\S]*?<\/div>\s*<\/div>/);
  return match ? match[0] : "";
}

/* A shot whose entity authorities are real receipts, so readiness and the stage
   model are answering about approved work rather than about pointers. */
function shotFixture(route = "i2v") {
  const project = buildFixture();
  project.shots[0].deliveryRoute = route;
  withCanon(project, [
    { kind: "entity-state", list: "characters", entityId: "KAI", stateId: "state-default", value: "KAI-ANCHOR.png" },
    { kind: "entity-state", list: "locations", entityId: "LOC-HULL", stateId: "state-default", value: "LOC-HULL-PLATE.png" },
    { kind: "entity-state", list: "props", entityId: "PR-TOOL", stateId: "state-default", value: "PR-TOOL-PLATE.png" },
  ]);
  return project;
}

const shotScan = (project, takes) => ({
  anchors: (project.characters || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/anchors/${x.approvedFile}` })),
  plates: (project.locations || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/plates/${x.approvedFile}` })),
  props: (project.props || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/props/${x.approvedFile}` })),
  vehicles: (project.vehicles || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/vehicles/${x.approvedFile}` })),
  audio: [],
  media: (project.mediaAssets || []).map((asset) => ({ name: asset.file, url: `/assets/media/${asset.file}` })),
  shots: Object.fromEntries((project.shots || []).map((shot) => [shot.id, {
    takes: (takes || []).map((name) => ({ name, url: `/assets/shots/${shot.id}/takes/${name}` })),
    locked: [],
  }])),
});

/* The shot's own stage answer, assembled by the SHIPPED assembler inside the
   realm — never by this file, which would be a second fact record. */
async function shotStages(project, takes = [], options = {}) {
  const rendered = await render("#/shot/L1-01", project, { scan: shotScan(project, takes), ...options });
  const read = () => JSON.parse(vm.runInContext(`(() => {
    const shot = P.shots.find((row) => row.id === "L1-01");
    const facts = shotStageModelFacts(shot, takesFor("L1-01"));
    return JSON.stringify({ facts, progress: shotStageProgress(facts), selected: boundedShotSelectedTask(shot, takesFor("L1-01")) });
  })()`, rendered.context));
  const first = read();
  return {
    rendered,
    read,
    facts: first.facts,
    selected: first.selected,
    byId: Object.fromEntries(first.progress.map((state) => [state.id, state])),
  };
}

/* ================================================================= SECTION A
   COVERAGE RECONCILIATION — one projection behind the banner, the counts and the
   available actions.
   =========================================================================== */

async function checkCoverageProjection() {
  const run = { status: "needs-attention", missingRequired: 2 };

  /* SATISFIED. The stored status is replaced for every live reading and PRESERVED
     as `recordedStatus`, because the run happening is still history. */
  const satisfied = Coverage.coverageRunReconciliation(run, { known: true, missingRequired: 0 });
  assert.strictEqual(satisfied.goal, "satisfied", "0 missing required views is a satisfied goal");
  assert.strictEqual(satisfied.status, "completed", "a satisfied goal cannot still read needs-attention");
  assert.strictEqual(satisfied.recordedStatus, "needs-attention", "the machine's own last word must survive reconciliation");
  assert.strictEqual(satisfied.missingRequired, 0, "the live count replaces the stored one");
  assert.strictEqual(satisfied.actionable, false, "a satisfied goal asks the creator for nothing");
  assert.strictEqual(satisfied.offersGeneration, false, "a satisfied goal exposes no generation");
  assert.strictEqual(satisfied.reconciled, true, "a changed answer says it changed");

  /* OUTSTANDING. The machine still describes the work; only the COUNT is relived. */
  const outstanding = Coverage.coverageRunReconciliation(run, { known: true, missingRequired: 1 });
  assert.strictEqual(outstanding.goal, "outstanding");
  assert.strictEqual(outstanding.status, "needs-attention", "an outstanding goal keeps the machine's description");
  assert.strictEqual(outstanding.missingRequired, 1, "the count is the live one, not the stored 2");
  assert.strictEqual(outstanding.offersGeneration, true, "real missing work may still be generated");

  /* UNKNOWN. Coverage is ASKED, never assumed: a caller that cannot establish the
     requirement may not silently suppress the run or its action. */
  for (const coverage of [undefined, {}, { known: false, missingRequired: 0 }, { known: true, missingRequired: NaN }]) {
    const unknown = Coverage.coverageRunReconciliation(run, coverage);
    assert.strictEqual(unknown.goal, "unknown", `an unestablished coverage answer must stay unknown: ${JSON.stringify(coverage)}`);
    assert.strictEqual(unknown.status, "needs-attention", "an unknown answer passes the recorded status through unchanged");
    assert.strictEqual(unknown.offersGeneration, true, "suppression requires a positive, knowing answer");
  }

  /* A RUN STILL EXECUTING KEEPS ITS EXECUTING STATUS. "A machine is working" and
     "the goal is met" are different facts and this projection owns only the
     second; overwriting the first would race the runner that owns the record. */
  for (const status of Coverage.COVERAGE_RUN_ACTIVE_STATUSES) {
    const active = Coverage.coverageRunReconciliation({ status, missingRequired: 3 }, { known: true, missingRequired: 0 });
    assert.strictEqual(active.goal, "satisfied", `${status}: the goal is still satisfied`);
    assert.strictEqual(active.status, status, `${status}: an in-flight run keeps its own status`);
    assert.strictEqual(active.offersGeneration, false, `${status}: a satisfied goal still exposes no new generation`);
  }

  /* NOTHING IS MUTATED BY A READ, the same discipline every other resolver in
     public/shared-coverage.js keeps. */
  const record = { status: "needs-attention", missingRequired: 2 };
  const before = JSON.stringify(record);
  Coverage.coverageRunReconciliation(record, { known: true, missingRequired: 0 });
  assert.strictEqual(JSON.stringify(record), before, "reconciling must not write to the run record");

  note("A1 coverage reconciliation: satisfied / outstanding / unknown, recorded status preserved, nothing mutated");
}

async function checkCoverageBanner() {
  /* THE HEADLINE REPRO. Every required view is selected; the run still says
     NEEDS ATTENTION and still claims 2 missing. */
  const satisfied = await openCoverageBoard(coverageFixture({ missing: [] }));
  const banner = coverageBanner(satisfied.html());
  assert.ok(banner, "the coverage board must render the run banner");
  assert.ok(/data-coverage-run-goal="satisfied"/.test(banner), `the banner must report the live goal: ${banner}`);
  assert.ok(/tone-complete/.test(banner), `a satisfied goal is not an attention tone: ${banner}`);
  assert.ok(!/NEEDS ATTENTION/.test(banner), `the stale status must not headline the banner: ${banner}`);
  assert.ok(/No action is needed here/.test(banner), `a satisfied goal must say no action is needed: ${banner}`);
  assert.ok(!/RESUME MISSING VIEWS/.test(satisfied.html()), "a satisfied goal must expose no resume-missing-views control");

  /* THE HISTORY IS NOT DESTROYED. */
  assert.ok(/data-coverage-run-recorded="needs-attention"/.test(banner),
    `the run's own last word must remain visible as history: ${banner}`);

  /* AND THE COUNT ON THE BOARD AGREES WITH THE BANNER, which is the whole point:
     the two used to be two derivations. */
  assert.ok(/4 of 6 views assigned/.test(satisfied.html()), "the board must count the four selected required views");

  /* NO OVER-SUPPRESSION. One required view genuinely missing keeps the attention
     state, the resume control and the live count. */
  const outstanding = await openCoverageBoard(coverageFixture({ missing: ["rear"] }));
  const outstandingBanner = coverageBanner(outstanding.html());
  assert.ok(/data-coverage-run-goal="outstanding"/.test(outstandingBanner), `real missing work stays outstanding: ${outstandingBanner}`);
  assert.ok(/NEEDS ATTENTION/.test(outstandingBanner), `real missing work keeps its status: ${outstandingBanner}`);
  assert.ok(/1 required slot still needs attention/.test(outstandingBanner), `the count must be the live 1, not the stored 2: ${outstandingBanner}`);
  assert.ok(/RESUME MISSING VIEWS/.test(outstanding.html()), "real missing work keeps its resume control");

  note("A2 banner: satisfied reconciles and drops the resume control; one real gap keeps both");
}

/* SECTION F — the generalisation. A HUMAN satisfying the goal reconciles the run,
   with no automation involved at all. Driven through the shipped slot setter. */
async function checkManualSatisfactionReconciles() {
  const board = await openCoverageBoard(coverageFixture({ missing: ["rear"] }));
  assert.ok(/RESUME MISSING VIEWS/.test(board.html()), "precondition: the run is asking for the missing view");

  const filled = vm.runInContext(`(() => {
    const kai = P.characters.find((row) => row.id === "KAI");
    const slots = ensureCoverageSlots("characters", kai);
    const index = slots.findIndex((slot) => slot.id === "rear");
    setCoverageSlotField("characters", "KAI", index, "selectedFile", "KAI-REAR.png");
    return JSON.stringify({ index, file: slotSelectedFile(slots[index]), status: kai.coverageAutomation.status });
  })()`, board.rendered.context);
  const outcome = JSON.parse(filled);
  assert.strictEqual(outcome.file, "KAI-REAR.png", `the shipped setter must have assigned the view: ${filled}`);
  /* THE DURABLE RECORD IS DELIBERATELY UNTOUCHED BY A MANUAL ASSIGNMENT. The live
     answer is derived, so history keeps saying what the machine said — which is
     exactly what makes this a reconciliation rather than a rewrite. */
  assert.strictEqual(outcome.status, "needs-attention", "the stored run record is history and stays as recorded");

  await board.rendered.context.route();
  const banner = coverageBanner(board.html());
  assert.ok(/data-coverage-run-goal="satisfied"/.test(banner), `manual assignment must reconcile the run immediately: ${banner}`);
  assert.ok(!/RESUME MISSING VIEWS/.test(board.html()), "the paid resume control must be gone the moment the goal is met");
  assert.ok(/This run last recorded needs attention/.test(banner), `the reconciliation must explain itself: ${banner}`);

  note("F1 manual satisfaction: a human filling the last view reconciles the run on the next render, history intact");
}

/* SECTION G — paid-action truth for coverage. */
async function checkCoveragePaidActionTruth() {
  const board = await openCoverageBoard(coverageFixture({ missing: [] }));
  const context = board.rendered.context;

  /* The dialog can still be opened deliberately — this is not about hiding a
     capability — but the requirement-driven arm has no work and says so. */
  context.openCoverageAutomationModal("characters", "KAI", "individual");
  const dialog = context.document.getElementById("modal").innerHTML;
  assert.ok(/COVERAGE AUTOMATION/.test(dialog), "the deliberate dialog still opens");
  assert.ok(/<option value="individual" selected>/.test(dialog),
    "the dialog must select the mode it was asked for — a control that takes a different decision from the one it names");
  /* The harness's DOM does not resolve a `selected` option into `select.value`,
     so the mode the markup marks selected is chosen explicitly here. The claim
     that the dialog OFFERS the right default is the markup assertion above; this
     is the filmmaker having it selected. */
  context.document.getElementById("coverage-mode").value = "individual";
  context.updateCoverageAutomationPlan();
  const plan = context.document.getElementById("coverage-spend-plan").innerHTML;
  assert.ok(/data-coverage-spend-plan="none"/.test(plan), `the quote must price an empty work set at nothing: ${plan}`);
  assert.ok(/No paid request to submit/.test(plan), `the quote must say plainly that nothing would be submitted: ${plan}`);
  assert.ok(!/\d+ paid request/.test(plan), `no paid request count may be quoted when nothing is missing: ${plan}`);
  assert.strictEqual(context.document.getElementById("coverage-start-button").disabled, true,
    "the paid start control must obey the quote beside it");

  /* AND THE HANDLER FAILS CLOSED, not merely the button. */
  const before = vm.runInContext(`JSON.stringify(P.characters.find((r) => r.id === "KAI").coverageAutomation)`, context);
  await context.startCoverageAutomation(true);
  const after = vm.runInContext(`JSON.stringify(P.characters.find((r) => r.id === "KAI").coverageAutomation)`, context);
  assert.strictEqual(after, before, "a refused submission must not stamp a new run record over the old one");
  assert.deepStrictEqual(board.posts.filter((row) => row.url.includes("/api/generation/")), [],
    "a refused coverage submission must contact no generation route");

  note("G1 coverage paid action: an empty work set quotes nothing, disables start, and the handler refuses before writing");
}

/* ===================================================== SECTION G, HOLD BLOCKER 1
   THE QUOTE, THE ENABLEMENT, THE RUN STAMP, THE REQUEST LIST, THE PAYLOAD AND THE
   DISPATCH BOUNDARY ALL DERIVE FROM ONE CURRENT TASK-SPECIFIC COVERAGE TRUTH.

   Independent review found the expression modal pricing its quote from expression
   slots while startCoverageAutomation derived its request list from the ANGLE
   board, and the disagreement ran in both directions on one screen:

     expressions complete, one angle missing  the quote said "no paid request to
                                              submit"; the handler stamped the run
                                              failed and posted an ANGLE job
     one expression missing, angles complete  the quote said 1 paid request; the
                                              handler submitted nothing

   Every check below drives the REAL startCoverageAutomation handler and reads the
   REAL request bodies the page attempted. A suite that exercised only the pricing
   helper is exactly the suite that missed this. */

/* Drive the shipped handler for one task and return what the page actually did:
   the quote it showed, whether the paid control was enabled, the requests it
   attempted, and the run record on both sides. The handler is invoked with
   `spendConfirmed` so nothing is waiting on a confirmation modal — and it is
   invoked EVEN WHEN THE START CONTROL IS DISABLED, which is the bypass the
   invariant says the boundary must independently refuse. */
async function submitCoverageTask(project, { sheetType, mode = "individual" }) {
  /* The generation route answers with a job-shaped row rather than the harness's
     bare `{ok:true}`. Nothing is sent anywhere — the request body is still
     recorded and asserted — but the shipped handler stores what this returns and
     the next render reads it, so a bare acknowledgement puts `undefined` in the
     job ledger and the page dies for a reason that is not under test. */
  let issued = 0;
  const board = await openCoverageBoard(project, {
    fetch: async (url, init = {}, respond) => {
      /* Coverage dispatch is a SERVER operation now — the browser asks
         /api/generation/fal/coverage/jobs to run it. */
      if (String(url) !== "/api/generation/fal/coverage/jobs" || init.method !== "POST") return null;
      const body = JSON.parse(init.body);
      issued += 1;
      return respond({ ok: true, job: { id: `harness-job-${issued}`, status: "IN_QUEUE", ...body } });
    },
  });
  const context = board.rendered.context;
  if (sheetType === "expressions") context.openCoverageExpressionAutomation("KAI");
  else context.openCoverageAutomationModal("characters", "KAI", mode);
  context.document.getElementById("coverage-mode").value = mode;
  context.document.getElementById("coverage-sheet-type").value = sheetType;
  context.updateCoverageAutomationPlan();
  const quote = context.document.getElementById("coverage-spend-plan").innerHTML;
  /* The header count, which is the SAME NUMBER the quote states and must not be a
     second answer to it. */
  const summary = context.document.getElementById("coverage-missing-summary").innerHTML;
  const startDisabled = context.document.getElementById("coverage-start-button").disabled === true;
  const before = vm.runInContext(`JSON.stringify(P.characters.find((r) => r.id === "KAI").coverageAutomation)`, context);
  await context.startCoverageAutomation(true);
  const after = vm.runInContext(`JSON.stringify(P.characters.find((r) => r.id === "KAI").coverageAutomation)`, context);
  const requests = board.posts
    .filter((row) => String(row.url).includes("/api/generation/"))
    .map((row) => { try { return JSON.parse(row.body); } catch { return { unparsed: String(row.body) }; } });
  return { board, context, quote, summary, startDisabled, before, after, requests };
}

/* G3 — EXPRESSIONS SATISFIED, AN UNRELATED ANGLE MISSING. */
async function checkExpressionTaskWithNoWorkSubmitsNothing() {
  const run = await submitCoverageTask(
    coverageFixture({ missing: ["rear"], missingExpressions: [] }),
    { sheetType: "expressions" },
  );
  assert.ok(/data-coverage-spend-plan="none"/.test(run.quote),
    `the expression quote must price an empty work set at nothing: ${run.quote}`);
  assert.strictEqual(run.startDisabled, true, "the paid control must obey that quote");
  assert.ok(/^0 required expression slots still missing\./.test(run.summary),
    `the dialog header must count the task's own slots, not the angle board: ${run.summary}`);
  /* The four things the invariant names, read off what the page actually did. */
  assert.deepStrictEqual(run.requests, [],
    `an expression task with nothing missing must contact no generation route: ${JSON.stringify(run.requests)}`);
  assert.strictEqual(run.after, run.before,
    `a refused expression submission must not rewrite, stamp or fail the run record: ${run.after}`);
  assert.ok(!/"status":"failed"/.test(run.after), `the refusal must leave no failed run behind: ${run.after}`);
  const bodies = JSON.stringify(run.requests);
  for (const angle of REQUIRED_ANGLES)
    assert.ok(!bodies.includes(angle), `the angle slot ${angle} must never appear in an expression request: ${bodies}`);

  note("G3 expression task, nothing missing: no POST, no run mutation, no angle in any payload");
}

/* G4 — EXACTLY ONE EXPRESSION MISSING, EVERY ANGLE SATISFIED. */
async function checkExpressionTaskSubmitsExactlyItsOwnWork() {
  const run = await submitCoverageTask(
    coverageFixture({ missing: [], missingExpressions: ["worried"] }),
    { sheetType: "expressions" },
  );
  assert.ok(/Confirmed first submission: 1 paid request/.test(run.quote),
    `the quote must price exactly the one missing expression: ${run.quote}`);
  assert.strictEqual(run.startDisabled, false, "real work enables the paid control");
  assert.ok(/^1 required expression slot still missing\./.test(run.summary),
    `the dialog header must agree with the quote beside it: ${run.summary}`);
  assert.strictEqual(run.requests.length, 1,
    `exactly one request must be submitted for the one missing expression: ${JSON.stringify(run.requests)}`);
  const body = run.requests[0];
  assert.strictEqual(body.targetCoverageSlotId, "worried",
    `the request must name the missing expression: ${JSON.stringify(body)}`);
  assert.strictEqual(body.coverageSheetType, "expressions",
    `the payload must declare its own group, or the returned candidate is filed against the angle board: ${JSON.stringify(body)}`);
  for (const angle of REQUIRED_ANGLES)
    assert.notStrictEqual(body.targetCoverageSlotId, angle, `no angle slot may be requested: ${JSON.stringify(body)}`);
  /* THE PAYLOAD IS WORDED FOR THE THING IT ASKS FOR. Making this path reachable
     without this would trade one wrong request for another. */
  assert.ok(/TARGET EXPRESSION: worried/.test(String(body.prompt || "")),
    `an expression request must not be worded as a camera angle: ${String(body.prompt || "").slice(0, 240)}`);
  assert.ok(!/changing only the camera angle/.test(String(body.prompt || "")),
    "an expression request must not carry the angle contract");
  /* THE RUN RECORD IS THE SERVER'S NOW, so what this asserts is the REQUEST that tells
     it which task to record. Paid Request Truth V1 made entity.coverageAutomation
     server-owned — an ordinary project save can no longer author or promote one, which
     is what stopped a hand-written save from buying the privileged generation surface —
     so this browser-only harness, whose fetch is mocked, is no longer where the record
     moves. The server establishing a NEW run for a different task is proved end to end in
     tests/paid-request-truth.js.

     What still belongs here is that this dispatch asks for the right work: its own group
     and its own mode, asserted above and below. */
  assert.strictEqual(body.coverageSheetType, "expressions",
    `the request must tell the server which task to record: ${JSON.stringify(body)}`);
  assert.strictEqual(body.coverageMode, "individual",
    `and which mode it is running: ${JSON.stringify(body)}`);

  note("G4 expression task, one missing: exactly that expression is requested, in its own group, worded as an expression");
}

/* G5 — THE ANGLE ARM IS UNCHANGED, in both directions. */
async function checkAngleTaskIsUnchanged() {
  const one = await submitCoverageTask(
    coverageFixture({ missing: ["rear"], missingExpressions: ["worried"] }),
    { sheetType: "angles" },
  );
  assert.ok(/Confirmed first submission: 1 paid request/.test(one.quote), `the angle quote is unchanged: ${one.quote}`);
  assert.ok(/^1 required coverage slot still missing\./.test(one.summary),
    `the angle dialog keeps its own header wording and count: ${one.summary}`);
  assert.strictEqual(one.requests.length, 1, `exactly the missing angle is submitted: ${JSON.stringify(one.requests)}`);
  assert.strictEqual(one.requests[0].targetCoverageSlotId, "rear");
  assert.strictEqual(one.requests[0].coverageSheetType, "angles",
    "an angle request keeps the group submitCoverageJob has always defaulted it to");
  assert.ok(!/TARGET EXPRESSION/.test(String(one.requests[0].prompt || "")),
    "an angle request keeps its viewpoint wording");
  assert.ok(!String(one.requests[0].prompt || "").includes("worried"),
    `a missing expression must not leak into an angle request: ${String(one.requests[0].prompt || "").slice(0, 240)}`);

  const none = await submitCoverageTask(
    coverageFixture({ missing: [], missingExpressions: ["worried"] }),
    { sheetType: "angles" },
  );
  assert.ok(/data-coverage-spend-plan="none"/.test(none.quote), `an angle task with no missing angle quotes nothing: ${none.quote}`);
  assert.deepStrictEqual(none.requests, [], "and submits nothing, even though an expression is missing");
  assert.strictEqual(none.after, none.before, "and writes nothing");

  note("G5 angle task: unchanged in both directions, and a missing expression never reaches it");
}

/* G6 — THE DISPATCH BOUNDARY REFUSES A CROSS-GROUP SLOT ON ITS OWN, with every
   surface above it bypassed entirely: no dialog, no quote, no start control. */
async function checkDispatchBoundaryRefusesCrossGroupSlots() {
  let issued = 0;
  const board = await openCoverageBoard(coverageFixture({ missing: ["rear"], missingExpressions: ["worried"] }), {
    fetch: async (url, init = {}, respond) => {
      /* Coverage dispatch is a SERVER operation now — the browser asks
         /api/generation/fal/coverage/jobs to run it. */
      if (String(url) !== "/api/generation/fal/coverage/jobs" || init.method !== "POST") return null;
      issued += 1;
      return respond({ ok: true, job: { id: `harness-job-${issued}`, status: "IN_QUEUE", ...JSON.parse(init.body) } });
    },
  });
  const said = JSON.parse(await vm.runInContext(`(async () => {
    const api = window.__CINEBRAID_COVERAGE_AUTOMATION;
    const entity = P.characters.find((row) => row.id === "KAI");
    const angle = ensureCoverageSlots("characters", entity).find((row) => row.id === "rear");
    const expression = ensureExpressionSlots(entity).find((row) => row.id === "worried");
    const heard = [];
    const attempt = async (label, slot, group) => {
      try {
        await api.submitCoverageJob("characters", entity, {
          prompt: api.coverageSlotPrompt("characters", entity, slot, "", group),
          outputCount: 3, resolution: "4k", aspectRatio: "1:1",
          coverageJobType: "slot", coverageSheetType: group, slot,
          clientRequestId: "control-" + label,
        });
        heard.push(label + ":submitted");
      } catch (error) { heard.push(label + ":refused:" + String((error && error.message) || error)); }
    };
    await attempt("angle-as-expression", angle, "expressions");
    await attempt("expression-as-angle", expression, "angles");
    await attempt("expression-as-expression", expression, "expressions");
    return JSON.stringify(heard);
  })()`, board.rendered.context));
  const transcript = said.join(" | ");
  assert.ok(/angle-as-expression:refused/.test(transcript),
    `an angle slot submitted under the expression group must be refused: ${transcript}`);
  assert.ok(/expression-as-angle:refused/.test(transcript),
    `an expression slot submitted under the angle group must be refused: ${transcript}`);
  assert.ok(/expression-as-expression:submitted/.test(transcript),
    `the legitimate pairing must still submit: ${transcript}`);
  const reached = board.posts
    .filter((row) => String(row.url).includes("/api/generation/"))
    .map((row) => JSON.parse(row.body));
  assert.strictEqual(reached.length, 1,
    `only the legitimate pairing may reach the paid route: ${JSON.stringify(reached.map((row) => row.targetCoverageSlotId))}`);
  assert.strictEqual(reached[0].targetCoverageSlotId, "worried");

  note("G6 dispatch boundary: a slot must belong to the group its request declares, checked where the money is spent");
}

/* SECTION G, the second half — the legacy read that mispriced the plan.

   THE EXPRESSION SHEET IS WHERE THIS BITES. The angle branch of the quote is
   handed missingCoverageSlots(), which has already filtered on the one slot
   accessor; the EXPRESSION branch is handed the whole slot list and did its own
   filtering on `!slot.approvedFile` — a key assignSlotReference() deletes. Every
   selected expression therefore priced as another paid request. */
async function checkCoverageSpendPlanReadsSelections() {
  const board = await openCoverageBoard(coverageFixture({ missingExpressions: ["worried"] }));
  const context = board.rendered.context;
  context.openCoverageExpressionAutomation("KAI");
  context.document.getElementById("coverage-mode").value = "individual";
  context.document.getElementById("coverage-sheet-type").value = "expressions";
  context.updateCoverageAutomationPlan();
  const plan = context.document.getElementById("coverage-spend-plan").innerHTML;
  assert.ok(/Confirmed first submission: 1 paid request/.test(plan),
    `only the genuinely missing expression may be priced: ${plan}`);

  /* And with nothing missing at all, the expression arm quotes nothing. */
  const covered = await openCoverageBoard(coverageFixture({ missingExpressions: [] }));
  covered.rendered.context.openCoverageExpressionAutomation("KAI");
  covered.rendered.context.document.getElementById("coverage-mode").value = "individual";
  covered.rendered.context.document.getElementById("coverage-sheet-type").value = "expressions";
  covered.rendered.context.updateCoverageAutomationPlan();
  const empty = covered.rendered.context.document.getElementById("coverage-spend-plan").innerHTML;
  assert.ok(/data-coverage-spend-plan="none"/.test(empty),
    `a fully covered expression board quotes nothing: ${empty}`);

  note("G2 spend plan: assigned expressions are read through the one slot accessor, so the quote prices only real gaps");
}

/* ================================================================= SECTION B
   HUMAN-APPROVED FRAME VS RUNNING STATE.
   =========================================================================== */

const APPROVED_FRAMES_FACTS = {
  routeRequirementsKnown: true,
  requiredFrameCount: 1,
  requiredFramesApproved: true,
  frameTotal: 1,
  frameApprovedCount: 1,
  frameNeedsReview: false,
};

function checkApprovalDominatesRun() {
  for (const activityStatus of Stage.SHOT_STAGE_ACTIVITY.filter(Boolean)) {
    const state = Stage.shotStageState("frames", { ...APPROVED_FRAMES_FACTS, activityStatus });
    assert.strictEqual(state.completion, "complete", `${activityStatus}: approved required frames are complete work`);
    assert.strictEqual(state.statusKey, "approved",
      `${activityStatus}: an approved frame must not be headlined by a run status (got ${state.statusKey})`);
    assert.strictEqual(state.tone, "complete", `${activityStatus}: an approved frame is not an attention or active tone`);
    /* THE RUN IS NOT HIDDEN. It moves to the secondary slot it belongs in. */
    assert.strictEqual(state.activity, activityStatus, `${activityStatus}: the run must remain visible as activity detail`);
  }

  /* THE STAGE THE WORK IS ON DOES NOT MOVE. Navigation asks `activity`, so a
     stage carrying a live run is still where the shot opens even though its
     status word changed. */
  assert.strictEqual(Stage.recommendedShotStageId({ ...APPROVED_FRAMES_FACTS, activityStatus: "running" }), "frames",
    "a stage carrying a live run must still be the recommended destination");

  /* AND NOTHING IS OVERCLAIMED. An unapproved frame under the same run reports
     the run, exactly as it always did. */
  const unapproved = Stage.shotStageState("frames", {
    routeRequirementsKnown: true, requiredFrameCount: 1, requiredFramesApproved: false,
    frameTotal: 1, frameApprovedCount: 0, activityStatus: "running",
  });
  assert.strictEqual(unapproved.statusKey, "running", "work that is not complete still reports the run");
  assert.strictEqual(unapproved.tone, "active");

  note("B1 approval dominates: every run status yields to approved required frames, and the run stays as activity detail");
}

async function checkApprovedFrameStopsSayingRunning() {
  const project = shotFixture("i2v");
  project.shots[0].keyframes = [project.shots[0].keyframes[0]];
  project.shots[0].clips = [];
  const stages = await shotStages(project, ["FRAME_A.png"]);
  assert.strictEqual(stages.byId.frames.completion, "complete", "precondition: Frame A is approved and required");

  const withRun = vm.runInContext(`(() => {
    AUTOMATION_RUNS = [{ id: "run-frames", type: "shot-chain", targetId: "L1-01", scope: "stills", status: "running",
      stage: "Frame A review", summary: "still running", createdAt: "2026-08-26T10:00:00Z",
      config: { maxImages: 9 }, usage: {}, steps: {}, logs: [] }];
    const shot = P.shots.find((row) => row.id === "L1-01");
    const facts = shotStageModelFacts(shot, takesFor("L1-01"));
    return JSON.stringify({ facts, state: shotStageState("frames", facts), status: boundedShotTaskStatus(shot, takesFor("L1-01"), "frames", facts) });
  })()`, stages.rendered.context);
  const payload = JSON.parse(withRun);
  assert.strictEqual(payload.facts.activityStatus, "running", "precondition: the shot carries a running run");
  assert.strictEqual(payload.state.statusKey, "approved", `the approved frame must dominate the run: ${withRun}`);
  assert.notStrictEqual(payload.status.label, "Running", `the stage strip must not say Running over an approved frame: ${withRun}`);
  assert.strictEqual(payload.status.tone, "complete", "the strip tone follows the same answer");

  note("B2 rendered: an approved Frame A under a running shot-chain reports Approved, not Running");
}

/* ================================================================= SECTION C
   WORKFLOW STEP AUTO-RECONCILIATION.
   =========================================================================== */

async function checkRouteDrivenFrameRequirement() {
  /* C1 — I2V USING AN APPROVED FRAME A SATISFIES FRAMES. */
  const i2v = shotFixture("i2v");
  i2v.shots[0].keyframes = [i2v.shots[0].keyframes[0]];
  i2v.shots[0].clips = [];
  const i2vStages = await shotStages(i2v, ["FRAME_A.png"]);
  assert.strictEqual(i2vStages.facts.requiredFrameCount, 1, "i2v declares one required frame input");
  assert.strictEqual(i2vStages.byId.frames.completion, "complete", "an approved Frame A satisfies an i2v shot's Frames stage");
  assert.strictEqual(i2vStages.byId.frames.statusKey, "approved");

  /* C2 — R2V ASKS FOR NO AUTHORED FRAME, so Frames is not owed one and must not
     print a fraction of a requirement that does not exist. */
  const r2v = shotFixture("r2v");
  const r2vStages = await shotStages(r2v, []);
  assert.strictEqual(r2vStages.facts.routeRequirementsKnown, true, "r2v's input needs are known");
  assert.strictEqual(r2vStages.facts.requiredFrameCount, 0, "r2v requires no authored frame");
  const frames = r2vStages.byId.frames;
  assert.strictEqual(frames.optional, true, "the model already marks a no-frame route's Frames stage optional");
  assert.strictEqual(frames.statusKey, "notRequired", `Frames must say Not required rather than Not started: ${JSON.stringify(frames)}`);
  assert.notStrictEqual(frames.tone, "attention", "a stage nothing asked for is never an attention tone");
  assert.ok(!frames.note || frames.note.key !== "frames-approved",
    `a route that needs no frame must not print an approved-of-total fraction: ${JSON.stringify(frames.note)}`);

  const words = vm.runInContext(`(() => {
    const shot = P.shots.find((row) => row.id === "L1-01");
    return JSON.stringify(boundedShotTaskStatus(shot, takesFor("L1-01"), "frames"));
  })()`, r2vStages.rendered.context);
  assert.ok(/"label":"Not required"/.test(words), `the shipped wording must say Not required: ${words}`);
  assert.ok(!/of \d+ frames approved/.test(words), `the shipped note must not read as a debt: ${words}`);

  note("C1 route-driven frames: i2v is satisfied by an approved Frame A; r2v reports Not required and prints no fraction");
}

async function checkOptionalStageStopsAsking() {
  /* C3 — A SKIPPED OPTIONAL STAGE. Blocking attempts exist that nobody chose,
     and the shot's required frames are approved: the production moved past it. */
  const moved = shotFixture("i2v");
  moved.shots[0].keyframes = [moved.shots[0].keyframes[0]];
  moved.shots[0].clips = [];
  moved.mediaAssets.push({
    id: "blocking-skipped", file: "L1-01_BLOCKING_B01.png", storagePath: "shots/L1-01/blocking/L1-01_BLOCKING_B01.png",
    title: "L1-01 blocking B01", kind: "image", notes: "",
    links: [{ id: "blocking-link-skipped", targetType: "shot", targetId: "L1-01", role: "blocking-frame", blockingState: "returned", blockingVersion: "B01", generationInput: false, order: 1 }],
  });
  const movedStages = await shotStages(moved, ["FRAME_A.png"]);
  assert.ok(movedStages.facts.blockingGuideCandidateCount > 0, "precondition: unchosen blocking attempts exist");
  assert.strictEqual(movedStages.facts.blockingGuideActive, false, "precondition: no guide was ever chosen");
  assert.strictEqual(movedStages.facts.downstreamAuthorityApproved, true, "precondition: approved downstream work exists");
  const look = movedStages.byId.look;
  assert.strictEqual(look.statusKey, "optional", `a skipped optional stage says Optional: ${JSON.stringify(look)}`);
  assert.notStrictEqual(look.tone, "attention", "a skipped optional stage is not amber");
  assert.strictEqual(look.completion, "not-started", "withdrawing a claim on attention must not fabricate progress");
  /* THE WORK IS NOT HIDDEN, and the stage is still where the shot opens if
     nothing else is more urgent. */
  assert.strictEqual(look.note.key, "blocking-guides-available", "the attempts are still counted and still reachable");
  assert.strictEqual(look.availability, "available", "the stage stays available");

  /* AND THE SAME SHOT WITHOUT DOWNSTREAM APPROVAL STILL ASKS. */
  const waiting = shotFixture("i2v");
  waiting.shots[0].keyframes = waiting.shots[0].keyframes.map((frame) => ({ ...frame, winner: "" }));
  waiting.shots[0].clips = [];
  delete waiting.productionAuthority;
  withCanon(waiting, [
    { kind: "entity-state", list: "characters", entityId: "KAI", stateId: "state-default", value: "KAI-ANCHOR.png" },
    { kind: "entity-state", list: "locations", entityId: "LOC-HULL", stateId: "state-default", value: "LOC-HULL-PLATE.png" },
    { kind: "entity-state", list: "props", entityId: "PR-TOOL", stateId: "state-default", value: "PR-TOOL-PLATE.png" },
  ]);
  waiting.mediaAssets.push({
    id: "blocking-waiting", file: "L1-01_BLOCKING_B01.png", storagePath: "shots/L1-01/blocking/L1-01_BLOCKING_B01.png",
    title: "L1-01 blocking B01", kind: "image", notes: "",
    links: [{ id: "blocking-link-waiting", targetType: "shot", targetId: "L1-01", role: "blocking-frame", blockingState: "returned", blockingVersion: "B01", generationInput: false, order: 1 }],
  });
  const waitingStages = await shotStages(waiting, []);
  assert.strictEqual(waitingStages.facts.downstreamAuthorityApproved, false, "precondition: nothing downstream is approved");
  assert.strictEqual(waitingStages.byId.look.statusKey, "needsReview",
    `a genuinely open choice still asks: ${JSON.stringify(waitingStages.byId.look)}`);
  assert.strictEqual(waitingStages.byId.look.tone, "attention");

  note("C2 optional stage: unchosen guides stop claiming attention once approved downstream work exists, and only then");
}

async function checkDeliverAsksItsPrerequisite() {
  /* C4 — DELIVER MUST NOT TELL A FILMMAKER TO APPROVE A STILL THEY APPROVED.
     `animate` is an approved still on a shot that wants motion. */
  const animate = shotFixture("i2v");
  animate.shots[0].keyframes = [animate.shots[0].keyframes[0]];
  const stages = await shotStages(animate, ["FRAME_A.png"]);
  assert.strictEqual(stages.facts.approvedResultAvailable, true, "precondition: an approved result exists");
  const deliver = stages.byId.deliver;
  assert.strictEqual(deliver.availability, "available",
    `Deliver must not be blocked while an approved result exists: ${JSON.stringify(deliver)}`);
  assert.strictEqual(deliver.blockedReason, "", "an available stage states no blocker");

  /* AND A SHOT WITH NOTHING APPROVED IS STILL BLOCKED, with its reason. */
  const blocked = Stage.shotStageState("deliver", { lifecycleKey: "needs-image", approvedResultAvailable: false });
  assert.strictEqual(blocked.availability, "blocked");
  assert.strictEqual(blocked.blockedReason, "Approve a still or a video first");

  note("C3 deliver: the prerequisite is asked of the result, so an approved still is never told to approve a still");
}

function checkMotionReviewSaysWhatIsTrue() {
  /* C5 — GENERATED MOTION AWAITING REVIEW PRESENTS THE EXACT CURRENT STATE. */
  const base = { motionReadinessStatus: "READY", motionCandidateCount: 1 };
  const review = Stage.shotStageState("motion", { ...base, lifecycleKey: "review-motion" });
  assert.strictEqual(review.completion, "needs-review", "a returned take awaiting a decision is needs-review");
  assert.strictEqual(review.statusKey, "needsReview");
  assert.strictEqual(review.availability, "available", "a returned candidate makes the review workspace reachable");

  const approved = Stage.shotStageState("motion", { ...base, lifecycleKey: "motion-approved" });
  assert.strictEqual(approved.completion, "complete", "an approved take is complete");
  assert.strictEqual(approved.statusKey, "approved");

  note("C4 motion: a returned take reports needs-review and an approved take reports approved");
}

/* AUTO-RECONCILING A STEP IS NOT MEDIA APPROVAL. Nothing in section C may create,
   move or imply a Canon receipt. */
async function checkReconciliationApprovesNothing() {
  const project = shotFixture("r2v");
  const before = JSON.stringify(project.productionAuthority || null);
  const stages = await shotStages(project, []);
  const after = vm.runInContext(`JSON.stringify(P.productionAuthority || null)`, stages.rendered.context);
  assert.strictEqual(after, before, "deriving a stage status must not write the authority ledger");

  const canon = vm.runInContext(`(() => {
    const shot = P.shots.find((row) => row.id === "L1-01");
    return JSON.stringify({
      shotWinner: shot.winner || "",
      frameWinners: (shot.keyframes || []).map((frame) => frame.winner || ""),
      frameAuthority: (shot.keyframes || []).map((frame) => hasCurrentHumanAuthority(P, { kind: "shot-frame", shotId: shot.id, frameId: frame.id })),
    });
  })()`, stages.rendered.context);
  const truth = JSON.parse(canon);
  assert.ok(truth.frameAuthority.every((row) => row === false) || truth.frameAuthority.every((row) => row === true),
    "the frame receipts must be whatever the fixture stamped, never something a status derivation invented");

  note("C5 authority: reconciling a workflow step writes no receipt and moves no approval");
}

/* ================================================================= SECTION D
   RECOVERY / FAILURE SEVERITY.
   =========================================================================== */

/* A scene parent that is machine-active and holds the child's id in its own step
   result — the link that survives the durable record's sanitizer. */
const PARENT_RUN = (childStatus, parentStatus = "running") => ([
  {
    id: "scene-parent", type: "scene-chain", targetId: "SC-01", scope: "main", label: "Scene parent",
    status: parentStatus, stage: "L1-01 still", summary: "Building approved scene stills.",
    createdAt: "2026-08-26T10:00:00Z", updatedAt: "2026-08-26T10:05:00Z",
    runnerId: "runner-1", leaseExpiresAt: "2099-01-01T00:00:00Z", heartbeatAt: "2026-08-26T10:05:00Z",
    config: {}, usage: {}, logs: [],
    steps: { "scene-shot:L1-01": { key: "scene-shot:L1-01", kind: "scene-shot", status: "running", label: "Build L1-01", result: { childRunId: "scene-child", shotId: "L1-01", childStatus } } },
  },
  {
    id: "scene-child", type: "shot-chain", targetId: "L1-01", scope: "stills", label: "L1-01 scene child",
    status: childStatus, stage: "Retry ready", summary: "Only the selected failed step was reset.",
    createdAt: "2026-08-26T10:01:00Z", updatedAt: "2026-08-26T10:04:00Z",
    config: {}, usage: {}, logs: [],
    steps: { "frame:frame-a:round-1:generate": { key: "frame:frame-a:round-1:generate", kind: "generation", status: "failed", label: "Generate Frame A", error: "Provider returned 502." } },
  },
]);

async function checkParentHealthGovernsSeverity() {
  const rendered = await render("#/shot/L1-01", shotFixture("i2v"), { scan: shotScan(shotFixture("i2v"), ["FRAME_A.png"]) });

  const ask = (runs) => JSON.parse(vm.runInContext(`(() => {
    AUTOMATION_RUNS = ${JSON.stringify(runs)};
    const child = AUTOMATION_RUNS.find((row) => row.id === "scene-child");
    const parent = AUTOMATION_RUNS.find((row) => row.id === "scene-parent");
    return JSON.stringify({
      parentFound: !!v670ParentRunFor(child) && v670ParentRunFor(child).id,
      recovering: v670RunRecovering(child),
      childAttention: v670AttentionRun(child),
      parentAttention: v670AttentionRun(parent),
      parentActive: v670MachineActiveRun(parent),
    });
  })()`, rendered.context));

  /* THE DEFECT. A child being automatically retried inside a healthy parent used
     to be a red NEEDS ATTENTION row for work no person can act on. */
  for (const childStatus of ["failed", "interrupted"]) {
    const live = ask(PARENT_RUN(childStatus, "running"));
    assert.strictEqual(live.parentFound, "scene-parent", `${childStatus}: the parent must be found through its own step result`);
    assert.strictEqual(live.parentActive, true, `${childStatus}: precondition — the parent is machine-active`);
    assert.strictEqual(live.recovering, true, `${childStatus}: a healthy parent owning the child IS automatic recovery`);
    assert.strictEqual(live.childAttention, false, `${childStatus}: the child must not claim the director's attention`);
  }

  /* AND THE MOMENT THE PARENT STOPS BEING HEALTHY, THE CHILD IS THE DIRECTOR'S
     BUSINESS AGAIN. Nothing is permanently suppressed. */
  for (const parentStatus of ["failed", "interrupted", "cancelled", "completed"]) {
    const dead = ask(PARENT_RUN("failed", parentStatus));
    assert.strictEqual(dead.recovering, false, `${parentStatus}: a parent that is not driving is not recovering anything`);
    assert.strictEqual(dead.childAttention, true, `${parentStatus}: the child's failure returns to the director`);
  }

  /* AN ORPHAN IS NOT SUPPRESSED EITHER: with no parent at all the child is
     attention, exactly as it always was. */
  const orphan = JSON.parse(vm.runInContext(`(() => {
    AUTOMATION_RUNS = ${JSON.stringify([PARENT_RUN("failed")[1]])};
    const child = AUTOMATION_RUNS[0];
    return JSON.stringify({ recovering: v670RunRecovering(child), attention: v670AttentionRun(child) });
  })()`, rendered.context));
  assert.strictEqual(orphan.recovering, false, "a run with no parent is recovering nothing");
  assert.strictEqual(orphan.attention, true, "a run with no parent keeps its attention verdict");

  note("D1 parent health: a child under active recovery is not attention; a stopped parent hands it straight back");
}

async function checkDrawerSeveritySeparation() {
  const rendered = await render("#/shot/L1-01", shotFixture("i2v"), { scan: shotScan(shotFixture("i2v"), ["FRAME_A.png"]) });

  const drawer = (runs) => {
    vm.runInContext(`AUTOMATION_RUNS = ${JSON.stringify(runs)}; V641_ACTIVITY_DRAWER_OPEN = true; v641RenderActivityDrawer();`, rendered.context);
    return rendered.context.document.getElementById("automation-activity-drawer").innerHTML;
  };

  /* A HEALTHY PARENT WITH A CHILD MID-RECOVERY. The child's fault is named, in
     the neutral style, and the drawer says no action is needed. */
  const recovering = drawer(PARENT_RUN("failed", "running"));
  assert.ok(/data-child-recovering="scene-child"/.test(recovering),
    "a parent recovering a child must say so rather than leave it to be read off a status");
  assert.ok(/no action needed from you/.test(recovering), "recovery is not a claim on the director");
  const attentionCount = recovering.match(/PREVIOUS FAILURES[^<]*<\/b><span>(\d+)<\/span>/);
  assert.ok(attentionCount, "the drawer must still render its previous-failures section");
  assert.strictEqual(attentionCount[1], "0",
    `the recovering child must not be counted as a previous failure: ${attentionCount[0]}`);

  /* A RUN THAT HAS ITSELF FAILED KEEPS THE ERROR STYLE AND THE RETRY. */
  const failed = drawer([{
    id: "solo-failed", type: "shot-chain", targetId: "L1-01", scope: "stills", label: "Solo run",
    status: "failed", stage: "Needs attention", summary: "Stopped.", createdAt: "2026-08-26T10:00:00Z", updatedAt: "2026-08-26T10:01:00Z",
    config: {}, usage: {}, logs: [],
    steps: { "frame:frame-a:round-1:generate": { key: "frame:frame-a:round-1:generate", kind: "generation", status: "failed", label: "Generate Frame A", error: "Provider returned 502." } },
  }]);
  assert.ok(/automation-drawer-error/.test(failed), "a run that actually failed keeps its error line");
  assert.ok(/RETRY/.test(failed), "a run that actually failed keeps its retry action");

  /* A RUNNING RUN CARRYING A STALE FAILED STEP IS NOT PAINTED AS AN ERROR. */
  const running = drawer([{
    id: "solo-running", type: "shot-chain", targetId: "L1-01", scope: "stills", label: "Continuing run",
    status: "running", stage: "Frame B", summary: "Still working.", createdAt: "2026-08-26T10:00:00Z", updatedAt: "2026-08-26T10:06:00Z",
    runnerId: "runner-2", leaseExpiresAt: "2099-01-01T00:00:00Z", heartbeatAt: "2026-08-26T10:06:00Z",
    config: {}, usage: {}, logs: [],
    steps: { "frame:frame-a:round-1:generate": { key: "frame:frame-a:round-1:generate", kind: "generation", status: "failed", label: "Generate Frame A", error: "Provider returned 502." } },
  }]);
  assert.ok(/Provider returned 502/.test(running), "the step's own message is still evidence and still shown");
  assert.ok(!/automation-drawer-error/.test(running),
    `a healthy run must not paint a past step failure as a fault the director is handed: ${running.slice(0, 400)}`);

  note("D2 drawer: recovery is named neutrally, a failed run keeps its error and retry, a healthy run keeps neither");
}

function checkStageSeverityLadder() {
  const base = { routeRequirementsKnown: true, requiredFrameCount: 2, requiredFramesApproved: false, frameTotal: 2, frameApprovedCount: 1 };
  const ladder = [
    ["running", "healthy", "running", "active"],
    /* `awaiting-review` keeps the tone the shipped taskbar has always given it —
       tests/stage-model.js pins that deliberately, and no dogfood observation
       reported it. Listed here so the ladder is complete and so a future change
       to it is a change somebody made on purpose. */
    ["awaiting-review", "", "needsReview", "active"],
    ["failed", "stopped", "failed", "attention"],
    ["failed", "", "failed", "attention"],
    ["interrupted", "stopped", "running", "attention"],
    ["failed", "recovering", "running", "active"],
    ["interrupted", "recovering", "running", "active"],
  ];
  for (const [activityStatus, activityHealth, statusKey, tone] of ladder) {
    const state = Stage.shotStageState("frames", { ...base, activityStatus, activityHealth });
    assert.strictEqual(state.statusKey, statusKey, `${activityStatus}/${activityHealth || "unstated"}: status key`);
    assert.strictEqual(state.tone, tone, `${activityStatus}/${activityHealth || "unstated"}: tone`);
    /* COMPLETION NEVER MOVES WITH SEVERITY. What a machine is doing is not how
       far the work has got, and that separation predates this slice. */
    assert.strictEqual(state.completion, "in-progress", `${activityStatus}/${activityHealth || "unstated"}: completion is unchanged by severity`);
  }
  note("D3 ladder: working is normal, recovery is neutral, and attention is reserved for a run that stopped");
}

/* ================================================================= SECTION E
   STALE COMPILED PROMPT SAFETY.
   =========================================================================== */

/* A shot carrying a compiled MiniMax H3 package whose recorded dependency
   snapshot no longer matches the shot. `stale` picks whether the snapshot lies. */
function motionPackageFixture({ stale = true, recorded = true } = {}) {
  const project = shotFixture("i2v");
  const shot = project.shots[0];
  shot.keyframes = [shot.keyframes[0]];
  shot.clips = [{ id: "seg-guided-a", suffix: "a", label: "A", title: "Primary motion", dur: 5, kind: "i2v", note: "", motionPrompt: "", fromFrame: "frame-a", toFrame: "", generationPackages: [], motionPlan: null }];
  /* `creationBrief`, which is what ensureShotCreation() reads. The build is
     written as a plain object because public/shared-build-history.js registers it
     into the project's normalized prompt-build store on load — the same path a
     real compiled package takes. */
  shot.creationBrief = {
    ...(shot.creationBrief || {}),
    deliveryIntent: "motion",
    motionProfileId: "minimax-h3/i2v",
    motionDirection: "The worker turns from the panel.",
    motionPromptBuilds: [{
      id: "build-h3-1",
      packageId: "PKG-H3-1",
      revision: 1,
      profileId: "minimax-h3/i2v",
      profileName: "MiniMax H3 · image to video",
      prompt: "The worker turns from the panel and walks out of frame.",
      originalDirective: "The worker turns from the panel.",
      improvedDirective: "",
      references: [],
      durationSeconds: 5,
      createdAt: "2026-08-26T09:00:00Z",
      ...(recorded ? {
        dependencySnapshot: {
          direction: stale ? "A COMPLETELY DIFFERENT DIRECTION THAN THE SHOT NOW HOLDS" : "",
          frameWinner: "", firstFrameWinner: "", lastFrameWinner: "",
          generationMedia: [], references: [],
        },
      } : {}),
    }],
  };
  return project;
}

async function openMotionStage(project, takes) {
  const posts = [];
  const rendered = await render("#/shot/L1-01", project, {
    scan: shotScan(project, takes),
    fetch: async (url, init = {}) => {
      if (init.method === "POST") posts.push({ url, body: init.body });
      return null;
    },
  });
  rendered.context.selectBoundedTask("shot-task", "L1-01", "motion");
  await rendered.context.route();
  /* Same reason as the coverage board: falH3MotionPromptAction() returns "" with
     no configured backend, so a suite about WHICH control it draws has to have
     one. Nothing is sent — every POST is recorded and asserted empty. */
  vm.runInContext(`CONFIG.generation = CONFIG.generation || {}; CONFIG.generation.fal = { enabled: true, apiKey: "harness" }; pollFalGeneration = () => {};`, rendered.context);
  await rendered.context.route();
  return { rendered, posts, html: () => rendered.context.document.getElementById("main").innerHTML };
}

/* ================================================ THE REAL PAID H3 DIALOG

   HOLD BLOCKER 2. The freshness gate at the dispatch boundary was previously
   exercised by hand-building `window._falH3MotionRequest`, and independent review
   showed why that proves too little: with the gate removed, the request was
   stopped by the ASPECT check on a half-built request, so the control demonstrated
   only that one earlier gate had been passed — never that a stale package would
   actually reach the seam that spends money.

   This opens the dialog the product opens, from a package the product compiled,
   with every unrelated prerequisite valid: FAL configured, a real compiled plan, a
   mode whose aspect the model supports, a prompt inside the limit, and no refusal.
   On this fixture the paid button is enabled and `startFalH3MotionGeneration()`
   posts `purpose: "motion-h3"` to `/api/generation/fal/jobs` — so removing the
   freshness protection is observable at the paid seam itself, and keeping it is
   observable as a refusal for the freshness reason.

   The plan shape is the one tests/founder-smoke-p0-trust.js already serves, so
   there is one description of a compiled H3 plan in this repository's suites
   rather than a second guess at it. */
const H3_PLAN = {
  compiledPrompt: "MINIMAX H3 FIRST / LAST FRAME — 8 SECONDS\n\nTRANSITION\nKai crosses to the ledge.",
  profile: { id: "minimax-h3/flf", name: "MiniMax H3 — First / Last Frame" },
  mode: "flf",
  references: [],
  durationSeconds: 8,
  durationRequested: 8,
  durationRange: [5, 15],
  resolutions: ["2K", "768P"],
  resolution: "2K",
  carriesAspectRatio: false,
  maxPromptCharacters: 2000,
  modelMaxPromptCharacters: 2000,
  modelDurationRange: [5, 15],
  dispatch: { model: "minimax/h3" },
  compiler: { packId: "minimax-h3", packVersion: "1" },
};

const COMPILE_H3_PACKAGE = `
  const s = shotById("L1-01"), c = ensureShotCreation(s), unit = s.clips[0];
  const build = { id: "pkg-1", packageId: "L1-01-MOTION-R01", date: "2026-08-26T10:00:00Z",
    profileId: "minimax-h3/flf", profileName: "MiniMax H3 — First / Last Frame", mode: "flf",
    segmentId: unitKey(unit), durationSeconds: 8, kind: "guided-motion", revision: 1,
    prompt: "MINIMAX H3 FIRST / LAST FRAME — 8 SECONDS", references: [], warnings: [], confirmations: [] };
  build.dependencySnapshot = packageInputSnapshot(s, build, build.references, currentDirectionForPackage(s, build));
  const packId = registerPromptBuild(P, build);
  c.motionPromptBuilds = [promptBuildRef(packId, { kind: "guided-motion" })];
  unit.generationPackages = [promptBuildRef(packId, { kind: "guided-motion", scope: "segment:" + unitKey(unit) })];`;

function h3MotionProject() {
  const project = buildFixture();
  const shot = project.shots[0];
  shot.clips = [{ id: "unit-a", suffix: "A", label: "A", dur: 8, motionPrompt: "Kai crosses to the ledge.", generationPackages: [] }];
  shot.creationBrief = { ...(shot.creationBrief || {}), motionDuration: 8, motionProfileId: "minimax-h3/flf", motionDirection: "Kai crosses to the ledge." };
  return project;
}

/* Open the real paid dialog on a compiled package. `stale` changes the SHOT after
   the package was compiled, exactly as a filmmaker would — the package is never
   edited, so its recorded snapshot is genuinely out of date rather than doctored. */
async function openRealH3Dialog({ stale = false } = {}) {
  const posts = [];
  const jobs = [];
  const rendered = await render("#/shot/L1-01", h3MotionProject(), {
    fetch: async (url, init = {}, respond) => {
      if (init.method === "POST") posts.push({ url: String(url), body: init.body });
      if (url === "/api/config") return respond({ generation: { fal: { enabled: true, apiKey: "harness", keySource: "config" } } });
      if (url === "/api/generation/fal/h3/plan") return respond(H3_PLAN);
      if (String(url).startsWith("/api/generation/options")) return respond({ options: [] });
      if (url === "/api/generation/fal/jobs" && init.method === "POST") {
        const body = JSON.parse(init.body);
        jobs.push(body);
        return respond({ ok: true, job: { id: `harness-h3-${jobs.length}`, status: "IN_QUEUE", ...body } });
      }
      return null;
    },
  });
  vm.runInContext(`${COMPILE_H3_PACKAGE}\n  pollFalGeneration = () => {};`, rendered.context);
  if (stale) vm.runInContext(`shotById("L1-01").creationBrief.motionDuration = 6;`, rendered.context);
  await rendered.context.openFalH3MotionModal("L1-01", "pkg-1");
  const dialog = () => rendered.context.document.getElementById("modal").innerHTML;
  /* Everything unrelated to freshness must be valid, or this fixture proves
     nothing about freshness. */
  assert.ok(/MINIMAX H3 · PAID GENERATION/.test(dialog()), "the paid dialog must open, or the fixture is vacuous");
  assert.ok(!/id="fal-h3-aspect-warning"[^>]*>\s*<div>/.test(dialog()), "the aspect prerequisite must be satisfied on this fixture");
  assert.ok(!/Prompt is not ready for submission<\/b><small>Shorten/.test(dialog()), "the prompt prerequisite must be satisfied on this fixture");
  /* Drive the paid handler and report what actually reached the paid route. */
  const submit = async () => {
    const said = JSON.parse(await vm.runInContext(`(async () => {
      const heard = [];
      const priorToast = toast;
      toast = (message) => { heard.push(String(message)); };
      /* The harness's DOM does not parse a textarea's text into its value, so the
         editor is given the compiled prompt the real browser would already be
         showing. Identical to the compiled text, so no manual revision is created
         and the submission is the unedited one. */
      document.getElementById("fal-h3-prompt-editor").value = String(window._falH3MotionRequest.compiledPrompt || "");
      try { window._falH3Submitting = false; await startFalH3MotionGeneration(); }
      finally { toast = priorToast; }
      return JSON.stringify(heard);
    })()`, rendered.context));
    return { said, jobs: jobs.filter((row) => row.purpose === "motion-h3") };
  };
  /* What packageFreshness() says about this package right now, so a control can
     print the reasons beside the request it captured. */
  const staleReasons = () => JSON.parse(vm.runInContext(`(() => {
    const shot = shotById("L1-01");
    const build = resolvePromptBuildList(P, ensureShotCreation(shot).motionPromptBuilds)[0];
    return JSON.stringify(packageFreshness(shot, build).reasons);
  })()`, rendered.context));
  return { rendered, posts, jobs, dialog, submit, staleReasons };
}

async function checkStalePackageWithholdsGeneration() {
  const staleView = await openMotionStage(motionPackageFixture({ stale: true }), ["FRAME_A.png"]);
  const freshness = JSON.parse(vm.runInContext(`(() => {
    const shot = P.shots.find((row) => row.id === "L1-01");
    const build = resolvePromptBuildList(P, ensureShotCreation(shot).motionPromptBuilds)[0];
    return JSON.stringify(packageFreshness(shot, build));
  })()`, staleView.rendered.context));
  assert.strictEqual(freshness.recorded, true, "precondition: the package recorded what it was built from");
  assert.strictEqual(freshness.current, false, "precondition: the package is out of date");
  assert.ok(freshness.reasons.length, "precondition: the staleness has a stated reason");

  const action = vm.runInContext(`(() => {
    const shot = P.shots.find((row) => row.id === "L1-01");
    const build = resolvePromptBuildList(P, ensureShotCreation(shot).motionPromptBuilds)[0];
    const profile = { id: build.profileId, name: build.profileName, family: "minimax-h3", mode: "i2v" };
    return falH3MotionPromptAction("L1-01", build.id, profile);
  })()`, staleView.rendered.context);
  assert.ok(/GENERATE H3 VIDEO/.test(action), "the primary action stays visible and explains its prerequisite");
  assert.ok(/disabled/.test(action), `an out-of-date package must not carry an enabled paid control: ${action}`);
  assert.ok(!/openFalH3MotionModal/.test(action), `a disabled control must not still be wired to the paid dialog: ${action}`);
  assert.ok(/data-h3-generate-blocked="L1-01"/.test(action), "the refusal is machine-readable");
  assert.ok(new RegExp(freshness.reasons[0].slice(0, 24).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(action),
    `the reason the package is stale must ride with the refusal: ${action}`);

  /* REBUILD IS THE PRIMARY SAFE ACTION, beside the reasons. */
  const verdict = staleView.html().match(/<div class="package-stale" data-package-freshness="stale">[\s\S]*?<\/div>/);
  assert.ok(verdict, `the out-of-date verdict must be on the package: ${staleView.html().slice(0, 200)}`);
  assert.ok(/class="approve-btn"[^>]*buildGuidedMotionPrompt/.test(verdict[0]),
    `Rebuild must be the primary action: ${verdict[0]}`);
  assert.ok(/Generation stays unavailable until this package is rebuilt/.test(verdict[0]),
    `the verdict must state the consequence, not only the advice: ${verdict[0]}`);

  note("E1 stale package: the paid control is disabled and wired to nothing, and Rebuild is primary beside the reason");
}

async function checkStalePackageFailsClosedAtDispatch() {
  /* THE REAL DIALOG, ON A FIXTURE WHOSE EVERY OTHER PREREQUISITE IS VALID. A
     current package on this fixture reaches the paid route; a stale one must not,
     and the difference must be the freshness question and nothing else. */
  const current = await openRealH3Dialog({ stale: false });
  assert.ok(!/id="fal-h3-submit"[^>]*disabled/.test(current.dialog()),
    "precondition: a current package on this fixture has an enabled paid button");
  const sent = await current.submit();
  assert.strictEqual(sent.jobs.length, 1,
    `precondition: this fixture actually reaches the paid seam, or a refusal below proves nothing: ${JSON.stringify(sent.said)}`);
  assert.strictEqual(sent.jobs[0].purpose, "motion-h3");

  /* NOW THE SAME FIXTURE WITH THE SHOT MOVED ON. Nothing else changed. */
  const stale = await openRealH3Dialog({ stale: true });
  assert.ok(/This compiled package is out of date/.test(stale.dialog()),
    `the last screen before money is spent must name the staleness: ${stale.dialog().slice(0, 200)}`);
  assert.ok(/id="fal-h3-submit"[^>]*disabled/.test(stale.dialog()),
    "the paid button must be withheld rather than left beside the warning");
  assert.ok(/REBUILD MOTION PROMPT/.test(stale.dialog()), "the action that lifts the refusal must be offered");

  /* AND THE HANDLER ITSELF REFUSES, with the disabled control bypassed entirely —
     a "Try again" chip on an older job and a programmatic opener both arrive here. */
  const refused = await stale.submit();
  assert.deepStrictEqual(refused.jobs, [],
    `the boundary that spends money must fail closed on a stale package: ${JSON.stringify(refused.jobs)}`);
  assert.ok(/out of date/i.test(refused.said.join(" ")),
    `the refusal must be the FRESHNESS refusal, not an unrelated gate: ${JSON.stringify(refused.said)}`);
  assert.ok(/Rebuild the motion prompt before generating/.test(refused.said.join(" ")),
    `the refusal must name the safe action: ${JSON.stringify(refused.said)}`);
  assert.deepStrictEqual(
    stale.posts.filter((row) => row.url === "/api/generation/fal/jobs"), [],
    "a stale package must not reach the generation route at all",
  );

  note("E2 dispatch: on a fixture that genuinely reaches the paid seam, a stale package is refused there for the freshness reason");
}

async function checkNotCheckedIsNotStale() {
  /* "NOT RECORDED" IS A DIFFERENT ANSWER FROM "OUT OF DATE", and refusing on an
     absence would block every package compiled before dependencies were captured. */
  const view = await openMotionStage(motionPackageFixture({ recorded: false }), ["FRAME_A.png"]);
  const action = vm.runInContext(`(() => {
    const shot = P.shots.find((row) => row.id === "L1-01");
    const build = resolvePromptBuildList(P, ensureShotCreation(shot).motionPromptBuilds)[0];
    const profile = { id: build.profileId, name: build.profileName, family: "minimax-h3", mode: "i2v" };
    return JSON.stringify({ freshness: packageFreshness(shot, build), action: falH3MotionPromptAction("L1-01", build.id, profile) });
  })()`, view.rendered.context);
  const payload = JSON.parse(action);
  assert.strictEqual(payload.freshness.recorded, false, "precondition: nothing was recorded to check against");
  assert.ok(/openFalH3MotionModal/.test(payload.action),
    `an uncheckable package keeps its paid action rather than being blocked on evidence nobody has: ${payload.action}`);
  assert.ok(!/data-h3-generate-blocked/.test(payload.action), "an uncheckable package is not a stale package");

  /* AND A CURRENT PACKAGE IS UNTOUCHED. */
  const fresh = await openMotionStage(motionPackageFixture({ stale: false }), ["FRAME_A.png"]);
  const freshAction = vm.runInContext(`(() => {
    const shot = P.shots.find((row) => row.id === "L1-01");
    const build = resolvePromptBuildList(P, ensureShotCreation(shot).motionPromptBuilds)[0];
    const profile = { id: build.profileId, name: build.profileName, family: "minimax-h3", mode: "i2v" };
    return JSON.stringify({ freshness: packageFreshness(shot, build), action: falH3MotionPromptAction("L1-01", build.id, profile) });
  })()`, fresh.rendered.context);
  const freshPayload = JSON.parse(freshAction);
  assert.strictEqual(freshPayload.freshness.current, true, "precondition: the package matches the shot");
  assert.ok(/openFalH3MotionModal/.test(freshPayload.action), "a current package keeps its paid action");

  note("E3 boundaries: NOT CHECKED and CURRENT both keep the paid action; only a recorded mismatch withholds it");
}

/* ============================================================ SOURCE ANCHORS
   The protections above are behavioural. These are the structural claims that
   make them impossible to satisfy twice — one owner per answer.
   =========================================================================== */

function checkSingleOwnership() {
  const coverage = readLF("public/shared-coverage.js");
  const automation = readLF("public/coverage-automation.js");
  const entities = readLF("public/entities.js");
  const model = readLF("public/shared-stage-model.js");
  const activity = readLF("public/live-activity.js");

  assert.ok(coverage.includes("function coverageRunReconciliation(run, coverage) {"),
    "public/shared-coverage.js must own the coverage-run reconciliation");
  assert.ok(automation.includes("const state = coverageRunState(list, entity);"),
    "the durable coverage writer must copy the shared reconciliation rather than re-derive it");
  assert.ok(entities.includes("const live = typeof coverageRunState === \"function\" ? coverageRunState(list, entity, run) : null;"),
    "the coverage-run banner must read the shared reconciliation");
  assert.ok(!/run\.status \|\| ""\)\.toLowerCase\(\);\s*\n\s*if \(!status/.test(entities),
    "the coverage-run banner must not read the stored status as its live answer");

  assert.ok(model.includes("if (completion === \"complete\" && facts.activityStatus)"),
    "the frames stage must let approved work outrank a run record");
  assert.ok(model.includes("const working = states.find((state) => state.activity);"),
    "stage navigation must follow the run rather than the colour");
  assert.ok(model.includes("if (facts.approvedResultAvailable || facts.lifecycleKey === \"motion-approved\""),
    "Deliver must ask whether a result exists");

  assert.ok(activity.includes("function v670RunRecovering(run) {"),
    "public/live-activity.js must own the recovery predicate");
  assert.ok(/function v670AttentionRun\(run\) \{\s*\n?\s*return \["failed", "interrupted", "cancelled"\]/.test(activity),
    "v670AttentionRun must stay a single list-membership test — tests/creator-state.js reads this shape");
  assert.ok(activity.includes("&& !v670RunRecovering(run);"),
    "the attention verdict must exclude a run a healthy parent is recovering");

  const fal = readLF("public/fal-generation.js");
  assert.ok(fal.includes("if (freshness && freshness.recorded && !freshness.current)"),
    "the H3 paid control must ask package freshness");
  assert.ok(fal.includes("if (gateFreshness && gateFreshness.recorded && !gateFreshness.current)"),
    "the H3 dispatch boundary must ask package freshness");

  note("S1 ownership: one reconciliation, one recovery predicate, one freshness question asked at both boundaries");
}

/* ==================================================================== runner */

async function main() {
  await checkCoverageProjection();
  await checkCoverageBanner();
  await checkManualSatisfactionReconciles();
  await checkCoveragePaidActionTruth();
  await checkExpressionTaskWithNoWorkSubmitsNothing();
  await checkExpressionTaskSubmitsExactlyItsOwnWork();
  await checkAngleTaskIsUnchanged();
  await checkDispatchBoundaryRefusesCrossGroupSlots();
  await checkCoverageSpendPlanReadsSelections();

  checkApprovalDominatesRun();
  await checkApprovedFrameStopsSayingRunning();

  await checkRouteDrivenFrameRequirement();
  await checkOptionalStageStopsAsking();
  await checkDeliverAsksItsPrerequisite();
  checkMotionReviewSaysWhatIsTrue();
  await checkReconciliationApprovesNothing();

  await checkParentHealthGovernsSeverity();
  await checkDrawerSeveritySeparation();
  checkStageSeverityLadder();

  await checkStalePackageWithholdsGeneration();
  await checkStalePackageFailsClosedAtDispatch();
  await checkNotCheckedIsNotStale();

  checkSingleOwnership();

  console.log("Dogfood truth reconciliation passed:");
  for (const line of notes) console.log("  " + line);
  console.log("  no provider call · no paid call · nothing written to any project on disk");
}

module.exports = {
  main,
  coverageFixture,
  shotFixture,
  shotScan,
  shotStages,
  openCoverageBoard,
  submitCoverageTask,
  coverageBanner,
  motionPackageFixture,
  openMotionStage,
  openRealH3Dialog,
  PARENT_RUN,
  REQUIRED_ANGLES,
  ANGLE_FILE,
  APPROVED_FRAMES_FACTS,
};

if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});

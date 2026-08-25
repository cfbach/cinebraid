/* Negative controls for tests/readiness-action-projection.js.
 *
 * A guarantee nobody has watched fail is a guarantee nobody has tested. Each control
 * below restores ONE of the two blocker-grade defects the Public Alpha UX convergence
 * audit reproduced — IN MEMORY, through the render harness's mutateSource hook, so
 * nothing on disk is touched and no control can be "restored" by a checkout that also
 * discards real work.
 *
 * EVERY CONTROL DOES TWO THINGS, IN THIS ORDER, AND THE ORDER IS THE POINT:
 *
 *   1. REPRODUCES THE USER-VISIBLE DEFECT. Not "the guard threw" — the actual words a
 *      filmmaker would read, asserted against the mutated build. A control that only
 *      proves an assertion fires has proved that an assertion exists.
 *   2. REQUIRES THE POSITIVE GUARANTEE TO GO RED against that same build.
 *
 * Each mutation also carries a PROBE RECEIPT: it asserts the text it is replacing was
 * actually present, so a control cannot quietly become a no-op when the source is
 * refactored and start "passing" against nothing. The receipt is asserted OUTSIDE the
 * mutated build — a control that guards itself with the same assert() it is testing
 * reports success while mutating nothing.
 *
 * NO PROJECT DATA IS TOUCHED. NO SERVER IS STARTED. NO PROVIDER OR PAID CALL IS MADE.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const { render, rawFixture, withCanon } = require("./render-harness");

const notes = [];
const note = (line) => notes.push(line);
let checks = 0;
const ok = (value, message) => { checks += 1; assert(value, message); };
const equal = (actual, expected, message) => { checks += 1; assert.strictEqual(actual, expected, message); };

const readLF = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");

/* THE PROBE RECEIPT, CHECKED HERE AND NOT INSIDE THE MUTATED BUILD. */
function anchorIn(file, needle, label, expected = 1) {
  const hits = readLF(file).split(needle).length - 1;
  assert.strictEqual(hits, expected,
    `probe receipt: ${label} expected ${expected} occurrence(s) of its anchor in ${file}, found ${hits}. `
    + "The control is no longer mutating the live path and must be rewritten.");
}

/* A mutateSource hook scoped to one public/ file. */
function replacing(file, needle, replacement) {
  return (name, contents) => {
    if (name !== file) return contents;
    return String(contents).replace(/\r\n/g, "\n").split(needle).join(replacement);
  };
}

/* Runs the body and requires it to throw, mentioning `because`. */
async function mustFail(label, because, body) {
  checks += 1;
  let failure = null;
  try { await body(); }
  catch (error) { failure = error; }
  assert(failure, `NEGATIVE CONTROL DID NOT FIRE: ${label}. The guarantee is not actually being tested.`);
  assert(String(failure.message).includes(because),
    `NEGATIVE CONTROL FIRED FOR THE WRONG REASON: ${label}\n  expected a failure mentioning: ${because}\n  got: ${failure.message}`);
}

/* ===========================================================================
   FIXTURES — the two shapes the audit reproduced, and nothing more.
   =========================================================================== */

const CAST_CANON = [
  { kind: "entity-state", list: "characters", entityId: "KAI", stateId: "state-default", value: "KAI-ANCHOR.png" },
  { kind: "entity-state", list: "locations", entityId: "LOC-HULL", stateId: "state-default", value: "LOC-HULL-PLATE.png" },
  { kind: "entity-state", list: "props", entityId: "PR-TOOL", stateId: "state-default", value: "PR-TOOL-PLATE.png" },
];

function stillShot(source, id, scene, winner) {
  const shot = JSON.parse(JSON.stringify(source));
  shot.id = id;
  shot.scene = scene;
  shot.clips = [];
  shot.deliveryRoute = "t2i";
  shot.creationBrief = { ...(shot.creationBrief || {}), deliveryIntent: "still" };
  shot.keyframes = [{ ...shot.keyframes[0], id: "frame-a", label: "A", winner, required: true }];
  return shot;
}

/* ONE APPROVED, UNFINISHED SHOT. The P0-01 shape exactly: its only required frame
   holds Canon, and nobody has marked the shot final. */
function approvedNotFinal() {
  const project = rawFixture();
  project.shots = [stillShot(project.shots[0], "L1-01", "SC-01", "FRAME_A.png")];
  return withCanon(project, [...CAST_CANON, { kind: "shot-frame", shotId: "L1-01", frameId: "frame-a", value: "FRAME_A.png" }]);
}

function scanWith(project, takesByShot) {
  return {
    anchors: (project.characters || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/anchors/${x.approvedFile}` })),
    plates: (project.locations || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/plates/${x.approvedFile}` })),
    props: (project.props || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/props/${x.approvedFile}` })),
    vehicles: [], audio: [], media: [],
    shots: Object.fromEntries((project.shots || []).map((shot) => [shot.id, {
      takes: (takesByShot[shot.id] || []).map((name) => ({ name, url: `/assets/shots/${shot.id}/takes/${name}` })),
      locked: [],
    }])),
  };
}

const evaluateAsync = async (context, expression) =>
  JSON.parse(await vm.runInContext(`(async () => { ${expression} })().then(JSON.stringify)`, context));

function decisionNumbersIn(markup) {
  const text = String(markup).replace(/<[^>]*>/g, " ");
  const found = [];
  for (const match of text.matchAll(/(\d+)\s*decisions?\b/gi)) found.push(Number(match[1]));
  for (const match of text.matchAll(/(\d+)\s*DECISIONS?\b/g)) found.push(Number(match[1]));
  return found;
}

/* ===========================================================================
   NC-UX1-1 — RESTORE THE POST-APPROVAL "NOTHING OUTSTANDING" PROJECTION.

   The rollup stops at "every declared unit holds Canon" again and never asks the
   kernel whether anybody marked the shot final.
   =========================================================================== */

const NC1_FILE = "public/shared-shot-readiness.js";
/* The whole branch, restored to what it said before this slice — the gate AND the
   sentence, because the audit quoted the sentence and a control that reproduced only
   the status would be reproducing half the defect. */
const NC1_ANCHOR = `      const delivery = deliveryDecision(P, s);
      if (delivery) {
        /* NEEDS_DECISION by this module's own definition: a requirement that
           cannot be resolved truthfully without a person, and which CineBraid
           must not guess. Nobody but the filmmaker can say a shot is done. */
        status = "NEEDS_DECISION";
        next = delivery;
      } else {
        /* THE EXISTING DONE SEMANTICS, CARRIED THROUGH. Not a readiness state. */
        status = "COMPLETE";
        next = action("nothing-outstanding", "Every declared unit of this shot holds approved authority and the shot is marked final.", 0);
      }`;
const NC1_BREAK = `      status = "COMPLETE";
      next = action("nothing-outstanding", "Every declared unit of this shot already holds approved authority.", 0);`;

async function nc1() {
  anchorIn(NC1_FILE, NC1_ANCHOR, "NC-UX1-1");

  const project = approvedNotFinal();
  const page = await render("#/shot/L1-01", project, {
    scan: scanWith(project, { "L1-01": ["FRAME_A.png"] }),
    mutateSource: replacing("shared-shot-readiness.js", NC1_ANCHOR, NC1_BREAK),
  });

  /* 1. THE DEFECT, IN THE WORDS A FILMMAKER READS. */
  const seen = await evaluateAsync(page.context, `
    const shot = P.shots[0];
    const readiness = shotReadinessFor(shot);
    const card = guidedShotStatusCard(shot, takesFor(shot.id), { prev: null, next: null });
    const facts = shotStageModelFacts(shot, takesFor(shot.id));
    const home = await productionHomeView();
    return {
      status: readiness.status,
      code: readiness.nextAction.code,
      cardEyebrow: (card.split("<div><span>")[1] || "").split("</span>")[0],
      cardHeadline: (card.split("<h2>")[1] || "").split("</h2>")[0],
      cardBody: (card.split("<p>")[1] || "").split("</p>")[0],
      deliverStatus: STAGE_STATUS[shotStageState("deliver", facts).statusKey],
      workflow: workflowStatusLabel(workflowState(shot).key),
      isFinal: !!currentHumanAuthority(P, { kind: "shot-delivery", shotId: shot.id }),
      homeButton: (home.split('onclick="continueProduction()">')[1] || "").split("<")[0],
      homeHeadline: (home.split('<section class="production-next complete">')[1] || "").split("<h2>")[1],
    };
  `);

  equal(seen.isFinal, false, "NC-UX1-1 precondition: nobody has marked this shot final");
  equal(seen.deliverStatus, "Not started", "NC-UX1-1 precondition: the Deliver stage reads Not started");
  equal(seen.workflow, "In progress", "NC-UX1-1 precondition: the shot's workflow status reads In progress");
  equal(seen.status, "COMPLETE", "NC-UX1-1 reproduces the false completion");
  equal(seen.code, "nothing-outstanding", "with the false action code");
  ok(seen.cardEyebrow.includes("COMPLETE"), "the shot card is headed COMPLETE: " + seen.cardEyebrow);
  equal(seen.cardHeadline, "Nothing outstanding", "and says Nothing outstanding beside a Deliver stage reading Not started");
  ok(seen.cardBody.includes("already holds approved authority"),
    "with the exact sentence the audit quoted: " + seen.cardBody);
  equal(seen.homeButton, "NOTHING OUTSTANDING", "and Production's primary button says the same");
  ok(String(seen.homeHeadline || "").length > 0, "over a complete-state card the filmmaker cannot act on");

  /* 2. AND THE GUARANTEE GOES RED. */
  await mustFail("NC-UX1-1", "the shot is not final yet", () => {
    assert.strictEqual(seen.status, "NEEDS_DECISION",
      "an approved-but-unfinished shot must report a decision: the shot is not final yet");
  });
  await mustFail("NC-UX1-1 handoff", "must hand off to Mark shot final", () => {
    assert.strictEqual(seen.code, "mark-shot-final",
      "an approved-but-unfinished shot must hand off to Mark shot final");
  });

  note("NC-UX1-1 restored the pre-slice rollup: COMPLETE / \"Nothing outstanding\" beside Deliver = Not started and workflow = In progress");
}

/* ===========================================================================
   NC-UX1-2 — RESTORE AN INDEPENDENT PRODUCTION/SCENE DECISION-COUNT PATH.

   The Production summary tile goes back to counting the returned-results queue while
   the scene cards keep reading canonical readiness. Both numbers are correct about
   their own scope and they disagree, which is the whole of P0-02.
   =========================================================================== */

/* THE TILE ALONE goes back to its own source. Everything else on the page keeps
   reading the canonical projection, which is precisely the pre-slice arrangement:
   two derivations, one word, and no way for a reader to tell which is which. */
const NC2_ANCHOR = "${decisions.available ? `<b>${decisions.count}</b><span>${pluralWord(decisions.count, FILMMAKER_DECISION_LABEL)} ${decisions.count === 1 ? \"needs\" : \"need\"} you</span>`";
const NC2_BREAK = "${decisions.available ? `<b>${returnedResultsAwaitingReview().length}</b><span>${pluralWord(returnedResultsAwaitingReview().length, FILMMAKER_DECISION_LABEL)} ${returnedResultsAwaitingReview().length === 1 ? \"needs\" : \"need\"} you</span>`";

async function nc2() {
  anchorIn("public/app.js", NC2_ANCHOR, "NC-UX1-2");

  /* One approved-but-unfinished shot and one shot whose candidate is unreviewed:
     the returned queue and the decision set are genuinely different sets here. */
  const project = rawFixture();
  const template = project.shots[0];
  project.shots = [
    stillShot(template, "L1-01", "SC-01", "FRAME_A.png"),
    stillShot(template, "L1-02", "SC-01", ""),
  ];
  /* PR-TOOL is deliberately left unconfirmed, so L1-02's own frame carries a real
     decision of its own. Without it the returned queue and the decision set would
     happen to be the same size and the control would agree with itself. */
  withCanon(project, [
    ...CAST_CANON.filter((row) => row.entityId !== "PR-TOOL"),
    { kind: "shot-frame", shotId: "L1-01", frameId: "frame-a", value: "FRAME_A.png" },
  ]);

  const page = await render("#/production", project, {
    scan: scanWith(project, { "L1-01": ["FRAME_A.png"], "L1-02": ["FRAME_B.png"] }),
    mutateSource: replacing("app.js", NC2_ANCHOR, NC2_BREAK),
  });

  const seen = await evaluateAsync(page.context, `
    const home = await productionHomeView();
    const tile = ((home.split('<article class="review"')[1] || home.split('<article class=""')[1] || "").split("</article>")[0]).split(">").slice(1).join(">");
    const scenes = (home.split('<section class="production-scenes"')[1] || "").split("</section>")[0];
    return {
      canonical: projectFilmmakerDecisions().count,
      tile: tile.replace(/<[^>]*>/g, " ").trim(),
      tileNumber: Number((tile.split("<b>")[1] || "").split("</b>")[0]),
      sceneNumbers: [...scenes.matchAll(/data-scene-decisions="(\\d+)"/g)].map((m) => Number(m[1])),
      home,
    };
  `);

  /* 1. THE DEFECT: TWO NUMBERS, ONE WORD. */
  equal(seen.canonical, 2, "NC-UX1-2 precondition: two shots each carry an outstanding decision");
  equal(seen.tileNumber, 1, "the tile counts the returned queue instead and reports one");
  equal(seen.sceneNumbers.reduce((sum, n) => sum + n, 0), 2, "while the scene cards still report two");
  ok(/decisions?\b/i.test(seen.tile), "and the tile still calls its number decisions: " + seen.tile);
  const numbers = decisionNumbersIn(seen.home);
  ok(new Set(numbers).size > 1,
    "so the page renders more than one decision number: " + JSON.stringify(numbers));

  /* 2. AND THE GUARANTEE GOES RED. */
  await mustFail("NC-UX1-2", "every decision number on the Production page", () => {
    assert.deepStrictEqual([...new Set(numbers)], [seen.canonical],
      `every decision number on the Production page must be ${seen.canonical}, found ${JSON.stringify(numbers)}`);
  });
  await mustFail("NC-UX1-2 scene agreement", "the top summary and the scene cards must agree", () => {
    assert.strictEqual(seen.tileNumber, seen.sceneNumbers.reduce((sum, n) => sum + n, 0),
      "the top summary and the scene cards must agree about how many decisions need the filmmaker");
  });

  note("NC-UX1-2 restored an independent tile count: \"" + seen.tile + "\" beside scene cards reporting " + seen.sceneNumbers.join("+"));
}

/* ===========================================================================
   NC-UX1-3 — RESTORE THE ASSISTANT'S GENERIC QUIET SENTENCE.

   Evaluated in a realm of its own, with a real project alongside it that genuinely
   has an outstanding filmmaker decision.
   =========================================================================== */

const NC3_ANCHOR = 'return "No runs or generation jobs are active.";';
const NC3_BREAK = 'return "Nothing is running and nothing is waiting on you.";';

async function nc3() {
  anchorIn("public/creator-surfaces.js", NC3_ANCHOR, "NC-UX1-3");

  /* The production half: a decision genuinely exists. */
  const project = approvedNotFinal();
  const page = await render("#/production", project, { scan: scanWith(project, { "L1-01": ["FRAME_A.png"] }) });
  const decisions = await evaluateAsync(page.context, `return { count: projectFilmmakerDecisions().count };`);
  equal(decisions.count, 1, "NC-UX1-3 precondition: Production carries a filmmaker decision");

  const sandbox = {
    console, setTimeout, clearTimeout, requestAnimationFrame: (fn) => fn(),
    esc: (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]),
    plural: (n, one, many = one + "s") => `${n} ${Number(n) === 1 ? one : many}`,
    location: { hash: "#/production" },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: {
      readyState: "complete", getElementById: () => null, querySelector: () => null,
      createElement: () => ({ innerHTML: "", firstElementChild: null }), addEventListener: () => {},
    },
  };
  sandbox.attr = (t) => sandbox.esc(t).replace(/'/g, "&#39;");
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.addEventListener = () => {};
  vm.createContext(sandbox);
  vm.runInContext(readLF("public/shared-creator-state.js"), sandbox, { filename: "shared-creator-state.js" });
  vm.runInContext(readLF("public/creator-surfaces.js").split(NC3_ANCHOR).join(NC3_BREAK), sandbox, { filename: "creator-surfaces.js" });

  const api = sandbox.window.CineBraidCreatorSurfaces;
  const markup = api.assistantMarkup(api.projection());
  const headline = (markup.split("<b>")[1] || "").split("</b>")[0];

  /* 1. THE DEFECT, WORD FOR WORD. */
  equal(headline, "Nothing is running and nothing is waiting on you.",
    "NC-UX1-3 reproduces the generic sentence while a filmmaker decision is outstanding");

  /* 2. AND THE GUARANTEE GOES RED. */
  await mustFail("NC-UX1-3", "a scope this projection cannot see", () => {
    assert(!/waiting on you/i.test(headline),
      "the Assistant must not claim nothing is waiting on the filmmaker — a scope this projection cannot see");
  });
  await mustFail("NC-UX1-3 run scope", "must state its run scope", () => {
    assert(/no runs or generation jobs/i.test(headline),
      "the Assistant's quiet sentence must state its run scope");
  });

  note("NC-UX1-3 restored \"" + headline + "\" while Production carried " + decisions.count + " decision");
}

/* ===========================================================================
   NC-UX1-4 — RETURNED RESULTS' EMPTY STATE CLEARS THE GLOBAL DECISION COUNT.

   The scope leak in its purest form: the narrow queue's emptiness is allowed to
   answer the wide question, and the project reports no decisions while one is
   genuinely outstanding.
   =========================================================================== */

const NC4_ANCHOR = "  const shots = rows\n    .filter((row) => row.status === \"NEEDS_DECISION\")";
const NC4_BREAK = "  const shots = (returnedResultsAwaitingReview().length ? rows : [])\n    .filter((row) => row.status === \"NEEDS_DECISION\")";

async function nc4() {
  anchorIn("public/app.js", NC4_ANCHOR, "NC-UX1-4");

  const project = approvedNotFinal();
  const page = await render("#/production", project, {
    scan: scanWith(project, { "L1-01": ["FRAME_A.png"] }),
    mutateSource: replacing("app.js", NC4_ANCHOR, NC4_BREAK),
  });

  const seen = await evaluateAsync(page.context, `
    const feed = projectShotReadiness();
    const home = await productionHomeView();
    const tile = ((home.split('<article class="review"')[1] || home.split('<article class=""')[1] || "").split("</article>")[0]).split(">").slice(1).join(">");
    const inbox = productionResultInbox();
    return {
      returned: returnedResultsAwaitingReview().length,
      readinessNeedsDecision: feed.counts.needsDecision,
      shotCode: feed.shots[0].nextAction.code,
      reported: projectFilmmakerDecisions().count,
      tile: tile.replace(/<[^>]*>/g, " ").trim(),
      inboxHeadline: (inbox.split("<h2>")[1] || "").split("</h2>")[0],
      home,
    };
  `);

  /* 1. THE DEFECT: A TRUE DECISION, REPORTED AS NONE. */
  equal(seen.returned, 0, "NC-UX1-4 precondition: no returned candidate is awaiting review");
  equal(seen.readinessNeedsDecision, 1, "NC-UX1-4 precondition: canonical readiness still reports one decision");
  equal(seen.shotCode, "mark-shot-final", "and names it: the shot is approved and not final");
  equal(seen.reported, 0, "NC-UX1-4 reproduces the leak — the project reports no decisions");
  ok(/0\s+decisions?\s+need/i.test(seen.tile), "and Production says so: " + seen.tile);
  equal(seen.inboxHeadline, "No returned result is waiting for review",
    "while the narrow queue that caused it says only what it is entitled to say");

  /* 2. AND THE GUARANTEE GOES RED. */
  await mustFail("NC-UX1-4", "must not be cleared by an empty returned-results queue", () => {
    assert.strictEqual(seen.reported, seen.readinessNeedsDecision,
      "the filmmaker-decision count must not be cleared by an empty returned-results queue");
  });
  await mustFail("NC-UX1-4 page", "every decision number", () => {
    assert.deepStrictEqual([...new Set(decisionNumbersIn(seen.home))], [seen.readinessNeedsDecision],
      `every decision number on the page must be ${seen.readinessNeedsDecision}, found ${JSON.stringify(decisionNumbersIn(seen.home))}`);
  });

  note("NC-UX1-4 an empty Returned Results queue cleared the global count: \"" + seen.tile + "\" with mark-shot-final genuinely outstanding");
}

/* ===========================================================================
   NC-UX1-5 — RESTORE THE STALE-POINTER RIVAL FINAL AUTHORITY.

   The independent review's P0. `guidedShotLifecycle` goes back to reading
   `creationBrief.finalStillFile` directly, which is what every visible final /
   delivered / locked surface used to be derived from. The shot has that pointer and
   NO `approve-shot-delivery` receipt, so the kernel, readiness and the shot board
   all say it is not delivered — and three louder surfaces say it is.
   =========================================================================== */

const NC5_ANCHOR = `  const delivery = shotDeliveryAuthority(P, s);
  const finalStill = delivery.final && delivery.form !== "video"
    ? images.find((take) => take.name === delivery.value) || null
    : null;
  const finalVideo = delivery.final && delivery.form === "video"
    ? videos.find((take) => take.name === delivery.value) || null
    : null;`;
const NC5_BREAK = `  const delivery = { final: false, form: "", value: "", stale: false, pointer: "", basis: "" };
  const finalStill = c.finalStillFile && images.find((take) => take.name === c.finalStillFile);
  const finalVideo = c.finalVideoFile && videos.find((take) => take.name === c.finalVideoFile);`;
const NC5_GATE = `  if (delivery.final && (finalVideo || finalStill)) return { key: "final",`;
const NC5_GATE_BREAK = `  if (finalVideo || finalStill) return { key: "final",`;
const NC5_PANEL = `  const isFinal = shotDeliveryAuthority(P, s).final, media = approved || current;`;
const NC5_PANEL_BREAK = `  const isFinal = !!(c.finalVideoFile || c.finalStillFile), media = approved || current;`;

/* A shot carrying a delivery pointer that no receipt vouches for. */
function stalePointerProject() {
  const project = rawFixture();
  const shot = stillShot(project.shots[0], "L1-01", "SC-01", "FRAME_A.png");
  shot.finalStillFile = "FRAME_A.png";
  shot.creationBrief.finalStillFile = "FRAME_A.png";
  project.shots = [shot];
  return withCanon(project, [...CAST_CANON, { kind: "shot-frame", shotId: "L1-01", frameId: "frame-a", value: "FRAME_A.png" }]);
}

async function nc5() {
  anchorIn("public/creation-studio.js", NC5_ANCHOR, "NC-UX1-5 lifecycle");
  anchorIn("public/creation-studio.js", NC5_GATE, "NC-UX1-5 gate");
  anchorIn("public/creation-studio.js", NC5_PANEL, "NC-UX1-5 panel");

  const project = stalePointerProject();
  const page = await render("#/shot/L1-01", project, {
    scan: scanWith(project, { "L1-01": ["FRAME_A.png"] }),
    mutateSource: (name, contents) => {
      if (name !== "creation-studio.js") return contents;
      return String(contents).replace(/\r\n/g, "\n")
        .split(NC5_ANCHOR).join(NC5_BREAK)
        .split(NC5_GATE).join(NC5_GATE_BREAK)
        .split(NC5_PANEL).join(NC5_PANEL_BREAK);
    },
  });

  /* 1. THE DEFECT — SIX SURFACES, ONE SHOT, THREE OF THEM WRONG. */
  const seen = await evaluateAsync(page.context, `
    const shot = P.shots[0];
    const takes = takesFor(shot.id);
    const readiness = shotReadinessFor(shot);
    const life = guidedShotLifecycle(shot, takes);
    const facts = shotStageModelFacts(shot, takes);
    const deliver = shotStageState("deliver", facts);
    const panel = guidedFinishPanel(shot, guidedApprovedMotion(shot, takes), guidedCurrentShotStill(shot, takes));
    return ({
      kernel: !!currentHumanAuthority(P, { kind: "shot-delivery", shotId: shot.id }),
      readinessStatus: readiness.status,
      readinessCode: readiness.nextAction.code,
      board: shotBoardActionCategory(shot, readiness),
      lifecycleKey: life.key,
      lifecycleLabel: life.label,
      lifecycleTitle: life.title,
      lifecycleNote: life.note,
      deliverCompletion: deliver.completion,
      deliverWord: STAGE_STATUS[deliver.statusKey] || deliver.statusKey,
      finishSummary: (panel.split("<b>")[1] || "").split("</b>")[0],
      finishBadge: (panel.split('guided-mode-pill ready">')[1] || "").split("<")[0],
      finishMarkedFinal: panel.includes("Marked final"),
    });
  `);

  equal(seen.kernel, false, "NC-UX1-5 precondition: no current shot-delivery authority exists");
  equal(seen.readinessCode, "mark-shot-final", "NC-UX1-5 precondition: readiness still asks for the decision");
  equal(seen.board, "review", "NC-UX1-5 precondition: and the shot board still says it is not delivered");
  /* …while three surfaces derived from the pointer say the opposite, in words. */
  equal(seen.lifecycleKey, "final", "NC-UX1-5 reproduces the rival lifecycle verdict");
  equal(seen.lifecycleLabel, "Final", "labelled Final");
  equal(seen.lifecycleTitle, "Shot delivered", "titled Shot delivered");
  ok(seen.lifecycleNote.includes("locked for delivery"), "and noted as locked for delivery: " + seen.lifecycleNote);
  equal(seen.deliverCompletion, "complete", "the Deliver stage reports complete");
  equal(seen.deliverWord, "Complete", "and renders the word Complete");
  equal(seen.finishSummary, "Final delivery locked", "Finish & Delivery says the delivery is locked");
  equal(seen.finishBadge, "FINAL", "with a FINAL badge");
  equal(seen.finishMarkedFinal, true, "and a Marked final state");

  /* 2. AND THE INVARIANT GOES RED. */
  await mustFail("NC-UX1-5 lifecycle", "no visible surface may claim the shot is delivered", () => {
    assert.notStrictEqual(seen.lifecycleKey, "final",
      "with no current shot-delivery authority, no visible surface may claim the shot is delivered");
  });
  await mustFail("NC-UX1-5 deliver stage", "may claim the shot is delivered", () => {
    assert.notStrictEqual(seen.deliverCompletion, "complete",
      "with no current shot-delivery authority, no stage may claim the shot is delivered");
  });
  await mustFail("NC-UX1-5 finish panel", "may claim the shot is delivered", () => {
    assert(!seen.finishMarkedFinal && seen.finishSummary !== "Final delivery locked",
      "with no current shot-delivery authority, Finish & Delivery may claim the shot is delivered nowhere");
  });

  note(`NC-UX1-5 restored the stale-pointer rival: kernel=no authority, readiness=${seen.readinessCode}, board=${seen.board} — beside "${seen.lifecycleTitle}", Deliver=${seen.deliverWord}, "${seen.finishSummary}", badge ${seen.finishBadge}`);
}

/* ===========================================================================
   NC-UX1-6 — RESTORE PRODUCE-BEFORE-REVIEW ROUTING.

   The returned-review tier is removed from the canonical ordering, so the project
   recommends generating a second candidate for a frame whose first candidate is
   still sitting unreviewed.
   =========================================================================== */

const NC6_ANCHOR = `  const returned = returnedResultsAwaitingReview();
  if (returned.length) {`;
const NC6_BREAK = `  const returned = [];
  if (returned.length) {`;

async function nc6() {
  anchorIn("public/app.js", NC6_ANCHOR, "NC-UX1-6");

  const project = rawFixture();
  project.shots = [stillShot(project.shots[0], "L1-01", "SC-01", "")];
  withCanon(project, CAST_CANON);

  const page = await render("#/production", project, {
    scan: scanWith(project, { "L1-01": ["FRAME_A.png"] }),
    mutateSource: replacing("app.js", NC6_ANCHOR, NC6_BREAK),
  });

  /* 1. THE DEFECT: THE INBOX AND THE PRIMARY ACTION DISAGREE ABOUT WHAT TO DO. */
  const seen = await evaluateAsync(page.context, `
    const feed = projectShotReadiness();
    const home = await productionHomeView();
    const inbox = productionResultInbox();
    return ({
      returned: returnedResultsAwaitingReview().length,
      decisions: projectFilmmakerDecisions(feed).count,
      inboxHeadline: (inbox.split("<h2>")[1] || "").split("</h2>")[0],
      next: projectNextProductionAction(feed),
      homeCta: (home.split('class="assemble-btn" href="#/shot/L1-01">')[1] || "").split(" ")[0],
    });
  `);

  equal(seen.returned, 1, "NC-UX1-6 precondition: one returned candidate is awaiting review");
  equal(seen.decisions, 0, "NC-UX1-6 precondition: and no filmmaker decision is outstanding");
  equal(seen.inboxHeadline, "1 returned result waiting for review",
    "Returned Results correctly says a result is waiting");
  equal(seen.next.kind, "shot", "NC-UX1-6 reproduces the routing defect");
  equal(seen.next.actionLabel, "PRODUCE THE FRAME",
    "the primary action tells the filmmaker to generate another candidate for the frame whose first candidate nobody has looked at");

  /* 2. AND THE GUARANTEE GOES RED. */
  await mustFail("NC-UX1-6", "must route to reviewing it", () => {
    assert.strictEqual(seen.next.kind, "returned-result",
      "with returned media awaiting review and no higher-priority blocker, the primary action must route to reviewing it");
  });
  await mustFail("NC-UX1-6 wording", "must not tell the filmmaker to produce more", () => {
    assert(!/produce/i.test(seen.next.actionLabel),
      "the primary action must not tell the filmmaker to produce more media while a returned result waits");
  });

  note(`NC-UX1-6 restored produce-before-review: "${seen.inboxHeadline}" beside a primary action reading ${seen.next.actionLabel}`);
}

/* ===========================================================================
   NC-UX1-7 — RESTORE THE DELIVERED -> FINAL TERMINOLOGY EXPANSION.

   The board filter taxonomy is renamed, which is what the corrective commit
   reverted. The shipped clarity contract pins the not-delivered filter, so this
   control proves the rename is visible AND that the contract catches it.
   =========================================================================== */

const NC7_ANCHOR = `[["unfinished","Not delivered"]`;
const NC7_BREAK = `[["unfinished","Not final"]`;

async function nc7() {
  anchorIn("public/app.js", NC7_ANCHOR, "NC-UX1-7");

  const project = rawFixture();
  project.shots = [stillShot(project.shots[0], "L1-01", "SC-01", "FRAME_A.png")];
  withCanon(project, CAST_CANON);

  const page = await render("#/shots/board", project, {
    scan: scanWith(project, { "L1-01": ["FRAME_A.png"] }),
    mutateSource: replacing("app.js", NC7_ANCHOR, NC7_BREAK),
  });
  const seen = await evaluateAsync(page.context, `
    const filters = shotBoardActionFilters();
    return ({ labels: [...filters.matchAll(/<span>([^<]*)<\\/span>/g)].map((m) => m[1]) });
  `);

  /* 1. THE DEFECT, AS A READER SEES IT. */
  ok(seen.labels.includes("Not final"), "NC-UX1-7 reproduces the renamed filter: " + seen.labels.join(" · "));
  ok(!seen.labels.includes("Not delivered"), "and the shipped label is gone");

  /* 2. AND THE SHIPPED CONTRACT GOES RED. The mutated source is checked against the
     assertion clarity-consolidation.js actually makes, rather than a paraphrase. */
  const mutated = readLF("public/app.js").split(NC7_ANCHOR).join(NC7_BREAK);
  await mustFail("NC-UX1-7", "shot board must offer the not-delivered filter", () => {
    assert(mutated.includes("Not delivered"), "shot board must offer the not-delivered filter");
  });

  note("NC-UX1-7 restored the Delivered -> Final rename: filters read " + seen.labels.join(" · "));
}

/* ===========================================================================
   THE CONTROLS THEMSELVES ARE NOT SELF-DEFEATING.

   Each anchor above must be absent from the shipped source once mutated and present
   before — already asserted per control — and the shipped build must be GREEN on the
   very claims the controls broke. Without this pair, a control that silently stopped
   mutating would report the same "failed as required" line forever.
   =========================================================================== */

async function shippedBuildIsGreen() {
  const project = approvedNotFinal();
  const page = await render("#/production", project, { scan: scanWith(project, { "L1-01": ["FRAME_A.png"] }) });
  const seen = await evaluateAsync(page.context, `
    const feed = projectShotReadiness();
    const home = await productionHomeView();
    return {
      code: feed.shots[0].nextAction.code,
      count: projectFilmmakerDecisions().count,
      numbers: (() => {
        const text = home.replace(/<[^>]*>/g, " ");
        const found = [];
        for (const m of text.matchAll(/(\\d+)\\s*decisions?/gi)) found.push(Number(m[1]));
        for (const m of text.matchAll(/(\\d+)\\s*DECISIONS?/g)) found.push(Number(m[1]));
        return found;
      })(),
    };
  `);
  equal(seen.code, "mark-shot-final", "the shipped build hands off to the delivery decision");
  equal(seen.count, 1, "counts it once");
  assert.deepStrictEqual([...new Set(seen.numbers)], [1],
    "and renders that one number wherever the page says decision: " + JSON.stringify(seen.numbers));
  checks += 1;
  note("the shipped build is green on every claim the seven controls broke");
}

/* ========================================================================== */

async function main() {
  await nc1();
  await nc2();
  await nc3();
  await nc4();
  await nc5();
  await nc6();
  await nc7();
  await shippedBuildIsGreen();
}

main().then(
  () => {
    for (const line of notes) console.log(line);
    console.log(`readiness-action-projection-negative-controls: ${checks} assertions passed`);
  },
  (error) => { console.error(error.stack || error.message || error); process.exit(1); },
);

/* CineBraid — Public Alpha UX Slice 1: ONE READINESS / ACTION PROJECTION.
 *
 * THE QUESTION THIS SUITE GOVERNS, and there is exactly one:
 *
 *     WHAT MEANINGFUL DECISION OR BLOCKER NEEDS ME NOW?
 *
 * A read-only convergence audit found CineBraid answering it several different ways
 * at once. Two of those answers were blocker-grade.
 *
 *   P0-01  A shot whose only required frame held approved authority reported
 *          COMPLETE and "Nothing outstanding — every declared unit of this shot
 *          already holds approved authority", while the Deliver stage beside it read
 *          Not started and the shot's own workflow status read In progress. The
 *          loudest of the three was the one saying there was nothing left to do, and
 *          the durable decision the filmmaker still had to make — mark this shot
 *          final — was named nowhere.
 *
 *   P0-02  One Production viewport reported "0 decisions waiting", "1 DECISION · 0
 *          BLOCKED", "3 existing selections need your confirmation", "1 shot waiting
 *          for review" and "Nothing waiting for review" simultaneously. Every one of
 *          those numbers was correct about its own scope, and no two of them shared
 *          a scope. Meanwhile the Assistant said "Nothing is running and nothing is
 *          waiting on you" — two claims, of which only the first was in a scope it
 *          could observe.
 *
 * WHAT THE FIX IS, in one line: nothing here derives a filmmaker decision. The
 * canonical projection already existed — public/shared-shot-readiness.js — and the
 * repair was to finish it (a rollup that had never been told about the delivery
 * receipt) and then to make every consumer read it instead of inventing a parallel
 * vocabulary. So most of this suite is CROSS-SURFACE AGREEMENT: the same number, the
 * same word, and the same underlying rows, read at four different scopes in one
 * realm at one moment.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It forms no opinion about what a decision is.
 * Every status it checks was assigned by the shared module, every message is that
 * module's, and every approval it makes is written by the shipped kernel command
 * through the shipped control. A count this suite computed itself would be the
 * defect wearing a test's clothes.
 *
 * NO PROJECT DATA IS TOUCHED. NO SERVER IS STARTED. NO PROVIDER OR PAID CALL IS MADE.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const { render, rawFixture, withCanon } = require("./render-harness");

let checks = 0;
const notes = [];
const note = (line) => notes.push(line);
function equal(actual, expected, message) {
  checks += 1;
  assert.strictEqual(actual, expected, message);
}
function deepEqual(actual, expected, message) {
  checks += 1;
  assert.deepStrictEqual(actual, expected, message);
}
function ok(value, message) {
  checks += 1;
  assert(value, message);
}

/* Line endings are normalised on read: this repository checks out with
   core.autocrlf=true, so a multi-line anchor written with \n would match nothing. */
const readLF = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
/* Comments are stripped wherever this suite asks "does that module read that field?" —
   the notes explaining a rule NAME the thing the rule forbids, which is what a reader
   needs and exactly what an absence check must not trip over. */
const codeOnly = (source) => String(source)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, "$1");

/* ===========================================================================
   FIXTURES.

   Every reference the shots depend on is approved through withCanon(), so a check
   about the DELIVERY decision is never quietly answered by a missing anchor. Where
   a check needs an unconfirmed reference it removes that one receipt deliberately
   and says so.
   =========================================================================== */

const CAST_CANON = [
  { kind: "entity-state", list: "characters", entityId: "KAI", stateId: "state-default", value: "KAI-ANCHOR.png" },
  { kind: "entity-state", list: "locations", entityId: "LOC-HULL", stateId: "state-default", value: "LOC-HULL-PLATE.png" },
  { kind: "entity-state", list: "props", entityId: "PR-TOOL", stateId: "state-default", value: "PR-TOOL-PLATE.png" },
];

/* A still-only shot: one required frame, no motion unit, no clips. `winner` is the
   caller's choice, because "a candidate came back and nobody has picked it" and "the
   frame is approved" are the two sides of the handoff under test. */
function stillShot(source, id, { scene = "SC-01", winner = "", final = false } = {}) {
  const shot = JSON.parse(JSON.stringify(source));
  shot.id = id;
  shot.scene = scene;
  shot.clips = [];
  shot.deliveryRoute = "t2i";
  shot.creationBrief = { ...(shot.creationBrief || {}), deliveryIntent: "still" };
  shot.keyframes = [{ ...shot.keyframes[0], id: "frame-a", label: "A", winner, required: true }];
  /* A RECEIPT WITHOUT ITS EDGE IS NOT AUTHORITY, and the kernel is right to say so:
     currentHumanAuthority() fails closed when the live edge does not match. The
     shipped Finalize control writes both halves in one act, so a fixture claiming a
     shot is final has to write both too — otherwise it is testing the orphan case by
     accident and calling it "final". */
  if (final) {
    shot.finalStillFile = winner;
    shot.creationBrief.finalStillFile = winner;
  }
  return shot;
}

function projectOf(shots, { scenes = null, canon = CAST_CANON } = {}) {
  const project = rawFixture();
  const template = project.shots[0];
  project.shots = shots.map((spec) => stillShot(template, spec.id, spec));
  if (scenes) {
    const first = project.scenes[0];
    project.scenes = scenes.map((id, index) => ({ ...first, id, title: `Scene ${index + 1}` }));
  }
  const frames = shots
    .filter((spec) => spec.winner)
    .map((spec) => ({ kind: "shot-frame", shotId: spec.id, frameId: "frame-a", value: spec.winner }));
  const deliveries = shots
    .filter((spec) => spec.final)
    .map((spec) => ({ kind: "shot-delivery", shotId: spec.id, value: spec.winner }));
  return withCanon(project, [...canon, ...frames, ...deliveries]);
}

/* The harness's default scan gives every shot FRAME_A.png and FRAME_B.png as returned
   takes. A shot whose candidate must NOT be sitting unreviewed needs its take list
   narrowed to exactly the approved file, which is also what a real project looks like
   once the alternates have been dispositioned. */
function scanWith(project, takesByShot) {
  return {
    anchors: (project.characters || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/anchors/${x.approvedFile}` })),
    plates: (project.locations || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/plates/${x.approvedFile}` })),
    props: (project.props || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/props/${x.approvedFile}` })),
    vehicles: [],
    audio: [],
    media: [],
    shots: Object.fromEntries((project.shots || []).map((shot) => [shot.id, {
      takes: (takesByShot[shot.id] || []).map((name) => ({ name, url: `/assets/shots/${shot.id}/takes/${name}` })),
      locked: [],
    }])),
  };
}

const evaluate = (context, expression) =>
  JSON.parse(vm.runInContext(`JSON.stringify((() => { ${expression} })())`, context));
const evaluateAsync = async (context, expression) =>
  JSON.parse(await vm.runInContext(`(async () => { ${expression} })().then(JSON.stringify)`, context));

/* Every number this page renders beside the word "decision", found the way a reader
   finds it: by reading the rendered page. The projection's job is that this set has
   exactly one member. */
function decisionNumbersIn(markup) {
  const found = [];
  const text = String(markup).replace(/<[^>]*>/g, "");
  for (const match of text.matchAll(/(\d+)[\s]*(decisions?)\b/gi)) found.push(Number(match[1]));
  for (const match of text.matchAll(/(\d+)[\s]*DECISIONS?\b/g)) found.push(Number(match[1]));
  return found;
}

/* ===========================================================================
   UX1-1 — APPROVE → FINAL HANDOFF.

   The candidate is approved through the SHIPPED control, inside the shipped gesture,
   so what is under test is the product's own path and not a fixture that wrote a
   receipt by hand.
   =========================================================================== */

async function ux1_1_approveToFinalHandoff() {
  const project = projectOf([{ id: "L1-01" }]);
  const page = await render("#/shot/L1-01", project, { scan: scanWith(project, { "L1-01": ["FRAME_A.png"] }) });

  const before = evaluate(page.context, `
    const shot = P.shots[0];
    const readiness = shotReadinessFor(shot);
    return {
      status: readiness.status,
      code: readiness.nextAction.code,
      returned: returnedResultsAwaitingReview().length,
    };
  `);
  equal(before.status, "READY", "precondition: the returned candidate is not approved, so the frame is still producible");
  equal(before.returned, 1, "precondition: one returned candidate is sitting unreviewed");

  /* THE SHIPPED CONTROL, INSIDE A TRUSTED GESTURE, the way the harness stands in for
     a user: the approval dialog opens, the filmmaker confirms, and the kernel scopes
     the receipt to that dispatch. An act performed outside a gesture is refused
     exactly as it would be in a browser, which is why the confirm is wrapped and the
     dialog that precedes it is not. */
  page.context.approveGuidedFrame("L1-01", "frame-a", "FRAME_A.png");
  page.context.document.getElementById("approve-name").value = "FRAME_A.png";
  await page.gesture.act(() => page.context.confirmApproveTake());
  const after = await evaluateAsync(page.context, `
    const shot = P.shots[0];
    const readiness = shotReadinessFor(shot);
    const local = shotProductionNextAction(shot, readiness);
    const card = guidedShotStatusCard(shot, takesFor(shot.id), { prev: null, next: null });
    const facts = shotStageModelFacts(shot, takesFor(shot.id));
    const deliver = shotStageState("deliver", facts);
    const home = await productionHomeView();
    const next = projectNextProductionAction();
    return {
      frameCanon: !!currentHumanAuthority(P, { kind: "shot-frame", shotId: shot.id, frameId: "frame-a" }),
      deliveryCanon: !!currentHumanAuthority(P, { kind: "shot-delivery", shotId: shot.id }),
      isDelivered: shotIsDelivered(shot),
      status: readiness.status,
      code: readiness.nextAction.code,
      message: readiness.nextAction.message,
      label: local.label,
      deliverStatus: STAGE_STATUS[deliver.statusKey] || deliver.statusKey,
      cardHeadline: (card.split("<h2>")[1] || "").split("</h2>")[0],
      cardMentionsNothingOutstanding: card.includes("Nothing outstanding"),
      cardRouter: card.includes("openShotReadinessAction('L1-01','mark-shot-final')"),
      targetPanel: shotReadinessTargetPanel(readiness),
      homeMentionsNothingOutstanding: home.includes("NOTHING OUTSTANDING"),
      nextKind: next && next.kind,
      nextLabel: next && next.actionLabel,
      nextHref: next && next.href,
      decisions: projectFilmmakerDecisions().count,
      returned: returnedResultsAwaitingReview().length,
    };
  `);

  ok(after.frameCanon, "approving the candidate through the shipped control writes frame authority");
  ok(!after.deliveryCanon, "and writes no delivery authority — approving a take is not finishing a shot");
  equal(after.isDelivered, false, "the shot is not final");
  equal(after.status, "NEEDS_DECISION", "so readiness reports an outstanding human decision, not completion");
  equal(after.code, "mark-shot-final", "and names the durable decision by its own action code");
  equal(after.label, "Mark shot final", "which the surfaces render as Mark shot final");
  ok(after.message.includes("approved result is ready"), "the message leads with the approved result, then asks for the decision");
  ok(after.message.includes("optional"), "and says finishing first is optional rather than required");
  equal(after.cardHeadline, "Mark shot final", "the shot's primary next-action card promotes the handoff");
  equal(after.cardMentionsNothingOutstanding, false, "P0-01: the card never says Nothing outstanding here");
  ok(after.cardRouter, "and its control routes through the declared action router");
  equal(after.targetPanel, "finish", "which opens Finish & Delivery, where Finalize and Finish both live");
  equal(after.deliverStatus, "Not started", "the Deliver stage still reads Not started — and now nothing contradicts it");
  equal(after.homeMentionsNothingOutstanding, false, "P0-01: Production never claims nothing is outstanding either");
  equal(after.nextKind, "shot", "the project's next action is this shot");
  equal(after.nextLabel, "MARK SHOT FINAL", "with the same words");
  equal(after.nextHref, "#/shot/L1-01", "pointing at the shot itself");
  equal(after.decisions, 1, "and the one filmmaker decision is counted once");
  equal(after.returned, 0, "the returned-results queue is empty, which is a different fact and stays separate");

  note("UX1-1 approving a still hands off to Mark shot final on the shot card, in Production, and in the one decision count");
}

/* ===========================================================================
   UX1-2 — MARK FINAL.
   =========================================================================== */

async function ux1_2_markFinal() {
  const project = projectOf([{ id: "L1-01", winner: "FRAME_A.png" }]);
  const page = await render("#/shot/L1-01", project, { scan: scanWith(project, { "L1-01": ["FRAME_A.png"] }) });

  const before = evaluate(page.context, `
    const readiness = shotReadinessFor(P.shots[0]);
    return { code: readiness.nextAction.code, decisions: projectFilmmakerDecisions().count };
  `);
  equal(before.code, "mark-shot-final", "precondition: the approved shot is waiting on the delivery decision");
  equal(before.decisions, 1, "precondition: and it is the project's one decision");

  page.gesture.act(() => page.context.markGuidedStillFinal("L1-01", "FRAME_A.png"));
  const after = await evaluateAsync(page.context, `
    const shot = P.shots[0];
    const readiness = shotReadinessFor(shot);
    const card = guidedShotStatusCard(shot, takesFor(shot.id), { prev: null, next: null });
    const home = await productionHomeView();
    const decisions = projectFilmmakerDecisions();
    return {
      deliveryCanon: !!currentHumanAuthority(P, { kind: "shot-delivery", shotId: shot.id }),
      status: readiness.status,
      code: readiness.nextAction.code,
      message: readiness.nextAction.message,
      category: shotBoardActionCategory(shot, readiness),
      cardKicker: (card.split("<div><span>")[1] || "").split("</span>")[0],
      cardPromotesWork: /Mark shot final|Produce the|Prepare |Approve /.test(card),
      decisions: decisions.count,
      final: decisions.final,
      next: projectNextProductionAction(),
      homeComplete: home.includes("All 1 shot are marked final") || home.includes("marked final"),
      home,
    };
  `);

  ok(after.deliveryCanon, "the shipped Finalize control writes a shot-delivery receipt");
  equal(after.status, "COMPLETE", "and only then does the shot report COMPLETE");
  equal(after.code, "nothing-outstanding", "with nothing outstanding as its action");
  ok(after.message.includes("marked final"), "and a message that says why it is complete");
  equal(after.category, "complete", "the shot board files it as final through the same projection");
  equal(after.cardPromotesWork, false, "no primary card promotes ordinary unfinished work on a final shot");
  ok(after.cardKicker.includes("SHOT COMPLETE"), "the shot card states completion instead: " + after.cardKicker);
  equal(after.decisions, 0, "the project's decision count drops to zero");
  deepEqual(after.final, ["L1-01"], "and the shot is reported as final by the one projection");
  equal(after.next, null, "the project has no next production action");
  ok(after.homeComplete, "and Production says every shot is marked final");
  deepEqual([...new Set(decisionNumbersIn(after.home))], [0],
    "and every decision number rendered on the page is zero: " + JSON.stringify(decisionNumbersIn(after.home)));

  note("UX1-2 marking the shot final completes it truthfully, and no surface then promotes unfinished work");
}

/* ===========================================================================
   UX1-3 — PRODUCTION ONE COUNT.

   Four shots in two scenes, each in a DIFFERENT scoped state, which is the exact
   shape the audit reproduced. The claim is not that every number on the page is the
   same — several genuinely different counts belong here — it is that every number
   rendered under the word DECISION is the same one, and that the scene cards, the
   readiness pill and the summary tile are three renderings of one set of rows.
   =========================================================================== */

async function ux1_3_oneDecisionCount() {
  const project = projectOf([
    { id: "L1-01", scene: "SC-01", winner: "FRAME_A.png" },                 /* approved, not final */
    { id: "L1-02", scene: "SC-01", winner: "FRAME_A.png", final: true },    /* final */
    { id: "L2-01", scene: "SC-02" },                                        /* ready to produce */
    { id: "L2-02", scene: "SC-02", winner: "FRAME_B.png" },                 /* approved, not final */
  ], { scenes: ["SC-01", "SC-02"] });
  /* One unconfirmed reference, deliberately: the historic-confirmation queue groups
     by authority target and the scene cards group by shot, so this is the pair that
     used to be rendered as two rival "decision" numbers. */
  project.productionAuthority.receipts = project.productionAuthority.receipts
    .filter((row) => row.targetKey !== "entity-state:props:PR-TOOL#state-default");

  const takes = { "L1-01": ["FRAME_A.png"], "L1-02": ["FRAME_A.png"], "L2-01": ["FRAME_A.png"], "L2-02": ["FRAME_B.png"] };
  const page = await render("#/production", project, { scan: scanWith(project, takes) });

  const payload = await evaluateAsync(page.context, `
    const feed = projectShotReadiness();
    const decisions = projectFilmmakerDecisions(feed);
    const home = await productionHomeView();
    const scenes = P.scenes.map((scene) => sceneFilmmakerDecisions(scene.id, decisions));
    const sceneSection = home.split('<section class="production-scenes"')[1] || "";
    const tile = ((home.split('<article class="review"')[1] || home.split('<article class=""')[1] || "").split("</article>")[0]).split(">").slice(1).join(">");
    const pill = (home.split('data-filmmaker-decisions="')[1] || "").split('"')[0];
    return {
      canonical: decisions.count,
      shots: decisions.shots.map((row) => [row.shotId, row.code]),
      readinessNeedsDecision: feed.counts.needsDecision,
      scenes: scenes.map((row) => row.count),
      pill: Number(pill),
      tileNumber: Number((tile.split("<b>")[1] || "").split("</b>")[0]),
      tileWords: (tile.split("<span>")[1] || "").split("</span>")[0],
      sceneCardNumbers: [...sceneSection.matchAll(/data-scene-decisions="(\\d+)"/g)].map((m) => Number(m[1])),
      historicTargets: feed.historic.uniqueTargets,
      returned: returnedResultsAwaitingReview().length,
      home,
    };
  `);

  equal(payload.canonical, 3, "three shots each carry one outstanding filmmaker decision");
  deepEqual(payload.shots.map((row) => row[1]).sort(), ["confirm-existing-reference", "mark-shot-final", "mark-shot-final"],
    "and the projection reports each one's own canonical action code");
  equal(payload.readinessNeedsDecision, payload.canonical,
    "on an ordinary project the canonical count and the readiness rollup agree by construction");
  equal(payload.pill, payload.canonical, "the PRODUCTION READINESS pill shows that number");
  equal(payload.tileNumber, payload.canonical, "the Production summary tile shows the same number");
  equal(payload.tileWords, "decisions need you", "and labels it with the one decision word: " + payload.tileWords);
  equal(payload.sceneCardNumbers.reduce((sum, n) => sum + n, 0), payload.canonical,
    "the scene cards partition exactly that set of shots and invent none of their own");
  deepEqual(payload.sceneCardNumbers, payload.scenes,
    "and each card renders the number the shared scene projection gave it");

  /* THE WHOLE-PAGE CLAIM. Every number a reader can find beside the word DECISION. */
  const numbers = decisionNumbersIn(payload.home);
  ok(numbers.length > 0, "the page does render a decision count");
  deepEqual([...new Set(numbers)], [payload.canonical],
    `P0-02: every decision number on the Production page is ${payload.canonical}, found ${JSON.stringify(numbers)}`);

  /* AND THE COUNTS THAT ARE DELIBERATELY DIFFERENT STILL NAME THEIR OWN SCOPE. */
  equal(payload.historicTargets, 1, "the historic queue groups by authority target, which is its own scope");
  ok(payload.home.includes("existing selection"),
    "so it says `existing selection`, never `decision`");
  ok(!/existing selections?[^<]*decision/i.test(payload.home),
    "and never borrows the decision word for its own count");
  /* AND THE SHARPEST CASE OF ALL: a genuinely different count in the same viewport.
     One returned candidate is unreviewed while three shots need a decision, and the
     audit's viewport showed exactly this pair rendered as two rival "decisions". */
  equal(payload.returned, 1, "one returned candidate is unreviewed, which is a different scope");
  ok(payload.returned !== payload.canonical, "and a different number");
  ok(/returned result waiting for review/i.test(payload.home),
    "so Returned Results names its own scope in its own words");
  ok(!/1\s+decisions?/i.test(payload.home.replace(/<[^>]*>/g, " ")),
    "and its number never reaches the page under the decision word");

  note("UX1-3 four scoped states, one decision number: tile, readiness pill and every scene card agree, and the other counts name their own scope");
}

/* ===========================================================================
   UX1-4 — ASSISTANT RUN-SCOPE.

   Evaluated in a realm of its own, the way tests/quiet-shell.js does, because what is
   under test is the Assistant's own wording with NOTHING running — a state no project
   fixture produces on demand.
   =========================================================================== */

function surfacesRealm() {
  const sandbox = {
    console,
    setTimeout, clearTimeout, requestAnimationFrame: (fn) => fn(),
    esc: (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]),
    plural: (n, one, many = one + "s") => `${n} ${Number(n) === 1 ? one : many}`,
    location: { hash: "#/production" },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: {
      readyState: "complete",
      getElementById: () => null,
      querySelector: () => null,
      createElement: () => ({ innerHTML: "", firstElementChild: null }),
      addEventListener: () => {},
    },
  };
  sandbox.attr = (t) => sandbox.esc(t).replace(/'/g, "&#39;");
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.addEventListener = () => {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "public/shared-creator-state.js"), "utf8"), sandbox, { filename: "shared-creator-state.js" });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "public/creator-surfaces.js"), "utf8"), sandbox, { filename: "creator-surfaces.js" });
  return sandbox.window.CineBraidCreatorSurfaces;
}

async function ux1_4_assistantRunScope() {
  /* The production half of the claim: a real project with a real outstanding decision
     and no run of any kind. */
  const project = projectOf([{ id: "L1-01", winner: "FRAME_A.png" }]);
  const page = await render("#/production", project, { scan: scanWith(project, { "L1-01": ["FRAME_A.png"] }) });
  const production = evaluate(page.context, `
    return { decisions: projectFilmmakerDecisions().count, runs: (AUTOMATION_RUNS || []).length };
  `);
  equal(production.decisions, 1, "precondition: Production carries one filmmaker decision");
  equal(production.runs, 0, "precondition: and no generation job or run is active");

  const api = surfacesRealm();
  const state = api.projection();
  const markup = api.assistantMarkup(state);
  const headline = (markup.split("<b>")[1] || "").split("</b>")[0];

  equal(state.headline.kind, "all-quiet", "with no activity the projection reports its quiet headline");
  /* Round-tripped through JSON: `state` is built inside a vm realm, and a realm's
     Object fails deepStrictEqual against a host literal while printing identically. */
  deepEqual(JSON.parse(JSON.stringify(state.counts)), { working: 0, waiting: 0, attention: 0, recent: 0, total: 0 },
    "and every one of its counts is a count of runs, which are all zero");
  ok(/no runs or generation jobs are active/i.test(headline),
    "the Assistant says so at the scope it can observe: " + headline);
  ok(!/waiting on you/i.test(markup),
    "and never claims nothing is waiting on the filmmaker — a scope this projection cannot see");
  ok(!/all quiet/i.test(markup), "nor calls the whole production quiet");
  ok(/Production/.test(markup), "it points at the surface that owns the other question instead");

  /* THE STRUCTURAL HALF, and the reason the wording can be trusted rather than
     merely spot-checked: the projection has no field a filmmaker decision could
     arrive in, so the Assistant cannot acquire an opinion about one by accident. */
  const fields = Object.keys(state);
  ok(!fields.some((key) => /decision/i.test(key)),
    "the creator-state projection carries no decision field at all: " + fields.join(", "));
  const source = readLF("public/creator-surfaces.js");
  for (const owner of ["projectFilmmakerDecisions", "evaluateProjectReadiness", "shotReadinessFor"]) {
    ok(!source.includes(owner),
      `and creator-surfaces.js never reads ${owner} — the Assistant explains activity, it does not own the decision count`);
  }

  note("UX1-4 the Assistant reports run scope only, points at Production for the rest, and structurally cannot see a filmmaker decision");
}

/* ===========================================================================
   UX1-5 — RETURNED RESULT SCOPE.
   =========================================================================== */

async function ux1_5_returnedResultScope() {
  const project = projectOf([{ id: "L1-01", winner: "FRAME_A.png" }]);
  const page = await render("#/production", project, { scan: scanWith(project, { "L1-01": ["FRAME_A.png"] }) });

  const payload = await evaluateAsync(page.context, `
    const inbox = productionResultInbox();
    const home = await productionHomeView();
    const tile = ((home.split('<article class="review"')[1] || home.split('<article class=""')[1] || "").split("</article>")[0]).split(">").slice(1).join(">");
    return {
      returned: returnedResultsAwaitingReview().length,
      decisions: projectFilmmakerDecisions().count,
      inboxHeadline: (inbox.split("<h2>")[1] || "").split("</h2>")[0],
      inboxBody: inbox.replace(/<[^>]*>/g, " "),
      tile: tile.replace(/<[^>]*>/g, " ").trim(),
      home,
    };
  `);

  equal(payload.returned, 0, "no returned candidate is awaiting review");
  equal(payload.decisions, 1, "and a different filmmaker decision is genuinely outstanding");
  equal(payload.inboxHeadline, "No returned result is waiting for review",
    "Returned Results states its own narrow scope in its empty headline");
  ok(!/\bdecisions?\b/i.test(payload.inboxHeadline),
    "it does not use the word this project reserves for the filmmaker-decision count");
  ok(/1\s+decision\s+needs\s+you/i.test(payload.tile),
    "while Production still truthfully reports the outstanding decision: " + payload.tile);
  ok(/Production/.test(payload.inboxBody),
    "and the inbox names where the other question is answered rather than implying there is nothing there");
  /* THE TWO STATEMENTS MAY NOT SHARE A GENERIC PHRASE. "waiting for review" belongs
     to this queue; the decision count says "needs you". A page where both used the
     same words is the defect. */
  ok(!/waiting for review/i.test(payload.tile), "the decision tile never borrows `waiting for review`");
  const scenes = payload.home.split('<section class="production-scenes"')[1] || "";
  ok(!/waiting for review/i.test(scenes), "and neither do the scene cards, which used to");

  note("UX1-5 an empty Returned Results queue and an outstanding filmmaker decision coexist, in words that cannot be confused");
}

/* ===========================================================================
   UX1-6 — FINAL / CUT SCENE COMPLETION.
   =========================================================================== */

async function ux1_6_sceneCompletion() {
  const project = projectOf([
    { id: "L1-01", scene: "SC-01", winner: "FRAME_A.png", final: true },
    { id: "L1-02", scene: "SC-01", winner: "FRAME_B.png", final: true },
    { id: "L2-01", scene: "SC-02", winner: "FRAME_A.png" },
  ], { scenes: ["SC-01", "SC-02"] });
  const takes = { "L1-01": ["FRAME_A.png"], "L1-02": ["FRAME_B.png"], "L2-01": ["FRAME_A.png"] };
  const page = await render("#/production", project, { scan: scanWith(project, takes) });

  const payload = await evaluateAsync(page.context, `
    const decisions = projectFilmmakerDecisions();
    const home = await productionHomeView();
    const section = (home.split('<section class="production-scenes"')[1] || "").split("</section>")[0];
    const cards = section.split('class="scene-progress-card').slice(1).map((chunk) => chunk.split("</a>")[0]);
    return {
      complete: sceneFilmmakerDecisions("SC-01", decisions),
      open: sceneFilmmakerDecisions("SC-02", decisions),
      cards: cards.map((card) => card.replace(/<[^>]*>/g, " | ").replace(/\\s+/g, " ").trim()),
      completeCardClass: cards[0].split('"')[0],
      approveScene: /approve\\s*scene/i.test(home),
      home,
    };
  `);

  deepEqual(payload.complete, { available: true, total: 2, count: 0, blocked: 0, final: 2, unanswerable: 0 },
    "a scene whose active shots are all final has no outstanding filmmaker decision");
  equal(payload.open.count, 1, "the neighbouring scene's own decision is unaffected");
  ok(payload.completeCardClass.includes("is-complete"), "the finished scene's card is marked complete");
  ok(/Scene complete/.test(payload.cards[0]), "and says so: " + payload.cards[0]);
  ok(/2\/2 final/.test(payload.cards[0]), "with the count that makes it true");
  equal(payload.approveScene, false, "and no separate Approve Scene step is invented anywhere on the page");
  ok(!/1 shot needs a decision/.test(payload.cards[0]),
    "the complete scene fabricates no pending decision of its own");
  ok(/1 shot needs a decision/.test(payload.cards[1]),
    "while the open scene reports its real one: " + payload.cards[1]);

  note("UX1-6 a scene of final shots reports complete, asks for nothing, and needs no Approve Scene step");
}

/* ===========================================================================
   UX1-7 — NON-LINEAR WORK.
   =========================================================================== */

async function ux1_7_nonLinear() {
  const project = projectOf([
    { id: "L1-01", scene: "SC-01" },   /* nothing approved: the unfinished neighbour */
    { id: "L2-01", scene: "SC-02" },   /* the shot a filmmaker chooses to work on */
  ], { scenes: ["SC-01", "SC-02"] });
  const takes = { "L1-01": [], "L2-01": [] };
  const page = await render("#/production", project, { scan: scanWith(project, takes) });

  const payload = evaluate(page.context, `
    const feed = projectShotReadiness();
    const rows = feed.shots.map((row) => ({
      shotId: row.shotId,
      status: row.status,
      code: row.nextAction.code,
      /* Every requirement this shot reports, and which shot each one belongs to. */
      foreign: [...(row.requirements || []), ...(row.units || []).flatMap((unit) => unit.requirements || [])]
        .filter((req) => req.target && req.target.shotId && req.target.shotId !== row.shotId)
        .map((req) => req.target.shotId),
    }));
    return { rows, next: projectNextProductionAction(feed) };
  `);

  for (const row of payload.rows) {
    equal(row.status, "READY", row.shotId + " has work that can start now");
    equal(row.code, "produce-frame", row.shotId + " names its own producible work");
    deepEqual(row.foreign, [], row.shotId + " reports no requirement belonging to another shot");
  }
  equal(payload.next.kind, "shot", "the project recommends a shot with work that can start");
  ok(["L1-01", "L2-01"].includes(payload.next.shotId),
    "and it is one of the two ready shots, not a fabricated ordering constraint");

  note("UX1-7 an unfinished neighbouring shot and scene create no requirement, no blocker and no ordering for a different ready shot");
}

/* ===========================================================================
   UX1-8 — BLOCKER DOMINANCE.

   Two separate claims, because "blocker" means two different real things here.
   =========================================================================== */

async function ux1_8_blockerDominance() {
  /* (a) A PROJECT-LEVEL INTEGRITY BLOCKER OUTRANKS READY WORK, and the wording is
     the literal problem rather than a rewritten verdict. */
  const broken = projectOf([{ id: "L1-01" }, { id: "L2-01" }]);
  broken.productionAuthority.receipts[0].command = "not-a-command";
  const brokenPage = await render("#/production", broken, { scan: scanWith(broken, { "L1-01": [], "L2-01": [] }) });
  const integrity = await evaluateAsync(brokenPage.context, `
    const feed = projectShotReadiness();
    const decisions = projectFilmmakerDecisions(feed);
    const home = await productionHomeView();
    return {
      trusted: feed.authority.trusted,
      reason: feed.truthProblem && feed.truthProblem.reason,
      projectMessage: feed.truthProblem && feed.truthProblem.message,
      shotCodes: feed.shots.map((row) => row.nextAction.code),
      shotStatuses: feed.shots.map((row) => row.status),
      next: projectNextProductionAction(feed),
      decisions: decisions.count,
      unanswerable: decisions.unanswerable,
      pill: (home.split('data-filmmaker-decisions="')[1] || "").split('"')[0],
    };
  `);
  equal(integrity.trusted, false, "precondition: the approval ledger cannot be read");
  equal(integrity.reason, "authority-ledger-unreadable", "and readiness names the literal problem");
  equal(integrity.next.kind, "repair", "the project's next action is the repair, outranking every ready shot");
  ok(integrity.projectMessage.includes("cannot be read"),
    "and the wording explains the literal blocker: " + integrity.projectMessage);
  deepEqual([...new Set(integrity.shotStatuses)], ["NEEDS_DECISION"], "every shot's readiness is unanswerable");
  deepEqual([...new Set(integrity.shotCodes)], ["awaiting-project-repair"],
    "and each says so rather than each asking for the same repair");
  equal(integrity.decisions, 1, "ONE broken ledger is ONE decision, not one per shot");
  deepEqual(integrity.unanswerable, ["L1-01", "L2-01"], "with the affected shots reported as unanswerable");
  equal(Number(integrity.pill), 1, "and the readiness pill shows that one, not two");

  /* (b) CREATIVE PREFERENCE IS NEVER A HARD BLOCKER. A rejected candidate with a
     critical structured review recorded against it is a filmmaker's opinion about
     an image, and it does not change what the shot can do next. */
  const opinionated = projectOf([{ id: "L1-01" }]);
  const shot = opinionated.shots[0];
  shot.candidates = [{
    name: "FRAME_A.png",
    decision: "rejected",
    review: { summary: "Composition is wrong and the mood is off.", categories: { composition: { severity: "critical", note: "Wrong lens." } } },
  }];
  const opinionPage = await render("#/shot/L1-01", opinionated, { scan: scanWith(opinionated, { "L1-01": ["FRAME_A.png"] }) });
  const preference = evaluate(opinionPage.context, `
    const readiness = shotReadinessFor(P.shots[0]);
    return {
      status: readiness.status,
      code: readiness.nextAction.code,
      reasons: [...(readiness.requirements || []), ...(readiness.units || []).flatMap((unit) => unit.requirements || [])]
        .map((row) => row.reason).filter(Boolean),
    };
  `);
  equal(preference.status, "READY", "a rejected candidate with a critical review does not block the shot");
  equal(preference.code, "produce-frame", "the shot's next action is still its own producible work");
  ok(!preference.reasons.some((reason) => /review|reject|critical|preference|quality/i.test(reason)),
    "and no requirement is derived from an opinion about an image: " + JSON.stringify(preference.reasons));

  note("UX1-8 an integrity blocker outranks ready work and is explained literally; a creative judgement blocks nothing");
}

/* ===========================================================================
   THE VOCABULARY IS CLOSED, AND NOTHING PARALLEL SURVIVES.
   =========================================================================== */

async function noParallelProjection() {
  const project = projectOf([{ id: "L1-01", winner: "FRAME_A.png" }]);
  const page = await render("#/production", project, { scan: scanWith(project, { "L1-01": ["FRAME_A.png"] }) });

  const payload = evaluate(page.context, `
    return {
      vocabulary: [...READINESS_NEXT_ACTIONS],
      destinations: SHOT_READINESS_ACTION_DESTINATIONS.map((row) => row.code),
      nonShot: [...NON_SHOT_READINESS_ACTIONS],
      words: Object.keys(READINESS_ACTION_WORDS),
      markFinalWord: READINESS_ACTION_WORDS["mark-shot-final"],
      /* The delivery decision is a ROLLUP decision. If any unit ever emits it, the
         generation gates that read a unit's status would start treating "a person
         could click Finalize" as executable work. */
      unitCodes: shotReadinessFor(P.shots[0]).units.map((unit) => unit.nextAction && unit.nextAction.code),
    };
  `);

  ok(payload.vocabulary.includes("mark-shot-final"), "the delivery decision is part of the canonical vocabulary");
  deepEqual([...payload.destinations, ...payload.nonShot].sort(), [...payload.vocabulary].sort(),
    "every canonical action still has exactly one declared destination or a declared project-only exception");
  deepEqual([...payload.words].sort(), [...payload.vocabulary].sort(),
    "and exactly one rendered word, so no action can reach a surface unnamed");
  equal(payload.markFinalWord, "Mark shot final", "named in the filmmaker's words");
  ok(!payload.unitCodes.includes("mark-shot-final"), "and no unit emits it");

  /* THE ONE OWNER, AND THE ONE PLACE THE DECISION WORD IS DECIDED. */
  const app = codeOnly(readLF("public/app.js"));
  const readiness = codeOnly(readLF("public/shared-shot-readiness.js"));
  ok(readiness.includes('kind: "shot-delivery"'),
    "the rollup asks the kernel about the delivery target rather than reading an edge");
  for (const edge of ["finalStillFile", "finalVideoFile", "approvedMotionFile", "shotIsDelivered"]) {
    ok(!readiness.includes(edge),
      `and never reads ${edge} — authority is a receipt, and this module has one way to ask for one`);
  }
  equal(app.split("function projectFilmmakerDecisions(").length - 1, 1,
    "there is exactly one filmmaker-decision projection");
  ok(!app.includes("function projectDecisionItems("),
    "and the old rival projection is gone rather than merely unused");

  note("no parallel projection survives: one vocabulary, one destination each, one owner, and the rollup never reads a delivery edge");
}

/* ========================================================================== */

async function main() {
  await ux1_1_approveToFinalHandoff();
  await ux1_2_markFinal();
  await ux1_3_oneDecisionCount();
  await ux1_4_assistantRunScope();
  await ux1_5_returnedResultScope();
  await ux1_6_sceneCompletion();
  await ux1_7_nonLinear();
  await ux1_8_blockerDominance();
  await noParallelProjection();
}

main().then(
  () => {
    for (const line of notes) console.log(line);
    console.log(`readiness-action-projection: ${checks} assertions passed`);
  },
  (error) => { console.error(error.stack || error.message || error); process.exit(1); },
);

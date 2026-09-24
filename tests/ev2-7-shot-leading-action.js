/* CineBraid EV2-7 Checkpoint 2 — ONE LEADING ACTION ON THE SHOT BOARD AND THE SHOT DESK.
 *
 * THE DEFECT. The Board card printed canonical readiness ("Produce the frame") while the
 * shot it opened led with "Review this returned result" for the same facts, because only
 * the Desk hero applied the returned-review precedence. shotLeadingAction() is that
 * precedence, moved so both surfaces read it.
 *
 * WHAT THIS SUITE HOLDS, read off rendered markup wherever a surface is the claim:
 *   (a) a returned candidate leads on BOTH surfaces with the same exact key, while the
 *       canonical readiness code stays readable on the card;
 *   (b) an unreadable approval ledger keeps readiness on both;
 *   (c) unavailable media displaces only a move-on action, on both;
 *   (d) a stale route claim is the Desk's alone — a Board card is never stale;
 *   (e) painting either surface writes no stage selection, no storage and no project edit;
 *   (f) the board filters count readiness, and a shot led by a returned review as a
 *       decision — the Production tile's number, never a second one;
 *   (g) a supplied projection is the default projection, and is actually used;
 *   (h) the Results handoff names the exact key and never writes selectedCandidate.
 *   (j) Production's two shot lists name the same leading action: "Shots and their next
 *       action" in the Board card's words, and Production readiness leading with it while
 *       keeping the canonical readiness verdict on the same row;
 *   (k) approving the returned Frame A of an Animate-from-first-frame shot moves every
 *       surface together — lists, count, filters, hero — and the stage strip opens where
 *       the next action is done: Frames while the result waits, Motion once it is approved;
 *   (l) Motion is labelled required exactly where readiness owes it, and a stored stage
 *       still wins over any recommendation;
 *   (m) opening the Motion stage, and the Frames -> Motion hand-off, store no motion unit
 *       and keep the shot's duration; a unit made by an explicit edit starts from it.
 * In-memory negative controls prove the suite goes red when those guarantees break.
 *
 * NO PROJECT DATA IS TOUCHED. NO SERVER IS STARTED. NO PROVIDER OR PAID CALL IS MADE.
 */
"use strict";
const assert = require("assert");
const vm = require("vm");
const path = require("path");
const { render, rawFixture, withCanon } = require("./render-harness");
/* The persistent bar's action contract is pure and not part of the harness realm, so the
   actions for a stage state the realm returned are derived by the shipped module here. */
const StageActions = require(path.join(__dirname, "..", "public", "shared-stage-actions.js"));

let checks = 0;
const equal = (a, b, m) => { checks += 1; assert.strictEqual(a, b, m); };
const deepEqual = (a, b, m) => { checks += 1; assert.deepStrictEqual(a, b, m); };
const ok = (v, m) => { checks += 1; assert(v, m); };
const evaluate = (context, body) => JSON.parse(vm.runInContext(`JSON.stringify((() => { ${body} })())`, context));

/* ---------------------------------------------------------------- fixtures
   The shipped shapes, as tests/returned-media-ownership.js builds them: every cast
   reference approved through withCanon() unless a case is ABOUT an unconfirmed one. */
const CAST_CANON = [
  { kind: "entity-state", list: "characters", entityId: "KAI", stateId: "state-default", value: "KAI-ANCHOR.png" },
  { kind: "entity-state", list: "locations", entityId: "LOC-HULL", stateId: "state-default", value: "LOC-HULL-PLATE.png" },
  { kind: "entity-state", list: "props", entityId: "PR-TOOL", stateId: "state-default", value: "PR-TOOL-PLATE.png" },
];
const WITHOUT_KAI = CAST_CANON.filter((row) => row.entityId !== "KAI");
function projectOf(shots, { canon = CAST_CANON } = {}) {
  const project = rawFixture();
  const template = project.shots[0];
  project.shots = shots.map((spec) => ({
    ...JSON.parse(JSON.stringify(template)),
    id: spec.id,
    title: spec.title || `Shot ${spec.id}`,
    keyframes: (spec.frames || [{ id: "frame-a", label: "A" }]).map((frame) => ({
      id: frame.id, label: frame.label, title: `Frame ${frame.label}`, winner: frame.winner || "",
      description: "Worker at panel.", required: true, generationPackages: [],
    })),
    clips: spec.clips || [],
    candidateFiles: spec.candidates || [],
    creationBrief: { deliveryIntent: "still", ...(spec.creationBrief || {}) },
    promptBuilds: [],
    promptOptions: [],
  }));
  const frameCanon = [];
  for (const spec of shots)
    for (const frame of spec.frames || [])
      if (frame.winner) frameCanon.push({ kind: "shot-frame", shotId: spec.id, frameId: frame.id, value: frame.winner });
  return withCanon(project, [...canon, ...frameCanon]);
}
function scanWith(project, takesByShot) {
  const approved = (list, dir) => (project[list] || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/${dir}/${x.approvedFile}` }));
  return {
    anchors: approved("characters", "anchors"), plates: approved("locations", "plates"), props: approved("props", "props"),
    vehicles: [], audio: [], media: [],
    shots: Object.fromEntries((project.shots || []).map((shot) => [shot.id, {
      takes: (takesByShot[shot.id] || []).map((name) => ({ name, url: `/assets/shots/${shot.id}/takes/${name}` })),
      locked: [],
    }])),
  };
}
const candidate = (name, extra = {}) => ({
  stored: name, original: name, notes: "", labels: [],
  addedAt: extra.addedAt || "2026-08-20T10:00:00.000Z",
  decision: extra.decision || "unreviewed",
  frameId: extra.frameId === undefined ? "frame-a" : extra.frameId,
  generationJobId: `job-${name}`, generationProvider: "fal", generationModel: "gpt-image-2",
});
const keyOf = (shotId, name) => `path:shots/${shotId}/takes/${name}`;
const MOTION_CLIP = { id: "motion-a", label: "A", suffix: "a", title: "Panel check", kind: "i2v", fromFrame: "frame-a", toFrame: "", dur: 5, motionPrompt: "He checks the panel.", generationPackages: [] };

/* ---------------------------------------------------------------- readers */
const mainHtml = (page) => page.context.document.getElementById("main").innerHTML;
/* EV2-7 B2.6 made the card one link whose next-action line is a descriptive span with its
   reason beside it, instead of a chip and a <small>; the same attributes are read off it. */
function boardCards(html) {
  return Object.fromEntries(html.split('<article class="slate').slice(1).map((chunk) => {
    const card = chunk.split("</article>")[0];
    const chip = card.match(/<span class="slate-next ([^"]*)"([^>]*)>([^<]*)<\/span>\s*<span class="slate-reason"[^>]*>([^<]*)<\/span>/) || [];
    const data = (name) => ((chip[2] || "").match(new RegExp(`${name}="([^"]*)"`)) || [])[1];
    const id = (card.match(/href="#\/shot\/([^"]+)"/) || [])[1];
    return [id, { cls: chip[1] || "", source: data("data-leading-source"), key: data("data-leading-key"), readinessCode: data("data-readiness-code"), label: chip[3], detail: chip[4] }];
  }));
}
function heroOf(html) {
  const markup = (html.match(/<section class="guided-next-action[\s\S]*?<\/section>/) || [""])[0];
  const attribute = (name) => (markup.match(new RegExp(`${name}="([^"]*)"`)) || [])[1] || "";
  return {
    markup,
    review: attribute("data-returned-review") === "1",
    key: attribute("data-returned-review-key"),
    stale: attribute("data-returned-review-stale") === "1",
    unavailable: attribute("data-returned-review-unavailable") === "1",
    blocked: attribute("data-returned-review-blocked"),
    headline: (markup.match(/<h2>([^<]*)<\/h2>/) || [])[1] || "",
  };
}
async function surfaces(project, takes, options = {}) {
  const scan = scanWith(project, takes);
  const storage = { "cinebraid-shot-action-filter": "all", ...(options.storage || {}) };
  const board = await render("#/shots/board", project, { scan, storage, mutateSource: options.mutate });
  const desk = await render(options.deskHash || "#/shot/L1-01", project, { scan, storage, mutateSource: options.mutate });
  return { board, desk, cards: boardCards(mainHtml(board)), hero: heroOf(mainHtml(desk)) };
}
const readinessIn = (page, shotId) => evaluate(page.context, `
  const shot = shotById(${JSON.stringify(shotId)});
  const row = shotReadinessFor(shot);
  const words = shotProductionNextAction(shot, row);
  return { status: row ? row.status : "", code: row ? row.nextAction.code : "", label: words.label, detail: words.detail };`);

/* ---------------------------------------------------------------- (a) */
async function caseA(options = {}) {
  const project = projectOf([
    { id: "L1-01", candidates: [candidate("FRAME_A.png")] },
    { id: "L1-02" },
  ]);
  const { board, desk, cards, hero } = await surfaces(project, { "L1-01": ["FRAME_A.png"] }, options);
  const readiness = readinessIn(board, "L1-01");
  equal(readiness.code, "produce-frame", "(a) precondition: canonical readiness would produce another frame");
  ok(hero.review, "(a) the Desk hero leads with the returned result");
  equal(cards["L1-01"].source, "returned-review", "(a) the Board card leads with the same returned result");
  equal(cards["L1-01"].key, hero.key, "(a) Board and Desk name the SAME candidate key");
  equal(cards["L1-01"].key, keyOf("L1-01", "FRAME_A.png"), "(a) and it is the exact returned file");
  equal(cards["L1-01"].label, "Review Frame A result", "(a) the Board card says review, not the readiness words");
  ok(cards["L1-01"].label !== readiness.label, "(a) the card no longer says " + readiness.label);
  equal(cards["L1-01"].detail, "A returned Frame A result is waiting for your decision.", "(a) with one plain reason: the identity travels as the key, not as a filename");
  equal(cards["L1-01"].readinessCode, "produce-frame", "(a) the canonical readiness code stays readable on the card");
  const sameRealm = evaluate(board.context, `
    const shot = shotById("L1-01");
    const card = guidedShotStatusCard(shot, takesFor(shot.id), { prev: null, next: null });
    return { key: (card.match(/data-returned-review-key="([^"]*)"/) || [])[1] || "", leading: shotLeadingAction(shot, shotReadinessFor(shot)) };`);
  equal(sameRealm.key, cards["L1-01"].key, "(a) the hero painted in the Board's own realm agrees with its card");
  deepEqual(sameRealm.leading.scope, { shotId: "L1-01", kind: "frame", frameId: "frame-a" }, "(a) the leading scope is the exact Results scope");
  const quiet = readinessIn(board, "L1-02");
  equal(cards["L1-02"].source, "readiness", "(a) a shot with nothing returned keeps readiness");
  equal(cards["L1-02"].label, quiet.label, "(a) in its canonical words");
  equal(cards["L1-02"].detail, quiet.detail, "(a) with its canonical explanation");
  ok(cards["L1-02"].cls.includes(`next-${quiet.code}`), "(a) and its canonical class");

  const confirm = projectOf([{ id: "L1-01", candidates: [candidate("FRAME_A.png")] }], { canon: WITHOUT_KAI });
  const second = await surfaces(confirm, { "L1-01": ["FRAME_A.png"] }, options);
  equal(second.cards["L1-01"].readinessCode, "confirm-existing-reference", "(a) precondition: a reference confirmation is outstanding");
  equal(second.cards["L1-01"].source, "returned-review", "(a) the returned result still leads the card");
  equal(second.cards["L1-01"].key, second.hero.key, "(a) and still agrees with the Desk");

  const motion = projectOf([{ id: "L1-01", frames: [{ id: "frame-a", label: "A", winner: "FRAME_A.png" }], clips: [MOTION_CLIP],
    candidates: [candidate("FRAME_A.png"), candidate("SHOT_MOTION_1.mp4", { frameId: "", addedAt: "2026-08-20T12:00:00.000Z" })] }]);
  const third = await surfaces(motion, { "L1-01": ["FRAME_A.png", "SHOT_MOTION_1.mp4"] }, options);
  equal(third.cards["L1-01"].label, "Review motion result", "(a) returned motion is named as motion on the Board");
  equal(third.cards["L1-01"].key, third.hero.key, "(a) with the Desk's exact motion key");
  return { board, desk };
}

/* ---------------------------------------------------------------- (b) */
async function caseB() {
  const project = projectOf([{ id: "L1-01", candidates: [candidate("FRAME_A.png")] }]);
  project.productionAuthority.receipts[0].command = "not-a-command";
  const { board, cards, hero } = await surfaces(project, { "L1-01": ["FRAME_A.png"] });
  const seen = evaluate(board.context, `return { awaiting: returnedReviewProjectionForBrowser().counts.awaiting };`);
  equal(seen.awaiting, 1, "(b) precondition: a returned candidate is waiting");
  equal(cards["L1-01"].readinessCode, "awaiting-project-repair", "(b) precondition: the ledger cannot be read");
  equal(cards["L1-01"].source, "readiness", "(b) the Board keeps the repair");
  equal(cards["L1-01"].label, "Await project repair", "(b) in canonical words");
  ok(!hero.review, "(b) the Desk keeps the repair too");
  ok(/Await project repair/.test(hero.markup), "(b) in the same words");
}

/* ---------------------------------------------------------------- (c) */
async function caseC() {
  const gone = projectOf([{ id: "L1-01", candidates: [candidate("GONE.png")] }]);
  const first = await surfaces(gone, { "L1-01": [] });
  equal(first.cards["L1-01"].readinessCode, "produce-frame", "(c) precondition: readiness would move on");
  equal(first.cards["L1-01"].source, "returned-unavailable", "(c) the Board refuses the move-on action");
  equal(first.cards["L1-01"].label, "Returned result missing", "(c) and says why");
  ok(first.hero.unavailable, "(c) the Desk shows the same integrity state");

  const work = projectOf([{ id: "L1-01", candidates: [candidate("GONE.png")] }], { canon: WITHOUT_KAI });
  const second = await surfaces(work, { "L1-01": [] });
  equal(second.cards["L1-01"].source, "readiness", "(c) real outstanding work keeps the Board card");
  equal(second.cards["L1-01"].label, "Confirm existing reference", "(c) in canonical words");
  ok(!second.hero.unavailable && /Confirm existing reference/.test(second.hero.headline), "(c) and keeps the Desk card");
  equal(second.hero.blocked, "1", "(c) where the integrity note is still stated");
  const leading = evaluate(second.board.context, `const s = shotById("L1-01"); return shotLeadingAction(s, shotReadinessFor(s), { claim: "" });`);
  equal(leading.review && leading.review.kind, "unavailable", "(c) the helper still hands the unavailable answer to the caller");
}

/* ---------------------------------------------------------------- (d) */
async function caseD() {
  const project = projectOf([{ id: "L1-01", frames: [{ id: "frame-a", label: "A" }, { id: "frame-b", label: "B" }],
    candidates: [candidate("A.png", { decision: "rejected" }), candidate("B.png", { frameId: "frame-b", addedAt: "2026-08-20T10:05:00.000Z" })] }]);
  const stale = `#/shot/L1-01/review/${encodeURIComponent(keyOf("L1-01", "A.png"))}`;
  const { board, cards, hero } = await surfaces(project, { "L1-01": ["A.png", "B.png"] }, { deskHash: stale });
  ok(hero.stale, "(d) precondition: the Desk says the claimed result was already reviewed");
  equal(cards["L1-01"].source, "returned-review", "(d) the Board card is never stale");
  equal(cards["L1-01"].key, keyOf("L1-01", "B.png"), "(d) it names what is actually waiting");
  const sources = evaluate(board.context, `
    const s = shotById("L1-01"), r = shotReadinessFor(s);
    return { none: shotLeadingAction(s, r, { claim: "" }).source, claimed: shotLeadingAction(s, r, { claim: ${JSON.stringify(keyOf("L1-01", "A.png"))} }).source };`);
  deepEqual(sources, { none: "returned-review", claimed: "returned-stale" }, "(d) only an explicit route claim can make the answer stale");
}

/* ---------------------------------------------------------------- (e) */
async function caseE(options = {}) {
  const STAGE_KEY = "cinebraid-focused:fixture:shot-task:L1-01";
  const project = projectOf([{ id: "L1-01", candidates: [candidate("FRAME_A.png")] }]);
  const { board, desk, hero } = await surfaces(project, { "L1-01": ["FRAME_A.png"] }, { ...options, storage: { [STAGE_KEY]: "inputs" } });
  ok(hero.review, "(e) precondition: the leading action belongs to Frames");
  ok(mainHtml(desk).includes('data-selected-task="inputs"'), "(e) the Desk still opens the stage the filmmaker chose");
  equal(desk.context.localStorage.getItem(STAGE_KEY), "inputs", "(e) and its stored stage is unchanged");
  for (const page of [board, desk]) {
    const writes = [];
    const setItem = page.context.localStorage.setItem;
    page.context.localStorage.setItem = (key, value) => { writes.push(String(key)); return setItem(key, value); };
    /* The selected stage is read FIRST: shotStageModelFacts() normalises creationBrief in
       memory on a record that has never been painted (dirty stays 0). That is shipped
       behaviour of the stage model, not of the leading action, so the snapshot follows it. */
    const seen = evaluate(page.context, `
      const s = shotById("L1-01"), stage = boundedShotSelectedTask(s, takesFor(s.id)), before = JSON.stringify(P), revision = SAVE_REVISION;
      const projection = returnedReviewProjectionForBrowser();
      for (let i = 0; i < 3; i++) {
        productionView("board");
        slate(s, "", shotReadinessFor(s), projection);
        guidedShotStatusCard(s, takesFor(s.id), { prev: null, next: null });
        shotLeadingAction(s, shotReadinessFor(s), { claim: "", projection });
        shotResultsHandoff(s, "frame", "frame-a", projection);
      }
      return { same: JSON.stringify(P) === before, revision: SAVE_REVISION - revision, stage, stageAfter: boundedShotSelectedTask(s, takesFor(s.id)) };`);
    page.context.localStorage.setItem = setItem;
    ok(seen.same, "(e) painting Board and Desk leaves the project record byte-identical");
    equal(seen.revision, 0, "(e) and marks nothing dirty");
    equal(seen.stageAfter, seen.stage, "(e) and the selected stage is the one it was");
    deepEqual(writes.filter((key) => key.startsWith("cinebraid-focused:")), [], "(e) and no stage selection is written");
    equal(page.context.localStorage.getItem(STAGE_KEY), "inputs", "(e) the stored stage survives every paint");
  }
}

/* ---------------------------------------------------------------- (f) */
async function caseF() {
  const withReturned = projectOf([{ id: "L1-01", candidates: [candidate("FRAME_A.png")] }, { id: "L1-02" }]);
  const without = projectOf([{ id: "L1-01" }, { id: "L1-02" }]);
  const COUNT = `
    const feed = projectShotReadiness(), previous = FILTER.action, counts = {};
    for (const id of ["unfinished", "review", "missing-inputs", "ready", "complete", "all"]) {
      FILTER.action = id;
      counts[id] = P.shots.filter((shot) => shotBoardActionMatches(shot, feed)).length;
    }
    const markup = shotBoardActionFilters(feed);
    FILTER.action = previous;
    return { counts, markup };`;
  const a = await surfaces(withReturned, { "L1-01": ["FRAME_A.png"] });
  const b = await render("#/shots/board", without, { scan: scanWith(without, {}), storage: { "cinebraid-shot-action-filter": "all" } });
  equal(a.cards["L1-01"].source, "returned-review", "(f) precondition: a card leads with a returned review");
  const seenA = evaluate(a.board.context, COUNT), seenB = evaluate(b.context, COUNT);
  /* UX1-12: the shot waiting on a review moves from Ready to Needs a decision, which is
     exactly the Production tile's count. Nothing else moves. */
  equal(seenB.counts.review, 0, "(f) precondition: without the candidate nothing needs a decision");
  equal(seenA.counts.review, 1, "(f) 'Needs a decision' counts the shot whose returned result is waiting");
  equal(seenA.counts.ready, seenB.counts.ready - 1, "(f) and takes it out of Ready, so the shot is counted once");
  for (const id of ["unfinished", "missing-inputs", "complete", "all"])
    equal(seenA.counts[id], seenB.counts[id], `(f) and changes no other filter: ${id}`);
  const tile = evaluate(a.board.context, "return projectFilmmakerDecisions().count;");
  equal(seenA.counts.review, tile, "(f) the board and the Production tile report one number");
}

/* ---------------------------------------------------------------- (g) */
async function caseG(options = {}) {
  const project = projectOf([{ id: "L1-01", candidates: [candidate("FRAME_A.png")] }]);
  const board = await render("#/shots/board", project, { scan: scanWith(project, { "L1-01": ["FRAME_A.png"] }), mutateSource: options.mutate });
  const seen = evaluate(board.context, `
    const s = shotById("L1-01"), r = shotReadinessFor(s);
    const supplied = returnedReviewProjectionForBrowser();
    const empty = { ...supplied, queue: [], items: [], blockers: [] };
    return {
      review: JSON.stringify(shotReturnedReview(s, "", supplied)) === JSON.stringify(shotReturnedReview(s, "")),
      leading: JSON.stringify(shotLeadingAction(s, r, { claim: "", projection: supplied })) === JSON.stringify(shotLeadingAction(s, r, { claim: "" })),
      emptyUsed: shotReturnedReview(s, "", empty),
      emptySource: shotLeadingAction(s, r, { claim: "", projection: empty }).source,
    };`);
  ok(seen.review, "(g) a supplied projection answers exactly as the default");
  ok(seen.leading, "(g) and so does the leading action");
  equal(seen.emptyUsed, null, "(g) a supplied projection is actually used rather than re-derived");
  equal(seen.emptySource, "readiness", "(g) by the leading action as well");
}

/* ---------------------------------------------------------------- (h) */
async function caseH(options = {}) {
  const pending = projectOf([{ id: "L1-01", frames: [{ id: "frame-a", label: "A" }, { id: "frame-b", label: "B" }],
    candidates: [candidate("A1.png"), candidate("A2.png", { addedAt: "2026-08-20T10:10:00.000Z" }), candidate("B1.png", { frameId: "frame-b", addedAt: "2026-08-20T10:20:00.000Z" })],
    creationBrief: { deliveryIntent: "still", frameWorkflows: { "frame-a": { selectedCandidate: "A2.png" } } } }]);
  const settled = projectOf([{ id: "L1-01",
    candidates: [candidate("A1.png", { decision: "rejected" }), candidate("A2.png", { decision: "rejected", addedAt: "2026-08-20T10:10:00.000Z" })],
    creationBrief: { deliveryIntent: "still", frameWorkflows: { "frame-a": { selectedCandidate: "A2.png" } } } }]);
  const probe = `
    const opened = [];
    CineBraidResults.open = (scope, key) => opened.push({ scope, key });
    const s = shotById("L1-01"), before = JSON.stringify(P), revision = SAVE_REVISION;
    const answers = {
      frameA: shotResultsHandoff(s, "frame", "frame-a"),
      frameB: shotResultsHandoff(s, "frame", "frame-b"),
      motion: shotResultsHandoff(s, "motion"),
      unknown: shotResultsHandoff(s, "frame", "frame-deleted"),
    };
    openShotResults("L1-01", "frame", "frame-a");
    return { answers, opened, same: JSON.stringify(P) === before, revision: SAVE_REVISION - revision,
      hint: (s.creationBrief.frameWorkflows["frame-a"] || {}).selectedCandidate };`;
  const first = await render("#/shots/board", pending, { scan: scanWith(pending, { "L1-01": ["A1.png", "A2.png", "B1.png"] }), mutateSource: options.mutate });
  const a = evaluate(first.context, probe);
  deepEqual(a.answers.frameA, { scope: { shotId: "L1-01", kind: "frame", frameId: "frame-a" }, key: keyOf("L1-01", "A1.png"), source: "pending" },
    "(h) a waiting candidate in scope is handed over by its exact key, ahead of the remembered hint");
  equal(a.answers.frameB.key, keyOf("L1-01", "B1.png"), "(h) a sibling frame never borrows another frame's candidate");
  equal(a.answers.motion.key, "", "(h) motion with nothing returned opens without a key");
  equal(a.answers.unknown, null, "(h) an undeclared frame fails closed");
  deepEqual(a.opened, [{ scope: a.answers.frameA.scope, key: a.answers.frameA.key }], "(h) Results receives exactly that scope and key");
  ok(a.same, "(h) handing off writes nothing to the project");
  equal(a.revision, 0, "(h) and marks nothing dirty");
  equal(a.hint, "A2.png", "(h) the remembered selectedCandidate is untouched");

  const second = await render("#/shots/board", settled, { scan: scanWith(settled, { "L1-01": ["A1.png", "A2.png"] }), mutateSource: options.mutate });
  const b = evaluate(second.context, probe);
  equal(b.answers.frameA.source, "selected-hint", "(h) with nothing waiting, the remembered hint is read");
  equal(b.answers.frameA.key, keyOf("L1-01", "A2.png"), "(h) as an exact key, not a filename");
  ok(b.same && b.revision === 0 && b.hint === "A2.png", "(h) and it is still only read");
}

/* ---------------------------------------------------------------- (i)
   EV2-7 DOGFOOD CORRECTION — AN APPROVAL WHOSE FILE IS NOT IN THE PROJECT.

   The receipt is authoritative and stays exactly as it is; what is broken is that the
   project cannot show the bytes it names. Both surfaces lead with the repair, in the same
   words, and neither downgrades the approval or lets a newer candidate stand in for it.
   The negative control below removes the integrity read and the case goes red. */
async function caseI(options = {}) {
  const project = projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A", winner: "APPROVED_GONE.png" }],
    candidates: [candidate("NEWER.png", { addedAt: "2026-08-21T09:00:00.000Z" })],
  }]);
  /* The approved file is genuinely absent from the project's media; the newer candidate is
     present and waiting, which is the state that used to lead with a review. */
  const { board, desk, cards, hero } = await surfaces(project, { "L1-01": ["NEWER.png"] }, options);
  const seen = evaluate(board.context, `
    const s = shotById("L1-01");
    const receipt = currentHumanAuthority(P, { kind: "shot-frame", shotId: "L1-01", frameId: "frame-a" });
    return {
      awaiting: returnedReviewProjectionForBrowser().counts.awaiting,
      gaps: shotApprovedMediaGaps(s),
      receipt: receipt ? { value: receipt.value, id: receipt.id } : null,
      leading: shotLeadingAction(s, shotReadinessFor(s), { claim: "" }).source,
    };`);
  equal(seen.awaiting, 1, "(i) precondition: a newer candidate is genuinely waiting for a decision");
  ok(seen.receipt && seen.receipt.value === "APPROVED_GONE.png", "(i) precondition: the approval receipt names the missing file");
  deepEqual(seen.gaps.map((row) => `${row.kind}:${row.frameId}:${row.name}`), ["frame:frame-a:APPROVED_GONE.png"],
    "(i) the gap is derived from the receipt and the project's media, per declared target");
  equal(seen.leading, "approved-media-unavailable", "(i) the shared precedence leads with the integrity repair");
  equal(cards["L1-01"].source, "approved-media-unavailable", "(i) the Board card leads with it too");
  equal(cards["L1-01"].label, "Locate or replace image", "(i) in words that repair rather than review");
  equal(cards["L1-01"].detail, "The approval for Frame A is recorded, but its image is not in this project.",
    "(i) with one reason that keeps the approval and states the fact");
  /* Canonical readiness reads the RECEIPT and is therefore satisfied — it would have the
     filmmaker mark a shot final whose approved image the project cannot show. That code
     stays readable on the card, and it stays out of the list while a result is waiting. */
  equal(cards["L1-01"].readinessCode, "mark-shot-final", "(i) while the canonical readiness code stays readable on the card");
  ok(!hero.review && /data-approved-media-unavailable="1"/.test(hero.markup), "(i) and the Desk hero is the same integrity state");
  equal(hero.headline, "Locate or replace image", "(i) with the same headline the card named");
  ok(/APPROVED_GONE\.png is not in this project/.test(hero.markup), "(i) the Desk names the file that is missing");
  ok(!/NEWER\.png/.test(hero.markup.split("<ul class=\"shot-outstanding\"")[0]),
    "(i) and nothing newer stands in for it above the list: " + hero.markup);
  ok(/Also waiting ·<\/span><b class="shot-outstanding-label">Review Frame A result/.test(hero.markup),
    "(i) the waiting candidate is named first in the compact list, without a second control");
  /* THE RECEIPT IS UNTOUCHED BY ALL OF THIS. */
  const after = evaluate(desk.context, `
    const receipt = currentHumanAuthority(P, { kind: "shot-frame", shotId: "L1-01", frameId: "frame-a" });
    return { value: receipt ? receipt.value : "", revision: SAVE_REVISION, winner: shotById("L1-01").keyframes[0].winner };`);
  equal(after.value, "APPROVED_GONE.png", "(i) painting either surface leaves the approval receipt exactly as it was");
  equal(after.winner, "APPROVED_GONE.png", "(i) and the frame still points at the file it approved");
  equal(after.revision, 0, "(i) and marks nothing dirty");
}

/* ---------------------------------------------------------------- Production readers */
function productionOf(html) {
  const section = (re) => (html.match(re) || [""])[0];
  const rows = (markup) => Object.fromEntries(markup.split("<a ").slice(1).map((chunk) => {
    const row = chunk.split("</a>")[0];
    const data = (name) => (row.match(new RegExp(`${name}="([^"]*)"`)) || [])[1];
    return [(row.match(/href="#\/shot\/([^"]+)"/) || [])[1], {
      source: data("data-leading-source"), key: data("data-leading-key"),
      readinessStatus: data("data-readiness-status"), readinessCode: data("data-readiness-code"),
      status: (row.match(/<span class="readiness-status ([^"]*)">([^<]*)<\/span>/) || [])[2],
      tone: (row.match(/<span class="readiness-status ([^"]*)">/) || [])[1],
      label: (row.match(/<span class="next-([^"]*)" title="Next action for this shot">([^<]*)<\/span>/) || [])[2],
      cls: (row.match(/<span class="(next-[^"]*)" title="Next action for this shot">/) || [])[1],
      reason: ((row.match(/<small>([\s\S]*?)<\/small>/) || [])[1] || "").split('<span class="readiness-also">')[0].replace(/^[^·]*· /, "").trim(),
      small: ((row.match(/<small>([\s\S]*?)<\/small>/) || [])[1] || ""),
      also: (row.match(/<span class="readiness-also">([^<]*)<\/span>/) || [])[1] || "",
    }];
  }));
  const hero = html.match(/<section class="production-next" data-next-action-kind="([^"]*)"(?: data-next-action-shot="([^"]*)")?[\s\S]*?<a class="assemble-btn" href="[^"]*">([^<]*) →<\/a>/) || [];
  return {
    readiness: rows(section(/<div class="production-readiness-list shot-readiness-list">[\s\S]*?<\/div>/)),
    active: rows(section(/<div class="production-active-list">[\s\S]*?<\/div><\/section>/)),
    headline: (html.match(/<span>Production readiness<\/span><b>([^<]*)<\/b>/) || [])[1] || "",
    pill: Number((html.match(/data-filmmaker-decisions="(\d+)"/) || [])[1]),
    tile: Number((html.match(/<b>(\d+)<\/b><span>decisions? needs? you<\/span>/) || [])[1]),
    hero: { kind: hero[1] || "", shot: hero[2] || "", action: hero[3] || "" },
  };
}
const I2V = (project) => { for (const shot of project.shots) shot.deliveryRoute = "i2v"; return project; };
const FILTER_COUNTS = `
  const feed = projectShotReadiness(), previous = FILTER.action, counts = {};
  for (const id of ["unfinished", "review", "missing-inputs", "ready", "complete", "all"]) {
    FILTER.action = id;
    counts[id] = P.shots.filter((shot) => shotBoardActionMatches(shot, feed)).length;
  }
  FILTER.action = previous;
  return counts;`;
/* What the stage strip would show for a shot with no stored stage: the selection, and the
   bar's actions for it, from the shipped model and the shipped action contract. */
function stripIn(page, shotId) {
  const seen = evaluate(page.context, `
    const s = shotById(${JSON.stringify(shotId)}), takes = takesFor(s.id), facts = shotStageModelFacts(s, takes);
    const selected = boundedShotSelectedTask(s, takes);
    return { selected, state: shotStageState(selected, facts), frames: shotStageState("frames", facts),
      motion: shotStageState("motion", facts), look: shotStageState("look", facts) };`);
  return {
    ...seen,
    actions: StageActions.stageActions(seen.state, shotId).map((row) => row.label),
    framesActions: StageActions.stageActions(seen.frames, shotId).map((row) => row.label),
  };
}

/* ---------------------------------------------------------------- (j)
   THE REPRODUCED CASE. The project hero, the tile and the Board said review while
   "Shots and their next action" and the Production readiness rows said "Produce the
   frame" for the shot whose returned Frame A was waiting. */
async function caseJ(options = {}) {
  const project = projectOf([
    { id: "L1-01", candidates: [candidate("FRAME_A.png")] },
    { id: "L1-02" },
  ]);
  const takes = { "L1-01": ["FRAME_A.png"] };
  const page = await render("#/production", project, { scan: scanWith(project, takes), storage: { "cinebraid-shot-action-filter": "all" }, mutateSource: options.mutate });
  const { cards } = await surfaces(project, takes, options);
  const seen = productionOf(mainHtml(page));
  const canonical = readinessIn(page, "L1-01");
  const quiet = readinessIn(page, "L1-02");
  equal(canonical.status, "READY", "(j) precondition: canonical readiness says L1-01 can produce Frame A now");
  equal(canonical.code, "produce-frame", "(j) precondition: with Produce the frame");
  deepEqual(seen.hero, { kind: "returned-result", shot: "L1-01", action: "REVIEW SHOT IMAGE" }, "(j) precondition: the project hero leads with the returned result");

  /* Shots and their next action — the Board card's words, key and reason. */
  const row = seen.active["L1-01"];
  equal(row.label, "Review Frame A result", "(j) Shots and their next action names the leading action");
  equal(row.label, cards["L1-01"].label, "(j) in the Board card's words");
  equal(row.reason, cards["L1-01"].detail, "(j) with the Board card's reason");
  equal(row.source, "returned-review", "(j) from the same leading source");
  equal(row.key, cards["L1-01"].key, "(j) naming the same exact result key");
  equal(row.cls, "next-returned-review", "(j) and the leading action's class");
  equal(row.readinessCode, "produce-frame", "(j) while the canonical readiness code stays readable on the row");
  equal(seen.active["L1-02"].label, quiet.label, "(j) a shot with nothing returned keeps its canonical words");
  equal(seen.active["L1-02"].reason, quiet.detail, "(j) and its canonical reason");
  equal(seen.active["L1-02"].source, "readiness", "(j) because readiness leads it");

  /* Production readiness — leads with the same action, keeps the verdict. */
  const lead = seen.readiness["L1-01"];
  equal(lead.status, "NEEDS DECISION · Review Frame A result", "(j) the readiness row leads with the leading action");
  equal(lead.tone, "readiness-needs_decision", "(j) in the decision tone the pill counts");
  equal(lead.source, "returned-review", "(j) and says which owner leads");
  equal(lead.key, cards["L1-01"].key, "(j) naming the same exact result key");
  ok(lead.small.startsWith(cards["L1-01"].detail), "(j) with the leading reason first: " + lead.small);
  equal(lead.also, `Also ready · ${canonical.label} — ${canonical.detail}`, "(j) the row keeps canonical readiness, word for word");
  equal(lead.readinessStatus, "READY", "(j) and the canonical verdict as data");
  equal(lead.readinessCode, "produce-frame", "(j) and the canonical code");
  equal(seen.readiness["L1-02"].status, `READY · ${quiet.label}`, "(j) a row led by readiness is unchanged");
  equal(seen.readiness["L1-02"].source, undefined, "(j) and carries no leading attributes");
  equal(seen.readiness["L1-02"].also, "", "(j) and no second line");

  /* One count, and readiness truth kept in the headline. */
  equal(seen.headline, "2 shots have work that can start now", "(j) the readiness headline still counts L1-01 as able to start");
  equal(seen.pill, 1, "(j) the pill counts one decision");
  equal(seen.tile, seen.pill, "(j) the tile and the pill are one number");
  equal(Object.values(seen.readiness).filter((r) => /^NEEDS DECISION/.test(r.status)).length, seen.pill,
    "(j) and exactly that many readiness rows say NEEDS DECISION");

  /* A returned video is named as motion everywhere, the hero included. */
  const motion = projectOf([{ id: "L1-01", frames: [{ id: "frame-a", label: "A", winner: "FRAME_A.png" }], clips: [MOTION_CLIP],
    candidates: [candidate("FRAME_A.png"), candidate("SHOT_MOTION_1.mp4", { frameId: "", addedAt: "2026-08-20T12:00:00.000Z" })] }]);
  const motionTakes = { "L1-01": ["FRAME_A.png", "SHOT_MOTION_1.mp4"] };
  const second = productionOf(mainHtml(await render("#/production", motion, { scan: scanWith(motion, motionTakes), storage: { "cinebraid-shot-action-filter": "all" }, mutateSource: options.mutate })));
  equal(second.hero.action, "REVIEW SHOT VIDEO", "(j) the hero names a returned video as a video, not an image");
  equal(second.active["L1-01"].label, "Review motion result", "(j) Shots and their next action names motion");
  equal(second.readiness["L1-01"].status, "NEEDS DECISION · Review motion result", "(j) and so does its readiness row");

  /* An unreadable ledger still wins: both lists keep the canonical repair. */
  const broken = projectOf([{ id: "L1-01", candidates: [candidate("FRAME_A.png")] }]);
  broken.productionAuthority.receipts[0].command = "not-a-command";
  const third = productionOf(mainHtml(await render("#/production", broken, { scan: scanWith(broken, takes), storage: { "cinebraid-shot-action-filter": "all" }, mutateSource: options.mutate })));
  equal(third.active["L1-01"].label, "Await project repair", "(j) an unreadable ledger keeps the repair in Shots and their next action");
  equal(third.readiness["L1-01"].source, undefined, "(j) and leaves the readiness row canonical");
}

/* ---------------------------------------------------------------- (k)
   THE APPROVAL TRANSITION on an Animate-from-first-frame shot, and the Frames -> Motion
   case from the audit: the Desk said "Produce the motion" while the strip opened on Look
   & blocking. The two states are the returned Frame A waiting, and the same Frame A
   holding its approval receipt. */
async function caseK(options = {}) {
  const waiting = I2V(projectOf([{ id: "L1-01", candidates: [candidate("FRAME_A.png")] }, { id: "L1-02" }]));
  const approved = I2V(projectOf([{ id: "L1-01", frames: [{ id: "frame-a", label: "A", winner: "FRAME_A.png" }], candidates: [candidate("FRAME_A.png")] }, { id: "L1-02" }]));
  const takes = { "L1-01": ["FRAME_A.png"] };
  const at = async (project) => {
    const page = await render("#/production", project, { scan: scanWith(project, takes), storage: { "cinebraid-shot-action-filter": "all" }, mutateSource: options.mutate });
    const desk = await render("#/shot/L1-01", project, { scan: scanWith(project, takes), storage: { "cinebraid-shot-action-filter": "all" }, mutateSource: options.mutate });
    return { page, desk, seen: productionOf(mainHtml(page)), hero: heroOf(mainHtml(desk)), strip: stripIn(desk, "L1-01"), filters: evaluate(page.context, FILTER_COUNTS) };
  };
  const before = await at(waiting);
  const after = await at(approved);

  /* Before: one decision, led by review everywhere; the strip opens on Frames. */
  ok(before.hero.review, "(k) precondition: the Desk leads with the returned Frame A");
  equal(before.strip.look.tone, "attention", "(k) precondition: the optional Look stage is asking for attention too");
  equal(before.strip.selected, "frames", "(k) a returned Frame A opens Frames, ahead of the optional Look stage");
  deepEqual(before.strip.actions, ["Open frames review"], "(k) and the bar offers that review");
  equal(before.seen.active["L1-01"].label, "Review Frame A result", "(k) before approval the list says review");
  equal(before.filters.review, 1, "(k) and the Board counts one decision");
  /* The returned result is what decides when readiness's own action is done somewhere
     else — here on Production, confirming an existing reference — while the optional Look
     stage is also asking for attention. The Desk leads with the review; so does the strip. */
  const confirming = I2V(projectOf([{ id: "L1-01", candidates: [candidate("FRAME_A.png")] }], { canon: WITHOUT_KAI }));
  const confirmDesk = await render("#/shot/L1-01", confirming, { scan: scanWith(confirming, takes), storage: { "cinebraid-shot-action-filter": "all" }, mutateSource: options.mutate });
  const confirmStrip = stripIn(confirmDesk, "L1-01");
  equal(readinessIn(confirmDesk, "L1-01").code, "confirm-existing-reference", "(k) precondition: readiness's own action is done on Production");
  ok(heroOf(mainHtml(confirmDesk)).review, "(k) precondition: the Desk still leads with the returned Frame A");
  equal(confirmStrip.look.tone, "attention", "(k) precondition: and Look & blocking is asking for attention");
  equal(confirmStrip.selected, "frames", "(k) a returned result outranks the optional Look stage when readiness's action is elsewhere");

  /* After: the receipt settles the review, and everything moves together. */
  const canonical = readinessIn(after.page, "L1-01");
  equal(canonical.code, "produce-motion", "(k) precondition: after approval readiness owes the motion");
  ok(!after.hero.review, "(k) after approval the Desk no longer leads with a review");
  equal(after.hero.headline, "Produce the motion", "(k) it leads with Produce the motion");
  equal(after.seen.active["L1-01"].label, "Produce the motion", "(k) and so does Shots and their next action");
  equal(after.seen.active["L1-01"].source, "readiness", "(k) because readiness leads again");
  equal(after.seen.readiness["L1-01"].status, "READY · Produce the motion", "(k) the readiness row is canonical again");
  equal(after.seen.readiness["L1-01"].also, "", "(k) with no second line");
  equal(after.seen.pill, 0, "(k) no decision is outstanding");
  equal(after.seen.tile, 0, "(k) on the tile either");
  equal(after.filters.review, 0, "(k) the Board's Needs a decision empties");
  equal(after.filters.ready, before.filters.ready + 1, "(k) and the shot returns to Ready");
  equal(after.seen.hero.kind, "shot", "(k) the project hero stops pointing at a review");
  equal(after.strip.selected, "motion", "(k) after approval the shot opens on the stage that owns Produce the motion");
  ok(!/Look/.test(after.strip.actions.join(" ")), "(k) and the bar no longer offers Look & blocking: " + after.strip.actions.join(" | "));
  deepEqual(after.strip.actions, ["Open Motion & sound"], "(k) it offers Motion & sound");
  ok(mainHtml(after.desk).includes('data-selected-task="motion"'), "(k) and the Desk workspace below is Motion");
  deepEqual(after.strip.framesActions, ["Open Frames", "Continue to Motion & sound"], "(k) Frames still hands off to Motion & sound");
  ok(/<span>Motion · required<\/span>/.test(mainHtml(after.desk)), "(k) and the Motion workspace says it is required, not optional");
}

/* ---------------------------------------------------------------- (l)
   Required or optional is the Motion stage's answer, and a stored stage outranks every
   recommendation. */
async function caseL(options = {}) {
  const still = projectOf([{ id: "L1-01", frames: [{ id: "frame-a", label: "A", winner: "FRAME_A.png" }], candidates: [candidate("FRAME_A.png")] }]);
  const i2v = I2V(projectOf([{ id: "L1-01", frames: [{ id: "frame-a", label: "A", winner: "FRAME_A.png" }], candidates: [candidate("FRAME_A.png")] }]));
  const takes = { "L1-01": ["FRAME_A.png"] };
  const facts = async (project, storage = {}) => {
    const desk = await render("#/shot/L1-01", project, { scan: scanWith(project, takes), storage, mutateSource: options.mutate });
    return { desk, strip: stripIn(desk, "L1-01"), eyebrow: evaluate(desk.context, `
      const s = shotById("L1-01");
      return (guidedMotionPanel(s, null, takesFor(s.id)).match(/<summary><div><span>([^<]*)<\\/span>/) || [])[1] || "";`) };
  };
  const a = await facts(still);
  equal(readinessIn(a.desk, "L1-01").code, "mark-shot-final", "(l) precondition: a still shot with its frame approved is ready to mark final");
  equal(a.strip.motion.optional, true, "(l) a still shot does not owe motion");
  ok(/^motion (·|&middot;) optional$/i.test(a.eyebrow), "(l) and its Motion workspace says optional: " + a.eyebrow);
  equal(a.strip.selected, "deliver", "(l) it opens where Mark shot final is done");
  const b = await facts(i2v);
  equal(b.strip.motion.optional, false, "(l) Motion is required for an Animate-from-first-frame shot");
  ok(/^motion (·|&middot;) required$/i.test(b.eyebrow), "(l) and its Motion workspace says required: " + b.eyebrow);
  const c = await facts(i2v, { "cinebraid-focused:fixture:shot-task:L1-01": "look" });
  equal(c.strip.selected, "look", "(l) a stage the filmmaker chose is still honoured over the recommendation");
}

/* ---------------------------------------------------------------- (m)
   OPENING THE MOTION STAGE STORES NOTHING, AND THE SHOT KEEPS ITS DURATION.

   Drawing Motion used to create a default unit with `dur: 5`, so a 4-second shot read
   5 seconds the moment the strip opened Motion — which (k) now does on arrival — and
   the next unrelated save persisted it. Navigation must leave the record alone; a unit
   is created by an act that needs one, and starts from the shot's planned duration;
   an explicit duration edit still sets it. */
async function caseM(options = {}) {
  const build = () => {
    const project = I2V(projectOf([{ id: "L1-01", frames: [{ id: "frame-a", label: "A", winner: "FRAME_A.png" }], candidates: [candidate("FRAME_A.png")] }]));
    project.shots[0].dur = 4;
    return project;
  };
  const takes = { "L1-01": ["FRAME_A.png"] };
  const open = async (project) => render("#/shot/L1-01", project, { scan: scanWith(project, takes), storage: { "cinebraid-shot-action-filter": "all" }, mutateSource: options.mutate });
  const inRealm = async (page, body) => JSON.parse(await vm.runInContext(`(async () => { ${body} })().then(JSON.stringify)`, page.context));
  const desk = await open(build());
  const html = mainHtml(desk);
  ok(html.includes('data-selected-task="motion"'), "(m) precondition: the shot opens on Motion with nothing stored");
  const seen = await inRealm(desk, `
    const s = shotById("L1-01"), before = JSON.stringify(P), revision = SAVE_REVISION;
    for (let i = 0; i < 3; i++) await route();
    const painted = { clips: (s.clips || []).length, seconds: shotDur(s), same: JSON.stringify(P) === before, revision: SAVE_REVISION - revision };
    /* The Frames -> Motion hand-off is navigation that SAVES: it records the delivery
       intent and the motion target, and the save that follows is the unrelated save. */
    openGuidedMotionFromFrames("L1-01", "create");
    await route();
    const handoff = { clips: (s.clips || []).length, seconds: shotDur(s), revision: SAVE_REVISION - revision,
      saved: JSON.parse(JSON.stringify(P)).shots.find((row) => row.id === "L1-01").clips.length };
    /* An explicit motion edit that is not about duration creates the unit it needs, at
       the shot's planned duration. An explicit duration edit sets the duration. */
    window.setGuidedMotionField("L1-01", "motionIntensity", "moderate");
    const edited = { clips: (s.clips || []).map((row) => ({ label: row.label, dur: row.dur })), seconds: shotDur(s) };
    window.setGuidedMotionField("L1-01", "motionDuration", 7);
    const timed = { clips: (s.clips || []).map((row) => row.dur), seconds: shotDur(s) };
    return { painted, handoff, edited, timed };`);
  deepEqual(seen.painted, { clips: 0, seconds: 4, same: true, revision: 0 },
    "(m) drawing the Motion stage stores no motion unit and changes nothing");
  ok(/Motion unit A<\/b><small>Primary motion · 4s/.test(html), "(m) the unit tabs show the primary unit at the shot's own 4s");
  ok(/MOTION &amp; SOUND BRIEF · UNIT A|MOTION & SOUND BRIEF · UNIT A/.test(html), "(m) and the Motion & Sound launcher is still offered");
  equal(seen.handoff.clips, 0, "(m) the Frames -> Motion hand-off stores no motion unit either");
  equal(seen.handoff.seconds, 4, "(m) and the shot is still 4 seconds");
  ok(seen.handoff.revision > 0, "(m) precondition: the hand-off did save");
  equal(seen.handoff.saved, 0, "(m) and what it saved carries no invented unit");
  deepEqual(seen.edited, { clips: [{ label: "A", dur: 4 }], seconds: 4 },
    "(m) an unrelated motion edit creates unit A at the shot's planned duration");
  deepEqual(seen.timed, { clips: [7], seconds: 7 }, "(m) an explicit duration edit still sets the duration");

  /* Add unit on a shot with no stored unit: the primary unit the tabs were showing
     becomes real at the shot's duration, then the second one is added. */
  const fresh = await open(build());
  const added = await inRealm(fresh, `
    addGuidedMotionUnit("L1-01");
    const s = shotById("L1-01");
    return { units: s.clips.map((row) => row.label + ":" + row.dur + ":" + row.title) };`);
  deepEqual(added.units, ["A:4:Primary motion", "B:5:Motion unit B"], "(m) Add unit keeps unit A at the shot's duration and adds B");

  /* Approving a returned video on a shot with no motion unit. Opening Motion used to have
     created the unit already; now the approval creates its one possible target, at the
     shot's duration, and the shipped confirmation follows with no extra setup step.
     Nothing is approved until that confirmation is pressed. */
  const video = build();
  video.shots[0].candidateFiles.push(candidate("SHOT_MOTION_1.mp4", { frameId: "", addedAt: "2026-08-20T12:00:00.000Z" }));
  const videoScan = scanWith(video, { "L1-01": ["FRAME_A.png", "SHOT_MOTION_1.mp4"] });
  videoScan.shots["L1-01"].takes = videoScan.shots["L1-01"].takes.map((row) => ({ ...row, assetId: `asset-${(row.name.startsWith("SHOT") ? "b" : "a").repeat(32)}` }));
  const approving = await render("#/shot/L1-01", video, { scan: videoScan, storage: { "cinebraid-shot-action-filter": "all" }, mutateSource: options.mutate });
  const approval = await inRealm(approving, `
    const s = shotById("L1-01");
    await CineBraidResultDecisions.open("L1-01", "SHOT_MOTION_1.mp4", "motion", "");
    const modal = document.getElementById("modal").innerHTML;
    return { chooser: modal.includes("Choose the motion approval target"), confirm: modal.includes('id="rx-confirm"'),
      units: (s.clips || []).map((row) => row.label + ":" + row.dur),
      approved: !!currentHumanAuthority(P, { kind: "shot-motion", shotId: "L1-01", unitKey: ((s.clips || [])[0] || {}).id || "" }) };`);
  deepEqual(approval, { chooser: false, confirm: true, units: ["A:4"], approved: false },
    "(m) approving a returned video on a shot with no motion unit creates its primary unit at the shot's duration and opens the shipped confirmation");

  /* CANCEL. The unit is the approval's target, and targets are saved BEFORE the
     confirmation can be pressed (open() flushes the save). So after Cancel the unit is
     in the stored project, at the shot's own 4 seconds, and there is no receipt. */
  const cancelled = await inRealm(approving, `
    closeModal();
    const stored = durableProjectBaseline().shots.find((row) => row.id === "L1-01");
    const unitKey = (stored.clips || [])[0]?.id || "";
    return { settled: projectSaveSettled().settled, storedUnits: (stored.clips || []).map((row) => row.label + ":" + row.dur),
      storedReceipt: !!currentHumanAuthority(durableProjectBaseline(), { kind: "shot-motion", shotId: "L1-01", unitKey }),
      liveReceipt: !!currentHumanAuthority(P, { kind: "shot-motion", shotId: "L1-01", unitKey }), pending: !!approvalSubmissionPending() };`);
  deepEqual(cancelled, { settled: true, storedUnits: ["A:4"], storedReceipt: false, liveReceipt: false, pending: false },
    "(m) after Cancel the primary unit is saved at the shot's duration and no approval receipt exists");

  /* THE EXACT-MEDIA GUARD STILL COMES FIRST: a video with no verified media identity is
     refused before any unit is created. */
  const unverified = build();
  unverified.shots[0].candidateFiles.push(candidate("SHOT_MOTION_1.mp4", { frameId: "", addedAt: "2026-08-20T12:00:00.000Z" }));
  const guarded = await render("#/shot/L1-01", unverified, { scan: scanWith(unverified, { "L1-01": ["FRAME_A.png", "SHOT_MOTION_1.mp4"] }), storage: { "cinebraid-shot-action-filter": "all" }, mutateSource: options.mutate });
  const refused = await inRealm(guarded, `
    const before = SAVE_REVISION;
    await CineBraidResultDecisions.open("L1-01", "SHOT_MOTION_1.mp4", "motion", "");
    const modal = document.getElementById("modal").innerHTML;
    return { units: (shotById("L1-01").clips || []).length, confirm: modal.includes('id="rx-confirm"'), chooser: modal.includes("Choose the motion approval target"), revision: SAVE_REVISION - before };`);
  deepEqual(refused, { units: 0, confirm: false, chooser: false, revision: 0 },
    "(m) an unverified video is refused by the exact-media guard before any unit is created");

  /* SEVERAL UNITS STILL ASK, through the shipped chooser, and nothing is created. */
  const several = build();
  several.shots[0].clips = [
    { id: "motion-a", suffix: "a", label: "A", title: "Arrival", dur: 2, kind: "i2v", fromFrame: "frame-a", toFrame: "", generationPackages: [] },
    { id: "motion-b", suffix: "b", label: "B", title: "Exit", dur: 2, kind: "i2v", fromFrame: "frame-a", toFrame: "", generationPackages: [] },
  ];
  several.shots[0].candidateFiles.push(candidate("SHOT_MOTION_1.mp4", { frameId: "", addedAt: "2026-08-20T12:00:00.000Z" }));
  const chooserPage = await render("#/shot/L1-01", several, { scan: videoScan, storage: { "cinebraid-shot-action-filter": "all" }, mutateSource: options.mutate });
  const chose = await inRealm(chooserPage, `
    await CineBraidResultDecisions.open("L1-01", "SHOT_MOTION_1.mp4", "motion", "");
    const modal = document.getElementById("modal").innerHTML;
    return { chooser: modal.includes("Choose the motion approval target"), options: [...modal.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]),
      confirm: modal.includes('id="rx-confirm"'), units: shotById("L1-01").clips.map((row) => row.id) };`);
  deepEqual(chose, { chooser: true, options: ["motion-a", "motion-b"], confirm: false, units: ["motion-a", "motion-b"] },
    "(m) a shot with several motion units still asks which one, and nothing is created");

  /* THE UNIT TABS SAY WHAT IS TRUE: before a unit exists they name the primary unit as
     not created yet and count none, and Add unit is named for the unit it adds (B),
     with a note saying what creates A. Once A exists they count it and Add unit is plain. */
  const tabs = await inRealm(await open(build()), `
    const s = shotById("L1-01"), read = () => (guidedMotionPanel(s, null, takesFor(s.id)).match(/<details class="motion-unit-tabs">[\\s\\S]*?<\\/details>/) || [""])[0];
    const before = read();
    window.setGuidedMotionField("L1-01", "motionIntensity", "moderate");
    return { before, after: read() };`);
  ok(/Primary motion · 4s<\/small><\/div><span>NOT CREATED YET<\/span>/.test(tabs.before), "(m) with no stored unit the tabs say the primary unit is not created yet: " + tabs.before);
  ok(!/\b1 UNIT\b/.test(tabs.before), "(m) and count no unit");
  ok(tabs.before.includes("＋ Add unit B</button>"), "(m) and name Add unit for the unit it adds");
  ok(/Unit A is created, at this shot's 4s, the first time you edit this shot's motion/.test(tabs.before) && tabs.before.includes("Add unit B creates unit A first."),
    "(m) and say what creates unit A");
  ok(/Primary motion · 4s · inherits shot defaults<\/small><\/div><span>1 UNIT<\/span>/.test(tabs.after) && tabs.after.includes("＋ Add unit</button>") && !tabs.after.includes("not created yet"),
    "(m) once unit A exists the tabs count it and Add unit is plain: " + tabs.after);
}

/* ---------------------------------------------------------------- negative controls */
function replacing(file, needle, replacement) {
  return (name, source) => {
    if (name !== file) return source;
    const text = String(source).replace(/\r\n/g, "\n");
    assert.strictEqual(text.split(needle).length - 1, 1, `probe receipt: ${file} must contain its anchor exactly once: ${needle.slice(0, 80)}`);
    return text.split(needle).join(replacement);
  };
}
async function mustFail(label, because, body) {
  checks += 1;
  let failure = null;
  try { await body(); } catch (error) { failure = error; }
  assert(failure, `NEGATIVE CONTROL DID NOT FIRE: ${label}`);
  assert(String(failure.message).includes(because), `NEGATIVE CONTROL FIRED FOR THE WRONG REASON: ${label}: ${failure.message}`);
}
async function negativeControls() {
  await mustFail("NC-L1 board reverts to readiness words", "(a) the Board card says review",
    () => caseA({ mutate: replacing("app.js",
      `  const next = leading.lead;`,
      `  const next = leading.production;`) }));
  await mustFail("NC-L2 supplied projection ignored", "(g) a supplied projection is actually used",
    () => caseG({ mutate: replacing("creation-studio.js",
      `  const projection = supplied || returnedReviewProjectionForBrowser();`,
      `  const projection = returnedReviewProjectionForBrowser();`) }));
  await mustFail("NC-L3 handoff writes the tray selection", "(h) handing off writes nothing",
    () => caseH({ mutate: replacing("creation-studio.js",
      `  if (pending) return { scope, key: pending.key, source: "pending" };`,
      `  if (pending) { if (kind === "frame") selectGuidedFrameCandidate(s.id, scope.frameId, pending.candidate.name); return { scope, key: pending.key, source: "pending" }; }`) }));
  /* NC-L4 — THE INTEGRITY READ IS REMOVED, so an approval whose file is gone goes back to
     leading with a review of the newer candidate: the presentation mismatch this pass
     exists to end, restored on demand. */
  await mustFail("NC-L4 missing approved bytes stop leading", "(i) the shared precedence leads with the integrity repair",
    () => caseI({ mutate: replacing("creation-studio.js",
      `  const gaps = ledgerBlocked ? [] : shotApprovedMediaGaps(s, options.takes || null);`,
      `  const gaps = [];`) }));
  /* NC-L5 — Shots and their next action goes back to canonical readiness alone: the
     reproduced "Produce the frame" beside a hero that says review. */
  await mustFail("NC-L5 next-action rows read readiness alone", "(j) Shots and their next action names the leading action",
    () => caseJ({ mutate: replacing("app.js",
      `listing: shotNextActionListing(shot, readinessByShot.get(shot.id), returnedProjection) }));`,
      `listing: ((p) => ({ source: "readiness", key: "", lead: p, production: p }))(shotProductionNextAction(shot, readinessByShot.get(shot.id))) }));`) }));
  /* NC-L6 — the readiness row leads with the review and DROPS readiness: text made to
     match by erasing what can still be produced. */
  await mustFail("NC-L6 readiness row erases readiness", "(j) the row keeps canonical readiness, word for word",
    () => caseJ({ mutate: replacing("app.js",
      ` <span class="readiness-also">\${esc(also)}</span>`,
      ``) }));
  /* NC-L7 — the stage recommendation forgets where the readiness action is done, and an
     approved Frame A on an Animate-from-first-frame shot opens on Look & blocking again. */
  await mustFail("NC-L7 landing ignores the readiness action", "(k) after approval the shot opens on the stage that owns Produce the motion",
    () => caseK({ mutate: replacing("shared-stage-model.js",
      `    if (owner && SHOT_STAGE_IDS.includes(owner.id)) return owner.id;`,
      ``) }));
  /* NC-L8 — a returned Frame A stops outranking the optional Look stage's attention. */
  await mustFail("NC-L8 returned result loses the landing", "(k) a returned result outranks the optional Look stage when readiness's action is elsewhere",
    () => caseK({ mutate: replacing("shared-stage-model.js",
      `    if (returned) return returned.id;`,
      ``) }));
  /* NC-L9 — Motion goes back to its declared default: optional beside Produce the motion. */
  await mustFail("NC-L9 motion requirement ignored", "(l) Motion is required for an Animate-from-first-frame shot",
    () => caseL({ mutate: replacing("shared-stage-model.js",
      `    if (stage.id === "motion") state.optional = !resolved.motionRequired;`,
      ``) }));
  /* NC-L10 — drawing Motion creates its unit again: the 4 -> 5 seconds on arrival. */
  await mustFail("NC-L10 the Motion render creates a unit", "(m) drawing the Motion stage stores no motion unit",
    () => caseM({ mutate: replacing("v607-composer.js",
      `    const c = ensureShotCreation(s), unit = activeMotionUnit(s, false), defaultPlan`,
      `    const c = ensureShotCreation(s), unit = activeMotionUnit(s), defaultPlan`) }));
  /* NC-L11 — a created unit goes back to a hard-coded 5 seconds. */
  await mustFail("NC-L11 a new unit invents 5 seconds", "(m) an unrelated motion edit creates unit A at the shot's planned duration",
    () => caseM({ mutate: replacing("v607-composer.js",
      `dur: (typeof shotDurationSeconds === "function" ? shotDurationSeconds(s) : 0) || 5, kind,`,
      `dur: 5, kind,`) }));
  /* NC-L13 — the unsaved placeholder counts itself as a unit again ("1 UNIT"). */
  await mustFail("NC-L13 the unsaved placeholder is counted as a unit", "(m) with no stored unit the tabs say the primary unit is not created yet",
    () => caseM({ mutate: replacing("v607-composer.js",
      `    const count = stored ? \`\${s.clips.length} UNIT\${s.clips.length === 1 ? "" : "S"}\` : "NOT CREATED YET";`,
      `    const count = stored ? \`\${s.clips.length} UNIT\${s.clips.length === 1 ? "" : "S"}\` : "1 UNIT";`) }));
  /* NC-L12 — the approval stops creating the unit, so a shot with none asks for a setup
     step that opening Motion used to hide. */
  await mustFail("NC-L12 zero-unit motion approval asks for setup", "(m) approving a returned video on a shot with no motion unit",
    () => caseM({ mutate: replacing("result-decisions.js",
      `      if(!motionUnit&&!clips.length){prepared={id,name,kind,frameId,slug,epoch};return prepareMotion();}\n`,
      ``) }));
}

(async () => {
  for (const [name, fn] of [["a", caseA], ["b", caseB], ["c", caseC], ["d", caseD], ["e", caseE], ["f", caseF], ["g", caseG], ["h", caseH], ["i", caseI], ["j", caseJ], ["k", caseK], ["l", caseL], ["m", caseM], ["negative controls", negativeControls]]) {
    await fn();
    console.log(`  ok  (${name})`);
  }
  console.log(`ev2-7 shot leading action: ${checks} checks passed`);
})().catch((error) => { console.error(error); process.exit(1); });

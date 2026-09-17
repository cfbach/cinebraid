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
 *   (f) the board filters still count readiness alone;
 *   (g) a supplied projection is the default projection, and is actually used;
 *   (h) the Results handoff names the exact key and never writes selectedCandidate.
 * Three in-memory negative controls prove the suite goes red when those guarantees break.
 *
 * NO PROJECT DATA IS TOUCHED. NO SERVER IS STARTED. NO PROVIDER OR PAID CALL IS MADE.
 */
"use strict";
const assert = require("assert");
const vm = require("vm");
const { render, rawFixture, withCanon } = require("./render-harness");

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
  deepEqual(seenA.counts, seenB.counts, "(f) returned media changes no board filter count");
  equal(seenA.markup, seenB.markup, "(f) and no filter control");
  equal(seenA.counts.review, 0, "(f) 'Needs a decision' still counts readiness decisions, not returned results");
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
      `  const next = typeof shotLeadingActionWords === "function" ? shotLeadingActionWords(leading) : leading.production;`,
      `  const next = leading.production;`) }));
  await mustFail("NC-L2 supplied projection ignored", "(g) a supplied projection is actually used",
    () => caseG({ mutate: replacing("creation-studio.js",
      `  const projection = supplied || returnedReviewProjectionForBrowser();`,
      `  const projection = returnedReviewProjectionForBrowser();`) }));
  await mustFail("NC-L3 handoff writes the tray selection", "(h) handing off writes nothing",
    () => caseH({ mutate: replacing("creation-studio.js",
      `  if (pending) return { scope, key: pending.key, source: "pending" };`,
      `  if (pending) { if (kind === "frame") selectGuidedFrameCandidate(s.id, scope.frameId, pending.candidate.name); return { scope, key: pending.key, source: "pending" }; }`) }));
}

(async () => {
  for (const [name, fn] of [["a", caseA], ["b", caseB], ["c", caseC], ["d", caseD], ["e", caseE], ["f", caseF], ["g", caseG], ["h", caseH], ["negative controls", negativeControls]]) {
    await fn();
    console.log(`  ok  (${name})`);
  }
  console.log(`ev2-7 shot leading action: ${checks} checks passed`);
})().catch((error) => { console.error(error); process.exit(1); });

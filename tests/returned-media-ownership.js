/* CineBraid — Public Alpha UX Slice 3: RETURNED MEDIA DECISION OWNERSHIP & CONTEXT.
 *
 * THE PRODUCT INVARIANT THIS SUITE GOVERNS, and there is exactly one:
 *
 *     WHEN A GENERATION RESULT COMES BACK AND NEEDS A PERSON,
 *     THE RETURNED MEDIA OWNS THE IMMEDIATE DECISION.
 *
 * The convergence audit found three related P1s, and all three are the same defect seen
 * from different surfaces.
 *
 *   RM1  A shot with a returned candidate AND an unconfirmed reference opened its
 *        workspace saying `Confirm existing reference`. Production had just routed there
 *        with REVIEW RETURNED RESULT; the returned candidate was named nowhere on the
 *        page, and the only primary action on it was about something else.
 *
 *   RM2  A targeted repair returned as a peer of the take it repaired. Two candidate
 *        cards, side by side, reading `Selected candidate` and `Returned image` — and
 *        the word "correction", "repair", "before", "parent" and "original" appeared
 *        zero times in the whole workspace. The lineage WAS recorded; nothing showed it.
 *
 *   RM3  With two unreviewed candidates present, the shot's primary action read
 *        `Produce the frame` — an instruction to spend money generating a third.
 *
 * WHAT THE FIX IS, in one line: nothing in the browser decides what is waiting.
 * public/shared-returned-review.js derives it from public/shared-production-media.js —
 * which is already the read-only projection over durable disposition, human decision and
 * correction lineage — and every surface reads that one answer. So most of this suite is
 * AGREEMENT: the Production count, the candidate Production routes to, and the candidate
 * the shot workspace offers a decision about, read at one moment from one realm.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It forms no opinion about what is waiting. Every
 * disposition it checks was assigned by the shipped partition, every approval it makes is
 * written by the shipped kernel through the shipped control inside a real gesture, and
 * every rejection goes through the shipped decision writer. A queue this suite computed
 * itself would be the defect wearing a test's clothes.
 *
 * NO PROJECT DATA IS TOUCHED. NO SERVER IS STARTED. NO PROVIDER OR PAID CALL IS MADE.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const { render, rawFixture, withCanon } = require("./render-harness");
const RR = require("../public/shared-returned-review.js");

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
   the notes explaining a rule NAME the thing the rule forbids, which is exactly what an
   absence check must not trip over. */
const codeOnly = (source) => String(source)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, "$1");

const evaluate = (context, expression) =>
  JSON.parse(vm.runInContext(`JSON.stringify((() => { ${expression} })())`, context));
const evaluateAsync = async (context, expression) =>
  JSON.parse(await vm.runInContext(`(async () => { ${expression} })().then(JSON.stringify)`, context));

/* ===========================================================================
   FIXTURES.

   Every reference the shot depends on is approved through withCanon() unless the case is
   ABOUT an unconfirmed one, so a check about returned media is never quietly answered by
   a missing anchor. Nothing here writes an approval edge by hand: withCanon() writes the
   receipt the kernel writes, which is what makes a `historic` fixture distinguishable
   from an approved one at all.
   =========================================================================== */

const CAST_CANON = [
  { kind: "entity-state", list: "characters", entityId: "KAI", stateId: "state-default", value: "KAI-ANCHOR.png" },
  { kind: "entity-state", list: "locations", entityId: "LOC-HULL", stateId: "state-default", value: "LOC-HULL-PLATE.png" },
  { kind: "entity-state", list: "props", entityId: "PR-TOOL", stateId: "state-default", value: "PR-TOOL-PLATE.png" },
];

/* One still shot per spec, built off the harness template so the shape stays the shipped
   one. `frames` is the declared keyframe list; `candidates` are the rows a generation
   would have written at ingest. */
function shotOf(template, spec) {
  return {
    ...JSON.parse(JSON.stringify(template)),
    id: spec.id,
    title: spec.title || `Shot ${spec.id}`,
    keyframes: (spec.frames || [{ id: "frame-a", label: "A", winner: "" }]).map((frame) => ({
      id: frame.id,
      label: frame.label,
      title: `Frame ${frame.label}`,
      winner: frame.winner || "",
      description: "Worker at panel.",
      required: frame.required !== false,
      generationPackages: [],
    })),
    clips: spec.clips || [],
    candidateFiles: spec.candidates || [],
    creationBrief: spec.creationBrief || undefined,
    promptBuilds: [],
    promptOptions: [],
  };
}

function projectOf(shots, { canon = CAST_CANON, extraCanon = [] } = {}) {
  const project = rawFixture();
  const template = project.shots[0];
  project.shots = shots.map((spec) => shotOf(template, spec));
  const frameCanon = [];
  for (const spec of shots)
    for (const frame of spec.frames || [])
      if (frame.winner && frame.canon !== false)
        frameCanon.push({ kind: "shot-frame", shotId: spec.id, frameId: frame.id, value: frame.winner });
  return withCanon(project, [...canon, ...frameCanon, ...extraCanon]);
}

/* The scan the browser is handed. Takes are named explicitly per shot: the harness
   default gives every shot two files, and a case about "what is waiting" must control
   that list exactly. */
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

const candidate = (name, extra = {}) => ({
  stored: name,
  original: name,
  addedAt: extra.addedAt || "2026-08-20T10:00:00.000Z",
  decision: extra.decision || "unreviewed",
  notes: "",
  labels: [],
  frameId: extra.frameId === undefined ? "frame-a" : extra.frameId,
  generationJobId: extra.jobId || `job-${name}`,
  sourceBuildId: extra.sourceBuildId || "",
  generationProvider: "fal",
  generationModel: "gpt-image-2",
  ...(extra.correctionOf ? {
    correctionOf: extra.correctionOf,
    correctionBuildId: extra.sourceBuildId || "",
    correctionGeneratedAt: extra.addedAt || "2026-08-20T11:00:00.000Z",
    correctionReferenceCount: 3,
  } : {}),
  ...(extra.correctionResultNames ? { correctionResultNames: extra.correctionResultNames, correctionJobIds: ["job-repair"] } : {}),
  ...(extra.reviewedAt ? { reviewedAt: extra.reviewedAt } : {}),
});

/* The projection, read the way the browser reads it. */
const QUEUE_EXPR = `
  const projection = returnedReviewProjectionForBrowser();
  return {
    available: projection.available,
    counts: projection.counts,
    queue: projection.queue.map((row) => ({ key: row.key, shotId: row.shotId, owner: row.owner.kind, unit: row.owner.unitId, file: row.candidate.name, repairOf: row.repairOf ? row.repairOf.name : "", actions: row.actions })),
    items: projection.items.map((row) => ({ file: row.candidate.name, awaiting: row.awaitingReview, settled: row.settled, unreviewable: row.unreviewable, repairOf: row.repairOf ? row.repairOf.name : "" })),
  };
`;

/* What the shot workspace put in front of the filmmaker, read off the rendered card
   rather than off a function. The card is the product. */
function cardOf(html) {
  const section = html.match(/<section class="guided-next-action[\s\S]*?<\/section>/);
  const markup = section ? section[0] : "";
  const attribute = (name) => (markup.match(new RegExp(`${name}="([^"]*)"`)) || [])[1] || "";
  return {
    present: !!markup,
    markup,
    returnedReview: attribute("data-returned-review") === "1",
    key: attribute("data-returned-review-key"),
    owner: attribute("data-returned-review-owner"),
    unit: attribute("data-returned-review-unit"),
    file: attribute("data-returned-review-file"),
    waiting: attribute("data-returned-review-waiting"),
    repair: attribute("data-returned-review-repair") === "1",
    readinessStatus: attribute("data-shot-readiness"),
    secondaryCode: attribute("data-returned-review-secondary"),
    headline: (markup.match(/<h2>([^<]*)<\/h2>/) || [])[1] || "",
    kicker: (markup.match(/<span>([^<]*)<\/span>/) || [])[1] || "",
    primary: (markup.match(/class="assemble-btn shot-primary-action"[^>]*onclick="([^"]*)"[^>]*>([^<]*)/) || []).slice(1),
    actions: [...markup.matchAll(/data-returned-review-action="([a-z]+)"[^>]*onclick="([^"]*)"[^>]*>([^<]*)/g)].map((m) => ({ id: m[1], call: m[2], label: m[3] })),
    comparisons: [...markup.matchAll(/data-returned-review-compare="([a-z]+)"/g)].map((m) => m[1]),
  };
}
const primaryCount = (html) => (html.match(/\bshot-primary-action\b/g) || []).length;

/* ===========================================================================
   RM0 — THE PROJECTION IS A DERIVATION, NOT A SECOND AUTHORITY.

   Structural, and checked before any behaviour: the whole design rests on this module
   deciding nothing, so a future edit that gives it an opinion of its own must fail here
   rather than merely change a number somewhere.
   =========================================================================== */

function rm0_projectionOwnsNothing() {
  const source = codeOnly(readLF("public/shared-returned-review.js"));

  /* It reaches nothing. A derivation that could read a clock or a disk could go stale,
     and a projection that can go stale is a store. */
  for (const forbidden of ["require(\"fs\")", "require('fs')", "Date.now(", "new Date(", "localStorage", "document.", "fetch(", "setTimeout("])
    ok(!source.includes(forbidden), `the returned-review projection must not reach ${forbidden}`);

  /* It never re-decides authority. Every one of these is somebody else's answer, and
     reading the raw edge instead of the projection is how a second authority starts. */
  for (const forbidden of ["productionAuthority", "currentHumanAuthority", "hasCurrentHumanAuthority", "receipts", ".winner", "approvedFile"])
    ok(!source.includes(forbidden), `the returned-review projection must not read ${forbidden} — it asks shared-production-media.js`);

  /* It writes no sentence a filmmaker reads. */
  for (const forbidden of ["Review this", "waiting for review", "Use this take", "Keep looking"])
    ok(!source.includes(forbidden), `the returned-review projection must not carry UI wording: ${forbidden}`);

  /* And the vocabulary is closed. */
  deepEqual([...RR.RETURNED_REVIEW_ACTIONS], ["approve", "revise", "reject"], "three review actions, no more");
  deepEqual([...RR.RETURNED_REVIEW_OWNER_KINDS], ["shot-frame", "shot-motion"], "returned review is shot-owned");

  /* FAIL CLOSED. With no media answer available at all it claims nothing is waiting
     rather than guessing from filenames. */
  const blind = RR.returnedReviewProjection({ project: { shots: [{ id: "L1-01" }] }, media: { records: null } });
  equal(blind.available, true, "a project with an empty scan still derives");
  equal(blind.counts.awaiting, 0, "and reports nothing waiting rather than inventing a queue");

  note("RM0 the projection reaches nothing, decides nothing, words nothing, and fails closed");
}

/* ===========================================================================
   RM1 / RM2 / RM3 — THE THREE REPRODUCTIONS, NOW FIXED.
   =========================================================================== */

async function rm1_returnedFrameOwnsTheWorkspace() {
  /* RM1 — RETURNED FRAME CANDIDATE ONLY. */
  const only = projectOf([{ id: "L1-01", candidates: [candidate("FRAME_A.png")] }]);
  const onlyPage = await render("#/shot/L1-01", only, { scan: scanWith(only, { "L1-01": ["FRAME_A.png"] }) });
  const onlyCard = cardOf(onlyPage.context.document.getElementById("main").innerHTML);
  ok(onlyCard.returnedReview, "RM1: the returned candidate owns the shot workspace card");
  equal(onlyCard.file, "FRAME_A.png", "RM1: and the card names the exact candidate");
  equal(onlyCard.owner, "shot-frame", "RM1: with its owning unit kind");
  equal(onlyCard.unit, "frame-a", "RM1: and the frame it came back for");
  ok(/Review this returned result/.test(onlyCard.headline), "RM1: the headline is the decision, not a status");
  ok(/came back and needs your decision/.test(onlyCard.markup), "RM1: and it says what the filmmaker is looking at");
  ok(onlyCard.markup.includes("/assets/shots/L1-01/takes/FRAME_A.png"), "RM1: the candidate media is on the card");
  equal(primaryCount(onlyPage.context.document.getElementById("main").innerHTML), 1, "RM1: exactly one primary action survives");

  /* RM2 — RETURNED FRAME PLUS AN OUTSTANDING REFERENCE CONFIRMATION.
     The literal pre-fix state: readiness says confirm-existing-reference and used to own
     the card outright. */
  const both = projectOf([{ id: "L1-01", candidates: [candidate("FRAME_A.png")] }], {
    canon: CAST_CANON.filter((row) => row.entityId !== "KAI"),
  });
  const bothPage = await render("#/shot/L1-01", both, { scan: scanWith(both, { "L1-01": ["FRAME_A.png"] }) });
  const bothHtml = bothPage.context.document.getElementById("main").innerHTML;
  const bothCard = cardOf(bothHtml);
  const readiness = evaluate(bothPage.context, `
    const row = shotReadinessFor(shotById("L1-01"));
    return { status: row.status, code: row.nextAction.code, message: row.nextAction.message, label: readinessActionWords(row.nextAction) };
  `);
  equal(readiness.code, "confirm-existing-reference", "RM2: precondition — the reference confirmation is genuinely outstanding");
  ok(bothCard.returnedReview, "RM2: the returned candidate still owns the card");
  equal(bothCard.file, "FRAME_A.png", "RM2: and it is still the returned candidate");
  ok(!/Confirm existing reference/.test(bothCard.headline), "RM2: the reference confirmation is not the headline");
  equal(bothCard.primary[1], "Review this result", "RM2: nor the primary action");
  /* NOT ERASED. Secondary means demoted, not deleted: the canonical label, the canonical
     message and a control that performs it are all still on the card. */
  equal(bothCard.secondaryCode, "confirm-existing-reference", "RM2: the reference confirmation remains, as secondary context");
  ok(bothCard.markup.includes(readiness.label), "RM2: keeping its canonical action words");
  ok(bothCard.markup.includes(readiness.message), "RM2: and its canonical explanation");
  ok(/openShotReadinessAction\('L1-01','confirm-existing-reference'\)/.test(bothCard.markup),
    "RM2: and a working control, so nothing became unreachable");
  equal(bothCard.readinessStatus, readiness.status, "RM2: the card still declares canonical readiness");
  equal(primaryCount(bothHtml), 1, "RM2: still exactly one primary action");

  /* RM3 — RETURNED CANDIDATE BESIDE READY / PRODUCE WORK. The audit's third finding:
     the shot was told to generate another one. */
  const ready = projectOf([{ id: "L1-01", candidates: [candidate("FRAME_A.png"), candidate("FRAME_B.png", { addedAt: "2026-08-20T10:05:00.000Z" })] }]);
  const readyPage = await render("#/shot/L1-01", ready, { scan: scanWith(ready, { "L1-01": ["FRAME_A.png", "FRAME_B.png"] }) });
  const readyHtml = readyPage.context.document.getElementById("main").innerHTML;
  const readyCard = cardOf(readyHtml);
  const readyCode = evaluate(readyPage.context, `return shotReadinessFor(shotById("L1-01")).nextAction.code;`);
  equal(readyCode, "produce-frame", "RM3: precondition — readiness would have said produce another frame");
  ok(readyCard.returnedReview, "RM3: review outranks producing more");
  ok(!/produce/i.test(readyCard.primary[1] || ""), "RM3: and the primary action never says produce: " + readyCard.primary[1]);
  ok(!/Create Frame|Add motion|Create Motion/i.test(readyCard.headline), "RM3: no create/promote CTA is promoted over the review");
  equal(readyCard.waiting, "2", "RM3: the card states how many results are waiting in this shot");

  note("RM1-3 the returned candidate owns the shot workspace ahead of reference confirmation and ahead of producing more, and neither is erased");
}

/* ===========================================================================
   RM4 — RETURNED MOTION.
   =========================================================================== */

async function rm4_returnedMotionOwnsReview() {
  const project = projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A", winner: "FRAME_A.png" }],
    clips: [{ id: "motion-a", label: "A", suffix: "a", title: "Panel check", kind: "i2v", fromFrame: "frame-a", toFrame: "", dur: 5, motionPrompt: "He checks the panel.", generationPackages: [] }],
    candidates: [candidate("FRAME_A.png"), candidate("SHOT_MOTION_1.mp4", { frameId: "", addedAt: "2026-08-20T12:00:00.000Z" })],
  }]);
  const page = await render("#/shot/L1-01", project, { scan: scanWith(project, { "L1-01": ["FRAME_A.png", "SHOT_MOTION_1.mp4"] }) });
  const html = page.context.document.getElementById("main").innerHTML;
  const card = cardOf(html);
  const seen = evaluate(page.context, QUEUE_EXPR);

  equal(seen.counts.awaiting, 1, "RM4: the approved frame is settled, so only the returned video is waiting");
  equal(seen.queue[0].owner, "shot-motion", "RM4: owned by motion");
  equal(seen.queue[0].file, "SHOT_MOTION_1.mp4", "RM4: and it is the returned video");
  ok(card.returnedReview && card.owner === "shot-motion", "RM4: the returned Motion owns the shot workspace card");
  ok(/RETURNED RESULT · MOTION/.test(card.markup), "RM4: named as Motion rather than as a frame");
  ok(!/Create Frame|Produce the frame/i.test(card.markup), "RM4: and it does not fall back to a frame-generation CTA");
  ok(card.markup.includes("<video"), "RM4: the returned video itself is on the card");
  /* A video can be used or passed on. It cannot be `revised`: a targeted repair is built
     from a recorded FRAME review, and the model has nothing that could describe what to
     repair about a clip. The projection says so rather than the surface omitting it. */
  deepEqual(seen.queue[0].actions, ["approve", "reject"], "RM4: revise is declared invalid for motion rather than silently dropped");
  deepEqual(card.actions.map((row) => row.id), ["approve", "reject"], "RM4: and the card offers exactly those");
  ok(/approveGuidedMotion\('L1-01','SHOT_MOTION_1.mp4'\)/.test(card.actions[0].call), "RM4: through the shipped motion approval");

  note("RM4 a returned video owns its own review, is offered the shipped motion decision, and is never answered with a frame CTA");
}

/* ===========================================================================
   RM5 / RM13 / RM14 — WHAT CLEARS A REVIEW, AND WHAT DOES NOT.
   =========================================================================== */

async function rm5_reviewedCandidatesLeaveTheQueue() {
  /* RM5 — every durable decision, one fixture each. An AI review is deliberately in the
     list and deliberately does NOT count: `reviewedAt` is written by the vision
     assistant too, so a timestamp is not evidence a person decided anything. */
  const cases = [
    ["unreviewed", { }, true, ""],
    ["rejected", { decision: "rejected", reviewedAt: "2026-08-21T09:00:00.000Z" }, false, "human-rejected"],
    ["kept as alternate", { decision: "shortlist", reviewedAt: "2026-08-21T09:00:00.000Z" }, false, "kept-as-alternate"],
    ["AI review only", { reviewedAt: "2026-08-21T09:00:00.000Z" }, true, ""],
  ];
  for (const [label, extra, awaiting, settled] of cases) {
    const project = projectOf([{ id: "L1-01", candidates: [candidate("FRAME_A.png", extra)] }]);
    const page = await render("#/shot/L1-01", project, { scan: scanWith(project, { "L1-01": ["FRAME_A.png"] }) });
    const seen = evaluate(page.context, QUEUE_EXPR);
    equal(seen.counts.awaiting, awaiting ? 1 : 0, `RM5: ${label} — awaiting is ${awaiting}`);
    equal(seen.items[0].settled, settled, `RM5: ${label} — reported reason`);
    const card = cardOf(page.context.document.getElementById("main").innerHTML);
    equal(card.returnedReview, awaiting, `RM5: ${label} — the card claims ownership only while it is genuinely waiting`);
  }

  /* A frame that has been PICKED settles its candidates whoever picked it, which is
     Slice 1's rule carried through unchanged. */
  const picked = projectOf([{ id: "L1-01", frames: [{ id: "frame-a", label: "A", winner: "FRAME_A.png", canon: false }], candidates: [candidate("FRAME_A.png"), candidate("FRAME_B.png")] }]);
  const pickedPage = await render("#/shot/L1-01", picked, { scan: scanWith(picked, { "L1-01": ["FRAME_A.png", "FRAME_B.png"] }) });
  const pickedSeen = evaluate(pickedPage.context, QUEUE_EXPR);
  equal(pickedSeen.counts.awaiting, 0, "RM5: a picked frame stops asking about its candidates");
  equal(pickedSeen.items.find((row) => row.file === "FRAME_B.png").settled, "unit-already-picked",
    "RM5: and says that is why, rather than claiming somebody reviewed the alternate");

  /* RM13 — CONFIRMING THE REFERENCE DOES NOT REVIEW THE CANDIDATE. Two different scopes;
     completing one must not empty the other. The confirmation is written by the shipped
     control inside a real gesture, never by editing the ledger here. */
  const pending = projectOf([{ id: "L1-01", candidates: [candidate("FRAME_A.png")] }], {
    canon: CAST_CANON.filter((row) => row.entityId !== "KAI"),
  });
  const pendingPage = await render("#/production", pending, { scan: scanWith(pending, { "L1-01": ["FRAME_A.png"] }) });
  const before = evaluate(pendingPage.context, `
    const feed = projectShotReadiness();
    return { code: feed.shots[0].nextAction.code, returned: returnedResultsAwaitingReview().length, historic: feed.historic.items.map((row) => row.key) };
  `);
  equal(before.code, "confirm-existing-reference", "RM13: precondition — a reference is outstanding");
  equal(before.returned, 1, "RM13: and a candidate is waiting");
  await pendingPage.gesture.act(() => pendingPage.context.confirmHistoricSelection(before.historic[0]));
  const after = evaluate(pendingPage.context, `
    const feed = projectShotReadiness();
    return { code: feed.shots[0].nextAction.code, returned: returnedResultsAwaitingReview().length, awaiting: returnedReviewProjectionForBrowser().counts.awaiting };
  `);
  ok(after.code !== "confirm-existing-reference", "RM13: the reference confirmation completed");
  equal(after.returned, 1, "RM13: and the returned candidate is still waiting");
  equal(after.awaiting, 1, "RM13: in the projection as well as in the queue");

  /* RM14 — REVIEWING THE CANDIDATE CLEARS THE QUEUE, AND THE REFERENCE WORK IS THEN FREE
     TO BECOME THE NEXT ACTION. The rejection goes through the shipped decision writer. */
  const reviewing = projectOf([{ id: "L1-01", candidates: [candidate("FRAME_A.png")] }], {
    canon: CAST_CANON.filter((row) => row.entityId !== "KAI"),
  });
  const reviewPage = await render("#/shot/L1-01", reviewing, { scan: scanWith(reviewing, { "L1-01": ["FRAME_A.png"] }) });
  const reviewBefore = cardOf(reviewPage.context.document.getElementById("main").innerHTML);
  ok(reviewBefore.returnedReview, "RM14: precondition — the review owns the card");
  reviewPage.context.rejectReturnedResult("L1-01", "FRAME_A.png");
  await new Promise((resolve) => setTimeout(resolve, 20));
  const reviewAfter = cardOf(reviewPage.context.document.getElementById("main").innerHTML);
  const reviewSeen = evaluate(reviewPage.context, `return { returned: returnedResultsAwaitingReview().length, next: projectNextProductionAction() };`);
  equal(reviewSeen.returned, 0, "RM14: reviewing the candidate empties the queue");
  ok(!reviewAfter.returnedReview, "RM14: and the workspace hands the card back to readiness");
  equal(reviewAfter.secondaryCode, "", "RM14: with no orphaned secondary block left behind");
  ok(/Confirm existing reference/.test(reviewAfter.headline), "RM14: the reference work is now the shot's next action");
  ok(reviewSeen.next.kind !== "returned-result", "RM14: and Production stops routing to a returned result");

  note("RM5/13/14 only a human decision or a pick clears a review; an AI pass does not, confirming a reference does not, and reviewing does");
}

/* ===========================================================================
   RM6 / RM7 / RM12 — ORDER AND ROUTING.
   =========================================================================== */

async function rm6_orderAndRouting() {
  /* RM6 — TWO RETURNED CANDIDATES IN ONE SHOT. Order is generation completion order,
     which is a production fact, and it is stable across renders. */
  const two = projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A" }, { id: "frame-b", label: "B" }],
    candidates: [
      candidate("SECOND.png", { addedAt: "2026-08-20T11:00:00.000Z", frameId: "frame-b" }),
      candidate("FIRST.png", { addedAt: "2026-08-20T10:00:00.000Z", frameId: "frame-a" }),
    ],
  }]);
  const twoPage = await render("#/shot/L1-01", two, { scan: scanWith(two, { "L1-01": ["SECOND.png", "FIRST.png"] }) });
  const twoSeen = evaluate(twoPage.context, QUEUE_EXPR);
  deepEqual(twoSeen.queue.map((row) => row.file), ["FIRST.png", "SECOND.png"],
    "RM6: declared frame order decides, and the scan order does not");
  const twoCard = cardOf(twoPage.context.document.getElementById("main").innerHTML);
  equal(twoCard.file, "FIRST.png", "RM6: the workspace opens on the first of them");
  equal(twoCard.waiting, "2", "RM6: and says the second is there");
  /* Deciding the first moves to the second and never loops back. */
  twoPage.context.rejectReturnedResult("L1-01", "FIRST.png");
  await new Promise((resolve) => setTimeout(resolve, 20));
  const twoAfter = cardOf(twoPage.context.document.getElementById("main").innerHTML);
  equal(twoAfter.file, "SECOND.png", "RM6: reviewing the first advances to the next legitimate review");
  equal(twoAfter.waiting, "1", "RM6: and the count updates coherently");
  const twoCount = evaluate(twoPage.context, `return returnedResultsAwaitingReview().reduce((sum, row) => sum + row.count, 0);`);
  equal(twoCount, 1, "RM6: Returned Results agrees, because it reads the same array");

  /* RM7 — RETURNED CANDIDATES ON TWO SHOTS. Production names the owning shot AND the
     owning candidate, and the shot workspace resolves the same one. */
  const across = projectOf([
    { id: "L1-01", frames: [{ id: "frame-a", label: "A", winner: "L1-01_OK.png" }], candidates: [candidate("L1-01_OK.png")] },
    { id: "L1-02", candidates: [candidate("L1-02_NEW.png", { addedAt: "2026-08-20T10:30:00.000Z" })] },
    { id: "L1-03", candidates: [candidate("L1-03_NEW.png", { addedAt: "2026-08-20T09:00:00.000Z" })] },
  ]);
  const acrossPage = await render("#/production", across, {
    scan: scanWith(across, { "L1-01": ["L1-01_OK.png"], "L1-02": ["L1-02_NEW.png"], "L1-03": ["L1-03_NEW.png"] }),
  });
  const acrossSeen = evaluate(acrossPage.context, `
    const projection = returnedReviewProjectionForBrowser();
    return { next: projectNextProductionAction(), queue: projection.queue.map((row) => row.shotId + ":" + row.candidate.name) };
  `);
  deepEqual(acrossSeen.queue, ["L1-02:L1-02_NEW.png", "L1-03:L1-03_NEW.png"],
    "RM7: the project's own shot order decides between shots, not the newest file");
  equal(acrossSeen.next.shotId, "L1-02", "RM7: Production routes to the owning shot");
  equal(acrossSeen.next.href, "#/shot/L1-02", "RM7: through the existing shot route");
  equal(acrossSeen.next.reviewKey, "path:shots/L1-02/takes/L1-02_NEW.png", "RM7: naming the exact candidate that owns the review");
  const owningPage = await render("#/shot/L1-02", across, {
    scan: scanWith(across, { "L1-01": ["L1-01_OK.png"], "L1-02": ["L1-02_NEW.png"], "L1-03": ["L1-03_NEW.png"] }),
  });
  const owningCard = cardOf(owningPage.context.document.getElementById("main").innerHTML);
  equal(owningCard.key, acrossSeen.next.reviewKey,
    "RM7: and the shot workspace lands on that same candidate — the route and the card cannot disagree");

  /* RM12 — A REPAIR RETURNS WHILE THE PARENT IS ALREADY CANON. Canon does not move
     because a repair came back; it moves when a person approves the repair. */
  const canonised = projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A", winner: "C1.png" }],
    candidates: [
      candidate("C1.png", { correctionResultNames: ["C2.png"] }),
      candidate("C2.png", { addedAt: "2026-08-20T11:00:00.000Z", correctionOf: "C1.png", sourceBuildId: "build-corr" }),
    ],
  }]);
  const canonPage = await render("#/shot/L1-01", canonised, { scan: scanWith(canonised, { "L1-01": ["C1.png", "C2.png"] }) });
  const canonSeen = evaluate(canonPage.context, `
    const projection = returnedReviewProjectionForBrowser();
    return {
      awaiting: projection.counts.awaiting,
      canon: hasCurrentHumanAuthority(P, { kind: "shot-frame", shotId: "L1-01", frameId: "frame-a" }),
      canonFile: (P.shots[0].keyframes[0].winner || ""),
      settled: projection.items.map((row) => row.candidate.name + ":" + (row.settled || "waiting")),
    };
  `);
  equal(canonSeen.canon, true, "RM12: the parent holds Canon");
  equal(canonSeen.canonFile, "C1.png", "RM12: and it is still the parent's file");
  equal(canonSeen.awaiting, 0, "RM12: the frame is picked, so the unreviewed repair does not silently claim the unit");
  deepEqual(canonSeen.settled, ["C2.png:unit-already-picked", "C1.png:human-approved"],
    "RM12: each candidate reports its own reason, and neither is a claim that the repair was approved");

  note("RM6/7/12 order comes from declared production facts, the route and the card resolve the same candidate, and a returning repair moves no Canon");
}

/* ===========================================================================
   RM8 — FAIL CLOSED.
   =========================================================================== */

async function rm8_failsClosed() {
  /* A candidate ROW whose file is not in the scan produces no record at all — the queue
     is built from what is actually there, so a stale row cannot become a phantom
     review. */
  const stale = projectOf([{ id: "L1-01", candidates: [candidate("GONE.png"), candidate("HERE.png", { addedAt: "2026-08-20T10:05:00.000Z" })] }]);
  const stalePage = await render("#/shot/L1-01", stale, { scan: scanWith(stale, { "L1-01": ["HERE.png"] }) });
  const staleSeen = evaluate(stalePage.context, QUEUE_EXPR);
  deepEqual(staleSeen.queue.map((row) => row.file), ["HERE.png"], "RM8: a candidate row with no file on disk is not in the queue");
  ok(!staleSeen.items.some((row) => row.file === "GONE.png"), "RM8: and no record is invented for it");

  /* A candidate stamped for a frame this shot no longer declares belongs to NO frame. It
     is reported rather than re-homed onto frame one, because re-homing would put a
     candidate made for a deleted composition in front of a filmmaker as if it were made
     for the one that is left. */
  const orphan = projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A" }],
    candidates: [candidate("ORPHAN.png", { frameId: "frame-deleted" })],
  }]);
  const orphanPage = await render("#/shot/L1-01", orphan, { scan: scanWith(orphan, { "L1-01": ["ORPHAN.png"] }) });
  const orphanSeen = evaluate(orphanPage.context, QUEUE_EXPR);
  equal(orphanSeen.counts.awaiting, 0, "RM8: an orphaned candidate claims no review");
  equal(orphanSeen.counts.unreviewable, 1, "RM8: and is counted as unreviewable rather than dropped in silence");
  equal(orphanSeen.items[0].unreviewable, "frame-no-longer-declared", "RM8: naming why");
  ok(!cardOf(orphanPage.context.document.getElementById("main").innerHTML).returnedReview,
    "RM8: and the workspace shows no returned-review card for it");

  /* AND THE CONTROL REFUSES A KEY THAT NO LONGER OWNS A REVIEW rather than opening a
     review of something already decided. */
  const raced = projectOf([{ id: "L1-01", candidates: [candidate("FRAME_A.png")] }]);
  const racedPage = await render("#/shot/L1-01", raced, { scan: scanWith(raced, { "L1-01": ["FRAME_A.png"] }) });
  const key = cardOf(racedPage.context.document.getElementById("main").innerHTML).key;
  racedPage.context.rejectReturnedResult("L1-01", "FRAME_A.png");
  await new Promise((resolve) => setTimeout(resolve, 20));
  let toasted = "";
  racedPage.context.toast = (message) => { toasted = message; };
  racedPage.context.openReturnedResultReview("L1-01", key);
  await new Promise((resolve) => setTimeout(resolve, 20));
  ok(/no longer waiting/i.test(toasted), "RM8: a key decided since the render is refused in words: " + toasted);
  equal(racedPage.context.document.getElementById("modal").innerHTML, "", "RM8: and no review dialog is opened for it");

  note("RM8 a missing file, a deleted frame and a decided key each fail closed, in words, with no phantom review");
}

/* ===========================================================================
   RM9 / RM10 / RM11 — TARGETED REPAIR LINEAGE AND DURABLE HISTORY.
   =========================================================================== */

function repairProject() {
  return projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A" }],
    candidates: [
      candidate("C1.png", { decision: "unreviewed", correctionResultNames: ["C2.png"] }),
      candidate("C2.png", { addedAt: "2026-08-20T11:00:00.000Z", correctionOf: "C1.png", sourceBuildId: "build-corr" }),
    ],
  }]);
}
const REPAIR_SCAN = { "L1-01": ["C1.png", "C2.png"] };

async function rm9_repairLineage() {
  const project = repairProject();
  /* The correction package as the shipped correction builder writes it, so the intent
     summary is read out of a real reviewSnapshot rather than a hand-written string. */
  project.promptBuildsById = { "build-corr": {
    id: "build-corr",
    packageId: "L1-01-A-CORRECTION-R02",
    kind: "candidate-correction",
    frameId: "frame-a",
    sourceCandidate: "C1.png",
    prompt: "CORRECT THE EXISTING FRAME",
    references: [],
    reviewSnapshot: { categories: { composition: { severity: "major", note: "Crop drifted wide." }, cleanliness: { severity: "pass", note: "" } }, references: [] },
    date: "2026-08-20T10:50:00.000Z",
    revision: 2,
    revisionReason: "candidate-correction",
  } };
  const page = await render("#/shot/L1-01", project, { scan: scanWith(project, REPAIR_SCAN) });
  const html = page.context.document.getElementById("main").innerHTML;
  const card = cardOf(html);
  const seen = evaluate(page.context, `
    const projection = returnedReviewProjectionForBrowser();
    const repair = projection.queue[0];
    return {
      order: projection.queue.map((row) => row.candidate.name),
      key: repair.key,
      repairOf: repair.repairOf,
      correction: repair.correction,
      repairedInto: projection.items.find((row) => row.candidate.name === "C1.png").repairedInto,
    };
  `);

  /* THE REPAIR LEADS. Not because it is newer — because `correction-of` says it repairs
     the other one, so the other one is the Before of a decision that has moved on. */
  deepEqual(seen.order, ["C2.png", "C1.png"], "RM9: the repair owns the review and its parent follows");
  equal(card.file, "C2.png", "RM9: so the workspace opens on the repaired candidate");
  equal(card.repair, true, "RM9: declared as a repair");
  equal(seen.repairOf.state, "available", "RM9: with the parent resolved");
  equal(seen.repairOf.name, "C1.png", "RM9: to the exact take it repaired");
  equal(seen.correction.state, "recorded", "RM9: and the correction is recorded");
  equal(seen.correction.buildId, "build-corr", "RM9: with the build that produced it");
  equal(seen.correction.intent, "Composition", "RM9: and what it was asked to fix, read out of the frozen review");
  deepEqual(seen.repairedInto, [{ name: "C2.png", state: "available", key: "path:shots/L1-01/takes/C2.png" }],
    "RM9: and the parent records the other half of the same relationship");

  /* AND IT IS VISIBLE. This is the half the audit found missing: the relationship was
     recorded and shown nowhere. */
  ok(card.comparisons.includes("before"), "RM9: the parent take is on the card as Before");
  ok(card.markup.includes("/assets/shots/L1-01/takes/C1.png"), "RM9: with its actual media, comparable without leaving the page");
  ok(/a repair of C1\.png/.test(card.markup), "RM9: and the relationship is stated in words");
  ok(/Asked to fix: Composition/.test(card.markup), "RM9: alongside what the repair was for");

  /* A RECORDED PARENT THAT IS GONE SAYS SO. */
  const missing = repairProject();
  const missingPage = await render("#/shot/L1-01", missing, { scan: scanWith(missing, { "L1-01": ["C2.png"] }) });
  const missingCard = cardOf(missingPage.context.document.getElementById("main").innerHTML);
  const missingSeen = evaluate(missingPage.context, `return returnedReviewProjectionForBrowser().queue[0].repairOf;`);
  equal(missingSeen.state, "recorded-not-available", "RM9: a parent that is no longer in the project is reported");
  equal(missingSeen.name, "C1.png", "RM9: by name");
  ok(/no longer in this project/.test(missingCard.markup), "RM9: and the card says so rather than showing nothing");

  note("RM9 the repair leads, its parent is resolved from recorded provenance, and both the relationship and the Before image are on the card");
}

async function rm10_historyIsDurable() {
  /* RM10 — REJECTING THE REPAIR. Nothing about the parent changes, and nothing is
     deleted. The rejection goes through the shipped decision writer. */
  const project = repairProject();
  const page = await render("#/shot/L1-01", project, { scan: scanWith(project, REPAIR_SCAN) });
  const before = evaluate(page.context, `
    return {
      rows: P.shots[0].candidateFiles.map((row) => ({ name: row.stored, decision: row.decision, correctionOf: row.correctionOf || "", into: row.correctionResultNames || [] })),
      canon: hasCurrentHumanAuthority(P, { kind: "shot-frame", shotId: "L1-01", frameId: "frame-a" }),
    };
  `);
  equal(before.canon, false, "RM10: precondition — nothing is Canon yet");
  page.context.rejectReturnedResult("L1-01", "C2.png");
  await new Promise((resolve) => setTimeout(resolve, 20));
  const after = evaluate(page.context, `
    const projection = returnedReviewProjectionForBrowser();
    return {
      rows: P.shots[0].candidateFiles.map((row) => ({ name: row.stored, decision: row.decision, correctionOf: row.correctionOf || "", into: row.correctionResultNames || [] })),
      canon: hasCurrentHumanAuthority(P, { kind: "shot-frame", shotId: "L1-01", frameId: "frame-a" }),
      winner: P.shots[0].keyframes[0].winner || "",
      items: projection.items.map((row) => row.candidate.name + ":" + row.candidate.disposition),
      queue: projection.queue.map((row) => row.candidate.name),
      lineage: projection.items.map((row) => row.candidate.name + "<-" + (row.repairOf ? row.repairOf.name : "")),
    };
  `);
  equal(after.rows.length, 2, "RM10: both candidate rows survive the rejection");
  deepEqual(after.rows.map((row) => row.name), before.rows.map((row) => row.name), "RM10: with the same identities");
  equal(after.rows.find((row) => row.name === "C1.png").decision, "unreviewed", "RM10: the parent's own disposition is untouched");
  deepEqual(after.rows.find((row) => row.name === "C1.png").into, ["C2.png"], "RM10: and its half of the lineage survives");
  equal(after.rows.find((row) => row.name === "C2.png").correctionOf, "C1.png", "RM10: as does the rejected repair's");
  deepEqual(after.items.sort(), ["C1.png:candidate", "C2.png:rejected"].sort(), "RM10: history keeps both, one of them rejected");
  deepEqual(after.queue, ["C1.png"], "RM10: and the review moves to the parent, which nobody has decided about");
  equal(after.canon, false, "RM10: rejecting the repair resurrects no Canon");
  equal(after.winner, "", "RM10: and promotes no pointer");
  ok(after.lineage.includes("C2.png<-C1.png"), "RM10: correction lineage stays inspectable after the rejection");

  note("RM10 rejecting a repair keeps both rows, both dispositions, both halves of the lineage, and moves no authority");
}

async function rm11_approvingTheRepair() {
  /* RM11 — APPROVING THE REPAIR, through the shipped approval control inside a real
     gesture. The kernel writes the receipt; this suite writes nothing. */
  const project = repairProject();
  const page = await render("#/shot/L1-01", project, { scan: scanWith(project, REPAIR_SCAN) });
  const card = cardOf(page.context.document.getElementById("main").innerHTML);
  const approve = card.actions.find((row) => row.id === "approve");
  ok(/approveGuidedFrame\('L1-01','frame-a','C2\.png'\)/.test(approve.call),
    "RM11: Use this take applies to the exact reviewed candidate: " + approve.call);
  page.context.approveGuidedFrame("L1-01", "frame-a", "C2.png");
  page.context.document.getElementById("approve-name").value = "C2.png";
  await page.gesture.act(() => page.context.confirmApproveTake());
  await new Promise((resolve) => setTimeout(resolve, 20));
  const after = evaluate(page.context, `
    const projection = returnedReviewProjectionForBrowser();
    return {
      canon: hasCurrentHumanAuthority(P, { kind: "shot-frame", shotId: "L1-01", frameId: "frame-a" }),
      receipts: (P.productionAuthority.receipts || []).filter((row) => row.kind === "shot-frame" && row.status === "current").map((row) => row.value),
      rows: P.shots[0].candidateFiles.map((row) => row.stored),
      dispositions: projection.items.map((row) => row.candidate.name + ":" + row.candidate.disposition),
      awaiting: projection.counts.awaiting,
      lineage: projection.items.map((row) => row.candidate.name + "<-" + (row.repairOf ? row.repairOf.name : "")),
    };
  `);
  equal(after.canon, true, "RM11: approving the repair establishes Canon");
  deepEqual(after.receipts, ["C2.png"], "RM11: on the repaired candidate, through the shipped receipt");
  deepEqual(after.rows.sort(), ["C1.png", "C2.png"].sort(), "RM11: and the parent remains in history");
  ok(after.dispositions.includes("C2.png:approved"), "RM11: the repair reads approved");
  ok(after.dispositions.includes("C1.png:candidate"), "RM11: and the parent keeps its own, unchanged, disposition");
  equal(after.awaiting, 0, "RM11: the unit is settled, so its alternates stop asking");
  ok(after.lineage.includes("C2.png<-C1.png"), "RM11: and the repair still says what it repaired");
  ok(!cardOf(page.context.document.getElementById("main").innerHTML).returnedReview,
    "RM11: the returned-review card releases the workspace");

  note("RM11 approving the repair uses the shipped authority on the exact candidate, and leaves the parent and the lineage intact");
}

/* ===========================================================================
   RM15 — AN INTEGRITY BLOCKER STILL OUTRANKS A REVIEW.
   =========================================================================== */

async function rm15_integrityOutranksReview() {
  const project = projectOf([{ id: "L1-01", candidates: [candidate("FRAME_A.png")] }]);
  /* A ledger that cannot be read. Not a missing file, not a creative judgement — a truth
     problem, which is the one class of thing that must be repaired before a decision is
     recorded against it. */
  project.productionAuthority.receipts[0].command = "not-a-command";
  const page = await render("#/shot/L1-01", project, { scan: scanWith(project, { "L1-01": ["FRAME_A.png"] }) });
  const html = page.context.document.getElementById("main").innerHTML;
  const card = cardOf(html);
  const seen = evaluate(page.context, `
    const feed = projectShotReadiness();
    return {
      trusted: feed.authority.trusted,
      shotCode: feed.shots[0].nextAction.code,
      projectKind: projectNextProductionAction(feed).kind,
      awaiting: returnedReviewProjectionForBrowser().counts.awaiting,
    };
  `);
  equal(seen.trusted, false, "RM15: precondition — the approval ledger cannot be read");
  equal(seen.awaiting, 1, "RM15: and a returned candidate is genuinely waiting");
  equal(seen.projectKind, "repair", "RM15: the project-level repair still outranks the review, exactly as Slice 1 left it");
  equal(seen.shotCode, "awaiting-project-repair", "RM15: and the shot's readiness says the same");
  ok(!card.returnedReview, "RM15: so the shot workspace keeps the repair card rather than offering a review nobody could record");
  ok(/Await project repair/.test(card.markup), "RM15: in the canonical words");
  equal(primaryCount(html), 1, "RM15: still exactly one primary action");

  note("RM15 an unreadable ledger outranks the returned review at both scopes, because a decision recorded against it could not be trusted");
}

/* ===========================================================================
   CROSS-SURFACE AGREEMENT — THE PROPERTY THE WHOLE SLICE RESTS ON.
   =========================================================================== */

async function agreement_oneQueueEverywhere() {
  const project = projectOf([
    { id: "L1-01", frames: [{ id: "frame-a", label: "A" }, { id: "frame-b", label: "B" }], candidates: [candidate("A1.png"), candidate("A2.png", { addedAt: "2026-08-20T10:10:00.000Z" }), candidate("B1.png", { frameId: "frame-b", addedAt: "2026-08-20T10:20:00.000Z" })] },
    { id: "L1-02", candidates: [candidate("D1.png", { addedAt: "2026-08-20T10:30:00.000Z" })] },
  ]);
  const page = await render("#/production", project, {
    scan: scanWith(project, { "L1-01": ["A1.png", "A2.png", "B1.png"], "L1-02": ["D1.png"] }),
  });
  const seen = await evaluateAsync(page.context, `
    const projection = returnedReviewProjectionForBrowser();
    const rows = returnedResultsAwaitingReview();
    const inbox = productionResultInbox();
    return {
      awaiting: projection.counts.awaiting,
      queueKeys: projection.queue.map((row) => row.key),
      rowTotal: rows.filter((row) => row.shot).reduce((sum, row) => sum + row.count, 0),
      rowKeys: rows.filter((row) => row.shot).map((row) => row.reviewKey),
      headline: (inbox.split("<h2>")[1] || "").split("</h2>")[0],
      next: projectNextProductionAction(),
      decisions: projectFilmmakerDecisions().count,
    };
  `);
  equal(seen.awaiting, 4, "AGREEMENT: four returned candidates are waiting");
  equal(seen.rowTotal, seen.awaiting, "AGREEMENT: the Returned Results count is the queue, not a number derived beside it");
  ok(seen.headline.includes("4 returned results"), "AGREEMENT: and the inbox headline says so: " + seen.headline);
  deepEqual(seen.rowKeys, [seen.queueKeys[0], seen.queueKeys[3]],
    "AGREEMENT: each grouped row names the first candidate of its own group, in queue order");
  equal(seen.next.reviewKey, seen.queueKeys[0], "AGREEMENT: and Production's action names the head of the queue");

  /* THE TWO SCOPES STAY SEPARATE, which is Slice 1 and must not be merged by this
     slice's arithmetic. */
  equal(seen.decisions, 0, "AGREEMENT: four returned results are still zero filmmaker decisions");
  ok(!/decision/i.test(seen.headline), "AGREEMENT: and the returned queue never borrows the word");

  /* THE SHOT WORKSPACE READS THE SAME ARRAY. */
  const shotPage = await render("#/shot/L1-01", project, {
    scan: scanWith(project, { "L1-01": ["A1.png", "A2.png", "B1.png"], "L1-02": ["D1.png"] }),
  });
  const shotCard = cardOf(shotPage.context.document.getElementById("main").innerHTML);
  equal(shotCard.key, seen.queueKeys[0], "AGREEMENT: the shot workspace opens on the same candidate Production named");
  equal(shotCard.waiting, "3", "AGREEMENT: and counts only its own shot's share");

  /* AND THE PER-FRAME ASSIGNMENT MATCHES THE SHIPPED DISPLAY FILTER. The projection
     groups candidates by frame for the queue; public/creation-studio.js groups the same
     files by frame for the frame card. Two consumers of one production fact, checked
     against each other rather than assumed to agree. */
  const grouping = evaluate(shotPage.context, `
    const shot = shotById("L1-01");
    const takes = takesFor("L1-01");
    const frames = guidedFrames(shot);
    const display = frames.map((frame, index) => guidedFrameCandidateRows(shot, frame, takes, index).map((take) => take.name).sort());
    const projection = returnedReviewProjectionForBrowser();
    /* Shot AND unit. A frame id is only unique inside its shot — every shot here declares
       a frame-a — so a consumer that matched on the unit alone would pull another shot's
       candidates into this frame, which is exactly what it did before this line said so. */
    const derived = frames.map((frame) => projection.items.filter((row) => row.shotId === shot.id && row.owner.unitId === frame.id).map((row) => row.candidate.name).sort());
    return { display, derived };
  `);
  deepEqual(grouping.derived, grouping.display,
    "AGREEMENT: the queue and the frame card put the same candidates under the same frames");

  note("AGREEMENT one array feeds the count, the inbox, the project action and the shot card; the decision scope stays separate; per-frame grouping matches the shipped display filter");
}

/* ===========================================================================
   MEDIA REMAINS THE ARCHIVE. Review is a decision layer over it and never a store.
   =========================================================================== */

async function archive_reviewIsNotAStore() {
  const project = repairProject();
  const page = await render("#/shot/L1-01", project, { scan: scanWith(project, REPAIR_SCAN) });
  const before = JSON.stringify(evaluate(page.context, `return { candidates: P.shots[0].candidateFiles, assets: P.mediaAssets, authority: P.productionAuthority };`));
  /* Deriving the projection repeatedly must change nothing about the document. */
  const stability = evaluate(page.context, `
    const first = returnedReviewProjectionForBrowser();
    const second = returnedReviewProjectionForBrowser();
    return {
      same: JSON.stringify(first.queue.map((row) => row.key)) === JSON.stringify(second.queue.map((row) => row.key)),
      frozen: Object.isFrozen(first) && Object.isFrozen(first.queue) && (first.queue.length ? Object.isFrozen(first.queue[0]) : true),
      after: { candidates: P.shots[0].candidateFiles, assets: P.mediaAssets, authority: P.productionAuthority },
    };
  `);
  ok(stability.same, "ARCHIVE: the projection is deterministic across calls");
  ok(stability.frozen, "ARCHIVE: and returned frozen, so a consumer cannot make it a store by mutating it");
  equal(JSON.stringify({ candidates: stability.after.candidates, assets: stability.after.assets, authority: stability.after.authority }), before,
    "ARCHIVE: deriving the review queue writes nothing to the project");

  /* And the browser layer persists no review state of its own: `returnedReview` must
     never become a field on a shot. */
  const source = codeOnly(readLF("public/creation-studio.js"));
  for (const forbidden of ["c.returnedReview", "shot.returnedReview", "s.returnedReview", "returnedReviewState ="])
    ok(!source.includes(forbidden), `the returned review must not be persisted onto a shot: ${forbidden}`);

  note("ARCHIVE the review queue is derived, frozen and deterministic; nothing about it is stored on a shot or a candidate");
}

/* ===========================================================================
   THE FIXTURE THE REAL-BROWSER HALF DRIVES.

   Written HERE rather than restated in Python, so the two halves cannot drift into
   testing different projects and both report green. It is built out of the same
   projectOf()/candidate() helpers every case above uses, so the shapes a filmmaker will
   see in Chromium are the shapes this file has already asserted about.

   Two shots, and each is one of the audit's reproductions:

     SH-A   one returned candidate, and a reference nobody has confirmed
            — the shot that used to open asking to confirm the reference
     SH-B   a candidate and the targeted repair of it
            — the two peers that used to arrive with no relationship between them
   =========================================================================== */

const BROWSER_FIXTURE = {
  shotA: "SH-A",
  shotB: "SH-B",
  candidateA: "SH-A_FRAME_A_FAL_1.png",
  parentB: "SH-B_FRAME_A_FAL_1.png",
  repairB: "SH-B_FRAME_A_CORRECTION_FAL_1.png",
  unconfirmedReference: "KAI-ANCHOR.png",
};

function writeBrowserFixture(dir) {
  for (const folder of ["anchors", "plates", "props", "media", "docs", path.join("shots", "SH-A", "takes"), path.join("shots", "SH-B", "takes")])
    fs.mkdirSync(path.join(dir, folder), { recursive: true });
  fs.writeFileSync(path.join(dir, "anchors", "KAI-ANCHOR.png"), "kai");
  fs.writeFileSync(path.join(dir, "plates", "LOC-HULL-PLATE.png"), "hull");
  fs.writeFileSync(path.join(dir, "props", "PR-TOOL-PLATE.png"), "tool");
  fs.writeFileSync(path.join(dir, "shots", "SH-A", "takes", BROWSER_FIXTURE.candidateA), "a1");
  fs.writeFileSync(path.join(dir, "shots", "SH-B", "takes", BROWSER_FIXTURE.parentB), "b1");
  fs.writeFileSync(path.join(dir, "shots", "SH-B", "takes", BROWSER_FIXTURE.repairB), "b2");

  /* KAI is deliberately NOT in the receipt list: the shot points at KAI-ANCHOR.png and
     nobody has approved it, which is the `confirm-existing-reference` shape exactly. */
  const project = projectOf([
    { id: "SH-A", title: "Hull check", candidates: [candidate(BROWSER_FIXTURE.candidateA)] },
    {
      id: "SH-B",
      title: "Panel repair",
      candidates: [
        candidate(BROWSER_FIXTURE.parentB, { correctionResultNames: [BROWSER_FIXTURE.repairB] }),
        candidate(BROWSER_FIXTURE.repairB, { addedAt: "2026-08-20T11:00:00.000Z", correctionOf: BROWSER_FIXTURE.parentB, sourceBuildId: "build-corr" }),
      ],
    },
  ], { canon: CAST_CANON.filter((row) => row.entityId !== "KAI") });
  project.meta.title = "Returned Review Project";
  /* EVERY ENTITY DECLARES ITS DEFAULT STATE EXPLICITLY, which is what a project looks
     like once CineBraid has opened it once.

     Without it, load-time normalisation in public/app.js CREATES the `state-default`
     row on open — so the first ordinary save carries a target the stored document did
     not have, the authority seam correctly reads that as an authority change, and the
     browser puts a `Production authority was not changed` refusal on screen. That
     behaviour is real, reproduces on unmodified main with any project whose entities
     carry a bare `approvedFile`, and belongs to save/load work rather than to this
     slice. Declaring the state here keeps that unrelated dialog out of a fixture whose
     subject is what the shot workspace shows. */
  for (const [list, file] of [["characters", "KAI-ANCHOR.png"], ["locations", "LOC-HULL-PLATE.png"], ["props", "PR-TOOL-PLATE.png"]])
    for (const entity of project[list] || [])
      entity.continuityStates = [{
        id: "state-default", name: "Default", appliesTo: "", approvedFile: entity.approvedFile || file,
        approvedAssetId: "", notes: "Primary approved reference.", isDefault: true,
      }];
  project.promptBuildsById = {
    "build-corr": {
      id: "build-corr",
      packageId: "SH-B-A-CORRECTION-R02",
      kind: "candidate-correction",
      frameId: "frame-a",
      sourceCandidate: BROWSER_FIXTURE.parentB,
      prompt: "CORRECT THE EXISTING FRAME",
      references: [],
      reviewSnapshot: { categories: { composition: { severity: "major", note: "Crop drifted wide." } }, references: [] },
      date: "2026-08-20T10:50:00.000Z",
      revision: 2,
      revisionReason: "candidate-correction",
    },
  };
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(project, null, 2));
  return project;
}

/* The Node half drives the same fixture in memory, so a shape the browser suite relies
   on cannot silently stop existing without this file failing first. */
async function browserFixtureIsTheShapeItClaims() {
  const temp = fs.mkdtempSync(path.join(require("os").tmpdir(), "cinebraid-returned-fixture-"));
  const project = writeBrowserFixture(temp);
  const scan = scanWith(project, {
    "SH-A": [BROWSER_FIXTURE.candidateA],
    "SH-B": [BROWSER_FIXTURE.parentB, BROWSER_FIXTURE.repairB],
  });
  const page = await render("#/shot/SH-A", project, { scan });
  const cardA = cardOf(page.context.document.getElementById("main").innerHTML);
  ok(cardA.returnedReview, "FIXTURE: SH-A opens on its returned candidate");
  equal(cardA.file, BROWSER_FIXTURE.candidateA, "FIXTURE: which is the seeded one");
  equal(cardA.secondaryCode, "confirm-existing-reference", "FIXTURE: with the unconfirmed reference as secondary context");
  const pageB = await render("#/shot/SH-B", project, { scan });
  const cardB = cardOf(pageB.context.document.getElementById("main").innerHTML);
  equal(cardB.file, BROWSER_FIXTURE.repairB, "FIXTURE: SH-B opens on the repair");
  equal(cardB.repair, true, "FIXTURE: declared as a repair");
  ok(cardB.markup.includes(BROWSER_FIXTURE.parentB), "FIXTURE: with its parent on the card");
  fs.rmSync(temp, { recursive: true, force: true });
  note("FIXTURE the project the real-browser half drives is the shape it claims, checked here rather than only in Chromium");
}

/* =========================================================================== */

async function main() {
  rm0_projectionOwnsNothing();
  await rm1_returnedFrameOwnsTheWorkspace();
  await rm4_returnedMotionOwnsReview();
  await rm5_reviewedCandidatesLeaveTheQueue();
  await rm6_orderAndRouting();
  await rm8_failsClosed();
  await rm9_repairLineage();
  await rm10_historyIsDurable();
  await rm11_approvingTheRepair();
  await rm15_integrityOutranksReview();
  await agreement_oneQueueEverywhere();
  await archive_reviewIsNotAStore();
  await browserFixtureIsTheShapeItClaims();

  for (const line of notes) console.log(line);
  console.log(`returned-media-ownership: ${checks} assertions passed`);
}

module.exports = { writeBrowserFixture, BROWSER_FIXTURE };

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

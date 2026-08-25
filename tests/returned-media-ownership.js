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

/* Read out of the shipped surface rather than restated: the four readiness codes that
   claim a shot can move on, which are the only ones an unaccounted-for result refuses. */
const RETURNED_MEDIA_MOVE_ON_CODES = (() => {
  const source = readLF("public/creation-studio.js");
  const line = source.split(String.fromCharCode(10)).find((row) => row.includes("const RETURNED_MEDIA_MOVE_ON_ACTIONS"));
  return line ? [...line.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]) : [];
})();

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
    /* A shot may declare no cast, so a case can have a readiness action that is purely
       about producing rather than about confirming somebody's reference. */
    ...(spec.bare ? { characters: [], codes: [] } : {}),
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
    stale: attribute("data-returned-review-stale") === "1",
    claim: attribute("data-returned-review-claim"),
    claimState: attribute("data-returned-review-claim-state"),
    next: attribute("data-returned-review-next"),
    unavailable: attribute("data-returned-review-unavailable") === "1",
    blocked: attribute("data-returned-review-blocked"),
    primaryCall: (markup.match(/class="assemble-btn shot-primary-action"[^>]*onclick="([^"]*)"/) || [])[1] || "",
    primaryLabel: (markup.match(/class="assemble-btn shot-primary-action"[^>]*>([^<]*)/) || [])[1] || "",
    actionSources: [...markup.matchAll(/data-returned-review-action="([a-z]+)" data-returned-review-action-source="([a-z]+)"/g)].map((m) => [m[1], m[2]]),
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
  equal(acrossSeen.next.href, "#/shot/L1-02/review/path%3Ashots%2FL1-02%2Ftakes%2FL1-02_NEW.png",
    "RM7: through the existing shot route, carrying the candidate it named");
  equal(acrossSeen.next.reviewKey, "path:shots/L1-02/takes/L1-02_NEW.png", "RM7: naming the exact candidate that owns the review");
  const owningPage = await render("#/shot/L1-02", across, {
    scan: scanWith(across, { "L1-01": ["L1-01_OK.png"], "L1-02": ["L1-02_NEW.png"], "L1-03": ["L1-03_NEW.png"] }),
  });
  const owningCard = cardOf(owningPage.context.document.getElementById("main").innerHTML);
  equal(owningCard.key, acrossSeen.next.reviewKey,
    "RM7: and the shot workspace lands on that same candidate — the route and the card cannot disagree");

  note("RM6/7 order comes from declared production facts, and the route and the card resolve the same candidate");
}

/* ===========================================================================
   CR1–CR6 — A PICK SETTLES WHAT IT WAS CHOSEN AMONG, AND NOTHING THAT CAME AFTER.

   THE P0 THE INDEPENDENT REVIEW FOUND, and the reason it mattered: settlement was
   FRAME-WIDE. A repair that came back after the filmmaker had picked its parent reported
   `unit-already-picked`, the queue emptied, and the project said MARK SHOT FINAL — about
   a result nobody had looked at. Money had been spent and CineBraid had quietly decided
   the answer did not need reading.

   Every case below is the same fixture shape with one fact changed, so the rule can be
   read off the table rather than inferred from prose.
   =========================================================================== */

function canonParentProject(spec = {}) {
  return projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A", winner: spec.winner === undefined ? "C1.png" : spec.winner, canon: spec.canon !== false }],
    candidates: [
      candidate("C1.png", { decision: spec.c1Decision || "unreviewed", ...(spec.repair === false ? {} : { correctionResultNames: ["C2.png"] }) }),
      ...(spec.c2 === false ? [] : [candidate("C2.png", {
        addedAt: spec.c2AddedAt || "2026-08-20T11:00:00.000Z",
        decision: spec.c2Decision || "unreviewed",
        ...(spec.repair === false ? {} : { correctionOf: "C1.png", sourceBuildId: "build-corr" }),
      })]),
    ],
  }]);
}
const CANON_SCAN = (project, spec = {}) => scanWith(project, { "L1-01": spec.c2 === false ? ["C1.png"] : ["C1.png", "C2.png"] });

async function cr_pickSettlesOnlyItsOwnAlternates() {
  /* CR1 — C1 PICKED, NO C2. The ordinary case, unchanged. */
  const one = canonParentProject({ c2: false });
  const onePage = await render("#/shot/L1-01", one, { scan: CANON_SCAN(one, { c2: false }) });
  const oneSeen = evaluate(onePage.context, `
    const projection = returnedReviewProjectionForBrowser();
    return { awaiting: projection.counts.awaiting, settled: projection.items.map((row) => row.candidate.name + ":" + (row.settled || "waiting")) };
  `);
  equal(oneSeen.awaiting, 0, "CR1: a picked frame with no later candidate asks for nothing");
  deepEqual(oneSeen.settled, ["C1.png:human-approved"], "CR1: and the picked file reports its own approval");

  /* CR2 — C1 PICKED AND CANON, C2 AN UNDECIDED REPAIR. The reproduction. */
  const two = canonParentProject();
  const twoPage = await render("#/shot/L1-01", two, { scan: CANON_SCAN(two) });
  const twoSeen = evaluate(twoPage.context, `
    const projection = returnedReviewProjectionForBrowser();
    return {
      awaiting: projection.counts.awaiting,
      queue: projection.queue.map((row) => row.candidate.name),
      canon: hasCurrentHumanAuthority(P, { kind: "shot-frame", shotId: "L1-01", frameId: "frame-a" }),
      canonFile: P.shots[0].keyframes[0].winner || "",
      settled: projection.items.map((row) => row.candidate.name + ":" + (row.settled || "waiting")),
      next: projectNextProductionAction(),
    };
  `);
  equal(twoSeen.canon, true, "CR2: the parent holds Canon");
  equal(twoSeen.canonFile, "C1.png", "CR2: and Canon does not move because a repair came back");
  equal(twoSeen.awaiting, 1, "CR2: the undecided repair is still a returned review");
  deepEqual(twoSeen.queue, ["C2.png"], "CR2: and it is the repair, not the picked parent");
  deepEqual(twoSeen.settled, ["C2.png:waiting", "C1.png:human-approved"],
    "CR2: each candidate reports its own reason, and the pick settles only itself");
  equal(twoSeen.next.kind, "returned-result", "CR2: Production routes to the review");
  equal(twoSeen.next.reviewKey, "path:shots/L1-01/takes/C2.png", "CR2: naming the repair");
  ok(!/MARK SHOT FINAL/.test(twoSeen.next.actionLabel), "CR2: and never offers to finish the shot over it: " + twoSeen.next.actionLabel);
  const twoCard = cardOf(twoPage.context.document.getElementById("main").innerHTML);
  ok(twoCard.returnedReview && twoCard.file === "C2.png", "CR2: and the shot workspace opens on the repair");

  /* CR3 — C2 REJECTED. Its own decision settles it; Canon is untouched. */
  const three = canonParentProject({ c2Decision: "rejected" });
  const threePage = await render("#/shot/L1-01", three, { scan: CANON_SCAN(three) });
  const threeSeen = evaluate(threePage.context, `
    const projection = returnedReviewProjectionForBrowser();
    return {
      awaiting: projection.counts.awaiting,
      settled: projection.items.map((row) => row.candidate.name + ":" + (row.settled || "waiting")),
      canonFile: P.shots[0].keyframes[0].winner || "",
    };
  `);
  equal(threeSeen.awaiting, 0, "CR3: a rejected repair asks for nothing");
  deepEqual(threeSeen.settled, ["C2.png:human-rejected", "C1.png:human-approved"], "CR3: by its own decision, not the pick");
  equal(threeSeen.canonFile, "C1.png", "CR3: and Canon remains the parent");

  /* CR4 — C2 APPROVED THROUGH THE SHIPPED CONTROL. Existing authority decides Canon. */
  const four = canonParentProject();
  const fourPage = await render("#/shot/L1-01", four, { scan: CANON_SCAN(four) });
  fourPage.context.approveGuidedFrame("L1-01", "frame-a", "C2.png");
  fourPage.context.document.getElementById("approve-name").value = "C2.png";
  await fourPage.gesture.act(() => fourPage.context.confirmApproveTake());
  await new Promise((resolve) => setTimeout(resolve, 20));
  const fourSeen = evaluate(fourPage.context, `
    const projection = returnedReviewProjectionForBrowser();
    return {
      awaiting: projection.counts.awaiting,
      receipts: (P.productionAuthority.receipts || []).filter((row) => row.kind === "shot-frame" && row.status === "current").map((row) => row.value),
      settled: projection.items.map((row) => row.candidate.name + ":" + (row.settled || "waiting")),
    };
  `);
  deepEqual(fourSeen.receipts, ["C2.png"], "CR4: approving the repair moves Canon through the shipped receipt");
  equal(fourSeen.awaiting, 0, "CR4: and nothing is left waiting");
  ok(fourSeen.settled.includes("C2.png:human-approved"), "CR4: the repair reports its own approval");

  /* CR5 — THE PARENT WAS NEVER PICKED. Nothing settles anything. */
  const five = canonParentProject({ winner: "", c1Decision: "rejected" });
  const fivePage = await render("#/shot/L1-01", five, { scan: CANON_SCAN(five) });
  const fiveSeen = evaluate(fivePage.context, `
    const projection = returnedReviewProjectionForBrowser();
    return { queue: projection.queue.map((row) => row.candidate.name), settled: projection.items.map((row) => row.candidate.name + ":" + (row.settled || "waiting")) };
  `);
  deepEqual(fiveSeen.queue, ["C2.png"], "CR5: an undecided repair of a rejected parent is pending");
  ok(fiveSeen.settled.includes("C1.png:human-rejected"), "CR5: and the parent keeps its own rejection");

  /* CR6 — TWO UNRELATED CANDIDATES, ONE PICKED, ONE GENUINELY RETURNED AFTERWARDS.
     No lineage links them, so only chronology can tell them apart — and it must. */
  const six = projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A", winner: "PICKED.png" }],
    candidates: [
      candidate("PICKED.png", { addedAt: "2026-08-20T10:00:00.000Z" }),
      candidate("ALTERNATE.png", { addedAt: "2026-08-20T10:00:00.000Z" }),
      candidate("LATER.png", { addedAt: "2026-08-21T09:00:00.000Z" }),
    ],
  }]);
  const sixPage = await render("#/shot/L1-01", six, { scan: scanWith(six, { "L1-01": ["PICKED.png", "ALTERNATE.png", "LATER.png"] }) });
  const sixSeen = evaluate(sixPage.context, `
    const projection = returnedReviewProjectionForBrowser();
    return { queue: projection.queue.map((row) => row.candidate.name), settled: projection.items.map((row) => row.candidate.name + ":" + (row.settled || "waiting")) };
  `);
  deepEqual(sixSeen.queue, ["LATER.png"], "CR6: only the candidate that arrived after the pick is still a review");
  ok(sixSeen.settled.includes("ALTERNATE.png:unit-already-picked"),
    "CR6: the alternate the pick was chosen over is settled by it, exactly as before");
  ok(sixSeen.settled.includes("PICKED.png:human-approved"), "CR6: and the picked file reports its own approval");

  /* AND A LEGACY ALTERNATE WITH NO TIMESTAMP IS STILL SETTLED. The new pending state
     appears only when the record positively shows the candidate came later; defaulting
     the other way would put every old project's discarded takes back on screen. */
  const legacy = projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A", winner: "PICKED.png" }],
    candidates: [
      { stored: "PICKED.png", original: "PICKED.png", decision: "unreviewed", notes: "", labels: [], frameId: "frame-a" },
      { stored: "OLD.png", original: "OLD.png", decision: "unreviewed", notes: "", labels: [], frameId: "frame-a" },
    ],
  }]);
  const legacyPage = await render("#/shot/L1-01", legacy, { scan: scanWith(legacy, { "L1-01": ["PICKED.png", "OLD.png"] }) });
  const legacySeen = evaluate(legacyPage.context, `return returnedReviewProjectionForBrowser().counts.awaiting;`);
  equal(legacySeen, 0, "CR: an untimestamped legacy alternate stays settled by the pick");

  note("CR1-6 a pick settles the alternates it was chosen over and nothing that arrived afterwards; lineage first, chronology second, and a legacy alternate is unaffected");
}

/* ===========================================================================
   RM8 — FAIL CLOSED.
   =========================================================================== */

async function rm8_failsClosed() {
  /* A candidate ROW whose file is not in the scan claims NO REVIEW — nothing can be
     approved, rejected or revised about bytes that are not there — but it does not
     vanish either. See MF1-MF6 for why that distinction is a P0. */
  const stale = projectOf([{ id: "L1-01", candidates: [candidate("GONE.png"), candidate("HERE.png", { addedAt: "2026-08-20T10:05:00.000Z" })] }]);
  const stalePage = await render("#/shot/L1-01", stale, { scan: scanWith(stale, { "L1-01": ["HERE.png"] }) });
  const staleSeen = evaluate(stalePage.context, QUEUE_EXPR);
  deepEqual(staleSeen.queue.map((row) => row.file), ["HERE.png"], "RM8: a candidate row with no file on disk is not in the review queue");
  ok(!staleSeen.queue.some((row) => row.file === "GONE.png"), "RM8: and no review action is offered for it");

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
   SR1–SR6 — A ROUTE THAT CLAIMS A CANDIDATE MUST FAIL CLOSED WHEN THE CLAIM IS STALE.

   THE SECOND P0. Production named candidate A and navigated to `#/shot/S`. If A was
   decided in between, the workspace re-derived and presented candidate B — a different
   image and a different decision — under an action that had said A, with nothing on
   screen to say so. The next decision the filmmaker took would have been about a file
   they never asked to see.

   The repair carries the claim in the route. These cases are about what happens when the
   claim is true, when it is stale, when it names nothing, and when there is no claim at
   all — because the last of those is ordinary navigation and must not change.
   =========================================================================== */

async function sr_staleRouteClaims() {
  const twoCandidates = () => projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A" }, { id: "frame-b", label: "B" }],
    candidates: [candidate("A.png"), candidate("B.png", { frameId: "frame-b", addedAt: "2026-08-20T10:05:00.000Z" })],
  }]);
  const SCAN = (project) => scanWith(project, { "L1-01": ["A.png", "B.png"] });
  const keyOf = (name) => `path:shots/L1-01/takes/${name}`;
  const route = (name) => `#/shot/L1-01/review/${encodeURIComponent(keyOf(name))}`;

  /* THE MECHANISM ITSELF, before any behaviour: the claim survives the hash and the id
     does not change, which is why nothing else in the product had to learn about it. */
  const parsing = await render("#/production", twoCandidates(), { scan: SCAN(twoCandidates()) });
  const parsed = evaluate(parsing.context, `
    const hash = "#/shot/L1-01/review/" + encodeURIComponent("path:shots/L1-01/takes/A.png");
    return {
      claim: routeReviewClaim(hash),
      view: hash.split("/")[1],
      id: decodeURIComponent(hash.split("/")[2] || ""),
      parts: hash.split("/").length,
      plain: routeReviewClaim("#/shot/L1-01"),
      built: shotReviewHref("L1-01", "path:shots/L1-01/takes/A.png"),
    };
  `);
  equal(parsed.claim, keyOf("A.png"), "SR: the route carries the candidate identity");
  equal(parsed.view, "shot", "SR: while the view every other hash reader parses is unchanged");
  equal(parsed.id, "L1-01", "SR: and so is the shot id");
  equal(parsed.parts, 5, "SR: the key is encoded, so it adds no segments of its own");
  equal(parsed.plain, "", "SR: a plain shot route claims nothing");
  equal(parsed.built, route("A.png"), "SR: and one builder makes the link Production uses");

  /* SR1 — THE CLAIM IS STILL TRUE. */
  const live = twoCandidates();
  const livePage = await render(route("A.png"), live, { scan: SCAN(live) });
  const liveCard = cardOf(livePage.context.document.getElementById("main").innerHTML);
  ok(liveCard.returnedReview, "SR1: an honoured claim renders the review");
  equal(liveCard.file, "A.png", "SR1: of the candidate the route named");

  /* AND A CLAIM ON A CANDIDATE THAT IS NOT THE HEAD OF THE QUEUE IS STILL HONOURED — the
     route is the authority on WHICH review this is, not the queue order. */
  const second = twoCandidates();
  const secondPage = await render(route("B.png"), second, { scan: SCAN(second) });
  equal(cardOf(secondPage.context.document.getElementById("main").innerHTML).file, "B.png",
    "SR1: a claim on the second pending candidate opens that one, not the first");

  /* SR2 — A SETTLES BEFORE THE ROUTE OPENS, B IS STILL PENDING. The defect exactly. */
  const settled = twoCandidates();
  settled.shots[0].candidateFiles[0].decision = "rejected";
  const settledPage = await render(route("A.png"), settled, { scan: SCAN(settled) });
  const settledHtml = settledPage.context.document.getElementById("main").innerHTML;
  const staleCard = cardOf(settledHtml);
  const staleSeen = evaluate(settledPage.context, `
    const projection = returnedReviewProjectionForBrowser();
    return { pending: projection.queue.map((row) => row.candidate.name) };
  `);
  deepEqual(staleSeen.pending, ["B.png"], "SR2: precondition — B is genuinely pending");
  equal(staleCard.returnedReview, false, "SR2: the workspace does not present a review it was not asked for");
  equal(staleCard.stale, true, "SR2: it says the claim is stale");
  equal(staleCard.claimState, "human-rejected", "SR2: and what happened to the candidate that was claimed");
  ok(/already been reviewed/i.test(staleCard.headline), "SR2: in words: " + staleCard.headline);
  ok(/A\.png was the result this link was for/.test(staleCard.markup), "SR2: naming A rather than B");
  ok(/Nothing has been applied/.test(staleCard.markup), "SR2: and saying nothing was applied to anything else");
  ok(!/data-returned-review-action=/.test(staleCard.markup), "SR2: no candidate decision is offered on a stale card");
  /* CONTINUING IS EXPLICIT, and it claims B by name the same way Production does. */
  equal(staleCard.next, keyOf("B.png"), "SR2: the pending review is named");
  ok(staleCard.primaryCall.includes(encodeURIComponent(keyOf("B.png"))),
    "SR2: and continuing to it is a fresh navigation that claims it: " + staleCard.primaryCall);
  ok(/Review the next returned result/.test(staleCard.primaryLabel), "SR2: labelled as a new act");
  equal(primaryCount(settledHtml), 1, "SR2: still exactly one primary action");

  /* SR3 — THE CLAIMED CANDIDATE IS GONE ENTIRELY. */
  const missing = twoCandidates();
  const missingPage = await render(`#/shot/L1-01/review/${encodeURIComponent("path:shots/L1-01/takes/NEVER.png")}`, missing, { scan: SCAN(missing) });
  const missingCard = cardOf(missingPage.context.document.getElementById("main").innerHTML);
  equal(missingCard.stale, true, "SR3: a claim naming nothing is stale, not silently replaced");
  equal(missingCard.claimState, "not-found", "SR3: reported as not found");
  ok(/no longer in this project/.test(missingCard.markup), "SR3: in words");
  ok(!missingCard.returnedReview, "SR3: and no review is substituted for it");

  /* SR4 — A FRESH PRODUCTION ACTION FOR B ROUTES TO B. */
  const fresh = twoCandidates();
  fresh.shots[0].candidateFiles[0].decision = "rejected";
  const freshPage = await render("#/production", fresh, { scan: SCAN(fresh) });
  const freshNext = evaluate(freshPage.context, `return projectNextProductionAction();`);
  equal(freshNext.reviewKey, keyOf("B.png"), "SR4: the next Production action names B");
  equal(freshNext.href, route("B.png"), "SR4: and routes to it");
  const freshShot = await render(freshNext.href, fresh, { scan: SCAN(fresh) });
  const freshCard = cardOf(freshShot.context.document.getElementById("main").innerHTML);
  ok(freshCard.returnedReview && freshCard.file === "B.png", "SR4: which opens B's review");

  /* SR5 — A MALFORMED CLAIM FAILS CLOSED. */
  for (const bad of ["%%%", "not-a-key", "asset:deadbeef"]) {
    const project = twoCandidates();
    const page = await render(`#/shot/L1-01/review/${bad}`, project, { scan: SCAN(project) });
    const card = cardOf(page.context.document.getElementById("main").innerHTML);
    equal(card.stale, true, `SR5: ${bad} is refused as a stale claim`);
    ok(!card.returnedReview, `SR5: ${bad} substitutes no review`);
  }
  /* AND A KEY THAT BELONGS TO A DIFFERENT SHOT IS AS STALE AS A DECIDED ONE. */
  const crossed = twoCandidates();
  const crossedPage = await render(`#/shot/L1-01/review/${encodeURIComponent("path:shots/L1-02/takes/A.png")}`, crossed, { scan: SCAN(crossed) });
  ok(cardOf(crossedPage.context.document.getElementById("main").innerHTML).stale,
    "SR5: a key from another shot's queue is refused here");

  /* SR6 — ORDINARY NAVIGATION IS UNCHANGED. */
  const plain = twoCandidates();
  const plainPage = await render("#/shot/L1-01", plain, { scan: SCAN(plain) });
  const plainCard = cardOf(plainPage.context.document.getElementById("main").innerHTML);
  ok(plainCard.returnedReview, "SR6: a route with no claim resolves the shot's current pending review");
  equal(plainCard.file, "A.png", "SR6: which is the head of the queue");
  equal(plainCard.stale, false, "SR6: and is not a stale state");

  note("SR1-6 the route carries the candidate it names, an honoured claim opens it, a stale one explains itself and substitutes nothing, and plain navigation is untouched");
}

/* ===========================================================================
   MF1–MF6 — A RECORDED RESULT WITH NO BYTES IS AN INTEGRITY STATE.

   THE THIRD P0. The projection built everything from the media answer, which is built
   from the scan, so a candidate row the project still recorded as undecided whose file
   had gone produced no record and disappeared. The shot then read as having nothing
   outstanding, and Production and the workspace both promoted PRODUCE THE FRAME —
   CineBraid offering to spend money because it had lost track of something it had.
   =========================================================================== */

async function mf_missingReturnedMedia() {
  const withRow = (extra = {}) => projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A" }],
    candidates: [candidate("GONE.png", extra)],
  }]);

  /* MF1 — THE FILE IS THERE. Ordinary pending review, unchanged. */
  const present = withRow();
  const presentPage = await render("#/shot/L1-01", present, { scan: scanWith(present, { "L1-01": ["GONE.png"] }) });
  const presentSeen = evaluate(presentPage.context, `
    const p = returnedReviewProjectionForBrowser();
    return { awaiting: p.counts.awaiting, unavailable: p.counts.unavailable };
  `);
  equal(presentSeen.awaiting, 1, "MF1: a present file is an ordinary pending review");
  equal(presentSeen.unavailable, 0, "MF1: and nothing is blocking");

  /* MF2 — THE FILE IS GONE AND THE ROW IS UNDECIDED. */
  const gone = withRow();
  const gonePage = await render("#/shot/L1-01", gone, { scan: scanWith(gone, { "L1-01": [] }) });
  const goneHtml = gonePage.context.document.getElementById("main").innerHTML;
  const goneCard = cardOf(goneHtml);
  const goneSeen = evaluate(gonePage.context, `
    const p = returnedReviewProjectionForBrowser();
    return {
      awaiting: p.counts.awaiting,
      unavailable: p.counts.unavailable,
      blockers: p.blockers.map((row) => row.candidate.name + ":" + row.unreviewable + ":" + row.blocking),
      actions: p.blockers.map((row) => row.actions.length + row.workflows.length),
      readiness: shotReadinessFor(shotById("L1-01")).nextAction.code,
      next: projectNextProductionAction(),
    };
  `);
  equal(goneSeen.readiness, "produce-frame", "MF2: precondition — readiness would have said produce another frame");
  equal(goneSeen.awaiting, 0, "MF2: no phantom review is offered on media nobody can see");
  equal(goneSeen.unavailable, 1, "MF2: but the record does not disappear");
  deepEqual(goneSeen.blockers, ["GONE.png:media-not-available:true"], "MF2: it is reported as a blocking integrity condition");
  deepEqual(goneSeen.actions, [0], "MF2: with no action of any kind, because there is nothing to judge");
  /* AND NEITHER SURFACE PROMOTES A GENERATION. */
  equal(goneSeen.next.kind, "returned-media-unavailable", "MF2: Production names the integrity condition");
  ok(!/produce/i.test(goneSeen.next.actionLabel), "MF2: and never says produce: " + goneSeen.next.actionLabel);
  equal(goneCard.unavailable, true, "MF2: the shot workspace card is the integrity state");
  ok(/file is missing/i.test(goneCard.headline), "MF2: in words: " + goneCard.headline);
  ok(/GONE\.png/.test(goneCard.markup), "MF2: naming the result it cannot show");
  ok(!/produce/i.test(goneCard.primaryLabel), "MF2: and its primary action is not a generation: " + goneCard.primaryLabel);
  ok(!/data-returned-review-action=/.test(goneCard.markup), "MF2: with no candidate decision offered");
  equal(primaryCount(goneHtml), 1, "MF2: exactly one primary action");
  /* The readiness action is still there, secondary, exactly as on the review card. */
  equal(goneCard.secondaryCode, "produce-frame", "MF2: the readiness action survives as secondary context");

  /* MF2b — AND IT DISPLACES A MOVE-ON ACTION AND NOTHING ELSE.
     The harm named was PRODUCE THE FRAME promoted because the media vanished. Every other
     readiness action is real outstanding work, and burying THAT behind an integrity notice
     would be the identical defect pointing the other way — so the readiness action keeps
     the card and the integrity condition is stated on it. */
  const outstanding = projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A" }],
    candidates: [candidate("GONE.png")],
  }], { canon: CAST_CANON.filter((row) => row.entityId !== "KAI") });
  const outstandingPage = await render("#/shot/L1-01", outstanding, { scan: scanWith(outstanding, { "L1-01": [] }) });
  const outstandingHtml = outstandingPage.context.document.getElementById("main").innerHTML;
  const outstandingCard = cardOf(outstandingHtml);
  const outstandingSeen = evaluate(outstandingPage.context, `
    const p = returnedReviewProjectionForBrowser();
    return { unavailable: p.counts.unavailable, readiness: shotReadinessFor(shotById("L1-01")).nextAction.code };
  `);
  equal(outstandingSeen.readiness, "confirm-existing-reference", "MF2b: precondition — the shot has real outstanding work");
  equal(outstandingSeen.unavailable, 1, "MF2b: and a returned result it cannot show");
  equal(outstandingCard.unavailable, false, "MF2b: the real work keeps the card");
  ok(/Confirm existing reference/.test(outstandingCard.headline), "MF2b: as the headline: " + outstandingCard.headline);
  ok(/cannot be shown/.test(outstandingCard.markup), "MF2b: while the integrity condition is stated on it");
  equal(outstandingCard.blocked, "1", "MF2b: with its count");
  equal(primaryCount(outstandingHtml), 1, "MF2b: exactly one primary action");
  for (const code of ["mark-shot-final", "nothing-outstanding", "produce-motion"])
    ok(RETURNED_MEDIA_MOVE_ON_CODES.includes(code), `MF2b: ${code} is declared a move-on action`);

  /* MF3 — THE FILE COMES BACK. Derived, so it simply resumes. */
  const restored = withRow();
  const restoredPage = await render("#/shot/L1-01", restored, { scan: scanWith(restored, { "L1-01": ["GONE.png"] }) });
  const restoredSeen = evaluate(restoredPage.context, `
    const p = returnedReviewProjectionForBrowser();
    return { awaiting: p.counts.awaiting, unavailable: p.counts.unavailable };
  `);
  equal(restoredSeen.awaiting, 1, "MF3: ordinary review resumes when the media is resolvable again");
  equal(restoredSeen.unavailable, 0, "MF3: and the blocker is gone, because it was derived rather than stored");

  /* MF4 — THE ROW WAS ALREADY DISPOSED OF. Historical media going missing is ordinary. */
  for (const decision of ["rejected", "shortlist"]) {
    const disposed = withRow({ decision });
    const disposedPage = await render("#/shot/L1-01", disposed, { scan: scanWith(disposed, { "L1-01": [] }) });
    const disposedSeen = evaluate(disposedPage.context, `
      const p = returnedReviewProjectionForBrowser();
      return { unavailable: p.counts.unavailable, next: projectNextProductionAction().kind };
    `);
    equal(disposedSeen.unavailable, 0, `MF4: a ${decision} row whose media is gone raises no blocker`);
    ok(disposedSeen.next !== "returned-media-unavailable", `MF4: and Production does not name one for it`);
  }

  /* MF5 — THE FRAME ITSELF WAS REMOVED. The missing UNIT is the more specific fact, and
     the two reasons stay distinguishable. */
  const undeclared = projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A" }],
    candidates: [candidate("ORPHAN.png", { frameId: "frame-deleted" })],
  }]);
  const undeclaredPage = await render("#/shot/L1-01", undeclared, { scan: scanWith(undeclared, { "L1-01": [] }) });
  const undeclaredSeen = evaluate(undeclaredPage.context, `
    const p = returnedReviewProjectionForBrowser();
    return { reasons: p.items.map((row) => row.candidate.name + ":" + row.unreviewable + ":" + row.blocking + ":" + row.mediaAvailable), unavailable: p.counts.unavailable };
  `);
  deepEqual(undeclaredSeen.reasons, ["ORPHAN.png:frame-no-longer-declared:false:false"],
    "MF5: a row for a frame the shot no longer declares reports THAT, and does not block");
  equal(undeclaredSeen.unavailable, 0, "MF5: an undeclared unit is not a missing-media integrity condition");
  /* And with the frame still declared, the same file missing reports the other reason —
     which is what makes them distinguishable rather than one token doing both jobs. */
  const declaredButGone = withRow();
  const declaredPage = await render("#/shot/L1-01", declaredButGone, { scan: scanWith(declaredButGone, { "L1-01": [] }) });
  const declaredSeen = evaluate(declaredPage.context, `
    return returnedReviewProjectionForBrowser().items.map((row) => row.unreviewable + ":" + row.mediaAvailable);
  `);
  deepEqual(declaredSeen, ["media-not-available:false"], "MF5: while a declared frame with missing bytes reports the other");

  /* MF6 — A BLOCKER BESIDE A REVIEWABLE RESULT. Existing priority is preserved: work a
     filmmaker can actually do comes first, and the project repair still outranks both. */
  const both = projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A" }, { id: "frame-b", label: "B" }],
    candidates: [candidate("GONE.png"), candidate("HERE.png", { frameId: "frame-b", addedAt: "2026-08-20T10:05:00.000Z" })],
  }]);
  const bothPage = await render("#/shot/L1-01", both, { scan: scanWith(both, { "L1-01": ["HERE.png"] }) });
  const bothCard = cardOf(bothPage.context.document.getElementById("main").innerHTML);
  const bothSeen = evaluate(bothPage.context, `
    const p = returnedReviewProjectionForBrowser();
    return { awaiting: p.counts.awaiting, unavailable: p.counts.unavailable, next: projectNextProductionAction().kind };
  `);
  equal(bothSeen.awaiting, 1, "MF6: the reviewable result is still a review");
  equal(bothSeen.unavailable, 1, "MF6: and the blocker is still reported");
  equal(bothSeen.next.length > 0 && bothSeen.next, "returned-result", "MF6: the actionable review is offered first");
  ok(bothCard.returnedReview, "MF6: and the shot workspace opens on it");
  ok(/cannot be shown/.test(bothCard.markup), "MF6: while still naming the result it cannot show");
  /* THE PROJECT REPAIR STILL OUTRANKS BOTH. */
  const corrupt = withRow();
  corrupt.productionAuthority.receipts[0].command = "not-a-command";
  const corruptPage = await render("#/production", corrupt, { scan: scanWith(corrupt, { "L1-01": [] }) });
  const corruptSeen = evaluate(corruptPage.context, `
    const feed = projectShotReadiness();
    return { trusted: feed.authority.trusted, kind: projectNextProductionAction(feed).kind };
  `);
  equal(corruptSeen.trusted, false, "MF6: precondition — the ledger cannot be read");
  equal(corruptSeen.kind, "repair", "MF6: and the project repair still outranks the missing-media condition");

  note("MF1-6 a recorded result with no bytes is reported, blocks, offers no action and never lets Produce take the first line; a disposed row and an undeclared unit are distinguished from it");
}

/* ===========================================================================
   HM1–HM10 — MISSING BYTES DO NOT RESURRECT A SETTLED CANDIDATE.

   THE P0 THE SECOND INDEPENDENT REVIEW FOUND, and it is the mirror image of MF1-MF6.
   That pass made a returned result the project could not show stop disappearing. This
   pass makes it stop appearing when the project has ALREADY DECIDED about it.

   The synthetic path asked two string checks — `rejected` and `shortlist` — where the
   media-present path asks the full candidate-specific question. So the moment somebody
   cleaned up an old file, a candidate that had been picked, or that a later approval had
   superseded, came back as a CURRENT integrity blocker: a settled decision resurrected as
   outstanding work, and Production reporting it as the thing to do next.

   The repair is one predicate. candidateSettlement() is asked by both paths with the same
   inputs — the candidate's own decision, then the unit's pick, then that unit's lineage —
   and the paths differ only in where the facts come from: production-media's record when
   the file is there, the durable candidate row plus P4's shotMediaDisposition() when it
   is not. They cannot drift apart again without the shared function moving.
   =========================================================================== */

const HM_SCAN = (project, takes) => scanWith(project, { "L1-01": takes });
function hmProject(spec) {
  const project = projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A", winner: spec.winner || "", canon: spec.canon !== false }],
    candidates: spec.candidates,
  }]);
  if (spec.records) project.shots[0].generationRecords = spec.records;
  return project;
}
const HM_READ = `
  const projection = returnedReviewProjectionForBrowser();
  return {
    blockers: projection.blockers.map((row) => row.candidate.name + ":" + row.unreviewable),
    unavailable: projection.counts.unavailable,
    items: projection.items.map((row) => row.candidate.name + ":" + (row.settled || "waiting") + ":" + (row.blocking ? "blocking" : "-")),
    queue: projection.queue.map((row) => row.candidate.name),
    winner: P.shots[0].keyframes[0].winner || "",
    canon: hasCurrentHumanAuthority(P, { kind: "shot-frame", shotId: "L1-01", frameId: "frame-a" }),
    next: projectNextProductionAction(),
  };
`;
async function hmSeen(spec, takes) {
  const project = hmProject(spec);
  const page = await render("#/shot/L1-01", project, { scan: HM_SCAN(project, takes) });
  return { seen: evaluate(page.context, HM_READ), card: cardOf(page.context.document.getElementById("main").innerHTML), page };
}

async function hm_settledMissingMediaIsNotCurrentWork() {
  /* HM1 — GENUINELY UNSETTLED AND MISSING. The MF2 behaviour, unchanged: this is the one
     case that MUST still block, and it is checked first so the repair cannot be a blanket
     removal of the blocker. */
  const one = await hmSeen({ candidates: [candidate("GONE.png")] }, []);
  deepEqual(one.seen.blockers, ["GONE.png:media-not-available"], "HM1: an undecided returned result with no bytes still blocks");
  equal(one.seen.unavailable, 1, "HM1: and is counted");
  equal(one.card.unavailable, true, "HM1: and the workspace still renders the integrity state");

  /* HM2 / HM3 — ALREADY DISPOSED OF. Its media being gone is ordinary history. */
  for (const [decision, label] of [["rejected", "HM2"], ["shortlist", "HM3"]]) {
    const seen = await hmSeen({ candidates: [candidate("GONE.png", { decision })] }, []);
    deepEqual(seen.seen.blockers, [], `${label}: a ${decision} row whose media is gone raises no current blocker`);
    equal(seen.seen.unavailable, 0, `${label}: and is not counted as unaccounted-for work`);
    ok(seen.seen.next.kind !== "returned-media-unavailable", `${label}: Production names no integrity condition for it`);
  }

  /* HM4 — THE PICK'S OWN BYTES ARE GONE. An approval edge still names the file, so the
     candidate is settled by that edge. Whether the edge came from a person, from
     automation or from a legacy pointer is NOT asserted here — that distinction needs the
     media record, and guessing at it is what the machine-selected repair exists to stop. */
  const picked = await hmSeen({ winner: "C1.png", candidates: [candidate("C1.png")] }, []);
  deepEqual(picked.seen.blockers, [], "HM4: a picked candidate whose media is gone is not current work");
  equal(picked.seen.unavailable, 0, "HM4: and raises no integrity blocker");
  equal(picked.seen.winner, "C1.png", "HM4: the pick itself is untouched");
  equal(picked.card.unavailable, false, "HM4: and the workspace shows no missing-media card");

  /* HM5 — THE REPRODUCTION. C1 was picked, C2 later became current, and C1's historical
     file is removed. C1 is history; the project's current truth is C2. */
  const superseded = await hmSeen({
    winner: "C2.png",
    candidates: [candidate("C1.png"), candidate("C2.png", { addedAt: "2026-08-20T11:00:00.000Z" })],
  }, ["C2.png"]);
  deepEqual(superseded.seen.blockers, [], "HM5: the superseded historical candidate raises no current blocker");
  equal(superseded.seen.unavailable, 0, "HM5: and is not counted");
  ok(!superseded.seen.items.some((row) => row.startsWith("C1.png")),
    "HM5: it is not resurrected into the projection at all: " + superseded.seen.items.join(", "));
  deepEqual(superseded.seen.items, ["C2.png:human-approved:-"], "HM5: current production truth remains C2");
  equal(superseded.seen.winner, "C2.png", "HM5: the pick is C2");
  equal(superseded.seen.canon, true, "HM5: and it holds Canon");
  ok(superseded.seen.next.kind !== "returned-media-unavailable",
    "HM5: Production does not report a returned result that was decided long ago: " + superseded.seen.next.kind);
  equal(superseded.card.unavailable, false, "HM5: and neither does the shot workspace");

  /* HM6 — A MACHINE-SELECTED PICK whose media is gone. No bogus blocker, and the label
     itself is untouched: with the bytes present the same fixture still reports
     `machine-selected`, which is the truth this must not overwrite. */
  const machineSpec = { winner: "AUTO.png", candidates: [candidate("AUTO.png")], records: [{ file: "AUTO.png", approval: "automatic" }] };
  const machineGone = await hmSeen(machineSpec, []);
  deepEqual(machineGone.seen.blockers, [], "HM6: a machine-selected pick whose media is gone raises no current blocker");
  ok(!machineGone.seen.items.some((row) => /human-approved/.test(row)),
    "HM6: and nothing claims a person approved it: " + machineGone.seen.items.join(", "));
  const machinePresent = await hmSeen(machineSpec, ["AUTO.png"]);
  deepEqual(machinePresent.seen.items, ["AUTO.png:machine-selected:-"],
    "HM6: while with the bytes present the machine-selected label is exactly as it was");

  /* HM7 — AN UNDECIDED REPAIR whose own bytes are gone. Still unresolved, so it still
     blocks — and Canon does not move because of it. This is the case a blanket
     "anything missing is history" rule would have broken. */
  const repairGone = await hmSeen({
    winner: "C1.png",
    candidates: [candidate("C1.png"), candidate("C2.png", { addedAt: "2026-08-20T11:00:00.000Z", correctionOf: "C1.png" })],
  }, ["C1.png"]);
  deepEqual(repairGone.seen.blockers, ["C2.png:media-not-available"], "HM7: an undecided repair with no bytes is still unresolved");
  equal(repairGone.seen.unavailable, 1, "HM7: and still blocks");
  equal(repairGone.seen.winner, "C1.png", "HM7: while Canon stays where it was");
  equal(repairGone.seen.canon, true, "HM7: and stays approved");
  ok(repairGone.seen.items.includes("C1.png:human-approved:-"), "HM7: the parent keeps its own settled reason");

  /* AND THE LINEAGE HALF OF THAT DECISION WORKS FOR A MISSING FILE TOO. With no
     timestamps at all, the only thing that can tell the repair apart from an alternate is
     `correction-of` — and a row with no media record has to be able to carry it. */
  const untimed = await hmSeen({
    winner: "C1.png",
    candidates: [
      { stored: "C1.png", original: "C1.png", decision: "unreviewed", notes: "", labels: [], frameId: "frame-a" },
      { stored: "C2.png", original: "C2.png", decision: "unreviewed", notes: "", labels: [], frameId: "frame-a", correctionOf: "C1.png" },
    ],
  }, ["C1.png"]);
  deepEqual(untimed.seen.blockers, ["C2.png:media-not-available"],
    "HM7: an untimestamped repair of the pick is still recognised, from lineage alone");

  /* HM8 — A SETTLED MISSING FILE BESIDE A LEGITIMATE CURRENT REVIEW. The historical one
     must neither block nor displace the review a filmmaker can actually do. */
  const beside = await hmSeen({
    winner: "C2.png",
    candidates: [
      candidate("C1.png"),
      candidate("C2.png", { addedAt: "2026-08-20T11:00:00.000Z" }),
      candidate("NEW.png", { addedAt: "2026-08-21T09:00:00.000Z" }),
    ],
  }, ["C2.png", "NEW.png"]);
  deepEqual(beside.seen.blockers, [], "HM8: the settled historical file raises no blocker");
  deepEqual(beside.seen.queue, ["NEW.png"], "HM8: and the genuine current review is untouched");
  equal(beside.seen.next.kind, "returned-result", "HM8: which is what Production offers");
  ok(beside.card.returnedReview && beside.card.file === "NEW.png",
    "HM8: and what the shot workspace opens on: " + beside.card.file);

  /* HM9 — SETTLED, MISSING, AND NOTHING ELSE OUTSTANDING. It must not be promoted into
     current work by being the only thing left. */
  ok(!picked.card.returnedReview, "HM9: a settled missing candidate is not offered as a review");
  equal(picked.seen.queue.length, 0, "HM9: and is in no queue");
  ok(!/media-not-available/.test(picked.card.markup), "HM9: with no integrity notice raised for it");
  ok(picked.seen.next.kind !== "returned-media-unavailable",
    "HM9: and Production moves on to real work instead: " + picked.seen.next.kind);

  /* HM10 — AND THE UNDECLARED-UNIT DISTINCTION IS UNCHANGED. A row whose frame the shot
     no longer declares still reports THAT, and still does not block. */
  const orphan = await hmSeen({ candidates: [{ ...candidate("ORPHAN.png"), frameId: "frame-deleted" }] }, []);
  deepEqual(orphan.seen.items, ["ORPHAN.png:waiting:-"], "HM10: an undeclared unit is reported and does not block");
  deepEqual(orphan.seen.blockers, [], "HM10: it is not a missing-media integrity condition");
  const orphanReason = evaluate(orphan.page.context, `return returnedReviewProjectionForBrowser().items.map((row) => row.unreviewable);`);
  deepEqual(orphanReason, ["frame-no-longer-declared"], "HM10: and keeps its own distinct reason");

  /* AND THE TWO PATHS ASK ONE FUNCTION, structurally. A future edit that gives the
     missing-media path a settlement rule of its own has to delete this call to do it. */
  const source = codeOnly(readLF("public/shared-returned-review.js"));
  equal(source.split("candidateSettlement(").length - 1, 3,
    "HM: candidateSettlement is declared once and called by both paths, and nowhere else");
  ok(!/decision === "rejected" \|\| decision === "shortlist"/.test(source),
    "HM: the missing-media path carries no settlement string checks of its own");

  note("HM1-10 one settlement predicate serves both paths: missing bytes still block genuinely unsettled work, and never resurrect a candidate a pick, an approval or a disposition already settled");
}
/* ===========================================================================
   ORDERING — NEVER A FILENAME.
   =========================================================================== */

async function ordering_neverFilename() {
  /* The reproduction: two candidates stamped at the same instant, returned in the order
     the production returned them. Alphabetical ordering reversed them. */
  const project = projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A" }],
    candidates: [
      candidate("Z.png", { addedAt: "2026-08-20T10:00:00.000Z" }),
      candidate("A.png", { addedAt: "2026-08-20T10:00:00.000Z" }),
    ],
  }]);
  const scan = scanWith(project, { "L1-01": ["Z.png", "A.png"] });
  const page = await render("#/shot/L1-01", project, { scan });
  const seen = evaluate(page.context, `
    const media = productionMediaRecords({ project: P, scan: SCAN, jobs: [] });
    const projection = returnedReviewProjectionForBrowser();
    return {
      source: media.records.filter((row) => row.scope === "shot").map((row) => row.file.name),
      queue: projection.queue.map((row) => row.candidate.name),
      again: returnedReviewProjectionForBrowser().queue.map((row) => row.candidate.name),
      addedAt: projection.items.map((row) => row.candidate.addedAt),
    };
  `);
  deepEqual(seen.addedAt, ["2026-08-20T10:00:00.000Z", "2026-08-20T10:00:00.000Z"], "ORDER: precondition — the timestamps are exactly equal");
  deepEqual(seen.source, ["Z.png", "A.png"], "ORDER: precondition — the authoritative input returned Z first");
  deepEqual(seen.queue, ["Z.png", "A.png"], "ORDER: a true tie keeps the source order, and never sorts by name");
  deepEqual(seen.again, seen.queue, "ORDER: and repeating the derivation over unchanged data is deterministic");

  /* Chronology still decides when it can. */
  const dated = projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A" }],
    candidates: [
      candidate("Z.png", { addedAt: "2026-08-20T11:00:00.000Z" }),
      candidate("A.png", { addedAt: "2026-08-20T10:00:00.000Z" }),
    ],
  }]);
  const datedPage = await render("#/shot/L1-01", dated, { scan: scanWith(dated, { "L1-01": ["Z.png", "A.png"] }) });
  deepEqual(evaluate(datedPage.context, `return returnedReviewProjectionForBrowser().queue.map((row) => row.candidate.name);`),
    ["A.png", "Z.png"], "ORDER: an earlier candidate still leads when the timestamps differ");

  /* And the repair still leads its parent, which is the one rule that is not chronology. */
  const repaired = projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A" }],
    candidates: [
      candidate("C1.png", { addedAt: "2026-08-20T10:00:00.000Z", correctionResultNames: ["C2.png"] }),
      candidate("C2.png", { addedAt: "2026-08-20T11:00:00.000Z", correctionOf: "C1.png" }),
    ],
  }]);
  const repairedPage = await render("#/shot/L1-01", repaired, { scan: scanWith(repaired, { "L1-01": ["C1.png", "C2.png"] }) });
  deepEqual(evaluate(repairedPage.context, `return returnedReviewProjectionForBrowser().queue.map((row) => row.candidate.name);`),
    ["C2.png", "C1.png"], "ORDER: the repair still leads its parent");

  /* The source of the rule, structurally: no filename comparison survives in the file. */
  const source = codeOnly(readLF("public/shared-returned-review.js"));
  ok(!/root <|name <|\.name\.localeCompare|root\.localeCompare/.test(source),
    "ORDER: the projection contains no lexical comparison of candidate names");

  note("ORDER equal timestamps keep the authoritative source order, chronology still decides when it can, the repair still leads, and no filename comparison survives");
}

/* ===========================================================================
   ACTION SOURCE, MOTION REFUSAL, AND THE MACHINE-SELECTED LABEL.
   =========================================================================== */

async function actions_declaredNotSynthesised() {
  /* A. `revise` IS NOT A DECLARED CANDIDATE DECISION, and the projection no longer says
     it is. production-media declares approve, reject, restore, view-review, open-owner
     and open-full-preview; none of them authorises building a correction, so translating
     `view-review` into a decision called `revise` was the projection inventing one. */
  deepEqual([...RR.RETURNED_REVIEW_DECISION_ACTIONS], ["approve", "reject"], "ACTIONS: two declared decisions");
  deepEqual([...RR.RETURNED_REVIEW_WORKFLOWS], ["revise"], "ACTIONS: revise is a workflow");
  ok(RR.RETURNED_REVIEW_ACTION_LIMITATIONS.revise, "ACTIONS: and the gap is declared rather than filled");
  ok(/none of them authorises/i.test(RR.RETURNED_REVIEW_ACTION_LIMITATIONS.revise.why),
    "ACTIONS: naming why: " + RR.RETURNED_REVIEW_ACTION_LIMITATIONS.revise.why);
  const media = require("../public/shared-production-media.js");
  const declared = media.PRODUCTION_MEDIA_ACTIONS.map((row) => row.id);
  ok(!declared.includes("revise"), "ACTIONS: production-media genuinely declares no revise, so this is not a stale note");
  for (const id of RR.RETURNED_REVIEW_DECISION_ACTIONS)
    ok(declared.includes(id), `ACTIONS: ${id} is narrowed from a declared production-media action`);

  const frameProject = projectOf([{ id: "L1-01", candidates: [candidate("FRAME_A.png")] }]);
  const framePage = await render("#/shot/L1-01", frameProject, { scan: scanWith(frameProject, { "L1-01": ["FRAME_A.png"] }) });
  const frameSeen = evaluate(framePage.context, `
    const item = returnedReviewProjectionForBrowser().queue[0];
    return { actions: item.actions, workflows: item.workflows, refusal: returnedReviewActionRefusal(item, "revise") };
  `);
  deepEqual(frameSeen.actions, ["approve", "reject"], "ACTIONS: a frame candidate declares two decisions");
  deepEqual(frameSeen.workflows, ["revise"], "ACTIONS: and one workflow");
  equal(frameSeen.refusal.allowed, true, "ACTIONS: which the refusal resolver permits on a frame");
  /* The surface says which list authorised each control, so it cannot be inferred from
     position. */
  const frameCard = cardOf(framePage.context.document.getElementById("main").innerHTML);
  deepEqual(frameCard.actionSources, [["approve", "decision"], ["revise", "workflow"], ["reject", "decision"]],
    "ACTIONS: and every control on the card declares the list it came from");

  /* B. MOTION REFUSES `revise` DETERMINISTICALLY, IN WORDS, AND DISPATCHES NOTHING. */
  const motionProject = projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A", winner: "FRAME_A.png" }],
    clips: [{ id: "motion-a", label: "A", suffix: "a", title: "Panel check", kind: "i2v", fromFrame: "frame-a", toFrame: "", dur: 5, motionPrompt: "He checks the panel.", generationPackages: [] }],
    candidates: [candidate("FRAME_A.png"), candidate("SHOT_MOTION_1.mp4", { frameId: "", addedAt: "2026-08-20T12:00:00.000Z" })],
  }]);
  const motionPage = await render("#/shot/L1-01", motionProject, { scan: scanWith(motionProject, { "L1-01": ["FRAME_A.png", "SHOT_MOTION_1.mp4"] }) });
  const motionSeen = evaluate(motionPage.context, `
    const item = returnedReviewProjectionForBrowser().queue[0];
    return { owner: item.owner.kind, actions: item.actions, workflows: item.workflows, refusal: returnedReviewActionRefusal(item, "revise") };
  `);
  equal(motionSeen.owner, "shot-motion", "ACTIONS: precondition — the returned video owns the review");
  deepEqual(motionSeen.actions, ["approve", "reject"], "ACTIONS: a video can be used or passed on");
  deepEqual(motionSeen.workflows, [], "ACTIONS: and declares no revise workflow");
  equal(motionSeen.refusal.allowed, false, "ACTIONS: so asking to revise it is refused");
  equal(motionSeen.refusal.reason, "revise-motion", "ACTIONS: with the reason named as a token");
  ok(RR.RETURNED_REVIEW_ACTION_LIMITATIONS["revise-motion"], "ACTIONS: and the limitation is declared");
  /* AT RUNTIME: the caller is told, and no dialog is opened. A silent no-op would leave a
     filmmaker pressing a button and concluding the product was broken. */
  let spoken = "";
  motionPage.context.toast = (message) => { spoken = message; };
  const motionKey = evaluate(motionPage.context, `return returnedReviewProjectionForBrowser().queue[0].key;`);
  motionPage.context.reviseReturnedResult("L1-01", motionKey);
  await new Promise((resolve) => setTimeout(resolve, 20));
  equal(spoken, "Revise is not available for Motion results.", "ACTIONS: in the filmmaker's words");
  equal(motionPage.context.document.getElementById("modal").innerHTML, "", "ACTIONS: and nothing is opened");
  /* The words are the surface's, not the projection's. */
  const projectionSource = codeOnly(readLF("public/shared-returned-review.js"));
  ok(!/Revise is not available/.test(projectionSource), "ACTIONS: the projection carries the token, never the sentence");

  /* A stale key refuses too, rather than opening whatever is pending. */
  let staleSpoken = "";
  motionPage.context.toast = (message) => { staleSpoken = message; };
  motionPage.context.reviseReturnedResult("L1-01", "path:shots/L1-01/takes/NOPE.png");
  await new Promise((resolve) => setTimeout(resolve, 20));
  ok(/no longer waiting/i.test(staleSpoken), "ACTIONS: an unknown key is refused rather than substituted: " + staleSpoken);

  note("ACTIONS revise is a workflow gated on a declared action rather than a decision the projection invented, and Motion refuses it deterministically in words while dispatching nothing");
}

async function label_machineSelectedIsNotHumanApproved() {
  /* A pick whose only recorded actor is automation. shared-production-media.js already
     reports `machine-selected` for exactly this, separately from `approved`, and this
     module used to collapse the two into `human-approved` — asserting a decision nobody
     took, on the surface whose whole subject is who decided what. */
  const project = projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A", winner: "AUTO.png", canon: true }],
    candidates: [candidate("AUTO.png")],
  }]);
  project.shots[0].generationRecords = [{ file: "AUTO.png", approval: "automatic" }];
  const page = await render("#/shot/L1-01", project, { scan: scanWith(project, { "L1-01": ["AUTO.png"] }) });
  const seen = evaluate(page.context, `
    const projection = returnedReviewProjectionForBrowser();
    const media = productionMediaRecords({ project: P, scan: SCAN, jobs: [] });
    const row = media.records.find((r) => r.file.name === "AUTO.png");
    return {
      mediaState: row.humanDecision.state,
      settled: projection.items.map((r) => r.candidate.name + ":" + r.settled),
      humanDecision: projection.items.map((r) => r.humanDecision),
      awaiting: projection.counts.awaiting,
    };
  `);
  equal(seen.mediaState, "machine-selected", "LABEL: precondition — production-media reports machine selection");
  deepEqual(seen.settled, ["AUTO.png:machine-selected"], "LABEL: and the returned-review reason says the same thing");
  ok(!seen.settled.some((row) => /human-approved/.test(row)), "LABEL: never human-approved");
  deepEqual(seen.humanDecision, ["machine-selected"], "LABEL: the state travels unchanged");
  equal(seen.awaiting, 0, "LABEL: the pick still settles the unit — authority semantics are untouched");
  ok(RR.RETURNED_REVIEW_SETTLED_REASONS.includes("machine-selected"), "LABEL: and the reason is declared vocabulary");
  ok(RR.RETURNED_REVIEW_SETTLED_REASONS.includes("human-approved"), "LABEL: alongside the one it must not be confused with");

  note("LABEL a machine-selected pick settles its unit and is never reported as a human approval");
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
  shotC: "SH-C",
  candidateA: "SH-A_FRAME_A_FAL_1.png",
  /* A SECOND pending candidate in the same shot, so the stale-claim workflow has
     something for a substitution to substitute. */
  candidateA2: "SH-A_FRAME_B_FAL_1.png",
  /* DELIBERATELY LONG, and realistic: this is the shape a generated candidate filename
     actually has. It is the PARENT, because the parent's name is the string the compact
     Before card carries — and that is where the independent review found it clipped into
     an unusable token at 1280. */
  parentB: "SH-B_FRAME_A_GPT_IMAGE_2_HIGH_2048x1152_ROUND_01_FAL_1.png",
  repairB: "SH-B_FRAME_A_CORRECTION_GPT_IMAGE_2_HIGH_2048x1152_ROUND_02_FAL_1.png",
  /* A row the project still records as undecided, whose file is never written. */
  missingC: "SH-C_FRAME_A_FAL_1.png",
  unconfirmedReference: "KAI-ANCHOR.png",
};

function writeBrowserFixture(dir) {
  for (const folder of ["anchors", "plates", "props", "media", "docs", path.join("shots", "SH-A", "takes"), path.join("shots", "SH-B", "takes"), path.join("shots", "SH-C", "takes")])
    fs.mkdirSync(path.join(dir, folder), { recursive: true });
  fs.writeFileSync(path.join(dir, "anchors", "KAI-ANCHOR.png"), "kai");
  fs.writeFileSync(path.join(dir, "plates", "LOC-HULL-PLATE.png"), "hull");
  fs.writeFileSync(path.join(dir, "props", "PR-TOOL-PLATE.png"), "tool");
  fs.writeFileSync(path.join(dir, "shots", "SH-A", "takes", BROWSER_FIXTURE.candidateA), "a1");
  fs.writeFileSync(path.join(dir, "shots", "SH-A", "takes", BROWSER_FIXTURE.candidateA2), "a2");
  fs.writeFileSync(path.join(dir, "shots", "SH-B", "takes", BROWSER_FIXTURE.parentB), "b1");
  fs.writeFileSync(path.join(dir, "shots", "SH-B", "takes", BROWSER_FIXTURE.repairB), "b2");
  /* SH-C's take is NOT written. That absence is the fixture. */

  /* KAI is deliberately NOT in the receipt list: the shot points at KAI-ANCHOR.png and
     nobody has approved it, which is the `confirm-existing-reference` shape exactly. */
  const project = projectOf([
    {
      id: "SH-A",
      title: "Hull check",
      frames: [{ id: "frame-a", label: "A" }, { id: "frame-b", label: "B" }],
      candidates: [
        candidate(BROWSER_FIXTURE.candidateA),
        candidate(BROWSER_FIXTURE.candidateA2, { frameId: "frame-b", addedAt: "2026-08-20T10:05:00.000Z" }),
      ],
    },
    {
      id: "SH-B",
      title: "Panel repair",
      candidates: [
        candidate(BROWSER_FIXTURE.parentB, { correctionResultNames: [BROWSER_FIXTURE.repairB] }),
        candidate(BROWSER_FIXTURE.repairB, { addedAt: "2026-08-20T11:00:00.000Z", correctionOf: BROWSER_FIXTURE.parentB, sourceBuildId: "build-corr" }),
      ],
    },
    /* No cast, so its readiness action is PRODUCE THE FRAME — which is the promotion an
       unaccounted-for result has to refuse, and the only thing it refuses. */
    { id: "SH-C", title: "Lost result", bare: true, candidates: [candidate(BROWSER_FIXTURE.missingC)] },
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
    "SH-A": [BROWSER_FIXTURE.candidateA, BROWSER_FIXTURE.candidateA2],
    "SH-B": [BROWSER_FIXTURE.parentB, BROWSER_FIXTURE.repairB],
    "SH-C": [],
  });
  const page = await render("#/shot/SH-A", project, { scan });
  const cardA = cardOf(page.context.document.getElementById("main").innerHTML);
  ok(cardA.returnedReview, "FIXTURE: SH-A opens on its returned candidate");
  equal(cardA.file, BROWSER_FIXTURE.candidateA, "FIXTURE: which is the seeded one");
  equal(cardA.waiting, "2", "FIXTURE: with a second pending candidate behind it, for the stale-claim workflow");
  equal(cardA.secondaryCode, "confirm-existing-reference", "FIXTURE: with the unconfirmed reference as secondary context");
  const pageB = await render("#/shot/SH-B", project, { scan });
  const cardB = cardOf(pageB.context.document.getElementById("main").innerHTML);
  equal(cardB.file, BROWSER_FIXTURE.repairB, "FIXTURE: SH-B opens on the repair");
  equal(cardB.repair, true, "FIXTURE: declared as a repair");
  ok(cardB.markup.includes(BROWSER_FIXTURE.parentB), "FIXTURE: with its parent on the card");
  ok(BROWSER_FIXTURE.parentB.length >= 55, "FIXTURE: and the parent filename — the one the Before card carries — is long enough to be worth measuring at 1280");
  const pageC = await render("#/shot/SH-C", project, { scan });
  const cardC = cardOf(pageC.context.document.getElementById("main").innerHTML);
  equal(cardC.unavailable, true, "FIXTURE: SH-C is the missing-media integrity state");
  const projectionSeen = evaluate(pageC.context, `
    const p = returnedReviewProjectionForBrowser();
    return { awaiting: p.counts.awaiting, unavailable: p.counts.unavailable, blockers: p.blockers.map((row) => row.shotId) };
  `);
  equal(projectionSeen.awaiting, 4, "FIXTURE: four candidates are genuinely waiting across the project");
  deepEqual(projectionSeen.blockers, ["SH-C"], "FIXTURE: and exactly one integrity blocker, in SH-C");
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
  await cr_pickSettlesOnlyItsOwnAlternates();
  await sr_staleRouteClaims();
  await mf_missingReturnedMedia();
  await hm_settledMissingMediaIsNotCurrentWork();
  await ordering_neverFilename();
  await actions_declaredNotSynthesised();
  await label_machineSelectedIsNotHumanApproved();
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

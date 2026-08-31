/* Negative controls for tests/returned-media-ownership.js.
 *
 * A guarantee nobody has watched fail is a guarantee nobody has tested. Each control
 * below restores ONE of the defects the Public Alpha UX convergence audit reproduced —
 * IN MEMORY, through the render harness's mutateSource hook, so nothing on disk is
 * touched and no control can be "restored" by a checkout that also discards real work.
 *
 * EVERY CONTROL DOES TWO THINGS, IN THIS ORDER, AND THE ORDER IS THE POINT:
 *
 *   1. REPRODUCES THE USER-VISIBLE DEFECT. Not "the guard threw" — the actual words a
 *      filmmaker would read, or the actual wrong candidate, asserted against the mutated
 *      build. A control that only proves an assertion fires has proved that an assertion
 *      exists.
 *   2. REQUIRES THE POSITIVE GUARANTEE TO GO RED against that same build.
 *
 * Each mutation also carries a PROBE RECEIPT: it asserts the text it is replacing was
 * actually present, so a control cannot quietly become a no-op when the source is
 * refactored and start "passing" against nothing. The receipt is asserted OUTSIDE the
 * mutated build — a control that guards itself with the same assert() it is testing
 * reports success while mutating nothing.
 *
 * ANCHORS ARE NORMALISED TO LF. This repository checks out with core.autocrlf=true, so a
 * multi-line anchor written with \n matches zero times against the bytes on disk; the
 * hook normalises the file before splitting, and the receipt reads the file the same way.
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

/* A mutateSource hook scoped to one public/ file.

   THE HOOK IS HANDED A BARE SCRIPT NAME, not a repo-relative path, while anchorIn()
   needs the repo-relative one. Both are derived from the SAME constant here, because a
   control whose receipt reads `public/x.js` and whose mutation targets `x.js` passes its
   receipt and then mutates nothing — a no-op wearing a green tick. */
const scriptName = (file) => String(file).replace(/^public\//, "");
function replacing(file, needle, replacement) {
  return replacingAll([[file, needle, replacement]]);
}
/* Several controls have to make more than one edit. */
function replacingAll(entries) {
  return (name, contents) => {
    let source = String(contents).replace(/\r\n/g, "\n");
    for (const [file, needle, replacement] of entries)
      if (name === scriptName(file)) source = source.split(needle).join(replacement);
    return source;
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
   FIXTURES — the shapes the audit reproduced, and nothing more.
   =========================================================================== */

const CAST_CANON = [
  { kind: "entity-state", list: "characters", entityId: "KAI", stateId: "state-default", value: "KAI-ANCHOR.png" },
  { kind: "entity-state", list: "locations", entityId: "LOC-HULL", stateId: "state-default", value: "LOC-HULL-PLATE.png" },
  { kind: "entity-state", list: "props", entityId: "PR-TOOL", stateId: "state-default", value: "PR-TOOL-PLATE.png" },
];

const candidate = (name, extra = {}) => ({
  stored: name,
  original: name,
  addedAt: extra.addedAt || "2026-08-20T10:00:00.000Z",
  decision: extra.decision || "unreviewed",
  notes: "",
  labels: [],
  frameId: extra.frameId === undefined ? "frame-a" : extra.frameId,
  generationJobId: `job-${name}`,
  generationProvider: "fal",
  generationModel: "gpt-image-2",
  ...(extra.correctionOf ? { correctionOf: extra.correctionOf, correctionBuildId: "build-corr" } : {}),
  ...(extra.correctionResultNames ? { correctionResultNames: extra.correctionResultNames } : {}),
});

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
    /* THE FIXTURE DECLARES WHAT IT DELIVERS, the same way its sibling suite's does.
       `frame.required` is written `true` by newKeyframe() on every frame of every
       project and by no filmmaker-facing control at all, so readiness no longer reads
       it on a shot that has declared neither a delivery route nor a still delivery —
       a default may fill an unknown and may never make a statement. Every control here
       reproduces a defect that only exists while the shot IS producing a frame, so
       without this the controls would compare two identical undeclared states and
       report that they never fired. */
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

const evaluate = (context, expression) =>
  JSON.parse(vm.runInContext(`JSON.stringify((() => { ${expression} })())`, context));
const evaluateAsync = async (context, expression) =>
  JSON.parse(await vm.runInContext(`(async () => { ${expression} })().then(JSON.stringify)`, context));

function cardOf(html) {
  const section = html.match(/<section class="guided-next-action[\s\S]*?<\/section>/);
  const markup = section ? section[0] : "";
  const attribute = (name) => (markup.match(new RegExp(`${name}="([^"]*)"`)) || [])[1] || "";
  return {
    markup,
    returnedReview: attribute("data-returned-review") === "1",
    key: attribute("data-returned-review-key"),
    file: attribute("data-returned-review-file"),
    owner: attribute("data-returned-review-owner"),
    repair: attribute("data-returned-review-repair") === "1",
    secondaryCode: attribute("data-returned-review-secondary"),
    stale: attribute("data-returned-review-stale") === "1",
    unavailable: attribute("data-returned-review-unavailable") === "1",
    headline: (markup.match(/<h2>([^<]*)<\/h2>/) || [])[1] || "",
    primary: (markup.match(/class="assemble-btn shot-primary-action"[^>]*>([^<]*)/) || [])[1] || "",
    actions: [...markup.matchAll(/data-returned-review-action="([a-z]+)"/g)].map((m) => m[1]),
    actionSources: [...markup.matchAll(/data-returned-review-action="([a-z]+)" data-returned-review-action-source="([a-z]+)"/g)].map((m) => [m[1], m[2]]),
  };
}

/* THE POSITIVE GUARANTEES, re-expressed here so a control can require exactly one of
   them to fail. Each is a function of a rendered build, not a copy of the suite. */
function requireReviewOwnsWorkspace(card, label) {
  assert(card.returnedReview,
    `${label}: the returned candidate must own the shot workspace card, and instead it read ${JSON.stringify(card.headline)}`);
}
function requireReadinessSurvivesAsSecondary(card, code, label) {
  assert.strictEqual(card.secondaryCode, code,
    `${label}: the readiness action must survive as secondary context`);
}

/* ===========================================================================
   NC-RM1 — REFERENCE CONFIRMATION DISPLACES A REAL RETURNED CANDIDATE.

   The audit's first reproduction, restored exactly: the shot workspace answers "what
   needs me here" from readiness alone, so a shot Production has just routed to with
   REVIEW RETURNED RESULT opens asking for a reference confirmation instead.
   =========================================================================== */

const CARD_FILE = "public/creation-studio.js";
const NC1_ANCHOR = `  const returnedReview = shotReturnedReview(s);
  if (returnedReview && !RETURNED_REVIEW_INTEGRITY_BLOCKERS.includes(readiness?.nextAction?.code || "")) {`;
const NC1_BREAK = `  const returnedReview = shotReturnedReview(s);
  if (false && returnedReview) {`;

async function ncRM1() {
  anchorIn(CARD_FILE, NC1_ANCHOR, "NC-RM1");
  const project = projectOf([{ id: "L1-01", candidates: [candidate("FRAME_A.png")] }], {
    canon: CAST_CANON.filter((row) => row.entityId !== "KAI"),
  });
  const scan = scanWith(project, { "L1-01": ["FRAME_A.png"] });
  const broken = await render("#/shot/L1-01", project, { scan, mutateSource: replacing(CARD_FILE, NC1_ANCHOR, NC1_BREAK) });
  const html = broken.context.document.getElementById("main").innerHTML;
  const card = cardOf(html);
  const seen = evaluate(broken.context, `
    return { queue: returnedReviewProjectionForBrowser().counts.awaiting, next: projectNextProductionAction().actionLabel };
  `);

  /* 1. THE LITERAL BAD STATE. Production says review the returned result; the shot it
        sends you to offers a decision about something else entirely. */
  equal(seen.queue, 1, "NC-RM1: a returned candidate is genuinely waiting");
  equal(seen.next, "REVIEW RETURNED RESULT", "NC-RM1: and Production routes the filmmaker here to review it");
  equal(card.returnedReview, false, "NC-RM1: yet the workspace card is not about the returned result");
  equal(card.headline, "Confirm existing reference", "NC-RM1: it asks for the reference confirmation instead");
  equal(card.primary, "Confirm existing reference", "NC-RM1: and that is the only primary action offered");
  ok(!html.includes("came back and needs your decision"), "NC-RM1: nothing on the page says a result came back");

  /* 2. AND THE GUARANTEE GOES RED FOR IT. */
  await mustFail("NC-RM1", "must own the shot workspace card",
    () => requireReviewOwnsWorkspace(card, "NC-RM1 positive"));

  note(`NC-RM1 restored reference-displaces-review: Production said ${seen.next} and the shot it routed to read "${card.headline}"`);
}

/* ===========================================================================
   NC-RM2 — A GENERIC PRODUCE/CREATE CTA DISPLACES THE RETURNED REVIEW.

   The audit's third reproduction: two unreviewed candidates on the page and a primary
   action telling the filmmaker to generate a third.
   =========================================================================== */

async function ncRM2() {
  anchorIn(CARD_FILE, NC1_ANCHOR, "NC-RM2");
  const project = projectOf([{ id: "L1-01", candidates: [candidate("FRAME_A.png"), candidate("FRAME_B.png", { addedAt: "2026-08-20T10:05:00.000Z" })] }]);
  const scan = scanWith(project, { "L1-01": ["FRAME_A.png", "FRAME_B.png"] });
  const broken = await render("#/shot/L1-01", project, { scan, mutateSource: replacing(CARD_FILE, NC1_ANCHOR, NC1_BREAK) });
  const card = cardOf(broken.context.document.getElementById("main").innerHTML);
  const waiting = evaluate(broken.context, `return returnedReviewProjectionForBrowser().counts.awaiting;`);

  equal(waiting, 2, "NC-RM2: two returned candidates are waiting");
  equal(card.headline, "Produce the frame", "NC-RM2: and the workspace tells the filmmaker to make a third");
  ok(/produce/i.test(card.primary), "NC-RM2: as its primary action: " + card.primary);

  await mustFail("NC-RM2", "must own the shot workspace card",
    () => requireReviewOwnsWorkspace(card, "NC-RM2 positive"));

  note(`NC-RM2 restored produce-over-review: 2 candidates waiting beside a primary action reading "${card.primary}"`);
}

/* ===========================================================================
   NC-RM4 — THE REPAIR LOSES ITS PARENT.

   The audit's second reproduction: C2 comes back as a peer of C1, with the relationship
   recorded in the project and shown nowhere.
   =========================================================================== */

const PROJECTION_FILE = "public/shared-returned-review.js";
const NC4_ANCHOR = `  function correctionParentName(row) {
    for (const entry of list(record(row.provenance).lineage))
      if (text(entry.relation) === "correction-of") return text(entry.value);
    return "";
  }`;
const NC4_BREAK = `  function correctionParentName(row) {
    return "";
  }`;

function repairProject() {
  return projectOf([{
    id: "L1-01",
    candidates: [
      candidate("C1.png", { correctionResultNames: ["C2.png"] }),
      candidate("C2.png", { addedAt: "2026-08-20T11:00:00.000Z", correctionOf: "C1.png" }),
    ],
  }]);
}
const REPAIR_SCAN = { "L1-01": ["C1.png", "C2.png"] };

async function ncRM4() {
  anchorIn(PROJECTION_FILE, NC4_ANCHOR, "NC-RM4");
  const project = repairProject();
  const scan = scanWith(project, REPAIR_SCAN);
  const broken = await render("#/shot/L1-01", project, { scan, mutateSource: replacing(PROJECTION_FILE, NC4_ANCHOR, NC4_BREAK) });
  const html = broken.context.document.getElementById("main").innerHTML;
  const card = cardOf(html);
  const seen = evaluate(broken.context, `
    const projection = returnedReviewProjectionForBrowser();
    return {
      order: projection.queue.map((row) => row.candidate.name),
      repairOf: projection.queue.map((row) => row.repairOf ? row.repairOf.name : ""),
      recorded: P.shots[0].candidateFiles.map((row) => row.stored + "<-" + (row.correctionOf || "")),
    };
  `);

  /* 1. THE LITERAL BAD STATE: the lineage is in the project, and the filmmaker is shown
        two peers with no relationship between them. */
  ok(seen.recorded.includes("C2.png<-C1.png"), "NC-RM4: the project still records the repair relationship");
  equal(card.repair, false, "NC-RM4: but the card does not know it is looking at a repair");
  ok(!/a repair of/.test(html), "NC-RM4: nothing on the page says what this repaired");
  ok(!/Before/.test(card.markup), "NC-RM4: and the take being repaired is nowhere on the card");
  equal(seen.repairOf.join("|"), "|", "NC-RM4: the projection reports no parent for either candidate");
  equal(seen.order[0], "C1.png", "NC-RM4: and without lineage the repair no longer leads");

  await mustFail("NC-RM4", "the parent take is on the card as Before", () => {
    assert(card.markup.includes("Before"), "the parent take is on the card as Before");
  });

  note("NC-RM4 restored the lost repair parent: correctionOf still recorded, and the card showed two peers with no Before");
}

/* ===========================================================================
   NC-RM5 — THE PARENT IS GUESSED FROM RECENCY INSTEAD OF PROVENANCE.

   The wrong-parent case, which is worse than no parent: the card confidently shows a
   filmmaker a Before image that is not what this take was repaired from. The fixture
   makes recency and provenance disagree ON PURPOSE — the newest other candidate is an
   unrelated take generated after the repair.
   =========================================================================== */

const NC5_BREAK = `  function correctionParentName(row) {
    return text(record(row.file).name) ? "__NEWEST__" : "";
  }`;
/* The recency rule the control installs, in the one place a parent is resolved. */
const NC5_LOOKUP_ANCHOR = `      const parentRow = parentName ? byName.get(parentName) || null : null;`;
const NC5_LOOKUP_BREAK = `      const parentRow = parentName === "__NEWEST__"
        ? [...byName.values()].filter((other) => text(record(other.file).name) !== name)
            .sort((a, b) => (valueOf(record(a.file).addedAt) < valueOf(record(b.file).addedAt) ? 1 : -1))[0] || null
        : parentName ? byName.get(parentName) || null : null;`;

async function ncRM5() {
  anchorIn(PROJECTION_FILE, NC4_ANCHOR, "NC-RM5 (parent reader)");
  anchorIn(PROJECTION_FILE, NC5_LOOKUP_ANCHOR, "NC-RM5 (parent lookup)");
  /* C2 is the repair of C1. UNRELATED.png is newer than both and repairs nothing. */
  const project = projectOf([{
    id: "L1-01",
    candidates: [
      candidate("C1.png", { correctionResultNames: ["C2.png"] }),
      candidate("C2.png", { addedAt: "2026-08-20T11:00:00.000Z", correctionOf: "C1.png" }),
      candidate("UNRELATED.png", { addedAt: "2026-08-20T12:00:00.000Z" }),
    ],
  }]);
  const scan = scanWith(project, { "L1-01": ["C1.png", "C2.png", "UNRELATED.png"] });
  const broken = await render("#/shot/L1-01", project, {
    scan,
    mutateSource: replacingAll([
      [PROJECTION_FILE, NC4_ANCHOR, NC5_BREAK],
      [PROJECTION_FILE, NC5_LOOKUP_ANCHOR, NC5_LOOKUP_BREAK],
    ]),
  });
  const seen = evaluate(broken.context, `
    const projection = returnedReviewProjectionForBrowser();
    return {
      parents: projection.items.map((row) => row.candidate.name + "<-" + (row.repairOf && row.repairOf.candidate ? row.repairOf.candidate.name : "")),
      recorded: P.shots[0].candidateFiles.filter((row) => row.correctionOf).map((row) => row.stored + "<-" + row.correctionOf),
    };
  `);

  /* 1. THE LITERAL BAD STATE: the record says C2 repaired C1; the surface says it
        repaired the newest file in the folder. */
  deepEqualLoose(seen.recorded, ["C2.png<-C1.png"], "NC-RM5: the project records the true parent");
  ok(seen.parents.includes("C2.png<-UNRELATED.png"),
    "NC-RM5: and the recency rule attributes the repair to an unrelated later take: " + seen.parents.join(", "));

  await mustFail("NC-RM5", "resolved from recorded provenance", () => {
    const c2 = seen.parents.find((row) => row.startsWith("C2.png<-"));
    assert.strictEqual(c2, "C2.png<-C1.png",
      "the repair's parent is resolved from recorded provenance, never from recency");
  });

  note("NC-RM5 restored newest-file-wins lineage: the record said C2 repaired C1 and the projection said it repaired UNRELATED.png");
}
function deepEqualLoose(actual, expected, message) {
  checks += 1;
  assert.deepStrictEqual(actual, expected, message);
}

/* ===========================================================================
   NC-RM6 — REVIEWING THE REPAIR OVERWRITES THE PARENT'S HISTORY.

   Restores the tempting shortcut: "the repair supersedes its parent, so collapse them
   into one record". Deciding about C2 carries the decision onto C1 and erases both halves
   of the lineage.

   IT DOES NOT SIMPLY DELETE THE PARENT ROW, and that is worth saying: a deleted row is
   RE-CREATED on the next render, because normalizeCandidateReviewSchema() rebuilds a
   candidate row for every file the scan still reports. A control built on the deletion
   would repair itself and report success. What does not come back is what the row
   RECORDED — its disposition and its provenance — so that is what this breaks.
   =========================================================================== */

const DECISION_FILE = "public/review-provenance.js";
const NC6_ANCHOR = `window.setCandidateDecision = (id, name, decision) => {
  const s = shotById(id),
    row = candidateRecord(s, name);
  row.decision = row.decision === decision ? "unreviewed" : decision;`;
const NC6_BREAK = `window.setCandidateDecision = (id, name, decision) => {
  const s = shotById(id),
    row = candidateRecord(s, name);
  if (row.correctionOf) {
    const parent = s.candidateFiles.find((other) => (other.stored || other.name) === row.correctionOf);
    if (parent) { parent.decision = decision; delete parent.correctionResultNames; }
    delete row.correctionOf;
  }
  row.decision = row.decision === decision ? "unreviewed" : decision;`;

async function ncRM6() {
  anchorIn(DECISION_FILE, NC6_ANCHOR, "NC-RM6");
  const project = repairProject();
  const scan = scanWith(project, REPAIR_SCAN);
  const broken = await render("#/shot/L1-01", project, { scan, mutateSource: replacing(DECISION_FILE, NC6_ANCHOR, NC6_BREAK) });
  const before = evaluate(broken.context, `
    return P.shots[0].candidateFiles.map((row) => row.stored + ":" + row.decision);
  `);
  broken.context.rejectReturnedResult("L1-01", "C2.png");
  await new Promise((resolve) => setTimeout(resolve, 20));
  const seen = evaluate(broken.context, `
    const projection = returnedReviewProjectionForBrowser();
    return {
      rows: P.shots[0].candidateFiles.map((row) => ({ name: row.stored, decision: row.decision, into: row.correctionResultNames || [], of: row.correctionOf || "" })),
      lineage: projection.items.map((row) => row.candidate.name + "<-" + (row.repairOf ? row.repairOf.name : "")),
      queue: projection.queue.map((row) => row.candidate.name),
    };
  `);
  const parent = seen.rows.find((row) => row.name === "C1.png");

  /* 1. THE LITERAL BAD STATE: a decision about C2 silently rejected C1, and the
        relationship between them is gone in both directions. */
  ok(before.includes("C1.png:unreviewed"), "NC-RM6: the parent was undecided before the repair was reviewed");
  equal(parent.decision, "rejected", "NC-RM6: deciding about the repair rejected the parent too");
  deepEqualLoose(parent.into, [], "NC-RM6: and erased the parent's half of the lineage");
  equal(seen.rows.find((row) => row.name === "C2.png").of, "", "NC-RM6: along with the repair's own half");
  ok(!seen.lineage.includes("C2.png<-C1.png"), "NC-RM6: so the repair relationship is no longer inspectable");
  deepEqualLoose(seen.queue, [], "NC-RM6: and the parent nobody decided about has silently left the queue");

  await mustFail("NC-RM6", "the parent's own disposition is untouched", () => {
    assert.strictEqual(parent.decision, "unreviewed", "the parent's own disposition is untouched");
  });

  note("NC-RM6 restored history collapse: deciding the repair rejected its parent and erased both halves of the lineage");
}

/* ===========================================================================
   NC-RM7 — AN ALREADY-REVIEWED CANDIDATE STAYS IN THE QUEUE.

   Restores the pre-slice aggregate: everything in an unpicked unit counts, whether or
   not a person already decided about it. A filmmaker who rejects a take is sent straight
   back to it.
   =========================================================================== */

const NC7_ANCHOR = `    if (state === "rejected") return "human-rejected";
    if (valueOf(decision.decision) === "shortlist") return "kept-as-alternate";
    return "";
  }`;
const NC7_BREAK = `    if (state === "rejected") return "";
    if (valueOf(decision.decision) === "shortlist") return "";
    return "";
  }`;

async function ncRM7() {
  anchorIn(PROJECTION_FILE, NC7_ANCHOR, "NC-RM7");
  const project = projectOf([{
    id: "L1-01",
    candidates: [
      candidate("REJECTED.png", { decision: "rejected" }),
      candidate("KEPT.png", { decision: "shortlist", addedAt: "2026-08-20T10:05:00.000Z" }),
    ],
  }]);
  const scan = scanWith(project, { "L1-01": ["REJECTED.png", "KEPT.png"] });
  const broken = await render("#/shot/L1-01", project, { scan, mutateSource: replacing(PROJECTION_FILE, NC7_ANCHOR, NC7_BREAK) });
  const card = cardOf(broken.context.document.getElementById("main").innerHTML);
  const seen = evaluate(broken.context, `
    return {
      awaiting: returnedReviewProjectionForBrowser().counts.awaiting,
      decisions: P.shots[0].candidateFiles.map((row) => row.stored + ":" + row.decision),
      inbox: (productionResultInbox().split("<h2>")[1] || "").split("</h2>")[0],
    };
  `);

  deepEqualLoose(seen.decisions, ["REJECTED.png:rejected", "KEPT.png:shortlist"],
    "NC-RM7: both candidates carry a recorded human decision");
  equal(seen.awaiting, 2, "NC-RM7: and both are still counted as awaiting review");
  equal(seen.inbox, "2 returned results waiting for review", "NC-RM7: so Returned Results asks for them again");
  equal(card.file, "REJECTED.png", "NC-RM7: and the workspace sends the filmmaker back to the take they rejected");

  await mustFail("NC-RM7", "awaiting is false", () => {
    assert.strictEqual(seen.awaiting, 0, "rejected — awaiting is false");
  });

  note("NC-RM7 restored the decided-candidates-still-queued aggregate: a rejected take was re-offered as the shot's decision");
}

/* ===========================================================================
   NC-RM8 — THE COUNT AND THE QUEUE DIVERGE.

   Restores an independently derived number: Returned Results counts grouped ROWS while
   the queue counts candidates, so the headline and the rows underneath it disagree — the
   exact class of defect Slice 1 removed from the decision scope.
   =========================================================================== */

const APP_FILE = "public/app.js";
const NC8_ANCHOR = `  return (items || []).reduce((sum, item) => sum + (item.shot ? Number(item.count) || 1 : 1), 0);`;
const NC8_BREAK = `  return (items || []).length;`;

async function ncRM8() {
  anchorIn(APP_FILE, NC8_ANCHOR, "NC-RM8");
  const project = projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A" }, { id: "frame-b", label: "B" }],
    candidates: [
      candidate("A1.png"),
      candidate("A2.png", { addedAt: "2026-08-20T10:05:00.000Z" }),
      candidate("B1.png", { frameId: "frame-b", addedAt: "2026-08-20T10:10:00.000Z" }),
    ],
  }]);
  const scan = scanWith(project, { "L1-01": ["A1.png", "A2.png", "B1.png"] });
  const broken = await render("#/production", project, { scan, mutateSource: replacing(APP_FILE, NC8_ANCHOR, NC8_BREAK) });
  const seen = await evaluateAsync(broken.context, `
    const inbox = productionResultInbox();
    return {
      awaiting: returnedReviewProjectionForBrowser().counts.awaiting,
      headline: (inbox.split("<h2>")[1] || "").split("</h2>")[0],
      rows: [...inbox.matchAll(/<small>([^<]*candidates? to review)<\\/small>/g)].map((m) => m[1]),
    };
  `);

  equal(seen.awaiting, 3, "NC-RM8: three candidates are waiting");
  equal(seen.headline, "1 returned result waiting for review", "NC-RM8: the headline reports a different number");
  deepEqualLoose(seen.rows, ["3 frame candidates to review"], "NC-RM8: while the row underneath it says three");

  await mustFail("NC-RM8", "the Returned Results count is the queue", () => {
    const headlineNumber = Number((seen.headline.match(/^(\d+)/) || [])[1] || 0);
    assert.strictEqual(headlineNumber, seen.awaiting, "the Returned Results count is the queue, not a number derived beside it");
  });

  note(`NC-RM8 restored count/queue divergence: "${seen.headline}" above a row reading "${seen.rows[0]}"`);
}

/* ===========================================================================
   NC-RM9 — A RETURNED VIDEO IS ANSWERED WITH A FRAME CTA.

   Restores the collapse of the two owner kinds: motion is treated as a frame, so the
   returned video is offered a frame approval that would write to the wrong unit — and
   the shot ends up back at frame generation.
   =========================================================================== */

const NC9_ANCHOR = `      if (videos.length) {`;
const NC9_BREAK = `      if (false && videos.length) {`;

async function ncRM9() {
  anchorIn(PROJECTION_FILE, NC9_ANCHOR, "NC-RM9");
  const project = projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A", winner: "FRAME_A.png" }],
    clips: [{ id: "motion-a", label: "A", suffix: "a", title: "Panel check", kind: "i2v", fromFrame: "frame-a", toFrame: "", dur: 5, motionPrompt: "He checks the panel.", generationPackages: [] }],
    candidates: [candidate("FRAME_A.png"), candidate("SHOT_MOTION_1.mp4", { frameId: "", addedAt: "2026-08-20T12:00:00.000Z" })],
    /* AND THIS ONE DELIVERS MOTION. The helper above declares a still delivery because
       every other control here is about a frame, and a still delivery is a statement
       that motion is NOT owed — under it this control could not reach produce-motion at
       all, and would report a defect it never restored. */
    creationBrief: { deliveryIntent: "motion" },
  }]);
  const scan = scanWith(project, { "L1-01": ["FRAME_A.png", "SHOT_MOTION_1.mp4"] });
  const broken = await render("#/shot/L1-01", project, { scan, mutateSource: replacing(PROJECTION_FILE, NC9_ANCHOR, NC9_BREAK) });
  const card = cardOf(broken.context.document.getElementById("main").innerHTML);
  const seen = evaluate(broken.context, `
    return {
      awaiting: returnedReviewProjectionForBrowser().counts.awaiting,
      videos: takesFor("L1-01").filter((take) => isVideo(take.name)).map((take) => take.name),
      readiness: shotReadinessFor(shotById("L1-01")).nextAction.code,
    };
  `);

  deepEqualLoose(seen.videos, ["SHOT_MOTION_1.mp4"], "NC-RM9: a returned video is in the shot");
  equal(seen.awaiting, 0, "NC-RM9: and the projection has stopped seeing it");
  equal(card.returnedReview, false, "NC-RM9: so no returned-review card is offered for it");
  equal(seen.readiness, "produce-motion", "NC-RM9: and readiness falls through to producing motion instead of reviewing what came back");
  ok(/Produce the motion/.test(card.markup), "NC-RM9: which is what the card now says: " + card.headline);

  await mustFail("NC-RM9", "the returned Motion owns the shot workspace card", () => {
    assert(card.returnedReview && card.owner === "shot-motion",
      "the returned Motion owns the shot workspace card");
  });

  note(`NC-RM9 restored motion-falls-through: a returned video sat in the shot while the card read "${card.headline}"`);
}

/* ===========================================================================
   NC-RM10 — CONFIRMING A REFERENCE CLEARS THE CANDIDATE REVIEW.

   The cross-scope leak: the returned review is derived from readiness instead of from
   durable media, so completing a reference confirmation empties a queue that has nothing
   to do with it and the returned candidate is silently dropped.
   =========================================================================== */

const NC10_ANCHOR = `  if (next) return { kind: "review", projection, item: next, waiting, next: null };`;
const NC10_BREAK = `  if (next && (shotReadinessFor(s)?.nextAction?.code || "") === "confirm-existing-reference") return { kind: "review", projection, item: next, waiting, next: null };`;

async function ncRM10() {
  anchorIn(CARD_FILE, NC10_ANCHOR, "NC-RM10");
  const project = projectOf([{ id: "L1-01", candidates: [candidate("FRAME_A.png")] }], {
    canon: CAST_CANON.filter((row) => row.entityId !== "KAI"),
  });
  const scan = scanWith(project, { "L1-01": ["FRAME_A.png"] });
  const broken = await render("#/shot/L1-01", project, { scan, mutateSource: replacing(CARD_FILE, NC10_ANCHOR, NC10_BREAK) });
  const beforeCard = cardOf(broken.context.document.getElementById("main").innerHTML);
  requireReviewOwnsWorkspace(beforeCard, "NC-RM10 precondition");
  requireReadinessSurvivesAsSecondary(beforeCard, "confirm-existing-reference", "NC-RM10 precondition");

  const historic = evaluate(broken.context, `return projectShotReadiness().historic.items.map((row) => row.key);`);
  await broken.gesture.act(() => broken.context.confirmHistoricSelection(historic[0]));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const afterCard = cardOf(broken.context.document.getElementById("main").innerHTML);
  const after = evaluate(broken.context, `
    return { awaiting: returnedReviewProjectionForBrowser().counts.awaiting, returned: returnedResultsAwaitingReview().length };
  `);

  equal(after.awaiting, 1, "NC-RM10: the returned candidate is still genuinely waiting");
  equal(after.returned, 1, "NC-RM10: and Returned Results still lists it");
  equal(afterCard.returnedReview, false, "NC-RM10: yet confirming the reference took the review off the workspace");

  await mustFail("NC-RM10", "must own the shot workspace card",
    () => requireReviewOwnsWorkspace(afterCard, "NC-RM10 positive"));

  note("NC-RM10 restored the cross-scope leak: confirming a reference removed a returned review that was still waiting");
}

/* ===========================================================================
   NC-RM11 — FRAME-WIDE SETTLEMENT ERASES AN UNDECIDED REPAIR.

   The independent review's first P0, restored: a pick on the unit settles every
   undecided candidate in it, including one that came back afterwards. The queue empties,
   the repair reports `unit-already-picked`, and the project offers to finish the shot.
   =========================================================================== */

const NC11_ANCHOR = `  function arrivedAfterPick(row, pickRow, byName) {
    const name = text(record(row.file).name);
    const pickName = text(record(pickRow.file).name);
    if (!name || !pickName || name === pickName) return false;
    if (candidateDescendsFrom(name, pickName, byName)) return true;`;
const NC11_BREAK = `  function arrivedAfterPick(row, pickRow, byName) {
    if (row || pickRow || byName) return false;`;

function canonParentProject() {
  return projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A", winner: "C1.png" }],
    candidates: [
      candidate("C1.png", { correctionResultNames: ["C2.png"] }),
      candidate("C2.png", { addedAt: "2026-08-20T11:00:00.000Z", correctionOf: "C1.png" }),
    ],
  }]);
}

async function ncRM11() {
  anchorIn(PROJECTION_FILE, NC11_ANCHOR, "NC-RM11");
  const project = canonParentProject();
  const scan = scanWith(project, { "L1-01": ["C1.png", "C2.png"] });
  const broken = await render("#/production", project, { scan, mutateSource: replacing(PROJECTION_FILE, NC11_ANCHOR, NC11_BREAK) });
  const seen = await evaluateAsync(broken.context, `
    const projection = returnedReviewProjectionForBrowser();
    return {
      awaiting: projection.counts.awaiting,
      settled: projection.items.map((row) => row.candidate.name + ":" + (row.settled || "waiting")),
      next: projectNextProductionAction(),
      inbox: (productionResultInbox().split("<h2>")[1] || "").split("</h2>")[0],
    };
  `);
  const shotPage = await render("#/shot/L1-01", project, { scan, mutateSource: replacing(PROJECTION_FILE, NC11_ANCHOR, NC11_BREAK) });
  const card = cardOf(shotPage.context.document.getElementById("main").innerHTML);

  /* 1. THE LITERAL BAD STATE. A repair came back, nobody looked at it, and CineBraid
        says the shot is finished. */
  equal(seen.awaiting, 0, "NC-RM11: the queue is empty");
  ok(seen.settled.includes("C2.png:unit-already-picked"),
    "NC-RM11: the undecided repair reports the parent's pick as its own settlement: " + seen.settled.join(", "));
  equal(seen.inbox, "No returned result is waiting for review", "NC-RM11: Returned Results says nothing is waiting");
  equal(seen.next.actionLabel, "MARK SHOT FINAL", "NC-RM11: and the project offers to finish the shot");
  ok(!card.returnedReview, "NC-RM11: with no review anywhere on the shot workspace");
  ok(!/C2\.png/.test(card.markup), "NC-RM11: the repair is not even named");

  await mustFail("NC-RM11", "the undecided repair is still a returned review", () => {
    assert.strictEqual(seen.awaiting, 1, "the undecided repair is still a returned review");
  });

  note(`NC-RM11 restored frame-wide settlement: an unreviewed repair reported ${seen.settled.find((row) => row.startsWith("C2")) } and the project said ${seen.next.actionLabel}`);
}

/* ===========================================================================
   NC-RM12 — A STALE PRODUCTION CLAIM SILENTLY SUBSTITUTES THE NEXT CANDIDATE.

   The second P0, restored: the workspace ignores the candidate the route claimed and
   resolves whatever is pending now. A is decided; the filmmaker is shown B, under an
   action that said A, with nothing on screen to say so.
   =========================================================================== */

const CLAIM_ANCHOR = `  if (claim) {
    const claimed = typeof candidateReviewContext === "function" ? candidateReviewContext(projection, claim) : null;`;
const CLAIM_BREAK = `  if (false) {
    const claimed = typeof candidateReviewContext === "function" ? candidateReviewContext(projection, claim) : null;`;

function twoPendingProject() {
  return projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A" }, { id: "frame-b", label: "B" }],
    candidates: [candidate("A.png"), candidate("B.png", { frameId: "frame-b", addedAt: "2026-08-20T10:05:00.000Z" })],
  }]);
}
const claimRoute = (name) => `#/shot/L1-01/review/${encodeURIComponent(`path:shots/L1-01/takes/${name}`)}`;

async function ncRM12() {
  anchorIn(CARD_FILE, CLAIM_ANCHOR, "NC-RM12");
  const project = twoPendingProject();
  project.shots[0].candidateFiles[0].decision = "rejected";
  const scan = scanWith(project, { "L1-01": ["A.png", "B.png"] });
  const broken = await render(claimRoute("A.png"), project, { scan, mutateSource: replacing(CARD_FILE, CLAIM_ANCHOR, CLAIM_BREAK) });
  const html = broken.context.document.getElementById("main").innerHTML;
  const card = cardOf(html);

  equal(card.returnedReview, true, "NC-RM12: a review is presented");
  equal(card.file, "B.png", "NC-RM12: and it is a candidate the route never named");
  equal(card.stale, false, "NC-RM12: with nothing saying the claim was stale");
  ok(!/already been reviewed/i.test(html), "NC-RM12: and no explanation anywhere on the page");
  ok(/data-returned-review-action="approve"/.test(card.markup),
    "NC-RM12: while offering to approve the substituted candidate");

  await mustFail("NC-RM12", "the workspace does not present a review it was not asked for", () => {
    assert.strictEqual(card.returnedReview, false,
      "the workspace does not present a review it was not asked for");
  });

  note("NC-RM12 restored silent substitution: a link that named A.png opened B.png with no explanation and offered to approve it");
}

/* ===========================================================================
   NC-RM3B — AND THE SAME BREAK, WITH BOTH CANDIDATES STILL PENDING.

   The original NC-RM3 in its repaired form: the route claims the SECOND pending
   candidate and the workspace opens the first, so the link and the card disagree about
   what the decision is about.
   =========================================================================== */

async function ncRM3() {
  anchorIn(CARD_FILE, CLAIM_ANCHOR, "NC-RM3");
  const project = twoPendingProject();
  const scan = scanWith(project, { "L1-01": ["A.png", "B.png"] });
  const broken = await render(claimRoute("B.png"), project, { scan, mutateSource: replacing(CARD_FILE, CLAIM_ANCHOR, CLAIM_BREAK) });
  const card = cardOf(broken.context.document.getElementById("main").innerHTML);
  const named = "path:shots/L1-01/takes/B.png";

  equal(card.file, "A.png", "NC-RM3: the shot workspace opens a different candidate from the one the route named");
  ok(card.key !== named, "NC-RM3: so the route and the card disagree about what the decision is about");

  await mustFail("NC-RM3", "the shot workspace opens the candidate the route named", () => {
    assert.strictEqual(card.key, named, "the shot workspace opens the candidate the route named");
  });

  note("NC-RM3 restored route/candidate divergence: the link named B.png and the shot card offered " + card.file);
}

/* ===========================================================================
   NC-RM13 — AN UNDECIDED ROW WHOSE MEDIA IS GONE DISAPPEARS, AND PRODUCE IS PROMOTED.

   The third P0, restored: the projection is built from the scan alone, so a result the
   project still owes a decision on simply stops existing and the shot reads as ready for
   another generation.
   =========================================================================== */

const NC13_ANCHOR = `      for (const candidateRow of list(record(shot).candidateFiles)) {`;
const NC13_BREAK = `      for (const candidateRow of []) {`;

async function ncRM13() {
  anchorIn(PROJECTION_FILE, NC13_ANCHOR, "NC-RM13");
  const project = projectOf([{ id: "L1-01", frames: [{ id: "frame-a", label: "A" }], candidates: [candidate("GONE.png")] }]);
  const scan = scanWith(project, { "L1-01": [] });
  const broken = await render("#/production", project, { scan, mutateSource: replacing(PROJECTION_FILE, NC13_ANCHOR, NC13_BREAK) });
  const seen = evaluate(broken.context, `
    const projection = returnedReviewProjectionForBrowser();
    return {
      items: projection.counts.items,
      unavailable: projection.counts.unavailable,
      recorded: P.shots[0].candidateFiles.map((row) => row.stored + ":" + row.decision),
      next: projectNextProductionAction(),
    };
  `);
  const shotPage = await render("#/shot/L1-01", project, { scan, mutateSource: replacing(PROJECTION_FILE, NC13_ANCHOR, NC13_BREAK) });
  const card = cardOf(shotPage.context.document.getElementById("main").innerHTML);

  deepEqualLoose(seen.recorded, ["GONE.png:unreviewed"], "NC-RM13: the project still records an undecided returned result");
  equal(seen.items, 0, "NC-RM13: and the projection has lost it entirely");
  equal(seen.unavailable, 0, "NC-RM13: reporting no integrity condition for it");
  equal(seen.next.actionLabel, "PRODUCE THE FRAME", "NC-RM13: so the project offers to generate another one");
  ok(/Produce the frame/.test(card.headline), "NC-RM13: and so does the shot: " + card.headline);
  ok(!/GONE\.png/.test(card.markup), "NC-RM13: with the lost result named nowhere");

  await mustFail("NC-RM13", "but the record does not disappear", () => {
    assert.strictEqual(seen.unavailable, 1, "but the record does not disappear");
  });

  note(`NC-RM13 restored the vanishing record: an undecided GONE.png left the projection and the project said ${seen.next.actionLabel}`);
}

/* ===========================================================================
   NC-RM14 — EQUAL TIMESTAMPS FALL BACK TO THE FILENAME.
   =========================================================================== */

const NC14_ANCHOR = `        return a.group.ordinal - b.group.ordinal;`;
const NC14_BREAK = `        return a.group.root < b.group.root ? -1 : 1;`;

async function ncRM14() {
  anchorIn(PROJECTION_FILE, NC14_ANCHOR, "NC-RM14");
  const project = projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A" }],
    candidates: [
      candidate("Z.png", { addedAt: "2026-08-20T10:00:00.000Z" }),
      candidate("A.png", { addedAt: "2026-08-20T10:00:00.000Z" }),
    ],
  }]);
  const scan = scanWith(project, { "L1-01": ["Z.png", "A.png"] });
  const broken = await render("#/shot/L1-01", project, { scan, mutateSource: replacing(PROJECTION_FILE, NC14_ANCHOR, NC14_BREAK) });
  const seen = evaluate(broken.context, `
    const media = productionMediaRecords({ project: P, scan: SCAN, jobs: [] });
    return {
      source: media.records.filter((row) => row.scope === "shot").map((row) => row.file.name),
      queue: returnedReviewProjectionForBrowser().queue.map((row) => row.candidate.name),
    };
  `);
  const card = cardOf(broken.context.document.getElementById("main").innerHTML);

  deepEqualLoose(seen.source, ["Z.png", "A.png"], "NC-RM14: the authoritative input returned Z first");
  deepEqualLoose(seen.queue, ["A.png", "Z.png"], "NC-RM14: and the queue reversed it alphabetically");
  equal(card.file, "A.png", "NC-RM14: so the workspace opens the wrong one first");

  await mustFail("NC-RM14", "a true tie keeps the source order", () => {
    assert.deepStrictEqual(seen.queue, ["Z.png", "A.png"], "a true tie keeps the source order, and never sorts by name");
  });

  note("NC-RM14 restored filename ordering: source [Z.png, A.png] became queue [A.png, Z.png]");
}

/* ===========================================================================
   NC-RM15 — `view-review` IS SYNTHESISED INTO A CANDIDATE DECISION.
   =========================================================================== */

const NC15_ANCHOR = `  function reviewActionsFor(row) {
    const actions = list(row.actions).map((id) => text(id));
    return deepFreeze(RETURNED_REVIEW_DECISION_ACTIONS.filter((id) => actions.includes(id)));
  }`;
const NC15_BREAK = `  function reviewActionsFor(row) {
    const actions = list(row.actions).map((id) => text(id));
    const out = RETURNED_REVIEW_DECISION_ACTIONS.filter((id) => actions.includes(id));
    if (actions.includes("view-review")) out.splice(1, 0, "revise");
    return deepFreeze(out);
  }`;

async function ncRM15() {
  anchorIn(PROJECTION_FILE, NC15_ANCHOR, "NC-RM15");
  const project = projectOf([{ id: "L1-01", candidates: [candidate("FRAME_A.png")] }]);
  const scan = scanWith(project, { "L1-01": ["FRAME_A.png"] });
  const broken = await render("#/shot/L1-01", project, { scan, mutateSource: replacing(PROJECTION_FILE, NC15_ANCHOR, NC15_BREAK) });
  const seen = evaluate(broken.context, `
    const item = returnedReviewProjectionForBrowser().queue[0];
    return { actions: item.actions, declared: PRODUCTION_MEDIA_ACTIONS.map((row) => row.id) };
  `);
  const card = cardOf(broken.context.document.getElementById("main").innerHTML);

  ok(!seen.declared.includes("revise"), "NC-RM15: production-media declares no revise action");
  ok(seen.actions.includes("revise"), "NC-RM15: yet the projection claims it as a candidate decision: " + seen.actions.join(", "));
  ok(card.actionSources.some(([id, source]) => id === "revise" && source === "decision"),
    "NC-RM15: and the surface presents it as one");

  await mustFail("NC-RM15", "two declared decisions", () => {
    assert.deepStrictEqual(seen.actions, ["approve", "reject"], "a frame candidate declares two declared decisions");
  });

  note("NC-RM15 restored the synthesised action: view-review became a candidate decision called revise, which production-media never declared");
}

/* ===========================================================================
   NC-RM16 — A MOTION REVISE REQUEST SILENTLY NO-OPS.
   =========================================================================== */

const NC16_ANCHOR = `  if (!verdict.allowed) return toast(returnedReviewRefusalWords(verdict.reason));`;
const NC16_BREAK = `  if (!verdict.allowed) return;`;

async function ncRM16() {
  anchorIn(CARD_FILE, NC16_ANCHOR, "NC-RM16");
  const project = projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A", winner: "FRAME_A.png" }],
    clips: [{ id: "motion-a", label: "A", suffix: "a", title: "Panel check", kind: "i2v", fromFrame: "frame-a", toFrame: "", dur: 5, motionPrompt: "He checks the panel.", generationPackages: [] }],
    candidates: [candidate("FRAME_A.png"), candidate("SHOT_MOTION_1.mp4", { frameId: "", addedAt: "2026-08-20T12:00:00.000Z" })],
  }]);
  const scan = scanWith(project, { "L1-01": ["FRAME_A.png", "SHOT_MOTION_1.mp4"] });
  const broken = await render("#/shot/L1-01", project, { scan, mutateSource: replacing(CARD_FILE, NC16_ANCHOR, NC16_BREAK) });
  let spoken = "";
  broken.context.toast = (message) => { spoken = message; };
  const key = evaluate(broken.context, `return returnedReviewProjectionForBrowser().queue[0].key;`);
  broken.context.reviseReturnedResult("L1-01", key);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const modal = broken.context.document.getElementById("modal").innerHTML;

  equal(spoken, "", "NC-RM16: asking to revise a returned video says nothing at all");
  equal(modal, "", "NC-RM16: and opens nothing, so the control is indistinguishable from a broken one");

  await mustFail("NC-RM16", "in the filmmaker's words", () => {
    assert.strictEqual(spoken, "Revise is not available for Motion results.", "the refusal is spoken in the filmmaker's words");
  });

  note("NC-RM16 restored the silent no-op: a Motion revise request produced no message and no dialog");
}

/* ===========================================================================
   NC-RM18 — `machine-selected` IS REPORTED AS `human-approved`.
   =========================================================================== */

const NC18_ANCHOR = `    if (state === "machine-selected") return "machine-selected";`;
const NC18_BREAK = `    if (state === "machine-selected") return "human-approved";`;

async function ncRM18() {
  anchorIn(PROJECTION_FILE, NC18_ANCHOR, "NC-RM18");
  const project = projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A", winner: "AUTO.png" }],
    candidates: [candidate("AUTO.png")],
  }]);
  project.shots[0].generationRecords = [{ file: "AUTO.png", approval: "automatic" }];
  const scan = scanWith(project, { "L1-01": ["AUTO.png"] });
  const broken = await render("#/shot/L1-01", project, { scan, mutateSource: replacing(PROJECTION_FILE, NC18_ANCHOR, NC18_BREAK) });
  const seen = evaluate(broken.context, `
    const media = productionMediaRecords({ project: P, scan: SCAN, jobs: [] });
    return {
      mediaState: media.records.find((row) => row.file.name === "AUTO.png").humanDecision.state,
      settled: returnedReviewProjectionForBrowser().items.map((row) => row.candidate.name + ":" + row.settled),
      actor: media.records.find((row) => row.file.name === "AUTO.png").humanDecision.actor.value,
    };
  `);

  equal(seen.mediaState, "machine-selected", "NC-RM18: production-media knows a machine selected it");
  equal(seen.actor, "automation", "NC-RM18: and names automation as the actor");
  deepEqualLoose(seen.settled, ["AUTO.png:human-approved"],
    "NC-RM18: yet the returned-review reason calls it a human approval");

  await mustFail("NC-RM18", "the returned-review reason says the same thing", () => {
    assert.deepStrictEqual(seen.settled, ["AUTO.png:machine-selected"],
      "the returned-review reason says the same thing production-media does");
  });

  note("NC-RM18 restored the untruthful label: an automation pick reported human-approved while the actor on record was automation");
}
/* ===========================================================================
   NC-RM19 — A HISTORICALLY SETTLED CANDIDATE COMES BACK AS CURRENT WORK.

   The second independent review's P0, restored exactly: the missing-media path asks two
   string checks instead of the settlement question the media-present path asks. C1 was
   picked, C2 later superseded it, somebody cleaned up C1's old file — and a decision
   taken long ago reappears as a current integrity blocker that Production reports as the
   thing to do next.
   =========================================================================== */

const NC19_ANCHOR = `        if (candidateSettlement(fact, fact.pickedByEdge ? fact : (unit && unit.pickRow), lineage)) continue;`;
const NC19_BREAK = `        if (text(row.decision) === "rejected" || text(row.decision) === "shortlist") continue;`;

async function ncRM19() {
  anchorIn(PROJECTION_FILE, NC19_ANCHOR, "NC-RM19");
  /* 1. C1 was historically picked, and 2. C2 subsequently became current. Both facts are
        written by withCanon() through the shipped receipt shape, not asserted here. */
  const project = projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A", winner: "C2.png" }],
    candidates: [
      candidate("C1.png"),
      candidate("C2.png", { addedAt: "2026-08-20T11:00:00.000Z" }),
    ],
  }]);
  /* 3. Only C1's bytes are removed. C2 is still on disk and still current. */
  const scan = scanWith(project, { "L1-01": ["C2.png"] });
  const broken = await render("#/production", project, { scan, mutateSource: replacing(PROJECTION_FILE, NC19_ANCHOR, NC19_BREAK) });
  const seen = evaluate(broken.context, `
    const projection = returnedReviewProjectionForBrowser();
    return {
      blockers: projection.blockers.map((row) => row.candidate.name + ":" + row.unreviewable + ":" + row.blocking),
      unavailable: projection.counts.unavailable,
      items: projection.items.map((row) => row.candidate.name + ":" + (row.settled || "waiting")),
      winner: P.shots[0].keyframes[0].winner || "",
      canon: hasCurrentHumanAuthority(P, { kind: "shot-frame", shotId: "L1-01", frameId: "frame-a" }),
      rows: P.shots[0].candidateFiles.map((row) => row.stored + ":" + row.decision),
      next: projectNextProductionAction(),
    };
  `);
  const shotPage = await render("#/shot/L1-01", project, { scan, mutateSource: replacing(PROJECTION_FILE, NC19_ANCHOR, NC19_BREAK) });
  const card = cardOf(shotPage.context.document.getElementById("main").innerHTML);

  /* 4. THE LITERAL BAD STATE. C2 is current and approved; C1 was decided long ago; and
        the project is being told its next act is about C1. */
  equal(seen.winner, "C2.png", "NC-RM19: C2 is the current pick");
  equal(seen.canon, true, "NC-RM19: and holds Canon");
  ok(seen.items.includes("C2.png:human-approved"), "NC-RM19: which the projection reports");
  deepEqualLoose(seen.rows, ["C1.png:unreviewed", "C2.png:unreviewed"],
    "NC-RM19: and neither row carries a rejected/shortlist word for the string checks to catch");
  deepEqualLoose(seen.blockers, ["C1.png:media-not-available:true"],
    "NC-RM19: yet the superseded historical candidate is a current integrity blocker");
  equal(seen.unavailable, 1, "NC-RM19: counted as unaccounted-for current work");
  equal(seen.next.kind, "returned-media-unavailable",
    "NC-RM19: and Production reports it as the thing to do next");
  ok(/C1\.png/.test(seen.next.message), "NC-RM19: naming a file that was settled two decisions ago");
  equal(card.unavailable, true, "NC-RM19: while the shot workspace gives it the card");
  ok(/file is missing/i.test(card.headline), "NC-RM19: reading " + JSON.stringify(card.headline));

  /* 5. AND THE HISTORICAL-SETTLEMENT INVARIANT GOES RED FOR IT. */
  await mustFail("NC-RM19", "the superseded historical candidate raises no current blocker", () => {
    assert.deepStrictEqual(seen.blockers, [],
      "the superseded historical candidate raises no current blocker");
  });

  note(`NC-RM19 restored settled-history resurrection: C2 held Canon while Production reported ${seen.blockers[0]} as current work`);
}
/* ===========================================================================
   AND THE SHIPPED BUILD IS GREEN ON EVERY CLAIM THE CONTROLS BROKE.
   =========================================================================== */

async function shippedBuildIsGreen() {
  const project = projectOf([{ id: "L1-01", candidates: [candidate("FRAME_A.png")] }], {
    canon: CAST_CANON.filter((row) => row.entityId !== "KAI"),
  });
  const page = await render("#/shot/L1-01", project, { scan: scanWith(project, { "L1-01": ["FRAME_A.png"] }) });
  const card = cardOf(page.context.document.getElementById("main").innerHTML);
  requireReviewOwnsWorkspace(card, "shipped");
  requireReadinessSurvivesAsSecondary(card, "confirm-existing-reference", "shipped");
  const named = evaluate(page.context, `return projectNextProductionAction().reviewKey;`);
  equal(card.key, named, "shipped: the route and the card resolve the same candidate");

  const repair = repairProject();
  const repairPage = await render("#/shot/L1-01", repair, { scan: scanWith(repair, REPAIR_SCAN) });
  const repairCard = cardOf(repairPage.context.document.getElementById("main").innerHTML);
  equal(repairCard.file, "C2.png", "shipped: the repair leads");
  equal(repairCard.repair, true, "shipped: and is declared as one");
  ok(repairCard.markup.includes("Before"), "shipped: with its parent on the card");

  note("the shipped build is green on every claim these controls broke");
}


/* ===========================================================================
   NC-RM20 — AN APPROVAL CLAIMS AN ASSIGNMENT IT DID NOT MAKE.

   The shipped approval dialog names a target, and the frame it names can stop existing
   before the click completes — Remove Frame is a shipped control. Both canon branches
   wrote under `if (f)` / `if (c)` and then ran the entire success path regardless. This
   restores that, and requires the product to be caught saying so.
   =========================================================================== */

const APPROVAL_FILE = "public/library-tools.js";
const NC20_ANCHOR = `      if (!f) throw new Error("That frame is no longer part of this shot, so nothing was approved");
      canonTarget = { kind: "shot-frame", shotId: id, frameId: f.id };
      approveFrameCanon(P, { shotId: id, frameId: f.id, value: name, assetId: displayedAssetId, at, via: "shot-take-approval" });`;
const NC20_BREAK = `      if (f) canonTarget = { kind: "shot-frame", shotId: id, frameId: f.id };
      if (f) approveFrameCanon(P, { shotId: id, frameId: f.id, value: name, assetId: displayedAssetId, at, via: "shot-take-approval" });`;

async function ncRM20() {
  anchorIn(APPROVAL_FILE, NC20_ANCHOR, "NC-RM20");
  const project = projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A", winner: "A-CANON.png" }, { id: "frame-b", label: "B" }],
    candidates: [candidate("A-CANON.png", { decision: "shortlist" }), candidate("B1.png", { frameId: "frame-b" })],
  }]);
  const scan = scanWith(project, { "L1-01": ["A-CANON.png", "B1.png"] });
  const broken = await render("#/shot/L1-01", project, { scan, mutateSource: replacing(APPROVAL_FILE, NC20_ANCHOR, NC20_BREAK) });
  broken.context.approveGuidedFrame("L1-01", "frame-b", "B1.png");
  broken.context.document.getElementById("approve-target").value = "frame:frame-b";
  broken.context.document.getElementById("approve-name").value = "B1.png";
  vm.runInContext(`P.shots[0].keyframes = P.shots[0].keyframes.filter((frame) => frame.id !== "frame-b");`, broken.context);
  await broken.gesture.act(() => broken.context.confirmApproveTake());
  await new Promise((resolve) => setTimeout(resolve, 20));

  const seen = evaluate(broken.context, `
    const row = P.shots[0].candidateFiles.find((item) => item.stored === "B1.png");
    return {
      spoken: document.getElementById("toast").textContent,
      receipts: (P.productionAuthority.receipts || []).filter((entry) => entry.kind === "shot-frame" && entry.status === "current").map((entry) => entry.frameId + "=" + entry.value),
      approvedTarget: row.approvedTarget || "",
      workflowStatus: P.shots[0].workflowStatus,
      status: P.shots[0].status,
    };
  `);

  /* THE MUTATION LANDED AND THE WRONG BEHAVIOUR IS OBSERVABLE. */
  equal(seen.receipts.join(","), "frame-a=A-CANON.png", "NC-RM20: the broken build mints no receipt for the frame that is gone");
  ok(/added to the live Bible|remaining frame or motion decisions/.test(seen.spoken),
    "NC-RM20: and still speaks a success sentence: " + seen.spoken);
  equal(seen.approvedTarget, "frame:frame-b", "NC-RM20: recording a durable approval target with no receipt behind it");
  equal(seen.workflowStatus, "APPROVED", "NC-RM20: and reporting the shot approved");
  equal(seen.status, "LOCKED", "NC-RM20: and locked");

  /* AND THE INTENDED DETECTOR CATCHES IT FOR THE RIGHT REASON. */
  await mustFail("NC-RM20", "success sentence", () => {
    assert(!/added to the live Bible|remaining frame or motion decisions/.test(seen.spoken),
      "AS1: and never speaks either success sentence: " + seen.spoken);
  });
  await mustFail("NC-RM20", "records no approval target", () => {
    assert.strictEqual(seen.approvedTarget, "", "AS1: and the candidate row records no approval target");
  });

  note("NC-RM20 restored the silent fallthrough: nothing was approved, and the product said the required outputs were approved, locked the shot and recorded the target");
}

/* ===========================================================================
   NC-RM21 — REJECT IS OFFERED ON AN APPROVED CANDIDATE.

   `reject` applied whenever the row was not already REJECTED, so an APPROVED one — a
   file holding a current human receipt — still declared it, and the Inspector renders
   the declared list.
   =========================================================================== */

const MEDIA_FILE = "public/shared-production-media.js";
const NC21_ANCHOR = `      appliesWhen: "undecided",`;
const NC21_BREAK = `      appliesWhen: "not-rejected",`;

async function ncRM21() {
  anchorIn(MEDIA_FILE, NC21_ANCHOR, "NC-RM21");
  const project = projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A", winner: "C1.png" }],
    candidates: [candidate("C1.png", { decision: "shortlist" })],
  }]);
  const scan = scanWith(project, { "L1-01": ["C1.png"] });
  const broken = await render("#/shot/L1-01", project, { scan, mutateSource: replacing(MEDIA_FILE, NC21_ANCHOR, NC21_BREAK) });
  const seen = evaluate(broken.context, `
    const media = productionMediaRecords({ project: P, scan: SCAN });
    const row = media.records.find((item) => item.file.name === "C1.png");
    return { role: row.disposition.role, actions: row.actions };
  `);

  equal(seen.role, "approved", "NC-RM21: the candidate still holds the frame's approval");
  ok(seen.actions.includes("reject"), "NC-RM21: and the broken build declares reject on it: " + seen.actions.join(","));
  ok(!seen.actions.includes("approve"), "NC-RM21: while still withholding a second approve — the asymmetry this control is about");

  await mustFail("NC-RM21", "declares no reject on it", () => {
    assert(!seen.actions.includes("reject"), "RJ1: so production-media declares no reject on it: " + seen.actions.join(","));
  });

  note("NC-RM21 restored the asymmetry: an approved candidate declared reject while withholding approve, so the Inspector drew Keep looking on the shot's own approved frame");
}

/* ===========================================================================
   NC-RM22 — AND THE WRITE GOES THROUGH, so the contradiction becomes durable.

   Both halves are reverted together on purpose. The writer refuses on the disposition
   AND on the declared action list, which is defence in depth rather than duplication:
   with only one restored the other still refuses, and a control that could not tell
   which guard held would be proving nothing about either.
   =========================================================================== */

const NC22_ANCHOR = `  if (item && item.candidate.disposition === "approved")
    return toast("That take is approved for this shot. Reset the frame approval to change it.");`;
const NC22_BREAK = `  if (false)
    return toast("That take is approved for this shot. Reset the frame approval to change it.");`;

async function ncRM22() {
  anchorIn(CARD_FILE, NC22_ANCHOR, "NC-RM22");
  anchorIn(MEDIA_FILE, NC21_ANCHOR, "NC-RM22");
  const project = projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A", winner: "C1.png" }],
    candidates: [candidate("C1.png", { decision: "shortlist" })],
  }]);
  const scan = scanWith(project, { "L1-01": ["C1.png"] });
  const broken = await render("#/shot/L1-01", project, {
    scan,
    mutateSource: replacingAll([
      [CARD_FILE, NC22_ANCHOR, NC22_BREAK],
      [MEDIA_FILE, NC21_ANCHOR, NC21_BREAK],
    ]),
  });
  await broken.gesture.act(() => broken.context.rejectReturnedResult("L1-01", "C1.png"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const seen = evaluate(broken.context, `
    const projection = returnedReviewProjectionForBrowser();
    return {
      decision: P.shots[0].candidateFiles[0].decision,
      canon: hasCurrentHumanAuthority(P, { kind: "shot-frame", shotId: "L1-01", frameId: "frame-a" }),
      disposition: projection.items.map((row) => row.candidate.name + ":" + row.candidate.disposition),
    };
  `);

  equal(seen.decision, "rejected", "NC-RM22: the broken build records the rejection on the row");
  equal(seen.canon, true, "NC-RM22: while the receipt it holds still says approved");
  equal(seen.disposition.join(","), "C1.png:approved", "NC-RM22: so one file reports two dispositions at once");

  await mustFail("NC-RM22", "records no rejection", () => {
    assert.strictEqual(seen.decision, "shortlist", "RJ2: the candidate row records no rejection");
  });

  note("NC-RM22 restored the durable contradiction: the same file recorded REJECTED on its candidate row while holding a current approval receipt");
}

/* =========================================================================== */

async function main() {
  await ncRM1();
  await ncRM2();
  await ncRM3();
  await ncRM4();
  await ncRM5();
  await ncRM6();
  await ncRM7();
  await ncRM8();
  await ncRM9();
  await ncRM10();
  await ncRM11();
  await ncRM12();
  await ncRM13();
  await ncRM14();
  await ncRM15();
  await ncRM16();
  await ncRM18();
  await ncRM19();
  await ncRM20();
  await ncRM21();
  await ncRM22();
  await shippedBuildIsGreen();

  for (const line of notes) console.log(line);
  console.log(`returned-media-ownership-negative-controls: ${checks} assertions passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

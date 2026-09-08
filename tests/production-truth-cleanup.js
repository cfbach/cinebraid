/* PRODUCTION TRUTH CLEANUP V1 — three surfaces that said something the truth
 * layer denied.
 *
 * Each part below is one already-diagnosed defect, its invariant, and the truth
 * table that makes the invariant testable rather than merely stated.
 *
 *   PT1  DF-04. The entity approval modal's continuation dropdown offered
 *        `Edit Opened · currently approved` while the authority projection
 *        classified that same state `Historic · not approved for production`.
 *        The wording came from `item.approvedFile` — a POINTER a state can hold
 *        with no receipt behind it. FILE ASSIGNMENT IS NOT APPROVAL.
 *
 *   PT2  A FLAG surfaced as an affirmative recommendation in two places:
 *        Generated Media painted `AI SUGGESTED` from `aiRecommendation.state ===
 *        "known"`, which tests whether a review EXISTS rather than what it
 *        CONCLUDED; and the automation human-review gate called a flagged winner
 *        `APPROVE SUGGESTED` with a `N/100 suggested` header, because `winner`
 *        means "best of this pass" and a gate is also reached by exhausting the
 *        authorized rounds with nothing passing.
 *
 *   PT3  PK2-DURATION-UNKNOWN-REPRESENTATION. Project Builder distinguishes a
 *        planned duration from an unplanned one and refused, unprompted, to
 *        invent durations from a beat sheet's timecodes — but the representation
 *        required a number, so "undecided" was stored as `dur: 0` on 34 of 34
 *        Tideglass shots. `0` is a length, and it was printed as one and totalled
 *        as one.
 *
 * TWO OF THE THREE CARRY A CORRECTION, and the corrections are the sharper half
 * of what this suite holds:
 *
 *   PT1-C1  the first repair asked the projection instead of `approvedFile`, but
 *           entityStateTruth() still SUBSTITUTED `{ canon: [], historic: [] }` when
 *           the projection could not be evaluated. That is a complete answer, not
 *           a missing one: a state holding a current approval came back `missing`
 *           and was offered as `needs reference`. Not knowing and knowing there is
 *           nothing are different facts.
 *
 *   PT3-C1  the Bible is the shipped consumer of the retained `dur: 0`. A shot
 *           with units [6s, untimed] projects as `[6, 0]`, the aggregate summed
 *           that to 6, and the heading published `Cold open · 6s` — a
 *           complete-looking answer in the document a production is run from.
 *
 * WHAT EACH PART IS RUN AGAINST. Nothing here asserts against a hand-built row
 * where real code could produce one: PT1 opens the SHIPPED modal through the
 * shipped command, PT2 builds its cards from the REAL projection and its gate
 * markup from the REAL run renderer, and PT3's round trip goes through a REAL
 * server process, the real import routes and the file the importer actually
 * writes to disk.
 *
 * Provider calls made by this suite: 0. Nothing here dispatches a generation and
 * no route in any of these paths can.
 */
const assert = require("assert");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const { render, rawFixture, buildFixture, withCanon } = require("./render-harness");
const Entities = require(path.join(PUBLIC, "shared-entities.js"));
const BibleCanon = require(path.join(PUBLIC, "shared-bible-canon.js"));

let checks = 0;
const notes = [];
const ok = (value, message) => { assert.ok(value, message); checks++; };
const eq = (actual, expected, message) => { assert.strictEqual(actual, expected, message); checks++; };
const note = (line) => notes.push(line);

/* ==========================================================================
   PT1 — THE APPROVAL SURFACE READS THE AUTHORITY LAYER.

   The fixture is the dogfood's own shape: one entity, one state holding real
   Canon, one state holding a POINTER and no receipt, one state holding neither.
   The projection classifies all three and the modal has to agree with it.
   ========================================================================== */

const PT1_SCAN = {
  anchors: [
    { name: "KAI-ANCHOR.png", url: "/assets/anchors/KAI-ANCHOR.png" },
    { name: "KAI-OPENED.png", url: "/assets/anchors/KAI-OPENED.png" },
  ],
  plates: [], props: [], vehicles: [], audio: [], media: [], shots: {},
};

function pt1Project({ openedIsCanon }) {
  const project = rawFixture();
  const kai = project.characters[0];
  kai.approvedFile = "KAI-ANCHOR.png";
  kai.continuityStates = [
    { id: "state-default", name: "Default", isDefault: true, approvedFile: "KAI-ANCHOR.png" },
    /* THE DEFECT'S OWN ROW: a file is assigned and nobody approved it. */
    { id: "state-opened", name: "Opened", parentStateId: "state-default", approvedFile: "KAI-OPENED.png" },
    { id: "state-blank", name: "Blank", parentStateId: "state-default", approvedFile: "" },
  ];
  kai.candidateFiles = [
    { stored: "KAI-ANCHOR.png", original: "KAI-ANCHOR.png", decision: "unreviewed", coverageJobType: "single-reference" },
    { stored: "KAI-OPENED.png", original: "KAI-OPENED.png", decision: "unreviewed", coverageJobType: "single-reference" },
  ];
  const receipts = [{ kind: "entity-state", list: "characters", entityId: "KAI", stateId: "state-default", value: "KAI-ANCHOR.png" }];
  if (openedIsCanon)
    receipts.push({ kind: "entity-state", list: "characters", entityId: "KAI", stateId: "state-opened", value: "KAI-OPENED.png" });
  return withCanon(project, receipts);
}

async function pt1ContinuationOptions(openedIsCanon, { withdrawProjection = false } = {}) {
  const app = await render("#/character/KAI", pt1Project({ openedIsCanon }), { scan: PT1_SCAN });
  const truth = JSON.parse(vm.runInContext("JSON.stringify(entityProductionTruth(P,'characters','KAI'))", app.context));
  /* PT1-C1's condition, produced rather than described: the truth READER is
     present and the PROJECTION UNDER IT is not. Withdrawn after the fixture's
     receipts are read, so the assertions below know exactly what the modal is
     failing to see. */
  if (withdrawProjection)
    vm.runInContext("globalThis.entityProductionTruth = undefined; entityProductionTruth = undefined;", app.context);
  app.context.approveEntityFile("characters", "KAI", "KAI-ANCHOR.png", "state-default");
  const select = vm.runInContext(
    "(() => { const el = document.getElementById('entity-approve-next'); return el ? el.innerHTML : ''; })()",
    app.context,
  );
  return { truth, select };
}

async function checkApprovalWordingReadsAuthority() {
  /* CASE 1 — a state with an assigned file and NO current approval. */
  const historic = await pt1ContinuationOptions(false);
  ok(historic.select, "PT1: the continuation dropdown must render, or nothing below is being measured");

  /* The projection has to actually be calling this Historic, or the modal's
     agreement with it proves nothing. */
  eq(historic.truth.historic.map((row) => row.stateId).join(","), "state-opened",
    "PT1: the fixture must place the assigned-but-unapproved state in the projection's historic set");
  eq(historic.truth.canon.map((row) => row.stateId).join(","), "state-default",
    "PT1: and its canon set must hold only the receipt-backed state");

  const openedOption = historic.select.match(/<option value="state-opened">([^<]*)<\/option>/);
  ok(openedOption, "PT1: the historic state must still be offered as a continuation — it is real work, one click from canon");
  ok(!/currently approved/.test(openedOption[1]),
    `PT1: an assigned file with no receipt was called currently approved: ${openedOption[1]}`);
  ok(/historic, not approved/.test(openedOption[1]),
    `PT1: and must be named as the historic selection it is: ${openedOption[1]}`);

  const blankOption = historic.select.match(/<option value="state-blank">([^<]*)<\/option>/);
  ok(blankOption && /needs reference/.test(blankOption[1]),
    `PT1: a state with neither a receipt nor a pointer still needs a reference: ${blankOption && blankOption[1]}`);
  ok(!/currently approved/.test(historic.select),
    "PT1: nothing in this dropdown may claim an approval while the projection reports none");

  /* CASE 2 — THE POSITIVE CONTROL. A truthful "currently approved" must survive,
     or the repair is indistinguishable from deleting the phrase. */
  const canon = await pt1ContinuationOptions(true);
  eq(canon.truth.canon.length, 2, "PT1: the control fixture must genuinely hold two receipt-backed states");
  /* d25b4ce withholds an already-approved state from the continuation list by
     construction — "the ring that offered an already-approved parent after the final
     descendant cannot form" — so the vehicle this control used, an approved state
     appearing as an option, can no longer exist. Putting one back to satisfy the test
     would assert a behaviour the product deliberately removed.
     The control keeps its job through the projection the wording is bound to. The same
     state Case 1 proved is called "historic, not approved" WITHOUT a receipt is canon
     WITH one, so the phrase still has a subject and the repair is still
     distinguishable from having deleted it — and the state is withheld from the list
     rather than mislabelled inside it. */
  ok(canon.truth.canon.some((row) => row.stateId === "state-opened"),
    "PT1: with a receipt behind it the same state is canon, so the phrase still has a subject");
  ok(!/<option value="state-opened">/.test(canon.select),
    "PT1: and an already-approved state is withheld from the continuation list, never labelled inside it");
  ok(!/currently approved/.test(canon.select),
    "PT1: so this dropdown claims no approval it does not own");

  /* CASE 3 — PT1-C1. THE PROJECTION CANNOT BE EVALUATED.

     entityStateTruth() used to substitute `{ canon: [], references: [], historic: [] }`
     here, which is not a missing answer but a COMPLETE one: every state came back
     `missing`, so a state holding a current human approval was offered as
     `Edit Opened · needs reference`. Not knowing and knowing there is nothing are
     different facts, and the fixture is built so that they cannot be confused —
     the state under test genuinely HOLDS Canon, so any of the three authority
     phrases would be the projection being invented rather than read. */
  const unavailable = await pt1ContinuationOptions(true, { withdrawProjection: true });
  eq(unavailable.truth.canon.length, 2,
    "PT1-C1: the fixture must genuinely hold Canon on the state under test, or an unavailable reading proves nothing");
  ok(unavailable.select, "PT1-C1: the modal must still render — an unreadable projection is not a reason to show nothing");

  const unavailableOption = unavailable.select.match(/<option value="state-opened">([^<]*)<\/option>/);
  ok(unavailableOption, "PT1-C1: the state must still be offered as a continuation");
  ok(/approval state unavailable/.test(unavailableOption[1]),
    `PT1-C1: an unevaluable projection must say so: ${unavailableOption[1]}`);
  ok(!/needs reference/.test(unavailableOption[1]),
    `PT1-C1: an unavailable projection was read as an absence of approval truth: ${unavailableOption[1]}`);
  ok(!/currently approved/.test(unavailableOption[1]),
    `PT1-C1: nor may it be read as an approval: ${unavailableOption[1]}`);
  ok(!/historic, not approved/.test(unavailableOption[1]),
    `PT1-C1: nor as a historic selection: ${unavailableOption[1]}`);
  ok(!/needs reference/.test(unavailable.select),
    "PT1-C1: no option in this dropdown may claim a state needs a reference while the projection is unreadable");

  /* AND THE SEAM ITSELF, not only the one caller. `entityStateTruth()` is the
     shared reader; a repair that only patched the modal would leave the next
     reader to make the same mistake. */
  const seam = await render("#/character/KAI", pt1Project({ openedIsCanon: true }), { scan: PT1_SCAN });
  const readings = JSON.parse(vm.runInContext(`(() => {
    const entity = P.characters.find((row) => row.id === "KAI");
    const before = entityStateTruth("characters", entity);
    const openedBefore = before.of({ id: "state-opened" }).standing;
    globalThis.entityProductionTruth = undefined; entityProductionTruth = undefined;
    const after = entityStateTruth("characters", entity);
    return JSON.stringify({
      availableBefore: before.available, openedBefore,
      availableAfter: after.available, openedAfter: after.of({ id: "state-opened" }).standing,
      canonCountAfter: after.canonCount,
    });
  })()`, seam.context));
  eq(readings.availableBefore, true, "PT1-C1: a loaded projection reports itself available");
  eq(readings.openedBefore, "canon", "PT1-C1: and answers canon for a receipt-backed state");
  eq(readings.availableAfter, false, "PT1-C1: an unloaded projection reports itself unavailable");
  eq(readings.openedAfter, "unavailable",
    "PT1-C1: and answers `unavailable` rather than a standing it cannot support");
  eq(readings.canonCountAfter, 0,
    "PT1-C1: its counts are empty, which is exactly why `available` and not a count has to be the question");

  note("PT1: the approval modal's continuation wording comes from the authority projection — an assigned file with no receipt reads Historic, a receipt-backed state reads currently approved, and a state with neither needs a reference");
  note("PT1-C1: an authority projection that cannot be evaluated reads `approval state unavailable` at the modal and `unavailable` at the shared seam — never needs-reference, historic or approved");
}

/* ==========================================================================
   PT2a — GENERATED MEDIA. THE CHIP READS THE VERDICT, NOT ITS EXISTENCE.

   Built from the real projection so the mapping under test is the shipped one:
   a shot triage `pass:false` becomes the recommendation `correct`, and `state`
   is "known" for that exactly as it is for `approve`. That equality is the whole
   defect, so it is asserted before the cards are read.
   ========================================================================== */

const readSource = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const esc = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function publicRequire(specifier) {
  return require(specifier.startsWith("./") ? path.join(PUBLIC, specifier.slice(2)) : specifier);
}
function loadProjection(source = readSource(path.join(PUBLIC, "shared-production-media.js"))) {
  const context = vm.createContext({ module: { exports: {} }, require: publicRequire, console });
  context.globalThis = context;
  vm.runInContext(source, context, { filename: "shared-production-media.js" });
  return context.module.exports;
}
function loadResults(PM, source = readSource(path.join(PUBLIC, "media-results.js"))) {
  const context = vm.createContext({ console, esc, attr: esc, plural: (n, w) => `${n} ${w}${n === 1 ? "" : "s"}` });
  context.window = context;
  context.globalThis = context;
  Object.assign(context, PM);
  vm.runInContext(source, context, { filename: "media-results.js" });
  return context.window.CineBraidResults;
}

const PT2_ISO = (day) => `2026-08-${String(day).padStart(2, "0")}T12:00:00.000Z`;
const PT2_TAKE = (name) => ({ name, url: `/assets/shots/SH010/takes/${name}` });

/* Four candidates, one per row of the truth table. The approved one is
   deliberately the FLAGGED file: a human overruling a flag is the case where an
   affirmative AI chip would be most misleading. */
function pt2Project() {
  return {
    meta: { title: "Production truth cleanup" },
    characters: [], locations: [], props: [], vehicles: [], audio: [], mediaAssets: [],
    scenes: [{ id: "SC01", title: "Hull" }],
    shots: [{
      id: "SH010", scene: "SC01", title: "Hull check",
      keyframes: [{ id: "kf-a", label: "A", winner: "HUMAN_APPROVED.png" }],
      clips: [],
      candidateFiles: [
        { stored: "PASSING.png", addedAt: PT2_ISO(1), decision: "unreviewed",
          aiReview: { score: 91, pass: true, notes: "Identity holds.", reviewedAt: PT2_ISO(1) } },
        { stored: "FLAGGED.png", addedAt: PT2_ISO(2), decision: "unreviewed",
          aiReview: { score: 62, pass: false, notes: "Camera height drifts.", reviewedAt: PT2_ISO(2) } },
        { stored: "UNREVIEWED.png", addedAt: PT2_ISO(3), decision: "unreviewed" },
        { stored: "HUMAN_APPROVED.png", addedAt: PT2_ISO(4), decision: "shortlist",
          approvedAt: PT2_ISO(5), approvedTarget: "frame:kf-a", frameId: "kf-a",
          aiReview: { score: 58, pass: false, notes: "Reviewer disagreed.", reviewedAt: PT2_ISO(4) } },
      ],
    }],
  };
}
const PT2_SCAN = {
  anchors: [], plates: [], props: [], vehicles: [], audio: [], media: [],
  shots: { SH010: { takes: ["PASSING.png", "FLAGGED.png", "UNREVIEWED.png", "HUMAN_APPROVED.png"].map(PT2_TAKE), blocking: [], locked: [] } },
};

function pt2Rows(PM) {
  /* The human approval is a RECEIPT, minted by the harness's own ledger builder.
     A raw `winner` pointer with nothing behind it is Historic, not approved — which
     is PT1's subject, and using it here would test the wrong row. */
  const project = withCanon(pt2Project(), [
    { kind: "shot-frame", shotId: "SH010", frameId: "kf-a", value: "HUMAN_APPROVED.png" },
  ]);
  const built = PM.productionMediaRecords({ project, scan: PT2_SCAN, jobs: [] });
  const byName = (name) => built.records.find((row) => row.file.name === name);
  return { built, byName };
}

function checkFlagIsNeverSuggested() {
  const PM = loadProjection();
  const Results = loadResults(PM);
  const { built, byName } = pt2Rows(PM);
  eq(built.records.length, 4, "PT2a: all four candidates must reach the projection, or the table has holes");

  const passing = byName("PASSING.png");
  const flagged = byName("FLAGGED.png");
  const unreviewed = byName("UNREVIEWED.png");
  const approved = byName("HUMAN_APPROVED.png");

  /* THE DEFECT, STATED AS DATA. `state` is the field the old condition read and
     it cannot separate these two. If this equality ever stops holding, the
     original bug report stops describing this code and this suite should be
     re-read rather than trusted. */
  eq(passing.aiRecommendation.state, "known", "PT2a: a passing review is recorded");
  eq(flagged.aiRecommendation.state, "known", "PT2a: and so is a flagged one — `state` cannot tell them apart");
  eq(passing.aiRecommendation.value, "approve", "PT2a: a shot triage pass is the suggestion `approve`");
  eq(flagged.aiRecommendation.value, "correct", "PT2a: and a triage flag is the suggestion `correct`");
  eq(unreviewed.aiRecommendation.state, "not-recorded", "PT2a: an unreviewed candidate records no suggestion at all");

  const card = (row) => Results.cardMarkup(row);

  /* PASS — affirmative wording is earned. */
  ok(/AI SUGGESTED/.test(card(passing)), "PT2a: a passing review may be shown as a suggestion");
  ok(!/AI FLAGGED/.test(card(passing)), "PT2a: and must not also be shown as flagged");

  /* FLAG — the row this whole part exists for. */
  const flaggedCard = card(flagged);
  ok(!/AI SUGGESTED/.test(flaggedCard), "PT2a: a FLAG was promoted into an affirmative suggestion");
  ok(!/\bPASS\b/.test(flaggedCard), "PT2a: and must not be shown as a pass");
  ok(!/Ready to approve|Recommended/i.test(flaggedCard), "PT2a: nor as ready or recommended");
  ok(/AI FLAGGED/.test(flaggedCard), "PT2a: a flagged review is still shown — under a word that says what it is");
  ok(/>CANDIDATE</.test(flaggedCard), "PT2a: and the status chip still prints the disposition alone");

  /* NO REVIEW — neither word. Silence is the only honest answer. */
  const unreviewedCard = card(unreviewed);
  ok(!/AI SUGGESTED/.test(unreviewedCard) && !/AI FLAGGED/.test(unreviewedCard),
    "PT2a: a candidate nobody reviewed must carry no AI verdict of any kind");

  /* HUMAN APPROVAL — stronger than every AI signal, and never re-litigated by
     one. The card says APPROVED and offers no AI verdict beside it. */
  const approvedCard = card(approved);
  eq(approved.disposition.role, "approved", "PT2a: the fixture's human approval must actually be an approval");
  eq(approved.aiRecommendation.value, "correct", "PT2a: over a candidate the reviewer flagged");
  ok(/>APPROVED</.test(approvedCard), "PT2a: the human decision leads");
  ok(!/AI SUGGESTED/.test(approvedCard) && !/AI FLAGGED/.test(approvedCard),
    "PT2a: and approved media does not advertise an AI verdict beside it");

  note("PT2a: Generated Media reads the recommendation's VALUE — PASS may be suggested, FLAG is named as flagged, an unreviewed candidate carries neither, and a human approval overrides both");
}

/* ==========================================================================
   PT2b — THE AUTOMATION HUMAN-REVIEW GATE.

   v627PauseForHumanReview is reached two ways: a strong pass, and running out of
   authorized rounds with nothing passing. On the second arm `step.winner` is
   whatever scored best in a set nothing passed — and the gate called it the
   suggestion.
   ========================================================================== */

const PT2_GATE_RUN = (pass) => `
  AUTOMATION_RUNS=[{id:'run-gate',revision:1,type:'shot-chain',targetId:'L1-01',scope:'stills',status:'awaiting-review',
    stage:'Approve Frame B',createdAt:'2026-08-17T10:00:00Z',config:{frameRounds:2,maxImages:9},usage:{imagesGenerated:4},
    current:{stepKey:'frame:frame-b:round-2:review'},
    steps:{'frame:frame-b:round-2:review':{key:'frame:frame-b:round-2:review',status:'needs-review',kind:'frame-review',
      label:'Frame B review',frameId:'frame-b',attempt:2,maxAttempts:2,winner:'FRAME_B.png',score:79,
      files:['FRAME_A.png','FRAME_B.png'],
      review:{reviews:[{n:1,pass:false,score:55,notes:'Identity drift.'},{n:2,pass:${pass},score:79,notes:'Endpoint option.'}]},
      result:{autoApprove:false,threshold:85}}},logs:[]}];`;

async function pt2GateMarkup(pass) {
  const app = await render("#/shot/L1-01", buildFixture());
  vm.runInContext(PT2_GATE_RUN(pass), app.context);
  const html = vm.runInContext("v627HumanReviewMarkup(v626Runs()[0])", app.context);
  const suggested = vm.runInContext(
    "JSON.stringify(v627ReviewCandidates(v626Runs()[0], v626Runs()[0].steps['frame:frame-b:round-2:review'])"
    + ".map((c) => [c.file, c.pass, v670CandidateIsSuggested(v626Runs()[0].steps['frame:frame-b:round-2:review'], c)]))",
    app.context,
  );
  return { html, suggested: JSON.parse(suggested) };
}

async function checkGateNeverSuggestsAFlag() {
  /* THE CONTROL FIRST: a winner the reviewer passed is still the suggestion, so
     the repair cannot have worked by disabling the offer. */
  const passing = await pt2GateMarkup(true);
  ok(/HUMAN REVIEW GATE/.test(passing.html), "PT2b: the gate must render, or nothing below is measured");
  assert.deepStrictEqual(passing.suggested.map((row) => row[2]), [false, true],
    "PT2b: only the winning candidate is the suggestion, and it passed");
  ok(/APPROVE SUGGESTED/.test(passing.html), "PT2b: a passing winner may still be offered as the suggestion");
  ok(/\/100 suggested/.test(passing.html), "PT2b: and the header may say so");
  checks += 1;

  /* THE DEFECT'S OWN CASE: same run, same winner, flagged. */
  const flagged = await pt2GateMarkup(false);
  assert.deepStrictEqual(flagged.suggested.map((row) => row[2]), [false, false],
    "PT2b: a flagged winner was still classified as the suggestion");
  checks += 1;
  ok(!/APPROVE SUGGESTED/.test(flagged.html), "PT2b: a FLAG was offered under affirmative approval wording");
  ok(!/class="suggested"/.test(flagged.html), "PT2b: and must not be styled as the suggested card");
  ok(!/\/100 suggested/.test(flagged.html), "PT2b: nor may the header claim a suggestion the gate does not have");
  ok(/NO CANDIDATE SUGGESTED/.test(flagged.html), "PT2b: the header must say what is actually true instead");
  ok(/FLAGGED BY AI REVIEW/.test(flagged.html), "PT2b: naming the AI's own verdict rather than hiding it");

  /* AND HUMAN APPROVAL IS STILL POSSIBLE. The distinction being preserved is
     between an AI's assessment and a filmmaker's act — removing the act would be
     a different defect, not a repair. */
  ok(/APPROVE THIS/.test(flagged.html), "PT2b: approving a flagged candidate stays available as an explicit human act");
  ok(/flagged/.test(flagged.html), "PT2b: and the candidate's own line still reports the flag");
  ok(/never approves a reference on its own/.test(flagged.html),
    "PT2b: the gate still states that an assistant suggestion is not canon");

  note("PT2b: the automation gate suggests only a candidate the reviewer passed; a flagged winner keeps its score, its flag and an explicit human approval, and loses every affirmative word");
}

/* ==========================================================================
   PT3a — THE REPRESENTATION, AS A CONTRACT.

   Three states and no fourth: declared (a positive finite number), unknown
   (null/absent/""/0 — shotDurationAlias()'s shipped rule, unchanged), and the
   totals that must not collapse the second into the first.
   ========================================================================== */

function checkDurationContract() {
  const declared = [1, 4, 0.5, 120];
  for (const seconds of declared)
    eq(Entities.shotDurationIsDeclared({ dur: seconds }), true, `PT3a: ${seconds}s is a declared duration`);

  const unknown = [null, undefined, "", 0, -1, NaN, "soon", {}];
  for (const value of unknown)
    eq(Entities.shotDurationIsDeclared({ dur: value }), false,
      `PT3a: ${JSON.stringify(value) ?? String(value)} is not a declared duration`);
  eq(Entities.shotDurationIsDeclared({}), false, "PT3a: an absent key is not a declared duration");

  /* WORDS. The unknown case is the one that used to read `0s`. */
  eq(Entities.shotDurationWords({ dur: 8 }), "8s", "PT3a: a declared duration reads as a length");
  eq(Entities.shotDurationWords({ dur: null }), "duration not set", "PT3a: an unknown duration says so");
  eq(Entities.shotDurationWords({ dur: 0 }), "duration not set", "PT3a: and a stored zero is the same fact, not a zero-second shot");
  eq(Entities.shotDurationWords({}, "not planned"), "not planned", "PT3a: the caller may name the absence in its own words");

  /* THE SHOT'S OWN ANSWER, with the precedence resolveShotDuration already owns
     — units beat the shot's aliases — and no invented fallback. */
  const fromClips = Entities.shotPlannedDuration({ dur: 9, clips: [{ dur: 3 }, { dur: 4 }] });
  eq(fromClips.seconds, 7, "PT3a: a shot split into units is as long as its units");
  eq(fromClips.known, true, "PT3a: and that is a known length");
  const fromShot = Entities.shotPlannedDuration({ dur: 9, clips: [{ dur: null }] });
  eq(fromShot.seconds, 9, "PT3a: an untimed unit falls through to the shot's own declared length");
  const nothing = Entities.shotPlannedDuration({ dur: null, clips: [{ dur: null }] });
  eq(nothing.known, false, "PT3a: a shot nobody timed has no planned length");
  eq(nothing.seconds, 0, "PT3a: and reports zero seconds ONLY alongside `known: false`");

  /* THE TOTAL. The number is unchanged; what it omits is now countable. */
  const runtime = Entities.plannedRuntime([
    { dur: 5 }, { dur: null }, { dur: 0 }, { clips: [{ dur: 3 }, { dur: 4 }] }, {},
  ]);
  eq(runtime.seconds, 12, "PT3a: the total is the sum of the durations that exist");
  eq(runtime.planned, 2, "PT3a: counted over the shots that have one");
  eq(runtime.unknown, 3, "PT3a: and the shots it could not count are reported, not dropped");
  eq(runtime.complete, false, "PT3a: so a caller can say the total is partial");
  eq(Entities.plannedRuntime([{ dur: 5 }, { dur: 7 }]).complete, true,
    "PT3a: a fully timed list reports a complete total");
  eq(Entities.plannedRuntime([]).complete, true, "PT3a: and an empty list has nothing missing");

  note(`PT3a: unknown, declared and total are three separate answers — ${declared.length} declared values, ${unknown.length + 1} unknown ones, and a total that reports what it could not count`);
}

/* ==========================================================================
   PT3b — INTAKE AND ROUND TRIP, THROUGH A REAL SERVER.

   The PK2 finding is about what the IMPORTER WROTE, so this drives the real
   preview and commit routes and then reads the file on disk. A helper returning
   null would prove nothing about a project.json full of zeroes.
   ========================================================================== */

function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/* Two shots from the qualification's own shape: one whose source authors a
   length, one whose source is silent about it. The builder can already tell them
   apart; the question is whether the project can hold the difference. */
const PT3_SOURCE = {
  meta: { title: "Duration Representation", format: "Short film", version: "v1" },
  scenes: [{ id: "SC-01", title: "Cold open", whatHappens: "The gull turns.", howItFeels: "Cold." }],
  shots: [
    { id: "S-01", scene: "SC-01", title: "Authored length", desc: "A locked wide.", positioning: "Wide.", dur: 4,
      clips: [{ id: "seg-a", suffix: "a", kind: "i2v", dur: 4, motionPrompt: "It drifts." }] },
    { id: "S-02", scene: "SC-01", title: "Unplanned length", desc: "A second wide.", positioning: "Wide.",
      clips: [{ id: "seg-a", suffix: "a", kind: "i2v", motionPrompt: "It drifts again." }] },
    /* PT3-C1 case 5. Locked, so it reaches the Project Bible, and mixed-timing, so
       the export has to decide what to publish about a shot it cannot fully time.
       This is Astra's shape carried through the real routes rather than the
       module: import, disk, reload, and the Bible file a filmmaker downloads. */
    { id: "S-03", scene: "SC-01", title: "Partly timed", desc: "A locked wide.", positioning: "Wide.",
      status: "LOCKED", workflowStatus: "APPROVED",
      clips: [
        { id: "seg-a", suffix: "a", kind: "i2v", dur: 6, motionPrompt: "It turns." },
        { id: "seg-b", suffix: "b", kind: "i2v", motionPrompt: "It settles." },
      ] },
  ],
  characters: [], locations: [], props: [], vehicles: [], audio: [],
};

async function checkUnknownSurvivesImportAndReload() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-duration-truth-"));
  const projectsRoot = path.join(temp, "projects");
  fs.mkdirSync(path.join(projectsRoot, "seed"), { recursive: true });
  fs.writeFileSync(path.join(projectsRoot, "seed", "project.json"), JSON.stringify({
    meta: { title: "Seed", format: "Test", version: "v1", hubVersion: "v5.5.0", aiPolicy: "project-default" },
    qcChecklist: [], characters: [], locations: [], props: [], audio: [], mediaAssets: [],
    scenes: [], shots: [], jobs: [], agentRuns: [], decisions: [], sessions: [],
  }));
  fs.writeFileSync(path.join(temp, "config.json"), JSON.stringify({ activeProject: "seed", provider: "none" }));

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let output = "";
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), CINEBRAID_CONFIG_PATH: path.join(temp, "config.json"), CINEBRAID_PROJECTS_ROOT: projectsRoot },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });

  try {
    const deadline = Date.now() + 20000;
    for (;;) {
      try { if ((await fetch(`${base}/api/me`)).ok) break; } catch {}
      if (Date.now() > deadline) throw new Error(`server did not start:\n${output}`);
      await new Promise((resolve) => setTimeout(resolve, 75));
    }

    const preview = await (await fetch(`${base}/api/projects/preview-import-json`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: PT3_SOURCE }),
    })).json();
    ok(preview.normalizedProject, `PT3b: the preview must succeed: ${JSON.stringify(preview).slice(0, 300)}`);

    const shotOf = (project, id) => project.shots.find((row) => row.id === id);
    const authored = shotOf(preview.normalizedProject, "S-01");
    const unplanned = shotOf(preview.normalizedProject, "S-02");

    eq(authored.dur, 4, "PT3b: a stated duration is imported as the number it was stated as");
    eq(authored.clips[0].dur, 4, "PT3b: and so is a stated motion-unit duration");
    eq(unplanned.dur, null, "PT3b: an unstated duration is imported as unknown, not as zero");
    eq(unplanned.clips[0].dur, null, "PT3b: and neither is an unstated motion-unit duration");
    ok(unplanned.dur !== 0, "PT3b: `0` is a length and must never be what absence looks like");

    /* NOTHING WAS GUESSED EITHER. The unplanned shot did not acquire a duration
       from anywhere — not from the other shot, not from a default. */
    ok(!Entities.shotDurationIsDeclared(unplanned), "PT3b: the unplanned shot declares no duration at all");
    eq(Entities.shotDurationIsDeclared(authored), true, "PT3b: while the authored one does");

    /* COMMIT, then read the bytes the importer actually wrote. */
    const commit = await (await fetch(`${base}/api/projects/import-json`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ previewToken: preview.previewToken, previewHash: preview.previewHash }),
    })).json();
    ok(commit.slug, `PT3b: the commit must succeed: ${JSON.stringify(commit).slice(0, 300)}`);

    const rawDisk = fs.readFileSync(path.join(projectsRoot, commit.slug, "project.json"), "utf8");
    const disk = JSON.parse(rawDisk);
    eq(shotOf(disk, "S-01").dur, 4, "PT3b: the stated duration is on disk as a number");
    eq(shotOf(disk, "S-02").dur, null, "PT3b: and the unknown one is on disk as an explicit null");
    ok(/"dur":\s*null/.test(rawDisk), "PT3b: the stored bytes carry the null rather than omitting the field silently");

    /* AND BACK OUT AGAIN. A representation that survives the write but not the
       read is not a representation. */
    const loaded = await (await fetch(`${base}/api/projects/${encodeURIComponent(commit.slug)}/project`, { cache: "no-store" })).json();
    const reloaded = loaded.project || loaded;
    eq(shotOf(reloaded, "S-01").dur, 4, "PT3b: reload preserves the numeric duration");
    eq(shotOf(reloaded, "S-02").dur, null, "PT3b: reload preserves the unknown as unknown");
    eq(shotOf(reloaded, "S-02").clips[0].dur, null, "PT3b: including on the motion unit");

    /* AND THE EXPORT A FILMMAKER HANDS TO SOMEBODY. The shot table's Dur column
       read `d + "s"`, so every unplanned shot in it claimed to run zero seconds.
       Driven through the real route rather than the function, because the route is
       what a person actually receives. */
    const exported = await (await fetch(`${base}/api/export`, { method: "POST" })).json();
    ok(exported.ok && exported.path, `PT3b: the markdown export must succeed: ${JSON.stringify(exported).slice(0, 200)}`);
    /* Read from where the route actually wrote it: the file is the deliverable. */
    const markdown = fs.readFileSync(exported.path, "utf8");
    const rowOf = (id) => markdown.split(/\r?\n/).find((line) => line.startsWith(`| ${id} |`)) || "";
    ok(/\| 4s \|/.test(rowOf("S-01")), `PT3b: the authored shot exports its length: ${rowOf("S-01")}`);
    ok(!/\| 0s \|/.test(rowOf("S-02")), `PT3b: the unplanned shot was exported as a zero-second one: ${rowOf("S-02")}`);
    ok(/\| — \|/.test(rowOf("S-02")), `PT3b: it exports no length at all: ${rowOf("S-02")}`);

    /* PT3-C1 CASE 5 — SAVE / RELOAD / EXPORT. The mixed-timing shot went through
       the same import and the same file; this is the Bible a filmmaker downloads,
       served by the real route from what is on disk. */
    const partlyTimed = shotOf(disk, "S-03");
    assert.deepStrictEqual(partlyTimed.clips.map((clip) => clip.dur), [6, null],
      "PT3-C1: the mixed-timing shot is stored with one length and one explicit unknown");
    checks += 1;

    const bible = await (await fetch(`${base}/api/bible/export?preset=canon`)).text();
    /* The heading is the line after the shot's own `### id — title`, taken by
       position rather than by guessing the scene label the projection resolves to. */
    const bibleLines = bible.split(/\r?\n/);
    const headingIndex = bibleLines.findIndex((line) => line.startsWith("### S-03 "));
    const heading = headingIndex >= 0 ? bibleLines[headingIndex + 1] : "";
    ok(heading, `PT3-C1: the locked shot must reach the Bible export: ${bible.slice(0, 300)}`);
    /* The heading is a `·`-joined list of facts, so the claim under test is that
       the TIMING FACT is not the bare number — `6s known · 1 unit untimed` passes,
       `6s` does not. Substring matching would not tell those apart. */
    const headingFacts = heading.split(" · ").map((part) => part.trim());
    ok(!headingFacts.includes("6s"),
      `PT3-C1: the export published a partly timed shot as a complete 6s: ${heading}`);
    ok(/6s/.test(heading), `PT3-C1: the known subtotal survives the export: ${heading}`);
    ok(/1 unit untimed/.test(heading), `PT3-C1: and so does what it could not time: ${heading}`);

    note(`PT3b: through the real import routes, ${commit.slug}/project.json holds 4 for the authored shot and null for the unplanned one, and both survive the reload unchanged`);
    note(`PT3-C1: the Bible file the real export route serves reads "${heading}" — no false complete duration survives import, disk and reload`);
  } finally {
    child.kill();
  }
}

/* ==========================================================================
   PT3c — WHAT THE SURFACES SAY ABOUT IT.

   Two claims: a total never presents itself as complete when it is not, and a
   motion unit nobody timed is never printed as a zero-second one.
   ========================================================================== */

function pt3UntimedShot(id, title) {
  return {
    id, scene: "SC-01", title, desc: "", positioning: "", route: "GENERATE",
    codes: [], characters: [], risks: [], notes: "", winner: null, dur: null,
    keyframes: [], clips: [], candidateFiles: [], stageApprovals: {}, generationPackages: [],
  };
}

async function checkSurfacesDoNotCountUnknownAsZero() {
  const project = rawFixture();
  const timed = Entities.plannedRuntime(project.shots);
  eq(timed.unknown, 0, "PT3c: the base fixture must be fully timed, or the contrast below proves nothing");

  project.shots.push(pt3UntimedShot("L1-02", "Untimed A"));
  project.shots.push(pt3UntimedShot("L1-03", "Untimed B"));

  const app = await render("#/shots/board", project);
  const runtime = JSON.parse(vm.runInContext("JSON.stringify(plannedRuntimeOf(P.shots))", app.context));
  eq(runtime.unknown, 2, "PT3c: the two untimed shots must actually be untimed");
  eq(runtime.seconds, timed.seconds, "PT3c: and must add nothing at all to the total");

  const bar = vm.runInContext("runtimeBar(P.shots, null)", app.context);
  ok(/planned/.test(bar), "PT3c: the runtime label still reports the planned figure");
  ok(/2 shots not yet timed/.test(bar),
    `PT3c: a runtime total covering untimed shots must say so: ${bar}`);

  vm.runInContext("tally()", app.context);
  const tally = vm.runInContext("document.getElementById('tally').innerHTML", app.context);
  ok(/2 shots not yet timed/.test(tally), `PT3c: and so must the project tally: ${tally.slice(0, 220)}`);

  /* THE CONTROL: a fully timed production says nothing extra. The note is a
     statement about missing data, so it must disappear when none is missing. */
  const complete = await render("#/shots/board", rawFixture());
  const completeBar = vm.runInContext("runtimeBar(P.shots, null)", complete.context);
  ok(!/not yet timed/.test(completeBar),
    `PT3c: a fully timed production must not be told anything is missing: ${completeBar}`);

  /* AND THE PER-UNIT DISPLAY, at a real published surface. The Project Bible's
     canon export prints a length for every motion unit, and `0s` was a length
     nobody wrote.

     THE PROJECTION'S OWN FIELD IS DELIBERATELY LEFT NUMERIC and asserted as such:
     `dur: +c.dur || 0` implements the same shipped reading rule
     shotDurationAlias() states — only a positive finite number counts as supplied
     — so a 0 there already MEANS "not declared". The repair is that the printer
     now says that instead of rendering it as a duration. */
  const doc = BibleCanon.bibleCanonProjection({
    meta: { title: "Duration", models: [] },
    characters: [], locations: [], props: [], vehicles: [], audio: [], mediaAssets: [],
    scenes: [{ id: "SC-01", title: "Cold open" }],
    shots: [{
      id: "S-01", scene: "SC-01", title: "Hull check", status: "LOCKED", workflowStatus: "APPROVED", dur: null,
      keyframes: [],
      clips: [
        { id: "seg-a", suffix: "a", label: "A", title: "Timed unit", kind: "i2v", dur: 6 },
        { id: "seg-b", suffix: "b", label: "B", title: "Untimed unit", kind: "i2v", dur: null },
      ],
      candidateFiles: [], promptBuilds: [], generationPackages: [], creationBrief: {},
    }],
    productionAuthority: { version: 1, receipts: [] },
  }, { media: {}, shotMedia: () => [], modelName: () => "" });

  const motions = doc.shots[0].motions;
  eq(motions[0].dur, 6, "PT3c: the projection carries a declared unit duration as its number");
  eq(motions[1].dur, 0, "PT3c: and an undeclared one as the shipped rule's not-declared value");

  const markdown = BibleCanon.bibleCanonMarkdown(doc, { preset: "canon" });
  const motionLines = markdown.split(/\r?\n/).filter((line) => /^\*\*Motion /.test(line));
  eq(motionLines.length, 2, "PT3c: both motion units must reach the export");
  ok(/· 6s$/.test(motionLines[0]), `PT3c: a timed unit still exports its length: ${motionLines[0]}`);
  ok(!/0s/.test(motionLines[1]), `PT3c: an untimed unit was exported as a zero-second one: ${motionLines[1]}`);
  ok(/duration not planned$/.test(motionLines[1]), `PT3c: it says the duration was never planned: ${motionLines[1]}`);

  note("PT3c: the runtime totals name the shots they could not count, a fully timed production is told nothing is missing, and the Bible export prints `duration not planned` for an untimed motion unit instead of `0s`");
}

/* ==========================================================================
   PT3-C1 — THE BIBLE AGGREGATE MAY NOT PUBLISH A SUBTOTAL AS A TOTAL.

   Astra's reproduction, exactly: one motion unit at 6s and one untimed projects as
   `[6, 0]`, the shot aggregate sums that to 6, and the heading prints
   `Cold open · 6s` — a complete-looking answer about a shot nobody has finished
   timing, in the document a production is run from.

   The Project Bible is the shipped consumer of the retained `dur: 0` projection.
   That projection field is unchanged and asserted as unchanged below; what
   changed is that the row now also says whether its number is one anybody wrote,
   and the aggregate keeps both facts.
   ========================================================================== */

const PT3C1_CLIP = (label, dur) => ({
  id: `seg-${label.toLowerCase()}`, suffix: label.toLowerCase(), label,
  title: `Unit ${label}`, kind: "i2v", dur,
});
function pt3c1Doc(clips, shotDur = null) {
  return BibleCanon.bibleCanonProjection({
    meta: { title: "Duration", models: [] },
    characters: [], locations: [], props: [], vehicles: [], audio: [], mediaAssets: [],
    scenes: [{ id: "Cold open", title: "Cold open" }],
    shots: [{
      id: "S-01", scene: "Cold open", title: "Hull check", status: "LOCKED", workflowStatus: "APPROVED",
      dur: shotDur, keyframes: [], clips,
      candidateFiles: [], promptBuilds: [], generationPackages: [], creationBrief: {},
    }],
    productionAuthority: { version: 1, receipts: [] },
  }, { media: {}, shotMedia: () => [], modelName: () => "" });
}
const pt3c1Heading = (doc) =>
  BibleCanon.bibleCanonMarkdown(doc, { preset: "canon" })
    .split(/\r?\n/).find((line) => line.startsWith("Cold open")) || "";

function checkBibleAggregateNeverCompletesIncompleteTiming() {
  /* CASE 1 — [6, null]. THE REPRODUCTION. */
  const partial = pt3c1Doc([PT3C1_CLIP("A", 6), PT3C1_CLIP("B", null)]);
  const partialShot = partial.shots[0];

  /* The projection's own motion field is deliberately unchanged — a 0 there has
     always meant "not declared", and NC-BIBLE10 anchors on that line. This asserts
     the retained shape so the correction is visibly ABOUT the aggregate. */
  assert.deepStrictEqual(partialShot.motions.map((m) => m.dur), [6, 0],
    "PT3-C1: the motion projection still carries a not-declared duration as 0");
  assert.deepStrictEqual(partialShot.motions.map((m) => m.durDeclared), [true, false],
    "PT3-C1: and now says which of those numbers anybody wrote");
  checks += 2;

  eq(partialShot.dur, 6, "PT3-C1: the known subtotal is preserved — nothing is discarded");
  eq(partialShot.durComplete, false, "PT3-C1: and the aggregate reports itself incomplete");
  eq(partialShot.durUntimedUnits, 1, "PT3-C1: naming how many units still owe a length");

  const partialHeading = pt3c1Heading(partial);
  ok(partialHeading, "PT3-C1: the shot heading must be exported");
  ok(!/^Cold open · 6s$/.test(partialHeading),
    `PT3-C1: a shot with one untimed unit was published as a complete 6s: ${partialHeading}`);
  ok(/6s/.test(partialHeading), `PT3-C1: the known subtotal stays visible: ${partialHeading}`);
  ok(/untimed/.test(partialHeading), `PT3-C1: and the incompleteness is surfaced: ${partialHeading}`);
  ok(/1 unit untimed/.test(partialHeading), `PT3-C1: with the count: ${partialHeading}`);

  /* CASE 2 — [6, 4]. A GENUINELY COMPLETE TOTAL IS STILL A PLAIN NUMBER, or the
     repair is indistinguishable from making every shot look unfinished. */
  const complete = pt3c1Doc([PT3C1_CLIP("A", 6), PT3C1_CLIP("B", 4)]);
  eq(complete.shots[0].dur, 10, "PT3-C1: two declared units sum to their total");
  eq(complete.shots[0].durComplete, true, "PT3-C1: and that total is complete");
  eq(complete.shots[0].durUntimedUnits, 0, "PT3-C1: with nothing outstanding");
  eq(pt3c1Heading(complete), "Cold open · 10s", "PT3-C1: so the heading is the plain truthful number");

  /* CASE 3 — [null, null]. NOT ZERO SECONDS. */
  const untimed = pt3c1Doc([PT3C1_CLIP("A", null), PT3C1_CLIP("B", null)]);
  eq(untimed.shots[0].durComplete, false, "PT3-C1: a shot whose every unit is untimed is not complete");
  eq(untimed.shots[0].durUntimedUnits, 2, "PT3-C1: and both units are counted");
  const untimedHeading = pt3c1Heading(untimed);
  ok(!/0s/.test(untimedHeading), `PT3-C1: an entirely untimed shot must not read as zero seconds: ${untimedHeading}`);
  ok(/2 units untimed/.test(untimedHeading), `PT3-C1: it says what it is: ${untimedHeading}`);

  /* CASE 4 — AN EXPLICIT LEGITIMATE DURATION, under the existing precedence. */
  const authored = pt3c1Doc([], 5);
  eq(authored.shots[0].dur, 5, "PT3-C1: a shot with no units keeps its own declared length");
  eq(authored.shots[0].durComplete, true, "PT3-C1: which is a complete answer");
  eq(pt3c1Heading(authored), "Cold open · 5s", "PT3-C1: and prints as the number it is");
  const unitsWin = pt3c1Doc([PT3C1_CLIP("A", 6), PT3C1_CLIP("B", 4)], 99);
  eq(unitsWin.shots[0].dur, 10,
    "PT3-C1: units still beat the shot's own alias — the precedence the aggregate already had is unchanged");
  const zeroSentinel = pt3c1Doc([], 0);
  eq(zeroSentinel.shots[0].durComplete, false,
    "PT3-C1: a stored 0 on a shot with no units is the not-declared sentinel, not a zero-second shot");
  ok(!/0s/.test(pt3c1Heading(zeroSentinel)), "PT3-C1: and is never printed as one");

  /* THE PAGE AND THE EXPORT SAY THE SAME THING. `durWords` is built once, which is
     why they cannot drift — the HTML heading reads the same field. */
  const bibleSource = fs.readFileSync(path.join(PUBLIC, "bible.js"), "utf8");
  ok(/durWords/.test(bibleSource),
    "PT3-C1: the Bible page must print the same timing sentence the export does");
  ok(!/s\.dur \? esc\(s\.dur\)/.test(bibleSource),
    "PT3-C1: and must not re-derive a heading from the subtotal");

  note("PT3-C1: the Bible aggregate keeps the known subtotal AND how many units are untimed; [6, null] publishes `6s known · 1 unit untimed` instead of `6s`, [6, 4] still publishes `10s`, and [null, null] is untimed rather than 0s");
}

/* ==========================================================================
   PT3d — A NEW SHOT HAS NO PLANNED LENGTH.

   The representation half, at the other writer. `dur: 0` and `dur: null` read
   identically through shotDurationAlias(), which is exactly why this is asserted
   on the STORED VALUE: what is written is what a later reader, an export, a
   migration and the OFP contract's nullable `duration.seconds` all have to work
   from, and only one of the two says "nobody has decided".
   ========================================================================== */

async function checkNewShotHasNoInventedLength() {
  const app = await render("#/shots/board", buildFixture());
  const before = vm.runInContext("P.shots.length", app.context);
  app.context.addShot("SC-01");
  /* The shipped form writer reads its own fields, so the fields are filled the
     way a filmmaker fills them rather than the record being pushed directly. */
  vm.runInContext(`(() => {
    const scene = document.getElementById("ff-scene"); if (scene) scene.value = "SC-01";
    const title = document.getElementById("ff-title"); if (title) title.value = "Untimed";
  })()`, app.context);
  app.context._formSubmit();

  const created = JSON.parse(vm.runInContext(
    `(() => { const s = P.shots[P.shots.length - 1];
       return JSON.stringify({ count: P.shots.length, id: s.id, isNull: s.dur === null, isZero: s.dur === 0 }); })()`,
    app.context,
  ));
  eq(created.count, before + 1, "PT3d: the shipped writer must actually add a shot");
  ok(created.isNull, "PT3d: a new shot stores an explicit unknown duration");
  ok(!created.isZero, "PT3d: and never a zero-second one, which is a length nobody chose");

  note("PT3d: a shot created through the shipped writer stores `dur: null` — an explicit unknown — rather than the `0` that used to enter the runtime total as certainty");
}

/* ========================================================================== */

async function main() {
  await checkApprovalWordingReadsAuthority();
  checkFlagIsNeverSuggested();
  await checkGateNeverSuggestsAFlag();
  checkDurationContract();
  await checkUnknownSurvivesImportAndReload();
  await checkSurfacesDoNotCountUnknownAsZero();
  checkBibleAggregateNeverCompletesIncompleteTiming();
  await checkNewShotHasNoInventedLength();

  for (const line of notes) console.log(`  - ${line}`);
  console.log(`\nProduction truth cleanup suite passed ${checks} assertions across PT1 (approval wording reads authority), PT2 (a FLAG is never affirmative, in Generated Media and at the automation gate) and PT3 (unknown duration stays unknown through import, disk, reload, totals and per-unit display). Provider calls made: 0.`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});

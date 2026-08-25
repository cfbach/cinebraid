/* Negative controls for tests/launch-language-convergence.js.
 *
 * A guarantee nobody has watched fail is a guarantee nobody has tested. Each control
 * below reintroduces ONE of the language defects Slice 4 exists to prevent — IN MEMORY,
 * through the render harness's mutateSource hook, so nothing on disk is touched and no
 * control can be "restored" by a checkout that also discards real work — renders the
 * product with the defect back in place, PRINTS THE LITERAL BAD STATE it produced, and
 * then proves the invariant notices.
 *
 * Two rules make these controls worth having:
 *
 *   1. NO CONTROL IS SOURCE-STRING-ONLY. Every one of them changes what the product
 *      RENDERS, and the bad state is captured out of that rendered markup. A control
 *      that only proved a string is still in a file would pass against a build whose
 *      behaviour had changed underneath it.
 *
 *   2. EVERY MUTATION CARRIES A PROBE RECEIPT. The mutation asserts that the text it is
 *      replacing was actually there, in the expected number of places, so a control
 *      cannot quietly become a no-op after a refactor and start "passing" against
 *      nothing.
 *
 * NO PROJECT DATA IS TOUCHED, NO SERVER IS STARTED, NO PROVIDER OR PAID CALL IS MADE.
 */

const assert = require("assert");
const vm = require("vm");

const { render, rawFixture, withCanon } = require("./render-harness");

const notes = [];
const note = (line) => notes.push(line);
let controls = 0;

/* ===========================================================================
   THE MUTATION MACHINERY.
   =========================================================================== */

/* A harness mutateSource hook scoped to one file, with a probe receipt. Source arrives
   with the working tree's CRLF endings; it is normalised first, because a multi-line
   anchor written with \n would match nothing and take the control's meaning with it. */
function replacing(file, needle, replacement, label, expected = 1) {
  return (name, contents) => {
    if (name !== file) return contents;
    const source = String(contents).replace(/\r\n/g, "\n");
    const hits = source.split(needle).length - 1;
    assert.strictEqual(hits, expected,
      `probe receipt: ${label} expected ${expected} occurrence(s) of its anchor, found ${hits}. `
      + "The control is no longer mutating the live path and must be rewritten.");
    return source.split(needle).join(replacement);
  };
}

/* Runs the body and requires it to throw, mentioning `because`. */
function mustFail(label, because, body) {
  controls += 1;
  let failure = null;
  try { body(); }
  catch (error) { failure = error; }
  assert(failure, `NEGATIVE CONTROL DID NOT FIRE: ${label}. The guarantee is not actually being tested.`);
  assert(String(failure.message).includes(because),
    `NEGATIVE CONTROL FIRED FOR THE WRONG REASON: ${label}\n  expected a failure mentioning: ${because}\n  got: ${failure.message}`);
  note(`  ${label} — failed as required`);
}

/* ===========================================================================
   FIXTURES — the same shapes the positive suite uses, plus the stale-pointer shot
   Slice 1 exists to refuse.
   =========================================================================== */

const CAST_CANON = [
  { kind: "entity-state", list: "characters", entityId: "KAI", stateId: "state-default", value: "KAI-ANCHOR.png" },
  { kind: "entity-state", list: "locations", entityId: "LOC-HULL", stateId: "state-default", value: "LOC-HULL-PLATE.png" },
  { kind: "entity-state", list: "props", entityId: "PR-TOOL", stateId: "state-default", value: "PR-TOOL-PLATE.png" },
];
const FRAME = "FRAME_A.png";

function shotFixture({ route = "t2i", frame = FRAME, final = false, stalePointer = false, secondFrame = false } = {}) {
  const project = rawFixture();
  const shot = JSON.parse(JSON.stringify(project.shots[0]));
  shot.id = "L1-01";
  shot.scene = "SC-01";
  shot.clips = [];
  shot.deliveryRoute = route;
  shot.creationBrief = { ...(shot.creationBrief || {}), deliveryIntent: "still" };
  shot.keyframes = [{ ...shot.keyframes[0], id: "frame-a", label: "A", winner: frame, required: true }];
  if (secondFrame) shot.keyframes.push({ ...shot.keyframes[0], id: "frame-b", label: "B", title: "Ending frame", winner: "", required: false });
  const rows = [...CAST_CANON];
  if (frame) rows.push({ kind: "shot-frame", shotId: "L1-01", frameId: "frame-a", value: frame });
  /* A POINTER WITH NO RECEIPT BEHIND IT is what a rename repair, a duplicate or a
     migration leaves behind. It is not authority, and no surface may read it as final. */
  if (final || stalePointer) {
    shot.finalStillFile = frame;
    shot.creationBrief.finalStillFile = frame;
    if (final) rows.push({ kind: "shot-delivery", shotId: "L1-01", value: frame });
  }
  project.shots = [shot];
  return withCanon(project, rows);
}

function scanWith(project, takes) {
  return {
    anchors: (project.characters || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/anchors/${x.approvedFile}` })),
    plates: (project.locations || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/plates/${x.approvedFile}` })),
    props: (project.props || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/props/${x.approvedFile}` })),
    vehicles: [],
    audio: [],
    media: [],
    shots: { "L1-01": { takes: takes.map((name) => ({ name, url: `/assets/shots/L1-01/takes/${name}` })), locked: [] } },
  };
}

const evaluate = (context, expression) =>
  JSON.parse(vm.runInContext(`JSON.stringify((() => { ${expression} })())`, context));

const SURFACES = `
  const shot = P.shots[0];
  const takes = takesFor(shot.id);
  const readiness = shotReadinessFor(shot);
  return ({
    finish: guidedFinishPanel(shot, guidedApprovedMotion(shot, takes), guidedCurrentShotStill(shot, takes)),
    frames: shotFramesWorkspace(shot, takes),
    delivered: shotDeliveryAuthority(P, shot).final,
    kernelReceipt: !!currentHumanAuthority(P, { kind: "shot-delivery", shotId: shot.id }),
    readinessCode: readiness && readiness.nextAction ? readiness.nextAction.code : "",
  });
`;

const MODALS = `
  const id = P.shots[0].id;
  const out = {};
  let captured = "";
  const realOpen = window.openModal;
  window.openModal = (html) => { captured = String(html); };
  approveGuidedStill(id, "CANDIDATE_1.png"); out.shotStill = captured; captured = "";
  const frames = guidedFrames(P.shots[0]);
  approveGuidedFrame(id, frames[1].id, "CANDIDATE_1.png"); out.frame = captured; captured = "";
  window.openModal = realOpen;
  return out;
`;

async function seeShot(spec, mutateSource, takes = [FRAME]) {
  const project = shotFixture(spec);
  const page = await render("#/shot/L1-01", project, { scan: scanWith(project, takes), mutateSource });
  return { page, seen: evaluate(page.context, SURFACES) };
}

function controlLabels(markup) {
  const rows = [];
  for (const match of String(markup).matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) {
    const label = match[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (label) rows.push(label);
  }
  return rows;
}
const plain = (markup) => String(markup).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const show = (label, value) => note(`      literal bad state — ${label}: ${value}`);

/* ===========================================================================
   THE INVARIANTS, stated once and reused by every control. These are the same
   guarantees tests/launch-language-convergence.js asserts; a control's job is to make
   one of them throw.
   =========================================================================== */

function invariantTwoNamedDecisions(seen) {
  const labels = controlLabels(seen.finish).filter((label) => /final|finish/i.test(label));
  assert.deepStrictEqual(labels, ["Mark shot final", "Send to finishing"],
    `Finish & Delivery must offer the finalisation decision first and the optional finishing pass second, got ${JSON.stringify(labels)}`);
  for (const banned of ["Finish", "Finalize", "Finalise", "Complete", "Done"]) {
    assert(!controlLabels(seen.finish).includes(banned),
      `Finish & Delivery must name no control exactly "${banned}"`);
  }
}

function invariantDeliveredPromotesNoMotion(seen) {
  assert.strictEqual(seen.delivered, true, "precondition: this shot is delivered");
  assert(!/frames-to-motion-cta/.test(seen.frames),
    "a delivered shot must promote no motion handoff");
  for (const promotion of ["CREATE MOTION", "Create motion", "PRODUCE THE MOTION", "OPEN MOTION"]) {
    assert(!seen.frames.includes(promotion),
      `a delivered shot must never render "${promotion}"`);
  }
}

function invariantRequiredMotionSurvives(seen) {
  assert.strictEqual(seen.readinessCode, "produce-motion", "precondition: readiness asks for motion");
  assert(/frames-to-motion-cta/.test(seen.frames),
    "outstanding required motion must still be promoted — an anti-promotion rule may never hide real work");
}

function invariantMethodIsTheDeclaredOne(seen) {
  assert(seen.frames.includes("Animate using references"),
    "a shot declared r2v must name reference-to-video as its method");
  for (const wrong of ["Image-to-video", "Animate between frames", "Animate from first frame"]) {
    assert(!seen.frames.includes(wrong),
      `a reference-to-video shot must never be described as "${wrong}"`);
  }
}

function invariantR2vPickerNamesItself(rows) {
  assert(/reference to video/i.test(rows.r2v || ""),
    `an r2v target row must name reference to video, got "${rows.r2v}"`);
  assert(!/^ . (multi-frame \+ references|reference performance)$/i.test(rows.r2v || ""),
    "an r2v target row must name its method, not only its inputs");
}

function invariantNoFinalClaimWithoutAuthority(seen) {
  assert.strictEqual(seen.kernelReceipt, false, "precondition: no shot-delivery receipt exists");
  for (const claim of ["Final delivery locked", "Marked final", "Shot delivered", "locked for delivery"]) {
    assert(!seen.finish.includes(claim),
      `with no delivery authority, Finish & Delivery may not claim "${claim}"`);
  }
}

function invariantNoFilenameQuestion(modals) {
  for (const [label, markup] of Object.entries(modals)) {
    assert(!/canonical filename/i.test(plain(markup)),
      `the ${label} approval dialog must ask the filmmaker no filename question`);
    const input = String(markup).match(/<input[^>]*id="approve-name"[^>]*>/);
    if (input) {
      assert(/type="hidden"/.test(input[0]),
        `the ${label} dialog must carry the filename the way it carries the target, got ${input[0]}`);
    }
  }
}

/* ===========================================================================
   NC-LANG1 — THE OPTIONAL FINISHING ACTION WEARS THE FINALISATION WORD.

   The original defect, exactly: two adjacent generic verbs for two decisions of
   completely different weight. Here the optional pass is renamed "Finalize", which is
   indistinguishable from the control that actually ends the shot.
   =========================================================================== */

async function ncLang1() {
  const { seen } = await seeShot({}, replacing("creation-studio.js",
    '">Send to finishing</button></div>',
    '">Finalize</button></div>',
    "NC-LANG1"));

  const labels = controlLabels(seen.finish).filter((label) => /final|finish/i.test(label));
  show("Finish & Delivery controls", JSON.stringify(labels));
  assert(labels.includes("Finalize"),
    "NC-LANG1 did not render its defect: the optional finishing control was not relabelled");

  mustFail("NC-LANG1 optional finishing labelled Finalize",
    "Finish & Delivery must offer the finalisation decision first",
    () => invariantTwoNamedDecisions(seen));
}

/* ===========================================================================
   NC-LANG2 — A DELIVERED SHOT PROMOTES MOTION AGAIN.

   The delivery gate is removed, restoring the reproduction: a still shot the filmmaker
   has already marked final goes back to offering motion as its NEXT STEP.
   =========================================================================== */

async function ncLang2() {
  const { seen } = await seeShot({ final: true }, replacing("creation-studio.js",
    '  if (guidedShotDelivered(s)) motionCta = "";\n  else if (progress.requiredApproved',
    '  if (progress.requiredApproved',
    "NC-LANG2"));

  const cta = (String(seen.frames).match(/<section class="frames-to-motion-cta[\s\S]*?<\/section>/) || [""])[0];
  show("delivered shot's Frames workflow", plain(cta) || "(no CTA rendered)");
  assert(cta, "NC-LANG2 did not render its defect: the delivered shot promoted nothing");

  mustFail("NC-LANG2 delivered still promotes motion",
    "a delivered shot must promote no motion handoff",
    () => invariantDeliveredPromotesNoMotion(seen));
}

/* ===========================================================================
   NC-LANG3 — THE ANTI-PROMOTION RULE BECOMES TOO BROAD AND HIDES REAL WORK.

   The failure mode NC-LANG2's fix invites. Here "is this shot delivered" is widened to
   "does this shot have an approved opening frame", so a shot whose readiness is
   actively asking for motion is silently offered nothing. Hiding outstanding required
   work is strictly worse than promoting optional work, and it must fail just as loudly.
   =========================================================================== */

async function ncLang3() {
  const { seen } = await seeShot({ route: "r2v" }, replacing("creation-studio.js",
    'function guidedShotDelivered(s) {\n  return typeof shotDeliveryAuthority === "function" ? !!shotDeliveryAuthority(P, s).final : false;\n}',
    'function guidedShotDelivered(s) {\n  return !!(s && ((s.keyframes || [])[0] || {}).winner);\n}',
    "NC-LANG3"));

  show("readiness next action", seen.readinessCode);
  show("Frames workflow handoff", /frames-to-motion-cta/.test(seen.frames) ? "still promoted" : "SUPPRESSED — required motion is now unreachable from Frames");
  assert.strictEqual(seen.delivered, false,
    "NC-LANG3 precondition: this shot holds no delivery receipt, so nothing about it is finished");
  assert(!/frames-to-motion-cta/.test(seen.frames),
    "NC-LANG3 did not render its defect: the over-broad rule did not actually suppress the handoff");

  mustFail("NC-LANG3 over-broad rule hides required motion",
    "outstanding required motion must still be promoted",
    () => invariantRequiredMotionSurvives(seen));
}

/* ===========================================================================
   NC-LANG4 — R2V DESCRIBED AS A FRAME-ENDPOINT MECHANISM.

   Two halves, because the defect had two homes: the handoff that named the method from
   the approved-anchor count, and the picker row that called it a "reference
   performance" rather than reference to video.
   =========================================================================== */

async function ncLang4() {
  /* (a) the handoff goes back to guessing from anchors. */
  const { seen } = await seeShot({ route: "r2v" }, replacing("creation-studio.js",
    '  if (mode && typeof modeLanguage === "function") return modeLanguage(mode);\n',
    '',
    "NC-LANG4a"));

  const cta = (String(seen.frames).match(/<section class="frames-to-motion-cta[\s\S]*?<\/section>/) || [""])[0];
  show("r2v shot's motion handoff", plain(cta));
  assert(seen.frames.includes("Image-to-video"),
    "NC-LANG4a did not render its defect: the r2v shot was not mislabelled");

  mustFail("NC-LANG4a r2v handoff named from the anchor count",
    "must name reference-to-video as its method",
    () => invariantMethodIsTheDeclaredOne(seen));

  /* (b) the picker row goes back to naming no method at all. */
  const project = shotFixture({ route: "r2v" });
  const page = await render("#/shot/L1-01", project, {
    scan: scanWith(project, [FRAME]),
    /* The H3 multi-frame row is the only DISPATCHABLE r2v target this build has, so it
       is the row a filmmaker actually reads. Reverting it to naming its inputs rather
       than its method is the same defect the non-H3 arm carried as
       " · reference performance": a row that never says what R2V is. */
    mutateSource: replacing("creation-studio.js",
      ' · reference to video, up to nine keyframes',
      ' · multi-frame + references',
      "NC-LANG4b"),
  });
  const rows = evaluate(page.context, `
    const out = {};
    for (const profile of guidedVideoProfiles()) {
      if (!guidedVideoProfileDispatchable(profile)) continue;
      out[profile.mode] = out[profile.mode] || guidedVideoProfileOptionSuffix(profile, "");
    }
    return out;
  `);
  if (rows.r2v === undefined) {
    note("  NC-LANG4b skipped — this build dispatches no r2v target to describe");
    return;
  }
  show("r2v picker row", rows.r2v);
  assert(!/reference to video/i.test(rows.r2v),
    "NC-LANG4b did not render its defect: the picker row was not reverted");

  mustFail("NC-LANG4b r2v picker row names no method",
    "must name reference to video",
    () => invariantR2vPickerNamesItself(rows));
}

/* ===========================================================================
   NC-LANG5 — APPROVAL WITHOUT AUTHORITY CLAIMS THE SHOT IS DELIVERED.

   Slice 1's P0, restated as a language control: the panel reads the POINTER instead of
   asking the one owner, so a shot carrying `finalStillFile` with no
   `approve-shot-delivery` receipt behind it renders FINAL, "Final delivery locked" and
   "Marked final" — three claims about a decision nobody took.
   =========================================================================== */

async function ncLang5() {
  const { seen } = await seeShot({ stalePointer: true }, replacing("creation-studio.js",
    '  const isFinal = shotDeliveryAuthority(P, s).final, media = approved || current;',
    '  const isFinal = !!(ensureShotCreation(s).finalStillFile || ensureShotCreation(s).finalVideoFile), media = approved || current;',
    "NC-LANG5"));

  const summary = plain(String(seen.finish).slice(0, String(seen.finish).indexOf("</summary>")));
  show("Finish & Delivery summary", summary);
  show("kernel delivery receipt", String(seen.kernelReceipt));
  assert(seen.finish.includes("Final delivery locked"),
    "NC-LANG5 did not render its defect: the pointer did not produce a delivery claim");

  mustFail("NC-LANG5 stale pointer claims delivery",
    "may not claim",
    () => invariantNoFinalClaimWithoutAuthority(seen));
}

/* ===========================================================================
   NC-LANG6 — THE GENERIC VERB RETURNS TO THE FINALISATION CONTROL ITSELF.

   NC-LANG1 put the finalisation word on the optional action; this is the other
   direction, and it is the one the audit actually found: the control that ends the shot
   labelled with a word that could mean either thing.
   =========================================================================== */

async function ncLang6() {
  const { seen } = await seeShot({}, replacing("creation-studio.js",
    '>Mark shot final</button>',
    '>Finish</button>',
    "NC-LANG6"));

  const labels = controlLabels(seen.finish).filter((label) => /final|finish/i.test(label));
  show("Finish & Delivery controls", JSON.stringify(labels));
  assert(labels.includes("Finish"),
    "NC-LANG6 did not render its defect: the finalisation control was not relabelled");

  mustFail("NC-LANG6 generic verb on the finalisation control",
    "Finish & Delivery must offer the finalisation decision first",
    () => invariantTwoNamedDecisions(seen));
}

/* ===========================================================================
   NC-LANG7 — THE FILMMAKER IS ASKED FOR A FILENAME AGAIN.

   The hidden carried value becomes a visible, editable, labelled field once more, in
   both dialogs that used to have one. Nothing about storage changes — which is the
   point: the defect was never the mechanism, it was the question.
   =========================================================================== */

async function ncLang7() {
  const project = shotFixture({ frame: "", secondFrame: true });
  const page = await render("#/shot/L1-01", project, {
    scan: scanWith(project, ["CANDIDATE_1.png"]),
    mutateSource: replacing("creation-studio.js",
      '<input type="hidden" id="approve-name" value="${attr(suggested)}">',
      '<div class="form-field"><label>Canonical filename</label><input id="approve-name" value="${attr(suggested)}"></div>',
      "NC-LANG7", 2),
  });
  const modals = evaluate(page.context, MODALS);

  show("shot-still approval dialog", (String(modals.shotStill).match(/<div class="form-field"><label>Canonical filename<\/label><input[^>]*>/) || ["(not rendered)"])[0]);
  assert(/canonical filename/i.test(plain(modals.shotStill)),
    "NC-LANG7 did not render its defect: the dialog asked nothing");

  mustFail("NC-LANG7 approval asks for a canonical filename",
    "must ask the filmmaker no filename question",
    () => invariantNoFilenameQuestion(modals));
}

/* ===========================================================================
   RUN.
   =========================================================================== */

async function main() {
  await ncLang1();
  await ncLang2();
  await ncLang3();
  await ncLang4();
  await ncLang5();
  await ncLang6();
  await ncLang7();

  console.log("Launch language convergence — negative controls:");
  for (const line of notes) console.log(line);
  console.log(`\n${controls} negative controls fired. Every one rendered its literal bad state before the invariant refused it.`);
  console.log("No project data touched, no server started, no provider or paid call made.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

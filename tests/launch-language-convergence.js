/* CineBraid — Public Alpha UX Slice 4: LAUNCH LANGUAGE CONVERGENCE.
 *
 * THE QUESTION THIS SUITE GOVERNS, and there is exactly one:
 *
 *     DOES THE WORD ON THE CONTROL NAME THE DECISION BEHIND IT?
 *
 * Slices 1-3 settled the truth. A readiness/action projection decides what needs a
 * person (Slice 1), the Project Bible renders current canon (Slice 2), and returned
 * media owns its own review (Slice 3). None of that is reopened here. What is left is
 * that several surfaces were still DESCRIBING that truth in words a filmmaker could not
 * map onto it, and five of those mismatches were found by the Public Alpha audit:
 *
 *   L1  Finish & Delivery offered "Finish" and "Finalize" side by side. One queues an
 *       OPTIONAL processing pass and changes nothing about the shot; the other writes
 *       the `approve-shot-delivery` receipt that ends it. Two generic words, adjacent,
 *       for two decisions of completely different weight — and the optional one came
 *       first.
 *
 *   L2  A shot the filmmaker had already marked FINAL went on rendering
 *       "NEXT STEP / CREATE MOTION" off frame approval alone. Optional work promoted as
 *       the next required step, after the decision that ended the shot.
 *
 *   L3  That same handoff named the method from how many frames happened to be
 *       approved, so a shot whose DECLARED intent is r2v was told "Image-to-video is
 *       ready". The only two names that sentence could ever produce were the two
 *       frame-endpoint ones, which is precisely the reading that makes R2V look like an
 *       exception to a frame-first norm rather than a first-class method.
 *
 *   L4  Approving a candidate must never read as delivering the shot.
 *
 *   L5  Three approval dialogs asked the filmmaker to supply a "Canonical filename" —
 *       an editable text field, captioned nothing at all on two of the three, sitting
 *       between the image and the APPROVE button.
 *
 * WHAT THIS SUITE WILL NOT DO. It forms no opinion about what is true. Every status it
 * reads was decided by public/shared-shot-readiness.js, every delivery answer comes from
 * shotDeliveryAuthority(), every method name is compared against the shipped
 * CINEBRAID_MODE_LANGUAGE rather than typed out here, and every approval is written by
 * the shipped kernel command through the shipped control. A word this suite invented
 * would be the defect wearing a test's clothes.
 *
 * NO PROJECT DATA IS TOUCHED. NO SERVER IS STARTED. NO PROVIDER OR PAID CALL IS MADE.
 */

const assert = require("assert");
const vm = require("vm");

const { render, rawFixture, withCanon } = require("./render-harness");
const { CINEBRAID_MODE_LANGUAGE } = require("../public/shared-generation-options");

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

/* ===========================================================================
   FIXTURES.

   One still-only shot and one motion shot, each buildable delivered or not, each with
   every reference it depends on approved through withCanon() — so a check about the
   WORDS is never quietly answered by a missing anchor somewhere else.
   =========================================================================== */

const CAST_CANON = [
  { kind: "entity-state", list: "characters", entityId: "KAI", stateId: "state-default", value: "KAI-ANCHOR.png" },
  { kind: "entity-state", list: "locations", entityId: "LOC-HULL", stateId: "state-default", value: "LOC-HULL-PLATE.png" },
  { kind: "entity-state", list: "props", entityId: "PR-TOOL", stateId: "state-default", value: "PR-TOOL-PLATE.png" },
];

const FRAME = "FRAME_A.png";
const TAKE = "MOTION_A.mp4";

/* `route: null` means the shot declares none — a legacy shot nobody has decided about.
   It is a different fixture from every declared one and is exercised as such. */
function shotFixture({ route = "t2i", frame = FRAME, final = false, motion = false, deliveredForm = "still", secondFrame = false } = {}) {
  const project = rawFixture();
  const shot = JSON.parse(JSON.stringify(project.shots[0]));
  shot.id = "L1-01";
  shot.scene = "SC-01";
  shot.clips = [];
  if (route === null) delete shot.deliveryRoute;
  else shot.deliveryRoute = route;
  shot.creationBrief = { ...(shot.creationBrief || {}), deliveryIntent: motion ? "motion" : "still" };
  shot.keyframes = [{ ...shot.keyframes[0], id: "frame-a", label: "A", winner: frame, required: true }];
  /* A second, unapproved frame, for the dialog that only exists on one. Frame A opens
     the shot-still dialog; every later frame opens the frame dialog, and both used to
     carry the filename question. */
  if (secondFrame) shot.keyframes.push({ ...shot.keyframes[0], id: "frame-b", label: "B", title: "Ending frame", winner: "", required: false });
  const rows = [...CAST_CANON];
  if (frame) rows.push({ kind: "shot-frame", shotId: "L1-01", frameId: "frame-a", value: frame });
  /* A POINTER IS NOT AN APPROVAL, and a receipt without its edge is not authority: the
     kernel reads a motion approval off `clips[].videoWinner` and fails closed when no
     clip carries it. So a fixture claiming an approved motion take writes the clip, its
     winner and the receipt — otherwise it is testing the orphan case by accident and
     calling it "approved". */
  if (motion) {
    shot.clips = [{ id: "motion-a", label: "A", suffix: "a", title: "Move", kind: "i2v", fromFrame: "frame-a", toFrame: "", dur: 5, motionPrompt: "He moves.", videoWinner: TAKE, generationPackages: [] }];
    shot.creationBrief.approvedMotionFile = TAKE;
    rows.push({ kind: "shot-motion", shotId: "L1-01", unitKey: "motion-a", value: TAKE });
  }
  if (final) {
    const value = deliveredForm === "video" ? TAKE : frame;
    if (deliveredForm === "video") shot.creationBrief.finalVideoFile = value;
    else { shot.finalStillFile = value; shot.creationBrief.finalStillFile = value; }
    rows.push({ kind: "shot-delivery", shotId: "L1-01", value });
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
const evaluateAsync = async (context, expression) =>
  JSON.parse(await vm.runInContext(`(async () => { ${expression} })().then(JSON.stringify)`, context));

async function open(spec, takes = [FRAME]) {
  const project = shotFixture(spec);
  const page = await render("#/shot/L1-01", project, { scan: scanWith(project, takes) });
  return page;
}

/* Every control a filmmaker can press, read the way a reader reads them: by their
   visible text, not by the handler behind them. Order is preserved, because on this
   panel the order IS part of the claim. */
function controls(markup) {
  const rows = [];
  for (const match of String(markup).matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const label = match[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const call = (match[1].match(/onclick="([^"]*)"/) || ["", ""])[1];
    if (label) rows.push({ label, call });
  }
  return rows;
}
const plain = (markup) => String(markup).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/* The panel and workspace surfaces this slice changed, read together in one realm at
   one moment. guidedMotionPanel() is deliberately NOT rendered here: it materialises a
   motion clip on the shot as a side effect of drawing (guidedActiveMotionUnit ->
   ensureGuidedMotionUnit), which would change the readiness every other surface in the
   same snapshot is being read against. */
const SURFACES = `
  const shot = P.shots[0];
  const takes = takesFor(shot.id);
  const readiness = shotReadinessFor(shot);
  return ({
    finish: guidedFinishPanel(shot, guidedApprovedMotion(shot, takes), guidedCurrentShotStill(shot, takes)),
    frames: shotFramesWorkspace(shot, takes),
    card: guidedShotStatusCard(shot, takes, { prev: null, next: null }),
    delivered: shotDeliveryAuthority(P, shot).final,
    kernelReceipt: !!currentHumanAuthority(P, { kind: "shot-delivery", shotId: shot.id }),
    readinessStatus: readiness ? readiness.status : "",
    readinessCode: readiness && readiness.nextAction ? readiness.nextAction.code : "",
    method: guidedMotionMethodWords(shot, 1),
    handoff: guidedMotionHandoffWords(shot),
  });
`;

/* ===========================================================================
   LL1 — FINISHING AND FINALIZATION ARE TWO DECISIONS, SO THEY ARE TWO NAMES.

   The reproduction, verbatim from the untouched foundation:

       BTN: Finish
       BTN: Finalize
       SUMMARY: "Upscale, repair, or mark the approved still or video final."

   Neither word says which decision it is, the summary names both in one breath, and
   the OPTIONAL one is offered first and to the left.
   =========================================================================== */

async function ll1_finishingIsNotFinalization() {
  for (const [label, spec, takes, primaryCall, secondaryCall] of [
    ["approved still", { motion: false }, [FRAME], "markGuidedStillFinal", "markCandidateForFinish"],
    ["approved video", { motion: true }, [FRAME, TAKE], "markGuidedVideoFinal", "queueGuidedVideoFinish"],
  ]) {
    const page = await open(spec, takes);
    const seen = evaluate(page.context, SURFACES);
    equal(seen.delivered, false, `LL1 ${label}: precondition — nobody has marked this shot final`);

    const rows = controls(seen.finish).filter((row) => /final|finish/i.test(row.label));
    deepEqual(rows.map((row) => row.label), ["Mark shot final", "Send to finishing"],
      `LL1 ${label}: exactly two controls, named for their decisions, primary first`);
    ok(rows[0].call.includes(primaryCall), `LL1 ${label}: Mark shot final writes delivery through ${primaryCall}: ${rows[0].call}`);
    ok(rows[1].call.includes(secondaryCall), `LL1 ${label}: Send to finishing queues the optional pass through ${secondaryCall}: ${rows[1].call}`);

    /* THE GENERIC WORDS ARE GONE AS CONTROL NAMES, and that is the whole of L1. They
       may still appear in prose ("Finishing is optional") — a sentence is not a
       button, and banning the word everywhere would have made the copy unwriteable. */
    for (const banned of ["Finish", "Finalize", "Finalise", "Complete", "Done"]) {
      ok(!controls(seen.finish).some((row) => row.label === banned),
        `LL1 ${label}: no control in Finish & Delivery is labelled exactly "${banned}"`);
    }

    const words = plain(seen.finish);
    ok(words.includes("Finishing is optional"), `LL1 ${label}: the panel says finishing is optional in as many words`);
    ok(/ready to mark final/.test(words), `LL1 ${label}: and that the approved result can be finalised as it is`);
  }
  note("LL1 Finish & Delivery offers Mark shot final first and Send to finishing second, and says which is optional");
}

/* ===========================================================================
   LL2 — A DELIVERED SHOT PROMOTES NO MOTION.

   The reproduction: a still-only shot with a current `shot-delivery` receipt still
   rendered, inside its Frames workflow,

       NEXT STEP / Image-to-video is ready / CREATE MOTION →

   as a large primary button. Section 4 asks for A, B and E of its five cases here; C
   and D are LL3.
   =========================================================================== */

async function ll2_deliveredShotPromotesNoMotion() {
  for (const [label, spec, takes] of [
    ["delivered still (4A/4B)", { motion: false, final: true }, [FRAME]],
    ["delivered motion shot (4E)", { motion: true, final: true, deliveredForm: "video" }, [FRAME, TAKE]],
  ]) {
    const page = await open(spec, takes);
    const seen = evaluate(page.context, SURFACES);

    equal(seen.kernelReceipt, true, `LL2 ${label}: precondition — a current shot-delivery receipt exists`);
    equal(seen.delivered, true, `LL2 ${label}: and the one projection agrees the shot is delivered`);
    equal(seen.readinessStatus, "COMPLETE", `LL2 ${label}: readiness reports the shot complete`);
    equal(seen.readinessCode, "nothing-outstanding", `LL2 ${label}: with nothing outstanding`);

    ok(!/frames-to-motion-cta/.test(seen.frames), `LL2 ${label}: the Frames workflow promotes no motion handoff`);
    for (const promotion of ["CREATE MOTION", "Create motion", "PRODUCE THE MOTION", "Produce the motion", "OPEN MOTION"]) {
      ok(!seen.frames.includes(promotion),
        `LL2 ${label}: and never renders "${promotion}" anywhere in it`);
    }
    ok(!plain(seen.frames).includes("NEXT STEP"), `LL2 ${label}: nothing in Frames claims to be the next step`);

    /* NOTHING WAS REMOVED, only the claim. The approved frame, its preview and its
       download are all still there — this is a CTA rule, not a Motion-unit redesign. */
    ok(/Download image/.test(seen.frames), `LL2 ${label}: the approved frame keeps its own context actions`);

    /* And the finalisation control does not reappear as unfinished work. */
    deepEqual(controls(seen.finish).filter((row) => /final|finish/i.test(row.label)).map((row) => row.label),
      ["Send to finishing"], `LL2 ${label}: Finish & Delivery offers no Mark shot final on a shot already final`);
    ok(plain(seen.finish).includes("Marked final"), `LL2 ${label}: it shows the decision that was taken`);
    ok(plain(seen.finish).includes("already final"), `LL2 ${label}: and says finishing does not change it`);
  }
  note("LL2 a shot with a current delivery receipt promotes no motion and is offered no second finalisation");
}

/* ===========================================================================
   LL3 — REQUIRED MOTION IS STILL REQUIRED WORK, AND KEEPS SLICE 1'S NAME.

   The anti-promotion rule of LL2 has one obvious way to go wrong: become broad enough
   to hide motion a shot genuinely needs. Section 4 cases C and D.
   =========================================================================== */

async function ll3_requiredMotionSurvives() {
  /* C — motion required, not produced, shot not final. */
  const page = await open({ route: "r2v", motion: false });
  const seen = evaluate(page.context, SURFACES);
  equal(seen.delivered, false, "LL3 C: precondition — the shot is not delivered");
  equal(seen.readinessCode, "produce-motion", "LL3 C: readiness names produce-motion as the shot's next action");
  ok(/frames-to-motion-cta/.test(seen.frames), "LL3 C: so the handoff is still promoted");

  /* ONE ACTION, ONE NAME. The button borrows Slice 1's own word rather than coining a
     second one, so the shot card and this CTA cannot drift apart. */
  const word = evaluate(page.context, `
    const readiness = shotReadinessFor(P.shots[0]);
    return ({ slice1: readinessActionWords(readiness.nextAction) });
  `).slice1;
  equal(seen.handoff, word, "LL3 C: the handoff is named by Slice 1's action words, not by a second vocabulary");
  ok(seen.frames.includes(word.toUpperCase()), `LL3 C: and the rendered button says "${word.toUpperCase()}"`);
  ok(!seen.frames.includes("CREATE MOTION"), "LL3 C: the third spelling of that action is gone");

  /* D — motion required and APPROVED, shot not yet final: the next action follows the
     existing readiness/finalisation truth rather than a motion promotion. */
  const approved = await open({ route: "r2v", motion: true }, [FRAME, TAKE]);
  const after = evaluate(approved.context, SURFACES);
  equal(after.delivered, false, "LL3 D: an approved motion take is not a delivered shot");
  deepEqual(controls(after.finish).filter((row) => /final|finish/i.test(row.label)).map((row) => row.label),
    ["Mark shot final", "Send to finishing"], "LL3 D: the shot is offered its finalisation decision, finishing beside it");

  /* And a shot readiness has BLOCKED on an unapproved frame is not being asked to
     produce motion, even though a required motion unit exists on it. */
  const blocked = await open({ route: "flf", motion: false });
  const blockedSeen = evaluate(blocked.context, SURFACES);
  equal(blockedSeen.readinessCode, "approve-required-frames", "LL3: precondition — an flf shot still wants its closing frame");
  equal(blockedSeen.handoff, "Open Motion", "LL3: so the handoff is navigation, not a produce-motion claim");

  note("LL3 required motion keeps its promotion and Slice 1's exact word; a blocked shot is not told to produce motion");
}

/* ===========================================================================
   LL4 — THE METHOD IS THE ONE THIS SHOT DECLARED.

   R2V is a first-class execution method. The handoff used to name the method from the
   approved-anchor count, which can only ever produce a frame-endpoint answer, so an
   r2v shot read "Image-to-video is ready".
   =========================================================================== */

async function ll4_methodLanguage() {
  const seenByRoute = {};
  for (const route of ["t2v", "i2v", "flf", "r2v"]) {
    const page = await open({ route, motion: false });
    const seen = evaluate(page.context, SURFACES);
    seenByRoute[route] = seen;

    /* THE WORDS ARE NOT WRITTEN HERE AND ARE NOT WRITTEN THERE EITHER. Both sides read
       the shipped owner, which is what makes this an agreement rather than a copy. */
    equal(seen.method, CINEBRAID_MODE_LANGUAGE[route],
      `LL4 ${route}: the handoff names the shot's declared method in the shipped mode language`);
    ok(seen.frames.includes(CINEBRAID_MODE_LANGUAGE[route]),
      `LL4 ${route}: and the rendered CTA carries that phrase`);
  }

  /* FOUR DISTINCT METHODS, FOUR DISTINCT SENTENCES. */
  const phrases = ["t2v", "i2v", "flf", "r2v"].map((route) => seenByRoute[route].method);
  equal(new Set(phrases).size, 4, "LL4: the four execution methods are distinguished, not collapsed");

  /* R2V IS NOT A FRAME-ENDPOINT MECHANISM, and the copy no longer says it is. */
  const r2v = seenByRoute.r2v.frames;
  for (const wrong of ["Image-to-video", "First / last-frame", "Animate between frames", "Animate from first frame"]) {
    ok(!r2v.includes(wrong), `LL4 r2v: the handoff never describes a reference-to-video shot as "${wrong}"`);
  }
  ok(seenByRoute.flf.frames.includes(CINEBRAID_MODE_LANGUAGE.flf),
    "LL4 flf: explicit endpoint control keeps its own name, where it is genuinely what the shot does");
  ok(seenByRoute.t2v.frames.includes(CINEBRAID_MODE_LANGUAGE.t2v),
    "LL4 t2v: a prompt-only shot says so");

  /* AN UNDECLARED SHOT IS NOT GIVEN AN INTENT. The anchor reading stays for exactly the
     shot Slice 5b forbids inventing an intent for. */
  const undeclared = evaluate((await open({ route: null, motion: false })).context, `
    const shot = P.shots[0];
    return ({
      declared: typeof declaredShotRoute === "function" ? declaredShotRoute(shot) : "",
      one: guidedMotionMethodWords(shot, 1),
      two: guidedMotionMethodWords(shot, 2),
      three: guidedMotionMethodWords(shot, 3),
    });
  `);
  equal(undeclared.declared, "", "LL4 undeclared: precondition — this shot declares no route");
  deepEqual([undeclared.one, undeclared.two, undeclared.three],
    ["Image-to-video", "First / last-frame motion", "Multi-frame motion"],
    "LL4 undeclared: the shipped anchor reading is kept, and no intent is invented from it");

  /* AND THE PICKER ROW SAYS WHAT R2V IS. "reference performance" named no method a
     filmmaker could match to the intent they had just declared. */
  const suffixes = evaluate((await open({ route: "r2v" })).context, `
    const rows = {};
    for (const profile of guidedVideoProfiles()) {
      if (!guidedVideoProfileDispatchable(profile)) continue;
      rows[profile.mode] = rows[profile.mode] || guidedVideoProfileOptionSuffix(profile, "");
    }
    return rows;
  `);
  if (suffixes.r2v !== undefined) {
    ok(/reference to video/i.test(suffixes.r2v),
      `LL4: a dispatchable r2v row names reference to video, got "${suffixes.r2v}"`);
    ok(!/reference performance/i.test(suffixes.r2v), "LL4: and no longer calls it a reference performance");
  }
  if (suffixes.flf !== undefined) {
    ok(/first \+ last frame/i.test(suffixes.flf), "LL4: while flf still names the endpoints it genuinely controls");
  }

  /* BOTH ARMS OF THE R2V ROW. Only MiniMax H3's multi-frame target is dispatchable in
     this build, so the other arm — every non-H3 r2v target, the one that used to read
     " · reference performance" — is unreachable through the catalogue and is asked for
     directly instead. A row a filmmaker cannot press today is still a row they read. */
  const arms = evaluate((await open({ route: "r2v" })).context, `
    const dispatchable = (family) => ({ mode: "r2v", family, execution: { dispatchable: true } });
    return ({
      h3: guidedVideoProfileOptionSuffix(dispatchable("minimax-h3"), ""),
      other: guidedVideoProfileOptionSuffix(dispatchable("kling-3"), ""),
    });
  `);
  for (const [arm, suffix] of Object.entries(arms)) {
    ok(/reference to video/i.test(suffix), `LL4: the ${arm} r2v row names reference to video, got "${suffix}"`);
    ok(!/reference performance/i.test(suffix), `LL4: and the ${arm} row names a method rather than a performance`);
  }
  ok(arms.other !== arms.h3, "LL4: the two r2v rows still say what is different about them");

  note("LL4 every declared route names its own method in the shipped mode language; r2v is never described as a frame-endpoint mechanism");
}

/* ===========================================================================
   LL5 — APPROVING A CANDIDATE IS NOT DELIVERING THE SHOT.

   Slice 1 already owns the handoff. What is checked here is the LANGUAGE on both sides
   of it: the approval dialogs must not claim completion, and the panel that follows
   must name the decision that is still outstanding.
   =========================================================================== */

const FINAL_CLAIMS = ["Final delivery locked", "Marked final", "Shot delivered", "locked for delivery", "SHOT COMPLETE", "delivered"];

async function ll5_approvingIsNotDelivering() {
  const page = await open({ motion: false, frame: "", secondFrame: true }, ["CANDIDATE_1.png"]);
  const modals = evaluate(page.context, `
    const id = P.shots[0].id;
    const out = {};
    let captured = "";
    const realOpen = window.openModal;
    window.openModal = (html) => { captured = String(html); };
    approveGuidedStill(id, "CANDIDATE_1.png"); out.shotStill = captured; captured = "";
    const frames = guidedFrames(P.shots[0]);
    approveGuidedFrame(id, frames[1].id, "CANDIDATE_1.png"); out.frame = captured; captured = "";
    approveTake(id, "CANDIDATE_1.png"); out.version = captured; captured = "";
    window.openModal = realOpen;
    return out;
  `);
  for (const [label, markup] of Object.entries(modals)) {
    ok(markup, `LL5 ${label}: the approval dialog rendered`);
    for (const claim of FINAL_CLAIMS) {
      ok(!plain(markup).toLowerCase().includes(claim.toLowerCase()),
        `LL5 ${label}: an approval dialog never says "${claim}"`);
    }
    ok(/APPROVE/.test(markup), `LL5 ${label}: it names the decision it is actually taking`);
  }

  /* THE OTHER SIDE OF THE HANDOFF. An approved-but-unfinished shot holds no delivery
     receipt, and the panel names the decision that is still the filmmaker's. */
  const approved = evaluate((await open({ motion: false })).context, SURFACES);
  equal(approved.kernelReceipt, false, "LL5: approving a frame writes no shot-delivery receipt");
  equal(approved.delivered, false, "LL5: and the one projection says the shot is not delivered");
  equal(approved.readinessCode, "mark-shot-final", "LL5: readiness hands off to the finalisation decision");
  ok(controls(approved.finish).some((row) => row.label === "Mark shot final"),
    "LL5: and Finish & Delivery offers exactly that, by that name");
  for (const claim of ["Final delivery locked", "Marked final", "Shot delivered"]) {
    ok(!approved.finish.includes(claim), `LL5: the panel claims no delivery it has no receipt for ("${claim}")`);
  }

  note("LL5 no approval dialog claims completion, and the panel after approval names the finalisation decision that is still open");
}

/* ===========================================================================
   LL6 — THE FILENAME IS CARRIED, NOT ASKED.

   The reproduction, verbatim:

       <label>Canonical filename</label><input id="approve-name" value="...">

   in the shot-still and frame dialogs with no caption at all, and once more in Approve
   version under "Generated canonical filename ... Edit only for an exceptional naming
   requirement". The value was ALWAYS the deterministic one; the field only offered a
   chance to get it wrong.
   =========================================================================== */

async function ll6_filenameIsNotAQuestion() {
  const page = await open({ motion: false, frame: "", secondFrame: true }, ["CANDIDATE_1.png"]);
  const seen = evaluate(page.context, `
    const id = P.shots[0].id;
    const out = {};
    let captured = "";
    const realOpen = window.openModal;
    window.openModal = (html) => { captured = String(html); };
    approveGuidedStill(id, "CANDIDATE_1.png"); out.shotStill = { markup: captured, expected: canonicalSuggestion(id, "CANDIDATE_1.png", "shot") }; captured = "";
    const frames = guidedFrames(P.shots[0]);
    const target = "frame:" + frames[1].id;
    approveGuidedFrame(id, frames[1].id, "CANDIDATE_1.png"); out.frame = { markup: captured, expected: canonicalSuggestion(id, "CANDIDATE_1.png", target) }; captured = "";
    approveTake(id, "CANDIDATE_1.png"); out.version = { markup: captured, expected: "" }; captured = "";
    const entity = P.characters[0];
    approveEntityFile("characters", entity.id, (entityMedia("characters", entity)[0] || {}).name || "");
    out.entity = { markup: captured, expected: "" }; captured = "";
    window.openModal = realOpen;
    return out;
  `);

  for (const [label, row] of Object.entries(seen)) {
    const markup = String(row.markup || "");
    if (!markup) continue;
    /* NOBODY IS ASKED. No visible label carries the question, and no filename input is
       something a filmmaker can see or type into. */
    ok(!/canonical filename/i.test(plain(markup)),
      `LL6 ${label}: the dialog puts no filename question in front of the filmmaker`);
    for (const field of ["approve-name", "entity-approve-name"]) {
      const input = markup.match(new RegExp(`<input[^>]*id="${field}"[^>]*>`));
      if (!input) continue;
      ok(/type="hidden"/.test(input[0]),
        `LL6 ${label}: ${field} is carried the way the approval target is, not asked: ${input[0]}`);
    }
    if (row.expected) {
      const input = markup.match(/<input[^>]*id="approve-name"[^>]*>/);
      ok(input && input[0].includes(`value="${row.expected}"`),
        `LL6 ${label}: and the carried value is the deterministic one, ${row.expected}`);
    }
  }

  /* THE DERIVATION IS LIVE, NOT DECORATIVE. Approving through the shipped control still
     renames the bytes to the project's canonical name, so what was removed is the
     question and nothing else.

     THE HARNESS CANNOT PARSE MODAL MARKUP INTO THE DOM — its elements come from a fixed
     map, which is why every shipped suite that exercises this control assigns the
     dialog's fields by hand. So the two values are lifted OUT OF THE RENDERED DIALOG and
     put where a browser would have put them. Nothing here computes what the name should
     be: it is whatever the dialog carried, and the assertions below then require that to
     be both the derived name and the one the rename actually applies. */
  const carried = evaluate(page.context, `
    const id = P.shots[0].id;
    let captured = "";
    const realOpen = window.openModal;
    window.openModal = (html) => { captured = String(html); };
    approveGuidedStill(id, "CANDIDATE_1.png");
    window.openModal = realOpen;
    const read = (field) => {
      const tag = captured.match(new RegExp('<input[^>]*id="' + field + '"[^>]*>'));
      const value = tag ? tag[0].match(/value="([^"]*)"/) : null;
      return value ? value[1] : "";
    };
    return ({ target: read("approve-target"), name: read("approve-name"), derived: canonicalSuggestion(id, "CANDIDATE_1.png", "shot") });
  `);
  equal(carried.target, "shot", "LL6: the dialog carries the approval target");
  equal(carried.name, carried.derived, "LL6: and carries the derived canonical name beside it");

  evaluate(page.context, `
    globalThis.__renameSpy = [];
    const realFetch = fetch;
    globalThis.fetch = async (url, options) => {
      if (String(url) === "/api/media/rename") globalThis.__renameSpy.push(JSON.parse(String((options || {}).body || "{}")));
      return realFetch(url, options);
    };
    document.getElementById("approve-target").value = ${JSON.stringify(carried.target)};
    document.getElementById("approve-name").value = ${JSON.stringify(carried.name)};
    return ({});
  `);
  /* THROUGH THE SHIPPED GESTURE. The kernel refuses a canonical write that did not
     happen inside a trusted event, so an approval performed any other way writes no
     authority and never reaches the rename at all. */
  await page.gesture.act(() => page.context.confirmApproveTake());
  await new Promise((resolve) => setTimeout(resolve, 30));
  const renamed = evaluate(page.context, `return ({ requests: globalThis.__renameSpy || [] });`);
  equal(renamed.requests.length, 1, "LL6: approving still asks the shipped rename route to move the bytes");
  equal(renamed.requests[0].to, carried.derived, "LL6: to exactly the name CineBraid derived, with nobody asked for it");
  equal(renamed.requests[0].from, "CANDIDATE_1.png", "LL6: from the file the filmmaker was looking at");

  /* AND THE CONVENTION STILL HAS A HOME. It is a project setting with its own preview,
     which is where a studio naming requirement belongs — applying to every approval
     rather than to whichever one somebody retyped correctly. */
  const template = evaluate(page.context, `
    return ({ template: (CONFIG && CONFIG.naming && CONFIG.naming.filenameTemplate) || "" });
  `).template;
  ok(template.includes("{shot}") && template.includes("{version}"),
    `LL6: the naming convention remains a configured template, got "${template}"`);

  note("LL6 no approval dialog asks for a filename; the deterministic name is carried like the target and is still what the rename applies");
}

/* ===========================================================================
   LL7 — ONE UNDERLYING ACTION, ONE FILMMAKER-FACING NAME.

   The invariant §8 asks for, checked as a SET rather than string by string: across
   every control the shot workspace and its dialogs render, the finishing action has
   exactly one name and the finalisation action has exactly one name.
   =========================================================================== */

async function ll7_oneNamePerAction() {
  const page = await open({ motion: true }, [FRAME, TAKE]);
  const seen = evaluate(page.context, SURFACES);
  const extra = evaluate(page.context, `
    const shot = P.shots[0];
    /* The finishing dialog refuses an unapproved candidate, which is correct and is not
       what this group is about: the take is approved through the shipped row so the
       dialog opens on the path a filmmaker actually reaches it by. */
    candidateRecord(shot, "${TAKE}", true).approvedAt = "2026-08-14T00:00:00.000Z";
    let captured = "";
    const realOpen = window.openModal;
    window.openModal = (html) => { captured = String(html); };
    markCandidateForFinish(shot.id, "${TAKE}");
    window.openModal = realOpen;
    return ({ finishingModal: captured });
  `);

  const surface = [seen.finish, seen.frames, seen.card, extra.finishingModal].join("\n");
  const labels = controls(surface).map((row) => row.label);

  /* CASE IS PRESENTATION, NOT VOCABULARY. This product writes panel controls in
     sentence case and modal confirms in caps, and CSS uppercases several of both, so a
     case-sensitive set would report two names for one action purely because of where
     the control sits. The invariant is the WORD. */
  const names = (pattern) => [...new Set(labels.filter((label) => pattern.test(label)).map((label) => label.toLowerCase()))].sort();

  deepEqual(names(/finish/i), ["send to finishing"],
    `LL7: the optional finishing action has exactly one name across the workspace, got ${JSON.stringify(names(/finish/i))}`);

  deepEqual(names(/\bfinal\b/i), ["mark shot final"],
    `LL7: and so does the finalisation decision, got ${JSON.stringify(names(/\bfinal\b/i))}`);

  /* THE AMBIGUOUS GENERICS ARE NOT CONTROL NAMES ANYWHERE ON THESE SURFACES. */
  for (const banned of ["Finish", "Finalize", "Finalise", "Complete", "Done", "Create motion", "Add motion", "Finish shot"]) {
    ok(!labels.some((label) => label.toLowerCase() === banned.toLowerCase()),
      `LL7: no control on these surfaces is labelled exactly "${banned}"`);
  }

  /* The finishing dialog says what it does and, just as importantly, what it does not. */
  const words = plain(extra.finishingModal);
  ok(/send to finishing/i.test(words), "LL7: the finishing dialog carries the same name as the control that opened it");
  ok(/does not mark the shot final/i.test(words), "LL7: and says finishing does not finalise the shot");

  note("LL7 one name per action across Finish & Delivery, Frames, the shot card and the finishing dialog");
}

/* ===========================================================================
   LL8 — THE WORKSPACE NAME MAY STAY; THE CONTROLS INSIDE IT MAY NOT BE VAGUE.
   =========================================================================== */

async function ll8_workspaceNameSurvives() {
  const page = await open({ motion: false });
  const seen = evaluate(page.context, SURFACES);
  ok(seen.finish.includes("FINISH &amp; DELIVERY") || seen.finish.includes("FINISH & DELIVERY"),
    "LL8: Finish & Delivery keeps its name — it is a truthful workspace name, not a control");

  const stage = evaluate(page.context, `
    const stage = (SHOT_STAGES || []).find((row) => row.id === "deliver") || {};
    return ({ label: stage.label || "", detail: stage.detail || "", purpose: stage.purpose || "",
              actions: (stage.readinessActions || []).map((row) => row.code) });
  `);
  equal(stage.label, "Deliver", "LL8: the declared stage keeps the board's word");
  ok(stage.actions.includes("mark-shot-final"), "LL8: and still declares the finalisation action it routes to");
  ok(!/finalize|finalise/i.test(stage.detail + stage.purpose),
    `LL8: the stage no longer describes itself with the generic verb, got "${stage.detail}" / "${stage.purpose}"`);
  ok(/optional/i.test(stage.detail + stage.purpose), "LL8: it says which half of its work is optional");
  ok(/final/i.test(stage.purpose), "LL8: and which half ends the shot");

  note("LL8 the Finish & Delivery workspace name survives; the declared stage stops describing itself with a generic verb");
}

/* ===========================================================================
   THE BROWSER FIXTURE, written from here so both halves of this slice test one project
   and cannot drift into testing different ones while both reporting green.

       LANG-A  approved still, nobody has finalised it
               — the shot that must offer Mark shot final first and Send to finishing
                 second, and must say which of the two is optional
       LANG-B  the same shot, already marked final
               — the shot that used to go on promoting CREATE MOTION as its next step
       LANG-C  a shot declared r2v with its motion still to produce
               — the shot that used to be told "Image-to-video is ready"
       LANG-D  a returned candidate nobody has approved
               — the approval dialog that used to ask for a canonical filename
   =========================================================================== */

const BROWSER_FIXTURE = Object.freeze({
  approved: "LANG-A", delivered: "LANG-B", reference: "LANG-C", candidate: "LANG-D",
  frame: FRAME, returned: "LANG-D_FRAME_A_FAL_1.png",
});

function writeBrowserFixture(dir) {
  const fs = require("fs");
  const path = require("path");
  const shots = [BROWSER_FIXTURE.approved, BROWSER_FIXTURE.delivered, BROWSER_FIXTURE.reference, BROWSER_FIXTURE.candidate];
  for (const folder of ["anchors", "plates", "props", "media", "docs", ...shots.map((id) => path.join("shots", id, "takes"))])
    fs.mkdirSync(path.join(dir, folder), { recursive: true });
  fs.writeFileSync(path.join(dir, "anchors", "KAI-ANCHOR.png"), "kai");
  fs.writeFileSync(path.join(dir, "plates", "LOC-HULL-PLATE.png"), "hull");
  fs.writeFileSync(path.join(dir, "props", "PR-TOOL-PLATE.png"), "tool");
  for (const id of shots.slice(0, 3)) fs.writeFileSync(path.join(dir, "shots", id, "takes", FRAME), "frame");
  fs.writeFileSync(path.join(dir, "shots", BROWSER_FIXTURE.candidate, "takes", BROWSER_FIXTURE.returned), "returned");

  const base = shotFixture({});
  const template = base.shots[0];
  const specs = [
    { id: BROWSER_FIXTURE.approved, title: "Hull check", route: "t2i", winner: FRAME, final: false },
    { id: BROWSER_FIXTURE.delivered, title: "Hull wide", route: "t2i", winner: FRAME, final: true },
    { id: BROWSER_FIXTURE.reference, title: "Panel move", route: "r2v", winner: FRAME, final: false },
    { id: BROWSER_FIXTURE.candidate, title: "Lost result", route: "t2i", winner: "", final: false },
  ];
  const project = rawFixture();
  const rows = [...CAST_CANON];
  project.shots = specs.map((spec) => {
    const shot = JSON.parse(JSON.stringify(template));
    shot.id = spec.id;
    shot.title = spec.title;
    shot.scene = project.scenes[0].id;
    shot.clips = [];
    shot.deliveryRoute = spec.route;
    shot.creationBrief = { ...(shot.creationBrief || {}), deliveryIntent: "still" };
    shot.keyframes = [{ ...shot.keyframes[0], id: "frame-a", label: "A", winner: spec.winner, required: true }];
    if (spec.winner) {
      rows.push({ kind: "shot-frame", shotId: spec.id, frameId: "frame-a", value: spec.winner });
      /* The approved take's candidate row, with its approval recorded. The finishing
         dialog correctly refuses a candidate nobody approved, and a fixture without this
         row would make the browser half's Send-to-finishing click a silent no-op that
         looked like a missing control. */
      shot.candidateFiles = [{
        stored: spec.winner, original: spec.winner, addedAt: "2026-08-20T10:00:00.000Z",
        decision: "shortlist", notes: "", labels: [], frameId: "frame-a",
        approvedAt: "2026-08-20T10:30:00.000Z", approvedTarget: "shot",
        generationJobId: `job-${spec.id}`, sourceBuildId: "",
        generationProvider: "fal", generationModel: "gpt-image-2",
      }];
    }
    if (spec.final) {
      shot.finalStillFile = spec.winner;
      shot.creationBrief.finalStillFile = spec.winner;
      rows.push({ kind: "shot-delivery", shotId: spec.id, value: spec.winner });
    }
    if (spec.id === BROWSER_FIXTURE.candidate) {
      shot.candidateFiles = [{
        stored: BROWSER_FIXTURE.returned, original: BROWSER_FIXTURE.returned,
        addedAt: "2026-08-20T10:00:00.000Z", decision: "unreviewed", notes: "", labels: [],
        frameId: "frame-a", generationJobId: "job-lang-d", sourceBuildId: "",
        generationProvider: "fal", generationModel: "gpt-image-2",
      }];
    }
    return shot;
  });
  project.meta.title = "Launch Language Project";
  /* EVERY ENTITY DECLARES ITS DEFAULT STATE EXPLICITLY, which is what a project looks
     like once CineBraid has opened it once. Without it, load-time normalisation creates
     the row on open, the first ordinary save carries a target the stored document did
     not have, and the authority seam correctly puts a refusal dialog on screen — which
     then eats the clicks this slice's browser half is trying to make. That behaviour is
     real, reproduces on unmodified main, and belongs to save/load work rather than
     here. */
  for (const [list, file] of [["characters", "KAI-ANCHOR.png"], ["locations", "LOC-HULL-PLATE.png"], ["props", "PR-TOOL-PLATE.png"]])
    for (const entity of project[list] || [])
      entity.continuityStates = [{
        id: "state-default", name: "Default", appliesTo: "", approvedFile: entity.approvedFile || file,
        approvedAssetId: "", notes: "Primary approved reference.", isDefault: true,
      }];
  const written = withCanon(project, rows);
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(written, null, 2));
  return written;
}

/* The Node half drives the same fixture in memory, so a shape the browser suite depends
   on cannot silently stop existing without this file failing first. */
async function ll9_browserFixtureIsTheShapeItClaims() {
  const os = require("os");
  const fs = require("fs");
  const path = require("path");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-language-fixture-"));
  const project = writeBrowserFixture(temp);
  const takesByShot = {
    [BROWSER_FIXTURE.approved]: [FRAME],
    [BROWSER_FIXTURE.delivered]: [FRAME],
    [BROWSER_FIXTURE.reference]: [FRAME],
    [BROWSER_FIXTURE.candidate]: [BROWSER_FIXTURE.returned],
  };
  const scan = {
    anchors: (project.characters || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/anchors/${x.approvedFile}` })),
    plates: (project.locations || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/plates/${x.approvedFile}` })),
    props: (project.props || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/props/${x.approvedFile}` })),
    vehicles: [], audio: [], media: [],
    shots: Object.fromEntries(Object.entries(takesByShot).map(([id, takes]) => [id, {
      takes: takes.map((name) => ({ name, url: `/assets/shots/${id}/takes/${name}` })), locked: [],
    }])),
  };
  for (const [id, expected] of [
    [BROWSER_FIXTURE.approved, { delivered: false, code: "mark-shot-final" }],
    [BROWSER_FIXTURE.delivered, { delivered: true, code: "nothing-outstanding" }],
    [BROWSER_FIXTURE.reference, { delivered: false, code: "produce-motion" }],
  ]) {
    const page = await render(`#/shot/${id}`, project, { scan });
    const seen = evaluate(page.context, SURFACES.replace("P.shots[0]", `P.shots.find((row) => row.id === ${JSON.stringify(id)})`));
    equal(seen.delivered, expected.delivered, `LL9 ${id}: the browser fixture's delivery state is what the browser half assumes`);
    equal(seen.readinessCode, expected.code, `LL9 ${id}: and so is its readiness action`);
  }
  fs.rmSync(temp, { recursive: true, force: true });
  note("LL9 the browser fixture is the shape the Chromium half asserts against");
}

/* ===========================================================================
   RUN.
   =========================================================================== */

async function main() {
  await ll1_finishingIsNotFinalization();
  await ll2_deliveredShotPromotesNoMotion();
  await ll3_requiredMotionSurvives();
  await ll4_methodLanguage();
  await ll5_approvingIsNotDelivering();
  await ll6_filenameIsNotAQuestion();
  await ll7_oneNamePerAction();
  await ll8_workspaceNameSurvives();
  await ll9_browserFixtureIsTheShapeItClaims();

  console.log("Launch language convergence:");
  for (const line of notes) console.log("  " + line);
  console.log(`\nLaunch language convergence passed ${checks} assertions across 9 groups.`);
  console.log("No project data touched, no server started, no provider or paid call made.");
}

module.exports = { writeBrowserFixture, BROWSER_FIXTURE };

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

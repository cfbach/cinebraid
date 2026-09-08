/* REFERENCES UX CONVERGENCE V1 — the behavioural half.
 *
 * This slice changed no truth. It changed what the References page LEADS WITH,
 * what it says while a decision is still open, and where an action puts the
 * filmmaker back. So every check below is about presentation and hand-off, and
 * each one is written as the thing a person observed rather than as a class name:
 *
 *    R1   a provenance chooser with one non-answer is not rendered at all
 *    R2   the dark area around an enlarged image closes it; the image does not
 *    R3   the crop workspace leads with the crop, and keeps the machinery
 *    R4   saving or assigning returns to Coverage, and opens no review nobody asked for
 *    R5   a candidate nobody reviewed has no PASS factors
 *    R6   the production-needs panel summarises the plan instead of re-rendering the board
 *    R7   the board says which axis its "Required" is about
 *    R8   staging previews immediately and writes nothing
 *    R10  the visual chooser is primary; the filename list is the fallback
 *    R21  "+ Add continuity state" is beside the heading
 *    R22  the native status dropdown is readable in the dark theme
 *    R23  Details leads with notes; voice, metadata and the pack open when asked
 *    single-state approval offers one act, not four controls
 *
 * TWO THINGS THIS SUITE DELIBERATELY DOES NOT CLAIM. It does not measure how any
 * of this LOOKS — vertical rhythm, contrast ratios and whether a strip reads as
 * compact are human-acceptance items and are listed as such in the receipt. And
 * it does not re-prove the accepted truth underneath: that a slot does not commit
 * on selection, that a sheet cannot be an identity, and that the coverage board
 * renders four states are tests/reference-truth-sheet-gate.js's claims, and they
 * still run.
 *
 * Provider calls made by this suite: 0. It never dispatches.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const { render, buildFixture, withCanon, settleApprovalReadiness } = require("./render-harness");

const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };
const eq = (actual, expected, message) => { assert.strictEqual(actual, expected, message); checks++; };

/* ---------------------------------------------------------------------------
   FIXTURE. One character carrying every shape the findings talk about: a
   satisfied view, a required gap, a planned view, an affirmatively not-required
   view, expressions, a candidate with no review at all, and a coverage sheet. */
function convergenceFixture({ states = 1, cast = false, primaryApproved = true } = {}) {
  const project = buildFixture();
  const character = project.characters[0];
  character.id = "CHAR-UX";
  character.name = "Nora";
  character.prefix = "CHAR-UX";
  character.approvedFile = primaryApproved ? "CHAR-UX-PRIMARY.png" : "";
  character.continuityStates = [
    { id: "state-default", name: "Default", isDefault: true, approvedFile: primaryApproved ? "CHAR-UX-PRIMARY.png" : "", notes: "Primary identity." },
  ];
  if (states > 1) {
    character.continuityStates.push({
      id: "state-soaked", name: "Soaked", isDefault: false, parentStateId: "state-default",
      approvedFile: "", notes: "Rain sequence.", referenceRequirement: "required", generationMode: "derive",
    });
  }
  character.coverageSlots = [
    { id: "front", label: "Front", requirement: "required", selectedFile: "CHAR-UX-FRONT.png", status: "selected" },
    { id: "profile", label: "Profile", requirement: "required", selectedFile: "" },
    { id: "rear", label: "Rear", requirement: "planned", selectedFile: "" },
    { id: "overhead", label: "Overhead", requirement: "not-required", selectedFile: "" },
  ];
  character.expressionSlots = [
    { id: "neutral", label: "Neutral", requirement: "required", selectedFile: "" },
    { id: "focused", label: "Focused", requirement: "planned", selectedFile: "" },
  ];
  character.candidateFiles = [
    { stored: "CHAR-UX-PRIMARY.png", original: "CHAR-UX-PRIMARY.png", decision: "unreviewed" },
    { stored: "CHAR-UX-FRONT.png", original: "CHAR-UX-FRONT.png", decision: "selected-coverage", coverageJobType: "extracted-crop", referenceView: "front" },
    { stored: "CHAR-UX-LOOSE.png", original: "loose-drop.png", decision: "unreviewed", coverageJobType: "single-reference" },
    { stored: "CHAR-UX-SHEET.png", original: "CHAR-UX-SHEET.png", decision: "unreviewed", coverageJobType: "sheet", coverageSheetType: "angles" },
  ];
  /* `cast: false` is the dormant case the human pass was looking at — a reference
     no shot uses yet, which is what made "nothing is required now" true while the
     board underneath said "Required — missing". */
  for (const shot of project.shots || []) shot.characters = cast ? [character.id] : [];
  if (!primaryApproved) return project;
  return withCanon(project, {
    kind: "entity-state", list: "characters", entityId: character.id, stateId: "state-default",
    value: "CHAR-UX-PRIMARY.png",
  });
}

const convergenceScan = () => ({
  anchors: [
    { name: "CHAR-UX-PRIMARY.png", url: "/assets/anchors/CHAR-UX-PRIMARY.png" },
    { name: "CHAR-UX-FRONT.png", url: "/assets/anchors/CHAR-UX-FRONT.png" },
    { name: "CHAR-UX-LOOSE.png", url: "/assets/anchors/CHAR-UX-LOOSE.png" },
    { name: "CHAR-UX-SHEET.png", url: "/assets/anchors/CHAR-UX-SHEET.png" },
  ],
  plates: [], props: [], vehicles: [], audio: [], media: [],
  shots: { "L1-01": { takes: [], locked: [] } },
});

const COVERAGE_STORAGE = {
  "cinebraid-focused:fixture:entity-task:characters:CHAR-UX": "coverage",
  "cinebraid-bounded:fixture:selected:entity-coverage-view:characters:CHAR-UX": "coverage",
};
const DETAILS_STORAGE = { "cinebraid-focused:fixture:entity-task:characters:CHAR-UX": "details" };

const surface = (project, storage = {}) =>
  render("#/character/CHAR-UX", project, { scan: convergenceScan(), storage });

/* The section of a page between two markers — used to assert that something is
   INSIDE a particular disclosure rather than merely present somewhere. */
function within(html, openTag, closeHint) {
  const start = html.indexOf(openTag);
  if (start < 0) return "";
  const end = html.indexOf(closeHint, start);
  return end < 0 ? html.slice(start) : html.slice(start, end);
}

/* ==========================================================================
   R1 — A CHOOSER WITH ONE NON-ANSWER.
   ========================================================================== */
async function testOneOptionProvenanceIsNotRendered() {
  const rendered = await surface(convergenceFixture());
  const openIntake = `(() => {
    intakeModal('characters','CHAR-UX',[{ name: 'drop.png', type: 'image/png' }]);
    return document.getElementById('modal').innerHTML;
  })()`;

  /* The shipped default: a project with no model list of its own. */
  eq(vm.runInContext("(P.meta.models || []).length", rendered.context), 0,
    "baseline: the fixture carries no project models, which is the common case");
  const bare = vm.runInContext(openIntake, rendered.context);
  ok(bare.includes("What are these files?"),
    "the one question CineBraid genuinely cannot answer for itself is still asked");
  ok(!bare.includes('id="in-model"'),
    "with nothing to choose between, the provenance chooser must not be rendered at all");
  ok(!bare.includes("Made with"),
    "and its label must not occupy a field either");

  /* Two real models: the chooser is a choice again and comes back. */
  const withModels = vm.runInContext(
    `(() => { P.meta.models = [{ id: 'm-a', name: 'Model A' }, { id: 'm-b', name: 'Model B' }];
       ${openIntake.slice(openIntake.indexOf("intakeModal"))}`.replace(/\}\)\(\)$/, "})()"),
    rendered.context);
  ok(withModels.includes('id="in-model"'),
    "once real choices exist the chooser appears — the capability was hidden, not removed");
  ok(withModels.includes("Model A") && withModels.includes("Model B"),
    "and it offers the project's own models");
  ok(withModels.includes("— not recorded —"),
    "with the honest non-answer still available beside them");

  /* The WRITER is untouched, which is what makes the hidden field safe. */
  const tools = read("public/library-tools.js");
  ok(/model\s*=\s*document\.getElementById\("in-model"\)\?\.value \|\| ""/.test(tools),
    "doIntake() still reads the provenance field, and still treats its absence as not-recorded");
  ok(/\(it\.made = it\.made \|\| \[\]\)\.push\(/.test(tools),
    "and still writes the `made` provenance record when a model was chosen");
}

/* ==========================================================================
   R2 — THE BACKDROP IS A CONTROL.
   ========================================================================== */
async function testLightboxBackdropCloses() {
  const rendered = await surface(convergenceFixture());
  /* A DOM the page can bind to. The shipped harness auto-creates any element by
     id, so renderLB() would never take its create-and-bind branch; this makes
     `#lb` genuinely absent until the page appends it, which is the real
     sequence. Nothing about review.js is stubbed — the listener captured below
     is the one the page installed. */
  vm.runInContext(`(() => {
    const realGet = document.getElementById.bind(document);
    const realCreate = document.createElement.bind(document);
    const bag = { listeners: [], removed: 0 };
    let lbEl = null;
    document.getElementById = (id) => (id === 'lb' ? lbEl : realGet(id));
    document.createElement = (tag) => {
      const el = realCreate(tag);
      el.addEventListener = (type, fn) => bag.listeners.push({ type, fn });
      el.remove = () => { bag.removed++; lbEl = null; };
      return el;
    };
    document.body.appendChild = (child) => { lbEl = child; return child; };
    globalThis.__lb = bag;
    globalThis.__lbEl = () => lbEl;
  })()`, rendered.context);

  const opened = vm.runInContext(`(() => {
    openLBMedia(encodeURIComponent(JSON.stringify([
      { name: 'CHAR-UX-PRIMARY.png', url: '/assets/anchors/CHAR-UX-PRIMARY.png' },
      { name: 'CHAR-UX-FRONT.png', url: '/assets/anchors/CHAR-UX-FRONT.png' },
    ])), 0, 'CHAR-UX');
    const bag = globalThis.__lb;
    return { open: !!globalThis.__lbEl(), clickListeners: bag.listeners.filter(l => l.type === 'click').length,
             html: globalThis.__lbEl() ? globalThis.__lbEl().innerHTML : '' };
  })()`, rendered.context);
  eq(opened.open, true, "baseline: the viewer opens");
  eq(opened.clickListeners, 1, "and binds exactly one click handler on its own root");
  ok(opened.html.includes("lb-stage") && opened.html.includes("lb-close"),
    "baseline: the stage and the explicit close control are both present");

  /* A click that lands on the media must NOT close. Two shapes, because the
     video element is the one whose own controls live inside it. */
  const nonClosing = vm.runInContext(`(() => {
    const bag = globalThis.__lb, fire = bag.listeners.find(l => l.type === 'click').fn;
    const el = (cls) => ({ classList: { contains: (name) => name === cls } });
    const before = bag.removed;
    fire({ target: el('lb-image') });
    fire({ target: el('lb-arrow') });
    fire({ target: el('lb-close') });
    return { closed: bag.removed !== before, open: !!globalThis.__lbEl() };
  })()`, rendered.context);
  eq(nonClosing.closed, false, "clicking the media, an arrow or a child control must not close the viewer");
  eq(nonClosing.open, true, "and the viewer is still open after all three");

  /* The backdrop — the root, and the stage padding around the media — must. */
  const rootClose = vm.runInContext(`(() => {
    const bag = globalThis.__lb, fire = bag.listeners.find(l => l.type === 'click').fn;
    fire({ target: globalThis.__lbEl() });
    return { open: !!globalThis.__lbEl(), removed: bag.removed };
  })()`, rendered.context);
  eq(rootClose.open, false, "clicking the dark area around the media closes the viewer");
  eq(rootClose.removed, 1, "and the element is actually torn down, not merely hidden");

  const stageClose = vm.runInContext(`(() => {
    openLBMedia(encodeURIComponent(JSON.stringify([{ name: 'A.png', url: '/a.png' }])), 0, 'T');
    const bag = globalThis.__lb, fire = bag.listeners.filter(l => l.type === 'click').pop().fn;
    fire({ target: { classList: { contains: (name) => name === 'lb-stage' } } });
    return { open: !!globalThis.__lbEl() };
  })()`, rendered.context);
  eq(stageClose.open, false, "the empty stage padding beside the image is backdrop too");

  /* NOTHING WAS TAKEN AWAY. Escape and the explicit close still close. */
  const review = read("public/review.js");
  ok(/if \(e\.key === "Escape"\) return closeLB\(\);/.test(review),
    "Escape still closes the viewer");
  ok(/class="lb-close" onclick="closeLB\(\)"/.test(review),
    "and so does the explicit close control");
}

/* ==========================================================================
   R3 — THE CROP LEADS; THE MACHINERY IS KEPT.
   ========================================================================== */
async function testExtractionProgressiveDisclosure() {
  const rendered = await surface(convergenceFixture());
  const modal = vm.runInContext(`(() => {
    openCoverageSheetExtractor('characters','CHAR-UX','CHAR-UX-SHEET.png', true);
    return document.getElementById('modal').innerHTML;
  })()`, rendered.context);
  ok(modal.includes("REFERENCE EXTRACTION"), "baseline: the extractor opened");

  const advanced = within(modal, '<details class="coverage-crop-advanced">', "</details>");
  ok(advanced, "the extractor must offer a Fine tune disclosure");
  ok(/<summary>Fine tune<\/summary>/.test(advanced), "named for what it is");
  ok(!/<details class="coverage-crop-advanced"[^>]*\bopen\b/.test(modal),
    "and it must start closed, or it is not progressive disclosure");

  /* The normal surface: the target, the crop stage, panel navigation, save. */
  const normal = modal.slice(0, modal.indexOf('<details class="coverage-crop-advanced">'));
  for (const [needle, why] of [
    ['id="coverage-crop-slot"', "which view this crop becomes is the first question"],
    ['id="coverage-crop-stage"', "the draggable crop is the interaction"],
    ["Previous panel", "moving between panels is normal work"],
    ['<div class="coverage-review-gate">', "what each save actually does stays on the surface"],
  ]) ok(normal.includes(needle), `the normal extractor surface must keep: ${why}`);
  ok(normal.includes("Review is optional"),
    "and that explanation is beside the crop rather than behind a fold");
  /* ALPHA R3 — the one-action path is a BUTTON now, so it lives in the action row
     below the fold's closing tag rather than on the panel beside it. */
  ok(!modal.includes('id="coverage-crop-approve"'),
    "the redundant save-and-use checkbox is gone — the control that performs it says so");
  ok(/<button class="approve-btn large" onclick="extractCoverageCrop\(\{ assign: true \}\)">SAVE CROP & USE<\/button>/.test(modal),
    "and Save crop & use is the primary named action");
  ok(/<button class="ghost-btn" onclick="extractCoverageCrop\(\{ assign: false \}\)">SAVE AS CANDIDATE<\/button>/.test(modal),
    "with Save as candidate beside it as a distinct act");

  /* The machinery: present, still addressable, and no longer leading. */
  for (const [id, why] of [
    ["coverage-crop-layout", "sheet layout"],
    ["coverage-crop-panel", "panel position"],
    ["coverage-crop-x", "numeric crop fields"],
    ["coverage-crop-y", "numeric crop fields"],
    ["coverage-crop-w", "numeric crop fields"],
    ["coverage-crop-h", "numeric crop fields"],
    ["coverage-crop-note", "extraction note"],
  ]) {
    ok(advanced.includes(`id="${id}"`), `${why} must move behind Fine tune, not disappear (${id})`);
    ok(!normal.includes(`id="${id}"`), `${why} must not also lead the surface (${id})`);
  }
  ok(advanced.includes("Reset to panel") && advanced.includes("Use full image"),
    "recovery actions move behind Fine tune too");
  ok(advanced.includes("Source sheet") && advanced.includes("CHAR-UX-SHEET.png"),
    "and so does the technical source-sheet statement, which is a fact and not a control");

  /* THE HANDLERS STILL FIND THEIR ELEMENTS. A closed <details> hides its
     contents; it does not withhold them from getElementById. Proven by running
     the shipped handlers, not asserted. */
  const drive = vm.runInContext(`(() => {
    setCoverageCropLayout('2x2');
    const afterLayout = { ...window._coverageCrop.crop, layout: window._coverageCrop.layout };
    stepCoverageCropPanel(1);
    const afterStep = window._coverageCrop.panelIndex;
    setCoverageCropField('w', 40);
    const afterField = window._coverageCrop.crop.w;
    setCoverageCropFull();
    const c = window._coverageCrop.crop;
    /* Serialised in the page's own realm: a vm-built object never satisfies
       deepStrictEqual against a host literal, however identical it prints. */
    const afterFull = JSON.stringify([c.x, c.y, c.w, c.h]);
    return { afterLayout, afterStep, afterField, afterFull };
  })()`, rendered.context);
  eq(drive.afterLayout.layout, "2x2", "the layout control behind the fold still drives the crop");
  eq(drive.afterStep, 1, "panel navigation still moves the panel index");
  eq(drive.afterField, 40, "the numeric crop fields still write the crop");
  eq(drive.afterFull, "[0,0,100,100]",
    "and use-full-image still resets to the whole sheet");

  /* PROVENANCE IS STILL STORED. The writer, not the screen, is what proves it. */
  const automation = read("public/coverage-automation.js");
  ok(/coverageCrop: \{ sourceSheet: state\.fileName, layout: state\.layout, panelIndex: state\.panelIndex, normalized: \{ \.\.\.state\.crop \}/.test(automation),
    "extractCoverageCrop() still records the source sheet, layout, panel and crop on the candidate row");
  ok(/manuallyAdjusted: true, note \}/.test(automation),
    "and still records the extraction note");
}

/* ==========================================================================
   R4 — WHERE AN ACTION PUTS THE FILMMAKER BACK.
   ========================================================================== */
async function testSaveAndAssignReturnToCoverage() {
  const rendered = await surface(convergenceFixture(), COVERAGE_STORAGE);

  /* The hand-off itself: the three shipped selection keys the coverage stage
     reads, written and nothing else. */
  const landed = vm.runInContext(`(() => {
    const keys = () => ({
      task: localStorage.getItem('cinebraid-focused:fixture:entity-task:characters:CHAR-UX'),
      board: localStorage.getItem('cinebraid-bounded:fixture:selected:entity-coverage-view:characters:CHAR-UX'),
      slot: localStorage.getItem('cinebraid-bounded:fixture:selected:coverage-slot:characters:CHAR-UX'),
      expression: localStorage.getItem('cinebraid-bounded:fixture:selected:expression-slot:CHAR-UX'),
    });
    const before = { rev: SAVE_REVISION, project: JSON.stringify(P.characters[0]) };
    returnToCoverageSlot('characters','CHAR-UX','angles','profile');
    const angles = keys();
    returnToCoverageSlot('characters','CHAR-UX','expressions','neutral');
    const expressions = keys();
    return { angles, expressions, rev: SAVE_REVISION, before, project: JSON.stringify(P.characters[0]) };
  })()`, rendered.context);
  eq(landed.angles.task, "coverage", "an extraction returns to the coverage stage");
  eq(landed.angles.board, "coverage", "on the angles board");
  eq(landed.angles.slot, "profile", "with the view it was made for selected");
  eq(landed.expressions.board, "expressions", "an expression crop returns to the expression board");
  eq(landed.expressions.expression, "neutral",
    "keyed on the entity id alone, which is how the expression rail is keyed");
  eq(landed.rev, landed.before.rev, "and the hand-off writes no project revision");
  eq(landed.project, landed.before.project, "nor anything at all on the reference");

  /* AND IT OPENS NO REVIEW. "Map & assign" is an assignment; the review modal
     must not appear on top of the board it just filled. */
  const assigned = vm.runInContext(`(() => {
    openImportedReferenceMapper('characters','CHAR-UX');
    document.getElementById('import-reference-file').value = 'CHAR-UX-LOOSE.png';
    document.getElementById('import-reference-target').value = 'coverage:profile';
    confirmImportedReferenceMapping(true);
    return { modal: document.getElementById('modal').innerHTML,
             slot: localStorage.getItem('cinebraid-bounded:fixture:selected:coverage-slot:characters:CHAR-UX'),
             task: localStorage.getItem('cinebraid-focused:fixture:entity-task:characters:CHAR-UX') };
  })()`, rendered.context);
  ok(!assigned.modal.includes("CANDIDATE REVIEW"),
    "an explicit assignment must not open Candidate Review on the filmmaker's behalf");
  eq(assigned.task, "coverage", "it lands on the coverage stage");
  eq(assigned.slot, "profile", "on the view the assignment named");

  /* The crop path no longer opens it either — read off the writer, because the
     canvas half of extractCoverageCrop() cannot run in this harness. */
  const automation = read("public/coverage-automation.js");
  const extractor = automation.slice(automation.indexOf("window.extractCoverageCrop"),
    automation.indexOf("window.openImportedReferenceMapper"));
  ok(extractor.length > 200, "baseline: the extraction writer was located");
  ok(!extractor.includes("openEntityCandidateReview"),
    "saving a crop must not open Candidate Review — the button said SAVE, not REVIEW");
  ok(extractor.includes("returnToCoverageSlot(state.list, state.entityId, group, slot.id)"),
    "it returns to the view the crop was made for instead");

  /* REVIEW IS NOT REMOVED — it is reachable from the candidate itself, and the
     two mapper buttons that literally say AI CHECK still open it. */
  ok(/MAP FOR OPTIONAL AI CHECK|MAP & AI CHECK/.test(automation),
    "the explicit review route on the mapper still exists");
  ok(automation.includes(`openEntityCandidateReview(current.list, current.entityId, fileName, "state-default", "coverage")`),
    "and asking for an AI check still opens the review it asked for");
  ok(read("public/entities.js").includes("OPTIONAL AI CHECK"),
    "and the candidate card still offers the review on the candidate");
}

/* ==========================================================================
   R5 — NO REVIEW IS NOT A PASS.
   ========================================================================== */
async function testUnreviewedCandidateHasNoPassFactors() {
  const rendered = await surface(convergenceFixture());
  const unreviewed = vm.runInContext(`(() => {
    openEntityCandidateReview('characters','CHAR-UX','CHAR-UX-LOOSE.png','state-default');
    return document.getElementById('modal').innerHTML;
  })()`, rendered.context);
  ok(unreviewed.includes("NOT REVIEWED"), "baseline: the overall result says the candidate was not reviewed");
  const factors = [...unreviewed.matchAll(/<article class="entity-review-factor severity-([a-z]+)">/g)].map((m) => m[1]);
  ok(factors.length >= 4, `baseline: the factor grid renders (${factors.length} factors)`);
  eq(factors.filter((tone) => tone === "pass").length, 0,
    "a candidate with no review must show no PASS factor — no evidence is not evidence");
  eq(factors.every((tone) => tone === "unreviewed"), true,
    "every factor reads as unreviewed instead");
  ok(!/<b>PASS<\/b>/.test(unreviewed),
    "and the word PASS appears on no factor row");
  ok(unreviewed.includes("Run the AI review to check this factor"),
    "each factor says how to get an answer rather than implying it already has one");
  /* REFERENCE CREATION REVIEW V1 / R15 — THE REVIEW SURFACE TELLS THE TRUTH ABOUT
     WHETHER BRAIDY CAN LOOK AT THIS, in both configurations.
     This asserted the literal string RUN AI REVIEW. The control is Braidy's now and
     it is stated where a filmmaker reads it — above the empty result rather than in
     the footer under it — and, crucially, it is withdrawn and explained rather than
     rendered disabled when no vision model is configured, which is the real Rex
     configuration the dogfood ran in. */
  ok(unreviewed.includes("Review with Braidy"),
    "with vision configured, asking Braidy to review is one press away");
  ok(!unreviewed.includes("Braidy visual review unavailable"),
    "and no unavailable sentence is shown while it would be untrue");
  const visionOff = vm.runInContext(`(() => {
    const before = typeof AGENT_STATUS === "undefined" ? null : AGENT_STATUS;
    AGENT_STATUS = { capabilities: { vision: { ready: false, standing: "off", message: "No vision model is configured.", action: "Open Settings to configure Vision." } } };
    openEntityCandidateReview('characters','CHAR-UX','CHAR-UX-LOOSE.png','state-default');
    const html = document.getElementById('modal').innerHTML;
    AGENT_STATUS = before;
    return html;
  })()`, rendered.context);
  ok(visionOff.includes("Braidy visual review unavailable"),
    "with Vision off the modal says so plainly rather than offering a dead control");
  ok(visionOff.includes("Configure Vision"),
    "and the one action that would make a review possible is offered");
  ok(!visionOff.includes("Review with Braidy"),
    "and no review action is offered that could not run");

  /* WITH A REAL RESULT, the severities the reviewer returned are printed — the
     gate is the evidence, not a blanket refusal to say PASS. */
  const reviewed = vm.runInContext(`(() => {
    const e = P.characters.find(x => x.id === 'CHAR-UX');
    const row = (e.candidateFiles || []).find(r => (r.stored || r.original) === 'CHAR-UX-LOOSE.png');
    /* Shaped exactly as the shipped contract shapes one — the currency check
       keys on contractVersion, and the factor keys are the contract's own. */
    row.structuredReviews = { 'state-default': { pass: true, score: 91, summary: 'Consistent.',
      contractVersion: ENTITY_REFERENCE_REVIEW_CONTRACT_VERSION,
      reviewedAt: new Date().toISOString(), stateName: 'Default',
      categories: { design: { severity: 'pass', note: 'Same face.' }, cleanliness: { severity: 'minor', note: 'Soft edge.' } } } };
    openEntityCandidateReview('characters','CHAR-UX','CHAR-UX-LOOSE.png','state-default');
    return document.getElementById('modal').innerHTML;
  })()`, rendered.context);
  const reviewedFactors = [...reviewed.matchAll(/<article class="entity-review-factor severity-([a-z]+)">/g)].map((m) => m[1]);
  ok(reviewedFactors.includes("pass"), "a factor the reviewer passed prints PASS");
  ok(reviewedFactors.includes("minor"), "a factor the reviewer flagged prints its severity");
  ok(reviewedFactors.includes("unreviewed"),
    "and a factor this review did not return still says so rather than borrowing the pass");
  ok(reviewed.includes("This review returned no result for this factor"),
    "naming the absence as an absence");

  /* A HUMAN DECISION STILL FABRICATES NO AI STATE. */
  const afterHumanChoice = vm.runInContext(`(() => {
    const e = P.characters.find(x => x.id === 'CHAR-UX');
    const row = (e.candidateFiles || []).find(r => (r.stored || r.original) === 'CHAR-UX-FRONT.png');
    return { decision: row.decision, review: !!row.structuredReviews };
  })()`, rendered.context);
  eq(afterHumanChoice.decision, "selected-coverage", "baseline: this candidate was chosen by a person");
  eq(afterHumanChoice.review, false, "and carries no AI review record");
  const chosen = vm.runInContext(`(() => {
    openEntityCandidateReview('characters','CHAR-UX','CHAR-UX-FRONT.png','state-default');
    return document.getElementById('modal').innerHTML;
  })()`, rendered.context);
  eq([...chosen.matchAll(/<article class="entity-review-factor severity-([a-z]+)">/g)]
    .filter((m) => m[1] === "pass").length, 0,
    "being selected by a person does not turn six factors green");
}

/* ==========================================================================
   R6 / R11 — THE SUMMARY THAT REPLACES A SECOND BOARD.
   ========================================================================== */
async function testProductionNeedsIsSummarised() {
  const rendered = await surface(convergenceFixture(), COVERAGE_STORAGE);
  const html = rendered.html;

  const summary = within(html, '<div class="entity-demand-summary', "</div></div>");
  ok(summary, "the production-needs panel must lead with a compact summary");
  /* Derived, not pinned: project normalisation seeds template slots beside the
     fixture's own, so the invariant is that the strip prints the OWNER'S answer
     — the same slots the list below is built from — not a magic number. */
  const owner = vm.runInContext(`(() => {
    const e = P.characters.find(x => x.id === 'CHAR-UX');
    const live = (rows) => (rows || []).filter(s => s && !s.retired);
    const cov = live(ensureCoverageSlots('characters', e)), exp = live(ensureExpressionSlots(e));
    const held = (rows) => rows.filter(s => slotSelectedFile(s)).length;
    return { views: held(cov) + '/' + cov.length, expressions: held(exp) + '/' + exp.length };
  })()`, rendered.context);
  ok(/^\d+\/[1-9]/.test(owner.views) && /^\d+\/[1-9]/.test(owner.expressions),
    `baseline: the fixture carries both families (${owner.views}, ${owner.expressions})`);
  ok(html.includes(`Views ${owner.views}`),
    `the strip counts the views the coverage owner counts (${owner.views})`);
  ok(html.includes(`Expressions ${owner.expressions}`),
    `and the expressions the expression owner counts (${owner.expressions})`);
  ok(/data-demand-summary-now="0"/.test(html),
    "and publishes how much is actually owed right now");
  ok(/NEEDED NOW<\/span><b>None<\/b>/.test(html),
    "a dormant reference reads Needed now: None rather than a backlog");
  ok(html.includes("Open coverage"),
    "with one route to the ONE editable slot workspace");

  /* THE DUPLICATION IS GONE. Every view and expression in the lead is compact. */
  const lead = within(html, '<div class="entity-demand-rows entity-demand-open">', "</div><details");
  ok(lead, "baseline: the leading list renders");
  const leadRows = [...lead.matchAll(/<article class="entity-demand-row([^"]*)"[^>]*data-demand-family="([a-z]+)"[^>]*data-demand-id="([^"]+)"/g)];
  ok(leadRows.length > 0, `baseline: the lead carries rows (${leadRows.length})`);
  const bulky = leadRows.filter(([, cls, family]) => /coverage|expression/.test(family) && !/is-compact/.test(cls));
  assert.deepStrictEqual(bulky.map((m) => m[3]), [],
    `a view or expression nobody is waiting on must not take a full-width row: ${bulky.map((m) => m[3]).join(", ")}`);
  checks++;

  /* AND NOTHING IS HIDDEN. Slice 5's rule: the material leads, un-collapsed,
     with its action reachable. Compacting a row must not delete it. */
  const ids = leadRows.map((m) => m[3]);
  for (const id of ["profile", "neutral"]) {
    ok(ids.includes(id), `${id} is required and unsatisfied, so it must still be listed`);
  }
  ok(/data-demand-id="profile"[\s\S]{0,400}?Open this view/.test(lead),
    "and a compact row keeps its contextual action");
  ok(!/<details[^>]*>[\s\S]*<div class="entity-demand-rows entity-demand-open">/
    .test(html.slice(html.indexOf('class="entity-demand"'))),
    "the leading list is still not behind a disclosure");

  /* A CONTINUITY STATE IS NEVER COMPACTED, because its action lives nowhere
     else — the exact control a previous attempt made unclickable. */
  const withState = await surface(convergenceFixture({ states: 2 }), COVERAGE_STORAGE);
  const stateRow = /<article class="entity-demand-row([^"]*)"[^>]*data-demand-family="state"[^>]*data-demand-id="state-soaked"/.exec(withState.html);
  ok(stateRow, "baseline: the continuity state has a row");
  ok(!/is-compact/.test(stateRow[1]), "a continuity state row keeps its full size");
  ok(/openContinuityStateVariant\('characters','CHAR-UX','state-soaked'\)/.test(withState.html),
    "and its generate-from-parent action is on the surface and clickable");

  /* WHEN SOMETHING IS ACTUALLY OWED it leads at full size, and says who.
     A shot uses this character and its primary has never been approved, which
     is the readiness obligation the panel carries as its own row. */
  const cast = await surface(convergenceFixture({ cast: true, primaryApproved: false }), COVERAGE_STORAGE);
  const owed = Number((/data-demand-summary-now="(\d+)"/.exec(cast.html) || [])[1] || 0);
  ok(owed >= 1, `baseline: a reference a shot uses with no approved primary owes something (${owed})`);
  ok(/NEEDED NOW<\/span><b>\d+ required reference/.test(cast.html),
    "the summary counts real blockers when there are some");
  ok(/class="entity-demand-summary has-blockers"/.test(cast.html),
    "and says so on the strip itself");
  const castLead = within(cast.html, '<div class="entity-demand-rows entity-demand-open">', "</div><details");
  ok(!/is-compact/.test(castLead),
    "a real blocker is never compacted — only actual required-now work leads, and it leads at full size");
  ok(/data-demand-family="primary"/.test(castLead),
    "and the obligation the production is waiting on is the row that leads");
  ok(/required by Shot /.test(cast.html),
    "which names the shot that is waiting, from the shot list readiness already carries");
}

/* ==========================================================================
   R7 — TWO AXES, NAMED.
   ========================================================================== */
async function testRequirementAndDemandCannotContradict() {
  const rendered = await surface(convergenceFixture(), COVERAGE_STORAGE);
  const html = rendered.html;

  /* The two answers a filmmaker saw side by side, both still exactly as they
     were: the panel says nothing is required now, the slot says Required. */
  ok(/No shot uses this character yet, so nothing is required now/.test(html),
    "baseline: the demand answer is unchanged");
  /* CORRECTION 1 — the STRUCTURAL answer is unchanged and still what the plan
     control offers and what automation reads; what the chip prints is the
     EFFECTIVE one, and on a dormant reference that is Planned. */
  const structural = vm.runInContext(`(() => {
    const e = P.characters.find(x => x.id === 'CHAR-UX');
    return ensureCoverageSlots('characters', e).filter(s => coverageRequirement(s) === 'required').length;
  })()`, rendered.context);
  ok(structural >= 2, `baseline: the plan still declares ${structural} required views`);
  ok(html.includes('data-slot-state="planned"'),
    "and with nothing waiting on them the board displays them as Planned");
  ok(!html.includes('data-slot-state="required-missing"'),
    "and never as required-missing, which would be a fifth state in all but name");

  /* What is new is the sentence that says which is which, on the board. */
  const intro = within(html, '<div class="entity-coverage-intro">', "</div></div>");
  ok(/this project&#39;s coverage plan for the reference, not a claim that a shot is waiting for it/.test(intro)
    || /this project's coverage plan for the reference, not a claim that a shot is waiting for it/.test(intro),
    "the coverage board must say that its Required is a plan, not a current blocker");
  ok(/No shot uses this character yet, so nothing here is required right now/.test(intro),
    "and when demand is dormant it repeats the panel's own answer rather than contradicting it");

  /* ONE OWNER PER STAGE, HANDED DOWN — so the two halves cannot drift apart.
     Scoped to the coverage stage's own body: other surfaces resolve demand for
     their own questions and always have, and counting those would be asserting
     something this slice did not change. */
  const entities = read("public/entities.js");
  const stage = entities.slice(
    entities.indexOf("function entityCoverageStatesMarkup("),
    entities.indexOf("function entityDetailsHistoryMarkup("));
  ok(stage.length > 200, "baseline: the coverage stage renderer was located");
  /* ALPHA R7 — ONE RESOLUTION, HANDED DOWN. CORRECTION 2 — and one CONSTRUCTOR for
     it, because the coverage automation dialog needs the same pair and a second
     inline copy in another file is how two surfaces come to disagree. */
  eq((stage.match(/entityDemandContext\(/g) || []).length, 1,
    "the coverage stage resolves the demand context exactly once");
  eq((stage.match(/entityReferenceDemandFor\(|entityCurrentObligations\(/g) || []).length, 0,
    "and never assembles it inline beside the constructor");
  const owner = entities.slice(entities.indexOf("function entityDemandContext("),
    entities.indexOf("function obligationStateIds("));
  ok(/entityReferenceDemandFor\(list, entity\)/.test(owner) && /entityCurrentObligations\(list, entity, production\)/.test(owner),
    "and the constructor reads the two shipped owners and nothing else");
  ok(/coverageBoardMarkup\(list,entity,mediaByName,media,demand\)/.test(stage),
    "and hands it to the angles board rather than letting it resolve its own");
  ok(/expressionBoardMarkup\(entity,mediaByName,media,demand\)/.test(stage),
    "and to the expression board");
  ok(/entityDemandMarkup\(list, entity, production \|\| undefined, obligations \|\| undefined\)/.test(stage),
    "and to the panel that publishes the headline");

  /* A REFERENCE A SHOT USES gets the other half of the sentence. */
  const cast = await surface(convergenceFixture({ cast: true }), COVERAGE_STORAGE);
  const castIntro = within(cast.html, '<div class="entity-coverage-intro">', "</div></div>");
  ok(/What the production is actually waiting on is listed under Production needs/.test(castIntro),
    "a reference in use is pointed at the panel that answers the demand question");
  ok(!/No shot uses this character yet/.test(castIntro),
    "and is never told nothing uses it");
}

/* ==========================================================================
   R8 / R9 — STAGING THE FILMMAKER CAN SEE.
   ========================================================================== */
async function testStagedSelectionPreviewsWithoutWriting() {
  const rendered = await surface(convergenceFixture(), COVERAGE_STORAGE);
  const html = rendered.html;

  /* The element the renderer must emit for the handler to find. */
  ok(html.includes('id="coverage-slot-preview"'), "the slot preview must be addressable");
  ok(html.includes('data-slot-preview="committed"'),
    "and must start by declaring that what it shows is the committed image");
  ok(/data-slot-list="characters" data-slot-entity="CHAR-UX"/.test(html),
    "and the file selector must state its own scope so the handler can resolve the media");
  ok(html.includes("PREVIEWING"), "with a label for the state that used to have no word");

  const staged = vm.runInContext(`(() => {
    const select = document.getElementById('coverage-slot-file');
    const preview = document.getElementById('coverage-slot-preview');
    const button = document.getElementById('coverage-slot-use');
    /* The values the markup above declares, as a parsed DOM would carry them. */
    select.dataset.committed = '';
    select.dataset.slotList = 'characters';
    select.dataset.slotEntity = 'CHAR-UX';
    const before = { rev: SAVE_REVISION, slot: slotSelectedFile(ensureCoverageSlots('characters', P.characters.find(x=>x.id==='CHAR-UX'))[1]) };
    select.value = 'CHAR-UX-LOOSE.png';
    stageSlotSelection('coverage-slot-file','coverage-slot-use');
    return { before, mode: preview.dataset.slotPreview, html: preview.innerHTML,
             label: button.textContent, enabled: !button.disabled,
             rev: SAVE_REVISION,
             slot: slotSelectedFile(ensureCoverageSlots('characters', P.characters.find(x=>x.id==='CHAR-UX'))[1]) };
  })()`, rendered.context);
  eq(staged.mode, "staged", "choosing a different file puts the preview into its staged state");
  ok(staged.html.includes("/assets/anchors/CHAR-UX-LOOSE.png"),
    "and the chosen image appears immediately, instead of the area staying blank");
  eq(staged.label, "USE THIS IMAGE", "the commit control still names the act it performs");
  eq(staged.enabled, true, "and is available");
  eq(staged.rev, staged.before.rev, "PREVIEWING WRITES NOTHING: no project revision");
  eq(staged.slot, staged.before.slot, "and the slot still holds exactly what it held");

  /* Returning to the committed value returns to the committed picture. */
  const reverted = vm.runInContext(`(() => {
    const select = document.getElementById('coverage-slot-file');
    const preview = document.getElementById('coverage-slot-preview');
    select.value = '';
    stageSlotSelection('coverage-slot-file','coverage-slot-use');
    return { mode: preview.dataset.slotPreview, label: document.getElementById('coverage-slot-use').textContent };
  })()`, rendered.context);
  eq(reverted.mode, "committed", "changing the selection back leaves the slot's own image showing");
  eq(reverted.label, "SELECT AN IMAGE", "and the commit control returns to its resting label");

  /* A name that resolves to nothing previews nothing rather than a broken path. */
  const missing = vm.runInContext(`(() => {
    const select = document.getElementById('coverage-slot-file');
    const preview = document.getElementById('coverage-slot-preview');
    select.value = 'NOT-A-REAL-FILE.png';
    stageSlotSelection('coverage-slot-file','coverage-slot-use');
    return { html: preview.innerHTML, mode: preview.dataset.slotPreview };
  })()`, rendered.context);
  ok(!/<img|<video/.test(missing.html),
    "an unresolvable name must not be turned into an image source");
  ok(missing.html.includes("not available to preview"), "it says so instead");
}

/* ==========================================================================
   R10 — THE VISUAL CHOOSER IS THE WAY IN.
   ========================================================================== */
async function testVisualChooserLeadsAndStages() {
  const rendered = await surface(convergenceFixture(), COVERAGE_STORAGE);
  const html = rendered.html;

  const commitRow = within(html, '<div class="slot-commit-row">', "</div>");
  ok(/class="approve-btn" onclick="openReferenceMediaChooser/.test(commitRow),
    "Browse visually is a primary control on the commit row");
  ok(!/class="ghost-btn" onclick="openReferenceMediaChooser/.test(html),
    "and is no longer the quieter of the two");
  ok(html.includes('<details class="coverage-slot-filename"><summary>Choose by filename</summary>'),
    "the filename list becomes the compact fallback");
  ok(!/<details class="coverage-slot-filename"[^>]*\bopen\b/.test(html),
    "closed by default");
  const filenameFold = within(html, '<details class="coverage-slot-filename">', "</details>");
  ok(filenameFold.includes('id="coverage-slot-file"'),
    "with the same select, unchanged, inside it");
  ok(filenameFold.includes(`onchange="stageSlotSelection('coverage-slot-file','coverage-slot-use')"`),
    "and the same non-committing handler on it");

  /* Choosing a card stages AND previews, writing nothing — the chooser reaches
     the same two controls the dropdown reaches. */
  const picked = vm.runInContext(`(() => {
    const select = document.getElementById('coverage-slot-file');
    const preview = document.getElementById('coverage-slot-preview');
    select.dataset.committed = '';
    select.dataset.slotList = 'characters';
    select.dataset.slotEntity = 'CHAR-UX';
    const before = SAVE_REVISION;
    pickReferenceMediaForSlot('coverage-slot-file','coverage-slot-use','CHAR-UX-LOOSE.png');
    return { staged: select.value, mode: preview.dataset.slotPreview, html: preview.innerHTML,
             label: document.getElementById('coverage-slot-use').textContent,
             wrote: SAVE_REVISION !== before };
  })()`, rendered.context);
  eq(picked.staged, "CHAR-UX-LOOSE.png", "picking a card stages the choice into the same selector");
  eq(picked.mode, "staged", "and previews it");
  ok(picked.html.includes("CHAR-UX-LOOSE.png"), "showing the picture that was chosen");
  eq(picked.label, "USE THIS IMAGE", "with the explicit commit still to come");
  eq(picked.wrote, false, "and nothing written by the choice itself");

  /* Still one projection, still one media index. */
  const entities = read("public/entities.js");
  ok(/window\.CineBraidMediaInspector\?\.projection\?\.\(\)/.test(entities),
    "the chooser still reads the one production-media projection");
  ok(/results\.orderRecords\(results\.tabRecords\(mine, "current"\), true\)/.test(entities),
    "and still orders through the shipped results owner");
}

/* ==========================================================================
   R21 — THE PRIMARY VERB OF THE SECTION.
   ========================================================================== */
async function testContinuityStateAddIsObvious() {
  const storage = {
    "cinebraid-focused:fixture:entity-task:characters:CHAR-UX": "coverage",
    "cinebraid-bounded:fixture:selected:entity-coverage-view:characters:CHAR-UX": "states",
  };
  const rendered = await surface(convergenceFixture(), storage);
  const html = rendered.html;

  const lead = within(html, '<div class="continuity-states-lead">', "</div>\n") || within(html, '<div class="continuity-states-lead">', "<nav");
  ok(lead.includes("+ Add continuity state"),
    "the add action sits beside the section heading");
  ok(/addContinuityState\('characters','CHAR-UX'\)/.test(lead),
    "wired to the same writer it was wired to before");
  ok(html.indexOf('<div class="continuity-states-lead">') < html.indexOf('<nav class="continuity-state-rail"'),
    "and above the state list rather than below it");
  ok(html.indexOf("+ Add continuity state") < html.indexOf('<details class="state-chain-tools">'),
    "no longer buried inside the tools disclosure");

  /* One Default state is presented as one state, not as an administration form. */
  ok(/<b>Default only<\/b>/.test(html), "a reference with one state says so plainly");
  ok(/glasses on, wet, damaged, older/.test(html),
    "and the section says what a continuity state is for, in story words");

  /* THE POWER IS KEPT, DEMOTED. */
  ok(html.includes('<details class="state-chain-tools"><summary><span>Advanced state tools</span>'),
    "parent-first automation moves to an Advanced disclosure");
  ok(html.includes("Continuity-state chain"), "and is still there");
  ok(!/<details class="state-chain-tools"[^>]*\bopen\b/.test(html), "closed by default");
  /* Tracking keeps its own visible fold — a real-browser suite clicks it open. */
  ok(html.includes('class="fold continuity-tracking"'),
    "continuity tracking stays a visible disclosure of its own");
  ok(html.indexOf('class="fold continuity-tracking"') > html.indexOf('<nav class="continuity-state-rail"'),
    "below the states it configures rather than in front of them");
}

/* ==========================================================================
   SINGLE-STATE APPROVAL — ONE ACT, NOT FOUR CONTROLS.
   ========================================================================== */
async function testSingleStateApprovalIsOneAct() {
  const one = await surface(convergenceFixture());
  const single = vm.runInContext(`(() => {
    approveEntityFile('characters','CHAR-UX','CHAR-UX-LOOSE.png','state-default');
    return document.getElementById('modal').innerHTML;
  })()`, one.context);
  ok(single.includes("Approve reference"), "baseline: the approval modal opened");
  ok(!/<select id="entity-approve-target"/.test(single),
    "with exactly one state there is no single-option state dropdown");
  ok(single.includes('data-single-state="1"') && single.includes("<b>Default</b>"),
    "the state is stated instead");
  ok(!single.includes("entity-approval-continuation"),
    "and no continuation field for a version that does not exist");
  ok(!single.includes("APPROVE & EDIT NEXT STATE"),
    "nor a next-state action");
  ok(!single.includes("APPROVE ONLY"),
    "and the primary action is not qualified against an alternative there is none of");
  ok(/class="approve-btn large"(?: disabled)? onclick="confirmEntityApproval\(false\)">APPROVE</.test(single),
    "one clear primary approval action");
  ok(single.includes("Request changes"), "with Request changes still available");

  /* THE COMMAND IS THE SAME COMMAND. The writer reads `#entity-approve-target`;
     the element is still there under that id, carrying the same value the select
     carried — asserted on the emitted markup, because this harness's DOM does not
     parse attributes out of it. */
  ok(/<input id="entity-approve-target" type="hidden" value="state-default">/.test(single),
    "the id the writer reads still exists, carrying the state id the select used to carry");
  const tools = read("public/library-tools.js");
  ok(/targetStateId = document\.getElementById\("entity-approve-target"\)\?\.value \|\| "state-default"/.test(tools),
    "and confirmEntityApproval() still reads exactly that id — one writer, both shapes");
  vm.runInContext(`(() => {
    document.getElementById('entity-approve-file').value = 'CHAR-UX-LOOSE.png';
    document.getElementById('entity-approve-name').value = 'CHAR-UX-LOOSE.png';
  })()`, one.context);
  /* The Alpha imported-reference slice made confirmation wait for a prepared
     durable identity for the exact candidate on screen, so a suite standing in
     for a filmmaker waits for it too. Preparation is a request; this drains the
     loop until the modal holds one, never for a duration. */
  await settleApprovalReadiness(one);
  await one.gesture.act(() => one.context.confirmEntityApproval(false));
  await new Promise((resolve) => setTimeout(resolve, 80));
  const truth = vm.runInContext(
    `(() => { const t = entityProductionTruth(P,'characters','CHAR-UX'); return t.canon.map(c => c.value); })()`,
    one.context);
  assert.deepStrictEqual(Array.from(truth), ["CHAR-UX-LOOSE.png"],
    "and the approval lands through the same authority boundary, leaving the same receipt");
  checks++;

  /* TWO STATES: everything comes back, unchanged. */
  const two = await surface(convergenceFixture({ states: 2 }));
  const multi = vm.runInContext(`(() => {
    approveEntityFile('characters','CHAR-UX','CHAR-UX-LOOSE.png','state-default');
    return document.getElementById('modal').innerHTML;
  })()`, two.context);
  ok(/<select id="entity-approve-target"/.test(multi), "two states restore the state selector");
  ok(multi.includes("entity-approval-continuation"), "and the continuation field");
  ok(multi.includes("APPROVE & EDIT NEXT STATE") && multi.includes("APPROVE ONLY"),
    "and both approval actions");
  ok(multi.includes("Soaked"), "with the second state offered by name");
}

/* ==========================================================================
   R22 — THE NATIVE DROPDOWN IN A DARK THEME.
   ========================================================================== */
function testStatusDropdownIsReadable() {
  const css = read("public/styles.css");
  ok(/select\{color-scheme:dark\}/.test(css),
    "the app must tell the browser to render native popups in its own theme");
  const optionRule = /select option,select optgroup\{color:var\(--ink\);background:var\(--panel\)\}/.exec(css);
  ok(optionRule, "and give every option an explicit readable foreground and background");
  ok(/select option:checked\{background:var\(--panel-2\);color:var\(--ink\)\}/.test(css),
    "with the selected row visibly distinct");
  ok(/select option:disabled\{color:var\(--faint\)\}/.test(css),
    "and an unavailable one visibly unavailable");
  ok(/select:hover\{border-color:var\(--line-2\)\}/.test(css), "hover is visible");
  ok(/input:focus,textarea:focus,select:focus\{outline:none;border-color:var\(--acc\)/.test(css),
    "and focus already was");

  /* THE STATUS HUE IS NO LONGER THE ONLY FOREGROUND. `.workflow-select` still
     wears its status colour on the closed control, which has a known background;
     the option rule above out-specifies inheritance inside the popup. */
  ok(/\.wf-approved\{color:var\(--green\)/.test(css),
    "the closed control keeps its status colour");
  ok(css.indexOf("select option,select optgroup{") > css.indexOf(".wf-approved{"),
    "and the explicit option colours come after it in the cascade");

  /* THE LIFECYCLE IS UNTOUCHED. */
  const app = read("public/app.js");
  const states = /const WORKFLOW_STATES\s*=\s*\[([^\]]*)\]/.exec(app);
  ok(states, "the lifecycle vocabulary is declared in one place");
  assert.deepStrictEqual(
    states[1].split(",").map((value) => value.trim().replace(/^["']|["']$/g, "")).filter(Boolean),
    ["DRAFT", "IN PROGRESS", "READY FOR REVIEW", "CHANGES REQUESTED", "APPROVED"],
    "and this slice changed none of its values");
  checks++;
}

/* ==========================================================================
   R23 — DETAILS LEADS WITH NOTES.
   ========================================================================== */
async function testDetailsIsNotADataDump() {
  const rendered = await surface(convergenceFixture(), DETAILS_STORAGE);
  const html = rendered.html;

  /* The normal surface. */
  ok(html.includes("Production notes"),
    "baseline: the Details stage rendered");
  ok(html.includes("Drift notes") && html.includes("Blocking label"),
    "the notes a filmmaker actually edits still lead");
  ok(!html.includes("Identity block (LOCKED"),
    "the internal shout is gone from the field label");
  ok(html.includes("Paste this verbatim into a prompt"),
    "and the rule it was carrying is stated as a sentence instead");

  /* Voice: present, its own section, collapsed, and it says what it holds. */
  ok(html.includes('<details class="entity-details-advanced entity-voice-section">'),
    "voice becomes its own compact section");
  ok(!/<details class="entity-details-advanced entity-voice-section"[^>]*\bopen\b/.test(html),
    "collapsed when the filmmaker has not asked for it");
  ok(/<summary>Voice · none linked<\/summary>/.test(html),
    "with the shipped voice outcome on the summary, so an unused voice is visible without opening it");
  const voiceFold = within(html, '<details class="entity-details-advanced entity-voice-section">', "</details>");
  ok(voiceFold.includes("ElevenLabs Voice Design prompt") && voiceFold.includes("Voice notes"),
    "and every voice field still inside it — moved, not removed");
  /* Scoped to the character DETAIL page's own extra() renderer. The Characters
     library grid is a different surface and is not in this finding's scope. */
  const views = read("public/views.js");
  const detail = views.slice(views.indexOf("  character(id) {"), views.indexOf("  location(id) {"));
  ok(detail.length > 200, "baseline: the character detail renderer was located");
  ok(!detail.includes("voicePanel("),
    "and voice is no longer inlined into the character's normal details");
  ok(detail.includes("Identity block") && detail.includes("Drift notes"),
    "which still renders the notes it should lead with");

  /* Advanced reference metadata. */
  ok(html.includes("<summary>Advanced reference metadata</summary>"),
    "reconciliation and the prompt library move behind Advanced");
  const advanced = within(html, "<summary>Advanced reference metadata</summary>", "</details></section>");
  ok(advanced.includes("Same object as"), "the canonical id is reachable");
  ok(!html.includes("Same object as (canonical id"),
    "without its schema-voiced label");
  ok(advanced.includes("Use these when one physical thing appears in the project more than once"),
    "explained in a sentence beneath the fields");
  ok(advanced.includes("Role (if variant)"), "and the variant role with it");

  /* The reference pack moved to the stage that owns supporting media. */
  ok(!html.includes("Character reference pack"),
    "the reference pack is no longer part of Details");
  const coverage = await surface(convergenceFixture(), COVERAGE_STORAGE);
  ok(coverage.html.includes("<summary>Supporting reference pack</summary>"),
    "it lives with coverage now");
  ok(coverage.html.includes("Character reference pack"),
    "with the same panel and the same links");
  ok(!/<details class="entity-details-advanced entity-reference-pack"[^>]*\bopen\b/.test(coverage.html),
    "collapsed, because it supports the question rather than being it");

  /* History is history. */
  const history = await surface(convergenceFixture(), {
    "cinebraid-focused:fixture:entity-task:characters:CHAR-UX": "details",
    "cinebraid-bounded:fixture:selected:entity-detail-view:characters:CHAR-UX": "history",
  });
  ok(history.html.includes("Generation records — provenance"),
    "History keeps the record of what was generated");
  ok(!history.html.includes("Saved Phase 1 prompts") && !history.html.includes("No saved Phase 1 prompts"),
    "and no longer files an editable prompt library under it");
  ok(html.includes("No saved Phase 1 prompts"),
    "the prompt library is still reachable, under Advanced on Details");
}

/* ==========================================================================
   ALPHA BLOCKERS — the half of R3/R5/R7/R8 the fresh-user pass found still open
   after the convergence slice landed.

     A1  a coverage gap the production is not waiting on claims no attention
     A2  and the fail-closed direction still does, so the gate is a gate
     A3  Save crop & use is one press, and it converges into the view it named
     A4  Save as candidate is the same press minus the assignment, and only that
     A5  neither opens a review nobody asked for
     A6  a candidate the view already holds is offered no assignment
     A7  the compact strip and the board underneath agree about what is owed
   ========================================================================== */

/* The extraction writer's only two edges the harness cannot supply: a canvas
   that can rasterise, and an <img> that reports its natural size. Everything
   between them — the crop maths, the upload call, the candidate row, the
   provenance, the scan refresh, the hand-off and the assignment — is the shipped
   code, running. */
function extractorHarness(project, storage) {
  const uploaded = [];
  const scanWith = (extra) => {
    const base = convergenceScan();
    return { ...base, anchors: [...base.anchors, ...extra.map((name) => ({ name, url: `/assets/anchors/${name}` }))] };
  };
  return {
    uploaded,
    render: () => render("#/character/CHAR-UX", project, {
      scan: convergenceScan(),
      storage,
      fetch: async (url, options, respond) => {
        const target = String(url || "");
        if (target.startsWith("/api/media/upload")) {
          const name = decodeURIComponent((/name=([^&]+)/.exec(target) || [])[1] || "");
          uploaded.push(name);
          return respond({ name });
        }
        if (target === "/api/scan") return respond(scanWith(uploaded));
        return null;
      },
    }),
  };
}

const EXTRACTOR_CANVAS = `
  const realCreate = document.createElement.bind(document);
  document.createElement = (tag) => String(tag).toLowerCase() === "canvas"
    ? { width: 0, height: 0, getContext: () => ({ drawImage() {} }), toBlob: (done) => done({ size: 12, type: "image/png" }) }
    : realCreate(tag);`;
/* Applied AFTER the modal opens, because the element only exists then. */
const EXTRACTOR_SOURCE_SIZE = `
  const source = document.getElementById('coverage-crop-source');
  source.naturalWidth = 1200; source.naturalHeight = 400;`;

async function testDormantCoverageClaimsNoAttention() {
  const rendered = await surface(convergenceFixture(), COVERAGE_STORAGE);
  const html = rendered.html;

  /* THE OBSERVED CONTRADICTION. The panel says nothing is required now; the board
     twenty inches below it printed four amber "Required — missing" chips for views
     coverageTemplateForList() seeded and nobody authored. */
  ok(/No shot uses this character yet, so nothing is required now/.test(html),
    "baseline: the panel's demand answer is unchanged");
  eq((/data-demand-summary-now="(\d+)"/.exec(html) || [])[1], "0",
    "baseline: and it counts nothing as owed");

  const rail = within(html, '<nav class="bounded-slot-rail"', "</nav>");
  ok(rail, "baseline: the coverage rail rendered");
  eq((rail.match(/tone-attention/g) || []).length, 0,
    "no coverage chip may claim attention while the production is waiting on none of it");
  /* THE WORD ITSELF. A chip that says Required beside a panel that says nothing is
     required is the contradiction, however the tone is painted. */
  ok(!/Required/.test(rail), `no chip may use the word Required here, got ${rail.match(/<small>[^<]*<\/small>/g)}`);
  ok(/data-slot-state="planned"/.test(rail),
    "the effective state is Planned — real material, listed and reachable, that nothing is owed on");
  ok(!/data-slot-state="required-missing"/.test(rail),
    "and required-missing appears nowhere, so there is no fifth state");
  const chipStates = new Set([...rail.matchAll(/data-slot-state="([a-z-]+)"/g)].map((m) => m[1]));
  for (const state of chipStates) ok(["satisfied", "required-missing", "planned", "optional"].includes(state),
    `every chip state must be one of the four display states, got ${state}`);

  const card = /<article class="coverage-slot-card focused-slot-selected ([^"]*)"/.exec(html);
  ok(card, "baseline: the slot card rendered");
  ok(!/needs-attention/.test(card[1]),
    "the card's own amber border follows the same answer rather than re-reading the requirement");
  const header = /<article class="coverage-slot-card[\s\S]*?<span>([^<]*)<\/span>/.exec(html);
  ok(header && !/REQUIRED/.test(header[1]),
    `the card header must not call the view required either, got ${header && header[1]}`);
  /* AND THE CONTROL THAT AUTHORS THE PLAN STILL OFFERS THE PLAN'S OWN ANSWER, so
     the filmmaker can still see and change what the project declares. */
  const select = within(html, '<select class="status-select reference-requirement-select"', "</select>");
  ok(/value="required" selected/.test(select),
    "the Project need control still shows the structural requirement it writes");

  const board = /<details class="fold compact-entity-section entity-coverage-section[^>]*data-board-outstanding="(\d+)" data-board-demand="([a-z]+)"/.exec(html);
  ok(board, "the board publishes what it is actually owed");
  eq(board[1], "0", "which is nothing");
  eq(board[2], "dormant", "because the production is not using this reference yet");
  ok(/Coverage board <span>[^<]*none needed now/.test(html),
    "so its fold summary says nothing is needed now");
  const fold = /Coverage board <span>([^<]*)<\/span>/.exec(html);
  ok(fold && !/required/i.test(fold[1]),
    `and never uses the word required while nothing is, got ${fold && fold[1]}`);
  /* Derived, not pinned: the fold prints the SAME answers the chips print, so the
     progress fraction is the effective one and nothing can drift between them. */
  const progress = vm.runInContext(`(() => {
    const e = P.characters.find(x => x.id === 'CHAR-UX');
    const slots = ensureCoverageSlots('characters', e).filter(s => !s.retired);
    const held = slots.filter(s => slotSelectedFile(s)).length;
    return held + '/' + slots.length;
  })()`, rendered.context);
  ok(html.includes(`Coverage board <span>${progress} selected`),
    `the fold prints the effective progress (${progress} selected), so nothing is hidden`);
}

async function testAttentionSurvivesWhereTheAnswerIsUnknown() {
  /* THE GATE IS A GATE. shared-entities.js cannot answer for a shot whose
     dependency collections are malformed, entityReadinessObligations() refuses to
     read that as "nothing owed", and a required gap therefore keeps its amber —
     failing closed means keeping work visible. */
  /* The reproduced ambiguity from tests/reference-demand.js FD3: a second
     character whose id is a PREFIX of this one, so the shot's `CHAR-UX` token
     matches two entities and the resolver's pick cannot be trusted. Clean,
     well-formed data that normalisation leaves alone — and an answer the owner
     refuses to give. */
  const damaged = convergenceFixture();
  damaged.characters.unshift({ id: "CHAR", name: "Other", prefix: "CHAR", approvedFile: "",
    continuityStates: [{ id: "state-default", name: "Default", isDefault: true, approvedFile: "" }],
    coverageSlots: [], expressionSlots: [], candidateFiles: [] });
  for (const shot of damaged.shots || []) { shot.characters = []; shot.codes = ["CHAR-UX"]; }
  const rendered = await surface(damaged, COVERAGE_STORAGE);
  const production = /data-demand-production="([a-z]+)"/.exec(rendered.html);
  eq(production && production[1], "unknown",
    "baseline: a malformed dependency collection leaves the demand answer unknown");
  const rail = within(rendered.html, '<nav class="bounded-slot-rail"', "</nav>");
  ok(/tone-attention/.test(rail),
    "with no confident answer a required gap still claims attention");
  ok(/Required — missing/.test(rail), "and still says so in the words it always used");
  ok(/data-slot-state="required-missing"/.test(rail),
    "in the display state that means it — cannot-prove-safe keeps work visible");

  /* AND THE WHOLE MATRIX, driven directly, because the two shipped renders above
     can only show two of its rows. */
  const matrix = vm.runInContext(`(() => {
    const slot = { id: 'profile', label: 'Profile', requirement: 'required', selectedFile: '' };
    const ask = (demand) => { const s = referenceSlotStatus(slot, demand); return s.tone + ':' + s.state; };
    return {
      nothing: ask(null),
      unknownProduction: ask({ production: { known: false }, obligations: { known: false } }),
      dormant: ask({ production: { known: true, demanded: false }, obligations: { known: true, rows: [] } }),
      usedButNothingOwed: ask({ production: { known: true, demanded: true, shotIds: ['L1-01'] }, obligations: { known: true, rows: [] } }),
      usedAndReadinessUnknown: ask({ production: { known: true, demanded: true, shotIds: ['L1-01'] }, obligations: { known: false } }),
      planned: (() => { const s = referenceSlotStatus({ id: 'rear', requirement: 'planned', selectedFile: '' }, { production: { known: true, demanded: false }, obligations: { known: true, rows: [] } }); return s.tone + ':' + s.state; })(),
      optional: (() => { const s = referenceSlotStatus({ id: 'overhead', requirement: 'not-required', selectedFile: '' }, { production: { known: true, demanded: true }, obligations: { known: false } }); return s.tone + ':' + s.state; })(),
      satisfied: (() => { const s = referenceSlotStatus({ id: 'front', requirement: 'required', selectedFile: 'X.png' }, { production: { known: true, demanded: true }, obligations: { known: false } }); return s.tone + ':' + s.state; })(),
    };
  })()`, rendered.context);
  eq(matrix.nothing, "attention:required-missing", "asked with no demand context at all, the old answer stands");
  eq(matrix.unknownProduction, "attention:required-missing", "an unknown production answer keeps the work visible");
  eq(matrix.usedAndReadinessUnknown, "attention:required-missing", "so does an unavailable readiness derivation");
  eq(matrix.dormant, "pending:planned", "a reference nothing uses displays its plan as a plan");
  eq(matrix.usedButNothingOwed, "pending:planned",
    "and so does one whose readiness is already satisfied — readiness never owes a coverage slot");
  eq(matrix.planned, "pending:planned", "Planned is untouched");
  eq(matrix.optional, "optional:optional",
    "and Not required stays Optional even where the demand answer is unavailable — softening only ever claims less");
  eq(matrix.satisfied, "complete:satisfied", "and so is Selected — the four states are exactly the four states");
  /* AND THE STRUCTURAL ANSWER IS UNTOUCHED UNDERNEATH ALL OF IT. */
  const untouched = vm.runInContext(`(() => {
    const slot = { id: 'profile', label: 'Profile', requirement: 'required', selectedFile: '' };
    const dormant = { production: { known: true, demanded: false }, obligations: { known: true, rows: [] } };
    return { structural: coverageRequirement(slot), required: isRequiredCoverage(slot),
             effective: effectiveReferenceRequirement(slot, dormant) };
  })()`, rendered.context);
  eq(untouched.structural, "required", "the plan still declares this view required");
  eq(untouched.required, true, "and isRequiredCoverage() — the answer automation reads — still says so");
  eq(untouched.effective, "planned", "while the display says Planned, because nothing is waiting on it");
}

async function testSaveCropAndUseIsOneActionThatConverges() {
  const harness = extractorHarness(convergenceFixture(), COVERAGE_STORAGE);
  const rendered = await harness.render();
  const result = await vm.runInContext(`(async () => {
    ${EXTRACTOR_CANVAS}
    openCoverageSheetExtractor('characters','CHAR-UX','CHAR-UX-SHEET.png', true);
    ${EXTRACTOR_SOURCE_SIZE}
    selectCoverageCropSlot('profile');
    const slotOf = (id) => slotSelectedFile(ensureCoverageSlots('characters', P.characters.find(x => x.id === 'CHAR-UX')).find(s => s.id === id));
    const before = slotOf('profile');
    await extractCoverageCrop({ assign: true });
    const rows = (P.characters.find(x => x.id === 'CHAR-UX').candidateFiles || [])
      .filter((r) => r.coverageJobType === 'extracted-crop' && r.coverageCrop)
      .map((r) => ({ file: r.stored, decision: r.decision, reviewRequired: r.reviewRequired, target: r.targetCoverageSlotId, crop: !!r.coverageCrop, sheet: r.coverageCrop && r.coverageCrop.sourceSheet }));
    return JSON.stringify({ before, after: slotOf('profile'), rows,
      modalHidden: document.getElementById('modal').classList.contains('hidden'),
      modal: document.getElementById('modal').innerHTML,
      task: localStorage.getItem('cinebraid-focused:fixture:entity-task:characters:CHAR-UX'),
      board: localStorage.getItem('cinebraid-bounded:fixture:selected:entity-coverage-view:characters:CHAR-UX'),
      slot: localStorage.getItem('cinebraid-bounded:fixture:selected:coverage-slot:characters:CHAR-UX') });
  })()`, rendered.context);
  const out = JSON.parse(result);

  eq(out.before, "", "baseline: the view the crop is made for is empty");
  eq(out.rows.length, 1, "one press produces exactly one crop");
  eq(out.rows[0].file, harness.uploaded[0], "which is the file that was uploaded");
  eq(out.after, harness.uploaded[0],
    "and the view it named is holding it — no second selection, no manual convergence");
  eq(out.rows[0].decision, "selected-coverage", "the candidate row records the selection");
  eq(out.rows[0].reviewRequired, false, "and does not go on asking to be reviewed first");
  eq(out.rows[0].crop, true, "the crop provenance is stored");
  eq(out.rows[0].sheet, "CHAR-UX-SHEET.png", "naming the sheet it came from");

  /* A5 — NO REVIEW NOBODY ASKED FOR, AND NO SECOND CONFIRMATION. */
  eq(out.modalHidden, true, "the extractor closes and nothing takes its place");
  ok(!/CANDIDATE REVIEW/.test(out.modal),
    "Candidate Review does not open after the filmmaker has already decided");
  ok(!/modal-confirm-action/.test(out.modal),
    "and the one press is not asked to confirm itself");

  /* THE HAND-OFF: back to the board, on the view the crop was made for. */
  eq(out.task, "coverage", "it lands on the coverage stage");
  eq(out.board, "coverage", "on the angles board");
  eq(out.slot, "profile", "with the view the crop was made for selected");
}

async function testSaveAsCandidateAssignsNothing() {
  const harness = extractorHarness(convergenceFixture(), COVERAGE_STORAGE);
  const rendered = await harness.render();
  const result = await vm.runInContext(`(async () => {
    ${EXTRACTOR_CANVAS}
    openCoverageSheetExtractor('characters','CHAR-UX','CHAR-UX-SHEET.png', true);
    ${EXTRACTOR_SOURCE_SIZE}
    selectCoverageCropSlot('profile');
    const slots = () => ensureCoverageSlots('characters', P.characters.find(x => x.id === 'CHAR-UX')).map(s => s.id + '=' + slotSelectedFile(s));
    const before = slots().join('|');
    await extractCoverageCrop({ assign: false });
    const rows = (P.characters.find(x => x.id === 'CHAR-UX').candidateFiles || [])
      .filter((r) => r.coverageJobType === 'extracted-crop' && r.coverageCrop)
      .map((r) => ({ file: r.stored, decision: r.decision, reviewRequired: r.reviewRequired, target: r.targetCoverageSlotId }));
    return JSON.stringify({ before, after: slots().join('|'), rows,
      modal: document.getElementById('modal').innerHTML,
      modalHidden: document.getElementById('modal').classList.contains('hidden') });
  })()`, rendered.context);
  const out = JSON.parse(result);

  eq(out.rows.length, 1, "the crop is preserved");
  eq(out.rows[0].target, "profile", "still recording which view it was made for");
  eq(out.rows[0].decision, "unreviewed", "as a candidate, not a decision");
  eq(out.rows[0].reviewRequired, true, "and one a review can still be run on");
  eq(out.after, out.before,
    "and not one coverage view changed — saving a candidate is not an assignment");
  eq(out.modalHidden, true, "the extractor closes");
  ok(!/CANDIDATE REVIEW/.test(out.modal),
    "and this path does not open a review on the filmmaker's behalf either");
}

async function testAlreadyHeldCandidateIsOfferedNoAssignment() {
  /* CHAR-UX-FRONT.png is the file the Front view already holds, and it carries
     the target that used to print "ASSIGN TO FRONT" over it. */
  const rendered = await surface(convergenceFixture(), COVERAGE_STORAGE);
  const modals = vm.runInContext(`(() => {
    const entity = P.characters.find(x => x.id === 'CHAR-UX');
    const front = (entity.candidateFiles || []).find(r => (r.stored || r.original) === 'CHAR-UX-FRONT.png');
    front.targetCoverageSlotId = 'front'; front.targetCoverageSlotName = 'Front'; front.coverageGroup = 'angles';
    const loose = (entity.candidateFiles || []).find(r => (r.stored || r.original) === 'CHAR-UX-LOOSE.png');
    loose.targetCoverageSlotId = 'profile'; loose.targetCoverageSlotName = 'Profile'; loose.coverageGroup = 'angles';
    openEntityCandidateReview('characters','CHAR-UX','CHAR-UX-FRONT.png','state-default');
    const held = document.getElementById('modal').innerHTML;
    closeModal();
    openEntityCandidateReview('characters','CHAR-UX','CHAR-UX-LOOSE.png','state-default');
    return { held, open: document.getElementById('modal').innerHTML,
      committed: slotSelectedFile(ensureCoverageSlots('characters', entity).find(s => s.id === 'front')) };
  })()`, rendered.context);

  eq(modals.committed, "CHAR-UX-FRONT.png",
    "baseline: the state owner says this candidate is the file the Front view holds");
  ok(!/ASSIGN TO FRONT/.test(modals.held),
    "so the modal must not offer to assign it there again");
  ok(/data-review-target-current="front"/.test(modals.held),
    "it states the current fact instead");
  ok(/ALREADY IN USE FOR FRONT/.test(modals.held), "in words");
  ok(/openCoverageSlotFromReview\('characters','CHAR-UX','angles','front'\)/.test(modals.held),
    "and offers the way to go look at it");

  /* AND THE OFFER SURVIVES WHERE IT IS A REAL DECISION. */
  ok(/ASSIGN TO PROFILE/.test(modals.open),
    "a candidate aimed at a view that does not hold it is still assignable from here");
}

/* ==========================================================================
   CORRECTION 1 — "REQUIRED" MEANS THE PRODUCTION REQUIRES IT NOW.

   The first pass softened the tone and the wording and kept the structural answer
   as the STATE, which is a fifth state wearing four states' clothes. These prove
   the collapse: the four display states, the one reachable KNOWN positive case,
   the fail-closed case kept separate from it, and — because the structural seed
   was deliberately not changed — that coverage automation still sees exactly the
   set it saw before.
   ========================================================================== */

/* A shot that USES the character and DECLARES a state it has no approved image
   for. That declaration is what readiness turns into a current obligation, and it
   is the only way a reference target becomes required NOW: readiness raises one
   kind of row about an entity, `entity-state`, and none at all for a coverage or
   expression slot — public/shared-shot-readiness.js states this outright ("a
   required coverage slot is an ENTITY completeness fact, not a shot
   prerequisite"). */
function demandedStateFixture({ declare = true } = {}) {
  const project = convergenceFixture({ states: 2, cast: true });
  for (const shot of project.shots || []) {
    if (declare) shot.continuityStateSelections = { "CHAR-UX": "state-soaked" };
  }
  return project;
}
const STATES_STORAGE = {
  ...COVERAGE_STORAGE,
  "cinebraid-bounded:fixture:selected:entity-coverage-view:characters:CHAR-UX": "states",
};

async function testKnownCurrentDemandStillReadsRequired() {
  /* WITHOUT the declaration: the shot uses the character, readiness owes nothing
     for the variant, and the same target reads Planned. */
  const quiet = await surface(demandedStateFixture({ declare: false }), STATES_STORAGE);
  const quietRail = within(quiet.html, '<nav class="continuity-state-rail"', "</nav>");
  ok(quietRail, "baseline: the continuity-state rail rendered");
  eq((/data-states-outstanding="(\d+)"/.exec(quietRail) || [])[1], "0",
    "a declared state nothing is waiting on is owed by nobody");
  ok(/Soaked<\/b><small>Planned</.test(quietRail),
    `and reads Planned, got ${quietRail.match(/<b>[^<]*<\/b><small>[^<]*<\/small>/g)}`);
  eq((/data-demand-summary-now="(\d+)"/.exec(quiet.html) || [])[1], "0",
    "and the compact strip agrees that nothing is needed now");

  /* WITH it: the production is genuinely waiting on this exact target. */
  const demanded = await surface(demandedStateFixture(), STATES_STORAGE);
  const owner = vm.runInContext(`(() => {
    const e = P.characters.find(x => x.id === 'CHAR-UX');
    const production = entityReferenceDemandFor('characters', e);
    const obligations = entityCurrentObligations('characters', e, production);
    return { demanded: production.demanded, known: obligations.known,
             owed: (obligations.rows || []).map(r => r.stateId) };
  })()`, demanded.context);
  eq(owner.demanded, true, "baseline: a shot uses this character");
  eq(owner.known, true, "baseline: and the readiness answer is available");
  ok(owner.owed.includes("state-soaked"),
    `baseline: readiness names the declared state as a current obligation, got ${JSON.stringify(owner.owed)}`);

  const rail = within(demanded.html, '<nav class="continuity-state-rail"', "</nav>");
  eq((/data-states-outstanding="(\d+)"/.exec(rail) || [])[1], "1",
    "so the board reports one target outstanding");
  ok(/Soaked<\/b><small>Required</.test(rail),
    `and the chip says Required, got ${rail.match(/<b>[^<]*<\/b><small>[^<]*<\/small>/g)}`);
  ok(/tone-attention/.test(rail), "in the attention tone");
  eq((/data-demand-summary-now="(\d+)"/.exec(demanded.html) || [])[1], "1",
    "and the compact strip reports the same single real gap");
  ok(/NEEDED NOW<\/span><b>1 required reference/.test(demanded.html),
    "in words, on the strip the filmmaker reads first");

  /* THE WORD IS STILL EARNED, NOT ISSUED. Approve the state and it stops. */
  const settled = vm.runInContext(`(() => {
    const e = P.characters.find(x => x.id === 'CHAR-UX');
    const state = e.continuityStates.find(s => s.id === 'state-soaked');
    const production = entityReferenceDemandFor('characters', e);
    const obligations = entityCurrentObligations('characters', e, production);
    return effectiveReferenceRequirement(state, { production, obligations }, { family: 'state' });
  })()`, demanded.context);
  eq(settled, "required", "the join returns Required for exactly this target");

  /* F — AND WHEN THE DEMAND IS MET IT STOPS ASKING. Approving the state through
     the shipped writer makes it canon, and the same chip reads Canon rather than
     Required, from the same render. */
  const resolvedNow = await surface(demandedStateFixture(), STATES_STORAGE);
  vm.runInContext(`(() => {
    const e = P.characters.find(x => x.id === 'CHAR-UX');
    e.continuityStates.find(s => s.id === 'state-soaked').approvedFile = 'CHAR-UX-LOOSE.png';
    P.productionAuthority = P.productionAuthority || { version: 1, receipts: [] };
    P.productionAuthority.receipts.push({
      id: 'authority-000009', sequence: 9, actor: 'human', act: 'explicit-approval',
      command: 'approve-entity-state', kind: 'entity-state',
      targetKey: 'entity-state:characters:CHAR-UX#state-soaked',
      list: 'characters', entityId: 'CHAR-UX', stateId: 'state-soaked', slotId: '',
      value: 'CHAR-UX-LOOSE.png', assetId: '', at: '2026-08-20T00:00:00.000Z',
      status: 'current', supersededBy: '', supersededAt: '', revokedAt: '',
      revocationReason: '', note: '', shotId: '', frameId: '', unitKey: '',
      provenance: { manualAction: 'fixture', via: 'fixture', gesture: 'click' },
    });
  })()`, resolvedNow.context);
  await resolvedNow.context.route();
  const settledSection = within(
    resolvedNow.context.document.getElementById("main").innerHTML,
    '<nav class="continuity-state-rail"', "</nav>");
  ok(settledSection, "baseline: the rail re-rendered");
  eq((/data-states-outstanding="(\d+)"/.exec(settledSection) || [])[1], "0",
    "a demand the production has met is owed by nobody");
  ok(/Soaked<\/b><small>Canon</.test(settledSection),
    `and the chip reads Canon rather than Required, got ${settledSection.match(/<b>[^<]*<\/b><small>[^<]*<\/small>/g)}`);
}

async function testStructuralSeedAndAutomationAreUntouched() {
  /* THE REASON THE TEMPLATE SEED WAS NOT CHANGED. Coverage automation reads
     isRequiredCoverage() — the structural answer — and if the display change had
     reached it, "Generate missing angles" would plan zero targets on exactly the
     project that needs them most. Proven through the shipped modal rather than a
     helper, because the modal is what a filmmaker presses. */
  const rendered = await surface(convergenceFixture(), COVERAGE_STORAGE);
  const html = rendered.html;
  ok(/data-slot-state="planned"/.test(html) && !/data-slot-state="required-missing"/.test(html),
    "baseline: every view on this dormant reference displays as Planned");

  /* The dialog refuses to open unless image generation is configured, so the page's
     own config object is set here. Nothing is contacted and START is never pressed:
     this reads the count the dialog PRINTS, which is what a filmmaker sees. */
  const plan = vm.runInContext(`(() => {
    CONFIG.generation = CONFIG.generation || {};
    CONFIG.generation.fal = { ...(CONFIG.generation.fal || {}), enabled: true, keySource: "environment" };
    const e = P.characters.find(x => x.id === 'CHAR-UX');
    const slots = ensureCoverageSlots('characters', e).filter(s => !s.retired);
    const structural = slots.filter(s => isRequiredCoverage(s));
    openCoverageAutomationModal('characters', 'CHAR-UX', 'hybrid');
    const modal = document.getElementById('modal').innerHTML;
    return { structural: structural.length,
             unfilled: structural.filter(s => !slotSelectedFile(s)).length,
             summary: (/id="coverage-missing-summary">([^<]*)</.exec(modal) || [])[1] || '',
             opened: modal.includes('COVERAGE AUTOMATION') };
  })()`, rendered.context);
  eq(plan.opened, true, "baseline: the coverage automation modal opened");
  ok(plan.structural >= 2, `baseline: the template still declares ${plan.structural} required views`);
  ok(plan.unfilled >= 1, `baseline: ${plan.unfilled} of them are unfilled`);
  /* CONTROL A. The COUNT is the structural work set, unchanged — and the WORDS are
     the effective state, because this reference is one no shot is waiting on. Both
     halves are asserted, because either alone would pass a build that had confused
     them: a truthful sentence about the wrong set, or the right set described as an
     obligation nobody has. */
  ok(plan.summary.startsWith(`${plan.unfilled} planned coverage view`),
    `automation still counts the structural set it always counted, got ${plan.summary!==''?JSON.stringify(plan.summary):'nothing'}`);
  ok(/Nothing is required by current shots\./.test(plan.summary),
    `and says why it is not calling it required, got ${JSON.stringify(plan.summary)}`);
  /* Scoped to the CLAIM — the first sentence, which names the work. The sentence
     after it is the denial ("Nothing is required by current shots."), and a word
     ban that could not tell a claim from its negation would forbid saying so. */
  const claim = String(plan.summary).split(".")[0];
  for (const word of ["required", "missing", "blocking", "needed now"])
    ok(!new RegExp(word, "i").test(claim),
      `the dialog must not use ${word} language for a plan nothing is waiting on, got ${JSON.stringify(claim)}`);

  /* CONTROLS C AND D. The generation module may now NAME the presentation owner —
     that is the whole of correction 2 — but only where it chooses WORDS. The two
     functions that choose WORK still select on the structural answer, and neither
     of them may see the presentation one. */
  const automation = read("public/coverage-automation.js");
  const region = (open, close) => automation.slice(automation.indexOf(open), automation.indexOf(close));
  const workSet = region("function missingCoverageWork(", "function coverageRunSlots(")
    /* Closed on the CORRECTION 2 banner rather than the next function, because the
       banner is the doc comment that explains the split and naturally names both
       sides of it — including it would make this check pass on prose. */
    + region("function missingCoverageSlots(", "/* CORRECTION 2 —");
  ok(workSet.length > 200, "baseline: both work-set selectors were located");
  for (const name of ["effectiveReferenceRequirement", "effectiveRequirementLabel", "referenceSlotStatus", "entityDemandContext"])
    ok(!workSet.includes(name),
      `${name} is presentation and must not decide which slots ${"generation"} builds`);
  ok(/function missingCoverageSlots[\s\S]{0,260}isRequiredCoverage\(slot\)/.test(automation),
    "missingCoverageSlots() still selects on the structural answer");
  ok(/function missingCoverageWork[\s\S]{0,260}isRequiredCoverage\(slot\)/.test(automation),
    "and so does the work a run is priced and dispatched against");
  /* AND THERE IS NO SECOND DEMAND CALCULATION. The module asks the one constructor
     for the pair and the one join for the answer; it derives neither. */
  for (const name of ["entityReferenceDemand", "referenceDemandState", "obligationStateIds",
    "entityCurrentObligations", "entityReadinessObligations", "referenceDemandResolution"])
    ok(!automation.includes(name),
      `the generation module must not derive demand itself, found ${name}`);
  const summary = region("function coverageWorkSummary(", "function coverageSlotViewTag(");
  ok(/entityDemandContext\(list, entity\)/.test(summary) && /effectiveReferenceRequirement\(slot, demand\)/.test(summary),
    "its copy consumes the shipped context and the shipped join, and nothing else");

  /* THE SEED ITSELF, unchanged. */
  const entities = read("public/entities.js");
  ok(/\["front", "Front", true\][\s\S]{0,200}\["rear", "Rear", true\]/.test(entities),
    "coverageTemplateForList() still seeds the character views as required");
  ok(entities.includes("requirement: templateRequirement(required)"),
    "through the same writer it always used");
}

/* CONTROL B — UNKNOWN DEMAND IS NOT SOFTENED.
 *
 * The correction's whole risk is that it turns "we cannot prove nothing needs this"
 * into "nothing needs this". The dialog keeps the shipped sentence, byte for byte,
 * where the demand answer cannot be obtained — and the board above it keeps its
 * amber, so the two still agree in the direction that costs a filmmaker something.
 */
async function testUnknownDemandKeepsTheAutomationWarning() {
  /* The reproduced ambiguity: a second character whose id is a PREFIX of this one,
     so the shot's token matches two entities and shared-entities.js refuses to
     answer. Clean, well-formed data — normalisation leaves it alone. */
  const damaged = convergenceFixture();
  damaged.characters.unshift({ id: "CHAR", name: "Other", prefix: "CHAR", approvedFile: "",
    continuityStates: [{ id: "state-default", name: "Default", isDefault: true, approvedFile: "" }],
    coverageSlots: [], expressionSlots: [], candidateFiles: [] });
  for (const shot of damaged.shots || []) { shot.characters = []; shot.codes = ["CHAR-UX"]; }
  const rendered = await surface(damaged, COVERAGE_STORAGE);

  const seen = vm.runInContext(`(() => {
    CONFIG.generation = CONFIG.generation || {};
    CONFIG.generation.fal = { ...(CONFIG.generation.fal || {}), enabled: true, keySource: "environment" };
    const e = P.characters.find(x => x.id === 'CHAR-UX');
    const production = entityReferenceDemandFor('characters', e);
    const slots = ensureCoverageSlots('characters', e).filter(s => !s.retired);
    openCoverageAutomationModal('characters','CHAR-UX','hybrid');
    return {
      production: production.known ? (production.demanded ? 'demanded' : 'dormant') : 'unknown',
      unfilled: slots.filter(s => isRequiredCoverage(s) && !slotSelectedFile(s)).length,
      summary: (/id="coverage-missing-summary">([^<]*)</.exec(document.getElementById('modal').innerHTML) || [])[1] || '',
      opened: document.getElementById('modal').innerHTML.includes('COVERAGE AUTOMATION'),
    };
  })()`, rendered.context);

  eq(seen.production, "unknown", "baseline: an ambiguous token leaves the demand answer unobtainable");
  eq(seen.opened, true, "baseline: the automation dialog opened");
  ok(seen.unfilled >= 1, `baseline: the structural plan has ${seen.unfilled} unfilled required views`);
  ok(seen.summary.startsWith(`${seen.unfilled} required coverage slot`),
    `with no confident answer the dialog keeps the shipped warning, got ${JSON.stringify(seen.summary)}`);
  ok(/still missing\./.test(seen.summary), "in the words it always used");
  ok(!/Nothing is required by current shots/.test(seen.summary),
    "and never claims nothing is required, which is the one thing it cannot know here");

  /* AND THE BOARD ABOVE IT AGREES, in the same direction. */
  const rail = within(rendered.html, '<nav class="bounded-slot-rail"', "</nav>");
  ok(/tone-attention/.test(rail) && /Required — missing/.test(rail),
    "the board fails closed too, so the dialog and the board do not disagree about uncertainty");
}

async function testCancellingAStagedChoiceLeavesTheViewAlone() {
  /* THE THIRD STAGING GESTURE. Choosing previews, using commits — and walking
     away must do neither. This drives the two ways a filmmaker leaves: closing
     the visual chooser without picking a card, and staging a choice and then
     letting the page re-render, which is what navigating away and back does. */
  const rendered = await surface(convergenceFixture(), COVERAGE_STORAGE);
  const out = await vm.runInContext(`(async () => {
    const slotOf = () => slotSelectedFile(ensureCoverageSlots('characters', P.characters.find(x => x.id === 'CHAR-UX')).find(s => s.id === 'profile'));
    boundedWriteState('selected:coverage-slot','characters:CHAR-UX','profile');
    await route();
    const before = { slot: slotOf(), rev: SAVE_REVISION };

    /* Opened and closed without choosing anything. */
    openReferenceMediaChooser('characters','CHAR-UX','coverage',1);
    const opened = document.getElementById('modal').innerHTML.includes('CHOOSE AN IMAGE');
    closeModal();
    const afterClose = { slot: slotOf(), rev: SAVE_REVISION, value: document.getElementById('coverage-slot-file').value };

    /* Staged, then abandoned by a re-render. */
    const select = document.getElementById('coverage-slot-file');
    select.dataset.committed = '';
    select.dataset.slotList = 'characters';
    select.dataset.slotEntity = 'CHAR-UX';
    pickReferenceMediaForSlot('coverage-slot-file','coverage-slot-use','CHAR-UX-LOOSE.png');
    const staged = { mode: document.getElementById('coverage-slot-preview').dataset.slotPreview, slot: slotOf() };
    await route();
    /* READ OFF THE FRESHLY RENDERED MARKUP, not the elements the staging handler
       wrote to. A browser discards those on re-render and parses new ones; this
       harness caches its element objects, so asking them would measure the
       harness rather than the page. */
    const html = document.getElementById('main').innerHTML;
    const afterRender = { slot: slotOf(), rev: SAVE_REVISION,
      committed: html.includes('id="coverage-slot-preview" class="coverage-slot-preview" data-slot-preview="committed"'),
      staged: html.includes('data-slot-preview="staged"'),
      label: (/id="coverage-slot-use"[^>]*>([^<]*)</.exec(html) || [])[1] };
    return JSON.stringify({ before, opened, afterClose, staged, afterRender });
  })()`, rendered.context);
  const result = JSON.parse(out);

  eq(result.opened, true, "baseline: the visual chooser opened on the selected view");
  eq(result.before.slot, "", "baseline: that view is empty");
  eq(result.afterClose.slot, result.before.slot, "closing the chooser without picking writes nothing to the view");
  eq(result.afterClose.rev, result.before.rev, "and schedules no save");
  eq(result.afterClose.value, "", "and stages nothing");

  eq(result.staged.mode, "staged", "baseline: picking a card does stage and preview it");
  eq(result.staged.slot, "", "without touching the view");
  eq(result.afterRender.slot, result.before.slot,
    "and abandoning that staged choice leaves the committed view exactly as it was");
  eq(result.afterRender.rev, result.before.rev, "with no save scheduled by the staging");
  eq(result.afterRender.committed, true,
    "the re-rendered preview declares the committed image again");
  eq(result.afterRender.staged, false, "with no staged state left anywhere on the page");
  eq(result.afterRender.label, "SELECT AN IMAGE",
    "and the commit control returns to its resting label");
}

const EXPRESSION_STORAGE = {
  ...COVERAGE_STORAGE,
  "cinebraid-bounded:fixture:selected:entity-coverage-view:characters:CHAR-UX": "expressions",
};

async function testCompactSummaryAgreesWithTheBoard() {
  /* BOTH BOARDS, because they are two renderings of one rule and a rule applied
     to one of them is a rule that will drift. */
  for (const [label, fixture, storage] of [
    ["dormant", convergenceFixture(), COVERAGE_STORAGE],
    ["used, nothing owed", convergenceFixture({ cast: true }), COVERAGE_STORAGE],
    ["dormant expressions", convergenceFixture(), EXPRESSION_STORAGE],
    ["used expressions, nothing owed", convergenceFixture({ cast: true }), EXPRESSION_STORAGE],
  ]) {
    const rendered = await surface(fixture, storage);
    const html = rendered.html;
    const owedByStrip = Number((/data-demand-summary-now="(\d+)"/.exec(html) || [])[1] || -1);
    const boards = [...html.matchAll(/data-board-outstanding="(\d+)"/g)].map((m) => Number(m[1]));
    ok(owedByStrip >= 0, `${label}: baseline: the compact strip publishes what it counts`);
    ok(boards.length >= 1, `${label}: baseline: the board publishes what it counts`);
    if (owedByStrip === 0) {
      eq(boards.filter((count) => count > 0).length, 0,
        `${label}: no board may claim outstanding work while the strip above it counts none`);
      ok(!/tone-attention/.test(within(html, '<nav class="bounded-slot-rail"', "</nav>")),
        `${label}: and no chip may claim attention under a strip that says nothing is needed now`);
    }
  }
}

/* ==========================================================================
   CORRECTION 3 — THE PRIMARY HERO, AND THE WHOLE SCREEN AT ONCE.

   The hero was the last surface naming the structural plan as an obligation:
   "Views still needed: Front, 3/4 front, Profile" over chips reading Planned. This
   asserts every surface of the same rendered reference together, because the defect
   was never one string — it was two answers on one screen, and a per-surface test
   is exactly what let it survive three corrections.
   ========================================================================== */

const REFERENCE_STORAGE = { "cinebraid-focused:fixture:entity-task:characters:CHAR-UX": "reference" };

/* Every claim the reference makes about what it owes, from one project, read off
   the two stages a filmmaker actually moves between. */
async function referenceSurfaces(project) {
  const hero = await surface(project, REFERENCE_STORAGE);
  const coverage = await surface(project, COVERAGE_STORAGE);
  const dialog = vm.runInContext(`(() => {
    CONFIG.generation = CONFIG.generation || {};
    CONFIG.generation.fal = { ...(CONFIG.generation.fal || {}), enabled: true, keySource: "environment" };
    openCoverageAutomationModal('characters','CHAR-UX','hybrid');
    const modal = document.getElementById('modal').innerHTML;
    const e = P.characters.find(x => x.id === 'CHAR-UX');
    const slots = ensureCoverageSlots('characters', e).filter(s => !s.retired);
    closeModal();
    return {
      opened: modal.includes('COVERAGE AUTOMATION'),
      copy: (/id="coverage-missing-summary">([^<]*)</.exec(modal) || [])[1] || '',
      structural: slots.filter(s => isRequiredCoverage(s) && !slotSelectedFile(s)).map(s => s.label || s.id),
      production: (() => { const p = entityReferenceDemandFor('characters', e);
        return p.known ? (p.demanded ? 'demanded' : 'dormant') : 'unknown'; })(),
    };
  })()`, coverage.context);
  return {
    hero: (/class="reference-primary-remaining">([^<]*)</.exec(hero.html) || [])[1] || "",
    fold: (/Coverage board <span>([^<]*)</.exec(coverage.html) || [])[1] || "",
    chips: [...new Set([...within(coverage.html, '<nav class="bounded-slot-rail"', "</nav>")
      .matchAll(/data-slot-state="([a-z-]+)"/g)].map((m) => m[1]))],
    labels: [...new Set([...within(coverage.html, '<nav class="bounded-slot-rail"', "</nav>")
      .matchAll(/<small>([^<]*)<\/small>/g)].map((m) => m[1]))],
    strip: (/NEEDED NOW<\/span><b>([^<]*)</.exec(coverage.html) || [])[1] || "",
    ...dialog,
  };
}

async function testEveryReferenceSurfaceAgreesAboutWhatIsOwed() {
  /* KNOWN NO DEMAND — and both shapes of it, because "dormant" and "used but
     nothing owed" are different facts that must produce the same screen. */
  for (const [label, project] of [
    ["no shot uses it", convergenceFixture()],
    ["a shot uses it and readiness owes nothing", convergenceFixture({ cast: true })],
  ]) {
    const seen = await referenceSurfaces(project);
    eq(seen.opened, true, `${label}: baseline: the automation dialog opened`);
    ok(seen.structural.length >= 1,
      `${label}: baseline: the structural plan still holds ${seen.structural.length} unfilled views`);

    ok(seen.hero.startsWith("Planned view"),
      `${label}: the hero describes the plan as a plan, got ${JSON.stringify(seen.hero)}`);
    ok(!/still needed/.test(seen.hero),
      `${label}: and never as an obligation, got ${JSON.stringify(seen.hero)}`);
    /* AND IT STILL NAMES THE PLAN. What the hero contains did not change. */
    ok(seen.hero.includes(seen.structural[0]),
      `${label}: the hero still names the plan's own views, got ${JSON.stringify(seen.hero)}`);

    ok(/none needed now/.test(seen.fold), `${label}: the fold says nothing is needed now, got ${JSON.stringify(seen.fold)}`);
    ok(!/required/i.test(seen.fold), `${label}: without the word, got ${JSON.stringify(seen.fold)}`);
    ok(!seen.chips.includes("required-missing"), `${label}: no chip is required-missing, got ${seen.chips}`);
    ok(!seen.labels.some((word) => /Required/.test(word)), `${label}: no chip says Required, got ${seen.labels}`);
    eq(seen.strip.trim(), "None", `${label}: the strip counts nothing owed`);
    ok(seen.copy.startsWith(`${seen.structural.length} planned coverage view`),
      `${label}: the dialog offers the whole plan in planning words, got ${JSON.stringify(seen.copy)}`);
    ok(/Nothing is required by current shots\./.test(seen.copy),
      `${label}: and says why, got ${JSON.stringify(seen.copy)}`);

    /* THE WHOLE SCREEN, IN ONE SENTENCE: nowhere on it does the word "required"
       appear as a claim about this reference's coverage. */
    /* NEGATIONS ARE NOT CLAIMS. "Not required" is the optional chip's own label
       and "Nothing is required by current shots" is the dialog saying exactly what
       this correction wants said; a ban that could not tell a claim from its denial
       would forbid the truthful sentence along with the false one. */
    const claims = [seen.hero, seen.fold, ...seen.labels, seen.strip, seen.copy.split(".")[0]]
      .map((text) => String(text).replace(/Not required/g, "").replace(/Nothing is required[^.]*/g, ""));
    for (const claim of claims)
      ok(!/\brequired\b/i.test(claim),
        `${label}: no surface may call this plan required, got ${JSON.stringify(claim)}`);
  }
}

async function testEveryReferenceSurfaceFailsClosedTogether() {
  /* UNKNOWN DEMAND — the same five surfaces, in the other direction. A screen that
     softened only some of them would be the same defect wearing the other face. */
  const damaged = convergenceFixture();
  damaged.characters.unshift({ id: "CHAR", name: "Other", prefix: "CHAR", approvedFile: "",
    continuityStates: [{ id: "state-default", name: "Default", isDefault: true, approvedFile: "" }],
    coverageSlots: [], expressionSlots: [], candidateFiles: [] });
  for (const shot of damaged.shots || []) { shot.characters = []; shot.codes = ["CHAR-UX"]; }
  const seen = await referenceSurfaces(damaged);

  eq(seen.production, "unknown", "baseline: the demand answer cannot be obtained");
  eq(seen.opened, true, "baseline: the automation dialog opened");
  ok(seen.structural.length >= 1, `baseline: the plan holds ${seen.structural.length} unfilled views`);

  ok(seen.hero.startsWith("View") && /still needed/.test(seen.hero),
    `the hero keeps the sentence it shipped with, got ${JSON.stringify(seen.hero)}`);
  ok(!/^Planned view/.test(seen.hero), "and is not softened into a plan it cannot prove is one");
  ok(/required view/.test(seen.fold), `the fold keeps its warning, got ${JSON.stringify(seen.fold)}`);
  ok(seen.chips.includes("required-missing"), `the chips fail closed, got ${seen.chips}`);
  ok(seen.labels.some((word) => /Required — missing/.test(word)), `in the words they shipped with, got ${seen.labels}`);
  ok(seen.copy.startsWith(`${seen.structural.length} required coverage slot`),
    `and the dialog keeps its own, got ${JSON.stringify(seen.copy)}`);
  ok(!/Nothing is required by current shots/.test(seen.copy),
    "and never claims nothing is required, which is the one thing it cannot know here");
}

async function testTheHeroDerivesNoDemandOfItsOwn() {
  /* NO SECOND OWNER, and the hero is the newest place one could appear. It may name
     the shared context and the shared join; it may not name a demand derivation. */
  const entities = read("public/entities.js");
  const hero = entities.slice(entities.indexOf("function referencePrimaryHeroMarkup("),
    entities.indexOf("function referenceCreationHub("));
  ok(hero.length > 400, "baseline: the hero renderer was located");
  ok(/entityDemandContext\(list, entity\)/.test(hero),
    "the hero asks the one constructor for the demand context");
  ok(/effectiveReferenceRequirement\(slot, heroDemand\)/.test(hero),
    "and the one join for the answer");
  for (const name of ["entityReferenceDemandFor", "entityCurrentObligations", "referenceDemandState",
    "obligationStateIds", "referenceDemandResolution", "entityReadinessObligations"])
    ok(!hero.includes(name), `the hero must not derive demand itself, found ${name}`);
  /* AND WHAT THE PLAN CONTAINS IS STILL THE STRUCTURAL ANSWER. */
  ok(/referenceRequirement\(slot\) === "required" && !slotSelectedFile\(slot\)/.test(hero),
    "the set it names is still the structural coverage plan");
}

/* ==========================================================================
   R1, ON THE SURFACE THE FIRST PASS DID NOT REACH.

   The intake modal stopped rendering a chooser with one non-answer. The
   generation-record fold on the reference's own page — headed "Generation
   records — provenance" — kept rendering exactly that: a <select> whose only
   option was the placeholder "model…". Three shapes, because the rule has three
   answers and only the middle one is a dropdown.
   ========================================================================== */
async function testProvenanceRecordChooserFollowsTheSameRule() {
  const project = convergenceFixture();
  project.characters[0].made = [{ model: "", files: "CHAR-UX-PRIMARY.png", prompt: "a portrait", date: "2026-08-01" }];
  project.meta.models = [];
  const rendered = await surface(project, COVERAGE_STORAGE);
  const fold = (expr) => vm.runInContext(expr, rendered.context);

  /* NOTHING TO CHOOSE — so there is no control, not an empty one. */
  const bare = fold(`entityGenerationRecordsMarkup('characters', P.characters.find((x) => x.id === 'CHAR-UX'))`);
  ok(bare.includes("Generation records"), "baseline: the provenance fold rendered");
  ok(!/<select/.test(bare), "a project with no model list gets no model chooser at all");
  ok(bare.indexOf("model…") < 0, "and not the placeholder that was standing in for one");

  /* TWO REAL ANSWERS — a choice, and it is offered. The capability is the thing
     this check protects: R1 removes an empty control, never the control. */
  const rich = fold(`(() => {
    P.meta.models = [{ id: 'm1', name: 'Model One' }, { id: 'm2', name: 'Model Two' }];
    const out = entityGenerationRecordsMarkup('characters', P.characters.find((x) => x.id === 'CHAR-UX'));
    P.meta.models = [];
    return out;
  })()`);
  ok(/<select/.test(rich), "two models is a real choice and still gets a dropdown");
  ok(/Model One/.test(rich) && /Model Two/.test(rich), "and it offers both of them");
  ok(/made\[0\]\.model=this\.value/.test(rich), "writing provenance is unchanged");

  /* ONE RECORDED ANSWER AND NOTHING TO CHANGE IT TO — a fact, printed as one.
     Hiding the field unconditionally would have swallowed a provenance record
     this fold exists to display, which is the failure mode worth naming. */
  const recorded = fold(`(() => {
    const e = P.characters.find((x) => x.id === 'CHAR-UX');
    e.made[0].model = 'legacy-model-id';
    return entityGenerationRecordsMarkup('characters', e);
  })()`);
  ok(/legacy-model-id/.test(recorded), "a recorded model survives an emptied project model list");
  ok(!/<select/.test(recorded), "but it is stated rather than offered as a choice");
  ok(/data-provenance-model="static"/.test(recorded), "and says which of the three answers it is");
}

/* ==========================================================================
   R3 / R8 — A TARGET LIST MUST NAME THE VIEWS THAT ARE ALREADY FILLED.

   Both places that offer "which view does this become" described an occupied
   target by reading `slot.approvedFile` — the key assignSlotReference() DELETES
   when it writes `selectedFile`. So the marker was unreachable for every view
   filled by the current writer, which is every view anyone has ever assigned.

   The extractor already knew better twice over: it OPENS on the first empty view
   and gates "SAVE & NEXT VIEW" on slotSelectedFile(). One fact, three reads, one
   of them stale — and the visible one was the stale one, so a filmmaker cropping
   a second panel was offered a target that looked free and could overwrite a
   view they had already assigned.
   ========================================================================== */
async function testTargetListsNameTheViewsAlreadyFilled() {
  const project = convergenceFixture();
  project.characters[0].candidateFiles.push({
    stored: "CHAR-UX-SHEET.png", original: "CHAR-UX-SHEET.png", decision: "unreviewed",
    coverageJobType: "sheet", coverageSheetType: "angles",
  });
  const rendered = await surface(project, COVERAGE_STORAGE);

  const out = vm.runInContext(`(() => {
    const e = P.characters.find((x) => x.id === 'CHAR-UX');
    const slots = ensureCoverageSlots('characters', e);
    const first = slots[0];
    /* The real writer, not a hand-set field: the point of the check is what the
       shipped assignment path leaves behind. */
    const wrote = assignSlotReference(first, { fileName: 'CHAR-UX-FRONT.png', by: 'human', via: 'test', at: '2026-08-29T00:00:00Z' });
    openCoverageSheetExtractor('characters','CHAR-UX','CHAR-UX-SHEET.png', true);
    const extractor = document.getElementById('modal').innerHTML;
    const a = extractor.indexOf('<select id="coverage-crop-slot"');
    const extractorList = a < 0 ? '' : extractor.slice(a, extractor.indexOf('</select>', a));
    closeModal();
    openImportedReferenceMapper('characters','CHAR-UX');
    const mapper = document.getElementById('modal').innerHTML;
    const b = mapper.indexOf('<select id="import-reference-target"');
    const mapperList = b < 0 ? '' : mapper.slice(b, mapper.indexOf('</select>', b));
    return {
      assigned: wrote && wrote.assigned === true,
      legacyGone: first.approvedFile === undefined,
      canonical: slotSelectedFile(first),
      label: first.label,
      extractorList,
      mapperList,
    };
  })()`, rendered.context);

  /* The premise. If the writer stopped deleting the legacy key this check would
     pass for the wrong reason, so it is asserted rather than assumed. */
  ok(out.assigned, "baseline: the shipped writer assigned the view");
  ok(out.legacyGone, "baseline: and removed the legacy approvedFile key, which is why the old read was unreachable");
  eq(out.canonical, "CHAR-UX-FRONT.png", "baseline: the canonical owner reports the file");

  ok(out.extractorList, "the extraction panel offered a target list");
  ok(out.extractorList.includes(`${out.label} · already assigned`),
    `the extractor must name the view it is about to overwrite, got ${out.extractorList}`);
  /* And the views that really are empty must stay unmarked, or the marker means
     nothing — a label everything wears is not a warning. */
  ok(!/Profile · already assigned/.test(out.extractorList),
    "an empty view is not marked, so the marker still distinguishes");

  ok(out.mapperList, `"Use an existing image" offered a target list`);
  ok(/Front · currently CHAR-UX-FRONT\.png/.test(out.mapperList),
    `the mapper must name what an occupied view currently holds, got ${out.mapperList}`);
  ok(!/3\/4 front · currently/.test(out.mapperList),
    "and must not claim an empty view holds something");
}

/* ==========================================================================
   BATCH APPROVAL MUST NAME WHAT IT WOULD REPLACE.

   The fourth reader of the deleted key, and the only one that could cost a
   reference rather than mislabel one. openEntityBatchApproval() resolved a
   slot's current assignment with `?.approvedFile`, which assignSlotReference()
   removes — so a view filled by the canonical writer rendered as though it were
   empty, and confirming replaced it anyway. The replacement path asks
   slotSelectedFile() and records the history correctly, so the mechanism knew
   the slot was occupied while the confirmation immediately above it did not say
   so.

   Three states are asserted, because "shows a warning" alone would also pass if
   the clause were unconditional: an occupied slot names its file, a genuinely
   empty slot stays quiet, and a continuity state — which owns an `approvedFile`
   of its own and was never wrong — still names its file.
   ========================================================================== */
async function testBatchApprovalNamesWhatItWouldReplace() {
  const project = convergenceFixture();
  project.characters[0].candidateFiles.push(
    { stored: "CURRENT-FRONT.png", original: "CURRENT-FRONT.png", decision: "unreviewed" },
    { stored: "NEW-FRONT.png", original: "NEW-FRONT.png", decision: "unreviewed" },
  );
  const rendered = await surface(project, COVERAGE_STORAGE);

  const out = vm.runInContext(`(() => {
    const e = P.characters.find((x) => x.id === 'CHAR-UX');
    const slot = ensureCoverageSlots('characters', e).find((s) => s.id === 'front');
    /* The canonical writer, not a hand-set field: the whole point is what the
       shipped assignment path leaves behind for this surface to read. */
    const wrote = assignSlotReference(slot, { fileName: 'CURRENT-FRONT.png', by: 'human', via: 'test', at: '2026-08-29T00:00:00Z' });
    const result = (over) => Object.assign({
      status: 'completed', pass: true, score: 91, approvable: true,
      contractVersion: 'reference-authority-v3',
    }, over);
    e.candidateReviewBatches = [{ id: 'batch-1', status: 'completed', results: [
      result({ fileName: 'NEW-FRONT.png', targetKey: 'coverage:front', targetLabel: 'Front', type: 'coverage', slotId: 'front' }),
      result({ fileName: 'NEW-REAR.png', targetKey: 'coverage:rear', targetLabel: 'Rear', type: 'coverage', slotId: 'rear' }),
      result({ fileName: 'NEW-DEFAULT.png', targetKey: 'state:state-default', targetLabel: 'Default', type: 'state', stateId: 'state-default' }),
    ] }];
    openEntityBatchApproval('characters', 'CHAR-UX', 'batch-1');
    const html = document.getElementById('modal').innerHTML;
    const a = html.indexOf('entity-batch-approval-list');
    const body = a < 0 ? '' : html.slice(a, html.indexOf('modal-actions', a));
    const rowFor = (file) => (body.split('<label>').find((chunk) => chunk.includes(file)) || '');
    return {
      assigned: !!(wrote && wrote.assigned),
      legacyGone: slot.approvedFile === undefined,
      canonical: slotSelectedFile(slot),
      rearHolds: slotSelectedFile(ensureCoverageSlots('characters', e).find((s) => s.id === 'rear')),
      defaultState: (entityStateById(e, 'state-default') || {}).approvedFile || '',
      occupied: rowFor('NEW-FRONT.png'),
      empty: rowFor('NEW-REAR.png'),
      state: rowFor('NEW-DEFAULT.png'),
    };
  })()`, rendered.context);

  /* PREMISES. Asserted rather than assumed, so that a future change which stopped
     deleting the legacy key could not let this pass for the wrong reason. */
  ok(out.assigned, "baseline: the canonical writer assigned Front");
  ok(out.legacyGone, "baseline: and removed approvedFile, which is why the old read saw nothing");
  eq(out.canonical, "CURRENT-FRONT.png", "baseline: the canonical projection reports the occupant");
  eq(out.rearHolds, "", "baseline: and Rear is genuinely empty");
  eq(out.defaultState, "CHAR-UX-PRIMARY.png", "baseline: the default state holds its own approved file");

  /* 1. OCCUPIED — the confirmation names the file it would displace. */
  ok(out.occupied, "the batch approval row for the occupied target rendered");
  ok(/replaces CURRENT-FRONT\.png/.test(out.occupied),
    `an occupied target must name what it replaces, got ${out.occupied}`);

  /* 2. EMPTY — and stays quiet, or the warning means nothing. */
  ok(out.empty, "the batch approval row for the empty target rendered");
  ok(!/replaces/.test(out.empty),
    `a genuinely empty target must claim no replacement, got ${out.empty}`);

  /* 3. THE STATE ARM WAS NEVER WRONG AND IS UNTOUCHED. A continuity state owns an
     approvedFile of its own, so correcting the slot arm must not disturb it. */
  ok(out.state, "the batch approval row for the continuity state rendered");
  ok(/replaces CHAR-UX-PRIMARY\.png/.test(out.state),
    `the state arm must still name its current approved file, got ${out.state}`);
}

/* ==========================================================================
   NOTHING PERSISTED, NOTHING DISPATCHED.
   ========================================================================== */
function testNoNewPersistenceAndNoDispatch() {
  const touched = ["public/entities.js", "public/review.js", "public/coverage-automation.js",
    "public/library-tools.js", "public/views.js"].map(read).join("\n");
  /* The slice's own additions are view state and markup. `data-slot-preview` and
     `dataset.*` writes are DOM, not project data — asserted by naming the project
     fields that must not have gained a writer. */
  for (const field of ["demandState", "demandBasis", "productionDemanded", "slotPreview"]) {
    ok(!new RegExp(`(P|project|entity|slot|row)\\.${field}\\s*=(?!=)`).test(touched),
      `${field} must remain derived, never written to the project`);
  }
  ok(!/fetch\(\s*["'`]https?:/.test(read("public/entities.js")),
    "and nothing this slice touched reaches a provider");
}

async function main() {
  await testOneOptionProvenanceIsNotRendered();
  await testLightboxBackdropCloses();
  await testExtractionProgressiveDisclosure();
  await testSaveAndAssignReturnToCoverage();
  await testUnreviewedCandidateHasNoPassFactors();
  await testProductionNeedsIsSummarised();
  await testRequirementAndDemandCannotContradict();
  await testStagedSelectionPreviewsWithoutWriting();
  await testVisualChooserLeadsAndStages();
  await testContinuityStateAddIsObvious();
  await testSingleStateApprovalIsOneAct();
  testStatusDropdownIsReadable();
  await testDetailsIsNotADataDump();
  await testDormantCoverageClaimsNoAttention();
  await testAttentionSurvivesWhereTheAnswerIsUnknown();
  await testSaveCropAndUseIsOneActionThatConverges();
  await testSaveAsCandidateAssignsNothing();
  await testAlreadyHeldCandidateIsOfferedNoAssignment();
  await testKnownCurrentDemandStillReadsRequired();
  await testStructuralSeedAndAutomationAreUntouched();
  await testUnknownDemandKeepsTheAutomationWarning();
  await testCancellingAStagedChoiceLeavesTheViewAlone();
  await testCompactSummaryAgreesWithTheBoard();
  await testEveryReferenceSurfaceAgreesAboutWhatIsOwed();
  await testEveryReferenceSurfaceFailsClosedTogether();
  await testTheHeroDerivesNoDemandOfItsOwn();
  await testProvenanceRecordChooserFollowsTheSameRule();
  await testTargetListsNameTheViewsAlreadyFilled();
  await testBatchApprovalNamesWhatItWouldReplace();
  testNoNewPersistenceAndNoDispatch();
  console.log(`References UX convergence suite passed ${checks} checks across the provenance chooser, the lightbox backdrop, `
    + `extraction disclosure, the save/assign hand-off, unreviewed factors, the compact production-needs summary, `
    + `requirement-vs-demand legibility, staged preview, the visual chooser, continuity-state authoring, single-state `
    + `approval, dropdown readability and Details disclosure, plus the alpha blockers: dormant coverage claiming no `
    + `attention, the fail-closed direction, Save crop & use converging in one action, Save as candidate assigning `
    + `nothing, the retired stale-assign action and strip/board agreement, plus the two residual surfaces this pass found: the provenance chooser on the generation-record fold, and the target lists and the batch-approval confirmation that described an occupied slot through the key the writer deletes. Provider calls made: 0.`);
}

main().catch((error) => { console.error(error); process.exit(1); });

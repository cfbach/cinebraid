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
const { render, buildFixture, withCanon } = require("./render-harness");

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
    ['id="coverage-crop-approve"', "save-and-use is the one-action path and stays on the surface"],
  ]) ok(normal.includes(needle), `the normal extractor surface must keep: ${why}`);
  ok(normal.includes("Review is optional"),
    "and the checkbox keeps its explanation beside it rather than behind a fold");

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
  ok(unreviewed.includes("RUN AI REVIEW"),
    "and running the review is still one press away");

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
  ok(html.includes('data-slot-state="required-missing"'),
    "baseline: the requirement answer is unchanged — Slice 3's four states are untouched");

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
  eq((stage.match(/entityReferenceDemandFor\(/g) || []).length, 1,
    "the coverage stage resolves demand exactly once");
  ok(/coverageBoardMarkup\(list,entity,mediaByName,media,production\)/.test(stage),
    "and hands it to the angles board rather than letting it resolve its own");
  ok(/expressionBoardMarkup\(entity,mediaByName,media,production\)/.test(stage),
    "and to the expression board");
  ok(/entityDemandMarkup\(list, entity, production \|\| undefined\)/.test(stage),
    "and to the panel that publishes the headline");

  /* A REFERENCE A SHOT USES gets the other half of the sentence. */
  const cast = await surface(convergenceFixture({ cast: true }), COVERAGE_STORAGE);
  const castIntro = within(cast.html, '<div class="entity-coverage-intro">', "</div></div>");
  ok(/What the production is actually waiting on is listed under What this production needs/.test(castIntro),
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
  ok(/class="approve-btn large" onclick="confirmEntityApproval\(false\)">APPROVE</.test(single),
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
  ok(html.includes("Identity &amp; production notes") || html.includes("Identity & production notes"),
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
  testNoNewPersistenceAndNoDispatch();
  console.log(`References UX convergence suite passed ${checks} checks across the provenance chooser, the lightbox backdrop, `
    + `extraction disclosure, the save/assign hand-off, unreviewed factors, the compact production-needs summary, `
    + `requirement-vs-demand legibility, staged preview, the visual chooser, continuity-state authoring, single-state `
    + `approval, dropdown readability and Details disclosure. Provider calls made: 0.`);
}

main().catch((error) => { console.error(error); process.exit(1); });

/* REFERENCE TRUTH + SHEET GATE — Visible Slice 1.
 *
 * The property this suite exists for, in one line: A COVERAGE SHEET CANNOT BE AN
 * ENTITY'S IDENTITY, AND THE THING THAT DECIDES WHAT AN ARTIFACT IS READS A
 * WRITER'S DECLARATION RATHER THAN A FILENAME.
 *
 * Four claims, each with its own reproduction below:
 *
 *   1. The refusal lives at the AUTHORITY BOUNDARY, not on a button. A direct or
 *      replayed call to the shipped approval command is refused the same way the
 *      modal is, because the modal is not what is enforcing it.
 *   2. The classification is DECLARED. `/(?:SHEET|TURNAROUND|CONTACT)/i` over a
 *      stored filename could not see a real hand-dropped sheet and did fire on
 *      ordinary images belonging to a prop called Bedsheet. It is deleted, and
 *      both halves of that are measured here rather than asserted.
 *   3. Authority written BEFORE the gate existed is reported, never revoked.
 *   4. The coverage board renders four states, the file dropdown does not commit,
 *      and the paid coverage quote comes from the existing rate owner.
 *
 * Provider calls made by this suite: 0. It never dispatches.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const Coverage = require(path.join(ROOT, "public/shared-coverage.js"));
const Rate = require(path.join(ROOT, "public/shared-generation-rate.js"));
const { render, buildFixture, withCanon } = require("./render-harness");
const { installTestManualActionSource } = require("./authority-test-gesture.js");

const AT = "2026-08-27T00:00:00.000Z";
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };
const eq = (actual, expected, message) => { assert.strictEqual(actual, expected, message); checks++; };

/* ==========================================================================
   A — WHAT AN ARTIFACT IS, FROM WHAT A WRITER DECLARED.
   ========================================================================== */
function testStructuralClassification() {
  const structure = Coverage.referenceArtifactStructure;

  /* The declarations, each named beside the writer that authors it. */
  eq(structure({ coverageJobType: "sheet", coverageSheetType: "angles" }), "sheet",
    "a generated angle sheet is a sheet");
  eq(structure({ coverageJobType: "sheet", coverageSheetType: "expressions" }), "sheet",
    "a generated expression sheet is a sheet");
  eq(structure({ coverageJobType: "extracted-crop", coverageCrop: { sourceSheet: "S.png" } }), "single",
    "a panel cropped OUT of a sheet is one view, not a sheet");
  eq(structure({ coverageJobType: "imported-reference" }), "single",
    "an image imported into a named coverage slot is one view");
  eq(structure({ coverageCrop: { sourceSheet: "S.png" } }), "single",
    "a recorded crop is a single view even with no job type");

  /* THE PRECEDENCE THAT USED TO BE WRONG. public/coverage-automation.js writes
     `coverageJobType: "slot"` together with `coverageSheetType: "expressions"`
     for an individually generated expression candidate — one image of one
     expression. The old predicate's `|| !!row.coverageSheetType` read that as a
     multi-panel sheet, so coverageSlotOptions() then refused to let the filmmaker
     assign the very candidate the product had just generated for that slot.
     The job type describes the ARTIFACT; the sheet type describes the BOARD. */
  eq(structure({ coverageJobType: "slot", coverageSheetType: "expressions" }), "single",
    "an individually generated expression candidate is a single view, not a sheet");
  eq(structure({ coverageJobType: "slot", coverageSheetType: "" }), "single",
    "an individually generated angle candidate is a single view");
  ok(!!Coverage.referenceArtifactStructure({ coverageSheetType: "angles" }),
    "a legacy row naming only a sheet task still answers");
  eq(structure({ coverageSheetType: "angles" }), "sheet",
    "a legacy row with a sheet task and no job type reads as a sheet");

  /* THE THIRD ANSWER IS REAL AND IS NOT ROUNDED. */
  eq(structure({ stored: "CHAR-A-CANDIDATE-M9X-01.png", original: "IREN-TURNAROUND.png" }), "undeclared",
    "a hand-dropped file declares no structure and must say so");
  eq(structure(null), "undeclared", "no row is not a structure");
  eq(structure("CHAR-A.png"), "undeclared", "a string is not a row");
  ok(Array.isArray(Coverage.REFERENCE_ARTIFACT_STRUCTURES)
    && Coverage.REFERENCE_ARTIFACT_STRUCTURES.length === 3,
    "the structural vocabulary is closed at three members");
}

/* THE FILENAME HEURISTIC IS GONE, AND THIS IS WHY IT HAD TO GO.
   Both directions are measured against the real naming the writers produce. */
function testFilenameHeuristicIsGoneAndWasWrongBothWays() {
  const OLD = /(?:SHEET|TURNAROUND|CONTACT)/i;

  /* Direction 1 — it fired on ordinary images. Every stored name begins with the
     entity id, so the token can come from the ENTITY, not the artifact. */
  ok(OLD.test("PROP-BEDSHEET-CANDIDATE-M9X-01.png"),
    "baseline: the deleted pattern really did fire on a prop called Bedsheet");
  eq(Coverage.referenceArtifactStructureOf(
    { candidateFiles: [{ stored: "PROP-BEDSHEET-CANDIDATE-M9X-01.png" }] },
    "PROP-BEDSHEET-CANDIDATE-M9X-01.png",
  ), "undeclared", "a prop called Bedsheet must not have its single images classified as sheets");

  /* Direction 2 — it never saw a real one. doIntake() stores
     `${prefix}-CANDIDATE-${stamp}-NN.ext` and keeps the creator's filename only
     in `original`, so a genuine dragged-in turnaround never matched. */
  ok(!OLD.test("CHAR-IREN-CANDIDATE-M9X-01.png"),
    "baseline: a hand-dropped turnaround's STORED name never matched the deleted pattern");
  ok(!OLD.test("CHAR-IREN_FAL_CANDIDATE_1.png"),
    "baseline: a generated sheet's stored name never matched it either — coverageJobType caught those");

  /* And it is actually deleted, in all three files that carried a copy. */
  for (const file of ["public/entities.js", "public/app.js", "public/coverage-automation.js"]) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    ok(!/SHEET\|TURNAROUND\|CONTACT/.test(source), `${file} must not carry a filename sheet heuristic`);
  }
}

/* THE HAND-DROPPED PATH — NOW ASKED, NOT GUESSED.

   The first pass shipped this as a stated limitation: doIntake() wrote only
   `{stored, original}`, so an ordinary reference and a four-panel turnaround were
   structurally identical and BOTH classified `undeclared` — and `undeclared` was
   treated as eligible. The independent review was right that this is fail-OPEN.
   Missing evidence is not evidence of eligibility.

   The declaration is collected at the one moment a person is holding the answer,
   written as the field the shared classifier already reads, and refused rather
   than defaulted. */
function testManualIntakeDeclaresStructure() {
  const source = fs.readFileSync(path.join(ROOT, "public/library-tools.js"), "utf8");
  const intake = source.slice(source.indexOf("function intakeModal"), source.indexOf("window.approveEntityFile"));

  ok(intake.includes('id="in-structure"'), "manual intake must ask what the artifact is");
  ok(intake.includes('value="single-reference"') && intake.includes('value="sheet"'),
    "the question must offer exactly the two filmmaker-facing answers");
  ok(/<option value="">— choose —<\/option>/.test(intake),
    "there must be no pre-selected default — a default is the guess this seam exists to avoid");
  ok(/id="in-submit" disabled/.test(intake), "upload stays disabled until the filmmaker answers");
  ok(intake.includes('coverageJobType: structure'),
    "the answer is persisted through the existing structural field");
  ok(intake.includes("INTAKE_STRUCTURES.includes(structure)"),
    "the writer refuses an undeclared intake, so a replayed call cannot land one either");
  /* No inference of any kind sneaks in beside it. */
  ok(!/naturalWidth|naturalHeight|aspectRatio|\.width/.test(intake),
    "intake must not infer structure from dimensions or aspect ratio");
  ok(!/SHEET\|TURNAROUND\|CONTACT/.test(intake), "intake must not infer structure from a filename");

  /* A — declared single: eligible. B — declared sheet: not. C — undeclared: not. */
  const decl = (v) => Coverage.artifactMayHoldPrimaryAuthority(Coverage.referenceArtifactStructure(v));
  eq(Coverage.referenceArtifactStructure({ stored: "X.png", coverageJobType: "single-reference" }), "single",
    "A: a declared single reference classifies single");
  eq(decl({ stored: "X.png", coverageJobType: "single-reference" }), true, "A: and may become an identity");
  eq(Coverage.referenceArtifactStructure({ stored: "X.png", coverageJobType: "sheet" }), "sheet",
    "B: a declared sheet classifies sheet");
  eq(decl({ stored: "X.png", coverageJobType: "sheet" }), false, "B: and may not become an identity");
  eq(decl({ stored: "X.png", original: "y.png" }), false,
    "C: an undeclared artifact FAILS CLOSED — no evidence is not evidence of eligibility");
  eq(decl(null), false, "C: and so does an artifact with no record at all");
}

/* THE STATE-IMPORT MAPPING WAS ALREADY A SINGLE-VIEW STATEMENT, and the first
   pass simply was not reading it. All three kinds the mapper can write assign ONE
   image to ONE single-view target; anything else is not guessed at. */
function testImportedMappingIsReadAsEvidence() {
  const kinds = { state: "single", coverage: "single", expression: "single" };
  for (const [kind, expected] of Object.entries(kinds)) {
    eq(Coverage.referenceArtifactStructure({ stored: "X.png", importedMapping: { kind } }), expected,
      `importedMapping kind "${kind}" is a single-view claim and must be read as one`);
  }
  eq(Coverage.referenceArtifactStructure({ stored: "X.png", importedMapping: { kind: "something-else" } }), "undeclared",
    "an import kind outside the declared set is NOT guessed at");
  eq(Coverage.referenceArtifactStructure({ stored: "X.png", importedMapping: {} }), "undeclared",
    "an empty mapping declares nothing");
  /* And the mapper really does write it, so this is the live path. */
  const mapper = fs.readFileSync(path.join(ROOT, "public/coverage-automation.js"), "utf8");
  ok(mapper.includes("row.importedMapping = { kind, targetId"),
    "the import mapper still writes the mapping this reader consumes");
}

/* ==========================================================================
   B — THE AUTHORITY BOUNDARY.
   ========================================================================== */
/* A fresh kernel realm per call, so each gets its own gesture source and its own
   trusted-event target — the same compositional boundary the product relies on.
   `require` must resolve the way the kernel's own siblings do, i.e. relative to
   public/, or the ownership veto answers RESOLVER_UNAVAILABLE and the artifact
   gate below it is never reached. */
const KERNEL_FILE = path.join(ROOT, "public/shared-authority-kernel.js");
const publicRequire = require("module").createRequire(KERNEL_FILE);
const kernelRealm = (resolve = publicRequire) => {
  const module_ = { exports: {} };
  vm.runInNewContext(fs.readFileSync(KERNEL_FILE, "utf8"), {
    module: module_, exports: module_.exports, require: resolve, console, globalThis: {},
  }, { filename: KERNEL_FILE });
  return module_.exports;
};

const entityProject = (row, list = "characters", id = "CHAR-A") => ({
  [list]: [{
    id, prefix: id,
    candidateFiles: [{ stored: `${id}-CANDIDATE-M9X-01.png`, ...row }],
    continuityStates: [{ id: "state-default", isDefault: true, approvedFile: "" }],
  }],
});

function approveThrough(kernel, manual, project, list = "characters", id = "CHAR-A") {
  try {
    manual.gesture(() => kernel.approveEntityStateCanon(project, {
      list, entityId: id, stateId: "state-default",
      value: `${id}-CANDIDATE-M9X-01.png`, assetId: "", at: AT,
    }));
    return { wrote: true, code: "", message: "" };
  } catch (error) { return { wrote: false, code: error.code || "", message: error.message || "" }; }
}

function testTheBoundaryRefusesASheet() {
  const kernel = kernelRealm();
  const manual = installTestManualActionSource(kernel);

  /* 1 — SHEET -> PRIMARY is refused, and NOTHING is written. */
  const sheetProject = entityProject({ coverageJobType: "sheet", coverageSheetType: "angles" });
  const sheet = approveThrough(kernel, manual, sheetProject);
  eq(sheet.wrote, false, "a declared coverage sheet must not become an entity's identity");
  eq(sheet.code, "AUTHORITY_ARTIFACT_NOT_IDENTITY_ELIGIBLE", "the refusal must be its own named code");
  eq(kernel.entityProductionTruth(sheetProject, "characters", "CHAR-A").canon.length, 0,
    "a refused approval writes no canon");
  eq(sheetProject.characters[0].continuityStates[0].approvedFile, "",
    "a refused approval writes no live edge either");
  eq((sheetProject.productionAuthority || {}).receipts, undefined,
    "a refused approval appends no receipt");

  /* 3 — A VALID PRIMARY STILL WORKS. The fix must not make authority impossible. */
  const single = approveThrough(kernel, manual, entityProject({ coverageJobType: "extracted-crop" }));
  eq(single.wrote, true, "a single view extracted from a sheet may still become the identity");
  const declared = approveThrough(kernel, manual, entityProject({ coverageJobType: "single-reference" }));
  eq(declared.wrote, true, "an ordinary image the filmmaker DECLARED single may still become the identity");
  /* And the same bytes with nothing declared may not. This is the correction. */
  const plain = approveThrough(kernel, manual, entityProject({}));
  eq(plain.wrote, false, "an UNDECLARED artifact must fail closed for identity authority");
  /* A DIFFERENT REFUSAL FROM A DIFFERENT FACT. "This is a sheet" is a claim about
     the artifact; "nothing recorded what this is" is a claim about the project's
     records, and telling somebody holding an ordinary photograph that it is a
     coverage sheet would be false and would send them to an extractor with
     nothing to extract. */
  eq(plain.code, "AUTHORITY_ARTIFACT_UNDECLARED", "and refuse under its own name, not the sheet's");
  ok(/will not guess/.test(plain.message || ""), "and say what would resolve it");

  /* 6 — FILENAME FALSE POSITIVE. The entity id carries the old token. */
  const bedsheet = approveThrough(kernel, manual,
    entityProject({ coverageJobType: "single-reference" }, "props", "PROP-BEDSHEET"), "props", "PROP-BEDSHEET");
  eq(bedsheet.wrote, true, "D: the DECLARATION decides — a prop called Bedsheet may still have an identity reference");
  const bedsheetSheet = approveThrough(kernel, manual,
    entityProject({ coverageJobType: "sheet" }, "props", "PROP-BEDSHEET"), "props", "PROP-BEDSHEET");
  eq(bedsheetSheet.wrote, false, "D: and a name containing SHEET cannot rescue a declared sheet either");
}

/* 2 — UNCLASSIFIABLE FAILS CLOSED. If the kernel cannot ask what the artifact is,
   it refuses rather than proceeding uninformed — the same discipline the ownership
   veto already applies when its resolver is missing. Reproduced by loading the
   kernel into a realm where public/shared-coverage.js cannot be resolved. */
function testUnresolvableClassifierFailsClosed() {
  const blindRequire = (spec) => {
    if (String(spec).includes("shared-coverage")) throw new Error("classifier unavailable in this composition");
    return publicRequire(spec);
  };
  const kernel = kernelRealm(blindRequire);
  const manual = installTestManualActionSource(kernel);
  const result = approveThrough(kernel, manual, entityProject({ coverageJobType: "single-reference" }));
  eq(result.wrote, false, "with no classifier the kernel must not grant identity authority even for a declared single");
  eq(result.code, "AUTHORITY_ARTIFACT_CLASSIFIER_UNAVAILABLE",
    "an unanswerable question is refused under its own name, not silently passed");
}

/* ==========================================================================
   C — THE SURFACES.
   ========================================================================== */
function gateFixture({ sheetIsCanon = false } = {}) {
  const project = buildFixture();
  const character = project.characters[0];
  character.id = "CHAR-IREN";
  character.name = "Iren";
  character.approvedFile = sheetIsCanon ? "CHAR-IREN-SHEET.png" : "CHAR-IREN-PRIMARY.png";
  character.continuityStates = [{
    id: "state-default", name: "Default", isDefault: true,
    approvedFile: sheetIsCanon ? "CHAR-IREN-SHEET.png" : "CHAR-IREN-PRIMARY.png",
    notes: "Primary identity.",
  }];
  character.candidateFiles = [
    { stored: "CHAR-IREN-PRIMARY.png", original: "CHAR-IREN-PRIMARY.png", decision: "unreviewed" },
    { stored: "CHAR-IREN-SHEET.png", original: "CHAR-IREN-SHEET.png", decision: "unreviewed", coverageJobType: "sheet", coverageSheetType: "angles" },
  ];
  project.shots[0].characters = [character.id];
  return withCanon(project, {
    kind: "entity-state", list: "characters", entityId: character.id, stateId: "state-default",
    value: sheetIsCanon ? "CHAR-IREN-SHEET.png" : "CHAR-IREN-PRIMARY.png",
  });
}

const gateScan = () => ({
  anchors: [
    { name: "CHAR-IREN-PRIMARY.png", url: "/assets/anchors/CHAR-IREN-PRIMARY.png" },
    { name: "CHAR-IREN-SHEET.png", url: "/assets/anchors/CHAR-IREN-SHEET.png" },
  ],
  plates: [], props: [], vehicles: [], audio: [], media: [],
  shots: { "L1-01": { takes: [], locked: [] } },
});

/* 5 — EXISTING BAD PRIMARY: DETECT AND TELL, NEVER REVOKE. */
async function testExistingBadPrimaryIsReportedNotRevoked() {
  const project = gateFixture({ sheetIsCanon: true });
  const receiptsBefore = JSON.stringify(project.productionAuthority);
  const rendered = await render("#/character/CHAR-IREN", project, { scan: gateScan() });
  const html = rendered.context.document.getElementById("main").innerHTML;

  ok(html.includes("NEEDS CORRECTION"), "an entity whose identity is a sheet must say so");
  ok(html.includes('data-authority-correction="coverage-sheet"'),
    "the correction must carry a machine-readable cause");
  ok(html.includes("CHOOSE REPLACEMENT"), "the filmmaker must be offered a route to a valid replacement");
  ok(html.includes("EXTRACT VIEWS"), "the sheet must remain extractable");
  ok(/NEEDS CORRECTION · CANON/.test(html),
    "the standing stays visible beside the correction — the approval is real and still stands");

  /* THE RECEIPT IS UNTOUCHED. Rendering an entity must not rewrite its history. */
  eq(JSON.stringify(vm.runInContext("P.productionAuthority", rendered.context)), receiptsBefore,
    "viewing an entity that needs correction must not revoke or alter any receipt");
  eq(vm.runInContext("entityProductionTruth(P,'characters','CHAR-IREN').canon.length", rendered.context), 1,
    "the canon receipt still stands — this is detect and tell, not automatic repair");

  /* 12 — AND IDENTITY-DEPENDENT GENERATION WILL NOT PACKAGE IT. */
  const packaged = vm.runInContext(
    `(() => { const e=P.characters.find(x=>x.id==='CHAR-IREN');
       const pack=__CINEBRAID_COVERAGE_AUTOMATION.coverageReferencePackage('characters',e,null);
       return { kinds: pack.map(r=>r.kind), files: pack.map(r=>r.item.name) }; })()`,
    rendered.context);
  ok(!packaged.files.includes("CHAR-IREN-SHEET.png"),
    "a sheet must never be packaged as a reference for identity-dependent generation");
  ok(!packaged.kinds.includes("identity-canon"),
    "with only a sheet as canon there is NO identity authority to send, and the package says so");
}

/* A healthy entity must not be slandered by the same surface. */
async function testHealthyPrimaryReportsNoCorrection() {
  const rendered = await render("#/character/CHAR-IREN", gateFixture(), { scan: gateScan() });
  const html = rendered.context.document.getElementById("main").innerHTML;
  ok(!html.includes("NEEDS CORRECTION"), "a valid single-image primary must not be reported as needing correction");
  ok(html.includes("CANON"), "a valid primary still reads as canon");
}

/* 8 — FOUR COVERAGE STATES, RENDERED DISTINCTLY. */
async function testCoverageBoardRendersFourStates() {
  const project = gateFixture();
  project.characters[0].coverageSlots = [
    { id: "front", label: "Front", requirement: "required", selectedFile: "CHAR-IREN-PRIMARY.png" },
    { id: "profile", label: "Profile", requirement: "required", selectedFile: "" },
    { id: "rear", label: "Rear", requirement: "planned", selectedFile: "" },
    { id: "overhead", label: "Overhead", requirement: "not-required", selectedFile: "" },
  ];
  const rendered = await render("#/character/CHAR-IREN", project, {
    scan: gateScan(),
    storage: {
      "cinebraid-focused:fixture:entity-task:characters:CHAR-IREN": "coverage",
      /* The coverage task carries three boards; name the one under test. */
      "cinebraid-bounded:fixture:selected:entity-coverage-view:characters:CHAR-IREN": "coverage",
    },
  });
  const html = rendered.context.document.getElementById("main").innerHTML;

  /* The rendered state must equal the deterministic owner's answer, slot by slot,
     and there must be no second computation anywhere. */
  /* Keyed by slot id, not by position: project normalisation may add template
     slots beside the four this fixture declares, and a positional assertion would
     be pinning the template rather than the derivation. */
  const expected = vm.runInContext(
    `(() => { const e=P.characters.find(x=>x.id==='CHAR-IREN');
       const out={}; for (const s of ensureCoverageSlots('characters',e)) out[s.id]=referenceSlotStatus(s).state;
       return out; })()`,
    rendered.context);
  eq(expected.front, "satisfied", "a slot holding a file is satisfied");
  eq(expected.profile, "required-missing", "a required slot with no file is a required gap");
  eq(expected.rear, "planned", "a planned slot is planned, not missing");
  eq(expected.overhead, "optional", "a not-required slot is optional, not missing");
  for (const state of ["satisfied", "required-missing", "planned", "optional"]) {
    ok(html.includes(`data-slot-state="${state}"`), `the board must render the ${state} state as itself`);
  }

  /* Four distinct tones, not one grey. */
  const css = fs.readFileSync(path.join(ROOT, "public/styles.css"), "utf8");
  for (const tone of ["complete", "attention", "pending", "optional"]) {
    ok(new RegExp(`\\.coverage-slot-state\\.tone-${tone}\\s*\\{`).test(css),
      `the ${tone} slot state must be visually distinct`);
    ok(new RegExp(`\\.bounded-slot-rail button\\.tone-${tone} i\\{`).test(css),
      `the ${tone} rail dot must be visually distinct`);
  }
  /* And the colours must be real. `--yellow` is referenced nowhere declared. */
  ok(!/\.bounded-slot-rail button\.tone-attention i\{background:var\(--yellow\)\}/.test(css),
    "the rail must not paint attention with an undeclared custom property");

  /* Only REQUIRED gaps create attention. */
  /* Stated as the invariant rather than as a magic number, because project
     normalisation seeds template slots beside the fixture's own: attention counts
     EXACTLY the slots the owner calls required-missing, and planned and optional
     gaps contribute nothing. */
  const attention = vm.runInContext(
    `(() => { const e=P.characters.find(x=>x.id==='CHAR-IREN');
       const slots=ensureCoverageSlots('characters',e);
       const byState=(s)=>slots.filter(x=>referenceSlotStatus(x).state===s).length;
       return { counted: coverageStats(slots).missingRequired,
                requiredMissing: byState('required-missing'),
                planned: byState('planned'), optional: byState('optional') }; })()`,
    rendered.context);
  eq(attention.counted, attention.requiredMissing,
    "attention counts exactly the required gaps the owner names — no second computation");
  ok(attention.planned > 0 && attention.optional > 0,
    "baseline: the fixture really does carry planned and optional gaps");
  eq(attention.counted < attention.requiredMissing + attention.planned + attention.optional, true,
    "planned and optional gaps must not create project attention");
}

/* 9 — SELECTION SELECTS; USE COMMITS. */
async function testBareSelectionDoesNotCommit() {
  const project = gateFixture();
  project.characters[0].coverageSlots = [
    { id: "front", label: "Front", requirement: "required", selectedFile: "" },
  ];
  const rendered = await render("#/character/CHAR-IREN", project, {
    scan: gateScan(),
    storage: {
      "cinebraid-focused:fixture:entity-task:characters:CHAR-IREN": "coverage",
      /* The coverage task carries three boards; name the one under test. */
      "cinebraid-bounded:fixture:selected:entity-coverage-view:characters:CHAR-IREN": "coverage",
    },
  });
  const before = vm.runInContext(
    `(() => { const e=P.characters.find(x=>x.id==='CHAR-IREN');
       return { file: slotSelectedFile(ensureCoverageSlots('characters',e)[0]), rev: SAVE_REVISION }; })()`,
    rendered.context);
  eq(before.file, "", "baseline: the slot starts empty");

  /* Choosing a file and firing the dropdown's own handler must not write. */
  const after = vm.runInContext(
    `(() => { const sel=document.getElementById('coverage-slot-file');
       sel.value='CHAR-IREN-PRIMARY.png';
       stageSlotSelection('coverage-slot-file','coverage-slot-use');
       const e=P.characters.find(x=>x.id==='CHAR-IREN');
       const btn=document.getElementById('coverage-slot-use');
       return { file: slotSelectedFile(ensureCoverageSlots('characters',e)[0]), rev: SAVE_REVISION,
                enabled: !btn.disabled, label: btn.textContent }; })()`,
    rendered.context);
  eq(after.file, "", "choosing a file in the dropdown must NOT assign the slot");
  eq(after.rev, before.rev, "a bare selection must not mark the project dirty");
  eq(after.enabled, true, "the explicit use action becomes available once a different file is chosen");
  eq(after.label, "USE THIS IMAGE", "the commit control names the act it performs");

  /* 10 — and the explicit action does commit, through the one slot writer,
     without a second confirmation, leaving the slot NON-AUTHORITATIVE. */
  const committed = vm.runInContext(
    `(() => { useCoverageSlotSelection('characters','CHAR-IREN',0);
       const e=P.characters.find(x=>x.id==='CHAR-IREN');
       const slot=ensureCoverageSlots('characters',e)[0];
       return { file: slotSelectedFile(slot), status: referenceSlotStatus(slot).state,
                modal: document.getElementById('modal').innerHTML.trim().length,
                authoritative: slotIsAuthoritative() }; })()`,
    rendered.context);
  eq(committed.file, "CHAR-IREN-PRIMARY.png", "the explicit use action assigns the slot");
  eq(committed.status, "satisfied", "and the board reports the slot satisfied");
  eq(committed.modal, 0, "filling an empty slot needs no second confirmation");
  eq(committed.authoritative, false, "a coverage slot is still never authority");
}

/* BLOCKER 2 - A STATUS WORD IS NOT AN AUTHORITY SYSTEM.

   "Use as sheet source" set entity.workflowStatus = "APPROVED". Nothing checked
   that write, but two surfaces BELIEVED it: promptReferenceOptions() published
   `approved: true` with `defaultRole: "identity"`, and the References stage
   called the shot ready. A reference with no primary image and no receipt
   therefore reported an approved identity, and the sheet itself travelled as the
   identity picture.

   Both halves are corrected: the write no longer claims approval, and both
   readers ask the authority owner instead of the status word. */
async function testSheetSourceIsNotIdentityApproval() {
  const project = gateFixture();
  const character = project.characters[0];
  character.approvedFile = "";
  character.continuityStates = [{ id: "state-default", name: "Default", isDefault: true, approvedFile: "" }];
  character.candidateFiles = [{ stored: "CHAR-IREN-SHEET.png", original: "CHAR-IREN-SHEET.png", decision: "unreviewed", coverageJobType: "sheet", coverageSheetType: "angles" }];
  /* The harness fixture ships this character already design-APPROVED, which is
     also the shape a legacy project has. Start it mid-flight so the suppressed
     write is observable; the legacy shape is covered on its own below. */
  character.workflowStatus = "IN PROGRESS";
  character.status = "IN PROGRESS";
  delete project.productionAuthority;

  const rendered = await render("#/character/CHAR-IREN", project, { scan: gateScan() });
  rendered.context.approveEntityFile("characters", "CHAR-IREN", "CHAR-IREN-SHEET.png", "state-default");
  vm.runInContext("document.getElementById('entity-approve-file').value='CHAR-IREN-SHEET.png';"
    + "document.getElementById('entity-approve-target').value='state-default';"
    + "document.getElementById('entity-approve-name').value='CHAR-IREN-SHEET.png';"
    + "document.getElementById('entity-approve-next').value='';", rendered.context);
  await rendered.gesture.act(() => rendered.context.confirmEntityApproval(false));
  await new Promise((resolve) => setTimeout(resolve, 80));

  const after = vm.runInContext(
    "(() => { const e=P.characters.find(x=>x.id==='CHAR-IREN');"
    + " const truth=entityProductionTruth(P,'characters','CHAR-IREN');"
    + " const s=P.shots.find(x=>x.characters && x.characters.includes('CHAR-IREN'));"
    + " const facts=shotStageFacts(s,'references');"
    + " const opts=promptReferenceOptions(s).filter(r=>r.key==='character:CHAR-IREN');"
    + " const row=(e.candidateFiles||[]).find(r=>(r.stored||r.name)==='CHAR-IREN-SHEET.png')||{};"
    + " return { workflow: entityWorkflowState(e).key, approvedFile: e.approvedFile || '',"
    + "  canon: truth.canon.length, decision: row.decision, referencesGaps: facts.gaps.length,"
    + "  optApproved: opts.map(r=>r.approved), optRole: opts.map(r=>r.defaultRole),"
    + "  optFile: opts.map(r=>String(r.url||'').split('/').pop()) }; })()",
    rendered.context);

  eq(after.decision, "approved-sheet-source", "A: the sheet is accepted as a source");
  eq(after.approvedFile, "", "A: no primary pointer is written");
  eq(after.canon, 0, "A: no Canon receipt is written");
  assert.notStrictEqual(after.workflow, "APPROVED",
    "A: accepting a source must not mark the whole reference design-approved");
  checks++;
  eq(after.referencesGaps, 1,
    "A: the References stage must still name this reference as unapproved - source acceptance is not readiness");
  /* Stronger than "published unapproved": with a sheet as its only media this
     reference contributes NO prompt option at all, because the sheet is not a
     candidate to travel as the character and nothing else exists yet. */
  ok(!after.optApproved.includes(true),
    "A: promptReferenceOptions must not publish the sheet as an approved reference");
  ok(!after.optRole.includes("identity"),
    "A: and must not hand it out with defaultRole identity");
  ok(!after.optFile.includes("CHAR-IREN-SHEET.png"),
    "A: the sheet must not even be the picture that travels as this character");
  eq(after.optApproved.length, 0,
    "A: a sheet-only reference offers nothing to the prompt rather than offering the sheet");

  /* THE LEGACY SHAPE, WHICH THE WRITE FIX ALONE CANNOT REACH. A project saved
     before this correction can already carry workflowStatus APPROVED with no
     receipt behind it. Forcing exactly that proves the READERS stopped believing
     the status word, rather than merely that one writer stopped setting it. */
  const legacy = vm.runInContext(
    "(() => { const e=P.characters.find(x=>x.id==='CHAR-IREN');"
    + " e.workflowStatus='APPROVED'; e.status='APPROVED';"
    + " const s=P.shots.find(x=>x.characters && x.characters.includes('CHAR-IREN'));"
    + " const opts=promptReferenceOptions(s).filter(r=>r.key==='character:CHAR-IREN');"
    + " return { workflow: entityWorkflowState(e).key,"
    + "  gaps: shotStageFacts(s,'references').gaps.filter(g=>/CHAR-IREN/.test(g)).length,"
    + "  approved: opts.map(r=>r.approved) }; })()", rendered.context);
  eq(legacy.workflow, "APPROVED", "baseline: the legacy status word really is APPROVED");
  eq(legacy.gaps, 1, "a status word alone must not clear the References gap");
  ok(!legacy.approved.includes(true),
    "a status word alone must not publish an approved identity reference");

  vm.runInContext(
    "(() => { const e=P.characters.find(x=>x.id==='CHAR-IREN');"
    + " e.candidateFiles.push({ stored:'CHAR-IREN-PRIMARY.png', original:'CHAR-IREN-PRIMARY.png',"
    + "  decision:'unreviewed', coverageJobType:'single-reference' }); })()", rendered.context);
  await rendered.gesture.act(() => vm.runInContext(
    "approveEntityStateCanon(P,{list:'characters',entityId:'CHAR-IREN',stateId:'state-default',"
    + "value:'CHAR-IREN-PRIMARY.png',assetId:'',at:'" + AT + "',via:'sheet-gate-suite'})",
    rendered.context));
  const good = vm.runInContext(
    "(() => { const s=P.shots.find(x=>x.characters && x.characters.includes('CHAR-IREN'));"
    + " const facts=shotStageFacts(s,'references');"
    + " const opts=promptReferenceOptions(s).filter(r=>r.key==='character:CHAR-IREN');"
    + " return { gaps: facts.gaps.filter(g=>/CHAR-IREN/.test(g)).length,"
    + "  approved: opts.map(r=>r.approved), role: opts.map(r=>r.defaultRole),"
    + "  file: opts.map(r=>String(r.url||'').split('/').pop()) }; })()",
    rendered.context);
  eq(good.gaps, 0, "B: real identity evidence clears the References gap");
  assert.deepStrictEqual(Array.from(good.approved), [true], "B: and the reference reads approved");
  checks++;
  assert.deepStrictEqual(Array.from(good.role), ["identity"], "B: with its identity role back");
  checks++;
  assert.deepStrictEqual(Array.from(good.file), ["CHAR-IREN-PRIMARY.png"],
    "C: the single primary is what travels; the sheet stays supporting material");
  checks++;
}

/* BLOCKER 3 - ONE EXPLICIT PRESS, ONE COMPLETED ACTION.

   "Save crop & use" reached approveCoverageCandidate(..., directOverride), which
   raised a SECOND, generic "Human approval / ASSIGN VIEW" confirmation - so the
   slot the action named stayed empty until the filmmaker answered the same
   question again in weaker words. The specific press IS the confirmation. */
async function testExplicitUseNeedsNoSecondConfirmation() {
  const project = gateFixture();
  project.characters[0].coverageSlots = [{ id: "front", label: "Front", requirement: "required", selectedFile: "" }];
  project.characters[0].candidateFiles.push({
    stored: "CHAR-IREN-CROP-FRONT.png", original: "CHAR-IREN-CROP-FRONT.png", decision: "unreviewed",
    coverageJobType: "extracted-crop", targetCoverageSlotId: "front", targetCoverageSlotName: "Front",
    coverageGroup: "angles",
    coverageCrop: { sourceSheet: "CHAR-IREN-SHEET.png", layout: "2x2", panelIndex: 0, normalized: { x: 0, y: 0, w: 50, h: 50 }, manuallyAdjusted: true },
  });
  const scan = gateScan();
  scan.anchors.push({ name: "CHAR-IREN-CROP-FRONT.png", url: "/assets/anchors/CHAR-IREN-CROP-FRONT.png" });
  const rendered = await render("#/character/CHAR-IREN", project, {
    scan,
    storage: {
      "cinebraid-focused:fixture:entity-task:characters:CHAR-IREN": "coverage",
      "cinebraid-bounded:fixture:selected:entity-coverage-view:characters:CHAR-IREN": "coverage",
    },
  });

  const coverageSource = fs.readFileSync(path.join(ROOT, "public/coverage-automation.js"), "utf8");
  /* Scoped to extractCoverageCrop's own body: the import mapper is a different
     flow with its own gesture and is deliberately not touched here. */
  const cropSource = coverageSource.slice(
    coverageSource.indexOf("window.extractCoverageCrop"),
    coverageSource.indexOf("window.openImportedReferenceMapper"));
  ok(cropSource.includes("data.name, slot.id, true, { confirmed: true }"),
    "save crop & use must tell the writer the human already confirmed this exact act");
  ok(!/setTimeout\([^)]*approveCoverageCandidate/.test(cropSource),
    "and must not defer that write behind a timer acting as a surrogate confirmation");

  const used = vm.runInContext(
    "(() => { approveCoverageCandidate('characters','CHAR-IREN','CHAR-IREN-CROP-FRONT.png','front',true,{confirmed:true});"
    + " const e=P.characters.find(x=>x.id==='CHAR-IREN');"
    + " const slot=ensureCoverageSlots('characters',e)[0];"
    + " const row=(e.candidateFiles||[]).find(r=>(r.stored||r.name)==='CHAR-IREN-CROP-FRONT.png')||{};"
    + " return { file: slotSelectedFile(slot), state: referenceSlotStatus(slot).state,"
    + "  modal: document.getElementById('modal').innerHTML.trim().length,"
    + "  decision: row.decision, reviewRequired: row.reviewRequired !== false,"
    + "  humanApproved: row.humanApproved === true, authoritative: slotIsAuthoritative(),"
    + "  crop: !!row.coverageCrop && row.coverageCrop.sourceSheet }; })()",
    rendered.context);
  eq(used.file, "CHAR-IREN-CROP-FRONT.png", "the explicit press fills the slot it named");
  eq(used.state, "satisfied", "and Coverage shows that slot satisfied");
  eq(used.modal, 0, "with NO second confirmation modal");
  eq(used.decision, "selected-coverage", "the crop row is decided, not left unreviewed");
  eq(used.reviewRequired, false, "and no longer waiting on a review");
  eq(used.crop, "CHAR-IREN-SHEET.png", "source-sheet and crop provenance survive");
  eq(used.humanApproved, false, "a coverage selection must not claim a human approval");
  eq(used.authoritative, false, "and a coverage slot is still never authority");
  const canonAfter = vm.runInContext(
    "entityProductionTruth(P,'characters','CHAR-IREN').canon.map(r=>r.value).join(',')", rendered.context);
  ok(!canonAfter.includes("CHAR-IREN-CROP-FRONT.png"),
    "using a crop in a view must not mint identity Canon for it");

  const unconfirmed = vm.runInContext(
    "(() => { const e=P.characters.find(x=>x.id==='CHAR-IREN');"
    + " ensureCoverageSlots('characters',e)[0].selectedFile='';"
    + " approveCoverageCandidate('characters','CHAR-IREN','CHAR-IREN-CROP-FRONT.png','front',true);"
    + " return document.getElementById('modal').innerHTML; })()",
    rendered.context);
  ok(/Human approval/.test(unconfirmed),
    "a caller that did NOT carry a specific confirmation is still asked");
}

/* 16 — THE VISUAL CHOOSER IS A CONSUMER, NOT A SECOND MEDIA SYSTEM.
   It shows the entity's own media through the one projection and the one card,
   never offers a sheet for a single view, and — the part that matters — RETURNS
   A SELECTION without writing anything. */
async function testVisualChooserSelectsWithoutWriting() {
  const project = gateFixture();
  project.characters[0].coverageSlots = [{ id: "front", label: "Front", requirement: "required", selectedFile: "" }];
  const rendered = await render("#/character/CHAR-IREN", project, {
    scan: gateScan(),
    storage: {
      "cinebraid-focused:fixture:entity-task:characters:CHAR-IREN": "coverage",
      "cinebraid-bounded:fixture:selected:entity-coverage-view:characters:CHAR-IREN": "coverage",
    },
  });
  ok(rendered.context.document.getElementById("main").innerHTML.includes("Browse visually"),
    "the slot editor must offer a visual alternative to reading filenames");

  const before = vm.runInContext(`SAVE_REVISION`, rendered.context);
  vm.runInContext(`openReferenceMediaChooser('characters','CHAR-IREN','coverage',0);`, rendered.context);
  const modal = vm.runInContext(`document.getElementById('modal').innerHTML`, rendered.context);
  ok(modal.includes("reference-media-chooser"), "the chooser must open");
  ok(modal.includes("results-card"), "the chooser must reuse the existing media card, not a new one");
  ok(modal.includes("CHAR-IREN-PRIMARY.png"), "the entity's own single-view media must be offered");
  ok(!modal.includes("CHAR-IREN-SHEET.png"),
    "a multi-view sheet must never be offered as the image for one view");

  /* Choosing stages. It does not commit, and it does not dirty the project. */
  const after = vm.runInContext(
    `(() => { pickReferenceMediaForSlot('coverage-slot-file','coverage-slot-use','CHAR-IREN-PRIMARY.png');
       const e=P.characters.find(x=>x.id==='CHAR-IREN');
       const btn=document.getElementById('coverage-slot-use');
       return { staged: document.getElementById('coverage-slot-file').value,
                file: slotSelectedFile(ensureCoverageSlots('characters',e)[0]),
                rev: SAVE_REVISION, enabled: !btn.disabled }; })()`,
    rendered.context);
  eq(after.staged, "CHAR-IREN-PRIMARY.png", "the choice is staged into the same dropdown");
  eq(after.file, "", "choosing in the chooser must NOT assign the slot");
  eq(after.rev, before, "returning a selection must not mark the project dirty");
  eq(after.enabled, true, "and the explicit use action becomes available");
}

/* 11 — THE QUOTE COMES FROM THE EXISTING OWNER, AND MATCHES IT EXACTLY. */
async function testCoverageQuoteMatchesTheRateOwner() {
  const project = gateFixture();
  project.characters[0].coverageSlots = [
    { id: "front", label: "Front", requirement: "required", selectedFile: "" },
    { id: "profile", label: "Profile", requirement: "required", selectedFile: "" },
  ];
  const rendered = await render("#/character/CHAR-IREN", project, {
    scan: gateScan(),
    storage: {
      "cinebraid-focused:fixture:entity-task:characters:CHAR-IREN": "coverage",
      /* The coverage task carries three boards; name the one under test. */
      "cinebraid-bounded:fixture:selected:entity-coverage-view:characters:CHAR-IREN": "coverage",
    },
  });
  /* The dialog refuses to open without a usable FAL configuration, so the
     composition is made real before the quote is asked for — and a rate is
     configured, so the PRICED branch is the one under test. No request is ever
     dispatched: this exercises the estimate only. */
  vm.runInContext(`CONFIG.generation=CONFIG.generation||{}; CONFIG.generation.fal=CONFIG.generation.fal||{};
    CONFIG.generation.fal.enabled=true; CONFIG.generation.fal.apiKey='test-key';
    CONFIG.generation.fal.estimatedCostPerImage=0.04; pollFalGeneration=()=>{};`, rendered.context);
  vm.runInContext(`openCoverageAutomationModal('characters','CHAR-IREN','individual');`, rendered.context);
  vm.runInContext(`document.getElementById('coverage-mode').value='individual';
    document.getElementById('coverage-sheet-type').value='angles'; updateCoverageAutomationPlan();`, rendered.context);

  /* Read the markup rather than the element: the render harness's DOM does not
     implement element-scoped querySelector, and a null from it would look exactly
     like a missing quote. */
  const planHtml = vm.runInContext(`document.getElementById('coverage-spend-plan').innerHTML`, rendered.context);
  const shown = {
    html: planHtml,
    kind: (planHtml.match(/data-coverage-price-kind="([a-z]+)"/) || [])[1] || null,
    amount: (planHtml.match(/data-coverage-price-amount="([0-9.]+)"/) || [])[1] || null,
  };

  /* The bounded quantity this dialog prices: one request per missing required
     slot, three images each — computed here from the owner, not copied. */
  const missing = vm.runInContext(
    `__CINEBRAID_COVERAGE_AUTOMATION.missingCoverageWork('characters',P.characters.find(x=>x.id==='CHAR-IREN'),'angles').length`,
    rendered.context);
  ok(missing > 0, "baseline: there is missing required coverage work to price");
  const owner = Rate.generationPriceLine({
    rate: Rate.configuredImageRate({ generation: { fal: { estimatedCostPerImage: 0.04 } } }),
    quantity: missing * 3,
    local: false,
  });
  eq(shown.kind, "estimated", "a configured rate must produce a priced quote");
  eq(Number(shown.amount), owner.amount,
    "the rendered coverage quote must equal the existing rate owner's answer for the same bounded work");
  ok(shown.html.includes(owner.headline), "the quote must print the owner's own headline");

  /* An unconfigured rate says so rather than guessing. */
  vm.runInContext(`delete CONFIG.generation.fal.estimatedCostPerImage; updateCoverageAutomationPlan();`, rendered.context);
  const unpricedHtml = vm.runInContext(`document.getElementById('coverage-spend-plan').innerHTML`, rendered.context);
  const unpriced = (unpricedHtml.match(/data-coverage-price-kind="([a-z]+)"/) || [])[1] || "";
  eq(unpriced, "unavailable", "with no configured rate the quote must say unavailable, never a guessed number");
}

/* 4 — USE AS SHEET SOURCE MOVES NO IDENTITY. */
async function testSheetSourceLeavesPrimaryUntouched() {
  const project = gateFixture();
  const rendered = await render("#/character/CHAR-IREN", project, { scan: gateScan() });
  rendered.context.approveEntityFile("characters", "CHAR-IREN", "CHAR-IREN-SHEET.png", "state-default");
  vm.runInContext(`document.getElementById('entity-approve-file').value='CHAR-IREN-SHEET.png';
    document.getElementById('entity-approve-target').value='state-default';
    document.getElementById('entity-approve-name').value='CHAR-IREN-SHEET.png';
    document.getElementById('entity-approve-next').value='';`, rendered.context);
  await rendered.gesture.act(() => rendered.context.confirmEntityApproval(false));
  await new Promise((resolve) => setTimeout(resolve, 80));

  const state = vm.runInContext(
    `(() => { const e=P.characters.find(x=>x.id==='CHAR-IREN');
       const row=(e.candidateFiles||[]).find(r=>(r.stored||r.name)==='CHAR-IREN-SHEET.png')||{};
       const truth=entityProductionTruth(P,'characters','CHAR-IREN');
       return { approved: e.approvedFile, decision: row.decision,
                canon: truth.canon.map(c=>c.value) }; })()`,
    rendered.context);
  eq(state.approved, "CHAR-IREN-PRIMARY.png", "accepting a sheet source leaves the existing primary pointer alone");
  assert.deepStrictEqual(Array.from(state.canon), ["CHAR-IREN-PRIMARY.png"],
    "and leaves the existing canon receipt pointing where it did");
  checks++;
  eq(state.decision, "approved-sheet-source", "the sheet is recorded as an accepted SOURCE artifact");
}

async function main() {
  testStructuralClassification();
  testFilenameHeuristicIsGoneAndWasWrongBothWays();
  testManualIntakeDeclaresStructure();
  testImportedMappingIsReadAsEvidence();
  testTheBoundaryRefusesASheet();
  testUnresolvableClassifierFailsClosed();
  await testExistingBadPrimaryIsReportedNotRevoked();
  await testHealthyPrimaryReportsNoCorrection();
  await testCoverageBoardRendersFourStates();
  await testBareSelectionDoesNotCommit();
  await testSheetSourceIsNotIdentityApproval();
  await testExplicitUseNeedsNoSecondConfirmation();
  await testVisualChooserSelectsWithoutWriting();
  await testCoverageQuoteMatchesTheRateOwner();
  await testSheetSourceLeavesPrimaryUntouched();
  console.log(`Reference truth + sheet gate suite passed ${checks} checks across structural classification, the authority boundary, detect-and-tell, four-state coverage, non-committing selection and the coverage quote. Provider calls made: 0.`);
}

main().catch((error) => { console.error(error); process.exit(1); });

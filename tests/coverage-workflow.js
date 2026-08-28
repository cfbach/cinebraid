const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { render, buildFixture, withCanon } = require("./render-harness");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function coverageFixture() {
  const project = buildFixture();
  const character = project.characters[0];
  character.id = "CHAR-IREN";
  character.name = "Iren";
  character.approvedFile = "CHAR-IREN-PRIMARY.png";
  character.continuityStates = [{ id: "state-default", name: "Default", isDefault: true, approvedFile: "CHAR-IREN-PRIMARY.png", notes: "Primary identity." }];
  character.candidateFiles = [{
    stored: "CHAR-IREN-SHEET.png",
    original: "CHAR-IREN-SHEET.png",
    decision: "unreviewed",
    coverageJobType: "sheet",
    coverageSheetType: "angles",
    generationProvider: "fal",
    structuredReviews: {
      "state-default": { contractVersion: "reference-authority-v3", score: 87, pass: true, stateName: "Default", reviewedAt: "2026-07-29T20:00:00Z", summary: "Consistent four-view sheet." },
    },
  }];
  project.shots[0].characters = [character.id];
  /* Coverage automation runs off CANON, not off a raw pointer. Before the
     simplification pass `entity.approvedFile` alone was enough, and the Dogfood
     #2 audit used exactly that to send an unreceipted LEGACY.png out as this
     entity's identity authority. A fixture that wants automation available has
     to say the creator approved the primary, because that is what a real project
     says. */
  return withCanon(project, {
    kind: "entity-state", list: "characters", entityId: character.id, stateId: "state-default",
    value: "CHAR-IREN-PRIMARY.png",
  });
}

function coverageScan() {
  return {
    anchors: [
      { name: "CHAR-IREN-PRIMARY.png", url: "/assets/anchors/CHAR-IREN-PRIMARY.png" },
      { name: "CHAR-IREN-SHEET.png", url: "/assets/anchors/CHAR-IREN-SHEET.png" },
    ],
    plates: [], props: [], vehicles: [], audio: [], media: [],
    shots: { "L1-01": { takes: [{ name: "FRAME_A.png", url: "/assets/shots/L1-01/takes/FRAME_A.png" }, { name: "FRAME_B.png", url: "/assets/shots/L1-01/takes/FRAME_B.png" }], locked: [] } },
  };
}

async function testRenderedCoverageControls() {
  const project = coverageFixture();
  const rendered = await render("#/character/CHAR-IREN", project, { scan: coverageScan(), storage: { "cinebraid-focused:fixture:entity-task:characters:CHAR-IREN": "candidates" } });
  assert.strictEqual(typeof rendered.context.openCoverageAutomationModal, "function", "coverage automation must be loaded by the browser bot harness");
  assert(rendered.html.includes("entity-ai-score-overlay"), "candidate thumbnail must render a prominent review score overlay");
  assert(rendered.html.includes("<b>87</b>"), "review score must be readable on the thumbnail");
  assert(rendered.html.includes("USE AS SHEET SOURCE"), "coverage sheets must expose a deliberate human sheet-source action instead of generic approval");
  rendered.context.openEntityCandidateReview("characters", "CHAR-IREN", "CHAR-IREN-SHEET.png", "state-default");
  const reviewModal = rendered.context.document.getElementById("modal").innerHTML;
  assert(reviewModal.includes("SHEET REVIEW"), "sheet candidates must use a sheet-specific review flow");
  assert(reviewModal.includes("USE AS SHEET SOURCE"), "sheet review must allow deliberate human designation before extraction");
  assert(!reviewModal.includes("APPROVE FOR DEFAULT"), "sheet review must not encourage assigning the whole sheet as one continuity-state image");
  rendered.context.openCoverageSheetExtractor("characters", "CHAR-IREN", "CHAR-IREN-SHEET.png");
  const extractor = rendered.context.document.getElementById("modal").innerHTML;
  assert(extractor.includes("SAVE CROP & NEXT ANGLE"), "crop workflow must support saving and moving to the next angle");
  assert(extractor.includes("SAVE CROP & CLOSE"), "crop workflow must also allow a deliberate exit");
  assert(extractor.includes("Review is optional"), "crop extraction must explain optional review and human approval");
  assert(!/id="coverage-crop-approve"[^>]*checked/.test(extractor), "direct crop approval must be opt-in, not the default");
}

async function testCoverageSubmissionAndPersistentOpenState() {
  const project = coverageFixture();
  let submitted = null;
  const rendered = await render("#/character/CHAR-IREN", project, {
    scan: coverageScan(),
    storage: { "cinebraid-focused:fixture:entity-task:characters:CHAR-IREN": "coverage" },
    fetch: async (url, options, respond) => {
      if (url === "/api/generation/fal/status") return respond({ enabled: true, configured: true, textModel: "fal-ai/gpt-image-2/text-to-image", editModel: "fal-ai/gpt-image-2/edit", defaults: {} });
      /* Coverage dispatch is a SERVER operation now: the browser asks
         /api/generation/fal/coverage/jobs to run it, and that route establishes the run
         record and dispatches through the one paid boundary with its own context. The
         browser no longer posts to the paid route directly and no longer claims a
         surface. */
      if (url === "/api/generation/fal/coverage/jobs" && options.method === "POST") {
        submitted = JSON.parse(options.body);
        return respond({ ok: true, job: { id: "coverage-job-1", purpose: "entity-reference", entityList: "characters", entityId: "CHAR-IREN", coverageJobType: "sheet", coverageSheetType: "angles", status: "IN_QUEUE", outputCount: 1, model: "GPT Image 2" } });
      }
      if (url === "/api/generation/fal/jobs/coverage-job-1/refresh") return respond({ ok: true, job: { id: "coverage-job-1", purpose: "entity-reference", status: "IN_QUEUE", outputCount: 1 } });
      return null;
    },
  });
  vm.runInContext(`CONFIG.generation=CONFIG.generation||{}; CONFIG.generation.fal=CONFIG.generation.fal||{}; CONFIG.generation.fal.enabled=true; CONFIG.generation.fal.apiKey='test-key'; pollFalGeneration=()=>{};`, rendered.context);
  rendered.context.openCoverageAutomationModal("characters", "CHAR-IREN", "hybrid");
  rendered.context.document.getElementById("coverage-mode").value = "hybrid";
  rendered.context.document.getElementById("coverage-sheet-type").value = "angles";
  rendered.context.document.getElementById("coverage-resolution").value = "4k";
  rendered.context.document.getElementById("coverage-output-count").value = "1";
  rendered.context.document.getElementById("coverage-direction").value = "Keep the orange suit identical.";
  rendered.context.updateCoverageAutomationPlan();
  assert(rendered.context.document.getElementById("coverage-spend-plan").innerHTML.includes("paid request"), "coverage planner must disclose paid request fan-out");
  await rendered.context.startCoverageAutomation();
  assert(submitted, "coverage automation must submit a provider job");
  assert.strictEqual(submitted.purpose, "entity-reference", "coverage work must never masquerade as candidate correction");
  assert.strictEqual(submitted.sourceCandidate, "CHAR-IREN-PRIMARY.png", "coverage edit/reference jobs must record the approved source explicitly");
  assert(submitted.clientRequestId, "coverage paid work must include a client idempotency key");
  assert.strictEqual(submitted.references[0].url, "/assets/anchors/CHAR-IREN-PRIMARY.png", "the primary reference must be the edit/reference authority");
  assert.strictEqual(rendered.context.workspaceSectionOpen("entity:characters:CHAR-IREN:coverage-board", false), true, "coverage board must remain open while generation is running");
}

async function testSheetApprovalDoesNotSeedAngleAndRemainsExtractable() {
  const project = coverageFixture();
  const rendered = await render("#/character/CHAR-IREN", project, { scan: coverageScan(), storage: { "cinebraid-focused:fixture:entity-task:characters:CHAR-IREN": "primary" } });
  rendered.context.approveEntityFile("characters", "CHAR-IREN", "CHAR-IREN-SHEET.png", "state-default");
  rendered.context.document.getElementById("entity-approve-file").value = "CHAR-IREN-SHEET.png";
  rendered.context.document.getElementById("entity-approve-target").value = "state-default";
  rendered.context.document.getElementById("entity-approve-name").value = "CHAR-IREN-SHEET.png";
  rendered.context.document.getElementById("entity-approve-next").value = "";
  await rendered.gesture.act(() => rendered.context.confirmEntityApproval(false));
  await delay(80);
  const state = vm.runInContext(`(() => { const e=P.characters.find((item)=>item.id==='CHAR-IREN'); const assigned=(ensureCoverageSlots('characters',e)||[]).filter((slot)=>slot.approvedFile); const row=(e.candidateFiles||[]).find((item)=>(item.stored||item.name)==='CHAR-IREN-SHEET.png')||{}; return {approved:e.approvedFile, decision:row.decision, assigned:assigned.map((slot)=>({id:slot.id,file:slot.approvedFile}))}; })()`, rendered.context);
  /* THIS ASSERTION USED TO READ THE OTHER WAY, and it was reading the defect.
     It required `e.approvedFile === "CHAR-IREN-SHEET.png"` — i.e. that accepting
     a turnaround as an EXTRACTION SOURCE moved the character's primary identity
     pointer onto a six-panel image. The row was filed `approved-sheet-source` in
     the same gesture, so the project recorded two contradictory statements and
     this suite pinned the false one.
     A sheet source is a source. The primary the reference already had is still
     its primary, and the sheet is recorded as what it is. */
  assert.strictEqual(state.approved, "CHAR-IREN-PRIMARY.png", "accepting a sheet as an extraction source must leave the existing primary identity reference untouched");
  assert.notStrictEqual(state.approved, "CHAR-IREN-SHEET.png", "a multi-view sheet must never become the entity's primary identity pointer");
  assert.strictEqual(state.decision, "approved-sheet-source", "the sheet must still be recorded as an accepted source artifact");
  assert.strictEqual(state.assigned.length, 0, "a whole sheet must not be auto-seeded into a single angle slot");
  rendered.context.localStorage.setItem("cinebraid-focused:fixture:entity-task:characters:CHAR-IREN", "approved");
  await rendered.context.route();
  const html = rendered.context.document.getElementById("main").innerHTML;
  /* These two used to look for "MULTI-VIEW SHEET" and "EXTRACT VIEWS", which are
     rendered by entityAuthoritySummaryMarkup — the CANON IMAGES strip. They
     matched only because the sheet had become the default state's approved file,
     i.e. the very defect above. The sheet does not go there any more, so the
     question "is it still clearly identified and still extractable" is asked
     where the sheet actually lives: its candidate card. */
  assert(html.includes("COVERAGE SHEET"), "an accepted sheet source must still be clearly identified as a sheet");
  assert(html.includes("is-coverage-sheet"), "the sheet's card must carry its structural class");
  assert(html.includes("USE AS SHEET SOURCE"), "an accepted sheet must remain routable into the extractor");
  assert(!/NEEDS CORRECTION/.test(html), "a sheet that was never made canon must not report a correction against the entity");
}

async function testLegacyFailureGroupingAndOpaqueUI() {
  const project = coverageFixture();
  const rendered = await render("#/character/CHAR-IREN", project, { scan: coverageScan(), storage: { "cinebraid-focused:fixture:entity-task:characters:CHAR-IREN": "candidates" } });
  vm.runInContext(`AUTOMATION_RUNS=[1,2,3,4,5,6].map((n)=>({id:'legacy-'+n,type:'scene-chain',targetId:'SC-01',label:'The Repair correction',status:'failed',stage:'Needs attention',updatedAt:'2026-07-29T20:0'+n+':00Z',steps:{['step-'+n]:{key:'step-'+n,kind:'generation',status:'failed',error:'Correction generation requires sourceCandidate provenance.'}}})); V641_ACTIVITY_DRAWER_OPEN=true; v641RenderActivityDrawer();`, rendered.context);
  const drawer = rendered.context.document.getElementById("automation-activity-drawer").innerHTML;
  assert(drawer.includes("PREVIOUS FAILURES / NEEDS ATTENTION"), "drawer must distinguish previous failures from the active job");
  assert(drawer.includes("×6"), "identical legacy failures must be grouped instead of flooding the drawer");
  assert.strictEqual((drawer.match(/The Repair correction/g) || []).length, 1, "grouped legacy failures should render as one card");
  const css = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");
  assert(css.includes(".modal-box:has(.coverage-automation-modal)"), "coverage automation must expand the actual modal shell, not overflow a narrow box");
  assert(css.includes("rgb(21 24 27 / .985)"), "global activity drawer must use an opaque background layer");
}


async function testCoverageMigrationAndExpressionReconciliation() {
  const project = coverageFixture();
  delete project.characters[0].coverageSlots;
  project.characters[0].expressionSlots = [{ id: "neutral", label: "Neutral", required: true, approvedFile: "neutral.png" }, { id: "obsolete", label: "Obsolete", required: true, approvedFile: "obsolete.png" }];
  project.characters[0].expressions = "Neutral; Happy";
  const rendered = await render("#/character/CHAR-IREN", project, { scan: coverageScan(), storage: { "cinebraid-focused:fixture:entity-task:characters:CHAR-IREN": "coverage" } });
  const result = vm.runInContext(`(() => { delete P.characters[0].coverageSlots; SAVE_REVISION=0; const changed=normalizeProjectV5(); if(changed) dirty(); const e=P.characters[0]; return {changed,rev:SAVE_REVISION,coverage:e.coverageSlots.length,active:e.expressionSlots.filter(x=>!x.retired).map(x=>x.label),retired:e.expressionSlots.filter(x=>x.retired).map(x=>x.label)}; })()`, rendered.context);
  assert.strictEqual(result.changed, true, "legacy coverage schema must be migrated explicitly");
  assert(result.rev > 0, "a real migration must schedule one project save");
  assert(result.coverage >= 4, "coverage slots must be created by migration");
  assert.deepStrictEqual(Array.from(result.active), ["Neutral", "Happy"], "active expression slots must match the current imported expression list");
  assert(result.retired.some((label) => label.includes("Obsolete")), "approved stale expressions must be retired rather than silently deleted");
}


async function testPrimaryReferenceNeverSilentlyBecomesThreeQuarter() {
  const project = coverageFixture();
  const character = project.characters[0];
  character.approvedFile = "";
  character.continuityStates = [
    { id: "state-default", name: "Clean overall", isDefault: true, approvedFile: "", notes: "Primary identity." },
    { id: "state-night", name: "After the night's work", isDefault: false, approvedFile: "", parentStateId: "state-default", notes: "Coveralls are dirty and worn; hands are bare. Preserve face, proportions, hair and base garment construction." },
  ];
  character.coverageSlots = [];
  character.candidateFiles = [{ stored: "CHAR-IREN-PRIMARY.png", original: "CHAR-IREN-PRIMARY.png", decision: "unreviewed", coverageJobType: "single-reference" }];
  const rendered = await render("#/character/CHAR-IREN", project, {
    scan: coverageScan(),
    storage: { "cinebraid-focused:fixture:entity-task:characters:CHAR-IREN": "states", "cinebraid-bounded:fixture:selected:continuity-state:characters:CHAR-IREN": "state-night" },
  });
  rendered.context.approveEntityFile("characters", "CHAR-IREN", "CHAR-IREN-PRIMARY.png", "state-default");
  rendered.context.document.getElementById("entity-approve-file").value = "CHAR-IREN-PRIMARY.png";
  rendered.context.document.getElementById("entity-approve-target").value = "state-default";
  rendered.context.document.getElementById("entity-approve-name").value = "CHAR-IREN-PRIMARY.png";
  rendered.context.document.getElementById("entity-approve-next").value = "";
  await rendered.gesture.act(() => rendered.context.confirmEntityApproval(false));
  await delay(60);
  const state = vm.runInContext(`(() => { const e=P.characters.find((item)=>item.id==='CHAR-IREN'); return { approved:e.approvedFile, assigned:(ensureCoverageSlots('characters',e)||[]).filter((slot)=>slot.approvedFile).map((slot)=>slot.id), angle:e.primaryAngleAssignment }; })()`, rendered.context);
  assert.strictEqual(state.approved, "CHAR-IREN-PRIMARY.png", "primary identity approval must still succeed");
  assert.deepStrictEqual(Array.from(state.assigned), [], "a primary character reference must not silently become Front, 3/4, Profile or Rear");
  assert.strictEqual(state.angle.status, "unassigned", "primary approval should explicitly record that angle assignment remains unresolved");

  rendered.context.seedCoverageFromPrimary("characters", "CHAR-IREN");
  const modal = rendered.context.document.getElementById("modal").innerHTML;
  assert(modal.includes("No automatic guess"), "manual primary-to-angle assignment must explain that CineBraid does not infer 3/4 silently");
  assert(modal.includes("Choose an angle"), "manual assignment must require an explicit angle choice");
}

async function testLegacySilentThreeQuarterMigrationAndStateVariantFlow() {
  const project = coverageFixture();
  const character = project.characters[0];
  character.continuityStates = [
    { id: "state-default", name: "Clean overall", isDefault: true, approvedFile: "CHAR-IREN-PRIMARY.png", notes: "Primary identity." },
    { id: "state-night", name: "After the night's work", isDefault: false, approvedFile: "", parentStateId: "state-default", notes: "Dirty worn coveralls and bare hands. Preserve identity, hair, body proportions and base garment construction." },
  ];
  character.coverageSlots = [{ id: "front-three-quarter", label: "3/4 front", required: true, approvedFile: "CHAR-IREN-PRIMARY.png", notes: "Automatically seeded from the first approved primary reference.", status: "approved", provenance: { source: "primary-approved-reference" } }];
  const rendered = await render("#/character/CHAR-IREN", project, {
    scan: coverageScan(),
    storage: { "cinebraid-focused:fixture:entity-task:characters:CHAR-IREN": "states", "cinebraid-bounded:fixture:selected:continuity-state:characters:CHAR-IREN": "state-night" },
  });
  /* This used to assert that opening the project cleared the slot. It did, and
     that was the defect: a project became less complete for having been
     opened, before the filmmaker was ever asked. The condition is real — an
     angle nobody chose is not an authority — but correcting it belongs to an
     explicit migration, not to a read. So the approval is now preserved and
     the condition is reported instead. See tests/intent-loss-safety.js. */
  const migrated = vm.runInContext(`(() => { const e=P.characters.find((item)=>item.id==='CHAR-IREN'); const slot=(ensureCoverageSlots('characters',e)||[]).find((item)=>item.id==='front-three-quarter'); return {file:slotSelectedFile(slot), legacyKey:slot.approvedFile, status:slot.status, history:e.coverageMigrationHistory||[], warnings:(P.meta.dataIntegrityWarnings||[])}; })()`, rendered.context);
  assert.strictEqual(migrated.file, "CHAR-IREN-PRIMARY.png", "opening a project must not clear a legacy auto-seeded angle assignment");
  /* CHANGED IN THE SIMPLIFICATION PASS — the FIELD moved, the VALUE did not.
     A slot holds its file under `selectedFile` now. `approvedFile` put the word
     "approved" in front of every consumer of a supporting reference, and the
     Library and coverage automation duly concluded approval from it. Carrying
     the value across on load is a rename, not a migration: no media is touched,
     no history is dropped, and the assertion above proves the value survived. */
  assert.strictEqual(migrated.legacyKey, undefined, "a normalised slot carries no approvedFile — the value moved to selectedFile");
  /* CHANGED IN BATCH 1C — "approved" -> "selected".

     THE OLD ASSERTION DID NOT MEAN WHAT IT SAID. This fixture's slot carries no
     `status` key at all, so there was never a stored status to keep: the word
     was DERIVED on load by the normaliser, before and after this change. What
     the assertion actually pinned was the derivation.

     And the derivation is the thing Batch 1C corrected. It produced "approved"
     on every project load, which silently reverted any slot a routed writer had
     correctly saved as a selection. This fixture is the sharpest illustration
     of why it was wrong: the very next assertion requires a warning saying this
     angle was filled in automatically and NOT CHOSEN — while the status beside
     it read "approved".

     THE PROPERTY THIS TEST EXISTS FOR IS UNCHANGED and still asserted: the
     filename survives the load untouched, no migration history is written, and
     the legacy condition is reported rather than silently corrected. */
  assert.strictEqual(migrated.status, "selected", "a preserved assignment is a supporting-reference selection, never a derived approval");
  assert.deepStrictEqual(Array.from(migrated.history), [], "a load must not record a migration it did not perform");
  assert(migrated.warnings.some((row) => /automatically|not chosen/i.test(row) && row.includes("CHAR-IREN-PRIMARY.png")), "the legacy condition must be reported rather than silently corrected");

  const html = rendered.context.document.getElementById("main").innerHTML;
  assert(html.includes("GENERATE FROM CLEAN OVERALL"), "empty alternate-state cards must provide a direct generation action");
  assert(html.includes("UPLOAD STATE REFERENCE"), "empty alternate-state cards must provide a targeted upload path");
  assert.strictEqual(typeof rendered.context.openContinuityStateVariantHub, "function", "the Reference workspace must retain the state-variant chooser");

  rendered.context.openContinuityStateVariantHub("characters", "CHAR-IREN");
  const hub = rendered.context.document.getElementById("modal").innerHTML;
  assert(hub.includes("After the night&#39;s work") || hub.includes("After the night's work"), "state-variant hub must list the imported alternate state");
  assert(hub.includes("Dirty worn coveralls and bare hands"), "state-variant hub must show the exact state delta before generation");
  assert(hub.includes("CHAR-IREN-PRIMARY.png"), "state-variant hub must show the approved parent authority");

  rendered.context.openContinuityStateVariant("characters", "CHAR-IREN", "state-night");
  await delay(180);
  const variant = vm.runInContext(`(() => { const e=P.characters.find((item)=>item.id==='CHAR-IREN'); const s=e.continuityStates.find((item)=>item.id==='state-night'); return {mode:s.generationMode,parent:s.parentStateId}; })()`, rendered.context);
  assert.strictEqual(variant.mode, "derive", "alternate costume/state generation must default to a parent edit");
  assert.strictEqual(variant.parent, "state-default", "alternate state must derive from the approved default state");
  assert.strictEqual(rendered.context.localStorage.getItem("cinebraid-focused:fixture:entity-task:characters:CHAR-IREN"), "coverage", "opening a state variant must synchronize the consolidated Coverage & states workspace");
  assert.strictEqual(rendered.context.localStorage.getItem("cinebraid-bounded:fixture:selected:entity-coverage-view:characters:CHAR-IREN"), "states", "opening a state variant must select the Continuity states subworkspace");
}

async function main() {
  await testPrimaryReferenceNeverSilentlyBecomesThreeQuarter();
  await testLegacySilentThreeQuarterMigrationAndStateVariantFlow();
  await testCoverageMigrationAndExpressionReconciliation();
  await testRenderedCoverageControls();
  await testCoverageSubmissionAndPersistentOpenState();
  await testSheetApprovalDoesNotSeedAngleAndRemainsExtractable();
  await testLegacyFailureGroupingAndOpaqueUI();
  console.log("Coverage workflow bot suite passed explicit primary-angle assignment, legacy silent-angle repair, state-variant navigation, parent-derived state generation, migration, expression reconciliation, paid-request planning/idempotency payloads, crop review gates, sheet review, and persistent sections.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});

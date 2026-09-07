/* REFERENCE WORKFLOW COHERENCE V2 — the Last Seat dogfood defects, as properties.
 *
 * Real production dogfood on The Last Seat's Folding Chair exposed one cluster of
 * defects across a single seam: reference creation → Braidy automation →
 * generation → returned candidates → review → approval → the next continuity
 * state. Each check below fixes one of those defects in place so it cannot come
 * back, and every one of them is written from what the dogfood actually showed
 * rather than from the shape of the fix.
 *
 * The dogfood facts these are derived from:
 *
 *   W2/W17  Vision was deliberately OFF. The run still issued one review request
 *           per candidate, each refused, and reported
 *           "Entity candidate reviewer failed after 3 attempts: Vision assistance
 *           is disabled." — a retry count for a retry that never happened — then
 *           rendered the gate as "FLAGGED BY AI REVIEW" and counted the run under
 *           "1 need attention".
 *   W3      The Braidy gate and "Images waiting for your decision" both rendered
 *           the same three candidates with the same approval controls.
 *   W5      Approving Default left a "HUMAN REVIEW REQUIRED" gate on screen.
 *   W6      Stepping candidate 1→2→3 replayed the dialog entrance animation.
 *   W7      A collapsed manual section offered "Hide manual controls", and opening
 *           it moved the viewport.
 *   W9      A prop with two continuity states offered a continuation selector
 *           containing only "Approve only" beside a disabled APPROVE & EDIT NEXT
 *           STATE.
 *   W11/W12 "Unfolded for game night" recorded no source state, so its generation
 *           fell back to independent text-to-image instead of editing the approved
 *           Default image.
 *   W16     The chair's authored material truth must survive compilation.
 *   W18     "Identity / design authority" led with fourteen import identifiers.
 *
 * NOTHING IS WRITTEN TO DISK, no provider is contacted and no generation is
 * started. Source-level checks read the shipped files; behavioural checks drive
 * the shipped functions in the render harness.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { render, buildFixture, withCanon } = require("./render-harness.js");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const notes = [];
function ok(condition, message) {
  assert.ok(condition, message);
  notes.push(message);
}
const source = (file) => fs.readFileSync(path.join(PUBLIC, file), "utf8");
const serverSource = () => fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
/* Comments state intent, and intent is not behaviour. Every source-level check
   below reads code with the commentary stripped, so a sentence in a comment can
   never satisfy an assertion about what the product does. */
const code = (text) => String(text).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ---- W2 / W17 — a capability that is off is not a capability that failed ---- */
function testRefusalCountsWhatItDid() {
  const server = code(serverSource());
  ok(/function assistantAttemptFailure\(/.test(server),
    "W2: the refusal is built in one place, from what the loop actually did");
  ok(!/failed after 3 attempts/.test(server),
    "W2: no refusal hard-codes a retry count it may not have spent");
  ok(/\$\{label\} is unavailable/.test(server),
    "W2: a permanently unavailable capability is reported as unavailable, not as three failures");
  ok(/error\.assistantPermanent = !!permanent/.test(server),
    "W17: the refusal carries whether it was configuration rather than a fault");
  /* C2 corrected WHERE this distinction comes from — configuration rather than
     error permanence — but the invariant W17 protects is unchanged: the endpoint
     still tells the executor which of the two it is looking at. */
  ok(/reviewUnavailableReason: off \? "capability-off" : "review-failed"/.test(server),
    "W17: and the review endpoint passes that distinction to the executor");
  /* Both request helpers must record the real count, or the honest message has
     only half the callers it needs. */
  const attempts = server.match(/attemptsMade = attempt \+ 1;/g) || [];
  ok(attempts.length === 2,
    "W2: both the text and the vision request helper record the attempt they actually made");
}

function testVisionOffSkipsRatherThanFails() {
  const automation = code(source("automation.js"));
  ok(/function v672VisionOffForReview\(\)/.test(automation),
    "W2: the run asks once, before spending anything, whether vision exists");
  ok(/visionIsOff\(capabilityState\("vision"\)\)/.test(automation),
    "W2: and asks it through the shipped predicate the plan already warns from");
  /* The skip must come BEFORE the request loop, or the doomed requests still go
     out. Position is the property here, so position is what is asserted. */
  const guard = automation.indexOf("if (v672VisionOffForReview())");
  const request = automation.indexOf('fetch("/api/llm/review-entity-candidate"');
  ok(guard > 0 && request > 0 && guard < request,
    "W2: the skip is decided before the first review request is issued");
  ok(/reviewSkipped: true/.test(automation) && /reviewSkippedReason: "vision-off"/.test(automation),
    "W2: a skipped review is recorded as skipped, with its reason");
  ok(/reviewUnavailable: false/.test(automation),
    "W2: and is NOT recorded as an unavailable reviewer, which is a different fact");
  ok(/reviewUnavailable \|\| reviewSkipped \? "" :/.test(automation),
    "W2: a pass nobody reviewed buys no correction text");
  ok(/if \(reviewUnavailable \|\| reviewSkipped\) await v627PauseForHumanReview\(/.test(automation),
    "W2: and parks on the human gate rather than generating another pass");
  ok(/const V672_VISION_OFF_NOTE = "Visual review skipped — Vision is off\."/.test(automation),
    "W15: one sentence describes the skip everywhere it is described");
}

/* The severity model, driven rather than read. */
async function testOffIsNotAnErrorState() {
  const rendered = await render("#/production", buildFixture());
  const verdicts = vm.runInContext(`(() => {
    const parked = { id: "r-parked", status: "interrupted", steps: { s: { key: "s", status: "needs-review" } } };
    const died = { id: "r-died", status: "failed", steps: { s: { key: "s", status: "failed" } } };
    const diedNoGate = { id: "r-nogate", status: "interrupted", steps: { s: { key: "s", status: "failed" } } };
    return {
      parkedAttention: v670AttentionRun(parked),
      parkedIsParked: v670RunParkedAtGate(parked),
      diedAttention: v670AttentionRun(died),
      diedNoGateAttention: v670AttentionRun(diedNoGate),
    };
  })()`, rendered.context);
  ok(verdicts.parkedIsParked === true,
    "W17: a step left in needs-review is the mark of a run that stopped by design");
  ok(verdicts.parkedAttention === false,
    "W17: a run parked at a human gate is not counted as needing attention");
  /* THE NEGATIVE HALF, and the reason this reclassification is safe: a run that
     died without ever reaching a gate is still an incident and still red. */
  ok(verdicts.diedAttention === true,
    "W17: a failed run is still attention");
  ok(verdicts.diedNoGateAttention === true,
    "W17: and so is an interrupted run that never reached a human gate");
}

/* ---- W3 / W4 — one canonical candidate surface -------------------------- */
function testGateDoesNotDuplicateTheCandidateArea() {
  const automation = code(source("automation.js"));
  const start = automation.indexOf("function v627HumanReviewMarkup");
  const end = automation.indexOf("function v666RemainingImageBudget");
  const gate = automation.slice(start, end);
  ok(start > 0 && end > start, "W3: the human review gate is present");
  ok(/const entityGate = String\(run\?\.type \|\| ""\) === "entity-chain"/.test(gate),
    "W3: the gate knows whether a canonical candidate area exists to hand off to");
  const summary = gate.slice(gate.indexOf("const count = candidates.length"));
  ok(!summary.includes("approveAutomationCandidate"),
    "W3: an entity gate carries no candidate approval control of its own");
  ok(!summary.includes("automation-review-grid"),
    "W3: and renders no second grid of the candidates already listed below it");
  ok(/revealReturnedCandidates\(/.test(summary),
    "W4: it hands off to the canonical candidate area instead");
  /* THE SCOPE CEILING, ASSERTED. A shot's frame gate has no second list of its
     candidates anywhere, so collapsing it would delete the review rather than
     de-duplicate it — and would reach into the Shot workspace this pass does not
     redesign. */
  const shotShape = gate.slice(gate.indexOf("const gridMarkup"), gate.indexOf("const count = candidates.length"));
  ok(shotShape.includes("HUMAN REVIEW GATE") && shotShape.includes("APPROVE SUGGESTED"),
    "W3: a shot or scene gate keeps the full chooser, which is its only review surface");
}

function testHandoffReusesTheAcceptedMechanism() {
  const automation = code(source("automation.js"));
  const fal = code(source("fal-generation.js"));
  ok(/window\.revealReturnedCandidates = /.test(automation),
    "W4: the run has a way into the canonical candidate area");
  ok(/revealReturnedEntityCandidates\(list, entityId, "", fileName\)/.test(automation),
    "W4: and it is the accepted reveal, not a second scrolling mechanism");
  ok(/window\.revealReturnedEntityCandidates = \(list, entityId, jobId = "", explicitFile = ""\)/.test(fal),
    "W4: which now accepts the exact candidate a gate is handing over");
  ok(/data-candidate-file=/.test(fal) || /entity-candidate-card\[data-candidate-file=/.test(fal),
    "W4: candidate identity is preserved by addressing the card by file");
}

/* ---- W5 — approval recomposes the page --------------------------------- */
function testApprovedGateStopsClaimingAPendingDecision() {
  const automation = code(source("automation.js"));
  ok(/function v672GateAlreadySettled\(run, step\)/.test(automation),
    "W5: the gate can tell whether its question has already been answered");
  ok(/truth\.of\(state\)\.standing === "canon"/.test(automation),
    "W5: answered means a receipted approval, read from the shared projection");
  const settled = automation.slice(automation.indexOf("function v672SettledGateMarkup"), automation.indexOf("function v627HumanReviewMarkup"));
  ok(!settled.includes("HUMAN REVIEW REQUIRED") && !settled.includes("APPROVE THIS"),
    "W5: a settled gate carries no stale review heading and no stale approval control");
  ok(settled.includes("PREVIOUS RUN"),
    "W5: it compacts to a historical summary");
  /* The check must run before the pending furniture is built, or the settled gate
     inherits a pending gate's controls. */
  const body = automation.slice(automation.indexOf("function v627HumanReviewMarkup"));
  ok(body.indexOf("v672GateAlreadySettled") < body.indexOf("const canNextRound"),
    "W5: and is decided before any pending-gate control is composed");
}

/* ---- W6 — the review shell stays mounted ------------------------------- */
function testCandidateNavigationKeepsTheShell() {
  const app = code(source("app.js"));
  const review = code(source("review.js"));
  ok(/function updateOpenModal\(inner\)/.test(app),
    "W6: there is a way to change a dialog's contents without re-opening it");
  ok(/box\.innerHTML = content;/.test(app) && !/m\.innerHTML = .*modal-box.*\n?/.test(app.slice(app.indexOf("function updateOpenModal"), app.indexOf("window.updateOpenModal"))),
    "W6: it replaces the contents and leaves the animated box element mounted");
  ok(/if \(!m \|\| m\.classList\.contains\("hidden"\)\) return false;/.test(app),
    "W6: and refuses when no dialog is open, so it can never become a second opener");
  ok(/const sameReview = !!previous/.test(review) && /previous\.fileName !== fileName/.test(review),
    "W6: candidate review recognises a move to another candidate of the same review");
  ok(/if \(sameReview && typeof updateOpenModal === "function" && updateOpenModal\(markup\)\) return;/.test(review),
    "W6: which updates in place instead of replaying the dialog entrance");
  /* The marker must be read BEFORE it is overwritten, or the comparison is always
     against the candidate being navigated to. */
  const opener = review.slice(review.indexOf("window.openEntityCandidateReview ="));
  ok(opener.indexOf("const previous = window._entityCandidateReview") < opener.indexOf("window._entityCandidateReview = {"),
    "W6: the previous candidate is read before the marker is replaced");
}

/* ---- W7 — one disclosure, one label, no scroll jump -------------------- */
function testManualControlsHaveOneDisclosure() {
  const studio = source("creation-studio.js");
  const card = studio.slice(studio.indexOf("reference-create-section asset-creation-card"), studio.indexOf("window.toggleReferenceManualPath"));
  ok(!/<details class="reference-create-manual"/.test(card),
    "W7: the manual path has no second <details> disclosure");
  ok(!/Describe, prepare, and generate manually/.test(card),
    "W7: and no second summary offering the same content");
  ok(/manualOpen \? "Hide manual controls" : "Show manual controls"/.test(card),
    "W7: the label says Show when closed and Hide when open");
  const toggle = code(studio.slice(studio.indexOf("window.toggleReferenceManualPath")));
  const body = toggle.slice(0, toggle.indexOf("function creationOwnerName"));
  ok(!/scrollIntoView/.test(body),
    "W7: toggling the manual path does not move the viewport");
  ok(/button\.textContent = open \? "Hide manual controls" : "Show manual controls";/.test(body),
    "W7: the label and the panel are written together, so they cannot disagree");
  ok(/rememberWorkspaceSection\(key, open\)/.test(body),
    "W7: and the remembered value is written from the same fact");
  ok(/if \(panel\.contains\(document\.activeElement\)\) button\.focus\(\);/.test(body),
    "W7: collapsing a panel holding focus returns focus to the control");
}

/* ---- W9 — continuation derived from truth ------------------------------ */
async function testContinuationOnlyAppearsWhenValid() {
  const tools = code(source("library-tools.js"));
  /* C7 added the collection argument so the receipt projection can be consulted;
     the invariant is unchanged — the continuation comes from project truth rather
     than from how many states happen to exist. */
  ok(/const continuationTargets = entityApprovalContinuationStates\(x, targetState\.id, list\);/.test(tools),
    "W9: the continuation is derived from the project's own lineage, not from a state count");
  ok(/const continuationField = singleState\n?\s*\? ""/.test(tools) || /continuationField = singleState/.test(tools),
    "W9: a single-state reference still shows no continuation");
  ok(/id="entity-approve-continuation-field" \$\{canContinue \? "" : "hidden"\}/.test(tools),
    "W9: with two states and nowhere to continue, the selector is withdrawn");
  ok(/\$\{canContinue \? "APPROVE ONLY" : "APPROVE"\}/.test(tools),
    "W9: and one real act gets one primary button reading APPROVE");
  ok(/if \(continueAction\) continueAction\.hidden = !canContinueNow;/.test(tools),
    "W9: changing the approval target re-derives the shape in both directions");
  /* W8 IS PRESERVED, and this is the line that says so: a two-state reference must
     never be reduced to a single-state readout by this repair. */
  ok(/const singleState = states\.length <= 1;/.test(tools),
    "W8: the state target selector still appears whenever more than one state exists");
}

/* ---- W11 / W12 — lineage, and what recording it unlocks ---------------- */
async function testLineageConfirmationAndDerivedGeneration() {
  /* The chair as the dogfood left it: Default carrying a RECEIPTED approval, and
     Unfolded declaring a delta with no source recorded. The receipt matters — an
     `approvedFile` pointer alone is `historic`, not canon, and this repair must
     never offer to derive from an image nobody approved. */
  const project = buildFixture();
  project.props = [{
    id: "PROP-CHAIR", name: "Folding Chair", description: "", notes: "",
    approvedFile: "CHAIR_PRIMARY.png", candidateFiles: [], coverageSlots: [],
    continuityStates: [
      { id: "state-default", name: "Default", isDefault: true, approvedFile: "CHAIR_PRIMARY.png", approvedAssetId: "asset-chair" },
      { id: "state-unfolded", name: "Unfolded for game night", isDefault: false, generationMode: "derive", parentStateId: "", notes: "Chair is unfolded and in use." },
    ],
  }];
  withCanon(project, [{ kind: "entity-state", list: "props", entityId: "PROP-CHAIR", stateId: "state-default", value: "CHAIR_PRIMARY.png", assetId: "asset-chair" }]);
  const rendered = await render("#/production", project, {
    scan: { anchors: [], plates: [], vehicles: [], audio: [], media: [], shots: {}, props: [{ name: "CHAIR_PRIMARY.png", url: "/assets/props/CHAIR_PRIMARY.png" }] },
  });
  const result = vm.runInContext(`(() => {
    const entity = P.props.find((row) => row.id === "PROP-CHAIR");
    const before = continuityStateDerivationMarkup("props", entity, entity.continuityStates[1]);
    const beforeDerivation = assetStateDerivation("props", entity, entity.continuityStates[1]);
    entity.continuityStates[1].parentStateId = "state-default";
    const after = continuityStateDerivationMarkup("props", entity, entity.continuityStates[1]);
    const afterDerivation = assetStateDerivation("props", entity, entity.continuityStates[1]);
    const refs = entityGenerationAuthorityRefs("props", entity, entity.continuityStates[1], afterDerivation.mode);
    return {
      beforeSingleSource: before.includes("is-single-source"),
      beforeNamesSource: before.includes("Use Default as source"),
      beforeOffersChange: before.includes("Change source"),
      beforeDerives: beforeDerivation.canDerive,
      beforeMode: beforeDerivation.mode,
      afterMarkupGone: after === "",
      afterDerives: afterDerivation.canDerive,
      afterMode: afterDerivation.mode,
      afterFile: afterDerivation.file,
      promptMode: assetStatePromptMode("props", entity, entity.continuityStates[1]),
      baseRef: refs.find((row) => row.role === "base") || null,
    };
  })()`, rendered.context);

  /* W11 — one approved source is a confirmation, and it is still a confirmation:
     nothing is recorded until the person presses it. */
  ok(result.beforeSingleSource === true,
    "W11: a state with exactly one approved source gets the named confirmation");
  ok(result.beforeNamesSource === true,
    "W11: which names the source rather than asking the filmmaker to find it in a list");
  ok(result.beforeOffersChange === true,
    "W11: and still reaches the full selector, so the simplification is not a trap");
  ok(result.beforeDerives === false && result.beforeMode === "independent",
    "W11: with no source recorded CineBraid does not guess one, and does not derive");

  /* W12 — THE CORE CONTINUITY INVARIANT. Recording the lineage is the whole
     difference between "generate another folding chair from text" and "edit the
     approved folded chair". */
  ok(result.afterMarkupGone === true,
    "W11: a state that records its source no longer asks for one");
  ok(result.afterDerives === true && result.afterMode === "derive",
    "W12: with the source recorded the state derives from its approved parent");
  ok(result.afterFile === "CHAIR_PRIMARY.png",
    "W12: from the parent's approved file specifically");
  ok(result.promptMode === "edit",
    "W12: the prompt is compiled as an image edit, not as text-to-image");
  ok(result.baseRef && result.baseRef.sourceFile === "CHAIR_PRIMARY.png",
    "W12: and the approved parent image travels to generation as the editable base");
}

function testDerivedGenerationSendsTheParentImage() {
  const fal = code(source("fal-generation.js"));
  ok(/role: parentIsCanon \? "base" : "historic-reference"/.test(fal),
    "W12: an approved parent is the base input; an unapproved one is labelled as context");
  ok(/Edit #image1 directly/.test(source("fal-generation.js")),
    "W12: the derived-state prompt edits the parent image rather than describing it");
  ok(/#image1 is the exact editable parent image/.test(source("fal-generation.js")),
    "W12: and the authority contract names it as the thing to preserve");
}

/* ---- W14 — the next required reference is named ------------------------ */
function testNextRequiredReferenceIsSurfaced() {
  const entities = code(source("entities.js"));
  ok(/function entityNextRequiredStateMarkup\(list, entity\)/.test(entities),
    "W14: the reference names the next required state");
  ok(/truth\.of\(primary\)\.standing !== "canon"\) return "";/.test(entities),
    "W14: only once the primary itself is approved, so it never competes with it");
  ok(/referenceRequirement\(state\) === "required"/.test(entities),
    "W14: required means what the project's own requirement reader says it means");
  ok(/revealEntityContinuityState\('\$\{attr\(next\.id\)\}'\)/.test(entities),
    "W14: and offers a direct action instead of a five-step navigation");
}

/* ---- W16 — authored material truth survives into generation ------------ */
/* The dogfood asked whether "dull gray metal" could have been introduced by
   CineBraid. It was not: the controlling source's Section 7 "Canonical design"
   says "dull gray metal" and locked decision N347 records "B — ordinary metal
   folding chair". The propagation is correct end to end, and the beige moulded
   plastic chair is the source's DELIBERATELY WRONG continuity-test candidate.
   What this guards is the invariant that made the answer checkable: the compiler
   may elaborate presentation, and may not contradict an authored material. */
function testCompilerCannotContradictAuthoredMaterial() {
  const fal = source("fal-generation.js");
  ok(/OBJECT\/CONTENT LOCK: preserve exact object shape, crop, proportions, material/.test(fal),
    "W16: a prop's compiled contract locks its material against reinterpretation");
  ok(/materials, wear not named in the delta, and fixed layout—must remain unchanged/.test(fs.readFileSync(path.join(ROOT, "server.js"), "utf8")),
    "W16: and a derived state may change only what its delta names, materials included");
  /* And the authored description reaches generation through ONE resolver, so the
     text a filmmaker reads on the reference is the text the prompt is built from.
     This is what made the chair's material answerable at all: Section 7 of the
     controlling source says "dull gray metal", locked decision N347 records
     "B — ordinary metal folding chair", the entity record repeats it verbatim, and
     the compiled prompt elaborates it ("matte, not shiny") without contradiction —
     while the beige moulded plastic chair, the source's deliberately WRONG
     continuity-test candidate, appears only under EXCLUSIONS. */
  const compiler = fs.readFileSync(path.join(ROOT, "prompt-engine.js"), "utf8");
  ok(/entityVisualDescription/.test(compiler),
    "W16: the compiled prompt is built from the entity's authored design description");
  const shared = code(source("shared-entities.js"));
  ok(/function entityVisualDescription\(entity, kind = ""\)/.test(shared),
    "W16: through one resolver, so no surface can describe a different asset");
  const entities = code(source("entities.js"));
  const inspector = code(source("focused-workspaces.js"));
  ok(/entityVisualDescription\(entity, list\)/.test(entities) && /window\.entityVisualDescription/.test(inspector),
    "W16/W18: and the surfaces that state design authority read that same resolver");
}

/* ---- W18 — authority, notes and provenance are distinguishable --------- */
async function testDetailsHierarchy() {
  const rendered = await render("#/production", buildFixture());
  const split = vm.runInContext(`(() => {
    const notes = "Sections 7, 9, 14, N347, N353, N409. The single most continuity-critical object in the project.";
    return {
      provenance: entityNotesProvenance(notes),
      readable: entityReadableNotes(notes),
      plainUntouched: entityReadableNotes("Folded, carried under one arm."),
      plainHasNoProvenance: entityNotesProvenance("Folded, carried under one arm."),
      midSentenceUntouched: entityNotesProvenance("The chair is battered. Sections 7, 9."),
    };
  })()`, rendered.context);
  ok(split.provenance === "Sections 7, 9, 14, N347, N353, N409.",
    "W18: imported section and decision identifiers are recognised as provenance");
  ok(split.readable === "The single most continuity-critical object in the project.",
    "W18: and the production note reads as a production note");
  /* THE NEGATIVE HALF. This may only move text it can positively identify, or it
     becomes a silent rewriter of authored production content. */
  ok(split.plainUntouched === "Folded, carried under one arm." && split.plainHasNoProvenance === "",
    "W18: ordinary notes are left entirely alone");
  ok(split.midSentenceUntouched === "",
    "W18: and identifiers that are not a leading run are not extracted");

  const entities = code(source("entities.js"));
  ok(/entityAuthorityBlockMarkup\(entity\)/.test(entities) && /Production notes <span>Editable<\/span>/.test(entities),
    "W18: authority is stated above the fields that are the filmmaker's to edit");
  ok(/entityProvenanceBlockMarkup\(list,entity\)/.test(entities),
    "W18: provenance is subordinate to both");
  /* NOTHING IS REWRITTEN. The stored value keeps its whole text; this separation
     is a read. */
  ok(!/notes = entityReadableNotes/.test(entities) && !/\.notes = /.test(code(source("focused-workspaces.js"))),
    "W18: and no stored production note is rewritten to achieve the layout");

  const inspector = code(source("focused-workspaces.js"));
  ok(/function inspectorAuthorityLine\(entity, list = ""\)/.test(inspector),
    "W18: the inspector resolves design authority through one reader");
  ok(/window\.entityVisualDescription\(entity, list\)/.test(inspector),
    "W18: which is the design description, not whichever notes field happens to be set");
  ok(!/entity\?\.driftNotes \|\| entity\?\.block \|\| entity\?\.notes \|\| "No authority note recorded\."/.test(inspector),
    "W18: so an authority panel can no longer lead with fourteen import identifiers");
}

/* ---- W1 — an active run is unmistakably active ------------------------- */
function testActiveRunIsVisible() {
  const activity = code(source("live-activity.js"));
  ok(/window\.v672ActiveRunSurfaceMarkup = \(run\)/.test(activity),
    "W1: a working run has a prominent surface of its own");
  ok(/Safe to leave this page/.test(activity),
    "W1: which says the run survives leaving the page");
  ok(/const V672_STAGE_WORDS = \{/.test(activity),
    "W1: the stages it names are read from the step the run says is current");
  /* NO FABRICATED PROGRESS. A provider that returns when it returns cannot
     honestly be turned into a number, so the surface must contain no percentage
     and no determinate value. */
  const surface = activity.slice(activity.indexOf("const V672_STAGE_WORDS"), activity.indexOf("window.v670CompactRunStatusMarkup"));
  ok(!/%|percent|progress-value|aria-valuenow/i.test(surface.replace(/38%|100%|40%|1\.5s|3px/g, "")),
    "W1: and claims no percentage of a run whose duration it cannot know");
  ok(/const at = Number\(step\?\.attempt \|\| 0\), max = Number\(step\?\.maxAttempts \|\| 0\);/.test(activity)
    && /at > 0 && max > 0 && max >= at \?/.test(activity),
    "W1: a step counter is shown only where the run records both numbers");
  const automation = code(source("automation.js"));
  ok(/const activeSurface = run && typeof v672ActiveRunSurfaceMarkup === "function"/.test(automation),
    "W1: and the reference workspace shows it without the filmmaker searching for it");
}

/* ---- H1 — the derived-state screen leads with the creation task ---------- */
function testDerivedStateLeadsWithCreation() {
  const entities = code(source("entities.js"));
  ok(/const stateAdminMarkup = st && !st\.isDefault/.test(entities),
    "H1: a derived state files its state-management controls under one disclosure");
  ok(/<details class="continuity-state-admin"><summary>State details, requirements and validation<\/summary>/.test(entities),
    "H1: named for what it holds, so nothing is hidden by accident");
  /* NOTHING IS DELETED. The same validation markup and the same applies-to /
     requirement writers are still rendered, just inside the disclosure. */
  /* C10 added state deletion to the same disclosure; validation and the scope
     fields are still there, in the same place, which is what this checks. */
  ok(/<div>\$\{continuityStateValidationMarkup\(list, it, st, media, false\)\}\$\{stateScopeFields\}/.test(entities),
    "H1: parent-to-state validation and the scope fields are still present, one rank down");
  ok(/setContinuityState\('\$\{list\}','\$\{it\.id\}',\$\{selectedIndex\},'appliesTo'/.test(entities)
    && /'referenceRequirement',this\.value/.test(entities),
    "H1: and still write through exactly the writers they wrote through before");
  /* THE DEFAULT STATE IS OUT OF SCOPE AND STAYS FLAT. */
  ok(/: `\$\{continuityStateValidationMarkup\(list, it, st, media\)\}\$\{stateScopeFields\}\$\{stateDeltaField\}`/.test(entities),
    "H1: the Default state keeps the flat composition it shipped with");
  /* ONE DELTA EDITOR. The lead owns it once a source exists; before that the
     standalone field does, because a derived run is refused without a delta. */
  ok(/\$\{stateLeadMarkup\}\$\{stateLeadMarkup \? "" : stateDeltaField\}/.test(entities),
    "H1: exactly one delta editor exists, wherever the task currently is");
  ok(/class="state-source-delta"/.test(entities),
    "H1: and inside the lead it is editable, not a read-only restatement");
  /* The lineage question is the task when it is unanswered, so it is not filed away. */
  ok(/const stateLineagePrompt = st && !st\.isDefault \? continuityStateDerivationMarkup\(list, it, st\) : "";/.test(entities),
    "H1: recording the source stays at full rank, because it is the next task");
}

/* ---- H2 — readable note, subordinate provenance, honest editor ---------- */
async function testNotesSeparateDisplayFromStorage() {
  const app = code(source("app.js"));
  const views = code(source("views.js"));
  ok(/const notesField = \(obj, key, list, id\)/.test(app),
    "H2: notes have a presentation that can separate meaning from imported references");
  ok(/if \(!provenance\) return ta\(obj, key, list, id\);/.test(app),
    "H2: a note with no recognisable prefix is the plain field it always was");
  ok(/class="notes-readable"/.test(app) && /class="notes-provenance"/.test(app),
    "H2: the production meaning reads first and the identifiers are named beneath it");
  ok(/<summary>Edit raw imported note<\/summary>/.test(app),
    "H2: editing the stored value is an explicit act");
  /* THE HONESTY REQUIREMENT. The editor must write the WHOLE stored string, or the
     first edit silently destroys the imported source references. */
  ok(/This edits the whole stored note, including the source references above/.test(app),
    "H2: and says so, rather than implying the field is cleaner than it is");
  ok(/<div><small>[\s\S]{0,200}?<\/small>\$\{ta\(obj, key, list, id\)\}<\/div>/.test(app),
    "H2: the raw editor is the shipped writer over the untouched stored value");
  ok(!/notes-readable[\s\S]{0,400}onchange=/.test(app),
    "H2: the readable summary is read-only, so no edit can write back less than it was given");
  const wired = (views.match(/notesField\([a-z], "notes"/g) || []).length;
  ok(wired === 3,
    "H2: the prop, location and vehicle detail views read it");
}

function testNotesPresentationNeverRewritesStorage() {
  const entities = code(source("entities.js"));
  /* `entityReadableNotes` is a READER. If anything ever assigned its result back to
     the record, the imported source references would be destroyed on first render. */
  ok(!/\.notes\s*=\s*entityReadableNotes/.test(entities) && !/\.notes\s*=\s*entityReadableNotes/.test(code(source("app.js"))),
    "H2: no code path writes the readable remainder back over the stored note");
  ok(!/setVal\([^)]*entityReadableNotes/.test(code(source("app.js"))),
    "H2: and no writer is ever handed the shortened text");
}

/* ---- H3 — after approval, making a primary is not the task -------------- */
function testPrimaryCreationSubordinatesAfterApproval() {
  const studio = code(source("creation-studio.js"));
  ok(/const replaceOnly = !!approved;/.test(studio),
    "H3: the card knows whether a primary has already been approved");
  ok(/<summary>Replace or create another primary reference<\/summary>/.test(studio),
    "H3: and after approval its creation surface becomes a named disclosure");
  ok(/const bodyEnd = replaceOnly \? `<\/div><\/details>` : "";/.test(studio),
    "H3: before approval the surface is exactly what it was, with no disclosure at all");
  /* IT MUST STILL OPEN ITSELF FOR LIVE WORK, or a running Braidy run's status and
     its review handoff — which live inside this card — would be hidden. */
  ok(/const runIsLive = !!run/.test(studio)
    && /v670MachineActiveRun\(run\)/.test(studio)
    && /v670WaitingForHumanRun\(run\)/.test(studio),
    "H3: an active or waiting run still opens it, because its status lives inside");
  /* AND IT MUST NOT open itself for history. `!!run` and `latest` are true forever
     once a reference has been worked on, which is every reference H3 is about. */
  /* C12 changed how live work reaches this decision — it now OUTRANKS the
     remembered preference rather than acting as its fallback. What H3 protects is
     unchanged: history does not hold the card open. */
  ok(/workspaceSectionOpen\(bodyOpenKey, false\)/.test(studio)
    && !/\|\| !!latest \|\| /.test(studio.slice(studio.indexOf("const liveWork"), studio.indexOf("const head ="))),
    "H3: a finished run or a stale prepared prompt does not hold it open");
  ok(/Download approved reference/.test(source("creation-studio.js")),
    "H3: reaching the approved image is not a replacement operation and stays outside");
}

/* ==========================================================================
   ASTRA CLOSURE CORRECTIONS — C2, C3, C5, C7, C10, C12.

   Six defects Astra reproduced against d25b4ce. Each check below is written from
   the reproduction rather than from the repair, so a regression that reintroduces
   the defect fails here even if the code around it is rewritten.
   ========================================================================== */

/* ---- C2 — Vision Off is a configuration fact, not an error classification -- */
function extractServerFunction(name) {
  const src = serverSource();
  const start = src.indexOf("function " + name + "(");
  assert.ok(start >= 0, "server.js defines " + name);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") { depth -= 1; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error("unbalanced " + name);
}
function testVisionOffIsReadFromConfiguration() {
  const server = code(serverSource());
  /* THE FIRST REPRODUCTION: `capability-off` was derived from `assistantPermanent`,
     and "no openai api key" is permanent — so a configured OpenAI vision provider
     with a missing key was reported as switched off. */
  ok(!/reviewUnavailableReason: error\.assistantPermanent \? "capability-off"/.test(server),
    "C2: off-ness is no longer inferred from whether the error was retryable");
  ok(/const off = visionCapabilityIsOff\(\);/.test(server)
    && /reviewUnavailableReason: off \? "capability-off" : "review-failed"/.test(server),
    "C2: it is read from the vision configuration instead");
  ok(/reviewRetryable: !error\.assistantPermanent/.test(server),
    "C2: and retryability is reported separately, because it answers a different question");

  /* THE SECOND REPRODUCTION, and the one this section exists for. The first repair
     asked `agents.models.vision || ollamaVisionModel` — the GENERIC and OLLAMA
     fields. An OpenAI vision provider carrying `openaiVisionModel: "gpt-5.2"` has
     neither set, so a fully selected model read as no model and the same
     misclassification returned through a different wrong field.

     There must be ONE effective provider/model resolution, so the predicate is
     required to reuse the capability reader's, not to grow a second switch. */
  ok(/return !String\(effectiveVisionModel\(cfg\) \|\| ""\)\.trim\(\);/.test(server),
    "C2: the model question is asked of the model that would actually be used");
  ok(/function effectiveVisionModel\(cfg\) \{\s*return effectiveCapabilityModel\(resolvedVisionProvider\(cfg\), cfg, "vision", configuredVisionFallbackModel\(cfg\)\);/.test(server),
    "C2: through the same resolution /api/agents/status resolves vision with");
  ok(/const model = effectiveCapabilityModel\(provider, cfg, kind, ollamaModel\);/.test(server),
    "C2: which is capabilityCheck's own resolution, named rather than duplicated");
  /* NO SECOND PROVIDER SWITCH. `providerCapabilityModel` stays the only place that
     knows which field a given provider keeps its model in, so a provider added
     there is picked up here for free. */
  const namesVisionModelField = (server.match(/cfg\.(?:openai|custom|anthropic)VisionModel/g) || []).length;
  ok(namesVisionModelField === 3,
    "C2: only providerCapabilityModel names a provider's vision-model field, once per provider");
  ok(!/visionCapabilityIsOff[\s\S]{0,600}?ollamaVisionModel/.test(server),
    "C2: and the off test inspects no provider-specific field of its own");

  /* The shipped functions, run over the exact configurations Astra reproduced. */
  const sandbox = vm.createContext({
    readConfig: () => ({}),
    cleanModelName: (m) => String(m || "").trim(),
    exactModelReady: (models, m) => (models || []).includes(String(m || "").trim()),
  });
  vm.runInContext([
    "resolvedVisionProvider",
    "providerCapabilityModel",
    "effectiveCapabilityModel",
    "configuredVisionFallbackModel",
    "effectiveVisionModel",
    "providerConfigured",
    "capabilityCheck",
    "visionCapabilityIsOff",
  ].map(extractServerFunction).join("\n"), sandbox);

  const ollamaDown = { ollama: { ok: false, models: [], base: "http://127.0.0.1:11434" }, custom: {} };
  const ollamaUp = { ollama: { ok: true, models: ["llava:13b"], base: "http://127.0.0.1:11434" }, custom: {} };
  const cases = [
    ["OpenAI with gpt-5.2, a missing key and a blank Ollama model",
      { assistant: { provider: "openai", visionProvider: "openai" }, openaiVisionModel: "gpt-5.2", agents: { models: { vision: "" } }, ollamaVisionModel: "" },
      ollamaDown, false],
    ["OpenAI with no vision model at all",
      { assistant: { provider: "openai", visionProvider: "openai" }, openaiKey: "sk-x", agents: { models: { vision: "" } }, ollamaVisionModel: "" },
      ollamaDown, true],
    ["Ollama with a selected model and an unavailable runtime",
      { assistant: { provider: "ollama", visionProvider: "ollama" }, ollamaVisionModel: "llava:13b", agents: { models: {} } },
      ollamaDown, false],
    ["custom with a selected vision model and an unreachable endpoint",
      { assistant: { provider: "custom", visionProvider: "custom" }, customBaseUrl: "http://127.0.0.1:9/v1", customVisionModel: "qwen-vl", agents: { models: {} } },
      ollamaDown, false],
    ["provider none",
      { assistant: { provider: "openai", visionProvider: "none" }, openaiVisionModel: "gpt-5.2", agents: { models: {} } },
      ollamaDown, true],
    ["fully configured and valid vision",
      { assistant: { provider: "openai", visionProvider: "openai" }, openaiKey: "sk-x", openaiVisionModel: "gpt-5.2", agents: { models: {} } },
      ollamaDown, false],
    ["vision inheriting a none text provider",
      { assistant: { provider: "none", visionProvider: "same" }, agents: { models: { vision: "gpt-4o" } } },
      ollamaDown, true],
    ["Ollama with a selected model, a live runtime and the model installed",
      { assistant: { provider: "ollama", visionProvider: "ollama" }, ollamaVisionModel: "llava:13b", agents: { models: {} } },
      ollamaUp, false],
    ["anthropic with a selected vision model and a missing key",
      { assistant: { provider: "anthropic", visionProvider: "anthropic" }, anthropicVisionModel: "claude-vision", agents: { models: {} } },
      ollamaDown, false],
  ];
  for (const [label, cfg, inventories, expectedOff] of cases) {
    const off = sandbox.visionCapabilityIsOff(cfg);
    ok(off === expectedOff,
      "C2: " + label + " -> " + (expectedOff ? "Off" : "configured, and not called Off"));
    /* THE DEFECT, STATED AS AN INVARIANT. The capability reader also serves a
       configured provider that names no model from the provider default and calls
       it ready, so "off iff the reader says disabled" would be too strong. What
       must never happen is the C2 defect itself: a provider the reader is
       reporting a CONFIGURATION FAULT for being described as switched off. */
    const capability = sandbox.capabilityCheck(
      "Vision assistance",
      sandbox.resolvedVisionProvider(cfg),
      sandbox.configuredVisionFallbackModel(cfg),
      inventories, cfg, "vision",
    );
    const readerReportsProviderFault = /is not configured|is not reachable|is not installed/.test(capability.message);
    ok(!(off && readerReportsProviderFault),
      "C2: " + label + " -> a configuration fault is never reported as Off");
  }
}

/* ---- C3 — the handoff must repaint, not just rewrite stored state --------- */
function testReviewCtaRepaintsTheCandidateArea() {
  const automation = code(source("automation.js"));
  const entities = code(source("entities.js"));
  /* THE REPRODUCTION: it wrote localStorage and scrolled. localStorage is read at
     render time, so from Coverage Views the returned candidates stayed hidden. */
  ok(!/localStorage\.setItem\(entityCandidateFilterKey\(list, entityId\), "primary-state"\)/.test(automation),
    "C3: the handoff no longer writes the filter behind the renderer's back");
  ok(/await setEntityCandidateFilter\(list, entityId, wanted\);/.test(automation),
    "C3: it goes through the canonical filter change, and waits for the repaint");
  ok(/return route\(\);/.test(entities),
    "C3: which returns its render so a caller can wait for it");
  /* The filter is derived from the file being handed over, not assumed. */
  ok(/entityCandidateWorkflowType\(entity, fileName\)/.test(automation),
    "C3: the filter needed to expose the returned file is read from that file");
  ok(/!entityCandidateMatchesFilter\(entity, fileName, current\)/.test(automation),
    "C3: and a filter that already shows it is left alone");
  /* Order and identity stay the candidate area's own — one gallery, not two. */
  ok(/revealReturnedEntityCandidates\(list, entityId, "", fileName\)/.test(automation),
    "C3: the reveal is still the accepted one, so no second gallery is created");
}

/* ---- C5 — a settled gate leaves no pending-review header ------------------ */
function testSettledGateLeavesNoPendingHeader() {
  const automation = code(source("automation.js"));
  ok(/function v672RunGateSettled\(run\)/.test(automation),
    "C5: the panel can ask whether the gate it is wrapping has been answered");
  ok(/const gateSettled = run \? v672RunGateSettled\(run\) : false;/.test(automation),
    "C5: and asks it before choosing header copy");
  /* THE REPRODUCTION: `run.status` is still the literal `awaiting-review` the run
     parked with, and the header read it directly. */
  ok(/gateSettled \? "APPROVAL RECORDED" : v626StatusLabel\(run\)/.test(automation),
    "C5: so a settled run no longer prints HUMAN REVIEW REQUIRED");
  ok(/const outcome = run\?\.summary && !gateSettled/.test(automation),
    "C5: and no longer repeats 'paused before approval' after the approval");
  /* THE RECORD IS NOT REWRITTEN — this is interpretation, not mutation. */
  ok(!/run\.status = "completed"/.test(automation) && !/run\.summary = ""/.test(automation),
    "C5: the stored run keeps the history it holds");
  ok(/v672GateAlreadySettled\(run, step\)/.test(automation),
    "C5: header and gate share one reading of whether the decision is still pending");
}

/* ---- C7 — approved descendants are not remaining work --------------------- */
async function testContinuationExcludesApprovedDescendants() {
  const build = (unfoldedApproved) => {
    const project = buildFixture();
    project.props = [{
      id: "PROP-C7", name: "Chair", candidateFiles: [], coverageSlots: [], approvedFile: "A.png",
      continuityStates: [
        { id: "state-default", name: "Default", isDefault: true, approvedFile: "A.png", approvedAssetId: "as-a" },
        { id: "state-unfolded", name: "Unfolded", isDefault: false, parentStateId: "state-default", approvedFile: unfoldedApproved ? "B.png" : "", approvedAssetId: unfoldedApproved ? "as-b" : "" },
        { id: "state-wet", name: "Wet", isDefault: false, parentStateId: "state-default", approvedFile: "", approvedAssetId: "" },
      ],
    }];
    const rows = [{ kind: "entity-state", list: "props", entityId: "PROP-C7", stateId: "state-default", value: "A.png", assetId: "as-a" }];
    if (unfoldedApproved) rows.push({ kind: "entity-state", list: "props", entityId: "PROP-C7", stateId: "state-unfolded", value: "B.png", assetId: "as-b" });
    withCanon(project, rows);
    return project;
  };
  const ask = async (project, dropWet) => {
    const rendered = await render("#/production", project, {
      scan: { anchors: [], plates: [], vehicles: [], audio: [], media: [], shots: {}, props: [{ name: "A.png", url: "/a.png" }, { name: "B.png", url: "/b.png" }] },
    });
    const drop = dropWet ? 'e.continuityStates = e.continuityStates.filter((s) => s.id !== "state-wet");' : "";
    return vm.runInContext("(() => {"
      + ' const e = P.props.find((x) => x.id === "PROP-C7");'
      + drop
      + " return {"
      + '  offered: entityApprovalContinuationStates(e, "state-default", "props").map((s) => s.name),'
      + '  unfoldedStanding: entityStateTruth("props", e).of(e.continuityStates.find((s) => s.id === "state-unfolded")).standing,'
      + " }; })()", rendered.context);
  };

  const oneUnapproved = await ask(build(false), true);
  ok(oneUnapproved.offered.join(",") === "Unfolded",
    "C7: one unapproved descendant is offered as the continuation");

  const alreadyApproved = await ask(build(true), true);
  ok(alreadyApproved.unfoldedStanding === "canon" && alreadyApproved.offered.length === 0,
    "C7: a descendant already approved for Canon is not offered at all");

  const mixed = await ask(build(true), false);
  ok(mixed.offered.join(",") === "Wet",
    "C7: with several descendants, only the unapproved one is offered");

  const allOpen = await ask(build(false), false);
  ok(allOpen.offered.slice().sort().join(",") === "Unfolded,Wet",
    "C7: and every genuinely unfinished descendant still is");

  const tools = code(source("library-tools.js"));
  ok(/truth\.of\(state\)\.standing !== "canon"/.test(tools),
    "C7: approval is asked of the receipt projection, never of the approvedFile pointer");
  ok(/if \(!truth \|\| truth\.available === false\) return rows;/.test(tools),
    "C7: and nothing is withdrawn when that projection cannot be computed");
}

/* ---- C10 — destructive state administration is subordinate ---------------- */
function testStateDeletionIsFiledUnderAdmin() {
  const entities = code(source("entities.js"));
  ok(!/continuity-state-head-actions[\s\S]{0,1600}?removeContinuityState/.test(entities),
    "C10: deleting a state is no longer a bare glyph in the state header");
  ok(/const stateDeleteMarkup = st && !st\.isDefault/.test(entities),
    "C10: it is built as its own labelled control");
  ok(/\$\{stateScopeFields\}\$\{stateDeleteMarkup\}<\/div><\/details>/.test(entities),
    "C10: and rendered inside the state details / validation disclosure");
  /* SAME HANDLER, SAME SEMANTICS — only its rank moved. */
  const calls = (entities.match(/removeContinuityState\(/g) || []).length;
  ok(calls === 1, "C10: there is exactly one call site, and it is the shipped handler");
  ok(/window\.removeContinuityState = \(list, id, i\)/.test(entities)
    && /planStateDeletion\(x\.continuityStates, state\.id/.test(entities),
    "C10: the deletion planner and its authority withdrawal are untouched");
}

/* ---- C12 — live work outranks a remembered collapsed preference ----------- */
function testLiveWorkForcesTheReplacementDisclosureOpen() {
  const studio = code(source("creation-studio.js"));
  const app = code(source("app.js"));
  /* THE REPRODUCTION: `workspaceSectionOpen(key, fallback)` returns the REMEMBERED
     value whenever one exists, so passing live work as the fallback did nothing for
     a filmmaker who had ever collapsed the card — and a running run's status
     surface was rendered inside closed content. */
  ok(/const bodyOpen = replaceOnly \? \(liveWork \|\| workspaceSectionOpen\(bodyOpenKey, false\)\) : true;/.test(studio),
    "C12: live work opens the section regardless of the remembered preference");
  ok(/data-disclosure-forced="open"/.test(studio),
    "C12: and the render marks it as forced rather than preferred");
  /* The second half of the same defect: a snapshot restorer ran after the render
     and closed it again. */
  ok(/data-disclosure-forced"\) === "open"\) \{ element\.open = true; return; \}/.test(app),
    "C12: so the route disclosure restorer cannot close it a moment later");
  /* AND FORCING MUST NOT REWRITE THE PREFERENCE, or one run silently converts a
     filmmaker's collapsed card into an expanded one for good. */
  ok(/hasAttribute\('data-disclosure-forced'\)\)rememberWorkspaceSection/.test(studio),
    "C12: a forced-open section does not record itself as the filmmaker's choice");
  ok(/const liveWork = !!busy \|\| operation\?\.status === "error" \|\| runIsLive;/.test(studio),
    "C12: live work is an in-flight request, an error to act on, or a run still going");
}

async function main() {
  testRefusalCountsWhatItDid();
  testVisionOffSkipsRatherThanFails();
  await testOffIsNotAnErrorState();
  testGateDoesNotDuplicateTheCandidateArea();
  testHandoffReusesTheAcceptedMechanism();
  testApprovedGateStopsClaimingAPendingDecision();
  testCandidateNavigationKeepsTheShell();
  testManualControlsHaveOneDisclosure();
  await testContinuationOnlyAppearsWhenValid();
  await testLineageConfirmationAndDerivedGeneration();
  testDerivedGenerationSendsTheParentImage();
  testNextRequiredReferenceIsSurfaced();
  testCompilerCannotContradictAuthoredMaterial();
  await testDetailsHierarchy();
  testActiveRunIsVisible();
  testDerivedStateLeadsWithCreation();
  await testNotesSeparateDisplayFromStorage();
  testNotesPresentationNeverRewritesStorage();
  testPrimaryCreationSubordinatesAfterApproval();
  testVisionOffIsReadFromConfiguration();
  testReviewCtaRepaintsTheCandidateArea();
  testSettledGateLeavesNoPendingHeader();
  await testContinuationExcludesApprovedDescendants();
  testStateDeletionIsFiledUnderAdmin();
  testLiveWorkForcesTheReplacementDisclosureOpen();

  console.log(`Reference workflow coherence V2: ${notes.length} checks passed.`);
  for (const note of notes) console.log(`  - ${note}`);
  console.log("Provider calls made: 0. Generations started: 0. Nothing on disk was written.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

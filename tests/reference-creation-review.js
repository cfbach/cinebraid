/* REFERENCE CREATION REVIEW V1 — the dogfood failures, each as its own check.
 *
 * The Last Seat exercised the first real reference-creation loop end to end
 * (Rex Vandar -> Default) and produced a list of things that were true of the
 * shipped product. This suite is that list. Every check below fails on the
 * pre-repair source and passes after it, and each one names the moment in the
 * dogfood it comes from rather than describing a style preference.
 *
 * It renders through the shared harness — the real modules, the real project
 * shape — and touches nothing on disk. No provider is contacted and no
 * generation is started: a completed job is a fixture record, exactly as the
 * one the real run produced looked.
 */
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const vm = require("vm");
const { render, buildFixture } = require("./render-harness.js");

const PUBLIC = path.join(__dirname, "..", "public");
const notes = [];
function ok(condition, message) {
  assert.ok(condition, message);
  notes.push(message);
}
function source(file) {
  return fs.readFileSync(path.join(PUBLIC, file), "utf8");
}

const REX = "CHAR-REX-VANDAR";

/* The Rex the dogfood met: a written visual description, a compiled prompt, and
   the three files FAL returned, none of them decided on. */
function rexFixture({ approved = false, builds = 1, candidates = 3, job = null } = {}) {
  const fixture = buildFixture();
  const rex = {
    id: REX,
    name: "Rex Vandar",
    prefix: REX,
    anchorPrefix: REX,
    visualDescription: "Trashy direct-to-VHS barbarian built on a genuine heroic read.",
    creationDescription: "Trashy direct-to-VHS barbarian built on a genuine heroic read.",
    status: approved ? "APPROVED" : "DRAFT",
    workflowStatus: approved ? "APPROVED" : "IN PROGRESS",
    approvedFile: approved ? `${REX}_FAL_CANDIDATE_1.png` : "",
    approvedAssetId: "",
    continuityStates: [{
      id: "state-default", name: "Default", isDefault: true,
      notes: "Baseline Rex: sunglasses on, sword on back, chair folded under one arm.",
      approvedFile: approved ? `${REX}_FAL_CANDIDATE_1.png` : "",
      approvedAssetId: "", parentStateId: "", generationMode: "independent",
      assetPromptBuilds: [],
    }],
    coverageSlots: [],
    assetPromptBuilds: [],
    candidateFiles: [],
    made: [],
  };
  for (let i = 0; i < builds; i += 1) {
    rex.assetPromptBuilds.push({
      id: `asset-prompt-fixture-${i}`,
      date: "2026-09-06T18:05:00.000Z",
      profileId: "gpt-image-2", profileName: "GPT Image 2 — Text to Image",
      prompt: "PURPOSE\nCreate the production reference sheet for Rex Vandar.",
      llmUsed: false, inputs: {},
    });
  }
  for (let i = 1; i <= candidates; i += 1) {
    rex.candidateFiles.push({
      stored: `${REX}_FAL_CANDIDATE_${i}.png`,
      original: `returned-${i}.png`,
      addedAt: "2026-09-06T18:12:43.067Z",
      decision: "unreviewed",
      generationProvider: "fal",
      generationModel: "openai/gpt-image-2",
      generationJobId: "fal-job-fixture",
      generationRequestId: "01a077eb-b0df-74c2-91a6-0c89dd3f7d7b",
      sourceBuildId: "asset-prompt-fixture-0",
      artifactStructure: "single-reference",
      ownershipClaim: {
        actor: "automation", basis: "generated-for-this-reference",
        via: "entity-reference-generation", at: "2026-09-06T18:12:43.067Z",
      },
    });
  }
  fixture.characters = [rex];
  fixture.__falJobs = job === null ? [] : [job];
  return fixture;
}

const COMPLETED_JOB = {
  id: "fal-job-fixture", purpose: "entity-reference",
  entityList: "characters", entityId: REX,
  status: "COMPLETED", provider: "fal", model: "openai/gpt-image-2", mode: "text-to-image",
  outputCount: 3, externalId: "01a077eb-b0df-74c2-91a6-0c89dd3f7d7b",
  createdAt: "2026-09-06T18:10:00.000Z", updatedAt: "2026-09-06T18:12:43.000Z",
  ingestedAt: "2026-09-06T18:12:43.000Z",
  outputs: [1, 2, 3].map((i) => ({ name: `${REX}_FAL_CANDIDATE_${i}.png` })),
};

async function renderRex(fixture, storage = {}) {
  const view = await render(`#/character/${REX}`, fixture, {
    storage: {
      [`cinebraid-focused:fixture:entity-task:characters:${REX}`]: "primary",
      ...storage,
    },
  });
  /* The harness seeds SCAN.anchors from approvedFile only, so a reference whose
     files are all still CANDIDATES has no media pool and draws no candidate cards.
     The returned files are put into the same pool the product reads, with the same
     shape the server sends — this is the state the dogfood was in. */
  const files = (fixture.characters[0].candidateFiles || []).map((row) => ({
    name: row.stored, url: `/assets/anchors/${row.stored}`,
  }));
  vm.runInContext(
    `SCAN = Object.assign({}, SCAN, { anchors: ${JSON.stringify(files)} });`
    + `FAL_GENERATION_JOBS = ${JSON.stringify(fixture.__falJobs || [])};`,
    view.context,
  );
  await view.context.route();
  return view;
}
const html = (view) => view.context.document.getElementById("main").innerHTML;

/* ------------------------------------------------------------------ R1/R2/R7 */
async function testCreateReferenceIsTheTask() {
  const view = await renderRex(rexFixture({ builds: 0, candidates: 0 }));
  const markup = html(view);

  ok(/<section class="reference-create-section/.test(markup),
    "R1 the Create Reference surface is a top-level section, not a fold inside a fold");
  ok(markup.includes("Create Rex Vandar's primary reference"),
    "R1 it is titled with the task the filmmaker chose, and names the reference");
  ok(markup.includes("You approve the final reference."),
    "R1 and states who holds the decision");

  for (const retired of [
    "CREATE REFERENCE", "Describe the character anchor",
    "Automate the default reference", "Ready to plan an automation run", "AUTOMATE DEFAULT",
  ]) {
    ok(!markup.includes(retired),
      `R1/R7 the internal workflow phrase "${retired}" is no longer shown to the filmmaker`);
  }

  ok(markup.includes("Create with Braidy") && markup.includes("Start Braidy run"),
    "R2 the Braidy path is offered by name");
  ok(markup.includes("Guide it myself"),
    "R2 the manual path is offered as a peer, not as a fallback");
  ok(markup.includes("You make the approval decision"),
    "R2 the Braidy path states where its authority stops");

  /* R7: with no run there is no run status, no resumability copy and no close-tab
     fold — those are answers to a question nobody has asked yet. */
  ok(!markup.includes("What happens if I close this tab?"),
    "R7 close-tab guidance is not shown before a run exists");
  ok(!/class="automation-run-status"/.test(markup),
    "R7 no run status block is drawn for a run that has not been started");
}

/* --------------------------------------------------------------------- R3/R4 */
async function testPromptFollowsTheActionThatMadeIt() {
  const view = await renderRex(rexFixture({ builds: 1, candidates: 0 }));
  const markup = html(view);

  ok(markup.includes("Prepare prompt"), "R3 the action is called Prepare prompt");
  ok(!markup.includes("Build Prompt"), "R3 the ambiguous Build Prompt label is gone");

  /* THE DOGFOOD DEFECT ITSELF: the compiled prompt appeared BELOW the automation
     panel, so the result of pressing a button was separated from the button by
     the largest block on the page. */
  const actions = markup.indexOf('class="creation-actions"');
  const result = markup.indexOf('class="creation-result"');
  const automation = markup.indexOf("automation-inline-card");
  ok(actions >= 0 && result > actions,
    "R3 the prepared prompt renders after the inputs and the action that produced it");
  ok(automation === -1 || automation > result,
    "R3 no automation panel sits between the action and its result");

  ok(markup.includes("Refine with Braidy"),
    "R4 refinement is named for who does it");
  ok(!/>Improve</.test(markup.slice(actions, result)),
    "R4 the ambiguous Improve control is gone from the creation actions");
  ok(markup.includes("Refining with Braidy is optional"),
    "R4 and refinement does not read as a required step before generating");

  /* With nothing compiled there is nothing to refine, so the control is absent
     rather than offered against an invisible object. */
  const empty = await renderRex(rexFixture({ builds: 0, candidates: 0 }));
  ok(!html(empty).includes("Refine with Braidy"),
    "R4 refinement is not offered before there is a prompt to refine");
}

/* --------------------------------------------------------------------- R5/R6 */
async function testBraidyIsTheRunningIdentity() {
  const view = await renderRex(rexFixture({ builds: 1, candidates: 0 }));
  view.context.setGuidedPromptOp("asset", `characters:${REX}`, "", {
    status: "busy", action: "improve", startedAt: Date.now(), activityId: "manual-fixture",
  });
  await view.context.route();
  const markup = html(view);

  ok(!markup.includes("CINEBRAID ASSISTANT"),
    "R5 the retired CineBraid Assistant branding does not appear in the reference flow");
  ok(markup.includes("BRAIDY"), "R5 the running identity is Braidy");
  ok(markup.includes("Braidy is refining Rex Vandar's reference prompt"),
    "R5 the running state names what Braidy is doing and to what");
  ok(markup.includes("Safe to leave or switch workspaces"),
    "R5 leaving is stated as safe, because the dogfood run took 2m33s");
  ok(markup.includes("Some local models take several minutes per attempt"),
    "R5 a slow local model is stated as normal rather than as a fault");
  ok(!/\d+%/.test(markup.slice(markup.indexOf("assistant-working-card"), markup.indexOf("assistant-working-card") + 1200)),
    "R5 no progress percentage is invented");

  /* R6: the dogfood pressed this and landed on the whole-project Reports page. */
  ok(!markup.includes("Activity &amp; reports") && !markup.includes("Activity & reports"),
    "R6 the Reports hand-off is retired");
  ok(markup.includes("View activity"), "R6 the control says what it does");
  ok(markup.includes("openBraidyActivity('manual-fixture')"),
    "R6 and carries this operation's own activity id rather than a page route");

  const studio = source("creation-studio.js");
  ok(/expandTerminal\(activityKey \? `manual:\$\{activityKey\}` : ""\)/.test(studio),
    "R6 it opens the Activity Terminal on this row, through the shipped opener");
  ok(studio.includes('system: "Braidy · Reference prompt refinement"'),
    "R6 the Activity Terminal row leads with the product identity");
  ok(/`\$\{model \? `Running on \$\{model\}\. ` : ""\}/.test(studio),
    "R6 with the model carried as secondary provenance rather than as the identity");
  ok(!/v641StartManualActivity\("LOCAL AI · PROMPT ADVISOR", label/.test(studio),
    "R6 LOCAL AI · PROMPT ADVISOR is no longer the user-facing name of this work");

  const surfaces = source("creator-surfaces.js");
  ok(/\/\^\(run\|manual\|job\):\/\.test\(rawKey\)/.test(surfaces),
    "R6 the Terminal opener can address a manual row, not only a run");

  view.context.setGuidedPromptOp("asset", `characters:${REX}`, "", null);
}

/* ------------------------------------------------------------------------ R12 */
async function testReturnedResultsCannotBeLost() {
  const view = await renderRex(rexFixture({ builds: 1, candidates: 3, job: COMPLETED_JOB }));
  const markup = html(view);

  ok(markup.includes("3 results returned · ready for review"),
    "R12 a finished generation says results are back and ready");
  ok(/Review 3 results/.test(markup),
    "R12 and offers a route to them from where the filmmaker pressed Generate");
  ok(markup.includes(`revealReturnedEntityCandidates('characters','${REX}'`),
    "R12 that route reveals the existing candidate section rather than a second gallery");

  const strip = markup.indexOf("fal-job-strip");
  const candidates = markup.indexOf("entity-candidate-section");
  ok(strip >= 0 && candidates >= 0,
    "R12 the completion strip and the candidate section are both on this page");

  const reveal = source("fal-generation.js");
  ok(reveal.includes("details.entity-candidate-section"),
    "R12 the reveal opens the shipped candidate disclosure");
  ok(/scrollIntoView/.test(reveal.slice(reveal.indexOf("revealReturnedEntityCandidates"))),
    "R12 and scrolls the returned files into view");

  const surfaces = source("creator-surfaces.js");
  ok(surfaces.includes("REVIEW RESULTS"),
    "R12 the Activity Terminal's completion row can reach the returned results too");
  ok(/reveal: job\.purpose === "entity-reference"/.test(surfaces),
    "R12 and only for a reference job that actually delivered something");
}

/* --------------------------------------------------------------- R13/R14/R15 */
async function testCandidateReviewIsTheFirstAction() {
  const view = await renderRex(rexFixture({ builds: 1, candidates: 3, job: COMPLETED_JOB }));
  const markup = html(view);

  const card = markup.slice(markup.indexOf('class="entity-candidate-card'));
  ok(/openEntityCandidateReview\('characters'/.test(card.slice(0, 1400)),
    "R13 the candidate thumbnail opens Candidate Review");
  ok(!/entity-candidate-preview[^>]*openLBMedia/.test(markup),
    "R13 the thumbnail no longer drops into the bare full-screen viewer");
  const actions = card.slice(card.indexOf('class="entity-candidate-actions"'));
  ok(actions.indexOf("REVIEW") < actions.indexOf("APPROVE"),
    "R13 Review is the first action on the card and approval stays separate");

  /* The real Rex configuration: a text model reachable, no vision model. The
     capability is stated rather than inherited from the harness default, because
     the whole point of R15 is that the surface tells the truth about THIS
     configuration. */
  const openReview = (vision, file = `${REX}_FAL_CANDIDATE_1.png`) => vm.runInContext(
    `(() => { AGENT_STATUS = { capabilities: { vision: ${JSON.stringify(
      vision === true
        ? { ready: true, standing: "ready", provider: "custom", model: "qwen3.8-27b-fp8", message: "", action: "" }
        : vision === false
          /* The real Rex configuration: a provider resolved, no vision model named.
             The server still reports its reachability failure, and this is exactly the
             record that used to leak into the panel. */
          ? { ready: false, standing: "configured-unavailable", provider: "ollama", model: "",
              message: "Ollama is not reachable at http://127.0.0.1:59999.",
              action: "Start Ollama, then retry. Expected model: not configured." }
          : vision
    )} } };
      openEntityCandidateReview('characters','${REX}','${file}','state-default');
      const el = document.getElementById('modal');
      const out = el ? el.innerHTML : ''; AGENT_STATUS = null; return out; })()`,
    view.context,
  );
  const modal = openReview(false);
  ok(modal, "R14 Candidate Review opens on a returned reference candidate");
  ok(modal.includes("Rex Vandar · Default"),
    "R14 it leads with the reference and the continuity state, not the filename");
  ok(modal.includes(`${REX}_FAL_CANDIDATE_1.png`),
    "R14 and still states the exact file being judged");
  ok(/CANDIDATE 1 OF 3|Candidate 1 of 3/.test(modal),
    "R14 it says which candidate of how many this is");
  ok(modal.includes("entity-review-nav") && modal.includes("entity-review-strip"),
    "R14 previous/next and the candidate strip are both present");
  ok(modal.includes("WHERE THIS CAME FROM") && modal.includes("GPT Image 2") && modal.includes("FAL"),
    "R14 generation provenance is shown in the names the generation dialog used");
  ok(modal.includes("01a077eb-b0df-74c2-91a6-0c89dd3f7d7b"),
    "R14 including the provider's own request handle");
  ok(modal.includes("View full size"),
    "R14 the generic viewer is kept, as an explicit secondary action");

  /* R15 — the review states the honest answer for THIS configuration, with the one
     control that changes it.

     C2 SINGLE AUTHORITY RECLASSIFIED THE CONFIGURATION THIS FIXTURE HOLDS. Rex's
     vision resolved to Ollama with no model named — a provider that was SELECTED
     and could not answer. The product used to call that "off" because the model
     field was blank, and R15/T2 therefore asserted that its diagnostic must be
     suppressed. Under one authority that is a configured failure, and suppressing
     the diagnostic hides the only information that would let a filmmaker fix it.

     Both halves are still pinned, against the configurations that actually are
     each one. */
  ok(modal.includes("Braidy visual review unavailable."),
    "R15 a selected vision provider that cannot answer says the review is unavailable");
  ok(!modal.includes("Vision is off"),
    "R15 and never claims the filmmaker switched it off");
  ok(modal.includes("Ollama is not reachable"),
    "R15 it keeps the provider diagnostic, which is what a person needs to fix it");
  ok(modal.includes("Your own review and approval are unaffected."),
    "R15 and that the human decision is untouched by it");
  ok(modal.includes("Configure Vision") && modal.includes("openVisionSettingsFromReview"),
    "R15 and offers the deep link to the Assistant settings that own Vision");
  ok(!modal.includes("Review with Braidy"),
    "R15 no Braidy review action is offered that could not run");

  /* T2 — A CAPABILITY NOBODY TURNED ON REPORTS NO FAULT. This is the half R15
     originally protected, now asserted against a genuinely disabled capability
     rather than against a misclassified one. */
  const offModal = openReview({ ready: false, standing: "off", provider: "none", model: "",
    message: "Vision assistance is disabled in AI Assistant settings.",
    action: "Choose an AI provider in Settings." });
  ok(offModal.includes("Braidy visual review unavailable — Vision is off."),
    "T2 with Vision explicitly disabled the review says so plainly");
  ok(!offModal.includes("Ollama is not reachable"),
    "T2 an off capability does not report any provider's reachability");
  ok(!offModal.includes("Start Ollama") && !offModal.includes("Expected model"),
    "T2 nor a retry instruction or a model expectation for a model nobody named");
  ok(offModal.includes("No image is sent for reading."),
    "T2 it states what being off actually means, in the Assistant panel's own words");
  ok(offModal.includes("Your own review and approval are unaffected."),
    "T2 and that the human decision is untouched by it");

  /* And the other half: a vision model that IS named and did not answer keeps every
     word of its diagnostic, and stops calling itself off. */
  const visionBroken = openReview({
    ready: false, standing: "configured-unavailable", provider: "custom", model: "qwen3.8-27b-fp8",
    message: "OpenAI-compatible server is not reachable at http://127.0.0.1:8000/v1.",
    action: "Start the server, then retry.",
  });
  ok(visionBroken.includes("OpenAI-compatible server is not reachable at http://127.0.0.1:8000/v1."),
    "T2 a configured vision model that did not answer keeps its provider diagnostic");
  ok(visionBroken.includes("Start the server, then retry."),
    "T2 including the action that would fix it");
  ok(!visionBroken.includes("Vision is off"),
    "T2 and a named, unreachable model is not described as switched off");
  ok(visionBroken.includes("Configure Vision"),
    "T2 the way into Vision settings is offered in both unavailable states");

  const visionOn = openReview(true);
  ok(visionOn.includes("Review with Braidy"),
    "R15 with Vision configured, asking Braidy is one press away");
  ok(visionOn.includes("It is advisory") || visionOn.includes("advisory"),
    "R15 and Braidy's answer is declared advisory");
  /* Braidy may be asked, and may not decide. Checked structurally — no approval
     control lives inside the Braidy block — and in words, because a filmmaker reads
     the sentence rather than the DOM. */
  const braidyBlock = visionOn.slice(
    visionOn.indexOf('class="entity-review-braidy'),
    visionOn.indexOf("</section>", visionOn.indexOf('class="entity-review-braidy')),
  );
  ok(braidyBlock.length > 0 && !/approve-btn|approveEntityFile|APPROVE FOR/.test(braidyBlock),
    "R15 the Braidy block carries no approval control");
  ok(/it cannot approve a reference or assign authority/.test(braidyBlock),
    "R15 and says in words that it cannot approve or assign authority");
}

/* ------------------------------------------------------------------------ R16 */
async function testApprovalRemainsTheFinalAuthorityStep() {
  const view = await renderRex(rexFixture({ builds: 1, candidates: 3, job: COMPLETED_JOB }));
  const modal = vm.runInContext(
    `(() => { openEntityCandidateReview('characters','${REX}','${REX}_FAL_CANDIDATE_3.png','state-default');
      return document.getElementById('modal').innerHTML; })()`,
    view.context,
  );
  ok(/APPROVE FOR DEFAULT…/.test(modal),
    "R16 approval from the review promises a further confirmation");
  ok(modal.includes(`approveEntityFile('characters','${REX}','${REX}_FAL_CANDIDATE_3.png','state-default')`),
    "R16 and opens the existing authority modal with the reviewed candidate preselected");

  /* THE AUTHORITY MODAL ITSELF IS UNCHANGED, and is proved end to end against real
     returned media in the historical capture retained at v6.7.0-alpha.1
     (tests/reference-creation-review-capture.py), which opened it from
     this control in a real browser and reads "Approve reference — Rex Vandar" out of
     it. What is proved HERE is the wiring and the separation: review does not perform
     approval, and approval does not perform review. */
  const approvalSource = source("library-tools.js");
  ok(/window\.approveEntityFile = \(list, id, name, stateId = "", mode = "primary-authority"\)/.test(approvalSource),
    "R16 the shipped approval entry point is untouched and still takes the candidate by name");
  ok(!/entity-review-factor|BRAIDY VISUAL REVIEW|runEntityCandidateVisionReview/.test(
    approvalSource.slice(approvalSource.indexOf("window.approveEntityFile"),
                         approvalSource.indexOf("window.approveEntityFile") + 12000)),
    "R16 the approval modal does not perform the visual review; review is first, authority second");
}

/* -------------------------------------------- THE AUTHORITY BOUNDARY ITSELF */
async function testAutomationCannotWriteApproval() {
  /* The frozen rule the whole flow rests on: candidate is not selected, selected
     is not approved, and no machine may cross the last line. This is checked at
     the writer rather than at the button, because a button is a convention and a
     writer is an invariant. */
  const kernel = source("shared-authority-kernel.js");
  ok(/function requireTrustedGesture/.test(kernel),
    "AUTHORITY every Canon commit asks for a human gesture");
  ok(/const gesture = TRUSTED_GESTURE;[\s\S]{0,400}if \(!gesture\) refuse\(\);/.test(kernel),
    "AUTHORITY and refuses when there is none");
  ok(/dispatchScopeAvailable\(\) && dispatchingEvent\(\) !== gesture\.event/.test(kernel),
    "AUTHORITY a continuation — an await, a timer, an automation loop — is not that gesture");

  const automation = source("automation.js");
  ok(!automation.includes("const V627_AUTOMATION_AUTO_APPROVE_SCORE"),
    "AUTHORITY the strong-pass threshold is not declared as a permission to approve");
  ok(automation.includes("V627_AUTOMATION_RECOMMENDATION_SCORE"),
    "AUTHORITY it decides whether the run RECOMMENDS and parks");
  const approveEntityCalls = automation.split("v626ApproveEntity(").length - 1;
  ok(approveEntityCalls === 2,
    `AUTHORITY the entity approval writer has exactly one call site plus its definition (found ${approveEntityCalls})`);
  ok(/window\.approveAutomationCandidate = async \(runId, stepKey, fileName\) => \{[\s\S]{0,900}cachedStep\.status !== "needs-review"/.test(automation),
    "AUTHORITY that call site is the human review gate, and only fires on a parked gate");

  /* And the run panel that reaches it still says so, in the filmmaker's words. */
  ok(automation.includes("always stops for your approval"),
    "AUTHORITY the Braidy run states that it stops for the human decision");
}

/* --------------------------------------------------------------- R8/R9/R10/R11 */
async function testGenerationDecisionIsComposed() {
  const presentation = source("shared-generation-presentation.js");
  const generation = source("fal-generation.js");
  const viewSource = source("generation-view.js");

  ok(generation.includes('"openai/gpt-image-2": "GPT Image 2"'),
    "R8 the configured model has a product name, and the id is still what travels");
  ok(/surfaceName: "FAL"/.test(generation),
    "R8 the provider is named as FAL rather than as its surface key");
  ok(/standing: "Current route for character and reference generation"/.test(generation),
    "R8 the route declares why it is the route, rather than implying a ranking");
  ok(/const declared = presentationRecord\(row\.routeStanding\);/.test(presentation),
    "R8 and the presenter reports that standing instead of 'Compatible choice'");
  ok(/gen-view-via/.test(viewSource) && /gen-view-mode/.test(viewSource),
    "R8 Via and Mode are slots the block can state");
  ok(/\(via \?/.test(viewSource) && /\(mode \?/.test(viewSource),
    "R11 and they render only when the route declares them, so a future route has a slot without a router being built");

  /* T1 — the request block describes a request. It said "3 candidates returned" above
     an unpressed paid button; the count is unchanged and the tense is not. */
  const entityDialog = generation.slice(generation.indexOf("window.openFalEntityGenerationModal"));
  ok(/label: n === 1 \? "candidate" : "candidates"/.test(entityDialog),
    "T1 the reference dialog states the candidates it will request, not ones it has");
  /* Comments are stripped, because the note explaining the correction quotes the
     sentence it removed. */
  const entityCode = entityDialog.replace(/\/\*[\s\S]*?\*\//g, "");
  ok(!/candidates returned/.test(entityCode.slice(0, entityCode.indexOf("START GENERATION"))),
    "T1 and no longer claims a completed generation before one has been submitted");
  ok(/Every returned file is an unapproved \$\{typeLabel\} candidate/.test(entityDialog),
    "T1 while the sentence that says what will come back is untouched");

  ok(/force: reference \? \["resolution"\] : undefined/.test(generation),
    "R9 output size is promoted into Simple for reference generation");
  ok(/tier: "advanced",\s*requires: \{ list: "resolutions" \}/.test(presentation.replace(/\/\*[\s\S]*?\*\//g, "")),
    "R9 without re-tiering it globally, so the frame and motion dialogs are unchanged");
  ok(generation.includes("reference: true, anchorTop"),
    "R9 and the request carries the same flag, so what Simple shows is what the payload gate keeps");
  ok(/Fixed by the \$\{esc\(typeLabel\)\} reference format/.test(generation)
    || generation.includes("reference format. The prompt below was compiled at this ratio"),
    "R9 aspect ratio is stated as the fact it is, not invented as an independent control");

  const rate = source("shared-generation-rate.js");
  ok(rate.includes("Provider price unavailable"),
    "R10 an unconfigured rate is still never a number");
  ok(rate.includes("a verified rate is entered in Settings → Generation"),
    "R10 and now says why it is unavailable and where one would come from");
  ok(rate.includes("$0 provider charge") && !/headline: "Free"/.test(rate),
    "R10 a local route is a zero PROVIDER charge, not free");
  ok(/generationTimeEstimate\(\)[\s\S]{0,400}available: false/.test(source("shared-generation-presentation.js")),
    "R10 and no duration is fabricated from one observed run");

  for (const forbidden of ["civitaiEntityGeneration", "comfyEntityGeneration", "runware", "magnific"]) {
    ok(!generation.toLowerCase().includes(forbidden.toLowerCase()),
      `R11 no new provider integration was added (${forbidden})`);
  }
}

/* ------------------------------------------------------------------------ R17 */
async function testPrimaryApprovalHandsOffToCoverage() {
  const before = await renderRex(rexFixture({ approved: false, builds: 1, candidates: 3 }));
  ok(html(before).includes("Create Rex Vandar's primary reference"),
    "R17 before approval the task is to establish the identity");

  const after = await renderRex(rexFixture({ approved: true, builds: 1, candidates: 2 }));
  const markup = html(after);
  ok(markup.includes("Rex Vandar's primary reference") && !markup.includes("Create Rex Vandar's primary reference"),
    "R17 after approval the section stops asking to create one");
  ok(/Views still needed|Planned views|coverage/i.test(markup),
    "R17 and the next task named is coverage rather than identity");
}

async function main() {
  const suites = [
    testCreateReferenceIsTheTask,
    testPromptFollowsTheActionThatMadeIt,
    testBraidyIsTheRunningIdentity,
    testReturnedResultsCannotBeLost,
    testCandidateReviewIsTheFirstAction,
    testApprovalRemainsTheFinalAuthorityStep,
    testAutomationCannotWriteApproval,
    testGenerationDecisionIsComposed,
    testPrimaryApprovalHandsOffToCoverage,
  ];
  for (const suite of suites) await suite();
  console.log(`Reference creation review V1: ${notes.length} checks passed.`);
  for (const line of notes) console.log("  - " + line);
  console.log("No project on disk was read or written. Provider calls made: 0. Generations started: 0.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

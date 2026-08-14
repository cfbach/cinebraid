/* Durable reference automation, driven end to end against deterministic providers.

   The dogfood run this suite exists for: "Automate default reference" for Mara
   Venn, rain-soaked arrival, three candidates a pass. Three real images came
   back, OpenAI vision scored them 62 / 48 / 52 FLAG, and from the filmmaker's
   seat nothing else happened. Two separate defects were behind that.

   The first was not that the loop stopped — driven cleanly it always ran every
   authorized pass — but that the correction it carried forward was built from a
   single review. `picked` was the top scorer, and the two candidates that failed
   for entirely different reasons contributed nothing to the next prompt. Pass 2
   was therefore a re-run with boilerplate attached, and nothing anywhere showed
   the director what had changed or why.

   The second was that a rejected candidate's card rendered its AI badge and then
   offered exactly one action: RESTORE. The review was still on disk the whole
   time; there was simply no way in without un-rejecting the image first.

   What is asserted here, in the order a director meets it:

     A  an all-failed pass aggregates every candidate's findings and advances
     B  the pass-2 prompt is derived from that aggregate, not decorated with it
     C  a strong pass stops the loop, spends nothing further, and still waits
     D  three failed passes exhaust exactly, and say so
     E  no pass and no image beyond the confirmed authorization, ever
     F  AI judgment and human judgment coexist and neither overwrites the other
     G  a rejected candidate keeps a way into its review
     H  the pass record survives a later re-review of the same file
     I  the PR #39 provider dialect and the FAL wiring are untouched

   NOTHING HERE IS PAID. Every provider is a local stub; the suite counts the
   requests that would have cost money and fails if the count is ever wrong. */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { render, buildFixture } = require("./render-harness");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

/* ---------------------------------------------------------------- fixtures */

/* The five criteria the reference reviewer scores. Findings are keyed by them,
   which is what lets the aggregate rank a fault two candidates shared above one
   that only the weakest had. */
const FLAG = (score, categories, summary) => ({
  score, pass: false, modelPass: false, explicitPass: false, explicitScore: true, autoApprove: false,
  contractVersion: "reference-authority-v3",
  requiredHardChecks: [], hardChecks: {}, hardGateFailures: ["score-below-85", "model-did-not-pass"],
  categories, summary, recommendation: "correct",
});
const PASS = (score, summary) => ({
  score, pass: true, modelPass: true, explicitPass: true, explicitScore: true, autoApprove: true,
  contractVersion: "reference-authority-v3",
  requiredHardChecks: [], hardChecks: {}, hardGateFailures: [],
  categories: {
    design: { severity: "pass", note: "Identity reads clearly." },
    state: { severity: "pass", note: "Rain-soaked arrival is correct." },
    requirements: { severity: "pass", note: "All required details present." },
    usefulness: { severity: "pass", note: "Usable as a durable reference." },
    cleanliness: { severity: "pass", note: "No artifacts." },
  },
  summary, recommendation: "approve",
});

/* The real dogfood pass 1: three candidates, three different reasons, one of
   them shared. Wardrobe is clean on all three, which is what PRESERVE is for. */
const DOGFOOD_PASS_1 = [
  { file: "MARA-P1-A.png", review: FLAG(62, {
    design: { severity: "major", note: "Face too dark; the eyes are difficult to read." },
    state: { severity: "pass", note: "Soaked coat and wet hair are correct." },
    requirements: { severity: "pass", note: "Required identity details are present." },
    usefulness: { severity: "minor", note: "Usable but underexposed." },
    cleanliness: { severity: "pass", note: "No artifacts." },
  }, "Face too dark; eyes difficult to read. Wardrobe otherwise correct.") },
  { file: "MARA-P1-B.png", review: FLAG(48, {
    design: { severity: "pass", note: "Identity is consistent where visible." },
    state: { severity: "pass", note: "Soaked coat and wet hair are correct." },
    requirements: { severity: "major", note: "Face occupies too little of the frame to judge." },
    usefulness: { severity: "major", note: "Framing too wide; poor reference pose." },
    cleanliness: { severity: "pass", note: "No artifacts." },
  }, "Framing too wide; face insufficiently readable. Reference pose poor.") },
  { file: "MARA-P1-C.png", review: FLAG(52, {
    design: { severity: "major", note: "Dramatic lighting obscures identity across the face." },
    state: { severity: "pass", note: "Soaked coat and wet hair are correct." },
    requirements: { severity: "pass", note: "Silhouette is acceptable." },
    usefulness: { severity: "major", note: "Unsuitable as a durable reference." },
    cleanliness: { severity: "pass", note: "No artifacts." },
  }, "Dramatic lighting obscures identity; silhouette acceptable.") },
];
const DOGFOOD_PASS_2_FAIL = [
  { file: "MARA-P2-A.png", review: FLAG(70, {
    design: { severity: "major", note: "Still shadowed across one eye." },
    state: { severity: "pass", note: "State correct." },
    requirements: { severity: "pass", note: "Details present." },
    usefulness: { severity: "minor", note: "Closer to usable." },
    cleanliness: { severity: "pass", note: "No artifacts." },
  }, "Improved exposure, one eye still shadowed.") },
  { file: "MARA-P2-B.png", review: FLAG(66, {
    design: { severity: "major", note: "Face readable but still low key." },
    state: { severity: "pass", note: "State correct." },
    requirements: { severity: "pass", note: "Details present." },
    usefulness: { severity: "pass", note: "Framing is now reference-appropriate." },
    cleanliness: { severity: "pass", note: "No artifacts." },
  }, "Framing fixed; exposure still low.") },
  { file: "MARA-P2-C.png", review: FLAG(64, {
    design: { severity: "major", note: "Identity hard to verify in shadow." },
    state: { severity: "pass", note: "State correct." },
    requirements: { severity: "pass", note: "Details present." },
    usefulness: { severity: "pass", note: "Framing is now reference-appropriate." },
    cleanliness: { severity: "pass", note: "No artifacts." },
  }, "Identity still hard to verify.") },
];
const DOGFOOD_PASS_2_STRONG = [
  { file: "MARA-P2-A.png", review: PASS(86, "Clear, evenly lit, reference-appropriate framing.") },
  { file: "MARA-P2-B.png", review: FLAG(70, {
    design: { severity: "major", note: "Still shadowed." },
    state: { severity: "pass", note: "State correct." },
    requirements: { severity: "pass", note: "Details present." },
    usefulness: { severity: "pass", note: "Framing fine." },
    cleanliness: { severity: "pass", note: "No artifacts." },
  }, "Still shadowed.") },
  { file: "MARA-P2-C.png", review: PASS(82, "Readable and usable.") },
];
const DOGFOOD_PASS_3_FAIL = [
  { file: "MARA-P3-A.png", review: FLAG(72, {
    design: { severity: "major", note: "Face still partly shadowed." },
    state: { severity: "pass", note: "State correct." },
    requirements: { severity: "pass", note: "Details present." },
    usefulness: { severity: "pass", note: "Framing fine." },
    cleanliness: { severity: "pass", note: "No artifacts." },
  }, "Face still partly shadowed.") },
  { file: "MARA-P3-B.png", review: FLAG(68, {
    design: { severity: "major", note: "Low key across the face." },
    state: { severity: "pass", note: "State correct." },
    requirements: { severity: "pass", note: "Details present." },
    usefulness: { severity: "pass", note: "Framing fine." },
    cleanliness: { severity: "pass", note: "No artifacts." },
  }, "Low key across the face.") },
  { file: "MARA-P3-C.png", review: FLAG(74, {
    design: { severity: "major", note: "Identity still not verifiable." },
    state: { severity: "pass", note: "State correct." },
    requirements: { severity: "pass", note: "Details present." },
    usefulness: { severity: "pass", note: "Framing fine." },
    cleanliness: { severity: "pass", note: "No artifacts." },
  }, "Identity still not verifiable.") },
];

function maraProject(candidateFiles = []) {
  const project = buildFixture();
  project.characters = [{
    id: "MARA",
    name: "Mara Venn",
    status: "IN PROGRESS",
    workflowStatus: "IN PROGRESS",
    block: "Field investigator, late thirties, close-cropped dark hair, long dark coat.",
    creationDescription: "Mara Venn, field investigator, arriving soaked at night in heavy rain outside the station door.",
    approvedFile: "",
    candidateFiles,
    continuityStates: [{ id: "state-default", name: "Rain-soaked arrival", isDefault: true, notes: "Soaked long coat, wet hair flat to the head, rain-slick skin." }],
  }];
  return project;
}
function scanFor(files) {
  return { anchors: files.map((name) => ({ name, url: `/assets/anchors/${name}` })), plates: [], props: [], vehicles: [], audio: [], media: [], shots: {} };
}

/* ------------------------------------------------------------ the driver */

/* One deterministic stand-in for the whole provider stack: the automation run
   store, the prompt compiler, FAL, and the vision reviewer. Every paid-shaped
   request is counted so a spending assertion can be made about the run rather
   than about the code that would have made it. */
async function automationWorld(options = {}) {
  const passes = options.passes || [DOGFOOD_PASS_1];
  const project = options.project || maraProject();
  const allFiles = passes.flatMap((pass) => pass.map((row) => row.file));
  const reviewsByFile = new Map(passes.flat().map((row) => [row.file, row.review]));
  const counts = { generationBatches: 0, imagesGenerated: 0, reviewCalls: 0, promptCompiles: 0, promptDirectives: [] };
  let RUN = null, jobSeq = 0;

  const rendered = await render(options.hash || "#/character/MARA", project, {
    scan: scanFor(allFiles),
    storage: options.storage || {},
    fetch: async (url, init = {}, respond) => {
      const method = init.method || "GET";
      const body = init.body ? JSON.parse(init.body) : {};
      if (url === "/api/generation/fal/status") return respond({ enabled: true, configured: true, defaults: {} });
      if (url === "/api/automation/runs" && method === "POST") { RUN = structuredClone(body); RUN.revision = 1; return respond({ run: RUN }); }
      if (/^\/api\/automation\/runs\/[^/]+$/.test(url) && method === "PUT") { RUN = structuredClone(body); RUN.revision = Number(RUN.revision || 1) + 1; return respond({ run: RUN }); }
      if (/^\/api\/automation\/runs\/[^/]+$/.test(url) && method === "GET") return respond({ run: RUN });
      if (url.endsWith("/lease") && method === "POST") {
        RUN = { ...RUN, runnerId: body.runnerId, leaseAcquiredAt: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 600000).toISOString() };
        return respond({ run: RUN, leaseMs: 600000, heartbeatMs: 300000 });
      }
      if ((url.endsWith("/heartbeat") || url.endsWith("/lease/revalidate")) && method === "POST") {
        RUN = { ...RUN, leaseExpiresAt: new Date(Date.now() + 600000).toISOString() };
        return respond({ run: RUN });
      }
      if (url.endsWith("/release") && method === "POST") return respond({ run: RUN });
      if (url === "/api/prompt/asset-compile" && method === "POST") {
        counts.promptCompiles += 1;
        counts.promptDirectives.push(String(body.directive || ""));
        /* The stub is a compiler, not an author: the directive it is handed is
           the only thing that can change between passes, so a prompt that does
           not differ proves the correction never reached the compiler. */
        const brief = "Production reference of MARA VENN, field investigator, rain-soaked arrival at night.";
        return respond({
          compiledPrompt: [brief, body.useLLM ? "Rendered for GPT Image 2." : "", String(body.directive || "")].filter(Boolean).join("\n"),
          spec: {}, warnings: [], confirmations: [], llmUsed: !!body.useLLM,
          profile: { name: "GPT Image 2", profileVersion: "1" },
        });
      }
      if (url === "/api/generation/fal/jobs" && method === "POST") {
        const pass = passes[counts.generationBatches];
        assert(pass, `automation asked for generation batch ${counts.generationBatches + 1}, which the confirmed authorization never covered`);
        counts.generationBatches += 1;
        counts.imagesGenerated += pass.length;
        jobSeq += 1;
        return respond({ ok: true, job: { id: `job-${jobSeq}`, status: "COMPLETED", purpose: "entity-reference", model: "GPT Image 2", outputs: pass.map((row) => ({ name: row.file, url: `/assets/anchors/${row.file}` })) } });
      }
      if (url === "/api/generation/fal/jobs" && method === "GET") return respond({ jobs: [] });
      if (url === "/api/llm/review-entity-candidate" && method === "POST") {
        counts.reviewCalls += 1;
        const review = reviewsByFile.get(body.fileName);
        assert(review, `vision review was asked for ${body.fileName}, which no pass generated`);
        return respond({ review: structuredClone(review), inputLabels: [{ image: 1, fileName: body.fileName, role: "candidate under review" }] });
      }
      return null;
    },
  });
  vm.runInContext(`CONFIG.generation=CONFIG.generation||{};CONFIG.generation.fal={enabled:true,apiKey:'test'};`, rendered.context);
  return { rendered, context: rendered.context, counts, project, getRun: () => RUN };
}

/* Starts the same run the START button starts, with the same confirmed cap. */
async function startReferenceAutomation(world, config = {}) {
  const stateRounds = Number(config.stateRounds || 3), outputsPerRequest = Number(config.outputsPerRequest || 3);
  return vm.runInContext(`(async () => {
    const run = v626NewRun("entity-chain", "characters:MARA", "default-only", "Mara Venn continuity references", "single-state", {
      list: "characters", entityId: "MARA", stateIds: ["state-default"], reuseApproved: true,
      stateRounds: ${stateRounds}, outputsPerRequest: ${outputsPerRequest}, maxImages: ${stateRounds * outputsPerRequest},
      generationSettings: v6211AutomationGenerationSettings(),
    });
    run.entityList = "characters"; run.entityId = "MARA";
    const saved = await v626CreateRun(run);
    await runEntityAutomation(saved.id);
    return saved.id;
  })()`, world.context);
}
const runState = (world, runId) => vm.runInContext(`JSON.parse(JSON.stringify(v626Runs().find((row) => row.id === ${JSON.stringify(runId)})))`, world.context);
const entityState = (world) => vm.runInContext(`JSON.parse(JSON.stringify(P.characters[0]))`, world.context);

/* ------------------------------------------------------------------ tests */

/* A — an all-failed pass aggregates every candidate and runs the next pass. */
async function testAllFailedPassAdvances() {
  const world = await automationWorld({ passes: [DOGFOOD_PASS_1, DOGFOOD_PASS_2_STRONG] });
  const runId = await startReferenceAutomation(world);
  const run = runState(world, runId);

  assert.strictEqual(world.counts.generationBatches, 2, "an all-failed pass 1 must be followed by the authorized pass 2");
  assert.strictEqual(world.counts.imagesGenerated, 6, "two passes of three candidates is six generations");
  assert.strictEqual(world.counts.reviewCalls, 6, "every generated candidate must be reviewed");

  const pass1 = run.steps["entity:state-default:round-1:review"];
  assert.strictEqual(pass1.status, "completed");
  assert.strictEqual(pass1.pass, false, "no pass-1 candidate was approvable");
  assert.strictEqual((pass1.review?.candidates || []).length, 3, "all three pass-1 reviews must persist on the run");

  const plan = pass1.result?.correctionPlan;
  assert(plan, "a failed pass must record the correction plan it derived");
  assert.strictEqual(plan.candidateCount, 3);
  assert.strictEqual(plan.bestScore, 62);

  /* The defect this suite exists for: the plan used to be built from the top
     scorer alone, so candidate B's framing fault and candidate C's lighting
     fault reached the next prompt nowhere at all. */
  const labels = plan.correct.map((row) => row.label).join(" | ");
  assert(/Identity & design/.test(labels), "the identity fault two candidates shared must be in the plan");
  assert(/Production-reference clarity/.test(labels), "candidate B and C's usefulness fault must be in the plan");
  assert(/Anatomy & character-owned details/.test(labels), "candidate B's readability fault must be in the plan");
  const notes = plan.correct.map((row) => row.note).join(" ");
  assert(/Face too dark/.test(notes), "candidate A's finding must survive aggregation");
  assert(/Framing too wide/.test(notes), "candidate B's finding must survive aggregation");
  assert(/Dramatic lighting obscures identity/.test(notes), "candidate C's finding must survive aggregation");

  /* Recurring first: identity failed on two candidates, the others on one. */
  assert.strictEqual(plan.correct[0].label, "Identity & design", "the most recurring fault must lead the plan");
  assert.strictEqual(plan.correct[0].candidateCount, 2);
  assert(plan.correct[0].recurring, "a fault seen on more than one candidate is recurring");

  /* Preserve is the other half: the wardrobe/state criterion no candidate
     flagged must be named as untouchable rather than left to drift. */
  const preserve = plan.preserve.map((row) => `${row.label}: ${row.note}`).join(" | ");
  assert(/Rain-soaked arrival/.test(preserve), "the target state must be preserved by name");
  assert(/Mara Venn as already established/.test(preserve), "established identity must be preserved by name");
  assert(/Target state \/ wardrobe/.test(preserve), "a criterion clean on every candidate must be preserved");
  assert(!plan.preserve.some((row) => /Identity & design/.test(row.label)), "a flagged criterion must never be listed as preserved");
  return world;
}

/* B — the pass-2 prompt is derived from that aggregate. */
async function testPassTwoPromptDerivesFromPassOneFindings() {
  const world = await automationWorld({ passes: [DOGFOOD_PASS_1, DOGFOOD_PASS_2_STRONG] });
  const runId = await startReferenceAutomation(world);
  const run = runState(world, runId);

  const pass1Prompt = run.steps["entity:state-default:round-1:prompt"].result?.prompt || "";
  const pass2Prompt = run.steps["entity:state-default:round-2:prompt"].result?.prompt || "";
  assert(pass1Prompt, "pass 1 must record the prompt it actually compiled");
  assert(pass2Prompt, "pass 2 must record the prompt it actually compiled");
  assert.notStrictEqual(pass1Prompt, pass2Prompt, "pass 2 must not resubmit the pass-1 prompt");

  /* Not merely different — different *because of the reviews*. Each of the three
     candidates' findings has to be traceable in the pass-2 prompt. */
  assert(/Face too dark/.test(pass2Prompt), "pass 2 must carry candidate A's finding");
  assert(/Framing too wide/.test(pass2Prompt), "pass 2 must carry candidate B's finding");
  assert(/Dramatic lighting obscures identity/.test(pass2Prompt), "pass 2 must carry candidate C's finding");
  assert(/PRESERVE/.test(pass2Prompt) && /CORRECT/.test(pass2Prompt), "the pass-2 directive must separate what to keep from what to fix");
  assert(/Rain-soaked arrival/.test(pass2Prompt), "pass 2 must restate the canon state it is preserving");

  /* Canon must not be rewritten to chase a bad generation. */
  assert(/Change only what the CORRECT list names/.test(pass2Prompt), "the correction must forbid unrelated changes");
  assert(/Do not introduce new wardrobe, age, hair, location, props, mood or story facts/.test(pass2Prompt));

  /* And it must be a correction, not a generic retry. */
  for (const empty of ["make it better", "improve quality", "try again"]) {
    assert(!new RegExp(empty, "i").test(pass2Prompt), `"${empty}" is not a correction`);
  }

  const passes = run.result?.referencePasses || [];
  assert.strictEqual(passes.length, 2, "each pass must be recorded in the run ledger");
  assert.strictEqual(passes[0].passNumber, 1);
  assert(passes[1].promptDelta?.added?.length, "pass 2 must record what changed from pass 1");
  assert(passes[1].promptDelta.added.some((line) => /Face too dark/.test(line)), "the recorded delta must be the review evidence");
  assert(passes[0].nextRevision.includes("PRESERVE"), "pass 1 must record the correction it handed forward");
}

/* C — a strong pass stops the loop, spends nothing further, and still waits. */
async function testStrongPassStopsWithoutApproving() {
  const world = await automationWorld({ passes: [DOGFOOD_PASS_1, DOGFOOD_PASS_2_STRONG, DOGFOOD_PASS_3_FAIL] });
  const runId = await startReferenceAutomation(world);
  const run = runState(world, runId);

  assert.strictEqual(world.counts.generationBatches, 2, "a strong pass in pass 2 must not spend pass 3");
  assert.strictEqual(world.counts.imagesGenerated, 6);
  assert.strictEqual(world.counts.reviewCalls, 6);
  assert(!run.steps["entity:state-default:round-3:generate"], "pass 3 must never be started");

  assert.strictEqual(run.status, "awaiting-review", "a strong pass pauses for the director");
  const gate = run.steps["entity:state-default:round-2:review"];
  assert.strictEqual(gate.status, "needs-review");
  assert.strictEqual(gate.pass, true);
  assert.strictEqual(gate.winner, "MARA-P2-A.png");

  /* The point of the gate: automation nominates, it does not make canon. */
  assert.strictEqual(entityState(world).approvedFile, "", "automation must never approve a reference on its own");
  assert(!run.steps["entity:state-default:approval"], "no approval step may exist without a human decision");
}

/* D — three failed passes exhaust exactly, and say why. */
async function testCompleteExhaustion() {
  const world = await automationWorld({ passes: [DOGFOOD_PASS_1, DOGFOOD_PASS_2_FAIL, DOGFOOD_PASS_3_FAIL] });
  const runId = await startReferenceAutomation(world);
  const run = runState(world, runId);

  assert.strictEqual(world.counts.generationBatches, 3, "exactly three authorized generation batches");
  assert.strictEqual(world.counts.imagesGenerated, 9, "exactly nine candidates at three a pass");
  assert.strictEqual(world.counts.reviewCalls, 9, "exactly nine reviews");
  assert(!run.steps["entity:state-default:round-4:generate"], "there is no fourth pass");

  const exhaustion = run.result?.referenceExhaustion;
  assert(exhaustion, "exhaustion must be recorded as its own outcome, not a generic pause");
  assert.strictEqual(exhaustion.passes, 3);
  assert.strictEqual(exhaustion.candidates, 9);
  assert(exhaustion.recurring.length, "exhaustion must name the recurring reasons");
  assert(/Identity & design/.test(exhaustion.recurring.join(" ")));

  /* Nothing is thrown away on the way out. */
  for (const round of [1, 2, 3]) {
    const step = run.steps[`entity:state-default:round-${round}:review`];
    assert.strictEqual((step.review?.candidates || []).length, 3, `pass ${round} reviews must remain on the run`);
    assert(step.result?.correctionPlan, `pass ${round} must keep its correction plan`);
  }
  const entity = entityState(world);
  assert.strictEqual(entity.candidateFiles.length, 9, "every generated candidate stays in the project");
  for (const row of entity.candidateFiles) assert(row.structuredReviews?.["state-default"], `${row.stored} must keep its review`);

  /* And the exhaustion state is what the workspace renders. */
  const markup = vm.runInContext(`v666ReferenceProgressionMarkup(v626Runs().find((row) => row.id === ${JSON.stringify(runId)}))`, world.context);
  assert(/No candidate passed after 3 passes \/ 9 candidates/.test(markup), "exhaustion must be visible, not inferred from a generic error");
  assert(/PASS 1 OF 3/.test(markup) && /PASS 3 OF 3/.test(markup), "every pass must remain inspectable");
  assert(/What changed from pass 1/.test(markup), "the prompt delta must be readable");
  assert(/Preserve — already correct/.test(markup) && /Correct — recurring reasons first/.test(markup));
  return { world, runId };
}

/* E — no pass and no image beyond the confirmed authorization. */
async function testSpendingBoundary() {
  const { world, runId } = await testCompleteExhaustion();

  /* The gate must not offer a fourth pass once three are used... */
  const gateMarkup = vm.runInContext(`v627HumanReviewMarkup(v626Runs().find((row) => row.id === ${JSON.stringify(runId)}))`, world.context);
  assert(!/IMPROVE PROMPT/.test(gateMarkup), "an exhausted run must not offer another pass");
  assert(/START A FRESH RUN/.test(gateMarkup), "more generation must be a new, explicit decision");
  assert(/No further pass is authorized in this run/.test(gateMarkup));

  /* ...and must refuse it when invoked anyway. */
  const before = { ...world.counts };
  const toast = vm.runInContext(`(async () => { let said = ""; const original = toast; globalThis.toast = (message) => { said = message; }; try { await continueAutomationRevision(${JSON.stringify(runId)}); } finally { globalThis.toast = original; } return said; })()`, world.context);
  const said = await toast;
  assert(/authorized pass/i.test(said) || /cap/i.test(said), `continuation past the authorization must be refused, said: ${said}`);
  assert.strictEqual(world.counts.generationBatches, before.generationBatches, "a refused continuation must not generate");
  assert.strictEqual(world.counts.imagesGenerated, before.imagesGenerated);

  /* The credit guard is the same number the offer reads. */
  const remaining = vm.runInContext(`v666RemainingImageBudget(v626Runs().find((row) => row.id === ${JSON.stringify(runId)}))`, world.context);
  assert.strictEqual(remaining, 0, "nine of nine candidates leaves no room");
}

/* E2 — with budget remaining, the continuation exists and is honoured. */
async function testContinuationWithBudgetRemaining() {
  const world = await automationWorld({ passes: [DOGFOOD_PASS_1, DOGFOOD_PASS_2_STRONG] });
  const runId = await startReferenceAutomation(world);

  /* The director rejects every candidate the strong pass produced. */
  vm.runInContext(`["MARA-P2-A.png","MARA-P2-B.png","MARA-P2-C.png"].forEach((file) => setEntityCandidateDecision("characters","MARA",file,"rejected"))`, world.context);
  const entity = entityState(world);
  assert(entity.candidateFiles.filter((row) => row.decision === "rejected").length === 3);
  assert.strictEqual(entity.approvedFile, "", "rejecting every candidate must not approve one");

  const gateMarkup = vm.runInContext(`v627HumanReviewMarkup(v626Runs().find((row) => row.id === ${JSON.stringify(runId)}))`, world.context);
  assert(/IMPROVE PROMPT &amp; RUN NEXT PASS/.test(gateMarkup), "a pass that is already authorized must be offered");
  assert(/Pass 3 of 3 is already authorized/.test(gateMarkup), "the offer must state which authorization it is spending");
  assert.strictEqual(world.counts.generationBatches, 2, "the offer alone must not spend anything");

  const remaining = vm.runInContext(`v666RemainingImageBudget(v626Runs().find((row) => row.id === ${JSON.stringify(runId)}))`, world.context);
  assert.strictEqual(remaining, 3, "one authorized pass of three candidates remains");
}

/* F — AI judgment and human judgment coexist; neither overwrites the other. */
async function testHumanAndAiJudgmentBothSurvive() {
  const world = await automationWorld({ passes: [DOGFOOD_PASS_1, DOGFOOD_PASS_2_STRONG] });
  await startReferenceAutomation(world);
  const ctx = world.context;

  /* Case A — AI FLAG 52, human REJECT. */
  vm.runInContext(`setEntityCandidateDecision("characters","MARA","MARA-P1-C.png","rejected")`, ctx);
  let row = entityState(world).candidateFiles.find((item) => item.stored === "MARA-P1-C.png");
  assert.strictEqual(row.decision, "rejected");
  assert.strictEqual(Math.round(row.structuredReviews["state-default"].score), 52, "the AI score survives the rejection");
  assert.strictEqual(row.structuredReviews["state-default"].pass, false);

  /* Case B — AI PASS 86, human REJECT. Both facts remain true. */
  vm.runInContext(`setEntityCandidateDecision("characters","MARA","MARA-P2-A.png","rejected")`, ctx);
  row = entityState(world).candidateFiles.find((item) => item.stored === "MARA-P2-A.png");
  assert.strictEqual(row.decision, "rejected");
  assert.strictEqual(row.structuredReviews["state-default"].pass, true, "a human rejection must not rewrite the AI verdict");
  assert.strictEqual(Math.round(row.structuredReviews["state-default"].score), 86);

  /* Case C — reject then restore; the original review is still there. */
  vm.runInContext(`setEntityCandidateDecision("characters","MARA","MARA-P1-A.png","rejected");setEntityCandidateDecision("characters","MARA","MARA-P1-A.png","unreviewed")`, ctx);
  row = entityState(world).candidateFiles.find((item) => item.stored === "MARA-P1-A.png");
  assert.strictEqual(row.decision, "unreviewed");
  assert.strictEqual(Math.round(row.structuredReviews["state-default"].score), 62, "restoring must not disturb the review");

  /* And the modal states both facts side by side. */
  const modal = vm.runInContext(`openEntityCandidateReview("characters","MARA","MARA-P2-A.png","state-default"), document.getElementById("modal").innerHTML`, ctx);
  assert(/HUMAN DECISION/.test(modal), "the review must state the human decision separately from the AI one");
  assert(/REJECTED BY YOU/.test(modal));
  assert(/86\/100 · PASS/.test(modal), "the AI verdict must still read as a pass");
  assert(/RESTORE CANDIDATE/.test(modal), "a rejected candidate offers restore, not another reject");
}

/* G — a rejected candidate keeps a way into its review, separate from the image. */
async function testRejectedCandidateReviewAccess() {
  const world = await automationWorld({ passes: [DOGFOOD_PASS_1], storage: { "cinebraid-focused:fixture:entity-task:characters:MARA": "review" } });
  await startReferenceAutomation(world);
  vm.runInContext(`setEntityCandidateDecision("characters","MARA","MARA-P1-B.png","rejected")`, world.context);

  const html = vm.runInContext(`entityPage("characters","MARA",()=>"")`, world.context);
  const rejectedSection = html.split('class="entity-rejected-candidates"')[1] || "";
  assert(rejectedSection, "the rejected candidate must still be listed");
  const card = rejectedSection.split("</article>")[0];
  assert(/data-candidate-file="MARA-P1-B.png"/.test(card));

  /* The two actions are different actions. */
  assert(/openLBMedia\(/.test(card), "the image click must still open the image viewer");
  assert(/openEntityCandidateReview\('characters','MARA','MARA-P1-B.png'/.test(card), "a rejected candidate must offer its review");
  assert(/VIEW REVIEW · 48 FLAG/.test(card), "the review action must state what is behind it");
  assert(/RESTORE/.test(card), "restore remains available and is not the only way in");

  /* Opening the review must not require restoring the candidate first. */
  const modal = vm.runInContext(`openEntityCandidateReview("characters","MARA","MARA-P1-B.png","state-default"), document.getElementById("modal").innerHTML`, world.context);
  assert(/48\/100 · FLAG/.test(modal), "the flagged score must be readable");
  assert(/Framing too wide/.test(modal), "the reason must be readable");
  assert.strictEqual(entityState(world).candidateFiles.find((row) => row.stored === "MARA-P1-B.png").decision, "rejected", "reading a review must not un-reject the candidate");
}

/* H — the pass record survives a later re-review of the same file. */
async function testRepeatedReviewKeepsPassProvenance() {
  const world = await automationWorld({ passes: [DOGFOOD_PASS_1, DOGFOOD_PASS_2_STRONG] });
  const runId = await startReferenceAutomation(world);
  vm.runInContext(`setEntityCandidateDecision("characters","MARA","MARA-P1-A.png","rejected")`, world.context);

  /* A fresh review of the same file, exactly as the review modal runs one. */
  await vm.runInContext(`(async () => {
    window._entityCandidateReview = { list: "characters", id: "MARA", fileName: "MARA-P1-A.png", stateId: "state-default", continueAction: "" };
    await runEntityCandidateVisionReview();
  })()`, world.context);

  const row = entityState(world).candidateFiles.find((item) => item.stored === "MARA-P1-A.png");
  assert.strictEqual(row.decision, "rejected", "a re-review must not overturn the human rejection");

  /* The pass-time review is immutable where it belongs: on the run. The project
     row carries the latest opinion; the run carries what pass 1 actually saw. */
  const run = runState(world, runId);
  const recorded = (run.steps["entity:state-default:round-1:review"].review?.candidates || []).find((item) => item.file === "MARA-P1-A.png");
  assert(recorded, "the pass-1 review record must survive a later re-review");
  assert.strictEqual(Math.round(recorded.review.score), 62, "the pass-1 score must be what pass 1 saw");
  const ledger = (run.result?.referencePasses || [])[0];
  assert(ledger.candidates.some((item) => item.file === "MARA-P1-A.png" && item.score === 62), "the pass ledger must keep the original score");
}

/* I — the neighbouring contracts this repair must not touch. */
function testNoProviderRegression() {
  const llm = require(path.join(ROOT, "llm.js"));
  assert.deepStrictEqual(llm.tokenLimitBody(llm.openAiProviderDialect({}), 4000), { max_completion_tokens: 4000 }, "official OpenAI must still receive max_completion_tokens");
  assert.deepStrictEqual(llm.tokenLimitBody(llm.openAiProviderDialect({ endpoint: { url: "http://127.0.0.1:8000/v1" } }), 4000), { max_tokens: 4000 }, "an OpenAI-compatible endpoint must still receive max_tokens");

  const automation = read("public/automation.js");
  /* RENAMED, NOT REMOVED. This suite's own headline property —
     testStrongPassStopsWithoutApproving — is the one the entity chain has always
     held: a strong pass stops the loop and does NOT approve. Dogfood Pass #2 A1
     found that the SHOT chain did the opposite at the same threshold, calling the
     approval writer and returning before the human gate.
     The constant is now V627_AUTOMATION_RECOMMENDATION_SCORE, which is what it
     has always done here and what it is now restricted to doing everywhere.
     Number and behaviour unchanged for this suite; see
     tests/production-authority.js for the invariant and
     tests/dogfood2-p0-negative-controls.js for its controls. */
  assert(automation.includes("V627_AUTOMATION_RECOMMENDATION_SCORE = 85"), "the strong-pass threshold must remain explicit");
  assert(automation.includes('purpose: "entity-reference"'), "reference generation must still submit as entity-reference work");
  /* The three per-list literals moved into public/shared-aspect.js so the reference
     COMPILER could read the same value the request carries. What this anchor protects
     is unchanged: reference generation still names a ratio on the job, and a character
     reference is still 3:4. */
  assert(automation.includes("aspectRatio: referenceAspectLabel(list)"), "the FAL aspect ratio must come from the one reference-format resolver");
  assert.strictEqual(require(path.join(ROOT, "public/shared-aspect")).referenceAspectLabel("characters"), "3:4", "a character reference is still generated at 3:4");
  assert(automation.includes("v6211RunGenerationSettings(run).frameQuality"), "quality must still come from the confirmed run settings");
  assert(!/autoApprove\s*\?\s*v626ApproveEntity/.test(automation));
  assert(automation.includes("Credit guard stopped the run before exceeding"), "the image cap guard must remain");
}

/* -------------------------------------------------------------------- main */

async function main() {
  await testAllFailedPassAdvances();
  await testPassTwoPromptDerivesFromPassOneFindings();
  await testStrongPassStopsWithoutApproving();
  await testCompleteExhaustion();
  await testSpendingBoundary();
  await testContinuationWithBudgetRemaining();
  await testHumanAndAiJudgmentBothSurvive();
  await testRejectedCandidateReviewAccess();
  await testRepeatedReviewKeepsPassProvenance();
  testNoProviderRegression();
  console.log("Reference automation closed loop passed: aggregated corrections, evidence-derived pass 2, strong-pass stop without auto-approval, exact exhaustion, spending boundary, human/AI provenance, rejected-review access, and no provider regression.");
}

/* Required rather than run: the functional-audit script reuses the same
   fixtures and the same driver, so the evidence it prints is the evidence these
   assertions were made against. */
module.exports = { automationWorld, startReferenceAutomation, runState, entityState, maraProject, DOGFOOD_PASS_1, DOGFOOD_PASS_2_FAIL, DOGFOOD_PASS_2_STRONG, DOGFOOD_PASS_3_FAIL };

if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });

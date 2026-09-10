const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { render, buildFixture, withCanon } = require("./render-harness");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fixture() {
  const project = buildFixture();
  const character = project.characters[0];
  character.id = "CHAR-NORA";
  character.name = "Nora";
  character.creationDescription = "A practical production reference for Nora, preserving her face, body proportions, short dark hair, and worn work coveralls.";
  character.approvedFile = "CHAR-NORA-PRIMARY.png";
  character.continuityStates = [
    { id: "state-default", name: "Clean overall", isDefault: true, approvedFile: "CHAR-NORA-PRIMARY.png", notes: "Primary identity and clean work coveralls." },
    { id: "state-night", name: "After the night's work", isDefault: false, approvedFile: "", parentStateId: "state-default", generationMode: "derive", notes: "Coveralls are dirty and worn. Preserve identity, face, hair, proportions, and garment construction." },
  ];
  /* The primary is APPROVED — a receipt, since derivation now requires canon. */
  withCanon(project, { kind: "entity-state", list: "characters", entityId: "CHAR-NORA", stateId: "state-default", value: "CHAR-NORA-PRIMARY.png" });
  character.coverageSlots = [
    { id: "front", label: "Front", required: true, approvedFile: "", status: "missing" },
    { id: "front-three-quarter", label: "3/4 front", required: true, approvedFile: "", status: "missing" },
    { id: "profile", label: "Profile", required: true, approvedFile: "", status: "missing" },
    { id: "rear", label: "Rear", required: true, approvedFile: "", status: "missing" },
  ];
  character.candidateFiles = [
    { stored: "CHAR-NORA-FRONT-A.png", original: "CHAR-NORA-FRONT-A.png", decision: "unreviewed", targetStateId: "state-default", targetCoverageSlotId: "front", targetCoverageSlotName: "Front", coverageGroup: "angles", generationProvider: "fal" },
    { stored: "CHAR-NORA-FRONT-B.png", original: "CHAR-NORA-FRONT-B.png", decision: "unreviewed", targetStateId: "state-default", targetCoverageSlotId: "front", targetCoverageSlotName: "Front", coverageGroup: "angles", generationProvider: "fal" },
    { stored: "CHAR-NORA-REAR.png", original: "CHAR-NORA-REAR.png", decision: "unreviewed", targetStateId: "state-default", targetCoverageSlotId: "rear", targetCoverageSlotName: "Rear", coverageGroup: "angles", generationProvider: "fal" },
    { stored: "CHAR-NORA-NIGHT.png", original: "CHAR-NORA-NIGHT.png", decision: "unreviewed", targetStateId: "state-night", targetStateName: "After the night's work", generationProvider: "upload" },
    { stored: "CHAR-NORA-SHEET.png", original: "CHAR-NORA-SHEET.png", decision: "unreviewed", coverageJobType: "sheet", coverageSheetType: "angles", generationProvider: "fal" },
  ];
  project.shots[0].characters = [character.id];
  return project;
}

function scan() {
  const names = ["CHAR-NORA-PRIMARY.png", "CHAR-NORA-FRONT-A.png", "CHAR-NORA-FRONT-B.png", "CHAR-NORA-REAR.png", "CHAR-NORA-NIGHT.png", "CHAR-NORA-SHEET.png"];
  return {
    anchors: names.map((name) => ({ name, url: `/assets/anchors/${name}` })),
    plates: [], props: [], vehicles: [], audio: [], media: [],
    shots: { "L1-01": { takes: [], locked: [] } },
  };
}

async function testDerivedProfilePromptAndPersistence() {
  const project = fixture();
  const rendered = await render("#/character/CHAR-NORA", project, {
    scan: scan(),
    storage: {
      "cinebraid-focused:fixture:entity-task:characters:CHAR-NORA": "states",
      "cinebraid-section:fixture:entity:characters:CHAR-NORA:continuity-states": "1",
      "cinebraid-section:fixture:entity:characters:CHAR-NORA:state-generation:state-night": "1",
    },
    fetch: async (url, options, respond) => {
      if (url === "/api/prompt/asset-compile") {
        const body = JSON.parse(options.body || "{}");
        assert.strictEqual(body.profileId, "gpt-image-2/edit", "parent-derived states must compile against the edit/reference profile");
        return respond({
          compiledPrompt: "Edit the approved parent reference so only the coveralls become dirty and worn. Preserve identity and proportions.",
          profile: { id: body.profileId, name: "GPT Image 2 — Reference Edit", profileVersion: "test" },
          state: { generationMode: "derive", parentStateId: "state-default", parentStateName: "Clean overall" },
          warnings: [], confirmations: [], spec: {}, providerPayload: null, llmUsed: false,
        });
      }
      return null;
    },
  });
  assert(rendered.html.includes("GPT Image 2 — Reference Edit"), "derived-state prompt target must visibly default to GPT Image 2 Reference Edit");
  assert(rendered.html.includes('data-entity-continuity="characters:CHAR-NORA" open'), "Continuity States must restore its open state");
  assert(rendered.html.includes('data-entity-state-generation="state-night" open'), "the exact state generation panel must restore its open state");
  assert(rendered.html.includes("Automate After the night&#39;s work</b><small>") || rendered.html.includes("Automate After the night's work</b><small>"), "automation title and explanation must be separate elements");
  assert(rendered.html.includes('class="state-generation-guidance"'), "state generation guidance must use explicit semantic rows instead of overlapping raw text");
  assert(rendered.html.includes("<b>Manual generate</b><span>Returns one candidate batch only.</span>"), "manual generation guidance must keep its label and description separate");
  assert(rendered.html.includes("<b>Automate state</b><span>Runs review"), "automation guidance must keep its label and description separate");

  await rendered.context.buildEntityStatePrompt("characters", "CHAR-NORA", "state-night", false);
  await delay(40);
  const result = vm.runInContext(`(() => { const s=P.characters[0].continuityStates.find(x=>x.id==='state-night'); const b=s.assetPromptBuilds.at(-1); return {count:s.assetPromptBuilds.length, profile:b?.profileId, prompt:b?.prompt || ''}; })()`, rendered.context);
  assert.strictEqual(result.count, 1, "state prompt build must persist instead of failing with x is not defined");
  assert.strictEqual(result.profile, "gpt-image-2/edit", "saved derived-state builds must record the edit profile");
  assert(result.prompt.includes("approved parent reference"), "compiled state prompt must be saved");
}

async function testInboxGatingFiltersAndBatchPartialResults() {
  const project = fixture();
  const reviewScores = {
    "CHAR-NORA-FRONT-A.png": { score: 88, pass: true },
    "CHAR-NORA-FRONT-B.png": { score: 91, pass: true },
    "CHAR-NORA-NIGHT.png": { score: 84, pass: true },
    "CHAR-NORA-SHEET.png": { score: 90, pass: true },
  };
  const rendered = await render("#/character/CHAR-NORA", project, {
    scan: scan(),
    storage: { "cinebraid-focused:fixture:entity-task:characters:CHAR-NORA": "candidates" },
    fetch: async (url, options, respond) => {
      if (url === "/api/llm/review-entity-candidate") {
        const body = JSON.parse(options.body || "{}");
        if (body.fileName === "CHAR-NORA-REAR.png") return respond({ error: "Malformed vision result" }, 500);
        const scored = reviewScores[body.fileName] || { score: 72, pass: false };
        return respond({ review: { ...scored, summary: scored.pass ? "Meets the target." : "Needs correction.", categories: {} }, inputLabels: ["candidate", "target"] });
      }
      return null;
    },
  });
  const html = rendered.html;
  for (const label of ["Primary / State", "Coverage Views", "Sheets", "Expressions"]) assert(html.includes(label), `candidate inbox must expose the ${label} filter`);
  assert(html.includes("REVIEW ALL VISIBLE"), "candidate inbox must expose Review All Visible as a first-class action");
  assert(html.includes("REVIEW UNREVIEWED"), "candidate inbox must expose Review Unreviewed");
  assert(html.includes("RE-REVIEW ALL"), "candidate inbox must expose Re-review All");
  assert(html.includes("ASSIGN TO FRONT"), "manual-first candidates must allow direct human assignment");
  assert(html.includes("OPTIONAL AI CHECK"), "vision-capable projects must retain optional AI evidence");
  assert(html.includes("human-approval-action"), "human approval must remain a first-class enabled action");
  const workflowLabels = vm.runInContext(`(() => { const e=P.characters[0]; return ['CHAR-NORA-FRONT-A.png','CHAR-NORA-NIGHT.png','CHAR-NORA-SHEET.png'].map(file=>entityCandidateWorkflowLabel(e,file)); })()`, rendered.context);
  assert.deepStrictEqual(Array.from(workflowLabels), ["COVERAGE VIEW", "PRIMARY / STATE", "REFERENCE SHEET"], "candidate cards must identify their workflow contract");

  await rendered.context.reviewEntityCandidatesBatch("characters", "CHAR-NORA", "unreviewed", false);
  await delay(60);
  const run = vm.runInContext(`(() => { const e=P.characters[0]; const r=e.candidateReviewBatches.at(-1); return {status:r.status,total:r.total,completed:r.completed,failed:r.failed,results:r.results.map(x=>({file:x.fileName,score:x.score,pass:x.pass,status:x.status})),shortlist:r.shortlist}; })()`, rendered.context);
  assert.strictEqual(run.status, "partial", "one malformed review must produce a partial batch rather than losing the run");
  assert.strictEqual(run.total, 5, "the batch must include all unreviewed candidates in the active workflow filter");
  assert.strictEqual(run.completed, 5, "the batch must continue through every candidate after one failure");
  assert.strictEqual(run.failed, 1, "the malformed result must be isolated as one failed candidate");
  const front = run.shortlist.find((item) => item.label === "Front");
  assert.strictEqual(front.bestFileName, "CHAR-NORA-FRONT-B.png", "the shortlist must rank the strongest passing candidate per target");
  assert.strictEqual(front.bestScore, 91, "shortlist ranking must preserve the winning score");
  const rear = run.shortlist.find((item) => item.label === "Rear");
  assert.strictEqual(rear.bestFileName, "", "failed targets must end with no passing candidate rather than a false approval");
  const stateReview = vm.runInContext(`P.characters[0].candidateFiles.find(x=>x.stored==='CHAR-NORA-NIGHT.png').structuredReviews['state-night']`, rendered.context);
  assert.strictEqual(stateReview.score, 84, "each successful result must persist independently as it returns");
}

function testNormalizationAndSourceContracts() {
  const app = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  const server = fs.readFileSync(path.join(__dirname, "..", "src/server/server.js"), "utf8");
  const creation = fs.readFileSync(path.join(__dirname, "..", "public", "creation-studio.js"), "utf8");
  assert(!creation.includes("enforceLockedAssetSheetPrompt(list, x, d.compiledPrompt)"), "state prompt builder must not retain the undefined x reference");
  assert(!creation.includes("assetPromptRequestsReferenceSheet(list, x)"), "state prompt warnings must use the actual entity");
  assert(app.includes('/\\b(front|frontal)\\b/'), "client coverage migration must use real word-boundary aliases");
  assert(app.includes('/\\b(rear|back)\\b/'), "rear/back aliases must normalize into the standard Rear slot");
  assert(server.includes("function builderCoverageAlias"), "server import normalization must map verbose imported angles into standard slots");
  assert(server.includes("Imported view detail:"), "verbose imported angle descriptions must enrich the canonical slot rather than create a duplicate required slot");
  assert(server.includes("existing = slots.find((slot) => slot.id === alias)"), "duplicate aliases must merge into the same canonical slot");
}

async function main() {
  testNormalizationAndSourceContracts();
  await testDerivedProfilePromptAndPersistence();
  await testInboxGatingFiltersAndBatchPartialResults();
  console.log("Reference workflow repair suite passed the state-prompt crash fix, parent-edit defaults, disclosure persistence, typography separation, imported-angle normalization, explicit review gates, workflow filters, bounded partial batch review, independent persistence, and shortlist ranking.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});

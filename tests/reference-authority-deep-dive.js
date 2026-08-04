const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { render, buildFixture } = require("./render-harness");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function scanFor(project) {
  const scan = { anchors: [], plates: [], props: [], vehicles: [], audio: [], media: [], shots: {} };
  const add = (folder, name) => { if (name && !scan[folder].some((row) => row.name === name)) scan[folder].push({ name, url: `/assets/${folder}/${name}` }); };
  for (const row of project.characters || []) {
    add("anchors", row.approvedFile);
    for (const slot of [...(row.coverageSlots || []), ...(row.expressionSlots || [])]) add("anchors", slot.approvedFile);
    for (const candidate of row.candidateFiles || []) add("anchors", candidate.stored || candidate.name);
  }
  for (const row of project.locations || []) {
    add("plates", row.approvedFile);
    for (const slot of row.coverageSlots || []) add("plates", slot.approvedFile);
    for (const candidate of row.candidateFiles || []) add("plates", candidate.stored || candidate.name);
  }
  for (const row of project.props || []) {
    add("props", row.approvedFile);
    for (const state of row.continuityStates || []) add("props", state.approvedFile);
    for (const candidate of row.candidateFiles || []) add("props", candidate.stored || candidate.name);
  }
  return scan;
}

async function testLocationAuthorityPackage() {
  const project = buildFixture();
  project.locations = [{
    id: "LOC-SPATIAL",
    name: "Civic baths",
    notes: "One exact tiled pool room with fixed windows, railings, doors and drains.",
    approvedFile: "LOC-SPATIAL-MASTER.png",
    continuityStates: [{ id: "state-default", name: "Night", isDefault: true, approvedFile: "LOC-SPATIAL-MASTER.png", notes: "Lamp-lit." }],
    coverageSlots: [
      { id: "establishing", label: "Master establishing", required: true, approvedFile: "LOC-SPATIAL-MASTER.png" },
      { id: "reverse", label: "Reverse angle", required: true, approvedFile: "LOC-SPATIAL-REVERSE.png" },
      { id: "left-coverage", label: "Left coverage", required: true, approvedFile: "" },
    ],
    candidateFiles: [],
  }];
  let submitted = null;
  const rendered = await render("#/location/LOC-SPATIAL", project, {
    scan: scanFor(project),
    storage: { "cinebraid-focused:fixture:entity-task:locations:LOC-SPATIAL": "coverage" },
    fetch: async (url, options, respond) => {
      if (url === "/api/generation/fal/status") return respond({ enabled: true, configured: true, defaults: {} });
      if (url === "/api/generation/fal/jobs" && options.method === "POST") {
        submitted = JSON.parse(options.body);
        return respond({ ok: true, job: { id: "location-coverage-job", purpose: "entity-reference", entityList: "locations", entityId: "LOC-SPATIAL", coverageJobType: "slot", targetCoverageSlotId: "left-coverage", status: "IN_QUEUE", outputCount: 3 } });
      }
      return null;
    },
  });
  vm.runInContext(`CONFIG.generation=CONFIG.generation||{};CONFIG.generation.fal={enabled:true,apiKey:'test'};pollFalGeneration=()=>{};`, rendered.context);
  await rendered.context.generateCoverageSlot("locations", "LOC-SPATIAL", "left-coverage");
  assert(submitted, "location slot generation must submit a job");
  assert.strictEqual(submitted.authorityContractVersion, "reference-authority-v2");
  assert(submitted.prompt.includes("SPATIAL CONTINUITY LOCK"), "location prompts must carry the hard spatial lock");
  assert(submitted.prompt.includes("Do not invent, remove, mirror, relocate or redesign architecture"));
  assert(submitted.references.some((ref) => ref.url.endsWith("LOC-SPATIAL-MASTER.png")));
  assert(submitted.references.some((ref) => ref.url.endsWith("LOC-SPATIAL-REVERSE.png")), "every approved location angle must join the generation authority package");
  assert(submitted.references.every((ref) => ref.role === "location-geometry"), "location references must be labelled as shared geometry authority");
}

async function testImportedMappingAndAssignment() {
  const project = buildFixture();
  const character = project.characters[0];
  character.id = "CHAR-IMPORT";
  character.name = "Imported character";
  character.approvedFile = "CHAR-IMPORT-PRIMARY.png";
  character.continuityStates = [{ id: "state-default", name: "Default", isDefault: true, approvedFile: "CHAR-IMPORT-PRIMARY.png" }];
  character.coverageSlots = [
    { id: "front", label: "Front", required: true, approvedFile: "" },
    { id: "profile", label: "Profile", required: true, approvedFile: "" },
  ];
  character.candidateFiles = [{ stored: "CHAR-IMPORT-PROFILE.png", original: "CHAR-IMPORT-PROFILE.png", decision: "unreviewed" }];
  const rendered = await render("#/character/CHAR-IMPORT", project, { scan: scanFor(project), storage: { "cinebraid-focused:fixture:entity-task:characters:CHAR-IMPORT": "coverage" } });
  rendered.context.openImportedReferenceMapper("characters", "CHAR-IMPORT");
  rendered.context.document.getElementById("import-reference-file").value = "CHAR-IMPORT-PROFILE.png";
  rendered.context.document.getElementById("import-reference-target").value = "coverage:profile";
  rendered.context.confirmImportedReferenceMapping(false);
  await delay(30);
  const mapped = vm.runInContext(`P.characters[0].candidateFiles.find((row)=>row.stored==='CHAR-IMPORT-PROFILE.png')`, rendered.context);
  assert.strictEqual(mapped.targetCoverageSlotId, "profile");
  assert.strictEqual(mapped.targetCoverageSlotName, "Profile");
  assert.strictEqual(mapped.coverageGroup, "angles");
  assert.strictEqual(mapped.coverageJobType, "imported-reference");
  assert.strictEqual(mapped.reviewRequired, true);

  mapped.structuredReviews = { "state-default": { contractVersion: "reference-authority-v2", score: 92, pass: true, stateId: "state-default", stateName: "Default", reviewedAt: new Date().toISOString() } };
  rendered.context.approveCoverageCandidate("characters", "CHAR-IMPORT", "CHAR-IMPORT-PROFILE.png", "profile");
  const assigned = vm.runInContext(`P.characters[0].coverageSlots.find((slot)=>slot.id==='profile').approvedFile`, rendered.context);
  assert.strictEqual(assigned, "CHAR-IMPORT-PROFILE.png", "a current passing imported review must assign the exact target slot");
}

async function testStaleReviewCannotAssign() {
  const project = buildFixture();
  const character = project.characters[0];
  character.id = "CHAR-STALE";
  character.approvedFile = "CHAR-STALE-PRIMARY.png";
  character.continuityStates = [{ id: "state-default", name: "Default", isDefault: true, approvedFile: "CHAR-STALE-PRIMARY.png" }];
  character.coverageSlots = [{ id: "front", label: "Front", required: true, approvedFile: "" }];
  character.candidateFiles = [{ stored: "CHAR-STALE-FRONT.png", decision: "unreviewed", targetCoverageSlotId: "front", targetCoverageSlotName: "Front", coverageGroup: "angles", targetStateId: "state-default", structuredReviews: { "state-default": { score: 95, pass: true, reviewedAt: "2026-07-01T00:00:00Z" } } }];
  const rendered = await render("#/character/CHAR-STALE", project, { scan: scanFor(project), storage: { "cinebraid-focused:fixture:entity-task:characters:CHAR-STALE": "review" } });
  rendered.context.approveCoverageCandidate("characters", "CHAR-STALE", "CHAR-STALE-FRONT.png", "front");
  const slot = vm.runInContext(`P.characters[0].coverageSlots[0].approvedFile`, rendered.context);
  assert.strictEqual(slot, "", "legacy reviews must not authorize a current coverage assignment");
  assert(rendered.context.document.getElementById("main").innerHTML.includes("PREVIOUS REVIEW / RE-RUN REQUIRED"), "old reviews must remain visible but clearly stale");
}

async function testActivityDismissControls() {
  const project = buildFixture();
  const rendered = await render("#/production", project);
  vm.runInContext(`AUTOMATION_RUNS=[{id:'old-failure',type:'entity-chain',targetId:'props:PROP-MURAL',label:'Mural continuity references',status:'failed',stage:'Needs attention',updatedAt:'2026-07-30T20:00:00Z',steps:{prompt:{key:'prompt',kind:'prompt',status:'failed',error:'Prompt was not built'}}}];V641_ACTIVITY_DRAWER_OPEN=true;v641RenderActivityDrawer();`, rendered.context);
  const html = rendered.context.document.getElementById("automation-activity-drawer").innerHTML;
  assert(html.includes("DISMISS PREVIOUS ALERTS"));
  assert(html.includes("DISMISS"));
  assert.strictEqual(typeof rendered.context.dismissAutomationActivityRun, "function");
  assert.strictEqual(typeof rendered.context.archivePreviousAutomationFailures, "function");
}


async function testAutomationReviewPersistenceAndCorrection() {
  const project = buildFixture();
  const prop = project.props[0];
  prop.id = "PROP-PHOTO";
  prop.name = "1974 snapshot";
  prop.approvedFile = "PROP-PHOTO-PRIMARY.png";
  prop.continuityStates = [
    { id: "state-default", name: "Creased, in hand", isDefault: true, approvedFile: "PROP-PHOTO-PRIMARY.png" },
    { id: "state-taped", name: "Taped to tile", parentStateId: "state-default", approvedFile: "", delta: "Same exact photograph, taped to the tile." },
  ];
  prop.candidateFiles = [{ stored: "PROP-PHOTO-CANDIDATE.png", decision: "unreviewed", targetStateId: "state-taped" }];
  const rendered = await render("#/prop/PROP-PHOTO", project, { scan: scanFor(project) });
  const reviewData = {
    contractVersion: "reference-authority-v2",
    authoritySignature: "authority-123",
    inputLabels: [{ image: 1, fileName: "PROP-PHOTO-CANDIDATE.png", role: "candidate under review" }, { image: 2, fileName: "PROP-PHOTO-PRIMARY.png", role: "exact parent-state editable authority" }],
    review: {
      contractVersion: "reference-authority-v2", score: 94, pass: false, modelPass: true, explicitPass: true, explicitScore: true,
      hardGateFailures: ["sameEmbeddedContent", "category:major"],
      hardChecks: { sameEmbeddedContent: { required: true, pass: false, note: "The photograph inside the paper was replaced." } },
      categories: { state: { severity: "major", note: "The taped version changed unrelated image content." } },
      summary: "Reject because the embedded photograph is not the approved photograph.",
    },
  };
  const stored = rendered.context.v663StoreEntityAutomationReview(prop, prop.continuityStates[1], "PROP-PHOTO-CANDIDATE.png", reviewData);
  assert.strictEqual(stored.source, "state-automation");
  assert.strictEqual(stored.contractVersion, "reference-authority-v2");
  assert.strictEqual(prop.candidateFiles[0].structuredReviews["state-taped"].authoritySignature, "authority-123");
  const correction = rendered.context.v663EntityReviewCorrection(stored, "props");
  assert(correction.includes("Preserve the exact embedded photograph"));
  assert(correction.includes("Do not replace, redraw, restage, or reinterpret any photograph"));
  assert(correction.includes("The photograph inside the paper was replaced."));
}

function testSourceContracts() {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const generation = fs.readFileSync(path.join(__dirname, "..", "public", "fal-generation.js"), "utf8");
  assert(server.includes('const ENTITY_REFERENCE_REVIEW_CONTRACT_VERSION = "reference-authority-v2"'));
  assert(server.includes('hardGateFailures.push(`category:${worstSeverity}`)'), "major/blocking category findings must override a model pass");
  assert(server.includes('hardGateFailures.push("score-below-85")'));
  assert(server.includes('requiredHardChecks.includes("sameEmbeddedContent")') || server.includes('required.push("sameEmbeddedContent")'));
  assert(generation.includes("OBJECT/CONTENT LOCK"));
  assert(generation.includes("SPATIAL LOCK"));
}

async function main() {
  testSourceContracts();
  await testLocationAuthorityPackage();
  await testImportedMappingAndAssignment();
  await testStaleReviewCannotAssign();
  await testActivityDismissControls();
  await testAutomationReviewPersistenceAndCorrection();
  console.log("Reference authority deep-dive suite passed strict review gates, all-angle location authority, imported mapping, exact slot assignment, stale-review blocking, and dismissible legacy alerts, and durable automation review correction feedback.");
  process.exit(0);
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });

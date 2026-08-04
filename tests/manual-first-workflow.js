const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { render, buildFixture } = require("./render-harness");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

function disabledAgents() {
  const unavailable = (label) => ({ ready: false, label, provider: "none", model: "", message: `${label} is disabled.`, action: "" });
  return {
    enabled: false,
    manualMode: true,
    capabilities: {
      text: unavailable("Text assistance"),
      verifier: unavailable("Prompt verification"),
      vision: unavailable("Vision assistance"),
      embedding: unavailable("Local semantic search"),
      technical: unavailable("Technical analysis"),
    },
    agents: [],
  };
}

function manualProject() {
  const project = buildFixture();
  project.meta.workflowEmphasis = "manual";
  const character = project.characters[0];
  character.approvedFile = "KAI-ANCHOR.png";
  character.continuityStates = [{ id: "state-default", name: "Clean coverall", isDefault: true, approvedFile: "KAI-ANCHOR.png", notes: "Primary authority." }];
  character.coverageSlots = [
    { id: "front", label: "Front", required: true, requirement: "required", approvedFile: "" },
    { id: "front-three-quarter", label: "3/4 front", required: false, requirement: "planned", approvedFile: "" },
    { id: "profile", label: "Profile", required: false, requirement: "planned", approvedFile: "" },
    { id: "rear", label: "Rear", required: false, requirement: "not-required", approvedFile: "" },
    { id: "detail-face", label: "Face / detail", required: false, requirement: "not-required", approvedFile: "" },
    { id: "expression", label: "Expression / optional detail", required: false, requirement: "not-required", approvedFile: "" },
  ];
  character.candidateFiles = [{
    stored: "KAI-FRONT-IMPORTED.png",
    original: "KAI-FRONT-IMPORTED.png",
    targetCoverageSlotId: "front",
    targetCoverageSlotName: "Front",
    coverageGroup: "angles",
    decision: "unreviewed",
  }];
  project.mediaAssets.push({ id: "manual-frame", file: "MANUAL_FRAME.png", originalName: "MANUAL_FRAME.png", title: "Manual frame", links: [] });
  for (const frame of project.shots[0].keyframes || []) frame.winner = "";
  return project;
}

async function testManualReferencePath() {
  const project = manualProject();
  const scan = {
    anchors: [
      { name: "KAI-ANCHOR.png", url: "/assets/anchors/KAI-ANCHOR.png" },
      { name: "KAI-FRONT-IMPORTED.png", url: "/assets/anchors/KAI-FRONT-IMPORTED.png" },
    ],
    plates: [{ name: "LOC-HULL-PLATE.png", url: "/assets/plates/LOC-HULL-PLATE.png" }],
    props: [{ name: "PR-TOOL-PLATE.png", url: "/assets/props/PR-TOOL-PLATE.png" }],
    vehicles: [], audio: [], media: [{ name: "MANUAL_FRAME.png", url: "/assets/media/MANUAL_FRAME.png" }],
    shots: { "L1-01": [{ name: "FRAME_A.png", url: "/assets/shots/L1-01/FRAME_A.png" }, { name: "FRAME_B.png", url: "/assets/shots/L1-01/FRAME_B.png" }] },
  };
  const storage = { "cinebraid-focused:fixture:entity-task:characters:KAI": "reference" };
  const reference = await render("#/character/KAI", project, { scan, storage, agentStatus: disabledAgents() });
  assert(reference.html.includes("UPLOAD &amp; ORGANIZE") || reference.html.includes("UPLOAD & ORGANIZE"), "manual reference hub must lead the page");
  assert(reference.html.includes("Human approval is enough"));
  assert(reference.html.includes("Map imported references"));
  assert(reference.html.includes("OPTIONAL ASSISTED TOOLS"));
  assert(!/<details class="reference-assisted-tools"[^>]*\sopen(?:\s|>)/.test(reference.html), "assisted tools must be collapsed in manual-first projects");

  const reviewStorage = { "cinebraid-focused:fixture:entity-task:characters:KAI": "review" };
  const review = await render("#/character/KAI", project, { scan, storage: reviewStorage, agentStatus: disabledAgents() });
  assert(review.html.includes("ASSIGN TO FRONT"), "imported coverage must have a direct human assignment action");
  assert(!review.html.includes("REVIEW → ASSIGN"), "human assignment must not be presented as AI-gated");
  assert(!review.html.includes("OPTIONAL AI CHECK"), "disabled AI must not occupy candidate-card space");
  assert(!review.html.includes("Optional batch AI check"), "disabled AI must not occupy the manual candidate workspace");
  assert(!/human-approval-action[^>]*disabled/.test(review.html), "human approval action must remain enabled without AI");

  vm.runInContext(`confirmModal=(message,commit)=>commit();`, review.context);
  review.context.requestHumanEntityCandidateApproval("characters", "KAI", "KAI-FRONT-IMPORTED.png", "state-default", "coverage");
  const character = vm.runInContext(`P.characters.find((row) => row.id === "KAI")`, review.context);
  assert.strictEqual(character.coverageSlots[0].approvedFile, "KAI-FRONT-IMPORTED.png");
  assert.strictEqual(character.candidateFiles[0].humanApproved, true);
  assert.strictEqual(character.candidateFiles[0].humanApprovedWithoutAI, true);
  assert.strictEqual(character.candidateFiles[0].approvalProvenance.source, "human");

  const stats = vm.runInContext(`coverageStats(P.characters.find((row) => row.id === "KAI").coverageSlots)`, review.context);
  assert.strictEqual(stats.required, 1, "only explicit required views affect readiness");
  assert.strictEqual(stats.planned, 2);
  assert.strictEqual(stats.notRequired, 3);
  assert.strictEqual(stats.missingRequired, 0);
}

async function testManualShotAndApprovedLibrary() {
  const project = manualProject();
  const storage = { "cinebraid-focused:fixture:shot-task:L1-01": "frames" };
  const shot = await render("#/shot/L1-01", project, { storage, agentStatus: disabledAgents() });
  assert(shot.html.includes("Import, choose, and approve images"));
  assert(shot.html.includes("Add shot image") || shot.html.includes("Choose frame"), "manual frame intake must be the next action");
  const dropIndex = shot.html.indexOf("guided-frame-dropzone");
  const assistedIndex = shot.html.indexOf("OPTIONAL ASSISTED CREATION");
  assert(dropIndex >= 0 && assistedIndex > dropIndex, "manual result intake must appear before prompt generation tools");
  assert(!/frame-assisted-tools[^>]*open/.test(shot.html), "frame prompt tools must be collapsed when no assisted operation is active");
  assert(shot.html.indexOf("guided-frame-workflow") < shot.html.indexOf("shot-stage-automation"), "manual frame workflow must appear before automation");

  const approved = await render("#/library/approved", project, { agentStatus: disabledAgents() });
  /* The heading stays the canonical section name ("References") so navigation, heading
     and breadcrumb agree; the approved-only view is distinguished by its subtitle. */
  assert(approved.html.includes('<span class="view-title">References</span>'));
  assert(approved.html.includes("Candidates and automation are hidden"));
  assert(!approved.html.includes("AWAITING REVIEW"));
  assert(!approved.html.includes("AI REVIEW"));
}

function testSourceContracts() {
  const pkg = JSON.parse(read("package.json"));
  const entities = read("public/entities.js");
  const creation = read("public/creation-studio.js");
  const views = read("public/views.js");
  assert.strictEqual(pkg.version, "6.6.4-studio.repair.13");
  assert(entities.includes("requestHumanEntityCandidateApproval"));
  assert(entities.includes('referenceRequirement: "planned"'));
  assert(entities.includes("Required for this project"));
  assert(creation.toLowerCase().includes("optional assisted creation"));
  assert(creation.includes("Import, choose, and approve images"));
  assert(views.includes("Manual-first production"));
}

async function main() {
  testSourceContracts();
  await testManualReferencePath();
  await testManualShotAndApprovedLibrary();
  console.log("Manual-first workflow suite passed provider-free reference organization, human approval provenance, explicit requirement states, approved-library browsing, manual frame intake, and collapsed assisted tools.");
}
main().catch((error) => { console.error(error.stack || error); process.exit(1); });

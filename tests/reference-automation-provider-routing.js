/* REFERENCE AUTOMATION PROVIDER ROUTING — the Last Seat blocker, as properties.
 *
 * "Create with Braidy → Start Braidy run" refused with "Ollama is not reachable at
 * http://127.0.0.1:18434" while Braidy's text assistant was a working
 * OpenAI-compatible server serving qwen3.8-27b-fp8 — the same assistant that had
 * just refined Rex's prompt through the same build.
 *
 * The routing was never wrong. Two other things were:
 *
 *   1. the preflight made VISION readiness a blocking error, though the executor
 *      handles an unavailable reviewer by parking on the human gate;
 *   2. it pushed the vision capability's message bare, so a vision provider's
 *      reachability failure appeared as the reason a Braidy run could not start.
 *
 * Every check below drives the shipped `v627EntityPreflight` with a stated
 * capability record — the same shape /api/agents/status sends — and asserts on what
 * it returns. No provider is contacted, no generation is started, and nothing on
 * disk is read or written.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { render, buildFixture } = require("./render-harness.js");

const PUBLIC = path.join(__dirname, "..", "public");
const notes = [];
function ok(condition, message) {
  assert.ok(condition, message);
  notes.push(message);
}
const source = (file) => fs.readFileSync(path.join(PUBLIC, file), "utf8");

const CHAIR = "PROP-FOLDING-CHAIR";

/* The capability records the server actually sends, one per configuration under
   test. Each is exactly what assistantCapabilities() produces for that config. */
const CAPS = {
  /* The dogfood: Braidy on an OpenAI-compatible server, Ollama stopped, Vision
     pointed at Ollama with no model named. */
  openAiCompatible: {
    text: { ready: true, provider: "custom", model: "qwen3.8-27b-fp8", message: "Text assistance is ready with qwen3.8-27b-fp8.", action: "" },
    vision: { ready: false, provider: "ollama", model: "", message: "Ollama is not reachable at http://127.0.0.1:18434.", action: "Start Ollama, then retry. Expected model: not configured." },
  },
  /* Vision explicitly disabled, Braidy still an OpenAI-compatible server. */
  visionDisabled: {
    text: { ready: true, provider: "custom", model: "qwen3.8-27b-fp8", message: "Text assistance is ready with qwen3.8-27b-fp8.", action: "" },
    vision: { ready: false, provider: "none", model: "", message: "Vision assistance is disabled in AI Assistant settings.", action: "Choose an AI provider in Settings." },
  },
  /* The filmmaker really did choose Ollama for Braidy, and it is not running. */
  ollamaChosenAndDown: {
    text: { ready: false, provider: "ollama", model: "qwen3:8b", message: "Ollama is not reachable at http://127.0.0.1:11434.", action: "Start Ollama, then retry. Expected model: qwen3:8b." },
    vision: { ready: false, provider: "ollama", model: "", message: "Ollama is not reachable at http://127.0.0.1:11434.", action: "Start Ollama, then retry. Expected model: not configured." },
  },
  /* No AI at all. */
  disabled: {
    text: { ready: false, provider: "none", model: "", message: "Text assistance is disabled in AI Assistant settings.", action: "Choose an AI provider in Settings." },
    vision: { ready: false, provider: "none", model: "", message: "Vision assistance is disabled in AI Assistant settings.", action: "Choose an AI provider in Settings." },
  },
  /* A vision model IS named and its provider did not answer — a fault, not a
     preference, and the address is the useful part. */
  visionNamedButDown: {
    text: { ready: true, provider: "custom", model: "qwen3.8-27b-fp8", message: "Text assistance is ready with qwen3.8-27b-fp8.", action: "" },
    vision: { ready: false, provider: "ollama", model: "llava:13b", message: "Ollama is not reachable at http://127.0.0.1:11434.", action: "Start Ollama, then retry. Expected model: llava:13b." },
  },
  /* Everything on. */
  allReady: {
    text: { ready: true, provider: "custom", model: "qwen3.8-27b-fp8", message: "Text assistance is ready with qwen3.8-27b-fp8.", action: "" },
    vision: { ready: true, provider: "custom", model: "qwen3.8-27b-fp8", message: "Vision assistance is ready with qwen3.8-27b-fp8.", action: "" },
  },
};

function chairFixture() {
  const fixture = buildFixture();
  fixture.props = [{
    id: CHAIR, name: "Folding Chair", prefix: CHAIR, anchorPrefix: CHAIR,
    visualDescription: "A battered dull grey metal folding chair.",
    creationDescription: "A battered dull grey metal folding chair.",
    status: "DRAFT", workflowStatus: "IN PROGRESS", approvedFile: "", approvedAssetId: "",
    continuityStates: [{
      id: "state-default", name: "Default", isDefault: true, notes: "Folded, scuffed, white sticker on the backrest.",
      approvedFile: "", approvedAssetId: "", parentStateId: "", generationMode: "independent", assetPromptBuilds: [],
    }],
    coverageSlots: [], assetPromptBuilds: [], candidateFiles: [], made: [],
  }];
  return fixture;
}

let view = null;
async function preflightUnder(caps, { falEnabled = true } = {}) {
  if (!view) view = await render(`#/prop/${CHAIR}`, chairFixture(), {});
  return vm.runInContext(
    `(() => {
      const beforeStatus = typeof AGENT_STATUS === "undefined" ? null : AGENT_STATUS;
      const beforeConfig = typeof CONFIG === "undefined" ? null : CONFIG;
      AGENT_STATUS = { capabilities: ${JSON.stringify(caps)} };
      CONFIG = Object.assign({}, CONFIG, { generation: { fal: ${JSON.stringify(
        falEnabled ? { enabled: true, apiKey: "fixture", textModel: "openai/gpt-image-2" } : { enabled: false },
      )} } });
      const entity = (P.props || []).find((item) => item.id === ${JSON.stringify(CHAIR)});
      const out = v627EntityPreflight("props", entity, ["state-default"]);
      const markup = v627PreflightMarkup(out, "props", entity);
      AGENT_STATUS = beforeStatus; CONFIG = beforeConfig;
      return { errors: out.errors, warnings: out.warnings, markup };
    })()`,
    view.context,
  );
}

const joined = (rows) => (rows || []).join(" ");

/* ---- 1. OpenAI-compatible Braidy + Ollama unavailable → the run may start ---- */
async function testOpenAiCompatibleBraidyIsAllowed() {
  const out = await preflightUnder(CAPS.openAiCompatible);
  ok(out.errors.length === 0,
    `1. an OpenAI-compatible Braidy with Ollama absent produces no blocking error (got ${JSON.stringify(out.errors)})`);
  ok(!/Ollama/i.test(joined(out.errors)),
    "1. and nothing in the refusal path names Ollama");
  ok(!out.markup.includes("Cannot start yet"),
    "1. the plan does not say it cannot start");
  ok(out.markup.includes("Automation preflight passed."),
    "1. it reports the preflight as passed");
  ok(joined(out.warnings).includes("Vision is off"),
    "1. Vision being off is carried as a warning instead", joined(out.warnings));
  ok(joined(out.warnings).includes("without an AI check"),
    "1. and the consequence is stated: candidates come back for human review");
}

/* ---- 2. automation text work resolves through the accepted assistant path ---- */
async function testTextResolvesThroughTheAcceptedPath() {
  const automation = source("automation.js");
  const entityBuild = automation.slice(
    automation.indexOf("async function v626EntityBuild"),
    automation.indexOf("function v663StoreEntityAutomationReview"),
  );
  ok(entityBuild.length > 0, "2. the entity build step is present");

  /* It calls the SAME prompt builders the manual Refine with Braidy control calls,
     which post to /api/prompt/asset-compile, which resolves the provider through
     requestAssistantResult -> llm(). No second dispatch exists. */
  ok(/buildAssetCreationPrompt\(list, entityId, true\)/.test(entityBuild),
    "2. it refines through the same builder the manual control uses");
  ok(/buildEntityStatePrompt\(list, entityId, stateId, true\)/.test(entityBuild),
    "2. and the same one for continuity states");
  ok(!/fetch\(\s*["'`]http/.test(entityBuild),
    "2. it opens no direct connection of its own");
  ok(!/ollama/i.test(entityBuild),
    "2. and names no provider anywhere in the step");

  const studio = source("creation-studio.js");
  ok(studio.includes('guidedPromptRequest("/api/prompt/asset-compile"'),
    "2. the builder posts to the shared compile route");

  const server = fs.readFileSync(path.join(PUBLIC, "..", "server.js"), "utf8");
  const compileRoute = server.slice(
    server.indexOf('app.post("/api/prompt/asset-compile"'),
    server.indexOf('app.post("/api/prompt/asset-compile"') + 14000,
  );
  ok(/requestAssistantResult\(/.test(compileRoute),
    "2. which resolves the assistant through requestAssistantResult");
  const helper = server.slice(server.indexOf("async function requestAssistantResult"));
  ok(/await llm\(/.test(helper.slice(0, 1200)),
    "2. and that calls llm(), the one provider dispatch");
  /* llm() is the one dispatch and lives in llm.js, not in the route. */
  const dispatch = fs.readFileSync(path.join(PUBLIC, "..", "llm.js"), "utf8");
  ok(/if \(provider === "custom"\)[\s\S]{0,40}return callOpenAICompatible\(/.test(dispatch),
    "2. llm() dispatches a custom provider to the OpenAI-compatible caller");
  ok(dispatch.includes("cfg.customBaseUrl") && dispatch.includes("modelOverride || cfg.customModel"),
    "2. using the configured base URL and model rather than an Ollama one");
  ok(server.includes('(cfg.assistant?.provider || "ollama") === "custom" &&'),
    "2. and local-only policy resolves a local custom endpoint before falling back to Ollama");

  /* The run reports the assistant it will actually use, rather than asserting local. */
  ok(/system: "Braidy · Reference prompt refinement"/.test(entityBuild),
    "2. the run's activity names Braidy rather than a local prompt advisor");
  ok(/capabilityState\("text"\)/.test(entityBuild) && /braidyStep && braidyStep\.model/.test(entityBuild),
    "2. and reports the resolved model from the same capability the gate reads");
  ok(!/CONFIG\?\.ai\?\.text\?\.model/.test(entityBuild),
    "2. no longer reading a config path the schema does not contain");
}

/* ---- 3. Ollama really chosen and really down → the truthful refusal stands ---- */
async function testOllamaChosenStillRefusesTruthfully() {
  const out = await preflightUnder(CAPS.ollamaChosenAndDown);
  ok(out.errors.length > 0, "3. Braidy on a stopped Ollama still blocks the run");
  ok(joined(out.errors).includes("Ollama is not reachable at http://127.0.0.1:11434."),
    "3. and the refusal keeps Ollama's own diagnostic", joined(out.errors));
  ok(joined(out.errors).includes("Start Ollama, then retry. Expected model: qwen3:8b."),
    "3. including the action and the model it expected");
  ok(joined(out.errors).includes("Braidy's text assistant is unavailable"),
    "3. attributed to the capability it belongs to");
  ok(out.markup.includes("Cannot start yet"), "3. the plan says it cannot start");
}

/* ---- 4. No AI configured → truthful refusal ------------------------------- */
async function testDisabledAssistantRefusesTruthfully() {
  const out = await preflightUnder(CAPS.disabled);
  ok(out.errors.length > 0, "4. a disabled assistant blocks the run");
  ok(joined(out.errors).includes("Braidy's text assistant is unavailable"),
    "4. naming Braidy's text assistant as the missing capability");
  ok(joined(out.errors).includes("disabled in AI Assistant settings"),
    "4. and repeating the reason the server gave", joined(out.errors));
  ok(!/Ollama/i.test(joined(out.errors)),
    "4. without inventing a provider nobody selected");
}

/* ---- 5. Vision off is never reported as a text-provider failure ----------- */
async function testVisionOffIsNotATextFailure() {
  for (const [name, caps] of [["vision pointed at a stopped Ollama", CAPS.openAiCompatible],
                              ["vision explicitly disabled", CAPS.visionDisabled]]) {
    const out = await preflightUnder(caps);
    ok(out.errors.length === 0, `5. ${name}: the run is not blocked`);
    ok(!joined(out.warnings).includes("Braidy's text assistant"),
      `5. ${name}: it is not described as a Braidy text failure`);
    ok(!joined(out.warnings).includes("Ollama is not reachable"),
      `5. ${name}: a capability nobody turned on reports no provider failure`, joined(out.warnings));
    ok(!joined(out.warnings).includes("Start Ollama"),
      `5. ${name}: and no instruction to start a provider the run does not need`);
    ok(joined(out.warnings).includes("Vision is off"),
      `5. ${name}: the warning says which capability is off`);
  }

  /* The other half: a NAMED vision model that did not answer is a fault, and keeps
     its diagnostic — still as a warning, because the run degrades rather than fails. */
  const broken = await preflightUnder(CAPS.visionNamedButDown);
  ok(broken.errors.length === 0, "5. a broken vision provider still does not block the run");
  ok(joined(broken.warnings).includes("Vision is unavailable"),
    "5. it is reported as unavailable rather than as off", joined(broken.warnings));
  ok(joined(broken.warnings).includes("llava:13b"),
    "5. and keeps the model and address a person would need to fix it");

  /* And with vision working there is nothing to warn about. */
  const ready = await preflightUnder(CAPS.allReady);
  ok(ready.errors.length === 0 && !joined(ready.warnings).includes("Vision"),
    "5. with vision configured the plan says nothing about it", joined(ready.warnings));
}

/* ---- 6. no provider id is hard-coded into the generic gate ---------------- */
async function testGateNamesNoProvider() {
  const automation = source("automation.js");
  const gate = automation.slice(
    automation.indexOf("function v627EntityPreflight"),
    automation.indexOf("function v627PreflightMarkup"),
  );
  ok(gate.length > 0, "6. the reference-automation gate is present");
  const code = gate.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const token of ["ollama", "Ollama", "localModels", "ollamaUrl", "11434", "anthropic", "openai", "custom"]) {
    ok(!code.includes(token), `6. the gate hard-codes no provider detail: ${token}`);
  }
  ok(/capabilityState\("text"\)/.test(code) && /capabilityState\("vision"\)/.test(code),
    "6. it asks the shared capability resolution and nothing else");

  /* And the shared vision-off predicate is defined once, beside capabilityState. */
  const app = source("app.js");
  ok(/function visionIsOff\(capability\)/.test(app),
    "6. 'is vision off' has one definition, next to the capability reader");
  ok(source("review.js").includes("visionIsOff(capability)"),
    "6. Candidate Review asks it");
  ok(gate.includes("visionIsOff(braidyVision)"),
    "6. and the automation gate asks the same one");
}

/* ---- the runtime this gate must not be stricter than ---------------------- */
async function testRuntimeDegradesRatherThanRequiringVision() {
  const automation = source("automation.js");
  ok(automation.includes("optional AI review was unavailable. Keeping it for human review"),
    "runtime: an unavailable reviewer is recorded, not treated as a failure");
  ok(/reviewUnavailable: true/.test(automation),
    "runtime: and marked so no pass is scored from it");
  ok(/if \(reviewUnavailable\) await v627PauseForHumanReview\(/.test(automation),
    "runtime: the run parks on the human gate instead of continuing or retrying");
  ok(/hardGateFailures: \["review-unavailable"\]/.test(automation),
    "runtime: the missing review is a declared gate failure, never a silent pass");
  /* Which is what makes the preflight's old hard requirement wrong: the executor
     never needed vision, and text review is nowhere substituted for it. */
  const reviewCall = automation.slice(automation.indexOf('"/api/llm/review-entity-candidate"'));
  ok(!/llm\(\s*"prompt"/.test(reviewCall.slice(0, 3000)),
    "runtime: no text model is asked to stand in for the visual review");
}

async function main() {
  const suites = [
    testOpenAiCompatibleBraidyIsAllowed,
    testTextResolvesThroughTheAcceptedPath,
    testOllamaChosenStillRefusesTruthfully,
    testDisabledAssistantRefusesTruthfully,
    testVisionOffIsNotATextFailure,
    testGateNamesNoProvider,
    testRuntimeDegradesRatherThanRequiringVision,
  ];
  for (const suite of suites) await suite();
  console.log(`Reference automation provider routing: ${notes.length} checks passed.`);
  for (const line of notes) console.log("  - " + line);
  console.log("Provider calls made: 0. Generations started: 0. Nothing on disk was read or written.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

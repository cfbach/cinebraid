/* GENERATION SURFACE POLISH V1 — the guarantees a composition pass can break.
 *
 * This slice moved where the frame's generation controls live. It changed no job, no
 * dispatch, no eligibility rule and no approval, so what is worth testing is not the
 * arrangement itself — it is the small number of ways an arrangement can lie:
 *
 *   a returned image cropped by a well shaped for something else;
 *   a Generate action that moved somewhere nobody finds it;
 *   a cost fact that ended up behind a disclosure;
 *   a local press and a paid press that became one control;
 *   a choice previewed on the card that the dialog then silently reset;
 *   a Review action pointing at a candidate other than the one it named;
 *   a panel that reflows a field out from under a cursor;
 *   a row that pushes the workspace sideways.
 *
 * Deliberately no pixel or colour assertions: those go red for a design decision and
 * stay red until somebody deletes them.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { render, buildFixture } = require("./render-harness");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const css = read("public/styles.css");
const studio = read("public/creation-studio.js");
const comfy = read("public/comfy-shot.js");

/* The declarations for one selector, matched as a whole selector rather than as a
   prefix of a longer one. */
function ruleFor(selector, source = css) {
  const blocks = [];
  let from = 0;
  while (true) {
    const at = source.indexOf(selector, from);
    if (at === -1) break;
    from = at + selector.length;
    const before = source[at - 1];
    const after = source[from];
    if (before && !/[\s,}{>+~]/.test(before)) continue;
    if (after && !/[\s,{]/.test(after)) continue;
    const open = source.indexOf("{", from);
    const close = source.indexOf("}", open);
    if (open === -1 || close === -1) continue;
    blocks.push(source.slice(open + 1, close));
  }
  return blocks.join(";");
}

/* Everything inside a CLOSED <details> is not on screen. This walks the same way
   tests/current-behavior.js counts a task's controls. */
function outsideClosedDisclosures(html, needle) {
  const stack = [];
  const token = /<\/?details\b[^>]*>|<[^>]*>/gi;
  let match;
  while ((match = token.exec(html))) {
    const tag = match[0];
    if (/^<details/i.test(tag)) { stack.push(/\sopen(?:\s|>|=)/i.test(tag)); continue; }
    if (/^<\/details/i.test(tag)) { stack.pop(); continue; }
    if (!tag.includes(needle)) continue;
    if (stack.some((open) => !open)) continue;
    return true;
  }
  return false;
}

function frameCard(html) {
  const start = html.indexOf('<details class="guided-frame-card');
  assert(start >= 0, "the shot workspace must render a frame card");
  const re = /<\/?details\b[^>]*>/gi;
  re.lastIndex = start;
  let depth = 0, match;
  while ((match = re.exec(html))) {
    depth += match[0][1] === "/" ? -1 : 1;
    if (depth === 0) return html.slice(start, re.lastIndex);
  }
  return html.slice(start);
}

/* A project whose Frame A carries a prepared prompt and a candidate that a generation
   job actually produced — the identity ingest stamps and the whole reason this surface
   can tell a returned result from an imported one. */
function generatingProject() {
  const project = buildFixture();
  const shot = project.shots[0];
  for (const frame of shot.keyframes || []) frame.winner = "";
  shot.winner = null;
  project.meta = project.meta || {};
  project.meta.workflowEmphasis = "assisted";
  shot.creationBrief = shot.creationBrief || {};
  shot.creationBrief.promptBuilds = [{
    id: "polish-build-1",
    packageId: "L1-01-FRAME-A-R01",
    date: "2026-09-05T10:00:00.000Z",
    profileId: "gpt-image-2/standard",
    profileName: "GPT Image 2",
    mode: "t2i",
    prompt: "A prepared frame prompt.\nSecond line.\nThird line.",
    inputs: {},
    references: [], warnings: [], confirmations: [], productionRisks: [],
  }];
  shot.candidateFiles = [{
    stored: "FRAME_A.png",
    original: "ComfyUI_00007_.png",
    addedAt: "2026-09-05T10:05:00.000Z",
    decision: "unreviewed",
    frameId: "frame-a",
    generationProvider: "ComfyUI",
    generationModel: "z-image-turbo-runnable-api.json",
    generationJobId: "comfy-job-fixture-1",
  }];
  return project;
}

/* The same frame BEFORE anything has come back: a prepared prompt, no returned result.
   This is the generation-ready phase, where the chosen path owns the leading action. */
function readyProject() {
  const project = generatingProject();
  project.shots[0].candidateFiles = [];
  return project;
}

/* An imported candidate on the same frame: waiting for a decision, produced by nobody. */
function importingProject() {
  const project = generatingProject();
  const shot = project.shots[0];
  shot.candidateFiles = [{
    stored: "FRAME_A.png",
    original: "FRAME_A.png",
    addedAt: "2026-09-05T10:05:00.000Z",
    decision: "unreviewed",
    frameId: "frame-a",
  }];
  return project;
}

const STORAGE = { "cinebraid-focused:fixture:shot-task:L1-01": "frames" };

/* Load the local backend into a rendered realm and give it a confirmed workflow. The
   render harness does not carry public/comfy-shot.js, which is why the surface guards
   every call to it — so a suite that wants the local path has to bring it. */
function withLocalBackend(result, workflows) {
  /* ONE SCRIPT, because `const COMFY_SHOT` at the top of that file is script-scoped
     rather than a property of the realm's global: a second runInContext() cannot see
     it. The seeding therefore rides along in the same evaluation, which is also the
     only honest way to do it — the registry state is the backend's own. */
  vm.runInContext(`${read("public/comfy-shot.js")}
    ;(() => {
      CONFIG.generation = CONFIG.generation || {};
      CONFIG.generation.comfy = { enabled: true, baseUrl: "http://127.0.0.1:8188", workflowFolder: "/tmp/workflows" };
      COMFY_SHOT.loadedWorkflows = true;
      COMFY_SHOT.loadedJobs = true;
      COMFY_SHOT.workflows = ${JSON.stringify(workflows)};
      COMFY_SHOT.jobs = [];
    })();
  `, result.context);
}
function withHostedBackend(result, { rate = 0.04 } = {}) {
  vm.runInContext(`
    CONFIG.generation = CONFIG.generation || {};
    CONFIG.generation.fal = { ...(CONFIG.generation.fal || {}), enabled: true, apiKey: "fixture-not-a-credential",
      estimatedCostPerImage: ${Number(rate)}, frameOutputs: 2 };
  `, result.context);
}
/* route() is async: reading the document before it settles reads the render BEFORE
   the backend was seeded, which is a green test measuring the wrong paint. */
async function repaint(result) {
  await vm.runInContext("route()", result.context);
  return result.map.get("main").innerHTML;
}

const READY_WORKFLOW = [{
  relativePath: "z-image-turbo-runnable-api.json",
  executable: true,
  state: "ready",
  reason: "",
  bindings: { positivePrompt: { nodeId: "67", input: "text" } },
}];
const CHANGED_WORKFLOW = [{
  relativePath: "z-image-turbo-runnable-api.json",
  executable: true,
  state: "changed",
  reason: "This workflow changed since its inputs were confirmed. Every confirmed input still fits.",
  bindings: { positivePrompt: { nodeId: "67", input: "text" } },
}];

/* ------------------------------------------------------------------ 1. the action */
async function testGenerateActionIsFindableAndOwned() {
  const result = await render("#/shot/L1-01", readyProject(), { storage: STORAGE });
  withLocalBackend(result, READY_WORKFLOW);
  const card = frameCard(await repaint(result));

  assert(card.includes('data-frame-execution="comfy"'), "a resolved local path must name itself on the execution block");
  assert(outsideClosedDisclosures(card, "comfy-generate-btn"),
    "the Generate action for the selected path must be reachable without opening a disclosure");
  assert(card.includes("openComfyGenerationModal("),
    "the local action must still go through the shipped local dispatch dialog");
  assert(card.includes("z-image-turbo-runnable-api.json"),
    "the workflow that will run must be named on the card, not only inside the dialog");
  /* The workflow's own filename and nothing else. A prompt profile is a compiler
     target; presenting one where the execution identity belongs is the confusion this
     block exists to end. */
  const identity = card.slice(card.indexOf('class="frame-execution-identity"'), card.indexOf('class="frame-execution-standing"'));
  assert(!identity.includes("GPT Image 2"),
    "a prompt profile name must never stand in for the execution workflow identity");
}

/* --------------------------------------------------------- 2. local is not paid */
async function testLocalAndPaidStaySeparate() {
  const local = await render("#/shot/L1-01", readyProject(), { storage: STORAGE });
  withLocalBackend(local, READY_WORKFLOW);
  const localCard = frameCard(await repaint(local));
  assert(localCard.includes('data-frame-execution-paid="0"'), "the local path must declare itself unpaid");
  assert(/no provider charge/i.test(localCard), "the local path must state that no provider will charge for it");
  assert(!localCard.includes("fal-generate-btn"),
    "a card showing only the local path must not also draw the paid dispatch control");

  const hosted = await render("#/shot/L1-01", readyProject(), { storage: STORAGE });
  withHostedBackend(hosted);
  const hostedCard = frameCard(await repaint(hosted));
  assert(hostedCard.includes('data-frame-execution-paid="1"'), "the hosted path must declare itself paid");
  assert(hostedCard.includes("fal-generate-btn") && hostedCard.includes("openFalGenerationModal("),
    "the hosted action must still go through the shipped paid dialog");
  assert(!hostedCard.includes("comfy-generate-btn"),
    "a card showing only the hosted path must not also draw the local dispatch control");

  /* BOTH AVAILABLE AND NEITHER CHOSEN IS A REAL STATE. It is said out loud rather than
     resolved by list position, and it offers no dispatch control at all — which is the
     whole of "selecting a backend never spends money". */
  const both = await render("#/shot/L1-01", readyProject(), { storage: STORAGE });
  withLocalBackend(both, READY_WORKFLOW);
  withHostedBackend(both);
  const bothCard = frameCard(await repaint(both));
  assert(bothCard.includes('data-frame-execution="unresolved"'),
    "with two paths available and none chosen the card must say the choice is unresolved");
  assert(/Choose backend\/workflow/i.test(bothCard), "and it must say so in words");
  assert(!bothCard.includes("comfy-generate-btn") && !bothCard.includes("fal-generate-btn"),
    "an unresolved choice must offer no dispatch control of either kind");
  assert(bothCard.includes("setFrameExecutionBackend("),
    "the two paths must be selectable, through the display-only selector");

  /* NO UNIVERSAL BUTTON. Each action is produced under its own branch, by its own
     backend's own function — there is no single control whose handler could change
     from local to paid underneath a filmmaker who had already read it. */
  const action = studio.slice(studio.indexOf("function frameExecutionActionMarkup"),
    studio.indexOf("function frameExecutionBlockMarkup"));
  assert(/path\.id === "comfy"/.test(action), "the local action must be gated on the local path");
  assert(action.includes("comfyPromptAction") && action.includes("falPromptAction"),
    "each path must keep its own shipped action producer");
  assert(!/openFalGenerationModal|openComfyGenerationModal/.test(action),
    "this layer must not open a dispatch dialog itself; the backends' own actions do that");
}

/* ------------------------------------------------------ 3. cost is never buried */
async function testCostTruthStaysVisible() {
  const local = await render("#/shot/L1-01", readyProject(), { storage: STORAGE });
  withLocalBackend(local, READY_WORKFLOW);
  assert(outsideClosedDisclosures(frameCard(await repaint(local)), "frame-execution-cost"),
    "the local charge fact must not sit behind a disclosure");

  const priced = await render("#/shot/L1-01", readyProject(), { storage: STORAGE });
  withHostedBackend(priced, { rate: 0.04 });
  const pricedCard = frameCard(await repaint(priced));
  assert(outsideClosedDisclosures(pricedCard, "frame-execution-cost"),
    "a paid estimate must not sit behind a disclosure");
  assert(/Estimated \$/.test(pricedCard), "a configured rate must be quoted as an estimate");

  /* AN UNKNOWN PRICE IS STILL PAID, and the surface may not round it to nothing. */
  const unpriced = await render("#/shot/L1-01", readyProject(), { storage: STORAGE });
  withHostedBackend(unpriced, { rate: 0 });
  const unpricedCard = frameCard(await repaint(unpriced));
  assert(/Provider price unavailable/.test(unpricedCard),
    "an unconfigured rate must say the price is unavailable");
  assert(!/\$0\.00|\bFree\b/.test(unpricedCard),
    "an unconfigured rate must never be presented as zero or free");
  assert(/still paid/i.test(unpricedCard),
    "an unknown price must still say the generation is paid");
}

/* ------------------------------------------- 4. readiness keeps its exact reason */
async function testChangedMappingKeepsItsReason() {
  const result = await render("#/shot/L1-01", readyProject(), { storage: STORAGE });
  withLocalBackend(result, CHANGED_WORKFLOW);
  const card = frameCard(await repaint(result));
  assert(card.includes('data-tone="attention"'), "a changed mapping must read as needing attention");
  assert(card.includes("Workflow changed"), "and must say what changed");
  assert(outsideClosedDisclosures(card, "frame-execution-reason"),
    "the registry's reason for a changed mapping must not be hidden behind a disclosure");
  assert(card.includes("comfy-generate-btn"),
    "a changed-but-runnable workflow keeps its existing eligibility and its action");
}

/* ------------------------------------------------------- 5. the returned result */
async function testReturnedResultPointsAtItsOwnCandidate() {
  const result = await render("#/shot/L1-01", generatingProject(), { storage: STORAGE });
  const card = frameCard(result.html);
  assert(card.includes('data-frame-returned="1"'), "a returned generation result must have a result position");
  assert(/Returned · Review needed/.test(card), "and must say it returned and still needs a person");
  assert(/Review this result/.test(card), "and must lead with the review action");

  /* THE KEY ON THE CARD IS THE KEY IN THE ACTION. The projection names one candidate;
     an action pointing anywhere else is the phantom review this rule exists to stop. */
  const key = /data-frame-returned-key="([^"]+)"/.exec(card);
  assert(key, "the result position must record which projected item it is showing");
  const call = new RegExp(`openReturnedResultReview\\('L1-01','${key[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'\\)`);
  assert(call.test(card), "the review action must open the exact candidate the card named");
  const file = /data-frame-returned-file="([^"]+)"/.exec(card);
  assert(file && card.includes(file[1]), "and must name the file it is showing");

  /* RETURNING IS NOT APPROVAL, and the card has to keep saying so. */
  assert(/not approval/i.test(card), "a returned result must not read as an approved frame");
}

/* An imported candidate awaiting a decision is the candidate tray's business and the
   shot handoff's. It must not open a generation flow on a frame that never entered one. */
async function testImportedCandidateIsNotAReturnedResult() {
  const result = await render("#/shot/L1-01", importingProject(), { storage: STORAGE });
  const card = frameCard(result.html);
  assert(!card.includes('data-frame-returned="1"'),
    "an imported candidate must not be presented as a returned generation result");
  assert(card.includes('data-frame-generation="idle"'),
    "and must not report the frame as generating");
  assert(card.includes("guided-frame-dropzone") && card.includes("guided-frame-candidate"),
    "while manual import and the candidate tray stay exactly where they were");
}

/* ------------------------------------------- 6. nothing reflows a field or a choice */
async function testStateSurvivesARerender() {
  const result = await render("#/shot/L1-01", readyProject(), { storage: STORAGE });
  withLocalBackend(result, READY_WORKFLOW);
  const card = frameCard(await repaint(result));

  /* app.js restores a disclosure by key and a focused control by selector. Every panel
     this slice introduced carries a key, and every control it MOVED carries a focus
     key, so a rerender puts both back where the filmmaker had them. */
  const panels = card.match(/<details[^>]*class="(frame-generation|frame-prompt-block|frame-prompt-tools|frame-preparation|frame-prompt-expand|frame-returned-decisions)[^"]*"[^>]*>/g) || [];
  assert(panels.length, "the generation section must render its disclosures");
  for (const panel of panels)
    assert(/data-ui-state-key="/.test(panel),
      `every generation disclosure needs a stable key so a rerender does not reset it: ${panel.slice(0, 80)}`);
  for (const focusKey of ["frame-direction:", "frame-target:", "frame-action:"])
    assert(card.includes(`data-focus-key="${focusKey}`) || card.includes(`data-focus-key="${focusKey.slice(0, -1)}`),
      `a control that moved needs a focus key so focus survives a rerender: ${focusKey}`);

  /* THE SELECTOR IS DISPLAY-ONLY. It decides which existing controls are drawn; it is
     never persisted, never reaches a payload and never dispatches. */
  assert(/const FRAME_EXECUTION_VIEW = new Map\(\)/.test(studio),
    "the selected-backend state must be in-memory display state");
  const setter = studio.slice(studio.indexOf("window.setFrameExecutionBackend"), studio.indexOf("window.setFrameExecutionWorkflow"));
  assert(!/fetch\(|dirty\(\)|commitProject|POST/.test(setter),
    "choosing a backend must not write, save, or send anything");
}

/* The dialog opens on the workflow the card was showing. A dialog that reset the choice
   would dispatch something other than what the filmmaker read. */
function testDialogKeepsTheCardsChoice() {
  assert(/window\.openComfyGenerationModal = async \(shotId, frameId = "", buildId = "", workflowPath = ""\)/.test(comfy),
    "the local dispatch dialog must accept the workflow the card was previewing");
  assert(/runnable\.some\(\(row\) => row\.relativePath === String\(workflowPath \|\| ""\)\)/.test(comfy),
    "and must honour it only while it is still runnable");
  assert(/row\.relativePath === request\.workflow \? "selected" : ""/.test(comfy),
    "and must preselect it in the workflow control");
  assert(/comfyPromptAction\(s\.id, frame\.id, build\.id, \{ primary: true, workflow \}\)/.test(studio),
    "the card's action must carry the workflow it was showing into the dialog");
}

/* -------------------------------------------------- 7. the picture is not cropped */
function testReturnedMediaIsContained() {
  const media = ruleFor(".frame-returned-media img");
  assert(/object-fit\s*:\s*contain/.test(media), "a returned result must never be cropped to fit its well");
  assert(/width\s*:\s*auto/.test(media) && /height\s*:\s*auto/.test(media),
    "the returned result must take its own intrinsic proportions rather than a forced box");
  assert(!/aspect-ratio/.test(ruleFor(".frame-returned-media")),
    "the well must follow the picture rather than imposing a shape the picture does not have");

  /* THE SHOT HANDOFF'S 1280 CROP. Its containment was asked for and could not be
     honoured: `max-height:100%` inside a button whose own height resolves against an
     aspect-ratio well is an indefinite percentage, so it was dropped and the bottom of
     a square render was cut off. The cap has to be a LENGTH to be definite. */
  const narrow = /@media\(max-width:1300px\)\{([\s\S]*?)\n\}/g;
  let block = "", match;
  while ((match = narrow.exec(css)))
    if (match[1].includes(".returned-review-card .guided-lifecycle-preview .guided-lifecycle-media img")) block = match[1];
  assert(block, "the returned handoff needs a narrow-viewport containment rule");
  const capped = /max-height\s*:\s*var\(--cb-selection-h[^)]*\)/.test(block);
  assert(capped, "the narrow-viewport cap must be a length, not a percentage of an indefinite parent");
  assert(!/max-height\s*:\s*100%/.test(block),
    "a percentage cap here resolves to nothing and silently reinstates the crop");
}

/* ------------------------------------------------------ 8. nothing pushes sideways */
function testNothingOverflowsHorizontally() {
  for (const selector of [
    ".guided-frame-flow", ".frame-generation", ".frame-generation-body",
    ".frame-prompt-block", ".frame-prompt-body", ".frame-prompt-preview",
    ".frame-execution", ".frame-returned-result", ".frame-returned-copy",
    ".frame-operation-status", ".frame-preparation", ".frame-preparation-body",
  ]) {
    assert(/min-width\s*:\s*0/.test(ruleFor(selector)),
      `${selector} must be allowed to shrink, or a long value pushes the workspace sideways`);
  }
  /* A long workflow filename wraps. Truncating it would hide which workflow runs. */
  const unit = ruleFor(".frame-execution-unit");
  assert(/overflow-wrap\s*:\s*anywhere/.test(unit) && /word-break\s*:\s*break-word/.test(unit),
    "a long workflow filename must wrap rather than overflow");
  assert(!/text-overflow\s*:\s*ellipsis/.test(unit),
    "and must not be truncated — the filename is the only name this workflow has");
  /* The frame body drops its context column rather than reserving it for a placeholder. */
  assert(/grid-template-columns\s*:\s*minmax\(0,1fr\)!important/.test(ruleFor(".guided-frame-body.is-single")),
    "a frame with no context imagery must give the whole row to its work");
  assert(/contextAside \? "" : "is-single"/.test(studio),
    "and the single-column class must follow whether the aside actually rendered");
}

/* ------------------------------------- 9. the truth boundaries this pass may not cross */
function testTruthBoundariesHeld() {
  /* No duration on the card. The proof archive measured one; the product has no
     authoritative provider-execution-duration field, and printing the archive's number
     would be presenting a measurement of something else. */
  const section = studio.slice(studio.indexOf("function guidedFrameGenerationSection"), studio.length);
  assert(!/3\.3s|3\.273|execution time|executionMs|durationMs/i.test(section.slice(0, 4000)),
    "the frame card must not claim a provider execution duration it has no field for");

  /* The result position reads the shipped projection and creates no second model. */
  assert(/returnedReviewProjectionForBrowser\(\)/.test(studio.slice(studio.indexOf("function frameReturnedReviewItem"))),
    "the result position must read the shipped returned-review projection");
  assert(/candidateRecord\(s, row\.candidate\?\.name, false\)/.test(studio),
    "and must ask about a candidate without creating a row for it");

  /* A completed job that has not been collected is not a returned result. */
  assert(/if \(status === "COMPLETED"\) return job\.ingestedAt \? "Returned — ready to review" : "Finished";/.test(comfy),
    "a finished-but-uncollected job must keep its own words");

  /* Both backends' status strips are drawn, always. Selecting a backend must not hide
     an unresolved paid submission on the same frame. */
  const status = studio.slice(studio.indexOf("function frameOperationStatusMarkup"), studio.indexOf("function frameReturnedReviewItem"));
  assert(status.includes("falGenerationInline") && status.includes("comfyGenerationInline"),
    "the status position must draw every backend's own strip");
  assert(!/selected|backend ===|view\.backend/.test(status),
    "and must not filter them by which backend is currently selected");
}

async function main() {
  await testGenerateActionIsFindableAndOwned();
  await testLocalAndPaidStaySeparate();
  await testCostTruthStaysVisible();
  await testChangedMappingKeepsItsReason();
  await testReturnedResultPointsAtItsOwnCandidate();
  await testImportedCandidateIsNotAReturnedResult();
  await testStateSurvivesARerender();
  testDialogKeepsTheCardsChoice();
  testReturnedMediaIsContained();
  testNothingOverflowsHorizontally();
  testTruthBoundariesHeld();
  console.log("Generation Surface Polish V1: action ownership, local/paid separation, cost visibility, "
    + "changed-mapping reasons, returned-result identity, import/return distinction, rerender state, "
    + "dialog preselection, media containment, overflow guards and truth boundaries all hold.");
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});

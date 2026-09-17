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

/* An imported candidate awaiting a decision is Results' business and the shot handoff's.
   It must not open a generation flow on a frame that never entered one. */
async function testImportedCandidateIsNotAReturnedResult() {
  const result = await render("#/shot/L1-01", importingProject(), { storage: STORAGE });
  const card = frameCard(result.html);
  assert(!card.includes('data-frame-returned="1"'),
    "an imported candidate must not be presented as a returned generation result");
  assert(card.includes('data-frame-generation="idle"'),
    "and must not report the frame as generating");

  /* EV2-7 B2.12 — IMPORT STAYS WITH THE FRAME, JUDGING MOVES TO RESULTS. Asserted one
     fact at a time, because a substring of a retired class name would pass for all of
     them at once. */
  /* 1. Import: the frame's own drop target and file input, ahead of its generation. */
  assert(card.includes('data-frame-dropzone="frame-a"') && card.includes('id="frame-file-frame-a"'),
    "the frame keeps its own import drop target and file input");
  assert(card.indexOf('data-frame-dropzone="frame-a"') < card.indexOf('class="frame-generation'),
    "and manual import still comes before the optional generation section");
  /* 2. Target: no second gallery and no approve control in the stage. */
  assert(!/guided-frame-candidate-grid|guided-approve-selected|role="listbox"|approveGuidedFrame\(/.test(card),
    "the frame card draws no candidate grid, selection or APPROVE of its own");
  assert(card.includes("Compare and approve in Results."), "and says where comparing and approving happen");
  /* 3. Handoff: the Results rail above the stage names this exact frame, and pressing it
     resolves the imported candidate by its exact key, at press time. */
  const rail = (result.html.match(/<section class="shot-results-rail[\s\S]*?<\/section>/) || [""])[0];
  const entries = [...rail.matchAll(/<button[^>]*onclick="([^"]*)"[^>]*>Frame A Results<\/button>/g)].map((match) => match[1]);
  assert.deepStrictEqual(entries, ["openShotResults('L1-01','frame','frame-a')"], "the rail offers exactly one Frame A Results entry");
  assert(result.html.indexOf("shot-results-rail") < result.html.indexOf('<details class="guided-frame-card'),
    "above the frame's own work");
  const handed = JSON.parse(vm.runInContext(`(() => {
    const opened = [];
    CineBraidResults.open = (scope, key) => opened.push({ scope, key });
    openShotResults("L1-01", "frame", "frame-a");
    const queue = returnedReviewProjectionForBrowser().queue.filter((row) => row.shotId === "L1-01" && row.owner.frameId === "frame-a");
    return JSON.stringify({ opened, key: queue[0].key, imported: queue.some((row) => row.candidate.name === "FRAME_A.png"), waiting: queue.length });
  })()`, result.context));
  assert(handed.imported, "precondition: the imported candidate is waiting in Frame A's Results");
  assert.deepStrictEqual(handed.opened, [{ scope: { shotId: "L1-01", kind: "frame", frameId: "frame-a" }, key: handed.key }],
    "and opens Frame A's Results on the first waiting candidate by its exact key");
  /* 4. Approved state: nothing is approved, and the rail says so rather than showing the
     newest file as if it were. */
  assert(new RegExp(`data-frame-id="frame-a"[^>]*data-results-waiting="${handed.waiting}"[^>]*data-results-approved="none"`).test(rail)
    && rail.includes(`No Approved image · ${handed.waiting} new candidate${handed.waiting === 1 ? "" : "s"}`)
    && !/<img[^>]*FRAME_A\.png/.test(rail),
    "the rail states Frame A has no Approved image beside its waiting candidates, and shows none of them as if it were");
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

/* ------------------------------------ 9. Import existing… asks its exact target (EV2-7 B2.17) */
/* External generation is a normal production route, so the import is a visible title-row
   control on every stage. It asks WHICH target, never guesses one from the shot's lifecycle,
   hands the choice to the shipped import owner (public/mutations.js), writes nothing when
   cancelled, and keeps the dialog and its target when the import or its save does not land. */
async function testImportExistingAsksItsExactTarget() {
  const { memoryStore } = require("./helpers/result-confirmation");
  const project = readyProject();
  for (const list of ["characters", "locations", "props"])
    for (const entity of project[list] || [])
      if (!entity.continuityStates?.length)
        entity.continuityStates = [{ id: "state-default", name: "Default", isDefault: true, approvedFile: entity.approvedFile || "", notes: "" }];
  const posts = [];
  let uploads = "refuse", saves = "accept";
  const openWindow = async () => {
    const store = memoryStore(project);
    const page = await render("#/shot/L1-01", project, {
      storage: { "cinebraid-focused:fixture:shot-task:L1-01": "inputs" },
      fetch: async (url, options, respond) => {
        if (/^\/api\/shots\/L1-01\/take\?name=/.test(url)) {
          posts.push(decodeURIComponent(url.split("name=")[1]));
          return uploads === "refuse" ? respond({ error: "Synthetic storage refusal" }, 507) : respond({ name: decodeURIComponent(url.split("name=")[1]) });
        }
        if (saves === "refuse" && ["PUT", "POST"].includes(options.method)) return respond({ error: "Synthetic save refusal" }, 503);
        return store.fetch(url, options, respond);
      },
    });
    return { store, result: page };
  };
  const { result } = await openWindow();
  const html = result.html;
  const shotActions = (html.match(/<details class="guided-inline-actions"[\s\S]*?<\/details>/) || [""])[0];
  assert(html.includes('data-bounded-task="inputs"'), "precondition: the Inputs stage is the one rendered");
  assert(/<button type="button"[^>]*onclick="openShotImportChooser\('L1-01'\)"[^>]*>Import existing…<\/button>/.test(html.replace(shotActions, "")),
    "Import existing… is a visible title-row button on the Inputs stage");
  assert(!shotActions.includes("Import existing") && /Rename shot/.test(shotActions) && /Duplicate shot/.test(shotActions) && /Delete shot/.test(shotActions),
    "Shot actions keeps Rename, Duplicate and Delete, and no longer holds the import");

  const P = () => vm.runInContext("JSON.stringify(P.shots)", result.context);
  const modal = () => result.context.document.getElementById("modal");
  const status = () => result.context.document.getElementById("shot-import-status").textContent;
  const untouched = P();
  result.context.openShotImportChooser("L1-01");
  const targets = [...modal().innerHTML.matchAll(/<button type="button"[^>]*data-shot-import-target="([^"]*)"[^>]*onclick="([^"]*)"[^>]*>([^<]*)<\/button>/g)]
    .map((match) => ({ target: match[1], call: match[2], label: match[3] }));
  assert.deepStrictEqual(targets.map((row) => row.label), ["Frame A image", "Frame B image", "Motion video"],
    "the chooser names each declared frame's image and the motion video as explicit targets");
  assert.deepStrictEqual(targets.map((row) => row.call), [
    "chooseShotImportTarget('L1-01','frame','frame-a')",
    "chooseShotImportTarget('L1-01','frame','frame-b')",
    "chooseShotImportTarget('L1-01','motion','')",
  ], "and each carries its exact target, whatever stage or lifecycle the shot is in");
  result.context.closeModal();
  assert.strictEqual(P(), untouched, "cancelling writes nothing");
  assert.deepStrictEqual(posts, [], "and uploads nothing");

  /* A chosen target reaches the shipped owner for exactly that target. */
  result.context.openShotImportChooser("L1-01");
  vm.runInContext(`chooseShotImportTarget("L1-01", "frame", "frame-b")`, result.context);
  const input = result.context.document.getElementById("shot-import-file");
  assert.strictEqual(input.accept, "image/*", "a frame target asks for images");
  input.files = [{ name: "EXTERNAL_B.png", type: "image/png" }];
  await input.onchange();
  assert.deepStrictEqual(posts, ["EXTERNAL_B.png"], "the chosen file is sent through the shipped import owner");
  assert(!modal().classList.contains("hidden") && /Frame B image was not imported/.test(status()) && /target is still Frame B image/.test(status()),
    "a refused upload keeps the chooser open, says so, and keeps its target: " + status());
  assert(!P().includes("EXTERNAL_B.png"), "and records nothing for it");

  uploads = "accept"; saves = "refuse";
  input.files = [{ name: "EXTERNAL_B.png", type: "image/png" }];
  await input.onchange();
  const row = JSON.parse(P())[0].candidateFiles.find((item) => item.stored === "EXTERNAL_B.png");
  assert(row && row.frameId === "frame-b", "an accepted upload is recorded against exactly Frame B");
  assert(!modal().classList.contains("hidden") && /not saved yet/.test(status()) && /Frame B image/.test(status()),
    "while its save has not landed the chooser stays, naming the target: " + status());

  /* A window whose saves land. A fresh open, because a THROWN save failure stays on the save
     chain until an ordinary edit re-arms it (public/app.js flushPendingProjectSave) — that is
     the app's save owner, not this dialog, and the dialog above already said "not saved yet". */
  saves = "accept";
  const saved = await openWindow();
  const second = saved.result;
  const P2 = () => JSON.parse(vm.runInContext("JSON.stringify(P.shots)", second.context))[0];
  const modal2 = () => second.context.document.getElementById("modal");
  const status2 = () => second.context.document.getElementById("shot-import-status").textContent;
  const authorityBefore = JSON.stringify(saved.store.stored().productionAuthority || null);
  second.context.openShotImportChooser("L1-01");
  vm.runInContext(`chooseShotImportTarget("L1-01", "motion", "")`, second.context);
  const motionInput = second.context.document.getElementById("shot-import-file");
  assert.strictEqual(motionInput.accept, "video/*", "the motion target asks for video");
  /* This harness answers getElementById for ANY id, so the video owner finds a
     #motion-dropzone even off the Motion stage; give it the text node a real one has. */
  second.context.document.getElementById("motion-dropzone").childNodes = [{ nodeValue: "" }];
  motionInput.files = [{ name: "EXTERNAL_MOTION.mp4", type: "video/mp4" }];
  await motionInput.onchange();
  assert(P2().candidateFiles.some((item) => item.stored === "EXTERNAL_MOTION.mp4" && item.mediaType === "video" && !item.frameId),
    "a motion import is recorded as the shot's video, not as any frame");
  assert(modal2().classList.contains("hidden"), "and a landed, saved import closes the chooser: " + status2());
  const durable = saved.store.stored().shots.find((shot) => shot.id === "L1-01");
  assert(durable.candidateFiles.some((item) => item.stored === "EXTERNAL_MOTION.mp4"), "the closed chooser means the import reached storage");
  assert.strictEqual(JSON.stringify(saved.store.stored().productionAuthority || null), authorityBefore, "importing approves nothing");
}

/* ----------------------------- 10. The Results rail and the desk in hard states (EV2-7) */
/* The rail is the Shot Desk's one way into Results from every stage, so the states a
   filmmaker actually reaches are read off the rendered desk: an Approved receipt whose
   file is gone beside a newer candidate, more frames than the rail lists, a projection
   that cannot be read, and an operation that needs a person. None of them may write. */
async function testResultsRailHardStates() {
  const { rawFixture, withFixtureCanon } = require("./render-harness");
  const mainOf = (page) => page.context.document.getElementById("main").innerHTML;
  const railOf = (html) => (html.match(/<section class="shot-results-rail[\s\S]*?<\/section>/) || [""])[0];
  const targetOf = (html, kind, frameId = "") => (railOf(html).match(new RegExp(`<article class="shot-results-target" data-results-target="${kind}"${frameId ? ` data-frame-id="${frameId}"` : ""}[\\s\\S]*?</article>`)) || [""])[0];
  const entries = (html) => [...railOf(html).matchAll(/<button type="button" class="ghost-btn shot-results-open" onclick="([^"]*)">([^<]*)<\/button>/g)].map((match) => `${match[2]} → ${match[1]}`);
  const shotsOf = (page) => vm.runInContext("JSON.stringify(P.shots)", page.context);
  const inputs = { "cinebraid-focused:fixture:shot-task:L1-01": "inputs" };

  /* 1. A CURRENT RECEIPT WHOSE FILE IS GONE, beside a newer candidate for the same frame. */
  const lost = rawFixture();
  lost.shots[0].keyframes[0].winner = "FRAME_A_LOST.png";
  const lostProject = withFixtureCanon(lost);
  lostProject.shots[0].candidateFiles = [{ stored: "FRAME_A.png", original: "FRAME_A.png", addedAt: "2026-09-05T10:05:00.000Z", decision: "unreviewed", frameId: "frame-a" }];
  const gone = await render("#/shot/L1-01", lostProject, { storage: inputs });
  const goneA = targetOf(mainOf(gone), "frame", "frame-a");
  assert(/data-results-approved="unavailable"/.test(goneA) && goneA.includes("Approved image unavailable · 1 new candidate")
    && goneA.includes("FRAME_A_LOST.png · receipt kept, file not found"),
    "the rail names a receipt-backed Approved image whose file is gone as unavailable, by name: " + goneA);
  assert(!/<img|<video|<a class="shot-results-approved"/.test(goneA), "and nothing stands in for it, least of all the newer candidate: " + goneA);
  const goneB = targetOf(mainOf(gone), "frame", "frame-b");
  assert(/data-results-approved="retained"/.test(goneB) && goneB.includes('<img src="/assets/shots/L1-01/takes/FRAME_B.png"'),
    "while a receipt whose file is present keeps its own preview: " + goneB);
  const hero = (mainOf(gone).match(/<section class="guided-next-action[\s\S]*?<\/section>/) || [""])[0];
  const heldChip = (hero.match(/<div class="returned-review-compare missing" data-returned-review-compare="current">[\s\S]*?<\/div>/) || [""])[0];
  assert(/Review Frame A result/.test(hero) && /Current · Approved/.test(heldChip) && /FRAME_A_LOST\.png/.test(heldChip) && /Approved image unavailable/.test(heldChip),
    "and the hero reviewing the newer candidate says the Approved image in place is unavailable instead of dropping it: " + hero);

  /* 2. MORE FRAMES THAN THE RAIL LISTS. One labelled selector; its default follows the
     frame the Frames stage has selected and is never written; choosing another frame in it
     changes only which Results target is in view. */
  const many = generatingProject();
  many.shots[0].keyframes.push(
    { id: "frame-c", label: "C", title: "Third frame", winner: "", description: "Worker turns.", required: false, generationPackages: [] },
    { id: "frame-d", label: "D", title: "Fourth frame", winner: "", description: "Worker exits.", required: false, generationPackages: [] });
  const selectedKey = "cinebraid-bounded:fixture:selected:shot-frame:L1-01";
  const wide = await render("#/shot/L1-01", many, { storage: { ...inputs, [selectedKey]: "frame-c" } });
  const stored = () => vm.runInContext(`JSON.stringify([localStorage.getItem(${JSON.stringify(selectedKey)}), localStorage.getItem("cinebraid-focused:fixture:shot-task:L1-01")])`, wide.context);
  const pickerOf = (html) => (railOf(html).match(/<label class="shot-results-picker"><span>Frame<\/span><select data-shot-results-frame="L1-01"[^>]*>([\s\S]*?)<\/select><\/label>/) || ["", ""]);
  const optionsOf = (html) => [...pickerOf(html)[1].matchAll(/<option value="([^"]*)" (selected)?>/g)].map((match) => `${match[1]}${match[2] ? "*" : ""}`);
  assert.deepStrictEqual(optionsOf(mainOf(wide)), ["frame-a", "frame-b", "frame-c*", "frame-d"],
    "four frames get one labelled frame selector, defaulting to the frame already selected in the Frames stage");
  assert.deepStrictEqual(entries(mainOf(wide)), ["Frame C Results → openShotResults('L1-01','frame','frame-c')", "Motion Results → openShotResults('L1-01','motion','')"],
    "beside exactly one Results entry for that frame, and Motion's");
  const before = { shots: shotsOf(wide), stored: stored() };
  wide.context.viewShotResultsFrame("L1-01", "frame-d");
  await wide.context.route();
  assert.deepStrictEqual(entries(mainOf(wide)).map((row) => row.split(" → ")[0]), ["Frame D Results", "Motion Results"], "choosing Frame D in it brings Frame D's Results into view");
  assert(mainOf(wide).includes('data-bounded-task="inputs"'), "without selecting any stage");
  assert.strictEqual(shotsOf(wide), before.shots, "without writing the project");
  assert.strictEqual(stored(), before.stored, "and without writing the Frames stage's selection or the stage");
  vm.runInContext(`selectBoundedItem("shot-frame", "L1-01", "frame-b")`, wide.context);
  await wide.context.route();
  assert.deepStrictEqual(entries(mainOf(wide)).map((row) => row.split(" → ")[0]), ["Frame B Results", "Motion Results"],
    "and when the Frames stage selects another frame, the rail follows it again");
  const unchanged = mainOf(wide);
  wide.context.viewShotResultsFrame("L1-01", "frame-gone");
  await wide.context.route();
  assert.strictEqual(entries(mainOf(wide)).join(), entries(unchanged).join(), "a frame that is not part of the shot is refused and nothing else is shown instead");

  /* 3. THE PROJECTION CANNOT BE READ. The rail says so, and each button still opens its
     exact target rather than disappearing with the counts. */
  vm.runInContext(`returnedReviewProjectionForBrowser = () => ({ contract: "synthetic", available: false, reason: "production-media-unavailable", items: [], queue: [], blockers: [], counts: { items: 0, awaiting: 0, shots: 0, repairs: 0, unreviewable: 0, unavailable: 0 } });`, gone.context);
  await gone.context.route();
  const unread = railOf(mainOf(gone));
  assert(/data-results-readable="0"/.test(unread) && unread.includes("Returned results cannot be read right now") && unread.includes("Frame A · results not readable"),
    "an unreadable projection is stated, not rendered as an empty shot: " + unread);
  assert.deepStrictEqual(entries(mainOf(gone)), [
    "Frame A Results → openShotResults('L1-01','frame','frame-a')",
    "Frame B Results → openShotResults('L1-01','frame','frame-b')",
    "Motion Results → openShotResults('L1-01','motion','')",
  ], "and every declared target keeps its one Results entry");
  assert(/data-results-approved="unavailable"/.test(targetOf(mainOf(gone), "frame", "frame-a")),
    "while the Approved facts, which are the receipts', are still told");

  /* 4. AN OPERATION THAT NEEDS A PERSON sits beside the hero on every stage, with the way
     into Activity; an unresolved paid request comes first and keeps its only exit. */
  const desk = await render("#/shot/L1-01", readyProject(), { storage: inputs });
  vm.runInContext(`AUTOMATION_RUNS = [{ id: "run-l1-frames", type: "shot-chain", targetId: "L1-01", label: "L1-01 frame automation", status: "failed", stage: "Needs attention", summary: "Stopped: Generate Frame A failed." }];`, desk.context);
  await desk.context.route();
  const inline = (html) => (html.match(/<div class="shot-activity-inline[\s\S]*?<\/button><\/div>(?:<\/div>)?/) || [""])[0];
  const failed = inline(mainOf(desk));
  assert(/is-attention/.test(failed) && failed.includes("L1-01 frame automation · needs attention") && failed.includes("Stopped: Generate Frame A failed.")
    && failed.includes(`onclick="window.CineBraidCreatorSurfaces?.expandTerminal?.('run-l1-frames')">Open Activity</button>`),
    "a failed run for this shot is stated inline, with what stopped and the way into Activity: " + failed);
  assert(/class="shot-activity-inline state-failed is-attention"/.test(failed), "in the shipped run classifier's tone: " + failed);
  vm.runInContext(`AUTOMATION_RUNS = [{ id: "run-l1-gate", type: "shot-chain", targetId: "L1-01", label: "L1-01 frame automation", status: "awaiting-review", stage: "Waiting for your frame decision", summary: "" }];`, desk.context);
  await desk.context.route();
  const parked = inline(mainOf(desk));
  assert(/class="shot-activity-inline state-review"/.test(parked) && parked.includes("L1-01 frame automation · awaiting review") && parked.includes("Waiting for your frame decision"),
    "and a run parked on a person reads as waiting for review, neither a failure nor a machine at work: " + parked);
  const order = (html, needle) => html.indexOf(needle);
  assert(order(mainOf(desk), "guided-next-action") < order(mainOf(desk), "shot-activity-inline") && order(mainOf(desk), "shot-activity-inline") < order(mainOf(desk), "shot-results-rail"),
    "between the hero and the Results rail, on the Inputs stage");
  vm.runInContext(`FAL_GENERATION_JOBS = [{ id: "job-l1-a", purpose: "frame", shotId: "L1-01", frameId: "frame-a", provider: "fal", backendId: "fal-queue", model: "gpt-image-2", status: "SUBMITTING", uncertain: true, externalId: "", createdAt: "2026-09-05T10:10:00.000Z" }];`, desk.context);
  await desk.context.route();
  const paid = inline(mainOf(desk));
  assert((mainOf(desk).match(/class="shot-activity-inline/g) || []).length === 1, "one inline operation at a time");
  assert(paid.includes("Paid request unresolved · Frame A") && paid.includes("cannot tell whether the provider ever received it")
    && paid.includes(`onclick="openFalUnresolvedModal('job-l1-a')">Check and resolve</button>`)
    && paid.includes(`onclick="window.CineBraidCreatorSurfaces?.expandTerminal?.('job:job-l1-a')">Open Activity</button>`),
    "an unresolved paid request leads, in the shipped explanation, with the shipped reconciliation and its Activity row: " + paid);

  /* 5. ONE Previous/Next pair, beside the title, named for where it goes; no hero carries a
     second; notes and history sit in one keyed Shot details disclosure after the work. */
  const pair = readyProject();
  pair.shots.push({ ...JSON.parse(JSON.stringify(pair.shots[0])), id: "L1-02", title: "Hull walk-away" });
  const paired = await render("#/shot/L1-01", pair, { storage: inputs });
  for (const page of [gone, wide, desk, paired]) {
    const html = mainOf(page);
    const head = (html.match(/<header class="shot-workspace-head[\s\S]*?<\/header>/) || [""])[0];
    const heroCard = (html.match(/<section class="guided-next-action[\s\S]*?<\/section>/) || [""])[0];
    assert.strictEqual((html.match(/aria-label="Shot order"/g) || []).length, 1, "exactly one Previous/Next pair in the shot desk");
    assert(/<nav class="shot-head-nav" aria-label="Shot order">/.test(head), "beside the title");
    assert(heroCard && !/<nav\b|Previous shot|Next shot/.test(heroCard) && !/Previous shot|Next shot|shot-head-nav/.test(html.replace(head, "")),
      "and neither the hero nor anything else in the desk carries a second pair");
    if (page === paired)
      assert(/<a href="#\/shot\/L1-02" title="Next shot" aria-label="Next shot: Hull walk-away">›<\/a>/.test(head),
        "each link named for the shot it goes to: " + head);
    assert(html.indexOf('data-ui-state-key="shot-details:L1-01"') > html.indexOf('class="guided-work-stack'),
      "Shot details is one keyed disclosure after the selected stage's work");
  }
}

/* EV2-5 moves setup, while the paid/local operation owners stay in shot work. */
async function testSettingsSetupCannotBecomeAnOperation() {
  const project = buildFixture();
  for (const section of ["overview", "connections", "fal", "generation", "integrations"]) {
    const { html } = await render(`#/settings/${section}`, project);
    assert(html.includes(`data-settings-tab="${section}"`), `${section}: the requested setup destination must render`);
    assert(!/onclick="(?:startFalGeneration|startComfyGeneration|submitCivitaiGeneration|approveFrame)/.test(html),
      `${section}: moving setup must not introduce a generation or approval action`);
  }
  const { html: defaults } = await render("#/settings/generation", project);
  assert(!defaults.includes('id="cfg-fal-key"'), "provider credentials belong to connection setup, not generation defaults");
  assert(defaults.includes('id="cfg-fal-text-model"') && defaults.includes('id="cfg-fal-h3-text-model"'),
    "image and motion retain their actual provider-specific default controls");
  assert(/does not change past results/.test(defaults), "new defaults must not imply relabeling historical generation provenance");
  const { html: local } = await render("#/settings/integrations", project);
  assert(/Check saved local runtime/.test(local), "the local probe names its saved target");
  assert(!/no hosted service is contacted and none can bill/.test(local), "loopback setup cannot attest downstream custom node billing");
}

async function main() {
  await testGenerateActionIsFindableAndOwned();
  await testLocalAndPaidStaySeparate();
  await testCostTruthStaysVisible();
  await testChangedMappingKeepsItsReason();
  await testReturnedResultPointsAtItsOwnCandidate();
  await testImportedCandidateIsNotAReturnedResult();
  await testImportExistingAsksItsExactTarget();
  await testResultsRailHardStates();
  await testStateSurvivesARerender();
  testDialogKeepsTheCardsChoice();
  testReturnedMediaIsContained();
  testNothingOverflowsHorizontally();
  testTruthBoundariesHeld();
  await testSettingsSetupCannotBecomeAnOperation();
  console.log("Generation Surface Polish V1: action ownership, local/paid separation, cost visibility, "
    + "changed-mapping reasons, returned-result identity, import/return distinction, rerender state, "
    + "dialog preselection, media containment, overflow guards and truth boundaries all hold.");
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});

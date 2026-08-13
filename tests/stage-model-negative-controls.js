/* Negative controls for tests/stage-model.js.
 *
 * A guarantee nobody has watched fail is a guarantee nobody has tested. Each control
 * below reintroduces one of the defects O1 removed - IN MEMORY, through the render
 * harness's mutateSource hook or an in-memory Module, so nothing on disk is touched and
 * no control can be "restored" by a checkout that also discards real work - and then
 * proves the repaired behaviour disappears with it.
 *
 * Each control carries a PROBE RECEIPT: the mutation asserts the text it is replacing
 * was actually present, so a control cannot quietly become a no-op when the source is
 * refactored and start "passing" against nothing.
 *
 * WHY THIS FILE MATTERS MORE THAN USUAL HERE. The assertion tests/stage-model.js
 * replaced - `assert(creation.includes('const ids=["inputs",…]'))` - was a constant
 * compared against itself, and would have gone green while the taskbar, the renderers
 * and the panel map all disagreed. Every control below therefore breaks a DIFFERENT
 * mechanism and names the assertion that has to notice.
 *
 * NO PROJECT DATA IS TOUCHED, NO PAID CALL AND NO PROVIDER CALL.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Module = require("module");
const { render, buildFixture } = require("./render-harness");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const MODEL_FILE = path.join(PUBLIC, "shared-stage-model.js");
/* Line endings are normalised on read: this repository checks out with
   core.autocrlf=true, so every public/*.js file arrives with CRLF and a multi-line
   anchor written with \n would match nothing and take the control's meaning with it. */
const readSource = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const MODEL_SOURCE = readSource(MODEL_FILE);
const FOCUSED_SOURCE = readSource(path.join(PUBLIC, "focused-workspaces.js"));
const APP_SOURCE = readSource(path.join(PUBLIC, "app.js"));
const AUTOMATION_SOURCE = readSource(path.join(PUBLIC, "automation.js"));

const notes = [];
const note = (line) => notes.push(line);

/* A mutation that must find what it is replacing. */
function mutate(source, needle, replacement, label, expected = 1) {
  const hits = source.split(needle).length - 1;
  assert.strictEqual(hits, expected,
    `probe receipt: ${label} expected ${expected} occurrence(s) of its anchor, found ${hits}. `
    + "The control is no longer mutating the live path and must be rewritten.");
  return source.split(needle).join(replacement);
}

/* A harness mutateSource hook scoped to one file, with the same probe receipt. */
function replacing(file, needle, replacement, label, expected = 1) {
  return (name, contents) => {
    if (name !== file) return contents;
    return mutate(String(contents).replace(/\r\n/g, "\n"), needle, replacement, label, expected);
  };
}

/* A mutated shared-stage-model.js compiled into an in-memory Module. The real filename
   is used so its own resolution behaves normally; the file on disk is opened read-only
   and never written. */
function compileModel(source) {
  const compiled = new Module(MODEL_FILE, null);
  compiled.filename = MODEL_FILE;
  compiled.paths = Module._nodeModulePaths(path.dirname(MODEL_FILE));
  compiled._compile(source, MODEL_FILE);
  return compiled.exports;
}

/* Runs the body and requires it to throw, mentioning `because`. */
async function mustFail(label, because, body) {
  let failure = null;
  try { await body(); }
  catch (error) { failure = error; }
  assert(failure, `NEGATIVE CONTROL DID NOT FIRE: ${label}. The guarantee is not actually being tested.`);
  assert(String(failure.message).includes(because),
    `NEGATIVE CONTROL FIRED FOR THE WRONG REASON: ${label}\n  expected a failure mentioning: ${because}\n  got: ${failure.message}`);
  note(`  ${label} — failed as required`);
}

const scanFor = (project, takes) => ({
  anchors: (project.characters || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/anchors/${x.approvedFile}` })),
  plates: (project.locations || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/plates/${x.approvedFile}` })),
  props: (project.props || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/props/${x.approvedFile}` })),
  vehicles: (project.vehicles || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/vehicles/${x.approvedFile}` })),
  audio: [],
  media: (project.mediaAssets || []).map((asset) => ({ name: asset.file, url: `/assets/media/${asset.file}` })),
  shots: Object.fromEntries((project.shots || []).map((shot) => [shot.id, { takes: takes.map((name) => ({ name, url: `/assets/shots/${shot.id}/takes/${name}` })), locked: [] }])),
});

async function stageSemantics(project, takes, options = {}) {
  const rendered = await render("#/shot/L1-01", project, { scan: scanFor(project, takes), ...options });
  const payload = vm.runInContext(`(() => {
    const shot = P.shots.find((row) => row.id === "L1-01");
    const facts = shotStageModelFacts(shot, takesFor("L1-01"));
    return JSON.stringify(shotStageProgress(facts));
  })()`, rendered.context);
  return { rendered, progress: JSON.parse(payload) };
}

const semantic = (state) => ({ id: state.id, availability: state.availability, completion: state.completion, optional: state.optional, blockedReason: state.blockedReason, next: state.next });

function frameAFixture() {
  const project = buildFixture();
  project.shots[0].keyframes = [project.shots[0].keyframes[0]];
  project.shots[0].clips = [];
  return project;
}
function bothFramesFixture() {
  const project = buildFixture();
  project.shots[0].keyframes.forEach((frame) => { frame.required = true; });
  project.shots[0].clips = [];
  return project;
}

async function main() {
  note("Negative controls for the declared stage model:");

  /* ---------------------------------------------------------------------------
     C1 — DUPLICATE A STAGE ID.
     Two stages claiming one id is how a taskbar button and a workspace renderer
     silently stop referring to the same thing. */
  await mustFail("C1 duplicate stage id", "stage ids must be unique", async () => {
    const broken = compileModel(mutate(MODEL_SOURCE, `      id: "motion",\n      order: 4,`, `      id: "frames",\n      order: 4,`, "C1"));
    const ids = broken.SHOT_STAGE_IDS;
    assert.strictEqual(new Set(ids).size, ids.length, "stage ids must be unique");
  });

  /* ---------------------------------------------------------------------------
     C2 — LET ARRAY POSITION BE THE ORDER.
     Declaring the order explicitly is the point: a model whose order is wherever the
     entry happens to sit in the literal has moved the DOM's mistake up one level. */
  await mustFail("C2 declared order disagrees with the declared sequence", "must declare its order explicitly", async () => {
    const broken = compileModel(mutate(MODEL_SOURCE, `      id: "deliver",\n      order: 5,`, `      id: "deliver",\n      order: 2,`, "C2"));
    broken.SHOT_STAGES.forEach((stage, index) => {
      assert.strictEqual(stage.order, index + 1, `${stage.id} must declare its order explicitly`);
    });
  });

  /* ---------------------------------------------------------------------------
     C3 — REMOVE A TASK MAPPING.
     A declared stage whose workspace renderer is gone falls through to Frames. The
     selection attribute cannot see it — it is written from the selection, not from what
     rendered — so the suite watches for two stages rendering the same workspace. */
  await mustFail("C3 a declared stage loses its workspace renderer", "render the same workspace", async () => {
    const drop = replacing("creation-studio.js", `    motion: () => guidedMotionPanel(s,current,takes,motionOpen),\n`, "", "C3");
    const project = buildFixture();
    const scan = scanFor(project, ["FRAME_A.png", "FRAME_B.png"]);
    const bodies = new Map();
    for (const id of ["frames", "motion"]) {
      const rendered = await render("#/shot/L1-01", project, {
        scan, mutateSource: drop,
        storage: { [`cinebraid-focused:fixture:shot-task:L1-01`]: id },
      });
      const marker = `data-bounded-task="${id}">`;
      bodies.set(id, rendered.html.slice(rendered.html.indexOf(marker) + marker.length));
    }
    assert.notStrictEqual(bodies.get("frames"), bodies.get("motion"),
      "frames and motion render the same workspace — one of them has no renderer of its own");
  });

  /* ---------------------------------------------------------------------------
     C4 — REMOVE A PANEL MAPPING.
     The cross-workspace actions translate a legacy panel key into a stage through the
     declaration. A stage that stops claiming its panel makes those actions unroutable. */
  await mustFail("C4 a stage stops claiming its panel", "must answer from the declaration", async () => {
    const strip = replacing("shared-stage-model.js", `      panels: ["finish"],`, `      panels: [],`, "C4");
    const rendered = await render("#/shot/L1-01", buildFixture(), { scan: scanFor(buildFixture(), []), mutateSource: strip });
    const wired = vm.runInContext("JSON.stringify([guidedPanelTaskId('finish')])", rendered.context);
    assert.deepStrictEqual(JSON.parse(wired), ["deliver"], "the workspace's own panel translator must answer from the declaration");
  });

  /* ---------------------------------------------------------------------------
     C5 — FORCE "TWO APPROVED FRAMES = FIRST/LAST-FRAME MOTION".
     The enduring rule is that the generation route decides how a shot is executed, and
     a stage is not a route. This control puts a frame COUNT into stage semantics, which
     is exactly how a shot with two approved frames would start being told it must
     constrain both endpoints. Two assertions have to notice: the source-level ban on
     frame-count arithmetic, and the S3-vs-S4 identical-semantics comparison. */
  const routePolicy = `      panels: ["motion", "motionCreate", "motionAudio"],`;
  const routePolicyBroken = `      panels: ["motion", "motionCreate", "motionAudio"],\n      endpointPolicy: true,`;
  await mustFail("C5a frame-count arithmetic reaches stage semantics", "how a route gets forced", async () => {
    const broken = mutate(MODEL_SOURCE,
      `    if (facts.requiredFramesApproved)\n      return stageResult(stage, { availability, blockedReason, completion: "not-started", statusKey: "notStarted", tone: "pending" });`,
      `    if (facts.frameApprovedCount >= 2)\n      return stageResult(stage, { availability, blockedReason, completion: "needs-review", statusKey: "needsReview", tone: "attention" });\n    if (facts.requiredFramesApproved)\n      return stageResult(stage, { availability, blockedReason, completion: "not-started", statusKey: "notStarted", tone: "pending" });`,
      "C5a");
    const body = broken.slice(broken.indexOf("function inputsState"), broken.indexOf("const DERIVATIONS"));
    assert(!/(frameApprovedCount|frameTotal)\s*(>=|>|<|<=|===|==)\s*[0-9]/.test(body),
      "no stage derivation may branch on a frame count — that is how a route gets forced");
  });
  await mustFail("C5b one approved frame and two stop meaning the same thing", "does not choose a generation route", async () => {
    const forceEndpoints = replacing("shared-stage-model.js",
      `    if (facts.requiredFramesApproved)\n      return stageResult(stage, { availability, blockedReason, completion: "not-started", statusKey: "notStarted", tone: "pending" });`,
      `    if (facts.frameApprovedCount >= 2)\n      return stageResult(stage, { availability, blockedReason, completion: "needs-review", statusKey: "needsReview", tone: "attention" });\n    if (facts.requiredFramesApproved)\n      return stageResult(stage, { availability, blockedReason, completion: "not-started", statusKey: "notStarted", tone: "pending" });`,
      "C5b");
    const one = await stageSemantics(frameAFixture(), ["FRAME_A.png"], { mutateSource: forceEndpoints });
    const two = await stageSemantics(bothFramesFixture(), ["FRAME_A.png", "FRAME_B.png"], { mutateSource: forceEndpoints });
    assert.deepStrictEqual(two.progress.map(semantic), one.progress.map(semantic),
      "one approved frame and two approved frames must produce identical stage semantics — the stage model does not choose a generation route");
  });
  assert(!MODEL_SOURCE.includes(routePolicyBroken) && MODEL_SOURCE.includes(routePolicy), "C5 anchors must describe the shipped declaration");

  /* ---------------------------------------------------------------------------
     C6 — A REFERENCE-RICH SHOT LOSES ITS ROUTE TO MOTION.
     The optional-frame case is the one that must keep working: a shot whose motion comes
     from approved references, with a second frame the filmmaker declared not required.
     Making motion depend on EVERY frame rather than every REQUIRED frame breaks it. */
  await mustFail("C6 motion gated on every frame rather than every required frame", "without a deliberate ending frame", async () => {
    const gateOnAll = replacing("creation-studio.js",
      `    requiredFramesApproved: !!progress.requiredApproved,`,
      `    requiredFramesApproved: frameStates.length > 0 && frameStates.every((row) => row.key === "approved"),`,
      "C6");
    const referenceRich = buildFixture();
    referenceRich.shots[0].keyframes[1].winner = null;
    referenceRich.shots[0].keyframes[1].required = false;
    referenceRich.shots[0].clips = [];
    const { progress } = await stageSemantics(referenceRich, ["FRAME_A.png"], { mutateSource: gateOnAll });
    const motion = progress.find((state) => state.id === "motion");
    assert.strictEqual(motion.availability, "available",
      "a reference-rich shot must reach motion without a deliberate ending frame");
  });

  /* ---------------------------------------------------------------------------
     C7 — REINTRODUCE DOM-ORDER INFERENCE FOR SHOTS.
     The exact code O1 removed: identity from a CSS class, order from render order,
     status from a regular expression over visible text. */
  await mustFail("C7 enhanceShot derives stages from rendered children again", "must not derive shot stages from the DOM", async () => {
    const restored = mutate(FOCUSED_SOURCE,
      `    if (shot) shell.appendChild(shotInspector(shot));\n  }\n  function entityListName(view) {`,
      `    const tasks = [...stack.children].filter((element) => element.matches("details,section"));\n`
      + `    const active = resolveTaskSelection(tasks, readState("shot-task", id, ""), nextTaskIndex(tasks));\n`
      + `    const bar = buildTaskbar(tasks, "shot-task", id, active, () => {});\n`
      + `    stack.parentNode.insertBefore(bar, stack);\n`
      + `    if (shot) shell.appendChild(shotInspector(shot));\n  }\n  function entityListName(view) {`,
      "C7");
    const body = restored.slice(restored.indexOf("function enhanceShot"), restored.indexOf("function entityListName"));
    for (const inference of ["buildTaskbar", "nextTaskIndex", "resolveTaskSelection", "taskIdForElement", "stack.children"]) {
      assert(!body.includes(inference), `enhanceShot must not derive shot stages from the DOM (found ${inference})`);
    }
  });

  /* ---------------------------------------------------------------------------
     C8 — RESTORE A DEAD STAGE-NAVIGATION WRITER.
     Both of these shipped: a write to `cinebraid-bounded:…` that the reader, which reads
     `cinebraid-focused:…`, never saw. The symptom was silence, which is why the check
     has to look for the key rather than for the intention. */
  await mustFail("C8a blocking automation writes a key nothing reads", "a key nothing reads", async () => {
    const reverted = mutate(AUTOMATION_SOURCE,
      `      try { selectGuidedPanelTask(currentShot, "blocking"); } catch {}`,
      `      try { boundedWriteState("selected:shot-task", currentShot.id, "look"); } catch {}`,
      "C8a");
    assert(!/boundedWriteState\(\s*["']selected:shot-task["']/.test(reverted),
      "blocking automation must not write shot stage selection to a key nothing reads");
  });
  await mustFail("C8b the readiness link writes a key nothing reads", "a key nothing reads", async () => {
    const reverted = mutate(APP_SOURCE,
      `onclick="boundedWriteFocusedTask('\${SHOT_STAGE_SCOPE}'`,
      `onclick="boundedWriteState('shot-task'`,
      "C8b");
    assert(!/boundedWriteState\(\s*['"]shot-task['"]/.test(reverted),
      "the readiness link must not write shot stage selection to a key nothing reads");
  });

  /* ---------------------------------------------------------------------------
     C9 — WIRE THE LEGACY SEVEN-STAGE MODEL BACK UP.
     public/app.js still carries a rival stage model that persisted status onto the shot
     record. It is inert; this proves the suite would notice it stopping being inert. */
  await mustFail("C9 the legacy seven-stage model gains a caller", "must remain uncalled", async () => {
    const wired = mutate(APP_SOURCE,
      `window.clearShotStage = (id, stage) => {`,
      `window.autoCheckStage = (id) => approveShotStage(id, "plan");\nwindow.clearShotStage = (id, stage) => {`,
      "C9");
    for (const writer of ["approveShotStage", "markShotStageNotNeeded", "clearShotStage"]) {
      assert.strictEqual((wired.match(new RegExp(writer, "g")) || []).length, 1,
        `${writer} persists stage status and must remain uncalled`);
    }
  });

  /* ---------------------------------------------------------------------------
     C10 — DROP A DECLARED LIMITATION.
     "Expose the limitation instead of guessing" only holds if quietly deleting the
     limitation is a failure rather than a tidy-up. */
  const FRAMES_LIMITATION = `    "frames-not-optional": {
      question: "May Frames be skipped entirely for a reference-only or description-only shot?",
      why: "The shipped runtime gates the motion workspace on approved required frames regardless of how the shot would be generated, so declaring Frames optional would describe a path the app does not currently offer.",
      wouldNeed: "a motion workspace whose prerequisite depends on the shot's chosen generation route",
    },
`;
  await mustFail("C10a a declared limitation is deleted outright", "must stay declared", async () => {
    const broken = compileModel(mutate(MODEL_SOURCE, FRAMES_LIMITATION, "", "C10a"));
    assert(Object.keys(broken.SHOT_STAGE_LIMITATIONS).length >= 2, "known limitations must stay declared, not quietly dropped");
  });
  /* And a limitation hollowed out rather than removed — the tidier way to stop
     admitting something — has to be noticed too. */
  await mustFail("C10b a declared limitation is hollowed out", "what would fix it", async () => {
    const broken = compileModel(mutate(MODEL_SOURCE,
      `      wouldNeed: "a motion workspace whose prerequisite depends on the shot's chosen generation route",`,
      `      wouldNeed: "",`, "C10b"));
    for (const [key, limitation] of Object.entries(broken.SHOT_STAGE_LIMITATIONS)) {
      assert(limitation.question && limitation.why && limitation.wouldNeed,
        `limitation ${key} must say what it cannot answer, why, and what would fix it`);
    }
  });

  /* ---------------------------------------------------------------------------
     C11 — STOP TRANSLATING LEGACY STORED SELECTIONS.
     Real installs carry `composer` and `finish` in browser workspace state. A model that
     stops translating them silently moves the filmmaker to a different stage. */
  await mustFail("C11 legacy stored selections stop being translated", "must still open Look & blocking", async () => {
    const drop = replacing("shared-stage-model.js",
      `    const legacy = shotStageForLegacyTaskId(key);\n    if (legacy) return legacy.id;`, "", "C11");
    /* The fixture matters: on a shot whose recommendation happens to BE Look & blocking,
       dropping the translation would still land on look and the control would prove
       nothing. This shot has no planning media and a reference without an approved file,
       so its recommendation is Inputs and the two answers genuinely differ. */
    const project = buildFixture();
    project.mediaAssets = [];
    project.props.find((row) => row.id === "PR-TOOL").approvedFile = "";
    const rendered = await render("#/shot/L1-01", project, {
      scan: scanFor(project, ["FRAME_A.png", "FRAME_B.png"]), mutateSource: drop,
      storage: { "cinebraid-focused:fixture:shot-task:L1-01": "composer" },
    });
    assert(rendered.html.includes('data-selected-task="look"'), "a stored 'composer' must still open Look & blocking");
  });

  /* ---------------------------------------------------------------------------
     C12 — LET THE MODEL STORE SOMETHING.
     The whole architecture rests on the stage model describing production state rather
     than becoming a second mutable workflow engine. */
  await mustFail("C12 the declared model reaches for a store", "must not read or write any store", async () => {
    const broken = mutate(MODEL_SOURCE,
      `  function shotStageState(stageId, facts) {`,
      `  function shotStageState(stageId, facts) {\n    try { localStorage.setItem("cinebraid-stage", String(stageId)); } catch {}`,
      "C12");
    assert(!/localStorage|sessionStorage|fetch\(/.test(broken), "the declared model must not read or write any store");
  });

  console.log(notes.join("\n"));
  console.log("declared stage model negative controls passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

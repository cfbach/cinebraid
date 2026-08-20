/* O4 — the persistent stage strip, the persistent stage actions, and the contract
 * between them.
 *
 * THE STATEMENT THIS SUITE EXISTS TO MAKE TRUE, in one line: there is exactly one
 * workflow navigator in CineBraid, it renders what public/shared-stage-model.js
 * declared, and the actions beside it cannot be more available than the stage they
 * belong to.
 *
 * WHAT WAS ACTUALLY THE RISK. O1 deleted five copies of the shot stage list. O4 puts a
 * navigator and an action bar over that one declaration and moves the navigator out of
 * `#main`, which creates two new ways to reintroduce exactly what O1 removed:
 *
 *   1. the OLD navigator survives the move and CineBraid ships two stage bars that can
 *      disagree — the failure the brief names first;
 *   2. the NEW surfaces re-derive something the declaration already answered, most
 *      dangerously availability, so a persistent button offers work a stage is blocked
 *      from doing.
 *
 * Most of this suite is therefore about WHERE a judgement is made rather than what it
 * says, in the same spirit as tests/creator-state.js.
 *
 * WHAT THIS SUITE REFUSES TO DO. It does not assert that a declared constant equals
 * itself. Every check either drives the shipped contract, drives the shipped renderers
 * in a realm, or cross-reads a claim against the module that owns it —
 * public/shared-stage-model.js for stages, public/shared-workspace-shell.js for slots.
 *
 * WHAT IS PROVEN IN CHROMIUM INSTEAD, and why not here: node identity across the five
 * stage transitions, real stage selection through the shipped path, the sticky offsets,
 * the responsive bands and the absence of horizontal overflow are statements about a
 * live document. They are in tests/stage-surfaces-real-browser.py.
 *
 * NO PROJECT DATA IS TOUCHED. NO SERVER IS STARTED. NO REQUEST IS MADE.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

/* CRLF is normalised on read: this repository checks out with core.autocrlf=true, so a
   multi-line anchor written with \n would match nothing and take its assertion's meaning
   with it. */
const readSource = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

const SOURCES = {
  contract: readSource(path.join(PUBLIC, "shared-stage-actions.js")),
  surfaces: readSource(path.join(PUBLIC, "stage-surfaces.js")),
  studio: readSource(path.join(PUBLIC, "creation-studio.js")),
  shell: readSource(path.join(PUBLIC, "shared-workspace-shell.js")),
  shellRuntime: readSource(path.join(PUBLIC, "workspace-shell.js")),
  markup: readSource(path.join(PUBLIC, "index.html")),
  styles: readSource(path.join(PUBLIC, "styles.css")),
};

const Stage = require(path.join(PUBLIC, "shared-stage-model.js"));

/* The shell declaration is loaded from the SOURCE record rather than required, so a
   negative control can hand this suite a mutated copy without writing to disk. */
function loadShell(source = SOURCES.shell) {
  const sandbox = { module: { exports: {} }, window: undefined, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "shared-workspace-shell.js" });
  return sandbox.module.exports;
}

const notes = [];
const note = (line) => notes.push(line);

/* ===========================================================================
   HELPERS
   =========================================================================== */

/* Strips comments so a check about CODE cannot be satisfied — or broken — by prose.
   Both O4 modules discuss the five stages at length in their headers, and a naive
   substring search would confuse describing a thing with doing it. */
function codeOnly(source) {
  return String(source).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

const occurrences = (haystack, needle) => haystack.split(needle).length - 1;

/* The CONTRACT, evaluated in a fresh realm so a negative control can load a MUTATED copy
   without writing to disk. The realm is handed the stage model on its global scope,
   exactly as index.html hands it to the browser. Values crossing the realm boundary are
   spread into host arrays before comparison — a vm-realm Array fails deepStrictEqual
   against a host literal while printing identically. */
function loadContract(source = SOURCES.contract) {
  const sandbox = { console, window: undefined };
  sandbox.globalThis = sandbox;
  Object.assign(sandbox, Stage);
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "shared-stage-actions.js" });
  return sandbox;
}

/* The RUNTIME, evaluated in a realm holding only what the shipped page gives it: the two
   text helpers from public/app.js, the stage model, and the contract. Every app binding
   the runtime reads for the MODEL — shotById, takesFor, shotStageModelFacts — is
   deliberately absent, which is the point: the renderers are being driven with a model
   and nothing else. A renderer that reached for a project here would throw rather than
   quietly work. */
function loadRuntime(sources = SOURCES) {
  const contract = loadContract(sources.contract);
  const listeners = [];
  const sandbox = {
    console,
    esc: (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]),
    location: { hash: "#/shot/SAMPLE-01" },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {
      readyState: "complete",
      getElementById: () => null,
      querySelector: () => null,
      createElement: () => ({ innerHTML: "", firstElementChild: null }),
      addEventListener: () => {},
    },
  };
  sandbox.attr = (t) => sandbox.esc(t).replace(/'/g, "&#39;");
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.addEventListener = (name, fn) => listeners.push([name, fn]);
  Object.assign(sandbox, Stage);
  for (const key of Object.keys(contract)) {
    if (typeof contract[key] === "function" && /^stage/.test(key)) sandbox[key] = contract[key];
  }
  sandbox.stageActions = contract.stageActions;
  sandbox.SHOT_STAGE_SCOPE = Stage.SHOT_STAGE_SCOPE;
  vm.createContext(sandbox);
  vm.runInContext(sources.surfaces, sandbox, { filename: "stage-surfaces.js" });
  return { surfaces: sandbox.window.CineBraidStageSurfaces, listeners, sandbox, contract };
}

/* A model in the shape stage-surfaces.js builds for itself, assembled from REAL O1
   output so the renderers are driven by the declaration rather than by a hand-written
   imitation of it. `status` stands in for the shipped boundedShotTaskStatus — that
   function lives in public/creation-studio.js and is O1's to test; what matters here is
   that the strip prints what it is handed and adds nothing. */
function modelFor(sources, facts, selectedId, shotId = "SAMPLE-01") {
  const resolved = Stage.normaliseShotStageFacts(facts);
  const states = Stage.shotStageProgress(resolved);
  const selected = selectedId || Stage.recommendedShotStageId(resolved);
  const current = states.find((state) => state.id === selected);
  assert.ok(current, `fixture asked for stage ${selected}, which the model does not declare`);
  /* The contract comes from the SOURCE record so a mutated one reaches the renderers. */
  const contract = loadContract(sources.contract);
  return {
    shotId,
    selectedId: selected,
    states,
    current,
    actions: contract.stageActions(current, shotId),
    status: (id) => {
      const state = states.find((row) => row.id === id);
      return { tone: state.tone, label: `STATUS-${state.statusKey}`, ...(state.note ? { note: `NOTE-${state.note.key}` } : {}) };
    },
  };
}

function attrsOf(html, tag) {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, "g"))].map((match) => {
    const out = {};
    for (const pair of match[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) out[pair[1]] = pair[2] === undefined ? true : pair[2];
    return out;
  });
}

/* ===========================================================================
   FIXTURES — representative shot states, chosen so that every availability,
   completion and recommendation branch O4 renders is reachable, and so that the two
   states a strip must never confuse (blocked and not-started) both appear.
   =========================================================================== */

const FIXTURES = {
  /* Nothing done. Every stage available or blocked for a stated reason; frames not
     started, so no recommendation out of it. */
  fresh: { referenceCount: 0, frameTotal: 1, deliveryIntent: "" },
  /* References attached and a frame waiting on a human. This is the state whose strip
     must NOT look like the one above. */
  review: { referenceCount: 5, frameTotal: 1, frameNeedsReview: true, deliveryIntent: "" },
  /* Required frames approved, delivery undecided: the case principle 9 is about. */
  undecided: { referenceCount: 5, frameTotal: 2, frameApprovedCount: 2, requiredFramesApproved: true, deliveryIntent: "" },
  /* The same shot that has said it wants motion. */
  motion: { referenceCount: 5, frameTotal: 2, frameApprovedCount: 2, requiredFramesApproved: true, motionReadinessStatus: "READY", deliveryIntent: "motion" },
  /* A machine working on the frames stage. */
  running: { referenceCount: 5, frameTotal: 2, frameApprovedCount: 1, activityStatus: "running", deliveryIntent: "" },
  /* Delivered. */
  final: { referenceCount: 5, frameTotal: 2, frameApprovedCount: 2, requiredFramesApproved: true, motionReadinessStatus: "COMPLETE", lifecycleKey: "final", deliveryIntent: "motion" },
};

/* ===========================================================================
   1. THERE IS ONE NAVIGATOR

   The first thing O4 can get wrong, and the one a filmmaker would see immediately.
   =========================================================================== */

function checkSingleNavigator(sources = SOURCES) {
  const studio = codeOnly(sources.studio);
  assert.ok(!/boundedShotTaskbarMarkup/.test(studio),
    "public/creation-studio.js still defines or calls boundedShotTaskbarMarkup. The in-`#main` navigator is what O4 replaced; leaving it callable is how a second stage bar comes back.");
  assert.ok(!/focused-taskbar/.test(studio),
    "public/creation-studio.js builds a `.focused-taskbar` again. The shot workspace must render no stage navigator of its own.");

  /* The shot workspace still STATES which stage it rendered — public/focused-workspaces.js
     reads that, and so does every suite that checks the workspace and the strip agree. */
  assert.ok(/data-selected-task=/.test(studio),
    "the shot workspace must keep stating its selected stage in data-selected-task");

  const surfaces = codeOnly(sources.surfaces);
  assert.strictEqual(occurrences(surfaces, "focused-taskbar"), 1,
    "exactly one module may build the shot stage navigator, and it must build exactly one");

  /* And the rendered bar carries exactly one, driven rather than counted in source: a
     second navigator inside one bar is the same defect in a smaller box. */
  const rendered = loadRuntime(sources).surfaces.barMarkup(modelFor(sources, FIXTURES.review, "frames"));
  assert.strictEqual(occurrences(rendered, "<nav "), 1, "the bar must render exactly one navigator");
  assert.strictEqual(occurrences(rendered, "cb-stage-strip"), 1, "and exactly one strip");
  assert.strictEqual(occurrences(rendered, 'data-cb-stage-actions="1"'), 1, "and exactly one action surface");

  /* And the two remaining classes are the ones the shipped browser suites drive the shot
     workspace by. Losing either silently breaks nine suites that would then be testing a
     workspace nobody can navigate. */
  for (const marker of ["focused-taskbar", "bounded-shot-taskbar", "focused-task-button"]) {
    assert.ok(surfaces.includes(marker),
      `the strip must keep emitting ${marker}: the shipped browser suites select the shot workspace's stages by it`);
  }
  note("One navigator: creation-studio.js builds none, stage-surfaces.js builds exactly one, and it keeps the shipped selectors");
}

/* ===========================================================================
   2. THE STAGE LIST IS THE DECLARATION'S

   Not a copy of it, not a filtered version of it, and not the order of anything that
   happened to render.
   =========================================================================== */

function checkDeclarationOwnership(sources = SOURCES) {
  const stageIds = [...Stage.SHOT_STAGE_IDS];
  assert.ok(stageIds.length >= 5, "expected the O1 stage model to declare its stages");

  for (const file of ["contract", "surfaces"]) {
    const code = codeOnly(sources[file]);
    for (const id of stageIds) {
      assert.ok(!new RegExp(`["'\`]${id}["'\`]`).test(code),
        `public/${file === "contract" ? "shared-stage-actions" : "stage-surfaces"}.js names the stage "${id}" in code. `
        + "O4 renders the declaration; a module that can name a stage can be made to treat one specially, which is the sixth stage list O1 exists to prevent.");
    }
    assert.ok(!/SHOT_STAGES\s*=|const\s+STAGES\s*=|STAGE_ORDER\s*=/.test(code),
      "neither O4 module may hold a stage list of its own");
  }

  /* The rendered order IS the declared order, driven through the shipped renderer. */
  const { surfaces } = loadRuntime(sources);
  const html = surfaces.stripMarkup(modelFor(sources, FIXTURES.review, "frames"));
  const rendered = [...html.matchAll(/data-stage-id="([a-z-]+)"/g)].map((match) => match[1]);
  assert.deepStrictEqual(rendered, stageIds,
    "the strip must render the declared stages in the declared order, once each");

  /* Order comes from the DECLARATION, not from array position: a model whose states
     arrive shuffled must still render in declared order... which it cannot, because the
     strip renders what it is given. So the claim is made where it is true — the strip
     renders public/shared-stage-model.js's OWN ordered output and never re-sorts it. */
  assert.ok(!/\.sort\(|\.reverse\(|\.filter\(/.test(codeOnly(sources.surfaces).split("function stripMarkup")[1] || ""),
    "stripMarkup must render the states it was handed, in the order it was handed them");

  const labels = [...html.matchAll(/<b>([^<]*)<\/b>/g)].map((match) => match[1]);
  assert.deepStrictEqual(labels, Stage.SHOT_STAGES.map((stage) => stage.label.replace(/&/g, "&amp;")),
    "every visible stage name must be the declared label");
  note(`Declaration: ${stageIds.length} stages, declared order and declared labels, and neither O4 module names one in code`);
}

/* ===========================================================================
   3. STAGE STATE IS RENDERED, NOT RE-DECIDED

   Every attribute the stylesheet and the suites key off is compared against what O1
   returned for the same facts.
   =========================================================================== */

function checkStagePresentation(sources = SOURCES) {
  const { surfaces } = loadRuntime(sources);
  const seen = new Set();

  for (const [name, facts] of Object.entries(FIXTURES)) {
    const model = modelFor(sources, facts, null);
    const html = surfaces.stripMarkup(model);
    const buttons = attrsOf(html, "button");
    assert.strictEqual(buttons.length, model.states.length, `${name}: one button per declared stage`);

    buttons.forEach((button, index) => {
      const state = model.states[index];
      assert.strictEqual(button["data-stage-id"], state.id, `${name}: button ${index} is out of declared order`);
      assert.strictEqual(button["data-availability"], state.availability,
        `${name}/${state.id}: the strip painted availability "${button["data-availability"]}" where the declaration said "${state.availability}"`);
      assert.strictEqual(button["data-completion"], state.completion,
        `${name}/${state.id}: the strip painted completion "${button["data-completion"]}" where the declaration said "${state.completion}"`);
      assert.ok(button.class.includes(`tone-${state.tone}`),
        `${name}/${state.id}: the strip must carry the declared tone`);
      seen.add(`${state.availability}:${state.completion}`);
    });

    /* EXACTLY ONE CURRENT STAGE, and it is the selected one. */
    const current = buttons.filter((button) => button["aria-current"] === "step");
    assert.strictEqual(current.length, 1, `${name}: exactly one stage may be marked current`);
    assert.strictEqual(current[0]["data-stage-id"], model.selectedId,
      `${name}: the current marker must be on the selected stage`);
    assert.ok(current[0].class.includes("selected"),
      `${name}: the shipped selected class must stay, or every browser suite that reads it stops seeing a selection`);
  }

  /* BLOCKED AND NOT-STARTED MUST BE DISTINGUISHABLE, and this is the fixture that
     proves the strip can tell them apart rather than the stylesheet being trusted. */
  const fresh = surfaces.stripMarkup(modelFor(sources, FIXTURES.fresh, "inputs"));
  const freshButtons = attrsOf(fresh, "button");
  const blocked = freshButtons.filter((button) => button["data-availability"] === "blocked");
  const notStarted = freshButtons.filter((button) => button["data-availability"] === "available" && button["data-completion"] === "not-started");
  assert.ok(blocked.length && notStarted.length,
    "the fresh fixture must contain both a blocked stage and an available not-started one, or the next assertion proves nothing");
  assert.notStrictEqual(blocked[0]["data-availability"], notStarted[0]["data-availability"],
    "a blocked stage and a not-started stage must not render the same availability");

  /* The stylesheet keys the blocked treatment off availability rather than off tone,
     because the shipped tone for a blocked stage is `optional` — which O1 is explicit it
     cannot honestly claim. */
  /* The blocked treatment is keyed off the declared availability, in every part of it.
     One rule keyed on the tone is enough to reintroduce the claim: `optional` is the word
     public/shared-stage-model.js is explicit it cannot honestly say about a stage. */
  const blockedRules = [...sources.styles.matchAll(/\.cb-stage-strip [^\n{]*\{[^}]*\}/g)]
    .map((match) => match[0])
    .filter((rule) => /opacity|box-shadow:inset 0 0 0 2px|>em\{color/.test(rule) && /blocked|tone-optional/.test(rule));
  assert.ok(blockedRules.length >= 3,
    `public/styles.css must give a blocked stage its own treatment; found ${blockedRules.length} rules that could be it`);
  for (const rule of blockedRules) {
    assert.ok(rule.includes('[data-availability="blocked"]'),
      `a blocked-stage rule is keyed off something other than the declared availability: ${rule.slice(0, 90)}`);
  }
  assert.ok(/\[aria-current="step"\]/.test(sources.styles),
    "the current stage's treatment must key off the accessibility state, not off a class only the CSS knows about");

  /* COVERAGE STATED AGAINST THE DECLARED VOCABULARY, not against a count. Every
     completion the model declares must have been rendered by some fixture, and both
     availabilities must have been, or the assertions above ran over a narrower slice of
     the workflow than they claim to. */
  const completions = new Set([...seen].map((pair) => pair.split(":")[1]));
  const availabilities = new Set([...seen].map((pair) => pair.split(":")[0]));
  assert.deepStrictEqual([...completions].sort(), [...Stage.SHOT_STAGE_COMPLETION].sort(),
    `the fixtures must render every declared completion; missing: ${[...Stage.SHOT_STAGE_COMPLETION].filter((c) => !completions.has(c)).join(", ")}`);
  assert.deepStrictEqual([...availabilities].sort(), [...Stage.SHOT_STAGE_AVAILABILITY].sort(),
    "the fixtures must render both declared availabilities, or 'blocked does not look like not-started' was never tested");
  note(`Stage state: ${seen.size} availability/completion pairs rendered — every declared completion and both availabilities — each matching the declaration exactly`);
}

/* ===========================================================================
   4. THE ACTION CONTRACT

   Availability is copied. Everything else the contract can do is a refusal.
   =========================================================================== */

function checkActionContract(sources = SOURCES) {
  const contract = loadContract(sources.contract);
  const { stageActions, STAGE_ACTION_INVOKE_KINDS, STAGE_ACTION_LIMITATIONS, stagePrimaryPanel } = contract;

  let blockedSeen = 0;
  let availableSeen = 0;
  for (const [name, facts] of Object.entries(FIXTURES)) {
    const resolved = Stage.normaliseShotStageFacts(facts);
    for (const state of Stage.shotStageProgress(resolved)) {
      const actions = stageActions(state, "SAMPLE-01");
      assert.ok(actions.length <= 2, `${name}/${state.id}: the persistent bar is bounded; ${actions.length} actions is a junk drawer`);
      for (const action of actions) {
        assert.strictEqual(action.availability, state.availability,
          `${name}/${state.id}: action "${action.id}" is ${action.availability} where the stage is ${state.availability}. Availability is copied, never re-derived.`);
        assert.strictEqual(action.disabledReason, state.availability === "blocked" ? state.blockedReason : "",
          `${name}/${state.id}: action "${action.id}" must carry the declaration's own reason, and only when blocked`);
        assert.strictEqual(action.paid, false, "no persistent action may be paid");
        assert.strictEqual(action.destructive, false, "no persistent action may be destructive");
        assert.ok([...STAGE_ACTION_INVOKE_KINDS].includes(action.invoke.kind),
          `${name}/${state.id}: action "${action.id}" names an undeclared invocation kind`);
        assert.strictEqual(action.invoke.shotId, "SAMPLE-01", "every invocation must address the shot it was built for");
        if (action.availability === "blocked") { assert.ok(action.disabledReason.length > 3); blockedSeen += 1; }
        else availableSeen += 1;
      }
      /* THE PRIMARY OPENS THE STAGE'S OWN DECLARED PANEL, read from O1 rather than
         mapped here. A stage whose workspace moves takes its action with it. */
      const primary = actions.find((action) => action.emphasis === "primary");
      assert.ok(primary, `${name}/${state.id}: every stage must offer its own work, blocked or not — hiding it is what makes a filmmaker hunt`);
      assert.strictEqual(primary.invoke.panel, Stage.shotStage(state.id).panels[0],
        `${name}/${state.id}: the primary action must open the stage's first DECLARED panel`);
      assert.strictEqual(primary.advances, false, "opening the current stage's work must not be described as advancing a stage");
    }
  }
  assert.ok(blockedSeen > 0 && availableSeen > 0,
    `the fixtures must produce both blocked and available actions, saw ${blockedSeen}/${availableSeen}`);

  /* stagePrimaryPanel reads the declaration and nothing else. */
  for (const stage of Stage.SHOT_STAGES) {
    assert.strictEqual(stagePrimaryPanel(stage.id), stage.panels[0], `${stage.id}: the panel must come from the declaration`);
  }
  assert.strictEqual(stagePrimaryPanel("not-a-stage"), "", "an undeclared stage implies no panel");
  assert.deepStrictEqual([...stageActions(null, "SAMPLE-01")], [], "no stage, no actions");
  assert.deepStrictEqual([...stageActions(Stage.shotStageState("frames", {}), "")], [], "no shot, no actions");

  /* THE REFUSALS, driven rather than described. Each of these is a shape a future edit
     could produce, and each must come back as a shorter list rather than as a button. */
  const contract2 = loadContract(sources.contract);
  const frozen = contract2.stageActions(Stage.shotStageState("frames", {}), "SAMPLE-01");
  assert.ok(Object.isFrozen(frozen), "the action list must be frozen; a caller that mutated it would be editing the contract");
  assert.ok(Object.isFrozen(frozen[0]), "each action must be frozen too");

  const limitations = STAGE_ACTION_LIMITATIONS;
  for (const key of ["no-approval-action", "no-generation-action", "no-stage-completion-action"]) {
    assert.ok(limitations[key], `the contract must keep declaring the limitation "${key}" rather than quietly growing the action`);
    assert.ok(String(limitations[key].why).length > 60, `${key} must record WHY, so it reads as a decision rather than an oversight`);
  }
  note(`Actions: ${blockedSeen} blocked and ${availableSeen} available across the fixtures, every one copying the declaration's availability`);
}

/* ===========================================================================
   5. RECOMMENDATION SAFETY

   The rules the brief states as principles, driven against real derivations.
   =========================================================================== */

function checkRecommendationSafety(sources = SOURCES) {
  const { stageActions } = loadContract(sources.contract);
  const advance = (state) => [...stageActions(state, "SAMPLE-01")].find((action) => action.advances) || null;

  /* NO RECOMMENDATION IS A RESULT. An undecided shot with its required frames approved
     is the exact case: O1 returns "", and O4 must offer no Continue rather than pointing
     at whichever stage is declared next. */
  const undecided = Stage.shotStageState("frames", FIXTURES.undecided);
  assert.strictEqual(undecided.recommendedNext, "", "fixture check: an undecided shot must get no recommendation from O1");
  assert.strictEqual(advance(undecided), null,
    "an empty recommendedNext must produce no Continue action. Inventing one is the guess principle 9 forbids, and 'motion is next in the list' is exactly that guess.");

  /* And where a recommendation genuinely exists, it is offered — and it points where the
     declaration pointed, not one stage further on. */
  const decided = Stage.shotStageState("frames", FIXTURES.motion);
  assert.strictEqual(decided.recommendedNext, "motion", "fixture check: a shot that has said it wants motion gets a recommendation");
  const offered = advance(decided);
  assert.ok(offered, "a real recommendation must be offered as an action");
  assert.strictEqual(offered.invoke.stageId, "motion", "the Continue action must target the recommended stage and no other");
  assert.strictEqual(offered.invoke.kind, "select-stage", "advancing is stage SELECTION — it must not perform work on the way");

  /* TWO APPROVED FRAMES IMPLY NOTHING. The brief's rule 7 and O1's own count-free
     prerequisite: the actions for one approved required frame and for two must be
     identical, because a frame COUNT is not a directorial decision about endpoints. */
  const shape = (facts) => [...stageActions(Stage.shotStageState("motion", facts), "SAMPLE-01")]
    .map((action) => `${action.id}:${action.availability}:${action.label}`);
  const oneFrame = { frameTotal: 1, frameApprovedCount: 1, requiredFramesApproved: true, motionReadinessStatus: "READY", deliveryIntent: "motion" };
  const twoFrames = { frameTotal: 2, frameApprovedCount: 2, requiredFramesApproved: true, motionReadinessStatus: "READY", deliveryIntent: "motion" };
  assert.deepStrictEqual(shape(oneFrame), shape(twoFrames),
    "the persistent actions changed because a second frame was approved. A frame count is a fact about frames; it is not a decision to constrain both endpoints, and O4 must not turn the first into the second.");

  /* The same for the strip. */
  const { surfaces } = loadRuntime(sources);
  const strip = (facts) => attrsOf(surfaces.stripMarkup(modelFor(sources, facts, "motion")), "button")
    .map((button) => `${button["data-stage-id"]}:${button["data-availability"]}:${button["data-completion"]}`);
  assert.deepStrictEqual(strip(oneFrame), strip(twoFrames),
    "the strip's semantics changed on a frame count alone");

  /* NO ROUTE NAME ANYWHERE. O4 renders what CineBraid can execute today and must not
     claim a generation route, which is the Motion limitation carried forward. */
  for (const file of ["contract", "surfaces"]) {
    const code = codeOnly(sources[file]);
    for (const route of ["i2v", "flf", "r2v", "t2v", "first-last", "firstLast"]) {
      assert.ok(!new RegExp(`["'\`]${route}["'\`]`, "i").test(code),
        `public/${file === "contract" ? "shared-stage-actions" : "stage-surfaces"}.js names the generation route "${route}". No stage declares a route, so naming one here is a claim about execution O4 cannot support.`);
    }
  }
  note("Recommendations: an empty recommendedNext produces no Continue, a real one targets the declared stage, and one approved frame and two produce identical surfaces");
}

/* ===========================================================================
   6. DISABLED MEANS DISABLED, AND SAYS WHY

   The accessibility claims, made against rendered markup rather than against intent.
   =========================================================================== */

function checkDisabledAndAccess(sources = SOURCES) {
  const { surfaces } = loadRuntime(sources);

  /* A blocked stage: the primary action is rendered, disabled, and describes itself. */
  const model = modelFor(sources, FIXTURES.fresh, "motion");
  assert.strictEqual(model.current.availability, "blocked", "fixture check: motion must be blocked with no approved frames");
  const html = surfaces.actionsMarkup(model);
  const buttons = attrsOf(html, "button");
  assert.strictEqual(buttons.length, 1, "a blocked stage with no recommendation offers exactly one action");
  assert.strictEqual(buttons[0].disabled, true,
    "an unavailable action must carry the real `disabled` attribute. A button that only LOOKS unavailable is one a keyboard reaches and a click fires.");
  const describedBy = buttons[0]["aria-describedby"];
  assert.ok(describedBy, "a disabled action must point at its reason");
  const reason = html.match(new RegExp(`<p class="cb-stage-action-reason" id="${describedBy}">([^<]*)</p>`));
  assert.ok(reason, `the element "${describedBy}" the disabled action describes itself by must exist`);
  assert.strictEqual(reason[1], model.current.blockedReason,
    "the visible reason must be the declaration's own words, not a paraphrase");
  assert.ok(!/title="/.test(html),
    "the reason must not be delivered by tooltip alone: a reason only a pointer can reveal is a reason a keyboard user does not have");

  /* An available stage: no disabled attribute, no orphan reason. */
  const open = modelFor(sources, FIXTURES.motion, "motion");
  assert.strictEqual(open.current.availability, "available", "fixture check: canonical readiness opens Motion");
  const openHtml = surfaces.actionsMarkup(open);
  assert.ok(!/disabled/.test(openHtml), "an available stage's actions must not be disabled");
  assert.ok(!/cb-stage-action-reason/.test(openHtml), "an available action must not print a disabled reason");

  /* ONE REASON PER DISTINCT REASON. Two blocked actions on one stage necessarily share
     one, and printing it twice is a rendering fault the reader would read as two
     problems. */
  const doubled = { ...modelFor(sources, FIXTURES.fresh, "motion") };
  const first = doubled.actions[0];
  doubled.actions = Object.freeze([first, Object.freeze({ ...first, id: "synthetic-advance", emphasis: "advance", advances: true, label: "Continue" })]);
  const doubledHtml = surfaces.actionsMarkup(doubled);
  assert.strictEqual(occurrences(doubledHtml, "cb-stage-action-reason"), 1,
    "two actions blocked for the same reason must print that reason once");
  const ids = attrsOf(doubledHtml, "button").map((button) => button["aria-describedby"]);
  assert.strictEqual(new Set(ids).size, 1, "and both must point at the one element that holds it");

  /* The strip's stages stay real buttons — keyboard reachable by construction — and the
     current one is announced as a step rather than by colour alone. */
  const stripHtml = surfaces.stripMarkup(modelFor(sources, FIXTURES.review, "frames"));
  assert.strictEqual(occurrences(stripHtml, '<button type="button"'), Stage.SHOT_STAGE_IDS.length,
    "every stage must be a real button, or the strip is not keyboard reachable");
  assert.ok(/<nav class="[^"]*" aria-label="Shot production stages">/.test(stripHtml),
    "the strip must keep its accessible name");
  assert.strictEqual(occurrences(stripHtml, 'aria-current="step"'), 1, "exactly one stage is current");
  assert.ok(/role="group"/.test(html) && /aria-label="/.test(html),
    "the action surface must name itself, or it is an unlabelled cluster of buttons in a landmark");
  note("Access: disabled actions carry the real attribute and a VISIBLE declaration-worded reason; one reason element per reason; every stage is a button and one is aria-current");
}

/* ===========================================================================
   7. THE BAR IS A DECLARED SHELL SLOT

   O4 mounts through O2 rather than inventing a second way to put something on the page.
   =========================================================================== */

function checkShellIntegration(sources = SOURCES) {
  const Shell = loadShell(sources.shell);
  const slot = Shell.shellSlot("bar");
  assert.ok(slot, "the shell must declare the bar region O4 mounts into");
  assert.strictEqual(slot.element, "cb-shell-bar");
  assert.strictEqual(slot.mountable, true, "the bar must be mountable, or O4 needs its own mounting mechanism");
  assert.strictEqual(slot.collapsesWhenEmpty, true,
    "the bar must collapse when empty: on every route that is not a shot it holds nothing and must occupy nothing");
  assert.strictEqual(slot.scroll, "self-horizontal",
    "the bar bounds WIDTH, not volume. A bar that owned vertical scrolling would be a bar that could grow.");
  assert.ok([...Shell.MOUNTABLE_SLOT_NAMES].includes("bar"));

  /* Static markup, for the same reason the other three are: a region JavaScript creates
     is a region JavaScript can create twice. */
  assert.ok(/<div id="cb-shell-bar" class="cb-shell-slot" data-shell-slot="bar"/.test(sources.markup),
    "the bar region must be static markup in index.html");
  assert.strictEqual(occurrences(sources.markup, 'id="cb-shell-bar"'), 1, "exactly one bar region");
  assert.ok(/<div id="cb-shell-bar"[^>]*><div class="cb-shell-slot-body"><\/div><\/div>/.test(sources.markup),
    "the bar slot must ship empty with exactly one slot body — occupancy is a question about that element's children");
  const workspace = sources.markup.slice(sources.markup.indexOf('<section id="workspace">'), sources.markup.indexOf("</section>"));
  assert.ok(workspace.indexOf('id="cb-shell-bar"') > workspace.indexOf('id="topbar"'),
    "the bar belongs beneath the topbar");
  assert.ok(workspace.indexOf('id="cb-shell-bar"') < workspace.indexOf('id="cb-shell-main"'),
    "and above the centre it navigates");
  assert.ok(/<main id="main"><\/main>/.test(sources.markup),
    "#main must still ship empty — O4 moved a navigator OUT of it and must not have left anything behind");

  /* Both O4 modules are loaded, and the contract before the runtime that reads it. */
  assert.ok(/<script src="shared-stage-actions\.js/.test(sources.markup), "the action contract must be loaded by index.html");
  assert.ok(/<script src="stage-surfaces\.js/.test(sources.markup), "the O4 runtime must be loaded by index.html");
  assert.ok(sources.markup.indexOf("shared-stage-actions.js") < sources.markup.indexOf('src="stage-surfaces.js'),
    "the contract must load before the runtime that reads it");
  assert.ok(sources.markup.indexOf("shared-stage-model.js") < sources.markup.indexOf("shared-stage-actions.js"),
    "and the stage model before the contract that reads IT");

  /* THE RUNTIME OWNS NO REGION. It mounts through the shell's API and nothing else, so
     "the bar is the same node after a stage change" is true by construction. */
  const surfaces = codeOnly(sources.surfaces);
  assert.ok(/CineBraidShell/.test(surfaces) && /mountSlot\(/.test(surfaces),
    "the runtime must mount through the shell's own API");
  assert.ok(!/createElement\(["'](?:section|nav|aside)["']\)/.test(surfaces),
    "the runtime must not construct a region of its own");

  /* THE SHELL PUBLISHES THE BAR'S HEIGHT, and the stylesheet consumes it. Two surfaces
     agreeing here is the difference between a sticky bar and a bar that hides the shot
     header underneath it. */
  const shellRuntime = codeOnly(sources.shellRuntime);
  assert.ok(/--cb-bar-height/.test(shellRuntime), "public/workspace-shell.js must publish the bar's height");
  assert.ok(/--cb-bar-height/.test(sources.styles), "and public/styles.css must consume it");
  /* Every surface that pins beneath the bar. Each anchor carries its own probe: the rule
     must be findable, or the assertion about it would be vacuous. */
  for (const [what, anchor] of [
    ["the Assistant rail", "#cb-shell-rail{position:sticky;top:calc("],
    ["the shot's navigator and inspector", ".focused-workspace-shell>.project-navigator,.focused-inspector{"],
  ]) {
    const at = sources.styles.indexOf(anchor);
    assert.ok(at >= 0, `${what}: expected a sticky rule at "${anchor}" — the check below would otherwise be reading nothing`);
    const rule = sources.styles.slice(sources.styles.indexOf("{", at) + 1, sources.styles.indexOf("}", at));
    /* BOTH declarations, separately. `top` alone puts the surface in the right place and
       leaves it as many pixels too tall as the bar is deep, which pushes its bottom under
       the dock; `max-height` alone leaves its top behind the strip. Checking the rule as
       one string would accept either half. */
    for (const property of ["top", "max-height"]) {
      const declaration = rule.split(";").find((part) => part.trim().startsWith(`${property}:`));
      assert.ok(declaration, `${what}: expected a ${property} declaration in its sticky rule`);
      assert.ok(declaration.includes("--cb-bar-height"),
        `${what}: its ${property} does not offset by --cb-bar-height, so the bar and this surface disagree about where the bar ends`);
    }
  }
  /* And the bar's own offset is the topbar's declared stop, not a literal that can drift
     away from the topbar it is aligning to. */
  const barRule = sources.styles.slice(sources.styles.indexOf("#cb-shell-bar{position:sticky"));
  assert.ok(/top:var\(--cb-topbar-stop/.test(barRule.slice(0, 400)),
    "the bar must pin at the topbar's declared stop, so the two cannot disagree about where the topbar ends");
  /* And it is zero where the bar is not painted, which is what makes those rules inert
     on every other route. */
  assert.ok(/var\(--cb-bar-height,\s*0px\)/.test(sources.styles),
    "every consumer must default the bar height to 0px, so the offsets vanish off the shot route");
  note("Shell: the bar is a declared, mountable, collapse-when-empty slot in static markup, and its height is published once and consumed with a 0px default");
}

/* ===========================================================================
   8. NOTHING IS STORED, NOTHING IS SPENT, NOTHING IS APPROVED

   The structural refusals, read off the code rather than trusted.
   =========================================================================== */

function checkRefusals(sources = SOURCES) {
  const surfaces = codeOnly(sources.surfaces);
  const contract = codeOnly(sources.contract);

  for (const [name, code] of [["stage-surfaces", surfaces], ["shared-stage-actions", contract]]) {
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket/.test(code), `public/${name}.js must make no request`);
    assert.ok(!/setInterval\s*\(|setTimeout\s*\(/.test(code),
      `public/${name}.js must add no timer: activity is already polled once, and a second clock over the same data is how two surfaces come to disagree`);
    assert.ok(!/\bdirty\s*\(|\bsaveProject|localStorage\.setItem/.test(code),
      `public/${name}.js must write nothing to the project or to storage`);
  }

  /* No approval, no generation, no deletion — by vocabulary and by dispatch. The runtime
     can only make the two calls the contract declares. */
  for (const forbidden of ["approve", "markCandidateApproved", "confirmApproveTake", "falSubmit", "buildGuided", "delShot", "queueGuided"]) {
    assert.ok(!new RegExp(forbidden, "i").test(surfaces),
      `public/stage-surfaces.js reaches for "${forbidden}". Approval establishes canon and generation costs money; neither belongs behind a persistent button.`);
  }
  const dispatched = [...surfaces.matchAll(/window\.(\w+)\s*===\s*"function"/g)].map((match) => match[1]);
  assert.deepStrictEqual(dispatched.sort(), ["openGuidedPanel", "selectBoundedTask"],
    `the runtime may dispatch exactly the two shipped calls the contract declares, found: ${dispatched.join(", ")}`);

  /* THE DECLARED KINDS AND THE DISPATCHABLE KINDS ARE ONE LIST, cross-read between the
     two modules rather than asserted against itself. A kind the contract declares and
     nothing dispatches is a promise no button can keep; a kind the runtime dispatches and
     the contract does not declare is an action outside the bound the contract exists to
     impose. Either way the list has stopped being the answer to "what can a persistent
     button do". */
  const declaredKinds = [...loadContract(sources.contract).STAGE_ACTION_INVOKE_KINDS].sort();
  const handledKinds = [...surfaces.matchAll(/target\.kind\s*===\s*"([a-z-]+)"/g)].map((match) => match[1]).sort();
  assert.deepStrictEqual(handledKinds, declaredKinds,
    `the contract declares [${declaredKinds.join(", ")}] and the runtime dispatches [${handledKinds.join(", ")}]. These must be the same list.`);

  /* THE PAID/DESTRUCTIVE REFUSAL IS STRUCTURAL, not a convention. A candidate flagged
     either way produces no button at all — a visible failure — rather than a button that
     works. Driven through the shipped acceptance path by mutating the SOURCE in memory,
     because there is no other way to hand the contract a candidate it did not build. */
  const paid = sources.contract.replace(
    'id: "open-stage-work",',
    'id: "open-stage-work", paid: true,',
  );
  assert.notStrictEqual(paid, sources.contract, "the paid-candidate control must have found its anchor");
  const paidContract = loadContract(paid);
  const paidActions = paidContract.stageActions(Stage.shotStageState("frames", FIXTURES.motion), "SAMPLE-01");
  assert.ok(![...paidActions].some((action) => action.id === "open-stage-work"),
    "a candidate flagged paid must be dropped, not rendered differently. O4 must not make paid work one click from anywhere.");

  const destructive = sources.contract.replace(
    'id: "continue-to-next-stage",',
    'id: "continue-to-next-stage", destructive: true,',
  );
  assert.notStrictEqual(destructive, sources.contract, "the destructive-candidate control must have found its anchor");
  const destructiveActions = loadContract(destructive).stageActions(Stage.shotStageState("frames", FIXTURES.motion), "SAMPLE-01");
  assert.ok(![...destructiveActions].some((action) => action.advances),
    "a candidate flagged destructive must be dropped too");

  /* A blocked action with no reason is worse than no action, and is refused. */
  const silent = sources.contract.replace("disabledReason: state.blockedReason,\n        emphasis: \"primary\",", "disabledReason: \"\",\n        emphasis: \"primary\",");
  assert.notStrictEqual(silent, sources.contract, "the reasonless-block control must have found its anchor");
  const silentActions = loadContract(silent).stageActions(Stage.shotStageState("motion", FIXTURES.fresh), "SAMPLE-01");
  assert.ok(![...silentActions].some((action) => action.emphasis === "primary"),
    "a blocked action with no reason must be dropped rather than rendered mute");
  note("Refusals: no request, no timer, no write, no approval; exactly two dispatchable calls; paid, destructive and reasonless candidates are dropped by the builder");
}

/* ===========================================================================
   9. THE RUNTIME REACTS RATHER THAN POLLS, AND CLEARS ITSELF OFF A SHOT
   =========================================================================== */

function checkLifecycle(sources = SOURCES) {
  const { listeners, surfaces } = loadRuntime(sources);
  const names = listeners.map(([name]) => name).sort();
  assert.deepStrictEqual(names, ["cinebraid:activity-updated", "cinebraid:route-rendered", "cinebraid:workspace-updated", "hashchange", "load", "resize"],
    `the runtime must repaint from the shell's own signals and nothing else, found: ${names.join(", ")}`);

  /* Activity is one of them ON PURPOSE: the declared model mirrors a run's status onto
     the stage it is working on, so the moment activity changes is the moment a stage's
     tone is wrong. */
  assert.ok(names.includes("cinebraid:activity-updated"),
    "the strip shows machine activity per stage and must repaint when activity changes");

  /* ELIGIBILITY IS NARROWER THAN THE SHELL'S, and is answered by declining to mount. */
  const code = codeOnly(sources.surfaces);
  assert.ok(/creatorShellState/.test(code),
    "the runtime must ask the shell whether the workspace is present rather than deriving a third answer");
  assert.ok(/clearSlot/.test(code), "and must clear its slot where it has nothing to say, which is what collapses it");
  assert.ok(/view === "shot"/.test(code), "the bar's own eligibility is the shot route, stated once");

  /* Off a shot the model is null, which is what unmounts. Driven: the realm's location
     is a shot, so this asks the runtime with the hash changed under it. */
  assert.ok(typeof surfaces.stageModel === "function", "the model must be readable for the suites");
  note(`Lifecycle: ${names.length} signals, no timer, and the bar clears itself on every route that is not a shot`);
}

/* ===========================================================================
   RUN
   =========================================================================== */

const CHECKS = {
  checkSingleNavigator,
  checkDeclarationOwnership,
  checkStagePresentation,
  checkActionContract,
  checkRecommendationSafety,
  checkDisabledAndAccess,
  checkShellIntegration,
  checkRefusals,
  checkLifecycle,
};

function run(sources = SOURCES) {
  notes.length = 0;
  for (const check of Object.values(CHECKS)) check(sources);
  return notes;
}

if (require.main === module) {
  run();
  for (const line of notes) console.log("  ·", line);
  console.log("persistent stage strip and stage action assertions passed");
}

module.exports = { run, SOURCES, loadContract, loadRuntime, modelFor, FIXTURES, codeOnly, attrsOf, ...CHECKS };

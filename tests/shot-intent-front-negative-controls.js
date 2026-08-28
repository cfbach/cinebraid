/* Negative controls for tests/shot-intent-front.js.
 *
 * A guarantee nobody has watched fail is a guarantee nobody has tested. Each control
 * below reintroduces ONE specific defect into an IN-MEMORY copy of the shipped source
 * and proves the corresponding guarantee disappears with it. Nothing on disk is written,
 * so no control can be "restored" by a checkout that also discards real work.
 *
 * Every control carries a PROBE RECEIPT: the mutation asserts its anchor was actually
 * present before replacing it, so a control cannot quietly become a no-op after a
 * refactor and start passing against nothing. Anchors are matched against source read
 * with line endings normalised — this repository checks out with core.autocrlf=true, and
 * a multi-line anchor written with \n matches ZERO times in a normal checkout, which
 * aborts the control rather than failing it.
 *
 * NO PROVIDER, NO PAID ROUTE, NO NETWORK, NO PROJECT DATA.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const READINESS_FILE = path.join(PUBLIC, "shared-shot-readiness.js");

const Kernel = require(path.join(PUBLIC, "shared-authority-kernel.js"));
const { render, buildFixture } = require("./render-harness.js");
const { installTestManualActionSource } = require("./authority-test-gesture.js");
const GESTURE = installTestManualActionSource(Kernel);
const AT = "2026-08-28T09:00:00.000Z";

const readLF = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const READINESS_SOURCE = readLF(READINESS_FILE);

const notes = [];

/* ---- the control harness ------------------------------------------------- */

function mutateIn(source, needle, replacement, label, expected = 1) {
  const hits = source.split(needle).length - 1;
  assert.strictEqual(hits, expected,
    `probe receipt: ${label} expected ${expected} occurrence(s) of its anchor, found ${hits}. `
    + "The control is no longer mutating the live path and must be rewritten.");
  return source.split(needle).join(replacement);
}
function mutate(needle, replacement, label, expected = 1) {
  return mutateIn(READINESS_SOURCE, needle, replacement, label, expected);
}
/* The mutated readiness module, compiled in memory under its real filename so its own
   sibling requires resolve normally. The file on disk is opened read-only. */
function compile(source) {
  const compiled = new Module(READINESS_FILE, null);
  compiled.filename = READINESS_FILE;
  compiled.paths = Module._nodeModulePaths(path.dirname(READINESS_FILE));
  compiled._compile(source, READINESS_FILE);
  return compiled.exports;
}
/* A browser-source mutation, applied to ONE named file as the harness loads it. The
   receipt is taken here rather than inside the callback, so an anchor that stopped
   matching aborts the control instead of rendering an unmutated page that passes. */
function pageMutation(file, needle, replacement, label, expected = 1) {
  const original = readLF(path.join(PUBLIC, file));
  const mutated = mutateIn(original, needle, replacement, label, expected);
  return (name, source) => (name === file ? mutated : source);
}

function report(label, because, failure) {
  assert(failure, `NEGATIVE CONTROL DID NOT FIRE: ${label}. The guarantee is not actually being tested.`);
  assert(String(failure.message).includes(because),
    `NEGATIVE CONTROL FIRED FOR THE WRONG REASON: ${label}\n  expected a failure mentioning: ${because}\n  got: ${failure.message}`);
  notes.push(`  ${label} — failed as required`);
}
/* EVERY CONTROL IS QUEUED AND RUN IN ORDER by main() below, sync and async alike.
   A bare `mustFailAsync(...)` at module scope is a floating promise: the controls
   would interleave, their notes would arrive out of order, and a rejection would
   surface as an unhandled promise after the summary had already printed. */
const QUEUE = [];
function mustFail(label, because, body) {
  QUEUE.push(async () => {
    let failure = null;
    try { await body(); } catch (error) { failure = error; }
    report(label, because, failure);
  });
}
const mustFailAsync = mustFail;

/* ---- fixtures, identical in shape to the suite's ------------------------- */

const scanFor = (project) => ({
  anchors: (project.characters || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/anchors/${x.approvedFile}` })),
  plates: (project.locations || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/plates/${x.approvedFile}` })),
  props: [], vehicles: [], audio: [],
  media: (project.mediaAssets || []).map((asset) => ({ name: asset.file, url: `/assets/media/${asset.file}` })),
  shots: Object.fromEntries((project.shots || []).map((shot) => [shot.id, { takes: [], locked: [] }])),
});
const run = (context, expression) => JSON.parse(vm.runInContext(`JSON.stringify((() => { ${expression} })())`, context));

function newShotRecord(extra = {}) {
  return {
    id: "SC-01-01", scene: "SC-01", title: "Kai crosses the docking bay",
    desc: "Kai walks through the crowded docking bay.",
    characters: [], positioning: "", route: "GENERATE", codes: [], risks: [], safe: "",
    status: "UNBUILT", workflowStatus: "DRAFT", iterations: 0, notes: "",
    promptOptions: [], promptBuilds: [], winner: null, dur: 0, continuityStateSelections: {},
    keyframes: [{ id: "frame-a-new", label: "A", title: "Opening frame A", winner: null, required: true, generationPackages: [] }],
    clips: [], candidateFiles: [], stageApprovals: {}, generationPackages: [],
    creationBrief: { locationId: "", propIds: [], mode: "auto", action: "Kai crosses the bay.", promptBuilds: [] },
    ...extra,
  };
}
function projectWith(shotRecord) {
  const project = buildFixture();
  project.shots = [shotRecord];
  return project;
}
function requiredFrames(row) {
  return row.units.filter((unit) => unit.kind === "frame" && unit.required);
}

notes.push("Negative controls for Shot Intent at the front:");

/* ===========================================================================
   NC-1 — THE DEFAULT SPEAKS AGAIN.

   The whole defect in one line: read `frame.required` when nothing has been declared.
   `newKeyframe()` writes it `true` on every frame, so this is a default asserting a
   route requirement, and it is what produced "Required frames 0/1" on a shot whose
   route reading was `absent`.
   =========================================================================== */
mustFail("NC-1 undeclared route falls back to the stored required flag", "a new shot requires no frame", () => {
  const broken = compile(mutate(
    `    return STILL_INTENTS.includes(text(record(creation).deliveryIntent)) ? "still-delivery" : "";`,
    `    return "still-delivery";`,
    "NC-1",
  ));
  const project = projectWith(newShotRecord());
  const row = broken.evaluateShotReadiness(project, project.shots[0], {});
  assert.strictEqual(requiredFrames(row).length, 0, "a new shot requires no frame");
});

/* ===========================================================================
   NC-2 — THE FALL-THROUGH THIS SLICE EXISTS TO STOP.

   Remove the "nothing is required and nothing is approved" branch and the rollup reads
   an empty outstanding list as "every declared unit is satisfied", handing a shot that
   has produced nothing to the delivery decision: "the approved result is ready — mark
   this shot final."
   =========================================================================== */
mustFail("NC-2 no undeclared branch — the empty shot is told to mark itself final",
  "must never be offered the delivery decision", () => {
    const broken = compile(mutate(
      `    } else if (!outstanding.length && !units.some((unit) => unit.complete)) {`,
      `    } else if (false) {`,
      "NC-2",
    ));
    const project = projectWith(newShotRecord());
    const row = broken.evaluateShotReadiness(project, project.shots[0], {});
    assert.notStrictEqual(row.nextAction.code, "mark-shot-final",
      "a shot that has produced nothing must never be offered the delivery decision");
  });

/* ===========================================================================
   NC-3 — THE BRANCH FIRES OVER A REAL REQUIREMENT.

   The opposite error: let the undeclared answer outrank a declared one. A shot that HAS
   declared a still delivery owes its opening frame, and being asked to choose a video
   route instead would be the same fabrication pointing the other way.
   =========================================================================== */
mustFail("NC-3 the undeclared branch outranks a declared still delivery", "still delivery keeps its frame", () => {
  const broken = compile(mutate(
    `    } else if (!outstanding.length && !units.some((unit) => unit.complete)) {`,
    `    } else if (!units.some((unit) => unit.complete)) {`,
    "NC-3",
  ));
  const project = projectWith(newShotRecord({
    creationBrief: { locationId: "", propIds: [], mode: "auto", deliveryIntent: "still", promptBuilds: [] },
  }));
  const row = broken.evaluateShotReadiness(project, project.shots[0], {});
  assert.strictEqual(row.nextAction.code, "produce-frame", "a declared still delivery keeps its frame requirement");
});

/* ===========================================================================
   NC-4 — A DECLARED ROUTE LOSES ITS REQUIREMENTS.

   The guarantee in section D, broken from the other side: if the route branch stops
   being consulted, i2v and flf stop owing the endpoints their canonical owner names.
   =========================================================================== */
mustFail("NC-4 the declared route stops governing requirements", "i2v owes exactly one opening frame", () => {
  const broken = compile(mutate(
    `    if (routeNeeds.known) return "route";`,
    `    if (false) return "route";`,
    "NC-4",
  ));
  const project = projectWith(newShotRecord({ deliveryRoute: "i2v" }));
  const row = broken.evaluateShotReadiness(project, project.shots[0], {});
  assert.strictEqual(requiredFrames(row).length, 1, "i2v owes exactly one opening frame");
});

/* ===========================================================================
   NC-5 — REQUIREDNESS INFERRED FROM EVIDENCE.

   The failure mode the whole route contract exists to forbid: reading the shot's own
   media to decide what it owes. An approved opening frame is not a declaration that the
   shot is an i2v shot, and a requirement derived from one is a route nobody chose.
   =========================================================================== */
mustFail("NC-5 requiredness inferred from an approved frame", "requires no frame", () => {
  const broken = compile(mutate(
    `  function declaredFrameRequirement(creation, routeNeeds) {`,
    `  function declaredFrameRequirement(creation, routeNeeds, shot) {\n`
    + `    if (list(record(shot).keyframes).some((frame) => record(frame).winner)) return "still-delivery";`,
    "NC-5",
  ));
  const withFrame = compile(mutateIn(
    mutate(
      `  function declaredFrameRequirement(creation, routeNeeds) {`,
      `  function declaredFrameRequirement(creation, routeNeeds, shot) {\n`
      + `    if (list(record(shot).keyframes).some((frame) => record(frame).winner)) return "still-delivery";`,
      "NC-5",
    ),
    `    const frameBasis = declaredFrameRequirement(creation, routeNeeds);`,
    `    const frameBasis = declaredFrameRequirement(creation, routeNeeds, s);`,
    "NC-5 call site",
  ));
  assert(broken && withFrame, "NC-5: both halves of the mutation must compile");
  const project = projectWith(newShotRecord({
    keyframes: [{ id: "frame-a-new", label: "A", winner: "HISTORIC-A.png", required: true, generationPackages: [] }],
  }));
  const row = withFrame.evaluateShotReadiness(project, project.shots[0], {});
  assert.strictEqual(requiredFrames(row).length, 0,
    "a shot with an approved frame and no declaration still requires no frame");
});

/* ===========================================================================
   NC-6 — THE COMMAND SUMMARY COUNTS THE STORED FLAG AGAIN.

   The fact record's undeclared fallback, reverted to the pre-slice reading. The number
   the filmmaker sees comes from here, so a truthful readiness derivation behind an
   untruthful fact record still prints "Required frames 0/1".
   =========================================================================== */
mustFailAsync("NC-6 requiredFrameCount falls back to the stored flag", "the command summary counts no required frame", async () => {
  const project = projectWith(newShotRecord());
  const page = await render("#/shot/SC-01-01", project, {
    scan: scanFor(project),
    mutateSource: pageMutation("creation-studio.js",
      `    requiredFrameCount: routeNeeds.known ? routeRequiredFrameCount\n`
      + `      : readiness ? requiredFrameUnits.length\n`
      + `        : progress.frames.filter((frame) => frame.required !== false).length,`,
      `    requiredFrameCount: routeNeeds.known ? routeRequiredFrameCount : progress.frames.filter((frame) => frame.required !== false).length,`,
      "NC-6"),
  });
  const summary = (String(page.map.get("main").innerHTML || "").match(/<section class="shot-command-summary"[^]*?<\/section>/) || [""])[0];
  assert(/<b>0\/0<\/b>/.test(summary), "the command summary counts no required frame");
});

/* ===========================================================================
   NC-7 — THE SUMMARY CALLS SILENCE AN INTENT.

   "not required by this intent" is the right sentence for a declared t2v shot and a
   claim about a decision nobody made on an undeclared one.
   =========================================================================== */
mustFailAsync("NC-7 the undeclared summary claims an intent", "must not call an undeclared shot's silence an intent", async () => {
  const project = projectWith(newShotRecord());
  const page = await render("#/shot/SC-01-01", project, {
    scan: scanFor(project),
    mutateSource: pageMutation("creation-studio.js",
      `    : routeDeclared ? "not required by this intent" : "none until you say how this shot is made";`,
      `    : "not required by this intent";`,
      "NC-7"),
  });
  const summary = (String(page.map.get("main").innerHTML || "").match(/<section class="shot-command-summary"[^]*?<\/section>/) || [""])[0];
  assert(!/not required by this intent/.test(summary), "must not call an undeclared shot's silence an intent");
});

/* ===========================================================================
   NC-8 — THE ADD BUTTON ASKS THE QUESTION IT HAS ALREADY ANSWERED.
   =========================================================================== */
mustFailAsync("NC-8 the Shots page Add reopens the generic chooser", "must not show the generic entity chooser", async () => {
  const project = projectWith(newShotRecord());
  const page = await render("#/shots/board", project, {
    scan: scanFor(project),
    mutateSource: pageMutation("app.js",
      `  if (!GLOBAL_ADD_CHOICES.some(([choice]) => choice === target)) return openGlobalAdd(target);\n  return runGlobalAdd(target);`,
      `  return openGlobalAdd(target);`,
      "NC-8"),
  });
  const chooser = run(page.context, `
    openContextualAdd("shot");
    return { chooser: String(document.getElementById("modal").innerHTML || "").includes("What are you adding?") };`);
  assert.strictEqual(chooser.chooser, false, "the contextual Add must not show the generic entity chooser");
});

/* ===========================================================================
   NC-9 — THE GENERIC CHOOSER IS COLLATERAL DAMAGE.

   The opposite error, and the one a careless fix makes: sending every Add straight to
   a record type, so the shell's own Add can no longer ask.
   =========================================================================== */
mustFailAsync("NC-9 the global Add loses the chooser", "must still show the generic chooser", async () => {
  const project = projectWith(newShotRecord());
  const page = await render("#/shots/board", project, {
    scan: scanFor(project),
    mutateSource: pageMutation("app.js",
      `window.openGlobalAdd = (preferred = "") => {\n  const choices = GLOBAL_ADD_CHOICES;`,
      `window.openGlobalAdd = (preferred = "") => {\n  if (preferred) return runGlobalAdd(preferred);\n  return runGlobalAdd("shot");\n  /* unreachable */ const choices = GLOBAL_ADD_CHOICES;`,
      "NC-9"),
  });
  const generic = run(page.context, `
    openGlobalAdd();
    return { chooser: String(document.getElementById("modal").innerHTML || "").includes("What are you adding?") };`);
  assert.strictEqual(generic.chooser, true, "the global Add must still show the generic chooser");
});

/* ===========================================================================
   NC-10 — NEW SHOT ASSUMES A STILL AGAIN.
   =========================================================================== */
mustFailAsync("NC-10 New Shot asks what the still must show", "must ask what happens, not what a still shows", async () => {
  const project = projectWith(newShotRecord());
  const page = await render("#/shots/board", project, {
    scan: scanFor(project),
    mutateSource: pageMutation("mutations.js",
      `{ k: "desc", label: "What happens in this shot?", type: "textarea"`,
      `{ k: "desc", label: "What must the still show?", type: "textarea"`,
      "NC-10"),
  });
  const label = run(page.context, `
    openContextualAdd("shot");
    const html = String(document.getElementById("modal").innerHTML || "");
    return { label: (html.match(/<label for="ff-desc">([^<]*)<\\/label>/) || [, ""])[1] };`);
  assert.strictEqual(label.label, "What happens in this shot?", "must ask what happens, not what a still shows");
});

/* ===========================================================================
   NC-11 — A ROUTE IS PRESELECTED FOR THE FILMMAKER.

   Choosing one to make readiness easier is exactly the move the brief forbids: it is a
   generated default wearing a filmmaker's decision.
   =========================================================================== */
mustFailAsync("NC-11 New Shot preselects a route", "a route chosen for the filmmaker is not a decision", async () => {
  const project = projectWith(newShotRecord());
  const page = await render("#/shots/board", project, {
    scan: scanFor(project),
    mutateSource: pageMutation("mutations.js",
      `      options: routeRows,\n      value: "",`,
      `      options: routeRows,\n      value: "i2v",`,
      "NC-11"),
  });
  const selected = run(page.context, `
    openContextualAdd("shot");
    const html = String(document.getElementById("modal").innerHTML || "");
    const block = (html.match(/<select id="ff-deliveryRoute">([^]*?)<\\/select>/) || [, ""])[1];
    return [...block.matchAll(/<option value="([^"]*)"\\s*([^>]*)>/g)].filter((row) => /\\bselected\\b/.test(row[2])).map((row) => row[1]);`);
  assert.deepStrictEqual(selected, [""],
    "nothing but 'not decided' may be preselected — a route chosen for the filmmaker is not a decision");
});

/* ===========================================================================
   NC-12 — CREATING A SHOT WRITES AN EMPTY ROUTE SLOT.

   "" and a missing key are the same production fact and different records: a stored
   empty slot is something a later reader can mistake for a decision, which is why
   Slice 5a's writer deletes rather than stores one.
   =========================================================================== */
mustFailAsync("NC-12 an undecided shot stores an empty route", "carries NO deliveryRoute key", async () => {
  const project = projectWith(newShotRecord());
  const page = await render("#/shots/board", project, {
    scan: scanFor(project),
    mutateSource: pageMutation("mutations.js",
      `    if (v.deliveryRoute && typeof setShotIntent === "function") setShotIntent(id, v.deliveryRoute);`,
      `    P.shots[P.shots.length - 1].deliveryRoute = v.deliveryRoute || "";`,
      "NC-12"),
  });
  const made = run(page.context, `
    openContextualAdd("shot");
    document.getElementById("ff-scene").value = "SC-01";
    document.getElementById("ff-title").value = "Undecided";
    document.getElementById("ff-desc").value = "Kai crosses the bay.";
    document.getElementById("ff-positioning").value = "";
    document.getElementById("ff-location").value = "";
    document.getElementById("ff-deliveryRoute").value = "";
    _formSubmit();
    const shot = P.shots[P.shots.length - 1];
    return { hasKey: Object.prototype.hasOwnProperty.call(shot, "deliveryRoute") };`);
  assert.strictEqual(made.hasKey, false, "an undecided shot carries NO deliveryRoute key at all");
});

/* ===========================================================================
   NC-13 — THE ROUTE CONTROL SHIPS FOLDED ON AN UNDECLARED SHOT.

   The question the shot is actually being asked, collapsed behind a summary line.
   =========================================================================== */
mustFailAsync("NC-13 the undeclared intent control ships collapsed", "must be open while nothing has been declared", async () => {
  const project = projectWith(newShotRecord());
  const page = await render("#/shot/SC-01-01", project, {
    scan: scanFor(project),
    mutateSource: pageMutation("creation-studio.js",
      `${"${workspaceSectionOpen(sectionKey, !declared) ? \"open\" : \"\"}"}`,
      `${"${workspaceSectionOpen(sectionKey, false) ? \"open\" : \"\"}"}`,
      "NC-13"),
  });
  const panel = (String(page.map.get("main").innerHTML || "").match(/<details class="shot-intent-control"[^>]*>/) || [""])[0];
  assert(/\sopen[\s>]/.test(panel), "the Shot Intent control must be open while nothing has been declared");
});

/* ===========================================================================
   NC-14 — THE CONDITIONAL DEFAULT IS SILENTLY DEFEATED.

   `<details ontoggle>` writes the remembered value on every open and close, so sharing
   one key between the declared and undeclared states means a shot visited once while
   declared carries a stored `0` that defeats the undeclared default the moment its
   route is withdrawn. The control renders open on a fresh shot either way, so the
   guarantee this watches is the KEY, not the attribute.
   =========================================================================== */
mustFailAsync("NC-14 one remembered-state key for both intent states", "remembers under its own key", async () => {
  const project = projectWith(newShotRecord());
  const page = await render("#/shot/SC-01-01", project, {
    scan: scanFor(project),
    mutateSource: pageMutation("creation-studio.js",
      "  const sectionKey = declared ? `${s.id}:shot-intent` : `${s.id}:shot-intent:undeclared`;",
      "  const sectionKey = `${s.id}:shot-intent`;",
      "NC-14"),
  });
  assert(/rememberWorkspaceSection\('SC-01-01:shot-intent:undeclared'/.test(String(page.map.get("main").innerHTML || "")),
    "the undeclared control remembers under its own key");
});

/* ===========================================================================
   NC-15 — THE STORED PREFERENCE ACTUALLY BITES.

   The other half of NC-14, and the reason the scoped key is not decoration: with the
   shared key, a stored `0` from a visit made while the route was declared arrives on
   the undeclared shot and folds the control away. Proved by supplying that exact
   storage value to a page whose keys have been un-scoped.
   =========================================================================== */
mustFailAsync("NC-15 a stored declared-state preference folds the undeclared control",
  "must be open while nothing has been declared", async () => {
    const project = projectWith(newShotRecord());
    const page = await render("#/shot/SC-01-01", project, {
      scan: scanFor(project),
      storage: { "cinebraid-section:fixture:SC-01-01:shot-intent": "0" },
      mutateSource: pageMutation("creation-studio.js",
        "  const sectionKey = declared ? `${s.id}:shot-intent` : `${s.id}:shot-intent:undeclared`;",
        "  const sectionKey = `${s.id}:shot-intent`;",
        "NC-15"),
    });
    const panel = (String(page.map.get("main").innerHTML || "").match(/<details class="shot-intent-control"[^>]*>/) || [""])[0];
    assert(/\sopen[\s>]/.test(panel), "the Shot Intent control must be open while nothing has been declared");
  });

/* ===========================================================================
   NC-16 — THE UNDECLARED STATEMENT IS REMOVED.
   =========================================================================== */
mustFailAsync("NC-16 the undeclared shot never says the route was not chosen", "Execution route not chosen", async () => {
  const project = projectWith(newShotRecord());
  const page = await render("#/shot/SC-01-01", project, {
    scan: scanFor(project),
    mutateSource: pageMutation("creation-studio.js",
      `  const undeclaredStatement = declared\n    ? ""`,
      `  const undeclaredStatement = true\n    ? ""`,
      "NC-16"),
  });
  assert(/Execution route not chosen/.test(String(page.map.get("main").innerHTML || "")),
    "an undeclared shot must say Execution route not chosen");
});

/* ===========================================================================
   NC-17 — THE INPUTS PANEL FOLDS ON THE SHOT THAT HAS NOTHING.

   The pre-slice condition: open the attachment controls only for a shot that already
   HAS attachments, which folds them away on the one shot that needs them.
   =========================================================================== */
mustFailAsync("NC-17 inputs fold on a shot with nothing attached", "source & references panel is open", async () => {
  const project = projectWith(newShotRecord());
  const page = await render("#/shot/SC-01-01", project, {
    scan: scanFor(project),
    mutateSource: pageMutation("creation-studio.js",
      `  const openInputs = !progress.firstApproved;`,
      `  const openInputs = !progress.firstApproved && (shotMediaLinks(s).length || shotCreationReferences(s).length);`,
      "NC-17"),
  });
  const panel = (String(page.map.get("main").innerHTML || "").match(/<details class="guided-work-panel guided-inputs-card"[^>]*>/) || [""])[0];
  assert(/\sopen[\s>]/.test(panel), "its source & references panel is open, not folded away");
});

/* ===========================================================================
   NC-18 — THE NEW ACTION HAS NO DECLARED DESTINATION.

   A readiness action with no entry in the declared destination table renders as a
   button that refuses when pressed. The words and the code are not enough on their own.
   =========================================================================== */
mustFail("NC-18 declare-shot-route has no declared destination", "must have a declared destination", () => {
  const source = readLF(path.join(PUBLIC, "shared-stage-model.js"));
  const mutated = mutateIn(source,
    `        { code: "declare-shot-route", surface: "shot-inputs", renderer: "shotIntentControl", control: "setShotIntent", focus: ".shot-intent-control select" },\n`,
    "",
    "NC-18");
  const compiled = new Module(path.join(PUBLIC, "shared-stage-model.js"), null);
  compiled.filename = path.join(PUBLIC, "shared-stage-model.js");
  compiled.paths = Module._nodeModulePaths(PUBLIC);
  compiled._compile(mutated, compiled.filename);
  const destination = compiled.exports.shotReadinessDestinationForAction("declare-shot-route");
  assert(destination && destination.stageId === "inputs" && destination.control === "setShotIntent",
    "the new action must have a declared destination that lands on the one route writer");
});

/* ===========================================================================
   NC-19 — THE ACTION IS NOT A DECLARED MEMBER OF THE VOCABULARY.
   =========================================================================== */
mustFail("NC-19 declare-shot-route is emitted without being declared", "declared member of the readiness vocabulary", () => {
  const broken = compile(mutate(
    `    "declare-shot-route",\n    "supply-approved-media",`,
    `    "supply-approved-media",`,
    "NC-19",
  ));
  assert(broken.READINESS_NEXT_ACTIONS.includes("declare-shot-route"),
    "the new action must be a declared member of the readiness vocabulary");
});

/* ===========================================================================
   NC-20 — A ROUTE CHANGE DELETES THE WORK THE OLD ROUTE NEEDED.

   The destructive reading of "old frames stop being current requirements": deleting
   them. Requirements move; media never does.
   =========================================================================== */
mustFail("NC-20 changing a route removes the frames the old one required", "no frame, candidate or approval receipt may move", () => {
  const project = projectWith(newShotRecord({
    deliveryRoute: "flf",
    keyframes: [
      { id: "frame-a-new", label: "A", winner: "HISTORIC-A.png", required: true, generationPackages: [] },
      { id: "frame-b-new", label: "B", winner: "HISTORIC-B.png", required: true, generationPackages: [] },
    ],
  }));
  const shot = project.shots[0];
  GESTURE.gesture(() => Kernel.approveFrameCanon(project, { shotId: shot.id, frameId: "frame-a-new", value: "HISTORIC-A.png", assetId: "", at: AT, via: "nc-20" }));
  const before = shot.keyframes.map((frame) => `${frame.id}:${frame.winner || ""}`);
  /* The defect, performed by hand: a route change that also prunes what the new route
     does not need. No shipped code does this — the control exists so the assertion
     that nothing moves is watched failing at least once. */
  const Route = require(path.join(PUBLIC, "shared-shot-route.js"));
  Route.declareShotRoute(shot, "r2v");
  shot.keyframes = shot.keyframes.filter((frame) => frame.id === "frame-a-new");
  assert.deepStrictEqual(shot.keyframes.map((frame) => `${frame.id}:${frame.winner || ""}`), before,
    "no frame, candidate or approval receipt may move when a route does");
});

/* ===========================================================================
   NC-21 — A DECLARED MOTION UNIT STOPS ASKING FOR ITS OWN INPUT.

   `clip.kind` is a declaration, and an i2v unit needs an opening frame whether or not
   the SHOT has declared a route. Neuter that read and a legacy shot mid-production
   stops owing the frame its own motion unit was built from, and the frameless
   fallback reports the whole shot ready to animate from nothing.
   =========================================================================== */
mustFail("NC-21 a declared clip kind stops requiring its frames", "the i2v unit's own declared kind requires the opening frame", () => {
  const broken = compile(mutate(
    `    const clipRoles = frameBasis ? new Set() : declaredClipFrameRoles(s);`,
    `    const clipRoles = new Set();`,
    "NC-21",
  ));
  const project = projectWith(newShotRecord({
    clips: [{ id: "seg-a", suffix: "a", label: "A", kind: "i2v", dur: 5, motionPrompt: "x" }],
  }));
  const row = broken.evaluateShotReadiness(project, project.shots[0], {});
  assert.strictEqual(requiredFrames(row).length, 1,
    "the i2v unit's own declared kind requires the opening frame");
});

/* ===========================================================================
   NC-22 — A DECISION ON AN OPTIONAL UNIT GOES QUIET.

   The cost of making frames optional, if `outstanding` had been left meaning "required
   and unfinished": a malformed presence declaration — a corrupted record only a person
   can repair — sits on a unit nothing currently requires, and the shot reports itself
   ready to animate instead of saying the record cannot be read.
   =========================================================================== */
mustFail("NC-22 an optional unit's decision is dropped from the rollup", "a decision must keep the card", () => {
  const broken = compile(mutate(
    `    const outstanding = units.filter((unit) => !unit.complete && (unit.required || unit.status === "NEEDS_DECISION"));`,
    `    const outstanding = units.filter((unit) => !unit.complete && unit.required);`,
    "NC-22",
  ));
  const project = projectWith(newShotRecord({
    /* A motion unit keeps the shot outstanding, so the only thing that can surface the
       frame's decision is the rule under test. `post` names no animate method, so the
       frame itself is not required. */
    clips: [{ id: "seg-post", suffix: "a", label: "A", kind: "post", dur: 5, motionPrompt: "x" }],
    creationBrief: { locationId: "", propIds: [], mode: "auto", deliveryIntent: "motion", promptBuilds: [],
      frameWorkflows: { "frame-a-new": { entityPresence: { KAI: { state: "absent" } } } } },
  }));
  const row = broken.evaluateShotReadiness(project, project.shots[0], {});
  assert.strictEqual(row.nextAction.code, "repair-presence-declaration",
    "a decision must keep the card even on a unit nothing requires");
});
/* ===========================================================================
   NC-23 — THE FABRICATION MOVES TO A QUIETER SCREEN.

   projectHealthIssues() feeds the Reports project log and the batch health check,
   and it counted `frame.required` directly. Put that back and a shot the workspace
   correctly says owes nothing is still reported as owing a required frame — the same
   claim, on a screen nobody was looking at when it was made.
   =========================================================================== */
mustFailAsync("NC-23 the project log counts the stored required flag", "owes no frame anywhere", async () => {
  const project = projectWith(newShotRecord());
  const page = await render("#/shot/SC-01-01", project, {
    scan: scanFor(project),
    mutateSource: pageMutation("app.js",
      "  const frames = currentlyRequiredFrames(s, readiness),",
      "  const frames = requiredFrames(s),",
      "NC-23"),
  });
  const reported = run(page.context, `
    return projectHealthIssues().filter((row) => row.type === "Frames").map((row) => row.msg);`);
  assert.deepStrictEqual(reported, [],
    "an undeclared shot owes no frame anywhere, including the project log");
});

/* ===========================================================================
   NC-24 — THE SHOT'S DECLARED INPUTS GO QUIET WITH ITS FRAME.

   The other cost of making frames optional. Readiness hangs an entity-state
   requirement on every unit; gate those rows on `unit.required` and casting a
   character onto an undecided shot raises no obligation at all, so the reference
   surface reports the approval the production needs as coverage plan.
   =========================================================================== */
mustFailAsync("NC-24 an optional unit's declared inputs are dropped", "still a current obligation", async () => {
  const project = projectWith(newShotRecord({ characters: ["KAI"], codes: ["LOC-HULL"] }));
  const page = await render("#/shot/SC-01-01", project, {
    scan: scanFor(project),
    mutateSource: pageMutation("app.js",
      "    ...units.filter((unit) => !unit.complete && !unit.required)\n"
      + "      .flatMap((unit) => (unit.requirements || []).filter((row) => SHOT_INPUT_REQUIREMENT_KINDS.includes(row?.kind))),",
      "",
      "NC-24"),
  });
  const owed = run(page.context, `
    const s = P.shots.find((row) => row.id === "SC-01-01");
    return outstandingReadinessRows(shotReadinessFor(s)).filter((row) => row.kind === "entity-state").length;`);
  assert(owed > 0, "the cast the shot declares is still a current obligation");
});

/* ---------------------------------------------------------------------------
   THE ROUTE-FRESHNESS CONTROLS.

   Each breaks ONE half of the route dependency and proves packageStaleReasons()
   then misses a real route change — or invents one it should not. The detector is
   the shipped one in every case; no control builds a parallel comparator.
   --------------------------------------------------------------------------- */
function freshnessProject(route) {
  const shot = newShotRecord({
    keyframes: [
      { id: "frame-a-new", label: "A", title: "Opening frame A", winner: "HISTORIC-A.png", required: true, generationPackages: [] },
      { id: "frame-b-new", label: "B", title: "Closing frame B", winner: "HISTORIC-B.png", required: true, generationPackages: [] },
    ],
    clips: [{ id: "seg-a", suffix: "a", label: "A", title: "Primary motion", dur: 5, kind: "i2v", note: "",
              motionPrompt: "The ship lifts away.", fromFrame: "frame-a-new", toFrame: "frame-b-new", generationPackages: [] }],
  });
  if (route) shot.deliveryRoute = route;
  return projectWith(shot);
}
const FRESHNESS_WALK = [
  'const s = P.shots.find((row) => row.id === "SC-01-01");',
  "const unit = s.clips[0];",
  'const motionPack = { id: "pack-motion", segmentId: unit.id, revision: 1, scope: "motion", kind: "motion", profileId: "minimax-h3/i2v", mode: "i2v", dependencySnapshot: null };',
  'const framePack = { id: "pack-frame", frameId: "frame-a-new", revision: 1, scope: "frame", kind: "frame", profileId: "gpt-image-2/t2i", mode: "t2i", dependencySnapshot: null };',
  "unit.generationPackages = [motionPack];",
  "s.keyframes[0].generationPackages = [framePack];",
  "motionPack.dependencySnapshot = JSON.parse(JSON.stringify(currentSnapshotForPackage(s, motionPack)));",
  "framePack.dependencySnapshot = JSON.parse(JSON.stringify(currentSnapshotForPackage(s, framePack)));",
  'declareShotRoute(s, "r2v");',
  "return { motion: packageStaleReasons(s, motionPack), frame: packageStaleReasons(s, framePack) };",
].join("\n");

/* ===========================================================================
   NC-25 — THE PACKAGE STOPS RECORDING THE ROUTE IT WAS BUILT AGAINST.

   The exact defect the correction exists to remove: with no route in the evidence,
   the comparator has nothing to compare and a real i2v -> r2v change reports clean.
   =========================================================================== */
mustFailAsync("NC-25 the package records no route", "must report the route change", async () => {
  const project = freshnessProject("i2v");
  const page = await render("#/shot/SC-01-01", project, {
    scan: scanFor(project),
    mutateSource: pageMutation("shared-build-history.js",
      "      deliveryRoute: shotRouteOwner()(shot?.deliveryRoute),",
      "",
      "NC-25"),
  });
  const seen = run(page.context, FRESHNESS_WALK);
  assert(seen.motion.some((reason) => /delivery route changed/.test(reason)),
    "the freshness owner must report the route change");
});

/* ===========================================================================
   NC-26 — THE COMPARATOR STOPS COMPARING IT.

   The other half: the evidence is recorded and nothing reads it.
   =========================================================================== */
mustFailAsync("NC-26 the comparator ignores the recorded route", "must report the route change", async () => {
  const project = freshnessProject("i2v");
  const page = await render("#/shot/SC-01-01", project, {
    scan: scanFor(project),
    mutateSource: pageMutation("shared-build-history.js",
      '    if (comparable(saved, at, "deliveryRoute") && String(saved.deliveryRoute || "") !== String(at.deliveryRoute || ""))',
      "    if (false)",
      "NC-26"),
  });
  const seen = run(page.context, FRESHNESS_WALK);
  assert(seen.motion.some((reason) => /delivery route changed/.test(reason)),
    "the freshness owner must report the route change");
});

/* ===========================================================================
   NC-27 — EVERY PACKAGE BECOMES ROUTE-SENSITIVE.

   The blanket revision bump the brief forbids. `pack.segmentId` is what makes the
   route motion-only evidence; remove that discriminator and a frame package — whose
   compiled t2i prompt does not branch on the route at all — goes stale too.
   =========================================================================== */
mustFailAsync("NC-27 a frame package is staled by a route change", "never be staled by a route change", async () => {
  const project = freshnessProject("i2v");
  const page = await render("#/shot/SC-01-01", project, {
    scan: scanFor(project),
    mutateSource: pageMutation("shared-build-history.js",
      "  function packageMotionInputs(shot, pack) {\n    if (!pack?.segmentId) return null;",
      "  function packageMotionInputs(shot, pack) {\n    if (false) return null;",
      "NC-27"),
  });
  const seen = run(page.context, FRESHNESS_WALK);
  assert.deepStrictEqual(seen.frame, [],
    "a frame package must never be staled by a route change");
});

/* ===========================================================================
   NC-28 — THE LEGACY SKIP IS REMOVED.

   Drop the both-sides rule for this one key and every package compiled before the
   route was evidence reads stale on sight, from evidence nobody has — the migration
   pressure the correction was written to avoid.
   =========================================================================== */
mustFail("NC-28 a legacy package is staled for a route it never recorded", "never staled for one", () => {
  const source = readLF(path.join(PUBLIC, "shared-build-history.js"));
  const mutated = mutateIn(source,
    '    if (comparable(saved, at, "deliveryRoute") && String(saved.deliveryRoute || "") !== String(at.deliveryRoute || ""))',
    '    if (String(saved.deliveryRoute || "") !== String(at.deliveryRoute || ""))',
    "NC-28");
  const compiled = new Module(path.join(PUBLIC, "shared-build-history.js"), null);
  compiled.filename = path.join(PUBLIC, "shared-build-history.js");
  compiled.paths = Module._nodeModulePaths(PUBLIC);
  compiled._compile(mutated, compiled.filename);
  const shot = { id: "SH-LEGACY", deliveryRoute: "r2v", creationBrief: { motionDuration: 5, motionProfileId: "minimax-h3/i2v" },
    keyframes: [{ id: "frame-a", winner: "A.png" }, { id: "frame-b", winner: "B.png" }],
    clips: [{ id: "seg-a", suffix: "a", kind: "i2v", dur: 5, motionPrompt: "x", fromFrame: "frame-a", toFrame: "frame-b" }] };
  const pack = { id: "p", segmentId: "seg-a", profileId: "minimax-h3/i2v", mode: "i2v" };
  const legacy = { ...pack, dependencySnapshot: {
    ...compiled.exports.packageProjectInputs({ mediaAssets: [] }, shot, pack, compiled.exports.packageDirection(shot, pack)),
    durationSeconds: 5, profileId: "minimax-h3/i2v" } };
  const answer = compiled.exports.packageProjectFreshness({ mediaAssets: [] }, shot, legacy);
  assert(!answer.reasons.some((reason) => /delivery route/.test(reason)),
    "a package that recorded no route is never staled for one");
});

async function main() {
  for (const control of QUEUE) await control();
  console.log("Shot intent at the front negative controls passed:");
  for (const line of notes) console.log(line);
  console.log(`  ${QUEUE.length} controls, each proved to fail without its guarantee.`);
  console.log("  Paid calls: 0. Provider calls: 0. Off-site requests: 0.");
}
main().catch((error) => { console.error(error); process.exit(1); });

/* Dogfood remediation — SHOT INTENT AT THE FRONT.
 *
 * THE DEFECT, in the words of the product it was observed in. A shot created from the
 * Shots page asked "What must the still show?", then opened saying
 *
 *     References 0 · Shot Intent Not decided · Required frames 0/1
 *     Produce the frame — "Produce Frame A using t2i."
 *
 * while its own route reading was `absent`. Nobody had said how the shot was made, and
 * the product was already telling the filmmaker which artefact to buy. `frame.required`
 * is written `true` by public/app.js's newKeyframe() on every frame of every project and
 * back-filled by normalizeShotV5() onto any frame that lacks it; NO filmmaker-facing
 * control writes it. So the requirement it produced was a DEFAULT MAKING A STATEMENT —
 * the exact thing the accepted compiler-integrity slice exists to forbid.
 *
 * WHAT THIS SUITE HOLDS, in the order the brief lists it:
 *
 *   A  the Add control on a surface that already names the record goes straight there,
 *      and the generic chooser is still reachable and unchanged
 *   B  New Shot asks what HAPPENS, and offers the execution route as genuinely optional
 *   C  an undeclared route fabricates no frame requirement, no frame CTA, and no
 *      "mark this final" fall-through — for a new shot AND for a legacy one
 *   D  every declared route keeps exactly the requirements its canonical owner states
 *   E  declaring, changing and withdrawing a route moves requirements and never media
 *   F  the freshness owner is asked rather than restated, and the accepted intent gate
 *      is what refuses a package the new route cannot run
 *   G  nothing infers a route — not a frame, a candidate, a clip, a package or a render
 *   H  inputs and the route choice are in front of the filmmaker before any production
 *      CTA, and Look/Blocking stay optional
 *
 * NO PROVIDER, NO PAID ROUTE, NO NETWORK, NO PROJECT DATA. Every fixture is built in
 * memory and the repository's own projects/ directory is never opened.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
/* core.autocrlf=true here, so an anchor written with \n matches nothing unless the
   source is normalised on read. */
const readLF = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");

const Route = require("../public/shared-shot-route.js");
const Intent = require("../public/shared-shot-intent.js");
const Readiness = require("../public/shared-shot-readiness.js");
const Stage = require("../public/shared-stage-model.js");
const Kernel = require("../public/shared-authority-kernel.js");
const { render, buildFixture } = require("./render-harness.js");
const { installTestManualActionSource } = require("./authority-test-gesture.js");

const GESTURE = installTestManualActionSource(Kernel);
const AT = "2026-08-28T09:00:00.000Z";
const notes = [];
const note = (line) => notes.push(line);

const ROUTES = ["t2v", "i2v", "flf", "r2v", "hybrid"];
/* The two frame roles a route can name. Read off the canonical answer rather than
   written down as a set this suite believes in. */
const FRAME_ROLES = ["first-frame", "last-frame"];
const frameNeedsOf = (route) => Readiness.shotRouteInputNeeds(route).needs.filter((role) => FRAME_ROLES.includes(role));

const scanFor = (project) => ({
  anchors: (project.characters || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/anchors/${x.approvedFile}` })),
  plates: (project.locations || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/plates/${x.approvedFile}` })),
  props: [], vehicles: [], audio: [],
  media: (project.mediaAssets || []).map((asset) => ({ name: asset.file, url: `/assets/media/${asset.file}` })),
  shots: Object.fromEntries((project.shots || []).map((shot) => [shot.id, { takes: [], locked: [] }])),
});

const run = (context, expression) => JSON.parse(vm.runInContext(`JSON.stringify((() => { ${expression} })())`, context));

/* ===========================================================================
   FIXTURES.

   `newShotRecord` is the record public/mutations.js addShot() actually pushes — the
   same keys, the same creationBrief, the same single keyframe carrying the default
   `required: true`. If addShot changes shape, section B's end-to-end creation notices;
   this literal exists so the rest of the suite can reason about a fresh shot without
   opening a modal for every case.
   =========================================================================== */
function newShotRecord(id, sceneId, extra = {}) {
  return {
    id,
    scene: sceneId,
    title: "Kai crosses the docking bay",
    desc: "Kai walks through the crowded docking bay while Mara's ship lifts away behind him.",
    characters: [],
    positioning: "",
    route: "GENERATE",
    codes: [],
    risks: [],
    safe: "",
    status: "UNBUILT",
    workflowStatus: "DRAFT",
    iterations: 0,
    notes: "",
    promptOptions: [],
    promptBuilds: [],
    winner: null,
    dur: 0,
    continuityStateSelections: {},
    keyframes: [{ id: "frame-a-new", label: "A", title: "Opening frame A", winner: null, description: "", notes: "", required: true, generationPackages: [] }],
    clips: [],
    candidateFiles: [],
    stageApprovals: {},
    generationPackages: [],
    creationBrief: { locationId: "", propIds: [], mode: "auto", action: "Kai walks through the docking bay.", staging: "", camera: "", notes: "", profileId: "", promptBuilds: [] },
    ...extra,
  };
}

/* A LEGACY SHOT: two frames, one of them approved, a returned candidate, a motion unit
   with a compiled package, and no declared route — the shape a project made before the
   route field existed actually has. */
function legacyShotRecord(id, sceneId, extra = {}) {
  return {
    id,
    scene: sceneId,
    title: "Legacy dock shot",
    desc: "The courier sets the parcel down and steps back.",
    characters: [],
    positioning: "",
    route: "GENERATE",
    codes: [],
    risks: [],
    safe: "",
    status: "BUILT",
    workflowStatus: "IN PROGRESS",
    iterations: 2,
    notes: "",
    promptOptions: [],
    promptBuilds: [],
    winner: "LEGACY-A.png",
    dur: 5,
    continuityStateSelections: {},
    keyframes: [
      { id: "frame-a-legacy", label: "A", title: "Opening frame A", winner: "LEGACY-A.png", description: "", notes: "", required: true, generationPackages: [] },
      { id: "frame-b-legacy", label: "B", title: "Key frame B", winner: null, description: "", notes: "", required: true, generationPackages: [] },
    ],
    clips: [{ id: "seg-legacy", suffix: "a", label: "A", title: "Primary motion", dur: 5, kind: "i2v", note: "", motionPrompt: "The courier steps back.", fromFrame: "frame-a-legacy", toFrame: "", generationPackages: [], motionPlan: null }],
    candidateFiles: [{ stored: "LEGACY-A.png", original: "LEGACY-A.png", decision: "approved", mediaType: "image", frameId: "frame-a-legacy" }],
    stageApprovals: {},
    generationPackages: [],
    creationBrief: { locationId: "", propIds: [], mode: "auto", deliveryIntent: "motion", action: "The courier sets the parcel down.", staging: "", camera: "", notes: "", profileId: "", promptBuilds: [] },
    ...extra,
  };
}

function projectWith(shotRecord) {
  const project = buildFixture();
  project.shots = [shotRecord];
  return project;
}
function approveFrame(project, shotId, frameId, value) {
  return GESTURE.gesture(() => Kernel.approveFrameCanon(project, { shotId, frameId, value, assetId: "", at: AT, via: "shot-intent-front" }));
}
function readinessOf(project, shotId, oracle = {}) {
  return Readiness.evaluateShotReadiness(project, project.shots.find((row) => row.id === shotId), oracle);
}
function requiredFrameUnits(row) {
  return row.units.filter((unit) => unit.kind === "frame" && unit.required);
}
/* Every action this shot can PRESENT: its own, plus every REQUIRED unit's.
 *
 * An optional unit keeps its own next action and that is not debt — it is the answer to
 * "if I chose to make this, what would I do", and no surface promotes it: the rollup
 * reads `outstanding[0]` (required units only) and `optionalOutstanding` carries ids and
 * no sentence. What must never happen is a frame becoming REQUIRED with no declaration
 * behind it, which is what this projection watches. */
function presentedActionCodes(row) {
  return [row.nextAction?.code || "", ...row.units.filter((unit) => unit.required).map((unit) => unit.nextAction?.code || "")].filter(Boolean);
}

/* ===========================================================================
   A — CONTEXTUAL ADD.
   =========================================================================== */
async function checkContextualAdd() {
  const project = projectWith(newShotRecord("SC-01-01", "SC-01"));
  const board = await render("#/shots/board", project, { scan: scanFor(project) });

  /* The rendered Shots page is what a filmmaker clicks, so the handler is read out of
     its markup rather than out of the source file. */
  const boardHtml = String(board.map.get("main").innerHTML || "");
  assert(/onclick="openContextualAdd\('shot'\)"/.test(boardHtml),
    "the Shots page Add control must go straight to the New Shot flow");
  assert(!/onclick="openGlobalAdd\('shot'\)"/.test(boardHtml),
    "and must not re-ask which record the filmmaker meant");

  /* A1 — the contextual entry opens New Shot, and the chooser's question is absent. */
  const contextual = run(board.context, `
    openContextualAdd("shot");
    const html = String(document.getElementById("modal").innerHTML || "");
    return { html, chooser: html.includes("What are you adding?"), form: html.includes("New shot") };`);
  assert.strictEqual(contextual.chooser, false, "A1: the contextual Add must not show the generic entity chooser");
  assert.strictEqual(contextual.form, true, "A1: it must open the New Shot form directly");

  /* A2 — the generic chooser is untouched and still offers every record. */
  const generic = run(board.context, `
    closeModal();
    openGlobalAdd();
    const html = String(document.getElementById("modal").innerHTML || "");
    return { chooser: html.includes("What are you adding?"), keys: [...html.matchAll(/runGlobalAdd\\('([a-z]+)'\\)/g)].map((row) => row[1]) };`);
  assert.strictEqual(generic.chooser, true, "A2: the global Add must still show the generic chooser");
  assert.deepStrictEqual(generic.keys, ["shot", "scene", "character", "location", "prop", "audio", "project"],
    "A2: and must still offer every record it offered before");

  /* A3 — the shell's own Add is still the generic one, and the References page, which
     genuinely has no single record in mind on its All and Canon tabs, keeps it too. */
  const shell = readLF("public/app.js");
  assert(/\$\("#global-add"\)\.onclick = \(\) => openGlobalAdd\(\);/.test(shell),
    "A3: the shell's global Add must remain the generic chooser");
  const library = await render("#/library/all", project, { scan: scanFor(project) });
  assert(/openGlobalAdd\(/.test(String(library.map.get("main").innerHTML || "")),
    "A3: the References page keeps the chooser, because its Add is genuinely multi-entity");

  /* An unrecognised key must land somewhere useful rather than nowhere. */
  const unknown = run(board.context, `
    closeModal();
    openContextualAdd("nonesuch");
    return { chooser: String(document.getElementById("modal").innerHTML || "").includes("What are you adding?") };`);
  assert.strictEqual(unknown.chooser, true, "A3: an unrecognised record type falls back to the chooser");
  note("A. contextual add: Shots page Add opens New Shot directly; the shell, the References page and an unknown key all still get the seven-record chooser");
}

/* ===========================================================================
   B — WHAT NEW SHOT ASKS.
   =========================================================================== */
async function checkNewShotForm() {
  const project = projectWith(newShotRecord("SC-01-01", "SC-01"));
  const page = await render("#/shots/board", project, { scan: scanFor(project) });
  const form = run(page.context, `
    openContextualAdd("shot");
    const html = String(document.getElementById("modal").innerHTML || "");
    const labels = [...html.matchAll(/<label for="ff-([^"]+)">([^<]*)<\\/label>/g)].map((row) => ({ field: row[1], label: row[2] }));
    const routeSelect = (html.match(/<select id="ff-deliveryRoute">([^]*?)<\\/select>/) || [, ""])[1];
    const options = [...routeSelect.matchAll(/<option value="([^"]*)"\\s*([^>]*)>([^<]*)<\\/option>/g)]
      .map((row) => ({ value: row[1], selected: /\\bselected\\b/.test(row[2]), label: row[3] }));
    return { labels, options, html };`);

  /* B1 — the durable creative question is about the event, and no field assumes a still.
     "still" is checked across every label, because moving the assumption from one
     field's wording into another's would be the same defect wearing a different hat. */
  const desc = form.labels.find((row) => row.field === "desc");
  assert(desc, "B1: New Shot must still ask for the shot's own description");
  assert.strictEqual(desc.label, "What happens in this shot?", "B1: and must ask what happens, not what a still shows");
  for (const row of form.labels)
    assert(!/\bstill\b/i.test(row.label), `B1: no New Shot field may assume a still: ${row.field} says "${row.label}"`);

  /* B2 — the route is offered, undecided is the default, and the vocabulary is 5a's. */
  assert(form.options.length, "B2: New Shot must offer the execution route");
  assert.deepStrictEqual(form.options.map((row) => row.value), ["", ...Route.CINEBRAID_SHOT_ROUTES],
    "B2: the choices are exactly the canonical vocabulary, in its declared order, behind an undecided default");
  assert.strictEqual(form.options[0].label, "Not decided yet", "B2: and the undecided state is named plainly");
  assert.deepStrictEqual(form.options.filter((row) => row.selected).map((row) => row.value), [""],
    "B2: nothing but 'not decided' may be preselected — a route chosen for the filmmaker is not a decision");
  assert(/optional/i.test((form.labels.find((row) => row.field === "deliveryRoute") || {}).label || ""),
    "B2: the route field must say it is optional");

  /* B3 — creating with no route leaves the key ABSENT, not "". */
  const undecided = run(page.context, `
    closeModal();
    openContextualAdd("shot");
    document.getElementById("ff-scene").value = "SC-01";
    document.getElementById("ff-title").value = "Undecided shot";
    document.getElementById("ff-desc").value = "Kai crosses the bay.";
    document.getElementById("ff-positioning").value = "";
    document.getElementById("ff-location").value = "";
    document.getElementById("ff-deliveryRoute").value = "";
    _formSubmit();
    const made = P.shots[P.shots.length - 1];
    return {
      id: made.id,
      hasKey: Object.prototype.hasOwnProperty.call(made, "deliveryRoute"),
      reading: readShotRoute(made).reading,
      desc: made.desc,
      action: made.creationBrief.action,
    };`);
  assert.strictEqual(undecided.hasKey, false, "B3: an undecided shot carries NO deliveryRoute key at all");
  assert.strictEqual(undecided.reading, "absent", "B3: and reads as absent, not as an empty declaration");
  assert.strictEqual(undecided.desc, "Kai crosses the bay.", "B3: the durable description is stored on the shot");

  /* B4 — creating WITH a route writes the canonical token, through the one writer. */
  for (const route of ROUTES) {
    const made = run(page.context, `
      closeModal();
      openContextualAdd("shot");
      document.getElementById("ff-scene").value = "SC-01";
      document.getElementById("ff-title").value = "Declared ${route}";
      document.getElementById("ff-desc").value = "Kai crosses the bay.";
      document.getElementById("ff-positioning").value = "";
      document.getElementById("ff-location").value = "";
      document.getElementById("ff-deliveryRoute").value = "${route}";
      _formSubmit();
      const shot = P.shots[P.shots.length - 1];
      return { stored: shot.deliveryRoute, reading: readShotRoute(shot).reading };`);
    assert.strictEqual(made.stored, route, `B4: ${route} is stored as the canonical token`);
    assert.strictEqual(made.reading, "declared", `B4: ${route} reads as declared`);
  }

  /* B4b — and the file that creates a shot still names neither route writer, because
     the Shot Intent control is the application's only one. */
  assert(!/declareShotRoute|clearShotRoute|\.deliveryRoute\s*=/.test(readLF("public/mutations.js")),
    "B4: public/mutations.js must reach the route through setShotIntent, never write it");
  note(`B. new shot: the primary question is "What happens in this shot?", no field mentions a still, and the route is offered as ${Route.CINEBRAID_SHOT_ROUTES.length} canonical choices behind "Not decided yet" — chosen routes round-trip through the one writer, an unchosen one writes no key`);
}

/* ===========================================================================
   C — AN UNDECLARED ROUTE FABRICATES NOTHING.
   =========================================================================== */
async function checkUndeclaredFabricatesNothing() {
  const project = projectWith(newShotRecord("SC-01-01", "SC-01"));
  const row = readinessOf(project, "SC-01-01");

  /* C1 — the record says nothing, and readiness requires nothing. */
  assert.strictEqual(Route.readShotRoute(project.shots[0]).reading, "absent", "C1: a new shot declares no route");
  assert.strictEqual(requiredFrameUnits(row).length, 0, "C1: and therefore owes no required frame");
  assert.strictEqual(row.units.filter((unit) => unit.kind === "frame").length, 1,
    "C1: the frame it carries is still declared as a unit — nothing was deleted, it is simply not owed");
  assert.strictEqual(row.nextAction.code, "declare-shot-route",
    "C1: the next action is the decision the shot is actually missing");
  assert.strictEqual(row.status, "NEEDS_DECISION", "C1: and it is a decision, not work and not completion");
  for (const code of presentedActionCodes(row))
    assert(!["produce-frame", "approve-required-frames", "approve-parent-frame"].includes(code),
      `C1: no frame debt may be presented anywhere in the payload, found ${code}`);
  /* The frame's own unit still knows what producing it would mean — it is simply not
     required, so nothing can promote it. Asserted, because "the action is gone" and
     "the action is optional" are different products and only the second is intended. */
  const frameUnit = row.units.find((unit) => unit.kind === "frame");
  assert.strictEqual(frameUnit.required, false, "C1: the frame is optional, not required");
  assert.strictEqual(frameUnit.nextAction.code, "produce-frame",
    "C1: and producing it is still offered as the optional work it is");
  assert.deepStrictEqual(row.optionalOutstanding, [frameUnit.id],
    "C1: readiness reports it as outstanding-but-optional, by id and with no sentence to promote");
  /* THE FALL-THROUGH THIS BRANCH EXISTS TO STOP. Without it, "no outstanding required
     unit" is read as "every declared unit is satisfied" and the shot is offered the
     delivery decision — a shot that has produced nothing being told to mark it final. */
  assert.notStrictEqual(row.nextAction.code, "mark-shot-final",
    "C1: a shot that has produced nothing must never be offered the delivery decision");
  assert.notStrictEqual(row.status, "COMPLETE", "C1: and must never read as complete");

  /* C2 — the rendered workspace. */
  const page = await render("#/shot/SC-01-01", project, { scan: scanFor(project) });
  const main = String(page.map.get("main").innerHTML || "");
  assert(!/Produce Frame|Produce the frame/i.test(main),
    "C2: the workspace must not offer to produce a frame nothing has asked for");
  const primary = (main.match(/<button class="assemble-btn shot-primary-action"[^>]*>([^<]*)</) || [, ""])[1];
  assert.strictEqual(primary, "Choose how this shot is made",
    "C2: the one primary action is the decision, in the filmmaker's words");
  const summary = (main.match(/<section class="shot-command-summary"[^]*?<\/section>/) || [""])[0];
  assert(/<b>0\/0<\/b>/.test(summary), "C2: the command summary counts no required frame");
  assert(!/not required by this intent/.test(summary),
    "C2: and must not call an undeclared shot's silence an intent");
  assert(/none until you say how this shot is made/.test(summary),
    "C2: it says what is actually true instead");
  assert(/data-shot-route-declared="0"/.test(summary), "C2: and states the undeclared reading for any reader");

  /* C3 — a LEGACY shot with an i2v motion unit. NO ROUTE IS INFERRED from its frames,
     its approved media, its returned candidate, its motion unit or its legacy output
     plan — and its opening frame is still required, because the UNIT declares `i2v`
     and that method needs one. That requirement belongs to the unit, not to a route
     nobody declared, which is the distinction section D's `frameNeedsOf` measures. */
  const legacyProject = projectWith(legacyShotRecord("SC-01-02", "SC-01"));
  approveFrame(legacyProject, "SC-01-02", "frame-a-legacy", "LEGACY-A.png");
  const legacy = readinessOf(legacyProject, "SC-01-02");
  assert.strictEqual(Route.readShotRoute(legacyProject.shots[0]).reading, "absent",
    "C3: opening a legacy shot declares no route on its behalf");
  assert.deepStrictEqual(requiredFrameUnits(legacy).map((unit) => unit.id), ["frame:frame-a-legacy"],
    "C3: the i2v unit's own declared kind requires the opening frame, and only that one");
  assert.strictEqual(legacy.units.find((unit) => unit.id === "frame:frame-b-legacy").required, false,
    "C3: the second frame is retained and owed by nothing — no route asked for a closing endpoint");
  assert.strictEqual(legacy.units.filter((unit) => unit.kind === "frame").length, 2,
    "C3: both frame records survive as declared units");
  assert.strictEqual(legacy.units.find((unit) => unit.id === "frame:frame-a-legacy").complete, true,
    "C3: and the approval already taken on one of them is still recognised");
  assert.strictEqual(legacyProject.shots[0].clips.length, 1, "C3: the motion unit is untouched");
  assert.strictEqual(legacyProject.shots[0].candidateFiles.length, 1, "C3: the returned candidate is untouched");
  assert.strictEqual(legacyProject.shots[0].keyframes[0].winner, "LEGACY-A.png", "C3: the frame's own pointer is untouched");

  /* C4 — the same legacy shot with NOTHING left that declares a method: the motion unit
     is a `post` unit, which the shipped probe set maps to no animate method. Every frame
     it carries is then historical, and it is asked how the shot is made rather than told
     to buy a frame. This is the legacy half of the brief's undeclared case. */
  const dormantProject = projectWith(legacyShotRecord("SC-01-03", "SC-01", {
    clips: [{ id: "seg-post", suffix: "a", label: "A", title: "Finishing pass", dur: 5, kind: "post", note: "", motionPrompt: "", generationPackages: [] }],
    creationBrief: { locationId: "", propIds: [], mode: "auto", action: "The courier sets the parcel down.", promptBuilds: [] },
    keyframes: [
      { id: "frame-a-dormant", label: "A", title: "Opening frame A", winner: null, required: true, generationPackages: [] },
      { id: "frame-b-dormant", label: "B", title: "Key frame B", winner: null, required: true, generationPackages: [] },
    ],
    candidateFiles: [],
  }));
  const dormant = readinessOf(dormantProject, "SC-01-03");
  assert.strictEqual(Route.readShotRoute(dormantProject.shots[0]).reading, "absent",
    "C4: a legacy shot whose units declare no animate method still declares no route");
  assert.strictEqual(requiredFrameUnits(dormant).length, 0,
    "C4: and nothing requires either of its frames");
  assert.strictEqual(dormant.units.filter((unit) => unit.kind === "frame").length, 2,
    "C4: while both frame records are still declared units");
  for (const code of presentedActionCodes(dormant))
    assert(!["produce-frame", "approve-required-frames", "approve-parent-frame"].includes(code),
      `C4: and no frame debt is presented, found ${code}`);
  /* C5 — MAKING SOMETHING OPTIONAL MUST NOT MAKE IT SILENT. A frame nothing currently
     requires can still carry a requirement only a person can resolve. Here the shot's
     presence declaration is malformed — a corrupted record, not route debt — and the
     shot must still say so rather than report itself ready to animate. */
  const malformedProject = projectWith(legacyShotRecord("SC-01-04", "SC-01", {
    clips: [{ id: "seg-post", suffix: "a", label: "A", title: "Finishing pass", dur: 5, kind: "post", motionPrompt: "", generationPackages: [] }],
    keyframes: [{ id: "frame-a-bad", label: "A", title: "Opening frame A", winner: null, required: true, generationPackages: [] }],
    candidateFiles: [],
    creationBrief: {
      locationId: "", propIds: [], mode: "auto", deliveryIntent: "motion", promptBuilds: [],
      frameWorkflows: { "frame-a-bad": { entityPresence: { KAI: { state: "absent" } } } },
    },
  }));
  const malformed = readinessOf(malformedProject, "SC-01-04");
  assert.strictEqual(requiredFrameUnits(malformed).length, 0,
    "C5: precondition — nothing requires the frame carrying the malformed declaration");
  assert.strictEqual(malformed.status, "NEEDS_DECISION",
    "C5: a corrupted record is still a decision, on a unit nothing asks for");
  assert.strictEqual(malformed.nextAction.code, "repair-presence-declaration",
    "C5: and the shot names the repair rather than reporting itself ready");

  /* C6 — AND THE QUIETER SCREENS DO NOT CARRY THE FABRICATION EITHER. The project log
     on Reports and the batch health check both read projectHealthIssues(), which counted
     `frame.required` directly. Left alone, "Required frames 0/1" would simply have moved
     to a screen nobody looks at while the shot workspace told the truth. */
  const healthPage = await render("#/shot/SC-01-01", projectWith(newShotRecord("SC-01-01", "SC-01")), { scan: scanFor(project) });
  const health = run(healthPage.context, `
    const issues = projectHealthIssues();
    return {
      frames: issues.filter((row) => row.type === "Frames").map((row) => row.shot.id + ": " + row.msg),
      types: [...new Set(issues.map((row) => row.type))],
    };`);
  assert.deepStrictEqual(health.frames, [],
    `C6: an undeclared shot owes no frame anywhere, including the project log: ${health.frames.join(" | ")}`);
  /* And the check itself is still alive, or the emptiness above proves nothing. */
  const stillReports = run(healthPage.context, `
    const s = P.shots.find((row) => row.id === "SC-01-01");
    s.creationBrief.deliveryIntent = "still";
    return projectHealthIssues().filter((row) => row.type === "Frames").map((row) => row.msg);`);
  assert.deepStrictEqual(stillReports, ["1 required frame is not approved"],
    `C6: precondition — the same check must still report a frame a declaration DOES require, got ${JSON.stringify(stillReports)}`);

  /* C7 — WHAT THE SHOT DECLARES AS INPUT IS STILL OWED. The brief's own order puts
     inputs before execution: what does this shot need, THEN how is it made. Readiness
     hangs an entity-state requirement on every unit because every unit consumes the
     cast, so gating those rows on `unit.required` would have made casting a character
     onto an undecided shot raise nothing at all — and the reference surface would have
     reported the approval it needs as coverage plan. Frame-scoped rows must NOT cross:
     letting them would put the frame debt back through a side door. */
  const castProject = projectWith(newShotRecord("SC-01-05", "SC-01", { characters: ["KAI"], codes: ["LOC-HULL"] }));
  const castPage = await render("#/shot/SC-01-05", castProject, { scan: scanFor(castProject) });
  const owed = run(castPage.context, `
    const s = P.shots.find((row) => row.id === "SC-01-05");
    const readiness = shotReadinessFor(s);
    const rows = outstandingReadinessRows(readiness);
    return {
      requiredFrames: readiness.units.filter((u) => u.kind === "frame" && u.required).length,
      kinds: [...new Set(rows.map((row) => row.kind))].sort(),
      entities: [...new Set(rows.filter((row) => row.kind === "entity-state").map((row) => row.targetKey))].sort(),
    };`);
  assert.strictEqual(owed.requiredFrames, 0, "C7: precondition — the undeclared shot still requires no frame");
  assert(owed.entities.length > 0,
    "C7: the cast it declares is still a current obligation, before it has said how it is made");
  assert(!owed.kinds.includes("shot-frame"),
    `C7: and no frame-scoped requirement crosses from an optional unit, got ${owed.kinds.join(", ")}`);

  note("C. undeclared: a new shot requires no frame, states the decision it is missing rather than a purchase, and never falls through to 'mark this final'; a legacy i2v unit still requires the opening frame ITS kind names while the shot's route stays absent; a legacy shot whose units name no method owes neither of its frames, and every frame, approval, candidate and clip survives all of it; an optional unit carrying a malformed record still keeps the card, and the project log reports no frame debt either, while the cast the shot declares is still owed");
}

/* ===========================================================================
   D — DECLARED ROUTES KEEP THE REQUIREMENTS THEIR OWNER STATES.
   =========================================================================== */
function checkDeclaredRoutes() {
  const measured = {};
  for (const route of ROUTES) {
    const project = projectWith(newShotRecord("SC-01-01", "SC-01", {
      deliveryRoute: route,
      /* Two frame records, so a route that needs a closing endpoint has one to name
         and a route that needs none has one it must NOT claim. */
      keyframes: [
        { id: "frame-a-new", label: "A", title: "Opening frame A", winner: null, required: true, generationPackages: [] },
        { id: "frame-b-new", label: "B", title: "Closing frame B", winner: null, required: true, generationPackages: [] },
      ],
    }));
    const row = readinessOf(project, "SC-01-01");
    const canonical = frameNeedsOf(route);
    measured[route] = { required: requiredFrameUnits(row).length, canonical: canonical.length, action: row.nextAction.code };

    assert.strictEqual(requiredFrameUnits(row).length, canonical.length,
      `D: ${route} must require exactly the frame roles shotRouteInputNeeds() names (${canonical.join(", ") || "none"})`);
    assert.strictEqual(row.units.filter((unit) => unit.kind === "frame").length, 2,
      `D: ${route} keeps both stored frame records whatever it requires`);
    assert.notStrictEqual(row.nextAction.code, "declare-shot-route",
      `D: ${route} has declared how it is made, so it is never asked again`);
  }
  /* The canonical answers, stated so a silent change to the owner is visible here.
     Read from the owner in the loop above and only COMPARED with these. */
  assert.strictEqual(measured.i2v.required, 1, "D: i2v owes exactly one opening frame");
  assert.strictEqual(measured.flf.required, 2, "D: flf owes both endpoints");
  assert.strictEqual(measured.r2v.required, 0, "D: r2v owes no authored frame — no legacy Frame A is manufactured for it");
  assert.strictEqual(measured.t2v.required, 0, "D: t2v owes no authored frame");
  assert(measured.hybrid.required > 0, "D: hybrid names more than one method and owes the union of their inputs");

  /* D2 — THE NEXT ACTION FOLLOWS THE DECLARED ROUTE, and only it. A route that needs a
     frame asks for the frame; a route that needs a reference asks for the reference; a
     route that needs neither goes straight to the motion. The codes are read off the
     rollup, and each is checked against what that route's own canonical needs say —
     never against a table of expected sentences. */
  for (const route of ROUTES) {
    const needs = Readiness.shotRouteInputNeeds(route).needs;
    const wantsFrame = needs.some((role) => FRAME_ROLES.includes(role));
    const wantsReference = needs.includes("reference");
    const code = measured[route].action;
    if (wantsFrame)
      assert(["produce-frame", "approve-required-frames", "approve-parent-frame"].includes(code),
        `D2: ${route} needs a frame input, so its next action must be about a frame, got ${code}`);
    else if (wantsReference)
      assert(["prepare-references", "resolve-relationship", "confirm-existing-reference"].includes(code),
        `D2: ${route} needs a reference, so its next action must be about a reference, got ${code}`);
    else
      assert.strictEqual(code, "produce-motion",
        `D2: ${route} needs no authored input, so the next action is the motion itself`);
  }

  /* D3 — NO PROVIDER, NO MODEL, NO COST. Declaring a route is a durable production
     statement, and a control that quietly picked a profile with it would make the route
     synonymous with whatever this installation happens to have connected today. */
  const coupling = projectWith(newShotRecord("SC-01-01", "SC-01"));
  const before = JSON.parse(JSON.stringify(coupling.shots[0]));
  for (const route of ROUTES) assert(Route.declareShotRoute(coupling.shots[0], route).ok, `D3: ${route} declarable`);
  Route.clearShotRoute(coupling.shots[0]);
  assert.deepStrictEqual(coupling.shots[0], before,
    "D3: declaring every route and withdrawing it leaves the shot record byte-identical — "
    + "no profile, no provider, no mode, no duration and no cost moves with a route");
  note(`D. declared routes: required frame roles per route — ${ROUTES.map((route) => `${route}=${measured[route].required}`).join(", ")}, `
    + `each equal to shotRouteInputNeeds(); next action per route — ${ROUTES.map((route) => `${route}=${measured[route].action}`).join(", ")}; `
    + "and a route carries no provider, model, mode, duration or cost with it");
}

/* ===========================================================================
   E — DECLARING, CHANGING AND WITHDRAWING.
   =========================================================================== */
function checkRouteChanges() {
  /* One shot, carrying an approved opening frame and a second frame record, walked
     through the transitions the brief names. Media is checked after every step. */
  function build() {
    const project = projectWith(newShotRecord("SC-01-01", "SC-01", {
      keyframes: [
        { id: "frame-a-new", label: "A", title: "Opening frame A", winner: "HISTORIC-A.png", required: true, generationPackages: [] },
        { id: "frame-b-new", label: "B", title: "Closing frame B", winner: "HISTORIC-B.png", required: true, generationPackages: [] },
      ],
      candidateFiles: [
        { stored: "HISTORIC-A.png", original: "HISTORIC-A.png", decision: "approved", mediaType: "image", frameId: "frame-a-new" },
        { stored: "HISTORIC-B.png", original: "HISTORIC-B.png", decision: "approved", mediaType: "image", frameId: "frame-b-new" },
      ],
    }));
    approveFrame(project, "SC-01-01", "frame-a-new", "HISTORIC-A.png");
    approveFrame(project, "SC-01-01", "frame-b-new", "HISTORIC-B.png");
    return project;
  }
  const mediaOf = (project) => {
    const shot = project.shots[0];
    return {
      frames: shot.keyframes.map((frame) => `${frame.id}:${frame.winner || ""}`),
      candidates: shot.candidateFiles.map((row) => row.stored),
      receipts: ["frame-a-new", "frame-b-new"].map((frameId) =>
        Kernel.hasCurrentHumanAuthority(project, { kind: "shot-frame", shotId: "SC-01-01", frameId }) ? `${frameId}:approved` : `${frameId}:none`),
    };
  };

  const transitions = [
    ["undecided", "i2v"],
    ["undecided", "r2v"],
    ["i2v", "r2v"],
    ["flf", "r2v"],
    ["r2v", "i2v"],
    ["i2v", "undecided"],
  ];
  const observed = [];
  for (const [from, to] of transitions) {
    const project = build();
    const shot = project.shots[0];
    const before = mediaOf(project);
    if (from !== "undecided") assert(Route.declareShotRoute(shot, from).ok, `E: ${from} must be declarable`);
    const startRequired = requiredFrameUnits(readinessOf(project, "SC-01-01")).map((unit) => unit.id);

    if (to === "undecided") Route.clearShotRoute(shot);
    else assert(Route.declareShotRoute(shot, to).ok, `E: ${to} must be declarable`);
    const endRow = readinessOf(project, "SC-01-01");
    const endRequired = requiredFrameUnits(endRow).map((unit) => unit.id);

    assert.strictEqual(startRequired.length, from === "undecided" ? 0 : frameNeedsOf(from).length,
      `E: ${from} -> ${to}: the starting requirements are the starting route's own`);
    assert.strictEqual(endRequired.length, to === "undecided" ? 0 : frameNeedsOf(to).length,
      `E: ${from} -> ${to}: the requirements after the change are the NEW route's own`);
    /* THE HALF THAT MATTERS: what the old route asked for stops being current. */
    for (const id of startRequired)
      if (!endRequired.includes(id))
        assert(endRow.units.some((unit) => unit.id === id && !unit.required),
          `E: ${from} -> ${to}: ${id} must stop being required without ceasing to exist`);
    assert.deepStrictEqual(mediaOf(project), before,
      `E: ${from} -> ${to}: no frame, candidate or approval receipt may move when a route does`);
    observed.push(`${from}->${to} ${startRequired.length}->${endRequired.length}`);
  }

  /* E-round-trip — a route withdrawn and re-declared restores exactly what it asked for. */
  const project = build();
  const shot = project.shots[0];
  Route.declareShotRoute(shot, "flf");
  const declared = requiredFrameUnits(readinessOf(project, "SC-01-01")).map((unit) => unit.id);
  Route.declareShotRoute(shot, "r2v");
  Route.declareShotRoute(shot, "flf");
  assert.deepStrictEqual(requiredFrameUnits(readinessOf(project, "SC-01-01")).map((unit) => unit.id), declared,
    "E: a route re-declared asks for exactly what it asked for before — there was never anything to restore");

  /* E-declaration-is-the-only-trigger. Evaluating readiness any number of times, before
     and after, must not change the record. */
  const untouched = projectWith(newShotRecord("SC-01-01", "SC-01"));
  const serialised = JSON.stringify(untouched);
  for (let index = 0; index < 3; index += 1) readinessOf(untouched, "SC-01-01");
  assert.strictEqual(JSON.stringify(untouched), serialised,
    "E: asking what a shot requires must never write anything to it");
  note(`E. route changes: ${observed.join(" · ")} — the old route's requirements stop being current, the new route's apply, and every frame, candidate and approval receipt is byte-identical afterwards`);
}

/* ===========================================================================
   F — THE FRESHNESS OWNER, AND WHAT ACTUALLY REFUSES A ROUTE-INCOMPATIBLE PACKAGE.
   =========================================================================== */
async function checkFreshnessAndGate() {
  const project = projectWith(newShotRecord("SC-01-01", "SC-01", {
    deliveryRoute: "i2v",
    keyframes: [{ id: "frame-a-new", label: "A", title: "Opening frame A", winner: "HISTORIC-A.png", required: true, generationPackages: [] }],
    candidateFiles: [{ stored: "HISTORIC-A.png", original: "HISTORIC-A.png", decision: "approved", mediaType: "image", frameId: "frame-a-new" }],
    clips: [{ id: "seg-a", suffix: "a", label: "A", title: "Primary motion", dur: 5, kind: "i2v", note: "", motionPrompt: "The ship lifts away.", fromFrame: "frame-a-new", toFrame: "", generationPackages: [], motionPlan: null }],
  }));
  approveFrame(project, "SC-01-01", "frame-a-new", "HISTORIC-A.png");
  const page = await render("#/shot/SC-01-01", project, { scan: scanFor(project) });

  /* F1 — THE FRESHNESS OWNER IS ASKED, NOT RESTATED. A package is compiled under one
     route and read back under another; whatever packageStaleReasons() answers is what
     this suite records. It is asked twice — unchanged and changed — so a suite that
     recorded a constant would be visible as one. */
  const freshness = run(page.context, `
    const s = P.shots.find((row) => row.id === "SC-01-01");
    const unit = s.clips[0];
    const pack = {
      id: "pack-1", segmentId: unit.id, revision: 1, scope: "motion", kind: "motion",
      profileId: "minimax-h3/i2v", mode: "i2v", dependencySnapshot: null,
    };
    unit.generationPackages = [pack];
    /* THE SAVED SNAPSHOT IS THE ONE THE PRODUCT WOULD HAVE RECORDED, taken through the
       shipped reader rather than hand-written — a hand-written one differs from the
       live answer in some field nobody meant to test and "stale" stops meaning
       anything. */
    pack.dependencySnapshot = JSON.parse(JSON.stringify(currentSnapshotForPackage(s, pack)));
    const before = packageStaleReasons(s, pack);
    declareShotRoute(s, "r2v");
    const after = packageStaleReasons(s, pack);
    /* And the same question once the change also moves the evidence the owner DOES
       record, so the comparator is demonstrably alive on this fixture. */
    s.creationBrief.motionDuration = 9;
    const moved = packageStaleReasons(s, pack);
    return { before, after, moved };`);
  assert.deepStrictEqual(freshness.before, [], "F1: an unchanged package is not stale");
  assert(freshness.moved.length > 0,
    "F1: precondition — the freshness owner must be alive on this fixture, or 'no reasons' below proves nothing");
  assert.deepStrictEqual(freshness.after, freshness.before,
    "F1: the freshness owner records no route in a package's dependency evidence, so a route change alone reports "
    + "no staleness reason. This suite asserts what the owner says rather than inventing a reason beside it — "
    + "the accepted refusal for a route-incompatible package is the intent gate below, which is stronger than stale.");

  /* F2 — WHAT A ROUTE CHANGE ACTUALLY DOES TO A PACKAGE, through the gate Slice 5b
     shipped for it: a stored target whose method the declared route does not admit
     stops being executable, and says so in a sentence. Nothing is deleted. */
  const gate = run(page.context, `
    const s = P.shots.find((row) => row.id === "SC-01-01");
    const profile = { id: "minimax-h3/i2v", mode: "i2v" };
    declareShotRoute(s, "i2v");
    const underI2v = guidedMotionProfileExecutable(s, profile);
    declareShotRoute(s, "r2v");
    const underR2v = guidedMotionProfileExecutable(s, profile);
    const refusal = guidedMotionIntentRefusal(s, profile);
    return { underI2v: !!underI2v, underR2v: !!underR2v, refusal: String(refusal || ""), clips: s.clips.length, frames: s.keyframes.map((f) => f.winner || "") };`);
  assert.strictEqual(gate.underI2v, true, "F2: an i2v target is executable under an i2v route");
  assert.strictEqual(gate.underR2v, false, "F2: and stops being executable when the route becomes r2v");
  assert(gate.refusal.length > 0, "F2: the refusal is a sentence, not a silence");
  assert.strictEqual(gate.clips, 1, "F2: and nothing about the motion unit was deleted");
  assert.deepStrictEqual(gate.frames, ["HISTORIC-A.png"], "F2: nor the approved frame it was compiled from");
  note("F. freshness: packageStaleReasons() reports no reason for a route change alone — the route is not in a package's recorded dependency evidence — and the accepted Shot Intent gate is what refuses a now-incompatible target, without deleting the package, the clip or the frame");
}

/* ===========================================================================
   G — NOTHING INFERS A ROUTE.
   =========================================================================== */
async function checkNoInference() {
  /* G1 — six shot shapes that each look like a route, and none of them declares one. */
  const shapes = {
    "an approved opening frame": { keyframes: [{ id: "frame-a-new", label: "A", winner: "A.png", required: true }] },
    "two approved endpoints": { keyframes: [{ id: "frame-a-new", label: "A", winner: "A.png", required: true }, { id: "frame-b-new", label: "B", winner: "B.png", required: true }] },
    "an i2v clip": { clips: [{ id: "seg-a", suffix: "a", label: "A", kind: "i2v", dur: 5, motionPrompt: "x" }] },
    "an flf clip": { clips: [{ id: "seg-a", suffix: "a", label: "A", kind: "flf", dur: 5, motionPrompt: "x" }] },
    "the legacy FLF output plan": { route: "GENERATE (FLF)" },
    "a motion delivery intent": { creationBrief: { locationId: "", propIds: [], mode: "auto", deliveryIntent: "motion", promptBuilds: [] } },
  };
  for (const [name, extra] of Object.entries(shapes)) {
    const project = projectWith(newShotRecord("SC-01-01", "SC-01", extra));
    const page = await render("#/shot/SC-01-01", project, { scan: scanFor(project) });
    const seen = run(page.context, `
      const s = P.shots.find((row) => row.id === "SC-01-01");
      /* Every stage rendered, so no renderer can declare on the way past. */
      const takes = takesFor("SC-01-01");
      for (const stage of SHOT_STAGE_IDS) { try { shotStageState(stage, shotStageModelFacts(s, takes)); } catch {} }
      evaluateShotReadiness(P, s, {});
      shotIntentControl(s);
      return { hasKey: Object.prototype.hasOwnProperty.call(s, "deliveryRoute"), reading: readShotRoute(s).reading };`);
    assert.strictEqual(seen.hasKey, false, `G1: ${name} must not write a route onto the record`);
    assert.strictEqual(seen.reading, "absent", `G1: ${name} must still read as undeclared`);
  }

  /* G2 — the requirement derivation reads declarations, never evidence. The frame
     requirement's own source may consult the route answer and the delivery intent, and
     nothing else: no winner, no candidate, no clip kind, no package, no filename. */
  const readiness = readLF("public/shared-shot-readiness.js");
  const derivation = readiness.slice(
    readiness.indexOf("function declaredFrameRequirement("),
    readiness.indexOf("function declaredUnits("),
  );
  assert(derivation.length > 0, "G2: precondition — the frame requirement derivation must be locatable by name");
  const code = derivation.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  /* EVIDENCE, not declarations. A frame's own approved file, the candidates returned
     for it, the packages compiled against it and an entity's approved file are all
     RESULTS of production; a requirement derived from any of them is a method nobody
     chose, read back out of the work already done. */
  for (const forbidden of ["winner", "candidateFiles", "generationPackages", "approvedFile", "promptBuilds", "deliveryRoute"])
    assert(!new RegExp(`\\b${forbidden}\\b`).test(code),
      `G2: the frame requirement must not read ${forbidden} — that would be inferring a route from evidence`);
  /* A motion unit's `kind` IS a declaration, so it may be read — but only as a method
     name handed to the shipped probe set. A derivation that tested a kind against a
     literal would be the second route table this slice must not create. */
  assert(/ANIMATE_METHOD_PROBES/.test(code),
    "G2: a declared clip kind must be resolved through the shipped probe set");
  for (const token of ['"i2v"', '"flf"', '"t2v"', '"r2v"', "'i2v'", "'flf'"])
    assert(!code.includes(token),
      `G2: the requirement derivation must name no route or method literal, found ${token}`);
  /* And the roles it may extract are the ones the route answer is built from. */
  assert(/FRAME_INPUT_ROLES/.test(code),
    "G2: the frame roles come from the same declaration shotRouteInputNeeds() reads");
  note("G. no inference: six route-shaped shots (approved endpoints, i2v and flf clips, the legacy FLF output plan, a motion intent) rendered through every stage and evaluated, and not one declared a route; the requirement derivation reads no winner, candidate, package or approved file, names no method literal, and resolves a declared clip kind through the shipped probe set");
}

/* ===========================================================================
   H — INPUTS AND THE ROUTE ARE IN FRONT OF THE PRODUCTION CTA.
   =========================================================================== */
async function checkHierarchy() {
  const project = projectWith(newShotRecord("SC-01-01", "SC-01"));
  const page = await render("#/shot/SC-01-01", project, { scan: scanFor(project) });
  const main = String(page.map.get("main").innerHTML || "");

  /* H1 — the shot opens on Inputs, with the attachment controls actually open. */
  const layout = run(page.context, `
    const s = P.shots.find((row) => row.id === "SC-01-01");
    const takes = takesFor("SC-01-01");
    const html = String(document.getElementById("main").innerHTML || "");
    const inputsPanel = (html.match(/<details class="guided-work-panel guided-inputs-card"[^>]*>/) || [""])[0];
    const intentPanel = (html.match(/<details class="shot-intent-control"[^>]*>/) || [""])[0];
    return {
      selectedTask: boundedShotSelectedTask(s, takes),
      inputsOpen: /\\sopen[\\s>]/.test(inputsPanel),
      intentOpen: /\\sopen[\\s>]/.test(intentPanel),
      picker: html.includes("guided-input-tray"),
      stages: shotStageProgress(shotStageModelFacts(s, takes)).map((stage) => ({ id: stage.id, optional: stage.optional, availability: stage.availability })),
    };`);
  assert.strictEqual(layout.selectedTask, "inputs", "H1: a shot with nothing attached opens on Inputs");
  assert.strictEqual(layout.inputsOpen, true, "H1: and its source & references panel is open, not folded away");
  assert.strictEqual(layout.picker, true, "H1: with the shipped attachment controls actually rendered");

  /* H2 — the route choice is visible and states the undeclared fact. */
  assert.strictEqual(layout.intentOpen, true, "H2: the Shot Intent control is open while nothing has been declared");
  assert(/Execution route not chosen/.test(main), "H2: and says so in the filmmaker's words");
  assert(/data-shot-intent-undeclared="1"/.test(main), "H2: and states it for any reader");
  /* `data-frames-required` on this control keeps its shipped meaning — should Frames be
     exposed — so it reads 1 on a shot that owes nothing. The relevance beside it is the
     word for what the shot actually owes, and it is the frames workspace's own word. */
  assert(/<details class="shot-intent-control"[^>]*data-frames-relevance="undeclared"/.test(main),
    "H2: and states that the frame relevance is undeclared, not required");
  assert(/<option value="" selected>Not decided yet<\/option>/.test(main),
    "H2: with 'Not decided yet' selected — a real state, not an empty control");

  /* A DECLARED shot gets the control back the way it was: collapsed, and remembering
     its own preference under its own key. */
  const declaredProject = projectWith(newShotRecord("SC-01-01", "SC-01", { deliveryRoute: "r2v" }));
  const declaredPage = await render("#/shot/SC-01-01", declaredProject, { scan: scanFor(declaredProject) });
  const declaredMain = String(declaredPage.map.get("main").innerHTML || "");
  assert(!/\sopen[\s>]/.test((declaredMain.match(/<details class="shot-intent-control"[^>]*>/) || [""])[0]),
    "H2: a declared shot's intent control stays collapsed — the question has been answered");
  assert(!/Execution route not chosen/.test(declaredMain), "H2: and stops saying it has not been");
  /* The remembered-state keys must differ, or the declared state's stored preference
     would silently defeat the undeclared default on the same shot. */
  assert(/rememberWorkspaceSection\('SC-01-01:shot-intent:undeclared'/.test(main),
    "H2: the undeclared control remembers under its own key");
  assert(/rememberWorkspaceSection\('SC-01-01:shot-intent'/.test(declaredMain),
    "H2: and the declared one under the shipped key");

  /* H3 — no production CTA is offered for work nothing has asked for. */
  assert(!/Produce the frame|Produce Frame|Produce the motion/i.test(main),
    "H3: an undeclared shot is offered no production CTA at all");
  assert.strictEqual((main.match(/shot-primary-action/g) || []).length, 1,
    "H3: and still exactly one primary action, because a screen with two has none");

  /* H4 — Look & blocking and Motion are not turned into mandatory steps by any of this. */
  const look = layout.stages.find((stage) => stage.id === "look");
  assert.strictEqual(look.optional, true, "H4: Look & blocking stays optional");
  assert.strictEqual(look.availability, "available", "H4: and stays reachable");
  const inputs = layout.stages.find((stage) => stage.id === "inputs");
  assert.strictEqual(inputs.optional, true, "H4: Inputs stays optional too — foregrounding is not a gate");

  /* H5 — RESUME. A stored stage still wins over the recommendation, so an explicit
     return to the work in progress is not destroyed by opening on Inputs. */
  const resumed = await render("#/shot/SC-01-01", projectWith(newShotRecord("SC-01-01", "SC-01")), {
    scan: scanFor(project),
    storage: { "cinebraid-focused:fixture:shot-task:SC-01-01": "motion" },
  });
  assert.strictEqual(run(resumed.context, `
    const s = P.shots.find((row) => row.id === "SC-01-01");
    return boundedShotSelectedTask(s, takesFor("SC-01-01"));`), "motion",
    "H5: a stored stage selection still wins — resuming the exact work is untouched");
  note("H. hierarchy: a fresh shot opens on Inputs with the reference controls open and the route control expanded and stating that nothing was chosen; the single primary action is the decision, no production CTA is drawn, Look/Inputs stay optional, and a stored stage still resumes");
}

/* =========================================================================== */
async function main() {
  await checkContextualAdd();
  await checkNewShotForm();
  await checkUndeclaredFabricatesNothing();
  checkDeclaredRoutes();
  checkRouteChanges();
  await checkFreshnessAndGate();
  await checkNoInference();
  await checkHierarchy();

  /* The action code this slice adds is declared in all three places a readiness action
     has to be declared, or it renders as a bare "Next action" with no destination. */
  assert(Readiness.READINESS_NEXT_ACTIONS.includes("declare-shot-route"),
    "the new action must be a declared member of the readiness vocabulary");
  const destination = Stage.shotReadinessDestinationForAction("declare-shot-route");
  assert(destination && destination.stageId === "inputs" && destination.control === "setShotIntent",
    "and must have a declared destination that lands on the one route writer");
  assert(/"declare-shot-route": "Choose how this shot is made"/.test(readLF("public/app.js")),
    "and must have filmmaker-facing words");

  console.log("Shot intent at the front suite passed:");
  for (const line of notes) console.log(`  - ${line}`);
  console.log("  Paid calls: 0. Provider calls: 0. Off-site requests: 0.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

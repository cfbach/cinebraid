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
 *   F  a route change stales the AFFECTED packages through the one freshness owner,
 *      leaves frame packages and legacy packages alone, and does not replace the
 *      execution gate that separately refuses to run an incompatible target
 *   G  nothing infers a route — not a frame, a candidate, a clip, a package or a render
 *   H  inputs and the route choice are in front of the filmmaker before any production
 *      CTA, and Look/Blocking stay optional
 *   I  shotApprovalComplete() stays a workflow sign-off answer: route-invariant, on no
 *      persistent surface, and unable to contradict current-route readiness
 *   J  historical media on an undeclared shot is preserved and owed nothing: a stored
 *      post/reuse/hold/plan/i2v clip, an old approved frame and all of them together
 *      leave the route absent and the answer the route question
 *   M  the shell around #main agrees: the persistent stage bar offers no Continue and
 *      the Assistant rail names no next stage unless the destination is genuinely owed,
 *      and the declared-optional Look & blocking stage is never one
 *   N  the one route-blind reader of `frame.required` still standing is fenced where
 *      it is -- inside the automation hub, reaching no readiness, next action,
 *      command summary or stage bar. Deferred deliberately; see the section header
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
/* Strips comments so a check about CODE cannot be satisfied -- or broken -- by prose.
   Same shape as tests/stage-surfaces.js's, and needed for the same reason. */
const codeOnly = (source) => String(source).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

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

  /* C3 — a LEGACY shot carrying a stored `i2v` clip, an approved frame and a returned
     candidate. NO ROUTE IS INFERRED from any of it, and — the correction a Codex review
     demanded — none of it is CURRENT WORK either. A clip whose stored `kind` names a
     method is history describing a production that already happened; reading it as a
     declaration let an undeclared shot require the opening frame that method would
     need. Section J walks every historical shape; this is the one the earlier candidate
     got wrong, kept here beside the media it must not move. */
  const legacyProject = projectWith(legacyShotRecord("SC-01-02", "SC-01"));
  approveFrame(legacyProject, "SC-01-02", "frame-a-legacy", "LEGACY-A.png");
  const legacy = readinessOf(legacyProject, "SC-01-02");
  assert.strictEqual(Route.readShotRoute(legacyProject.shots[0]).reading, "absent",
    "C3: opening a legacy shot declares no route on its behalf");
  assert.deepStrictEqual(requiredFrameUnits(legacy).map((unit) => unit.id), [],
    "C3: and a stored i2v clip does not make its opening frame current work");
  assert.strictEqual(legacy.units.filter((unit) => unit.kind === "frame").length, 2,
    "C3: both frame records survive as declared units");
  assert.strictEqual(legacy.units.find((unit) => unit.id === "frame:frame-a-legacy").complete, true,
    "C3: and the approval already taken on one of them is still recognised");
  assert.strictEqual(legacyProject.shots[0].clips.length, 1, "C3: the motion unit is untouched");
  assert.strictEqual(legacyProject.shots[0].candidateFiles.length, 1, "C3: the returned candidate is untouched");
  assert.strictEqual(legacyProject.shots[0].keyframes[0].winner, "LEGACY-A.png", "C3: the frame's own pointer is untouched");

  /* C4 — the same legacy shot whose motion unit is a `post` unit, a finishing pass that
     was never a generation. Every frame it carries is historical, and it is asked how
     the shot is made rather than told to buy one. */
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

  note("C. undeclared: a new shot requires no frame, states the decision it is missing rather than a purchase, and never falls through to 'mark this final'; a stored i2v clip declares no route on the shot's behalf and does not make its opening frame current work; a legacy shot whose units name no method owes neither of its frames, and every frame, approval, candidate and clip survives all of it; an optional unit carrying a malformed record still keeps the card, and the project log reports no frame debt either, while the cast the shot declares is still owed");
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
   F — ROUTE DEPENDENCY FRESHNESS, THROUGH THE ONE FRESHNESS OWNER.

   A route is a durable statement about how the shot is delivered, and a motion prompt
   compiles through a different branch with a different endpoint contract for each of
   them. So changing the route changes what an existing motion package was made FOR, and
   that is dependency drift — reported by packageStaleReasons() / packageDependencyDrift()
   like every other dependency, from evidence the package recorded at build time.

   NOTHING HERE IS A SECOND DETECTOR. Every answer below comes out of the shipped
   packageStaleReasons() in a rendered page, or out of the server's
   packageProjectFreshness() in Node — one comparator, two evidence sets.
   =========================================================================== */
function freshnessShot(route) {
  const shot = newShotRecord("SC-01-01", "SC-01", {
    keyframes: [
      { id: "frame-a-new", label: "A", title: "Opening frame A", winner: "HISTORIC-A.png", required: true, generationPackages: [] },
      { id: "frame-b-new", label: "B", title: "Closing frame B", winner: "HISTORIC-B.png", required: true, generationPackages: [] },
    ],
    candidateFiles: [
      { stored: "HISTORIC-A.png", original: "HISTORIC-A.png", decision: "approved", mediaType: "image", frameId: "frame-a-new" },
      { stored: "HISTORIC-B.png", original: "HISTORIC-B.png", decision: "approved", mediaType: "image", frameId: "frame-b-new" },
    ],
    clips: [{ id: "seg-a", suffix: "a", label: "A", title: "Primary motion", dur: 5, kind: "i2v", note: "", motionPrompt: "The ship lifts away.", fromFrame: "frame-a-new", toFrame: "frame-b-new", generationPackages: [], motionPlan: null }],
  });
  if (route) shot.deliveryRoute = route;
  return shot;
}

/* One walk: build a motion package and a frame package under `from`, move the shot to
   `to`, and report what the SHIPPED owner says at each step. `to === ""` withdraws. */
const FRESHNESS_WALK = [
  'const s = P.shots.find((row) => row.id === "SC-01-01");',
  'const unit = s.clips[0];',
  'const motionPack = { id: "pack-motion", segmentId: unit.id, revision: 1, scope: "motion", kind: "motion", profileId: "minimax-h3/i2v", mode: "i2v", dependencySnapshot: null };',
  'const framePack = { id: "pack-frame", frameId: "frame-a-new", revision: 1, scope: "frame", kind: "frame", profileId: "gpt-image-2/t2i", mode: "t2i", dependencySnapshot: null };',
  'unit.generationPackages = [motionPack];',
  's.keyframes[0].generationPackages = [framePack];',
  '/* THE SAVED SNAPSHOT IS THE ONE THE PRODUCT WOULD HAVE RECORDED, taken through the',
  '   shipped writer rather than hand-written — a hand-written one differs from the live',
  '   answer in some field nobody meant to test and "stale" stops meaning anything. */',
  'motionPack.dependencySnapshot = JSON.parse(JSON.stringify(currentSnapshotForPackage(s, motionPack)));',
  'framePack.dependencySnapshot = JSON.parse(JSON.stringify(currentSnapshotForPackage(s, framePack)));',
  'const recordedRoute = { motion: motionPack.dependencySnapshot.deliveryRoute, frame: framePack.dependencySnapshot.deliveryRoute };',
  'const before = { motion: packageStaleReasons(s, motionPack), frame: packageStaleReasons(s, framePack) };',
  'if (TARGET) declareShotRoute(s, TARGET); else clearShotRoute(s);',
  'const after = { motion: packageStaleReasons(s, motionPack), frame: packageStaleReasons(s, framePack) };',
  '/* F — UNRELATED METADATA IS NOT RECORDED DEPENDENCY EVIDENCE. None of these three is',
  '   in any snapshot, so none of them may produce a reason of its own. */',
  's.title = "Renamed shot"; s.notes = "a production note"; s.safe = "safe area";',
  'const unrelated = packageStaleReasons(s, motionPack);',
  'return {',
  '  recordedRoute, before, after, unrelated,',
  '  storedNow: Object.prototype.hasOwnProperty.call(s, "deliveryRoute") ? s.deliveryRoute : null,',
  '  media: { frames: s.keyframes.map((f) => f.winner || ""), candidates: (s.candidateFiles || []).map((c) => c.stored),',
  '           clips: s.clips.length, motionPackages: unit.generationPackages.length, framePackages: s.keyframes[0].generationPackages.length },',
  '};',
].join("\n");

async function checkRouteFreshness() {
  const CASES = [
    { name: "A", from: "i2v", to: "i2v", stale: false },
    { name: "B", from: "i2v", to: "r2v", stale: true },
    { name: "C", from: "flf", to: "r2v", stale: true },
    { name: "D", from: "r2v", to: "i2v", stale: true },
    { name: "E", from: "i2v", to: "", stale: true },
    { name: "G", from: "", to: "i2v", stale: true },
    { name: "H", from: "", to: "", stale: false },
  ];
  const observed = [];
  for (const row of CASES) {
    const project = projectWith(freshnessShot(row.from));
    approveFrame(project, "SC-01-01", "frame-a-new", "HISTORIC-A.png");
    approveFrame(project, "SC-01-01", "frame-b-new", "HISTORIC-B.png");
    const page = await render("#/shot/SC-01-01", project, { scan: scanFor(project) });
    const seen = run(page.context, `const TARGET = ${JSON.stringify(row.to)};\n${FRESHNESS_WALK}`);
    const label = `${row.name}. ${row.from || "undecided"} -> ${row.to || "withdrawn"}`;

    /* The package records the route it was built against, canonically. */
    assert.strictEqual(seen.recordedRoute.motion, row.from,
      `${label}: the motion package must record the route it was compiled against`);
    assert.strictEqual(seen.recordedRoute.frame, undefined,
      `${label}: and a FRAME package must record none — its prompt does not branch on the route`);
    assert.deepStrictEqual(seen.before, { motion: [], frame: [] },
      `${label}: precondition — both packages are fresh before the route moves`);
    assert.strictEqual(seen.storedNow, row.to || null, `${label}: the route change landed on the record`);

    const routeReasons = seen.after.motion.filter((reason) => /delivery route changed/.test(reason));
    if (row.stale) {
      assert.strictEqual(routeReasons.length, 1,
        `${label}: the freshness owner must report exactly one route drift, got ${JSON.stringify(seen.after.motion)}`);
      assert(new RegExp(`compiled for ${row.from ? row.from.toUpperCase() : "NOT DECIDED"}`).test(routeReasons[0]),
        `${label}: naming the route it was compiled for, got ${routeReasons[0]}`);
    } else {
      assert.deepStrictEqual(seen.after.motion, [],
        `${label}: an unchanged route is not drift, got ${JSON.stringify(seen.after.motion)}`);
    }
    /* AFFECTED PACKAGES ONLY. */
    assert.deepStrictEqual(seen.after.frame, [],
      `${label}: a frame package must never be staled by a route change`);
    /* F — and nothing unrecorded may add a reason of its own. */
    assert.deepStrictEqual(seen.unrelated, seen.after.motion,
      `${label}: renaming the shot and editing its notes must fabricate no staleness`);
    /* HISTORICAL MEDIA IS UNTOUCHED BY ANY OF IT. */
    assert.deepStrictEqual(seen.media, {
      frames: ["HISTORIC-A.png", "HISTORIC-B.png"],
      candidates: ["HISTORIC-A.png", "HISTORIC-B.png"],
      clips: 1, motionPackages: 1, framePackages: 1,
    }, `${label}: a stale package is still a package, and no frame, candidate or clip moved`);
    observed.push(`${label}=${row.stale ? "stale" : "fresh"}`);
  }
  note(`F1. route dependency drift, all through packageStaleReasons(): ${observed.join(", ")}; `
    + "frame packages record no route and are never staled by one, and unrelated shot metadata fabricates nothing");
}

/* F2 — THE LEGACY PACKAGE, AND THE RULE THAT ALREADY COVERED IT. A package compiled
   before the route became evidence has no `deliveryRoute` key, and packageDependencyDrift()
   compares a field only when BOTH sides recorded one. No migration, no inferred history,
   no second model — the general rule the comparator already applies to every other key. */
function checkLegacyPackage() {
  const History = require("../public/shared-build-history.js");
  const shot = {
    id: "SH-LEGACY", deliveryRoute: "r2v",
    creationBrief: { motionDuration: 5, motionProfileId: "minimax-h3/i2v" },
    keyframes: [{ id: "frame-a", winner: "A.png" }, { id: "frame-b", winner: "B.png" }],
    clips: [{ id: "seg-a", suffix: "a", kind: "i2v", dur: 5, motionPrompt: "x", fromFrame: "frame-a", toFrame: "frame-b" }],
  };
  const project = { mediaAssets: [] };
  const pack = { id: "p", segmentId: "seg-a", profileId: "minimax-h3/i2v", mode: "i2v" };

  /* Built the way the product builds one now, under i2v, then read under r2v. */
  const builtNow = {
    ...pack,
    dependencySnapshot: {
      ...History.packageProjectInputs(project, shot, pack, History.packageDirection(shot, pack)),
      ...History.packageMotionInputs({ ...shot, deliveryRoute: "i2v" }, pack),
    },
  };
  const current = History.packageProjectFreshness(project, shot, builtNow);
  assert.strictEqual(current.current, false, "F2: the server's evidence set reports the route change too");
  assert(current.reasons.some((reason) => /delivery route changed to R2V/.test(reason)),
    `F2: one comparator, two evidence sets — the server names the same drift, got ${JSON.stringify(current.reasons)}`);

  /* The same package with the route key removed, which is exactly what a package
     compiled before this correction carries. */
  const legacy = { ...pack, dependencySnapshot: { ...builtNow.dependencySnapshot } };
  delete legacy.dependencySnapshot.deliveryRoute;
  const legacyAnswer = History.packageProjectFreshness(project, shot, legacy);
  assert(!legacyAnswer.reasons.some((reason) => /delivery route/.test(reason)),
    `F2: a package that recorded no route is never staled for one, got ${JSON.stringify(legacyAnswer.reasons)}`);
  assert.strictEqual(legacyAnswer.recorded, true,
    "F2: and it is still a package with recorded evidence — the absence is one field, not the snapshot");

  /* CANONICAL, NEVER A SECOND NORMALISER. */
  assert.strictEqual(History.packageMotionInputs({ ...shot, deliveryRoute: "  I2V  " }, pack).deliveryRoute, "i2v",
    "F2: case and surrounding whitespace fold, because the route owner folds them");
  assert.strictEqual(History.packageMotionInputs({ ...shot, deliveryRoute: "GENERATE (FLF)" }, pack).deliveryRoute, "",
    "F2: and a token this build cannot read is absent rather than the nearest valid one");
  assert.strictEqual(History.packageMotionInputs(shot, { id: "f", frameId: "frame-a" }), null,
    "F2: a package with no motion unit gets no motion evidence at all, route included");
  /* THE LOAD ORDER THAT MAKES LATE RESOLUTION NECESSARY, stated so a later reader does
     not "tidy" the route owner into a load-time capture: index.html loads this module
     BEFORE shared-shot-route.js, and F1 above answers correctly from inside a rendered
     page built in exactly that order — which is the executable half of this claim. */
  const indexHtml = readLF("public/index.html");
  assert(indexHtml.indexOf("shared-build-history.js") < indexHtml.indexOf("shared-shot-route.js"),
    "F2: the shipped page still loads shared-build-history.js first, which is why the route owner is read at call time");
  note("F2. legacy: a package that recorded no route is skipped by the comparator's own both-sides rule — "
    + "no migration and no inferred history; the server's evidence set reports the same route drift the browser does; "
    + "an unreadable stored token folds to absent through the one route owner");
}

/* F3 — BOTH TRUTHS, AND THEY ARE DIFFERENT TRUTHS. "This package was built for an
   earlier route" is what the freshness owner says; "this target cannot run under the
   route you have now" is what Slice 5b's execution gate says. The correction adds the
   first without weakening the second, and they agree on the same shot. */
async function checkExecutionCompatibility() {
  const project = projectWith(freshnessShot("i2v"));
  approveFrame(project, "SC-01-01", "frame-a-new", "HISTORIC-A.png");
  const page = await render("#/shot/SC-01-01", project, { scan: scanFor(project) });
  const both = run(page.context, `
    const s = P.shots.find((row) => row.id === "SC-01-01");
    const unit = s.clips[0];
    const profile = { id: "minimax-h3/i2v", mode: "i2v" };
    const pack = { id: "pack-1", segmentId: unit.id, revision: 1, scope: "motion", kind: "motion", profileId: profile.id, mode: "i2v", dependencySnapshot: null };
    unit.generationPackages = [pack];
    pack.dependencySnapshot = JSON.parse(JSON.stringify(currentSnapshotForPackage(s, pack)));
    const underI2v = { executable: !!guidedMotionProfileExecutable(s, profile), stale: packageStaleReasons(s, pack) };
    declareShotRoute(s, "r2v");
    const underR2v = { executable: !!guidedMotionProfileExecutable(s, profile), stale: packageStaleReasons(s, pack),
                       refusal: String(guidedMotionIntentRefusal(s, profile) || "") };
    return { underI2v, underR2v, clips: s.clips.length, packages: unit.generationPackages.length,
             frames: s.keyframes.map((f) => f.winner || "") };`);
  assert.strictEqual(both.underI2v.executable, true, "F3: an i2v target is executable under an i2v route");
  assert.deepStrictEqual(both.underI2v.stale, [], "F3: and its package is fresh");
  assert.strictEqual(both.underR2v.executable, false, "F3: it stops being executable when the route becomes r2v");
  assert(both.underR2v.refusal.length > 0, "F3: and the refusal is a sentence, not a silence");
  assert(both.underR2v.stale.some((reason) => /delivery route changed/.test(reason)),
    `F3: while the freshness owner separately reports the package stale, got ${JSON.stringify(both.underR2v.stale)}`);
  assert.strictEqual(both.clips, 1, "F3: nothing about the motion unit was deleted");
  assert.strictEqual(both.packages, 1, "F3: nor the package — stale is a reading, not a removal");
  assert.deepStrictEqual(both.frames, ["HISTORIC-A.png", "HISTORIC-B.png"], "F3: nor the approved frames");
  note("F3. both truths agree and stay distinct: the package reads STALE because its route dependency changed, "
    + "and the execution gate separately refuses to run the incompatible target — neither deletes the package, "
    + "the clip or the frames");
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
    readiness.indexOf("function declaredDelivery("),
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
  /* AND IT READS NO CLIP EITHER. A stored `kind` is history describing a production
     that already happened, so the declaration predicate consults only the route answer
     and the delivery intent, and names no route or method literal of its own. */
  for (const forbidden of ["clips", "kind", "ANIMATE_METHOD_PROBES"])
    assert(!new RegExp(`\\b${forbidden}\\b`).test(code),
      `G2: the delivery declaration must not read ${forbidden} — history does not declare present intent`);
  for (const token of ['"i2v"', '"flf"', '"t2v"', '"r2v"', "'i2v'", "'flf'"])
    assert(!code.includes(token),
      `G2: the declaration predicate must name no route or method literal, found ${token}`);
  note("G. no inference: six route-shaped shots (approved endpoints, i2v and flf clips, the legacy FLF output plan, a motion intent) rendered through every stage and evaluated, and not one declared a route; the delivery declaration reads no winner, candidate, package, approved file OR clip, and names no route or method literal");
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

/* ===========================================================================
   I — THE shotApprovalComplete() BOUNDARY, PROVED RATHER THAN ASSUMED.

   public/app.js's `shotApprovalComplete()` still reads `frame.required`, the default
   flag no filmmaker-facing control writes. This slice deliberately did not change it,
   and this section is why that is safe: it is a WORKFLOW SIGN-OFF answer — has every
   frame and motion unit this shot carries been approved — and it is ROUTE-INVARIANT.

   It cannot contradict current-route readiness because it never reaches a surface that
   states current-route work. Its only live consumer is confirmActApproveTake()'s
   `workflowStatus` write and the one transient sentence beside it;
   shotStageFacts("review")'s gap text is unreachable, because its only callers are the
   deliberately-inert legacy stage writers.

   If any of that stops being true, this section fails before the boundary becomes a
   product defect.
   =========================================================================== */
function approvalBoundaryShot(route) {
  const shot = newShotRecord("SC-01-01", "SC-01", {
    keyframes: [
      { id: "frame-a-new", label: "A", title: "Opening frame A", winner: "A.png", required: true, generationPackages: [] },
      { id: "frame-b-new", label: "B", title: "Closing frame B", winner: null, required: true, generationPackages: [] },
    ],
  });
  if (route) shot.deliveryRoute = route;
  return shot;
}

async function checkApprovalBoundary() {
  const seen = {};
  for (const route of ["", "i2v", "r2v", "t2v"]) {
    const project = projectWith(approvalBoundaryShot(route));
    const page = await render("#/shot/SC-01-01", project, { scan: scanFor(project) });
    seen[route || "undeclared"] = run(page.context, `
      const s = P.shots.find((row) => row.id === "SC-01-01");
      const readiness = shotReadinessFor(s);
      const main = String(document.getElementById("main").innerHTML || "");
      return {
        approvalComplete: !!shotApprovalComplete(s),
        legacyRequiredFrames: (s.keyframes || []).filter((f) => f.required !== false).length,
        readinessRequiredFrames: readiness.units.filter((u) => u.kind === "frame" && u.required).length,
        readinessAction: readiness.nextAction.code,
        /* Every persistent frame-debt sentence the shipped workspace can print. */
        framesDebtOnScreen: /Produce the frame|Produce Frame|Approve required frames|still to approve/i.test(main),
        requiredFramesTile: (main.match(/Required frames<\\/span><b>([^<]*)<\\/b>/) || [, ""])[1],
      };`);
  }

  /* I1 — IT DOES NOT VARY WITH THE ROUTE. Same frames, four routes, one answer: this is
     a question about the shot's retained work, not about the route's requirements. */
  const answers = [...new Set(Object.values(seen).map((row) => row.approvalComplete))];
  assert.deepStrictEqual(answers, [false],
    `I1: shotApprovalComplete() must be route-invariant, got ${JSON.stringify(Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, v.approvalComplete])))}`);
  const legacyCounts = [...new Set(Object.values(seen).map((row) => row.legacyRequiredFrames))];
  assert.deepStrictEqual(legacyCounts, [2], "I1: and it counts the same retained frames under every route");

  /* I2 — READINESS IS UNAFFECTED BY IT, and disagrees with it on purpose. */
  assert.strictEqual(seen.i2v.readinessRequiredFrames, 1, "I2: i2v owes its opening frame");
  assert.strictEqual(seen.r2v.readinessRequiredFrames, 0, "I2: r2v owes none");
  assert.strictEqual(seen.t2v.readinessRequiredFrames, 0, "I2: nor does t2v");
  assert.strictEqual(seen.undeclared.readinessRequiredFrames, 0, "I2: nor does an undeclared shot");

  /* I3 — AND NO PERSISTENT SURFACE CARRIES THE LEGACY ANSWER. The i2v row is what makes
     this a measurement: the same detector finds frame debt there, where a route really
     does ask for a frame. */
  assert.strictEqual(seen.i2v.framesDebtOnScreen, true,
    "I3: precondition — the detector must find frame debt where a route genuinely owes one");
  for (const route of ["r2v", "t2v", "undeclared"]) {
    assert.strictEqual(seen[route].framesDebtOnScreen, false,
      `I3: ${route} owes no frame, and no rendered surface may say otherwise while shotApprovalComplete() is false`);
    assert.strictEqual(seen[route].requiredFramesTile, "0/0",
      `I3: ${route}: the command summary counts readiness's zero, not the legacy two`);
  }

  /* I4 — THE UNREACHABLE CONSUMER STAYS UNREACHABLE. shotStageFacts("review") pushes
     "Approve the required frame and motion outputs." off shotApprovalComplete(), and
     that sentence can only surface through the legacy stage writers, which
     tests/stage-model.js already pins as callerless. Asserted here too, because THIS
     slice is the one that made the legacy count differ from the current one. */
  const shell = readLF("public/app.js");
  const code = shell.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const writer of ["approveShotStage", "markShotStageNotNeeded"]) {
    const uses = (code.match(new RegExp(`\\b${writer}\\b`, "g")) || []).length;
    assert.strictEqual(uses, 1,
      `I4: ${writer} must remain a declaration with no caller, found ${uses} occurrences`);
  }
  const consumers = [...new Set((code.match(/shotApprovalComplete\(/g) || []))].length;
  assert(consumers > 0, "I4: precondition — the helper must still exist to be bounded");
  note("I. approval boundary: shotApprovalComplete() is route-invariant (false under undeclared, i2v, r2v and t2v "
    + "with the same two retained frames) and reaches no persistent surface — r2v, t2v and an undeclared shot all "
    + "render 0/0 required frames and no frame-debt sentence, while the same detector finds one under i2v. It stays "
    + "a workflow sign-off answer; its unreachable gap text is still unreachable. Left unchanged deliberately.");
}

/* ===========================================================================
   J — HISTORY DOES NOT DECLARE PRESENT INTENT.

   A Codex review demonstrated the leak this section exists to close. A legacy shot
   carries what a production left behind: a stored `post` clip that was a finishing
   pass, a `reuse` clip that pointed at footage made elsewhere, an old approved frame,
   a candidate, a receipt. `declaredUnits()` read every stored clip as a REQUIRED
   current unit, so an undeclared shot reported

       READY · Produce Motion using t2v

   choosing an execution method from a shot that had chosen none — and an old approved
   frame fell through the rollup to `mark-shot-final`, skipping the route question
   entirely.

   THE RULE, and it is one predicate: a route-dependent unit is owed only where the
   shot has DECLARED a delivery. Historical media is preserved, evaluated and rendered;
   it is simply not current work. Route-INDEPENDENT obligations — a record-integrity
   decision, a declared cast reference — still outrank it, because this correction is
   "an undeclared route disables route-dependent execution interpretation", not "an
   undeclared shot ignores every unit".
   =========================================================================== */

/* THE ACTIONS THAT ASSUME A CURRENT EXECUTION ROUTE. Not a blacklist the derivation
   consults — the derivation expresses this structurally through unit requiredness —
   but the list this suite AUDITS against, so a future action code that quietly assumes
   a route is caught by the matrix below rather than by a filmmaker. */
const ROUTE_DEPENDENT_ACTIONS = ["produce-frame", "produce-motion", "approve-required-frames", "approve-parent-frame", "mark-shot-final"];

const historyClip = (kind) => ({
  id: `seg-${kind}`, suffix: "a", label: "A", title: `${kind} unit`, kind, dur: 5,
  note: "", motionPrompt: "the old direction", fromFrame: "frame-a-legacy", toFrame: "",
  generationPackages: [], motionPlan: null,
});

/* A legacy shot, built only from what a project made before the route field existed.
   `extra` supplies the historical artefacts under test. */
function historyShot(id, extra = {}) {
  return newShotRecord(id, "SC-01", {
    title: "Legacy dock shot",
    status: "BUILT",
    workflowStatus: "IN PROGRESS",
    keyframes: [{ id: "frame-a-legacy", label: "A", title: "Opening frame A", winner: null, required: true, generationPackages: [] }],
    clips: [],
    candidateFiles: [],
    creationBrief: { locationId: "", propIds: [], mode: "auto", promptBuilds: [] },
    ...extra,
  });
}
const APPROVED_FRAME = {
  keyframes: [{ id: "frame-a-legacy", label: "A", title: "Opening frame A", winner: "LEGACY-A.png", required: true, generationPackages: [] }],
};

/* THE ORACLE MATTERS HERE. Without one, a receipt whose file cannot be resolved is
   itself a decision (`establish-media-availability`) and would mask the route answer
   under test. Supplying the listing the shot's media really is isolates the question. */
const historyOracle = { mediaListing: () => [{ name: "LEGACY-A.png", url: "/assets/LEGACY-A.png" }], shotMediaListing: () => [] };

function historyState(project, id) {
  const row = readinessOf(project, id, historyOracle);
  const shot = project.shots.find((s) => s.id === id);
  return {
    reading: Route.readShotRoute(shot).reading,
    storedRoute: Object.prototype.hasOwnProperty.call(shot, "deliveryRoute") ? shot.deliveryRoute : null,
    action: row.nextAction.code,
    status: row.status,
    requiredFrames: row.units.filter((u) => u.kind === "frame" && u.required).length,
    requiredMotion: row.units.filter((u) => u.kind === "motion" && u.required).length,
    units: row.units.map((u) => u.id).sort(),
    unitActions: row.units.map((u) => u.nextAction?.code || "").filter(Boolean),
    media: {
      frames: shot.keyframes.map((f) => `${f.id}:${f.winner || ""}`),
      clips: (shot.clips || []).map((c) => `${c.id}:${c.kind}`),
      candidates: (shot.candidateFiles || []).map((c) => c.stored),
      receipt: Kernel.hasCurrentHumanAuthority(project, { kind: "shot-frame", shotId: id, frameId: "frame-a-legacy" }),
    },
  };
}

function checkHistoricalMedia() {
  const SHAPES = [
    ["A. a stored post clip", { clips: [historyClip("post")] }, false],
    ["B. a stored reuse clip", { clips: [historyClip("reuse")] }, false],
    ["   a stored hold clip", { clips: [historyClip("hold")] }, false],
    ["   a stored plan clip", { clips: [historyClip("plan")] }, false],
    ["   a stored i2v clip", { clips: [historyClip("i2v")] }, false],
    ["   a stored flf clip", { clips: [historyClip("flf")] }, false],
    ["C. an old approved frame", APPROVED_FRAME, true],
    ["D. approved frame + post clip + candidate", {
      ...APPROVED_FRAME,
      clips: [historyClip("post")],
      candidateFiles: [{ stored: "LEGACY-A.png", original: "LEGACY-A.png", decision: "approved", mediaType: "image", frameId: "frame-a-legacy" }],
    }, true],
  ];

  const observed = [];
  for (const [name, extra, approve] of SHAPES) {
    const project = projectWith(historyShot("SC-01-09", extra));
    if (approve) approveFrame(project, "SC-01-09", "frame-a-legacy", "LEGACY-A.png");
    const before = JSON.stringify(historyState(project, "SC-01-09").media);
    const seen = historyState(project, "SC-01-09");

    /* The route is untouched, and nothing derived one. */
    assert.strictEqual(seen.reading, "absent", `J1 ${name}: the shot must still read as undeclared`);
    assert.strictEqual(seen.storedRoute, null, `J1 ${name}: and carry no deliveryRoute key`);

    /* NO ROUTE-DEPENDENT CURRENT WORK, from the requiredness upward. */
    assert.strictEqual(seen.requiredFrames, 0, `J1 ${name}: no frame may be required`);
    assert.strictEqual(seen.requiredMotion, 0, `J1 ${name}: no motion unit may be required`);
    assert(!ROUTE_DEPENDENT_ACTIONS.includes(seen.action),
      `J1 ${name}: the next action assumes a route CineBraid was never given: ${seen.action}`);
    assert.strictEqual(seen.action, "declare-shot-route",
      `J1 ${name}: with no route-independent obligation the answer is the route question, got ${seen.action}`);
    assert.strictEqual(seen.status, "NEEDS_DECISION", `J1 ${name}: and it is a decision`);

    /* THE MEDIA IS STILL THERE, and still evaluated: the units exist, they are simply
       not owed. A correction that deleted or hid history would pass the assertions
       above and fail these. */
    assert(seen.units.length >= 1, `J1 ${name}: the historical media is still declared as units`);
    assert.strictEqual(JSON.stringify(seen.media), before, `J1 ${name}: and nothing about it moved`);
    if (approve) assert.strictEqual(seen.media.receipt, true, `J1 ${name}: the approval receipt survives`);
    observed.push(`${name.trim()} -> ${seen.action}`);
  }
  note("J1. historical media on an undeclared shot: " + observed.join("; ")
    + " — every one preserved, none required, and not one of "
    + ROUTE_DEPENDENT_ACTIONS.join("/") + " emitted");
}

/* J2 — THE SAME LEGACY FIXTURES, GIVEN A ROUTE. The explicit declaration is what
   changes the current interpretation, and it changes only the requirements. */
function checkHistoryThenDeclaration() {
  const walked = [];
  for (const route of ROUTES) {
    const project = projectWith(historyShot("SC-01-09", {
      ...APPROVED_FRAME,
      keyframes: [
        { id: "frame-a-legacy", label: "A", title: "Opening frame A", winner: "LEGACY-A.png", required: true, generationPackages: [] },
        { id: "frame-b-legacy", label: "B", title: "Closing frame B", winner: "LEGACY-B.png", required: true, generationPackages: [] },
      ],
      clips: [historyClip("post")],
      candidateFiles: [{ stored: "LEGACY-A.png", original: "LEGACY-A.png", decision: "approved", mediaType: "image", frameId: "frame-a-legacy" }],
    }));
    approveFrame(project, "SC-01-09", "frame-a-legacy", "LEGACY-A.png");
    const shot = project.shots[0];

    const undeclared = historyState(project, "SC-01-09");
    assert.strictEqual(undeclared.action, "declare-shot-route", `J2 ${route}: precondition — it starts undeclared`);

    assert(Route.declareShotRoute(shot, route).ok, `J2 ${route}: declarable`);
    const declared = historyState(project, "SC-01-09");
    assert.strictEqual(declared.requiredFrames, frameNeedsOf(route).length,
      `J2 ${route}: the declaration brings exactly its canonical frame roles, and only those`);
    assert.strictEqual(declared.requiredMotion, 1,
      `J2 ${route}: and the shot's motion unit becomes current work`);
    assert.notStrictEqual(declared.action, "declare-shot-route",
      `J2 ${route}: the question has been answered, so it is not asked again`);
    assert.deepStrictEqual(declared.media, undeclared.media,
      `J2 ${route}: declaring a route moves requirements, never media`);
    assert.deepStrictEqual(declared.units, undeclared.units,
      `J2 ${route}: and declares no new unit — the same records, differently owed`);

    Route.clearShotRoute(shot);
    const withdrawn = historyState(project, "SC-01-09");
    assert.strictEqual(withdrawn.requiredFrames, 0, `J2 ${route}: withdrawing removes the route's frame requirements`);
    assert.strictEqual(withdrawn.requiredMotion, 0, `J2 ${route}: and its motion requirement`);
    assert.strictEqual(withdrawn.action, "declare-shot-route",
      `J2 ${route}: and the shot returns to the undeclared answer rather than to a CTA the media suggests`);
    assert.deepStrictEqual(withdrawn.media, undeclared.media, `J2 ${route}: with the media still untouched`);
    walked.push(`${route}:0->${declared.requiredFrames}->0`);
  }
  note("J2. the same legacy fixture declared and withdrawn, frames required at each step — "
    + walked.join(", ") + "; the declaration changes the interpretation, the media never moves, "
    + "and withdrawal returns to the route question rather than to a CTA the history suggests");
}

/* J3 — ROUTE-INDEPENDENT OBLIGATIONS STILL OUTRANK IT, and a declared delivery still
   reaches its own conclusion. This is the half the correction must NOT break. */
function checkRouteIndependentStillCounts() {
  /* A record-integrity decision on a unit nothing requires. */
  const malformed = projectWith(historyShot("SC-01-09", {
    clips: [historyClip("post")],
    creationBrief: {
      locationId: "", propIds: [], mode: "auto", promptBuilds: [],
      frameWorkflows: { "frame-a-legacy": { entityPresence: { KAI: { state: "absent" } } } },
    },
  }));
  const malformedSeen = historyState(malformed, "SC-01-09");
  assert.strictEqual(malformedSeen.requiredFrames, 0, "J3: precondition — nothing requires the frame");
  assert.strictEqual(malformedSeen.action, "repair-presence-declaration",
    `J3: a corrupted record outranks the route question, got ${malformedSeen.action}`);

  /* A declared cast whose reference nobody has approved: a DECISION on a unit nothing
     requires. */
  const cast = projectWith(historyShot("SC-01-09", { characters: ["KAI"], codes: ["LOC-HULL"], clips: [historyClip("post")] }));
  const castSeen = historyState(cast, "SC-01-09");
  assert.strictEqual(castSeen.requiredFrames, 0, "J3: precondition — the cast shot still requires no frame");
  assert.notStrictEqual(castSeen.action, "declare-shot-route",
    "J3: a declared input the production cannot supply outranks the route question");
  assert(!ROUTE_DEPENDENT_ACTIONS.includes(castSeen.action),
    `J3: and the obligation it raises is not route-dependent either, got ${castSeen.action}`);

  /* And the other kind: a cast member with NO approved file anywhere. That is a plain
     MISSING requirement rather than a decision, so it reaches the shot only through the
     declared-input crossing — the half that stops this correction from becoming "an
     undeclared shot ignores every unit". */
  const unsupplied = projectWith(historyShot("SC-01-09", { characters: ["KAI"], clips: [historyClip("post")] }));
  for (const entity of unsupplied.characters || []) { entity.approvedFile = ""; entity.continuityStates = []; entity.candidateFiles = []; }
  const unsuppliedSeen = historyState(unsupplied, "SC-01-09");
  assert.strictEqual(unsuppliedSeen.requiredFrames + unsuppliedSeen.requiredMotion, 0,
    "J3: precondition — nothing about the undeclared shot is required");
  assert.strictEqual(unsuppliedSeen.action, "prepare-references",
    `J3: a declared input the production cannot supply is still owed, got ${unsuppliedSeen.action}`);
  assert(!ROUTE_DEPENDENT_ACTIONS.includes(unsuppliedSeen.action),
    "J3: and that obligation is route-independent");

  /* A declared STILL delivery reaches mark-shot-final exactly as it always did — the
     gate is the declaration, and a still shot can never declare a route. */
  const still = projectWith(historyShot("SC-01-09", {
    ...APPROVED_FRAME,
    creationBrief: { locationId: "", propIds: [], mode: "auto", deliveryIntent: "still", promptBuilds: [] },
  }));
  approveFrame(still, "SC-01-09", "frame-a-legacy", "LEGACY-A.png");
  const stillSeen = historyState(still, "SC-01-09");
  assert.strictEqual(stillSeen.requiredFrames, 1, "J3: a declared still delivery still owes its opening frame");
  assert.strictEqual(stillSeen.action, "mark-shot-final",
    `J3: and once approved it reaches the delivery decision, got ${stillSeen.action}`);

  /* A declared MOTION delivery owes its motion unit, undeclared route or not. */
  const motion = projectWith(historyShot("SC-01-09", {
    clips: [historyClip("post")],
    creationBrief: { locationId: "", propIds: [], mode: "auto", deliveryIntent: "motion", promptBuilds: [] },
  }));
  const motionSeen = historyState(motion, "SC-01-09");
  assert.strictEqual(motionSeen.requiredMotion, 1, "J3: a declared motion delivery owes its motion unit");
  assert.notStrictEqual(motionSeen.action, "declare-shot-route",
    "J3: so it is not asked the route question in place of its own work");
  note("J3. route-independent truth is untouched: a malformed presence declaration outranks the route question "
    + `(${malformedSeen.action}), an unconfirmed cast pointer raises its own decision (${castSeen.action}), a cast `
    + `member with no approved file anywhere is still owed through the declared-input crossing `
    + `(${unsuppliedSeen.action}), a declared still delivery still reaches ${stillSeen.action}, and a declared `
    + "motion delivery still owes its motion unit");
}


/* ===========================================================================
   K — A STILL-ONLY DELIVERY DOES NOT IMPLY MOTION.

   The second Codex review's first blocker, and a boundary between two of the four
   answers declaredDelivery() gives. Motion requiredness asked `!!delivery` — "has this
   shot declared ANYTHING" — so a shot whose filmmaker had explicitly declared a
   STILL-ONLY delivery, carrying one historical `post` clip, went from mark-shot-final
   to READY · "Produce Motion a using i2v". The clip changed the delivery.

   A still declaration is a statement that motion is NOT owed. Reading it as one that
   motion IS owed is the same class of defect as reading a stored clip as a declaration,
   one field along — and the fix is not "stored clips are never required", which would
   take motion away from the shots that genuinely owe it.
   =========================================================================== */
const STILL_BRIEF = { locationId: "", propIds: [], mode: "auto", deliveryIntent: "still", promptBuilds: [] };

/* A still-only shot with its opening frame approved: the shape that reaches the delivery
   decision, so anything that moves it is attributable to what was added. */
function stillDeliveryProject(extra = {}) {
  const project = projectWith(historyShot("SC-01-09", {
    ...APPROVED_FRAME,
    creationBrief: { ...STILL_BRIEF },
    ...extra,
  }));
  approveFrame(project, "SC-01-09", "frame-a-legacy", "LEGACY-A.png");
  return project;
}

function checkStillDeliveryMotion() {
  /* K/A — the still shot with NO historical clip. Every case below is compared to this
     one, so "the clip changed nothing" is measured rather than asserted twice. */
  const baseline = historyState(stillDeliveryProject(), "SC-01-09");
  assert.strictEqual(baseline.requiredFrames, 1, "KA: a declared still delivery owes its opening frame");
  assert.strictEqual(baseline.requiredMotion, 0, "KA: and owes no motion — there is none, and none is declared");
  assert.strictEqual(baseline.action, "mark-shot-final",
    `KA: with the approval taken it reaches the delivery decision, got ${baseline.action}`);

  /* K/B and K/C — the same shot carrying each historical clip kind in turn, then all of
     them at once. The `post` clip is the one the review reproduced. */
  const KINDS = ["post", "reuse", "hold", "plan", "i2v", "flf"];
  const walked = [];
  for (const kind of [...KINDS, "all"]) {
    const clips = kind === "all" ? KINDS.map(historyClip) : [historyClip(kind)];
    const project = stillDeliveryProject({ clips });
    const seen = historyState(project, "SC-01-09");
    walked.push(`${kind}:${seen.action}`);
    assert.strictEqual(seen.requiredMotion, 0,
      `KB ${kind}: a still delivery must owe no motion, ${seen.requiredMotion} required`);
    assert.strictEqual(seen.requiredFrames, baseline.requiredFrames,
      `KB ${kind}: and the frame requirement must not move either`);
    assert.strictEqual(seen.action, baseline.action,
      `KB ${kind}: the current readiness must be the no-clip answer (${baseline.action}), got ${seen.action}`);
    assert(!["produce-motion", "produce-frame"].includes(seen.action),
      `KB ${kind}: and it must never be a production CTA, got ${seen.action}`);
    /* THE CLIPS ARE STILL THERE, and still declared units — preserved, not required. */
    assert.deepStrictEqual(seen.media.clips, clips.map((clip) => `${clip.id}:${clip.kind}`),
      `KB ${kind}: every historical clip must survive verbatim`);
    assert.strictEqual(seen.units.filter((id) => id.startsWith("motion:")).length, clips.length,
      `KB ${kind}: and each must still be a declared unit`);
    assert.strictEqual(seen.media.receipt, true, `KB ${kind}: the approval receipt is untouched`);
  }

  /* K/D — a genuine current obligation still surfaces past the historical motion. The
     still fix must not become "a still shot owes nothing", which is the same silence
     this slice removed from the undeclared shot. Both crossings are covered, because a
     cast member with an unconfirmed pointer and one with no approved file anywhere
     arrive by different paths. */
  const cast = stillDeliveryProject({ clips: [historyClip("post")], characters: ["KAI"] });
  const castSeen = historyState(cast, "SC-01-09");
  assert.strictEqual(castSeen.requiredMotion, 0, "KD: still no motion is owed");
  assert.strictEqual(castSeen.action, "confirm-existing-reference",
    `KD: an unconfirmed cast pointer still outranks the delivery decision, got ${castSeen.action}`);

  const unsupplied = stillDeliveryProject({ clips: [historyClip("post")], characters: ["KAI"] });
  for (const entity of unsupplied.characters || []) { entity.approvedFile = ""; entity.continuityStates = []; entity.candidateFiles = []; }
  const unsuppliedSeen = historyState(unsupplied, "SC-01-09");
  assert.strictEqual(unsuppliedSeen.requiredMotion, 0, "KD: and still no motion is owed here either");
  assert.strictEqual(unsuppliedSeen.action, "supply-approved-media",
    `KD: a cast member the production cannot supply is still owed, got ${unsuppliedSeen.action}`);
  for (const seen of [castSeen, unsuppliedSeen])
    assert.notStrictEqual(seen.action, baseline.action,
      "KD: a genuine current obligation must displace the delivery decision, not be swallowed by it");

  /* K/E — THE REGRESSION THAT MATTERS MOST: every declared route still owes its motion.
     Same fixture, same historical clip, one declaration added. */
  const routes = [];
  for (const route of ROUTES) {
    const project = stillDeliveryProject({
      clips: [historyClip("post")],
      creationBrief: { locationId: "", propIds: [], mode: "auto", promptBuilds: [] },
      deliveryRoute: route,
    });
    const seen = historyState(project, "SC-01-09");
    routes.push(`${route}:${seen.requiredMotion}`);
    assert.strictEqual(seen.requiredMotion, 1,
      `KE ${route}: a declared route still owes its motion unit, got ${seen.requiredMotion}`);
    assert.notStrictEqual(seen.action, "declare-shot-route",
      `KE ${route}: and is not asked the route question again`);
  }

  /* K/F — and so does an explicit motion delivery, in BOTH shipped dialects, whether or
     not a clip exists to carry it. No new vocabulary: these are the two values
     public/app.js and shared-authority-kernel.js already write. */
  const dialects = [];
  for (const intent of ["motion", "video"])
    for (const clips of [[], [historyClip("post")]]) {
      const project = stillDeliveryProject({
        clips,
        creationBrief: { locationId: "", propIds: [], mode: "auto", deliveryIntent: intent, promptBuilds: [] },
      });
      const seen = historyState(project, "SC-01-09");
      dialects.push(`${intent}${clips.length ? "+clip" : ""}:${seen.action}`);
      assert.strictEqual(seen.requiredMotion, 1,
        `KF ${intent}: an explicit motion delivery owes its motion unit, got ${seen.requiredMotion}`);
      assert.strictEqual(seen.action, "produce-motion",
        `KF ${intent}: and its next action is the motion work, got ${seen.action}`);
    }

  /* K/G — a route and a still intent on the same record. The route is the more specific
     and more current statement, so it wins; this is asserted so the precedence is a
     decision rather than an accident of ordering. */
  const contradiction = stillDeliveryProject({ clips: [historyClip("post")], deliveryRoute: "i2v" });
  const contradictionSeen = historyState(contradiction, "SC-01-09");
  assert.strictEqual(contradictionSeen.requiredMotion, 1,
    "KG: a declared route outranks a stale still intent on the same record");

  note("K. a declared still delivery does not imply motion: with no clip it reaches "
    + `${baseline.action}, and with each historical clip it reaches the same (${walked.join(", ")}), `
    + "every clip preserved as a declared unit that nothing requires; a genuine cast obligation still "
    + `crosses (${castSeen.action}, ${unsuppliedSeen.action}); every declared route still owes its motion `
    + `(${routes.join(", ")}) and so does each explicit motion dialect (${dialects.join(", ")})`);
}

/* ===========================================================================
   L — RETAINED MOTION WORK IS VISIBLE WHILE NEW MOTION IS REFUSED.

   The second blocker. "May the filmmaker SEE retained motion work" and "may the
   filmmaker CREATE new motion under current intent" are different questions, and the
   panel was answering only the second: an undeclared legacy shot carrying a written
   direction and a compiled motion prompt — real work, saved in the project file —
   rendered as a locked shell with no body. Resume reached the workspace and the
   workspace was empty.
   =========================================================================== */
const MOTION_DIRECTION = "The courier steps back and the parcel settles.";
const COMPILED_MOTION = "COMPILED-MOTION: a slow push-in as the courier releases the parcel.";
/* Every control that would produce motion, named as it appears in the shipped markup. */
const MOTION_PRODUCTION_CONTROLS = ["buildGuidedMotionPrompt", "falH3MotionPromptAction", "openGuidedMotionPromptEditor", "REBUILD MOTION PROMPT", "Build prompt"];

function motionHistoryProject({ direction = MOTION_DIRECTION, compiled = COMPILED_MOTION, route = "", intent = "" } = {}) {
  const project = projectWith(historyShot("SC-01-09", {
    clips: [{ ...historyClip("post"), motionPrompt: direction }],
    creationBrief: {
      locationId: "", propIds: [], mode: "auto", promptBuilds: [],
      ...(intent ? { deliveryIntent: intent } : {}),
      ...(compiled ? { motionPromptBuilds: [{ buildId: "b-motion-legacy", kind: "guided-motion" }] } : {}),
    },
  }));
  if (route) project.shots[0].deliveryRoute = route;
  project.promptBuildsById = project.promptBuildsById && typeof project.promptBuildsById === "object" ? project.promptBuildsById : {};
  project.promptSnapshotsById = project.promptSnapshotsById && typeof project.promptSnapshotsById === "object" ? project.promptSnapshotsById : {};
  if (compiled)
    project.promptBuildsById["b-motion-legacy"] = {
      id: "b-motion-legacy", packageId: "S-01-A-M01", prompt: compiled, kind: "guided-motion",
      scope: "motion:seg-post", profileId: "minimax-h3/i2v", profileName: "MiniMax Hailuo 3",
      references: [], revision: 1, revisionReason: "compiled", durationSeconds: 5,
    };
  return project;
}

/* The Motion workspace as the filmmaker resumes onto it, read out of the rendered page.
   `scan` decides whether a returned video exists, which is the only difference between
   the two history cases the review asked for. */
async function motionWorkspaceState(project, { videos = [], resume = true } = {}) {
  const scan = scanFor(project);
  scan.shots["SC-01-09"] = { takes: videos.map((name) => ({ name, url: `/assets/shots/SC-01-09/takes/${name}` })), locked: [] };
  const page = await render("#/shot/SC-01-09", project, {
    scan,
    /* THE SAVED RESUME SELECTION, in the shipped key. An ORDINARY open still follows the
       stage model's own recommendation; an explicit Resume must still land on the work,
       and the two must not become one answer. */
    storage: resume ? { "cinebraid-focused:fixture:shot-task:SC-01-09": "motion" } : {},
  });
  return run(page.context, `
    const s = P.shots.find((row) => row.id === "SC-01-09");
    const main = String(document.getElementById("main").innerHTML || "");
    const panel = (main.match(/<details[^>]*data-guided-panel="motion"[\\s\\S]*$/) || [""])[0];
    return {
      task: boundedShotSelectedTask(s, takesFor("SC-01-09")),
      action: shotReadinessFor(s).nextAction.code,
      storedRoute: Object.prototype.hasOwnProperty.call(s, "deliveryRoute") ? s.deliveryRoute : null,
      requiredMotion: shotReadinessFor(s).units.filter((u) => u.kind === "motion" && u.required).length,
      clips: (s.clips || []).map((c) => c.id + ":" + c.kind),
      motionStage: shotStageState("motion", shotStageModelFacts(s, takesFor("SC-01-09"))).availability,
      panelPresent: /data-guided-panel="motion"/.test(main),
      historyPanel: /data-motion-history="retained"/.test(main),
      lockedShell: /guided-motion-card locked/.test(main),
      panelOpen: /data-motion-history="retained" open/.test(main),
      directionOnScreen: main.includes(${JSON.stringify(MOTION_DIRECTION)}),
      compiledOnScreen: main.includes(${JSON.stringify(COMPILED_MOTION)}),
      productionControls: ${JSON.stringify(MOTION_PRODUCTION_CONTROLS)}.filter((needle) => panel.includes(needle)),
      primaryAction: (main.match(/openShotReadinessAction\\('SC-01-09','([a-z-]+)'\\)/) || [, ""])[1],
    };`);
}

async function checkRetainedMotionHistory() {
  /* L/A — HISTORICAL PROMPTS AND NO RETURNED VIDEO: the exact reproduction. */
  const historyOnly = await motionWorkspaceState(motionHistoryProject());
  assert.strictEqual(historyOnly.task, "motion", "LA: the saved Resume selection still reaches the Motion workspace");
  assert.strictEqual(historyOnly.panelPresent, true, "LA: and the Motion panel is on screen");
  assert.strictEqual(historyOnly.directionOnScreen, true,
    "LA: the motion direction saved on the shot must be visible, not withheld with the generator");
  assert.strictEqual(historyOnly.compiledOnScreen, true, "LA: and so must the compiled motion prompt");
  assert.strictEqual(historyOnly.historyPanel, true, "LA: through the retained-work panel");
  assert.strictEqual(historyOnly.panelOpen, true, "LA: which is open, because the retained work is the only thing in it");
  assert.strictEqual(historyOnly.lockedShell, false, "LA: and not the empty locked shell");
  /* READ-ONLY MEANS READ-ONLY. */
  assert.deepStrictEqual(historyOnly.productionControls, [],
    `LA: no control that would produce motion may appear, found ${historyOnly.productionControls.join(", ")}`);
  assert.strictEqual(historyOnly.requiredMotion, 0, "LA: nothing about the undeclared shot is required");
  /* NO CURRENT-ACTION LEAK: viewing history changes neither the route nor the answer. */
  assert.strictEqual(historyOnly.storedRoute, null, "LA: viewing history declares no route");
  assert.strictEqual(historyOnly.action, "declare-shot-route",
    `LA: and the canonical current action is still the route question, got ${historyOnly.action}`);
  assert.strictEqual(historyOnly.primaryAction, "declare-shot-route",
    "LA: which is what the workspace puts in front of the filmmaker");
  assert.deepStrictEqual(historyOnly.clips, ["seg-post:post"], "LA: with the historical clip untouched");

  /* L/B — HISTORICAL PROMPTS PLUS A RETURNED VIDEO. Codex confirmed returned video stays
     reviewable; the retained prompts must be visible in that state too, and neither may
     authorise new generation. */
  const withVideo = await motionWorkspaceState(motionHistoryProject(), { videos: ["LEGACY-MOTION.mp4"] });
  assert.strictEqual(withVideo.directionOnScreen, true, "LB: the retained direction is visible beside a returned video");
  assert.strictEqual(withVideo.compiledOnScreen, true, "LB: and so is the compiled prompt");
  assert(/LEGACY-MOTION\.mp4/.test(JSON.stringify(withVideo)) || withVideo.panelPresent,
    "LB: and the returned video keeps its own review path");
  assert.deepStrictEqual(withVideo.productionControls, [],
    `LB: still no control that would produce motion, found ${withVideo.productionControls.join(", ")}`);
  assert.strictEqual(withVideo.action, "declare-shot-route", "LB: and the current action is unchanged");

  /* L/C — NOTHING RETAINED. A shot with no written direction and no compiled prompt has
     nothing to show, and the shipped locked shell is unchanged for it: this correction
     exposes retained work and invents none. */
  const empty = await motionWorkspaceState(motionHistoryProject({ direction: "", compiled: "" }));
  assert.strictEqual(empty.historyPanel, false, "LC: a shot with no retained motion work gets no history panel");
  assert.strictEqual(empty.lockedShell, true, "LC: it keeps the shipped locked shell");
  assert.deepStrictEqual(empty.productionControls, [], "LC: and offers no production control either");

  /* L/D — AND DECLARING A ROUTE BRINGS THE REAL WORKSPACE BACK. The history view is a
     consequence of current intent, not a new mode a shot can get stuck in. */
  const declared = await motionWorkspaceState(motionHistoryProject({ intent: "motion" }));
  assert.strictEqual(declared.requiredMotion, 1, "LD: an explicit motion delivery owes its motion unit again");
  assert.strictEqual(declared.historyPanel, false, "LD: so the read-only history view steps aside");
  assert(declared.productionControls.length > 0,
    "LD: and the ordinary motion controls are available again");
  assert.strictEqual(declared.directionOnScreen, true, "LD: with the same retained direction still on screen");

  /* L/E — RESUME AND AN ORDINARY OPEN STAY DIFFERENT. Nothing here promotes the Motion
     stage: without the saved selection the same shot opens where the declared stage model
     recommends, which is how the accepted intent hierarchy is preserved. */
  const ordinary = await motionWorkspaceState(motionHistoryProject(), { resume: false });
  assert.notStrictEqual(ordinary.task, "motion",
    `LE: an ordinary open must not be turned into a Resume, got ${ordinary.task}`);
  assert.strictEqual(ordinary.action, "declare-shot-route",
    "LE: and it answers with the same current action either way");

  note("L. retained motion work is visible while new motion is refused: an undeclared legacy shot resumed "
    + `onto Motion shows its saved direction and compiled prompt read-only (${historyOnly.productionControls.length} `
    + `production controls), with the route still absent and ${historyOnly.primaryAction} still the current action; `
    + "the same holds beside a returned video; a shot with nothing retained keeps the shipped locked shell; "
    + `declaring a motion delivery restores the ordinary workspace; and without the saved selection the same shot `
    + `opens on ${ordinary.task}, so Resume and an ordinary open stay different questions`);
}


/* ===========================================================================
   M — THE NEXT ACTION THE SHELL OFFERS.

   Sections C and H proved that an undeclared shot owes no frame and is offered no
   production CTA inside `#main`. THE SHELL AROUND `#main` WAS STILL ANSWERING THE
   SAME QUESTION SEPARATELY, and it was answering it wrong.

   public/shared-stage-model.js's recommendedNextFor() returned the first two handoffs
   unconditionally — `inputs -> "look"` and `look -> "frames"` — and two shipped
   surfaces render that answer verbatim:

     public/shared-stage-actions.js  a `Continue to <stage>` action, emphasis
                                     `advance`, in the persistent stage bar;
     public/creator-surfaces.js      "Next action / <stage> / CineBraid recommends
                                     this next" in the Assistant rail.

   So a shot created seconds earlier, carrying no route and no attachment, was told to
   Continue to Look & blocking — a stage its own declaration marks `optional: true`,
   meaning it may be skipped outright. And a shot whose declared delivery requires ZERO
   frames was pointed at the Frames stage that the model marks optional FOR THAT SHOT
   two functions further down: frame debt expressed as a next action rather than as a
   count, which is the same fabrication section C removes from the count.

   This section reads the facts from the SHIPPED assembler in a rendered page and puts
   them through the SHIPPED derivations. It invents no fact record, so it cannot pass
   against a projection that has stopped reflecting the product.
   =========================================================================== */
const Actions = require("../public/shared-stage-actions.js");
const CreatorState = require("../public/shared-creator-state.js");

/* The stage bar's and the rail's answers for one rendered shot, assembled the way the
   product assembles them: shotStageModelFacts() in the page, then the two contract
   modules the shell draws through. */
async function shellNextActions(project, shotId, { takes = [], anchorsOnDisk = true } = {}) {
  /* Takes go INTO the scan, not beside it: an approved winner with no take on disk
     is an unresolved frame, and readiness says so. Supplying them is how a fixture
     reaches "the required frame really is approved". `anchorsOnDisk: false` is the
     other direction — a cast member the shot declares whose approved reference is
     named on the record but is not there, which is what a MISSING reference is. */
  const scan = scanFor(project);
  if (!anchorsOnDisk) scan.anchors = [];
  for (const shot of project.shots || [])
    scan.shots[shot.id] = { takes: takes.map((name) => ({ name, url: `/assets/shots/${shot.id}/takes/${name}` })), locked: [] };
  const page = await render(`#/shot/${shotId}`, project, { scan });
  const facts = run(page.context, `
    const s = P.shots.find((row) => row.id === ${JSON.stringify(shotId)});
    return shotStageModelFacts(s, takesFor(${JSON.stringify(shotId)}));`);
  const stages = Stage.shotStageProgress(facts);
  const labels = Object.fromEntries(Stage.SHOT_STAGES.map((stage) => [stage.id, stage.label]));
  return {
    facts,
    stages: stages.map((stage) => ({
      id: stage.id,
      optional: stage.optional,
      recommendedNext: stage.recommendedNext,
      /* THE BAR. Every advancing action it would draw for this stage. */
      advances: [...Actions.stageActions(stage, shotId)].filter((action) => action.advances)
        .map((action) => ({ label: action.label, target: action.invoke.stageId })),
      /* THE RAIL. Its four-answer recommendation for this stage. */
      rail: CreatorState.creatorRecommendation(CreatorState.creatorStageBlock(stage), labels),
      /* WHAT THE BAR SAYS ABOUT THIS STAGE, in the words a filmmaker reads, taken
         from the shipped formatter rather than composed here. */
      status: run(page.context, `
        const s = P.shots.find((row) => row.id === ${JSON.stringify(shotId)});
        return boundedShotTaskStatus(s, takesFor(${JSON.stringify(shotId)}), ${JSON.stringify(stage.id)});`),
    })),
    /* And what the command summary inside #main says, so the two can be compared. */
    requiredFramesTile: run(page.context, `
      const summary = (String(document.getElementById("main").innerHTML || "")
        .match(/<section class="shot-command-summary"[^]*?<\\/section>/) || [""])[0];
      const card = (summary.match(/<article[^>]*>(?:(?!<\\/article>)[^])*?Required frames(?:(?!<\\/article>)[^])*?<\\/article>/) || [""])[0];
      return { value: (card.match(/<b>([^<]*)<\\/b>/) || [, ""])[1], note: (card.match(/<small>([^<]*)<\\/small>/) || [, ""])[1] };`),
  };
}
const stageOf = (shell, id) => shell.stages.find((stage) => stage.id === id);
const everyAdvance = (shell) => shell.stages.flatMap((stage) => stage.advances.map((row) => `${stage.id}->${row.target}`));

async function checkShellNextAction() {
  const observed = [];

  /* M1 — NOTHING DECLARED, NOTHING RECOMMENDED.

     A shot straight out of the New Shot form. Its route is absent, its frame count is
     the one section C forces to zero, and the shell must offer no advance at all. */
  const fresh = await shellNextActions(projectWith(newShotRecord("SC-01-01", "SC-01")), "SC-01-01");
  assert.strictEqual(fresh.facts.requiredFrameCount, 0, "M1 fixture check: a fresh shot owes no frame");
  assert.strictEqual(fresh.facts.routeRequirementsKnown, false, "M1 fixture check: and has declared no route");
  assert.deepStrictEqual(everyAdvance(fresh), [],
    "M1: a shot that has declared nothing and attached nothing must be offered no Continue anywhere in the bar");
  assert.strictEqual(stageOf(fresh, "inputs").rail.kind, "none",
    "M1: and the Assistant rail must report no recommendation rather than name one");
  assert.strictEqual(stageOf(fresh, "inputs").rail.reason, "no-honest-recommendation",
    "M1: as a result with a reason — the rail's shipped sentence says CineBraid recommends a next step only once the shot has said what it is delivered as, and that sentence has to be true");
  observed.push("a fresh undeclared shot: 0 advances anywhere in the bar, rail reports no-honest-recommendation");

  /* M2 — LOOK & BLOCKING IS RECOMMENDED BY NOTHING, UNDER EVERY DECLARATION.

     The stage is declared optional, so it is never OWED, so no state of any shot may
     make it the step that comes next. Stated over the whole route vocabulary rather
     than over the one case that exhibited the bug. */
  const lookOffers = [];
  for (const route of ["", ...ROUTES]) {
    const shot = newShotRecord("SC-01-01", "SC-01", route ? { deliveryRoute: route } : {});
    const shell = await shellNextActions(projectWith(shot), "SC-01-01");
    assert.strictEqual(stageOf(shell, "look").optional, true,
      `M2 fixture check: Look & blocking must still be declared optional under ${route || "no route"}`);
    for (const stage of shell.stages) {
      if (stage.recommendedNext === "look" || stage.advances.some((row) => row.target === "look"))
        lookOffers.push(`${route || "undeclared"}:${stage.id}`);
    }
  }
  assert.deepStrictEqual(lookOffers, [],
    `M2: Look & blocking was offered as the next step by ${lookOffers.join(", ")}. It is declared skippable outright; an optional stage is an invitation and can never be what a shot must do next.`);
  observed.push(`Look & blocking is recommended by no stage under any of ${ROUTES.length + 1} declarations`);

  /* M3 — FRAMES IS OFFERED EXACTLY WHERE THE CANONICAL OWNER SAYS A FRAME IS OWED.

     The requirement is not restated here: the expectation is DERIVED from
     shotRouteInputNeeds() through the same frameNeedsOf() section D uses, so a route
     whose canonical needs change moves this assertion with it instead of breaking it. */
  const framesByRoute = [];
  for (const route of ROUTES) {
    const shell = await shellNextActions(projectWith(newShotRecord("SC-01-01", "SC-01", { deliveryRoute: route })), "SC-01-01");
    const owed = frameNeedsOf(route).length > 0;
    assert.strictEqual(shell.facts.requiredFrameCount, frameNeedsOf(route).length,
      `M3 fixture check: ${route}'s frame count must be the route owner's own answer`);
    for (const stageId of ["inputs", "look"]) {
      const stage = stageOf(shell, stageId);
      assert.strictEqual(stage.recommendedNext, owed ? "frames" : "",
        owed
          ? `M3: ${route} owes ${frameNeedsOf(route).length} frame(s) and none is approved, so ${stageId} must offer the Frames handoff`
          : `M3: ${route} owes no frame, so ${stageId} must not point at Frames — that is image-route frame debt arriving as a next action`);
      assert.deepStrictEqual(stage.advances.map((row) => row.target), owed ? ["frames"] : [],
        `M3: the bar's advancing actions for ${route}/${stageId} must match the recommendation exactly`);
    }
    framesByRoute.push(`${route}:${frameNeedsOf(route).length}${owed ? "->frames" : "->none"}`);
  }
  observed.push(`route-owed frame handoffs ${framesByRoute.join(" ")}`);

  /* M4 — AN APPROVED REQUIREMENT IS NOT AN OUTSTANDING ONE.

     The same declared route, before and after its opening frame is approved. The
     handoff is withdrawn when the work behind it is done: a Continue pointed at
     finished work is the same overclaim in the other direction. */
  const owedRoute = ROUTES.find((route) => frameNeedsOf(route).length === 1);
  assert(owedRoute, "M4 fixture check: at least one route must require exactly one frame");
  const beforeApproval = await shellNextActions(projectWith(newShotRecord("SC-01-01", "SC-01", { deliveryRoute: owedRoute })), "SC-01-01");
  assert.strictEqual(stageOf(beforeApproval, "inputs").recommendedNext, "frames", "M4 fixture check: the frame is owed before approval");

  const approvedProject = projectWith(newShotRecord("SC-01-01", "SC-01", {
    deliveryRoute: owedRoute,
    keyframes: [{ id: "frame-a-new", label: "A", title: "Opening frame A", winner: "FRAME_A.png", description: "", notes: "", required: true, generationPackages: [] }],
    candidateFiles: [{ stored: "FRAME_A.png", original: "FRAME_A.png", decision: "approved", mediaType: "image", frameId: "frame-a-new" }],
  }));
  approveFrame(approvedProject, "SC-01-01", "frame-a-new", "FRAME_A.png");
  const afterApproval = await shellNextActions(approvedProject, "SC-01-01", { takes: ["FRAME_A.png"] });
  assert.strictEqual(afterApproval.facts.requiredFramesApproved, true, "M4 fixture check: the required frame is approved now");
  for (const stageId of ["inputs", "look"]) {
    assert.strictEqual(stageOf(afterApproval, stageId).recommendedNext, "",
      `M4: ${stageId} must stop offering the Frames handoff once the frame it was for is approved`);
    assert.deepStrictEqual(stageOf(afterApproval, stageId).advances, [],
      `M4: and the bar must draw no Continue for ${stageId}`);
  }
  observed.push(`${owedRoute} offers the Frames handoff until its opening frame is approved, then withdraws it`);

  /* M5 — A MISSING DECLARED INPUT KEEPS THE SHOT WHERE IT IS.

     Section C proves a cast member with no approved reference still raises an
     obligation from an optional unit. The shell must not answer that obligation by
     sending the filmmaker to a later stage, because the thing that is missing is
     attached HERE. */
  const castId = (buildFixture().characters || [])[0].id;
  const missingInput = projectWith(newShotRecord("SC-01-01", "SC-01", { deliveryRoute: owedRoute, characters: [castId] }));
  const shortOfInput = await shellNextActions(missingInput, "SC-01-01", { anchorsOnDisk: false });
  assert(shortOfInput.facts.missingReferenceCount > 0,
    "M5 fixture check: the shot must actually be short of a declared reference");
  assert.strictEqual(stageOf(shortOfInput, "inputs").recommendedNext, "",
    "M5: a shot missing an input it has declared must not be advised to leave the stage that is missing it");
  assert.deepStrictEqual(stageOf(shortOfInput, "inputs").advances, [], "M5: and no Continue is drawn for it");
  observed.push(`a shot short of ${shortOfInput.facts.missingReferenceCount} declared reference stays on Inputs`);

  /* M6 — THE LEGACY SHOT IS NOT PUSHED ANYWHERE EITHER.

     Two frames, one approved, a stored clip, no declared route. Section G proves none
     of that declares a route; this proves none of it produces a handoff either. Its
     retained work stays reachable — every stage is still selectable — but nothing is
     RECOMMENDED, because the shot has not said how it is made. */
  const legacyBrief = { ...legacyShotRecord("probe", "probe").creationBrief, deliveryIntent: "" };
  const legacyProject = projectWith(legacyShotRecord("SC-01-01", "SC-01", { creationBrief: legacyBrief }));
  approveFrame(legacyProject, "SC-01-01", "frame-a-legacy", "LEGACY-A.png");
  const legacy = await shellNextActions(legacyProject, "SC-01-01", { takes: ["LEGACY-A.png"] });
  assert.strictEqual(legacy.facts.deliveryRoute, "", "M6 fixture check: the legacy shot declares no route");
  assert(legacy.facts.frameApprovedCount > 0, "M6 fixture check: and carries a historical approved frame");
  assert.deepStrictEqual(everyAdvance(legacy), [],
    "M6: a legacy shot with historical frames and a stored clip but no declared route must be offered no Continue — its own history is not a recommendation");
  observed.push(`a legacy shot with ${legacy.facts.frameApprovedCount} approved frame and a stored clip: 0 advances, history intact`);

  /* M7 — A DECLARED STILL DELIVERY STILL GETS ITS HANDOFFS.

     The legacy flag section C leaves meaning exactly what it meant: the opening frame
     is the deliverable. So this shot is owed a frame, is told so on both surfaces, and
     nothing about withdrawing false handoffs may withdraw true ones. */
  const stillProject = stillDeliveryProject();
  const stillShotId = stillProject.shots[0].id;
  const still = await shellNextActions(stillProject, stillShotId);
  assert.strictEqual(still.facts.deliveryIntent, "still", "M7 fixture check: this shot declares a still delivery");
  assert(still.facts.requiredFrameCount > 0, "M7 fixture check: whose opening frame is therefore required");
  assert.strictEqual(stageOf(still, "inputs").recommendedNext, "frames",
    "M7: a declared still delivery owes its frame and must be told so");
  assert.strictEqual(stageOf(still, "inputs").rail.kind, "stage", "M7: and the rail names a stage");
  assert.strictEqual(stageOf(still, "inputs").rail.stageId, "frames", "M7: which is Frames");
  observed.push("a declared still delivery keeps its Frames handoff on both surfaces");

  /* M8 — AND WHAT THE SHELL SAYS ABOUT THE FRAMES STAGE.

     Found by this slice's closure sweep, on the whole screen at once rather than one
     surface at a time. The persistent stage bar read

         Frames · 0 of 1 frame approved · NOT STARTED

     on a brand-new shot, beside a command summary in the same viewport reading
     "Required frames 0/0 · none until you say how this shot is made". A fraction of a
     requirement that does not exist — which is exactly the defect framesState's
     no-frames-required branch was written to remove, except that branch asked whether
     a ROUTE was declared, so it reached declared routes only and stepped over the one
     shot that has declared nothing.

     The two surfaces must give one answer, so both are read and compared. */
  const framesStatusOf = (shell) => stageOf(shell, "frames").status;
  const freshFrames = framesStatusOf(fresh);
  assert.strictEqual(fresh.requiredFramesTile.value, "0/0",
    "M8 fixture check: #main counts no required frame on the fresh shot");
  assert(!/\bof\b.*\bapproved\b/.test(freshFrames.note || ""),
    `M8: the bar must not print a fraction of a requirement the shot does not have, got ${JSON.stringify(freshFrames)}`);
  assert.strictEqual(freshFrames.label, "Not required",
    `M8: it says what the stage is instead, got ${JSON.stringify(freshFrames)}`);
  assert.strictEqual(stageOf(fresh, "frames").optional, true,
    "M8: and the stage is skippable, so the status word and the optionality flag do not disagree on one screen");
  assert.strictEqual(freshFrames.note, "1 frame retained",
    `M8: while still reporting what the shot is CARRYING — the frame record is not hidden to achieve any of this, got ${JSON.stringify(freshFrames)}`);
  observed.push(`the bar reads ${JSON.stringify(freshFrames.label + " · " + freshFrames.note)} beside #main's "${fresh.requiredFramesTile.value} ${fresh.requiredFramesTile.note}"`);

  /* NOTHING TRUTHFUL WAS TAKEN AWAY WITH IT. A route that really does owe a frame
     still counts it, and a legacy shot's retained approvals are still reported. */
  const owedShell = await shellNextActions(projectWith(newShotRecord("SC-01-01", "SC-01", { deliveryRoute: owedRoute })), "SC-01-01");
  assert.strictEqual(framesStatusOf(owedShell).note, "0 of 1 frame approved",
    `M8: a route that owes a frame still counts it, got ${JSON.stringify(framesStatusOf(owedShell))}`);
  assert.strictEqual(owedShell.requiredFramesTile.value, "0/1", "M8: and #main agrees with it");
  assert.strictEqual(framesStatusOf(legacy).note, "1 of 2 frames approved",
    `M8: and a legacy shot's retained approvals are still reported, got ${JSON.stringify(framesStatusOf(legacy))}`);
  observed.push(`${owedRoute} still reads ${JSON.stringify(framesStatusOf(owedShell).note)} and the legacy shot ${JSON.stringify(framesStatusOf(legacy).note)}`);

  note("M. the shell's next action and its frame reading: " + observed.join("; ")
    + " — so the persistent bar and the Assistant rail agree with the frame truth inside #main instead of contradicting it");
}


/* ===========================================================================
   N — THE LAST ROUTE-BLIND READER OF `frame.required`, PINNED WHERE IT IS.

   Found by this slice's closure sweep and DELIBERATELY NOT REPAIRED HERE. It is
   recorded the way section I records the shotApprovalComplete() boundary: stated,
   bounded, and fenced, so it cannot spread while it waits for the slice that owns it.

   WHAT IT IS. public/automation.js's shot automation hub computes

       const required = frames.filter((frame) => frame.required !== false);

   and renders a card labelled REQUIRED FRAMES reading "0/1 approved" on a shot that
   has declared nothing — the discredited default making a statement, in the one place
   the shot-intent work has not reached. `frame.required` is written `true` by
   newKeyframe() on every frame of every project and no filmmaker-facing control writes
   it, which is the whole reason section C exists.

   WHY IT IS NOT FIXED IN THIS SLICE, and the reason is not squeamishness:

   1. The same expression is computed three more times in the same file — the plan
      modal's frame picker and a run-progress label — where it is the AUTOMATION PLAN:
      which frames a full-shot run would produce. Converging the card onto canonical
      route truth without the picker makes the two disagree; converging both changes
      what automation produces. That is an automation decision, and this brief says in
      terms not to redesign automation and to report a second owner rather than add a
      third.

   2. The one-line version is WORSE, and NC-37 proves it rather than asserting it. The
      card's own note reads `approved === required.length ? "Still package ready" : ...`
      — so a required count of zero makes a shot with no images at all announce that
      its still package is ready. A truthful repair has to decide what the card means
      first, which is exactly the work being deferred.

   WHAT THIS SECTION GUARANTEES INSTEAD: that it stays exactly where it is. The count
   reaches no readiness answer, no next action, no command summary, no stage bar, and
   no surface outside the collapsed automation tooling it belongs to. If it ever leaks,
   this fails.
   =========================================================================== */
const AUTOMATION_REQUIRED_ANCHOR =
  'const frames = guidedFrames(shot), required = frames.filter((frame) => frame.required !== false)';

function checkAutomationHubBoundary() {
  const source = readLF("public/automation.js");
  assert(source.includes(AUTOMATION_REQUIRED_ANCHOR),
    "N: the reader this section fences must still be where it is described, or the fence is around nothing");
  return source;
}

async function checkRouteBlindReaderIsFenced() {
  const source = checkAutomationHubBoundary();
  const project = projectWith(newShotRecord("SC-01-01", "SC-01"));
  /* The Look stage, because that is where the hub is mounted — inside the collapsed
     OPTIONAL ASSISTED BLOCKING tools, two disclosures deep. */
  const page = await render("#/shot/SC-01-01", project, {
    scan: scanFor(project),
    storage: { "cinebraid-focused:fixture:shot-task:SC-01-01": "look" },
  });
  const html = String(page.map.get("main").innerHTML || "");
  const HUB = '<details class="shot-automation-hub"';
  const hubAt = html.indexOf(HUB);
  const assistedAt = html.indexOf("blocking-assisted-tools");
  const cardsIn = (text) => [...text.matchAll(/REQUIRED FRAMES<\/span><b>([^<]*)<\/b>/g)].map((row) => row[1]);

  /* N1 — the fabrication is real, and it is where this section says it is. */
  assert(hubAt >= 0, "N1 fixture check: the automation hub must be rendered for this to be about anything");
  assert(assistedAt >= 0 && hubAt > assistedAt,
    "N1: the hub must remain inside the optional assisted-blocking tools");
  const inside = cardsIn(html.slice(hubAt));
  assert.deepStrictEqual(inside, ["0/1 approved"],
    `N1 fixture check: the known fabrication must still read 0/1, got ${JSON.stringify(inside)}`);

  /* N2 — AND NOWHERE ELSE. This is the guarantee. */
  assert.deepStrictEqual(cardsIn(html.slice(0, hubAt)), [],
    "N2: no REQUIRED FRAMES card outside the automation hub may count the stored flag");

  /* N3 — it reaches no truth. Every canonical answer on the same screen still says
     the shot owes nothing and the question is the route. */
  const truth = run(page.context, `
    const s = P.shots.find((row) => row.id === "SC-01-01");
    const takes = takesFor("SC-01-01");
    const readiness = shotReadinessFor(s);
    const facts = shotStageModelFacts(s, takes);
    return {
      requiredUnits: readiness.units.filter((u) => u.kind === "frame" && u.required).map((u) => u.id),
      nextAction: readiness.nextAction.code,
      requiredFrameCount: facts.requiredFrameCount,
      requiredFramesApproved: facts.requiredFramesApproved,
      barFrames: boundedShotTaskStatus(s, takes, "frames"),
      stages: shotStageProgress(facts).map((stage) => stage.recommendedNext).filter(Boolean),
    };`);
  assert.deepStrictEqual(truth.requiredUnits, [], "N3: readiness still requires no frame");
  assert.strictEqual(truth.nextAction, "declare-shot-route", "N3: and the current action is still the route question");
  assert.strictEqual(truth.requiredFrameCount, 0, "N3: the fact projection still counts none");
  assert.strictEqual(truth.barFrames.label, "Not required", "N3: the stage bar still says the stage is not required");
  assert.deepStrictEqual(truth.stages, [], "N3: and no stage recommends anything on the strength of it");

  /* N4 — the source-level fence. The stored flag may be read by the automation file
     and by the two documented fallbacks, and by nothing else that renders a
     requirement. Stated as a property so a new reader has to come here first. */
  const readers = [];
  for (const file of ["app.js", "creation-studio.js", "shared-shot-readiness.js", "shared-stage-model.js", "focused-workspaces.js", "media-results.js", "reports.js"]) {
    /* Comments stripped first. Every one of these files DISCUSSES the stored flag at
       length -- that is how the slice documented what it was removing -- and a naive
       line search would count describing it as doing it. focused-workspaces.js's
       header, which records a reader it already deleted, is the exact case. */
    for (const line of codeOnly(readLF(`public/${file}`)).split("\n"))
      if (line.includes(".required !== false)")) readers.push(`${file}: ${line.trim().slice(0, 90)}`);
  }
  /* The three that are allowed, each with a stated reason:
     app.js's requiredFrames() -- section I proves its only consumer is route-invariant
     and reaches no persistent surface; creation-studio.js's guidedFrameProgress() and
     its requiredFrameCount fallback -- the documented answers for the case readiness
     cannot answer at all. Anything else is a new claim and has to be argued here. */
  assert.strictEqual(readers.length, 3,
    `N4: the stored required flag gained or lost a reader outside public/automation.js. Each one is a default making a statement unless it is argued for.\n  ${readers.join("\n  ")}`);

  const automationReaders = codeOnly(readLF("public/automation.js")).split("\n").filter((line) => line.includes(".required !== false)")).length;
  note(`N. the one route-blind required-frame reader left is public/automation.js (${automationReaders} sites, all the automation PLAN): `
    + `its hub card reads ${JSON.stringify(inside[0])} two disclosures deep on Look, while readiness requires ${truth.requiredUnits.length} frames, `
    + `the fact projection counts ${truth.requiredFrameCount}, the stage bar reads ${JSON.stringify(truth.barFrames.label)}, `
    + `the current action is ${truth.nextAction} and no stage recommends anything. No REQUIRED FRAMES card outside the hub counts the flag, `
    + `and only ${readers.length} argued readers of it exist elsewhere. DEFERRED, not fixed — see the section header for why the one-line repair is worse`);
}

/* =========================================================================== */
async function main() {
  await checkContextualAdd();
  await checkNewShotForm();
  await checkUndeclaredFabricatesNothing();
  checkDeclaredRoutes();
  checkRouteChanges();
  await checkRouteFreshness();
  checkLegacyPackage();
  await checkExecutionCompatibility();
  await checkNoInference();
  await checkHierarchy();
  await checkApprovalBoundary();
  checkHistoricalMedia();
  checkHistoryThenDeclaration();
  checkRouteIndependentStillCounts();
  checkStillDeliveryMotion();
  await checkRetainedMotionHistory();
  await checkShellNextAction();
  await checkRouteBlindReaderIsFenced();

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

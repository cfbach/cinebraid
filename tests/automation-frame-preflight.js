/* Frame-specific continuity preflight — the automation readiness check honours a
 * frame-level declared state.
 *
 * THE PROPERTY THIS FILE EXISTS FOR, in one line: the state a frame SAYS it uses
 * and the reference the preflight clears that frame against cannot disagree.
 *
 * P4-SEM-B made the precedence canonical — a frame-level binding beats a
 * shot-level binding beats the entity's own default — and routed the continuity
 * manifest, the `continuity` profile and server.js's authority selection through
 * one resolver. `v626ShotPreflight` in public/automation.js was not routed. It
 * read `shot.continuityStateSelections[entityId]` directly, which is the
 * SHOT-level runtime map and nothing else, and it read it ONCE for the whole run
 * rather than once per frame. So:
 *
 *     shot   Rhea = clean          clean has an approved reference
 *     frame B Rhea = rain-soaked   rain-soaked has none
 *
 * reported READY. The run then started, and the generator — which does resolve
 * the frame's state — went looking for an authority the preflight never checked.
 *
 * There were TWO readings to correct, and fixing either alone still reports
 * READY:
 *
 *   1. WHICH STATE. Resolved per frame through resolveDeclaredStateId(), the same
 *      entry point the manifest uses. Case 1-8 below.
 *   2. WHICH FILE. `entityApprovedFileForState()` falls back to
 *      `entity.approvedFile` for ANY state, and entityStateList() keeps that
 *      field synced to the DEFAULT state's file — so "rain-soaked" resolved to
 *      the clean image even once the right state id was in hand. A state's
 *      approval is its OWN approvedFile; the entity-level file answers only for
 *      the default. That is not a new rule: v627EntityPreflight in the same file
 *      has read parent states that way since state chains existed, and it now
 *      shares the reading rather than keeping a copy. Case 2 and case 11.
 *
 * NO PAID PROVIDER CALL IS POSSIBLE HERE. Nothing dispatches a generation. FAL is
 * presented as configured so the preflight reaches its reference checks at all,
 * and the only thing ever called is the preflight function itself.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const Binding = require("../public/shared-continuity-binding");
const { deterministicHealth } = require("../agent-suite");
const { render, buildFixture } = require("./render-harness");

let checks = 0;
const ok = (condition, message) => { assert(condition, message); checks++; };
const eq = (actual, expected, message) => {
  /* Values folded into the message: assert.deepStrictEqual suppresses its own
     diff whenever a custom message is supplied, and "case 4 failed" with no
     strings is the least useful thing a suite can print. */
  assert.deepStrictEqual(actual, expected, `${message}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  checks++;
};

/* ===========================================================================
   The fixture.

   A/B/C rather than A/B, because CineBraid supports any frame structure and a
   model built around a first/last pair would only work for the workflow the UI
   happens to emphasise.

   Two entities of different kinds, because a shot-level answer for the whole run
   is exactly the defect: one entity passing must not speak for another. */

const CLEAN = "st-rhea-clean", WET = "st-rhea-wet";
const CLOSED = "st-case-closed", OPEN = "st-case-open";

function fixtureProject(options = {}) {
  const {
    wetApproved = false,
    openApproved = false,
    shotStates = { "CHAR-RHEA": CLEAN, "PROP-CASE": CLOSED },
    frameStates = { "fr-b": { character: { "CHAR-RHEA": WET }, prop: { "PROP-CASE": OPEN } } },
    locationApproved = true,
  } = options;
  const project = buildFixture();
  project.characters = [{
    id: "CHAR-RHEA", name: "Rhea", status: "APPROVED", approvedFile: "CHAR-RHEA-CLEAN.png",
    continuityStates: [
      { id: CLEAN, name: "Clean", isDefault: true, approvedFile: "CHAR-RHEA-CLEAN.png" },
      { id: WET, name: "Rain-soaked", stateDelta: "Soaked through.", approvedFile: wetApproved ? "CHAR-RHEA-WET.png" : "" },
    ],
  }];
  project.props = [{
    id: "PROP-CASE", name: "Flight case", status: "APPROVED", approvedFile: "PROP-CASE-CLOSED.png",
    continuityStates: [
      { id: CLOSED, name: "Closed", isDefault: true, approvedFile: "PROP-CASE-CLOSED.png" },
      { id: OPEN, name: "Open", stateDelta: "Lid up.", approvedFile: openApproved ? "PROP-CASE-OPEN.png" : "" },
    ],
  }];
  project.locations = [{
    id: "LOC-DOOR", name: "Doorway", status: "APPROVED",
    approvedFile: locationApproved ? "LOC-DOOR.png" : "",
    continuityStates: [],
  }];
  project.vehicles = [];
  const frameWorkflows = {};
  for (const [frameId, kinds] of Object.entries(frameStates || {})) {
    const workflow = {};
    for (const [kind, map] of Object.entries(kinds || {})) workflow[`${kind}StateSelections`] = { ...map };
    frameWorkflows[frameId] = workflow;
  }
  project.shots = [{
    id: "SH-01", scene: "SC-01", title: "Rhea in the doorway",
    desc: "She steps out of the rain and back into it.",
    positioning: "Locked wide composition.",
    workflowStatus: "IN PROGRESS", status: "BUILT", reviewStatus: "PENDING",
    characters: ["CHAR-RHEA"], codes: ["LOC-DOOR", "PROP-CASE"], risks: [], notes: [],
    keyframes: [
      { id: "fr-a", label: "A", title: "Opening frame", description: "Dry, under the awning.", required: true, generationPackages: [] },
      { id: "fr-b", label: "B", title: "Middle frame", description: "Out in it.", required: true, generationPackages: [] },
      { id: "fr-c", label: "C", title: "Closing frame", description: "Back under, still soaked.", required: true, generationPackages: [] },
    ],
    clips: [],
    continuityStateSelections: { ...shotStates },
    creationBrief: { locationId: "LOC-DOOR", propIds: ["PROP-CASE"], frameWorkflows },
  }];
  return project;
}

/* The shipped scripts, in the shipped order, with FAL presented as configured.

   CONFIG is a top-level `let` inside those scripts, so it is a lexical binding
   rather than a property of the contextified global: assigning to context.CONFIG
   from out here would create a second, invisible one. The same is true of `P`,
   which is why the live project is read back through runInContext rather than
   trusted to be the object handed in — render() clones it. */
async function runtime(options = {}) {
  const view = await render("#/create", fixtureProject(options), options.renderOptions || {});
  vm.runInContext(`CONFIG = { ...(typeof CONFIG === "object" ? CONFIG : {}), generation: { fal: { enabled: true, apiKey: "preflight-fixture-key" } } };`, view.context);
  ok(view.context.falGenerationReady() === true, "the fixture must present FAL as configured, or every preflight blocks for an unrelated reason");
  checks--; /* plumbing, not a property of the fix */
  const project = vm.runInContext("P", view.context);
  const shot = project.shots.find((entry) => entry.id === "SH-01");
  const frames = view.context.guidedFrames(shot);
  return { view, context: view.context, project, shot, frames };
}

/* Reference errors only. "Choose at least one frame", the description checks and
   the parent-frame rule are the preflight's other jobs and are asserted where
   they are the subject rather than folded into every case. */
const REFERENCE = /reference/;
/* Rebuilt as a HOST array on purpose. The preflight's own array is constructed
   inside the vm context, so its prototype is that realm's Array.prototype and
   assert.deepStrictEqual — which compares prototypes — fails against a literal
   here while printing two identical-looking lines. */
const referenceErrors = (preflight) => [...preflight.errors].filter((line) => REFERENCE.test(line)).sort();
/* Same reason, for any record read straight off the contextified project. */
const plain = (value) => JSON.parse(JSON.stringify(value ?? null));

async function preflightFor(options, frameIds) {
  const env = await runtime(options);
  const ids = frameIds || env.frames.map((frame) => frame.id);
  return { ...env, preflight: env.context.v626ShotPreflight(env.shot, ids) };
}

/* ===========================================================================
   1. The declared state decides, per frame. */

async function declaredStateSection() {
  /* Case 1 — a frame override whose state has no approved authority BLOCKS, and
     says which frame and which state, because "Rhea needs an approved character
     reference" in front of an approved Rhea is a bug report, not an instruction. */
  const missing = await preflightFor({});
  eq(referenceErrors(missing.preflight), [
    "Frame B declares Flight case as Open, which has no approved prop reference.",
    "Frame B declares Rhea as Rain-soaked, which has no approved character reference.",
  ], "case 1: an explicit frame override with no approved authority blocks, naming the frame and the state");

  /* Case 2 — the same project with both authorities supplied is READY. The
     approval is state-specific: it is the state's own approvedFile appearing,
     not the entity-level file, that clears it. */
  const supplied = await preflightFor({ wetApproved: true, openApproved: true });
  eq(referenceErrors(supplied.preflight), [], "case 2: supplying the declared states' own approved references clears the run");

  /* Case 3 — no frame override: the SHOT's binding is what is checked. Declared
     rain-soaked at shot level with no rain-soaked reference blocks, and the
     wording does not name a frame, because no frame is why. */
  const shotLevel = await preflightFor({ frameStates: {}, shotStates: { "CHAR-RHEA": WET, "PROP-CASE": CLOSED } });
  eq(referenceErrors(shotLevel.preflight), [
    "Rhea needs an approved character reference for its declared state Rain-soaked.",
  ], "case 3: with no frame override the shot's declared state is what the preflight checks");

  /* Case 4 — neither a frame nor a shot binding: the entity's own default. Both
     defaults are approved, so the run is ready, and nothing invented a state. */
  const defaults = await preflightFor({ frameStates: {}, shotStates: {} });
  eq(referenceErrors(defaults.preflight), [], "case 4: with no binding at all the entity default is used, and it is approved");
  const undeclared = await preflightFor({ frameStates: {}, shotStates: {}, locationApproved: false });
  eq(referenceErrors(undeclared.preflight), ["Doorway needs an approved location reference."],
    "case 4: and an unapproved default still blocks in the words it always used");
}

/* ===========================================================================
   2. Inheritance is absence, and stays absence. */

async function inheritanceSection() {
  /* Case 5 — removing the override restores shot inheritance IMMEDIATELY, with
     no re-save and no stored marker. The shot still says clean; deleting the
     frame's entry is the whole operation. */
  const env = await runtime({});
  const before = env.context.v626ShotPreflight(env.shot, env.frames.map((frame) => frame.id));
  eq(referenceErrors(before).length, 2, "case 5: the override blocks first");

  delete env.shot.creationBrief.frameWorkflows["fr-b"].characterStateSelections;
  delete env.shot.creationBrief.frameWorkflows["fr-b"].propStateSelections;
  const after = env.context.v626ShotPreflight(env.shot, env.frames.map((frame) => frame.id));
  eq(referenceErrors(after), [], "case 5: removing the override restores the shot's clean/closed inheritance at once");

  /* And the restoration is inheritance, not a copy: the frame record must not
     have acquired the shot's state on its way through the preflight. */
  const workflow = env.shot.creationBrief.frameWorkflows["fr-b"] || {};
  const stored = Object.keys(workflow).filter((key) => /StateSelections$/.test(key) || key === "locationStateId");
  eq(stored, [], "case 5: absence remains absence — the preflight stores nothing to say a frame inherits");
  eq(plain(env.shot.continuityStateSelections), { "CHAR-RHEA": CLEAN, "PROP-CASE": CLOSED },
    "case 5: and the shot's own bindings are untouched by any of it");
}

/* ===========================================================================
   3. Entities are independent, and frames are general. */

async function independenceSection() {
  /* Case 6/7 — one entity passing must not speak for another. Rhea's rain-soaked
     reference exists; the case's open reference does not. Exactly one error, and
     it is the prop's. */
  const oneMissing = await preflightFor({ wetApproved: true, openApproved: false });
  eq(referenceErrors(oneMissing.preflight), [
    "Frame B declares Flight case as Open, which has no approved prop reference.",
  ], "case 6/7: entities are evaluated independently, and the block names the one actually missing");

  const otherMissing = await preflightFor({ wetApproved: false, openApproved: true });
  eq(referenceErrors(otherMissing.preflight), [
    "Frame B declares Rhea as Rain-soaked, which has no approved character reference.",
  ], "case 7: and the same holds with the two entities swapped");

  /* Case 8 — A/B/C. The override is honoured wherever it lives, so a preflight
     that special-cased the opening or the closing frame would fail here. */
  for (const [frameId, label] of [["fr-a", "A"], ["fr-b", "B"], ["fr-c", "C"]]) {
    const env = await preflightFor({ frameStates: { [frameId]: { character: { "CHAR-RHEA": WET } } } });
    eq(referenceErrors(env.preflight), [`Frame ${label} declares Rhea as Rain-soaked, which has no approved character reference.`],
      `case 8: an override on frame ${label} is honoured — no frame position is special`);
  }

  /* Only the frames in the run are the run's problem. Frame B declares a state
     with no authority; a run of frame A alone is still ready. */
  const partial = await preflightFor({}, ["fr-a"]);
  eq(referenceErrors(partial.preflight), [], "case 8: a frame that is not in this run does not block this run");
  const targeted = await preflightFor({}, ["fr-b"]);
  eq(referenceErrors(targeted.preflight), [
    "Frame B declares Flight case as Open, which has no approved prop reference.",
    "Frame B declares Rhea as Rain-soaked, which has no approved character reference.",
  ], "case 8: and selecting only that frame blocks on exactly its declared states");
}

/* ===========================================================================
   4. Case 9 — owner-scoped state ids.

   THE reading P4-SEM-B is built on: all twelve state records across every entity
   of the real overfit-18 generation carry the id `state-default`. That is legal —
   `id.duplicate` is defined per collection — and permanent. So the same state id
   on two entities must resolve to two different records and two different
   answers. A global lookup would make these two cases agree, and they must not. */

async function ownerScopeSection() {
  const project = fixtureProject({});
  const shot = project.shots[0];
  /* Both entities now declare a state literally called `state-alt`. The
     character's is approved; the prop's is not. */
  project.characters[0].continuityStates = [
    { id: "state-default", name: "Clean", isDefault: true, approvedFile: "CHAR-RHEA-CLEAN.png" },
    { id: "state-alt", name: "Rain-soaked", stateDelta: "Soaked.", approvedFile: "CHAR-RHEA-WET.png" },
  ];
  project.props[0].continuityStates = [
    { id: "state-default", name: "Closed", isDefault: true, approvedFile: "PROP-CASE-CLOSED.png" },
    { id: "state-alt", name: "Open", stateDelta: "Lid up.", approvedFile: "" },
  ];
  shot.continuityStateSelections = {};
  shot.creationBrief.frameWorkflows = {
    "fr-b": { characterStateSelections: { "CHAR-RHEA": "state-alt" }, propStateSelections: { "PROP-CASE": "state-alt" } },
  };

  const view = await render("#/create", project, {});
  vm.runInContext(`CONFIG = { ...(typeof CONFIG === "object" ? CONFIG : {}), generation: { fal: { enabled: true, apiKey: "k" } } };`, view.context);
  const live = vm.runInContext("P", view.context);
  const liveShot = live.shots.find((entry) => entry.id === "SH-01");
  const frames = view.context.guidedFrames(liveShot);
  const preflight = view.context.v626ShotPreflight(liveShot, frames.map((frame) => frame.id));

  eq(referenceErrors(preflight), [
    "Frame B declares Flight case as Open, which has no approved prop reference.",
  ], "case 9: one state id, two owners, two answers — the approved one clears and the unapproved one blocks");

  /* Said again at the contract, so the property is pinned to the rule and not
     only to this fixture's wiring. */
  const bindings = Binding.readShotStateBindings(liveShot);
  eq(Binding.resolveBoundStateId(bindings, "fr-b", "CHAR-RHEA"), "state-alt", "case 9: the character's binding");
  eq(Binding.resolveBoundStateId(bindings, "fr-b", "PROP-CASE"), "state-alt", "case 9: and the prop's, spelled identically");
  ok(Binding.stateIdBelongsToEntity(live.characters[0].continuityStates, "state-alt")
    && Binding.stateIdBelongsToEntity(live.props[0].continuityStates, "state-alt"),
    "case 9: both entities really do declare it — the ids are equal, the records are not");
}

/* ===========================================================================
   5. Case 10/11 — what must NOT have changed.

   The whole existing corpus declares no states at all: measured across all 18
   sanitized Overfit generations there are zero occurrences of
   continuityStateSelections or of a frame-level selection. So the no-declaration
   path is the path every real project takes, and it must read exactly as before —
   same verdicts, same wording, in the entity-level shape AND the state-record
   shape. */

async function unchangedSection() {
  const legacyShaped = async (mutate) => {
    const project = fixtureProject({ frameStates: {}, shotStates: {} });
    mutate(project);
    const view = await render("#/create", project, {});
    vm.runInContext(`CONFIG = { ...(typeof CONFIG === "object" ? CONFIG : {}), generation: { fal: { enabled: true, apiKey: "k" } } };`, view.context);
    const live = vm.runInContext("P", view.context);
    const shot = live.shots.find((entry) => entry.id === "SH-01");
    return view.context.v626ShotPreflight(shot, view.context.guidedFrames(shot).map((frame) => frame.id));
  };

  /* Case 10 — a pre-6.7 entity: approval on the entity, no continuityStates at
     all. entityStateList() seeds the default FROM entity.approvedFile, and the
     entity-level file must keep answering for it. */
  eq(referenceErrors(await legacyShaped((project) => {
    delete project.characters[0].continuityStates;
    delete project.props[0].continuityStates;
  })), [], "case 10: an entity with no declared states is cleared by its entity-level approval, exactly as before");

  /* Case 10 — and the same entity unapproved still blocks in the original words.
     This is the message every existing project sees; it is pinned, not paraphrased. */
  eq(referenceErrors(await legacyShaped((project) => {
    delete project.characters[0].continuityStates;
    project.characters[0].approvedFile = "";
  })), ["Rhea needs an approved character reference."],
    "case 10: and an unapproved one blocks with the wording it has always used");

  /* Case 11 — the entity-level file answers for the DEFAULT state and for
     nothing else. A default record with an empty approvedFile beside a populated
     entity.approvedFile is the legacy shape, and it must still clear. */
  eq(referenceErrors(await legacyShaped((project) => {
    project.characters[0].continuityStates = [{ id: CLEAN, name: "Clean", isDefault: true, approvedFile: "" }];
    project.characters[0].approvedFile = "CHAR-RHEA-CLEAN.png";
  })), [], "case 11: the entity-level approval still answers for the default state");

  /* Case 11, the other half — and it must NOT answer for a declared non-default
     state. This single assertion is the difference between the fix working and
     the fix resolving the right state id and then clearing it anyway. */
  const project = fixtureProject({ wetApproved: false, frameStates: { "fr-b": { character: { "CHAR-RHEA": WET } } } });
  const view = await render("#/create", project, {});
  vm.runInContext(`CONFIG = { ...(typeof CONFIG === "object" ? CONFIG : {}), generation: { fal: { enabled: true, apiKey: "k" } } };`, view.context);
  const live = vm.runInContext("P", view.context);
  const rhea = live.characters[0];
  /* This assertion used to read the other way round. PR #58 left
     entityApprovedFileForState() falling back to the entity file for ANY state
     and worked around it, and this line pinned that as a KNOWN remaining
     defect one layer below the preflight — the lower-level half of the same
     wrong-authority substitution. It is fixed now: the fallback is gone from
     the shared rule, so the preflight's reading and the generation path's
     reading are the same reading. tests/state-authority-substitution.js owns
     that property in full; what this line still guards is that the two never
     diverge again. */
  eq(view.context.entityApprovedFileForState(rhea, WET), "",
    "case 11: entityApprovedFileForState no longer substitutes the entity's default file for an unapproved declared state");
  eq(view.context.v626StateApprovedFile(rhea, rhea.continuityStates.find((state) => state.id === WET)), "",
    "case 11: but the state-scoped reading the preflight uses returns nothing for an unapproved rain-soaked");
  eq(view.context.v626StateApprovedFile(rhea, rhea.continuityStates.find((state) => state.id === CLEAN)), "CHAR-RHEA-CLEAN.png",
    "case 11: and still returns the default's file for the default");
}

/* ===========================================================================
   6. Case 12 — the preflight is a question, not a write.

   Two separate guarantees, and only the second is about this change:

     - it must not write a state binding anywhere. That is §7: an inherited state
       is stored as ABSENCE, and a preflight that copied the shot's answer into a
       frame to make its own job easier would turn every checked frame into an
       explicit override that no longer follows the shot.
     - the frame WORKFLOW records are normalised on read by guidedFrameState(),
       which the preflight has always called and which this change did not touch.
       That is stated here rather than asserted away, because a suite that
       pretended the preflight writes nothing at all would be asserting something
       untrue and would go red for an unrelated reason later. */

async function noMutationSection() {
  const env = await runtime({});
  /* Every state binding the shot declares, flattened to one comparable map.
     A frame with no entry here declares nothing and INHERITS — which is the
     whole point, so a frame whose workflow record merely exists is identical to
     one that has none. That distinction is deliberate: guidedFrameState()
     normalises a workflow record for each frame it is asked about and has done
     since guided frames existed; the preflight has always called it, and this
     change did not touch it. Recording that here rather than asserting it away,
     because a suite claiming the preflight writes literally nothing would be
     asserting something untrue. */
  const declared = (shot) => {
    const out = {};
    for (const [entityId, stateId] of Object.entries(shot.continuityStateSelections || {})) out[`shot/${entityId}`] = stateId;
    for (const [frameId, workflow] of Object.entries(shot.creationBrief.frameWorkflows || {}))
      for (const [key, value] of Object.entries(workflow || {})) {
        if (key === "locationStateId") { if (value) out[`${frameId}/location`] = value; continue; }
        if (!/StateSelections$/.test(key)) continue;
        for (const [entityId, stateId] of Object.entries(value || {})) out[`${frameId}/${entityId}`] = stateId;
      }
    return JSON.parse(JSON.stringify(out));
  };

  const before = declared(env.shot);
  env.context.v626ShotPreflight(env.shot, env.frames.map((frame) => frame.id));
  env.context.v626ShotPreflight(env.shot, ["fr-a"]);
  env.context.v626ShotPreflight(env.shot, []);
  const after = declared(env.shot);

  eq(after, before, "case 12: running the preflight three ways declared nothing new — no frame gained a state, no shot binding moved");
  eq(before, {
    "shot/CHAR-RHEA": CLEAN, "shot/PROP-CASE": CLOSED,
    "fr-b/CHAR-RHEA": WET, "fr-b/PROP-CASE": OPEN,
  }, "case 12: and what it declares is exactly the fixture — frames A and C say nothing, which is how they inherit");

  /* The workflow records the preflight normalised into existence carry no state
     of their own. This is the §7 property stated at the record: a preflight that
     copied the shot's answer into a frame to make its own job easier would turn
     every checked frame into an explicit override that no longer follows the shot. */
  for (const frameId of ["fr-a", "fr-c"]) {
    const workflow = env.shot.creationBrief.frameWorkflows[frameId] || {};
    eq(Object.keys(workflow).filter((key) => /StateSelections$/.test(key) || key === "locationStateId"), [],
      `case 12: frame ${frameId}'s normalised record holds no continuity state — absence remains absence`);
  }

  /* The declared data survives a save/reload shaped round trip: the preflight is
     answering off persisted state, not off something the render happened to
     leave in memory. */
  const reloaded = JSON.parse(JSON.stringify(vm.runInContext("P", env.context)));
  const view = await render("#/create", reloaded, {});
  vm.runInContext(`CONFIG = { ...(typeof CONFIG === "object" ? CONFIG : {}), generation: { fal: { enabled: true, apiKey: "k" } } };`, view.context);
  const live = vm.runInContext("P", view.context);
  const shot = live.shots.find((entry) => entry.id === "SH-01");
  const preflight = view.context.v626ShotPreflight(shot, view.context.guidedFrames(shot).map((frame) => frame.id));
  eq(referenceErrors(preflight), [
    "Frame B declares Flight case as Open, which has no approved prop reference.",
    "Frame B declares Rhea as Rain-soaked, which has no approved character reference.",
  ], "case 12: and the same verdict comes back after a serialize/reload round trip");
}

/* ===========================================================================
   7. Case 13 — the modal actually stops the operator.

   A preflight that returns the right errors and a START button that stays
   enabled is not a gate. The shot automation modal is the only surface this
   preflight has, so the wiring is asserted through the shipped update function.

   The harness DOM does not parse innerHTML, so `.v626-auto-frame:checked` is
   supplied rather than discovered — the frame SELECTION is stubbed, the preflight
   call, the message and the button state are the shipped code's. */

async function modalSection() {
  const env = await runtime({});
  const checkboxes = env.frames.map((frame) => ({ value: frame.id }));
  env.context.document.querySelectorAll = (selector) => (selector === ".v626-auto-frame:checked" ? checkboxes : []);
  env.context._v626ShotAutomationDraft = { shotId: "SH-01", frameIds: env.frames.map((frame) => frame.id) };

  env.context.updateShotAutomationEstimate();
  const panel = env.context.document.getElementById("v626-shot-auto-preflight");
  const button = env.context.document.getElementById("v626-start-shot-auto");
  ok(/Cannot start yet/.test(panel.innerHTML), "case 13: the modal says the run cannot start");
  ok(/Frame B declares Rhea as Rain-soaked/.test(panel.innerHTML), "case 13: and names the frame, the entity and the declared state");
  eq(button.disabled, true, "case 13: and the START button is disabled, so the gate is a gate");

  /* Supplying the authorities clears it through the same shipped path. */
  const cleared = await runtime({ wetApproved: true, openApproved: true });
  cleared.context.document.querySelectorAll = (selector) => (selector === ".v626-auto-frame:checked" ? cleared.frames.map((frame) => ({ value: frame.id })) : []);
  cleared.context._v626ShotAutomationDraft = { shotId: "SH-01", frameIds: cleared.frames.map((frame) => frame.id) };
  cleared.context.updateShotAutomationEstimate();
  const clearedPanel = cleared.context.document.getElementById("v626-shot-auto-preflight");
  ok(!/Cannot start yet/.test(clearedPanel.innerHTML), "case 13: and with both authorities approved the modal stops objecting");
  eq(cleared.context.document.getElementById("v626-start-shot-auto").disabled, false, "case 13: and re-enables START");
}

/* ===========================================================================
   8. Case 14 — the FLF motion-readiness gate is not this task's business.

   That gate answers "may this pair become motion", from frame APPROVALS. This
   preflight answers "do the reference authorities this run needs exist". B2b is
   where gating systems get compared; moving, replacing, reordering or weakening
   the motion gate here would decide that question by accident. */

function motionGateSection() {
  const project = fixtureProject({});
  const shot = project.shots[0];
  shot.clips = [{ id: "seg-1", kind: "flf", label: "1", fromFrame: "fr-a", toFrame: "fr-b", motionPrompt: "She steps out." }];
  shot.keyframes[0].winner = "fr-a-approved.png";

  const blocked = deterministicHealth(project, { shots: {} }).filter((entry) => entry.type === "blocked-flf");
  eq(blocked.map((entry) => entry.reason), ["FLF requires approved first and last frames."],
    "case 14: the FLF gate still blocks on unapproved endpoints, in its own words");
  eq(blocked[0].severity, "high", "case 14: at the severity it has always used");

  /* Frame B declares a state with NO approved authority — the exact condition
     this task's preflight blocks on. The motion gate must not have noticed. */
  shot.keyframes[1].winner = "fr-b-approved.png";
  eq(deterministicHealth(project, { shots: {} }).filter((entry) => entry.type === "blocked-flf"), [],
    "case 14: and clears on approved endpoints even though frame B declares an unapproved state — the two gates are separate");

  /* Ownership and order, at the source. The gate lives in agent-suite.js and
     reads approvals; automation.js's preflight must not have reached into it,
     and it must not have acquired a continuity input. */
  const agentSource = fs.readFileSync(path.join(ROOT, "agent-suite.js"), "utf8");
  const start = agentSource.indexOf('if (c.kind === "flf")');
  const end = agentSource.indexOf('reason: "FLF requires approved first and last frames."');
  ok(start >= 0 && end > start, "case 14: the FLF gate is still where it was, in agent-suite.js");
  ok(!/continuity|resolveDeclaredStateId|StateSelections|v626/i.test(agentSource.slice(start, end)),
    "case 14: and nothing here routes the motion go/no-go decision through a continuity engine");

  const automationSource = fs.readFileSync(path.join(ROOT, "public", "automation.js"), "utf8");
  ok(!/blocked-flf|deterministicHealth/.test(automationSource),
    "case 14: and the reference preflight does not reach into the motion gate");
}

/* ===========================================================================
   9. Case 15 — the resolver is REUSED, not reimplemented.

   The point of P4-SEM-B is one rule with one owner. A preflight that resolved
   the precedence itself would be correct today and a second opinion tomorrow. */

/* Comments are stripped before the source guards run: a file may legitimately
   EXPLAIN the reading it no longer performs, and the comment above
   v626ShotPreflight names `shot.continuityStateSelections` precisely because
   that is what it stopped doing. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"`\\])\/\/[^\n]*/g, "$1");
}

function reuseSection() {
  const source = stripComments(fs.readFileSync(path.join(ROOT, "public", "automation.js"), "utf8"));
  const body = source.slice(source.indexOf("function v626DeclaredState"), source.indexOf("window.openShotAutomationModal"));
  ok(/resolveDeclaredStateId\(/.test(body), "case 15: the preflight resolves through the canonical entry point");
  ok(!/continuityStateSelections/.test(source),
    "case 15: and public/automation.js no longer reads the shot-level runtime map directly — that reading is the defect");
  /* The frame-level maps are the other half of the same reading, and
     shared-continuity-binding.js is their only reader. */
  ok(!/(character|location|prop|vehicle)StateSelections/.test(source),
    "case 15: nor any frame-level selection map");
  ok(!/frameWorkflows\s*\[[^\]]*\]\s*\.\s*locationStateId|locationStateId/.test(source),
    "case 15: nor the bare frame locationStateId");
}

async function main() {
  await declaredStateSection();
  await inheritanceSection();
  await independenceSection();
  await ownerScopeSection();
  await unchangedSection();
  await noMutationSection();
  await modalSection();
  motionGateSection();
  reuseSection();
  console.log(`Frame-specific continuity preflight passed ${checks} checks: the automation preflight resolves each frame's declared state through the P4-SEM-B canonical rule, reads a state's approval as that state's own, evaluates entities independently across A/B/C, keeps inheritance stored as absence, declares nothing while answering, stops the operator in the shipped modal, and leaves the FLF motion gate exactly where it was. Provider calls made: 0.`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});

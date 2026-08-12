/* State-specific authority — a missing non-default state never borrows the
 * entity's default image.
 *
 * THE PROPERTY THIS FILE EXISTS FOR, in one line: a request for rain-soaked Rhea
 * is answered with rain-soaked Rhea or with NOTHING, and never with clean Rhea.
 *
 * P4-SEM-B made the declared entity-state precedence canonical and PR #58 made
 * the automation preflight honour it per frame. Both stopped one layer above the
 * defect this file covers. Two authority lookups ended in the same `||`:
 *
 *     server.js  entityApprovedDiskPath()   state?.approvedFile || entity.approvedFile
 *     app.js     entityApprovedFileForState()  st?.approvedFile || entity.approvedFile
 *
 * and entityStateList() keeps `entity.approvedFile` synced to the DEFAULT
 * state's file. So a frame that declared "Rhea is rain-soaked", resolved that
 * state correctly, and found it had no approved reference of its own was handed
 * the clean image as its character identity authority. The declared state and
 * the pixels generated against it were two truths — exactly what P4-SEM-B set
 * out to make impossible, one call deeper than PR #58 reached.
 *
 * THE RULE, now owned once by Continuity.stateApprovedFile():
 *
 *     default state                       -> the default's file, and the
 *                                            entity-level file still answers
 *                                            for it (the whole legacy corpus)
 *     non-default WITH an approved file   -> that state's file
 *     non-default WITHOUT one            -> "" — missing is an answer
 *
 * WHAT IS DRIVEN HERE. The two real server functions that choose an authority
 * image, lifted out of server.js by exact source; the shipped browser scripts in
 * their shipped order through render-harness; and the real automation preflight,
 * so §10's agreement is asserted between the actual two readers rather than
 * between two restatements of them.
 *
 * OWNER-SCOPED STATE IDS. Every entity here declares `state-default` and
 * `state-alt` — the shape the real overfit-18 corpus has, where all twelve state
 * records across every entity carry `state-default`. A resolution that looked a
 * state id up globally would pass a suite that gave each entity unique ids and
 * would be wrong in production.
 *
 * NO PAID PROVIDER CALL IS POSSIBLE HERE. Nothing dispatches a generation. The
 * server functions are evaluated against files in a temporary directory, and the
 * browser sections never leave the vm. FAL is presented as configured only so the
 * preflight reaches its reference checks at all.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const Continuity = require("../public/shared-continuity");
const { deterministicHealth } = require("../agent-suite");
const { render, buildFixture } = require("./render-harness");

let checks = 0;
const ok = (condition, message) => { assert(condition, message); checks++; };
const eq = (actual, expected, message) => {
  /* Values folded into the message: assert.deepStrictEqual suppresses its own
     diff whenever a custom message is supplied. */
  assert.deepStrictEqual(actual, expected, `${message}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  checks++;
};

/* Owner-scoped on purpose: the character and the prop both declare these two
   ids, and they mean different things. */
const DEFAULT_ID = "state-default";
const ALT_ID = "state-alt";

const CLEAN_FILE = "CHAR-RHEA-CLEAN.png";
const WET_FILE = "CHAR-RHEA-WET.png";
const CLOSED_FILE = "PROP-CASE-CLOSED.png";
const OPEN_FILE = "PROP-CASE-OPEN.png";
const DOOR_FILE = "LOC-DOOR.png";

/* ===========================================================================
   The fixture.

   A/B/C rather than A/B, because CineBraid supports any frame structure and a
   model built around a first/last pair would only prove the workflow the UI
   happens to emphasise. A character AND a prop, because one entity's authority
   must never satisfy another's. */

function fixture(options = {}) {
  const {
    wetApproved = false,
    openApproved = false,
    shotStates = {},
    frameStates = {},
  } = options;
  const project = buildFixture();
  project.characters = [{
    id: "CHAR-RHEA", name: "Rhea", status: "APPROVED", approvedFile: CLEAN_FILE,
    continuityStates: [
      { id: DEFAULT_ID, name: "Clean", isDefault: true, approvedFile: CLEAN_FILE },
      { id: ALT_ID, name: "Rain-soaked", stateDelta: "Soaked through.", approvedFile: wetApproved ? WET_FILE : "" },
    ],
  }];
  project.props = [{
    id: "PROP-CASE", name: "Flight case", status: "APPROVED", approvedFile: CLOSED_FILE,
    continuityStates: [
      { id: DEFAULT_ID, name: "Closed", isDefault: true, approvedFile: CLOSED_FILE },
      { id: ALT_ID, name: "Open", stateDelta: "Lid up.", approvedFile: openApproved ? OPEN_FILE : "" },
    ],
  }];
  /* No declared states at all: the legacy shape the whole existing corpus has,
     and the one that must keep resolving to the entity-level file. */
  project.locations = [{ id: "LOC-DOOR", name: "Doorway", status: "APPROVED", approvedFile: DOOR_FILE, continuityStates: [] }];
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

/* Every state file exists on disk in every scenario. Availability is controlled
   purely by whether a state record CLAIMS one, which keeps "this state has no
   approved reference" from being confused with "the file is missing from disk" —
   a different condition with its own existing coverage. */
const DISK_FILES = {
  "anchors/CHAR-RHEA-CLEAN.png": "clean",
  "anchors/CHAR-RHEA-WET.png": "wet",
  "props/PROP-CASE-CLOSED.png": "closed",
  "props/PROP-CASE-OPEN.png": "open",
  "plates/LOC-DOOR.png": "door",
};

/* The browser needs the same files present as project media, or a reference
   resolves to no url for a reason that has nothing to do with this fix. */
function scanFor(project) {
  return {
    anchors: [{ name: CLEAN_FILE, url: `/assets/anchors/${CLEAN_FILE}` }, { name: WET_FILE, url: `/assets/anchors/${WET_FILE}` }],
    plates: [{ name: DOOR_FILE, url: `/assets/plates/${DOOR_FILE}` }],
    props: [{ name: CLOSED_FILE, url: `/assets/props/${CLOSED_FILE}` }, { name: OPEN_FILE, url: `/assets/props/${OPEN_FILE}` }],
    vehicles: [],
    audio: [],
    media: [],
    shots: Object.fromEntries((project.shots || []).map((shot) => [shot.id, { takes: [], locked: [], approved: [] }])),
  };
}

/* ===========================================================================
   1. The rule itself.

   Asserted directly against the single function that owns it, before either
   consumer is driven, so a later failure reads as "this caller stopped using the
   rule" rather than "the rule changed". */

function ruleSection() {
  const rhea = fixture({ wetApproved: true }).characters[0];
  const dry = fixture({ wetApproved: false }).characters[0];
  const state = (entity, id) => entity.continuityStates.find((row) => row.id === id);

  eq(Continuity.stateApprovedFile(rhea, state(rhea, DEFAULT_ID)), CLEAN_FILE,
    "case 1: the default state answers with its own approved file");
  eq(Continuity.stateApprovedFile(rhea, state(rhea, ALT_ID)), WET_FILE,
    "case 2: a non-default state with an approved file answers with THAT file");
  eq(Continuity.stateApprovedFile(dry, state(dry, ALT_ID)), "",
    "case 3: a non-default state with no approved file answers with nothing — never the entity's default image");

  /* The legacy shape, and the reason the entity-level file cannot simply be
     ignored: a default record seeded before per-state approvals existed carries
     an empty approvedFile beside a populated entity.approvedFile. */
  const legacyDefault = { id: DEFAULT_ID, name: "Clean", isDefault: true, approvedFile: "" };
  eq(Continuity.stateApprovedFile(rhea, legacyDefault), CLEAN_FILE,
    "case 1: the entity-level file still answers FOR THE DEFAULT, which is the whole existing corpus");
  eq(Continuity.stateApprovedFile(rhea, null), CLEAN_FILE,
    "case 6: an entity asked about no state at all resolves to its entity-level authority");
  eq(Continuity.stateApprovedFile(null, state(rhea, DEFAULT_ID)), "",
    "no entity, no authority");

  /* Both entities call their non-default state `state-alt`, which is legal and
     permanent — `id.duplicate` is defined per collection and all twelve state
     records in the real overfit-18 corpus carry `state-default`. This function
     answers about the RECORD it is handed and never looks an id up, so owner
     scoping is the caller's resolution step; it is asserted where that step
     happens, in the server and browser sections below. */
  const caseEntity = fixture({ openApproved: true }).props[0];
  eq(Continuity.stateApprovedFile(caseEntity, state(caseEntity, ALT_ID)), OPEN_FILE,
    "case 8: `state-alt` on the prop answers with the prop's file");
  eq(state(dry, ALT_ID).id, state(caseEntity, ALT_ID).id,
    "case 8: and the two entities really do declare the same state id, so the sections below are testing the hard case");
}

/* ===========================================================================
   2. The SERVER authority path.

   The two REAL functions, lifted out of server.js by exact source rather than
   restated, because the only route that reaches derivedFrameContext posts the
   assembled images to a vision provider and this suite makes no paid call. What
   runs here is the shipped code. */

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `server.js no longer declares ${name}; this proof must be updated, not deleted`);
  let depth = 0;
  let seen = false;
  for (let index = source.indexOf("{", start); index < source.length; index++) {
    const character = source[index];
    if (character === "{") { depth++; seen = true; continue; }
    if (character === "}") {
      depth--;
      if (seen && depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`could not find the end of ${name} in server.js`);
}

const SERVER_SOURCE = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");

function serverAuthority(options = {}) {
  const source = options.mutateSource ? String(options.mutateSource(SERVER_SOURCE)) : SERVER_SOURCE;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-state-authority-"));
  for (const folder of ["anchors", "plates", "props", "vehicles", "shots"]) fs.mkdirSync(path.join(temp, folder), { recursive: true });
  for (const [relative, body] of Object.entries(DISK_FILES)) fs.writeFileSync(path.join(temp, relative), body);

  const project = fixture(options);
  const shot = project.shots[0];
  const context = vm.createContext({
    fs, path, console,
    Continuity,
    PROJECT_DIR: () => temp,
    IMG_ONLY: (name) => /\.(png|jpg|jpeg|webp|gif)$/i.test(String(name)),
    projectAssetPath: (file) => (file ? path.join(temp, String(file)) : ""),
    resolveShotEntities: () => ({ characters: project.characters, locations: project.locations, props: project.props, vehicles: [] }),
  });
  vm.runInContext(
    `${extractFunction(source, "entityApprovedDiskPath")}\n${extractFunction(source, "derivedFrameContext")}\n` +
    `globalThis.__direct = (list, entity, stateId) => entityApprovedDiskPath(list, entity, stateId);\n` +
    `globalThis.__frame = (P, shot, frame) => derivedFrameContext(P, shot, frame);`,
    context,
  );

  const name = (file) => (file ? path.basename(file) : "");
  return {
    project, shot, temp, context,
    /* entityApprovedDiskPath() answering one question, as a bare file name. */
    direct: (list, entity, stateId) => name(context.__direct(list, entity, stateId)),
    /* Every design authority derivedFrameContext() would hand a generation for
       one frame, keyed by role. Spread first: the array comes back from the vm
       realm, so its prototype is that realm's Array.prototype and
       deepStrictEqual would refuse two lists whose contents print identically. */
    authorityFor: (frameId) => {
      const frame = shot.keyframes.find((row) => row.id === frameId);
      return [...context.__frame(project, shot, frame)]
        .filter((row) => /authority/.test(row.role))
        .map((row) => path.basename(row.file))
        .sort();
    },
    dispose: () => fs.rmSync(temp, { recursive: true, force: true }),
  };
}

function serverSection() {
  /* --- Cases 1, 2, 3 straight at entityApprovedDiskPath(). --------------- */
  const approved = serverAuthority({ wetApproved: true, openApproved: true });
  try {
    const rhea = approved.project.characters[0], flightCase = approved.project.props[0], door = approved.project.locations[0];
    eq(approved.direct("characters", rhea, ""), CLEAN_FILE, "case 1: no state requested resolves the entity's default authority");
    eq(approved.direct("characters", rhea, DEFAULT_ID), CLEAN_FILE, "case 1: and naming the default state resolves the same file");
    eq(approved.direct("characters", rhea, ALT_ID), WET_FILE, "case 2: a non-default state with an authority resolves THAT authority");
    eq(approved.direct("props", flightCase, ALT_ID), OPEN_FILE, "case 7/8: the prop's `state-alt` resolves the prop's own file");
    eq(approved.direct("locations", door, ""), DOOR_FILE, "case 6: an entity that declares no states at all keeps its entity-level authority");
    /* A state id this entity does not declare is not a "declared non-default
       state". It falls to the default, which is what resolveStateRecord() does
       for the continuity manifest and what the automation preflight reads —
       naming a state the entity does not have is the format layer's `disputed`
       statement to report, not this function's to enforce. */
    eq(approved.direct("characters", rhea, "st-nonexistent"), CLEAN_FILE,
      "an id naming no state on this entity resolves the default, exactly as the manifest and the preflight do");
  } finally { approved.dispose(); }

  /* --- Case 3, the central regression. ----------------------------------- */
  const missing = serverAuthority({ wetApproved: false, openApproved: false });
  try {
    const rhea = missing.project.characters[0], flightCase = missing.project.props[0];
    eq(missing.direct("characters", rhea, ALT_ID), "",
      "case 3: a declared non-default state with no approved file has NO authority — not the clean image");
    eq(missing.direct("props", flightCase, ALT_ID), "",
      "case 3: and the same for the prop, whose default is equally available and equally wrong");
    eq(missing.direct("characters", rhea, ""), CLEAN_FILE,
      "case 1: while the default is untouched by the fix");
  } finally { missing.dispose(); }

  /* A state that claims a file which is not on disk is a different condition and
     still resolves to nothing rather than to the default. */
  const dangling = serverAuthority({ wetApproved: true });
  try {
    dangling.project.characters[0].continuityStates[1].approvedFile = "CHAR-RHEA-NOWHERE.png";
    eq(dangling.direct("characters", dangling.project.characters[0], ALT_ID), "",
      "case 3: a non-default state whose file is missing from disk also resolves to nothing, never to the default");
  } finally { dangling.dispose(); }

  /* --- Case 4: frame override, both directions. -------------------------- */
  const override = serverAuthority({
    wetApproved: true, openApproved: true,
    shotStates: { "CHAR-RHEA": DEFAULT_ID, "PROP-CASE": DEFAULT_ID },
    frameStates: { "fr-b": { character: { "CHAR-RHEA": ALT_ID }, prop: { "PROP-CASE": ALT_ID } } },
  });
  try {
    eq(override.authorityFor("fr-a"), [CLEAN_FILE, DOOR_FILE, CLOSED_FILE].sort(),
      "case 4: Frame A follows the shot, which declares the default");
    eq(override.authorityFor("fr-b"), [WET_FILE, DOOR_FILE, OPEN_FILE].sort(),
      "case 4: Frame B follows its own override, for both entities independently");
    eq(override.authorityFor("fr-c"), [CLEAN_FILE, DOOR_FILE, CLOSED_FILE].sort(),
      "case 9: and Frame C inherits again — inheritance is not a first/last special case");
  } finally { override.dispose(); }

  /* Case 4's failure half: the same override with no approved authority behind
     it. Frame B must lose its character authority, not gain the clean one. */
  const overrideMissing = serverAuthority({
    wetApproved: false, openApproved: true,
    shotStates: { "CHAR-RHEA": DEFAULT_ID },
    frameStates: { "fr-b": { character: { "CHAR-RHEA": ALT_ID } } },
  });
  try {
    eq(overrideMissing.authorityFor("fr-a"), [CLEAN_FILE, DOOR_FILE, CLOSED_FILE].sort(),
      "case 4: Frame A is unaffected by Frame B's problem");
    eq(overrideMissing.authorityFor("fr-b"), [DOOR_FILE, CLOSED_FILE].sort(),
      "case 4: Frame B declares rain-soaked, has no rain-soaked authority, and generates with NO character authority rather than the clean one");
    ok(!overrideMissing.authorityFor("fr-b").includes(CLEAN_FILE),
      "case 3/4: the clean image is nowhere in Frame B's authority package");
  } finally { overrideMissing.dispose(); }

  /* --- Case 5: shot inheritance, which is the P4-SEM-B repair. ----------- */
  const inherited = serverAuthority({ wetApproved: true, shotStates: { "CHAR-RHEA": ALT_ID } });
  try {
    for (const frameId of ["fr-a", "fr-b", "fr-c"])
      eq(inherited.authorityFor(frameId), [WET_FILE, DOOR_FILE, CLOSED_FILE].sort(),
        `case 5/9: frame ${frameId} declares nothing and inherits the shot's rain-soaked authority`);
  } finally { inherited.dispose(); }

  const inheritedMissing = serverAuthority({ wetApproved: false, shotStates: { "CHAR-RHEA": ALT_ID } });
  try {
    eq(inheritedMissing.authorityFor("fr-a"), [DOOR_FILE, CLOSED_FILE].sort(),
      "case 5: an inherited shot state with no authority is missing too — inheritance does not launder the substitution");
  } finally { inheritedMissing.dispose(); }

  /* --- Case 6: nothing declared anywhere. -------------------------------- */
  const undeclared = serverAuthority({ wetApproved: true, openApproved: true });
  try {
    eq(undeclared.authorityFor("fr-b"), [CLEAN_FILE, DOOR_FILE, CLOSED_FILE].sort(),
      "case 6: with no frame binding and no shot binding, every entity resolves its own default");
  } finally { undeclared.dispose(); }

  /* --- Cases 7 and 8: independence, and owner-scoped duplicate ids. ------ */
  const independent = serverAuthority({
    wetApproved: false, openApproved: true,
    frameStates: { "fr-b": { character: { "CHAR-RHEA": ALT_ID }, prop: { "PROP-CASE": ALT_ID } } },
  });
  try {
    /* Both entities declare `state-alt` on Frame B. The prop's is approved and
       the character's is not, and the answer must split cleanly. */
    eq(independent.authorityFor("fr-b"), [DOOR_FILE, OPEN_FILE].sort(),
      "case 7/8: the prop's approved `state-alt` resolves and the character's unapproved `state-alt` resolves to nothing — one entity's authority never satisfies another's");
    ok(!independent.authorityFor("fr-b").includes(CLEAN_FILE),
      "case 7: and the character's default is not substituted in because a DIFFERENT entity's `state-alt` happened to be approved");
  } finally { independent.dispose(); }

  /* --- Case 9: any frame, not only the first and last. ------------------- */
  const perFrame = serverAuthority({
    wetApproved: true, openApproved: true,
    frameStates: {
      "fr-a": { character: { "CHAR-RHEA": DEFAULT_ID } },
      "fr-b": { character: { "CHAR-RHEA": ALT_ID }, prop: { "PROP-CASE": ALT_ID } },
      "fr-c": { prop: { "PROP-CASE": ALT_ID } },
    },
  });
  try {
    eq(perFrame.authorityFor("fr-a"), [CLEAN_FILE, DOOR_FILE, CLOSED_FILE].sort(), "case 9: Frame A resolves its own declared states");
    eq(perFrame.authorityFor("fr-b"), [WET_FILE, DOOR_FILE, OPEN_FILE].sort(), "case 9: Frame B resolves its own, differing from both neighbours");
    eq(perFrame.authorityFor("fr-c"), [CLEAN_FILE, DOOR_FILE, OPEN_FILE].sort(), "case 9: Frame C resolves a third combination again");
  } finally { perFrame.dispose(); }
}

/* ===========================================================================
   3. The BROWSER authority path.

   The shipped scripts in the shipped order. Two readings are covered:
   entityApprovedFileForState(), which is the browser's authority lookup, and the
   reference package a frame generation is actually handed — which reached this
   fix through selectedEntityStateForShot(), a helper that read the SHOT map and
   had no frame parameter at all. */

async function runtime(options = {}) {
  const project = fixture(options);
  const view = await render("#/create", project, { scan: scanFor(project), ...(options.renderOptions || {}) });
  vm.runInContext(`CONFIG = { ...(typeof CONFIG === "object" ? CONFIG : {}), generation: { fal: { enabled: true, apiKey: "state-authority-fixture-key" } } };`, view.context);
  const live = vm.runInContext("P", view.context);
  const shot = live.shots.find((row) => row.id === "SH-01");
  const frames = [...view.context.guidedFrames(shot)];
  return { view, context: view.context, project: live, shot, frames };
}

/* The approved files the reference package for one frame would actually carry
   for one entity. Empty means the generation is handed no authority for it,
   which is the correct outcome for a declared state with none. */
function referenceFilesFor(env, frameId, entityId) {
  const index = env.frames.findIndex((frame) => frame.id === frameId);
  const frame = env.frames[index];
  const state = env.context.guidedFrameState(env.shot, frame, index);
  return [...env.context.guidedFramePromptRefs(env.shot, frame, index, state)]
    .filter((ref) => ref.entityId === entityId && ref.url && !ref.supplemental)
    .map((ref) => ref.file)
    .sort();
}

async function browserSection() {
  /* --- Cases 1, 2, 3 at the browser's authority lookup. ------------------ */
  const approved = await runtime({ wetApproved: true, openApproved: true });
  const rhea = approved.project.characters[0], flightCase = approved.project.props[0];
  eq(approved.context.entityApprovedFileForState(rhea, ""), CLEAN_FILE, "case 1: the browser lookup resolves the default with no state named");
  eq(approved.context.entityApprovedFileForState(rhea, DEFAULT_ID), CLEAN_FILE, "case 1: and with the default named");
  eq(approved.context.entityApprovedFileForState(rhea, ALT_ID), WET_FILE, "case 2: a non-default state with an authority resolves THAT authority");
  eq(approved.context.entityApprovedFileForState(flightCase, ALT_ID), OPEN_FILE, "case 8: `state-alt` on the prop resolves the prop's own file");

  const missing = await runtime({ wetApproved: false, openApproved: false });
  eq(missing.context.entityApprovedFileForState(missing.project.characters[0], ALT_ID), "",
    "case 3: a declared non-default state with no approved file resolves to nothing in the browser too");
  eq(missing.context.entityApprovedFileForState(missing.project.characters[0], ""), CLEAN_FILE,
    "case 1: and the default is untouched");

  /* --- Case 4: the frame's reference package follows the frame. ---------- */
  const override = await runtime({
    wetApproved: true, openApproved: true,
    shotStates: { "CHAR-RHEA": DEFAULT_ID, "PROP-CASE": DEFAULT_ID },
    frameStates: { "fr-b": { character: { "CHAR-RHEA": ALT_ID }, prop: { "PROP-CASE": ALT_ID } } },
  });
  eq(referenceFilesFor(override, "fr-a", "CHAR-RHEA"), [CLEAN_FILE], "case 4: Frame A's package carries the shot's declared clean authority");
  eq(referenceFilesFor(override, "fr-b", "CHAR-RHEA"), [WET_FILE], "case 4: Frame B's package carries its OWN override's rain-soaked authority");
  eq(referenceFilesFor(override, "fr-b", "PROP-CASE"), [OPEN_FILE], "case 4/7: and the prop's override independently");
  eq(referenceFilesFor(override, "fr-c", "CHAR-RHEA"), [CLEAN_FILE], "case 9: Frame C inherits the shot again");

  /* Case 4's failure half through the browser package: the reference is absent,
     not silently swapped for the clean image. */
  const overrideMissing = await runtime({
    wetApproved: false, openApproved: true,
    shotStates: { "CHAR-RHEA": DEFAULT_ID },
    frameStates: { "fr-b": { character: { "CHAR-RHEA": ALT_ID } } },
  });
  eq(referenceFilesFor(overrideMissing, "fr-a", "CHAR-RHEA"), [CLEAN_FILE], "case 4: Frame A still carries the clean authority it declares");
  eq(referenceFilesFor(overrideMissing, "fr-b", "CHAR-RHEA"), [],
    "case 3/4: Frame B declares rain-soaked with no authority and its package carries NO character reference — never the clean one");

  /* --- Case 5: shot inheritance through the browser package. ------------- */
  const inherited = await runtime({ wetApproved: true, shotStates: { "CHAR-RHEA": ALT_ID } });
  for (const frameId of ["fr-a", "fr-b", "fr-c"])
    eq(referenceFilesFor(inherited, frameId, "CHAR-RHEA"), [WET_FILE],
      `case 5/9: frame ${frameId} declares nothing and its package carries the shot's rain-soaked authority`);

  /* --- Case 6: nothing declared. ----------------------------------------- */
  const undeclared = await runtime({ wetApproved: true, openApproved: true });
  eq(referenceFilesFor(undeclared, "fr-b", "CHAR-RHEA"), [CLEAN_FILE], "case 6: with nothing declared the entity default is the package's authority");
  eq(referenceFilesFor(undeclared, "fr-b", "PROP-CASE"), [CLOSED_FILE], "case 6: for every entity");

  /* --- Case 7/8: two entities, the same state ids, different answers. ---- */
  const independent = await runtime({
    wetApproved: false, openApproved: true,
    frameStates: { "fr-b": { character: { "CHAR-RHEA": ALT_ID }, prop: { "PROP-CASE": ALT_ID } } },
  });
  eq(referenceFilesFor(independent, "fr-b", "PROP-CASE"), [OPEN_FILE], "case 8: the prop's approved `state-alt` resolves");
  eq(referenceFilesFor(independent, "fr-b", "CHAR-RHEA"), [],
    "case 7/8: and the character's unapproved `state-alt` resolves to nothing — the prop's approval does not answer for it");

  /* --- The stored reference identity survives a frame override. ---------
     `key` is what composition.referenceSets[].primaryKey, element.referenceKey
     and disabledInputKeys are persisted against. A key that varied per frame
     would silently drop a director's composer selections on any frame that
     declares its own state, so the frame changes the FILE and never the key. */
  const shotKeys = [...override.context.shotCreationReferences(override.shot, "")]
    .filter((ref) => ref.entityId === "CHAR-RHEA" && !ref.supplemental).map((ref) => ref.key).sort();
  const frameKeys = [...override.context.shotCreationReferences(override.shot, "fr-b")]
    .filter((ref) => ref.entityId === "CHAR-RHEA" && !ref.supplemental).map((ref) => ref.key).sort();
  eq(frameKeys, shotKeys, "a frame override changes which approved image answers, not the reference slot's stored identity");
  ok(shotKeys.length === 1, "and there is exactly one character design-authority slot to be confused about");

  /* --- Every non-frame caller reads exactly what it always did. ---------- */
  const shotScoped = [...override.context.shotCreationReferences(override.shot)]
    .filter((ref) => ref.entityId === "CHAR-RHEA" && !ref.supplemental).map((ref) => ref.file);
  eq(shotScoped, [CLEAN_FILE], "with no frame named, the shot's own declared state answers — the display surfaces are unchanged");
}

/* ===========================================================================
   4. Case 10 — the preflight and the authority lookup agree.

   This is the property PR #58 could not finish alone. A preflight that blocks
   while the generator quietly proceeds against the default image is worse than
   either bug on its own, because the operator was told the run was stopped.

   Both readers are the REAL ones: v626ShotPreflight from the shipped browser
   scripts, and entityApprovedDiskPath/derivedFrameContext from server.js. */

const REFERENCE = /reference/;
const referenceErrors = (preflight) => [...preflight.errors].filter((line) => REFERENCE.test(line)).sort();

async function agreementSection() {
  const options = {
    wetApproved: false,
    openApproved: true,
    shotStates: { "CHAR-RHEA": DEFAULT_ID, "PROP-CASE": DEFAULT_ID },
    frameStates: { "fr-b": { character: { "CHAR-RHEA": ALT_ID } } },
  };

  /* --- Before the authority exists: blocked, and missing. ---------------- */
  const blockedRuntime = await runtime(options);
  const blocked = blockedRuntime.context.v626ShotPreflight(blockedRuntime.shot, ["fr-a", "fr-b", "fr-c"]);
  eq(referenceErrors(blocked), ["Frame B declares Rhea as Rain-soaked, which has no approved character reference."],
    "case 10: the preflight blocks the run, naming the frame and the state");

  const blockedServer = serverAuthority(options);
  try {
    eq(blockedServer.direct("characters", blockedServer.project.characters[0], ALT_ID), "",
      "case 10: and the generation authority lookup answers MISSING for the same state");
    ok(!blockedServer.authorityFor("fr-b").includes(CLEAN_FILE),
      "case 10: the two agree — there is no reading in which the preflight blocks and the generator proceeds against the clean image");
  } finally { blockedServer.dispose(); }
  eq(referenceFilesFor(blockedRuntime, "fr-b", "CHAR-RHEA"), [],
    "case 10: and the browser package the generator would send agrees as well");

  /* --- Then the authority is provided. ----------------------------------- */
  const readyOptions = { ...options, wetApproved: true };
  const readyRuntime = await runtime(readyOptions);
  const ready = readyRuntime.context.v626ShotPreflight(readyRuntime.shot, ["fr-a", "fr-b", "fr-c"]);
  eq(referenceErrors(ready), [],
    "case 10: with the rain-soaked authority approved the preflight raises no reference block");

  const readyServer = serverAuthority(readyOptions);
  try {
    eq(readyServer.direct("characters", readyServer.project.characters[0], ALT_ID), WET_FILE,
      "case 10: and the authority lookup resolves the rain-soaked image");
    eq(readyServer.authorityFor("fr-b"), [WET_FILE, DOOR_FILE, CLOSED_FILE].sort(),
      "case 10: which is what Frame B's authority package now carries");
  } finally { readyServer.dispose(); }
  eq(referenceFilesFor(readyRuntime, "fr-b", "CHAR-RHEA"), [WET_FILE],
    "case 10: and the browser package carries the same image, not a different state");

  /* The inverse disagreement is asserted too: ready must not mean "ready for a
     state other than the one declared". */
  eq(referenceFilesFor(readyRuntime, "fr-a", "CHAR-RHEA"), [CLEAN_FILE],
    "case 10: a ready verdict for the run does not make every frame resolve Frame B's state");
}

/* ===========================================================================
   5. The lookup is a question, not a write.

   Authority resolution is read-only. It must not assign a state, copy the
   default's file into a state that lacks one, write a frame or shot selection,
   or save the project. */

async function noMutationSection() {
  /* --- The server path, which is read-only outright. --------------------- */
  const env = serverAuthority({
    wetApproved: false, openApproved: true,
    shotStates: { "CHAR-RHEA": DEFAULT_ID },
    frameStates: { "fr-b": { character: { "CHAR-RHEA": ALT_ID } } },
  });
  try {
    const before = JSON.stringify(env.project);
    const filesBefore = fs.readdirSync(path.join(env.temp, "anchors")).sort().join(",");
    for (let round = 0; round < 3; round++) {
      for (const frameId of ["fr-a", "fr-b", "fr-c"]) env.authorityFor(frameId);
      for (const stateId of ["", DEFAULT_ID, ALT_ID, "st-nonexistent"]) {
        env.direct("characters", env.project.characters[0], stateId);
        env.direct("props", env.project.props[0], stateId);
        env.direct("locations", env.project.locations[0], stateId);
      }
    }
    eq(JSON.stringify(env.project) === before, true,
      "§11: resolving every authority three times over left the project record byte-identical");
    eq(fs.readdirSync(path.join(env.temp, "anchors")).sort().join(","), filesBefore,
      "§11: and copied nothing on disk — a missing state authority is never manufactured by duplicating the default");
    eq(env.project.characters[0].continuityStates[1].approvedFile, "",
      "§11: the unapproved rain-soaked state still has no approvedFile after being asked about repeatedly");
  } finally { env.dispose(); }

  /* --- The browser path. ------------------------------------------------
     entityStateList() normalises an entity on read and has since continuity
     states existed — it seeds a default record and keeps entity.approvedFile
     synced to it. That is stated here rather than asserted away, because a suite
     claiming the browser writes literally nothing would be asserting something
     untrue and would go red later for an unrelated reason. What must hold is
     that resolving an authority declares NOTHING: no state binding appears, no
     state gains an approvedFile, and nothing is saved. */
  const browser = await runtime({
    wetApproved: false, openApproved: true,
    shotStates: { "CHAR-RHEA": DEFAULT_ID },
    frameStates: { "fr-b": { character: { "CHAR-RHEA": ALT_ID } } },
  });
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
  const approvals = () => JSON.parse(JSON.stringify(
    ["characters", "props", "locations"].map((list) => (browser.project[list] || []).map((entity) => [
      entity.id, entity.approvedFile || "", (entity.continuityStates || []).map((state) => `${state.id}=${state.approvedFile || ""}`).join("|"),
    ])),
  ));

  /* One normalising pass first, so what is compared is the effect of RESOLVING
     rather than the effect of entityStateList()'s long-standing repair. */
  referenceFilesFor(browser, "fr-a", "CHAR-RHEA");
  const beforeDeclared = declared(browser.shot);
  const beforeApprovals = approvals();
  for (let round = 0; round < 3; round++) {
    for (const frameId of ["fr-a", "fr-b", "fr-c"]) {
      referenceFilesFor(browser, frameId, "CHAR-RHEA");
      referenceFilesFor(browser, frameId, "PROP-CASE");
    }
    browser.context.entityApprovedFileForState(browser.project.characters[0], ALT_ID);
    browser.context.shotCreationReferences(browser.shot, "fr-b");
  }
  eq(declared(browser.shot), beforeDeclared,
    "§11: resolving every frame's authority three times declared nothing new — no frame gained a state, no shot binding moved");
  eq(beforeDeclared, { "shot/CHAR-RHEA": DEFAULT_ID, "fr-b/CHAR-RHEA": ALT_ID },
    "§11: and what is declared is exactly the fixture — frames A and C say nothing, which is how they inherit");
  eq(approvals(), beforeApprovals,
    "§11: and no state gained an approvedFile — the default's image was never copied into the state that lacks one");
  eq(browser.project.characters[0].continuityStates[1].approvedFile, "",
    "§11: rain-soaked still has no approved reference of its own");
}

/* ===========================================================================
   6. The FLF motion-readiness gate is not this batch's business.

   This repair chooses which approved image is a reference authority. Whether two
   frames are motion-compatible is a different question with a different owner,
   and B2b is where gating systems get compared. Pinned here so a later change
   that quietly reroutes it through continuity state resolution goes red. */

function motionGateSection() {
  const project = fixture({ wetApproved: false });
  const shot = project.shots[0];
  shot.clips = [{ id: "seg-1", kind: "flf", label: "1", fromFrame: "fr-a", toFrame: "fr-b", motionPrompt: "She steps out." }];
  shot.keyframes[0].winner = "fr-a-approved.png";
  const blocked = deterministicHealth(project, { shots: {} }).filter((entry) => entry.type === "blocked-flf");
  eq(blocked.map((entry) => entry.reason), ["FLF requires approved first and last frames."],
    "the FLF gate still blocks unapproved endpoints in its own words, untouched by this repair");

  const source = fs.readFileSync(path.join(ROOT, "agent-suite.js"), "utf8");
  const start = source.indexOf('if (c.kind === "flf")');
  const end = source.indexOf('reason: "FLF requires approved first and last frames."');
  ok(start >= 0 && end > start, "the FLF gate is still where it was, in agent-suite.js");
  ok(!/continuity|resolveDeclaredStateId|StateSelections|stateApprovedFile|entityApproved/i.test(source.slice(start, end)),
    "and nothing routes the motion go/no-go decision through continuity state resolution or authority selection");
}

/* ===========================================================================
   7. Nothing here can spend money.

   Asserted rather than asserted-about: the shipped generation dispatcher must
   not appear anywhere this suite's paths lead, and the suite never calls it. */

function noPaidCallsSection() {
  const self = fs.readFileSync(__filename, "utf8");
  /* Assembled from fragments so the guard does not match its own name list and
     report a violation it created. */
  const forbidden = ["submitFal" + "Job", "v626Wait" + "FalJob", "queue.fal" + ".run", "runShot" + "Automation"];
  for (const name of forbidden)
    ok(!self.includes(name), `this suite must never reference ${name}; it makes no provider call`);
  /* FAL is presented as configured only so the preflight reaches its reference
     checks; the credential is an obvious fixture string and reaches nothing. */
  ok(self.includes("state-authority-fixture-key"),
    "the only key this suite sets is a fixture string, and it never leaves the vm");
}

/* ------------------------------------------------------------------------- */

async function main() {
  ruleSection();
  serverSection();
  await browserSection();
  await agreementSection();
  await noMutationSection();
  motionGateSection();
  noPaidCallsSection();

  /* server.js was read into memory and lifted from by exact source. It must be
     byte-identical to what was read at the top of this file. */
  assert.strictEqual(fs.readFileSync(path.join(ROOT, "server.js"), "utf8"), SERVER_SOURCE,
    "server.js was modified on disk — this suite reads it and never writes it");

  console.log(`State-specific authority passed ${checks} checks: a declared non-default state resolves its OWN approved image or nothing at all, the default keeps the entity-level file it has always used, frame overrides and shot inheritance both follow the P4-SEM-B canonical rule across A/B/C and across entities that share state ids, the automation preflight and the generation authority lookup answer the same question the same way, resolution writes nothing, and the FLF motion gate is exactly where it was. Provider calls made: 0.`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});

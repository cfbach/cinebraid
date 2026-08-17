/* P4-SEM-B — canonical shot and frame continuity-state bindings.
 *
 * THE PROPERTY THIS FILE EXISTS FOR, in one line: a declared entity state is one
 * fact with one owner, so the state a project SAYS a frame uses and the
 * authority image CineBraid generates that frame against cannot disagree.
 *
 * Before this batch the fact existed only as runtime storage. `resolveDeclaredStateId`
 * in public/shared-continuity.js resolved frame -> shot -> entity default and the
 * continuity manifest used it, but:
 *
 *   - OFP had no home for it. M042 preserved `shot.continuityStateSelections`
 *     and M014 preserved `creationBrief.frameWorkflows` into
 *     extensions["com.cinebraid.legacy"].preserved[], so a migrated project
 *     carried a director's declared state change as an opaque blob and no other
 *     client could read it, validate it or honour it;
 *   - server.js `derivedFrameContext` — the code that picks which approved image
 *     is a frame's design authority — read the frame's own workflow maps and
 *     then fell straight past the SHOT's declared state to the entity default.
 *     A shot that declared "Rhea is rain-soaked" therefore generated every
 *     unoverridden frame against the clean authority. That is case 18.
 *
 * The tests below drive the real paths: the shared contract directly, the real
 * runtime resolver, the real OFP schema, validator, serializer and migration,
 * the two REAL server functions that choose an authority image, a real
 * save/reload through a real server process, and the real FLF motion gate.
 *
 * THE READING THAT MATTERS, asserted rather than assumed: STATE IDS ARE
 * OWNER-SCOPED. All twelve state records across every entity of the real
 * overfit-18 generation carry the id `state-default` — legal, because
 * `id.duplicate` is defined per collection, and permanent. So a binding never
 * says `stateId` alone and no resolution anywhere may look a state id up
 * globally. Case 7 is three entities all saying `state-default` and all meaning
 * something different.
 *
 * NO PAID PROVIDER CALL IS POSSIBLE HERE. Nothing dispatches a generation; the
 * two authority functions are evaluated against files on disk in a temporary
 * directory, and the server section spawns server.js against a temporary
 * projects root with no provider credentials.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const Binding = require("../public/shared-continuity-binding");
const Continuity = require("../public/shared-continuity");
const Schema = require("../ofp/ofp-schema");
const { validateOfpDocument } = require("../ofp/ofp-validate");
const { DIAGNOSTICS } = require("../ofp/ofp-diagnostics");
const { serializeCanonical } = require("../ofp/ofp-serialize");
const { parseJsonStrict } = require("../ofp/ofp-json");
const { previewLegacyMigration } = require("../ofp/ofp-migrate");
const { ruleById } = require("../ofp/ofp-migrate-rules");
const { deterministicHealth } = require("../agent-suite");

const AT = "2026-08-10T00:00:00Z";
const LEGACY_FIXTURE = path.join(__dirname, "fixtures", "ofp-legacy", "continuity-state-bindings.json");
const OFP_FIXTURE = path.join(__dirname, "fixtures", "ofp", "continuity-bindings.ofp.json");
const BROKEN_FIXTURE = path.join(__dirname, "fixtures", "ofp", "continuity-bindings-broken.ofp.json");

let checks = 0;
const ok = (condition, message) => { assert(condition, message); checks++; };
const eq = (actual, expected, message) => {
  /* The values are folded into the message: assert.deepStrictEqual suppresses
     its own diff whenever a custom message is supplied, and a bare "case 4
     failed" with no values is the least useful thing a suite can print. */
  assert.deepStrictEqual(actual, expected, `${message}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  checks++;
};
const readText = (file) => fs.readFileSync(file, "utf8");
const loadLegacy = () => parseJsonStrict(readText(LEGACY_FIXTURE));
const codesOf = (result) => result.diagnostics.map((entry) => entry.code);
/* Source pointers are positional; the document is keyed by id. One place
   translates between them so an off-by-one reads as a lookup failure. */
const legacyShotIndex = (legacy, shotId) => {
  const index = legacy.shots.findIndex((shot) => shot.id === shotId);
  assert(index >= 0, `the fixture has no shot ${shotId}`);
  return index;
};

/* ===========================================================================
   The runtime fixture.

   A/B/C rather than A/B, because CineBraid supports any frame structure and a
   model designed around a first/last pair would be a model that only works for
   the workflow the UI happens to emphasise. */

const CLEAN = "st-rhea-clean";
const WET = "st-rhea-wet";

function runtimeProject() {
  return {
    meta: { title: "Binding fixture", schemaVersion: "6.7" },
    scenes: [{ id: "SC-01", title: "The doorway" }],
    shots: [{
      id: "SH-01",
      scene: "SC-01",
      title: "Rhea in the doorway",
      desc: "She steps out of the rain and back into it.",
      characters: ["CHAR-RHEA"],
      codes: ["PROP-CASE"],
      continuityStateSelections: { "CHAR-RHEA": CLEAN },
      keyframes: [
        { id: "fr-a", label: "A", description: "Dry, under the awning." },
        { id: "fr-b", label: "B", description: "Out in it." },
        { id: "fr-c", label: "C", description: "Back under, still soaked." },
      ],
      clips: [],
      creationBrief: { locationId: "LOC-DOOR", propIds: ["PROP-CASE"], frameWorkflows: {} },
    }],
    characters: [{
      id: "CHAR-RHEA",
      name: "Rhea",
      approvedFile: "CHAR-RHEA-CLEAN.png",
      continuityStates: [
        { id: CLEAN, name: "Clean", isDefault: true, approvedFile: "CHAR-RHEA-CLEAN.png" },
        { id: WET, name: "Rain-soaked", approvedFile: "CHAR-RHEA-WET.png" },
      ],
    }],
    locations: [{
      id: "LOC-DOOR",
      name: "The doorway",
      approvedFile: "LOC-DOOR-DAY.png",
      continuityStates: [
        { id: "st-door-day", name: "Day", isDefault: true, approvedFile: "LOC-DOOR-DAY.png" },
        { id: "st-door-night", name: "Night", approvedFile: "LOC-DOOR-NIGHT.png" },
      ],
    }],
    props: [{
      id: "PROP-CASE",
      name: "The case",
      approvedFile: "PROP-CASE-CLOSED.png",
      continuityStates: [
        { id: "st-case-closed", name: "Closed", isDefault: true, approvedFile: "PROP-CASE-CLOSED.png" },
        { id: "st-case-open", name: "Open", approvedFile: "PROP-CASE-OPEN.png" },
      ],
    }],
    vehicles: [], audio: [], mediaAssets: [], jobs: [], agentRuns: [], decisions: [], sessions: [],
  };
}

/* The runtime writers, spelled exactly as the shipped UI writes them, so this
   suite exercises the storage the app really produces rather than a convenient
   one. public/app.js setShotContinuityState and public/continuity-workspace.js
   setFrameContinuityState are the two originals. */
function setShotState(shot, entityId, stateId) {
  shot.continuityStateSelections = shot.continuityStateSelections || {};
  if (stateId) shot.continuityStateSelections[entityId] = stateId;
  else delete shot.continuityStateSelections[entityId];
}
const FRAME_KEYS = { character: "characterStateSelections", prop: "propStateSelections", vehicle: "vehicleStateSelections" };
function setFrameState(shot, frameId, kind, entityId, stateId) {
  const creation = shot.creationBrief = shot.creationBrief || {};
  creation.frameWorkflows = creation.frameWorkflows || {};
  const workflow = creation.frameWorkflows[frameId] = creation.frameWorkflows[frameId] || {};
  const value = String(stateId || "");
  if (kind === "location") {
    if (value) workflow.locationStateId = value;
    else delete workflow.locationStateId;
    return;
  }
  const key = FRAME_KEYS[kind] || FRAME_KEYS.prop;
  const map = workflow[key] = workflow[key] || {};
  if (value) map[entityId] = value;
  else delete map[entityId];
  if (!Object.keys(map).length) delete workflow[key];
}

/* ===========================================================================
   1. The contract: precedence, absence, removal, independence, owner scope. */

function contractSection() {
  const project = runtimeProject();
  const shot = project.shots[0];

  /* Case 3 — a shot binding beats the entity default. The entity's own default
     is `clean`, and the shot says `wet`, and the shot wins on all three frames
     because none of them disagrees. */
  setShotState(shot, "CHAR-RHEA", WET);
  for (const frameId of ["fr-a", "fr-b", "fr-c"])
    eq(Continuity.resolveDeclaredStateId(shot, frameId, "character", "CHAR-RHEA"), WET,
      `case 3: frame ${frameId} must resolve the shot's declared state, not the entity default`);
  /* Case 1 — shot-only, resolved through the canonical model as well. */
  eq(Binding.resolveBoundStateId(Binding.readShotStateBindings(shot), "fr-a", "CHAR-RHEA"), WET,
    "case 1: a shot-level binding with no frame override resolves for every frame");

  /* Case 4 — absence inherits, and absence is the ONLY way inheritance is
     spelled. Nothing is written into the frame to say "same as the shot". */
  setShotState(shot, "CHAR-RHEA", CLEAN);
  setFrameState(shot, "fr-b", "character", "CHAR-RHEA", WET);
  eq(Continuity.resolveDeclaredStateId(shot, "fr-a", "character", "CHAR-RHEA"), CLEAN, "case 4: frame A with no override inherits the shot");
  /* Case 2 — the frame override beats the shot binding. */
  eq(Continuity.resolveDeclaredStateId(shot, "fr-b", "character", "CHAR-RHEA"), WET, "case 2: an explicit frame override beats the shot binding");
  eq(Continuity.resolveDeclaredStateId(shot, "fr-c", "character", "CHAR-RHEA"), CLEAN, "case 4: and frame C, which said nothing, still inherits");
  ok(!("fr-a" in shot.creationBrief.frameWorkflows) && !("fr-c" in shot.creationBrief.frameWorkflows),
    "case 4: an inheriting frame stores nothing at all — there is no inherit marker to store");

  /* An explicit frame override does not mutate the shot default, and moving the
     shot default does not overwrite the override. Both directions, because a
     writer that copied one into the other would pass one of them. */
  eq(shot.continuityStateSelections["CHAR-RHEA"], CLEAN, "an explicit frame override must not rewrite the shot default");
  setShotState(shot, "CHAR-RHEA", WET);
  eq(shot.creationBrief.frameWorkflows["fr-b"].characterStateSelections["CHAR-RHEA"], WET,
    "changing the shot default must leave an explicit frame override exactly where it was");
  setShotState(shot, "CHAR-RHEA", CLEAN);

  /* Case 5 — removing the override restores inheritance, and restores it by
     REMOVING data rather than by writing the inherited value back. */
  setFrameState(shot, "fr-b", "character", "CHAR-RHEA", "");
  eq(Continuity.resolveDeclaredStateId(shot, "fr-b", "character", "CHAR-RHEA"), CLEAN,
    "case 5: clearing a frame override falls back to the shot binding");
  ok(!shot.creationBrief.frameWorkflows["fr-b"].characterStateSelections,
    "case 5: and the cleared map is removed rather than left holding an empty string");

  /* And with nothing declared anywhere, the resolver says so instead of
     guessing a default it has no entity to read. */
  setShotState(shot, "CHAR-RHEA", "");
  eq(Continuity.resolveDeclaredStateId(shot, "fr-b", "character", "CHAR-RHEA"), "",
    "with nothing declared, the resolver returns nothing and the caller applies the entity's own default");
  eq(Continuity.resolveStateRecord(project.characters[0], "").id, CLEAN,
    "and the entity's own default is what the caller then resolves");

  /* Case 6 — three entities, resolved independently. Case 11 — three frames. */
  setShotState(shot, "CHAR-RHEA", CLEAN);
  setShotState(shot, "PROP-CASE", "st-case-closed");
  setShotState(shot, "LOC-DOOR", "st-door-day");
  setFrameState(shot, "fr-b", "character", "CHAR-RHEA", WET);
  setFrameState(shot, "fr-b", "prop", "PROP-CASE", "st-case-open");
  setFrameState(shot, "fr-c", "character", "CHAR-RHEA", WET);
  setFrameState(shot, "fr-c", "location", "LOC-DOOR", "st-door-night");
  const resolved = (frameId) => [
    Continuity.resolveDeclaredStateId(shot, frameId, "character", "CHAR-RHEA"),
    Continuity.resolveDeclaredStateId(shot, frameId, "prop", "PROP-CASE"),
    Continuity.resolveDeclaredStateId(shot, frameId, "location", "LOC-DOOR"),
  ];
  eq(resolved("fr-a"), [CLEAN, "st-case-closed", "st-door-day"], "case 6/11: frame A inherits all three");
  eq(resolved("fr-b"), [WET, "st-case-open", "st-door-day"], "case 6/11: frame B overrides two and inherits the third");
  eq(resolved("fr-c"), [WET, "st-door-day" === "" ? "" : "st-case-closed", "st-door-night"], "case 6/11: frame C overrides two different ones");

  /* Case 7 — THE ONE THAT MATTERS. Three entities, one state id, three
     different states. A resolver that looked `state-default` up globally would
     answer the same thing three times and be wrong twice. */
  const duplicated = {
    id: "SH-DUP",
    continuityStateSelections: { A: "state-default", B: "state-default", C: "state-default" },
    creationBrief: {
      frameWorkflows: {
        "fr-b": {
          characterStateSelections: { A: "state-alt" },
          propStateSelections: { B: "state-alt" },
          locationStateSelections: { C: "state-alt" },
        },
      },
    },
  };
  const catalogues = {
    A: [{ id: "state-default", name: "Apron on", isDefault: true }, { id: "state-alt", name: "Apron off" }],
    B: [{ id: "state-default", name: "Drawer shut", isDefault: true }, { id: "state-alt", name: "Drawer out" }],
    C: [{ id: "state-default", name: "Shutter up", isDefault: true }, { id: "state-alt", name: "Shuttered" }],
  };
  for (const [entityId, kind] of [["A", "character"], ["B", "prop"], ["C", "location"]]) {
    eq(Continuity.resolveDeclaredStateId(duplicated, "fr-a", kind, entityId), "state-default",
      `case 7: ${entityId} inherits its OWN state-default`);
    eq(Continuity.resolveDeclaredStateId(duplicated, "fr-b", kind, entityId), "state-alt",
      `case 7: ${entityId} overrides to its OWN state-alt`);
    const entity = { id: entityId, continuityStates: catalogues[entityId] };
    eq(Continuity.resolveStateRecord(entity, "state-alt").name, catalogues[entityId][1].name,
      `case 7: and the resolved record is ${entityId}'s own, not another entity's record with the same id`);
    ok(Binding.stateIdBelongsToEntity(catalogues[entityId], "state-alt"),
      `case 7: owner-scoped resolution admits ${entityId}'s own state`);
  }
  ok(!Binding.stateIdBelongsToEntity(catalogues.A, "state-nobody-has"),
    "case 7: and refuses a state no entity in the pair declares");

  /* The runtime keys are named in one place. A surface spelling one of them by
     hand is how the shot and frame stores drifted apart in the first place. */
  eq(Binding.RUNTIME_SHOT_SELECTION_KEY, "continuityStateSelections", "the shot storage key is declared by the contract");
  eq(Object.values(Binding.RUNTIME_FRAME_SELECTION_KEYS).sort(),
    ["characterStateSelections", "locationStateSelections", "propStateSelections", "vehicleStateSelections"],
    "and so are the four frame maps");

  /* Reading is read-only. A binding set built during a migration preview must
     not be able to touch the project it was built from. */
  const pristine = runtimeProject();
  const before = JSON.stringify(pristine);
  Binding.readShotStateBindings(pristine.shots[0], { locationEntityId: "LOC-DOOR", frameIds: ["fr-a", "fr-b", "fr-c"] });
  Continuity.resolveDeclaredStateId(pristine.shots[0], "fr-b", "character", "CHAR-RHEA");
  eq(JSON.stringify(pristine), before, "reading declared bindings must not create a key, normalize a workflow or repair a shot");
}

/* ===========================================================================
   2. One rule, two representations, proved not to drift.

   Equal answers on one case would not settle it. Every frame of every shot is
   asked about every entity that shot CONTAINS, of the RUNTIME record and of the
   SERIALIZED continuity profile built from it, and the two must agree on all of
   them — including the cases where the answer is "nothing is declared".

   THE DOMAIN IS DISCLOSED, NOT ASSUMED, and it is asserted below rather than
   quietly chosen. The two representations are both defined over the entities a
   shot contains: `subjects[]` plus `setting.locationId`. That is the set every
   real caller iterates — the continuity manifest walks the shot's dependency
   records, `derivedFrameContext` walks the shot's resolved entities — and it is
   the set the contract enforces, since a binding outside it is
   `continuity.binding.entity-unlisted`. Outside that domain the RUNTIME storage
   is genuinely ambiguous and the boundary case is pinned on its own below. */

function driftSection() {
  const legacy = loadLegacy();
  const result = previewLegacyMigration(legacy, { at: AT });
  ok(result.ok, "the fixture must migrate cleanly");
  const profile = result.candidate.continuity;
  ok(profile, "case 14: migration must produce a continuity profile");

  const kindOf = (id) => (legacy.characters.some((row) => row.id === id) ? "character"
    : legacy.locations.some((row) => row.id === id) ? "location"
      : legacy.props.some((row) => row.id === id) ? "prop" : "vehicle");
  const migratedShots = new Map(result.candidate.shots.map((shot) => [shot.id, shot]));
  const containedBy = (shotId) => {
    const shot = migratedShots.get(shotId) || {};
    const ids = (shot.subjects || []).map((entry) => entry.entityId).filter(Boolean);
    if (shot.setting && shot.setting.locationId) ids.push(shot.setting.locationId);
    return [...new Set(ids)];
  };

  let compared = 0;
  let declared = 0;
  for (const shot of legacy.shots) {
    /* BIND-E is the shot whose every selection migration refused, so the
       runtime resolves values the profile deliberately does not carry.
       Comparing it here would assert that migration invented them; it is
       asserted separately, as a refusal, in the OFP section. */
    if (shot.id === "BIND-E") continue;
    const frameIds = ["", ...shot.keyframes.map((frame) => frame.id), "fr-does-not-exist"];
    for (const frameId of frameIds)
      for (const entityId of containedBy(shot.id)) {
        const runtime = Continuity.resolveDeclaredStateId(shot, frameId, kindOf(entityId), entityId);
        const canonical = Binding.resolveProfileStateId(profile, shot.id, frameId, entityId);
        assert.strictEqual(canonical, runtime,
          `the runtime record and the continuity profile disagree about ${shot.id} / ${frameId || "(no frame)"} / ${entityId}: runtime ${JSON.stringify(runtime)}, profile ${JSON.stringify(canonical)}`);
        compared++;
        if (runtime) declared++;
      }
  }
  checks += 2;
  ok(compared >= 40, `the drift guard must actually compare something: ${compared} questions asked`);
  ok(declared >= 15, `and a useful number of them must be genuinely declared: ${declared}`);

  /* THE BOUNDARY, pinned so it cannot move without somebody noticing.

     A frame's bare `locationStateId` is the one legacy shape that carries no
     entity of its own, so the runtime resolver hands it to whichever location
     it is ASKED about. Inside the domain that is correct and the two agree.
     Outside it the storage is ambiguous, and the canonical model refuses to
     guess an owner rather than inheriting the ambiguity — §11's rule. This is a
     property of the legacy storage, not something P4-SEM-B introduced, and it
     is recorded here rather than hidden by a guard that only asks easy
     questions. */
  const bindC = legacy.shots.find((shot) => shot.id === "BIND-C");
  eq(Continuity.resolveDeclaredStateId(bindC, "kf-c", "location", "LOC-DOOR"), "st-door-night",
    "the shot's own location resolves the bare frame location state");
  eq(Binding.resolveProfileStateId(profile, "BIND-C", "kf-c", "LOC-DOOR"), "st-door-night",
    "and the canonical profile says the same for the entity the shot contains");
  eq(Continuity.resolveDeclaredStateId(bindC, "kf-c", "location", "LOC-DUPE"), "st-door-night",
    "the legacy bare state has no owner in the runtime storage, so any location asked about receives it");
  eq(Binding.resolveProfileStateId(profile, "BIND-C", "kf-c", "LOC-DUPE"), "",
    "and the canonical model refuses to attribute it to a location the shot does not contain, rather than carrying the ambiguity forward");
  ok(!(profile.shots.find((entry) => entry.shotId === "BIND-C").frames || [])
    .some((frame) => (frame.entityStates || []).some((entry) => entry.entityId === "LOC-DUPE")),
  "no binding is written for an entity the shot does not contain, which is also what the validator refuses to accept");

  /* And the same after a full serialize / re-read, which is case 13. */
  const reread = parseJsonStrict(serializeCanonical(result.candidate));
  eq(reread.continuity, profile, "case 13: canonical serialization and re-reading preserve the profile exactly");
  eq(Binding.resolveProfileStateId(reread.continuity, "BIND-B", "kf-b", "CHAR-RHEA"), WET,
    "case 13: and the frame override still resolves after a round trip");
  eq(Binding.resolveProfileStateId(reread.continuity, "BIND-B", "kf-a", "CHAR-RHEA"), CLEAN,
    "case 13: and frame A still inherits the shot");
}

/* ===========================================================================
   3. OFP: the schema, the validator, migration, the corpus. */

function ofpSection() {
  /* The binding is NOT in core. shots[].subjects[] and FRAME are untouched, and
     nothing in the profile is an addressable record type. */
  eq(Object.keys(Schema.records.SHOT.properties.subjects.items.properties).sort(), ["entityId", "role"],
    "P4-SEM-B must not add a stateId to shot.subjects[]");
  eq(Object.keys(Schema.records.FRAME.properties).sort(), ["description", "id", "role"],
    "and must not add a binding to the frame record");
  eq(Object.keys(Schema.CONTAINMENT).length, 17, "the containment table is the frozen list of addressable types and gains nothing");
  ok(!("continuity" in Schema.CONTAINMENT) && !("binding" in Schema.CONTAINMENT),
    "no continuity structure may become an addressable record type");

  /* The interior is MODELLED, not passthrough. This is the line the Q1 decision
     said would cost something and had to be paid deliberately: checkRefs stops
     at a passthrough object, so a binding inside one gets no validation at all. */
  const continuity = Schema.DOCUMENT.properties.continuity;
  ok(!continuity.passthrough, "the continuity profile interior must be modelled, or nothing validates a binding");
  eq(continuity.profile, "continuity", "and it is still declared as a profile");
  const entityState = continuity.properties.shots.items.properties.entityStates.items;
  eq(entityState.properties.entityId.ref, "entity", "entityId is globally resolvable, exactly like subjects[].entityId");
  ok(!("ref" in entityState.properties.stateId), "stateId must carry NO ref: state ids are owner-scoped and a global index would resolve the wrong entity's state");
  ok(!("ref" in continuity.properties.shots.items.properties.frames.items.properties.frameId),
    "frameId must carry NO ref either: frames are scoped to their shot");
  eq(continuity.properties.shots.items.properties.shotId.ref, "shot", "shotId is globally resolvable");

  /* The golden document validates clean, including the three entities that all
     declare `state-default`. */
  const valid = validateOfpDocument(readText(OFP_FIXTURE));
  eq(valid.counts.error, 0, `the continuity fixture must be valid: ${JSON.stringify(valid.diagnostics.filter((d) => d.severity === "error"))}`);
  eq(valid.counts.warning, 0, "and must produce no warnings; a modelled profile is not an unknown subtree");
  const document = valid.document;
  eq(Binding.resolveProfileStateId(document.continuity, "sh-0200", "fr-a", "char-rhea"), "state-default", "case 7 in OFP: frame A inherits the shot");
  eq(Binding.resolveProfileStateId(document.continuity, "sh-0200", "fr-b", "prop-case"), "state-alt", "case 7 in OFP: the prop's own state-alt");
  eq(Binding.resolveProfileStateId(document.continuity, "sh-0200", "fr-c", "loc-door"), "state-alt", "case 7 in OFP: the location's own state-alt");
  eq(Binding.resolveProfileStateId(document.continuity, "sh-0200", "fr-b", "loc-door"), "state-default",
    "case 7 in OFP: and an entity that did not override still inherits its own state-default");

  /* THE VALIDATOR REPORTS; IT DOES NOT REPAIR. Modelling the profile interior
     means the validator now walks inside it, which is exactly where a helpful
     default would get minted — an absent `frames`, a blank `stateId` filled in
     with `state-default`. A document that has merely been LOOKED AT must come
     back byte-identical, so the whole block is snapshotted around a validation
     of both the parsed and the text form. */
  for (const name of [OFP_FIXTURE, BROKEN_FIXTURE]) {
    const parsed = parseJsonStrict(readText(name));
    const snapshot = JSON.stringify(parsed);
    validateOfpDocument(parsed);
    eq(JSON.stringify(parsed), snapshot, `${path.basename(name)}: validating must not change one byte of the continuity profile`);
    eq(JSON.stringify(validateOfpDocument(readText(name)).document), snapshot, `${path.basename(name)}: and text-form validation must inject nothing on the way through`);
  }
  const sparse = {
    format: { id: "open-film-project", version: "1.0-draft.1", profiles: ["core", "continuity"] },
    shots: [{ id: "sh-0100", frames: [{ id: "fr-a" }], subjects: [{ entityId: "char-a" }] }],
    entities: { characters: [{ id: "char-a", states: [{ id: "state-default" }] }] },
    continuity: { shots: [{ shotId: "sh-0100", entityStates: [{ entityId: "char-a", stateId: "state-default" }] }] },
  };
  const sparseBefore = JSON.stringify(sparse);
  validateOfpDocument(sparse);
  eq(JSON.stringify(sparse), sparseBefore, "a sparse binding gains no frames collection, no role and no default by being inspected");
  ok(!("frames" in sparse.continuity.shots[0]), "and absence still means inherit rather than an empty override list");

  /* Cases 8, 9 and 10 — the validator catches what generic reference checking
     structurally cannot. */
  const broken = validateOfpDocument(readText(BROKEN_FIXTURE));
  const codes = codesOf(broken);
  ok(codes.includes("continuity.binding.state-unresolved"), "case 8: a state the entity does not declare is rejected");
  ok(codes.includes("continuity.binding.entity-unlisted"), "case 9: a binding for an entity the shot does not contain is rejected");
  /* Case 10 — all three shapes of "one scope, said twice", each asserted at its
     own location. `codes.includes` alone would let two of the three regress
     unnoticed, because any one of them puts the code in the list. */
  const duplicateWheres = broken.diagnostics.filter((entry) => entry.code === "continuity.binding.duplicate").map((entry) => entry.where).sort();
  ok(duplicateWheres.includes("/continuity/shots/0/entityStates"),
    `case 10: two bindings for one entity at one scope are rejected (reported at ${JSON.stringify(duplicateWheres)})`);
  ok(duplicateWheres.includes("/continuity/shots/1"),
    `case 10: and so are two continuity entries for one shot (reported at ${JSON.stringify(duplicateWheres)})`);
  ok(codes.includes("continuity.binding.frame-unknown"), "a frame-level binding naming another shot's frame is rejected");
  ok(codes.includes("continuity.profile.undeclared"), "and profile data with no profile declaration is rejected");
  eq(broken.ok, false, "a document carrying any of those is not valid");
  for (const diagnostic of broken.diagnostics) {
    ok(DIAGNOSTICS[diagnostic.code], `${diagnostic.code} must be registered`);
    eq(diagnostic.severity, DIAGNOSTICS[diagnostic.code].severity, `${diagnostic.code} takes its severity from the registry`);
  }

  /* Case 9, stated precisely: a state from the WRONG entity is rejected even
     though the id exists somewhere in the document. This is the failure a
     global state index would let through, so it is asserted on its own. */
  const crossed = parseJsonStrict(readText(OFP_FIXTURE));
  crossed.continuity.shots[0].entityStates = [{ entityId: "char-rhea", stateId: "state-only-the-prop-has" }];
  crossed.entities.props[0].states.push({ id: "state-only-the-prop-has", name: "Dented" });
  const crossedResult = validateOfpDocument(crossed);
  ok(codesOf(crossedResult).includes("continuity.binding.state-unresolved"),
    "case 9: a state id that exists on a DIFFERENT entity does not resolve for this one");

  /* Case 16 — an unrecognised key inside the profile is preserved and reported
     as a warning, exactly like an unrecognised key on a core record. The
     profile is a declared shape, not a closed one. */
  const foreign = parseJsonStrict(readText(OFP_FIXTURE));
  foreign.continuity.tracking = { "char-rhea": { note: "a later continuity feature" } };
  foreign.continuity.shots[0].futureField = "kept";
  const foreignResult = validateOfpDocument(foreign);
  eq(foreignResult.counts.error, 0, "case 16: unknown continuity content is not an error");
  ok(codesOf(foreignResult).includes("schema.unknown-property"), "case 16: it is reported");
  const rewritten = parseJsonStrict(serializeCanonical(foreign));
  eq(rewritten.continuity.tracking, foreign.continuity.tracking, "case 16: and it survives a canonical write deep-equal");
  eq(rewritten.continuity.shots[0].futureField, "kept", "case 16: including an unknown key beside a modelled one");
  eq(Binding.resolveProfileStateId(rewritten.continuity, "sh-0100", "", "char-rhea"), "state-alt",
    "case 16: and the modelled bindings beside it still resolve");

  /* An empty block is not participation. A tool that round-tripped
     `continuity: {}` without ever writing a binding is not failing to declare a
     profile it does not use. */
  const emptyBlock = parseJsonStrict(readText(OFP_FIXTURE));
  emptyBlock.continuity = {};
  emptyBlock.format.profiles = ["core"];
  ok(!codesOf(validateOfpDocument(emptyBlock)).includes("continuity.profile.undeclared"),
    "an empty continuity block is not profile data and does not demand a declaration");

  /* Case 15 — migration declares the profile when it writes one, and only then. */
  const bound = previewLegacyMigration(loadLegacy(), { at: AT });
  eq(bound.candidate.format.profiles, ["core", "bible", "shot-planning", "continuity"],
    "case 15: migration appends the continuity profile when it writes continuity data");
  const migrated = validateOfpDocument(bound.candidate);
  eq(migrated.counts.error, 0, `case 14: the migrated document must validate: ${JSON.stringify(migrated.diagnostics.filter((d) => d.severity === "error"))}`);

  /* Case 19 — a legacy project with no selections is semantically unchanged: no
     block, no profile, and nothing about it moved. */
  const plain = previewLegacyMigration(parseJsonStrict(readText(path.join(__dirname, "fixtures", "ofp-legacy", "clean.json"))), { at: AT });
  ok(!("continuity" in plain.candidate), "case 19: a project that declares no state selection gets no continuity block");
  eq(plain.candidate.format.profiles, ["core", "bible", "shot-planning"],
    "case 19: and the profile is not declared for data that does not exist");

  /* Case 17 — preview does not touch the source. */
  const source = loadLegacy();
  const snapshot = JSON.stringify(source);
  previewLegacyMigration(source, { at: AT });
  eq(JSON.stringify(source), snapshot, "case 17: previewing a migration must not change one byte of the source project");

  /* Determinism: the same input twice is the same document, the same report and
     the same bytes. */
  const again = previewLegacyMigration(loadLegacy(), { at: AT });
  eq(serializeCanonical(again.candidate), serializeCanonical(bound.candidate), "migration must be deterministic");
  eq(again.report.accounting.entries.map((e) => [e.pointer, e.rule, e.disposition]),
    bound.report.accounting.entries.map((e) => [e.pointer, e.rule, e.disposition]), "and so must its accounting");

  /* THE RE-HOMING, which is the point of the batch: a mapped selection is in
     the profile and is NOT also sitting in the opaque legacy blob. */
  const preserved = bound.candidate.extensions["com.cinebraid.legacy"].preserved || [];
  /* Structurally, per shot: every pair the profile carries is gone from that
     shot's preserved blob. A string search over the whole extension would be
     wrong — BIND-E legitimately preserves a REFUSED `CHAR-RHEA: st-rhea-wet`,
     and a check that could not tell the two apart would pass by accident. */
  for (const entry of bound.candidate.continuity.shots) {
    const index = legacyShotIndex(loadLegacy(), entry.shotId);
    const blob = JSON.stringify(preserved.filter((row) => row.sourcePath.startsWith(`/shots/${index}/`)).map((row) => row.value));
    const pairs = [
      ...(entry.entityStates || []),
      ...(entry.frames || []).flatMap((frame) => frame.entityStates || []),
    ];
    for (const pair of pairs)
      ok(!blob.includes(`"${pair.entityId}":"${pair.stateId}"`),
        `${entry.shotId}: ${pair.entityId} = ${pair.stateId} is canonical now and must not also sit in the opaque legacy blob`);
  }
  const shotOneWorkflows = preserved.find((entry) => entry.sourcePath === "/shots/1/creationBrief/frameWorkflows");
  eq(shotOneWorkflows.value, { "kf-b": { mode: "auto" } },
    "the workflow record is preserved with the canonical selections removed and everything else intact");
  ok(!preserved.some((entry) => entry.sourcePath === "/shots/0/continuityStateSelections"),
    "a shot whose every selection became a binding preserves no leftover selection map");
  const rule = ruleById("M043");
  ok(rule && rule.determinism === "deterministic",
    "M043 is deterministic: every selection either maps on facts already in the document or it does not, and nothing here is a reading");
  eq(bound.candidate.statements === undefined ? [] : bound.candidate.statements.filter((s) => s.note && s.note.includes("continuity binding")), [],
    "and it writes no statement, because P0 §10.3 says migrations state only where they GUESS");

  /* Case 11 — ambiguity is preserved and reported, never invented. */
  const refused = bound.report.diagnostics.filter((entry) => entry.code === "migration.review.required" && entry.where.startsWith("/shots/4"));
  eq(refused.length, 5, `every refusable shape in the fixture must be reported: ${JSON.stringify(refused.map((d) => d.where))}`);
  const stillThere = preserved.find((entry) => entry.sourcePath === "/shots/4/continuityStateSelections");
  eq(stillThere.value, { "CHAR-RHEA": "st-rhea-nonexistent", "CHAR-GHOST": "st-rhea-wet", "PROP-CASE": "st-case-open" },
    "a selection migration could not express is preserved verbatim, not dropped and not guessed at");
  ok(!(bound.candidate.continuity.shots || []).some((entry) => entry.shotId === "BIND-E"),
    "and no binding is written for the shot whose selections could not be resolved");

  /* Case 18 of the reconciliation's own concern: the real corpus does not
     exercise this path at all, so nothing here may claim it does. */
  const corpus = path.join(__dirname, "fixtures", "ofp-migration", "overfit", "generations");
  let occurrences = 0;
  for (const name of fs.readdirSync(corpus)) {
    const text = readText(path.join(corpus, name));
    for (const key of ["continuityStateSelections", "frameWorkflows", "characterStateSelections", "propStateSelections", "vehicleStateSelections", "locationStateSelections", "locationStateId"])
      occurrences += text.split(`"${key}"`).length - 1;
  }
  eq(occurrences, 0,
    "the 18 sanitized Overfit generations contain no shot-level or frame-level state selection of any kind; this suite's synthetic fixtures are the only coverage of the migration path and must not be described as corpus-proved");
  for (const name of fs.readdirSync(path.join(__dirname, "fixtures", "ofp-migration", "overfit", "goldens"))) {
    if (!name.endsWith(".ofp.json")) continue;
    const golden = parseJsonStrict(readText(path.join(__dirname, "fixtures", "ofp-migration", "overfit", "goldens", name)));
    ok(!("continuity" in golden), `${name}: no golden gains a continuity block, because no generation declares a state selection`);
    ok(!golden.format.profiles.includes("continuity"), `${name}: and none of them declares the profile`);
  }
}

/* ===========================================================================
   4. Case 18 — the authority image follows the RESOLVED state.

   This evaluates the two REAL server functions rather than driving the HTTP
   route that calls them, and the reason is disclosed rather than hidden: the
   only route that reaches derivedFrameContext posts the assembled images to a
   vision provider, and this batch makes no paid call. The functions are lifted
   out of server.js by exact source, so what runs here is the shipped code and a
   negative control can mutate it in flight. */

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

function authoritySection(options = {}) {
  const source = options.mutateSource
    ? String(options.mutateSource(readText(path.join(ROOT, "server.js"))))
    : readText(path.join(ROOT, "server.js"));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-authority-"));
  try {
    for (const folder of ["anchors", "plates", "props", "vehicles", "shots"]) fs.mkdirSync(path.join(temp, folder), { recursive: true });
    const files = {
      "anchors/CHAR-RHEA-CLEAN.png": "clean",
      "anchors/CHAR-RHEA-WET.png": "wet",
      "plates/LOC-DOOR-DAY.png": "day",
      "plates/LOC-DOOR-NIGHT.png": "night",
      "props/PROP-CASE-CLOSED.png": "closed",
      "props/PROP-CASE-OPEN.png": "open",
    };
    for (const [relative, body] of Object.entries(files)) fs.writeFileSync(path.join(temp, relative), body);

    const project = runtimeProject();
    const shot = project.shots[0];
    setShotState(shot, "CHAR-RHEA", WET);
    setShotState(shot, "PROP-CASE", "st-case-closed");
    setFrameState(shot, "fr-b", "character", "CHAR-RHEA", CLEAN);
    setFrameState(shot, "fr-b", "prop", "PROP-CASE", "st-case-open");

    const context = vm.createContext({
      fs, path, console,
      Continuity,
      PROJECT_DIR: () => temp,
      IMG_ONLY: (name) => /\.(png|jpg|jpeg|webp|gif)$/i.test(String(name)),
      projectAssetPath: (file) => (file ? path.join(temp, String(file)) : ""),
      resolveShotEntities: () => ({ characters: project.characters, locations: project.locations, props: project.props, vehicles: [] }),
    });
    vm.runInContext(`${extractFunction(source, "entityApprovedDiskPath")}\n${extractFunction(source, "derivedFrameContext")}\nglobalThis.__run = (P, shot, frame) => derivedFrameContext(P, shot, frame);`, context);
    const authorityFor = (frameId) => {
      const frame = shot.keyframes.find((item) => item.id === frameId);
      /* Spread first: the array comes back from the VM realm, so its prototype
         is that realm's Array.prototype and deepStrictEqual would refuse two
         lists whose contents print identically. */
      return [...context.__run(project, shot, frame)]
        .filter((entry) => /authority/.test(entry.role))
        .map((entry) => path.basename(entry.file))
        .sort();
    };

    /* THE SHOT DEFAULT, which is what was broken. Frame A declares nothing, so
       before this batch it fell past `Rhea = rain-soaked` to the entity default
       and generated against the clean plate. */
    eq(authorityFor("fr-a"), ["CHAR-RHEA-WET.png", "LOC-DOOR-DAY.png", "PROP-CASE-CLOSED.png"],
      "case 18: a frame with no override generates against the SHOT's declared state");
    eq(authorityFor("fr-b"), ["CHAR-RHEA-CLEAN.png", "LOC-DOOR-DAY.png", "PROP-CASE-OPEN.png"],
      "case 18: and a frame with an override generates against the override");
    eq(authorityFor("fr-c"), ["CHAR-RHEA-WET.png", "LOC-DOOR-DAY.png", "PROP-CASE-CLOSED.png"],
      "case 18: and a third frame inherits again, in both directions");

    /* Removing the override restores the shot's authority image, which is case
       5 all the way through to the bytes a generation would be handed. */
    setFrameState(shot, "fr-b", "character", "CHAR-RHEA", "");
    setFrameState(shot, "fr-b", "prop", "PROP-CASE", "");
    eq(authorityFor("fr-b"), ["CHAR-RHEA-WET.png", "LOC-DOOR-DAY.png", "PROP-CASE-CLOSED.png"],
      "case 5/18: clearing the override restores the shot's authority images");

    /* With nothing declared at all, the entity default is what applies — the
       pre-P4-SEM-B reading, which must still hold where nothing was declared. */
    setShotState(shot, "CHAR-RHEA", "");
    setShotState(shot, "PROP-CASE", "");
    eq(authorityFor("fr-a"), ["CHAR-RHEA-CLEAN.png", "LOC-DOOR-DAY.png", "PROP-CASE-CLOSED.png"],
      "case 19: a project that declares nothing still resolves to each entity's own default");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

/* ===========================================================================
   5. Case 20 — the FLF motion-readiness gate is not this batch's business.

   P4-SEM-B makes state authority durable. B2b is where continuity review and
   gating systems are compared, and moving, replacing, reordering or weakening
   the existing gate here would decide that question by accident. */

function motionGateSection() {
  const project = runtimeProject();
  const shot = project.shots[0];
  shot.keyframes[0].winner = "fr-a-approved.png";
  shot.clips = [{ id: "seg-1", kind: "flf", label: "1", fromFrame: "fr-a", toFrame: "fr-b", motionPrompt: "She steps out." }];
  setShotState(shot, "CHAR-RHEA", WET);
  setFrameState(shot, "fr-b", "character", "CHAR-RHEA", CLEAN);

  const blocked = deterministicHealth(project, { shots: {} }).filter((entry) => entry.type === "blocked-flf");
  eq(blocked.map((entry) => entry.reason), ["FLF requires approved first and last frames."],
    "case 20: the FLF gate still blocks on unapproved endpoints, and still says so in its own words");
  eq(blocked[0].severity, "high", "case 20: at the severity it has always used");

  shot.keyframes[1].winner = "fr-b-approved.png";
  eq(deterministicHealth(project, { shots: {} }).filter((entry) => entry.type === "blocked-flf"), [],
    "case 20: and clears when both endpoints are approved — a declared state change does not open or close it");

  /* The gate reads approvals. It must not have acquired a continuity input. */
  const agentSource = readText(path.join(ROOT, "agent-suite.js"));
  const gate = agentSource.slice(agentSource.indexOf('if (c.kind === "flf")'), agentSource.indexOf('reason: "FLF requires approved first and last frames."'));
  ok(!/continuity|resolveDeclaredStateId|StateSelections/i.test(gate),
    "case 20: nothing in this batch may route the motion go/no-go decision through a continuity engine");
}

/* ===========================================================================
   C0-2 — THE SHIPPED SAMPLE'S OWN STATE INTENT, READ THE WAY THE PRODUCT READS.

   The Automation Lab research reproduced a state-intent mismatch in the project
   every outsider tester opens first. The sample's three shots each declared a
   Blue parcel state, and each declared it under `continuitySelections` — a key
   ofp-migrate-rules.js already describes as "a legacy sibling nothing reads",
   and which `RUNTIME_SHOT_SELECTION_KEY` is not.

   SAMPLE-01 and SAMPLE-02 LOOKED CORRECT, and that is what kept this alive.
   Both intend the Closed parcel, `state-closed` is the prop's default, and an
   unread declaration falls through to the default — so two thirds of the sample
   resolved to the authored answer for a reason that had nothing to do with the
   authoring. SAMPLE-03 intends Opened, has no default to hide behind, and
   resolved Closed: the same silent parcel in a shot whose entire subject is
   that the parcel is open.

   SO THIS SECTION ASSERTS THE MECHANISM, NOT JUST THE OUTCOME. Every shot is
   asked for its resolved state ID as well as its state NAME, because "Closed"
   is what a defaulting SAMPLE-01 and a declaring SAMPLE-01 both answer, and
   only the ID distinguishes them. The default-fallback path is exercised
   directly at the end so the difference is visible rather than argued.

   THE REAL RESOLVER, AND NOTHING SAMPLE-SHAPED. `Continuity.resolveDeclaredStateId`
   is the runtime entry point the continuity manifest, the frame's design
   authority and the OFP profile all go through; it throws rather than returning
   "" if the shared binding contract did not load. Nothing here reads a key by
   hand and nothing here special-cases the sample.

   AUTHORITY IS NOT TOUCHED. This corrects which state a shot declares. It does
   not, and must not, make anything Canon — asserted below against the real
   authority kernel. */

function sampleStateIntentSection() {
  const Kernel = require("../public/shared-authority-kernel");
  const sample = JSON.parse(readText(path.join(ROOT, "projects", "cinebraid-sample", "project.json")));
  const parcel = (sample.props || []).find((row) => row.id === "PROP-PARCEL");
  ok(parcel, "C0-2: the sample must still ship the Blue parcel");
  eq(parcel.name, "Blue parcel", "C0-2: under the name the research names it by");
  eq((parcel.continuityStates || []).map((state) => `${state.id}:${state.name}:${state.isDefault === true}`),
    ["state-closed:Closed:true", "state-open:Opened:false"],
    "C0-2: with Closed as the DEFAULT and Opened as the declared alternative — the arrangement that let two shots look right by accident");

  /* PRECONDITION. If the stale key ever returns, this section must fail here
     rather than quietly re-testing the default-fallback path. */
  for (const shot of sample.shots || []) {
    ok(!Object.prototype.hasOwnProperty.call(shot, "continuitySelections"),
      `C0-2: ${shot.id} must not carry the stale continuitySelections key that nothing reads`);
  }

  /* THE THREE ANSWERS, through the real resolver. `stateId` proves the shot's
     own declaration was read; `name` proves it resolved to the right record of
     this entity's own catalogue. */
  const expected = [
    ["SAMPLE-01", "state-closed", "Closed"],
    ["SAMPLE-02", "state-closed", "Closed"],
    ["SAMPLE-03", "state-open", "Opened"],
  ];
  for (const [shotId, stateId, stateName] of expected) {
    const shot = (sample.shots || []).find((row) => row.id === shotId);
    ok(shot, `C0-2: the sample must still contain ${shotId}`);
    ok(Binding.stateIdBelongsToEntity(parcel.continuityStates, stateId),
      `C0-2: ${stateId} must be one of the Blue parcel's OWN states — state ids are owner-scoped`);
    const resolved = Continuity.resolveDeclaredStateId(shot, "", "prop", "PROP-PARCEL");
    eq(resolved, stateId,
      `C0-2: ${shotId} must DECLARE ${stateId} where the canonical resolver reads — "" here would mean the shot declares nothing and the answer below came from the entity default`);
    eq(Continuity.resolveStateRecord(parcel, resolved).name, stateName,
      `C0-2: so ${shotId} resolves ${parcel.name} — ${stateName}`);
  }

  /* AND THE ANSWER FOLLOWS THROUGH TO THE IMAGE. A resolved state that does not
     change which approved reference the frame is built against would be a
     correction to a field nobody consumes. */
  eq(Continuity.stateApprovedFile(parcel, Continuity.resolveStateRecord(parcel, "state-closed")), "PROP-PARCEL-CLOSED.png",
    "C0-2: the Closed state answers with the closed parcel");
  eq(Continuity.stateApprovedFile(parcel, Continuity.resolveStateRecord(parcel, "state-open")), "PROP-PARCEL-OPEN.png",
    "C0-2: and SAMPLE-03's Opened state answers with the OPEN parcel, which is the whole point of declaring it");

  /* THE CONTROL THAT MAKES THE THREE ASSERTIONS ABOVE NON-VACUOUS. Strip the
     declaration and the same resolver says "nothing is declared here" — which
     is exactly what all three shots said before this correction, and exactly
     why SAMPLE-01 and SAMPLE-02 looked healthy while SAMPLE-03 did not. */
  const undeclared = JSON.parse(JSON.stringify(sample.shots.find((row) => row.id === "SAMPLE-03")));
  delete undeclared[Binding.RUNTIME_SHOT_SELECTION_KEY];
  eq(Continuity.resolveDeclaredStateId(undeclared, "", "prop", "PROP-PARCEL"), "",
    "C0-2 control: with no canonical declaration the resolver declares nothing");
  eq(Continuity.resolveStateRecord(parcel, "").name, "Closed",
    "C0-2 control: and the caller falls through to the DEFAULT — Closed — which is the wrong parcel for SAMPLE-03 and the reason this was invisible in the other two shots");

  /* AUTHORITY IS UNCHANGED. The sample carries pointers and no receipts, so the
     parcel's states are Historic and nothing about declaring a state may
     promote one. This is the boundary the correction must not cross. */
  const truth = Kernel.entityProductionTruth(sample, "props", "PROP-PARCEL");
  eq(truth.canon, [], "C0-2: declaring a state must not create Canon — the sample holds no human approval receipt for either parcel state");
  eq(truth.historic.map((row) => `${row.stateId}:${row.value}:${row.basis}`).sort(),
    ["state-closed:PROP-PARCEL-CLOSED.png:no-human-receipt", "state-open:PROP-PARCEL-OPEN.png:no-human-receipt"],
    "C0-2: both parcel pointers remain HISTORIC on the same basis — no human receipt — awaiting a confirmation this correction does not supply");
  eq((sample.decisions || []).length, 0, "C0-2: and no decision record was invented to make the sample look approved");
}

/* ===========================================================================
   6. Case 12 — save, reload, and open-without-write, through a real server. */

function freePort() {
  const net = require("net");
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}
function waitFor(check, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = async () => {
      try { if (await check()) return resolve(true); } catch { /* not up yet */ }
      if (Date.now() > deadline) return reject(new Error("timed out waiting for the server"));
      setTimeout(tick, 120);
    };
    tick();
  });
}

async function serverSection() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-binding-"));
  const projectsRoot = path.join(temp, "projects");
  const projectDir = path.join(projectsRoot, "binding-fixture");
  for (const dir of ["anchors", "plates", "props", "audio", "media", "shots", "docs"])
    fs.mkdirSync(path.join(projectDir, dir), { recursive: true });

  const project = runtimeProject();
  const shot = project.shots[0];
  setShotState(shot, "CHAR-RHEA", CLEAN);
  setFrameState(shot, "fr-b", "character", "CHAR-RHEA", WET);
  const file = path.join(projectDir, "project.json");
  fs.writeFileSync(file, JSON.stringify(project, null, 2));
  const onDiskBefore = readText(file);

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      CINEBRAID_CONFIG_PATH: path.join(temp, "config.json"),
      CINEBRAID_PROJECTS_ROOT: projectsRoot,
      CINEBRAID_AI_TEXT_TIMEOUT_MS: "250",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });

  try {
    await waitFor(async () => {
      const response = await fetch(`${base}/api/me`).catch(() => null);
      return !!response && response.ok;
    });

    const read = await fetch(`${base}/api/project`);
    ok(read.ok, `the project must open: ${read.status}\n${output}`);
    const revision = read.headers.get("etag") || read.headers.get("x-cinebraid-project-revision") || "*";
    const loaded = await read.json();
    eq(readText(file), onDiskBefore, "opening a project must not rewrite its declared state bindings on disk");

    const loadedShot = loaded.shots[0];
    eq(Continuity.resolveDeclaredStateId(loadedShot, "fr-a", "character", "CHAR-RHEA"), CLEAN, "case 12: frame A inherits the shot after a real open");
    eq(Continuity.resolveDeclaredStateId(loadedShot, "fr-b", "character", "CHAR-RHEA"), WET, "case 12: frame B keeps its override after a real open");

    const save = await fetch(`${base}/api/projects/binding-fixture/project`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": revision },
      body: JSON.stringify(loaded),
    });
    ok(save.ok, `saving must succeed: ${save.status} ${await save.text().catch(() => "")}`);

    const reloaded = await (await fetch(`${base}/api/project`)).json();
    const reloadedShot = reloaded.shots[0];
    eq(Continuity.resolveDeclaredStateId(reloadedShot, "fr-a", "character", "CHAR-RHEA"), CLEAN, "case 12: frame A still inherits clean after save and reload");
    eq(Continuity.resolveDeclaredStateId(reloadedShot, "fr-b", "character", "CHAR-RHEA"), WET, "case 12: frame B still explicitly uses wet after save and reload");
    eq(Continuity.resolveDeclaredStateId(reloadedShot, "fr-c", "character", "CHAR-RHEA"), CLEAN, "case 12: and the third frame is unaffected");
    eq(reloadedShot.continuityStateSelections, { "CHAR-RHEA": CLEAN }, "case 12: the shot default survived the cycle unchanged");
    eq(reloadedShot.creationBrief.frameWorkflows["fr-b"].characterStateSelections, { "CHAR-RHEA": WET },
      "case 12: and so did the frame override, in the storage the app writes");
    eq(reloaded.characters[0].continuityStates.map((state) => state.id), [CLEAN, WET],
      "case 12: no unrelated state data changed");

    /* Removing the override through a real save restores inheritance, and does
       it by removing data rather than by writing the inherited value in. */
    const edited = JSON.parse(JSON.stringify(reloaded));
    setFrameState(edited.shots[0], "fr-b", "character", "CHAR-RHEA", "");
    const secondRevision = (await fetch(`${base}/api/project`)).headers.get("etag") || "*";
    const clear = await fetch(`${base}/api/projects/binding-fixture/project`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": secondRevision },
      body: JSON.stringify(edited),
    });
    ok(clear.ok, `clearing must save: ${clear.status} ${await clear.text().catch(() => "")}`);
    const after = await (await fetch(`${base}/api/project`)).json();
    eq(Continuity.resolveDeclaredStateId(after.shots[0], "fr-b", "character", "CHAR-RHEA"), CLEAN,
      "case 12: removing the frame override restores shot inheritance through a real save cycle");
    ok(!(after.shots[0].creationBrief.frameWorkflows["fr-b"] || {}).characterStateSelections,
      "case 12: and leaves nothing behind saying the frame inherits");
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

async function main() {
  contractSection();
  driftSection();
  ofpSection();
  authoritySection();
  motionGateSection();
  sampleStateIntentSection();
  await serverSection();
  console.log(`P4-SEM-B continuity state binding passed ${checks} checks: one precedence contract shared by the runtime and the continuity profile, owner-scoped state resolution across three entities that all declare state-default, a modelled profile interior with five validated invariants, deterministic migration that re-homes rather than buries, the real authority-image selection following the resolved state, the shipped sample's own three shots resolving Closed/Closed/Opened from declarations the canonical resolver actually reads while both parcel pointers stay Historic, a real save/reload, and the FLF motion gate exactly where it was. Provider calls made: 0.`);
}

module.exports = {
  runtimeProject, setShotState, setFrameState, extractFunction,
  contractSection, driftSection, ofpSection, authoritySection, motionGateSection, sampleStateIntentSection, serverSection, main,
  CLEAN, WET, AT, LEGACY_FIXTURE, OFP_FIXTURE, BROKEN_FIXTURE,
};
if (require.main === module) main().catch((error) => {
  console.error(error);
  process.exit(1);
});

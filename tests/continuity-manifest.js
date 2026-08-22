/* CineBraid declared-entity continuity — tracked entity manifest.

   The manifest is what production declares the model must look for. It is
   derived, never stored, and its hash is a cache-key ingredient, so the
   properties that matter are: it never mutates the project, it is byte-stable
   for identical input, and its hash moves when — and only when — something
   that changes the question actually changes.

   Offline. No provider, no network, no model. */
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const {
  buildContinuityManifest,
  resolveEntityTracking,
  resolveDeclaredStateId,
  resolveStateRecord,
  mergeTracking,
  canonicalJson,
  sha256Hex,
  DEFAULT_TRACKING,
  OBSERVATION_RELEVANT_FIELDS,
  CONTINUITY_MANIFEST_VERSION,
  MANIFEST_HASH_LENGTH,
} = require("../public/shared-continuity");
const Binding = require("../public/shared-continuity-binding");
const Entities = require("../public/shared-entities");

const clone = (value) => JSON.parse(JSON.stringify(value));

function defaultStates(extra = []) {
  return [
    { id: "state-default", name: "Default", appliesTo: "", approvedFile: "", notes: "Primary approved reference.", isDefault: true },
    ...extra,
  ];
}
function buildProject() {
  return {
    meta: { title: "Continuity Fixture", schemaVersion: "6.6" },
    characters: [
      {
        id: "CHAR-KAI",
        name: "Kai",
        prefix: "KAI",
        approvedFile: "KAI_A.png",
        block: "Late-30s, lean, close-cropped dark hair, faded burn scar on the left forearm.",
        notes: "Always wears the signet ring.",
        driftNotes: "Scar migrates between arms.",
        continuityStates: defaultStates([
          {
            id: "state-jacket-off",
            name: "Jacket removed",
            appliesTo: "Scene 1",
            approvedFile: "KAI_NOJACKET.png",
            notes: "Canvas jacket is off and carried. Shirt, trousers and boots unchanged.",
            isDefault: false,
            parentStateId: "state-default",
          },
        ]),
      },
    ],
    locations: [
      { id: "LOC-BRIDGE", name: "Bridge", description: "Steel footbridge over a dry canal.", continuityStates: defaultStates() },
    ],
    props: [
      {
        id: "PROP-MUG",
        name: "Enamel mug",
        description: "White enamel mug, chipped rim, single black band near the lip.",
        tracking: { color: true },
        continuityStates: defaultStates(),
      },
      {
        /* The qualified benchmark's false positives all came from asking for
           one colour on a genuinely two-tone object. */
        id: "PROP-WRISTWATCH",
        name: "Steel and gold wristwatch",
        description: "Brushed steel case and bracelet, gold bezel and crown, white dial.",
        tracking: { identityCues: "Two-tone by design. Do not report a single colour for this object." },
        continuityStates: defaultStates(),
      },
      {
        id: "PROP-PENCIL-HOLDER",
        name: "Pencil holder with pencils",
        description: "Ceramic cylinder holding an assortment of pencils and one pair of scissors.",
        tracking: { unit: "composite", identityCues: "The pencil holder and the pencils in it, as one object." },
        continuityStates: defaultStates(),
      },
      { id: "PROP-UNTRACKED", name: "Wall calendar", description: "Paper calendar.", tracking: { enabled: false }, continuityStates: defaultStates() },
    ],
    vehicles: [],
    audio: [{ id: "AUDIO-VOICE-KAI", name: "Kai voice master" }],
    scenes: [{ id: "SC-01", title: "Scene one" }],
    shots: [buildShot()],
  };
}
function buildShot() {
  return {
    id: "S-01",
    scene: "SC-01",
    title: "Kai at the bridge",
    desc: "Kai sets the mug down and looks out over the canal.",
    characters: ["CHAR-KAI"],
    /* AUDIO-VOICE-KAI resolves but is not visual; PROP-GHOST never resolves. */
    codes: ["AUDIO-VOICE-KAI", "PROP-GHOST"],
    creationBrief: {
      locationId: "LOC-BRIDGE",
      propIds: ["PROP-MUG", "PROP-WRISTWATCH", "PROP-PENCIL-HOLDER", "PROP-UNTRACKED"],
      vehicleIds: [],
      frameWorkflows: {},
    },
    continuityStateSelections: {},
    keyframes: [{ id: "frame-a", label: "A" }, { id: "frame-b", label: "B" }],
  };
}
const idsOf = (manifest) => manifest.entities.map((row) => row.entity_id);
const entityOf = (manifest, id) => manifest.entities.find((row) => row.entity_id === id);

/* ---- 1. the bundled SHA-256 agrees with the reference implementation ----

   The manifest hash has to be computable identically in the browser and in
   Node, so the algorithm is carried in shared-continuity.js rather than taken
   from require("crypto"). That is only safe if it is checked against the
   reference, including both message-padding boundaries. */
const HASH_CASES = [
  "",
  "a",
  "abc",
  "CineBraid",
  "x".repeat(54),
  "x".repeat(55), // one byte short of needing a second block
  "x".repeat(56), // first length that forces a second block
  "x".repeat(63),
  "x".repeat(64),
  "x".repeat(65),
  "x".repeat(119),
  "x".repeat(120),
  "x".repeat(1000),
  "Kai — “jacket removed” · état · 日本語 · 🎬",
  JSON.stringify({ nested: [1, 2, { deep: true }], text: "mixed ünicode ✓" }),
];
for (const input of HASH_CASES) {
  assert.strictEqual(
    sha256Hex(input),
    crypto.createHash("sha256").update(input, "utf8").digest("hex"),
    `bundled sha256 must match Node crypto for input of length ${input.length}`,
  );
}

/* ---- 2. canonical JSON is key-order independent ---- */
assert.strictEqual(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
assert.strictEqual(canonicalJson({ a: 2, b: 1 }), '{"a":2,"b":1}');
assert.strictEqual(canonicalJson([{ z: 1, a: undefined }]), '[{"a":null,"z":1}]');
assert.notStrictEqual(canonicalJson([1, 2]), canonicalJson([2, 1]), "arrays are ordered data and must stay ordered");

/* ---- 3. building a manifest never mutates the project ----

   ensureEntityStateList() in app.js repairs entities as a side effect of reading
   them. The manifest builder must not: it runs on the server against a record
   it does not own. */
const pristine = buildProject();
const before = JSON.stringify(pristine);
buildContinuityManifest(pristine, pristine.shots[0], "frame-a");
assert.strictEqual(JSON.stringify(pristine), before, "buildContinuityManifest must not mutate the project record");

/* ---- 4. entity selection: visual, resolved, tracking-enabled only ---- */
const P = buildProject();
const shot = P.shots[0];
const manifest = buildContinuityManifest(P, shot, "frame-a");

assert.strictEqual(manifest.manifestVersion, CONTINUITY_MANIFEST_VERSION);
assert.strictEqual(manifest.shotId, "S-01");
assert.strictEqual(manifest.frameId, "frame-a");
assert.deepStrictEqual(
  idsOf(manifest),
  ["CHAR-KAI", "LOC-BRIDGE", "PROP-MUG", "PROP-PENCIL-HOLDER", "PROP-WRISTWATCH"],
  "manifest must contain exactly the resolved, visual, tracking-enabled entities, sorted by id",
);
assert(!idsOf(manifest).includes("AUDIO-VOICE-KAI"), "audio entities are not visual continuity entities");
assert(!idsOf(manifest).includes("PROP-GHOST"), "an unresolved shot dependency must never enter the manifest");
assert(!idsOf(manifest).includes("PROP-UNTRACKED"), "tracking.enabled:false must exclude an entity");

/* ---- 5. deterministic ordering, independent of declaration order ---- */
const shuffled = buildProject();
shuffled.props.reverse();
shuffled.shots[0].creationBrief.propIds = ["PROP-PENCIL-HOLDER", "PROP-UNTRACKED", "PROP-MUG", "PROP-WRISTWATCH"];
const shuffledManifest = buildContinuityManifest(shuffled, shuffled.shots[0], "frame-a");
assert.deepStrictEqual(idsOf(shuffledManifest), idsOf(manifest), "manifest order must not depend on project declaration order");
assert.strictEqual(shuffledManifest.manifestHash, manifest.manifestHash, "reordering equivalent input must not change the hash");

/* ---- 6. the hash is stable and correctly shaped ---- */
assert.strictEqual(manifest.manifestHash.length, MANIFEST_HASH_LENGTH);
assert(/^[0-9a-f]+$/.test(manifest.manifestHash), "the manifest hash must be lowercase hex");
for (let i = 0; i < 5; i++)
  assert.strictEqual(
    buildContinuityManifest(buildProject(), buildShot(), "frame-a").manifestHash,
    manifest.manifestHash,
    "identical input must produce an identical hash on every build",
  );
assert.strictEqual(
  JSON.stringify(buildContinuityManifest(buildProject(), buildShot(), "frame-a")),
  JSON.stringify(manifest),
  "identical input must produce a byte-identical manifest",
);

/* ---- 7. the hash moves for observation-relevant changes ---- */
function hashAfter(mutate) {
  const project = buildProject();
  mutate(project, project.shots[0]);
  return buildContinuityManifest(project, project.shots[0], "frame-a").manifestHash;
}
const RELEVANT = [
  ["entity name (rendered as the display name)", (p) => { p.characters[0].name = "Kai Renamed"; }],
  ["identity block", (p) => { p.characters[0].block = "Completely different identity."; }],
  ["identity description", (p) => { p.props[0].description = "A completely different mug."; }],
  ["identity cues", (p) => { p.props[0].tracking = { color: true, identityCues: "A different object entirely." }; }],
  ["tracking flag", (p) => { p.props[0].tracking = { color: false }; }],
  ["continuity unit", (p) => { p.props[0].tracking = { color: true, unit: "composite" }; }],
  ["declared parent entity", (p) => { p.props[0].tracking = { color: true, parentEntityId: "CHAR-KAI" }; }],
  ["entity removed from the shot", (p, s) => { s.creationBrief.propIds = s.creationBrief.propIds.filter((id) => id !== "PROP-MUG"); }],
  ["entity added to the shot", (p, s) => { p.props.push({ id: "PROP-NEW", name: "New prop", description: "d", continuityStates: defaultStates() }); s.creationBrief.propIds.push("PROP-NEW"); }],
];
for (const [label, mutate] of RELEVANT)
  assert.notStrictEqual(hashAfter(mutate), manifest.manifestHash, `${label} must change the manifest hash`);

/* ---- 8. the hash does NOT move for data the model is never shown ----

   Otherwise every unrelated project edit silently discards valid evidence. */
const IRRELEVANT = [
  ["shot title", (p, s) => { s.title = "A different title"; }],
  ["shot description", (p, s) => { s.desc = "Totally different action text."; }],
  ["entity prefix", (p) => { p.characters[0].prefix = "KAI2"; }],
  ["entity approved file", (p) => { p.characters[0].approvedFile = "OTHER.png"; }],
  ["drift notes", (p) => { p.characters[0].driftNotes = "Something else entirely."; }],
  /* identity_cues takes the first populated source; a lower-priority field is
     genuinely not part of the question the model is asked. */
  ["notes when a canon block is present", (p) => { p.characters[0].notes = "Different note."; }],
  ["approved file of the selected state", (p) => { p.characters[0].continuityStates[0].approvedFile = "OTHER.png"; }],
  ["appliesTo of the selected state", (p) => { p.characters[0].continuityStates[0].appliesTo = "Scene 9"; }],
  ["an unselected state's delta", (p) => { p.characters[0].continuityStates[1].notes = "Different delta."; }],
  ["candidate files", (p) => { p.props[0].candidateFiles = [{ stored: "x.png", decision: "shortlist" }]; }],
  ["project title", (p) => { p.meta.title = "Renamed project"; }],
  ["declared intent", (p, s) => { s.continuityIntent = { "PROP-MUG": { expected: ["mug is set down"] } }; }],
  ["an unrelated shot", (p) => { p.shots.push({ ...buildShot(), id: "S-02" }); }],
  /* The declared state is a cb_ annotation, never sent to the model, so
     re-selecting it must not throw away a valid observation of an unchanged
     image. It drives intent, not the observation cache key. */
  ["declared state selection", (p, s) => { s.continuityStateSelections["CHAR-KAI"] = "state-jacket-off"; }],
];
for (const [label, mutate] of IRRELEVANT)
  assert.strictEqual(hashAfter(mutate), manifest.manifestHash, `${label} must NOT change the manifest hash`);

/* Every hashed field is one the prompt is contracted to render, and nothing
   in the manifest row is hashed by accident. */
for (const field of OBSERVATION_RELEVANT_FIELDS)
  assert(field in entityOf(manifest, "CHAR-KAI"), `manifest rows must carry the observation-relevant field ${field}`);

/* ---- 9. state resolution: frame beats shot beats default ----

   The declared state is a CineBraid annotation (cb_*): it is never sent to the
   model, so it drives intent but must not key the observation cache. */
const stateProject = buildProject();
const stateShot = stateProject.shots[0];
assert.strictEqual(entityOf(buildContinuityManifest(stateProject, stateShot, "frame-a"), "CHAR-KAI").cb_declared_state_id, "state-default");

stateShot.continuityStateSelections["CHAR-KAI"] = "state-jacket-off";
let resolved = entityOf(buildContinuityManifest(stateProject, stateShot, "frame-a"), "CHAR-KAI");
assert.strictEqual(resolved.cb_declared_state_id, "state-jacket-off", "a shot-level selection must beat the entity default");
assert.strictEqual(resolved.cb_declared_state_name, "Jacket removed");

/* The frame-level maps have no writer until Phase 4, but the readers and the
   rename remapping already exist, so the builder honours them now. */
stateShot.creationBrief.frameWorkflows["frame-b"] = { characterStateSelections: { "CHAR-KAI": "state-default" } };
assert.strictEqual(
  entityOf(buildContinuityManifest(stateProject, stateShot, "frame-b"), "CHAR-KAI").cb_declared_state_id,
  "state-default",
  "a frame-level selection must beat the shot-level selection",
);
assert.strictEqual(
  entityOf(buildContinuityManifest(stateProject, stateShot, "frame-a"), "CHAR-KAI").cb_declared_state_id,
  "state-jacket-off",
  "a frame-level selection must not leak into another frame",
);
assert.strictEqual(resolveDeclaredStateId(stateShot, "frame-b", "character", "CHAR-KAI"), "state-default");
assert.strictEqual(resolveDeclaredStateId(stateShot, "", "character", "CHAR-KAI"), "state-jacket-off");
/* Locations are declared through either spelling the existing readers accept. */
stateShot.creationBrief.frameWorkflows["frame-c"] = { locationStateId: "state-night" };
assert.strictEqual(resolveDeclaredStateId(stateShot, "frame-c", "location", "LOC-BRIDGE"), "state-night");
stateShot.creationBrief.frameWorkflows["frame-d"] = { locationStateSelections: { "LOC-BRIDGE": "state-dawn" } };
assert.strictEqual(resolveDeclaredStateId(stateShot, "frame-d", "location", "LOC-BRIDGE"), "state-dawn");

/* An unknown state id falls back to the default rather than inventing one. */
assert.strictEqual(resolveStateRecord(stateProject.characters[0], "state-does-not-exist").id, "state-default");
assert.strictEqual(resolveStateRecord({ continuityStates: [] }, "").id, "state-default", "an entity with no states still resolves");

/* ---- 10. tracking policy resolution ---- */
assert.deepStrictEqual(resolveEntityTracking({}, {}), DEFAULT_TRACKING, "an entity with no policy gets the defaults");
assert.strictEqual(DEFAULT_TRACKING.color, false, "colour tracking must default to OFF");
assert.strictEqual(DEFAULT_TRACKING.presence, true);
assert.strictEqual(DEFAULT_TRACKING.movement, true);
assert.strictEqual(DEFAULT_TRACKING.state, true);
assert.strictEqual(DEFAULT_TRACKING.unit, "self");

/* A partial patch contributes only what it carries. An absent key inherits. */
const partial = mergeTracking(DEFAULT_TRACKING, { color: true });
assert.strictEqual(partial.color, true);
assert.strictEqual(partial.presence, true, "a partial override must not clear the keys it does not mention");
assert.strictEqual(mergeTracking(DEFAULT_TRACKING, { color: "yes" }).color, false, "a non-boolean must not enable tracking");
assert.strictEqual(mergeTracking(DEFAULT_TRACKING, { unit: "nonsense" }).unit, "self");
assert.strictEqual(mergeTracking(DEFAULT_TRACKING, null).color, false);
/* An array-valued override must be copied, never aliased onto the shared
   exported defaults. */
assert.notStrictEqual(
  mergeTracking(DEFAULT_TRACKING, { allowedStateValues: ["open"] }).allowedStateValues,
  DEFAULT_TRACKING.allowedStateValues,
);
assert.strictEqual(DEFAULT_TRACKING.allowedStateValues, null, "the exported defaults must never be mutated by a merge");
assert.strictEqual(DEFAULT_TRACKING.color, false, "the exported defaults must never be mutated by a merge");
/* "composite" is the CineBraid spelling of the qualified contract's
   composite-parent, and both are accepted. */
assert.strictEqual(mergeTracking(DEFAULT_TRACKING, { unit: "composite" }).unit, "composite-parent");
assert.strictEqual(mergeTracking(DEFAULT_TRACKING, { unit: "composite-parent" }).unit, "composite-parent");
assert.strictEqual(mergeTracking(DEFAULT_TRACKING, { unit: "child" }).unit, "child");

/* state policy beats entity policy beats defaults */
const overrideProject = buildProject();
overrideProject.characters[0].tracking = { color: false, movement: false };
overrideProject.characters[0].continuityStates[1].tracking = { color: true };
const overrideShot = overrideProject.shots[0];
const trackOf = (row) => ({ presence: row.track_presence, movement: row.track_movement, color: row.track_color, state: row.track_state, markings: row.track_markings });
let kai = entityOf(buildContinuityManifest(overrideProject, overrideShot, "frame-a"), "CHAR-KAI");
assert.deepStrictEqual(trackOf(kai), { presence: true, movement: false, color: false, state: true, markings: false }, "entity policy applies on the default state");
overrideShot.continuityStateSelections["CHAR-KAI"] = "state-jacket-off";
kai = entityOf(buildContinuityManifest(overrideProject, overrideShot, "frame-a"), "CHAR-KAI");
assert.deepStrictEqual(trackOf(kai), { presence: true, movement: false, color: true, state: true, markings: false }, "state policy must override entity policy");

/* ---- 11. the multi-tone accessory: colour off, disambiguation carried ---- */
const watch = entityOf(manifest, "PROP-WRISTWATCH");
assert.strictEqual(watch.track_color, false, "a multi-tone object must not have colour tracked by default");
assert.strictEqual(watch.track_presence, true, "presence is still tracked on a colour-disabled object");
assert.strictEqual(watch.track_movement, true);
assert(watch.identity_cues.includes("Two-tone by design"), "the production's disambiguating cue must reach the checklist");
assert.strictEqual(entityOf(manifest, "PROP-MUG").track_color, true, "an explicitly declared colour policy is honoured");
/* Colour tracking is off by default across the board — the benchmark rule. */
assert.strictEqual(entityOf(manifest, "CHAR-KAI").track_color, false);
assert.strictEqual(entityOf(manifest, "LOC-BRIDGE").track_color, false);

/* ---- 12. a composite entity is exactly one manifest record ---- */
const holder = entityOf(manifest, "PROP-PENCIL-HOLDER");
assert.strictEqual(manifest.entities.filter((row) => row.entity_id === "PROP-PENCIL-HOLDER").length, 1, "a composite unit must produce exactly one record");
assert.strictEqual(holder.continuity_unit, "composite-parent");
assert(holder.identity_cues.includes("as one object"), "the declared boundary must reach the checklist");
/* The generated grammar has exactly one slot for the whole unit, so the model
   cannot split it into its parts. */
const holderSchema = require("../public/shared-continuity").buildObservationSchema(manifest);
assert.deepStrictEqual(
  holderSchema.properties.entities.required,
  ["CHAR-KAI", "LOC-BRIDGE", "PROP-MUG", "PROP-PENCIL-HOLDER", "PROP-WRISTWATCH"],
  "the schema exposes one slot per declared unit and no more",
);
assert.strictEqual(entityOf(manifest, "PROP-MUG").continuity_unit, "self");

/* ---- 13. degenerate input is handled without throwing ---- */
assert.deepStrictEqual(buildContinuityManifest(null, null, "").entities, []);
assert.deepStrictEqual(buildContinuityManifest({}, {}, "").entities, []);
assert.strictEqual(buildContinuityManifest({}, {}, "").manifestHash.length, MANIFEST_HASH_LENGTH);

/* ---- 14. an entity id change must not orphan declared intent ----

   updateShotDependencyRelationship() is the single relink path for every
   entity-id-keyed relation on a shot. Declared continuity intent is one, so a
   rename that moved the state selection but left the intent behind would make
   the next continuity run report a planned change as a break. */
const sandbox = {
  window: {},
  document: { querySelectorAll: () => [], getElementById: () => null },
  localStorage: { getItem: () => null, setItem: () => {} },
  console,
  setTimeout,
  clearTimeout,
  applyShotStateDeclaration: Binding.applyShotStateDeclaration,
  clearDetachedShotStateDeclaration: Binding.clearDetachedShotStateDeclaration,
  resolveShotEntities: Entities.resolveShotEntities,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "public", "creation-studio.js"), "utf8"), sandbox, { filename: "creation-studio.js" });
assert.strictEqual(typeof sandbox.updateShotDependencyRelationship, "function", "the relink path must be loadable for testing");

const relinkProject = buildProject();
relinkProject.props.push({
  id: "PROP-TIN-MUG",
  name: "Tin mug",
  description: "Replacement mug record.",
  continuityStates: defaultStates(),
});
const relinkShot = relinkProject.shots[0];
sandbox.P = relinkProject;
relinkShot.continuityStateSelections = { "PROP-MUG": "state-default" };
relinkShot.continuityIntent = {
  "PROP-MUG": { expected: ["the mug is set down"], allowPresenceChange: "may-leave", note: "planned" },
  "CHAR-KAI": { expected: ["kai removes the jacket"] },
};
sandbox.updateShotDependencyRelationship(relinkShot, "PROP-MUG", "PROP-TIN-MUG");

assert(!("PROP-MUG" in relinkShot.continuityIntent), "the old id must not keep its intent after a rename");
assert.deepStrictEqual(
  relinkShot.continuityIntent["PROP-TIN-MUG"],
  { expected: ["the mug is set down"], allowPresenceChange: "may-leave", note: "planned" },
  "declared intent must move with the entity id, unchanged",
);
assert.deepStrictEqual(relinkShot.continuityIntent["CHAR-KAI"], { expected: ["kai removes the jacket"] }, "an unrelated entity's intent must be untouched");
assert.strictEqual(relinkShot.continuityStateSelections["PROP-TIN-MUG"], "state-default", "the existing state relink must still work");
assert(relinkShot.creationBrief.propIds.includes("PROP-TIN-MUG"));

/* Removing a dependency (nextId "") drops the intent rather than stranding it. */
sandbox.updateShotDependencyRelationship(relinkShot, "PROP-TIN-MUG", "");
assert(!("PROP-TIN-MUG" in relinkShot.continuityIntent), "removing a dependency must drop its declared intent");
assert(!("PROP-TIN-MUG" in relinkShot.continuityStateSelections));

/* A shot that has never declared intent must survive the relink untouched. */
const noIntentShot = buildShot();
sandbox.updateShotDependencyRelationship(noIntentShot, "PROP-MUG", "PROP-OTHER");
assert.strictEqual(noIntentShot.continuityIntent, undefined, "the relink must not invent a continuityIntent object");

/* ---- 15. an absent tracking/intent contract behaves as the defaults ----

   Phase 1 stores nothing. A project written by 6.6.6 must build a manifest
   with no migration and no write-back. */
const legacy = clone(buildProject());
for (const list of ["characters", "locations", "props", "vehicles"])
  for (const entity of legacy[list]) delete entity.tracking;
delete legacy.shots[0].continuityIntent;
const legacyManifest = buildContinuityManifest(legacy, legacy.shots[0], "frame-a");
assert.strictEqual(legacyManifest.entities.length, 6, "with no policy every resolved visual entity is tracked, including the previously disabled one");
for (const row of legacyManifest.entities) {
  assert.strictEqual(row.track_color, false, `${row.entity_id}: colour must be off for an undeclared project`);
  assert.strictEqual(row.track_presence, true);
  assert.strictEqual(row.continuity_unit, "self");
  assert.strictEqual(row.parent_entity_id, null);
}

console.log("Continuity manifest suite passed: bundled sha256 matches Node crypto across both padding boundaries, manifests are pure and byte-stable, the hash tracks observation-relevant changes and ignores everything else, frame beats shot beats default state, state policy overrides entity policy, colour defaults off on multi-tone objects, composites stay one record, and an entity-id change carries declared intent with it.");

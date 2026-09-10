/* Negative controls for P4-SEM-B canonical continuity state bindings.
 *
 * A regression test that has never failed is a claim, not evidence. Each control
 * below reintroduces exactly one of the defects this batch exists to remove — a
 * resolver that ignores a frame override, a resolver that ignores the shot
 * binding, state ids resolved globally instead of inside their own entity, a
 * validator that accepts another entity's state, a validator that accepts two
 * bindings at one scope, a canonical write that drops a frame override, a
 * migration that leaves a known selection buried in the opaque legacy blob, a
 * profile written without being declared, an open that migrates, and the FLF
 * motion gate being moved — and asserts that the guarding suite FAILS.
 *
 *   NOTHING IS WRITTEN TO DISK AND NOTHING IS REVERTED WITH GIT. Node modules
 *   are patched by compiling a modified copy IN MEMORY; server.js is patched
 *   through the positive suite's own `mutateSource` hook, which mutates the
 *   string it is about to evaluate and never the file. A broad `git checkout`
 *   can therefore never be the thing that undoes a control.
 *
 *   AN EXCEPTION IS NOT PROOF THE CONTROL RAN. Every control carries a receipt:
 *   each anchor must exist, must be unique, and must actually change the source,
 *   and the DEFECT ITSELF must be observed through a behavioural probe before
 *   the guarded suite's failure is allowed to count as detection. A control
 *   whose anchor has gone stale reports itself as stale rather than passing.
 *
 *   A SYNTAX OR LOAD FAILURE IS NOT A RECEIPT. `expectRed` accepts an
 *   AssertionError and nothing else; anything a broken patch would throw is
 *   re-raised as the control breaking.
 *
 * NO PAID PROVIDER CALL IS POSSIBLE HERE: nothing dispatches a generation, and
 * the one real server runs against a temporary projects root with no
 * credentials.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
/* Normalised to LF before matching. Anchors span lines, and on a Windows
   checkout with core.autocrlf on they would arrive as \r\n — the anchor would
   not match, the control would report itself as stale, and the failure would
   look like a source change rather than a line ending. */
const readLF = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

/* Everything a patch may invalidate, including the positive suite itself: it
   captures its module references at require time, so a stale copy would
   exercise the real code and the control would report a false pass. */
const IN_SCOPE = [
  path.join(PUBLIC, "shared-continuity-binding.js"),
  path.join(PUBLIC, "shared-continuity.js"),
  path.join(ROOT, "ofp", "ofp-validate.js"),
  path.join(ROOT, "ofp", "ofp-serialize.js"),
  path.join(ROOT, "ofp", "ofp-schema.js"),
  path.join(ROOT, "ofp", "ofp-migrate-rules.js"),
  path.join(ROOT, "ofp", "ofp-migrate.js"),
  path.join(__dirname, "continuity-state-binding.js"),
];
const inScope = (key) => IN_SCOPE.includes(key);

function applyEdits(label, original, edits) {
  let code = original;
  for (const [from, to] of edits) {
    assert(code.includes(from), `negative control anchor no longer exists in ${label}; the control must be updated, not deleted:\n${from}`);
    assert.strictEqual(code.split(from).length - 1, 1, `the anchor must be unique in ${label}:\n${from}`);
    const before = code;
    code = code.replace(from, to);
    assert.notStrictEqual(code, before, `the edit did not change ${label}; the control would test the real code:\n${from}`);
  }
  assert.notStrictEqual(code, original, `${label} was not modified at all`);
  return code;
}

function evict() {
  for (const key of Object.keys(require.cache)) if (inScope(key)) delete require.cache[key];
}

async function patchedModule(relative, edits, run) {
  const file = require.resolve(path.join(ROOT, relative));
  const code = applyEdits(relative, readLF(file), edits);
  const saved = new Map();
  for (const key of Object.keys(require.cache)) if (inScope(key)) { saved.set(key, require.cache[key]); delete require.cache[key]; }
  try {
    const copy = new Module(file, module);
    copy.filename = file;
    copy.paths = Module._nodeModulePaths(path.dirname(file));
    require.cache[file] = copy;
    copy._compile(code, file);
    copy.loaded = true;
    return await run();
  } finally {
    evict();
    for (const [key, value] of saved) require.cache[key] = value;
  }
}

/* The same edits, applied to server.js as the positive suite reads it. `applied`
   is the receipt that the file was actually reached — a typo in an anchor would
   otherwise mutate nothing and look like a pass. */
function serverMutator(edits) {
  const state = { applied: false };
  const mutate = (original) => {
    state.applied = true;
    return applyEdits("server.js", original.replace(/\r\n/g, "\n"), edits);
  };
  mutate.state = state;
  return mutate;
}

/* The positive suite, freshly compiled against whatever is currently in the
   cache. Only the suite itself is dropped: evicting the whole in-scope set here
   would delete the module patchedModule() just installed and quietly restore
   the real code. */
function freshSuite() {
  delete require.cache[path.join(__dirname, "continuity-state-binding.js")];
  return require("./continuity-state-binding");
}

/* Did the guarded phase actually fail? An assertion failure is detection; any
   other error is the control breaking, and is reported as such. */
async function expectRed(label, run) {
  try {
    await run();
  } catch (error) {
    if (error instanceof assert.AssertionError) return error.message.split("\n")[0];
    throw new Error(`${label}: the guard threw something that is not an assertion failure, so this is not a valid receipt:\n${error.stack || error.message}`);
  }
  throw new Error(`${label}: the guarded suite PASSED with the defect reintroduced. The regression test does not detect it.`);
}

const results = [];
async function control({ id, defect, mutatesModule, probe, guard }) {
  const body = async () => {
    const suite = freshSuite();
    await probe(suite);
    const detected = await expectRed(id, () => guard(suite));
    results.push({ id, defect, detected });
  };
  if (mutatesModule) await patchedModule(mutatesModule.file, mutatesModule.edits, body);
  else await body();
}

const FIXTURE = () => require("../ofp/ofp-json").parseJsonStrict(readLF(path.join(__dirname, "fixtures", "ofp", "continuity-bindings.ofp.json")));

async function main() {
  /* ---------------------------------------------------------------- NC-A
     The resolver ignores a frame override and uses the shot binding. This is
     the defect that would make an intentional intra-shot change invisible: the
     project says frame B is rain-soaked and every frame generates as clean. */
  await control({
    id: "NC-A",
    defect: "a frame override is ignored and the shot binding is used instead",
    mutatesModule: {
      file: "public/shared-continuity-binding.js",
      edits: [[
        `  const wantedFrame = text(frameId);
  if (wantedFrame) {`,
        `  const wantedFrame = "";
  if (wantedFrame) {`,
      ]],
    },
    probe: (suite) => {
      const Binding = require("../public/shared-continuity-binding");
      const Continuity = require("../public/shared-continuity");
      const shot = suite.runtimeProject().shots[0];
      suite.setShotState(shot, "CHAR-RHEA", suite.CLEAN);
      suite.setFrameState(shot, "fr-b", "character", "CHAR-RHEA", suite.WET);
      assert.strictEqual(Continuity.resolveDeclaredStateId(shot, "fr-b", "character", "CHAR-RHEA"), suite.CLEAN,
        "NC-A probe: the explicitly overridden frame was expected to resolve the shot's state instead");
      assert.strictEqual(Binding.resolveBoundStateId(Binding.readShotStateBindings(shot), "fr-b", "CHAR-RHEA"), suite.CLEAN,
        "NC-A probe: and the canonical resolver was expected to lose the override too");
    },
    guard: (suite) => suite.contractSection(),
  });

  /* ---------------------------------------------------------------- NC-B
     The resolver skips the shot binding and falls to the entity default. This
     is the defect server.js `derivedFrameContext` actually shipped with, which
     is why NC-B is guarded by the authority section as well as the contract. */
  await control({
    id: "NC-B",
    defect: "the shot-level binding is skipped and the entity default applies",
    mutatesModule: {
      file: "public/shared-continuity-binding.js",
      edits: [[
        `  const fromShot = (bindingSet.entityStates || []).find((entry) => entry && entry.entityId === text(entityId));`,
        `  const fromShot = null;`,
      ]],
    },
    probe: (suite) => {
      const Continuity = require("../public/shared-continuity");
      const shot = suite.runtimeProject().shots[0];
      suite.setShotState(shot, "CHAR-RHEA", suite.WET);
      assert.strictEqual(Continuity.resolveDeclaredStateId(shot, "fr-a", "character", "CHAR-RHEA"), "",
        "NC-B probe: a shot that declares rain-soaked was expected to resolve nothing, so the caller falls to the entity default");
      assert.strictEqual(Continuity.resolveStateRecord(suite.runtimeProject().characters[0], "").id, suite.CLEAN,
        "NC-B probe: and that default is the clean state the shot overrode");
    },
    guard: (suite) => suite.contractSection(),
  });

  /* ---------------------------------------------------------------- NC-C
     State ids resolve globally. The duplicate-id fixture is the whole reason
     the binding carries an entity: twelve entities in the real corpus all
     declare `state-default`, so a global lookup answers the same thing for all
     of them and is wrong for all but one. */
  await control({
    id: "NC-C",
    defect: "a state id is resolved without entity scope, so state-default means whatever was found first",
    mutatesModule: {
      file: "public/shared-continuity-binding.js",
      edits: [[
        `function stateIdBelongsToEntity(states, stateId) {
  const wanted = text(stateId);
  if (!wanted) return false;
  return (Array.isArray(states) ? states : []).some((state) => isObject(state) && text(state.id) === wanted);
}`,
        `const GLOBAL_STATE_IDS = new Set();
function stateIdBelongsToEntity(states, stateId) {
  const wanted = text(stateId);
  if (!wanted) return false;
  for (const state of Array.isArray(states) ? states : []) if (isObject(state) && text(state.id)) GLOBAL_STATE_IDS.add(text(state.id));
  return GLOBAL_STATE_IDS.has(wanted);
}`,
      ]],
    },
    probe: () => {
      const Binding = require("../public/shared-continuity-binding");
      const character = [{ id: "state-default" }, { id: "state-alt" }];
      const prop = [{ id: "state-default" }, { id: "state-only-the-prop-has" }];
      Binding.stateIdBelongsToEntity(prop, "state-only-the-prop-has");
      assert.strictEqual(Binding.stateIdBelongsToEntity(character, "state-only-the-prop-has"), true,
        "NC-C probe: the character was expected to accept a state only the prop declares, which is what a global index does");
    },
    guard: (suite) => suite.ofpSection(),
  });

  /* ---------------------------------------------------------------- NC-D
     The validator accepts a binding whose state belongs to a different entity.
     Distinct from NC-C: the resolution rule is intact and the CHECK is gone,
     which is exactly what leaving the profile interior as passthrough would do. */
  await control({
    id: "NC-D",
    defect: "the validator no longer resolves a binding's state inside its own entity",
    mutatesModule: {
      file: "ofp/ofp-validate.js",
      edits: [[
        `      if (!stateIdBelongsToEntity(states, stateId))`,
        `      if (false && !stateIdBelongsToEntity(states, stateId))`,
      ]],
    },
    probe: () => {
      const { validateOfpDocument } = require("../ofp/ofp-validate");
      const document = FIXTURE();
      document.entities.props[0].states.push({ id: "state-only-the-prop-has", name: "Dented" });
      document.continuity.shots[0].entityStates = [{ entityId: "char-rhea", stateId: "state-only-the-prop-has" }];
      const result = validateOfpDocument(document);
      assert.strictEqual(result.diagnostics.some((entry) => entry.code === "continuity.binding.state-unresolved"), false,
        "NC-D probe: binding a character to a prop's state was expected to go unreported");
      assert.strictEqual(result.ok, true, "NC-D probe: and the document was expected to validate clean");
    },
    guard: (suite) => suite.ofpSection(),
  });

  /* ---------------------------------------------------------------- NC-E
     Two bindings for one entity at one scope are accepted. Absence means
     inherit, so a second binding makes the resolved state depend on array
     order — which is precisely what "array position is never identity" forbids. */
  await control({
    id: "NC-E",
    defect: "duplicate bindings at one scope are accepted, so the resolved state depends on array order",
    mutatesModule: {
      file: "public/shared-continuity-binding.js",
      edits: [[
        `    if (seen.has(entityId)) { if (!duplicates.includes(entityId)) duplicates.push(entityId); continue; }`,
        `    if (seen.has(entityId)) continue;`,
      ]],
    },
    probe: () => {
      const Binding = require("../public/shared-continuity-binding");
      const { validateOfpDocument } = require("../ofp/ofp-validate");
      assert.deepStrictEqual(Binding.duplicateBindingEntityIds([{ entityId: "a", stateId: "x" }, { entityId: "a", stateId: "y" }]), [],
        "NC-E probe: two bindings for one entity were expected to report as no duplicate at all");
      const document = FIXTURE();
      document.continuity.shots[0].entityStates = [
        { entityId: "char-rhea", stateId: "state-default" },
        { entityId: "char-rhea", stateId: "state-alt" },
      ];
      assert.strictEqual(validateOfpDocument(document).diagnostics.some((entry) => entry.code === "continuity.binding.duplicate"), false,
        "NC-E probe: and the validator was expected to accept the document");
    },
    guard: (suite) => suite.ofpSection(),
  });

  /* ---------------------------------------------------------------- NC-F
     The canonical writer drops frame overrides. The shot default survives, so
     the document still looks plausible and resolves to a LESS specific answer —
     the failure mode that would be hardest to notice in a diff. */
  await control({
    id: "NC-F",
    defect: "a canonical save keeps the shot binding and silently drops every frame override",
    mutatesModule: {
      file: "public/shared-continuity-binding.js",
      edits: [[
        `    if (frames.length) record.frames = frames;`,
        `    if (false) record.frames = frames;`,
      ]],
    },
    probe: () => {
      const Binding = require("../public/shared-continuity-binding");
      const built = Binding.buildContinuityProfile([{
        shotId: "SH-01",
        entityStates: [{ entityId: "CHAR-RHEA", stateId: "st-rhea-clean" }],
        frames: [{ frameId: "fr-b", entityStates: [{ entityId: "CHAR-RHEA", stateId: "st-rhea-wet" }] }],
      }]);
      assert.strictEqual("frames" in built.shots[0], false,
        "NC-F probe: the built profile was expected to carry no frames at all");
      assert.strictEqual(Binding.resolveProfileStateId(built, "SH-01", "fr-b", "CHAR-RHEA"), "st-rhea-clean",
        "NC-F probe: so an overridden frame resolves the shot default, which is plausible and wrong");
    },
    guard: (suite) => suite.driftSection(),
  });

  /* ---------------------------------------------------------------- NC-G
     Migration leaves a KNOWN, expressible state selection in the opaque legacy
     passthrough instead of re-homing it. This is the pre-P4-SEM-B behaviour and
     the one the batch exists to end: the data is not lost, it is unreadable. */
  await control({
    id: "NC-G",
    defect: "migration preserves an expressible state selection into the legacy extension instead of the continuity profile",
    mutatesModule: {
      file: "ofp/ofp-migrate-rules.js",
      edits: [[
        `          if (!admit(binding, "the shot", from)) continue;`,
        `          if (!admit(binding, "the shot", from) || true) continue;`,
      ]],
    },
    probe: () => {
      const { previewLegacyMigration } = require("../ofp/ofp-migrate");
      const { parseJsonStrict } = require("../ofp/ofp-json");
      const source = parseJsonStrict(readLF(path.join(__dirname, "fixtures", "ofp-legacy", "continuity-state-bindings.json")));
      const result = previewLegacyMigration(source, { at: "2026-08-10T00:00:00Z" });
      const bindA = (result.candidate.continuity && result.candidate.continuity.shots || []).find((entry) => entry.shotId === "BIND-A");
      assert.strictEqual(bindA, undefined, "NC-G probe: the shot-only fixture was expected to produce no canonical binding");
      const preserved = result.candidate.extensions["com.cinebraid.legacy"].preserved || [];
      const blob = preserved.find((entry) => entry.sourcePath === "/shots/0/continuityStateSelections");
      assert.deepStrictEqual(blob && blob.value, { "CHAR-RHEA": "st-rhea-wet" },
        "NC-G probe: and the selection was expected to end up in the opaque legacy blob instead");
    },
    guard: (suite) => suite.driftSection(),
  });

  /* ---------------------------------------------------------------- NC-H
     Profile data is written without `format.profiles` declaring the profile.
     The document then claims to be readable by a tool that would ignore
     precisely the data it carries. */
  await control({
    id: "NC-H",
    defect: "continuity profile data is written without declaring the profile",
    mutatesModule: {
      file: "ofp/ofp-migrate-rules.js",
      edits: [[
        `      if (format && Array.isArray(format.profiles) && !format.profiles.includes(Binding.CONTINUITY_PROFILE_ID))
        format.profiles.push(Binding.CONTINUITY_PROFILE_ID);`,
        `      if (false && format) format.profiles.push(Binding.CONTINUITY_PROFILE_ID);`,
      ]],
    },
    probe: () => {
      const { previewLegacyMigration } = require("../ofp/ofp-migrate");
      const { validateOfpDocument } = require("../ofp/ofp-validate");
      const { parseJsonStrict } = require("../ofp/ofp-json");
      const source = parseJsonStrict(readLF(path.join(__dirname, "fixtures", "ofp-legacy", "continuity-state-bindings.json")));
      const result = previewLegacyMigration(source, { at: "2026-08-10T00:00:00Z" });
      assert.deepStrictEqual(result.candidate.format.profiles, ["core", "bible", "shot-planning"],
        "NC-H probe: the profile was expected to go undeclared");
      assert(result.candidate.continuity, "NC-H probe: while the data itself was still written");
      assert(validateOfpDocument(result.candidate).diagnostics.some((entry) => entry.code === "continuity.profile.undeclared"),
        "NC-H probe: which the validator must be able to see, or the control proves nothing");
    },
    guard: (suite) => suite.ofpSection(),
  });

  /* ---------------------------------------------------------------- NC-I
     Opening an old project silently writes the migrated state. INV-R1 is the
     invariant this whole body of work exists for: a document that has merely
     been LOOKED AT must come back identical. */
  await control({
    id: "NC-I",
    defect: "inspecting a document canonicalises its continuity bindings in place",
    mutatesModule: {
      file: "ofp/ofp-validate.js",
      edits: [[
        `      checkBindingList(entry.entityStates, subject, \`\${where}/entityStates\`, \`shot \${JSON.stringify(shotId)}\`, contained);`,
        `      entry.entityStates = (entry.entityStates || []).map((binding) => ({ ...binding, stateId: binding.stateId || "state-default" }));
      if (!Array.isArray(entry.frames)) entry.frames = [];
      checkBindingList(entry.entityStates, subject, \`\${where}/entityStates\`, \`shot \${JSON.stringify(shotId)}\`, contained);`,
      ]],
    },
    probe: () => {
      const { validateOfpDocument } = require("../ofp/ofp-validate");
      const document = FIXTURE();
      const before = JSON.stringify(document);
      validateOfpDocument(document);
      assert.notStrictEqual(JSON.stringify(document), before,
        "NC-I probe: the document was expected to change merely by being validated");
      assert(Array.isArray(document.continuity.shots[0].frames),
        "NC-I probe: and to have acquired a frames collection nobody authored");
    },
    guard: (suite) => suite.ofpSection(),
  });

  /* ---------------------------------------------------------------- NC-J
     The FLF motion gate is moved out of the deterministic health pass and made
     conditional on continuity. P4-SEM-B is not B2b: it makes state authority
     durable, and redirecting the motion go/no-go decision to a continuity
     engine would decide B2b by accident. */
  await control({
    id: "NC-J",
    defect: "the FLF motion-readiness gate is redirected through the continuity resolver",
    mutatesModule: {
      file: "src/assistant/agent-suite.js",
      edits: [[
        `        if (!a?.winner || !b?.winner)`,
        `        const declaredState = require("../../public/shared-continuity").resolveDeclaredStateId(s, c.toFrame, "character", (s.characters || [])[0] || "");
        if (!declaredState && (!a?.winner || !b?.winner))`,
      ]],
    },
    probe: (suite) => {
      const { deterministicHealth } = require("../src/assistant/agent-suite");
      const project = suite.runtimeProject();
      const shot = project.shots[0];
      shot.keyframes[0].winner = "fr-a-approved.png";
      shot.clips = [{ id: "seg-1", kind: "flf", label: "1", fromFrame: "fr-a", toFrame: "fr-b", motionPrompt: "She steps out." }];
      suite.setShotState(shot, "CHAR-RHEA", suite.WET);
      suite.setFrameState(shot, "fr-b", "character", "CHAR-RHEA", suite.CLEAN);
      assert.deepStrictEqual(deterministicHealth(project, { shots: {} }).filter((entry) => entry.type === "blocked-flf"), [],
        "NC-J probe: a declared frame state was expected to open the motion gate with an unapproved endpoint, which is exactly the decision B2b owns");
    },
    guard: (suite) => suite.motionGateSection(),
  });

  const EXPECTED = ["NC-A", "NC-B", "NC-C", "NC-D", "NC-E", "NC-F", "NC-G", "NC-H", "NC-I", "NC-J"];
  assert.deepStrictEqual(results.map((row) => row.id), EXPECTED, "every control must have run, in order");
  for (const row of results) {
    assert(row.detected, `${row.id} produced no failure message`);
    console.log(`  ${row.id.padEnd(6)} detected: ${row.detected.slice(0, 120)}`);
  }
  console.log(`\nP4-SEM-B negative controls passed: ${results.length} defects reintroduced, ${results.length} caught, every one with a live-defect receipt. Nothing was written to disk and nothing was reverted with git. Provider calls made: 0.`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});

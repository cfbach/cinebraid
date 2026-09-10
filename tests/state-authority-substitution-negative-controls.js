/* Negative controls for state-specific authority.
 *
 * A green suite proves nothing unless the defect it describes would actually
 * turn it red. Each control below REINTRODUCES one specific defect, runs the
 * assertion that is supposed to catch it, and requires that assertion to fail.
 * A control that passes is a control that caught nothing, and this file fails
 * on it.
 *
 * NOTHING IS WRITTEN TO DISK AND NOTHING IS REVERTED WITH GIT. Client defects go
 * through render()'s `mutateSource` hook, which rewrites the shipped script text
 * on its way into the vm. Server defects lift a mutated copy of server.js by
 * exact source into a vm context, or compile a mutated shared module into an
 * in-memory Module. A `git checkout` used to restore a control here and
 * discarded four unstaged repairs doing it; there is no checkout in this file.
 *
 * A SYNTAX OR REFERENCE ERROR IS NOT A RECEIPT. Every mutation asserts that it
 * matched the source it meant to match, every guard is required to PASS against
 * the shipped source first, and every failure must be an AssertionError from the
 * guard being tested. A control that blew a file up would "fail" for a reason
 * that has nothing to do with the property, so those are reported as broken
 * controls rather than counted as detections.
 *
 * NO PAID PROVIDER CALL IS POSSIBLE HERE. Nothing dispatches a generation.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const { render, buildFixture } = require("./render-harness");
const Entities = require("../public/shared-entities");

const DEFAULT_ID = "state-default";
const ALT_ID = "state-alt";
const CLEAN_FILE = "CHAR-RHEA-CLEAN.png";
const WET_FILE = "CHAR-RHEA-WET.png";
const OTHER_WET_FILE = "CHAR-MARA-WET.png";
const CLOSED_FILE = "PROP-CASE-CLOSED.png";
const OPEN_FILE = "PROP-CASE-OPEN.png";
const DOOR_FILE = "LOC-DOOR.png";

const SERVER_SOURCE = fs.readFileSync(path.join(ROOT, "src/server/server.js"), "utf8");
const CONTINUITY_SOURCE = fs.readFileSync(path.join(ROOT, "public", "shared-continuity.js"), "utf8");
const AGENT_SOURCE = fs.readFileSync(path.join(ROOT, "src/assistant/agent-suite.js"), "utf8");

/* ---------------------------------------------------------------------------
   The same fixture the positive suite uses, so a control reproduces its defect
   against the case that is supposed to catch it and not against a shape chosen
   to make the control easy.

   `secondCharacter` exists for one control only: two characters that both
   declare `state-alt`, one of them approved. That is the shape a global state
   lookup gets wrong and a per-entity one gets right. */

function fixture(options = {}) {
  const { wetApproved = false, openApproved = false, shotStates = {}, frameStates = {}, secondCharacter = false } = options;
  const project = buildFixture();
  project.characters = [{
    id: "CHAR-RHEA", name: "Rhea", status: "APPROVED", approvedFile: CLEAN_FILE,
    continuityStates: [
      { id: DEFAULT_ID, name: "Clean", isDefault: true, approvedFile: CLEAN_FILE },
      { id: ALT_ID, name: "Rain-soaked", stateDelta: "Soaked through.", approvedFile: wetApproved ? WET_FILE : "" },
    ],
  }];
  if (secondCharacter) project.characters.push({
    id: "CHAR-MARA", name: "Mara", status: "APPROVED", approvedFile: "CHAR-MARA-CLEAN.png",
    continuityStates: [
      { id: DEFAULT_ID, name: "Clean", isDefault: true, approvedFile: "CHAR-MARA-CLEAN.png" },
      { id: ALT_ID, name: "Rain-soaked", stateDelta: "Soaked through.", approvedFile: OTHER_WET_FILE },
    ],
  });
  project.props = [{
    id: "PROP-CASE", name: "Flight case", status: "APPROVED", approvedFile: CLOSED_FILE,
    continuityStates: [
      { id: DEFAULT_ID, name: "Closed", isDefault: true, approvedFile: CLOSED_FILE },
      { id: ALT_ID, name: "Open", stateDelta: "Lid up.", approvedFile: openApproved ? OPEN_FILE : "" },
    ],
  }];
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
    desc: "She steps out of the rain and back into it.", positioning: "Locked wide composition.",
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

const DISK_FILES = {
  "anchors/CHAR-RHEA-CLEAN.png": "clean",
  "anchors/CHAR-RHEA-WET.png": "wet",
  "anchors/CHAR-MARA-CLEAN.png": "mara-clean",
  "anchors/CHAR-MARA-WET.png": "mara-wet",
  "props/PROP-CASE-CLOSED.png": "closed",
  "props/PROP-CASE-OPEN.png": "open",
  "plates/LOC-DOOR.png": "door",
};

function scanFor(project) {
  return {
    anchors: [
      { name: CLEAN_FILE, url: `/assets/anchors/${CLEAN_FILE}` },
      { name: WET_FILE, url: `/assets/anchors/${WET_FILE}` },
      { name: "CHAR-MARA-CLEAN.png", url: "/assets/anchors/CHAR-MARA-CLEAN.png" },
      { name: OTHER_WET_FILE, url: `/assets/anchors/${OTHER_WET_FILE}` },
    ],
    plates: [{ name: DOOR_FILE, url: `/assets/plates/${DOOR_FILE}` }],
    props: [{ name: CLOSED_FILE, url: `/assets/props/${CLOSED_FILE}` }, { name: OPEN_FILE, url: `/assets/props/${OPEN_FILE}` }],
    vehicles: [], audio: [], media: [],
    shots: Object.fromEntries((project.shots || []).map((shot) => [shot.id, { takes: [], locked: [], approved: [] }])),
  };
}

/* A source rewrite that PROVES it matched. `String.replace` with a miss is a
   silent no-op, and a control that quietly changed nothing would report the
   suite as green and be counted as a detection failure rather than as a broken
   control. */
function rewrite(source, find, replacement, label) {
  const count = source.split(find).length - 1;
  /* A plain Error, deliberately not an AssertionError: an anchor that stopped
     matching is a BROKEN control, and the runner below only counts an
     AssertionError as a detection. Anchors are single-line for the same reason
     the byte-hash suites normalise — this checkout is core.autocrlf=true, and a
     multi-line anchor written with \n matches nothing on disk. */
  if (count !== 1) throw new Error(`control ${label}: the anchor must appear exactly once, found ${count}\n  anchor: ${find}`);
  return source.split(find).join(replacement);
}

/* ---------------------------------------------------------------------------
   The server authority path, with either module mutable in memory. */

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `server.js no longer declares ${name}`);
  let depth = 0, seen = false;
  for (let index = source.indexOf("{", start); index < source.length; index++) {
    const character = source[index];
    if (character === "{") { depth++; seen = true; continue; }
    if (character === "}") { depth--; if (seen && depth === 0) return source.slice(start, index + 1); }
  }
  throw new Error(`could not find the end of ${name} in server.js`);
}

/* A mutated shared-continuity.js compiled into an in-memory Module. The real
   filename and module paths are used so its own relative requires resolve; the
   file on disk is opened read-only and never written. */
function compileContinuity(source) {
  const filename = path.join(ROOT, "public", "shared-continuity.js");
  const compiled = new Module(filename, null);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  compiled._compile(source, filename);
  return compiled.exports;
}

function serverAuthority(options = {}) {
  const serverSource = options.mutateServer ? String(options.mutateServer(SERVER_SOURCE)) : SERVER_SOURCE;
  const Continuity = compileContinuity(options.mutateContinuity ? String(options.mutateContinuity(CONTINUITY_SOURCE)) : CONTINUITY_SOURCE);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-state-authority-nc-"));
  for (const folder of ["anchors", "plates", "props", "vehicles", "shots"]) fs.mkdirSync(path.join(temp, folder), { recursive: true });
  for (const [relative, body] of Object.entries(DISK_FILES)) fs.writeFileSync(path.join(temp, relative), body);

  const project = fixture(options);
  const shot = project.shots[0];
  const context = vm.createContext({
    fs, path, console, Continuity,
    PROJECT_DIR: () => temp,
    IMG_ONLY: (name) => /\.(png|jpg|jpeg|webp|gif)$/i.test(String(name)),
    projectAssetPath: (file) => (file ? path.join(temp, String(file)) : ""),
    resolveShotEntities: Entities.resolveShotEntities,
    /* Only NC-F's defect reads this: every state record in the project, which is
       what a GLOBAL state lookup would have available to it. */
    __ALL_ENTITY_STATES: [...project.characters, ...project.props, ...project.locations]
      .flatMap((entity) => entity.continuityStates || []),
  });
  vm.runInContext(
    `${extractFunction(serverSource, "entityApprovedDiskPath")}\n${extractFunction(serverSource, "derivedFrameContext")}\n` +
    `globalThis.__direct = (list, entity, stateId) => entityApprovedDiskPath(list, entity, stateId);\n` +
    `globalThis.__frame = (P, shot, frame) => derivedFrameContext(P, shot, frame);`,
    context,
  );
  return {
    project, shot,
    direct: (list, entity, stateId) => { const file = context.__direct(list, entity, stateId); return file ? path.basename(file) : ""; },
    authorityFor: (frameId) => {
      const frame = shot.keyframes.find((row) => row.id === frameId);
      return [...context.__frame(project, shot, frame)].filter((row) => /authority/.test(row.role)).map((row) => path.basename(row.file)).sort();
    },
    dispose: () => fs.rmSync(temp, { recursive: true, force: true }),
  };
}

async function runtime(options = {}) {
  const project = fixture(options);
  const view = await render("#/create", project, {
    scan: scanFor(project),
    mutateSource: (file, source) => (options.mutateClient ? options.mutateClient(file, source) : source),
  });
  vm.runInContext(`CONFIG = { ...(typeof CONFIG === "object" ? CONFIG : {}), generation: { fal: { enabled: true, apiKey: "state-authority-fixture-key" } } };`, view.context);
  const live = vm.runInContext("P", view.context);
  const shot = live.shots.find((row) => row.id === "SH-01");
  return { context: view.context, project: live, shot, frames: [...view.context.guidedFrames(shot)] };
}

function referenceFilesFor(env, frameId, entityId) {
  const index = env.frames.findIndex((frame) => frame.id === frameId);
  const frame = env.frames[index];
  const state = env.context.guidedFrameState(env.shot, frame, index);
  return [...env.context.guidedFramePromptRefs(env.shot, frame, index, state)]
    .filter((ref) => ref.entityId === entityId && ref.url && !ref.supplemental)
    .map((ref) => ref.file)
    .sort();
}

const REFERENCE = /reference/;
const referenceErrors = (preflight) => [...preflight.errors].filter((line) => REFERENCE.test(line)).sort();

/* ---------------------------------------------------------------------------
   The anchors, named once so a control that stops matching says so loudly. */

const SHARED_RULE_NON_DEFAULT = `  return String(state.approvedFile || "");`;
const SHARED_RESOLVE_LINE = "  return contract.resolveBoundStateId(bindings, frameId, entityId);";
const SERVER_RULE_LINE = "  const file = Continuity.stateApprovedFile(entity, state);";
const SERVER_DECLARED_LINE = `  const declared = (kind, entity) => (entity ? Continuity.resolveDeclaredStateId(shot, frame.id, kind, entity.id) : "");`;
const SERVER_REQUESTED_LINE = "  const requested = stateId ? states.find((item) => String(item?.id) === String(stateId)) : null;";
const CLIENT_STATE_BY_ID = "  return states.find((st) => st.id === stateId) || null;";
const V607_FRAME_LINE = "    let out = shotCreationPromptReferences(s, frame?.id || \"\");";
const BINDING_SHOT_LINE = "  return pickBinding(bindingSet.entityStates, entityId);";

/* ---------------------------------------------------------------------------
   The controls. */

const CONTROLS = [
  {
    id: "NC-A",
    title: "the shared rule falls back to the entity's default file for ANY state",
    async guard(options = {}) {
      const env = serverAuthority({ ...options, wetApproved: false, openApproved: false });
      try {
        assert.strictEqual(env.direct("characters", env.project.characters[0], ALT_ID), "",
          "case 3: a declared non-default state with no approved file has NO authority — not the clean image");
      } finally { env.dispose(); }
      const browser = await runtime({
        ...options, wetApproved: false, openApproved: false,
        mutateClient: (file, source) => (file === "shared-continuity.js" && options.mutateContinuity ? options.mutateContinuity(source) : source),
      });
      assert.strictEqual(browser.context.entityApprovedFileForState(browser.project.characters[0], ALT_ID), "",
        "case 3: and the browser lookup agrees");
    },
    defect: {
      mutateContinuity: (source) => rewrite(source, SHARED_RULE_NON_DEFAULT,
        `  return String(state.approvedFile || entity.approvedFile || "");`, "NC-A"),
    },
  },
  {
    id: "NC-B",
    title: "server.js restores its own fallback past the shared rule",
    async guard(options = {}) {
      const env = serverAuthority({
        ...options, wetApproved: false, openApproved: true,
        shotStates: { "CHAR-RHEA": DEFAULT_ID },
        frameStates: { "fr-b": { character: { "CHAR-RHEA": ALT_ID } } },
      });
      try {
        assert.ok(!env.authorityFor("fr-b").includes(CLEAN_FILE),
          "case 3/4: the clean image is nowhere in Frame B's authority package");
      } finally { env.dispose(); }
    },
    defect: {
      mutateServer: (source) => rewrite(source, SERVER_RULE_LINE,
        `  const file = state?.approvedFile || entity.approvedFile || "";`, "NC-B"),
    },
  },
  {
    id: "NC-C",
    title: "the server authority path ignores the frame override and reads the shot state",
    async guard(options = {}) {
      const env = serverAuthority({
        ...options, wetApproved: true, openApproved: true,
        shotStates: { "CHAR-RHEA": DEFAULT_ID, "PROP-CASE": DEFAULT_ID },
        frameStates: { "fr-b": { character: { "CHAR-RHEA": ALT_ID }, prop: { "PROP-CASE": ALT_ID } } },
      });
      try {
        assert.deepStrictEqual(env.authorityFor("fr-b"), [WET_FILE, DOOR_FILE, OPEN_FILE].sort(),
          "case 4: Frame B follows its own override, for both entities independently");
      } finally { env.dispose(); }
    },
    defect: {
      mutateServer: (source) => rewrite(source, SERVER_DECLARED_LINE,
        `  const declared = (kind, entity) => (entity ? Continuity.resolveDeclaredStateId(shot, "", kind, entity.id) : "");`, "NC-C"),
    },
  },
  {
    id: "NC-D",
    title: "the browser reference package ignores the frame override and reads the shot state",
    async guard(options = {}) {
      const env = await runtime({
        ...options, wetApproved: true, openApproved: true,
        shotStates: { "CHAR-RHEA": DEFAULT_ID, "PROP-CASE": DEFAULT_ID },
        frameStates: { "fr-b": { character: { "CHAR-RHEA": ALT_ID }, prop: { "PROP-CASE": ALT_ID } } },
      });
      assert.deepStrictEqual(referenceFilesFor(env, "fr-b", "CHAR-RHEA"), [WET_FILE],
        "case 4: Frame B's package carries its OWN override's rain-soaked authority");
    },
    defect: {
      mutateClient: (file, source) => (file === "v607-composer.js"
        ? rewrite(source, V607_FRAME_LINE, `    let out = shotCreationPromptReferences(s, "");`, "NC-D")
        : source),
    },
  },
  {
    id: "NC-E",
    title: "the shot's declared state is skipped and an unoverridden frame falls to the entity default",
    async guard(options = {}) {
      const env = serverAuthority({ ...options, wetApproved: true, shotStates: { "CHAR-RHEA": ALT_ID } });
      try {
        assert.deepStrictEqual(env.authorityFor("fr-a"), [WET_FILE, DOOR_FILE, CLOSED_FILE].sort(),
          "case 5: a frame that declares nothing inherits the shot's rain-soaked authority");
      } finally { env.dispose(); }
    },
    defect: {
      /* The shot scope is dropped from the binding set, so a frame that
         declares nothing falls straight past the shot to the entity default —
         the P4-SEM-B defect, re-entered one layer below where that batch fixed
         it. */
      mutateContinuity: (source) => rewrite(source, SHARED_RESOLVE_LINE,
        `  return contract.resolveBoundStateId({ ...bindings, entityStates: [] }, frameId, entityId);`, "NC-E"),
    },
  },
  {
    id: "NC-F",
    title: "state ids are resolved globally, so another entity's approved state answers for this one",
    async guard(options = {}) {
      const env = serverAuthority({ ...options, wetApproved: false, secondCharacter: true });
      try {
        assert.strictEqual(env.direct("characters", env.project.characters[0], ALT_ID), "",
          "case 7/8: Rhea's unapproved `state-alt` resolves to nothing even though another character's `state-alt` is approved");
      } finally { env.dispose(); }
    },
    defect: {
      mutateServer: (source) => rewrite(source, SERVER_REQUESTED_LINE,
        "  const requested = stateId ? ((globalThis.__ALL_ENTITY_STATES || []).find((item) => String(item?.id) === String(stateId) && item?.approvedFile) || states.find((item) => String(item?.id) === String(stateId))) : null;", "NC-F"),
    },
  },
  {
    id: "NC-G",
    title: "the browser resolves state ids globally across every entity in the project",
    async guard(options = {}) {
      /* A second character, not attached to this shot, whose `state-alt` IS
         approved — the realistic leak, because its approved file lives in the
         same anchors bucket and would survive every folder check. */
      const env = await runtime({
        ...options, wetApproved: false, openApproved: true, secondCharacter: true,
        frameStates: { "fr-b": { character: { "CHAR-RHEA": ALT_ID }, prop: { "PROP-CASE": ALT_ID } } },
      });
      assert.deepStrictEqual(referenceFilesFor(env, "fr-b", "CHAR-RHEA"), [],
        "case 7/8: Rhea's unapproved `state-alt` resolves to nothing — no other entity's approval of the same id answers for it");
    },
    defect: {
      mutateClient: (file, source) => (file === "app.js"
        /* A global lookup that prefers whichever entity has approved the id —
           which is what "resolve the state id, then find its file" degrades to
           the moment the lookup is not scoped to one entity's own catalogue. */
        ? rewrite(source, CLIENT_STATE_BY_ID,
          "  return [...(P.characters || []), ...(P.props || []), ...(P.locations || []), ...(P.vehicles || [])].flatMap((other) => other.continuityStates || []).find((st) => st && st.id === stateId && st.approvedFile) || states.find((st) => st.id === stateId) || null;", "NC-G")
        : source),
    },
  },
  {
    id: "NC-H",
    title: "the preflight blocks while the generation authority still returns the default image",
    async guard(options = {}) {
      const shape = {
        wetApproved: false, openApproved: true,
        shotStates: { "CHAR-RHEA": DEFAULT_ID },
        frameStates: { "fr-b": { character: { "CHAR-RHEA": ALT_ID } } },
      };
      const browser = await runtime({ ...shape, ...options });
      assert.deepStrictEqual(referenceErrors(browser.context.v626ShotPreflight(browser.shot, ["fr-a", "fr-b", "fr-c"])),
        ["Frame B declares Rhea as Rain-soaked, which has no approved character reference."],
        "case 10: the preflight blocks the run, naming the frame and the state");
      const env = serverAuthority({ ...shape, ...options });
      try {
        assert.strictEqual(env.direct("characters", env.project.characters[0], ALT_ID), "",
          "case 10: and the generation authority lookup answers MISSING for the same state — the two must never disagree");
      } finally { env.dispose(); }
    },
    /* Only the generation side is broken. The preflight keeps blocking correctly,
       which is precisely the disagreement that is worse than either bug alone. */
    defect: {
      mutateServer: (source) => rewrite(source, SERVER_RULE_LINE,
        `  const file = state?.approvedFile || entity.approvedFile || "";`, "NC-H"),
    },
  },
];

/* ---------------------------------------------------------------------------
   NC-I — the FLF motion-readiness gate.

   Its own control, because the gate is not a client script and does not go
   through render(). A mutated copy of agent-suite.js is compiled into an
   in-memory Module; the file on disk is opened read-only and never written. */

function compileAgentSuite(source) {
  const filename = path.join(ROOT, "src/assistant/agent-suite.js");
  const compiled = new Module(filename, null);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  compiled._compile(source, filename);
  return compiled.exports;
}

function motionGateProject() {
  const project = fixture({});
  const shot = project.shots[0];
  shot.clips = [{ id: "seg-1", kind: "flf", label: "1", fromFrame: "fr-a", toFrame: "fr-b", motionPrompt: "She steps out." }];
  shot.keyframes[0].winner = "fr-a-approved.png";
  return project;
}

const GATE_CONTROLS = [
  {
    id: "NC-I1",
    title: "the FLF motion gate is weakened so it stops blocking unapproved endpoints",
    guard(exports) {
      const blocked = exports.deterministicHealth(motionGateProject(), { shots: {} }).filter((entry) => entry.type === "blocked-flf");
      assert.deepStrictEqual(blocked.map((entry) => entry.reason), ["FLF requires approved first and last frames."],
        "the FLF gate still blocks unapproved endpoints in its own words, untouched by this repair");
    },
    defect: (source) => rewrite(source, "        if (!a?.winner || !b?.winner)", "        if (false)", "NC-I1"),
  },
  {
    id: "NC-I2",
    title: "the FLF motion gate is rerouted through continuity state resolution",
    guard(exports, mutated) {
      void exports;
      const start = mutated.indexOf('if (c.kind === "flf")');
      const end = mutated.indexOf('reason: "FLF requires approved first and last frames."');
      assert.ok(start >= 0 && end > start, "the FLF gate is still where it was, in agent-suite.js");
      assert.ok(!/continuity|resolveDeclaredStateId|StateSelections|stateApprovedFile|entityApproved/i.test(mutated.slice(start, end)),
        "and nothing routes the motion go/no-go decision through continuity state resolution or authority selection");
    },
    defect: (source) => rewrite(source, "        if (!a?.winner || !b?.winner)",
      "        const declaredState = (s.continuityStateSelections || {})[\"CHAR-RHEA\"];\n        if ((!a?.winner || !b?.winner) && !declaredState)", "NC-I2"),
  },
];

/* ------------------------------------------------------------------------- */

async function main() {
  const results = [];
  let broken = 0;

  const record = async (control, run) => {
    let caught = null;
    try { await run(); } catch (error) { caught = error; }
    if (!caught) {
      results.push({ id: control.id, status: "MISSED", detail: "the defect was reintroduced and the guard still passed" });
      return;
    }
    if (caught.name !== "AssertionError") {
      broken++;
      results.push({ id: control.id, status: "BROKEN", detail: `${caught.name}: ${caught.message}` });
      return;
    }
    results.push({ id: control.id, status: "detected", detail: String(caught.message).split("\n")[0] });
  };

  for (const control of CONTROLS) {
    /* The guard must PASS against the shipped source first. Otherwise a control
       "detects" a defect that was never injected, and the receipt is worthless. */
    try {
      await control.guard({});
    } catch (error) {
      broken++;
      results.push({ id: control.id, status: "BROKEN", detail: `the guard fails against the SHIPPED source: ${String(error.message).split("\n")[0]}` });
      continue;
    }
    await record(control, () => control.guard(control.defect));
  }

  for (const control of GATE_CONTROLS) {
    try {
      control.guard(compileAgentSuite(AGENT_SOURCE), AGENT_SOURCE);
    } catch (error) {
      broken++;
      results.push({ id: control.id, status: "BROKEN", detail: `the guard fails against the SHIPPED source: ${String(error.message).split("\n")[0]}` });
      continue;
    }
    const mutated = control.defect(AGENT_SOURCE);
    await record(control, () => control.guard(compileAgentSuite(mutated), mutated));
  }

  for (const result of results) console.log(`  ${result.id.padEnd(6)} ${result.status.padEnd(9)} ${result.detail}`);

  /* Every file this suite mutated was mutated in memory. All three must be
     byte-identical to what was read at the top of this file. */
  for (const [label, file, source] of [
    ["server.js", path.join(ROOT, "src/server/server.js"), SERVER_SOURCE],
    ["public/shared-continuity.js", path.join(ROOT, "public", "shared-continuity.js"), CONTINUITY_SOURCE],
    ["agent-suite.js", path.join(ROOT, "src/assistant/agent-suite.js"), AGENT_SOURCE],
  ]) assert.strictEqual(fs.readFileSync(file, "utf8"), source, `${label} was modified on disk — every control here is in-memory only`);

  const missed = results.filter((result) => result.status === "MISSED");
  assert.strictEqual(broken, 0, `${broken} control(s) never reached their defect; a syntax or import failure is not a receipt`);
  assert.strictEqual(missed.length, 0, `${missed.length} defect(s) were reintroduced and nothing caught them: ${missed.map((result) => result.id).join(", ")}`);

  console.log(`\nState-specific authority negative controls passed: ${results.length} defects reintroduced, ${results.length} caught, every one with a live-defect receipt. Nothing was written to disk and nothing was reverted with git. Provider calls made: 0.`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});

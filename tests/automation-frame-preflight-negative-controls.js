/* Negative controls for the frame-specific continuity preflight.
 *
 * A green suite proves nothing unless the defect it describes would actually
 * turn it red. Each control below REINTRODUCES one specific defect, runs the
 * assertion that is supposed to catch it, and requires that assertion to fail.
 * A control that passes is a control that caught nothing, and this file fails
 * on it.
 *
 * NOTHING IS WRITTEN TO DISK AND NOTHING IS REVERTED WITH GIT. The client
 * defects are injected through render()'s `mutateSource` hook, which rewrites
 * the shipped script text on its way into the vm and never touches public/. The
 * one server-side control compiles a mutated copy of agent-suite.js into an
 * in-memory Module. A `git checkout` used to restore a control once discarded
 * four unstaged repairs in the same file; there is no checkout here to do it
 * again.
 *
 * A SYNTAX OR REFERENCE ERROR IS NOT A RECEIPT. Every mutation asserts that it
 * matched the source it meant to match, and every failure is required to be an
 * AssertionError from the guard being tested. A control that blew the file up
 * would "fail" for a reason that has nothing to do with the property, so those
 * are reported as broken controls rather than counted as detections.
 *
 * NO PAID PROVIDER CALL IS POSSIBLE HERE. Nothing dispatches a generation.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const { render, buildFixture } = require("./render-harness");

const CLEAN = "st-rhea-clean", WET = "st-rhea-wet";
const CLOSED = "st-case-closed", OPEN = "st-case-open";

/* ---------------------------------------------------------------------------
   The same fixture the positive suite uses, so a control reproduces the defect
   against the case that is supposed to catch it and not against a shape chosen
   to make the control easy. */

function fixtureProject(options = {}) {
  const {
    wetApproved = false,
    openApproved = false,
    shotStates = { "CHAR-RHEA": CLEAN, "PROP-CASE": CLOSED },
    frameStates = { "fr-b": { character: { "CHAR-RHEA": WET }, prop: { "PROP-CASE": OPEN } } },
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
  project.locations = [{ id: "LOC-DOOR", name: "Doorway", status: "APPROVED", approvedFile: "LOC-DOOR.png", continuityStates: [] }];
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

const REFERENCE = /reference/;
const referenceErrors = (preflight) => [...preflight.errors].filter((line) => REFERENCE.test(line)).sort();

/* A source rewrite that PROVES it matched. `String.replace` with a miss is a
   silent no-op, and a control that quietly changed nothing would report the
   suite as green and be counted as a detection failure rather than as a broken
   control. */
function rewrite(source, find, replacement, label) {
  const count = source.split(find).length - 1;
  assert.strictEqual(count, 1, `control ${label}: the anchor must appear exactly once in public/automation.js, found ${count}\n  anchor: ${find}`);
  return source.split(find).join(replacement);
}

async function preflightWith(options, frameIds, mutate) {
  const project = fixtureProject(options);
  const view = await render("#/create", project, {
    mutateSource: (file, source) => (file === "automation.js" && mutate ? mutate(source) : source),
  });
  vm.runInContext(`CONFIG = { ...(typeof CONFIG === "object" ? CONFIG : {}), generation: { fal: { enabled: true, apiKey: "k" } } };`, view.context);
  const live = vm.runInContext("P", view.context);
  const shot = live.shots.find((entry) => entry.id === "SH-01");
  const frames = view.context.guidedFrames(shot);
  const ids = frameIds || frames.map((frame) => frame.id);
  return { context: view.context, shot, frames, preflight: view.context.v626ShotPreflight(shot, ids) };
}

/* ---------------------------------------------------------------------------
   The controls. `defect` reintroduces it; `guard` runs the assertion that must
   catch it and is required to throw an AssertionError. */

const FRAME_STATE_LINE = "      const state = v626DeclaredState(shot, frame.id, label, item);";

const CONTROLS = [
  {
    id: "NC-A",
    title: "the preflight ignores an explicit frame override and reads the shot state only",
    async guard(mutate) {
      const run = await preflightWith({}, null, mutate);
      assert.deepStrictEqual(referenceErrors(run.preflight), [
        "Frame B declares Flight case as Open, which has no approved prop reference.",
        "Frame B declares Rhea as Rain-soaked, which has no approved character reference.",
      ], "case 1: an explicit frame override with no approved authority blocks, naming the frame and the state");
    },
    defect: (source) => rewrite(source, FRAME_STATE_LINE,
      '      const state = v626DeclaredState(shot, "", label, item);', "NC-A"),
  },
  {
    id: "NC-B",
    title: "with no frame override the shot's declared state is skipped for the entity default",
    async guard(mutate) {
      const run = await preflightWith({ frameStates: {}, shotStates: { "CHAR-RHEA": WET, "PROP-CASE": CLOSED } }, null, mutate);
      assert.deepStrictEqual(referenceErrors(run.preflight), [
        "Rhea needs an approved character reference for its declared state Rain-soaked.",
      ], "case 3: with no frame override the shot's declared state is what the preflight checks");
    },
    defect: (source) => rewrite(source,
      "  const stateId = resolveDeclaredStateId(shot, frameId, kind, entity.id);",
      '  const stateId = "";', "NC-B"),
  },
  {
    id: "NC-C",
    title: "one entity clearing hides another entity's missing authority",
    async guard(mutate) {
      /* Rhea's rain-soaked reference exists; the case's open reference does not.
         Exactly one error, and it must be the prop's. */
      const run = await preflightWith({ wetApproved: true, openApproved: false }, null, mutate);
      assert.deepStrictEqual(referenceErrors(run.preflight), [
        "Frame B declares Flight case as Open, which has no approved prop reference.",
      ], "case 6/7: entities are evaluated independently, and the block names the one actually missing");
    },
    defect: (source) => rewrite(source,
      "      if (v626StateApprovedFile(item, state)) continue;",
      "      if (groups.some(([otherKind, list]) => list.some((other) => v626StateApprovedFile(other, v626DeclaredState(shot, frame.id, otherKind, other))))) continue;", "NC-C"),
  },
  {
    id: "NC-D",
    title: "one frame's declared state is applied to every frame in the run",
    async guard(mutate) {
      /* Frame B declares states with no authority. A run of frame A alone is
         still ready — unless every frame is being answered as if it were B. */
      const run = await preflightWith({}, ["fr-a"], mutate);
      assert.deepStrictEqual(referenceErrors(run.preflight), [],
        "case 8: a frame that is not in this run does not block this run");
    },
    defect: (source) => rewrite(source, FRAME_STATE_LINE,
      '      const state = v626DeclaredState(shot, "fr-b", label, item);', "NC-D"),
  },
  {
    id: "NC-E",
    title: "the preflight writes the resolved state into the frame record",
    async guard(mutate) {
      const run = await preflightWith({}, null, mutate);
      const declared = {};
      for (const [frameId, workflow] of Object.entries(run.shot.creationBrief.frameWorkflows || {}))
        for (const [key, value] of Object.entries(workflow || {})) {
          if (!/StateSelections$/.test(key)) continue;
          for (const [entityId, stateId] of Object.entries(value || {})) declared[`${frameId}/${entityId}`] = stateId;
        }
      assert.deepStrictEqual(JSON.parse(JSON.stringify(declared)), {
        "fr-b/CHAR-RHEA": WET, "fr-b/PROP-CASE": OPEN,
      }, "case 12: frames A and C say nothing, which is how they inherit");
    },
    defect: (source) => rewrite(source, FRAME_STATE_LINE,
      FRAME_STATE_LINE + "\n      if (frame.id && state) { const wf = (shot.creationBrief.frameWorkflows = shot.creationBrief.frameWorkflows || {}); wf[frame.id] = wf[frame.id] || {}; (wf[frame.id][label + \"StateSelections\"] = wf[frame.id][label + \"StateSelections\"] || {})[item.id] = state.id; }", "NC-E"),
  },
];

/* ---------------------------------------------------------------------------
   NC-F — the FLF motion-readiness gate.

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
  const project = fixtureProject({});
  const shot = project.shots[0];
  shot.clips = [{ id: "seg-1", kind: "flf", label: "1", fromFrame: "fr-a", toFrame: "fr-b", motionPrompt: "She steps out." }];
  shot.keyframes[0].winner = "fr-a-approved.png";
  return project;
}

const AGENT_SOURCE = fs.readFileSync(path.join(ROOT, "src/assistant/agent-suite.js"), "utf8");

const GATE_CONTROLS = [
  {
    id: "NC-F1",
    title: "the FLF motion gate is weakened so it stops blocking unapproved endpoints",
    guard(exports) {
      const blocked = exports.deterministicHealth(motionGateProject(), { shots: {} }).filter((entry) => entry.type === "blocked-flf");
      assert.deepStrictEqual(blocked.map((entry) => entry.reason), ["FLF requires approved first and last frames."],
        "case 14: the FLF gate still blocks on unapproved endpoints, in its own words");
    },
    defect: (source) => rewrite(source, "        if (!a?.winner || !b?.winner)", "        if (false)", "NC-F1"),
  },
  {
    id: "NC-F2",
    title: "the FLF motion gate is rerouted through a continuity input",
    guard(exports, mutated) {
      void exports;
      const start = mutated.indexOf('if (c.kind === "flf")');
      const end = mutated.indexOf('reason: "FLF requires approved first and last frames."');
      assert.ok(start >= 0 && end > start, "case 14: the FLF gate is still where it was, in agent-suite.js");
      assert.ok(!/continuity|resolveDeclaredStateId|StateSelections|v626/i.test(mutated.slice(start, end)),
        "case 14: and nothing here routes the motion go/no-go decision through a continuity engine");
    },
    defect: (source) => rewrite(source, "        if (!a?.winner || !b?.winner)",
      "        const declaredState = (s.continuityStateSelections || {})[\"CHAR-RHEA\"];\n        if ((!a?.winner || !b?.winner) && !declaredState)", "NC-F2"),
  },
];

/* ------------------------------------------------------------------------- */

async function main() {
  const results = [];
  let broken = 0;

  const record = async (control, run) => {
    let caught = null;
    try {
      await run();
    } catch (error) {
      caught = error;
    }
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
      await control.guard(null);
    } catch (error) {
      broken++;
      results.push({ id: control.id, status: "BROKEN", detail: `the guard fails against the SHIPPED source: ${error.message.split("\n")[0]}` });
      continue;
    }
    await record(control, () => control.guard(control.defect));
  }

  for (const control of GATE_CONTROLS) {
    try {
      control.guard(compileAgentSuite(AGENT_SOURCE), AGENT_SOURCE);
    } catch (error) {
      broken++;
      results.push({ id: control.id, status: "BROKEN", detail: `the guard fails against the SHIPPED source: ${error.message.split("\n")[0]}` });
      continue;
    }
    const mutated = control.defect(AGENT_SOURCE);
    await record(control, () => control.guard(compileAgentSuite(mutated), mutated));
  }

  for (const result of results) console.log(`  ${result.id.padEnd(6)} ${result.status.padEnd(9)} ${result.detail}`);

  /* agent-suite.js was read, mutated in memory and compiled from a string. It
     must be byte-identical to what was read at the top of this file. */
  assert.strictEqual(fs.readFileSync(path.join(ROOT, "src/assistant/agent-suite.js"), "utf8"), AGENT_SOURCE,
    "agent-suite.js was modified on disk — every control here is in-memory only");

  const missed = results.filter((result) => result.status === "MISSED");
  assert.strictEqual(broken, 0, `${broken} control(s) never reached their defect; a syntax or import failure is not a receipt`);
  assert.strictEqual(missed.length, 0, `${missed.length} defect(s) were reintroduced and nothing caught them: ${missed.map((result) => result.id).join(", ")}`);

  console.log(`\nFrame-specific continuity preflight negative controls passed: ${results.length} defects reintroduced, ${results.length} caught, every one with a live-defect receipt. Nothing was written to disk and nothing was reverted with git. Provider calls made: 0.`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});

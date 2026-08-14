/* CONTINUITY-CORRECTION BOUNDARY SAFETY. Dogfood Pass #2 A5, forensic audit F7.
 *
 * THE PROPERTY THIS FILE EXISTS FOR, in one line: a correction package for a
 * shot with no previous or no next neighbour builds, omits the missing anchor,
 * keeps every valid one, and never dereferences a shot that does not exist.
 *
 * THE CASE, from the pass:
 *
 *     Generate 3 S04-03 continuity corrections · round 1
 *     FAILED
 *     Cannot read properties of undefined (reading 'id')
 *
 * The reference builder ALWAYS asked for a previous and a next shot. Boundary
 * packages carry "" for one of them, `shotById("")` returns undefined, and
 * v640SceneApprovedStill read `shot.id` off it — throwing before any provider
 * request existed. First shots, last shots, single-shot scenes and deleted
 * neighbours all hit the same line, so S04-03 was never a one-off.
 *
 * AND WHY RETRY COULD NEVER HAVE HELPED. The same static package is rebuilt from
 * the same inputs, so every retry reproduced the identical exception while
 * spending one of the run's authorized passes.
 *
 * NO PAID PROVIDER CALL IS POSSIBLE HERE. The harness intercepts fetch, and the
 * only functions exercised are the local package builders — the whole point is
 * that they fail (or now succeed) before any provider code is reached.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");
const { render, buildFixture } = require("./render-harness");

let checks = 0;
const ok = (condition, message) => { assert(condition, message); checks++; };
/* Values that came out of the vm realm carry THAT realm's Array.prototype, and
   assert.deepStrictEqual compares prototypes — so a realm array fails against a
   host literal while printing identically. Round-tripping through JSON rebuilds
   them with host prototypes, which is what makes the diff readable rather than
   a pair of matching lines that "differ". */
const plain = (value) => JSON.parse(JSON.stringify(value));
const eq = (actual, expected, message) => {
  assert.deepStrictEqual(plain(actual), expected, `${message}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  checks++;
};

/* ===========================================================================
   The fixture. A three-shot scene so first / middle / last are all reachable,
   with every shot carrying an approved opening still — because the neighbour
   cases must be isolated from "nothing is approved anywhere". */

function sceneFixture(options = {}) {
  const { shotCount = 3, approveAll = true, unapprovedNeighbourIds = [] } = options;
  const project = buildFixture();
  project.scenes = [{ id: "SC-BOUNDARY", title: "Rooftop sequence", whatHappens: "Three shots in order." }];
  project.shots = Array.from({ length: shotCount }, (unused, index) => {
    const id = `SB-0${index + 1}`;
    const approved = approveAll && !unapprovedNeighbourIds.includes(id);
    return {
      id, scene: "SC-BOUNDARY", title: `Shot ${index + 1}`, desc: "Slate and smoke.",
      positioning: "Locked wide.", workflowStatus: "IN PROGRESS", status: "BUILT",
      characters: [], codes: [], risks: [], notes: [], clips: [],
      keyframes: [{ id: `${id}-fr-a`, label: "A", title: "Opening frame", description: "The shot.", required: true, generationPackages: [], ...(approved ? { winner: "FRAME_A.png" } : {}) }],
      ...(approved ? { winner: "FRAME_A.png" } : {}),
      creationBrief: { frameWorkflows: {} },
    };
  });
  return project;
}

async function harness(project) {
  const rendered = await render("#/production", project);
  return rendered.context;
}

/* Build a package the way v640SceneCorrectionPackages does, but directly, so the
   test controls exactly which neighbour ids are present. */
function packageFor(targetShotId, previousShotId, nextShotId) {
  return {
    id: `pkg-${targetShotId}`, cycle: 1, type: "shot", findingId: "f1",
    targetShotId, previousShotId, nextShotId,
    summary: "Lighting drifts.", recommendation: "Match the previous key.",
    severity: "high", status: "planned", prompt: "SCENE CONTINUITY CORRECTION",
  };
}

async function referencesFor(context, pkg) {
  context.__pkg = pkg;
  return vm.runInContext("v640SceneCorrectionReferences(__pkg)", context);
}
async function preflightFor(context, pkg) {
  context.__pkg = pkg;
  return vm.runInContext("v640SceneCorrectionPreflight(__pkg)", context);
}

(async () => {
  const context = await harness(sceneFixture());

  /* =========================================================================
     1. THE CRASH ITSELF. Every boundary shape must build without throwing.

     The assertion is that the call RETURNS. Before this batch each of these
     threw `Cannot read properties of undefined (reading 'id')`. */

  const cases = [
    ["first shot — no previous", packageFor("SB-01", "", "SB-02")],
    ["last shot — no next", packageFor("SB-03", "SB-02", "")],
    ["middle shot — both neighbours", packageFor("SB-02", "SB-01", "SB-03")],
    ["deleted previous neighbour", packageFor("SB-02", "SB-DELETED", "SB-03")],
    ["deleted next neighbour", packageFor("SB-02", "SB-01", "SB-DELETED")],
    ["both neighbours missing", packageFor("SB-02", "", "")],
  ];
  for (const [label, pkg] of cases) {
    let refs;
    assert.doesNotThrow(() => { refs = vm.runInContext("v640SceneCorrectionReferences(__pkg)", Object.assign(context, { __pkg: pkg })); },
      `${label}: building correction references must not throw`);
    checks++;
    ok(Array.isArray(refs), `${label}: a reference list is returned`);
    ok(refs.some((ref) => ref.role === "base"), `${label}: the editable target still is always kept — it is the only structurally required anchor`);
  }

  /* Single-shot scene: the target has no neighbours at all, in either direction. */
  const single = await harness(sceneFixture({ shotCount: 1 }));
  const soloRefs = await referencesFor(single, packageFor("SB-01", "", ""));
  ok(soloRefs.some((ref) => ref.role === "base"), "a single-shot scene still produces its own editable target");
  eq(soloRefs.filter((ref) => ref.role === "continuity").length, 0, "and no continuity anchors, because there are none to have");

  /* =========================================================================
     2. VALID ANCHORS ARE PRESERVED. A repair that dropped the good neighbour
        along with the missing one would pass section 1 and produce worse
        corrections than the crash did. */

  const firstShot = await referencesFor(context, packageFor("SB-01", "", "SB-02"));
  eq(firstShot.filter((ref) => ref.role === "continuity").map((ref) => ref.key.split(":")[1]), ["SB-02"],
    "the first shot keeps its NEXT neighbour and omits only the previous one");
  const lastShot = await referencesFor(context, packageFor("SB-03", "SB-02", ""));
  eq(lastShot.filter((ref) => ref.role === "continuity").map((ref) => ref.key.split(":")[1]), ["SB-02"],
    "the last shot keeps its PREVIOUS neighbour and omits only the next one");
  const middle = await referencesFor(context, packageFor("SB-02", "SB-01", "SB-03"));
  eq(middle.filter((ref) => ref.role === "continuity").map((ref) => ref.key.split(":")[1]), ["SB-01", "SB-03"],
    "a middle shot keeps both — the ordinary case is unchanged");

  /* =========================================================================
     3. WHY IT WAS OMITTED, recorded rather than inferred from a shorter list. */

  const boundaryPkg = packageFor("SB-01", "", "SB-02");
  await referencesFor(context, boundaryPkg);
  eq((boundaryPkg.omittedAnchors || []).map((row) => row.reason), ["scene-boundary"],
    "a missing id is recorded as a scene boundary");

  const deletedPkg = packageFor("SB-02", "SB-DELETED", "SB-03");
  await referencesFor(context, deletedPkg);
  eq((deletedPkg.omittedAnchors || []).map((row) => row.reason), ["shot-no-longer-exists"],
    "a neighbour id that names nothing is recorded as deleted — a different fact from a boundary");

  /* A neighbour that EXISTS but has no approved still. Distinct again: the shot
     is there, the anchor simply is not. */
  const partial = await harness(sceneFixture({ unapprovedNeighbourIds: ["SB-01"] }));
  const noStillPkg = packageFor("SB-02", "SB-01", "SB-03");
  const noStillRefs = await referencesFor(partial, noStillPkg);
  eq((noStillPkg.omittedAnchors || []).map((row) => row.reason), ["no-approved-still"],
    "a neighbour with no approved still is recorded as such");
  eq(noStillRefs.filter((ref) => ref.role === "continuity").map((ref) => ref.key.split(":")[1]), ["SB-03"],
    "and the other neighbour is still used");

  /* =========================================================================
     4. THE LOCAL GATE. What IS required fails clearly, before provider code. */

  eq((await preflightFor(context, packageFor("SB-02", "SB-01", "SB-03"))).errors, [],
    "a package with a valid target passes preflight regardless of its neighbours");
  eq((await preflightFor(context, packageFor("SB-01", "", ""))).errors, [],
    "and so does a boundary package — the neighbours were never structurally required");

  const missingTarget = await preflightFor(context, packageFor("", "SB-01", "SB-02"));
  ok(missingTarget.errors.length > 0, "a package naming no target fails preflight");
  ok(/names no target shot/.test(missingTarget.errors[0].message), "with the missing thing named");
  ok(missingTarget.errors[0].remediation, "and what to do about it");

  const goneTarget = await preflightFor(context, packageFor("SB-GONE", "SB-01", "SB-02"));
  ok(goneTarget.errors.some((item) => /no longer exists/.test(item.message)), "a deleted TARGET fails — that one really is required");

  const unapproved = await harness(sceneFixture({ approveAll: false }));
  const noBase = await preflightFor(unapproved, packageFor("SB-02", "SB-01", "SB-03"));
  ok(noBase.errors.some((item) => /no approved base still/.test(item.message)),
    "a target with nothing approved fails — a correction edits an approved image");

  /* =========================================================================
     5. CLASSIFICATION. A deterministic local fault is not a provider fault, and
        must not spend a retry reproducing itself. */

  const error = vm.runInContext(`v640CorrectionPackageError("boom", { remediation: "fix it", packageId: "p" })`, context);
  ok(error.localPackageError === true, "the package error identifies itself");
  eq(error.failureClass, "local-package", "with the class the runner reads");
  eq(vm.runInContext(`v626FailureClass({ localPackageError: true })`, context), "local-package", "which v626FailStep classifies");
  eq(vm.runInContext(`v626FailureClass(new Error("FAL timed out"))`, context), "provider",
    "while an ordinary failure stays a provider fault — the retry path was built for those and keeps working");
  eq(vm.runInContext(`v626FailureClass({ code: "HUMAN_AUTHORITY_REQUIRED", authorityViolation: true })`, context), "local-package",
    "and an authority violation is deterministic too: retrying it would reproduce the same refusal");

  const runs = read("automation-runs.js");
  /* BATCH 1B widened the deterministic set: the universal pre-provider presence
     gate refuses before a job row exists, so `local-preflight` is deterministic
     on exactly the same terms and must not consume an attempt either. */
  ok(/const deterministic = \["local-package", "local-preflight"\]\.includes\(String\(steps\[stepKey\]\?\.failureClass \|\| ""\)\)/.test(runs),
    "the retry route reads the class, and both deterministic classes count");
  ok(/if \(!deterministic && \["generation", "scene-shot", "scene-correction", "scene-correction-review"\]\.includes\(next\.kind\)\)/.test(runs),
    "and does not advance the attempt counter for a deterministic fault — the step is still reset, because the creator may have repaired the project state, but nothing was attempted against a provider");
  ok(/failureClass: \["local-package", "local-preflight", "provider"\]\.includes/.test(runs), "and the class is persisted");

  /* =========================================================================
     6. THE SOURCE OF THE CRASH. */

  const scene = read("public/scene-automation.js").replace(/\/\*[\s\S]*?\*\//g, "");
  ok(/const id = shot && typeof shot === "object" \? String\(shot\.id \|\| ""\) : "";/.test(scene),
    "v640SceneApprovedStill answers for a missing shot instead of reading .id off it");
  ok(/if \(!id\) return null;/.test(scene), "returning null, because a neighbour that does not exist has no approved still — that is a fact, not an error");
  ok(/if \(pkg\.previousShotId\) addStill/.test(scene) && /if \(pkg\.nextShotId\) addStill/.test(scene),
    "and the reference builder no longer requests a neighbour it does not have");
  ok(/v640SceneCorrectionPreflight\(pkg\)/.test(scene), "with the local gate ahead of every generation round");
  ok(/throw v640CorrectionPackageError\(/.test(scene), "throwing a classified package error rather than a bare one");

  console.log(`Continuity-correction boundary suite passed ${checks} checks: first, middle, last, single-shot, deleted-neighbour and no-approved-still packages all build without dereferencing a missing shot; valid anchors preserved and omissions recorded with their distinct reasons; the local gate failing clearly before any provider code; and a deterministic package fault classified so it cannot consume an authorized retry.`);
})().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});

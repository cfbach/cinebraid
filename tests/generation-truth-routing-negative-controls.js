/* Negative controls for generation truth / routing.
 *
 * A regression suite that has never failed is a claim, not evidence. Each control
 * below reintroduces exactly ONE of the defects this batch removes and asserts that
 * the real guard — the same function tests/generation-truth-routing.js runs in the
 * green path, not a restatement of it — FAILS.
 *
 *   NC-A  the composer's collector stops delegating, and multi-frame keyframes go
 *         back to being decorative. The pre-fix defect verbatim.
 *   NC-B  the waypoints travel, but the beat written against each frame is dropped.
 *   NC-C  the waypoint sequence taken in reverse, so the panel's stored order stops
 *         being the order the provider receives.
 *   NC-D  `t2v` filtered out of the guided picker again, hiding the one wired
 *         text-to-video route.
 *   NC-E  text-to-video gathering reference images the fal schema cannot carry.
 *   NC-F  the prompt editor's ceiling hard-coded by family name back to the retired
 *         2,000.
 *   NC-G  CineBraid's written-package budget described as a provider schema limit
 *         again.
 *   NC-H  the grounding advice unconditional again, telling an endpoint-only
 *         workflow to attach a reference it has no slot for.
 *   NC-I  the grounding DISCLOSURE suppressed whenever an endpoint image exists —
 *         the over-correction, which silently drops the notice that a story name was
 *         replaced at all.
 *   NC-J  the route guard reading the shot-level fields the live writer stopped
 *         touching, so a directed shot is moved by a frame count again.
 *
 * NOTHING IS WRITTEN TO DISK AND NOTHING IS REVERTED WITH GIT. Each defect is
 * introduced by evaluating a MODIFIED COPY of the source in memory.
 *
 * AN EXCEPTION IS NOT PROOF A CONTROL RAN. Every control carries a receipt: the
 * anchor must exist, must be unique, must actually change the source, and the DEFECT
 * ITSELF must be observed through a probe before the guard's failure counts as
 * detection. Only an AssertionError counts — a syntax error, a module-load failure or
 * an unrelated crash is re-thrown.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const Suite = require("./generation-truth-routing");

/* Line endings are a checkout detail. This repo checks out CRLF on Windows, so a
   multi-line anchor written with \n would match nothing there and the control would
   report itself stale instead of biting. */
const readLF = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

const applied = [];
function mutateOnce(source, needle, replacement, label) {
  const text = String(source).replace(/\r\n/g, "\n");
  const occurrences = text.split(needle).length - 1;
  assert.strictEqual(occurrences, 1, `NEGATIVE CONTROL ANCHOR STALE — ${label} matched ${occurrences} times, expected exactly 1`);
  const next = text.replace(needle, replacement);
  assert.notStrictEqual(next, text, `NEGATIVE CONTROL — ${label} changed nothing`);
  applied.push(label);
  return next;
}
/* A source-only patch for the browser scripts, handed to the render harness. */
function mutateScript(fileName, needle, replacement, label) {
  return (file, source) => (file === fileName ? mutateOnce(source, needle, replacement, label) : source);
}
/* A modified copy of a Node module, compiled in memory. Never on disk, so no checkout
   can be what undoes it. */
function brokenModule(file, needle, replacement, label) {
  const mutated = mutateOnce(readLF(path.join(ROOT, file)), needle, replacement, label);
  const sandbox = { require: Module.createRequire(path.join(ROOT, file)), module: { exports: {} }, console, __dirname: ROOT, __filename: path.join(ROOT, file) };
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  vm.runInContext(mutated, sandbox, { filename: `${path.basename(file)}.broken.js` });
  return sandbox.module.exports;
}

const results = [];
async function control({ id, label, guards, defect, guarded }) {
  const observed = await defect();
  assert(observed && observed.seen === true,
    `NEGATIVE CONTROL ${id}: the defect probe did not observe the reintroduced defect, so nothing below proves anything`);
  let detected = null;
  try {
    await guarded();
  } catch (error) {
    if (!(error instanceof assert.AssertionError)) throw error;
    detected = error;
  }
  assert(detected, `NEGATIVE CONTROL ${id} FAILED: with "${label}" reintroduced, "${guards}" still passed. That test cannot detect the defect it exists for.`);
  results.push({ id, label, guards, receipt: observed.receipt, outcome: String(detected.message).split("\n")[0].slice(0, 130) });
}

async function main() {
  /* ======================================================================
     NC-A — the composer stops delegating to the multi-frame builder. */
  const A_ANCHOR = `    if (profile?.family === "minimax-h3" && profile.mode === "r2v")
      return guidedMotionReferencesRaw607(s, current, profile);`;
  const A_BROKEN = `    if (false)
      return guidedMotionReferencesRaw607(s, current, profile);`;
  const brokenDelegation = () => mutateScript("v607-composer.js", A_ANCHOR, A_BROKEN, "NC-A composer stops delegating multi-frame");
  await control({
    id: "NC-A",
    label: "the multi-frame keyframe sequence dropped from the live package",
    guards: "multi-frame sends the ordered keyframes",
    defect: async () => {
      const result = await Suite.multiFramePackage(brokenDelegation());
      /* RECEIPT: the package carries no waypoint at all, and the approved endpoint
         arrives as a lone first-frame — the exact pre-fix shape. */
      return {
        seen: result.waypoints.length === 0 && result.roles.includes("first-frame"),
        receipt: `roles ${result.roles.join(", ") || "(none)"} — ${result.waypoints.length} waypoints`,
      };
    },
    guarded: () => Suite.testMultiFrameSendsTheOrderedKeyframes(brokenDelegation()),
  });

  /* ======================================================================
     NC-B — waypoints travel without the beat directed against each frame. */
  const B_ANCHOR = `row.note ? \`Required beat: \${row.note}.\` : "Preserve this frame's approved visual state."`;
  const B_BROKEN = `"Preserve this frame's approved visual state."`;
  const brokenBeats = () => mutateScript("creation-studio.js", B_ANCHOR, B_BROKEN, "NC-B beat notes dropped from waypoints");
  await control({
    id: "NC-B",
    label: "the directed beat dropped from every waypoint",
    guards: "each waypoint carries its directed beat",
    defect: async () => {
      const result = await Suite.multiFramePackage(brokenBeats());
      const carried = result.waypoints.filter((w) => /BEAT/.test(w.instruction)).length;
      /* RECEIPT: the waypoints are still there and still ordered; only the direction
         written against each frame has gone. */
      return {
        seen: result.waypoints.length === 2 && carried === 0,
        receipt: `${result.waypoints.length} waypoints, ${carried} carrying a directed beat`,
      };
    },
    guarded: () => Suite.testEachWaypointCarriesItsDirectedBeat(brokenBeats()),
  });

  /* ======================================================================
     NC-C — the panel's stored order stops being the provider's order. */
  const C_ANCHOR = `const keyframes = h3ApprovedFrameRows(s).filter((row) => row.enabled).slice(0, 9);`;
  const C_BROKEN = `const keyframes = h3ApprovedFrameRows(s).filter((row) => row.enabled).slice(0, 9).reverse();`;
  const brokenOrder = () => mutateScript("creation-studio.js", C_ANCHOR, C_BROKEN, "NC-C waypoint order reversed");
  await control({
    id: "NC-C",
    label: "the waypoint sequence delivered in the wrong order",
    guards: "multi-frame sends the ordered keyframes",
    defect: async () => {
      const result = await Suite.multiFramePackage(brokenOrder());
      const files = result.waypoints.map((w) => w.file);
      /* RECEIPT: both frames still travel, so a count check would pass — only the
         ORDER, which is the production decision, has been inverted. */
      return {
        seen: files.length === 2 && files[0] === "FRAME_B.png",
        receipt: `waypoints delivered as ${files.join(" then ")}`,
      };
    },
    guarded: () => Suite.testMultiFrameSendsTheOrderedKeyframes(brokenOrder()),
  });

  /* ======================================================================
     NC-D — t2v filtered out of the guided picker again. */
  const D_ANCHOR = `["t2v", "i2v", "flf", "r2v", "audio-video"].includes(profile.mode)`;
  const D_BROKEN = `["i2v", "flf", "r2v", "audio-video"].includes(profile.mode)`;
  const brokenPicker = () => mutateScript("creation-studio.js", D_ANCHOR, D_BROKEN, "NC-D t2v filtered out of the picker");
  await control({
    id: "NC-D",
    label: "the one wired text-to-video route hidden from the picker",
    guards: "every dispatchable video route is reachable",
    defect: async () => {
      const result = await Suite.t2vReachability(brokenPicker());
      /* RECEIPT: a route the server annotates as dispatchable is absent from the
         list the filmmaker can choose from. */
      return { seen: result.inPicker === false, receipt: "minimax-h3/t2v is not in guidedVideoProfiles()" };
    },
    guarded: () => Suite.testEveryDispatchableVideoRouteIsReachable(brokenPicker()),
  });

  /* And the same defect caught by the picker-markup half, so a repair cannot satisfy
     the inventory check while leaving the option row unrenderable. */
  await control({
    id: "NC-D2",
    label: "the same route hidden, seen from the rendered option list",
    guards: "t2v is selectable and not disabled",
    defect: async () => {
      const result = await Suite.t2vReachability(brokenPicker());
      return { seen: result.inPicker === false, receipt: "the picker renders no t2v option row" };
    },
    guarded: () => Suite.testT2vIsSelectableAndNotDisabled(brokenPicker()),
  });

  /* ======================================================================
     NC-E — text-to-video gathering references the schema cannot carry. */
  /* Two independent things keep a t2v package empty, and the control has to defeat
     both or it proves nothing: the collector refuses to gather, and the reference
     budget refuses to assign because the profile declares maxReferences 0. The second
     mutation is the classic falsy-zero bug — `+limit || rows.length` reads a real
     limit of 0 as "no limit stated" — which is exactly how a declared ceiling of none
     turns into a ceiling of everything. */
  const E_ANCHOR = `    if (profile?.mode === "t2v") return [];
    const unit = activeMotionUnit(s), frames = guidedFrames(s), refs = [];`;
  const E_BROKEN = `    const unit = activeMotionUnit(s), frames = guidedFrames(s), refs = [];`;
  const E_ANCHOR2 = `    const totalLimit = Number.isFinite(+profile?.limits?.maxReferences) ? +profile.limits.maxReferences : rows.length;`;
  const E_BROKEN2 = `    const totalLimit = +profile?.limits?.maxReferences || rows.length;`;
  const brokenT2vRefs = () => (file, source) => {
    if (file !== "v607-composer.js") return source;
    return mutateOnce(
      mutateOnce(source, E_ANCHOR, E_BROKEN, "NC-E t2v gathers references"),
      E_ANCHOR2, E_BROKEN2, "NC-E a declared zero reference budget read as no budget",
    );
  };
  await control({
    id: "NC-E",
    label: "text-to-video gathering reference images fal's t2v schema cannot hold",
    guards: "t2v carries no reference images",
    defect: async () => {
      const result = await Suite.t2vReachability(brokenT2vRefs());
      /* RECEIPT: a package preview listing inputs the request has no field for. */
      return { seen: result.roles.length > 0, receipt: `t2v gathered ${result.roles.join(", ")}` };
    },
    guarded: () => Suite.testT2vCarriesNoReferenceImages(brokenT2vRefs()),
  });

  /* ======================================================================
     NC-F — the editor's ceiling hard-coded by family name again. */
  const F_ANCHOR = `  const limits = guidedVideoProfiles().find((item) => item.id === build?.profileId)?.limits || {};
  const published = Number(limits.publishedGuidePromptCharacters);
  if (Number.isFinite(published) && published > 0) return published;
  const budget = Number(limits.maxPromptCharacters);
  return Number.isFinite(budget) && budget > 0 ? budget : 12000;`;
  const F_BROKEN = `  const profile = guidedVideoProfiles().find((item) => item.id === build?.profileId);
  return profile?.family === "minimax-h3" ? 2000 : 12000;`;
  const brokenCeiling = () => mutateScript("creation-studio.js", F_ANCHOR, F_BROKEN, "NC-F editor ceiling keyed on a family name");
  await control({
    id: "NC-F",
    label: "the retired 2,000-character refusal restored in the prompt editor",
    guards: "the editor ceiling is not keyed on a family name",
    defect: async () => {
      /* RECEIPT: the ceiling read straight out of the mutated page — the retired
         number, back in force on a target whose model states 7,000. */
      const ceiling = await Suite.editorCeilingFor("minimax-h3/multi-frame", brokenCeiling());
      return { seen: ceiling === 2000, receipt: `the editor would refuse above ${ceiling} characters` };
    },
    guarded: () => Suite.testTheEditorCeilingIsNotKeyedOnAFamilyName(brokenCeiling()),
  });

  /* ======================================================================
     NC-G — the written-package budget claiming to be a provider rule. */
  const G_ANCHOR = `      result.warnings.unshift(\`\${profile.name} prompt is close to CineBraid's written-package budget: \${usage}. The dispatch limit is resolved separately from model and backend capability.\`);`;
  const G_BROKEN = `      result.warnings.unshift(\`\${profile.name} prompt is close to the provider schema limit: \${usage}.\`);`;
  const brokenClaim = () => brokenModule("prompt-engine.js", G_ANCHOR, G_BROKEN, "NC-G budget described as a provider schema limit");
  await control({
    id: "NC-G",
    label: "CineBraid's own budget described as the provider's schema limit",
    guards: "the compiler budget does not claim to be a provider rule",
    defect: () => {
      const engine = brokenClaim();
      const profile = engine.getProfile("minimax-h3/multi-frame");
      const refs = [{ key: "kf-1", label: "Beat 1", role: "sequential-keyframe", mediaType: "image", url: "/a.png", approved: true }];
      const spec = engine.defaultSpec(Suite.promptContext(), "motion", "r2v", refs, null);
      spec.narrativePurpose = "A long production objective with detailed requirements. ".repeat(60);
      const compiled = engine.compile(profile, spec, refs);
      const claim = (compiled.warnings || []).find((row) => /provider schema limit/i.test(row)) || "";
      /* RECEIPT: the sentence asserting a fal rule that fal's schema does not state. */
      return { seen: !!claim, receipt: claim.slice(0, 110) };
    },
    guarded: () => Suite.testTheCompilerBudgetDoesNotClaimToBeAProviderRule(brokenClaim()),
  });

  /* ======================================================================
     NC-H — the grounding advice unconditional again. */
  const H_ANCHOR = `    const action = ungrounded.every((row) => row.anchored)
      ? "Identity is carried by the approved starting image in this workflow; attach a character reference only on a target that accepts one."
      : canAttachAnotherImage
        ? "Attach an approved character image to use the story name in the model prompt."
        : \`\${profile?.name || "This target"} has no image reference slot left in this workflow, so the story name cannot be grounded here. Choose a reference-capable target if identity must come from an approved image.\`;`;
  const H_BROKEN = `    const action = "Attach an approved character image to use the story name in the model prompt.";`;
  const brokenAdvice = () => brokenModule("prompt-engine.js", H_ANCHOR, H_BROKEN, "NC-H grounding advice unconditional");
  await control({
    id: "NC-H",
    label: "an endpoint-only workflow told to attach a reference it has no slot for",
    guards: "the advice matches what the target can accept",
    defect: () => {
      const engine = brokenAdvice();
      const endpoint = { key: "shot-start", label: "Approved starting frame", mediaType: "image", role: "first-frame", url: "/frame.png", approved: true };
      const result = Suite.groundingWarning("minimax-h3/i2v", [endpoint], engine);
      /* RECEIPT: the impossible instruction, on a target whose single image slot is
         already spent on the approved opening frame. */
      return { seen: /attach an approved character image/i.test(result.warning), receipt: result.warning.slice(-100) };
    },
    guarded: () => Suite.testTheAdviceMatchesWhatTheTargetCanAccept(brokenAdvice()),
  });

  /* ======================================================================
     NC-I — the over-correction: the disclosure itself suppressed.

     This is the mistake made while repairing NC-H, kept as a control because the
     two are easy to conflate: telling a filmmaker to do something impossible and
     failing to tell them their character's name was replaced at all are opposite
     failures of the same sentence. */
  const I_ANCHOR = `  const ungrounded = replacements.filter((row) => !row.visual);`;
  const I_BROKEN = `  const ungrounded = replacements.filter((row) => !row.visual && !row.anchored);`;
  const brokenDisclosure = () => brokenModule("prompt-engine.js", I_ANCHOR, I_BROKEN, "NC-I disclosure suppressed when anchored");
  await control({
    id: "NC-I",
    label: "the replaced-name disclosure dropped whenever an endpoint image exists",
    guards: "a replaced story name is always disclosed",
    defect: () => {
      const engine = brokenDisclosure();
      const endpoint = { key: "shot-start", label: "Approved starting frame", mediaType: "image", role: "first-frame", url: "/frame.png", approved: true };
      const result = Suite.groundingWarning("minimax-h3/i2v", [endpoint], engine);
      /* RECEIPT: the story name is gone from the prompt and nothing says so. */
      return {
        seen: !result.warning && !/\bKai\b/.test(result.prompt),
        receipt: "the name was replaced in the prompt and no warning was emitted",
      };
    },
    guarded: () => Suite.testAReplacedStoryNameIsAlwaysDisclosed(brokenDisclosure()),
  });

  /* ======================================================================
     NC-J — the route guard reading where the live writer no longer writes. */
  const J_ANCHOR = `  const unit = (s.clips || []).find((item) => item.id === c.activeMotionUnitId) || (s.clips || [])[0] || null;
  const current = profiles.find((profile) => profile.id === (unit?.motionProfileId || c.motionProfileId));
  const hasUserMotionWork = !!String(unit?.motionPrompt || c.motionDirection || s.motionPrompt || "").trim() || !!(c.motionPromptBuilds || []).length;`;
  const J_BROKEN = `  const current = profiles.find((profile) => profile.id === c.motionProfileId);
  const hasUserMotionWork = !!String(c.motionDirection || s.motionPrompt || "").trim() || !!(c.motionPromptBuilds || []).length;`;
  const brokenGuard = () => mutateScript("creation-studio.js", J_ANCHOR, J_BROKEN, "NC-J route guard reads the abandoned fields");
  await control({
    id: "NC-J",
    label: "a directed shot moved off its chosen target by the frame count",
    guards: "an explicit target survives the frames handoff",
    defect: async () => {
      const result = await Suite.explicitTargetHandoff(brokenGuard());
      /* RECEIPT: the choice and the direction are both stored on the unit, and the
         guard - reading only the shot-level fields - suggests a different route. */
      return {
        seen: result.storedOnUnit === result.chosen && !!result.directionOnUnit
          && result.suggestedAtTwoApproved !== result.chosen,
        receipt: `chose ${result.chosen}, guard suggested ${result.suggestedAtTwoApproved}`,
      };
    },
    guarded: () => Suite.testAnExplicitTargetSurvivesTheFramesHandoff(brokenGuard()),
  });

  console.log(`Generation truth negative controls passed — ${results.length}/${results.length} reintroduced defects were detected by the guarding suite, every one with a live-defect receipt. Nothing was written to disk and nothing was reverted with git. Provider calls made: 0.`);
  for (const row of results) {
    console.log(`  ${row.id.padEnd(6)} detected: ${row.label}`);
    console.log(`           receipt: ${row.receipt}`);
    console.log(`           caught by: ${row.guards} — ${row.outcome}`);
  }
  assert(applied.length >= results.length, "every control must have applied at least one source mutation");
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

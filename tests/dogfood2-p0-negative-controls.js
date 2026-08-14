/* Negative controls for the Dogfood Pass #2 P0 trust batch.
 *
 * A guarantee nobody has watched fail is a guarantee nobody has tested.
 *
 * TWO TECHNIQUES, and they answer two different doubts.
 *
 *   REPRODUCTION CONTROLS run the PRE-REPAIR implementation, written out inline,
 *   against the same fixture the positive suite uses, and require it to exhibit
 *   the reported defect. This answers "is the fixture vacuous?" — a test whose
 *   fixture could never have triggered the bug proves nothing about the fix.
 *
 *   MUTATION CONTROLS rebuild a repaired module IN MEMORY from deliberately
 *   broken source and require the invariant to fail. This answers "is the
 *   assertion load-bearing?" — a check that passes against a broken build has
 *   stopped checking.
 *
 * IN MEMORY, ALWAYS. Nothing on disk is modified, so no control can be
 * "restored" by a checkout that also discards real work — the exact mistake that
 * cost four unstaged repairs on this repository once already.
 *
 * PROBE RECEIPTS. Every mutation asserts the text it replaces was really there,
 * so a control cannot quietly become a no-op after a refactor and start passing
 * against nothing.
 *
 * NO PROJECT DATA IS TOUCHED, AND NO PROVIDER OR PAID CALL IS POSSIBLE.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const source = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");

let controls = 0;
const notes = [];

function mutate(text, needle, replacement, label, expected = 1) {
  const hits = text.split(needle).length - 1;
  assert.strictEqual(hits, expected,
    `probe receipt: ${label} expected ${expected} occurrence(s) of its anchor, found ${hits}. `
    + "The control is no longer mutating the live path and must be rewritten.");
  return text.split(needle).join(replacement);
}

/* Rebuild one shared module from (possibly mutated) source, in its own realm.
   `window` is absent there, so the module takes its Node export path exactly as
   require() would. */
function build(relPath, text) {
  const moduleObject = { exports: {} };
  /* `require` is threaded through because shared-production-media.js pulls in
     its P4 sibling. Resolved from the real tree, so a control breaks exactly one
     module and every dependency stays honest. */
  const sandboxRequire = (specifier) => require(specifier.startsWith(".") ? path.join(ROOT, path.dirname(relPath), specifier) : specifier);
  vm.runInNewContext(text ?? source(relPath), { module: moduleObject, exports: moduleObject.exports, require: sandboxRequire, console }, { filename: relPath });
  return moduleObject.exports;
}

function control(label, run, expectation) {
  controls += 1;
  let failed = false;
  try { run(); }
  catch (error) {
    if (error instanceof assert.AssertionError) failed = true;
    else throw new Error(`${label}: the control threw something other than an assertion, so it proves nothing: ${error.stack || error.message}`);
  }
  assert.ok(failed, `${label}: the invariant survived the break. ${expectation}`);
  notes.push(`  ${label} — failed as required`);
}

/* ===========================================================================
   P0-1 — HUMAN-ONLY PRODUCTION AUTHORITY
   =========================================================================== */
notes.push("P0-1 production authority:");

/* REPRODUCTION. The shipped condition, verbatim from public/automation.js before
   this batch, on the review row the pass produced: an explicit PASS with an
   explicit score of 92 against a threshold of 85. If this does not evaluate
   true, the positive suite is guarding a branch that never fired. */
{
  const picked = { pass: true, explicitPass: true, explicitScore: true, score: 92 };
  const threshold = 85;
  const shippedAutoApprove = picked.pass && picked.explicitPass && picked.explicitScore && picked.score >= threshold;
  assert.strictEqual(shippedAutoApprove, true,
    "reproduction: the pre-repair auto-approve condition must fire on a high-scoring explicit pass — if it cannot, there was never a defect to fix here");
  controls += 1;
  notes.push("  R1 the pre-repair auto-approve branch fires on a 92/100 explicit pass — the defect is real and reachable");
}

control("C1 the grant accepts any truthy value", () => {
  const broken = build("public/shared-production-authority.js", mutate(
    source("public/shared-production-authority.js"),
    "  return PRODUCTION_AUTHORITY_ACTORS.includes(authorityText(it.actor)) && authorityText(it.act) === HUMAN_AUTHORITY_ACT;",
    "  return !!grant;",
    "C1",
  ));
  /* Every machine call site passed NOTHING, so `{}` is the shape a careless
     refactor would reintroduce. */
  assert.throws(() => broken.assertHumanAuthority({}, "Frame A"), assert.AssertionError);
  assert.ok(!broken.isHumanAuthorityGrant({}), "an empty object must not be a grant");
}, "A guard that accepts anything truthy would admit the empty object every machine call site actually passed.");

control("C2 the recommendation record carries a winner", () => {
  const broken = build("public/shared-production-authority.js", mutate(
    source("public/shared-production-authority.js"),
    "    file: authorityText(it.file),",
    "    file: authorityText(it.file),\n    winner: authorityText(it.file),",
    "C2",
  ));
  const row = broken.automationRecommendation({ file: "X.png", score: 92 });
  assert.ok(!("winner" in row), "a recommendation must not carry the authority field's name");
}, "A nomination that stores a `winner` is indistinguishable from an approval to every reader that looks for one.");

control("C3 a gate is satisfied by the entity's primary file", () => {
  const broken = build("public/shared-production-authority.js", mutate(
    source("public/shared-production-authority.js"),
    "      return authorityObject(state).isDefault === true && !!authorityText(authorityObject(entity).approvedFile);",
    "      return !!authorityText(authorityObject(entity).approvedFile);",
    "C3",
  ));
  const project = {
    shots: [],
    characters: [{
      id: "CHAR-A", approvedFile: "PRIMARY.png",
      continuityStates: [{ id: "state-default", isDefault: true, approvedFile: "PRIMARY.png" }, { id: "st-soot", approvedFile: "" }],
    }],
  };
  assert.ok(!broken.gateSatisfied({ kind: "entity-state-approval", list: "characters", entityId: "CHAR-A", stateId: "st-soot" }, project),
    "a declared non-default state with no file of its own is NOT satisfied by the entity's primary");
}, "This is the state-authority substitution defect wearing a new hat: it would close a real gate against the wrong image.");

control("C4 an unidentifiable gate is treated as satisfied", () => {
  const broken = build("public/shared-production-authority.js", mutate(
    source("public/shared-production-authority.js"),
    "  const requirements = runGateRequirements(run);\n  if (!requirements.length) return true;\n  return requirements.some((requirement) => !gateSatisfied(requirement, project));",
    "  return runGateRequirements(run).some((requirement) => !gateSatisfied(requirement, project));",
    "C4",
  ));
  assert.ok(broken.runHasActionableGate({ status: "awaiting-review", steps: {} }, { shots: [] }),
    "a gate whose object cannot be identified must stay actionable");
}, "Guessing 'satisfied' for a gate nobody can identify hides real work, which is the failure the whole reconciliation exists to end.");

control("C5 the projection ignores automation provenance", () => {
  const broken = build("public/shared-production-media.js", mutate(
    source("public/shared-production-media.js"),
    '    if (stored === "automatic") return "automation";',
    "",
    "C5",
  ));
  const project = {
    meta: {}, scenes: [], characters: [], locations: [], props: [], vehicles: [], audio: [], mediaAssets: [],
    shots: [{
      id: "SH-01", scene: "SC-01", title: "Rooftops",
      keyframes: [{ id: "fr-a", label: "A", winner: "A.png" }], clips: [], candidateFiles: [{ stored: "A.png" }],
      generationRecords: [{ id: "r", file: "A.png", files: "A.png", approval: "automatic" }],
    }],
  };
  /* The `/assets/…` url shape is load-bearing: storagePathOf() resolves media
     from it, and a row it cannot place produces no record at all — which would
     make this control pass against an empty list rather than against the rule. */
  const scan = { anchors: [], plates: [], props: [], vehicles: [], audio: [], media: [], shots: { "SH-01": { takes: [{ name: "A.png", url: "/assets/shots/SH-01/takes/A.png" }], locked: [], blocking: [] } } };
  const built = broken.productionMediaRecords({ project, scan, jobs: [], jobsAvailable: true });
  assert.strictEqual(built.records.length, 1, "probe receipt: C5's fixture must produce exactly one record, or the control proves nothing");
  const row = built.records[0];
  assert.strictEqual(row.humanDecision.state, "machine-selected",
    "an edge whose only recorded actor is automation must not read as a human decision");
}, "Collapsing the actor is the second half of A1: the record keeps the distinction and the projection throws it away.");

/* ===========================================================================
   P0-2 — FRAME-SPECIFIC TEMPORAL PRESENCE
   =========================================================================== */
notes.push("P0-2 frame presence:");

/* REPRODUCTION. Whole-shot compilation, as it worked before: the shot's cast is
   the frame's cast. Frame A gets the Sweep because the shot has him. */
{
  const shotCast = ["CHAR-X-SWEEP", "CHAR-X-WIDOW"];
  const frameACast = shotCast; /* there was no frame-level filter at all */
  assert.ok(frameACast.includes("CHAR-X-SWEEP"),
    "reproduction: before the presence contract there was no frame-level filter, so the shot's cast WAS the frame's cast");
  controls += 1;
  notes.push("  R2 whole-shot cast reaching a frame that excludes a member is exactly what the compiler used to do");
}

control("C6 declared absence stops forbidding presence", () => {
  const broken = build("public/shared-frame-presence.js", mutate(
    source("public/shared-frame-presence.js"),
    'const FRAME_PRESENCE_FORBIDDING_VALUES = ["absent"];',
    "const FRAME_PRESENCE_FORBIDDING_VALUES = [];",
    "C6",
  ));
  const shot = { creationBrief: { frameWorkflows: { "fr-a": { entityPresence: { "CHAR-X": "absent" } } } } };
  assert.deepStrictEqual(broken.absentEntityIdsForFrame(shot, "fr-a"), ["CHAR-X"],
    "an entity declared absent must be reported as forbidden");
}, "If nothing forbids presence, the declaration is decoration and the compiler is unchanged.");

control("C7 every mention counts as a denial", () => {
  const broken = build("public/shared-frame-presence.js", mutate(
    source("public/shared-frame-presence.js"),
    "  return FRAME_ABSENCE_MARKERS.some((marker) => lower.includes(marker));",
    "  return true;",
    "C7",
  ));
  const findings = broken.framePresenceContradictions({
    absentEntities: [{ id: "CHAR-X", name: "Chimbley Sweep" }],
    spec: { narrativePurpose: "A tiny figure of the Chimbley Sweep stands at the stack." },
  });
  assert.strictEqual(findings.length, 1, "a positive clause naming an absent entity is a contradiction");
}, "A detector that treats every clause as a denial is a detector that never fires — which is the shipped behaviour.");

control("C8 no mention counts as a denial", () => {
  const broken = build("public/shared-frame-presence.js", mutate(
    source("public/shared-frame-presence.js"),
    "  return FRAME_ABSENCE_MARKERS.some((marker) => lower.includes(marker));",
    "  return false;",
    "C8",
  ));
  assert.deepStrictEqual(broken.framePresenceContradictions({
    absentEntities: [{ id: "CHAR-X", name: "Chimbley Sweep" }],
    spec: { narrativePurpose: "No Chimbley Sweep visible." },
  }), [], "a clause that denies presence must not be a contradiction");
}, "The opposite failure is as bad: blocking the correctly-authored case teaches people to stop declaring absence at all.");

control("C9 whole-shot narrative is carried into a frame that excludes it", () => {
  const broken = build("public/shared-frame-presence.js", mutate(
    source("public/shared-frame-presence.js"),
    "  return withheldFor.length ? { text: \"\", withheldFor } : { text: source, withheldFor: [] };",
    "  return { text: source, withheldFor: [] };",
    "C9",
  ));
  const result = broken.narrativeForFrame(
    "A tiny figure of the Chimbley Sweep stands among the chimney stacks.",
    [{ id: "CHAR-X", name: "Chimbley Sweep" }],
  );
  assert.strictEqual(result.text, "", "narrative that states an absent entity positively must be withheld");
}, "This is the S01-01 sentence itself: it is the shot description, and appending the frame directive after it did not repair it.");

control("C10 the short form is not derived", () => {
  const broken = build("public/shared-frame-presence.js", mutate(
    source("public/shared-frame-presence.js"),
    "...(parts.length > 1 ? parts : [])",
    "...[]",
    "C10",
  ));
  assert.strictEqual(broken.framePresenceContradictions({
    absentEntities: [{ id: "CHAR-X", name: "Chimbley Sweep" }],
    spec: { narrativePurpose: "The Sweep is upper-left of frame." },
  }).length, 1, "the short form must be caught");
}, "Dogfood #2's own staging line said 'The Sweep', not 'The Chimbley Sweep'.");

/* ===========================================================================
   P0-4 — EXACT ENTITY / MEDIA OWNERSHIP
   =========================================================================== */
notes.push("P0-4 entity ownership:");

/* REPRODUCTION. mediaByPrefix, verbatim as it was deleted from public/app.js, on
   the ids the pass reported. If this does not leak, the fixture is not the
   dogfood case. */
{
  const shippedMediaByPrefix = (list, prefix) =>
    (Array.isArray(list) ? list : []).filter((m) => m.name.toUpperCase().startsWith((prefix || "").toUpperCase()));
  const pool = [
    { name: "CHAR-SWEEP_PRIMARY_V001.png" },
    { name: "CHAR-SWEEP-YOUNG_PRIMARY_V001.png" },
    { name: "CHAR-SWEEP-YOUNG_PRIMARY_V002.png" },
    { name: "CHAR-SWEEP-YOUNG_PRIMARY_V003.png" },
    { name: "CHAR-WIDOW_PRIMARY_V001.png" },
  ];
  const adultPool = shippedMediaByPrefix(pool, "CHAR-SWEEP").map((row) => row.name);
  assert.strictEqual(adultPool.length, 4,
    "reproduction: the pre-repair prefix lookup must pull all three CHAR-SWEEP-YOUNG candidates into the adult's pool");
  assert.strictEqual(shippedMediaByPrefix(pool, "CHAR-WIDOW").length, 1,
    "reproduction: and must leave the Widow clean — that asymmetry is the diagnostic detail the pass reported");
  controls += 1;
  notes.push("  R3 the deleted prefix lookup leaks exactly three child candidates into the parent and leaves the control clean");
}

control("C11 ownership falls back to the first matching prefix", () => {
  const broken = build("public/shared-entity-ownership.js", mutate(
    source("public/shared-entity-ownership.js"),
    "    .sort((a, b) => b.prefix.length - a.prefix.length || (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0));",
    "    .sort((a, b) => (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0));",
    "C11",
  ));
  const index = broken.buildEntityOwnerIndex({
    characters: [{ id: "CHAR-SWEEP" }, { id: "CHAR-SWEEP-YOUNG" }],
  }, "characters");
  assert.strictEqual(broken.mediaOwnerId(index, "CHAR-SWEEP-YOUNG_IMPORTED.png"), "CHAR-SWEEP-YOUNG",
    "an unclaimed file must resolve to the MOST SPECIFIC declaration");
}, "Alphabetical order puts CHAR-SWEEP first, which is the prefix collision wearing a sort function.");

control("C12 a durable claim stops deciding ownership", () => {
  const broken = build("public/shared-entity-ownership.js", mutate(
    source("public/shared-entity-ownership.js"),
    "  if (!contested.has(name) && claims.has(name)) return claims.get(name);",
    "",
    "C12",
  ));
  /* The claim and the filename rule deliberately DISAGREE: CHAR-A records a file
     whose name matches CHAR-B-EXTRA's prefix. A repair that consults the
     filename first would hand it to CHAR-B-EXTRA, which is the whole class of
     error the claim exists to prevent. */
  const index = broken.buildEntityOwnerIndex({
    characters: [
      { id: "CHAR-A", candidateFiles: [{ stored: "CHAR-B-EXTRA_001.png" }] },
      { id: "CHAR-B" },
      { id: "CHAR-B-EXTRA" },
    ],
  }, "characters");
  assert.strictEqual(broken.mediaOwnerId(index, "CHAR-B-EXTRA_001.png"), "CHAR-A",
    "an uncontested durable claim decides ownership before any filename rule is consulted");
}, "Ownership must rest on what a project RECORDS, with the filename only ever answering for files nothing records.");

control("C13 coverage and expression slots stop counting as claims", () => {
  const broken = build("public/shared-entity-ownership.js", mutate(
    source("public/shared-entity-ownership.js"),
    'const OWNERSHIP_SLOT_GROUPS = ["coverageSlots", "expressionSlots"];',
    "const OWNERSHIP_SLOT_GROUPS = [];",
    "C13",
  ));
  const claimed = broken.entityClaimedFileNames({
    id: "CHAR-A", coverageSlots: [{ approvedFile: "FRONT.png" }], expressionSlots: [{ approvedFile: "SMILE.png" }],
  });
  assert.ok(claimed.includes("FRONT.png") && claimed.includes("SMILE.png"),
    "every approval edge is a claim, coverage and expression slots included");
}, "That exact pair was missed by an earlier repair on this codebase; enumerating them is what makes the miss impossible.");

/* ===========================================================================
   P0-5 — STATE LINEAGE SAFETY
   =========================================================================== */
notes.push("P0-5 state lineage:");

/* REPRODUCTION. The cyclic rotation, verbatim, plus the unconditional reparent.
   root -> child -> grandchild; approve the grandchild; accept what the ring
   offers; observe the cycle. */
{
  const states = [
    { id: "state-default", isDefault: true, parentStateId: "" },
    { id: "child", parentStateId: "state-default" },
    { id: "grandchild", parentStateId: "child" },
  ];
  const currentStateId = "grandchild";
  const index = Math.max(0, states.findIndex((state) => state.id === currentStateId));
  const shippedCandidates = [...states.slice(index + 1), ...states.slice(0, index)].filter((state) => state.id !== currentStateId);
  assert.strictEqual(shippedCandidates[0].id, "state-default",
    "reproduction: after the deepest descendant the ring wraps round and offers the ROOT — the already-approved ancestor the pass saw");
  /* And accepting it: `nextState.parentStateId = targetStateId`. */
  const nextState = shippedCandidates[0];
  nextState.parentStateId = currentStateId;
  const Lineage = require("../public/shared-state-lineage");
  assert.strictEqual(Lineage.lineageCycles(states).length, 1,
    "reproduction: and the unconditional reparent closes a cycle in the derivation graph");
  controls += 1;
  notes.push("  R4 the cyclic rotation offers the root after the grandchild, and accepting it closes a real cycle");
}

control("C14 navigation is allowed to reparent", () => {
  const broken = build("public/shared-state-lineage.js", mutate(
    source("public/shared-state-lineage.js"),
    "  if (child.parentStateId && child.parentStateId !== parentId && opts.allowReparent !== true) {\n    return { write: false, parentStateId: child.parentStateId, reason: \"navigation-may-not-reparent\" };\n  }",
    "",
    "C14",
  ));
  const states = [
    { id: "state-default", isDefault: true, parentStateId: "" },
    { id: "child", parentStateId: "state-default" },
    { id: "grandchild", parentStateId: "child" },
  ];
  assert.strictEqual(broken.safeParentAssignment(states, "grandchild", "state-default").write, false,
    "moving to a state must not re-declare where it came from");
}, "Existing ancestry is production truth; a movement is not a statement about it.");

control("C15 the cycle guard is removed", () => {
  const broken = build("public/shared-state-lineage.js", mutate(
    source("public/shared-state-lineage.js"),
    "  if (stateAncestorIds(states, parentId).includes(childId)) return { write: false, parentStateId: \"\", reason: \"would-create-cycle\" };",
    "",
    "C15",
  ));
  const states = [
    { id: "state-default", isDefault: true, parentStateId: "" },
    { id: "child", parentStateId: "state-default" },
    { id: "grandchild", parentStateId: "child" },
  ];
  assert.strictEqual(broken.safeParentAssignment(states, "child", "grandchild", { allowReparent: true }).write, false,
    "no write may put an ancestor beneath its own descendant");
}, "Without the guard an explicit reparent can still corrupt the graph, which is the data-integrity half of A6.");

control("C16 ancestors are offered as continuations", () => {
  const broken = build("public/shared-state-lineage.js", mutate(
    source("public/shared-state-lineage.js"),
    "  const forbidden = new Set([currentId, ...stateAncestorIds(states, currentId)]);",
    "  const forbidden = new Set([currentId]);",
    "C16",
  ));
  const states = [
    { id: "state-default", isDefault: true, parentStateId: "", approvedFile: "R.png" },
    { id: "child", parentStateId: "state-default", approvedFile: "C.png" },
    { id: "grandchild", parentStateId: "child", approvedFile: "" },
  ];
  assert.deepStrictEqual(broken.continuationCandidates(states, "grandchild").map((row) => row.id), [],
    "a terminal descendant offers nothing — its ancestors are not continuations");
}, "Offering the ancestor is what put the backwards-derivation sentence in front of the creator.");

control("C17 a finished chain wraps instead of completing", () => {
  const broken = build("public/shared-state-lineage.js", mutate(
    source("public/shared-state-lineage.js"),
    "  const unfinished = candidates.filter((candidate) => !candidate.approved);\n  if (!unfinished.length) {",
    "  const unfinished = candidates;\n  if (!unfinished.length) {",
    "C17",
  ));
  const states = [
    { id: "state-default", isDefault: true, parentStateId: "", approvedFile: "R.png" },
    { id: "child", parentStateId: "state-default", approvedFile: "C.png" },
    { id: "sibling", parentStateId: "state-default", approvedFile: "S.png" },
  ];
  assert.strictEqual(broken.continuationOutcome(states, "child").kind, "complete",
    "when everything remaining is approved the outcome is complete");
}, "A ring has no end; 'complete' is the answer that stops it.");

/* ===========================================================================
   P0-6 — CONTINUITY-CORRECTION BOUNDARY SAFETY
   =========================================================================== */
notes.push("P0-6 correction boundaries:");

/* REPRODUCTION. The shipped helper pair, verbatim, on a first-shot package. The
   exception text is asserted, not merely the throw, because "it threw" would
   also be satisfied by a different bug. */
{
  const shots = [{ id: "SB-01" }, { id: "SB-02" }];
  const shotById = (id) => shots.find((shot) => shot.id === id);
  const takesFor = () => [];
  const shippedApprovedStill = (shot) => { takesFor(shot.id); return null; };
  const pkg = { targetShotId: "SB-01", previousShotId: "", nextShotId: "SB-02" };
  let message = "";
  try {
    /* addStill(pkg.previousShotId, ...) with previousShotId === "" */
    const shot = shotById(pkg.previousShotId);
    shippedApprovedStill(shot);
  } catch (error) { message = error.message; }
  assert.ok(/Cannot read properties of undefined \(reading 'id'\)/.test(message),
    `reproduction: the pre-repair boundary path must produce the reported exception, got: ${message || "no error"}`);
  controls += 1;
  notes.push("  R5 the pre-repair reference builder reproduces the exact reported exception on a first-shot package");
}

/* Both remaining controls run SHIPPED LINES rather than assertions about text.
   `slice` lifts the exact statements out of the file and evaluates them against
   a synthetic scope, so a control observes the behaviour the route or the
   classifier actually has. */
function slice(text, from, to, label) {
  const start = text.indexOf(from);
  assert.notStrictEqual(start, -1, `probe receipt: ${label} could not find its opening anchor`);
  const end = text.indexOf(to, start);
  assert.notStrictEqual(end, -1, `probe receipt: ${label} could not find its closing anchor`);
  return text.slice(start, end);
}

/* The retry route's decision, run for real. */
const RETRY_FROM = "    const deterministic = String(steps[stepKey]";
const RETRY_TO = "    next.failureClass = \"\";";
function retryAttemptsAfter(runsSource, failureClass, label) {
  const body = slice(runsSource, RETRY_FROM, RETRY_TO, label);
  const scope = {
    steps: { "k": { failureClass, kind: "scene-correction", retryCount: 2 } },
    stepKey: "k",
    next: { kind: "scene-correction", retryCount: 2 },
  };
  vm.runInNewContext(body, scope, { filename: "automation-runs.js#retry" });
  return scope.next.retryCount;
}

control("C18 a deterministic package fault consumes a retry", () => {
  const runs = source("automation-runs.js");
  assert.strictEqual(retryAttemptsAfter(runs, "provider", "C18 baseline"), 3,
    "probe receipt: a provider fault must still advance the attempt counter, or this control is measuring a dead branch");
  const broken = mutate(runs, "String(steps[stepKey]?.failureClass || \"\") === \"local-package\"", "false", "C18");
  assert.strictEqual(retryAttemptsAfter(broken, "local-package", "C18"), 2,
    "a deterministic local fault must NOT advance the attempt counter — nothing was attempted against a provider");
}, "With the class ignored, every retry of a boundary correction burns an authorized pass to reproduce the same exception.");

/* The failure classifier, run for real. */
function classifyWith(automationSource, error, label) {
  const body = slice(automationSource, "function v626FailureClass(error) {", "\nasync function v626FailStep", label);
  const scope = { __error: error };
  vm.runInNewContext(`${body}\n__result = v626FailureClass(__error);`, scope, { filename: "public/automation.js#classify" });
  return scope.__result;
}

control("C19 an authority violation is classified as a provider fault", () => {
  const automation = source("public/automation.js");
  assert.strictEqual(classifyWith(automation, new Error("FAL timed out"), "C19 baseline"), "provider",
    "probe receipt: an ordinary failure must still classify as a provider fault, or this control is measuring a dead branch");
  const broken = mutate(automation,
    '  if (error?.authorityViolation === true || error?.code === "HUMAN_AUTHORITY_REQUIRED") return "local-package";',
    "", "C19");
  assert.strictEqual(classifyWith(broken, { code: "HUMAN_AUTHORITY_REQUIRED", authorityViolation: true }, "C19"), "local-package",
    "an authority refusal is deterministic — retrying it reproduces the same refusal");
}, "A refusal that reads as transient is a refusal a runner will keep paying to re-earn.");

console.log([
  `Dogfood #2 P0 negative controls: ${controls} controls exercised, all fired.`,
  ...notes,
  "",
  "Five reproduction controls confirm the fixtures exercise the reported defects:",
  "  the auto-approve branch fires on a 92/100 explicit pass;",
  "  whole-shot cast reached a frame with no frame-level filter;",
  "  the deleted prefix lookup leaks three child candidates and leaves the control clean;",
  "  the cyclic rotation offers the root after the grandchild and closes a real cycle;",
  "  the boundary reference builder produces the exact reported undefined.id exception.",
].join("\n"));

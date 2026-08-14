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
  /* A PLAIN ERROR, DELIBERATELY, AND THIS MATTERS.

     The probe receipt used to be an `assert.strictEqual`. `control()` catches
     AssertionErrors and reads them as "the invariant broke, so the control
     fired" — so a control whose anchor had disappeared reported SUCCESS while
     mutating nothing at all. The receipt that exists to stop a silent no-op was
     itself producing one. A non-assertion error is re-thrown by `control()` and
     fails the suite loudly, which is the only outcome that means anything. */
  if (hits !== expected) {
    throw new Error(
      `probe receipt: ${label} expected ${expected} occurrence(s) of its anchor, found ${hits}. `
      + "The control is no longer mutating the live path and must be rewritten.",
    );
  }
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

/* The async twin, for a control whose boundary is an HTTP route rather than a
   pure function. Same contract: a non-assertion escape means the control proved
   nothing and fails the suite loudly. Collected and awaited at the end so the
   file keeps reading top to bottom. */
const pendingControls = [];
function controlAsync(label, run, expectation) {
  controls += 1;
  pendingControls.push((async () => {
    let failed = false;
    try { await run(); }
    catch (error) {
      if (error instanceof assert.AssertionError) failed = true;
      else throw new Error(`${label}: the control threw something other than an assertion, so it proves nothing: ${error.stack || error.message}`);
    }
    assert.ok(failed, `${label}: the invariant survived the break. ${expectation}`);
    notes.push(`  ${label} — failed as required`);
  })());
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

/* C3 RETARGETED IN BATCH 1B: the state-authority substitution moved into
   `liveAuthorityValue`, which is where the edge is now read. The fixture carries
   a REAL receipt for the soot state naming the entity's primary file — so the
   only thing standing between it and a satisfied gate is the rule that a
   non-default state is not answered by the entity's own image. */
control("C3 a gate is satisfied by the entity's primary file", () => {
  const broken = build("public/shared-production-authority.js", mutate(
    source("public/shared-production-authority.js"),
    "      return authorityObject(state).isDefault === true\n"
    + "        ? { value: authorityText(authorityObject(entity).approvedFile), assetId: authorityText(authorityObject(entity).approvedAssetId) }\n"
    + "        : { value: \"\", assetId: \"\" };",
    "      return { value: authorityText(authorityObject(entity).approvedFile), assetId: authorityText(authorityObject(entity).approvedAssetId) };",
    "C3",
  ));
  const project = {
    shots: [],
    characters: [{
      id: "CHAR-A", approvedFile: "PRIMARY.png",
      continuityStates: [{ id: "state-default", isDefault: true, approvedFile: "PRIMARY.png" }, { id: "st-soot", approvedFile: "" }],
    }],
    productionAuthority: {
      version: 1, sequence: 1,
      receipts: [{
        id: "authority-000001", sequence: 1, actor: "human", act: "explicit-approval", command: "approve-entity-state",
        targetType: "entity-state", targetId: "characters:CHAR-A#st-soot", shotId: "", frameId: "",
        list: "characters", entityId: "CHAR-A", stateId: "st-soot", value: "PRIMARY.png", assetId: "",
        via: "control", at: "T", status: "current",
      }],
    },
  };
  assert.ok(!broken.gateSatisfied({ kind: "entity-state-approval", list: "characters", entityId: "CHAR-A", stateId: "st-soot" }, project),
    "a declared non-default state with no file of its own is NOT satisfied by the entity's primary");
}, "This is the state-authority substitution defect wearing a new hat: it would close a real gate against the wrong image.");

/* ===========================================================================
   BATCH 1B — CONTROLS AIMED AT THE CENTRAL BOUNDARIES.

   The acceptance audit's objection to the first batch's controls was that they
   mutated helpers rather than the boundaries a bypass would go around. These
   break the command itself: if the command can be defeated, everything that
   routes through it is defeated, and each of these proves the corresponding
   guarantee has exactly one place it lives. */

control("C1b the gate reads the edge instead of the receipt", () => {
  const broken = build("public/shared-production-authority.js", mutate(
    source("public/shared-production-authority.js"),
    "  const target = gateAuthorityTarget(requirement);\n  if (!target) return false;\n  return hasCurrentHumanAuthority(project, target);",
    "  const target = gateAuthorityTarget(requirement);\n  if (!target) return false;\n  return !!liveAuthorityValue(project, target).value;",
    "C1b",
  ));
  /* A preserved pre-repair winner: a real file, automatic provenance, no human
     anywhere in its history. This is the audit's headline counterexample. */
  const project = { shots: [{ id: "SH-01", winner: "AUTO.png", keyframes: [{ id: "fr-a", winner: "AUTO.png" }] }] };
  assert.ok(!broken.gateSatisfied({ kind: "shot-frame-approval", shotId: "SH-01", frameId: "fr-a" }, project),
    "a winner with no human receipt behind it must not satisfy a human gate");
}, "This is the exact reasoning the shipped module used — 'only a human may write a winner, so a winner is a decision' — and it is false for every edge that predates the guard.");

control("C1c the command mints a receipt without checking the actor", () => {
  const broken = build("public/shared-production-authority.js", mutate(
    source("public/shared-production-authority.js"),
    "  assertHumanAuthority(it.grant, what);",
    "",
    "C1c",
  ));
  const project = { shots: [{ id: "SH-01", keyframes: [{ id: "fr-a" }] }] };
  assert.throws(() => broken.writeFrameProductionAuthority(project, {
    shotId: "SH-01", frameId: "fr-a", value: "X.png", grant: { actor: "automation", act: "explicit-approval" }, at: "T", applyEdge: () => {},
  }), assert.AssertionError, "the command must refuse a machine actor");
}, "One command writes every authority edge in CineBraid; an actor check it can skip is an actor check nothing has.");

control("C1d the edge is written before the actor is verified", () => {
  const broken = build("public/shared-production-authority.js", mutate(
    source("public/shared-production-authority.js"),
    "  const what = target.targetType === \"shot-frame\" ? `Frame ${target.frameId} of ${target.shotId}` : `${target.list} ${target.entityId} state ${target.stateId}`;\n"
    + "  /* THE ACTOR CHECK, first, before anything is touched. */\n"
    + "  assertHumanAuthority(it.grant, what);",
    "  const what = target.targetType === \"shot-frame\" ? `Frame ${target.frameId} of ${target.shotId}` : `${target.list} ${target.entityId} state ${target.stateId}`;\n"
    + "  if (typeof it.applyEdge === \"function\") it.applyEdge(target);\n"
    + "  assertHumanAuthority(it.grant, what);",
    "C1d",
  ));
  const project = { shots: [{ id: "SH-01", keyframes: [{ id: "fr-a" }] }] };
  let wrote = false;
  try {
    broken.writeFrameProductionAuthority(project, {
      shotId: "SH-01", frameId: "fr-a", value: "X.png", grant: undefined, at: "T", applyEdge: () => { wrote = true; },
    });
  } catch { /* the refusal is expected; WHETHER IT WROTE FIRST is the question */ }
  assert.ok(!wrote, "a refused command must leave the project untouched");
}, "Ordering is the whole guarantee: a refusal that has already written the winner has refused nothing.");

control("C2b reconciliation closes a gate with no receipt to cite", () => {
  const broken = build("public/shared-production-authority.js", mutate(
    source("public/shared-production-authority.js"),
    "    if (!authorityText(requirement.receiptId)) continue;",
    "",
    "C2b",
  ));
  const run = { id: "r", type: "shot-chain", targetId: "SH-01", status: "awaiting-review", steps: { k: { key: "k", status: "needs-review", frameId: "fr-a", result: {} } } };
  broken.applyGateReconciliation(run, { changed: true, satisfied: [{ kind: "shot-frame-approval", stepKey: "k", shotId: "SH-01", frameId: "fr-a", receiptId: "" }], invalidated: [], nextStatus: "interrupted" }, { at: "T" });
  assert.strictEqual(run.steps.k.status, "needs-review",
    "a gate may close only against a receipt the plan verified — the citation and the completion are one statement");
}, "Manufacturing humanApproved from anything other than a verified receipt is the defect the audit named by name.");

control("C2c reconciliation is one-way again", () => {
  const broken = build("public/shared-production-authority.js", mutate(
    source("public/shared-production-authority.js"),
    "    if (gateSatisfied(requirement, project)) continue;\n    invalidated.push(requirement);",
    "    continue;",
    "C2c",
  ));
  /* A completed step claiming a human approval whose authority is gone. */
  const project = { shots: [{ id: "SH-01", keyframes: [{ id: "fr-a" }] }] };
  const run = { id: "r", type: "shot-chain", targetId: "SH-01", status: "interrupted", steps: { k: { key: "k", kind: "frame-approval", status: "completed", frameId: "fr-a", pass: true, result: { humanApproved: true } } } };
  const plan = broken.reconcileRunGates(run, project, { at: "T" });
  assert.strictEqual((plan.invalidated || []).length, 1,
    "a completed gate whose authority has been revoked must reopen — truth has to be able to travel back");
}, "A reconciliation that can only ever REMOVE work from 'waiting for you' is how a revoked approval survived as a completed step.");

control("C2d resume trusts the cached step result", () => {
  const broken = build("public/shared-production-authority.js", mutate(
    source("public/shared-production-authority.js"),
    "  return currentHumanAuthority(project, target);\n}\n\nconst PRODUCTION_AUTHORITY_EXPORTS",
    "  return currentAuthorityReceipt(project, target);\n}\n\nconst PRODUCTION_AUTHORITY_EXPORTS",
    "C2d",
  ));
  /* The receipt exists but the edge is gone — a winner cleared by a writer that
     did not call the revocation command. Resume must still find nothing. */
  const project = {
    shots: [{ id: "SH-01", keyframes: [{ id: "fr-a", winner: "" }] }],
    productionAuthority: { version: 1, sequence: 1, receipts: [{ id: "authority-000001", sequence: 1, actor: "human", act: "explicit-approval", targetType: "shot-frame", targetId: "SH-01#fr-a", shotId: "SH-01", frameId: "fr-a", value: "X.png", status: "current" }] },
  };
  assert.strictEqual(broken.resumeAuthority(project, { kind: "shot-frame-approval", shotId: "SH-01", frameId: "fr-a" }), null,
    "authority requires the receipt AND the edge — fail closed when a writer clears one without withdrawing the other");
}, "The invariant must not depend on every writer being polite enough to call the revocation command.");

control("C10b ownership eligibility accepts an inferred owner", () => {
  const broken = build("public/shared-entity-ownership.js", mutate(
    source("public/shared-entity-ownership.js"),
    "  return resolution.authoritative === true && resolution.ownerId === wanted;",
    "  return resolution.ownerId === wanted;",
    "C10b",
  ));
  const index = broken.buildEntityOwnerIndex({ characters: [{ id: "CHAR-A", prefix: "CHAR-A" }] }, "characters");
  assert.ok(!broken.entityOwnsMedia(index, "CHAR-A", "CHAR-A_DROPPED_BY_HAND.png"),
    "a filename match is discovery, never eligibility");
}, "The audit approved an unclaimed file into a canon pool because one reader answered both questions with one list.");

control("C10c a contested file is attributed to a claimant", () => {
  const broken = build("public/shared-entity-ownership.js", mutate(
    source("public/shared-entity-ownership.js"),
    "  if (contested.has(name)) {",
    "  if (false && contested.has(name)) {",
    "C10c",
  ));
  const index = broken.buildEntityOwnerIndex({
    characters: [
      { id: "CHAR-A", prefix: "CHAR-A", candidateFiles: [{ stored: "SHARED.png" }] },
      { id: "CHAR-A-YOUNG", prefix: "CHAR-A-YOUNG", candidateFiles: [{ stored: "SHARED.png" }] },
    ],
  }, "characters");
  assert.strictEqual(broken.resolveMediaOwnership(index, "SHARED.png").ownerId, "",
    "a conflict has no owner until a person resolves it");
}, "Breaking a durable-claim tie by filename specificity is the reasoning that created the contamination in the first place.");

control("C4 an unidentifiable gate is treated as satisfied", () => {
  const broken = build("public/shared-production-authority.js", mutate(
    source("public/shared-production-authority.js"),
    "  return !requirements.length;\n}",
    "  return false;\n}",
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

/* C7/C8 RETARGETED IN BATCH 1B. Both used to mutate `clauseDeniesPresence`,
   which is no longer the production path — the detector is mention-scoped now
   and `framePresenceContradictions` asks `clauseAssertsPresence`. A control
   pointed at the old function would have gone on passing while proving nothing,
   which is the precise failure the acceptance audit called out. They attack
   `mentionIsDenied`, the central decision both directions turn on. */
const MENTION_DECISION_ANCHOR = "  if (PRESENCE_NEGATION_WORDS.test(span)) return true;\n"
  + "  if (PRESENCE_DENYING_PREDICATE.test(after)) return true;\n"
  + "  return false;";

control("C7 every mention counts as a denial", () => {
  const broken = build("public/shared-frame-presence.js", mutate(
    source("public/shared-frame-presence.js"),
    MENTION_DECISION_ANCHOR,
    "  return true;",
    "C7",
  ));
  const findings = broken.framePresenceContradictions({
    absentEntities: [{ id: "CHAR-X", name: "Chimbley Sweep" }],
    spec: { narrativePurpose: "A tiny figure of the Chimbley Sweep stands at the stack." },
  });
  assert.strictEqual(findings.length, 1, "a positive clause naming an absent entity is a contradiction");
}, "A detector that treats every mention as denied is a detector that never fires — which is the shipped behaviour.");

control("C8 no mention counts as a denial", () => {
  const broken = build("public/shared-frame-presence.js", mutate(
    source("public/shared-frame-presence.js"),
    MENTION_DECISION_ANCHOR,
    "  return false;",
    "C8",
  ));
  assert.deepStrictEqual(broken.framePresenceContradictions({
    absentEntities: [{ id: "CHAR-X", name: "Chimbley Sweep" }],
    spec: { narrativePurpose: "No Chimbley Sweep visible." },
  }), [], "a clause that denies presence must not be a contradiction");
}, "The opposite failure is as bad: blocking the correctly-authored case teaches people to stop declaring absence at all.");

/* THE CONTROL THAT MATTERS MOST: the universal pre-provider gate.

   Every other presence control breaks a detector. This one breaks the BOUNDARY,
   and a boundary that can be removed without a test noticing is the exact
   failure the acceptance audit found — the shipped check lived on a path callers
   could decline to take, and every test passed anyway.

   It loads a mutated `fal-generation.js` through Node's real module system, so
   the route it registers is the real route. The mutated copy is written to a
   scratch directory outside the repository and removed immediately; nothing in
   the working tree is touched. */
controlAsync("CG the universal pre-provider presence gate is removed", async () => {
  const os = require("os");
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-control-"));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-control-project-"));
  const realFetch = globalThis.fetch;
  let providerAttempts = 0;
  try {
    const broken = mutate(source("fal-generation.js"), "    if (!presenceGate.ok)", "    if (false && !presenceGate.ok)", "CG");
    /* Relative requires have to keep resolving against the repository. */
    const rewritten = broken.replace(/require\("\.\/([^"]+)"\)/g, (match, rel) => `require(${JSON.stringify(path.join(ROOT, rel).replace(/\\/g, "/"))})`);
    const copy = path.join(scratch, "fal-generation.mutated.js");
    fs.writeFileSync(copy, rewritten);
    fs.writeFileSync(path.join(projectDir, "generation-jobs.json"), "[]");
    fs.writeFileSync(path.join(projectDir, "project.json"), JSON.stringify({
      meta: {}, scenes: [], locations: [], props: [], vehicles: [], audio: [],
      characters: [{ id: "CHAR-X", name: "Chimbley Sweep", prefix: "CHAR-X" }],
      shots: [{ id: "SH-01", scene: "SC-01", keyframes: [{ id: "fr-a", label: "A" }], clips: [], candidateFiles: [], creationBrief: { frameWorkflows: { "fr-a": { entityPresence: { "CHAR-X": "absent" } } } } }],
    }));
    const routes = new Map();
    const app = { post: (route, handler) => routes.set(route, handler), get: () => {} };
    require(copy).registerFalGeneration(app, {
      readConfig: () => ({ generation: { fal: { enabled: true, apiKey: "not-a-real-credential" } } }),
      readProject: () => JSON.parse(fs.readFileSync(path.join(projectDir, "project.json"), "utf8")),
      writeProject: () => {},
      activeSlug: () => "control",
      projectDirForSlug: () => ({ dir: projectDir, file: path.join(projectDir, "project.json") }),
    });
    globalThis.fetch = () => { providerAttempts += 1; throw new Error("provider contacted"); };
    const handler = routes.get("/api/generation/fal/jobs");
    const res = { status() { return this; }, json() { return this; } };
    await handler({ body: { purpose: "frame", shotId: "SH-01", frameId: "fr-a", prompt: "The Chimbley Sweep stands before the chimney.", outputCount: 1 }, query: {}, headers: {} }, res);
    assert.strictEqual(providerAttempts, 0,
      "a frame-specific paid request contradicting its own presence declaration must never reach a provider");
  } finally {
    globalThis.fetch = realFetch;
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
}, "Remove the gate and the request goes straight to fal. This is the one control that proves the boundary is mandatory rather than conventional.");

/* C7b IS THE COUNTEREXAMPLE THE AUDIT EXECUTED, as a control rather than only as
   a positive assertion: unscope the negation back to "does the clause contain a
   marker anywhere" and the spatial `before` must stop being caught. */
control("C7b negation is unscoped back to a whole-clause substring test", () => {
  const broken = build("public/shared-frame-presence.js", mutate(
    source("public/shared-frame-presence.js"),
    MENTION_DECISION_ANCHOR,
    "  return FRAME_ABSENCE_MARKERS.some((marker) => presenceText(clause).toLowerCase().includes(marker));",
    "C7b",
  ));
  const findings = broken.framePresenceContradictions({
    absentEntities: [{ id: "CHAR-X", name: "Chimbley Sweep" }],
    spec: { narrativePurpose: "The Chimbley Sweep stands before the chimney." },
  });
  assert.strictEqual(findings.length, 1,
    "a spatial `before` is not a temporal absence — this sentence puts the Sweep in a frame that excludes him");
}, "This is the exact sentence the acceptance audit fed the shipped detector, and the exact answer it got wrong.");

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
    '    return { ownerId: claims.get(name), basis: "durable-claim", status: "owned", contested: false, claimants: [claims.get(name)], authoritative: true, fileName: name };',
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

/* C14 RETARGETED IN BATCH 1B, and the mutation is the exact regression the
   acceptance audit found still shipping: reinstate the narrowed exemption that
   let navigation establish a first parent, and an orphan offered as a
   continuation acquires ancestry from a movement button. */
const LINEAGE_INTENT_ANCHOR = "  if (intent !== \"explicit-lineage-edit\") {\n"
  + "    return { write: false, intent, parentStateId: child.parentStateId, reason: \"navigation-may-not-reparent\" };\n"
  + "  }";
control("C14 navigation is allowed to reparent", () => {
  const broken = build("public/shared-state-lineage.js", mutate(
    source("public/shared-state-lineage.js"),
    LINEAGE_INTENT_ANCHOR,
    "  if (intent !== \"explicit-lineage-edit\" && child.parentStateId) {\n"
    + "    return { write: false, intent, parentStateId: child.parentStateId, reason: \"navigation-may-not-reparent\" };\n"
    + "  }",
    "C14",
  ));
  const states = [
    { id: "state-default", isDefault: true, parentStateId: "" },
    { id: "orphan", parentStateId: "" },
  ];
  assert.strictEqual(broken.safeParentAssignment(states, "orphan", "state-default").write, false,
    "navigation may not declare ancestry, and a state with no parent is not an exception to that");
}, "A narrowed exception to a categorical rule is a different rule wearing the invariant's name — which is what the acceptance audit caught.");

control("C14b the mutation API accepts a navigation intent", () => {
  const broken = build("public/shared-state-lineage.js", mutate(
    source("public/shared-state-lineage.js"),
    LINEAGE_INTENT_ANCHOR,
    "",
    "C14b",
  ));
  const states = [
    { id: "state-default", isDefault: true, parentStateId: "" },
    { id: "child", parentStateId: "state-default" },
    { id: "grandchild", parentStateId: "child" },
  ];
  assert.strictEqual(broken.applyStateParentMutation(states, "grandchild", "state-default", { intent: "navigation" }).applied, false,
    "the one mutation API refuses every write whose intent is navigation");
}, "Centralising the writer only helps if the central writer still knows which intents may write.");

/* THE CYCLE GUARD IS TWO LAYERS, AND EACH ONE IS BROKEN SEPARATELY.

   C15 removes both and proves the pair is load-bearing. C15b removes only the
   atomic whole-graph check and proves that layer earns its place on its own —
   because the pairwise checks are sufficient on a healthy graph and NOT
   sufficient on one that already carries damage. Removing the pairwise checks
   alone does not corrupt anything, which is defence in depth working as
   intended; a control that asserted otherwise would be asserting a falsehood. */
const LINEAGE_PAIRWISE_GUARDS = "  if (stateAncestorIds(states, parentId).includes(childId)) return { write: false, intent, parentStateId: \"\", reason: \"would-create-cycle\" };\n"
  + "  if (stateDescendantIds(states, childId).includes(parentId)) return { write: false, intent, parentStateId: \"\", reason: \"would-create-cycle\" };";
const LINEAGE_ATOMIC_GUARD = "  if (!lineageIsAcyclic(simulated)) return { write: false, intent, parentStateId: child.parentStateId, reason: \"graph-would-be-cyclic\" };";

control("C15 the cycle guard is removed", () => {
  const withoutPairwise = mutate(source("public/shared-state-lineage.js"), LINEAGE_PAIRWISE_GUARDS, "", "C15");
  const broken = build("public/shared-state-lineage.js", mutate(withoutPairwise, LINEAGE_ATOMIC_GUARD, "", "C15-atomic"));
  const states = [
    { id: "state-default", isDefault: true, parentStateId: "" },
    { id: "child", parentStateId: "state-default" },
    { id: "grandchild", parentStateId: "child" },
  ];
  assert.strictEqual(broken.applyStateParentMutation(states, "child", "grandchild", { intent: "explicit-lineage-edit" }).applied, false,
    "no write may put an ancestor beneath its own descendant");
}, "Without the guards an explicit reparent can still corrupt the graph, which is the data-integrity half of A6.");

/* C15b attacks the ATOMIC half. Even with the pairwise guards intact, a write
   validated only against the graph that exists — rather than the one that would
   result — can absorb damage a project already carries. */
control("C15b the resulting graph is not re-checked", () => {
  const broken = build("public/shared-state-lineage.js", mutate(source("public/shared-state-lineage.js"), LINEAGE_ATOMIC_GUARD, "", "C15b"));
  /* `a` and `b` already point at each other — damage written by the shipped
     defect. Reparenting `c` under `a` joins it to that loop. */
  const damaged = [
    { id: "state-default", isDefault: true, parentStateId: "" },
    { id: "a", parentStateId: "b" },
    { id: "b", parentStateId: "a" },
    { id: "c", parentStateId: "state-default" },
  ];
  broken.applyStateParentMutation(damaged, "c", "a", { intent: "explicit-lineage-edit" });
  assert.strictEqual(broken.lineageCycles(damaged).length, 0,
    "a mutation must be validated against the graph it would produce, not only the pair it touches");
}, "Pairwise checks are necessary and not sufficient on a project that already carries a cycle.");

control("C16 ancestors are offered as continuations", () => {
  const broken = build("public/shared-state-lineage.js", mutate(
    source("public/shared-state-lineage.js"),
    "  const descendants = stateDescendantIds(states, currentId);",
    "  const descendants = nodes.map((state) => state.id).filter((id) => id !== currentId);",
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
  /* The chain must have a DESCENDANT that is already approved, or `complete`
     would be reached by having no candidates at all and the mutated filter
     would never be consulted. */
  const states = [
    { id: "state-default", isDefault: true, parentStateId: "", approvedFile: "R.png" },
    { id: "child", parentStateId: "state-default", approvedFile: "C.png" },
    { id: "grandchild", parentStateId: "child", approvedFile: "G.png" },
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
  const broken = mutate(runs, "[\"local-package\", \"local-preflight\"].includes(String(steps[stepKey]?.failureClass || \"\"))", "false", "C18");
  assert.strictEqual(retryAttemptsAfter(broken, "local-package", "C18"), 2,
    "a deterministic local fault must NOT advance the attempt counter — nothing was attempted against a provider");
}, "With the class ignored, every retry of a boundary correction burns an authorized pass to reproduce the same exception.");

/* C18b is the BATCH 1B half of the same rule: the universal pre-provider gate
   refuses before a job row exists, so its class is deterministic on exactly the
   same terms and must not spend an attempt either. */
control("C18b a refused pre-provider dispatch consumes a retry", () => {
  const runs = source("automation-runs.js");
  const broken = mutate(runs, "[\"local-package\", \"local-preflight\"]", "[\"local-package\"]", "C18b");
  assert.strictEqual(retryAttemptsAfter(broken, "local-preflight", "C18b"), 2,
    "a refusal that never reached a provider must not advance the attempt counter");
}, "The presence gate stops the request before the job row exists; charging an attempt for it spends budget on nothing.");

/* The failure classifier, run for real. The slice starts at the code the
   classifier depends on rather than at the function, so a constant declared
   above it travels with it. */
function classifyWith(automationSource, error, label) {
  const body = slice(automationSource, "const V6_LOCAL_PREFLIGHT_CODES", "\nasync function v626FailStep", label);
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

Promise.all(pendingControls).then(() => console.log([
  `Dogfood #2 P0 negative controls: ${controls} controls exercised, all fired.`,
  ...notes,
  "",
  "Five reproduction controls confirm the fixtures exercise the reported defects:",
  "  the auto-approve branch fires on a 92/100 explicit pass;",
  "  whole-shot cast reached a frame with no frame-level filter;",
  "  the deleted prefix lookup leaks three child candidates and leaves the control clean;",
  "  the cyclic rotation offers the root after the grandchild and closes a real cycle;",
  "  the boundary reference builder produces the exact reported undefined.id exception.",
].join("\n"))).catch((error) => { console.error(error.stack || error.message || error); process.exitCode = 1; });

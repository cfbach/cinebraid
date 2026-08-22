/* SHOT READINESS — the focused suite for public/shared-shot-readiness.js.
 *
 * THE ACCEPTANCE RULE THIS SUITE IS WRITTEN UNDER, and it comes from a real
 * process failure the research pass found in its own work: a named expectation sat
 * green for an entire pass because the prose comment said `i2v + r2v` and no
 * assertion ever touched the admissible set. The test asserted the
 * contraindication, never the admissible list, so a wrong expectation was
 * invisible.
 *
 *     A PROSE EXPECTED COMMENT IS NOT EVIDENCE. Every named claim below is backed
 *     by a direct assertion on the exact value — the status token, the reason
 *     token, the next-action code and count, the method arrays deep-equal, the
 *     unique target count.
 *
 * Nothing here is a re-implementation. Authority is written by the kernel's own
 * approve*Canon commands through the real trusted-gesture path
 * (tests/authority-test-gesture.js), so a fixture cannot hand-forge a receipt the
 * product would have refused. No provider is contacted, no project on disk is
 * modified, and no media file is opened.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

const { Kernel, Private } = require("./authority-kernel-private");
const Authority = require(path.join(PUBLIC, "shared-production-authority.js"));
const Readiness = require(path.join(PUBLIC, "shared-shot-readiness.js"));
const Route = require(path.join(PUBLIC, "shared-shot-route.js"));
const { resolveTaskModes } = require(path.join(PUBLIC, "shared-generation-options.js"));
const { installTestManualActionSource } = require("./authority-test-gesture.js");
const { render } = require("./render-harness.js");

const GESTURE = installTestManualActionSource(Kernel);
const AT = "2026-08-16T10:00:00.000Z";

let checks = 0;
function ok(condition, message) {
  checks += 1;
  assert.ok(condition, message);
}
function equal(actual, expected, message) {
  checks += 1;
  assert.strictEqual(actual, expected, message);
}
function deepEqual(actual, expected, message) {
  checks += 1;
  assert.deepStrictEqual(actual, expected, message);
}

/* ---------------------------------------------------------------------------
   FIXTURES. Ordinary CineBraid documents — no readiness-shaped inputs, because a
   fixture built in the model's own vocabulary would prove only that the model can
   read itself. */

function assetId(seed) {
  return `asset-${String(seed).repeat(32).slice(0, 32)}`;
}
function state(id, name, approvedFile, isDefault = false) {
  return { id, name, approvedFile, ...(isDefault ? { isDefault: true } : {}) };
}
function entity(id, name, states) {
  const fallback = states.find((row) => row.isDefault) || states[0];
  return { id, name, prefix: id, continuityStates: states, approvedFile: fallback ? fallback.approvedFile : "" };
}
function shot(id, extras = {}) {
  return {
    id,
    title: id,
    scene: "SC-1",
    characters: [],
    codes: [],
    keyframes: [{ id: "frame-a", label: "A", required: true }],
    ...extras,
    creationBrief: { locationId: "", propIds: [], ...(extras.creationBrief || {}) },
  };
}
function project(extras = {}) {
  return {
    meta: { title: "Readiness fixture" },
    scenes: [{ id: "SC-1", title: "Scene" }],
    shots: [],
    characters: [],
    locations: [],
    props: [],
    vehicles: [],
    audio: [],
    mediaAssets: [],
    ...extras,
  };
}

/* The standard cast: one character, one location, one prop, each with a default
   state holding a distinct file so nothing is contested by accident. */
const KAI_FILE = "CHAR-KAI.png";
const DOCK_FILE = "LOC-DOCK.png";
const CRATE_FILE = "PROP-CRATE.png";

function castProject(extras = {}) {
  return project({
    characters: [entity("CHAR-KAI", "Kai", [state("state-default", "Default", KAI_FILE, true), state("state-rain", "Rain-soaked", "CHAR-KAI-RAIN.png")])],
    locations: [entity("LOC-DOCK", "Cargo dock", [state("state-default", "Default", DOCK_FILE, true)])],
    props: [entity("PROP-CRATE", "Cargo crate", [state("state-default", "Default", CRATE_FILE, true)])],
    ...extras,
  });
}

function castShot(id, extras = {}) {
  return shot(id, {
    characters: ["CHAR-KAI"],
    ...extras,
    creationBrief: { locationId: "LOC-DOCK", propIds: ["PROP-CRATE"], ...(extras.creationBrief || {}) },
  });
}

/* Approve through the SHIPPED command, inside one delivered trusted event. */
function approveEntityState(P, list, entityId, stateId, value, identity = "") {
  return GESTURE.gesture(() => Kernel.approveEntityStateCanon(P, { list, entityId, stateId, value, assetId: identity, at: AT, via: "readiness-suite" }));
}
function approveFrame(P, shotId, frameId, value, identity = "") {
  return GESTURE.gesture(() => Kernel.approveFrameCanon(P, { shotId, frameId, value, assetId: identity, at: AT, via: "readiness-suite" }));
}
function approveWholeCast(P) {
  approveEntityState(P, "characters", "CHAR-KAI", "state-default", KAI_FILE);
  approveEntityState(P, "locations", "LOC-DOCK", "state-default", DOCK_FILE);
  approveEntityState(P, "props", "PROP-CRATE", "state-default", CRATE_FILE);
}

/* The media oracle: a listing, exactly the shape GET /api/scan already produces.
   Never a filesystem call. */
function oracleFor(files = [KAI_FILE, DOCK_FILE, CRATE_FILE], takes = {}) {
  const rows = files.map((row) => (typeof row === "string" ? { name: row, url: `/assets/${row}` } : row));
  return {
    mediaListing: () => rows,
    shotMediaListing: (shotId) => (takes[shotId] || []),
  };
}

function shotOf(P, id, oracle) {
  return Readiness.evaluateShotReadiness(P, P.shots.find((row) => row.id === id), oracle);
}
function unitOf(row, unitId) {
  return row.units.find((unit) => unit.id === unitId) || null;
}
function requirementOf(row, needle) {
  const all = [...row.requirements, ...row.units.flatMap((unit) => unit.requirements)];
  return all.find((req) => req.id.includes(needle) || req.label.includes(needle)) || null;
}

/* ===========================================================================
   1. VALID REQUIRED AUTHORITY + USABLE MEDIA -> SATISFIED, AND THE SHOT IS READY
   =========================================================================== */
{
  const P = castProject({ shots: [castShot("SH-READY")] });
  approveWholeCast(P);
  const row = shotOf(P, "SH-READY", oracleFor());

  equal(row.status, "READY", "a shot whose every required input holds a receipt and resolves to present media is READY");
  equal(row.nextUnitId, "frame:frame-a", "the next unit is the shot's first declared frame");
  equal(row.nextAction.code, "produce-frame", "the next action is the work itself");
  equal(row.counts.satisfied, 3, "three entity-state requirements are satisfied");
  equal(row.counts.missing, 0, "nothing is missing");
  equal(row.counts.needsDecision, 0, "nothing needs a decision");
  equal(row.mediaCheck, "resolveApprovalMedia", "the listing oracle was used, and the answer says so");

  const kai = requirementOf(row, "CHAR-KAI");
  equal(kai.state, "satisfied", "the character requirement is satisfied");
  equal(kai.reason, "", "a satisfied requirement carries no reason");
  equal(kai.mediaCheck, "resolveApprovalMedia", "media was resolved through the canonical resolver");
  ok(kai.satisfiedBy.length > 0, "a satisfied requirement cites the receipt that satisfies it");
  equal(kai.targetKey, "entity-state:characters:CHAR-KAI#state-default", "the requirement names its authority target key");

  /* THE MODEL NEVER READS A JOB RECORD. Fixture-wide, not per field. */
  const serialized = JSON.stringify(row);
  for (const forbidden of ["generationBinding", "drift", "invalidat", "stale", "regenerate"]) {
    ok(!serialized.includes(forbidden), `readiness must say nothing about past generations: ${forbidden}`);
  }
}

/* ===========================================================================
   2. MISSING REQUIRED APPROVED AUTHORITY -> BLOCKED
   =========================================================================== */
{
  const P = castProject({ shots: [castShot("SH-BLOCKED")] });
  /* No pointers at all, so there is nothing Historic either: genuinely absent. */
  for (const list of ["characters", "locations", "props"]) {
    for (const item of P[list]) {
      item.approvedFile = "";
      for (const row of item.continuityStates) row.approvedFile = "";
    }
  }
  const row = shotOf(P, "SH-BLOCKED", oracleFor());

  equal(row.status, "BLOCKED", "absent required authority is BLOCKED, not a decision");
  equal(row.counts.missing, 3, "all three references are missing");
  deepEqual([...new Set(row.units[0].requirements.map((req) => req.reason))], ["no-approved-reference"],
    "the exact blocker reason token, not merely 'is blocked'");
  equal(row.nextAction.code, "prepare-references", "CineBraid can prepare what is missing");
  equal(row.nextAction.count, 3, "and it says how many");
  ok(row.units[0].requirements.every((req) => req.producible === true), "an absent reference is producible");
}

/* ===========================================================================
   3. HISTORIC POINTER WITHOUT CONFIRMED AUTHORITY -> NEEDS_DECISION
   =========================================================================== */
{
  const P = castProject({ shots: [castShot("SH-HISTORIC")] });
  /* Pointers exist. No ledger. This is every legacy project. */
  const row = shotOf(P, "SH-HISTORIC", oracleFor());

  equal(row.status, "NEEDS_DECISION", "a pointer nobody approved is a decision, never satisfaction");
  equal(row.counts.needsDecision, 3, "each unconfirmed pointer is its own decision");
  equal(row.counts.satisfied, 0, "and none of them is satisfied");
  deepEqual([...new Set(row.units[0].requirements.map((req) => req.reason))], ["historic-selection-unconfirmed"],
    "the exact decision reason token");
  equal(row.nextAction.code, "confirm-existing-reference", "the next action is confirmation, not generation");
  ok(row.units[0].requirements.every((req) => req.producible === false),
    "a Historic pointer is not 'producible' — telling a filmmaker to generate a reference they are looking at would spend money replacing work that is fine");

  /* NEEDS_DECISION OUTRANKS BLOCKED ON THE SAME SHOT. */
  const mixed = castProject({ shots: [castShot("SH-MIXED")] });
  mixed.props[0].approvedFile = "";
  mixed.props[0].continuityStates[0].approvedFile = "";
  const mixedRow = shotOf(mixed, "SH-MIXED", oracleFor());
  equal(mixedRow.counts.missing, 1, "the prop is genuinely missing");
  equal(mixedRow.counts.needsDecision, 2, "two pointers are unconfirmed");
  equal(mixedRow.status, "NEEDS_DECISION", "NEEDS_DECISION outranks BLOCKED on the same unit");
}

/* ===========================================================================
   4. REVOKED AUTHORITY WITH THE POINTER REMAINING -> NEEDS_DECISION
      (and the cleared-edge case, which is a DIFFERENT answer)
   =========================================================================== */
{
  const retained = castProject({ shots: [castShot("SH-REVOKED")] });
  approveWholeCast(retained);
  equal(shotOf(retained, "SH-REVOKED", oracleFor()).status, "READY", "precondition: it was READY before the revocation");

  /* clearEdge:false is the pointer-retained case. */
  GESTURE.gesture(() => Private.revokeEntityStateCanon(retained, {
    list: "characters", entityId: "CHAR-KAI", stateId: "state-default", reason: "withdrawn", at: AT, clearEdge: false,
  }));
  const retainedRow = shotOf(retained, "SH-REVOKED", oracleFor());
  const kai = requirementOf(retainedRow, "CHAR-KAI");
  equal(retainedRow.status, "NEEDS_DECISION", "a withdrawn approval whose pointer survived is a decision");
  equal(kai.state, "needs-decision", "the requirement state");
  equal(kai.reason, "authority-revoked-pointer-remains", "the exact reason token, distinct from an unconfirmed pointer");
  equal(retainedRow.nextAction.code, "reapprove-revoked-reference", "and its own next action");

  /* Cleared edge: nothing points anywhere, so it is plain absence. */
  const cleared = castProject({ shots: [castShot("SH-CLEARED")] });
  approveWholeCast(cleared);
  GESTURE.gesture(() => Private.revokeEntityStateCanon(cleared, {
    list: "characters", entityId: "CHAR-KAI", stateId: "state-default", reason: "withdrawn", at: AT,
  }));
  const clearedRow = shotOf(cleared, "SH-CLEARED", oracleFor());
  equal(clearedRow.status, "BLOCKED", "a revocation that cleared the edge leaves nothing to decide about");
  equal(requirementOf(clearedRow, "CHAR-KAI").reason, "no-approved-reference", "so the reason is plain absence");
}

/* ===========================================================================
   5. UNRESOLVED RELATIONSHIP -> NEEDS_DECISION
   6. DECLARED STATE NOT PRESENT ON THE ENTITY -> NEEDS_DECISION
   17. AMBIGUOUS RELATIONSHIPS -> NEEDS_DECISION, NEVER GUESSED SATISFACTION
   =========================================================================== */
{
  const P = castProject({ shots: [castShot("SH-GHOST", { characters: ["CHAR-KAI", "CHAR-GHOST"] })] });
  approveWholeCast(P);
  const row = shotOf(P, "SH-GHOST", oracleFor());
  equal(row.status, "NEEDS_DECISION", "a shot naming an entity the project does not have cannot be planned");
  const ghost = row.requirements.find((req) => req.id === "relationship:character:CHAR-GHOST");
  ok(ghost, "the unresolved relationship is reported");
  equal(ghost.reason, "unresolved-relationship", "the exact reason token");
  equal(row.nextAction.code, "resolve-relationship", "and its next action");

  /* A declared state the entity does not have. The runtime resolver falls back to
     the default so a renderer has something to draw; readiness must NOT, or it
     reproduces the state-substitution defect one layer up. */
  const missingState = castProject({
    shots: [castShot("SH-STATE", { continuityStateSelections: { "CHAR-KAI": "state-does-not-exist" } })],
  });
  approveWholeCast(missingState);
  const stateRow = shotOf(missingState, "SH-STATE", oracleFor());
  const kai = requirementOf(stateRow, "CHAR-KAI");
  equal(stateRow.status, "NEEDS_DECISION", "a state the entity does not have is a decision");
  equal(kai.reason, "declared-state-not-on-entity", "the exact reason token");
  equal(kai.detail, "state-does-not-exist", "and it names the state that was asked for");
  equal(kai.state, "needs-decision", "never silently resolved to the default");
  equal(stateRow.nextAction.code, "resolve-state-declaration", "and its own next action");

  /* A code token that matches more than one entity. `CHAR-KAI-A` is an exact match
     for one id and a prefix-compatible match for the other, which is the shipped
     union-namespace ambiguity — and filename/prefix specificity is exactly the
     reasoning that must not be allowed to settle it. */
  const ambiguous = castProject({
    characters: [
      entity("CHAR-KAI", "Kai", [state("state-default", "Default", KAI_FILE, true)]),
      entity("CHAR-KAI-A", "Kai alternate", [state("state-default", "Default", "CHAR-KAI-A.png", true)]),
    ],
    shots: [shot("SH-AMBIGUOUS", { codes: ["CHAR-KAI-A"], creationBrief: {} })],
  });
  const ambiguousRow = shotOf(ambiguous, "SH-AMBIGUOUS", oracleFor());
  const codeRow = ambiguousRow.requirements.find((req) => req.reason === "code-ambiguous");
  ok(codeRow, "an ambiguous code token is reported as a decision");
  equal(codeRow.label, "CHAR-KAI-A", "naming the token that is ambiguous");
  ok(codeRow.detail.includes("CHAR-KAI") && codeRow.detail.includes("CHAR-KAI-A"), "and both entities it could mean");
  equal(ambiguousRow.status, "NEEDS_DECISION", "and the shot is NEEDS_DECISION rather than guessing a match");
  equal(ambiguousRow.nextAction.code, "resolve-relationship", "with the relationship as its action");

  /* A code token that names nothing at all. */
  const nothing = castProject({ shots: [shot("SH-NOTHING", { codes: ["PROP-NOWHERE"], creationBrief: {} })] });
  const nothingRow = shotOf(nothing, "SH-NOTHING", oracleFor());
  ok(nothingRow.requirements.some((req) => req.reason === "unresolved-relationship" || req.reason === "code-names-nothing"),
    "a token naming nothing is reported, not dropped");
  equal(nothingRow.status, "NEEDS_DECISION", "and it is a decision");
}

/* ===========================================================================
   7. MALFORMED PRESENCE DECLARATION -> NEEDS_DECISION, NEVER SILENTLY IGNORED
   =========================================================================== */
{
  const P = castProject({
    shots: [castShot("SH-PRESENCE", {
      /* `{ state: "absent" }` is the exact malformed shape the dispatch gate was
         repaired for. normalizeFramePresence() returns "" for it, so a reader that
         asked the PARSED view would see silence. */
      creationBrief: { frameWorkflows: { "frame-a": { entityPresence: { "CHAR-KAI": { state: "absent" } } } } },
    })],
  });
  approveWholeCast(P);
  const row = shotOf(P, "SH-PRESENCE", oracleFor());
  equal(row.status, "NEEDS_DECISION", "an unreadable presence declaration is a decision, not silence");
  const presence = row.units[0].requirements.find((req) => req.kind === "presence");
  ok(presence, "the presence problem is a requirement of the frame it governs");
  equal(presence.reason, "presence-declaration-malformed", "the exact reason token");
  equal(presence.detail, "unrecognised-presence-value", "carrying the shipped record status' own reason");
  equal(row.nextAction.code, "repair-presence-declaration", "and its own next action");
}

/* ===========================================================================
   8.  VALID RECEIPT WHOSE BACKING MEDIA IS UNAVAILABLE -> BLOCKED
   9.  IDENTITY-FIRST RENAMED MEDIA STILL RESOLVES
   10. NO HIDDEN HASH / DOWNLOAD / VERIFY
   =========================================================================== */
{
  const P = castProject({ shots: [castShot("SH-GONE")] });
  approveWholeCast(P);
  /* The listing no longer holds Kai's file. The receipt is untouched and still
     valid — the kernel does no I/O, so Canon is unaffected by a filesystem fact. */
  const row = shotOf(P, "SH-GONE", oracleFor([DOCK_FILE, CRATE_FILE]));
  const kai = requirementOf(row, "CHAR-KAI");
  equal(row.status, "BLOCKED", "missing bytes is BLOCKED — CineBraid can name exactly what would satisfy it: that file");
  equal(kai.state, "missing", "the requirement is missing");
  equal(kai.reason, "approved-bytes-missing", "the exact reason token, distinct from no-approved-reference");
  equal(kai.producible, false, "generation cannot restore a specific approved image; a new one would need a new approval");
  ok(kai.satisfiedBy.length > 0, "the receipt is still cited — the human decision is intact, the bytes are not");
  equal(row.nextAction.code, "supply-approved-media", "so the action reads SUPPLY");
  ok(!/prepare/i.test(row.nextAction.message), "and never PREPARE");
  equal(row.nextAction.count, 1, "for exactly one file");

  /* IDENTITY BEATS FILENAME. The approval recorded an identity; the file has since
     been renamed and the listing carries the same identity under the new name. */
  const renamed = castProject({ shots: [castShot("SH-RENAMED")] });
  const identity = assetId("a");
  approveEntityState(renamed, "characters", "CHAR-KAI", "state-default", KAI_FILE, identity);
  approveEntityState(renamed, "locations", "LOC-DOCK", "state-default", DOCK_FILE);
  approveEntityState(renamed, "props", "PROP-CRATE", "state-default", CRATE_FILE);
  const renamedRow = shotOf(renamed, "SH-RENAMED", oracleFor([
    { name: "KAI-RENAMED-SINCE-APPROVAL.png", assetId: identity },
    DOCK_FILE,
    CRATE_FILE,
  ]));
  equal(requirementOf(renamedRow, "CHAR-KAI").state, "satisfied",
    "a legitimately renamed approval still resolves, because the resolver is identity-first");
  equal(renamedRow.status, "READY", "and the shot stays READY");

  /* THE DEGRADED ORACLE SAYS SO. A filename test cannot see that rename. */
  const degraded = Readiness.evaluateShotReadiness(renamed, renamed.shots[0], {
    fileExists: (name) => [DOCK_FILE, CRATE_FILE].includes(name),
  });
  equal(degraded.mediaCheck, "file-name-only", "the answer reports which oracle was used");
  equal(requirementOf(degraded, "CHAR-KAI").reason, "approved-bytes-missing",
    "and a filename-only check genuinely cannot see the rename, which is why it must be reported rather than implied");

  /* NO ORACLE AT ALL — UNKNOWN STAYS UNKNOWN.
     This block previously asserted `satisfied` here, with `mediaCheck: "not-checked"`
     beside it as the only hint. That assertion was true of the code and wrong about
     the product: a field describing the evidence does not undo a claim made without
     it, and the acceptance audit reproduced a READY shot from it. */
  const unchecked = Readiness.evaluateShotReadiness(renamed, renamed.shots[0], {});
  equal(unchecked.mediaCheck, "not-checked", "no oracle is a real answer and the result says so");
  equal(requirementOf(unchecked, "CHAR-KAI").state, "needs-decision", "authority alone must NOT satisfy a requirement whose media nobody has looked for");
  equal(requirementOf(unchecked, "CHAR-KAI").reason, "media-availability-unknown", "the exact reason token");
  equal(requirementOf(unchecked, "CHAR-KAI").mediaCheck, "not-checked", "with the evidence stated honestly on the row");
  equal(unchecked.status, "NEEDS_DECISION", "and the shot is not READY");

  /* STRUCTURALLY INCAPABLE OF A BYTE READ. Asserted against the shipped source,
     because "we did not call it in this test" proves nothing about the next one. */
  const source = fs.readFileSync(path.join(PUBLIC, "shared-shot-readiness.js"), "utf8");
  for (const forbidden of ["require(\"fs\")", "require('fs')", "hashMediaFile", "existsSync", "readFileSync", "verifyNow", "fetch("]) {
    ok(!source.includes(forbidden), `readiness runs on every render and must never ${forbidden}`);
  }
  deepEqual(Readiness.READINESS_MEDIA_CHECKS.slice(), ["resolveApprovalMedia", "file-name-only", "not-checked"],
    "the three media-evidence answers, exactly");
}

/* ===========================================================================
   11. OPTIONAL ABSENT MEDIA DOES NOT BLOCK OTHERWISE EXECUTABLE WORK
   =========================================================================== */
{
  const P = castProject({
    shots: [castShot("SH-OPTIONAL", {
      keyframes: [
        { id: "frame-a", label: "A", required: true },
        { id: "frame-b", label: "B", required: false },
      ],
      clips: [{ id: "clip-1", suffix: "A", kind: "i2v" }],
    })],
  });
  approveWholeCast(P);
  approveFrame(P, "SH-OPTIONAL", "frame-a", "SH-OPTIONAL-A.png");
  const row = shotOf(P, "SH-OPTIONAL", oracleFor(undefined, { "SH-OPTIONAL": [{ name: "SH-OPTIONAL-A.png", url: "/assets/a" }] }));
  const motion = unitOf(row, "motion:clip-1");
  const optional = motion.requirements.find((req) => req.id === "required-frame:frame-b");

  equal(optional.state, "optional", "an unrequired frame is optional, never missing");
  equal(optional.required, false, "and it is not counted as required");
  equal(optional.reason, "", "an optional row carries no blocker reason");
  equal(optional.unlocks, "flf", "and it names the method approving it would unlock — the difference between 'optional' and 'pointless'");
  equal(motion.status, "READY", "so the motion unit is executable now");
  equal(motion.counts.optional, 1, "counted separately");
  equal(motion.counts.missing, 0, "and never as a blocker");
}

/* ===========================================================================
   12. A MISSING METHOD INPUT IS `missing-prerequisite`, NEVER `unsupported`
   13. GENUINE T2V MAY BE READY WITH ZERO REFERENCE REQUIREMENTS
   + METHOD TRUTH: DEFAULT / ALSO-ADMISSIBLE / CONTRAINDICATED ARE THREE SETS
   =========================================================================== */
{
  /* The probe set is DERIVED from the shipped resolver, not tabulated here. If
     resolveTaskModes() changes, this changes with it — and this assertion is what
     proves the two are the same answer rather than two copies of one. */
  deepEqual(Readiness.ANIMATE_METHODS.slice(), ["t2v", "r2v", "i2v", "flf"],
    "the animate-shot universe, exactly as the shipped resolver defines it");
  for (const probe of Readiness.ANIMATE_METHOD_PROBES) {
    equal(
      probe.method,
      resolveTaskModes("animate-shot", { references: probe.needs.map((role) => ({ role, mediaType: "image" })) })[0],
      `probe ${probe.needs.join("+") || "(none)"} restates no rule of its own`,
    );
  }

  /* A shot with references approved and NO approved frames. */
  const P = castProject({
    shots: [castShot("SH-MOTION", {
      keyframes: [
        { id: "frame-a", label: "A", required: true },
        { id: "frame-b", label: "B", required: true },
      ],
      clips: [{ id: "clip-1", suffix: "A", kind: "i2v" }],
    })],
  });
  approveWholeCast(P);
  const motion = unitOf(shotOf(P, "SH-MOTION", oracleFor()), "motion:clip-1");

  equal(motion.admissible, "r2v", "with references and no endpoints the shipped resolver's answer is r2v");
  deepEqual(motion.alsoAdmissible.slice(), ["t2v"], "t2v is genuinely reachable from a valid subset of the same inputs");
  deepEqual(motion.contraindicated.map((row) => row.method), ["i2v", "flf"], "the exact contraindicated set");
  deepEqual(motion.contraindicated.map((row) => row.reason), ["missing-prerequisite", "missing-prerequisite"],
    "an absent input is a missing prerequisite — the method is not refused");
  deepEqual(motion.contraindicated.find((row) => row.method === "i2v").missing, ["first-frame"],
    "and it names exactly which input is absent");
  deepEqual(motion.contraindicated.find((row) => row.method === "flf").missing, ["first-frame", "last-frame"],
    "both endpoints, for the method that needs both");
  ok(!JSON.stringify(motion).includes("unsupported"), "the token `unsupported` never appears in a readiness contraindication");
  deepEqual(Readiness.READINESS_CONTRAINDICATION_REASONS.slice(), ["missing-prerequisite"],
    "and there is exactly one contraindication reason in this model");

  /* THE FIXTURE F CORRECTION, ASSERTED RATHER THAN DESCRIBED. With BOTH endpoints
     approved the shipped resolver returns one mode — flf — and i2v and r2v remain
     genuinely reachable from a different valid subset. Reporting only flf would
     present a deterministic tie-break as though CineBraid had proved one method
     uniquely superior, and on the H3 adapter the difference is material: i2v/flf
     refuse every non-endpoint reference while r2v sends them. */
  approveFrame(P, "SH-MOTION", "frame-a", "SH-MOTION-A.png");
  approveFrame(P, "SH-MOTION", "frame-b", "SH-MOTION-B.png");
  const both = unitOf(
    shotOf(P, "SH-MOTION", oracleFor(undefined, { "SH-MOTION": [{ name: "SH-MOTION-A.png" }, { name: "SH-MOTION-B.png" }] })),
    "motion:clip-1",
  );
  equal(both.admissible, "flf", "the operational/default answer is the shipped resolver's");
  deepEqual(both.alsoAdmissible.slice(), ["t2v", "r2v", "i2v"], "and the other genuinely admissible choices are named, not hidden");
  deepEqual(both.contraindicated.slice(), [], "nothing is contraindicated when every input is present");
  ok(!both.alsoAdmissible.includes(both.admissible), "the default never also appears as an alternative");
  ok(!both.contraindicated.some((row) => both.alsoAdmissible.includes(row.method)),
    "a reachable method is never also reported as contraindicated");
  equal(both.status, "READY", "and the unit is executable");
  equal(both.nextAction.code, "produce-motion", "with the work as its next action");

  /* GENUINE T2V: a shot that names no entity and declares no frame to begin from.
     Nothing is manufactured for it — no opening frame, no reference requirement —
     so its single motion unit has genuinely zero requirements. */
  const t2v = project({
    shots: [shot("SH-T2V", { keyframes: [], clips: [{ id: "clip-1", kind: "t2v" }], creationBrief: {} })],
  });
  const t2vRow = shotOf(t2v, "SH-T2V", oracleFor());
  const t2vUnit = unitOf(t2vRow, "motion:clip-1");
  equal(t2vUnit.counts.required, 0, "zero reference requirements");
  equal(t2vUnit.admissible, "t2v", "and the resolver says t2v");
  equal(t2vUnit.status, "READY", "a unit with zero requirements is genuinely READY");
  equal(t2vRow.status, "READY", "and so is the shot");

  /* A FRAME UNIT'S METHODS COME FROM THE SAME RESOLVER. */
  const frameUnit = unitOf(shotOf(P, "SH-MOTION", oracleFor()), "frame:frame-a");
  equal(frameUnit.admissible, "multi-reference", "a frame with approved references compiles as multi-reference");
  deepEqual(frameUnit.alsoAdmissible.slice(), ["t2i"], "with plain generation as the other admissible choice");
  deepEqual(resolveTaskModes("create-frame", { references: [{ role: "reference", mediaType: "image" }] }),
    [frameUnit.admissible, ...frameUnit.alsoAdmissible], "and both come from the shipped resolver, in its order");
}

/* ===========================================================================
   14. REQUIRED FRAME B MAY DEPEND ON APPROVED FRAME A
   15. MOTION MAY DEPEND ON BOTH REQUIRED APPROVED FRAMES
   16. A LATER BLOCKED UNIT DOES NOT PREVENT THE SHOT BEING READY
   =========================================================================== */
{
  const P = castProject({
    shots: [castShot("SH-CHAIN", {
      keyframes: [
        { id: "frame-a", label: "A", required: true },
        { id: "frame-b", label: "B", required: true },
      ],
      clips: [{ id: "clip-1", suffix: "A", kind: "flf" }],
    })],
  });
  approveWholeCast(P);
  const row = shotOf(P, "SH-CHAIN", oracleFor());

  /* THE HEADLINE IS THE NEXT OUTSTANDING REQUIRED UNIT, and later units being
     blocked is the honest answer rather than an approximation. */
  equal(row.status, "READY", "the shot is READY because its immediate next required unit is executable");
  equal(row.nextUnitId, "frame:frame-a", "which is Frame A");
  equal(unitOf(row, "frame:frame-a").status, "READY", "Frame A can be produced now");
  equal(unitOf(row, "frame:frame-b").status, "BLOCKED", "Frame B derives from Frame A and cannot");
  equal(unitOf(row, "motion:clip-1").status, "BLOCKED", "and motion needs both required frames approved");

  const parent = unitOf(row, "frame:frame-b").requirements.find((req) => req.id === "parent-frame:frame-a");
  equal(parent.reason, "parent-frame-not-approved", "the exact frame-dependency reason token");
  equal(parent.basis, "derived", "and it is a structural prerequisite CineBraid computed, not an authored input");
  equal(unitOf(row, "frame:frame-b").nextAction.code, "approve-parent-frame", "with its own next action");

  const motionGaps = unitOf(row, "motion:clip-1").requirements.filter((req) => req.reason === "required-frame-not-approved");
  equal(motionGaps.length, 2, "motion names both required frames");
  equal(unitOf(row, "motion:clip-1").nextAction.code, "approve-required-frames", "and asks for their approval");
  equal(unitOf(row, "motion:clip-1").nextAction.count, 2, "naming how many");

  /* APPROVING FRAME A MOVES THE HEADLINE, and the completed unit says so. */
  approveFrame(P, "SH-CHAIN", "frame-a", "SH-CHAIN-A.png");
  const after = shotOf(P, "SH-CHAIN", oracleFor(undefined, { "SH-CHAIN": [{ name: "SH-CHAIN-A.png" }] }));
  equal(unitOf(after, "frame:frame-a").complete, true, "Frame A now holds Canon");
  equal(unitOf(after, "frame:frame-a").existingAuthority, "canon", "and says which authority it holds");
  equal(after.nextUnitId, "frame:frame-b", "so the next outstanding unit is Frame B");
  equal(after.status, "READY", "which is now executable");

  /* A FRAME THAT DOES NOT CONTINUE FROM THE PREVIOUS ONE HAS NO PARENT REQUIREMENT. */
  const independent = castProject({
    shots: [castShot("SH-INDEPENDENT", {
      keyframes: [{ id: "frame-a", label: "A", required: true }, { id: "frame-b", label: "B", required: true }],
      creationBrief: { locationId: "LOC-DOCK", propIds: ["PROP-CRATE"], frameWorkflows: { "frame-b": { usePreviousFrame: false } } },
    })],
  });
  approveWholeCast(independent);
  const independentRow = shotOf(independent, "SH-INDEPENDENT", oracleFor());
  equal(unitOf(independentRow, "frame:frame-b").requirements.filter((req) => req.id.startsWith("parent-frame:")).length, 0,
    "a frame the shot says does not continue from the previous one carries no parent requirement");
  equal(unitOf(independentRow, "frame:frame-b").status, "READY", "and is executable independently");
}

/* ===========================================================================
   18. AN UNREADABLE AUTHORITY LEDGER IS ONE UPPER-LEVEL TRUTH PROBLEM,
       NOT N MISLEADING BLOCKERS
   =========================================================================== */
{
  const P = castProject({ shots: [castShot("SH-A"), castShot("SH-B")] });
  approveWholeCast(P);
  /* A version this build does not read. Every approval in the project becomes
     unrecognisable — which is a fact about the LEDGER, not about the references. */
  P.productionAuthority.version = 99;

  const feed = Readiness.evaluateProjectReadiness(P, oracleFor());
  equal(feed.authority.trusted, false, "the ledger is not trusted");
  ok(feed.truthProblem, "and the feed carries one truth problem");
  equal(feed.truthProblem.reason, "authority-ledger-unreadable", "the exact reason token");
  ok(feed.truthProblem.diagnostics.some((row) => row.code === "AUTHORITY_LEDGER_VERSION_UNSUPPORTED"),
    "carrying the kernel's own diagnostic code");
  equal(feed.counts.needsDecision, 2, "every shot is a decision");

  /* THE REPAIR IS THE PROJECT'S ACTION, AND IT IS EMITTED EXACTLY ONCE. */
  equal(feed.nextAction.code, "repair-authority-ledger", "the project carries the repair action");
  equal(feed.nextAction.count, 1, "once");

  const row = feed.shots[0];
  equal(row.status, "NEEDS_DECISION", "the shot reports the decision");
  equal(row.nextAction.code, "awaiting-project-repair", "but the shot does not repeat the repair");
  ok(row.truthProblem === feed.truthProblem, "it cites the same frozen project problem rather than a copy of it");
  equal(row.units.length, 0, "and NO per-unit blockers are manufactured");
  equal(row.requirements.length, 0, "and no missing-reference rows either");
  equal(row.counts.missing, 0, "a lie of aggregation would send a filmmaker to prepare references that are already approved");
}

/* ===========================================================================
   BLOCKER 2 REGRESSION — ONE CORRUPT LEDGER, THREE SHOTS, ONE REPAIR.

   The reviewed implementation returned `repair-authority-ledger` from every shot,
   so three shots produced three identical repair actions and the surface rendered
   all three. The existing control above has a single shot and therefore could not
   see it. This one has three, and counts.
   =========================================================================== */
{
  const P = castProject({ shots: [castShot("SH-1"), castShot("SH-2"), castShot("SH-3")] });
  approveWholeCast(P);
  P.productionAuthority.version = 99;
  const feed = Readiness.evaluateProjectReadiness(P, oracleFor());

  equal(feed.shots.length, 3, "three shots");
  equal(feed.counts.needsDecision, 3, "each of which is unanswerable");

  /* THE COUNT IS THE PROPERTY. Not "a repair exists somewhere" — exactly one, in
     the whole payload, at the project level. */
  const occurrences = (JSON.stringify(feed).match(/repair-authority-ledger/g) || []).length;
  equal(occurrences, 1, "the repair action appears exactly once in the entire payload");
  equal(feed.nextAction.code, "repair-authority-ledger", "and that one occurrence is the project's own action");
  deepEqual(feed.shots.map((row) => row.nextAction.code),
    ["awaiting-project-repair", "awaiting-project-repair", "awaiting-project-repair"],
    "no shot asks for the repair; each says its readiness is waiting on the project");
  equal(feed.shots.filter((row) => row.nextAction.code === "repair-authority-ledger").length, 0,
    "one project truth failure must not become N identical human actions");

  /* THE PROBLEM ITSELF IS ONE OBJECT, not one per shot. */
  ok(feed.truthProblem, "the project carries the problem");
  ok(feed.shots.every((row) => row.truthProblem === feed.truthProblem),
    "every shot cites the identical frozen object, so the ledger was validated once");
  deepEqual([...new Set(feed.shots.map((row) => row.truthProblem.reason))], ["authority-ledger-unreadable"],
    "and they all name the same reason");

  /* A TRUSTWORTHY LEDGER CARRIES NO PROJECT ACTION AT ALL — readiness is a per-shot
     question, and a project-level verdict would be a second thing able to declare
     the production ready. */
  const healthy = castProject({ shots: [castShot("SH-OK")] });
  approveWholeCast(healthy);
  const healthyFeed = Readiness.evaluateProjectReadiness(healthy, oracleFor());
  equal(healthyFeed.truthProblem, null, "no truth problem");
  equal(healthyFeed.nextAction, null, "and no project-level action invented in its place");
}

/* ===========================================================================
   BLOCKER 3 REGRESSION — UNKNOWN MEDIA IS NEVER PROMOTED.

   The reviewed implementation rejected only `unavailable`, so every other answer —
   including "nobody looked" — fell through to satisfied. Calling the canonical
   predicate with no oracle returned satisfied / READY for an approval whose media
   availability was genuinely unknown.
   =========================================================================== */
{
  const P = castProject({ shots: [castShot("SH-UNKNOWN")] });
  approveWholeCast(P);

  /* THE PREDICATE ITSELF, called exactly as the audit called it. */
  const row = Readiness.productionInputSatisfaction(P, {
    id: "probe",
    kind: "entity-state",
    label: "Kai",
    target: { kind: "entity-state", list: "characters", entityId: "CHAR-KAI", stateId: "state-default" },
  }, {});
  assert.notStrictEqual(row.state, "satisfied", "unknown media availability must never be satisfied");
  checks += 1;
  equal(row.state, "needs-decision", "it is a decision: establishing the fact costs a byte read a person must authorise");
  equal(row.reason, "media-availability-unknown", "the exact reason token");
  equal(row.mediaCheck, "not-checked", "and the uncertainty stays explicit on the row");
  equal(row.producible, false, "generating something new does not answer a question about existing bytes");
  ok(row.satisfiedBy.length > 0, "the receipt is still cited — the human decision is intact and is not what is in doubt");

  /* AND THE SHOT IS NOT EXECUTABLE. */
  const unknown = shotOf(P, "SH-UNKNOWN", {});
  assert.notStrictEqual(unknown.status, "READY", "a shot whose media nobody has looked for must not be READY");
  checks += 1;
  equal(unknown.status, "NEEDS_DECISION", "it needs a decision");
  equal(unknown.nextAction.code, "establish-media-availability", "and the action is to establish the fact");
  equal(unknown.counts.satisfied, 0, "nothing is counted as satisfied");
  equal(unknown.counts.needsDecision, 3, "all three references are uncertain");
  equal(unknown.mediaCheck, "not-checked", "and the shot states which oracle answered");

  /* THE DEGRADED ORACLE IS AN ANSWER, SO IT IS NOT UNKNOWN. */
  const named = shotOf(P, "SH-UNKNOWN", { fileExists: (name) => [KAI_FILE, DOCK_FILE, CRATE_FILE].includes(name) });
  equal(named.status, "READY", "a filename oracle that answers yes is an answer, and satisfies");
  equal(named.mediaCheck, "file-name-only", "reported as the weaker evidence it is");

  /* THE TWO KNOWN PATHS ARE UNCHANGED — the fix must not have swallowed them. */
  const available = shotOf(P, "SH-UNKNOWN", oracleFor());
  equal(available.status, "READY", "known-available stays READY");
  equal(requirementOf(available, "CHAR-KAI").state, "satisfied", "and satisfied");
  equal(requirementOf(available, "CHAR-KAI").mediaCheck, "resolveApprovalMedia", "through the canonical resolver");

  const gone = shotOf(P, "SH-UNKNOWN", oracleFor([DOCK_FILE, CRATE_FILE]));
  equal(gone.status, "BLOCKED", "known-unavailable stays BLOCKED");
  equal(requirementOf(gone, "CHAR-KAI").reason, "approved-bytes-missing", "with its own distinct reason");
  equal(gone.nextAction.code, "supply-approved-media", "and its own supply action");

  /* THE THREE ANSWERS ARE THREE DIFFERENT REASONS, never collapsed. */
  deepEqual(
    [requirementOf(available, "CHAR-KAI").reason, requirementOf(gone, "CHAR-KAI").reason, row.reason],
    ["", "approved-bytes-missing", "media-availability-unknown"],
    "available / unavailable / unknown are three distinct answers",
  );
  ok(Readiness.READINESS_DECISION_REASONS.includes("media-availability-unknown"), "the reason is declared");
  ok(Readiness.READINESS_NEXT_ACTIONS.includes("establish-media-availability"), "and so is its action");
}

/* ===========================================================================
   19. THE DERIVATION MUTATES NOTHING
   =========================================================================== */
{
  const P = castProject({
    shots: [castShot("SH-PURE", {
      keyframes: [{ id: "frame-a", label: "A", required: true }, { id: "frame-b", label: "B", required: true }],
      clips: [{ id: "clip-1", kind: "i2v" }],
      continuityStateSelections: { "CHAR-KAI": "state-rain" },
    })],
  });
  approveWholeCast(P);
  const before = JSON.stringify(P);
  Readiness.evaluateProjectReadiness(P, oracleFor());
  Readiness.evaluateShotReadiness(P, P.shots[0], oracleFor());
  Readiness.historicConfirmationQueue(P, oracleFor());
  equal(JSON.stringify(P), before, "evaluating readiness changes no byte of the project document");

  /* And the answer itself is frozen, so a surface cannot edit it and hand it on. */
  const row = shotOf(P, "SH-PURE", oracleFor());
  ok(Object.isFrozen(row), "the shot answer is frozen");
  ok(Object.isFrozen(row.units), "and so are its units");
  ok(Object.isFrozen(row.units[0].requirements), "and their requirements");
}

/* ===========================================================================
   HISTORIC DEDUPLICATION — BY AUTHORITY TARGET, NEVER BY OCCURRENCE OR FILENAME
   =========================================================================== */
{
  /* Four shots, all naming the same three entities. Twelve occurrences, three
     decisions. The research measured 8.9x on a real corpus for exactly this
     reason; the ratio here is 4x because the fixture is four shots. */
  const P = castProject({ shots: ["SH-1", "SH-2", "SH-3", "SH-4"].map((id) => castShot(id)) });
  const queue = Readiness.historicConfirmationQueue(P, oracleFor());

  equal(queue.occurrences, 12, "twelve shot requirements are unconfirmed");
  equal(queue.uniqueTargets, 3, "which are three human confirmations, not twelve");
  equal(queue.items.length, 3, "one row per unique authority target");
  deepEqual(queue.items.map((row) => row.key).sort(), [
    "entity-state:characters:CHAR-KAI#state-default",
    "entity-state:locations:LOC-DOCK#state-default",
    "entity-state:props:PROP-CRATE#state-default",
  ], "keyed by authorityTarget().key — the same identity the approve*Canon commands use");
  ok(queue.items.every((row) => row.requirementCount === 4), "each confirmation resolves four requirements");
  ok(queue.items.every((row) => row.shotIds.length === 4), "across four shots");
  ok(queue.items.every((row) => row.ownership.wouldRefuse === false), "and the shipped veto would permit all of them");

  /* SORTED BY LEVERAGE. The research measured that the top 17% of confirmations
     carry 61% of the burden, which is what makes ordering worth doing. */
  const uneven = castProject({ shots: [castShot("SH-1"), castShot("SH-2"), shot("SH-3", { characters: ["CHAR-KAI"], creationBrief: {} })] });
  const unevenQueue = Readiness.historicConfirmationQueue(uneven, oracleFor());
  equal(unevenQueue.items[0].key, "entity-state:characters:CHAR-KAI#state-default", "the highest-leverage confirmation is first");
  equal(unevenQueue.items[0].requirementCount, 3, "serving three requirements");

  /* THREE STATES OF ONE ENTITY ARE THREE DECISIONS. Collapsing them by entity
     would be the state-substitution defect, in a queue. */
  const states = castProject({
    shots: [
      castShot("SH-DEFAULT"),
      castShot("SH-RAIN", { continuityStateSelections: { "CHAR-KAI": "state-rain" } }),
    ],
  });
  const stateQueue = Readiness.historicConfirmationQueue(states, oracleFor([KAI_FILE, "CHAR-KAI-RAIN.png", DOCK_FILE, CRATE_FILE]));
  const kaiRows = stateQueue.items.filter((row) => row.target.entityId === "CHAR-KAI");
  equal(kaiRows.length, 2, "two states of one entity are two separate confirmations");
  deepEqual(kaiRows.map((row) => row.target.stateId).sort(), ["state-default", "state-rain"], "named by state, not merged by entity");

  /* CONFIRMING ONE RESOLVES IT EVERYWHERE — through the shipped command. */
  const confirmable = Readiness.historicConfirmationQueue(P, oracleFor()).items[0];
  approveEntityState(P, confirmable.target.list, confirmable.target.entityId, confirmable.target.stateId, confirmable.value, confirmable.assetId);
  const after = Readiness.historicConfirmationQueue(P, oracleFor());
  equal(after.uniqueTargets, 2, "one confirmation removes one row");
  equal(after.occurrences, 8, "and four requirement occurrences with it");
}

/* ===========================================================================
   OWNERSHIP REFUSAL — THE QUEUE MUST NOT OFFER WHAT THE KERNEL WOULD REFUSE
   =========================================================================== */
{
  /* Two entities durably claiming the same bytes. resolveMediaOwnership() answers
     "contested", and the kernel refuses. */
  const contestedFile = "SHARED-IMAGE.png";
  const P = project({
    props: [
      entity("PROP-ONE", "Prop one", [state("state-default", "Default", contestedFile, true)]),
      entity("PROP-TWO", "Prop two", [state("state-default", "Default", contestedFile, true)]),
    ],
    shots: [shot("SH-CONTESTED", { creationBrief: { propIds: ["PROP-ONE"] } })],
  });
  const row = shotOf(P, "SH-CONTESTED", oracleFor([contestedFile]));
  const requirement = requirementOf(row, "PROP-ONE");
  equal(requirement.reason, "contested-media-ownership", "contested bytes are a decision, not a confirmation");
  equal(row.status, "NEEDS_DECISION", "and the shot says so");
  equal(row.nextAction.code, "resolve-media-ownership", "with the claim as its next action");

  /* THE CONTESTED TARGET NEVER REACHES THE CONFIRMATION QUEUE, because it is not a
     confirmation — it is a claim to resolve first. */
  const contestedQueue = Readiness.historicConfirmationQueue(P, oracleFor([contestedFile]));
  equal(contestedQueue.uniqueTargets, 0, "a contested requirement is a decision, not a confirmation row");

  /* AND THE VETO IS REAL, PROVEN BY EXECUTING THE SHIPPED COMMAND RATHER THAN BY
     trusting that the queue filtered correctly. Two independent guards, and this
     asserts the second one exists. */
  assert.throws(
    () => approveEntityState(P, "props", "PROP-ONE", "state-default", contestedFile),
    (error) => error.code === "AUTHORITY_OWNERSHIP_CONTESTED" && /No authority was written/.test(error.message),
    "the shipped command refuses a contested confirmation on its own, by code, and writes nothing",
  );
  checks += 1;

  /* EVERY ROW THE QUEUE SAYS WOULD COMMIT, GENUINELY COMMITS. This is the claim the
     surface's Confirm button makes, so it is executed rather than asserted.

     ON THE CURRENT DOCUMENT SHAPE a Historic entity-state pointer is durably
     claimed by its own entity by construction: the live edge the kernel reads
     (`state.approvedFile`, falling back to `entity.approvedFile`) is one of the
     same fields entityClaimedFileNames() reads, so the only ownership answer that
     can refuse one is `contested` — and that is caught above as its own decision.
     `wouldRefuse` is therefore false for every row this corpus can produce, which
     matches the research's measured 0-of-53. The per-row check stays because the
     CLICK is a different moment from the derivation: the kernel is the authority
     either way, and a surface that assumed otherwise would be asserting a
     permission it computed earlier. */
  const owned = castProject({ shots: [castShot("SH-OWNED")] });
  const ownedQueue = Readiness.historicConfirmationQueue(owned, oracleFor());
  equal(ownedQueue.uniqueTargets, 3, "three rows are offered");
  ok(ownedQueue.items.every((item) => item.ownership.applicable === true && item.ownership.status === "owned"),
    "each is reported as durably owned by the entity being confirmed");
  for (const item of ownedQueue.items) {
    equal(item.ownership.wouldRefuse, false, `${item.key} is offered as committable`);
    approveEntityState(owned, item.target.list, item.target.entityId, item.target.stateId, item.value, item.assetId);
  }
  equal(Readiness.historicConfirmationQueue(owned, oracleFor()).uniqueTargets, 0,
    "and every one of them genuinely committed through the shipped command");
  equal(shotOf(owned, "SH-OWNED", oracleFor()).status, "READY",
    "which is the whole point: confirming existing selections converts the feed");

  /* A SHOT-FRAME CONFIRMATION HAS NO OWNERSHIP CONCEPT, and says so rather than
     inventing an answer. */
  const frames = castProject({ shots: [castShot("SH-FRAMEHIST")] });
  approveWholeCast(frames);
  frames.shots[0].keyframes[0].winner = "SH-FRAMEHIST-A.png";
  const frameQueue = Readiness.historicConfirmationQueue(frames, oracleFor(undefined, { "SH-FRAMEHIST": [{ name: "SH-FRAMEHIST-A.png" }] }));
  equal(frameQueue.uniqueTargets, 0, "an already-satisfied cast leaves no entity rows");
  const frameShot = shotOf(frames, "SH-FRAMEHIST", oracleFor(undefined, { "SH-FRAMEHIST": [{ name: "SH-FRAMEHIST-A.png" }] }));
  equal(frameShot.status, "READY",
    "a frame pointer nobody approved does not make the frame's own unit a decision — the unit is the work, not a requirement of itself");
}

/* ===========================================================================
   NO PRODUCIBLE UNIT DECLARED, AND THE DECLARED LIMITATIONS
   =========================================================================== */
{
  const P = castProject({ shots: [castShot("SH-EMPTY", { keyframes: [] })] });
  approveWholeCast(P);
  const row = shotOf(P, "SH-EMPTY", oracleFor());
  equal(row.units.length, 0, "no unit is manufactured for a shot that declares none");
  equal(row.status, "NEEDS_DECISION", "only a person can say what this shot produces");
  equal(row.nextAction.code, "declare-producible-unit", "with that as its action");

  /* NO MOTION UNIT IS INVENTED FOR A STILL SHOT. */
  const still = castProject({ shots: [castShot("SH-STILL", { creationBrief: { locationId: "LOC-DOCK", propIds: [], deliveryIntent: "still" } })] });
  approveWholeCast(still);
  deepEqual(shotOf(still, "SH-STILL", oracleFor()).units.map((unit) => unit.id), ["frame:frame-a"],
    "a still shot gets no motion unit");

  /* BOTH deliveryIntent DIALECTS ARE READ. Current source writes "motion" from the
     composer and "video" from the kernel's delivery approval, and a reader that
     knew only one would silently drop the other's motion unit. */
  for (const intent of ["motion", "video"]) {
    const wants = castProject({ shots: [castShot(`SH-${intent}`, { creationBrief: { locationId: "LOC-DOCK", propIds: [], deliveryIntent: intent } })] });
    approveWholeCast(wants);
    deepEqual(shotOf(wants, `SH-${intent}`, oracleFor()).units.map((unit) => unit.id), ["frame:frame-a", "motion:shot"],
      `deliveryIntent "${intent}" declares a motion unit`);
  }

  /* COMPLETE IS THE EXISTING DONE SEMANTICS, AND ONLY IN THE ROLLUP. */
  const done = castProject({ shots: [castShot("SH-DONE")] });
  approveWholeCast(done);
  approveFrame(done, "SH-DONE", "frame-a", "SH-DONE-A.png");
  const doneRow = shotOf(done, "SH-DONE", oracleFor(undefined, { "SH-DONE": [{ name: "SH-DONE-A.png" }] }));
  equal(doneRow.status, "COMPLETE", "every declared unit holds Canon");
  ok(!Readiness.SHOT_READINESS_STATUSES.includes("COMPLETE"), "COMPLETE is not a unit readiness state");
  ok(Readiness.SHOT_ROLLUP_STATUSES.includes("COMPLETE"), "it exists only in the rollup vocabulary");
  ok(doneRow.units.every((unit) => Readiness.SHOT_READINESS_STATUSES.includes(unit.status)), "and no unit ever reports it");

  /* THE DECLARED GAPS STAY DECLARED. */
  deepEqual(Readiness.SHOT_READINESS_UNAVAILABLE_KEYS.slice().sort(),
    ["audio-entity-authority", "environment-readiness", "historical-drift", "lip-sync-method-narrowing"],
    "every gap this model cannot answer is named rather than guessed");
  for (const key of Readiness.SHOT_READINESS_UNAVAILABLE_KEYS) {
    const gap = Readiness.SHOT_READINESS_UNAVAILABLE[key];
    ok(gap.question && gap.why && gap.wouldNeed, `${key} states the question, the reason and what would close it`);
  }

  /* LIP SYNC IS A STATED CONSTRAINT, AND NARROWS NOTHING. */
  const lip = castProject({ shots: [castShot("SH-LIP", { audio: { dialogue: "A line", lipSyncRequired: true }, clips: [{ id: "clip-1", kind: "i2v" }] })] });
  approveWholeCast(lip);
  const lipRow = shotOf(lip, "SH-LIP", oracleFor());
  deepEqual(lipRow.constraints.slice(), [{ code: "lip-sync", value: "critical" }], "critical lip sync is reported as a constraint");
  equal(unitOf(lipRow, "motion:clip-1").admissible, "r2v", "and the admissible method is unchanged by it");

  /* An implied line is NOT promoted to a constraint. */
  const implied = castProject({ shots: [castShot("SH-IMPLIED", { audio: { dialogue: "A line" } })] });
  approveWholeCast(implied);
  deepEqual(shotOf(implied, "SH-IMPLIED", oracleFor()).constraints.slice(), [],
    "a line alone is `implied`, which is the unknown, and never reported as a human requirement");
}

/* ===========================================================================
   THE SHIPPED SAMPLE, READ-ONLY. The research predicted this exact answer, and it
   is the case a demo would hit first.
   =========================================================================== */
{
  const samplePath = path.join(ROOT, "projects", "cinebraid-sample", "project.json");
  const bytes = fs.readFileSync(samplePath, "utf8");
  const P = JSON.parse(bytes);
  const feed = Readiness.evaluateProjectReadiness(P, {});

  equal(feed.authority.present, false, "the shipped sample has no authority ledger");
  equal(feed.authority.trusted, true, "which is not the same as an unreadable one");
  deepEqual(
    { ready: feed.counts.ready, blocked: feed.counts.blocked, needsDecision: feed.counts.needsDecision, complete: feed.counts.complete },
    { ready: 0, blocked: 0, needsDecision: 3, complete: 0 },
    "READY 0 · BLOCKED 0 · NEEDS A DECISION 3 — every reference in it is a Historic selection",
  );
  equal(feed.historic.occurrences, 9, "nine unconfirmed shot requirements");
  equal(feed.historic.uniqueTargets, 4, "which are four human confirmations");
  ok(feed.historic.items.every((row) => row.ownership.wouldRefuse === false), "and the shipped veto would permit every one");

  /* THE C0-2 CORRECTION IS IN, AND READINESS SEES IT. SAMPLE-03 asks for the open
     parcel; before the correction the intent sat under a legacy key nothing reads
     and every canonical consumer resolved the closed state. */
  const three = feed.shots.find((row) => row.shotId === "SAMPLE-03");
  ok(three.units[0].requirements.some((req) => req.targetKey === "entity-state:props:PROP-PARCEL#state-open"),
    "SAMPLE-03 resolves the OPEN parcel state");
  const one = feed.shots.find((row) => row.shotId === "SAMPLE-01");
  ok(one.units[0].requirements.some((req) => req.targetKey === "entity-state:props:PROP-PARCEL#state-closed"),
    "and SAMPLE-01 resolves the closed one");

  equal(fs.readFileSync(samplePath, "utf8"), bytes, "reading the shipped sample's readiness does not modify it");
}

/* ===========================================================================
   THE SERVER'S MEDIA ORACLE — CHEAP, NON-MUTATING, AND AGREEING WITH THE MAP IT
   HAD TO DUPLICATE.
   =========================================================================== */
{
  const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8").replace(/\r\n/g, "\n");

  /* EVERY COPY OF THE ENTITY MEDIA MAP MUST SAY THE SAME THING.

     server.js states it three times: the ENTITY_MEDIA_DIR constant the readiness
     oracle reads, a literal inside entityApprovedDiskPath() — which three suites
     lift into a sandbox and which therefore cannot reference a constant — and one
     that predates both. The count is not the property worth pinning; AGREEMENT is,
     so this asserts every occurrence is the identical map rather than fixing a
     number a future refactor would have to bump for no semantic reason. */
  const mentions = server.match(/characters: "anchors"[^}]*/g) || [];
  ok(mentions.length >= 2, "the entity media map appears more than once, so agreement is worth asserting");
  deepEqual([...new Set(mentions)], ['characters: "anchors", locations: "plates", props: "props", vehicles: "vehicles" '],
    "every copy of the entity media map is identical");

  /* THE ORACLE MUST NOT SYNC, ACTIVATE OR HASH. scanProject() copies files from a
     configured media root and schedules a MediaAsset activation pass; readiness is
     answered on every render of the production home view, and asking "what can I
     work on" must not move bytes around. */
  const start = server.indexOf("function readinessMediaOracle()");
  ok(start > 0, "the server declares a readiness media oracle");
  const body = server.slice(start, server.indexOf("\n}", start));
  for (const forbidden of ["scanProject", "syncConfiguredMediaRoot", "noteProjectActivity", "verifyNow", "hashMediaFile", "readFileSync"]) {
    ok(!body.includes(forbidden), `the readiness oracle must never call ${forbidden}`);
  }
  ok(body.includes("listMedia("), "it builds the listing from the shipped readdir helper");
  ok(body.includes("mediaIdentityIndex()"), "and pairs it with the ledger identity index, which is what makes the answer rename-proof");

  /* THE EXISTING ISSUE LIST IS UNCHANGED, and the new projection sits beside it. */
  ok(server.includes("issues: projectReadinessIssues(project),"), "the route still returns the existing issue list");
  ok(server.includes("readiness: shotReadinessProjection(project),"), "with the shot projection beside it, not instead of it");
  ok(server.includes("NON-AUTHORITATIVE BY CONSTRUCTION") && server.includes("a legacy project full of unreceipted pointers is not"),
    "and the deliberately pointer-based entity-reference issue keeps its documented meaning");
  ok(server.includes("addEntityIssue(\"entity-reference\""),
    "the existing entity-reference issue kind is still emitted, unchanged");
}

/* ===========================================================================
   BLOCKER 1 REGRESSION — ONE READINESS VERDICT, ON THE RENDERED SURFACE.

   The independent audit opened the live Production screen and saw, at the same
   moment, for the same unconfirmed reference:

       PROJECT READINESS  —  READY
       SHOT READINESS     —  NEEDS DECISION

   and the API answering `issues: []` beside `readiness.status: "NEEDS_DECISION"`.

   The legacy projection is not wrong about what it answers; it was wrong to be
   READABLE AS A READINESS VERDICT. This asserts the contradiction is gone from the
   rendered document and from the route's shape — not merely restyled, since a
   machine consumer reads neither the CSS nor the eyebrow.
   =========================================================================== */
async function renderedSurfaceSection() {
  const P = castProject({ shots: [castShot("SH-1")] });
  /* Everything the LEGACY projection asks about is present: canon text, a
     description, an explicit duration, resolved relationships, pointers on disk. So
     it has nothing to report. The pointers are still unconfirmed, so the canonical
     derivation says NEEDS_DECISION. This is the exact divergence the audit hit. */
  P.characters[0].block = "Kai, a courier in a soaked coat.";
  P.locations[0].block = "A cargo dock at night.";
  P.props[0].block = "A sealed cargo crate.";
  P.shots[0].desc = "Kai crosses the dock in the rain, hurrying.";
  P.shots[0].sec = 4;

  const feed = Readiness.evaluateProjectReadiness(P, oracleFor());
  equal(feed.shots[0].status, "NEEDS_DECISION", "precondition: the canonical derivation says a decision is needed");

  const rendered = await render("#/production", P, {
    scan: {
      anchors: [{ name: KAI_FILE, url: `/assets/anchors/${KAI_FILE}` }],
      plates: [{ name: DOCK_FILE, url: `/assets/plates/${DOCK_FILE}` }],
      props: [{ name: CRATE_FILE, url: `/assets/props/${CRATE_FILE}` }],
      vehicles: [], audio: [], media: [], shots: { "SH-1": { takes: [], locked: [] } },
    },
    /* The legacy list arrives EMPTY — the condition under which it used to render
       "Ready for production work" and the pill "READY". */
    fetch: (url, _options, response) =>
      (url === "/api/project/readiness"
        ? response({ checkedAt: "2026-08-16T10:00:00.000Z", setup: { answers: "project-setup-completeness", isReadinessVerdict: false, issues: [] } })
        : null),
  });
  const html = rendered.html;

  /* EXACTLY ONE THING ON THIS PAGE DECLARES READINESS. */
  equal((html.match(/data-readiness-verdict="1"/g) || []).length, 1, "exactly one readiness verdict block is rendered");
  equal((html.match(/data-project-setup="1"/g) || []).length, 1, "and exactly one setup block beside it");
  ok(html.includes("PRODUCTION READINESS"), "the verdict block is labelled as the readiness verdict");
  ok(html.includes("PROJECT SETUP"), "and the legacy block is labelled as setup");
  ok(!html.includes("PROJECT READINESS"), "the legacy block no longer calls itself readiness");

  /* AND THE EMPTY LEGACY LIST NO LONGER SAYS READY. */
  ok(!html.includes("Ready for production work"), "an empty setup list must not claim the project is ready for production");
  ok(!html.includes("NEEDS ATTENTION"), "nor render a rival attention verdict");
  const setupBlock = html.slice(html.indexOf('data-project-setup="1"'));
  ok(!/>READY</.test(setupBlock), "the word READY does not appear as a status anywhere in the setup block");
  ok(setupBlock.includes("No setup items found"), "it reports what it actually found");
  ok(setupBlock.includes("says nothing about whether a shot can be produced"),
    "and says plainly that it is not a readiness verdict");

  /* THE VERDICT ON THE PAGE IS THE CANONICAL ONE. */
  const verdictBlock = html.slice(html.indexOf('data-readiness-verdict="1"'), html.indexOf('data-project-setup="1"'));
  ok(verdictBlock.includes("NEEDS DECISION"), "the rendered verdict is the canonical NEEDS_DECISION");
  ok(verdictBlock.includes("Confirm existing reference"), "with the canonical next action beside it");
  ok(!/READY\s*·/.test(verdictBlock), "and nothing on the surface reads READY for this shot");

  /* THE MULTI-SHOT LEDGER FAN-OUT, ON THE RENDERED SURFACE. Three shots, one
     corrupt ledger, and the repair must be drawn once. */
  const corrupt = castProject({ shots: [castShot("SH-1"), castShot("SH-2"), castShot("SH-3")] });
  approveWholeCast(corrupt);
  corrupt.productionAuthority.version = 99;
  const corruptRender = await render("#/production", corrupt, {
    scan: {
      anchors: [{ name: KAI_FILE, url: `/assets/anchors/${KAI_FILE}` }],
      plates: [{ name: DOCK_FILE, url: `/assets/plates/${DOCK_FILE}` }],
      props: [{ name: CRATE_FILE, url: `/assets/props/${CRATE_FILE}` }],
      vehicles: [], audio: [], media: [],
      shots: { "SH-1": { takes: [], locked: [] }, "SH-2": { takes: [], locked: [] }, "SH-3": { takes: [], locked: [] } },
    },
    fetch: (url, _options, response) =>
      (url === "/api/project/readiness" ? response({ setup: { issues: [] } }) : null),
  });
  const corruptHtml = corruptRender.html;
  equal((corruptHtml.match(/data-readiness-truth-problem="authority-ledger-unreadable"/g) || []).length, 1,
    "one corrupt ledger renders ONE project-level truth problem, not one per shot");
  equal((corruptHtml.match(/Repair the approval records/g) || []).length, 1,
    "and the repair action is drawn exactly once for three shots");
  equal((corruptHtml.match(/readiness-needs_decision/g) || []).length, 3,
    "while each shot still reports that its own readiness cannot be answered");

  /* THE ROUTE'S SHAPE, ASSERTED AGAINST THE SHIPPED SOURCE. A machine consumer must
     not be able to read an all-clear out of the legacy projection. */
  const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8").replace(/\r\n/g, "\n");
  const route = server.slice(server.indexOf('app.get("/api/project/readiness"'), server.indexOf('app.put("/api/projects/:slug/project"'));
  ok(route.includes("readiness: shotReadinessProjection(project),"), "the route returns the canonical verdict");
  ok(route.includes("isReadinessVerdict: false,"), "and marks the legacy projection as not one, in the payload");
  ok(route.includes("issues: projectReadinessIssues(project),"), "the legacy rows are still served, unchanged");
  ok(!/\n      issues: projectReadinessIssues/.test(route),
    "but never as a top-level sibling of the verdict, where an empty array reads as an all-clear");
  ok(route.indexOf("setup: {") < route.indexOf("issues: projectReadinessIssues"),
    "they are nested inside the setup envelope");
}


/* ===========================================================================
   DECLARED ROUTE -> REQUIRED INPUTS -> CANONICAL READINESS
   =========================================================================== */
{
  const routeCases = {
    t2v: [],
    i2v: ["first-frame"],
    flf: ["first-frame", "last-frame"],
    r2v: ["reference"],
  };
  for (const [route, expected] of Object.entries(routeCases)) {
    deepEqual(Readiness.shotRouteInputNeeds(route).needs.slice(), expected,
      route + " requirements come from the canonical readiness owner");
  }

  const t2vShot = shot("SH-T2V-INTENT", {
    deliveryRoute: "t2v",
    keyframes: [{ id: "frame-a", label: "A", required: true }, { id: "frame-b", label: "B", required: true }],
    clips: [],
    creationBrief: {},
  });
  const t2vProject = project({ shots: [t2vShot] });
  const t2v = shotOf(t2vProject, t2vShot.id, oracleFor([], { [t2vShot.id]: [] }));
  deepEqual(t2v.units.filter((unit) => unit.kind === "frame").map((unit) => unit.required), [false, false],
    "description-only keeps existing frames but makes neither a required unit");
  equal(unitOf(t2v, "motion:shot").status, "READY", "description-only Motion is ready without frames");
  equal(t2v.nextAction.code, "produce-motion", "description-only projects Motion as the next work");

  const i2vShot = shot("SH-I2V-INTENT", {
    deliveryRoute: "i2v",
    keyframes: [{ id: "frame-a", label: "A", required: false }, { id: "frame-b", label: "B", required: true }],
    clips: [],
    creationBrief: {},
  });
  const i2vProject = project({ shots: [i2vShot] });
  const i2v = shotOf(i2vProject, i2vShot.id, oracleFor([], { [i2vShot.id]: [] }));
  deepEqual(i2v.units.filter((unit) => unit.kind === "frame").map((unit) => unit.required), [true, false],
    "first-frame intent requires its opening frame even when a stale authored flag says otherwise");
  equal(unitOf(i2v, "motion:shot").status, "BLOCKED", "first-frame Motion is blocked without opening-frame Canon");
  equal(unitOf(i2v, "motion:shot").nextAction.code, "approve-required-frames",
    "first-frame Motion names the canonical frame blocker");

  const flfShot = shot("SH-FLF-INTENT", {
    deliveryRoute: "flf",
    keyframes: [{ id: "frame-a", label: "A" }, { id: "frame-b", label: "B" }],
    clips: [],
    creationBrief: {},
  });
  const flfProject = project({ shots: [flfShot] });
  approveFrame(flfProject, flfShot.id, "frame-a", "A.png");
  const flf = shotOf(flfProject, flfShot.id, oracleFor([], { [flfShot.id]: [{ name: "A.png", url: "/shots/A.png" }] }));
  deepEqual(flf.units.filter((unit) => unit.kind === "frame").map((unit) => unit.required), [true, true],
    "first-plus-last intent requires both endpoints");
  equal(unitOf(flf, "motion:shot").status, "BLOCKED", "first-plus-last Motion stays blocked with only one endpoint");
  equal(unitOf(flf, "motion:shot").nextAction.count, 1, "the missing closing endpoint is represented exactly once");

  const r2vShot = shot("SH-R2V-INTENT", {
    deliveryRoute: "r2v",
    winner: "EXISTING-STILL.png",
    keyframes: [{ id: "frame-a", label: "A", winner: "EXISTING-STILL.png" }],
    clips: [],
    creationBrief: {},
  });
  const r2vProject = project({ shots: [r2vShot] });
  approveFrame(r2vProject, r2vShot.id, "frame-a", "EXISTING-STILL.png");
  const r2vOracle = oracleFor([], { [r2vShot.id]: [{ name: "EXISTING-STILL.png", url: "/shots/EXISTING-STILL.png" }] });
  const r2v = shotOf(r2vProject, r2vShot.id, r2vOracle);
  equal(r2v.status, "BLOCKED", "reference-driven readiness stays blocked despite enough still media to tempt Animate");
  equal(r2v.nextAction.code, "prepare-references", "the blocked shot projects the canonical reference action");
  equal(unitOf(r2v, "motion:shot").status, "BLOCKED", "the motion unit agrees with the shot rollup");
  ok(!unitOf(r2v, "motion:shot").admissible, "no forward motion method is exposed while its declared input is absent");

  const retained = {
    keyframes: JSON.stringify(r2vShot.keyframes),
    clips: JSON.stringify(r2vShot.clips),
    winner: r2vShot.winner,
  };
  Route.declareShotRoute(r2vShot, "t2v");
  equal(JSON.stringify(r2vShot.keyframes), retained.keyframes, "changing Shot Intent preserves frames and their authority pointers");
  equal(JSON.stringify(r2vShot.clips), retained.clips, "changing Shot Intent preserves motion units and generations");
  equal(r2vShot.winner, retained.winner, "changing Shot Intent preserves selected media");

  Route.declareShotRoute(r2vShot, "r2v");
  r2vShot.clips.push({ id: "shot", label: "Imported motion" });
  GESTURE.gesture(() => Kernel.approveMotionCanon(r2vProject, {
    shotId: r2vShot.id,
    unitKey: "shot",
    value: "IMPORTED-MOTION.mp4",
    assetId: "asset-imported-motion",
    at: AT,
    via: "readiness-suite",
  }));
  const manual = shotOf(r2vProject, r2vShot.id, oracleFor([], {
    [r2vShot.id]: [
      { name: "EXISTING-STILL.png", url: "/shots/EXISTING-STILL.png" },
      { name: "IMPORTED-MOTION.mp4", url: "/shots/IMPORTED-MOTION.mp4", assetId: "asset-imported-motion" },
    ],
  }));
  equal(unitOf(manual, "motion:shot").complete, true, "receipt-backed imported motion is accepted as existing production media");
  equal(manual.status, "COMPLETE", "manual-first approved motion satisfies the declared motion unit without generation");
}

renderedSurfaceSection().then(
  () => console.log(`shot-readiness: ${checks} assertions passed`),
  (error) => { console.error(error.stack || error.message || error); process.exit(1); },
);

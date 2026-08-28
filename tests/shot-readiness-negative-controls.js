/* Negative controls for tests/shot-readiness.js.
 *
 * A guarantee nobody has watched fail is a guarantee nobody has tested. Each
 * control below reintroduces one specific defect INTO AN IN-MEMORY COPY of
 * public/shared-shot-readiness.js and then proves the guarantee disappears with
 * it. Nothing on disk is written, so no control can be "restored" by a checkout
 * that also discards real work.
 *
 * Each control carries a PROBE RECEIPT: the mutation asserts the text it is
 * replacing was actually present, so a control cannot quietly become a no-op when
 * the source is refactored and start "passing" against nothing. That failure mode
 * is not hypothetical — the research pass this work follows found a named
 * expectation that had been green for an entire pass because its assertion never
 * touched the value the prose claimed.
 *
 * NO PROJECT DATA IS TOUCHED, NO PAID CALL AND NO PROVIDER CALL.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const READINESS_FILE = path.join(PUBLIC, "shared-shot-readiness.js");

const Kernel = require(path.join(PUBLIC, "shared-authority-kernel.js"));
const { render } = require("./render-harness.js");
const { installTestManualActionSource } = require("./authority-test-gesture.js");
const GESTURE = installTestManualActionSource(Kernel);
const AT = "2026-08-16T10:00:00.000Z";

/* core.autocrlf=true in this repository, so an anchor written with \n would match
   nothing on a fresh checkout and take the control's meaning with it. */
const SOURCE = fs.readFileSync(READINESS_FILE, "utf8").replace(/\r\n/g, "\n");

const notes = [];

function mutate(needle, replacement, label, expected = 1) {
  const hits = SOURCE.split(needle).length - 1;
  assert.strictEqual(hits, expected,
    `probe receipt: ${label} expected ${expected} occurrence(s) of its anchor, found ${hits}. `
    + "The control is no longer mutating the live path and must be rewritten.");
  return SOURCE.split(needle).join(replacement);
}

/* The mutated module, compiled in memory under its real filename so its own
   sibling `require`s resolve normally. The file on disk is opened read-only. */
function compile(source) {
  const compiled = new Module(READINESS_FILE, null);
  compiled.filename = READINESS_FILE;
  compiled.paths = Module._nodeModulePaths(path.dirname(READINESS_FILE));
  compiled._compile(source, READINESS_FILE);
  return compiled.exports;
}

function report(label, because, failure) {
  assert(failure, `NEGATIVE CONTROL DID NOT FIRE: ${label}. The guarantee is not actually being tested.`);
  assert(String(failure.message).includes(because),
    `NEGATIVE CONTROL FIRED FOR THE WRONG REASON: ${label}\n  expected a failure mentioning: ${because}\n  got: ${failure.message}`);
  notes.push(`  ${label} — failed as required`);
}
function mustFail(label, because, body) {
  let failure = null;
  try { body(); } catch (error) { failure = error; }
  report(label, because, failure);
}
/* The rendered-surface control needs a page, and rendering one is asynchronous. Kept
   separate rather than making every control async, so a sync control that forgets to
   throw still fails loudly instead of resolving. */
async function mustFailAsync(label, because, body) {
  let failure = null;
  try { await body(); } catch (error) { failure = error; }
  report(label, because, failure);
}
/* A mutation over arbitrary source text, with the same probe receipt as mutate().
   Used where the source being broken is not this module's own. */
function mutateIn(source, needle, replacement, label, expected = 1) {
  const hits = source.split(needle).length - 1;
  assert.strictEqual(hits, expected,
    `probe receipt: ${label} expected ${expected} occurrence(s) of its anchor in the target file, found ${hits}. `
    + "The control is no longer mutating the live path and must be rewritten.");
  return source.split(needle).join(replacement);
}

/* ---------------------------------------------------------------------------
   FIXTURES, kept deliberately small and separate from the focused suite's. A
   control that shared a builder with the suite it guards could be neutralised by
   an edit to that builder. */

const KAI_FILE = "CHAR-KAI.png";
function state(id, name, approvedFile, isDefault = false) {
  return { id, name, approvedFile, ...(isDefault ? { isDefault: true } : {}) };
}
function baseProject(extras = {}) {
  return {
    meta: { title: "Negative control" },
    scenes: [{ id: "SC-1", title: "Scene" }],
    characters: [{
      id: "CHAR-KAI", name: "Kai", prefix: "CHAR-KAI", approvedFile: KAI_FILE,
      /* Declared single references: since the sheet gate, an artifact whose kind
         nothing recorded cannot become an identity, and these controls are about
         readiness rather than about that refusal. */
      candidateFiles: [KAI_FILE, "CHAR-KAI-RAIN.png"].map((stored) => ({ stored, original: stored, decision: "unreviewed", coverageJobType: "single-reference" })),
      continuityStates: [state("state-default", "Default", KAI_FILE, true), state("state-rain", "Rain", "CHAR-KAI-RAIN.png")],
    }],
    locations: [], props: [], vehicles: [], audio: [], mediaAssets: [],
    shots: [{
      id: "SH-1", title: "SH-1", scene: "SC-1", characters: ["CHAR-KAI"], codes: [],
      keyframes: [{ id: "frame-a", label: "A", required: true }],
      /* The shot DECLARES a still delivery, because readiness no longer requires a
         frame of a shot that has declared nothing: `frame.required` is a default with
         no filmmaker-facing writer, and a default may not make a statement. Without a
         declaration every control below would compare NEEDS_DECISION with
         NEEDS_DECISION and report that it never fired. */
      creationBrief: { propIds: [], deliveryIntent: "still" },
    }],
    ...extras,
  };
}
const ORACLE = { mediaListing: () => [{ name: KAI_FILE, url: `/assets/${KAI_FILE}` }], shotMediaListing: () => [] };
const EMPTY_ORACLE = { mediaListing: () => [], shotMediaListing: () => [] };

function evaluate(model, P, oracle = ORACLE) {
  return model.evaluateShotReadiness(P, P.shots[0], oracle);
}
function approve(P, stateId = "state-default", value = KAI_FILE) {
  return GESTURE.gesture(() => Kernel.approveEntityStateCanon(P, {
    list: "characters", entityId: "CHAR-KAI", stateId, value, assetId: "", at: AT, via: "negative-control",
  }));
}

notes.push("Negative controls for shot readiness:");

/* ---------------------------------------------------------------------------
   C1 — DECIDE AUTHORITY FROM THE EDGE INSTEAD OF ASKING THE KERNEL.

   The single largest risk this module carries: if it ever reads the pointer to
   decide satisfaction it has become a second place authority is decided, and the
   whole receipt model is assumable again. */
mustFail("C1 satisfaction read from the live edge", "a pointer nobody approved must never be satisfied", () => {
  const broken = compile(mutate(
    "    const receipt = currentHumanAuthority(project, target);",
    "    const edge = KERNEL.liveAuthorityEdge(project, target);\n"
    + "    const receipt = edge.value ? { id: \"assumed\", value: edge.value, assetId: edge.assetId } : null;",
    "C1",
  ));
  const row = evaluate(broken, baseProject());
  assert.notStrictEqual(row.status, "READY", "a pointer nobody approved must never be satisfied");
});

/* ---------------------------------------------------------------------------
   C2 — ROUND HISTORIC UP TO SATISFIED.

   The load-bearing choice of the whole model. Rounding it up lets automation
   execute against media nobody approved. */
mustFail("C2 Historic rounded up to satisfied", "Historic is a decision, never satisfaction", () => {
  const broken = compile(mutate(
    "        state: \"needs-decision\",\n        reason: revoked ? \"authority-revoked-pointer-remains\" : \"historic-selection-unconfirmed\",",
    "        state: \"satisfied\",\n        reason: \"\",",
    "C2",
  ));
  const row = evaluate(broken, baseProject());
  assert.strictEqual(row.status, "NEEDS_DECISION", "Historic is a decision, never satisfaction");
});

/* ---------------------------------------------------------------------------
   C3 — TREAT AN APPROVAL WHOSE BYTES ARE GONE AS SATISFIED.

   READY must not be claimed because an approval points at a path the project no
   longer has. */
mustFail("C3 missing bytes ignored", "a listing that was consulted and did not hold the file is approved-bytes-missing", () => {
  const broken = compile(mutate(
    "      if (media.state === \"unavailable\") {",
    "      if (false) {",
    "C3",
  ));
  const P = baseProject();
  approve(P);
  const row = evaluate(broken, P, EMPTY_ORACLE);
  assert.notStrictEqual(row.status, "READY", "a receipt whose media is gone must not be READY");
  /* THE REASON IS THE PROPERTY HERE, NOT MERELY THE STATUS.
   *
   * When this control was written, disabling this branch produced a READY shot, so
   * "not READY" was enough to catch it. The unknown-media correction now also catches
   * the case, and the status alone can no longer tell the two apart — while the
   * difference is exactly what a filmmaker acts on: "we looked and it is gone,
   * supply it" against "nobody has looked yet". A control that could no longer
   * distinguish them had stopped testing what it was written for. */
  const requirement = row.units[0].requirements.find((item) => item.kind === "entity-state");
  assert.strictEqual(requirement.reason, "approved-bytes-missing",
    "a listing that was consulted and did not hold the file is approved-bytes-missing");
  assert.strictEqual(row.nextAction.code, "supply-approved-media", "with a supply action, never a check-it-first action");
});

/* ---------------------------------------------------------------------------
   C4 — FALL BACK TO THE DEFAULT STATE FOR A STATE THE ENTITY DOES NOT HAVE.

   This is the state-substitution defect, one layer up: the runtime resolver falls
   back so a renderer has something to draw, and readiness copying that behaviour
   would report a shot as ready to produce rain-soaked Kai from clean Kai's
   approval. */
mustFail("C4 unknown declared state silently defaulted", "a state the entity does not have must not resolve to the default", () => {
  const broken = compile(mutate(
    "      if (declaredId && !stateIdBelongsToEntityOwner(list(entity.continuityStates), declaredId)) {",
    "      if (false) {",
    "C4",
  ));
  const P = baseProject();
  P.shots[0].continuityStateSelections = { "CHAR-KAI": "state-does-not-exist" };
  approve(P);
  const row = evaluate(broken, P);
  assert.strictEqual(row.status, "NEEDS_DECISION", "a state the entity does not have must not resolve to the default");
});

/* ---------------------------------------------------------------------------
   C5 — READ AN UNPARSEABLE PRESENCE DECLARATION AS SILENCE.

   Absence of evidence read as evidence of absence — the exact reasoning that let a
   malformed declaration through a paid dispatch gate. */
mustFail("C5 malformed presence ignored", "an unreadable presence declaration must be a decision", () => {
  const broken = compile(mutate(
    "      if (status.malformed === true) {",
    "      if (false) {",
    "C5",
  ));
  const P = baseProject();
  P.shots[0].creationBrief.frameWorkflows = { "frame-a": { entityPresence: { "CHAR-KAI": { state: "absent" } } } };
  approve(P);
  const row = evaluate(broken, P);
  assert.strictEqual(row.status, "NEEDS_DECISION", "an unreadable presence declaration must be a decision");
});

/* ---------------------------------------------------------------------------
   C6 — LET BLOCKED OUTRANK NEEDS_DECISION.

   Preparing a missing thing while a decision is outstanding is work performed
   against a target CineBraid cannot state. */
mustFail("C6 precedence inverted", "NEEDS_DECISION outranks BLOCKED", () => {
  const broken = compile(mutate(
    "    const status = counts.needsDecision ? \"NEEDS_DECISION\"\n      : counts.missing ? \"BLOCKED\"",
    "    const status = counts.missing ? \"BLOCKED\"\n      : counts.needsDecision ? \"NEEDS_DECISION\"",
    "C6",
  ));
  const P = baseProject();
  /* One unconfirmed pointer (Kai) and one genuinely absent reference (a prop). */
  P.props = [{ id: "PROP-X", name: "Prop", prefix: "PROP-X", approvedFile: "", continuityStates: [state("state-default", "Default", "", true)] }];
  P.shots[0].creationBrief.propIds = ["PROP-X"];
  const row = evaluate(broken, P);
  assert.strictEqual(row.status, "NEEDS_DECISION", "NEEDS_DECISION outranks BLOCKED");
});

/* ---------------------------------------------------------------------------
   C7 — REPORT ONLY THE OPERATIONAL METHOD.

   THIS IS THE FIXTURE F FAILURE ITSELF. The shipped resolver returns one mode for
   animate-shot, and presenting that alone claims CineBraid proved one method
   uniquely superior when all it did was apply a deterministic tie-break. On the H3
   adapter the difference is material — i2v/flf refuse every non-endpoint reference
   while r2v sends them. */
mustFail("C7 alternatives hidden behind the tie-break", "the other genuinely admissible methods must be named", () => {
  const broken = compile(mutate(
    "    const alsoAdmissible = [...new Set(reachable.map((row) => row.method))].filter((method) => method && method !== admissible);",
    "    const alsoAdmissible = [];",
    "C7",
  ));
  const P = baseProject();
  P.shots[0].clips = [{ id: "clip-1", kind: "r2v" }];
  approve(P);
  const unit = evaluate(broken, P).units.find((row) => row.id === "motion:clip-1");
  assert.deepStrictEqual(unit.alsoAdmissible.slice(), ["t2v"], "the other genuinely admissible methods must be named");
});

/* ---------------------------------------------------------------------------
   C8 — CALL A MISSING INPUT `unsupported`.

   An absent input is a fact about the production that producing the input fixes.
   `unsupported` says the method is refused, which is a different sentence and sends
   a filmmaker looking for a different model. */
mustFail("C8 missing prerequisite renamed unsupported", "an absent input is missing-prerequisite", () => {
  const broken = compile(mutate(
    "          reason: \"missing-prerequisite\",",
    "          reason: \"unsupported\",",
    "C8",
  ));
  const P = baseProject();
  P.shots[0].clips = [{ id: "clip-1", kind: "r2v" }];
  approve(P);
  const unit = evaluate(broken, P).units.find((row) => row.id === "motion:clip-1");
  assert.ok(!JSON.stringify(unit).includes("unsupported"), "an absent input is missing-prerequisite");
});

/* ---------------------------------------------------------------------------
   C9 — DEDUPLICATE THE CONFIRMATION QUEUE BY FILENAME.

   A filename is not an identity. Two states of one entity that happen to share a
   file would collapse into one row, which is the state-substitution defect in a
   queue — and the reasoning repairCanonValue() was scoped away from after a global
   filename rewrite moved an entity's Canon onto bytes nobody approved. */
mustFail("C9 queue keyed by filename", "two authority targets are two decisions", () => {
  const broken = compile(mutate(
    "        const existing = byKey.get(requirement.targetKey);",
    "        const existing = [...byKey.values()].find((row) => row.value === requirement.value);",
    "C9",
  ));
  const P = baseProject();
  /* Two states, one shared file — legal, and two separate decisions. */
  P.characters[0].continuityStates[1].approvedFile = KAI_FILE;
  P.shots.push({
    id: "SH-2", title: "SH-2", scene: "SC-1", characters: ["CHAR-KAI"], codes: [],
    keyframes: [{ id: "frame-a", label: "A", required: true }],
    creationBrief: { propIds: [] }, continuityStateSelections: { "CHAR-KAI": "state-rain" },
  });
  const queue = broken.historicConfirmationQueue(P, ORACLE);
  assert.strictEqual(queue.uniqueTargets, 2, "two authority targets are two decisions");
});

/* ---------------------------------------------------------------------------
   C10 — EXPAND AN UNREADABLE LEDGER INTO PER-UNIT BLOCKERS.

   A lie of aggregation: it would send a filmmaker to prepare references that are
   already approved, and it would do it once per shot. */
mustFail("C10 unreadable ledger reported as N missing references", "an unreadable ledger is one problem, not N blockers", () => {
  /* The anchor moved when the truth problem was hoisted into one project-level
     derivation, and this control's probe receipt is what said so rather than letting
     it pass against nothing. */
  const broken = compile(mutate(
    "    if (ledger.trusted !== false) return null;",
    "    return null;",
    "C10",
  ));
  const P = baseProject();
  approve(P);
  P.productionAuthority.version = 99;
  const row = evaluate(broken, P);
  assert.strictEqual(row.units.length, 0, "an unreadable ledger is one problem, not N blockers");
});

/* ---------------------------------------------------------------------------
   C11 — READ THE FILESYSTEM TO SETTLE MEDIA PRESENCE.

   Readiness runs on every render, and a project in OneDrive/Dropbox/Drive
   downloads a file when it is read. This control proves the source assertion that
   forbids it is a real check and not a comment. */
mustFail("C11 filesystem reached for media presence", "readiness must never touch the filesystem", () => {
  const broken = mutate(
    "    if (typeof it.fileExists === \"function\") {",
    "    if (require(\"fs\").existsSync(file)) return { state: \"available\", mediaCheck: \"file-name-only\" };\n"
    + "    if (typeof it.fileExists === \"function\") {",
    "C11",
  );
  for (const forbidden of ["require(\"fs\")", "existsSync", "readFileSync", "hashMediaFile", "verifyNow"]) {
    assert.ok(!broken.includes(forbidden), "readiness must never touch the filesystem");
  }
});

/* ---------------------------------------------------------------------------
   C12 — MUTATE THE PROJECT WHILE DERIVING.

   Normalising a legacy document merely by asking whether it is ready is how a read
   becomes a write nobody asked for. */
mustFail("C12 derivation mutates the project", "readiness must not modify the project", () => {
  const broken = compile(mutate(
    "  function buildContext(project, shot, options, projectTruth) {",
    "  function buildContext(project, shot, options, projectTruth) {\n    shot.readinessTouched = true;",
    "C12",
  ));
  const P = baseProject();
  const before = JSON.stringify(P);
  evaluate(broken, P);
  assert.strictEqual(JSON.stringify(P), before, "readiness must not modify the project");
});

/* ---------------------------------------------------------------------------
   C13 — LET AN UNREQUIRED FRAME BLOCK MOTION.

   An optional endpoint that blocks the work is the difference between "you may
   approve this" and "you must". */
mustFail("C13 optional frame treated as required", "an unrequired frame must not block motion", () => {
  const broken = compile(mutate(
    "        requirements.push(frame.required || row.state === \"satisfied\"\n          ? row\n          : deepFreeze({ ...row, state: \"optional\", required: false, reason: \"\", unlocks: unlockedByFrame(frames, frame) }));",
    "        requirements.push(row);",
    "C13",
  ));
  const P = baseProject();
  P.shots[0].keyframes = [{ id: "frame-a", label: "A", required: true }, { id: "frame-b", label: "B", required: false }];
  P.shots[0].clips = [{ id: "clip-1", kind: "i2v" }];
  approve(P);
  GESTURE.gesture(() => Kernel.approveFrameCanon(P, { shotId: "SH-1", frameId: "frame-a", value: "A.png", assetId: "", at: AT, via: "negative-control" }));
  const unit = evaluate(broken, P, { mediaListing: () => [{ name: KAI_FILE }], shotMediaListing: () => [{ name: "A.png" }] })
    .units.find((row) => row.id === "motion:clip-1");
  assert.strictEqual(unit.status, "READY", "an unrequired frame must not block motion");
});

/* ---------------------------------------------------------------------------
   C14 — MANUFACTURE A MOTION UNIT FOR A STILL SHOT.

   Inventing a unit the shot never declared makes readiness report work the
   filmmaker did not ask for, and makes a finished still shot permanently unready. */
mustFail("C14 motion unit manufactured", "no motion unit is manufactured for a still shot", () => {
  const broken = compile(mutate(
    "    if (!clips.length && (MOTION_INTENTS.includes(text(creation.deliveryIntent)) || routeNeeds.known)) {",
    "    if (!clips.length) {",
    "C14",
  ));
  const P = baseProject();
  P.shots[0].creationBrief.deliveryIntent = "still";
  approve(P);
  assert.deepStrictEqual(evaluate(broken, P).units.map((row) => row.id), ["frame:frame-a"],
    "no motion unit is manufactured for a still shot");
});

/* ---------------------------------------------------------------------------
   C15 — READ ONLY ONE deliveryIntent DIALECT.

   Current source writes "motion" from the composer and "video" from the kernel's
   delivery approval. A reader that knew only one would silently drop the motion
   unit of every shot the other writer touched — a reader surviving while its
   writer moved, which is a defect shape this repository has seen before. */
mustFail("C15 only one deliveryIntent spelling read", "both deliveryIntent dialects declare a motion unit", () => {
  const broken = compile(mutate(
    "  const MOTION_INTENTS = deepFreeze([\"motion\", \"video\"]);",
    "  const MOTION_INTENTS = deepFreeze([\"motion\"]);",
    "C15",
  ));
  const P = baseProject();
  P.shots[0].creationBrief.deliveryIntent = "video";
  approve(P);
  assert.ok(evaluate(broken, P).units.some((row) => row.id === "motion:shot"),
    "both deliveryIntent dialects declare a motion unit");
});

/* ---------------------------------------------------------------------------
   C16 — REVERT THE UNKNOWN-MEDIA FIX.

   The shape the acceptance audit reproduced: reject only `unavailable`, and let
   "nobody looked" fall through to satisfied. This control is the audit's own call,
   so if the fix is ever loosened again the same failure comes back visibly. */
mustFail("C16 unknown media promoted to satisfied", "unknown media availability must never be satisfied", () => {
  const broken = compile(mutate(
    "      if (media.state !== \"available\") {",
    "      if (media.state === \"unavailable\") {",
    "C16",
  ));
  const P = baseProject();
  approve(P);
  const row = broken.productionInputSatisfaction(P, {
    id: "probe", kind: "entity-state", label: "Kai",
    target: { kind: "entity-state", list: "characters", entityId: "CHAR-KAI", stateId: "state-default" },
  }, {});
  assert.notStrictEqual(row.state, "satisfied", "unknown media availability must never be satisfied");
  assert.notStrictEqual(broken.evaluateShotReadiness(P, P.shots[0], {}).status, "READY",
    "unknown media availability must never be READY");
});

/* ---------------------------------------------------------------------------
   C17 — REVERT THE LEDGER FAN-OUT FIX, AT THREE SHOTS.

   The reviewed implementation returned the repair from every shot. The existing C10
   has one shot and cannot see it; this one has three and counts occurrences in the
   whole payload. */
mustFail("C17 ledger repair fanned out per shot", "the repair action appears exactly once", () => {
  const broken = compile(mutate(
    "      nextAction: action(\"awaiting-project-repair\", \"This shot's readiness cannot be answered until the project's approval records are repaired.\", 0),",
    "      nextAction: action(\"repair-authority-ledger\", context.truthProblem.message, 1),",
    "C17",
  ));
  const P = baseProject();
  approve(P);
  for (const id of ["SH-2", "SH-3"]) {
    P.shots.push({ id, title: id, scene: "SC-1", characters: ["CHAR-KAI"], codes: [],
      keyframes: [{ id: "frame-a", label: "A", required: true }], creationBrief: { propIds: [] } });
  }
  P.productionAuthority.version = 99;
  const feed = broken.evaluateProjectReadiness(P, ORACLE);
  assert.strictEqual(feed.shots.length, 3, "the fixture must have three shots or it cannot detect fan-out");
  const occurrences = (JSON.stringify(feed).match(/repair-authority-ledger/g) || []).length;
  assert.strictEqual(occurrences, 1, "the repair action appears exactly once");
});

/* ---------------------------------------------------------------------------
   C18 — DROP THE PROJECT-LEVEL REPAIR ACTION.

   Moving the repair off the shots is only half the fix. If the project does not
   carry it, one corrupt ledger surfaces ZERO repair actions and the human is told
   nothing is wrong with anything except three unanswerable shots. */
mustFail("C18 project-level repair action removed", "the project carries the repair action", () => {
  const broken = compile(mutate(
    "      nextAction: truthProblem ? action(\"repair-authority-ledger\", truthProblem.message, 1) : null,",
    "      nextAction: null,",
    "C18",
  ));
  const P = baseProject();
  approve(P);
  P.productionAuthority.version = 99;
  const feed = broken.evaluateProjectReadiness(P, ORACLE);
  assert.ok(feed.nextAction && feed.nextAction.code === "repair-authority-ledger",
    "the project carries the repair action");
});

/* ---------------------------------------------------------------------------
   C19 — THE LEGACY PROJECTION CLAIMS READINESS AGAIN, ON THE RENDERED SURFACE.

   The audit's first blocker, reintroduced through the render harness's in-memory
   mutation hook: give the setup block back its READY pill and its
   "Ready for production work" headline, and require the rendered document to be
   caught contradicting the canonical verdict.

   This control is why the Blocker 1 regression is not a CSS assertion. */
const C19 = () => mustFailAsync("C19 legacy projection renders a rival READY verdict", "must not claim the project is ready", async () => {
  const P = baseProject();
  P.characters[0].block = "Kai, a courier.";
  P.shots[0].desc = "Kai crosses the dock in the rain, hurrying.";
  P.shots[0].sec = 4;
  const rendered = await render("#/production", P, {
    scan: {
      anchors: [{ name: KAI_FILE, url: `/assets/anchors/${KAI_FILE}` }],
      plates: [], props: [], vehicles: [], audio: [], media: [],
      shots: { "SH-1": { takes: [], locked: [] } },
    },
    fetch: (url, _options, response) =>
      (url === "/api/project/readiness" ? response({ setup: { issues: [] } }) : null),
    mutateSource: (file, contents) => {
      if (file !== "app.js") return contents;
      return mutateIn(
        String(contents).replace(/\r\n/g, "\n"),
        '<b>${issues.length ? `${plural(issues.length, "setup item")} to resolve` : "No setup items found"}</b></div><span>${issues.length} ITEM${issues.length === 1 ? "" : "S"}</span>',
        '<b>${issues.length ? `${plural(issues.length, "item")} to resolve` : "Ready for production work"}</b></div><span>${issues.length ? "NEEDS ATTENTION" : "READY"}</span>',
        "C19",
      );
    },
  });
  assert.ok(!rendered.html.includes("Ready for production work"),
    "an empty setup list must not claim the project is ready for production");
});

C19().then(
  () => {
    console.log(notes.join("\n"));
    console.log(`shot-readiness-negative-controls: ${notes.length - 1} controls fired`);
  },
  (error) => { console.error(error.stack || error.message || error); process.exit(1); },
);

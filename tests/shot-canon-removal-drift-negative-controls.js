/* CineBraid — SHOT CANON REMOVAL DRIFT: NEGATIVE / REVERT CONTROLS.
 *
 * tests/shot-canon-removal-drift.js proves the corrected removal path. This file proves
 * that suite is LOAD-BEARING, by restoring each way the path can go wrong — including the
 * exact drift hole that shipped — and showing the harm is real, durable and refused by the
 * shipped Authority Write Seam.
 *
 * A control here does not assert that an assertion fails. It reproduces the UNSAFE
 * BEHAVIOUR against the shipped confirmation control, inside a real trusted gesture, and
 * then asks the real seam whether the resulting document can be stored. Every control is
 * named beside the assertion in the main suite it would turn red.
 *
 * NC-SCR-0  every anchor these controls use resolves exactly once, each mutation really
 *           changes the source, and BROKEN / NOT ARMED / MISSED all still throw.
 * NC-SCR-1  THE SHIPPED HOLE, RESTORED: an unwithdrawable receipt is silently skipped.
 * NC-SCR-2  the plan's membership is decided from Canon-shaped state instead of from the
 *           receipt row, so a drifted row never enters the plan at all.
 * NC-SCR-3  removal happens before revocation.
 * NC-SCR-4  scene deletion withdraws and records one shot at a time, so a later shot's
 *           unwithdrawable receipt is discovered after a sibling has already been changed.
 * NC-SCR-5  the other direction: the target-existence gate is dropped, so a receipt the
 *           seam does not care about refuses a legitimate deletion and sends the filmmaker
 *           to re-approve something that is not there.
 */

const assert = require("assert");
const crypto = require("crypto");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

const { Kernel } = require("./authority-kernel-private");
const { render, rawFixture, withCanon } = require("./render-harness.js");
const seam = require(path.join(ROOT, "authority-write-seam"));

const NEWLINE = /\r\n|\r|\n/g;
const normalizeNewlines = (text) => String(text).replace(NEWLINE, "\n");
const clone = (value) => JSON.parse(JSON.stringify(value));
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const passed = [];
const pass = (id, line) => { passed.push(id); console.log(`[${id}] PASS — ${line}`); };
function evaluate(context, body) {
  return vm.runInContext(`(() => { ${body} })()`, context);
}

function persist(project, successor, writeClass = seam.WRITE_CLASSES.NORMAL_SAVE, transition = {}) {
  let stored = clone(project);
  let writes = 0;
  const revision = () => JSON.stringify(crypto.createHash("sha256").update(JSON.stringify(stored)).digest("hex"));
  const boundary = seam.createAuthorityWriteSeam({
    resolveFile: () => "project.json",
    exists: () => true,
    readProject: () => clone(stored),
    revisionFor: revision,
    validateProject: () => ({ ok: true, errors: [] }),
    writeProject: (_file, next) => { stored = clone(next); writes += 1; },
  });
  const outcome = boundary.persistProjectSuccessor({
    slug: "p", successor, writeClass, expectedRevision: revision(), transitionMetadata: transition,
  });
  return { outcome, writes, stored, code: (outcome.refusal && outcome.refusal.code) || "" };
}
function declarationFor(before, after) {
  const declaration = Kernel.authorityWriteTransition(before, after).declaration;
  return { targetKeys: declaration.targetKeys, receiptIds: declaration.receiptIds, transitionKind: declaration.transitionKind };
}

/* ===========================================================================
   EVERY MUTATION THESE CONTROLS MAKE, IN ONE PLACE.
   =========================================================================== */

const EDITS = {
  /* NC-SCR-1 — THE SHIPPED HOLE. A target whose receipt row is current but which no
     kernel command can withdraw is dropped on the floor instead of blocking the removal.
     This is exactly what the pre-slice code did, expressed as one deleted line. */
  "NC-SCR-1": [{
    label: "unwithdrawable receipt silently skipped",
    file: "mutations.js",
    from: "      if (shotCanonRevoker(target.kind) && hasCurrentHumanAuthority(P, target)) withdraw.push(entry);\n      else blocked.push(entry);",
    to: "      if (shotCanonRevoker(target.kind) && hasCurrentHumanAuthority(P, target)) withdraw.push(entry);",
  }],

  /* NC-SCR-2 — MEMBERSHIP DECIDED FROM CANON-SHAPED STATE. The row scan keeps only rows
     that read as current Canon, so a drifted row never enters the plan at all — the same
     harm as NC-SCR-1 arriving one step earlier, and the shape the shipped code had. */
  "NC-SCR-2": [{
    label: "rows filtered by Canon state instead of by status",
    file: "mutations.js",
    from: '    if (!row || String(row.status) !== "current") continue;\n    const target = authorityTarget(row);',
    to: '    if (!row || String(row.status) !== "current") continue;\n    const target = authorityTarget(row);\n    if (target && !hasCurrentHumanAuthority(P, target)) continue;',
  }],

  /* NC-SCR-3 — REMOVAL BEFORE REVOCATION. The shot leaves the document first, so the
     kernel is then asked to withdraw a receipt whose target no longer exists. */
  "NC-SCR-3": [{
    label: "shot removed before its receipts are withdrawn",
    file: "mutations.js",
    from: [
      "      try { revokeShotCanonForRemoval(plan); } catch (error) {",
      "        return refuse(",
      '          `Shot ${id} was not deleted: ${error.message || "an approval record could not be withdrawn"} Nothing was changed.`,',
      '          error.code || "AUTHORITY_RECEIPT_NOT_WITHDRAWABLE",',
      "        );",
      "      }",
      '      deletedTargetRecord("shot", id, { scene: target.scene, mediaRetained: true, takeCount: takes.length });',
      "      P.shots = P.shots.filter((s) => s.id !== id);",
    ].join("\n"),
    to: [
      "      P.shots = P.shots.filter((s) => s.id !== id);",
      "      try { revokeShotCanonForRemoval(plan); } catch (error) {",
      "        return refuse(",
      '          `Shot ${id} was not deleted: ${error.message || "an approval record could not be withdrawn"} Nothing was changed.`,',
      '          error.code || "AUTHORITY_RECEIPT_NOT_WITHDRAWABLE",',
      "        );",
      "      }",
      '      deletedTargetRecord("shot", id, { scene: target.scene, mediaRetained: true, takeCount: takes.length });',
    ].join("\n"),
  }],

  /* NC-SCR-4 — SCENE DELETION, ONE SHOT AT A TIME. The pre-slice shape: plan, withdraw and
     record each shot in turn, so a later shot's unwithdrawable receipt is only discovered
     once earlier siblings have already been changed. */
  "NC-SCR-4": [{
    label: "scene deletion acts per shot instead of planning the whole scene",
    file: "mutations.js",
    from: "      const plan = planShotCanonWithdrawal(sceneShots);\n      if (plan.blocked.length) {",
    to: [
      "      const plan = { withdraw: [], blocked: [] };",
      "      for (const one of sceneShots) {",
      "        const step = planShotCanonWithdrawal([one]);",
      "        if (step.blocked.length) { plan.blocked.push(...step.blocked); break; }",
      "        revokeShotCanonForRemoval(step);",
      '        deletedTargetRecord("shot", one.id, { scene: id, mediaRetained: true });',
      "      }",
      "      if (plan.blocked.length) {",
    ].join("\n"),
  }],

  /* NC-SCR-5 — THE OTHER DIRECTION. Without the target-existence gate the plan blocks on a
     current row whose target had ALREADY gone: a receipt the write seam never accounts for,
     because targetRemovalDisposition() only considers targets that exist before and not
     after. Refusing there costs the filmmaker a deletion the seam would have accepted and
     asks them to re-approve a frame that is not in the shot. */
  "NC-SCR-5": [{
    label: "target-existence gate dropped",
    file: "mutations.js",
    from: "      if (!authorityTargetExists(P, target)) continue;\n      const entry = { shot, shotId: String(shot.id), target };",
    to: "      const entry = { shot, shotId: String(shot.id), target };",
  }],
};

function mutator(edits) {
  const applied = new Map(edits.map((edit) => [edit.label, 0]));
  const targets = new Set(edits.map((edit) => edit.file));
  return {
    applied,
    verify() {
      for (const [label, count] of applied)
        assert.strictEqual(count, 1, `the control did not apply its mutation "${label}" — it ran against the shipped code`);
    },
    fn(file, source) {
      /* A file this control does not touch keeps its bytes exactly as the checkout has
         them. Only what is being mutated is normalised, and only so it can be found. */
      if (!targets.has(file)) return source;
      let out = normalizeNewlines(source);
      for (const edit of edits) {
        if (edit.file !== file) continue;
        const from = normalizeNewlines(edit.from), to = normalizeNewlines(edit.to);
        const occurrences = out.split(from).length - 1;
        assert.strictEqual(occurrences, 1, `"${edit.label}" must match exactly once in ${file}, found ${occurrences}`);
        const before = out;
        out = out.replace(from, to);
        assert.notStrictEqual(out, before, `"${edit.label}" matched but changed nothing — the control is not armed`);
        applied.set(edit.label, applied.get(edit.label) + 1);
      }
      return out;
    },
  };
}

/* ===========================================================================
   THE SAME FIXTURES THE MAIN SUITE USES.
   =========================================================================== */

const SHOT = "L1-01";
const SIBLING = "L1-02";
const SCENE = "SC-01";

function addSiblingShot(project) {
  const source = project.shots[0];
  const sibling = clone(source);
  sibling.id = SIBLING;
  sibling.title = "Panel close";
  sibling.keyframes = [{ ...clone(source.keyframes[0]), id: "frame-c", label: "C", title: "Close frame", winner: "FRAME_C.png" }];
  sibling.clips = [];
  delete sibling.finalStillFile;
  project.shots.push(sibling);
  return sibling;
}
function canonShot(project, shotId = SHOT) {
  const shot = project.shots.find((row) => row.id === shotId);
  shot.clips[0].videoWinner = "MOTION_A.mp4";
  shot.finalStillFile = "DELIVERY.png";
  withCanon(project, [
    { kind: "shot-frame", shotId, frameId: shot.keyframes[0].id, value: shot.keyframes[0].winner },
    { kind: "shot-motion", shotId, unitKey: shot.clips[0].id, value: "MOTION_A.mp4" },
    { kind: "shot-delivery", shotId, value: "DELIVERY.png" },
  ]);
  return shot;
}
function driftedShotProject() {
  const project = rawFixture();
  const shot = canonShot(project);
  shot.keyframes[0].winner = "FRAME_A-RENAMED.png";
  assert.strictEqual(Kernel.hasCurrentHumanAuthority(project, { kind: "shot-frame", shotId: SHOT, frameId: "frame-a" }), false,
    "fixture: the drifted receipt must no longer match the live edge");
  return project;
}
function receipts(project) {
  return [...((project.productionAuthority || {}).receipts || [])];
}
function currentKeys(project) {
  return receipts(project).filter((row) => row.status === "current").map((row) => row.targetKey).sort();
}

async function pressThrough(page, open, confirmId) {
  evaluate(page.context, open);
  await tick();
  page.gesture.act(() => evaluate(page.context, `document.getElementById(${JSON.stringify(confirmId)}).onclick(); return 1;`));
  await tick();
  await tick();
  /* Read back through JSON, so what this file asserts on is a Node-realm value. An
     object built inside the vm carries the vm's own Array.prototype, and
     assert.deepStrictEqual compares prototypes — a comparison that would fail on
     values that are in fact identical. */
  return JSON.parse(evaluate(page.context, `
    return JSON.stringify({
      shotIds: (P.shots || []).map((row) => row.id),
      sceneIds: (P.scenes || []).map((row) => row.id),
      deletedTargets: ((P.meta || {}).deletedTargets || []).map((row) => row.type + ":" + row.id),
      after: P,
    });
  `));
}

/* Both refusals a stranded document earns from the shipped seam, asked for real. */
function strandedBy(before, after) {
  const normal = persist(before, after);
  const transition = persist(before, after, seam.WRITE_CLASSES.CANON_TRANSITION, declarationFor(before, after));
  return { normal, transition };
}

/* ===========================================================================
   NC-SCR-0 — THE CONTROLS THEMSELVES ARE HONEST.
   =========================================================================== */

async function ncscr0() {
  const shipped = { "mutations.js": require("fs").readFileSync(path.join(ROOT, "public", "mutations.js"), "utf8") };
  for (const [id, edits] of Object.entries(EDITS)) {
    const control = mutator(edits);
    for (const edit of edits) {
      const source = shipped[edit.file];
      assert.ok(source, `${id}: this control targets ${edit.file}, which is not read here`);
      const crlf = normalizeNewlines(source).replace(/\n/g, "\r\n");
      const lf = normalizeNewlines(source);
      const fromCrlf = mutator(edits).fn(edit.file, crlf);
      const fromLf = control.fn(edit.file, lf);
      assert.strictEqual(fromCrlf, fromLf, `${id}: the mutated source must be identical from CRLF and LF input`);
      assert.notStrictEqual(fromLf, lf, `${id}: the mutation must actually change the source`);
    }
    control.verify();
  }

  const anySource = shipped["mutations.js"];
  assert.throws(
    () => mutator([{ label: "absent", file: "mutations.js", from: "this text is not in mutations.js at all", to: "x" }]).fn("mutations.js", anySource),
    /must match exactly once in mutations\.js, found 0/,
    "BROKEN: an anchor that matches nothing must fail loudly",
  );
  assert.throws(
    () => mutator([{ label: "ambiguous", file: "mutations.js", from: "function ", to: "function " }]).fn("mutations.js", anySource),
    /must match exactly once in mutations\.js, found (?:[2-9]|\d\d+)/,
    "BROKEN: an anchor that matches more than once must fail loudly",
  );
  assert.throws(
    () => mutator([{ label: "inert", file: "mutations.js", from: "function planShotCanonWithdrawal", to: "function planShotCanonWithdrawal" }]).fn("mutations.js", anySource),
    /matched but changed nothing — the control is not armed/,
    "NOT ARMED: an anchor whose replacement is the same text must fail loudly",
  );
  const missed = mutator(EDITS["NC-SCR-1"]);
  assert.throws(() => missed.verify(), /did not apply its mutation/, "MISSED: an edit whose file never came past must fail loudly");

  /* A file no control targets is handed back byte for byte. */
  assert.strictEqual(mutator(EDITS["NC-SCR-1"]).fn("views.js", "untouched\r\nsource\r\n"), "untouched\r\nsource\r\n",
    "a file with no edits must be returned exactly as the checkout has it");

  pass("NC-SCR-0", "every anchor resolves exactly once, each control really changes mutations.js identically from CRLF and LF, and BROKEN / NOT ARMED / MISSED all throw");
}

/* ===========================================================================
   NC-SCR-1 — THE SHIPPED HOLE, RESTORED.
   Turns red: shot-canon-removal-drift.js S3 "the shot is NOT removed".
   =========================================================================== */

async function ncscr1() {
  const control = mutator(EDITS["NC-SCR-1"]);
  const project = driftedShotProject();
  const page = await render(`#/shot/${SHOT}`, project, { mutateSource: control.fn });
  control.verify();
  const seen = await pressThrough(page, `delShot(${JSON.stringify(SHOT)}); return 1;`, "delete-shot-confirm");

  assert.strictEqual(seen.shotIds.includes(SHOT), false,
    "the control must reproduce the real defect: the drifted shot is deleted anyway");
  assert.deepStrictEqual(currentKeys(seen.after), [`shot-frame:${SHOT}#frame-a`],
    "and its unwithdrawable receipt is left `current`, naming a shot that no longer exists");

  const { normal, transition } = strandedBy(project, seen.after);
  assert.strictEqual(normal.outcome.ok, false, "the resulting document cannot be saved normally");
  assert.strictEqual(normal.code, "CANON_TRANSITION_REQUIRED", `expected CANON_TRANSITION_REQUIRED, got ${normal.code}`);
  assert.strictEqual(transition.outcome.ok, false, "and the Canon transition is refused too");
  assert.strictEqual(transition.code, "AUTHORITY_EDGE_RECEIPT_MISMATCH", `expected AUTHORITY_EDGE_RECEIPT_MISMATCH, got ${transition.code}`);
  pass("NC-SCR-1", "restoring the shipped hole deletes a shot whose receipt cannot be withdrawn and strands the document under BOTH write classes");
}

/* ===========================================================================
   NC-SCR-2 — MEMBERSHIP DECIDED FROM CANON-SHAPED STATE.
   Turns red: shot-canon-removal-drift.js S3 "the shot is NOT removed".
   =========================================================================== */

async function ncscr2() {
  const control = mutator(EDITS["NC-SCR-2"]);
  const project = driftedShotProject();
  const page = await render(`#/shot/${SHOT}`, project, { mutateSource: control.fn });
  control.verify();
  const seen = await pressThrough(page, `delShot(${JSON.stringify(SHOT)}); return 1;`, "delete-shot-confirm");

  assert.strictEqual(seen.shotIds.includes(SHOT), false,
    "the control must reproduce the real defect: a row that does not read as Canon never enters the plan, so the shot is deleted");
  assert.deepStrictEqual(currentKeys(seen.after), [`shot-frame:${SHOT}#frame-a`],
    "and the drifted receipt is left `current`, naming a shot that no longer exists");
  const { normal, transition } = strandedBy(project, seen.after);
  assert.strictEqual(normal.outcome.ok, false, "so the document cannot be saved normally");
  assert.strictEqual(normal.code, "CANON_TRANSITION_REQUIRED", `expected CANON_TRANSITION_REQUIRED, got ${normal.code}`);
  assert.strictEqual(transition.code, "AUTHORITY_EDGE_RECEIPT_MISMATCH", `expected AUTHORITY_EDGE_RECEIPT_MISMATCH, got ${transition.code}`);
  pass("NC-SCR-2", "filtering the ledger scan by Canon state instead of by receipt status drops the drifted row before it can block, and strands the document under both write classes");
}

/* ===========================================================================
   NC-SCR-3 — REMOVAL BEFORE REVOCATION.
   Turns red: shot-canon-removal-drift.js S2 "ran while the shot still existed".
   =========================================================================== */

async function ncscr3() {
  const control = mutator(EDITS["NC-SCR-3"]);
  const project = rawFixture();
  canonShot(project);
  const page = await render(`#/shot/${SHOT}`, project, { mutateSource: control.fn });
  control.verify();
  const seen = await pressThrough(page, `delShot(${JSON.stringify(SHOT)}); return 1;`, "delete-shot-confirm");

  assert.strictEqual(seen.shotIds.includes(SHOT), false,
    "the control must reproduce the real defect: the shot is removed before anything is withdrawn");
  assert.deepStrictEqual(currentKeys(seen.after).sort(), [
    `shot-delivery:${SHOT}`, `shot-frame:${SHOT}#frame-a`, `shot-motion:${SHOT}#motion-a`,
  ], "and every receipt stays `current`, because the kernel refuses to withdraw a receipt whose target has gone");
  assert.deepStrictEqual(seen.deletedTargets, [], "not even the deletion record was written — the shot simply vanished");
  const { normal } = strandedBy(project, seen.after);
  assert.strictEqual(normal.outcome.ok, false, "so the document cannot be saved");
  assert.strictEqual(normal.code, "CANON_TRANSITION_REQUIRED", `expected CANON_TRANSITION_REQUIRED, got ${normal.code}`);
  pass("NC-SCR-3", "removing the shot before withdrawing its receipts makes every withdrawal impossible and strands the document");
}

/* ===========================================================================
   NC-SCR-4 — SCENE DELETION, ONE SHOT AT A TIME.
   Turns red: shot-canon-removal-drift.js S4.2 "NOTHING was mutated".
   =========================================================================== */

async function ncscr4() {
  const control = mutator(EDITS["NC-SCR-4"]);
  const project = rawFixture();
  canonShot(project);
  const sibling = addSiblingShot(project);
  withCanon(project, [{ kind: "shot-frame", shotId: SIBLING, frameId: sibling.keyframes[0].id, value: "FRAME_C.png" }]);
  sibling.keyframes[0].winner = "FRAME_C-RENAMED.png";
  assert.strictEqual(project.shots.map((row) => row.id).join(","), `${SHOT},${SIBLING}`,
    "fixture: the removable shot must come first and the blocking one second");

  const page = await render(`#/scene/${SCENE}`, project, { mutateSource: control.fn });
  control.verify();
  const seen = await pressThrough(page, `delScene(${JSON.stringify(SCENE)}); return 1;`, "delete-scene-confirm");

  assert.strictEqual(seen.sceneIds.includes(SCENE), true, "the scene is still refused, as it must be");
  assert.deepStrictEqual(seen.deletedTargets, [`shot:${SHOT}`],
    "but the control reproduces the real defect: the first shot was already recorded as deleted before the second was even planned");
  assert.deepStrictEqual(currentKeys(seen.after), [`shot-frame:${SIBLING}#frame-c`],
    "and its three receipts were already withdrawn — a partial withdrawal the filmmaker never asked for");
  const withdrawn = receipts(seen.after).filter((row) => row.status === "revoked");
  assert.strictEqual(withdrawn.length, 3, "three approvals were withdrawn for a deletion that then did not happen");
  assert.ok(withdrawn.every((row) => row.revocationReason === "target-removed"),
    "each one recorded as a target removal, of a target that is still there");

  const { normal } = strandedBy(project, seen.after);
  assert.strictEqual(normal.outcome.ok, false, "and the half-changed document cannot be saved");
  assert.strictEqual(normal.code, "CANON_TRANSITION_REQUIRED", `expected CANON_TRANSITION_REQUIRED, got ${normal.code}`);
  pass("NC-SCR-4", "withdrawing and recording one shot at a time withdraws three approvals and records a deletion for a scene deletion that is then refused, and the half-changed document cannot be saved");
}

/* ===========================================================================
   NC-SCR-5 — THE OVER-REFUSAL DIRECTION.
   Turns red: shot-canon-removal-drift.js ARCH-2 "a receipt whose target had
   already gone does not block the removal".
   =========================================================================== */

async function ncscr5() {
  const control = mutator(EDITS["NC-SCR-5"]);
  const project = rawFixture();
  withCanon(project, [{ kind: "shot-frame", shotId: SHOT, frameId: "frame-deleted", value: "GONE.png" }]);
  const page = await render(`#/shot/${SHOT}`, project, { mutateSource: control.fn });
  control.verify();
  const seen = await pressThrough(page, `delShot(${JSON.stringify(SHOT)}); return 1;`, "delete-shot-confirm");

  assert.strictEqual(seen.shotIds.includes(SHOT), true,
    "the control must reproduce the real cost: the shot cannot be deleted at all");

  /* AND THE REFUSAL IS UNEARNED. The very removal it refused is one the shipped seam
     would have stored, so the filmmaker is being sent to re-approve a frame that is not
     in the shot in order to fix nothing. */
  const wouldHaveBeen = clone(seen.after);
  wouldHaveBeen.shots = wouldHaveBeen.shots.filter((row) => row.id !== SHOT);
  const allowed = persist(project, wouldHaveBeen);
  assert.strictEqual(allowed.outcome.ok, true,
    `the refused removal is one the real seam accepts: ${allowed.code}`);
  pass("NC-SCR-5", "dropping the target-existence gate refuses a deletion the real seam would have stored, on a receipt that was already invalid");
}

/* ========================================================================== */

async function main() {
  await ncscr0();
  await ncscr1();
  await ncscr2();
  await ncscr3();
  await ncscr4();
  await ncscr5();
  const expected = ["NC-SCR-0", "NC-SCR-1", "NC-SCR-2", "NC-SCR-3", "NC-SCR-4", "NC-SCR-5"];
  assert.deepStrictEqual(passed.sort(), expected, `every control must run: ${passed.join(", ")}`);
  console.log(`Shot Canon removal drift negative controls: ${passed.length}/${expected.length} reverted defects reproduced against the shipped seam.`);
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

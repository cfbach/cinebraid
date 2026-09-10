/* CineBraid — SHOT CANON REMOVAL DRIFT.
 *
 * One frozen invariant, on the shot/scene side of the removal boundary:
 *
 *   A shot or scene carrying current authority may not be removed unless every
 *   current authority receipt that would become invalid is first successfully
 *   withdrawn through the legitimate authority seam.
 *
 * THE DEFECT THIS SUITE PINS. revokeShotCanonForRemoval() decided what to withdraw by
 * asking hasCurrentHumanAuthority() — Canon-shaped state — and its callers then removed
 * the shot whatever the answer had been. The Authority Write Seam refuses on the receipt
 * ROW being `current`, and the two come apart on a DRIFTED edge: a still-current receipt
 * whose approved file was renamed or replaced after approval, which the kernel has no
 * command to withdraw (revokeCanon and systemInvalidateCanon both require
 * currentHumanAuthority). Such a target was silently skipped and the shot removed anyway,
 * stranding the document — NORMAL_SAVE refused with CANON_TRANSITION_REQUIRED, the Canon
 * transition with AUTHORITY_EDGE_RECEIPT_MISMATCH — with every unrelated edit made in the
 * same session stuck behind a receipt the filmmaker could not see or withdraw.
 *
 * This is the AT1-E/B3 defect on the shot side, deferred out of AT1 into its own slice.
 *
 * WHAT THIS SUITE DELIBERATELY DOES NOT DO. It forms no opinion of its own about what is
 * withdrawable or saveable. Every removal is driven through the SHIPPED confirmation
 * control inside a delivered trusted gesture, every revocation is written by the SHIPPED
 * kernel command, and every "can this document be stored" verdict comes from the real
 * Authority Write Seam rather than from an assertion in this file. No server is started,
 * no project data is touched, and no provider is contacted.
 *
 * S1  an ordinary shot holding no current receipt still deletes, and saves.
 * S2  a shot holding current Canon: every receipt withdrawn BEFORE removal, the shot
 *     gone, no current receipt left for it, the document saves and a reload keeps it gone.
 * S3  a drifted receipt: deletion refused, nothing mutated, the project still saveable,
 *     and the reason persists beside the control that refused.
 * S4  scene deletion, which removes its shots through the same seam: the whole scene's
 *     shots are planned before any of them is touched, and one unwithdrawable receipt
 *     refuses the whole scene without partially removing a sibling.
 * S5  an unrelated edit made in the same session survives the successful deletion, the
 *     save, and the reload.
 * P1  a receipt that claims its target TWICE — a stored `targetKey` naming one shot and a
 *     derived identity naming another — is relevant to the removal on EITHER claim, because
 *     the write seam protects both. Refused, atomically, on the shot and on the scene.
 */

const assert = require("assert");
const crypto = require("crypto");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

const { Kernel } = require("./authority-kernel-private");
const { render, rawFixture, withCanon } = require("./render-harness.js");
const seam = require(path.join(ROOT, "src/authority/authority-write-seam"));

let checks = 0;
const notes = [];
const note = (line) => notes.push(line);
function ok(value, message) {
  checks += 1;
  assert.ok(value, message);
}
function equal(actual, expected, message) {
  checks += 1;
  assert.strictEqual(actual, expected, message);
}
const clone = (value) => JSON.parse(JSON.stringify(value));
function evaluate(context, body) {
  return vm.runInContext(`(() => { ${body} })()`, context);
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

/* The real Authority Write Seam, asked whether a document can actually be stored — and
   handing back what it stored, so "what does a reload open" is answered from the seam's
   own output rather than from the page that produced it. */
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

/* The declaration a Canon transition must carry, derived by the KERNEL from the two
   documents rather than hand-written here — a hand-written one drifts and then refuses for
   CANON_DECLARATION_MISMATCH, which would hide the refusal the test is actually about. */
function declarationFor(before, after) {
  const declaration = Kernel.authorityWriteTransition(before, after).declaration;
  return { targetKeys: declaration.targetKeys, receiptIds: declaration.receiptIds, transitionKind: declaration.transitionKind };
}

/* ===========================================================================
   FIXTURES — real Canon, and the one legitimate drift that makes a receipt
   unwithdrawable.
   =========================================================================== */

const SHOT = "L1-01";
const SIBLING = "L1-02";
const SCENE = "SC-01";

/* A second shot in the same scene, so scene deletion has a sibling to fail to remove
   partially. It is a copy of the fixture shot with its own ids. */
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

/* THE THREE SHOT AUTHORITY KINDS ON ONE SHOT. A frame, a motion unit and the shot's
   delivery pointer, each with a live edge the kernel can read, so a receipt written
   against it is genuinely current rather than merely present. */
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

/* THE DRIFT, AND IT IS THE SHIPPED ONE. The approved still was renamed after it was
   approved. The receipt still names the old file and carries no asset identity, so
   repairCanonValue() will not follow the rename and no kernel command can withdraw the
   receipt — while the ROW stays `current`, which is what strands the save. */
function driftFrame(project, shotId = SHOT) {
  const shot = project.shots.find((row) => row.id === shotId);
  shot.keyframes[0].winner = "FRAME_A-RENAMED.png";
  return shot;
}

function receiptsOf(project) {
  return ((project.productionAuthority || {}).receipts || []).map((row) => ({
    id: row.id, targetKey: row.targetKey, status: row.status, reason: row.revocationReason || "",
    revokedVia: row.revokedVia || "", revokedBy: row.revokedBy || "",
  }));
}
function currentKeys(project) {
  return receiptsOf(project).filter((row) => row.status === "current").map((row) => row.targetKey).sort();
}

/* ===========================================================================
   DRIVING THE SHIPPED CONTROLS.

   Both deletions open the shipped confirmation modal and wire their confirm handler on a
   macrotask, exactly as the product does, and both are pressed inside the harness's
   trusted gesture — the same gesture the kernel requires of a real click.

   THE SPY IS AN ORDER PROOF, NOT A STUB. Each kernel revoke command is wrapped so that it
   still runs, and records what the document looked like AT THE MOMENT OF WITHDRAWAL. The
   invariant is that the target still exists then and that nothing has been recorded as
   deleted yet: withdrawal before removal, in the document rather than in the source.
   =========================================================================== */
function installOrderSpy(context) {
  evaluate(context, `
    window.__removalOrder = [];
    for (const name of ["revokeFrameCanon", "revokeMotionCanon", "revokeDeliveryCanon"]) {
      const original = globalThis[name];
      if (typeof original !== "function" || original.__spied) continue;
      const spy = function (project, request) {
        window.__removalOrder.push({
          command: name,
          shotId: String(request && request.shotId || ""),
          shotStillPresent: (P.shots || []).some((row) => row.id === String(request && request.shotId || "")),
          shotCount: (P.shots || []).length,
          sceneCount: (P.scenes || []).length,
          deletedTargets: ((P.meta || {}).deletedTargets || []).length,
        });
        return original(project, request);
      };
      spy.__spied = true;
      globalThis[name] = spy;
    }
    return 1;
  `);
}

function readAfter(page, extra = "") {
  return evaluate(page.context, `
    const main = (document.getElementById("main") || { innerHTML: "" }).innerHTML;
    return {
      shotIds: (P.shots || []).map((row) => row.id),
      sceneIds: (P.scenes || []).map((row) => row.id),
      deletedTargets: ((P.meta || {}).deletedTargets || []).map((row) => row.type + ":" + row.id),
      ledgerTrusted: validateAuthorityLedger(P).trusted,
      order: window.__removalOrder || [],
      refusalKeys: (main.match(/data-action-refusal="[^"]+"/g) || []),
      refusalCode: (main.split('data-refusal-code="')[1] || "").split('"')[0],
      refusalText: (main.split("CineBraid did not make this change</b><span>")[1] || "").split("</span>")[0],
      unrelated: (P.meta || {}).globalStylePrompt || "",
      after: JSON.parse(JSON.stringify(P)),
      ${extra}
    };
  `);
}

/* The press happens inside the gesture; the READ happens after it, because the shot
   workspace route is async and its repaint — the surface a refusal has to reach — lands on
   a later turn. Reading needs no gesture, so nothing is held open across the await. */
async function pressThrough(page, open, confirmId) {
  installOrderSpy(page.context);
  evaluate(page.context, open);
  await tick(); // both deletions wire their confirm handler on a macrotask
  page.gesture.act(() => evaluate(page.context, `document.getElementById(${JSON.stringify(confirmId)}).onclick(); return 1;`));
  await tick();
  await tick();
  return readAfter(page);
}

async function deleteShotThrough(page, shotId) {
  return pressThrough(page, `delShot(${JSON.stringify(shotId)}); return 1;`, "delete-shot-confirm");
}

async function deleteSceneThrough(page, sceneId) {
  return pressThrough(page, `delScene(${JSON.stringify(sceneId)}); return 1;`, "delete-scene-confirm");
}

/* ===========================================================================
   S1 — AN ORDINARY SHOT, NO CURRENT RECEIPT.
   =========================================================================== */

async function s1_ordinaryShotDeletes() {
  const project = rawFixture();
  delete project.productionAuthority;
  const page = await render(`#/shot/${SHOT}`, project);
  const seen = await deleteShotThrough(page, SHOT);

  equal(seen.shotIds.includes(SHOT), false, "S1: a shot holding no current authority still deletes");
  equal(seen.order.length, 0, "S1: and nothing was withdrawn, because there was nothing to withdraw");
  equal(seen.refusalKeys.length, 0, "S1: with no refusal");
  ok(seen.deletedTargets.includes(`shot:${SHOT}`), "S1: the removal is recorded as deleted-target history");

  const saved = persist(project, seen.after);
  equal(saved.outcome.ok, true, `S1: and the result saves through the real seam: ${saved.code}`);
  equal(saved.stored.shots.some((row) => row.id === SHOT), false, "S1: what a reload would open no longer contains the shot");

  const reload = await render(`#/scene/${SCENE}`, saved.stored);
  equal(evaluate(reload.context, `return (P.shots || []).some((row) => row.id === ${JSON.stringify(SHOT)});`), false,
    "S1: and the reloaded document keeps it gone");
  note("S1 an ordinary shot deletes, records deleted-target history, saves and reloads clean");
}

/* ===========================================================================
   S2 — A SHOT HOLDING CURRENT CANON.
   =========================================================================== */

async function s2_canonShotWithdrawsThenRemoves() {
  const project = rawFixture();
  const shot = canonShot(project);
  for (const target of [
    { kind: "shot-frame", shotId: SHOT, frameId: shot.keyframes[0].id },
    { kind: "shot-motion", shotId: SHOT, unitKey: shot.clips[0].id },
    { kind: "shot-delivery", shotId: SHOT },
  ]) equal(Kernel.hasCurrentHumanAuthority(project, target), true,
    `S2 precondition: ${target.kind} genuinely holds current Canon`);

  const page = await render(`#/shot/${SHOT}`, project);
  /* S5 rides on the successful deletion: an unrelated edit made in the same session. */
  evaluate(page.context, `P.meta.globalStylePrompt = "an unrelated edit made in the same session"; return 1;`);
  const seen = await deleteShotThrough(page, SHOT);

  equal(seen.shotIds.includes(SHOT), false, "S2: the shot is removed");
  equal(seen.order.length, 3, `S2: all three of its receipts were withdrawn: ${JSON.stringify(seen.order.map((row) => row.command))}`);
  for (const step of seen.order) {
    equal(step.shotStillPresent, true, `S2: ${step.command} ran while the shot still existed — withdrawal BEFORE removal`);
    equal(step.deletedTargets, 0, `S2: ${step.command} ran before anything was recorded as deleted`);
  }

  const rows = receiptsOf(seen.after);
  equal(currentKeys(seen.after).length, 0, `S2: no current receipt remains for the removed target: ${JSON.stringify(rows)}`);
  equal(rows.length, 3, "S2: every receipt still exists — revocation is a status, not a deletion");
  for (const row of rows) {
    equal(row.status, "revoked", `S2: ${row.targetKey} was WITHDRAWN rather than left current`);
    equal(row.reason, "target-removed", `S2: ${row.targetKey} used the kernel's own removal vocabulary`);
    equal(row.revokedBy, "human", `S2: ${row.targetKey} records the human who pressed`);
    equal(row.revokedVia, "confirmed-target-removal", `S2: ${row.targetKey} records the gesture it came from`);
  }
  equal(seen.ledgerTrusted, true, "S2: the ledger is still trusted afterwards");
  equal(seen.refusalKeys.length, 0, "S2: nothing was refused");

  const saved = persist(project, seen.after);
  equal(saved.outcome.ok, true,
    `S2: the document saves through the real seam — the defect made this CANON_TRANSITION_REQUIRED: ${saved.code}`);
  equal(saved.code, "", "S2: with no refusal code at all");
  equal(saved.writes, 1, "S2: with a real write, not a refused one");

  const transition = persist(project, seen.after, seam.WRITE_CLASSES.CANON_TRANSITION, declarationFor(project, seen.after));
  ok(transition.code !== "AUTHORITY_EDGE_RECEIPT_MISMATCH",
    `S2: and the Canon transition class does not see a mismatched edge either: ${transition.code}`);

  equal(saved.stored.shots.some((row) => row.id === SHOT), false, "S2: the stored document no longer contains the shot");
  const reload = await render(`#/scene/${SCENE}`, saved.stored);
  const reloaded = evaluate(reload.context, `
    return {
      present: (P.shots || []).some((row) => row.id === ${JSON.stringify(SHOT)}),
      current: ((P.productionAuthority || {}).receipts || []).filter((row) => row.status === "current").length,
      unrelated: (P.meta || {}).globalStylePrompt || "",
      refusals: ((document.getElementById("main") || { innerHTML: "" }).innerHTML.match(/data-action-refusal=/g) || []).length,
    };
  `);
  equal(reloaded.present, false, "S2: reload keeps the shot gone");
  equal(reloaded.current, 0, "S2: and leaves no current receipt behind");
  equal(reloaded.refusals, 0, "S2: and no refusal survives a clean deletion");

  /* S5 — THE UNRELATED EDIT. */
  equal(seen.unrelated, "an unrelated edit made in the same session", "S5: the unrelated pending edit survived the deletion");
  equal(saved.stored.meta.globalStylePrompt, "an unrelated edit made in the same session", "S5: it survived the save");
  equal(reloaded.unrelated, "an unrelated edit made in the same session", "S5: and it survived the reload");

  note("S2/S5 a Canon-holding shot withdraws all three receipts through the kernel before removal, saves under NORMAL_SAVE with no refusal, reloads clean, and carries an unrelated same-session edit through save and reload");
}

/* ===========================================================================
   S3 — A DRIFTED RECEIPT. REFUSED, WITH ZERO MUTATION.
   =========================================================================== */

async function s3_driftedReceiptRefuses() {
  const project = rawFixture();
  const shot = canonShot(project);
  driftFrame(project);
  const driftedTarget = { kind: "shot-frame", shotId: SHOT, frameId: shot.keyframes[0].id };
  equal(Kernel.hasCurrentHumanAuthority(project, driftedTarget), false,
    "S3 precondition: the drifted receipt no longer matches the live edge");
  ok(((project.productionAuthority || {}).receipts || []).some(
    (row) => row.targetKey === `shot-frame:${SHOT}#${shot.keyframes[0].id}` && row.status === "current"),
    "S3 precondition: yet the receipt ROW is still current, which is what strands a save");

  const page = await render(`#/shot/${SHOT}`, project);
  const before = evaluate(page.context, `P.meta.globalStylePrompt = "an unrelated edit"; return JSON.stringify(P);`);
  const seen = await deleteShotThrough(page, SHOT);

  equal(seen.shotIds.includes(SHOT), true, "S3: the shot is NOT removed");
  equal(JSON.stringify(seen.after), before,
    "S3: and NOTHING was mutated — no partial withdrawal, no deletion record, no cleared edge");
  equal(seen.order.length, 0, "S3: not one receipt was withdrawn, including the two that were withdrawable");
  equal(currentKeys(seen.after).length, 3, "S3: all three receipts are left exactly as they were");

  ok(seen.refusalKeys.includes(`data-action-refusal="shot-delete:${SHOT}"`),
    `S3: the reason is rendered on the shot whose deletion was refused: ${JSON.stringify(seen.refusalKeys)}`);
  equal(seen.refusalCode, "AUTHORITY_RECEIPT_NOT_WITHDRAWABLE", "S3: under the code that names the cause");
  ok(/renamed or replaced/i.test(seen.refusalText), `S3: naming the cause: ${seen.refusalText}`);
  ok(/Re-approve/i.test(seen.refusalText), `S3: and what would make the shot removable: ${seen.refusalText}`);
  ok(seen.refusalText.includes(SHOT), `S3: and which shot it is about: ${seen.refusalText}`);
  ok(/could not be saved/i.test(seen.refusalText), `S3: and what refusing protected: ${seen.refusalText}`);

  const saved = persist(project, seen.after);
  equal(saved.outcome.ok, true,
    `S3: and the project is still saveable, which is the whole point of refusing: ${saved.code}`);
  equal(saved.stored.meta.globalStylePrompt, "an unrelated edit", "S3: so the unrelated edit made in the same session is not stranded");

  /* THE COUNTERFACTUAL, THROUGH THE REAL SEAM. Removing the shot anyway — which is what
     the defect did — produces a document neither write class will store. This is the
     harm the refusal above prevents, proved by the shipped boundary rather than claimed. */
  const stranded = clone(JSON.parse(before));
  stranded.shots = stranded.shots.filter((row) => row.id !== SHOT);
  const strandedNormal = persist(project, stranded);
  equal(strandedNormal.outcome.ok, false, "S3: had the shot been removed anyway, an ordinary save is refused");
  equal(strandedNormal.code, "CANON_TRANSITION_REQUIRED", `S3: with CANON_TRANSITION_REQUIRED, got ${strandedNormal.code}`);
  const strandedTransition = persist(project, stranded, seam.WRITE_CLASSES.CANON_TRANSITION, declarationFor(project, stranded));
  equal(strandedTransition.outcome.ok, false, "S3: and the Canon transition is refused too");
  equal(strandedTransition.code, "AUTHORITY_EDGE_RECEIPT_MISMATCH",
    `S3: with AUTHORITY_EDGE_RECEIPT_MISMATCH, got ${strandedTransition.code}`);

  note("S3 a drifted shot receipt refuses deletion with zero mutation, keeps the shot and all three receipts, stays saveable and explains the repair — and the seam confirms removing it anyway would be storable by neither write class");
}

/* ===========================================================================
   S4 — SCENE DELETION, WHICH REMOVES ITS SHOTS THROUGH THE SAME SEAM.
   =========================================================================== */

async function s4_sceneDeletionIsAtomic() {
  /* S4.1 — EVERY SHOT'S CANON WITHDRAWN, THEN THE SCENE AND ITS SHOTS REMOVED. */
  const whole = rawFixture();
  canonShot(whole);
  const sibling = addSiblingShot(whole);
  withCanon(whole, [{ kind: "shot-frame", shotId: SIBLING, frameId: sibling.keyframes[0].id, value: "FRAME_C.png" }]);
  const wholePage = await render(`#/scene/${SCENE}`, whole);
  const wholeSeen = await deleteSceneThrough(wholePage, SCENE);

  equal(wholeSeen.sceneIds.includes(SCENE), false, "S4.1: the scene is removed");
  equal(wholeSeen.shotIds.length, 0, "S4.1: and so are both of its shots");
  equal(wholeSeen.order.length, 4, `S4.1: all four receipts were withdrawn: ${JSON.stringify(wholeSeen.order.map((row) => row.command))}`);
  for (const step of wholeSeen.order) {
    equal(step.shotStillPresent, true, `S4.1: ${step.command} for ${step.shotId} ran while that shot still existed`);
    equal(step.shotCount, 2, "S4.1: with BOTH shots still present — no sibling was removed part-way through");
    equal(step.sceneCount, 1, "S4.1: and the scene still standing");
    equal(step.deletedTargets, 0, "S4.1: and nothing recorded as deleted yet");
  }
  equal(currentKeys(wholeSeen.after).length, 0, "S4.1: no current receipt is orphaned by the scene removal");
  const wholeSaved = persist(whole, wholeSeen.after);
  equal(wholeSaved.outcome.ok, true, `S4.1: and the result saves through the real seam: ${wholeSaved.code}`);

  /* S4.2 — ONE UNWITHDRAWABLE RECEIPT REFUSES THE WHOLE SCENE, ATOMICALLY.

     THE DRIFTED SHOT IS THE SECOND ONE, and that is the whole point of this case. A
     removal that planned, withdrew and recorded one shot at a time would block on the
     FIRST shot and never reach the second, so a fixture with the drift in front would
     pass with the defect still present. Here the first shot is perfectly removable and
     holds three withdrawable receipts: anything that acts before it has planned the
     whole scene leaves those three withdrawn and that shot recorded as deleted. */
  const mixed = rawFixture();
  canonShot(mixed);
  const mixedSibling = addSiblingShot(mixed);
  withCanon(mixed, [{ kind: "shot-frame", shotId: SIBLING, frameId: mixedSibling.keyframes[0].id, value: "FRAME_C.png" }]);
  mixedSibling.keyframes[0].winner = "FRAME_C-RENAMED.png";
  equal(mixed.shots.map((row) => row.id).join(","), `${SHOT},${SIBLING}`,
    "S4.2 precondition: the removable shot comes first and the blocking one second");
  equal(Kernel.hasCurrentHumanAuthority(mixed, { kind: "shot-frame", shotId: SHOT, frameId: "frame-a" }), true,
    "S4.2 precondition: the FIRST shot holds perfectly withdrawable receipts");
  equal(Kernel.hasCurrentHumanAuthority(mixed, { kind: "shot-frame", shotId: SIBLING, frameId: mixedSibling.keyframes[0].id }), false,
    "S4.2 precondition: and only the SECOND shot's frame receipt has drifted");

  const mixedPage = await render(`#/scene/${SCENE}`, mixed);
  const mixedBefore = evaluate(mixedPage.context, `P.meta.globalStylePrompt = "an unrelated edit"; return JSON.stringify(P);`);
  const mixedSeen = await deleteSceneThrough(mixedPage, SCENE);

  equal(mixedSeen.sceneIds.includes(SCENE), true, "S4.2: the scene is NOT removed");
  equal(mixedSeen.shotIds.length, 2, "S4.2: and neither is either shot");
  equal(JSON.stringify(mixedSeen.after), mixedBefore,
    "S4.2: NOTHING was mutated — no sibling withdrawn, no shot removed, no deletion record written");
  equal(mixedSeen.order.length, 0, "S4.2: the sibling's withdrawable receipt was never touched");
  equal(currentKeys(mixedSeen.after).length, 4, "S4.2: every receipt in the scene is left current and coherent");
  ok(mixedSeen.refusalKeys.includes(`data-action-refusal="scene-delete:${SCENE}"`),
    `S4.2: the reason is rendered on the scene whose deletion was refused: ${JSON.stringify(mixedSeen.refusalKeys)}`);
  equal(mixedSeen.refusalCode, "AUTHORITY_RECEIPT_NOT_WITHDRAWABLE", "S4.2: under the code that names the cause");
  ok(mixedSeen.refusalText.includes(SIBLING), `S4.2: naming the shot that blocks it: ${mixedSeen.refusalText}`);
  equal(mixedSeen.refusalText.includes(SHOT), false,
    `S4.2: and not blaming the sibling that does not: ${mixedSeen.refusalText}`);
  ok(/Re-approve/i.test(mixedSeen.refusalText), `S4.2: with the repair that would make it removable: ${mixedSeen.refusalText}`);
  const mixedSaved = persist(mixed, mixedSeen.after);
  equal(mixedSaved.outcome.ok, true, `S4.2: and the project is still saveable: ${mixedSaved.code}`);

  note("S4 scene deletion plans every contained shot before touching any of them: four receipts withdrawn then scene and shots removed and saved, and one drifted receipt refuses the whole scene with zero partial withdrawal or removal");
}

/* ===========================================================================
   P1 — A RECEIPT CLAIMS ITS TARGET TWICE, AND THE SEAM PROTECTS BOTH CLAIMS.

   A receipt carries its target identity as a stored `targetKey` string AND as fields the
   identity is re-derived from. validateAuthorityLedger() refuses a row whose two disagree,
   but a document can already contain one, and the Authority Write Seam has always measured
   a removal against BOTH — rawCurrentTargetDomain() freezes each, and
   targetRemovalDisposition() matches a removed target against either.

   The planner asked only the derived identity. So a row whose STORED key named the shot
   being deleted was invisible to it: the shot was removed, deletion history was written,
   the row stayed `current`, and the next ordinary save was refused with
   CANON_TRANSITION_REQUIRED for a target the deletion had never considered.
   =========================================================================== */

/* The exact row from the review. Written by hand rather than through withCanon() because it
   is precisely the shape no writer produces: this is a document that ARRIVED carrying it. */
function crossClaimedReceipt(project, storedShotId, derivedShotId, frameId = "frame-a") {
  withCanon(project, [{ kind: "shot-frame", shotId: storedShotId, frameId, value: "FRAME_A.png" }]);
  const row = project.productionAuthority.receipts[project.productionAuthority.receipts.length - 1];
  row.shotId = derivedShotId;
  return row;
}

async function p1_storedTargetKeyIsMembership() {
  /* P1-SHOT. */
  const project = rawFixture();
  const row = crossClaimedReceipt(project, SHOT, "OTHER-SHOT");
  equal(row.targetKey, `shot-frame:${SHOT}#frame-a`, "P1 precondition: the STORED key names the shot being deleted");
  equal(Kernel.authorityTarget(row).key, "shot-frame:OTHER-SHOT#frame-a",
    "P1 precondition: while the DERIVED identity names a different shot");
  equal(row.status, "current", "P1 precondition: and the row is current");

  const page = await render(`#/shot/${SHOT}`, project);
  const before = evaluate(page.context, `P.meta.globalStylePrompt = "an unrelated edit"; return JSON.stringify(P);`);
  const seen = await deleteShotThrough(page, SHOT);

  /* RELEVANT BECAUSE OF THE STORED CLAIM. The plan is asked directly, so this is not
     inferred from the refusal that follows it. */
  const planned = evaluate(page.context, `
    const plan = planShotCanonWithdrawal(P.shots.filter((row) => row.id === ${JSON.stringify(SHOT)}));
    return {
      blocked: plan.blocked.map((entry) => entry.target.key),
      withdraw: plan.withdraw.map((entry) => entry.target.key),
      keys: authorityReceiptTargetKeys(P.productionAuthority.receipts[0]),
    };
  `);
  equal(planned.keys.join(" | "), `shot-frame:${SHOT}#frame-a | shot-frame:OTHER-SHOT#frame-a`,
    "P1: the shared predicate reports BOTH claims, stored first");
  equal(planned.blocked.join(","), `shot-frame:${SHOT}#frame-a`,
    `P1: the row is relevant because its stored target identifies ${SHOT}: ${JSON.stringify(planned)}`);
  equal(planned.withdraw.length, 0, "P1: and withdrawal cannot legitimately proceed");

  equal(seen.shotIds.includes(SHOT), true, "P1: the shot is NOT removed");
  equal(seen.refusalCode, "AUTHORITY_RECEIPT_NOT_WITHDRAWABLE", "P1: deletion refuses under the code that names the cause");
  equal(seen.order.length, 0, "P1: not one receipt was withdrawn");
  equal(seen.deletedTargets.length, 0, "P1: and no deletion history was written");
  equal(currentKeys(seen.after).length, 1, "P1: the receipt is left current");
  equal(JSON.stringify(seen.after), before, "P1: with ZERO mutation of any kind");

  /* THE REFUSAL HAS TO BE TRUE ABOUT WHY. This row was not renamed, so it must not be
     described as renamed, and it must not send the filmmaker to re-approve an image. */
  ok(/do not read as trustworthy|disagrees with/i.test(seen.refusalText),
    `P1: the reason names the real cause: ${seen.refusalText}`);
  equal(/renamed or replaced/i.test(seen.refusalText), false,
    `P1: and does not claim a rename that never happened: ${seen.refusalText}`);

  const saved = persist(project, seen.after);
  equal(saved.outcome.ok, true, `P1: and the project is still accepted by the real seam: ${saved.code}`);

  /* THE COUNTERFACTUAL, THROUGH THE REAL SEAM: removing it anyway is the reported failure. */
  const stranded = clone(JSON.parse(before));
  stranded.shots = stranded.shots.filter((r) => r.id !== SHOT);
  const strandedSave = persist(project, stranded);
  equal(strandedSave.outcome.ok, false, "P1: had the shot been removed anyway, an ordinary save is refused");
  equal(strandedSave.code, "CANON_TRANSITION_REQUIRED",
    `P1: with CANON_TRANSITION_REQUIRED, exactly as reported: ${strandedSave.code}`);

  /* P1-SCENE — the cross-claimed row sits on the SECOND shot of a multi-shot scene, so a
     removal that acted before planning the whole scene would already have withdrawn the
     first shot's three receipts and recorded it deleted. */
  const scene = rawFixture();
  canonShot(scene);
  addSiblingShot(scene);
  crossClaimedReceipt(scene, SIBLING, "OTHER-SHOT", "frame-c");
  equal(scene.shots.map((r) => r.id).join(","), `${SHOT},${SIBLING}`,
    "P1-SCENE precondition: the removable shot comes first and the cross-claimed one second");
  equal(Kernel.hasCurrentHumanAuthority(scene, { kind: "shot-frame", shotId: SHOT, frameId: "frame-a" }), false,
    "P1-SCENE precondition: an inconsistent row makes the WHOLE ledger untrusted, so nothing here is withdrawable");

  const scenePage = await render(`#/scene/${SCENE}`, scene);
  const sceneBefore = evaluate(scenePage.context, `P.meta.globalStylePrompt = "an unrelated edit"; return JSON.stringify(P);`);
  const sceneSeen = await deleteSceneThrough(scenePage, SCENE);

  equal(sceneSeen.sceneIds.includes(SCENE), true, "P1-SCENE: the scene is NOT removed");
  equal(sceneSeen.shotIds.length, 2, "P1-SCENE: and neither of its shots is");
  equal(sceneSeen.order.length, 0, "P1-SCENE: no earlier sibling receipt was withdrawn");
  equal(sceneSeen.deletedTargets.length, 0, "P1-SCENE: and no deleted-target history was recorded");
  equal(JSON.stringify(sceneSeen.after), sceneBefore, "P1-SCENE: the refusal is atomic — ZERO mutation");
  equal(sceneSeen.refusalCode, "AUTHORITY_RECEIPT_NOT_WITHDRAWABLE", "P1-SCENE: under the code that names the cause");
  equal(persist(scene, sceneSeen.after).outcome.ok, true, "P1-SCENE: and the project remains saveable");

  note("P1 a receipt whose stored targetKey and derived identity name different shots is relevant on either claim: shot and scene deletion both refuse atomically with zero mutation, the reason names the real cause rather than a rename, the project stays saveable, and the seam confirms removing it anyway is the reported CANON_TRANSITION_REQUIRED");
}

/* ===========================================================================
   ARCHITECTURE — THE PLAN IS THE SEAM'S OWN QUESTION, IN BOTH DIRECTIONS.

   The membership test has to match targetRemovalDisposition() exactly: a current receipt
   row whose target EXISTS NOW and will not exist after the removal. Asking a weaker
   question skips a receipt that strands the save; asking a stronger one refuses a removal
   the seam would have accepted, and sends the filmmaker to re-approve something that is
   not there. Both directions are pinned here.
   =========================================================================== */

async function architecture_receiptRowIsTheQuestion() {
  /* ARCH-1 — A CURRENT RECEIPT WHOSE EDGE HAS BEEN CLEARED, not renamed. The shot's
     delivery pointer is gone while the row still says `current`. It is not Canon by any
     presentation — currentHumanAuthority() answers null — but the target still EXISTS, so
     removing the shot is exactly what invalidates the row, and the seam will refuse the
     save. It must block, and for the same reason drift blocks. */
  const cleared = rawFixture();
  canonShot(cleared);
  delete cleared.shots[0].finalStillFile;
  const clearedTarget = { kind: "shot-delivery", shotId: SHOT };
  equal(Kernel.hasCurrentHumanAuthority(cleared, clearedTarget), false,
    "ARCH-1 precondition: a cleared edge reads as no current Canon");
  ok(((cleared.productionAuthority || {}).receipts || []).some(
    (row) => row.targetKey === `shot-delivery:${SHOT}` && row.status === "current"),
    "ARCH-1 precondition: while the receipt ROW is still current");

  const clearedPage = await render(`#/shot/${SHOT}`, cleared);
  const clearedSeen = await deleteShotThrough(clearedPage, SHOT);
  equal(clearedSeen.shotIds.includes(SHOT), true, "ARCH-1: a current row the kernel cannot withdraw blocks removal");
  equal(clearedSeen.refusalCode, "AUTHORITY_RECEIPT_NOT_WITHDRAWABLE", "ARCH-1: as an unwithdrawable receipt, not a silent skip");
  equal(clearedSeen.order.length, 0, "ARCH-1: and the two withdrawable receipts beside it were left alone");
  equal(currentKeys(clearedSeen.after).length, 3, "ARCH-1: all three rows are exactly as they were");
  const strandedByClear = clone(clearedSeen.after);
  strandedByClear.shots = strandedByClear.shots.filter((row) => row.id !== SHOT);
  equal(persist(cleared, strandedByClear).outcome.ok, false,
    "ARCH-1: and the seam confirms removing it anyway would strand the document");

  /* ARCH-2 — THE OTHER DIRECTION. A current receipt naming a frame the shot no longer
     lists is invalid BEFORE this deletion and invalid after it: authorityTargetExists()
     is already false, so targetRemovalDisposition() never accounts for it and the removal
     saves. Blocking here would refuse a legitimate deletion and tell the filmmaker to
     re-approve a frame that does not exist — a dead end. */
  const orphaned = rawFixture();
  const shot = orphaned.shots.find((row) => row.id === SHOT);
  withCanon(orphaned, [{ kind: "shot-frame", shotId: SHOT, frameId: "frame-deleted", value: "GONE.png" }]);
  equal(shot.keyframes.some((row) => row.id === "frame-deleted"), false,
    "ARCH-2 precondition: the shot does not list the frame this current receipt names");

  const orphanedPage = await render(`#/shot/${SHOT}`, orphaned);
  const orphanedSeen = await deleteShotThrough(orphanedPage, SHOT);
  equal(orphanedSeen.shotIds.includes(SHOT), false,
    "ARCH-2: a receipt whose target had already gone does not block the removal");
  equal(orphanedSeen.refusalKeys.length, 0, "ARCH-2: with no refusal and no dead end");
  const orphanedSaved = persist(orphaned, orphanedSeen.after);
  equal(orphanedSaved.outcome.ok, true,
    `ARCH-2: and the seam agrees the result is storable, which is why blocking would be wrong: ${orphanedSaved.code}`);

  /* ARCH-3 — PLANNING IS PURE. Asking what would be withdrawn must not withdraw anything. */
  const pure = rawFixture();
  canonShot(pure);
  const purePage = await render(`#/shot/${SHOT}`, pure);
  const untouched = evaluate(purePage.context, `
    const before = JSON.stringify(P);
    const plan = planShotCanonWithdrawal(P.shots);
    return { unchanged: JSON.stringify(P) === before, withdraw: plan.withdraw.length, blocked: plan.blocked.length };
  `);
  equal(untouched.unchanged, true, "ARCH-3: planShotCanonWithdrawal() writes nothing");
  equal(untouched.withdraw, 3, "ARCH-3: and reports all three withdrawable receipts");
  equal(untouched.blocked, 0, "ARCH-3: with nothing blocked");

  note("ARCH membership matches the seam in both directions: a current row whose target still exists but cannot be withdrawn blocks removal, one whose target had already gone does not, and planning writes nothing");
}

/* ========================================================================== */

async function main() {
  await s1_ordinaryShotDeletes();
  await s2_canonShotWithdrawsThenRemoves();
  await s3_driftedReceiptRefuses();
  await s4_sceneDeletionIsAtomic();
  await p1_storedTargetKeyIsMembership();
  await architecture_receiptRowIsTheQuestion();
  console.log(`Shot Canon removal drift suite passed ${checks} assertions.`);
  for (const line of notes) console.log(`  · ${line}`);
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

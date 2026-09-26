"use strict";
const assert = require("assert");
const vm = require("vm");
const { render, buildFixture, withCanon } = require("./render-harness");
const Stage = require("../public/shared-stage-model");

function fixture() {
  const p = buildFixture();
  p.shots = [p.shots[0]];
  for (const list of ["characters", "locations", "props"]) for (const row of p[list]) row.approvedFile = "";
  p.shots[0].clips = [];
  p.shots[0].keyframes[1].winner = "";
  p.shots[0].creationBrief = { deliveryIntent: "still", finalStillFile: "FRAME_A.png" };
  p.shots[0].finalStillFile = "FRAME_A.png";
  p.productionAuthority.receipts = p.productionAuthority.receipts.slice(0, 1);
  return withCanon(p, { kind: "shot-delivery", shotId: "L1-01", value: "FRAME_A.png" });
}
async function observe(project, mutateSource) {
  const r = await render("#/production", project, { mutateSource });
  const facts = JSON.parse(vm.runInContext(`JSON.stringify((() => {
    const feed = projectShotReadiness();
    const shot = P.shots[0];
    const decisions = projectFilmmakerDecisions(feed);
    const filters = shotBoardActionFilters(feed);
    FILTER.action = "complete";
    const deliveredFilter = shotBoardActionMatches(shot, feed);
    FILTER.action = "missing-inputs";
    return { decisions, feed, filters, deliveredFilter,
      missingFilter: shotBoardActionMatches(shot, feed),
      undelivered: shotBoardNotDelivered(shot),
      scene: sceneFilmmakerDecisions(shot.scene, decisions),
      stageFacts: shotStageModelFacts(shot, takesFor(shot.id)) };
  })())`, r.context));
  return { ...facts, html: r.html };
}
function checkDelivered(x) {
  assert.deepStrictEqual(x.decisions.delivered, ["L1-01"]);
  assert.strictEqual(x.scene.delivered, 1);
  assert.strictEqual(x.deliveredFilter, true);
  assert.strictEqual(x.undelivered, false);
  assert.match(x.filters, /data-board-filter="complete" data-count="1"/);
}
async function main() {
  const p = fixture(), before = JSON.stringify(p);
  const x = await observe(p);
  checkDelivered(x);
  assert.strictEqual(x.feed.shots[0].status, "BLOCKED");
  assert.strictEqual(x.scene.blocked, 1);
  assert.strictEqual(x.missingFilter, true, "delivered shots remain in Missing inputs");
  assert(x.feed.shots[0].units.some(u => u.label === "Frame B" && !u.complete));
  assert(!x.html.includes("Scene complete"), "delivery must not hide outstanding readiness");
  assert(x.html.includes("All shots delivered"));
  assert.strictEqual(x.stageFacts.approvedMotionAvailable, false);
  assert.notStrictEqual(Stage.shotStageState("motion", x.stageFacts).statusKey, "approved");
  assert.strictEqual(JSON.stringify(p), before, "reporting cannot change the project");

  for (const control of ["absent", "revoked", "mismatched", "unreadable"]) {
    const q = fixture(), receipt = q.productionAuthority.receipts.at(-1);
    if (control === "absent") q.productionAuthority.receipts.pop();
    if (control === "revoked") { receipt.status = "revoked"; receipt.revokedAt = "2026-09-26T12:00:00Z"; receipt.revocationReason = "Test withdrawal"; }
    if (control === "mismatched") receipt.value = "OTHER.png";
    if (control === "unreadable") q.productionAuthority.version = 999;
    const y = await observe(q);
    assert.deepStrictEqual(y.decisions.delivered, [], control);
    assert.strictEqual(y.deliveredFilter, false, control);
    assert.strictEqual(y.undelivered, true, control);
  }
  for (const lifecycleKey of ["final", "motion-approved", "review-motion"]) {
    assert.notStrictEqual(Stage.shotStageState("motion", { lifecycleKey, approvedResultAvailable: true }).statusKey, "approved", "lifecycle prose or still approval cannot approve motion");
  }
  assert.strictEqual(Stage.shotStageState("motion", { lifecycleKey: "final", approvedMotionAvailable: true, motionReadinessStatus: "COMPLETE" }).statusKey, "approved", "real approved motion remains approved");

  // Mutate the shipped code only in memory: prove the original bugs fail these checks.
  const badDelivery = await observe(fixture(), (file, source) => file === "app.js" ? source.replace('P.shots.filter(shotIsDelivered).map((shot) => shot.id)', 'rows.filter(row => row.status === "COMPLETE").map(row => row.shotId)') : source);
  assert.throws(() => checkDelivered(badDelivery), assert.AssertionError);
  // Derive inside the mutated realm, not through the good module above.
  const mutated = await render("#/shot/L1-01", fixture(), { mutateSource: (file, source) => file === "shared-stage-model.js" ? source.replace('if (facts.approvedMotionAvailable)', 'if (facts.lifecycleKey === "final" || facts.lifecycleKey === "motion-approved")') : source });
  const badMotionStatus = vm.runInContext('shotStageState("motion", shotStageModelFacts(P.shots[0], takesFor("L1-01"))).statusKey', mutated.context);
  assert.throws(() => assert.notStrictEqual(badMotionStatus, "approved"), assert.AssertionError);
  console.log("Delivery reporting: current receipt, independent references/Frame B, scene/board counts, no writes; absent/revoked/mismatched/unreadable and original-bug negative controls passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });

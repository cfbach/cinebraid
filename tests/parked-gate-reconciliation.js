"use strict";
/* Real durable GETs plus rejected-plan controls. No provider routes are registered. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const express = require("express");
const Authority = require("../public/shared-production-authority");
const { Kernel, Private } = require("./authority-kernel-private");
const manual = require("./authority-test-gesture").installTestManualActionSource(Kernel);
const { disposableRoot } = require("./helpers/disposable-root");
const { registerAutomationRuns } = require("../src/automation/automation-runs");
const clone = (v) => JSON.parse(JSON.stringify(v));
const key = "frame:a:review";
const at = "2026-09-26T12:00:00.000Z";
const project = () => ({ shots: [{ id: "S", keyframes: [{ id: "a" }, { id: "b" }] }] });
const run = () => ({ id: "parked", type: "shot-chain", targetId: "S", status: "awaiting-review", revision: 79, logs: [], steps: {
  [key]: { key, status: "needs-review", frameId: "a" },
} });
const approve = (p, frameId = "a", value = "A.png") => manual.gesture(() => Kernel.approveFrameCanon(p, { shotId: "S", frameId, value, assetId: "", at }));
const revoke = (p) => manual.gesture(() => Private.revokeFrameCanon(p, { shotId: "S", frameId: "a", at, reason: "withdrawn" }));
function unchangedApply(p, plan, options = { project: p }) {
  const r = run(), before = JSON.stringify(r), document = JSON.stringify(p);
  Authority.applyGateReconciliation(r, plan, { ...options, at });
  assert.strictEqual(JSON.stringify(r), before, "rejected plan must not close a gate or claim resumability");
  assert.strictEqual(JSON.stringify(p), document, "applier must not alter approval evidence");
}
async function main() {
  const workspace = disposableRoot("parked-gate-test");
  const dir = workspace.writeProject("fixture", project());
  const projectFile = path.join(dir, "project.json"), ledger = path.join(dir, "automation-runs.json");
  const media = path.join(dir, "fixture.png");
  fs.writeFileSync(media, "fixture bytes, not finished film media");
  const app = express();
  registerAutomationRuns(app, { projectDir: () => dir });
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const url = `http://127.0.0.1:${server.address().port}/api/automation/runs`;
  const get = async (suffix = "") => { const r = await fetch(url + suffix); assert.strictEqual(r.status, 200); return r.json(); };
  const bytes = () => Object.fromEntries(fs.readdirSync(dir).sort().map((f) => [f, fs.readFileSync(path.join(dir, f)).toString("base64")]));
  const readRun = () => JSON.parse(fs.readFileSync(ledger)).runs[0];
  function setup(p, r = run()) {
    fs.writeFileSync(projectFile, JSON.stringify(p));
    fs.writeFileSync(ledger, JSON.stringify({ schemaVersion: 2, runs: [r] }));
  }
  async function stable() {
    const before = bytes();
    await Promise.all([get(), get("/parked"), get("?view=history"), get()]);
    await get();
    assert.deepStrictEqual(bytes(), before, "repeated list/detail/history reads must be byte-identical, including backups");
  }
  async function oneTransition(p, expectedStatus, expectedStep, tone) {
    const before = bytes(), old = readRun();
    await get();
    const next = readRun();
    assert.strictEqual(next.revision, old.revision + 1);
    assert.strictEqual(next.logs.length, old.logs.length + 1);
    assert.strictEqual(next.logs.at(-1).tone, tone);
    assert.strictEqual(next.status, expectedStatus);
    assert.strictEqual(next.steps[key].status, expectedStep);
    assert.strictEqual(fs.readFileSync(projectFile, "utf8"), JSON.stringify(p));
    assert.strictEqual(bytes()["fixture.png"], before["fixture.png"]);
    await stable();
    return next;
  }
  try {
    const p = project(), receipt = approve(p);
    setup(p);
    const closed = await oneTransition(p, "interrupted", "completed", "success");
    assert.strictEqual(closed.steps[key].result.authorityReceiptId, receipt.id);
    assert.strictEqual(closed.steps[key].result.humanApproved, true);
    assert.strictEqual(Authority.runHasRevokedAuthority(closed, p), false);
    assert.strictEqual(Authority.runHasActionableGate(closed, p), false, "completed current gate is resumable, not awaiting approval");
    const unknown = clone(closed);
    unknown.steps.unknown = { key: "unknown", status: "needs-review" };
    assert.strictEqual(Authority.runHasActionableGate(unknown, p), true, "an unidentified open gate must remain visible");
    assert.strictEqual(Authority.runHasActionableGate({ steps: {} }, p), true, "absence of identifiable evidence still fails closed");
    assert.strictEqual(Authority.resumeAuthority(p, { kind: "shot-frame", shotId: "S", frameId: "a" }).id, receipt.id);

    revoke(p); // Explicit fixture setup, never part of a read.
    fs.writeFileSync(projectFile, JSON.stringify(p));
    const reopened = await oneTransition(p, "awaiting-review", "needs-review", "warn");
    assert.strictEqual(reopened.steps[key].result.humanApproved, false);
    assert.strictEqual(reopened.steps[key].result.authorityReceiptId, "");
    assert.strictEqual(reopened.logs.filter((l) => l.tone === "success").length, 1);

    const replacedAway = project(); approve(replacedAway);
    replacedAway.shots[0].keyframes[0].winner = "unapproved-replacement.png";
    setup(replacedAway, closed);
    const replacementReopened = await oneTransition(replacedAway, "awaiting-review", "needs-review", "warn");
    assert.strictEqual(replacementReopened.logs.filter((l) => l.tone === "success").length, 1);
    const withdrawalPlan = Authority.reconcileRunGates(closed, replacedAway, { at });
    const direct = clone(closed);
    Authority.applyGateReconciliation(direct, withdrawalPlan, { project: replacedAway, at });
    const once = JSON.stringify(direct);
    Authority.applyGateReconciliation(direct, withdrawalPlan, { project: replacedAway, at: "2026-09-27T12:00:00.000Z" });
    assert.strictEqual(JSON.stringify(direct), once, "reapplying an invalidation plan is also a no-op");

    for (const name of ["missing", "stale", "forged", "revoked", "replaced-away", "wrong-target"]) {
      const invalid = project();
      if (name !== "missing") approve(invalid, name === "wrong-target" ? "b" : "a");
      if (name === "stale") invalid.shots[0].keyframes[0].winner = "different.png";
      if (name === "forged") delete invalid.productionAuthority.receipts[0].provenance;
      if (name === "revoked") revoke(invalid);
      if (name === "replaced-away") { approve(invalid, "a", "replacement.png"); invalid.shots[0].keyframes[0].winner = "A.png"; }
      setup(invalid);
      await stable();
      assert.strictEqual(readRun().logs.length, 0, `${name} receipt cannot produce a success log`);
      console.log(`PASS ${name}: no write, no success, no gate closure`);
    }

    const current = project();
    approve(current);
    const plan = Authority.reconcileRunGates(run(), current, { at });
    unchangedApply(current, plan, {});
    unchangedApply(current, { ...plan, satisfied: [{ ...plan.satisfied[0], receiptId: "forged" }] });
    approve(current, "b", "B.png");
    const otherReceipt = Authority.currentHumanAuthority(current, { kind: "shot-frame", shotId: "S", frameId: "b" });
    unchangedApply(current, { ...plan, satisfied: [{ ...plan.satisfied[0], frameId: "b", receiptId: otherReceipt.id }] });
    unchangedApply(current, { ...plan, satisfied: [{ ...plan.satisfied[0], receiptId: "" }] });
    const partialPlan = { ...plan, satisfied: [plan.satisfied[0], { ...plan.satisfied[0], stepKey: "frame:b:review", frameId: "b", receiptId: "stale" }] };
    const partlyAccepted = run();
    partlyAccepted.steps["frame:b:review"] = { key: "frame:b:review", frameId: "b", status: "needs-review" };
    Authority.applyGateReconciliation(partlyAccepted, partialPlan, { project: current, at });
    assert.strictEqual(partlyAccepted.steps[key].status, "completed");
    assert.strictEqual(partlyAccepted.steps["frame:b:review"].status, "needs-review");
    assert.strictEqual(partlyAccepted.status, "awaiting-review", "a partially refused plan cannot declare resumability");
    const replacement = approve(current, "a", "replacement.png");
    unchangedApply(current, plan); // Plan cites the superseded receipt.
    setup(current);
    const replaced = await oneTransition(current, "interrupted", "completed", "success");
    assert.strictEqual(replaced.steps[key].result.authorityReceiptId, replacement.id);
    revoke(current);
    unchangedApply(current, Authority.reconcileRunGates(run(), project(), { at }));
    unchangedApply(current, plan);

    // One approved target cannot discharge another outstanding target in the same run.
    const partial = project(); approve(partial);
    const multiple = run(); multiple.steps["frame:b:review"] = { key: "frame:b:review", frameId: "b", status: "needs-review" };
    setup(partial, multiple);
    const half = await oneTransition(partial, "awaiting-review", "completed", "success");
    assert.strictEqual(half.steps["frame:b:review"].status, "needs-review");

    const unknownRun = run();
    unknownRun.steps.unknown = { key: "unknown", status: "needs-review" };
    setup(partial, unknownRun);
    await oneTransition(partial, "awaiting-review", "completed", "success");

    // Fault injection at the authority seam: a refused application must not be logged as success.
    setup(partial);
    const apply = Authority.applyGateReconciliation;
    try {
      Authority.applyGateReconciliation = (r) => r;
      await stable();
      assert.strictEqual(readRun().logs.length, 0);
    } finally { Authority.applyGateReconciliation = apply; }
    console.log("PASS current/replacement receipt, partial gates, revocation once, rejected plans, refused application, durable read idempotence. Provider calls: 0.");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    workspace.cleanup();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

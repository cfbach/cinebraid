"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Kernel, Private } = require("./authority-kernel-private");
const Authority = require("../public/shared-production-authority");
const { installTestManualActionSource } = require("./authority-test-gesture");
const { WRITE_CLASSES, createAuthorityWriteSeam, canonComparison } = require("../authority-write-seam");

const ROOT = path.join(__dirname, "..");
const MANUAL = installTestManualActionSource(Kernel);
const human = (fn) => MANUAL.gesture(fn);
const clone = (value) => JSON.parse(JSON.stringify(value));
const AT = "2026-08-22T12:00:00.000Z";

function project() {
  return {
    meta: { title: "O8" }, scenes: [{ id: "SC-01" }], characters: [], locations: [], props: [], vehicles: [], audio: [],
    shots: [{
      id: "SH-01", scene: "SC-01", winner: "", keyframes: [{ id: "fr-a" }, { id: "fr-b" }],
      clips: [{ id: "clip-a", suffix: "A" }], creationBrief: {},
    }],
  };
}
function approveFrame(P, value = "A.png", assetId = "asset-A") {
  return human(() => Kernel.approveFrameCanon(P, {
    shotId: "SH-01", frameId: "fr-a", value, assetId, at: AT, via: "o8-unit",
  }));
}
function approveMotion(P, value = "A.mp4", assetId = "asset-M") {
  return human(() => Kernel.approveMotionCanon(P, {
    shotId: "SH-01", unitKey: "clip-a", value, assetId, at: AT, via: "o8-unit",
  }));
}
function approveDelivery(P, value = "FINAL.png", assetId = "asset-D") {
  return human(() => Kernel.approveDeliveryCanon(P, {
    shotId: "SH-01", value, assetId, at: AT, via: "o8-unit",
  }));
}
function memoryBoundary(current, hooks = {}) {
  let stored = clone(current), writes = 0;
  const revision = () => '"' + crypto.createHash("sha256").update(JSON.stringify(stored)).digest("hex") + '"';
  const seam = createAuthorityWriteSeam({
    resolveFile: () => "project.json",
    exists: () => hooks.exists === undefined ? true : hooks.exists,
    readProject: () => clone(stored),
    revisionFor: () => hooks.exists === false ? "" : revision(),
    prepareSuccessor: hooks.prepareSuccessor,
    validateProject: () => ({ ok: true, errors: [] }),
    writeProject: (_file, successor) => { stored = clone(successor); writes += 1; },
  });
  return { seam, revision, stored: () => clone(stored), writes: () => writes };
}
function sameDocument(actual, expected, message) {
  assert.strictEqual(JSON.stringify(actual), JSON.stringify(expected), message);
}
function refuses(fn, code) {
  let error = null;
  try { fn(); } catch (caught) { error = caught; }
  assert(error, "expected refusal " + code);
  assert.strictEqual(error.code, code);
  return error;
}

const passed = [];
function scenario(id, body) {
  body();
  passed.push(id);
  console.log("[O8 unit] " + id + " PASS");
}

scenario("A-10", () => {
  const before = project(); approveFrame(before);
  delete before.shots[0].keyframes[0].winner;
  delete before.shots[0].keyframes[0].winnerAssetId;
  const after = clone(before); after.shots[0].keyframes.reverse();
  assert(canonComparison(before, after).requiresTransition, "keyframe reorder moved the fallback edge");
});
scenario("A-11", () => {
  const before = project(); approveMotion(before);
  const after = clone(before); after.shots[0].clips.push({ id: "decoy", suffix: "clip-a", videoWinner: "DECOY.mp4" });
  assert(canonComparison(before, after).requiresTransition, "suffix decoy made the motion edge ambiguous");
  assert.strictEqual(Kernel.hasCurrentHumanAuthority(after, { kind: "shot-motion", shotId: "SH-01", unitKey: "clip-a" }), false);
});
scenario("A-12", () => {
  const before = project(); approveFrame(before);
  const frame = before.shots[0].keyframes[0]; delete frame.winnerAssetId; frame.approvalIdentity = { winner: "asset-A" };
  const after = clone(before); delete after.shots[0].keyframes[0].approvalIdentity;
  assert(canonComparison(before, after).requiresTransition, "legacy identity removal destroys resolved Canon");
  const noReceipt = project(); noReceipt.shots[0].keyframes[0].winner = "X.png"; noReceipt.shots[0].keyframes[0].approvalIdentity = { winner: "asset-X" };
  assert.strictEqual(Kernel.hasCurrentHumanAuthority(noReceipt, { kind: "shot-frame", shotId: "SH-01", frameId: "fr-a" }), false);
});
scenario("A-13", () => {
  const before = project(); approveDelivery(before);
  const after = clone(before), shot = after.shots[0];
  delete shot.finalStillFile; delete shot.finalStillAssetId; delete shot.creationBrief.finalStillFile; delete shot.creationBrief.finalStillAssetId;
  shot.creationBrief.approvedMotionFile = "FINAL.png"; shot.creationBrief.approvedMotionAssetId = "asset-D";
  assert(canonComparison(before, after).requiresTransition, "delivery fallback changed resolution provenance");
});
scenario("A-14", () => {
  const P = project(); approveFrame(P);
  delete P.shots[0].keyframes[0].winnerAssetId;
  P.shots[0].approvalIdentity = { winner: "asset-A" };
  assert.strictEqual(Kernel.hasCurrentHumanAuthority(P, { kind: "shot-frame", shotId: "SH-01", frameId: "fr-a" }), false,
    "value and identity from different homes cannot satisfy one receipt");
});
scenario("A-15", () => {
  const before = project(); before.shots[0].keyframes[0].winner = "RAW.png";
  before.productionAuthority = { version: 1, receipts: [{ id: "", status: "current", kind: "shot-frame", shotId: "SH-01", frameId: "fr-a", targetKey: "shot-frame:SH-01#fr-a" }] };
  const after = clone(before); after.shots[0].keyframes[0].winner = "CHANGED.png";
  assert(canonComparison(before, after).requiresTransition, "raw damaged current row still freezes its edge");
});
scenario("A-16", () => {
  const before = project(), after = project(); approveFrame(after);
  assert(canonComparison(before, after).requiresTransition, "successor-only target belongs to the union domain");
});
scenario("A-17", () => {
  const before = project(); approveFrame(before);
  human(() => Private.revokeFrameCanon(before, { shotId: "SH-01", frameId: "fr-a", reason: "withdrawn", at: AT, clearEdge: false }));
  const after = clone(before); after.shots[0].keyframes[0].winner = "OTHER.png"; after.shots[0].winner = "OTHER.png";
  assert.strictEqual(canonComparison(before, after).requiresTransition, false, "revoked targets are ordinary editable history");
});
scenario("A-18", () => {
  const before = project(); approveFrame(before); approveMotion(before);
  const after = clone(before); after.productionAuthority.receipts.reverse();
  const result = canonComparison(before, after);
  assert.strictEqual(result.ledgerChanged, false); assert.strictEqual(result.requiresTransition, false);
});
scenario("A-20", () => {
  const before = project(), after = clone(before); after.shots[0].keyframes[0].winner = "HISTORIC.png";
  assert.strictEqual(canonComparison(before, after).requiresTransition, false, "receipt-less edge is not Canon");
});
scenario("A-22", () => {
  const before = project(); approveFrame(before);
  const after = clone(before), frame = after.shots[0].keyframes[0];
  delete frame.winner; delete frame.winnerAssetId;
  assert.deepStrictEqual({ ...Kernel.liveAuthorityEdge(before, { kind: "shot-frame", shotId: "SH-01", frameId: "fr-a" }) }.value, "A.png");
  assert(canonComparison(before, after).requiresTransition, "same value/identity at a different home is a tuple delta");
});
scenario("B-09", () => {
  const seamSource = fs.readFileSync(path.join(ROOT, "authority-write-seam.js"), "utf8");
  const serverSource = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const route = serverSource.slice(serverSource.indexOf('app.post("/api/projects/:slug/canon-transition"'), serverSource.indexOf('app.get("/api/projects/:slug/backups"'));
  assert(!/\bawait\b/.test(seamSource.slice(seamSource.indexOf("function persistProjectSuccessor"))));
  assert(!/\bawait\b/.test(route));
});
scenario("C-01", () => {
  const P = project(); approveFrame(P); const before = clone(P);
  refuses(() => Private.revokeFrameCanon(P, { shotId: "SH-01", frameId: "fr-a", reason: "withdrawn", at: AT }), "MANUAL_ACTION_REQUIRED");
  sameDocument(P, before, "negative control is non-mutating");
  human(() => Private.revokeFrameCanon(P, { shotId: "SH-01", frameId: "fr-a", reason: "withdrawn", at: AT }));
});
scenario("C-02", () => {
  const P = project(); approveFrame(P); const before = clone(P);
  human(() => refuses(() => Private.revokeFrameCanon(P, { shotId: "SH-01", frameId: "fr-a", reason: "invented", at: AT }), "AUTHORITY_REVOCATION_REASON_INVALID"));
  sameDocument(P, before);
});
scenario("C-03", () => {
  const humanP = project(); approveFrame(humanP);
  human(() => refuses(() => Private.revokeFrameCanon(humanP, { shotId: "SH-01", frameId: "fr-a", reason: "replaced", at: AT }), "AUTHORITY_REVOCATION_REASON_INVALID"));
  const systemP = project(); approveFrame(systemP);
  refuses(() => Private.systemInvalidateFrameCanon(systemP, { shotId: "SH-01", frameId: "fr-a", reason: "replaced", at: AT }), "AUTHORITY_REVOCATION_REASON_INVALID");
});
scenario("C-04", () => {
  const P = project(); approveDelivery(P);
  Private.systemInvalidateDeliveryCanon(P, { shotId: "SH-01", reason: "target-cleared", at: AT });
  assert.strictEqual(Kernel.hasCurrentHumanAuthority(P, { kind: "shot-delivery", shotId: "SH-01" }), false);
});
scenario("C-05", () => {
  const P = project(); const receipt = approveDelivery(P);
  Private.systemInvalidateDeliveryCanon(P, { shotId: "SH-01", reason: "target-cleared", at: AT });
  const row = P.productionAuthority.receipts.find((item) => item.id === receipt.id);
  assert.strictEqual(row.revokedBy, "system"); assert(!("revocationProvenance" in row));
});
scenario("C-07", () => {
  const P = project(); approveFrame(P); approveDelivery(P);
  Private.systemInvalidateDeliveryCanon(P, { shotId: "SH-01", reason: "target-cleared", at: AT });
  assert(Kernel.hasCurrentHumanAuthority(P, { kind: "shot-frame", shotId: "SH-01", frameId: "fr-a" }), "unrelated authority remains, never newly granted");
});
scenario("C-08", () => {
  const P = project(); approveDelivery(P); P.productionAuthority.receipts.push({ id: "bad", status: "current" });
  refuses(() => Private.systemInvalidateDeliveryCanon(P, { shotId: "SH-01", reason: "target-cleared", at: AT }), "AUTHORITY_LEDGER_UNTRUSTED");
  assert.strictEqual(Kernel.hasCurrentHumanAuthority(P, { kind: "shot-delivery", shotId: "SH-01" }), false, "untrusted ledger cannot flip into a grant");
});
scenario("C-09", () => {
  const P = project(); approveFrame(P);
  human(() => Private.revokeFrameCanon(P, { shotId: "SH-01", frameId: "fr-a", reason: "withdrawn", at: AT }));
  P.shots[0].keyframes[0].winner = "A.png"; P.shots[0].winner = "A.png";
  assert.strictEqual(Kernel.hasCurrentHumanAuthority(P, { kind: "shot-frame", shotId: "SH-01", frameId: "fr-a" }), false);
});
scenario("C-11", () => {
  const P = project(); P.shots[0].keyframes[0].winner = "HISTORIC.png"; const before = clone(P);
  human(() => refuses(() => Private.revokeFrameCanon(P, { shotId: "SH-01", frameId: "fr-a", reason: "withdrawn", at: AT }), "AUTHORITY_CURRENT_RECEIPT_REQUIRED"));
  sameDocument(P, before);
});
scenario("C-12", () => {
  const P = project(); approveFrame(P); P.productionAuthority.receipts.push({ id: "bad", status: "current" }); const before = clone(P);
  human(() => refuses(() => Private.revokeFrameCanon(P, { shotId: "SH-01", frameId: "fr-a", reason: "withdrawn", at: AT }), "AUTHORITY_LEDGER_UNTRUSTED"));
  refuses(() => Private.systemInvalidateFrameCanon(P, { shotId: "SH-01", frameId: "fr-a", reason: "target-cleared", at: AT }), "AUTHORITY_LEDGER_UNTRUSTED");
  sameDocument(P, before);
});
scenario("C-13", () => {
  const allowed = new Set(["creation-studio.js", "library-tools.js", "mutations.js"]);
  const callers = [];
  for (const name of fs.readdirSync(path.join(ROOT, "public")).filter((name) => name.endsWith(".js"))) {
    const body = fs.readFileSync(path.join(ROOT, "public", name), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    if (/\b(?:revoke(?:Frame|Motion|Delivery|EntityState)Canon|systemInvalidate(?:Frame|Motion|Delivery|EntityState)Canon|repairCanonValue)\b/.test(body)
      && name !== "shared-authority-kernel.js") callers.push(name);
  }
  assert.deepStrictEqual(callers.sort(), [...allowed].sort(), "every destructive/repair caller is classified");
});
scenario("C-14", () => {
  const P = project(); approveFrame(P);
  human(() => Private.revokeFrameCanon(P, { shotId: "SH-01", frameId: "fr-a", reason: "withdrawn", at: AT, clearEdge: false }));
  assert.deepStrictEqual([...Private.repairCanonValue(P, { kind: "shot-frame", shotId: "SH-01", frameId: "fr-a", from: "A.png", to: "B.png", assetId: "asset-A" })], []);
});
scenario("C-15", () => {
  const P = project(); approveFrame(P); P.shots[0].keyframes[0].approvalIdentity = { winner: "asset-A" };
  human(() => Private.revokeFrameCanon(P, { shotId: "SH-01", frameId: "fr-a", reason: "withdrawn", at: AT }));
  assert.strictEqual(P.shots[0].keyframes[0].approvalIdentity, undefined);
});
scenario("D-01", () => {
  const P = project(); P.productionAuthority = { version: 1, receipts: [{ id: "broken", status: "current" }] };
  const diagnostics = Kernel.authorityLedgerDiagnostics(P);
  assert(diagnostics.some((row) => row.index === 0 && row.id === "broken"));
});
scenario("D-03", () => {
  const current = project(); current.productionAuthority = { version: 1, receipts: [{ id: "broken", status: "current" }] };
  const successor = project(); approveFrame(successor);
  const mem = memoryBoundary(current), outcome = mem.seam.persistProjectSuccessor({ slug: "p", successor, writeClass: WRITE_CLASSES.RECOVERY, transitionMetadata: {} });
  assert.strictEqual(outcome.ok, false); assert.strictEqual(outcome.refusal.code, "AUTHORITY_RECOVERY_UNSAFE");
});
scenario("D-04", () => {
  const valid = project(); approveFrame(valid);
  const current = clone(valid); current.productionAuthority.receipts.push({ id: "broken", status: "current" });
  const mem = memoryBoundary(current), outcome = mem.seam.persistProjectSuccessor({ slug: "p", successor: valid, writeClass: WRITE_CLASSES.RECOVERY, transitionMetadata: {} });
  assert.strictEqual(outcome.ok, false, "row removal cannot salvage a current grant");
});
scenario("D-10", () => {
  const current = project(); current.productionAuthority = { version: 99, receipts: [] };
  const successor = project(); successor.productionAuthority = { version: 1, receipts: [] };
  const mem = memoryBoundary(current), outcome = mem.seam.persistProjectSuccessor({ slug: "p", successor, writeClass: WRITE_CLASSES.RECOVERY, transitionMetadata: {} });
  assert.strictEqual(outcome.refusal.code, "AUTHORITY_LEDGER_COMPATIBILITY_REQUIRED");
});
scenario("D-14", () => {
  const current = project(); current.shots[0].keyframes[0].winner = "HISTORIC.png"; current.productionAuthority = { version: 1, receipts: [{ id: "broken", status: "current" }] };
  const successor = clone(current); successor.productionAuthority = { version: 1, receipts: [] };
  const mem = memoryBoundary(current), outcome = mem.seam.persistProjectSuccessor({ slug: "p", successor, writeClass: WRITE_CLASSES.RECOVERY, transitionMetadata: { mode: "QUARANTINE" } });
  assert(outcome.ok); assert.strictEqual(Authority.authorityReceipts(outcome.successor).filter((row) => row.status === "current").length, 0);
});
scenario("E-02", () => {
  assert.strictEqual(Authority.PRODUCTION_AUTHORITY_LEDGER_KEY, undefined);
  assert.strictEqual(Authority.AUTHORITY_LEDGER_KEY, undefined);
});
scenario("E-06", () => {
  const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  assert(server.includes('Object.prototype.hasOwnProperty.call(project, "productionAuthority")'));
});
scenario("E-07", () => {
  const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  assert.strictEqual((server.match(/atomicWriteJson\(/g) || []).length, 2, "definition plus enrolled boundary call only");
  assert(!/fs\.(?:writeFileSync|copyFileSync|cpSync|renameSync)\([^\n]*["']project\.json["']/.test(server));
});
scenario("E-12", () => {
  const mem = memoryBoundary(project());
  const outcome = mem.seam.persistProjectSuccessor({ slug: "p", successor: project() });
  assert.strictEqual(outcome.ok, false); assert.strictEqual(outcome.refusal.code, "WRITE_CLASS_REQUIRED"); assert.strictEqual(mem.writes(), 0);
});
scenario("H-01", () => {
  const pkg = require("../package.json");
  assert(/check:authority-browser/.test(pkg.scripts["check:ci"] || ""), "check:ci must execute the O8 real-Chromium suite");
});

const EXPECTED = [
  "A-10", "A-11", "A-12", "A-13", "A-14", "A-15", "A-16", "A-17", "A-18", "A-20", "A-22",
  "B-09",
  "C-01", "C-02", "C-03", "C-04", "C-05", "C-07", "C-08", "C-09", "C-11", "C-12", "C-13", "C-14", "C-15",
  "D-01", "D-03", "D-04", "D-10", "D-14",
  "E-02", "E-06", "E-07", "E-12", "H-01",
];
assert.deepStrictEqual(passed, EXPECTED);
assert.strictEqual(passed.length, 35);
console.log("Authority Write Seam O8 unit acceptance: 35/35 unique unit scenarios passed; provider calls: 0.");

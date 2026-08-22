"use strict";

/* O8 Authority Write Seam — server acceptance.
 *
 * Primary accounting is the 41 scenarios assigned to the server column in the
 * frozen O8 matrix. The 18 secondary executions are printed and counted
 * separately. Every server is isolated under os.tmpdir(); no provider route is
 * configured or called.
 */
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { startCineBraidServer } = require("./fixtures/mock-civitai");
const { Kernel, Private } = require("./authority-kernel-private");
const Authority = require("../public/shared-production-authority");
const { installTestManualActionSource } = require("./authority-test-gesture");

const ROOT = path.join(__dirname, "..");
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-o8-server-"));
const PROJECTS_ROOT = path.join(TEMP, "projects");
const PROJECT_DIR = path.join(PROJECTS_ROOT, "o8-project");
const PROJECT_FILE = path.join(PROJECT_DIR, "project.json");
const CONFIG_PATH = path.join(TEMP, "config.json");
const MANUAL = installTestManualActionSource(Kernel);
const human = (body) => MANUAL.gesture(body);
const clone = (value) => JSON.parse(JSON.stringify(value));
const AT = (n = 0) => `2026-08-22T12:${String(n).padStart(2, "0")}:00.000Z`;

let server = null;
const primaryPassed = [];
const secondaryPassed = [];

function baseProject(title = "O8 Server") {
  return {
    meta: {
      title, format: "Test", version: "v1", hubVersion: "v6.0.0",
      schemaVersion: "6.6", aiPolicy: "project-default", world: {},
    },
    qcChecklist: [], characters: [], locations: [], props: [], vehicles: [],
    audio: [], mediaAssets: [], jobs: [], agentRuns: [], decisions: [],
    sessions: [], finishJobs: [],
    scenes: [{ id: "SC-01", title: "Scene", whatHappens: "A test beat.", howItFeels: "Exact." }],
    shots: [{
      id: "SH-01", scene: "SC-01", title: "Shot", desc: "A test shot.",
      positioning: "Locked frame.", dur: 5, workflowStatus: "DRAFT",
      characters: [], codes: [], risks: [], candidateFiles: [], creationBrief: {},
      keyframes: [
        { id: "fr-a", label: "A", title: "Opening", description: "Opening frame.", generationPackages: [] },
        { id: "fr-b", label: "B", title: "Ending", description: "Ending frame.", generationPackages: [] },
      ],
      clips: [{
        id: "clip-a", suffix: "A", label: "A", title: "Move", kind: "i2v",
        fromFrame: "fr-a", dur: 5, motionPrompt: "A controlled move.", generationPackages: [],
      }],
    }],
  };
}

function ensureProjectDir(dir = PROJECT_DIR) {
  fs.mkdirSync(dir, { recursive: true });
  for (const name of ["anchors", "plates", "props", "vehicles", "audio", "media", "shots", "docs"])
    fs.mkdirSync(path.join(dir, name), { recursive: true });
}

function writeProject(project, file = PROJECT_FILE) {
  ensureProjectDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(project, null, 2) + "\n");
}

function stored(file = PROJECT_FILE) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function revision(file = PROJECT_FILE) {
  return `"${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}"`;
}

function approveFrame(project, frameId = "fr-a", value = "A.png", assetId = "asset-A", minute = 1) {
  return human(() => Kernel.approveFrameCanon(project, {
    shotId: "SH-01", frameId, value, assetId, at: AT(minute), via: "o8-server",
  }));
}

function approveMotion(project, value = "A.mp4", assetId = "asset-M", minute = 2) {
  return human(() => Kernel.approveMotionCanon(project, {
    shotId: "SH-01", unitKey: "clip-a", value, assetId, at: AT(minute), via: "o8-server",
  }));
}

function approveDelivery(project, value = "FINAL.png", assetId = "asset-D", minute = 3) {
  return human(() => Kernel.approveDeliveryCanon(project, {
    shotId: "SH-01", value, assetId, at: AT(minute), via: "o8-server",
  }));
}

async function normal(successor, expectedRevision = revision()) {
  return server.request("/api/projects/o8-project/project", {
    method: "PUT",
    headers: { "content-type": "application/json", "if-match": expectedRevision },
    body: JSON.stringify(successor),
  });
}

async function transition(current, successor, expectedRevision = revision(), declaration = null) {
  return server.request("/api/projects/o8-project/canon-transition", {
    method: "POST",
    headers: { "content-type": "application/json", "if-match": expectedRevision },
    body: JSON.stringify({
      successor,
      transition: declaration || Kernel.authorityWriteTransition(current, successor).declaration,
    }),
  });
}

async function primary(id, body) {
  await body();
  primaryPassed.push(id);
  console.log(`[O8 server] ${id} PASS`);
}

async function secondary(id, body) {
  await body();
  secondaryPassed.push(id);
  console.log(`[O8 server secondary] ${id} PASS`);
}

function unchanged(before, message) {
  assert.strictEqual(JSON.stringify(stored()), JSON.stringify(before), message);
}

async function expectStatus(resultPromise, status, code) {
  const result = await resultPromise;
  assert.strictEqual(result.status, status, JSON.stringify(result.body));
  if (code) assert.strictEqual(result.body?.code, code, JSON.stringify(result.body));
  return result;
}

function reset(project = baseProject()) {
  writeProject(project);
  return clone(project);
}

async function normalRefusalScenarios() {
  await primary("A-01", async () => {
    const current = reset(), successor = clone(current); approveFrame(successor);
    await expectStatus(normal(successor), 422, "CANON_TRANSITION_REQUIRED"); unchanged(current);
  });
  await primary("A-02", async () => {
    const current = baseProject(); approveFrame(current); reset(current);
    const successor = clone(current); delete successor.productionAuthority;
    await expectStatus(normal(successor), 422, "CANON_TRANSITION_REQUIRED"); unchanged(current);
  });
  await primary("A-03", async () => {
    const current = baseProject(); approveFrame(current); reset(current);
    const successor = clone(current); successor.productionAuthority.receipts[0].actor = "automation";
    await expectStatus(normal(successor), 422, "CANON_TRANSITION_REQUIRED"); unchanged(current);
  });
  await primary("A-04", async () => {
    const current = baseProject(); approveFrame(current); reset(current);
    const successor = clone(current); successor.productionAuthority.version += 1;
    await expectStatus(normal(successor), 422, "CANON_TRANSITION_REQUIRED"); unchanged(current);
  });
  await primary("A-05", async () => {
    const approved = baseProject(); approveFrame(approved);
    const current = clone(approved); delete current.shots[0].keyframes[0].winner; delete current.shots[0].keyframes[0].winnerAssetId;
    delete current.shots[0].winner; delete current.shots[0].winnerAssetId; reset(current);
    await expectStatus(normal(approved), 422, "CANON_TRANSITION_REQUIRED"); unchanged(current);
  });
  await primary("A-06", async () => {
    const current = baseProject(); approveFrame(current); reset(current);
    const successor = clone(current); delete successor.shots[0].keyframes[0].winner; delete successor.shots[0].keyframes[0].winnerAssetId;
    delete successor.shots[0].winner; delete successor.shots[0].winnerAssetId;
    await expectStatus(normal(successor), 422, "CANON_TRANSITION_REQUIRED"); unchanged(current);
  });
  await primary("A-07", async () => {
    const current = baseProject(); approveFrame(current); reset(current);
    const orphan = clone(current); delete orphan.productionAuthority;
    delete orphan.shots[0].keyframes[0].winner; delete orphan.shots[0].keyframes[0].winnerAssetId;
    const readopt = clone(orphan); readopt.shots[0].keyframes[0].winner = "A.png"; readopt.shots[0].keyframes[0].winnerAssetId = "asset-A";
    await expectStatus(normal(orphan), 422, "CANON_TRANSITION_REQUIRED");
    await expectStatus(normal(readopt), 422, "CANON_TRANSITION_REQUIRED");
    unchanged(current, "neither half of orphan-and-readopt may reach disk");
  });
  await primary("A-08", async () => {
    const current = baseProject(); approveFrame(current); reset(current);
    const successor = clone(current); successor.meta.notes = "ordinary edit";
    const result = await expectStatus(normal(successor), 200);
    assert(result.body.revision && result.body.revision !== "");
    assert(Kernel.hasCurrentHumanAuthority(stored(), { kind: "shot-frame", shotId: "SH-01", frameId: "fr-a" }));
  });
  await primary("A-09", async () => {
    const current = baseProject(); approveFrame(current); reset(current);
    const successor = clone(current); successor.meta.title = "Display Rename";
    await expectStatus(normal(successor), 200);
    assert.strictEqual(stored().meta.title, "Display Rename");
  });
  await primary("A-19", async () => {
    const current = baseProject(); approveFrame(current, "fr-a", "STORED.png", "asset-stored"); reset(current);
    const successor = clone(current); successor.shots[0].keyframes[0].winner = "MUTATED.png";
    const result = await expectStatus(normal(successor), 422, "CANON_TRANSITION_REQUIRED");
    const target = result.body.targets.find((row) => row.targetKey === "shot-frame:SH-01#fr-a");
    assert.deepStrictEqual({ value: target.value, assetId: target.assetId }, { value: "STORED.png", assetId: "asset-stored" });
  });
  await primary("A-21", async () => {
    let current = baseProject(); approveFrame(current); reset(current);
    let successor = clone(current);
    human(() => Private.revokeFrameCanon(successor, { shotId: "SH-01", frameId: "fr-a", reason: "target-removed", at: AT(9), clearEdge: false }));
    successor.shots = [];
    await expectStatus(normal(successor), 200);
    assert.strictEqual(stored().shots.length, 0);

    current = baseProject(); approveFrame(current); reset(current); successor = clone(current);
    human(() => Private.revokeFrameCanon(successor, { shotId: "SH-01", frameId: "fr-a", reason: "target-removed", at: AT(10), clearEdge: false }));
    successor.shots = []; successor.scenes = [];
    await expectStatus(normal(successor), 200);
    assert.strictEqual(stored().scenes.length, 0);
  });
}

async function secondaryNormalOracleScenarios() {
  await secondary("A-10", async () => {
    const current = baseProject(); approveFrame(current);
    delete current.shots[0].keyframes[0].winner; delete current.shots[0].keyframes[0].winnerAssetId; reset(current);
    const successor = clone(current); successor.shots[0].keyframes.reverse();
    await expectStatus(normal(successor), 422, "CANON_TRANSITION_REQUIRED");
  });
  await secondary("A-11", async () => {
    const current = baseProject(); approveMotion(current); reset(current);
    const successor = clone(current); successor.shots[0].clips.push({ id: "decoy", suffix: "clip-a", videoWinner: "DECOY.mp4" });
    await expectStatus(normal(successor), 422, "CANON_TRANSITION_REQUIRED");
  });
  await secondary("A-12", async () => {
    const current = baseProject(); approveFrame(current);
    delete current.shots[0].keyframes[0].winnerAssetId; current.shots[0].keyframes[0].approvalIdentity = { winner: "asset-A" }; reset(current);
    const successor = clone(current); delete successor.shots[0].keyframes[0].approvalIdentity;
    await expectStatus(normal(successor), 422, "CANON_TRANSITION_REQUIRED");
  });
  await secondary("A-13", async () => {
    const current = baseProject(); approveDelivery(current); reset(current);
    const successor = clone(current), shot = successor.shots[0];
    delete shot.finalStillFile; delete shot.finalStillAssetId; delete shot.creationBrief.finalStillFile; delete shot.creationBrief.finalStillAssetId;
    shot.creationBrief.approvedMotionFile = "FINAL.png"; shot.creationBrief.approvedMotionAssetId = "asset-D";
    await expectStatus(normal(successor), 422, "CANON_TRANSITION_REQUIRED");
  });
  await secondary("A-14", async () => {
    const current = baseProject(); approveFrame(current);
    delete current.shots[0].keyframes[0].winnerAssetId; current.shots[0].approvalIdentity = { winner: "asset-A" }; reset(current);
    const opened = await expectStatus(server.request("/api/projects/o8-project/project"), 200);
    assert.strictEqual(Authority.hasCurrentHumanAuthority(opened.body, { kind: "shot-frame", shotId: "SH-01", frameId: "fr-a" }), false,
      "value and identity from different homes cannot satisfy a receipt through the server read path");
  });
  await secondary("A-15", async () => {
    const current = baseProject(); current.shots[0].keyframes[0].winner = "RAW.png";
    current.productionAuthority = { version: 1, receipts: [{ id: "broken", status: "current", kind: "shot-frame", shotId: "SH-01", frameId: "fr-a", targetKey: "shot-frame:SH-01#fr-a" }] }; reset(current);
    const successor = clone(current); successor.shots[0].keyframes[0].winner = "CHANGED.png";
    await expectStatus(normal(successor), 422, "CANON_TRANSITION_REQUIRED");
  });
  await secondary("A-16", async () => {
    const current = baseProject(); approveFrame(current); reset(current);
    const successor = clone(current); successor.productionAuthority.receipts[0].status = "revoked"; successor.productionAuthority.receipts[0].revokedAt = AT(12);
    successor.productionAuthority.receipts[0].revocationReason = "withdrawn"; successor.productionAuthority.receipts[0].revokedBy = "human";
    await expectStatus(normal(successor), 422, "CANON_TRANSITION_REQUIRED");
  });
  await secondary("A-17", async () => {
    const current = baseProject(); approveFrame(current);
    human(() => Private.revokeFrameCanon(current, { shotId: "SH-01", frameId: "fr-a", reason: "withdrawn", at: AT(13) })); reset(current);
    const successor = clone(current); successor.shots[0].keyframes[0].winner = "HISTORIC.png";
    await expectStatus(normal(successor), 200);
    assert.strictEqual(Kernel.hasCurrentHumanAuthority(stored(), { kind: "shot-frame", shotId: "SH-01", frameId: "fr-a" }), false);
  });
  await secondary("A-18", async () => {
    const current = baseProject(); approveFrame(current, "fr-a", "A.png", "asset-A", 1); approveFrame(current, "fr-b", "B.png", "asset-B", 2); reset(current);
    const successor = clone(current); successor.productionAuthority.receipts.reverse(); successor.meta.notes = "permutation";
    await expectStatus(normal(successor), 200);
  });
}

async function transitionScenarios() {
  await primary("B-01", async () => {
    const current = reset(), beforeRevision = revision(), successor = clone(current); approveFrame(successor);
    const result = await expectStatus(transition(current, successor, beforeRevision), 200);
    assert.notStrictEqual(result.body.revision, beforeRevision);
    assert.strictEqual(stored().productionAuthority.receipts.length, 1);
  });
  await primary("B-03", async () => {
    const current = reset(), successor = clone(current); approveFrame(successor); const before = stored();
    await expectStatus(transition(current, successor, '"stale"'), 409, "PROJECT_REVISION_CONFLICT"); unchanged(before);
  });
  await primary("B-04", async () => {
    const current = reset(), successor = clone(current); approveFrame(successor); const before = stored();
    const declaration = Kernel.authorityWriteTransition(current, successor).declaration;
    declaration.receiptIds = [];
    await expectStatus(transition(current, successor, revision(), declaration), 422, "CANON_DECLARATION_MISMATCH");
    unchanged(before, "no edge may be half-applied when the transition is refused");
  });
  await primary("B-05", async () => {
    const current = reset(), successor = clone(current); approveFrame(successor);
    delete successor.shots[0].keyframes[0].winner; delete successor.shots[0].keyframes[0].winnerAssetId; delete successor.shots[0].winner; delete successor.shots[0].winnerAssetId;
    const before = stored();
    await expectStatus(transition(current, successor), 422); unchanged(before, "no ledger may be half-applied");
  });
  await primary("B-06", async () => {
    const current = reset(), successor = clone(current); approveFrame(successor); const oldRevision = revision();
    await expectStatus(transition(current, successor, oldRevision), 200); const once = stored();
    await expectStatus(transition(current, successor, oldRevision), 409, "PROJECT_REVISION_CONFLICT"); unchanged(once);
    assert.strictEqual(once.productionAuthority.receipts.length, 1, "a replay cannot mint a duplicate receipt");
  });
  await primary("B-07", async () => {
    const current = reset(), successor = clone(current);
    human(() => {
      Kernel.approveFrameCanon(successor, { shotId: "SH-01", frameId: "fr-a", value: "A.png", assetId: "asset-A", at: AT(1), via: "o8-list" });
      Kernel.approveFrameCanon(successor, { shotId: "SH-01", frameId: "fr-b", value: "B.png", assetId: "asset-B", at: AT(2), via: "o8-list" });
    });
    const beforeRevision = revision(), result = await expectStatus(transition(current, successor, beforeRevision), 200);
    assert.notStrictEqual(result.body.revision, beforeRevision); assert.strictEqual(stored().productionAuthority.receipts.length, 2);
  });
  await primary("B-10", async () => {
    const current = reset(), successor = clone(current); approveFrame(successor, "fr-a", "A.png", "asset-A", 1); approveFrame(successor, "fr-b", "B.png", "asset-B", 2);
    const declaration = Kernel.authorityWriteTransition(current, successor).declaration;
    declaration.targetKeys = declaration.targetKeys.filter((key) => !key.includes("fr-b"));
    await expectStatus(transition(current, successor, revision(), declaration), 422, "CANON_DECLARATION_MISMATCH");
  });
  await primary("B-11", async () => {
    const current = reset(), successor = clone(current); approveFrame(successor);
    successor.productionAuthority.receipts.push({ id: "malformed-added", status: "current", kind: "shot-frame", shotId: "SH-01", frameId: "fr-b" });
    await expectStatus(transition(current, successor), 422);
  });
  await primary("B-12", async () => {
    const current = reset(), successor = clone(current); approveFrame(successor); successor.shots[0].keyframes[0].winner = "NOT-A.png";
    await expectStatus(transition(current, successor), 422);
  });
}

async function invalidationScenarios() {
  await primary("C-06", async () => {
    const current = reset(), automated = clone(current); approveFrame(automated);
    await expectStatus(normal(automated), 422, "CANON_TRANSITION_REQUIRED");
    assert.strictEqual(Authority.hasCurrentHumanAuthority(stored(), { kind: "shot-frame", shotId: "SH-01", frameId: "fr-a" }), false);
  });
  await primary("C-10", async () => {
    let current = baseProject(); approveFrame(current); approveMotion(current); reset(current);
    let successor = clone(current);
    approveFrame(successor, "fr-a", "B.png", "asset-B", 4);
    Private.systemInvalidateMotionCanon(successor, { shotId: "SH-01", unitKey: "clip-a", reason: "target-cleared", at: AT(5) });
    await expectStatus(transition(current, successor), 200);
    assert.strictEqual(Authority.hasCurrentHumanAuthority(stored(), { kind: "shot-motion", shotId: "SH-01", unitKey: "clip-a" }), false);

    current = baseProject(); approveMotion(current); reset(current); successor = clone(current);
    Private.systemInvalidateMotionCanon(successor, { shotId: "SH-01", unitKey: "clip-a", reason: "target-cleared", at: AT(6) });
    await expectStatus(transition(current, successor), 422, "SYSTEM_INVALIDATION_PRECONDITION_FAILED");
  });
  await secondary("C-05", async () => {
    const current = baseProject(); approveFrame(current); const receipt = approveMotion(current); reset(current);
    const successor = clone(current); approveFrame(successor, "fr-a", "B.png", "asset-B", 7);
    Private.systemInvalidateMotionCanon(successor, { shotId: "SH-01", unitKey: "clip-a", reason: "target-cleared", at: AT(8) });
    await expectStatus(transition(current, successor), 200);
    const row = stored().productionAuthority.receipts.find((item) => item.id === receipt.id);
    assert.strictEqual(row.revokedBy, "system"); assert.strictEqual("revocationProvenance" in row, false);
  });
  await secondary("C-07", async () => {
    const current = baseProject(); approveFrame(current); approveMotion(current); approveDelivery(current); reset(current);
    const successor = clone(current); approveFrame(successor, "fr-a", "B.png", "asset-B", 9);
    Private.systemInvalidateMotionCanon(successor, { shotId: "SH-01", unitKey: "clip-a", reason: "target-cleared", at: AT(10) });
    await expectStatus(transition(current, successor), 200);
    assert(Authority.hasCurrentHumanAuthority(stored(), { kind: "shot-delivery", shotId: "SH-01" }), "unrelated authority remains exactly as stored");
  });
  await secondary("C-08", async () => {
    const current = baseProject(); current.productionAuthority = { version: 1, receipts: [{ id: "bad", status: "current" }] }; reset(current);
    const successor = clone(current); successor.shots[0].keyframes[0].winner = "FORGED.png";
    await expectStatus(transition(current, successor), 422, "AUTHORITY_LEDGER_UNTRUSTED");
    assert.strictEqual(Authority.hasCurrentHumanAuthority(stored(), { kind: "shot-frame", shotId: "SH-01", frameId: "fr-a" }), false);
  });
  await secondary("C-09", async () => {
    const current = baseProject(); approveFrame(current);
    human(() => Private.revokeFrameCanon(current, { shotId: "SH-01", frameId: "fr-a", reason: "withdrawn", at: AT(11) })); reset(current);
    const successor = clone(current); successor.shots[0].keyframes[0].winner = "A.png"; successor.shots[0].keyframes[0].winnerAssetId = "asset-A";
    await expectStatus(normal(successor), 200);
    assert.strictEqual(Authority.hasCurrentHumanAuthority(stored(), { kind: "shot-frame", shotId: "SH-01", frameId: "fr-a" }), false);
  });
}

async function recoveryScenarios() {
  const damaged = () => {
    const project = baseProject();
    project.productionAuthority = { version: 1, receipts: [{ id: "broken-row", status: "current" }] };
    return project;
  };
  await primary("D-02", async () => {
    const current = damaged(); reset(current); const successor = baseProject();
    await expectStatus(normal(successor), 422, "CANON_TRANSITION_REQUIRED"); unchanged(current);
  });
  await primary("D-05", async () => {
    reset(damaged());
    const recovered = await expectStatus(server.request("/api/projects/o8-project/authority/recover", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "QUARANTINE" }),
    }), 200);
    const evidence = path.join(PROJECT_DIR, "backups", recovered.body.evidence);
    assert(fs.existsSync(evidence));
    for (let index = 0; index < 14; index += 1)
      await expectStatus(server.request("/api/projects/o8-project/backups", { method: "POST" }), 200);
    assert(fs.existsSync(evidence), "recovery evidence is not part of the ten-backup eviction ring");
    assert.strictEqual(JSON.parse(fs.readFileSync(evidence, "utf8")).project.productionAuthority.receipts[0].id, "broken-row");
  });
  await primary("D-06", async () => {
    reset(damaged());
    const result = await expectStatus(server.request("/api/projects/o8-project/authority/recover", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "QUARANTINE" }),
    }), 200);
    assert.strictEqual(result.body.currentReceipts, 0); assert.deepStrictEqual(stored().productionAuthority.receipts, []);
  });
  await primary("D-07", async () => {
    reset(damaged());
    const recovered = await expectStatus(server.request("/api/projects/o8-project/authority/recover", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "QUARANTINE" }),
    }), 200);
    const opened = await expectStatus(server.request("/api/projects/o8-project/project"), 200);
    opened.body.meta.notes = "operable";
    await expectStatus(normal(opened.body, recovered.body.revision), 200);
  });
  await primary("D-09", async () => {
    reset(baseProject());
    await expectStatus(server.request("/api/projects/o8-project/authority/recover", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "QUARANTINE" }),
    }), 409, "AUTHORITY_RECOVERY_NOT_REQUIRED");
  });
  await primary("D-11", async () => {
    reset(damaged());
    await expectStatus(server.request("/api/projects/o8-project/authority/recover", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "QUARANTINE", productionAuthority: { version: 1, receipts: [] } }),
    }), 400, "RECOVERY_CLIENT_LEDGER_FORBIDDEN");
  });
  await primary("D-12", async () => {
    reset(damaged());
    await expectStatus(server.request("/api/projects/o8-project/authority/recover", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "QUARANTINE" }),
    }), 200);
    const once = stored();
    await expectStatus(server.request("/api/projects/o8-project/authority/recover", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "QUARANTINE" }),
    }), 409, "AUTHORITY_RECOVERY_NOT_REQUIRED"); unchanged(once);
  });
  await primary("D-13", async () => {
    reset(damaged());
    const result = await expectStatus(server.request("/api/projects/o8-project/authority/recover", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "QUARANTINE" }),
    }), 200);
    assert(result.body.accounting.some((row) => row.disposition === "QUARANTINED" && row.index === 0 && row.id === "broken-row" && row.diagnostic));
  });
  await secondary("D-01", async () => {
    reset(damaged());
    const result = await expectStatus(server.request("/api/projects/o8-project/authority/recover", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "QUARANTINE" }),
    }), 200);
    assert(result.body.diagnostics.some((row) => row.index === 0 && row.id === "broken-row"));
  });
  await secondary("D-03", async () => {
    reset(damaged());
    await expectStatus(server.request("/api/projects/o8-project/authority/recover", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "QUARANTINE" }),
    }), 200);
    assert.strictEqual(Authority.authorityReceipts(stored()).filter((row) => row.status === "current").length, 0);
  });
  await secondary("D-04", async () => {
    const current = damaged(); current.productionAuthority.receipts.push({ id: "also-broken", status: "current" }); reset(current);
    await expectStatus(server.request("/api/projects/o8-project/authority/recover", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "QUARANTINE" }),
    }), 200);
    assert.deepStrictEqual(stored().productionAuthority.receipts, [], "no malformed row is salvaged into authority");
  });
  await secondary("D-10", async () => {
    const current = baseProject(); current.productionAuthority = { version: 99, receipts: [] }; reset(current); const before = stored();
    await expectStatus(server.request("/api/projects/o8-project/authority/recover", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "QUARANTINE" }),
    }), 409, "AUTHORITY_LEDGER_COMPATIBILITY_REQUIRED"); unchanged(before);
  });
  await secondary("D-14", async () => {
    reset(damaged());
    await expectStatus(server.request("/api/projects/o8-project/authority/recover", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "QUARANTINE" }),
    }), 200);
    assert.strictEqual(Authority.authorityReceipts(stored()).filter((row) => row.status === "current").length, 0);
  });
}

async function importScenarios() {
  const source = baseProject("Authority Import");
  approveFrame(source); approveMotion(source); approveDelivery(source);
  source.characters = [{
    id: "CHAR-01", name: "Character", approvedFile: "CHAR.png", approvedAssetId: "asset-char",
    continuityStates: [{ id: "state-default", name: "Default", isDefault: true, approvedFile: "STATE.png", approvedAssetId: "asset-state" }],
  }];
  source.shots[0].approvalIdentity = { winner: "asset-shot" };
  source.shots[0].clips[0].approvalIdentity = { videoWinner: "asset-M" };

  let preview = null, importedSlug = "";
  await primary("E-01", async () => {
    preview = await expectStatus(server.request("/api/projects/preview-import-json", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: source }),
    }), 200);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(preview.body.normalizedProject, "productionAuthority"), false);
    const committed = await expectStatus(server.request("/api/projects/import-json", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ previewToken: preview.body.previewToken, previewHash: preview.body.previewHash }),
    }), 200);
    importedSlug = committed.body.slug;
    assert.strictEqual(Object.prototype.hasOwnProperty.call(stored(path.join(PROJECTS_ROOT, importedSlug, "project.json")), "productionAuthority"), false);
  });
  await primary("E-03", async () => {
    const imported = stored(path.join(PROJECTS_ROOT, importedSlug, "project.json"));
    const shot = imported.shots[0], entity = imported.characters[0];
    assert.strictEqual(shot.keyframes[0].winner, null); assert.strictEqual(shot.clips[0].videoWinner, undefined);
    assert.strictEqual(shot.finalStillFile, undefined); assert.strictEqual(shot.approvalIdentity, undefined);
    assert.strictEqual(entity.approvedFile, ""); assert.strictEqual(entity.continuityStates[0].approvedFile, "");
  });
  await primary("E-04", async () => {
    const exported = await expectStatus(server.request("/api/export", { method: "POST" }), 200);
    const markdown = fs.readFileSync(exported.body.path, "utf8");
    assert(!/approved:\s*(?:A\.png|A\.mp4|FINAL\.png)/i.test(markdown));
    assert(!markdown.includes("✓"), "an authority-less imported edge is not marked approved");
  });
  await primary("E-05", async () => {
    const ordinary = baseProject("Plain Import"); ordinary.meta.notes = "preserve this planning note";
    const result = await expectStatus(server.request("/api/projects/preview-import-json", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: ordinary }),
    }), 200);
    assert.strictEqual(result.body.normalizedProject.meta.notes, ordinary.meta.notes);
    assert.strictEqual(result.body.normalizedProject.shots[0].desc, ordinary.shots[0].desc);
  });
}

async function restoreScenarios() {
  await primary("E-11", async () => {
    reset(baseProject()); const backups = path.join(PROJECT_DIR, "backups"); fs.mkdirSync(backups, { recursive: true });
    fs.writeFileSync(path.join(backups, "project-x.json"), JSON.stringify(baseProject("Stray")));
    await expectStatus(server.request("/api/projects/o8-project/restore", {
      method: "POST", headers: { "content-type": "application/json", "if-match": revision() }, body: JSON.stringify({ name: "project-x.json" }),
    }), 400);
  });
  await primary("F-01", async () => {
    reset(baseProject());
    await expectStatus(server.request("/api/projects/o8-project/restore", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "anything" }),
    }), 428, "PROJECT_REVISION_REQUIRED");
  });

  let backupName = "", preimage = null, preview = null;
  const prepare = async () => {
    reset(baseProject("Restore Source"));
    const backup = await expectStatus(server.request("/api/projects/o8-project/backups", { method: "POST" }), 200);
    backupName = backup.body.name;
    const changed = stored(); changed.meta.title = "Current Preimage";
    await expectStatus(normal(changed), 200); preimage = stored();
    preview = await expectStatus(server.request("/api/projects/o8-project/restore", {
      method: "POST", headers: { "content-type": "application/json", "if-match": revision() }, body: JSON.stringify({ name: backupName }),
    }), 200);
  };
  await primary("F-04", async () => {
    await prepare();
    const confirmed = await expectStatus(server.request("/api/projects/o8-project/restore", {
      method: "POST", headers: { "content-type": "application/json", "if-match": revision() },
      body: JSON.stringify({ name: backupName, confirm: true, previewHash: preview.body.previewHash }),
    }), 200);
    const auditPath = path.join(PROJECT_DIR, "backups", confirmed.body.audit);
    assert(fs.existsSync(auditPath));
    const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));
    assert.strictEqual(audit.kind, "RESTORE_SNAPSHOT"); assert.strictEqual(audit.sourceBackup, backupName);
  });
  await primary("F-05", async () => {
    await prepare();
    const confirmed = await expectStatus(server.request("/api/projects/o8-project/restore", {
      method: "POST", headers: { "content-type": "application/json", "if-match": revision() },
      body: JSON.stringify({ name: backupName, confirm: true, previewHash: preview.body.previewHash }),
    }), 200);
    const safety = stored(path.join(PROJECT_DIR, "backups", confirmed.body.safetyBackup));
    assert.deepStrictEqual(safety, preimage, "the safety backup must contain the exact project replaced by restore");
    assert.strictEqual(stored().meta.title, "Restore Source");
  });
}

async function workspaceScenarios() {
  await primary("E-08", async () => {
    reset(baseProject("Migration Source"));
    const nested = path.join(PROJECT_DIR, "docs", "nested", "project.json");
    fs.mkdirSync(path.dirname(nested), { recursive: true }); fs.writeFileSync(nested, '{"must":"not-copy"}');
    const destination = path.join(TEMP, "migrated-projects");
    const result = await expectStatus(server.request("/api/workspace/settings", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspace: { projectRoot: destination.replace(/\\/g, "/") } }),
    }), 200);
    assert.strictEqual(result.body.migration.projectDocuments >= 1, true);
    assert(fs.existsSync(path.join(destination, "o8-project", "project.json")));
    assert.strictEqual(fs.existsSync(path.join(destination, "o8-project", "docs", "nested", "project.json")), false);
  });
  await primary("E-09", async () => {
    const source = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
    const migrateBlock = source.slice(source.indexOf("function migrate("), source.indexOf("/* ---- explicit project ownership", source.indexOf("function migrate(")));
    assert(migrateBlock.includes("WRITE_CLASSES.WORKSPACE_MIGRATION"), "startup migrate must enroll project documents through WORKSPACE_MIGRATION");
  });
  await primary("E-10", async () => {
    const currentRoot = path.join(TEMP, "migrated-projects"), collisionRoot = path.join(TEMP, "collision-projects");
    const collisionFile = path.join(collisionRoot, "o8-project", "project.json"); writeProject(baseProject("Collision"), collisionFile);
    const result = await expectStatus(server.request("/api/workspace/settings", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspace: { projectRoot: collisionRoot.replace(/\\/g, "/") } }),
    }), 409, "WORKSPACE_PROJECT_COLLISION");
    assert(result.body.collisions.includes("o8-project"));
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    assert.strictEqual(path.resolve(config.workspace.projectRoot), path.resolve(currentRoot), "a collision must not switch the workspace root");
  });
}

async function main() {
  try {
    ensureProjectDir(); writeProject(baseProject());
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({
      activeProject: "o8-project", accounts: [], assistant: { provider: "none", visionProvider: "none" },
      workspace: { projectRoot: PROJECTS_ROOT.replace(/\\/g, "/"), mediaRoot: "", outputRoot: "", backupRoot: "" },
    }, null, 2));
    server = await startCineBraidServer({
      CINEBRAID_CONFIG_PATH: CONFIG_PATH,
      CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT,
      FAL_KEY: "", OPENAI_API_KEY: "", GOOGLE_API_KEY: "", ANTHROPIC_API_KEY: "",
    });

    await normalRefusalScenarios();
    await secondaryNormalOracleScenarios();
    await transitionScenarios();
    await invalidationScenarios();
    await recoveryScenarios();
    await importScenarios();
    await restoreScenarios();
    await workspaceScenarios();

    const expectedPrimary = [
      "A-01", "A-02", "A-03", "A-04", "A-05", "A-06", "A-07", "A-08", "A-09", "A-19", "A-21",
      "B-01", "B-03", "B-04", "B-05", "B-06", "B-07", "B-10", "B-11", "B-12",
      "C-06", "C-10",
      "D-02", "D-05", "D-06", "D-07", "D-09", "D-11", "D-12", "D-13",
      "E-01", "E-03", "E-04", "E-05", "E-08", "E-09", "E-10", "E-11",
      "F-01", "F-04", "F-05",
    ].sort();
    const expectedSecondary = [
      "A-10", "A-11", "A-12", "A-13", "A-14", "A-15", "A-16", "A-17", "A-18",
      "C-05", "C-07", "C-08", "C-09", "D-01", "D-03", "D-04", "D-10", "D-14",
    ].sort();
    assert.deepStrictEqual([...primaryPassed].sort(), expectedPrimary);
    assert.deepStrictEqual([...secondaryPassed].sort(), expectedSecondary);
    console.log(`Authority Write Seam O8 server acceptance: ${primaryPassed.length}/41 unique server scenarios passed; ${secondaryPassed.length}/18 secondary server executions passed; provider calls: 0.`);
  } finally {
    server?.stop();
    fs.rmSync(TEMP, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  if (server?.output) console.error(`--- server output ---\n${server.output}`);
  process.exitCode = 1;
});

"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
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
  /* AT1-E adds entities.js, and this is the classification that addition
     requires rather than a widening that slipped past.
   *
   * removeContinuityState() deletes a continuity state. When that state holds
   * CURRENT Canon, deleting it used to remove the authority EDGE and leave the
   * RECEIPT saying `current` about a target that no longer existed — so the
   * write seam refused every later save with AUTHORITY_EDGE_RECEIPT_MISMATCH
   * and the filmmaker's unrelated edits were stranded until reload.
   *
   * The fix is the one mutations.js already uses for the same situation on the
   * shot side (revokeShotCanonForRemoval): plan the removal, revoke the receipt
   * through the canonical writer with reason "target-removed" and
   * clearEdge:false, and only then remove the record. So entities.js is a
   * destructive-writer caller for exactly the reason mutations.js is — it owns a
   * DELETION of a target that can hold authority — and it is listed here for
   * that reason and no other. */
  const allowed = new Set(["creation-studio.js", "entities.js", "library-tools.js", "mutations.js"]);
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


/* ===========================================================================
   F-6 — IMPORT AUTHORITY-EDGE COMPLETENESS.

   UNTRUSTED_IMPORT is defended twice on purpose: server.js strips builder
   claims BEFORE the write, and importPolicy() refuses any surviving authority
   edge AT the write. Two layers are only two layers if the second one can be
   asked the question on its own.

   Until this block it could not be. enumerateAuthorityEdges() kept a PRIVATE
   four-list literal — no `audio`, which the kernel has always resolved
   entity-state edges for — and reached for the `#state-default` fallback only
   when an entity declared no states at all, while the kernel resolves that
   target through the entity-level pointer whenever no state of that id is
   declared. For both shapes the second layer answered "nothing here" about an
   edge the kernel reads, and every green test was measuring the stripper. */

const Seam = require("../authority-write-seam");
const F6_SEAM_FILE = path.join(ROOT, "authority-write-seam.js");

/* Rebuild the seam from (possibly defective) source, in its own realm, so a
   negative control can reintroduce the old code and watch the real behaviour —
   not a restatement of it. The occurrence count is the receipt: an anchor that
   silently matched nothing would make the control pass while changing nothing. */
function rebuildSeam(mutations = []) {
  let text = fs.readFileSync(F6_SEAM_FILE, "utf8").replace(/\r\n/g, "\n");
  for (const [anchor, replacement] of mutations) {
    const found = text.split(anchor).length - 1;
    assert.strictEqual(found, 1,
      `negative-control receipt: the anchor matched ${found} times, so the defect was never reintroduced`);
    text = text.replace(anchor, replacement);
  }
  const moduleObject = { exports: {} };
  vm.runInNewContext(text, {
    module: moduleObject, exports: moduleObject.exports, console, structuredClone,
    require: (specifier) => require(specifier.startsWith(".") ? path.join(ROOT, specifier) : specifier),
  }, { filename: "authority-write-seam.js" });
  return moduleObject.exports;
}

/* Nothing on disk, so UNTRUSTED_IMPORT's create-only rule is satisfied and the
   only thing that can refuse the document is the policy under test. */
function importBoundary(seamModule) {
  let written = null;
  const seam = seamModule.createAuthorityWriteSeam({
    resolveFile: () => "project.json",
    exists: () => false,
    readProject: () => ({}),
    revisionFor: () => "",
    validateProject: () => ({ ok: true, errors: [] }),
    writeProject: (_file, successor) => { written = clone(successor); },
  });
  return {
    attempt: (successor) => seam.persistProjectSuccessor({
      slug: "imported", successor, writeClass: seamModule.WRITE_CLASSES.UNTRUSTED_IMPORT,
      expectedRevision: "", transitionMetadata: {},
    }),
    written: () => written,
  };
}

/* GAP A. An entity-level audio pointer — the fifth list, absent from the old
   enumeration literal. */
function audioImport() {
  return {
    meta: { title: "F6 audio" }, scenes: [{ id: "SC-01" }], shots: [],
    characters: [], locations: [], props: [], vehicles: [],
    audio: [{ id: "AUDIO-01", name: "Theme", approvedFile: "THEME.wav", approvedAssetId: "asset-theme", continuityStates: [] }],
  };
}
/* GAP B. Declared states, none of them a default and none carrying an own
   file, ON TOP OF an entity-level approved pointer that the kernel still
   resolves `#state-default` through. */
function fallbackImport() {
  return {
    meta: { title: "F6 fallback" }, scenes: [{ id: "SC-01" }], shots: [],
    characters: [{
      id: "CHAR-01", name: "Lead", approvedFile: "LEAD.png", approvedAssetId: "asset-lead",
      continuityStates: [{ id: "state-day", name: "Day" }, { id: "state-night", name: "Night" }],
    }],
    locations: [], props: [], vehicles: [], audio: [],
  };
}
const AUDIO_EDGE = "entity-state:audio:AUDIO-01#state-default";
const FALLBACK_EDGE = "entity-state:characters:CHAR-01#state-default";

function liveEdge(project, key) {
  const parsed = key.match(/^entity-state:([^:]+):([^#]+)#(.+)$/);
  return Kernel.liveAuthorityEdge(project,
    { kind: "entity-state", list: parsed[1], entityId: parsed[2], stateId: parsed[3] });
}
/* The kernel and the rebuilt seams live in other realms, so every value that
   crosses back is copied to a host string before it is compared. */
function enumeratedKeys(seamModule, project) {
  return Array.from(seamModule.enumerateAuthorityEdges(project), (target) => String(target.key));
}

/* THE PROOF, factored so a negative control can run the very assertion the
   behavioural scenario runs and watch it go red, rather than a weaker echo.
   `refusedKeys` is the COMPLETE set the refusal must name, so an enumeration
   that over-reports is caught by the same assertion that catches one that
   under-reports; it defaults to the single edge under test. */
function proveEdgeRefused(seamModule, project, edgeKey, expectedValue, refusedKeys = [edgeKey]) {
  assert(enumeratedKeys(seamModule, project).includes(edgeKey),
    `enumeration is missing the live edge ${edgeKey}`);
  const boundary = importBoundary(seamModule), outcome = boundary.attempt(project);
  assert.strictEqual(outcome.ok, false, `UNTRUSTED_IMPORT accepted a document carrying ${edgeKey}`);
  assert.strictEqual(outcome.refusal.code, "UNTRUSTED_IMPORT_EDGE_PRESENT");
  const named = Array.from(outcome.refusal.targets, (row) => String(row.targetKey));
  assert.strictEqual(named.join(","), refusedKeys.join(","),
    "the refusal must name exactly the live edges the kernel resolves");
  assert.strictEqual(String(outcome.refusal.targets[named.indexOf(edgeKey)].edge.value), expectedValue);
  assert.strictEqual(boundary.written(), null, "a refused import writes nothing");
  return outcome;
}

/* The OTHER layer, lifted out of server.js so this suite can run it and bypass
   it deliberately instead of assuming what it does. */
function loadBuilderStripper() {
  const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const from = server.indexOf("function clearUnsupportedBuilderClaims");
  assert(from > 0, "server.js no longer defines clearUnsupportedBuilderClaims");
  const body = server.slice(from, server.indexOf("\nfunction importedProjectShape", from));
  assert(body.includes("delete entity.approvedAssetId"),
    "the extracted stripper is not the one that clears entity-level claims");
  const context = { console };
  vm.createContext(context);
  vm.runInContext(`${body}\nthis.clearUnsupportedBuilderClaims = clearUnsupportedBuilderClaims;`, context);
  return context.clearUnsupportedBuilderClaims;
}

/* WHY EACH NEGATIVE CONTROL HAS TO OBSERVE THE OMISSION DIRECTLY. Run the
   ordinary builder route against a defective policy layer and it still looks
   perfect: the stripper clears the pointer, the import is accepted, nothing
   is refused — the identical outcome a correct policy layer produces. The
   sanitized path is therefore blind to this class of defect by construction,
   which is the whole reason the second layer needs its own question asked. */
function builderRouteCannotSeeTheDefect(seamModule, build, key) {
  const stripped = build(), warnings = [];
  loadBuilderStripper()(stripped, warnings);
  assert.strictEqual(liveEdge(stripped, key).value, "", "the builder route still sanitizes the pointer");
  const boundary = importBoundary(seamModule), outcome = boundary.attempt(stripped);
  assert.strictEqual(outcome.ok, true, "the sanitized document imports under the defective build too");
  assert(boundary.written(), "and reaches the writer, exactly as it does under the shipped build");
}

/* F-01 — AUDIO IS ENUMERATED, AND IMPORT POLICY ITSELF REFUSES IT. */
scenario("F-01", () => {
  const P = audioImport(), live = liveEdge(P, AUDIO_EDGE);
  assert.strictEqual(live.value, "THEME.wav", "the kernel resolves the audio entity-default edge");
  assert.strictEqual(live.assetId, "asset-theme");
  assert.strictEqual(live.form, "entity-default");
  assert(Kernel.AUTHORITY_ENTITY_LISTS.includes("audio"), "audio is in the kernel's canonical entity set");
  proveEdgeRefused(Seam, P, AUDIO_EDGE, "THEME.wav");
});

/* F-02 — THE state-default FALLBACK IS ENUMERATED ALONGSIDE DECLARED STATES.
   The declared siblings resolve to nothing, so no other enumerated target can
   stand in for the fallback edge. */
scenario("F-02", () => {
  const P = fallbackImport();
  for (const stateId of ["state-day", "state-night"])
    assert.strictEqual(liveEdge(P, `entity-state:characters:CHAR-01#${stateId}`).value, "",
      "a declared state with no own file and no default flag resolves to nothing");
  const live = liveEdge(P, FALLBACK_EDGE);
  assert.strictEqual(live.value, "LEAD.png", "the kernel resolves #state-default through the entity-level pointer");
  assert.strictEqual(live.form, "entity-default");
  assert.deepStrictEqual(enumeratedKeys(Seam, P), [
    "entity-state:characters:CHAR-01#state-day",
    "entity-state:characters:CHAR-01#state-night",
    FALLBACK_EDGE,
  ], "enumeration keeps the declared states AND adds the live fallback target");
  proveEdgeRefused(Seam, P, FALLBACK_EDGE, "LEAD.png");
  /* A declared default with no own file needed no correction: its own id was
     always enumerated and the kernel falls back through it. The entity ALSO
     answers the absent `#state-default` id, so this shape has two live edges
     onto one pointer and the refusal has to name both. */
  const declared = {
    meta: { title: "F6 declared default" }, shots: [],
    characters: [{ id: "CHAR-02", approvedFile: "LEAD2.png", continuityStates: [{ id: "state-hero", isDefault: true }] }],
  };
  for (const stateId of ["state-hero", "state-default"])
    assert.strictEqual(liveEdge(declared, `entity-state:characters:CHAR-02#${stateId}`).value, "LEAD2.png",
      "the declared default and the absent default id resolve to the same entity pointer");
  proveEdgeRefused(Seam, declared, "entity-state:characters:CHAR-02#state-hero", "LEAD2.png",
    ["entity-state:characters:CHAR-02#state-hero", "entity-state:characters:CHAR-02#state-default"]);
});

/* F-03 — THERE ARE REALLY TWO LAYERS.
   Direction one: bypass the builder stripper entirely and importPolicy still
   refuses, with nothing reaching the writer. Direction two: run the real
   stripper and the same documents import cleanly — which is exactly the
   measurement that used to be mistaken for enumeration coverage. */
scenario("F-03", () => {
  const strip = loadBuilderStripper();
  for (const [build, key, value] of [[audioImport, AUDIO_EDGE, "THEME.wav"], [fallbackImport, FALLBACK_EDGE, "LEAD.png"]]) {
    const bypassed = build();
    assert.strictEqual(liveEdge(bypassed, key).value, value, "the unstripped document carries a live authority edge");
    proveEdgeRefused(Seam, bypassed, key, value);

    const stripped = build(), warnings = [];
    strip(stripped, warnings);
    assert.strictEqual(liveEdge(stripped, key).value, "", "the stripper clears the entity-level pointer");
    const boundary = importBoundary(Seam), outcome = boundary.attempt(stripped);
    assert.strictEqual(outcome.ok, true, "a stripped builder document still imports");
    assert(boundary.written(), "and reaches the writer");
  }
});

/* NC-F6-1 — restore the four-list enumeration literal. Audio disappears from
   the policy layer while the kernel goes on resolving the edge, the document
   reaches the writer, and the F-01 proof goes red. */
scenario("F-04", () => {
  const real = rebuildSeam();
  proveEdgeRefused(real, audioImport(), AUDIO_EDGE, "THEME.wav");

  const broken = rebuildSeam([[
    "for (const name of Authority.AUTHORITY_ENTITY_LISTS) {",
    'for (const name of ["characters", "locations", "props", "vehicles"]) {',
  ]]);
  assert.strictEqual(liveEdge(audioImport(), AUDIO_EDGE).value, "THEME.wav",
    "the live edge is untouched — this is policy blindness, not a missing edge");
  assert.deepStrictEqual(enumeratedKeys(broken, audioImport()), [],
    "NC-F6-1 did not reproduce: the four-list enumeration still found the audio edge");
  const boundary = importBoundary(broken), outcome = boundary.attempt(audioImport());
  assert.strictEqual(outcome.ok, true, "NC-F6-1 did not reproduce: import policy still refused");
  assert.strictEqual(outcome.refusal, null);
  assert(boundary.written(), "the defective build let an authority-bearing document through to the writer");
  assert.throws(() => proveEdgeRefused(broken, audioImport(), AUDIO_EDGE, "THEME.wav"),
    /enumeration is missing the live edge entity-state:audio:AUDIO-01#state-default/,
    "the F-01 proof must go red under NC-F6-1");
  builderRouteCannotSeeTheDefect(broken, audioImport, AUDIO_EDGE);
});

/* NC-F6-2 — restore the `!stateIds.size` gate on the fallback. The entity-level
   #state-default target vanishes from the policy layer for any entity that also
   declares states, and the F-02 proof goes red. Audio with no declared states is
   still caught, which is what isolates this control to the predicate. */
scenario("F-05", () => {
  const real = rebuildSeam();
  proveEdgeRefused(real, fallbackImport(), FALLBACK_EDGE, "LEAD.png");

  const broken = rebuildSeam([[
    'if (text(entity.approvedFile) || text(entity.approvedAssetId)) stateIds.add("state-default");',
    'if (!stateIds.size && (text(entity.approvedFile) || text(entity.approvedAssetId))) stateIds.add("state-default");',
  ]]);
  assert.strictEqual(liveEdge(fallbackImport(), FALLBACK_EDGE).value, "LEAD.png",
    "the kernel still resolves #state-default through the entity-level pointer");
  assert.deepStrictEqual(enumeratedKeys(broken, fallbackImport()), [
    "entity-state:characters:CHAR-01#state-day",
    "entity-state:characters:CHAR-01#state-night",
  ], "NC-F6-2 did not reproduce: the narrow predicate still enumerated the fallback");
  const boundary = importBoundary(broken), outcome = boundary.attempt(fallbackImport());
  assert.strictEqual(outcome.ok, true, "NC-F6-2 did not reproduce: import policy still refused");
  assert(boundary.written(), "the defective build let an authority-bearing document through to the writer");
  assert.throws(() => proveEdgeRefused(broken, fallbackImport(), FALLBACK_EDGE, "LEAD.png"),
    /enumeration is missing the live edge entity-state:characters:CHAR-01#state-default/,
    "the F-02 proof must go red under NC-F6-2");
  builderRouteCannotSeeTheDefect(broken, fallbackImport, FALLBACK_EDGE);
  /* Audio with no declared states is still caught by the mutated build, which
     is what isolates this control to the predicate rather than the list. */
  proveEdgeRefused(broken, audioImport(), AUDIO_EDGE, "THEME.wav");
});

const EXPECTED = [
  "A-10", "A-11", "A-12", "A-13", "A-14", "A-15", "A-16", "A-17", "A-18", "A-20", "A-22",
  "B-09",
  "C-01", "C-02", "C-03", "C-04", "C-05", "C-07", "C-08", "C-09", "C-11", "C-12", "C-13", "C-14", "C-15",
  "D-01", "D-03", "D-04", "D-10", "D-14",
  "E-02", "E-06", "E-07", "E-12", "H-01",
  "F-01", "F-02", "F-03", "F-04", "F-05",
];
assert.deepStrictEqual(passed, EXPECTED);
assert.strictEqual(passed.length, 40);
console.log("Authority Write Seam O8 unit acceptance: 40/40 unique unit scenarios passed; provider calls: 0.");

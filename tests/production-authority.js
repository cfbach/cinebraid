/* CINEBRAID PRODUCTION TRUTH — THE SIX-SENTENCE ACCEPTANCE SUITE.
 *
 * Dogfood #2, production-truth simplification pass. This file replaces the
 * Batch 1B/1C/1D authority suite, which grew one group per guard until it was
 * testing a mechanism rather than a promise. It tests the promise:
 *
 *   1. HUMAN EXPLICITLY APPROVES CANON.
 *   2. AUTOMATION ONLY RECOMMENDS.
 *   3. SUPPORTING REFERENCES ARE NOT CANON.
 *   4. LEGACY POINTERS WITHOUT CURRENT CANON ARE HISTORIC.
 *   5. STATE ANCESTRY IS IMMUTABLE AFTER CREATION.
 *   6. PREFLIGHT DOES NOT MUTATE.
 *
 * The groups below are those sentences, plus the reconciliation that reads
 * them. Anything that needed a paragraph of mechanism to explain has been
 * deleted from the product rather than described here.
 *
 * NO PAID PROVIDER CALL IS POSSIBLE HERE. Nothing dispatches a generation; every
 * function called is the authority kernel, the recommendation record, the slot
 * writer or the gate resolver.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");
const Authority = require("../public/shared-production-authority");
const { Kernel, Private } = require("./authority-kernel-private");
const Slots = require("../public/shared-entity-slots");
const P4 = require("../public/shared-production-media");

/* THERE IS NOTHING TO WIRE. The kernel depends on shared-entity-ownership.js
   directly, so a suite cannot forget to hand it over and cannot hand over a
   different answer. `useEntityOwnershipResolver` used to be required here, and
   its absence is asserted below. */

/* Node has no user agent. This drives the REAL trusted-event listener through an
   event target the test composition owns — see tests/authority-test-gesture.js
   for why that boundary is compositional rather than a flag. */
const { installTestManualActionSource } = require("./authority-test-gesture.js");
const MANUAL = installTestManualActionSource(Kernel);
/* Every Canon write is one synchronous act inside one delivered gesture. There
   is no token: `human(fn)` IS the human. */
const human = (fn) => MANUAL.gesture(fn);

let checks = 0;
const ok = (condition, message) => { assert(condition, message); checks++; };
const eq = (actual, expected, message) => {
  const comparable = (value) => value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : value;
  assert.deepStrictEqual(comparable(actual), comparable(expected), `${message}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  checks++;
};
const refuses = (fn, code, message) => {
  let thrown = null;
  try { fn(); } catch (error) { thrown = error; }
  ok(thrown, `${message} — but nothing was thrown`);
  ok(thrown.code === code, `${message} — expected ${code}, got ${thrown && thrown.code}: ${thrown && thrown.message}`);
  return thrown;
};

/* One group below cannot be synchronous: it has to observe what a Promise
   continuation of a trusted event can do. It is awaited at the bottom, and a
   failure inside it fails the suite rather than resolving quietly. */
let DEFERRED = Promise.resolve();
const AT = (n) => `2026-08-14T0${n}:00:00.000Z`;
const shotProject = () => ({
  shots: [{
    id: "SH-01",
    keyframes: [{ id: "fr-a", label: "A" }, { id: "fr-b", label: "B" }],
    clips: [{ id: "clip-1", suffix: "A" }],
    creationBrief: {},
  }],
});
const entityProject = () => ({
  characters: [{
    id: "CHAR-A",
    name: "A",
    prefix: "CHAR-A",
    approvedFile: "",
    candidateFiles: [{ stored: "CHAR-A-ONE.png", decision: "unreviewed" }],
    continuityStates: [
      { id: "state-default", name: "Default", isDefault: true, approvedFile: "" },
      { id: "st-soot", name: "Soot", parentStateId: "state-default", approvedFile: "" },
    ],
    coverageSlots: [{ id: "front", label: "Front", requirement: "required", selectedFile: "", status: "missing" }],
    expressionSlots: [],
  }],
});

/* ===========================================================================
   0. THE ARCHITECTURE IS THE ONE THAT WAS PROMISED.

   Absence assertions, because every name below is a way an audit walked around
   the model. Re-exporting any of them restores an architecture, not a helper. */

const GONE_FROM_AUTHORITY = [
  /* a credential that was a SHAPE two strings could type */
  "isHumanAuthorityGrant", "humanAuthorityGrant", "assertHumanAuthority",
  /* a reusable human capability minted in one place and spent in another */
  "beginManualApproval",
  /* the document shape, as a replaceable seam */
  "readAuthorityEdge", "writeAuthorityEdge",
  /* a replaceable ownership answer */
  "entityOwnershipEligibility", "useEntityOwnershipResolver",
  /* wrappers around a generic transaction */
  "writeFrameProductionAuthority", "writeMotionProductionAuthority",
  "writeDeliveryProductionAuthority", "writeEntityStateProductionAuthority",
  "revokeProductionAuthority", "revokeFrameProductionAuthority", "revokeEntityStateProductionAuthority",
  /* slots were never Canon and must not acquire a writer */
  "writeCoverageProductionAuthority", "writeExpressionProductionAuthority",
];
for (const name of GONE_FROM_AUTHORITY) {
  ok(!(name in Authority), `shared-production-authority must not export ${name}`);
}
const GONE_FROM_KERNEL = [
  "beginManualAuthorityAction", "manualActionCovers", "consumeManualAction",
  "installAuthorityEdgeReader", "installAuthorityEdgeWriter",
  "installAuthorityOwnershipPolicy", "installAuthorityProjectCommitter",
  "commitAuthorityTransaction", "revokeAuthorityTransaction", "repairAuthorityValue",
  "approveCoverageCanon", "approveExpressionCanon",
];
for (const name of GONE_FROM_KERNEL) {
  ok(!(name in Kernel), `the kernel must not export ${name}`);
}
ok(!("installSlotOwnershipPolicy" in Slots), "the supporting-reference path must not have a replaceable ownership policy either");
/* And they are gone from the SOURCE, not merely from the export bag: an
   installer that still exists is an installer somebody can reach. */
const kernelSource = read("public/shared-authority-kernel.js").replace(/\r\n/g, "\n");
for (const name of ["installAuthorityEdgeReader", "installAuthorityEdgeWriter", "installAuthorityOwnershipPolicy", "installAuthorityProjectCommitter"]) {
  ok(!new RegExp(`function\\s+${name}\\s*\\(`).test(kernelSource), `${name} must not exist in the kernel source`);
}
/* THE WHOLE PUBLIC WRITE SURFACE, ENUMERATED. O8 exposes only the four
   authority-creating commands; destructive owners and repair are private. */
const WRITE_SURFACE = Object.keys(Kernel).filter((name) => /^(approve|revoke|repair)/.test(name)).sort();
eq(WRITE_SURFACE, [
  "approveDeliveryCanon", "approveEntityStateCanon", "approveFrameCanon", "approveMotionCanon",
], "the kernel's public write surface is exactly the four authority-creating commands");

/* ===========================================================================
   1. CANON — a human explicitly approves these exact bytes. */

/* 1.1 The ordinary approval works, and leaves a receipt that describes it. */
{
  const project = shotProject();
  const receipt = human(() => Kernel.approveFrameCanon(project, {
    shotId: "SH-01", frameId: "fr-a", value: "A.png", assetId: "asset-A", at: AT(1), via: "test-approval-surface",
  }));
  eq(receipt.actor, "human", "a receipt records the only actor there is");
  eq(receipt.act, "explicit-approval", "and the only act");
  eq(receipt.value, "A.png", "the exact value the person confirmed");
  eq(receipt.assetId, "asset-A", "and the exact bytes");
  ok(receipt.provenance.manualAction, "and which gesture issued it");
  eq(project.shots[0].keyframes[0].winner, "A.png", "the edge is written by the same statement");
  eq(project.shots[0].winner, "A.png", "the opening frame is also the shot's headline image");
  ok(Kernel.hasCurrentHumanAuthority(project, { kind: "shot-frame", shotId: "SH-01", frameId: "fr-a" }),
    "and the project reads back as canon");
}

/* 1.2 AUTOMATION CANNOT APPROVE. Not because it is asked not to — because there
   is no gesture in a continuation, and there is nothing to carry into one. */
{
  const project = shotProject();
  refuses(
    () => Kernel.approveFrameCanon(project, { shotId: "SH-01", frameId: "fr-a", value: "A.png", assetId: "", at: AT(1) }),
    "MANUAL_ACTION_REQUIRED",
    "outside a human gesture, canon refuses",
  );
  eq(project.shots[0].keyframes[0].winner, undefined, "and writes nothing");
  eq(Authority.authorityReceipts(project).length, 0, "and leaves no receipt");
}

/* 1.3 COUNTEREXAMPLE 1 — A LATER PROMISE MICROTASK IN THE SAME EVENT.
 *
 * Batch 1D closed the gesture on `setTimeout(0)`, so every `.then()` in the
 * event's macrotask still saw it open and the audit minted from one. The window
 * is not a span of time any more: it is the dispatch itself.
 *
 * WHAT THIS GROUP DOES AND DOES NOT PROVE, stated because a control showed the
 * difference. In Node there is no `window`, so the kernel cannot ask which
 * dispatch it is inside and the test composition closes the gesture explicitly
 * in a `finally`. This group therefore proves the CONSEQUENCE — a continuation
 * cannot write canon — but it passes even with the dispatch check deleted.
 *
 * The MECHANISM that protects the real product is asserted where a window
 * exists: tests/dogfood2-p0-architecture.js drives the same counterexample
 * through the render harness, which sets `window.event` around its dispatch
 * exactly as a user agent does, and a control there goes red when the check is
 * removed. Both are needed; neither is sufficient. */
{
  const project = shotProject();
  const outcome = { microtask: "", nextMacrotask: "" };
  const attempt = () => {
    try {
      Kernel.approveFrameCanon(project, { shotId: "SH-01", frameId: "fr-a", value: "LATER.png", assetId: "", at: AT(1) });
      return "WROTE-CANON";
    } catch (error) { return error.code; }
  };
  const settled = new Promise((resolve) => {
    human(() => { Promise.resolve().then(() => { outcome.microtask = attempt(); resolve(); }); });
  });
  DEFERRED = settled.then(() => {
    setTimeout(() => { outcome.nextMacrotask = attempt(); }, 0);
    return new Promise((resolve) => setTimeout(resolve, 5)).then(() => {
      eq(outcome.microtask, "MANUAL_ACTION_REQUIRED",
        "a Promise continuation in the same trusted event may not write canon");
      eq(outcome.nextMacrotask, "MANUAL_ACTION_REQUIRED",
        "and neither may a later macrotask");
      eq(Authority.authorityReceipts(project).length, 0, "neither one left a receipt");
    });
  });
}

/* 1.4 COUNTEREXAMPLE 2 — the decision is the value and the asset, by
   construction. There is no target-only approval to spend on other bytes,
   because a request that does not state the bytes is refused. */
{
  const project = shotProject();
  refuses(
    () => human(() => Kernel.approveFrameCanon(project, { shotId: "SH-01", frameId: "fr-a", assetId: "", at: AT(1) })),
    "AUTHORITY_VALUE_REQUIRED",
    "an approval that does not name the media is refused",
  );
  refuses(
    () => human(() => Kernel.approveFrameCanon(project, { shotId: "SH-01", frameId: "fr-a", value: "A.png", at: AT(1) })),
    "AUTHORITY_ASSET_IDENTITY_REQUIRED",
    "an approval that leaves the bytes' identity unstated is refused — silence is not the same statement as \"none\"",
  );
  const receipt = human(() => Kernel.approveFrameCanon(project, {
    shotId: "SH-01", frameId: "fr-a", value: "A.png", assetId: "", at: AT(1),
  }));
  eq(receipt.assetId, "", "and an explicit \"no identity in this project\" is a legitimate answer");
}

/* 1.5 MALFORMED RECEIPT FAILS CLOSED, for everything, not for nothing. */
{
  const project = shotProject();
  human(() => Kernel.approveFrameCanon(project, { shotId: "SH-01", frameId: "fr-a", value: "A.png", assetId: "asset-A", at: AT(1) }));
  human(() => Kernel.approveFrameCanon(project, { shotId: "SH-01", frameId: "fr-b", value: "B.png", assetId: "asset-B", at: AT(2) }));
  const damaged = JSON.parse(JSON.stringify(project));
  delete damaged.productionAuthority.receipts[0].provenance;
  eq(Kernel.hasCurrentHumanAuthority(damaged, { kind: "shot-frame", shotId: "SH-01", frameId: "fr-b" }), false,
    "one unreadable row makes the whole ledger unreadable — a damaged ledger answers no for every target");
  ok(Kernel.authorityLedgerDiagnostics(damaged).some((row) => row.code === "receipt-provenance-missing"),
    "and says exactly what is wrong");
  refuses(
    () => human(() => Kernel.approveFrameCanon(damaged, { shotId: "SH-01", frameId: "fr-a", value: "C.png", assetId: "", at: AT(3) })),
    "AUTHORITY_LEDGER_UNREADABLE",
    "and will not be appended to",
  );
}

/* 1.6 COUNTEREXAMPLE 8 — a receipt that names bytes, and a live edge that has
   forgotten them. Batch 1D compared identities "only where both sides carry
   one", so deleting the live identity left the approval standing on the
   filename alone. */
{
  const project = shotProject();
  const target = { kind: "shot-frame", shotId: "SH-01", frameId: "fr-a" };
  human(() => Kernel.approveFrameCanon(project, { shotId: "SH-01", frameId: "fr-a", value: "A.png", assetId: "asset-A", at: AT(1) }));
  ok(Kernel.hasCurrentHumanAuthority(project, target), "baseline: the approval holds");
  delete project.shots[0].keyframes[0].winnerAssetId;
  delete project.shots[0].winnerAssetId;
  eq(Kernel.liveAuthorityEdge(project, target).value, "A.png", "the filename still matches");
  eq(Kernel.hasCurrentHumanAuthority(project, target), false,
    "but a receipt that names bytes is not satisfied by an edge that cannot name them");
  project.shots[0].keyframes[0].winnerAssetId = "asset-B";
  eq(Kernel.hasCurrentHumanAuthority(project, target), false, "and different bytes are a contradiction, not a half-match");
}

/* 1.7 COUNTEREXAMPLE 9 — DELIVERY IS NOT STRUCTURALLY SPECIAL. Batch 1D's
   delivery reader returned a hard-coded empty asset id, so a delivery receipt
   could never be checked against the bytes it named. */
{
  const project = shotProject();
  const target = { kind: "shot-delivery", shotId: "SH-01" };
  human(() => Kernel.approveDeliveryCanon(project, { shotId: "SH-01", value: "FINAL.mp4", assetId: "asset-V", at: AT(1) }));
  eq({ ...Kernel.liveAuthorityEdge(project, target) }, { value: "FINAL.mp4", assetId: "asset-V", recordId: "SH-01:creationBrief", field: "approvedMotionFile", form: "video" },
    "a delivery edge reports its asset identity like every other canon edge");
  ok(Kernel.hasCurrentHumanAuthority(project, target), "so delivery canon can be verified at all");
  delete project.shots[0].creationBrief.approvedMotionAssetId;
  eq(Kernel.hasCurrentHumanAuthority(project, target), false, "and it fails closed on the same terms");
}

/* 1.8 COUNTEREXAMPLE 10 — VIDEO REVOCATION CLEARS THE VIDEO.
 *
 * Batch 1D inferred still-versus-video from the NEW value, which on a
 * revocation is empty, so every video revocation took the still branch and left
 * `approvedMotionFile` behind. */
{
  const project = shotProject();
  human(() => Kernel.approveFrameCanon(project, { shotId: "SH-01", frameId: "fr-a", value: "FRAME.png", assetId: "asset-F", at: AT(1) }));
  human(() => Kernel.approveDeliveryCanon(project, { shotId: "SH-01", value: "MOVIE.mp4", assetId: "asset-V", at: AT(2) }));
  eq(project.shots[0].creationBrief.approvedMotionFile, "MOVIE.mp4", "baseline: the video is the delivery");
  human(() => Private.revokeDeliveryCanon(project, { shotId: "SH-01", at: AT(3), reason: "withdrawn" }));
  eq(project.shots[0].creationBrief.approvedMotionFile, undefined, "revoking video delivery clears the video pointer");
  eq(project.shots[0].creationBrief.approvedMotionAssetId, undefined, "and its identity");
  eq(project.shots[0].finalStillFile, undefined, "and does not invent a still");
  eq(project.shots[0].winner, "FRAME.png", "and does not touch frame canon, which is a different target");
  ok(Kernel.hasCurrentHumanAuthority(project, { kind: "shot-frame", shotId: "SH-01", frameId: "fr-a" }),
    "the frame approval is still in force");
  eq(Kernel.hasCurrentHumanAuthority(project, { kind: "shot-delivery", shotId: "SH-01" }), false,
    "and the delivery approval is not");
  /* And the still direction, so the control is not one-sided. */
  const still = shotProject();
  human(() => Kernel.approveDeliveryCanon(still, { shotId: "SH-01", value: "FINAL.png", assetId: "asset-S", at: AT(1) }));
  eq(still.shots[0].finalStillFile, "FINAL.png", "a still delivery writes the still pointer");
  human(() => Private.revokeDeliveryCanon(still, { shotId: "SH-01", at: AT(2), reason: "withdrawn" }));
  eq(still.shots[0].finalStillFile, undefined, "and revoking it clears that one");
}

/* 1.9 PERSISTENCE FAILURE LEAVES NO PARTIAL CANON. */
{
  const project = shotProject();
  Object.preventExtensions(project);
  refuses(
    () => human(() => Kernel.approveFrameCanon(project, { shotId: "SH-01", frameId: "fr-a", value: "A.png", assetId: "", at: AT(1) })),
    "AUTHORITY_NOT_PERSISTED",
    "a commit that cannot be written back is reported, never returned as a receipt",
  );
  eq(project.productionAuthority, undefined, "and no ledger appears");
  eq(project.shots[0].keyframes[0].winner, undefined, "and no edge is left behind");
}

/* 1.10 OWNERSHIP IS INTRINSIC — COUNTEREXAMPLE 3.
 *
 * The 1D audit replaced the exported ownership policy and approved a file two
 * entities both claim. There is no exported policy to replace: the kernel
 * depends on the resolver module by name. */
{
  const project = {
    characters: [
      { id: "CHAR-A", prefix: "CHAR-A", candidateFiles: [{ stored: "SHARED.png" }], continuityStates: [{ id: "state-default", isDefault: true, approvedFile: "" }] },
      { id: "CHAR-B", prefix: "CHAR-B", candidateFiles: [{ stored: "SHARED.png" }], continuityStates: [{ id: "state-default", isDefault: true, approvedFile: "" }] },
    ],
  };
  refuses(
    () => human(() => Kernel.approveEntityStateCanon(project, {
      list: "characters", entityId: "CHAR-A", stateId: "state-default", value: "SHARED.png", assetId: "", at: AT(1),
    })),
    "AUTHORITY_OWNERSHIP_CONTESTED",
    "a contested file cannot become canon",
  );
  eq(project.characters[0].continuityStates[0].approvedFile, "", "and nothing is written");
  eq(Authority.authorityReceipts(project).length, 0, "and no receipt is minted");
}

/* 1.11 COUNTEREXAMPLE 4 — there is no writer or committer to replace.
 *
 * The audit swapped the exported edge writer for a closure that mutated the
 * live project and threw. The names are gone (asserted in group 0); this proves
 * the consequence — assigning them onto the module changes nothing, because
 * nothing reads them. */
{
  const project = shotProject();
  let sideEffect = "";
  Kernel.installAuthorityEdgeWriter = () => { sideEffect = "MUTATED-LIVE"; project.shots[0].winner = "FORGED.png"; throw new Error("boom"); };
  Kernel.installAuthorityProjectCommitter = () => { sideEffect = "MUTATED-LIVE"; };
  Authority.entityOwnershipEligibility = () => ({ ok: true });
  const receipt = human(() => Kernel.approveFrameCanon(project, { shotId: "SH-01", frameId: "fr-a", value: "A.png", assetId: "", at: AT(1) }));
  eq(sideEffect, "", "assigning an installer name onto the module reaches nothing inside the operation");
  eq(receipt.value, "A.png", "and the real writer still ran");
  eq(project.shots[0].winner, "A.png", "against the real edge");
  delete Kernel.installAuthorityEdgeWriter;
  delete Kernel.installAuthorityProjectCommitter;
  delete Authority.entityOwnershipEligibility;
}

/* 1.12 SUPERSESSION AND REVOCATION KEEP ONE CURRENT ANSWER. */
{
  const project = shotProject();
  const target = { kind: "shot-frame", shotId: "SH-01", frameId: "fr-a" };
  const first = human(() => Kernel.approveFrameCanon(project, { shotId: "SH-01", frameId: "fr-a", value: "A.png", assetId: "asset-A", at: AT(1) }));
  const second = human(() => Kernel.approveFrameCanon(project, { shotId: "SH-01", frameId: "fr-a", value: "B.png", assetId: "asset-B", at: AT(2) }));
  eq(Authority.authorityReceiptsFor(project, target).map((row) => row.status), ["superseded", "current"],
    "a second decision supersedes the first rather than competing with it");
  eq(Authority.authorityReceiptsFor(project, target)[0].supersededBy, second.id, "and names what replaced it");
  eq(Authority.currentAuthorityReceipt(project, target).id, second.id, "the newest decision is the current one");
  ok(first.id !== second.id, "each decision has its own durable identity");
  human(() => Private.revokeFrameCanon(project, { shotId: "SH-01", frameId: "fr-a", at: AT(3), reason: "withdrawn" }));
  eq(Kernel.hasCurrentHumanAuthority(project, target), false, "a revoked target has no canon");
  eq(Kernel.historicSelection(project, target), null, "and with the edge cleared there is not even a historic pointer");
}

/* 1.13 A RENAME MOVES THE RECEIPT WITH THE BYTES. This is load-bearing: the
   shipped order is approve-then-rename, so the repair is on the ordinary path. */
{
  const project = shotProject();
  const target = { kind: "shot-frame", shotId: "SH-01", frameId: "fr-a" };
  human(() => Kernel.approveFrameCanon(project, { shotId: "SH-01", frameId: "fr-a", value: "RAW.png", assetId: "asset-A", at: AT(1) }));
  project.shots[0].keyframes[0].winner = "CANONICAL.png";
  project.shots[0].winner = "CANONICAL.png";
  eq(Kernel.hasCurrentHumanAuthority(project, target), false, "a moved edge alone loses canon, which is the safe direction");
  /* THE REPAIR NAMES ITS TARGET. A filename is not an identity, so a repair that
     selected receipts by basename alone rewrote canon for unrelated objects that
     happened to share a name — Codex MB-PT-01. */
  eq(Private.repairCanonValue(project, { ...target, from: "RAW.png", to: "CANONICAL.png", assetId: "asset-A" }).length, 1,
    "the repair moves the receipt for the target the person acted on");
  ok(Kernel.hasCurrentHumanAuthority(project, target), "and the decision the person really made survives its own rename");

  /* MB-PT-01 — AN UNRELATED TARGET IS NOT TOUCHED. Two shots, each with their
     own approval of the same basename in their own takes folder, is ordinary
     product data. */
  const twoShots = { shots: [
    { id: "SH-A", keyframes: [{ id: "fr-a" }], clips: [], creationBrief: {} },
    { id: "SH-B", keyframes: [{ id: "fr-a" }], clips: [], creationBrief: {} },
  ] };
  const targetA = { kind: "shot-frame", shotId: "SH-A", frameId: "fr-a" };
  const targetB = { kind: "shot-frame", shotId: "SH-B", frameId: "fr-a" };
  human(() => Kernel.approveFrameCanon(twoShots, { shotId: "SH-A", frameId: "fr-a", value: "FRAME.png", assetId: "asset-A", at: AT(1) }));
  human(() => Kernel.approveFrameCanon(twoShots, { shotId: "SH-B", frameId: "fr-a", value: "FRAME.png", assetId: "asset-B", at: AT(2) }));
  twoShots.shots[0].keyframes[0].winner = "RENAMED.png";
  twoShots.shots[0].keyframes[0].winnerAssetId = "asset-A2";
  twoShots.shots[0].winner = "RENAMED.png";
  twoShots.shots[0].winnerAssetId = "asset-A2";
  const moved = Private.repairCanonValue(twoShots, { ...targetA, from: "FRAME.png", to: "RENAMED.png", assetId: "asset-A2" });
  eq(moved.length, 0, "a repair whose identity contradicts the receipt writes nothing — it cannot prove the same bytes");
  eq(Kernel.hasCurrentHumanAuthority(twoShots, targetA), false, "so shot A reads as historic and can be approved again in one act");
  const receiptB = Authority.currentAuthorityReceipt(twoShots, targetB);
  ok(receiptB, "and shot B's decision is untouched");
  eq(receiptB.value, "FRAME.png", "still naming the bytes its creator approved");
  eq(receiptB.assetId, "asset-B", "with its own identity intact");

  /* CODEX MB-PT-01, THE EMPTY-IDENTITY CASE — REPAIR REFUSES.
   *
   * THIS EXPECTATION IS INVERTED FROM THE PREVIOUS PASS, and Codex was right to
   * call the old one out. It asserted that a repair SUCCEEDS for a project whose
   * media ledger has not been indexed. That is exactly the hole: with no
   * recorded identity there is nothing that ties the renamed file to the
   * decision, and the implementation "proved" the move by writing the caller's
   * own new assetId into the receipt.
   *
   * A receipt with no identity is a decision about a filename. Once the filename
   * moves, the decision cannot follow it, and Canon fails closed. */
  const unindexed = { shots: [
    { id: "SH-A", keyframes: [{ id: "fr-a" }], clips: [], creationBrief: {} },
    { id: "SH-B", keyframes: [{ id: "fr-a" }], clips: [], creationBrief: {} },
  ] };
  const unA = { kind: "shot-frame", shotId: "SH-A", frameId: "fr-a" };
  const unB = { kind: "shot-frame", shotId: "SH-B", frameId: "fr-a" };
  human(() => Kernel.approveFrameCanon(unindexed, { shotId: "SH-A", frameId: "fr-a", value: "FRAME.png", assetId: "", at: AT(1) }));
  human(() => Kernel.approveFrameCanon(unindexed, { shotId: "SH-B", frameId: "fr-a", value: "FRAME.png", assetId: "", at: AT(2) }));
  unindexed.shots[0].keyframes[0].winner = "RENAMED.png";
  unindexed.shots[0].winner = "RENAMED.png";
  /* The caller offers an identity the rename just minted. It proves nothing
     about what the creator approved, and the repair refuses it. */
  const scoped = Private.repairCanonValue(unindexed, { ...unA, from: "FRAME.png", to: "RENAMED.png", assetId: "asset-NEW" });
  eq(scoped.length, 0, "a receipt with no recorded identity cannot follow its bytes anywhere");
  eq(Authority.authorityReceiptsFor(unindexed, unA)[0].assetId, "",
    "and the receipt does NOT acquire an identity from the rename that needed one");
  eq(Authority.authorityReceiptsFor(unindexed, unA)[0].value, "FRAME.png",
    "it still names exactly what the creator approved");
  eq(Kernel.hasCurrentHumanAuthority(unindexed, unA), false, "so shot A is no longer canon — it fails closed");
  const past = Kernel.historicSelection(unindexed, unA);
  ok(past && past.value === "RENAMED.png", "the moved file is visible as a historic selection");
  eq(past.requiresHumanApproval, true, "and the creator can make it canon in one explicit act");
  /* AND THE UNRELATED TARGET IS STILL UNTOUCHED, which is the scope half. */
  eq(Authority.currentAuthorityReceipt(unindexed, unB).value, "FRAME.png",
    "shot B — same basename, different target — is untouched");
  ok(Kernel.hasCurrentHumanAuthority(unindexed, unB), "so shot B is still canon");

  /* AND THE ONE CASE THAT LEGITIMATELY FOLLOWS: the receipt already held the
     identity, and the rename reports the same one. Nothing is invented. */
  const indexed = { shots: [{ id: "SH-C", keyframes: [{ id: "fr-a" }], clips: [], creationBrief: {} }] };
  const unC = { kind: "shot-frame", shotId: "SH-C", frameId: "fr-a" };
  human(() => Kernel.approveFrameCanon(indexed, { shotId: "SH-C", frameId: "fr-a", value: "RAW.png", assetId: "asset-C", at: AT(1) }));
  indexed.shots[0].keyframes[0].winner = "TIDY.png";
  indexed.shots[0].winner = "TIDY.png";
  eq(Private.repairCanonValue(indexed, { ...unC, from: "RAW.png", to: "TIDY.png", assetId: "asset-C" }).length, 1,
    "a receipt that already proved its bytes follows them through a rename");
  ok(Kernel.hasCurrentHumanAuthority(indexed, unC), "and the decision survives its own rename");
  eq(Private.repairCanonValue(indexed, { ...unC, from: "TIDY.png", to: "OTHER.png", assetId: "asset-DIFFERENT" }).length, 0,
    "while a different identity is refused outright");
}

/* ===========================================================================
   2. REFERENCE — a supporting selection is not canon, ever. */

{
  const project = entityProject();
  const entity = project.characters[0];
  const slot = entity.coverageSlots[0];
  const outcome = Slots.assignSlotReference(slot, {
    fileName: "CHAR-A-ONE.png", at: AT(1), via: "coverage-board",
    owner: { project, list: "characters", entityId: "CHAR-A" },
  });
  ok(outcome.assigned, "a creator may select a supporting view");
  eq(slot.selectedFile, "CHAR-A-ONE.png", "the file is stored under a purpose-named key");
  eq(slot.approvedFile, undefined, "and NOT under a key with the word approved in it");
  eq(slot.status, "selected", "the vocabulary is missing | selected | retired");
  eq(slot.assignment.authoritative, false, "and the record states it is not authority");
  eq(Slots.slotIsAuthoritative(), false, "a slot is never authoritative");
  eq(Authority.authorityReceipts(project).length, 0, "selecting mints no receipt");

  /* COUNTEREXAMPLE 5 — and it does not become canon in the projection either,
     which is what the Library reads. */
  const truth = Kernel.entityProductionTruth(project, "characters", "CHAR-A");
  eq(truth.canon, [], "a selected supporting view is not canon");
  eq(truth.references.length, 1, "it is a reference");
  eq(truth.references[0].authoritative, false, "and says so");
  eq(truth.historic, [], "and it is not history either — it is a current, useful, non-authoritative choice");

  /* Ownership is intrinsic on this path too, not an optional policy a caller
     may skip by omitting the owner. */
  const contested = {
    characters: [
      { id: "CHAR-A", prefix: "CHAR-A", candidateFiles: [{ stored: "SHARED.png" }], coverageSlots: [{ id: "front", label: "Front" }] },
      { id: "CHAR-B", prefix: "CHAR-B", candidateFiles: [{ stored: "SHARED.png" }] },
    ],
  };
  const refused = Slots.assignSlotReference(contested.characters[0].coverageSlots[0], {
    fileName: "SHARED.png", at: AT(1), owner: { project: contested, list: "characters", entityId: "CHAR-A" },
  });
  eq(refused.assigned, false, "a contested file cannot be selected for a slot either");
  eq(refused.reason, "SLOT_OWNERSHIP_CONTESTED", "and the refusal says why");
}

/* A LEGACY SLOT IS READ, NOT PROMOTED. The value survives under the old key and
   still means a supporting selection. */
{
  const legacy = { id: "front", label: "Front", approvedFile: "OLD.png", status: "approved" };
  eq(Slots.slotSelectedFile(legacy), "OLD.png", "a legacy slot file is still readable");
  eq(Slots.slotLegacyFile(legacy), "OLD.png", "and is identifiable as legacy");
  eq(Slots.slotUsableAsSupportingReference(legacy), true, "and is usable as supporting context");
  eq(Slots.slotIsAuthoritative(), false, "and is still not canon");
}

/* ===========================================================================
   3. HISTORIC — a pointer with no receipt behind it. */

{
  const project = entityProject();
  const entity = project.characters[0];
  /* The pointer a pre-receipt project carries, and every dogfood project has. */
  entity.approvedFile = "LEGACY.png";
  entity.continuityStates[0].approvedFile = "LEGACY.png";
  const target = { kind: "entity-state", list: "characters", entityId: "CHAR-A", stateId: "state-default" };

  eq(Kernel.hasCurrentHumanAuthority(project, target), false, "a raw pointer is not canon");
  const past = Kernel.historicSelection(project, target);
  ok(past, "it is visible");
  eq(past.value, "LEGACY.png", "with its value intact");
  eq(past.basis, "no-human-receipt", "and the reason it is not canon");
  eq(past.requiresHumanApproval, true, "and what would make it canon");

  const truth = Kernel.entityProductionTruth(project, "characters", "CHAR-A");
  eq(truth.canon, [], "the projection reports no canon");
  eq(truth.historic.map((row) => row.value), ["LEGACY.png"], "and reports the pointer as historic");

  /* COUNTEREXAMPLE 6 — it is not identity-authority for automation either. The
     product surface is asserted in tests/dogfood2-p0-architecture.js; this is
     the projection every one of those surfaces now reads. */
  eq(truth.canon.length, 0, "there is no canon for coverage automation to use as identity");

  /* AND A PERSON CAN CONVERT IT IN ONE ACT — the whole upgrade path, with no
     migration and no fabricated receipt. */
  entity.candidateFiles = [{ stored: "LEGACY.png", decision: "unreviewed" }];
  human(() => Kernel.approveEntityStateCanon(project, {
    list: "characters", entityId: "CHAR-A", stateId: "state-default", value: "LEGACY.png", assetId: "", at: AT(2),
  }));
  ok(Kernel.hasCurrentHumanAuthority(project, target), "confirming the historic selection makes it canon");
  eq(Kernel.historicSelection(project, target), null, "and it stops being historic");
}

/* NOTHING MIGRATES ON ITS OWN. */
{
  const project = entityProject();
  project.characters[0].approvedFile = "LEGACY.png";
  project.characters[0].continuityStates[0].approvedFile = "LEGACY.png";
  const before = JSON.stringify(project);
  Kernel.entityProductionTruth(project, "characters", "CHAR-A");
  Kernel.historicSelection(project, { kind: "entity-state", list: "characters", entityId: "CHAR-A", stateId: "state-default" });
  Kernel.authorityLedgerDiagnostics(project);
  eq(JSON.stringify(project), before, "reading production truth writes nothing, and fabricates no receipt");
}

/* ===========================================================================
   4. AUTOMATION — recommends, never decides. */

{
  const recommendation = Authority.automationRecommendation({
    file: "CAND.png", assetId: "asset-C", score: 94, threshold: 85, rationale: "strong", runId: "run-1", stepKey: "frame:fr-a", at: AT(1),
  });
  eq(recommendation.decision, "ai-recommendation", "an automated pass produces a nomination");
  eq(recommendation.actor, "automation", "attributed to the machine");
  eq(recommendation.requiresHumanApproval, true, "and explicitly still waiting for a person");
  for (const forbidden of ["winner", "approvedAt", "humanApproved"]) {
    ok(!(forbidden in recommendation), `a recommendation must not carry ${forbidden}`);
  }
  ok(Authority.isAutomationRecommendation(recommendation), "and is recognisable as one");
  eq(Authority.isAutomationRecommendation({ decision: "ai-recommendation" }), false,
    "while a partial shape is not — the field that says it is still waiting is required");
}

/* humanApproved IS A CITATION, NEVER A PROVENANCE. */
{
  const project = shotProject();
  const run = {
    id: "run-1", type: "shot-chain", targetId: "SH-01", status: "awaiting-review",
    steps: { "frame:fr-a:review": { key: "frame:fr-a:review", status: "needs-review", frameId: "fr-a" } },
  };
  const stale = { ...run, steps: { "frame:fr-a:review": { key: "frame:fr-a:review", status: "completed", frameId: "fr-a", result: { humanApproved: true, authorityReceiptId: "authority-000001" } } } };
  eq(Authority.gateSatisfied({ kind: "shot-frame-approval", shotId: "SH-01", frameId: "fr-a" }, project), false,
    "a gate is satisfied by a receipt, and there is none");
  eq(Authority.runHasActionableGate(stale, project), true,
    "a completed step claiming a human approval that no receipt supports is a gate again");
  const plan = Authority.reconcileRunGates(stale, project, { at: AT(2) });
  eq(plan.invalidated.length, 1, "reconciliation reopens it");
  Authority.applyGateReconciliation(stale, plan, { project, at: AT(2) });
  eq(stale.steps["frame:fr-a:review"].result.humanApproved, false, "and withdraws the claim rather than leaving it");
  eq(stale.steps["frame:fr-a:review"].result.authorityReceiptId, "", "and the citation with it");

  /* And the honest direction: a real approval closes the gate, and the applier
     re-verifies against the project rather than trusting the plan. */
  human(() => Kernel.approveFrameCanon(project, { shotId: "SH-01", frameId: "fr-a", value: "A.png", assetId: "", at: AT(3) }));
  const honest = Authority.reconcileRunGates(run, project, { at: AT(3) });
  eq(honest.satisfied.length, 1, "a real receipt satisfies the gate");
  Authority.applyGateReconciliation(run, honest, { project, at: AT(3) });
  eq(run.steps["frame:fr-a:review"].status, "completed", "and the step closes");
  ok(run.steps["frame:fr-a:review"].result.authorityReceiptId, "citing the receipt it closed on");

  const forged = { ...honest, satisfied: [{ ...honest.satisfied[0], receiptId: "not-a-real-receipt" }] };
  const other = { id: "run-2", type: "shot-chain", targetId: "SH-01", status: "awaiting-review", steps: { "frame:fr-a:review": { key: "frame:fr-a:review", status: "needs-review", frameId: "fr-a" } } };
  Authority.applyGateReconciliation(other, forged, { project, at: AT(4) });
  eq(other.steps["frame:fr-a:review"].status, "needs-review", "a plan citing a receipt that does not exist closes nothing");
  Authority.applyGateReconciliation(other, honest, { at: AT(4) });
  eq(other.steps["frame:fr-a:review"].status, "needs-review", "and an applier with no project to check against closes nothing either");
}

/* ===========================================================================
   5. LINEAGE — unchanged, and preserved on purpose.

   The full 107-check invariant suite is tests/state-lineage-safety.js and Batch
   1D's independent audit found it closed. This group asserts only that the
   simplification did not reach into it. */
{
  const Lineage = require("../public/shared-state-lineage");
  eq(Lineage.LINEAGE_DELETION_POLICIES, ["refuse"], "there is one deletion policy and it is refusal");
  ok(typeof Lineage.reparentingUnsupported === "function", "and reparenting remains a refusal, not a writer");
  eq(Lineage.reparentingUnsupported().write, false, "which refuses to write");
  eq(Lineage.reparentingUnsupported().reason, "reparenting-unsupported", "and says why");
  const app = read("public/app.js").replace(/\r\n/g, "\n");
  ok(!/st\.parentStateId\s*=\s*(?!"")/.test(app.slice(app.indexOf("for (const list of [\"characters\"")).slice(0, 4000)),
    "project load does not author ancestry");
}

/* ===========================================================================
   6. PREFLIGHT — reading a project does not change it.

   The reachable product surface is asserted against the real modal in
   tests/dogfood2-p0-architecture.js. This group pins the split that makes it
   possible: a reader that reads, and a mutation with a name that says so. */
{
  const app = read("public/app.js").replace(/\r\n/g, "\n");
  ok(/function entityStateListRead\(/.test(app), "there is a pure state reader");
  ok(/function ensureEntityStateList\(/.test(app), "and the mutation is named for what it does");
  ok(!/function entityStateList\(/.test(app), "and the ambiguous name is gone");
  const byId = app.slice(app.indexOf("function entityStateById("), app.indexOf("function selectedEntityStateForShot("));
  ok(/entityStateListRead\(/.test(byId) && !/ensureEntityStateList\(/.test(byId),
    "a function named for a lookup does a lookup");
  const automation = read("public/automation.js").replace(/\r\n/g, "\n");
  for (const opener of ["openAssetAutomationModal", "openEntityChainAutomationModal"]) {
    const body = automation.slice(automation.indexOf(`window.${opener} =`), automation.indexOf(`window.${opener} =`) + 900);
    ok(!/ensureEntityStateList\(/.test(body), `${opener} must not build state structure just to show a preflight`);
  }
}

/* ===========================================================================
   7. THE PRODUCTION-MEDIA PROJECTION AGREES.

   One question, one answer, read by the Results and Inspector surfaces. */
{
  const project = entityProject();
  project.characters[0].approvedFile = "LEGACY.png";
  project.characters[0].continuityStates[0].approvedFile = "LEGACY.png";
  eq(P4.edgesAreReceiptBacked(project, [{ kind: "entity", id: "CHAR-A" }], { list: "characters" }), false,
    "an unreceipted pointer is not receipt-backed for Generated Media either");
  project.characters[0].candidateFiles = [{ stored: "LEGACY.png", decision: "unreviewed" }];
  human(() => Kernel.approveEntityStateCanon(project, {
    list: "characters", entityId: "CHAR-A", stateId: "state-default", value: "LEGACY.png", assetId: "", at: AT(1),
  }));
  eq(P4.edgesAreReceiptBacked(project, [{ kind: "entity", id: "CHAR-A" }], { list: "characters" }), true,
    "and it is, once a person has approved it");
}

DEFERRED.then(() => {
  console.log(`Production truth suite passed ${checks} checks across canon, references, historic pointers, automation, lineage and preflight. Provider calls made: 0.`);
}).catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});

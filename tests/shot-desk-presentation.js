"use strict";

/* Shot desk presentation: selecting an image is inspection, while approval stays
 * with the returned-review item's declared actions and human decision.
 * Synthetic projections only; no server, project data, filesystem fixture or provider.
 */
const assert = require("assert");
const { shotDeskPresentation } = require("../public/shared-shot-desk");

const SHOT = "PH-SB-SCENE-01";
const FRAME = "frame-a";
let checks = 0;

function equal(actual, expected, message) {
  checks += 1;
  assert.strictEqual(actual, expected, message);
}
function deepEqual(actual, expected, message) {
  checks += 1;
  assert.deepStrictEqual(actual, expected, message);
}
function item(key, extra = {}) {
  return {
    key,
    shotId: SHOT,
    owner: { kind: "shot-frame", unitId: FRAME, frameId: FRAME, frameLabel: "A", picked: "", ...extra.owner },
    candidate: {
      key, name: key + ".png", url: "/fixture/" + key + ".png",
      mediaType: "image", disposition: "candidate", receiptBacked: false, ...extra.candidate,
    },
    mediaAvailable: true,
    unreviewable: "",
    humanDecision: "undecided",
    settled: "",
    awaitingReview: true,
    comparison: null,
    actions: ["approve", "reject"],
    ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== "owner" && key !== "candidate")),
  };
}
function projection(items, extra = {}) {
  return { available: true, items, queue: items.filter((row) => row.awaitingReview), ...extra };
}
function freezeTree(value) {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const entry of Object.values(value)) freezeTree(entry);
  }
  return value;
}
function cannotDecide(result, message) {
  equal(result.canApprove, false, message + ": approval is unavailable");
  equal(result.canReject, false, message + ": rejection is unavailable");
}

function missingTargetsNeverChooseAnotherCandidate() {
  const waiting = item("waiting");
  for (const source of [null, undefined, { available: false, items: [waiting] }]) {
    const result = shotDeskPresentation(source, SHOT, waiting.key);
    equal(result.state, "unavailable", "an unavailable projection cannot invent review work");
    cannotDecide(result, "unavailable projection");
  }
  for (const key of [undefined, null, "", "unknown-key"]) {
    const result = shotDeskPresentation(projection([waiting]), SHOT, key);
    equal(result.state, "missing", "an absent or unknown key must not silently claim the next candidate");
    equal(result.item == null, true, "a missing claim must not expose the waiting candidate");
    cannotDecide(result, "missing candidate key");
  }
  const empty = shotDeskPresentation(projection([]), SHOT, "not-here");
  equal(empty.state, "missing", "an empty projection has no review target");
  cannotDecide(empty, "empty projection");

  const otherShot = item("other-shot", { shotId: "OTHER-SHOT" });
  const motion = item("motion", {
    owner: { kind: "shot-motion", unitId: "", frameId: "" },
    candidate: { mediaType: "video", name: "motion.mp4", url: "/fixture/motion.mp4" },
  });
  const nonImage = item("audio", { candidate: { mediaType: "audio" } });
  for (const wrong of [otherShot, motion, nonImage]) {
    const result = shotDeskPresentation(projection([waiting, wrong]), SHOT, wrong.key);
    equal(result.state, "wrong-owner", "a shot image desk must reject an incompatible exact target");
    cannotDecide(result, "wrong owner or media kind");
  }
}

function selectionUsesOnlyAvailableSameFrameImages() {
  const selected = item("Z-first", { awaitingReview: false, settled: "settled-by-pick" });
  const rejected = item("A-rejected", {
    humanDecision: "rejected", settled: "human-rejected", awaitingReview: false,
    candidate: { disposition: "rejected" }, actions: [],
  });
  const approved = item("M-approved", {
    humanDecision: "approved", settled: "human-approved", awaitingReview: false,
    candidate: { disposition: "approved", receiptBacked: true }, actions: [], unreviewable: "decision-not-supported",
  });
  const sameFrameLast = item("B-last");
  const otherFrame = item("other-frame", { owner: { unitId: "frame-b", frameId: "frame-b" } });
  const sameUnitWrongFrame = item("same-unit-wrong-frame", { owner: { frameId: "frame-b" } });
  const otherShot = item("other-shot", { shotId: "OTHER-SHOT" });
  const motion = item("motion", { owner: { kind: "shot-motion" }, candidate: { mediaType: "video" } });
  const stale = item("removed", { unreviewable: "frame-no-longer-declared" });
  const missing = item("missing-bytes", { mediaAvailable: false, candidate: { url: "" } });
  const source = projection([
    selected, otherFrame, rejected, otherShot, approved,
    sameUnitWrongFrame, stale, missing, motion, sameFrameLast,
  ]);
  const result = shotDeskPresentation(source, SHOT, selected.key);
  equal(result.state, "ready", "a settled candidate stays inspectable by its exact key");
  equal(result.item, selected, "selection returns the original item");
  deepEqual(result.candidates.map((row) => row.key),
    ["Z-first", "A-rejected", "M-approved", "B-last"],
    "the candidate strip keeps source order, includes rejected history, and stays inside this frame");
  for (const [index, expected] of [selected, rejected, approved, sameFrameLast].entries())
    equal(result.candidates[index], expected, "candidate peers keep their original references");
}

function actionsAreDeclaredRatherThanInferred() {
  const settled = item("settled-without-actions", { unreviewable: "decision-not-supported", settled: "human-approved", humanDecision: "approved", candidate: { receiptBacked: true }, actions: ["approve", "reject"] });
  const inspection = shotDeskPresentation(projection([settled]), SHOT, settled.key);
  equal(inspection.state, "ready", "a readable settled image remains inspectable when no decision is supported");
  equal(inspection.candidates[0], settled, "a decision-not-supported image stays in the candidate history");
  cannotDecide(inspection, "unsupported decisions despite stale action tokens");
  for (const [actions, canApprove, canReject] of [
    [[], false, false],
    [["approve"], true, false],
    [["reject"], false, true],
    [["approve", "reject"], true, true],
    [["revise", "view-review"], false, false],
  ]) {
    const target = item("declared", { actions });
    const result = shotDeskPresentation(projection([target]), SHOT, target.key);
    equal(result.canApprove, canApprove, "approval follows the exact item's action vocabulary");
    equal(result.canReject, canReject, "rejection follows the exact item's action vocabulary");
  }
  for (const extra of [
    { mediaAvailable: false, candidate: { url: "" }, unreviewable: "media-not-available" },
    { mediaAvailable: false },
    { unreviewable: "frame-no-longer-declared" },
  ]) {
    const target = item("blocked", extra);
    const next = item("next-waiting");
    const result = shotDeskPresentation(projection([target, next]), SHOT, target.key);
    equal(result.state, "unavailable", "missing media or a removed frame cannot become ready");
    equal(result.item, target, "an unavailable exact claim keeps its identity instead of advancing");
    cannotDecide(result, "unavailable exact candidate despite stale action tokens");
    equal(result.candidates.includes(target), false, "unavailable media is excluded from selectable peers");
  }
}

function comparisonUsesOnlyTheReceiptBackedReference() {
  const reference = {
    key: "approved-other", name: "approved-other.png", url: "/fixture/approved-other.png",
    mediaType: "image", receiptBacked: true,
  };
  const target = item("reviewed", { comparison: reference, owner: { picked: "heuristic-winner.png" } });
  const valid = shotDeskPresentation(projection([target]), SHOT, target.key);
  equal(valid.approvedComparison, reference, "comparison preserves the exact receipt-backed projection reference");

  for (const comparison of [
    null,
    { ...reference, receiptBacked: false },
    { ...reference, receiptBacked: undefined },
    { ...reference, url: "" },
    { ...reference, key: target.key },
  ]) {
    const invalid = item("reviewed", { comparison, owner: { picked: "heuristic-winner.png" } });
    const approvedPeer = item("unrelated-approved-peer", {
      humanDecision: "approved",
      candidate: { disposition: "approved", receiptBacked: true },
    });
    const result = shotDeskPresentation(projection([invalid, approvedPeer]), SHOT, invalid.key);
    equal(result.approvedComparison, null,
      "missing or unbacked comparison cannot be replaced by a winner name or an approved peer");
  }
}

function labelsDistinguishHumanDecisionFromMachineSelection() {
  for (const [extra, expected] of [
    [{ humanDecision: "approved", settled: "human-approved", candidate: { receiptBacked: true } }, "Approved"],
    [{ humanDecision: "rejected", settled: "human-rejected", actions: [] }, "Rejected"],
    [{ settled: "kept-as-alternate" }, "Kept as alternate"],
    [{ humanDecision: "machine-selected", settled: "machine-selected" }, "Selected; not approved"],
    [{ settled: "settled-by-pick" }, "Another image is selected"],
    [{ settled: "unit-already-picked" }, "Another image is selected"],
    [{ humanDecision: "undecided", settled: "" }, "Awaiting your decision"],
  ]) {
    const target = item("decision", {
      ...extra,
      aiReview: { pass: true, score: 100, recommendation: "approve", notes: "Human approved" },
    });
    const result = shotDeskPresentation(projection([target]), SHOT, target.key);
    equal(result.state, "ready", "a decision changes the label without hiding inspectable media");
    equal(result.decisionLabel, expected, "only humanDecision and settlement may supply decision wording");
  }
  for (const extra of [
    { humanDecision: "approved", settled: "human-approved", candidate: { receiptBacked: false } },
    { humanDecision: "machine-selected", candidate: { receiptBacked: true } },
  ]) {
    const target = item("unproven-approval", extra);
    const result = shotDeskPresentation(projection([target]), SHOT, target.key);
    equal(result.decisionLabel === "Approved", false,
      "human approval requires both a human decision and its receipt");
  }
}

function presentationNeverMutatesTheProjection() {
  const reference = { key: "canon", name: "canon.png", url: "/fixture/canon.png", receiptBacked: true };
  const first = item("Z", { comparison: reference });
  const second = item("A", { actions: [] });
  const source = projection([first, second], { queue: [second, first] });
  const before = JSON.stringify(source);
  freezeTree(source);
  for (const key of [first.key, second.key, "missing"]) shotDeskPresentation(source, SHOT, key);
  equal(JSON.stringify(source), before, "selection leaves every projection field and ordering unchanged");
  const result = shotDeskPresentation(source, SHOT, first.key);
  equal(result.item, first, "a frozen item is returned by reference");
  equal(result.candidates[0], first, "a frozen candidate is returned by reference");
  equal(result.approvedComparison, reference, "a frozen comparison is returned by reference");
}

missingTargetsNeverChooseAnotherCandidate();
selectionUsesOnlyAvailableSameFrameImages();
actionsAreDeclaredRatherThanInferred();
comparisonUsesOnlyTheReceiptBackedReference();
labelsDistinguishHumanDecisionFromMachineSelection();
presentationNeverMutatesTheProjection();
console.log("shot-desk-presentation: " + checks + " assertions passed");

/* Presentation of the existing returned-review projection. No authority, persistence,
 * filename ownership inference, or alternate review queue lives here. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis, function () {
  function shotDeskPresentation(projection, shotId, key) {
    const empty = (state, item = null) => Object.freeze({
      state, item, candidates: Object.freeze([]), approvedComparison: null,
      canApprove: false, canReject: false, decisionLabel: "",
    });
    if (!projection || projection.available !== true) return empty("unavailable");
    const items = Array.isArray(projection.items) ? projection.items : [];
    const item = key ? items.find((row) => row.key === key) : null;
    if (!item) return empty("missing");
    if (item.shotId !== shotId || item.owner?.kind !== "shot-frame"
      || item.candidate?.mediaType !== "image") return empty("wrong-owner", item);
    if (!item.mediaAvailable || !item.candidate.url
      || ["media-not-available", "frame-no-longer-declared"].includes(item.unreviewable))
      return empty("unavailable", item);
    const candidates = items.filter((row) => row.shotId === shotId
      && row.owner?.kind === "shot-frame" && row.owner.frameId === item.owner.frameId
      && row.candidate?.mediaType === "image" && row.mediaAvailable && row.candidate.url
      && !["media-not-available", "frame-no-longer-declared"].includes(row.unreviewable));
    const comparison = item.comparison;
    const approvedComparison = comparison?.receiptBacked === true
      && comparison.url && comparison.key !== item.key ? comparison : null;
    const actions = Array.isArray(item.actions) ? item.actions : [];
    let decisionLabel = "Awaiting your decision";
    if (item.humanDecision === "approved" && item.candidate.receiptBacked === true) decisionLabel = "Human approved";
    else if (item.humanDecision === "rejected" || item.settled === "human-rejected") decisionLabel = "Rejected";
    else if (item.settled === "kept-as-alternate") decisionLabel = "Kept as alternate";
    else if (item.settled === "machine-selected") decisionLabel = "Selected; not human approved";
    else if (["unit-already-picked", "settled-by-pick"].includes(item.settled)) decisionLabel = "Another image is selected";
    return Object.freeze({
      state: "ready", item, candidates: Object.freeze(candidates), approvedComparison,
      canApprove: !item.unreviewable && actions.includes("approve"),
      canReject: !item.unreviewable && actions.includes("reject"), decisionLabel,
    });
  }
  return { shotDeskPresentation };
});

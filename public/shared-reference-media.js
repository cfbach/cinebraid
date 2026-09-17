/* Reference bindings are relationships, never another physical media record.
   The server resolves bytes once; browser consumers read that same projection. */
(function(root) {
  "use strict";
  const dirs = Object.freeze({characters:"anchors", locations:"plates", props:"props", vehicles:"vehicles"});
  const rows = value => Array.isArray(value) ? value : [];
  const keyOf = row => String(row?.stored || row?.name || "");
  function bindingIssue(entity, list, row) {
    const b = row?.referenceBinding;
    if (!b || b.version !== 1 || !/^ref-[a-f0-9-]{36}$/.test(b.id || "") || keyOf(row) !== b.id) return "invalid-binding";
    if (b.entityList !== list || b.entityId !== entity?.id) return "wrong-reference";
    if (!/^asset-[a-f0-9]{32}$/.test(b.assetId || "")) return "invalid-asset-identity";
    const states = rows(entity.continuityStates);
    if (!states.some(s => s.id === b.stateId) && !(b.stateId === "state-default" && !states.length)) return "unknown-state";
    if (!rows(entity.coverageSlots).some(s => s.id === b.slotId)) return "unknown-view";
    if (row.targetStateId !== b.stateId || row.targetCoverageSlotId !== b.slotId) return "binding-target-changed";
    if (!b.identity || !Number.isFinite(b.identity.bytes) || !Number.isFinite(b.identity.mtimeMs)) return "identity-observation-missing";
    return "";
  }
  function listing(scan, list, entityId, includeUnavailable = false) {
    const result = rows(scan?.references?.[list]?.[entityId]);
    return includeUnavailable ? result : result.filter(r => r.available === true);
  }
  function selectedKey(entity, slot, stateId) {
    if (slot?.referenceBindings && Object.hasOwn(slot.referenceBindings, stateId)) {
      const key=String(slot.referenceBindings[stateId] || ""), candidate=rows(entity?.candidateFiles).find(r=>keyOf(r)===key), binding=candidate?.referenceBinding;
      return binding && binding.stateId===stateId && binding.slotId===slot.id ? key : "";
    }
    const key = String(slot?.selectedFile || slot?.approvedFile || "");
    const candidate = rows(entity?.candidateFiles).find(r => keyOf(r) === key);
    return candidate?.referenceBinding && candidate.referenceBinding.stateId !== stateId ? "" : key;
  }
  /* EV2-7 — basis-aware readers. selectedKey() keeps its fallback (paid shot generation reads it);
     these say WHY a key answers, so a nondefault state never counts a legacy selection nobody scoped as its own. */
  function defaultStateId(entity) {
    return (rows(entity?.continuityStates).find(s => s.isDefault) || rows(entity?.continuityStates)[0])?.id || "state-default";
  }
  function selectedAssignment(entity, slot, stateId) {
    const key = selectedKey(entity, slot, stateId);
    if (!key) return {key, basis:""};
    const binding = rows(entity?.candidateFiles).find(r => keyOf(r) === key)?.referenceBinding;
    return {key, basis: binding && binding.stateId === stateId && binding.slotId === slot?.id ? "binding" : "legacy"};
  }
  function requiredSlots(entity) {
    const requirement = typeof module !== "undefined" && module.exports ? require("./shared-coverage").coverageRequirement : globalThis.coverageRequirement;
    return rows(entity.coverageSlots).filter(s => typeof requirement === "function" && requirement(s) === "required");
  }
  /* EV2-7 — ONE ANSWER PER VIEW, IN ONE WORDING. The Desk header, the Desk's view buttons and
     Build coverage's views table all read this against the unfiltered listing (every state's rows),
     so a view cannot be "filled" in one place and "unavailable" in another. An earlier selection
     (a legacy slot selection a nondefault state does not count) names the state its image was
     recorded for, or says that none was recorded. */
  function viewStatus(entity, slot, stateId, media) {
    const a = selectedAssignment(entity, slot, stateId), isDefault = stateId === defaultStateId(entity);
    const item = a.key ? rows(media).find(m => m.name === a.key) || null : null, present = !!item && item.available !== false;
    const filled = present && (a.basis === "binding" || isDefault), earlier = present && !filled;
    const recordedStateId = earlier ? String(rows(entity?.candidateFiles).find(r => keyOf(r) === a.key)?.targetStateId || item.stateId || "") : "";
    const recordedStateName = recordedStateId ? String(rows(entity?.continuityStates).find(s => s.id === recordedStateId)?.name || (recordedStateId === "state-default" ? "Default" : recordedStateId)) : "";
    const qualifier = earlier ? (recordedStateId ? "recorded for " + recordedStateName : "state not recorded") : "";
    const status = filled ? "filled" : earlier ? "earlier" : a.key ? "unavailable" : "missing";
    const label = filled ? "View filled" : earlier ? "Earlier selection · " + qualifier : a.key ? "Image unavailable" : "Missing";
    return {...a, item, present, filled, earlier, recordedStateId, recordedStateName, qualifier, status, label};
  }
  function coverage(entity, media, stateId) {
    const required = requiredSlots(entity);
    let filled = 0, unscoped = 0;
    const earlier = {};
    for (const s of required) {
      const v = viewStatus(entity, s, stateId, media);
      if (v.filled) filled++;
      else if (v.earlier) { unscoped++; earlier[v.qualifier] = (earlier[v.qualifier] || 0) + 1; }
    }
    return {required:required.length, filled, unscoped, earlier};
  }
  function coverageSummary(value) {
    const notes = Object.entries(value?.earlier || {}).map(([qualifier, n]) => " · " + n + (n === 1 ? " earlier selection, " : " earlier selections, ") + qualifier);
    return (value?.filled || 0) + " of " + (value?.required || 0) + " required views filled" + notes.join("");
  }
  // The retry idempotency check: this exact asset already bound to this exact state and view.
  function findExactBinding(entity, {assetId, stateId, slotId} = {}) {
    const slot = rows(entity?.coverageSlots).find(s => s.id === slotId);
    if (!slot || !assetId || !stateId) return null;
    const bound = slot.referenceBindings && Object.hasOwn(slot.referenceBindings, stateId) ? String(slot.referenceBindings[stateId] || "") : "";
    return rows(entity?.candidateFiles).find(r => r?.referenceBinding && r.referenceBinding.assetId === assetId && r.referenceBinding.stateId === stateId && r.referenceBinding.slotId === slotId && keyOf(r) === bound) || null;
  }
  const api = {dirs, keyOf, bindingIssue, listing, selectedKey, requiredSlots, coverage, coverageSummary, viewStatus, defaultStateId, selectedAssignment, findExactBinding};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CineBraidReferenceMedia = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

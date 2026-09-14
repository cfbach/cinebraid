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
  function requiredSlots(entity) {
    const requirement = typeof module !== "undefined" && module.exports ? require("./shared-coverage").coverageRequirement : globalThis.coverageRequirement;
    return rows(entity.coverageSlots).filter(s => typeof requirement === "function" && requirement(s) === "required");
  }
  function coverage(entity, media, stateId) {
    const required = requiredSlots(entity);
    const available = new Set(rows(media).filter(m => m.available !== false).map(m => m.name));
    return {required:required.length, filled:required.filter(s => available.has(selectedKey(entity,s,stateId))).length};
  }
  const api = {dirs, keyOf, bindingIssue, listing, selectedKey, requiredSlots, coverage};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CineBraidReferenceMedia = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

"use strict";
// Disclosure events are presentation, never permission to persist a project.
const assert = require("assert");
const vm = require("vm");
const { render, buildFixture } = require("./render-harness");
async function probe(mutateSource) {
  const fixture = buildFixture();
  const { context } = await render("#/shot/L1-01", fixture, { ...(mutateSource ? { mutateSource } : {}) });
  const result = vm.runInContext(`(() => {
    ROUTE_RENDER_IN_PROGRESS = false;
    const s = P.shots[0];
    s.creationBrief.openPanels = { inputs: true };
    let saves = 0;
    dirty = () => { saves++; };
    const before = JSON.stringify(P);
    const legacy = guidedPanelOpen(s, 'inputs', false);
    rememberGuidedPanel(s.id, 'inputs', false);
    const afterFirstToggle = JSON.stringify(P);
    const collapsed = guidedPanelOpen(s, 'inputs', true);
    const otherPanel = guidedPanelOpen(s, 'motion', true);
    const otherShot = guidedPanelOpen({ id: 'other-shot' }, 'inputs', true);
    const slug = ACTIVE_PROJECT_SLUG;
    ACTIVE_PROJECT_SLUG = 'other-project';
    const otherProject = guidedPanelOpen(s, 'inputs', true);
    ACTIVE_PROJECT_SLUG = slug;
    const remembered = guidedPanelOpen(s, 'inputs', true);
    // A delayed insertion/restoration toggle and a second real toggle do no writes.
    rememberGuidedPanel(s.id, 'inputs', true);
    rememberGuidedPanel(s.id, 'inputs', true);
    const after = JSON.stringify(P), presentationSaves = saves;
    const bare = { id: 'bare' }, bareBefore = JSON.stringify(bare);
    guidedPanelOpen(bare, 'inputs', false);
    const bareAfter = JSON.stringify(bare);
    const get = localStorage.getItem, set = localStorage.setItem;
    localStorage.getItem = () => { throw Error('storage unavailable'); };
    localStorage.setItem = () => { throw Error('storage unavailable'); };
    const storageFallback = guidedPanelOpen(s, 'inputs', false);
    rememberGuidedPanel(s.id, 'inputs', false);
    localStorage.getItem = get; localStorage.setItem = set;
    const savesAfterStorageFailure = saves;
    setVal('shots', s.id, 'title', 'A deliberate owner edit');
    return { before, after, afterFirstToggle, presentationSaves, legacy, collapsed, otherPanel, otherShot, otherProject, remembered,
      bareBefore, bareAfter, storageFallback, savesAfterStorageFailure, editSaves: saves, editedTitle: s.title };
  })()`, context);
  assert.strictEqual(result.presentationSaves, 0, "a disclosure must not schedule a project save");
  assert.strictEqual(result.afterFirstToggle, result.before, "a disclosure cannot rewrite the project panel map");
  assert.strictEqual(result.after, result.before, "a disclosure must not rewrite project state in memory either");
  assert.strictEqual(result.legacy, true, "legacy stored preference remains a read-only fallback");
  assert.strictEqual(result.collapsed, false, "a user toggle is remembered locally");
  assert.strictEqual(result.remembered, false, "returning to the project restores its local preference");
  for (const key of ["otherPanel", "otherShot", "otherProject", "storageFallback"]) assert.strictEqual(result[key], true, key);
  assert.strictEqual(result.bareAfter, result.bareBefore, "reading a disclosure cannot normalize a bare shot");
  assert.strictEqual(result.savesAfterStorageFailure, 0, "unavailable browser storage cannot fall back to a project write");
  assert.strictEqual(result.editSaves, 1, "an actual authored edit still schedules its normal save");
  assert.strictEqual(result.editedTitle, "A deliberate owner edit");
}
async function main() {
  await probe();
  const controls = [
    { name: "dirty trigger", file: "creation-studio.js", from: "rememberWorkspaceSection(guidedPanelPreferenceKey(id, key), !!open);", to: "rememberWorkspaceSection(guidedPanelPreferenceKey(id, key), !!open); dirty();", error: "a disclosure must not schedule" },
    { name: "project panel mutation", file: "creation-studio.js", from: "rememberWorkspaceSection(guidedPanelPreferenceKey(id, key), !!open);", to: "shotById(id).creationBrief.openPanels[key] = !!open; rememberWorkspaceSection(guidedPanelPreferenceKey(id, key), !!open);", error: "cannot rewrite the project panel map" },
    { name: "project scope removed", file: "app.js", from: 'return `cinebraid-section:${ACTIVE_PROJECT_SLUG || "project"}:${String(key || "section")}`;', to: 'return `cinebraid-section:${String(key || "section")}`;', error: "otherProject" },
    { name: "normalizing disclosure read", file: "creation-studio.js", from: "const stored = s.creationBrief?.openPanels || {};", to: "ensureShotCreation(s); const stored = s.creationBrief?.openPanels || {};", error: "reading a disclosure cannot normalize" },
  ];
  for (const control of controls) {
    let applied = false;
    await assert.rejects(() => probe((file, source) => {
      if (file !== control.file) return source;
      assert(source.includes(control.from), "negative-control anchor missing");
      applied = true;
      return source.replace(control.from, control.to);
    }), (error) => error.code === "ERR_ASSERTION" && error.message.includes(control.error));
    assert(applied);
    console.log(`DETECTED ${control.name}`);
  }
  console.log("PASS delayed and repeated disclosure events, local preference scope, legacy fallback, storage refusal, authored edit control.");
}
module.exports = { probe };
if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });

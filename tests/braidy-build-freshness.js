"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const History = require(path.join(root, "public", "shared-build-history.js"));
const shot = {
  id: "SH-1", motionPrompt: "A parcel opens.",
  keyframes: [{ id: "frame-a", label: "A", description: "Closed parcel." }],
  creationBrief: {
    blockingProfileId: "gpt-image-2/blocking", blockingIncludeLabels: true,
    blockingEmphasis: "auto", blockingRevisionRequest: "", blockingRevisionSourceAssetId: "",
    composition: { camera: { shotSize: "wide" } }, blockingBuilds: [],
    frameWorkflows: { "frame-a": { action: "Closed parcel.", staging: "On bench.", camera: "Wide.", notes: "" } },
  },
};
const project = { meta: { style: "Flat illustration", world: { setting: "Platform." } }, mediaAssets: [] };
const browser = { window: {}, P: project, promptReferenceOptions() { return []; }, ...History };
browser.window = browser;
vm.runInNewContext(fs.readFileSync(path.join(root, "public", "review-provenance.js"), "utf8"), browser);
function parity(pack, change, reason) {
  pack.references = [];
  pack.dependencySnapshot = JSON.parse(JSON.stringify(browser.currentSnapshotForPackage(shot, pack)));
  assert.deepEqual(Array.from(browser.packageStaleReasons(shot, pack)), []);
  assert.deepEqual(Array.from(History.packageProjectFreshness(project, shot, pack).reasons), []);
  change();
  const local = Array.from(browser.packageStaleReasons(shot, pack));
  const server = Array.from(History.packageProjectFreshness(project, shot, pack).reasons);
  assert(local.includes(reason), "browser must report " + reason + ": " + local);
  assert(server.includes(reason), "server must report " + reason + ": " + server);
}
parity({ kind: "blocking-frame", profileId: "gpt-image-2/blocking" },
  () => { shot.creationBrief.frameWorkflows["frame-a"].action = "Open parcel."; },
  "blocking brief or settings changed");
shot.creationBrief.frameWorkflows["frame-a"].action = "Closed parcel.";
parity({ kind: "guided-frame", frameId: "frame-a", profileId: "gpt-image-2/t2i" },
  () => { shot.creationBrief.frameWorkflows["frame-a"].camera = "Close-up."; },
  "frame workflow direction or settings changed");
const canonPack = { kind: "blocking-frame", profileId: "gpt-image-2/blocking", references: [] };
canonPack.dependencySnapshot = JSON.parse(JSON.stringify(browser.currentSnapshotForPackage(shot, canonPack)));
canonPack.dependencySnapshot.canonContext = History.packageCanonContextInputs(project, shot, canonPack);
project.meta.world.setting = "Different platform.";
assert(Array.from(browser.packageStaleReasons(shot, canonPack)).includes("project, scene, shot or entity Canon changed"));
assert(Array.from(History.packageProjectFreshness(project, shot, canonPack).reasons)
  .includes("project, scene, shot or entity Canon changed"));
project.meta.world.setting = "Platform.";

/* R04 Last Seat reproduction: the guided frame compiler consumes structural
   state/view keys, not planning promptReferenceOptions' character/take keys.
   Excluded Gate/Sword must stay absent; Rex/Chair survive reload unchanged. */
const frameReferenceShot = {
  id: "TLS-005",
  keyframes: [{ id: "frame-a", label: "A" }, { id: "frame-b", label: "B" }],
  creationBrief: { disabledInputKeys: [
    "locations:LOC-MONUMENTAL-GATE:state-default",
    "props:PROP-REX-SWORD:state-default",
  ], frameWorkflows: { "frame-a": {}, "frame-b": {} } },
};
const rexKey = "characters:CHAR-REX-VANDAR:state-default";
const chairKey = "props:PROP-FOLDING-CHAIR:state-default";
const gateKey = "locations:LOC-MONUMENTAL-GATE:state-default";
const swordKey = "props:PROP-REX-SWORD:state-default";
const inputOptions = {
  "frame-a": [
    { key: rexKey, label: "Rex Vandar", url: "/api/references/image?assetId=rex-a",
      role: "identity", mediaType: "image" },
    { key: chairKey, label: "Folding Chair", url: "/api/references/image?assetId=chair-a",
      role: "prop", mediaType: "image" },
    { key: gateKey, label: "Monumental Gate", url: "/api/references/image?assetId=gate",
      role: "base", mediaType: "image" },
    { key: swordKey, label: "Rex's Sword", url: "/api/references/image?assetId=sword",
      role: "prop", mediaType: "image" },
  ],
  "frame-b": [
    { key: rexKey, label: "Rex Vandar · changed state",
      url: "/api/references/image?assetId=rex-b", role: "identity", mediaType: "image" },
  ],
};
const frameReferenceProject = { meta: {}, shots: [frameReferenceShot] };
const frameBrowser = {
  window: {}, P: frameReferenceProject, ...History,
  guidedFrames(s) { return s.keyframes; },
  guidedFrameState(s, frame) { return s.creationBrief.frameWorkflows[frame.id]; },
  guidedFramePromptRefs(s, frame) {
    return inputOptions[frame.id].filter((ref) =>
      !s.creationBrief.disabledInputKeys.includes(ref.key));
  },
  promptReferenceOptions() {
    return [{ key: "character:CHAR-REX-VANDAR",
      url: "/api/references/image?assetId=rex-a", role: "identity" }];
  },
};
frameBrowser.window = frameBrowser;
vm.runInNewContext(fs.readFileSync(path.join(root, "public", "review-provenance.js"), "utf8"),
  frameBrowser);
const framePack = {
  kind: "guided-frame", frameId: "frame-a", mode: "multi-reference",
  profileId: "gpt-image-2/multi-reference",
  references: inputOptions["frame-a"].slice(0, 2).map((row) => ({ ...row })),
};
assert.deepEqual(Array.from(frameBrowser.currentPackageReferenceOptions(frameReferenceShot, framePack))
  .map((row) => row.key), [rexKey, chairKey],
  "frame freshness must use the exact frame collector and retain shot exclusions");
framePack.dependencySnapshot = JSON.parse(JSON.stringify(
  frameBrowser.currentSnapshotForPackage(frameReferenceShot, framePack)));
assert.deepEqual(Array.from(frameBrowser.packageStaleReasons(frameReferenceShot, framePack)), [],
  "the unchanged R04 structural Rex/Chair inputs must remain fresh after reload");
assert.equal(frameBrowser.currentPackageReferenceOptions(frameReferenceShot,
  { kind: "guided-frame", frameId: "frame-b" })[0].url,
  "/api/references/image?assetId=rex-b", "a frame-specific state/view must use that frame's media");
inputOptions["frame-a"][1].url = "/api/references/image?assetId=chair-replaced";
assert(Array.from(frameBrowser.packageStaleReasons(frameReferenceShot, framePack))
  .includes("approved reference file changed"),
  "replacement media at the same structural slot must stale the frame package");
inputOptions["frame-a"][1].url = "/api/references/image?assetId=chair-a";
frameReferenceShot.creationBrief.disabledInputKeys.push(rexKey);
const missingRex = Array.from(frameBrowser.packageStaleReasons(frameReferenceShot, framePack));
assert(missingRex.some((reason) => reason.includes("Rex Vandar")
  && reason.includes("can no longer be supplied")),
  "excluding a consumed frame input must name the missing exact reference");
frameReferenceShot.creationBrief.disabledInputKeys.pop();
assert.deepEqual(Array.from(frameBrowser.packageStaleReasons(frameReferenceShot, framePack)), []);

const creation = fs.readFileSync(path.join(root, "public", "creation-studio.js"), "utf8");
const start = creation.indexOf("window.buildBlockingPrompt = async ");
const end = creation.indexOf("window.uploadBlockingFrames = async ", start);
assert(start >= 0 && end > start);
function deferred() {
  let resolve;
  return { promise: new Promise((done) => { resolve = done; }), resolve };
}
let gate = deferred(), sent = null, dirtyCount = 0, lastOp = null;
const ui = {
  window: {}, P: project, GUIDED_PROMPT_TIMEOUTS: { compile: 10000, improve: 10000 },
  shotById(id) { return id === shot.id ? shot : null; },
  ensureShotCreation(s) { return s.creationBrief; },
  preferredCreationProfile(_purpose, value) { return value || "gpt-image-2/blocking"; },
  keepGuidedPanelOpen() {}, setGuidedPromptOp(_kind, _id, _frame, value) { lastOp = value; },
  route() {}, dirty() { dirtyCount++; }, toast() {},
  blockingFrameBrief(s) { return s.creationBrief.frameWorkflows["frame-a"].action; },
  blockingAdditionalDirection(s) {
    const state = s.creationBrief.frameWorkflows["frame-a"];
    return [state.staging, state.camera, state.notes].filter(Boolean).join("\n");
  },
  packageBlockingInputs: History.packageBlockingInputs,
  packageCanonContextInputs: History.packageCanonContextInputs,
  globalStylePrompt() { return project.meta.style; },
  packageInputSnapshot() { return { direction: shot.motionPrompt }; },
  currentDirectionForPackage() { return shot.motionPrompt; },
  guidedPromptRequest(_url, options) { sent = JSON.parse(options.body); return gate.promise; },
};
ui.window = ui;
vm.runInNewContext(creation.slice(start, end), ui);
const compiled = { compiledPrompt: "Compiled blocking", spec: {}, warnings: [], confirmations: [] };
async function run() {
  const first = ui.buildBlockingPrompt("SH-1");
  assert.equal(sent.blockingFrameBrief, "Closed parcel.");
  shot.creationBrief.frameWorkflows["frame-a"].action = "Open parcel.";
  gate.resolve(compiled);
  await first;
  assert.equal(shot.creationBrief.blockingBuilds.length, 0, "late old response cannot save under newer direction");
  assert.match(lastOp.error, /changed while compiling/);
  assert.equal(dirtyCount, 0);

  gate = deferred();
  const second = ui.buildBlockingPrompt("SH-1");
  assert.equal(sent.blockingFrameBrief, "Open parcel.");
  gate.resolve(compiled);
  const build = await second;
  assert.equal(build.inputBrief, sent.blockingFrameBrief);
  assert.equal(build.dependencySnapshot.blockingInputs.action, sent.blockingFrameBrief);
  assert.equal(shot.creationBrief.blockingBuilds.length, 1);

  gate = deferred();
  const third = ui.buildBlockingPrompt("SH-1");
  project.meta.world.setting = "Another location.";
  gate.resolve(compiled);
  await third;
  assert.equal(shot.creationBrief.blockingBuilds.length, 1, "late old response cannot bless changed production context");
  assert.match(lastOp.error, /Production context changed/);
  /* The busy render can materialize frame defaults before the compiler call.
     The recorded witness must describe the same request that was actually sent,
     yet a later owner edit while that response is pending must still refuse. */
  const frameShot = {
    id: "FR-1",
    keyframes: [{ id: "frame-a", label: "A", description: "Parcel on bench." }],
    creationBrief: {
      composition: {}, activeGuidedFrameId: "", promptBuilds: [],
      profileId: "gpt-image-2/edit",
      frameWorkflows: { "frame-a": {
        action: "Parcel on bench.", staging: "Center the parcel.", camera: "Wide.",
        notes: "", mode: "auto", profileId: "gpt-image-2/edit", promptBuilds: [],
      } },
    },
    promptBuilds: [], generationPackages: [],
  };
  const frameProject = { meta: { style: "Flat illustration", world: { setting: "Platform." } },
    shots: [frameShot], promptBuildsById: {} };
  const frameState = frameShot.creationBrief.frameWorkflows["frame-a"];
  let frameGate = deferred(), frameSent = null, frameOp = null, frameRoutes = 0;
  const frameUi = {
    window: {}, P: frameProject, GUIDED_PROMPT_TIMEOUTS: { compile: 10000 },
    shotById(id) { return id === frameShot.id ? frameShot : null; },
    guidedFrames(s) { return s.keyframes; },
    guidedFrameState() {
      frameState.profileId = frameShot.creationBrief.profileId || frameState.profileId;
      return frameState;
    },
    guidedFramePromptRefs() { return []; },
    frameIncludedMissingInputs() { return []; },
    guidedFrameMode() { return "t2i"; },
    preferredCreationProfile() { return "gpt-image-2/t2i"; },
    framePromptComposition() { return null; },
    ensureShotCreation(s) { return s.creationBrief; },
    setGuidedPromptOp(_kind, _id, _frame, value) { frameOp = value; },
    route() {
      frameRoutes++;
      if (frameRoutes === 1) frameState.mode = "t2i";
      frameUi.guidedFrameState();
    },
    dirty() {}, toast() {},
    globalStylePrompt() { return frameProject.meta.style; },
    packageFrameWorkflowInputs: History.packageFrameWorkflowInputs,
    packageCanonContextInputs: History.packageCanonContextInputs,
    packageInputSnapshot() { return {}; },
    currentDirectionForPackage() { return "Parcel on bench."; },
    guidedPromptRequest(_url, options) { frameSent = JSON.parse(options.body); return frameGate.promise; },
    registerPromptBuild(P, build) { P.promptBuildsById[build.id] = build; return build.id; },
    promptBuildRef(id, fields) { return { id, ...fields }; },
    applyPromptBuildRetention() {},
  };
  frameUi.window = frameUi;
  const frameStart = creation.indexOf("window.buildGuidedFramePrompt = async ");
  const frameEnd = creation.indexOf("window.visionReviewFrame = async ", frameStart);
  assert(frameStart >= 0 && frameEnd > frameStart);
  vm.runInNewContext(creation.slice(frameStart, frameEnd), frameUi);
  const frameCompiled = { compiledPrompt: "Compiled frame", spec: {},
    references: [], warnings: [], confirmations: [] };
  const normalizedBuild = frameUi.buildGuidedFramePrompt("FR-1", "frame-a", false);
  assert.equal(frameSent.directive.includes("Camera and framing: Wide."), true);
  frameUi.route(); // another normal render while the compiler response is pending
  assert.equal(frameState.profileId, "gpt-image-2/t2i");
  frameGate.resolve(frameCompiled);
  await normalizedBuild;
  assert.equal(frameState.promptBuilds.length, 1,
    "synchronous render defaults must not falsely refuse a frame build");
  const savedFrame = Object.values(frameProject.promptBuildsById)[0];
  assert.equal(savedFrame.dependencySnapshot.frameWorkflowInputs.mode, "t2i");
  assert.equal(savedFrame.dependencySnapshot.frameWorkflowInputs.profileId, "gpt-image-2/t2i");
  assert.deepEqual(History.packageProjectFreshness(frameProject, frameShot, savedFrame).reasons, []);

  frameGate = deferred();
  frameRoutes = 0;
  frameState.mode = "auto";
  const staleFrame = frameUi.buildGuidedFramePrompt("FR-1", "frame-a", false);
  assert.equal(frameSent.directive.includes("Camera and framing: Wide."), true);
  frameState.camera = "Close-up.";
  frameGate.resolve(frameCompiled);
  await staleFrame;
  assert.equal(frameState.promptBuilds.length, 1,
    "an owner camera edit during pending compilation must refuse the old response");
  assert.match(frameOp.error, /Frame direction changed while compiling/);

  frameGate = deferred();
  frameRoutes = 0;
  frameState.mode = "auto";
  const changedTarget = frameUi.buildGuidedFramePrompt("FR-1", "frame-a", false);
  frameShot.creationBrief.profileId = "gpt-image-2/edit";
  frameUi.route(); // a genuine target selection is mirrored into Frame A
  frameGate.resolve(frameCompiled);
  await changedTarget;
  assert.equal(frameState.promptBuilds.length, 1,
    "an owner target change during pending compilation must refuse the old response");
  assert.match(frameOp.error, /Frame direction changed while compiling/);

  /* The v607 unit wrapper borrows the unit's wording in shot-level controls
     while the base compiler awaits a response. A rejected late response has no
     new build, so it must never copy those borrowed old controls over an edit. */
  const v607 = fs.readFileSync(path.join(root, "public", "v607-composer.js"), "utf8");
  const wrapperStart = v607.indexOf("  const buildGuidedMotionPrompt606 = window.buildGuidedMotionPrompt;");
  const wrapperEnd = v607.indexOf("    window.__CINEBRAID_COMPOSER_607_READY", wrapperStart);
  assert(wrapperStart >= 0 && wrapperEnd > wrapperStart, "v607 motion wrapper test seam must exist");
  const unit = { id: "motion-a", label: "A", motionPrompt: "Original direction", note: "Original direction",
    motionProfileId: "minimax-h3/i2v", dur: 5 };
  const motionShot = { id: "SH-MOTION", creationBrief: { motionPromptBuilds: [], motionPlan: {},
    motionDirection: "shot-level default", motionDuration: 5, motionProfileId: "minimax-h3/i2v",
    motionIntensity: "subtle", preserveComposition: true }, clips: [unit] };
  const motionProject = { meta: {}, shots: [motionShot], promptBuildsById: {} };
  const motionGate = deferred();
  const motionUi = {
    window: {}, P: motionProject,
    shotById: () => motionShot, ensureShotCreation: () => motionShot.creationBrief,
    activeMotionUnit: () => unit, keepGuidedPanelOpen() {},
    effectiveMotionPlan: () => ({}), preferredGuidedVideoProfile: (id) => id,
    guidedVideoProfiles: () => [{ id: "minimax-h3/i2v", mode: "i2v" }],
    guidedCurrentShotStill: () => null, motionReferenceBudget: () => ({ dropped: [], totalLimit: 0, typeLimits: {}, counts: {} }),
    latestPromptBuild: (_project, refs) => { const id = refs.at(-1)?.id; return id ? JSON.parse(JSON.stringify(motionProject.promptBuildsById[id])) : null; },
    clone: (value) => JSON.parse(JSON.stringify(value)),
    dirty() {}, route() {}, toast() {}, packageCanonContextInputs: History.packageCanonContextInputs,
    buildGuidedMotionPrompt: async () => { await motionGate.promise; /* The base build refuses the changed Canon. */ },
  };
  motionUi.window = motionUi;
  vm.runInNewContext(v607.slice(wrapperStart, wrapperEnd), motionUi);
  const pendingMotion = motionUi.buildGuidedMotionPrompt("SH-MOTION", false);
  unit.motionPrompt = "Newer owner direction";
  unit.note = "Newer owner direction";
  unit.motionProfileId = "minimax-h3/t2v";
  unit.dur = 8;
  /* Another invocation can save while this one still awaits its stale reply. */
  const otherBuild = { id: "other-build", dependencySnapshot: { canonContext: { sha256: "other-witness" } } };
  motionProject.promptBuildsById[otherBuild.id] = otherBuild;
  motionShot.creationBrief.motionPromptBuilds.push({ id: otherBuild.id });
  motionGate.resolve();
  await pendingMotion;
  assert.equal(unit.motionPrompt, "Newer owner direction", "rejected late compile must preserve newer unit direction");
  assert.equal(unit.note, "Newer owner direction", "rejected late compile must preserve newer unit note");
  assert.equal(unit.motionProfileId, "minimax-h3/t2v", "rejected late compile must preserve newer target choice");
  assert.equal(unit.dur, 8, "rejected late compile must preserve newer duration");
  assert.deepEqual(motionShot.creationBrief.motionPromptBuilds.map((entry) => entry.id), ["other-build"],
    "rejected invocation cannot claim or save an overlapping build");
  assert.equal(otherBuild.dependencySnapshot.canonContext.sha256, "other-witness",
    "rejected invocation cannot rewrite another package witness");
  assert.equal(otherBuild.segmentLabel, undefined, "rejected invocation cannot decorate another package");
  /* The v607 Motion panel borrows active-unit values into the shot brief only
     while drawing its HTML. A Canon witness must read the durable brief during
     that synchronous projection, including when the durable field is absent. */
  const panelStart = v607.indexOf("  const guidedMotionPanel606 = guidedMotionPanel;");
  const panelEnd = v607.indexOf("  window.selectMotionUnit =", panelStart);
  assert(panelStart >= 0 && panelEnd > panelStart, "v607 Motion panel test seam must exist");
  const durableBrief = { motionPromptBuilds: [{ buildId: "motion-view-build" }],
    motionPlan: { camera: { move: "locked" } }, motionDuration: 5,
    motionProfileId: "minimax-h3/i2v", motionIntensity: "subtle",
    preserveComposition: true };
  const viewUnit = { id: "motion-view-unit", label: "A", motionPrompt: "Unit-only push in",
    note: "Unit-only push in", motionPlan: { camera: { move: "push-in" } },
    motionProfileId: "minimax-h3/flf", dur: 8 };
  const viewShot = { id: "VIEW-01", scene: "SC-1", title: "A parcel",
    creationBrief: durableBrief, clips: [viewUnit] };
  const viewProject = { meta: { title: "Render witness" }, scenes: [{ id: "SC-1" }],
    shots: [viewShot], promptBuildsById: {} };
  const viewPack = { id: "motion-view-build", kind: "guided-motion",
    segmentId: viewUnit.id, references: [] };
  const durableHash = History.packageCanonContextInputs(viewProject, viewShot, viewPack).sha256;
  viewPack.dependencySnapshot = { canonContext: { version: "prompt-canon-context-v1", sha256: durableHash } };
  viewProject.promptBuildsById[viewPack.id] = viewPack;
  let hashInsideRender = "";
  let driftInsideRender = [];
  const viewUi = {
    window: {}, P: viewProject,
    guidedMotionPanel() {
      hashInsideRender = History.packageCanonContextInputs(viewProject, viewShot, viewPack).sha256;
      driftInsideRender = History.packageProjectFreshness(viewProject, viewShot, viewPack).reasons;
      return '<div class="guided-motion-main">Unit workspace</div>';
    },
    ensureShotCreation: () => durableBrief,
    activeMotionUnit: () => viewUnit,
    effectiveMotionPlan: () => viewUnit.motionPlan,
    resolvePromptBuild: () => viewPack,
    preferredGuidedVideoProfile: (id) => id,
    guidedVideoProfiles: () => [{ id: "minimax-h3/flf", mode: "flf", limits: {} }],
    motionUnitTabs: () => "", packagePreviewMarkup: () => "",
    withDurableMotionCanonView: History.withDurableMotionCanonView,
  };
  viewUi.window = viewUi;
  vm.runInNewContext(v607.slice(panelStart, panelEnd), viewUi);
  const beforeView = JSON.stringify(viewShot);
  const viewMarkup = viewUi.guidedMotionPanel(viewShot, null, [], true);
  assert.match(viewMarkup, /Unit workspace/);
  assert.equal(hashInsideRender, durableHash,
    "temporary unit wording/settings must not stale the durable Canon witness");
  assert.deepEqual(Array.from(driftInsideRender), [],
    "server-equivalent Canon comparison must stay current during display projection");
  assert.equal(JSON.stringify(viewShot), beforeView,
    "Motion rendering must restore the durable project record");
  History.withDurableMotionCanonView(durableBrief, () => {
    durableBrief.motionDirection = "Outer borrowed unit direction";
    History.withDurableMotionCanonView(durableBrief, () => {
      durableBrief.motionDirection = "Inner borrowed unit direction";
      assert.equal(History.packageCanonContextInputs(viewProject, viewShot, viewPack).sha256, durableHash,
        "a nested render must retain the outer durable Canon snapshot");
    });
    assert.equal(History.packageCanonContextInputs(viewProject, viewShot, viewPack).sha256, durableHash,
      "a nested render must restore the outer Canon view");
  });
  delete durableBrief.motionDirection;
  assert.equal(History.packageCanonContextInputs(viewProject, viewShot, viewPack).sha256, durableHash,
    "nested render cleanup must expose the unchanged durable record");
  durableBrief.motionDirection = "A new owner-authored shot direction";
  assert(History.packageProjectFreshness(viewProject, viewShot, viewPack).reasons
    .includes("project, scene, shot or entity Canon changed"),
    "a genuine durable Canon edit must still invalidate the package");
  durableBrief.motionDirection = undefined;
  assert.throws(() => History.withDurableMotionCanonView(durableBrief, () => {
    durableBrief.motionDirection = "temporary"; throw new Error("render failed");
  }), /render failed/);
  durableBrief.motionDirection = "After failed render";
  assert.notEqual(History.packageCanonContextInputs(viewProject, viewShot, viewPack).sha256, durableHash,
    "an exception must not leave a Canon override installed");
  console.log("braidy-build-freshness: browser/server workflow drift parity, controlled compile races and durable Motion view witness pass");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });

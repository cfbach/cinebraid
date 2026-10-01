const assert = require("assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { EventEmitter } = require("events");
const { disposableRoot } = require("./helpers/disposable-root");
const { registerBraidyReviewRoutes } = require("../src/assistant/braidy-api");
const { addMotionPromptBuild, buildRef, FRAME_A, baseSpec } = require("./h3-execution-fixture");
const { addFramePromptBuild } = require("./image-execution-fixture");
const Kernel = require("../public/shared-authority-kernel");
const BuildHistory = require("../public/shared-build-history");
const { installTestManualActionSource } = require("./authority-test-gesture");
const manual = installTestManualActionSource(Kernel);

const KEY = "sk-fixture-PRIVATE-NEVER-ECHO";
const workspace = disposableRoot("braidy-target-review");
const projectDir = path.join(workspace.projectsRoot, "braidy-fixture");
const file = path.join(projectDir, "shots", "SH-1", "takes", "A.png");
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, Buffer.from("exact-approved-frame-A"));
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const assetId = "asset-" + "a".repeat(32);
const stat = fs.statSync(file);
fs.writeFileSync(path.join(projectDir, "media-assets.json"), JSON.stringify({
  schemaVersion: 1,
  assets: [{ assetId, hashState: "hashed", contentHash: "sha256:" + sha(fs.readFileSync(file)),
    mediaType: "image", role: "frame-approved", source: "generated", lifecycle: "approved",
    scope: {}, storage: { path: "shots/SH-1/takes/A.png", bytes: stat.size, mtimeMs: stat.mtimeMs },
    legacy: {}, indexedAt: "2026-10-01T00:00:00.000Z" }],
}));
const project = {
  meta: { title: "Braidy fixture", aiPolicy: "project-default", aspectRatio: "16:9" },
  shots: [{ id: "SH-1", keyframes: [{ id: "frame-a", label: "A" }, { id: "frame-b", label: "B" }], creationBrief: {} }], characters: [], locations: [], props: [], vehicles: [],
  promptBuildsById: {}, promptSnapshotsById: {},
};
const buildId = addMotionPromptBuild(project, "SH-1", {
  id: "braidy-h3-build", mode: "i2v", durationSeconds: 5,
  references: [{ ...buildRef(FRAME_A, "/assets/shots/SH-1/takes/A.png"),
    key: "shot-start:frame-a:A.png", approvedAssetId: assetId }],
  spec: baseSpec({ shotId: "SH-1", durationSeconds: 5,
    narrativePurpose: "Hold on the approved parcel while the camera moves closer.",
    audio: {}, identityCanon: [], promptEntities: [], visualGrounding: [],
    actions: [{ start: 0, end: 5, action: "The parcel remains open." }],
  }),
});
const receipt = manual.gesture(() => Kernel.approveFrameCanon(project, {
  shotId: "SH-1", frameId: "frame-a", value: "A.png", assetId,
  at: "2026-10-01T00:00:00.000Z", via: "disposable-braidy-fixture",
}));
assert.strictEqual(Kernel.currentHumanAuthority(project,
  { kind: "shot-frame", shotId: "SH-1", frameId: "frame-a" })?.id, receipt.id);
const sourceBuild = project.promptBuildsById[buildId];
sourceBuild.dependencySnapshot = BuildHistory.packageProjectInputs(project, project.shots[0],
  sourceBuild, BuildHistory.packageDirection(project.shots[0], sourceBuild));
project.characters.push({ id: "CHAR-1", name: "Courier", prefix: "CHAR-1",
  candidateFiles: [{ stored: "A.png", mediaKind: "image", coverageJobType: "single-reference" }],
  continuityStates: [{ id: "state-default", name: "Default", isDefault: true },
    { id: "state-travel", name: "Travel coat", parentStateId: "state-default" }] });
const entityReceipt = manual.gesture(() => Kernel.approveEntityStateCanon(project, {
  list: "characters", entityId: "CHAR-1", stateId: "state-default",
  value: "A.png", assetId, at: "2026-10-01T00:01:00.000Z", via: "disposable-braidy-fixture",
}));
assert.strictEqual(Kernel.currentHumanAuthority(project,
  { kind: "entity-state", list: "characters", entityId: "CHAR-1", stateId: "state-default" })?.id, entityReceipt.id);
const stateBuildId = addMotionPromptBuild(project, "SH-1", {
  id: "braidy-r2v-state-build", mode: "r2v", durationSeconds: 5, aspectRatio: "16:9",
  references: [{ key: "characters:CHAR-1:state-travel", entityId: "CHAR-1",
    label: "Courier travel state", role: "identity", mediaType: "image",
    url: "/assets/shots/SH-1/takes/A.png", approvedAssetId: assetId }],
  spec: baseSpec({ shotId: "SH-1", durationSeconds: 5,
    identityCanon: [], promptEntities: [], visualGrounding: [], audio: {} }),
});
const stateBuild = project.promptBuildsById[stateBuildId];
stateBuild.dependencySnapshot = BuildHistory.packageProjectInputs(project, project.shots[0],
  stateBuild, BuildHistory.packageDirection(project.shots[0], stateBuild));
sourceBuild.dependencySnapshot.canonContext = BuildHistory.packageCanonContextInputs(project, project.shots[0], sourceBuild);
stateBuild.dependencySnapshot.canonContext = BuildHistory.packageCanonContextInputs(project, project.shots[0], stateBuild);
const initialCanon = JSON.stringify(project);
let assistantModel = "gpt-5.6-luna";
let assistantProvider = "openai";
let outbound = 0;
const routes = new Map();
const app = { post: (name, handler) => routes.set(name, handler) };
registerBraidyReviewRoutes(app, {
  captureOwner: () => ({ slug: "braidy-fixture", dir: projectDir }),
  ownerProject: () => project,
  activeSlug: () => "braidy-fixture",
  config: () => ({ h3Resolution: "2K", h3ImageModel: "minimax/h3/image-to-video" }),
  readConfig: () => ({ assistant: { provider: assistantProvider }, openaiBraidyModel: assistantModel, openaiKey: KEY }),
  savedImageSettings: () => ({ resolution: "1k", quality: "high" }),
  planReferenceAddress: () => ({ file }),
});
function response() {
  const res = new EventEmitter();
  res.code = 200;
  res.writableEnded = false;
  res.status = (code) => { res.code = code; return res; };
  res.json = (payload) => { res.payload = payload; res.writableEnded = true; return res; };
  return res;
}
async function request(route, body) {
  const res = response();
  await routes.get(route)({ body }, res);
  return res;
}
const selection = { kind: "h3", shotId: "SH-1", sourceBuildId: buildId,
  profileMode: "i2v", durationSeconds: 5, resolution: "2K", aspectRatio: "16:9" };
const output = {
  proposedPrompt: "Continue the approved parcel frame for five seconds. One slow push-in; no new subject.",
  materialChanges: ["Removed repeated direction."], warnings: [], unsupportedOrAmbiguous: [],
  reasoningSummary: "The approved opening frame carries the composition; the motion is concise.",
};
function completed() {
  return { id: "resp-mock", status: "completed", output: [{ type: "message", content: [
    { type: "output_text", text: JSON.stringify(output) },
  ] }] };
}

async function main() {
  const priorFetch = global.fetch;
  try {
    const blockingShot = { id: "BLOCK-1", keyframes: [{ id: "frame-a", description: "A low camera" }],
      creationBrief: { frameWorkflows: { "frame-a": {
        action: "A parcel stays open", staging: "Centered on the bench",
        camera: "Low angle", notes: "Leave negative space" } },
        blockingRevisionRequest: "Widen the aisle", blockingIncludeLabels: true,
        blockingEmphasis: "balanced", blockingProfileId: "gpt-image-2/blocking",
        composition: { depth: "near/far", elements: [{ id: "parcel", x: 0.5 }] } } };
    const blockingPack = { kind: "blocking-frame",
      dependencySnapshot: { blockingInputs: BuildHistory.packageBlockingInputs(blockingShot) } };
    assert.strictEqual(BuildHistory.packageProjectFreshness({ shots: [blockingShot] },
      blockingShot, blockingPack).current, true);
    for (const [label, change] of [
      ["brief", (shot) => { shot.creationBrief.frameWorkflows["frame-a"].action = "The parcel closes"; }],
      ["staging", (shot) => { shot.creationBrief.frameWorkflows["frame-a"].staging = "Left of frame"; }],
      ["camera", (shot) => { shot.creationBrief.frameWorkflows["frame-a"].camera = "Overhead"; }],
      ["notes", (shot) => { shot.creationBrief.frameWorkflows["frame-a"].notes = "No negative space"; }],
      ["labels", (shot) => { shot.creationBrief.blockingIncludeLabels = false; }],
      ["emphasis", (shot) => { shot.creationBrief.blockingEmphasis = "full-scene"; }],
      ["composition", (shot) => { shot.creationBrief.composition.elements[0].x = 0.7; }],
    ]) {
      const changed = structuredClone(blockingShot);
      change(changed);
      const freshness = BuildHistory.packageProjectFreshness({ shots: [changed] }, changed, blockingPack);
      assert.strictEqual(freshness.current, false, "changed blocking " + label + " stales the target package");
      assert(freshness.reasons.includes("blocking brief or settings changed"));
    }
    const contextShot = { id: "CTX", scene: "SC-1", desc: "Rex waits at the door.",
      audio: { voiceEntityId: "VOICE-DERIVED" }, codes: ["VOICE-DERIVED"],
      creationBrief: {} };
    const contextProject = { meta: { world: { setting: "Rainy platform" },
        globalStylePrompt: "Flat illustration" },
      scenes: [{ id: "SC-1", whatHappens: "Rex waits.", howItFeels: "Tense" }],
      shots: [contextShot],
      characters: [
        { id: "CHAR-REX", name: "Rex", visualDescription: "Blue coat" },
        { id: "CHAR-OTHER", name: "Unrelated person", visualDescription: "Green coat" },
      ],
      audio: [
        { id: "VOICE-DERIVED", name: "Rex voice take", sameObjectAs: "VOICE-MASTER" },
        { id: "VOICE-MASTER", name: "Rex clean master", cleanMaster: true },
      ] };
    const contextPack = { kind: "guided-motion", references: [] };
    const canonWitness = () => BuildHistory.packageCanonContextInputs(contextProject, contextShot, contextPack).sha256;
    const originalWitness = canonWitness();
    contextProject.meta.world.setting = "Sunny stage";
    assert.notStrictEqual(canonWitness(), originalWitness, "world edit changes saved Canon context");
    contextProject.meta.world.setting = "Rainy platform";
    contextProject.characters[0].visualDescription = "Red coat";
    assert.notStrictEqual(canonWitness(), originalWitness,
      "mentioned but unattached character Canon is a real prompt dependency");
    contextProject.characters[0].visualDescription = "Blue coat";
    contextProject.characters[0].candidateFiles = [{ stored: "new-unreviewed-image.png" }];
    assert.strictEqual(canonWitness(), originalWitness,
      "candidate media churn is not a Canon description edit");
    delete contextProject.characters[0].candidateFiles;
    contextProject.characters[0].continuityStates = [{ id: "travel", description: "Red coat" }];
    assert.notStrictEqual(canonWitness(), originalWitness,
      "a selected character's continuity state is Canon context");
    delete contextProject.characters[0].continuityStates;
    contextProject.characters[1].visualDescription = "Silver coat";
    assert.strictEqual(canonWitness(), originalWitness,
      "unmentioned, unattached character art does not stale another shot");
    contextProject.characters[1].visualDescription = "Green coat";
    contextProject.characters[1].name = "Still unrelated";
    assert.strictEqual(canonWitness(), originalWitness,
      "renaming an unmentioned character does not stale this shot");
    contextProject.characters[1].name = "Rex";
    assert.notStrictEqual(canonWitness(), originalWitness,
      "a character renamed into a scene mention becomes a prompt dependency");
    contextProject.characters[1].name = "Unrelated person";
    contextProject.audio[1].name = "Different clean master";
    assert.notStrictEqual(canonWitness(), originalWitness,
      "selected voice's sameObjectAs master is a prompt dependency");
    contextProject.audio[1].name = "Rex clean master";
    contextShot.creationBrief.motionPromptBuilds = [{ id: "target-only-review-history" }];
    assert.strictEqual(canonWitness(), originalWitness,
      "adding a target-specific revision does not stale its source Canon");
    global.fetch = async () => { throw new Error("No provider call is allowed on /basis"); };
    const base = await request("/api/assistant/braidy/basis", selection);
    assert.strictEqual(base.code, 200, JSON.stringify(base.payload));
    assert.strictEqual(base.payload.target.modelId, "minimax-h3/fl2va");
    assert.strictEqual(base.payload.target.mode, "i2v");
    assert.strictEqual(base.payload.target.endpoint, "minimax/h3/image-to-video");
    assert.strictEqual(base.payload.target.playbookId, "minimax-h3");
    assert.strictEqual(base.payload.sourceFreshness.recorded, true);
    assert.strictEqual(base.payload.sourceFreshness.current, true);
    assert.strictEqual(base.payload.inputManifest.length, 1);
    assert.strictEqual(base.payload.inputManifest[0].providerField, "image_url");
    assert.strictEqual(base.payload.inputManifest[0].mediaIdentity.sha256, sha(fs.readFileSync(file)));
    assert.strictEqual(base.payload.inputManifest[0].role, "first-frame");
    assert.strictEqual(base.payload.inputManifest[0].approvalStatus, "current-receipt-verified");
    assert.strictEqual(base.payload.inputManifest[0].approvalReceiptId, receipt.id);
    assert.strictEqual(base.payload.inputManifest[0].assetId, assetId);
    assert.strictEqual(base.payload.inputManifest[0].approvedFileName, "A.png");
    assert.strictEqual(base.payload.submittedPrompt, base.payload.deterministicPrompt);
    assert(!JSON.stringify(base.payload).includes(KEY));
    assert(!JSON.stringify(base.payload).includes(file), "local path never enters the public context");
    assert.strictEqual(outbound, 0, "deterministic basis makes no provider call");
    const same = await request("/api/assistant/braidy/basis", selection);
    assert.strictEqual(same.payload.basisFingerprint, base.payload.basisFingerprint);
    const edited = await request("/api/assistant/braidy/basis", { ...selection,
      baselineFingerprint: base.payload.basisFingerprint,
      submittedPrompt: base.payload.deterministicPrompt + " Keep the blue paper visible." });
    assert.strictEqual(edited.code, 200, JSON.stringify(edited.payload));
    assert.strictEqual(edited.payload.basisFingerprint, base.payload.basisFingerprint);
    assert.notStrictEqual(edited.payload.packageFingerprint, base.payload.packageFingerprint,
      "a target-specific text edit changes package identity without changing Canon");

    global.fetch = async (url, options) => {
      outbound++;
      assert.strictEqual(url, "https://api.openai.com/v1/responses", "no fal/video dispatch");
      assert.strictEqual(options.headers.authorization, `Bearer ${KEY}`);
      const body = JSON.parse(options.body);
      assert.strictEqual(body.store, false);
      assert.strictEqual(body.model, assistantModel);
      assert.strictEqual(body.text.format.type, "json_schema");
      assert(!options.body.includes(KEY), "key never enters provider request body");
      const context = JSON.parse(body.input);
      assert.strictEqual(context.target.endpoint, "minimax/h3/image-to-video");
      assert.strictEqual(context.orderedBoundInputs[0].mediaIdentity.sha256, sha(fs.readFileSync(file)));
      assert.strictEqual(context.orderedBoundInputs[0].approvalStatus, "current-receipt-verified");
      assert.strictEqual(context.orderedBoundInputs[0].approvalReceiptId, receipt.id);
      assert.strictEqual(context.playbook.packId, "minimax-h3");
      assert.strictEqual(context.playbook.mode, "i2v");
      assert(context.playbook.anchoredBy, "Braidy receives qualified exact-mode writing policy");
      assert.strictEqual(context.generationSettings.duration, 5);
      assert.strictEqual(context.generationSettings.enable_prompt_expansion, false);
      assert.strictEqual(context.canonicalProductionIntent.narrativePurpose,
        "Hold on the approved parcel while the camera moves closer.");
      return { ok: true, status: 200, json: async () => completed() };
    };
    const improved = await request("/api/assistant/braidy/improve", { ...selection,
      baselineFingerprint: base.payload.basisFingerprint });
    assert.strictEqual(improved.code, 200, JSON.stringify(improved.payload));
    assert.strictEqual(improved.payload.proposal.proposedPrompt, output.proposedPrompt);
    assert.strictEqual(improved.payload.proposal.model, "gpt-5.6-luna");
    assert.strictEqual(improved.payload.proposal.sendable, true);
    assert.notStrictEqual(improved.payload.proposal.packageFingerprint, base.payload.packageFingerprint);
    assert.strictEqual(outbound, 1);
    assert.strictEqual(JSON.stringify(project), initialCanon, "advisory review does not mutate Canon");
    assert(!JSON.stringify(improved.payload).includes(KEY), "key never reaches browser payload");

    const sourceBasisBeforeRevision = await request("/api/assistant/braidy/basis", selection);
    project.promptBuildsById["braidy-linked-target-revision"] = {
      ...structuredClone(sourceBuild), id: "braidy-linked-target-revision",
      packageId: "SH-1-MOTION-R02", parentBuildId: buildId, manualEdited: true,
      prompt: "Target-only wording chosen after Braidy review.",
    };
    project.shots[0].creationBrief.motionPromptBuilds.push({
      buildId: "braidy-linked-target-revision", kind: "guided-motion",
    });
    project.shots[0].creationBrief.lastMotionPackageId = "SH-1-MOTION-R02";
    const sourceBasisAfterRevision = await request("/api/assistant/braidy/basis", selection);
    assert.strictEqual(sourceBasisAfterRevision.code, 200);
    assert.strictEqual(sourceBasisAfterRevision.payload.basisFingerprint,
      sourceBasisBeforeRevision.payload.basisFingerprint,
      "saving a linked target-only revision cannot stale the unchanged source compilation");
    assert.strictEqual(sourceBasisAfterRevision.payload.sourceFreshness.current, true);

    project.meta.world = { setting: "New stage after the source build" };
    const changedWorld = await request("/api/assistant/braidy/basis", selection);
    assert.strictEqual(changedWorld.code, 200);
    assert.strictEqual(changedWorld.payload.sourceFreshness.current, false);
    const changedWorldRefusal = await request("/api/assistant/braidy/improve", {
      ...selection, baselineFingerprint: changedWorld.payload.basisFingerprint,
    });
    assert.strictEqual(changedWorldRefusal.code, 409);
    assert.strictEqual(changedWorldRefusal.payload.code, "BRAIDY_BUILD_FRESHNESS_UNVERIFIED");
    assert.strictEqual(outbound, 1, "pre-open world edit cannot reach OpenAI");
    delete project.meta.world;
    project.shots[0].creationBrief.h3SequenceNote = "Change the motion beat after this build.";
    const changedSequenceNote = await request("/api/assistant/braidy/basis", selection);
    assert.strictEqual(changedSequenceNote.code, 200);
    assert.strictEqual(changedSequenceNote.payload.sourceFreshness.current, false);
    const sequenceNoteRefusal = await request("/api/assistant/braidy/improve", {
      ...selection, baselineFingerprint: changedSequenceNote.payload.basisFingerprint,
    });
    assert.strictEqual(sequenceNoteRefusal.code, 409);
    assert.strictEqual(sequenceNoteRefusal.payload.code, "BRAIDY_BUILD_FRESHNESS_UNVERIFIED");
    assert.strictEqual(outbound, 1, "pre-open H3 beat edit cannot reach OpenAI");
    delete project.shots[0].creationBrief.h3SequenceNote;
    const stateSelection = { ...selection, sourceBuildId: stateBuildId, profileMode: "r2v" };
    project.characters[0].visualDescription = "Changed Courier identity after build.";
    const changedEntity = await request("/api/assistant/braidy/basis", stateSelection);
    assert.strictEqual(changedEntity.code, 200);
    assert.strictEqual(changedEntity.payload.sourceFreshness.current, false);
    const changedEntityRefusal = await request("/api/assistant/braidy/improve", {
      ...stateSelection, baselineFingerprint: changedEntity.payload.basisFingerprint,
    });
    assert.strictEqual(changedEntityRefusal.code, 409);
    assert.strictEqual(changedEntityRefusal.payload.code, "BRAIDY_BUILD_FRESHNESS_UNVERIFIED");
    assert.strictEqual(outbound, 1, "selected entity Canon edit cannot reach OpenAI");
    delete project.characters[0].visualDescription;
    const wrongState = await request("/api/assistant/braidy/basis", stateSelection);
    assert.strictEqual(wrongState.code, 200, JSON.stringify(wrongState.payload));
    assert.strictEqual(wrongState.payload.inputManifest[0].approvalStatus, "unverified-current-receipt",
      "Default-state receipt cannot qualify the same bytes as Travel coat");
    const wrongStateRefusal = await request("/api/assistant/braidy/improve", {
      ...stateSelection, baselineFingerprint: wrongState.payload.basisFingerprint,
    });
    assert.strictEqual(wrongStateRefusal.code, 409);
    assert.strictEqual(wrongStateRefusal.payload.code, "BRAIDY_INPUT_AUTHORITY_UNVERIFIED");
    assert.strictEqual(outbound, 1, "cross-state input cannot reach OpenAI");
    stateBuild.references[0].key = "characters:CHAR-1:state-default";
    const exactState = await request("/api/assistant/braidy/basis", stateSelection);
    assert.strictEqual(exactState.code, 200, JSON.stringify(exactState.payload));
    assert.strictEqual(exactState.payload.inputManifest[0].approvalReceiptId, entityReceipt.id);
    stateBuild.references[0].key = "characters:CHAR-1:state-travel";
    const stateReference = stateBuild.references[0];
    stateBuild.references[0] = { ...stateReference,
      key: "h3-keyframe:SH-1:frame-a:A.png", entityId: "", role: "sequential-keyframe" };
    const sequentialFrame = await request("/api/assistant/braidy/basis", stateSelection);
    assert.strictEqual(sequentialFrame.code, 200, JSON.stringify(sequentialFrame.payload));
    assert.strictEqual(sequentialFrame.payload.inputManifest[0].approvalReceiptId, receipt.id,
      "H3 sequential keyframe binds the exact Frame A receipt");
    stateBuild.references[0] = stateReference;
    sourceBuild.references[0].key = "shot-start:frame-b:A.png";
    const wrongFrame = await request("/api/assistant/braidy/basis", selection);
    assert.strictEqual(wrongFrame.code, 200, JSON.stringify(wrongFrame.payload));
    assert.strictEqual(wrongFrame.payload.inputManifest[0].approvalStatus, "unverified-current-receipt",
      "Frame A receipt cannot qualify the same bytes as unapproved Frame B");
    const wrongFrameRefusal = await request("/api/assistant/braidy/improve", {
      ...selection, baselineFingerprint: wrongFrame.payload.basisFingerprint,
    });
    assert.strictEqual(wrongFrameRefusal.code, 409);
    assert.strictEqual(wrongFrameRefusal.payload.code, "BRAIDY_INPUT_AUTHORITY_UNVERIFIED");
    assert.strictEqual(outbound, 1, "cross-frame input cannot reach OpenAI");
    sourceBuild.references[0].key = "shot-start:frame-a:A.png";
    sourceBuild.references[0].approvedAssetId = "asset-" + "b".repeat(32);
    const wrongAsset = await request("/api/assistant/braidy/basis", selection);
    assert.strictEqual(wrongAsset.code, 200);
    assert.strictEqual(wrongAsset.payload.inputManifest[0].approvalStatus, "unverified-current-receipt");
    const wrongAssetRefusal = await request("/api/assistant/braidy/improve", {
      ...selection, baselineFingerprint: wrongAsset.payload.basisFingerprint,
    });
    assert.strictEqual(wrongAssetRefusal.code, 409);
    assert.strictEqual(wrongAssetRefusal.payload.code, "BRAIDY_INPUT_AUTHORITY_UNVERIFIED");
    assert.strictEqual(outbound, 1, "a mismatched declared asset identity cannot reach OpenAI");
    sourceBuild.references[0].approvedAssetId = assetId;
    project.shots[0].motionPrompt = "A new written shot direction after this package was built.";
    const staleProduction = await request("/api/assistant/braidy/basis", selection);
    assert.strictEqual(staleProduction.code, 200);
    assert.strictEqual(staleProduction.payload.sourceFreshness.current, false);
    const staleProductionRefusal = await request("/api/assistant/braidy/improve", {
      ...selection, baselineFingerprint: staleProduction.payload.basisFingerprint,
    });
    assert.strictEqual(staleProductionRefusal.code, 409);
    assert.strictEqual(staleProductionRefusal.payload.code, "BRAIDY_BUILD_FRESHNESS_UNVERIFIED");
    assert.strictEqual(outbound, 1, "a known-stale saved build cannot reach OpenAI");
    delete project.shots[0].motionPrompt;
    const savedSnapshot = sourceBuild.dependencySnapshot;
    delete sourceBuild.dependencySnapshot;
    try {
      const untracked = await request("/api/assistant/braidy/basis", selection);
      assert.strictEqual(untracked.code, 200);
      assert.strictEqual(untracked.payload.sourceFreshness.recorded, false);
      const untrackedRefusal = await request("/api/assistant/braidy/improve", {
        ...selection, baselineFingerprint: untracked.payload.basisFingerprint,
      });
      assert.strictEqual(untrackedRefusal.code, 409);
      assert.strictEqual(untrackedRefusal.payload.code, "BRAIDY_BUILD_FRESHNESS_UNVERIFIED");
      assert.strictEqual(outbound, 1, "an untracked saved build cannot be presented as current Canon");
    } finally { sourceBuild.dependencySnapshot = savedSnapshot; }

    fs.writeFileSync(file, Buffer.from("replacement-bytes"));
    const stale = await request("/api/assistant/braidy/improve", { ...selection,
      baselineFingerprint: base.payload.basisFingerprint });
    assert.strictEqual(stale.code, 409);
    assert.strictEqual(stale.payload.code, "BRAIDY_BASIS_STALE");
    assert.strictEqual(outbound, 1, "stale basis is refused before OpenAI");
    const replacedBasis = await request("/api/assistant/braidy/basis", selection);
    assert.strictEqual(replacedBasis.code, 200, "deterministic review remains usable with replaced media");
    assert.strictEqual(replacedBasis.payload.inputManifest[0].approvalStatus, "unverified-current-receipt");
    const replacedRefusal = await request("/api/assistant/braidy/improve", {
      ...selection, baselineFingerprint: replacedBasis.payload.basisFingerprint,
    });
    assert.strictEqual(replacedRefusal.code, 409);
    assert.strictEqual(replacedRefusal.payload.code, "BRAIDY_INPUT_AUTHORITY_UNVERIFIED");
    assert.strictEqual(outbound, 1, "a mismatched media hash is refused before OpenAI");
    fs.writeFileSync(file, Buffer.from("exact-approved-frame-A"));
    const savedAuthority = project.productionAuthority;
    delete project.productionAuthority;
    try {
      const selectedOnly = await request("/api/assistant/braidy/basis", selection);
      assert.strictEqual(selectedOnly.code, 200);
      assert.strictEqual(selectedOnly.payload.inputManifest[0].approvalStatus, "unverified-current-receipt");
      const noReceipt = await request("/api/assistant/braidy/improve", {
        ...selection, baselineFingerprint: selectedOnly.payload.basisFingerprint,
      });
      assert.strictEqual(noReceipt.code, 409);
      assert.strictEqual(noReceipt.payload.code, "BRAIDY_INPUT_AUTHORITY_UNVERIFIED");
      assert.strictEqual(outbound, 1, "a selected file without a current human receipt cannot be sent as approved");
    } finally { project.productionAuthority = savedAuthority; }
    const fresh = await request("/api/assistant/braidy/basis", selection);
    assert.strictEqual(fresh.payload.inputManifest[0].approvalStatus, "current-receipt-verified");
    let resolveProvider, providerReached;
    const reached = new Promise((resolve) => { providerReached = resolve; });
    global.fetch = (url, options) => {
      outbound++;
      assert.strictEqual(url, "https://api.openai.com/v1/responses");
      return new Promise((resolve) => {
        resolveProvider = () => resolve({ ok: true, status: 200, json: async () => completed() });
        providerReached();
      });
    };
    const pending = request("/api/assistant/braidy/improve", { ...selection,
      baselineFingerprint: fresh.payload.basisFingerprint });
    let waitTimer;
    try {
      await Promise.race([reached, new Promise((_, reject) => {
        waitTimer = setTimeout(() => reject(new Error("Controlled mock provider was never reached")), 5000);
      })]);
    } finally { clearTimeout(waitTimer); }
    assert(resolveProvider, "controlled mock response must be pending");
    project.promptBuildsById[buildId].spec.narrativePurpose = "A newly revised shot purpose.";
    resolveProvider();
    const late = await pending;
    assert.strictEqual(late.code, 409, "a late response cannot overwrite newer Canon");
    assert.strictEqual(late.payload.code, "BRAIDY_BASIS_STALE");
    assert.strictEqual(outbound, 2);

    assistantProvider = "none";
    const unavailable = await request("/api/assistant/braidy/improve", { ...selection,
      baselineFingerprint: fresh.payload.basisFingerprint });
    assert.strictEqual(unavailable.code, 400, "Braidy unavailable leaves /basis usable");
    const offlineBasis = await request("/api/assistant/braidy/basis", selection);
    assert.strictEqual(offlineBasis.code, 200);
    project.meta.aiPolicy = "local-only";
    assistantProvider = "openai";
    const localOnly = await request("/api/assistant/braidy/improve", { ...selection,
      baselineFingerprint: offlineBasis.payload.basisFingerprint });
    assert.strictEqual(localOnly.code, 403, "local-only project cannot be sent to OpenAI");
    project.meta.aiPolicy = "project-default";
    sourceBuild.manualEdited = true;
    sourceBuild.prompt = "Manual target revision: keep the blue parcel open. Use one slow push-in.";
    const manualBasis = await request("/api/assistant/braidy/basis", selection);
    assert.strictEqual(manualBasis.code, 200, JSON.stringify(manualBasis.payload));
    assert.strictEqual(manualBasis.payload.currentSubmittedTargetPrompt, sourceBuild.prompt);
    assert.strictEqual(manualBasis.payload.submittedPrompt, sourceBuild.prompt);
    assert.notStrictEqual(manualBasis.payload.currentSubmittedTargetPrompt, manualBasis.payload.deterministicPrompt);
    assert.notStrictEqual(manualBasis.payload.basisFingerprint, fresh.payload.basisFingerprint);
    assert.notStrictEqual(manualBasis.payload.packageFingerprint, fresh.payload.packageFingerprint);
    let reviewedCurrentPrompt = "";
    global.fetch = async (url, options) => {
      assert.strictEqual(url, "https://api.openai.com/v1/responses");
      reviewedCurrentPrompt = JSON.parse(JSON.parse(options.body).input).currentSubmittedTargetPrompt;
      return { ok: true, status: 200, json: async () => completed() };
    };
    const manualReview = await request("/api/assistant/braidy/improve", {
      ...selection, baselineFingerprint: manualBasis.payload.basisFingerprint,
    });
    assert.strictEqual(manualReview.code, 200, JSON.stringify(manualReview.payload));
    assert.strictEqual(reviewedCurrentPrompt, sourceBuild.prompt,
      "Braidy reviews the saved target revision, not only the deterministic baseline");
    const imageShot = { id: "IMG-1", characters: ["CHAR-1"], keyframes: [
      { id: "frame-a", label: "A", description: "The closed parcel rests on the bench." },
      { id: "frame-b", label: "B", description: "The open parcel rests on the bench." },
    ], creationBrief: { frameWorkflows: {
      "frame-b": { action: "The blue parcel is open.", staging: "Centered on the bench.",
        camera: "Close view from above.", notes: "Keep the folds visible.",
        profileId: "gpt-image-2/t2i", mode: "create", usePreviousFrame: false,
        entityPresence: { "CHAR-1": "absent" },
        characterStateSelections: { "CHAR-1": "state-travel" } },
    }, composition: { mustInclude: "blue paper folds" } } };
    project.shots.push(imageShot);
    const imageFrameReceipt = manual.gesture(() => Kernel.approveFrameCanon(project, {
      shotId: "IMG-1", frameId: "frame-a", value: "A.png", assetId,
      at: "2026-10-01T00:02:00.000Z", via: "disposable-braidy-image-fixture",
    }));
    const frameBuildId = addFramePromptBuild(project, "IMG-1", {
      id: "braidy-image-frame-b", frameId: "frame-b", frameLabel: "B",
      profileId: "gpt-image-2/t2i", references: [],
      spec: baseSpec({ shotId: "IMG-1", narrativePurpose: "The open blue parcel rests on a bench.",
        identityCanon: [], promptEntities: [], visualGrounding: [], audio: {} }),
    });
    let frameBuild = project.promptBuildsById[frameBuildId];
    frameBuild.dependencySnapshot = {
      ...BuildHistory.packageProjectInputs(project, imageShot, frameBuild,
        BuildHistory.packageDirection(imageShot, frameBuild)),
      frameWorkflowInputs: BuildHistory.packageFrameWorkflowInputs(imageShot, frameBuild),
      canonContext: BuildHistory.packageCanonContextInputs(project, imageShot, frameBuild),
    };
    const editBuildId = addFramePromptBuild(project, "IMG-1", {
      id: "braidy-image-edit-frame-b", frameId: "frame-b", frameLabel: "B",
      profileId: "gpt-image-2/edit",
      references: [{ key: "previous-frame:frame-a:A.png", entityId: "IMG-1",
        role: "base", mediaType: "image", url: "/assets/shots/SH-1/takes/A.png",
        label: "Approved prior frame", approvedAssetId: assetId }],
      spec: baseSpec({ shotId: "IMG-1", narrativePurpose: "Edit the approved image into an opened parcel.",
        identityCanon: [], promptEntities: [], visualGrounding: [], audio: {} }),
    });
    const editBuild = project.promptBuildsById[editBuildId];
    editBuild.dependencySnapshot = {
      ...BuildHistory.packageProjectInputs(project, imageShot, editBuild,
        BuildHistory.packageDirection(imageShot, editBuild)),
      frameWorkflowInputs: BuildHistory.packageFrameWorkflowInputs(imageShot, editBuild),
      canonContext: BuildHistory.packageCanonContextInputs(project, imageShot, editBuild),
    };
    const editSelection = { kind: "image", purpose: "frame", shotId: "IMG-1",
      sourceBuildId: editBuildId, aspectRatio: "16:9", outputCount: 2 };
    const selectedStateBuildId = addFramePromptBuild(project, "IMG-1", {
      id: "braidy-image-travel-state", frameId: "frame-b", frameLabel: "B",
      profileId: "gpt-image-2/multi-reference",
      references: [{ key: "characters:CHAR-1:state-default", entityId: "CHAR-1",
        role: "identity", mediaType: "image", url: "/assets/shots/SH-1/takes/A.png",
        label: "Courier Travel coat", approvedAssetId: assetId }],
      spec: baseSpec({ shotId: "IMG-1", narrativePurpose: "Travel-coat Courier remains off screen.",
        identityCanon: [], promptEntities: [], visualGrounding: [], audio: {} }),
    });
    const selectedStateBuild = project.promptBuildsById[selectedStateBuildId];
    selectedStateBuild.dependencySnapshot = {
      ...BuildHistory.packageProjectInputs(project, imageShot, selectedStateBuild,
        BuildHistory.packageDirection(imageShot, selectedStateBuild)),
      frameWorkflowInputs: BuildHistory.packageFrameWorkflowInputs(imageShot, selectedStateBuild),
      canonContext: BuildHistory.packageCanonContextInputs(project, imageShot, selectedStateBuild),
    };
    const selectedStateSelection = { kind: "image", purpose: "frame", shotId: "IMG-1",
      sourceBuildId: selectedStateBuildId, aspectRatio: "16:9", outputCount: 2 };
    const frameSelection = { kind: "image", purpose: "frame", shotId: "IMG-1",
      sourceBuildId: frameBuildId, aspectRatio: "16:9", outputCount: 2 };
    global.fetch = async () => { throw new Error("A deterministic image /basis cannot call OpenAI"); };
    let frameBasis = await request("/api/assistant/braidy/basis", frameSelection);
    assert.strictEqual(frameBasis.code, 200, JSON.stringify(frameBasis.payload));
    assert.strictEqual(frameBasis.payload.target.mode, "t2i");
    assert.strictEqual(frameBasis.payload.sourceFreshness.current, true);
    assert.strictEqual(frameBasis.payload.inputManifest.length, 0);
    const unapprovedTravel = await request("/api/assistant/braidy/basis", selectedStateSelection);
    assert.strictEqual(unapprovedTravel.code, 200, JSON.stringify(unapprovedTravel.payload));
    assert.strictEqual(unapprovedTravel.payload.inputManifest[0].approvalStatus, "unverified-current-receipt",
      "a shot-scoped Default key cannot make the frame-selected Travel coat approved");
    const travelReceipt = manual.gesture(() => Kernel.approveEntityStateCanon(project, {
      list: "characters", entityId: "CHAR-1", stateId: "state-travel",
      value: "A.png", assetId, at: "2026-10-01T00:03:00.000Z", via: "disposable-braidy-frame-state",
    }));
    const approvedTravel = await request("/api/assistant/braidy/basis", selectedStateSelection);
    assert.strictEqual(approvedTravel.code, 200, JSON.stringify(approvedTravel.payload));
    assert.strictEqual(approvedTravel.payload.inputManifest[0].approvalReceiptId, travelReceipt.id);
    assert.strictEqual(approvedTravel.payload.inputManifest[0].approvalTarget.stateId, "state-travel",
      "approval target follows exact frame-selected state, not the persistent shot slot key");
    const oldFrameAfterCanon = await request("/api/assistant/braidy/basis", frameSelection);
    assert.strictEqual(oldFrameAfterCanon.payload.sourceFreshness.current, false,
      "approving a selected state changes entity Canon and stales an older frame build");
    const rebuiltFrameId = addFramePromptBuild(project, "IMG-1", {
      id: "braidy-image-frame-b-rebuilt", frameId: "frame-b", frameLabel: "B",
      profileId: "gpt-image-2/t2i", references: [], spec: structuredClone(frameBuild.spec),
    });
    frameBuild = project.promptBuildsById[rebuiltFrameId];
    frameBuild.dependencySnapshot = {
      ...BuildHistory.packageProjectInputs(project, imageShot, frameBuild,
        BuildHistory.packageDirection(imageShot, frameBuild)),
      frameWorkflowInputs: BuildHistory.packageFrameWorkflowInputs(imageShot, frameBuild),
      canonContext: BuildHistory.packageCanonContextInputs(project, imageShot, frameBuild),
    };
    frameSelection.sourceBuildId = rebuiltFrameId;
    frameBasis = await request("/api/assistant/braidy/basis", frameSelection);
    assert.strictEqual(frameBasis.payload.sourceFreshness.current, true);
    const previousBasis = await request("/api/assistant/braidy/basis", editSelection);
    assert.strictEqual(previousBasis.code, 200, JSON.stringify(previousBasis.payload));
    assert.strictEqual(previousBasis.payload.target.mode, "edit");
    assert.strictEqual(previousBasis.payload.inputManifest[0].approvalReceiptId, imageFrameReceipt.id,
      "image edit base binds the exact prior frame's receipt");
    editBuild.references[0].key = "previous-frame:frame-b:A.png";
    const wrongPrevious = await request("/api/assistant/braidy/basis", editSelection);
    assert.strictEqual(wrongPrevious.code, 200);
    assert.strictEqual(wrongPrevious.payload.inputManifest[0].approvalStatus, "unverified-current-receipt",
      "same bytes cannot borrow authority from a different preceding frame");
    editBuild.references[0].key = "shot-current:IMG-1:A.png";
    const currentShotBasis = await request("/api/assistant/braidy/basis", editSelection);
    assert.strictEqual(currentShotBasis.code, 200);
    assert.strictEqual(currentShotBasis.payload.inputManifest[0].approvalReceiptId, imageFrameReceipt.id,
      "current-shot edit base cites only the actual opening-frame receipt");
    editBuild.references[0].key = "shot-current:SH-1:A.png";
    const wrongShotCurrent = await request("/api/assistant/braidy/basis", editSelection);
    assert.strictEqual(wrongShotCurrent.code, 200);
    assert.strictEqual(wrongShotCurrent.payload.inputManifest[0].approvalStatus, "unverified-current-receipt",
      "another shot's current-image key cannot borrow this frame authority");
    editBuild.references[0].key = "previous-frame:frame-a:A.png";
    const trackedFrame = frameBuild.dependencySnapshot.frameWorkflowInputs;
    delete frameBuild.dependencySnapshot.frameWorkflowInputs;
    const oldFrame = await request("/api/assistant/braidy/basis", frameSelection);
    assert.strictEqual(oldFrame.code, 200, "older frame build remains usable for deterministic review");
    assert.strictEqual(oldFrame.payload.sourceFreshness.evidence, "frame-workflow-inputs-untracked");
    const oldFrameRefusal = await request("/api/assistant/braidy/improve", { ...frameSelection,
      baselineFingerprint: oldFrame.payload.basisFingerprint });
    assert.strictEqual(oldFrameRefusal.code, 409);
    assert.strictEqual(oldFrameRefusal.payload.code, "BRAIDY_BUILD_FRESHNESS_UNVERIFIED");
    frameBuild.dependencySnapshot.frameWorkflowInputs = trackedFrame;
    const endState = imageShot.creationBrief.frameWorkflows["frame-b"];
    for (const [label, alter] of [
      ["action", (state) => { state.action = "The parcel closes."; }],
      ["staging", (state) => { state.staging = "Moved left."; }],
      ["camera", (state) => { state.camera = "Low angle."; }],
      ["notes", (state) => { state.notes = "Remove the folds."; }],
      ["revision", (state) => { state.automationRevisionRequest = "Make the parcel darker."; }],
      ["presence", (state) => { state.entityPresence["CHAR-1"] = "present"; }],
      ["continuity", (state) => { state.characterStateSelections = { "CHAR-1": "state-travel" }; }],
    ]) {
      const changed = structuredClone(imageShot);
      alter(changed.creationBrief.frameWorkflows["frame-b"]);
      assert.strictEqual(BuildHistory.packageProjectFreshness({ shots: [changed] },
        changed, frameBuild).current, false, "Frame B " + label + " edit stales its saved build");
    }
    endState.camera = "A sudden whip pan.";
    const preopen = await request("/api/assistant/braidy/basis", frameSelection);
    assert.strictEqual(preopen.code, 200);
    assert.strictEqual(preopen.payload.sourceFreshness.current, false,
      "an edit to the exact end-frame workflow must not be called current Canon");
    assert.notStrictEqual(preopen.payload.basisFingerprint, frameBasis.payload.basisFingerprint);
    const preopenRefusal = await request("/api/assistant/braidy/improve", { ...frameSelection,
      baselineFingerprint: preopen.payload.basisFingerprint });
    assert.strictEqual(preopenRefusal.code, 409);
    assert.strictEqual(preopenRefusal.payload.code, "BRAIDY_BUILD_FRESHNESS_UNVERIFIED");
    endState.camera = "Close view from above.";
    const freshFrame = await request("/api/assistant/braidy/basis", frameSelection);
    assert.strictEqual(freshFrame.payload.basisFingerprint, frameBasis.payload.basisFingerprint);
    let resolveImageProvider, imageProviderReached;
    const imageReached = new Promise((resolve) => { imageProviderReached = resolve; });
    global.fetch = () => {
      outbound++;
      return new Promise((resolve) => {
        resolveImageProvider = () => resolve({ ok: true, status: 200, json: async () => completed() });
        imageProviderReached();
      });
    };
    const pendingImage = request("/api/assistant/braidy/improve", { ...frameSelection,
      baselineFingerprint: freshFrame.payload.basisFingerprint });
    let imageTimer;
    try {
      await Promise.race([imageReached, new Promise((_, reject) => {
        imageTimer = setTimeout(() => reject(new Error("Controlled image review mock was never reached")), 5000);
      })]);
    } finally { clearTimeout(imageTimer); }
    assert(resolveImageProvider);
    endState.camera = "One slow push-in from the opposite side.";
    resolveImageProvider();
    const lateImage = await pendingImage;
    assert.strictEqual(lateImage.code, 409,
      "a late OpenAI proposal cannot survive changed end-frame workflow direction");
    assert.strictEqual(lateImage.payload.code, "BRAIDY_BASIS_STALE");
    assert.strictEqual(outbound, 3, "pre-open stale frame changes contact no provider");
    endState.camera = "Close view from above.";
    const cancelBasis = await request("/api/assistant/braidy/basis", frameSelection);
    let abortObserved = false, cancelProviderReached;
    const cancelReached = new Promise((resolve) => { cancelProviderReached = resolve; });
    global.fetch = (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        abortObserved = true;
        const error = new Error("cancelled");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
      cancelProviderReached();
    });
    const disconnected = response();
    const cancelledRequest = routes.get("/api/assistant/braidy/improve")({
      body: { ...frameSelection, baselineFingerprint: cancelBasis.payload.basisFingerprint },
    }, disconnected);
    let cancelTimer;
    try {
      await Promise.race([cancelReached, new Promise((_, reject) => {
        cancelTimer = setTimeout(() => reject(new Error("Controlled cancellation mock was never reached")), 5000);
      })]);
    } finally { clearTimeout(cancelTimer); }
    disconnected.emit("close");
    await cancelledRequest;
    assert.strictEqual(abortObserved, true, "client disconnect aborts the in-flight OpenAI request");
    assert.strictEqual(disconnected.payload, undefined, "a cancelled response never publishes a proposal");
    console.log("Braidy exact-target API: offline basis, exact receipts and bytes, stale/selected refusals, frame workflow freshness, current target revision, structured OpenAI mock, controlled late response and disconnect passed.");
  } finally {
    global.fetch = priorFetch;
    workspace.cleanup();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

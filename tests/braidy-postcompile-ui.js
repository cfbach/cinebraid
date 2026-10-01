"use strict";
/* Mocked browser-state test for the postcompile advisory seam. No provider call. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "public", "braidy-prompt-review.js"), "utf8");
const shot = { id: "S-01", motionPrompt: "Canon: the parcel opens.", creationBrief: { motionDirection: "Slow push-in." },
  keyframes: [{ id: "FR-A", label: "A", generationPackages: [] }], promptBuilds: [], generationPackages: [], clips: [] };
const motion = { id: "motion-1", packageId: "S-01-MOTION-R01", profileId: "minimax-h3/i2v",
  mode: "i2v", prompt: "Saved target package.", durationSeconds: 5, references: [
    { refId: "first-A", role: "first-frame", assetId: "approved-frame-A" },
  ], dependencySnapshot: { current: true }, confirmations: [] };
const image = { id: "frame-1", packageId: "S-01-FRAME-A-R01", profileId: "gpt-image-2/t2i",
  frameId: "FR-A", mode: "t2i", prompt: "Image package.", references: [], confirmations: [] };
const project = { promptBuildsById: { [motion.id]: motion, [image.id]: image }, meta: { world: "Canon world." } };
const originalCanon = JSON.stringify({ motionPrompt: shot.motionPrompt, creationBrief: shot.creationBrief,
  references: motion.references, meta: project.meta });
const nodes = new Map();
let modalOpen = false, closeCount = 0, routeCount = 0, dirtyCount = 0;
const modalObservers = new Set();
const modalElement = { classList: { contains(name) { return name === "hidden" && !modalOpen; } } };
let h3Resolution = "2K", imageOutputCount = 2, delayedAcceptedBasis = null;
let basisRevision = 1, proposalText = "Open the parcel with one slow push-in.", delayedImprovement = null;
let lastImprovementBody = null, lastAcceptedPrompt = "", lastPackageFingerprint = "", lastForce = false;
const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&amp;/g, "&");
function element(id) {
  if (!nodes.has(id)) {
    const node = { id, dataset: {}, hidden: false, disabled: false, value: "", textContent: "", checked: false,
      classList: { add() {}, remove() {}, toggle() {} } };
    Object.defineProperty(node, "innerHTML", {
      get() { return this._html || ""; },
      set(value) {
        this._html = value;
        if (id === "braidy-proposal") {
          const match = value.match(/<textarea id="braidy-proposed-prompt"[^>]*>([\s\S]*?)<\/textarea>/);
          if (match) element("braidy-proposed-prompt").value = decode(match[1]);
        }
        if (id === "braidy-omission-confirm" && value.includes("braidy-omission-ack"))
          element("braidy-omission-ack").checked = false;
      },
    });
    nodes.set(id, node);
  }
  return nodes.get(id);
}
function basis(body) {
  const submitted = String(body.submittedPrompt || "");
  const fingerprint = body.resolution === "1080p" || body.outputCount === 4
    ? "b".repeat(64) : "a".repeat(63) + String(basisRevision);
  const source = body.purpose === "blocking"
    ? shot.creationBrief.blockingBuilds?.find((row) => row.id === body.sourceBuildId)
    : project.promptBuildsById[body.sourceBuildId];
  const deterministicPrompt = body.kind === "h3" ? "H3 deterministic compilation." : "Image deterministic compilation.";
  const result = {
    ok: true, basisFingerprint: fingerprint,
    packageFingerprint: submitted ? "package:" + submitted : "package:deterministic",
    deterministicPrompt, currentSubmittedTargetPrompt: source?.manualEdited ? source.prompt : deterministicPrompt,
    target: body.kind === "h3"
      ? { modelId: "minimax-h3/i2v", modelName: "MiniMax H3", mode: "i2v", provider: "fal", endpoint: "fal/h3/i2v" }
      : { modelId: body.purpose === "blocking" ? "gpt-image-2/blocking" : "gpt-image-2/t2i", modelName: "GPT Image 2", mode: body.purpose === "blocking" ? "blocking" : "t2i", provider: "fal", endpoint: "fal/image" },
    inputManifest: body.kind === "h3" ? [{ slot: "Opening frame", role: "first-frame", assetId: "approved-frame-A" }] : [],
    warnings: [], generationSettings: { durationSeconds: body.durationSeconds || 0 },
    sendable: true, editedCoverage: submitted ? { lost: submitted.includes("omit") ? [{ label: "Parcel continuity" }] : [] } : null,
  };
  if (body.baselineFingerprint && body.baselineFingerprint !== fingerprint)
    return { error: "Basis changed" };
  lastPackageFingerprint = result.packageFingerprint;
  return result;
}
function response(data, status = 200) { return { ok: status < 400, status, json: async () => data }; }
const context = {
  window: null, document: { getElementById(id) { return id === "modal" ? modalElement : nodes.get(id) || null; } },
  MutationObserver: class {
    constructor(callback) { this.callback = callback; }
    observe() { modalObservers.add(this); }
    disconnect() { modalObservers.delete(this); }
  },
  AbortController, setTimeout, console,
  P: project, shotById(id) { return id === shot.id ? shot : null; },
  resolvePromptBuild(owner, id) { const build = owner.promptBuildsById[id]; return build ? JSON.parse(JSON.stringify(build)) : null; },
  packageFreshness() { return { current: true, recorded: true, reasons: [] }; },
  productionAspect() { return { label: "16:9" }; }, projectAspectLabel() { return "16:9"; },
  shotAspectLabel() { return "16:9"; }, falH3ResolutionValue() { return h3Resolution; },
  falGenerationConfig() { return { frameOutputs: imageOutputCount }; },
  flushPendingProjectSave: async () => {},
  openModal(html) {
    nodes.clear(); modalOpen = true;
    for (const match of html.matchAll(/id="([^"]+)"/g)) element(match[1]);
    const match = html.match(/data-session="([^"]+)"/);
    element("braidy-review-root").dataset.session = match?.[1] || "";
  },
  closeModal() {
    closeCount++; modalOpen = false;
    for (const observer of [...modalObservers]) observer.callback();
  },
  toast() {}, dirty() { dirtyCount++; }, route() { routeCount++; },
  createManualMotionPromptRevision(_shotId, buildId, prompt, _reason, options = {}) {
    lastAcceptedPrompt = prompt;
    lastForce = !!options.force;
    const sourceBuild = project.promptBuildsById[buildId];
    if (prompt === sourceBuild.prompt && !options.force) return JSON.parse(JSON.stringify(sourceBuild));
    const revised = { ...JSON.parse(JSON.stringify(sourceBuild)),
      id: "motion-revision-" + dirtyCount, prompt, manualEdited: true, parentBuildId: buildId,
      confirmations: [] };
    project.promptBuildsById[revised.id] = revised;
    return JSON.parse(JSON.stringify(revised));
  },
  guidedFrames() { return shot.keyframes; },
  guidedFrameState() { shot.frameWorkflow ||= { promptBuilds: [] }; return shot.frameWorkflow; },
  registerPromptBuild(owner, build) { owner.promptBuildsById[build.id] = JSON.parse(JSON.stringify(build)); return build.id; },
  promptBuildRef(id, extra) { return { buildId: id, ...extra }; },
  applyPromptBuildRetention() {},
  async fetch(url, options) {
    const body = JSON.parse(options.body);
    if (url.endsWith("/basis")) {
      if (body.submittedPrompt && delayedAcceptedBasis) return delayedAcceptedBasis;
      const result = basis(body);
      return response(result, result.error ? 409 : 200);
    }
    assert(url.endsWith("/improve"));
    lastImprovementBody = body;
    if (delayedImprovement) return delayedImprovement;
    return response({ ...basis(body), proposal: { proposedPrompt: proposalText,
      materialChanges: ["Removed duplicate direction."], warnings: [], unsupportedOrAmbiguous: [],
      reasoningSummary: "Tighter camera phrasing.", model: "gpt-5.6-luna", responseId: "mock-response",
      editedCoverage: { lost: proposalText.includes("omit") ? [{ label: "Parcel continuity" }] : [] },
      sendable: true } });
  },
};
context.window = context;
vm.runInNewContext(source, context, { filename: "braidy-prompt-review.js" });
async function flush() { await new Promise((resolve) => setImmediate(resolve)); }
async function run() {
  await context.openBraidyPromptReview("h3", shot.id, motion.id);
  assert.match(element("braidy-target-label").textContent, /MiniMax H3 · Image to Video/);
  assert.match(element("braidy-deterministic-prompt").textContent, /H3 deterministic/);
  assert.match(element("braidy-bound-inputs").innerHTML, /approved-frame-A/);
  await context.askBraidyPromptReview();
  assert.equal(lastImprovementBody.baselineFingerprint, "a".repeat(63) + "1");
  assert.equal(element("braidy-proposed-prompt").value, proposalText);
  assert.equal(element("braidy-review-accept").disabled, false, "Accept becomes available after advisory response completes");
  context.closeBraidyPromptReview();
  assert.equal(Object.keys(project.promptBuildsById).length, 2, "Reject leaves both deterministic builds unchanged");
  assert.equal(JSON.stringify({ motionPrompt: shot.motionPrompt, creationBrief: shot.creationBrief,
    references: motion.references, meta: project.meta }), originalCanon);

  await context.openBraidyPromptReview("h3", shot.id, motion.id);
  await context.askBraidyPromptReview();
  element("braidy-proposed-prompt").value = "Edited target-only prompt.";
  context.updateBraidyPromptReview();
  assert.equal(element("braidy-review-accept").textContent, "Save edited proposal");
  await context.acceptBraidyPromptReview();
  assert.equal(lastAcceptedPrompt, "Edited target-only prompt.");
  const revision = Object.values(project.promptBuildsById).find((row) => row.parentBuildId === motion.id);
  assert(revision?.braidyReview, "proposal provenance must be stored, not only on a resolved copy");
  assert.equal(revision.braidyReview.acceptedPrompt, "Edited target-only prompt.");
  assert.equal(revision.braidyReview.packageFingerprint, "package:Edited target-only prompt.");
  assert.equal(revision.braidyReview.model, "gpt-5.6-luna");
  assert.equal(JSON.stringify({ motionPrompt: shot.motionPrompt, creationBrief: shot.creationBrief,
    references: motion.references, meta: project.meta }), originalCanon, "Accept/Edit cannot change Canon or input authority");
  assert.equal(routeCount, 1, "target revision appears in normal project rendering");

  motion.prompt = proposalText;
  await context.openBraidyPromptReview("h3", shot.id, motion.id);
  await context.askBraidyPromptReview();
  await context.acceptBraidyPromptReview();
  assert.equal(lastForce, true, "same saved wording still needs an override when provider compilation differs");
  const sameSavedRevision = Object.values(project.promptBuildsById).filter((row) => row.parentBuildId === motion.id);
  assert.equal(sameSavedRevision.length, 2);
  assert.equal(sameSavedRevision.at(-1).prompt, proposalText);
  motion.prompt = "Saved target package.";
  motion.manualEdited = true;
  motion.prompt = "Manual current native target wording.";
  proposalText = motion.prompt;
  await context.openBraidyPromptReview("h3", shot.id, motion.id);
  assert.equal(element("braidy-current-target").hidden, false,
    "a manual revision exposes the current native target separately from deterministic baseline");
  assert.equal(element("braidy-current-target-prompt").textContent, motion.prompt);
  await context.askBraidyPromptReview();
  await context.acceptBraidyPromptReview();
  assert.equal(Object.values(project.promptBuildsById).filter((row) => row.parentBuildId === motion.id).length, 2,
    "matching current native target is a no-op rather than a redundant revision");
  motion.manualEdited = false;
  motion.prompt = "Saved target package.";
  proposalText = "Open the parcel with one slow push-in.";

  await context.openBraidyPromptReview("image", shot.id, image.id, "FR-A");
  await context.askBraidyPromptReview();
  assert.match(element("braidy-target-label").textContent, /GPT Image 2 · Text to Image/);
  await context.acceptBraidyPromptReview();
  const imageRevision = Object.values(project.promptBuildsById).find((row) => row.parentBuildId === image.id);
  assert(imageRevision?.braidyReview, "image revision is linked to exact source build");
  assert.equal(imageRevision.frameId, "FR-A");
  assert.equal(shot.frameWorkflow.promptBuilds.at(-1).buildId, imageRevision.id);
  assert.equal(JSON.stringify({ motionPrompt: shot.motionPrompt, creationBrief: shot.creationBrief,
    references: motion.references, meta: project.meta }), originalCanon);

  await context.openBraidyPromptReview("h3", shot.id, motion.id);
  await context.askBraidyPromptReview();
  basisRevision = 2;
  await context.acceptBraidyPromptReview();
  assert.equal(modalOpen, true, "stale basis keeps proposal open for inspection");
  assert.match(element("braidy-review-status").textContent, /changed|out of date/i);
  assert.equal(Object.values(project.promptBuildsById).filter((row) => row.parentBuildId === motion.id).length, 2,
    "stale proposal cannot create another revision");
  context.closeBraidyPromptReview();

  basisRevision = 3;
  proposalText = "omit parcel continuity";
  await context.openBraidyPromptReview("h3", shot.id, motion.id);
  await context.askBraidyPromptReview();
  assert.match(element("braidy-proposal").innerHTML, /Parcel continuity/);
  await context.acceptBraidyPromptReview();
  assert.match(element("braidy-review-status").textContent, /acknowledge/);
  element("braidy-omission-ack").checked = true;
  await context.acceptBraidyPromptReview();
  const omissionRevision = Object.values(project.promptBuildsById).filter((row) => row.parentBuildId === motion.id).at(-1);
  assert.deepEqual(Array.from(omissionRevision.braidyReview.intentionalOmissions), ["Parcel continuity"]);

  proposalText = "Another review option";
  await context.openBraidyPromptReview("h3", shot.id, motion.id);
  await context.askBraidyPromptReview();
  element("braidy-proposed-prompt").value = "Edited comparison A";
  context.updateBraidyPromptReview();
  proposalText = "Stronger comparison B";
  await context.askBraidyPromptReview();
  context.selectBraidyPromptProposal("0");
  assert.equal(element("braidy-proposed-prompt").value, "Edited comparison A", "comparison retains each unsaved edit");
  context.closeBraidyPromptReview();

  await context.openBraidyPromptReview("h3", shot.id, motion.id);
  let release;
  delayedImprovement = new Promise((resolve) => { release = resolve; });
  const pending = context.askBraidyPromptReview();
  await flush();
  context.closeModal(); // backdrop dismissal follows the generic modal path
  release(response({ ...basis({ kind: "h3" }), proposal: { proposedPrompt: "Late proposal", model: "gpt-5.6-luna" } }));
  await pending;
  assert.equal(modalOpen, false, "backdrop dismissal cannot reopen a late proposal");
  assert.equal(Object.values(project.promptBuildsById).filter((row) => row.parentBuildId === motion.id).length, 3,
    "late response cannot mutate target package");
  delayedImprovement = null;
  await context.openBraidyPromptReview("h3", shot.id, motion.id);
  proposalText = "Escape must not save this proposal.";
  await context.askBraidyPromptReview();
  let releaseAcceptedBasis;
  delayedAcceptedBasis = new Promise((resolve) => { releaseAcceptedBasis = resolve; });
  const beforeDismissedAccept = Object.keys(project.promptBuildsById).length;
  const pendingAccept = context.acceptBraidyPromptReview();
  await flush();
  context.closeModal(); // Escape follows the same generic closeModal path
  releaseAcceptedBasis(response(basis({ kind: "h3", submittedPrompt: proposalText })));
  await pendingAccept;
  delayedAcceptedBasis = null;
  assert.equal(Object.keys(project.promptBuildsById).length, beforeDismissedAccept,
    "an accepted-plan response cannot save after Escape hides the modal");

  basisRevision = 1;
  let verified = await context.verifyBraidyRevisionBasis("h3", shot.id, revision);
  assert.equal(verified.ok, true, "unchanged accepted H3 revision reopens through exact basis");
  h3Resolution = "1080p";
  verified = await context.verifyBraidyRevisionBasis("h3", shot.id, revision);
  assert.equal(verified.ok, false, "H3 output setting change before native review must withhold old advice");
  h3Resolution = "2K";
  verified = await context.verifyBraidyRevisionBasis("image", shot.id, imageRevision, "FR-A");
  assert.equal(verified.ok, true, "unchanged accepted image revision reopens through exact basis");
  imageOutputCount = 4;
  verified = await context.verifyBraidyRevisionBasis("image", shot.id, imageRevision, "FR-A");
  assert.equal(verified.ok, false, "image output setting change before native review must withhold old advice");
  imageOutputCount = 2;
  basisRevision = 3;
  const blocking = { id: "blocking-1", packageId: "S-01-BLOCKING-R01", profileId: "gpt-image-2/blocking",
    prompt: "Saved blocking package.", references: [], confirmations: [], dependencySnapshot: { blockingInputs: {} } };
  shot.creationBrief.blockingBuilds = [blocking];
  const canonBeforeBlocking = JSON.stringify({ motionPrompt: shot.motionPrompt,
    motionDirection: shot.creationBrief.motionDirection, meta: project.meta });
  proposalText = "Clear grayscale blocking with the open parcel on the platform bench.";
  await context.openBraidyPromptReview("blocking", shot.id, blocking.id);
  assert.match(element("braidy-target-label").textContent, /GPT Image 2 · Blocking/);
  await context.askBraidyPromptReview();
  await context.acceptBraidyPromptReview();
  assert.equal(shot.creationBrief.blockingBuilds.length, 2, "blocking target revision is linked inline");
  assert.equal(shot.creationBrief.blockingBuilds[1].parentBuildId, blocking.id);
  assert.equal(shot.creationBrief.blockingBuilds[1].braidyReview.acceptedPrompt, proposalText);
  assert.equal(JSON.stringify({ motionPrompt: shot.motionPrompt,
    motionDirection: shot.creationBrief.motionDirection, meta: project.meta }), canonBeforeBlocking,
    "blocking proposal cannot mutate canonical direction");
  assert(dirtyCount > 0 && closeCount >= 4);
  assert.equal(lastPackageFingerprint.startsWith("package:"), true);
  console.log("braidy-postcompile-ui: H3/image/blocking reviews, Canon immutability, pre-open staleness and generic modal dismissal pass");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
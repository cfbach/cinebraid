/* CineBraid generation contracts — GenerationJob and GenerationResult.
 *
 * The contract exists to hold one line: a job says WHAT production result is wanted
 * and never HOW a provider is wired. Most of what follows is that line, tested from
 * both directions — valid intent must survive, and provider transport or graph
 * structure must be refused wherever it is hidden.
 *
 * The other half is rollout shape. These contracts land long before anything
 * dispatches through them, so a field a later phase will populate must be allowed to
 * be absent while a field that contradicts another is an error. Permissive about
 * presence, strict about meaning.
 *
 * Pure module, no I/O, no server.
 */
const assert = require("assert");
const C = require("../generation-contracts");

function codes(result) {
  return result.errors.map((error) => error.code);
}
function fields(result) {
  return result.errors.map((error) => error.field);
}
function baseJob(overrides = {}) {
  return {
    jobId: "gen-mfk3x2-9a1c",
    target: { kind: "shot-frame", shotId: "SC-01-01", frameId: "frame-a-mfk1x0", purpose: "frame" },
    outputType: "image",
    mode: "t2i",
    inputs: { prompt: "Interior galley, night, practical sodium light.", references: [] },
    output: { aspectRatio: "16:9", resolutionPreset: "2k", candidateCount: 8 },
    settings: { seedMode: "random", quality: "high", routingIntent: "fast", adapters: [], extensions: {} },
    model: { modelId: "z-image/turbo", promptProfileId: "z-image/t2i" },
    routing: { selection: "auto_local", policy: "local_only", backendId: null, nodeId: null },
    governance: { dataClassification: "INTERNAL", requiredAssurances: [] },
    accounting: { costClass: "free_local" },
    status: "draft",
    ...overrides,
  };
}
function reference(overrides = {}) {
  return {
    refId: "r1",
    role: "identity",
    mediaType: "image",
    source: { kind: "project-asset", path: "anchors/CHAR-KAI-DEFAULT.png" },
    order: 1,
    token: "#image1",
    ...overrides,
  };
}
function ok(job, label) {
  const result = C.validateGenerationJob(job);
  assert(result.ok, `${label} must validate. Errors: ${JSON.stringify(result.errors)}`);
  return result;
}
function rejects(job, code, label) {
  const result = C.validateGenerationJob(job);
  assert(!result.ok, `${label} must be rejected`);
  assert(codes(result).includes(code), `${label} must be rejected with ${code}, got ${JSON.stringify(result.errors)}`);
  return result;
}

/* =====================================================================
   1. Representative valid intent, across the shapes later phases need.
   ===================================================================== */

ok(baseJob(), "a plain text-to-image job");

ok(baseJob({
  mode: "edit",
  model: { modelId: "gpt-image-2/standard", promptProfileId: "gpt-image-2/edit" },
  inputs: {
    prompt: "Remove the coffee cup from the counter; keep everything else identical.",
    references: [reference({ role: "base", source: { kind: "candidate", shotId: "SC-01-01", path: "shots/SC-01-01/takes/SC-01-01_FRAME_A_FAL_1.png" } })],
  },
}), "an image edit with a base reference");

ok(baseJob({
  mode: "blocking",
  target: { kind: "shot-blocking", shotId: "SC-01-01", purpose: "blocking" },
  model: { modelId: "gpt-image-2/standard", promptProfileId: "gpt-image-2/blocking" },
}), "a blocking guide");

ok(baseJob({
  mode: "flf",
  outputType: "video",
  target: { kind: "shot-motion", shotId: "SC-01-01", purpose: "motion-h3" },
  model: { modelId: "minimax-h3/fl2va", promptProfileId: "minimax-h3/flf" },
  inputs: {
    prompt: "The courier turns from the console and walks out of frame.",
    references: [
      reference({ refId: "r1", role: "first-frame", source: { kind: "media-asset", assetId: "asset-8f21c4" } }),
      reference({ refId: "r2", role: "last-frame", order: 2, source: { kind: "media-asset", assetId: "asset-7d0299" } }),
    ],
  },
  output: { aspectRatio: "16:9", resolutionPreset: "2K", durationSeconds: 10, fps: 24, audio: "native", candidateCount: 1 },
}), "a first/last-frame video");

ok(baseJob({
  mode: "r2v",
  outputType: "video",
  target: { kind: "shot-motion", shotId: "SC-01-01", purpose: "motion-h3" },
  model: { modelId: "minimax-h3/ref2va", promptProfileId: "minimax-h3/multi-frame" },
  inputs: {
    prompt: "Kai crosses the galley.",
    references: [
      reference({ refId: "r1", role: "identity", mediaType: "image" }),
      reference({ refId: "r2", role: "location", mediaType: "image", order: 2, source: { kind: "project-asset", path: "plates/LOC-GALLEY.png" } }),
      reference({ refId: "r3", role: "motion-reference", mediaType: "video", order: 3, source: { kind: "media-asset", assetId: "asset-prevclip" } }),
      reference({ refId: "r4", role: "voice", mediaType: "audio", order: 4, source: { kind: "project-asset", path: "audio/KAI-VO-TAKE3.wav" } }),
    ],
  },
  output: { durationSeconds: 9.9, fps: 24, audio: "native", candidateCount: 1 },
}), "a multimodal reference-to-video with four semantic roles");

/* --- reference source identity precedence, all three forms valid --- */
ok(baseJob({
  inputs: { prompt: "x", references: [reference({ source: { kind: "project-asset", path: "anchors/a.png" } })] },
}), "a legacy path-only source");
ok(baseJob({
  inputs: { prompt: "x", references: [reference({ source: { kind: "media-asset", assetId: "asset-1" } })] },
}), "an assetId source");
ok(baseJob({
  inputs: { prompt: "x", references: [reference({ source: { kind: "media-asset", assetId: "asset-1", contentHash: "sha256:be31", path: "anchors/a.png" } })] },
}), "an assetId + contentHash + path source");

assert.deepStrictEqual(
  C.resolveReferenceSource({ assetId: "asset-1", contentHash: "sha256:be31", path: "anchors/a.png" }),
  { ok: true, by: "assetId", value: "asset-1" },
  "assetId is canonical when present",
);
assert.deepStrictEqual(
  C.resolveReferenceSource({ contentHash: "sha256:be31", path: "anchors/a.png" }),
  { ok: true, by: "contentHash", value: "sha256:be31" },
  "contentHash outranks a path",
);
assert.deepStrictEqual(
  C.resolveReferenceSource({ path: "anchors/a.png" }),
  { ok: true, by: "path", value: "anchors/a.png" },
  "a path-only source stays valid indefinitely",
);
assert.strictEqual(C.resolveReferenceSource({}).ok, false, "a source with no identity at all is unresolvable");

/* --- routing shapes: all four selections and all four policies parse --- */
for (const selection of C.ROUTING_SELECTIONS) {
  const routing = { selection, policy: "local_only" };
  if (selection === "node") routing.nodeId = "render-pc-1";
  if (selection === "backend") routing.backendId = "fal";
  ok(baseJob({ routing }), `routing.selection ${selection}`);
}
for (const policy of C.ROUTING_POLICIES)
  ok(baseJob({ routing: { selection: "auto", policy } }), `routing.policy ${policy}`);

ok(baseJob({
  routing: { selection: "backend", backendId: "fal", policy: "allow_paid_fallback" },
  accounting: { costClass: "metered_api", estimate: { costClass: "metered_api", unit: "usd", amount: 0.32, confidence: "estimated" } },
}), "an explicit paid backend with an estimate");

/* An account reference may be present long before AccountConnection exists. */
const withAccount = ok(baseJob({
  routing: { selection: "backend", backendId: "civitai", policy: "allow_paid_fallback", accountConnectionId: "acct-civitai-1" },
  accounting: { costClass: "metered_credits", estimate: { costClass: "metered_credits", unit: "buzz", amount: 480, confidence: "quoted", quotedAt: "2026-08-08T00:00:00Z" } },
}), "an unresolved accountConnectionId");
assert.strictEqual(withAccount.warnings.length, 0, "an account on a metered job is not a warning");

const freeWithAccount = C.validateGenerationJob(baseJob({
  routing: { selection: "auto_local", policy: "local_only", accountConnectionId: "acct-civitai-1" },
  accounting: { costClass: "free_local" },
}));
assert(freeWithAccount.ok, "an account on a free job is a warning, not an error");
assert.strictEqual(freeWithAccount.warnings[0].code, "account-on-free-job");

/* --- minimal job: everything optional actually is optional --- */
ok({
  jobId: "gen-min",
  target: { kind: "shot-frame", shotId: "SC-01-01" },
  outputType: "image",
  mode: "t2i",
  inputs: { prompt: "" },
  model: { modelId: "z-image/turbo" },
}, "a job carrying only what is required");

/* =====================================================================
   2. The intent boundary. Provider transport and graph structure refused.
   ===================================================================== */

rejects(baseJob({ model: { modelId: "minimax-h3/fl2va", falEndpoint: "minimax/h3/image-to-video" } }),
  "provider-detail-in-intent", "a FAL endpoint on the model");
rejects(baseJob({ settings: { seedMode: "random", nodeId: "9" } }),
  "provider-detail-in-intent", "a workflow node id in settings");
rejects(baseJob({ settings: { seedMode: "random", classType: "KSampler" } }),
  "provider-detail-in-intent", "a graph class type in settings");
rejects(baseJob({ settings: { seedMode: "random", bindings: [] } }),
  "provider-detail-in-intent", "graph bindings in settings");
rejects(baseJob({ output: { candidateCount: 1, baseUrl: "https://queue.fal.run" } }),
  "provider-detail-in-intent", "a provider base URL in output");
rejects(baseJob({ inputs: { prompt: "x", references: [reference({ source: { kind: "project-asset", path: "https://provider.example/a.png" } })] } }),
  "provider-url-in-intent", "a provider URL hidden in a reference path");
rejects(baseJob({ settings: { seedMode: "random", apiKey: "sk-live" } }),
  "provider-detail-in-intent", "a credential in settings");
rejects(baseJob({ model: { modelId: "z-image/turbo", displayName: "Z-Image Turbo" } }),
  "display-name-in-intent", "a display name used alongside identity");

/* settings.extensions is namespaced by modelId and deliberately opaque: model-specific
   values live there and core never reads inside, so the boundary scan must stop. */
ok(baseJob({
  settings: {
    seedMode: "random",
    extensions: { "minimax-h3": { sigmaShift: 3.0, nodeId: "136", url: "https://internal.example" } },
  },
}), "provider-shaped values inside settings.extensions");

/* Routing is NOT production intent: routing.nodeId is a CineBraid execution target,
   not a graph node, and must keep working. */
ok(baseJob({ routing: { selection: "node", nodeId: "render-pc-1", policy: "local_only" } }),
  "routing.nodeId, which names a machine rather than a graph node");

/* The boundary is an explicit list of transport and graph keys, never a heuristic on
   the field name. references[].token is the prompt engine's reference token — the
   thing that becomes #image1 in a compiled prompt — and refusing it because the word
   "token" appears would break every reference the compiler already emits. */
ok(baseJob({
  inputs: { prompt: "x", references: [reference({ token: "#image1" })] },
}), "references[].token, which is a prompt token and not a credential");
assert(
  !C.FORBIDDEN_INTENT_KEYS.includes("token"),
  "the intent boundary must not refuse a field merely because its name contains a credential-ish word",
);
for (const transportKey of ["url", "baseurl", "endpoint", "apikey", "nodeid", "class_type", "workflow"])
  assert(C.FORBIDDEN_INTENT_KEYS.includes(transportKey), `${transportKey} must be refused in production intent`);

/* =====================================================================
   3. Semantic contradictions.
   ===================================================================== */

rejects(baseJob({ mode: "definitely-not-a-mode" }), "unsupported-value", "an unknown mode");
rejects(baseJob({ inputs: { prompt: "x", references: [reference({ role: "vibe" })] } }),
  "unsupported-value", "an unknown reference role");
rejects(baseJob({ routing: { selection: "auto", policy: "whatever" } }), "unsupported-value", "an unknown routing policy");
rejects(baseJob({ accounting: { costClass: "free" } }), "unsupported-value", "an unknown cost class");
rejects(baseJob({ governance: { dataClassification: "TOP_SECRET" } }), "unsupported-value", "an unknown classification");
rejects(baseJob({ status: "thinking" }), "unsupported-value", "an unknown status");

rejects(baseJob({ mode: "t2v", outputType: "image" }), "contradiction", "a video mode declaring an image result");
rejects(baseJob({ output: { candidateCount: 1, durationSeconds: 10 } }), "contradiction", "a duration on an image job");
rejects(baseJob({ output: { candidateCount: 1, fps: 24 } }), "contradiction", "a frame rate on an image job");
rejects(baseJob({ output: { candidateCount: 1, audio: "native" } }), "contradiction", "native audio on an image job");
rejects(baseJob({ output: { candidateCount: 0 } }), "out-of-range", "a candidate count of zero");
rejects(baseJob({ settings: { seedMode: "explicit" } }), "contradiction", "explicit seed mode with no seed");
rejects(baseJob({ settings: { seedMode: "random", seed: 412287771 } }), "contradiction", "random seed mode carrying a seed");
rejects(baseJob({ routing: { selection: "node", policy: "local_only" } }), "missing", "node selection with no node");
rejects(baseJob({ routing: { selection: "backend", policy: "local_only" } }), "missing", "backend selection with no backend");
rejects(baseJob({ target: { kind: "shot-frame" } }), "missing", "a shot job with no shot");
rejects(baseJob({ target: { kind: "entity-reference" } }), "missing", "an entity job with no entity");
rejects(baseJob({ model: {} }), "missing", "a job with no modelId");

rejects(baseJob({
  mode: "flf", outputType: "video", target: { kind: "shot-motion", shotId: "SC-01-01" },
  inputs: { prompt: "x", references: [reference({ role: "first-frame", mediaType: "video" })] },
}), "contradiction", "a first-frame reference that is not an image");
rejects(baseJob({
  mode: "r2v", outputType: "video", target: { kind: "shot-motion", shotId: "SC-01-01" },
  inputs: { prompt: "x", references: [reference({ role: "voice", mediaType: "image" })] },
}), "contradiction", "a voice reference that is not audio");
rejects(baseJob({
  inputs: { prompt: "x", references: [reference({ refId: "r1" }), reference({ refId: "r1", order: 2 })] },
}), "duplicate", "two references sharing a refId");
rejects(baseJob({
  inputs: { prompt: "x", references: [reference({ source: { kind: "media-asset" } })] },
}), "unresolvable", "a reference source with no identity");

/* An unsupported reference control is a CAPABILITY question, not a shape question:
   the contract accepts the field and the resolver refuses it against a model that
   cannot weight references (see tests/generation-capability.js). What must never
   happen is the control being silently dropped, and neither layer drops it. */
const weighted = ok(baseJob({
  inputs: { prompt: "x", references: [reference({ controls: { weight: 0.7 } })] },
}), "a reference carrying a weight");
assert.strictEqual(weighted.errors.length, 0);

/* =====================================================================
   4. GenerationResult.
   ===================================================================== */

function baseResult(overrides = {}) {
  return {
    jobId: "gen-mfk3x2-9a1c",
    attempt: 1,
    status: "completed",
    backend: {
      backendId: "fal", nodeId: null, nodeLabel: "fal",
      orchestratorLocation: "hosted_api", inferenceLocation: "hosted_api",
      executionKind: "hosted_api", costClass: "metered_api",
      accountConnectionId: null, backendJobId: "9f2c", backendVersion: "",
    },
    model: { modelId: "gpt-image-2/standard", family: "gpt-image-2", variant: "standard", resourceRef: null },
    recipe: null,
    settings: { seed: 412287771, steps: null, cfg: null, width: 1536, height: 864, adapters: [] },
    artifacts: [{
      artifactId: "a1", kind: "image", role: "candidate", index: 0,
      mime: "image/png", bytes: 1839221, width: 1536, height: 864,
      durationSeconds: null, fps: null,
      hasNativeAudio: false, audioSource: "none",
      contentHash: "sha256:be31", assetId: null,
      storedAs: "shots/SC-01-01/takes/SC-01-01_FRAME_A_FAL_1.png",
      sourceRef: { kind: "provider-url" },
    }],
    inputsUsed: [],
    timings: { submittedAt: "t0", completedAt: "t1", totalMs: 8780 },
    warnings: [], errors: [],
    ...overrides,
  };
}
function resultOk(result, label) {
  const validated = C.validateGenerationResult(result);
  assert(validated.ok, `${label} must validate. Errors: ${JSON.stringify(validated.errors)}`);
  return validated;
}
function resultRejects(result, code, label) {
  const validated = C.validateGenerationResult(result);
  assert(!validated.ok, `${label} must be rejected`);
  assert(codes(validated).includes(code), `${label} must be rejected with ${code}, got ${JSON.stringify(validated.errors)}`);
}

resultOk(baseResult(), "a hosted image result");

/* assetId is absent for the whole of Phase 1 — nothing mints one — and that is normal,
   not a defect. This is the shape a result has BEFORE MediaAsset exists. */
const preMint = baseResult();
delete preMint.artifacts[0].assetId;
resultOk(preMint, "a result recorded before any MediaAsset is minted");
assert.strictEqual(preMint.artifacts[0].assetId, undefined);

resultOk(baseResult({
  backend: {
    backendId: "comfy", nodeId: "render-pc-1", nodeLabel: "Render-PC-1",
    orchestratorLocation: "trusted_lan", inferenceLocation: "trusted_lan",
    executionKind: "local_native", costClass: "free_local", backendJobId: "b1e7",
  },
  model: { modelId: "z-image/turbo" },
  recipe: { recipeId: "zimage-turbo-t2i", version: 1, hash: "sha256:9c1e", workflowHash: "sha256:44ab" },
  artifacts: [{ artifactId: "a1", kind: "image", role: "candidate", contentHash: "sha256:be31", storedAs: "shots/SC-01-01/takes/x.png" }],
}), "a local Comfy result with a hash-pinned recipe");

resultOk(baseResult({
  backend: {
    backendId: "comfy", nodeId: "render-pc-1",
    orchestratorLocation: "trusted_lan", inferenceLocation: "trusted_lan",
    executionKind: "local_native", costClass: "free_local",
  },
  model: { modelId: "minimax-h3/fl2va" },
  artifacts: [{
    artifactId: "a1", kind: "video", role: "candidate",
    mime: "video/mp4", durationSeconds: 10.125, fps: 24,
    hasNativeAudio: true, audioSource: "native", audioChannels: 2,
    contentHash: "sha256:7d02", storedAs: "shots/SC-01-01/takes/x.mp4",
  }],
  inputsUsed: [
    { refId: "r1", role: "first-frame", assetId: "asset-A", contentHash: "sha256:be31" },
    { refId: "r2", role: "last-frame", contentHash: "sha256:7d02" },
  ],
}), "a video result carrying native audio and recorded inputs");

/* A partner node orchestrates locally and infers remotely. Collapsing those into one
   value is how a billed remote render eventually gets badged Local. */
resultOk(baseResult({
  backend: {
    backendId: "comfy", nodeId: "render-pc-1",
    orchestratorLocation: "trusted_lan", inferenceLocation: "hosted_partner",
    executionKind: "comfy_partner", costClass: "metered_partner",
  },
  model: { modelId: "minimax-h3/fl2va" },
}), "a partner-node result");

resultRejects(baseResult({
  backend: {
    backendId: "comfy", orchestratorLocation: "trusted_lan", inferenceLocation: "hosted_partner",
    executionKind: "local_native", costClass: "free_local",
  },
}), "contradiction", "a partner render claiming to be local_native");
resultRejects(baseResult({
  backend: {
    backendId: "comfy", orchestratorLocation: "trusted_lan", inferenceLocation: "trusted_lan",
    executionKind: "local_native", costClass: "metered_api",
  },
}), "contradiction", "a local render claiming to be metered");
resultRejects(baseResult({
  backend: {
    backendId: "comfy", orchestratorLocation: "trusted_lan", inferenceLocation: "trusted_lan",
    executionKind: "comfy_partner", costClass: "metered_partner",
  },
}), "contradiction", "a partner kind whose inference is not at a partner");
resultRejects(baseResult({ status: "completed", artifacts: [] }), "contradiction", "a completed result with no artifacts");
resultRejects(baseResult({
  artifacts: [{ artifactId: "a1", kind: "image", hasNativeAudio: true }],
}), "contradiction", "an image artifact claiming native audio");
resultRejects(baseResult({
  artifacts: [{ artifactId: "a1", kind: "image", durationSeconds: 4 }],
}), "contradiction", "an image artifact with a duration");
resultRejects(baseResult({
  artifacts: [{ artifactId: "a1", kind: "image" }, { artifactId: "a1", kind: "image" }],
}), "duplicate", "two artifacts sharing an id");
resultRejects(baseResult({ inputsUsed: [{ refId: "r1", role: "identity" }] }),
  "unresolvable", "a recorded input with no identity");
resultRejects(baseResult({ status: "in-flight" }), "unsupported-value", "an unknown result status");

/* A failed result carries no artifacts and that is legal. */
resultOk(baseResult({ status: "failed", artifacts: [], errors: [{ code: "EXECUTION_FAILED" }] }),
  "a failed result");

/* =====================================================================
   5. Extensibility. A new mode or role must be a data change.
   ===================================================================== */

/* The shipped vocabulary is a DEFAULT, not a closed enum welded into the validator.
   A later phase that introduces a mode supplies it; no branch in this module changes,
   and nothing anywhere switches on a model name to decide what a model can do. */
const withNewMode = C.validateGenerationJob(
  baseJob({ mode: "holography" }),
  { modes: Object.keys(C.MODE_OUTPUT_TYPES).concat("holography") },
);
assert(
  !fields(withNewMode).includes("mode"),
  `a mode supplied by the caller's vocabulary must be accepted without editing the validator, got ${JSON.stringify(withNewMode.errors)}`,
);
/* The same mode under the DEFAULT vocabulary is refused, so the injection above
   proved extensibility rather than a hole. */
rejects(baseJob({ mode: "holography" }), "unsupported-value", "an unknown mode under the default vocabulary");

const withNewRole = C.validateGenerationJob(
  baseJob({ inputs: { prompt: "x", references: [reference({ role: "scent-reference" })] } }),
  { referenceRoles: ["scent-reference"] },
);
assert(
  !withNewRole.errors.some((error) => error.field.endsWith(".role")),
  `a reference role supplied by the caller's vocabulary must be accepted, got ${JSON.stringify(withNewRole.errors)}`,
);
/* And the default still refuses it, so extensibility is opt-in rather than a hole. */
rejects(baseJob({ inputs: { prompt: "x", references: [reference({ role: "scent-reference" })] } }),
  "unsupported-value", "an unknown role under the default vocabulary");

/* No conditional on a model, family or vendor name may exist in the contract layer.
   The moment one does, adding a model stops being a data change. */
const contractSource = require("fs").readFileSync(require("path").join(__dirname, "..", "generation-contracts.js"), "utf8");
for (const family of ["z-image", "minimax", "gpt-image", "qwen-image", "krea", "flux", "wan", "ltx", "seedream", "nano-banana"])
  assert(
    !new RegExp(`["'\`][^"'\`]*${family}`, "i").test(contractSource.replace(/\/\*[\s\S]*?\*\//g, "")),
    `generation-contracts.js must not name the ${family} family outside a comment`,
  );

/* The validator must not INVENT a routing default. Absent means "not yet decided",
   and a later phase has to choose deliberately — a contract that quietly defaulted to
   allow_paid_fallback would be a spending decision made by a schema. */
const noPolicy = baseJob({ routing: { selection: "auto" } });
ok(noPolicy, "a job with no routing policy yet");
assert.strictEqual(noPolicy.routing.policy, undefined, "validation must not write a policy into the job");
const noCost = baseJob({ accounting: {} });
ok(noCost, "a job with no cost class yet");
assert.strictEqual(noCost.accounting.costClass, undefined, "validation must not write a cost class into the job");

/* Validation is read-only: nothing may edit the job it was handed. */
const pristine = baseJob({ inputs: { prompt: "x", references: [reference()] } });
const snapshot = JSON.stringify(pristine);
C.validateGenerationJob(pristine);
C.validateGenerationResult(baseResult());
assert.strictEqual(JSON.stringify(pristine), snapshot, "validation must not mutate its input");

console.log(
  "Generation job/result contract suite passed: intent stays provider-neutral, "
  + "reference identity resolves assetId > contentHash > legacy path, execution kind cannot lie about "
  + "where inference ran, and a result validates before any MediaAsset exists.",
);

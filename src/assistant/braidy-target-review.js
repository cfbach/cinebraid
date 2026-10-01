/* A Braidy proposal is advisory text for one compiled generation package. This
 * module projects the server-owned plan into a bounded, media-free review context
 * and binds it to Canon, settings, ordered input bytes and the exact adapter. */
const crypto = require("crypto");
const fs = require("fs");

function digest(value) {
  return crypto.createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
}

function text(value) { return String(value == null ? "" : value).trim(); }
function record(value) { return value && typeof value === "object" && !Array.isArray(value); }

async function sha256File(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function inlineIdentity(inline) {
  const source = text(inline);
  if (source.startsWith("data:")) {
    const comma = source.indexOf(",");
    if (comma < 0) return { kind: "data-uri", sha256: digest(source) };
    const header = source.slice(0, comma);
    const content = source.slice(comma + 1);
    const bytes = /;base64$/i.test(header) ? Buffer.from(content, "base64") : Buffer.from(decodeURIComponent(content));
    return { kind: "data-uri", sha256: digest(bytes) };
  }
  /* Existing generation can accept a remote source. Do not fetch it just for an
   * advisory call or pretend its bytes are known: bind the address fingerprint,
   * report the unknown bytes, and let the normal paid boundary decide freshness. */
  return { kind: "remote-address", addressSha256: digest(source), bytesVerified: false };
}

async function manifestRow(binding, row, resolveAddress, approvalEvidence) {
  const address = resolveAddress(row);
  const identity = address.file
    ? { kind: "local-file", sha256: await sha256File(address.file), bytesVerified: true }
    : inlineIdentity(address.inline);
  return {
    refId: text(row.refId), role: text(binding.role || row.role), mediaType: text(binding.mediaType || row.mediaType),
    order: Number(binding.order), providerField: text(binding.field),
    providerIndex: binding.index == null ? null : Number(binding.index),
    ...(binding.appliesTo ? { appliesTo: text(binding.appliesTo) } : {}),
    required: row.required === true,
    label: text(row.production?.label), purpose: text(row.production?.purpose),
    continuityState: text(row.production?.continuityState),
    /* Declared identity is distinct from authority verified against receipt and bytes. */
    ...(row.source?.assetId ? { declaredAssetId: text(row.source.assetId) } : {}),
    ...(row.source?.contentHash ? { declaredContentHash: text(row.source.contentHash) } : {}),
    ...approvalEvidence(row, address, identity),
    mediaIdentity: identity,
  };
}

function providerSettings(serialized) {
  const input = record(serialized?.input) ? serialized.input : {};
  /* Exact current H3/GPT Image 2 scalar controls. Never project a future media
   * field merely because its name lacks a URL suffix. */
  const fields = ["duration", "enable_prompt_expansion", "resolution", "aspect_ratio",
    "image_size", "quality", "num_images", "output_format"];
  return Object.fromEntries(fields.filter((key) => input[key] != null)
    .map((key) => [key, input[key]]));
}

function canonicalIntent(spec) {
  /* The stored generation spec is the authoritative source of production intent.
   * Remove transport addresses and media blobs; references are conveyed through
   * the exact ordered manifest instead. This copy is never written to Canon. */
  function project(value, depth = 0) {
    if (depth > 32) throw new TypeError("The canonical shot intent is too deeply nested for Braidy review.");
    if (Array.isArray(value)) return value.map((entry) => project(entry, depth + 1));
    if (!record(value)) { if (typeof value !== "string") return value; if (/^(?:data:|https?:\/\/|\/api\/references\/image\?)/i.test(value)) return "[media address omitted; exact bound identity is in the input manifest]"; return value; }
    const output = {};
    for (const [key, child] of Object.entries(value)) {
      /* Only credential and media-payload keys are excluded. Creative cameraPath and movement path remain Canon. */
      if (/^(?:apiKey|openaiKey|secret|accessToken|authToken|credential|dataUri|base64)$/i.test(key)) continue;
      output[key] = project(child, depth + 1);
    }
    return output;
  }
  return project(spec);
}

/* Only executable, version-checked packs supply writing guidance. Historical
 * catalogue rows never become Braidy instructions merely by existing on disk. */
function qualifiedPromptPolicy(plan, profile) {
  const { getModelPack } = require("../generation/generation-compiler");
  const pack = getModelPack(text(profile?.family));
  const playbook = pack?.playbook;
  if (!playbook || text(pack.packId) !== text(plan.compiler?.packId)
      || text(pack.packVersion) !== text(plan.compiler?.packVersion)
      || text(playbook.version) !== text(plan.compiler?.playbookVersion))
    throw new TypeError("Braidy's exact target has no current executable playbook.");
  const mode = text(plan.mode);
  const common = {
    source: "qualified-executable-model-pack",
    packId: text(pack.packId), packVersion: text(pack.packVersion), playbookVersion: text(playbook.version),
    mode, sectionTitles: Object.values(playbook.sectionTitles || {}).map(text),
    anchoredBy: playbook.anchoredBy?.[mode] || {},
    editorialWritingTargetCharacters: Number(profile?.limits?.writingTargetCharacters) > 0
      ? Number(profile.limits.writingTargetCharacters) : null,
  };
  if (pack.packId === "minimax-h3") return {
    ...common,
    apiSerialisation: text(playbook.serialisation?.api),
    anchorOrientation: playbook.anchorOrientation || {},
    camera: { amplitude: playbook.camera?.amplitude || {}, speed: playbook.camera?.speed || {} },
    soundscapeExcludes: playbook.soundscapeExcludes || [],
  };
  if (pack.packId === "gpt-image-2") return {
    ...common,
    referencesCarryIdentity: playbook.referencesCarryIdentity === true,
    omittedByDesign: playbook.omittedByDesign || {},
    ...(mode === "blocking" ? { blockingOmits: playbook.blockingOmits || {}, blocking: playbook.blocking || {} } : {}),
  };
  throw new TypeError("Braidy has no qualified prompt policy for this executable pack.");
}
async function buildBraidyReviewBasis({ projectSlug, compiled, sourceSpec, serialized, resolveAddress, approvalEvidence, qualifiedProfile, liveCanon, sourceFreshness, currentSubmittedTargetPrompt }) {
  if (!record(compiled?.plan) || !record(serialized) || typeof resolveAddress !== "function" || typeof approvalEvidence !== "function")
    throw new TypeError("An exact server-compiled generation plan is required for Braidy review.");
  const plan = compiled.plan;
  const byRef = new Map((plan.inputs?.references || []).map((row) => [text(row.refId), row]));
  const bindings = Array.isArray(serialized.bindings) ? serialized.bindings : [];
  const inputManifest = [];
  for (const binding of bindings) {
    const row = byRef.get(text(binding.refId));
    if (!row) throw new TypeError("The provider binding is absent from the compiled input manifest.");
    inputManifest.push(await manifestRow(binding, row, resolveAddress, approvalEvidence));
  }
  if (inputManifest.length !== byRef.size)
    throw new TypeError("The compiled references do not exactly match the provider bindings.");
  const target = {
    modelId: text(plan.model?.modelId), modelName: text(compiled.profile?.name || plan.model?.modelId), variant: text(plan.model?.variant), mode: text(plan.mode),
    modeName: ({ t2v: "Text to Video", i2v: "Image to Video", flf: "First and Last Frame", r2v: "Reference to Video", t2i: "Text to Image", blocking: "Blocking Frame", edit: "Image Edit", inpaint: "Inpaint", "multi-reference": "Multi-reference Image" })[text(plan.mode)] || text(plan.mode),
    outputType: text(plan.outputType), provider: "fal", endpoint: text(serialized.model),
    backendId: text(serialized.backendId),
    profile: { id: text(qualifiedProfile?.id), version: text(qualifiedProfile?.profileVersion),
      family: text(qualifiedProfile?.family), mode: text(qualifiedProfile?.mode) },
    playbookId: text(plan.compiler?.packId), playbookVersion: text(plan.compiler?.playbookVersion),
    compiler: { packId: text(plan.compiler?.packId), packVersion: text(plan.compiler?.packVersion),
      playbookVersion: text(plan.compiler?.playbookVersion), surface: text(plan.compiler?.surface) },
  };
  const context = {
    reviewKind: "exact-target-prompt-review-v1",
    target,
    deterministicCompiledPrompt: text(compiled.compiledPrompt),
    currentSubmittedTargetPrompt: text(currentSubmittedTargetPrompt),
    canonicalProductionIntent: canonicalIntent(sourceSpec),
    canonicalIntentBasis: "saved-build-structured-intent",
    sourceFreshness: { recorded: sourceFreshness?.recorded === true,
      current: sourceFreshness?.current === true, evidence: text(sourceFreshness?.evidence),
      reasons: Array.isArray(sourceFreshness?.reasons) ? sourceFreshness.reasons : [] },
    orderedBoundInputs: inputManifest,
    endpointBindings: Object.fromEntries(Object.entries(plan.endpoints || {})
      .map(([field, binding]) => [field, { refId: text(binding?.refId) }])),
    coverage: plan.coverage || [],
    warnings: plan.warnings || [],
    generationSettings: providerSettings(serialized),
    promptLimit: compiled.capability?.maxPromptCharacters != null && Number(compiled.capability.maxPromptCharacters) > 0 ? Number(compiled.capability.maxPromptCharacters) : null,
    output: Object.fromEntries(["durationSeconds", "fps", "audio", "candidateCount"]
      .filter((field) => plan.output?.[field] != null)
      .map((field) => [field, plan.output[field]])),
    playbook: qualifiedPromptPolicy(plan, qualifiedProfile),
  };
  const basisFingerprint = digest({ projectSlug: text(projectSlug), context, source: compiled.source,
    planVersion: plan.planVersion, compilerVersion: plan.compilerVersion, liveCanon });
  return {
    basisFingerprint, target, deterministicPrompt: context.deterministicCompiledPrompt,
    currentSubmittedTargetPrompt: context.currentSubmittedTargetPrompt,
    inputManifest, coverage: context.coverage, warnings: context.warnings,
    generationSettings: context.generationSettings, context,
  };
}

function packageFingerprint(basisFingerprint, submittedPrompt) {
  const basis = text(basisFingerprint), prompt = text(submittedPrompt);
  if (!/^[a-f0-9]{64}$/.test(basis) || !prompt) throw new TypeError("A current basis and nonempty package prompt are required.");
  return digest({ type: "braidy-target-package-v1", basisFingerprint: basis, submittedPrompt: prompt });
}

module.exports = { buildBraidyReviewBasis, packageFingerprint };

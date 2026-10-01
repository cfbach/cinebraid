/* Read-only exact-target Braidy routes. The fal plan routes own generation truth;
 * this adapter invokes their same compiler, serializer, settings and contained media
 * resolver. A proposal can only replace wording in a target package, never Canon. */
const path = require("path");
const Authority = require("../../public/shared-authority-kernel");
const Continuity = require("../../public/shared-continuity");
const BuildHistory = require("../../public/shared-build-history");
const MediaAssetService = require("../media/media-asset-service");
const PromptEngine = require("../generation/prompt-engine");
const { profileExecutionSupport } = require("../generation/generation-options");
const { compileH3ExecutionPlan, readSourceIntent: h3SourceIntent } = require("../generation/h3-execution");
const { compileImageExecutionPlan, readSourceIntent: imageSourceIntent } = require("../generation/image-execution");
const { serializeH3PlanForFal, FAL_H3_BACKEND } = require("../generation/fal/fal-h3-backend");
const { serializeImagePlanForFal, FAL_IMAGE_BACKEND } = require("../generation/fal/fal-image-backend");
const { checkPromptCoverage } = require("../generation/generation-compiler");
const { buildBraidyReviewBasis, packageFingerprint } = require("./braidy-target-review");
const { reviewPromptWithOpenAI, OpenAIPromptReviewError } = require("./openai-prompt-review");

function text(value) { return String(value == null ? "" : value).trim(); }
function isRecord(value) { return value && typeof value === "object" && !Array.isArray(value); }

class BraidyBasisError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

/* The shared build-history Canon witness is captured at compilation and
 * recomputed here. It excludes mutable prompt-history presentation fields,
 * so accepting an advisory target revision cannot stale its own source build. */
/* A plan's selected reference is not itself an approval. Cite the current
 * human receipt through the authority kernel, then tie it to the indexed asset
 * and bytes at the exact provider-bound address. Any missing or ambiguous link
 * remains unverified; Braidy cannot infer authority from a label or role. */
function approvalEvidenceFor(project, owner, shotId, sourceReferences, sourceBuild) {
  let assets = [];
  try {
    const result = MediaAssetService.readAssets(path.dirname(owner.dir), owner.slug);
    assets = Array.isArray(result.assets) ? result.assets : [];
  } catch { /* An unreadable ledger grants no approval. */ }
  const shot = (project.shots || []).find((item) => text(item?.id) === text(shotId));
  return (row, address, identity) => {
    const unverified = { approvalStatus: "unverified-current-receipt" };
    if (!address.file || identity.kind !== "local-file" || !/^[a-f0-9]{64}$/.test(text(identity.sha256)))
      return unverified;
    const relative = path.relative(owner.dir, address.file).replace(/\\/g, "/");
    if (!relative || relative === ".." || relative.startsWith("../") || path.isAbsolute(relative))
      return unverified;
    const matchedAssets = assets.filter((asset) => asset?.storage?.path === relative
      && asset.storage.missing !== true && asset.hashState === "hashed"
      && text(asset.contentHash) === "sha256:" + identity.sha256);
    if (matchedAssets.length !== 1) return unverified;
    const assetId = text(matchedAssets[0].assetId);
    const source = (sourceReferences || []).filter((item) => text(item.refId) === text(row.refId));
    if (!assetId || source.length !== 1
        || (text(row.source?.assetId) && text(row.source.assetId) !== assetId)
        || (text(row.source?.contentHash) && text(row.source.contentHash) !== text(matchedAssets[0].contentHash)))
      return unverified;
    const sourceBuildRefs = (sourceBuild?.references || []).filter((item) => text(item.key) === text(row.refId));
    if (sourceBuildRefs.length !== 1 || (text(sourceBuildRefs[0].approvedAssetId)
        && text(sourceBuildRefs[0].approvedAssetId) !== assetId)) return unverified;
    const filename = path.basename(address.file);
    const key = text(row.refId);
    let target = null;
    const frameKey = key.match(/^shot-(start|last):([^:]+):(.+)$/);
    const previousFrameKey = key.match(/^previous-frame:([^:]+):(.+)$/);
    const currentShotKey = key.match(/^shot-current:([^:]+):(.+)$/);
    const sequentialKey = key.match(/^h3-keyframe:([^:]+):([^:]+):(.+)$/);
    const entityKey = key.match(/^(characters|locations|props|vehicles|audio):([^:]+):([^:]+)$/);
    if (frameKey && shot && !text(source[0].entityId)
        && text(row.role) === (frameKey[1] === "start" ? "first-frame" : "last-frame")
        && frameKey[3] === filename
        && (shot.keyframes || []).some((frame) => text(frame?.id) === frameKey[2])) {
      target = { kind: "shot-frame", shotId: text(shot.id), frameId: frameKey[2] };
    } else if (previousFrameKey && shot && text(row.role) === "base"
        && text(source[0].entityId) === text(shot.id) && previousFrameKey[2] === filename) {
      const frames = shot.keyframes || [];
      const targetIndex = frames.findIndex((frame) => text(frame?.id) === text(sourceBuild?.frameId));
      if (targetIndex > 0 && text(frames[targetIndex - 1]?.id) === previousFrameKey[1])
        target = { kind: "shot-frame", shotId: text(shot.id), frameId: previousFrameKey[1] };
    } else if (currentShotKey && shot && text(row.role) === "base"
        && text(source[0].entityId) === text(shot.id)
        && currentShotKey[1] === text(shot.id) && currentShotKey[2] === filename
        && text(shot.keyframes?.[0]?.id)) {
      /* The current-shot edit base is only verified against its actual opening
       * frame receipt. A different winner at the same path cannot borrow it. */
      target = { kind: "shot-frame", shotId: text(shot.id), frameId: text(shot.keyframes[0].id) };
    } else if (sequentialKey && shot && text(row.role) === "sequential-keyframe"
        && sequentialKey[1] === text(shot.id) && sequentialKey[3] === filename
        && (shot.keyframes || []).some((frame) => text(frame?.id) === sequentialKey[2])) {
      target = { kind: "shot-frame", shotId: text(shot.id), frameId: sequentialKey[2] };
    } else if (entityKey && shot && text(source[0].entityId) === entityKey[2]) {
      const entity = (project[entityKey[1]] || []).find((item) => text(item?.id) === entityKey[2]);
      if (entity) {
        /* The key is a persistent SHOT slot, not always the frame's selected
         * state. Resolve frame > shot > default through the canonical binding
         * owner, then cite only that exact state receipt for these bound bytes. */
        const kind = { characters: "character", locations: "location",
          props: "prop", vehicles: "vehicle", audio: "audio" }[entityKey[1]];
        const slotId = Continuity.resolveDeclaredStateId(shot, "", kind, entityKey[2]);
        const slotState = Continuity.resolveStateRecord(entity, slotId);
        const keyedState = entityKey[3];
        const keyMatchesSlot = keyedState === text(slotState?.id)
          || (keyedState === "default" && (slotState?.isDefault || text(slotState?.id) === "state-default"));
        if (keyMatchesSlot) {
          const declaredId = Continuity.resolveDeclaredStateId(shot,
            text(sourceBuild?.frameId), kind, entityKey[2]);
          const state = Continuity.resolveStateRecord(entity, declaredId);
          if (text(state?.id))
            target = { kind: "entity-state", list: entityKey[1],
              entityId: entityKey[2], stateId: text(state.id) };
        }
      }
    }
    /* Do not look for any other state or frame whose approved bytes happen to
     * match. A missing exact target is an honest refusal, never inferred Canon. */
    if (!target) return unverified;
    const receipt = Authority.currentHumanAuthority(project, target);
    if (!receipt || text(receipt.assetId) !== assetId || text(receipt.value) !== filename)
      return unverified;
    return {
      approvalStatus: "current-receipt-verified",
      assetId,
      approvedFileName: filename,
      approvalReceiptId: text(receipt.id),
      approvalTarget: target,
      ledgerContentHash: text(matchedAssets[0].contentHash),
    };
  };
}
function registerBraidyReviewRoutes(app, deps) {
  const { captureOwner, ownerProject, activeSlug, config, readConfig, planReferenceAddress, savedImageSettings } = deps;
  if (![captureOwner, ownerProject, activeSlug, config, readConfig, planReferenceAddress, savedImageSettings].every((fn) => typeof fn === "function"))
    throw new TypeError("Braidy needs the existing fal generation context.");

  function validProfile(compiled) {
    const profile = PromptEngine.getProfile(text(compiled.profile?.id));
    const support = profile && profileExecutionSupport(profile);
    const qualification = support?.promptQualification || {};
    const plan = compiled.plan;
    if (!support?.dispatchable || qualification.status !== "qualified"
        || qualification.modelId !== plan.model?.modelId || qualification.surfaceId !== "fal-queue"
        || qualification.packId !== plan.compiler?.packId
        || qualification.packVersion !== plan.compiler?.packVersion
        || qualification.playbookVersion !== plan.compiler?.playbookVersion
        || text(profile.mode) !== text(plan.mode))
      throw new BraidyBasisError("BRAIDY_TARGET_UNQUALIFIED",
        "This exact generation model, mode and playbook are not currently qualified for Braidy review.", 409);
    return profile;
  }

  async function prepare(owner, body) {
    if (!isRecord(body)) throw new BraidyBasisError("BRAIDY_REQUEST_INVALID", "Choose a compiled target package to review.");
    const kind = text(body.kind);
    if (kind !== "h3" && kind !== "image")
      throw new BraidyBasisError("BRAIDY_TARGET_INVALID", "Choose an available video or image generation target.");
    const project = ownerProject(owner);
    const shotId = text(body.shotId), buildId = text(body.sourceBuildId);
    if (!shotId || !buildId)
      throw new BraidyBasisError("BRAIDY_BUILD_REQUIRED", "Build and select the exact shot prompt package first.");
    let compiled, source, serialized, qualifiedProfile;
    if (kind === "h3") {
      compiled = compileH3ExecutionPlan({ project, shotId, buildId,
        mode: text(body.profileMode), durationSeconds: body.durationSeconds,
        resolution: text(body.resolution || config().h3Resolution), aspectRatio: text(body.aspectRatio),
        /* No browser prompt is accepted as the deterministic baseline. */
      });
      source = h3SourceIntent(project, shotId, compiled.source.buildId).build;
      qualifiedProfile = validProfile(compiled);
      serialized = serializeH3PlanForFal(compiled.plan, compiled.capability, {
        resolveReference: (row) => { planReferenceAddress(owner, row); return "braidy-preflight"; }, config: config(),
      });
    } else {
      const purpose = text(body.purpose) === "blocking" ? "blocking" : "frame";
      compiled = compileImageExecutionPlan({ project, purpose, shotId, buildId,
        aspectRatio: text(body.aspectRatio), ...savedImageSettings(purpose, body),
        candidateCount: body.outputCount,
      });
      source = imageSourceIntent(project, shotId, compiled.source.buildId, purpose).build;
      qualifiedProfile = validProfile(compiled);
      serialized = serializeImagePlanForFal(compiled.plan, compiled.capability, {
        resolveReference: (row) => { planReferenceAddress(owner, row); return "braidy-preflight"; }, config: config(),
      });
    }
    const shot = (project.shots || []).find((row) => text(row?.id) === shotId);
    let freshness = BuildHistory.packageProjectFreshness(project, shot, source);
    if (!isRecord(source.dependencySnapshot?.canonContext))
      freshness = { current: false, recorded: false, evidence: "canon-context-untracked",
        reasons: ["this build predates exact project, scene, shot and entity Canon context tracking"] };
    if (kind === "image" && compiled.purpose === "blocking"
        && !isRecord(source.dependencySnapshot?.blockingInputs))
      freshness = { current: false, recorded: false, evidence: "blocking-inputs-untracked",
        reasons: ["this blocking build predates exact brief and layout input tracking"] };
    if (kind === "image" && compiled.purpose === "frame"
        && !isRecord(source.dependencySnapshot?.frameWorkflowInputs))
      freshness = { current: false, recorded: false, evidence: "frame-workflow-inputs-untracked",
        reasons: ["this frame build predates exact frame workflow input tracking"] };
    const expectedEndpoint = kind === "h3"
      ? FAL_H3_BACKEND.endpoints[compiled.mode]?.defaultModel
      : FAL_IMAGE_BACKEND.endpoints[compiled.mode]?.defaultModel;
    if (!expectedEndpoint || text(serialized.model) !== text(expectedEndpoint))
      throw new BraidyBasisError("BRAIDY_ENDPOINT_UNQUALIFIED",
        "The configured provider endpoint differs from the currently qualified exact model/mode endpoint. The deterministic generation path remains available.", 409);
    if (source.manualEdited && !text(source.prompt))
      throw new BraidyBasisError("BRAIDY_PROMPT_EMPTY", "This saved target revision has no prompt to review.", 422);
    const basis = await buildBraidyReviewBasis({ projectSlug: owner.slug, compiled,
      sourceSpec: source.spec, serialized, qualifiedProfile,
      currentSubmittedTargetPrompt: source.manualEdited ? text(source.prompt) : text(compiled.compiledPrompt),
      liveCanon: BuildHistory.packageCanonContextInputs(project, shot, source),
      sourceFreshness: freshness,
      resolveAddress: (row) => planReferenceAddress(owner, row),
      approvalEvidence: approvalEvidenceFor(project, owner, shotId, compiled.sourceReferences, source) });
    return { basis, compiled, source, serialized, project, projectSlug: owner.slug, kind, freshness };
  }

  function publicBasis(prepared, submittedPrompt) {
    const { basis, compiled, source } = prepared;
    const prompt = text(submittedPrompt) || basis.currentSubmittedTargetPrompt;
    const validation = validatePrompt(prepared, prompt);
    const editedCoverage = prompt !== basis.deterministicPrompt
      ? checkPromptCoverage({ spec: source.spec, references: compiled.sourceReferences,
        coverage: compiled.plan.coverage }, prompt)
      : null;
    return {
      ok: true,
      projectSlug: text(prepared.projectSlug),
      basisFingerprint: basis.basisFingerprint,
      packageFingerprint: packageFingerprint(basis.basisFingerprint, prompt),
      target: basis.target,
      source: compiled.source,
      sourceFreshness: prepared.freshness,
      deterministicPrompt: basis.deterministicPrompt,
      currentSubmittedTargetPrompt: basis.currentSubmittedTargetPrompt,
      savedBuildPrompt: text(source.prompt),
      submittedPrompt: prompt,
      sendable: validation.ok, sendRefusal: validation.refusal, editedCoverage,
      inputManifest: basis.inputManifest,
      coverage: basis.coverage,
      warnings: basis.warnings,
      generationSettings: basis.generationSettings,
    };
  }

  function validatePrompt(prepared, prompt) {
    const { compiled } = prepared;
    const serialize = prepared.kind === "image" ? serializeImagePlanForFal : serializeH3PlanForFal;
    try {
      serialize(compiled.plan, compiled.capability, {
        resolveReference: () => "braidy-preflight", config: config(), promptOverride: prompt,
      });
      return { ok: true, refusal: null };
    } catch (error) {
      return { ok: false, refusal: text(error?.message) || "This wording cannot be sent to the selected target." };
    }
  }

  function fail(res, error) {
    if (error instanceof BraidyBasisError)
      return res.status(error.status).json({ ok: false, code: error.code, error: error.message });
    if (error instanceof OpenAIPromptReviewError)
      return res.status(error.code === "OPENAI_CANCELLED" ? 499 : 502).json({ ok: false, code: error.code, error: error.message });
    const typed = /^(?:H3|IMAGE)_/.test(text(error?.code));
    if (typed) return res.status(Number(error.status) || 400).json({ ok: false, code: error.code, error: text(error.message) });
    return res.status(500).json({ ok: false, code: "BRAIDY_REVIEW_UNAVAILABLE", error: "Braidy could not prepare this exact target package." });
  }

  app.post("/api/assistant/braidy/basis", async (req, res) => {
    try {
      const owner = captureOwner();
      const prepared = await prepare(owner, req.body);
      prepared.projectSlug = owner.slug;
      const incoming = text(req.body?.baselineFingerprint);
      if (incoming && incoming !== prepared.basis.basisFingerprint)
        throw new BraidyBasisError("BRAIDY_BASIS_STALE", "This prompt package changed. Reopen Braidy review before applying a proposal.", 409);
      if (Object.hasOwn(req.body || {}, "submittedPrompt") && !text(req.body.submittedPrompt))
        throw new BraidyBasisError("BRAIDY_PROMPT_EMPTY", "An edited target package needs a nonempty prompt.", 422);
      const submitted = text(req.body?.submittedPrompt);
      if (submitted) {
        const validation = validatePrompt(prepared, submitted);
        if (!validation.ok)
          throw new BraidyBasisError("BRAIDY_PACKAGE_UNSENDABLE", validation.refusal, 422);
      }
      res.json(publicBasis(prepared, submitted));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/assistant/braidy/improve", async (req, res) => {
    const disconnect = new AbortController();
    const cancelled = () => { if (!res.writableEnded) disconnect.abort(); };
    res.once("close", cancelled);
    try {
      const owner = captureOwner();
      const project = ownerProject(owner);
      const policy = text(project.meta?.aiPolicy) || "project-default";
      if (policy === "disabled" || policy === "local-only")
        throw new BraidyBasisError("BRAIDY_PROJECT_POLICY", policy === "local-only"
          ? "This project is set to local-only AI; OpenAI review is unavailable. The deterministic package remains usable."
          : "AI assistance is disabled for this project. The deterministic package remains usable.", 403);
      const cfg = readConfig();
      if (text(cfg.assistant?.provider) !== "openai" || !text(cfg.openaiKey) || !text(cfg.openaiBraidyModel))
        throw new BraidyBasisError("BRAIDY_OPENAI_NOT_READY", "Choose OpenAI, save a key and select a Braidy review model in Settings. The deterministic package remains usable.", 400);
      const incoming = text(req.body?.baselineFingerprint);
      if (!/^[a-f0-9]{64}$/.test(incoming))
        throw new BraidyBasisError("BRAIDY_BASIS_REQUIRED", "Refresh the exact deterministic target package before asking Braidy to improve it.");
      const prepared = await prepare(owner, req.body);
      prepared.projectSlug = owner.slug;
      if (incoming !== prepared.basis.basisFingerprint)
        throw new BraidyBasisError("BRAIDY_BASIS_STALE", "This prompt package changed. Reopen Braidy review before applying a proposal.", 409);
      if (!prepared.freshness.recorded || !prepared.freshness.current)
        throw new BraidyBasisError("BRAIDY_BUILD_FRESHNESS_UNVERIFIED",
          prepared.freshness.recorded
            ? "This saved prompt build has changed production dependencies. Rebuild it before asking Braidy to improve the exact target."
            : prepared.freshness.evidence === "blocking-inputs-untracked"
            ? "This blocking build has no recorded brief and layout inputs. Rebuild it before asking Braidy to improve the exact target."
            : prepared.freshness.evidence === "frame-workflow-inputs-untracked"
            ? "This frame build has no recorded frame workflow inputs. Rebuild it before asking Braidy to improve the exact target."
            : prepared.freshness.evidence === "canon-context-untracked"
            ? "This prompt build has no recorded project, scene and entity Canon context. Rebuild it before asking Braidy to improve the exact target."
            : "This older prompt build has no dependency snapshot. Rebuild it before asking Braidy to improve the exact target.", 409);
      const currentPrompt = validatePrompt(prepared, prepared.basis.currentSubmittedTargetPrompt);
      if (!currentPrompt.ok)
        throw new BraidyBasisError("BRAIDY_PACKAGE_UNSENDABLE",
          "The saved target prompt cannot be sent to this exact model: " + currentPrompt.refusal, 422);
      if (prepared.basis.inputManifest.some((item) => item.approvalStatus !== "current-receipt-verified"))
        throw new BraidyBasisError("BRAIDY_INPUT_AUTHORITY_UNVERIFIED",
          "Braidy cannot verify a current approval receipt and exact byte identity for every bound input. The deterministic package remains available.", 409);
      const proposal = await reviewPromptWithOpenAI({ apiKey: cfg.openaiKey,
        model: cfg.openaiBraidyModel, context: prepared.basis.context, signal: disconnect.signal });
      if (disconnect.signal.aborted) return;
      /* The selected project, source package, settings, or input bytes may change
       * while the provider responds. A late proposal never wins over newer Canon. */
      if (activeSlug() !== owner.slug || readConfig().openaiBraidyModel !== cfg.openaiBraidyModel)
        throw new BraidyBasisError("BRAIDY_BASIS_STALE", "The project or selected Braidy model changed during review. Request a fresh proposal.", 409);
      const current = await prepare(owner, req.body);
      if (current.basis.basisFingerprint !== incoming)
        throw new BraidyBasisError("BRAIDY_BASIS_STALE", "The shot, target, settings, or input media changed during review. Request a fresh proposal.", 409);
      const validation = validatePrompt(current, proposal.proposedPrompt);
      const proposalCoverage = checkPromptCoverage({ spec: current.source.spec,
        references: current.compiled.sourceReferences,
        coverage: current.compiled.plan.coverage }, proposal.proposedPrompt);
      const coverageWarnings = proposalCoverage.lost.map((row) => `The proposal no longer explicitly carries ${row.label || row.intent}; review this omission before accepting.`);
      res.json({ ...publicBasis(current), proposal: {
        ...proposal,
        warnings: [...proposal.warnings, ...coverageWarnings],
        packageFingerprint: packageFingerprint(incoming, proposal.proposedPrompt),
        sendable: validation.ok, sendRefusal: validation.refusal,
        editedCoverage: proposalCoverage,
      } });
    } catch (error) { if (!disconnect.signal.aborted) fail(res, error); }
    finally { res.off("close", cancelled); }
  });
}

module.exports = { registerBraidyReviewRoutes, BraidyBasisError };

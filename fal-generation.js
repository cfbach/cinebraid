/* CineBraid v6.2 — optional server-side fal image generation.
   Manual copy/generate/return remains fully supported. */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parseAspectRatio } = require("./public/shared-aspect");

function registerFalGeneration(app, context) {
  const { readConfig, readProject, writeProject, projectDir } = context;

  function now() { return new Date().toISOString(); }
  function uid(prefix = "fal-job") {
    return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
  }
  function config() {
    const c = readConfig();
    const fal = c.generation?.fal || {};
    return {
      enabled: fal.enabled === true,
      apiKey: process.env.FAL_KEY || fal.apiKey || "",
      baseUrl: String(fal.baseUrl || "https://queue.fal.run").replace(/\/$/, ""),
      textModel: fal.textModel || "openai/gpt-image-2",
      editModel: fal.editModel || "openai/gpt-image-2/edit",
      blockingQuality: fal.blockingQuality || "low",
      frameQuality: fal.frameQuality || "high",
      blockingResolution: String(fal.blockingResolution || "1k").toLowerCase(),
      frameResolution: String(fal.frameResolution || "1k").toLowerCase(),
      blockingOutputs: clamp(fal.blockingOutputs, 2, 1, 4),
      frameOutputs: clamp(fal.frameOutputs, 2, 1, 4),
      maxConcurrent: clamp(fal.maxConcurrent, 1, 1, 2),
      requireConfirmation: fal.requireConfirmation !== false,
      estimatedCostPerImage: Math.max(0, Number(fal.estimatedCostPerImage) || 0),
      h3TextModel: fal.h3TextModel || "minimax/h3/text-to-video",
      h3ImageModel: fal.h3ImageModel || "minimax/h3/image-to-video",
      h3ReferenceModel: fal.h3ReferenceModel || "minimax/h3/reference-to-video",
      h3Resolution: ["768P", "2K"].includes(String(fal.h3Resolution || "2K").toUpperCase()) ? String(fal.h3Resolution || "2K").toUpperCase() : "2K",
    };
  }
  function clamp(value, fallback, min, max) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
  }
  function jobsFile() { return path.join(projectDir(), "generation-jobs.json"); }
  function readJobs() {
    try {
      const parsed = JSON.parse(fs.readFileSync(jobsFile(), "utf8"));
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  function writeJobs(jobs) {
    const file = jobsFile(), dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(jobs, null, 2), "utf8");
    fs.renameSync(temp, file);
  }
  function automationRunsFile() { return path.join(projectDir(), "automation-runs.json"); }
  function readAutomationRuns() {
    try {
      const parsed = JSON.parse(fs.readFileSync(automationRunsFile(), "utf8"));
      return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.runs) ? parsed.runs : [];
    } catch { return []; }
  }
  function automationSubmissionError(jobs, body, outputCount) {
    const runId = String(body?.automationRunId || "").trim();
    const stepKey = String(body?.automationStepKey || "").trim();
    if (!runId && !stepKey) return null;
    if (!runId || !stepKey) return { status: 400, message: "Automation generation requires both automationRunId and automationStepKey." };
    const run = readAutomationRuns().find((item) => String(item.id) === runId);
    if (!run) return { status: 409, message: "Automation run was not found. No paid request was submitted." };
    const maxImages = Number(run.config?.maxImages);
    if (!Number.isInteger(maxImages) || maxImages <= 0) return { status: 409, message: "Automation credit guard has no valid positive image cap. No paid request was submitted." };
    const runnerId = String(body?.automationRunnerId || "").trim();
    const leaseExpiry = Date.parse(run.leaseExpiresAt || "");
    if (!runnerId || runnerId !== String(run.runnerId || "") || !Number.isFinite(leaseExpiry) || leaseExpiry <= Date.now()) {
      return { status: 409, code: "LEASE_NOT_ACTIVE", message: "Automation lease is not active for this window. No paid request was submitted." };
    }
    const committed = jobs
      .filter((job) => job.automationRunId === runId)
      .reduce((sum, job) => sum + Math.max(0, Number(job.outputCount || 0)), 0);
    const reportedUsage = Math.max(0, Number(run.usage?.imagesGenerated || 0));
    const consumed = Math.max(committed, reportedUsage);
    if (consumed + outputCount > maxImages) return { status: 409, message: `Automation credit guard stopped the request before exceeding its ${maxImages}-image cap.` };
    return null;
  }
  function publicJob(job) {
    if (!job) return null;
    const copy = structuredClone(job);
    delete copy.providerRequest;
    return copy;
  }
  function safeName(value, fallback) {
    const clean = path.basename(String(value || fallback)).replace(/[^\w.\-]+/g, "_");
    return clean || fallback;
  }
  function nextFile(dir, requested) {
    const ext = path.extname(requested) || ".png";
    const stem = path.basename(requested, ext) || "output";
    let name = `${stem}${ext}`, i = 1;
    while (fs.existsSync(path.join(dir, name))) name = `${stem}_${++i}${ext}`;
    return name;
  }
  function localAssetFile(url) {
    const raw = String(url || "");
    if (!raw.startsWith("/assets/")) return "";
    const rel = decodeURIComponent(raw.slice("/assets/".length)).replace(/\\/g, "/");
    const allowed = /^(anchors|plates|props|vehicles|audio|media)\/[^/]+$/.test(rel) || /^shots\/[\w.-]+\/(takes|locked|blocking)\/[^/]+$/.test(rel);
    if (!allowed) throw new Error("Reference URL is outside CineBraid media storage.");
    const root = path.resolve(projectDir()), file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) throw new Error(`Reference file is missing: ${rel}`);
    return file;
  }
  function mimeFor(file) {
    const ext = path.extname(file).toLowerCase();
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".webp") return "image/webp";
    if (ext === ".gif") return "image/gif";
    if (ext === ".avif") return "image/avif";
    if (ext === ".mp4" || ext === ".m4v") return "video/mp4";
    if (ext === ".webm") return "video/webm";
    if (ext === ".mov") return "video/quicktime";
    if (ext === ".wav") return "audio/wav";
    if (ext === ".mp3") return "audio/mpeg";
    if (ext === ".m4a") return "audio/mp4";
    if (ext === ".ogg") return "audio/ogg";
    return "image/png";
  }
  function referenceInput(ref) {
    const url = String(ref?.url || "");
    if (/^(https?:|data:)/i.test(url)) return url;
    const file = localAssetFile(url);
    if (!file) throw new Error(`Reference ${ref?.label || ref?.key || "image"} has no usable URL.`);
    return `data:${mimeFor(file)};base64,${fs.readFileSync(file).toString("base64")}`;
  }
  function resolutionLongEdge(value) {
    const key = String(value || "1k").toLowerCase();
    if (key === "4k") return 4096;
    if (key === "2k") return 2048;
    return 1024;
  }
  function aspectSize(value, edit, resolution = "1k") {
    const ratio = String(value || "16:9").trim();
    /* Derived rather than looked up: the old eight-entry table had no 21:9 and no
       2.39:1, so an ultrawide or scope production silently generated 16:9 stills. Every
       entry the table used to hold falls inside the parser's believable range and so
       resolves to the identical pair; anything unparseable still lands on 16:9.
       The emission rule below is untouched — a mathematically exact ratio never earns an
       off-alignment pixel size. */
    const parsed = parseAspectRatio(ratio);
    const pair = parsed ? parsed.split(":").map(Number) : [16, 9];
    const longEdge = resolutionLongEdge(resolution);
    const landscape = pair[0] >= pair[1];
    const width = landscape ? longEdge : Math.round((longEdge * pair[0]) / pair[1]);
    const height = landscape ? Math.round((longEdge * pair[1]) / pair[0]) : longEdge;
    const even = (n) => Math.max(256, Math.round(n / 2) * 2);
    return { width: even(width), height: even(height) };
  }
  function activeCount(jobs) {
    return jobs.filter((job) => ["SUBMITTING", "IN_QUEUE", "IN_PROGRESS", "SUBMITTED"].includes(job.status)).length;
  }
  function normalizeError(data, status) {
    const detail = data?.detail;
    if (Array.isArray(detail)) return detail.map((row) => row?.msg || JSON.stringify(row)).join("; ");
    return detail?.message || detail || data?.error?.message || data?.error || data?.message || `fal request failed (${status})`;
  }
  function inferModelFamily(model) {
    const value = String(model || "").toLowerCase();
    if (!value) return "";
    if (value.includes("gpt-image-2")) return "gpt-image-2";
    if (value.includes("nano-banana")) return value.includes("pro") ? "nano-banana-pro" : "nano-banana-2";
    if (value.includes("flux")) return "flux-2";
    if (value.includes("krea")) return "krea-2";
    if (value.includes("seedream")) return "seedream-5-pro";
    if (value.includes("minimax/h3")) return "minimax-h3";
    return "";
  }
  function modelCompatibilityError(job, model) {
    const requestedFamily = String(job.profileFamily || "").trim();
    if (!requestedFamily) return "";
    const modelFamily = inferModelFamily(model);
    if (!modelFamily || modelFamily === requestedFamily) return "";
    return `Prompt profile ${job.profileName || job.profileId || requestedFamily} expects ${requestedFamily}, but the configured FAL endpoint ${model} behaves like ${modelFamily}. Switch the selected prompt adapter or the configured FAL endpoint so they match before submitting a paid request.`;
  }
  function h3ReferenceGroups(refs) {
    const groups = { image: [], video: [], audio: [] };
    for (const ref of refs || []) {
      const explicit = String(ref.mediaType || "").toLowerCase();
      const url = String(ref.url || "").toLowerCase().split(/[?#]/)[0];
      const kind = ["image", "video", "audio"].includes(explicit) ? explicit
        : /\.(mp4|mov|m4v|webm)$/.test(url) ? "video"
        : /\.(wav|mp3|m4a|ogg|aac|flac)$/.test(url) ? "audio" : "image";
      groups[kind].push(ref);
    }
    return groups;
  }
  async function submitH3(job, refs, cfg) {
    const mode = String(job.profileMode || job.mode || "i2v");
    const groups = h3ReferenceGroups(refs);
    let model = cfg.h3ImageModel;
    const input = {
      prompt: job.prompt,
      duration: clamp(job.durationSeconds, 5, 5, 15),
      resolution: ["768P", "2K"].includes(String(job.resolution || "").toUpperCase()) ? String(job.resolution).toUpperCase() : cfg.h3Resolution,
    };
    if (mode === "t2v") {
      model = cfg.h3TextModel;
      input.aspect_ratio = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"].includes(job.aspectRatio) ? job.aspectRatio : "16:9";
    } else if (mode === "i2v" || mode === "flf") {
      model = cfg.h3ImageModel;
      if (!groups.image.length) throw new Error("MiniMax H3 image-to-video requires an approved opening frame.");
      input.image_url = referenceInput(groups.image[0]);
      if (mode === "flf") {
        if (groups.image.length < 2) throw new Error("MiniMax H3 first/last-frame generation requires both approved endpoint images.");
        input.end_image_url = referenceInput(groups.image[1]);
      }
    } else {
      model = cfg.h3ReferenceModel;
      const total = groups.image.length + groups.video.length + groups.audio.length;
      if (!total) throw new Error("MiniMax H3 reference-to-video requires at least one image or video reference.");
      if (total > 12 || groups.image.length > 9 || groups.video.length > 3 || groups.audio.length > 3)
        throw new Error("MiniMax H3 reference package exceeds FAL limits: 12 total, up to 9 images, 3 videos, and 3 audio clips.");
      if (groups.audio.length && !groups.image.length && !groups.video.length)
        throw new Error("MiniMax H3 audio cannot be the only reference; add at least one image or video.");
      input.aspect_ratio = ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"].includes(job.aspectRatio) ? job.aspectRatio : "adaptive";
      if (groups.image.length) input.reference_image_urls = groups.image.map(referenceInput);
      if (groups.video.length) input.reference_video_urls = groups.video.map(referenceInput);
      if (groups.audio.length) input.reference_audio_urls = groups.audio.map(referenceInput);
    }
    const response = await fetch(`${cfg.baseUrl}/${model}`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Key ${cfg.apiKey}`, "X-Fal-No-Retry": "1" },
      body: JSON.stringify(input),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(normalizeError(data, response.status));
    return {
      model,
      modelFamily: "minimax-h3",
      providerRequest: { ...input, image_url: input.image_url ? "local-or-hosted-image" : undefined, end_image_url: input.end_image_url ? "local-or-hosted-image" : undefined, reference_image_urls: groups.image.map((ref) => ref.url), reference_video_urls: groups.video.map((ref) => ref.url), reference_audio_urls: groups.audio.map((ref) => ref.url) },
      externalId: data.request_id || "",
      statusUrl: data.status_url || "",
      responseUrl: data.response_url || "",
      cancelUrl: data.cancel_url || "",
      queuePosition: data.queue_position,
      status: "IN_QUEUE",
    };
  }
  async function submit(job, refs) {
    const cfg = config();
    if (job.profileFamily === "minimax-h3" || job.purpose === "motion-h3") return submitH3(job, refs, cfg);
    const edit = job.mode === "edit";
    const model = edit ? cfg.editModel : cfg.textModel;
    const compatibility = modelCompatibilityError(job, model);
    if (compatibility) throw new Error(compatibility);
    const input = {
      prompt: job.prompt,
      image_size: aspectSize(job.aspectRatio, edit, job.resolution),
      quality: job.quality,
      num_images: job.outputCount,
      output_format: "png",
    };
    if (edit) {
      if (!refs.length) throw new Error("The configured edit endpoint needs at least one input image.");
      input.image_urls = refs.slice(0, 16).map(referenceInput);
    }
    const response = await fetch(`${cfg.baseUrl}/${model}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Key ${cfg.apiKey}`,
        "X-Fal-No-Retry": "1",
      },
      body: JSON.stringify(input),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(normalizeError(data, response.status));
    return {
      model,
      modelFamily: inferModelFamily(model),
      providerRequest: { ...input, image_urls: edit ? refs.slice(0, 16).map((ref) => ref.url || "local-image") : undefined },
      externalId: data.request_id || "",
      statusUrl: data.status_url || "",
      responseUrl: data.response_url || "",
      cancelUrl: data.cancel_url || "",
      queuePosition: data.queue_position,
      status: "IN_QUEUE",
    };
  }
  function statusName(value) {
    const status = String(value || "").toUpperCase();
    if (status === "COMPLETED") return "COMPLETED";
    if (status === "IN_PROGRESS") return "IN_PROGRESS";
    if (status === "IN_QUEUE") return "IN_QUEUE";
    if (/CANCEL/.test(status)) return "CANCELLED";
    if (/FAIL|ERROR/.test(status)) return "FAILED";
    return status || "IN_QUEUE";
  }
  function resultAssets(data, job) {
    const source = data?.data || data || {};
    if (job?.profileFamily === "minimax-h3" || job?.purpose === "motion-h3") return source.video?.url ? [source.video] : [];
    return Array.isArray(source.images) ? source.images : [];
  }
  async function downloadOutput(asset, fallbackMime = "application/octet-stream") {
    if (!asset?.url) throw new Error("fal returned an output without a URL.");
    const response = await fetch(asset.url);
    if (!response.ok) throw new Error(`Could not download fal output (${response.status}).`);
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      mime: response.headers.get("content-type") || asset.content_type || fallbackMime,
      originalName: asset.file_name || path.basename(new URL(asset.url).pathname) || "fal-output",
      width: asset.width || 0,
      height: asset.height || 0,
    };
  }
  async function downloadImage(image) { return downloadOutput(image, "image/png"); }
  function newMediaLink(shotId, order) {
    return {
      id: uid("link"),
      targetType: "shot",
      targetId: shotId,
      role: "blocking-frame",
      order,
      priority: "supporting",
      generationInput: false,
      blockingState: "returned",
      blockingAdherence: "strict",
      blockingVersion: "",
    };
  }
  function entityTarget(job, project) {
    const allowed = { characters: "anchors", locations: "plates", props: "props", vehicles: "vehicles" };
    const list = String(job.entityList || "");
    const folder = allowed[list];
    if (!folder) throw new Error("Unsupported entity reference target.");
    const entity = (project[list] || []).find((item) => String(item.id) === String(job.entityId));
    if (!entity) throw new Error("Entity no longer exists.");
    return { list, folder, entity };
  }
  function updateEntityCoverageRun(job, status, error = "") {
    if (job?.purpose !== "entity-reference" || !job.entityList || !job.entityId) return;
    try {
      const project = readProject();
      const entity = (project[job.entityList] || []).find((item) => String(item.id) === String(job.entityId));
      if (!entity?.coverageAutomation) return;
      entity.coverageAutomation.status = status;
      entity.coverageAutomation.updatedAt = now();
      if (error) entity.coverageAutomation.error = String(error);
      if (["failed", "cancelled", "needs-attention"].includes(status)) entity.coverageAutomation.needsAttentionAt = now();
      writeProject(project);
    } catch {}
  }
  function entityRole(list) {
    return { characters: "character-reference", locations: "location-reference", props: "prop-reference", vehicles: "vehicle-reference" }[list] || "planning-reference";
  }
  async function ingestEntity(job, images, project) {
    const { list, folder, entity } = entityTarget(job, project);
    const dir = path.join(projectDir(), folder);
    fs.mkdirSync(dir, { recursive: true });
    entity.candidateFiles = Array.isArray(entity.candidateFiles) ? entity.candidateFiles : [];
    entity.generatedCandidates = Array.isArray(entity.generatedCandidates) ? entity.generatedCandidates : [];
    const outputs = [];
    for (let index = 0; index < images.length; index++) {
      const downloaded = await downloadImage(images[index]);
      const ext = downloaded.mime.includes("jpeg") ? ".jpg" : downloaded.mime.includes("webp") ? ".webp" : ".png";
      const name = nextFile(dir, safeName(`${entity.id}_FAL_CANDIDATE_${index + 1}${ext}`, `${entity.id}_FAL${ext}`));
      fs.writeFileSync(path.join(dir, name), downloaded.buffer);
      const provenance = {
        stored: name, original: downloaded.originalName, addedAt: now(), decision: "unreviewed",
        generationProvider: "fal", generationModel: job.model, generationJobId: job.id,
        generationRequestId: job.externalId, sourceBuildId: job.sourceBuildId || "",
        automationRunId: job.automationRunId || "", automationStepKey: job.automationStepKey || "",
        prompt: job.prompt, referenceCount: job.references.length, quality: job.quality, resolution: job.resolution, aspectRatio: job.aspectRatio,
        targetStateId: job.continuityStateId || "",
        targetStateName: job.continuityStateName || "",
        parentStateId: job.parentStateId || "",
        parentStateName: job.parentStateName || "",
        parentApprovedFile: job.parentApprovedFile || "",
        derivationMode: job.derivationMode || "independent",
        coverageJobType: job.coverageJobType || "",
        coverageSheetType: job.coverageSheetType || "",
        targetCoverageSlotId: job.targetCoverageSlotId || "",
        targetCoverageSlotName: job.targetCoverageSlotName || "",
        coverageSourceFile: job.coverageSourceFile || "",
        authorityContractVersion: job.authorityContractVersion || "",
        authorityManifest: (job.references || []).map((ref) => ({ token: ref.token || "", label: ref.label || "", role: ref.role || "", sourceFile: path.basename(String(ref.url || "").split("?")[0]) })),
      };
      entity.candidateFiles.push(provenance);
      entity.generatedCandidates.push({ ...provenance, role: entityRole(list) });
      outputs.push({ type: "entity-candidate", entityList: list, entityId: entity.id, continuityStateId: job.continuityStateId || "", continuityStateName: job.continuityStateName || "", name, url: `/assets/${folder}/${name}` });
    }
    if (!entity.workflowStatus || entity.workflowStatus === "DRAFT") entity.workflowStatus = "IN PROGRESS";
    if (!entity.status || entity.status === "NOT STARTED") entity.status = "IN PROGRESS";
    if (job.coverageJobType) {
      entity.coverageAutomation = entity.coverageAutomation && typeof entity.coverageAutomation === "object" ? entity.coverageAutomation : { list, entityId: entity.id, mode: job.coverageJobType === "sheet" ? "sheet" : "individual", sheetType: job.coverageSheetType || "angles", startedAt: job.createdAt || now(), jobs: [] };
      entity.coverageAutomation.jobs = Array.isArray(entity.coverageAutomation.jobs) ? entity.coverageAutomation.jobs : [];
      if (!entity.coverageAutomation.jobs.includes(job.id)) entity.coverageAutomation.jobs.push(job.id);
      const knownJobs = readJobs();
      const pending = knownJobs.filter((item) => entity.coverageAutomation.jobs.includes(item.id) && item.id !== job.id && !["COMPLETED", "FAILED", "CANCELLED"].includes(String(item.status || "").toUpperCase()));
      if (!pending.length) {
        entity.coverageAutomation.status = job.coverageJobType === "sheet" ? "sheet-ready-for-review" : "slot-candidates-ready";
        entity.coverageAutomation.readyAt = now();
      }
    }
    writeProject(project);
    job.outputs = outputs;
    job.ingestedAt = now();
    return job;
  }
  async function ingestMotion(job, assets, project) {
    if (job.ingestedAt) return job;
    const shot = (project.shots || []).find((item) => String(item.id) === String(job.shotId));
    if (!shot) throw new Error("Shot no longer exists.");
    const dir = path.join(projectDir(), "shots", shot.id, "takes");
    fs.mkdirSync(dir, { recursive: true });
    shot.candidateFiles = Array.isArray(shot.candidateFiles) ? shot.candidateFiles : [];
    const outputs = [];
    for (let index = 0; index < assets.length; index++) {
      const downloaded = await downloadOutput(assets[index], "video/mp4");
      const ext = downloaded.mime.includes("webm") ? ".webm" : downloaded.mime.includes("quicktime") ? ".mov" : ".mp4";
      const name = nextFile(dir, safeName(`${shot.id}_MOTION_H3_${index + 1}${ext}`, `${shot.id}_H3${ext}`));
      fs.writeFileSync(path.join(dir, name), downloaded.buffer);
      shot.candidateFiles.push({
        stored: name, original: downloaded.originalName, addedAt: now(), decision: "unreviewed", notes: "",
        labels: ["MiniMax H3", job.profileMode || "motion"], sourceBuildId: job.sourceBuildId || "",
        sourcePackageId: job.packageId || job.sourceBuildId || "", sourcePackageLabel: job.packageId || job.profileName || "MiniMax H3 generation",
        generationProvider: "fal", generationModel: job.model, generationJobId: job.id, generationRequestId: job.externalId,
        generationDuration: job.durationSeconds, generationResolution: job.resolution,
        generationAspectRatio: ["i2v", "flf"].includes(job.profileMode) ? "source image" : job.aspectRatio,
        generationProfileId: job.profileId, generationProfileMode: job.profileMode,
        generationReferenceManifest: (job.references || []).map((ref) => ({ token: ref.token, label: ref.label, role: ref.role, mediaType: ref.mediaType, url: ref.url })),
      });
      outputs.push({ type: "motion-candidate", name, url: `/assets/shots/${shot.id}/takes/${name}`, profileId: job.profileId, profileMode: job.profileMode });
    }
    shot.workflowStatus = "IN PROGRESS";
    shot.status = "BUILT";
    shot.reviewStatus = "PENDING";
    writeProject(project);
    job.outputs = outputs;
    job.ingestedAt = now();
    return job;
  }

  async function ingest(job, images) {
    if (job.ingestedAt) return job;
    const P = readProject();
    if (job.purpose === "motion-h3" || job.profileFamily === "minimax-h3") return ingestMotion(job, images, P);
    if (job.purpose === "entity-reference") return ingestEntity(job, images, P);
    const shot = (P.shots || []).find((item) => String(item.id) === String(job.shotId));
    if (!shot) throw new Error("Shot no longer exists.");
    const outputs = [];
    P.mediaAssets = Array.isArray(P.mediaAssets) ? P.mediaAssets : [];
    shot.candidateFiles = Array.isArray(shot.candidateFiles) ? shot.candidateFiles : [];
    for (let index = 0; index < images.length; index++) {
      const downloaded = await downloadImage(images[index]);
      const ext = downloaded.mime.includes("jpeg") ? ".jpg" : downloaded.mime.includes("webp") ? ".webp" : ".png";
      if (job.purpose === "blocking") {
        const dir = path.join(projectDir(), "shots", shot.id, "blocking");
        fs.mkdirSync(dir, { recursive: true });
        const name = nextFile(dir, safeName(`${shot.id}_BLOCKING_FAL_${index + 1}${ext}`, `${shot.id}_BLOCKING${ext}`));
        fs.writeFileSync(path.join(dir, name), downloaded.buffer);
        const link = newMediaLink(shot.id, P.mediaAssets.length + index);
        link.blockingFrameId = job.frameId || "";
        link.blockingVersion = `B${String((P.mediaAssets || []).filter((asset) => (asset.links || []).some((row) => row.targetType === "shot" && row.targetId === shot.id && row.role === "blocking-frame")).length + 1).padStart(2, "0")}`;
        const asset = {
          id: uid("blocking-media"),
          file: name,
          storagePath: `shots/${shot.id}/blocking/${name}`,
          originalName: downloaded.originalName,
          title: job.frameId ? `${shot.id} · Frame ${job.frameLabel || "?"} — FAL blocking ${index + 1}` : `${shot.id} — FAL blocking ${index + 1}`,
          kind: "image",
          notes: job.revisionRequest ? `Blocking revision request: ${job.revisionRequest}` : "Blocking frame — geometric planning scaffold, not visual canon.",
          provenance: job.packageId || job.sourceBuildId || "",
          generationRecord: {
            provider: "fal",
            model: job.model,
            requestId: job.externalId,
            jobId: job.id,
            automationRunId: job.automationRunId || "",
            automationStepKey: job.automationStepKey || "",
            prompt: job.prompt,
            packageId: job.packageId || "",
            sourceBuildId: job.sourceBuildId || "",
            revisedFromAssetId: job.revisedFromAssetId || "",
            requestedChanges: job.revisionRequest || "",
            quality: job.quality,
            resolution: job.resolution,
            date: now(),
          },
          createdAt: now(),
          links: [link],
        };
        P.mediaAssets.push(asset);
        outputs.push({ type: "blocking", assetId: asset.id, frameId: job.frameId || "", frameLabel: job.frameLabel || "", name, url: `/assets/${asset.storagePath}` });
      } else {
        const dir = path.join(projectDir(), "shots", shot.id, "takes");
        fs.mkdirSync(dir, { recursive: true });
        const frameLabel = job.frameLabel || "A";
        const correction = job.purpose === "correction";
        const stem = correction
          ? `${shot.id}_FRAME_${frameLabel}_CORRECTION_FAL_${index + 1}${ext}`
          : `${shot.id}_FRAME_${frameLabel}_FAL_${index + 1}${ext}`;
        const name = nextFile(dir, safeName(stem, `${shot.id}_FAL${ext}`));
        fs.writeFileSync(path.join(dir, name), downloaded.buffer);
        const candidate = {
          stored: name,
          original: downloaded.originalName,
          addedAt: now(),
          decision: "unreviewed",
          notes: "",
          labels: [],
          frameId: job.frameId || "",
          sourceBuildId: job.sourceBuildId || "",
          sourcePackageId: job.sourceBuildId || job.packageId || "",
          sourcePackageLabel: job.packageId || "FAL generation",
          generationProvider: "fal",
          generationModel: job.model,
          generationJobId: job.id,
          generationRequestId: job.externalId,
          automationRunId: job.automationRunId || "",
          automationStepKey: job.automationStepKey || "",
          generationQuality: job.quality,
          generationResolution: job.resolution,
        };
        if (correction) {
          candidate.correctionOf = job.sourceCandidate || "";
          candidate.correctionBuildId = job.sourceBuildId || "";
          candidate.correctionParentBuildId = job.parentBuildId || "";
          candidate.correctionParentPackageId = job.parentPackageId || "";
          candidate.correctionGuideAssetId = job.guideAssetId || "";
          candidate.correctionReferenceCount = job.references.length;
          candidate.correctionGeneratedAt = now();
          const source = shot.candidateFiles.find((item) => (item.stored || item.name) === job.sourceCandidate);
          if (source) {
            source.correctionResultNames = Array.isArray(source.correctionResultNames) ? source.correctionResultNames : [];
            source.correctionJobIds = Array.isArray(source.correctionJobIds) ? source.correctionJobIds : [];
            if (!source.correctionResultNames.includes(name)) source.correctionResultNames.push(name);
            if (!source.correctionJobIds.includes(job.id)) source.correctionJobIds.push(job.id);
          }
        }
        shot.candidateFiles.push(candidate);
        outputs.push({ type: "candidate", name, url: `/assets/shots/${shot.id}/takes/${name}`, frameId: job.frameId || "", correctionOf: job.sourceCandidate || "" });
      }
    }
    if (job.purpose === "frame" || job.purpose === "correction") {
      shot.workflowStatus = "IN PROGRESS";
      shot.status = "BUILT";
      shot.reviewStatus = "PENDING";
    }
    writeProject(P);
    job.outputs = outputs;
    job.ingestedAt = now();
    return job;
  }
  async function refresh(job) {
    const cfg = config();
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(job.status) && job.ingestedAt) return job;
    const statusResponse = await fetch(job.statusUrl, {
      headers: { Authorization: `Key ${cfg.apiKey}` },
    });
    const statusData = await statusResponse.json().catch(() => ({}));
    if (!statusResponse.ok) throw new Error(normalizeError(statusData, statusResponse.status));
    job.status = statusName(statusData.status);
    job.queuePosition = statusData.queue_position;
    job.logs = Array.isArray(statusData.logs) ? statusData.logs.slice(-12) : [];
    job.updatedAt = now();
    if (job.status === "COMPLETED" && !job.ingestedAt) {
      const resultResponse = await fetch(job.responseUrl || statusData.response_url, {
        headers: { Authorization: `Key ${cfg.apiKey}` },
      });
      const resultData = await resultResponse.json().catch(() => ({}));
      if (!resultResponse.ok) throw new Error(normalizeError(resultData, resultResponse.status));
      const assets = resultAssets(resultData, job);
      if (!assets.length) throw new Error(job.profileFamily === "minimax-h3" ? "fal completed the MiniMax H3 request but returned no video." : "fal completed the request but returned no images.");
      await ingest(job, assets);
    }
    return job;
  }

  app.get("/api/generation/fal/status", (req, res) => {
    const cfg = config();
    res.json({
      enabled: cfg.enabled,
      configured: !!cfg.apiKey,
      textModel: cfg.textModel,
      editModel: cfg.editModel,
      h3Models: { textToVideo: cfg.h3TextModel, imageToVideo: cfg.h3ImageModel, referenceToVideo: cfg.h3ReferenceModel },
      defaults: { blockingOutputs: cfg.blockingOutputs, frameOutputs: cfg.frameOutputs, blockingQuality: cfg.blockingQuality, frameQuality: cfg.frameQuality, blockingResolution: cfg.blockingResolution, frameResolution: cfg.frameResolution },
      keySource: process.env.FAL_KEY ? "environment" : cfg.apiKey ? "settings" : "none",
    });
  });
  app.get("/api/generation/fal/jobs", (req, res) => {
    const shotId = String(req.query.shotId || ""), entityId = String(req.query.entityId || ""), entityList = String(req.query.entityList || "");
    const jobs = readJobs().filter((job) => (!shotId || String(job.shotId) === shotId) && (!entityId || String(job.entityId) === entityId) && (!entityList || String(job.entityList) === entityList));
    res.json({ jobs: jobs.map(publicJob) });
  });
  app.post("/api/generation/fal/test", (req, res) => {
    const cfg = config();
    if (!cfg.enabled) return res.status(400).json({ error: "Enable FAL image generation first." });
    if (!cfg.apiKey) return res.status(400).json({ error: "Add a FAL API key or set FAL_KEY on the server." });
    res.json({ ok: true, message: "FAL is configured. The first generation will verify the key with fal.", textModel: cfg.textModel, editModel: cfg.editModel });
  });
  app.post("/api/generation/fal/jobs", async (req, res) => {
    const cfg = config();
    const jobs = readJobs();
    if (!cfg.enabled) return res.status(400).json({ error: "FAL generation is disabled in Settings." });
    if (!cfg.apiKey) return res.status(400).json({ error: "FAL API key is not configured." });
    const automationRunId = String(req.body?.automationRunId || "").trim();
    const automationStepKey = String(req.body?.automationStepKey || "").trim();
    if (automationRunId && automationStepKey) {
      const existing = jobs.find((item) => item.automationRunId === automationRunId && item.automationStepKey === automationStepKey);
      if (existing) return res.json({ ok: true, reused: true, job: publicJob(existing) });
    }
    const clientRequestId = String(req.body?.clientRequestId || "").trim();
    if (clientRequestId) {
      const existingByRequest = jobs.find((item) => String(item.clientRequestId || "") === clientRequestId);
      if (existingByRequest) return res.json({ ok: true, reused: true, job: publicJob(existingByRequest) });
    }
    const requestedEntityList = String(req.body?.entityList || "");
    const requestedEntityId = String(req.body?.entityId || "");
    const requestedCoverageJobType = String(req.body?.coverageJobType || "");
    const requestedCoverageSheetType = String(req.body?.coverageSheetType || "");
    const requestedCoverageSlotId = String(req.body?.targetCoverageSlotId || "");
    if (String(req.body?.purpose || "") === "entity-reference" && requestedEntityList && requestedEntityId && requestedCoverageJobType) {
      const duplicateActive = jobs.find((item) =>
        ["SUBMITTING", "IN_QUEUE", "IN_PROGRESS", "SUBMITTED"].includes(String(item.status || "").toUpperCase()) &&
        item.purpose === "entity-reference" &&
        String(item.entityList || "") === requestedEntityList &&
        String(item.entityId || "") === requestedEntityId &&
        String(item.coverageJobType || "") === requestedCoverageJobType &&
        String(item.coverageSheetType || "") === requestedCoverageSheetType &&
        String(item.targetCoverageSlotId || "") === requestedCoverageSlotId
      );
      if (duplicateActive) return res.json({ ok: true, reused: true, duplicatePrevented: true, job: publicJob(duplicateActive) });
    }
    if (activeCount(jobs) >= cfg.maxConcurrent) return res.status(409).json({ error: `FAL already has ${cfg.maxConcurrent} active CineBraid job${cfg.maxConcurrent === 1 ? "" : "s"}. Wait for completion or cancel it.` });
    const requestedPurpose = String(req.body?.purpose || "frame");
    const purpose = ["blocking", "frame", "correction", "entity-reference", "motion-h3"].includes(requestedPurpose) ? requestedPurpose : "frame";
    const requestedOutputCount = purpose === "motion-h3" ? 1 : clamp(req.body?.outputCount, purpose === "blocking" ? cfg.blockingOutputs : cfg.frameOutputs, 1, 4);
    const guardError = automationSubmissionError(jobs, req.body, requestedOutputCount);
    if (guardError) return res.status(guardError.status).json({ error: guardError.message, code: guardError.code || "AUTOMATION_GUARD" });
    const refs = Array.isArray(req.body?.references) ? req.body.references.filter((ref) => ref && ref.url) : [];
    const edit = refs.length > 0;
    const job = {
      id: uid(),
      automationRunId,
      automationStepKey,
      automationRunnerId: String(req.body?.automationRunnerId || "").trim(),
      clientRequestId,
      provider: "fal",
      kind: purpose === "motion-h3" ? "motion-generation" : purpose === "correction" ? "candidate-correction-generation" : purpose === "entity-reference" ? "entity-reference-generation" : "image-generation",
      purpose,
      profileMode: String(req.body?.profileMode || ""),
      mode: purpose === "motion-h3" ? String(req.body?.profileMode || "i2v") : edit ? "edit" : "text-to-image",
      shotId: String(req.body?.shotId || ""),
      entityList: String(req.body?.entityList || ""),
      entityId: String(req.body?.entityId || ""),
      entityType: String(req.body?.entityType || ""),
      continuityStateId: String(req.body?.continuityStateId || ""),
      continuityStateName: String(req.body?.continuityStateName || ""),
      parentStateId: String(req.body?.parentStateId || ""),
      parentStateName: String(req.body?.parentStateName || ""),
      parentApprovedFile: String(req.body?.parentApprovedFile || ""),
      derivationMode: req.body?.derivationMode === "derive" ? "derive" : "independent",
      frameId: String(req.body?.frameId || ""),
      frameLabel: String(req.body?.frameLabel || "A"),
      sourceBuildId: String(req.body?.sourceBuildId || ""),
      packageId: String(req.body?.packageId || ""),
      profileId: String(req.body?.profileId || ""),
      profileName: String(req.body?.profileName || ""),
      profileFamily: String(req.body?.profileFamily || ""),
      parentBuildId: String(req.body?.parentBuildId || ""),
      parentPackageId: String(req.body?.parentPackageId || ""),
      sourceCandidate: String(req.body?.sourceCandidate || ""),
      guideAssetId: String(req.body?.guideAssetId || ""),
      coverageJobType: ["sheet", "slot", ""].includes(String(req.body?.coverageJobType || "")) ? String(req.body?.coverageJobType || "") : "",
      coverageSheetType: String(req.body?.coverageSheetType || ""),
      targetCoverageSlotId: String(req.body?.targetCoverageSlotId || ""),
      targetCoverageSlotName: String(req.body?.targetCoverageSlotName || ""),
      coverageSourceFile: String(req.body?.coverageSourceFile || ""),
      authorityContractVersion: String(req.body?.authorityContractVersion || ""),
      prompt: String(req.body?.prompt || "").trim(),
      references: refs.slice(0, 16).map((ref, index) => ({
        key: ref.key || `image-${index + 1}`,
        token: ref.token || `#image${index + 1}`,
        originalToken: ref.originalToken || "",
        label: ref.label || `Image ${index + 1}`,
        role: ref.role || "reference",
        instruction: ref.instruction || "",
        mediaType: ["image", "video", "audio"].includes(String(ref.mediaType || "").toLowerCase()) ? String(ref.mediaType).toLowerCase() : "",
        url: ref.url,
      })),
      outputCount: requestedOutputCount,
      quality: ["low", "medium", "high", "auto"].includes(req.body?.quality) ? req.body.quality : purpose === "blocking" ? cfg.blockingQuality : cfg.frameQuality,
      resolution: purpose === "motion-h3" ? (["768P", "2K"].includes(String(req.body?.resolution || "").toUpperCase()) ? String(req.body.resolution).toUpperCase() : cfg.h3Resolution) : (["1k", "2k", "4k"].includes(String(req.body?.resolution || "").toLowerCase()) ? String(req.body.resolution).toLowerCase() : (purpose === "blocking" ? cfg.blockingResolution : cfg.frameResolution)),
      durationSeconds: purpose === "motion-h3" ? clamp(req.body?.durationSeconds, 5, 5, 15) : 0,
      aspectRatio: String(req.body?.aspectRatio || (purpose === "motion-h3" && String(req.body?.profileMode || "") === "r2v" ? "adaptive" : "16:9")),
      revisionRequest: String(req.body?.revisionRequest || "").trim(),
      revisedFromAssetId: String(req.body?.revisedFromAssetId || ""),
      createdAt: now(),
      updatedAt: now(),
      status: "SUBMITTING",
      outputs: [],
      error: "",
    };
    if (purpose === "motion-h3") {
      if (job.profileFamily !== "minimax-h3") return res.status(400).json({ error: "MiniMax H3 motion generation requires a minimax-h3 prompt profile." });
      if (!job.shotId) return res.status(400).json({ error: "shotId is required." });
      if (!["t2v", "i2v", "flf", "r2v"].includes(job.profileMode)) return res.status(400).json({ error: "Unsupported MiniMax H3 workflow mode." });
      if (!job.prompt) return res.status(400).json({ error: "Build a MiniMax H3 prompt before generating." });
      // The current fal queue OpenAPI schema enforces 2,000 characters even
      // though the launch guide describes a broader 7,000-character context.
      // Stop before a paid submission rather than relying on provider rejection.
      if (job.prompt.length > 2000) return res.status(400).json({ error: `MiniMax H3 prompt is ${job.prompt.length} characters; the current fal queue schema accepts at most 2,000. Rebuild or shorten the prompt before submitting.` });
      const groups = h3ReferenceGroups(job.references);
      if (job.profileMode === "i2v" && groups.image.length < 1) return res.status(400).json({ error: "MiniMax H3 image-to-video requires one approved opening frame." });
      if (job.profileMode === "flf" && groups.image.length < 2) return res.status(400).json({ error: "MiniMax H3 first/last-frame requires two approved endpoint images." });
      if (job.profileMode === "r2v" && groups.image.length + groups.video.length < 1) return res.status(400).json({ error: "MiniMax H3 reference-to-video requires at least one image or video reference." });
    } else if (purpose === "entity-reference") {
      if (!["characters", "locations", "props", "vehicles"].includes(job.entityList)) return res.status(400).json({ error: "A supported entityList is required." });
      if (!job.entityId) return res.status(400).json({ error: "entityId is required." });
      const project = readProject();
      const entity = (project[job.entityList] || []).find((item) => String(item.id) === job.entityId);
      if (!entity) return res.status(404).json({ error: "Entity no longer exists." });
      if (job.continuityStateId) {
        const state = (entity.continuityStates || []).find((item) => String(item?.id) === job.continuityStateId);
        if (!state) return res.status(400).json({ error: "Target continuity state no longer exists." });
        job.continuityStateName = job.continuityStateName || String(state.name || "State");
      }
      if (job.derivationMode === "derive" && (!job.references.length || job.references[0].role !== "base"))
        return res.status(400).json({ error: "Derived continuity-state generation requires the approved parent state as #image1 editable base." });
      if (job.derivationMode === "derive" && !job.parentApprovedFile)
        return res.status(400).json({ error: "Derived continuity-state generation requires parentApprovedFile provenance." });
    } else if (!job.shotId) return res.status(400).json({ error: "shotId is required." });
    if (!job.prompt) return res.status(400).json({ error: "Build a prompt before generating." });
    if (purpose === "correction" && (!job.references.length || job.references[0].role !== "base"))
      return res.status(400).json({ error: "Correction generation requires the failed candidate as #image1 editable base." });
    if (purpose === "correction" && !job.sourceCandidate) {
      const baseUrl = decodeURIComponent(String(job.references[0]?.url || "").split(/[?#]/)[0]);
      const parts = baseUrl.split("/").filter(Boolean), shotIndex = parts.indexOf("shots");
      if (shotIndex >= 0 && parts[shotIndex + 1] === job.shotId && parts[shotIndex + 2] === "takes" && parts[shotIndex + 3]) {
        job.sourceCandidate = path.basename(parts.slice(shotIndex + 3).join("/"));
        job.provenanceRecovered = true;
      }
    }
    if (purpose === "correction" && !job.sourceCandidate)
      return res.status(400).json({ error: "Correction generation requires sourceCandidate provenance and no safe editable-base filename could be recovered.", code: "SOURCE_CANDIDATE_REQUIRED" });
    jobs.push(job);
    writeJobs(jobs);
    try {
      Object.assign(job, await submit(job, job.references), { updatedAt: now() });
      writeJobs(jobs);
      res.json({ ok: true, job: publicJob(job) });
    } catch (error) {
      job.status = "FAILED";
      job.error = error.message;
      job.updatedAt = now();
      writeJobs(jobs);
      updateEntityCoverageRun(job, "needs-attention", error.message);
      res.status(502).json({ error: error.message, job: publicJob(job) });
    }
  });
  app.post("/api/generation/fal/jobs/:id/refresh", async (req, res) => {
    const jobs = readJobs(), job = jobs.find((item) => item.id === req.params.id);
    if (!job) return res.status(404).json({ error: "Generation job not found." });
    try {
      await refresh(job);
      writeJobs(jobs);
      res.json({ ok: true, job: publicJob(job) });
    } catch (error) {
      job.status = "FAILED";
      job.error = error.message;
      job.updatedAt = now();
      writeJobs(jobs);
      updateEntityCoverageRun(job, "needs-attention", error.message);
      res.status(502).json({ error: error.message, job: publicJob(job) });
    }
  });
  app.post("/api/generation/fal/jobs/:id/cancel", async (req, res) => {
    const cfg = config(), jobs = readJobs(), job = jobs.find((item) => item.id === req.params.id);
    if (!job) return res.status(404).json({ error: "Generation job not found." });
    if (job.cancelUrl && !["COMPLETED", "FAILED", "CANCELLED"].includes(job.status)) {
      await fetch(job.cancelUrl, { method: "PUT", headers: { Authorization: `Key ${cfg.apiKey}` } }).catch(() => null);
    }
    job.status = "CANCELLED";
    job.updatedAt = now();
    writeJobs(jobs);
    updateEntityCoverageRun(job, "cancelled", "Provider job cancelled by user.");
    res.json({ ok: true, job: publicJob(job) });
  });
}

module.exports = { registerFalGeneration };

const fs = require("fs");
const path = require("path");
const { SimpleZipWriter } = require("./zip-stream");
const { summarizeRecordedCost } = require("./generation-cost");
const Lifecycle = require("./generation-lifecycle");
const APP_VERSION = require("./package.json").version;

const MAX_TERMINAL_RUNS = 100;
const MAX_LOGS = 200;
const MAX_STEPS = 200;
const LEASE_MS = 5 * 60_000;
const HEARTBEAT_MS = 60_000;
const RUN_STATUSES = ["running", "interrupted", "awaiting-review", "completed", "failed", "cancelled", "archived"];
const STEP_STATUSES = ["pending", "running", "completed", "needs-review", "failed", "cancelled", "skipped"];
const ACTIVE_STATUSES = new Set(["running", "interrupted", "awaiting-review", "failed", "cancelled"]);

function now() { return new Date().toISOString(); }
function uid() { return `automation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`; }
function plainObject(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function cleanText(value, limit = 4000) { return String(value || "").slice(0, limit); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function leaseExpired(run, at = Date.now()) {
  const expiry = Date.parse(run?.leaseExpiresAt || "");
  return !run?.runnerId || !Number.isFinite(expiry) || expiry <= at;
}
function sanitizeLeaseDiagnostics(value, base = {}) {
  const source = plainObject(value);
  const prior = plainObject(base);
  return {
    lastRunnerId: cleanText(source.lastRunnerId || prior.lastRunnerId, 240),
    lastAcquiredAt: cleanText(source.lastAcquiredAt || prior.lastAcquiredAt, 80),
    lastHeartbeatAt: cleanText(source.lastHeartbeatAt || prior.lastHeartbeatAt, 80),
    lastExpiresAt: cleanText(source.lastExpiresAt || prior.lastExpiresAt, 80),
    lastPaidStepRevalidatedAt: cleanText(source.lastPaidStepRevalidatedAt || prior.lastPaidStepRevalidatedAt, 80),
    lastPaidStepKey: cleanText(source.lastPaidStepKey || prior.lastPaidStepKey, 240),
    lastReleasedAt: cleanText(source.lastReleasedAt || prior.lastReleasedAt, 80),
    lastReleaseReason: cleanText(source.lastReleaseReason || prior.lastReleaseReason, 240),
    lastFailureAt: cleanText(source.lastFailureAt || prior.lastFailureAt, 80),
    lastFailureCode: cleanText(source.lastFailureCode || prior.lastFailureCode, 120),
    lastFailureMessage: cleanText(source.lastFailureMessage || prior.lastFailureMessage, 1000),
    reacquireCount: Math.max(0, Number(source.reacquireCount ?? prior.reacquireCount ?? 0)),
  };
}

function registerAutomationRuns(app, deps) {
  const { projectDir, readProject, activeSlug, projectReadinessIssues } = deps;
  let lastReadWarning = "";
  function file() { return path.join(projectDir(), "automation-runs.json"); }
  function backupFile() { return `${file()}.bak`; }
  function parseRuns(target) {
    const parsed = JSON.parse(fs.readFileSync(target, "utf8"));
    return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.runs) ? parsed.runs : [];
  }
  function read() {
    const target = file();
    lastReadWarning = "";
    try {
      return parseRuns(target);
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      try {
        const recovered = parseRuns(backupFile());
        lastReadWarning = "automation-runs.json was unreadable; CineBraid loaded its backup copy.";
        return recovered;
      } catch {
        lastReadWarning = "automation-runs.json and its backup were unreadable. No run records were loaded.";
        return [];
      }
    }
  }
  function retainedRuns(runs) {
    const active = runs.filter((run) => ACTIVE_STATUSES.has(run.status) && run.status !== "archived");
    const terminal = runs.filter((run) => !active.includes(run)).slice(-MAX_TERMINAL_RUNS);
    return [...active, ...terminal].filter((run, index, list) => list.findIndex((item) => item.id === run.id) === index);
  }
  function write(runs) {
    const target = file();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}.tmp`;
    if (fs.existsSync(target)) fs.copyFileSync(target, backupFile());
    fs.writeFileSync(temp, JSON.stringify({ schemaVersion: 2, updatedAt: now(), runs: retainedRuns(runs) }, null, 2));
    fs.renameSync(temp, target);
  }
  function testFeedbackFile() { return path.join(projectDir(), "test-feedback.json"); }
  function readTestFeedback() {
    try {
      const parsed = JSON.parse(fs.readFileSync(testFeedbackFile(), "utf8"));
      return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.notes) ? parsed.notes : [];
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      return [];
    }
  }
  function writeTestFeedback(notes) {
    const target = testFeedbackFile();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ schemaVersion: 1, updatedAt: now(), notes: notes.slice(-200) }, null, 2));
    fs.renameSync(temp, target);
  }
  function approvedReferenceCount(project) {
    let count = 0;
    for (const list of ["characters", "locations", "props", "vehicles", "audio"]) {
      for (const entity of project?.[list] || []) {
        const files = new Set([
          entity?.approvedFile,
          ...(entity?.continuityStates || []).map((row) => row?.approvedFile),
          ...(entity?.coverageSlots || []).map((row) => row?.approvedFile),
          ...(entity?.expressionSlots || []).map((row) => row?.approvedFile),
        ].filter(Boolean).map(String));
        count += files.size;
      }
    }
    return count;
  }
  function testFeedbackProjectSummary(project) {
    const entityCount = ["characters", "locations", "props", "vehicles", "audio"]
      .reduce((total, list) => total + (Array.isArray(project?.[list]) ? project[list].length : 0), 0);
    let readiness = [];
    try { readiness = typeof projectReadinessIssues === "function" ? projectReadinessIssues(project) : []; }
    catch { readiness = []; }
    return {
      scenes: Array.isArray(project?.scenes) ? project.scenes.length : 0,
      shots: Array.isArray(project?.shots) ? project.shots.length : 0,
      entities: entityCount,
      approvedReferences: approvedReferenceCount(project),
      openReadinessIssues: readiness.length,
    };
  }
  function testFeedbackMarkdown(record) {
    return [
      "# CineBraid test note",
      "",
      `- Created: ${record.createdAt || "—"}`,
      `- App version: ${record.appVersion || APP_VERSION}`,
      `- Project: ${record.projectSlug || "—"}`,
      `- Route: ${record.route || "—"}`,
      `- Workflow emphasis: ${record.workflowEmphasis || "manual"}`,
      `- Project summary: ${Number(record.projectSummary?.shots || 0)} shots, ${Number(record.projectSummary?.entities || 0)} entities, ${Number(record.projectSummary?.approvedReferences || 0)} approved references, ${Number(record.projectSummary?.openReadinessIssues || 0)} open readiness issues`,
      "",
      "## Note",
      "",
      record.note || "",
      "",
    ].join("\n");
  }
  function sanitizeStep(value, key = "") {
    const source = plainObject(value);
    return {
      key: cleanText(source.key || key, 240),
      kind: cleanText(source.kind, 80),
      status: STEP_STATUSES.includes(source.status) ? source.status : "pending",
      operationKey: cleanText(source.operationKey || source.key || key, 240),
      label: cleanText(source.label, 500),
      attempt: Math.max(0, Number(source.attempt || 0)),
      retryCount: Math.max(0, Number(source.retryCount || 0)),
      maxAttempts: Math.max(0, Number(source.maxAttempts || 0)),
      buildId: cleanText(source.buildId, 240),
      packageId: cleanText(source.packageId, 240),
      childJobId: cleanText(source.childJobId, 240),
      frameId: cleanText(source.frameId, 240),
      stateId: cleanText(source.stateId, 240),
      files: Array.isArray(source.files) ? source.files.slice(0, 40).map((item) => cleanText(item, 500)) : [],
      winner: cleanText(source.winner, 500),
      score: Number.isFinite(Number(source.score)) ? Number(source.score) : null,
      pass: typeof source.pass === "boolean" ? source.pass : null,
      review: source.review && typeof source.review === "object" ? source.review : null,
      revision: cleanText(source.revision, 8000),
      result: source.result && typeof source.result === "object" ? source.result : null,
      activity: source.activity && typeof source.activity === "object" ? source.activity : null,
      error: cleanText(source.error, 4000),
      startedAt: cleanText(source.startedAt, 80),
      completedAt: cleanText(source.completedAt, 80),
      updatedAt: cleanText(source.updatedAt || now(), 80),
    };
  }
  function sanitizeRun(value, existing = null, options = {}) {
    const source = plainObject(value);
    const base = existing || {};
    const stepsSource = plainObject(source.steps || base.steps);
    const steps = {};
    for (const [key, step] of Object.entries(stepsSource).slice(0, MAX_STEPS)) steps[key] = sanitizeStep(step, key);
    const logsSource = Array.isArray(source.logs) ? source.logs : Array.isArray(base.logs) ? base.logs : [];
    const config = source.config && typeof source.config === "object" ? source.config : plainObject(base.config);
    const usage = source.usage && typeof source.usage === "object" ? source.usage : plainObject(base.usage);
    const status = RUN_STATUSES.includes(source.status) ? source.status : base.status || "running";
    const preservedUpdatedAt = options.preserveUpdatedAt ? cleanText(source.updatedAt || base.updatedAt || now(), 80) : now();
    return {
      schemaVersion: 2,
      revision: Math.max(1, Number(options.revision ?? source.revision ?? base.revision ?? 1)),
      id: cleanText(source.id || base.id || uid(), 240),
      type: cleanText(source.type || base.type, 80),
      targetId: cleanText(source.targetId || base.targetId, 240),
      scope: cleanText(source.scope || base.scope || "main", 240),
      label: cleanText(source.label || base.label, 500),
      mode: cleanText(source.mode || base.mode, 80),
      entityList: cleanText(source.entityList || base.entityList, 80),
      entityId: cleanText(source.entityId || base.entityId, 240),
      status,
      stage: cleanText(source.stage || base.stage || "Starting", 500),
      phase: cleanText(source.phase || base.phase, 120),
      summary: cleanText(source.summary || base.summary, 8000),
      current: source.current && typeof source.current === "object" ? source.current : plainObject(base.current),
      config,
      result: source.result && typeof source.result === "object" ? source.result : plainObject(base.result),
      feedback: source.feedback && typeof source.feedback === "object" ? source.feedback : plainObject(base.feedback),
      usage: {
        imageRequests: Math.max(0, Number(usage.imageRequests || 0)),
        imagesGenerated: Math.max(0, Number(usage.imagesGenerated || 0)),
        assistantCalls: Math.max(0, Number(usage.assistantCalls || 0)),
        reviewCalls: Math.max(0, Number(usage.reviewCalls || 0)),
      },
      steps,
      logs: logsSource.slice(-MAX_LOGS).map((entry) => ({
        at: cleanText(entry?.at || now(), 80),
        tone: ["info", "success", "warn", "error"].includes(entry?.tone) ? entry.tone : "info",
        message: cleanText(entry?.message, 4000),
      })),
      cancelRequested: source.cancelRequested === true,
      runnerId: cleanText(Object.prototype.hasOwnProperty.call(source, "runnerId") ? source.runnerId : base.runnerId, 240),
      leaseAcquiredAt: cleanText(Object.prototype.hasOwnProperty.call(source, "leaseAcquiredAt") ? source.leaseAcquiredAt : base.leaseAcquiredAt, 80),
      heartbeatAt: cleanText(Object.prototype.hasOwnProperty.call(source, "heartbeatAt") ? source.heartbeatAt : base.heartbeatAt, 80),
      leaseExpiresAt: cleanText(Object.prototype.hasOwnProperty.call(source, "leaseExpiresAt") ? source.leaseExpiresAt : base.leaseExpiresAt, 80),
      leaseDiagnostics: sanitizeLeaseDiagnostics(source.leaseDiagnostics, base.leaseDiagnostics),
      createdAt: cleanText(source.createdAt || base.createdAt || now(), 80),
      updatedAt: preservedUpdatedAt,
      completedAt: cleanText(source.completedAt || base.completedAt, 80),
      archivedAt: cleanText(source.archivedAt || base.archivedAt, 80),
    };
  }
  function publicRun(run) { return clone(sanitizeRun(run, run, { preserveUpdatedAt: true, revision: run.revision || 1 })); }
  function findRun(runs, id) { return runs.findIndex((item) => item.id === id); }
  function checkRevision(req, current, res) {
    const supplied = Number(req.body?.revision);
    if (!Number.isFinite(supplied) || supplied !== Number(current.revision || 1)) {
      res.status(409).json({ error: "automation run changed in another window", code: "STALE_RUN", run: publicRun(current) });
      return false;
    }
    return true;
  }
  function checkLease(req, current, res) {
    if (leaseExpired(current)) return true;
    const supplied = cleanText(req.body?.runnerId, 240);
    if (supplied && supplied === current.runnerId) return true;
    res.status(409).json({ error: "automation run is active in another CineBraid window", code: "RUN_LEASED", run: publicRun(current) });
    return false;
  }
  function bump(value, existing, extra = {}) {
    return sanitizeRun({ ...existing, ...plainObject(value), ...extra }, existing, { revision: Number(existing.revision || 1) + 1 });
  }


  function projectFile() { return path.join(projectDir(), "project.json"); }
  function readProjectSafe() {
    try { return JSON.parse(fs.readFileSync(projectFile(), "utf8")); }
    catch { return { meta: {}, scenes: [], shots: [], characters: [], locations: [], props: [], vehicles: [] }; }
  }
  function generationJobsFile() { return path.join(projectDir(), "generation-jobs.json"); }
  function readGenerationJobs() {
    try { const parsed = JSON.parse(fs.readFileSync(generationJobsFile(), "utf8")); return Array.isArray(parsed) ? parsed : []; }
    catch { return []; }
  }
  function approvedStillName(project, shotId) {
    const shot = (project.shots || []).find((item) => String(item.id) === String(shotId));
    const frame = (shot?.keyframes || [])[0] || null;
    return String(shot?.winner || frame?.winner || "").trim();
  }
  function sourceCandidateRecord(project, shotId, fileName) {
    const shot = (project.shots || []).find((item) => String(item.id) === String(shotId));
    return (shot?.candidateFiles || []).find((item) => String(item.stored || item.name || "") === String(fileName || "")) || null;
  }
  function correctionPackageIdFromStep(stepKey, step) {
    return cleanText(step?.packageId || String(stepKey || "").match(/^scene-correction:(.+?):round-/)?.[1], 240);
  }
  function repairSceneCorrectionProvenance(run, stepKey = "") {
    if (run.type !== "scene-chain") return { run, repaired: 0, message: "" };
    const project = readProjectSafe(), step = run.steps?.[stepKey] || null, packageId = correctionPackageIdFromStep(stepKey, step);
    const packageLists = [run.config?.initialCorrectionPackages, run.result?.correctionPackages].filter(Array.isArray);
    const repairedIds = new Set();
    for (const list of packageLists) {
      for (const pkg of list) {
        if (!pkg?.id || (packageId && pkg.id !== packageId)) continue;
        const source = approvedStillName(project, pkg.targetShotId);
        if (!source) throw new Error(`${pkg.targetShotId || "Correction target"} has no approved still available to repair sourceCandidate provenance.`);
        const record = sourceCandidateRecord(project, pkg.targetShotId, source);
        if (!pkg.sourceCandidate) repairedIds.add(pkg.id);
        pkg.sourceCandidate = pkg.sourceCandidate || source;
        pkg.approvedTargetFilename = pkg.approvedTargetFilename || source;
        pkg.targetFrameId = pkg.targetFrameId || ((project.shots || []).find((item) => item.id === pkg.targetShotId)?.keyframes || [])[0]?.id || "";
        pkg.sourceBuildId = pkg.sourceBuildId || record?.sourceBuildId || record?.sourcePackageId || pkg.id;
        pkg.sourcePackageId = pkg.sourcePackageId || record?.sourcePackageId || record?.sourceBuildId || pkg.id;
        pkg.parentBuildId = pkg.parentBuildId || record?.sourceBuildId || "";
        pkg.parentPackageId = pkg.parentPackageId || record?.sourcePackageId || "";
        pkg.provenanceStatus = "ready";
        pkg.provenanceRepairedAt = now();
      }
    }
    const repaired = repairedIds.size;
    if (repaired) {
      run.logs = [...(run.logs || []), { at: now(), tone: "success", message: `Server repaired sourceCandidate provenance for ${repaired} scene correction package${repaired === 1 ? "" : "s"}.` }].slice(-MAX_LOGS);
      run.summary = "Correction package provenance was repaired before retry. Completed work remains reusable.";
    }
    return { run, repaired, message: repaired ? `Repaired ${repaired} correction package${repaired === 1 ? "" : "s"}.` : "Correction package provenance already valid." };
  }
  function diagnosticCreativePath(pathParts) {
    return pathParts.some((part) => /^(?:prompt|prompts|revision|review|reviews|dialogue|description|summary|notes|note|rationale|criteria|instruction|instructions)$/i.test(String(part || "")));
  }
  function redactDiagnosticString(value, pathParts = []) {
    let text = String(value || "");
    text = text
      .replace(/(?:Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, "Bearer [REDACTED]")
      .replace(/([?&](?:api[_-]?key|key|token|access[_-]?token|refresh[_-]?token|signature|credential|auth|session)=)[^&#\s\"']+/gi, "$1[REDACTED]")
      .replace(/\b(api[-_ ]?key|token|credential|authorization|signature|session)\s*[:=]\s*[\"']?[A-Za-z0-9._~+\/-]{12,}[\"']?/gi, "$1=[REDACTED]")
      .replace(/\b(?:sk-[A-Za-z0-9_-]{20,}|fal_[A-Za-z0-9_-]{20,}|(?:eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}))\b/g, "[REDACTED_TOKEN]")
      .replace(/(^|[\s\"'\(])(?:[A-Za-z]:[\\/])[^\n\r\t\"']+/gm, "$1[LOCAL_PATH]")
      .replace(/\/(?:home|Users|opt|srv|var|mnt|tmp|root|etc|private)\/[^\n\r\t\"']+/g, "[LOCAL_PATH]");
    if (!diagnosticCreativePath(pathParts)) {
      text = text.replace(/(?<![A-Za-z0-9])(?=[A-Za-z0-9._~+\/-]{36,}(?![A-Za-z0-9]))(?=[A-Za-z0-9._~+\/-]*[A-Za-z])(?=[A-Za-z0-9._~+\/-]*[0-9])[A-Za-z0-9._~+\/-]+/g, "[REDACTED_TOKEN]");
    }
    return text;
  }
  function redactDiagnostic(value, key = "", pathParts = []) {
    const sensitive = /api[-_]?key|authorization|password|secret|access[-_]?token|refresh[-_]?token|cookie|fal_key|token|credential|auth|signature|session/i;
    if (sensitive.test(String(key))) return "[REDACTED]";
    const nextPath = key ? [...pathParts, key] : pathParts;
    if (Array.isArray(value)) return value.map((item, index) => redactDiagnostic(item, String(index), nextPath));
    if (value && typeof value === "object") {
      const out = {};
      for (const [name, item] of Object.entries(value)) out[name] = redactDiagnostic(item, name, nextPath);
      return out;
    }
    if (typeof value === "string") return redactDiagnosticString(value, nextPath);
    return value;
  }
  function relatedJobs(run) {
    const ids = new Set(Object.values(run.steps || {}).map((step) => step.childJobId).filter(Boolean));
    return readGenerationJobs().filter((job) => job.automationRunId === run.id || ids.has(job.id));
  }
  function normalizedReviewReason(text) {
    return String(text || "").toLowerCase().replace(/\b(candidate|round|image|shot|frame)\s*\d*\b/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 220);
  }
  function diagnosticAnalysis(run, jobs) {
    const steps = Object.values(run.steps || {}), generation = steps.filter((step) => step.kind === "generation"), reviews = steps.filter((step) => String(step.kind || "").includes("review"));
    /* Through the lifecycle module rather than field names guessed here: the ledger
       persists the provider's handle as `externalId`, and reading anything else made
       "was a paid request accepted" answerable only from status. */
    const accepted = jobs.filter((job) => Lifecycle.providerAcceptedRequest(job)).length;
    const repeated = new Map();
    for (const step of reviews) {
      const rows = Array.isArray(step.review?.reviews) ? step.review.reviews : [];
      for (const row of rows) {
        const reason = normalizedReviewReason(row.notes || step.revision || "");
        if (reason) repeated.set(reason, (repeated.get(reason) || 0) + 1);
      }
    }
    const repeatedReasons = [...repeated.entries()].filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([reason, count]) => ({ reason, count }));
    const passesUsed = Math.max(0, ...generation.map((step) => Number(step.attempt || 0)));
    const warnings = [];
    if (run.status === "failed" && accepted === 0) warnings.push("The run failed before a provider request was accepted; no paid FAL request appears in the diagnostic record.");
    if (passesUsed > 2) warnings.push(`The run reached generation pass ${passesUsed}; review prompt changes and reference priority for avoidable retries.`);
    if (repeatedReasons.length) warnings.push("The same review concern repeated across rounds, suggesting the revision prompt or reference authority was not strengthened enough.");
    if (Number(run.usage?.imagesGenerated || 0) > Math.max(3, Number(run.config?.outputsPerRequest || 3) * 2)) warnings.push("The run generated more than two candidate batches. Consider whether the first-round prompt or references were underspecified.");
    return { providerRequestsAccepted: accepted, generationSteps: generation.length, reviewSteps: reviews.length, highestPassUsed: passesUsed, repeatedReasons, warnings, classification: run.status === "completed" ? (warnings.length ? "passed_with_optimization_opportunities" : "passed") : accepted ? "failed_after_provider_acceptance" : "failed_before_provider_acceptance" };
  }
  function supportSummary(run, jobs = relatedJobs(run)) {
    const analysis = diagnosticAnalysis(run, jobs), failed = Object.values(run.steps || {}).find((step) => step.status === "failed");
    const lines = [
      `CineBraid ${APP_VERSION} support summary`,
      `Run: ${run.label || run.id}`,
      `ID: ${run.id}`,
      `Type: ${run.type} · Target: ${run.targetId}`,
      `Status: ${run.status} · Stage: ${run.stage || ""}`,
      `Images: ${run.usage?.imagesGenerated || 0} generated · ${run.usage?.imageRequests || 0} recorded requests`,
      `Provider requests accepted: ${analysis.providerRequestsAccepted}`,
      failed ? `Failed step: ${failed.label || failed.key}` : "",
      failed?.error ? `Error: ${failed.error}` : "",
      `Classification: ${analysis.classification}`,
      ...(analysis.warnings || []).map((item) => `Optimization note: ${item}`),
      run.feedback?.inefficient ? `User flagged inefficient: ${run.feedback.note || "No note supplied"}` : "",
    ].filter(Boolean);
    return lines.join("\n");
  }
  function diagnosticPayload(run) {
    const jobs = relatedJobs(run), analysis = diagnosticAnalysis(run, jobs), project = readProjectSafe();
    const targetShotIds = new Set();
    if (run.type === "shot-chain") targetShotIds.add(run.targetId);
    for (const step of Object.values(run.steps || {})) if (step.shotId || step.result?.targetShotId) targetShotIds.add(step.shotId || step.result.targetShotId);
    for (const pkg of [...(run.config?.initialCorrectionPackages || []), ...(run.result?.correctionPackages || [])]) if (pkg.targetShotId) targetShotIds.add(pkg.targetShotId);
    const shots = (project.shots || []).filter((shot) => targetShotIds.has(shot.id)).map((shot) => ({ id: shot.id, scene: shot.scene, title: shot.title, description: shot.desc || "", winner: shot.winner || "", keyframes: shot.keyframes || [], continuityStateSelections: shot.continuityStateSelections || {}, candidateFiles: shot.candidateFiles || [] }));
    const prompts = Object.values(run.steps || {}).filter((step) => step.result?.prompt || step.revision || step.buildId || step.packageId).map((step) => ({ key: step.key, label: step.label, buildId: step.buildId, packageId: step.packageId, prompt: step.result?.prompt || "", revision: step.revision || "" }));
    for (const pkg of [...(run.config?.initialCorrectionPackages || []), ...(run.result?.correctionPackages || [])]) {
      if (pkg?.prompt && !prompts.some((item) => item.packageId === pkg.id && item.prompt === pkg.prompt)) prompts.push({ key: `correction-package:${pkg.id}`, label: `${pkg.targetShotId || "Scene"} correction package`, buildId: pkg.sourceBuildId || "", packageId: pkg.id || "", prompt: pkg.prompt, revision: pkg.revision || "" });
    }
    const reviews = Object.values(run.steps || {}).filter((step) => step.review).map((step) => ({ key: step.key, label: step.label, attempt: step.attempt, files: step.files || [], winner: step.winner || "", score: step.score, pass: step.pass, review: step.review, revision: step.revision || "" }));
    const references = [...(run.config?.initialCorrectionPackages || []), ...(run.result?.correctionPackages || [])].map((pkg) => ({ packageId: pkg.id, targetShotId: pkg.targetShotId, sourceCandidate: pkg.sourceCandidate || "", referenceManifest: pkg.referenceManifest || [] }));
    /* Read from the jobs' own recorded estimates, never recomputed from current
       Settings, so reopening an old run reports what it was estimated to cost rather
       than what today's rate would re-quote it at. */
    const recordedCost = summarizeRecordedCost(jobs);
    return redactDiagnostic({ appVersion: APP_VERSION, exportedAt: now(), run, supportSummary: supportSummary(run, jobs), analysis, recordedCost, providerJobs: jobs, targetShots: shots, prompts, reviews, referenceManifest: references });
  }

  function runShotIds(run, project) {
    const known = new Set((project.shots || []).map((shot) => String(shot.id || "")));
    const ids = new Set();
    const add = (value) => { const id = String(value || ""); if (known.has(id)) ids.add(id); };
    add(run.type === "shot-chain" ? run.targetId : "");
    for (const step of Object.values(run.steps || {})) add(step.shotId || step.result?.targetShotId);
    for (const pkg of [...(run.config?.initialCorrectionPackages || []), ...(run.result?.correctionPackages || [])]) add(pkg?.targetShotId);
    return [...ids];
  }
  function projectOptimizationSummary(runs) {
    const allJobs = readGenerationJobs(), project = readProjectSafe();
    const statusCounts = {};
    const targetMap = new Map();
    const complaintMap = new Map();
    const shotMap = new Map();
    const feedback = [];
    let totalImages = 0, totalRequests = 0, totalAssistantCalls = 0, totalReviewCalls = 0, acceptedRequests = 0;
    /* Historical spend is SUMMED FROM WHAT THE JOBS RECORDED, never re-derived from
       the current per-image rate. Editing that rate in Settings changes what the next
       job is estimated at; it must not move a figure already on this screen. Jobs
       submitted before cost recording existed have no estimate and are counted as
       unrecorded rather than folded in at $0 or re-priced at today's number.

       Deduplicated by job id: a run claims a job either by `automationRunId` or by a
       step's `childJobId`, and one row reachable both ways from two runs would be
       added to the total twice. Counting a request's cost once is the whole job of a
       ledger total, so it does not rest on those two paths never overlapping. */
    const costJobs = [], costJobIds = new Set();
    let failedBeforeAcceptance = 0, failedAfterAcceptance = 0, humanApprovals = 0, reusedResults = 0, completedRuns = 0, firstPassCompletions = 0;
    const rows = [], timestamps = [];
    for (const run of runs) {
      statusCounts[run.status] = (statusCounts[run.status] || 0) + 1;
      totalImages += Number(run.usage?.imagesGenerated || 0);
      totalRequests += Number(run.usage?.imageRequests || 0);
      totalAssistantCalls += Number(run.usage?.assistantCalls || 0);
      totalReviewCalls += Number(run.usage?.reviewCalls || 0);
      for (const value of [run.createdAt, run.updatedAt, run.completedAt]) if (value && Number.isFinite(Date.parse(value))) timestamps.push(value);
      const ids = new Set(Object.values(run.steps || {}).map((step) => step.childJobId).filter(Boolean));
      const jobs = allJobs.filter((job) => job.automationRunId === run.id || ids.has(job.id));
      const analysis = diagnosticAnalysis(run, jobs);
      for (const job of jobs) if (!costJobIds.has(job.id)) { costJobIds.add(job.id); costJobs.push(job); }
      acceptedRequests += Number(analysis.providerRequestsAccepted || 0);
      if (analysis.classification === "failed_before_provider_acceptance") failedBeforeAcceptance++;
      if (analysis.classification === "failed_after_provider_acceptance") failedAfterAcceptance++;
      if (run.status === "completed") {
        completedRuns++;
        if (Number(analysis.highestPassUsed || 0) <= 1) firstPassCompletions++;
      }
      for (const step of Object.values(run.steps || {})) {
        if (step.result?.humanApproved === true) humanApprovals++;
        if (step.status === "skipped" || step.result?.reused === true || /reused/i.test(step.label || "")) reusedResults++;
      }
      for (const item of analysis.repeatedReasons || []) complaintMap.set(item.reason, (complaintMap.get(item.reason) || 0) + Number(item.count || 0));
      if (run.feedback?.inefficient) feedback.push({ runId: run.id, targetId: run.targetId, label: run.label, note: run.feedback.note || "No note supplied", updatedAt: run.feedback.updatedAt || run.updatedAt || "", warnings: analysis.warnings || [] });
      const target = targetMap.get(run.targetId) || { targetId: run.targetId, label: run.label || run.targetId, type: run.type, runs: 0, images: 0, requests: 0, reviews: 0, highestPassUsed: 0, failures: 0, completed: 0 };
      target.runs++;
      target.images += Number(run.usage?.imagesGenerated || 0);
      target.requests += Number(run.usage?.imageRequests || 0);
      target.reviews += Number(run.usage?.reviewCalls || 0);
      target.highestPassUsed = Math.max(target.highestPassUsed, Number(analysis.highestPassUsed || 0));
      if (run.status === "failed") target.failures++;
      if (run.status === "completed") target.completed++;
      targetMap.set(run.targetId, target);
      rows.push({ runId: run.id, targetId: run.targetId, label: run.label || run.targetId, type: run.type, status: run.status, images: Number(run.usage?.imagesGenerated || 0), requests: Number(run.usage?.imageRequests || 0), assistantCalls: Number(run.usage?.assistantCalls || 0), reviewCalls: Number(run.usage?.reviewCalls || 0), highestPassUsed: Number(analysis.highestPassUsed || 0), classification: analysis.classification, recordedCost: summarizeRecordedCost(jobs), warnings: analysis.warnings || [] });

      const shotIds = runShotIds(run, project), singleShotId = shotIds.length === 1 ? shotIds[0] : "";
      for (const shotId of shotIds) {
        const shot = (project.shots || []).find((item) => String(item.id) === shotId) || {};
        const scene = (project.scenes || []).find((item) => String(item.id) === String(shot.scene || "")) || {};
        const row = shotMap.get(shotId) || { shotId, title: shot.title || shotId, sceneId: shot.scene || "", sceneTitle: scene.title || "", runs: 0, roundsUsed: 0, candidatesGenerated: 0, approvals: 0, humanOverrides: 0, failures: 0 };
        row.runs++;
        let candidatesInSteps = 0, failedSteps = 0;
        for (const step of Object.values(run.steps || {})) {
          const stepShotId = String(step.shotId || step.result?.targetShotId || singleShotId || "");
          if (stepShotId !== shotId) continue;
          if (step.kind === "generation") {
            row.roundsUsed = Math.max(row.roundsUsed, Number(step.attempt || 0));
            const files = Array.isArray(step.files) ? step.files : Array.isArray(step.result?.files) ? step.result.files : Array.isArray(step.result?.candidates) ? step.result.candidates : [];
            candidatesInSteps += files.length;
          }
          const approved = step.result?.humanApproved === true || (String(step.kind || "").includes("approval") && step.status === "completed");
          if (approved) row.approvals++;
          if (step.result?.humanApproved === true) row.humanOverrides++;
          if (step.status === "failed") failedSteps++;
        }
        row.candidatesGenerated += candidatesInSteps || (singleShotId === shotId ? Number(run.usage?.imagesGenerated || 0) : 0);
        row.failures += failedSteps || (run.status === "failed" && singleShotId === shotId ? 1 : 0);
        row.roundsUsed = Math.max(row.roundsUsed, Number(analysis.highestPassUsed || 0));
        shotMap.set(shotId, row);
      }
    }
    const sortedTimes = timestamps.sort((a, b) => Date.parse(a) - Date.parse(b));
    return {
      appVersion: APP_VERSION,
      generatedAt: now(),
      dateRange: { start: sortedTimes[0] || "", end: sortedTimes.at(-1) || "" },
      runCount: runs.length,
      statusCounts,
      totals: { runs: runs.length, imagesGenerated: totalImages, recordedImageRequests: totalRequests, providerRequestsAccepted: acceptedRequests, assistantCalls: totalAssistantCalls, reviewCalls: totalReviewCalls, recordedCost: summarizeRecordedCost(costJobs) },
      quality: { completedRuns, firstPassCompletions, firstPassSuccessRate: completedRuns ? Math.round((firstPassCompletions / completedRuns) * 100) : 0, failedBeforeAcceptance, failedAfterAcceptance, humanApprovals, reusedResults },
      perShot: [...shotMap.values()].sort((a, b) => String(a.sceneId).localeCompare(String(b.sceneId)) || String(a.shotId).localeCompare(String(b.shotId))),
      highestEffortTargets: [...targetMap.values()].sort((a, b) => b.highestPassUsed - a.highestPassUsed || b.images - a.images).slice(0, 12),
      repeatedComplaints: [...complaintMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([reason, count]) => ({ reason, count })),
      inefficientFeedback: feedback.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 20),
      runs: rows,
    };
  }
  function productionSummaryPayload(runs) {
    const summary = projectOptimizationSummary(runs);
    return redactDiagnostic({
      appVersion: summary.appVersion,
      generatedAt: summary.generatedAt,
      dateRange: summary.dateRange,
      totals: summary.totals,
      perShot: summary.perShot,
      recurringReviewComplaints: summary.repeatedComplaints,
      inefficientRuns: summary.inefficientFeedback,
    });
  }
  function productionSummaryMarkdown(payload) {
    const line = (value) => String(value || "—");
    const out = [
      `# CineBraid production summary`,
      "",
      `- App version: ${line(payload.appVersion)}`,
      `- Generated: ${line(payload.generatedAt)}`,
      `- Date range: ${line(payload.dateRange?.start)} to ${line(payload.dateRange?.end)}`,
      "",
      "## Totals",
      "",
      `- Runs: ${Number(payload.totals?.runs || 0)}`,
      `- Images generated: ${Number(payload.totals?.imagesGenerated || 0)}`,
      `- Provider requests accepted: ${Number(payload.totals?.providerRequestsAccepted || 0)}`,
      `- Assistant calls: ${Number(payload.totals?.assistantCalls || 0)}`,
      `- Review calls: ${Number(payload.totals?.reviewCalls || 0)}`,
      "",
      "## Per shot",
      "",
      "| Shot | Scene | Runs | Rounds used | Candidates | Approvals | Human overrides | Failures |",
      "|---|---|---:|---:|---:|---:|---:|---:|",
      ...(payload.perShot || []).map((row) => `| ${line(row.shotId)} · ${line(row.title).replace(/\|/g, "\\|")} | ${line(row.sceneId)}${row.sceneTitle ? ` · ${line(row.sceneTitle).replace(/\|/g, "\\|")}` : ""} | ${Number(row.runs || 0)} | ${Number(row.roundsUsed || 0)} | ${Number(row.candidatesGenerated || 0)} | ${Number(row.approvals || 0)} | ${Number(row.humanOverrides || 0)} | ${Number(row.failures || 0)} |`),
      ...(payload.perShot || []).length ? [] : ["| No shot-linked runs recorded | — | 0 | 0 | 0 | 0 | 0 | 0 |"],
      "",
      "## Recurring review complaints",
      "",
      ...(payload.recurringReviewComplaints || []).map((row) => `- ${Number(row.count || 0)} × ${line(row.reason)}`),
      ...(payload.recurringReviewComplaints || []).length ? [] : ["No recurring complaint clusters recorded."],
      "",
      "## Runs flagged inefficient",
      "",
      ...(payload.inefficientRuns || []).map((row) => `- **${line(row.label || row.targetId)}** (${line(row.runId)}): ${line(row.note)}${row.warnings?.length ? ` — ${row.warnings.join("; ")}` : ""}`),
      ...(payload.inefficientRuns || []).length ? [] : ["No runs have been flagged inefficient."],
      "",
    ];
    return out.join("\n");
  }
  app.get("/api/automation/reports/summary", (req, res) => {
    const runs = read();
    res.json({ summary: projectOptimizationSummary(runs), warning: lastReadWarning });
  });
  app.get("/api/automation/reports/export", (req, res) => {
    const format = String(req.query?.format || "markdown").toLowerCase();
    if (!['markdown','json'].includes(format)) return res.status(400).json({ error: "Unknown export format. Accepted values: markdown, json" });
    const payload = productionSummaryPayload(read()), date = new Date().toISOString().slice(0, 10);
    if (format === "json") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="CineBraid-production-summary-${date}.json"`);
      return res.send(JSON.stringify(payload, null, 2));
    }
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="CineBraid-production-summary-${date}.md"`);
    res.send(productionSummaryMarkdown(payload));
  });
  app.get("/api/test-feedback", (req, res) => {
    res.json({ notes: readTestFeedback() });
  });
  app.post("/api/test-feedback", (req, res) => {
    try {
      const note = cleanText(req.body?.note, 4000).trim();
      if (!note) return res.status(400).json({ error: "A test note is required." });
      const project = typeof readProject === "function" ? readProject() : {};
      const record = redactDiagnostic({
        id: `test-note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: now(),
        appVersion: APP_VERSION,
        projectSlug: typeof activeSlug === "function" ? activeSlug() || "" : "",
        route: cleanText(req.body?.route, 1000),
        workflowEmphasis: project?.meta?.workflowEmphasis === "assisted" ? "assisted" : "manual",
        projectSummary: testFeedbackProjectSummary(project),
        note,
      });
      const notes = readTestFeedback();
      notes.push(record);
      writeTestFeedback(notes);
      res.status(201).json({ record, markdown: testFeedbackMarkdown(record) });
    } catch (error) {
      res.status(500).json({ error: error.message || "Could not save test note." });
    }
  });
  app.get("/api/test-feedback/:id/export", (req, res) => {
    const record = readTestFeedback().find((item) => item.id === req.params.id);
    if (!record) return res.status(404).json({ error: "test note not found" });
    const format = String(req.query?.format || "markdown").toLowerCase();
    if (!["markdown", "json"].includes(format)) return res.status(400).json({ error: "Unknown export format. Accepted values: markdown, json" });
    if (format === "json") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${record.id}.json"`);
      return res.send(JSON.stringify(redactDiagnostic(record), null, 2));
    }
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${record.id}.md"`);
    res.send(testFeedbackMarkdown(redactDiagnostic(record)));
  });
  app.get("/api/automation/runs/:id/report", (req, res) => {
    const run = read().find((item) => item.id === req.params.id);
    if (!run) return res.status(404).json({ error: "automation run not found" });
    res.json({ report: diagnosticPayload(run), warning: lastReadWarning });
  });
  app.get("/api/automation/runs", (req, res) => {
    const type = cleanText(req.query?.type, 80), targetId = cleanText(req.query?.targetId, 240);
    const runs = read().filter((run) => (!type || run.type === type) && (!targetId || run.targetId === targetId));
    if (String(req.query?.view || "") === "history") {
      const status = cleanText(req.query?.status, 80), target = cleanText(req.query?.target, 240);
      const targetOptions = [...new Map(runs.map((run) => [run.targetId, run.label || run.targetId])).entries()].filter(([id]) => id).map(([id, label]) => ({ id, label })).sort((a, b) => String(a.label).localeCompare(String(b.label)));
      const filtered = runs.filter((run) => (!status || run.status === status) && (!target || run.targetId === target)).sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
      const pageSize = Math.max(1, Math.min(100, Number(req.query?.pageSize || 50) || 50));
      const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
      const page = Math.max(0, Math.min(pages - 1, Number(req.query?.page || 0) || 0));
      const start = page * pageSize;
      return res.json({
        runs: filtered.slice(start, start + pageSize).map((run) => ({
          id: run.id, type: run.type, targetId: run.targetId, scope: run.scope, label: run.label, mode: run.mode,
          status: run.status, stage: run.stage, summary: run.summary, revision: run.revision,
          usage: run.usage || {}, feedback: run.feedback || {}, createdAt: run.createdAt, updatedAt: run.updatedAt,
          completedAt: run.completedAt, archivedAt: run.archivedAt,
        })),
        page, pages, pageSize, total: filtered.length, targetOptions, warning: lastReadWarning,
      });
    }
    res.json({ runs: runs.map(publicRun), warning: lastReadWarning });
  });
  app.get("/api/automation/runs/:id", (req, res) => {
    const run = read().find((item) => item.id === req.params.id);
    if (!run) return res.status(404).json({ error: "automation run not found" });
    res.json({ run: publicRun(run), warning: lastReadWarning });
  });

  app.get("/api/automation/runs/:id/support-summary", (req, res) => {
    const run = read().find((item) => item.id === req.params.id);
    if (!run) return res.status(404).json({ error: "automation run not found" });
    res.json(redactDiagnostic({ summary: supportSummary(run), analysis: diagnosticAnalysis(run, relatedJobs(run)) }));
  });
  app.get("/api/automation/runs/:id/diagnostic.zip", async (req, res) => {
    try {
      const run = read().find((item) => item.id === req.params.id);
      if (!run) return res.status(404).json({ error: "automation run not found" });
      const payload = diagnosticPayload(run), safeId = String(run.id || "automation-run").replace(/[^a-z0-9_.-]+/gi, "-");
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${safeId}-diagnostic.zip"`);
      const archive = new SimpleZipWriter(res);
      await archive.addBuffer("RUN_REPORT.md", payload.supportSummary + "\n\n## Analysis\n" + (payload.analysis.warnings || []).map((item) => `- ${item}`).join("\n") + "\n");
      await archive.addBuffer("RUN_REPORT.json", JSON.stringify(payload, null, 2));
      await archive.addBuffer("timeline.json", JSON.stringify(payload.run.steps || {}, null, 2));
      await archive.addBuffer("activity-log.json", JSON.stringify(payload.run.logs || [], null, 2));
      await archive.addBuffer("reference-manifest.json", JSON.stringify(payload.referenceManifest || [], null, 2));
      await archive.addBuffer("candidate-summary.json", JSON.stringify({ reviews: payload.reviews, providerJobs: payload.providerJobs.map((job) => ({ id: job.id, status: job.status, purpose: job.purpose, outputCount: job.outputCount, outputs: job.outputs || [], error: job.error || "" })) }, null, 2));
      await archive.addBuffer("environment.json", JSON.stringify({ appVersion: APP_VERSION, platform: process.platform, node: process.version, exportedAt: payload.exportedAt }, null, 2));
      for (let i = 0; i < payload.prompts.length; i++) await archive.addBuffer(`prompts/${String(i + 1).padStart(2, "0")}-${String(payload.prompts[i].key || "prompt").replace(/[^a-z0-9_.-]+/gi, "-")}.txt`, [payload.prompts[i].prompt, payload.prompts[i].revision].filter(Boolean).join("\n\nREVISION\n"));
      for (let i = 0; i < payload.reviews.length; i++) await archive.addBuffer(`reviews/${String(i + 1).padStart(2, "0")}-${String(payload.reviews[i].key || "review").replace(/[^a-z0-9_.-]+/gi, "-")}.json`, JSON.stringify(payload.reviews[i], null, 2));
      const imageNames = new Set(Object.values(run.steps || {}).flatMap((step) => step.files || []).filter((name) => /\.(png|jpe?g|webp)$/i.test(name)).slice(0, 24));
      for (const shot of payload.targetShots || []) {
        for (const name of imageNames) {
          const filePath = path.join(projectDir(), "shots", shot.id, "takes", path.basename(name));
          if (fs.existsSync(filePath) && fs.statSync(filePath).size <= 12 * 1024 * 1024) await archive.addFile(`candidate-images/${shot.id}/${path.basename(name)}`, filePath);
        }
      }
      await archive.finalize();
    } catch (error) {
      if (!res.headersSent) res.status(500).json({ error: error.message }); else res.destroy(error);
    }
  });
  app.post("/api/automation/runs/:id/feedback", (req, res) => {
    const runs = read(), index = findRun(runs, req.params.id);
    if (index < 0) return res.status(404).json({ error: "automation run not found" });
    const current = runs[index], feedback = { ...plainObject(current.feedback), inefficient: req.body?.inefficient === true, note: cleanText(req.body?.note, 4000), updatedAt: now() };
    runs[index] = bump({}, current, { feedback });
    write(runs);
    res.json({ run: publicRun(runs[index]) });
  });
  app.post("/api/automation/runs", (req, res) => {
    const runs = read();
    const incoming = sanitizeRun(req.body || {}, null, { revision: 1 });
    if (!incoming.type || !incoming.targetId) return res.status(400).json({ error: "type and targetId are required" });
    const existingIndex = findRun(runs, incoming.id);
    if (existingIndex >= 0) return res.status(409).json({ error: "automation run already exists", code: "RUN_EXISTS", run: publicRun(runs[existingIndex]) });
    runs.push(incoming);
    write(runs);
    res.status(201).json({ run: publicRun(incoming) });
  });
  app.put("/api/automation/runs/:id", (req, res) => {
    const runs = read(), index = findRun(runs, req.params.id);
    if (index < 0) return res.status(404).json({ error: "automation run not found" });
    const current = runs[index];
    if (!checkRevision(req, current, res) || !checkLease(req, current, res)) return;
    const body = plainObject(req.body);
    const merged = {
      ...current,
      ...body,
      id: current.id,
      createdAt: current.createdAt,
      steps: body.steps || current.steps,
      logs: body.logs || current.logs,
      cancelRequested: current.cancelRequested === true || body.cancelRequested === true,
      runnerId: current.runnerId || body.runnerId || "",
      leaseAcquiredAt: current.leaseAcquiredAt || body.leaseAcquiredAt || "",
      heartbeatAt: current.heartbeatAt || body.heartbeatAt || "",
      leaseExpiresAt: current.leaseExpiresAt || body.leaseExpiresAt || "",
      leaseDiagnostics: sanitizeLeaseDiagnostics(body.leaseDiagnostics, current.leaseDiagnostics),
    };
    runs[index] = bump(merged, current);
    write(runs);
    res.json({ run: publicRun(runs[index]) });
  });
  app.post("/api/automation/runs/:id/lease", (req, res) => {
    const runs = read(), index = findRun(runs, req.params.id);
    if (index < 0) return res.status(404).json({ error: "automation run not found" });
    const current = runs[index], runnerId = cleanText(req.body?.runnerId, 240);
    if (!runnerId) return res.status(400).json({ error: "runnerId is required" });
    if (!leaseExpired(current) && current.runnerId !== runnerId) {
      return res.status(409).json({ error: "automation run is active in another CineBraid window", code: "RUN_LEASED", run: publicRun(current) });
    }
    const at = now(), expires = new Date(Date.now() + LEASE_MS).toISOString();
    const sameRunner = current.runnerId === runnerId;
    runs[index] = bump({}, current, {
      status: "running",
      cancelRequested: false,
      runnerId,
      leaseAcquiredAt: sameRunner && current.leaseAcquiredAt ? current.leaseAcquiredAt : at,
      heartbeatAt: at,
      leaseExpiresAt: expires,
      leaseDiagnostics: sanitizeLeaseDiagnostics({
        lastRunnerId: runnerId,
        lastAcquiredAt: at,
        lastHeartbeatAt: at,
        lastExpiresAt: expires,
        reacquireCount: Number(current.leaseDiagnostics?.reacquireCount || 0) + (sameRunner ? 1 : 0),
      }, current.leaseDiagnostics),
    });
    write(runs);
    res.json({ run: publicRun(runs[index]), leaseMs: LEASE_MS, heartbeatMs: HEARTBEAT_MS });
  });
  app.post("/api/automation/runs/:id/heartbeat", (req, res) => {
    const runs = read(), index = findRun(runs, req.params.id);
    if (index < 0) return res.status(404).json({ error: "automation run not found" });
    const current = runs[index], runnerId = cleanText(req.body?.runnerId, 240);
    if (current.runnerId !== runnerId || leaseExpired(current)) {
      const at = now();
      runs[index] = sanitizeRun({ ...current, leaseDiagnostics: sanitizeLeaseDiagnostics({
        lastFailureAt: at,
        lastFailureCode: "LEASE_LOST",
        lastFailureMessage: "Heartbeat could not confirm the current browser lease.",
      }, current.leaseDiagnostics) }, current, { preserveUpdatedAt: true, revision: current.revision || 1 });
      write(runs);
      return res.status(409).json({ error: "automation run lease is no longer held", code: "LEASE_LOST", run: publicRun(runs[index]) });
    }
    const at = now(), expires = new Date(Date.now() + LEASE_MS).toISOString();
    current.heartbeatAt = at;
    current.leaseExpiresAt = expires;
    current.leaseDiagnostics = sanitizeLeaseDiagnostics({ lastRunnerId: runnerId, lastHeartbeatAt: at, lastExpiresAt: expires }, current.leaseDiagnostics);
    runs[index] = sanitizeRun(current, current, { preserveUpdatedAt: true, revision: current.revision || 1 });
    write(runs);
    res.json({ run: publicRun(runs[index]), leaseMs: LEASE_MS, heartbeatMs: HEARTBEAT_MS });
  });
  app.post("/api/automation/runs/:id/lease/revalidate", (req, res) => {
    const runs = read(), index = findRun(runs, req.params.id);
    if (index < 0) return res.status(404).json({ error: "automation run not found" });
    const current = runs[index], runnerId = cleanText(req.body?.runnerId, 240), stepKey = cleanText(req.body?.stepKey, 240);
    if (!runnerId) return res.status(400).json({ error: "runnerId is required" });
    if (current.cancelRequested) return res.status(409).json({ error: "automation stop was requested; no paid request was submitted", code: "RUN_CANCELLED", run: publicRun(current) });
    if (!leaseExpired(current) && current.runnerId !== runnerId) {
      const at = now();
      runs[index] = sanitizeRun({ ...current, leaseDiagnostics: sanitizeLeaseDiagnostics({
        lastFailureAt: at,
        lastFailureCode: "RUN_LEASED",
        lastFailureMessage: "Paid-step revalidation found another active browser lease.",
      }, current.leaseDiagnostics) }, current, { preserveUpdatedAt: true, revision: current.revision || 1 });
      write(runs);
      return res.status(409).json({ error: "automation run is active in another CineBraid window", code: "RUN_LEASED", run: publicRun(runs[index]) });
    }
    const at = now(), expires = new Date(Date.now() + LEASE_MS).toISOString();
    const reacquired = current.runnerId !== runnerId || leaseExpired(current);
    const acquiredAt = current.runnerId === runnerId && current.leaseAcquiredAt ? current.leaseAcquiredAt : at;
    runs[index] = sanitizeRun({
      ...current,
      status: "running",
      runnerId,
      leaseAcquiredAt: acquiredAt,
      heartbeatAt: at,
      leaseExpiresAt: expires,
      leaseDiagnostics: sanitizeLeaseDiagnostics({
        lastRunnerId: runnerId,
        lastAcquiredAt: reacquired ? at : current.leaseDiagnostics?.lastAcquiredAt || acquiredAt,
        lastHeartbeatAt: at,
        lastExpiresAt: expires,
        lastPaidStepRevalidatedAt: at,
        lastPaidStepKey: stepKey,
        reacquireCount: Number(current.leaseDiagnostics?.reacquireCount || 0) + (reacquired ? 1 : 0),
      }, current.leaseDiagnostics),
    }, current, { preserveUpdatedAt: true, revision: current.revision || 1 });
    write(runs);
    res.json({ run: publicRun(runs[index]), reacquired, leaseMs: LEASE_MS, heartbeatMs: HEARTBEAT_MS });
  });
  app.post("/api/automation/runs/:id/release", (req, res) => {
    const runs = read(), index = findRun(runs, req.params.id);
    if (index < 0) return res.status(404).json({ error: "automation run not found" });
    const current = runs[index], runnerId = cleanText(req.body?.runnerId, 240);
    if (current.runnerId && current.runnerId !== runnerId && !leaseExpired(current)) return res.status(409).json({ error: "automation run lease belongs to another window", code: "RUN_LEASED", run: publicRun(current) });
    const releasedAt = now(), reason = cleanText(req.body?.reason || "normal", 240);
    runs[index] = bump({}, current, {
      runnerId: "", leaseAcquiredAt: "", heartbeatAt: "", leaseExpiresAt: "",
      leaseDiagnostics: sanitizeLeaseDiagnostics({ lastReleasedAt: releasedAt, lastReleaseReason: reason }, current.leaseDiagnostics),
    });
    write(runs);
    res.json({ run: publicRun(runs[index]) });
  });
  app.post("/api/automation/runs/:id/cancel", (req, res) => {
    const runs = read(), index = findRun(runs, req.params.id);
    if (index < 0) return res.status(404).json({ error: "automation run not found" });
    runs[index] = bump({}, runs[index], {
      cancelRequested: true,
      summary: "Stop requested. The browser runner will pause at the next safe boundary; completed paid work remains reusable.",
    });
    write(runs);
    res.json({ run: publicRun(runs[index]) });
  });
  app.post("/api/automation/runs/:id/retry-step", (req, res) => {
    const runs = read(), index = findRun(runs, req.params.id);
    if (index < 0) return res.status(404).json({ error: "automation run not found" });
    let current = runs[index];
    const stepKey = cleanText(req.body?.stepKey || current.current?.stepKey, 240), step = current.steps?.[stepKey];
    if (!step) return res.status(400).json({ error: "failed step was not found" });
    try {
      const repaired = repairSceneCorrectionProvenance(clone(current), stepKey);
      current = repaired.run;
    } catch (error) {
      return res.status(409).json({ error: error.message, code: "CORRECTION_PROVENANCE_UNRECOVERABLE", run: publicRun(current) });
    }
    const steps = clone(current.steps || {}), next = { ...steps[stepKey], status: "pending", error: "", completedAt: "", updatedAt: now() };
    if (["generation", "scene-shot", "scene-correction", "scene-correction-review"].includes(next.kind)) {
      next.retryCount = Number(next.retryCount || 0) + 1;
    }
    if (next.kind === "generation") {
      next.childJobId = "";
      next.files = [];
      next.result = null;
    }
    steps[stepKey] = next;
    runs[index] = bump({}, current, { status: "interrupted", cancelRequested: false, stage: `Retry ready · ${next.label || stepKey}`, summary: "Only the selected failed step was reset. Completed steps remain preserved.", steps });
    write(runs);
    res.json({ run: publicRun(runs[index]) });
  });
  app.post("/api/automation/runs/:id/archive", (req, res) => {
    const runs = read(), index = findRun(runs, req.params.id);
    if (index < 0) return res.status(404).json({ error: "automation run not found" });
    runs[index] = bump({}, runs[index], { status: "archived", archivedAt: now(), stage: "Archived", runnerId: "", leaseAcquiredAt: "", heartbeatAt: "", leaseExpiresAt: "" });
    write(runs);
    res.json({ run: publicRun(runs[index]) });
  });

  return { readRuns: read, writeRuns: write, sanitizeRun, leaseExpired };
}

module.exports = { registerAutomationRuns };

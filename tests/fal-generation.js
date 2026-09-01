const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const { registerFalGeneration } = require("../fal-generation");
const Coverage = require("../public/shared-coverage.js");
const { addMotionPromptBuild } = require("./h3-execution-fixture");
const { declaredRequestInit } = require("./generation-request-fixture");

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5xkAAAAASUVORK5CYII=", "base64");
const MP4 = Buffer.from("00000018667479706d703432000000006d703432", "hex");

async function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}
function origin(server) {
  return `http://127.0.0.1:${server.address().port}`;
}
async function json(url, options = {}) {
  /* A suite that posts to the paid route is standing in for a dialog, and a dialog
     declares which surface and view it was. See tests/generation-request-fixture.js. */
  const response = await fetch(url, await declaredRequestInit(url, options));
  const data = await response.json();
  return { response, data };
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-fal-"));
  const projectDir = path.join(tmp, "project");
  fs.mkdirSync(path.join(projectDir, "shots", "S1", "blocking"), { recursive: true });
  fs.mkdirSync(path.join(projectDir, "shots", "S1", "takes"), { recursive: true });
  fs.mkdirSync(path.join(projectDir, "anchors"), { recursive: true });
  fs.mkdirSync(path.join(projectDir, "plates"), { recursive: true });
  fs.mkdirSync(path.join(projectDir, "props"), { recursive: true });
  fs.mkdirSync(path.join(projectDir, "vehicles"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, "shots", "S1", "blocking", "guide.png"), PNG);
  fs.writeFileSync(path.join(projectDir, "shots", "S1", "takes", "H3-A.png"), PNG);
  fs.writeFileSync(path.join(projectDir, "shots", "S1", "takes", "H3-B.png"), PNG);
  fs.writeFileSync(path.join(projectDir, "shots", "S1", "takes", "H3-C.png"), PNG);
  fs.writeFileSync(path.join(projectDir, "anchors", "LOCATION.png"), PNG);
  fs.writeFileSync(path.join(projectDir, "anchors", "CHAR-ONE-REFERENCE.png"), PNG);
  fs.writeFileSync(path.join(projectDir, "props", "PROP-ONE-DEFAULT.png"), PNG);
  fs.writeFileSync(path.join(projectDir, "vehicles", "VEH-REFERENCE.png"), PNG);
  const projectFile = path.join(projectDir, "project.json");
  const automationRunsFile = path.join(projectDir, "automation-runs.json");
  fs.writeFileSync(projectFile, JSON.stringify({
    meta: { title: "FAL Test", aspectRatio: "16:9" },
    characters: [{ id: "CHAR-ONE", name: "Character One", status: "NOT STARTED", workflowStatus: "DRAFT", candidateFiles: [] }],
    locations: [{ id: "LOC-ONE", name: "Location One", status: "NOT STARTED", workflowStatus: "DRAFT", candidateFiles: [] }],
    props: [{
      id: "PROP-ONE",
      name: "Prop One",
      status: "NOT STARTED",
      workflowStatus: "DRAFT",
      approvedFile: "PROP-ONE-DEFAULT.png",
      continuityStates: [
        { id: "state-default", name: "Default", isDefault: true, approvedFile: "PROP-ONE-DEFAULT.png", notes: "Clean prop." },
        { id: "state-damaged", name: "Damaged", isDefault: false, approvedFile: "", notes: "Dented corner and broken latch.", parentStateId: "state-default", generationMode: "derive" },
      ],
      candidateFiles: [],
    }],
    vehicles: [{ id: "VEH-ONE", name: "Vehicle One", status: "NOT STARTED", workflowStatus: "DRAFT", candidateFiles: [] }],
    shots: [{ id: "S1", candidateFiles: [], creationBrief: {} }],
    mediaAssets: [],
  }, null, 2));

  fs.writeFileSync(automationRunsFile, JSON.stringify({ schemaVersion: 2, runs: [{
    id: "run-durable-1", revision: 1, type: "shot-chain", targetId: "S1", scope: "stills", status: "running",
    config: { maxImages: 4 }, usage: { imagesGenerated: 0 }, steps: {}, logs: [], runnerId: "runner-fal-test",
    leaseExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }, {
    id: "run-no-cap", revision: 1, type: "shot-chain", targetId: "S1", scope: "stills", status: "running",
    config: { maxImages: 0 }, usage: { imagesGenerated: 0 }, steps: {}, logs: [], runnerId: "runner-fal-test",
    leaseExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }, {
    id: "run-scene-budget", revision: 1, type: "scene-chain", targetId: "SC1", scope: "stills", status: "running",
    config: { maxImages: 10 }, usage: { imagesGenerated: 9 }, steps: {}, logs: [], runnerId: "runner-fal-test",
    leaseExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }] }, null, 2));

  const providerCalls = [];
  const imageProviderCalls = () => providerCalls.filter((call) => !call.h3);
  const mock = express();
  mock.use(express.json({ limit: "25mb" }));
  let mockOrigin = "";
  mock.post(["/openai/gpt-image-2", "/openai/gpt-image-2/edit"], (req, res) => {
    const edit = req.path.endsWith("/edit");
    providerCalls.push({ edit, authorization: req.headers.authorization, body: req.body });
    const id = edit ? "edit-1" : "text-1";
    res.json({
      request_id: id,
      status_url: `${mockOrigin}/status/${id}`,
      response_url: `${mockOrigin}/result/${id}`,
      cancel_url: `${mockOrigin}/cancel/${id}`,
    });
  });
  mock.post(["/minimax/h3/text-to-video", "/minimax/h3/image-to-video", "/minimax/h3/reference-to-video"], (req, res) => {
    const id = `h3-${providerCalls.filter((call) => call.h3).length + 1}`;
    providerCalls.push({ h3: true, endpoint: req.path, authorization: req.headers.authorization, body: req.body });
    res.json({
      request_id: id,
      status_url: `${mockOrigin}/status/${id}`,
      response_url: `${mockOrigin}/result/${id}`,
      cancel_url: `${mockOrigin}/cancel/${id}`,
    });
  });
  mock.get("/status/:id", (req, res) => res.json({ status: "COMPLETED" }));
  mock.get("/result/:id", (req, res) => req.params.id.startsWith("h3-")
    ? res.json({ video: { url: `${mockOrigin}/video/${req.params.id}.mp4`, content_type: "video/mp4" } })
    : res.json({ images: [{ url: `${mockOrigin}/image/${req.params.id}.png`, width: 1, height: 1 }] }));
  mock.get("/image/:name", (req, res) => res.type("png").send(PNG));
  mock.get("/video/:name", (req, res) => res.type("video/mp4").send(MP4));
  mock.put("/cancel/:id", (req, res) => res.json({ ok: true }));
  const mockServer = await listen(mock);
  mockOrigin = origin(mockServer);

  const config = {
    generation: { fal: {
      enabled: true,
      apiKey: "fal-secret-test-key",
      baseUrl: mockOrigin,
      textModel: "openai/gpt-image-2",
      editModel: "openai/gpt-image-2/edit",
      h3TextModel: "minimax/h3/text-to-video",
      h3ImageModel: "minimax/h3/image-to-video",
      h3ReferenceModel: "minimax/h3/reference-to-video",
      h3Resolution: "2K",
      blockingOutputs: 1,
      frameOutputs: 1,
      blockingQuality: "low",
      frameQuality: "high",
      blockingResolution: "1k",
      frameResolution: "2k",
      maxConcurrent: 1,
      requireConfirmation: true,
    } },
  };
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  /* Generation no longer takes a zero-argument project directory: it captures an
     explicit slug before its first await so a project switch cannot redirect work
     that is already in flight. The fixture is a single project, so the resolver
     answers for that one slug and refuses any other. */
  const FIXTURE_SLUG = "fal-fixture";
  registerFalGeneration(app, {
    readConfig: () => JSON.parse(JSON.stringify(config)),
    readProject: (slug = FIXTURE_SLUG) => {
      if (slug !== FIXTURE_SLUG) throw new Error(`No such project: ${slug}`);
      return JSON.parse(fs.readFileSync(projectFile, "utf8"));
    },
    writeProject: (project, slug = FIXTURE_SLUG) => {
      if (slug !== FIXTURE_SLUG) throw new Error(`No such project: ${slug}`);
      fs.writeFileSync(projectFile, JSON.stringify(project, null, 2));
    },
    activeSlug: () => FIXTURE_SLUG,
    projectDirForSlug: (slug) => {
      if (slug !== FIXTURE_SLUG) throw new Error(`No such project: ${slug}`);
      return { slug, dir: projectDir, file: projectFile };
    },
  });
  const appServer = await listen(app);
  const appOrigin = origin(appServer);

  try {
    const status = await json(`${appOrigin}/api/generation/fal/status`);
    assert(status.response.ok);
    assert.strictEqual(status.data.configured, true);
    assert.strictEqual(JSON.stringify(status.data).includes("fal-secret-test-key"), false, "status must never expose the key");

    /* A live H3 request is compiled from the shot's durable motion package, so the
       package has to exist before the dispatch does. Posting a finished prompt string
       is no longer a way to originate one; that is asserted directly further down. */
    const h3Project0 = JSON.parse(fs.readFileSync(projectFile, "utf8"));
    const h3BuildId = addMotionPromptBuild(h3Project0, "S1", {
      mode: "r2v",
      durationSeconds: 10,
      aspectRatio: "16:9",
      references: [
        { key: "kf-1", label: "Opening", role: "sequential-keyframe", mediaType: "image", url: "/assets/shots/S1/takes/H3-A.png" },
        { key: "kf-2", label: "Middle", role: "sequential-keyframe", mediaType: "image", url: "/assets/shots/S1/takes/H3-B.png" },
        { key: "kf-3", label: "Ending", role: "sequential-keyframe", mediaType: "image", url: "/assets/shots/S1/takes/H3-C.png" },
      ],
    });
    fs.writeFileSync(projectFile, JSON.stringify(h3Project0, null, 2));

    const h3Submit = await json(`${appOrigin}/api/generation/fal/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purpose: "motion-h3",
        shotId: "S1",
        sourceBuildId: h3BuildId,
        profileId: "minimax-h3/multi-frame",
        profileName: "MiniMax H3 — Multi-Frame / Reference Video",
        profileFamily: "minimax-h3",
        profileMode: "r2v",
        durationSeconds: 10,
        resolution: "2K",
        aspectRatio: "16:9",
      }),
    });
    assert(h3Submit.response.ok, JSON.stringify(h3Submit.data));
    const h3Call = providerCalls.find((call) => call.h3);
    assert(h3Call, "H3 submission should reach the mocked provider");
    assert.strictEqual(h3Call.endpoint, "/minimax/h3/reference-to-video");
    assert.strictEqual(h3Call.body.reference_image_urls.length, 3);
    assert.strictEqual(h3Call.body.duration, 10);
    assert.strictEqual(h3Call.body.resolution, "2K");
    assert.strictEqual(h3Call.body.prompt, h3Submit.data.job.compilation.compiledPrompt,
      "the provider prompt is the compiled plan's, not a string the caller supplied");
    assert(h3Submit.data.job.compilation.plan.compiler.packId === "minimax-h3",
      "the durable job records which pack compiled it");
    const h3Refresh = await json(`${appOrigin}/api/generation/fal/jobs/${h3Submit.data.job.id}/refresh`, { method: "POST" });
    assert(h3Refresh.response.ok, JSON.stringify(h3Refresh.data));
    assert.strictEqual(h3Refresh.data.job.status, "COMPLETED");
    assert.strictEqual(h3Refresh.data.job.outputs[0].type, "motion-candidate");
    let h3Project = JSON.parse(fs.readFileSync(projectFile, "utf8"));
    const h3Candidate = h3Project.shots[0].candidateFiles.find((item) => item.generationJobId === h3Submit.data.job.id);
    assert(h3Candidate, "returned H3 video should become an unapproved shot candidate");
    assert.strictEqual(h3Candidate.generationProfileId, "minimax-h3/multi-frame");
    assert.strictEqual(h3Candidate.generationReferenceManifest.length, 3);

    const blockingSubmit = await json(`${appOrigin}/api/generation/fal/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ purpose: "blocking", shotId: "S1", frameId: "frame-a", frameLabel: "A", prompt: "Flat grayscale blocking frame.", outputCount: 1, quality: "low", aspectRatio: "16:9", sourceBuildId: "blocking-build-1" }),
    });
    assert(blockingSubmit.response.ok, JSON.stringify(blockingSubmit.data));
    assert.strictEqual(blockingSubmit.data.job.mode, "text-to-image");
    const blockingRefresh = await json(`${appOrigin}/api/generation/fal/jobs/${blockingSubmit.data.job.id}/refresh`, { method: "POST" });
    assert(blockingRefresh.response.ok, JSON.stringify(blockingRefresh.data));
    assert.strictEqual(blockingRefresh.data.job.status, "COMPLETED");
    assert.strictEqual(blockingRefresh.data.job.outputs[0].type, "blocking");
    assert.deepStrictEqual(imageProviderCalls()[0].body.image_size, { width: 1024, height: 576 }, "1K blocking requests should map to 1024-class dimensions");

    let project = JSON.parse(fs.readFileSync(projectFile, "utf8"));
    const blockingAsset = project.mediaAssets.find((asset) => asset.generationRecord?.jobId === blockingSubmit.data.job.id);
    assert(blockingAsset, "returned blocking output should become a media asset");
    assert(blockingAsset.storagePath.includes("/blocking/"));
    assert.strictEqual(blockingAsset.links[0].role, "blocking-frame");
    assert.strictEqual(blockingAsset.links[0].blockingState, "returned");
    assert.strictEqual(blockingAsset.links[0].blockingFrameId, "frame-a", "automation blocking outputs must retain their exact frame target");

    const callsBeforeIdempotent = providerCalls.length;
    const durableBody = { purpose: "frame", shotId: "S1", frameId: "frame-a", frameLabel: "A", prompt: "Durable automation frame.", outputCount: 1, quality: "high", aspectRatio: "16:9", automationRunId: "run-durable-1", automationStepKey: "frame:frame-a:round-1:generate", automationRunnerId: "runner-fal-test" };
    const durableSubmit = await json(`${appOrigin}/api/generation/fal/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(durableBody) });
    assert(durableSubmit.response.ok, JSON.stringify(durableSubmit.data));
    const durableDuplicate = await json(`${appOrigin}/api/generation/fal/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(durableBody) });
    assert(durableDuplicate.response.ok, JSON.stringify(durableDuplicate.data));
    assert.strictEqual(durableDuplicate.data.reused, true, "same durable operation key must reuse its existing paid job");
    assert.strictEqual(durableDuplicate.data.job.id, durableSubmit.data.job.id);
    assert.strictEqual(providerCalls.length, callsBeforeIdempotent + 1, "duplicate durable submission must not call the provider twice");
    const durableRefresh = await json(`${appOrigin}/api/generation/fal/jobs/${durableSubmit.data.job.id}/refresh`, { method: "POST" });
    assert(durableRefresh.response.ok, JSON.stringify(durableRefresh.data));
    assert.strictEqual(imageProviderCalls()[1].body.quality, "high", "automation frame requests should preserve the selected quality");
    assert.deepStrictEqual(imageProviderCalls()[1].body.image_size, { width: 2048, height: 1152 }, "automation frame requests should inherit the configured 2K resolution when the run sends its snapshot");
    project = JSON.parse(fs.readFileSync(projectFile, "utf8"));
    const durableCandidate = project.shots[0].candidateFiles.find((item) => item.generationJobId === durableSubmit.data.job.id);
    assert.strictEqual(durableCandidate.automationRunId, "run-durable-1", "automation provenance should remain attached to returned candidates");
    assert.strictEqual(durableCandidate.automationStepKey, "frame:frame-a:round-1:generate");

    const callsBeforeMissingCap = providerCalls.length;
    const missingCap = await json(`${appOrigin}/api/generation/fal/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...durableBody, automationRunId: "run-no-cap", automationStepKey: "frame:frame-a:no-cap" }) });
    assert.strictEqual(missingCap.response.status, 409, "automation paid requests must fail closed when the image cap is absent or zero");
    assert.strictEqual(providerCalls.length, callsBeforeMissingCap, "a missing credit cap must stop before provider submission");

    const callsBeforeSceneCap = providerCalls.length;
    const sceneCap = await json(`${appOrigin}/api/generation/fal/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...durableBody, outputCount: 3, automationRunId: "run-scene-budget", automationStepKey: "scene-correction:round-1", automationRunnerId: "runner-fal-test" }) });
    assert.strictEqual(sceneCap.response.status, 409, "parent scene usage must count against the total scene image cap before correction submission");
    assert.strictEqual(providerCalls.length, callsBeforeSceneCap, "scene budget rejection must stop before provider submission");

    const frameSubmit = await json(`${appOrigin}/api/generation/fal/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purpose: "frame",
        shotId: "S1",
        frameId: "frame-a",
        frameLabel: "A",
        prompt: "Edit #image1 into the production frame. Treat it as geometry only.",
        references: [{ key: "blocking:S1", label: "S1 guide", role: "composition", url: "/assets/shots/S1/blocking/guide.png" }],
        outputCount: 1,
        quality: "high",
        
        aspectRatio: "16:9",
        sourceBuildId: "frame-build-1",
        packageId: "pkg-frame-1",
      }),
    });
    assert(frameSubmit.response.ok, JSON.stringify(frameSubmit.data));
    assert.strictEqual(frameSubmit.data.job.mode, "edit");
    const frameRefresh = await json(`${appOrigin}/api/generation/fal/jobs/${frameSubmit.data.job.id}/refresh`, { method: "POST" });
    assert(frameRefresh.response.ok, JSON.stringify(frameRefresh.data));
    assert.strictEqual(frameRefresh.data.job.outputs[0].type, "candidate");
    assert.deepStrictEqual(imageProviderCalls()[2].body.image_size, { width: 2048, height: 1152 }, "frame requests should honor the configured 2K default resolution");

    project = JSON.parse(fs.readFileSync(projectFile, "utf8"));
    const candidate = project.shots[0].candidateFiles.find((item) => item.generationJobId === frameSubmit.data.job.id);
    assert(candidate, "returned production frame should enter the existing candidate flow");
    assert.strictEqual(candidate.sourceBuildId, "frame-build-1");
    assert.strictEqual(candidate.sourcePackageId, "frame-build-1", "candidate provenance should resolve through the canonical build ID");
    assert.strictEqual(candidate.sourcePackageLabel, "pkg-frame-1");
    assert.strictEqual(candidate.decision, "unreviewed");

    const correctionSubmit = await json(`${appOrigin}/api/generation/fal/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purpose: "correction",
        shotId: "S1",
        frameId: "frame-a",
        frameLabel: "A",
        prompt: "Edit #image1. Use #image2 for geometry only and #image3 for finished location design.",
        references: [
          { key: "candidate:S1", token: "#image1", label: "Candidate to correct", role: "base", url: `/assets/shots/S1/takes/${candidate.stored}` },
          { key: "guide:S1", token: "#image2", label: "Blocking guide", role: "composition", url: "/assets/shots/S1/blocking/guide.png" },
          { key: "location:S1", token: "#image3", originalToken: "#image2", label: "Approved location", role: "location", instruction: "Finished environment authority.", url: "/assets/anchors/LOCATION.png" },
        ],
        outputCount: 1,
        quality: "high",
        resolution: "4k",
        aspectRatio: "16:9",
        sourceBuildId: "correction-build-1",
        packageId: "pkg-correction-1",
        parentBuildId: "frame-build-1",
        parentPackageId: "pkg-frame-1",
        sourceCandidate: candidate.stored,
        guideAssetId: "guide-asset-1",
      }),
    });
    assert(correctionSubmit.response.ok, JSON.stringify(correctionSubmit.data));
    assert.deepStrictEqual(imageProviderCalls()[3].body.image_size, { width: 4096, height: 2304 }, "4K correction requests should map to 4096-class dimensions");
    assert.strictEqual(correctionSubmit.data.job.purpose, "correction");
    assert.strictEqual(correctionSubmit.data.job.kind, "candidate-correction-generation");
    assert.strictEqual(correctionSubmit.data.job.references[2].originalToken, "#image2");
    const correctionRefresh = await json(`${appOrigin}/api/generation/fal/jobs/${correctionSubmit.data.job.id}/refresh`, { method: "POST" });
    assert(correctionRefresh.response.ok, JSON.stringify(correctionRefresh.data));
    assert.strictEqual(correctionRefresh.data.job.outputs[0].correctionOf, candidate.stored);

    project = JSON.parse(fs.readFileSync(projectFile, "utf8"));
    const corrected = project.shots[0].candidateFiles.find((item) => item.generationJobId === correctionSubmit.data.job.id);
    assert(corrected, "returned correction should enter the existing candidate flow");
    assert.strictEqual(corrected.sourcePackageId, "correction-build-1");
    assert.strictEqual(corrected.sourcePackageLabel, "pkg-correction-1");
    assert.strictEqual(corrected.correctionOf, candidate.stored);
    assert.strictEqual(corrected.correctionParentBuildId, "frame-build-1");
    assert.strictEqual(corrected.correctionParentPackageId, "pkg-frame-1");
    assert.strictEqual(corrected.correctionReferenceCount, 3);
    const original = project.shots[0].candidateFiles.find((item) => item.stored === candidate.stored);
    assert(original.correctionResultNames.includes(corrected.stored), "original candidate should link to returned correction results");
    assert(original.correctionJobIds.includes(correctionSubmit.data.job.id), "original candidate should link to the correction job");

    const recoveredCorrection = await json(`${appOrigin}/api/generation/fal/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purpose: "correction",
        shotId: "S1",
        frameId: "frame-a",
        frameLabel: "A",
        prompt: "Edit #image1 while preserving all unaffected details.",
        references: [{ key: "candidate:S1", token: "#image1", label: "Approved target still", role: "base", url: `/assets/shots/S1/takes/${candidate.stored}` }],
        outputCount: 1,
        quality: "high",
        resolution: "1k",
        aspectRatio: "16:9",
        sourceBuildId: "recovered-correction-build",
        packageId: "recovered-correction-package",
      }),
    });
    assert(recoveredCorrection.response.ok, JSON.stringify(recoveredCorrection.data));
    assert.strictEqual(recoveredCorrection.data.job.sourceCandidate, candidate.stored, "server should safely recover sourceCandidate from the local editable-base URL");
    assert.strictEqual(recoveredCorrection.data.job.provenanceRecovered, true, "recovered provenance should be visible in the job record");
    const recoveredRefresh = await json(`${appOrigin}/api/generation/fal/jobs/${recoveredCorrection.data.job.id}/refresh`, { method: "POST" });
    assert(recoveredRefresh.response.ok, JSON.stringify(recoveredRefresh.data));

    const entityCases = [
      { entityList: "characters", entityId: "CHAR-ONE", entityType: "character", prompt: "Clean full-body character reference.", aspectRatio: "3:4" },
      { entityList: "locations", entityId: "LOC-ONE", entityType: "location", prompt: "Clear empty location master plate.", aspectRatio: "16:9" },
      { entityList: "props", entityId: "PROP-ONE", entityType: "prop", prompt: "Clean isolated prop reference.", aspectRatio: "4:3" },
      { entityList: "vehicles", entityId: "VEH-ONE", entityType: "vehicle", prompt: "Use #image1 as vehicle design authority and create a clean three-quarter reference.", aspectRatio: "4:3", references: [{ key: "vehicle-authority", label: "Approved vehicle view", role: "prop", url: "/assets/vehicles/VEH-REFERENCE.png" }] },
    ];
    const entityJobIds = [];
    for (const item of entityCases) {
      const submitted = await json(`${appOrigin}/api/generation/fal/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ purpose: "entity-reference", ...item, sourceBuildId: `asset-build-${item.entityId}`, outputCount: 1, quality: "high" }),
      });
      assert(submitted.response.ok, JSON.stringify(submitted.data));
      assert.strictEqual(submitted.data.job.kind, "entity-reference-generation");
      assert.strictEqual(submitted.data.job.shotId, "");
      assert.strictEqual(submitted.data.job.mode, item.references ? "edit" : "text-to-image");
      const refreshed = await json(`${appOrigin}/api/generation/fal/jobs/${submitted.data.job.id}/refresh`, { method: "POST" });
      assert(refreshed.response.ok, JSON.stringify(refreshed.data));
      assert.strictEqual(refreshed.data.job.outputs[0].type, "entity-candidate");
      assert.strictEqual(refreshed.data.job.outputs[0].entityList, item.entityList);
      entityJobIds.push(submitted.data.job.id);
    }


    const coverageSheetSubmit = await json(`${appOrigin}/api/generation/fal/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purpose: "entity-reference",
        entityList: "characters",
        entityId: "CHAR-ONE",
        entityType: "character",
        sourceBuildId: "coverage-sheet-build-CHAR-ONE",
        prompt: "Create one four-panel character angle sheet from #image1.",
        references: [{ key: "coverage-authority", label: "Approved character authority", role: "reference", url: "/assets/anchors/CHAR-ONE-REFERENCE.png" }],
        outputCount: 1,
        quality: "high",
        resolution: "4k",
        /* 3:4 — this posts to the PUBLIC route, where the entitled format is the entity
           list's own (referenceAspectLabel("characters")). A real angle sheet is 16:9, and
           it is dispatched through /api/generation/fal/coverage/jobs, whose server-built
           descriptor carries that format; no shipped dispatcher sends a sheet here. What
           this case is about is the sheet fields round-tripping onto the job, which they
           still do — the 16:9 it used to send was standing in for a screen that has not
           existed since the coverage route took over. */
        aspectRatio: "3:4",
        coverageJobType: "sheet",
        coverageSheetType: "angles",
        coverageSourceFile: "CHAR-ONE-REFERENCE.png",
        clientRequestId: "coverage-client-request-1",
      }),
    });
    assert(coverageSheetSubmit.response.ok, JSON.stringify(coverageSheetSubmit.data));
    assert.strictEqual(coverageSheetSubmit.data.job.coverageJobType, "sheet");
    assert.strictEqual(coverageSheetSubmit.data.job.coverageSheetType, "angles");
    const callsBeforeCoverageDuplicate = providerCalls.length;
    const coverageSheetDuplicate = await json(`${appOrigin}/api/generation/fal/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purpose: "entity-reference", entityList: "characters", entityId: "CHAR-ONE", entityType: "character",
        sourceBuildId: "coverage-sheet-build-CHAR-ONE", prompt: "Create one four-panel character angle sheet from #image1.",
        references: [{ key: "coverage-authority", label: "Approved character authority", role: "reference", url: "/assets/anchors/CHAR-ONE-REFERENCE.png" }],
        outputCount: 1, quality: "high", resolution: "4k", aspectRatio: "16:9",
        coverageJobType: "sheet", coverageSheetType: "angles", coverageSourceFile: "CHAR-ONE-REFERENCE.png",
        clientRequestId: "coverage-client-request-1",
      }),
    });
    assert(coverageSheetDuplicate.response.ok, JSON.stringify(coverageSheetDuplicate.data));
    assert.strictEqual(coverageSheetDuplicate.data.reused, true, "duplicate coverage request IDs must reuse the original paid job");
    assert.strictEqual(coverageSheetDuplicate.data.job.id, coverageSheetSubmit.data.job.id);
    assert.strictEqual(providerCalls.length, callsBeforeCoverageDuplicate, "duplicate coverage submissions must not call FAL twice");
    const coverageSheetRefresh = await json(`${appOrigin}/api/generation/fal/jobs/${coverageSheetSubmit.data.job.id}/refresh`, { method: "POST" });
    assert(coverageSheetRefresh.response.ok, JSON.stringify(coverageSheetRefresh.data));

    const stateDerivedSubmit = await json(`${appOrigin}/api/generation/fal/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purpose: "entity-reference",
        entityList: "props",
        entityId: "PROP-ONE",
        entityType: "prop",
        continuityStateId: "state-damaged",
        continuityStateName: "Damaged",
        parentStateId: "state-default",
        parentStateName: "Default",
        parentApprovedFile: "PROP-ONE-DEFAULT.png",
        derivationMode: "derive",
        sourceBuildId: "asset-state-build-PROP-ONE-damaged",
        prompt: "#image1 is the editable Default-state base. Apply only the Damaged state: dented corner and broken latch. Preserve all unaffected design details.",
        references: [{ key: "state-parent", label: "Default approved reference", role: "base", url: "/assets/props/PROP-ONE-DEFAULT.png" }],
        outputCount: 1,
        quality: "high",
        aspectRatio: "4:3",
      }),
    });
    assert(stateDerivedSubmit.response.ok, JSON.stringify(stateDerivedSubmit.data));
    assert.strictEqual(stateDerivedSubmit.data.job.mode, "edit");
    assert.strictEqual(stateDerivedSubmit.data.job.derivationMode, "derive");
    assert.strictEqual(stateDerivedSubmit.data.job.continuityStateId, "state-damaged");
    assert.strictEqual(stateDerivedSubmit.data.job.references[0].role, "base");
    const stateDerivedRefresh = await json(`${appOrigin}/api/generation/fal/jobs/${stateDerivedSubmit.data.job.id}/refresh`, { method: "POST" });
    assert(stateDerivedRefresh.response.ok, JSON.stringify(stateDerivedRefresh.data));
    assert.strictEqual(stateDerivedRefresh.data.job.outputs[0].continuityStateId, "state-damaged");

    project = JSON.parse(fs.readFileSync(projectFile, "utf8"));
    for (const item of entityCases) {
      const entity = project[item.entityList].find((row) => row.id === item.entityId);
      const candidate = entity.candidateFiles.find((row) => row.sourceBuildId === `asset-build-${item.entityId}`);
      assert(candidate, `${item.entityType} output should be stored as an entity candidate`);
      assert.strictEqual(candidate.decision, "unreviewed");
      assert.strictEqual(entity.approvedFile || "", item.entityList === "props" ? "PROP-ONE-DEFAULT.png" : "", "generated entity candidates must not change existing approval state");
      assert.strictEqual(entity.workflowStatus, "IN PROGRESS");
      assert(fs.existsSync(path.join(projectDir, { characters: "anchors", locations: "plates", props: "props", vehicles: "vehicles" }[item.entityList], candidate.stored)));
    }

    const coverageSheetCandidate = project.characters[0].candidateFiles.find((row) => row.generationJobId === coverageSheetSubmit.data.job.id);
    assert(coverageSheetCandidate, "coverage sheet output should be stored as an entity candidate");
    assert.strictEqual(coverageSheetCandidate.coverageJobType, "sheet");
    assert.strictEqual(coverageSheetCandidate.coverageSheetType, "angles");
    assert.strictEqual(coverageSheetCandidate.coverageSourceFile, "CHAR-ONE-REFERENCE.png");

    const damagedCandidate = project.props[0].candidateFiles.find((row) => row.generationJobId === stateDerivedSubmit.data.job.id);
    assert(damagedCandidate, "derived state output should be stored as an entity candidate");
    assert.strictEqual(damagedCandidate.targetStateId, "state-damaged");
    assert.strictEqual(damagedCandidate.targetStateName, "Damaged");
    assert.strictEqual(damagedCandidate.parentStateId, "state-default");
    assert.strictEqual(damagedCandidate.parentApprovedFile, "PROP-ONE-DEFAULT.png");
    assert.strictEqual(damagedCandidate.derivationMode, "derive");
    assert.strictEqual(project.props[0].continuityStates.find((state) => state.id === "state-damaged").approvedFile, "", "state generation must remain unapproved until a human assigns it");

    assert.strictEqual(providerCalls.length, 12);
    assert.strictEqual(imageProviderCalls().length, 11);
    assert.strictEqual(imageProviderCalls()[0].edit, false);
    assert.strictEqual(imageProviderCalls()[0].authorization, "Key fal-secret-test-key");
    assert.strictEqual(imageProviderCalls()[0].body.image_urls, undefined);
    assert.strictEqual(imageProviderCalls()[1].edit, false, "durable idempotency probe should use one text-to-image provider call");
    assert.strictEqual(imageProviderCalls()[2].edit, true);
    assert.strictEqual(imageProviderCalls()[2].authorization, "Key fal-secret-test-key");
    assert(Array.isArray(imageProviderCalls()[2].body.image_urls));
    assert(imageProviderCalls()[2].body.image_urls[0].startsWith("data:image/png;base64,"), "local guide should be sent server-side as a data URI");
    assert.strictEqual(imageProviderCalls()[3].edit, true);
    assert.strictEqual(imageProviderCalls()[3].body.image_urls.length, 3, "correction should submit candidate, guide, and recovered location authority in order");
    assert(imageProviderCalls()[3].body.image_urls.every((url) => url.startsWith("data:image/png;base64,")), "all local correction inputs should be resolved server-side");
    assert.strictEqual(imageProviderCalls()[4].edit, true, "recovered sourceCandidate correction should still use edit mode");
    assert.strictEqual(imageProviderCalls()[8].edit, true, "vehicle generation with a supporting reference should use edit mode");
    assert(imageProviderCalls()[8].body.image_urls[0].startsWith("data:image/png;base64,"), "vehicle authority should be resolved server-side");
    assert.strictEqual(imageProviderCalls()[9].edit, true, "coverage sheet generation should use the approved primary reference in edit/reference mode");
    assert.strictEqual(imageProviderCalls()[9].body.image_urls.length, 1, "coverage sheet generation should submit one approved identity/design authority");
    assert.strictEqual(imageProviderCalls()[10].edit, true, "derived continuity-state generation must use the edit endpoint");
    assert.strictEqual(imageProviderCalls()[10].body.image_urls.length, 1, "the approved parent state must be #image1 for a derived state edit");
    assert(imageProviderCalls()[10].body.image_urls[0].startsWith("data:image/png;base64,"), "the local parent-state authority should be resolved server-side");

    const recoveredJobs = await json(`${appOrigin}/api/generation/fal/jobs?shotId=S1`);
    assert(recoveredJobs.response.ok);
    assert(recoveredJobs.data.jobs.some((job) => job.id === correctionSubmit.data.job.id && job.purpose === "correction" && job.status === "COMPLETED"), "persisted correction jobs should remain recoverable after refresh or server restart");

    /* ---- production formats reach the provider request -------------------------
     * The ratio->dimensions step used to be an eight-entry lookup table with no 21:9
     * and no 2.39:1, so an ultrawide or scope production silently compiled 16:9 stills
     * however the project was configured. It is derived from the canonical parser now.
     * Nothing is dispatched anywhere: these are compiled requests recorded by the same
     * in-process mock provider the rest of this suite uses.
     *
     * The emission rule is unchanged and is asserted alongside every case — the long
     * edge stays exactly the resolution's long edge and both dimensions stay even and
     * at least 256px. An exact ratio never earns an off-alignment pixel size. */
    const FORMAT_SIZES = [
      ["16:9", "2k", { width: 2048, height: 1152 }],
      ["21:9", "2k", { width: 2048, height: 878 }],
      ["2.39:1", "2k", { width: 2048, height: 858 }],
      ["1:1", "2k", { width: 2048, height: 2048 }],
      ["9:16", "2k", { width: 1152, height: 2048 }],
      ["3:2", "2k", { width: 2048, height: 1366 }],
      /* Every entry the old table held, at every resolution, byte-identical. */
      ["4:3", "1k", { width: 1024, height: 768 }],
      ["5:4", "1k", { width: 1024, height: 820 }],
      ["3:4", "1k", { width: 768, height: 1024 }],
      ["2:3", "4k", { width: 2732, height: 4096 }],
      ["4:5", "4k", { width: 3278, height: 4096 }],
      ["9:16", "1k", { width: 576, height: 1024 }],
      ["16:9", "4k", { width: 4096, height: 2304 }],
      ["1:1", "1k", { width: 1024, height: 1024 }],
      /* Unreadable input still lands on 16:9 rather than throwing or guessing. */
      ["widescreen", "2k", { width: 2048, height: 1152 }],
      ["", "2k", { width: 2048, height: 1152 }],
      /* Outside the believable range, so it is not treated as a format. */
      ["50:1", "2k", { width: 2048, height: 1152 }],
    ];
    const LONG_EDGES = { "1k": 1024, "2k": 2048, "4k": 4096 };
    for (const [aspectRatio, resolution, expected] of FORMAT_SIZES) {
      /* THIS TABLE IS ABOUT aspectSize()'s ARITHMETIC, not about who chooses the format,
         so the shot is made to declare the format each row is exercising. The paid
         boundary derives what a request is entitled to from the shot and refuses a request
         naming a different one — a format is a route input here, not a control a caller
         picks — and without this the table would be asserting that a caller can reframe a
         16:9 production nine different ways. Written unconditionally: the deliberately
         unreadable rows ("widescreen", "50:1", "") do not resolve, so the shot falls back
         to the production's own format exactly as before and those rows go on proving that
         an unreadable input lands on 16:9. */
      const formatted = JSON.parse(fs.readFileSync(projectFile, "utf8"));
      const formattedShot = (formatted.shots || []).find((row) => String(row?.id) === "S1");
      formattedShot.creationBrief = { ...(formattedShot.creationBrief || {}), composition: { ...(formattedShot.creationBrief?.composition || {}), aspectRatio } };
      fs.writeFileSync(projectFile, JSON.stringify(formatted, null, 2));
      const submit = await json(`${appOrigin}/api/generation/fal/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ purpose: "first-frame", shotId: "S1", frameId: "frame-a", frameLabel: "A", prompt: `Format check ${aspectRatio || "unset"} ${resolution}.`, outputCount: 1, quality: "high", resolution, aspectRatio, sourceBuildId: "frame-build-1" }),
      });
      assert(submit.response.ok, JSON.stringify(submit.data));
      /* One concurrent job is allowed, so each request is drained before the next. */
      await json(`${appOrigin}/api/generation/fal/jobs/${submit.data.job.id}/refresh`, { method: "POST" });
      const size = imageProviderCalls().at(-1).body.image_size;
      assert.deepStrictEqual(size, expected, `"${aspectRatio}" at ${resolution} should compile ${expected.width}x${expected.height}, got ${size.width}x${size.height}`);
      assert.strictEqual(size.width % 2, 0, `"${aspectRatio}" produced an odd width (${size.width})`);
      assert.strictEqual(size.height % 2, 0, `"${aspectRatio}" produced an odd height (${size.height})`);
      assert(size.width >= 256 && size.height >= 256, `"${aspectRatio}" fell below the 256px floor`);
      assert.strictEqual(
        Math.max(size.width, size.height),
        LONG_EDGES[resolution],
        `"${aspectRatio}" must keep the ${resolution} long edge exactly`,
      );
    }

    /* ======================================================================
       C0-1 — A MALFORMED FRAME-PRESENCE DECLARATION MUST NOT REACH THE PROVIDER.

       The Automation Lab research reproduced `finalDispatchPresenceGate` failing
       OPEN when a shot's only presence declaration is malformed. Batch 1C's
       malformed refusal existed but sat below an early return gated on
       `shotDeclaresFramePresence`, which was computed from the PARSED view — so
       an unrecognised value produced zero parsed declarations, the shot read as
       ungoverned, and the paid request went out.

       THIS IS THE HALF THAT NEEDS A REAL ROUTE. The unit assertions live in
       tests/frame-presence-authority.js; what only a real dispatch can prove is
       that nothing was spent. Every provider request in this file lands in
       `providerCalls`, so "the provider was not contacted" is a counted fact
       rather than a claim, and the durable ledger is read back to prove no job
       row was minted either.

       A separate shot is used so the sole malformed declaration cannot make the
       rest of this suite's requests governed. */
    const PRESENCE_SHOT = "S-PRESENCE";
    const presenceProject = JSON.parse(fs.readFileSync(projectFile, "utf8"));
    presenceProject.characters.push({ id: "CHAR-ABSENT", name: "Rooftop Sweep", status: "NOT STARTED", workflowStatus: "DRAFT", candidateFiles: [] });
    presenceProject.shots.push({
      id: PRESENCE_SHOT,
      candidateFiles: [],
      keyframes: [{ id: "frame-a", label: "A", required: true }],
      /* THE DEFECT, EXACTLY. One frame, one declaration, and that declaration
         unreadable: `{ state: "absent" }` where a token belongs. This is the
         shot's ONLY presence declaration, which is the condition that made the
         Batch 1C refusal unreachable. */
      creationBrief: { frameWorkflows: { "frame-a": { entityPresence: { "CHAR-ABSENT": { state: "absent" } } } } },
    });
    fs.writeFileSync(projectFile, JSON.stringify(presenceProject, null, 2));

    const callsBeforePresence = providerCalls.length;
    const jobsBeforePresence = (await json(`${appOrigin}/api/generation/fal/jobs?shotId=${PRESENCE_SHOT}`)).data.jobs.length;
    assert.strictEqual(jobsBeforePresence, 0, "precondition: the presence fixture shot has no durable job history");

    const malformedPresence = await json(`${appOrigin}/api/generation/fal/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purpose: "frame",
        shotId: PRESENCE_SHOT,
        frameId: "frame-a",
        frameLabel: "A",
        prompt: "The Rooftop Sweep stands among the chimney stacks, brush raised.",
        outputCount: 1,
        quality: "high",
        aspectRatio: "16:9",
        sourceBuildId: "presence-build-1",
      }),
    });
    assert.strictEqual(malformedPresence.response.status, 409,
      `a sole malformed presence declaration must refuse the paid request: ${JSON.stringify(malformedPresence.data)}`);
    assert.strictEqual(malformedPresence.data.code, "FRAME_PRESENCE_DECLARATION_MALFORMED",
      "and refuse AS malformed — not as a contradiction, and not by pretending the entity is simply absent");
    assert.strictEqual(malformedPresence.data.classification, "local-preflight",
      "refused locally, before anything left the machine");
    assert.strictEqual(malformedPresence.data.providerContacted, false, "the response must state that no provider was contacted");
    assert.strictEqual(malformedPresence.data.paidRequestSubmitted, false, "and that no paid request was submitted");
    assert.deepStrictEqual(malformedPresence.data.contradictions, [],
      "no contradiction may be manufactured: CineBraid could not read the declaration, so it cannot claim to have found the entity in the picture");
    assert(/cannot be read/i.test(malformedPresence.data.error || ""),
      `the error must name the unreadable declaration: ${malformedPresence.data.error}`);
    assert((malformedPresence.data.error || "").includes("CHAR-ABSENT"),
      "and name the entity whose declaration could not be read, so the project fault is findable");

    /* THE TWO FACTS THE ROUTE EXISTS TO PROVE. */
    assert.strictEqual(providerCalls.length, callsBeforePresence,
      `a malformed presence declaration must contact NO provider — ${providerCalls.length - callsBeforePresence} request(s) escaped`);
    const jobsAfterPresence = (await json(`${appOrigin}/api/generation/fal/jobs?shotId=${PRESENCE_SHOT}`)).data.jobs;
    assert.strictEqual(jobsAfterPresence.length, 0,
      "and mint NO durable job row — a row here would claim a paid submission that never happened, and would consume retry budget");
    assert(!fs.readFileSync(path.join(projectDir, "generation-jobs.json"), "utf8").includes(PRESENCE_SHOT),
      "the durable ledger must carry no trace of the refused shot at all");

    /* NOT A BLANKET BLOCK. The same shot, the same route, the same frame — with
       the declaration written in the shape the contract defines — dispatches,
       and dispatches for real. Without this the assertions above would pass just
       as well against a gate that refused everything. */
    const repaired = JSON.parse(fs.readFileSync(projectFile, "utf8"));
    repaired.shots.find((shot) => shot.id === PRESENCE_SHOT).creationBrief.frameWorkflows["frame-a"].entityPresence = { "CHAR-ABSENT": "absent" };
    fs.writeFileSync(projectFile, JSON.stringify(repaired, null, 2));

    const wellFormed = await json(`${appOrigin}/api/generation/fal/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purpose: "frame",
        shotId: PRESENCE_SHOT,
        frameId: "frame-a",
        frameLabel: "A",
        /* Says nothing about the declared-absent character, so there is nothing
           to contradict. */
        prompt: "Empty rooftops under low cloud, slate and smoke.",
        outputCount: 1,
        quality: "high",
        aspectRatio: "16:9",
        sourceBuildId: "presence-build-2",
      }),
    });
    assert(wellFormed.response.ok, `a readable declaration with no contradiction must still dispatch: ${JSON.stringify(wellFormed.data)}`);
    assert.strictEqual(providerCalls.length, callsBeforePresence + 1, "and must reach the provider exactly once");
    await json(`${appOrigin}/api/generation/fal/jobs/${wellFormed.data.job.id}/refresh`, { method: "POST" });

    /* And the readable declaration still refuses when the text DOES contradict
       it — the correction did not trade one failure mode for another. */
    const callsBeforeContradiction = providerCalls.length;
    const contradicted = await json(`${appOrigin}/api/generation/fal/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purpose: "frame",
        shotId: PRESENCE_SHOT,
        frameId: "frame-a",
        frameLabel: "A",
        prompt: "The Rooftop Sweep stands among the chimney stacks, brush raised.",
        outputCount: 1,
        quality: "high",
        aspectRatio: "16:9",
        sourceBuildId: "presence-build-3",
      }),
    });
    assert.strictEqual(contradicted.response.status, 409, "a readable absence contradicted by the prompt still refuses");
    assert.strictEqual(contradicted.data.code, "FRAME_PRESENCE_CONTRADICTION", "as a CONTRADICTION, which is a different truth from an unreadable declaration");
    assert.strictEqual(providerCalls.length, callsBeforeContradiction, "and still contacts no provider");

    const jobsFile = fs.readFileSync(path.join(projectDir, "generation-jobs.json"), "utf8");
    const projectText = fs.readFileSync(projectFile, "utf8");
    assert(!jobsFile.includes("fal-secret-test-key"), "job persistence must not contain the API key");
    assert(!projectText.includes("fal-secret-test-key"), "project data must not contain the API key");

    console.log("FAL generation suite passed server-side secrets, blocking, frame edits, executable corrections, character/location/prop/vehicle reference generation, coverage-sheet provenance and idempotency, parent-derived continuity-state edits, candidate-only ingestion, job persistence, provenance, and C0-1 — a sole malformed frame-presence declaration refuses at the paid boundary with zero provider contact and no durable job row, while a readable declaration still dispatches.");
    /* ======================================================================
       S1 — WHAT CINEBRAID GENERATED SURVIVES TO THE APPROVAL IT WAS MADE FOR.

       The 2026-09-01 dogfood generated a reference for Rex / Default, reviewed
       it 92/PASS, offered APPROVE FOR DEFAULT, and was then refused by its own
       authority gate because nothing had recorded WHAT the image was. The gate
       is right to fail closed; the writer was the one not speaking.

       This runs the shipped route and the shipped ingest — no provider is
       contacted, the stub answers — and reads the row that actually lands in
       project.json. The pair of cases isolates one variable: the same request,
       with and without the declaration.
       ====================================================================== */
    /* The dispatch refuses a target that does not exist, which is correct and is
       why this is given a real one rather than a plausible string. Added here
       rather than in the shared fixture so the cases above keep exercising the
       stateless entity path they were written for. */
    const s1Seed = JSON.parse(fs.readFileSync(projectFile, "utf8"));
    const s1Character = s1Seed.characters.find((row) => row.id === "CHAR-ONE");
    s1Character.continuityStates = [
      { id: "state-default", name: "Default", isDefault: true, approvedFile: "" },
    ];
    fs.writeFileSync(projectFile, JSON.stringify(s1Seed, null, 2));
    /* The coverage-run projection as it stands BEFORE any S1 job, so the accounting
       guard below compares against reality rather than against an assumption that
       this entity has no coverage history. It does. */
    const s1CoverageBefore = JSON.stringify(s1Character.coverageAutomation ?? null);

    const s1Request = (extra) => ({
      purpose: "entity-reference",
      entityList: "characters", entityId: "CHAR-ONE", entityType: "character",
      continuityStateId: "state-default", continuityStateName: "Default",
      prompt: "Clean full-body character reference for the default state.",
      aspectRatio: "3:4", outputCount: 1, quality: "high",
      ...extra,
    });
    const s1Land = async (body, tag) => {
      const posted = await json(`${appOrigin}/api/generation/fal/jobs`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      assert(posted.response.ok, `${tag}: ${JSON.stringify(posted.data)}`);
      const done = await json(`${appOrigin}/api/generation/fal/jobs/${posted.data.job.id}/refresh`, { method: "POST" });
      assert(done.response.ok, `${tag}: ${JSON.stringify(done.data)}`);
      const project = JSON.parse(fs.readFileSync(projectFile, "utf8"));
      const entity = project.characters.find((row) => row.id === "CHAR-ONE");
      const row = entity.candidateFiles.find((item) => item.generationJobId === posted.data.job.id);
      assert(row, `${tag}: ingest wrote no candidate row`);
      return { job: posted.data.job, row, entity };
    };

    /* DECLARED — the shipped dispatch says single-reference, and it survives. */
    const declaredGen = await s1Land(s1Request({
      sourceBuildId: "s1-build-declared", artifactStructure: "single-reference",
    }), "S1 declared");
    assert.strictEqual(declaredGen.job.artifactStructure, "single-reference",
      "S1: the job row must record what the dispatch asked for");
    assert.strictEqual(Coverage.referenceArtifactStructure(declaredGen.row), "single",
      "S1: a candidate CineBraid generated for one continuity state must classify SINGLE");
    assert.strictEqual(Coverage.artifactMayHoldPrimaryAuthority(Coverage.referenceArtifactStructure(declaredGen.row)), true,
      "S1: and must therefore be eligible to become that state's identity");

    /* WHERE AND WHAT STAY SEPARATE. The declaration must not have been achieved
       by overwriting the target, and the target must not have been read as the
       structure — library-tools.js:165 makes that distinction explicitly. */
    assert.strictEqual(declaredGen.row.targetStateId, "state-default",
      "S1: the deterministic target survives unchanged beside the structural fact");
    assert.strictEqual(declaredGen.row.targetStateName, "Default", "S1: and so does its name");

    /* THE ACCOUNTING BOUNDARY. `coverageJobType` on a JOB is coverage-run
       membership; borrowing it to say "single image" would charge a manual paid
       generation to a run the filmmaker never started.
       CHAR-ONE genuinely HAS a coverage projection by now — the sheet case above
       built one — so the guard is not "no projection exists". It is that this
       manual generation did not JOIN it: the projection is byte-identical to what
       it was before these jobs ran, timestamps included, so it was not even
       rebuilt, and no S1 job id appears in its membership. */
    assert.strictEqual(declaredGen.job.coverageJobType, "",
      "S1: declaring structure must NOT give the job a coverage-run membership");
    assert.strictEqual(JSON.stringify(declaredGen.entity.coverageAutomation ?? null), s1CoverageBefore,
      "S1: a manual reference generation must leave the coverage-run projection untouched");
    assert.strictEqual((declaredGen.entity.coverageAutomation?.jobs || []).includes(declaredGen.job.id), false,
      "S1: and must never be enrolled as a member of a coverage run");

    /* OMITTED — the same request without the declaration. The row is undeclared,
       which is what the authority gate refuses. This is the negative half: it
       isolates the declaration as the thing that made the difference. */
    const undeclaredGen = await s1Land(s1Request({ sourceBuildId: "s1-build-undeclared" }), "S1 undeclared");
    assert.strictEqual(undeclaredGen.job.artifactStructure, "",
      "S1: a request that declares nothing records nothing");
    assert.strictEqual(Coverage.referenceArtifactStructure(undeclaredGen.row), "undeclared",
      "S1: and its candidate row stays UNDECLARED — no evidence is not evidence of eligibility");
    assert.strictEqual(Coverage.artifactMayHoldPrimaryAuthority(Coverage.referenceArtifactStructure(undeclaredGen.row)), false,
      "S1: so the gate still refuses it, exactly as it refused the dogfood candidate");

    /* AN UNRECOGNISED VALUE IS NOT A DECLARATION. The whitelist must drop it
       rather than let a caller invent a structure the classifier would trust. */
    const bogusGen = await s1Land(s1Request({
      sourceBuildId: "s1-build-bogus", artifactStructure: "definitely-single-trust-me",
    }), "S1 bogus");
    assert.strictEqual(bogusGen.job.artifactStructure, "",
      "S1: an unrecognised structure is dropped at the boundary, not stored");
    assert.strictEqual(Coverage.referenceArtifactStructure(bogusGen.row), "undeclared",
      "S1: and the row fails closed rather than inheriting an invented claim");

  } finally {
    await new Promise((resolve) => appServer.close(resolve));
    await new Promise((resolve) => mockServer.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

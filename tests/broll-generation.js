/* B-ROLL / STYLE-ONLY GENERATION — what the mode promises, proved on the shipped paths.

   A style-only shot is generated from the project look and its own written prompt: no
   reference image, identity reference or continuity state. Everything here runs the real
   compilers and, in B–D, the real server against a LOCAL mock provider that records what
   it was sent. Nothing is paid and no real provider is contacted.

     A  the package: prompt-only targets, project style + the written prompt, no entity
        input, the prompt stated once
     B  image and video compile and submit with no reference, and the request the
        provider receives carries the project style and the prompt
     C  a method that needs an image or reference input cannot be submitted without it —
        style-only or not — and nothing reaches the provider
     D  the returned media records style-only provenance, and no entity, reference,
        coverage or approval changes
     E  reference-led behaviour is unchanged: readiness, default package resolution, job
        records and retention
     F  the desk as rendered: one panel, no reference step, the targets the server uses */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const { spawn } = require("child_process");
const { withGenerationDeclaration } = require("./generation-request-fixture");
const PromptEngine = require("../src/generation/prompt-engine");
const BrollPackage = require("../src/generation/broll-package");
const { compileImageExecutionPlan } = require("../src/generation/image-execution");
const { compileH3ExecutionPlan } = require("../src/generation/h3-execution");
const { serializeH3PlanForFal } = require("../src/generation/fal/fal-h3-backend");
const { serializeImagePlanForFal } = require("../src/generation/fal/fal-image-backend");
const BuildHistory = require("../public/shared-build-history");
const Readiness = require("../public/shared-shot-readiness");
const Media = require("../public/shared-production-media");

const ROOT = path.join(__dirname, "..");
const SAMPLE = JSON.parse(fs.readFileSync(path.join(ROOT, "projects", "cinebraid-sample", "project.json"), "utf8"));
const PROMPT = "Rain sheets across the empty platform canopy at dusk; puddles ripple under the sodium lamps.";
const STYLE = "Clean graphic storyboard placeholders for a manual production-organizing sample.";
const clone = (value) => JSON.parse(JSON.stringify(value));
let checks = 0;
const ok = (value, message) => { checks += 1; assert(value, message); };
const equal = (actual, expected, message) => { checks += 1; assert.strictEqual(actual, expected, message); };
const deepEqual = (actual, expected, message) => { checks += 1; assert.deepStrictEqual(actual, expected, message); };

/* The sample, with a camera direction and a written B-roll prompt on SAMPLE-01, so the
   package has something of each kind to carry. The courier stays attached: a style-only
   shot that names a character is exactly the case that must not become reference-led. */
function fixtureProject() {
  const P = clone(SAMPLE);
  const shot = P.shots.find((row) => row.id === "SAMPLE-01");
  shot.creationBrief.composition = { camera: { shotSize: "wide", angle: "high" } };
  shot.creationBrief.brollPrompt = PROMPT;
  return P;
}
function courierCanon(P) {
  const courier = P.characters.find((row) => row.id === "CHAR-COURIER");
  return String(courier.creationDescription || courier.block || courier.description || "").trim();
}
function registerBroll(P, shotId, pkg, extra = {}) {
  const shot = P.shots.find((row) => row.id === shotId);
  const frame = shot.keyframes[0];
  const kind = pkg.output === "video" ? "broll-video" : "broll-image";
  const id = BuildHistory.registerPromptBuild(P, {
    id: extra.id || `${kind}-test`,
    packageId: extra.packageId || `${shotId}-BROLL-${pkg.output.toUpperCase()}-R01`,
    kind,
    referenceMode: "style-only",
    mode: pkg.profile.mode,
    profileId: extra.profileId || pkg.profile.id,
    profileName: pkg.profile.name,
    prompt: pkg.compiledPrompt,
    spec: pkg.spec,
    references: extra.references || [],
    ...(pkg.output === "video" ? { durationSeconds: 5 } : { frameId: frame.id, frameLabel: frame.label }),
  });
  shot.creationBrief.brollBuilds = [...(shot.creationBrief.brollBuilds || []), BuildHistory.promptBuildRef(id, { kind })];
  return id;
}

/* =========================================================================== A */
function testPackage() {
  const P = fixtureProject();
  const canon = courierCanon(P);
  ok(canon.length > 10, "fixture: the courier carries canon text a reference-led prompt would use");
  deepEqual(BrollPackage.BROLL_PROFILE_IDS, { image: "gpt-image-2/t2i", video: "minimax-h3/t2v" }, "A: one prompt-only target per output");
  for (const output of ["image", "video"]) {
    const pkg = BrollPackage.compileBrollPackage({ project: P, shotId: "SAMPLE-01", output });
    equal(pkg.referenceMode, "style-only", `A ${output}: the package says what it is`);
    equal(pkg.spec.referenceMode, "style-only", `A ${output}: and so does its spec`);
    equal(pkg.profile.mode, output === "video" ? "t2v" : "t2i", `A ${output}: a prompt-only mode`);
    deepEqual(pkg.spec.promptEntities || [], [], `A ${output}: no entity descriptor`);
    deepEqual(pkg.spec.identityCanon || [], [], `A ${output}: no identity canon`);
    deepEqual(pkg.spec.visualGrounding || [], [], `A ${output}: no visual grounding`);
    ok((pkg.spec.visualStyle || []).includes(STYLE), `A ${output}: the project style is in the package`);
    /* The text the PROVIDER is sent is the GenerationPlan's, compiled from this package by
       the same module the paid route uses. */
    const withBuild = clone(P);
    const buildId = registerBroll(withBuild, "SAMPLE-01", pkg, { id: `a-${output}` });
    const plan = output === "video"
      ? compileH3ExecutionPlan({ project: withBuild, shotId: "SAMPLE-01", buildId, durationSeconds: 5, aspectRatio: "16:9", resolution: "768P" })
      : compileImageExecutionPlan({ project: withBuild, purpose: "frame", shotId: "SAMPLE-01", buildId, aspectRatio: "16:9" });
    equal(plan.mode, output === "video" ? "t2v" : "t2i", `A ${output}: the plan is prompt-only`);
    equal(plan.plan.inputs.references.length, 0, `A ${output}: with no reference`);
    deepEqual(plan.plan.warnings, [], `A ${output}: and nothing to warn about`);
    ok(plan.compiledPrompt.includes(STYLE), `A ${output}: the project style is in the prompt the provider is sent`);
    ok(/wide/i.test(plan.compiledPrompt), `A ${output}: and so is the shot's camera direction`);
    for (const text of [pkg.compiledPrompt, plan.compiledPrompt, JSON.stringify(pkg.spec)]) {
      ok(!text.includes(canon), `A ${output}: the courier's canon never reaches a style-only package`);
      ok(!text.includes("A courier arrives with a blue parcel"), `A ${output}: nor does the scene beat that names the cast`);
    }
    for (const text of [pkg.compiledPrompt, plan.compiledPrompt])
      equal(text.split(PROMPT).length - 1, 1, `A ${output}: the written prompt is stated exactly once`);
  }
  const video = BrollPackage.compileBrollPackage({ project: P, shotId: "SAMPLE-01", output: "video" });
  equal(video.durationSeconds, 4, "A: the video package carries the shot's own duration");
  /* An explicit prompt wins; with none, the shot's written B-roll prompt; with neither,
     its description. An empty prompt is refused rather than compiled from nothing. */
  const override = BrollPackage.compileBrollPackage({ project: P, shotId: "SAMPLE-01", output: "image", prompt: "A single lamp swinging in the wind." });
  ok(override.compiledPrompt.includes("A single lamp swinging in the wind."), "A: the prompt sent is the prompt compiled");
  const bare = fixtureProject();
  delete bare.shots[0].creationBrief.brollPrompt;
  ok(BrollPackage.compileBrollPackage({ project: bare, shotId: "SAMPLE-01", output: "image" }).compiledPrompt.includes(bare.shots[0].desc),
    "A: a shot with no written B-roll prompt starts from its description");
  bare.shots[0].desc = "";
  assert.throws(() => BrollPackage.compileBrollPackage({ project: bare, shotId: "SAMPLE-01", output: "image" }), /Write this shot's prompt/);
  assert.throws(() => BrollPackage.compileBrollPackage({ project: P, shotId: "SAMPLE-01", output: "audio" }), /Image or Video/);
  checks += 2;
  console.log("  A · package: prompt-only targets, project style and the written prompt once, no entity input");
}

/* ============================================================== B, C, D and E */
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-broll-"));
const PROJECTS_ROOT = path.join(TEMP, "projects");
const PROJECT_DIR = path.join(PROJECTS_ROOT, "cinebraid-sample");
const CONFIG_PATH = path.join(TEMP, "config.json");
const PNG = fs.readFileSync(path.join(ROOT, "tests", "fixtures", "ev2-6", "frame-0.png"));
const MP4 = fs.readFileSync(path.join(ROOT, "tests", "fixtures", "ev2-6", "motion-0.mp4"));
const providerCalls = [];
let mockOrigin = "", base = "", child = null, mockServer = null, serverOutput = "";

async function freePort() {
  const net = require("net");
  return new Promise((resolve) => { const probe = net.createServer(); probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); });
}
async function startMockProvider() {
  const mock = express();
  mock.use(express.json({ limit: "25mb" }));
  const accept = (kind) => (req, res) => {
    const id = `${kind}-${providerCalls.length + 1}`;
    providerCalls.push({ id, endpoint: req.path, body: req.body, authorized: /^Key /.test(String(req.headers.authorization || "")) });
    res.json({ request_id: id, status_url: `${mockOrigin}/status/${id}`, response_url: `${mockOrigin}/result/${id}`, cancel_url: `${mockOrigin}/cancel/${id}` });
  };
  mock.post(["/openai/gpt-image-2", "/openai/gpt-image-2/edit"], accept("img"));
  mock.post(["/minimax/h3/text-to-video", "/minimax/h3/image-to-video", "/minimax/h3/reference-to-video"], accept("vid"));
  mock.get("/status/:id", (req, res) => res.json({ status: "COMPLETED" }));
  mock.get("/result/:id", (req, res) => (req.params.id.startsWith("vid-")
    ? res.json({ video: { url: `${mockOrigin}/video/${req.params.id}.mp4`, content_type: "video/mp4" } })
    : res.json({ images: [{ url: `${mockOrigin}/image/${req.params.id}.png`, width: 1536, height: 864, content_type: "image/png" }] })));
  mock.get("/image/:name", (req, res) => res.type("png").send(PNG));
  mock.get("/video/:name", (req, res) => res.type("video/mp4").send(MP4));
  mock.put("/cancel/:id", (req, res) => res.json({ ok: true }));
  const port = await freePort();
  mockServer = await new Promise((resolve) => { const server = mock.listen(port, "127.0.0.1", () => resolve(server)); });
  mockOrigin = `http://127.0.0.1:${port}`;
}
async function startServer() {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), CINEBRAID_CONFIG_PATH: CONFIG_PATH, CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT, CINEBRAID_AI_TEXT_TIMEOUT_MS: "250" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { serverOutput += chunk; });
  child.stderr.on("data", (chunk) => { serverOutput += chunk; });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${base}/api/me`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error(`Server did not start. Output:\n${serverOutput}`);
}
async function call(url, payload = null) {
  const init = payload == null ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(await withGenerationDeclaration(url, payload, { origin: base })) };
  const response = await fetch(base + url, init);
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}
const readProject = () => JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, "project.json"), "utf8"));
const entityState = (P) => JSON.stringify({ characters: P.characters, locations: P.locations, props: P.props, vehicles: P.vehicles || [], authority: P.productionAuthority || null });

async function settle(jobId) {
  for (let i = 0; i < 40; i++) {
    const refreshed = await call(`/api/generation/fal/jobs/${jobId}/refresh`, {});
    if (refreshed.body?.job?.status === "COMPLETED" && (refreshed.body.job.outputs || []).length) return refreshed.body.job;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`job ${jobId} did not settle`);
}

async function prepareProject() {
  fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
  fs.cpSync(path.join(ROOT, "projects", "cinebraid-sample"), PROJECT_DIR, { recursive: true });
  const P = fixtureProject();
  P.shots.find((row) => row.id === "SAMPLE-01").referenceMode = "style-only";
  const image = BrollPackage.compileBrollPackage({ project: P, shotId: "SAMPLE-01", output: "image" });
  const video = BrollPackage.compileBrollPackage({ project: P, shotId: "SAMPLE-01", output: "video" });
  registerBroll(P, "SAMPLE-01", image, { id: "broll-image-1" });
  registerBroll(P, "SAMPLE-01", video, { id: "broll-video-1" });
  /* C: a style-only package that claims a method needing an input, and one that carries
     a reference. Neither may be sent. */
  registerBroll(P, "SAMPLE-01", video, { id: "broll-video-i2v", packageId: "SAMPLE-01-BROLL-I2V", profileId: "minimax-h3/i2v" });
  registerBroll(P, "SAMPLE-01", image, { id: "broll-image-ref", packageId: "SAMPLE-01-BROLL-REF", references: [{ key: "anchor", label: "Courier", role: "identity", url: "/assets/anchors/CHAR-COURIER-FRONT.png", mediaType: "image" }] });
  /* E and C: an ordinary reference-led package on SAMPLE-02 — a t2i frame with nothing
     attached, and an i2v motion package with no opening frame approved. */
  const second = P.shots.find((row) => row.id === "SAMPLE-02");
  const context = PromptEngine.buildContext(P, "SAMPLE-02");
  const frameSpec = PromptEngine.defaultSpec(context, "shot-still", "t2i", [], null);
  const frameId = BuildHistory.registerPromptBuild(P, { id: "ref-led-frame", packageId: "SAMPLE-02-FRAME-A-R01", profileId: "gpt-image-2/t2i", spec: frameSpec, references: [], prompt: "Frame", frameId: second.keyframes[0].id, frameLabel: second.keyframes[0].label });
  second.creationBrief.promptBuilds = [BuildHistory.promptBuildRef(frameId, { kind: "guided-frame" })];
  const motionSpec = PromptEngine.defaultSpec(context, "motion", "i2v", [], null);
  const motionId = BuildHistory.registerPromptBuild(P, { id: "ref-led-i2v", packageId: "SAMPLE-02-MOTION-R01", profileId: "minimax-h3/i2v", spec: motionSpec, references: [], prompt: "Motion", durationSeconds: 5 });
  second.creationBrief.motionPromptBuilds = [BuildHistory.promptBuildRef(motionId, { kind: "guided-motion" })];
  fs.writeFileSync(path.join(PROJECT_DIR, "project.json"), JSON.stringify(P, null, 2));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    activeProject: "cinebraid-sample",
    assistant: { provider: "none", visionProvider: "none" },
    generation: { fal: {
      enabled: true, apiKey: "fal-broll-test-key", baseUrl: mockOrigin,
      textModel: "openai/gpt-image-2", editModel: "openai/gpt-image-2/edit",
      h3TextModel: "minimax/h3/text-to-video", h3ImageModel: "minimax/h3/image-to-video", h3ReferenceModel: "minimax/h3/reference-to-video",
      h3Resolution: "768P", frameOutputs: 1, frameQuality: "low", frameResolution: "1k", maxConcurrent: 4,
    } },
  }, null, 2));
  return { image, video };
}

async function testServer({ image, video }) {
  const before = readProject();
  /* B — the route the panel calls compiles the same package this suite stored. */
  for (const [output, pkg] of [["image", image], ["video", video]]) {
    const routed = await call("/api/prompt/broll-compile", { shotId: "SAMPLE-01", output });
    equal(routed.status, 200, `B ${output}: broll-compile answers`);
    equal(routed.body.compiledPrompt, pkg.compiledPrompt, `B ${output}: the route compiles the identical package`);
    equal(routed.body.referenceMode, "style-only", `B ${output}: and says it is style-only`);
  }
  const refused = await call("/api/prompt/broll-compile", { shotId: "SAMPLE-01", output: "hologram" });
  equal(refused.status, 400, "B: an unknown output is refused");

  /* B image — preview, then the paid route, then the provider's own receipt. */
  const imagePlan = await call("/api/generation/fal/image/plan", { purpose: "frame", shotId: "SAMPLE-01", sourceBuildId: "broll-image-1", aspectRatio: "16:9", outputCount: 1 });
  equal(imagePlan.status, 200, `B image: the plan compiles: ${JSON.stringify(imagePlan.body).slice(0, 300)}`);
  equal(imagePlan.body.mode, "t2i", "B image: text-to-image");
  deepEqual(imagePlan.body.references, [], "B image: no reference in the plan");
  equal(imagePlan.body.source.referenceMode, "style-only", "B image: the preview says style-only");
  equal(imagePlan.body.refusal, null, "B image: nothing refuses it");
  const beforeImage = providerCalls.length;
  const imageJob = await call("/api/generation/fal/jobs", {
    purpose: "frame", imagePlan: true, clientRequestId: "broll-image-test", shotId: "SAMPLE-01", frameId: "frame-a", frameLabel: "A",
    sourceBuildId: "broll-image-1", packageId: "SAMPLE-01-BROLL-IMAGE-R01", profileId: "gpt-image-2/t2i", prompt: imagePlan.body.compiledPrompt,
    aspectRatio: "16:9", outputCount: 1, quality: "low", resolution: imagePlan.body.size,
  });
  equal(imageJob.status, 200, `B image: submitted: ${JSON.stringify(imageJob.body).slice(0, 400)}`);
  equal(providerCalls.length, beforeImage + 1, "B image: exactly one provider request");
  const imageCall = providerCalls.at(-1);
  equal(imageCall.endpoint, "/openai/gpt-image-2", "B image: the text-to-image endpoint, never /edit");
  ok(imageCall.authorized, "B image: the request was authorised with the configured key");
  ok(!("image_urls" in imageCall.body) && !("image_url" in imageCall.body) && !("mask_url" in imageCall.body), "B image: no image input of any kind travels");
  ok(imageCall.body.prompt.includes(STYLE), "B image: the provider is sent the project style");
  ok(imageCall.body.prompt.includes(PROMPT), "B image: and the written shot prompt");
  ok(!imageCall.body.prompt.includes(courierCanon(before)), "B image: and never the courier's canon");
  equal(imageJob.body.job.referenceMode, "style-only", "B image: the job records style-only");
  deepEqual(imageJob.body.job.references, [], "B image: the job records no reference");
  equal(imageJob.body.job.mode, "t2i", "B image: and text-to-image");
  const imageDone = await settle(imageJob.body.job.id);

  /* B video — the same, through MiniMax H3 text-to-video. */
  const videoPlan = await call("/api/generation/fal/h3/plan", { shotId: "SAMPLE-01", sourceBuildId: "broll-video-1", durationSeconds: 5, resolution: "768P", aspectRatio: "16:9", profileMode: "t2v" });
  equal(videoPlan.status, 200, `B video: the plan compiles: ${JSON.stringify(videoPlan.body).slice(0, 300)}`);
  equal(videoPlan.body.mode, "t2v", "B video: text-to-video");
  deepEqual(videoPlan.body.references, [], "B video: no reference in the plan");
  equal(videoPlan.body.source.referenceMode, "style-only", "B video: the preview says style-only");
  const beforeVideo = providerCalls.length;
  const videoJob = await call("/api/generation/fal/jobs", {
    purpose: "motion-h3", clientRequestId: "broll-video-test", shotId: "SAMPLE-01", sourceBuildId: "broll-video-1", packageId: "SAMPLE-01-BROLL-VIDEO-R01",
    profileId: "minimax-h3/t2v", profileName: "MiniMax H3", profileFamily: "minimax-h3", profileMode: "t2v", prompt: videoPlan.body.compiledPrompt,
    durationSeconds: 5, resolution: "768P", aspectRatio: "16:9",
  });
  equal(videoJob.status, 200, `B video: submitted: ${JSON.stringify(videoJob.body).slice(0, 400)}`);
  equal(providerCalls.length, beforeVideo + 1, "B video: exactly one provider request");
  const videoCall = providerCalls.at(-1);
  equal(videoCall.endpoint, "/minimax/h3/text-to-video", "B video: the text-to-video endpoint");
  for (const key of ["image_url", "end_image_url", "reference_image_urls", "reference_video_urls", "reference_audio_urls"])
    ok(!(key in videoCall.body), `B video: no ${key} travels`);
  ok(videoCall.body.prompt.includes(STYLE), "B video: the provider is sent the project style");
  ok(videoCall.body.prompt.includes(PROMPT), "B video: and the written shot prompt");
  equal(Number(videoCall.body.duration), 5, "B video: the duration the dialog confirmed");
  equal(videoJob.body.job.referenceMode, "style-only", "B video: the job records style-only");
  deepEqual(videoJob.body.job.references, [], "B video: the job records no reference");
  const videoDone = await settle(videoJob.body.job.id);
  console.log("  B · image and video compile and submit with no reference, carrying the project style and the written prompt");

  /* C — a method that needs an input cannot go without it. */
  const quiet = providerCalls.length;
  const i2vPlan = await call("/api/generation/fal/h3/plan", { shotId: "SAMPLE-01", sourceBuildId: "broll-video-i2v", durationSeconds: 5, resolution: "768P", profileMode: "i2v" });
  equal(i2vPlan.status, 400, "C: a style-only i2v package does not even preview");
  equal(i2vPlan.body.code, "BROLL_MODE_NEEDS_INPUT", "C: refused for the input it would need");
  const i2vJob = await call("/api/generation/fal/jobs", { purpose: "motion-h3", clientRequestId: "broll-i2v", shotId: "SAMPLE-01", sourceBuildId: "broll-video-i2v", profileId: "minimax-h3/i2v", profileFamily: "minimax-h3", profileMode: "i2v", prompt: "x", durationSeconds: 5, resolution: "768P" });
  ok(i2vJob.status >= 400, `C: and cannot be submitted (${i2vJob.status})`);
  equal(i2vJob.body.code, "BROLL_MODE_NEEDS_INPUT", "C: for the same reason");
  const refImage = await call("/api/generation/fal/jobs", { purpose: "frame", imagePlan: true, clientRequestId: "broll-ref", shotId: "SAMPLE-01", frameId: "frame-a", sourceBuildId: "broll-image-ref", prompt: "x", aspectRatio: "16:9", outputCount: 1 });
  ok(refImage.status >= 400, "C: a style-only package that carries a reference is refused, not sent without it");
  equal(refImage.body.code, "BROLL_MODE_NEEDS_INPUT", "C: named as needing an input B-roll does not have");
  const refLedI2v = await call("/api/generation/fal/jobs", { purpose: "motion-h3", clientRequestId: "ref-led-i2v", shotId: "SAMPLE-02", sourceBuildId: "ref-led-i2v", profileId: "minimax-h3/i2v", profileFamily: "minimax-h3", profileMode: "i2v", prompt: "x", durationSeconds: 5, resolution: "768P" });
  ok(refLedI2v.status >= 400, `C: a reference-led image-to-video package with no opening frame is refused too (${refLedI2v.status})`);
  equal(providerCalls.length, quiet, "C: and none of the four reached the provider — no dummy input was invented");
  console.log("  C · methods that need an image or reference cannot be submitted without it; nothing reached the provider");

  /* D — provenance, and nothing about references moved. */
  const after = readProject();
  equal(entityState(after), entityState(before), "D: no character, location, prop, vehicle, coverage slot or approval changed");
  const scan = await (await fetch(`${base}/api/scan`)).json();
  const jobs = (await (await fetch(`${base}/api/generation/fal/jobs`)).json()).jobs || [];
  const projection = Media.productionMediaRecords({ project: after, scan, jobs, jobsAvailable: true });
  for (const [label, job] of [["image", imageDone], ["video", videoDone]]) {
    const rows = projection.records.flatMap((row) => row.relationships || [row]).filter((row) => row.provenance?.job?.id?.value === job.id || row.provenance?.job?.id === job.id);
    ok(rows.length >= 1, `D ${label}: the returned media is an ordinary production media record (${rows.length})`);
    for (const row of rows) {
      deepEqual(row.provenance.referenceMode, { state: "known", value: "style-only" }, `D ${label}: provenance says style-only`);
      ok(["shot-still", "shot-motion"].includes(row.kind), `D ${label}: owned by the shot, not by an entity (${row.kind})`);
      equal(row.disposition.role, "candidate", `D ${label}: and it is a candidate awaiting a person`);
    }
  }
  const shot = after.shots.find((row) => row.id === "SAMPLE-01");
  ok((shot.candidateFiles || []).some((row) => row.frameId === "frame-a"), "D: the images landed as Frame A candidates");
  console.log("  D · returned media records style-only provenance; no entity, reference, coverage or approval changed");

  /* E — a reference-led job is recorded exactly as before: no referenceMode key at all. */
  const refLedPlan = await call("/api/generation/fal/image/plan", { purpose: "frame", shotId: "SAMPLE-02", sourceBuildId: "ref-led-frame", aspectRatio: "16:9", outputCount: 1 });
  equal(refLedPlan.status, 200, "E: the reference-led package compiles");
  ok(!("referenceMode" in refLedPlan.body.source), "E: its preview names no reference mode");
  const refLedJob = await call("/api/generation/fal/jobs", { purpose: "frame", imagePlan: true, clientRequestId: "ref-led-frame", shotId: "SAMPLE-02", frameId: after.shots.find((row) => row.id === "SAMPLE-02").keyframes[0].id, frameLabel: "A", sourceBuildId: "ref-led-frame", prompt: refLedPlan.body.compiledPrompt, aspectRatio: "16:9", outputCount: 1, quality: "low", resolution: refLedPlan.body.size });
  equal(refLedJob.status, 200, `E: the reference-led job submits: ${JSON.stringify(refLedJob.body).slice(0, 300)}`);
  ok(!("referenceMode" in refLedJob.body.job), "E: and its job record carries no referenceMode key");
  console.log("  E · a reference-led job is recorded exactly as before");
}

/* ======================================================================== E */
function testReferenceLedUnchanged() {
  const P = fixtureProject();
  const shot = P.shots.find((row) => row.id === "SAMPLE-01");
  const original = JSON.stringify(Readiness.evaluateShotReadiness(P, shot));
  const declarations = JSON.stringify(shot.continuityStateSelections);
  const referenceLed = JSON.parse(original);
  const inputs = (report) => [...report.requirements, ...report.units.flatMap((unit) => unit.requirements)].filter((row) => ["entity-state", "relationship"].includes(row.kind));
  ok(inputs(referenceLed).length > 0, "E: reference-led SAMPLE-01 owes its courier reference");
  shot.referenceMode = "style-only";
  const styleOnly = Readiness.evaluateShotReadiness(P, shot);
  deepEqual(inputs(styleOnly), [], "E: style-only SAMPLE-01 owes no reference, identity or relationship decision");
  ok(styleOnly.nextAction.code !== "confirm-existing-reference", "E: and is not sent to confirm one");
  equal(JSON.stringify(shot.continuityStateSelections), declarations, "E: its declared continuity states are kept, dormant");
  delete shot.referenceMode;
  equal(JSON.stringify(Readiness.evaluateShotReadiness(P, shot)), original, "E: back to reference-led, readiness is byte-identical");
  shot.referenceMode = "something-else";
  equal(JSON.stringify(Readiness.evaluateShotReadiness(P, shot)), original, "E: an unrecognised stored mode reads as reference-led");
  delete shot.referenceMode;

  /* Default resolution never picks a B-roll package, in either compiler. */
  const pkg = BrollPackage.compileBrollPackage({ project: P, shotId: "SAMPLE-01", output: "image" });
  registerBroll(P, "SAMPLE-01", pkg, { id: "broll-default-probe" });
  assert.throws(() => compileImageExecutionPlan({ project: P, purpose: "frame", shotId: "SAMPLE-01" }), (error) => error.code === "IMAGE_BUILD_NOT_FOUND");
  assert.throws(() => compileH3ExecutionPlan({ project: P, shotId: "SAMPLE-01" }), (error) => error.code === "H3_BUILD_NOT_FOUND");
  checks += 2;
  equal(compileImageExecutionPlan({ project: P, purpose: "frame", shotId: "SAMPLE-01", buildId: "broll-default-probe" }).referenceMode, "style-only", "E: named by id, it resolves");

  /* Retention keeps what a B-roll list references, and adds no key to a shot without one. */
  const kept = clone(P);
  for (let i = 0; i < 4; i++) registerBroll(kept, "SAMPLE-01", pkg, { id: `broll-retention-${i}`, packageId: `SAMPLE-01-BROLL-IMAGE-R0${i + 2}` });
  BuildHistory.applyPromptBuildRetention(kept, 3);
  const listed = kept.shots[0].creationBrief.brollBuilds.map((entry) => entry.buildId);
  equal(listed.length, 3, "E: a B-roll list is capped like every other list");
  ok(listed.every((id) => kept.promptBuildsById[id]), "E: and every id it keeps is still in the store");
  ok(!("brollBuilds" in kept.shots[1].creationBrief), "E: a shot that never made B-roll gains no empty key");
  console.log("  E · reference-led readiness, package resolution and retention are unchanged");
}

/* ======================================================================== F */
async function testDesk() {
  const vm = require("vm");
  const { render, buildFixture } = require("./render-harness");
  const project = buildFixture();
  project.meta.globalStylePrompt = STYLE;
  const shot = project.shots[0];
  const referenceLed = await render(`#/shot/${shot.id}`, clone(project));
  ok(referenceLed.html.includes('data-shot-reference-mode="reference-led"'), "F: the mode choice is on a reference-led desk");
  ok(referenceLed.html.includes("shot-intent-control") && referenceLed.html.includes("guided-work-stack"), "F: which keeps its intent control and stage workspace");
  ok(!referenceLed.html.includes("data-broll-panel"), "F: and shows no B-roll panel");

  shot.referenceMode = "style-only";
  shot.desc = PROMPT;
  const styleOnly = await render(`#/shot/${shot.id}`, clone(project));
  const html = styleOnly.html;
  ok(html.includes(`data-broll-panel="${shot.id}"`), "F: a style-only shot renders the B-roll panel");
  ok(html.includes("Uses the project look and this shot’s prompt. No reference required."), "F: with its one line of explanation");
  equal(html.split("No reference required").length - 1, 1, "F: stated once");
  ok(html.includes(STYLE), "F: the project look it will use is shown");
  ok(html.includes(PROMPT), "F: the prompt starts from the shot's description");
  for (const absent of ["shot-intent-control", "guided-work-stack", "guided-next-action", "Import more", "Who is in this frame", "Drop or choose", "Add a reference", "Attach"])
    ok(!html.includes(absent), `F: no reference-led step on a style-only desk: ${absent}`);
  ok(html.includes("data-shot-results-rail"), "F: results stay where every candidate is reviewed");
  equal((html.match(/class="broll-generate"/g) || []).length, 1, "F: one Generate button");
  const targets = vm.runInContext(`({ image: brollTarget("image"), video: brollTarget("video") })`, styleOnly.context);
  equal(targets.image.id, BrollPackage.BROLL_PROFILE_IDS.image, "F: the panel names the image target the server compiles for");
  equal(targets.video.id, BrollPackage.BROLL_PROFILE_IDS.video, "F: and the video target");
  ok(targets.image.runnable && targets.video.runnable, "F: both are dispatchable in this build");

  /* The compact Simple view is opt-in by summary: with one, Simple is the summary, the
     controls and one cost line; without one — every other surface — it is the full view
     it always was, and Advanced ignores a summary entirely. */
  const views = vm.runInContext(`(() => {
    const plan = generationRequestPlan({ surface: CINEBRAID_REQUEST_SURFACE_IDS.motionH3, mode: "simple", capability: capabilityFromPlan({ durationRange: [5, 15], resolutions: ["768P", "2K"] }, { aspectRatios: ["16:9"] }) });
    const base = { mode: "simple", plan, option: { modelName: "MiniMax H3", surfaceName: "fal", mode: "t2v" }, recommendation: generationRecommendationFor(null), rate: generationRateFor("video"), quantity: 5, limits: { rows: [{ value: 1, label: "clip per request" }] }, controlsMarkup: '<label><span>Duration</span><select id="fal-h3-duration"></select></label>', coverage: [] };
    return {
      compact: generationViewMarkup({ ...base, summary: "MiniMax H3 via fal · Text to video · 5s · 16:9" }),
      full: generationViewMarkup(base),
      advanced: generationViewMarkup({ ...base, mode: "advanced", summary: "ignored" }),
      advancedPlain: generationViewMarkup({ ...base, mode: "advanced" }),
    };
  })()`, styleOnly.context);
  ok(views.compact.includes("MiniMax H3 via fal · Text to video · 5s · 16:9") && views.compact.includes("data-gen-view-cost-line"), "F: compact Simple states the request and the price in one line each");
  ok(views.compact.includes('id="fal-h3-duration"'), "F: and keeps the settings that can change");
  for (const card of ["gen-view-always", "gen-view-limits", "Where it runs", "Estimated time</span>"])
    ok(!views.compact.includes(card), `F: compact Simple draws no diagnostic ${card}`);
  ok(views.compact.includes("Price and time unavailable") && views.compact.includes("still a paid request"), "F: unavailable price and time are said in one line, still named paid");
  ok(views.full.includes("gen-view-always") && !views.full.includes("data-gen-view-summary"), "F: a surface with no summary renders the full Simple view, unchanged");
  equal(views.advanced, views.advancedPlain, "F: Advanced is identical with or without a summary");

  /* A declared route that needs frames blocks prompt-only video BEFORE the button, and
     says how to clear it; images are unaffected. */
  shot.deliveryRoute = "i2v";
  shot.creationBrief = { ...(shot.creationBrief || {}), brollOutput: "video" };
  const blocked = await render(`#/shot/${shot.id}`, clone(project));
  ok(blocked.html.includes('data-broll-blocked="video"'), "F: an image-to-video route blocks B-roll video, stated in the panel");
  ok(/class="broll-generate"[^>]*disabled/.test(blocked.html), "F: and the Generate button is disabled");
  ok(blocked.html.includes("Make this shot from the prompt"), "F: with the one action that clears it");
  console.log("  F · the desk: one panel, no reference step, the same targets the server compiles for");
}

/* =========================================================================== G */
/* THE PROJECT'S CONTINUITY LANGUAGE DOES NOT BECOME THE SHOT'S CONTENT.

   GENERATION_INTEGRATION_PROOF_V1 sent an "empty swamp, no one present" B-roll to MiniMax
   H3 and got an armored figure on a walk cycle beside a chair. The package carried no
   reference — but its text named the cast: the world's exclusions ("no redesign of Rex or
   the folding chair"), the world premise as the environment, the scene's feeling as
   performance direction. A Last Seat–shaped fixture, with those exact kinds of text. */
const LAST_SEAT = {
  setting: "A dead-serious fantasy quest whose visual treatment transforms from bargain-bin limited television fantasy into lavish overcooked 1980s fantasy/VHS excess while the underlying production entities remain the same.",
  include: "Absurd comedy played completely straight; mundane folding chair treated with total seriousness; same Rex, chair and gate identity across radically different rendering regimes.",
  reject: "No self-aware Rex, no magical chair, no chair used as shield or weapon.",
  negative: "No self-aware comedy mugging, no magical chair effects, no redesign of Rex or the folding chair across Looks, no generic plastic chair unless it is an intentionally rejected wrong candidate, no fake software UI.",
  global: "Absurd fantasy comedy played completely straight. Preserve the same underlying character, prop and location identities while scene-scoped rendering treatments change radically.",
  limitedTv: "Bargain-bin 1960s limited-animation television fantasy: flat colors, simplified armor, awkward proportions, sparse facial shapes, held poses, limited depth, repeated backgrounds, locked wides/mediums, lateral pans and visibly reused 4–6 frame walk cycles.",
  transition: "At the monumental gate, transform from Limited TV Fantasy into Lavish Fantasy while preserving Rex identity, black sunglasses, armor layout, chair identity and label.",
  lavish: "Gorgeous overcooked 1980s fantasy/VHS-cover animation: rich cel shading, impossible muscles, heroic rendering, golden sunset.",
  feeling: "Intentionally cheap production language played with sincere heroic stakes.",
};
const EMPTY_SWAMP = "Empty cheap swamp atmosphere, no one present: repeated dead trees, a repeated rock formation, still mud pools and simple reeds under a flat sky.";
const RIDER = "A lone hooded rider on a grey horse crosses the swamp at dusk.";
const MEDIA_FIELDS = ["image_url", "end_image_url", "image_urls", "mask_url", "reference_image_urls", "reference_video_urls", "reference_audio_urls"];
function lastSeatProject() {
  const P = clone(SAMPLE);
  P.meta.world = { setting: LAST_SEAT.setting, include: LAST_SEAT.include, reject: LAST_SEAT.reject };
  P.meta.globalNegativePrompt = LAST_SEAT.negative;
  P.meta.globalStylePrompt = LAST_SEAT.global;
  P.meta.styleBlocks = [
    { id: "look-limited-tv", name: "Limited TV Fantasy", stage: "limited-tv", text: LAST_SEAT.limitedTv },
    { id: "look-transition", name: "Threshold", stage: "transition", text: LAST_SEAT.transition },
    { id: "look-lavish", name: "Lavish Fantasy", stage: "lavish", text: LAST_SEAT.lavish },
  ];
  const base = P.shots.find((row) => row.id === "SAMPLE-01");
  Object.assign(P.scenes.find((row) => row.id === base.scene), { stage: "limited-tv", howItFeels: LAST_SEAT.feeling });
  P.characters.push({ id: "CHAR-REX", name: "Rex Vandar", visualDescription: "Barbarian with a mullet, black sunglasses, one oversized shoulder pad and a giant sword.",
    continuityStates: [{ id: "state-default", name: "Default", isDefault: true }] });
  P.props = [...(P.props || []), { id: "PROP-CHAIR", name: "Folding Chair", visualDescription: "Battered dull-gray metal folding chair with a HALL PROPERTY label.",
    approvedFile: "PROP-CHAIR.png", continuityStates: [{ id: "state-default", name: "Default", isDefault: true, approvedFile: "PROP-CHAIR.png" }] }];
  const shot = clone(base);
  Object.assign(shot, { id: "SWAMP-BROLL", title: "TEMP B-roll - empty swamp", desc: EMPTY_SWAMP, characters: [], codes: [], continuityStateSelections: {},
    risks: [], referenceMode: "style-only", keyframes: [{ id: "swamp-a", label: "A", title: "Primary frame", description: EMPTY_SWAMP, required: true }],
    clips: [], promptBuilds: [], creationBrief: { composition: { camera: { shotSize: "wide" } }, brollPrompt: EMPTY_SWAMP } });
  P.shots.push(shot);
  return P;
}
function brollRequest(P, output, prompt) {
  const pkg = BrollPackage.compileBrollPackage({ project: P, shotId: "SWAMP-BROLL", output, ...(prompt ? { prompt } : {}) });
  const withBuild = clone(P);
  const buildId = registerBroll(withBuild, "SWAMP-BROLL", pkg, { id: `g-${output}-${prompt ? "explicit" : "empty"}` });
  const plan = output === "video"
    ? compileH3ExecutionPlan({ project: withBuild, shotId: "SWAMP-BROLL", buildId, durationSeconds: 5, aspectRatio: "16:9", resolution: "768P" })
    : compileImageExecutionPlan({ project: withBuild, purpose: "frame", shotId: "SWAMP-BROLL", buildId, aspectRatio: "16:9" });
  const refuse = () => { throw new Error("a B-roll request resolved a reference"); };
  const serialized = output === "video"
    ? serializeH3PlanForFal(plan.plan, plan.capability, { resolveReference: refuse, config: { h3TextModel: "minimax/h3/text-to-video", h3ImageModel: "minimax/h3/image-to-video", h3ReferenceModel: "minimax/h3/reference-to-video" } })
    : serializeImagePlanForFal(plan.plan, plan.capability, { resolveReference: refuse, config: { textModel: "openai/gpt-image-2", editModel: "openai/gpt-image-2/edit" } });
  return { pkg, plan, serialized };
}
function testContinuityLanguageStaysOut() {
  const P = lastSeatProject();
  for (const output of ["image", "video"]) {
    const { pkg, plan, serialized } = brollRequest(P, output);
    const style = pkg.spec.visualStyle || [];
    /* THE LOOK, AS TREATMENT, SCOPED TO THIS SCENE. */
    equal(style[0], BrollPackage.BROLL_LOOK_AUTHORITY, `G ${output}: the Look is led by the statement that it renders and does not add content`);
    ok(style.includes(LAST_SEAT.limitedTv) && style.includes(LAST_SEAT.global), `G ${output}: the scene's Look and the global style are carried`);
    ok(!style.includes(LAST_SEAT.transition) && !style.includes(LAST_SEAT.lavish), `G ${output}: other scenes' Looks are not`);
    ok(style.includes(`Tone: ${LAST_SEAT.feeling}`), `G ${output}: the scene's feeling is the Look's tone`);
    equal(pkg.spec.performance.emotion, "", `G ${output}: and is no longer performance direction, which presumes a performer`);
    /* THE WORLD'S CONTINUITY LANGUAGE IS NOT CARRIED. */
    equal(pkg.spec.initialState.environment, "", `G ${output}: the world premise is not the shot's environment`);
    ok(!(pkg.spec.mustAvoid || []).some((item) => /^world violations/.test(item)), `G ${output}: nor are the world's entity exclusions`);
    ok((pkg.spec.mustAvoid || []).includes("unrequested characters, props, text or camera moves"), `G ${output}: the generic exclusions stay`);
    for (const key of ["promptEntities", "identityCanon", "visualGrounding", "driftRestatements"])
      deepEqual(pkg.spec[key] || [], [], `G ${output}: no ${key}`);
    /* WHAT THE PROVIDER IS SENT. */
    const sent = plan.compiledPrompt;
    ok(sent.includes(BrollPackage.BROLL_LOOK_AUTHORITY), `G ${output}: the provider is told the Look adds nothing`);
    ok(sent.includes(LAST_SEAT.limitedTv), `G ${output}: and is given the Look`);
    equal(sent.split(EMPTY_SWAMP).length - 1, 1, `G ${output}: the empty-shot prompt is the content, stated once`);
    for (const [label, text] of [["package prompt", pkg.compiledPrompt], ["provider prompt", sent], ["package spec", JSON.stringify(pkg.spec)]]) {
      ok(!/\bRex\b/.test(text), `G ${output}: Rex is not in the ${label}`);
      ok(!/folding chair|plastic chair/i.test(text), `G ${output}: nor is the folding chair`);
      ok(!text.includes(LAST_SEAT.setting) && !text.includes(LAST_SEAT.include) && !text.includes("world violations"), `G ${output}: nor the world's premise or rules`);
    }
    /* NO REFERENCE, NO BINDING, NO MEDIA FIELD. */
    equal(plan.plan.inputs.references.length, 0, `G ${output}: no reference in the plan`);
    deepEqual(serialized.bindings, [], `G ${output}: no provider binding`);
    for (const field of MEDIA_FIELDS) equal(serialized.input[field], undefined, `G ${output}: no ${field} in the request`);
    equal(serialized.model, output === "video" ? "minimax/h3/text-to-video" : "openai/gpt-image-2", `G ${output}: a prompt-only endpoint`);

    /* B-ROLL MEANS NO REFERENCE, NOT AN EMPTY SCENE: a subject the filmmaker writes is kept. */
    const explicit = brollRequest(P, output, RIDER);
    equal(explicit.plan.compiledPrompt.split(RIDER).length - 1, 1, `G ${output}: an explicitly written subject is the content`);
    ok(!/\bRex\b|folding chair/i.test(explicit.plan.compiledPrompt), `G ${output}: and still brings no project entity with it`);
    deepEqual(explicit.serialized.bindings, [], `G ${output}: and still no reference`);
  }
  /* REFERENCE-LED IS UNTOUCHED: the same project compiles its world, rules and feeling as before. */
  const referenceLed = PromptEngine.defaultSpec(PromptEngine.buildContext(P, "SAMPLE-01"), "shot-still", "t2i", [], null);
  ok(referenceLed.mustAvoid.some((item) => item.startsWith("world violations: ") && /\bRex\b/.test(item)), "G: a reference-led shot still carries the world's exclusions");
  equal(referenceLed.performance.emotion, LAST_SEAT.feeling, "G: and the scene's feeling as performance");
  ok(!referenceLed.visualStyle.includes(BrollPackage.BROLL_LOOK_AUTHORITY), "G: and no B-roll framing");
  console.log("  G · project continuity language stays out of B-roll: the Look renders, the shot's own content decides, no reference travels");
}

async function main() {
  testPackage();
  testContinuityLanguageStaysOut();
  testReferenceLedUnchanged();
  await testDesk();
  await startMockProvider();
  const packages = await prepareProject();
  await startServer();
  try {
    await testServer(packages);
  } finally {
    if (child) child.kill();
    if (mockServer) mockServer.close();
  }
  console.log(`B-roll generation passed: ${checks} checks — style-only images and video compile and submit with no reference, carry the project look and the prompt, record truthful provenance, change no reference, and leave reference-led generation as it was.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    if (serverOutput) console.error(serverOutput.slice(-2000));
    if (child) child.kill();
    if (mockServer) mockServer.close();
    process.exit(1);
  });
}

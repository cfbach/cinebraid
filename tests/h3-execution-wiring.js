/* MiniMax H3 execution wiring — one compiled plan, one provider request.
 *
 * C1 proved CineBraid can compile a GenerationPlan. It stopped deliberately before
 * execution, so the live path still built its own request: the browser posted a finished
 * prompt string, the server dispatched it, and the two endpoint frames were chosen by
 * their position in an array. Sending the same two approved frames in the other order
 * produced a shot that ended on its own opening frame, and nothing anywhere said so.
 *
 * This suite is the boundary. It asserts that the provider request is a SERIALISATION of
 * the compiled plan and not a second compilation — by mode, by field, by reference, and
 * by what happens when the two could disagree.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const express = require("express");

const { registerFalGeneration } = require("../fal-generation");
const { compileH3ExecutionPlan, H3ExecutionError } = require("../h3-execution");
const { compileValidatedGenerationPlan } = require("../generation-compiler");
const { serializeH3PlanForFal, H3BackendError, FAL_H3_BACKEND, falH3BackendLayer, resolveH3FalCapability } = require("../fal-h3-backend");
const H3Pack = require("../model-packs/minimax-h3");
const { resolveCapability } = require("../public/shared-generation-capability");
const { addMotionPromptBuild, baseSpec } = require("./h3-execution-fixture");
const { render, buildFixture } = require("./render-harness");

const ROOT = path.join(__dirname, "..");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5xkAAAAASUVORK5CYII=", "base64");
/* Three DIFFERENT images. Identical fixture bytes would let a test that meant to check
   "the opening and closing frames are two different files" pass on a swap. */
const PNG_BY_NAME = {
  "A.png": PNG,
  "B.png": Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"),
  "C.png": Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVQI12P4z8AAAAMBAQAY3Y2wAAAAAElFTkSuQmCC", "base64"),
};
const MP4 = Buffer.from("00000018667479706d703432000000006d703432", "hex");
const WAV = Buffer.from("524946462400000057415645666d7420", "hex");

const notes = [];
const note = (line) => notes.push(line);

const listen = (app) => new Promise((resolve) => { const server = app.listen(0, "127.0.0.1", () => resolve(server)); });
const originOf = (server) => `http://127.0.0.1:${server.address().port}`;

/* Reference URLs a project genuinely produces, so the containment allowlist is
   exercised rather than bypassed. */
const A_PNG = "/assets/shots/SH-1/takes/A.png";
const B_PNG = "/assets/shots/SH-1/takes/B.png";
const C_PNG = "/assets/shots/SH-1/takes/C.png";
const IDENTITY_PNG = "/assets/anchors/KAI.png";
const MOTION_MP4 = "/assets/media/track.mp4";
const VOICE_WAV = "/assets/audio/kai.wav";

/* Labels are production language, the way a real package carries them — "Approved
   opening frame", not the reference key. A label that repeats its own key is covered
   separately, in the negative controls. */
const REF_LABELS = {
  "kf-a": "Approved opening frame",
  "kf-b": "Approved ending frame",
  "kf-c": "Approved third frame",
  "kf-x": "Approved opening frame",
  "kf-1": "Opening beat",
  "kf-2": "Closing beat",
  "id-kai": "Kai — approved identity",
  "mo-1": "Tracking reference clip",
  "vo-kai": "Kai — approved voice",
};
const ref = (key, role, mediaType, url, extra = {}) => ({ key, label: REF_LABELS[key] || "Approved reference", role, mediaType, url, instruction: "", ...extra });

function makeProject() {
  return {
    meta: { title: "H3 wiring", aspectRatio: "16:9" },
    shots: [{ id: "SH-1", candidateFiles: [], creationBrief: {} }, { id: "SH-2", candidateFiles: [], creationBrief: {} }],
    characters: [], locations: [], props: [], vehicles: [],
    mediaAssets: [],
  };
}

async function harness() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-h3-wire-"));
  const dir = path.join(tmp, "project");
  fs.mkdirSync(path.join(dir, "shots", "SH-1", "takes"), { recursive: true });
  fs.mkdirSync(path.join(dir, "anchors"), { recursive: true });
  fs.mkdirSync(path.join(dir, "media"), { recursive: true });
  fs.mkdirSync(path.join(dir, "audio"), { recursive: true });
  for (const name of ["A.png", "B.png", "C.png"]) fs.writeFileSync(path.join(dir, "shots", "SH-1", "takes", name), PNG_BY_NAME[name]);
  fs.writeFileSync(path.join(dir, "anchors", "KAI.png"), PNG);
  fs.writeFileSync(path.join(dir, "media", "track.mp4"), MP4);
  fs.writeFileSync(path.join(dir, "audio", "kai.wav"), WAV);
  const file = path.join(dir, "project.json");
  fs.writeFileSync(file, JSON.stringify(makeProject(), null, 2));

  const calls = [];
  let providerStatus = 200;
  let providerBody = null;
  let providerDropsConnection = false;
  const mock = express();
  mock.use(express.json({ limit: "25mb" }));
  let mockOrigin = "";
  mock.post(["/minimax/h3/text-to-video", "/minimax/h3/image-to-video", "/minimax/h3/reference-to-video"], (req, res) => {
    const id = `h3-${calls.length + 1}`;
    /* THE BARRIER.
       The paid request has arrived and has not been answered. Whatever is on disk at
       this instant is exactly what a process that died mid-POST would leave behind, so
       it is captured here rather than reconstructed afterwards. */
    let ledgerAtRequest = [];
    try {
      const raw = fs.readFileSync(path.join(dir, "generation-jobs.json"), "utf8");
      ledgerAtRequest = JSON.parse(raw);
    } catch { ledgerAtRequest = []; }
    calls.push({ endpoint: req.path, body: req.body, authorization: req.headers.authorization, ledgerAtRequest });
    /* A transport failure rather than a status code: the request left, and nothing
       came back. Deterministic here, where a real timeout would only be slow. */
    if (providerDropsConnection) return req.socket.destroy();
    if (providerStatus !== 200) return res.status(providerStatus).json(providerBody || { detail: "provider refused" });
    res.json({ request_id: id, status_url: `${mockOrigin}/status/${id}`, response_url: `${mockOrigin}/result/${id}`, cancel_url: `${mockOrigin}/cancel/${id}` });
  });
  mock.get("/status/:id", (req, res) => res.json({ status: "COMPLETED" }));
  mock.get("/result/:id", (req, res) => res.json({ video: { url: `${mockOrigin}/video/${req.params.id}.mp4`, content_type: "video/mp4" } }));
  mock.get("/video/:name", (req, res) => res.type("video/mp4").send(MP4));
  mock.put("/cancel/:id", (req, res) => res.json({ ok: true }));
  const mockServer = await listen(mock);
  mockOrigin = originOf(mockServer);

  const SLUG = "h3-wiring";
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  registerFalGeneration(app, {
    readConfig: () => ({ generation: { fal: {
      enabled: true, apiKey: "fal-secret-test-key", baseUrl: mockOrigin,
      h3TextModel: "minimax/h3/text-to-video", h3ImageModel: "minimax/h3/image-to-video",
      h3ReferenceModel: "minimax/h3/reference-to-video", h3Resolution: "2K", maxConcurrent: 4,
    } } }),
    readProject: (slug = SLUG) => {
      if (slug !== SLUG) throw new Error(`No such project: ${slug}`);
      return JSON.parse(fs.readFileSync(file, "utf8"));
    },
    writeProject: (project, slug = SLUG) => {
      if (slug !== SLUG) throw new Error(`No such project: ${slug}`);
      fs.writeFileSync(file, JSON.stringify(project, null, 2));
    },
    activeSlug: () => SLUG,
    projectDirForSlug: (slug) => {
      if (slug !== SLUG) throw new Error(`No such project: ${slug}`);
      return { slug, dir, file };
    },
  });
  const appServer = await listen(app);
  const appOrigin = originOf(appServer);

  const api = async (url, options = {}) => {
    const response = await fetch(`${appOrigin}${url}`, {
      method: options.method || "POST",
      headers: { "content-type": "application/json" },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };

  return {
    dir, file, calls, appOrigin, api, tmp,
    project: () => JSON.parse(fs.readFileSync(file, "utf8")),
    saveProject: (project) => fs.writeFileSync(file, JSON.stringify(project, null, 2)),
    ledger: () => {
      const raw = path.join(dir, "generation-jobs.json");
      if (!fs.existsSync(raw)) return [];
      const parsed = JSON.parse(fs.readFileSync(raw, "utf8"));
      return Array.isArray(parsed) ? parsed : parsed.jobs || [];
    },
    setProviderFailure: (status, body) => { providerStatus = status; providerBody = body; },
    setProviderDropsConnection: (value) => { providerDropsConnection = value; },
    close: () => { mockServer.close(); appServer.close(); fs.rmSync(tmp, { recursive: true, force: true }); },
  };
}

/* The concurrency guard caps active CineBraid jobs, so a suite that submits many
   requests has to retire each one. Cancelling is terminal and leaves the durable row —
   and everything asserted here is about the request that was already sent. */
async function settle(h, jobId) {
  if (jobId) await h.api(`/api/generation/fal/jobs/${jobId}/cancel`, {});
}

/* Registers a package on SH-1 and submits it, returning the provider call it produced. */
async function submitBuild(h, buildOptions, submitOverrides = {}) {
  const project = h.project();
  const buildId = addMotionPromptBuild(project, buildOptions.shotId || "SH-1", buildOptions);
  h.saveProject(project);
  const before = h.calls.length;
  const result = await h.api("/api/generation/fal/jobs", {
    body: {
      purpose: "motion-h3",
      shotId: buildOptions.shotId || "SH-1",
      sourceBuildId: buildId,
      profileFamily: "minimax-h3",
      profileMode: buildOptions.mode,
      durationSeconds: buildOptions.durationSeconds || 8,
      resolution: "2K",
      aspectRatio: buildOptions.aspectRatio || "16:9",
      clientRequestId: `req-${buildId}-${Object.keys(submitOverrides).join("-") || "plain"}`,
      ...submitOverrides,
    },
  });
  if (result.status === 200) await settle(h, result.data.job.id);
  return { buildId, result, call: h.calls[before] || null, newCalls: h.calls.length - before };
}

async function main() {
  const h = await harness();
  try {
    /* ===================================================================
       1. PLAN CONSUMPTION — the request cannot be built without one
       =================================================================== */
    {
      /* The serializer's whole contract: it is handed a plan and a capability and
         nothing else. There is no argument through which a shot, a spec or a raw prompt
         could reach it, so it has nothing to recompile FROM. */
      assert.throws(
        () => serializeH3PlanForFal(null, {}, { resolveReference: () => "x" }),
        (error) => error instanceof H3BackendError && error.code === "H3_PLAN_INVALID",
        "the fal serializer must refuse without a compiled plan",
      );
      const source = fs.readFileSync(path.join(ROOT, "fal-h3-backend.js"), "utf8");
      const signature = source.slice(source.indexOf("function serializeH3PlanForFal"), source.indexOf("module.exports"));
      for (const token of ["spec", "shot", "profile", "directive"])
        assert(!new RegExp(`\\b${token}\\.`).test(signature), `the serializer must not read ${token}`);
      note("plan consumption: the fal serializer takes a plan and a capability and refuses without one");
    }
    {
      /* A submission carrying a finished prompt and a reference array — exactly the old
         client contract — cannot originate a new H3 request. There is no package for it
         to be a package of. */
      const before = h.calls.length;
      const legacy = await h.api("/api/generation/fal/jobs", {
        body: {
          purpose: "motion-h3", shotId: "SH-1", profileFamily: "minimax-h3", profileMode: "flf",
          prompt: "A hand-written prompt posted straight to the dispatcher.",
          durationSeconds: 8, resolution: "2K", aspectRatio: "16:9",
          references: [ref("kf-a", "first-frame", "image", A_PNG), ref("kf-b", "last-frame", "image", B_PNG)],
        },
      });
      assert.strictEqual(legacy.status, 404, `the legacy raw-prompt path must be refused, got ${legacy.status}`);
      assert.strictEqual(legacy.data.code, "H3_BUILD_NOT_FOUND");
      assert.strictEqual(h.calls.length, before, "a refused legacy submission must reach no provider");
      assert.strictEqual(h.ledger().length, 0, "and must leave no job record behind");
      note("no legacy fallback: a posted prompt + reference array cannot create a new H3 request");
    }

    /* ===================================================================
       2. T2V
       =================================================================== */
    let t2vJobId = "";
    {
      const { result, call } = await submitBuild(h, { mode: "t2v", id: "b-t2v", durationSeconds: 8, references: [] });
      assert.strictEqual(result.status, 200, JSON.stringify(result.data));
      t2vJobId = result.data.job.id;
      assert.strictEqual(call.endpoint, "/minimax/h3/text-to-video");
      const compiled = result.data.job.compilation.compiledPrompt;
      assert.strictEqual(call.body.prompt, compiled, "the compiled prompt reaches the provider unchanged");
      assert(!call.body.prompt.includes("LEGACY-PROMPT-ENGINE-TEXT"), "the stored legacy prompt must never be dispatched");
      assert.strictEqual(call.body.image_url, undefined, "text-to-video must invent no opening frame");
      assert.strictEqual(call.body.end_image_url, undefined, "and no ending frame");
      assert.strictEqual(call.body.reference_image_urls, undefined, "and no reference package");
      assert.strictEqual(call.body.aspect_ratio, "16:9", "text-to-video must name an explicit ratio");
      assert.strictEqual(call.body.resolution, "2K", "the requested resolution must survive, not the alphabetically-last one");
      note("t2v: compiled prompt dispatched verbatim, no fabricated endpoints, explicit 16:9, 2K honoured");
    }

    /* ===================================================================
       3. I2V
       =================================================================== */
    {
      const { result, call } = await submitBuild(h, {
        mode: "i2v", id: "b-i2v", durationSeconds: 8,
        references: [ref("kf-a", "first-frame", "image", A_PNG)],
      });
      assert.strictEqual(result.status, 200, JSON.stringify(result.data));
      const job = result.data.job;
      assert.strictEqual(call.endpoint, "/minimax/h3/image-to-video");
      assert.strictEqual(call.body.prompt, job.compilation.compiledPrompt);
      assert(call.body.image_url.startsWith("data:image/png;base64,"), "Frame A must reach the provider as real bytes");
      assert.strictEqual(call.body.end_image_url, undefined, "image-to-video must send no ending frame");
      assert.strictEqual(call.body.aspect_ratio, undefined, "fal's image-to-video schema has no aspect_ratio field");
      /* The plan's structured endpoint, not a sentence about an opening frame. */
      assert.strictEqual(job.compilation.plan.endpoints.firstFrame.refId, "kf-a");
      assert.strictEqual(job.providerBindings.find((b) => b.field === "image_url").refId, "kf-a");
      note("i2v: Frame A bound structurally to image_url, no end frame, no invented ratio field");
    }

    /* ===================================================================
       4. FLF — the defect this phase exists for
       =================================================================== */
    {
      /* References supplied in ENDING-FIRST order. Under the old dispatcher this made
         the last frame the opening frame. */
      const { result, call } = await submitBuild(h, {
        mode: "flf", id: "b-flf-reversed", durationSeconds: 8,
        references: [ref("kf-b", "last-frame", "image", B_PNG), ref("kf-a", "first-frame", "image", A_PNG)],
      });
      assert.strictEqual(result.status, 200, JSON.stringify(result.data));
      const job = result.data.job;
      assert.strictEqual(call.endpoint, "/minimax/h3/image-to-video", "FLF rides fal's image-to-video schema via end_image_url");
      const bind = (field) => job.providerBindings.find((row) => row.field === field);
      assert.strictEqual(bind("image_url").refId, "kf-a", "reversing the array must NOT make the ending frame the opening one");
      assert.strictEqual(bind("end_image_url").refId, "kf-b");
      assert.strictEqual(bind("image_url").role, "first-frame");
      assert.strictEqual(bind("end_image_url").role, "last-frame");
      assert.notStrictEqual(call.body.image_url, call.body.end_image_url, "two different frames must reach two different fields");
      assert.strictEqual(job.compilation.plan.endpoints.lastFrame.refId, "kf-b",
        "the ending frame is a structured binding, not prose describing an ending");
      note("flf: endpoints bound by role — an array reversed end-first still opens on Frame A");
    }
    {
      /* An FLF package with no ending frame refuses. The plan contract requires the
         binding, so this fails at compilation rather than at the provider. */
      const project = h.project();
      const buildId = addMotionPromptBuild(project, "SH-1", {
        mode: "flf", id: "b-flf-nolast", durationSeconds: 8,
        references: [ref("kf-a", "first-frame", "image", A_PNG)],
      });
      h.saveProject(project);
      const before = h.calls.length;
      const result = await h.api("/api/generation/fal/jobs", {
        body: { purpose: "motion-h3", shotId: "SH-1", sourceBuildId: buildId, profileFamily: "minimax-h3", profileMode: "flf", durationSeconds: 8, resolution: "2K", aspectRatio: "16:9" },
      });
      assert.strictEqual(result.status, 400, JSON.stringify(result.data));
      assert.strictEqual(result.data.code, "H3_PLAN_INVALID");
      assert.strictEqual(h.calls.length, before, "a missing ending frame must not reach the provider");
      note("flf: a package with no approved ending frame refuses before any paid request");
    }

    /* ===================================================================
       5. R2V — semantic references
       =================================================================== */
    {
      const { result, call } = await submitBuild(h, {
        mode: "r2v", id: "b-r2v", durationSeconds: 10, aspectRatio: "16:9",
        references: [
          ref("kf-1", "sequential-keyframe", "image", A_PNG),
          ref("kf-2", "sequential-keyframe", "image", B_PNG),
          ref("id-kai", "identity", "image", IDENTITY_PNG),
          ref("mo-1", "motion-reference", "video", MOTION_MP4),
        ],
      });
      assert.strictEqual(result.status, 200, JSON.stringify(result.data));
      const job = result.data.job;
      assert.strictEqual(call.endpoint, "/minimax/h3/reference-to-video");
      assert.strictEqual(call.body.reference_image_urls.length, 3);
      assert.strictEqual(call.body.reference_video_urls.length, 1);
      /* Deterministic order, and it is the PLAN's order: temporal waypoints lead,
         identity follows. Not the order the caller happened to store them in. */
      const imageBindings = job.providerBindings.filter((row) => row.field === "reference_image_urls");
      assert.deepStrictEqual(imageBindings.map((row) => row.refId), ["kf-1", "kf-2", "id-kai"]);
      assert.deepStrictEqual(imageBindings.map((row) => row.index), [0, 1, 2]);
      /* Every semantic role survives into the record — a reference that travelled as
         "Image 3" is still recorded as the approved identity it is. */
      const roles = job.compilation.plan.inputs.references.map((row) => row.role);
      assert.deepStrictEqual(roles, ["sequential-keyframe", "sequential-keyframe", "identity", "motion-reference"]);
      assert(job.compilation.plan.inputs.references.every((row) => row.production && row.production.purpose),
        "each reference keeps what it is FOR, in production language");
      note("r2v: 4 semantic references map deterministically, roles and production purpose survive");
    }
    {
      /* An audio-only package cannot be faked into a visual one. */
      const project = h.project();
      const buildId = addMotionPromptBuild(project, "SH-1", {
        mode: "r2v", id: "b-r2v-audio-only", durationSeconds: 8, aspectRatio: "16:9",
        references: [ref("vo-kai", "voice", "audio", VOICE_WAV)],
      });
      h.saveProject(project);
      const before = h.calls.length;
      const result = await h.api("/api/generation/fal/jobs", {
        body: { purpose: "motion-h3", shotId: "SH-1", sourceBuildId: buildId, profileFamily: "minimax-h3", profileMode: "r2v", durationSeconds: 8, resolution: "2K", aspectRatio: "16:9" },
      });
      assert.strictEqual(result.status, 400, JSON.stringify(result.data));
      assert.strictEqual(result.data.code, "H3_REFERENCE_MODALITY_UNSUPPORTED");
      assert(/audio references alone/i.test(result.data.error), "the refusal must say why, in production language");
      assert.strictEqual(h.calls.length, before);
      note("r2v: an incompatible reference package refuses honestly rather than disappearing");
    }
    {
      /* A video reference has no field on the image-to-video endpoint. The pack refuses
         it BY NAME and the plan lists only what will actually travel — a plan that
         claims a reference it does not send is a plan nobody can trust. What matters is
         that the loss is never silent: the warning is durable on the job and the preview
         route returns it, so it is on the screen before the paid button. */
      const project = h.project();
      const buildId = addMotionPromptBuild(project, "SH-1", {
        mode: "i2v", id: "b-i2v-video", durationSeconds: 8,
        references: [ref("kf-a", "first-frame", "image", A_PNG), ref("mo-1", "motion-reference", "video", MOTION_MP4)],
      });
      h.saveProject(project);
      const preview = await h.api("/api/generation/fal/h3/plan", {
        body: { shotId: "SH-1", sourceBuildId: buildId, profileMode: "i2v", durationSeconds: 8, resolution: "2K", aspectRatio: "16:9" },
      });
      assert.strictEqual(preview.status, 200, JSON.stringify(preview.data));
      const previewWarning = preview.data.warnings.find((row) => row.code === "reference-role-unsupported");
      assert(previewWarning, "the dialog is told, before any spend, that the reference will not travel");
      assert(/Tracking reference clip was not sent/.test(previewWarning.message), previewWarning.message);

      const result = await h.api("/api/generation/fal/jobs", {
        body: { purpose: "motion-h3", shotId: "SH-1", sourceBuildId: buildId, profileFamily: "minimax-h3", profileMode: "i2v", durationSeconds: 8, resolution: "2K", aspectRatio: "16:9" },
      });
      assert.strictEqual(result.status, 200, JSON.stringify(result.data));
      const call = h.calls[h.calls.length - 1];
      assert.strictEqual(call.body.reference_video_urls, undefined, "the refused reference must not reach the provider");
      assert.deepStrictEqual(result.data.job.providerBindings.map((row) => row.refId), ["kf-a"]);
      assert(result.data.job.compilation.plan.warnings.some((row) => row.code === "reference-role-unsupported"),
        "and the refusal stays on the durable job");
      assert.strictEqual(result.data.job.compilation.plan.inputs.references.length, 1,
        "the plan lists what was sent, not what was selected");
      await settle(h, result.data.job.id);
      note("i2v: a reference the endpoint cannot carry is named in a pre-spend warning, dropped from the plan, and never sent");
    }

    /* ===================================================================
       6. MODEL CAPABILITY versus BACKEND CAPABILITY
       =================================================================== */
    {
      assert.strictEqual(H3Pack.H3_FACTS.maxPromptCharacters, 7000,
        "MiniMax H3's own documented ceiling must not be overwritten by a backend's");
      assert.strictEqual(FAL_H3_BACKEND.maxPromptCharacters, 7000,
        "fal's queue schema documents no prompt maxLength and fal's model page states 7,000");
      const effective = resolveH3FalCapability("t2v", H3Pack.capabilityLayer("t2v", "api"));
      assert.strictEqual(effective.maxPromptCharacters, 7000, "the intersection of two 7,000s is 7,000");
      /* And the intersection genuinely narrows when a layer says less — proved with a
         hypothetical tighter backend rather than by mis-stating fal's. */
      const narrowed = resolveCapability({ model: H3Pack.capabilityLayer("t2v", "api"), backend: { maxPromptCharacters: 1200 } });
      assert.strictEqual(narrowed.maxPromptCharacters, 1200, "a narrower backend wins");
      assert.strictEqual(H3Pack.H3_FACTS.maxPromptCharacters, 7000, "and the model fact is untouched by it");
      note("prompt limit: model 7,000 ∩ fal 7,000 = 7,000; a narrower backend still narrows, the model fact never moves");
    }
    {
      /* The duration floors are genuinely different and stay in their own layers. */
      assert.deepStrictEqual(H3Pack.H3_FACTS.durationSeconds, [4, 15], "MiniMax documents 4 to 15 seconds");
      assert.deepStrictEqual(FAL_H3_BACKEND.durationSeconds, [5, 15], "fal documents 5 to 15");
      const effective = resolveH3FalCapability("t2v", H3Pack.capabilityLayer("t2v", "api"));
      assert.deepStrictEqual(effective.durationSeconds, [5, 15], "the intersection takes the tighter floor");
      /* A model-only configuration keeps 4. Nothing was globally rewritten to 5. */
      const modelOnly = resolveCapability({ model: H3Pack.capabilityLayer("t2v", "api") });
      assert.deepStrictEqual(modelOnly.durationSeconds, [4, 15], "without fal in the stack, 4 seconds comes back");
      note("duration: native 4–15 and fal 5–15 held separately; the intersection is 5–15 and 4 survives without fal");
    }
    {
      /* A 4-second shot is H3-valid and fal-invalid.
         It is REFUSED, not converted. A 4-second shot silently rendered as a 5-second
         shot because of which backend happens to be selected is a different shot than
         the one that was directed, and a warning buried in a plan is not a decision the
         filmmaker took. */
      const project = h.project();
      const buildId = addMotionPromptBuild(project, "SH-1", { mode: "t2v", id: "b-4s", durationSeconds: 4, references: [] });
      h.saveProject(project);
      const before = h.calls.length;
      const beforeLedger = h.ledger().length;
      const refused = await h.api("/api/generation/fal/jobs", {
        body: { purpose: "motion-h3", shotId: "SH-1", sourceBuildId: buildId, profileFamily: "minimax-h3", profileMode: "t2v", durationSeconds: 4, resolution: "2K", aspectRatio: "16:9", clientRequestId: "dur-4s" },
      });
      assert.strictEqual(refused.status, 400, JSON.stringify(refused.data));
      assert.strictEqual(refused.data.code, "H3_DURATION_UNSUPPORTED");
      assert(/4 seconds/.test(refused.data.error), "the refusal must name what was asked for");
      assert(/MiniMax H3 itself renders 4–15 seconds/.test(refused.data.error),
        `and keep the model's own range true, got: ${refused.data.error}`);
      assert(/fal backend accepts 5–15/.test(refused.data.error), "and name the backend as the thing that narrowed it");
      assert(/nothing was sent and nothing was charged/i.test(refused.data.error));
      assert.strictEqual(h.calls.length, before, "no provider POST may occur for a refused duration");
      assert.strictEqual(h.ledger().length, beforeLedger, "and a locally refused request must not litter the ledger");

      /* The filmmaker can choose 5 and retry. Same package, explicit choice, accepted. */
      const accepted = await h.api("/api/generation/fal/jobs", {
        body: { purpose: "motion-h3", shotId: "SH-1", sourceBuildId: buildId, profileFamily: "minimax-h3", profileMode: "t2v", durationSeconds: 5, resolution: "2K", aspectRatio: "16:9", clientRequestId: "dur-5s" },
      });
      assert.strictEqual(accepted.status, 200, JSON.stringify(accepted.data));
      assert.strictEqual(h.calls[h.calls.length - 1].body.duration, 5, "and 5 seconds is what is sent");
      assert.strictEqual(accepted.data.job.durationSeconds, 5);
      await settle(h, accepted.data.job.id);
      note("duration: a 4s shot is REFUSED on fal, names both ranges, reaches no provider, leaves no row — and 5s then works");
    }
    {
      /* No hidden mutation, in either direction: every in-range integer this backend
         accepts is dispatched as exactly itself. */
      for (const seconds of [5, 8, 15]) {
        const project = h.project();
        const buildId = addMotionPromptBuild(project, "SH-1", { mode: "t2v", id: `b-exact-${seconds}`, durationSeconds: seconds, references: [] });
        h.saveProject(project);
        const result = await h.api("/api/generation/fal/jobs", {
          body: { purpose: "motion-h3", shotId: "SH-1", sourceBuildId: buildId, profileFamily: "minimax-h3", profileMode: "t2v", durationSeconds: seconds, resolution: "2K", aspectRatio: "16:9", clientRequestId: `exact-${seconds}` },
        });
        assert.strictEqual(result.status, 200, JSON.stringify(result.data));
        assert.strictEqual(h.calls[h.calls.length - 1].body.duration, seconds, `${seconds}s must be dispatched as ${seconds}s`);
        assert.strictEqual(result.data.job.durationSeconds, seconds);
        assert(!result.data.job.compilation.plan.warnings.some((row) => row.code === "duration-adjusted"),
          `${seconds}s must not be adjusted at all`);
        await settle(h, result.data.job.id);
      }
      /* Above the ceiling refuses too — the rule is the range, not just the floor. */
      const project = h.project();
      const buildId = addMotionPromptBuild(project, "SH-1", { mode: "t2v", id: "b-20s", durationSeconds: 20, references: [] });
      h.saveProject(project);
      const before = h.calls.length;
      const over = await h.api("/api/generation/fal/jobs", {
        body: { purpose: "motion-h3", shotId: "SH-1", sourceBuildId: buildId, profileFamily: "minimax-h3", profileMode: "t2v", durationSeconds: 20, resolution: "2K", aspectRatio: "16:9", clientRequestId: "dur-20s" },
      });
      assert.strictEqual(over.data.code, "H3_DURATION_UNSUPPORTED");
      assert.strictEqual(h.calls.length, before);
      note("duration: 5s, 8s and 15s dispatch as themselves with no adjustment; 20s refuses like 4s does");
    }
    {
      /* The MODEL still renders from 4 seconds. Nothing was globally rewritten to 5:
         a model-only capability stack compiles a 4-second plan exactly as C1 did. */
      const modelOnly = resolveCapability({ model: H3Pack.capabilityLayer("t2v", "api") });
      assert.deepStrictEqual(modelOnly.durationSeconds, [4, 15]);
      const { plan } = compileValidatedGenerationPlan({
        mode: "t2v", modelId: "minimax-h3/fl2va", surface: "api",
        spec: baseSpec({ shotId: "SH-1", durationSeconds: 4 }), references: [], capability: modelOnly,
      });
      assert.strictEqual(plan.output.durationSeconds, 4, "native H3 still accepts a 4-second shot");
      assert(!plan.warnings.some((row) => row.code === "duration-adjusted"), "and does not adjust it");
      note("duration: model-only H3 still compiles 4 seconds unadjusted — the floor belongs to fal, not to H3");
    }
    {
      /* The dialog is where the filmmaker chooses, so a 4-second shot must still be able
         to OPEN it. The preview does not enforce; it reports both numbers so the screen
         can say what happened instead of presenting 5 as though it were the request. */
      const project = h.project();
      const buildId = addMotionPromptBuild(project, "SH-1", { mode: "t2v", id: "b-4s-preview", durationSeconds: 4, references: [] });
      h.saveProject(project);
      const before = h.calls.length;
      const preview = await h.api("/api/generation/fal/h3/plan", {
        body: { shotId: "SH-1", sourceBuildId: buildId, profileMode: "t2v", durationSeconds: 4, resolution: "2K", aspectRatio: "16:9" },
      });
      assert.strictEqual(preview.status, 200, `a 4s shot must still be able to open the dialog: ${JSON.stringify(preview.data)}`);
      assert.strictEqual(preview.data.durationRequested, 4, "the preview reports what the shot asked for");
      assert.strictEqual(preview.data.durationSeconds, 5, "and what this backend would render");
      assert.deepStrictEqual(preview.data.durationRange, [5, 15]);
      assert.deepStrictEqual(preview.data.modelDurationRange, [4, 15]);
      assert.strictEqual(h.calls.length, before, "and contacts no provider to say so");
      note("duration: a 4s shot still opens the dialog, which is told both the requested and the renderable length");
    }
    {
      /* Over the effective ceiling: refused, and refused BEFORE the provider. */
      const project = h.project();
      const spec = baseSpec({ shotId: "SH-1", durationSeconds: 8 });
      spec.mustPreserve = [("Preserve every approved surface, marking, edge, material and fitting in this shot. ").repeat(120)];
      const buildId = addMotionPromptBuild(project, "SH-1", { mode: "t2v", id: "b-long", durationSeconds: 8, references: [], spec });
      h.saveProject(project);
      const before = h.calls.length;
      const beforeLedger = h.ledger().length;
      const result = await h.api("/api/generation/fal/jobs", {
        body: { purpose: "motion-h3", shotId: "SH-1", sourceBuildId: buildId, profileFamily: "minimax-h3", profileMode: "t2v", durationSeconds: 8, resolution: "2K", aspectRatio: "16:9", prompt: "x".repeat(7001) },
      });
      assert.strictEqual(result.status, 400, JSON.stringify(result.data));
      assert.strictEqual(result.data.code, "H3_PROMPT_OVER_LIMIT");
      assert(/7,001/.test(result.data.error) && /7,000/.test(result.data.error), "the refusal must name both numbers");
      assert(/nothing was sent and nothing was charged/i.test(result.data.error));
      assert.strictEqual(h.calls.length, before, "an over-limit prompt must not reach the provider");
      assert.strictEqual(h.ledger().length, beforeLedger, "and must leave no job behind");
      note("prompt limit: 7,001 characters refuses before any paid POST and names both numbers");
    }
    {
      /* Nothing anywhere trims a prompt to fit. */
      const backend = fs.readFileSync(path.join(ROOT, "fal-h3-backend.js"), "utf8");
      const serializer = backend.slice(backend.indexOf("function serializeH3PlanForFal"));
      assert(!/\.slice\(0,\s*(promptCeiling|limit|max)/.test(serializer), "the serializer must never truncate a prompt");
      assert(/Refused, never trimmed/.test(backend), "and must say why");
      note("prompt limit: no truncation path exists in the serializer — over-limit is a refusal");
    }

    /* ===================================================================
       7. JOB PROVENANCE
       =================================================================== */
    {
      const job = h.ledger().find((row) => row.id === t2vJobId);
      const c = job.compilation;
      assert(c, "the durable job must carry its compilation");
      assert.strictEqual(c.plan.compiler.packId, "minimax-h3", "which pack compiled it");
      assert(c.plan.compiler.packVersion, "and which version of it");
      assert.strictEqual(typeof c.compiledPrompt, "string");
      assert(c.plan.endpoints, "which endpoints were bound");
      assert(Array.isArray(c.plan.inputs.references), "which references were selected");
      assert(c.plan.model.modelId, "which model");
      assert.strictEqual(job.backendId, "fal-queue", "and which backend");
      assert(c.plan.settings, "what settings were requested");
      assert(c.capability.maxPromptCharacters, "what capability restrictions applied");
      assert(Array.isArray(c.plan.coverage) && c.plan.coverage.length, "where every piece of intent ended up");
      assert(Array.isArray(c.plan.warnings), "and what could not be carried");
      assert(job.providerRequest, "and what was actually sent");
      assert.strictEqual(c.source.shotId, "SH-1");
      assert(c.source.buildId, "traceable back to the package it was compiled from");
      /* Provenance is a record, not a copy of the production. */
      assert.strictEqual(c.plan.inputs.references.length, 0);
      assert(!JSON.stringify(c).includes("\"shots\":"), "the job must not duplicate the project document");
      assert(!JSON.stringify(job).includes("fal-secret-test-key"), "no provider secret may reach the ledger");
      assert(!JSON.stringify(job.providerRequest).includes("base64"), "no media bytes may reach the ledger");
      /* Provider identifiers append without displacing the compilation. */
      assert(job.externalId, "the provider request id is recorded");
      note("provenance: compiler identity, prompt, endpoints, references, capability, coverage and the sent request all durable");
    }
    {
      /* A manual edit is distinguishable from the compiled original — both survive. */
      const EDIT = "The filmmaker's own words, sent instead of the compiled text.";
      const { result, call } = await submitBuild(h, { mode: "t2v", id: "b-edited", durationSeconds: 8, references: [] }, { prompt: EDIT });
      assert.strictEqual(result.status, 200, JSON.stringify(result.data));
      const job = result.data.job;
      assert.strictEqual(call.body.prompt, EDIT, "the edited prompt is what is sent");
      assert.strictEqual(job.promptEdited, true);
      assert.strictEqual(job.prompt, EDIT, "the submitted prompt is recorded");
      assert.notStrictEqual(job.compilation.compiledPrompt, EDIT, "and the compiled prompt survives beside it");
      assert(job.compilation.compiledPrompt.length > 100, "the compiled original is kept whole, not a stub");
      /* An edit changes the TEXT and nothing else: the structured direction it was
         compiled from is untouched, so coverage still describes the compiler's work. */
      assert(Array.isArray(job.compilation.plan.coverage) && job.compilation.plan.coverage.length);
      assert.strictEqual(job.compilation.plan.inputs.prompt, job.compilation.compiledPrompt,
        "the plan keeps the compiled prompt; a manual edit never rewrites the plan");
      /* Coverage must not transfer to text it was not computed from. The compiler's own
         record is unchanged, and the edit is re-checked with the same deterministic
         substance test rather than being assumed still to satisfy it. */
      const edited = job.compilation.editedCoverage;
      assert(edited, "an edited submission must carry a re-check of what the edit kept");
      assert(edited.checked.length > 5, "the re-check must actually cover the compiler's claims");
      assert(edited.lost.some((row) => row.intent === "camera.movement"),
        `wiping the prompt must be recorded as losing the camera move, got ${JSON.stringify(edited.lost.map((r) => r.intent))}`);
      assert(job.compilation.plan.coverage.some((row) => row.intent === "camera.movement" && row.state === "represented"),
        "and the compiler's own coverage stays a true record of what CineBraid wrote");
      note("intent coverage: an edited prompt is re-checked deterministically and the losses are named, not absorbed");
    }
    {
      /* An unedited submission carries no re-check, because there is nothing to re-check. */
      const { result } = await submitBuild(h, { mode: "t2v", id: "b-nocheck", durationSeconds: 8, references: [] });
      assert.strictEqual(result.data.job.compilation.editedCoverage, undefined,
        "an unedited submission needs no coverage re-check");
      note("prompt provenance: compiled and submitted prompts both durable and distinguishable, plan unchanged by an edit");
    }
    {
      /* No edit: the two are identical and the flag says so. */
      const { result, call } = await submitBuild(h, { mode: "t2v", id: "b-unedited", durationSeconds: 8, references: [] });
      const job = result.data.job;
      assert.strictEqual(job.promptEdited, false);
      assert.strictEqual(job.prompt, job.compilation.compiledPrompt);
      assert.strictEqual(call.body.prompt, job.compilation.compiledPrompt);
      note("prompt provenance: an unedited submission sends exactly the compiled prompt and is marked unedited");
    }

    /* ===================================================================
       8. THE PREVIEW IS THE REQUEST
       =================================================================== */
    {
      const project = h.project();
      const buildId = addMotionPromptBuild(project, "SH-1", {
        mode: "flf", id: "b-preview", durationSeconds: 9,
        references: [ref("kf-a", "first-frame", "image", A_PNG), ref("kf-b", "last-frame", "image", B_PNG)],
      });
      h.saveProject(project);
      const before = h.calls.length;
      const preview = await h.api("/api/generation/fal/h3/plan", {
        body: { shotId: "SH-1", sourceBuildId: buildId, profileMode: "flf", durationSeconds: 9, resolution: "2K", aspectRatio: "16:9" },
      });
      assert.strictEqual(preview.status, 200, JSON.stringify(preview.data));
      assert.strictEqual(h.calls.length, before, "a preview must contact no provider");
      assert.strictEqual(h.ledger().length, h.ledger().length, "and write nothing durable");
      assert.strictEqual(preview.data.maxPromptCharacters, 7000);
      assert.deepStrictEqual(preview.data.durationRange, [5, 15]);
      assert.deepStrictEqual(preview.data.modelDurationRange, [4, 15]);
      assert.strictEqual(preview.data.carriesAspectRatio, false, "flf sends no aspect ratio and the screen is told so");

      const submitted = await h.api("/api/generation/fal/jobs", {
        body: { purpose: "motion-h3", shotId: "SH-1", sourceBuildId: buildId, profileFamily: "minimax-h3", profileMode: "flf", durationSeconds: 9, resolution: "2K", aspectRatio: "16:9" },
      });
      assert.strictEqual(submitted.status, 200, JSON.stringify(submitted.data));
      const call = h.calls[h.calls.length - 1];
      assert.strictEqual(call.body.prompt, preview.data.compiledPrompt,
        "what the dialog showed is byte-for-byte what the provider received");
      assert.strictEqual(call.body.duration, preview.data.durationSeconds);
      assert.strictEqual(call.body.resolution, preview.data.resolution);
      assert.deepStrictEqual(
        submitted.data.job.providerBindings.map((row) => `${row.field}:${row.refId}`),
        preview.data.dispatch.bindings.map((row) => `${row.field}:${row.refId}`),
        "and the reference bindings the dialog listed are the ones that were used",
      );
      await settle(h, submitted.data.job.id);
      note("request equality: the preview's prompt, duration, resolution and bindings are exactly what was dispatched");
    }

    /* ===================================================================
       9. PAID-REQUEST SAFETY AND ERROR BEHAVIOUR
       =================================================================== */
    {
      /* Every typed refusal, and none of them reaches the provider. */
      const cases = [
        { name: "unknown package", body: { sourceBuildId: "no-such-build" }, code: "H3_BUILD_NOT_FOUND" },
        { name: "mode mismatch", build: { mode: "t2v", id: "b-mismatch", references: [] }, mode: "r2v", code: "H3_MODE_MISMATCH" },
      ];
      for (const testCase of cases) {
        let buildId = testCase.body?.sourceBuildId || "";
        if (testCase.build) {
          const project = h.project();
          buildId = addMotionPromptBuild(project, "SH-1", { durationSeconds: 8, ...testCase.build });
          h.saveProject(project);
        }
        const before = h.calls.length;
        const result = await h.api("/api/generation/fal/jobs", {
          body: { purpose: "motion-h3", shotId: "SH-1", sourceBuildId: buildId, profileFamily: "minimax-h3", profileMode: testCase.mode || "t2v", durationSeconds: 8, resolution: "2K", aspectRatio: "16:9" },
        });
        assert(result.status >= 400, `${testCase.name} must refuse`);
        assert.strictEqual(result.data.code, testCase.code, `${testCase.name}: ${JSON.stringify(result.data)}`);
        assert.strictEqual(h.calls.length, before, `${testCase.name} must not reach the provider`);
        assert(!/\n\s+at /.test(String(result.data.error)), `${testCase.name} must not expose a stack trace`);
      }
      note(`errors: ${cases.length} typed refusals, each before the provider and without a stack trace`);
    }
    {
      /* A reference whose file has gone is caught on the way in, not after a charge. */
      const project = h.project();
      const buildId = addMotionPromptBuild(project, "SH-1", {
        mode: "i2v", id: "b-missing-file", durationSeconds: 8,
        references: [ref("kf-x", "first-frame", "image", "/assets/shots/SH-1/takes/GONE.png")],
      });
      h.saveProject(project);
      const before = h.calls.length;
      const result = await h.api("/api/generation/fal/jobs", {
        body: { purpose: "motion-h3", shotId: "SH-1", sourceBuildId: buildId, profileFamily: "minimax-h3", profileMode: "i2v", durationSeconds: 8, resolution: "2K", aspectRatio: "16:9" },
      });
      assert.strictEqual(result.status, 400, JSON.stringify(result.data));
      assert.strictEqual(h.calls.length, before);
      assert.strictEqual(h.ledger().find((row) => row.compilation?.source?.buildId === buildId), undefined,
        "a pre-flight refusal leaves no orphan job");
      note("paid safety: a deleted approved frame refuses at pre-flight with no job row and no provider call");
    }

    /* ===================================================================
       10. C1 GUARANTEES SURVIVE EXECUTION
       =================================================================== */
    {
      const job = h.ledger().find((row) => row.id === t2vJobId);
      const plan = job.compilation.plan;
      /* No raw identifier reached the model-facing text. */
      for (const identifier of plan.provenance.entityIdentifiers)
        assert(!plan.inputs.prompt.includes(identifier), `the prompt leaked ${identifier}`);
      /* Every unsupported intent is named by a warning — the silent-loss rule, still
         holding after the plan has been through a provider request. */
      const warned = new Set(plan.warnings.map((row) => String(row.intent || "")));
      for (const entry of plan.coverage)
        if (entry.state === "unsupported") assert(warned.has(entry.intent), `${entry.intent} lost silently`);
      note("c1 regressions: identifier sanitation and no-silent-loss both hold on a dispatched plan");
    }
    {
      /* No assistant, no clock, no network in the compilation layer. */
      for (const file of ["h3-execution.js", "fal-h3-backend.js"]) {
        const code = fs.readFileSync(path.join(ROOT, file), "utf8");
        for (const forbidden of ["require(\"./llm\")", "require(\"../llm\")", "fetch(", "Math.random", "Date.now"])
          assert(!code.includes(forbidden), `${file} must not contain ${forbidden}`);
      }
      note("safety: no LLM, no network and no clock in the execution-compilation layer");
    }
    {
      /* MediaAsset stays dormant: an H3 generation mints no asset. */
      const project = h.project();
      assert(Array.isArray(project.mediaAssets), "the array still exists");
      assert.strictEqual(project.mediaAssets.length, 0, "and nothing has been added to it");
      const anyJob = h.ledger().find((row) => row.compilation);
      assert(anyJob.compilation.plan.inputs.references.every((row) => row.source.kind !== "media-asset"),
        "no plan reference may claim a minted asset identity");
      note("mediaasset: dormant — no asset minted and no reference claims an assetId");
    }
    {
      /* Seed remains unsupported at both layers; nothing invented one. */
      assert.strictEqual(H3Pack.H3_FACTS.seed.supported, false);
      assert.strictEqual(FAL_H3_BACKEND.seed.supported, false);
      const capability = resolveH3FalCapability("t2v", H3Pack.capabilityLayer("t2v", "api"));
      assert.strictEqual(capability.flags.seed, false);
      for (const call of h.calls) assert.strictEqual(call.body.seed, undefined, "no request may carry a fabricated seed");
      const job = h.ledger().find((row) => row.id === t2vJobId);
      assert.strictEqual(job.compilation.plan.settings.seedMode, "random");
      assert.strictEqual(job.compilation.plan.settings.seed, undefined);
      note("seed: unsupported by MiniMax and by fal, absent from every request, generic architecture untouched");
    }

    /* ===================================================================
       11. CONCURRENCY, PROVIDER FAILURE AND OLD JOBS
       =================================================================== */
    {
      /* Two overlapping H3 submissions each keep their own plan. */
      const project = h.project();
      const one = addMotionPromptBuild(project, "SH-1", { mode: "i2v", id: "b-conc-1", durationSeconds: 6, references: [ref("kf-a", "first-frame", "image", A_PNG)] });
      const two = addMotionPromptBuild(project, "SH-1", { mode: "i2v", id: "b-conc-2", durationSeconds: 12, references: [ref("kf-c", "first-frame", "image", C_PNG)] });
      h.saveProject(project);
      const body = (buildId, seconds) => ({ purpose: "motion-h3", shotId: "SH-1", sourceBuildId: buildId, profileFamily: "minimax-h3", profileMode: "i2v", durationSeconds: seconds, resolution: "2K", aspectRatio: "16:9", clientRequestId: `conc-${buildId}` });
      const [a, b] = await Promise.all([
        h.api("/api/generation/fal/jobs", { body: body(one, 6) }),
        h.api("/api/generation/fal/jobs", { body: body(two, 12) }),
      ]);
      assert.strictEqual(a.status, 200, JSON.stringify(a.data));
      assert.strictEqual(b.status, 200, JSON.stringify(b.data));
      assert.notStrictEqual(a.data.job.id, b.data.job.id);
      assert.strictEqual(a.data.job.compilation.source.buildId, one);
      assert.strictEqual(b.data.job.compilation.source.buildId, two);
      assert.strictEqual(a.data.job.durationSeconds, 6);
      assert.strictEqual(b.data.job.durationSeconds, 12);
      const ledger = h.ledger();
      assert(ledger.find((row) => row.id === a.data.job.id), "both rows survive the overlap");
      assert(ledger.find((row) => row.id === b.data.job.id));
      assert.strictEqual(ledger.find((row) => row.id === a.data.job.id).compilation.source.buildId, one,
        "neither overlapping submission may inherit the other's plan");
      await settle(h, a.data.job.id);
      await settle(h, b.data.job.id);
      note("concurrency: two overlapping H3 submissions keep separate plans, durations and ledger rows");
    }
    {
      /* A provider error fails the job and never invents a result.
         422 rather than 502 since C1.2: a 4xx is the provider reading the request and
         declining it, which is a KNOWN failure. A 5xx says nothing about whether the job
         was queued first and is now classified as uncertainty instead. */
      h.setProviderFailure(422, { detail: "the provider declined this prompt" });
      const { result } = await submitBuild(h, { mode: "t2v", id: "b-provider-fail", durationSeconds: 8, references: [] });
      h.setProviderFailure(200, null);
      assert.strictEqual(result.status, 502, JSON.stringify(result.data));
      assert.strictEqual(result.data.job.status, "FAILED");
      assert(result.data.job.compilation, "a failed job still keeps the plan it was compiled from");
      assert.deepStrictEqual(result.data.job.outputs, [], "and fabricates no output");
      note("provider failure: the job fails, keeps its compilation, and invents no result");
    }
    {
      /* A job stored before this wiring can still be read and cancelled, but cannot
         originate a new provider request. */
      const before = h.ledger();
      const legacyRow = {
        ...before[0], id: "legacy-job-1", status: "IN_QUEUE", externalId: "legacy-ext",
        compilation: undefined, prompt: "an old prompt", ingestedAt: "",
      };
      delete legacyRow.compilation;
      /* The ledger on disk is a bare array — writing any other shape is a corrupt
         ledger, which this module refuses rather than treating as empty. */
      fs.writeFileSync(path.join(h.dir, "generation-jobs.json"), JSON.stringify([...before, legacyRow], null, 2));
      const listed = await fetch(`${h.appOrigin}/api/generation/fal/jobs`).then((r) => r.json());
      assert(listed.jobs.find((row) => row.id === "legacy-job-1"), "an old job stays readable");
      const cancelled = await h.api("/api/generation/fal/jobs/legacy-job-1/cancel", {});
      assert.strictEqual(cancelled.status, 200, JSON.stringify(cancelled.data));
      assert.strictEqual(cancelled.data.job.status, "CANCELLED", "and stays cancellable");
      note("legacy jobs: readable and cancellable, but the legacy shape cannot originate a new request");
    }

    /* ===================================================================
       11b. THE REMAINING ADVERSARIAL CASES
       =================================================================== */
    {
      /* Mixed modalities, exactly where fal supports them. */
      const { result, call } = await submitBuild(h, {
        mode: "r2v", id: "b-mixed", durationSeconds: 8, aspectRatio: "16:9",
        references: [
          ref("kf-1", "sequential-keyframe", "image", A_PNG),
          ref("mo-1", "motion-reference", "video", MOTION_MP4),
          ref("vo-kai", "voice", "audio", VOICE_WAV),
        ],
      });
      assert.strictEqual(result.status, 200, JSON.stringify(result.data));
      assert.strictEqual(call.body.reference_image_urls.length, 1);
      assert.strictEqual(call.body.reference_video_urls.length, 1);
      assert.strictEqual(call.body.reference_audio_urls.length, 1);
      const fields = result.data.job.providerBindings.map((row) => row.field);
      assert(fields.includes("reference_image_urls") && fields.includes("reference_video_urls") && fields.includes("reference_audio_urls"));
      note("r2v: image, video and audio references each reach their own fal field");
    }
    {
      /* More images than the backend accepts. The pack refuses the excess BY NAME and
         the plan carries only what travels; the serializer would refuse a plan that
         somehow still carried too many. Both halves are checked. */
      const many = Array.from({ length: 11 }, (_, index) =>
        ref(`kf-${index + 1}`, "sequential-keyframe", "image", [A_PNG, B_PNG, C_PNG][index % 3]));
      const { result, call } = await submitBuild(h, { mode: "r2v", id: "b-overmax", durationSeconds: 8, aspectRatio: "16:9", references: many });
      assert.strictEqual(result.status, 200, JSON.stringify(result.data));
      assert.strictEqual(call.body.reference_image_urls.length, 9, "fal accepts nine images and nine is what is sent");
      const refusals = result.data.job.compilation.plan.warnings.filter((row) => row.code === "reference-over-limit");
      assert.strictEqual(refusals.length, 2, "each reference that could not travel is named");
      assert.strictEqual(result.data.job.compilation.plan.inputs.references.length, 9,
        "the plan lists nine, not eleven — a plan that claims more than it sends is untrustworthy");
      /* And the serializer is not relying on the pack to have done it. */
      const overloaded = {
        ...result.data.job.compilation.plan,
        inputs: {
          ...result.data.job.compilation.plan.inputs,
          references: many.map((row, index) => ({ refId: row.key, role: row.role, mediaType: "image", source: { kind: "project-asset", path: row.url }, production: { label: row.label }, required: true, order: index })),
        },
      };
      assert.throws(
        () => serializeH3PlanForFal(overloaded, result.data.job.compilation.capability, { resolveReference: () => "x", config: {} }),
        (error) => error.code === "H3_REFERENCE_OVER_LIMIT",
        "the serializer refuses an over-limit package independently of the pack",
      );
      note("references: eleven images become nine sent + two named refusals, and the serializer refuses eleven on its own");
    }
    {
      /* Exactly at the effective ceiling is accepted; one over is not. The boundary is
         checked from both sides so an off-by-one cannot hide. */
      const project = h.project();
      const buildId = addMotionPromptBuild(project, "SH-1", { mode: "t2v", id: "b-boundary", durationSeconds: 8, references: [] });
      h.saveProject(project);
      const exact = await h.api("/api/generation/fal/jobs", {
        body: { purpose: "motion-h3", shotId: "SH-1", sourceBuildId: buildId, profileFamily: "minimax-h3", profileMode: "t2v", durationSeconds: 8, resolution: "2K", aspectRatio: "16:9", prompt: "y".repeat(7000), clientRequestId: "boundary-exact" },
      });
      assert.strictEqual(exact.status, 200, `exactly 7,000 characters must be accepted: ${JSON.stringify(exact.data)}`);
      assert.strictEqual(h.calls[h.calls.length - 1].body.prompt.length, 7000, "and reach the provider whole");
      await settle(h, exact.data.job.id);
      const before = h.calls.length;
      const over = await h.api("/api/generation/fal/jobs", {
        body: { purpose: "motion-h3", shotId: "SH-1", sourceBuildId: buildId, profileFamily: "minimax-h3", profileMode: "t2v", durationSeconds: 8, resolution: "2K", aspectRatio: "16:9", prompt: "y".repeat(7001), clientRequestId: "boundary-over" },
      });
      assert.strictEqual(over.status, 400);
      assert.strictEqual(over.data.code, "H3_PROMPT_OVER_LIMIT");
      assert.strictEqual(h.calls.length, before);
      note("prompt limit: exactly 7,000 is sent whole; 7,001 refuses — the boundary holds from both sides");
    }
    {
      /* The provider never answers. The job fails with a readable reason, keeps its
         compilation, and invents nothing. */
      h.setProviderDropsConnection(true);
      const { result } = await submitBuild(h, { mode: "t2v", id: "b-timeout", durationSeconds: 8, references: [] });
      h.setProviderDropsConnection(false);
      assert.strictEqual(result.status, 502, JSON.stringify(result.data));
      /* Since C1.2 this is UNRESOLVED, not FAILED: the request had already crossed the
         provider boundary, so the outcome is unknown rather than known to have failed.
         The properties C1.1 cares about are unchanged — a reason, the plan, no invented
         result — and are asserted here against the state that now carries them. */
      assert.strictEqual(result.data.job.status, "UNRESOLVED");
      assert(result.data.job.error, "the failure carries a reason");
      assert(result.data.job.compilation, "and the plan survives the failure");
      assert.deepStrictEqual(result.data.job.outputs, []);
      await h.api(`/api/generation/fal/jobs/${result.data.job.id}/reconcile`, { body: { outcome: "not-accepted" } });
      note("provider transport failure: the outcome is recorded as unknown, keeps its plan, and fabricates no result");
    }
    {
      /* A restart: the row is re-read from disk with nothing in memory, and everything
         needed to explain and continue the request is still there. */
      const { result } = await submitBuild(h, { mode: "i2v", id: "b-restart", durationSeconds: 8, references: [ref("kf-a", "first-frame", "image", A_PNG)] });
      assert.strictEqual(result.status, 200, JSON.stringify(result.data));
      const fromDisk = h.ledger().find((row) => row.id === result.data.job.id);
      assert(fromDisk, "the row survives to disk");
      assert(fromDisk.externalId, "with the provider request id");
      assert(fromDisk.compilation.plan.compiler.packId, "and the compiler that produced it");
      assert.strictEqual(fromDisk.compilation.plan.endpoints.firstFrame.refId, "kf-a", "and the endpoint binding");
      assert.strictEqual(fromDisk.compiledPrompt, result.data.job.compilation.compiledPrompt);
      const listed = await fetch(`${h.appOrigin}/api/generation/fal/jobs`).then((r) => r.json());
      const publicRow = listed.jobs.find((row) => row.id === result.data.job.id);
      assert(publicRow, "and is still readable through the API after the fact");
      assert.strictEqual(publicRow.providerRequest, undefined, "while the raw provider request stays server-side");
      assert(publicRow.compilation, "the compilation is what a screen may show");
      note("durability: a submitted job re-reads from disk with its plan, endpoints, prompt and provider id intact");
    }

    /* ===================================================================
       11c. THE DIALOG SHOWS THE PLAN
       =================================================================== */
    {
      /* The screen is where the promise is made: a filmmaker confirms a prompt and a
         set of inputs, and expects those to be what is sent. Rendered for real, against
         the compilation the server would produce. */
      const fixture = buildFixture();
      const shot = fixture.shots.find((row) => row.id === "L1-01");
      shot.creationBrief = shot.creationBrief && typeof shot.creationBrief === "object" ? shot.creationBrief : {};
      const buildId = addMotionPromptBuild(fixture, "L1-01", {
        mode: "flf", id: "ui-flf", durationSeconds: 9,
        references: [ref("kf-b", "last-frame", "image", B_PNG), ref("kf-a", "first-frame", "image", A_PNG)],
      });
      const compiled = compileH3ExecutionPlan({
        project: JSON.parse(JSON.stringify(fixture)), shotId: "L1-01", buildId,
        durationSeconds: 9, resolution: "2K", aspectRatio: "16:9",
      });
      const serialized = serializeH3PlanForFal(compiled.plan, compiled.capability, { resolveReference: () => "preflight", config: {} });
      const previewPayload = {
        ok: true, refusal: null,
        dispatch: { model: "minimax/h3/image-to-video", backendId: "fal-queue", bindings: serialized.bindings },
        mode: compiled.mode, profile: compiled.profile, source: compiled.source,
        compiledPrompt: compiled.compiledPrompt, compiledPromptCharacters: compiled.compiledPrompt.length,
        maxPromptCharacters: compiled.capability.maxPromptCharacters,
        modelMaxPromptCharacters: 7000, backendMaxPromptCharacters: FAL_H3_BACKEND.maxPromptCharacters,
        durationSeconds: compiled.plan.output.durationSeconds,
        durationRange: compiled.capability.durationSeconds, modelDurationRange: [4, 15],
        resolution: "2K", resolutions: compiled.capability.resolutions,
        aspectRatio: "", carriesAspectRatio: false,
        endpoints: compiled.plan.endpoints,
        references: compiled.plan.inputs.references.map((row) => ({
          refId: row.refId, role: row.role, mediaType: row.mediaType, order: row.order,
          required: row.required, label: row.production.label, purpose: row.production.purpose,
        })),
        coverage: compiled.plan.coverage, warnings: compiled.plan.warnings,
        compiler: compiled.plan.compiler, seedSupported: false,
      };

      const view = await render("#/shot/L1-01", fixture, { storage: { "cinebraid-focused:fixture:shot-task:L1-01": "motion" } });
      /* CONFIG is a top-level `let` inside the evaluated client scripts, so it is a
         lexical binding rather than a property of the contextified global — assigning
         to context.CONFIG from out here would create a second, invisible one. */
      vm.runInContext(`CONFIG = { ...(typeof CONFIG === "object" ? CONFIG : {}), generation: { fal: { enabled: true, apiKey: "test-key" } } };`, view.context);
      assert.strictEqual(view.context.falGenerationReady(), true, "the fixture must present FAL as configured");
      let requestedPlan = null;
      view.context.fetch = async (url, options) => {
        requestedPlan = { url, body: JSON.parse(options.body) };
        return { ok: true, json: async () => previewPayload };
      };
      await view.context.openFalH3MotionModal("L1-01", buildId);
      /* The binding list, the cost estimate and the counter are filled on the next tick,
         the way the real dialog does it after the modal is in the DOM. */
      await new Promise((resolve) => setTimeout(resolve, 25));
      const modal = view.context.document.getElementById("modal").innerHTML;

      assert(requestedPlan, "the dialog must ask the server to compile the plan");
      assert.strictEqual(requestedPlan.url, "/api/generation/fal/h3/plan");
      assert.strictEqual(requestedPlan.body.sourceBuildId, buildId);
      /* The compiled prompt is in the editor — not the prompt-engine text the package
         also stores. That substitution is the whole point of the screen change. */
      assert(modal.includes(compiled.compiledPrompt.slice(0, 60).replace(/&/g, "&amp;").replace(/</g, "&lt;")),
        "the editor must contain the compiled prompt");
      assert(!modal.includes("LEGACY-PROMPT-ENGINE-TEXT"), "the legacy stored prompt must not be offered as the thing being sent");
      /* The limit shown is the effective one, and the stale number is gone. */
      assert(modal.includes("/7,000"), "the character counter must show the effective ceiling");
      assert(!modal.includes("/2,000"), "the stale 2,000-character limit must not appear on the screen");
      /* Duration options come from the effective range, not a hard-coded 5..15.
         READ FROM THE PANEL, not from the modal string. The output settings moved into
         the shared Simple/Advanced block, which — like the provider-input list asserted a
         few lines below — is filled after the modal is in the DOM. The harness models the
         document as a flat id map, so a sub-container's innerHTML is never part of its
         parent's; asserting against `modal` here would report a control that is on the
         real screen as missing. */
      const settings = view.context.document.getElementById("fal-h3-generation-view").innerHTML;
      assert(settings.includes(">5 seconds<") && settings.includes(">15 seconds<"),
        `the effective duration range must be offered, got: ${settings.slice(0, 300)}`);
      assert(!settings.includes(">4 seconds<"), "a duration the backend cannot render must not be offered");
      assert(settings.includes("MiniMax H3 itself renders 4–15s; this backend renders 5–15s"),
        "the screen must say which layer set the floor");
      /* Simple is the default, and duration is a production decision that stays in it. */
      assert(settings.includes('data-gen-view="simple"'), "the dialog must open on Simple");
      /* No seed control on any H3 endpoint, and none is offered — derived from the
         capability rather than from this dialog knowing about MiniMax. */
      assert(!settings.includes('id="fal-h3-seed"'), "H3 documents no seed, so no seed control may be drawn");
      assert(modal.includes("compiled by minimax-h3"), "and say what compiled it");
      /* The provider input list is filled after the modal is in the DOM, so it is read
         from its own panel rather than from the modal string. */
      const sequence = view.context.document.getElementById("fal-h3-sequence").innerHTML;
      assert(sequence.includes("Opening frame") && sequence.includes("Final frame"),
        `the dialog must name which reference fills which provider field, got: ${sequence.slice(0, 200)}`);
      assert(sequence.includes("Approved opening frame") && sequence.includes("Approved ending frame"),
        "and name the approved frames in production language");
      /* The order shown is the plan's: opening frame before final frame, whatever order
         the package stored them in — and this package stored them ending-first. */
      assert(sequence.indexOf("Approved opening frame") < sequence.indexOf("Approved ending frame"),
        "the listed order must be the plan's, not the package's array order");
      note("ui: the dialog compiles through the server, shows the compiled prompt, the effective 7,000 ceiling and the real provider bindings");

      /* A 4-second shot: the dialog must OPEN — refusing here would be a dead end,
         since the dialog is the only place the filmmaker can choose a valid length —
         and it must say plainly that the length will not be changed for them. */
      const shortView = await render("#/shot/L1-01", fixture, { storage: { "cinebraid-focused:fixture:shot-task:L1-01": "motion" } });
      vm.runInContext(`CONFIG = { ...(typeof CONFIG === "object" ? CONFIG : {}), generation: { fal: { enabled: true, apiKey: "test-key" } } };`, shortView.context);
      shortView.context.fetch = async () => ({
        ok: true,
        json: async () => ({ ...previewPayload, durationRequested: 4, durationSeconds: 5 }),
      });
      await shortView.context.openFalH3MotionModal("L1-01", buildId);
      await new Promise((resolve) => setTimeout(resolve, 25));
      const shortModal = shortView.context.document.getElementById("modal").innerHTML;
      assert(shortModal.includes("h3-generation-modal"), "a 4-second shot must still be able to open the dialog");
      assert(shortModal.includes("written as 4 seconds"), "the dialog must name the length the shot asks for");
      assert(shortModal.includes("refused, not adjusted"), "and state that submitting it will refuse rather than convert");
      const shortSettings = shortView.context.document.getElementById("fal-h3-generation-view").innerHTML;
      assert(shortSettings.includes(">5 seconds<") && !shortSettings.includes(">4 seconds<"),
        "and offer only the lengths this backend can render");
      note("ui: a 4s shot opens the dialog, is told 4s will be refused rather than converted, and is offered only 5–15s");
    }

    /* ===================================================================
       11d. THE DURABLE ROW EXISTS BEFORE THE PAID POST
       =================================================================== */
    {
      /* The invariant: a paid fal POST must never leave CineBraid without a durable job
         record representing that attempt. Asserted at the only moment that proves it —
         inside the provider handler, with the request received and unanswered — against
         what is actually on disk, not against what the response later says. */
      const { result, call } = await submitBuild(h, {
        mode: "flf", id: "b-barrier", durationSeconds: 9,
        references: [ref("kf-b", "last-frame", "image", B_PNG), ref("kf-a", "first-frame", "image", A_PNG)],
      });
      assert.strictEqual(result.status, 200, JSON.stringify(result.data));
      const jobId = result.data.job.id;
      const atRequest = call.ledgerAtRequest.find((row) => row.id === jobId);
      assert(atRequest, "the durable row must already exist when the paid request arrives at the provider");
      assert.strictEqual(atRequest.status, "SUBMITTING",
        "and must say a submission is in flight, so a crash here reads as 'may have been charged'");
      /* Enough to reconcile without the response ever coming back. */
      assert(atRequest.compilation && atRequest.compilation.plan, "the row carries the compiled plan");
      assert.strictEqual(atRequest.compilation.plan.compiler.packId, "minimax-h3");
      assert.strictEqual(atRequest.model, "minimax/h3/image-to-video",
        "the row already names the fal endpoint the paid request went to");
      assert.strictEqual(atRequest.backendId, "fal-queue");
      assert.strictEqual(atRequest.modelFamily, "minimax-h3");
      assert.deepStrictEqual(
        atRequest.providerBindings.map((row) => `${row.field}:${row.refId}`),
        ["image_url:kf-a", "end_image_url:kf-b"],
        "and which reference filled which provider field",
      );
      assert.strictEqual(atRequest.shotId, "SH-1");
      assert(atRequest.createdAt, "with a timestamp to reconcile against a provider dashboard");
      assert(atRequest.compilation.source.buildId, "and the package it came from");
      /* The provider identifiers are the one thing that cannot exist yet — they only
         exist in the answer. Everything needed to go and FIND them is already durable. */
      assert(!atRequest.externalId, "the provider request id cannot exist before the answer");
      /* Ordering, stated as an assertion rather than as a comment: the row that was on
         disk at request time is the same row the response returns, advanced. */
      const settled = h.ledger().find((row) => row.id === jobId);
      assert.strictEqual(settled.compilation.compiledPrompt, atRequest.compilation.compiledPrompt);
      assert.strictEqual(settled.model, atRequest.model, "the endpoint recorded before the POST is the one used");
      note("paid safety: at the instant the paid POST reaches the provider, the durable row already carries the plan, the endpoint, the backend and every binding");
    }
    {
      /* A locally refused request must not leave a row behind — the ledger records
         attempts to spend, not attempts to validate. */
      const beforeLedger = h.ledger().length;
      const beforeCalls = h.calls.length;
      const project = h.project();
      const buildId = addMotionPromptBuild(project, "SH-1", {
        mode: "flf", id: "b-no-litter", durationSeconds: 8,
        references: [ref("kf-a", "first-frame", "image", A_PNG)],
      });
      h.saveProject(project);
      const refused = await h.api("/api/generation/fal/jobs", {
        body: { purpose: "motion-h3", shotId: "SH-1", sourceBuildId: buildId, profileFamily: "minimax-h3", profileMode: "flf", durationSeconds: 8, resolution: "2K", aspectRatio: "16:9", clientRequestId: "no-litter" },
      });
      assert(refused.status >= 400);
      assert.strictEqual(h.ledger().length, beforeLedger, "local validation failure must not create a durable row");
      assert.strictEqual(h.calls.length, beforeCalls, "nor reach the provider");
      note("paid safety: a locally refused request creates no ledger row — the ledger records spending attempts, not validation attempts");
    }
    {
      /* Failure immediately after the POST. The request WAS sent and the answer never
         came, so the row must be reconcilable and must not read as "nothing happened". */
      h.setProviderDropsConnection(true);
      const { result, call } = await submitBuild(h, { mode: "t2v", id: "b-post-crash", durationSeconds: 8, references: [] });
      h.setProviderDropsConnection(false);
      assert.strictEqual(result.status, 502, JSON.stringify(result.data));
      assert(call, "the request reached the provider before the failure");
      const row = h.ledger().find((r) => r.id === result.data.job.id);
      /* C1.1 recorded this as FAILED-but-contacted. C1.2 promoted the distinction into
         the state itself, which is what this assertion now holds: a request that may
         have been charged is never presented as a known ordinary failure. */
      assert.strictEqual(row.status, "UNRESOLVED");
      assert.strictEqual(row.providerContacted, true,
        "a failure that already left the machine must be distinguishable from one that never did");
      assert.strictEqual(row.providerAnswered, false, "a dropped connection is not a provider refusal");
      assert(/may have been accepted and charged/i.test(row.error),
        `the recorded reason must warn that a charge is possible, got: ${row.error}`);
      assert(/minimax\/h3\/text-to-video/.test(row.error), "and name the endpoint to check");
      assert(row.compilation && row.compilation.plan, "the plan survives for reconciliation");
      assert.strictEqual(row.model, "minimax/h3/text-to-video", "as does the endpoint it went to");
      note("paid safety: a failure after the POST is recorded as provider-contacted, names the endpoint, and keeps the plan to reconcile against");
    }
    {
      /* A provider that answers and declines is unambiguous — nothing to reconcile. */
      h.setProviderFailure(422, { detail: "prompt rejected" });
      const { result } = await submitBuild(h, { mode: "t2v", id: "b-post-declined", durationSeconds: 8, references: [] });
      h.setProviderFailure(200, null);
      assert.strictEqual(result.status, 502);
      const row = h.ledger().find((r) => r.id === result.data.job.id);
      assert.strictEqual(row.status, "FAILED");
      assert.strictEqual(row.providerContacted, true);
      assert.strictEqual(row.providerAnswered, true, "an answered refusal is not an orphan");
      note("paid safety: an answered provider refusal is marked as answered, so it is not mistaken for a possible charge");
    }

    /* ===================================================================
       12. THE COMPILER IS THE SAME COMPILER, TWICE
       =================================================================== */
    {
      /* Determinism is what lets the preview promise anything. Same package, same
         settings, byte-identical plan — no clock, no counter, no ordering luck. */
      const project = h.project();
      const buildId = addMotionPromptBuild(project, "SH-2", {
        mode: "flf", id: "b-determinism", durationSeconds: 8,
        references: [ref("kf-b", "last-frame", "image", B_PNG), ref("kf-a", "first-frame", "image", A_PNG)],
      });
      const compile = () => compileH3ExecutionPlan({
        project: JSON.parse(JSON.stringify(project)), shotId: "SH-2", buildId,
        durationSeconds: 8, resolution: "2K", aspectRatio: "16:9",
      });
      const first = compile();
      const second = compile();
      assert.strictEqual(JSON.stringify(first.plan), JSON.stringify(second.plan), "the same package must compile byte-identically");
      assert.strictEqual(first.plan.endpoints.firstFrame.refId, "kf-a");
      note("determinism: identical input compiles byte-identically, which is what the preview promises");
    }

    console.log(`\nMiniMax H3 execution-wiring suite passed:\n  ${notes.join("\n  ")}\n`);
  } finally {
    h.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

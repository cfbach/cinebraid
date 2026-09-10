/* GPT Image 2 execution wiring — one compiled plan, one provider request.
 *
 * C2a shipped a GPT Image 2 model pack and nothing dispatched through it. The live
 * image path took the browser's finished prompt string, derived pixel dimensions from
 * an aspect ratio and a long edge, and posted the result — the shape C1 exists to
 * remove, still running under a phase that had proved it did not have to.
 *
 * This suite is the boundary. It asserts that a still-image provider request is a
 * SERIALISATION of a compiled plan and not a second compilation: by mode, by field, by
 * reference, by what a still cannot carry, and by what happens when the two could
 * disagree. It is the image sibling of h3-execution-wiring.js and asserts the same
 * properties, because a second modality that needed different guarantees would mean the
 * guarantees were never architectural.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");

const { registerFalGeneration } = require("../src/generation/fal/fal-generation");
const { compileImageExecutionPlan, ImageExecutionError, resolveImageMode, IMAGE_MODEL_ID } = require("../src/generation/image-execution");
const {
  FAL_IMAGE_BACKEND, FalImageBackendError, falImageBackendLayer, imageSizeField,
  resolveImageFalCapability, serializeImagePlanForFal,
} = require("../src/generation/fal/fal-image-backend");
const ImagePack = require("../model-packs/gpt-image-2");
const { validateGenerationPlan } = require("../src/generation/generation-contracts");
const { withGenerationDeclaration } = require("./generation-request-fixture");
const {
  addBlockingPromptBuild, addFramePromptBuild, baseSpec, buildRef,
  FRAME_A, REF_IDENTITY, REF_LOCATION, REF_PROP,
} = require("./image-execution-fixture");

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5xkAAAAASUVORK5CYII=", "base64");
const PNG_B = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const notes = [];
const note = (line) => notes.push(line);

const listen = (app) => new Promise((resolve) => { const server = app.listen(0, "127.0.0.1", () => resolve(server)); });
const originOf = (server) => `http://127.0.0.1:${server.address().port}`;

const KAI_PNG = "/assets/anchors/KAI.png";
const HANGAR_PNG = "/assets/plates/HANGAR.png";
const PARCEL_PNG = "/assets/props/PARCEL.png";
const PLATE_PNG = "/assets/shots/SH-1/takes/A.png";

function makeProject(title = "Image wiring") {
  return {
    meta: { title, aspectRatio: "16:9" },
    shots: [
      { id: "SH-1", candidateFiles: [], creationBrief: {} },
      { id: "SH-2", candidateFiles: [], creationBrief: {} },
    ],
    characters: [], locations: [], props: [], vehicles: [],
    mediaAssets: [],
  };
}

async function harness() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-img-wire-"));
  const dirs = { A: path.join(tmp, "project-a"), B: path.join(tmp, "project-b") };
  const files = {};
  for (const [slug, dir] of Object.entries(dirs)) {
    fs.mkdirSync(path.join(dir, "shots", "SH-1", "takes"), { recursive: true });
    fs.mkdirSync(path.join(dir, "shots", "SH-1", "blocking"), { recursive: true });
    fs.mkdirSync(path.join(dir, "anchors"), { recursive: true });
    fs.mkdirSync(path.join(dir, "plates"), { recursive: true });
    fs.mkdirSync(path.join(dir, "props"), { recursive: true });
    fs.writeFileSync(path.join(dir, "shots", "SH-1", "takes", "A.png"), PNG_B);
    fs.writeFileSync(path.join(dir, "anchors", "KAI.png"), PNG);
    fs.writeFileSync(path.join(dir, "plates", "HANGAR.png"), PNG);
    fs.writeFileSync(path.join(dir, "props", "PARCEL.png"), PNG);
    files[slug] = path.join(dir, "project.json");
    fs.writeFileSync(files[slug], JSON.stringify(makeProject(`Project ${slug}`), null, 2));
  }

  const calls = [];
  let providerStatus = 200;
  let providerBody = null;
  let providerDropsConnection = false;
  let providerOmitsRequestId = false;
  const mock = express();
  mock.use(express.json({ limit: "25mb" }));
  let mockOrigin = "";
  mock.post(["/openai/gpt-image-2", "/openai/gpt-image-2/edit"], (req, res) => {
    const id = `img-${calls.length + 1}`;
    calls.push({ endpoint: req.path, body: req.body, authorization: req.headers.authorization });
    if (providerDropsConnection) return req.socket.destroy();
    if (providerStatus !== 200) return res.status(providerStatus).json(providerBody || { detail: "provider refused" });
    if (providerOmitsRequestId) return res.json({ ok: true });
    res.json({ request_id: id, status_url: `${mockOrigin}/status/${id}`, response_url: `${mockOrigin}/result/${id}`, cancel_url: `${mockOrigin}/cancel/${id}` });
  });
  mock.get("/status/:id", (req, res) => res.json({ status: "COMPLETED" }));
  mock.get("/result/:id", (req, res) => res.json({
    images: [{ url: `${mockOrigin}/image/${req.params.id}-1.png`, content_type: "image/png" }],
  }));
  mock.get("/image/:name", (req, res) => res.type("image/png").send(PNG));
  mock.put("/cancel/:id", (req, res) => res.json({ ok: true }));
  const mockServer = await listen(mock);
  mockOrigin = originOf(mockServer);

  let active = "A";
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  registerFalGeneration(app, {
    readConfig: () => ({ generation: { fal: {
      enabled: true, apiKey: "fal-secret-test-key", baseUrl: mockOrigin,
      textModel: "openai/gpt-image-2", editModel: "openai/gpt-image-2/edit", maxConcurrent: 4,
    } } }),
    readProject: (slug = active) => {
      if (!files[slug]) throw new Error(`No such project: ${slug}`);
      return JSON.parse(fs.readFileSync(files[slug], "utf8"));
    },
    writeProject: (project, slug = active) => {
      if (!files[slug]) throw new Error(`No such project: ${slug}`);
      fs.writeFileSync(files[slug], JSON.stringify(project, null, 2));
    },
    activeSlug: () => active,
    projectDirForSlug: (slug) => {
      if (!files[slug]) throw new Error(`No such project: ${slug}`);
      return { slug, dir: dirs[slug], file: files[slug] };
    },
  });
  const appServer = await listen(app);
  const appOrigin = originOf(appServer);

  const api = async (url, options = {}) => {
    const response = await fetch(`${appOrigin}${url}`, {
      method: options.method || "POST",
      headers: { "content-type": "application/json" },
      ...(options.body ? { body: JSON.stringify(await withGenerationDeclaration(url, options.body, { origin: appOrigin })) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };

  return {
    dirs, files, calls, api, tmp,
    project: (slug = active) => JSON.parse(fs.readFileSync(files[slug], "utf8")),
    saveProject: (project, slug = active) => fs.writeFileSync(files[slug], JSON.stringify(project, null, 2)),
    ledger: (slug = active) => {
      const raw = path.join(dirs[slug], "generation-jobs.json");
      if (!fs.existsSync(raw)) return [];
      const parsed = JSON.parse(fs.readFileSync(raw, "utf8"));
      return Array.isArray(parsed) ? parsed : parsed.jobs || [];
    },
    switchProject: (slug) => { active = slug; },
    activeSlug: () => active,
    setProviderFailure: (status, body) => { providerStatus = status; providerBody = body; },
    setProviderDropsConnection: (value) => { providerDropsConnection = value; },
    setProviderOmitsRequestId: (value) => { providerOmitsRequestId = value; },
    close: () => { mockServer.close(); appServer.close(); fs.rmSync(tmp, { recursive: true, force: true }); },
  };
}

async function settle(h, jobId) {
  if (jobId) await h.api(`/api/generation/fal/jobs/${jobId}/cancel`, {});
}

/* ---------------------------------------------------------------------------
   Pure compilation, without a server. */

function compile(options = {}) {
  const project = makeProject();
  const purpose = options.purpose || "blocking";
  const buildId = purpose === "blocking"
    ? addBlockingPromptBuild(project, "SH-1", options.build || {})
    : addFramePromptBuild(project, "SH-1", options.build || {});
  return compileImageExecutionPlan({
    project,
    purpose,
    shotId: "SH-1",
    buildId,
    aspectRatio: options.aspectRatio === undefined ? "16:9" : options.aspectRatio,
    ...(options.resolution ? { resolution: options.resolution } : {}),
    ...(options.quality ? { quality: options.quality } : {}),
    ...(options.candidateCount ? { candidateCount: options.candidateCount } : {}),
    ...(options.submittedPrompt ? { submittedPrompt: options.submittedPrompt } : {}),
  });
}
const state = (plan, intent) => (plan.coverage.find((row) => row.intent === intent) || {}).state || "MISSING";

async function main() {
  /* ===========================================================================
     1. THE PLAN IS THE REQUEST, AND IT IS A STILL. */

  {
    const compiled = compile({ purpose: "blocking" });
    assert.strictEqual(compiled.mode, "blocking", "a blocking package compiles the blocking mode");
    assert.strictEqual(compiled.plan.outputType, "image");
    assert.strictEqual(compiled.plan.model.modelId, IMAGE_MODEL_ID);
    assert(validateGenerationPlan(compiled.plan).ok, "the compiled plan must satisfy the plan contract");

    /* THE LEAK C2a FOUND, asserted at the execution boundary rather than in the
       compiler. The fixture shot is eight seconds long, carries a camera move and a
       spoken line; none of them may reach a still-image request. */
    assert.strictEqual(compiled.plan.output.durationSeconds, undefined, "a still image has no duration");
    assert.strictEqual(compiled.plan.output.fps, undefined, "a still image has no frame rate");
    assert.strictEqual(compiled.plan.output.audio, undefined, "a still image carries no audio mode");
    /* And the shot's real duration is ACCOUNTED FOR rather than dropped. */
    assert.strictEqual(state(compiled.plan, "timing.duration"), "omitted-by-design",
      "the shot's length must be recorded as deliberately omitted, not silently lost");
    assert.strictEqual(state(compiled.plan, "dialogue.line"), "omitted-by-design");
    assert.strictEqual(state(compiled.plan, "camera.movement"), "omitted-by-design");
    note("a blocking plan is a still: no duration, no fps, no audio, and the shot's length recorded as omitted-by-design");
  }

  /* Determinism: the same package compiles to the same plan, which is what lets a
     preview promise what a submission sends. */
  {
    const a = compile({ purpose: "blocking" });
    const b = compile({ purpose: "blocking" });
    assert.deepStrictEqual(a.plan, b.plan, "the same package must compile to an identical plan");
    assert.strictEqual(a.compiledPrompt, b.compiledPrompt);
  }

  /* Mode is read from the package, never declared by a caller. */
  {
    assert.strictEqual(resolveImageMode("blocking", []), "blocking");
    assert.strictEqual(resolveImageMode("frame", []), "t2i");
    assert.strictEqual(resolveImageMode("frame", [{ role: "identity" }]), "multi-reference");
    assert.strictEqual(resolveImageMode("frame", [{ role: "base" }]), "edit");
    assert.strictEqual(resolveImageMode("frame", [{ role: "base" }, { role: "mask" }]), "inpaint");
  }

  /* ===========================================================================
     2. THE APPROVED REFERENCES SURVIVE, WITH THEIR PRODUCTION MEANING. */

  {
    const references = [
      buildRef(REF_IDENTITY, KAI_PNG),
      buildRef(REF_LOCATION, HANGAR_PNG),
      buildRef(REF_PROP, PARCEL_PNG),
    ];
    const compiled = compile({ purpose: "frame", build: { references } });
    assert.strictEqual(compiled.mode, "multi-reference");
    const sent = compiled.plan.inputs.references;
    assert.strictEqual(sent.length, 3, "every approved reference must reach the plan");
    assert.deepStrictEqual(sent.map((row) => row.role), ["identity", "location", "prop"],
      "the planner's canonical order is what the plan carries");
    for (const row of sent) {
      assert(row.production.label, "a reference must carry its production label");
      assert(row.source.path, "a reference must carry the address its bytes live at");
      assert(!/^https?:/.test(row.source.path), "an address is project-relative, not a provider URL");
    }
    /* Identity is ANCHORED by the reference, not restated in prose competing with it. */
    assert.strictEqual(state(compiled.plan, "identity.canon"), "anchored");
    note(`a three-reference frame keeps identity, location and prop in canonical order with identity anchored to its image`);
  }

  /* ===========================================================================
     3. THE SERIALIZER RENAMES; IT DOES NOT RECOMPILE. */

  {
    const compiled = compile({ purpose: "blocking" });
    const serialized = serializeImagePlanForFal(compiled.plan, compiled.capability, {
      resolveReference: () => "inline", config: { textModel: "openai/gpt-image-2" },
    });
    assert.strictEqual(serialized.input.prompt, compiled.plan.inputs.prompt,
      "the prompt sent is the prompt compiled, byte for byte");
    assert.strictEqual(serialized.model, "openai/gpt-image-2", "blocking has no image input, so it takes the text route");
    assert.strictEqual(serialized.input.image_urls, undefined);
    assert.strictEqual(serialized.input.quality, "low", "a blocking frame renders at the cheapest documented tier");
    assert.strictEqual(serialized.input.duration, undefined, "no video field may appear on an image request");
    /* The size is the model's own documented one, converted to fal's field. */
    assert.deepStrictEqual(serialized.input.image_size, { width: 2048, height: 1152 },
      "a 16:9 shot renders at a size GPT Image 2 documents");
    note(`the serializer sends ${JSON.stringify(serialized.input.image_size)} — a documented GPT Image 2 size, not a derived long edge`);
  }

  /* Reference-bearing modes take the /edit route, because fal's text route has no image
     field at all. Bound by role, and recorded. */
  {
    const references = [buildRef(REF_IDENTITY, KAI_PNG), buildRef(REF_LOCATION, HANGAR_PNG)];
    const compiled = compile({ purpose: "frame", build: { references } });
    const serialized = serializeImagePlanForFal(compiled.plan, compiled.capability, {
      resolveReference: (row) => `bytes:${row.refId}`,
      config: { editModel: "openai/gpt-image-2/edit" },
    });
    assert.strictEqual(serialized.model, "openai/gpt-image-2/edit");
    assert.deepStrictEqual(serialized.input.image_urls, ["bytes:id-kai", "bytes:loc-hangar"]);
    assert.deepStrictEqual(serialized.bindings.map((row) => [row.refId, row.field, row.index]),
      [["id-kai", "image_urls", 0], ["loc-hangar", "image_urls", 1]],
      "which reference filled which provider slot is recorded, not inferred later");
  }

  /* A plan's ORDER wins over the array's. Two references handed over in the other order
     must serialize identically — the property the H3 endpoint swap violated. */
  {
    const forwards = compile({ purpose: "frame", build: { references: [buildRef(REF_IDENTITY, KAI_PNG), buildRef(REF_LOCATION, HANGAR_PNG)] } });
    const backwards = compile({ purpose: "frame", build: { references: [buildRef(REF_LOCATION, HANGAR_PNG), buildRef(REF_IDENTITY, KAI_PNG)] } });
    const one = serializeImagePlanForFal(forwards.plan, forwards.capability, { resolveReference: (row) => row.refId, config: {} });
    const two = serializeImagePlanForFal(backwards.plan, backwards.capability, { resolveReference: (row) => row.refId, config: {} });
    assert.deepStrictEqual(one.input.image_urls, two.input.image_urls,
      "reference ORDER in the package must not change what the provider receives");
  }

  /* A manual prompt edit replaces the TEXT and reaches nothing else. */
  {
    const compiled = compile({ purpose: "blocking" });
    const serialized = serializeImagePlanForFal(compiled.plan, compiled.capability, {
      resolveReference: () => "inline", config: {}, promptOverride: "A different sentence entirely.",
    });
    assert.strictEqual(serialized.input.prompt, "A different sentence entirely.");
    assert.strictEqual(serialized.promptEdited, true);
    assert.deepStrictEqual(serialized.input.image_size, { width: 2048, height: 1152 },
      "an edited prompt must not move the size");
    assert.strictEqual(serialized.input.quality, "low", "an edited prompt must not move the quality tier");
  }

  /* ===========================================================================
     4. SIZE IS A DOCUMENTED VALUE, CHECKED AGAINST FAL'S RULE. */

  {
    const rules = FAL_IMAGE_BACKEND.dimensionRules;
    for (const size of ImagePack.GPT_IMAGE_2_FACTS.sizes) {
      if (size === "auto") { assert.strictEqual(imageSizeField(size, "t2i"), "auto"); continue; }
      const field = imageSizeField(size, "t2i");
      const pixels = field.width * field.height;
      assert.strictEqual(field.width % rules.edgeMultiple, 0, `${size}: edges must be multiples of ${rules.edgeMultiple}`);
      assert.strictEqual(field.height % rules.edgeMultiple, 0, `${size}: edges must be multiples of ${rules.edgeMultiple}`);
      assert(Math.max(field.width, field.height) <= rules.maxEdge, `${size}: over fal's edge ceiling`);
      assert(pixels >= rules.minTotalPixels && pixels <= rules.maxTotalPixels,
        `${size}: ${pixels} pixels is outside fal's documented ${rules.minTotalPixels}-${rules.maxTotalPixels}`);
    }
    /* And the size the pre-C2b path would have asked for at 16:9/1k is exactly the one
       fal's rule refuses. Refused by NAME and by NUMBER, never snapped to fit. */
    assert.throws(() => imageSizeField("1024x576", "t2i"), (error) =>
      error instanceof FalImageBackendError
      && error.code === "IMAGE_BACKEND_SIZE_INVALID"
      && /589,824|589824/.test(error.message),
      "the sub-minimum size the old path produced must be refused with its pixel count");
    note(`every documented GPT Image 2 size satisfies fal's four dimension rules; 1024x576 does not and is refused by name`);
  }

  /* A ratio the model has no size for is refused rather than quietly squared. */
  {
    const compiled = compile({ purpose: "blocking", aspectRatio: "1:3" });
    assert.strictEqual(state(compiled.plan, "output.aspectRatio"), "unsupported");
    assert(compiled.plan.warnings.some((row) => row.code === "aspect-unsupported"),
      "an unsupported format must warn rather than be silently replaced");
  }

  /* ===========================================================================
     5. TYPED REFUSALS, ALL OF THEM BEFORE A PROVIDER CALL. */

  {
    const compiled = compile({ purpose: "blocking" });
    /* A plan that acquired a duration is not a still-image plan. */
    const videoish = { ...compiled.plan, output: { ...compiled.plan.output, durationSeconds: 8 } };
    assert.throws(() => serializeImagePlanForFal(videoish, compiled.capability, { resolveReference: () => "x", config: {} }),
      (error) => error.code === "IMAGE_BACKEND_PLAN_NOT_STILL",
      "a duration on an image plan is refused, not dropped");

    /* References on a route with no image field. */
    const withRefs = {
      ...compiled.plan,
      inputs: { ...compiled.plan.inputs, references: [{ refId: "x", role: "identity", mediaType: "image", order: 0, source: { kind: "project-asset", path: KAI_PNG } }] },
    };
    assert.throws(() => serializeImagePlanForFal(withRefs, compiled.capability, { resolveReference: () => "x", config: {} }),
      (error) => error.code === "IMAGE_REFERENCE_UNSUPPORTED");

    /* An empty prompt. */
    const empty = { ...compiled.plan, inputs: { ...compiled.plan.inputs, prompt: "   " } };
    assert.throws(() => serializeImagePlanForFal(empty, compiled.capability, { resolveReference: () => "x", config: {} }),
      (error) => error.code === "IMAGE_PROMPT_EMPTY");

    /* A mode fal does not serve. */
    assert.throws(() => serializeImagePlanForFal({ ...compiled.plan, mode: "outpaint" }, compiled.capability, { resolveReference: () => "x", config: {} }),
      (error) => error.code === "IMAGE_BACKEND_MODE_UNSUPPORTED");
  }

  /* A build with no stored spec cannot be compiled, and guessing one back out of its
     finished prompt is exactly the second compilation this layer removes. */
  {
    assert.throws(() => compile({ purpose: "blocking", build: { spec: null } }),
      (error) => error instanceof ImageExecutionError && error.code === "IMAGE_SPEC_MISSING");
    assert.throws(() => compileImageExecutionPlan({ project: makeProject(), purpose: "blocking", shotId: "SH-9" }),
      (error) => error.code === "IMAGE_SHOT_NOT_FOUND");
    assert.throws(() => compileImageExecutionPlan({ project: makeProject(), purpose: "blocking", shotId: "SH-1" }),
      (error) => error.code === "IMAGE_BUILD_NOT_FOUND");
  }

  /* CONTAINMENT: a build id is only usable through the shot that owns it. */
  {
    const project = makeProject();
    const buildId = addFramePromptBuild(project, "SH-1", {});
    assert.throws(() => compileImageExecutionPlan({ project, purpose: "frame", shotId: "SH-2", buildId }),
      (error) => error.code === "IMAGE_BUILD_NOT_FOUND",
      "one shot's package must not compile through another shot");
    note("containment: a frame package registered on SH-1 cannot be compiled through SH-2");
  }

  /* ===========================================================================
     6. MODEL ∩ BACKEND, AND WHICH LAYER SAID WHAT. */

  {
    const layer = falImageBackendLayer("t2i");
    assert.strictEqual(layer.maxReferenceImages, 0, "fal's text route carries no image input");
    assert.strictEqual(falImageBackendLayer("multi-reference").maxReferenceImages, 16);
    assert.strictEqual(falImageBackendLayer("edit").flags.mask, true);
    assert.strictEqual(falImageBackendLayer("multi-reference").flags.mask, false,
      "mask_url exists on the edit route only");
    /* The backend declares no `resolutions`, because fal imposes a rule and not a list.
       So the effective size list is the MODEL's, unnarrowed — which is the whole reason
       a rule must not be encoded as a grid. */
    assert.strictEqual(layer.resolutions, undefined);
    const capability = resolveImageFalCapability("t2i", ImagePack.capabilityLayer("t2i", "api"));
    assert.deepStrictEqual(capability.resolutions, [...ImagePack.GPT_IMAGE_2_FACTS.sizes].sort(),
      "the effective size list is the model's documented one");
    assert.strictEqual(capability.flags.seed, false, "neither OpenAI nor fal documents a seed");
    assert.strictEqual(capability.maxPromptCharacters, null, "no layer documents a prompt ceiling for this family");
  }

  /* ===========================================================================
     7. THE LIVE PATH. */

  const h = await harness();
  try {
    /* --- a blocking frame, end to end --- */
    const project = h.project();
    const blockingBuild = addBlockingPromptBuild(project, "SH-1", {});
    h.saveProject(project);

    const preview = await h.api("/api/generation/fal/image/plan", {
      body: { purpose: "blocking", shotId: "SH-1", sourceBuildId: blockingBuild, aspectRatio: "16:9" },
    });
    assert.strictEqual(preview.status, 200);
    assert.strictEqual(preview.data.ok, true, "the preview must compile");
    assert.strictEqual(preview.data.mode, "blocking");
    assert.strictEqual(preview.data.dispatch.model, "openai/gpt-image-2");
    assert.strictEqual(h.calls.length, 0, "a preview contacts no provider");
    assert.strictEqual(h.ledger().length, 0, "a preview writes nothing durable");

    const before = h.calls.length;
    const submitted = await h.api("/api/generation/fal/jobs", {
      body: {
        purpose: "blocking", imagePlan: true, shotId: "SH-1", sourceBuildId: blockingBuild,
        aspectRatio: "16:9", outputCount: 2, clientRequestId: "img-blocking-1",
      },
    });
    assert.strictEqual(submitted.status, 200, `submission failed: ${JSON.stringify(submitted.data)}`);
    assert.strictEqual(h.calls.length, before + 1, "exactly one provider request");
    const call = h.calls[before];
    assert.strictEqual(call.endpoint, "/openai/gpt-image-2");
    assert.strictEqual(call.body.prompt, preview.data.compiledPrompt,
      "what was sent is what the preview showed — the compiler is deterministic and both sides ran it");
    assert(!/LEGACY-BLOCKING-PROMPT-TEXT/.test(call.body.prompt),
      "the prompt stored on the package is NOT the request; the spec is, and it is recompiled");
    assert.strictEqual(call.body.num_images, 2, "the requested option count reaches the provider");
    assert.deepStrictEqual(call.body.image_size, { width: 2048, height: 1152 });
    assert.strictEqual(call.body.duration, undefined, "no video field on an image request");
    note("the preview and the paid submission produce the identical prompt, because both compile the same stored package");

    /* --- a manual edit replaces the words and nothing else, and BOTH survive --- */
    const editedBefore = h.calls.length;
    const edited = await h.api("/api/generation/fal/jobs", {
      body: {
        purpose: "blocking", imagePlan: true, shotId: "SH-1", sourceBuildId: blockingBuild,
        aspectRatio: "16:9", outputCount: 1, clientRequestId: "img-blocking-edited",
        prompt: "Kai stands at frame left. Flat greyscale blocking, no production detail.",
      },
    });
    assert.strictEqual(edited.status, 200);
    const editedCall = h.calls[editedBefore];
    assert.strictEqual(editedCall.body.prompt, "Kai stands at frame left. Flat greyscale blocking, no production detail.",
      "the words that reach the model are the filmmaker's");
    assert.deepStrictEqual(editedCall.body.image_size, { width: 2048, height: 1152 },
      "an edit moves the text and reaches nothing else");
    const editedRow = h.ledger().find((row) => row.id === edited.data.job.id);
    assert.strictEqual(editedRow.promptEdited, true, "the record says it was edited");
    assert.strictEqual(editedRow.compiledPrompt, preview.data.compiledPrompt,
      "and keeps what CineBraid wrote beside what was sent");
    assert.notStrictEqual(editedRow.prompt, editedRow.compiledPrompt);
    assert(editedRow.compilation.plan, "the compiled plan is preserved whole under the edit");
    await settle(h, edited.data.job.id);
    note("a manually edited prompt is sent verbatim while the compiled original, its coverage and its plan are all kept");

    /* --- and an UNEDITED submission records the two as identical --- */
    {
      const row = h.ledger().find((r) => r.id === submitted.data.job.id);
      assert.strictEqual(row.promptEdited, false, "an unedited submission is recorded as unedited");
      assert.strictEqual(row.prompt, row.compiledPrompt, "and the two prompts are the same string");
    }

    /* --- the durable record --- */
    const job = h.ledger().find((row) => row.id === submitted.data.job.id);
    assert(job.compilation && job.compilation.plan, "the job keeps the plan it was minted from");
    assert.strictEqual(job.compilation.plan.outputType, "image");
    assert.strictEqual(job.model, "openai/gpt-image-2", "the endpoint is recorded BEFORE the POST, not from the answer");
    assert.strictEqual(job.modelFamily, "gpt-image-2");
    assert.strictEqual(job.backendId, "fal-queue");
    assert.strictEqual(job.resolution, "2048x1152", "provenance records the size that was actually asked for");
    assert.strictEqual(submitted.data.job.providerRequest, undefined, "the request body never leaves the server");

    /* --- the result returns to the owning shot, through the existing candidate flow --- */
    const refreshed = await h.api(`/api/generation/fal/jobs/${job.id}/refresh`, {});
    assert.strictEqual(refreshed.status, 200);
    assert.strictEqual(refreshed.data.job.status, "COMPLETED");
    const after = h.project("A");
    const asset = (after.mediaAssets || []).find((row) => row.generationRecord?.jobId === job.id);
    assert(asset, "a blocking result lands as a media asset on the owning project");
    assert(asset.storagePath.startsWith("shots/SH-1/blocking/"), "and inside the owning shot");
    assert(fs.existsSync(path.join(h.dirs.A, asset.storagePath)), "the bytes are on disk where the record says");
    assert.strictEqual(asset.generationRecord.model, "openai/gpt-image-2");
    note("a blocking result returns to the owning shot through the existing blocking media flow — no second gallery");

    await settle(h, job.id);

    /* --- a frame with approved references, through the edit route --- */
    const p2 = h.project();
    const frameBuild = addFramePromptBuild(p2, "SH-1", {
      references: [buildRef(REF_IDENTITY, KAI_PNG), buildRef(REF_LOCATION, HANGAR_PNG)],
    });
    h.saveProject(p2);
    const frameBefore = h.calls.length;
    const frameJob = await h.api("/api/generation/fal/jobs", {
      body: {
        purpose: "frame", imagePlan: true, shotId: "SH-1", sourceBuildId: frameBuild,
        frameId: "FR-A", frameLabel: "A", aspectRatio: "16:9", outputCount: 1,
        clientRequestId: "img-frame-1",
      },
    });
    assert.strictEqual(frameJob.status, 200, `frame submission failed: ${JSON.stringify(frameJob.data)}`);
    const frameCall = h.calls[frameBefore];
    assert.strictEqual(frameCall.endpoint, "/openai/gpt-image-2/edit", "a reference-bearing frame takes fal's image route");
    assert.strictEqual(frameCall.body.image_urls.length, 2, "both approved references are sent");
    for (const url of frameCall.body.image_urls)
      assert(url.startsWith("data:image/png;base64,"), "reference bytes are resolved by the adapter, never by the plan");
    await h.api(`/api/generation/fal/jobs/${frameJob.data.job.id}/refresh`, {});
    const withCandidate = h.project("A");
    const shot = withCandidate.shots.find((row) => row.id === "SH-1");
    const candidate = (shot.candidateFiles || []).find((row) => row.generationJobId === frameJob.data.job.id);
    assert(candidate, "a frame result becomes a reviewable candidate on the owning shot");
    assert.strictEqual(candidate.decision, "unreviewed", "it is a candidate, not canon — approval is a separate act");
    assert.strictEqual(shot.reviewStatus, "PENDING", "and the shot is routed into the existing review flow");
    await settle(h, frameJob.data.job.id);
    note("a reference-bearing frame goes through fal's edit route and returns as an unreviewed candidate on the owning shot");

    /* --- C1.2: an ambiguous transport failure is UNRESOLVED, not FAILED --- */
    const p3 = h.project();
    const dropBuild = addBlockingPromptBuild(p3, "SH-1", { id: "blocking-drop" });
    h.saveProject(p3);
    h.setProviderDropsConnection(true);
    const dropped = await h.api("/api/generation/fal/jobs", {
      body: { purpose: "blocking", imagePlan: true, shotId: "SH-1", sourceBuildId: dropBuild, aspectRatio: "16:9", clientRequestId: "img-drop" },
    });
    h.setProviderDropsConnection(false);
    assert.strictEqual(dropped.status, 502);
    assert.strictEqual(dropped.data.code, "GENERATION_UNRESOLVED",
      "a request that left and was never answered is uncertainty, not a known failure");
    const droppedRow = h.ledger().find((row) => row.id === dropped.data.job.id);
    assert.strictEqual(droppedRow.status, "UNRESOLVED");
    assert.strictEqual(droppedRow.providerContacted, true);
    assert(droppedRow.compilation.plan, "an unresolved job keeps its plan so it can be reconciled against");

    /* ...and a duplicate of the same production result is refused. */
    const duplicate = await h.api("/api/generation/fal/jobs", {
      body: { purpose: "blocking", imagePlan: true, shotId: "SH-1", sourceBuildId: dropBuild, aspectRatio: "16:9", clientRequestId: "img-drop-2" },
    });
    assert.strictEqual(duplicate.status, 409);
    assert.strictEqual(duplicate.data.code, "GENERATION_UNRESOLVED",
      "generating the same frame again while an earlier submission is unresolved is the one action that buys it twice");
    note("the paid image path inherits C1.2 whole: an unanswered POST is UNRESOLVED and blocks a duplicate of the same frame");

    /* Reconciling releases it, and the history survives. */
    const reconciled = await h.api(`/api/generation/fal/jobs/${dropped.data.job.id}/reconcile`, { body: { outcome: "not-accepted" } });
    assert.strictEqual(reconciled.status, 200);
    assert.strictEqual(reconciled.data.job.status, "FAILED");
    assert.strictEqual(reconciled.data.job.reconciliation.previousStatus, "UNRESOLVED");
    assert(reconciled.data.job.compilation.plan, "reconciliation is recorded on top of the record, never in place of it");

    /* --- an opaque success is uncertainty too --- */
    const p4 = h.project();
    const opaqueBuild = addBlockingPromptBuild(p4, "SH-1", { id: "blocking-opaque" });
    h.saveProject(p4);
    h.setProviderOmitsRequestId(true);
    const opaque = await h.api("/api/generation/fal/jobs", {
      body: { purpose: "blocking", imagePlan: true, shotId: "SH-1", sourceBuildId: opaqueBuild, aspectRatio: "16:9", clientRequestId: "img-opaque" },
    });
    h.setProviderOmitsRequestId(false);
    assert.strictEqual(opaque.data.code, "GENERATION_UNRESOLVED",
      "a success CineBraid cannot identify a job from is not a success it can act on");
    await h.api(`/api/generation/fal/jobs/${opaque.data.job.id}/reconcile`, { body: { outcome: "not-accepted" } });

    /* --- a local validation failure contacts no provider --- */
    const p5 = h.project();
    const badShot = h.calls.length;
    h.saveProject(p5);
    const refused = await h.api("/api/generation/fal/jobs", {
      body: { purpose: "blocking", imagePlan: true, shotId: "SH-1", sourceBuildId: "no-such-build", aspectRatio: "16:9", clientRequestId: "img-bad" },
    });
    assert.strictEqual(refused.status, 404);
    assert.strictEqual(refused.data.code, "IMAGE_BUILD_NOT_FOUND");
    assert.strictEqual(h.calls.length, badShot, "a local refusal sends nothing");
    assert(!h.ledger().some((row) => row.clientRequestId === "img-bad"), "and writes no durable row");
    note("a package that cannot be compiled is refused before the POST: no provider call, no ledger row, nothing charged");

    /* --- a blocking REVISION is refused on the compiled path rather than half-served --- */
    const revision = await h.api("/api/generation/fal/jobs", {
      body: {
        purpose: "blocking", imagePlan: true, shotId: "SH-1", sourceBuildId: blockingBuild,
        aspectRatio: "16:9", clientRequestId: "img-rev", revisionRequest: "move Kai to frame left",
        revisedFromAssetId: "blocking-media-1",
      },
    });
    assert.strictEqual(revision.status, 400);
    assert.strictEqual(revision.data.code, "IMAGE_PLAN_REVISION_UNSUPPORTED",
      "a revision the compiled path cannot carry must be refused, not silently stripped of its source frame");

    /* --- PROJECT SWITCH cannot redirect a result --- */
    const p6 = h.project("A");
    const switchBuild = addBlockingPromptBuild(p6, "SH-1", { id: "blocking-switch" });
    h.saveProject(p6, "A");
    const switchJob = await h.api("/api/generation/fal/jobs", {
      body: { purpose: "blocking", imagePlan: true, shotId: "SH-1", sourceBuildId: switchBuild, aspectRatio: "16:9", clientRequestId: "img-switch" },
    });
    assert.strictEqual(switchJob.status, 200);
    const bBefore = JSON.stringify(h.project("B"));
    const bAssetsBefore = (h.project("B").mediaAssets || []).length;
    h.switchProject("B");
    /* The refresh runs while project B is the active one. Ownership was captured when
       the job was created, so the download must still land in A. */
    const late = await h.api(`/api/generation/fal/jobs/${switchJob.data.job.id}/refresh`, {});
    h.switchProject("A");
    assert.strictEqual(late.status, 404,
      "a job is only reachable through the project whose ledger holds it — switching hides it rather than redirecting it");
    assert.strictEqual(JSON.stringify(h.project("B")), bBefore, "project B is byte-identical");
    assert.strictEqual((h.project("B").mediaAssets || []).length, bAssetsBefore);
    /* Back in A, the same job is still there with its plan intact. */
    const stillMine = h.ledger("A").find((row) => row.id === switchJob.data.job.id);
    assert(stillMine && stillMine.compilation.plan, "and the owning project still holds it whole");
    await settle(h, switchJob.data.job.id);
    note("a project switch mid-generation cannot redirect an image result: the job stays in the ledger that owns it and project B is untouched");

    /* --- the pre-C2b path still works, unchanged --- */
    const legacyBefore = h.calls.length;
    const legacy = await h.api("/api/generation/fal/jobs", {
      body: { purpose: "frame", shotId: "SH-1", prompt: "A legacy frame prompt.", outputCount: 1, aspectRatio: "16:9", clientRequestId: "img-legacy" },
    });
    assert.strictEqual(legacy.status, 200, "the uncompiled path must keep working for the flows C2b did not convert");
    const legacyCall = h.calls[legacyBefore];
    assert.strictEqual(legacyCall.body.prompt, "A legacy frame prompt.");
    assert(!h.ledger().find((row) => row.id === legacy.data.job.id).compilation,
      "and a legacy job carries no plan, which is exactly how the dispatcher tells them apart");
    await settle(h, legacy.data.job.id);
  } finally {
    h.close();
  }

  console.log(
    "GPT Image 2 execution wiring passed: a still-image provider request is a serialisation of one compiled plan — "
    + "documented sizes rather than derived dimensions, references bound by role, nothing a still cannot carry, "
    + "results returned to the owning shot through the existing candidate flow, and the C1.2 paid-submission "
    + "lifecycle inherited whole.\n"
    + notes.map((line) => `  - ${line}`).join("\n"),
  );
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

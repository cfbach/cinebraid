/* ComfyUI Foothold V1 — the integration, proven end to end.
 *
 * The claim this suite exists to hold is one sentence:
 *
 *     A CineBraid shot can dispatch a registered, mapped ComfyUI workflow to a real
 *     ComfyUI server, and the result comes back as a returned candidate on THAT shot,
 *     through the review path CineBraid already has, with provenance that explains it.
 *
 * FIXTURES, NOT MOCKS, WHERE IT MATTERS. The ComfyUI at the other end is a real HTTP
 * server on loopback speaking ComfyUI's real protocol — /system_stats, /upload/image,
 * /prompt, /history/<id>, /view — and the routes under test are registered on a real
 * express app and driven over a real socket. Nothing in comfy-client.js, the express
 * layer, the loopback boundary or the commit chain is stubbed, so what passes here is
 * the code path a filmmaker uses. What is fixture is the WEIGHTS: the fake server
 * returns a small PNG instead of running a diffusion model, because this suite is about
 * CineBraid's half of the contract.
 *
 * Nothing is written outside a temp directory. No provider is contacted: the only
 * address any of this may reach is 127.0.0.1, which is the boundary comfy-client.js
 * enforces and this suite proves.
 */

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const notes = [];
const note = (line) => notes.push(line);

/* Errors here carry a machine-readable `code` and a filmmaker-readable `message`, and
   the two are deliberately different things — asserting on the message would be
   asserting on the prose. Every refusal below is checked by its code. */
function codeOf(run) {
  try { run(); } catch (error) { return String(error.code || error.name || ""); }
  return "";
}

/* ---------------------------------------------------------------------------
   Workflow fixtures. Authored here rather than copied from a machine, so the suite
   depends on the FORMAT rather than on anyone's ComfyUI install. */
function apiWorkflow(overrides = {}) {
  return {
    "3": { class_type: "KSampler", inputs: { seed: 12345, steps: 8, cfg: 2, sampler_name: "euler", scheduler: "simple", denoise: 1, model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] }, _meta: { title: "KSampler" } },
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "fixture.safetensors" }, _meta: { title: "Load Checkpoint" } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512, batch_size: 1 }, _meta: { title: "Empty Latent Image" } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: "the workflow's own subject", clip: ["4", 1] }, _meta: { title: "Positive Prompt" } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: "the workflow's own exclusions", clip: ["4", 1] }, _meta: { title: "Negative Prompt" } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] }, _meta: { title: "VAE Decode" } },
    "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: "CineBraid" }, _meta: { title: "Save Image" } },
    "10": { class_type: "LoadImage", inputs: { image: "placeholder.png", upload: "image" }, _meta: { title: "Start Image" } },
    ...overrides,
  };
}
/* ComfyUI's editor document. Structurally unrelated to the API graph, which is the
   whole point of the format check. */
const UI_WORKFLOW = {
  id: "b0b1", revision: 0, last_node_id: 9, last_link_id: 12,
  nodes: [{ id: 9, type: "SaveImage", pos: [10, 10], widgets_values: ["CineBraid"] }],
  links: [], groups: [], config: {}, extra: {}, version: 0.4,
};

/* A 1x1 PNG. Real bytes with a real header, so the mime and extension decisions in
   generation-candidate-ingest.js are exercised rather than assumed. */
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/* ---------------------------------------------------------------------------
   A real ComfyUI, in miniature. Loopback only, ComfyUI's real routes and real
   payload shapes, and it records everything it was asked so the suite can assert on
   what CineBraid actually sent. */
function startFakeComfy(options = {}) {
  const state = {
    prompts: [],
    uploads: [],
    views: [],
    /* "queued" | "running" | "completed" | "failed" — the suite drives this to prove
       each state reaches the shot as the right word. */
    outcome: options.outcome || "completed",
    outputs: options.outputs,
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (code, body, type = "application/json") => {
      const payload = type === "application/json" ? JSON.stringify(body) : body;
      res.writeHead(code, { "content-type": type, "content-length": Buffer.byteLength(payload) });
      res.end(payload);
    };
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      if (url.pathname === "/system_stats")
        return send(200, { system: { comfyui_version: "0.34.2-fixture", python_version: "3.13.12 (fixture)" }, devices: [{ name: "fixture-device" }] });
      if (url.pathname === "/queue") {
        if (state.outcome === "queued") return send(200, { queue_running: [], queue_pending: [[0, state.prompts[0]?.promptId || ""]] });
        if (state.outcome === "running") return send(200, { queue_running: [[0, state.prompts[0]?.promptId || ""]], queue_pending: [] });
        return send(200, { queue_running: [], queue_pending: [] });
      }
      if (url.pathname === "/upload/image") {
        state.uploads.push({ bytes: raw.length, contentType: req.headers["content-type"] || "", body: raw.toString("latin1") });
        return send(200, { name: `upload-${state.uploads.length}.png`, subfolder: "cinebraid", type: "input" });
      }
      if (url.pathname === "/prompt") {
        let body = {};
        try { body = JSON.parse(raw.toString("utf8")); } catch { /* asserted below */ }
        if (options.refuseGraph)
          return send(400, { error: { type: "prompt_outputs_failed_validation", message: "Prompt outputs failed validation" }, node_errors: { 9: { errors: [{ message: "fixture refusal" }] } } });
        const promptId = `fixture-prompt-${state.prompts.length + 1}`;
        state.prompts.push({ promptId, graph: body.prompt, clientId: body.client_id });
        return send(200, { prompt_id: promptId, number: state.prompts.length, node_errors: {} });
      }
      if (url.pathname.startsWith("/history/")) {
        const id = decodeURIComponent(url.pathname.slice("/history/".length));
        if (state.outcome === "queued" || state.outcome === "running") return send(200, {});
        if (state.outcome === "failed")
          return send(200, { [id]: { status: { status_str: "error", completed: false, messages: [["execution_error", { node_id: "3", node_type: "KSampler", exception_message: "fixture: out of memory" }]] }, outputs: {} } });
        if (state.outcome === "empty")
          return send(200, { [id]: { status: { status_str: "success", completed: true, messages: [] }, outputs: {} } });
        return send(200, {
          [id]: {
            status: { status_str: "success", completed: true, messages: [] },
            outputs: state.outputs || {
              /* A live preview alongside the saved result — ComfyUI marks it type
                 "temp", and a preview must never become a candidate. */
              "9": {
                images: [
                  { filename: "CineBraid_00001_.png", subfolder: "", type: "output" },
                  { filename: "preview_00001_.png", subfolder: "", type: "temp" },
                ],
              },
            },
          },
        });
      }
      if (url.pathname === "/view") {
        state.views.push({ filename: url.searchParams.get("filename"), subfolder: url.searchParams.get("subfolder"), type: url.searchParams.get("type") });
        /* A hook fired at the exact moment CineBraid is downloading a result — the only
           point in the whole flow where real seconds pass and a filmmaker is free to do
           something else. tests/comfy-integration-negative-controls.js uses it to switch
           projects mid-download, which is the race the ownership capture exists for. */
        if (typeof options.onView === "function") options.onView();
        res.writeHead(200, { "content-type": "image/png", "content-length": PNG_BYTES.length });
        return res.end(PNG_BYTES);
      }
      return send(404, { error: "not found" });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({
      server,
      state,
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      close: () => {
        if (typeof server.closeAllConnections === "function") server.closeAllConnections();
        server.close();
      },
    }));
  });
}

/* ---------------------------------------------------------------------------
   A CineBraid, in miniature. A real express app carrying the real routes, a real
   temp project tree, and the real config and registry modules pointed at temp files. */
async function makeHarness({ shots = ["SC-01-01"], comfyBaseUrl, workflowFolder, activeSlug = "film-a", mutate, bindAll = false } = {}) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "cb-comfy-"));
  const projectsRoot = path.join(dir, "projects");
  const configPath = path.join(dir, "config.json");
  const registryPath = path.join(dir, "comfy-workflows.json");
  process.env.CINEBRAID_CONFIG_PATH = configPath;
  process.env.CINEBRAID_COMFY_REGISTRY_PATH = registryPath;
  /* Required fresh so every module reads the environment set above.
   *
   * comfy-generation.js is in this list deliberately: it captures its Registry binding
   * at require time, so leaving it cached would give a new harness the PREVIOUS
   * harness's registry file and let one case's confirmed mapping satisfy the next case's
   * "this workflow was never registered" refusal.
   *
   * generation-commit.js is deliberately NOT in it. Its Maps are module-scoped on
   * purpose and are keyed on the project directory, which is a fresh temp path per
   * harness — so keeping it cached is both harmless and closer to production, where one
   * process holds one chain for every backend. */
  for (const key of Object.keys(require.cache))
    if (/comfy-(registry|generation|client|workflow)\.js$|[\\/]config\.js$/.test(key)) delete require.cache[key];
  /* A negative control installs a DELIBERATELY BROKEN copy of one module here — after
     the cache is cleared and before anything requires it — so the routes below are built
     ON the defect rather than beside it. In memory only; nothing is written to disk. */
  if (typeof mutate === "function") mutate({ ROOT });
  const Config = require(path.join(ROOT, "src/server/config.js"));
  const Registry = require(path.join(ROOT, "src/generation/comfyui/comfy-registry.js"));
  const { registerComfyGeneration } = require(path.join(ROOT, "src/generation/comfyui/comfy-generation.js"));

  const slugs = ["film-a", "film-b"];
  for (const slug of slugs) {
    fs.mkdirSync(path.join(projectsRoot, slug, "shots"), { recursive: true });
    const project = {
      title: slug,
      shots: (slug === "film-a" ? shots : ["SC-99-99"]).map((id) => ({ id, title: id, candidateFiles: [], keyframes: [] })),
      mediaAssets: [],
    };
    fs.writeFileSync(path.join(projectsRoot, slug, "project.json"), JSON.stringify(project, null, 2));
  }

  Config.writeConfig(Config.mergeConfig(Config.readConfig(), {
    generation: { comfy: { enabled: true, baseUrl: comfyBaseUrl || "http://127.0.0.1:1", workflowFolder: workflowFolder || "" } },
  }));

  const express = require("express");
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  let current = activeSlug;
  const projectFile = (slug) => path.join(projectsRoot, slug, "project.json");
  const context = {
    readConfig: () => Config.readConfig(),
    readProject: (slug) => JSON.parse(fs.readFileSync(projectFile(slug), "utf8")),
    writeProject: (project, slug) => fs.writeFileSync(projectFile(slug), JSON.stringify(project, null, 2)),
    activeSlug: () => current,
    projectDirForSlug: (slug) => {
      /* The same containment rule server.js applies: a slug is one direct child of the
         projects root, never a path. */
      if (!/^[\w.-]+$/.test(String(slug || "")) || !slugs.includes(String(slug)))
        throw new Error("Invalid project slug.");
      return { dir: path.join(projectsRoot, slug), file: projectFile(slug) };
    },
  };
  const api = registerComfyGeneration(app, context);
  /* Awaited, because express's listen is asynchronous and server.address() is null
     until it fires — a harness that hands back a port it does not have yet fails in a
     way that looks like a product bug rather than a harness one. */
  /* `bindAll` binds 0.0.0.0 so a genuine non-loopback peer can reach the routes. Only
     the LAN-boundary section asks for it; everything else stays on loopback, because a
     test server reachable from the network is not something to leave switched on by
     default. */
  const server = app.listen(0, bindAll ? "0.0.0.0" : "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return {
    dir, projectsRoot, configPath, registryPath, Config, Registry, api, app, server,
    baseUrl: () => `http://127.0.0.1:${server.address().port}`,
    setActive: (slug) => { current = slug; },
    project: (slug = current) => context.readProject(slug),
    jobs: (slug = current) => {
      const file = path.join(projectsRoot, slug, "generation-jobs.json");
      return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
    },
    takes: (slug = current, shotId = "SC-01-01") => {
      const takes = path.join(projectsRoot, slug, "shots", shotId, "takes");
      return fs.existsSync(takes) ? fs.readdirSync(takes).sort() : [];
    },
    close: () => {
      /* Connections first. Node's global fetch keeps sockets alive, so a bare close()
         settles only when they time out — which turns a fast suite into a slow one, and
         the negative-control file that drives eight of these into a very slow one. */
      if (typeof server.closeAllConnections === "function") server.closeAllConnections();
      server.close();
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
      delete process.env.CINEBRAID_CONFIG_PATH;
      delete process.env.CINEBRAID_COMFY_REGISTRY_PATH;
    },
  };
}

async function call(harness, method, route, body) {
  const response = await fetch(`${harness.baseUrl()}${route}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, data };
}

function writeWorkflowFolder(root, files) {
  fs.mkdirSync(root, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content, null, 2));
  }
  return root;
}

/* ===========================================================================
   1. FORMAT TRUTH — and the refusal to pretend. */
function formatTruth() {
  const W = require(path.join(ROOT, "src/generation/comfyui/comfy-workflow.js"));
  assert.strictEqual(W.detectWorkflowFormat(JSON.stringify(apiWorkflow())).format, "api");

  const ui = W.detectWorkflowFormat(JSON.stringify(UI_WORKFLOW));
  assert.strictEqual(ui.format, "ui", "ComfyUI's editor document is not the API graph and must not be read as one");
  assert(/Export \(API\)/.test(ui.action), "and the filmmaker must be told the exact export that fixes it");

  assert.strictEqual(W.detectWorkflowFormat("{not json").format, "unparseable");
  assert.strictEqual(W.detectWorkflowFormat(JSON.stringify({ a: 1 })).format, "unknown");
  /* HALF AN API GRAPH IS NOT AN API GRAPH. Dispatching the half that parses is the
     behaviour that produces a picture nobody asked for. */
  const half = { ...apiWorkflow(), meta: { author: "someone" } };
  assert.strictEqual(W.detectWorkflowFormat(JSON.stringify(half)).format, "unknown");
  assert.strictEqual(codeOf(() => W.inspectWorkflow(JSON.stringify(UI_WORKFLOW))), "COMFY_WORKFLOW_NOT_EXECUTABLE");
  note("format: api / ui / unknown / unparseable are four different answers, and a mixed document is refused rather than half-run");
}

/* ===========================================================================
   2. SUGGESTION IS NEVER CONFIRMATION. */
function suggestionIsNotConfirmation() {
  const W = require(path.join(ROOT, "src/generation/comfyui/comfy-workflow.js"));
  const inspection = W.inspectWorkflow(apiWorkflow());
  const suggestions = W.suggestMappings(inspection);

  assert.strictEqual(suggestions.positivePrompt[0].nodeId, "6");
  assert.strictEqual(suggestions.negativePrompt[0].nodeId, "7");
  assert(!suggestions.positivePrompt.some((row) => row.nodeId === "7"),
    "a node the author titled Negative Prompt is not a candidate for the positive one");
  assert(/node title/.test(suggestions.positivePrompt[0].because),
    "every suggestion states the evidence that produced it");

  /* THE STRUCTURAL CLAIM: a suggestion has no storage. The only producer of a binding
     demands a confirmation stamp, so a suggestion posted nowhere is a suggestion that
     exists nowhere. */
  assert.throws(
    () => W.mappingFromRequest({ positivePrompt: { nodeId: "6", input: "text" } }, inspection, ""),
    (error) => error.code === "COMFY_MAPPING_UNCONFIRMED",
    "a mapping with no confirmation must not be mintable at all",
  );
  const unconfirmed = { mappingVersion: 1, bindings: { positivePrompt: { nodeId: "6", input: "text" } } };
  const checked = W.validateMapping(unconfirmed, inspection);
  assert(!checked.ok, "and a stored binding with no confirmation stamp must not validate");
  assert(checked.problems.some((row) => row.code === "unconfirmed"), JSON.stringify(checked.problems));
  note("suggestion: ranked with its evidence, disambiguated by title, and structurally unable to become a binding without a confirmation stamp");
}

/* ===========================================================================
   3. CHANGE DETECTION — five cases the brief names. */
function changeDetection() {
  const W = require(path.join(ROOT, "src/generation/comfyui/comfy-workflow.js"));
  const base = apiWorkflow();
  const inspection = W.inspectWorkflow(base);
  const at = new Date().toISOString();
  const mapping = W.mappingFromRequest({
    positivePrompt: { nodeId: "6", input: "text" },
    negativePrompt: { nodeId: "7", input: "text" },
    seed: { nodeId: "3", input: "seed" },
  }, inspection, at);

  const check = (graph) => W.validateMapping(mapping, W.inspectWorkflow(graph));

  assert(check(base).ok, "unchanged: a mapping still fits the file it was confirmed against");

  const harmless = apiWorkflow();
  harmless["5"].inputs.width = 768;
  assert(check(harmless).ok, "harmless change: editing an unmapped input keeps every mapping");

  const added = apiWorkflow();
  added["11"] = { class_type: "PreviewImage", inputs: { images: ["8", 0] }, _meta: { title: "Preview" } };
  assert(check(added).ok, "unrelated new node: adding a node touches no mapping");

  const removed = apiWorkflow();
  delete removed["7"];
  const removedResult = check(removed);
  assert(!removedResult.ok && removedResult.problems.some((row) => row.code === "missing-node"),
    "removed mapped node: the mapping is broken and says which node went");
  assert(removedResult.kept.positivePrompt, "and the mappings that still fit are kept rather than discarded wholesale");
  assert(!removedResult.kept.negativePrompt, "while the broken one is not silently re-pointed at the surviving text node");

  const renamed = apiWorkflow();
  renamed["7"].inputs = { prompt: renamed["7"].inputs.text, clip: renamed["7"].inputs.clip };
  const renamedResult = check(renamed);
  assert(!renamedResult.ok && renamedResult.problems.some((row) => row.code === "missing-input"),
    "changed mapped input: an input that no longer exists is named, not guessed at");

  const retyped = apiWorkflow();
  retyped["3"].inputs.seed = ["12", 0];
  const retypedResult = check(retyped);
  assert(!retypedResult.ok && retypedResult.problems.some((row) => row.code === "input-is-linked"),
    "an input now driven by another node cannot be set, and CineBraid refuses rather than disconnecting the graph");

  /* THE NODE CLASS COMES FROM THE WRITER, NOT FROM THE TEST.
   *
   * This block used to hand validateMapping() a binding with `classType` spliced in by
   * hand, and passed — while the real confirmation writer stored no class at all, so the
   * guard it claimed to prove could never fire in production. A test that supplies the
   * field it is asserting about is testing itself.
   *
   * `mapping` above came from mappingFromRequest(), so what is checked here is what a
   * filmmaker's confirmation actually persists. */
  assert.strictEqual(mapping.bindings.positivePrompt.classType, "CLIPTextEncode",
    "the confirmation writer must persist the node class it was confirmed against");
  assert.strictEqual(mapping.bindings.seed.classType, "KSampler");

  const classSwapped = apiWorkflow();
  classSwapped["6"] = { class_type: "PrimitiveString", inputs: { text: "x" }, _meta: { title: "Positive Prompt" } };
  const swapResult = W.validateMapping(mapping, W.inspectWorkflow(classSwapped));
  assert(!swapResult.ok && swapResult.problems.some((row) => row.code === "class-changed"),
    "a node id reused by a different kind of node is a broken mapping, not a working one");
  assert(!swapResult.kept.positivePrompt, "and the swapped binding must not survive as kept");
  assert(swapResult.kept.seed, "while the untouched binding does");

  /* A CONFIRMATION THAT CANNOT PROVE WHAT IT AGREED TO IS NOT CONFIRMED. Legacy records
     written before the class was persisted fail into reconfirmation rather than being
     assumed compatible with whatever the node happens to be now. */
  const legacy = {
    mappingVersion: mapping.mappingVersion,
    confirmedAt: mapping.confirmedAt,
    bindings: { positivePrompt: { nodeId: "6", input: "text", confirmedAt: mapping.confirmedAt } },
  };
  const legacyResult = W.validateMapping(legacy, inspection);
  assert(!legacyResult.ok && legacyResult.problems.some((row) => row.code === "class-unconfirmed"),
    "a stored confirmation with no recorded class must ask to be confirmed again");
  assert(!legacyResult.kept.positivePrompt, "and must not be kept as though it had been checked");
  note("change detection: unchanged / harmless / new node all keep every mapping; a removed node, a renamed input, a newly linked input and a reused node id each break exactly the one that no longer fits; the class is read off the real confirmation writer, and a confirmation with no class fails into reconfirmation");
}

/* ===========================================================================
   4. THE DISPATCH GRAPH — built from the file, never onto it. */
function dispatchGraph() {
  const W = require(path.join(ROOT, "src/generation/comfyui/comfy-workflow.js"));
  const base = apiWorkflow();
  const inspection = W.inspectWorkflow(base);
  const mapping = W.mappingFromRequest({
    positivePrompt: { nodeId: "6", input: "text" },
    negativePrompt: { nodeId: "7", input: "text" },
    seed: { nodeId: "3", input: "seed" },
    startImage: { nodeId: "10", input: "image" },
  }, inspection, new Date().toISOString());

  const built = W.buildDispatchGraph(base, mapping, { positivePrompt: "a lighthouse at dusk", seed: 99, startImage: "cinebraid/upload-1.png" });
  assert.strictEqual(built.graph["6"].inputs.text, "a lighthouse at dusk");
  assert.strictEqual(built.graph["3"].inputs.seed, 99);
  assert.strictEqual(built.graph["10"].inputs.image, "cinebraid/upload-1.png");
  assert.strictEqual(base["6"].inputs.text, "the workflow's own subject", "the caller's document is never written to");
  assert.strictEqual(built.graph["7"].inputs.text, "the workflow's own exclusions",
    "an unsupplied optional input keeps the workflow's own value rather than being blanked");
  assert(built.skipped.some((row) => row.key === "negativePrompt" && row.keptWorkflowValue),
    "and that is RECORDED, because 'the author's negative prompt ran' is a different fact from 'an empty one ran'");
  assert(built.graph["5"].inputs.width === 512 && built.graph["4"].inputs.ckpt_name === "fixture.safetensors",
    "nothing outside the confirmed bindings is touched");
  assert.deepStrictEqual(built.outputNodes, ["9"]);

  /* A BROKEN MAPPING CANNOT DISPATCH — refused where the graph is built, not only at
     the screen, so a caller that skipped the screen is refused too. */
  const brokenGraph = apiWorkflow();
  delete brokenGraph["6"];
  assert.strictEqual(codeOf(() => W.buildDispatchGraph(brokenGraph, mapping, { positivePrompt: "x" })), "COMFY_MAPPING_BROKEN");
  note("dispatch graph: values land on exactly the confirmed bindings, the file on disk is untouched, unsupplied inputs keep the author's values and record that they did, and a broken mapping refuses at the builder");
}

/* ===========================================================================
   5. THE FOLDER — configuration, not path authority. */
async function folderIsNotPathAuthority() {
  const harness = await makeHarness();
  try {
    const folder = writeWorkflowFolder(path.join(harness.dir, "workflows"), {
      "runnable.json": apiWorkflow(),
      "editor-document.json": UI_WORKFLOW,
      "notes.txt": "not a workflow",
      "nested/deep.json": apiWorkflow(),
    });
    const secret = path.join(harness.dir, "outside-secret.json");
    fs.writeFileSync(secret, JSON.stringify(apiWorkflow()));

    const listed = harness.Registry.listWorkflows(folder);
    const names = listed.workflows.map((row) => row.relativePath).sort();
    assert.deepStrictEqual(names, ["editor-document.json", "nested/deep.json", "runnable.json"],
      "only .json files inside the folder are listed, and a nested one keeps its readable identity");
    const editor = listed.workflows.find((row) => row.relativePath === "editor-document.json");
    assert.strictEqual(editor.executable, false);
    assert.strictEqual(editor.state, "not-executable");
    assert(/Export \(API\)/.test(editor.action), "an unrunnable workflow is named with the fix, not hidden");
    assert(listed.workflows.every((row) => !row.registered), "listing registers nothing");

    /* NO RAW PATH AUTHORITY. A caller may name a place inside the folder and nothing
       else — not an absolute path, not a traversal, not a drive. */
    const REFUSED = ["COMFY_WORKFLOW_PATH_INVALID", "COMFY_WORKFLOW_OUTSIDE_FOLDER", "COMFY_WORKFLOW_MISSING"];
    for (const attempt of ["../outside-secret.json", "..\\outside-secret.json", secret, "/etc/passwd", "C:\\Windows\\win.ini", "nested/../../outside-secret.json"]) {
      let code = "";
      try {
        harness.Registry.describeForMapping(folder, attempt);
      } catch (error) {
        code = String(error.code || "");
      }
      assert(REFUSED.includes(code), `a workflow named "${attempt}" must be refused; got ${code || "no refusal at all"}`);
    }
    note("folder: only .json inside the configured folder is listed, an editor document is named unrunnable with its fix, and six shapes of raw path authority are each refused");
  } finally { harness.close(); }
}

/* ===========================================================================
   6. MAPPING PERSISTENCE AND STALENESS, through the durable registry. */
async function mappingPersistence() {
  const harness = await makeHarness();
  try {
    const folder = writeWorkflowFolder(path.join(harness.dir, "workflows"), { "smoke.json": apiWorkflow() });
    const before = harness.Registry.describeForMapping(folder, "smoke.json");
    assert.strictEqual(before.state, "unmapped");
    assert(before.suggestions.positivePrompt.length, "the editor is given suggestions");
    assert(!Object.keys(before.bindings).length, "and the registry holds none of them");

    const saved = harness.Registry.confirmMapping(folder, "smoke.json", {
      positivePrompt: { nodeId: "6", input: "text" },
      negativePrompt: { nodeId: "7", input: "text" },
    });
    assert.strictEqual(saved.state, "ready");
    assert(saved.bindings.positivePrompt.confirmedAt, "the server stamps the confirmation, not the caller");

    const onDisk = JSON.parse(fs.readFileSync(harness.registryPath, "utf8"));
    assert.strictEqual(onDisk.workflows.length, 1);
    assert.strictEqual(onDisk.workflows[0].mappedHash, onDisk.workflows[0].contentHash,
      "a fresh confirmation records the hash the human was looking at");

    /* A harmless edit: still runnable, and CHANGED rather than silently identical. */
    const harmless = apiWorkflow();
    harmless["5"].inputs.width = 768;
    fs.writeFileSync(path.join(folder, "smoke.json"), JSON.stringify(harmless, null, 2));
    const changed = harness.Registry.listWorkflows(folder).workflows[0];
    assert.strictEqual(changed.state, "changed", "an edited file is UNREVIEWED, which is not the same as valid");
    assert.notStrictEqual(changed.contentHash, changed.mappedHash);
    const forDispatch = harness.Registry.loadForDispatch(folder, "smoke.json");
    assert.strictEqual(forDispatch.state, "changed", "and it may still run, because every confirmed binding was rechecked and still fits");

    /* A breaking edit: refused at the dispatch read, not only at the screen. */
    const broken = apiWorkflow();
    delete broken["7"];
    fs.writeFileSync(path.join(folder, "smoke.json"), JSON.stringify(broken, null, 2));
    const brokenRow = harness.Registry.listWorkflows(folder).workflows[0];
    assert.strictEqual(brokenRow.state, "broken");
    assert.strictEqual(codeOf(() => harness.Registry.loadForDispatch(folder, "smoke.json")), "COMFY_MAPPING_BROKEN");

    /* A registration whose file went is reported, never discarded: a mapping is work a
       person did, and an unplugged drive is not a reason to throw it away. */
    fs.rmSync(path.join(folder, "smoke.json"));
    const orphan = harness.Registry.listWorkflows(folder).workflows[0];
    assert.strictEqual(orphan.state, "unreadable");
    assert(orphan.registered && Object.keys(orphan.bindings).length, "and its confirmed bindings survive");
    note("mapping: confirmation is stamped by the server and stored durably; an edited file reads as changed with both hashes kept; a breaking edit refuses at loadForDispatch; a vanished file keeps its mapping and says the file is gone");
  } finally { harness.close(); }
}

/* ===========================================================================
   7. CONNECTION TRUTH. */
async function connectionTruth() {
  const comfy = await startFakeComfy();
  const harness = await makeHarness({ comfyBaseUrl: comfy.baseUrl });
  try {
    const good = await call(harness, "POST", "/api/generation/comfy/test");
    assert.strictEqual(good.data.connected, true);
    assert.strictEqual(good.data.version, "0.34.2-fixture", "a connection reports which ComfyUI answered");
    assert(/no provider charge/i.test(good.data.costLabel), "and says plainly that it costs nothing at a provider");

    /* THE BOUNDARY. Neither a LAN address nor a public one may be dialled, and the
       refusal names the reason instead of timing out. */
    const Client = require(path.join(ROOT, "src/generation/comfyui/comfy-client.js"));
    for (const address of ["http://192.168.1.50:8188", "http://10.0.0.9:8188", "http://172.16.0.4:8188", "http://comfy.example.com", "https://example.com:8188"]) {
      const probed = await Client.probe(address);
      assert.strictEqual(probed.connected, false, `${address} must not be dialled`);
      assert.strictEqual(probed.code, "COMFY_URL_NOT_LOCAL", `${address} must be refused as non-local, not merely fail`);
    }
    for (const address of ["http://127.0.0.1:8188", "http://localhost:8188", "http://[::1]:8188", "http://127.9.9.9:8188"])
      assert.doesNotThrow(() => Client.assertReachableEndpoint(address), `${address} is this machine and must be allowed`);

    /* Nothing listening is a different sentence from not being allowed to try. */
    const dead = await Client.probe("http://127.0.0.1:1");
    assert.strictEqual(dead.connected, false);
    assert(["COMFY_UNREACHABLE", "COMFY_TIMEOUT"].includes(dead.code), dead.code);
    note("connection: a live ComfyUI reports its version and its no-charge truth; five non-local addresses are refused by name; four loopback spellings are allowed; a dead port reads as unreachable rather than forbidden");
  } finally { harness.close(); comfy.close(); }
}

/* ===========================================================================
   8. THE WHOLE PROOF — shot to reviewable candidate. */
async function endToEnd() {
  const comfy = await startFakeComfy();
  const harness = await makeHarness({ comfyBaseUrl: comfy.baseUrl });
  try {
    const folder = writeWorkflowFolder(path.join(harness.dir, "workflows"), { "smoke.json": apiWorkflow() });
    harness.Config.writeConfig(harness.Config.mergeConfig(harness.Config.readConfig(), { generation: { comfy: { workflowFolder: folder } } }));

    /* An approved image on the shot, so the start-image path is exercised with a real
       CineBraid media identity rather than a filename. */
    const takes = path.join(harness.projectsRoot, "film-a", "shots", "SC-01-01", "takes");
    fs.mkdirSync(takes, { recursive: true });
    fs.writeFileSync(path.join(takes, "SC-01-01_FRAME_A_EXISTING.png"), PNG_BYTES);

    const mapped = await call(harness, "POST", "/api/generation/comfy/workflow/mapping", {
      relativePath: "smoke.json",
      bindings: {
        positivePrompt: { nodeId: "6", input: "text" },
        negativePrompt: { nodeId: "7", input: "text" },
        seed: { nodeId: "3", input: "seed" },
        startImage: { nodeId: "10", input: "image" },
      },
    });
    assert.strictEqual(mapped.status, 200, JSON.stringify(mapped.data));
    assert.strictEqual(mapped.data.state, "ready");

    const listed = await call(harness, "GET", "/api/generation/comfy/workflows");
    assert.strictEqual(listed.data.workflows[0].state, "ready");

    const dispatched = await call(harness, "POST", "/api/generation/comfy/jobs", {
      shotId: "SC-01-01",
      frameId: "frame-a",
      frameLabel: "A",
      relativePath: "smoke.json",
      prompt: "a lighthouse at dusk, sodium practicals",
      negativePrompt: "blurry",
      seed: 4242,
      references: { startImage: "/assets/shots/SC-01-01/takes/SC-01-01_FRAME_A_EXISTING.png" },
    });
    assert.strictEqual(dispatched.status, 200, JSON.stringify(dispatched.data));
    assert.strictEqual(dispatched.data.job.status, "IN_QUEUE", "a submitted job reads as queued");
    assert.strictEqual(dispatched.data.job.externalId, "fixture-prompt-1", "and carries ComfyUI's own job id");
    assert(/no provider charge/i.test(dispatched.data.costLabel));

    /* WHAT CINEBRAID ACTUALLY SENT. */
    assert.strictEqual(comfy.state.prompts.length, 1);
    const sent = comfy.state.prompts[0].graph;
    assert.strictEqual(sent["6"].inputs.text, "a lighthouse at dusk, sodium practicals");
    assert.strictEqual(sent["7"].inputs.text, "blurry");
    assert.strictEqual(sent["3"].inputs.seed, 4242);
    assert.strictEqual(sent["10"].inputs.image, "cinebraid/upload-1.png", "the start image is the name ComfyUI gave the upload, never a CineBraid path");
    assert.strictEqual(comfy.state.uploads.length, 1, "exactly the one mapped reference was uploaded");
    assert(!JSON.stringify(sent).includes(harness.projectsRoot), "no CineBraid filesystem path may reach the provider graph");

    /* THE FILE ON DISK IS UNCHANGED. */
    const afterDispatch = JSON.parse(fs.readFileSync(path.join(folder, "smoke.json"), "utf8"));
    assert.strictEqual(afterDispatch["6"].inputs.text, "the workflow's own subject",
      "dispatching must never be the reason a filmmaker's workflow changed");

    /* Queued and running are distinguishable and neither is a delivery. */
    comfy.state.outcome = "queued";
    let refreshed = await call(harness, "POST", `/api/generation/comfy/jobs/${dispatched.data.job.id}/refresh`);
    assert.strictEqual(refreshed.data.job.status, "IN_QUEUE");
    assert.strictEqual(harness.project().shots[0].candidateFiles.length, 0, "nothing is delivered while it is queued");
    comfy.state.outcome = "running";
    refreshed = await call(harness, "POST", `/api/generation/comfy/jobs/${dispatched.data.job.id}/refresh`);
    assert.strictEqual(refreshed.data.job.status, "IN_PROGRESS");
    assert.strictEqual(harness.project().shots[0].candidateFiles.length, 0);

    /* DELIVERY. */
    comfy.state.outcome = "completed";
    const done = await call(harness, "POST", `/api/generation/comfy/jobs/${dispatched.data.job.id}/refresh`);
    assert.strictEqual(done.data.job.status, "COMPLETED");
    assert(done.data.job.ingestedAt, "and the delivery is stamped");

    const project = harness.project();
    const shot = project.shots.find((row) => row.id === "SC-01-01");
    assert.strictEqual(shot.candidateFiles.length, 1, "exactly one candidate, and the temp preview is not it");
    const candidate = shot.candidateFiles[0];
    assert.strictEqual(candidate.decision, "unreviewed", "a returned result is a proposal, never an approval");
    assert.strictEqual(candidate.generationProvider, "ComfyUI");
    assert.strictEqual(candidate.generationModel, "smoke.json");
    assert.strictEqual(candidate.generationJobId, dispatched.data.job.id);
    assert.strictEqual(candidate.generationRequestId, "fixture-prompt-1");
    assert.strictEqual(candidate.frameId, "frame-a");
    assert(/_COMFY_/.test(candidate.stored), `the delivered file names its backend: ${candidate.stored}`);

    /* THE BYTES ARE IN CINEBRAID'S OWN MEDIA SPACE, not only in ComfyUI's output. */
    const stored = path.join(takes, candidate.stored);
    assert(fs.existsSync(stored), "the result is written into the project's own takes folder");
    assert.deepStrictEqual(fs.readFileSync(stored), PNG_BYTES, "byte for byte what ComfyUI produced");
    assert.deepStrictEqual(comfy.state.views.map((row) => row.filename), ["CineBraid_00001_.png"],
      "only the saved output was fetched; the type:temp preview was never retrieved");

    /* THE SHOT IS IN THE REVIEW PATH. */
    assert.strictEqual(shot.reviewStatus, "PENDING");
    assert.strictEqual(shot.status, "BUILT");
    assert.strictEqual(shot.workflowStatus, "IN PROGRESS");

    /* THE EXISTING PROVENANCE READER SEES IT, without learning a new word. */
    const MEDIA = require(path.join(ROOT, "public", "shared-production-media.js"));
    const rows = MEDIA.productionMediaForShot
      ? null
      : null; /* the projection below is the one the media inspector reads */
    void rows;

    /* Idempotence: a second collection delivers nothing more. */
    const again = await call(harness, "POST", `/api/generation/comfy/jobs/${dispatched.data.job.id}/refresh`);
    assert.strictEqual(again.data.job.ingestedAt, done.data.job.ingestedAt);
    assert.strictEqual(harness.project().shots[0].candidateFiles.length, 1, "a second refresh must not deliver the same result twice");
    assert.strictEqual(harness.takes().length, 2, "nor write a second file");
    note("end to end: shot → mapped workflow → queued → running → returned → one unreviewed candidate on the right shot and frame, bytes in the project's own takes folder, the shot moved to PENDING review, the workflow file untouched, the temp preview never fetched, and a second collection delivering nothing");
    return { harness, comfy, jobId: dispatched.data.job.id };
  } catch (error) {
    harness.close();
    comfy.close();
    throw error;
  }
}

/* ===========================================================================
   9. PROVENANCE COMPLETENESS AND COST TRUTH. */
async function provenanceAndCost() {
  const comfy = await startFakeComfy();
  const harness = await makeHarness({ comfyBaseUrl: comfy.baseUrl });
  try {
    const folder = writeWorkflowFolder(path.join(harness.dir, "workflows"), { "smoke.json": apiWorkflow() });
    harness.Config.writeConfig(harness.Config.mergeConfig(harness.Config.readConfig(), { generation: { comfy: { workflowFolder: folder } } }));
    await call(harness, "POST", "/api/generation/comfy/workflow/mapping", {
      relativePath: "smoke.json",
      bindings: { positivePrompt: { nodeId: "6", input: "text" }, seed: { nodeId: "3", input: "seed" } },
    });
    const dispatched = await call(harness, "POST", "/api/generation/comfy/jobs", {
      shotId: "SC-01-01", frameId: "frame-a", frameLabel: "A", relativePath: "smoke.json",
      prompt: "a lighthouse", seed: 7,
    });
    await call(harness, "POST", `/api/generation/comfy/jobs/${dispatched.data.job.id}/refresh`);
    const job = harness.jobs().find((row) => row.id === dispatched.data.job.id);

    /* EVERY FIELD THE BRIEF NAMES, present and true. */
    const p = job.comfy;
    assert.strictEqual(p.backendId, "comfy");
    assert.strictEqual(p.serverUrl, comfy.baseUrl, "the configured server identity is recorded");
    assert.strictEqual(p.executionKind, "local_native");
    assert.strictEqual(p.costClass, "free_local");
    assert.strictEqual(p.trustClass, "loopback");
    assert.strictEqual(p.workflow.relativePath, "smoke.json");
    assert(/^sha256:[0-9a-f]{64}$/.test(p.workflow.contentHash), `the workflow is fingerprinted: ${p.workflow.contentHash}`);
    assert.strictEqual(p.workflow.mappedHash, p.workflow.contentHash);
    assert.strictEqual(p.workflow.changedSinceConfirmed, false);
    assert.strictEqual(p.mapping.mappingVersion, 1);
    assert(p.mapping.confirmedAt, "the mapping records when a human agreed to it");
    assert(p.appliedInputs.some((row) => row.key === "positivePrompt" && row.nodeId === "6"));
    assert(p.keptWorkflowValues.length === 0 || p.keptWorkflowValues.every((row) => row.keptWorkflowValue));
    assert.strictEqual(p.seed, 7);
    assert.strictEqual(p.promptId, "fixture-prompt-1");
    assert(p.graphSnapshot && p.graphSnapshot["6"].inputs.text === "a lighthouse",
      "the EXACT executed graph is stored, not a reference to a file that may be edited tomorrow");
    assert.strictEqual(p.returnedOutputs[0].nodeId, "9");
    assert.strictEqual(p.returnedOutputs[0].deliveredAs, job.outputs[0].name,
      "and the ComfyUI node that produced it is joined to the CineBraid file it became");
    assert(job.createdAt && p.completedAt, "requested and completed times are both recorded");

    /* NO CREDENTIAL, ANYWHERE. */
    const serialised = JSON.stringify(job);
    for (const forbidden of ["apiKey", "api_key", "authorization", "Bearer", "secret", "password"])
      assert(!new RegExp(forbidden, "i").test(serialised), `${forbidden} must not appear in a ComfyUI job record`);

    /* COST TRUTH. It says no PROVIDER charge, and it does not say "free". */
    assert.strictEqual(job.accounting.costClass, "free_local");
    assert.strictEqual(job.accounting.estimate.unit, "none");
    assert.strictEqual(job.accounting.estimate.amount, 0);
    const Contracts = require(path.join(ROOT, "src/generation/generation-contracts.js"));
    assert(Contracts.validateCostEstimate(job.accounting.estimate).ok);
    assert.strictEqual(Contracts.requiresExplicitAuthorization(job.accounting.estimate), false,
      "a local render has nothing to authorise, which is why it never enters the paid boundary");
    assert(/no hosted provider/i.test(job.accounting.basis.why),
      "the recorded reason must claim only what CineBraid can know: no provider will bill for this");

    /* THE CONTRACTS ARE REAL CONSUMERS HERE, not decoration. */
    assert(Contracts.validateGenerationJob(job.contract).ok, JSON.stringify(Contracts.validateGenerationJob(job.contract).errors));
    assert(Contracts.validateGenerationResult(job.result).ok, JSON.stringify(Contracts.validateGenerationResult(job.result).errors));
    assert.strictEqual(job.result.recipe.recipeId, "smoke.json", "the workflow is the recipe the result names");

    /* AND THE INTENT BOUNDARY HOLDS. The contract's own scan refuses graph and
       transport vocabulary inside production intent; this asserts the job CineBraid
       built actually keeps to it. */
    const intent = JSON.stringify({
      target: job.contract.target, inputs: job.contract.inputs, output: job.contract.output,
      settings: job.contract.settings, model: job.contract.model,
    });
    for (const leaked of ["class_type", "nodeId", "node_id", "prompt_id", "clientId", "graphSnapshot", comfy.baseUrl])
      assert(!intent.includes(leaked), `production intent must not carry "${leaked}"`);
    note("provenance: backend, server identity, execution kind, trust, cost class, workflow path + sha256 + mapped hash, mapping version and confirmation, applied vs kept inputs, seed, ComfyUI prompt id, the whole executed graph, the producing node joined to the delivered file, and both timestamps — with no credential anywhere, a cost that validates as free_local, and production intent free of every graph and transport word");
  } finally { harness.close(); comfy.close(); }
}

/* ===========================================================================
   10. REFUSALS — the ones that protect the record. */
async function refusals() {
  const comfy = await startFakeComfy();
  const harness = await makeHarness({ comfyBaseUrl: comfy.baseUrl });
  try {
    const folder = writeWorkflowFolder(path.join(harness.dir, "workflows"), {
      "smoke.json": apiWorkflow(),
      "editor-document.json": UI_WORKFLOW,
    });
    harness.Config.writeConfig(harness.Config.mergeConfig(harness.Config.readConfig(), { generation: { comfy: { workflowFolder: folder } } }));
    const base = {
      shotId: "SC-01-01", frameId: "frame-a", frameLabel: "A", relativePath: "smoke.json",
      prompt: "a lighthouse",
    };

    /* An unregistered workflow cannot run. */
    let refused = await call(harness, "POST", "/api/generation/comfy/jobs", base);
    assert.strictEqual(refused.status, 409);
    assert.strictEqual(refused.data.code, "COMFY_WORKFLOW_UNREGISTERED");

    /* A UI-format workflow cannot even be mapped. */
    refused = await call(harness, "POST", "/api/generation/comfy/workflow/mapping", {
      relativePath: "editor-document.json",
      bindings: { positivePrompt: { nodeId: "6", input: "text" } },
    });
    assert.strictEqual(refused.data.code, "COMFY_WORKFLOW_NOT_EXECUTABLE");

    await call(harness, "POST", "/api/generation/comfy/workflow/mapping", {
      relativePath: "smoke.json",
      bindings: { positivePrompt: { nodeId: "6", input: "text" }, startImage: { nodeId: "10", input: "image" } },
    });

    /* INPUT IDENTITY. A path, a traversal, another project's media and a missing file
       are four different refusals and not one of them reads a byte. */
    for (const [reference, code] of [
      ["C:\\Windows\\win.ini", "COMFY_REFERENCE_NOT_CINEBRAID_MEDIA"],
      ["/assets/../../../etc/passwd", "COMFY_REFERENCE_OUTSIDE_MEDIA"],
      ["/assets/shots/SC-01-01/takes/../../../project.json", "COMFY_REFERENCE_OUTSIDE_MEDIA"],
      ["/assets/shots/SC-01-01/takes/never-existed.png", "COMFY_REFERENCE_MISSING"],
      ["not-a-url", "COMFY_REFERENCE_NOT_CINEBRAID_MEDIA"],
    ]) {
      const attempt = await call(harness, "POST", "/api/generation/comfy/jobs", { ...base, references: { startImage: reference } });
      assert.strictEqual(attempt.data.code, code, `${reference} → expected ${code}, got ${attempt.data.code}`);
    }
    assert.strictEqual(comfy.state.uploads.length, 0, "not one refused reference reached the provider");
    assert.strictEqual(harness.jobs().length, 0, "and none of them minted a durable job row");

    /* CROSS-PROJECT ISOLATION. Film B's media may not be read while generating for
       Film A, and Film A's result may not land on Film B. */
    const bTakes = path.join(harness.projectsRoot, "film-b", "shots", "SC-99-99", "takes");
    fs.mkdirSync(bTakes, { recursive: true });
    fs.writeFileSync(path.join(bTakes, "B_SECRET.png"), PNG_BYTES);
    const crossed = await call(harness, "POST", "/api/generation/comfy/jobs", {
      ...base, references: { startImage: "/assets/shots/SC-99-99/takes/B_SECRET.png" },
    });
    assert.strictEqual(crossed.data.code, "COMFY_REFERENCE_MISSING",
      "Film B's media is simply not there when the owner is Film A — it is resolved under the captured project and nowhere else");

    /* A shot that is not in this project is refused by name. */
    const wrongShot = await call(harness, "POST", "/api/generation/comfy/jobs", { ...base, shotId: "SC-99-99" });
    assert.strictEqual(wrongShot.data.code, "COMFY_SHOT_MISSING");

    /* A graph ComfyUI itself refuses is recorded as a failure, with ComfyUI's own
       reason, and delivers nothing. */
    const refusingComfy = await startFakeComfy({ refuseGraph: true });
    try {
      harness.Config.writeConfig(harness.Config.mergeConfig(harness.Config.readConfig(), { generation: { comfy: { baseUrl: refusingComfy.baseUrl } } }));
      const rejected = await call(harness, "POST", "/api/generation/comfy/jobs", base);
      assert.strictEqual(rejected.data.code, "COMFY_GRAPH_REFUSED");
      const row = harness.jobs().at(-1);
      assert.strictEqual(row.status, "FAILED", "a refused submission is a recorded failure, not a silent nothing");
      assert.strictEqual(row.ingestedAt, "");
      assert.strictEqual(harness.project().shots[0].candidateFiles.length, 0);
    } finally { refusingComfy.close(); }

    /* A run that finishes having saved nothing says so, rather than reporting success. */
    const emptyComfy = await startFakeComfy({ outcome: "empty" });
    try {
      harness.Config.writeConfig(harness.Config.mergeConfig(harness.Config.readConfig(), { generation: { comfy: { baseUrl: emptyComfy.baseUrl } } }));
      const sent = await call(harness, "POST", "/api/generation/comfy/jobs", base);
      const collected = await call(harness, "POST", `/api/generation/comfy/jobs/${sent.data.job.id}/refresh`);
      assert.strictEqual(collected.data.job.status, "FAILED");
      assert(/Save node/i.test(collected.data.job.error), collected.data.job.error);
      assert.strictEqual(harness.project().shots[0].candidateFiles.length, 0);
    } finally { emptyComfy.close(); }

    /* A ComfyUI error is carried through with the node it happened on. */
    const failingComfy = await startFakeComfy({ outcome: "failed" });
    try {
      harness.Config.writeConfig(harness.Config.mergeConfig(harness.Config.readConfig(), { generation: { comfy: { baseUrl: failingComfy.baseUrl } } }));
      const sent = await call(harness, "POST", "/api/generation/comfy/jobs", base);
      const collected = await call(harness, "POST", `/api/generation/comfy/jobs/${sent.data.job.id}/refresh`);
      assert.strictEqual(collected.data.job.status, "FAILED");
      assert(/KSampler/.test(collected.data.job.error), collected.data.job.error);
      assert(/out of memory/.test(collected.data.job.error), "and ComfyUI's own message, which is what a filmmaker can act on");
    } finally { failingComfy.close(); }

    /* The integration switched off refuses before anything is read. */
    harness.Config.writeConfig(harness.Config.mergeConfig(harness.Config.readConfig(), { generation: { comfy: { enabled: false, baseUrl: comfy.baseUrl } } }));
    const off = await call(harness, "POST", "/api/generation/comfy/jobs", base);
    assert.strictEqual(off.data.code, "COMFY_DISABLED");
    note("refusals: unregistered and UI-format workflows, five shapes of non-CineBraid input identity, another film's media, a shot from another project, a graph ComfyUI rejects, a run that saved nothing, a node that errored, and the integration switched off — nine refusals, none of which writes a candidate and none of which leaves a job claiming delivery");
  } finally { harness.close(); comfy.close(); }
}

/* ===========================================================================
   11. THE MAPPED FILE CHANGED UNDER A LIVE DISPATCH. */
async function changedUnderDispatch() {
  const comfy = await startFakeComfy();
  const harness = await makeHarness({ comfyBaseUrl: comfy.baseUrl });
  try {
    const folder = writeWorkflowFolder(path.join(harness.dir, "workflows"), { "smoke.json": apiWorkflow() });
    harness.Config.writeConfig(harness.Config.mergeConfig(harness.Config.readConfig(), { generation: { comfy: { workflowFolder: folder } } }));
    await call(harness, "POST", "/api/generation/comfy/workflow/mapping", {
      relativePath: "smoke.json",
      bindings: { positivePrompt: { nodeId: "6", input: "text" }, negativePrompt: { nodeId: "7", input: "text" } },
    });

    /* Someone edits the workflow in ComfyUI and removes the node the negative prompt
       was bound to. Nothing rescans; the next dispatch is the first thing to look. */
    const broken = apiWorkflow();
    delete broken["7"];
    fs.writeFileSync(path.join(folder, "smoke.json"), JSON.stringify(broken, null, 2));

    const attempt = await call(harness, "POST", "/api/generation/comfy/jobs", {
      shotId: "SC-01-01", frameId: "frame-a", frameLabel: "A", relativePath: "smoke.json", prompt: "a lighthouse",
    });
    assert.strictEqual(attempt.status, 409);
    assert.strictEqual(attempt.data.code, "COMFY_MAPPING_BROKEN");
    assert.strictEqual(comfy.state.prompts.length, 0, "a stale mapping must not reach ComfyUI at all");
    assert.strictEqual(harness.jobs().length, 0, "and must not mint a job row");

    /* A harmless edit still runs, and the provenance records that the file had moved. */
    const harmless = apiWorkflow();
    harmless["5"].inputs.height = 768;
    fs.writeFileSync(path.join(folder, "smoke.json"), JSON.stringify(harmless, null, 2));
    const ran = await call(harness, "POST", "/api/generation/comfy/jobs", {
      shotId: "SC-01-01", frameId: "frame-a", frameLabel: "A", relativePath: "smoke.json", prompt: "a lighthouse",
    });
    assert.strictEqual(ran.status, 200, JSON.stringify(ran.data));
    const job = harness.jobs().at(-1);
    assert.strictEqual(job.comfy.workflow.changedSinceConfirmed, true,
      "a run against an edited file is legible afterwards rather than indistinguishable from one that was not");
    assert.notStrictEqual(job.comfy.workflow.contentHash, job.comfy.workflow.mappedHash);
    note("changed workflow: a removed mapped node refuses at dispatch with nothing sent and no job row; a harmless edit runs and records both hashes so the difference stays legible");
  } finally { harness.close(); comfy.close(); }
}

/* ===========================================================================
   12. THE RESULT IS AN ORDINARY CANDIDATE. */
async function ordinaryCandidate() {
  const { harness, comfy } = await endToEnd();
  try {
    const MEDIA = require(path.join(ROOT, "public", "shared-production-media.js"));
    const project = harness.project();
    const shot = project.shots[0];
    const candidate = shot.candidateFiles[0];
    const jobs = harness.jobs();

    /* THE SHIPPED PROJECTION, UNCHANGED, reading a ComfyUI candidate. This is the exact
       function the Generated Media surface and the media inspector read, called with the
       real project document and the real job ledger. If it needed a ComfyUI branch, the
       integration would have leaked out of the adapter and into the review path. */
    /* The scan is the filesystem half the real server supplies, built here from the
       files that were actually written — so this asserts against bytes on disk rather
       than against the row that claims them. */
    const scan = { shots: { [shot.id]: { takes: harness.takes().map((name) => ({ name, url: `/assets/shots/${shot.id}/takes/${name}` })) } } };
    const projection = MEDIA.productionMediaRecords({ project, scan, jobs, jobsAvailable: true });
    const row = projection.records.find((entry) => String(entry.file || entry.name || "").includes(candidate.stored)
      || String(entry.key || "").includes(candidate.stored));
    assert(row, `the delivered candidate must appear in the shipped media projection; got ${projection.records.length} rows`);
    const provenance = row.provenance;
    assert.strictEqual(provenance.provider.state, "known");
    assert.strictEqual(provenance.provider.value, "ComfyUI");
    assert.strictEqual(provenance.model.value, "smoke.json");
    assert.strictEqual(provenance.job.state, "resolved");
    assert.strictEqual(provenance.requestId.value, "fixture-prompt-1");
    /* AND IT ARRIVES CLAIMING NOTHING. The shipped disposition kernel places it as a
       candidate with no authority — which is what "returned for review" means in
       CineBraid, and is the property a backend must not be able to bypass. */
    assert.strictEqual(row.disposition.role, "candidate", JSON.stringify(row.disposition));
    assert.strictEqual(row.disposition.authority.claimed, false, "a returned result claims no approval");
    assert.strictEqual(row.disposition.source, "partitionShotMedia",
      "and it is placed by the shipped kernel, not by anything the ComfyUI path wrote");

    /* AND THE FAL CANDIDATE SHAPE IS UNCHANGED — the same reader, the same fields, one
       shared writer. A row that a ComfyUI run produced is structurally a row that a fal
       run produces, which is why the review surface needs no new word. */
    const Ingest = require(path.join(ROOT, "src/generation/generation-candidate-ingest.js"));
    const falRow = Ingest.candidateRow({ storedName: "x.png", originalName: "x.png", job: { id: "j", model: "m" }, provider: "fal", packageLabel: "FAL generation" });
    assert.deepStrictEqual(Object.keys(falRow).sort(), Object.keys(Ingest.candidateRow({
      storedName: "y.png", originalName: "y.png", job: { id: "k", model: "n" }, provider: "ComfyUI", packageLabel: "ComfyUI generation",
    })).sort(), "both backends produce the same row, because there is one writer");
    note("ordinary candidate: the shipped provenance reader resolves provider, model, job and request id from a ComfyUI candidate with no ComfyUI branch, and the row is field-for-field the shape fal produces");
  } finally { harness.close(); comfy.close(); }
}

/* ===========================================================================
   12b. A CONFIRMED MAPPING CERTIFIES THE NODE CLASS — MAP-C1..C4.

   Driven through the REAL confirmation route and the REAL dispatch route, against a
   durable registry on disk, because the defect this closes lived precisely in the gap
   between what the writer stored and what the validator could check. A unit test that
   constructs the binding itself cannot see that gap. */
async function mappingCertifiesNodeClass() {
  const comfy = await startFakeComfy();
  const harness = await makeHarness({ comfyBaseUrl: comfy.baseUrl });
  try {
    const folder = writeWorkflowFolder(path.join(harness.dir, "workflows"), { "smoke.json": apiWorkflow() });
    harness.Config.writeConfig(harness.Config.mergeConfig(harness.Config.readConfig(), { generation: { comfy: { workflowFolder: folder } } }));
    const target = path.join(folder, "smoke.json");
    const dispatch = { shotId: "SC-01-01", frameId: "frame-a", frameLabel: "A", relativePath: "smoke.json", prompt: "a lighthouse" };
    const confirmPrompt = () => call(harness, "POST", "/api/generation/comfy/workflow/mapping", {
      relativePath: "smoke.json", bindings: { positivePrompt: { nodeId: "6", input: "text" } },
    });

    /* --- MAP-C1: the exact reproduction. CLIPTextEncode.text confirmed, then node 6
       becomes a PrimitiveString while keeping its id. ------------------------------ */
    const saved = await confirmPrompt();
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.data));
    const stored = JSON.parse(fs.readFileSync(harness.registryPath, "utf8"));
    assert.strictEqual(stored.workflows[0].mapping.bindings.positivePrompt.classType, "CLIPTextEncode",
      "the class must reach DISK, not merely the in-memory mapping");

    const swapped = apiWorkflow();
    swapped["6"] = { class_type: "PrimitiveString", inputs: { text: "a cat" }, _meta: { title: "Positive Prompt" } };
    fs.writeFileSync(target, JSON.stringify(swapped, null, 2));

    const listed = await call(harness, "GET", "/api/generation/comfy/workflows");
    const row = listed.data.workflows.find((entry) => entry.relativePath === "smoke.json");
    assert.notStrictEqual(row.contentHash, row.mappedHash, "MAP-C1: the workflow must read as changed");
    assert.strictEqual(row.state, "broken", `MAP-C1: and the mapping must read as broken, got ${row.state}`);
    assert(row.problems.some((problem) => problem.code === "class-changed"),
      `MAP-C1: naming the class change, got ${JSON.stringify(row.problems.map((p) => p.code))}`);
    assert(row.problems.some((problem) => /confirm/i.test(problem.action || "")),
      "MAP-C1: and asking the filmmaker to confirm it again");

    const refused = await call(harness, "POST", "/api/generation/comfy/jobs", dispatch);
    assert.strictEqual(refused.status, 409, JSON.stringify(refused.data));
    assert.strictEqual(refused.data.code, "COMFY_MAPPING_BROKEN", "MAP-C1: dispatch must refuse");
    assert.strictEqual(comfy.state.prompts.length, 0, "MAP-C1: and nothing may reach ComfyUI");
    assert.strictEqual(harness.jobs().length, 0, "MAP-C1: and no job row may be minted");

    /* Reconfirmation against the graph as it now stands restores it — the filmmaker is
       asked, not blocked forever. */
    const reconfirmed = await confirmPrompt();
    assert.strictEqual(reconfirmed.data.state, "ready", JSON.stringify(reconfirmed.data));
    assert.strictEqual(reconfirmed.data.bindings.positivePrompt.classType, "PrimitiveString",
      "reconfirming certifies the class that is there now");

    /* --- MAP-C2: an unrelated node is added. Nothing may be invalidated. ---------- */
    fs.writeFileSync(target, JSON.stringify(apiWorkflow(), null, 2));
    await confirmPrompt();
    const withExtra = apiWorkflow();
    withExtra["11"] = { class_type: "PreviewImage", inputs: { images: ["8", 0] }, _meta: { title: "Preview" } };
    fs.writeFileSync(target, JSON.stringify(withExtra, null, 2));
    const afterAdd = (await call(harness, "GET", "/api/generation/comfy/workflows")).data.workflows
      .find((entry) => entry.relativePath === "smoke.json");
    assert.strictEqual(afterAdd.state, "changed", `MAP-C2: unreviewed, not broken — got ${afterAdd.state}`);
    assert.deepStrictEqual(afterAdd.problems, [], "MAP-C2: an unrelated node must raise no mapping problem");
    const ran = await call(harness, "POST", "/api/generation/comfy/jobs", dispatch);
    assert.strictEqual(ran.status, 200, `MAP-C2: a still-compatible mapping must still run — ${JSON.stringify(ran.data)}`);

    /* --- MAP-C3: the mapped node, and then the mapped input, go. ----------------- */
    const removedInput = apiWorkflow();
    removedInput["6"] = { class_type: "CLIPTextEncode", inputs: { prompt: "a cat", clip: ["4", 1] }, _meta: { title: "Positive Prompt" } };
    fs.writeFileSync(target, JSON.stringify(removedInput, null, 2));
    let broken = await call(harness, "POST", "/api/generation/comfy/jobs", dispatch);
    assert.strictEqual(broken.data.code, "COMFY_MAPPING_BROKEN", "MAP-C3: a renamed input still refuses");
    const removedNode = apiWorkflow();
    delete removedNode["6"];
    fs.writeFileSync(target, JSON.stringify(removedNode, null, 2));
    broken = await call(harness, "POST", "/api/generation/comfy/jobs", dispatch);
    assert.strictEqual(broken.data.code, "COMFY_MAPPING_BROKEN", "MAP-C3: a removed node still refuses");

    /* --- MAP-C4: a persisted confirmation with no class cannot dispatch. ---------- */
    fs.writeFileSync(target, JSON.stringify(apiWorkflow(), null, 2));
    await confirmPrompt();
    const registry = JSON.parse(fs.readFileSync(harness.registryPath, "utf8"));
    delete registry.workflows[0].mapping.bindings.positivePrompt.classType;
    fs.writeFileSync(harness.registryPath, JSON.stringify(registry, null, 2));
    const legacyRow = (await call(harness, "GET", "/api/generation/comfy/workflows")).data.workflows
      .find((entry) => entry.relativePath === "smoke.json");
    assert.strictEqual(legacyRow.state, "broken", `MAP-C4: an unprovable confirmation is not confirmed — got ${legacyRow.state}`);
    assert(legacyRow.problems.some((problem) => problem.code === "class-unconfirmed"), JSON.stringify(legacyRow.problems));
    const legacyDispatch = await call(harness, "POST", "/api/generation/comfy/jobs", dispatch);
    assert.strictEqual(legacyDispatch.data.code, "COMFY_MAPPING_BROKEN",
      "MAP-C4: and it must not silently dispatch as confirmed");
    note("mapping certifies the node class: MAP-C1 the real writer stores CLIPTextEncode to disk and a PrimitiveString on the same node id reads changed + broken + refused with nothing queued, and reconfirming restores it; MAP-C2 an unrelated node stays compatible and still runs; MAP-C3 a renamed input and a removed node still refuse; MAP-C4 a stored confirmation with the class deleted cannot dispatch");
  } finally { harness.close(); comfy.close(); }
}

/* ===========================================================================
   12a. AN UNSUPPLIED SEED IS ABSENT, NOT ZERO.

   Found by the FIRST REAL GENERATION, not by this suite — which is the finding worth
   recording. The dispatch dialog says "Leave empty for the workflow's own seed"; the
   browser sends `seed: null` for an empty field; `Number(null)` is 0 and
   `Number.isFinite(0)` is true, so the run applied a deliberate seed of 0 over the
   workflow author's 42 and recorded it as an APPLIED input.

   This suite missed it because every fixture either passed a real seed or omitted the
   key entirely — and `undefined` happens to fail the finite-check, so the bug was
   invisible to exactly the two shapes a test writer reaches for. The browser's own
   shape, an explicit null, is the one that was never tried.

   All three absence shapes are pinned here, and 0 is pinned as a REAL seed: a filmmaker
   who types 0 means 0, and treating it as absence would be the same defect wearing the
   other face. */
async function unsuppliedSeedIsAbsent() {
  const Generation = require(path.join(ROOT, "src/generation/comfyui/comfy-generation.js"));
  for (const [label, seed] of [["null", null], ["undefined", undefined], ["empty string", ""]]) {
    const job = Generation.contractJob({
      jobId: "seed-check", shotId: "SC-01-01", frameId: "frame-a", prompt: "a lighthouse",
      negativePrompt: "", references: [], seed, recipeId: "smoke.json", status: "preparing_inputs",
    });
    assert.strictEqual(job.settings.seedMode, "random", `${label} must read as no seed`);
    assert(!("seed" in job.settings), `${label} must not put a seed in production intent`);
  }
  for (const [label, seed, expected] of [["zero", 0, 0], ["seven", 7, 7], ["numeric string", "12", 12]]) {
    const job = Generation.contractJob({
      jobId: "seed-check", shotId: "SC-01-01", frameId: "frame-a", prompt: "a lighthouse",
      negativePrompt: "", references: [], seed, recipeId: "smoke.json", status: "preparing_inputs",
    });
    assert.strictEqual(job.settings.seedMode, "explicit", `${label} is a chosen seed`);
    assert.strictEqual(job.settings.seed, expected, `${label} must survive as ${expected}`);
  }

  /* AND END TO END, through the route, with the browser's own payload shape. The
     workflow's own seed must reach ComfyUI untouched and be RECORDED as kept. */
  const comfy = await startFakeComfy();
  const harness = await makeHarness({ comfyBaseUrl: comfy.baseUrl });
  try {
    const folder = writeWorkflowFolder(path.join(harness.dir, "workflows"), { "smoke.json": apiWorkflow() });
    harness.Config.writeConfig(harness.Config.mergeConfig(harness.Config.readConfig(), { generation: { comfy: { workflowFolder: folder } } }));
    await call(harness, "POST", "/api/generation/comfy/workflow/mapping", {
      relativePath: "smoke.json",
      bindings: { positivePrompt: { nodeId: "6", input: "text" }, seed: { nodeId: "3", input: "seed" } },
    });
    const sent = await call(harness, "POST", "/api/generation/comfy/jobs", {
      shotId: "SC-01-01", frameId: "frame-a", frameLabel: "A", relativePath: "smoke.json",
      prompt: "a lighthouse", negativePrompt: "", seed: null, references: {},
    });
    assert.strictEqual(sent.status, 200, JSON.stringify(sent.data));
    const graph = comfy.state.prompts[0].graph;
    assert.strictEqual(graph["3"].inputs.seed, 12345,
      "an empty seed field must leave the workflow author's seed exactly where it was");
    const job = harness.jobs().at(-1);
    assert.strictEqual(job.comfy.seed, null, "and the provenance must record no seed rather than a zero");
    assert(job.comfy.keptWorkflowValues.some((row) => row.key === "seed" && row.keptWorkflowValue),
      "and must record that the workflow's own seed is what ran");
    assert(!job.comfy.appliedInputs.some((row) => row.key === "seed"),
      "and must not claim CineBraid applied a seed it never chose");
    note("unsupplied seed: null, undefined and \"\" all read as absent while 0 stays a real seed; an empty field leaves the author's 12345 in the graph and is recorded as kept, not applied");
  } finally { harness.close(); comfy.close(); }
}

/* ===========================================================================
   13. THE BROWSER HOLDS ONE LEDGER, AND ROUTES ON THE BACKEND THAT OWNS EACH ROW.

   Found by the browser dogfood, not by reading. A delivered ComfyUI candidate appeared
   correctly in Generated Media — right shot, right frame, reviewable — underneath the
   sentence "Generation records are not loaded in this session, so provider, model and
   cost cannot be shown", on a project where all three were recorded. The browser only
   read the generation ledger when fal was configured, and this installation had never
   configured fal.

   Both halves are asserted here because they are one change: the browser must LOAD the
   local ledger on its own condition, and must not let a local row be ROUTED as a fal
   one. A ComfyUI job carries `purpose: "frame"` exactly as a fal frame job does, so
   without the ownership filter a local render would draw fal's strip — offering Cancel
   and Try again against a provider that was never contacted.

   Asserted against the source because both are statements about the module's shape:
   public/fal-generation.js and public/app.js are browser scripts that cannot be required
   in node, and a runtime copy of either rule would be a second rule. */
function browserLedgerOwnership() {
  const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8").replace(/\r\n/g, "\n");
  const fal = fs.readFileSync(path.join(ROOT, "public", "fal-generation.js"), "utf8").replace(/\r\n/g, "\n");

  /* THE EARLY RETURN GOES THROUGH THE OTHER BACKENDS' READ, not past it. This exact line
     is the defect: `return prepared;` here is what produced the wrong sentence.

     The loader was renamed when Civitai reproduced the same defect — a function that also
     reads a hosted paid provider's ledger is not a "local" one — but the property is
     unchanged and is what is asserted. */
  assert(/if \(!\(falConfig\.enabled && falConfig\.keySource !== "none"\)\) return prepareBackendGenerationLedgers\(prepared\);/.test(app),
    "a keyless fal must still read the other backends' generation ledger");
  assert(!/keySource !== "none"\)\) return prepared;/.test(app),
    "the early return that skipped the other backends' ledger must be gone, not merely bypassed");

  /* AND EACH BACKEND GATES ON ITS OWN CONDITION — never on fal's, and never on another
     backend's. ComfyUI's read must not depend on Civitai being configured, or the defect
     simply moves. */
  const local = app.slice(app.indexOf("async function prepareBackendGenerationLedgers"));
  const body = local.slice(0, 600);
  assert(/generation\.comfy\?\.enabled === true\) await appendBackendGenerationLedger\(prepared, "\/api\/generation\/comfy\/jobs"\)/.test(body),
    "the ComfyUI ledger read must gate on the ComfyUI integration, never on fal");
  assert(/generation\.civitai\?\.enabled === true\) await appendBackendGenerationLedger\(prepared, "\/api\/generation\/civitai\/jobs"\)/.test(body),
    "the Civitai ledger read must gate on the Civitai integration, never on fal or ComfyUI");
  assert(!/return prepared;\s*\n\s*if \(generation\.civitai/.test(body),
    "one backend being switched off must not stop the next one from being read");
  assert(/prepared\.falLedgerLoaded = true;/.test(local.slice(0, 2400)),
    "a backend ledger that answered is a loaded ledger");
  assert(/seen\.has\(String\(row\.id \|\| ""\)\)/.test(local.slice(0, 2400)),
    "rows already held must not be appended twice — fal's route returns the whole ledger");

  /* THE ROUTING FILTER. */
  assert(/function falOwnedJob\(job\) \{/.test(fal), "fal must have an explicit ownership predicate");
  const predicate = fal.slice(fal.indexOf("function falOwnedJob(job) {"), fal.indexOf("function falGenerationJob("));
  assert(/backendId === "fal-queue"/.test(predicate),
    "and it must name fal's own backend id rather than excluding a list of others");
  assert(/const backendId = String\(job\?\.backendId \|\| ""\)\.trim\(\);\s*\n\s*return !backendId \|\| backendId === "fal-queue";/.test(predicate),
    "a row with no backend id is fal's — that is the only backend whose rows predate the field");
  assert(/\.filter\(falOwnedJob\)/.test(fal.slice(fal.indexOf("function falGenerationJob("), fal.indexOf("function falGenerationJob(") + 400)),
    "falGenerationJob must route on ownership, or a local render draws fal's strip");
  /* fal-queue is the id fal's own adapters declare; if it is renamed there, the
     predicate above is silently wrong, so the two are joined here. */
  const backend = fs.readFileSync(path.join(ROOT, "src/generation/fal/fal-image-backend.js"), "utf8");
  assert(/backendId: "fal-queue"/.test(backend), "the predicate's id must be the one fal's adapter actually stamps");
  note("browser ledger: a keyless fal still loads the local ledger and reports it loaded, and fal's shot strip routes on an explicit ownership predicate joined to the backend id its own adapter stamps");
}

/* ===========================================================================
   14. THE ROUTES THAT READ THIS MACHINE ANSWER ONLY THIS MACHINE.

   Every /api route is already editor-gated, and an editor can already set a workspace
   root — but "may configure this production" and "may read directories on the machine
   hosting it" are different powers, and four of these routes exercise the second: they
   list a folder, read files out of it and report what is inside them.

   So they carry the same loopback gate local-file-affordance.js applies, for the same
   reason. Dispatch, collection and status are deliberately NOT gated: those act on
   production, which an editor on the network is entitled to do.

   Asserted structurally because the predicate itself — isLoopbackRequest, which reads
   the socket's peer address and ignores Host, X-Forwarded-For and every other
   caller-controlled header — is already exhaustively proven against real sockets by
   tests/account-lan-safety.js. What is worth pinning here is that these four routes
   reach it and the other four do not. */
/* ===========================================================================
   14b. A LAN CALLER CANNOT STEER A HOST-LOCAL REQUEST — LAN-C1..C5.

   The defect this closes, exactly as it was reproduced: comfy-client.js constrains where
   CineBraid may CONNECT, and that says nothing about who chose the address. A LAN browser
   wrote `generation.comfy.baseUrl` through /api/config, called /test, and made the host
   issue requests to 127.0.0.1:49199 — a private service on the operator's machine the
   browser could not reach itself. The destination being loopback is not the property that
   matters; the caller controlling it is.

   Driven over REAL SOCKETS against a server bound to 0.0.0.0, with the requests made to a
   non-loopback local address, the same way tests/account-lan-safety.js proves its own
   boundary. A fabricated `req` object would be testing this file's idea of a peer rather
   than the socket the server actually sees.

   THE INTERCEPTOR IS THE ASSERTION. A listener on 49199 records every connection, so
   "refused" is proven by nothing arriving rather than by a status code alone. */
async function lanCallerCannotSteerHostRequests() {
  const os = require("os");
  /* A real non-loopback address on this machine. Without one there is no way to make a
     genuine LAN-shaped request, and a control that silently degraded to loopback would
     report itself green while proving the opposite. */
  const lanAddress = Object.values(os.networkInterfaces()).flat()
    .filter(Boolean)
    .find((row) => row.family === "IPv4" && !row.internal)?.address;
  if (!lanAddress) {
    note("LAN boundary: SKIPPED — this machine exposes no non-loopback IPv4 address, so no genuine LAN peer could be simulated");
    return;
  }

  /* The attacker-selected host-local service. It answers nothing useful; its only job is
     to notice if CineBraid is ever made to knock. */
  const intercepted = [];
  const decoy = http.createServer((req, res) => {
    intercepted.push(req.url);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ system: { comfyui_version: "decoy" }, devices: [] }));
  });
  await new Promise((resolve) => decoy.listen(49199, "127.0.0.1", resolve));

  const comfy = await startFakeComfy();
  /* THE REAL server.js, spawned and bound to 0.0.0.0. The config half of this boundary
     lives in PUT /api/config, which the in-process harness does not mount — and a
     harness that re-implemented that rule would be proving its own copy rather than the
     product's. tests/generation-ingest-reaper.js spawns a real server for the same
     reason. */
  const spawned = await startRealServer({ comfyBaseUrl: comfy.baseUrl, host: "0.0.0.0" });
  try {
    /* A confirmed, runnable workflow, so LAN-C3's refusal is the boundary rather than an
       unregistered workflow refusing for an unrelated reason. */
    const asLoopback = (method, route, body) => spawned.request(method, route, body, "127.0.0.1");
    const confirmed = await asLoopback("POST", "/api/generation/comfy/workflow/mapping", {
      relativePath: "smoke.json", bindings: { positivePrompt: { nodeId: "6", input: "text" } },
    });
    assert.strictEqual(confirmed.status, 200, JSON.stringify(confirmed.data));

    const harness = spawned;
    const call = asLoopback;
    const asLan = (method, route, body) => spawned.request(method, route, body, lanAddress);

    /* --- LAN-C1: the exact reproduction. --------------------------------------- */
    const wrote = await asLan("PUT", "/api/config", { generation: { comfy: { baseUrl: "http://127.0.0.1:49199" } } });
    assert.strictEqual(wrote.status, 403, `LAN-C1: the config write must be refused — ${JSON.stringify(wrote.data)}`);
    assert.strictEqual(wrote.data.code, "LOOPBACK_REQUIRED");
    assert.strictEqual(spawned.Config.readConfig().generation.comfy.baseUrl, comfy.baseUrl,
      "LAN-C1: and must not be persisted");

    const tested = await asLan("POST", "/api/generation/comfy/test");
    assert.strictEqual(tested.status, 403, `LAN-C1: the test route must be refused — ${JSON.stringify(tested.data)}`);
    assert.strictEqual(tested.data.code, "LOOPBACK_REQUIRED");
    assert.deepStrictEqual(intercepted, [], "LAN-C1: and nothing may reach 49199");

    /* --- LAN-C2: the malicious address is already in the configuration. --------- */
    spawned.Config.writeConfig(spawned.Config.mergeConfig(spawned.Config.readConfig(), {
      generation: { comfy: { baseUrl: "http://127.0.0.1:49199" } },
    }));
    const testedAgain = await asLan("POST", "/api/generation/comfy/test");
    assert.strictEqual(testedAgain.status, 403, "LAN-C2: the route still refuses");
    const statusAsLan = await asLan("GET", "/api/generation/comfy/status");
    assert.strictEqual(statusAsLan.status, 403, "LAN-C2: and so does status, which also probes");
    assert.deepStrictEqual(intercepted, [], "LAN-C2: still nothing may reach 49199");
    spawned.Config.writeConfig(spawned.Config.mergeConfig(spawned.Config.readConfig(), {
      generation: { comfy: { baseUrl: comfy.baseUrl } },
    }));

    /* --- LAN-C3: dispatch. ----------------------------------------------------- */
    const dispatched = await asLan("POST", "/api/generation/comfy/jobs", {
      shotId: "SC-01-01", frameId: "frame-a", frameLabel: "A", relativePath: "smoke.json", prompt: "a lighthouse",
    });
    assert.strictEqual(dispatched.status, 403, `LAN-C3: dispatch must be refused — ${JSON.stringify(dispatched.data)}`);
    assert.strictEqual(comfy.state.prompts.length, 0, "LAN-C3: and no prompt may be queued");
    assert.strictEqual(spawned.jobs().length, 0, "LAN-C3: and no job row minted");

    /* EVERY route, so a second one cannot be missing the guard. */
    for (const [method, route] of [
      ["GET", "/api/generation/comfy/status"],
      ["POST", "/api/generation/comfy/test"],
      ["GET", "/api/generation/comfy/workflows"],
      ["POST", "/api/generation/comfy/workflow"],
      ["POST", "/api/generation/comfy/workflow/mapping"],
      ["POST", "/api/generation/comfy/workflow/forget"],
      ["GET", "/api/generation/comfy/jobs"],
      ["POST", "/api/generation/comfy/jobs"],
      ["POST", "/api/generation/comfy/jobs/never/refresh"],
    ]) {
      const attempt = await asLan(method, route, method === "POST" ? {} : undefined);
      assert.strictEqual(attempt.status, 403, `${method} ${route} must refuse a LAN peer, got ${attempt.status}`);
      assert.strictEqual(attempt.data.code, "LOOPBACK_REQUIRED", `${method} ${route} must refuse by name`);
    }

    /* --- LAN-C4: an ordinary loopback client is unaffected. --------------------- */
    const loopbackTest = await asLoopback("POST", "/api/generation/comfy/test");
    assert.strictEqual(loopbackTest.status, 200, JSON.stringify(loopbackTest.data));
    assert.strictEqual(loopbackTest.data.connected, true, "LAN-C4: loopback may still test the connection");
    const loopbackRun = await asLoopback("POST", "/api/generation/comfy/jobs", {
      shotId: "SC-01-01", frameId: "frame-a", frameLabel: "A", relativePath: "smoke.json", prompt: "a lighthouse",
    });
    assert.strictEqual(loopbackRun.status, 200, `LAN-C4: loopback may still dispatch — ${JSON.stringify(loopbackRun.data)}`);
    assert.strictEqual(comfy.state.prompts.length, 1, "LAN-C4: and the workflow really ran");

    /* --- LAN-C5: unrelated configuration is untouched by the scoped rule. ------- */
    const appearance = await asLan("PUT", "/api/config", { appearance: { accent: "green" } });
    assert.strictEqual(appearance.status, 200, `LAN-C5: an unrelated setting must still save from a LAN editor — ${JSON.stringify(appearance.data)}`);
    assert.strictEqual(spawned.Config.readConfig().appearance.accent, "green", "LAN-C5: and must persist");
    const falPatch = await asLan("PUT", "/api/config", { generation: { fal: { blockingOutputs: 3 } } });
    assert.strictEqual(falPatch.status, 200, "LAN-C5: a non-comfy generation setting keeps its existing behaviour");
    assert.strictEqual(spawned.Config.readConfig().generation.fal.blockingOutputs, 3);
    assert.strictEqual(spawned.Config.readConfig().generation.comfy.baseUrl, comfy.baseUrl,
      "LAN-C5: and the comfy block is unchanged throughout");

    assert.deepStrictEqual(intercepted, [], "no request may ever have reached the attacker-selected port");
    note(`LAN boundary: against the real server bound to 0.0.0.0 and driven from ${lanAddress}, the config write is refused and not persisted, all nine ComfyUI routes refuse by name, dispatch queues nothing, and the decoy on 127.0.0.1:49199 recorded ZERO requests — while loopback still tests, dispatches and runs, and appearance and fal settings still save from the LAN`);
  } finally {
    await spawned.close();
    comfy.close();
    decoy.close();
  }
}

/* A real `node server.js`, on a disposable config and a disposable project tree.
   Returns a request helper that can be pointed at either the loopback address or a
   genuine LAN address on this machine, so the peer the server sees is a real socket
   peer rather than this file's opinion of one. */
async function startRealServer({ comfyBaseUrl, host }) {
  const { spawn } = require("child_process");
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "cb-lan-"));
  const projectsRoot = path.join(dir, "projects");
  fs.mkdirSync(path.join(projectsRoot, "film-a", "shots"), { recursive: true });
  fs.writeFileSync(path.join(projectsRoot, "film-a", "project.json"), JSON.stringify({
    meta: { title: "LAN boundary fixture" },
    shots: [{ id: "SC-01-01", title: "SC-01-01", candidateFiles: [], keyframes: [] }],
    mediaAssets: [],
  }, null, 2));
  const workflows = writeWorkflowFolder(path.join(dir, "workflows"), { "smoke.json": apiWorkflow() });
  const configPath = path.join(dir, "config.json");
  const registryPath = path.join(dir, "comfy-workflows.json");

  const env = { ...process.env, CINEBRAID_CONFIG_PATH: configPath, CINEBRAID_COMFY_REGISTRY_PATH: registryPath };
  delete require.cache[path.join(ROOT, "src/server/config.js")];
  const saved = process.env.CINEBRAID_CONFIG_PATH;
  process.env.CINEBRAID_CONFIG_PATH = configPath;
  const Config = require(path.join(ROOT, "src/server/config.js"));
  Config.writeConfig(Config.mergeConfig(Config.readConfig(), {
    workspace: { projectRoot: projectsRoot },
    generation: { comfy: { enabled: true, baseUrl: comfyBaseUrl, workflowFolder: workflows } },
  }));

  const port = 4000 + Math.floor(Math.random() * 900);
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...env, PORT: String(port), CINEBRAID_HOST: host },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs = [];
  child.stdout.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr.on("data", (chunk) => logs.push(String(chunk)));
  const deadline = Date.now() + 30000;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`server did not start: ${logs.join("")}`);
    try {
      const probe = await fetch(`http://127.0.0.1:${port}/api/me`);
      if (probe.ok) break;
    } catch { /* still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return {
    dir, port, configPath, registryPath, Config, logs,
    request: async (method, route, body, address) => {
      const response = await fetch(`http://${address}:${port}${route}`, {
        method,
        headers: body ? { "content-type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: response.status, data: await response.json().catch(() => ({})) };
    },
    jobs: () => {
      const file = path.join(projectsRoot, "film-a", "generation-jobs.json");
      return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
    },
    close: async () => {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
      if (saved) process.env.CINEBRAID_CONFIG_PATH = saved; else delete process.env.CINEBRAID_CONFIG_PATH;
      delete require.cache[path.join(ROOT, "src/server/config.js")];
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    },
  };
}

function localOnlyConfigurationRoutes() {
  const source = fs.readFileSync(path.join(ROOT, "src/generation/comfyui/comfy-generation.js"), "utf8").replace(/\r\n/g, "\n");
  assert(/const \{ isLoopbackRequest \} = require\("\.\.\/\.\.\/server\/loopback-request"\);/.test(source),
    "the gate must use the shipped peer-address predicate, not a header check written here");
  assert(/function requireLocalMachine\(req, res\) \{\s*\n\s*if \(isLoopbackRequest\(req\)\) return true;/.test(source),
    "and it must permit on the predicate rather than deny on a guess");

  /* EVERY ComfyUI ROUTE, DISCOVERED FROM THE SOURCE RATHER THAN TYPED.
   *
   * An earlier version of this section listed four gated routes and asserted the other
   * three were deliberately NOT gated. That was the defect, written down as an
   * invariant: it made a missing guard look like a decision. The list is now derived, so
   * a route added later is covered the day it lands rather than the day someone
   * remembers this file — and the count is asserted, so a route that stops matching the
   * pattern cannot silently drop out of the census. */
  const declarations = [...source.matchAll(/app\.(get|post)\("(\/api\/generation\/comfy[^"]*)"/g)];
  assert(declarations.length >= 9,
    `the ComfyUI route census found only ${declarations.length}: ${JSON.stringify(declarations.map((m) => m[2]))}`);
  /* The guard has to be the FIRST statement of the handler, so it runs before any body
     is read, any config is consulted and any request is made. Checking the whole handler
     body would pass on a guard placed after the work it is supposed to prevent. */
  for (const match of declarations) {
    const head = source.slice(match.index, match.index + match[0].length + 140);
    const [, first] = head.split("=> {");
    assert(/^\s*\n?\s*if \(!requireLocalMachine\(req, res\)\) return;/.test(first || ""),
      `${match[1].toUpperCase()} ${match[2]} must refuse a non-loopback peer as its FIRST act — a LAN caller must not be able to steer a host-local request. Saw: ${JSON.stringify((first || "").slice(0, 90))}`);
  }

  /* AND THE MATCHING CONFIGURATION RULE, which is the half a route guard cannot cover:
     without it a LAN browser could still set the address through /api/config and leave
     it waiting for the next local action. Asserted to be NARROW — scoped to the comfy
     block, not to /api/config as a whole. */
  const server = fs.readFileSync(path.join(ROOT, "src/server/server.js"), "utf8").replace(/\r\n/g, "\n");
  assert(/if \(!isLoopbackRequest\(req\) && Object\.prototype\.hasOwnProperty\.call\(body\.generation \|\| \{\}, "comfy"\)\) \{/.test(server),
    "a non-loopback caller must not be able to write generation.comfy through the general config endpoint");
  const putConfig = server.slice(server.indexOf('app.put("/api/config"'), server.indexOf('app.get("/api/workspace/status"'));
  assert(!/^\s*if \(!isLoopbackRequest\(req\)\) return res/m.test(putConfig),
    "and the rule must stay scoped to the comfy block rather than making /api/config loopback-only");
  note(`local-only routes: all ${declarations.length} ComfyUI routes, discovered from the source rather than listed, go through the shipped peer-address gate, and generation.comfy is the only config block a LAN caller is refused`);
}

/* =========================================================================== */
async function main() {
  browserLedgerOwnership();
  localOnlyConfigurationRoutes();
  await lanCallerCannotSteerHostRequests();
  formatTruth();
  suggestionIsNotConfirmation();
  changeDetection();
  dispatchGraph();
  await folderIsNotPathAuthority();
  await mappingPersistence();
  await connectionTruth();
  await ordinaryCandidate();
  await provenanceAndCost();
  await refusals();
  await changedUnderDispatch();
  await unsuppliedSeedIsAbsent();
  await mappingCertifiesNodeClass();
  console.log("ComfyUI foothold V1 suite passed:");
  for (const line of notes) console.log(`  - ${line}`);
}

/* Run when invoked, EXPORT when required. tests/comfy-integration-negative-controls.js
   drives the same harness and the same fixtures through deliberately broken copies of
   the modules under test — a control that built its own harness would be proving that
   its own harness fails, which is not the claim. */
if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

module.exports = { apiWorkflow, UI_WORKFLOW, PNG_BYTES, call, codeOf, makeHarness, startFakeComfy, startRealServer, writeWorkflowFolder };

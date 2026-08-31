/* CineBraid local-only AI policy.

   A project set to local-only is asking for its material to stay on this machine.
   That used to be resolved to the literal provider name "ollama", which both refused
   a loopback custom server and would have accepted an Ollama URL on another computer.
   Locality is a property of the endpoint, and this suite pins both halves of it:
   loopback qualifies, everything else does not.

   The endpoints here are local mocks and one deliberately unresolvable name. */
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-local-only-"));
const PROJECTS_ROOT = path.join(TEMP, "projects");
const PROJECT_DIR = path.join(PROJECTS_ROOT, "policy-project");
const CONFIG_PATH = path.join(TEMP, "config.json");
const REMOTE_BASE = "http://remote-provider.example/v1";

let child = null;
const servers = [];
const customChat = [];
const ollamaChat = [];

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startServer(handler) {
  const port = await freePort();
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  servers.push(server);
  return { server, port };
}

function request(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body == null ? null : JSON.stringify(options.body);
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: pathname,
      method: options.method || "GET",
      headers: body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {},
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data = text;
        try { data = JSON.parse(text); } catch (_) {}
        resolve({ status: res.statusCode, text, data });
      });
    });
    req.once("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function waitForServer(port) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child?.exitCode != null) throw new Error(`server exited early: ${child.output}`);
    try {
      const response = await request(port, "/api/projects");
      if (response.status === 200) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server did not start");
}

async function stopServer() {
  if (child && child.exitCode == null) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
    if (child.exitCode == null) child.kill("SIGKILL");
  }
  for (const server of servers) server.close();
}

function writeProject(aiPolicy) {
  fs.writeFileSync(path.join(PROJECT_DIR, "project.json"), JSON.stringify({
    meta: { title: "Policy Project", format: "Test", version: "v1", hubVersion: "v5.5.0", aiPolicy },
    qcChecklist: [],
    characters: [],
    locations: [],
    props: [],
    vehicles: [],
    audio: [],
    mediaAssets: [],
    scenes: [{ id: "SC-01", title: "Scene One" }],
    shots: [{
      id: "S-01",
      scene: "SC-01",
      title: "Test shot",
      desc: "A fixed exterior camera watches a ship in darkness.",
      positioning: "Locked hull-camera composition.",
      dur: 10,
      workflowStatus: "DRAFT",
      characters: [],
      codes: [],
      keyframes: [],
      clips: [],
    }],
    jobs: [],
    agentRuns: [],
    decisions: [],
    sessions: [],
  }, null, 2));
}

function writeConfigFile(patch) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    activeProject: "policy-project",
    assistant: { provider: "custom", visionProvider: "ollama" },
    agents: { enabled: false },
    generation: { fal: { enabled: false, apiKey: "" } },
    customModel: "local-text-model",
    ollamaModel: "local-text-model",
    ollamaVisionModel: "local-vision-model",
    ollamaEmbedModel: "local-embed-model",
    ...patch,
  }, null, 2));
}

async function compile(port, useLLM) {
  return request(port, "/api/prompt/compile", {
    method: "POST",
    body: {
      shotId: "S-01",
      profileId: "gpt-image-2/t2i",
      purpose: "shot-still",
      references: [],
      useLLM,
    },
  });
}

/* THE BRAIDY RAIL'S QUESTION, which reaches /api/project/ask.

   That route resolved its provider from cfg.assistant.provider directly and never
   consulted the policy, so a local-only project's compact record would have been
   posted to a configured remote API. Nothing had ever called the route, so nothing had
   ever hit it; the Braidy rail calls it, which is what makes it worth pinning here
   beside the compile path it now matches. */
async function ask(port, question = "What is left to do on this shot?") {
  return request(port, "/api/project/ask", { method: "POST", body: { question } });
}

async function main() {
  /* ---- 1. what counts as an endpoint on this machine ---- */
  const { isLocalProviderEndpoint } = require("../llm");
  for (const local of [
    "http://127.0.0.1:11436",
    "http://127.0.0.1:11436/v1",
    "https://127.0.0.1/v1",
    "http://127.5.4.3:8000/v1",
    "http://localhost:11436/v1",
    "http://LocalHost:11436/v1",
    "http://localhost./v1",
    "http://api.localhost:8000/v1",
    "http://[::1]:11436/v1",
    "http://[0:0:0:0:0:0:0:1]:11436/v1",
    "http://[::ffff:127.0.0.1]:11436/v1",
    "http://operator@127.0.0.1:11436/v1",
  ])
    assert.strictEqual(isLocalProviderEndpoint(local), true, `${local} is on this machine`);

  for (const remote of [
    "http://192.168.68.116:11436/v1",
    "http://10.0.0.4:8000/v1",
    "http://spark.local:11436/v1",
    "https://api.openai.com/v1",
    "http://127.0.0.1.evil.example/v1",
    // The loopback address is the user info here; the host is somebody else entirely.
    "http://127.0.0.1:11436@evil.example/v1",
    "http://notlocalhost/v1",
    "http://localhost.evil.example/v1",
    "http://[::2]:11436/v1",
    "http://0.0.0.0:11436/v1",
    "http://127.0.0.999:11436/v1",
    "127.0.0.1:11436",
    "not a url",
    "",
    null,
    undefined,
  ])
    assert.strictEqual(isLocalProviderEndpoint(remote), false, `${remote} must not satisfy local-only`);

  /* ---- 2. the policy actually routes that way ---- */
  fs.mkdirSync(PROJECT_DIR, { recursive: true });
  for (const dir of ["anchors", "plates", "props", "audio", "media", "shots", "docs"])
    fs.mkdirSync(path.join(PROJECT_DIR, dir), { recursive: true });

  const custom = await startServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url.endsWith("/chat/completions")) {
      customChat.push(req.url);
      return res.end(JSON.stringify({ choices: [{ message: { content: "{}" } }] }));
    }
    res.end(JSON.stringify({ object: "list", data: [{ id: "local-text-model" }] }));
  });
  const ollama = await startServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/tags")
      return res.end(JSON.stringify({ models: [{ name: "local-text-model" }, { name: "local-vision-model" }, { name: "local-embed-model" }] }));
    ollamaChat.push(req.url);
    res.end(JSON.stringify({ message: { content: "{}" } }));
  });
  const localBase = `http://127.0.0.1:${custom.port}/v1`;
  const ollamaUrl = `http://127.0.0.1:${ollama.port}`;

  writeProject("local-only");
  writeConfigFile({ customBaseUrl: localBase, ollamaUrl });

  const port = await freePort();
  child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT, CINEBRAID_CONFIG_PATH: CONFIG_PATH },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.output = "";
  child.stdout.on("data", (chunk) => { child.output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { child.output += chunk.toString(); });

  const reset = () => { customChat.length = 0; ollamaChat.length = 0; };

  try {
    await waitForServer(port);

    /* a loopback custom endpoint satisfies local-only */
    let response = await compile(port, true);
    assert.strictEqual(response.status, 200);
    assert(customChat.length > 0, "a loopback custom endpoint must be allowed to serve a local-only project");
    assert.strictEqual(ollamaChat.length, 0, "the custom provider must not be silently replaced by Ollama");

    /* the same provider pointed somewhere else does not */
    reset();
    writeConfigFile({ customBaseUrl: REMOTE_BASE, ollamaUrl });
    response = await compile(port, true);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(customChat.length, 0, "a remote custom endpoint must never serve a local-only project");
    assert(ollamaChat.length > 0, "local-only falls back to the local Ollama endpoint");

    /* neither does a remote Ollama: with nothing local, the request is refused */
    reset();
    writeConfigFile({ customBaseUrl: REMOTE_BASE, ollamaUrl: "http://192.168.68.116:11434" });
    response = await compile(port, true);
    assert.strictEqual(response.status, 200, "a refused assistant still compiles deterministically");
    assert.strictEqual(response.data.llmUsed, false);
    assert.strictEqual(customChat.length, 0);
    assert.strictEqual(ollamaChat.length, 0, "no provider may be contacted when none of them is local");
    assert(
      response.data.warnings.some((warning) => /local-only/i.test(warning)),
      "the compiled prompt must say why the assistant was not used",
    );

    /* THE SAME THREE ANSWERS FOR A PROJECT QUESTION.

       Asserted against the mocks rather than against the response, because what is
       being pinned is which host the material reached — a 200 that quietly went to a
       remote API is the failure, not a shape. */
    reset();
    writeProject("local-only");
    writeConfigFile({ customBaseUrl: localBase, ollamaUrl });
    response = await ask(port);
    assert.strictEqual(response.status, 200, "a loopback custom endpoint must be allowed to answer a local-only project's question");
    assert(customChat.length > 0, "the loopback custom endpoint must be the one that answered");

    reset();
    writeConfigFile({ customBaseUrl: REMOTE_BASE, ollamaUrl });
    response = await ask(port);
    /* THE POSITIVE CLAIM FIRST, because it is the one that can fail for the right
       reason. REMOTE_BASE is an unresolvable name rather than a mock, so
       `customChat.length === 0` is satisfied both by a policy that redirected the
       request and by one that sent it to the remote and got DNS failure. Only "Ollama
       answered" separates them. */
    assert(ollamaChat.length > 0,
      "a local-only project's question must be re-pointed at the local Ollama endpoint; the configured remote custom endpoint was used instead");
    assert.strictEqual(customChat.length, 0, "the loopback custom mock must not have served this case at all");

    reset();
    writeConfigFile({ customBaseUrl: REMOTE_BASE, ollamaUrl: "http://192.168.68.116:11434" });
    response = await ask(port);
    assert.strictEqual(customChat.length + ollamaChat.length, 0,
      "with no local provider a local-only project's question must be refused rather than sent");
    assert.notStrictEqual(response.status, 200, "the refusal must be reported rather than answered around");

    /* a project without the policy keeps its configured routing */
    reset();
    writeProject("project-default");
    writeConfigFile({ customBaseUrl: localBase, ollamaUrl });
    response = await compile(port, true);
    assert.strictEqual(response.status, 200);
    assert(customChat.length > 0, "an unrestricted project must still use its configured provider");

    /* ---- 3. deterministic compilation stays deterministic ---- */
    reset();
    writeProject("local-only");
    const first = await compile(port, false);
    const second = await compile(port, false);
    assert.strictEqual(first.status, 200);
    assert.strictEqual(first.data.llmUsed, false);
    assert(first.data.compiledPrompt.length > 0);
    assert.strictEqual(
      first.data.compiledPrompt,
      second.data.compiledPrompt,
      "useLLM:false must compile the same prompt every time",
    );
    assert.strictEqual(customChat.length + ollamaChat.length, 0, "useLLM:false must contact no provider at all");

    console.log("Local-only policy suite passed: loopback endpoints qualify, remote custom and remote Ollama endpoints do not, a project with no local provider refuses rather than sends on both the compile path and the Braidy rail's question path, and deterministic compilation is untouched.");
  } finally {
    await stopServer();
    fs.rmSync(TEMP, { recursive: true, force: true });
  }
}

main().catch(async (error) => {
  console.error(error.stack || error.message || error);
  await stopServer();
  fs.rmSync(TEMP, { recursive: true, force: true });
  process.exitCode = 1;
});

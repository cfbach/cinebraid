/* CineBraid AI health and readiness across providers.

   Readiness used to be described almost entirely in Ollama's terms, so a healthy
   custom OpenAI-compatible text server could not switch the assistant controls on,
   and a configured-but-dead one looked fine. Both directions are asserted here,
   together with the rule that the browser is told what CineBraid can do and never
   where it goes to do it.

   Every provider in this suite is a local mock. Nothing depends on a live service. */
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-provider-health-"));
const PROJECTS_ROOT = path.join(TEMP, "projects");
const CONFIG_PATH = path.join(TEMP, "config.json");
const CUSTOM_KEY = "custom-server-secret-key";

let child = null;
const servers = [];

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

function request(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: pathname, method: "GET" }, (res) => {
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

function writeConfigFile(patch) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    activeProject: "cinebraid-sample",
    agents: { enabled: true },
    generation: { fal: { enabled: false, apiKey: "" } },
    customKey: CUSTOM_KEY,
    customVisionModel: "",
    ollamaModel: "local-text-model",
    ollamaVisionModel: "local-vision-model",
    ollamaEmbedModel: "local-embed-model",
    ...patch,
  }, null, 2));
}

async function main() {
  fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
  fs.cpSync(path.join(ROOT, "projects", "cinebraid-sample"), path.join(PROJECTS_ROOT, "cinebraid-sample"), { recursive: true });

  const modelRequests = [];
  const custom = await startServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url === "/v1/models") {
      modelRequests.push(req.headers.authorization || "");
      return res.end(JSON.stringify({ object: "list", data: [{ id: "nemotron_3_nano_omni" }] }));
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { message: "not found" } }));
  });
  const ollamaEmpty = await startServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ models: [] }));
  });
  const ollamaReady = await startServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ models: [{ name: "local-text-model" }, { name: "local-vision-model" }, { name: "local-embed-model" }] }));
  });
  const deadPort = await freePort();

  const customBase = `http://127.0.0.1:${custom.port}/v1`;
  writeConfigFile({
    assistant: { provider: "custom", visionProvider: "ollama" },
    customBaseUrl: customBase,
    customModel: "nemotron_3_nano_omni",
    ollamaUrl: `http://127.0.0.1:${ollamaEmpty.port}`,
  });

  const port = await freePort();
  child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT, CINEBRAID_CONFIG_PATH: CONFIG_PATH },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.output = "";
  child.stdout.on("data", (chunk) => { child.output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { child.output += chunk.toString(); });

  try {
    await waitForServer(port);

    /* ---- 1. a healthy custom text provider is enough on its own ---- */
    let status = await request(port, "/api/agents/status");
    assert.strictEqual(status.status, 200);
    assert.strictEqual(status.data.capabilities.text.ready, true, "a reachable custom text provider must enable text assistance");
    assert.strictEqual(status.data.capabilities.text.provider, "custom");
    assert.strictEqual(status.data.capabilities.text.model, "nemotron_3_nano_omni", "the custom provider states its own model, not an Ollama tag");
    assert.strictEqual(status.data.manualMode, false);
    assert.strictEqual(status.data.localModels.count, 0, "Ollama must be holding no models for this to prove anything");
    assert.strictEqual(status.data.capabilities.vision.ready, false, "Ollama vision is deliberately not ready here");
    assert.strictEqual(status.data.capabilities.vision.provider, "ollama", "vision stays on its own provider path and is not pulled onto the custom server");
    assert.strictEqual(status.data.capabilities.embedding.provider, "ollama", "embeddings stay routed to Ollama; the custom text server serves none");
    assert(modelRequests.length >= 1, "readiness must probe the custom server");
    assert.strictEqual(modelRequests.at(-1), `Bearer ${CUSTOM_KEY}`, "the probe must present the configured key");

    let health = await request(port, "/api/system/health");
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.data.assistant.provider, "custom");
    assert.strictEqual(health.data.assistant.text.ready, true);
    assert.strictEqual(health.data.assistant.embedding.provider, "ollama");
    assert.strictEqual(health.data.custom.configured, true);
    assert.strictEqual(health.data.custom.reachable, true);
    assert.deepStrictEqual(health.data.custom.models, ["nemotron_3_nano_omni"]);
    assert.strictEqual(health.data.ollama.plannerReady, false, "the Ollama block must still report Ollama honestly");

    /* ---- 2. nothing about where the provider lives reaches the browser ---- */
    for (const [name, response] of [["health", health], ["agent status", status]]) {
      assert(!response.text.includes(customBase), `${name} must not expose the custom base URL`);
      assert(!response.text.includes(`127.0.0.1:${custom.port}`), `${name} must not expose the custom endpoint address`);
      assert(!response.text.includes(CUSTOM_KEY), `${name} must not expose the custom API key`);
      assert(!/customBaseUrl/.test(response.text), `${name} must not carry a customBaseUrl field`);
    }

    /* ---- 3. an unreachable custom provider fails closed ---- */
    writeConfigFile({
      assistant: { provider: "custom", visionProvider: "ollama" },
      customBaseUrl: `http://127.0.0.1:${deadPort}/v1`,
      customModel: "nemotron_3_nano_omni",
      ollamaUrl: `http://127.0.0.1:${ollamaEmpty.port}`,
    });
    status = await request(port, "/api/agents/status");
    assert.strictEqual(status.data.capabilities.text.ready, false, "an unreachable custom provider must not leave text controls enabled");
    assert.match(status.data.capabilities.text.message, /cannot reach the custom AI server/i);
    assert.match(status.data.capabilities.text.action, /Settings/);
    assert.strictEqual(status.data.manualMode, true);
    health = await request(port, "/api/system/health");
    assert.strictEqual(health.data.custom.reachable, false);
    assert.match(String(health.data.custom.error), /^(unreachable|timeout|HTTP \d+)$/, "a provider failure must be described without its address");
    assert(!health.text.includes(`127.0.0.1:${deadPort}`), "an unreachable provider's address must not leak either");

    /* ---- 4. a custom server that does not serve the configured model ---- */
    writeConfigFile({
      assistant: { provider: "custom", visionProvider: "ollama" },
      customBaseUrl: customBase,
      customModel: "some-other-model",
      ollamaUrl: `http://127.0.0.1:${ollamaEmpty.port}`,
    });
    status = await request(port, "/api/agents/status");
    assert.strictEqual(status.data.capabilities.text.ready, false);
    assert.match(status.data.capabilities.text.message, /is not served by the custom AI server/i);
    assert.match(status.data.capabilities.text.action, /nemotron_3_nano_omni/, "the served names are the useful part of the advice");

    /* ---- 5. an unconfigured custom provider is never contacted ---- */
    const probesBefore = modelRequests.length;
    writeConfigFile({
      assistant: { provider: "ollama", visionProvider: "same" },
      customBaseUrl: customBase,
      customModel: "nemotron_3_nano_omni",
      ollamaUrl: `http://127.0.0.1:${ollamaReady.port}`,
    });

    /* ---- 6. Ollama readiness is exactly what it was ---- */
    status = await request(port, "/api/agents/status");
    assert.strictEqual(status.data.capabilities.text.ready, true);
    assert.strictEqual(status.data.capabilities.text.provider, "ollama");
    assert.strictEqual(status.data.capabilities.text.model, "local-text-model");
    assert.strictEqual(status.data.capabilities.vision.ready, true);
    assert.strictEqual(status.data.capabilities.vision.model, "local-vision-model");
    assert.strictEqual(status.data.capabilities.embedding.ready, true);
    assert.strictEqual(status.data.manualMode, false);
    health = await request(port, "/api/system/health");
    assert.strictEqual(health.data.ollama.plannerReady, true);
    assert.strictEqual(health.data.ollama.visionReady, true);
    assert.strictEqual(health.data.ollama.embeddingReady, true);
    assert.strictEqual(health.data.custom.inUse, false);
    assert.strictEqual(
      modelRequests.length,
      probesBefore,
      "a custom endpoint nothing is routed to must not be contacted",
    );

    console.log("Provider health suite passed: a healthy custom text provider stands alone, an unreachable one fails closed, provider addresses and keys stay server-side, and Ollama readiness is unchanged.");
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

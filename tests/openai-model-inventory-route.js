const assert = require("assert");
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");
const { disposableRoot, ROOT } = require("./helpers/disposable-root");

const workspace = disposableRoot("openai-model-inventory-route");
const KEY = "sk-fixture-MUST-NEVER-LEAK";

async function availablePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => socket.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

function startServer(port, preload) {
  const child = spawn(process.execPath, ["--require", preload, "server.js"], {
    cwd: ROOT,
    env: workspace.serverEnv(port, { FAL_KEY: "" }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not become ready. stdout=${stdout} stderr=${stderr}`)), 15000);
    const check = () => {
      if (stdout.includes("CINEBRAID →")) { clearTimeout(timer); resolve(); }
    };
    child.stdout.on("data", check);
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Server exited ${code}. stdout=${stdout} stderr=${stderr}`)); });
  });
  return { child, ready, output: () => stdout + stderr };
}

async function main() {
  const modeFile = path.join(workspace.home, "mock-mode.txt");
  const preload = path.join(workspace.home, "mock-openai-fetch.js");
  fs.writeFileSync(modeFile, "success", "utf8");
  /* The child never reaches a provider. A response body containing the dummy key
     verifies that the route does not reflect arbitrary provider diagnostics. */
  fs.writeFileSync(preload, `const fs = require("fs");
const modeFile = ${JSON.stringify(modeFile)};
global.fetch = async (url, options) => {
  if (url === "https://api.openai.com/v1/responses") {
    const body = JSON.parse(options.body);
    if (body.store !== false || body.model !== "gpt-5.6-luna")
      throw new Error("Braidy test must use exact selected model and store:false");
    return { ok: true, status: 200, json: async () => ({
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: "CineBraid assistant connected" }] }],
    }) };
  }
  if (url !== "https://api.openai.com/v1/models") throw new Error("Unexpected external request");
  if (!String(options?.headers?.authorization || "").startsWith("Bearer sk-fixture-")) throw new Error("Missing server-held credential");
  if (fs.readFileSync(modeFile, "utf8") === "fail")
    return { ok: false, status: 401, json: async () => ({ error: { message: "sk-fixture-MUST-NEVER-LEAK" } }) };
  return { ok: true, status: 200, json: async () => ({ data: [{ id: "gpt-5.6-luna" }, { id: "gpt-5.6-sol" }] }) };
};
`, "utf8");

  const port = await availablePort();
  const server = startServer(port, preload);
  const origin = `http://127.0.0.1:${port}`;
  try {
    await server.ready;
    let response = await fetch(`${origin}/api/assistant/openai/models`);
    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), { configured: false, connected: false, models: [] });

    response = await fetch(`${origin}/api/config`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ openaiKey: KEY, openaiBraidyModel: "gpt-5.6-luna", assistant: { provider: "openai" } }),
    });
    assert.strictEqual(response.status, 200, "dummy key and selected model are saved to disposable config");
    response = await fetch(`${origin}/api/config`);
    const safeConfig = await response.json();
    assert.strictEqual(safeConfig.openaiBraidyModel, "gpt-5.6-luna");
    assert.strictEqual(JSON.stringify(safeConfig).includes(KEY), false, "GET config never returns the full key");

    response = await fetch(`${origin}/api/assistant/openai/models`);
    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), { configured: true, connected: true, models: ["gpt-5.6-luna", "gpt-5.6-sol"] });

    response = await fetch(`${origin}/api/assistant/test`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "openai" }),
    });
    assert.strictEqual(response.status, 200, "the saved Braidy model uses the mocked Responses API for its explicit test");
    assert.match((await response.json()).message, /CineBraid assistant connected/);
    fs.writeFileSync(modeFile, "fail", "utf8");
    response = await fetch(`${origin}/api/assistant/openai/models`);
    assert.strictEqual(response.status, 502);
    const failure = await response.text();
    assert.strictEqual(failure.includes(KEY), false, "provider error body is never reflected into Settings");
    assert.strictEqual(JSON.parse(failure).connected, false);
    assert.strictEqual(server.output().includes(KEY), false, "server output does not log the dummy secret");
    console.log("OpenAI model inventory route: no-key, account models, persisted selection, masking and redaction passed (mocked).");
  } finally {
    if (server.child.exitCode === null && server.child.signalCode === null) {
      const exited = new Promise((resolve) => server.child.once("exit", resolve));
      server.child.kill();
      await exited;
    }
    workspace.cleanup();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

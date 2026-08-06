/* CineBraid custom OpenAI-compatible provider.

   "Custom" has to stay a generic OpenAI-compatible provider — vLLM, LM Studio,
   llama.cpp, a hosted API — while still being configurable enough to drive a
   reasoning server such as vLLM-served Nemotron, which returns an empty answer
   unless thinking is suppressed and sampling is pinned down.

   Everything here runs against a local mock endpoint. No suite in CineBraid may
   depend on a live model service. */
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-custom-provider-"));
const CONFIG_PATH = path.join(TEMP, "config.json");
process.env.CINEBRAID_CONFIG_PATH = CONFIG_PATH;

const { normalizeConfig } = require("../config");

const textBodies = [];
const visionBodies = [];
const ollamaBodies = [];
let upstream = null;
let ollama = null;
let chatReply = { content: "CineBraid assistant connected" };

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

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
  });
}

function startServer(handler) {
  return new Promise(async (resolve) => {
    const port = await freePort();
    const server = http.createServer(handler);
    server.listen(port, "127.0.0.1", () => resolve({ server, port }));
  });
}

function hasImages(body) {
  const content = body.messages?.[1]?.content;
  return Array.isArray(content) ? content.filter((part) => part?.type === "image_url").length : 0;
}

function writeConfigFile(patch) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    assistant: { provider: "custom", visionProvider: "same" },
    routing: { extract: "assistant", bulk: "assistant", draft: "assistant", prompt: "assistant", critic: "assistant", embed: "ollama" },
    customBaseUrl: `http://127.0.0.1:${upstream.port}/v1`,
    customModel: "nemotron_3_nano_omni",
    customVisionModel: "nemotron_3_nano_omni",
    ollamaUrl: `http://127.0.0.1:${ollama.port}`,
    ollamaModel: "local-text-model",
    ollamaVisionModel: "local-vision-model",
    ...patch,
  }, null, 2));
}

async function main() {
  upstream = await startServer(async (req, res) => {
    const body = await readBody(req);
    res.setHeader("content-type", "application/json");
    if (req.url.endsWith("/chat/completions")) {
      (hasImages(body) ? visionBodies : textBodies).push(body);
      return res.end(JSON.stringify({ choices: [{ message: chatReply }] }));
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { message: "not found" } }));
  });
  ollama = await startServer(async (req, res) => {
    const body = await readBody(req);
    res.setHeader("content-type", "application/json");
    ollamaBodies.push({ url: req.url, body });
    res.end(JSON.stringify({ message: { content: "local reply" } }));
  });

  const { llm, vision, customRequestBody } = require("../llm");

  /* ---- 1. a generic custom endpoint is sent nothing it did not ask for ---- */
  writeConfigFile({});
  let answer = await llm("prompt", "system", "user", 40, "custom");
  assert.strictEqual(answer, "CineBraid assistant connected");
  let sent = textBodies.at(-1);
  assert.strictEqual(sent.model, "nemotron_3_nano_omni");
  assert.strictEqual(sent.max_tokens, 40);
  assert.deepStrictEqual(sent.messages.map((m) => m.role), ["system", "user"]);
  for (const field of ["temperature", "top_k", "chat_template_kwargs"])
    assert(!(field in sent), `an unconfigured custom provider must not be sent ${field}`);

  /* ---- 2. configured options reach the endpoint ---- */
  writeConfigFile({ customTemperature: "0.2", customTopK: "1", customThinking: "disabled" });
  answer = await llm("prompt", "system", "user", 40, "custom");
  sent = textBodies.at(-1);
  assert.strictEqual(sent.temperature, 0.2);
  assert.strictEqual(sent.top_k, 1);
  assert.deepStrictEqual(sent.chat_template_kwargs, { enable_thinking: false });
  assert.strictEqual(sent.model, "nemotron_3_nano_omni", "request options must not displace the configured model");
  assert.deepStrictEqual(sent.messages.map((m) => m.role), ["system", "user"]);

  /* ---- 3. each option is independent, and JSON mode still works with them ---- */
  writeConfigFile({ customThinking: "disabled" });
  await llm("prompt", "system", "user", 40, "custom", "", { responseFormat: "json" });
  sent = textBodies.at(-1);
  assert.deepStrictEqual(sent.chat_template_kwargs, { enable_thinking: false });
  assert(!("temperature" in sent), "thinking control alone must not add sampling fields");
  assert(!("top_k" in sent));
  assert.deepStrictEqual(sent.response_format, { type: "json_object" });

  /* ---- 4. blank and unusable values stay blank rather than becoming zero ---- */
  const normalized = normalizeConfig({ customTemperature: "", customTopK: "not a number", customThinking: "sometimes" });
  assert.strictEqual(normalized.customTemperature, "");
  assert.strictEqual(normalized.customTopK, "");
  assert.strictEqual(normalized.customThinking, "auto");
  assert.deepStrictEqual(customRequestBody(normalized), {}, "a blank configuration must produce no extra request fields");
  assert.deepStrictEqual(
    customRequestBody(normalizeConfig({ customTemperature: 9, customTopK: 0 })),
    { temperature: 2, top_k: 1 },
    "out-of-range numbers are clamped rather than dropped or sent raw",
  );

  /* ---- 5. custom options belong to the custom provider only ---- */
  writeConfigFile({
    customTemperature: "0.2",
    customThinking: "disabled",
    openaiKey: "test-key",
    openaiBaseUrl: `http://127.0.0.1:${upstream.port}/v1`,
    openaiModel: "gpt-test",
  });
  await llm("prompt", "system", "user", 40, "openai");
  sent = textBodies.at(-1);
  assert.strictEqual(sent.model, "gpt-test");
  for (const field of ["temperature", "top_k", "chat_template_kwargs"])
    assert(!(field in sent), `the OpenAI provider must never receive the custom provider's ${field}`);

  /* ---- 6. Ollama is untouched by all of this ---- */
  const ollamaCountBefore = ollamaBodies.length;
  await llm("prompt", "system", "user", 40, "ollama");
  assert.strictEqual(ollamaBodies.length, ollamaCountBefore + 1);
  const ollamaSent = ollamaBodies.at(-1);
  assert.strictEqual(ollamaSent.url, "/api/chat");
  assert.strictEqual(ollamaSent.body.think, false, "native Ollama text calls must keep thinking disabled");
  assert.strictEqual(ollamaSent.body.model, "local-text-model");
  assert.strictEqual(ollamaSent.body.options.num_predict, 40);
  for (const field of ["temperature", "top_k", "chat_template_kwargs"])
    assert(!(field in ollamaSent.body), `Ollama must not receive the custom provider's ${field}`);

  /* ---- 7. multi-image custom vision keeps its existing shape ---- */
  const twoImages = ["iVBORimageone", "UklGRimagetwo"];
  writeConfigFile({});
  await vision("system", "user", twoImages, 400, "custom");
  let visionSent = visionBodies.at(-1);
  assert.strictEqual(hasImages(visionSent), 2, "custom vision must still send every image in one request");
  assert.strictEqual(visionSent.model, "nemotron_3_nano_omni");
  assert.strictEqual(visionSent.max_tokens, 400);
  for (const field of ["temperature", "top_k", "chat_template_kwargs"])
    assert(!(field in visionSent), `an unconfigured custom vision request must not be sent ${field}`);

  writeConfigFile({ customTemperature: "0.2", customThinking: "disabled" });
  await vision("system", "user", twoImages, 400, "custom");
  visionSent = visionBodies.at(-1);
  assert.strictEqual(hasImages(visionSent), 2, "configured request options must not change how images are sent");
  assert.strictEqual(visionSent.temperature, 0.2);
  assert.deepStrictEqual(visionSent.chat_template_kwargs, { enable_thinking: false });

  /* ---- 8. reasoning with no answer is still reported as a failure ---- */
  chatReply = { content: "", reasoning_content: "thinking about it" };
  writeConfigFile({});
  await assert.rejects(
    () => llm("prompt", "system", "user", 40, "custom"),
    /returned reasoning but no final answer/i,
    "an endpoint that spends the whole budget on reasoning must still fail loudly",
  );
  chatReply = { content: "CineBraid assistant connected" };

  console.log("Custom provider routing suite passed: generic requests stay generic, configured options reach only the custom provider, Ollama/OpenAI and multi-image vision are unchanged.");
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  })
  .finally(() => {
    upstream?.server.close();
    ollama?.server.close();
    fs.rmSync(TEMP, { recursive: true, force: true });
  });

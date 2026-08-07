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

  /* ---- 7b. REGRESSION GUARD: a generic vision call is byte-for-byte what it
       was before continuity existed. The structured single-image path is opt-in
       through request options; a caller that passes none must be unchanged. ---- */
  writeConfigFile({});
  await vision("system", "user", twoImages, 400, "custom");
  const genericBody = visionBodies.at(-1);
  assert.deepStrictEqual(
    Object.keys(genericBody).sort(),
    ["max_tokens", "messages", "model"],
    "a generic custom vision request must carry exactly the fields it always carried",
  );
  for (const field of ["response_format", "guided_json", "json_schema", "temperature", "top_k", "chat_template_kwargs", "stream"])
    assert(!(field in genericBody), `a generic vision request must never be given the continuity field ${field}`);
  assert.strictEqual(hasImages(genericBody), 2, "generic vision still sends every image in one request");
  assert.deepStrictEqual(genericBody.messages.map((m) => m.role), ["system", "user"]);
  assert.strictEqual(genericBody.messages[1].content[0].type, "text", "generic vision message structure is unchanged");

  /* ---- 7c. the structured single-image continuity request ---- */
  const { buildObservationSchema, OBSERVATION_REQUEST_CONTRACT, OBSERVATION_SCHEMA_NAME } = require("../public/shared-continuity");
  const manifest = {
    entities: [{
      entity_id: "prop_mug", display_name: "Mug", entity_type: "prop", parent_entity_id: null,
      continuity_unit: "self", identity_cues: "A mug.", allowed_state_values: null,
      track_presence: true, track_movement: true, track_color: true, track_state: false, track_markings: false,
    }],
  };
  const schema = buildObservationSchema(manifest);
  await vision("system", "user", ["iVBORoneimage"], 400, "custom", "", {
    jsonSchema: schema,
    schemaName: OBSERVATION_SCHEMA_NAME,
    contract: OBSERVATION_REQUEST_CONTRACT,
  });
  const structured = visionBodies.at(-1);
  assert.strictEqual(hasImages(structured), 1, "the continuity path sends exactly one image");
  assert.strictEqual(structured.response_format.type, "json_schema");
  assert.strictEqual(structured.response_format.json_schema.name, "declared_entities_final");
  assert.strictEqual(structured.response_format.json_schema.strict, true);
  assert.deepStrictEqual(structured.response_format.json_schema.schema, schema);
  assert.strictEqual(structured.temperature, 0.2);
  assert.strictEqual(structured.top_k, 1);
  assert.strictEqual(structured.max_tokens, 4096);
  assert.strictEqual(structured.stream, false);
  assert.deepStrictEqual(structured.chat_template_kwargs, { enable_thinking: false });
  assert(!("guided_json" in structured), "guided_json was never the qualified path");

  /* The qualified contract wins over the user's general assistant preferences.
     A director raising their assistant temperature must not silently
     invalidate the continuity qualification. */
  writeConfigFile({ customTemperature: "1.8", customTopK: "80", customThinking: "auto" });
  await vision("system", "user", ["iVBORoneimage"], 400, "custom", "", {
    jsonSchema: schema, schemaName: OBSERVATION_SCHEMA_NAME, contract: OBSERVATION_REQUEST_CONTRACT,
  });
  const pinned = visionBodies.at(-1);
  assert.strictEqual(pinned.temperature, 0.2, "the qualified temperature must survive a conflicting user setting");
  assert.strictEqual(pinned.top_k, 1, "the qualified top_k must survive a conflicting user setting");
  assert.deepStrictEqual(pinned.chat_template_kwargs, { enable_thinking: false }, "the qualified thinking setting must survive customThinking:auto");
  /* And that same conflicting configuration still reaches a generic call. */
  await vision("system", "user", twoImages, 400, "custom");
  assert.strictEqual(visionBodies.at(-1).temperature, 1.8, "generic vision still honours the user's own setting");
  assert(!("response_format" in visionBodies.at(-1)));
  writeConfigFile({});

  /* ---- 7d. strict structured output is refused on providers that cannot do it ---- */
  for (const provider of ["ollama", "anthropic"])
    await assert.rejects(
      () => vision("system", "user", ["iVBORoneimage"], 400, provider, "", { jsonSchema: schema }),
      /cannot return strict structured output/i,
      `${provider} must refuse a strict structured request rather than send an unconstrained one`,
    );

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

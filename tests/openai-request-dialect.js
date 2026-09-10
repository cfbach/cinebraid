/* CineBraid — official OpenAI vs generic OpenAI-compatible request dialect.

   REPRODUCTION. During dogfood, FAL GPT Image 2 produced a character-reference
   candidate and CineBraid's automated visual review failed three times against
   the official OpenAI provider with:

     Unsupported parameter: 'max_tokens' is not supported with this model.
     Use 'max_completion_tokens' instead.

   That is not a model problem. The official Chat Completions API has retired
   max_tokens on its current model families and rejects the request outright,
   and CineBraid wrote every OpenAI-compatible request — official and generic
   alike — with max_tokens.

   The repair is a dialect, not a rename. "OpenAI-compatible" describes a wire
   format, not a promise that every server implements every parameter the
   official API currently accepts: the vLLM-served Nemotron this project is
   qualified against takes max_tokens and refuses max_completion_tokens. So this
   suite pins BOTH halves — the official path must send the new field and never
   the old one, and every generic path must be byte-shape identical to what it
   already was.

   Both upstreams here are deterministic local mocks. No suite in CineBraid may
   depend on a live model service, and nothing here costs a paid API call. */
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-openai-dialect-"));
const CONFIG_PATH = path.join(TEMP, "config.json");
process.env.CINEBRAID_CONFIG_PATH = CONFIG_PATH;

/* The exact text the live API returned during dogfood. The mock reproduces the
   rejection verbatim so a regression is recognisable as the same failure. */
const OFFICIAL_REJECTION =
  "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.";
const COMPATIBLE_REJECTION = "Unrecognized request argument supplied: max_completion_tokens";

const officialBodies = [];
const compatibleBodies = [];
const ollamaBodies = [];
let official = null;
let compatible = null;
let ollama = null;

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
function imageParts(body) {
  const content = body.messages?.[1]?.content;
  return Array.isArray(content) ? content.filter((part) => part?.type === "image_url") : [];
}

/* An upstream that behaves like the current official OpenAI Chat Completions
   API for the affected model families: max_tokens is refused, and the request
   is only served when the budget arrives under its current name. */
function officialHandler(bodies) {
  return async (req, res) => {
    const body = await readBody(req);
    res.setHeader("content-type", "application/json");
    if (!req.url.endsWith("/chat/completions")) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: { message: "not found" } }));
    }
    bodies.push({ url: req.url, authorization: req.headers.authorization, body });
    if ("max_tokens" in body) {
      res.statusCode = 400;
      return res.end(JSON.stringify({
        error: { message: OFFICIAL_REJECTION, type: "invalid_request_error", param: "max_tokens", code: "unsupported_parameter" },
      }));
    }
    if (!("max_completion_tokens" in body)) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: { message: "Missing required parameter: 'max_completion_tokens'." } }));
    }
    res.end(JSON.stringify({ choices: [{ message: { content: "official reply" } }] }));
  };
}
/* And an upstream that behaves like the qualified generic server: it has never
   heard of max_completion_tokens, which is precisely why the fix must not be
   applied globally to every OpenAI-compatible provider. */
function compatibleHandler(bodies) {
  return async (req, res) => {
    const body = await readBody(req);
    res.setHeader("content-type", "application/json");
    if (!req.url.endsWith("/chat/completions")) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: { message: "not found" } }));
    }
    bodies.push({ url: req.url, authorization: req.headers.authorization, body });
    if ("max_completion_tokens" in body) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: { message: COMPATIBLE_REJECTION, type: "BadRequestError" } }));
    }
    res.end(JSON.stringify({ choices: [{ message: { content: "compatible reply" } }] }));
  };
}

function writeConfigFile(patch = {}) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    assistant: { provider: "openai", visionProvider: "same" },
    routing: { extract: "assistant", bulk: "assistant", draft: "assistant", prompt: "assistant", critic: "assistant", embed: "ollama" },
    openaiBaseUrl: `http://127.0.0.1:${official.port}/v1`,
    openaiKey: "official-key",
    openaiModel: "gpt-under-test",
    openaiVisionModel: "gpt-vision-under-test",
    customBaseUrl: `http://127.0.0.1:${compatible.port}/v1`,
    customKey: "",
    customModel: "nemotron_3_nano_omni",
    customVisionModel: "nemotron_3_nano_omni",
    ollamaUrl: `http://127.0.0.1:${ollama.port}`,
    ollamaModel: "local-text-model",
    ollamaVisionModel: "local-vision-model",
    ...patch,
  }, null, 2));
}

async function main() {
  official = await startServer(officialHandler(officialBodies));
  compatible = await startServer(compatibleHandler(compatibleBodies));
  ollama = await startServer(async (req, res) => {
    const body = await readBody(req);
    res.setHeader("content-type", "application/json");
    ollamaBodies.push({ url: req.url, body });
    res.end(JSON.stringify({ message: { content: "local reply" } }));
  });

  const { llm, vision, tokenLimitBody, openAiProviderDialect, OPENAI_DIALECT, COMPATIBLE_DIALECT } = require("../src/assistant/llm");
  const { OBSERVATION_REQUEST_CONTRACT, OBSERVATION_SCHEMA_NAME, buildObservationSchema } = require("../public/shared-continuity");

  /* ================================================================
     0. the mocks really do reproduce the two upstreams
     ================================================================ */
  const rejected = await fetch(`http://127.0.0.1:${official.port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-under-test", max_tokens: 400, messages: [] }),
  });
  assert.strictEqual(rejected.status, 400, "the official mock must refuse a max_tokens request");
  assert.strictEqual(
    (await rejected.json()).error.message, OFFICIAL_REJECTION,
    "the official mock must refuse it with the message dogfood actually saw",
  );
  const compatRejected = await fetch(`http://127.0.0.1:${compatible.port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "nemotron_3_nano_omni", max_completion_tokens: 400, messages: [] }),
  });
  assert.strictEqual(compatRejected.status, 400, "the generic mock must refuse max_completion_tokens");
  officialBodies.length = 0;
  compatibleBodies.length = 0;

  /* ================================================================
     A. OFFICIAL OPENAI VISION — the reported failure
     ================================================================ */
  writeConfigFile();
  const THREE = ["iVBORpngbytes", "UklGRwebpbytes", "R0lGODgifbytes"];
  const answer = await vision("system", "user", THREE, 900, "openai");
  assert.strictEqual(answer, "official reply", "OpenAI vision must now complete against the current official API");

  let sent = officialBodies.at(-1).body;
  assert.strictEqual(sent.max_completion_tokens, 900, "official OpenAI vision states its budget as max_completion_tokens");
  assert(!("max_tokens" in sent), "official OpenAI vision must not carry the retired max_tokens at all");
  assert.strictEqual(sent.model, "gpt-vision-under-test");

  /* The image payload is untouched by a token-field repair. */
  const parts = imageParts(sent);
  assert.strictEqual(parts.length, 3, "multi-image review still sends every image in one request");
  assert.deepStrictEqual(
    parts.map((part) => part.image_url.url.split(";base64,")[0]),
    ["data:image/png", "data:image/webp", "data:image/gif"],
    "each image keeps its sniffed media type",
  );
  assert.deepStrictEqual(
    parts.map((part) => part.image_url.url.split(";base64,")[1]), THREE,
    "each image keeps its bytes, in order",
  );
  assert.deepStrictEqual(sent.messages.map((m) => m.role), ["system", "user"]);
  assert.strictEqual(sent.messages[1].content[0].type, "text", "the vision message structure is unchanged");
  assert.deepStrictEqual(
    Object.keys(sent).sort(), ["max_completion_tokens", "messages", "model"],
    "an official OpenAI vision request carries the fields it always carried, under the current token name",
  );

  /* A single image goes the same way — the count is not what selects a dialect. */
  await vision("system", "user", ["iVBORonly"], 64, "openai");
  sent = officialBodies.at(-1).body;
  assert.strictEqual(imageParts(sent).length, 1);
  assert.strictEqual(sent.max_completion_tokens, 64);
  assert(!("max_tokens" in sent));

  /* ================================================================
     B. OFFICIAL OPENAI TEXT — the same provider-dialect defect
     ================================================================ */
  assert.strictEqual(await llm("prompt", "system", "user", 40, "openai"), "official reply");
  sent = officialBodies.at(-1).body;
  assert.strictEqual(sent.max_completion_tokens, 40, "official OpenAI text states its budget as max_completion_tokens");
  assert(!("max_tokens" in sent), "official OpenAI text must not carry the retired max_tokens either");
  assert.strictEqual(sent.model, "gpt-under-test");
  assert.deepStrictEqual(sent.messages.map((m) => m.role), ["system", "user"]);

  await llm("prompt", "system", "user", 40, "openai", "", { responseFormat: "json" });
  sent = officialBodies.at(-1).body;
  assert.deepStrictEqual(sent.response_format, { type: "json_object" }, "JSON mode is unaffected by the dialect");
  assert.strictEqual(sent.max_completion_tokens, 40);
  assert(!("max_tokens" in sent));

  /* The official provider still receives none of the custom provider's extras. */
  writeConfigFile({ customTemperature: "0.2", customTopK: "1", customThinking: "disabled" });
  await llm("prompt", "system", "user", 40, "openai");
  sent = officialBodies.at(-1).body;
  for (const field of ["temperature", "top_k", "chat_template_kwargs"])
    assert(!(field in sent), `the OpenAI provider must never receive the custom provider's ${field}`);

  /* ================================================================
     C. GENERIC OPENAI-COMPATIBLE — unchanged, and provably so
     ================================================================ */
  writeConfigFile();
  assert.strictEqual(
    await llm("prompt", "system", "user", 40, "custom"), "compatible reply",
    "the qualified generic server must still accept CineBraid's text request",
  );
  sent = compatibleBodies.at(-1).body;
  assert.strictEqual(sent.max_tokens, 40, "a generic OpenAI-compatible server keeps max_tokens");
  assert(
    !("max_completion_tokens" in sent),
    "the official-only parameter must never leak into a generic OpenAI-compatible request",
  );
  assert.deepStrictEqual(
    Object.keys(sent), ["model", "max_tokens", "messages"],
    "a generic text request is byte-shape identical to what it was",
  );

  await vision("system", "user", THREE, 400, "custom");
  sent = compatibleBodies.at(-1).body;
  assert.deepStrictEqual(
    Object.keys(sent).sort(), ["max_tokens", "messages", "model"],
    "a generic vision request is byte-shape identical to what it was",
  );
  assert.strictEqual(sent.max_tokens, 400);
  assert(!("max_completion_tokens" in sent));
  assert.strictEqual(imageParts(sent).length, 3);

  /* Nemotron's extras still reach it, alongside the field it understands. */
  writeConfigFile({ customTemperature: "0.2", customTopK: "1", customThinking: "disabled" });
  await llm("prompt", "system", "user", 40, "custom");
  sent = compatibleBodies.at(-1).body;
  assert.strictEqual(sent.temperature, 0.2);
  assert.strictEqual(sent.top_k, 1);
  assert.deepStrictEqual(sent.chat_template_kwargs, { enable_thinking: false });
  assert.strictEqual(sent.max_tokens, 40);
  assert(!("max_completion_tokens" in sent));

  /* ================================================================
     D. CONTINUITY — the qualified single-image contract, both ways round
     ================================================================ */
  const manifest = {
    entities: [{
      entity_id: "prop_mug", display_name: "Mug", entity_type: "prop", parent_entity_id: null,
      continuity_unit: "self", identity_cues: "A mug.", allowed_state_values: null,
      track_presence: true, track_movement: true, track_color: true, track_state: false, track_markings: false,
    }],
  };
  const schema = buildObservationSchema(manifest);
  const continuityOptions = (endpoint) => ({
    jsonSchema: schema,
    schemaName: OBSERVATION_SCHEMA_NAME,
    contract: OBSERVATION_REQUEST_CONTRACT,
    ...(endpoint ? { endpoint } : {}),
  });

  /* D1. The Spark runtime: continuity on the custom provider. Frozen. */
  writeConfigFile();
  await vision("system", "user", ["iVBORoneimage"], OBSERVATION_REQUEST_CONTRACT.max_tokens, "custom", "", continuityOptions(null));
  sent = compatibleBodies.at(-1).body;
  assert.deepStrictEqual(
    Object.keys(sent).sort(),
    ["chat_template_kwargs", "max_tokens", "messages", "model", "response_format", "stream", "temperature", "top_k"],
    "the qualified continuity request shape must be exactly what the 51/51 run was measured at",
  );
  assert.strictEqual(sent.max_tokens, 4096);
  assert.strictEqual(sent.temperature, 0.2);
  assert.strictEqual(sent.top_k, 1);
  assert.strictEqual(sent.stream, false);
  assert.deepStrictEqual(sent.chat_template_kwargs, { enable_thinking: false });
  assert.strictEqual(sent.response_format.json_schema.name, "declared_entities_final");
  assert.strictEqual(imageParts(sent).length, 1, "continuity observation sends exactly one image");

  /* D2. A standalone continuity endpoint chosen under the "openai" provider is
         still a server CineBraid was merely pointed at. It keeps the generic
         dialect, because the override replaced the whole connection. */
  await vision("system", "user", ["iVBORoneimage"], OBSERVATION_REQUEST_CONTRACT.max_tokens, "openai", "nemotron_3_nano_omni",
    continuityOptions({ baseUrl: `http://127.0.0.1:${compatible.port}/v1`, apiKey: "" }));
  sent = compatibleBodies.at(-1).body;
  assert.strictEqual(
    sent.max_tokens, 4096,
    "an explicit continuity endpoint keeps the qualified generic request shape whichever provider names it",
  );
  assert(!("max_completion_tokens" in sent));
  assert.strictEqual(compatibleBodies.at(-1).authorization, undefined, "a blank endpoint key still sends no credential");

  /* D3. Continuity riding on the OpenAI provider's OWN connection genuinely does
         reach the official API, so it is written in the official dialect. Only
         the token field changes: every other contract parameter is untouched. */
  await vision("system", "user", ["iVBORoneimage"], OBSERVATION_REQUEST_CONTRACT.max_tokens, "openai", "", continuityOptions(null));
  sent = officialBodies.at(-1).body;
  assert.strictEqual(sent.max_completion_tokens, 4096, "the contract's own budget is restated under the official name");
  assert(!("max_tokens" in sent), "the contract's max_tokens must be lifted out, not left beside the new field");
  assert.strictEqual(sent.temperature, 0.2, "the qualified sampling settings are not this repair's business");
  assert.strictEqual(sent.top_k, 1);
  assert.strictEqual(sent.stream, false);
  assert.deepStrictEqual(sent.chat_template_kwargs, { enable_thinking: false });
  assert.strictEqual(sent.response_format.json_schema.strict, true);
  assert.strictEqual(imageParts(sent).length, 1);

  /* ================================================================
     E. EVERY OTHER PROVIDER — no OpenAI serializer field escapes
     ================================================================ */
  const ollamaBefore = ollamaBodies.length;
  await llm("prompt", "system", "user", 40, "ollama");
  await vision("system", "user", THREE, 400, "ollama");
  assert.strictEqual(ollamaBodies.length, ollamaBefore + 2);
  for (const entry of ollamaBodies.slice(ollamaBefore)) {
    for (const field of ["max_tokens", "max_completion_tokens"])
      assert(!(field in entry.body), `Ollama speaks its own dialect and must not be sent ${field}`);
    assert.strictEqual(entry.url, "/api/chat");
    assert.strictEqual(entry.body.options.num_predict, entry.body.messages?.[1]?.images ? 400 : 40);
  }

  /* Anthropic has no configurable address, so its request is read at the one
     place it can be: the fetch it makes. max_tokens is correct for the Messages
     API — it is the OpenAI dialect that moved, not this one. */
  const anthropicRequests = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    anthropicRequests.push({ url: String(url), body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ content: [{ type: "text", text: "claude reply" }] }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  try {
    writeConfigFile({ anthropicKey: "anthropic-key", anthropicModel: "claude-under-test", anthropicVisionModel: "claude-vision-under-test" });
    await llm("prompt", "system", "user", 40, "anthropic");
    await vision("system", "user", THREE, 400, "anthropic");
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.strictEqual(anthropicRequests.length, 2);
  for (const request of anthropicRequests) {
    assert.strictEqual(request.url, "https://api.anthropic.com/v1/messages");
    assert(!("max_completion_tokens" in request.body), "the Anthropic Messages API must not be given an OpenAI-only parameter");
    assert(typeof request.body.max_tokens === "number", "max_tokens is the correct Anthropic field and stays");
  }
  assert.strictEqual(anthropicRequests[0].body.max_tokens, 40);
  assert.strictEqual(anthropicRequests[1].body.max_tokens, 400);

  /* ================================================================
     F. the rule itself, stated once
     ================================================================ */
  assert.deepStrictEqual(tokenLimitBody(OPENAI_DIALECT, 128), { max_completion_tokens: 128 });
  assert.deepStrictEqual(tokenLimitBody(COMPATIBLE_DIALECT, 128), { max_tokens: 128 });
  assert.strictEqual(openAiProviderDialect({}), OPENAI_DIALECT, "the OpenAI provider's own connection is the official API");
  assert.strictEqual(openAiProviderDialect(undefined), OPENAI_DIALECT);
  assert.strictEqual(openAiProviderDialect({ endpoint: null }), OPENAI_DIALECT, "a null override is no override");
  assert.strictEqual(
    openAiProviderDialect({ endpoint: { baseUrl: "http://127.0.0.1:8000/v1" } }), COMPATIBLE_DIALECT,
    "a caller-supplied endpoint is a server CineBraid can make no dialect claim about",
  );
  /* Fail-safe direction: a new caller that says nothing gets the qualified
     generic shape, never the official-only one. */
  assert.strictEqual(
    tokenLimitBody(undefined, 8).max_tokens, 8,
    "an unstated dialect must default to the generic request shape",
  );

  console.log(
    "OpenAI request dialect suite passed: the official provider states its budget as max_completion_tokens and never "
    + "sends max_tokens for text or vision, images and multi-image behaviour are unchanged, every generic "
    + "OpenAI-compatible request keeps its qualified shape, the continuity contract is frozen on its own endpoint, "
    + "and neither Ollama nor Anthropic receives an OpenAI serializer field.",
  );
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  })
  .finally(() => {
    official?.server.close();
    compatible?.server.close();
    ollama?.server.close();
    fs.rmSync(TEMP, { recursive: true, force: true });
  });

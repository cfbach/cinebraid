/* CINEBRAID — AI assistant adapter.
   Normal providers: native Ollama chat, OpenAI API,
   Anthropic Claude API, custom OpenAI-compatible, or disabled. */
const { readConfig, writeConfig } = require("./config");

const TEXT_TIMEOUT_MS = Math.max(1000, Number(process.env.CINEBRAID_AI_TEXT_TIMEOUT_MS) || 180000);
const VISION_TIMEOUT_MS = Math.max(1000, Number(process.env.CINEBRAID_AI_VISION_TIMEOUT_MS) || 240000);
const EMBED_TIMEOUT_MS = Math.max(1000, Number(process.env.CINEBRAID_AI_EMBED_TIMEOUT_MS) || 60000);

async function requestJson(url, options, timeoutMs, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const raw = await response.text();
    let data = {};
    if (raw) {
      try { data = JSON.parse(raw); }
      catch { throw new Error(`${label} returned invalid JSON.`); }
    }
    return { response, data };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function callAnthropic(cfg, system, user, maxTokens, modelOverride) {
  if (!cfg.anthropicKey) throw new Error("No Anthropic API key set.");
  const { response: r, data } = await requestJson("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": cfg.anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: modelOverride || cfg.anthropicModel,
      max_tokens: maxTokens || 8000,
      system,
      messages: [{ role: "user", content: user }],
    }),
  }, TEXT_TIMEOUT_MS, "Anthropic API");
  if (!r.ok)
    throw new Error("Anthropic API: " + (data.error?.message || r.status));
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function assistantMessageText(message) {
  if (!message) return "";
  if (typeof message === "string") return message.trim();
  if (typeof message.content === "string") return message.content.trim();
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => typeof part === "string" ? part : part?.text || part?.content || part?.value || "")
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  for (const key of ["text", "response", "output_text", "final", "answer"]) {
    if (typeof message[key] === "string" && message[key].trim()) return message[key].trim();
  }
  return "";
}

/* Extra body fields for the custom OpenAI-compatible provider.
   "Custom" stays a genuinely generic provider: nothing is sent unless it has been
   configured, because vLLM, LM Studio, llama.cpp and hosted OpenAI-compatible APIs
   do not all accept the same fields. Configuring them is what makes a reasoning
   server such as vLLM-served Nemotron usable — without enable_thinking:false a short
   request spends its whole budget on reasoning and returns empty content. */
function customRequestBody(cfg = {}) {
  const body = {};
  if (cfg.customTemperature !== "" && Number.isFinite(Number(cfg.customTemperature)))
    body.temperature = Number(cfg.customTemperature);
  if (cfg.customTopK !== "" && Number.isFinite(Number(cfg.customTopK)))
    body.top_k = Math.round(Number(cfg.customTopK));
  if (cfg.customThinking === "disabled")
    body.chat_template_kwargs = { enable_thinking: false };
  return body;
}

/* Which Chat Completions dialect a request is written in.

   "OpenAI-compatible" describes a wire format, not a promise that every server
   implements every parameter the official API currently accepts. The official
   API has retired max_tokens on its current model families and rejects the whole
   request — "Unsupported parameter: 'max_tokens' is not supported with this
   model. Use 'max_completion_tokens' instead." — while the servers the Custom
   provider exists for (vLLM, LM Studio, llama.cpp, hosted OpenAI-compatible
   APIs) are the ones that still take max_tokens, and CineBraid cannot know
   which of them has ever heard of the newer name. So the two are serialized
   differently, and the generic shape is the DEFAULT: a caller that says nothing
   gets the request shape that is already qualified against a real server. */
const OPENAI_DIALECT = "openai";
const COMPATIBLE_DIALECT = "compatible";
/* A caller-supplied endpoint replaces the provider's whole connection — see
   resolveProviderConnection below — and a service CineBraid was merely pointed
   at is one it can make no dialect claim about. Both questions read the override
   through this, so they can never disagree about whether there is one. */
function hasEndpointOverride(requestOptions) {
  return !!(requestOptions && typeof requestOptions.endpoint === "object" && requestOptions.endpoint);
}
function openAiProviderDialect(requestOptions) {
  return hasEndpointOverride(requestOptions) ? COMPATIBLE_DIALECT : OPENAI_DIALECT;
}
/* The completion-token budget, under the name the receiving service knows.
   Exactly one of the two field names is ever sent: the official API rejects a
   request for carrying max_tokens at all, so offering both is not a fallback. */
function tokenLimitBody(dialect, tokens) {
  return dialect === OPENAI_DIALECT
    ? { max_completion_tokens: tokens }
    : { max_tokens: tokens };
}
/* A qualified contract is spread into the body whole, so on the official dialect
   its own max_tokens has to be lifted out rather than left behind — the budget
   is re-stated under the correct name immediately afterwards. Every other
   contract parameter is untouched: this repair is about one field's name. */
function contractBody(contract, dialect) {
  if (dialect !== OPENAI_DIALECT) return contract;
  const { max_tokens, ...rest } = contract;
  return rest;
}

async function callOpenAICompatible(
  baseUrl,
  key,
  model,
  system,
  user,
  maxTokens,
  label = "OpenAI-compatible",
  requestOptions = {},
  extraBody = {},
  dialect = COMPATIBLE_DIALECT,
) {
  if (!baseUrl) throw new Error(label + " base URL is not set.");
  if (!model) throw new Error(label + " model is not set.");
  const headers = { "content-type": "application/json" };
  if (key) headers.authorization = "Bearer " + key;
  const { response: r, data } = await requestJson(baseUrl.replace(/\/$/, "") + "/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      // Configured extras first: the request CineBraid actually needs always wins.
      ...extraBody,
      model,
      ...tokenLimitBody(dialect, maxTokens || 8000),
      ...(requestOptions.responseFormat === "json" ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  }, TEXT_TIMEOUT_MS, label);
  if (!r.ok)
    throw new Error(
      label + ": " + (data.error?.message || data.message || r.status),
    );
  const message = data.choices?.[0]?.message;
  const text = assistantMessageText(message);
  if (text) return text;
  const reasoning = String(message?.reasoning_content || message?.reasoning || "").trim();
  if (reasoning) throw new Error(`${label} returned reasoning but no final answer.`);
  return "";
}

async function callOllamaText(cfg, model, system, user, maxTokens, requestOptions = {}) {
  const baseUrl = cfg.ollamaUrl.replace(/\/$/, "");
  const payload = {
    model,
    stream: false,
    think: false,
    options: { num_predict: maxTokens || 8000 },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (requestOptions.responseFormat === "json") payload.format = "json";
  const { response: r, data } = await requestJson(baseUrl + "/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }, TEXT_TIMEOUT_MS, "Local AI");
  if (!r.ok) throw new Error("Local AI: " + (data.error || data.message || r.status));
  const text = assistantMessageText(data.message) || assistantMessageText(data);
  if (text) return text;

  // Some newer Qwen/Ollama combinations acknowledge chat but leave message.content empty.
  // Retry once through Ollama's generate endpoint before treating the connection as failed.
  const fallbackPayload = {
    model,
    stream: false,
    think: false,
    options: { num_predict: maxTokens || 8000 },
    prompt: `${system}\n\n${user}`,
  };
  if (requestOptions.responseFormat === "json") fallbackPayload.format = "json";
  const { response: generateResponse, data: generateData } = await requestJson(baseUrl + "/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(fallbackPayload),
  }, TEXT_TIMEOUT_MS, "Local AI fallback");
  if (!generateResponse.ok) throw new Error("Local AI fallback: " + (generateData.error || generateData.message || generateResponse.status));
  const fallbackText = assistantMessageText(generateData);
  if (fallbackText) return fallbackText;

  const thinking = String(data.message?.thinking || data.message?.reasoning || generateData.thinking || generateData.reasoning || "").trim();
  if (thinking) throw new Error("Local AI returned reasoning but no final answer after both Ollama chat and generate attempts. Try the exact model name shown by `ollama list` or switch the text model to a standard instruct model.");
  return "";
}
/* Whether a provider endpoint is genuinely on this machine.
   The local-only project policy is answered with this, so it fails closed: a URL that
   cannot be parsed, or that names anything this process cannot prove is loopback, is
   not local. A private LAN address is somebody else's computer. */
function isLoopbackIpv4(host) {
  const octets = host.split(".");
  if (octets.length !== 4) return false;
  if (!octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return false;
  return octets[0] === "127";
}
function isLocalProviderEndpoint(baseUrl) {
  let host = "";
  try {
    host = new URL(String(baseUrl || "").trim()).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  host = host.replace(/\.$/, "");
  if (!host) return false;
  // localhost and anything under it are reserved for the loopback interface (RFC 6761).
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.includes(":")) {
    // The URL parser has already collapsed the address, so ::1 is the only spelling left.
    if (host === "::1") return true;
    const mapped = /^::ffff:(.+)$/.exec(host);
    if (!mapped) return false;
    if (mapped[1].includes(".")) return isLoopbackIpv4(mapped[1]);
    // An IPv4-mapped address the parser rewrote to hex: ::ffff:7f00:1 is 127.0.0.1.
    const groups = mapped[1].split(":");
    if (groups.length !== 2 || !groups.every((group) => /^[0-9a-f]{1,4}$/.test(group)))
      return false;
    return parseInt(groups[0], 16) >> 8 === 127;
  }
  return isLoopbackIpv4(host);
}

function providerForTask(cfg, task, override) {
  if (override) return override;
  const routed = cfg.routing?.[task];
  if (routed && routed !== "assistant") return routed;
  return cfg.assistant?.provider || "ollama";
}
async function llm(
  task,
  system,
  user,
  maxTokens,
  providerOverride,
  modelOverride,
  requestOptions = {},
) {
  const cfg = readConfig();
  const provider = providerForTask(cfg, task, providerOverride);
  if (provider === "none") throw new Error("AI assistance is disabled.");
  if (provider === "anthropic")
    return callAnthropic(cfg, system, user, maxTokens, modelOverride);
  if (provider === "openai") {
    if (!cfg.openaiKey) throw new Error("No OpenAI API key set.");
    return callOpenAICompatible(
      cfg.openaiBaseUrl,
      cfg.openaiKey,
      modelOverride || cfg.openaiModel,
      system,
      user,
      maxTokens,
      "OpenAI API",
      requestOptions,
      {},
      /* Text has no endpoint override: this is always the official connection. */
      OPENAI_DIALECT,
    );
  }
  if (provider === "custom")
    return callOpenAICompatible(
      cfg.customBaseUrl,
      cfg.customKey,
      modelOverride || cfg.customModel,
      system,
      user,
      maxTokens,
      "Custom AI server",
      requestOptions,
      customRequestBody(cfg),
    );
  return callOllamaText(
    cfg,
    modelOverride || cfg.ollamaModel,
    system,
    user,
    maxTokens,
    requestOptions,
  );
}

function mimeForB64(x) {
  const s = String(x || "");
  if (s.startsWith("iVBOR")) return "image/png";
  if (s.startsWith("UklGR")) return "image/webp";
  if (s.startsWith("R0lGOD")) return "image/gif";
  return "image/jpeg";
}

async function callOllamaVision(
  cfg,
  system,
  user,
  imagesB64,
  maxTokens,
  modelOverride,
) {
  const { response: r, data } = await requestJson(cfg.ollamaUrl.replace(/\/$/, "") + "/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: modelOverride || cfg.ollamaVisionModel || cfg.ollamaModel,
      stream: false,
      options: { num_predict: maxTokens || 3000 },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user, images: imagesB64 },
      ],
    }),
  }, VISION_TIMEOUT_MS, "Local vision");
  if (!r.ok) throw new Error("Local vision: " + (data.error || r.status));
  return data.message?.content || "";
}
/* Strict structured output for an OpenAI-compatible vision request.

   Only ever added when a caller asks for it. The generic multi-image review
   path passes no request options and its body is unchanged. */
function structuredVisionBody(requestOptions = {}) {
  const schema = requestOptions.jsonSchema;
  if (!schema) return {};
  return {
    response_format: {
      type: "json_schema",
      json_schema: {
        name: String(requestOptions.schemaName || "structured_output"),
        strict: true,
        schema,
      },
    },
  };
}
async function callOpenAIVision(
  baseUrl,
  key,
  model,
  system,
  user,
  imagesB64,
  maxTokens,
  label,
  extraBody = {},
  requestOptions = {},
  dialect = COMPATIBLE_DIALECT,
) {
  if (!model) throw new Error(label + " vision model is not set.");
  const headers = { "content-type": "application/json" };
  if (key) headers.authorization = "Bearer " + key;
  const content = [
    { type: "text", text: user },
    ...imagesB64.map((x) => ({
      type: "image_url",
      image_url: { url: "data:" + mimeForB64(x) + ";base64," + x },
    })),
  ];
  /* Contract parameters are applied AFTER the configured generic options, so a
     caller whose request was qualified at specific sampling settings keeps them
     even when the user has set different general assistant preferences. */
  const contract = requestOptions.contract && typeof requestOptions.contract === "object" ? requestOptions.contract : {};
  const { response: r, data } = await requestJson(baseUrl.replace(/\/$/, "") + "/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...extraBody,
      ...contractBody(contract, dialect),
      model,
      ...tokenLimitBody(dialect, contract.max_tokens || maxTokens || 4000),
      ...structuredVisionBody(requestOptions),
      messages: [
        { role: "system", content: system },
        { role: "user", content },
      ],
    }),
  }, VISION_TIMEOUT_MS, label);
  if (!r.ok)
    throw new Error(
      label + ": " + (data.error?.message || data.message || r.status),
    );
  const message = data.choices?.[0]?.message;
  const text = message?.content || "";
  if (text) return text;
  /* Same failure the text path already guards: a reasoning server that spends
     its whole budget thinking returns an empty answer, which must never be
     mistaken for a valid structured observation. */
  const reasoning = String(message?.reasoning_content || message?.reasoning || "").trim();
  if (reasoning) throw new Error(`${label} returned reasoning but no final answer. Disable thinking for this provider, or raise its token budget.`);
  return "";
}
async function callAnthropicVision(cfg, system, user, imagesB64, maxTokens) {
  if (!cfg.anthropicKey) throw new Error("No Anthropic API key set.");
  const content = [
    ...imagesB64.map((x) => ({
      type: "image",
      source: { type: "base64", media_type: mimeForB64(x), data: x },
    })),
    { type: "text", text: user },
  ];
  const { response: r, data } = await requestJson("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": cfg.anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.anthropicVisionModel || cfg.anthropicModel,
      max_tokens: maxTokens || 4000,
      system,
      messages: [{ role: "user", content }],
    }),
  }, VISION_TIMEOUT_MS, "Anthropic vision");
  if (!r.ok)
    throw new Error("Anthropic vision: " + (data.error?.message || r.status));
  return (data.content || [])
    .filter((x) => x.type === "text")
    .map((x) => x.text)
    .join("\n");
}
/* Where an OpenAI-compatible request is actually sent, and with which credential.

   A caller may hand over an explicit endpoint — today only continuity, which can
   be pointed at a service of its own. That override replaces the provider's whole
   CONNECTION, not merely its address, because a credential belongs to the endpoint
   it was issued for. So a blank key on an explicit endpoint means NO credential;
   inheriting the general provider's key would transmit it to a host it was never
   configured for. Absent an override — every other caller — the provider's own
   connection is used and the request is byte-for-byte what it was.

   Both OpenAI-compatible branches resolve through here so a second explicit
   endpoint cannot reintroduce the same defect by copying one branch and not the
   other. */
function resolveProviderConnection(requestOptions, providerBaseUrl, providerKey) {
  const endpoint = hasEndpointOverride(requestOptions) ? requestOptions.endpoint : null;
  if (!endpoint) return { baseUrl: providerBaseUrl, apiKey: providerKey };
  return { baseUrl: endpoint.baseUrl || providerBaseUrl, apiKey: endpoint.apiKey || "" };
}
/* Which provider and model a vision request will actually be served by.

   Extracted so a caller that needs to RECORD what served it — candidate review
   records the reviewer alongside its verdict — resolves through the same code
   that dispatches, rather than re-reading Settings later and reporting whatever
   they say by then. vision() below is its only other caller, so the two cannot
   answer differently. Pure: reads configuration, sends nothing. */
function resolveVisionTarget(providerOverride, modelOverride, cfg = readConfig()) {
  let provider = providerOverride || cfg.assistant?.visionProvider || "same";
  if (provider === "same") provider = cfg.assistant?.provider || "ollama";
  const model = provider === "anthropic"
    ? modelOverride || cfg.anthropicVisionModel
    : provider === "openai"
      ? modelOverride || cfg.openaiVisionModel || cfg.openaiModel
      : provider === "custom"
        ? modelOverride || cfg.customVisionModel || cfg.customModel
        : modelOverride || cfg.ollamaVisionModel || cfg.ollamaModel;
  return { provider: String(provider || ""), model: String(model || "") };
}
async function vision(
  system,
  user,
  imagesB64,
  maxTokens,
  providerOverride,
  modelOverride,
  requestOptions = {},
) {
  const cfg = readConfig();
  const { provider } = resolveVisionTarget(providerOverride, modelOverride, cfg);
  if (provider === "none") throw new Error("Vision assistance is disabled.");
  /* Strict structured output is an OpenAI-compatible feature. Failing here is
     better than silently sending an unconstrained request and trying to parse
     whatever prose comes back. */
  if (requestOptions.jsonSchema && !["openai", "custom"].includes(provider))
    throw new Error(`The ${provider} vision provider cannot return strict structured output. Point continuity observation at an OpenAI-compatible server.`);
  if (provider === "anthropic")
    return callAnthropicVision(
      {
        ...cfg,
        anthropicVisionModel: modelOverride || cfg.anthropicVisionModel,
      },
      system,
      user,
      imagesB64,
      maxTokens,
    );
  if (provider === "openai") {
    const connection = resolveProviderConnection(requestOptions, cfg.openaiBaseUrl, cfg.openaiKey);
    return callOpenAIVision(
      connection.baseUrl,
      connection.apiKey,
      modelOverride || cfg.openaiVisionModel || cfg.openaiModel,
      system,
      user,
      imagesB64,
      maxTokens,
      "OpenAI vision",
      {},
      requestOptions,
      openAiProviderDialect(requestOptions),
    );
  }
  if (provider === "custom") {
    const connection = resolveProviderConnection(requestOptions, cfg.customBaseUrl, cfg.customKey);
    return callOpenAIVision(
      connection.baseUrl,
      connection.apiKey,
      modelOverride || cfg.customVisionModel || cfg.customModel,
      system,
      user,
      imagesB64,
      maxTokens,
      "Custom vision",
      customRequestBody(cfg),
      requestOptions,
    );
  }
  return callOllamaVision(
    cfg,
    system,
    user,
    imagesB64,
    maxTokens,
    modelOverride,
  );
}

async function embed(texts, modelOverride) {
  const cfg = readConfig();
  const { response: r, data } = await requestJson(cfg.ollamaUrl.replace(/\/$/, "") + "/api/embed", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: modelOverride || cfg.ollamaEmbedModel,
      input: texts,
    }),
  }, EMBED_TIMEOUT_MS, "Local embeddings");
  if (!r.ok) throw new Error("Local embeddings: " + (data.error || r.status));
  return data.embeddings;
}
module.exports = {
  llm,
  embed,
  vision,
  customRequestBody,
  structuredVisionBody,
  isLocalProviderEndpoint,
  resolveVisionTarget,
  resolveProviderConnection,
  openAiProviderDialect,
  tokenLimitBody,
  OPENAI_DIALECT,
  COMPATIBLE_DIALECT,
  readConfig,
  writeConfig,
};

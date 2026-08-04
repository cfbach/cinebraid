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

async function callOpenAICompatible(
  baseUrl,
  key,
  model,
  system,
  user,
  maxTokens,
  label = "OpenAI-compatible",
  requestOptions = {},
) {
  if (!baseUrl) throw new Error(label + " base URL is not set.");
  if (!model) throw new Error(label + " model is not set.");
  const headers = { "content-type": "application/json" };
  if (key) headers.authorization = "Bearer " + key;
  const { response: r, data } = await requestJson(baseUrl.replace(/\/$/, "") + "/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      max_tokens: maxTokens || 8000,
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
async function callOpenAIVision(
  baseUrl,
  key,
  model,
  system,
  user,
  imagesB64,
  maxTokens,
  label,
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
  const { response: r, data } = await requestJson(baseUrl.replace(/\/$/, "") + "/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      max_tokens: maxTokens || 4000,
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
  return data.choices?.[0]?.message?.content || "";
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
async function vision(
  system,
  user,
  imagesB64,
  maxTokens,
  providerOverride,
  modelOverride,
) {
  const cfg = readConfig();
  let provider = providerOverride || cfg.assistant?.visionProvider || "same";
  if (provider === "same") provider = cfg.assistant?.provider || "ollama";
  if (provider === "none") throw new Error("Vision assistance is disabled.");
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
  if (provider === "openai")
    return callOpenAIVision(
      cfg.openaiBaseUrl,
      cfg.openaiKey,
      modelOverride || cfg.openaiVisionModel || cfg.openaiModel,
      system,
      user,
      imagesB64,
      maxTokens,
      "OpenAI vision",
    );
  if (provider === "custom")
    return callOpenAIVision(
      cfg.customBaseUrl,
      cfg.customKey,
      modelOverride || cfg.customVisionModel || cfg.customModel,
      system,
      user,
      imagesB64,
      maxTokens,
      "Custom vision",
    );
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
module.exports = { llm, embed, vision, readConfig, writeConfig };

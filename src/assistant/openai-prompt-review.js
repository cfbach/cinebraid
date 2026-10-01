/* Braidy's exact-target prompt review uses the official OpenAI connection already
 * owned by Settings. This module never reads project data or config on its own:
 * the caller must supply a reviewed compilation context and the server-held key.
 * The model returns advisory wording only. Authority, staleness, bindings and
 * request fingerprinting remain with CineBraid's generation routes. */
const OPENAI_API_BASE = "https://api.openai.com/v1";
const MODEL_TIMEOUT_MS = 12000;
const REVIEW_TIMEOUT_MS = 90000;
const MAX_CONTEXT_CHARS = 60000;
const MAX_PROMPT_CHARS = 12000;
const MAX_OUTPUT_TOKENS = 5000;

const PROMPT_REVIEW_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["proposedPrompt", "materialChanges", "warnings", "unsupportedOrAmbiguous", "reasoningSummary"],
  properties: {
    proposedPrompt: { type: "string" },
    materialChanges: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
    unsupportedOrAmbiguous: { type: "array", items: { type: "string" } },
    reasoningSummary: { type: "string" },
  },
});

class OpenAIPromptReviewError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "OpenAIPromptReviewError";
    this.code = code;
  }
}

function storedKey(apiKey) {
  const key = String(apiKey || "").trim();
  if (!key) throw new OpenAIPromptReviewError("OpenAI is not configured in Settings.", "OPENAI_NOT_CONFIGURED");
  return key;
}

function selectedModel(model) {
  const id = String(model || "").trim();
  if (!id || id.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._:/+-]*$/.test(id))
    throw new OpenAIPromptReviewError("Choose an exact OpenAI model in Settings.", "OPENAI_MODEL_REQUIRED");
  return id;
}

async function requestOpenAI(path, { apiKey, method = "GET", body, timeoutMs, fetchImpl = fetch, signal }) {
  const key = storedKey(apiKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const cancelled = () => controller.abort();
  if (signal?.aborted) cancelled();
  else signal?.addEventListener("abort", cancelled, { once: true });
  let response;
  try {
    response = await fetchImpl(OPENAI_API_BASE + path, {
      method,
      headers: {
        authorization: "Bearer " + key,
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: "no-store",
      signal: controller.signal,
    });
    /* Do not forward provider error bodies. They can echo request material, and a
     * browser needs a failure class rather than the provider's raw diagnostic. */
    if (!response.ok) {
      throw new OpenAIPromptReviewError(
        "OpenAI rejected the request (HTTP " + (Number(response.status) || "error") + ").",
        "OPENAI_HTTP_ERROR",
      );
    }
    return await response.json();
  } catch (error) {
    if (error instanceof OpenAIPromptReviewError) throw error;
    if (error?.name === "AbortError")
      throw new OpenAIPromptReviewError(signal?.aborted ? "The Braidy review was cancelled." : "OpenAI did not respond before the timeout.", signal?.aborted ? "OPENAI_CANCELLED" : "OPENAI_TIMEOUT");
    throw new OpenAIPromptReviewError(
      response ? "OpenAI returned an invalid response." : "OpenAI could not be reached.",
      response ? "OPENAI_INVALID_RESPONSE" : "OPENAI_UNREACHABLE",
    );
  } finally {
    /* Covers both response headers and body: an endpoint that never completes
       JSON cannot leave a Braidy review pending indefinitely. */
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancelled);
  }
}
async function listOpenAIModels({ apiKey, fetchImpl } = {}) {
  if (!String(apiKey || "").trim()) return { configured: false, connected: false, models: [] };
  const data = await requestOpenAI("/models", { apiKey, timeoutMs: MODEL_TIMEOUT_MS, fetchImpl });
  if (!Array.isArray(data?.data))
    throw new OpenAIPromptReviewError("OpenAI returned an invalid model inventory.", "OPENAI_INVALID_INVENTORY");
  const models = [...new Set(data.data.map((row) => String(row?.id || "").trim())
    .filter((id) => id.length <= 160 && /^[A-Za-z0-9][A-Za-z0-9._:/+-]*$/.test(id)))].sort();
  /* The inventory says what this credential can see. It does not assert that a
   * listed model supports Responses, structured output, or Braidy's task. */
  return { configured: true, connected: true, models };
}

function responseText(data) {
  if (data?.status && data.status !== "completed")
    throw new OpenAIPromptReviewError("OpenAI did not complete the prompt review.", "OPENAI_INCOMPLETE");
  const parts = (Array.isArray(data?.output) ? data.output : [])
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .filter((part) => part?.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text);
  if (parts.length !== 1 || !parts[0].trim())
    throw new OpenAIPromptReviewError("OpenAI returned no single structured proposal.", "OPENAI_NO_PROPOSAL");
  return parts[0];
}

function boundedStrings(value, field) {
  if (!Array.isArray(value) || value.length > 16 || value.some((row) => typeof row !== "string" || row.length > 600))
    throw new OpenAIPromptReviewError(`OpenAI returned an invalid ${field} list.`, "OPENAI_INVALID_PROPOSAL");
  return value.map((row) => row.trim()).filter(Boolean);
}

function validatedProposal(text) {
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new OpenAIPromptReviewError("OpenAI returned invalid structured proposal JSON.", "OPENAI_INVALID_PROPOSAL"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
      || Object.keys(parsed).some((key) => !Object.hasOwn(PROMPT_REVIEW_SCHEMA.properties, key)))
    throw new OpenAIPromptReviewError("OpenAI returned an invalid proposal shape.", "OPENAI_INVALID_PROPOSAL");
  const proposedPrompt = typeof parsed.proposedPrompt === "string" ? parsed.proposedPrompt.trim() : "";
  if (!proposedPrompt || proposedPrompt.length > MAX_PROMPT_CHARS
      || typeof parsed.reasoningSummary !== "string" || parsed.reasoningSummary.length > 1800)
    throw new OpenAIPromptReviewError("OpenAI returned an invalid prompt or explanation.", "OPENAI_INVALID_PROPOSAL");
  return {
    proposedPrompt,
    materialChanges: boundedStrings(parsed.materialChanges, "material changes"),
    warnings: boundedStrings(parsed.warnings, "warnings"),
    unsupportedOrAmbiguous: boundedStrings(parsed.unsupportedOrAmbiguous, "unsupported or ambiguous intent"),
    reasoningSummary: parsed.reasoningSummary.trim(),
  };
}

async function reviewPromptWithOpenAI({ apiKey, model, context, fetchImpl, signal } = {}) {
  const selected = selectedModel(model);
  if (!context || typeof context !== "object" || Array.isArray(context))
    throw new OpenAIPromptReviewError("The exact target compilation is missing.", "OPENAI_CONTEXT_REQUIRED");
  const serialized = JSON.stringify(context);
  if (!serialized || serialized.length > MAX_CONTEXT_CHARS)
    throw new OpenAIPromptReviewError("The target compilation is too large for bounded review.", "OPENAI_CONTEXT_TOO_LARGE");
  const data = await requestOpenAI("/responses", {
    apiKey, timeoutMs: REVIEW_TIMEOUT_MS, fetchImpl, signal,
    method: "POST",
    body: {
      model: selected,
      store: false,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      reasoning: { effort: "low" },
      instructions: "You are Braidy, an advisory prompt reviewer for an exact filmmaking generation target. Improve the currentSubmittedTargetPrompt for this exact target; deterministicCompiledPrompt is a comparison baseline, not a second candidate to send. Preserve all meaningful filmmaker intent and the supplied bound-input roles, order, constraints, and unsupported warnings. Bound input status is not approval authority. Do not invent approvals, reference identities, settings, capabilities, project mutations, or a provider request. If an intent item is ambiguous or unsupported, report it instead of guessing. Return only the requested structured proposal. Your explanation must be concise.",
      input: serialized,
      text: {
        format: {
          type: "json_schema",
          name: "braidy_prompt_improvement_v1",
          strict: true,
          schema: PROMPT_REVIEW_SCHEMA,
        },
      },
    },
  });
  return {
    ...validatedProposal(responseText(data)),
    model: selected,
    responseId: typeof data?.id === "string" ? data.id : "",
    usage: {
      inputTokens: Number.isFinite(data?.usage?.input_tokens) ? data.usage.input_tokens : null,
      outputTokens: Number.isFinite(data?.usage?.output_tokens) ? data.usage.output_tokens : null,
    },
  };
}

/* Existing Braidy Q&A and its explicit connection test can use Responses without
 * changing unrelated OpenAI-compatible, vision or continuity transports. This
 * answer is advisory text; structured output is mandatory only for improvement. */
async function respondTextWithOpenAI({ apiKey, model, system, user, maxOutputTokens = 5000, fetchImpl } = {}) {
  const selected = selectedModel(model);
  const instructions = String(system || "").trim();
  const input = String(user || "").trim();
  if (!instructions || !input || instructions.length > 12000 || input.length > 150000)
    throw new OpenAIPromptReviewError("The Braidy question is empty or too large.", "OPENAI_CONTEXT_REQUIRED");
  const budget = Math.max(32, Math.min(5000, Number(maxOutputTokens) || 5000));
  const data = await requestOpenAI("/responses", {
    apiKey, timeoutMs: REVIEW_TIMEOUT_MS, fetchImpl, method: "POST",
    body: { model: selected, store: false, max_output_tokens: budget, instructions, input },
  });
  if (data?.status && data.status !== "completed")
    throw new OpenAIPromptReviewError("OpenAI did not complete Braidy's answer.", "OPENAI_INCOMPLETE");
  const text = (Array.isArray(data?.output) ? data.output : [])
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .filter((part) => part?.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text).join("\n").trim();
  if (!text) throw new OpenAIPromptReviewError("OpenAI returned no final answer.", "OPENAI_NO_ANSWER");
  return text;
}
module.exports = { listOpenAIModels, reviewPromptWithOpenAI, respondTextWithOpenAI, OpenAIPromptReviewError };

const assert = require("assert");
const { disposableRoot } = require("./helpers/disposable-root");
const workspace = disposableRoot("openai-prompt-review");
process.env.CINEBRAID_CONFIG_PATH = workspace.configPath;
process.env.CINEBRAID_PROJECTS_ROOT = workspace.projectsRoot;

const { DEFAULT_CONFIG, normalizeConfig, maskSecrets, writeConfig } = require("../src/server/config");
const { listOpenAIModels, reviewPromptWithOpenAI } = require("../src/assistant/openai-prompt-review");
const { llm } = require("../src/assistant/llm");
const KEY = "sk-test-secret-MUST-NEVER-LEAK";
const proposal = {
  proposedPrompt: "The approved opening frame holds the parcel and bench. One slow camera push-in.",
  materialChanges: ["Removed repeated motion direction."],
  warnings: ["Character presence needs an explicit decision."],
  unsupportedOrAmbiguous: [],
  reasoningSummary: "The wording keeps the supplied action and camera move concise.",
};

function mockResponse(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}
function structured(data = proposal) {
  return { id: "resp-fixture", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(data) }] }], usage: { input_tokens: 120, output_tokens: 85 } };
}
async function rejectsCode(work, code) {
  await assert.rejects(work, (error) => error.code === code && !String(error.message).includes(KEY));
}

async function main() {
  try {
    assert.strictEqual(DEFAULT_CONFIG.openaiBraidyModel, "", "Braidy has no inherited paid-model default");
    assert.strictEqual(normalizeConfig({ openaiModel: "gpt-5.2" }).openaiBraidyModel, "", "legacy text model cannot silently select Braidy's review model");
    assert.strictEqual(normalizeConfig({ openaiBraidyModel: " gpt-5.6-luna " }).openaiBraidyModel, "gpt-5.6-luna");
    assert.strictEqual(maskSecrets({ openaiKey: KEY }).openaiKey.includes(KEY), false, "the existing config registry masks the key");

    let calls = 0;
    const noKey = await listOpenAIModels({ fetchImpl: async () => { calls++; throw new Error("must not call"); } });
    assert.deepStrictEqual(noKey, { configured: false, connected: false, models: [] });
    assert.strictEqual(calls, 0);

    let modelRequest;
    const models = await listOpenAIModels({ apiKey: KEY, fetchImpl: async (url, options) => {
      modelRequest = { url, options };
      return mockResponse({ data: [{ id: "gpt-5.6-sol" }, { id: "gpt-5.6-luna" }, { id: "gpt-5.6-luna" }, { id: "<script>" }] });
    } });
    assert.strictEqual(modelRequest.url, "https://api.openai.com/v1/models");
    assert.strictEqual(modelRequest.options.headers.authorization, `Bearer ${KEY}`);
    assert.strictEqual(modelRequest.options.method, "GET");
    assert.strictEqual(modelRequest.options.body, undefined);
    assert.deepStrictEqual(models, { configured: true, connected: true, models: ["gpt-5.6-luna", "gpt-5.6-sol"] });
    assert.strictEqual(JSON.stringify(models).includes(KEY), false);

    const noLuna = await listOpenAIModels({ apiKey: KEY, fetchImpl: async () => mockResponse({ data: [{ id: "gpt-5.6-sol" }] }) });
    assert.deepStrictEqual(noLuna.models, ["gpt-5.6-sol"], "a missing Luna model is never invented or silently substituted");
    await rejectsCode(() => listOpenAIModels({ apiKey: KEY, fetchImpl: async () => mockResponse({ error: { message: KEY } }, 401) }), "OPENAI_HTTP_ERROR");
    await rejectsCode(() => listOpenAIModels({ apiKey: KEY, fetchImpl: async () => { throw new Error(KEY); } }), "OPENAI_UNREACHABLE");
    await rejectsCode(() => listOpenAIModels({ apiKey: KEY, fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error(KEY); } }) }), "OPENAI_INVALID_RESPONSE");

    let reviewRequest;
    const context = {
      target: { model: "minimax-h3/fl2va", mode: "i2v", endpoint: "minimax/h3/image-to-video" },
      compiledPrompt: "Keep the approved parcel frame stable.",
      orderedApprovedInputs: [{ role: "opening-frame", assetId: "asset-exact" }],
      coverage: { represented: ["camera"], unsupported: [] },
    };
    const result = await reviewPromptWithOpenAI({ apiKey: KEY, model: "gpt-5.6-luna", context, fetchImpl: async (url, options) => {
      reviewRequest = { url, options };
      return mockResponse(structured());
    } });
    assert.strictEqual(reviewRequest.url, "https://api.openai.com/v1/responses");
    assert.strictEqual(reviewRequest.options.headers.authorization, `Bearer ${KEY}`);
    const body = JSON.parse(reviewRequest.options.body);
    assert.strictEqual(body.model, "gpt-5.6-luna");
    assert.strictEqual(body.store, false, "advisory responses must not be stored by the API");
    assert(body.max_output_tokens > 0 && body.max_output_tokens <= 5000, "output budget is bounded for a full target proposal");
    assert.deepStrictEqual(body.reasoning, { effort: "low" }, "bounded task review uses supported low reasoning");
    assert.strictEqual(body.text.format.type, "json_schema");
    assert.strictEqual(body.text.format.strict, true);
    assert.strictEqual(body.text.format.schema.additionalProperties, false);
    assert.deepStrictEqual(body.text.format.schema.required, ["proposedPrompt", "materialChanges", "warnings", "unsupportedOrAmbiguous", "reasoningSummary"]);
    assert.deepStrictEqual(JSON.parse(body.input), context, "the exact caller-owned compilation context is sent without rewritten input identities");
    assert.strictEqual(reviewRequest.options.body.includes(KEY), false, "the API key is a header, never request content");
    assert.strictEqual(result.proposedPrompt, proposal.proposedPrompt);
    assert.strictEqual(result.model, "gpt-5.6-luna");
    assert.strictEqual(result.responseId, "resp-fixture");
    assert.strictEqual(JSON.stringify(result).includes(KEY), false);
    assert(!Object.hasOwn(result, "approval") && !Object.hasOwn(result, "settings"), "model output cannot become an authority decision");

    await rejectsCode(() => reviewPromptWithOpenAI({ apiKey: KEY, model: "", context, fetchImpl: async () => { throw new Error("must not call"); } }), "OPENAI_MODEL_REQUIRED");
    await rejectsCode(() => reviewPromptWithOpenAI({ apiKey: KEY, model: "gpt-5.6-luna", context, fetchImpl: async () => mockResponse(structured({ ...proposal, approval: "yes" })) }), "OPENAI_INVALID_PROPOSAL");
    await rejectsCode(() => reviewPromptWithOpenAI({ apiKey: KEY, model: "gpt-5.6-luna", context, fetchImpl: async () => mockResponse({ status: "incomplete", output: [] }) }), "OPENAI_INCOMPLETE");
    await rejectsCode(() => reviewPromptWithOpenAI({ apiKey: KEY, model: "gpt-5.6-luna", context, fetchImpl: async () => mockResponse({ error: { message: KEY } }, 429) }), "OPENAI_HTTP_ERROR");
    const abort = new AbortController();
    let reachedProvider;
    const reached = new Promise((resolve) => { reachedProvider = resolve; });
    const pending = reviewPromptWithOpenAI({ apiKey: KEY, model: "gpt-5.6-luna", context,
      signal: abort.signal, fetchImpl: (_url, options) => new Promise((_, reject) => {
        options.signal.addEventListener("abort", () => {
          const error = new Error("cancelled");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
        reachedProvider();
      }) });
    await reached;
    abort.abort();
    await rejectsCode(() => pending, "OPENAI_CANCELLED");
    /* The existing assistant abstraction uses Responses only when Braidy opts in.
       Other OpenAI-compatible callers keep their established dialect. */
    writeConfig(normalizeConfig({ openaiKey: KEY, openaiBraidyModel: "gpt-5.6-luna", assistant: { provider: "openai" } }));
    const previousFetch = global.fetch;
    let assistantBody;
    try {
      global.fetch = async (url, options) => {
        assert.strictEqual(url, "https://api.openai.com/v1/responses");
        assistantBody = JSON.parse(options.body);
        return mockResponse({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "CineBraid assistant connected" }] }] });
      };
      const answer = await llm("prompt", "Reply with the connection phrase", "Connection test.", 40, "openai", "gpt-5.6-luna", { transport: "responses" });
      assert.strictEqual(answer, "CineBraid assistant connected");
      assert.strictEqual(assistantBody.store, false);
      assert.strictEqual(assistantBody.model, "gpt-5.6-luna");
      assert.strictEqual(assistantBody.max_output_tokens, 40);
      assert.strictEqual(assistantBody.text, undefined, "ordinary Braidy Q&A does not claim structured improvement output");
    } finally { global.fetch = previousFetch; }    console.log("OpenAI Braidy provider: focused contract checks passed (mocked; no provider request).");
  } finally {
    workspace.cleanup();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

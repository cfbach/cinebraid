const fs = require("fs");
const path = require("path");

const CONFIG_PATH = process.env.CINEBRAID_CONFIG_PATH
  ? path.resolve(process.env.CINEBRAID_CONFIG_PATH)
  : path.join(__dirname, "data", "config.json");
const MASK_PREFIX = "••••";

const DEFAULT_CONFIG = {
  assistant: { provider: "ollama", visionProvider: "same" },
  agents: {
    enabled: true,
    autoIndex: false,
    maxConcurrent: 1,
    models: {
      coordinator: "",
      verifier: "",
      vision: "",
      coder: "",
      embedding: "",
    },
    coordinator: { enabled: true },
    continuity: { enabled: true },
    librarian: { enabled: true },
    reviewer: { enabled: true },
    promptGuardian: { enabled: true },
    system: { enabled: true },
  },
  anthropicKey: "",
  anthropicModel: "claude-sonnet-4-6",
  anthropicVisionModel: "claude-sonnet-4-6",
  openaiKey: "",
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiModel: "gpt-5.2",
  openaiVisionModel: "gpt-5.2",
  customKey: "",
  customBaseUrl: "http://127.0.0.1:8000/v1",
  customModel: "",
  customVisionModel: "",
  /* Optional request settings for the custom OpenAI-compatible provider. Blank means
     "do not send the field", because a custom endpoint may be vLLM, LM Studio,
     llama.cpp or a remote API, and only some of them accept each of these. */
  customTemperature: "",
  customTopK: "",
  customThinking: "auto",
  /* Continuity observation is its own vision consumer. It is deliberately not
     the general vision provider: the qualified single-image path reaches an
     OpenAI-compatible server that accepts one image, while existing
     multi-image review stays wherever it already is. */
  continuity: {
    /* Unset until a provider is explicitly chosen. Defaulting this to "custom"
       would quietly make every existing install a consumer of a custom endpoint
       it never opted into, and CineBraid does not contact an endpoint nothing is
       routed to. */
    visionProvider: "",
    visionModel: "",
    /* Continuity's own connection. Blank means "use the connection the chosen
       provider already has" — customBaseUrl/customKey, or openaiBaseUrl/openaiKey
       — which is what every install written before this field had, so nothing
       needs migrating.

       Set, it stands alone: the intended Spark runtime has the general assistant
       on Ollama and continuity on a separate OpenAI-compatible service, and that
       must not require configuring a generic custom text provider that nothing
       else uses. A key is deliberately NOT inherited alongside an explicit
       baseUrl — a credential belongs to the endpoint it was issued for. */
    baseUrl: "",
    apiKey: "",
  },
  ollamaUrl: "http://127.0.0.1:11434",
  ollamaModel: "qwen3.6:35b-a3b",
  ollamaVisionModel: "qwen3-vl:30b-a3b-instruct",
  ollamaEmbedModel: "qwen3-embedding:4b",
  generation: {
    fal: {
      enabled: false,
      apiKey: "",
      baseUrl: "https://queue.fal.run",
      textModel: "openai/gpt-image-2",
      editModel: "openai/gpt-image-2/edit",
      h3TextModel: "minimax/h3/text-to-video",
      h3ImageModel: "minimax/h3/image-to-video",
      h3ReferenceModel: "minimax/h3/reference-to-video",
      h3Resolution: "2K",
      blockingQuality: "low",
      frameQuality: "high",
      blockingResolution: "1k",
      frameResolution: "1k",
      blockingOutputs: 2,
      frameOutputs: 2,
      maxConcurrent: 1,
      requireConfirmation: true,
      estimatedCostPerImage: 0,
    },
  },
  appearance: {
    accent: "blue",
    surface: "night",
    scale: 100,
    density: "comfortable",
    helpMode: "guided",
    font: "studio",
  },
  workspace: {
    projectRoot: "",
    mediaRoot: "",
    outputRoot: "",
    backupRoot: "",
    fileStrategy: "project/scene/shot",
    syncMode: "manual",
  },
  naming: {
    filenameTemplate: "{project}_{shot}_{slot}_V{version}.{ext}",
    exportTemplate: "{project}_{scene}_{shot}_{stage}_V{version}.{ext}",
    versionPadding: 3,
    collisionBehavior: "increment",
  },
  policy: "suggest",
  routing: {
    extract: "assistant",
    bulk: "assistant",
    draft: "assistant",
    prompt: "assistant",
    critic: "assistant",
    embed: "ollama",
  },
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, patch) {
  const result = { ...base };
  if (!isPlainObject(patch)) return result;

  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(base[key])) {
      result[key] = deepMerge(base[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function isMasked(value) {
  return typeof value === "string" && value.startsWith(MASK_PREFIX);
}

/* An optional numeric setting is either a number inside its range or blank. Anything
   else — an empty box, a stray word, an out-of-range value — normalizes to blank so
   the request layer can simply omit the field. */
function optionalNumber(value, min, max, round = false) {
  if (value === "" || value === null || value === undefined) return "";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "";
  const bounded = Math.min(max, Math.max(min, parsed));
  return round ? Math.round(bounded) : bounded;
}

function normalizeConfig(config, options = {}) {
  const source = isPlainObject(config) ? config : {};
  const legacyFalKey = !isMasked(source.execution?.fal?.apiKey)
    ? String(source.execution?.fal?.apiKey || "")
    : "";
  const merged = deepMerge(DEFAULT_CONFIG, source);
  delete merged.execution;
  merged.generation = deepMerge(DEFAULT_CONFIG.generation, merged.generation || {});
  if (!merged.generation.fal.apiKey && legacyFalKey) merged.generation.fal.apiKey = legacyFalKey;
  merged.generation.fal.enabled = merged.generation.fal.enabled === true;
  merged.generation.fal.blockingOutputs = Math.max(1, Math.min(4, Number(merged.generation.fal.blockingOutputs) || 2));
  merged.generation.fal.frameOutputs = Math.max(1, Math.min(4, Number(merged.generation.fal.frameOutputs) || 2));
  merged.generation.fal.maxConcurrent = Math.max(1, Math.min(2, Number(merged.generation.fal.maxConcurrent) || 1));
  const estimatedCostPerImage = Number(merged.generation.fal.estimatedCostPerImage);
  merged.generation.fal.estimatedCostPerImage = Number.isFinite(estimatedCostPerImage)
    ? Math.max(0, Math.min(100, estimatedCostPerImage))
    : 0;
  merged.generation.fal.blockingQuality = ["low", "medium", "high", "auto"].includes(merged.generation.fal.blockingQuality) ? merged.generation.fal.blockingQuality : "low";
  merged.generation.fal.frameQuality = ["low", "medium", "high", "auto"].includes(merged.generation.fal.frameQuality) ? merged.generation.fal.frameQuality : "high";
  merged.appearance = deepMerge(DEFAULT_CONFIG.appearance, merged.appearance || {});
  merged.appearance.accent = ["blue", "green", "amber", "rust"].includes(merged.appearance.accent) ? merged.appearance.accent : "blue";
  merged.appearance.surface = ["night", "cool", "warm", "light"].includes(merged.appearance.surface) ? merged.appearance.surface : "night";
  merged.appearance.font = ["studio", "system", "editorial"].includes(merged.appearance.font) ? merged.appearance.font : "studio";
  merged.appearance.scale = Math.max(90, Math.min(110, Number(merged.appearance.scale) || 100));
  merged.appearance.density = ["comfortable", "compact"].includes(merged.appearance.density) ? merged.appearance.density : "comfortable";
  merged.appearance.helpMode = ["guided", "minimal"].includes(merged.appearance.helpMode) ? merged.appearance.helpMode : "guided";
  merged.workspace = deepMerge(DEFAULT_CONFIG.workspace, merged.workspace || {});
  merged.naming = deepMerge(DEFAULT_CONFIG.naming, merged.naming || {});
  merged.naming.versionPadding = Math.max(2, Math.min(5, Number(merged.naming.versionPadding) || 3));
  merged.naming.collisionBehavior = ["increment", "keep-original", "ask"].includes(merged.naming.collisionBehavior) ? merged.naming.collisionBehavior : "increment";
  merged.customTemperature = optionalNumber(merged.customTemperature, 0, 2);
  merged.customTopK = optionalNumber(merged.customTopK, 1, 1000, true);
  merged.customThinking = ["auto", "disabled"].includes(merged.customThinking)
    ? merged.customThinking
    : "auto";
  merged.continuity = deepMerge(DEFAULT_CONFIG.continuity, merged.continuity || {});
  merged.continuity.visionProvider = ["custom", "openai"].includes(merged.continuity.visionProvider)
    ? merged.continuity.visionProvider
    : "";
  merged.continuity.visionModel = String(merged.continuity.visionModel || "");
  merged.continuity.baseUrl = String(merged.continuity.baseUrl || "").trim();
  merged.continuity.apiKey = String(merged.continuity.apiKey || "");
  merged.agents.maxConcurrent = Math.max(
    1,
    Math.min(3, Number(merged.agents.maxConcurrent) || 1),
  );
  return merged;
}

function readConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    return normalizeConfig(saved);
  } catch {
    return normalizeConfig(DEFAULT_CONFIG);
  }
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  const normalized = normalizeConfig(config);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(normalized, null, 2));
  return normalized;
}

function mergeConfig(current, patch) {
  return normalizeConfig(deepMerge(current || DEFAULT_CONFIG, patch || {}));
}

function migrateConfigFile() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    // A missing or invalid config is replaced with readable defaults.
  }
  const normalized = normalizeConfig(saved);
  const before = JSON.stringify(saved);
  const after = JSON.stringify(normalized);
  if (before !== after) writeConfig(normalized);
  return normalized;
}

module.exports = {
  CONFIG_PATH,
  DEFAULT_CONFIG,
  MASK_PREFIX,
  deepMerge,
  isMasked,
  mergeConfig,
  migrateConfigFile,
  normalizeConfig,
  readConfig,
  writeConfig,
};

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const CONFIG_PATH = process.env.CINEBRAID_CONFIG_PATH
  ? path.resolve(process.env.CINEBRAID_CONFIG_PATH)
  : path.join(__dirname, "data", "config.json");
const MASK_PREFIX = "••••";

/* The calendar test the motion rate's freshness is validated with. Shared with the
   browser's reader so a date this file accepts is a date that file also accepts. */
const { isCalendarDate } = require("./public/shared-generation-rate");

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
      /* WHAT A SECOND OF RENDERED MOTION IS ESTIMATED TO COST, and the only place
         CineBraid holds that number.
       *
       * It used to live in the browser as a hard-coded $0.26 inside falH3CostEstimate(),
       * which meant the pre-flight quote and the durable record were two authorities
       * reading two different things: the dialog printed a confident figure and
       * generation-cost.js recorded `unknown` for the same job, because the server had
       * no motion rate to read. One configured number ends that — the quote and the
       * record now derive from this field through one shared function.
       *
       * CineBraid ships NO PRICES. 0 is the default and means UNCONFIGURED, which is not
       * free and not zero: an unconfigured rate produces "unavailable" on the screen and
       * `confidence: "unknown"` on the row, and never a $0.00 that would read as a
       * completed purchase of nothing.
       *
       * `source` and `asOf` are the operator's own note about where the number came from
       * and when they read it. CineBraid cannot check a provider's pricing page and does
       * not pretend to, so both are free of any verification claim — and both stay empty
       * unless somebody fills them in. An `asOf` defaulted to today would be a
       * manufactured freshness stamp, which is worse than admitting the date is unknown. */
      motionRate: {
        usdPerSecond: 0,
        source: "",
        asOf: "",
      },
    },
    /* Local ComfyUI. Two settings and a switch, and deliberately nothing else.
     *
     * NO CREDENTIAL, so nothing here belongs in CONFIG_SECRETS. The V1 client speaks
     * only to loopback, where ComfyUI has no authentication, and it sends, stores and
     * logs none. A field is secret because it is declared secret — and declaring a
     * plain server address secret would mask the one value an operator needs to read
     * back when a connection fails.
     *
     * `workflowFolder` is where a filmmaker keeps their own ComfyUI workflows.
     * CineBraid reads that folder and never writes to it. The REGISTRY of which
     * workflows have had their inputs confirmed is data/comfy-workflows.json rather
     * than a key here, because PUT /api/config is a deep merge and a deep merge over a
     * list cannot express a removal — a workflow deleted from the folder would survive
     * every later save. See comfy-registry.js's header. */
    comfy: {
      enabled: false,
      baseUrl: "http://127.0.0.1:8188",
      workflowFolder: "",
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
  /* Account connections — who this CineBraid is at an external provider. Config,
     never project data: a connection outlives every project and belongs to the
     machine, and putting it in project.json would copy a credential into every
     backup, export and sync of that project. Keyed by connectionId throughout, so
     two accounts at one provider are representable from the start. */
  accounts: [],
  /* Non-secret, per-provider settings. An OAuth client_id is public by
     definition — it travels in the authorization URL the user's browser opens —
     so it is deliberately absent from CONFIG_SECRETS. Masking it would only hide
     it from the person who has to paste it in. */
  accountProviders: {
    civitai: { clientId: "" },
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

/* ---------------------------------------------------------------------------
   The config secret registry.

   Which configuration fields are credentials is declared HERE, once. The
   read path (masking on GET /api/config) and the write path (restoring a
   round-tripped placeholder on PUT /api/config) both derive from this list.

   They used to be two hand-maintained enumerations in the route handlers, and
   continuity.apiKey was added without updating either — so it left the server in
   cleartext. A field is secret because it is declared secret, never because a
   handler happened to remember it and never because its name contains "key".

   Three presentation modes, all of which already existed and are preserved:

     masked    the value is replaced by MASK_PREFIX + its last four characters.
               A masked value sent back means "keep what is stored".
     presence  the value is replaced by a set/unset marker. Used for passcodes,
               where even the last four characters are worth withholding.
     omit      the key is removed entirely, and is never accepted from a patch.
               Used for a secret the client has no business seeing or setting.

   `path` is dot-separated. A segment written `name[*]` means "every element of
   that array", and must be followed by at least one further segment; when array
   elements carry a stable id, `identity` names the field to correlate patch
   elements to stored elements by, rather than by position. The account
   credentials below are what that grammar was built for — three declarations
   instead of another pair of hand-written handlers. */
const SECRET_PRESENCE_SET = "(set)";
const SECRET_PRESENCE_UNSET = "";
const CONFIG_SECRETS = [
  { path: "anthropicKey", mode: "masked" },
  { path: "openaiKey", mode: "masked" },
  { path: "customKey", mode: "masked" },
  { path: "continuity.apiKey", mode: "masked" },
  { path: "generation.fal.apiKey", mode: "masked" },
  { path: "editorPass", mode: "presence" },
  { path: "viewerPass", mode: "presence" },
  { path: "authSecret", mode: "omit" },
  /* OAuth tokens are `omit`, not `masked`. The browser never sees one, never sets
     one and has no use for even its last four characters: the whole flow runs
     server-side. `masked` would put a fragment of a live token in a response for
     no reason at all.

     A personal API key is `masked` because it is the one credential a user pastes
     by hand and may reasonably want to confirm is the one they meant. */
  { path: "accounts[*].credential.accessToken", mode: "omit", identity: "connectionId" },
  { path: "accounts[*].credential.refreshToken", mode: "omit", identity: "connectionId" },
  { path: "accounts[*].credential.apiKey", mode: "masked", identity: "connectionId" },
];

function maskSecretValue(value) {
  return value ? MASK_PREFIX + String(value).slice(-4) : "";
}

function parseSecretPath(path) {
  return String(path)
    .split(".")
    .map((segment) => {
      const each = /^(.+)\[\*\]$/.exec(segment);
      return each ? { key: each[1], each: true } : { key: segment, each: false };
    });
}

/* Walks a declared path through a value and its stored counterpart together, so a
   restore can see both the incoming placeholder and the secret it stands for.
   `stored` may be undefined throughout; masking passes nothing for it. Only
   existing objects are descended into — a patch that omits a branch keeps
   omitting it, because creating the branch here would merge empty defaults over
   settings the caller never sent. */
function visitSecretPath(node, stored, segments, index, visit) {
  if (!isPlainObject(node)) return;
  const segment = segments[index];
  const storedNode = isPlainObject(stored) ? stored : null;
  if (segment.each) {
    const items = node[segment.key];
    if (!Array.isArray(items) || index === segments.length - 1) return;
    const storedItems = storedNode && Array.isArray(storedNode[segment.key]) ? storedNode[segment.key] : [];
    const identity = segments[index].identity;
    items.forEach((item, position) => {
      const match = identity && isPlainObject(item)
        ? storedItems.find((candidate) => isPlainObject(candidate) && candidate[identity] === item[identity])
        : storedItems[position];
      visitSecretPath(item, match, segments, index + 1, visit);
    });
    return;
  }
  if (index === segments.length - 1) {
    visit(node, storedNode, segment.key);
    return;
  }
  visitSecretPath(node[segment.key], storedNode ? storedNode[segment.key] : undefined, segments, index + 1, visit);
}

function secretSegments(secret) {
  const segments = parseSecretPath(secret.path);
  if (secret.identity) {
    for (const segment of segments) if (segment.each) segment.identity = secret.identity;
  }
  return segments;
}

/* A copy of the config safe to send to a browser. Never mutates the input. */
function maskSecrets(config, registry = CONFIG_SECRETS) {
  const safe = structuredClone(isPlainObject(config) ? config : {});
  for (const secret of registry) {
    visitSecretPath(safe, undefined, secretSegments(secret), 0, (node, _stored, key) => {
      if (secret.mode === "omit") {
        delete node[key];
        return;
      }
      if (secret.mode === "presence") {
        node[key] = node[key] ? SECRET_PRESENCE_SET : SECRET_PRESENCE_UNSET;
        return;
      }
      node[key] = maskSecretValue(node[key]);
    });
  }
  return safe;
}

/* Replaces placeholders in an incoming patch with the secrets they stand for, so
   a client that round-trips what GET gave it changes nothing. A genuinely new
   value passes through, and so does "" — clearing a secret by sending an empty
   string is existing behaviour and stays. Never mutates the input. */
function restoreSecrets(patch, current, registry = CONFIG_SECRETS) {
  const next = structuredClone(isPlainObject(patch) ? patch : {});
  for (const secret of registry) {
    visitSecretPath(next, current, secretSegments(secret), 0, (node, stored, key) => {
      if (!Object.prototype.hasOwnProperty.call(node, key)) return;
      const storedValue = stored ? stored[key] : undefined;
      if (secret.mode === "omit") {
        delete node[key];
        return;
      }
      if (secret.mode === "presence") {
        /* A non-string was already ignored before this registry existed, and the
           set-marker is a placeholder like any other: storing it would make the
           literal "(set)" the passcode. */
        if (typeof node[key] !== "string" || node[key] === SECRET_PRESENCE_SET) delete node[key];
        return;
      }
      if (isMasked(node[key])) node[key] = storedValue || "";
    });
  }
  return next;
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
  /* The motion rate, normalised on the same terms as the per-image one — bounded, and
     anything that is not a usable number becomes 0, which reads as UNCONFIGURED
     everywhere downstream rather than as a price of zero.

     `asOf` is accepted only as a REAL ISO calendar date. A freshness field that took
     "recently" could not be compared to anything, and one that quietly substituted
     today's date when the operator left it blank would be inventing the verification
     this whole field exists to record honestly. An unparseable date becomes empty and
     renders as "freshness unknown".

     Shape alone is not enough: 2026-99-99 and 2026-02-30 both match YYYY-MM-DD and
     neither is a day that existed. The calendar test lives in the shared rate module and
     is CALLED here rather than copied, for the same reason the arithmetic is — two
     validators are two answers waiting to disagree. */
  merged.generation.fal.motionRate = deepMerge(
    DEFAULT_CONFIG.generation.fal.motionRate,
    isPlainObject(merged.generation.fal.motionRate) ? merged.generation.fal.motionRate : {},
  );
  const motionUsdPerSecond = Number(merged.generation.fal.motionRate.usdPerSecond);
  merged.generation.fal.motionRate.usdPerSecond = Number.isFinite(motionUsdPerSecond)
    ? Math.max(0, Math.min(100, motionUsdPerSecond))
    : 0;
  merged.generation.fal.motionRate.source = String(merged.generation.fal.motionRate.source || "").trim().slice(0, 200);
  const motionAsOf = String(merged.generation.fal.motionRate.asOf || "").trim();
  merged.generation.fal.motionRate.asOf = isCalendarDate(motionAsOf) ? motionAsOf : "";
  merged.generation.fal.blockingQuality = ["low", "medium", "high", "auto"].includes(merged.generation.fal.blockingQuality) ? merged.generation.fal.blockingQuality : "low";
  merged.generation.fal.frameQuality = ["low", "medium", "high", "auto"].includes(merged.generation.fal.frameQuality) ? merged.generation.fal.frameQuality : "high";
  /* Local ComfyUI. Both strings are trimmed and bounded and NEITHER is validated for
     reachability here: normalisation runs at startup and on every save, and a folder on
     an unplugged drive or a server that is not running yet must not be silently erased
     from a person's settings because it could not be reached at that instant. Whether
     the address is one CineBraid may connect to is decided at the moment of connection,
     by comfy-client.js's loopback boundary, where a refusal can name the reason. */
  merged.generation.comfy = deepMerge(
    DEFAULT_CONFIG.generation.comfy,
    isPlainObject(merged.generation.comfy) ? merged.generation.comfy : {},
  );
  merged.generation.comfy.enabled = merged.generation.comfy.enabled === true;
  merged.generation.comfy.baseUrl = String(merged.generation.comfy.baseUrl || "").trim().slice(0, 300)
    || DEFAULT_CONFIG.generation.comfy.baseUrl;
  merged.generation.comfy.workflowFolder = String(merged.generation.comfy.workflowFolder || "").trim().slice(0, 500);
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
  /* Structural only. What a valid connection looks like is account-connections.js's
     question, and answering it here would put provider knowledge in the config
     layer; all this guarantees is that readers get an array to iterate. */
  merged.accounts = Array.isArray(merged.accounts)
    ? merged.accounts.filter((entry) => isPlainObject(entry))
    : [];
  merged.accountProviders = deepMerge(DEFAULT_CONFIG.accountProviders, merged.accountProviders || {});
  merged.accountProviders.civitai.clientId = String(merged.accountProviders.civitai.clientId || "").trim();
  return merged;
}

/* ---------------------------------------------------------------------------
   Durability.

   config.json is the only file in CineBraid that holds credentials — every
   provider key, both passcodes, the cookie signing secret, and since Phase 3 the
   Civitai OAuth tokens and API keys. It was also the only store written with a
   bare writeFileSync and read with `catch { return defaults }`.

   The consequences were not theoretical. A truncated, empty, NUL-padded or
   wrongly-encoded file read as DEFAULTS, and startup then wrote those defaults
   over the remains — so a config whose bytes still physically contained the user's
   keys in cleartext was destroyed rather than recovered. Because DEFAULT_CONFIG
   has no editorPass, an install running --lan with passcodes configured came back
   up with AUTHENTICATION SILENTLY OFF and nothing in the interface said so.

   Every other durable store in this repository already meets the standard this one
   now meets — project.json's atomicWriteJson, automation-runs.js's `.bak` and
   read-side recovery, media-asset-store.js's both-corrupt refusal. The discipline
   is reimplemented here rather than imported, because config.js sits underneath
   all of them and must not depend on any.

   The distinction that drives the whole design:

     MISSING is a valid first-run state -> defaults, and writing them is correct.
     CORRUPT is not missing            -> recover, or refuse. Never invent. */
const CONFIG_BACKUP_PATH = `${CONFIG_PATH}.bak`;
/* The corrupt bytes are kept once, beside the file, so a user who lost a key can
   still see it and a support request has something to look at. Deliberately not a
   growing series: the most recent corruption is the useful one. */
const CONFIG_CORRUPT_PATH = `${CONFIG_PATH}.corrupt`;

class ConfigUnreadableError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = "ConfigUnreadableError";
    this.code = "CONFIG_UNREADABLE";
    this.statusCode = 503;
    this.detail = detail || {};
  }
}

/* A BOM is what PowerShell's Out-File and Notepad leave behind; every other JSON
   reader in this repository tolerates one, and a config the user edited by hand is
   exactly where one shows up. An empty file is treated as corruption rather than as
   an empty document, because a zero-byte config.json is what an interrupted
   truncate leaves and has never been a thing CineBraid writes. */
function parseConfigDocument(target) {
  const raw = String(fs.readFileSync(target, "utf8")).replace(/^﻿/, "");
  if (!raw.trim()) {
    const error = new Error("The file is empty.");
    error.configEmpty = true;
    throw error;
  }
  const parsed = JSON.parse(raw);
  if (!isPlainObject(parsed)) throw new Error("The file is not a configuration document.");
  return parsed;
}

/* Reads the configuration document without normalising it.

   Returns { config, exists, recovered, warning }.

     missing         -> DEFAULT_CONFIG, exists:false. Normal. Not an error.
     primary valid   -> the primary
     primary corrupt -> the backup, recovered:true
     both unusable   -> THROWS ConfigUnreadableError, having written nothing   */
function loadConfigDocument() {
  let primaryError = null;
  try {
    return { config: parseConfigDocument(CONFIG_PATH), exists: true, recovered: false, warning: "" };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { config: DEFAULT_CONFIG, exists: false, recovered: false, warning: "" };
    }
    primaryError = error;
  }

  let recoveredConfig = null;
  let backupError = null;
  try {
    recoveredConfig = parseConfigDocument(CONFIG_BACKUP_PATH);
  } catch (error) {
    backupError = error;
  }

  if (!recoveredConfig) {
    throw new ConfigUnreadableError(
      "CineBraid settings could not be read, and the backup copy could not be read either. "
      + "Nothing has been changed: your settings file is exactly as CineBraid found it, so the "
      + "credentials and passcodes inside it are still there to recover. CineBraid will not start "
      + "with empty settings, because that would switch off any passcode you had set and discard "
      + "every connected account.",
      {
        path: CONFIG_PATH,
        backupPath: CONFIG_BACKUP_PATH,
        primary: String(primaryError?.message || primaryError),
        backup: String(backupError?.message || backupError),
      },
    );
  }

  /* Preserve the evidence before anything is allowed to replace the primary. */
  try {
    if (fs.existsSync(CONFIG_PATH)) fs.copyFileSync(CONFIG_PATH, CONFIG_CORRUPT_PATH);
  } catch { /* evidence is best-effort; recovery is not */ }

  return {
    config: recoveredConfig,
    exists: true,
    recovered: true,
    warning: "CineBraid settings were unreadable and were restored from the backup copy.",
  };
}

function readConfig() {
  return normalizeConfig(loadConfigDocument().config);
}

/* True when the primary parses. Used to decide whether it may become the backup —
   copying a corrupt primary over a good `.bak` would destroy the very copy the
   recovery above just depended on, which is the mistake automation-runs.js makes
   and this one must not. */
function primaryConfigIsReadable() {
  try {
    parseConfigDocument(CONFIG_PATH);
    return true;
  } catch {
    return false;
  }
}

/* Atomic, fsynced, backed up. Same discipline as server.js's atomicWriteJson, which
   is the proven in-repo standard for a file that must survive a crash.

   Writes are synchronous and contain no await, so two callers in this process
   cannot interleave; the temp name additionally carries the pid and random bytes so
   a second PROCESS writing the same file cannot collide either, and the rename is
   the atomic commit. */
function writeConfig(config) {
  const normalized = normalizeConfig(config);
  const payload = JSON.stringify(normalized, null, 2);
  JSON.parse(payload); /* never rename a temp file we cannot read back */

  const dir = path.dirname(CONFIG_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(
    dir,
    `.${path.basename(CONFIG_PATH)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`,
  );

  let fd;
  try {
    fd = fs.openSync(temp, "wx");
    fs.writeFileSync(fd, payload, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    /* Backup BEFORE the primary is replaced, so a crash between the two leaves a
       readable previous configuration rather than nothing — and only when the
       primary is worth keeping. */
    if (fs.existsSync(CONFIG_PATH) && primaryConfigIsReadable()) fs.copyFileSync(CONFIG_PATH, CONFIG_BACKUP_PATH);
    fs.renameSync(temp, CONFIG_PATH);
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    /* A failure before the rename leaves only the temp file; the configuration on
       disk is whatever it was. */
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {}
    throw error;
  }
  return normalized;
}

function mergeConfig(current, patch) {
  return normalizeConfig(deepMerge(current || DEFAULT_CONFIG, patch || {}));
}

/* Startup normalisation.

   This used to be where the damage was committed: it swallowed a parse failure,
   normalised `{}` into DEFAULT_CONFIG, saw that it differed from the corrupt bytes,
   and wrote the defaults over them. It now normalises whatever loadConfigDocument
   was able to establish — the primary, or the backup — and PROPAGATES the
   both-unusable refusal instead of resolving it by invention.

   A missing file still normalises to defaults and is still written: that is a first
   run, and creating the file is the correct thing to do. */
function migrateConfigFile() {
  const loaded = loadConfigDocument();
  const normalized = normalizeConfig(loaded.config);
  const before = JSON.stringify(loaded.config);
  const after = JSON.stringify(normalized);
  /* Three reasons to write, and only these three:
       - a first run, so the file comes into existence (unchanged behaviour);
       - a recovery, so the repaired primary replaces the corrupt one;
       - a normalisation that actually changed something. */
  if (!loaded.exists || loaded.recovered || before !== after) writeConfig(normalized);
  return normalized;
}

/* Whether the configuration can be read at all, for a caller that must answer
   rather than throw — the request boundary in server.js. Never writes. */
function configHealth() {
  try {
    const loaded = loadConfigDocument();
    return { ok: true, exists: loaded.exists, recovered: loaded.recovered, warning: loaded.warning, error: null };
  } catch (error) {
    if (error?.code !== "CONFIG_UNREADABLE") throw error;
    return { ok: false, exists: true, recovered: false, warning: "", error };
  }
}

module.exports = {
  CONFIG_BACKUP_PATH,
  CONFIG_CORRUPT_PATH,
  CONFIG_PATH,
  CONFIG_SECRETS,
  ConfigUnreadableError,
  DEFAULT_CONFIG,
  MASK_PREFIX,
  configHealth,
  loadConfigDocument,
  SECRET_PRESENCE_SET,
  SECRET_PRESENCE_UNSET,
  deepMerge,
  isMasked,
  maskSecretValue,
  maskSecrets,
  mergeConfig,
  migrateConfigFile,
  normalizeConfig,
  readConfig,
  restoreSecrets,
  writeConfig,
};

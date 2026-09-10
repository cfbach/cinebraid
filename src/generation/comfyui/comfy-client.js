/* The ComfyUI adapter. The only file in CineBraid that speaks ComfyUI's HTTP API.
 *
 * FIVE OPERATIONS, because five is what a generation needs:
 *
 *     probe()        is a ComfyUI there, and which one?      GET  /system_stats, /queue
 *     uploadImage()  put an input image where a graph can load it   POST /upload/image
 *     submitPrompt() queue a graph                            POST /prompt
 *     readHistory()  has it finished, and what did it make?   GET  /history/<promptId>
 *     fetchOutput()  the bytes                                GET  /view?...
 *
 * ComfyUI's API is much larger than this — /object_info, /embeddings, /models,
 * /interrupt, /free, a websocket, a whole manager surface. None of it is copied in.
 * A backend that mirrors a provider's API acquires the provider's release cadence as a
 * maintenance obligation; five endpoints is the smallest set that can carry a shot
 * there and bring a picture back.
 *
 * ------------------------------------------------------------------------------
 * WHERE IT IS ALLOWED TO CONNECT — the security boundary, stated once.
 *
 * Every request goes through `assertReachableEndpoint()`, which permits LOOPBACK ONLY,
 * using llm.js's `isLocalProviderEndpoint` — the same predicate CineBraid's existing
 * `local-only` AI policy enforces, so a URL this file accepts is a URL that policy
 * already accepts.
 *
 * A private LAN address is REFUSED in V1, and that is a deliberate, recorded choice
 * rather than an oversight. This repository has no outbound request policy of any kind:
 * no allowlist, no private-range classification, no DNS-rebinding guard. Writing one
 * tonight would be inventing a trust model for the whole product inside a ComfyUI
 * slice. `TRUST_CLASSES` in generation-contracts.js already reserves `lan_approved` for
 * the day that policy is written; until it is, "loopback only" is a boundary that
 * cannot become an SSRF surface, and a refusal that names the reason is more useful
 * than a permission nobody scoped.
 *
 * Consequences held on purpose:
 *   - redirect: "manual". A 302 is reported, never followed. Following one is how a
 *     loopback check gets satisfied and then bypassed.
 *   - AbortController on every call, with a per-operation timeout, so an unresponsive
 *     server is a refusal rather than a hung request.
 *   - Responses are read as TEXT and parsed here, so a server that answers HTML cannot
 *     put a fragment of its error page into a thrown SyntaxError — the discipline
 *     account-provider-civitai.js already applies to Civitai.
 *   - No credentials. ComfyUI has no auth in the configuration V1 supports, so this
 *     file sends none, stores none and logs none. If a deployment puts a proxy in
 *     front of one, that is the LAN story and it arrives with the LAN policy.
 */

const { isLocalProviderEndpoint } = require("../../assistant/llm");

const COMFY_BACKEND_ID = "comfy";
const COMFY_SURFACE_ID = "comfy-local";
const COMFY_DEFAULT_BASE_URL = "http://127.0.0.1:8188";

const TIMEOUTS = {
  probe: 5000,
  upload: 30000,
  submit: 30000,
  history: 15000,
  /* An output can be a large PNG over loopback; generous, but still bounded. */
  output: 120000,
};
/* A ceiling on what will be pulled back into memory before it is written. A ComfyUI on
   loopback is trusted to be the operator's own, but "trusted" is not "unbounded". */
const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;

class ComfyClientError extends Error {
  constructor(code, message, detail = {}, status = 502) {
    super(message);
    this.name = "ComfyClientError";
    this.code = code;
    this.detail = detail;
    this.status = status;
  }
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/* The configured address, normalised. Kept as an ORIGIN — a ComfyUI base URL with a
   path is a misconfiguration rather than a deployment, and accepting one would mean
   every endpoint below has to guess whether to keep it. */
function normalizeBaseUrl(value) {
  const raw = text(value) || COMFY_DEFAULT_BASE_URL;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new ComfyClientError("COMFY_URL_INVALID", `"${raw}" is not a web address CineBraid can use.`, { baseUrl: raw }, 400);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new ComfyClientError("COMFY_URL_INVALID", "A ComfyUI address starts with http:// or https://.", { baseUrl: raw }, 400);
  return url.origin;
}

/* THE BOUNDARY. Called by every operation below, without exception. */
function assertReachableEndpoint(baseUrl) {
  const origin = normalizeBaseUrl(baseUrl);
  if (!isLocalProviderEndpoint(origin))
    throw new ComfyClientError(
      "COMFY_URL_NOT_LOCAL",
      `CineBraid only connects to a ComfyUI running on this machine. ${origin} is somewhere else.`,
      { baseUrl: origin, permitted: "127.0.0.1, localhost, ::1" },
      400,
    );
  return origin;
}

/* What CineBraid may say about where this ran. Derived from the address, never
   declared by a caller — generation-contracts.js refuses `local_native` unless
   orchestration and inference are in the same operator-controlled place, and the only
   place this V1 can reach is this machine. */
function executionFactsFor(baseUrl) {
  assertReachableEndpoint(baseUrl);
  return {
    backendId: COMFY_BACKEND_ID,
    surfaceId: COMFY_SURFACE_ID,
    executionKind: "local_native",
    orchestratorLocation: "same_host",
    inferenceLocation: "same_host",
    trustClass: "loopback",
    costClass: "free_local",
  };
}

async function request(origin, pathname, { method = "GET", headers = {}, body, timeout, expect = "json", label } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let response;
  try {
    response = await fetch(`${origin}${pathname}`, {
      method,
      headers,
      body,
      redirect: "manual",
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = error?.name === "AbortError";
    throw new ComfyClientError(
      aborted ? "COMFY_TIMEOUT" : "COMFY_UNREACHABLE",
      aborted
        ? `ComfyUI did not answer ${label} within ${Math.round(timeout / 1000)} seconds.`
        : `CineBraid could not reach ComfyUI at ${origin}.`,
      { origin, pathname, cause: String(error?.message || error) },
      aborted ? 504 : 502,
    );
  } finally {
    clearTimeout(timer);
  }

  /* A redirect is reported, never followed — see the module header. */
  if (response.status >= 300 && response.status < 400)
    throw new ComfyClientError("COMFY_REDIRECTED", `ComfyUI at ${origin} redirected the request instead of answering it.`, { origin, pathname, status: response.status }, 502);

  if (expect === "bytes") {
    if (!response.ok)
      throw new ComfyClientError("COMFY_HTTP_ERROR", `ComfyUI answered ${response.status} when CineBraid asked for ${label}.`, { origin, pathname, status: response.status }, 502);
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_OUTPUT_BYTES)
      throw new ComfyClientError("COMFY_OUTPUT_TOO_LARGE", `That result is ${Math.round(declared / 1048576)} MB; CineBraid takes delivery of up to ${MAX_OUTPUT_BYTES / 1048576} MB.`, { bytes: declared }, 502);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_OUTPUT_BYTES)
      throw new ComfyClientError("COMFY_OUTPUT_TOO_LARGE", `That result is ${Math.round(buffer.length / 1048576)} MB; CineBraid takes delivery of up to ${MAX_OUTPUT_BYTES / 1048576} MB.`, { bytes: buffer.length }, 502);
    return { buffer, mime: text(response.headers.get("content-type")) || "application/octet-stream", status: response.status };
  }

  /* Text first, parsed here. A ComfyUI that answers an HTML error page produces a
     CineBraid sentence, not a JSON parser's complaint about "<". */
  const raw = await response.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      if (response.ok)
        throw new ComfyClientError("COMFY_BAD_RESPONSE", `ComfyUI answered ${label} with something that is not JSON.`, { origin, pathname, status: response.status }, 502);
    }
  }
  if (!response.ok) {
    /* ComfyUI's /prompt refuses a bad graph with a structured node_errors block. It is
       the single most useful failure in the whole integration — it names the node and
       the input — so it is carried through rather than flattened to a status code. */
    const nodeErrors = isRecord(data?.node_errors) ? data.node_errors : null;
    throw new ComfyClientError(
      nodeErrors ? "COMFY_GRAPH_REFUSED" : "COMFY_HTTP_ERROR",
      text(data?.error?.message) || text(data?.error) || `ComfyUI answered ${response.status} when CineBraid asked for ${label}.`,
      { origin, pathname, status: response.status, nodeErrors, type: text(data?.error?.type) },
      502,
    );
  }
  return data;
}

/* ---------------------------------------------------------------------------
   probe — connection truth.

   Answers three separate questions rather than one boolean, because "not connected"
   has three different fixes: the address is not one CineBraid may use, nothing is
   listening, or something is listening and is not ComfyUI. */
async function probe(baseUrl) {
  let origin;
  try {
    origin = assertReachableEndpoint(baseUrl);
  } catch (error) {
    return { connected: false, code: error.code, reason: error.message, baseUrl: text(baseUrl), version: "", device: "" };
  }
  let stats;
  try {
    stats = await request(origin, "/system_stats", { timeout: TIMEOUTS.probe, label: "its status" });
  } catch (error) {
    return { connected: false, code: error.code, reason: error.message, baseUrl: origin, version: "", device: "" };
  }
  const system = isRecord(stats?.system) ? stats.system : {};
  const devices = Array.isArray(stats?.devices) ? stats.devices : [];
  if (!isRecord(stats) || (!system.comfyui_version && !devices.length))
    return {
      connected: false,
      code: "COMFY_NOT_COMFYUI",
      reason: `Something is answering at ${origin}, but it does not look like ComfyUI.`,
      baseUrl: origin,
      version: "",
      device: "",
    };

  let queued = null;
  try {
    const queue = await request(origin, "/queue", { timeout: TIMEOUTS.probe, label: "its queue" });
    queued = (Array.isArray(queue?.queue_running) ? queue.queue_running.length : 0)
      + (Array.isArray(queue?.queue_pending) ? queue.queue_pending.length : 0);
  } catch {
    /* A reachable ComfyUI whose queue endpoint hiccups is still connected. */
  }
  return {
    connected: true,
    code: "",
    reason: "",
    baseUrl: origin,
    version: text(system.comfyui_version),
    python: text(system.python_version).split(" ")[0] || "",
    device: text(devices[0]?.name),
    queued,
  };
}

/* ---------------------------------------------------------------------------
   uploadImage — put bytes where a LoadImage node can find them.

   ComfyUI's LoadImage takes a FILENAME inside the server's own input folder, never a
   path and never bytes. So an input image is uploaded first and the name the server
   gives back is what lands in the graph. The name CineBraid asks for is derived from
   the CineBraid asset it came from, so a file sitting in ComfyUI's input folder is
   traceable back to the shot that sent it.

   multipart/form-data is built here rather than pulled in, because one boundary and
   two parts is less code than a dependency and has no supply chain. */
async function uploadImage(baseUrl, { buffer, filename, mime, subfolder = "cinebraid", overwrite = true }) {
  const origin = assertReachableEndpoint(baseUrl);
  if (!Buffer.isBuffer(buffer) || !buffer.length)
    throw new ComfyClientError("COMFY_UPLOAD_EMPTY", "CineBraid had no image bytes to send.", {}, 500);
  const safe = text(filename).replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "cinebraid-input.png";
  const boundary = `----CineBraid${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const part = (name, value) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, "utf8");
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${safe}"\r\nContent-Type: ${text(mime) || "application/octet-stream"}\r\n\r\n`, "utf8"),
    buffer,
    Buffer.from("\r\n", "utf8"),
    part("overwrite", overwrite ? "true" : "false"),
    part("type", "input"),
    ...(subfolder ? [part("subfolder", subfolder)] : []),
    Buffer.from(`--${boundary}--\r\n`, "utf8"),
  ]);
  const data = await request(origin, "/upload/image", {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": String(body.length) },
    body,
    timeout: TIMEOUTS.upload,
    label: "an input image upload",
  });
  const name = text(data?.name);
  if (!name)
    throw new ComfyClientError("COMFY_UPLOAD_FAILED", "ComfyUI accepted the upload but did not say what it named the file.", { data }, 502);
  const returnedSubfolder = text(data?.subfolder);
  return {
    name,
    subfolder: returnedSubfolder,
    type: text(data?.type) || "input",
    /* What a LoadImage node's `image` input must be set to. ComfyUI addresses a file in
       a subfolder as "sub/name" on that one input, which is why this is computed here
       and not by the caller. */
    reference: returnedSubfolder ? `${returnedSubfolder}/${name}` : name,
  };
}

/* ---------------------------------------------------------------------------
   submitPrompt — queue the graph.

   `clientId` is ComfyUI transport, not CineBraid identity: it is how a websocket
   subscriber recognises its own run. V1 polls /history instead of subscribing, so it is
   sent for protocol correctness and recorded nowhere production can read it —
   FORBIDDEN_INTENT_KEYS bans `client_id` from intent for exactly this reason. */
async function submitPrompt(baseUrl, graph, { clientId } = {}) {
  const origin = assertReachableEndpoint(baseUrl);
  const body = JSON.stringify({ prompt: graph, client_id: text(clientId) || undefined });
  const data = await request(origin, "/prompt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    timeout: TIMEOUTS.submit,
    label: "a queued workflow",
  });
  const promptId = text(data?.prompt_id);
  if (!promptId)
    throw new ComfyClientError(
      "COMFY_NO_PROMPT_ID",
      "ComfyUI accepted the workflow but returned no job id, so CineBraid cannot follow it.",
      { data },
      502,
    );
  return { promptId, queueNumber: Number(data?.number), nodeErrors: isRecord(data?.node_errors) ? data.node_errors : null };
}

/* ---------------------------------------------------------------------------
   readHistory — has it finished, and what did it make?
 *
 * ComfyUI's history entry carries `status.completed` and a `status.status_str`, plus an
 * `outputs` map keyed by the node that produced them. A run that is not in history yet
 * is RUNNING or QUEUED — which of the two is answered from /queue, because a job that
 * has not started and a job that is mid-render are different things to tell someone. */
async function readHistory(baseUrl, promptId) {
  const origin = assertReachableEndpoint(baseUrl);
  const id = text(promptId);
  if (!id) throw new ComfyClientError("COMFY_NO_PROMPT_ID", "No ComfyUI job id was recorded for this generation.", {}, 500);
  const data = await request(origin, `/history/${encodeURIComponent(id)}`, { timeout: TIMEOUTS.history, label: "a job's history" });
  const entry = isRecord(data) ? data[id] : null;
  if (!entry) return { state: "pending", outputs: [], statusText: "", messages: [] };

  const status = isRecord(entry.status) ? entry.status : {};
  const statusText = text(status.status_str);
  const messages = Array.isArray(status.messages) ? status.messages : [];
  const outputs = [];
  const outputMap = isRecord(entry.outputs) ? entry.outputs : {};
  for (const nodeId of Object.keys(outputMap)) {
    const node = outputMap[nodeId];
    if (!isRecord(node)) continue;
    for (const kind of ["images", "gifs", "videos", "audio"]) {
      if (!Array.isArray(node[kind])) continue;
      for (const item of node[kind]) {
        if (!isRecord(item) || !text(item.filename)) continue;
        /* ComfyUI marks a live preview as type "temp". A preview is not a delivered
           result and must never become a candidate the director reviews. */
        if (text(item.type) === "temp") continue;
        outputs.push({
          nodeId: String(nodeId),
          filename: text(item.filename),
          subfolder: text(item.subfolder),
          type: text(item.type) || "output",
          kind: kind === "images" ? "image" : kind === "audio" ? "audio" : "video",
        });
      }
    }
  }
  const failed = statusText === "error" || messages.some((row) => Array.isArray(row) && row[0] === "execution_error");
  if (failed) return { state: "failed", outputs, statusText, messages, error: executionError(messages) };
  if (status.completed === true || outputs.length) return { state: "completed", outputs, statusText, messages };
  return { state: "running", outputs, statusText, messages };
}

/* The one sentence worth surfacing from ComfyUI's message log. It names the node and
   the exception, which is what a filmmaker needs to fix a graph — everything else in
   that array is a trace. */
function executionError(messages) {
  for (const row of Array.isArray(messages) ? messages : []) {
    if (!Array.isArray(row) || row[0] !== "execution_error" || !isRecord(row[1])) continue;
    const detail = row[1];
    const where = text(detail.node_type) ? `${text(detail.node_type)} (node ${text(detail.node_id)})` : `node ${text(detail.node_id)}`;
    return `ComfyUI could not run ${where}: ${text(detail.exception_message) || text(detail.exception_type) || "the node reported an error"}.`;
  }
  return "ComfyUI reported an error while running this workflow.";
}

/* Whether a submitted prompt is still waiting or already rendering. Only asked when
   history has nothing yet, so it never costs a request on the common path. */
async function queuePosition(baseUrl, promptId) {
  const origin = assertReachableEndpoint(baseUrl);
  const id = text(promptId);
  let queue;
  try {
    queue = await request(origin, "/queue", { timeout: TIMEOUTS.probe, label: "its queue" });
  } catch {
    return { state: "unknown", position: null };
  }
  const running = Array.isArray(queue?.queue_running) ? queue.queue_running : [];
  const pending = Array.isArray(queue?.queue_pending) ? queue.queue_pending : [];
  const idOf = (row) => (Array.isArray(row) ? text(row[1]) : "");
  if (running.some((row) => idOf(row) === id)) return { state: "running", position: 0 };
  const index = pending.findIndex((row) => idOf(row) === id);
  if (index >= 0) return { state: "queued", position: index + 1 };
  return { state: "unknown", position: null };
}

/* ---------------------------------------------------------------------------
   fetchOutput — the bytes.
 *
 * The descriptor comes from ComfyUI's own history entry, never from a caller and never
 * from a filename a browser typed. `/view` takes three parameters and this builds them
 * with URLSearchParams, so a filename containing a `&` is a filename rather than an
 * extra parameter. */
async function fetchOutput(baseUrl, descriptor) {
  const origin = assertReachableEndpoint(baseUrl);
  const filename = text(descriptor?.filename);
  if (!filename) throw new ComfyClientError("COMFY_OUTPUT_UNNAMED", "ComfyUI reported a result with no filename.", { descriptor }, 502);
  const query = new URLSearchParams({
    filename,
    subfolder: text(descriptor?.subfolder),
    type: text(descriptor?.type) || "output",
  });
  const { buffer, mime } = await request(origin, `/view?${query.toString()}`, {
    timeout: TIMEOUTS.output,
    expect: "bytes",
    label: "a finished result",
  });
  return { buffer, mime, originalName: filename };
}

module.exports = {
  COMFY_BACKEND_ID,
  COMFY_DEFAULT_BASE_URL,
  COMFY_SURFACE_ID,
  MAX_OUTPUT_BYTES,
  TIMEOUTS,
  ComfyClientError,
  assertReachableEndpoint,
  executionFactsFor,
  fetchOutput,
  normalizeBaseUrl,
  probe,
  queuePosition,
  readHistory,
  submitPrompt,
  uploadImage,
};

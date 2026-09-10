/* The Civitai Orchestration adapter. The only file in CineBraid that speaks Civitai's
 * generation API.
 *
 * SIX OPERATIONS, because six is what one paid generation needs:
 *
 *     estimateWorkflow()  what would this cost?        POST /v2/consumer/workflows?whatif=true
 *     submitWorkflow()    spend it                     POST /v2/consumer/workflows
 *     getWorkflow()       is it done, and what did it make?  GET /v2/consumer/workflows/{id}
 *     queryWorkflows()    find a paid job we lost      GET /v2/consumer/workflows?tags=
 *     fetchBlob()         the bytes                    GET <signed url>
 *     fetchResource()     may this account use this model?   GET /api/v1/model-versions/mini/{id}
 *
 * Civitai's API is very much larger than this — models, images, articles, bounties,
 * collections, vault, training, forty-odd workflow step types. None of it is copied in.
 * A backend that mirrors a provider's API acquires the provider's release cadence as a
 * maintenance obligation, and six endpoints is the smallest set that can price a shot,
 * pay for it, and bring a picture back.
 *
 * ------------------------------------------------------------------------------
 * WHERE IT IS ALLOWED TO CONNECT — the security boundary, stated once.
 *
 * ComfyUI's boundary is "loopback only", because the machine is the operator's own.
 * Civitai's is the mirror image and needs its own statement, because this file exists to
 * contact the public internet with a credential attached:
 *
 *   1. TWO PINNED HOSTS. Every authenticated call goes to a constant — the orchestrator
 *      or the site API — and never to an address that arrived in configuration, in a
 *      project, or in a provider response. There is no baseUrl field for a person to set
 *      and therefore none for anything else to steer. The environment overrides exist so
 *      the suites can point at a local mock and are read once, at load.
 *
 *   2. HTTPS ONLY, on the pinned hosts. A bearer token is attached to these requests; a
 *      plaintext scheme would put it on the wire. The mock exception is narrow and
 *      explicit: an http:// override is honoured only when it names a loopback host,
 *      which is what a test fixture is and what a real provider can never be.
 *
 *   3. redirect: "manual", EVERYWHERE. A 30x is reported, never followed. Following one
 *      is how a pinned host becomes an unpinned one, and how a credential ends up
 *      somewhere it was never sent.
 *
 *   4. THE ONE URL THIS FILE DOES NOT CHOOSE is the signed blob URL, which arrives
 *      inside a provider response. That is the injection surface of this whole
 *      integration, so it gets its own gate — assertDownloadableBlobUrl() below —
 *      and NO CREDENTIAL IS EVER ATTACHED TO IT. The URL is already signed; adding a
 *      bearer would mean handing a token to whatever host the response happened to name.
 *
 *   5. BOUNDED, ALWAYS. Every call has an AbortController timeout and every download has
 *      a byte ceiling, so an unresponsive or over-generous provider is a refusal rather
 *      than a hung request or an exhausted process.
 *
 *   6. Responses are read as TEXT and parsed here, so a provider that answers HTML cannot
 *      put a fragment of its error page into a thrown SyntaxError — the discipline
 *      account-provider-civitai.js already applies to Civitai's auth surface.
 *
 * NO CREDENTIAL IS STORED, CACHED OR LOGGED HERE. Every function takes a bearer as an
 * argument, uses it for one request, and forgets it. Which credential that is — an OAuth
 * access token or a personal API key — is account-provider-civitai.js's `bearerFor` to
 * decide, and this file deliberately cannot tell the difference.
 */

const ORCHESTRATION_BASE = String(
  process.env.CINEBRAID_CIVITAI_ORCHESTRATION_BASE || "https://orchestration.civitai.com",
).replace(/\/+$/, "");
const SITE_BASE = String(process.env.CINEBRAID_CIVITAI_API_BASE || "https://civitai.com").replace(/\/+$/, "");

const CIVITAI_BACKEND_ID = "civitai";
const CIVITAI_SURFACE_ID = "civitai-orchestrator";

const TIMEOUTS = {
  /* A whatif is a pricing calculation and should be quick. */
  estimate: 30000,
  submit: 60000,
  /* The orchestrator caps a request at 100 seconds and `?wait=` blocks inside that, so
     the client ceiling has to sit above the server's own or a successful long poll would
     be aborted from this side just before it answered. */
  workflow: 120000,
  query: 30000,
  resource: 15000,
  blob: 120000,
};

/* THE LONGEST `?wait=` THIS CLIENT WILL ASK FOR.
 *
 * Civitai documents the request timeout as 100 seconds and `?wait=` as "seconds to block
 * waiting for the workflow to finish, capped by the 100-second request timeout". 20 is
 * below that with room for the round trip, and it is what the SDK's own poll helper
 * sends per attempt. Asking for 100 would spend the whole server budget on one attempt
 * and turn a slow render into a transport failure. */
const MAX_WAIT_SECONDS = 20;

/* A ceiling on what will be pulled into memory before it is written. A returned frame is
   a still image; anything past this is not one, and a provider is not trusted to be
   correct about how large its own output is. */
const MAX_BLOB_BYTES = 128 * 1024 * 1024;

/* Terminal per Civitai's own documentation: "Once a workflow or step reaches succeeded,
   failed, expired, or canceled, it will not transition back to processing." Recorded as
   data because generation-lifecycle.js maps these onto CineBraid's vocabulary and a
   mapping table needs something stable to map from. */
const WORKFLOW_TERMINAL_STATUSES = ["succeeded", "failed", "expired", "canceled"];

class CivitaiClientError extends Error {
  /* `providerContacted` is a fact about the WIRE, decided where the failure happens and
     never inferred later from an error code. A refusal built before anything was sent —
     an unreadable endpoint, an invalid body, a result address this client will not follow
     — never contacted Civitai; one built from an HTTP status or a timeout did. Every paid
     route reports it, so a caller is never left guessing whether a request left. */
  constructor(code, message, detail = {}, status = 502, providerContacted = false) {
    super(message);
    this.name = "CivitaiClientError";
    this.code = code;
    this.detail = detail;
    this.status = status;
    this.providerContacted = providerContacted === true;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

/* ---------------------------------------------------------------------------
   THE HOST GATE for the two pinned bases.

   Parsed with `new URL()` and compared on the parsed hostname, never by substring: a
   substring test passes `https://orchestration.civitai.com.attacker.example`. */
function loopbackHostname(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  if (/^::ffff:127\./.test(host)) return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

function assertPinnedBase(base, label) {
  let url;
  try {
    url = new URL(`${base}/`);
  } catch {
    throw new CivitaiClientError("CIVITAI_ENDPOINT_INVALID", `CineBraid could not read its ${label} address.`, {}, 500);
  }
  /* http is permitted only for a loopback mock. A real Civitai is never loopback, so
     this cannot widen anything a deployment can reach. */
  if (url.protocol === "https:") return url;
  if (url.protocol === "http:" && loopbackHostname(url.hostname)) return url;
  throw new CivitaiClientError(
    "CIVITAI_ENDPOINT_INSECURE",
    "CineBraid will only contact Civitai over HTTPS, because it sends an account credential.",
    {},
    500,
  );
}

/* ---------------------------------------------------------------------------
   THE BLOB URL GATE — the one address this file did not choose.

   A signed result URL arrives inside a provider response. Everything else here goes to a
   constant, so this is the only place where something outside CineBraid names a
   destination. Three refusals, and each one is a thing that could otherwise happen:

     scheme      https only. `file:`, `data:` and `http:` are all refused, so a response
                 cannot make CineBraid read its own disk or fetch in the clear.
     literal IP  a hostname that IS an address in a loopback, private, link-local or
                 carrier-grade-NAT range is refused, so a provider response cannot point
                 CineBraid at the operator's own router, printer or metadata service.
     redirects   not followed, by the caller. A 30x from a permitted URL is reported.

   WHAT THIS DELIBERATELY IS NOT: a general outbound policy. There is no such policy in
   this repository, and writing one inside a generation adapter would be inventing a trust
   model for the whole product. This is narrower and honest — it refuses the specific
   thing a provider response could steer, and nothing else. A DNS name that resolves to a
   private address still passes, which is stated rather than hidden: closing that needs
   resolution-time checking and belongs to the outbound policy when someone writes it. */
/* THE FIRST HEXTET OF AN IPv6 LITERAL, as a number.
 *
 * The ranges below are CIDR blocks whose boundaries fall inside the first 16 bits, so the
 * first hextet is all that has to be read — and reading it is the whole point, because
 * matching the TEXT was the defect: `startsWith("fe80")` catches `fe80::1` and misses
 * `fe90::1`, which is equally link-local. A prefix string is not a range.
 *
 * `::1` and `::ffff:…` both begin with the compressed run, so an address starting `::`
 * has a first hextet of zero; otherwise the text before the first colon is it. WHATWG URL
 * has already lower-cased and compressed the literal by the time it reaches here, so no
 * further normalisation is needed to read that one group. Anything unparseable returns
 * null and is judged by the explicit checks instead of by a number nobody can trust. */
function ipv6FirstHextet(host) {
  if (host.startsWith("::")) return 0;
  const head = host.split(":")[0];
  if (!/^[0-9a-f]{1,4}$/.test(head)) return null;
  const value = parseInt(head, 16);
  return Number.isInteger(value) ? value : null;
}

/* WHICH IPv6 LITERALS A PROVIDER RESPONSE MAY NOT SEND CINEBRAID TO.
 *
 *   ::1            loopback, exactly.
 *   ::ffff:…       IPv4-mapped. Refused wholesale rather than only for private mapped
 *                  addresses — that is the boundary as it already shipped and narrowing
 *                  it here would be a broadening of what a response can reach.
 *   fe80::/10      link-local. (h & 0xffc0) === 0xfe80 covers fe80 through febf, which is
 *                  the actual range; the retired text check covered only the first of the
 *                  sixty-four hextets in it.
 *   fc00::/7       unique local. (h & 0xfe00) === 0xfc00 covers fc00 through fdff, which
 *                  is exactly what the retired `fc`/`fd` text check covered — restated as
 *                  arithmetic so both ranges are read the same way, with no change in
 *                  which addresses are refused. */
function refusedV6(host) {
  if (host === "::1" || /^::ffff:/.test(host)) return true;
  const first = ipv6FirstHextet(host);
  if (first === null) return false;
  if ((first & 0xffc0) === 0xfe80) return true;
  if ((first & 0xfe00) === 0xfc00) return true;
  return false;
}

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^0\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

/* THE ONE EXEMPTION, AND WHY IT CANNOT WIDEN ANYTHING IN PRODUCTION.
 *
 * The rule below refuses a result address that points back into this network, and the
 * reason it is a rule is that the orchestrator is REMOTE: a response from the public
 * internet must not be able to make CineBraid fetch from the operator's own router,
 * printer or metadata service.
 *
 * When the orchestrator is itself loopback — which is only possible through the test
 * environment override, because there is no configuration field for it — that reasoning is
 * vacuous: the "provider" IS this machine, and its blobs are on this machine too. So the
 * exemption is derived from the pinned base rather than granted by a flag of its own, and
 * against the real Civitai it is permanently false. There is no way to switch it on for a
 * remote orchestrator, which is the property that matters. */
const MOCK_ORCHESTRATOR = (() => {
  try { return loopbackHostname(new URL(`${ORCHESTRATION_BASE}/`).hostname); } catch { return false; }
})();

function assertDownloadableBlobUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new CivitaiClientError("CIVITAI_BLOB_URL_INVALID", "Civitai returned a result address CineBraid could not read.", {}, 502);
  }
  if (MOCK_ORCHESTRATOR && (url.protocol === "http:" || url.protocol === "https:") && loopbackHostname(url.hostname)) return url;
  if (url.protocol !== "https:")
    throw new CivitaiClientError(
      "CIVITAI_BLOB_URL_REFUSED",
      "CineBraid will only download a Civitai result over HTTPS.",
      { scheme: url.protocol },
      502,
    );
  const host = String(url.hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  const literalV4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
  const literalV6 = host.includes(":");
  if (literalV4 && PRIVATE_V4.some((range) => range.test(host)))
    throw new CivitaiClientError("CIVITAI_BLOB_URL_REFUSED", "CineBraid will not follow a Civitai result address that points back into this network.", { host }, 502);
  if (literalV6 && refusedV6(host))
    throw new CivitaiClientError("CIVITAI_BLOB_URL_REFUSED", "CineBraid will not follow a Civitai result address that points back into this network.", { host }, 502);
  if (loopbackHostname(host) && url.protocol === "https:")
    throw new CivitaiClientError("CIVITAI_BLOB_URL_REFUSED", "CineBraid will not follow a Civitai result address that points back at this machine.", { host }, 502);
  return url;
}

/* ---------------------------------------------------------------------------
   One bounded request. Every provider call goes through here so that timeout, abort,
   redirect refusal and error normalisation cannot be forgotten at a call site. */
async function providerRequest(url, { method = "GET", bearer = "", body = null, timeoutMs = TIMEOUTS.estimate } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { accept: "application/json" };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (body !== null) headers["content-type"] = "application/json";
  let response;
  try {
    response = await fetch(url, { method, headers, body, signal: controller.signal, redirect: "manual" });
  } catch (error) {
    if (error?.name === "AbortError")
      throw new CivitaiClientError("CIVITAI_TIMEOUT", "Civitai did not answer in time.", {}, 504, true);
    throw new CivitaiClientError("CIVITAI_UNREACHABLE", "CineBraid could not reach Civitai.", {}, 503);
  } finally {
    clearTimeout(timer);
  }
  let raw = "";
  try {
    raw = await response.text();
  } catch {
    throw new CivitaiClientError("CIVITAI_RESPONSE_INVALID", "Civitai's answer could not be read.", {}, 502, true);
  }
  let parsed = null;
  if (raw) {
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
  }
  return { status: response.status, ok: response.status >= 200 && response.status < 300, body: parsed, hadBody: raw !== "" };
}

/* HTTP status → CineBraid vocabulary.
 *
 * THE INSUFFICIENT-FUNDS CASE IS THE ONE THAT MATTERS, and Civitai's own documentation
 * is explicit that it cannot be told apart from a user's spending cap: both answer
 * `{"code":"BAD_REQUEST"}` and "there's no separate error code that lets you distinguish
 * 'out of buzz' from 'capped by the user'". So CineBraid does not guess between them —
 * it names both possibilities in one sentence, which is the whole of what is known. The
 * same documentation says "don't retry on insufficient-funds errors", and nothing in this
 * integration does.
 *
 * The provider's own message is never carried across. It is written for a web console and
 * is not something CineBraid can vouch for. */
function normalizeStatus(status, body) {
  const code = text(body?.code).toUpperCase();
  const detail = { providerStatus: status, providerCode: code };
  if (status === 401)
    return new CivitaiClientError("CIVITAI_CREDENTIAL_REJECTED", "Civitai did not accept this account's credential.", detail, 401, true);
  if (status === 403)
    return new CivitaiClientError("CIVITAI_SCOPE_INSUFFICIENT", "This Civitai connection is not permitted to do that.", detail, 403, true);
  if (status === 404)
    return new CivitaiClientError("CIVITAI_NOT_FOUND", "Civitai has no record of that.", detail, 404, true);
  if (status === 429)
    return new CivitaiClientError("CIVITAI_RATE_LIMITED", "Civitai is rate-limiting this account. Nothing was charged.", detail, 429, true);
  if (status === 400)
    return new CivitaiClientError(
      "CIVITAI_REQUEST_REFUSED",
      "Civitai refused this request. The usual reason is not enough Buzz, or a spending limit you set for CineBraid on your Civitai account — Civitai does not tell CineBraid which. Nothing was charged.",
      detail,
      402,
      true,
    );
  if (status >= 500)
    return new CivitaiClientError("CIVITAI_UNAVAILABLE", "Civitai could not complete the request.", detail, 502, true);
  return new CivitaiClientError("CIVITAI_REQUEST_FAILED", "Civitai refused this request.", detail, 502, true);
}

/* ---------------------------------------------------------------------------
   Generation.

   `canonicalBody` is a STRING, not an object, and that is load-bearing rather than a
   convenience. The estimate and the submission must be the same bytes — that identity is
   what the paid permit binds — so the caller hashes and sends one serialisation, and this
   file never re-serialises it. Passing an object here would let JSON.stringify choose a
   key order twice and quietly break the guarantee. */
function assertCanonicalBody(canonicalBody) {
  if (typeof canonicalBody !== "string" || !canonicalBody.trim())
    throw new CivitaiClientError("CIVITAI_REQUEST_INVALID", "CineBraid will not send a request body it did not build.", {}, 500);
  return canonicalBody;
}

async function estimateWorkflow(bearer, canonicalBody) {
  const base = assertPinnedBase(ORCHESTRATION_BASE, "Civitai orchestration");
  const response = await providerRequest(`${base.origin}/v2/consumer/workflows?whatif=true`, {
    method: "POST",
    bearer,
    body: assertCanonicalBody(canonicalBody),
    timeoutMs: TIMEOUTS.estimate,
  });
  if (!response.ok) throw normalizeStatus(response.status, response.body);
  if (!isRecord(response.body))
    throw new CivitaiClientError("CIVITAI_RESPONSE_INVALID", "Civitai priced this request in a form CineBraid could not read.", {}, 502);
  /* `cost.total` is the field the SDK types and the field the documentation names. An
     estimate with no number in it is NOT a free estimate — it is an unusable one, and the
     caller must refuse rather than authorise a purchase for an unknown amount. */
  const total = Number(response.body?.cost?.total);
  return {
    priced: Number.isFinite(total) && total >= 0,
    amount: Number.isFinite(total) && total >= 0 ? total : null,
    /* Kept whole so a proof can record exactly what Civitai returned, including any
       per-currency breakdown this integration does not read. */
    cost: isRecord(response.body.cost) ? response.body.cost : null,
  };
}

async function submitWorkflow(bearer, canonicalBody) {
  const base = assertPinnedBase(ORCHESTRATION_BASE, "Civitai orchestration");
  const response = await providerRequest(`${base.origin}/v2/consumer/workflows`, {
    method: "POST",
    bearer,
    body: assertCanonicalBody(canonicalBody),
    timeoutMs: TIMEOUTS.submit,
  });
  if (!response.ok) throw normalizeStatus(response.status, response.body);
  const workflow = normalizeWorkflow(response.body);
  if (!workflow.workflowId)
    throw new CivitaiClientError(
      "CIVITAI_SUBMIT_UNCONFIRMED",
      "Civitai accepted the request but did not return a workflow to track it by.",
      {},
      502,
    );
  return workflow;
}

/* `?wait=` is a SERVER-SIDE long poll: the orchestrator holds the connection open until
   the workflow is terminal or the budget runs out, answering 200 or 202. That is why this
   integration ships no background timer — one press covers most single renders, and a
   render that outlives it is picked up by an explicit Refresh. */
async function getWorkflow(bearer, workflowId, { waitSeconds = 0 } = {}) {
  const base = assertPinnedBase(ORCHESTRATION_BASE, "Civitai orchestration");
  const id = text(workflowId);
  if (!id) throw new CivitaiClientError("CIVITAI_WORKFLOW_UNKNOWN", "CineBraid has no Civitai workflow to look up.", {}, 400);
  const wait = Math.max(0, Math.min(MAX_WAIT_SECONDS, Math.round(Number(waitSeconds) || 0)));
  const query = wait > 0 ? `?wait=${wait}` : "";
  const response = await providerRequest(`${base.origin}/v2/consumer/workflows/${encodeURIComponent(id)}${query}`, {
    bearer,
    timeoutMs: TIMEOUTS.workflow,
  });
  /* 202 means "still running", which is an ANSWER rather than a failure: the body carries
     the in-flight workflow. Treating it as an error would turn every long render into a
     refusal. */
  if (!response.ok && response.status !== 202) throw normalizeStatus(response.status, response.body);
  if (!isRecord(response.body))
    throw new CivitaiClientError("CIVITAI_RESPONSE_INVALID", "Civitai described this workflow in a form CineBraid could not read.", {}, 502);
  return normalizeWorkflow(response.body);
}

/* THE ORPHAN NET.
 *
 * CineBraid writes its ledger row before submitting, so a crash between the two is the
 * one window where paid work can exist that no local record names. Civitai's workflows
 * carry client-set `tags` that QueryWorkflows can filter by, so the CineBraid job id
 * stamped at submission makes that window recoverable: ask which workflows carry this
 * tag, rather than hoping none was lost. */
async function queryWorkflows(bearer, { tag = "", take = 20 } = {}) {
  const base = assertPinnedBase(ORCHESTRATION_BASE, "Civitai orchestration");
  const value = text(tag);
  if (!value) throw new CivitaiClientError("CIVITAI_QUERY_INVALID", "CineBraid will not ask Civitai for every workflow it has.", {}, 400);
  const params = new URLSearchParams({ tags: value, take: String(Math.max(1, Math.min(100, Number(take) || 20))) });
  const response = await providerRequest(`${base.origin}/v2/consumer/workflows?${params.toString()}`, {
    bearer,
    timeoutMs: TIMEOUTS.query,
  });
  if (!response.ok) throw normalizeStatus(response.status, response.body);
  const items = Array.isArray(response.body) ? response.body
    : Array.isArray(response.body?.items) ? response.body.items
      : Array.isArray(response.body?.results) ? response.body.results : [];
  return items.map(normalizeWorkflow).filter((row) => row.workflowId);
}

/* ---------------------------------------------------------------------------
   Reading one workflow into CineBraid's own shape.

   BOTH OUTPUT SHAPES ARE READ. Civitai's newer recipes answer `output.images[]` and older
   ones `output.blobs[]`; the published SDK's own extractor reads both, so this does too.
   Reading only one would make delivery depend on which engine a resource happens to use.

   NOTHING IS INVENTED. A field Civitai did not send is absent here, not defaulted: a
   status this function does not recognise is passed through as the provider's own word so
   the mapping layer can refuse it loudly rather than silently calling it `processing`. */
function normalizeOutputs(step) {
  const output = isRecord(step?.output) ? step.output : {};
  const rows = [];
  for (const image of Array.isArray(output.images) ? output.images : []) {
    if (!isRecord(image)) continue;
    /* `available: false` is Civitai saying the blob is not fetchable yet. Including it
       would produce a download that cannot succeed and a delivery that half-happened. */
    if (image.available === false) continue;
    const url = text(image.url);
    if (!url) continue;
    rows.push({ blobId: text(image.id), url, mimeType: text(image.mimeType) || text(image.type) });
  }
  for (const blob of Array.isArray(output.blobs) ? output.blobs : []) {
    if (!isRecord(blob)) continue;
    const url = text(blob.url);
    if (!url) continue;
    const mimeType = text(blob.mimeType) || text(blob.type);
    /* A blobs[] array may legitimately carry non-images; only pictures are candidates. */
    if (mimeType && !mimeType.toLowerCase().startsWith("image/")) continue;
    const blobId = text(blob.id);
    if (blobId && rows.some((row) => row.blobId === blobId)) continue;
    rows.push({ blobId, url, mimeType });
  }
  return rows;
}

function normalizeWorkflow(body) {
  const row = isRecord(body) ? body : {};
  const steps = (Array.isArray(row.steps) ? row.steps : []).map((step) => ({
    name: text(step?.name),
    type: text(step?.$type),
    status: text(step?.status),
    jobIds: (Array.isArray(step?.jobs) ? step.jobs : []).map((job) => text(job?.id)).filter(Boolean),
    outputs: normalizeOutputs(step),
  }));
  return {
    workflowId: text(row.id),
    status: text(row.status),
    terminal: WORKFLOW_TERMINAL_STATUSES.includes(text(row.status)),
    createdAt: text(row.createdAt),
    startedAt: text(row.startedAt),
    completedAt: text(row.completedAt),
    tags: (Array.isArray(row.tags) ? row.tags : []).map(text).filter(Boolean),
    /* WHAT WAS ACTUALLY CHARGED, if Civitai says. The documentation states that "Buzz
       charges live on the workflow's transactions / cost" but publishes no field shape,
       so both are carried through unread rather than parsed into a number CineBraid would
       then have to stand behind. The proof records what really arrives. */
    cost: isRecord(row.cost) ? row.cost : null,
    transactions: Array.isArray(row.transactions) ? row.transactions : null,
    steps,
    outputs: steps.flatMap((step) => step.outputs),
  };
}

/* ---------------------------------------------------------------------------
   The bytes.

   No bearer. The URL is already signed, and attaching a credential would mean sending it
   to whatever host the provider response named — see the header's point 4.

   ------------------------------------------------------------------------------
   REDIRECTS: FOLLOWED ONLY WITHIN THE ORIGIN THE PROVIDER ITSELF NAMED.

   This function used to refuse every 3xx outright. The first real paid generation showed
   why that was too blunt: Civitai serves a completed result from

       GET  https://orchestration-new.civitai.com/v2/consumer/blobs/<id>?sig=…&exp=…
       301  Location: /v2/consumer/blobs/content/<opaque token>      <- RELATIVE, same host
       200  image/jpeg

   so a legitimate retrieval from the very host the authenticated workflow named was
   refused, and a paid result sat undelivered. The refusal was conservative in the right
   direction — nothing was lost, nothing was claimed, and the job stayed recoverable
   without paying twice — but it was wrong.

   THE RULE, and it is deliberately not an allowlist of Civitai hostnames:

     the trust boundary is the ORIGIN OF THE URL THE AUTHENTICATED WORKFLOW RETURNED.

   A hostname list would be a standing claim about Civitai's infrastructure that CineBraid
   cannot keep current — `orchestration-new.civitai.com` is not the API host, and nothing
   published says what tomorrow's is. Deriving the boundary from the response instead means
   the only thing ever trusted is the host Civitai just told an authenticated caller to
   fetch from, and a redirect may move within it but never out of it.

   Every hop re-runs assertDownloadableBlobUrl(), so scheme, loopback, private, link-local
   and carrier-grade-NAT refusals apply to redirect targets exactly as they apply to the
   first URL — belt and braces, since a public origin cannot resolve to those, but the
   check is cheap and a boundary that only guards its front door is not a boundary.

   Depth is capped, one timeout covers the whole chain so hops cannot extend the budget,
   and no credential is sent on any hop. */
const MAX_BLOB_REDIRECTS = 3;

async function fetchBlob(url) {
  /* The origin the provider named. Everything below may move within it and nowhere else. */
  const first = assertDownloadableBlobUrl(url);
  const boundary = first.origin;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUTS.blob);
  let target = first;
  let response;
  try {
    for (let hop = 0; ; hop++) {
      try {
        response = await fetch(target.toString(), { signal: controller.signal, redirect: "manual" });
      } catch (error) {
        if (error?.name === "AbortError")
          throw new CivitaiClientError("CIVITAI_BLOB_TIMEOUT", "Downloading the Civitai result timed out.", {}, 504);
        throw new CivitaiClientError("CIVITAI_BLOB_UNREACHABLE", "CineBraid could not download the Civitai result.", {}, 502);
      }
      if (!(response.status >= 300 && response.status < 400)) break;

      if (hop >= MAX_BLOB_REDIRECTS)
        throw new CivitaiClientError(
          "CIVITAI_BLOB_REDIRECT_DEPTH",
          "The Civitai result address redirected too many times, so CineBraid stopped following it.",
          { hops: hop + 1 },
          502,
        );
      const location = text(response.headers.get("location"));
      if (!location)
        throw new CivitaiClientError("CIVITAI_BLOB_REDIRECT_INVALID", "Civitai redirected the result address without saying where.", { status: response.status }, 502);
      let next;
      try {
        /* Resolved against the CURRENT target, because the real redirect is relative. */
        next = new URL(location, target);
      } catch {
        throw new CivitaiClientError("CIVITAI_BLOB_REDIRECT_INVALID", "Civitai redirected the result address somewhere CineBraid could not read.", {}, 502);
      }
      /* The same gate the first URL passed. */
      next = assertDownloadableBlobUrl(next.toString());
      if (next.origin !== boundary)
        throw new CivitaiClientError(
          "CIVITAI_BLOB_REDIRECTED",
          "The Civitai result address redirected to a different host, so CineBraid did not follow it.",
          { from: boundary, to: next.origin },
          502,
        );
      target = next;
    }
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok)
    throw new CivitaiClientError(
      /* A signed URL that has expired answers 401/403 and is a DIFFERENT fact from a
         missing result: the workflow can be re-read for a fresh one. */
      response.status === 401 || response.status === 403 ? "CIVITAI_BLOB_EXPIRED" : "CIVITAI_BLOB_FAILED",
      response.status === 401 || response.status === 403
        ? "The Civitai result address has expired. CineBraid can ask Civitai for a fresh one."
        : "Civitai did not return the result bytes.",
      { status: response.status },
      502,
    );
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BLOB_BYTES)
    throw new CivitaiClientError("CIVITAI_BLOB_TOO_LARGE", "The Civitai result is larger than CineBraid will download.", { bytes: declared }, 502);
  const buffer = Buffer.from(await response.arrayBuffer());
  /* Checked again after the fact, because content-length is a claim and an absent one is
     not a small one. */
  if (buffer.length > MAX_BLOB_BYTES)
    throw new CivitaiClientError("CIVITAI_BLOB_TOO_LARGE", "The Civitai result is larger than CineBraid will download.", { bytes: buffer.length }, 502);
  if (!buffer.length)
    throw new CivitaiClientError("CIVITAI_BLOB_EMPTY", "Civitai returned an empty result file.", {}, 502);
  return { buffer, mime: text(response.headers.get("content-type")) };
}

/* ---------------------------------------------------------------------------
   May this account generate with this resource?

   The `mini` endpoint is used rather than the full one because it is the only place
   Civitai publishes `canGenerate` — "whether the resource can be used in an Orchestration
   workflow for the calling user" — and `checkPermission`, which is true when a resource
   is gated behind early access or is private. Those two are the whole question, and the
   full response's files, images and download URLs are not part of it. */
async function fetchResource(bearer, versionId) {
  const base = assertPinnedBase(SITE_BASE, "Civitai site");
  const id = text(versionId);
  if (!id) throw new CivitaiClientError("CIVITAI_RESOURCE_UNKNOWN", "CineBraid has no Civitai model version to check.", {}, 400);
  const response = await providerRequest(`${base.origin}/api/v1/model-versions/mini/${encodeURIComponent(id)}`, {
    bearer,
    timeoutMs: TIMEOUTS.resource,
  });
  if (!response.ok) throw normalizeStatus(response.status, response.body);
  const row = isRecord(response.body) ? response.body : {};
  return {
    versionId: String(row.id == null ? id : row.id),
    modelId: row.modelId == null ? "" : String(row.modelId),
    versionName: text(row.name),
    modelName: text(isRecord(row.model) ? row.model.name : ""),
    baseModel: text(row.baseModel),
    air: text(row.air),
    availability: text(row.availability),
    /* Absent is NOT true. A response that does not say the resource can be generated with
       is a response CineBraid must not read as permission. */
    canGenerate: row.canGenerate === true,
    checkPermission: row.checkPermission === true,
  };
}

module.exports = {
  CIVITAI_BACKEND_ID,
  CIVITAI_SURFACE_ID,
  CivitaiClientError,
  MOCK_ORCHESTRATOR,
  MAX_BLOB_BYTES,
  MAX_BLOB_REDIRECTS,
  MAX_WAIT_SECONDS,
  ORCHESTRATION_BASE,
  SITE_BASE,
  TIMEOUTS,
  WORKFLOW_TERMINAL_STATUSES,
  assertDownloadableBlobUrl,
  assertPinnedBase,
  estimateWorkflow,
  fetchBlob,
  fetchResource,
  getWorkflow,
  normalizeWorkflow,
  queryWorkflows,
  submitWorkflow,
};

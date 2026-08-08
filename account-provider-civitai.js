/* CineBraid Civitai account adapter — every Civitai-specific fact lives here.
 *
 * Verified against Civitai's OpenID discovery document, developer documentation
 * and the civitai/civitai repository during the Phase 3 preflight. Three of those
 * findings are unusual enough that a generic OAuth client library gets them wrong,
 * and each is called out at the line that depends on it:
 *
 *   1. `scope` is a DECIMAL BITMASK STRING, not a space-delimited name list.
 *      Phase 3 asks for `1` (UserRead) and nothing else. A stock client sending
 *      `scope=UserRead%20BuzzRead` is rejected.
 *   2. PKCE S256 is MANDATORY for every client, public or confidential, and
 *      `plain` is not offered at all.
 *   3. Loopback redirect URIs get RFC 8252 §7.3 port flexibility: the registered
 *      scheme and PATH must match exactly, the port need not, and any loopback
 *      hostname matches any other. CineBraid's port is user-settable, so this is
 *      the finding that makes a fixed registration workable.
 *
 * There is deliberately NO Buzz balance call. Civitai's documented public REST API
 * has no balance endpoint; `/api/v1/me` returns `buzzLimit`, which is the per-app
 * SPEND CAP the user set at consent and not a balance. The only surface that does
 * return a balance is tRPC, which is undocumented, unversioned and free to change
 * on any deploy. Reporting `supported: false` is the honest answer; rendering
 * `buzzLimit` as a balance would be a wrong number in a currency field.
 *
 * There is also no device-code flow. The grant exists but the self-service client
 * registration schema has no `grants` field, so a third-party client cannot enable
 * it — loopback is the only self-service interactive flow, which is why the
 * personal API key ships in the same phase as its only fallback.
 */

const crypto = require("crypto");
const { providerError } = require("./account-errors");

/* Addresses are overridable ONLY through the environment, and only so the test
   suites can point at a local mock. They are never read from project data, never
   returned in an account projection, and never written into config. */
const AUTH_BASE = String(process.env.CINEBRAID_CIVITAI_AUTH_BASE || "https://auth.civitai.com").replace(/\/+$/, "");
const API_BASE = String(process.env.CINEBRAID_CIVITAI_API_BASE || "https://civitai.com").replace(/\/+$/, "");
const REQUEST_TIMEOUT_MS = Math.max(1000, Number(process.env.CINEBRAID_CIVITAI_TIMEOUT_MS) || 15000);

const PROVIDER_ID = "civitai";
const PROVIDER_LABEL = "Civitai";

/* The registered redirect path. Civitai matches loopback redirects on scheme and
   path exactly, so this string is the contract: pick it once, never change it. */
const REDIRECT_PATH = "/api/accounts/civitai/callback";

/* UserRead (1 << 0). Identity only — no model access, no generation, no Buzz.
   Later phases widen by re-running /authorize; an account-connection step must
   never ask for permission to spend. */
const PHASE_SCOPE = "1";

/* ---------------------------------------------------------------------------
   PKCE. Node's crypto only — nothing here reimplements a digest.

   base64url without padding, per RFC 7636 §4.1/§4.2. The verifier is 32 random
   bytes, which encodes to 43 characters: the shortest value the RFC allows is 43
   and the entropy floor it names is 256 bits, so this sits exactly on both. */
function createCodeVerifier() {
  return crypto.randomBytes(32).toString("base64url");
}
function codeChallengeFor(verifier) {
  return crypto.createHash("sha256").update(String(verifier), "ascii").digest("base64url");
}
function createState() {
  return crypto.randomBytes(32).toString("base64url");
}

/* ---------------------------------------------------------------------------
   Configuration. A client_id is public by definition — it appears in the
   authorization URL the user's browser is sent to — so it is ordinary config and
   is deliberately NOT declared a secret. Masking it would only make it
   unreadable to the person who has to paste it in. */
function clientId(config = {}) {
  return String(config?.accountProviders?.civitai?.clientId || "").trim();
}
function isConfigured(config = {}) {
  return clientId(config) !== "";
}

/* ---------------------------------------------------------------------------
   One bounded request. Every provider call goes through here so that timeout,
   abort and error normalization cannot be forgotten at a call site.

   The response body is read as text and parsed here rather than with
   `response.json()`, because a provider that returns HTML on an error page would
   otherwise throw a SyntaxError carrying a fragment of that page — and that
   fragment then travels into a log or an error message. */
async function providerRequest(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, { ...options, signal: controller.signal, redirect: "manual" });
  } catch (error) {
    if (error?.name === "AbortError") throw providerError("PROVIDER_TIMEOUT", PROVIDER_ID);
    throw providerError("PROVIDER_UNREACHABLE", PROVIDER_ID);
  } finally {
    clearTimeout(timer);
  }
  let text = "";
  try {
    text = await response.text();
  } catch {
    throw providerError("PROVIDER_RESPONSE_INVALID", PROVIDER_ID);
  }
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = null; }
  }
  return { status: response.status, ok: response.ok, body, hadBody: text !== "" };
}

/* HTTP status → CineBraid vocabulary. The provider's own message is never carried
   across: it is written for a web console, may quote a request, and is not
   something CineBraid can vouch for. */
function normalizeStatus(status, body) {
  if (status === 401) return providerError("CREDENTIAL_REJECTED", PROVIDER_ID);
  if (status === 403) return providerError("SCOPE_INSUFFICIENT", PROVIDER_ID);
  if (status === 429) return providerError("PROVIDER_RATE_LIMITED", PROVIDER_ID);
  if (status >= 500) return providerError("PROVIDER_UNAVAILABLE", PROVIDER_ID);
  /* The OAuth error registry is the one provider-supplied value worth reading,
     because `invalid_grant` is the difference between "this refresh token is dead"
     and "something went wrong". Only the code is read; the description is not. */
  const oauthError = typeof body?.error === "string" ? body.error : "";
  if (oauthError === "invalid_grant") return providerError("CREDENTIAL_EXPIRED", PROVIDER_ID);
  if (oauthError === "invalid_scope") return providerError("SCOPE_INSUFFICIENT", PROVIDER_ID);
  return providerError("AUTHORIZATION_FAILED", PROVIDER_ID);
}

/* ---------------------------------------------------------------------------
   Authorization URL. */
function buildAuthorization({ config = {}, redirectUri = "" } = {}) {
  const id = clientId(config);
  if (!id) throw providerError("PROVIDER_NOT_CONFIGURED", PROVIDER_ID);
  const codeVerifier = createCodeVerifier();
  const codeChallenge = codeChallengeFor(codeVerifier);
  const state = createState();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: id,
    redirect_uri: redirectUri,
    /* Decimal bitmask, as a string. Not a scope name, and not a list. */
    scope: PHASE_SCOPE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return {
    authorizationUrl: `${AUTH_BASE}/api/auth/oauth/authorize?${params.toString()}`,
    state,
    codeVerifier,
    codeChallenge,
    scope: PHASE_SCOPE,
    redirectUri,
  };
}

/* A token endpoint response is only a credential once it has been checked. An
   unchecked `access_token: undefined` stored now becomes an unexplainable 401
   later, a long way from the cause. */
function credentialFromTokenResponse(body, { tokenSource = "oauth", previousRefreshToken = "" } = {}) {
  const accessToken = typeof body?.access_token === "string" ? body.access_token.trim() : "";
  if (!accessToken) throw providerError("PROVIDER_RESPONSE_INVALID", PROVIDER_ID);
  const tokenType = String(body?.token_type || "bearer").toLowerCase();
  if (tokenType !== "bearer") throw providerError("PROVIDER_RESPONSE_INVALID", PROVIDER_ID);
  const expiresIn = Number(body?.expires_in);
  /* The provider's own number, when it gives one. A hard-coded hour would be a
     guess that silently rots the day Civitai changes its token lifetime. */
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;
  /* Rotation: a replacement refresh token supersedes the stored one. Its absence
     means the old one is still current, which is why the previous value is
     carried rather than blanked. */
  const rotated = typeof body?.refresh_token === "string" ? body.refresh_token.trim() : "";
  return {
    credential: {
      tokenSource,
      accessToken,
      refreshToken: rotated || String(previousRefreshToken || ""),
      apiKey: "",
      expiresAt,
    },
    grantedScope: typeof body?.scope === "string" ? body.scope : "",
    rotatedRefreshToken: rotated !== "" && rotated !== String(previousRefreshToken || ""),
  };
}

async function tokenRequest(form) {
  const response = await providerRequest(`${AUTH_BASE}/api/auth/oauth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams(form).toString(),
  });
  if (!response.ok) throw normalizeStatus(response.status, response.body);
  if (!response.body) throw providerError("PROVIDER_RESPONSE_INVALID", PROVIDER_ID);
  return response.body;
}

/* Authorization code → credential. Public client: no client_secret anywhere in
   this request, because a public client is not issued one and sending an empty
   string would be a different, failing, authentication method.

   `scope` is deliberately absent: RFC 6749 §4.1.3 does not define it for an
   authorization_code exchange, and what was granted is read back off the response. */
async function exchangeAuthorizationCode({ config = {}, code = "", codeVerifier = "", redirectUri = "" } = {}) {
  const id = clientId(config);
  if (!id) throw providerError("PROVIDER_NOT_CONFIGURED", PROVIDER_ID);
  const body = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: id,
    code_verifier: codeVerifier,
  });
  return credentialFromTokenResponse(body, { tokenSource: "oauth" });
}

/* Refresh. Scope is omitted so the grant is renewed exactly as it stands — RFC
   6749 §6 allows narrowing only, and Phase 3 has nothing to narrow. */
async function refreshCredential({ config = {}, refreshToken = "" } = {}) {
  const id = clientId(config);
  if (!id) throw providerError("PROVIDER_NOT_CONFIGURED", PROVIDER_ID);
  if (!String(refreshToken || "").trim()) throw providerError("CREDENTIAL_EXPIRED", PROVIDER_ID);
  const body = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: id,
  });
  return credentialFromTokenResponse(body, { tokenSource: "oauth", previousRefreshToken: refreshToken });
}

/* A personal API key. It is a bearer credential and nothing more: no refresh
   token, no expiry, and no pretence of being an OAuth grant. Storing it as one
   would make CineBraid try to refresh something that has no refresh endpoint. */
async function authenticateApiKey({ apiKey = "" } = {}) {
  const key = String(apiKey || "").trim();
  if (!key) throw providerError("CREDENTIAL_REJECTED", PROVIDER_ID);
  return {
    credential: {
      tokenSource: "api_key",
      accessToken: "",
      refreshToken: "",
      apiKey: key,
      expiresAt: null,
    },
    grantedScope: "",
    rotatedRefreshToken: false,
  };
}

function bearerFor(credential) {
  const token = credential?.tokenSource === "api_key"
    ? String(credential?.apiKey || "")
    : String(credential?.accessToken || "");
  if (!token) throw providerError("CREDENTIAL_REJECTED", PROVIDER_ID);
  return token;
}

/* Identity, from the authenticated `GET /api/v1/me`.
 *
 * Preferred over the OIDC userinfo endpoint because it carries `tokenScope`,
 * which is what lets CineBraid explain a missing capability instead of failing
 * opaquely — and because it omits `email` entirely for a token without profile
 * read, so the field CineBraid refuses to store need not even arrive.
 *
 * The response is destructured field by field. `email`, `subscriptions`,
 * `buzzLimit` and anything Civitai adds later are simply never read, so an
 * enlarged response cannot enlarge what CineBraid keeps. The header is used
 * rather than the `?token=` query form, which Civitai warns leaks into logs. */
async function fetchIdentity({ credential = {} } = {}) {
  const response = await providerRequest(`${API_BASE}/api/v1/me`, {
    method: "GET",
    headers: { authorization: `Bearer ${bearerFor(credential)}`, accept: "application/json" },
  });
  if (!response.ok) throw normalizeStatus(response.status, response.body);
  const body = response.body;
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw providerError("PROVIDER_RESPONSE_INVALID", PROVIDER_ID);
  const id = body.id;
  const providerUserId = typeof id === "number" && Number.isFinite(id) ? String(id)
    : typeof id === "string" && id.trim() ? id.trim() : "";
  const displayName = typeof body.username === "string" ? body.username.trim() : "";
  if (!providerUserId || !displayName) throw providerError("PROVIDER_RESPONSE_INVALID", PROVIDER_ID);
  return {
    providerUserId,
    displayName,
    avatarUrl: null,
    tier: typeof body.tier === "string" ? body.tier : "",
    accountStatus: typeof body.status === "string" ? body.status : "",
    grantedScope: body.tokenScope === undefined || body.tokenScope === null ? "" : String(body.tokenScope),
  };
}

module.exports = {
  PHASE_SCOPE,
  PROVIDER_ID,
  PROVIDER_LABEL,
  REDIRECT_PATH,
  providerId: PROVIDER_ID,
  label: PROVIDER_LABEL,
  supportsOAuth: true,
  supportsApiKey: true,
  /* The negative finding, stated as data rather than as a comment somewhere. */
  balanceSupported: false,
  redirectPath: REDIRECT_PATH,
  authenticateApiKey,
  buildAuthorization,
  codeChallengeFor,
  createCodeVerifier,
  createState,
  exchangeAuthorizationCode,
  fetchIdentity,
  isConfigured,
  refreshCredential,
};

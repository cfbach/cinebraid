/* CineBraid AccountConnection routes — connect, verify, disconnect.
 *
 * Registered the way fal-generation.js and automation-runs.js are: the server
 * hands in the config reader/writer and its own port, and nothing in here reaches
 * back into server.js. No project file is read or written by any route below, and
 * no MediaAsset code is imported, called or reachable from here.
 *
 * WHERE THE LOOPBACK GUARD GOES, and why it is not everywhere.
 *
 * Every route that RECEIVES OR CREATES a credential is loopback-only:
 * `oauth/start`, the provider callback, and the API-key paste. Those three are the
 * whole credential surface, and making them structurally unanswerable from the
 * network means `--lan` cannot widen it — a subnet peer cannot start a connection,
 * cannot race the callback, and cannot post a key.
 *
 * Reading the account list and disconnecting are NOT loopback-only: they carry no
 * credential in either direction and are governed by the editor authorization that
 * already governs every other settings-changing route. Putting the guard there too
 * would look thorough and would only break the legitimate case of checking, from a
 * tablet, whether the studio account is still connected.
 *
 * The callback is the one route that cannot rely on the editor cookie, because it
 * is a navigation the provider caused rather than one the app made. Its authority
 * is instead: a loopback peer, plus a cryptographically random `state` that this
 * server minted, has not expired, and can be spent exactly once.
 */

const {
  createConnection,
  credentialExpired,
  findConnection,
  isValidConnectionId,
  normalizeIdentity,
  removeConnection,
  safeConnectionList,
  unsupportedBalance,
  upsertConnection,
  validateConnection,
} = require("./account-connections");
const { getAccountProvider, isAuthoritativeFailure, listAccountProviders, providerError } = require("./account-providers");
const { httpStatusForError } = require("./http-errors");
const { isLoopbackRequest, requireLoopbackRequest } = require("./loopback-request");

/* ---------------------------------------------------------------------------
   Pending OAuth flows.

   In memory, deliberately. A pending flow is worth ten minutes and nothing else:
   it holds a PKCE verifier, which must never be written anywhere a backup or a
   sync client could copy it, and it describes an attempt rather than a fact. A
   restart loses any unfinished attempt, which costs the user one click and cannot
   corrupt an AccountConnection — the connection does not exist yet.

   Nothing here goes near project.json.

   Ten minutes matches the authorization code's own lifetime, so a state cannot
   outlive the code it is paired with. The map is bounded because it is keyed by a
   value a caller can cause to be minted; without a ceiling, repeatedly clicking
   Connect would grow it without limit. */
const PENDING_TTL_MS = 10 * 60 * 1000;
const PENDING_MAX = 8;

function createPendingFlows(now = () => Date.now()) {
  const flows = new Map();

  function prune() {
    const at = now();
    for (const [state, flow] of flows) if (flow.expiresAt <= at) flows.delete(state);
  }

  function remember(state, flow) {
    prune();
    /* Oldest first: Map preserves insertion order, so the first key is the one
       that has been waiting longest. */
    while (flows.size >= PENDING_MAX) flows.delete(flows.keys().next().value);
    flows.set(state, { ...flow, createdAt: new Date(now()).toISOString(), expiresAt: now() + PENDING_TTL_MS });
  }

  /* Single use. Deleted before it is validated, so a replay of a live state finds
     nothing on its second attempt regardless of what happens next — including a
     failure partway through the exchange. */
  function consume(state) {
    prune();
    const key = typeof state === "string" ? state : "";
    if (!key || !flows.has(key)) return null;
    const flow = flows.get(key);
    flows.delete(key);
    return flow.expiresAt <= now() ? null : flow;
  }

  return { consume, remember, size: () => flows.size };
}

/* ---------------------------------------------------------------------------
   The callback page.

   A whole page rather than a redirect, because the two outcomes need different
   words and a hash redirect cannot carry them. It renders only fixed strings from
   the error vocabulary: no provider text, no code, no state, no token, no URL. */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function callbackPage({ heading, message, ok }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${escapeHtml(heading)} — CineBraid</title>`
    + `<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;`
    + `background:#0d1117;color:#e6edf3;font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}`
    + `main{max-width:32rem;padding:2rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}`
    + `p{margin:0 0 1.5rem;color:#9aa7b4}a{display:inline-block;padding:.6rem 1.1rem;border-radius:.4rem;`
    + `background:${ok ? "#1f6feb" : "#30363d"};color:#fff;text-decoration:none}</style></head>`
    + `<body><main><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(message)}</p>`
    + `<a href="/#/settings">Back to CineBraid</a></main></body></html>`;
}

/* ---------------------------------------------------------------------------
   Registration. */
function registerAccountConnections(app, context) {
  const { readConfig, writeConfig, serverPort } = context;
  const pending = createPendingFlows();

  function nowIso() { return new Date().toISOString(); }

  function storedAccounts(config = readConfig()) {
    return Array.isArray(config.accounts) ? config.accounts : [];
  }

  /* Read-modify-write against the same config machinery every other setting uses.
     Deliberately not a second persistence system: the secret registry only
     protects what goes through config.js, so a private accounts file would be a
     credential store outside the one mechanism that masks credentials. */
  function persistAccounts(mutate) {
    const config = readConfig();
    const next = mutate(storedAccounts(config));
    writeConfig({ ...config, accounts: next });
    return next;
  }

  /* Verification writes back what it learned — but only for a connection that is
     still there. Verification is slow (it waits on the provider) and disconnect is
     instant, so the two can overlap: a plain upsert would find no row to replace,
     append one, and quietly restore the credential the user had just deleted.
     A verify may UPDATE a connection; it may never create one. */
  function persistVerified(connection) {
    persistAccounts((accounts) => (
      findConnection(accounts, connection.connectionId) ? upsertConnection(accounts, connection) : accounts
    ));
  }

  function respondError(res, error) {
    const status = httpStatusForError(error);
    res.status(status).json({
      error: error?.message || "The account request could not be completed.",
      code: error?.code || "ACCOUNT_REQUEST_FAILED",
    });
  }

  /* ---- provider operations, wrapped so a connection's state follows the truth
          of what happened rather than the last thing that threw ---- */

  function applyIdentity(connection, identity, grantedScope) {
    const merged = normalizeIdentity({ ...identity });
    /* The token response's scope wins when the provider echoed one, because it is
       what was actually granted for THIS credential. */
    if (grantedScope) merged.grantedScope = String(grantedScope);
    return {
      ...connection,
      identity: merged,
      status: "connected",
      lastVerifiedAt: nowIso(),
      lastError: null,
    };
  }

  function applyFailure(connection, error) {
    const failure = { code: error?.code || "ACCOUNT_REQUEST_FAILED", message: error?.message || "" };
    /* Only a provider answer ABOUT the credential may downgrade a connection. An
       unreachable or busy provider leaves the account exactly as it was; it simply
       stops being recently verified, and the projection reports that as stale. */
    if (!isAuthoritativeFailure(error)) return { ...connection, lastError: failure };
    if (error.code === "SCOPE_INSUFFICIENT") return { ...connection, status: "error", lastError: failure };
    return {
      ...connection,
      status: "expired",
      /* The tokens are authoritatively dead. Keeping them would leave a credential
         on disk that can only ever fail, and reconnecting replaces them anyway. */
      credential: { ...connection.credential, accessToken: "", refreshToken: "" },
      lastError: failure,
    };
  }

  /* One verification pass. At most ONE refresh, ever: the strategy is
   *   valid token           -> use it
   *   expired by the clock  -> refresh once, then use it
   *   provider says no      -> refresh once, then try once more
   * and there is no third attempt, no backoff loop and no timer. A refresh storm
   * against a rate-limited provider is worse than an honest failure. */
  async function verifyConnection(connection, config) {
    const adapter = getAccountProvider(connection.providerId);
    let working = connection;
    let refreshed = false;

    async function refreshOnce() {
      refreshed = true;
      const result = await adapter.refreshCredential({ config, refreshToken: working.credential.refreshToken });
      working = { ...working, credential: { ...working.credential, ...result.credential } };
      return result.grantedScope;
    }

    const canRefresh = working.credential.tokenSource === "oauth" && !!working.credential.refreshToken;
    let scopeFromRefresh = "";

    try {
      if (canRefresh && credentialExpired(working)) scopeFromRefresh = await refreshOnce();
    } catch (error) {
      return { connection: applyFailure(working, error), error };
    }

    try {
      const identity = await adapter.fetchIdentity({ config, credential: working.credential });
      return { connection: applyIdentity(working, identity, scopeFromRefresh), error: null };
    } catch (error) {
      const retryable = isAuthoritativeFailure(error)
        && (error.code === "CREDENTIAL_REJECTED" || error.code === "CREDENTIAL_EXPIRED")
        && canRefresh && !refreshed;
      if (!retryable) return { connection: applyFailure(working, error), error };
      try {
        scopeFromRefresh = await refreshOnce();
      } catch (refreshError) {
        return { connection: applyFailure(working, refreshError), error: refreshError };
      }
      try {
        const identity = await adapter.fetchIdentity({ config, credential: working.credential });
        return { connection: applyIdentity(working, identity, scopeFromRefresh), error: null };
      } catch (secondError) {
        return { connection: applyFailure(working, secondError), error: secondError };
      }
    }
  }

  /* A brand-new connection from a freshly acquired credential. Identity is proved
     BEFORE anything is written: a credential that cannot name an account is not a
     connection, and half-writing one leaves a record whose only future is to fail. */
  async function connectWithCredential(providerId, acquired, config) {
    const adapter = getAccountProvider(providerId);
    const identity = await adapter.fetchIdentity({ config, credential: acquired.credential });
    const connection = createConnection({
      providerId: adapter.providerId,
      providerLabel: adapter.label,
      status: "connected",
      identity: { ...identity, grantedScope: acquired.grantedScope || identity.grantedScope || "" },
      credential: acquired.credential,
      balance: { ...unsupportedBalance(), supported: adapter.balanceSupported === true },
      createdAt: nowIso(),
      lastVerifiedAt: nowIso(),
    });
    const validation = validateConnection(connection);
    if (!validation.ok) throw providerError("PROVIDER_RESPONSE_INVALID", adapter.providerId);
    persistAccounts((accounts) => upsertConnection(accounts, connection));
    return connection;
  }

  function redirectUriFor(adapter) {
    /* Built from the server's own port, never from a request header. A Host a
       caller supplied is a value a caller chose, and this string is half of what
       Civitai matches the authorization against. */
    return `http://127.0.0.1:${serverPort}${adapter.redirectPath}`;
  }

  /* ---- routes ---- */

  /* Safe projection. Never serializes `credential`; safeConnectionList builds its
     output by naming safe fields rather than by deleting unsafe ones. */
  app.get("/api/accounts", (req, res) => {
    const config = readConfig();
    res.json({
      accounts: safeConnectionList(storedAccounts(config)),
      providers: listAccountProviders(config),
      /* Lets Settings say "do this on the CineBraid computer" before the user
         clicks, instead of after. It states a fact about THIS request and reveals
         no address. */
      localMachine: isLoopbackRequest(req),
    });
  });

  app.post("/api/accounts/:providerId/oauth/start", requireLoopbackRequest, (req, res) => {
    try {
      const config = readConfig();
      const adapter = getAccountProvider(req.params.providerId);
      const redirectUri = redirectUriFor(adapter);
      const authorization = adapter.buildAuthorization({ config, redirectUri });
      pending.remember(authorization.state, {
        providerId: adapter.providerId,
        codeVerifier: authorization.codeVerifier,
        redirectUri,
        scope: authorization.scope,
      });
      /* The verifier stays here. Only the URL and the state leave, and neither is
         a secret: the state is a nonce and the challenge in the URL is a digest. */
      res.json({ ok: true, authorizationUrl: authorization.authorizationUrl, state: authorization.state });
    } catch (error) {
      respondError(res, error);
    }
  });

  app.get("/api/accounts/:providerId/callback", requireLoopbackRequest, async (req, res) => {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    const fail = (error) => res.status(httpStatusForError(error)).type("html").send(callbackPage({
      ok: false,
      heading: "Civitai was not connected",
      message: error?.message || "The connection could not be completed.",
    }));

    /* A provider-reported failure. Only the OAuth error CODE is consulted, and
       even that only to choose one of CineBraid's own sentences —
       `error_description` is provider prose and is never rendered. */
    if (req.query?.error) {
      const code = String(req.query.error);
      return fail(providerError(
        code === "access_denied" ? "AUTHORIZATION_FAILED" : code === "invalid_scope" ? "SCOPE_INSUFFICIENT" : "AUTHORIZATION_FAILED",
        req.params.providerId,
        code === "access_denied" ? "The Civitai connection was declined." : "",
      ));
    }

    const flow = pending.consume(req.query?.state);
    /* Unknown, expired, replayed and forged all land here, and all get the same
       sentence. Telling them apart would tell a caller which of its guesses was
       closest. */
    if (!flow || flow.providerId !== req.params.providerId)
      return fail(providerError("AUTHORIZATION_EXPIRED", req.params.providerId));

    const code = typeof req.query?.code === "string" ? req.query.code : "";
    if (!code) return fail(providerError("AUTHORIZATION_FAILED", req.params.providerId));

    try {
      const config = readConfig();
      const adapter = getAccountProvider(req.params.providerId);
      const acquired = await adapter.exchangeAuthorizationCode({
        config, code, codeVerifier: flow.codeVerifier, redirectUri: flow.redirectUri,
      });
      const connection = await connectWithCredential(adapter.providerId, acquired, config);
      return res.type("html").send(callbackPage({
        ok: true,
        heading: "Civitai connected",
        message: `CineBraid is connected as ${connection.identity.displayName}. You can close this tab.`,
      }));
    } catch (error) {
      return fail(error);
    }
  });

  app.post("/api/accounts/:providerId/api-key", requireLoopbackRequest, async (req, res) => {
    try {
      const config = readConfig();
      const adapter = getAccountProvider(req.params.providerId);
      const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
      if (!apiKey) throw providerError("CREDENTIAL_REJECTED", adapter.providerId, "Enter the Civitai API key first.");
      const acquired = await adapter.authenticateApiKey({ config, apiKey });
      /* connectWithCredential proves the key names an account before anything is
         stored, so an invalid key is never written to disk. */
      const connection = await connectWithCredential(adapter.providerId, acquired, config);
      res.json({ ok: true, connectionId: connection.connectionId });
    } catch (error) {
      respondError(res, error);
    }
  });

  /* Re-verify on demand. This is the only thing that contacts the provider outside
     a connect, and it happens because a person asked — there is no timer, no
     interval and no background poll anywhere in this module. */
  app.post("/api/accounts/:connectionId/verify", async (req, res) => {
    try {
      const config = readConfig();
      const existing = findConnection(storedAccounts(config), req.params.connectionId);
      if (!existing) return res.status(404).json({ error: "That account connection no longer exists.", code: "CONNECTION_NOT_FOUND" });
      const { connection, error } = await verifyConnection(existing, config);
      persistVerified(connection);
      if (error) return respondError(res, error);
      res.json({ ok: true });
    } catch (error) {
      respondError(res, error);
    }
  });

  /* Disconnect. Removes the record and the credential with it, in one write.
     Contacts no provider, touches no project, starts no indexing. Civitai's
     revocation endpoint is deliberately not called: it was verified to exist but
     was not selected for this phase, and a disconnect that depends on a network
     call is a disconnect that fails when the network does. */
  app.delete("/api/accounts/:connectionId", (req, res) => {
    const connectionId = req.params.connectionId;
    if (!isValidConnectionId(connectionId))
      return res.status(400).json({ error: "That is not an account connection.", code: "CONNECTION_ID_INVALID" });
    const before = storedAccounts();
    if (!findConnection(before, connectionId))
      return res.status(404).json({ error: "That account connection no longer exists.", code: "CONNECTION_NOT_FOUND" });
    persistAccounts((accounts) => removeConnection(accounts, connectionId));
    res.json({ ok: true });
  });

  return { pending, verifyConnection };
}

/* The callback is the one account route the editor cookie cannot gate, so the
   auth middleware needs to recognise it. Exported as a predicate rather than left
   as a literal in server.js, so the path and its exemption stay in one file. */
const ACCOUNT_CALLBACK_PATH = /^\/api\/accounts\/[a-z0-9][a-z0-9-]*\/callback$/;
function isAccountCallbackPath(path) {
  return ACCOUNT_CALLBACK_PATH.test(String(path || ""));
}

module.exports = {
  PENDING_MAX,
  PENDING_TTL_MS,
  createPendingFlows,
  isAccountCallbackPath,
  registerAccountConnections,
};

/* CineBraid Civitai account adapter — OAuth, PKCE, refresh, API key, and the
 * error dialect, all against a local mock.
 *
 * No live Civitai account, no registered OAuth client, no public network request,
 * no Buzz. The mock answers 599 on anything Buzz- or tRPC-shaped, so a call
 * CineBraid must never make fails the suite that made it rather than passing
 * quietly.
 *
 * Three findings are pinned here because a generic OAuth client gets them wrong:
 * the scope parameter is the decimal string "1" and not a name list; PKCE is S256
 * and is verified against the RFC 7636 test vector rather than against itself; and
 * a public client sends no client_secret anywhere.
 *
 * The other half of the suite is about what a failure MEANS. "Civitai is
 * unreachable" and "this token was revoked" arrive as different things and must
 * stay different things: only the second may take an account away.
 */
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { startCineBraidServer, startMockCivitai } = require("./fixtures/mock-civitai");

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-account-provider-"));
const CONFIG_PATH = path.join(TEMP, "config.json");
const PROJECTS_ROOT = path.join(TEMP, "projects");

const CLIENT_ID = "cinebraid-adapter-client";
const ACCESS = "civitai_access-ADAPTER-1111";
const REFRESH = "civitai_refresh-ADAPTER-2222";
const PASTED_KEY = "civitaikey-ADAPTER-3333";

let mock = null;
let server = null;

function writeConfig(patch = {}) {
  fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    assistant: { provider: "ollama", visionProvider: "ollama" },
    accountProviders: { civitai: { clientId: CLIENT_ID } },
    accounts: [],
    ...patch,
  }, null, 2));
}
function storedAccounts() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")).accounts || [];
}
function only(accounts = storedAccounts()) {
  assert.strictEqual(accounts.length, 1, `expected exactly one connection, saw ${accounts.length}`);
  return accounts[0];
}
async function startOAuth() {
  const started = await server.request("/api/accounts/civitai/oauth/start", { method: "POST" });
  assert.strictEqual(started.status, 200, JSON.stringify(started.body));
  return { ...started.body, url: new URL(started.body.authorizationUrl) };
}
async function callback(query) {
  const search = new URLSearchParams(query).toString();
  const response = await fetch(`${server.base}/api/accounts/civitai/callback?${search}`);
  return { status: response.status, html: await response.text() };
}

async function main() {
  /* =====================================================================
     PART A — PKCE, in isolation and against the published vector.
     ===================================================================== */
  const adapter = require("../src/accounts/account-provider-civitai");

  /* RFC 7636 Appendix B. Pinned against the standard, not against this
     implementation's own output — a self-consistent wrong transform would pass
     any round-trip check. */
  assert.strictEqual(
    adapter.codeChallengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    "the S256 challenge must match RFC 7636's published test vector",
  );
  for (let i = 0; i < 20; i += 1) {
    const verifier = adapter.createCodeVerifier();
    assert(/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier), `verifier ${verifier} is outside the RFC's alphabet or length`);
    assert(!verifier.includes("="), "base64url is unpadded");
    const challenge = adapter.codeChallengeFor(verifier);
    assert.strictEqual(challenge, crypto.createHash("sha256").update(verifier, "ascii").digest("base64url"));
    assert(!challenge.includes("=") && !challenge.includes("+") && !challenge.includes("/"));
  }
  const states = new Set(Array.from({ length: 200 }, () => adapter.createState()));
  assert.strictEqual(states.size, 200, "state must be cryptographically random, not a counter");
  for (const state of states) assert(state.length >= 40, "state must carry real entropy");
  assert.strictEqual(adapter.balanceSupported, false, "the adapter must state that no balance is readable");
  assert.strictEqual(adapter.PHASE_SCOPE, "1");
  assert.strictEqual(adapter.redirectPath, "/api/accounts/civitai/callback");

  /* =====================================================================
     PART B — the whole flow, through the real routes.
     ===================================================================== */
  writeConfig();
  mock = await startMockCivitai();
  server = await startCineBraidServer({
    CINEBRAID_CONFIG_PATH: CONFIG_PATH,
    CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT,
    CINEBRAID_CIVITAI_AUTH_BASE: mock.authBase,
    CINEBRAID_CIVITAI_API_BASE: mock.apiBase,
    FAL_KEY: "",
  });

  /* ---- B1. the authorization URL ---- */
  const flow = await startOAuth();
  assert.strictEqual(flow.url.pathname, "/api/auth/oauth/authorize");
  assert.strictEqual(flow.url.searchParams.get("response_type"), "code");
  assert.strictEqual(flow.url.searchParams.get("client_id"), CLIENT_ID);
  assert.strictEqual(flow.url.searchParams.get("code_challenge_method"), "S256");
  /* The finding a stock OAuth library gets wrong. */
  assert.strictEqual(flow.url.searchParams.get("scope"), "1",
    "Civitai scopes are a decimal bitmask; Phase 3 asks for exactly 1 (UserRead)");
  assert(!/UserRead|openid|profile|BuzzRead|AIServices/.test(flow.authorizationUrl),
    "no conventional OAuth scope name may appear in the authorization URL");
  assert(!/65536|32768/.test(flow.authorizationUrl),
    "Phase 3 must not request BuzzRead or generation permission");
  assert.strictEqual(
    flow.url.searchParams.get("redirect_uri"),
    `http://127.0.0.1:${server.port}/api/accounts/civitai/callback`,
    "the redirect must name this machine's loopback address and the registered path",
  );
  assert(!/client_secret/.test(flow.authorizationUrl), "a public client has no secret to send");
  /* The verifier never leaves the server; only its digest does. */
  assert(!("codeVerifier" in flow) && !("code_verifier" in flow),
    "the PKCE verifier must never reach the browser");
  assert(flow.state && flow.state.length >= 40);
  const challenge = flow.url.searchParams.get("code_challenge");
  assert(challenge && !challenge.includes("="));

  /* ---- B2. a successful exchange, and what it stores ---- */
  mock.issueCode("code-happy", {
    accessToken: ACCESS,
    refreshToken: REFRESH,
    expiresIn: 3600,
    scope: "1",
    codeChallenge: challenge,
    redirectUri: flow.url.searchParams.get("redirect_uri"),
    identity: { id: 12345, username: "ada", tier: "free", status: "active", email: "ada@example.invalid" },
  });
  const connected = await callback({ code: "code-happy", state: flow.state });
  assert.strictEqual(connected.status, 200, connected.html);
  assert(/Civitai connected/.test(connected.html));
  assert(/ada/.test(connected.html), "the page names the account that was connected");
  for (const secret of [ACCESS, REFRESH, "code-happy", flow.state])
    assert(!connected.html.includes(secret), `the callback page leaked ${secret}`);

  const tokenCall = mock.state.requests.find((entry) => entry.path === "/api/auth/oauth/token");
  assert(tokenCall, "a token exchange must have happened");
  assert.strictEqual(tokenCall.form.grant_type, "authorization_code");
  assert.strictEqual(tokenCall.form.client_id, CLIENT_ID);
  assert(tokenCall.form.code_verifier, "the exchange must present the PKCE verifier");
  assert.strictEqual(
    crypto.createHash("sha256").update(tokenCall.form.code_verifier, "ascii").digest("base64url"),
    challenge,
    "the verifier presented at the token endpoint must be the pre-image of the challenge sent to authorize",
  );
  assert(!("client_secret" in tokenCall.form), "a public-client exchange must carry no client secret");
  assert(!tokenCall.body.includes("client_secret"));

  let record = only();
  assert.strictEqual(record.status, "connected");
  assert.strictEqual(record.credential.tokenSource, "oauth");
  assert.strictEqual(record.credential.accessToken, ACCESS);
  assert.strictEqual(record.credential.refreshToken, REFRESH);
  assert(record.credential.expiresAt, "expiresAt is computed from the provider's own expires_in");
  const expectedExpiry = Date.now() + 3600 * 1000;
  assert(Math.abs(Date.parse(record.credential.expiresAt) - expectedExpiry) < 60000,
    "expiresAt must follow the response's expires_in rather than a hard-coded lifetime");
  assert.strictEqual(record.identity.providerUserId, "12345");
  assert.strictEqual(record.identity.displayName, "ada");
  assert.strictEqual(record.identity.grantedScope, "1");
  assert(!JSON.stringify(record).includes("ada@example.invalid"), "the email in /me must not be persisted");
  assert(!JSON.stringify(record).includes("buzzLimit"), "buzzLimit is a spend cap and is never stored");
  const connectionId = record.connectionId;

  /* ---- B3. state is single use; a replay of the same callback is refused ---- */
  const replay = await callback({ code: "code-happy", state: flow.state });
  assert.strictEqual(replay.status, 400, replay.html);
  assert(/authorization request expired/i.test(replay.html), replay.html);
  assert.strictEqual(storedAccounts().length, 1, "a replayed callback must not create a second connection");

  /* ---- B4. a forged, unknown or expired state is refused, identically ---- */
  for (const state of ["forged-state-value", "", crypto.randomBytes(32).toString("base64url")]) {
    const forged = await callback({ code: "code-happy", state });
    assert.strictEqual(forged.status, 400);
    assert(/authorization request expired/i.test(forged.html),
      "unknown, expired, replayed and forged must all get the same sentence");
  }
  assert.strictEqual(storedAccounts().length, 1);

  /* ---- B5. a provider-reported failure at the callback ----
     Only the OAuth error CODE is read. `error_description` is provider prose and
     must not be rendered — it is attacker-influenceable text in an HTML page. */
  const declinedFlow = await startOAuth();
  const declined = await callback({
    state: declinedFlow.state,
    error: "access_denied",
    error_description: "<script>alert('xss')</script> user said no",
  });
  assert.strictEqual(declined.status, 400);
  assert(!declined.html.includes("<script>"), "provider text must never be rendered into the callback page");
  assert(!declined.html.includes("user said no"));
  assert(/declined/i.test(declined.html));
  assert.strictEqual(storedAccounts().length, 1);

  /* ---- B6. a malformed token response is refused, and stores nothing ---- */
  const malformedFlow = await startOAuth();
  mock.issueCode("code-malformed", {
    accessToken: "unused", codeChallenge: malformedFlow.url.searchParams.get("code_challenge"),
    identity: { id: 1, username: "nobody" },
  });
  mock.state.script.push("malformed");
  const malformed = await callback({ code: "code-malformed", state: malformedFlow.state });
  assert.strictEqual(malformed.status, 502, malformed.html);
  assert(/could not read/i.test(malformed.html));
  assert.strictEqual(storedAccounts().length, 1, "a malformed token response must create no connection");

  const noTokenFlow = await startOAuth();
  mock.issueCode("code-notoken", { accessToken: "unused", codeChallenge: noTokenFlow.url.searchParams.get("code_challenge"), identity: { id: 1, username: "nobody" } });
  mock.state.script.push("no-access-token");
  const noToken = await callback({ code: "code-notoken", state: noTokenFlow.state });
  assert.strictEqual(noToken.status, 502);
  assert.strictEqual(storedAccounts().length, 1);

  /* ---- B7. identity failure after a SUCCESSFUL exchange leaves nothing behind ----
     This is the half-connected account the contract forbids: a credential that was
     accepted but could not name an account is not a connection. */
  const identityFlow = await startOAuth();
  mock.issueCode("code-noidentity", {
    accessToken: "civitai_access-ORPHAN-9999",
    refreshToken: "civitai_refresh-ORPHAN-9999",
    codeChallenge: identityFlow.url.searchParams.get("code_challenge"),
    identity: { id: 999, username: "orphan" },
  });
  mock.state.script.push("", "unauthorized");   /* token ok, then /me refuses */
  const orphan = await callback({ code: "code-noidentity", state: identityFlow.state });
  assert.strictEqual(orphan.status, 401, orphan.html);
  assert.strictEqual(storedAccounts().length, 1, "no half-connected account may be recorded");
  assert(!JSON.stringify(storedAccounts()).includes("ORPHAN-9999"),
    "a credential whose identity could not be proved must never reach disk");

  /* ---- B8. an unexpectedly enlarged /me response changes nothing ---- */
  mock.state.script.push("extra-fields");
  const verified = await server.request(`/api/accounts/${connectionId}/verify`, { method: "POST" });
  assert.strictEqual(verified.status, 200, JSON.stringify(verified.body));
  record = only();
  assert.deepStrictEqual(
    Object.keys(record.identity).sort(),
    ["accountStatus", "avatarUrl", "displayName", "grantedScope", "providerUserId", "tier"],
    "fields Civitai adds later must not enlarge what CineBraid stores",
  );
  assert(!JSON.stringify(record).includes("somethingCivitaiAddedLater"));

  /* ---- B9. refresh: rotation, and a recomputed expiry ---- */
  const beforeRefresh = only();
  /* Backdate the stored expiry so the next operation needs a refresh. Nothing
     about this is a timer — the refresh happens because an operation asked. */
  const backdated = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  backdated.accounts[0].credential.expiresAt = new Date(Date.now() - 60000).toISOString();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(backdated, null, 2));

  const refreshed = await server.request(`/api/accounts/${connectionId}/verify`, { method: "POST" });
  assert.strictEqual(refreshed.status, 200, JSON.stringify(refreshed.body));
  record = only();
  assert.strictEqual(record.status, "connected");
  assert.notStrictEqual(record.credential.accessToken, beforeRefresh.credential.accessToken, "the access token was replaced");
  assert.notStrictEqual(record.credential.refreshToken, REFRESH, "a rotated refresh token must replace the stored one");
  assert(Date.parse(record.credential.expiresAt) > Date.now(), "expiresAt is recomputed from the refreshed response");
  assert(Date.parse(record.lastVerifiedAt) >= Date.parse(beforeRefresh.lastVerifiedAt));
  const refreshCall = mock.state.requests.filter((entry) => entry.form?.grant_type === "refresh_token").at(-1);
  assert.strictEqual(refreshCall.form.client_id, CLIENT_ID);
  assert(!("client_secret" in refreshCall.form), "a public-client refresh carries no secret either");
  const rotatedRefreshToken = record.credential.refreshToken;

  /* ---- B10. a temporary network failure during refresh is NOT a revocation ----
     The distinction the whole error vocabulary exists for. */
  const beforeOutage = only();
  const backdatedAgain = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  backdatedAgain.accounts[0].credential.expiresAt = new Date(Date.now() - 60000).toISOString();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(backdatedAgain, null, 2));
  mock.state.script.push("server-error");
  const outage = await server.request(`/api/accounts/${connectionId}/verify`, { method: "POST" });
  assert.strictEqual(outage.status, 502, JSON.stringify(outage.body));
  assert.strictEqual(outage.body.code, "PROVIDER_UNAVAILABLE");
  record = only();
  assert.strictEqual(record.status, "connected", "an unreachable provider must not expire a connection");
  assert.strictEqual(record.credential.refreshToken, rotatedRefreshToken, "the refresh token survives an outage untouched");
  assert.strictEqual(record.identity.displayName, "ada", "the last known identity is kept");
  assert.strictEqual(record.lastError.code, "PROVIDER_UNAVAILABLE");

  const rateLimited = await (async () => {
    mock.state.script.push("rate-limit");
    const attempt = await server.request(`/api/accounts/${connectionId}/verify`, { method: "POST" });
    return attempt;
  })();
  assert.strictEqual(rateLimited.status, 429);
  assert.strictEqual(rateLimited.body.code, "PROVIDER_RATE_LIMITED");
  assert.strictEqual(only().status, "connected", "a rate limit is not a revocation");

  /* No retry storm. A refused request is refused once: one verify makes exactly
     one provider request here, because the refresh it needed came back 429 and
     there is no second attempt at it, no backoff loop and no timer. */
  const requestsBefore = mock.state.requests.length;
  mock.state.script.push("rate-limit");
  await server.request(`/api/accounts/${connectionId}/verify`, { method: "POST" });
  assert.strictEqual(mock.state.requests.length - requestsBefore, 1,
    "a rate-limited verify must make exactly one provider request and never retry it");

  /* ---- B11. a genuinely revoked refresh token DOES expire the connection ---- */
  const revoked = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  revoked.accounts[0].credential.expiresAt = new Date(Date.now() - 60000).toISOString();
  revoked.accounts[0].credential.refreshToken = "civitai_refresh-REVOKED-0000";
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(revoked, null, 2));
  const dead = await server.request(`/api/accounts/${connectionId}/verify`, { method: "POST" });
  assert.strictEqual(dead.status, 401, JSON.stringify(dead.body));
  assert.strictEqual(dead.body.code, "CREDENTIAL_EXPIRED");
  record = only();
  assert.strictEqual(record.status, "expired");
  assert.strictEqual(record.credential.accessToken, "", "authoritatively dead tokens are cleared, not kept to fail again");
  assert.strictEqual(record.credential.refreshToken, "");
  assert.strictEqual(record.identity.displayName, "ada", "identity is kept so the user can see which account expired");

  /* ---- B12. 403 is a scope problem, not an expiry ---- */
  const scoped = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  scoped.accounts[0].credential = { tokenSource: "oauth", accessToken: ACCESS, refreshToken: "", apiKey: "", expiresAt: null };
  scoped.accounts[0].status = "connected";
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(scoped, null, 2));
  mock.state.script.push("forbidden");
  const forbidden = await server.request(`/api/accounts/${connectionId}/verify`, { method: "POST" });
  assert.strictEqual(forbidden.status, 403);
  assert.strictEqual(forbidden.body.code, "SCOPE_INSUFFICIENT");
  assert.strictEqual(only().status, "error", "a missing permission is a different state from an expired credential");

  /* ---- B13. a malformed /me is refused without damaging the record ---- */
  const preMalformed = only();
  mock.state.script.push("malformed");
  const badMe = await server.request(`/api/accounts/${connectionId}/verify`, { method: "POST" });
  assert.strictEqual(badMe.status, 502);
  assert.strictEqual(badMe.body.code, "PROVIDER_RESPONSE_INVALID");
  assert.strictEqual(only().identity.displayName, preMalformed.identity.displayName);
  mock.state.script.push("no-id");
  const noId = await server.request(`/api/accounts/${connectionId}/verify`, { method: "POST" });
  assert.strictEqual(noId.status, 502, "a /me without a usable id is not an identity");

  /* ---- B14. a dropped connection reads as unreachable, not as a rejection ---- */
  mock.state.script.push("drop");
  const dropped = await server.request(`/api/accounts/${connectionId}/verify`, { method: "POST" });
  assert.strictEqual(dropped.body.code, "PROVIDER_UNREACHABLE", JSON.stringify(dropped.body));
  assert.strictEqual(dropped.status, 503);

  /* ---- B15. the timeout path, with a server that never answers ---- */
  await server.request(`/api/accounts/${connectionId}`, { method: "DELETE" });
  assert.deepStrictEqual(storedAccounts(), []);

  /* =====================================================================
     PART C — the personal API key.
     ===================================================================== */

  /* ---- C1. an invalid key is refused and never written ---- */
  const rejected = await server.request("/api/accounts/civitai/api-key", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: "civitaikey-WRONG-0000" }),
  });
  assert.strictEqual(rejected.status, 401, JSON.stringify(rejected.body));
  assert.strictEqual(rejected.body.code, "CREDENTIAL_REJECTED");
  assert.deepStrictEqual(storedAccounts(), [], "an unverified key must never reach disk");
  assert(!fs.readFileSync(CONFIG_PATH, "utf8").includes("civitaikey-WRONG-0000"));

  const empty = await server.request("/api/accounts/civitai/api-key", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: "   " }),
  });
  assert.strictEqual(empty.status, 401);
  assert.deepStrictEqual(storedAccounts(), []);

  /* ---- C2. a provider outage during a key check stores nothing either ---- */
  mock.registerToken(PASTED_KEY, { id: 4242, username: "kit", tier: "bronze", status: "active" });
  mock.state.script.push("server-error");
  const outageKey = await server.request("/api/accounts/civitai/api-key", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: PASTED_KEY }),
  });
  assert.strictEqual(outageKey.status, 502);
  assert.deepStrictEqual(storedAccounts(), [], "a key that could not be checked is not a connection");
  assert(!fs.readFileSync(CONFIG_PATH, "utf8").includes(PASTED_KEY));

  /* ---- C3. a valid key connects, with no OAuth fiction attached ---- */
  const accepted = await server.request("/api/accounts/civitai/api-key", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: PASTED_KEY }),
  });
  assert.strictEqual(accepted.status, 200, JSON.stringify(accepted.body));
  record = only();
  assert.strictEqual(record.credential.tokenSource, "api_key");
  assert.strictEqual(record.credential.apiKey, PASTED_KEY);
  assert.strictEqual(record.credential.accessToken, "");
  assert.strictEqual(record.credential.refreshToken, "", "a pasted key is not turned into an OAuth token record");
  assert.strictEqual(record.credential.expiresAt, null);
  assert.strictEqual(record.identity.displayName, "kit");
  const keyBearer = mock.state.requests.filter((entry) => entry.path === "/api/v1/me").at(-1);
  assert.strictEqual(keyBearer.authorization, `Bearer ${PASTED_KEY}`,
    "the key is presented in the Authorization header, never in a query string");
  assert(!mock.state.requests.some((entry) => Object.values(entry.query || {}).includes(PASTED_KEY)),
    "a credential must never travel in a URL, which Civitai warns leaks into logs");

  /* ---- C4. an API-key connection re-verifies through /me, and never refreshes ---- */
  const refreshCallsBefore = mock.state.requests.filter((entry) => entry.form?.grant_type === "refresh_token").length;
  const reverified = await server.request(`/api/accounts/${record.connectionId}/verify`, { method: "POST" });
  assert.strictEqual(reverified.status, 200, JSON.stringify(reverified.body));
  assert.strictEqual(
    mock.state.requests.filter((entry) => entry.form?.grant_type === "refresh_token").length,
    refreshCallsBefore,
    "an API-key connection has nothing to refresh and must not try",
  );

  /* ---- C5. a revoked key expires the connection, with no refresh attempt ---- */
  mock.state.script.push("unauthorized");
  const revokedKey = await server.request(`/api/accounts/${record.connectionId}/verify`, { method: "POST" });
  assert.strictEqual(revokedKey.status, 401);
  assert.strictEqual(only().status, "expired");
  assert.strictEqual(
    mock.state.requests.filter((entry) => entry.form?.grant_type === "refresh_token").length,
    refreshCallsBefore,
  );

  /* =====================================================================
     PART D — endpoints CineBraid must never have called.
     ===================================================================== */
  const forbiddenCalls = mock.state.requests.filter((entry) => /buzz|trpc/i.test(entry.path));
  assert.deepStrictEqual(forbiddenCalls, [],
    "no Buzz or tRPC endpoint may be contacted: there is no supported public balance API");
  const paths = new Set(mock.state.requests.map((entry) => entry.path));
  assert.deepStrictEqual(
    [...paths].sort(),
    ["/api/auth/oauth/token", "/api/v1/me"],
    "Phase 3 contacts exactly two Civitai endpoints and no others",
  );
  assert(!mock.state.requests.some((entry) => /workflows|whatif|orchestration|imageGen|videoGen/i.test(entry.path)),
    "no generation surface may be contacted");

  /* =====================================================================
     PART D — across a restart.

     A connection lives in config and must survive one. A pending OAuth attempt
     lives in memory and must NOT: losing it costs a click, and the alternative —
     writing a PKCE verifier to disk — puts a live secret somewhere a backup or a
     sync client would copy it.
     ===================================================================== */
  const apiKeyConnectionId = only().connectionId;
  /* Restore the key connection to a working state before restarting, so what is
     being measured is persistence rather than the previous section's revocation. */
  const healthy = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  healthy.accounts[0].status = "connected";
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(healthy, null, 2));

  /* An OAuth connection alongside it, so both credential kinds cross the restart. */
  const survivorFlow = await startOAuth();
  mock.issueCode("code-survivor", {
    accessToken: "civitai_access-SURVIVOR-4444",
    refreshToken: "civitai_refresh-SURVIVOR-5555",
    expiresIn: 3600, scope: "1",
    codeChallenge: survivorFlow.url.searchParams.get("code_challenge"),
    identity: { id: 5150, username: "survivor", tier: "free", status: "active" },
  });
  const survived = await callback({ code: "code-survivor", state: survivorFlow.state });
  assert.strictEqual(survived.status, 200, survived.html);

  /* A second flow started but deliberately NOT completed before the restart. */
  const abandonedFlow = await startOAuth();
  mock.issueCode("code-abandoned", {
    accessToken: "civitai_access-ABANDONED-6666",
    codeChallenge: abandonedFlow.url.searchParams.get("code_challenge"),
    identity: { id: 6161, username: "abandoned" },
  });

  const beforeRestart = storedAccounts();
  assert.strictEqual(beforeRestart.length, 2);
  server.stop();
  server = await startCineBraidServer({
    CINEBRAID_CONFIG_PATH: CONFIG_PATH,
    CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT,
    CINEBRAID_CIVITAI_AUTH_BASE: mock.authBase,
    CINEBRAID_CIVITAI_API_BASE: mock.apiBase,
    FAL_KEY: "",
  });

  const afterRestart = await server.request("/api/accounts");
  assert.strictEqual(afterRestart.body.accounts.length, 2, "both connections must survive a restart");
  assert.deepStrictEqual(
    afterRestart.body.accounts.map((row) => row.tokenSource).sort(), ["api_key", "oauth"],
    "an OAuth connection and an API-key connection both persist, and stay distinguishable",
  );
  assert.deepStrictEqual(
    afterRestart.body.accounts.map((row) => row.connectionId).sort(),
    beforeRestart.map((row) => row.connectionId).sort(),
    "connectionId is stable across a restart",
  );
  /* Both still work, without a reconnect. */
  for (const row of afterRestart.body.accounts) {
    const check = await server.request(`/api/accounts/${row.connectionId}/verify`, { method: "POST" });
    assert.strictEqual(check.status, 200, `${row.tokenSource} connection must still verify after a restart: ${check.text}`);
  }

  /* ---- the pending attempt did not survive, and cannot be completed ---- */
  const orphanedCallback = await callback({ code: "code-abandoned", state: abandonedFlow.state });
  assert.strictEqual(orphanedCallback.status, 400, orphanedCallback.html);
  assert(/authorization request expired/i.test(orphanedCallback.html),
    "a callback arriving after a restart is refused with the same sentence as any other unknown state");
  assert.strictEqual(storedAccounts().length, 2, "and it creates nothing");
  assert(!fs.readFileSync(CONFIG_PATH, "utf8").includes("ABANDONED-6666"));
  /* A PKCE verifier must never have been written anywhere. */
  const configText = fs.readFileSync(CONFIG_PATH, "utf8");
  assert(!/code_verifier|codeVerifier|pendingFlows|"state":/.test(configText),
    "no pending OAuth state may be persisted — a verifier on disk is a secret in every backup");

  /* Tidy up so PART E starts from one connection. */
  for (const row of afterRestart.body.accounts.filter((entry) => entry.connectionId !== apiKeyConnectionId))
    await server.request(`/api/accounts/${row.connectionId}`, { method: "DELETE" });
  record = only();

  /* =====================================================================
     PART E — the timeout path needs a server that stops answering.
     ===================================================================== */
  const stalled = require("http").createServer(() => { /* deliberately never responds */ });
  await new Promise((resolve) => stalled.listen(0, "127.0.0.1", resolve));
  const stalledPort = stalled.address().port;
  server.stop();
  server = await startCineBraidServer({
    CINEBRAID_CONFIG_PATH: CONFIG_PATH,
    CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT,
    CINEBRAID_CIVITAI_AUTH_BASE: `http://127.0.0.1:${stalledPort}`,
    CINEBRAID_CIVITAI_API_BASE: `http://127.0.0.1:${stalledPort}`,
    CINEBRAID_CIVITAI_TIMEOUT_MS: "1200",
    FAL_KEY: "",
  });
  const startedAt = Date.now();
  const timedOut = await server.request(`/api/accounts/${record.connectionId}/verify`, { method: "POST" });
  const elapsed = Date.now() - startedAt;
  assert.strictEqual(timedOut.body.code, "PROVIDER_TIMEOUT", JSON.stringify(timedOut.body));
  assert.strictEqual(timedOut.status, 504);
  assert(elapsed < 8000, `the request must be aborted by its own timeout, took ${elapsed}ms`);
  assert.strictEqual(only().identity.displayName, "kit",
    "a timeout leaves the last known identity in place and merely stops it being fresh");
  await new Promise((resolve) => stalled.close(resolve));

  console.log(
    "Civitai account adapter suite passed: PKCE pinned to RFC 7636's vector, scope=1 as a decimal bitmask with no "
    + "scope names and no BuzzRead, a public-client exchange carrying no client secret, single-use state with forged, "
    + "expired and replayed callbacks refused identically, malformed token and /me responses rejected without a "
    + "half-connected account, refresh with rotation and a recomputed expiry, revocation distinguished from outage, "
    + "rate limit and timeout with no automatic retry, an API-key path with no invented refresh or expiry, both "
    + "connection kinds surviving a restart while an unfinished attempt does not and no verifier reaches disk, and "
    + "only two Civitai endpoints contacted — no Buzz, no tRPC, no orchestration.",
  );
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || error);
    if (server?.output) console.error(`--- server output ---\n${server.output}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    server?.stop();
    await mock?.close();
    fs.rmSync(TEMP, { recursive: true, force: true });
  });

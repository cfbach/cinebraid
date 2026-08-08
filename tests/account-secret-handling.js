/* CineBraid account credentials — the secret registry, and where a token may not go.
 *
 * Phase 0 built the registry's wildcard path grammar for exactly this case and
 * proved it against a synthetic `accounts[*].credential.*` shape. This suite is
 * that proof made real: the declarations exist, they are the ONLY mechanism (no
 * second mask list was written), and the credentials they cover cannot be read
 * out of, or written into, any surface a browser can reach.
 *
 * Two registry decisions are asserted rather than assumed:
 *
 *   OAuth tokens are `omit`, not `masked`. The browser never sees one and never
 *   sets one, so even four characters of a live token is four characters too many.
 *   A personal API key is `masked`, because it is the one credential a user pastes
 *   by hand and may want to confirm.
 *
 * And the gap the preflight named: a config PUT that ADDS an account the server
 * has never seen, carrying a mask marker where the credential goes, must be
 * refused — not stored with an empty credential that looks configured and can only
 * ever fail.
 *
 * Every canary below is grepped for across responses, disk, and the server's whole
 * captured output. None is shaped like a real credential, so scripts/scan-secrets.js
 * needs no suppression for this file.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { startCineBraidServer, startMockCivitai } = require("./fixtures/mock-civitai");
const { CONFIG_SECRETS, MASK_PREFIX, maskSecrets, restoreSecrets } = require("../config");

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-account-secrets-"));
const CONFIG_PATH = path.join(TEMP, "config.json");
const PROJECTS_ROOT = path.join(TEMP, "projects");

const CLIENT_ID = "cinebraid-secret-client";
const ACCESS = "civitaiaccess-MUSTNEVERLEAK-1111";
const REFRESH = "civitairefresh-MUSTNEVERLEAK-2222";
const PASTED_KEY = "civitaikey-MUSTNEVERLEAK-3333";
const OPENAI_KEY = "openai-MUSTNEVERLEAK-4444";
const ALL_SECRETS = [ACCESS, REFRESH, PASTED_KEY, OPENAI_KEY];

let mock = null;
let server = null;

/* A real project, so the surfaces that only answer when one is open — the agent
   status a Settings page reads, the project list — are genuinely exercised rather
   than skipped as 500s. */
function writeConfig(patch = {}) {
  const projectDir = path.join(PROJECTS_ROOT, "secret-project");
  fs.mkdirSync(path.join(projectDir, "shots"), { recursive: true });
  for (const dir of ["anchors", "plates", "props", "vehicles", "audio", "media", "docs"])
    fs.mkdirSync(path.join(projectDir, dir), { recursive: true });
  fs.writeFileSync(path.join(projectDir, "project.json"), JSON.stringify({
    meta: { title: "Account Secrets", format: "Test", version: "v1", hubVersion: "v6.0.0", schemaVersion: "6.6", aiPolicy: "project-default" },
    qcChecklist: [],
    characters: [], locations: [], props: [], vehicles: [], audio: [], mediaAssets: [],
    scenes: [], shots: [], agentRuns: [], decisions: [], sessions: [], finishJobs: [],
  }, null, 2));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    activeProject: "secret-project",
    assistant: { provider: "ollama", visionProvider: "ollama" },
    openaiKey: OPENAI_KEY,
    accountProviders: { civitai: { clientId: CLIENT_ID } },
    accounts: [],
    ...patch,
  }, null, 2));
}
function onDisk() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}
function assertNoSecretIn(label, payload) {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
  for (const secret of ALL_SECRETS)
    assert(!raw.includes(secret), `${label} must not contain the raw secret ${secret}`);
}

async function main() {
  /* =====================================================================
     PART A — the registry itself, with no server.
     ===================================================================== */

  /* ---- A1. the declarations exist, in the modes the design chose ---- */
  const declared = new Map(CONFIG_SECRETS.map((secret) => [secret.path, secret]));
  for (const [declaredPath, mode] of [
    ["accounts[*].credential.accessToken", "omit"],
    ["accounts[*].credential.refreshToken", "omit"],
    ["accounts[*].credential.apiKey", "masked"],
  ]) {
    const secret = declared.get(declaredPath);
    assert(secret, `${declaredPath} must be declared in CONFIG_SECRETS`);
    assert.strictEqual(secret.mode, mode, `${declaredPath} must be declared ${mode}`);
    assert.strictEqual(secret.identity, "connectionId",
      "account elements are correlated by connectionId, never by position in the array");
  }

  /* ---- A2. masking, across several connections, correlated by identity ---- */
  const stored = {
    accounts: [
      { connectionId: "conn-" + "a".repeat(32), providerId: "civitai", credential: { tokenSource: "oauth", accessToken: ACCESS, refreshToken: REFRESH, apiKey: "" } },
      { connectionId: "conn-" + "b".repeat(32), providerId: "civitai", credential: { tokenSource: "api_key", accessToken: "", refreshToken: "", apiKey: PASTED_KEY } },
    ],
  };
  const masked = maskSecrets(stored);
  assertNoSecretIn("maskSecrets output", masked);
  assert(!("accessToken" in masked.accounts[0].credential), "an omitted secret is removed, not blanked");
  assert(!("refreshToken" in masked.accounts[0].credential));
  assert.strictEqual(masked.accounts[1].credential.apiKey, `${MASK_PREFIX}3333`);
  assert.strictEqual(masked.accounts[0].providerId, "civitai", "non-secret siblings are untouched");

  /* ---- A3. a round trip restores, even reordered ---- */
  const reordered = { accounts: [masked.accounts[1], masked.accounts[0]] };
  const restored = restoreSecrets(reordered, stored);
  assert.strictEqual(restored.accounts[0].credential.apiKey, PASTED_KEY,
    "correlation is by connectionId, so a reordered array still restores the right secret");
  assert(!("accessToken" in restored.accounts[1].credential),
    "an omit-mode secret is never accepted from a patch, in either direction");

  /* ---- A4. a mask marker can never become a real credential ---- */
  const attack = {
    accounts: [
      { connectionId: stored.accounts[1].connectionId, credential: { apiKey: `${MASK_PREFIX}3333` } },
    ],
  };
  assert.strictEqual(restoreSecrets(attack, stored).accounts[0].credential.apiKey, PASTED_KEY,
    "a returned marker means 'keep what is stored', never 'the credential is now this literal'");
  const forged = {
    accounts: [
      { connectionId: "conn-" + "c".repeat(32), credential: { apiKey: `${MASK_PREFIX}9999`, accessToken: "attacker-chosen" } },
    ],
  };
  const forgedResult = restoreSecrets(forged, stored);
  assert.strictEqual(forgedResult.accounts[0].credential.apiKey, "",
    "a marker for an account that was never stored resolves to nothing, never to a credential");
  assert(!("accessToken" in forgedResult.accounts[0].credential),
    "an omit-mode field cannot be introduced by a patch at all");

  /* ---- A5. secrecy comes from the registry, and there is only one of them ----
     A second mask list would be the exact defect the registry was built to end. */
  const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const accountsSource = fs.readFileSync(path.join(__dirname, "..", "accounts-api.js"), "utf8");
  for (const [label, source] of [["server.js", serverSource], ["accounts-api.js", accountsSource]]) {
    assert(!/MASK_PREFIX|••••/.test(source.replace(/\/\*[\s\S]*?\*\//g, "")),
      `${label} must not hand-roll masking — CONFIG_SECRETS is the only mechanism`);
  }
  assert(!/delete\s+\w*\.credential\b/.test(accountsSource),
    "the browser projection must be built by naming safe fields, not by deleting credential");

  /* =====================================================================
     PART B — the real routes, on a real server, with a real connection.
     ===================================================================== */
  writeConfig();
  mock = await startMockCivitai();
  mock.registerToken(PASTED_KEY, { id: 4242, username: "kit", tier: "bronze", status: "active" });
  server = await startCineBraidServer({
    CINEBRAID_CONFIG_PATH: CONFIG_PATH,
    CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT,
    CINEBRAID_CIVITAI_AUTH_BASE: mock.authBase,
    CINEBRAID_CIVITAI_API_BASE: mock.apiBase,
    FAL_KEY: "",
  });

  /* Connect by OAuth so an access AND a refresh token are on disk, then by key so
     all three credential kinds are present at once. */
  const flow = await server.request("/api/accounts/civitai/oauth/start", { method: "POST" });
  const challenge = new URL(flow.body.authorizationUrl).searchParams.get("code_challenge");
  mock.issueCode("code-secret", {
    accessToken: ACCESS, refreshToken: REFRESH, expiresIn: 3600, scope: "1", codeChallenge: challenge,
    identity: { id: 12345, username: "ada", tier: "free", status: "active" },
  });
  const callback = await fetch(`${server.base}/api/accounts/civitai/callback?code=code-secret&state=${encodeURIComponent(flow.body.state)}`);
  const callbackHtml = await callback.text();
  assert.strictEqual(callback.status, 200, callbackHtml);
  assertNoSecretIn("the OAuth callback page", callbackHtml);
  assert(!callbackHtml.includes("code-secret"), "the authorization code must not be echoed into the page");

  const keyed = await server.request("/api/accounts/civitai/api-key", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: PASTED_KEY }),
  });
  assert.strictEqual(keyed.status, 200, JSON.stringify(keyed.body));

  const diskBefore = onDisk();
  assert.strictEqual(diskBefore.accounts.length, 2);
  assert.strictEqual(diskBefore.accounts[0].credential.accessToken, ACCESS, "the credential really is stored server-side");
  assert.strictEqual(diskBefore.accounts[1].credential.apiKey, PASTED_KEY);

  /* ---- B1. no browser-reachable surface carries a raw credential ---- */
  for (const route of ["/api/config", "/api/accounts", "/api/system/health", "/api/agents/status", "/api/me", "/api/projects"]) {
    const payload = await server.request(route);
    assertNoSecretIn(`GET ${route}`, payload.text);
  }

  /* ---- B1b. a support bundle cannot reach a credential at all ----
     Diagnostics are built from automation runs and project data. The module that
     builds them is handed a project reader and nothing else — no config reader —
     so there is no path from a stored credential into a support export. Asserted
     structurally as well as live, because an empty bundle proves nothing. */
  const diagnosticSource = fs.readFileSync(path.join(__dirname, "..", "automation-runs.js"), "utf8");
  assert(!/\breadConfig\b/.test(diagnosticSource),
    "automation-runs.js builds the support bundle and must have no way to read configuration");
  const registrar = /registerAutomationRuns\(app, \{[^}]*\}\)/.exec(
    fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8"),
  );
  assert(registrar, "the diagnostics registrar call must be findable");
  assert(!/readConfig|writeConfig/.test(registrar[0]),
    "the diagnostics registrar must not be handed a configuration reader");
  for (const route of ["/api/test-feedback", "/api/automation/reports/summary", "/api/automation/runs"]) {
    const payload = await server.request(route);
    assertNoSecretIn(`GET ${route}`, payload.text);
  }

  /* And specifically: the account projection carries no credential object at all. */
  const projection = await server.request("/api/accounts");
  for (const row of projection.body.accounts) {
    assert(!("credential" in row), "a projected connection must not carry credential");
    assert(!("grantedScope" in row.identity), "the scope bitmask is internal and is not shown");
    assert.strictEqual(row.balance.supported, false);
    assert(!("amount" in row.balance), "no fabricated balance amount");
  }
  assert(!projection.text.includes("civitai.com"), "provider addresses are adapter-internal and stay out of status");
  assert(!projection.text.includes("auth.civitai"));

  /* ---- B2. GET /api/config: tokens removed, key masked ---- */
  const config = await server.request("/api/config");
  assertNoSecretIn("GET /api/config", config.text);
  const oauthRow = config.body.accounts.find((row) => row.credential.tokenSource === "oauth");
  const keyRow = config.body.accounts.find((row) => row.credential.tokenSource === "api_key");
  assert(!("accessToken" in oauthRow.credential), "an OAuth access token is omitted entirely");
  assert(!("refreshToken" in oauthRow.credential));
  assert.strictEqual(keyRow.credential.apiKey, `${MASK_PREFIX}3333`);
  assert.strictEqual(config.body.accountProviders.civitai.clientId, CLIENT_ID,
    "a client id is public and must stay readable — masking it would only hide it from its owner");

  /* ---- B3. a GET → PUT round trip disturbs nothing ---- */
  const echoed = { ...config.body };
  delete echoed.workspace;
  const roundTrip = await server.request("/api/config", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(echoed),
  });
  assert.strictEqual(roundTrip.status, 200, JSON.stringify(roundTrip.body));
  let after = onDisk();
  assert.strictEqual(after.accounts.length, 2, "a round trip must not drop a connection");
  assert.strictEqual(after.accounts[0].credential.accessToken, ACCESS,
    "an omitted token must survive a round trip — this is where a wholesale array merge would have blanked it");
  assert.strictEqual(after.accounts[0].credential.refreshToken, REFRESH);
  assert.strictEqual(after.accounts[1].credential.apiKey, PASTED_KEY);
  assert.strictEqual(after.openaiKey, OPENAI_KEY);

  /* ---- B4. the preflight's G1 gap: a NEW account with a placeholder is refused ---- */
  const invented = await server.request("/api/config", {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      accounts: [{
        connectionId: "conn-" + "f".repeat(32), providerId: "civitai", status: "connected",
        credential: { tokenSource: "api_key", apiKey: `${MASK_PREFIX}9999` },
      }],
    }),
  });
  assert.strictEqual(invented.status, 400, JSON.stringify(invented.body));
  assert.strictEqual(invented.body.code, "ACCOUNT_ENDPOINT_REQUIRED");
  after = onDisk();
  assert.strictEqual(after.accounts.length, 2, "a config PUT must not be able to invent a connection");
  assert(!after.accounts.some((row) => row.connectionId.startsWith("conn-ff")));

  /* ---- B5. nor may a config PUT delete, blank or overwrite a credential ---- */
  for (const attempt of [
    { accounts: [] },
    { accounts: [{ ...after.accounts[0], credential: { ...after.accounts[0].credential, accessToken: "attacker-chosen" } }] },
    { accounts: [{ ...after.accounts[1], credential: { tokenSource: "api_key", apiKey: "" } }] },
  ]) {
    const refused = await server.request("/api/config", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(attempt),
    });
    assert.strictEqual(refused.status, 400, `a config PUT must not change accounts: ${JSON.stringify(attempt)}`);
    assert.strictEqual(refused.body.code, "ACCOUNT_ENDPOINT_REQUIRED");
  }
  after = onDisk();
  assert.strictEqual(after.accounts.length, 2);
  assert.strictEqual(after.accounts[0].credential.accessToken, ACCESS);
  assert.strictEqual(after.accounts[1].credential.apiKey, PASTED_KEY);

  /* An unrelated config change still works, and erases nothing. */
  const unrelated = await server.request("/api/config", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ollamaModel: "changed-model" }),
  });
  assert.strictEqual(unrelated.status, 200, JSON.stringify(unrelated.body));
  after = onDisk();
  assert.strictEqual(after.ollamaModel, "changed-model");
  assert.strictEqual(after.accounts[0].credential.accessToken, ACCESS);
  assert.strictEqual(after.openaiKey, OPENAI_KEY);

  /* ---- B6. error responses carry the CineBraid sentence, never the credential ---- */
  const badKey = await server.request("/api/accounts/civitai/api-key", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey: "civitaikey-WRONGVALUE-8888" }),
  });
  assert.strictEqual(badKey.status, 401);
  assert(!badKey.text.includes("civitaikey-WRONGVALUE-8888"),
    "a rejected credential must not be echoed back in the refusal");
  assert(!/civitai\.com|127\.0\.0\.1:\d+|Bearer/.test(badKey.text),
    "an error must not disclose the provider address or the header CineBraid sent");

  const unknownProvider = await server.request("/api/accounts/nosuchprovider/oauth/start", { method: "POST" });
  assert.strictEqual(unknownProvider.status, 400);
  assert(!/at \w+ \(|\.js:\d+/.test(unknownProvider.text), "no stack trace may reach a browser");

  /* ---- B7. disconnect erases the credential from disk ---- */
  const removed = projection.body.accounts.find((row) => row.tokenSource === "api_key");
  const disconnect = await server.request(`/api/accounts/${removed.connectionId}`, { method: "DELETE" });
  assert.strictEqual(disconnect.status, 200);
  const afterDisconnect = fs.readFileSync(CONFIG_PATH, "utf8");
  assert(!afterDisconnect.includes(PASTED_KEY), "disconnecting must remove the stored credential, not merely the row");
  assert(afterDisconnect.includes(ACCESS), "the other connection's credential is untouched");

  /* ---- B8. nothing reached the server's output, across the whole session ---- */
  assertNoSecretIn("the CineBraid server's stdout and stderr", server.output);
  assert(!server.output.includes("code-secret"), "an authorization code must never be logged");
  assert(!/Bearer\s+civitai/.test(server.output));

  console.log(
    "Account secret handling suite passed: OAuth tokens declared omit and API keys masked through the one registry, "
    + "wildcard masking and identity-correlated restoration across a reordered array, a mask marker that can never "
    + "become a credential or invent an account, a GET→PUT round trip that leaves every stored token intact, "
    + "config PUT refused as a way to add, blank or overwrite a connection, no credential in any route, callback page, "
    + "support bundle, error response or server log, and disconnect erasing the credential from disk.",
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

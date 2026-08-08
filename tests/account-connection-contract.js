/* CineBraid AccountConnection — the generic contract.
 *
 * What is being locked in here is the SHAPE, independent of Civitai: a connection
 * is keyed by connectionId rather than providerId, several connections may exist
 * for one provider, the status vocabulary is closed, "no balance" is a different
 * fact from "zero balance", and an email is never stored.
 *
 * The last section is the one worth reading twice. Connecting and disconnecting an
 * account must be invisible to a production: the project file is byte-compared
 * before and after, no backup may appear (a backup is what a project write leaves
 * behind), and no media-assets.json may be created anywhere — MediaAsset stays
 * dormant, and Phase 3 is not the phase that wakes it.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { ROOT, startCineBraidServer, startMockCivitai } = require("./fixtures/mock-civitai");
const { buildFixture, render } = require("./render-harness");
const {
  CONNECTION_STATUSES,
  createConnection,
  credentialExpired,
  findConnection,
  isStale,
  isValidConnectionId,
  mintConnectionId,
  removeConnection,
  safeConnection,
  safeConnectionList,
  unsupportedBalance,
  upsertConnection,
  validateConnection,
  validateConnectionList,
} = require("../account-connections");

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-account-contract-"));
const CONFIG_PATH = path.join(TEMP, "config.json");
const PROJECTS_ROOT = path.join(TEMP, "projects");
const PROJECT_DIR = path.join(PROJECTS_ROOT, "contract-project");
const PROJECT_FILE = path.join(PROJECT_DIR, "project.json");
const TAKES = path.join(PROJECT_DIR, "shots", "S-01", "takes");

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/* Two accounts, because "one Civitai connection" is the case that hides every
   keying bug. Deliberately different users AND a repeat of the first, so both
   "two accounts" and "the same account twice" are exercised. */
const ADA_KEY = "civitaikey-ADA-CONTRACT-1111";
const RAY_KEY = "civitaikey-RAY-CONTRACT-2222";

let mock = null;
let server = null;

function writeProject() {
  fs.mkdirSync(TAKES, { recursive: true });
  for (const dir of ["anchors", "plates", "props", "vehicles", "audio", "media", "docs"])
    fs.mkdirSync(path.join(PROJECT_DIR, dir), { recursive: true });
  fs.writeFileSync(path.join(TAKES, "S-01_FRAME_A.png"), PNG);
  fs.writeFileSync(PROJECT_FILE, JSON.stringify({
    meta: { title: "Account Contract", format: "Test", version: "v1", hubVersion: "v6.0.0", schemaVersion: "6.6", aiPolicy: "project-default" },
    qcChecklist: [],
    characters: [{ id: "CHAR-KAI", name: "Kai", continuityStates: [{ id: "state-default", name: "Default", isDefault: true }] }],
    locations: [], props: [], vehicles: [], audio: [], mediaAssets: [],
    scenes: [{ id: "SC-01", title: "Scene one" }],
    shots: [{
      id: "S-01", scene: "SC-01", title: "Kai", desc: "Kai stands still.",
      characters: ["CHAR-KAI"], codes: [],
      creationBrief: { propIds: [], vehicleIds: [], frameWorkflows: {} },
      keyframes: [{ id: "frame-a", label: "A", winner: "S-01_FRAME_A.png", required: true, generationPackages: [] }],
      clips: [], candidateFiles: [],
    }],
    agentRuns: [], decisions: [], sessions: [], finishJobs: [],
  }, null, 2));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    activeProject: "contract-project",
    assistant: { provider: "ollama", visionProvider: "ollama" },
    accountProviders: { civitai: { clientId: "cinebraid-contract-client" } },
  }, null, 2));
}

function strayLedgers() {
  const found = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.startsWith("media-assets")) found.push(full);
    }
  })(PROJECTS_ROOT);
  return found;
}

function storedAccounts() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")).accounts || [];
}

async function main() {
  /* =====================================================================
     PART A — the contract itself, with no server and no provider.
     ===================================================================== */

  /* ---- A1. connectionId is minted, well-formed and distinct ---- */
  const ids = new Set(Array.from({ length: 200 }, () => mintConnectionId()));
  assert.strictEqual(ids.size, 200, "every minted connectionId must be distinct");
  for (const id of ids) assert(isValidConnectionId(id), `${id} must match the connectionId shape`);
  for (const bad of ["", "conn-", "conn-XYZ", "asset-" + "a".repeat(32), "civitai", null, 42])
    assert(!isValidConnectionId(bad), `${String(bad)} must not pass as a connectionId`);

  /* ---- A2. a valid connection, and the closed status vocabulary ---- */
  const base = createConnection({
    providerId: "civitai",
    providerLabel: "Civitai",
    status: "connected",
    identity: { providerUserId: "12345", displayName: "ada", tier: "free", accountStatus: "active", grantedScope: "1" },
    credential: { tokenSource: "oauth", accessToken: "civitai_access", refreshToken: "civitai_refresh", expiresAt: new Date(Date.now() + 3600000).toISOString() },
  });
  assert.deepStrictEqual(validateConnection(base).errors, []);
  assert.deepStrictEqual(
    CONNECTION_STATUSES,
    ["disconnected", "connecting", "connected", "expired", "error"],
    "the status vocabulary is closed and must not grow silently",
  );
  for (const status of CONNECTION_STATUSES)
    assert(validateConnection({ ...base, status }).ok, `${status} must be a legal status`);
  for (const status of ["unreachable", "pending", "ok", ""])
    assert(!validateConnection({ ...base, status }).ok, `${status} must not be a legal status`);

  /* ---- A3. providerId and connectionId are different things ---- */
  assert(!validateConnection({ ...base, providerId: base.connectionId }).ok,
    "a record whose providerId equals its connectionId is a keying mistake, not a connection");
  assert(!validateConnection({ ...base, providerId: "" }).ok);

  /* ---- A4. several connections for one provider coexist ---- */
  let accounts = [];
  const first = createConnection({ providerId: "civitai", providerLabel: "Civitai", status: "connected", identity: { providerUserId: "1", displayName: "ada" }, credential: { tokenSource: "api_key", apiKey: ADA_KEY } });
  const second = createConnection({ providerId: "civitai", providerLabel: "Civitai", status: "connected", identity: { providerUserId: "2", displayName: "ray" }, credential: { tokenSource: "api_key", apiKey: RAY_KEY } });
  /* The same remote account twice is legal too: a user may hold one narrow grant
     and one broad one, and the contract must be able to say so. */
  const third = createConnection({ providerId: "civitai", providerLabel: "Civitai", status: "connected", identity: { providerUserId: "1", displayName: "ada" }, credential: { tokenSource: "api_key", apiKey: ADA_KEY } });
  accounts = upsertConnection(upsertConnection(upsertConnection(accounts, first), second), third);
  assert.strictEqual(accounts.length, 3);
  assert.deepStrictEqual(validateConnectionList(accounts).errors, []);
  assert.strictEqual(new Set(accounts.map((row) => row.connectionId)).size, 3,
    "two connections to the same provider account still need two identities");

  /* A duplicate connectionId is the one structural failure worth naming. */
  assert(!validateConnectionList([first, { ...second, connectionId: first.connectionId }]).ok);

  /* ---- A5. upsert is stable, remove is surgical ---- */
  const renamed = { ...second, identity: { ...second.identity, displayName: "ray-renamed" } };
  accounts = upsertConnection(accounts, renamed);
  assert.strictEqual(accounts.length, 3, "an upsert of a known id replaces rather than appends");
  assert.strictEqual(findConnection(accounts, second.connectionId).identity.displayName, "ray-renamed");
  const afterRemoval = removeConnection(accounts, second.connectionId);
  assert.strictEqual(afterRemoval.length, 2);
  assert.strictEqual(findConnection(afterRemoval, second.connectionId), null);
  assert(findConnection(afterRemoval, first.connectionId), "removing one connection must not disturb its sibling");
  assert.strictEqual(findConnection(afterRemoval, first.connectionId).connectionId, first.connectionId,
    "connectionId is stable across a sibling's removal");

  /* ---- A6. identity may not carry a credential, and never an email ---- */
  for (const field of ["accessToken", "refreshToken", "apiKey", "api_key", "secret", "password", "codeVerifier"])
    assert(
      !validateConnection({ ...base, identity: { ...base.identity, [field]: "x" } }).ok,
      `identity.${field} must be refused — credentials belong in credential{}`,
    );
  assert(!validateConnection({ ...base, identity: { ...base.identity, email: "ada@example.invalid" } }).ok,
    "CineBraid must refuse to record a provider account's email");

  /* ---- A7. balance says "unsupported", which is not "zero" ---- */
  assert.deepStrictEqual(unsupportedBalance(), { supported: false, unit: null, amount: null, checkedAt: null });
  assert.strictEqual(safeConnection(base).balance.supported, false);
  assert(!("amount" in safeConnection(base).balance),
    "an unsupported balance must not project an amount at all — a 0 would be a wrong number");

  /* ---- A8. an API-key connection is not a disguised OAuth grant ---- */
  const pasted = createConnection({
    providerId: "civitai", providerLabel: "Civitai", status: "connected",
    identity: { providerUserId: "3", displayName: "kit" },
    credential: { tokenSource: "api_key", apiKey: ADA_KEY, expiresAt: null },
  });
  assert(validateConnection(pasted).ok);
  assert(!validateConnection({ ...pasted, credential: { ...pasted.credential, refreshToken: "invented" } }).ok,
    "a pasted key has no refresh token, and inventing one would make CineBraid refresh nothing");
  assert(!validateConnection({ ...pasted, credential: { ...pasted.credential, expiresAt: new Date().toISOString() } }).ok,
    "a pasted key has no expiry, and inventing one would expire a working key");
  assert.strictEqual(credentialExpired(pasted), false, "a null expiry means 'does not expire', never 'expired'");

  /* ---- A9. staleness and expiry are pure functions of stored timestamps ---- */
  const now = Date.parse("2026-08-08T12:00:00.000Z");
  assert.strictEqual(isStale({ lastVerifiedAt: new Date(now - 60000).toISOString() }, now), false);
  assert.strictEqual(isStale({ lastVerifiedAt: new Date(now - 60 * 60000).toISOString() }, now), true);
  assert.strictEqual(isStale({ lastVerifiedAt: null }, now), true, "never verified is stale");
  assert.strictEqual(credentialExpired({ credential: { expiresAt: new Date(now + 600000).toISOString() } }, now), false);
  assert.strictEqual(credentialExpired({ credential: { expiresAt: new Date(now + 30000).toISOString() } }, now), true,
    "a token inside the clock-skew window is treated as expired, so a request in flight cannot cross the boundary");
  assert.strictEqual(credentialExpired({ credential: { expiresAt: new Date(now - 1).toISOString() } }, now), true);

  /* ---- A10. the projection names safe fields; it does not delete unsafe ones ----
     A field added to credential later must be private WITHOUT anyone remembering. */
  const withFutureSecret = {
    ...base,
    credential: { ...base.credential, someFutureDeviceSecret: "civitaikey-FUTURE-3333" },
  };
  const projected = safeConnection(withFutureSecret);
  const projectedText = JSON.stringify(projected);
  assert(!("credential" in projected), "a projection must never carry credential");
  for (const secret of ["civitai_access", "civitai_refresh", "civitaikey-FUTURE-3333"])
    assert(!projectedText.includes(secret), `the projection leaked ${secret}`);
  assert(!("grantedScope" in projected.identity),
    "the scope encoding is an internal bitmask and has no business in front of a user");
  assert.strictEqual(projected.identity.displayName, "ada");
  assert.strictEqual(projected.tokenSource, "oauth");
  assert.strictEqual(safeConnectionList([base, pasted]).length, 2);

  /* =====================================================================
     PART B — the same contract through the real routes, and the promise
     that none of it reaches a production.
     ===================================================================== */
  writeProject();
  mock = await startMockCivitai();
  mock.registerToken(ADA_KEY, { id: 12345, username: "ada", tier: "free", status: "active", email: "ada@example.invalid" });
  mock.registerToken(RAY_KEY, { id: 67890, username: "ray", tier: "bronze", status: "active" });

  const projectBytesBefore = fs.readFileSync(PROJECT_FILE);
  server = await startCineBraidServer({
    CINEBRAID_CONFIG_PATH: CONFIG_PATH,
    CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT,
    CINEBRAID_CIVITAI_AUTH_BASE: mock.authBase,
    CINEBRAID_CIVITAI_API_BASE: mock.apiBase,
    FAL_KEY: "",
  });

  /* ---- B1. an unknown provider is refused, and creates nothing ---- */
  const unknown = await server.request("/api/accounts/notaprovider/api-key", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: ADA_KEY }),
  });
  assert.strictEqual(unknown.status, 400, JSON.stringify(unknown.body));
  assert.strictEqual(unknown.body.code, "PROVIDER_UNKNOWN");
  assert.deepStrictEqual(storedAccounts(), [], "a refused provider must not leave a record behind");

  /* ---- B2. two Civitai connections coexist, each with its own id ---- */
  const connectAda = await server.request("/api/accounts/civitai/api-key", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: ADA_KEY }),
  });
  assert.strictEqual(connectAda.status, 200, JSON.stringify(connectAda.body));
  const connectRay = await server.request("/api/accounts/civitai/api-key", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: RAY_KEY }),
  });
  assert.strictEqual(connectRay.status, 200, JSON.stringify(connectRay.body));

  const listed = await server.request("/api/accounts");
  assert.strictEqual(listed.status, 200);
  assert.strictEqual(listed.body.accounts.length, 2);
  const [adaRow, rayRow] = listed.body.accounts;
  assert.notStrictEqual(adaRow.connectionId, rayRow.connectionId);
  for (const row of listed.body.accounts) {
    assert(isValidConnectionId(row.connectionId));
    assert.strictEqual(row.providerId, "civitai");
    assert.notStrictEqual(row.connectionId, row.providerId);
    assert.strictEqual(row.status, "connected");
    assert.strictEqual(row.tokenSource, "api_key");
    assert.strictEqual(row.balance.supported, false, "Civitai reports no readable balance, and says so");
  }
  assert.deepStrictEqual(
    listed.body.accounts.map((row) => row.identity.displayName).sort(), ["ada", "ray"],
  );
  assert.strictEqual(adaRow.identity.tier, "free");
  assert.strictEqual(rayRow.identity.tier, "bronze");

  /* ---- B3. what was persisted: granted scope generically, and no email ---- */
  const stored = storedAccounts();
  assert.strictEqual(stored.length, 2);
  assert.deepStrictEqual(validateConnectionList(stored).errors, []);
  for (const row of stored) {
    assert.strictEqual(row.credential.tokenSource, "api_key");
    assert.strictEqual(row.credential.expiresAt, null, "a pasted key gets no fabricated expiry");
    assert.strictEqual(row.credential.refreshToken, "", "a pasted key gets no fabricated refresh token");
    assert.strictEqual(row.identity.grantedScope, "1",
      "the provider's own scope encoding is stored opaquely, as a generic string");
    assert(!("email" in row.identity), "the mock returned an email for ada; CineBraid must not have kept it");
    assert(!("buzzLimit" in row.identity), "buzzLimit is a spend cap, not identity, and is not stored");
    assert(!("subscriptions" in row.identity));
  }
  assert(!JSON.stringify(stored).includes("ada@example.invalid"), "no email may appear anywhere in the stored record");

  /* ---- B4. disconnecting one connection leaves the other untouched ---- */
  const removedId = adaRow.connectionId;
  const keptId = rayRow.connectionId;
  const disconnect = await server.request(`/api/accounts/${removedId}`, { method: "DELETE" });
  assert.strictEqual(disconnect.status, 200, JSON.stringify(disconnect.body));
  const afterDisconnect = storedAccounts();
  assert.strictEqual(afterDisconnect.length, 1);
  assert.strictEqual(afterDisconnect[0].connectionId, keptId, "connectionId is stable across a sibling's disconnect");
  assert.strictEqual(afterDisconnect[0].credential.apiKey, RAY_KEY, "the surviving connection keeps its own credential");
  assert(!JSON.stringify(afterDisconnect).includes(ADA_KEY), "the disconnected account's credential is gone from disk");

  /* Disconnecting the same connection twice is a 404, not a silent success. */
  const again = await server.request(`/api/accounts/${removedId}`, { method: "DELETE" });
  assert.strictEqual(again.status, 404);
  assert.strictEqual(again.body.code, "CONNECTION_NOT_FOUND");
  const malformed = await server.request("/api/accounts/not-a-connection-id", { method: "DELETE" });
  assert.strictEqual(malformed.status, 400);

  /* ---- B4b. a verification still in flight cannot undo a disconnect ----
     Verification waits on the provider; disconnect does not. Overlap them and a
     write-back that simply upserted would find no row to replace, append one, and
     silently restore the credential the user had just deleted. */
  const reconnect = await server.request("/api/accounts/civitai/api-key", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: ADA_KEY }),
  });
  assert.strictEqual(reconnect.status, 200, JSON.stringify(reconnect.body));
  const racingId = storedAccounts().find((row) => row.credential.apiKey === ADA_KEY).connectionId;
  mock.state.script.push("slow");
  const inFlight = server.request(`/api/accounts/${racingId}/verify`, { method: "POST" });
  await new Promise((resolve) => setTimeout(resolve, 150));
  const raced = await server.request(`/api/accounts/${racingId}`, { method: "DELETE" });
  assert.strictEqual(raced.status, 200, JSON.stringify(raced.body));
  await inFlight;
  assert.strictEqual(findConnection(storedAccounts(), racingId), null,
    "a verification that finishes after a disconnect must not resurrect the connection");
  assert(!fs.readFileSync(CONFIG_PATH, "utf8").includes(ADA_KEY),
    "and it must not put the deleted credential back on disk");

  /* ---- B5. none of this was visible to the production ----
     The whole point of an AccountConnection living in config: connecting and
     disconnecting an account is not a project edit. */
  assert(
    projectBytesBefore.equals(fs.readFileSync(PROJECT_FILE)),
    "connect and disconnect must leave project.json byte-identical",
  );
  const backups = path.join(PROJECT_DIR, "backups");
  assert(
    !fs.existsSync(backups) || fs.readdirSync(backups).length === 0,
    "no project backup may exist, because no project write may have happened",
  );
  assert.deepStrictEqual(strayLedgers(), [],
    "no media-assets.json anywhere — MediaAsset stays dormant through Phase 3");

  /* ---- B6. and the account modules cannot reach the ledger or a project ----
     Comments are stripped first: these files DISCUSS MediaAsset and project.json
     precisely because staying away from both is the point, and a scan that could
     not tell an explanation from a call site would punish saying so. */
  const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const accountSources = ["account-connections.js", "account-providers.js", "account-provider-civitai.js", "accounts-api.js", "account-errors.js", "loopback-request.js"];
  for (const rel of accountSources) {
    const source = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
    for (const forbidden of ["media-asset", "media-hash", "indexProject", "verifyAssets", "writeLedger", "readLedger"])
      assert(!source.includes(forbidden), `${rel} references ${forbidden} — account code must not reach MediaAsset`);
    for (const forbidden of ["project.json", "readProject", "writeProject", "projectDir", "PROJECT_DIR"])
      assert(!source.includes(forbidden), `${rel} references ${forbidden} — account code must not reach project data`);
  }

  /* =====================================================================
     PART C — what a person actually sees.

     CI has no browser, so Settings is rendered through the harness the way every
     other UI contract in CineBraid is checked. What matters here is as much about
     what is ABSENT as what is present: no balance, no scope bitmask, no OAuth
     vocabulary, and no credential — the panel must be readable by someone who has
     never heard of an authorization code.
     ===================================================================== */
  const CIVITAI_PROVIDER = {
    providerId: "civitai", label: "Civitai",
    supportsOAuth: true, supportsApiKey: true, balanceSupported: false, oauthConfigured: true,
  };
  const connectedRow = {
    connectionId: "conn-" + "d".repeat(32),
    providerId: "civitai", providerLabel: "Civitai", status: "connected", tokenSource: "oauth",
    identity: { providerUserId: "12345", displayName: "ada", avatarUrl: null, tier: "free", accountStatus: "active" },
    balance: { supported: false },
    createdAt: "2026-08-08T10:00:00.000Z", lastVerifiedAt: "2026-08-08T10:00:00.000Z",
    stale: false, lastError: null,
  };
  const settingsPanel = async (accounts) => {
    const view = await render("#/settings", buildFixture(), {
      accounts,
      storage: { "cinebraid-focused:fixture:settings-task:settings": "accounts" },
    });
    assert(view.html.includes('data-settings-tab="accounts"'), "the Accounts subsection must render");
    return view.html;
  };
  /* Vocabulary that belongs to the implementation, not to a user. */
  const JARGON = ["PKCE", "code_verifier", "code challenge", "redirect uri", "redirect_uri",
    "authorization code", "refresh token", "access token", "bearer", "bitmask", "grantedScope", "oauth"];
  const assertNoJargon = (html, label) => {
    const lowered = html.toLowerCase();
    for (const term of JARGON)
      assert(!lowered.includes(term.toLowerCase()), `${label} exposes implementation vocabulary: ${term}`);
    for (const term of ["buzz", "balance"])
      assert(!lowered.includes(term), `${label} must not mention ${term} — Phase 3 has no balance feature`);
    assert(!lowered.includes("credential\""), `${label} must not render a credential object`);
  };

  /* ---- C1. disconnected: two ways in, and nothing else ---- */
  const offered = await settingsPanel({ accounts: [], providers: [CIVITAI_PROVIDER], localMachine: true });
  assert(offered.includes("Connect Civitai"), "the primary action names the service in plain words");
  assert(offered.includes("Use API key"), "the fallback is offered as an ordinary alternative");
  assert(offered.includes("Not connected"));
  assertNoJargon(offered, "the disconnected Accounts panel");

  /* ---- C2. connected: who, and how to undo it ---- */
  const connectedHtml = await settingsPanel({ accounts: [connectedRow], providers: [CIVITAI_PROVIDER], localMachine: true });
  assert(connectedHtml.includes("@ada"), "a connected account is identified by the person it belongs to");
  assert(connectedHtml.includes("Connected"));
  assert(connectedHtml.includes("Disconnect"));
  assert(connectedHtml.includes(connectedRow.connectionId), "actions address the connection by its own id");
  assertNoJargon(connectedHtml, "the connected Accounts panel");

  /* ---- C3. a degraded connection says which kind of degraded ---- */
  const staleHtml = await settingsPanel({
    accounts: [{ ...connectedRow, stale: true, lastError: { code: "PROVIDER_UNREACHABLE", message: "Civitai could not be reached." } }],
    providers: [CIVITAI_PROVIDER], localMachine: true,
  });
  assert(/not checked recently/i.test(staleHtml), "an unverified-but-connected account says so rather than looking broken");
  assert(staleHtml.includes("Civitai could not be reached."));
  assert(!/expired/i.test(staleHtml), "an outage must not be presented as an expiry");
  const expiredHtml = await settingsPanel({
    accounts: [{ ...connectedRow, status: "expired", stale: true, lastError: { code: "CREDENTIAL_EXPIRED", message: "The Civitai connection has expired. Connect it again." } }],
    providers: [CIVITAI_PROVIDER], localMachine: true,
  });
  assert(/Connection expired/.test(expiredHtml));
  assert(/Connect it again/.test(expiredHtml));

  /* ---- C4. from a LAN browser: readable, but not actionable ---- */
  const remoteHtml = await settingsPanel({ accounts: [], providers: [CIVITAI_PROVIDER], localMachine: false });
  assert(remoteHtml.includes("must be completed on the computer running CineBraid"),
    "a remote browser is told where to do this instead of being given a button that cannot work");
  assert(!remoteHtml.includes("Connect Civitai"), "no connect action is offered where it cannot succeed");
  assert(!remoteHtml.includes("Use API key"));
  assert(!/\d+\.\d+\.\d+\.\d+/.test(remoteHtml), "the copy must not disclose an address");

  /* ---- C5. a credential is not rendered even if one somehow arrives ----
     The server's projection cannot carry one; this proves the panel does not
     simply serialize whatever it is handed. */
  const leaky = await settingsPanel({
    accounts: [{ ...connectedRow, credential: { accessToken: "civitaiaccess-UIMUSTNOTRENDER-7777", apiKey: "civitaikey-UIMUSTNOTRENDER-8888" } }],
    providers: [CIVITAI_PROVIDER], localMachine: true,
  });
  for (const secret of ["civitaiaccess-UIMUSTNOTRENDER-7777", "civitaikey-UIMUSTNOTRENDER-8888"])
    assert(!leaky.includes(secret), `the Accounts panel rendered ${secret}`);

  console.log(
    "AccountConnection contract suite passed: connectionId keying with several connections per provider, a closed "
    + "status vocabulary, credential-shaped fields and emails refused from identity, balance.supported=false rather "
    + "than a fabricated zero, an API-key connection with no invented refresh token or expiry, a projection built "
    + "from named safe fields, connect/disconnect leaving project.json byte-identical with no backup and no ledger, "
    + "and a Settings panel that offers both ways in, names the connected person, distinguishes an outage from an "
    + "expiry, refuses to act from a remote browser, and renders no balance, no scope, no OAuth vocabulary and no "
    + "credential.",
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

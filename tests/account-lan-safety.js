/* CineBraid loopback guard — a credential cannot be established from the network.
 *
 * CineBraid may be started with --lan, and that is deliberate: a phone or a second
 * workstation should be able to reach the workspace. Phase 3 must not turn that
 * into a way to plant, steal or race a provider credential, so the three routes
 * that receive or create one answer only the computer CineBraid runs on.
 *
 * The negative controls are the point of this suite, and they are run against REAL
 * SOCKETS rather than against a string helper. The server is bound to 0.0.0.0 and
 * the "remote" requests are made to this machine's own LAN address, so
 * `req.socket.remoteAddress` really is a non-loopback peer — including the two
 * cases a header-reading guard gets wrong:
 *
 *   Host: localhost              a LAN peer can simply send it
 *   X-Forwarded-For: 127.0.0.1   invented by whoever sent it; no proxy exists here
 *
 * And the positive control that an over-strict guard gets wrong: an IPv4-mapped
 * IPv6 peer (`::ffff:127.0.0.1`), which is what a dual-stack listener reports for
 * an IPv4 client and is the normal case on Windows.
 */
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const { startCineBraidServer, startMockCivitai } = require("./fixtures/mock-civitai");
const { isLoopbackAddress, isLoopbackRequest, requestPeerAddress } = require("../loopback-request");

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-account-lan-"));
const CONFIG_PATH = path.join(TEMP, "config.json");
const PROJECTS_ROOT = path.join(TEMP, "projects");
const PROJECT_DIR = path.join(PROJECTS_ROOT, "lan-project");
const PROJECT_FILE = path.join(PROJECT_DIR, "project.json");

const CLIENT_ID = "cinebraid-lan-client";
const PASTED_KEY = "civitaikey-LANSAFETY-1111";
const ACCESS = "civitaiaccess-LANSAFETY-2222";
const REFRESH = "civitairefresh-LANSAFETY-3333";
const ALL_SECRETS = [PASTED_KEY, ACCESS, REFRESH];

let mock = null;
let lanServer = null;
let dualStackServer = null;
let authServer = null;

/* This machine's own non-loopback address. Connecting to it produces a genuine
   non-loopback peer without needing a second machine. */
function lanAddress() {
  for (const list of Object.values(os.networkInterfaces()))
    for (const entry of list || [])
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
  return "";
}

function writeProject(patch = {}) {
  fs.mkdirSync(path.join(PROJECT_DIR, "shots"), { recursive: true });
  for (const dir of ["anchors", "plates", "props", "vehicles", "audio", "media", "docs"])
    fs.mkdirSync(path.join(PROJECT_DIR, dir), { recursive: true });
  fs.writeFileSync(PROJECT_FILE, JSON.stringify({
    meta: { title: "LAN Safety", format: "Test", version: "v1", hubVersion: "v6.0.0", schemaVersion: "6.6", aiPolicy: "project-default" },
    qcChecklist: [],
    characters: [], locations: [], props: [], vehicles: [], audio: [], mediaAssets: [],
    scenes: [], shots: [], agentRuns: [], decisions: [], sessions: [], finishJobs: [],
  }, null, 2));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    activeProject: "lan-project",
    assistant: { provider: "ollama", visionProvider: "ollama" },
    accountProviders: { civitai: { clientId: CLIENT_ID } },
    accounts: [],
    ...patch,
  }, null, 2));
}

async function call(origin, pathname, options = {}) {
  const response = await fetch(origin + pathname, options);
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = null; }
  return { status: response.status, ok: response.ok, body, text };
}

/* The three routes that receive or create a credential. Everything asserted about
   "the credential surface" is asserted about exactly this list. */
function credentialRoutes(origin) {
  return [
    ["oauth start", () => call(origin, "/api/accounts/civitai/oauth/start", { method: "POST" })],
    ["api key", () => call(origin, "/api/accounts/civitai/api-key", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: PASTED_KEY }),
    })],
    ["callback", () => call(origin, "/api/accounts/civitai/callback?code=x&state=y")],
  ];
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

async function main() {
  /* =====================================================================
     PART A — the decision, in isolation. Cheap, exhaustive, and the
     specification the socket tests below then confirm in the real world.
     ===================================================================== */
  for (const address of [
    "127.0.0.1", "127.0.0.53", "127.1.2.3", "127.255.255.254",
    "::1", "0:0:0:0:0:0:0:1", "::1%lo0",
    "::ffff:127.0.0.1", "::FFFF:127.0.0.1", "::ffff:127.9.9.9",
  ]) assert.strictEqual(isLoopbackAddress(address), true, `${address} is this machine and must be admitted`);

  for (const address of [
    /* Ordinary private ranges — the actual LAN threat. */
    "192.168.1.5", "192.168.68.110", "10.0.0.5", "10.255.1.1", "172.16.0.1",
    /* IPv4-mapped forms of the same: mapping does not make an address local. */
    "::ffff:192.168.1.5", "::ffff:10.0.0.1",
    /* Public, link-local, unspecified, and this machine's own ULA. */
    "8.8.8.8", "0.0.0.0", "fe80::1", "fd84:99af:ac6a:25cb::1", "::",
    /* NAMES, which this guard never resolves and must never accept. A guard that
       compared text would fall for the third of these. */
    "localhost", "127.0.0.1.evil.example", "evil-127.0.0.1.example", "loopback",
    /* Malformed, empty, and non-strings: the failure mode must be refusal. */
    "127.0.0.256", "1270.0.0.1", "127.0.0", "", "   ", null, undefined, 127, {}, [],
  ]) assert.strictEqual(isLoopbackAddress(address), false, `${String(address)} must be refused`);

  /* The peer address is read from the socket and from nothing else. */
  assert.strictEqual(requestPeerAddress({ socket: { remoteAddress: "127.0.0.1" } }), "127.0.0.1");
  assert.strictEqual(requestPeerAddress({}), "", "a request with no socket has no peer, and is not loopback");
  assert.strictEqual(isLoopbackRequest({}), false);
  assert.strictEqual(isLoopbackRequest({ socket: {} }), false);
  /* Header-shaped evidence is ignored entirely, even when the socket agrees it is
     remote — this is the whole substance of the guard. */
  assert.strictEqual(isLoopbackRequest({
    socket: { remoteAddress: "192.168.1.5" },
    headers: { host: "localhost", "x-forwarded-for": "127.0.0.1", forwarded: "for=127.0.0.1" },
    ip: "127.0.0.1",
  }), false);

  /* The guard source must not consult a header or Express's proxy setting at all.
     Comments are stripped, because this file explains those headers by name. */
  const guardSource = fs.readFileSync(path.join(__dirname, "..", "loopback-request.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const token of ["req.headers", "headers[", "x-forwarded", "forwarded", "trust proxy", "req.hostname", "req.ip", "req.query", "dns.", "lookup("])
    assert(!guardSource.toLowerCase().includes(token), `the guard must not consult ${token}`);

  /* =====================================================================
     PART B — real sockets. Server bound to 0.0.0.0 the way --lan binds it.
     ===================================================================== */
  writeProject();
  mock = await startMockCivitai();
  mock.registerToken(PASTED_KEY, { id: 4242, username: "kit", tier: "bronze", status: "active" });

  const lan = lanAddress();
  assert(lan, "this suite needs one non-loopback IPv4 interface to produce a genuine remote peer");
  const projectBytesBefore = fs.readFileSync(PROJECT_FILE);

  lanServer = await startCineBraidServer({
    CINEBRAID_CONFIG_PATH: CONFIG_PATH,
    CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT,
    CINEBRAID_CIVITAI_AUTH_BASE: mock.authBase,
    CINEBRAID_CIVITAI_API_BASE: mock.apiBase,
    CINEBRAID_LAN: "1",
    FAL_KEY: "",
  });
  const local = `http://127.0.0.1:${lanServer.port}`;
  const remote = `http://${lan}:${lanServer.port}`;

  /* Sanity: the server really is reachable from the LAN address, so a refusal
     below is the guard's decision and not a connection that never arrived. */
  const remoteReachable = await call(remote, "/api/me");
  assert.strictEqual(remoteReachable.status, 200, "the LAN bind must actually be reachable for these controls to mean anything");

  /* ---- B1. from this machine, the credential routes answer ---- */
  const localStart = await call(local, "/api/accounts/civitai/oauth/start", { method: "POST" });
  assert.strictEqual(localStart.status, 200, JSON.stringify(localStart.body));
  const localKey = await call(local, "/api/accounts/civitai/api-key", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: PASTED_KEY }),
  });
  assert.strictEqual(localKey.status, 200, JSON.stringify(localKey.body));

  /* ---- B2. from the LAN, not one of them does ---- */
  for (const [label, request] of credentialRoutes(remote)) {
    const refused = await request();
    assert.strictEqual(refused.status, 403, `${label} must refuse a LAN peer (got ${refused.status})`);
    assert.strictEqual(refused.body?.code, "LOOPBACK_REQUIRED", `${label}: ${refused.text}`);
    assert(/computer running CineBraid/i.test(refused.body.error), `${label} must say what to do instead`);
    /* The refusal names no address, no port, no route internal. */
    assert(!refused.text.includes(lan), `${label} must not disclose the peer address`);
    assert(!refused.text.includes("127.0.0.1"));
    assert(!refused.text.includes(String(lanServer.port)));
    assert(!/socket|remoteAddress|0\.0\.0\.0|\.js:\d+/.test(refused.text), `${label} leaked an internal detail`);
  }

  /* ---- B3. the header games, one at a time, all still refused ---- */
  const spoofs = [
    ["Host: localhost", { host: "localhost" }],
    ["Host: 127.0.0.1", { host: "127.0.0.1" }],
    ["Host: 127.0.0.1.evil.example", { host: "127.0.0.1.evil.example" }],
    ["X-Forwarded-For: 127.0.0.1", { "x-forwarded-for": "127.0.0.1" }],
    ["X-Forwarded-For chain", { "x-forwarded-for": "127.0.0.1, ::1, 127.0.0.1" }],
    ["Forwarded: for=127.0.0.1", { forwarded: 'for="127.0.0.1";host=localhost;proto=http' }],
    ["X-Real-IP: ::1", { "x-real-ip": "::1" }],
    ["Origin: http://localhost", { origin: "http://localhost" }],
    ["Referer: http://127.0.0.1", { referer: "http://127.0.0.1/" }],
    ["everything at once", {
      host: "localhost", "x-forwarded-for": "127.0.0.1", forwarded: "for=127.0.0.1",
      "x-real-ip": "127.0.0.1", origin: "http://127.0.0.1", "x-forwarded-host": "localhost",
    }],
  ];
  for (const [label, headers] of spoofs) {
    const start = await call(remote, "/api/accounts/civitai/oauth/start", { method: "POST", headers });
    assert.strictEqual(start.status, 403, `oauth start accepted a LAN peer claiming "${label}"`);
    const key = await call(remote, "/api/accounts/civitai/api-key", {
      method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ apiKey: PASTED_KEY }),
    });
    assert.strictEqual(key.status, 403, `api-key accepted a LAN peer claiming "${label}"`);
    const back = await call(remote, "/api/accounts/civitai/callback?code=x&state=y", { headers });
    assert.strictEqual(back.status, 403, `callback accepted a LAN peer claiming "${label}"`);
  }
  /* A query parameter is no better evidence than a header. */
  const viaQuery = await call(remote, "/api/accounts/civitai/oauth/start?host=127.0.0.1&local=1", { method: "POST" });
  assert.strictEqual(viaQuery.status, 403);

  /* ---- B4. a LAN peer cannot spend a state a local user minted ----
     The guard runs BEFORE the state is consumed, so the interrupted attempt is
     still completable by the person who started it. If it ran after, a remote
     probe would silently burn every connection attempt. */
  const started = await call(local, "/api/accounts/civitai/oauth/start", { method: "POST" });
  assert.strictEqual(started.status, 200);
  const challenge = new URL(started.body.authorizationUrl).searchParams.get("code_challenge");
  mock.issueCode("code-lan", {
    accessToken: ACCESS, refreshToken: REFRESH, expiresIn: 3600, scope: "1", codeChallenge: challenge,
    identity: { id: 777, username: "ada", tier: "free", status: "active" },
  });
  const stolen = await call(remote, `/api/accounts/civitai/callback?code=code-lan&state=${encodeURIComponent(started.body.state)}`);
  assert.strictEqual(stolen.status, 403, "a LAN peer must not be able to complete somebody else's connection");
  assert(!stolen.text.includes(ACCESS));
  const completed = await call(local, `/api/accounts/civitai/callback?code=code-lan&state=${encodeURIComponent(started.body.state)}`);
  assert.strictEqual(completed.status, 200, "the refused remote attempt must not have consumed the pending state");
  assert(/Civitai connected/.test(completed.text));

  /* ---- B5. what a LAN browser CAN see: status, and nothing else ---- */
  const remoteList = await call(remote, "/api/accounts");
  assert.strictEqual(remoteList.status, 200, "reading account status carries no credential and stays available");
  assert.strictEqual(remoteList.body.localMachine, false,
    "a remote browser is told it is remote, so Settings can say so before the user clicks");
  assert(remoteList.body.accounts.length >= 1);
  for (const secret of ALL_SECRETS)
    assert(!remoteList.text.includes(secret), `the LAN-visible account list leaked ${secret}`);
  for (const row of remoteList.body.accounts) assert(!("credential" in row));

  const localList = await call(local, "/api/accounts");
  assert.strictEqual(localList.body.localMachine, true);

  /* ---- B6. no LAN-reachable surface carries a credential ---- */
  for (const route of ["/api/config", "/api/accounts", "/api/system/health", "/api/me", "/api/projects"]) {
    const payload = await call(remote, route);
    for (const secret of ALL_SECRETS)
      assert(!payload.text.includes(secret), `${route} leaked ${secret} to a LAN peer`);
  }

  /* ---- B7. disconnect is editor-authorized, not loopback-only ----
     Recorded as a decision rather than left implicit: it carries no credential in
     either direction, and making it local-only would break checking a studio
     account from a tablet while protecting nothing. */
  const target = remoteList.body.accounts.find((row) => row.tokenSource === "api_key");
  const remoteDisconnect = await call(remote, `/api/accounts/${target.connectionId}`, { method: "DELETE" });
  assert.strictEqual(remoteDisconnect.status, 200,
    "disconnect follows the ordinary editor authorization, the same as every other settings change");

  /* =====================================================================
     PART C — IPv4-mapped loopback, the case an over-strict guard rejects.
     ===================================================================== */
  /* First establish the environment fact independently: a dual-stack listener
     really does report an IPv4 client as ::ffff:127.0.0.1 here. */
  const probe = http.createServer((req, res) => res.end(req.socket.remoteAddress || ""));
  await new Promise((resolve) => probe.listen(0, "::", resolve));
  const probePort = probe.address().port;
  const mappedPeer = await (await fetch(`http://127.0.0.1:${probePort}/`)).text();
  const sixPeer = await (await fetch(`http://[::1]:${probePort}/`)).text();
  await new Promise((resolve) => probe.close(resolve));
  assert.strictEqual(mappedPeer, "::ffff:127.0.0.1", "a dual-stack bind must report an IPv4 client in mapped form");
  assert.strictEqual(sixPeer, "::1");

  lanServer.stop();
  lanServer = null;
  dualStackServer = await startCineBraidServer({
    CINEBRAID_CONFIG_PATH: CONFIG_PATH,
    CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT,
    CINEBRAID_CIVITAI_AUTH_BASE: mock.authBase,
    CINEBRAID_CIVITAI_API_BASE: mock.apiBase,
    CINEBRAID_HOST: "::",
    FAL_KEY: "",
  });
  /* Same bind as the probe, so these peers are ::ffff:127.0.0.1 and ::1. */
  for (const [label, origin] of [["IPv4-mapped", `http://127.0.0.1:${dualStackServer.port}`], ["IPv6", `http://[::1]:${dualStackServer.port}`]]) {
    const admitted = await call(origin, "/api/accounts/civitai/oauth/start", { method: "POST" });
    assert.strictEqual(admitted.status, 200, `${label} loopback must be admitted: ${admitted.text}`);
    const keyed = await call(origin, "/api/accounts/civitai/api-key", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: "civitaikey-WRONG-0000" }),
    });
    assert.strictEqual(keyed.status, 401,
      `${label} loopback must reach the handler — a 403 here would mean the guard rejected this machine`);
    const status = await call(origin, "/api/accounts");
    assert.strictEqual(status.body.localMachine, true, `${label} loopback must be recognised as this machine`);
  }
  dualStackServer.stop();
  dualStackServer = null;

  /* =====================================================================
     PART D — with a passcode set, the callback's own authority.
     ===================================================================== */
  const configWithPass = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  configWithPass.editorPass = "lan-suite-editor-pass";
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(configWithPass, null, 2));
  authServer = await startCineBraidServer({
    CINEBRAID_CONFIG_PATH: CONFIG_PATH,
    CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT,
    CINEBRAID_CIVITAI_AUTH_BASE: mock.authBase,
    CINEBRAID_CIVITAI_API_BASE: mock.apiBase,
    CINEBRAID_LAN: "1",
    FAL_KEY: "",
  });
  const authLocal = `http://127.0.0.1:${authServer.port}`;
  const authRemote = `http://${lan}:${authServer.port}`;

  /* Ordinary account routes obey the existing passcode policy. */
  const unsigned = await call(authLocal, "/api/accounts");
  assert.strictEqual(unsigned.status, 401, "with a passcode set, reading accounts needs a session like every other route");
  const unsignedStart = await call(authLocal, "/api/accounts/civitai/oauth/start", { method: "POST" });
  assert.strictEqual(unsignedStart.status, 401, "starting a connection needs editor authorization as well as loopback");
  const unsignedKey = await call(authLocal, "/api/accounts/civitai/api-key", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: PASTED_KEY }),
  });
  assert.strictEqual(unsignedKey.status, 401, "pasting a key needs editor authorization as well as loopback");

  /* The callback is the exception, and only in one direction: it does not need the
     cookie, because the provider caused the navigation. It still needs a loopback
     peer and a state this server minted — so an unauthenticated local callback
     reaches the route and is refused on its state, while an unauthenticated remote
     callback never reaches the route at all. */
  const localCallback = await call(authLocal, "/api/accounts/civitai/callback?code=x&state=forged");
  assert.strictEqual(localCallback.status, 400, "the callback must reach its own handler without a passcode session");
  assert(/authorization request expired/i.test(localCallback.text), localCallback.text);
  const remoteCallback = await call(authRemote, "/api/accounts/civitai/callback?code=x&state=forged");
  assert.strictEqual(remoteCallback.status, 403, "the callback's cookie exemption must not extend past the loopback guard");
  assert.strictEqual(remoteCallback.body?.code, "LOOPBACK_REQUIRED");

  /* The exemption is narrow: it does not open any neighbouring path. */
  for (const pathname of [
    "/api/accounts/civitai/callback/../oauth/start",
    "/api/accounts",
    "/api/config",
    "/api/project",
  ]) {
    const probeResponse = await call(authLocal, pathname, { method: "GET" });
    assert.notStrictEqual(probeResponse.status, 200, `${pathname} must not become reachable through the callback exemption`);
  }

  /* =====================================================================
     PART E — and none of it touched a production.
     ===================================================================== */
  assert(projectBytesBefore.equals(fs.readFileSync(PROJECT_FILE)),
    "no account route may write project.json");
  const backups = path.join(PROJECT_DIR, "backups");
  assert(!fs.existsSync(backups) || fs.readdirSync(backups).length === 0);
  assert.deepStrictEqual(strayLedgers(), [], "no media-assets.json may be created by any account route");
  for (const output of [authServer.output])
    for (const secret of ALL_SECRETS)
      assert(!output.includes(secret), `a credential reached the server log: ${secret}`);

  console.log(
    "Account LAN safety suite passed: against real sockets on a 0.0.0.0 bind, every credential-establishing route "
    + "refuses a genuine LAN peer — including one sending Host: localhost, a forged X-Forwarded-For, Forwarded, "
    + "X-Real-IP, Origin and a 127.0.0.1.evil.example host, singly and all at once — while IPv4-mapped and IPv6 "
    + "loopback peers are admitted; a remote attempt cannot spend a locally minted state; account status stays "
    + "readable with no credential in it; and the callback's cookie exemption stops exactly at the loopback guard.",
  );
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || error);
    for (const server of [lanServer, dualStackServer, authServer])
      if (server?.output) console.error(`--- server output ---\n${server.output}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    lanServer?.stop();
    dualStackServer?.stop();
    authServer?.stop();
    await mock?.close();
    fs.rmSync(TEMP, { recursive: true, force: true });
  });

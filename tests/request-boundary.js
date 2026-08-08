/* CineBraid request provenance — Host and Origin, against real sockets.
 *
 * Two defects, closed by one middleware, and neither is closed by the Phase 3
 * loopback guard:
 *
 *   CSRF. There was no Origin, Referer or token check anywhere. In the shipped
 *   default posture — no passcode, so every caller is `editor` — a page the user
 *   merely visited could POST a form to the upload routes (mounted with a raw body
 *   parser accepting every content type, destination taken from the QUERY STRING,
 *   so no JSON and no preflight) and write attacker bytes into the project, then
 *   archive the project with a bodyless form POST. Setting a passcode did not help:
 *   SameSite=Lax is site-scoped and ignores the port.
 *
 *   DNS rebinding. Nothing validated Host, so any name resolving to the bind
 *   address got same-origin READ of the whole API.
 *
 * The loopback guard cannot close either: a CSRF victim's browser IS a loopback
 * peer. This module cannot replace the loopback guard either: curl can set both
 * headers to anything. The suite therefore also proves the two do not overlap and
 * that neither has been weakened.
 *
 * Everything below is driven over a raw socket, because Node's fetch normalises and
 * refuses to send some of the exact headers that are the point.
 */
const assert = require("assert");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const { startCineBraidServer, startMockCivitai } = require("./fixtures/mock-civitai");
const {
  createRequestPosture, isAllowedHostValue, isAllowedOriginValue, splitAuthority,
} = require("../request-origin");

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-request-boundary-"));
const CONFIG_PATH = path.join(TEMP, "config.json");
const PROJECTS_ROOT = path.join(TEMP, "projects");
const PROJECT_DIR = path.join(PROJECTS_ROOT, "boundary-project");

let mock = null;
let server = null;
let authServer = null;

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces()))
    for (const entry of list || []) if (entry.family === "IPv4" && !entry.internal) return entry.address;
  return "";
}
function writeProject(extra = {}) {
  fs.mkdirSync(path.join(PROJECT_DIR, "shots"), { recursive: true });
  for (const d of ["anchors", "plates", "props", "vehicles", "audio", "media", "docs"])
    fs.mkdirSync(path.join(PROJECT_DIR, d), { recursive: true });
  fs.writeFileSync(path.join(PROJECT_DIR, "project.json"), JSON.stringify({
    meta: { title: "Boundary", format: "Test", version: "v1", hubVersion: "v6.0.0", schemaVersion: "6.6", aiPolicy: "project-default" },
    qcChecklist: [], characters: [], locations: [], props: [], vehicles: [], audio: [], mediaAssets: [],
    scenes: [], shots: [], agentRuns: [], decisions: [], sessions: [], finishJobs: [],
  }, null, 2));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    activeProject: "boundary-project",
    accountProviders: { civitai: { clientId: "boundary-client" } },
    accounts: [], ...extra,
  }, null, 2));
}

/* A raw client, so Host, Origin and Sec-Fetch-Site are exactly what the test says
   they are. Node's fetch refuses to set Host and rewrites Origin. */
function raw(port, { method = "GET", target = "/", headers = {}, body = "", connectHost = "127.0.0.1" } = {}) {
  return new Promise((resolve) => {
    const socket = net.connect(port, connectHost, () => {
      const head = { host: `127.0.0.1:${port}`, connection: "close", ...headers };
      const lines = Object.entries(head).map(([k, v]) => `${k}: ${v}`).join("\r\n");
      const length = body ? `content-length: ${Buffer.byteLength(body)}\r\n` : "";
      socket.write(`${method} ${target} HTTP/1.1\r\n${lines}\r\n${length}\r\n${body}`);
    });
    let data = "";
    socket.on("data", (c) => { data += c; });
    socket.on("end", () => resolve({
      status: Number(/^HTTP\/1\.1 (\d{3})/.exec(data)?.[1] || 0),
      body: data.split("\r\n\r\n").slice(1).join("\r\n\r\n"),
    }));
    /* A connection that is refused outright is a result, not a test failure: a
       loopback-bound server is unreachable from the LAN address by construction,
       and that is one of the outcomes B6 accepts. */
    socket.on("error", (error) => resolve({ status: 0, body: String(error?.code || error) }));
  });
}

async function main() {
  /* =====================================================================
     PART A — the policy in isolation.
     ===================================================================== */
  const loopback = createRequestPosture({ host: "127.0.0.1", port: 4477 });
  const lanPosture = createRequestPosture({ host: "0.0.0.0", port: 4477, lanOptIn: true });
  const named = createRequestPosture({ host: "0.0.0.0", port: 4477, lanOptIn: true, allowedHosts: "studio.local" });

  assert.deepStrictEqual(splitAuthority("[::1]:4477"), { hostname: "[::1]", port: "4477" });
  assert.deepStrictEqual(splitAuthority("127.0.0.1:4477"), { hostname: "127.0.0.1", port: "4477" });
  assert.strictEqual(splitAuthority("::1:4477"), null, "an unbracketed IPv6 authority is not parseable and must not be guessed");

  for (const host of ["127.0.0.1:4477", "localhost:4477", "[::1]:4477", "127.0.0.53:4477"])
    assert(isAllowedHostValue(host, loopback), `${host} must be accepted`);
  for (const host of [
    "rebind.evil.example:4477", "evil.com:4477", "attacker-rebind.evil.com:80",
    "localhost.evil.example:4477", "127.0.0.1.evil.example:4477",
    "127.0.0.1:9999", "localhost", "", "..", "%00", "192.168.1.5:4477",
  ]) assert(!isAllowedHostValue(host, loopback), `${host} must be refused on a loopback posture`);

  /* A wildcard bind is the intentional LAN configuration: this machine's own
     addresses become legitimate, and nothing else does. */
  const lan = lanAddress();
  assert(lan, "this suite needs one non-loopback IPv4 interface");
  assert(isAllowedHostValue(`${lan}:4477`, lanPosture), "LAN mode must accept this machine's own address");
  assert(!isAllowedHostValue(`${lan}:4477`, loopback), "a loopback-bound server must not answer to its LAN address");
  assert(!isAllowedHostValue("rebind.evil.example:4477", lanPosture), "LAN mode must not accept an arbitrary name");
  assert(isAllowedHostValue("studio.local:4477", named), "an operator may declare a name explicitly");
  assert(!isAllowedHostValue("studio.local:4477", lanPosture), "and it is not accepted unless they did");

  for (const origin of ["http://127.0.0.1:4477", "http://localhost:4477", "https://localhost:4477"])
    assert(isAllowedOriginValue(origin, loopback), `${origin} must be accepted`);
  for (const origin of [
    "http://evil.example", "http://evil.example:4477", "null", "", "file://",
    "http://127.0.0.1:4478", "http://localhost.evil.example:4477", "data:text/html,x",
  ]) assert(!isAllowedOriginValue(origin, loopback), `${origin} must be refused`);

  /* =====================================================================
     PART B — a real server, default posture (no passcode).
     ===================================================================== */
  writeProject();
  mock = await startMockCivitai();
  server = await startCineBraidServer({
    CINEBRAID_CONFIG_PATH: CONFIG_PATH, CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT,
    CINEBRAID_CIVITAI_AUTH_BASE: mock.authBase, CINEBRAID_CIVITAI_API_BASE: mock.apiBase, FAL_KEY: "",
  });
  const port = server.port;
  const good = `127.0.0.1:${port}`;

  /* ---- B1. the CSRF vectors the audit proved, now refused ---- */
  const upload = await raw(port, {
    method: "POST", target: "/api/media/upload?type=media&name=csrf_payload.png",
    headers: { host: good, origin: "http://evil.example", "content-type": "text/plain" },
    body: "OWNED-BY-A-CROSS-ORIGIN-FORM",
  });
  assert.strictEqual(upload.status, 403, `a cross-origin upload must be refused: ${upload.body}`);
  assert(/another site/i.test(upload.body), upload.body);
  assert(!fs.existsSync(path.join(PROJECT_DIR, "media", "csrf_payload.png")),
    "no attacker bytes may reach the project");

  const archive = await raw(port, {
    method: "POST", target: "/api/projects/boundary-project/archive",
    headers: { host: good, origin: "http://evil.example" },
  });
  assert.strictEqual(archive.status, 403, "a bodyless cross-origin form POST must be refused");
  assert(fs.existsSync(PROJECT_DIR), "the project must still be there");

  /* The same-host-different-port case SameSite=Lax lets through. */
  const sameSite = await raw(port, {
    method: "POST", target: "/api/projects/boundary-project/backups",
    headers: { host: good, origin: `http://127.0.0.1:${port + 1}` },
  });
  assert.strictEqual(sameSite.status, 403, "same host, different port is still cross-origin to CineBraid");
  const secFetch = await raw(port, {
    method: "POST", target: "/api/projects/boundary-project/backups",
    headers: { host: good, "sec-fetch-site": "same-site" },
  });
  assert.strictEqual(secFetch.status, 403, "Sec-Fetch-Site: same-site must be refused even with no Origin");
  const crossSiteFetch = await raw(port, {
    method: "POST", target: "/api/projects/boundary-project/backups",
    headers: { host: good, "sec-fetch-site": "cross-site" },
  });
  assert.strictEqual(crossSiteFetch.status, 403);

  /* ---- B2. legitimate operation still works ---- */
  const sameOrigin = await raw(port, {
    method: "POST", target: "/api/projects/boundary-project/backups",
    headers: { host: good, origin: `http://127.0.0.1:${port}`, "sec-fetch-site": "same-origin" },
  });
  assert.strictEqual(sameOrigin.status, 200, `a same-origin mutation must work: ${sameOrigin.body}`);
  /* Local tooling with no Origin at all — curl, a script, these suites. */
  const cli = await raw(port, {
    method: "POST", target: "/api/projects/boundary-project/backups", headers: { host: good },
  });
  assert.strictEqual(cli.status, 200, "a client that sends no Origin is local tooling and stays supported");
  const read = await raw(port, { target: "/api/projects", headers: { host: good } });
  assert.strictEqual(read.status, 200);

  /* ---- B3. Host: the rebinding boundary, on every method ---- */
  for (const host of ["rebind.evil.example", `rebind.evil.example:${port}`, "attacker-rebind.evil.com:80", "evil.com", "..", "%00", `127.0.0.1:${port + 1}`]) {
    const probe = await raw(port, { target: "/api/projects", headers: { host } });
    assert.strictEqual(probe.status, 403, `GET with Host: ${host} must be refused`);
    assert(!probe.body.includes("boundary-project"), `Host: ${host} must not read the project list`);
    const mutate = await raw(port, { method: "POST", target: "/api/projects/boundary-project/backups", headers: { host } });
    assert.strictEqual(mutate.status, 403, `POST with Host: ${host} must be refused`);
  }
  /* A refusal must not become a map of the machine. */
  const refusal = await raw(port, { target: "/api/projects", headers: { host: "rebind.evil.example" } });
  assert(!refusal.body.includes(String(port)) && !refusal.body.includes("127.0.0.1") && !refusal.body.includes(lan),
    "the refusal must not disclose the addresses that would have been accepted");

  /* ---- B4. forwarding headers are not authorization ---- */
  for (const spoof of [
    { "x-forwarded-for": "127.0.0.1" }, { "x-forwarded-host": `127.0.0.1:${port}` },
    { forwarded: `for=127.0.0.1;host=127.0.0.1:${port}` }, { "x-real-ip": "127.0.0.1" },
    { "x-forwarded-for": "127.0.0.1", "x-forwarded-host": "localhost", forwarded: "host=localhost", "x-real-ip": "::1" },
  ]) {
    const probe = await raw(port, { target: "/api/projects", headers: { host: "rebind.evil.example", ...spoof } });
    assert.strictEqual(probe.status, 403, `spoofed ${Object.keys(spoof).join("+")} must not authorize a bad Host`);
    const mutate = await raw(port, {
      method: "POST", target: "/api/projects/boundary-project/backups",
      headers: { host: good, origin: "http://evil.example", ...spoof },
    });
    assert.strictEqual(mutate.status, 403, `spoofed ${Object.keys(spoof).join("+")} must not authorize a bad Origin`);
  }

  /* ---- B5. Phase 3 still works, and is still protected ----
     The callback is a provider-originated cross-site GET. The Origin policy gates
     state-changing methods only, so it needs NO exception — which is the narrowest
     possible one. This asserts that, so a later widening of the policy to GETs
     cannot break the callback silently. */
  const start = await raw(port, {
    method: "POST", target: "/api/accounts/civitai/oauth/start",
    headers: { host: good, origin: `http://127.0.0.1:${port}`, "sec-fetch-site": "same-origin" },
  });
  assert.strictEqual(start.status, 200, `Phase 3 OAuth start must still work: ${start.body}`);
  const state = JSON.parse(start.body).state;
  const challenge = new URL(JSON.parse(start.body).authorizationUrl).searchParams.get("code_challenge");
  mock.issueCode("code-boundary", {
    accessToken: "civitai_access-BOUNDARY", refreshToken: "civitai_refresh-BOUNDARY", expiresIn: 3600, scope: "1",
    codeChallenge: challenge, identity: { id: 31337, username: "ada", tier: "free", status: "active" },
  });
  /* Exactly what Civitai's redirect looks like: a cross-site top-level navigation. */
  const callback = await raw(port, {
    target: `/api/accounts/civitai/callback?code=code-boundary&state=${encodeURIComponent(state)}`,
    headers: {
      host: good, origin: "https://civitai.com", referer: "https://civitai.com/",
      "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document",
    },
  });
  assert.strictEqual(callback.status, 200, `the provider callback must survive the new boundary: ${callback.body}`);
  assert(/Civitai connected/.test(callback.body));

  /* The callback is still gated by Host — a rebinding page cannot drive it. */
  const rebindCallback = await raw(port, {
    target: "/api/accounts/civitai/callback?code=x&state=y", headers: { host: "rebind.evil.example" },
  });
  assert.strictEqual(rebindCallback.status, 403);
  /* And a cross-origin attempt to START a connection is still refused. */
  const evilStart = await raw(port, {
    method: "POST", target: "/api/accounts/civitai/oauth/start",
    headers: { host: good, origin: "http://evil.example" },
  });
  assert.strictEqual(evilStart.status, 403, "a page cannot start an account connection on the user's behalf");
  const evilDisconnect = await raw(port, {
    method: "DELETE", target: "/api/accounts/conn-" + "a".repeat(32),
    headers: { host: good, origin: "http://evil.example" },
  });
  assert.strictEqual(evilDisconnect.status, 403, "nor disconnect one");

  /* ---- B6. the two guards are independent ---- */
  const lanPeer = `${lan}:${port}`;
  const lanCredential = await raw(port, {
    method: "POST", target: "/api/accounts/civitai/api-key",
    headers: { host: good, "content-type": "application/json" },
    body: JSON.stringify({ apiKey: "civitaikey-FROM-LAN" }), connectHost: lan,
  });
  assert(lanCredential.status === 403 || lanCredential.status === 0,
    `the Phase 3 loopback guard must still refuse a LAN peer (got ${lanCredential.status})`);
  if (lanCredential.status === 403)
    assert(/computer running CineBraid/i.test(lanCredential.body),
      "and it must be the LOOPBACK refusal, not the Origin one — the two guards answer different questions");
  void lanPeer;

  server.stop();
  server = null;

  /* =====================================================================
     PART C — with a passcode set, the boundary applies before the auth gate.
     ===================================================================== */
  writeProject({ editorPass: "boundary-editor-pass" });
  authServer = await startCineBraidServer({
    CINEBRAID_CONFIG_PATH: CONFIG_PATH, CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT,
    CINEBRAID_CIVITAI_AUTH_BASE: mock.authBase, CINEBRAID_CIVITAI_API_BASE: mock.apiBase, FAL_KEY: "",
  });
  const authPort = authServer.port;
  const authHost = `127.0.0.1:${authPort}`;
  const evilWithPass = await raw(authPort, {
    method: "POST", target: "/api/projects/boundary-project/backups",
    headers: { host: authHost, origin: "http://evil.example" },
  });
  assert.strictEqual(evilWithPass.status, 403, "a hostile Origin is refused whether or not a passcode is set");
  const badHostWithPass = await raw(authPort, { target: "/api/projects", headers: { host: "rebind.evil.example" } });
  assert.strictEqual(badHostWithPass.status, 403);
  /* And the ordinary auth gate still applies underneath it. */
  const unauth = await raw(authPort, { target: "/api/projects", headers: { host: authHost } });
  assert.strictEqual(unauth.status, 401, "the passcode gate is unchanged");

  console.log(
    "Request boundary suite passed: cross-origin upload, archive and backup mutations refused in the default "
    + "no-passcode posture and with a passcode set, same-host-different-port and Sec-Fetch-Site same-site refused, "
    + "same-origin and no-Origin local tooling still working, arbitrary Host refused on read and write with no "
    + "address disclosed, spoofed X-Forwarded-For / X-Forwarded-Host / Forwarded / X-Real-IP granting nothing, and "
    + "Phase 3 intact — OAuth start, a genuine cross-site provider callback, the callback still Host-gated, and the "
    + "socket loopback guard still refusing a LAN peer with its own message.",
  );
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || error);
    for (const s of [server, authServer]) if (s?.output) console.error(`--- server output ---\n${s.output}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    server?.stop();
    authServer?.stop();
    await mock?.close();
    fs.rmSync(TEMP, { recursive: true, force: true });
  });

/* A local stand-in for Civitai, shared by every Phase 3 suite.
 *
 * CI must never need a Civitai account, never make a public network request and
 * never spend Buzz, so the adapter is pointed here through
 * CINEBRAID_CIVITAI_AUTH_BASE / CINEBRAID_CIVITAI_API_BASE and every provider
 * interaction in the suites is against this process.
 *
 * It implements only what the preflight verified: the token endpoint's
 * authorization_code and refresh_token grants, and the authenticated
 * `GET /api/v1/me`. There is deliberately no Buzz endpoint and no tRPC surface —
 * a mock that answered a call CineBraid must never make would let that call be
 * written and still pass.
 *
 * Behaviour is driven by `server.script`, so a suite can make the next answer a
 * 429, a malformed body or a dropped connection without racing anything.
 */
const http = require("http");
const net = require("net");

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

/* One issued credential. `scope` is the decimal bitmask string Civitai actually
   returns — never a name list. */
function tokenPayload({ accessToken, refreshToken, expiresIn = 3600, scope = "1" }) {
  const payload = { access_token: accessToken, token_type: "Bearer", expires_in: expiresIn, scope };
  if (refreshToken) payload.refresh_token = refreshToken;
  return payload;
}

async function startMockCivitai(options = {}) {
  const port = await freePort();
  const state = {
    /* Requests seen, so a suite can assert what was and was not called. */
    requests: [],
    /* Authorization codes this mock will accept, mapped to what they issue. */
    codes: new Map(),
    /* Refresh tokens it will accept. */
    refreshTokens: new Map(),
    /* Access tokens and API keys it will recognise on /me, mapped to identity. */
    identities: new Map(),
    /* One-shot overrides: "rate-limit", "server-error", "malformed", "unauthorized",
       "forbidden", "hang", "extra-fields", "no-expiry", "rotate", "drop". */
    script: [],
    meCalls: 0,
    ...options,
  };

  function nextScripted() {
    return state.script.length ? state.script.shift() : "";
  }

  function send(res, status, body, contentType = "application/json") {
    res.statusCode = status;
    res.setHeader("content-type", contentType);
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const raw = req.method === "POST" ? await readBody(req) : "";
    state.requests.push({
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      authorization: req.headers.authorization || "",
      body: raw,
      form: req.method === "POST" ? Object.fromEntries(new URLSearchParams(raw)) : {},
    });

    /* Any endpoint CineBraid must never touch answers loudly rather than
       plausibly, so an accidental call fails the suite that made it. */
    if (url.pathname.startsWith("/api/trpc") || /buzz/i.test(url.pathname))
      return send(res, 599, { error: "FORBIDDEN_SURFACE_FOR_PHASE_3" });

    if (url.pathname === "/api/auth/oauth/token" && req.method === "POST") {
      const form = Object.fromEntries(new URLSearchParams(raw));
      const scripted = nextScripted();
      if (scripted === "drop") return req.socket.destroy();
      if (scripted === "rate-limit") return send(res, 429, { error: "rate_limited" });
      if (scripted === "server-error") return send(res, 503, { error: "unavailable" });
      if (scripted === "malformed") return send(res, 200, "{not json at all", "application/json");
      if (scripted === "no-access-token") return send(res, 200, { token_type: "Bearer", expires_in: 3600 });

      if (form.grant_type === "authorization_code") {
        const issued = state.codes.get(form.code);
        if (!issued) return send(res, 400, { error: "invalid_grant", error_description: "code not found" });
        /* PKCE is verified for real: the challenge recorded when the code was
           minted must be the S256 digest of the verifier presented now. */
        if (issued.codeChallenge && issued.codeChallenge !== require("crypto").createHash("sha256").update(String(form.code_verifier || ""), "ascii").digest("base64url"))
          return send(res, 400, { error: "invalid_grant", error_description: "pkce mismatch" });
        if (issued.redirectUri && issued.redirectUri !== form.redirect_uri)
          return send(res, 400, { error: "invalid_grant", error_description: "redirect mismatch" });
        state.codes.delete(form.code);
        if (issued.refreshToken) state.refreshTokens.set(issued.refreshToken, issued);
        if (issued.identity) state.identities.set(issued.accessToken, issued.identity);
        return send(res, 200, tokenPayload(issued));
      }

      if (form.grant_type === "refresh_token") {
        const known = state.refreshTokens.get(form.refresh_token);
        if (!known) return send(res, 400, { error: "invalid_grant", error_description: "refresh token revoked" });
        state.refreshTokens.delete(form.refresh_token);
        const next = {
          accessToken: `${known.accessToken}-r${state.requests.length}`,
          refreshToken: known.rotate === false ? known.refreshToken : `${known.refreshToken}-r${state.requests.length}`,
          expiresIn: scripted === "no-expiry" ? undefined : 3600,
          scope: known.scope || "1",
          identity: known.identity,
          rotate: known.rotate,
        };
        state.refreshTokens.set(next.refreshToken, next);
        if (next.identity) state.identities.set(next.accessToken, next.identity);
        const payload = tokenPayload(next);
        if (scripted === "no-expiry") delete payload.expires_in;
        return send(res, 200, payload);
      }
      return send(res, 400, { error: "unsupported_grant_type" });
    }

    if (url.pathname === "/api/v1/me" && req.method === "GET") {
      state.meCalls += 1;
      const scripted = nextScripted();
      if (scripted === "drop") return req.socket.destroy();
      /* Slow enough that a suite can do something else — disconnect, say — while
         this request is still in flight, which is the only way to exercise an
         overlap deterministically. */
      if (scripted === "slow") await new Promise((resolve) => setTimeout(resolve, 700));
      if (scripted === "rate-limit") return send(res, 429, { error: "rate limited" });
      if (scripted === "server-error") return send(res, 500, { error: "boom" });
      if (scripted === "forbidden") return send(res, 403, { error: "insufficient_scope" });
      if (scripted === "unauthorized") return send(res, 401, { error: "Unauthorized" });
      if (scripted === "malformed") return send(res, 200, "<html>not json</html>", "application/json");
      if (scripted === "no-id") return send(res, 200, { username: "ada" });

      const presented = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      const identity = state.identities.get(presented);
      if (!identity) return send(res, 401, { error: "Unauthorized" });
      const body = {
        id: identity.id,
        username: identity.username,
        tier: identity.tier || "free",
        status: identity.status || "active",
        isMember: !!identity.tier && identity.tier !== "free",
        subscriptions: [],
        /* Civitai returns these on a token-authenticated call. buzzLimit is a
           per-app SPEND CAP, not a balance — it is here precisely so a suite can
           assert CineBraid never reads it. */
        tokenScope: identity.tokenScope || "1",
        buzzLimit: 25000,
        subject: `civitai:${identity.id}`,
      };
      /* An account WITH an email still returns one; CineBraid must drop it. */
      if (identity.email) { body.email = identity.email; body.emailVerified = true; }
      if (scripted === "extra-fields") {
        body.somethingCivitaiAddedLater = { nested: true };
        body.experimentalFlags = ["a", "b"];
      }
      return send(res, 200, body);
    }

    return send(res, 404, { error: "not found" });
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

  return {
    port,
    state,
    authBase: `http://127.0.0.1:${port}`,
    apiBase: `http://127.0.0.1:${port}`,
    /* Mint an authorization code the token endpoint will accept. `codeChallenge`
       is recorded by the suite from the authorize URL CineBraid produced, so PKCE
       is proved end to end rather than assumed. */
    issueCode(code, issued) {
      state.codes.set(code, issued);
      return code;
    },
    registerToken(token, identity) {
      state.identities.set(token, identity);
    },
    registerRefreshToken(token, issued) {
      state.refreshTokens.set(token, issued);
      if (issued.identity) state.identities.set(issued.accessToken, issued.identity);
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

/* ---------------------------------------------------------------------------
   A real CineBraid server, started the way every other suite starts one: a child
   process with its own config file and projects root, so nothing under the
   repository's own data/ or projects/ is read or written.

   Its stdout and stderr are captured in full for the duration, because "the token
   never appears in a log line" is only checkable against the whole output. */
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");

async function startCineBraidServer(env = {}) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const collected = { output: "" };
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { collected.output += chunk; });
  child.stderr.on("data", (chunk) => { collected.output += chunk; });
  const deadline = Date.now() + 15000;
  for (;;) {
    try { if ((await fetch(`${base}/api/me`)).ok) break; } catch { /* not up yet */ }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`CineBraid did not start:\n${collected.output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  return {
    base,
    child,
    port,
    get output() { return collected.output; },
    async request(pathname, options = {}) {
      const response = await fetch(base + pathname, options);
      const text = await response.text();
      let body = null;
      try { body = JSON.parse(text); } catch { body = null; }
      return { status: response.status, ok: response.ok, body, text };
    },
    stop() { child.kill(); },
  };
}

module.exports = { ROOT, freePort, startCineBraidServer, startMockCivitai };

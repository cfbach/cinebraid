/* CineBraid request-provenance boundary — Host and Origin.
 *
 * This answers a different question from loopback-request.js, and both are needed.
 *
 *   loopback-request.js  "is the PEER this machine?"   — a socket fact, used to make
 *                        credential establishment unreachable from the network.
 *   this module          "did this request come from CineBraid's own page, and was
 *                        it addressed to CineBraid?" — an HTTP fact, used to stop a
 *                        page the user merely VISITED from driving the API.
 *
 * A loopback peer is exactly what a CSRF attack has: the victim's own browser, on
 * the victim's own machine, submitting a form to 127.0.0.1. The socket guard cannot
 * see anything wrong with that, and it is not supposed to. Equally, this module
 * cannot replace the socket guard: an attacker who controls a page can set neither
 * Origin nor Host, but a LAN peer with curl can set both to whatever it likes.
 * Neither check subsumes the other; removing either re-opens what the other closed.
 *
 * WHAT WAS OPEN. There was no Origin, Referer, CSRF-token or Host check anywhere.
 * In the shipped default posture (no passcode, so every caller is `editor`) an
 * unrelated web page could POST a form to the upload routes — which are mounted
 * with express.raw accepting every content type, and take the destination filename
 * from the QUERY STRING, so no JSON and no preflight is involved — write bytes into
 * the user's project, then archive the project with a bodyless form POST. Setting a
 * passcode did not help: SameSite=Lax is site-scoped and ignores the port, so any
 * page on 127.0.0.1 at any other port still rode the cookie. And with no Host
 * check, a DNS-rebinding page turned that blind write into same-origin READ of
 * everything the API serves.
 *
 * WHAT IS CLOSED, and what deliberately is not:
 *
 *   Host      every request, including GET. This is the rebinding boundary, and
 *             rebinding's payoff is reading responses, so it cannot be limited to
 *             mutations.
 *   Origin    state-changing methods only. A GET is where ordinary navigation
 *             lives — including the provider-originated OAuth callback, which is a
 *             cross-site GET by construction and must keep working.
 *
 * Requests with NO Origin and no Sec-Fetch metadata are allowed. That is a
 * deliberate threat-model choice, not an oversight: a browser has sent `Origin` on
 * every state-changing request for years, including form posts, so their absence
 * means a non-browser client — curl, a script, CineBraid's own test suites — and
 * those are legitimate local tooling. The attack this closes is "a page the user
 * visited", and a page cannot suppress Origin.
 */

const os = require("os");

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/* Loopback names and literals are always ours. `localhost` is included as a NAME
   because it is what a user types and what the OS resolves to a loopback address;
   it is not evidence of anything on its own, which is why the socket guard exists
   separately and never consults a name. */
const ALWAYS_LOCAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0:0:0:0:0:0:0:1"]);

function isLoopbackLiteral(hostname) {
  const name = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (name === "localhost" || name === "::1" || name === "0:0:0:0:0:0:0:1") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name);
}

/* Splits a Host or an Origin authority into { hostname, port }. IPv6 literals are
   bracketed, so the last colon is only a port separator when it is outside them. */
function splitAuthority(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.startsWith("[")) {
    const close = raw.indexOf("]");
    if (close === -1) return null;
    const rest = raw.slice(close + 1);
    if (rest && !rest.startsWith(":")) return null;
    return { hostname: raw.slice(0, close + 1).toLowerCase(), port: rest.slice(1) };
  }
  const parts = raw.split(":");
  if (parts.length > 2) return null;          /* a bare IPv6 with no brackets */
  return { hostname: parts[0].toLowerCase(), port: parts[1] || "" };
}

/* Every address this machine answers on, for the case where CineBraid is bound to
   0.0.0.0 or :: and the user reaches it at its LAN address. Read once — interfaces
   do not change during a run often enough to be worth re-reading per request, and a
   request that arrives on a newly added address is refused rather than admitted,
   which is the safe direction. */
function localAddresses() {
  const addresses = new Set();
  for (const list of Object.values(os.networkInterfaces()))
    for (const entry of list || []) {
      if (!entry?.address) continue;
      addresses.add(String(entry.address).toLowerCase().split("%")[0]);
    }
  return addresses;
}

/* The server's posture: what it is bound to, on which port, and which extra names
   the operator has declared legitimate.

   CINEBRAID_ALLOWED_HOSTS exists for the intentional configuration the rebinding
   rule would otherwise block — an mDNS name like `studio.local`, or a hostname a
   LAN user genuinely types. It is an explicit operator decision, never a default,
   and it is a name allow-list rather than a way to switch the check off. */
function createRequestPosture({ host = "127.0.0.1", port = 0, lanOptIn = false, allowedHosts = "" } = {}) {
  const bind = String(host || "").trim().toLowerCase();
  const wildcard = bind === "0.0.0.0" || bind === "::" || bind === "*";
  const declared = String(allowedHosts || "")
    .split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  const names = new Set([...ALWAYS_LOCAL, ...declared]);
  if (!wildcard && bind) names.add(bind);
  /* Bound to everything means "reachable at any of this machine's addresses", and
     those are the addresses a LAN user legitimately types. */
  const addresses = wildcard ? localAddresses() : new Set();
  return {
    port: String(port || ""),
    lanOptIn: !!lanOptIn,
    names,
    addresses,
    wildcard,
  };
}

/* A host CineBraid is willing to be addressed as. The port must match the port this
   server is actually listening on: without that, `evil.example:4477` and
   `evil.example:80` are equally acceptable and the name check does nothing. */
function isAllowedHostValue(value, posture) {
  const parsed = splitAuthority(value);
  if (!parsed || !parsed.hostname) return false;
  if (parsed.port && posture.port && parsed.port !== posture.port) return false;
  /* No port on the Host header means the default for the scheme (80). CineBraid
     serves plain http on its own port, so a portless Host is only ours if we
     happen to be on 80. */
  if (!parsed.port && posture.port && posture.port !== "80") return false;
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (posture.names.has(parsed.hostname) || posture.names.has(hostname)) return true;
  if (isLoopbackLiteral(hostname)) return true;
  return posture.addresses.has(hostname);
}

/* An Origin is a scheme + authority. The scheme is checked so `null` (a sandboxed
   iframe, a data: URL) and `file:` are refused rather than parsed into something
   that happens to compare equal. */
function isAllowedOriginValue(value, posture) {
  const raw = String(value || "").trim();
  if (!raw || raw === "null") return false;
  let url;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return isAllowedHostValue(url.host, posture);
}

const HOST_REFUSED = {
  code: "HOST_NOT_ALLOWED",
  message: "CineBraid did not recognise the address this request was sent to. Open CineBraid at its own address on this computer.",
};
const ORIGIN_REFUSED = {
  code: "ORIGIN_NOT_ALLOWED",
  message: "That request came from another site, so CineBraid did not act on it.",
};

/* One middleware, mounted before everything that can act.

   Order matters: the Host check runs first and applies to every method, because a
   rebinding page's goal is to READ. The Origin check then applies to the methods
   that change something. */
function createRequestBoundary(posture) {
  return function requestBoundary(req, res, next) {
    const refuse = (refusal) => {
      /* The refusal names neither the address that was sent nor the addresses that
         would have been accepted — the second would be a map of the machine. */
      if (req.path.startsWith("/api/"))
        return res.status(403).json({ error: refusal.message, code: refusal.code });
      return res.status(403).type("html").send(
        `<!doctype html><meta charset="utf-8"><title>CineBraid</title>`
        + `<body style="font:16px system-ui;margin:3rem;max-width:34rem"><h1 style="font-size:1.2rem">CineBraid did not answer that request</h1>`
        + `<p>${refusal.message}</p></body>`,
      );
    };

    if (!isAllowedHostValue(req.headers.host, posture)) return refuse(HOST_REFUSED);

    if (!STATE_CHANGING.has(String(req.method || "").toUpperCase())) return next();

    /* Sec-Fetch-Site is checked first and independently, because it catches the
       case Origin-matching cannot: a page on the SAME host at a DIFFERENT port is
       `same-site`, and the session cookie's SameSite=Lax rule considers that
       acceptable. CineBraid does not. */
    const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
    if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return refuse(ORIGIN_REFUSED);

    const origin = req.headers.origin;
    if (origin !== undefined && !isAllowedOriginValue(origin, posture)) return refuse(ORIGIN_REFUSED);

    return next();
  };
}

module.exports = {
  ALWAYS_LOCAL,
  HOST_REFUSED,
  ORIGIN_REFUSED,
  STATE_CHANGING,
  createRequestBoundary,
  createRequestPosture,
  isAllowedHostValue,
  isAllowedOriginValue,
  isLoopbackLiteral,
  splitAuthority,
};

/* CineBraid loopback request guard — "did this request come from THIS machine?"
 *
 * CineBraid may be started with --lan, which binds 0.0.0.0 so a phone or a second
 * workstation on the same network can reach the workspace. That is a deliberate
 * feature and this module does not change it. What it changes is that a small,
 * named set of operations — the ones that receive or create a provider credential
 * — become answerable only from the computer CineBraid is running on, whatever
 * the bind address is.
 *
 * The question is answered from the PEER SOCKET ADDRESS and from nothing else.
 * Every other candidate is written by the client:
 *
 *   Host:              a LAN peer can send `Host: localhost` verbatim.
 *   X-Forwarded-For:   invented by whoever sent it; no proxy is involved here.
 *   Forwarded:         same.
 *   query/body/origin: same, and worse — they are attacker-chosen strings.
 *
 * Hostnames cannot matter here for a second reason: `127.0.0.1.evil.example` is a
 * name an attacker controls that resolves wherever they like, and any check that
 * compares text rather than an address eventually falls for one. There is no name
 * resolution in this file at all.
 *
 * Express's `trust proxy` is deliberately NOT consulted. CineBraid runs no proxy,
 * and a proxy-aware variant of this check would mean the guard could be relaxed by
 * a configuration setting — turning a structural boundary into a preference.
 */

/* Node hands back an address in one of three shapes depending on how the socket
   was created. All three are the same machine:

     127.x.x.x          an IPv4 socket, anywhere in 127.0.0.0/8 (RFC 1122 §3.2.1.3)
     ::1                an IPv6 socket
     ::ffff:127.x.x.x   an IPv4-mapped IPv6 socket, which is what a dual-stack
                        listener reports for an IPv4 client — the common case on
                        Windows, and the one an over-strict check gets wrong

   A zone index (`::1%lo0`) may be appended on some platforms, so it is stripped
   before comparison rather than being allowed to fail the match. */
const IPV4_LOOPBACK = /^127\.(?:\d{1,3}\.){2}\d{1,3}$/;
const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

function isValidIpv4Octets(address) {
  return address.split(".").every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const value = Number(part);
    return value >= 0 && value <= 255;
  });
}

/* True only for an address that names this machine. Anything unparseable — an
   empty string, a hostname, a destroyed socket — is NOT loopback: the failure
   mode of this function must be refusal, never admission. */
function isLoopbackAddress(value) {
  if (typeof value !== "string") return false;
  const address = value.trim().split("%")[0].toLowerCase();
  if (!address) return false;
  if (address === "::1" || address === "0:0:0:0:0:0:0:1") return true;
  const mapped = IPV4_MAPPED.exec(address);
  if (mapped) return IPV4_LOOPBACK.test(mapped[1]) && isValidIpv4Octets(mapped[1]);
  if (IPV4_LOOPBACK.test(address)) return isValidIpv4Octets(address);
  return false;
}

/* The peer of the actual TCP connection. `req.ip` is not used: with `trust proxy`
   enabled it returns a header-derived value, which is precisely the thing this
   module exists not to believe. */
function requestPeerAddress(req) {
  return req?.socket?.remoteAddress || "";
}

function isLoopbackRequest(req) {
  return isLoopbackAddress(requestPeerAddress(req));
}

/* The refusal is deliberately uninformative about the server: no peer address, no
   bind address, no route internals. It says what the user has to do instead,
   because that is the only part of the answer that helps them. */
const LOOPBACK_REQUIRED_MESSAGE =
  "Civitai account connection must be completed on the computer running CineBraid.";
const LOOPBACK_REQUIRED_CODE = "LOOPBACK_REQUIRED";

function requireLoopbackRequest(req, res, next) {
  if (isLoopbackRequest(req)) return next();
  return res.status(403).json({ error: LOOPBACK_REQUIRED_MESSAGE, code: LOOPBACK_REQUIRED_CODE });
}

module.exports = {
  LOOPBACK_REQUIRED_CODE,
  LOOPBACK_REQUIRED_MESSAGE,
  isLoopbackAddress,
  isLoopbackRequest,
  requestPeerAddress,
  requireLoopbackRequest,
};

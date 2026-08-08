/* CineBraid account error vocabulary — one closed set, shared by the provider
 * seam and by every adapter behind it.
 *
 * It lives in its own module for two reasons. Structurally, the registry needs the
 * vocabulary and every adapter needs it too, so putting it in the registry would
 * make each adapter require the thing that requires it — a cycle that happens to
 * work in one load order and not the other. Substantively, this is the file that
 * decides what a user is allowed to be told about a provider failure, and that is
 * a decision worth being able to read in one place.
 *
 * The distinction the whole set is built around:
 *
 *   authoritative     the provider answered, and the answer was about the
 *                     credential: rejected, expired, insufficient. The connection
 *                     really has changed and may be downgraded.
 *   non-authoritative the provider did not answer, or said it was busy or broken.
 *                     Nothing is known about the credential and NOTHING may be
 *                     downgraded — "could not reach Civitai" is not "revoked".
 *
 * Every message here is the whole of what a browser is ever told. No provider
 * body, URL, header, OAuth code, token, socket address or stack trace crosses this
 * boundary; the adapter maps its dialect INTO this set and never past it.
 */

/* `statusCode` is what http-errors.js reads, so a route can hand one of these
   straight to the existing status mapper. */
class AccountProviderError extends Error {
  constructor(code, message, { statusCode = 502, authoritative = false, providerId = "" } = {}) {
    super(message);
    this.name = "AccountProviderError";
    this.code = code;
    this.statusCode = statusCode;
    this.authoritative = authoritative;
    this.providerId = providerId;
  }
}

const PROVIDER_ERRORS = {
  PROVIDER_UNKNOWN: { statusCode: 400, authoritative: true, message: "CineBraid does not know that account provider." },
  PROVIDER_NOT_CONFIGURED: { statusCode: 409, authoritative: true, message: "Civitai connection is not set up on this CineBraid yet." },
  PROVIDER_UNREACHABLE: { statusCode: 503, authoritative: false, message: "Civitai could not be reached." },
  PROVIDER_TIMEOUT: { statusCode: 504, authoritative: false, message: "Civitai did not answer in time." },
  PROVIDER_RATE_LIMITED: { statusCode: 429, authoritative: false, message: "Civitai is busy right now. Wait a moment and try again." },
  PROVIDER_UNAVAILABLE: { statusCode: 502, authoritative: false, message: "Civitai is having trouble right now." },
  PROVIDER_RESPONSE_INVALID: { statusCode: 502, authoritative: false, message: "Civitai returned a response CineBraid could not read." },
  CREDENTIAL_REJECTED: { statusCode: 401, authoritative: true, message: "Civitai rejected this credential." },
  CREDENTIAL_EXPIRED: { statusCode: 401, authoritative: true, message: "The Civitai connection has expired. Connect it again." },
  SCOPE_INSUFFICIENT: { statusCode: 403, authoritative: true, message: "Civitai did not grant CineBraid the permission this needs." },
  AUTHORIZATION_FAILED: { statusCode: 400, authoritative: true, message: "Civitai did not complete the connection." },
  AUTHORIZATION_EXPIRED: { statusCode: 400, authoritative: true, message: "The authorization request expired. Start the connection again." },
};

function providerError(code, providerId = "", overrideMessage = "") {
  const shape = PROVIDER_ERRORS[code] || PROVIDER_ERRORS.PROVIDER_RESPONSE_INVALID;
  return new AccountProviderError(code, overrideMessage || shape.message, {
    statusCode: shape.statusCode,
    authoritative: shape.authoritative,
    providerId,
  });
}

/* True only for a failure that is genuinely about the credential. Used at the one
   place it matters: deciding whether a failed verification may mark a connection
   expired, or must leave it connected and merely stale. */
function isAuthoritativeFailure(error) {
  return error instanceof AccountProviderError && error.authoritative === true;
}

module.exports = { AccountProviderError, PROVIDER_ERRORS, isAuthoritativeFailure, providerError };

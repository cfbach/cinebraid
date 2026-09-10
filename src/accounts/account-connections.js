/* CineBraid AccountConnection — the generic contract for "who the user is at a provider".
 *
 * An AccountConnection answers exactly one question: which account at which
 * provider has this CineBraid been authorized to act as. It deliberately does NOT
 * answer how generation executes, which models exist, or what anything costs —
 * those belong to a GenerationBackend, which is a separate thing with a separate
 * lifetime. Conflating them is what makes an integration impossible to replace.
 *
 * Three rules shape everything below.
 *
 *   Keyed by connectionId, never providerId.  A user may hold two Civitai
 *   accounts — a personal one and a studio one — and a contract keyed by provider
 *   cannot represent that. Every reference anywhere in CineBraid is a
 *   connectionId; providerId is a property OF a connection, not its identity.
 *
 *   Nothing here knows what Civitai is.  No endpoint, no bitmask, no response
 *   shape, no header. Provider knowledge lives behind the adapter seam in
 *   account-providers.js. This module is pure: no IO, no network, no clock beyond
 *   the timestamps its callers hand it.
 *
 *   credential is never projected.  safeConnection() is the ONLY way a connection
 *   reaches a browser, and it is built by naming the safe fields rather than by
 *   deleting the unsafe ones — a field added to credential later is therefore
 *   private by construction rather than by somebody remembering.
 *
 * Storage lives in config (`accounts[]`), guarded by the config secret registry.
 * No project file, shot, Bible entity, GenerationJob or MediaAsset carries any of
 * this, and none of them may learn to.
 */

const crypto = require("crypto");

/* ---------------------------------------------------------------------------
   Identity. 128 random bits, mirroring media-assets.js's assetId: wide enough
   that a duplicate is a programming error rather than a branch to be written. */
const CONNECTION_ID_PREFIX = "conn-";
const CONNECTION_ID_HEX_LENGTH = 32;
const CONNECTION_ID_PATTERN = /^conn-[0-9a-f]{32}$/;

function mintConnectionId() {
  return CONNECTION_ID_PREFIX + crypto.randomBytes(CONNECTION_ID_HEX_LENGTH / 2).toString("hex");
}
function isValidConnectionId(value) {
  return typeof value === "string" && CONNECTION_ID_PATTERN.test(value);
}

/* ---------------------------------------------------------------------------
   Vocabularies. Data, not switches.

   The status set is CLOSED, and the omission is deliberate: there is no
   "unreachable" status. A provider outage must not look like a revoked token, so
   an unreachable provider stays `connected` and is reported stale — the
   connection is still real, CineBraid simply has not confirmed it recently.
   Giving unreachability its own status would make every reader treat a network
   hiccup as a lost account, which is exactly the conflation this avoids. */
const CONNECTION_STATUSES = ["disconnected", "connecting", "connected", "expired", "error"];
const TOKEN_SOURCES = ["oauth", "api_key"];

/* How long an identity reading is trusted before a projection calls it stale.
   Fifteen minutes: usernames and tiers change rarely, and nothing here polls. */
const IDENTITY_TTL_MS = 15 * 60 * 1000;

/* Refreshed a little before the provider's own expiry so a request in flight does
   not cross the boundary. Sixty seconds, not a percentage: the skew that matters
   is clock drift and request latency, and neither scales with token lifetime. */
const EXPIRY_SKEW_MS = 60 * 1000;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}
function fail(errors, field, code, message) {
  errors.push({ field, code, message });
}

/* ---------------------------------------------------------------------------
   Identity. Display and reference data — never authority to spend.

   grantedScope is an OPAQUE string. Civitai's is a decimal bitmask; another
   provider's may be a space-delimited list of names, or absent entirely. Core
   stores it so an adapter can later say "this connection cannot do X, reconnect
   to grant it" instead of failing at call time; core never parses it, and it is
   never rendered to a user. */
function emptyIdentity() {
  return {
    providerUserId: "",
    displayName: "",
    avatarUrl: null,
    tier: "",
    accountStatus: "",
    grantedScope: "",
  };
}

/* The fields an adapter is permitted to contribute. Anything else it returns is
   dropped here rather than persisted, so an over-generous provider response
   cannot quietly widen what CineBraid stores — that is how an email ends up in a
   config file nobody meant to put one in. */
const IDENTITY_FIELDS = Object.keys(emptyIdentity());
/* Names that would mean a credential had been filed as identity. Checked by
   substring so `apiKey`, `access_token` and `refreshToken` are all caught. */
const CREDENTIAL_SHAPED = ["token", "secret", "password", "apikey", "api_key", "credential", "code_verifier", "codeverifier"];

function normalizeIdentity(raw) {
  const source = isRecord(raw) ? raw : {};
  const identity = emptyIdentity();
  for (const field of IDENTITY_FIELDS) {
    const value = source[field];
    if (value === null || value === undefined) continue;
    identity[field] = field === "avatarUrl" ? String(value) : String(value);
  }
  if (!isNonEmptyString(identity.avatarUrl)) identity.avatarUrl = null;
  return identity;
}

function validateIdentity(identity, errors, at = "identity") {
  if (!isRecord(identity)) {
    fail(errors, at, "missing", "identity is required (its members may be empty).");
    return;
  }
  if (!isNonEmptyString(identity.providerUserId))
    fail(errors, `${at}.providerUserId`, "missing",
      "providerUserId is required — it is the only stable handle on the remote account.");
  for (const key of Object.keys(identity)) {
    const lowered = key.toLowerCase();
    if (CREDENTIAL_SHAPED.some((needle) => lowered.includes(needle)))
      fail(errors, `${at}.${key}`, "credential-in-identity",
        "identity must never carry a credential-shaped field. Credentials belong in credential{}.");
  }
  if ("email" in identity)
    fail(errors, `${at}.email`, "not-permitted",
      "CineBraid does not store a provider account's email address.");
}

/* ---------------------------------------------------------------------------
   Balance.

   `supported` exists because without it "unsupported" and "zero" are the same
   value, and for a currency that conflation is dangerous: a UI would render a
   confident 0 for an account that may hold plenty. A provider with no readable
   balance reports supported:false and the projection says so in words. */
function unsupportedBalance() {
  return { supported: false, unit: null, amount: null, checkedAt: null };
}

/* ---------------------------------------------------------------------------
   Credential.

   Metadata about a secret, plus the secret. Which members are secret is declared
   in config.js's CONFIG_SECRETS, not here — this module must not become a second
   place where that question is answered.

   expiresAt is null for a credential that genuinely does not expire. A personal
   API key has no expiry; fabricating one so every branch looks alike would make
   CineBraid mark a perfectly good key expired on a schedule of its own invention. */
function emptyCredential(tokenSource = "oauth") {
  return {
    tokenSource,
    accessToken: "",
    refreshToken: "",
    apiKey: "",
    expiresAt: null,
  };
}

function validateCredential(credential, errors, at = "credential") {
  if (!isRecord(credential)) {
    fail(errors, at, "missing", "credential is required.");
    return;
  }
  if (!TOKEN_SOURCES.includes(credential.tokenSource))
    fail(errors, `${at}.tokenSource`, "unsupported-value",
      `tokenSource must be one of: ${TOKEN_SOURCES.join(", ")}.`);
  if (credential.expiresAt !== null && !isNonEmptyString(credential.expiresAt))
    fail(errors, `${at}.expiresAt`, "invalid-type",
      "expiresAt must be an ISO timestamp or null.");
  if (credential.tokenSource === "api_key") {
    if (isNonEmptyString(credential.refreshToken))
      fail(errors, `${at}.refreshToken`, "contradiction",
        "An API-key connection has no refresh token. A pasted key is not an OAuth grant.");
    if (credential.expiresAt !== null)
      fail(errors, `${at}.expiresAt`, "contradiction",
        "An API-key connection has no expiry — inventing one would expire a working key.");
  }
}

/* ---------------------------------------------------------------------------
   The connection record. */
function createConnection(input = {}) {
  const at = isNonEmptyString(input.createdAt) ? input.createdAt : new Date().toISOString();
  return {
    connectionId: isValidConnectionId(input.connectionId) ? input.connectionId : mintConnectionId(),
    providerId: String(input.providerId || ""),
    providerLabel: String(input.providerLabel || ""),
    status: CONNECTION_STATUSES.includes(input.status) ? input.status : "disconnected",
    identity: normalizeIdentity(input.identity),
    credential: { ...emptyCredential(input.credential?.tokenSource || "oauth"), ...(isRecord(input.credential) ? input.credential : {}) },
    balance: isRecord(input.balance) ? { ...unsupportedBalance(), ...input.balance } : unsupportedBalance(),
    createdAt: at,
    lastVerifiedAt: isNonEmptyString(input.lastVerifiedAt) ? input.lastVerifiedAt : null,
    lastError: isRecord(input.lastError) ? { code: String(input.lastError.code || ""), message: String(input.lastError.message || "") } : null,
  };
}

function validateConnection(connection, options = {}) {
  const errors = [];
  const at = options.at || "";
  const prefix = at ? `${at}.` : "";

  if (!isRecord(connection)) {
    fail(errors, at || "connection", "invalid-type", "An AccountConnection must be an object.");
    return { ok: false, errors };
  }

  if (!isValidConnectionId(connection.connectionId))
    fail(errors, `${prefix}connectionId`, "malformed-connection-id",
      'connectionId must be "conn-" followed by 32 lowercase hex characters.');
  if (!isNonEmptyString(connection.providerId))
    fail(errors, `${prefix}providerId`, "missing", "providerId is required.");
  if (connection.providerId === connection.connectionId)
    fail(errors, `${prefix}providerId`, "contradiction",
      "providerId and connectionId are different things and must never be equal.");
  if (!CONNECTION_STATUSES.includes(connection.status))
    fail(errors, `${prefix}status`, "unsupported-value",
      `status must be one of: ${CONNECTION_STATUSES.join(", ")}.`);
  if (!isNonEmptyString(connection.createdAt))
    fail(errors, `${prefix}createdAt`, "missing", "createdAt is required.");

  validateIdentity(connection.identity, errors, `${prefix}identity`);
  validateCredential(connection.credential, errors, `${prefix}credential`);

  if (!isRecord(connection.balance)) {
    fail(errors, `${prefix}balance`, "missing", "balance is required.");
  } else if (typeof connection.balance.supported !== "boolean") {
    fail(errors, `${prefix}balance.supported`, "invalid-type",
      "balance.supported must be a boolean — an unknown balance and a zero balance are different facts.");
  }

  return { ok: errors.length === 0, errors };
}

/* A whole `accounts[]` collection. Duplicate connectionIds are the one structural
   failure worth naming: two records that cannot be told apart make disconnect
   ambiguous. Two connections to the SAME remote account are legal — a user may
   deliberately hold one narrow and one broad grant. */
function validateConnectionList(accounts) {
  const errors = [];
  if (!Array.isArray(accounts)) {
    fail(errors, "accounts", "invalid-type", "accounts must be an array.");
    return { ok: false, errors };
  }
  const seen = new Set();
  accounts.forEach((connection, index) => {
    const result = validateConnection(connection, { at: `accounts[${index}]` });
    errors.push(...result.errors);
    if (isRecord(connection) && isValidConnectionId(connection.connectionId)) {
      if (seen.has(connection.connectionId))
        fail(errors, `accounts[${index}].connectionId`, "duplicate", "connectionId must be unique.");
      else seen.add(connection.connectionId);
    }
  });
  return { ok: errors.length === 0, errors };
}

/* ---------------------------------------------------------------------------
   Freshness and expiry. Both are pure functions of stored timestamps — nothing
   here contacts anything, and nothing here runs on a timer. */
function isStale(connection, now = Date.now(), ttlMs = IDENTITY_TTL_MS) {
  if (!isRecord(connection)) return true;
  const verified = Date.parse(connection.lastVerifiedAt || "");
  if (!Number.isFinite(verified)) return true;
  return now - verified > ttlMs;
}

function credentialExpired(connection, now = Date.now(), skewMs = EXPIRY_SKEW_MS) {
  const expiresAt = connection?.credential?.expiresAt;
  if (!isNonEmptyString(expiresAt)) return false;   /* null means "does not expire" */
  const at = Date.parse(expiresAt);
  if (!Number.isFinite(at)) return false;
  return now >= at - skewMs;
}

/* ---------------------------------------------------------------------------
   The browser projection.

   Built by NAMING the safe fields. A `delete copy.credential` would be one
   forgotten line away from shipping a token the day somebody adds
   credential.deviceSecret, and the whole point of this contract is that such a
   day cannot happen.

   grantedScope is stored but deliberately NOT projected: it is an internal
   provider encoding (a bitmask, for Civitai) with no meaning to a user, and the
   error voice rules forbid putting one in front of one. */
function safeConnection(connection, now = Date.now()) {
  if (!isRecord(connection)) return null;
  const identity = normalizeIdentity(connection.identity);
  return {
    connectionId: String(connection.connectionId || ""),
    providerId: String(connection.providerId || ""),
    providerLabel: String(connection.providerLabel || ""),
    status: CONNECTION_STATUSES.includes(connection.status) ? connection.status : "error",
    tokenSource: connection.credential?.tokenSource === "api_key" ? "api_key" : "oauth",
    identity: {
      providerUserId: identity.providerUserId,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
      tier: identity.tier,
      accountStatus: identity.accountStatus,
    },
    balance: { supported: connection.balance?.supported === true },
    createdAt: String(connection.createdAt || ""),
    lastVerifiedAt: connection.lastVerifiedAt || null,
    stale: isStale(connection, now),
    lastError: connection.lastError
      ? { code: String(connection.lastError.code || ""), message: String(connection.lastError.message || "") }
      : null,
  };
}

function safeConnectionList(accounts, now = Date.now()) {
  return (Array.isArray(accounts) ? accounts : []).map((connection) => safeConnection(connection, now)).filter(Boolean);
}

/* ---------------------------------------------------------------------------
   Collection operations. Pure: each returns a new array. */
function findConnection(accounts, connectionId) {
  if (!Array.isArray(accounts) || !isValidConnectionId(connectionId)) return null;
  return accounts.find((item) => isRecord(item) && item.connectionId === connectionId) || null;
}

function upsertConnection(accounts, connection) {
  const list = Array.isArray(accounts) ? [...accounts] : [];
  const index = list.findIndex((item) => isRecord(item) && item.connectionId === connection.connectionId);
  if (index === -1) list.push(connection);
  else list[index] = connection;
  return list;
}

/* Removal, not blanking. A disconnected account that lingers as a record with an
   emptied credential is a row a later reader has to decide about; removing it
   leaves nothing to misread, and the credential goes with it in one step. */
function removeConnection(accounts, connectionId) {
  const list = Array.isArray(accounts) ? accounts : [];
  return list.filter((item) => !(isRecord(item) && item.connectionId === connectionId));
}

module.exports = {
  CONNECTION_ID_HEX_LENGTH,
  CONNECTION_ID_PATTERN,
  CONNECTION_ID_PREFIX,
  CONNECTION_STATUSES,
  CREDENTIAL_SHAPED,
  EXPIRY_SKEW_MS,
  IDENTITY_FIELDS,
  IDENTITY_TTL_MS,
  TOKEN_SOURCES,
  createConnection,
  credentialExpired,
  emptyCredential,
  emptyIdentity,
  findConnection,
  isStale,
  isValidConnectionId,
  mintConnectionId,
  normalizeIdentity,
  removeConnection,
  safeConnection,
  safeConnectionList,
  unsupportedBalance,
  upsertConnection,
  validateConnection,
  validateConnectionList,
};

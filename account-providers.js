/* CineBraid account provider seam — the boundary generic account code may not cross.
 *
 * Everything a provider does differently lives behind an adapter registered here:
 * endpoint addresses, request encodings, response shapes, scope vocabulary, error
 * dialects. Generic account code knows only this interface and the shared error
 * vocabulary in account-errors.js, so a second provider is a new adapter file
 * rather than a new branch inside the routes.
 *
 * The registry is keyed by providerId, which is the ONE place a provider name is
 * allowed to select behaviour. Everywhere else a connection is addressed by
 * connectionId, because a user may hold two accounts at the same provider.
 */

const { AccountProviderError, PROVIDER_ERRORS, isAuthoritativeFailure, providerError } = require("./account-errors");

/* An adapter that is missing a member fails at registration, not at the moment a
   user clicks Connect. */
const REQUIRED_ADAPTER_MEMBERS = [
  "providerId", "label", "redirectPath",
  "buildAuthorization", "exchangeAuthorizationCode", "refreshCredential",
  "authenticateApiKey", "fetchIdentity", "isConfigured",
];

const adapters = new Map();

function registerAccountProvider(adapter) {
  for (const member of REQUIRED_ADAPTER_MEMBERS)
    if (!adapter?.[member]) throw new Error(`An account provider adapter must supply ${member}.`);
  adapters.set(adapter.providerId, adapter);
  return adapter;
}

/* An unknown provider is a typed refusal, not a TypeError three frames later from
   a lookup that returned undefined. */
function getAccountProvider(providerId) {
  const adapter = adapters.get(String(providerId || ""));
  if (!adapter) throw providerError("PROVIDER_UNKNOWN", String(providerId || ""));
  return adapter;
}

function hasAccountProvider(providerId) {
  return adapters.has(String(providerId || ""));
}

/* What a browser is told about a provider: what it CAN do, never where it lives.
   Endpoint addresses are adapter-internal and appear in no response. */
function listAccountProviders(config = {}) {
  return [...adapters.values()].map((adapter) => ({
    providerId: adapter.providerId,
    label: adapter.label,
    supportsOAuth: adapter.supportsOAuth !== false,
    supportsApiKey: adapter.supportsApiKey !== false,
    balanceSupported: adapter.balanceSupported === true,
    oauthConfigured: adapter.isConfigured(config) === true,
  }));
}

registerAccountProvider(require("./account-provider-civitai"));

module.exports = {
  AccountProviderError,
  PROVIDER_ERRORS,
  getAccountProvider,
  hasAccountProvider,
  isAuthoritativeFailure,
  listAccountProviders,
  providerError,
  registerAccountProvider,
};

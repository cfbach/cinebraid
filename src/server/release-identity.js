/* CineBraid release identity — the one authoritative version source.

   `package.json` "version" is the only place a CineBraid release version is
   written by hand. Everything a release needs — the window title, the asset
   cache-busting query strings, the Git tag, the archive filenames and the
   display name testers see — is derived from it here.

   `tests/version-consistency.js` fails the build when any of those surfaces
   drift, and `scripts/sync-version.js` re-stamps the derived ones. Neither the
   project schema markers (`meta.hubVersion`, `meta.schemaVersion`, project
   `meta.version`) nor the API contract version live here: those describe stored
   project data, not the application build, and must never follow this value. */

const fs = require("fs");
const path = require("path");

/* Pre-release channels that get a human-readable display name. A channel that
   is not listed still produces a valid identity — it simply displays its raw
   version rather than an invented label. */
const CHANNEL_LABELS = {
  private: "Private Test",
};

function readPackageVersion(root = path.resolve(__dirname, "../..")) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  return String(pkg.version || "").trim();
}

function releaseIdentity(version = readPackageVersion()) {
  const raw = String(version || "").trim();
  if (!raw) throw new Error("package.json does not declare a version");

  const [core, ...preParts] = raw.split("-");
  const prerelease = preParts.join("-");
  const [channel, iteration] = prerelease ? prerelease.split(".") : ["", ""];
  const label = CHANNEL_LABELS[channel];

  const displayName = label && iteration
    ? `CineBraid ${core} ${label} ${iteration}`
    : `CineBraid ${raw}`;

  return {
    version: raw,
    core,
    channel: channel || "stable",
    displayName,
    tag: `v${raw}`,
    isPrerelease: Boolean(prerelease),
    archiveBase: `cinebraid-${raw}`,
    windowsArchive: `cinebraid-${raw}-windows.zip`,
    runtimeArchive: `cinebraid-${raw}-runtime.tar.gz`,
  };
}

module.exports = { releaseIdentity, readPackageVersion, CHANNEL_LABELS };

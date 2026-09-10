"use strict";

/* The output scanner: an independent second look at what migration produced.

   M080 already refuses credential-shaped and machine-specific values at the
   SOURCE, before any rule can carry one. This scans the RESULT. Two mechanisms
   for one property, on purpose, and for the same reason INV-R1 is proven twice
   in P1: each fails vacuously in a different direction. The quarantine can only
   refuse what it recognised on the way in; the scanner can only see what is
   actually in the document, including anything a rule synthesised rather than
   copied.

   Decision 17 names what must never be serialised: API keys, OAuth tokens,
   authSecret, passcodes, credentials, machine hostnames, absolute paths of
   either flavour, localhost endpoints, provider base URLs, temp/cache paths,
   FAL request IDs, retry and lease state, and any per-machine configuration.
   The audit's own instruction is that a failing scan BLOCKS the write - it does
   not warn - so these are error-severity and a migration carrying one is not ok.

   `isProjectRelativePath` is reused from `media-assets.js` rather than
   reimplemented: that predicate already rejects absolute, drive-qualified, UNC
   and `..` paths and is already tested. The rule existed; it was simply never
   applied to project.json. */

const { isProjectRelativePath } = require("../src/media/media-assets");
const { keyLooksSecret, valueLooksSensitive } = require("./ofp-migrate-rules");
const { makeMigrationDiagnostic } = require("./ofp-migrate-diagnostics");

function encodeToken(token) {
  return String(token).replace(/~/g, "~0").replace(/\//g, "~1");
}

/* Keys whose VALUE is a path by contract, so the project-relative predicate
   applies rather than the generic prose scan. Nothing in 1.0-draft.1 core is one
   of these; the list exists because the CineBraid extension carries legacy
   filenames, and a filename that turned into `C:\Users\...` is precisely the
   leak to catch.

   DELIBERATELY NOT ON THIS LIST: a bare `path`. The contract declares
   `statements[].target.path` as an RFC 6901 pointer, which starts with "/" and
   is therefore "absolute" to any filesystem predicate - so a generic `path` rule
   would fight the contract and report every statement in the document. Genuine
   leaks under such a key are still caught by the sensitive-value scan below,
   which is what recognises `C:\`, a UNC root and `/Users/...` wherever they
   appear and under whatever key. */
const PATH_VALUED_KEYS = new Set(["filename", "storagePath", "mediaRoot", "outputRoot", "approvedFile", "winner", "selectedCandidate", "finalStillFile", "finalVideoFile", "approvedMotionFile"]);

function scanMigrationOutput(document) {
  const findings = [];

  function visit(value, pointer, key) {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${pointer}/${index}`, null));
      return;
    }
    if (value && typeof value === "object") {
      for (const [childKey, child] of Object.entries(value)) {
        if (keyLooksSecret(childKey))
          findings.push(makeMigrationDiagnostic("migration.output.secret-leak",
            `${pointer}/${encodeToken(childKey)}: the key ${JSON.stringify(childKey)} names a credential; Decision 17 forbids serialising one into a project document`,
            { where: `${pointer}/${encodeToken(childKey)}` }));
        visit(child, `${pointer}/${encodeToken(childKey)}`, childKey);
      }
      return;
    }
    if (typeof value !== "string" || value === "") return;
    const sensitive = valueLooksSensitive(value);
    if (sensitive) {
      const code = sensitive === "a URL carrying credentials" ? "migration.output.secret-leak" : "migration.output.absolute-path";
      findings.push(makeMigrationDiagnostic(code, `${pointer}: the value is ${sensitive} and must not be serialised into a portable document`, { where: pointer }));
      return;
    }
    /* A field that is a path by contract gets the stricter predicate: it must be
       project-relative, so a bare filename passes and anything that could only
       be resolved on one machine does not. */
    if (key !== null && PATH_VALUED_KEYS.has(key) && !isProjectRelativePath(value))
      findings.push(makeMigrationDiagnostic("migration.output.absolute-path",
        `${pointer}: ${JSON.stringify(value)} is not a project-relative path`, { where: pointer }));
  }

  visit(document, "", null);
  return findings;
}

module.exports = { scanMigrationOutput, PATH_VALUED_KEYS };

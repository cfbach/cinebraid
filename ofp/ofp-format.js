"use strict";

/* Format identity and the draft -> 1.0 version lifecycle.

   The whole point of this module is that a reader can tell, from one field,
   what contract a document claims and whether this build may write it. Frozen
   P0 §7: `format.id` is "open-film-project" from the first draft byte and never
   changes; released contracts are exactly MAJOR.MINOR; unreleased contracts are
   MAJOR.MINOR-draft.N.

   `format.version` is the OFP CONTRACT version. `format.generator.version` is
   the CineBraid application version. They are different numbers with different
   lifecycles and conflating them is the confusion this lane exists to end - a
   document written by CineBraid 6.7 says "1.0-draft.1", never "6.7". */

const OFP_FORMAT_ID = "open-film-project";

/* The contract this build implements. Bumping it is a deliberate act: draft
   revisions carry no migration guarantee to one another (P0 §7 rule 2), so a
   bump makes every previously written draft read-only to this build. */
const OFP_CONTRACT_VERSION = "1.0-draft.1";

const FORMAT_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-draft\.(0|[1-9]\d*))?$/;

/* Document classes. `access` is what this build may do with the document, and
   it is advisory to callers rather than enforced here: P1 validates and reports,
   it never writes anything at all. */
const DOCUMENT_CLASS = {
  LEGACY: "legacy-cinebraid",
  SUPPORTED_DRAFT: "supported-draft",
  OLDER_DRAFT: "older-draft",
  NEWER_DRAFT: "newer-draft",
  STABLE: "stable",
  NEWER_STABLE: "newer-unsupported-stable",
  FORMAT_INVALID: "format-block-invalid",
  UNRECOGNIZED: "unrecognized",
};

function parseFormatVersion(text) {
  if (typeof text !== "string") return null;
  const match = FORMAT_VERSION_PATTERN.exec(text);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    /* null means released. A released contract sorts AFTER every draft of the
       same MAJOR.MINOR, because that is the order they happen in. */
    draft: match[3] === undefined ? null : Number(match[3]),
  };
}

function compareFormatVersions(a, b) {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.draft === b.draft) return 0;
  if (a.draft === null) return 1;
  if (b.draft === null) return -1;
  return a.draft < b.draft ? -1 : 1;
}

function isDraftVersion(text) {
  const parsed = parseFormatVersion(text);
  return parsed !== null && parsed.draft !== null;
}

/* Legacy CineBraid documents are recognised by what they are, not by what they
   are missing: a numeric `schemaVersion` and no `format` block. Getting this
   right is what keeps a real project out of the draft lane - a document we
   cannot confidently call OFP is never treated as OFP. */
function looksLegacyCineBraid(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) return false;
  if (document.format !== undefined) return false;
  return typeof document.schemaVersion === "number" || typeof document.schemaVersion === "string";
}

/* Classify a parsed document against the contract this build implements.

   Returns { documentClass, access, version, supportedVersion, reason }.
   `access` is one of "read-write", "read-only", "none". Nothing here writes,
   migrates, or converts; the classification is the whole output. */
function classifyDocument(document) {
  const supported = parseFormatVersion(OFP_CONTRACT_VERSION);

  if (!document || typeof document !== "object" || Array.isArray(document))
    return { documentClass: DOCUMENT_CLASS.UNRECOGNIZED, access: "none", version: null, supportedVersion: OFP_CONTRACT_VERSION, reason: "document root is not a JSON object" };

  if (looksLegacyCineBraid(document))
    return {
      documentClass: DOCUMENT_CLASS.LEGACY,
      /* Read-only from the OFP side. Legacy projects keep their own loader and
         their own lineage; P0 §7 rule 4 is that they never enter the draft lane. */
      access: "read-only",
      version: null,
      supportedVersion: OFP_CONTRACT_VERSION,
      reason: `legacy CineBraid document (schemaVersion ${JSON.stringify(document.schemaVersion)})`,
    };

  const format = document.format;
  if (!format || typeof format !== "object" || Array.isArray(format))
    return { documentClass: DOCUMENT_CLASS.FORMAT_INVALID, access: "none", version: null, supportedVersion: OFP_CONTRACT_VERSION, reason: "format block is missing or not an object" };

  if (format.id !== OFP_FORMAT_ID)
    return { documentClass: DOCUMENT_CLASS.FORMAT_INVALID, access: "none", version: null, supportedVersion: OFP_CONTRACT_VERSION, reason: `format.id is ${JSON.stringify(format.id)}, expected ${JSON.stringify(OFP_FORMAT_ID)}` };

  const version = parseFormatVersion(format.version);
  if (version === null)
    return { documentClass: DOCUMENT_CLASS.FORMAT_INVALID, access: "none", version: null, supportedVersion: OFP_CONTRACT_VERSION, reason: `format.version ${JSON.stringify(format.version)} does not match MAJOR.MINOR or MAJOR.MINOR-draft.N` };

  const order = compareFormatVersions(version, supported);
  if (order === 0)
    return { documentClass: DOCUMENT_CLASS.SUPPORTED_DRAFT, access: "read-write", version: format.version, supportedVersion: OFP_CONTRACT_VERSION, reason: "written at the contract revision this build implements" };

  if (order < 0)
    return {
      documentClass: version.draft === null ? DOCUMENT_CLASS.STABLE : DOCUMENT_CLASS.OLDER_DRAFT,
      /* An older draft is read-only because draft revisions carry no migration
         guarantee to one another. That is deliberate: it is what buys P1-P6 the
         freedom to restructure without writing throwaway migrations. */
      access: "read-only",
      version: format.version,
      supportedVersion: OFP_CONTRACT_VERSION,
      reason: version.draft === null
        ? `stable contract ${format.version} predates this build's draft lane`
        : `draft revision ${format.version} is older than ${OFP_CONTRACT_VERSION}; drafts carry no migration guarantee to one another`,
    };

  return {
    documentClass: version.draft === null ? DOCUMENT_CLASS.NEWER_STABLE : DOCUMENT_CLASS.NEWER_DRAFT,
    access: "read-only",
    version: format.version,
    supportedVersion: OFP_CONTRACT_VERSION,
    /* A released MAJOR.MINOR sorts after every draft of the same number, so a
       document claiming "1.0" while this build implements "1.0-draft.1" is from
       the future. Saying so plainly is more honest than pretending 1.0 shipped. */
    reason: version.draft === null
      ? `stable contract ${format.version} is newer than this build's ${OFP_CONTRACT_VERSION}; OFP 1.0 is not released`
      : `draft revision ${format.version} is newer than this build's ${OFP_CONTRACT_VERSION}`,
  };
}

module.exports = {
  OFP_FORMAT_ID,
  OFP_CONTRACT_VERSION,
  FORMAT_VERSION_PATTERN,
  DOCUMENT_CLASS,
  parseFormatVersion,
  compareFormatVersions,
  isDraftVersion,
  looksLegacyCineBraid,
  classifyDocument,
};

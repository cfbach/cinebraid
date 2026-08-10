"use strict";

/* The diagnostic registry.

   Every code the validator can emit is declared here with its severity and the
   validation mode that owns it. A registry rather than free-form strings, for
   three reasons: a caller can switch on a code without parsing prose, a test
   can assert that nothing emits an unregistered code, and the severity of a
   finding is a property of the contract rather than of whichever call site
   happened to produce it.

   Severity is load-bearing and is NOT a synonym for importance:

     error    the document violates the contract
     warning  the document is valid and something about it is worth knowing
     info     classification and counts

   `id.not-portable` is the case that proves the distinction matters. Five real
   legacy shot IDs look like `INT-1->2`. They satisfy the identifier floor, so
   they are legal, they round-trip verbatim and nothing renames them - but ">"
   is illegal in a Windows path segment and shot IDs are directory names today,
   so those shots have never been able to hold a take on this platform. That is
   worth reporting and must never become an error, because an error is what
   would eventually tempt somebody to "fix" it with a rename. */

const MODES = {
  STRUCTURAL: "structural",
  SEMANTIC: "semantic",
  PORTABILITY: "portability",
  COMPATIBILITY: "compatibility",
};

const SEVERITY = { ERROR: "error", WARNING: "warning", INFO: "info" };

const DIAGNOSTICS = {
  /* ---- structural ---- */
  "json.syntax": { severity: SEVERITY.ERROR, mode: MODES.STRUCTURAL, summary: "the document is not well-formed JSON" },
  "json.bom": { severity: SEVERITY.ERROR, mode: MODES.STRUCTURAL, summary: "the document begins with a byte-order mark" },
  "json.duplicate-key": { severity: SEVERITY.ERROR, mode: MODES.STRUCTURAL, summary: "an object declares the same key twice" },
  "json.depth": { severity: SEVERITY.ERROR, mode: MODES.STRUCTURAL, summary: "the document nests too deeply to inspect" },
  "schema.type": { severity: SEVERITY.ERROR, mode: MODES.STRUCTURAL, summary: "a value has the wrong JSON type" },
  "schema.required.missing": { severity: SEVERITY.ERROR, mode: MODES.STRUCTURAL, summary: "a required key is absent" },
  "schema.const": { severity: SEVERITY.ERROR, mode: MODES.STRUCTURAL, summary: "a fixed value does not match" },
  "schema.pattern": { severity: SEVERITY.ERROR, mode: MODES.STRUCTURAL, summary: "a string does not match its declared pattern" },
  /* Warning, never coerced, never rewritten. A newer contract revision may add
     enum members, and a reader that silently replaced an unrecognised value
     with a default would destroy production data to make itself comfortable. */
  "schema.enum.unknown": { severity: SEVERITY.WARNING, mode: MODES.STRUCTURAL, summary: "an enum carries a value this contract revision does not declare" },
  /* Also a warning, and for the same forward-compatibility reason. */
  "schema.unknown-property": { severity: SEVERITY.WARNING, mode: MODES.STRUCTURAL, summary: "a record carries a key this contract revision does not declare" },

  /* ---- semantic ---- */
  "id.invalid": { severity: SEVERITY.ERROR, mode: MODES.SEMANTIC, summary: "an identifier violates the portability floor" },
  "id.duplicate": { severity: SEVERITY.ERROR, mode: MODES.SEMANTIC, summary: "two records in one collection share an identifier" },
  "id.entity-collision": { severity: SEVERITY.ERROR, mode: MODES.SEMANTIC, summary: "one identifier is used by two different entity collections" },
  "ref.unresolved": { severity: SEVERITY.ERROR, mode: MODES.SEMANTIC, summary: "a cross-reference names a record that does not exist" },
  "subject.unresolvable": { severity: SEVERITY.ERROR, mode: MODES.SEMANTIC, summary: "a subject reference does not resolve" },
  "statement.kind.unknown": { severity: SEVERITY.ERROR, mode: MODES.SEMANTIC, summary: "a statement declares a kind outside the five acts" },
  "statement.target.unresolvable": { severity: SEVERITY.ERROR, mode: MODES.SEMANTIC, summary: "a statement's target does not resolve" },
  "statement.target.array-traversal": { severity: SEVERITY.ERROR, mode: MODES.SEMANTIC, summary: "a statement's path would enter an array" },
  "statement.target.malformed": { severity: SEVERITY.ERROR, mode: MODES.SEMANTIC, summary: "a statement's target is not a valid subject/path pair" },
  "statement.claim.malformed": { severity: SEVERITY.ERROR, mode: MODES.SEMANTIC, summary: "a statement's claim hash is missing or malformed" },
  /* Stale is a warning: the document is legal and the statement is retained.
     Silent removal is the failure mode this whole contract exists to end. */
  "statement.stale": { severity: SEVERITY.WARNING, mode: MODES.SEMANTIC, summary: "the value a statement was made about has changed since" },
  "statement.stale.approval": { severity: SEVERITY.WARNING, mode: MODES.SEMANTIC, summary: "a stale approval, which confers no approval" },
  "statement.candidates.missing": { severity: SEVERITY.ERROR, mode: MODES.SEMANTIC, summary: "a disputed statement carries no candidates" },
  "statement.actor.missing": { severity: SEVERITY.ERROR, mode: MODES.SEMANTIC, summary: "an approved statement names no actor" },
  "statement.actor.not-human": { severity: SEVERITY.ERROR, mode: MODES.SEMANTIC, summary: "an approved statement names a non-human actor" },

  /* ---- portability ---- */
  "id.not-portable": { severity: SEVERITY.WARNING, mode: MODES.PORTABILITY, summary: "an identifier is legal but outside the id-portable profile" },

  /* ---- compatibility ---- */
  "format.invalid": { severity: SEVERITY.ERROR, mode: MODES.COMPATIBILITY, summary: "the format block is missing, malformed or names another format" },
  "format.unsupported": { severity: SEVERITY.WARNING, mode: MODES.COMPATIBILITY, summary: "the document declares a contract revision this build cannot write" },
  "format.legacy": { severity: SEVERITY.INFO, mode: MODES.COMPATIBILITY, summary: "the document is a legacy CineBraid project, not an OFP document" },
  "format.supported": { severity: SEVERITY.INFO, mode: MODES.COMPATIBILITY, summary: "the document is written at the contract revision this build implements" },
};

function severityOf(code) {
  const entry = DIAGNOSTICS[code];
  if (!entry) throw new Error(`unregistered diagnostic code: ${code}`);
  return entry.severity;
}

function modeOf(code) {
  const entry = DIAGNOSTICS[code];
  if (!entry) throw new Error(`unregistered diagnostic code: ${code}`);
  return entry.mode;
}

/* A diagnostic is a plain object so it can cross a process boundary, a JSON
   response or a CLI unchanged. `target` is the fused subject#path string when
   the finding is about an addressable claim; `where` is a document location for
   everything else. Both are strings, and both may be empty. */
function makeDiagnostic(code, message, { target = "", where = "", detail } = {}) {
  const entry = DIAGNOSTICS[code];
  if (!entry) throw new Error(`unregistered diagnostic code: ${code}`);
  const diagnostic = { code, severity: entry.severity, mode: entry.mode, message, target, where };
  if (detail !== undefined) diagnostic.detail = detail;
  return diagnostic;
}

module.exports = { MODES, SEVERITY, DIAGNOSTICS, severityOf, modeOf, makeDiagnostic };

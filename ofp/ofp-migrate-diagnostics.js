"use strict";

/* Migration diagnostics, in their own registry.

   Deliberately NOT added to `ofp-diagnostics.js`. That registry is the
   VALIDATOR's contract - a caller switching on one of its codes is asking "is
   this document legal", and a migration finding is a different question with a
   different audience ("what happened to my project?"). Merging them would make
   every validator consumer see codes that can never appear in a document it
   reads, and would put P2 vocabulary inside a merged P1 file for no gain.

   Same shape, same discipline: severity is a property of the contract rather
   than of the call site, and emitting an unregistered code throws. */

const SEVERITY = { ERROR: "error", WARNING: "warning", INFO: "info" };

const MIGRATION_DIAGNOSTICS = {
  /* ---- what we were handed ---- */
  "migration.source.unrecognised": { severity: SEVERITY.ERROR, summary: "the document is not a recognisable CineBraid project" },
  "migration.source.foreign": { severity: SEVERITY.ERROR, summary: "the document belongs to another application" },
  "migration.source.already-ofp": { severity: SEVERITY.ERROR, summary: "the document is already an Open Film Project document" },
  "migration.source.sniffed": { severity: SEVERITY.INFO, summary: "the source generation was identified by shape because no schema marker exists" },

  /* ---- what happened ---- */
  "migration.applied": { severity: SEVERITY.INFO, summary: "a migration rule ran and claimed source values" },
  "migration.id.minted": { severity: SEVERITY.INFO, summary: "a record with no identifier was given a deterministic one" },
  /* A warning, never an error, and never a rename. Promoting it is what would
     eventually tempt somebody to "fix" a legacy identifier, and a rename
     destroys the only link between a shot and its history. */
  "migration.id.not-portable": { severity: SEVERITY.WARNING, summary: "a legacy identifier is legal but outside the id-portable profile; it is preserved verbatim" },
  "migration.id.invalid": { severity: SEVERITY.ERROR, summary: "a legacy identifier violates the portability floor and is preserved rather than renamed" },
  "migration.code.unresolved": { severity: SEVERITY.WARNING, summary: "a legacy dependency token names nothing; the raw token is preserved" },
  "migration.ref.unresolved": { severity: SEVERITY.WARNING, summary: "a migrated cross-reference names a record that does not exist" },
  "migration.review.required": { severity: SEVERITY.WARNING, summary: "a value needs a human decision that migration must not make" },
  "migration.secret.quarantined": { severity: SEVERITY.WARNING, summary: "a credential-shaped value was refused entry to the OFP document" },
  "migration.path.quarantined": { severity: SEVERITY.WARNING, summary: "an absolute path or local endpoint was refused entry to the OFP document" },

  /* ---- the invariants ---- */
  "migration.unaccounted-source-value": { severity: SEVERITY.ERROR, summary: "a source value reached no migration rule and has no disposition" },
  "migration.statement.unresolvable": { severity: SEVERITY.ERROR, summary: "a migration-created statement targets something that does not resolve in the result" },
  "migration.statement.kind-refused": { severity: SEVERITY.ERROR, summary: "a migration rule tried to write a statement kind migration may not write" },
  "migration.count.unexplained": { severity: SEVERITY.ERROR, summary: "a record count changed and no rule explains the change" },
  "migration.identity.lost": { severity: SEVERITY.ERROR, summary: "a legacy identifier is not present in the result and no rule explains its absence" },
  "migration.output.secret-leak": { severity: SEVERITY.ERROR, summary: "the migrated document carries a credential" },
  "migration.output.absolute-path": { severity: SEVERITY.ERROR, summary: "the migrated document carries an absolute host path or a local endpoint" },
  "migration.validation.failed": { severity: SEVERITY.ERROR, summary: "the migrated document does not pass the contract validator" },
  "migration.destination.unsafe": { severity: SEVERITY.ERROR, summary: "the requested destination would touch the source project" },
};

function makeMigrationDiagnostic(code, message, { where = "", target = "", rule = "", detail } = {}) {
  const entry = MIGRATION_DIAGNOSTICS[code];
  if (!entry) throw new Error(`unregistered migration diagnostic code: ${code}`);
  const diagnostic = { code, severity: entry.severity, message, where, target, rule };
  if (detail !== undefined) diagnostic.detail = detail;
  return diagnostic;
}

function migrationSeverityOf(code) {
  const entry = MIGRATION_DIAGNOSTICS[code];
  if (!entry) throw new Error(`unregistered migration diagnostic code: ${code}`);
  return entry.severity;
}

module.exports = { MIGRATION_DIAGNOSTICS, SEVERITY, makeMigrationDiagnostic, migrationSeverityOf };

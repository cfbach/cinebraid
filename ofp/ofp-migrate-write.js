"use strict";

/* Migrate to a COPY, and only ever to a copy.

   This is the one module in P2 that writes a byte, and every constraint on it
   is a constraint about what it must not touch:

     - the destination is supplied by the caller. There is no default, and in
       particular there is no default that puts the result beside the source.
       "Write it next to the original" is how a migration ends up looking like a
       save;
     - the destination may not BE the source, may not be inside it, and may not
       contain it;
     - the destination file may not already exist;
     - a destination directory that already holds other content is refused unless
       the caller says otherwise in as many words;
     - the whole operation runs inside the INV-R1 guard over the SOURCE root, so
       "the original is untouched" is enforced by mechanism rather than by the
       absence of a line of code that would touch it;
     - the write itself is atomic: a temporary file in the destination directory,
       then a rename, so an interrupted run leaves no half-written document.

   Nothing here is wired into CineBraid's normal open or save. There is no route,
   no button and no startup path that reaches it. */

const fs = require("fs");
const path = require("path");

const { withNoWritesUnder } = require("./ofp-fs-guard");
const { CANONICAL_FILENAME, LEGACY_FILENAME } = require("./ofp-read");
const { parseJsonStrict } = require("./ofp-json");
const { previewLegacyMigration } = require("./ofp-migrate");
const { makeMigrationDiagnostic } = require("./ofp-migrate-diagnostics");

class MigrationDestinationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "MigrationDestinationError";
    this.code = code;
  }
}

function contains(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/* Returns { ok } or throws. Separated from the write so a caller - or a test -
   can ask "would this be refused?" without a filesystem in a particular state
   being the thing that answers. */
function checkDestination(sourceRoot, destinationRoot, { allowExistingDirectory = false, filename = CANONICAL_FILENAME } = {}) {
  const source = path.resolve(sourceRoot);
  const destination = path.resolve(destinationRoot);

  if (source === destination)
    throw new MigrationDestinationError(`the destination is the source project (${destination}). Migration always has a separate source and target.`, "same-path");
  if (contains(source, destination))
    throw new MigrationDestinationError(`the destination ${destination} is inside the source project ${source}. Writing a migrated document inside the project being migrated is how a migration becomes a save.`, "inside-source");
  if (contains(destination, source))
    throw new MigrationDestinationError(`the source project ${source} is inside the destination ${destination}; the write could reach the original.`, "contains-source");

  const target = path.join(destination, filename);
  if (fs.existsSync(target))
    throw new MigrationDestinationError(`${target} already exists. Migration never overwrites an existing document.`, "exists");

  if (fs.existsSync(destination)) {
    const entries = fs.readdirSync(destination);
    if (entries.length && !allowExistingDirectory)
      throw new MigrationDestinationError(`${destination} already contains ${entries.length} entr${entries.length === 1 ? "y" : "ies"}. Pass allowExistingDirectory to write into it deliberately.`, "not-empty");
  }
  return { ok: true, source, destination, target };
}

/* Read a legacy project, migrate it in memory, and write the candidate to a
   separate destination. The source is opened inside the write guard and is
   never written; the destination is created only after the candidate has
   validated, so a failing migration leaves nothing behind. */
function writeMigratedCopy({ sourceProjectRoot, destinationRoot, at, generatorVersion, allowExistingDirectory = false, requireValid = true }) {
  if (!sourceProjectRoot || !destinationRoot)
    throw new MigrationDestinationError("writeMigratedCopy requires an explicit sourceProjectRoot and destinationRoot", "missing-destination");

  const { source, destination, target } = checkDestination(sourceProjectRoot, destinationRoot, { allowExistingDirectory });

  const legacyFile = path.join(source, LEGACY_FILENAME);
  /* The read, the migration and the validation all happen with every write path
     under the source root refused. A rule that grew a cache, an index or a .bak
     fails here rather than in somebody's project directory. */
  const { result } = withNoWritesUnder(source, () => {
    const text = fs.readFileSync(legacyFile, "utf8");
    return previewLegacyMigration(parseJsonStrict(text), { at, generatorVersion });
  });

  if (requireValid && !result.ok) {
    return {
      written: false,
      file: null,
      source: legacyFile,
      destination: target,
      reason: "the migration did not produce a valid candidate; nothing was written",
      ...result,
    };
  }

  fs.mkdirSync(destination, { recursive: true });
  /* Atomic: write beside the target inside the DESTINATION, then rename. The
     temporary name is derived from the target rather than from a clock, so a
     failed run leaves one predictable file rather than an accumulating set. */
  const temporary = path.join(destination, `.${CANONICAL_FILENAME}.tmp`);
  fs.writeFileSync(temporary, result.serialized, { encoding: "utf8" });
  fs.renameSync(temporary, target);

  return { written: true, file: target, source: legacyFile, destination: target, ...result };
}

/* The refusal, expressed as a migration diagnostic, for callers that collect
   diagnostics rather than catching. */
function destinationDiagnostic(error) {
  return makeMigrationDiagnostic("migration.destination.unsafe", error.message, { where: "", detail: error.code });
}

module.exports = { writeMigratedCopy, checkDestination, destinationDiagnostic, MigrationDestinationError };

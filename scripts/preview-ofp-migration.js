#!/usr/bin/env node
"use strict";

/* Preview a legacy CineBraid project as an Open Film Project document.
 *
 *   node scripts/preview-ofp-migration.js path/to/project.json
 *   node scripts/preview-ofp-migration.js --json path/to/project
 *   node scripts/preview-ofp-migration.js --accounting path/to/project.json
 *   node scripts/preview-ofp-migration.js path/to/project --out ../somewhere-else
 *
 * A development entry point. It is not wired into CineBraid: there is no route,
 * no button, no startup path and no save path that reaches it, and running it
 * cannot change how the application opens or persists a project.
 *
 * THE DEFAULT IS NO WRITE. Without --out this reads the source, migrates it in
 * memory, validates the result and prints a report. There is deliberately no
 * default destination, and in particular none beside the source: "write it next
 * to the original" is how a migration starts looking like a save.
 *
 * With --out the destination is whatever the caller named, and it may not be the
 * source project, may not be inside it, may not contain it, and may not already
 * hold a document. The read and the migration run inside the INV-R1 guard over
 * the source root, so a change that made migration write a cache would fail here
 * rather than in somebody's project directory.
 *
 * The output is a 1.0-draft.1 document, which is experimental by construction: a
 * real project never enters the draft lineage, and this tool never converts one -
 * it produces a separate copy and says so.
 */

const fs = require("fs");
const path = require("path");

const { parseJsonStrict } = require("../ofp/ofp-json");
const { withNoWritesUnder } = require("../ofp/ofp-fs-guard");
const { LEGACY_FILENAME, CANONICAL_FILENAME } = require("../ofp/ofp-read");
const { OFP_FORMAT_ID, OFP_CONTRACT_VERSION } = require("../ofp/ofp-format");
const { previewLegacyMigration } = require("../ofp/ofp-migrate");
const { writeMigratedCopy, MigrationDestinationError } = require("../ofp/ofp-migrate-write");
const { MIGRATION_RULES } = require("../ofp/ofp-migrate-rules");

function parseArguments(argv) {
  const targets = [];
  const options = { json: false, accounting: false, rules: false, out: null, at: null, allowExistingDirectory: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--json") { options.json = true; continue; }
    if (argument === "--accounting") { options.accounting = true; continue; }
    if (argument === "--rules") { options.rules = true; continue; }
    if (argument === "--out") { options.out = argv[++index]; continue; }
    if (argument === "--at") { options.at = argv[++index]; continue; }
    if (argument === "--allow-existing-directory") { options.allowExistingDirectory = true; continue; }
    if (argument === "--help" || argument === "-h") return { help: true, options };
    if (argument.startsWith("-")) return { error: `unknown option ${argument}`, options };
    targets.push(argument);
  }
  return { targets, options };
}

const SEVERITY_LABEL = { error: "ERROR  ", warning: "warning", info: "info   " };

function resolveSource(target) {
  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved)) return { error: `not found: ${target}` };
  if (fs.statSync(resolved).isDirectory()) {
    const file = path.join(resolved, LEGACY_FILENAME);
    if (!fs.existsSync(file)) return { error: `${target} contains no ${LEGACY_FILENAME}` };
    return { root: resolved, file };
  }
  return { root: path.dirname(resolved), file: resolved };
}

function describe(result, label) {
  const lines = [label];
  const { source, target, counts, accounting, summary } = result.report;
  lines.push(`  source   ${source.detectedFamily}  generation ${source.generation}  (${source.confidence})`);
  lines.push(`           ${source.reason}`);
  lines.push(`           schemaVersion ${JSON.stringify(source.detectedVersion)}  hubVersion ${JSON.stringify(source.hubVersion)}  meta.version ${JSON.stringify(source.metaVersion)} read as ${source.metaVersionClass}`);
  lines.push(`  target   ${target.formatId} ${target.formatVersion}  (experimental copy; the source project is untouched)`);

  const applied = result.report.rules.filter((rule) => rule.status === "applied");
  lines.push(`  rules    ${applied.length} of ${result.report.rules.length} applied`);
  for (const rule of applied)
    lines.push(`    ${rule.id}  ${String(rule.sourceTargets).padStart(4)} value(s)  ${rule.statements ? `${rule.statements} statement(s)  ` : ""}${rule.name}`);

  lines.push("  counts");
  for (const row of counts.rows)
    if (row.before || row.after)
      lines.push(`    ${row.category.padEnd(12)} ${String(row.before).padStart(5)} -> ${String(row.after).padStart(5)}${row.adjustment ? `  (${row.adjustment} explained)` : ""}${row.explained ? "" : "   UNEXPLAINED"}`);

  lines.push(`  values   ${accounting.leaves} source value(s): ${Object.entries(accounting.byDisposition).map(([name, count]) => `${count} ${name}`).join(", ")}`);
  if (accounting.unaccounted.length) lines.push(`           ${accounting.unaccounted.length} UNACCOUNTED`);
  if (result.report.minted.length) lines.push(`  minted   ${result.report.minted.length} identifier(s), deterministically`);

  if (result.report.statements.length) {
    lines.push(`  evidence ${summary.inferredMappings} suggested, ${summary.disputes} disputed`);
    for (const statement of result.report.statements) lines.push(`    ${statement.id}  ${statement.kind.padEnd(9)} ${statement.target}`);
  }

  for (const diagnostic of result.report.diagnostics) {
    lines.push(`  ${SEVERITY_LABEL[diagnostic.severity]} ${diagnostic.code}${diagnostic.rule ? `  ${diagnostic.rule}` : ""}`);
    lines.push(`          ${diagnostic.message}`);
  }

  const validation = result.validation;
  lines.push(`  validate ${validation.ok ? "the candidate passes the contract validator" : `${validation.counts.error} contract error(s)`}`);
  for (const diagnostic of validation.diagnostics.filter((entry) => entry.severity !== "info"))
    lines.push(`  ${SEVERITY_LABEL[diagnostic.severity]} ${diagnostic.code}  ${diagnostic.target || diagnostic.where}\n          ${diagnostic.message}`);

  lines.push(`  ${result.ok ? "OK" : "NOT OK"} — ${summary.errors} error(s), ${summary.warnings} warning(s). Nothing was written to the source.`);
  return lines.join("\n");
}

function main() {
  const parsed = parseArguments(process.argv.slice(2));
  const options = parsed.options;
  if (parsed.help || parsed.error || !parsed.targets || !parsed.targets.length) {
    if (parsed.error) console.error(parsed.error);
    console.log([
      `Preview a legacy CineBraid project as ${OFP_FORMAT_ID} ${OFP_CONTRACT_VERSION}.`,
      "",
      "  node scripts/preview-ofp-migration.js <project.json-or-directory> [...]",
      "",
      "  --json                        machine-readable report",
      "  --accounting                  print the source-value accounting table",
      "  --rules                       print the migration rule registry and exit",
      "  --at <RFC3339>                the migration instant, supplied once (default 1970-01-01T00:00:00Z)",
      "  --out <directory>             ALSO write the migrated copy there",
      "  --allow-existing-directory    permit --out into a directory that already holds other content",
      "",
      "The default is NO WRITE. There is no default output directory, and in",
      `particular none beside the source. --out writes ${CANONICAL_FILENAME} to a`,
      "destination that may not be, contain, or sit inside the source project.",
      "",
      "The result is an experimental draft copy. A real project is never converted.",
    ].join("\n"));
    if (options.rules) {
      console.log("\nMigration rules, in execution order:\n");
      for (const rule of MIGRATION_RULES) console.log(`  ${rule.id}  ${rule.determinism.padEnd(13)} ${rule.name}\n        ${rule.summary}\n        (${rule.origin})`);
    }
    return parsed.error ? 2 : 0;
  }

  if (options.rules) {
    for (const rule of MIGRATION_RULES) console.log(`${rule.id}\t${rule.determinism}\t${rule.name}\t${rule.origin}`);
    return 0;
  }

  const reports = [];
  let failed = 0;

  for (const target of parsed.targets) {
    const located = resolveSource(target);
    if (located.error) { console.error(located.error); failed++; continue; }

    let result;
    try {
      /* Even the read-only path runs inside the guard. There is no reason a
         preview should touch the project, and "there is no reason" is not a
         mechanism. */
      const { result: outcome, attempts } = withNoWritesUnder(located.root, () =>
        previewLegacyMigration(parseJsonStrict(fs.readFileSync(located.file, "utf8")), { at: options.at || undefined }));
      if (attempts.length) {
        console.error(`${target}: INV-R1 VIOLATED — ${attempts.length} write attempt(s) under the source project root`);
        failed++;
      }
      result = outcome;
    } catch (error) {
      console.error(`${target}: ${error.message}`);
      failed++;
      continue;
    }

    if (!options.json) console.log(describe(result, path.relative(process.cwd(), located.file)));
    reports.push({ file: located.file, ...result.report, validation: { ok: result.validation.ok, diagnostics: result.validation.diagnostics, counts: result.validation.counts } });
    if (!result.ok) failed++;

    if (options.out) {
      if (!result.ok) {
        console.error(`  not written: the migration did not produce a valid candidate`);
        continue;
      }
      try {
        const written = writeMigratedCopy({
          sourceProjectRoot: located.root,
          destinationRoot: path.resolve(options.out),
          at: options.at || undefined,
          allowExistingDirectory: options.allowExistingDirectory,
        });
        console.log(`  written  ${path.relative(process.cwd(), written.file)}`);
      } catch (error) {
        if (!(error instanceof MigrationDestinationError)) throw error;
        console.error(`  REFUSED  ${error.message}`);
        failed++;
      }
    }

    if (options.accounting) {
      console.log("  source value accounting");
      for (const entry of result.report.accounting.entries)
        console.log(`    ${entry.pointer.padEnd(52)} ${entry.rule}  ${entry.disposition.padEnd(10)} ${entry.targets.join(", ")}`);
    }
  }

  if (options.json) console.log(JSON.stringify({ contractVersion: OFP_CONTRACT_VERSION, reports }, null, 2));
  return failed ? 1 : 0;
}

process.exitCode = main();

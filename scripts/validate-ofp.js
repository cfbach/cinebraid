#!/usr/bin/env node
"use strict";

/* Report-only Open Film Project validator.
 *
 *   node scripts/validate-ofp.js <file-or-directory> [...]
 *   node scripts/validate-ofp.js --json <file>
 *   node scripts/validate-ofp.js --mode semantic --mode portability <file>
 *
 * A development entry point, deliberately separate from CineBraid's normal
 * project load and save. Nothing here is wired into the running application:
 * the runtime still reads and writes legacy schemaVersion 6.7 documents exactly
 * as it did, and this tool cannot change that. It exists so the contract can be
 * exercised without a browser and without a route that could be reached by
 * accident.
 *
 * It writes nothing, ever. Every read happens inside the INV-R1 guard, so a
 * future change that made validation write a cache would fail here rather than
 * in somebody's project directory. Exit code is 1 only when a document carries
 * an error-severity diagnostic; warnings are reported and do not fail, because
 * a validator that treats every warning as fatal is one people route around.
 */

const fs = require("fs");
const path = require("path");

const { readOfpDocument, inspectProject, CANONICAL_FILENAME, LEGACY_FILENAME } = require("../ofp/ofp-read");
const { ALL_MODES } = require("../ofp/ofp-validate");
const { OFP_CONTRACT_VERSION, OFP_FORMAT_ID } = require("../ofp/ofp-format");

function parseArguments(argv) {
  const targets = [];
  const modes = [];
  let json = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--json") { json = true; continue; }
    if (argument === "--mode") { modes.push(argv[++index]); continue; }
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument.startsWith("-")) return { error: `unknown option ${argument}` };
    targets.push(argument);
  }
  return { targets, modes, json };
}

const SEVERITY_LABEL = { error: "ERROR  ", warning: "warning", info: "info   " };

function describe(result, label) {
  const lines = [`${label}`];
  lines.push(`  class ${result.documentClass}  access ${result.access}  version ${result.version || "-"}  (this build implements ${OFP_CONTRACT_VERSION})`);
  if (result.skipped.length) lines.push(`  not attempted: ${result.skipped.join(", ")}`);
  for (const diagnostic of result.diagnostics) {
    const where = diagnostic.target || diagnostic.where || "";
    lines.push(`  ${SEVERITY_LABEL[diagnostic.severity]} ${diagnostic.code}${where ? `  ${where}` : ""}`);
    lines.push(`          ${diagnostic.message}`);
  }
  lines.push(`  ${result.counts.error} error(s), ${result.counts.warning} warning(s)`);
  return lines.join("\n");
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help || options.error || !options.targets || !options.targets.length) {
    if (options.error) console.error(options.error);
    console.log([
      `Report-only validator for ${OFP_FORMAT_ID} ${OFP_CONTRACT_VERSION}.`,
      "",
      "  node scripts/validate-ofp.js <file-or-directory> [...]",
      "",
      "  --json           machine-readable output",
      `  --mode <name>    one of ${ALL_MODES.join(", ")} (repeatable; default is all)`,
      "",
      `A directory is inspected for ${CANONICAL_FILENAME}, falling back to ${LEGACY_FILENAME}.`,
      "Nothing is ever written, migrated or converted.",
    ].join("\n"));
    return options.error ? 2 : 0;
  }

  const validateOptions = options.modes.length ? { modes: options.modes } : {};
  const reports = [];
  let failed = 0;

  for (const target of options.targets) {
    const resolved = path.resolve(target);
    if (!fs.existsSync(resolved)) { console.error(`not found: ${target}`); failed++; continue; }
    let outcome;
    try {
      outcome = fs.statSync(resolved).isDirectory()
        ? inspectProject(resolved, validateOptions)
        : readOfpDocument(resolved, validateOptions);
    } catch (error) {
      console.error(`${target}: ${error.message}`);
      failed++;
      continue;
    }
    if (!outcome.validation) { console.error(`${target}: ${outcome.reason}`); failed++; continue; }
    /* The guard should never have anything to report. Surfacing it rather than
       discarding it means a regression shows up as output, not as silence. */
    if (outcome.writeAttempts.length) {
      console.error(`${target}: INV-R1 VIOLATED - ${outcome.writeAttempts.length} write attempt(s) under the project root`);
      failed++;
    }
    reports.push({ file: outcome.file, ...outcome.validation, document: undefined, sourceText: undefined });
    if (!options.json) console.log(describe(outcome.validation, path.relative(process.cwd(), outcome.file)));
    if (!outcome.validation.ok) failed++;
  }

  if (options.json) console.log(JSON.stringify({ contractVersion: OFP_CONTRACT_VERSION, reports }, null, 2));
  return failed ? 1 : 0;
}

process.exitCode = main();

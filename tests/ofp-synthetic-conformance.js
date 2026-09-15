"use strict";
/* Wholly invented conformance input. No production corpus or pinned output hash. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { previewLegacyMigration } = require("../ofp/ofp-migrate");
const { serializeCanonical } = require("../ofp/ofp-serialize");
const file = path.join(__dirname, "fixtures/ofp-synthetic/minimal.legacy.json");
const bytes = fs.readFileSync(file);
const source = JSON.parse(bytes);
const at = "2026-09-14T00:00:00Z";
for (const hubVersion of ["v1", "v4.7", "v5.8.1", "v6.0.0"]) {
  const input = JSON.parse(JSON.stringify(source));
  input.meta.hubVersion = hubVersion;
  if (hubVersion !== "v6.0.0") delete input.meta.schemaVersion;
  const before = JSON.stringify(input);
  const result = previewLegacyMigration(input, { at });
  assert(result.ok, JSON.stringify(result.report.diagnostics));
  assert.strictEqual(result.report.accounting.unaccounted.length, 0);
  assert.strictEqual(result.report.identity.lost.length, 0);
  assert.strictEqual(result.candidate.format.generator.version, require("../package.json").version);
  assert(!(result.candidate.statements || []).some(s => s.kind === "approved"));
  const output = serializeCanonical(result.candidate);
  assert(output.includes("SHOT-ONE") && output.includes("SHOT-TWO"), "shot identities survive");
  assert(output.includes("Keep this invented note for review."), "unknown source meaning survives");
  assert.strictEqual(output, serializeCanonical(previewLegacyMigration(input, { at }).candidate), "migration is deterministic");
  assert.strictEqual(JSON.stringify(input), before, "migration does not rewrite its input");
  assert.strictEqual(previewLegacyMigration(result.candidate).candidate, null, "OFP output is not migrated again");
}
assert.deepStrictEqual(fs.readFileSync(file), bytes, "verification never rewrites its fixture");
console.log("Synthetic OFP conformance passed: four legacy markers, two invented shots, complete accounting, deterministic output, unchanged source, no approvals.");

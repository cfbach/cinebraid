#!/usr/bin/env node
"use strict";

/* Build the sanitized Overfit migration fixtures and their pinned goldens (P3).
 *
 *   node scripts/build-overfit-golden-fixtures.js --source <archive-root>
 *   node scripts/build-overfit-golden-fixtures.js --goldens-only
 *
 * THIS IS A MAINTENANCE COMMAND AND IT WRITES. It is deliberately not reachable
 * from any check: `npm run check` verifies the committed fixtures against the
 * committed goldens and never reads the archive at all. Regenerating a golden is
 * how a migration semantics change gets waved through, so it takes an explicit
 * run, an explicit `--source`, and a diff somebody has to look at.
 *
 * --source names the directory holding both archive roots (`Overfit/` and
 * `CineBraid/app-581/`). There is no default. The path is used to read and is
 * never written into the committed output, because a fixture that records
 * somebody's drive layout is a fixture that leaks it.
 *
 * The archive is evidence, not a working copy. Every read runs inside the INV-R1
 * guard over the source roots, so a change that made this tool write a cache
 * fails here rather than in the only copy of the data.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { parseJsonStrict } = require("../ofp/ofp-json");
const { withNoWritesUnder } = require("../ofp/ofp-fs-guard");
const { OFP_CONTRACT_VERSION, OFP_FORMAT_ID } = require("../ofp/ofp-format");
const Sanitizer = require("./overfit-sanitizer");
const {
  FIXTURE_ROOT, GENERATIONS, FULL_GOLDEN_IDS, MIGRATION_AT,
  fixtureFile, goldenFile, readFixture, leafKey,
  migrateFixtureDocument, goldenFor, verifySanitization, verifyPrivacy,
} = require("./overfit-fixture-model");

const isProseKey = (key) => Sanitizer.PROSE_KEYS.has(key);

/* --------------------------------------------------------------------------- */

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

/* The fixtures are pinned to LF in .gitattributes, so what this writes is what a
   clone gets on every platform. Writing CRLF here would make the manifest hash
   true on the machine that built it and false everywhere else. */
const writeLF = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.replace(/\r\n/g, "\n"), "utf8");
};

const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

function fail(message) {
  console.error(`\n  FAILED  ${message}\n`);
  process.exit(1);
}

/* The gate itself lives in the shared model, where the negative controls can
   reach it; here it is only wrapped so a failure prints and exits instead of
   throwing a stack trace at somebody rebuilding fixtures. */
const gate = (run) => {
  try { return run(); } catch (error) {
    if (error.name !== "FixtureGateError") throw error;
    fail(error.message);
    return null;
  }
};

/* --------------------------------------------------------------------------- */

function buildFixtures(sourceRoot) {
  const roots = [...new Set(GENERATIONS.map((entry) => path.resolve(sourceRoot, entry.sourceRelative.split("/")[0])))];
  const built = [];

  for (const generation of GENERATIONS) {
    const file = path.resolve(sourceRoot, generation.sourceRelative);
    if (!fs.existsSync(file)) fail(`${generation.id}: source not found at <source>/${generation.sourceRelative}`);

    const { result: read, attempts } = withNoWritesUnder(path.dirname(file), () => {
      const bytes = fs.readFileSync(file);
      return { bytes, document: parseJsonStrict(bytes.toString("utf8")) };
    });
    if (attempts.length) fail(`${generation.id}: INV-R1 violated - ${attempts.length} write attempt(s) under the source`);

    const sanitized = Sanitizer.sanitizeDocument(read.document);
    const measured = gate(() => verifySanitization(generation.id, read.document, sanitized.document, isProseKey));

    const text = stableJson(sanitized.document);
    gate(() => verifyPrivacy(generation.id, text));
    writeLF(fixtureFile(generation.id), text);

    /* Every duplicate observation is hashed too, so the manifest's claim that a
       later directory holds the same document is checked rather than asserted. */
    const duplicates = (generation.alsoObservedAt || []).map((relative) => {
      const other = path.resolve(sourceRoot, relative);
      if (!fs.existsSync(other)) fail(`${generation.id}: duplicate observation not found at <source>/${relative}`);
      const digest = sha256(fs.readFileSync(other));
      if (digest !== sha256(read.bytes)) fail(`${generation.id}: <source>/${relative} is not byte-identical after all`);
      return relative;
    });

    built.push({
      id: generation.id,
      label: generation.label,
      lineage: generation.lineage,
      sourceRelative: generation.sourceRelative,
      alsoObservedAt: duplicates,
      sourceSha256: sha256(read.bytes),
      sourceBytes: read.bytes.length,
      sourceChars: read.bytes.toString("utf8").length,
      fixtureSha256: sha256(Buffer.from(text, "utf8")),
      fixtureBytes: Buffer.byteLength(text, "utf8"),
      versionMarkers: {
        metaVersion: (read.document.meta || {}).version ?? null,
        hubVersion: (read.document.meta || {}).hubVersion ?? null,
        schemaVersion: (read.document.meta || {}).schemaVersion ?? read.document.schemaVersion ?? null,
        formatVersion: (read.document.format || {}).version ?? null,
      },
      counts: measured.hazards.counts,
      hazards: measured.hazards.hazards,
      sanitizationRules: sanitized.rulesApplied,
      prosePointersChanged: measured.changedProse,
      vocabularyReplaced: sanitized.vocabulary,
      wordCollisions: sanitized.wordCollisions.length,
    });

    console.log(`  ${generation.id.padEnd(26)} ${String(built[built.length - 1].sourceBytes).padStart(7)}B -> ${String(built[built.length - 1].fixtureBytes).padStart(7)}B   ${measured.changedProse} prose value(s) replaced${duplicates.length ? `   (+${duplicates.length} duplicate observation)` : ""}`);
  }

  const digests = new Set(built.map((entry) => entry.sourceSha256));
  if (digests.size !== built.length) fail(`the corpus is meant to be ${built.length} distinct documents; ${built.length - digests.size} collide`);
  console.log(`\n  ${built.length} generations, ${digests.size} distinct source documents, read from ${roots.length} archive roots`);
  return built;
}

function writeManifest(built) {
  const manifest = {
    note: "Sanitized derivatives of real historical CineBraid project data. Generated by scripts/build-overfit-golden-fixtures.js; do not hand-edit. Source paths are relative to the archive root the build was pointed at and deliberately carry no host-specific prefix.",
    sanitizerVersion: Sanitizer.SANITIZER_VERSION,
    sanitizationRules: Sanitizer.SANITIZATION_RULES,
    migrationAt: MIGRATION_AT,
    contractVersion: OFP_CONTRACT_VERSION,
    formatId: OFP_FORMAT_ID,
    generations: built,
  };
  const text = stableJson(manifest);
  gate(() => verifyPrivacy("manifest", text));
  writeLF(path.join(FIXTURE_ROOT, "manifest.json"), text);
  console.log(`  manifest.json                ${String(Buffer.byteLength(text, "utf8")).padStart(7)}B`);
}

function writeGoldens() {
  const goldens = [];
  for (const generation of GENERATIONS) {
    const document = readFixture(generation.id);
    const golden = goldenFor(generation.id, document);
    goldens.push(golden);

    if (FULL_GOLDEN_IDS.includes(generation.id)) {
      const { serialized } = migrateFixtureDocument(document);
      if (!serialized) fail(`${generation.id}: no candidate to pin`);
      gate(() => verifyPrivacy(`${generation.id} candidate`, serialized));
      writeLF(goldenFile(generation.id), serialized);
    }

    console.log(`  ${generation.id.padEnd(26)} ${golden.ok ? "ok " : "NOT OK"}  ${String(golden.accounting.leaves).padStart(5)} values  ${String(golden.accounting.unaccounted).padStart(2)} unaccounted  ${String(golden.statements.total).padStart(3)} statements  ${golden.candidateSha256.slice(0, 12)}`);
  }

  const summary = {
    note: "Pinned migration results for the sanitized Overfit corpus. Regenerated only by scripts/build-overfit-golden-fixtures.js; tests/ofp-overfit-conformance.js verifies and never rewrites.",
    contractVersion: OFP_CONTRACT_VERSION,
    migrationAt: MIGRATION_AT,
    fullGoldens: FULL_GOLDEN_IDS,
    goldens,
  };
  const text = stableJson(summary);
  gate(() => verifyPrivacy("goldens", text));
  writeLF(path.join(FIXTURE_ROOT, "goldens", "summary.json"), text);
  console.log(`\n  goldens/summary.json         ${String(Buffer.byteLength(text, "utf8")).padStart(7)}B   ${FULL_GOLDEN_IDS.length} full candidate(s) pinned`);
  return goldens;
}

/* --------------------------------------------------------------------------- */

function main() {
  const argv = process.argv.slice(2);
  let source = null;
  let goldensOnly = false;
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--source") { source = argv[++index]; continue; }
    if (argv[index] === "--goldens-only") { goldensOnly = true; continue; }
    console.error(`unknown option ${argv[index]}`);
    return 2;
  }

  if (!source && !goldensOnly) {
    console.log([
      "Rebuild the sanitized Overfit migration fixtures. THIS WRITES.",
      "",
      "  node scripts/build-overfit-golden-fixtures.js --source <archive-root>",
      "  node scripts/build-overfit-golden-fixtures.js --goldens-only",
      "",
      "  --source <dir>    the directory holding the archive roots (Overfit/ and",
      "                    CineBraid/app-581/). Read-only. No default, on purpose.",
      "  --goldens-only    re-pin the migration goldens from the committed fixtures,",
      "                    without the archive. Use when migration semantics changed",
      "                    deliberately and the diff has been reviewed.",
      "",
      "Verification is a different command and does not live here:",
      "  npm run fixtures:overfit:verify",
    ].join("\n"));
    return 2;
  }

  if (source) {
    console.log(`\nsanitizing from <source> (${GENERATIONS.length} generations)\n`);
    const built = buildFixtures(source);
    console.log("");
    writeManifest(built);
  }

  console.log(`\npinning migration goldens at ${MIGRATION_AT}\n`);
  const goldens = writeGoldens();

  /* `ok` is pinned per generation rather than required. anchor-hub-22 carries 28
     dangling `parentShot` targets in the archive itself, so its candidate does
     not validate, and that is the finding rather than a build failure - the
     conformance suite pins the outcome and would fail if it moved. What this
     build refuses to write is a G4 violation: a source value nobody accounted
     for, or an approval migration invented. */
  const notOk = goldens.filter((entry) => !entry.ok);
  const unaccounted = goldens.filter((entry) => entry.accounting.unaccounted);
  const approved = goldens.filter((entry) => entry.statements.kinds.approved);
  console.log([
    "",
    `  ${goldens.length} generations migrated`,
    `  ${unaccounted.length} with unaccounted source values`,
    `  ${approved.length} emitting approved statements`,
    `  ${notOk.length} whose candidate does not validate${notOk.length ? `: ${notOk.map((entry) => entry.id).join(", ")}` : ""}`,
    "",
  ].join("\n"));
  return unaccounted.length || approved.length ? 1 : 0;
}

process.exitCode = main();

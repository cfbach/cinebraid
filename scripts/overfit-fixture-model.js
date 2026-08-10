"use strict";

/* The Overfit P3 corpus: which generations exist, where they came from, how a
 * generation is measured, and what may never appear in a committed fixture.
 *
 * Shared by the build tool and by tests/ofp-overfit-conformance.js so the two
 * cannot drift. The test reads the committed fixtures through this module and
 * never touches the archive - after the fixtures are committed the repository is
 * self-contained, and a check that reached for somebody's D: drive would pass on
 * exactly one machine.
 *
 * HOW THE CORPUS WAS IDENTIFIED
 *
 * The audit records eighteen successive snapshots of one film across four
 * application generations. Enumerating every `project.json` and
 * `PRE-V*_project_backup.json` under the two archive roots and hashing them
 * yields nineteen files carrying eighteen distinct SHA-256 digests: `anchor-hub-21`
 * re-observes `anchor-hub-19` byte for byte, and five `PRE-V<n>` backups are
 * snapshots taken before the application migrated the project to v<n>, three of
 * which preserve a state no surviving `project.json` holds. Those three are
 * generations in their own right, and their names date them exactly, which is
 * what fixes the lineage order below.
 *
 * The count is derived, not assumed: the build fails if the eighteen entries
 * stop being eighteen distinct documents.
 *
 * `sourceRelative` reproduces the archive's real directory names, including the
 * retired product name several of them carry. That is the one place it appears:
 * fixture IDs and lineage labels are named for the hub version instead, so the
 * retired name is filesystem truth here rather than product text. The
 * retired-name guard in tests/current-behavior.js exempts this file and the
 * manifest it generates, and nothing else.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { parseJsonStrict } = require("../ofp/ofp-json");
const { enumerateLeaves, readPointer } = require("../ofp/ofp-migrate-accounting");
const { previewLegacyMigration } = require("../ofp/ofp-migrate");
const { serializeCanonical } = require("../ofp/ofp-serialize");
const { isOpaqueSegment } = require("./overfit-sanitizer");

const FIXTURE_ROOT = path.join(__dirname, "..", "tests", "fixtures", "ofp-migration", "overfit");

/* The instant migration is told to use. Supplied once, never read from a clock,
   so a re-run differs from the pinned run in nothing at all. */
const MIGRATION_AT = "2026-08-10T00:00:00Z";

const OVERFIT = "Overfit";
const APP581 = "CineBraid/app-581";
const hub = (dir) => `${OVERFIT}/app_archive/${dir}/projects/the-overfit`;

const GENERATIONS = [
  { id: "overfit-01-anchorhub-v1",  lineage: "anchor-hub",        label: "anchor-hub, the first surviving snapshot",              sourceRelative: `${hub("anchor-hub")}/project.json` },
  { id: "overfit-02-anchorhub-18",  lineage: "anchor-hub-18",     label: "anchor-hub-18",                                          sourceRelative: `${hub("anchor-hub-18")}/project.json` },
  { id: "overfit-03-anchorhub-19",  lineage: "anchor-hub-19",     label: "anchor-hub-19, re-observed unchanged at anchor-hub-21",  sourceRelative: `${hub("anchor-hub-19")}/project.json`,
    alsoObservedAt: [`${hub("anchor-hub-21")}/project.json`] },
  { id: "overfit-04-anchorhub-22",  lineage: "anchor-hub-22",     label: "anchor-hub-22, the 39-shot decomposition that carries the authored relations", sourceRelative: `${hub("anchor-hub-22")}/project.json`,
    alsoObservedAt: [`${hub("anchor-hub-30")}/docs/PRE-V3_project_backup.json`] },
  { id: "overfit-05-anchorhub-30",  lineage: "anchor-hub-30",     label: "anchor-hub-30, recollapsed to 16 shots",                 sourceRelative: `${hub("anchor-hub-30")}/project.json`,
    alsoObservedAt: [`${hub("anchor-hub-32")}/docs/PRE-V31_project_backup.json`] },
  { id: "overfit-06-pre-v32",       lineage: "PRE-V32 backup",    label: "the state before v3.2; no surviving project.json holds it", sourceRelative: `${hub("anchor-hub-32")}/docs/PRE-V32_project_backup.json` },
  { id: "overfit-07-anchorhub-32",  lineage: "anchor-hub-32",     label: "anchor-hub-32, the 22-shot structure the film keeps",     sourceRelative: `${hub("anchor-hub-32")}/project.json` },
  { id: "overfit-08-pre-v33",       lineage: "PRE-V33 backup",    label: "the state before v3.3; no surviving project.json holds it", sourceRelative: `${hub("anchor-hub-33")}/docs/PRE-V33_project_backup.json` },
  { id: "overfit-09-anchorhub-33",  lineage: "anchor-hub-33",     label: "anchor-hub-33",                                          sourceRelative: `${hub("anchor-hub-33")}/project.json` },
  { id: "overfit-10-pre-v40",       lineage: "PRE-V40 backup",    label: "the state before v4.0; no surviving project.json holds it", sourceRelative: `${hub("stillhouse-40")}/docs/PRE-V40_project_backup.json` },
  { id: "overfit-11-hub-v4-0", lineage: "app_archive v4.0 build", label: "the v4.0 rebuild, where hubVersion reaches v4",       sourceRelative: `${hub("stillhouse-40")}/project.json` },
  { id: "overfit-12-hub-v4-1", lineage: "app_archive v4.1 build", label: "the v4.1 build",                                      sourceRelative: `${hub("stillhouse-41-gpt")}/project.json` },
  { id: "overfit-13-hub-v4-2", lineage: "app_archive v4.2 build", label: "v4.2, where meta.aiPolicy appears",                   sourceRelative: `${hub("STILLHOUSE_v4.2")}/project.json` },
  { id: "overfit-14-hub-v4-3", lineage: "app_archive v4.3 build", label: "v4.3, where the prompt profile block appears",        sourceRelative: `${hub("STILLHOUSE_v4.3")}/project.json` },
  { id: "overfit-15-hub-v4-5", lineage: "app_archive v4.5 build", label: "v4.5",                                                sourceRelative: `${hub("STILLHOUSE_v4.5")}/project.json` },
  { id: "overfit-16-hub-v4-6", lineage: "app_archive v4.6 build", label: "v4.6",                                                sourceRelative: `${hub("STILLHOUSE_v4.6")}/project.json` },
  { id: "overfit-17-hub-v4-7", lineage: "top-level v4.7 build",   label: "v4.7, the last snapshot before the CineBraid rename", sourceRelative: `${OVERFIT}/STILLHOUSE_v4.7/projects/the-overfit/project.json` },
  { id: "overfit-18-cinebraid-581", lineage: "CINEBRAID_v5.8.1",  label: "CineBraid v5.8.1, the newest snapshot and the hardest one", sourceRelative: `${APP581}/CINEBRAID_v5.8.1/projects/the-overfit/project.json` },
];

/* Full canonical output is pinned for three generations rather than eighteen.
   The pinned summary already makes a semantics change fail - it carries the
   candidate's SHA-256 - so a full document buys reviewability rather than
   coverage, and it costs a diff nobody reads on the fifteen generations that are
   structurally the same document a few fields apart. These three are the ones a
   reviewer would actually open: the earliest shape, the only generation carrying
   authored relations, and the newest and hardest. */
const FULL_GOLDEN_IDS = [
  "overfit-01-anchorhub-v1",
  "overfit-04-anchorhub-22",
  "overfit-18-cinebraid-581",
];

const fixtureFile = (id) => path.join(FIXTURE_ROOT, "generations", `${id}.legacy.json`);
const goldenFile = (id) => path.join(FIXTURE_ROOT, "goldens", `${id}.ofp.json`);
const readFixture = (id) => parseJsonStrict(fs.readFileSync(fixtureFile(id), "utf8"));

/* ---------------------------------------------------------------------------
   What a committed fixture may never contain. Checked against the serialized
   text, so keys and values are both in scope. */

const PRIVACY_PATTERNS = [
  { name: "a drive-qualified absolute path", pattern: /(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]{1,2}[A-Za-z0-9._-]/ },
  { name: "a UNC root", pattern: /\\\\\\\\[A-Za-z0-9]/ },
  { name: "a POSIX home directory", pattern: /\/(?:home|Users)\/[A-Za-z0-9._-]+/ },
  { name: "an absolute URL", pattern: /\bhttps?:\/\//i },
  { name: "a credential in a URL", pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^"/\s]+:[^"@/\s]+@/i },
  { name: "a loopback or LAN endpoint", pattern: /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])\b/i },
  { name: "an IPv4 address", pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/ },
  { name: "a credential-named key", pattern: /"[A-Za-z0-9_]*(?:api[_-]?key|apikey|secret|password|passcode|passphrase|auth[_-]?token|access[_-]?token|refresh[_-]?token|bearer|private[_-]?key|credential)[A-Za-z0-9_]*"\s*:/i },
];

/* ---------------------------------------------------------------------------
   Measurement. Every field here has to be invariant under sanitization, because
   the build gate compares the census before and against after and fails on any
   difference. That is what stops a sanitizer change from quietly deleting the
   hazard the corpus exists to carry. */

const ARROW_ID = /"[A-Za-z0-9_.-]*\d+->\d+[A-Za-z0-9_.-]*"/g;
const INFERRED_MARKER = "[INFERRED FOR PLANNING]";

function hazardCensus(document) {
  const flat = JSON.stringify(document);
  const shots = Array.isArray(document.shots) ? document.shots : [];
  const pointers = enumerateLeaves(document);

  const codes = [];
  for (const shot of shots) for (const code of Array.isArray(shot.codes) ? shot.codes : []) codes.push(String(code));
  const codeCounts = {};
  for (const code of codes.slice().sort()) codeCounts[code] = (codeCounts[code] || 0) + 1;

  const identifiers = new Set();
  const collect = (value, key) => {
    if (Array.isArray(value)) { for (const item of value) collect(item, key); return; }
    if (value && typeof value === "object") { for (const [k, v] of Object.entries(value)) collect(v, k); return; }
    if (key === "id" && typeof value === "string" && value) identifiers.add(value);
  };
  collect(document, "$root");

  let nulls = 0, emptyStrings = 0, emptyArrays = 0, emptyObjects = 0;
  for (const pointer of pointers) {
    const value = readPointer(document, pointer);
    if (value === null) { nulls++; continue; }
    if (value === "") { emptyStrings++; continue; }
    if (Array.isArray(value)) { emptyArrays++; continue; }
    if (value && typeof value === "object") { emptyObjects++; continue; }
  }

  const withKey = (key) => shots.filter((shot) => Object.prototype.hasOwnProperty.call(shot, key)).length;

  return {
    counts: {
      scenes: (document.scenes || []).length,
      shots: shots.length,
      characters: (document.characters || []).length,
      locations: (document.locations || []).length,
      props: (document.props || []).length,
      vehicles: (document.vehicles || []).length,
      audio: (document.audio || []).length,
      mediaAssets: (document.mediaAssets || []).length,
      sessions: (document.sessions || []).length,
      qcChecklist: (document.qcChecklist || []).length,
      leaves: pointers.length,
      nulls, emptyStrings, emptyArrays, emptyObjects,
    },
    hazards: {
      identifiers: [...identifiers].sort(),
      codeTokens: codeCounts,
      codesTotal: codes.length,
      shotsWithAtomic: withKey("atomic"),
      shotsWithParentShot: withKey("parentShot"),
      shotsWithFallbackFor: withKey("fallbackFor"),
      inferredMarkers: flat.split(INFERRED_MARKER).length - 1,
      nonPortableIds: [...new Set(flat.match(ARROW_ID) || [])].map((token) => token.slice(1, -1)).sort(),
      sameObjectAs: (flat.match(/"sameObjectAs":/g) || []).length,
      durationAliases: { dur: withKey("dur"), duration: withKey("duration"), sec: withKey("sec") },
      topLevelKeys: Object.keys(document),
      metaKeys: Object.keys(document.meta || {}),
    },
  };
}

/* The field name a leaf pointer names. Array indices are not field names, so
   `/shots/0/risks/2` is a `risks` value and not a `2` value - reading the last
   token alone is wrong for every array-valued prose field. */
function leafKey(pointer) {
  const tokens = pointer.split("/").slice(1);
  for (let index = tokens.length - 1; index >= 0; index--)
    if (!/^\d+$/.test(tokens[index])) return tokens[index].replace(/~1/g, "/").replace(/~0/g, "~");
  return "";
}

/* The equality partition of the prose: which prose pointers hold the same text
   as which others. M011 turns on exactly this - whether two of the seven
   description aliases agree - so it is checked directly rather than inferred
   from the word substitution being injective.

   Scoped to prose fields on purpose. A prose value that happened to equal a
   non-prose one legitimately diverges: `name` and `voiceTool` both hold
   "ElevenLabs Voice Design" in the archive, only `name` is prose, and no rule
   compares the two. Demanding the whole-document partition would be demanding
   that the sanitizer do nothing. */
function stringPartition(document, pointers = enumerateLeaves(document), inScope = () => true) {
  const groups = new Map();
  for (const pointer of pointers) {
    const value = readPointer(document, pointer);
    if (typeof value !== "string") continue;
    if (!inScope(leafKey(pointer))) continue;
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(pointer);
  }
  return [...groups.values()].map((group) => group.join(" ")).sort();
}

/* ---------------------------------------------------------------------------
   The sanitization gate. Sanitizing is only safe if it is provably shape-
   preserving, and "provably" means measured on both sides rather than asserted
   in a comment. It lives here, and throws rather than exiting, so the negative
   controls can reintroduce a defect and watch it fire - a gate that can only be
   reached through a CLI is a gate nobody has ever seen work. */

class FixtureGateError extends Error {
  constructor(message) { super(message); this.name = "FixtureGateError"; }
}

const refuse = (message) => { throw new FixtureGateError(message); };
const stableText = (value) => JSON.stringify(value, null, 2);

function verifySanitization(id, source, sanitized, isProseKey) {
  const sourceLeaves = enumerateLeaves(source);
  const sanitizedLeaves = enumerateLeaves(sanitized);

  if (sourceLeaves.length !== sanitizedLeaves.length)
    refuse(`${id}: leaf count moved, ${sourceLeaves.length} -> ${sanitizedLeaves.length}`);
  for (let index = 0; index < sourceLeaves.length; index++)
    if (sourceLeaves[index] !== sanitizedLeaves[index])
      refuse(`${id}: pointer ${index} moved, ${sourceLeaves[index]} -> ${sanitizedLeaves[index]}`);

  /* Types, and the absent / null / "" / [] / {} distinctions the ledger keys
     off. A string may change; nothing else may. */
  let changedProse = 0;
  for (const pointer of sourceLeaves) {
    const before = readPointer(source, pointer);
    const after = readPointer(sanitized, pointer);
    if (typeof before !== typeof after) refuse(`${id}: ${pointer} changed type`);
    if (typeof before !== "string") {
      /* A leaf that is an object is an *empty* one - enumerateLeaves recurses
         into anything with contents - so identity comparison would fail on two
         equally empty arrays. Compare the shape, and keep `[]` and `{}` apart:
         they are different facts to the ledger. */
      const same = before === null || after === null
        ? before === after
        : typeof before === "object"
          ? Array.isArray(before) === Array.isArray(after) && JSON.stringify(before) === JSON.stringify(after)
          : Object.is(before, after);
      if (!same) refuse(`${id}: ${pointer} changed value`);
      continue;
    }
    if (before.length !== after.length) refuse(`${id}: ${pointer} changed length; sanitization must be exact-length`);
    if (before !== after) changedProse++;
  }
  if (!changedProse) refuse(`${id}: nothing was sanitized; that is a committed copy of the film, not a fixture`);

  /* Every substantial sentence must actually have moved. Without this the gate
     above passes on a single changed word. */
  for (const pointer of sourceLeaves) {
    const before = readPointer(source, pointer);
    if (typeof before !== "string" || before.length < 24 || !/\s/.test(before)) continue;
    if (!isProseKey(leafKey(pointer))) continue;
    if (readPointer(sanitized, pointer) === before) refuse(`${id}: prose at ${pointer} survived sanitization verbatim`);
    /* The opaque-token rule short-circuits the prose rule, so a sentence with a
       provider filename embedded in it would come back with only the filename
       replaced - changed enough to satisfy the check above, and still carrying
       the film. No value in this archive is both, and this is what makes that a
       measured fact rather than a lucky one. */
    if ((before.match(/[A-Za-z0-9]+/g) || []).some(isOpaqueSegment))
      refuse(`${id}: ${pointer} is prose containing an opaque token; the two sanitization rules would collide there`);
  }

  /* Equality relationships. M011 compares the description aliases for agreement,
     so two fields that differed must still differ and two that agreed must still
     agree - a substitution that merged them would turn a dispute into a clean
     mapping and the corpus would stop testing the case it exists for. */
  const beforePartition = stringPartition(source, sourceLeaves, isProseKey);
  const afterPartition = stringPartition(sanitized, sanitizedLeaves, isProseKey);
  if (beforePartition.join("|") !== afterPartition.join("|")) {
    const wasSeparate = new Set(beforePartition);
    const merged = afterPartition.filter((group) => !wasSeparate.has(group));
    refuse(`${id}: the equality partition of the prose changed; sanitization merged or split values. ${merged.length} group(s) differ, first: ${merged[0]}`);
  }

  /* The hazards are the entire point of the corpus. If sanitizing removed one,
     the fixture is worthless and this is the only place that would notice. */
  const beforeHazards = hazardCensus(source);
  const afterHazards = hazardCensus(sanitized);
  if (stableText(beforeHazards) !== stableText(afterHazards))
    refuse(`${id}: the hazard census changed under sanitization`);

  return { changedProse, hazards: afterHazards };
}

function verifyPrivacy(id, text) {
  for (const { name, pattern } of PRIVACY_PATTERNS) {
    const match = text.match(pattern);
    if (match) refuse(`${id}: committed output would contain ${name} - ${JSON.stringify(match[0].slice(0, 60))}`);
  }
}

/* ---------------------------------------------------------------------------
   The pinned view of a migration. Lives here rather than in the build tool so
   the tool that writes a golden and the suite that checks one cannot compute it
   two different ways - which is the only way a drift gate quietly stops
   gating.

   Deliberately not the whole report. The report carries the full prose of every
   statement note, and pinning that would make rewording a sentence look like a
   semantics change; these are the facts migration cannot alter without altering
   behaviour, plus the candidate's digest, which covers everything else. */

function migrateFixtureDocument(document) {
  const result = previewLegacyMigration(document, { at: MIGRATION_AT });
  return { result, serialized: result.candidate ? serializeCanonical(result.candidate) : null };
}

function goldenFor(id, document) {
  const { result, serialized } = migrateFixtureDocument(document);
  const report = result.report;
  const statements = (result.candidate && result.candidate.statements) || [];

  const kinds = {};
  for (const statement of statements) kinds[statement.kind] = (kinds[statement.kind] || 0) + 1;
  const counts = {};
  for (const row of report.counts.rows) if (row.before || row.after) counts[row.category] = { before: row.before, after: row.after };

  return {
    id,
    ok: result.ok,
    source: {
      family: report.source.detectedFamily,
      generation: report.source.generation,
      confidence: report.source.confidence,
      schemaVersion: report.source.detectedVersion,
      hubVersion: report.source.hubVersion,
      metaVersion: report.source.metaVersion,
      metaVersionClass: report.source.metaVersionClass,
      markers: report.source.markers,
      fingerprint: report.source.fingerprint,
    },
    rulesApplied: report.rules.filter((rule) => rule.status === "applied").map((rule) => rule.id),
    ruleStatements: Object.fromEntries(report.rules.filter((rule) => rule.statements).map((rule) => [rule.id, rule.statements])),
    accounting: {
      leaves: report.accounting.leaves,
      unaccounted: report.accounting.unaccounted.length,
      byDisposition: report.accounting.byDisposition,
      byRule: report.accounting.byRule,
    },
    counts,
    identity: {
      source: report.identity.source,
      preserved: report.identity.preserved,
      lost: report.identity.lost.length,
      minted: report.identity.minted,
    },
    statements: { total: statements.length, kinds, ids: statements.map((entry) => entry.id) },
    diagnostics: report.diagnostics.map((entry) => `${entry.severity}:${entry.code}`).sort(),
    validation: { ok: result.validation.ok, counts: result.validation.counts },
    summary: report.summary,
    candidateSha256: serialized ? crypto.createHash("sha256").update(serialized).digest("hex") : null,
    candidateBytes: serialized ? Buffer.byteLength(serialized, "utf8") : 0,
  };
}

module.exports = {
  FIXTURE_ROOT, GENERATIONS, FULL_GOLDEN_IDS, MIGRATION_AT, PRIVACY_PATTERNS, INFERRED_MARKER,
  fixtureFile, goldenFile, readFixture, hazardCensus, stringPartition, leafKey,
  migrateFixtureDocument, goldenFor, verifySanitization, verifyPrivacy, FixtureGateError,
};

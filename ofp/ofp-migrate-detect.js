"use strict";

/* Source detection: what IS this document, before anything is migrated.

   Migration is explicit (P0 Decision 12), and an explicit operation still has to
   know what it was handed. The one thing this module must never do is guess
   silently - it returns a classification with its evidence, and a caller decides.

   THE FIVE VERSION MARKERS ARE NOT INTERCHANGEABLE. The audit found twelve
   version-ish fields and no project format version among them, so the single
   most valuable thing detection can do is refuse to conflate these:

     application version     package.json / release-identity. NEVER stored in a
                             project as a schema marker. Read here only to be
                             recognised and rejected as one.
     meta.hubVersion         tracked the APP across the pre-6.x generations
                             (v1 -> v5.8.1), then froze at "v6.0.0" and became a
                             de-facto schema marker. Both meanings live in one
                             field, which is why it is evidence and never an
                             answer on its own.
     meta.version            broken three ways: "v1" from BLANK(), an app version
                             in the shipped sample, and the FILM'S OWN DRAFT
                             NUMBER ("v2.1") in every Overfit generation.
     meta.schemaVersion      the only real schema marker, and it does not exist
                             before CineBraid 6.6 - absent in 13 of 18 measured
                             Overfit generations.
     format.version          the OFP CONTRACT version. A document carrying one is
                             already OFP and is not a migration source.

   So detection sniffs SHAPE when there is no marker, reports which markers it
   saw, and says how confident it is. `migratable` is a separate field from `ok`
   because "I understood this document" and "I should convert it" are different
   questions. */

const { classifyDocument, DOCUMENT_CLASS } = require("./ofp-format");

const SOURCE_FAMILY = {
  /* A legacy CineBraid project.json, at any generation. */
  CINEBRAID_LEGACY: "cinebraid-legacy",
  /* Already an Open Film Project document. Not a migration source. */
  OPEN_FILM_PROJECT: "open-film-project",
  /* Measured in the archive: `D:\Projects\Spy NF` is a 3D scene editor whose
     files are also called project.json. The audit says plainly: do not migrate
     it. Recognising it by name is what keeps a wrong answer from being a quiet
     one. */
  FOREIGN_APPLICATION: "foreign-application",
  UNKNOWN: "unknown",
};

const SOURCE_GENERATION = {
  /* meta.schemaVersion "6.7" - the current client-writable generation. */
  V6_7: "6.7",
  /* meta.schemaVersion "6.6" - the baseline the marker was introduced at. */
  V6_6: "6.6",
  /* No schemaVersion at all. Thirteen of eighteen measured Overfit generations.
     Identified by shape, never by a marker that is not there. */
  PRE_6_6: "pre-6.6",
  UNKNOWN: "unknown",
};

/* How `meta.version` was read. It is a classification, not a value - the value
   is preserved either way, and M002 decides where it goes. */
const META_VERSION_CLASS = {
  ABSENT: "absent",
  /* Exactly the BLANK() default. Carries no information about anything. */
  TEMPLATE_DEFAULT: "template-default",
  /* Looks like a CineBraid release ("6.6.4-studio.2"). The field was misused. */
  APPLICATION_VERSION: "application-version",
  /* Looks like the film's own draft label ("v2.1"). The Overfit reading. */
  FILM_DRAFT: "film-draft",
  UNKNOWN: "unknown",
};

/* Markers that only a 3D scene editor's document would carry. Two or more of
   them together is not a coincidence. */
const FOREIGN_MARKERS = ["ambientLight", "envMap", "shadowQuality", "workspacePath", "sceneGraph"];

/* Shape evidence, newest era first. Each entry is a predicate over the parsed
   document; the ones that fire are reported, and the newest that fires decides
   the sniffed generation. This is the mechanism that lets a project with no
   schemaVersion be classified at all. */
const SHAPE_MARKERS = [
  { marker: "shot.continuityIntent", era: SOURCE_GENERATION.V6_7, test: (d) => shots(d).some((s) => isObject(s.continuityIntent)) },
  { marker: "entity.tracking", era: SOURCE_GENERATION.V6_7, test: (d) => allEntities(d).some((e) => isObject(e.tracking)) },
  /* Slice 5a's declared shot delivery route, listed for the same reason
     shot.continuityIntent is: it is a 6.7 user-writable field that exists only once
     somebody declares one, so a project can carry it while its meta.schemaVersion still
     says 6.6. A declared marker beats every shape reading, so this changes nothing for a
     document that states its generation, and gives a document that does not one more
     piece of honest evidence. It is evidence and never a route: nothing here reads the
     value, and no classification writes one. An empty or blank slot is not a
     declaration and deliberately does not fire. */
  { marker: "shot.deliveryRoute", era: SOURCE_GENERATION.V6_7, test: (d) => shots(d).some((s) => typeof s.deliveryRoute === "string" && s.deliveryRoute.trim() !== "") },
  { marker: "coverageSlots.requirement", era: SOURCE_GENERATION.V6_6, test: (d) => allEntities(d).some((e) => arr(e.coverageSlots).some((c) => typeof c.requirement === "string")) },
  { marker: "shot.creationBrief", era: SOURCE_GENERATION.V6_6, test: (d) => shots(d).some((s) => isObject(s.creationBrief)) },
  { marker: "entity.continuityStates", era: SOURCE_GENERATION.PRE_6_6, test: (d) => allEntities(d).some((e) => Array.isArray(e.continuityStates)) },
  { marker: "shot.keyframes", era: SOURCE_GENERATION.PRE_6_6, test: (d) => shots(d).some((s) => Array.isArray(s.keyframes)) },
  { marker: "shot.clips", era: SOURCE_GENERATION.PRE_6_6, test: (d) => shots(d).some((s) => Array.isArray(s.clips)) },
  { marker: "shot.atomic/parentShot/fallbackFor", era: SOURCE_GENERATION.PRE_6_6, test: (d) => shots(d).some((s) => s.atomic !== undefined || s.parentShot !== undefined || s.fallbackFor !== undefined) },
  { marker: "shot.codes", era: SOURCE_GENERATION.PRE_6_6, test: (d) => shots(d).some((s) => Array.isArray(s.codes)) },
];

const LEGACY_COLLECTIONS = ["shots", "scenes", "characters", "locations", "props", "vehicles", "audio"];

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function arr(value) {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function shots(document) {
  return arr(document.shots);
}

function allEntities(document) {
  return [...arr(document.characters), ...arr(document.locations), ...arr(document.props), ...arr(document.vehicles), ...arr(document.audio)];
}

/* The schema marker, wherever it is. Real projects carry `meta.schemaVersion`;
   the P1 fixture carries a bare top-level `schemaVersion`, and `ofp-format.js`
   already classifies on that shape, so both are read here rather than one of
   them being quietly the only supported spelling. */
function readSchemaVersion(document) {
  const meta = isObject(document.meta) ? document.meta : {};
  for (const [where, value] of [["/meta/schemaVersion", meta.schemaVersion], ["/schemaVersion", document.schemaVersion]])
    if (typeof value === "string" || typeof value === "number") return { value: String(value), where };
  return { value: null, where: null };
}

const APPLICATION_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const FILM_DRAFT_PATTERN = /^v?\d+(?:\.\d+)*[a-z]?$/i;

/* The BLANK() default. A project that has never had its draft label touched
   says "v1", and carrying that forward as a film's draft number would invent a
   fact. */
const TEMPLATE_META_VERSION = "v1";

function classifyMetaVersion(value) {
  if (value === undefined || value === null || value === "") return META_VERSION_CLASS.ABSENT;
  const text = String(value);
  if (text === TEMPLATE_META_VERSION) return META_VERSION_CLASS.TEMPLATE_DEFAULT;
  if (APPLICATION_VERSION_PATTERN.test(text)) return META_VERSION_CLASS.APPLICATION_VERSION;
  if (FILM_DRAFT_PATTERN.test(text)) return META_VERSION_CLASS.FILM_DRAFT;
  return META_VERSION_CLASS.UNKNOWN;
}

function looksForeign(document) {
  const hits = FOREIGN_MARKERS.filter((marker) => Object.prototype.hasOwnProperty.call(document, marker));
  return hits.length >= 2 ? hits : null;
}

/* At least two legacy collections present as arrays, plus a meta object or a
   schema marker. Deliberately not "has a shots array" alone: that would claim
   any JSON document with a shots array, and being wrong about what a file IS is
   the worst failure available to a migration tool. */
function looksLikeCineBraidProject(document) {
  const collections = LEGACY_COLLECTIONS.filter((name) => Array.isArray(document[name]));
  const hasMeta = isObject(document.meta);
  const hasMarker = readSchemaVersion(document).value !== null;
  return { ok: (collections.length >= 2 && (hasMeta || hasMarker)) || (hasMarker && hasMeta), collections, hasMeta, hasMarker };
}

function detectLegacyProject(document) {
  const base = {
    ok: false,
    migratable: false,
    family: SOURCE_FAMILY.UNKNOWN,
    generation: SOURCE_GENERATION.UNKNOWN,
    confidence: "none",
    schemaVersion: null,
    schemaVersionAt: null,
    hubVersion: null,
    metaVersion: null,
    metaVersionClass: META_VERSION_CLASS.ABSENT,
    formatVersion: null,
    shapeMarkers: [],
    collections: [],
    reason: "",
  };

  if (!isObject(document))
    return { ...base, reason: "document root is not a JSON object" };

  /* An OFP document is never a migration source. Asked first, because a
     document carrying a `format` block has already answered the question and
     nothing below should get to overrule it. */
  if (document.format !== undefined) {
    const classification = classifyDocument(document);
    return {
      ...base,
      ok: classification.documentClass !== DOCUMENT_CLASS.FORMAT_INVALID,
      family: SOURCE_FAMILY.OPEN_FILM_PROJECT,
      confidence: "declared",
      formatVersion: classification.version,
      documentClass: classification.documentClass,
      reason: `already an Open Film Project document (${classification.reason}); migration has no work to do`,
    };
  }

  const foreign = looksForeign(document);
  if (foreign)
    return {
      ...base,
      family: SOURCE_FAMILY.FOREIGN_APPLICATION,
      confidence: "declared",
      shapeMarkers: foreign,
      reason: `carries ${foreign.join(", ")}, which belong to another application's scene document; the audit names this case explicitly and says do not migrate it`,
    };

  const shape = looksLikeCineBraidProject(document);
  const schema = readSchemaVersion(document);
  const meta = isObject(document.meta) ? document.meta : {};
  const hubVersion = typeof meta.hubVersion === "string" ? meta.hubVersion : null;
  const metaVersion = meta.version === undefined ? null : String(meta.version);

  if (!shape.ok)
    return {
      ...base,
      schemaVersion: schema.value,
      schemaVersionAt: schema.where,
      hubVersion,
      metaVersion,
      metaVersionClass: classifyMetaVersion(metaVersion),
      collections: shape.collections,
      reason: `no format block and not enough of a CineBraid project shape to identify${shape.collections.length ? ` (found only ${shape.collections.join(", ")})` : ""}`,
    };

  const fired = SHAPE_MARKERS.filter((entry) => {
    try { return entry.test(document); } catch { return false; }
  });

  /* A declared marker beats every shape reading. Shape only decides when there
     is nothing to declare - which is the pre-6.6 case the audit measured. */
  let generation = SOURCE_GENERATION.UNKNOWN;
  let confidence = "sniffed";
  if (schema.value !== null) {
    confidence = "declared";
    const numeric = Number.parseFloat(schema.value);
    generation = numeric >= 6.7 ? SOURCE_GENERATION.V6_7 : numeric >= 6.6 ? SOURCE_GENERATION.V6_6 : SOURCE_GENERATION.PRE_6_6;
  } else if (fired.length) {
    /* SHAPE_MARKERS is ordered newest era first, so the first that fires is the
       newest evidence available. */
    generation = fired[0].era;
  } else {
    generation = SOURCE_GENERATION.PRE_6_6;
  }

  const reasonParts = [
    schema.value !== null ? `schemaVersion ${JSON.stringify(schema.value)} at ${schema.where}` : "no schemaVersion marker",
    hubVersion ? `hubVersion ${JSON.stringify(hubVersion)}` : null,
    fired.length ? `shape markers: ${fired.map((entry) => entry.marker).join(", ")}` : null,
  ].filter(Boolean);

  return {
    ok: true,
    migratable: true,
    family: SOURCE_FAMILY.CINEBRAID_LEGACY,
    generation,
    confidence,
    schemaVersion: schema.value,
    schemaVersionAt: schema.where,
    hubVersion,
    metaVersion,
    metaVersionClass: classifyMetaVersion(metaVersion),
    formatVersion: null,
    shapeMarkers: fired.map((entry) => entry.marker),
    collections: shape.collections,
    reason: `legacy CineBraid project, generation ${generation} (${reasonParts.join("; ")})`,
  };
}

module.exports = {
  SOURCE_FAMILY,
  SOURCE_GENERATION,
  META_VERSION_CLASS,
  TEMPLATE_META_VERSION,
  SHAPE_MARKERS,
  detectLegacyProject,
  classifyMetaVersion,
  readSchemaVersion,
};

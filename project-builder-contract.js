/* The Project Builder contract identity — one declaration, six resources.

   THE KIT IS NOT THE APPLICATION. A filmmaker hands the six Project Builder
   resources to an outside LLM; the JSON that comes back has to satisfy one
   agreement about shape and meaning. That agreement changes when the shape
   changes, which is a different event from a CineBraid release. Numbering the
   kit after the build it happened to ship in — `v6.7.0-dev.1` — would announce a
   new contract every time an unrelated button moved, and numbering it after a
   schema file the build no longer reads announced the opposite. Six files
   carrying six version numbers is how this package ended up with three schema
   contents behind six filenames.

   So the kit has ONE identity, written here and nowhere else, and it is a
   contract number rather than a version: PROJECT BUILDER CONTRACT 1.0.

   This is the same separation `release-identity.js` already keeps for the other
   direction — the project schema markers `meta.hubVersion` and
   `meta.schemaVersion` describe stored project data and must never follow the
   application version. The contract describes an agreement with an external
   model, and must never follow it either.

   WHAT ENFORCES IT. The six resource files are plain text handed to a model, so
   none of them can import this module. `tests/project-builder-kit.js` closes
   that gap: it fails when any resource states an identity other than the one
   declared here, when the resource set is not exactly these six, or when a
   version-named schema alias reappears beside the canonical file.

   Pure data. No filesystem, no clock, no network. */

/* The one hand-edited value in the kit. Raise it when the JSON an external model
   must produce changes shape or meaning — never for a CineBraid release. */
const PROJECT_BUILDER_CONTRACT_VERSION = "1.0";

/* The human identity, written verbatim in all six resources so a filmmaker
   holding a downloaded kit can tell what it is without opening the schema. */
const PROJECT_BUILDER_CONTRACT_NAME = `PROJECT BUILDER CONTRACT ${PROJECT_BUILDER_CONTRACT_VERSION}`;

/* The machine identity: the schema's own `$id`. */
const PROJECT_BUILDER_SCHEMA_ID = `https://cinebraid.local/schema/project-builder/${PROJECT_BUILDER_CONTRACT_VERSION}`;

/* The canonical schema filename. Unversioned on purpose: a version-named schema
   is how five stale copies came to sit beside the live one, each looking equally
   authoritative to anyone reading the directory. */
const PROJECT_BUILDER_SCHEMA_FILE = "CINEBRAID_PROJECT_SCHEMA.json";

/* The kit, exactly. The route that builds the download and the suite that proves
   the directory has not grown a sixth schema read the same list. */
const PROJECT_BUILDER_RESOURCES = [
  PROJECT_BUILDER_SCHEMA_FILE,
  "CINEBRAID_PROJECT_BUILDER_SYSTEM_PROMPT.txt",
  "CINEBRAID_PROJECT_BUILDER_USER_TEMPLATE.txt",
  "CINEBRAID_PROJECT_BUILDER_MINIMAL_EXAMPLE.json",
  "QUICK_START.md",
  "README.md",
];

/* The downloaded archive's name, derived rather than typed, so the file on a
   filmmaker's disk names the contract it actually contains. */
const PROJECT_BUILDER_KIT_ARCHIVE = `CineBraid_Project_Builder_Prompt_Kit_Contract_${PROJECT_BUILDER_CONTRACT_VERSION}.zip`;

/* The four prose resources: the ones that must state the contract name in words
   rather than carry it structurally. Kept as its own list so the suite that
   checks prose does not have to re-derive it by excluding the schema. */
const PROJECT_BUILDER_PROSE_RESOURCES = PROJECT_BUILDER_RESOURCES.filter(
  (name) => name.endsWith(".txt") || name.endsWith(".md"),
);

function projectBuilderContract() {
  return {
    version: PROJECT_BUILDER_CONTRACT_VERSION,
    name: PROJECT_BUILDER_CONTRACT_NAME,
    schemaId: PROJECT_BUILDER_SCHEMA_ID,
    schemaFile: PROJECT_BUILDER_SCHEMA_FILE,
    resources: [...PROJECT_BUILDER_RESOURCES],
    proseResources: [...PROJECT_BUILDER_PROSE_RESOURCES],
    archive: PROJECT_BUILDER_KIT_ARCHIVE,
  };
}

module.exports = {
  projectBuilderContract,
  PROJECT_BUILDER_CONTRACT_VERSION,
  PROJECT_BUILDER_CONTRACT_NAME,
  PROJECT_BUILDER_SCHEMA_ID,
  PROJECT_BUILDER_SCHEMA_FILE,
  PROJECT_BUILDER_RESOURCES,
  PROJECT_BUILDER_PROSE_RESOURCES,
  PROJECT_BUILDER_KIT_ARCHIVE,
};

"use strict";

/* The migration rule registry.

   One entry per rule. Each has a stable ID, a name, the source generations it
   applies to, whether it is deterministic or inferential, and an implementation
   function. Nothing here is a giant normalizeProject-style pass: a rule is
   individually named, individually testable, and individually visible in the
   migration report.

   ID DISCIPLINE. The audit's Part 27 migration matrix already names M001, M002,
   M010-M016, M020-M022, M030, M031, M040-M042 and M050-M053. Those IDs are used
   here with the meanings the matrix gives them and are NOT renumbered. The
   remainder are P2 assignments for work the matrix implies but does not number,
   and they are chosen to sit in the matrix's own numbering bands rather than
   above them:

     M003 project metadata            M009 keyframes/clips -> frames/motion
     M004 scenes                      M017 audio entities -> voices
     M005 shots                       M060 deterministic ID minting
     M006 entities                    M070 unknown legacy preservation
     M007 entity states               M080 runtime/secret quarantine
     M008 coverage slots

   DETERMINISM IS PER-APPLICATION, NOT PER-RULE. A rule is declared
   `deterministic`, `inferential` or `mixed`; a `mixed` rule maps deterministically
   in the ordinary case and only guesses where the source is genuinely ambiguous.
   P0 §10.3's rule stands and is the reason the array stays sparse:

       MIGRATIONS EMIT STATEMENTS ONLY WHERE THEY GUESS.

   So M021 recovering `parentShot` into a relation writes NO statement - nobody
   suggested it, and no source document cited it; it is authored production data
   that was already structured. M022 reading the same relationship out of English
   prose writes one, because that is a reading. */

const path = require("path");

const { DISPOSITION } = require("./ofp-migrate-accounting");
const { SOURCE_GENERATION, META_VERSION_CLASS } = require("./ofp-migrate-detect");
/* The one place coverage-requirement semantics are decided, shared with the
   running application. Migration reading a legacy boolean differently from the
   app that wrote it is exactly the defect P4-SEM-A removes, so M015 borrows the
   reading rather than restating it. */
const Coverage = require("../public/shared-coverage");

const ALL_GENERATIONS = [SOURCE_GENERATION.PRE_6_6, SOURCE_GENERATION.V6_6, SOURCE_GENERATION.V6_7, SOURCE_GENERATION.UNKNOWN];

const DETERMINISM = { DETERMINISTIC: "deterministic", INFERENTIAL: "inferential", MIXED: "mixed" };

/* ---- shared helpers ------------------------------------------------------ */

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function encodeToken(token) {
  return String(token).replace(/~/g, "~0").replace(/\//g, "~1");
}

function ptr(...tokens) {
  return tokens.map((token) => `/${encodeToken(token)}`).join("");
}

/* The legacy entity collections, paired with the OFP collection and the subject
   type they become. `audio` is deliberately absent - it becomes voices under
   M017, which is a different mapping with a different shape. */
const ENTITY_KINDS = [
  { legacy: "characters", ofp: "characters", type: "character" },
  { legacy: "locations", ofp: "locations", type: "location" },
  { legacy: "props", ofp: "props", type: "prop" },
  { legacy: "vehicles", ofp: "vehicles", type: "vehicle" },
];

/* D1, measured: seven fields have held "what this entity looks like", and five
   different consumers resolved them in five different orders. Precedence here is
   the one the continuity observer uses, which is the only consumer that reads
   all of them - and it is a PRECEDENCE, not a merge. Concatenating a director's
   two descriptions would invent a third one nobody wrote. */
const ENTITY_PROSE_FIELDS = ["creationDescription", "description", "block", "notes", "visualDescription", "coverageDescription", "coverageCharacteristics"];

/* D8: nine spellings of one field. `notes` is the current writer. */
const STATE_DELTA_FIELDS = ["delta", "stateDelta", "changeOnly", "change", "changes", "description", "visualDescription", "instructions", "notes"];

/* D2, measured as a live loss in the shipped sample: SAMPLE-03 stores
   `duration: 4` and no `dur`, and the prompt engine reads `dur`, so a declared
   four-second shot is generated as a defaulted five. `dur` wins here because it
   is what the engine reads today, so migrating to it cannot change what any
   existing shot renders as. */
const DURATION_FIELDS = ["dur", "duration", "sec"];

const MEDIA_TYPES = {
  ".png": ["image", "image/png"],
  ".jpg": ["image", "image/jpeg"],
  ".jpeg": ["image", "image/jpeg"],
  ".webp": ["image", "image/webp"],
  ".gif": ["image", "image/gif"],
  ".mp4": ["video", "video/mp4"],
  ".mov": ["video", "video/quicktime"],
  ".webm": ["video", "video/webm"],
  ".wav": ["audio", "audio/wav"],
  ".mp3": ["audio", "audio/mpeg"],
  ".m4a": ["audio", "audio/mp4"],
};

function mediaKindOf(filename) {
  const extension = path.extname(String(filename)).toLowerCase();
  return MEDIA_TYPES[extension] || ["other", null];
}

/* The prose that carried production relationships in the measured corpus. Seven
   Overfit shots express a bookend or plate dependency in English and zero
   express it as structure. */
const DEPENDENCY_KEYWORDS = [
  { pattern: /\bbookend\b/i, kind: "bookend-of" },
  { pattern: /\bmirror(?:ed|s)?\b/i, kind: "bookend-of" },
  { pattern: /\bderive[sd]?\s+from\b/i, kind: "other" },
  { pattern: /\bdepends?\s+on\b/i, kind: "other" },
  { pattern: /\bshared[- ]asset\b/i, kind: "other" },
];

const INFERRED_MARKER = "[INFERRED FOR PLANNING]";

/* The reference purpose vocabulary is CLOSED at this contract revision, and it
   has no member for "this asset is the approved output of this frame". So a
   frame approval is `other` and the meaning lives in the reference's subject,
   which is a frame - rather than in an invented enum member the validator would
   correctly report as undeclared. A `frame-approved` purpose is a reasonable
   thing for the contract to grow; widening a merged enum is not P2's call. */
const FRAME_APPROVED_PURPOSE = "other";

/* ---- M080: what must never enter an OFP document -------------------------

   Decision 17 lists these by name. The quarantine is a source-side mechanism
   rather than a review step, because the preservation rules below are designed
   to carry ANY unrecognised legacy value into the extension - which is exactly
   the behaviour that would carry a stored API key with it. */
/* Key names are TOKENISED rather than pattern-matched, because the real field
   names are camelCase and a separator-anchored regex misses every one of them:
   `falApiKey` has no "." or "_" in front of "apiKey", so a pattern looking for
   one reads it as ordinary prose. Splitting on case boundaries as well as on
   punctuation is what makes `falApiKey`, `api_key` and `API-KEY` the same
   question.

   Single words are the ones that mean a credential on their own. Pairs exist
   because `key` alone does not - `keyFrames` is a frame collection, and flagging
   it would train somebody to route around the scanner.

   `token` is a PAIR for exactly that reason, and the reason is load-bearing
   rather than theoretical. A compiled prompt names its input images with a
   reference placeholder stored under `token` and holding `#image1`
   (`prompt-engine.js:596`), so the bare word quarantined real film semantics as
   a credential - the M080 false positive P3 recorded. Every credential CineBraid
   actually stores qualifies the word: `accessToken`, `refreshToken`,
   `access_token`, `refresh_token`, `apiToken`. Naming the qualifier therefore
   costs the quarantine nothing and stops it eating project data.

   What this deliberately does NOT do is consult the value. A boundary that
   decides by inspecting the thing it is guarding is weaker than one that decides
   by structure, and guessing whether ordinary screenplay prose "looks secret"
   would be the scanner's opinion rather than a rule. Key shape decides; the
   value is never asked. */
const SECRET_WORDS = new Set(["secret", "password", "passcode", "credential", "credentials", "apikey", "authsecret", "bearer", "authorization", "privatekey", "clientsecret"]);
const SECRET_WORD_PAIRS = new Set(["api key", "api keys", "auth secret", "client secret", "private key", "secret key", "access token", "refresh token", "api token", "auth token", "bearer token", "id token", "oauth token", "session token", "editor pass", "viewer pass"]);

function keyWords(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}
const ABSOLUTE_PATH_PATTERN = /(?:^|["'\s(])(?:[A-Za-z]:[\\/]|\\\\[A-Za-z0-9_.-]+\\|\/(?:Users|home|var|etc|tmp|mnt|Volumes)\/)/;
const ENDPOINT_PATTERN = /\b(?:https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)|ws:\/\/|wss:\/\/)/i;
const CREDENTIAL_URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i;

function keyLooksSecret(key) {
  const words = keyWords(key);
  for (const word of words) if (SECRET_WORDS.has(word)) return true;
  for (let index = 0; index + 1 < words.length; index++)
    if (SECRET_WORD_PAIRS.has(`${words[index]} ${words[index + 1]}`)) return true;
  return false;
}

function valueLooksSensitive(value) {
  if (typeof value !== "string" || value === "") return null;
  if (CREDENTIAL_URL_PATTERN.test(value)) return "a URL carrying credentials";
  if (ABSOLUTE_PATH_PATTERN.test(value)) return "an absolute host path";
  if (ENDPOINT_PATTERN.test(value)) return "a local endpoint";
  return null;
}

/* ---- rules --------------------------------------------------------------- */

const RULES = [
  /* =====================================================================
     M080 runs FIRST, so that no later rule can carry a quarantined value.
     A rule that runs last and cleans up would be a review step, and a review
     step is exactly what "we are careful" means. */
  {
    id: "M080",
    name: "runtime and credential quarantine",
    summary: "Refuses to carry API keys, auth secrets, passcodes, absolute host paths, local endpoints and credential URLs into the OFP document, wherever in the legacy project they appear.",
    origin: "P2",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.DETERMINISTIC,
    apply(context) {
      const quarantine = (value, pointer, keyName) => {
        if (Array.isArray(value)) {
          value.forEach((entry, index) => quarantine(entry, `${pointer}${ptr(index)}`, null));
          return;
        }
        if (isObject(value)) {
          for (const [key, child] of Object.entries(value)) quarantine(child, `${pointer}${ptr(key)}`, key);
          return;
        }
        if (keyName !== null && keyLooksSecret(keyName)) {
          context.quarantine(pointer, `the key ${JSON.stringify(keyName)} names a credential; Decision 17 says these are never serialised into a project document`);
          context.diagnostic("migration.secret.quarantined", `${pointer}: ${JSON.stringify(keyName)} names a credential and was not carried into the OFP document`, { where: pointer });
          return;
        }
        const sensitive = valueLooksSensitive(value);
        if (sensitive) {
          context.quarantine(pointer, `the value is ${sensitive} and must not become portable film semantics`);
          context.diagnostic("migration.path.quarantined", `${pointer}: the value is ${sensitive} and was not carried into the OFP document`, { where: pointer });
        }
      };
      quarantine(context.source, "", null);
    },
  },

  /* =====================================================================
     M001 - the frozen ID for "6.7 -> 1.0". It targets 1.0-draft.N while the
     draft lane is open; only the target LABEL moves at release. */
  {
    id: "M001",
    name: "legacy CineBraid project to Open Film Project",
    summary: "Writes the format block that makes the document self-describing: format.id, the contract version, the declared profiles and extensions, and the generating application - which is a different number from the contract and says so.",
    origin: "audit Part 27",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.DETERMINISTIC,
    apply(context) {
      context.candidate.format = {
        id: context.formatId,
        version: context.contractVersion,
        profiles: ["core", "bible", "shot-planning"],
        extensions: { "com.cinebraid.workflow": "1", "com.cinebraid.legacy": "1" },
        generator: { name: "CineBraid", version: context.generatorVersion },
      };
      /* The legacy schema marker is not carried forward: `format.version` is now
         the one place a reader looks. Dropping it is a named act, which is the
         difference between this and a silent rewrite of somebody's lineage. */
      for (const pointer of ["/schemaVersion", "/meta/schemaVersion"])
        if (context.exists(pointer))
          context.dropped(pointer, "superseded by format.version; the legacy marker is not carried into the OFP document and the SOURCE project keeps its own");
    },
  },

  /* =====================================================================
     M002 - version marker classification. The only inferential part is the film
     draft reading, and it is the reading that P0 §10.5 says needs a statement. */
  {
    id: "M002",
    name: "version marker classification",
    summary: "Separates meta.version, meta.hubVersion and the application version. A film draft label becomes meta.draft with a suggested statement, because the classification is a heuristic; an application version and the BLANK() default are dropped.",
    origin: "audit Part 27",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.MIXED,
    apply(context) {
      const { detection } = context;
      if (context.exists("/meta/hubVersion"))
        context.dropped("/meta/hubVersion", "tracked the application through the anchor-hub era and then froze; superseded by format.version and format.generator.version");

      if (!context.exists("/meta/version")) return;
      const value = detection.metaVersion;
      if (detection.metaVersionClass === META_VERSION_CLASS.APPLICATION_VERSION) {
        context.dropped("/meta/version", `${JSON.stringify(value)} matches a CineBraid release; the application version belongs in format.generator.version and is already there`);
        return;
      }
      if (detection.metaVersionClass === META_VERSION_CLASS.TEMPLATE_DEFAULT) {
        context.dropped("/meta/version", `${JSON.stringify(value)} is the new-project default and carries no information about this film`);
        return;
      }
      if (detection.metaVersionClass === META_VERSION_CLASS.FILM_DRAFT) {
        context.write("", "/meta/draft", value, { from: "/meta/version", note: "read as the film's own draft label" });
        context.statement({
          target: { path: "/meta/draft" },
          kind: "suggested",
          note: `Legacy meta.version was ${JSON.stringify(value)}, which matched no CineBraid release; read as the film's own draft number. The field has held three incompatible meanings, so this classification is a heuristic.`,
          from: "/meta/version",
        });
        return;
      }
      context.preserve("/meta/version", `meta.version is ${JSON.stringify(value)}, which matches neither a release, the new-project default, nor a draft label; preserved rather than classified`);
      context.diagnostic("migration.review.required", `/meta/version: ${JSON.stringify(value)} could not be classified as a film draft or an application version`, { where: "/meta/version" });
    },
  },

  /* =====================================================================
     M003 - project metadata. */
  {
    id: "M003",
    name: "project metadata",
    summary: "Maps the meta fields OFP core declares (title, aspect ratio) and gives the rest of meta an explicit home: world and style intent are preserved, workflow settings go to M050.",
    origin: "P2",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.DETERMINISTIC,
    apply(context) {
      for (const [legacyKey, ofpPath] of [["title", "/meta/title"], ["aspectRatio", "/meta/aspectRatio"], ["logline", "/meta/logline"], ["synopsis", "/meta/synopsis"]]) {
        const pointer = ptr("meta", legacyKey);
        if (!context.exists(pointer)) continue;
        const value = context.read(pointer);
        /* `null` is not a string, and none of these fields is declared nullable.
           Writing it would produce a document the contract rejects, so the fact
           that the slot existed and was never set is preserved instead of being
           forced into a field that cannot hold it. */
        if (typeof value === "string") context.write("", ofpPath, value, { from: pointer });
        else context.preserve(pointer, `meta.${legacyKey} is ${value === null ? "null" : typeof value} and the contract declares this field a string; the value is preserved rather than written into a field that cannot hold it`);
      }
      /* `format` here is the legacy free-text "Short film" label, and it collides
         head-on with the format BLOCK. It is preserved rather than mapped for
         exactly that reason - one name, two meanings, and the block wins. */
      for (const key of ["format", "world", "styleBlocks", "globalStylePrompt", "globalNegativePrompt", "v5", "schemaMigrations"]) {
        const pointer = ptr("meta", key);
        if (context.exists(pointer)) context.preserve(pointer, `meta.${key} has no OFP core home at ${context.contractVersion}`);
      }
    },
  },

  /* =====================================================================
     M053 - the defaulted five. */
  {
    id: "M053",
    name: "default QC checklist",
    summary: "Drops qcChecklist when it is byte-identical to the new-project template, and preserves it otherwise. A default shipped as production truth is not production truth.",
    origin: "audit Part 27",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.DETERMINISTIC,
    apply(context) {
      if (!context.exists("/qcChecklist")) return;
      const value = context.read("/qcChecklist");
      const isTemplate = Array.isArray(value) && value.length === 5 && value.every((entry, index) => entry === context.templateQcChecklist[index]);
      if (isTemplate) {
        context.claimSubtree("/qcChecklist", DISPOSITION.DROPPED, [], "identical to the new-project template; a default is not an authored checklist");
        return;
      }
      context.preserve("/qcChecklist", "authored QC checklist; the bible profile has no declared home for it at this contract revision");
    },
  },

  /* =====================================================================
     M060 - deterministic ID minting, using the rule P1 defined and tested.

         Array position may be used to MINT an identity exactly once.
         Array position may never BE an identity.

     Runs before every record-creating rule so that a later rule never has to
     invent one on the spot - and so that the report can list every mint in one
     place. No clocks, no counters, no UUIDs: the same legacy input must always
     produce the same IDs, or migration is not re-runnable. */
  {
    id: "M060",
    name: "deterministic ID minting",
    summary: "Mints stable IDs for legacy records that have none, from the record type, its parent and its position - reading the position exactly once, and never storing it.",
    origin: "P2 (implements P0 N2)",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.DETERMINISTIC,
    apply(context) {
      for (const kind of ENTITY_KINDS) {
        const list = context.read(ptr(kind.legacy));
        if (!Array.isArray(list)) continue;
        context.mintCollection(ptr(kind.legacy), list, { type: kind.type, parentSubject: "" });
        list.forEach((entity, index) => {
          if (!isObject(entity)) return;
          const subject = `${kind.type}:${context.identityOf(ptr(kind.legacy, index), entity)}`;
          context.mintCollection(ptr(kind.legacy, index, "continuityStates"), entity.continuityStates, { type: "state", parentSubject: subject });
          context.mintCollection(ptr(kind.legacy, index, "coverageSlots"), entity.coverageSlots, { type: "coverage", parentSubject: subject });
        });
      }
      const shots = context.read("/shots");
      if (!Array.isArray(shots)) return;
      context.mintCollection("/shots", shots, { type: "shot", parentSubject: "" });
      shots.forEach((shot, index) => {
        if (!isObject(shot)) return;
        const subject = `shot:${context.identityOf(ptr("shots", index), shot)}`;
        context.mintCollection(ptr("shots", index, "keyframes"), shot.keyframes, { type: "frame", parentSubject: subject });
        context.mintCollection(ptr("shots", index, "clips"), shot.clips, { type: "motion", parentSubject: subject });
      });
      const scenes = context.read("/scenes");
      if (Array.isArray(scenes)) context.mintCollection("/scenes", scenes, { type: "scene", parentSubject: "" });
      const audio = context.read("/audio");
      if (Array.isArray(audio)) context.mintCollection("/audio", audio, { type: "voice", parentSubject: "" });
    },
  },

  /* =====================================================================
     M004 - scenes. */
  {
    id: "M004",
    name: "scenes",
    summary: "Maps scenes into story.scenes[], materialising the narrative ordinal that legacy stored only as array position, and preserving tier, tone and the reserved word `stage`.",
    origin: "P2",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.DETERMINISTIC,
    apply(context) {
      const scenes = context.read("/scenes");
      if (!Array.isArray(scenes)) return;
      const target = [];
      scenes.forEach((scene, index) => {
        const from = ptr("scenes", index);
        if (!isObject(scene)) { context.preserve(from, "scene entry is not an object"); return; }
        const id = context.identityOf(from, scene);
        const record = { id };
        const subject = `scene:${id}`;
        context.claimIdentity(from, scene, subject);
        if (nonEmptyString(scene.title)) context.set(record, "/title", scene.title, from + ptr("title"), subject);
        /* `typeof === "string"` rather than `!== undefined`: an authored empty
           string is meaningful and is carried, and a null is not silently forced
           into a field the contract declares as a string. */
        if (typeof scene.whatHappens === "string") context.set(record, "/summary", scene.whatHappens, from + ptr("whatHappens"), subject);
        /* Legacy stores narrative order as array position and nothing else, so
           the position is the only encoding there is. Materialising it is what
           P0 requires - after this, order is data and position is not. */
        /* No ledger claim: array position is not a source VALUE, so there is no
           leaf to dispose of. What the position produces is recorded by the rule
           and asserted by the suite, not accounted for as if it were data. */
        record.order = { script: index + 1 };
        for (const key of ["howItFeels", "tier", "stage", "characters", "notes", "audio"])
          if (context.exists(from + ptr(key)))
            context.preserve(from + ptr(key), key === "stage"
              ? "scene.stage means a pipeline phase in legacy and a sound stage in P0 §12's reserved vocabulary; it is preserved rather than carried into core under either meaning"
              : `scene.${key} has no OFP core home at ${context.contractVersion}`);
        target.push(record);
      });
      if (scenes.length === 0) context.claim("/scenes", DISPOSITION.MAPPED, ["#/story/scenes"], "explicitly empty collection, preserved as empty");
      context.candidate.story = { scenes: target };
    },
  },

  /* =====================================================================
     M006 - entities. */
  {
    id: "M006",
    name: "entities",
    summary: "Maps characters, locations, props and vehicles into entities.<plural>[], preserving every legacy ID verbatim.",
    origin: "P2",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.DETERMINISTIC,
    apply(context) {
      for (const kind of ENTITY_KINDS) {
        const list = context.read(ptr(kind.legacy));
        if (!Array.isArray(list)) continue;
        const target = [];
        /* An explicitly empty collection is a fact about the project: it says
           the collection was there. Claiming the leaf is what stops the M070
           sweep picking it up as unknown content. */
        if (list.length === 0) context.claim(ptr(kind.legacy), DISPOSITION.MAPPED, [`#/entities/${kind.ofp}`], "explicitly empty collection, preserved as empty");
        list.forEach((entity, index) => {
          const from = ptr(kind.legacy, index);
          if (!isObject(entity)) { context.preserve(from, "entity entry is not an object"); return; }
          const id = context.identityOf(from, entity);
          const subject = `${kind.type}:${id}`;
          const record = { id };
          context.claimIdentity(from, entity, subject);
          if (nonEmptyString(entity.name)) context.set(record, "/name", entity.name, from + ptr("name"), subject);
          if (kind.type === "character" && nonEmptyString(entity.role)) context.set(record, "/role", entity.role, from + ptr("role"), subject);
          else if (context.exists(from + ptr("role"))) context.preserve(from + ptr("role"), `role has no OFP core home on a ${kind.type}`);
          for (const key of ["prefix", "anchorPrefix", "anchors", "sameObjectAs", "driftNotes", "expressions", "expressionSlots", "coveragePolicy", "tracking", "geometryNotes", "heroLevel", "primaryAngleAssignment", "coverageMigrationHistory"])
            if (context.exists(from + ptr(key))) context.preserve(from + ptr(key), `${kind.type}.${key} has no OFP core home at ${context.contractVersion}`);
          target.push(record);
          context.registerEntity(kind.type, id, record, from, entity);
        });
        context.entityCollection(kind.ofp, target, list.length === 0 ? ptr(kind.legacy) : null);
      }
    },
  },

  /* =====================================================================
     M011 - the D1 cluster. Critical in the audit because five readers disagreed,
     not because the stored values diverged; when they DO diverge, concatenating
     them would invent a third description nobody wrote. */
  {
    id: "M011",
    name: "entity visual description",
    summary: "Resolves the seven legacy prose fields into one `description`. One non-empty value maps deterministically; two or more that differ become a disputed statement with every text retained as a candidate.",
    origin: "audit Part 27",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.MIXED,
    apply(context) {
      for (const entity of context.entities()) {
        const found = [];
        for (const field of ENTITY_PROSE_FIELDS) {
          const pointer = entity.from + ptr(field);
          if (!context.exists(pointer)) continue;
          const value = context.read(pointer);
          if (!nonEmptyString(value)) { context.dropped(pointer, `${field} is empty; an empty string is not a description`); continue; }
          found.push({ field, pointer, value });
        }
        if (found.length === 0) continue;
        const distinct = [...new Set(found.map((entry) => entry.value))];
        const winner = found[0];
        context.set(entity.record, "/description", winner.value, winner.pointer, entity.subject);
        if (distinct.length === 1) {
          for (const entry of found.slice(1)) context.claim(entry.pointer, DISPOSITION.MAPPED, [`${entity.subject}#/description`], `identical to ${winner.field}; one value, several spellings`);
          continue;
        }
        for (const entry of found.slice(1))
          context.claim(entry.pointer, DISPOSITION.STATED, [`${entity.subject}#/description`], `differs from ${winner.field}; retained verbatim as a dispute candidate`);
        context.statement({
          target: { subject: entity.subject, path: "/description" },
          kind: "disputed",
          candidates: found.map((entry) => ({ value: entry.value, note: `legacy ${entry.field}` })),
          note: `${found.length} legacy prose fields hold different text for this entity (${found.map((entry) => entry.field).join(", ")}). Concatenating them would invent a description nobody wrote; ${winner.field} is proposed and every text is retained.`,
          from: winner.pointer,
        });
      }
    },
  },

  /* =====================================================================
     M007 - continuity states. */
  {
    id: "M007",
    name: "continuity states",
    summary: "Maps continuityStates[] into states[], including the derivation link that makes a state a delta on another rather than a second description of the same object.",
    origin: "P2",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.DETERMINISTIC,
    apply(context) {
      for (const entity of context.entities()) {
        const listPointer = entity.from + ptr("continuityStates");
        const list = context.read(listPointer);
        if (!Array.isArray(list)) continue;
        if (list.length === 0) { context.claim(listPointer, DISPOSITION.MAPPED, [`${entity.subject}#/states`], "explicitly empty collection, preserved as empty"); entity.record.states = []; continue; }
        const states = [];
        list.forEach((state, index) => {
          const from = listPointer + ptr(index);
          if (!isObject(state)) { context.preserve(from, "state entry is not an object"); return; }
          const id = context.identityOf(from, state);
          const subject = `${entity.subject}/state:${id}`;
          const record = { id };
          context.claimIdentity(from, state, subject);
          if (nonEmptyString(state.name)) context.set(record, "/name", state.name, from + ptr("name"), subject);
          if (typeof state.isDefault === "boolean") context.set(record, "/isDefault", state.isDefault, from + ptr("isDefault"), subject);
          if (nonEmptyString(state.parentStateId)) context.set(record, "/derivesFrom", state.parentStateId, from + ptr("parentStateId"), subject);
          for (const key of ["generationMode", "appliesTo", "assetPromptProfile", "assetPromptNotes", "tracking"])
            if (context.exists(from + ptr(key))) context.preserve(from + ptr(key), `state.${key} has no OFP core home at ${context.contractVersion}`);
          states.push(record);
          context.registerState(entity, record, from, state, subject);
        });
        entity.record.states = states;
      }
    },
  },

  /* =====================================================================
     M016 - nine spellings of one field. */
  {
    id: "M016",
    name: "continuity state delta text",
    summary: "Resolves the nine legacy state note aliases into `delta`. Legacy telemetry already counted these, so the aliases are known rather than guessed at.",
    origin: "audit Part 27",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.DETERMINISTIC,
    apply(context) {
      for (const state of context.states()) {
        let chosen = null;
        for (const field of STATE_DELTA_FIELDS) {
          const pointer = state.from + ptr(field);
          if (!context.exists(pointer)) continue;
          const value = context.read(pointer);
          if (!nonEmptyString(value)) { context.dropped(pointer, `state.${field} is empty`); continue; }
          if (chosen === null) { chosen = { field, pointer, value }; context.set(state.record, "/delta", value, pointer, state.subject); continue; }
          context.claim(pointer, DISPOSITION.PRESERVED, [`${state.subject}#/delta`], `${state.record.id} also carries ${field}; ${chosen.field} took precedence`);
          context.preserveValue(pointer, `a second spelling of the state delta; ${chosen.field} took precedence`, { alreadyClaimed: true });
        }
      }
    },
  },

  /* =====================================================================
     M008 - coverage slots. */
  {
    id: "M008",
    name: "coverage slots",
    summary: "Maps coverageSlots[] into coverage[] on characters, locations, props and vehicles.",
    origin: "P2",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.DETERMINISTIC,
    apply(context) {
      for (const entity of context.entities()) {
        const listPointer = entity.from + ptr("coverageSlots");
        const list = context.read(listPointer);
        if (!Array.isArray(list)) continue;
        /* Characters used to be sent down the preservation branch here, on the
           reading that a character's identity views are references with a purpose
           rather than coverage of a place. P4-SEM-A settled that differently and
           for a concrete reason: CineBraid has always given characters the same
           ensureCoverageSlots() view slots as every other entity, so preserving
           them meant a migrated character carried its front/profile/rear
           requirements as an opaque legacy blob no other client could read. The
           containment table now gives `coverage` a character scope, so they map
           like anything else and M030 still writes the approval edges.
           `expressionSlots[]` is untouched by this rule and stays preserved -
           whether an expression is a coverage record is reconciliation Q3. */
        if (list.length === 0) { context.claim(listPointer, DISPOSITION.MAPPED, [`${entity.subject}#/coverage`], "explicitly empty collection, preserved as empty"); entity.record.coverage = []; continue; }
        const coverage = [];
        list.forEach((slot, index) => {
          const from = listPointer + ptr(index);
          if (!isObject(slot)) { context.preserve(from, "coverage entry is not an object"); return; }
          const id = context.identityOf(from, slot);
          const subject = `${entity.subject}/coverage:${id}`;
          const record = { id };
          context.claimIdentity(from, slot, subject);
          if (nonEmptyString(slot.label)) context.set(record, "/name", slot.label, from + ptr("label"), subject);
          if (nonEmptyString(slot.notes)) context.set(record, "/description", slot.notes, from + ptr("notes"), subject);
          for (const key of ["status", "replacementHistory", "provenance"])
            if (context.exists(from + ptr(key))) context.preserve(from + ptr(key), `coverage.${key} has no OFP core home at ${context.contractVersion}`);
          coverage.push(record);
          context.registerCoverage(entity, record, from, slot, subject);
        });
        entity.record.coverage = coverage;
      }
    },
  },

  /* =====================================================================
     M015 - D7: two encodings of one fact. */
  {
    id: "M015",
    name: "coverage requirement encodings",
    summary: "Reconciles the boolean `required` with the `requirement` enum into the single core field COVERAGE.requirement. They are two encodings of one fact; the enum wins, and a genuine disagreement between them is reported rather than resolved quietly.",
    origin: "audit Part 27",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.DETERMINISTIC,
    apply(context) {
      for (const slot of context.coverageSlots()) {
        const requiredPointer = slot.from + ptr("required");
        const requirementPointer = slot.from + ptr("requirement");
        const hasRequired = context.exists(requiredPointer);
        const hasRequirement = context.exists(requirementPointer);
        if (!hasRequired && !hasRequirement) continue;
        const rawRequirement = hasRequirement ? context.read(requirementPointer) : undefined;
        const declared = Coverage.normalizeRequirement(rawRequirement);

        /* A value outside the vocabulary is never coerced into a neighbour. It is
           preserved and reported, which is what schema.enum.unknown does for a
           document already in the format. */
        if (hasRequirement && !declared) {
          context.preserve(requirementPointer, `coverage.requirement is ${JSON.stringify(rawRequirement)}, which is outside the declared enum; the value is kept rather than coerced into one`);
          context.diagnostic("migration.review.required", `${slot.subject}: coverage.requirement=${JSON.stringify(rawRequirement)} is not one of ${Coverage.COVERAGE_REQUIREMENTS.join(", ")}; it was preserved and the enum was taken from the boolean if one is present`, { where: requirementPointer, target: slot.subject });
        }

        if (declared) {
          context.set(slot.record, "/requirement", declared, requirementPointer, slot.subject);
          if (hasRequired) {
            /* The boolean is a LOSSY PROJECTION of the enum: `true` can only mean
               "required", but `false` is equally consistent with "planned" and
               "not-required". So only an assertion the enum denies is a conflict,
               and `required:false` beside either non-required member is ordinary,
               coherent data the application itself writes. */
            const conflict = Coverage.requirementConflict({ required: context.read(requiredPointer), requirement: declared });
            context.claim(requiredPointer, DISPOSITION.PRESERVED, [`${slot.subject}#/requirement`], conflict ? "the boolean contradicts the enum; the enum wins and the contradiction is reported" : "the boolean is a lossy projection of the enum and agrees with it");
            if (conflict)
              context.diagnostic("migration.review.required", `${slot.subject}: coverage.required=${JSON.stringify(conflict.legacy)} can only mean ${conflict.legacyAdmits.join(" or ")} but coverage.requirement says ${JSON.stringify(conflict.declared)}; the enum was used`, { where: requiredPointer, target: slot.subject });
          }
        } else if (hasRequired) {
          /* THE READING OF THE LEGACY BOOLEAN, and the line in this rule that had
             to change. It used to say `read(required) ? "required" : "not-required"`,
             manufacturing the more specific of two states the boolean cannot tell
             apart — and disagreeing with the running application, which has always
             read `required === false` as "planned". The mapping now comes from
             public/shared-coverage.js, so migration and runtime cannot give one
             slot two different requirements. */
            const fromBoolean = Coverage.coverageRequirement({ required: context.read(requiredPointer) });
            context.set(slot.record, "/requirement", fromBoolean, requiredPointer, slot.subject);
        }
      }
    },
  },

  /* =====================================================================
     M017 - voices. P1 §14 froze the shape: a voice is a first-class entity and a
     character POINTS AT it, so one voice can serve several characters and a
     narrator nobody links is an ordinary entity rather than an orphan. */
  {
    id: "M017",
    name: "audio entities to voices",
    summary: "Maps the legacy audio[] collection into entities.voices[] and turns a character's voice reference into a voices[] link, never a characterId on the voice.",
    origin: "P2",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.DETERMINISTIC,
    apply(context) {
      const list = context.read("/audio");
      const voices = [];
      if (Array.isArray(list)) {
        list.forEach((entry, index) => {
          const from = ptr("audio", index);
          if (!isObject(entry)) { context.preserve(from, "audio entry is not an object"); return; }
          const id = context.identityOf(from, entry);
          const subject = `voice:${id}`;
          const record = { id };
          context.claimIdentity(from, entry, subject);
          if (nonEmptyString(entry.name)) context.set(record, "/name", entry.name, from + ptr("name"), subject);
          for (const field of ["description", "notes", "block"]) {
            const pointer = from + ptr(field);
            if (context.exists(pointer) && nonEmptyString(context.read(pointer)) && record.description === undefined) {
              context.set(record, "/description", context.read(pointer), pointer, subject);
            } else if (context.exists(pointer)) {
              context.preserve(pointer, `audio.${field} did not become the voice description`);
            }
          }
          if (nonEmptyString(entry.language)) context.set(record, "/language", entry.language, from + ptr("language"), subject);
          voices.push(record);
          context.registerVoice(id);
        });
        if (list.length === 0) context.claim("/audio", DISPOSITION.MAPPED, ["#/entities/voices"], "explicitly empty collection, preserved as empty");
        context.entityCollection("voices", voices, list.length === 0 ? "/audio" : null);
      }
      for (const entity of context.entities()) {
        if (entity.type !== "character") continue;
        const pointer = entity.from + ptr("voiceId");
        if (!context.exists(pointer)) continue;
        const voiceId = context.read(pointer);
        if (!nonEmptyString(voiceId)) { context.dropped(pointer, "empty voice reference"); continue; }
        if (context.hasVoice(voiceId)) {
          entity.record.voices = [{ voiceId, role: "primary" }];
          context.claim(pointer, DISPOSITION.MAPPED, [`${entity.subject}#/voices`], "a character points at a voice; the voice carries no characterId, so it stays reusable");
          continue;
        }
        /* A dangling reference is not written as a link. Writing it would produce
           a document the validator rejects - so migration would have turned a
           project with one broken pointer into a project that cannot be opened
           at all. Instead the value is carried in `candidates[]`, which is never
           auto-compacted, and a human resolves it. Decision 6: dangling
           references become evidence, never silent drops. */
        context.claim(pointer, DISPOSITION.STATED, [`${entity.subject}#/voices`], "the voice reference names no audio entity; the value is retained as a dispute candidate rather than written as a link that cannot resolve");
        context.statement({
          target: { subject: entity.subject, path: "/voices" },
          kind: "disputed",
          candidates: [
            { value: [{ voiceId, role: "primary" }], note: `the legacy link as written; no audio entity named ${JSON.stringify(voiceId)} exists in this project` },
            { value: [], note: "no voice link, which is what this project can currently express" },
          ],
          note: `Legacy character.voiceId was ${JSON.stringify(voiceId)} and names no audio entity. Writing the link would produce a document the contract rejects, so the value is retained here instead.`,
          from: pointer,
        });
        context.diagnostic("migration.ref.unresolved", `${entity.subject}: voiceId ${JSON.stringify(voiceId)} names no audio entity; the value is retained as a dispute candidate rather than written as an unresolvable link`, { where: pointer, target: entity.subject });
      }
    },
  },

  /* =====================================================================
     M005 - shots. */
  {
    id: "M005",
    name: "shots",
    summary: "Maps shots into shots[], materialising the script ordinal legacy stored only as array position, and preserving the staging prose OFP core has no field for.",
    origin: "P2",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.DETERMINISTIC,
    apply(context) {
      const shots = context.read("/shots");
      if (!Array.isArray(shots)) return;
      const target = [];
      shots.forEach((shot, index) => {
        const from = ptr("shots", index);
        if (!isObject(shot)) { context.preserve(from, "shot entry is not an object"); return; }
        const id = context.identityOf(from, shot);
        const subject = `shot:${id}`;
        const record = { id };
        context.claimIdentity(from, shot, subject);
        if (nonEmptyString(shot.scene)) context.set(record, "/sceneId", shot.scene, from + ptr("scene"), subject);
        if (nonEmptyString(shot.title)) context.set(record, "/title", shot.title, from + ptr("title"), subject);
        if (typeof shot.desc === "string") context.set(record, "/description", shot.desc, from + ptr("desc"), subject);
        /* Same as M004: the position is not a leaf, so it is not claimed. */
        record.order = { script: index + 1 };
        const risksPointer = from + ptr("risks");
        if (context.exists(risksPointer) && Array.isArray(context.read(risksPointer))) {
          const risks = context.read(risksPointer);
          record.risks = [...risks];
          /* Ordered data inside a record, never sorted - sorting risks[] would
             silently reorder a director's priorities. */
          if (risks.length === 0) context.claim(risksPointer, DISPOSITION.MAPPED, [`${subject}#/risks`], "explicitly empty collection, preserved as empty");
          else risks.forEach((_, riskIndex) => context.claim(risksPointer + ptr(riskIndex), DISPOSITION.MAPPED, [`${subject}#/risks`], "risk text carried verbatim in order"));
        }
        for (const key of ["positioning", "safe", "route", "notes", "deliveryIntent", "iterations", "iterBudget", "targetRuntime", "contextDoc", "creationBrief"])
          if (context.exists(from + ptr(key)) && key !== "creationBrief") context.preserve(from + ptr(key), `shot.${key} has no OFP core home at ${context.contractVersion}`);
        target.push(record);
        context.registerShot(id, record, from, shot, subject);
      });
      if (shots.length === 0) context.claim("/shots", DISPOSITION.MAPPED, ["#/shots"], "explicitly empty collection, preserved as empty");
      context.candidate.shots = target;
    },
  },

  /* =====================================================================
     M010 - D2, and the loss is live in the shipped sample today. */
  {
    id: "M010",
    name: "shot duration aliases",
    summary: "Resolves dur, duration and sec into duration.seconds with an explicit basis. Any present value beats the engine default; two aliases that disagree become a disputed statement rather than a silent winner.",
    origin: "audit Part 27",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.MIXED,
    apply(context) {
      for (const shot of context.shots()) {
        const found = [];
        const unset = [];
        for (const field of DURATION_FIELDS) {
          const pointer = shot.from + ptr(field);
          if (!context.exists(pointer)) continue;
          const value = context.read(pointer);
          /* `duration.seconds` is the one nullable field in the contract, and it
             is nullable because production distinguishes three states here: the
             key absent (no duration slot at all), null (the slot exists and its
             length was never set), and a number. A null alias is that middle
             state and is carried as one. */
          if (value === null) { unset.push({ field, pointer }); continue; }
          if (typeof value !== "number" || !Number.isFinite(value)) { context.preserve(pointer, `shot.${field} is not a finite number`); continue; }
          found.push({ field, pointer, value });
        }
        if (found.length === 0) {
          if (!unset.length) continue;
          shot.record.duration = { seconds: null };
          context.claim(unset[0].pointer, DISPOSITION.MAPPED, [`${shot.subject}#/duration/seconds`], "the duration slot exists and its length was never set; null is carried as null, which is a different fact from the key being absent");
          for (const entry of unset.slice(1)) context.claim(entry.pointer, DISPOSITION.MAPPED, [`${shot.subject}#/duration/seconds`], `a second unset alias; ${unset[0].field} took precedence`);
          continue;
        }
        for (const entry of unset) context.claim(entry.pointer, DISPOSITION.MAPPED, [`${shot.subject}#/duration/seconds`], `shot.${entry.field} is unset and a numbered alias took precedence`);
        const winner = found[0];
        const distinct = [...new Set(found.map((entry) => entry.value))];
        shot.record.duration = { seconds: winner.value, basis: "authored" };
        context.claim(winner.pointer, DISPOSITION.MAPPED, [`${shot.subject}#/duration/seconds`, `${shot.subject}#/duration/basis`], `${winner.field} is what the prompt engine reads today, so migrating to it cannot change what an existing shot renders as`);
        if (distinct.length === 1) {
          for (const entry of found.slice(1)) context.claim(entry.pointer, DISPOSITION.MAPPED, [`${shot.subject}#/duration/seconds`], `identical to ${winner.field}`);
          continue;
        }
        for (const entry of found.slice(1)) context.claim(entry.pointer, DISPOSITION.STATED, [`${shot.subject}#/duration`], `disagrees with ${winner.field}; retained verbatim as a dispute candidate`);
        context.statement({
          target: { subject: shot.subject, path: "/duration" },
          kind: "disputed",
          candidates: found.map((entry) => ({ value: { seconds: entry.value, basis: "authored" }, note: `legacy ${entry.field} = ${entry.value}` })),
          note: `The legacy duration aliases disagree (${found.map((entry) => `${entry.field}=${entry.value}`).join(", ")}). ${winner.field} is proposed because it is the value the current build renders; the others are retained.`,
          from: winner.pointer,
        });
      }
    },
  },

  /* =====================================================================
     M009 - frames and motion. */
  {
    id: "M009",
    name: "keyframes and clips",
    summary: "Maps keyframes[] into frames[] with a first/last role, and clips[] into motion[]. Frame role comes from position because ordered keyframes are legacy's only encoding of it.",
    origin: "P2",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.DETERMINISTIC,
    apply(context) {
      for (const shot of context.shots()) {
        const framesPointer = shot.from + ptr("keyframes");
        const keyframes = context.read(framesPointer);
        if (Array.isArray(keyframes)) {
          if (keyframes.length === 0) { context.claim(framesPointer, DISPOSITION.MAPPED, [`${shot.subject}#/frames`], "explicitly empty collection, preserved as empty"); shot.record.frames = []; }
          else {
            const frames = [];
            keyframes.forEach((keyframe, index) => {
              const from = framesPointer + ptr(index);
              if (!isObject(keyframe)) { context.preserve(from, "keyframe entry is not an object"); return; }
              const id = context.identityOf(from, keyframe);
              const subject = `${shot.subject}/frame:${id}`;
              const record = { id };
              context.claimIdentity(from, keyframe, subject);
              /* One frame is the first; two are first and last; more are first,
                 intermediates and last. Ordered keyframes are the only encoding
                 legacy has, so this is a reading of the model rather than a
                 guess about a production decision - and it emits no statement. */
              record.role = index === 0 ? "first" : index === keyframes.length - 1 ? "last" : "intermediate";
              if (typeof keyframe.description === "string") context.set(record, "/description", keyframe.description, from + ptr("description"), subject);
              for (const key of ["label", "title", "required"])
                if (context.exists(from + ptr(key))) context.preserve(from + ptr(key), `keyframe.${key} has no OFP core home at ${context.contractVersion}`);
              frames.push(record);
              context.registerFrame(shot, record, from, keyframe, subject);
            });
            shot.record.frames = frames;
          }
        }
        const clipsPointer = shot.from + ptr("clips");
        const clips = context.read(clipsPointer);
        if (!Array.isArray(clips)) continue;
        if (clips.length === 0) { context.claim(clipsPointer, DISPOSITION.MAPPED, [`${shot.subject}#/motion`], "explicitly empty collection, preserved as empty"); shot.record.motion = []; continue; }
        const motion = [];
        clips.forEach((clip, index) => {
          const from = clipsPointer + ptr(index);
          if (!isObject(clip)) { context.preserve(from, "clip entry is not an object"); return; }
          const id = context.identityOf(from, clip);
          const subject = `${shot.subject}/motion:${id}`;
          const record = { id };
          context.claimIdentity(from, clip, subject);
          if (nonEmptyString(clip.motionPrompt)) context.set(record, "/description", clip.motionPrompt, from + ptr("motionPrompt"), subject);
          if (typeof clip.dur === "number" && Number.isFinite(clip.dur)) context.set(record, "/durationSeconds", clip.dur, from + ptr("dur"), subject);
          motion.push(record);
        });
        shot.record.motion = motion;
      }
    },
  },

  /* =====================================================================
     M014 - D5: three places one frame selection can live. */
  {
    id: "M014",
    name: "duplicate frame stores",
    summary: "Reconciles creationBrief.frames[] and frameWorkflows{} against keyframes[]. Identical text collapses; divergent text becomes a disputed statement, because three stores of one description is not three facts.",
    origin: "audit Part 27",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.MIXED,
    apply(context) {
      for (const shot of context.shots()) {
        const briefPointer = shot.from + ptr("creationBrief");
        if (!context.exists(briefPointer)) continue;
        const brief = context.read(briefPointer);
        if (!isObject(brief)) { context.preserve(briefPointer, "creationBrief is not an object"); continue; }
        const briefFramesPointer = briefPointer + ptr("frames");
        const briefFrames = context.read(briefFramesPointer);
        if (Array.isArray(briefFrames)) {
          if (briefFrames.length === 0) context.claim(briefFramesPointer, DISPOSITION.DROPPED, [], "explicitly empty duplicate frame store");
          briefFrames.forEach((entry, index) => {
            const from = briefFramesPointer + ptr(index);
            if (!isObject(entry)) { context.preserve(from, "creationBrief frame entry is not an object"); return; }
            const frame = context.frameById(shot, entry.id);
            if (!frame) { context.preserve(from, `creationBrief.frames[${index}] has no matching keyframe; the second store held a frame the first did not`); return; }
            for (const key of ["id", "label", "title"])
              if (context.exists(from + ptr(key))) context.claim(from + ptr(key), DISPOSITION.DROPPED, [], `duplicate of keyframe.${key}; one frame, one record`);
            const actionPointer = from + ptr("action");
            if (context.exists(actionPointer)) {
              const action = context.read(actionPointer);
              const description = frame.record.description;
              if (action === description || !nonEmptyString(action)) {
                context.claim(actionPointer, DISPOSITION.DROPPED, [`${frame.subject}#/description`], "identical to the keyframe description; the duplicate store adds nothing");
              } else if (!nonEmptyString(description)) {
                context.set(frame.record, "/description", action, actionPointer, frame.subject);
              } else {
                context.claim(actionPointer, DISPOSITION.STATED, [`${frame.subject}#/description`], "the two frame stores hold different text; retained as a dispute candidate");
                context.statement({
                  target: { subject: frame.subject, path: "/description" },
                  kind: "disputed",
                  candidates: [
                    { value: description, note: "legacy keyframes[].description" },
                    { value: action, note: "legacy creationBrief.frames[].action" },
                  ],
                  note: "This frame's description was stored in two places and the two disagree. keyframes[] is proposed because it is what the workspace renders; both texts are retained.",
                  from: actionPointer,
                });
              }
            }
          });
        }
        for (const key of ["frameWorkflows", "motionPlan", "blockingBuilds", "deliveryIntent"])
          if (context.exists(briefPointer + ptr(key)))
            context.preserve(briefPointer + ptr(key), `creationBrief.${key} is CineBraid workflow state with no OFP core home`);
      }
    },
  },

  /* =====================================================================
     M013 - D6: six places an approval can live. */
  {
    id: "M013",
    name: "frame approval selection",
    summary: "Decides which legacy filename is a frame's approved output - `winner` over the shot-level single still - and routes review bookkeeping to the CineBraid extension. A selectedCandidate is a candidate and is never treated as an approval.",
    origin: "audit Part 27",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.DETERMINISTIC,
    apply(context) {
      for (const shot of context.shots()) {
        const frames = context.framesOf(shot);
        frames.forEach((frame, index) => {
          const winnerPointer = frame.from + ptr("winner");
          if (context.exists(winnerPointer) && nonEmptyString(context.read(winnerPointer)))
            context.approve(frame.subject, context.read(winnerPointer), winnerPointer, FRAME_APPROVED_PURPOSE);
          else if (context.exists(winnerPointer))
            context.dropped(winnerPointer, "empty approval filename");
          const selectedPointer = frame.from + ptr("selectedCandidate");
          if (context.exists(selectedPointer)) {
            /* A selected candidate is under review, not approved. Treating it as
               an approval is precisely the confusion `clearUnsupportedBuilderClaims`
               exists to prevent on the import side. */
            context.workflowPut(["frames", frame.subject, "selectedCandidate"], context.read(selectedPointer), selectedPointer,
              "a candidate under review is not an approval; kept as workflow state");
          }
          /* The pre-6.x single still. Only meaningful when the shot has one
             frame - otherwise nobody can say which frame it approved. */
          const shotWinnerPointer = shot.from + ptr("winner");
          if (index === 0 && context.exists(shotWinnerPointer) && nonEmptyString(context.read(shotWinnerPointer))) {
            if (frames.length === 1) context.approve(frame.subject, context.read(shotWinnerPointer), shotWinnerPointer, FRAME_APPROVED_PURPOSE);
            else {
              context.preserve(shotWinnerPointer, "the legacy shot-level single still cannot be attributed to one of several frames");
              context.diagnostic("migration.review.required", `${shot.subject}: a shot-level winner exists alongside ${frames.length} frames and cannot be attributed to one of them`, { where: shotWinnerPointer, target: shot.subject });
            }
          }
        });
        const shotWinnerPointer = shot.from + ptr("winner");
        if (frames.length === 0 && context.exists(shotWinnerPointer))
          context.preserve(shotWinnerPointer, "a shot-level approved still with no frame to attach it to");
        for (const key of ["stageApprovals", "candidateFiles", "referenceInstructions", "referenceRoles", "referenceSelection"])
          if (context.exists(shot.from + ptr(key)))
            context.workflowSubtree(["shots", shot.subject, key], shot.from + ptr(key), "candidate review and reference bookkeeping is CineBraid workflow state");
        for (const key of ["finalStillFile", "finalVideoFile", "approvedMotionFile"]) {
          const pointer = shot.from + ptr("creationBrief") + ptr(key);
          if (!context.exists(pointer)) continue;
          const value = context.read(pointer);
          if (!nonEmptyString(value)) { context.dropped(pointer, `creationBrief.${key} is empty`); continue; }
          context.approve(shot.subject, value, pointer, "other");
        }
      }
      for (const entity of context.entities()) {
        const pointer = entity.from + ptr("approvedFile");
        if (context.exists(pointer) && nonEmptyString(context.read(pointer)))
          context.approve(entity.subject, context.read(pointer), pointer, entity.type === "character" ? "identity-front" : entity.type === "location" ? "location-view" : entity.type === "prop" ? "prop-view" : "other");
        else if (context.exists(pointer)) context.dropped(pointer, "empty approval filename");
        if (context.exists(entity.from + ptr("candidateFiles")))
          context.workflowSubtree(["entities", entity.subject, "candidateFiles"], entity.from + ptr("candidateFiles"), "candidate review bookkeeping is CineBraid workflow state");
      }
      for (const state of context.states()) {
        const pointer = state.from + ptr("approvedFile");
        if (context.exists(pointer) && nonEmptyString(context.read(pointer))) context.approve(state.subject, context.read(pointer), pointer, "other");
        else if (context.exists(pointer)) context.dropped(pointer, "empty approval filename");
      }
      for (const slot of context.coverageSlots()) {
        const pointer = slot.from + ptr("approvedFile");
        if (context.exists(pointer) && nonEmptyString(context.read(pointer))) context.approve(slot.subject, context.read(pointer), pointer, "location-view");
        else if (context.exists(pointer)) context.dropped(pointer, "empty approval filename");
      }
    },
  },

  /* =====================================================================
     M012 - D4: three parallel state fields. */
  {
    id: "M012",
    name: "status fields",
    summary: "Collapses status, workflowStatus and reviewStatus into one production/review pair in the CineBraid extension. workflowStatus wins; `status` is the pre-6.x fallback.",
    origin: "audit Part 27",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.DETERMINISTIC,
    apply(context) {
      const collapse = (owner) => {
        const workflowPointer = owner.from + ptr("workflowStatus");
        const statusPointer = owner.from + ptr("status");
        const reviewPointer = owner.from + ptr("reviewStatus");
        const hasWorkflow = context.exists(workflowPointer);
        const hasStatus = context.exists(statusPointer);
        if (hasWorkflow || hasStatus) {
          const production = hasWorkflow ? context.read(workflowPointer) : context.read(statusPointer);
          context.workflowPut(["status", owner.subject, "production"], production, hasWorkflow ? workflowPointer : statusPointer,
            "OFP core declares no status field at this contract revision; the collapsed pair is kept in the CineBraid extension");
          if (hasWorkflow && hasStatus)
            context.claim(statusPointer, DISPOSITION.PRESERVED, [`#/extensions/com.cinebraid.workflow/status`], "workflowStatus won; the pre-6.x fallback is retained alongside it") &&
              context.preserveValue(statusPointer, "the pre-6.x status field, superseded by workflowStatus", { alreadyClaimed: true });
        }
        if (context.exists(reviewPointer))
          context.workflowPut(["status", owner.subject, "review"], context.read(reviewPointer), reviewPointer, "the review half of the collapsed status pair");
      };
      for (const shot of context.shots()) collapse(shot);
      for (const entity of context.entities()) collapse(entity);
    },
  },

  /* =====================================================================
     M020 - the highest-value migration in the corpus. 28 of 45 Overfit tokens
     are reinterpreted today and 3 vanish, all silently. */
  {
    id: "M020",
    name: "shot dependency codes",
    summary: "Resolves codes[] and the shot characters[] list into subjects[] and setting. An exact match maps deterministically; a suffixed token becomes a disputed statement with both readings and the raw token retained; a token matching nothing is preserved and reported, never dropped.",
    origin: "audit Part 27",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.MIXED,
    apply(context) {
      for (const shot of context.shots()) {
        const subjects = [];
        const seen = new Set();
        const addSubject = (entityId, pointer, note) => {
          if (seen.has(entityId)) { context.claim(pointer, DISPOSITION.MAPPED, [`${shot.subject}#/subjects`], `${entityId} is already a subject of this shot`); return; }
          seen.add(entityId);
          subjects.push({ entityId });
          context.claim(pointer, DISPOSITION.MAPPED, [`${shot.subject}#/subjects`], note);
        };

        const charactersPointer = shot.from + ptr("characters");
        const characters = context.read(charactersPointer);
        if (Array.isArray(characters)) {
          if (characters.length === 0) context.claim(charactersPointer, DISPOSITION.MAPPED, [`${shot.subject}#/subjects`], "explicitly empty collection");
          characters.forEach((token, index) => {
            const pointer = charactersPointer + ptr(index);
            if (!nonEmptyString(token)) { context.dropped(pointer, "empty character token"); return; }
            if (context.entityExists(token)) addSubject(token, pointer, "an authored character reference with no ambiguity");
            else {
              context.preserveValue(pointer, `shot.characters[] token ${JSON.stringify(token)} names no entity`);
              context.diagnostic("migration.code.unresolved", `${shot.subject}: characters[] token ${JSON.stringify(token)} names no entity; the token is preserved verbatim`, { where: pointer, target: shot.subject });
            }
          });
        }

        const codesPointer = shot.from + ptr("codes");
        const codes = context.read(codesPointer);
        if (Array.isArray(codes)) {
          if (codes.length === 0) context.claim(codesPointer, DISPOSITION.MAPPED, [`${shot.subject}#/subjects`], "explicitly empty collection");
          codes.forEach((token, index) => {
            const pointer = codesPointer + ptr(index);
            if (!nonEmptyString(token)) { context.dropped(pointer, "empty code token"); return; }
            const exact = context.entityByAnyId(token);
            if (exact) {
              if (exact.type === "location") {
                context.setSetting(shot, { locationId: token }, pointer, "an exact location match with no suffix to interpret");
              } else addSubject(token, pointer, `an exact ${exact.type} match with no suffix to interpret`);
              return;
            }
            /* No exact match. Longest-prefix matching is what the current build
               does, and it is what silently discards the suffix - so it is
               explicitly NOT used as truth here. */
            const split = context.splitSuffix(token);
            if (!split) {
              context.recordUnmappedCode(shot, token, pointer);
              return;
            }
            const { base, suffix, entity } = split;
            if (entity.type === "location") {
              const coverage = context.coverageByLabel(base, suffix);
              const canonical = coverage ? { locationId: base, coverageId: coverage.record.id } : { locationId: base };
              context.setSetting(shot, canonical, pointer, coverage
                ? `${JSON.stringify(token)} read as location ${base} plus coverage ${coverage.record.id}, which exists on that location`
                : `${JSON.stringify(token)} read as location ${base}; the suffix ${JSON.stringify(suffix)} matches no coverage record, so only the location is asserted`);
              context.statement({
                target: { subject: shot.subject, path: "/setting" },
                kind: "disputed",
                candidates: [
                  { value: { ...canonical, ...(coverage ? {} : { coverageId: suffix }) }, note: `${JSON.stringify(suffix)} read as a coverage view of ${base}` },
                  { value: { locationId: token }, note: `${JSON.stringify(suffix)} read as part of a distinct location id` },
                ],
                note: `Legacy codes[] token ${JSON.stringify(token)}. The suffix meaning is not recoverable from the document: it may be a coverage view, a variant location or a reference sheet. Confirm before generation. The raw token is retained.`,
                from: pointer,
              });
            } else {
              addSubject(base, pointer, `${JSON.stringify(token)} read as ${entity.type} ${base} with an uninterpretable suffix`);
              context.statement({
                target: { subject: shot.subject, path: "/subjects" },
                kind: "disputed",
                candidates: [
                  { value: { entityId: base }, note: `${JSON.stringify(suffix)} read as a reference-sheet or view suffix on ${base}` },
                  { value: { entityId: token }, note: `${JSON.stringify(suffix)} read as part of a distinct entity id` },
                ],
                note: `Legacy codes[] token ${JSON.stringify(token)}. The current build resolves this by prefix and discards the suffix silently; the suffix meaning is not recoverable. The raw token is retained.`,
                from: pointer,
              });
            }
            context.recordRawCode(shot, token, pointer, `${base} + ${suffix}`);
          });
        }

        const brief = context.read(shot.from + ptr("creationBrief"));
        if (isObject(brief)) {
          const locationPointer = shot.from + ptr("creationBrief") + ptr("locationId");
          if (context.exists(locationPointer) && nonEmptyString(context.read(locationPointer)))
            context.setSetting(shot, { locationId: context.read(locationPointer) }, locationPointer, "an authored location reference from the creation brief");
          else if (context.exists(locationPointer)) context.dropped(locationPointer, "empty location reference");
          const propsPointer = shot.from + ptr("creationBrief") + ptr("propIds");
          const propIds = context.read(propsPointer);
          if (Array.isArray(propIds)) {
            if (propIds.length === 0) context.claim(propsPointer, DISPOSITION.MAPPED, [`${shot.subject}#/subjects`], "explicitly empty collection");
            propIds.forEach((token, index) => {
              const pointer = propsPointer + ptr(index);
              if (!nonEmptyString(token)) { context.dropped(pointer, "empty prop reference"); return; }
              addSubject(token, pointer, "an authored prop reference from the creation brief");
            });
          }
        }

        if (subjects.length || (Array.isArray(characters) && characters.length === 0) || (Array.isArray(codes) && codes.length === 0))
          shot.record.subjects = subjects;
      }
    },
  },

  /* =====================================================================
     M021 - authored structure that later generations dropped. P0 §10.3: this
     rule emits ZERO statements. A `suggested` would be a lie (nobody suggested
     it) and a `cited` would be a lie (there is no source document). The absence
     of a statement IS the correct representation of authored production data. */
  {
    id: "M021",
    name: "authored shot relations",
    summary: "Recovers atomic, parentShot and fallbackFor into relations[]. Deterministic authored data, so it emits no statements at all - the fact that a migration ran belongs in the report, not in per-field evidence.",
    origin: "audit Part 27",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.DETERMINISTIC,
    apply(context) {
      for (const shot of context.shots()) {
        for (const [field, kind] of [["parentShot", "part-of"], ["fallbackFor", "fallback-for"]]) {
          const pointer = shot.from + ptr(field);
          if (!context.exists(pointer)) continue;
          const targetShotId = context.read(pointer);
          if (!nonEmptyString(targetShotId)) { context.dropped(pointer, `shot.${field} is empty`); continue; }
          context.addRelation(shot, { kind, targetShotId, note: `Recovered from legacy shot.${field}.` }, pointer, `authored ${field} recovered as a ${kind} relation`);
        }
        const atomicPointer = shot.from + ptr("atomic");
        if (context.exists(atomicPointer))
          context.preserve(atomicPointer, "shot.atomic is a property of the shot rather than a relation to another shot; there is no relation target for it");
      }
    },
  },

  /* =====================================================================
     M022 - a production relationship that exists three times as English and
     zero times as structure. Without statements this rule must choose between
     losing a real dependency and fabricating a director's decision; with them it
     does neither. */
  {
    id: "M022",
    name: "prose shot dependencies",
    summary: "Reads bookend and derivation dependencies out of notes, risks and description prose into relations[], each with a suggested statement naming the sentence it came from. The prose itself is retained.",
    origin: "audit Part 27",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.INFERENTIAL,
    apply(context) {
      for (const shot of context.shots()) {
        const sources = [];
        for (const field of ["notes", "desc"]) {
          const pointer = shot.from + ptr(field);
          if (context.exists(pointer) && nonEmptyString(context.read(pointer))) sources.push({ pointer, text: context.read(pointer), label: `shot.${field}` });
        }
        const risks = context.read(shot.from + ptr("risks"));
        if (Array.isArray(risks)) risks.forEach((risk, index) => {
          if (nonEmptyString(risk)) sources.push({ pointer: shot.from + ptr("risks") + ptr(index), text: risk, label: "shot.risks[]" });
        });

        const proposed = new Map();
        for (const source of sources) {
          const keyword = DEPENDENCY_KEYWORDS.find((entry) => entry.pattern.test(source.text));
          if (!keyword) continue;
          for (const otherId of context.shotIds()) {
            if (otherId === shot.record.id) continue;
            /* A bare token match, bounded by non-identifier characters, so
               "L7-03" in prose is found and "L7-030" is not. */
            const bounded = new RegExp(`(?:^|[^A-Za-z0-9_-])${otherId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^A-Za-z0-9_-])`);
            if (!bounded.test(source.text)) continue;
            const key = `${keyword.kind}:${otherId}`;
            if (proposed.has(key)) continue;
            proposed.set(key, { kind: keyword.kind, targetShotId: otherId, evidence: source });
          }
        }
        const ordered = [...proposed.values()].sort((a, b) => {
          const left = `${a.targetShotId} ${a.kind}`;
          const right = `${b.targetShotId} ${b.kind}`;
          return left < right ? -1 : left > right ? 1 : 0;
        });
        if (!ordered.length) continue;
        const evidence = [];
        for (const entry of ordered) {
          /* The sentence this relation was read out of IS the source path, and
             this rule has always had it - the accounting claim on the next line
             names it. It is passed here so the mint names it too; `claimSource`
             is off because the claim below is `stated`, not `mapped`. A reading
             is a guess, and the disposition has to keep saying so. */
          context.addRelation(shot, {
            kind: entry.kind,
            targetShotId: entry.targetShotId,
            note: `Read from ${entry.evidence.label}: ${JSON.stringify(entry.evidence.text)}`,
          }, entry.evidence.pointer, null, { claimSource: false });
          context.claim(entry.evidence.pointer, DISPOSITION.STATED, [`${shot.subject}#/relations`], "a production relationship read out of prose; the prose itself is retained");
          evidence.push(`${entry.kind} -> ${entry.targetShotId}, from ${entry.evidence.label}: ${JSON.stringify(entry.evidence.text)}`);
        }
        /* ONE statement for the whole array, not one per relation. The claim
           binds `/relations`, so several statements on it would all carry the
           same hash and stale together - which is noise, not information. */
        context.statement({
          target: { subject: shot.subject, path: "/relations" },
          kind: "suggested",
          note: `${ordered.length} production relationship${ordered.length === 1 ? "" : "s"} read out of prose rather than structure. ${evidence.join(" | ")}. The prose is retained; confirm before scheduling on any of them.`,
          from: ordered[0].evidence.pointer,
        });
      }
    },
  },

  /* =====================================================================
     M040 - P0 §10.6's amendment, and the amendment is the whole point.

     The audit said "keep the prose". If the marker stays inside the value, the
     claim hash binds prose-plus-marker, so deleting just the marker - the
     intended cleanup - stales the statement and wrongly clears a suggestion that
     still applies to the surviving text. So the marker is STRIPPED from the
     canonical field and moves into the statement's note. Nothing is lost, and
     the same fact is not asserted twice in two representations. */
  {
    id: "M040",
    name: "inferred-for-planning markers",
    summary: "Strips [INFERRED FOR PLANNING] out of the canonical value and moves the inference evidence into a suggested statement, so the claim binds the cleaned prose and editing it stales the suggestion for the right reason.",
    origin: "audit Part 27, amended by P0 §10.6",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.INFERENTIAL,
    apply(context) {
      for (const written of context.writtenFields()) {
        if (typeof written.value !== "string" || !written.value.includes(INFERRED_MARKER)) continue;
        const cleaned = written.value
          .split(INFERRED_MARKER).join("")
          .replace(/[ \t]{2,}/g, " ")
          .replace(/\s+([.,;:!?])/g, "$1")
          .trim();
        context.rewrite(written, cleaned);
        context.statement({
          target: { subject: written.subject, path: written.path },
          kind: "suggested",
          note: `Legacy prose carried the ${INFERRED_MARKER} marker: ${JSON.stringify(written.value)}. The marker is removed from the production value and the evidence is here, so editing the prose stales this suggestion rather than the marker's removal doing it.`,
          from: written.from,
        });
        if (written.from) context.claim(written.from, DISPOSITION.STATED, [`${written.subject}#${written.path}`], "the inference marker moved into the statement; the cleaned text stayed in the field");
      }
    },
  },

  /* =====================================================================
     M041 / M042 - analysis output and prose intent on production objects. */
  {
    id: "M041",
    name: "scene continuity review output",
    summary: "Drops scene.continuityReview. It is model analysis output stored on a production object, it is derived, and it is regenerable - the finding is always computed and never stored.",
    origin: "audit Part 27",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.DETERMINISTIC,
    apply(context) {
      const scenes = context.read("/scenes");
      if (!Array.isArray(scenes)) return;
      scenes.forEach((scene, index) => {
        const pointer = ptr("scenes", index, "continuityReview");
        if (context.exists(pointer))
          context.claimSubtree(pointer, DISPOSITION.DROPPED, [], "continuity findings are always derived from intent plus observation and are never stored; this block is analysis output on a production object");
      });
    },
  },
  {
    id: "M042",
    name: "continuity intent prose",
    summary: "Preserves continuityReviewSettings.expectedChanges verbatim and flags it for review. Splitting a newline-delimited paragraph into structured expectations would be a guess about production intent, and there is no core field to guess into at this contract revision.",
    origin: "audit Part 27",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.DETERMINISTIC,
    apply(context) {
      const scenes = context.read("/scenes");
      if (Array.isArray(scenes)) scenes.forEach((scene, index) => {
        const pointer = ptr("scenes", index, "continuityReviewSettings");
        if (!context.exists(pointer)) return;
        context.preserve(pointer, "declared continuity intent stored as newline-delimited prose; the continuity profile's interior is not modelled at this contract revision");
        context.diagnostic("migration.review.required", `/scenes/${index}: continuity intent is stored as prose and needs a human to structure it`, { where: pointer });
      });
      for (const shot of context.shots()) {
        for (const key of ["continuityIntent", "continuitySelections", "continuityStateSelections"]) {
          const pointer = shot.from + ptr(key);
          if (context.exists(pointer)) context.preserve(pointer, `shot.${key} belongs to the continuity profile, whose interior this contract revision does not model`);
        }
      }
    },
  },

  /* =====================================================================
     M030 / M031 - media identity.

     A NOTE THAT MATTERS, and it is recorded rather than worked around: the
     1.0-draft.1 asset record is { id, kind, mediaType, digest } and declares no
     `storage.path`. So migration can mint stable asset IDENTITY and the
     reference edges that give it meaning, but it cannot express WHERE the file
     is in OFP core at this revision. The legacy filename is therefore preserved
     in the CineBraid extension rather than invented into a field the contract
     does not have. Adding one would be widening a merged contract on P2's own
     authority; P4 is where MediaAsset activation lands. */
  {
    id: "M030",
    name: "approved files to assets and references",
    summary: "Mints deterministic asset identity for every approved legacy filename and a references[] edge from the record that approved it, with the filename preserved in the CineBraid extension because the draft asset record declares no storage path.",
    origin: "audit Part 27",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.DETERMINISTIC,
    apply(context) {
      context.flushApprovals();
    },
  },
  {
    id: "M031",
    name: "media asset library",
    summary: "Collapses the second, partially-live P.mediaAssets[] model into the same assets[] and references[] as M030, so one project does not carry two media models.",
    origin: "audit Part 27",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.DETERMINISTIC,
    apply(context) {
      const list = context.read("/mediaAssets");
      if (!Array.isArray(list)) return;
      if (list.length === 0) { context.claim("/mediaAssets", DISPOSITION.DROPPED, [], "explicitly empty legacy media library"); return; }
      list.forEach((entry, index) => {
        const from = ptr("mediaAssets", index);
        if (!isObject(entry)) { context.preserve(from, "media asset entry is not an object"); return; }
        context.claimSubtree(from, DISPOSITION.PRESERVED, ["#/extensions/com.cinebraid.legacy/preserved"], "the legacy media library is ingest bookkeeping; its identity is carried by assets[] and its edges by references[]");
        context.preserveValue(from, "legacy P.mediaAssets[] entry, collapsed into assets[]/references[]", { alreadyClaimed: true });
      });
    },
  },

  /* =====================================================================
     M050 / M051 / M052 - out of core. */
  {
    id: "M050",
    name: "provider and workflow preferences",
    summary: "Moves per-shot model preferences, prompt defaults and workflow settings into extensions[\"com.cinebraid.workflow\"]. Runtime preference has been sitting in production data since v1; it is kept, not lost, and it is out of core.",
    origin: "audit Part 27",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.DETERMINISTIC,
    apply(context) {
      for (const key of ["promptDefaults", "defaults", "models", "statusVocab", "aiPolicy", "workflowEmphasis", "promptProfilesVersion", "promptHistoryVersion", "refSyntax"]) {
        const pointer = ptr("meta", key);
        if (context.exists(pointer)) context.workflowSubtree(["project", key], pointer, `meta.${key} is a CineBraid workflow or provider setting, not film semantics`);
      }
      for (const shot of context.shots())
        for (const key of ["stillModel", "videoModel"]) {
          const pointer = shot.from + ptr(key);
          if (context.exists(pointer)) context.workflowPut(["shots", shot.subject, key], context.read(pointer), pointer, "a per-shot provider preference embedded in production data since v1");
        }
    },
  },
  {
    id: "M051",
    name: "compiled generation payloads",
    summary: "Drops compiled provider payloads by name. The FACT of a generation belongs in provenance; the payload is a provider request that would dwarf the film and cannot be replayed against a different model anyway.",
    origin: "audit Part 27",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.DETERMINISTIC,
    apply(context) {
      const drop = (pointer, what) => {
        if (!context.exists(pointer)) return;
        const count = context.claimSubtree(pointer, DISPOSITION.DROPPED, [], `${what} is a compiled provider payload; the audit drops these by design and keeps the fact of generation in provenance`);
        context.countDropped(pointer, count);
      };
      for (const key of ["promptBuildsById", "promptSnapshotsById"]) drop(ptr(key), `project ${key}`);
      for (const shot of context.shots()) {
        for (const key of ["promptBuilds", "generationPackages", "imagePromptPackages", "promptOptions", "packagePlanner"]) drop(shot.from + ptr(key), `shot.${key}`);
        for (const key of ["blockingBuilds"]) drop(shot.from + ptr("creationBrief") + ptr(key), `creationBrief.${key}`);
        const keyframes = context.read(shot.from + ptr("keyframes"));
        if (Array.isArray(keyframes)) keyframes.forEach((_, index) => drop(shot.from + ptr("keyframes") + ptr(index) + ptr("generationPackages"), "keyframe.generationPackages"));
        const briefFrames = context.read(shot.from + ptr("creationBrief") + ptr("frames"));
        if (Array.isArray(briefFrames)) briefFrames.forEach((_, index) => drop(shot.from + ptr("creationBrief") + ptr("frames") + ptr(index) + ptr("promptBuilds"), "creationBrief frame promptBuilds"));
      }
      for (const entity of context.entities()) drop(entity.from + ptr("assetPromptBuilds"), "entity.assetPromptBuilds");
      for (const state of context.states()) drop(state.from + ptr("assetPromptBuilds"), "state.assetPromptBuilds");
    },
  },
  {
    id: "M052",
    name: "runtime and dead collections",
    summary: "Drops jobs, finishJobs, agentRuns, decisions and sessions by name. Job transport state never enters a portable document, and P.decisions[] is read in three places and written by nothing.",
    origin: "audit Part 27",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.DETERMINISTIC,
    apply(context) {
      for (const key of ["jobs", "finishJobs", "agentRuns", "decisions", "sessions"]) {
        const pointer = ptr(key);
        if (!context.exists(pointer)) continue;
        const value = context.read(pointer);
        const populated = Array.isArray(value) && value.length > 0;
        const count = context.claimSubtree(pointer, DISPOSITION.DROPPED, [], `${key} is runtime or dead project state; it is not portable film semantics`);
        context.countDropped(pointer, count);
        if (populated && key === "decisions")
          context.diagnostic("migration.review.required", `/decisions carried ${value.length} entr${value.length === 1 ? "y" : "ies"}; the collection is read in three places and written by nothing, so it is dropped by name rather than mapped`, { where: pointer });
      }
    },
  },

  /* =====================================================================
     M070 - the sweep, and it runs LAST on purpose.

     Every rule above claims what it knows about. This claims what is left, into
     one explicit home, with the source pointer, the value and the reason
     recorded beside it. It is the difference between "unknown legacy data is
     preserved" and "unknown legacy data happens to still be there".

     It is not a licence for the rules above to be sloppy: the conformance suite
     pins the exact disposition of every leaf in the clean fixture, so a mapping
     rule that quietly stops mapping shows up as a changed table rather than as a
     larger preserved[] nobody reads. */
  {
    id: "M070",
    name: "unknown legacy content",
    summary: "Gives every legacy value no other rule claimed an explicit home in extensions[\"com.cinebraid.legacy\"].preserved[], recording its source path, its value and why it has no OFP representation.",
    origin: "P2",
    appliesTo: ALL_GENERATIONS,
    determinism: DETERMINISM.DETERMINISTIC,
    apply(context) {
      for (const pointer of context.unaccounted())
        context.preserve(pointer, `no rule in this registry maps this value into ${context.formatId} ${context.contractVersion}; preserved verbatim so nothing is lost while the contract is incomplete`);
    },
  },
];

const RULE_INDEX = new Map(RULES.map((rule) => [rule.id, rule]));

function ruleById(id) {
  return RULE_INDEX.get(id) || null;
}

module.exports = {
  MIGRATION_RULES: RULES,
  RULE_IDS: RULES.map((rule) => rule.id),
  DETERMINISM,
  ENTITY_KINDS,
  ENTITY_PROSE_FIELDS,
  STATE_DELTA_FIELDS,
  DURATION_FIELDS,
  DEPENDENCY_KEYWORDS,
  INFERRED_MARKER,
  SECRET_WORDS,
  SECRET_WORD_PAIRS,
  keyWords,
  ABSOLUTE_PATH_PATTERN,
  ENDPOINT_PATTERN,
  CREDENTIAL_URL_PATTERN,
  keyLooksSecret,
  valueLooksSensitive,
  mediaKindOf,
  ruleById,
};

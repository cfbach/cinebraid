"use strict";

/* The migration engine.

       legacy project -> detect -> plan -> execute IN MEMORY -> validate -> report

   The source document is never mutated and never written. This module touches no
   filesystem at all: `previewLegacyMigration` is the primary P2 API and it is
   pure, which is the strongest possible form of "migration preview writes
   nothing". Writing a copy is a separate module with a separate, explicit
   destination.

   The engine's job is to give rules a small set of primitives and to hold the
   three invariants no individual rule can hold on its own:

     ACCOUNTING   every meaningful source value has exactly one disposition,
                  chosen by a named rule (`ofp-migrate-accounting.js`).
     BINDING      a migration-created statement's claim hash is computed HERE,
                  after the target value exists and resolves. A rule cannot
                  supply one - the draft has no field for it - and a rule cannot
                  write `approved`, because approval is a human act.
     CONSERVATION counts and identities are measured before and after, and any
                  change has to be explained by a rule that said it would.

   NOTHING HERE CALLS A MODEL. Ambiguity is represented as ambiguity. */

const { sha256Hex, canonicalJson } = require("../public/shared-continuity");
const { OFP_FORMAT_ID, OFP_CONTRACT_VERSION } = require("./ofp-format");
const { DISPOSITION, SourceLedger, readPointer } = require("./ofp-migrate-accounting");
const { detectLegacyProject, SOURCE_FAMILY } = require("./ofp-migrate-detect");
const { MIGRATION_RULES, DETERMINISM, mediaKindOf } = require("./ofp-migrate-rules");
const { makeMigrationDiagnostic } = require("./ofp-migrate-diagnostics");
const { mintNestedIdentifiers } = require("./ofp-identifiers");
const { checkIdentifierFloor, isIdentifierPortable } = require("./ofp-identifiers");
const { computeClaimHash, buildClaimPreview } = require("./ofp-claim");
const { resolveTarget, formatTargetString } = require("./ofp-target");
const { validateOfpDocument } = require("./ofp-validate");
const { scanMigrationOutput } = require("./ofp-migrate-scan");
const { serializeCanonical } = require("./ofp-serialize");

const APPLICATION_VERSION = require("../package.json").version;

/* The BLANK() five, verbatim. Kept here rather than imported from server.js
   because requiring server.js starts an HTTP application. A test asserts the two
   copies still agree, so drift is caught rather than assumed away. */
const TEMPLATE_QC_CHECKLIST = [
  "Identity & side continuity — checked against anchor sheet, mirror-check done, drift-prone features verified",
  "Geometry & contact points — hands touch what they touch, correct orientation",
  "Tone drift — not too clean, not too pretty; era and world correct",
  "Motif & continuity compliance — recurring details per canon",
  "Text accuracy — all legible strings; rechecked after upscale/edit",
];

/* Migration may write evidence it derived and evidence it read. It may not write
   a decision. `approved` is a human act and `observed` is a model looking at a
   frame - migration is neither. */
const MIGRATION_STATEMENT_KINDS = ["suggested", "disputed", "cited"];

const LEGACY_EXTENSION = "com.cinebraid.legacy";
const WORKFLOW_EXTENSION = "com.cinebraid.workflow";

const DEFAULT_MIGRATION_INSTANT = "1970-01-01T00:00:00Z";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function encodeToken(token) {
  return String(token).replace(/~/g, "~0").replace(/\//g, "~1");
}

function deepCopy(value) {
  if (Array.isArray(value)) return value.map(deepCopy);
  if (isObject(value)) {
    const copy = {};
    for (const key of Object.keys(value)) copy[key] = deepCopy(value[key]);
    return copy;
  }
  return value;
}

function setPointer(record, pointer, value) {
  const tokens = pointer.slice(1).split("/").map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"));
  let current = record;
  for (let index = 0; index < tokens.length - 1; index++) {
    const token = tokens[index];
    if (!isObject(current[token])) current[token] = {};
    current = current[token];
  }
  current[tokens[tokens.length - 1]] = value;
}

function digest(kind, ...parts) {
  return sha256Hex(canonicalJson({ ofp: kind, parts }));
}

/* --------------------------------------------------------------------------
   The execution context handed to every rule. */

class MigrationContext {
  constructor(source, detection, options) {
    this.source = source;
    this.detection = detection;
    this.candidate = {};
    this.ledger = new SourceLedger(source);
    this.at = options.at;
    this.formatId = OFP_FORMAT_ID;
    this.contractVersion = OFP_CONTRACT_VERSION;
    this.generatorVersion = options.generatorVersion;
    this.templateQcChecklist = TEMPLATE_QC_CHECKLIST;

    this.rule = null;
    this.diagnostics = [];
    this.statementDrafts = [];
    this.written = [];
    this.mints = [];
    this.mintByPointer = new Map();
    this.quarantined = new Set();
    this.countAdjustments = [];
    this.identityAdjustments = [];
    this.droppedCounts = [];
    this.ruleActivity = new Map(MIGRATION_RULES.map((rule) => [rule.id, { claims: 0, targets: new Set(), statements: 0, diagnostics: 0 }]));

    this.entityIndex = new Map();       /* id -> { type, record, from, legacy, subject } */
    this.entityList = [];
    this.stateList = [];
    this.coverageList = [];
    this.shotIndex = new Map();
    this.shotList = [];
    this.frameIndex = new Map();        /* shot subject -> [frame] */
    this.voiceIds = new Set();
    this.pendingApprovals = [];
    this.legacyPreserved = [];
    this.legacyCodes = [];
    this.legacyUnmappedCodes = [];
    this.legacyAssetFiles = {};
    this.workflow = {};
  }

  /* ---- source reading ---- */
  exists(pointer) {
    return readPointer(this.source, pointer) !== undefined;
  }

  read(pointer) {
    return readPointer(this.source, pointer);
  }

  /* ---- accounting ---- */
  claim(pointer, disposition, targets = [], note = "") {
    const entry = this.ledger.claim(pointer, { rule: this.rule, disposition, targets, note });
    const activity = this.ruleActivity.get(this.rule);
    if (activity) { activity.claims++; for (const target of targets) activity.targets.add(target); }
    return entry;
  }

  claimSubtree(pointer, disposition, targets = [], note = "") {
    const count = this.ledger.claimSubtree(pointer, { rule: this.rule, disposition, targets, note });
    const activity = this.ruleActivity.get(this.rule);
    if (activity) { activity.claims += count; for (const target of targets) activity.targets.add(target); }
    return count;
  }

  /* Claim whatever `pointer` names: one leaf, or every leaf under a container.
     The ledger refuses a container claim outright, so this is the only way a
     rule disposes of a block - and it disposes of it one value at a time, which
     is what lets the report say what was inside. */
  claimAny(pointer, disposition, targets = [], note = "") {
    if (this.ledger.leafSet.has(pointer)) return this.claim(pointer, disposition, targets, note);
    return this.claimSubtree(pointer, disposition, targets, note);
  }

  dropped(pointer, note) {
    return this.claimAny(pointer, DISPOSITION.DROPPED, [], note);
  }

  unaccounted() {
    return this.ledger.unaccounted();
  }

  countDropped(pointer, count) {
    this.droppedCounts.push({ rule: this.rule, pointer, values: count });
  }

  /* ---- quarantine (M080) ---- */
  quarantine(pointer, reason) {
    this.quarantined.add(pointer);
    this.claim(pointer, DISPOSITION.DROPPED, [], reason);
  }

  isQuarantined(pointer) {
    if (this.quarantined.has(pointer)) return true;
    for (const entry of this.quarantined) if (entry.startsWith(`${pointer}/`)) return true;
    return false;
  }

  /* A copy of the source value at `pointer` with every quarantined descendant
     removed. This is the mechanism that stops the preservation rules - which are
     designed to carry ANY unrecognised value - from carrying a stored API key
     into the extension along with everything else. */
  copyWithoutQuarantined(pointer) {
    const walk = (value, here) => {
      if (this.quarantined.has(here)) return undefined;
      if (Array.isArray(value)) return value.map((entry, index) => walk(entry, `${here}/${index}`)).filter((entry) => entry !== undefined);
      if (isObject(value)) {
        const copy = {};
        for (const key of Object.keys(value)) {
          const child = walk(value[key], `${here}/${encodeToken(key)}`);
          if (child !== undefined) copy[key] = child;
        }
        return copy;
      }
      return value;
    };
    return walk(readPointer(this.source, pointer), pointer);
  }

  /* ---- writing into the candidate ---- */
  set(record, path, value, from, subject) {
    if (from && this.isQuarantined(from)) return null;
    setPointer(record, path, value);
    const written = { subject, path, value, from, rule: this.rule, record };
    this.written.push(written);
    if (from) this.claim(from, DISPOSITION.MAPPED, [`${subject}#${path}`], "mapped deterministically into an OFP core field");
    return written;
  }

  write(subject, path, value, { from, note } = {}) {
    if (from && this.isQuarantined(from)) return null;
    setPointer(this.candidate, path, value);
    const written = { subject, path, value, from, rule: this.rule, record: this.candidate };
    this.written.push(written);
    if (from) this.claim(from, DISPOSITION.MAPPED, [`${subject}#${path}`], note || "mapped deterministically into an OFP core field");
    return written;
  }

  /* Used only by M040, which must change a value AFTER it was written so that
     the claim binds the cleaned prose rather than prose-plus-marker. */
  rewrite(written, value) {
    setPointer(written.record, written.path, value);
    written.original = written.value;
    written.value = value;
  }

  writtenFields() {
    return [...this.written];
  }

  /* ---- preservation ---- */
  preserve(pointer, note) {
    if (this.isQuarantined(pointer)) return;
    this.claimAny(pointer, DISPOSITION.PRESERVED, [`#/extensions/${LEGACY_EXTENSION}/preserved`], note);
    this.preserveValue(pointer, note, { alreadyClaimed: true });
  }

  preserveValue(pointer, note, { alreadyClaimed = false } = {}) {
    if (this.isQuarantined(pointer)) return;
    if (!alreadyClaimed) this.claimAny(pointer, DISPOSITION.PRESERVED, [`#/extensions/${LEGACY_EXTENSION}/preserved`], note);
    const value = this.copyWithoutQuarantined(pointer);
    if (value === undefined) return;
    /* `sourcePath`, not `path`. The output scanner treats a key named `path` as
       a filesystem path by contract and would reject a JSON pointer as an
       absolute one - correctly, on its own terms. Naming the field for what it
       is fixes the collision without weakening the scanner. */
    this.legacyPreserved.push({ sourcePath: pointer, rule: this.rule, note, value });
  }

  workflowPut(keyPath, value, pointer, note) {
    if (pointer && this.isQuarantined(pointer)) return;
    setPointer(this.workflow, keyPath.map((token) => `/${encodeToken(token)}`).join(""), value);
    if (pointer) this.claimAny(pointer, DISPOSITION.PRESERVED, [`#/extensions/${WORKFLOW_EXTENSION}/${keyPath.join("/")}`], note);
  }

  workflowSubtree(keyPath, pointer, note) {
    if (this.isQuarantined(pointer)) return;
    const value = this.copyWithoutQuarantined(pointer);
    if (value === undefined) return;
    setPointer(this.workflow, keyPath.map((token) => `/${encodeToken(token)}`).join(""), value);
    this.claimSubtree(pointer, DISPOSITION.PRESERVED, [`#/extensions/${WORKFLOW_EXTENSION}/${keyPath.join("/")}`], note);
  }

  /* ---- diagnostics ---- */
  diagnostic(code, message, extra = {}) {
    this.diagnostics.push(makeMigrationDiagnostic(code, message, { ...extra, rule: this.rule }));
    const activity = this.ruleActivity.get(this.rule);
    if (activity) activity.diagnostics++;
  }

  /* ---- statements ----

     The draft has NO hash field. That is structural rather than a convention:
     there is nowhere for a rule, a tool or a model to put one, so the hash can
     only ever be computed here, against the value as it finally stands. */
  statement(draft) {
    if (!MIGRATION_STATEMENT_KINDS.includes(draft.kind)) {
      this.diagnostic("migration.statement.kind-refused",
        `rule ${this.rule} tried to write a ${JSON.stringify(draft.kind)} statement; migration may write only ${MIGRATION_STATEMENT_KINDS.join(", ")} - approval is a human act and observation is a model looking at a frame`,
        { where: draft.from || "", target: formatTargetString(draft.target) });
      return null;
    }
    if (draft.kind === "disputed" && !(Array.isArray(draft.candidates) && draft.candidates.length)) {
      this.diagnostic("migration.statement.kind-refused",
        `rule ${this.rule} tried to write a disputed statement with no candidates; a conflict is about competing values, at least one of which is not in the document`,
        { where: draft.from || "", target: formatTargetString(draft.target) });
      return null;
    }
    const entry = { rule: this.rule, ...draft, actor: draft.actor || { kind: "tool", name: `migration/${this.rule}` } };
    /* The source value that caused a guess is recorded as `stated` as well as
       whatever else happened to it. Both are true - a suffixed code is mapped to
       its base AND becomes a dispute - and a report that showed three disputes
       beside zero stated values would be describing two different migrations.
       Idempotent, because several rules claim `stated` themselves. */
    if (draft.from && this.ledger.leafSet.has(draft.from)) {
      const existing = this.ledger.claims.get(draft.from) || [];
      if (!existing.some((claim) => claim.disposition === DISPOSITION.STATED))
        this.claim(draft.from, DISPOSITION.STATED, [formatTargetString(draft.target)], `became a ${draft.kind} statement, because migration guessed here rather than knowing`);
    }
    this.statementDrafts.push(entry);
    const activity = this.ruleActivity.get(this.rule);
    if (activity) activity.statements++;
    return entry;
  }

  /* ---- identity ----

     The ONE writer for the mints report, so "where this came from was never
     known" is expressed in exactly one place, and expressed by the field being
     ABSENT. A `sourcePath` that is present and null reads as a recorded
     provenance fact whose value happens to be nothing - which is the one thing
     it must never mean, because it makes a mint whose origin nobody knows
     indistinguishable from a mint whose origin was recorded as empty. Absence
     is the honest shape and the one every consumer already tests for.

     Note this is a JSON pointer into the SOURCE document, not a filesystem
     path and not where the migrated asset now lives. Nothing here may be filled
     in from the destination to avoid an empty field: that would turn missing
     provenance into false provenance, which is strictly worse than missing. */
  recordMint({ sourcePath, type, parentSubject, mintedId }) {
    const mint = { rule: this.rule };
    /* Built in the original key order so a report diff shows the one missing
       field rather than a reshuffle. */
    if (nonEmptyString(sourcePath)) mint.sourcePath = sourcePath;
    mint.type = type;
    mint.parentSubject = parentSubject;
    mint.mintedId = mintedId;
    this.mints.push(mint);
    return mint;
  }

  mintCollection(listPointer, list, { type, parentSubject }) {
    if (!Array.isArray(list)) return;
    for (const { index, mintedId } of mintNestedIdentifiers(list, { type, parentSubject })) {
      const pointer = `${listPointer}/${index}`;
      this.mintByPointer.set(pointer, mintedId);
      this.recordMint({ sourcePath: pointer, type, parentSubject, mintedId });
      this.diagnostic("migration.id.minted", `${pointer}: a ${type} with no identifier was minted ${JSON.stringify(mintedId)} from its type, its parent and its position`, { where: pointer, target: parentSubject ? `${parentSubject}/${type}:${mintedId}` : `${type}:${mintedId}` });
    }
  }

  identityOf(pointer, record) {
    if (record && nonEmptyString(record.id)) return record.id;
    const minted = this.mintByPointer.get(pointer);
    if (minted) return minted;
    /* Reached only when a rule asks for an identity M060 was not asked to mint.
       Deterministic and content-addressed rather than positional, so it cannot
       collide with the positional form. */
    return `ofp-${digest("mint/fallback/1", pointer).slice(0, 12)}`;
  }

  claimIdentity(from, record, subject) {
    const idPointer = `${from}/id`;
    const id = subject.split("/").pop().split(":").slice(1).join(":");
    if (this.exists(idPointer)) {
      const value = this.read(idPointer);
      this.claim(idPointer, DISPOSITION.MAPPED, [subject], nonEmptyString(value)
        ? "legacy identifier preserved verbatim; nothing renames it"
        : `the legacy identifier was empty, so ${JSON.stringify(id)} was minted deterministically`);
    }
    const floor = checkIdentifierFloor(id);
    if (!floor.ok)
      this.diagnostic("migration.id.invalid", `${subject}: ${floor.reason}. The identifier is preserved verbatim rather than renamed - a rename destroys the only link between a record and its history - so the result will report id.invalid.`, { where: idPointer, target: subject });
    else if (!isIdentifierPortable(id))
      this.diagnostic("migration.id.not-portable", `${subject}: ${JSON.stringify(id)} is legal but outside id-portable (^[A-Za-z0-9._-]+$); it is preserved verbatim and nothing renames it`, { where: idPointer, target: subject });
  }

  /* ---- registration, so later rules can find what earlier rules built ---- */
  entityCollection(name, records, emptySourcePointer) {
    if (!isObject(this.candidate.entities)) this.candidate.entities = {};
    if (records.length === 0 && emptySourcePointer === null) return;
    this.candidate.entities[name] = records;
  }

  registerEntity(type, id, record, from, legacy) {
    const entry = { type, id, record, from, legacy, subject: `${type}:${id}` };
    this.entityIndex.set(id, entry);
    this.entityList.push(entry);
  }

  registerState(entity, record, from, legacy, subject) {
    this.stateList.push({ entity, record, from, legacy, subject });
  }

  registerCoverage(entity, record, from, legacy, subject) {
    this.coverageList.push({ entity, record, from, legacy, subject });
  }

  registerShot(id, record, from, legacy, subject) {
    const entry = { id, record, from, legacy, subject };
    this.shotIndex.set(id, entry);
    this.shotList.push(entry);
  }

  registerFrame(shot, record, from, legacy, subject) {
    const list = this.frameIndex.get(shot.subject) || [];
    list.push({ shot, record, from, legacy, subject });
    this.frameIndex.set(shot.subject, list);
  }

  registerVoice(id) {
    this.voiceIds.add(id);
  }

  entities() { return this.entityList; }
  states() { return this.stateList; }
  coverageSlots() { return this.coverageList; }
  shots() { return this.shotList; }
  shotIds() { return [...this.shotIndex.keys()]; }
  framesOf(shot) { return this.frameIndex.get(shot.subject) || []; }
  frameById(shot, id) { return this.framesOf(shot).find((frame) => frame.record.id === id) || null; }
  entityExists(id) { return this.entityIndex.has(id); }
  entityByAnyId(id) { return this.entityIndex.get(id) || null; }
  hasVoice(id) { return this.voiceIds.has(id); }

  /* Split a suffixed token into the longest entity ID that is a proper prefix
     plus its remainder. Used to DESCRIBE the ambiguity, never to resolve it:
     longest-prefix matching is exactly what the current build does when it
     silently discards the suffix, so its result becomes one candidate of a
     dispute rather than the answer. */
  splitSuffix(token) {
    let best = null;
    for (const [id, entity] of this.entityIndex) {
      if (!(token.startsWith(`${id}-`) || token.startsWith(`${id}_`))) continue;
      if (best === null || id.length > best.base.length) best = { base: id, suffix: token.slice(id.length + 1), entity };
    }
    return best;
  }

  coverageByLabel(locationId, suffix) {
    const wanted = String(suffix).toLowerCase();
    return this.coverageList.find((slot) => slot.entity.id === locationId
      && (String(slot.record.id).toLowerCase() === wanted || String(slot.record.name || "").toLowerCase() === wanted)) || null;
  }

  setSetting(shot, patch, pointer, note) {
    const setting = shot.record.setting || (shot.record.setting = {});
    const targets = Object.keys(patch).map((key) => `${shot.subject}#/setting/${key}`);
    if (patch.locationId && setting.locationId && setting.locationId !== patch.locationId) {
      this.claimAny(pointer, DISPOSITION.PRESERVED, targets, `a second location reference; ${setting.locationId} was already asserted and is kept`);
      this.preserveValue(pointer, `a second location reference for ${shot.subject}; ${setting.locationId} was already asserted`, { alreadyClaimed: true });
      this.diagnostic("migration.review.required", `${shot.subject}: two legacy tokens name different locations (${setting.locationId} and ${patch.locationId}); the first is asserted and the second is preserved`, { where: pointer, target: shot.subject });
      return;
    }
    Object.assign(setting, patch);
    this.claim(pointer, DISPOSITION.MAPPED, targets, note);
  }

  /* `claimSource: false` lets a rule NAME the pointer a relation was read from
     without this method also claiming that pointer `mapped`. M022 needs exactly
     that: it reads a relationship out of English prose and claims the same
     pointer `stated` itself, because a reading is a guess and not a mapping.
     Before the option existed its only way to get the disposition right was to
     pass no pointer at all - so it bought the correct accounting with a mint
     that could not say where it came from, even though it knew. */
  addRelation(shot, relation, pointer, note, { claimSource = true } = {}) {
    const relations = shot.record.relations || (shot.record.relations = []);
    const id = `rel-${digest("relation/1", shot.record.id, relation.kind, relation.targetShotId).slice(0, 12)}`;
    if (relations.some((entry) => entry.id === id)) return;
    relations.push({ id, kind: relation.kind, targetShotId: relation.targetShotId, note: relation.note });
    this.recordMint({ sourcePath: pointer, type: "relation", parentSubject: shot.subject, mintedId: id });
    if (pointer && claimSource) this.claim(pointer, DISPOSITION.MAPPED, [`${shot.subject}#/relations`], note);
  }

  recordUnmappedCode(shot, token, pointer) {
    this.claim(pointer, DISPOSITION.PRESERVED, [`#/extensions/${LEGACY_EXTENSION}/unmappedCodes`], "the token matches no entity and no entity prefix; it is preserved verbatim rather than dropped");
    /* The field is `code`, not `token`. The output scanner treats a key named
       `token` as a credential - correctly, since that is what the word means in
       every other context a document scanner meets it. Naming the field for what
       it holds avoids the collision without loosening the scanner. */
    this.legacyUnmappedCodes.push({ shotId: shot.record.id, code: token, sourcePath: pointer, rule: this.rule });
    this.diagnostic("migration.code.unresolved", `${shot.subject}: codes[] token ${JSON.stringify(token)} matches no entity and no entity prefix; it resolves to nothing today and vanishes with no diagnostic. It is preserved verbatim.`, { where: pointer, target: shot.subject });
  }

  recordRawCode(shot, token, pointer, reading) {
    this.legacyCodes.push({ shotId: shot.record.id, code: token, sourcePath: pointer, reading, rule: this.rule });
  }

  /* ---- media identity ---- */
  approve(subject, filename, pointer, purpose) {
    if (this.isQuarantined(pointer)) return;
    this.pendingApprovals.push({ subject, filename, pointer, purpose, rule: this.rule });
  }

  flushApprovals() {
    const assets = new Map();
    const references = new Map();
    /* Sorted so that two runs over the same input mint the same records in the
       same order, independent of the order the collecting rules happened to run
       their loops in. */
    const ordered = [...this.pendingApprovals].sort((a, b) => (a.pointer < b.pointer ? -1 : a.pointer > b.pointer ? 1 : 0));
    for (const approval of ordered) {
      const assetId = `asset-${digest("asset/1", approval.filename).slice(0, 16)}`;
      const [kind, mediaType] = mediaKindOf(approval.filename);
      if (!assets.has(assetId)) {
        const asset = { id: assetId, kind };
        if (mediaType) asset.mediaType = mediaType;
        assets.set(assetId, asset);
        this.legacyAssetFiles[assetId] = approval.filename;
        this.recordMint({ sourcePath: approval.pointer, type: "asset", parentSubject: "", mintedId: assetId });
      }
      const referenceId = `ref-${digest("reference/1", approval.subject, approval.purpose, assetId).slice(0, 16)}`;
      if (!references.has(referenceId)) {
        references.set(referenceId, { id: referenceId, purpose: approval.purpose, subject: approval.subject, assetId });
        this.recordMint({ sourcePath: approval.pointer, type: "reference", parentSubject: "", mintedId: referenceId });
      }
      this.claim(approval.pointer, DISPOSITION.MAPPED, [`asset:${assetId}`, `reference:${referenceId}`, `#/extensions/${LEGACY_EXTENSION}/assetFiles/${assetId}`],
        `a bare legacy filename became stable asset identity plus a reference edge; the filename itself is preserved because the ${this.contractVersion} asset record declares no storage path`);
    }
    if (assets.size) this.candidate.assets = [...assets.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
    if (references.size) this.candidate.references = [...references.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  countAdjustment(category, delta, note) {
    this.countAdjustments.push({ category, delta, rule: this.rule, note });
  }

  identityAdjustment(id, note) {
    this.identityAdjustments.push({ id, rule: this.rule, note });
  }
}

/* --------------------------------------------------------------------------
   Counting and identity conservation. */

const COUNT_CATEGORIES = ["scenes", "shots", "characters", "locations", "props", "vehicles", "voices", "states", "coverage", "frames", "motion", "relations", "references", "assets", "statements"];

function countSource(source) {
  const counts = Object.fromEntries(COUNT_CATEGORIES.map((name) => [name, 0]));
  const list = (value) => (Array.isArray(value) ? value.filter(isObject) : []);
  counts.scenes = list(source.scenes).length;
  counts.shots = list(source.shots).length;
  counts.characters = list(source.characters).length;
  counts.locations = list(source.locations).length;
  counts.props = list(source.props).length;
  counts.vehicles = list(source.vehicles).length;
  counts.voices = list(source.audio).length;
  for (const collection of ["characters", "locations", "props", "vehicles"])
    for (const entity of list(source[collection])) {
      counts.states += list(entity.continuityStates).length;
      /* Every entity's coverage slots are counted here and every one of them is
         now expected to become a coverage record, characters included. */
      counts.coverage += list(entity.coverageSlots).length;
    }
  for (const shot of list(source.shots)) {
    counts.frames += list(shot.keyframes).length;
    counts.motion += list(shot.clips).length;
  }
  return counts;
}

function countTarget(candidate) {
  const counts = Object.fromEntries(COUNT_CATEGORIES.map((name) => [name, 0]));
  const list = (value) => (Array.isArray(value) ? value : []);
  counts.scenes = list(candidate.story && candidate.story.scenes).length;
  counts.shots = list(candidate.shots).length;
  const entities = isObject(candidate.entities) ? candidate.entities : {};
  for (const [collection, key] of [["characters", "characters"], ["locations", "locations"], ["props", "props"], ["vehicles", "vehicles"], ["voices", "voices"]])
    counts[key] = list(entities[collection]).length;
  for (const collection of ["characters", "locations", "props", "vehicles"])
    for (const entity of list(entities[collection])) {
      counts.states += list(entity.states).length;
      counts.coverage += list(entity.coverage).length;
    }
  for (const shot of list(candidate.shots)) {
    counts.frames += list(shot.frames).length;
    counts.motion += list(shot.motion).length;
    counts.relations += list(shot.relations).length;
  }
  counts.references = list(candidate.references).length;
  counts.assets = list(candidate.assets).length;
  counts.statements = list(candidate.statements).length;
  return counts;
}

function collectSourceIdentities(source) {
  const ids = [];
  const list = (value) => (Array.isArray(value) ? value.filter(isObject) : []);
  const push = (kind, id) => { if (nonEmptyString(id)) ids.push({ kind, id }); };
  /* A nested record with no identifier of its own has no identity to conserve -
     M060 is about to give it one, and that mint is reported separately. Guarding
     on the CHILD's id rather than on the composed key is what keeps
     `frame:INT-1->2/` out of the conservation check. */
  const pushNested = (kind, parentId, childId) => { if (nonEmptyString(parentId) && nonEmptyString(childId)) ids.push({ kind, id: `${parentId}/${childId}` }); };
  for (const scene of list(source.scenes)) push("scene", scene.id);
  for (const shot of list(source.shots)) {
    push("shot", shot.id);
    for (const frame of list(shot.keyframes)) pushNested("frame", shot.id, frame.id);
    for (const clip of list(shot.clips)) pushNested("motion", shot.id, clip.id);
  }
  for (const [collection, kind] of [["characters", "character"], ["locations", "location"], ["props", "prop"], ["vehicles", "vehicle"], ["audio", "voice"]])
    for (const entity of list(source[collection])) {
      push(kind, entity.id);
      for (const state of list(entity.continuityStates)) pushNested("state", entity.id, state.id);
      for (const slot of list(entity.coverageSlots)) pushNested("coverage", entity.id, slot.id);
    }
  return ids;
}

function collectTargetIdentities(candidate) {
  const present = new Set();
  const list = (value) => (Array.isArray(value) ? value : []);
  for (const scene of list(candidate.story && candidate.story.scenes)) present.add(`scene:${scene.id}`);
  for (const shot of list(candidate.shots)) {
    present.add(`shot:${shot.id}`);
    for (const frame of list(shot.frames)) present.add(`frame:${shot.id}/${frame.id}`);
    for (const clip of list(shot.motion)) present.add(`motion:${shot.id}/${clip.id}`);
  }
  const entities = isObject(candidate.entities) ? candidate.entities : {};
  for (const [collection, kind] of [["characters", "character"], ["locations", "location"], ["props", "prop"], ["vehicles", "vehicle"], ["voices", "voice"]])
    for (const entity of list(entities[collection])) {
      present.add(`${kind}:${entity.id}`);
      for (const state of list(entity.states)) present.add(`state:${entity.id}/${state.id}`);
      for (const slot of list(entity.coverage)) present.add(`coverage:${entity.id}/${slot.id}`);
    }
  return present;
}

/* --------------------------------------------------------------------------
   Statement binding.

   Runs after every rule, over the finished candidate, because a claim hash is
   only meaningful once the value it binds exists and resolves. */

function bindStatements(context) {
  const drafts = [...context.statementDrafts];
  /* Deterministic order and therefore deterministic IDs: by rule, then by the
     target string, then by kind. No clocks and no insertion-order dependence. */
  drafts.sort((a, b) => {
    const left = [a.rule, formatTargetString(a.target), a.kind].join(" ");
    const right = [b.rule, formatTargetString(b.target), b.kind].join(" ");
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const perRule = new Map();
  const statements = [];
  for (const draft of drafts) {
    const sequence = (perRule.get(draft.rule) || 0) + 1;
    perRule.set(draft.rule, sequence);
    const id = `stm-${draft.rule.toLowerCase()}-${String(sequence).padStart(4, "0")}`;
    const resolution = resolveTarget(context.candidate, draft.target);
    if (!resolution.ok) {
      context.diagnostics.push(makeMigrationDiagnostic("migration.statement.unresolvable",
        `${id}: the target ${resolution.targetString} does not resolve in the migrated document (${resolution.reason}). A migration-created statement whose target does not resolve is a migration failure, not a document warning.`,
        { where: draft.from || "", target: resolution.targetString, rule: draft.rule }));
    }
    const value = resolution.ok ? resolution.value : undefined;
    const statement = {
      id,
      target: draft.target,
      kind: draft.kind,
      /* THE HASH IS COMPUTED HERE, from the value as it finally stands. There is
         no path by which a rule, a tool or a model could supply one. */
      claim: resolution.ok
        ? { hash: computeClaimHash(resolution.targetString, value), preview: buildClaimPreview(value) }
        : { hash: `sha256:${"0".repeat(64)}`, preview: "" },
      actor: draft.actor,
      at: context.at,
    };
    if (draft.candidates) statement.candidates = draft.candidates.map((entry) => ({ value: entry.value, ...(entry.note ? { note: entry.note } : {}) }));
    if (draft.note) statement.note = draft.note;
    statements.push(statement);
  }
  return statements;
}

/* --------------------------------------------------------------------------
   The plan. */

function buildMigrationPlan(detection, source, options = {}) {
  const requested = options.rules ? new Set(options.rules) : null;
  const steps = MIGRATION_RULES.map((rule) => {
    const applicable = rule.appliesTo.includes(detection.generation);
    const selected = applicable && (requested === null || requested.has(rule.id));
    return {
      id: rule.id,
      name: rule.name,
      summary: rule.summary,
      origin: rule.origin,
      determinism: rule.determinism,
      status: selected ? "selected" : applicable ? "deselected" : "not-applicable",
    };
  });
  return {
    sourceFamily: detection.family,
    sourceGeneration: detection.generation,
    targetFormatId: OFP_FORMAT_ID,
    targetFormatVersion: OFP_CONTRACT_VERSION,
    /* Named so nobody has to infer it: this document is experimental, it is a
       COPY, and the source project is not part of the operation. */
    experimental: true,
    steps,
  };
}

/* --------------------------------------------------------------------------
   Execution. Pure: reads `source`, returns a new document. */

function migrateLegacyProject(source, options = {}) {
  const detection = options.detection || detectLegacyProject(source);
  const at = typeof options.at === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(options.at) ? options.at : DEFAULT_MIGRATION_INSTANT;
  const generatorVersion = options.generatorVersion || APPLICATION_VERSION;

  const plan = buildMigrationPlan(detection, source, options);

  if (!detection.migratable) {
    const code = detection.family === SOURCE_FAMILY.FOREIGN_APPLICATION ? "migration.source.foreign"
      : detection.family === SOURCE_FAMILY.OPEN_FILM_PROJECT ? "migration.source.already-ofp"
        : "migration.source.unrecognised";
    return {
      ok: false,
      detection,
      plan,
      candidate: null,
      report: {
        source: { detectedFamily: detection.family, detectedVersion: detection.schemaVersion, generation: detection.generation, reason: detection.reason },
        target: { formatId: OFP_FORMAT_ID, formatVersion: OFP_CONTRACT_VERSION },
        rules: [],
        counts: { source: {}, target: {}, adjustments: [], reconciled: false },
        accounting: { entries: [], byDisposition: {}, byRule: {}, unaccounted: [] },
        minted: [],
        statements: [],
        diagnostics: [makeMigrationDiagnostic(code, detection.reason, { where: "/" })],
        summary: { deterministicMappings: 0, inferredMappings: 0, disputes: 0, unmappedValues: 0, warnings: 0, errors: 1 },
      },
    };
  }

  const context = new MigrationContext(source, detection, { at, generatorVersion });
  if (detection.confidence === "sniffed") {
    context.rule = "M001";
    context.diagnostic("migration.source.sniffed", `no schema marker is present; the source generation was identified as ${detection.generation} by shape (${detection.shapeMarkers.join(", ") || "no shape markers"})`, { where: "/" });
  }

  const selected = new Set(plan.steps.filter((step) => step.status === "selected").map((step) => step.id));
  for (const rule of MIGRATION_RULES) {
    if (!selected.has(rule.id)) continue;
    context.rule = rule.id;
    rule.apply(context);
  }
  context.rule = "M001";

  /* ---- extensions, assembled once, in a deterministic order ---- */
  const extensions = {};
  const legacy = { version: "1", source: { family: detection.family, generation: detection.generation, schemaVersion: detection.schemaVersion, hubVersion: detection.hubVersion, confidence: detection.confidence } };
  if (context.legacyPreserved.length)
    legacy.preserved = [...context.legacyPreserved].sort((a, b) => (a.sourcePath < b.sourcePath ? -1 : a.sourcePath > b.sourcePath ? 1 : 0));
  if (context.legacyCodes.length) legacy.codes = [...context.legacyCodes].sort((a, b) => (a.sourcePath < b.sourcePath ? -1 : 1));
  if (context.legacyUnmappedCodes.length) legacy.unmappedCodes = [...context.legacyUnmappedCodes].sort((a, b) => (a.sourcePath < b.sourcePath ? -1 : 1));
  if (Object.keys(context.legacyAssetFiles).length) legacy.assetFiles = context.legacyAssetFiles;
  extensions[LEGACY_EXTENSION] = legacy;
  if (Object.keys(context.workflow).length) extensions[WORKFLOW_EXTENSION] = { version: "1", ...context.workflow };
  context.candidate.extensions = extensions;

  /* ---- statements, bound after the values exist ---- */
  const statements = bindStatements(context);
  if (statements.length) context.candidate.statements = statements;

  /* ---- the invariants ---- */
  const unaccounted = context.unaccounted();
  for (const pointer of unaccounted)
    context.diagnostics.push(makeMigrationDiagnostic("migration.unaccounted-source-value",
      `${pointer} reached no migration rule. Every source value must be mapped, preserved, dropped by a named rule, turned into a statement, or reported - there is no sixth category.`,
      { where: pointer, detail: context.ledger.describe(pointer) }));

  const sourceCounts = countSource(source);
  const targetCounts = countTarget(context.candidate);
  /* This registry used to declare one structural count difference here: a
     character's coverage slots were not expected to become coverage records, so
     M008 subtracted them and the reconciliation saw an explained loss rather
     than a silent one. P4-SEM-A gave `coverage` a character scope in the
     containment table, so the slots now survive as records and there is nothing
     left to subtract. The adjustment is removed rather than zeroed: an
     adjustment that always computes to nothing is a claim nobody checks. */

  const adjustmentTotals = {};
  for (const entry of context.countAdjustments) adjustmentTotals[entry.category] = (adjustmentTotals[entry.category] || 0) + entry.delta;
  const countRows = COUNT_CATEGORIES.map((category) => {
    const before = sourceCounts[category];
    const adjustment = adjustmentTotals[category] || 0;
    const after = targetCounts[category];
    /* relations, assets, references and statements are created by migration and
       have no meaningful "before"; their conservation is identity-side. */
    const created = ["relations", "assets", "references", "statements"].includes(category);
    return { category, before, adjustment, after, explained: created || before + adjustment === after };
  });
  for (const row of countRows)
    if (!row.explained)
      context.diagnostics.push(makeMigrationDiagnostic("migration.count.unexplained",
        `${row.category}: ${row.before} in the source, ${row.after} in the result, and the declared adjustments account for ${row.adjustment}. A count change must be explained by a rule that said it would change.`,
        { where: `/${row.category}` }));

  const sourceIdentities = collectSourceIdentities(source);
  const targetIdentities = collectTargetIdentities(context.candidate);
  const explainedIdentities = new Set(context.identityAdjustments.map((entry) => entry.id));
  const characterCoverageIds = new Set();
  for (const entity of (Array.isArray(source.characters) ? source.characters.filter(isObject) : []))
    for (const slot of (Array.isArray(entity.coverageSlots) ? entity.coverageSlots.filter(isObject) : []))
      if (nonEmptyString(slot.id)) characterCoverageIds.add(`coverage:${entity.id}/${slot.id}`);
  const lostIdentities = [];
  for (const entry of sourceIdentities) {
    const key = `${entry.kind}:${entry.id}`;
    if (targetIdentities.has(key) || explainedIdentities.has(key)) continue;
    if (characterCoverageIds.has(key)) continue;
    lostIdentities.push(key);
    context.diagnostics.push(makeMigrationDiagnostic("migration.identity.lost",
      `${key} exists in the source and not in the result, and no rule explains its absence.`, { where: "/" }));
  }

  /* ---- output scan, independent of the source-side quarantine ---- */
  const leaks = scanMigrationOutput(context.candidate);
  context.diagnostics.push(...leaks);

  const errors = context.diagnostics.filter((entry) => entry.severity === "error");
  const warnings = context.diagnostics.filter((entry) => entry.severity === "warning");
  const byDisposition = context.ledger.countsByDisposition();

  const report = {
    source: {
      detectedFamily: detection.family,
      detectedVersion: detection.schemaVersion,
      generation: detection.generation,
      confidence: detection.confidence,
      hubVersion: detection.hubVersion,
      metaVersion: detection.metaVersion,
      metaVersionClass: detection.metaVersionClass,
      markers: detection.shapeMarkers,
      fingerprint: `sha256:${sha256Hex(canonicalJson(source))}`,
      reason: detection.reason,
    },
    target: {
      formatId: OFP_FORMAT_ID,
      formatVersion: OFP_CONTRACT_VERSION,
      generator: { name: "CineBraid", version: generatorVersion },
      experimental: true,
      at,
    },
    rules: MIGRATION_RULES.map((rule) => {
      const activity = context.ruleActivity.get(rule.id);
      const step = plan.steps.find((entry) => entry.id === rule.id);
      return {
        id: rule.id,
        name: rule.name,
        determinism: rule.determinism,
        origin: rule.origin,
        status: step.status === "selected" ? (activity.claims || activity.statements || activity.diagnostics ? "applied" : "no-op") : step.status,
        sourceTargets: activity.claims,
        targetTargets: [...activity.targets].sort(),
        statements: activity.statements,
        note: rule.summary,
      };
    }),
    counts: { source: sourceCounts, target: targetCounts, rows: countRows, adjustments: context.countAdjustments, dropped: context.droppedCounts, reconciled: countRows.every((row) => row.explained) },
    identity: { source: sourceIdentities.length, preserved: sourceIdentities.length - lostIdentities.length, lost: lostIdentities, minted: context.mints.length },
    accounting: {
      entries: context.ledger.entries().map((entry) => ({ ...entry, value: context.ledger.describe(entry.pointer) })),
      byDisposition,
      byRule: context.ledger.countsByRule(),
      leaves: context.ledger.leaves.length,
      unaccounted,
    },
    minted: [...context.mints].sort((a, b) => (a.mintedId < b.mintedId ? -1 : a.mintedId > b.mintedId ? 1 : 0)),
    statements: statements.map((statement) => ({ id: statement.id, kind: statement.kind, target: formatTargetString(statement.target), note: statement.note || "" })),
    diagnostics: context.diagnostics,
    summary: {
      deterministicMappings: byDisposition.mapped,
      inferredMappings: statements.filter((statement) => statement.kind === "suggested").length,
      disputes: statements.filter((statement) => statement.kind === "disputed").length,
      preservedValues: byDisposition.preserved,
      droppedValues: byDisposition.dropped,
      unmappedValues: byDisposition.unmapped + unaccounted.length,
      warnings: warnings.length,
      errors: errors.length,
    },
  };

  return { ok: errors.length === 0, detection, plan, candidate: context.candidate, report };
}

/* --------------------------------------------------------------------------
   Validate the result against the P1 contract. A migration is not successful
   because serialization completed. */

function validateMigrationResult(candidate) {
  if (!candidate) return { ok: false, diagnostics: [], counts: { error: 1, warning: 0, info: 0 }, documentClass: null };
  return validateOfpDocument(candidate);
}

/* --------------------------------------------------------------------------
   The primary P2 API. Pure - no filesystem, no writes, no source mutation. */

function previewLegacyMigration(source, options = {}) {
  const before = canonicalJson(source);
  const outcome = migrateLegacyProject(source, options);
  const validation = validateMigrationResult(outcome.candidate);

  if (outcome.candidate && !validation.ok)
    outcome.report.diagnostics.push(makeMigrationDiagnostic("migration.validation.failed",
      `the migrated document carries ${validation.counts.error} contract error(s): ${[...new Set(validation.diagnostics.filter((entry) => entry.severity === "error").map((entry) => entry.code))].join(", ")}`,
      { where: "/" }));

  /* The source must be byte-identical to what came in. Asserted here rather than
     only in a test, because the engine hands rules the real source object and a
     rule that mutated it would otherwise be discovered by whoever noticed their
     project had changed. */
  const after = canonicalJson(source);
  if (before !== after) throw new Error("migration mutated the source document; the source is read-only by contract");

  const serialized = outcome.candidate ? serializeCanonical(outcome.candidate) : null;
  const errors = outcome.report.diagnostics.filter((entry) => entry.severity === "error");
  return {
    ok: errors.length === 0 && validation.ok,
    detection: outcome.detection,
    plan: outcome.plan,
    candidate: outcome.candidate,
    serialized,
    report: { ...outcome.report, summary: { ...outcome.report.summary, errors: errors.length } },
    validation,
  };
}

module.exports = {
  previewLegacyMigration,
  migrateLegacyProject,
  buildMigrationPlan,
  validateMigrationResult,
  detectLegacyProject,
  bindStatements,
  countSource,
  countTarget,
  collectSourceIdentities,
  collectTargetIdentities,
  MIGRATION_STATEMENT_KINDS,
  TEMPLATE_QC_CHECKLIST,
  COUNT_CATEGORIES,
  LEGACY_EXTENSION,
  WORKFLOW_EXTENSION,
  DEFAULT_MIGRATION_INSTANT,
};

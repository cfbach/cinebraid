"use strict";

/* The report-only validator.

   It reports. It does not repair, coerce, default, migrate or write. That is
   not a stylistic preference - it is the direct answer to the defect this whole
   body of work exists to end. `normalizeProjectV5` applies defaults at load, so
   a document that has merely been LOOKED AT comes back different from the one
   on disk, and every later reader inherits values nobody authored. Here:

       the document is the document.

   A default may be applied at USE, later, by whoever uses it. It must never
   appear because a document was inspected. Tests assert that a deep snapshot of
   the input is unchanged after validation, and the INV-R1 guard asserts that no
   byte was written anywhere under the project root.

   Four modes, separated because they answer different questions and a caller
   should be able to act on them differently:

     structural     is this JSON, and does it fit the declared shape?
     semantic       do the IDs, references, targets and claims hold up?
     portability    will this survive a move to another machine?
     compatibility  can this build read it, write it, or neither?

   Not every warning is fatal, and treating them alike is how a validator
   becomes something people route around. */

const { parseJsonStrict, OfpJsonError } = require("./ofp-json");
const { DOCUMENT, CONTAINMENT } = require("./ofp-schema");
const { classifyDocument, DOCUMENT_CLASS } = require("./ofp-format");
const { checkIdentifierFloor, isIdentifierPortable } = require("./ofp-identifiers");
const { parseSubjectRef, resolveSubject, resolveTarget, formatTargetString } = require("./ofp-target");
const { deriveStatementState, STATEMENT_STATES, STATEMENT_KINDS } = require("./ofp-statements");
const { MODES, SEVERITY, makeDiagnostic } = require("./ofp-diagnostics");
/* P4-SEM-B. The continuity profile's own resolution rule is one contract shared
   with the running application, so the thing that REPORTS a duplicate binding
   and the thing that RESOLVES one cannot disagree about which is live. */
const { CONTINUITY_PROFILE_ID, duplicateBindingEntityIds, stateIdBelongsToEntity } = require("../public/shared-continuity-binding");

const ALL_MODES = [MODES.COMPATIBILITY, MODES.STRUCTURAL, MODES.SEMANTIC, MODES.PORTABILITY];

/* The five collections whose IDs share one namespace. `shot.subjects[].entityId`
   is a bare ID with no type, so an ID used by both a prop and a character would
   be genuinely ambiguous - this invariant is what lets that field stay bare. */
const ENTITY_COLLECTIONS = ["characters", "locations", "props", "vehicles", "voices"];
const ENTITY_TYPE_OF_COLLECTION = { characters: "character", locations: "location", props: "prop", vehicles: "vehicle", voices: "voice" };

function pointerJoin(pointer, token) {
  return `${pointer}/${String(token).replace(/~/g, "~0").replace(/\//g, "~1")}`;
}

function subjectJoin(subject, type, id) {
  return subject ? `${subject}/${type}:${id}` : `${type}:${id}`;
}

function jsonTypeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function matchesType(spec, value) {
  const declared = spec.type;
  if (declared === undefined) return true;
  if (value === null) return spec.nullable === true;
  if (declared === "integer") return typeof value === "number" && Number.isInteger(value);
  if (declared === "number") return typeof value === "number" && Number.isFinite(value);
  if (declared === "object") return typeof value === "object" && !Array.isArray(value);
  if (declared === "array") return Array.isArray(value);
  return typeof value === declared;
}

function validateOfpDocument(input, options = {}) {
  const modes = new Set(options.modes && options.modes.length ? options.modes : ALL_MODES);
  const diagnostics = [];
  const skipped = [];
  /* Declared before anything can return, because `finish()` reads both and the
     parse-failure path returns before either would otherwise exist. */
  let classification = null;
  const statementStates = [];
  const report = (code, message, extra) => {
    const diagnostic = makeDiagnostic(code, message, extra);
    /* A mode that was not requested does not get to emit. Filtering here rather
       than at each call site means a mode cannot leak by being forgotten. */
    if (modes.has(diagnostic.mode)) diagnostics.push(diagnostic);
  };

  /* ---- parse -------------------------------------------------------------
     A string input is parsed strictly, which is the only way duplicate object
     keys are observable at all. An already-parsed object has, by definition,
     already lost them - callers that care must hand over the text. */
  let document = input;
  let sourceText = null;
  if (typeof input === "string") {
    sourceText = input;
    try {
      document = parseJsonStrict(input);
    } catch (error) {
      if (error instanceof OfpJsonError) {
        report(error.code, error.message, { where: `offset ${error.offset}` });
        return finish();
      }
      throw error;
    }
  }

  /* ---- compatibility ---------------------------------------------------- */
  classification = classifyDocument(document);
  if (classification.documentClass === DOCUMENT_CLASS.LEGACY) {
    report("format.legacy", `${classification.reason}. This is not an Open Film Project document and was not validated as one.`, { where: "/" });
    /* Deliberately the end of the road. Validating a legacy project against the
       OFP schema would produce a page of diagnostics about a contract it never
       claimed to follow, and every one of them would read as an invitation to
       convert it. Real production projects never enter the draft lane. */
    skipped.push(MODES.STRUCTURAL, MODES.SEMANTIC, MODES.PORTABILITY);
    return finish();
  }
  if (classification.documentClass === DOCUMENT_CLASS.FORMAT_INVALID || classification.documentClass === DOCUMENT_CLASS.UNRECOGNIZED) {
    report("format.invalid", classification.reason, { where: "/format" });
    skipped.push(MODES.STRUCTURAL, MODES.SEMANTIC, MODES.PORTABILITY);
    return finish();
  }
  if (classification.documentClass === DOCUMENT_CLASS.SUPPORTED_DRAFT) {
    report("format.supported", `${classification.reason} (${classification.version}).`, { where: "/format/version" });
  } else {
    report("format.unsupported", `${classification.reason}. Opened read-only; deeper validation was not attempted against a contract this build does not implement.`, { where: "/format/version" });
    /* Checking a 1.0-draft.7 document against the 1.0-draft.1 schema would
       report differences with a contract we have not written, which is noise
       dressed as findings. The classification IS the answer for these. */
    skipped.push(MODES.STRUCTURAL, MODES.SEMANTIC, MODES.PORTABILITY);
    return finish();
  }

  /* ---- structural -------------------------------------------------------- */
  const recordIndex = { byType: new Map(), entityIds: new Map() };

  function walk(spec, value, subject, pointer) {
    if (!spec || typeof spec !== "object") return;
    if (Object.keys(spec).length === 0) return; /* `{}` means "any JSON value" */

    if (!matchesType(spec, value)) {
      report("schema.type", `expected ${spec.type}${spec.nullable ? " or null" : ""}, found ${jsonTypeOf(value)}`, { target: `${subject}#${pointer}`, where: pointer || "/" });
      return;
    }
    if (value === null) return;

    if (spec.const !== undefined && value !== spec.const)
      report("schema.const", `expected ${JSON.stringify(spec.const)}, found ${JSON.stringify(value)}`, { target: `${subject}#${pointer}`, where: pointer || "/" });

    if (spec.pattern instanceof RegExp && typeof value === "string" && !spec.pattern.test(value))
      report("schema.pattern", `${JSON.stringify(value)} does not match ${spec.pattern}`, { target: `${subject}#${pointer}`, where: pointer || "/" });

    /* An unknown enum member is preserved verbatim and reported. `closedEnum`
       marks the frozen vocabularies whose unknown members the semantic pass
       owns instead, so one problem never produces two diagnostics. */
    if (Array.isArray(spec.enum) && !spec.closedEnum && typeof value === "string" && !spec.enum.includes(value))
      report("schema.enum.unknown", `${JSON.stringify(value)} is not a declared member of this enum (declared: ${spec.enum.join(", ")})`, { target: `${subject}#${pointer}`, where: pointer || "/" });

    if (spec.type === "object") {
      /* Foreign content by definition, or a profile this revision does not
         model. Not inspected, not reported key by key, not touched. */
      if (spec.passthrough) return;
      for (const key of spec.required || [])
        if (!Object.prototype.hasOwnProperty.call(value, key))
          report("schema.required.missing", `required key ${JSON.stringify(key)} is absent`, { target: `${subject}#${pointer}`, where: pointer || "/" });
      const declared = spec.properties || {};
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(declared, key)) {
          report("schema.unknown-property", `key ${JSON.stringify(key)} is not declared by this contract revision and was preserved unchanged`, { target: `${subject}#${pointerJoin(pointer, key)}`, where: pointerJoin(pointer, key) });
          continue;
        }
        walk(declared[key], value[key], subject, pointerJoin(pointer, key));
      }
      return;
    }

    if (spec.type === "array") {
      if (spec.record) {
        /* Entering a record collection restarts the addressing: each item is a
           subject in its own right and its pointer begins again at "". */
        const bucket = recordIndex.byType.get(spec.record) || [];
        for (let index = 0; index < value.length; index++) {
          const item = value[index];
          const id = item && typeof item === "object" && !Array.isArray(item) ? item.id : undefined;
          const childSubject = typeof id === "string" && id ? subjectJoin(subject, spec.record, id) : `${subject}#${pointerJoin(pointer, index)}`;
          bucket.push({ type: spec.record, id, item, subject: childSubject, ownerSubject: subject, where: pointerJoin(pointer, index) });
          walk(spec.items, item, typeof id === "string" && id ? childSubject : subject, typeof id === "string" && id ? "" : pointerJoin(pointer, index));
        }
        recordIndex.byType.set(spec.record, bucket);
        return;
      }
      for (let index = 0; index < value.length; index++)
        walk(spec.items, value[index], subject, pointerJoin(pointer, index));
      return;
    }
  }

  if (modes.has(MODES.STRUCTURAL) || modes.has(MODES.SEMANTIC) || modes.has(MODES.PORTABILITY)) {
    /* The walk builds the record index the semantic and portability passes
       need, so it runs whenever any of the three is requested; `report` still
       filters its structural diagnostics out if only semantics were asked for. */
    walk(DOCUMENT, document, "", "");
  }

  /* ---- semantic: identifiers -------------------------------------------- */
  for (const [type, records] of recordIndex.byType) {
    const seen = new Map();
    for (const entry of records) {
      const { id, subject, where } = entry;
      if (id === undefined) {
        /* A record with no `id` is already reported by schema.required.missing.
           Saying it again here would be the same finding twice. */
        continue;
      }
      const floor = checkIdentifierFloor(id);
      if (!floor.ok) {
        report("id.invalid", `${type} identifier ${JSON.stringify(id)}: ${floor.reason}`, { target: subject, where });
        continue;
      }
      /* Nested IDs are scoped to their parent, project-scoped IDs to the
         document. Keying on the owner subject gives both at once. */
      const scopeKey = `${entry.ownerSubject} ${type}`;
      const key = `${scopeKey} ${id}`;
      if (seen.has(key))
        report("id.duplicate", `two ${type} records under ${entry.ownerSubject || "the document root"} share the identifier ${JSON.stringify(id)}`, { target: subject, where });
      else seen.set(key, entry);

      if (!isIdentifierPortable(id))
        report("id.not-portable", `${type} identifier ${JSON.stringify(id)} is legal but outside id-portable (^[A-Za-z0-9._-]+$); it is preserved verbatim and nothing renames it`, { target: subject, where });
    }
  }

  const entities = document.entities;
  if (entities && typeof entities === "object" && !Array.isArray(entities)) {
    for (const collection of ENTITY_COLLECTIONS) {
      const list = entities[collection];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id) continue;
        const previous = recordIndex.entityIds.get(item.id);
        if (previous && previous !== collection)
          report("id.entity-collision", `identifier ${JSON.stringify(item.id)} is used by both entities.${previous} and entities.${collection}; entity IDs share one namespace because shot.subjects[].entityId carries no type`, { target: `${ENTITY_TYPE_OF_COLLECTION[collection]}:${item.id}`, where: `/entities/${collection}` });
        else recordIndex.entityIds.set(item.id, collection);
      }
    }
  }

  /* ---- semantic: cross-references and subject refs ----------------------- */
  function recordExists(type, id) {
    if (type === "entity") return recordIndex.entityIds.has(id);
    const records = recordIndex.byType.get(type) || [];
    return records.some((entry) => entry.id === id);
  }

  function checkRefs(spec, value, subject, pointer) {
    if (!spec || typeof spec !== "object" || value === null || value === undefined) return;
    if (spec.type === "object") {
      if (spec.passthrough) return;
      const declared = spec.properties || {};
      if (typeof value !== "object" || Array.isArray(value)) return;
      for (const key of Object.keys(declared))
        if (Object.prototype.hasOwnProperty.call(value, key)) checkRefs(declared[key], value[key], subject, pointerJoin(pointer, key));
      return;
    }
    if (spec.type === "array") {
      if (!Array.isArray(value)) return;
      for (let index = 0; index < value.length; index++) {
        const item = value[index];
        const id = spec.record && item && typeof item === "object" ? item.id : undefined;
        const childSubject = spec.record && typeof id === "string" && id ? subjectJoin(subject, spec.record, id) : subject;
        checkRefs(spec.items, item, childSubject, spec.record && typeof id === "string" && id ? "" : pointerJoin(pointer, index));
      }
      return;
    }
    if (typeof value !== "string" || !value) return;
    if (spec.ref && !recordExists(spec.ref, value))
      report("ref.unresolved", `${JSON.stringify(value)} does not name any ${spec.ref}`, { target: `${subject}#${pointer}`, where: pointer || "/" });
    if (spec.subjectRef) {
      const parsed = parseSubjectRef(value);
      if (!parsed.ok) report("subject.unresolvable", `${JSON.stringify(value)}: ${parsed.reason}`, { target: `${subject}#${pointer}`, where: pointer || "/" });
      else {
        const resolved = resolveSubject(document, value);
        if (!resolved.ok) report("subject.unresolvable", `${JSON.stringify(value)}: ${resolved.reason}`, { target: `${subject}#${pointer}`, where: pointer || "/" });
      }
    }
  }
  if (modes.has(MODES.SEMANTIC)) checkRefs(DOCUMENT, document, "", "");

  /* ---- semantic: the continuity profile (P4-SEM-B) -----------------------

     RELATIVE RESOLUTION, made explicit. `checkRefs` has already resolved
     `entityId` and `shotId` globally, which is legal because both namespaces
     are project-wide. Neither `stateId` nor `frameId` is, and the difference is
     not a nicety: twelve entities in the real corpus all declare a state whose
     id is `state-default`, so a global lookup would resolve a prop's binding
     against a character's wardrobe and report nothing.

     So each binding is resolved against exactly one owner:

         stateId  within the entity named in the SAME binding
         frameId  within the shot that CONTAINS the binding

     and a binding is weighed against the shot it is about - an entity a shot
     neither lists as a subject nor uses as its location has no state to
     declare there. The reading of "contains" includes `setting.locationId`
     because M020 puts the location there and not in `subjects[]`, which is
     visible in every migrated golden. */
  if (modes.has(MODES.SEMANTIC)) checkContinuityProfile();

  /* The entity's OWN state catalogue, or null when no entity of that id exists.
     The two answers are different findings and must not collapse: "this entity
     declares no such state" is a continuity error, "there is no such entity" is
     already ref.unresolved. */
  function entityStatesOf(entityId) {
    const collections = entities && typeof entities === "object" && !Array.isArray(entities) ? entities : {};
    for (const collection of ENTITY_COLLECTIONS) {
      const list = collections[collection];
      if (!Array.isArray(list)) continue;
      const record = list.find((item) => item && typeof item === "object" && item.id === entityId);
      if (!record) continue;
      const states = Array.isArray(record.states) ? record.states : [];
      return states.filter((state) => state && typeof state === "object" && typeof state.id === "string");
    }
    return null;
  }

  function checkContinuityProfile() {
    const profile = document.continuity;
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) return;

    /* Presence of the BLOCK is not participation; presence of DATA is. An empty
       `continuity: {}` round-tripped by a tool that never wrote a binding must
       not be told it failed to declare a profile it does not use. */
    const shotBindings = Array.isArray(profile.shots) ? profile.shots.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)) : [];
    const carriesData = Object.keys(profile).some((key) => key !== "shots") || shotBindings.length > 0;
    const declared = document.format && typeof document.format === "object" && Array.isArray(document.format.profiles)
      ? document.format.profiles
      : [];
    if (carriesData && !declared.includes(CONTINUITY_PROFILE_ID))
      report("continuity.profile.undeclared", `the document carries ${JSON.stringify(`/${CONTINUITY_PROFILE_ID}`)} data and format.profiles is ${JSON.stringify(declared)}; participation in a profile is declared, never inferred from the data being there`, { where: "/format/profiles" });

    const shotsById = new Map();
    for (const shot of recordIndex.byType.get("shot") || [])
      if (typeof shot.id === "string" && shot.id && !shotsById.has(shot.id)) shotsById.set(shot.id, shot.item);

    const seenShotIds = new Set();
    for (let index = 0; index < shotBindings.length; index++) {
      const entry = shotBindings[index];
      const where = `/${CONTINUITY_PROFILE_ID}/shots/${index}`;
      const shotId = typeof entry.shotId === "string" ? entry.shotId : "";
      if (!shotId) continue; /* schema.required.missing already said so */
      const subject = `shot:${shotId}`;
      if (seenShotIds.has(shotId))
        report("continuity.binding.duplicate", `two continuity entries bind ${JSON.stringify(shotId)}; one shot has one set of declared states, and a second entry makes the resolved value depend on array order`, { target: subject, where });
      else seenShotIds.add(shotId);

      const shot = shotsById.get(shotId) || null;
      /* An unresolved shotId is already `ref.unresolved`. Without the shot there
         is nothing to resolve a frame or a subject list against, so the
         remaining checks would be guesses about a shot that is not there. */
      if (!shot) continue;

      const contained = new Set();
      for (const item of Array.isArray(shot.subjects) ? shot.subjects : [])
        if (item && typeof item === "object" && typeof item.entityId === "string" && item.entityId) contained.add(item.entityId);
      const setting = shot.setting && typeof shot.setting === "object" && !Array.isArray(shot.setting) ? shot.setting : {};
      if (typeof setting.locationId === "string" && setting.locationId) contained.add(setting.locationId);

      const frameIds = new Set();
      for (const frame of Array.isArray(shot.frames) ? shot.frames : [])
        if (frame && typeof frame === "object" && typeof frame.id === "string" && frame.id) frameIds.add(frame.id);

      checkBindingList(entry.entityStates, subject, `${where}/entityStates`, `shot ${JSON.stringify(shotId)}`, contained);

      const seenFrameIds = new Set();
      const frames = Array.isArray(entry.frames) ? entry.frames : [];
      for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
        const frame = frames[frameIndex];
        if (!frame || typeof frame !== "object" || Array.isArray(frame)) continue;
        const frameWhere = `${where}/frames/${frameIndex}`;
        const frameId = typeof frame.frameId === "string" ? frame.frameId : "";
        if (!frameId) continue;
        if (seenFrameIds.has(frameId))
          report("continuity.binding.duplicate", `shot ${JSON.stringify(shotId)} binds frame ${JSON.stringify(frameId)} twice; one frame has one set of overrides`, { target: subject, where: frameWhere });
        else seenFrameIds.add(frameId);
        if (!frameIds.has(frameId)) {
          report("continuity.binding.frame-unknown", `${JSON.stringify(frameId)} names no frame on shot ${JSON.stringify(shotId)}; a frame-level binding is resolved within its own shot and never against a project-wide frame index`, { target: subject, where: frameWhere });
          continue;
        }
        checkBindingList(frame.entityStates, `${subject}/frame:${frameId}`, `${frameWhere}/entityStates`, `frame ${JSON.stringify(frameId)} of shot ${JSON.stringify(shotId)}`, contained);
      }
    }
  }

  function checkBindingList(list, subject, where, scopeWords, contained) {
    if (!Array.isArray(list)) return;
    for (const entityId of duplicateBindingEntityIds(list))
      report("continuity.binding.duplicate", `${scopeWords} binds ${JSON.stringify(entityId)} more than once; absence means inherit and a second binding for one entity at one scope makes the resolved state depend on array order`, { target: subject, where });
    for (let index = 0; index < list.length; index++) {
      const binding = list[index];
      if (!binding || typeof binding !== "object" || Array.isArray(binding)) continue;
      const entityId = typeof binding.entityId === "string" ? binding.entityId : "";
      const stateId = typeof binding.stateId === "string" ? binding.stateId : "";
      if (!entityId || !stateId) continue; /* schema.required.missing / schema.type own these */
      const itemWhere = `${where}/${index}`;
      const states = entityStatesOf(entityId);
      /* `null` means the entity itself does not exist, which checkRefs has
         already reported as ref.unresolved. Saying it again in this vocabulary
         would be one problem with two names. */
      /* An entity that does not exist is ONE finding, not three. checkRefs has
         already said `ref.unresolved`; a record that is not there is neither
         missing a state nor absent from a subject list. */
      if (states === null) continue;
      if (!stateIdBelongsToEntity(states, stateId))
        report("continuity.binding.state-unresolved", `${JSON.stringify(stateId)} names no state on ${JSON.stringify(entityId)} (it declares ${states.length ? states.map((state) => JSON.stringify(state.id)).join(", ") : "no states"}); a state id is resolved within the entity named in the same binding, because state ids are owner-scoped and are not unique across the document`, { target: `${subject}#${itemWhere}`, where: itemWhere });
      if (contained && !contained.has(entityId))
        report("continuity.binding.entity-unlisted", `${scopeWords} declares a state for ${JSON.stringify(entityId)}, which the shot neither lists in subjects[] nor uses as setting.locationId; a state can only be selected for an entity the shot contains`, { target: `${subject}#${itemWhere}`, where: itemWhere });
    }
  }

  /* ---- semantic: statements ---------------------------------------------- */
  if (modes.has(MODES.SEMANTIC) && Array.isArray(document.statements)) {
    for (let index = 0; index < document.statements.length; index++) {
      const statement = document.statements[index];
      if (!statement || typeof statement !== "object" || Array.isArray(statement)) continue;
      const where = `/statements/${index}`;
      const targetString = formatTargetString(statement.target);

      if (!STATEMENT_KINDS.includes(statement.kind))
        report("statement.kind.unknown", `${JSON.stringify(statement.kind)} is not one of the five acts (${STATEMENT_KINDS.join(", ")})`, { target: targetString, where });

      const resolution = resolveTarget(document, statement.target);
      if (!resolution.ok) {
        const code = resolution.code === "array-traversal" ? "statement.target.array-traversal"
          : resolution.code === "malformed" ? "statement.target.malformed"
            : "statement.target.unresolvable";
        report(code, `statement ${JSON.stringify(statement.id)}: ${resolution.reason}`, { target: targetString, where });
      }

      const hash = statement.claim && typeof statement.claim === "object" ? statement.claim.hash : undefined;
      if (typeof hash !== "string" || !/^sha256:[0-9a-f]{64}$/.test(hash))
        report("statement.claim.malformed", `statement ${JSON.stringify(statement.id)}: claim.hash is missing or is not "sha256:" followed by 64 lowercase hex digits`, { target: targetString, where });

      const derived = deriveStatementState(document, statement);
      statementStates.push({ id: statement.id, target: targetString, kind: statement.kind, state: derived.state });
      if (derived.state === STATEMENT_STATES.STALE) {
        /* Both codes fire for a stale approval: `statement.stale` so a caller
           counting staleness sees every one, and `statement.stale.approval` so
           the case that must reach a human is separately addressable. */
        report("statement.stale", `statement ${JSON.stringify(statement.id)} was made about a value that has since changed (stored ${derived.storedHash}, current ${derived.expectedHash})`, { target: targetString, where });
        if (statement.kind === "approved")
          report("statement.stale.approval", `statement ${JSON.stringify(statement.id)} is a stale approval and confers no approval; it is retained, not dropped`, { target: targetString, where });
      }

      if (statement.kind === "approved") {
        const actor = statement.actor;
        if (!actor || typeof actor !== "object" || Array.isArray(actor))
          report("statement.actor.missing", `statement ${JSON.stringify(statement.id)} is approved but names no actor; approval is a human act`, { target: targetString, where });
        else if (actor.kind !== "human")
          report("statement.actor.not-human", `statement ${JSON.stringify(statement.id)} is approved by an actor of kind ${JSON.stringify(actor.kind)}; only a human can approve`, { target: targetString, where });
      }

      if (statement.kind === "disputed" && !(Array.isArray(statement.candidates) && statement.candidates.length))
        report("statement.candidates.missing", `statement ${JSON.stringify(statement.id)} is disputed but carries no candidates; a conflict is about competing values, at least one of which is not in the document`, { target: targetString, where });
    }
  }

  return finish();

  function finish() {
    const counts = { error: 0, warning: 0, info: 0 };
    for (const diagnostic of diagnostics) counts[diagnostic.severity]++;
    return {
      ok: counts.error === 0,
      documentClass: classification ? classification.documentClass : DOCUMENT_CLASS.UNRECOGNIZED,
      access: classification ? classification.access : "none",
      version: classification ? classification.version : null,
      supportedVersion: classification ? classification.supportedVersion : null,
      modes: [...modes],
      skipped: [...new Set(skipped)],
      diagnostics,
      counts,
      statementStates,
      /* Returned so a caller does not have to parse twice. It is the same
         object graph that was inspected - nothing here copied or altered it. */
      document,
      sourceText,
    };
  }
}

module.exports = { validateOfpDocument, ALL_MODES, SEVERITY, MODES };

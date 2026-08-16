/* CineBraid generation binding — what a dispatched request ACTUALLY consumed.
 *
 * CineBraid already records a great deal about a generation: the compiled plan, the
 * submitted prompt, the endpoint, the backend, the capability it was validated against
 * and what it was estimated to cost. What it did not record is the IDENTITY of the
 * production inputs the provider was handed — which entity, which collection, which
 * continuity state, which file, which bytes, which frame.
 *
 * That cannot be reconstructed afterwards. A director approves a new image for a state,
 * renames a take, re-declares a frame's state, or re-points a shot binding, and the
 * project stops being able to answer "what did that render actually see". Reading the
 * project as it stands today and calling the answer provenance is the failure this
 * module exists to prevent, because it is indistinguishable from the truth right up to
 * the moment it is wrong.
 *
 * THE GOVERNING RULE:
 *
 *     Record what the dispatched request actually consumed,
 *     not what the project currently says should have been used.
 *
 * Which is why the CONSUMED SET is taken from the serializer's own bindings and from
 * nowhere else. The serializer is the last thing to touch a request before it leaves;
 * a reference the capability layer dropped, a modality the endpoint refuses, a frame the
 * plan carried but the mode has no field for — none of them reach `bindings`, and so
 * none of them appear here. The alternative, walking the project's references and
 * assuming they all travelled, is how a record comes to claim an influence the provider
 * never saw.
 *
 * THIS IS EVIDENCE, NOT JUDGEMENT. Nothing here says stale, invalid, drifted or
 * needs-regenerating. It writes down what was true at dispatch precisely so that a
 * later reader — one that does not exist yet — can compare it with what is true then and
 * reach its own conclusion. Absence is written as absence for the same reason: an
 * unknown state recorded as the default would be a fabricated fact with no way left to
 * detect it.
 *
 * NOTHING IS MINTED. The hash comes from media-hash.js, which is the same digest
 * continuity observations and the MediaAsset ledger use. The state comes from
 * shared-continuity.js, the same entry point the continuity manifest, the automation
 * preflight and server.js's authority selection resolve through. The entity list comes
 * from the shared kind vocabulary. The frame comes from the shot's own candidate ledger.
 * Where an answer does not exist, this records that it does not exist.
 */

const path = require("path");

const Continuity = require("./public/shared-continuity");
/* CineBraid's ONE media digest — continuity's, and the MediaAsset ledger's. Owned here
   rather than by the dispatcher for two reasons. It is the provenance module's business
   what identifies a file, not the transport's; and tests/media-asset-activation-boundary.js
   pins fal-generation.js as a module that does not reach into media identity, which is a
   containment proof worth keeping rather than amending. */
const { hashMediaFile } = require("./media-hash");

/* The shape written to the durable job. Bumped when a FIELD's meaning changes, so a
   reader can tell a record it understands from one it does not. */
const GENERATION_BINDING_VERSION = 1;

/* list -> kind, inverted from the shared kind vocabulary rather than restated. A second
   copy of this map is a second taxonomy, and the whole point of reading it from
   shared-continuity.js is that a project cannot declare one kind and bind another. */
const LIST_FOR_KIND = Continuity.ENTITY_KIND_LISTS;
const KIND_FOR_LIST = Object.fromEntries(Object.entries(LIST_FOR_KIND).map(([kind, list]) => [list, kind]));
const ENTITY_LISTS = Object.values(LIST_FOR_KIND);

/* Why a file's bytes are not identified. Every value is a fact about the input, never a
   verdict about the generation: `remote-url` says the provider fetched it itself, not
   that anything is wrong. */
const HASH_STATUS = {
  HASHED: "hashed",
  DECLARED: "declared",
  INLINE: "inline-data-uri",
  REMOTE: "remote-url",
  UNREADABLE: "unreadable",
  NO_SOURCE: "no-source",
};

/* Whether the state resolved at dispatch is the state that currently authorises the
   bytes that were sent. Recorded rather than acted on — the difference between the two
   is exactly the evidence a future reader needs, and collapsing it into "ok" would throw
   away the only thing that makes the state id checkable. */
const STATE_AUTHORITY = {
  MATCHED: "matched",
  UNMATCHED: "unmatched",
  NONE: "none",
};

/* A capture that could not be completed.
 *
 * THIS IS A REFUSAL, NOT A WARNING, and it exists because the alternative is worse than
 * failing. A new dispatch whose binding could not be built has exactly two options:
 * refuse before the provider is contacted, or send paid work and record nothing. The
 * second one produces a job that is indistinguishable from genuine pre-instrumentation
 * history — `recorded: false`, `bindings: null` — which is the one representation this
 * record reserves for jobs that predate it. A silent fail-open would therefore not just
 * lose evidence; it would forge the absence of it, permanently and undetectably.
 *
 * Nothing has been sent when this is thrown. It is raised before the ledger commit and
 * before the POST, so a refusal costs nothing and changes nothing. */
class GenerationBindingError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = "GenerationBindingError";
    this.code = "GENERATION_BINDING_UNRECORDABLE";
    this.status = 500;
    this.detail = detail;
  }
}

function text(value) {
  return String(value == null ? "" : value).trim();
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function listOf(value) {
  return Array.isArray(value) ? value : [];
}
/* Rows grouped by key IN ORDER, so a repeated key keeps every one of its rows rather
   than only the last. A Map built with `[key, row]` pairs is the shape that loses them. */
function occurrenceQueues(rows, keyOf) {
  const queues = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!queues.has(key)) queues.set(key, []);
    queues.get(key).push(row);
  }
  return queues;
}

/* The next unconsumed row for this key, or null if the key was never present at all.
   A key that WAS present and has been used up calls `onExhausted`, because pairing a
   dispatched input with a row that already described a different one is the collapse
   this exists to prevent. */
function takeOccurrence(queues, key, onExhausted) {
  if (!queues.has(key)) return null;
  const queue = queues.get(key);
  if (!queue.length) return onExhausted();
  return queue.shift();
}

/* posix basename. A stored reference address is a project-relative URL and always uses
   forward slashes; path.basename on Windows would also split on a backslash that is a
   legal character in a stored name. */
function baseName(value) {
  return path.posix.basename(text(value).split(/[?#]/)[0]);
}

/* ---------------------------------------------------------------------------
   Which collection an entity came from.

   A LOOKUP, not an inference: the id is found in one of the project's four visual
   entity lists or it is not found at all. An entity that appears in none of them yields
   "", because naming a collection an entity is not in would be the invented taxonomy
   this is meant to avoid. */
function entityListFor(project, entityId) {
  const id = text(entityId);
  if (!id) return "";
  for (const list of ENTITY_LISTS)
    if (listOf(project?.[list]).some((row) => text(row?.id) === id)) return list;
  return "";
}

function entityRecordFor(project, list, entityId) {
  return listOf(project?.[list]).find((row) => text(row?.id) === text(entityId)) || null;
}

/* ---------------------------------------------------------------------------
   Which FRAME the consumed bytes are.

   The shot's own candidate ledger answers this: a candidate row carries the frameId it
   was generated or approved for, and that row is a durable production record rather
   than a guess about a filename. The row is FOUND by the file that was sent, the same
   join media-asset-indexer.js already makes (`shotRows.get(shotId/file)`), and the same
   name resolution — stored, then name, then original.

   A frame's own `winner` is the fallback, for a take approved before candidate rows
   carried a frame.

   THREE ANSWERS, NOT TWO, and the difference is load-bearing:

     { frameId: "FR-B" }                 exactly one frame owns these bytes
     { frameId: "", ambiguous: false }   no frame does — an entity reference, a library
                                         asset, an audio file. Not a failure; those
                                         inputs are not frames.
     { frameId: "", ambiguous: true }    more than one frame claims them, disagreeing

   Collapsing the last two into "" is what lets an ambiguous input quietly inherit the
   TARGET frame's continuity state, which is a definitive answer built on a provenance
   nobody could establish. The caller has to be able to tell them apart. */
function resolveConsumedFrame(shot, file) {
  const none = { frameId: "", ambiguous: false };
  const name = baseName(file);
  if (!shot || !name) return none;

  const rows = listOf(shot.candidateFiles).filter((row) => {
    const key = row && (row.stored || row.name || row.original);
    return text(key) === name;
  });
  const declared = [...new Set(rows.map((row) => text(row?.frameId)).filter(Boolean))];
  if (declared.length === 1) return { frameId: declared[0], ambiguous: false };
  if (declared.length > 1) return { frameId: "", ambiguous: true };

  const winners = [...new Set(listOf(shot.keyframes)
    .filter((frame) => baseName(frame?.winner) === name)
    .map((frame) => text(frame?.id))
    .filter(Boolean))];
  if (winners.length === 1) return { frameId: winners[0], ambiguous: false };
  if (winners.length > 1) return { frameId: "", ambiguous: true };
  return none;
}

/* ---------------------------------------------------------------------------
   Which continuity state was resolved for this input.

   Through resolveDeclaredStateId() — the P4-SEM-B canonical precedence (frame, then
   shot, then the entity's default) and the same entry point every other consumer uses.
   Resolved HERE, at dispatch, against the project as it stands at the moment the paid
   request is committed. That is the state the request was made under; reading the
   entity's state later is the thing this record exists to make unnecessary.

   `stateAuthority` is the check that keeps the id honest. A state's approved file is
   read through stateApprovedFile(), which refuses to answer a non-default state with the
   default's image, and compared with the file that was actually sent:

       matched    the resolved state authorises exactly these bytes
       unmatched  it authorises different bytes — the package was built against an
                  earlier approval, and that difference is preserved rather than hidden
       none       the resolved state authorises no file at all

   Nothing is refused on any of these. They are recorded because a reader that cannot
   tell them apart will eventually resolve the question by guessing.

   NO DEFAULT-STATE INVENTION. resolveStateRecord() answers an unresolved id with a
   synthesised `state-default` so that its callers always have a record to read. That is
   right for a renderer and wrong for evidence: an entity that declares no continuity
   states has no continuity state, and writing one down would mint a fact the project
   does not contain — permanently, and in the one place nobody can check it against.
   So the resolved record is admitted only when it is genuinely one of THIS entity's own
   declared states; otherwise the state is recorded as unknown.

   `stateDeclared` separates the two ways a real state can be reached. `true` means a
   frame or the shot explicitly bound it. `false` means nothing was declared and the
   entity's default answered by precedence — which is the resolver's own third tier and
   is what selected the file, but is not a director's declaration and must not read as
   one.

   The resolver THROWS when the shared binding contract has not loaded. That is caught,
   because a provenance defect must not refuse a filmmaker's generation, and it is
   reported as an unresolved field rather than swallowed as "no state declared". */
function resolveConsumedState(project, shot, frameId, list, entityId, file) {
  const empty = { stateId: "", stateName: "", stateDeclared: false, stateAuthority: "", unresolved: "" };
  const kind = KIND_FOR_LIST[text(list)] || "";
  const entity = entityRecordFor(project, list, entityId);
  if (!kind || !entity) return empty;

  let declaredId = "";
  try {
    declaredId = text(Continuity.resolveDeclaredStateId(shot, text(frameId), kind, text(entityId)));
  } catch (error) {
    return { ...empty, unresolved: "stateId" };
  }

  const state = Continuity.resolveStateRecord(entity, declaredId);
  const stateId = text(state?.id);
  /* The record has to exist on this entity. State ids are owner-scoped, so a match
     against any other entity's catalogue would be meaningless anyway. */
  const own = listOf(entity.continuityStates).some((row) => text(row?.id) === stateId);
  if (!stateId || !own) return empty;

  const authorityFile = baseName(Continuity.stateApprovedFile(entity, state));
  const consumed = baseName(file);
  return {
    stateId,
    stateName: text(state?.name),
    stateDeclared: Boolean(declaredId),
    stateAuthority: !authorityFile
      ? STATE_AUTHORITY.NONE
      : authorityFile === consumed
        ? STATE_AUTHORITY.MATCHED
        : STATE_AUTHORITY.UNMATCHED,
    unresolved: "",
  };
}

/* ---------------------------------------------------------------------------
   The bytes.

   media-hash.js's digest, which is the one CineBraid already uses for continuity
   observations and for MediaAsset content identity. There is deliberately no second
   algorithm and no filename-derived identity: a renamed file with identical bytes is
   the same evidence, and a name reused for different bytes is not.

   `resolveFile` is injected because the dispatcher already owns the containment rule
   that turns a stored address into an absolute path, and this module must not hold a
   second copy of it. `hashFile` defaults to the shared digest and is overridable only so
   a caller can supply a pre-computed one; nothing may substitute a different algorithm. */
function resolveFileIdentity(source, options) {
  const kind = text(source?.kind);
  if (kind === "data-uri") return { file: "", fileHash: "", fileHashStatus: HASH_STATUS.INLINE };
  /* A source that names a content hash and no path has already been identified by
     something upstream. It is carried through rather than re-derived — there are no
     bytes here to read. */
  if (text(source?.contentHash))
    return { file: "", fileHash: text(source.contentHash), fileHashStatus: HASH_STATUS.DECLARED };

  const address = text(source?.path);
  if (!address) return { file: "", fileHash: "", fileHashStatus: HASH_STATUS.NO_SOURCE };
  /* The provider fetches a remote address itself. CineBraid never held those bytes, so
     it has nothing to hash and says so rather than hashing whatever a fetch returns
     now. */
  if (/^https?:/i.test(address)) return { file: address, fileHash: "", fileHashStatus: HASH_STATUS.REMOTE };

  let absolute = "";
  try {
    absolute = options.resolveFile ? options.resolveFile(address) : "";
  } catch (error) {
    return { file: address, fileHash: "", fileHashStatus: HASH_STATUS.UNREADABLE };
  }
  if (!absolute) return { file: address, fileHash: "", fileHashStatus: HASH_STATUS.UNREADABLE };
  try {
    return { file: address, fileHash: text(options.hashFile(absolute)), fileHashStatus: HASH_STATUS.HASHED };
  } catch (error) {
    /* An unreadable file at the moment of dispatch is a fact worth keeping. It cannot
       be recovered later and inventing a digest for it would be worse than an absence
       that says so. */
    return { file: address, fileHash: "", fileHashStatus: HASH_STATUS.UNREADABLE };
  }
}

/* ---------------------------------------------------------------------------
   THE CONSTRUCTOR.

   One authoritative construction point for every compiled route. The browser builds no
   part of this and the ingest side rebuilds no part of it — a second constructor would
   be a second answer, and the two would disagree on exactly the shot nobody checked.

   `serialized.bindings` is the consumed set and the ONLY consumed set. Its order is the
   serializer's, which is the plan's order, which is the order the provider received.

     plan                one compiled GenerationPlan; its references supply the source
                         address, the role and the production meaning
     serialized          what the serializer produced for THIS request
     sourceReferences    the build's own references, which carry the entityId the plan
                         does not project; matched by refId, never by position
     project / shot      read once, at dispatch, for state and frame resolution
     frameId             the frame this generation is FOR, which is what scopes the
                         declared-state precedence

   Returns [] when nothing was consumed. That is a POSITIVE record — a t2v request
   really did consume no image inputs — and it is why the absence of the field
   altogether has to keep meaning something different. See readGenerationBinding(). */
function buildGenerationBinding(input = {}) {
  const plan = isRecord(input.plan) ? input.plan : {};
  const serialized = isRecord(input.serialized) ? input.serialized : {};
  const project = isRecord(input.project) ? input.project : {};
  const shot = isRecord(input.shot) ? input.shot : null;
  const frameId = text(input.frameId);
  const options = {
    resolveFile: typeof input.resolveFile === "function" ? input.resolveFile : null,
    hashFile: typeof input.hashFile === "function"
      ? input.hashFile
      : (file) => hashMediaFile(file, { subject: "Generation binding" }),
  };

  /* CORRELATED BY ORDERED OCCURRENCE, NOT BY KEY.
   *
   * `new Map(rows.map((row) => [row.refId, row]))` keeps the LAST row for a repeated key
   * and silently discards the rest. A dispatch carrying two different files whose
   * references happen to share a key therefore produced two binding rows both describing
   * the second file — so the row for provider index 0 named bytes that index never
   * received. False provenance, and the worst kind: internally consistent.
   *
   * refIds are unique on a COMPILED route by contract — generation-contracts.js refuses a
   * plan with a duplicate — so a queue there is always one deep and this behaves exactly
   * as a keyed lookup did. The uncompiled route has no such validator: its keys come
   * straight from the request body, where two references may legitimately share one.
   *
   * Occurrence order is the correlation because it is the same order on both sides.
   * `serializeLegacyRequest` pushes the binding and the reference view for an input in
   * one pass over the dispatched payload, and the compiled serializers emit one binding
   * per plan reference. So the Nth binding naming a refId describes the Nth reference
   * naming it — not by convention, but because they were built together.
   *
   * refId is left alone. Rewriting it to manufacture uniqueness would make the field
   * mean something it is not defined to mean, and a reader correlating a binding back to
   * `job.providerBindings` or to the plan would stop finding it. */
  const planQueues = occurrenceQueues(listOf(plan.inputs?.references).filter(isRecord), (row) => text(row.refId));
  const sourceQueues = occurrenceQueues(listOf(input.sourceReferences).filter(isRecord), (row) => text(row.refId || row.key));

  return listOf(serialized.bindings).filter(isRecord).map((bound, position) => {
    const refId = text(bound.refId);
    /* EXHAUSTED IS NOT THE SAME AS ABSENT. A refId the plan never carried leaves the
       source unknown, which the row already records honestly. A refId the plan carried
       FEWER times than the request dispatched cannot be paired without reusing a row
       that describes different bytes — so it refuses instead. */
    const reference = takeOccurrence(planQueues, refId, () => {
      throw new GenerationBindingError(
        "CineBraid could not tell which approved input this request was sending, because two of them share one "
        + "reference key and the compiled record cannot separate them. Nothing was sent and nothing was charged.",
        { refId, field: text(bound.field), position },
      );
    });
    const source = isRecord(reference?.source) ? reference.source : {};
    const origin = takeOccurrence(sourceQueues, refId, () => {
      throw new GenerationBindingError(
        "CineBraid could not tell which approved input this request was sending, because two of them share one "
        + "reference key and the stored package cannot separate them. Nothing was sent and nothing was charged.",
        { refId, field: text(bound.field), position },
      );
    });

    const identity = resolveFileIdentity(source, options);
    /* Never inferred from a label, a filename or a reference key. The build recorded
       which entity a reference is for, or it did not, and "" means it did not. */
    const entityId = text(origin?.entityId);
    const list = entityListFor(project, entityId);

    /* ONE ROW, ONE PROVENANCE.
     *
     * The consumed frame is resolved FIRST, because it is what the continuity state has
     * to be resolved AGAINST. This used to run the other way round: the state was scoped
     * to the frame the generation was FOR, and the consumed frame was worked out
     * afterwards and written beside it. A frame-A request consuming frame B's approved
     * bytes therefore produced a row reading `frameId: FR-B` next to frame A's state —
     * three fields on one line describing two different things, which is worse than
     * either fact alone because it looks complete.
     *
     * The scope, in order:
     *
     *   ambiguous consumed frame  no state at all. More than one frame claims these
     *                             bytes, so no continuity state can be established for
     *                             them, and falling back to the shot or the default
     *                             would be a definitive answer resting on a provenance
     *                             nobody could resolve.
     *   a consumed frame          THAT frame scopes the state. The bytes belong to it.
     *   no consumed frame         the target frame scopes it. An entity authority image
     *                             is not one of the shot's frames; it was selected FOR
     *                             the frame being generated, and that is the context
     *                             that chose it. */
    const consumed = resolveConsumedFrame(shot, identity.file);
    const state = consumed.ambiguous
      ? { stateId: "", stateName: "", stateDeclared: false, stateAuthority: "", unresolved: "consumed-frame-ambiguous" }
      : resolveConsumedState(project, shot, consumed.frameId || frameId, list, entityId, identity.file);
    const consumedFrameId = consumed.frameId;

    return {
      /* Ties the binding to job.providerBindings and to the plan, so a reader never has
         to match these records up by position. */
      refId,
      role: text(bound.role || reference?.role),
      mediaType: text(bound.mediaType || reference?.mediaType),
      /* WHERE it landed in the provider request. `image_url` and `end_image_url` are
         what make an FLF pair readable months later; an ordered field carries its
         index, so a keyframe sequence keeps the order it was sent in. */
      providerField: text(bound.field),
      providerIndex: Number.isInteger(bound.index) ? bound.index : null,
      order: Number.isFinite(Number(bound.order)) ? Number(bound.order) : null,
      entityId,
      list,
      stateId: state.stateId,
      stateName: state.stateName,
      /* Whether a frame or the shot explicitly BOUND that state, as opposed to the
         entity's default answering by precedence. Both are real resolutions; only one
         is a declaration. */
      stateDeclared: state.stateDeclared,
      stateAuthority: state.stateAuthority,
      /* The frame these BYTES are, which is not the frame this generation is for. It is
         what separates "this generation consumed Frame A" from "this generation belonged
         to shot SH-12" — and, with stateId resolved against it, the row describes one
         provenance rather than two. */
      frameId: consumedFrameId,
      sourceKind: text(source.kind),
      file: identity.file,
      fileHash: identity.fileHash,
      fileHashStatus: identity.fileHashStatus,
      /* Carried only when the plan's source actually named one. Never looked up, never
         minted, and never a substitute for the hash: a durable asset identity, a content
         hash and a storage path are three different facts and CineBraid keeps them
         apart. */
      assetId: text(source.assetId),
      ...(state.unresolved ? { unresolved: [state.unresolved] } : {}),
    };
  });
}

/* The record as it is written onto a job, with the version and the moment it was
   frozen. Kept together so the two cannot be persisted apart. */
function generationBindingRecord(input = {}) {
  return {
    generationBindingVersion: GENERATION_BINDING_VERSION,
    generationBindingRecordedAt: text(input.at),
    generationBinding: buildGenerationBinding(input),
  };
}

/* ---------------------------------------------------------------------------
   THE READER, and the only one this phase ships.

   ABSENCE IS NOT AN EMPTY SET. A job recorded before this existed used references —
   probably several — and simply has no record of them. A t2v job recorded after it used
   none, and has a record saying so. Returning [] for both would erase that difference
   permanently and on the first read, which is why `bindings` is null rather than [] when
   nothing was recorded and why every caller has to look at `recorded` first. */
function readGenerationBinding(job) {
  if (!Array.isArray(job?.generationBinding)) return { recorded: false, bindings: null, version: 0 };
  return {
    recorded: true,
    bindings: job.generationBinding,
    version: Number(job.generationBindingVersion) || 0,
  };
}

module.exports = {
  ENTITY_LISTS,
  GENERATION_BINDING_VERSION,
  GenerationBindingError,
  HASH_STATUS,
  KIND_FOR_LIST,
  STATE_AUTHORITY,
  buildGenerationBinding,
  entityListFor,
  generationBindingRecord,
  readGenerationBinding,
  resolveConsumedFrame,
  resolveConsumedState,
};

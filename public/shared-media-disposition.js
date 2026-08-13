/* Shared media-disposition semantics for browser and Node, the same way
   public/shared-coverage.js and public/shared-continuity.js are shared.

   P4-SEM-C2. C1 gave every media file a durable identity in the MediaAsset
   ledger and deliberately stopped there: it does not touch approval pointers,
   candidate rows or any filename semantics. This module is where those records
   acquire that identity, and where the product gets ONE answer to the question
   every media surface asks independently today.

   THE PROPERTY THIS FILE EXISTS FOR, in one line: two CineBraid surfaces looking
   at the same approved image cannot disagree about whether it exists.

   ---------------------------------------------------------------------------
   THE DEFECT THIS ENDS, because it is the reason the module is not a tidy-up.

   Dogfood Pass #1 (2026-08-12) reported an approved London Rooftops source that
   was present to coverage automation and absent from the manual "Choose &
   approve" surface. Both readers read the same field:

     public/coverage-automation.js  coverageAuthorityReferences()
         reads slot.approvedFile and INCLUDES it, ranking the primary at 1000.

     public/entities.js             the candidate partition
         read the same approvedFile into an `approvedNames` Set and EXCLUDED
         every member of it from the active list AND from the rejected list.

   So an approved image did not merely lose its badge. It left the surface
   entirely, and the creator could no longer reach the most important image in
   the workflow. Approval made the media LESS visible, which inverts what
   approval is for.

   Neither reader was wrong about the data. There was no owner of the question,
   so each surface answered it privately and the two answers disagreed. That is
   the same shape public/shared-coverage.js fixed for requirement counts, and it
   is fixed the same way here: one resolver, and no caller may re-derive.

   ---------------------------------------------------------------------------
   THE DISPOSITION CONTRACT, frozen here because it used to be re-guessed.

   Every media item belonging to an entity resolves to exactly one role:

     approved    the item is the approved file of at least one approval target
     rejected    not approved, and its candidate row says decision === "rejected"
     candidate   everything else

   APPROVED OUTRANKS REJECTED, and that precedence is inherited deliberately
   rather than invented: the previous code excluded approved names from the
   rejected list as well as the active one, so a file that was rejected and later
   approved already read as approved. Re-deriving it as "rejected" here would
   change live behaviour under cover of a refactor.

   An approved item also carries WHAT it is authority for. `role` alone would
   reproduce the flat boolean this module exists to replace — "approved" is not a
   property of an image, it is a relationship between an image and a target, and
   one image may be authority for several. targets[] names them.

   NO UI WORDING. The roles above are tokens. Which words a surface prints, and
   whether it prints a chip, a pin or a section, belongs to the browser and to
   the later UX batch — the same rule public/shared-continuity.js holds and
   tests/continuity-ui-render-only.js enforces.

   NOTHING IS MUTATED BY A READ. Every resolver returns fresh values and writes
   nothing back. In particular this module never calls entityStateList(), which
   normalises the entity it is handed; a disposition read must not canonicalise a
   legacy project merely by rendering it.

   ---------------------------------------------------------------------------
   IDENTITY, and the naming collision that is easy and permanent.

   `P.mediaAssets[]` in project.json is the PROJECT MEDIA LIBRARY, an older and
   different thing whose rows the shot surfaces already pass around as `assetId`
   (public/automation.js, public/creation-studio.js). Rows in the MediaAsset
   LEDGER are MediaAssets, and their identity is what survives a rename.

   The records this module writes carry the ledger's identity under a name that
   cannot be mistaken for the library's:

     approvedAssetId   on an approval target — a continuity state, a coverage
                       slot, an expression slot, or the entity's primary.
     assetId           on an entity candidate row, which has never carried a
                       library id and is entity-scoped, so the ledger's own
                       spelling is unambiguous there.

   IDENTITY IS ADDITIVE AND OPTIONAL. approvedFile stays exactly where it is and
   keeps meaning what it meant. A project whose ledger has never run, or whose
   media was backfilled without a digest, carries no approvedAssetId at all and
   must resolve exactly as it did before — absence is legal and is not a defect.
   That is why resolveApprovalMedia() prefers identity and FALLS BACK to the
   filename rather than requiring identity.

   The one thing identity buys, stated plainly: after CineBraid renames a file
   during approval, an edge that recorded the assetId can be repaired by identity
   instead of by matching a string that has already changed. */

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis, function () {
  /* The declared vocabulary. Tokens, never sentences. */
  const MEDIA_DISPOSITIONS = ["approved", "candidate", "rejected"];
  /* Which kind of thing an approval target is. `primary` exists for the entity's
     own approvedFile when the entity carries no continuity states at all — audio
     entities are read that way today — so the primary approval is never invisible
     merely because the state collection is empty. */
  const APPROVAL_TARGET_KINDS = ["primary", "state", "coverage", "expression"];

  /* The field names, named once so a reader can grep for the decision rather
     than for a string literal scattered across five call sites. */
  const APPROVED_ASSET_ID_FIELD = "approvedAssetId";
  const CANDIDATE_ASSET_ID_FIELD = "assetId";

  const REJECTED_DECISION = "rejected";

  function dispositionText(value) {
    return String(value == null ? "" : value).trim();
  }

  function dispositionRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function dispositionList(value) {
    return Array.isArray(value) ? value : [];
  }

  /* The one place that decides whether a value is a usable ledger identity.
     Deliberately shape-checked rather than merely truthy: a legacy record that
     somehow carries a filename here must read as "no identity" and fall back to
     the filename path, never as an identity that will match nothing. The pattern
     is media-assets.js's own, restated because this module must not require the
     Node ledger in a browser. */
  const ASSET_ID_PATTERN = /^asset-[0-9a-f]{32}$/;
  function isLedgerAssetId(value) {
    return typeof value === "string" && ASSET_ID_PATTERN.test(value);
  }

  /* Which file a continuity state approves.

     public/shared-continuity.js already owns this rule, including the one that
     matters — a NON-DEFAULT state with no approved file of its own resolves to
     "" and never borrows the default's image. Resolving through it keeps that
     single owner; the local fallback exists only so this module stays usable in
     a Node suite that has not loaded the continuity script, and it is a verbatim
     restatement rather than a second interpretation. */
  function stateApprovedFileFor(entity, state) {
    const shared = typeof stateApprovedFile === "function"
      ? stateApprovedFile
      : typeof globalThis !== "undefined" && typeof globalThis.stateApprovedFile === "function"
        ? globalThis.stateApprovedFile
        : null;
    if (shared) return shared(entity, state);
    if (!entity) return "";
    if (!state) return dispositionText(entity.approvedFile);
    if (state.isDefault) return dispositionText(state.approvedFile || entity.approvedFile);
    return dispositionText(state.approvedFile);
  }

  /* Every approval pointer an entity carries, in one list.

     `states` is accepted as an option because the caller usually already holds a
     normalised list and because entityStateList() MUTATES — this module must not
     be the thing that quietly writes a default state into a project the user
     only looked at. When it is not supplied, the raw collection is read.

     The union reproduces exactly what public/entities.js used to assemble
     inline: states (through the shared state rule), then coverage slots, then
     expression slots. Nothing was added to it and nothing was dropped. */
  function approvalEdges(entity, options = {}) {
    const it = dispositionRecord(entity);
    const states = Array.isArray(options.states) ? options.states : dispositionList(it.continuityStates);
    const edges = [];

    for (const state of states) {
      const record = dispositionRecord(state);
      const file = dispositionText(stateApprovedFileFor(it, record));
      edges.push({
        kind: "state",
        id: dispositionText(record.id),
        label: dispositionText(record.name) || dispositionText(record.id),
        isDefault: !!record.isDefault,
        record,
        file,
        assetId: isLedgerAssetId(record[APPROVED_ASSET_ID_FIELD]) ? record[APPROVED_ASSET_ID_FIELD] : "",
      });
    }

    /* The entity's own approvedFile is normally the default state's, kept in
       sync by entityStateList(). It is emitted as its own edge only when no
       state claims it, so a stateless entity still reports its primary approval
       and a normal entity does not report the same approval twice. */
    const primaryFile = dispositionText(it.approvedFile);
    if (primaryFile && !edges.some((edge) => edge.file === primaryFile))
      edges.push({
        kind: "primary",
        id: "",
        label: "Primary reference",
        isDefault: true,
        record: it,
        file: primaryFile,
        assetId: isLedgerAssetId(it[APPROVED_ASSET_ID_FIELD]) ? it[APPROVED_ASSET_ID_FIELD] : "",
      });

    for (const [kind, collection] of [["coverage", it.coverageSlots], ["expression", it.expressionSlots]])
      for (const slot of dispositionList(collection)) {
        const record = dispositionRecord(slot);
        edges.push({
          kind,
          id: dispositionText(record.id),
          label: dispositionText(record.label) || dispositionText(record.id),
          isDefault: false,
          record,
          file: dispositionText(record.approvedFile),
          assetId: isLedgerAssetId(record[APPROVED_ASSET_ID_FIELD]) ? record[APPROVED_ASSET_ID_FIELD] : "",
        });
      }

    return edges.filter((edge) => edge.file || edge.assetId);
  }

  /* The entity candidate row for a filename, READ-ONLY.

     public/entities.js's entityCandidateRow() can create a row and normalises
     the collection as a side effect. This one cannot do either, because it runs
     inside a render. The lookup key matches it exactly — `stored` then `name`. */
  function candidateRowFor(entity, fileName) {
    const name = dispositionText(fileName);
    if (!name) return null;
    return dispositionList(dispositionRecord(entity).candidateFiles)
      .find((row) => dispositionText(dispositionRecord(row).stored || dispositionRecord(row).name) === name) || null;
  }

  /* THE reader. Everything that wants to know what a piece of entity media IS
     calls this and nothing else.

     Returns the role, the approval targets it satisfies, and the durable
     identity if any edge recorded one. `edges` may be passed in by a caller
     resolving a whole collection so the edge list is assembled once. */
  function mediaDisposition(entity, fileName, options = {}) {
    const it = dispositionRecord(entity);
    const name = dispositionText(fileName);
    const edges = Array.isArray(options.edges) ? options.edges : approvalEdges(it, options);
    const targets = edges.filter((edge) => edge.file && edge.file === name);
    if (targets.length) {
      const identified = targets.find((edge) => edge.assetId);
      return {
        role: "approved",
        targets,
        assetId: identified ? identified.assetId : "",
        rejected: false,
      };
    }
    const row = candidateRowFor(it, name);
    const rejected = dispositionText(dispositionRecord(row).decision) === REJECTED_DECISION;
    return {
      role: rejected ? "rejected" : "candidate",
      targets: [],
      assetId: isLedgerAssetId(dispositionRecord(row)[CANDIDATE_ASSET_ID_FIELD]) ? row[CANDIDATE_ASSET_ID_FIELD] : "",
      rejected,
    };
  }

  /* THE partition every media selector uses.

     Approved media is RETURNED, not removed. A surface that wants to pin it,
     badge it, or show it first has the information to do so; a surface that
     wants only undecided work reads `candidates`. What no surface may do again
     is silently drop the approved authority and leave the creator unable to
     reach it.

     Order within each group is the order the media arrived in, because the
     caller's media list is already sorted and re-sorting here would make this
     module responsible for presentation. */
  function partitionEntityMedia(entity, media, options = {}) {
    const it = dispositionRecord(entity);
    const edges = Array.isArray(options.edges) ? options.edges : approvalEdges(it, options);
    const approved = [];
    const candidates = [];
    const rejected = [];
    const byName = new Map();

    for (const item of dispositionList(media)) {
      const name = dispositionText(dispositionRecord(item).name);
      const disposition = mediaDisposition(it, name, { edges });
      const row = { item, name, ...disposition };
      byName.set(name, row);
      if (disposition.role === "approved") approved.push(row);
      else if (disposition.role === "rejected") rejected.push(row);
      else candidates.push(row);
    }

    return { approved, candidates, rejected, byName, edges };
  }

  /* Resolve an approval edge to the media item it points at, IDENTITY FIRST.

     This is the whole point of C2 in four lines. When an edge recorded the
     ledger's assetId and the media listing carries it too, the edge resolves
     even though the filename it also stores has since been rewritten by the
     approval rename. When either side lacks identity — a project whose ledger
     never ran, media backfilled with no digest — resolution falls back to the
     filename and behaves exactly as it did before C2.

     It never guesses. An edge whose identity matches nothing and whose filename
     matches nothing resolves to null, which is the honest answer and the one
     C1's legacy-link audit already insists on. */
  function resolveApprovalMedia(edge, media) {
    const target = dispositionRecord(edge);
    const items = dispositionList(media);
    if (isLedgerAssetId(target.assetId)) {
      const byIdentity = items.find((item) => dispositionRecord(item).assetId === target.assetId);
      if (byIdentity) return byIdentity;
    }
    const file = dispositionText(target.file);
    if (!file) return null;
    return items.find((item) => dispositionText(dispositionRecord(item).name) === file) || null;
  }

  /* THE SINGLE AUTHORITATIVE WRITER of durable identity onto an approval target.

     Called only from an explicit user act — an approval, or the rename that
     approval performs — never from a read and never on load, so no project
     acquires identity merely by being opened. A non-identity value is refused
     rather than stored, because a record carrying a malformed id is worse than
     one carrying none: the first will silently resolve to nothing, the second
     falls back to the filename and still works. */
  function stampApprovalIdentity(record, assetId) {
    if (!record || typeof record !== "object") return "";
    if (!isLedgerAssetId(assetId)) return "";
    record[APPROVED_ASSET_ID_FIELD] = assetId;
    return assetId;
  }

  function stampCandidateIdentity(record, assetId) {
    if (!record || typeof record !== "object") return "";
    if (!isLedgerAssetId(assetId)) return "";
    record[CANDIDATE_ASSET_ID_FIELD] = assetId;
    return assetId;
  }

  /* Repair every approval pointer an entity holds after CineBraid renamed a file.

     The pre-C2 repair lived inline in public/library-tools.js and patched four
     things: continuity states, entity.approvedFile, the candidate row, and
     generatedCandidates[]. It did NOT patch coverageSlots[] or
     expressionSlots[], so approving a rename of a file a coverage slot already
     approved left that slot pointing at a filename that no longer existed. That
     is the "any edge it does not know about is silently broken" case, and the
     fix is to enumerate edges rather than to remember them.

     Identity is stamped while the two names are both known — this is the only
     moment at which CineBraid can prove the old and new filenames are the same
     media, because the ledger anchored a digest before the move. Recording it
     now is what lets a LATER rename be repaired by identity instead of by
     string, which is the property the next batch inherits.

     Returns what it changed so a caller can assert on it rather than infer. */
  function repairApprovalIdentity(entity, change = {}) {
    const it = dispositionRecord(entity);
    const from = dispositionText(change.from);
    const to = dispositionText(change.to);
    const assetId = isLedgerAssetId(change.assetId) ? change.assetId : "";
    const repaired = [];
    if (!from || !to || from === to) return repaired;

    for (const edge of approvalEdges(it, { states: change.states })) {
      if (edge.file !== from) continue;
      /* Only a record that CARRIES the old name is rewritten. A default state
         whose own approvedFile is empty resolves through the entity's, so its edge
         reports the old name without holding it — and writing there would
         materialise a key the document did not have, which P0 §8 rule 9 forbids
         and which the pre-C2 repair also never did. */
      if (dispositionText(edge.record.approvedFile) !== from) continue;
      /* The primary edge's record IS the entity, and its field is approvedFile
         either way, so one assignment covers both shapes. */
      edge.record.approvedFile = to;
      if (assetId) stampApprovalIdentity(edge.record, assetId);
      repaired.push({ kind: edge.kind, id: edge.id, assetId });
    }

    /* entity.approvedFile is kept in sync with the default state by
       entityStateList(). When a state edge just moved, the entity's own copy has
       to move with it or the two disagree until the next normalisation. */
    if (dispositionText(it.approvedFile) === from) {
      it.approvedFile = to;
      if (assetId) stampApprovalIdentity(it, assetId);
      if (!repaired.some((row) => row.kind === "primary")) repaired.push({ kind: "primary", id: "", assetId });
    }

    const row = candidateRowFor(it, from);
    if (row) {
      row.stored = to;
      if (assetId) stampCandidateIdentity(row, assetId);
      repaired.push({ kind: "candidate", id: to, assetId });
    }

    for (const generated of dispositionList(it.generatedCandidates)) {
      const record = dispositionRecord(generated);
      if (dispositionText(record.stored || record.name) !== from) continue;
      record.stored = to;
      if (assetId) stampCandidateIdentity(record, assetId);
      repaired.push({ kind: "generated", id: to, assetId });
    }

    return repaired;
  }

  /* Which approval targets point at a filename that no longer resolves.

     DERIVED, never stored. A stale pointer is a health fact about the project as
     it sits on disk right now — the same class as OFP's asset.storage.
     unresolvable, which P0 made a warning rather than an error because a valid
     project may legitimately be opened without its media attached. Persisting it
     would freeze a transient truth into the document. */
  function staleApprovalEdges(entity, media, options = {}) {
    const items = dispositionList(media);
    return approvalEdges(dispositionRecord(entity), options)
      .filter((edge) => edge.file && !resolveApprovalMedia(edge, items))
      .map((edge) => ({ kind: edge.kind, id: edge.id, label: edge.label, file: edge.file, assetId: edge.assetId }));
  }

  /* =========================================================================
     P4-SEM-C3 — the same answer, extended to shot-side media edges.

     C2 answered "what is this media, and what is it authority for" for entity
     references. A shot asks the identical question about its own media and had
     no owner for it, so every reader matched strings and the approval rename
     repaired the candidate row while leaving every winner edge behind.

     EXTENDED, NOT MERGED. The shot dialect keeps its own vocabulary — this is
     the constraint media-assets.js:244 states and C2's closeout repeated: an
     entity row's decision vocabulary (approved-reference, approved-sheet-source,
     …) must never be coerced through a shot normaliser, and vice versa. What is
     shared is the ROLE vocabulary (approved / candidate / rejected), the
     identity rules, and resolveApprovalMedia(). What is not shared is which
     fields carry an approval, which is exactly what differs.

     WHAT AN APPROVED SHOT EDGE IS, and what it is not. `winner` means "this is
     the media this edge points at". It does NOT mean the media was creatively
     correct — Dogfood Pass #1 produced a good video from a Frame A that
     violated its own shot requirement, and nothing here would have caught that.
     Frame-intent validation is a different layer and is deliberately absent.

     P.mediaAssets[] IS NOT HERE, deliberately. Blocking guides and other library
     links are already keyed by the library row's own `asset.id` with a filename
     fallback, and no writer renames a library row's file, so they do not have
     the staleness this section exists to end. C2's closeout named them as a C3
     candidate; the source says otherwise, and linking that library to the
     MediaAsset ledger is a larger question that belongs with the Generated Media
     work rather than here. */

  /* Which kind of shot edge an approval is. Distinct members rather than one
     "winner" bucket, because a creator replacing a frame endpoint and a creator
     replacing the finished motion are making different decisions, and a reader
     that cannot tell them apart cannot say what it is about to overwrite. */
  const SHOT_APPROVAL_TARGET_KINDS = ["shot", "frame", "motion", "clip-first", "clip-last"];

  /* The identity field sits beside the field it identifies, mechanically:
     winner -> winnerAssetId, videoWinner -> videoWinnerAssetId. Per-field rather
     than one id per record, because one clip can carry three separate approvals
     (first, last, motion) and a single id could only describe one of them. */
  function shotAssetIdField(field) {
    return `${field}AssetId`;
  }

  function shotEdge(kind, id, label, record, field) {
    const owner = dispositionRecord(record);
    const file = dispositionText(owner[field]);
    const idField = shotAssetIdField(field);
    return {
      kind,
      id: dispositionText(id),
      label: dispositionText(label) || dispositionText(id) || kind,
      record: owner,
      field,
      idField,
      file,
      assetId: isLedgerAssetId(owner[idField]) ? owner[idField] : "",
    };
  }

  /* Every approval pointer a shot carries, in one list — the shot-side twin of
     approvalEdges().

     The collection is enumerated rather than remembered, which is the whole
     lesson of C2: the pre-C2 entity rename patched the four edges its author
     had in mind and silently missed the two they did not, and the shot rename
     is currently missing ALL of them. A reader that walks this list cannot have
     that bug. */
  function shotApprovalEdges(shot) {
    const s = dispositionRecord(shot);
    const edges = [
      shotEdge("shot", dispositionText(s.id), "Approved shot image", s, "winner"),
    ];
    for (const frame of dispositionList(s.keyframes)) {
      const record = dispositionRecord(frame);
      edges.push(shotEdge("frame", record.id, record.label ? `Frame ${record.label}` : "Frame", record, "winner"));
    }
    for (const clip of dispositionList(s.clips)) {
      const record = dispositionRecord(clip);
      const name = dispositionText(record.label) || dispositionText(record.suffix) || dispositionText(record.id);
      edges.push(shotEdge("motion", record.id || name, name ? `Motion ${name}` : "Motion", record, "videoWinner"));
      edges.push(shotEdge("clip-first", record.id || name, name ? `${name} first` : "Clip first", record, "winner"));
      edges.push(shotEdge("clip-last", record.id || name, name ? `${name} last` : "Clip last", record, "winnerEnd"));
    }
    return edges.filter((edge) => edge.file || edge.assetId);
  }

  /* The shot candidate row, READ-ONLY. public/review-provenance.js's
     candidateRecord() creates and normalises as a side effect; this one cannot,
     because it runs inside a render. The lookup key matches it exactly. */
  function shotCandidateRowFor(shot, fileName) {
    const name = dispositionText(fileName);
    if (!name) return null;
    return dispositionList(dispositionRecord(shot).candidateFiles)
      .find((row) => dispositionText(dispositionRecord(row).stored || dispositionRecord(row).name) === name) || null;
  }

  /* THE reader for shot media. Same three roles, same precedence — a live
     approval outranks a stale rejection, because the pointer is the newer fact. */
  function shotMediaDisposition(shot, fileName, options = {}) {
    const s = dispositionRecord(shot);
    const name = dispositionText(fileName);
    const edges = Array.isArray(options.edges) ? options.edges : shotApprovalEdges(s);
    const targets = edges.filter((edge) => edge.file && edge.file === name);
    if (targets.length) {
      const identified = targets.find((edge) => edge.assetId);
      return { role: "approved", targets, assetId: identified ? identified.assetId : "", rejected: false };
    }
    const row = shotCandidateRowFor(s, name);
    const rejected = dispositionText(dispositionRecord(row).decision) === REJECTED_DECISION;
    return {
      role: rejected ? "rejected" : "candidate",
      targets: [],
      assetId: isLedgerAssetId(dispositionRecord(row)[CANDIDATE_ASSET_ID_FIELD]) ? row[CANDIDATE_ASSET_ID_FIELD] : "",
      rejected,
    };
  }

  function partitionShotMedia(shot, media, options = {}) {
    const s = dispositionRecord(shot);
    const edges = Array.isArray(options.edges) ? options.edges : shotApprovalEdges(s);
    const approved = [], candidates = [], rejected = [], byName = new Map();
    for (const item of dispositionList(media)) {
      const name = dispositionText(dispositionRecord(item).name);
      const disposition = shotMediaDisposition(s, name, { edges });
      const row = { item, name, ...disposition };
      byName.set(name, row);
      if (disposition.role === "approved") approved.push(row);
      else if (disposition.role === "rejected") rejected.push(row);
      else candidates.push(row);
    }
    return { approved, candidates, rejected, byName, edges };
  }

  /* Resolve one shot edge to the media it points at, IDENTITY FIRST. Thin on
     purpose — it is resolveApprovalMedia(), reused verbatim, because a shot
     approval and an entity approval resolve by the same rule and a second copy
     would be a second rule the day one of them changed. */
  function resolveShotApprovalMedia(edge, media) {
    return resolveApprovalMedia(edge, media);
  }

  /* THE SINGLE AUTHORITATIVE WRITER of identity onto a shot edge.
     Refuses anything that is not a ledger id, for the C2 reason: a record
     carrying a malformed identity resolves to nothing while looking
     authoritative, which is worse than one carrying none. */
  function stampShotApprovalIdentity(record, field, assetId) {
    if (!record || typeof record !== "object" || !field) return "";
    if (!isLedgerAssetId(assetId)) return "";
    record[shotAssetIdField(field)] = assetId;
    return assetId;
  }

  /* Clear identity when an edge is cleared, so a stale id cannot outlive the
     approval that justified it and silently re-resolve later. */
  function clearShotApprovalIdentity(record, field) {
    if (!record || typeof record !== "object" || !field) return;
    delete record[shotAssetIdField(field)];
  }

  /* Repair every shot approval pointer after CineBraid renamed a file.

     Before C3 this did not exist. public/library-tools.js called
     renameCandidateRecord(), which moves the candidate row's `stored` and
     retargets selectedCandidate — and nothing else. Every winner edge pointing
     at the renamed file kept the old name, so approving a take under a new
     filename could leave s.winner naming a file that was no longer on disk.

     Two derived pointers travel with the edges because they are copies of a
     winner rather than independent decisions: canonicalName (the shot's locked
     filename) and creationBrief.approvedMotionFile.

     Returns what it changed so a caller can assert on it rather than infer. */
  function repairShotApprovalIdentity(shot, change = {}) {
    const s = dispositionRecord(shot);
    const from = dispositionText(change.from);
    const to = dispositionText(change.to);
    const assetId = isLedgerAssetId(change.assetId) ? change.assetId : "";
    const repaired = [];
    if (!from || !to || from === to) return repaired;

    for (const edge of shotApprovalEdges(s)) {
      if (edge.file !== from) continue;
      edge.record[edge.field] = to;
      if (assetId) stampShotApprovalIdentity(edge.record, edge.field, assetId);
      repaired.push({ kind: edge.kind, id: edge.id, field: edge.field, assetId });
    }

    /* Derived copies of a winner, not decisions of their own. */
    if (dispositionText(s.canonicalName) === from) {
      s.canonicalName = to;
      repaired.push({ kind: "canonical-name", id: dispositionText(s.id), field: "canonicalName", assetId });
    }
    const creation = dispositionRecord(s.creationBrief);
    if (dispositionText(creation.approvedMotionFile) === from) {
      creation.approvedMotionFile = to;
      repaired.push({ kind: "approved-motion-file", id: dispositionText(s.id), field: "approvedMotionFile", assetId });
    }
    return repaired;
  }

  /* DERIVED, never stored — the shot twin of staleApprovalEdges(). */
  function staleShotApprovalEdges(shot, media) {
    const items = dispositionList(media);
    return shotApprovalEdges(dispositionRecord(shot))
      .filter((edge) => edge.file && !resolveApprovalMedia(edge, items))
      .map((edge) => ({ kind: edge.kind, id: edge.id, label: edge.label, field: edge.field, file: edge.file, assetId: edge.assetId }));
  }

  /* =========================================================================
     P4-SEM-C4 — the same answer, extended to generation job records.

     THE LAST OF C1'S THREE TARGETS. media-asset-service.js:59-62 named
     "approval pointers, candidate rows or job records"; C2 took the entity
     approval pointers and candidate rows, C3 took the shot-side ones, and the
     job record is what remains.

     THE DEFECT THIS ENDS, proven against a running server before it was
     written. fal-generation.js's ingest() records what a paid job delivered as
     `outputs[] = [{ type, name, url, ... }]` — a filename and a URL, and
     nothing else. The approval rename then rewrites that filename. C2 repairs
     every entity edge and C3 repairs every shot edge, and neither touches the
     job. So after approving a generated take under its canonical name, the job
     that produced it names a file that is no longer on disk, while the ledger
     has tracked those same bytes across the move perfectly. The forward
     provenance edge — "which media did this paid job deliver" — breaks at
     exactly the moment the media becomes canon.

     THE NAME, and why it is not `assetId`. `outputs[].assetId` is ALREADY
     TAKEN: every blocking output carries the P.mediaAssets[] LIBRARY row id
     there (fal-generation.js:891). That is precisely the collision the identity
     note above exists to prevent, and writing the ledger's id into the same key
     would overwrite a live library link with a different kind of id. The
     ledger's identity therefore lands on `mediaAssetId`, which cannot be
     mistaken for either. A blocking output legitimately carries both.

     MATCHED BY PATH, NEVER BY BARE FILENAME. A rename is scoped to one
     directory, and two shots can hold same-named takes. Matching an output on
     its basename alone is the false-linkage class C1 fixed in the indexer —
     `shots/SH010/blocking/BLOCK.png` inheriting SH020's record — so an output
     is repaired only when its own URL proves it is that file, or when it
     already carries the identity being repaired.

     WHAT IS NOT CLAIMED. That a job's outputs were good. `outputs[]` means
     "this job delivered that media", the same way `winner` means "this edge
     points at that media" and no more. */

  /* Deliberately NOT `assetId` — see above. */
  const JOB_OUTPUT_ASSET_ID_FIELD = "mediaAssetId";

  /* Where an output's bytes live, project-relative, read from the URL the
     ingest wrote. Returns "" when there is no usable path, and a caller must
     treat that as "cannot prove which file this is" rather than as a reason to
     fall back to the basename. */
  function jobOutputPath(output) {
    const raw = dispositionText(dispositionRecord(output).url);
    if (!raw.startsWith("/assets/")) return "";
    let rest = raw.slice("/assets/".length);
    try { rest = decodeURIComponent(rest); } catch { /* a raw name that is not valid escaping stays as written */ }
    return rest.replace(/\\/g, "/").replace(/^\/+/, "");
  }

  /* The directory portion of that path, for matching one rename's scope. */
  function jobOutputDir(output) {
    const full = jobOutputPath(output);
    const cut = full.lastIndexOf("/");
    return cut < 0 ? "" : full.slice(0, cut);
  }

  /* Every piece of media a job says it delivered, in one list — the job-side
     twin of approvalEdges() and shotApprovalEdges(). Enumerated rather than
     remembered, for the reason C2 and C3 both give: a repair that walks this
     list cannot miss an output kind somebody forgot to name. */
  function jobOutputEdges(job) {
    const outputs = dispositionList(dispositionRecord(job).outputs);
    const edges = [];
    outputs.forEach((output, index) => {
      const record = dispositionRecord(output);
      const file = dispositionText(record.name || record.file);
      const stored = record[JOB_OUTPUT_ASSET_ID_FIELD];
      edges.push({
        kind: dispositionText(record.type) || "output",
        id: String(index),
        index,
        record,
        field: "name",
        idField: JOB_OUTPUT_ASSET_ID_FIELD,
        path: jobOutputPath(record),
        dir: jobOutputDir(record),
        file,
        assetId: isLedgerAssetId(stored) ? stored : "",
      });
    });
    return edges.filter((edge) => edge.file || edge.assetId);
  }

  /* THE SINGLE AUTHORITATIVE WRITER of identity onto a job output. Refuses a
     non-identity for the C2 reason, and refuses to disturb `assetId` because
     that key belongs to the project media library. */
  function stampJobOutputIdentity(record, assetId) {
    if (!record || typeof record !== "object") return "";
    if (!isLedgerAssetId(assetId)) return "";
    record[JOB_OUTPUT_ASSET_ID_FIELD] = assetId;
    return assetId;
  }

  /* Which outputs a given rename would touch, WITHOUT touching them.
     The rename route needs this before it decides to open a write turn: a
     project that has never generated has no generation ledger, and a file move
     must not be the thing that creates one. */
  function jobOutputsForRename(job, change = {}) {
    const from = dispositionText(change.from);
    const to = dispositionText(change.to);
    const dir = dispositionText(change.dir).replace(/^\/+/, "").replace(/\/+$/, "");
    const assetId = isLedgerAssetId(change.assetId) ? change.assetId : "";
    if (!from || !to || from === to || !dir) return [];
    const target = `${dir}/${from}`;
    /* Identity first, path second — the same precedence resolveApprovalMedia()
       uses, so a SECOND rename finds the output even when the filename the
       first one wrote has since moved on. */
    return jobOutputEdges(job).filter((edge) => (assetId && edge.assetId === assetId) || edge.path === target);
  }

  /* Repair every job output naming a file CineBraid just renamed.

     `url` moves with `name` because it is a derived copy of it, exactly as
     canonicalName is a derived copy of a shot winner: leaving it behind would
     trade a stale name for a broken preview. Only the trailing segment is
     rewritten, so a URL that has been re-rooted elsewhere is left alone.

     Returns what it changed so a caller can assert on it rather than infer. */
  function repairJobOutputIdentity(job, change = {}) {
    const to = dispositionText(change.to);
    const assetId = isLedgerAssetId(change.assetId) ? change.assetId : "";
    const repaired = [];
    for (const edge of jobOutputsForRename(job, change)) {
      edge.record.name = to;
      const url = dispositionText(edge.record.url);
      const cut = url.lastIndexOf("/");
      if (cut >= 0) edge.record.url = `${url.slice(0, cut + 1)}${to}`;
      if (assetId) stampJobOutputIdentity(edge.record, assetId);
      repaired.push({ kind: edge.kind, index: edge.index, name: to, assetId });
    }
    return repaired;
  }

  /* Resolve one job output to the media it delivered, IDENTITY FIRST.
     resolveApprovalMedia() reused verbatim, for C3's reason: a job output and
     an approval edge resolve by the same rule, and a second copy would become a
     second rule the day one of them changed. */
  function resolveJobOutputMedia(output, media) {
    const record = dispositionRecord(output);
    const stored = record[JOB_OUTPUT_ASSET_ID_FIELD];
    return resolveApprovalMedia(
      { assetId: isLedgerAssetId(stored) ? stored : "", file: dispositionText(record.name || record.file) },
      media,
    );
  }

  /* A predicate over a live media listing: "did this job deliver this item?"

     Shaped as a matcher rather than as a list because both live readers filter
     a collection they have already built and ordered
     (public/automation.js v626FrameRowsFromJob, and the entity-state reader),
     and returning media here would make this module responsible for their
     order. Identity is checked first so a repaired output still matches after
     the bytes have moved again. */
  function jobOutputMatcher(job) {
    const names = new Set();
    const ids = new Set();
    for (const edge of jobOutputEdges(job)) {
      if (edge.file) names.add(edge.file);
      if (edge.assetId) ids.add(edge.assetId);
    }
    return function matchesJobOutput(item) {
      const row = dispositionRecord(item);
      const id = dispositionText(row.assetId);
      if (id && ids.has(id)) return true;
      return names.has(dispositionText(row.name));
    };
  }

  return {
    MEDIA_DISPOSITIONS,
    APPROVAL_TARGET_KINDS,
    APPROVED_ASSET_ID_FIELD,
    CANDIDATE_ASSET_ID_FIELD,
    isLedgerAssetId,
    approvalEdges,
    candidateRowFor,
    mediaDisposition,
    partitionEntityMedia,
    resolveApprovalMedia,
    stampApprovalIdentity,
    stampCandidateIdentity,
    repairApprovalIdentity,
    staleApprovalEdges,
    /* P4-SEM-C3 */
    SHOT_APPROVAL_TARGET_KINDS,
    shotAssetIdField,
    shotApprovalEdges,
    shotCandidateRowFor,
    shotMediaDisposition,
    partitionShotMedia,
    resolveShotApprovalMedia,
    stampShotApprovalIdentity,
    clearShotApprovalIdentity,
    repairShotApprovalIdentity,
    staleShotApprovalEdges,
    /* P4-SEM-C4 */
    JOB_OUTPUT_ASSET_ID_FIELD,
    jobOutputPath,
    jobOutputDir,
    jobOutputEdges,
    jobOutputsForRename,
    stampJobOutputIdentity,
    repairJobOutputIdentity,
    resolveJobOutputMedia,
    jobOutputMatcher,
  };
});

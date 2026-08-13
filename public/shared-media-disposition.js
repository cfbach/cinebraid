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
  };
});

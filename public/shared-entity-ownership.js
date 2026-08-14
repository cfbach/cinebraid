/* CINEBRAID — WHICH ENTITY OWNS A MEDIA FILE. Exactly, once, for everyone.

   Browser and Node, the same way public/shared-media-disposition.js is shared.

   ---------------------------------------------------------------------------
   THE DEFECT THIS ENDS (Dogfood #2 A4 / forensic F4).

   Entity media was selected with a filename PREFIX test:

       mediaByPrefix(SCAN.anchors, entity.prefix || entity.anchorPrefix || entity.id)
         -> name.toUpperCase().startsWith(prefix.toUpperCase())

   So every `CHAR-SWEEP-YOUNG…` asset matched `CHAR-SWEEP`, and all three of
   Young Sweep's candidates appeared under the adult Chimbley Sweep's review. The
   Widow stayed clean, which is the diagnostic detail: she has no child entity,
   so only OVERLAPPING IDS leak. Nothing about parent/child lineage was involved.

   A display leak was not the end of it. Review, coverage automation and the
   server batch reviewer all MATERIALIZE a candidate row for the entity whose
   surface the action was taken on, so a creator approving from the adult's pool
   could turn a projection error into a durable wrong-owner record.

   ---------------------------------------------------------------------------
   THE RULE.

       Media eligibility is keyed by EXACT DURABLE OWNER IDENTITY.
       A prefix overlap is never evidence of ownership.

   Ownership is decided in one order, and the order is the whole contract:

     1. AN UNCONTESTED DURABLE CLAIM. Exactly one entity in this list records
        this file — as a candidate row, or as the approved file of the entity,
        one of its continuity states, a coverage slot or an expression slot.
        That entity owns it. Nothing else is consulted.

     2. A CONTESTED CLAIM falls through, and is reported. Two entities recording
        one file is precisely what the old prefix behaviour could create, and the
        Dogfood #2 evidence must not be silently rewritten to resolve it. The
        file is attributed by rule 3 and listed in `contested` for a separate,
        reviewed migration.

     3. NO CLAIM: the MOST SPECIFIC declared prefix wins, and only that one.
        `CHAR-SWEEP-YOUNG_PRIMARY_V001.png` matches both `CHAR-SWEEP-YOUNG` and
        `CHAR-SWEEP`; the longer declaration is the more specific statement about
        those bytes, so the shorter one does not get them. A tie between two
        entities declaring the identical prefix attributes to NEITHER and is
        reported — a project that cannot say who owns a file must not have an
        answer invented for it.

   Rule 3 is a FALLBACK FOR UNCLAIMED FILES, not an authority rule. It exists
   because a creator may drop a reference into `anchors/` by hand and expect to
   see it; it never overrides a claim and it never makes a file eligible for a
   second entity.

   NOTHING IS MUTATED BY A READ. No candidate row is created, no entity is
   normalised, no claim is repaired. This module answers questions.

   Deliberately absent, and required to stay absent:
     - file or network I/O
     - Date.now(), new Date(), Math.random()
     - any knowledge of directories, URLs or the media ledger's own ids */

/* The entity lists that own a flat media directory each. `audio` is included
   because audio entities carry approved files the same way. */
const OWNED_ENTITY_LISTS = ["characters", "locations", "props", "vehicles", "audio"];

/* Where an entity records a file it owns. Enumerated rather than remembered,
   for the reason P4-SEM-C2 enumerated approval edges: a list that is written
   down cannot quietly miss a member. */
const OWNERSHIP_POINTER_FIELDS = ["approvedFile"];
const OWNERSHIP_SLOT_GROUPS = ["coverageSlots", "expressionSlots"];

function ownershipObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function ownershipText(value) {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}
function ownershipList(value) {
  return Array.isArray(value) ? value : [];
}

/* The prefix an entity DECLARES. Identical to what the shipped lookup read, so
   this module changes which files match and never which prefix an entity has. */
function entityMediaPrefix(entity) {
  const it = ownershipObject(entity);
  return ownershipText(it.prefix || it.anchorPrefix || it.id).toUpperCase();
}

/* Every filename one entity durably records. Order is irrelevant; presence is
   the fact. */
function entityClaimedFileNames(entity) {
  const it = ownershipObject(entity);
  const names = [];
  for (const field of OWNERSHIP_POINTER_FIELDS) if (ownershipText(it[field])) names.push(ownershipText(it[field]));
  for (const state of ownershipList(it.continuityStates)) {
    const file = ownershipText(ownershipObject(state).approvedFile);
    if (file) names.push(file);
  }
  for (const group of OWNERSHIP_SLOT_GROUPS) {
    for (const slot of ownershipList(it[group])) {
      const file = ownershipText(ownershipObject(slot).approvedFile);
      if (file) names.push(file);
    }
  }
  for (const row of ownershipList(it.candidateFiles)) {
    const r = ownershipObject(row);
    const file = ownershipText(r.stored || r.name || r.original);
    if (file) names.push(file);
  }
  const seen = new Set();
  return names.filter((name) => !seen.has(name) && seen.add(name));
}

/* ---------- the index ----------------------------------------------------- */

/* Built once per pass over one list. A resolver that re-scanned every entity for
   every media row would be O(files x entities) inside a render, which is how a
   correctness fix becomes a performance regression. */
function buildEntityOwnerIndex(project, list) {
  const entities = ownershipList(ownershipObject(project)[list]).map(ownershipObject).filter((entity) => ownershipText(entity.id));
  const claims = new Map();      /* file -> entityId */
  const contested = new Map();   /* file -> [entityId] */
  for (const entity of entities) {
    const entityId = ownershipText(entity.id);
    for (const file of entityClaimedFileNames(entity)) {
      const held = claims.get(file);
      if (held === undefined) { claims.set(file, entityId); continue; }
      if (held === entityId) continue;
      const rivals = contested.get(file) || [held];
      if (!rivals.includes(entityId)) rivals.push(entityId);
      contested.set(file, rivals);
    }
  }
  /* Longest declared prefix first, so the first match is the most specific one.
     Ties are kept adjacent so the resolver can see them and refuse. */
  const prefixes = entities
    .map((entity) => ({ entityId: ownershipText(entity.id), prefix: entityMediaPrefix(entity) }))
    .filter((row) => row.prefix)
    .sort((a, b) => b.prefix.length - a.prefix.length || (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0));
  return { list: ownershipText(list), claims, contested, prefixes };
}

/* WHO OWNS THESE BYTES. "" means CineBraid cannot say, which is a legal answer
   and always better than a guess. */
function mediaOwnerId(index, fileName) {
  const idx = ownershipObject(index);
  const name = ownershipText(fileName);
  if (!name) return "";
  const claims = idx.claims instanceof Map ? idx.claims : new Map();
  const contested = idx.contested instanceof Map ? idx.contested : new Map();
  if (!contested.has(name) && claims.has(name)) return claims.get(name);
  const upper = name.toUpperCase();
  const rows = ownershipList(idx.prefixes).filter((row) => upper.startsWith(ownershipText(row.prefix)));
  if (!rows.length) return "";
  const best = rows[0];
  /* A second entity declaring the identical prefix means the project has not
     said who owns this file. Neither gets it. */
  if (rows.some((row) => row.entityId !== best.entityId && ownershipText(row.prefix).length === ownershipText(best.prefix).length)) return "";
  return best.entityId;
}

/* Whether one file is eligible for one entity. THE predicate every surface asks
   — display, review pool, approval, coverage automation, server batch review. */
function entityOwnsMedia(index, entityId, fileName) {
  const wanted = ownershipText(entityId);
  return !!wanted && mediaOwnerId(index, fileName) === wanted;
}

/* The media rows one entity may act on, from a list of `{name}` rows. */
function filterEntityMedia(index, entityId, mediaRows) {
  return ownershipList(mediaRows).filter((row) => entityOwnsMedia(index, entityId, ownershipText(ownershipObject(row).name)));
}

/* The same answer for a bare list of filenames, which is the shape the server's
   directory readers hold. */
function filterEntityFileNames(index, entityId, fileNames) {
  return ownershipList(fileNames).filter((name) => entityOwnsMedia(index, entityId, ownershipText(name)));
}

/* Files two or more entities in this list both record. Reported for a separate,
   reviewed migration; never resolved here, because resolving it would rewrite
   preserved evidence about how the wrong owner was acquired. */
function contestedOwnership(index) {
  const contested = ownershipObject(index).contested;
  if (!(contested instanceof Map)) return [];
  return [...contested.entries()]
    .map(([file, entityIds]) => ({ file, entityIds: [...entityIds].sort(), attributedTo: mediaOwnerId(index, file) }))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/* Every list at once, for a caller that wants one object rather than five. */
function buildProjectOwnerIndexes(project, lists = OWNED_ENTITY_LISTS) {
  const out = {};
  for (const list of ownershipList(lists)) out[list] = buildEntityOwnerIndex(project, list);
  return out;
}

const ENTITY_OWNERSHIP_EXPORTS = {
  OWNED_ENTITY_LISTS,
  OWNERSHIP_POINTER_FIELDS,
  OWNERSHIP_SLOT_GROUPS,
  entityMediaPrefix,
  entityClaimedFileNames,
  buildEntityOwnerIndex,
  buildProjectOwnerIndexes,
  mediaOwnerId,
  entityOwnsMedia,
  filterEntityMedia,
  filterEntityFileNames,
  contestedOwnership,
};

if (typeof window !== "undefined") for (const [key, value] of Object.entries(ENTITY_OWNERSHIP_EXPORTS)) window[key] = value;
if (typeof module !== "undefined" && module.exports) module.exports = ENTITY_OWNERSHIP_EXPORTS;

"use strict";

/* Source-key accounting: the mechanism behind P2's central invariant.

       FOR EVERY MEANINGFUL SOURCE VALUE THERE IS EXACTLY ONE DISPOSITION,
       AND THERE IS NO SIXTH CATEGORY CALLED "WE FORGOT ABOUT IT".

   The five categories are frozen by the phase brief:

     mapped     mapped deterministically into an OFP core field
     preserved  given an explicit legacy/extension home
     dropped    intentionally dropped by a NAMED migration rule
     stated     converted into a statement, dispute or suggestion
     unmapped   reported as unmapped or as an error

   This module does not know what any of them mean. It enumerates the source's
   meaningful leaves up front, hands out claims, and at the end reports what
   nobody claimed. That inversion is the whole point: a migration rule that
   forgets a field cannot make the ledger forget it too, because the ledger was
   built from the source and not from the rules.

   WHAT COUNTS AS A LEAF, and why the edges matter:

     - every scalar (string, number, boolean, null) is a leaf. `null` is a leaf
       because "the slot exists and was never set" is a production fact that
       must be disposed of, not skipped;
     - an EMPTY array or object is a leaf. `"clips": []` is a deliberate empty
       collection and a migration that silently loses it has lost the fact that
       the collection was there at all (P0 serialization rule 10 depends on the
       same distinction);
     - a NON-empty container is not a leaf - its children are. Claiming the
       container claims the subtree, which is how a rule preserves or drops a
       whole block in one call without enumerating it.

   An ABSENT key produces no leaf, which is exactly right: absence is not a
   value, so there is nothing to dispose of. That is the difference between
   fixture case 16's `null` and its missing sibling. */

const DISPOSITION = {
  MAPPED: "mapped",
  PRESERVED: "preserved",
  DROPPED: "dropped",
  STATED: "stated",
  UNMAPPED: "unmapped",
};

const DISPOSITIONS = Object.values(DISPOSITION);

/* RFC 6901 encoding, so a claim key and a diagnostic location are the same
   string and can be compared without normalising either. */
function encodePointerToken(token) {
  return String(token).replace(/~/g, "~0").replace(/\//g, "~1");
}

function pointerJoin(pointer, token) {
  return `${pointer}/${encodePointerToken(token)}`;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/* Enumerate every meaningful leaf of `value`, in document order. Document order
   rather than sorted order because the report reads better and because the
   source is positional - a reviewer looking at `/shots/3/dur` wants shot 3's
   other findings nearby. */
function enumerateLeaves(value, pointer = "", out = []) {
  if (Array.isArray(value)) {
    if (value.length === 0) { out.push(pointer); return out; }
    for (let index = 0; index < value.length; index++) enumerateLeaves(value[index], pointerJoin(pointer, index), out);
    return out;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) { out.push(pointer); return out; }
    for (const key of keys) enumerateLeaves(value[key], pointerJoin(pointer, key), out);
    return out;
  }
  out.push(pointer);
  return out;
}

function readPointer(document, pointer) {
  if (pointer === "") return document;
  let current = document;
  for (const raw of pointer.slice(1).split("/")) {
    const token = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (current === null || typeof current !== "object") return undefined;
    current = Array.isArray(current) ? current[Number(token)] : current[token];
  }
  return current;
}

class SourceLedger {
  constructor(document) {
    this.document = document;
    /* The obligation list, fixed at construction. Nothing added later. */
    this.leaves = enumerateLeaves(document, "");
    this.leafSet = new Set(this.leaves);
    /* pointer -> [claim]. An array because a source value legitimately reaches
       more than one place: `dur` is mapped to duration.seconds AND, when the
       aliases disagree, becomes a disputed statement. Both are true and both
       must be visible. */
    this.claims = new Map();
  }

  /* Claim one source pointer.

       pointer     RFC 6901 into the SOURCE document. May name a leaf or a
                   whole subtree; a subtree claim covers every leaf beneath it.
       rule        the migration rule ID responsible. Required - a disposition
                   with no rule is exactly the anonymous loss this exists to end.
       disposition one of the five.
       targets     OFP destinations, as subject#path display strings. Empty for
                   `dropped`.
       note        why, in one sentence, for a human reading the report. */
  claim(pointer, { rule, disposition, targets = [], note = "" }) {
    if (typeof pointer !== "string") throw new TypeError("claim requires a JSON pointer string");
    if (!rule) throw new TypeError(`claim of ${pointer} names no migration rule`);
    if (!DISPOSITIONS.includes(disposition)) throw new TypeError(`unknown disposition ${JSON.stringify(disposition)} for ${pointer}`);
    /* A CLAIM NAMES A LEAF. Never a container.

       This is the mechanism, and it exists because the alternative was a real
       hole: a rule claiming a record's own pointer - `/shots/0`, to record that
       an ordinal came from the array position - would have counted as covering
       every leaf beneath it, and the accounting for that whole shot would have
       been satisfied by one call that inspected nothing. Rules that genuinely
       dispose of a whole block use `claimSubtree`, which claims each leaf
       individually and can therefore say what was inside it. */
    if (!this.leafSet.has(pointer))
      throw new TypeError(`${rule} claimed ${JSON.stringify(pointer)}, which is not a source leaf. Claim a leaf, or use claimSubtree to dispose of a whole block one value at a time.`);
    const entry = { pointer, rule, disposition, targets: [...targets], note };
    const existing = this.claims.get(pointer);
    if (existing) existing.push(entry);
    else this.claims.set(pointer, [entry]);
    return entry;
  }

  /* Claim every leaf under `pointer` individually, so the report can say what
     was inside a preserved or dropped block rather than only that a block went
     somewhere. Used by the bulk rules (M051, M052, M070). */
  claimSubtree(pointer, options) {
    const value = readPointer(this.document, pointer);
    const leaves = enumerateLeaves(value, pointer);
    for (const leaf of leaves) this.claim(leaf, options);
    return leaves.length;
  }

  has(pointer) {
    return this.claims.has(pointer);
  }

  /* Every leaf nobody claimed. A pure set difference, because every claim is a
     leaf claim - which is what makes this the no-silent-loss proof rather than a
     statement of intent. It is computed, never asserted. */
  unaccounted() {
    return this.leaves.filter((leaf) => !this.claims.has(leaf));
  }

  countsByDisposition() {
    const counts = Object.fromEntries(DISPOSITIONS.map((name) => [name, 0]));
    for (const entries of this.claims.values()) for (const entry of entries) counts[entry.disposition]++;
    return counts;
  }

  countsByRule() {
    const counts = {};
    for (const entries of this.claims.values())
      for (const entry of entries) counts[entry.rule] = (counts[entry.rule] || 0) + 1;
    return counts;
  }

  /* The accounting table, sorted by source pointer so two runs over the same
     input produce the same rows in the same order. */
  entries() {
    const rows = [];
    for (const entries of this.claims.values()) rows.push(...entries);
    rows.sort((a, b) => (a.pointer === b.pointer
      ? (a.rule === b.rule ? (a.disposition < b.disposition ? -1 : a.disposition > b.disposition ? 1 : 0) : (a.rule < b.rule ? -1 : 1))
      : (a.pointer < b.pointer ? -1 : 1)));
    return rows;
  }

  /* `value` is included so the report can answer "what was in the field?"
     without the reader going back to the source. Truncated, because a preserved
     prose block should not make the report the size of the project. */
  describe(pointer) {
    const value = readPointer(this.document, pointer);
    if (value === undefined) return undefined;
    const rendered = JSON.stringify(value);
    if (rendered === undefined) return undefined;
    return rendered.length <= 160 ? rendered : `${rendered.slice(0, 159)}…`;
  }
}

module.exports = {
  DISPOSITION,
  DISPOSITIONS,
  SourceLedger,
  enumerateLeaves,
  readPointer,
  pointerJoin,
  encodePointerToken,
};

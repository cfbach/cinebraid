"use strict";

/* Identifier rules, and the deterministic minting rule migration will need.

   Two tiers, because one tier cannot hold both requirements at once (P0 §3):

   FLOOR (error)     non-empty, NFC-normalized, no ":" "/" "#", no whitespace,
                     no C0/C1 controls. These are the subject grammar's own
                     delimiters - an ID containing one is unaddressable, so this
                     is a structural limit rather than a style preference.

   id-portable (warning)  ^[A-Za-z0-9._-]+$

   The gap between them is not an accident. Five real legacy shot IDs look like
   `INT-1->2`: they satisfy the floor, so they round-trip verbatim and migration
   never renames them, and they fail the profile, so they get reported. The
   report is worth having on its own - ">" is illegal in a Windows path segment
   and shot IDs are directory names today, so those shots have never been able
   to hold a take on this platform. */

const { sha256Hex, canonicalJson } = require("../public/shared-continuity");

const ID_PORTABLE_PATTERN = /^[A-Za-z0-9._-]+$/;

/* The delimiters of the subject grammar (`type:id` steps joined by "/") plus
   the display notation's "#" separator. An ID containing any of them could not
   be parsed back out of a target string. */
const ID_RESERVED_CHARACTERS = [":", "/", "#"];

function describeCodePoint(character) {
  return `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
}

/* Returns { ok, reason } - `reason` is a sentence fragment for a diagnostic
   message, never a repair instruction. Nothing in P1 renames anything. */
function checkIdentifierFloor(id) {
  if (typeof id !== "string") return { ok: false, reason: `identifier must be a string, got ${id === null ? "null" : typeof id}` };
  if (id.length === 0) return { ok: false, reason: "identifier is empty" };
  if (id.normalize("NFC") !== id) return { ok: false, reason: "identifier is not NFC-normalized" };
  for (const character of ID_RESERVED_CHARACTERS)
    if (id.includes(character)) return { ok: false, reason: `identifier contains the reserved delimiter ${JSON.stringify(character)}` };
  for (const character of id) {
    const code = character.codePointAt(0);
    /* C0, DEL and C1. Whitespace beyond U+0020 is caught here too; the space
       itself and the Unicode spaces are caught by the explicit test below. */
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f))
      return { ok: false, reason: `identifier contains the control character ${describeCodePoint(character)}` };
    if (/\s/u.test(character))
      return { ok: false, reason: `identifier contains whitespace (${describeCodePoint(character)})` };
  }
  return { ok: true, reason: "" };
}

function isIdentifierPortable(id) {
  return typeof id === "string" && ID_PORTABLE_PATTERN.test(id);
}

/* ---- deterministic ID minting -------------------------------------------

   P0 §N2, measured: 32 nested records in a real legacy generation have an empty
   `id`. They cannot be statement subjects until they have one, and migration is
   where they get one.

   The rule, and it is the whole rule:

       Array position may be used to MINT an identity exactly once.
       Array position may never BE an identity.

   So minting reads the position, and the result is then stored and is stable
   for the rest of the record's life. Reordering the array afterwards changes
   nothing, because `mintNestedIdentifiers` never touches a record that already
   has an ID. That property is what the negative control checks.

   Determinism is required because migration must be re-runnable: the same
   legacy input must always produce the same IDs. Nothing here reads a clock or
   a random source. When a positional stem collides with an ID already present,
   the disambiguator is derived from a hash of the mint inputs rather than from
   a counter, so it does not depend on how many records happened to be visited
   first.

   P1 defines and tests this. P1 does not migrate anything. */

const MINT_HASH_LENGTH = 8;

function mintDigest(inputs) {
  return sha256Hex(canonicalJson({ ofp: "mint/1", ...inputs })).slice(0, MINT_HASH_LENGTH);
}

/* `parentSubject` is the subject-ref of the containing record ("shot:sh-0100"),
   or "" at the document root. `type` is the containment-table type of the
   record being minted ("frame", "state", ...). */
function mintNestedIdentifier({ type, parentSubject = "", index, taken = new Set() }) {
  if (typeof type !== "string" || !type) throw new TypeError("mintNestedIdentifier requires a type");
  if (!Number.isInteger(index) || index < 0) throw new TypeError("mintNestedIdentifier requires a non-negative integer index");
  const parentStem = parentSubject ? parentSubject.split("/").pop().split(":").pop() : "root";
  const base = `${type}-${parentStem}-${String(index + 1).padStart(4, "0")}`;
  if (!taken.has(base)) return base;
  /* A collision means the legacy document already uses the readable form for
     something else. Fall back to a content-addressed suffix, which is stable
     for the same inputs and cannot collide with the positional form. */
  const disambiguated = `${base}-${mintDigest({ type, parentSubject, index })}`;
  if (!taken.has(disambiguated)) return disambiguated;
  throw new Error(`unable to mint a unique identifier for ${type} #${index} under ${parentSubject || "the document root"}`);
}

/* Mint IDs for every record in `records` that lacks one, leaving the rest
   untouched. Returns a report rather than mutating in place, because P1 is
   report-only and a caller that wants the mutation should be the one to make it.

   `[{ index, mintedId }]` - one entry per record that needed an ID. */
function mintNestedIdentifiers(records, { type, parentSubject = "" }) {
  if (!Array.isArray(records)) return [];
  const taken = new Set();
  for (const record of records)
    if (record && typeof record === "object" && typeof record.id === "string" && record.id) taken.add(record.id);
  const minted = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (!record || typeof record !== "object" || Array.isArray(record)) continue;
    if (typeof record.id === "string" && record.id) continue;
    const mintedId = mintNestedIdentifier({ type, parentSubject, index, taken });
    taken.add(mintedId);
    minted.push({ index, mintedId });
  }
  return minted;
}

module.exports = {
  ID_PORTABLE_PATTERN,
  ID_RESERVED_CHARACTERS,
  checkIdentifierFloor,
  isIdentifierPortable,
  mintNestedIdentifier,
  mintNestedIdentifiers,
};

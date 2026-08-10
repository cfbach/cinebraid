"use strict";

/* Claim / value binding.

       claimPayload := { "ofp": "claim/1", "t": <target string>, "v": <value> }
       claim.hash   := "sha256:" + lowercase-hex( sha256( utf8( JCS(payload) ) ) )

   Two details carry the whole mechanism.

   THE TARGET IS INSIDE THE HASH. Without it, an approval of
   `framing.size = "wide"` could be retargeted to `framing.angle` and still
   verify, because that field also holds "wide". Including the target string
   costs one key and makes hash equality across different fields meaningless,
   which is exactly what is wanted.

   `v` IS OMITTED, NEVER SET TO undefined, when the target resolves to nothing.
   `canonicalJson` maps undefined to "null" - a reasonable choice for the
   continuity manifest it was written for, and a silent catastrophe here, since
   "the key is absent" and "the key is present and null" would hash identically.
   Those are two different production facts (P0 §5: not applicable versus never
   set), and the format exists in part to keep them apart. So the payload is
   built by key omission and the helper is reused only to hash it. */

const { sha256Hex, canonicalJson } = require("../public/shared-continuity");
const { ABSENT, formatTargetString, resolveTarget } = require("./ofp-target");

const CLAIM_PAYLOAD_VERSION = "claim/1";
const CLAIM_PREVIEW_MAX_LENGTH = 120;

/* `value` is either a JSON value or the ABSENT sentinel. Callers that have a
   resolution result should pass `result.value` straight through. */
function buildClaimPayload(targetString, value) {
  const payload = { ofp: CLAIM_PAYLOAD_VERSION, t: targetString };
  /* The omission. Assigning `undefined` here would produce the same object
     shape to a casual reader and the wrong hash to every reader. */
  if (value !== ABSENT) payload.v = value;
  return payload;
}

/* RFC 8785 canonicalization of the payload. Kept as its own function so tests
   can assert the exact bytes that get hashed, rather than only the digest. */
function claimPayloadJcs(payload) {
  return canonicalJson(payload);
}

function computeClaimHash(targetString, value) {
  return `sha256:${sha256Hex(claimPayloadJcs(buildClaimPayload(targetString, value)))}`;
}

/* Recompute the hash a statement's claim SHOULD have, given the document as it
   stands now. Returns { ok: false, code, reason } when the target does not
   resolve - staleness is only meaningful for a target that still exists. */
function computeClaimHashForTarget(document, target) {
  const resolution = resolveTarget(document, target);
  if (!resolution.ok) return resolution;
  return {
    ok: true,
    hash: computeClaimHash(resolution.targetString, resolution.value),
    present: resolution.present,
    value: resolution.value,
    targetString: resolution.targetString,
  };
}

/* A short human rendering, advisory only, never compared and never recomputed
   on save. P0 INV-R3 rule 3: recomputing it would let a change to this
   formatter rewrite every file in a project. Provided so fixtures and future
   writers have one implementation rather than several. */
function buildClaimPreview(value) {
  if (value === ABSENT) return "";
  const rendered = typeof value === "string" ? value : canonicalJson(value);
  return rendered.length <= CLAIM_PREVIEW_MAX_LENGTH ? rendered : `${rendered.slice(0, CLAIM_PREVIEW_MAX_LENGTH - 1)}…`;
}

module.exports = {
  CLAIM_PAYLOAD_VERSION,
  CLAIM_PREVIEW_MAX_LENGTH,
  buildClaimPayload,
  claimPayloadJcs,
  computeClaimHash,
  computeClaimHashForTarget,
  buildClaimPreview,
  formatTargetString,
};

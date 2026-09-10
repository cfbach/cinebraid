/* CineBraid MediaAsset lifecycle — a projection, never authority.
 *
 * Phase 2 reads the approval state the product already keeps and reports it. It
 * decides nothing and writes nothing, which is what makes a ledger safe to
 * introduce beside a mature approval workflow: a projection cannot corrupt what it
 * projects.
 *
 * Two dialect hazards drive most of what follows. Entity rows carry their own
 * decision vocabulary — approved-reference, approved-sheet-source,
 * approved-coverage, approved-expression — and public/review-provenance.js coerces
 * any unrecognised decision back to "unreviewed", so routing an entity row through
 * candidateRecord() would silently downgrade every approved entity reference. And
 * `approved` needs a LIVE pointer: supersede deletes approvedAt, but a stale
 * timestamp can survive elsewhere, so a timestamp alone is not evidence.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const A = require("../src/media/media-assets");

const ROOT = path.join(__dirname, "..");

/* ---- 1. the vocabulary ---- */
assert.deepStrictEqual(A.ASSET_LIFECYCLES, ["candidate", "approved", "rejected", "dismissed", "superseded"]);
for (const terminal of A.TERMINAL_LIFECYCLES)
  assert(A.ASSET_LIFECYCLES.includes(terminal), `${terminal} must be a lifecycle`);
assert(!A.TERMINAL_LIFECYCLES.includes("approved"), "approved is not terminal — it can be superseded");

/* ---- 2. shot candidates ---- */
const WINNER = "SC-01-01_FRAME_A_FAL_1.png";
const OTHER = "SC-01-01_FRAME_A_FAL_2.png";

assert.strictEqual(
  A.deriveLifecycle({ stored: WINNER, decision: "unreviewed" }, { winners: [WINNER] }),
  "approved", "a row a winner field points at is approved");
assert.strictEqual(
  A.deriveLifecycle({ stored: OTHER, decision: "unreviewed" }, { winners: [WINNER] }),
  "candidate", "an unreferenced row is a candidate");
assert.strictEqual(
  A.deriveLifecycle({ stored: OTHER, decision: "rejected" }, { winners: [WINNER] }),
  "rejected", "an explicitly rejected row is rejected");
assert.strictEqual(
  A.deriveLifecycle({ stored: WINNER, replacedAt: "2026-08-08T00:00:00Z", replacedBy: OTHER }, { winners: [OTHER] }),
  "superseded", "a replaced row is superseded");

/* approved requires a LIVE pointer. An approvedAt with nothing pointing at the row
   is exactly the stale state supersede leaves behind. */
assert.strictEqual(
  A.deriveLifecycle({ stored: WINNER, approvedAt: "2026-08-08T00:00:00Z" }, { winners: [] }),
  "candidate", "an approvedAt timestamp alone is NOT approval");
assert.strictEqual(
  A.deriveLifecycle({ stored: WINNER, approvedAt: "2026-08-08T00:00:00Z" }, { winners: [OTHER] }),
  "candidate", "nor is one while a different row holds the pointer");

/* Supersede is checked before approval, because a replaced row may still carry a
   stale approval timestamp. */
assert.strictEqual(
  A.deriveLifecycle({ stored: WINNER, approvedAt: "t", replacedAt: "t" }, { winners: [WINNER] }),
  "superseded", "replacement wins over a surviving pointer");

/* ---- 3. entity candidates keep their own vocabulary ---- */
const ENTITY_KEY = "CHAR-KAI_FAL_CANDIDATE_1.png";
for (const decision of ["approved-reference", "approved-sheet-source", "approved-coverage", "approved-expression"]) {
  assert.strictEqual(
    A.deriveLifecycle({ stored: ENTITY_KEY, decision }, { dialect: "entity-candidate", approvedPointers: [ENTITY_KEY] }),
    "approved", `${decision} with a live pointer is approved`);
  assert.strictEqual(
    A.deriveLifecycle({ stored: ENTITY_KEY, decision }, { dialect: "entity-candidate", approvedPointers: [] }),
    "approved", `${decision} is preserved, never coerced to unreviewed`);
}
assert.strictEqual(
  A.deriveLifecycle({ stored: ENTITY_KEY, decision: "unreviewed" }, { dialect: "entity-candidate", approvedPointers: [] }),
  "candidate");
assert.strictEqual(
  A.deriveLifecycle({ stored: ENTITY_KEY, decision: "rejected" }, { dialect: "entity-candidate", approvedPointers: [] }),
  "rejected");
/* An entity row whose approved decision is no longer the one pointed at. */
assert.strictEqual(
  A.deriveLifecycle({ stored: ENTITY_KEY, decision: "approved-reference" },
    { dialect: "entity-candidate", approvedPointers: ["CHAR-KAI_FAL_CANDIDATE_9.png"] }),
  "superseded", "an approved entity row displaced by another is superseded");

/* The dialects genuinely differ — the same row reads differently under each, which
   is exactly why one normaliser cannot serve both. */
const shared = { stored: ENTITY_KEY, decision: "approved-reference" };
assert.notStrictEqual(
  A.deriveLifecycle(shared, { dialect: "entity-candidate", approvedPointers: [] }),
  A.deriveLifecycle(shared, { winners: [] }),
  "an entity decision must not be read with the shot dialect",
);

/* ---- 4. library entries (blocking guides) ---- */
assert.strictEqual(A.deriveLifecycle({ stored: "b.png" }, { dialect: "library-entry", active: true }), "approved");
assert.strictEqual(A.deriveLifecycle({ stored: "b.png" }, { dialect: "library-entry", active: false }), "candidate");

/* ---- 5. dismissed is expressible, and rejected is not the same thing ----
   rejected is a negative quality judgement and is evidence. dismissed means "fine,
   not needed" — a duplicate angle, an overshoot. Conflating them poisons the review
   record with false negatives. Phase 2 can PROJECT dismissed; nothing writes it. */
assert(A.ASSET_LIFECYCLES.includes("dismissed"));
assert.strictEqual(
  A.deriveLifecycle({ stored: OTHER, dismissedAt: "2026-08-08T00:00:00Z" }, { winners: [WINNER] }),
  "dismissed");
assert.notStrictEqual(
  A.deriveLifecycle({ stored: OTHER, dismissedAt: "t" }, { winners: [] }),
  A.deriveLifecycle({ stored: OTHER, decision: "rejected" }, { winners: [] }),
  "dismissed and rejected must remain distinguishable",
);
/* No writer for dismissedAt exists in Phase 2a — adding one would be a new user
   action, which is a behaviour change. */
const productionSources = ["src/media/media-assets.js", "src/media/media-asset-store.js", "src/media/media-hash.js"]
  .map((name) => fs.readFileSync(path.join(ROOT, name), "utf8")).join("\n");
assert(
  !/dismissedAt\s*[=:]\s*(?!null)/.test(productionSources.replace(/\/\*[\s\S]*?\*\//g, "")),
  "Phase 2a must not write dismissedAt anywhere",
);

/* ---- 6. lifecycle does not depend on the hash ----
   An unhashed asset must project exactly as a hashed one does; otherwise a
   cloud-synced project would show different approval state than a local one. */
for (const hashState of A.HASH_STATES) {
  assert.strictEqual(
    A.deriveLifecycle({ stored: WINNER, hashState }, { winners: [WINNER] }),
    "approved", `lifecycle is independent of hashState (${hashState})`);
}

/* ---- 7. it is pure: no mutation, no I/O, deterministic ---- */
const row = { stored: WINNER, decision: "unreviewed", approvedAt: "t" };
const snapshot = JSON.stringify(row);
const context = { winners: [WINNER] };
const contextSnapshot = JSON.stringify(context);
const first = A.deriveLifecycle(row, context);
const second = A.deriveLifecycle(row, context);
assert.strictEqual(first, second, "deterministic for identical input");
assert.strictEqual(JSON.stringify(row), snapshot, "the row must not be mutated");
assert.strictEqual(JSON.stringify(context), contextSnapshot, "the context must not be mutated");
assert.strictEqual(A.deriveLifecycle(null, {}), "candidate", "a missing row degrades rather than throwing");
assert.strictEqual(A.deriveLifecycle({}, {}), "candidate", "an empty row degrades");

console.log(
  "Asset lifecycle suite passed: all five states project per dialect, approved requires a live pointer rather than "
  + "a stale timestamp, entity decision vocabulary is preserved rather than coerced, dismissed and rejected stay "
  + "distinct with no writer for dismissedAt, lifecycle is independent of hash state, and the projection is pure.",
);

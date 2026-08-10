"use strict";

/* Statements: five acts, and two states that are computed every time and
   written down never.

   A statement is a record of an ACT, by an actor, at a time, about one
   addressable claim. It is not a status of a value and it is not a wrapper on
   one. That reframing is what collapses "where did this come from" and "who
   decided it" into a single verb enum: a disposition IS an act, and an act
   already names its actor.

   Derived state, per statement:

       target does not resolve                  -> "unresolvable"
       recomputed claim hash != stored hash     -> "stale"
       otherwise                                -> "current"

   Same discipline continuity already earns: intent is stored, observation is
   stored, the finding is always computed. Evidence gets the same rule, so
   nothing here is ever written back into a document. */

const { computeClaimHashForTarget } = require("./ofp-claim");
const { formatTargetString } = require("./ofp-target");

const STATEMENT_KINDS = ["cited", "suggested", "observed", "approved", "disputed"];
const ACTOR_KINDS = ["human", "model", "tool", "source"];

const STATEMENT_STATES = { CURRENT: "current", STALE: "stale", UNRESOLVABLE: "unresolvable" };

/* The filmmaker-facing words live here rather than in any renderer. A view
   asking "is this approved?" and choosing its own noun is how two parts of the
   product end up disagreeing about what the data means. */
const BADGES = {
  CONFLICT: "conflict",
  APPROVED: "approved",
  CITED: "cited",
  SUGGESTED: "suggested",
  OBSERVED: "observed",
  AUTHORED: "authored",
};
const BADGE_LABELS = {
  [BADGES.CONFLICT]: "Conflict",
  [BADGES.APPROVED]: "Approved",
  [BADGES.CITED]: "From script",
  [BADGES.SUGGESTED]: "Suggested",
  [BADGES.OBSERVED]: "Observed",
  [BADGES.AUTHORED]: "Authored",
};

/* Precedence for the fold, highest first, exactly as frozen. `authored` is not
   in the list because it is the absence of any current statement - the common
   case, which costs zero bytes and is what keeps statements[] sparse. */
const BADGE_PRECEDENCE = [
  { kind: "disputed", badge: BADGES.CONFLICT },
  { kind: "approved", badge: BADGES.APPROVED },
  { kind: "cited", badge: BADGES.CITED },
  { kind: "suggested", badge: BADGES.SUGGESTED },
  { kind: "observed", badge: BADGES.OBSERVED },
];

/* Returns { state, reason, expectedHash?, storedHash? }. Never mutates
   `document` or `statement`, and never stores what it computed. */
function deriveStatementState(document, statement) {
  if (!statement || typeof statement !== "object")
    return { state: STATEMENT_STATES.UNRESOLVABLE, reason: "statement is not an object" };

  const recomputed = computeClaimHashForTarget(document, statement.target);
  if (!recomputed.ok)
    return {
      state: STATEMENT_STATES.UNRESOLVABLE,
      /* "array-traversal" and "malformed" are reported by the validator under
         their own codes; the derived state collapses them all to unresolvable,
         because none of them can be checked for staleness. */
      reason: recomputed.reason,
      resolutionCode: recomputed.code,
    };

  const stored = statement.claim && typeof statement.claim === "object" ? statement.claim.hash : undefined;
  if (stored !== recomputed.hash)
    return {
      state: STATEMENT_STATES.STALE,
      reason: "the value bound by this statement has changed since the statement was made",
      expectedHash: recomputed.hash,
      storedHash: typeof stored === "string" ? stored : null,
    };

  return { state: STATEMENT_STATES.CURRENT, reason: "", expectedHash: recomputed.hash, storedHash: stored };
}

function statementTargetKey(statement) {
  return formatTargetString(statement && statement.target);
}

/* Fold the statements bearing on one target into the badge a filmmaker sees.

   Stale and unresolvable statements are excluded before the fold, which is
   where the single most important rule in the contract lives:

       A STALE `approved` CONFERS NO APPROVAL.

   It is not dropped, hidden or repaired - the validator still reports it, and a
   view is expected to say "approved 3 Aug, for a value that has since changed"
   rather than going quiet. It simply stops counting as approval, because it is
   an approval of something nobody has now.

   Within one kind the newest `at` wins, which is how supersession is derived
   without a `superseded` kind existing. */
function deriveTargetBadge(document, statements, target) {
  const key = formatTargetString(target);
  const current = [];
  for (const statement of Array.isArray(statements) ? statements : []) {
    if (statementTargetKey(statement) !== key) continue;
    const derived = deriveStatementState(document, statement);
    if (derived.state === STATEMENT_STATES.CURRENT) current.push(statement);
  }
  for (const { kind, badge } of BADGE_PRECEDENCE) {
    const matching = current.filter((statement) => statement.kind === kind);
    if (!matching.length) continue;
    const newest = matching.reduce((best, statement) => (String(statement.at) > String(best.at) ? statement : best));
    return { badge, label: BADGE_LABELS[badge], statementId: newest.id, at: newest.at };
  }
  return { badge: BADGES.AUTHORED, label: BADGE_LABELS[BADGES.AUTHORED], statementId: null, at: null };
}

module.exports = {
  STATEMENT_KINDS,
  ACTOR_KINDS,
  STATEMENT_STATES,
  BADGES,
  BADGE_LABELS,
  BADGE_PRECEDENCE,
  deriveStatementState,
  deriveTargetBadge,
  statementTargetKey,
};

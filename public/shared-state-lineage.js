/* CINEBRAID — CONTINUITY-STATE LINEAGE. Acyclic, and never rewritten by
   navigation.

   Browser and Node, the same way public/shared-continuity-binding.js is shared.

   ---------------------------------------------------------------------------
   THE DEFECT THIS ENDS (Dogfood #2 A6 / forensic F5).

   "Approve & edit <state>" offered the next state by ROTATING CYCLICALLY through
   the entity's whole state list:

       [...states.slice(index + 1), ...states.slice(0, index)]

   That is not a lineage traversal. It is a ring, so after approving the final
   descendant it wraps round and offers an already-approved ANCESTOR, with copy
   saying the ancestor would derive from the state just approved. The creator saw
   the inheritance direction presented backwards.

   Worse than the copy, and the reason this is P0 rather than P1: accepting the
   offer executed

       nextState.parentStateId = targetStateId;

   unconditionally. Choosing the offered ancestor REPARENTS AN ANCESTOR BENEATH
   ITS OWN DESCENDANT and closes a cycle in the derivation graph. Every later
   question that walks lineage — which parent must be approved first, what does
   this state inherit, is this chain complete — then has no answer, or loops.

   ---------------------------------------------------------------------------
   THE RULES.

     1. NAVIGATION NEVER MUTATES LINEAGE. Choosing what to edit next is a
        movement, not a declaration. An existing parent edge is never rewritten
        because a creator pressed a continue button.
     2. THE GRAPH IS ACYCLIC. Every write that could close a cycle is refused at
        the writer, not detected afterwards.
     3. ANCESTORS ARE NEVER CONTINUATION CANDIDATES. A state you derived FROM is
        not a state to continue INTO.
     4. A FINISHED CHAIN STOPS. When nothing downstream still needs work the
        answer is "complete", not "start again at the root".

   THE DEFAULT STATE IS THE ROOT. It has no parent and must never acquire one;
   entityStateList() already normalises `parentStateId` to "" for it.

   NOTHING IS MUTATED BY A READ. Every function here takes a state collection and
   returns values. The one function that describes a WRITE — `safeParentAssignment`
   — returns a decision the caller applies, so the refusal and the write cannot
   drift apart.

   Deliberately absent, and required to stay absent:
     - file or network I/O
     - Date.now(), new Date(), Math.random()
     - any mutation of the states passed in
     - UI wording. `kind` values below are TOKENS. */

/* What a continuation can conclude. Two words, because there are two outcomes
   and "wrap around to the root" was never one of them. */
const LINEAGE_CONTINUATION_KINDS = ["continue", "complete"];

function lineageObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function lineageText(value) {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}
function lineageList(value) {
  return Array.isArray(value) ? value : [];
}

/* The states, as records with the two fields lineage is made of. Copies, so a
   caller cannot reach the project record through this module. */
function lineageNodes(states) {
  return lineageList(states)
    .map(lineageObject)
    .filter((state) => lineageText(state.id))
    .map((state) => ({
      id: lineageText(state.id),
      parentStateId: lineageText(state.parentStateId),
      isDefault: state.isDefault === true,
      approvedFile: lineageText(state.approvedFile),
      name: lineageText(state.name),
    }));
}

function lineageNode(states, stateId) {
  const wanted = lineageText(stateId);
  return lineageNodes(states).find((state) => state.id === wanted) || null;
}

/* ---------- reading the graph --------------------------------------------- */

/* Walk to the root. CYCLE-SAFE BY CONSTRUCTION: a `seen` set, because this
   function has to answer correctly about a project that ALREADY carries a cycle
   written by the shipped defect. Stopping at the repeat rather than throwing is
   deliberate — a reader that crashes on damaged data cannot be used to report
   the damage. */
function stateAncestorIds(states, stateId) {
  const nodes = lineageNodes(states);
  const byId = new Map(nodes.map((state) => [state.id, state]));
  const out = [];
  const seen = new Set([lineageText(stateId)]);
  let current = byId.get(lineageText(stateId));
  while (current && current.parentStateId && !seen.has(current.parentStateId)) {
    seen.add(current.parentStateId);
    out.push(current.parentStateId);
    current = byId.get(current.parentStateId);
  }
  return out;
}

/* Everything below a state, breadth-first. Also cycle-safe. */
function stateDescendantIds(states, stateId) {
  const nodes = lineageNodes(states);
  const out = [];
  const seen = new Set([lineageText(stateId)]);
  let frontier = [lineageText(stateId)];
  while (frontier.length) {
    const next = [];
    for (const parentId of frontier) {
      for (const state of nodes) {
        if (state.parentStateId !== parentId || seen.has(state.id)) continue;
        seen.add(state.id);
        out.push(state.id);
        next.push(state.id);
      }
    }
    frontier = next;
  }
  return out;
}

/* Every cycle the collection currently contains, as the ids caught in it. Empty
   is the only acceptable answer for a healthy project, and this is what the
   regression test asserts after every lineage-touching operation. */
function lineageCycles(states) {
  const nodes = lineageNodes(states);
  const byId = new Map(nodes.map((state) => [state.id, state]));
  const cycles = [];
  const settled = new Set();
  for (const start of nodes) {
    if (settled.has(start.id)) continue;
    const path = [];
    const onPath = new Set();
    let current = start;
    while (current && !settled.has(current.id)) {
      if (onPath.has(current.id)) {
        const cycle = path.slice(path.indexOf(current.id)).sort();
        if (!cycles.some((existing) => existing.join("|") === cycle.join("|"))) cycles.push(cycle);
        break;
      }
      path.push(current.id);
      onPath.add(current.id);
      current = current.parentStateId ? byId.get(current.parentStateId) : null;
    }
    for (const id of path) settled.add(id);
  }
  return cycles;
}

function lineageIsAcyclic(states) {
  return lineageCycles(states).length === 0;
}

/* ---------- the write decision -------------------------------------------- */

/* ==========================================================================
   BATCH 1B — ONE MUTATION API, AND NAVIGATION IS NOT ONE OF ITS CALLERS.

   The acceptance audit found two things the first repair left standing.

   First, the invariant said "navigation never mutates lineage" and the code
   said "navigation may establish a FIRST parent". Those are different rules.
   The audit offered an orphan state as a continuation target and watched it
   acquire a parent from a button whose entire meaning is "open this next". A
   partial exemption to a categorical rule is not a weaker rule, it is a
   different rule with the old name on it.

   Second, and worse: the exposed parent dropdown in the creation studio listed
   every state except the current one — descendants included — and its change
   handler executed `state[key] = value` directly. The validated helper existed
   and had exactly one production caller. A validator nothing has to call is
   documentation.

   So there are two intents now, and only one of them can write:

     "navigation"            -> NEVER writes. Not a first parent, not anything.
     "explicit-lineage-edit" -> may write, and is validated against the graph
                                THAT WOULD RESULT, not the one that exists.

   And `applyStateParentMutation` is the only function in CineBraid that assigns
   `parentStateId`. Everything else asks it. */

const LINEAGE_MUTATION_INTENTS = ["navigation", "explicit-lineage-edit"];

/* Every reason a mutation can be refused, enumerated so a surface can switch on
   one rather than matching prose. */
const LINEAGE_MUTATION_REASONS = [
  "unknown-state", "default-state-is-the-root", "invalid-parent", "unknown-parent",
  "would-create-cycle", "navigation-may-not-reparent", "already-declared",
  "establishing-first-parent", "reparented", "graph-would-be-cyclic",
];

/* THE ONLY DESCRIPTION OF A LINEAGE WRITE. Returns a decision rather than
   performing one, so the caller's refusal path and the rule are the same code. */
function planParentMutation(states, childStateId, proposedParentId, options = {}) {
  const opts = lineageObject(options);
  const intent = LINEAGE_MUTATION_INTENTS.includes(lineageText(opts.intent)) ? lineageText(opts.intent) : "navigation";
  const childId = lineageText(childStateId);
  const parentId = lineageText(proposedParentId);
  const child = lineageNode(states, childId);
  if (!child) return { write: false, intent, parentStateId: "", reason: "unknown-state" };
  if (child.isDefault) return { write: false, intent, parentStateId: "", reason: "default-state-is-the-root" };
  if (!parentId || parentId === childId) return { write: false, intent, parentStateId: "", reason: "invalid-parent" };
  if (!lineageNode(states, parentId)) return { write: false, intent, parentStateId: "", reason: "unknown-parent" };
  /* RULE 2, at the writer. The proposed parent living below the child is exactly
     the ancestor-beneath-descendant move that closed the dogfood cycle. */
  if (stateAncestorIds(states, parentId).includes(childId)) return { write: false, intent, parentStateId: "", reason: "would-create-cycle" };
  if (stateDescendantIds(states, childId).includes(parentId)) return { write: false, intent, parentStateId: "", reason: "would-create-cycle" };
  if (child.parentStateId === parentId) return { write: false, intent, parentStateId: parentId, reason: "already-declared" };
  /* RULE 1, CATEGORICALLY. Moving to a state says nothing about where it came
     from — including when it currently says nothing at all. */
  if (intent !== "explicit-lineage-edit") {
    return { write: false, intent, parentStateId: child.parentStateId, reason: "navigation-may-not-reparent" };
  }
  /* ATOMIC AGAINST THE RESULTING GRAPH. The pairwise checks above are necessary
     and, on a project that already carries damage, not sufficient: a graph with
     a pre-existing cycle elsewhere can absorb a write that looks locally fine.
     The whole graph is simulated and re-checked before this returns `write`. */
  const simulated = lineageNodes(states).map((state) => (state.id === childId ? { ...state, parentStateId: parentId } : state));
  if (!lineageIsAcyclic(simulated)) return { write: false, intent, parentStateId: child.parentStateId, reason: "graph-would-be-cyclic" };
  return { write: true, intent, parentStateId: parentId, reason: child.parentStateId ? "reparented" : "establishing-first-parent" };
}

/* THE ONE MUTATION API. Every writer of `parentStateId` in CineBraid calls this
   — the creation-studio parent selector, the continuity variant opener, the
   correct-from-parent path, the generic state setter, entity-state automation,
   import and normalisation compatibility.

   A REFUSED MUTATION WRITES NOTHING AND DIRTIES NOTHING. `dirty` is invoked only
   on a real write, so a rejected dropdown change cannot leave a project marked
   modified with no modification in it. */
function applyStateParentMutation(states, childStateId, proposedParentId, options = {}) {
  const opts = lineageObject(options);
  const decision = planParentMutation(states, childStateId, proposedParentId, opts);
  if (!decision.write) return { ...decision, applied: false };
  const target = lineageList(states).map(lineageObject).find((state) => lineageText(state.id) === lineageText(childStateId));
  if (!target) return { ...decision, write: false, applied: false, reason: "unknown-state" };
  const previous = lineageText(target.parentStateId);
  target.parentStateId = decision.parentStateId;
  /* The parent moved, so any recorded judgement about the OLD parent is about a
     relationship that no longer exists. */
  if (Object.prototype.hasOwnProperty.call(target, "parentValidation")) target.parentValidation = null;
  if (typeof opts.dirty === "function") opts.dirty();
  return { ...decision, applied: true, previousParentStateId: previous, via: lineageText(opts.via) };
}

/* WHICH STATES MAY BE OFFERED AS A PARENT. Excludes self and every descendant,
   so the dropdown cannot present the move that closes a cycle. The selector no
   longer needs to know why — it renders this list. */
function eligibleParentIds(states, childStateId) {
  const childId = lineageText(childStateId);
  const forbidden = new Set([childId, ...stateDescendantIds(states, childId)]);
  return lineageNodes(states).filter((state) => !forbidden.has(state.id)).map((state) => state.id);
}

/* Retained under its shipped name for callers that only want the decision. It
   defaults to the navigation intent, which now refuses every write — so a
   caller that did not think about intent gets the safe answer. */
function safeParentAssignment(states, childStateId, proposedParentId, options = {}) {
  const opts = lineageObject(options);
  return planParentMutation(states, childStateId, proposedParentId, {
    ...opts,
    intent: lineageText(opts.intent) || (opts.allowReparent === true ? "explicit-lineage-edit" : "navigation"),
  });
}

/* ---------- continuation -------------------------------------------------- */

/* Which states may legitimately be edited next after approving `currentStateId`.

   BATCH 1B: DESCENDANTS ONLY. The shipped version excluded ancestors and self
   and then appended "the rest of the graph" — siblings, cousins and orphans —
   so an unrelated state was still a continuation target, and continuing into
   one was what asked navigation to invent a parent for it. Continuation means
   moving DOWN the chain that was just extended. A state on another branch is
   reached by opening it, not by continuing into it.

   Direct children first, then deeper descendants, so the order matches the way
   the chain reads. */
function continuationCandidates(states, currentStateId) {
  const nodes = lineageNodes(states);
  const currentId = lineageText(currentStateId);
  const byId = new Map(nodes.map((state) => [state.id, state]));
  const descendants = stateDescendantIds(states, currentId);
  const childIds = new Set(nodes.filter((state) => state.parentStateId === currentId).map((state) => state.id));
  return descendants
    .map((id) => byId.get(id))
    .filter(Boolean)
    .sort((a, b) => (childIds.has(b.id) ? 1 : 0) - (childIds.has(a.id) ? 1 : 0))
    .map((state) => ({
      id: state.id,
      name: state.name,
      approved: !!state.approvedFile,
      isDirectChild: childIds.has(state.id),
    }));
}

/* THE ANSWER "Approve & edit next" needs. `complete` is a real outcome: a chain
   whose remaining states are all approved has nothing to continue into, and
   saying so is what stops the ring.

   `suggestedStateId` prefers unfinished work — the state that still needs a
   reference — and prefers a direct child of what was just approved, because that
   is the state whose parent is now available. */
function continuationOutcome(states, currentStateId) {
  const candidates = continuationCandidates(states, currentStateId);
  const unfinished = candidates.filter((candidate) => !candidate.approved);
  if (!unfinished.length) {
    return {
      kind: "complete",
      suggestedStateId: "",
      candidates,
      remaining: 0,
      /* Named so a surface prints WHY it is offering nothing rather than
         appearing to have forgotten. */
      reason: candidates.length ? "every-remaining-state-is-approved" : "no-further-states",
    };
  }
  const suggested = unfinished.find((candidate) => candidate.isDirectChild) || unfinished[0];
  return { kind: "continue", suggestedStateId: suggested.id, candidates, remaining: unfinished.length, reason: "" };
}

/* Is this candidate a legal continuation target at all. The gate the writer asks
   before it opens an editor, so an id arriving from a stale form cannot move the
   creator onto an ancestor. */
function isValidContinuation(states, currentStateId, nextStateId) {
  const wanted = lineageText(nextStateId);
  return !!wanted && continuationCandidates(states, currentStateId).some((candidate) => candidate.id === wanted);
}

/* How the continuation copy must read. Direction is derived from the graph, not
   from which button was pressed — presenting it backwards is what made the
   dogfood report call the derivation graph wrong. */
function continuationDerivation(states, currentStateId, nextStateId) {
  const next = lineageNode(states, nextStateId);
  const current = lineageNode(states, currentStateId);
  if (!next || !current) return { derivesFromCurrent: false, parentStateId: "", parentName: "" };
  const parent = next.parentStateId ? lineageNode(states, next.parentStateId) : null;
  return {
    derivesFromCurrent: next.parentStateId === current.id,
    parentStateId: parent ? parent.id : "",
    parentName: parent ? parent.name : "",
  };
}

const STATE_LINEAGE_EXPORTS = {
  LINEAGE_CONTINUATION_KINDS,
  LINEAGE_MUTATION_INTENTS,
  LINEAGE_MUTATION_REASONS,
  lineageNodes,
  lineageNode,
  stateAncestorIds,
  stateDescendantIds,
  lineageCycles,
  lineageIsAcyclic,
  planParentMutation,
  applyStateParentMutation,
  eligibleParentIds,
  safeParentAssignment,
  continuationCandidates,
  continuationOutcome,
  isValidContinuation,
  continuationDerivation,
};

if (typeof window !== "undefined") for (const [key, value] of Object.entries(STATE_LINEAGE_EXPORTS)) window[key] = value;
if (typeof module !== "undefined" && module.exports) module.exports = STATE_LINEAGE_EXPORTS;

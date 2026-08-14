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

/* THE ONLY DESCRIPTION OF A LINEAGE WRITE. Returns a decision rather than
   performing one, so the caller's refusal path and the rule are the same code.

   `write: false` with a reason is the normal answer for navigation: the state
   already declares a parent, and moving to it is not a statement about where it
   came from. */
function safeParentAssignment(states, childStateId, proposedParentId, options = {}) {
  const opts = lineageObject(options);
  const childId = lineageText(childStateId);
  const parentId = lineageText(proposedParentId);
  const child = lineageNode(states, childId);
  if (!child) return { write: false, parentStateId: "", reason: "unknown-state" };
  if (child.isDefault) return { write: false, parentStateId: "", reason: "default-state-is-the-root" };
  if (!parentId || parentId === childId) return { write: false, parentStateId: "", reason: "invalid-parent" };
  if (!lineageNode(states, parentId)) return { write: false, parentStateId: "", reason: "unknown-parent" };
  /* RULE 2, at the writer. The proposed parent living below the child is exactly
     the ancestor-beneath-descendant move that closed the dogfood cycle. */
  if (stateAncestorIds(states, parentId).includes(childId)) return { write: false, parentStateId: "", reason: "would-create-cycle" };
  /* RULE 1. An existing edge is production truth. Only an explicit lineage edit
     may replace it, and navigation is not one. */
  if (child.parentStateId && child.parentStateId !== parentId && opts.allowReparent !== true) {
    return { write: false, parentStateId: child.parentStateId, reason: "navigation-may-not-reparent" };
  }
  if (child.parentStateId === parentId) return { write: false, parentStateId: parentId, reason: "already-declared" };
  return { write: true, parentStateId: parentId, reason: "establishing-first-parent" };
}

/* ---------- continuation -------------------------------------------------- */

/* Which states may legitimately be edited next after approving `currentStateId`.

   Ordered so the answer is stable and explainable: this state's own direct
   children first (the literal continuation), then the rest of the graph
   excluding ancestors and self. NEVER a ring. */
function continuationCandidates(states, currentStateId) {
  const nodes = lineageNodes(states);
  const currentId = lineageText(currentStateId);
  const forbidden = new Set([currentId, ...stateAncestorIds(states, currentId)]);
  const children = nodes.filter((state) => state.parentStateId === currentId && !forbidden.has(state.id));
  const childIds = new Set(children.map((state) => state.id));
  const others = nodes.filter((state) => !forbidden.has(state.id) && !childIds.has(state.id));
  return [...children, ...others].map((state) => ({
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
  lineageNodes,
  lineageNode,
  stateAncestorIds,
  stateDescendantIds,
  lineageCycles,
  lineageIsAcyclic,
  safeParentAssignment,
  continuationCandidates,
  continuationOutcome,
  isValidContinuation,
  continuationDerivation,
};

if (typeof window !== "undefined") for (const [key, value] of Object.entries(STATE_LINEAGE_EXPORTS)) window[key] = value;
if (typeof module !== "undefined" && module.exports) module.exports = STATE_LINEAGE_EXPORTS;

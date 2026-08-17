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
   THE RULES, as they stand after Batch 1C.

     1. LINEAGE IS CREATE-ONLY. A state's parent is chosen when the state is
        created and never changes. There is no reparent operation, so there is
        no cycle to prevent: a new state's parent must already exist, and
        nothing that already exists can point at something created later.
     2. THE COLLECTION IS VALIDATED AS A WHOLE. Unique non-empty ids, exactly
        one root, every parent resolves. "Acyclic" was never enough — a
        duplicated id and a dangling parent are both broken and neither loops.
     3. DELETION STATES ITS POLICY. Removing a state something derives from
        refuses by default, and never leaves a child pointing at nothing.
     4. NAVIGATION NEVER MUTATES LINEAGE. Choosing what to edit next is a
        movement, not a declaration — not even for a state that declares no
        parent yet.
     5. ANCESTORS ARE NEVER CONTINUATION CANDIDATES, and neither is anything
        off the chain. Continuation moves DOWN.
     6. A FINISHED CHAIN STOPS. When nothing downstream still needs work the
        answer is "complete", not "start again at the root".

   THE DEFAULT STATE IS THE ROOT. It has no parent and cannot acquire one.

   NOTHING IS MUTATED BY A READ. The two functions that WRITE —
   `applyStateCreation` and `applyStateDeletion` — each validate the exact
   resulting collection first and leave the original untouched on refusal.

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

/* ==========================================================================
   BATCH 1C — LINEAGE IS CREATE-ONLY. REPARENTING IS GONE.

   The Batch 1B re-audit's A5 findings were all consequences of one thing: the
   derivation graph was MUTABLE. Because a parent could be changed, a validator
   had to prove that every change kept the graph acyclic; because the validator
   only looked at cycles, duplicate ids and dangling parents walked past it;
   because `addContinuityState` and `removeContinuityState` created and
   destroyed edges without going through it at all, the "one writer" claim was
   false; and because the simulated graph updated both copies of a duplicated id
   while the commit updated one, the thing validated was not the thing written.

   Alpha deletes the cause rather than instrumenting the consequences.

       A STATE'S PARENT IS CHOSEN WHEN THE STATE IS CREATED, AND NEVER CHANGES.

   That single rule removes reparenting, the cycle-creation surface, the parent
   dropdown, the generic setter's lineage path, and the need for a graph
   transaction — because A CREATE-ONLY GRAPH CANNOT CYCLE. A new state's parent
   must already exist, and nothing already existing can point at something
   created after it. The property is structural, not checked.

   WHY THIS IS NOT COLLAPSED FURTHER. The alpha direction asked whether
   inheritance could be reduced to base → named state, one level. The preserved
   Dogfood #2 project answers no: it runs `Rooftop working → Heavy soot → Dawn
   with burgundy scarf`, and the closeout records that chain's inheritance
   reasoning as positive finding P4 — "carry forward heavy soot, add the scarf".
   Flattening it would discard a working feature and rewrite real evidence. The
   depth is kept; the MUTABILITY is what goes.

   WHAT STILL NEEDS VALIDATING, and does not come free from create-only:
     - unique, non-empty state ids
     - exactly one default/root
     - every non-root parent resolves to a state that exists
     - deletion never leaves a dangling child
   Imported and pre-existing collections can violate all four, so the collection
   validator below stays and is the gate for add and remove. */

/* 1D-06 — THERE IS ONE DELETION POLICY, AND IT IS "REFUSE".
 *
 * Batch 1C called this module immutable while shipping `reparent-to-root` and
 * `cascade`, and the 1C audit used the first one — through the creator's own
 * confirm dialog — to rewrite a grandchild's parent. A rule contradicted by an
 * exported policy is not a rule.
 *
 * The constant stays as a one-element list rather than disappearing, because
 * callers and tests read it to assert exactly this: that reparenting is not on
 * the menu. A creator who wants a state gone deletes its descendants first,
 * which is a sequence of decisions they can see, each one refusable. */
const LINEAGE_DELETION_POLICIES = ["refuse"];

const LINEAGE_INTEGRITY_CODES = [
  "state-id-missing",
  "state-id-duplicated",
  "no-default-state",
  "multiple-default-states",
  "default-state-has-parent",
  "parent-missing",
  "parent-is-self",
  "cycle",
];

/* Reported alongside, but NOT an integrity failure — see validateStateCollection.
   A legacy state whose derivation was never recorded is incomplete history, not
   a damaged graph, and 1D-06 forbids filling it in on the filmmaker's behalf. */
const LINEAGE_LEGACY_CODES = ["state-derivation-unrecorded"];

/* THE WHOLE COLLECTION, CHECKED. `lineageIsAcyclic` was never a sufficient
   integrity predicate — the re-audit's duplicate-id and dangling-parent cases
   both returned "acyclic: true" — so integrity is its own question with its own
   answer, and cycles are one clause of it. */
function validateStateCollection(states) {
  const rows = lineageList(states).map(lineageObject);
  const problems = [];
  const seen = new Set();
  const ids = new Set();
  let defaults = 0;
  for (let index = 0; index < rows.length; index++) {
    const id = lineageText(rows[index].id);
    if (!id) { problems.push({ code: "state-id-missing", index }); continue; }
    if (seen.has(id)) problems.push({ code: "state-id-duplicated", index, id });
    seen.add(id);
    ids.add(id);
    if (rows[index].isDefault === true) {
      defaults += 1;
      if (lineageText(rows[index].parentStateId)) problems.push({ code: "default-state-has-parent", index, id });
    }
  }
  if (!defaults && rows.length) problems.push({ code: "no-default-state" });
  if (defaults > 1) problems.push({ code: "multiple-default-states", count: defaults });
  for (let index = 0; index < rows.length; index++) {
    const id = lineageText(rows[index].id);
    const parentId = lineageText(rows[index].parentStateId);
    if (!id || !parentId) continue;
    if (parentId === id) { problems.push({ code: "parent-is-self", index, id }); continue; }
    if (!ids.has(parentId)) problems.push({ code: "parent-missing", index, id, parentStateId: parentId });
  }
  for (const cycle of lineageCycles(rows)) problems.push({ code: "cycle", ids: cycle });
  /* 1D-06 — UNRECORDED DERIVATION IS REPORTED, NOT INVENTED AND NOT FATAL.
   *
   * A non-default state written before ancestry existed has no `parentStateId`.
   * Batch 1C's normaliser quietly filled it in with the default state on every
   * load, which is authorship: it decides, on the filmmaker's behalf and
   * without asking, what a state derives from. That is exactly what an
   * immutable-ancestry rule must not do.
   *
   * It is also not a broken graph — nothing dangles and nothing loops — so it
   * does not fail validation, because failing it would stop a legacy project
   * from ever adding a new state. It is surfaced as `legacy` for the load
   * warning to name, and left alone. */
  const legacy = [];
  for (const row of rows) {
    if (row.isDefault === true) continue;
    const id = lineageText(row.id);
    if (id && !lineageText(row.parentStateId)) legacy.push({ code: "state-derivation-unrecorded", id });
  }
  return { ok: problems.length === 0, problems, legacy };
}
function stateCollectionIntact(states) {
  return validateStateCollection(states).ok;
}

/* ---------- the two mutations that remain --------------------------------- */

/* CREATE. The only way a parent edge comes into existence.
 *
 * The parent must already exist, which is what makes the result acyclic without
 * a cycle check: the new id is not reachable from anything, so nothing can
 * point back to it. Validation is still run against the exact resulting
 * collection, because the collection may already have been damaged by an import
 * and this refuses to add to a broken graph. */
function planStateCreation(states, request = {}) {
  const it = lineageObject(request);
  const rows = lineageList(states).map(lineageObject);
  const id = lineageText(it.id);
  const parentStateId = lineageText(it.parentStateId);
  if (!id) return { create: false, reason: "state-id-missing" };
  if (rows.some((row) => lineageText(row.id) === id)) return { create: false, reason: "state-id-duplicated" };
  const isDefault = it.isDefault === true;
  if (!isDefault) {
    if (!parentStateId) return { create: false, reason: "parent-required" };
    if (!rows.some((row) => lineageText(row.id) === parentStateId)) return { create: false, reason: "parent-missing" };
  }
  const next = [...rows, { ...lineageObject(it.record), id, parentStateId: isDefault ? "" : parentStateId, isDefault }];
  const integrity = validateStateCollection(next);
  if (!integrity.ok) return { create: false, reason: "collection-invalid", problems: integrity.problems };
  return { create: true, reason: isDefault ? "root" : "derived", id, parentStateId: isDefault ? "" : parentStateId };
}

function applyStateCreation(states, request = {}) {
  const decision = planStateCreation(states, request);
  if (!decision.create) return { ...decision, applied: false };
  const it = lineageObject(request);
  const record = { ...lineageObject(it.record), id: decision.id, parentStateId: decision.parentStateId, isDefault: it.isDefault === true };
  states.push(record);
  if (typeof it.dirty === "function") it.dirty();
  return { ...decision, applied: true, record };
}

/* DELETE, WITH AN EXPLICIT POLICY. The re-audit removed `child` from
   `root → child → grand` and left `grand.parentStateId === "child"` pointing at
   nothing, then observed the result was still reported acyclic. A dangling
   parent is a broken graph whether or not it loops, so deletion has to say what
   happens to the children rather than leaving it to whoever splices the array.
 *
 * 1D-06: THE ONLY POLICY IS REFUSE. A state with descendants is not deleted,
 * full stop — no reparenting, no cascade, no option that rewrites an ancestry
 * chosen at creation. The resulting collection is validated before it is
 * committed, and a refusal leaves the original array byte-identical. */
function planStateDeletion(states, stateId, options = {}) {
  const opts = lineageObject(options);
  /* An unrecognised policy is not honoured and not silently downgraded either —
     `refuse` is the only value, so anything else asks for behaviour that no
     longer exists and the caller should hear about it. */
  const asked = lineageText(opts.policy);
  const policy = "refuse";
  if (asked && asked !== policy) return { remove: false, reason: "unsupported-deletion-policy", policy, asked };
  const rows = lineageList(states).map(lineageObject);
  const id = lineageText(stateId);
  const node = rows.find((row) => lineageText(row.id) === id);
  if (!node) return { remove: false, reason: "unknown-state", policy };
  if (node.isDefault === true) return { remove: false, reason: "default-state-is-the-root", policy };
  const children = rows.filter((row) => lineageText(row.parentStateId) === id).map((row) => lineageText(row.id));
  if (children.length) return { remove: false, reason: "has-children", policy, children };
  const next = rows.filter((row) => lineageText(row.id) !== id);
  const integrity = validateStateCollection(next);
  if (!integrity.ok) return { remove: false, reason: "collection-invalid", policy, problems: integrity.problems };
  return { remove: true, reason: policy, policy, removedIds: [id], reparented: [] };
}

function applyStateDeletion(states, stateId, options = {}) {
  const decision = planStateDeletion(states, stateId, options);
  if (!decision.remove) return { ...decision, applied: false };
  const opts = lineageObject(options);
  const removing = new Set(decision.removedIds);
  /* No ancestry is rewritten here, because a deletion that reaches this line
     has no descendants to rewrite. That is the whole of 1D-06. */
  for (let index = states.length - 1; index >= 0; index--) {
    if (removing.has(lineageText(lineageObject(states[index]).id))) states.splice(index, 1);
  }
  if (typeof opts.dirty === "function") opts.dirty();
  return { ...decision, applied: true };
}

/* ---------- recording a derivation that was never recorded ---------------- */

/* THE THIRD WRITE, AND THE NARROWEST ONE.
 *
 * `state-derivation-unrecorded` was reported and then left alone — correctly, in
 * that 1D-06 forbids CineBraid deciding on the filmmaker's behalf what a state
 * derives from. What it left behind was a dead end: an imported state that says
 * "heavy soot over every surface" and records no source cannot be generated
 * (`no valid parent state`), and every write that could give it one refused,
 * because the only writes were create and delete. The founder smoke walked into
 * exactly that and had nowhere to go.
 *
 * RECORDING A DERIVATION IS NOT REPARENTING. Rule 1 protects an ancestry the
 * filmmaker AUTHORED from being rewritten by navigation. A state with no recorded
 * parent has no authored ancestry to protect; stating one for the first time is
 * the human decision 1D-06 says must be surfaced, not the substitution it says
 * must not happen. So this refuses the instant a parent already exists — that
 * case is still `reparentingUnsupported()` and always will be.
 *
 * The cycle argument that makes creation safe does NOT hold here: this state
 * already exists and may already have descendants, so a source below it would
 * close a loop. Descendants are excluded by name, and the exact resulting
 * collection is validated anyway. */
function eligibleDerivationSourceIds(states, stateId) {
  const id = lineageText(stateId);
  const node = lineageNode(states, id);
  if (!node || node.isDefault || node.parentStateId) return [];
  const excluded = new Set([id, ...stateDescendantIds(states, id)]);
  return lineageNodes(states).filter((state) => !excluded.has(state.id)).map((state) => state.id);
}
function planDerivationRecord(states, stateId, sourceStateId) {
  const rows = lineageList(states).map(lineageObject);
  const id = lineageText(stateId);
  const sourceId = lineageText(sourceStateId);
  const node = lineageNode(rows, id);
  if (!node) return { record: false, reason: "unknown-state" };
  if (node.isDefault) return { record: false, reason: "default-state-is-the-root" };
  /* The one case this function exists to refuse. */
  if (node.parentStateId) return { record: false, reason: "reparenting-unsupported", parentStateId: node.parentStateId };
  if (!sourceId) return { record: false, reason: "source-required" };
  if (sourceId === id) return { record: false, reason: "parent-is-self" };
  if (!rows.some((row) => lineageText(row.id) === sourceId)) return { record: false, reason: "parent-missing" };
  if (stateDescendantIds(rows, id).includes(sourceId)) return { record: false, reason: "source-is-descendant" };
  const next = rows.map((row) => (lineageText(row.id) === id ? { ...row, parentStateId: sourceId } : row));
  const integrity = validateStateCollection(next);
  if (!integrity.ok) return { record: false, reason: "collection-invalid", problems: integrity.problems };
  return { record: true, reason: "derivation-recorded", id, parentStateId: sourceId };
}
function applyDerivationRecord(states, stateId, sourceStateId, options = {}) {
  const decision = planDerivationRecord(states, stateId, sourceStateId);
  if (!decision.record) return { ...decision, applied: false };
  const opts = lineageObject(options);
  const target = lineageList(states).map(lineageObject).find((row) => lineageText(row.id) === decision.id);
  /* The live record, not a copy — this is the write. Nothing else on it is
     touched: recording where a state comes from is not an approval, not a
     generation-mode choice, and not a change to its delta. */
  target.parentStateId = decision.parentStateId;
  if (typeof opts.dirty === "function") opts.dirty();
  return { ...decision, applied: true };
}

/* ---------- what a caller asks instead of reparenting --------------------- */

/* REPARENTING IS NOT A SUPPORTED OPERATION. This exists so a call site that
   used to reparent gets a clear, greppable refusal instead of silently doing
   nothing, and so the reason travels to the surface that has to explain it.

   "Reparent" means REPLACING a parent the filmmaker already chose. Recording one
   for a state that has none is `applyDerivationRecord` above, and it refuses the
   moment a parent exists — so the two never overlap. */
function reparentingUnsupported(reason = "") {
  return {
    write: false,
    applied: false,
    reason: "reparenting-unsupported",
    detail: lineageText(reason)
      || "A continuity state's derivation is chosen when the state is created and does not change. Create a new state from the parent you want instead.",
  };
}

/* Which states may be offered as a parent WHEN CREATING one. Every existing
   state qualifies — there is no self and no descendant to exclude, because the
   state being created does not exist yet. Kept as a named function so the
   creation UI has one source for the list. */
function eligibleCreationParentIds(states) {
  return lineageNodes(states).map((state) => state.id);
}

/* ---------- continuation --------------------------------------------------- */

/* Which states may legitimately be edited next after approving `currentStateId`.

   DESCENDANTS ONLY. The shipped version excluded ancestors and self and then
   appended "the rest of the graph" — siblings, cousins and orphans — so an
   unrelated state was still a continuation target, and continuing into one was
   what asked navigation to invent a parent for it. Continuation moves DOWN the
   chain that was just extended. A state on another branch is
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
      /* HAS AN IMAGE — not "is approved". Whether a person approved it is a
         receipt question this module deliberately knows nothing about. */
      hasImage: !!state.approvedFile,
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
  const unfinished = candidates.filter((candidate) => !candidate.hasImage);
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
  LINEAGE_DELETION_POLICIES,
  LINEAGE_INTEGRITY_CODES,
  LINEAGE_LEGACY_CODES,
  lineageNodes,
  lineageNode,
  stateAncestorIds,
  stateDescendantIds,
  lineageCycles,
  lineageIsAcyclic,
  validateStateCollection,
  stateCollectionIntact,
  planStateCreation,
  applyStateCreation,
  planStateDeletion,
  applyStateDeletion,
  eligibleDerivationSourceIds,
  planDerivationRecord,
  applyDerivationRecord,
  reparentingUnsupported,
  eligibleCreationParentIds,
  continuationCandidates,
  continuationOutcome,
  isValidContinuation,
  continuationDerivation,
};

if (typeof window !== "undefined") for (const [key, value] of Object.entries(STATE_LINEAGE_EXPORTS)) window[key] = value;
if (typeof module !== "undefined" && module.exports) module.exports = STATE_LINEAGE_EXPORTS;

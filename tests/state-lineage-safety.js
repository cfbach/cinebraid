/* CONTINUITY-STATE LINEAGE SAFETY. Dogfood Pass #2 A6, forensic audit F5.
 *
 * THE PROPERTY THIS FILE EXISTS FOR, in one line: choosing what to edit next
 * never changes where a state came from, and the derivation graph stays acyclic.
 *
 * THE CASE, from the pass. After approving the final Chimbley descendant state,
 * the dialog offered editing the already-approved ancestor "Rooftop working",
 * with copy saying Rooftop would derive from the state just approved. The offer
 * came from a CYCLIC ROTATION through the whole state list, and accepting it ran
 *
 *     nextState.parentStateId = targetStateId
 *
 * unconditionally — reparenting an ancestor beneath its own descendant and
 * closing a cycle in the derivation graph.
 *
 * WHY THE CYCLE MATTERS MORE THAN THE NAVIGATION. A wrong destination wastes a
 * click. A cycle makes every later question that walks lineage — what does this
 * state inherit, which parent must be approved first, is this chain complete —
 * either unanswerable or non-terminating, on production truth.
 *
 * NO PAID PROVIDER CALL IS POSSIBLE HERE. The lineage module is pure.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");
const Lineage = require("../public/shared-state-lineage");

let checks = 0;
const ok = (condition, message) => { assert(condition, message); checks++; };
const eq = (actual, expected, message) => {
  assert.deepStrictEqual(actual, expected, `${message}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  checks++;
};

/* ===========================================================================
   The fixture. root -> child -> grandchild, exactly the chain the repair brief
   names, plus a sibling so "offers everything below" and "offers only the direct
   child" are distinguishable. */

const ROOT_ID = "state-default";
const CHILD = "st-heavy-soot";
const GRANDCHILD = "st-dawn-scarf";
const SIBLING = "st-rain";

function states(options = {}) {
  const { childApproved = true, grandchildApproved = false, siblingApproved = false, withSibling = false } = options;
  const rows = [
    { id: ROOT_ID, name: "Rooftop working", isDefault: true, parentStateId: "", approvedFile: "ROOT.png" },
    { id: CHILD, name: "Heavy soot", parentStateId: ROOT_ID, approvedFile: childApproved ? "CHILD.png" : "" },
    { id: GRANDCHILD, name: "Dawn with burgundy scarf", parentStateId: CHILD, approvedFile: grandchildApproved ? "GRAND.png" : "" },
  ];
  if (withSibling) rows.push({ id: SIBLING, name: "Rain-soaked", parentStateId: ROOT_ID, approvedFile: siblingApproved ? "SIB.png" : "" });
  return rows;
}

/* ===========================================================================
   1. READING THE GRAPH. */

eq(Lineage.stateAncestorIds(states(), GRANDCHILD), [CHILD, ROOT_ID], "ancestry walks child-first to the root");
eq(Lineage.stateAncestorIds(states(), ROOT_ID), [], "the default state is the root and has none");
eq(Lineage.stateDescendantIds(states(), ROOT_ID), [CHILD, GRANDCHILD], "descendants walk breadth-first");
eq(Lineage.stateDescendantIds(states(), GRANDCHILD), [], "a leaf has none");
eq(Lineage.lineageCycles(states()), [], "a healthy chain has no cycles");
ok(Lineage.lineageIsAcyclic(states()), "and reports acyclic");

/* THE READER MUST SURVIVE DAMAGED DATA. A project that already carries a cycle
   written by the shipped defect has to be reportable; a reader that hangs or
   throws on it cannot be used to find it. */
const damaged = [
  { id: ROOT_ID, name: "Root", isDefault: true, parentStateId: GRANDCHILD },
  { id: CHILD, name: "Child", parentStateId: ROOT_ID },
  { id: GRANDCHILD, name: "Grandchild", parentStateId: CHILD },
];
eq(Lineage.lineageCycles(damaged), [[CHILD, GRANDCHILD, ROOT_ID].sort()], "an existing cycle is detected and named");
ok(!Lineage.lineageIsAcyclic(damaged), "and reported");
eq(Lineage.stateAncestorIds(damaged, CHILD), [ROOT_ID, GRANDCHILD],
  "and ancestry terminates at the repeat instead of looping forever — it walks the loop exactly once and stops");

/* ===========================================================================
   2. CONTINUATION CANDIDATES. Ancestors are never offered. */

/* CHANGED IN BATCH 1B, and this expectation is the reason why.

   It used to read: "after the deepest descendant the ONLY candidate is the
   unrelated sibling". That sentence contains its own refutation — a sibling is
   not a continuation of anything. Offering one is what asked navigation to
   invent a parent for it, which is the write the acceptance audit caught still
   happening. Continuation moves DOWN the chain that was just extended; another
   branch is reached by opening it, not by continuing into it. */
const afterGrandchild = Lineage.continuationCandidates(states({ withSibling: true }), GRANDCHILD);
eq(afterGrandchild.map((row) => row.id), [],
  "after the deepest descendant there is nothing to continue INTO — the ancestors are behind it and the sibling is on another branch");
ok(!afterGrandchild.some((row) => row.id === ROOT_ID), "the approved ancestor is not offered");
ok(!afterGrandchild.some((row) => row.id === CHILD), "nor the intermediate one");
ok(!afterGrandchild.some((row) => row.id === GRANDCHILD), "nor itself");
ok(!afterGrandchild.some((row) => row.id === SIBLING), "nor an unrelated branch, which is what made a navigation button declare ancestry");

const afterRoot = Lineage.continuationCandidates(states({ withSibling: true }), ROOT_ID);
eq(afterRoot.filter((row) => row.isDirectChild).map((row) => row.id), [CHILD, SIBLING],
  "direct children are identified and come first — they are the states whose parent has just become available");
eq(afterRoot.map((row) => row.id), [CHILD, SIBLING, GRANDCHILD], "with the deeper descendants after them, and nothing that is not a descendant");

eq(Lineage.continuationCandidates(states(), GRANDCHILD), [], "a terminal descendant with no siblings offers nothing at all");
ok(Lineage.isValidContinuation(states(), ROOT_ID, CHILD), "a legal target validates");
ok(!Lineage.isValidContinuation(states(), GRANDCHILD, ROOT_ID),
  "and an ancestor does NOT — the id is re-checked at the writer, so a stale form cannot move a creator onto one");
ok(!Lineage.isValidContinuation(states(), CHILD, CHILD), "nor itself");

/* ===========================================================================
   3. OUTCOME. A finished chain stops instead of wrapping to the root. */

const unfinished = Lineage.continuationOutcome(states(), ROOT_ID);
eq(unfinished.kind, "continue", "with unapproved work below, the answer is continue");
eq(unfinished.suggestedStateId, GRANDCHILD, "and the suggestion is the unfinished state");
eq(unfinished.remaining, 1, "with the count of what is left");

const suggestsDirectChild = Lineage.continuationOutcome(states({ childApproved: false, withSibling: true }), ROOT_ID);
eq(suggestsDirectChild.suggestedStateId, CHILD, "an unfinished DIRECT child is preferred — its parent is the state just approved");

const finished = Lineage.continuationOutcome(states({ grandchildApproved: true }), CHILD);
eq(finished.kind, "complete",
  "when everything downstream is approved the outcome is COMPLETE — not a wrap-around to the root, which is what produced the backwards-derivation dialog");
eq(finished.suggestedStateId, "", "with nothing suggested");
eq(finished.reason, "every-remaining-state-is-approved", "and a reason a surface can print");

const terminal = Lineage.continuationOutcome(states(), GRANDCHILD);
eq(terminal.kind, "complete", "the final descendant of a chain completes");
eq(terminal.reason, "no-further-states", "with the distinct reason that there is nothing else at all");

/* ===========================================================================
   4. THE WRITE — AND IN BATCH 1C THERE IS ONLY ONE KIND OF IT.

   OLD EXPECTATION (removed): a family of assertions about `safeParentAssignment`
   and `applyStateParentMutation` — navigation may not reparent, an explicit edit
   may, a cycle-closing reparent is refused, a first parent may be established by
   an explicit edit, and the eligible-parent list must exclude descendants.

   WHY IT IS NO LONGER VALID: every one of those assertions describes a REPARENT
   OPERATION, and reparenting has been removed. The Batch 1B re-audit's A5
   findings were all consequences of the graph being mutable — a validator that
   only checked cycles let duplicate ids and dangling parents through, the
   simulated graph and the committed graph diverged on a duplicated id, and
   `addContinuityState`/`removeContinuityState` bypassed the validator entirely
   because a caller inventory searching for ASSIGNMENTS could not see an object
   literal or a splice.

   THE NEW INVARIANT: a state's parent is chosen when the state is created and
   never changes. A create-only graph cannot cycle — the parent must already
   exist, so nothing existing can point at something created later — which makes
   the property structural rather than checked.

   WHY THIS IS SIMPLER AND TRUER: one operation instead of two, no cycle
   validator on the write path, no eligible-parent filtering, no intent
   parameter, and no way for a UI control to offer a move the model must then
   refuse. What remains is validated as a COLLECTION, which is what catches the
   duplicate ids and dangling parents that "acyclic" never did. */

ok(!("safeParentAssignment" in Lineage), "the reparent decision function is gone, not deprecated");
ok(!("applyStateParentMutation" in Lineage), "and so is the reparent writer");
ok(!("planParentMutation" in Lineage), "and its planner");
ok(!("eligibleParentIds" in Lineage), "and the eligible-parent list a reparent control needed");
ok(typeof Lineage.reparentingUnsupported === "function",
  "a caller that still asks gets a named refusal rather than a silent no-op");
eq(Lineage.reparentingUnsupported().applied, false, "which never applies anything");

/* ---- collection integrity, which is the validator that remains ---- */

ok(Lineage.stateCollectionIntact(states()), "a healthy chain is intact");
ok(Lineage.stateCollectionIntact(states({ withSibling: true })), "and so is a branching one");

const integrityCases = [
  [[{ id: ROOT_ID, isDefault: true }, { id: "dup", parentStateId: ROOT_ID }, { id: "dup", parentStateId: ROOT_ID }],
   "state-id-duplicated", "two states sharing an id — the case that made the simulated graph and the committed graph disagree"],
  [[{ id: ROOT_ID, isDefault: true }, { id: "a", parentStateId: "ghost" }],
   "parent-missing", "a parent that does not exist — dangling, and never a cycle, which is why 'acyclic' was not enough"],
  [[{ id: ROOT_ID, isDefault: true }, { id: "", parentStateId: ROOT_ID }],
   "state-id-missing", "a state with no id"],
  [[{ id: "a", parentStateId: "" }, { id: "b", parentStateId: "a" }],
   "no-default-state", "a collection with no root"],
  [[{ id: ROOT_ID, isDefault: true }, { id: "second", isDefault: true }],
   "multiple-default-states", "two roots"],
  [[{ id: ROOT_ID, isDefault: true, parentStateId: "x" }, { id: "x", parentStateId: ROOT_ID }],
   "default-state-has-parent", "a root that declares a parent"],
  [[{ id: ROOT_ID, isDefault: true }, { id: "a", parentStateId: "b" }, { id: "b", parentStateId: "a" }],
   "cycle", "and a real cycle, in damaged data an import may hand us"],
];
for (const [collection, code, why] of integrityCases) {
  const outcome = Lineage.validateStateCollection(collection);
  ok(!outcome.ok, `${why}: reported as broken`);
  ok(outcome.problems.some((row) => row.code === code), `${why}: by the name ${code}`);
}

/* ---- creation ---- */

const creation = Lineage.planStateCreation(states(), { id: "st-new", parentStateId: CHILD });
eq(creation.create, true, "a new state may be created under an existing parent");
eq(creation.parentStateId, CHILD, "with the parent the creator chose");
eq(Lineage.planStateCreation(states(), { id: CHILD, parentStateId: ROOT_ID }).reason, "state-id-duplicated",
  "an id already in use is refused");
eq(Lineage.planStateCreation(states(), { id: "st-new", parentStateId: "ghost" }).reason, "parent-missing",
  "a parent that does not exist is refused — this is where dangling ancestry would have entered");
eq(Lineage.planStateCreation(states(), { id: "st-new", parentStateId: "" }).reason, "parent-required",
  "and a non-root state must say what it derives from");

/* MULTI-LEVEL INHERITANCE SURVIVES. The alpha direction asked whether ancestry
   could be flattened to base -> named state. It cannot: the preserved Dogfood #2
   project runs root -> child -> grandchild and the closeout records that chain's
   inheritance as positive finding P4. Depth is kept; mutability is what went. */
{
  const deep = states();
  eq(Lineage.applyStateCreation(deep, { id: "st-fourth", parentStateId: GRANDCHILD, record: { name: "Fourth" } }).applied, true,
    "a fourth level may be created below the third");
  eq(Lineage.stateAncestorIds(deep, "st-fourth"), [GRANDCHILD, CHILD, ROOT_ID],
    "and its ancestry walks the whole chain, which is the inheritance the dogfood project depends on");
  ok(Lineage.stateCollectionIntact(deep), "with the collection still intact");
}

/* A CREATE-ONLY GRAPH CANNOT CYCLE, proved by exhaustion rather than asserted:
   every state in turn is created under every existing state, and no arrangement
   produces one. */
{
  const grown = states({ withSibling: true });
  let created = 0;
  for (const parent of [...grown]) {
    const outcome = Lineage.applyStateCreation(grown, { id: `st-under-${parent.id}`, parentStateId: parent.id, record: { name: "Grown" } });
    if (outcome.applied) created += 1;
  }
  ok(created > 0, "the exhaustion actually created states");
  eq(Lineage.lineageCycles(grown), [], "and no sequence of creations can produce a cycle");
  ok(Lineage.stateCollectionIntact(grown), "with integrity intact throughout");
}

/* ---- deletion ---- */

{
  const collection = states();
  const before = JSON.stringify(collection);
  const refused = Lineage.applyStateDeletion(collection, CHILD);
  eq(refused.applied, false, "a state something derives from is not deleted by default");
  eq(refused.reason, "has-children", "and the refusal names why");
  eq(refused.children, [GRANDCHILD], "listing what depends on it");
  eq(JSON.stringify(collection), before, "the collection is byte-identical — a refused deletion changes nothing");
}
{
  const collection = states();
  eq(Lineage.applyStateDeletion(collection, GRANDCHILD).applied, true, "a leaf may be deleted");
  eq(collection.map((row) => row.id), [ROOT_ID, CHILD], "and it goes");
  ok(Lineage.stateCollectionIntact(collection), "leaving the collection intact");
}
{
  const collection = states();
  eq(Lineage.applyStateDeletion(collection, ROOT_ID).reason, "default-state-is-the-root", "the root is never deleted");
  eq(collection.length, 3, "and nothing was removed");
}
{
  /* CHANGED IN BATCH 1D — AND THIS TEST WAS PINNING THE DEFECT.

     OLD EXPECTATION: `applyStateDeletion(collection, CHILD, {policy:
     "reparent-to-root"})` succeeds and rewrites the grandchild's
     `parentStateId` from CHILD to ROOT. It sat directly beneath prose claiming
     ancestry is immutable, and the 1C acceptance audit named the contradiction:
     the module and the creator's own confirm dialog both performed reparenting.

     WHY IT IS NO LONGER VALID: an ancestry chosen at creation and rewritten by
     a delete confirmation was never immutable. "Immutable unless you accept the
     dialog" is not a rule a maintainer can hold in their head, and it is the
     exact caveat the closure pass exists to remove.

     THE NEW INVARIANT: there is ONE deletion policy and it is `refuse`. A state
     with descendants is not deleted; the creator removes the descendants first,
     each removal its own visible decision. The re-audit's dangling-parent case
     is closed more simply than before — the deletion that would create it
     cannot happen at all. */
  const collection = states();
  const before = JSON.stringify(collection);
  eq(Lineage.LINEAGE_DELETION_POLICIES, ["refuse"], "there is exactly one deletion policy");
  const refused = Lineage.applyStateDeletion(collection, CHILD, { policy: "reparent-to-root" });
  eq(refused.applied, false, "asking for the removed policy by name does not resurrect it");
  eq(refused.reason, "unsupported-deletion-policy", "and the caller is told the policy does not exist rather than being silently downgraded");
  eq(JSON.stringify(collection), before, "the collection is byte-identical");
  eq(collection.find((row) => row.id === GRANDCHILD).parentStateId, CHILD,
    "the grandchild still derives from exactly what it was created from");

  /* Cascade is gone by the same rule and for the same reason. */
  const cascade = Lineage.applyStateDeletion(states(), CHILD, { policy: "cascade" });
  eq(cascade.applied, false, "cascade is not a policy either");

  /* THE SEQUENCE THAT DOES WORK, and it never rewrites an ancestry: remove the
     leaf, then its parent. Two decisions, both refusable, no re-rooting. */
  const ordered = states();
  eq(Lineage.applyStateDeletion(ordered, GRANDCHILD).applied, true, "the leaf goes first");
  eq(Lineage.applyStateDeletion(ordered, CHILD).applied, true, "and then its parent, which is now a leaf itself");
  eq(ordered.map((row) => row.id), [ROOT_ID], "leaving the root");
  ok(Lineage.stateCollectionIntact(ordered), "intact, with nothing dangling");
}

{
  /* 1D-06 — AND NOTHING REPARENTS THROUGH THE UI EITHER. The shipped confirm
     dialog invoked `reparent-to-root` directly; asserted as an absence, which
     is the only way to assert that a capability is gone. */
  const entities = read("public/entities.js").replace(/\/\*[\s\S]*?\*\//g, "");
  ok(!/reparent-to-root/.test(entities), "no creator surface asks for the removed policy");
  ok(!/attach[^"'`]{0,60}base reference/i.test(entities), "and none offers to re-root a descendant");
  ok(/cannot be removed while/.test(entities), "the creator is told what depends on the state instead");
}

/* ===========================================================================
   5. THE COPY. Derivation direction is read from the graph. */

eq(Lineage.continuationDerivation(states(), ROOT_ID, CHILD).derivesFromCurrent, true, "a real child derives from the approved state");
const backwards = Lineage.continuationDerivation(states(), GRANDCHILD, CHILD);
eq(backwards.derivesFromCurrent, false,
  "and a state that does not is reported as not deriving — the dialog said the opposite, which misrepresented the derivation graph");
eq(backwards.parentName, "Rooftop working", "naming the parent it actually has");

/* ===========================================================================
   6. THE CALL SITES. */

const library = read("public/library-tools.js");
const code = library.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

ok(!/\[\.\.\.states\.slice\(index \+ 1\), \.\.\.states\.slice\(0, index\)\]/.test(code),
  "the cyclic rotation is gone");
ok(/continuationCandidates\(states, currentStateId\)/.test(code), "candidates come from the lineage rule");
ok(!/nextState\.parentStateId = targetStateId/.test(code),
  "the unconditional reparent is gone — this single line is what closed the cycle");
/* BATCH 1B: THERE IS NO LINEAGE WRITE ON THIS PATH AT ALL. The first repair
   left a narrowed one — establish a first parent — and the audit showed that a
   narrowed exception to a categorical rule is still a navigation-driven
   ancestry write. Asserted as an absence, which is the only way to assert that
   a rule has no remaining exception. */
ok(!/parentStateId\s*=/.test(code.split("window.confirmEntityApproval")[1] || ""),
  "the approval/continuation path assigns no parentage of any kind");
ok(!/safeParentAssignment/.test(code),
  "and it no longer even consults the write decision, because it has no write to make");
/* The reader is `entityStateListRead` since the simplification pass — the
   ambiguous `entityStateList` was renamed `ensureEntityStateList` so a caller
   can see which one writes. The property is unchanged: the continuation is
   re-validated at the writer, against the live collection. */
ok(/isValidContinuation\(entityStateListRead\(x, true\), targetStateId, requestedNextStateId\)/.test(code),
  "the requested next state is still re-validated at the writer, not trusted because it was in a select");

/* NO WRITER MUTATES ANCESTRY AFTER CREATION.

   OLD EXPECTATION (removed): an inventory asserting each of four files called
   `applyStateParentMutation`, plus an assertion that the creation-studio parent
   dropdown was built from an eligible-parent list.

   WHY IT IS NO LONGER VALID: it verified that reparenting was ROUTED. Alpha
   removed the operation, so the honest inventory is that no writer performs it
   at all — including the two the re-audit found outside the boundary entirely,
   `addContinuityState` (an object literal) and `removeContinuityState` (a
   splice), neither of which an assignment search could see.

   THE NEW INVARIANT: `parentStateId` is written in exactly one place per file —
   at CREATION, through the validator — and nowhere else. */

const LINEAGE_TOUCHING_FILES = [
  ["public/entities.js", "creation, deletion, the variant opener, correct-from-parent and the generic setter"],
  ["public/creation-studio.js", "the state generation panel, which used to carry the reparent dropdown"],
  ["public/automation.js", "entity-state automation, which used to assign the parent it resolved"],
  ["public/library-tools.js", "approval continuation, which used to establish a first parent"],
];
for (const [file, what] of LINEAGE_TOUCHING_FILES) {
  const source = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok(!/applyStateParentMutation|safeParentAssignment|planParentMutation/.test(source),
    `${file}: the removed reparent API is not called (${what})`);
  /* The only permitted assignments: normalisation initialising a missing key,
     and the creation record the validator produced. Anything else is a writer
     that can change ancestry after the fact. */
  const assignments = (source.match(/\.parentStateId\s*=(?!=)/g) || []).length;
  const normalisers = (source.match(/st\.parentStateId = st\.isDefault/g) || []).length;
  eq(assignments, normalisers,
    `${file}: every parentStateId assignment is a normaliser filling a missing key (found ${assignments}, normalisers ${normalisers})`);
}

const entitiesSource = read("public/entities.js");
ok(/applyStateCreation\(/.test(entitiesSource), "addContinuityState creates through the validator");
ok(/applyStateDeletion\(/.test(entitiesSource), "and removeContinuityState deletes through it");
ok(/reparentingUnsupported\(\)/.test(entitiesSource), "and the generic setter answers a reparent attempt with the named refusal");
ok(!/continuityStates\.splice\(/.test(entitiesSource.replace(/\/\*[\s\S]*?\*\//g, "")),
  "and nothing splices the collection behind the validator's back");

const studioSource = read("public/creation-studio.js");
ok(!/entityStateParentOptions/.test(studioSource), "the reparent dropdown is gone");
ok(/entityStateDerivationSummary/.test(studioSource),
  "replaced by a statement of what the state derives from — production truth stays on screen, it just stops being editable");

console.log(`State-lineage suite passed ${checks} checks: ancestry and descendants including on already-damaged data, ancestors never offered as continuations, a finished chain completing instead of wrapping to the root, navigation refusing to reparent, every permitted write proven cycle-free by exhaustion, derivation direction read from the graph, and the reveal opening the workspace that contains the editor.`);

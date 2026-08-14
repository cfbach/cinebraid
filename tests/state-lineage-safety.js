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

const afterGrandchild = Lineage.continuationCandidates(states({ withSibling: true }), GRANDCHILD);
eq(afterGrandchild.map((row) => row.id), [SIBLING],
  "after the deepest descendant the ONLY candidate is the unrelated sibling — the root and the child are its ancestors and the ring that offered them is gone");
ok(!afterGrandchild.some((row) => row.id === ROOT_ID), "the approved ancestor is not offered");
ok(!afterGrandchild.some((row) => row.id === CHILD), "nor the intermediate one");
ok(!afterGrandchild.some((row) => row.id === GRANDCHILD), "nor itself");

const afterRoot = Lineage.continuationCandidates(states({ withSibling: true }), ROOT_ID);
eq(afterRoot.filter((row) => row.isDirectChild).map((row) => row.id), [CHILD, SIBLING],
  "direct children are identified and come first — they are the states whose parent has just become available");
eq(afterRoot.map((row) => row.id), [CHILD, SIBLING, GRANDCHILD], "with the rest of the graph after them");

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
   4. THE WRITE. Navigation may not reparent, and no write may close a cycle. */

const navigation = Lineage.safeParentAssignment(states(), GRANDCHILD, ROOT_ID);
eq(navigation.write, false, "moving to a state does not re-declare where it came from");
eq(navigation.reason, "navigation-may-not-reparent", "and the refusal names the rule");
eq(navigation.parentStateId, CHILD, "reporting the parent that stays, so a caller can render the truth");

const cycle = Lineage.safeParentAssignment(states(), ROOT_ID, GRANDCHILD, { allowReparent: true });
eq(cycle.write, false, "even an explicit reparent may not put an ancestor beneath its descendant");
eq(cycle.reason, "default-state-is-the-root", "the root refuses first, because it is the root");

const cycleFromChild = Lineage.safeParentAssignment(states(), CHILD, GRANDCHILD, { allowReparent: true });
eq(cycleFromChild.write, false, "and a non-root reparent that would close a cycle is refused");
eq(cycleFromChild.reason, "would-create-cycle", "by name");

const firstParent = Lineage.safeParentAssignment(
  [{ id: ROOT_ID, isDefault: true, parentStateId: "" }, { id: "st-new", name: "New", parentStateId: "" }],
  "st-new", ROOT_ID,
);
eq(firstParent.write, true, "a state that declares NO parent may still acquire its first one");
eq(firstParent.parentStateId, ROOT_ID, "which is the only lineage write navigation is allowed to make");
eq(Lineage.safeParentAssignment(states(), CHILD, ROOT_ID).reason, "already-declared", "and re-declaring the same parent is a no-op");

/* Applying every legal write leaves the graph acyclic. */
const mutated = states({ withSibling: true });
for (const node of mutated) {
  for (const candidate of mutated) {
    const decision = Lineage.safeParentAssignment(mutated, node.id, candidate.id, { allowReparent: true });
    if (decision.write) node.parentStateId = decision.parentStateId;
  }
}
eq(Lineage.lineageCycles(mutated), [], "exhaustively applying every write the rule permits cannot produce a cycle");

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
ok(/safeParentAssignment\(entityStateList\(x, true\), nextState\.id, targetStateId\)/.test(code),
  "and the write goes through the decision function");
ok(/if \(assignment\.write\) nextState\.parentStateId = assignment\.parentStateId/.test(code),
  "which the caller obeys rather than second-guesses");
ok(/isValidContinuation\(entityStateList\(x, true\), targetStateId, requestedNextStateId\)/.test(code),
  "and the requested next state is re-validated at the writer, not trusted because it was in a select");
ok(/continuationDerivation\(states, stateId, nextState\.id\)/.test(code), "the copy reads direction from the graph");

/* The reveal must open the workspace that CONTAINS the editor. A flow launched
   from Review used to write the coverage subview and the selected state, and
   leave the workspace on Review — where no continuity-state editor exists. */
ok(/boundedWriteFocusedTask\?\.\("entity-task", `\$\{list\}:\$\{id\}`, "coverage"\)/.test(code),
  "revealEntityContinuityState selects the Coverage task explicitly");
ok(/boundedWriteState\?\.\("selected:entity-coverage-view"/.test(code), "as well as the coverage subview");
ok(/boundedWriteState\?\.\("selected:continuity-state"/.test(code), "and the exact state");
ok(/window\.route\?\.\(\)/.test(code), "and re-renders, so the editor is actually on screen");

console.log(`State-lineage suite passed ${checks} checks: ancestry and descendants including on already-damaged data, ancestors never offered as continuations, a finished chain completing instead of wrapping to the root, navigation refusing to reparent, every permitted write proven cycle-free by exhaustion, derivation direction read from the graph, and the reveal opening the workspace that contains the editor.`);

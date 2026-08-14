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

/* CHANGED IN BATCH 1B, and this is the correction the acceptance audit named.

   This block used to assert that navigation "may still acquire its first
   parent", calling that "the only lineage write navigation is allowed to make".
   The invariant does not have an exception clause: NAVIGATION NEVER MUTATES
   LINEAGE. The audit offered an orphan state as a continuation target and
   watched a movement button declare its ancestry. Establishing parentage is a
   separate, explicit act, and it goes through a separate, explicit intent. */

const orphanStates = [{ id: ROOT_ID, isDefault: true, parentStateId: "" }, { id: "st-new", name: "New", parentStateId: "" }];
const firstParentByNavigation = Lineage.safeParentAssignment(orphanStates, "st-new", ROOT_ID);
eq(firstParentByNavigation.write, false, "a state that declares NO parent does not acquire one from navigation either");
eq(firstParentByNavigation.reason, "navigation-may-not-reparent", "the rule is categorical, and the refusal names it");

const firstParentByEdit = Lineage.planParentMutation(orphanStates, "st-new", ROOT_ID, { intent: "explicit-lineage-edit" });
eq(firstParentByEdit.write, true, "an EXPLICIT lineage edit may establish a first parent");
eq(firstParentByEdit.parentStateId, ROOT_ID, "with the parent the creator chose");
eq(firstParentByEdit.reason, "establishing-first-parent", "and the reason distinguishes it from a reparent");
eq(Lineage.safeParentAssignment(states(), CHILD, ROOT_ID).reason, "already-declared", "and re-declaring the same parent is a no-op");

/* A REFUSED MUTATION LEAVES THE PROJECT ALONE. Asserted on the object itself,
   because "returns write:false" and "wrote nothing" are different claims and
   only the second one is the property that matters. */
const untouched = states();
const before = JSON.stringify(untouched);
const refused = Lineage.applyStateParentMutation(untouched, CHILD, GRANDCHILD, { intent: "explicit-lineage-edit" });
eq(refused.applied, false, "a cycle-closing mutation is refused");
eq(JSON.stringify(untouched), before, "and the state collection is byte-identical afterwards — a rejected edit does not dirty the project");

/* Applying every legal write leaves the graph acyclic. */
const mutated = states({ withSibling: true });
for (const node of mutated) {
  for (const candidate of mutated) {
    Lineage.applyStateParentMutation(mutated, node.id, candidate.id, { intent: "explicit-lineage-edit" });
  }
}
eq(Lineage.lineageCycles(mutated), [], "exhaustively applying every write the rule permits, through the one mutation API, cannot produce a cycle");

/* THE PARENT CHOICES A SURFACE MAY OFFER exclude self and every descendant, so
   the control cannot present the move the validator will refuse. */
eq(Lineage.eligibleParentIds(states({ withSibling: true }), CHILD).sort(), [ROOT_ID, SIBLING].sort(),
  "the child may derive from the root or the sibling — never from itself, never from its own grandchild");
ok(!Lineage.eligibleParentIds(states(), ROOT_ID).includes(CHILD), "and a descendant is never offered as a parent");

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
ok(/isValidContinuation\(entityStateList\(x, true\), targetStateId, requestedNextStateId\)/.test(code),
  "the requested next state is still re-validated at the writer, not trusted because it was in a select");

/* EVERY OTHER ANCESTRY WRITER GOES THROUGH THE ONE MUTATION API. The audit found
   four bypasses; this is the inventory that keeps a fifth from appearing. */
const lineageWriters = [
  ["public/creation-studio.js", "the exposed parent selector — the writer that could close a cycle from the UI"],
  ["public/entities.js", "the continuity variant opener, the correct-from-parent path and the generic state setter"],
  ["public/automation.js", "entity-state automation"],
  ["public/app.js", "import and normalisation compatibility"],
];
for (const [file, what] of lineageWriters) {
  const source = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok(/applyStateParentMutation\(/.test(source), `${file}: ${what} routes through the one mutation API`);
  const rawAssignments = (source.match(/\.parentStateId\s*=(?!=)/g) || []).length;
  const permitted = (source.match(/st\.parentStateId = "";/g) || []).length;
  ok(rawAssignments === permitted,
    `${file}: no raw parentStateId assignment survives outside the validator (found ${rawAssignments}, permitted ${permitted} — normalisation may only initialise the field to an empty string)`);
}
const studio = read("public/creation-studio.js");
ok(/entityStateParentOptions\(entity, state, parentInfo\.parent\?\.id \|\| ""\)/.test(studio),
  "the parent dropdown is built from the eligible set");
ok(/eligibleParentIds\(states, state\.id\)/.test(studio),
  "which excludes self and every descendant, so the control cannot offer the move the validator refuses");
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

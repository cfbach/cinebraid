# CineBraid Dogfood #2 — Repair Batch 1B Independent Architecture Re-Audit

Audit date: 2026-08-14

Audit target: `fix/dogfood2-production-trust-architecture` at `b23d2313ae9d3cc789dfa09c91ac703c3580b55a`

Stated Repair Batch 1A predecessor: `fix/dogfood2-production-trust` at `16701449f3b1a0639911029be50195d5ad1baafc`

Method: read-only repository/source/history inspection, in-memory fixtures, the repository VM render harness, scratch-directory route fixtures, mocked provider traps, focused tests, and the full local verification harness. No real provider, network, credential, or local-model call was made. No production project data was changed.

## 1. Executive verdict

**HOLD — ARCHITECTURAL ISSUE REMAINS**

Batch 1B makes substantial, relevant improvements. Honest, well-formed authority receipts now drive the normal gate path; reconciliation is bidirectional in the tested scenario; the paid image route contains a final-prompt gate in the right nominal location; the core ownership resolver is conservative; ordinary reparenting goes through a cycle check; and stale correction targets now receive typed errors before the former dereference.

Those improvements do not satisfy the decisive acceptance criterion. Reachable production paths can still create or consume false authority, dispatch a locally invalid paid request, approve contested media, write malformed lineage, and pass correction preflight by mutating the missing structure into existence.

| Area | Verdict | Decisive independently reproduced counterexample |
|---|---|---|
| A1 human production authority | **FAIL — Critical, high confidence** | The public predicate accepts a caller-created `{ actor: "human", act: "explicit-approval" }`; the command then writes a winner and mints a human receipt. A malformed ledger row whose actor is `automation` is also consumed as current human authority. Edge and receipt are not atomic. |
| A2 gate reconciliation/resume | **FAIL — Critical, high confidence** | `applyGateReconciliation` accepts any non-empty `receiptId`, without a project or ledger, and completed a real step with `authorityReceiptId: "not-a-real-receipt"`. |
| A3 final-prompt presence gate | **FAIL — Critical, high confidence** | A non-empty but unknown frame ID, a double-negative positive assertion, and malformed presence data each reached the real FAL route's provider trap and committed one unresolved paid-job row. |
| A4 media ownership | **FAIL — Critical, high confidence** | The core resolver passes, but the real batch coverage writer approved `SHARED.png` into an authoritative slot while the resolver simultaneously reported two claimants and `authoritative: false`. |
| A5 state lineage | **FAIL — Critical, high confidence** | `addContinuityState` writes its first parent directly; deleting an ancestor leaves a dangling child; duplicate and dangling IDs are accepted as “acyclic.” |
| A6 correction preflight | **FAIL — Critical, high confidence** | Preflight calls mutating `guidedFrames`, creates a missing opening frame, reports no error, and the real correction runner proceeds to the mocked dispatch boundary. |

The architecture suite's 186 checks and all 37 controls pass because these exact cases are absent from their test matrices or inventories.

## 2. Repository and branch receipt

| Receipt item | Observed | Result |
|---|---|---|
| Repository root | `C:\CineBraid\CineBraid-Source` | Expected |
| Branch | `fix/dogfood2-production-trust-architecture` | Exact |
| HEAD | `b23d2313ae9d3cc789dfa09c91ac703c3580b55a` | Exact expected `b23d231` |
| `origin/main` | `afe1853ce2fa69f43489822c0e86d5a4c45ea3f6` | Expected baseline |
| Main relationship | `origin/main...HEAD = 0 / 6` | Six commits ahead, not behind |
| Stated Batch 1A relationship | `1670144...HEAD = 0 / 3` | Batch 1A is an ancestor |
| Architecture remote | `origin/fix/dogfood2-production-trust-architecture...HEAD = 0 / 0` | Local and remote agree |
| Worktree before audit | Clean | Expected |
| Worktree after all tests, before this report | Clean | No test residue |

One contextual mismatch was reported before continuing: `origin/fix/dogfood2-production-trust` is no longer at the brief's stated `1670144`; it is at `8b1606e25a2f9f23f89c84d0f58185b4a143e2c0`, the committed prior acceptance audit. The implementation comparison in this report uses the explicitly named `1670144` predecessor. The architecture branch descends from both commits.

The three commits after the stated predecessor are:

1. `8b1606e` — prior acceptance audit checkpoint, documentation only.
2. `3c98006` — Batch 1B source and tests.
3. `b23d231` — Batch 1B architecture handoff, documentation only.

The implementation commit contains 30 files, 3,333 insertions, and 316 deletions, including the new 690-line architecture suite. The handoff's 29-file/2,643-insertion figure is the same scope with that suite excluded. The full `1670144..HEAD` diff contains 32 files, 4,118 insertions, and 316 deletions, including both audit documents. No project data, generated media, provider state, credential, environment configuration, or unrelated feature area entered the diff.

`git diff --check 3c98006^..3c98006` passes. `git diff --check 1670144..HEAD` reports only the intentional Markdown hard-break whitespace on lines 3–5 of the committed prior acceptance audit; no implementation whitespace defect was found.

Canonical evidence blobs are byte-identical between `1670144` and HEAD:

| Document | Blob at both revisions |
|---|---|
| Dogfood Pass #2 closeout | `d28b4e1e04b345169dddc1b70139b34cb0ba4201` |
| Dogfood #2 forensic audit | `8d066f5b934ea893cc025f871a5fc665e4a4a40c` |
| Repair Batch 1 handoff | `f018740ac92d837593a02385bc7e83356a8673fb` |

## 3. A1 — human production authority

**Verdict: FAIL — Critical severity, high confidence.**

### 3.1 Actor provenance is caller-controlled

`public/shared-production-authority.js::isHumanAuthorityGrant` accepts exactly two string fields. `humanAuthorityGrant` is exported to Node and `window` and constructs those same fields for any caller. There is no authenticated identity, trusted UI event, one-time capability, or server-side action provenance behind the result.

Operationally, “human” currently means “a caller supplied the two accepted strings or invoked the public builder.” A machine caller can invoke the same function. `public/scene-automation.js` does so after reading cached `reviewed.result?.humanApproved`, illustrating that the builder is not isolated to a trusted human event handler.

An in-memory call through the shipped frame authority writer produced:

```json
{
  "accepted": true,
  "winner": "FORGED.png",
  "receiptActor": "human",
  "receiptVia": "caller-controlled"
}
```

The architecture suite rejects `{}`, `true`, `"human"`, `{ actor: "human" }`, `{ act: "explicit-approval" }`, and an explicit automation actor. It omits the exact caller-created object the production predicate accepts: `{ actor: "human", act: "explicit-approval" }`.

**Required correction:** define human action provenance as a trusted, non-caller-constructible capability in normal application flow. In this single-user/local architecture, that can be a one-use token issued and consumed by the trusted human event boundary or an equivalent server-validated command receipt. An actor string or publicly callable builder cannot be the authority credential.

### 3.2 Receipt readers do not validate a human receipt

`currentAuthorityReceipt` filters only target identity and `status === "current"`. `currentHumanAuthority` then checks that the live filename or asset ID matches. It does not validate the receipt's actor, act, command, ID, sequence, internal target fields, uniqueness, or schema.

A persisted fixture with all of the following was accepted as current human authority and satisfied a gate:

- blank receipt ID;
- sequence zero;
- `actor: "automation"`;
- blank act and command;
- matching `targetId` but deliberately wrong `shotId` and `frameId` fields;
- matching live value.

Multiple current rows are not rejected; the last is silently chosen. A ledger whose sequence was reset minted a second `authority-000001`, leaving two different decisions with the same durable ID. These are ordinary malformed-project/read-path cases, not cryptographic attacks.

**Required correction:** validate the full durable receipt schema at every consuming boundary; require an accepted human provenance, allowed command, canonical target descriptor, non-empty unique ID, monotonic sequence, exactly one current receipt per target, and a value/asset identity matching the live edge. Malformed or duplicate ledgers must fail closed and surface a repair diagnostic.

### 3.3 Edge plus receipt is not atomic

`commandProductionAuthority` calls the caller's `applyEdge` before `ensureAuthorityLedger`, supersession, sequence allocation, and receipt insertion. It has no rollback.

With a non-extensible project root but mutable nested shot data, the shipped command:

- changed the frame winner to `PARTIAL.png`;
- returned `authority-000001`;
- persisted no `productionAuthority` ledger;
- threw no error.

An `applyEdge` callback that mutates and then throws likewise leaves a partial edge. The single-threaded synchronous section prevents `await` interleaving, but it does not make multi-object mutation crash-safe or exception-safe.

**Required correction:** validate and stage the edge and ledger update against one draft document, then persist that complete project atomically. A failed edge callback or failed ledger persistence must commit neither side. Receipt ID allocation must be checked against durable existing IDs.

### 3.4 Alternate writers remain

Repository-wide write inspection disproves the handoff's “every frame or shot winner” claim:

- `public/library-tools.js::confirmApproveTake` writes `s.winner` directly when the approved primary shot output is video because `opening` is deliberately set to `null` for video. The same normal human flow writes `videoWinner`, `approvedMotionFile`, clip endpoints, and canonical selection fields outside the authority command.
- `public/creation-studio.js::markGuidedStillFinal` falls back to direct `s.winner` assignment when no opening frame exists.
- Coverage/expression approval writers create approval-equivalent canonical pointers outside the receipt model; section 8 establishes that these pointers are consumed as authority.
- Several normalization/import compatibility writers copy approval fields directly. Copying an already unauthoritative edge does not mint a receipt, which is safe for gate truth, but it demonstrates that a maintained list of call sites is not an architectural write barrier.

The normal honest-ledger frame/entity-state paths now behave correctly: a bare legacy winner is presented as historic, does not satisfy the gate, and revocation/resume does not resurrect it. That is a real repair. It is not universal across canonical production selections.

### 3.5 OFP/export remains semantically dishonest

The narrow previous finding remains unchanged. `ofp/ofp-migrate-rules.js` M013 calls `context.approve` for any non-empty frame/shot winner, entity/state approved file, creation final file, and coverage approved file without consulting the Batch 1B receipt ledger. M030 then materializes the asset/reference edge. It does not create an OFP human-approval statement, but it still exports an automatic, unknown, malformed, or unreceipted selection as an approved-output reference.

**Required correction:** make authoritative export edges receipt-aware. Preserve legacy/machine/unknown selections as workflow evidence or non-authoritative references, not approved production output.

## 4. A2 — gate reconciliation and resume authority

**Verdict: FAIL — Critical severity, high confidence.**

Against a well-formed ledger, the new model is materially better:

- a bare winner does not close a gate;
- a valid receipt plus matching live edge does;
- supersession preserves history;
- revocation reopens a completed gate;
- `resumeAuthority` reads current project authority rather than the cached step boolean;
- an unidentifiable parked gate remains actionable.

The architectural application boundary is still forgeable. `applyGateReconciliation(run, plan)` does not receive the project or ledger. Its only citation check is that `requirement.receiptId` is non-empty. A hand-built plan containing `receiptId: "not-a-real-receipt"` changed a real `needs-review` step to:

```json
{
  "status": "completed",
  "pass": true,
  "result": {
    "humanApproved": true,
    "authorityReceiptId": "not-a-real-receipt",
    "satisfiedByReconciliation": true
  }
}
```

It also moved the run to `interrupted`. No durable receipt existed. The positive test and architecture-suite guard assert only that the ID is non-empty, reproducing the production defect as the test contract.

Deleted honest receipts and cleared edges fail closed in the nominal planner. Malformed receipts do not, because the reader accepts them as described in A1. A receipt can also carry a matching `targetId` while its component object fields identify something else. Therefore reload, polling, restart, and resume converge only when the ledger is assumed valid.

**Required correction:** the reconciliation applier must revalidate the cited receipt against the current durable project snapshot, exact target, actor/action/command schema, current status, and live edge immediately before writing the run. Alternatively, make a planner-issued opaque plan inseparable from the verified snapshot and unconstructible by ordinary callers. A bare non-empty ID is not evidence.

## 5. A3 — final-prompt temporal presence gate

**Verdict: FAIL — Critical severity, high confidence.**

### 5.1 What is correctly placed

The universal gate is in the correct nominal route and order. `fal-generation.js` builds the job, optionally replaces `job.prompt` with compiled/submitted text, validates correction provenance, then calls `finalDispatchPresenceGate` using `job.prompt` and reference labels/instructions. The call precedes `submissionAccounting`, job `commit`, and `submit`.

The new architecture suite exercises this real handler with a global fetch trap and scratch ledgers. Its legitimate-request control proves the trap is live; disabling the gate in memory reaches the FAL URL. The mock is not too high in the stack.

Mention handling correctly catches the former spatial-`before` example, `without hesitation`, `not only`, positive/negative repetition, case changes, punctuation, parentheses, aliases, and multiple absent entities. It permits “Before the Sweep appears,” “No Sweep is visible,” and “Without the Sweep.” “After the Sweep exits” and quoted dialogue are conservatively over-blocked; those are usability/parser-scope issues, not unsafe dispatches.

### 5.2 Unknown frame IDs fail open

When a shot declares frame presence and `frameId` is non-empty, the gate never verifies that the ID belongs to the shot. `absentEntitiesForFrame` returns an empty list for an unknown ID, and the gate returns `ok: true, reason: "no-declared-absence"`.

The real route was called with `frameId: "not-a-frame"` and a positive Sweep prompt. The provider mock recorded one attempt, the route returned `502 GENERATION_UNRESOLVED`, and the scratch ledger contained one committed job row. This is precisely the paid-boundary failure the missing-ID test was intended to prevent.

### 5.3 Malformed declarations and double negatives fail open

A frame presence value shaped as `{ state: "absent" }` is silently normalized out. Because another frame on the shot had a valid declaration, the shot was considered governed, but the malformed target frame resolved to no absent entities and passed.

Two semantically positive prompts were classified as denial and passed:

- `The room is not without the Chimbley Sweep.`
- `No Chimbley Sweep is invisible.`

The first and the malformed-declaration case were each driven through the real dispatch route. Each reached the provider trap and committed one job row. No real network request left the process.

**Required correction:** for a governed shot, require a frame ID that resolves to an actual frame and a parseable declaration record for that frame. Treat malformed declaration values as a typed local-preflight refusal. Extend only the existing denial grammar enough to handle positive double-negatives safely, with explicit tests. Every refusal must remain before accounting and commit.

## 6. A4 — media ownership

**Verdict: FAIL — Critical severity, high confidence.**

The core `resolveMediaOwnership` contract passes independent inspection and probes:

- one unique durable claim returns `basis: "durable-claim"`, `authoritative: true`;
- zero claims may return a discoverable prefix inference but never authority;
- multiple claimants return no owner and `authoritative: false`;
- `entityOwnsMedia` requires both authority and the exact owner;
- the entity approval-capable pool excludes inferred and contested files;
- the entity-state authority command contains an ownership eligibility veto;
- the shared production-media reader fails closed if the resolver is unavailable;
- server/Bible media selection uses the shared filter.

The boundary is not applied to every authoritative slot writer. `public/review.js::confirmEntityBatchApproval` directly assigns coverage/expression `slot.approvedFile` and marks it approved without re-resolving ownership. A real VM-rendered batch approval was given a stale shortlist for `SHARED.png`, durably claimed by both `CHAR-A` and `CHAR-B`. Before and after the write, the resolver returned:

```json
{
  "ownerId": "",
  "basis": "contested",
  "claimants": ["CHAR-A", "CHAR-B"],
  "authoritative": false
}
```

Nevertheless the writer set `CHAR-A.coverageSlots[0].approvedFile = "SHARED.png"`, `status = "approved"`, recorded approval provenance, and added the item to the batch's approvals. `applyCoverageAssignment` is another direct setter without a commit-time ownership check; UI option filtering is not an inner veto and cannot protect stale state.

**Required correction:** every coverage/expression writer—single, batch, manual replacement, automation, import/claim, and stale-modal commit—must route through one commit-time boundary that rechecks current ownership and refuses contested/unowned bytes before writing.

## 7. A5 — state lineage

**Verdict: FAIL — Critical severity, high confidence.**

The existing reparent boundary correctly rejects self-parenting, direct/deep cycles, unknown parents, navigation intent, and mutation into an already cyclic graph. Refused mutations through that function leave the target unchanged. The parent selector excludes descendants.

The “only writer” claim is false because the test inventory searches assignments but not object-literal creation or deletion:

- `public/entities.js::addContinuityState` pushes a new state with `parentStateId: defaultState?.id || "state-default"` directly. A real rendered call created a first-parent edge without `applyStateParentMutation`.
- `public/entities.js::removeContinuityState` splices an ancestor without repairing, refusing, or explicitly orphaning its children. Removing `child` from `root → child → grand` left `grand.parentStateId === "child"` while no `child` existed.
- `lineageIsAcyclic` validates only cycles. It returns true for duplicate state IDs and for dangling parent IDs.
- With two states sharing ID `dup`, the simulated graph updates both matching copies, while `applyStateParentMutation` commits only the first. A probe returned `applied: true` and left one `dup → other` and the second `dup → root`; the validated graph was not the committed graph.

The deletion result was still reported as acyclic, which demonstrates that “acyclic” is not a sufficient graph-integrity predicate.

**Required correction:** centralize graph creation, reparent, and deletion, not only field assignment. Validate unique non-empty state IDs, exactly one root/default policy, referential integrity of every parent, and the exact post-mutation collection before commit. Deleting an ancestor must explicitly refuse, cascade, or reparent children through the same boundary. Tests must exercise add/remove, duplicate IDs, dangling parents, and stale collection snapshots through real writers.

## 8. A6 — correction preflight

**Verdict: FAIL — Critical severity, high confidence.**

The reordered path fixes the prior deleted-target `TypeError`: identity is read safely, a missing target produces a typed `local-package` error, absent/deleted neighbors are optional omissions, and the retry classifier excludes `local-package` and `local-preflight` from attempt consumption.

The missing-frame preflight is not pure. `v640SceneCorrectionPreflight` calls `v640SceneOpeningFrame`, which calls `guidedFrames(shot)`. `guidedFrames` normalizes the shot and creates a new opening frame whenever none exists.

In the real browser module graph, a shot with zero keyframes and an approved still produced:

```json
{
  "errors": [],
  "createdFrameId": "frame-a-…",
  "keyframeCountBefore": 0,
  "keyframeCountAfter": 1
}
```

With only the paid dispatcher replaced by a test double, the real `v640AutomateSceneCorrection` then reached that dispatch double once and threw `MOCK DISPATCH REACHED`. The project fixture retained the newly created frame. The missing-frame case therefore neither fails fast nor leaves state unchanged.

Malformed `keyframes` values take the same normalization route. The architecture suite's “target with no approved still” case contains a valid frame, so it does not test this condition.

**Required correction:** correction preflight must use non-mutating structural reads. It must reject a missing/malformed frame with a typed deterministic error before hydration, run-step creation, job creation, or dispatch. Normalization and frame creation must be a separate explicit mutation outside preflight.

## 9. Deliberate coverage/expression receipt scope

**Blocker, not P1.**

Coverage and expression slots are currently more than display pointers:

- `public/coverage-automation.js` turns approved slots into generation references.
- `server.js` sends them to entity review as “approved alternate-view design authority” or location geometry authority.
- `public/shared-production-media.js` recognizes `approved-coverage` and `approved-expression` dispositions.
- OFP M013/M030 exports non-empty coverage `approvedFile` values through the approved-output/reference path.
- Single and batch approval writers set `humanApproved`, approval provenance, approved status, and replacement history.

They can therefore become generation authority, continuity/design authority, export authority, and implicit human approval. The handoff's premise—“not a gate object, therefore no receipt required”—confuses gate scheduling with production authority. The ownership veto is necessary but not sufficient, and it is itself bypassed by the batch writer.

**Required correction:** either extend the durable authority command/receipt target model to coverage and expression slots or stop all authority consumers from treating those pointers as approved/canonical. The current mixed contract is release-blocking.

## 10. Mutation-control harness audit

**Verdict: PARTIAL FAIL — anti-no-op repair is real; expected-cause proof remains unsound.**

What works:

- `mutate` counts the exact anchor and throws a plain `Error` when the count differs, so a missing/stale anchor is no longer swallowed as a successful control.
- It replaces all exactly counted occurrences, and `build` executes the resulting module in a fresh VM realm.
- The CG control loads a mutated copy of the real FAL route from a scratch directory, installs the fetch trap at the network boundary, and deletes the scratch state. It is a strong anti-vacuity control.
- In-memory/scratch mutation leaves the working tree unchanged; the unmutated positive suites run afterwards.

What remains unsound:

- `control` still treats **any** `AssertionError` in the callback as success. It does not verify which assertion failed, the message, the mutated behavior, or that execution reached the post-mutation assertion.
- C18 and C19 contain baseline “probe receipt” assertions inside `control`. If either baseline assertion fails, the harness reports the mutation control as successfully fired before the mutation is even applied.
- C15b's fixture starts with an `a ↔ b` cycle, then asserts that `lineageCycles(damaged).length` is zero. The assertion is already false before the tested mutation. It therefore passes for an unrelated pre-existing condition and does not prove the resulting-graph guard is load-bearing.
- C2b proves only that an empty receipt ID is rejected. It does not test a non-empty nonexistent, wrong-target, malformed, duplicate, or stale receipt—the exact production gap found in A2.

The independently run route probe re-proved the strongest intended anti-vacuity behavior without network access: locally accepted invalid requests hit the mocked `https://queue.fal.run/openai/gpt-image-2` boundary and left a committed unresolved job row. The CG control itself asserts the provider-attempt count but does not assert the committed-row consequence.

**Required correction:** controls must assert a typed/identified failure outcome rather than accepting any assertion. Put baseline preconditions outside the catch-as-success region, record that the mutation was executed, and require the specific post-mutation assertion/message. Repair C15b with a fixture whose precondition passes before mutation and whose exact resulting graph becomes newly invalid after mutation.

## 11. Test quality and five changed expectations

The observed count claims are correct for the focused aggregate:

| Suite | Observed |
|---|---:|
| Production authority | 94 |
| Frame presence | 63 |
| Entity ownership | 52 |
| State lineage | 71 |
| Correction boundary | 47 |
| New architecture suite | 186 |
| **Positive total** | **513** |
| Negative controls | **37, all reported fired** |

The handoff also says “Positive assertions: 413” earlier in section 8; that is an internal documentation arithmetic error. Its later 513 total is correct.

The architecture suite is materially stronger than Batch 1's helper/source-only coverage. It drives the real FAL handler, real render-harness UI writers, real reconciliation state, and real correction runner for the cases it includes. Its fetch trap and scratch ledger make provider/row assertions meaningful.

It remains incomplete at the architectural seams:

- authority tests use the public grant builder and omit the exact forged accepted shape;
- reconciliation tests validate only that a receipt ID is non-empty;
- presence tests cover missing `frameId`, not an unknown non-empty ID or malformed declaration;
- ownership browser tests exercise claimability but not contested/stale batch approval;
- lineage tests exercise reparent setters, not add/delete, duplicate IDs, or dangling parents;
- correction tests cover missing target/still/prompt, not a missing or malformed frame;
- source-pattern caller inventories cannot prove absence of object-literal or alternate-field writers.

The five changed expectations are individually justified and do not themselves weaken unrelated behavior:

| Change | Assessment |
|---|---|
| Resume no longer trusts cached `result.humanApproved` | Correct and required; current receipt truth must be re-read. The remaining flaw is receipt validity, not this expectation. |
| Hand-written winner no longer satisfies a gate; fixtures approve through the command | Correct and required; preserves the legacy edge as historic. The command's credential/atomicity defects are separate. |
| Unclaimed prefix match split from approval pool into discoverability | Correct and required; visibility remains without authority. |
| Contested file no longer attributed to the most-specific claimant | Correct and required; conflict cannot be resolved by the heuristic that created it. |
| Navigation first-parent exception and sibling continuation removed | Correct and required; navigation must not write ancestry and continuation is descendants-only. |

No unrelated expectation weakening was found in these five edits. The acceptance failure comes from missing cases and incomplete boundaries around them.

## 12. Validation and regression receipt

| Command/probe | Exit/result | Receipt |
|---|---:|---|
| `npm.cmd run check:dogfood2-p0` | 0 | 513 positive assertions; 37 controls reported fired; wall time 10.5s |
| `npm.cmd run check` | 0 | `CineBraid full verification passed: 167 suites in 94.4s.` |
| Implementation `git diff --check` | 0 | No Batch 1B implementation whitespace errors |
| Worktree after tests | Clean | No tracked or untracked residue before report creation |

The full harness skipped optional Python real-browser suites because no Python 3 interpreter is installed. The Node browser/render suites ran. The expected simulated composer-crash diagnostics and Windows `Get-CimInstance: Access denied` shutdown diagnostic appeared; the harness still completed, and its port-rebind check passed.

No paid provider call and no local-model call occurred. All provider-boundary probes replaced `globalThis.fetch` or the runner's dispatch function with local counters that threw. Scratch project/job ledgers were created under the system temporary directory and removed. The preserved Dogfood project was not read for mutation or written.

No broad unrelated regression is exposed by the green full suite. That does not reduce the severity of the trust-boundary counterexamples.

## 13. Exact blockers before merge

1. Replace caller-asserted human strings/public grant construction with trusted, one-use human action provenance unavailable to ordinary machine callers.
2. Validate receipt actor/action/command, canonical target, value/identity, ID uniqueness, sequence, and exactly-one-current status at every consumer.
3. Make edge plus receipt one exception-safe, crash-safe durable project transaction; prevent duplicate receipt IDs.
4. Route all canonical frame, shot, video/motion, entity, coverage, expression, and export-authority writes through the appropriate inner command boundary.
5. Make reconciliation verify the cited durable ledger item immediately before completing a step; reject arbitrary non-empty IDs and malformed/wrong-target receipts.
6. Fail closed on unknown frame IDs and malformed presence declarations; cover positive double-negatives at the real dispatch route.
7. Revalidate ownership inside every coverage/expression commit path, including batch and stale UI state.
8. Extend authority receipts to coverage/expression slots or remove their current generation/continuity/export/implicit-human authority semantics.
9. Centralize lineage creation and deletion, enforce unique IDs and referential integrity, and validate the exact committed graph.
10. Make correction preflight non-mutating and refuse missing/malformed frames before the runner can dispatch.
11. Make negative controls prove the intended failure cause; repair C15b and move baseline assertions outside the swallowed-assertion region.
12. Make OFP authoritative-output migration conditional on valid durable authority rather than a non-empty legacy pointer.

## 14. Final verdict

**HOLD — ARCHITECTURAL ISSUE REMAINS**

Batch 1B corrects the originally demonstrated happy-path architecture but does not make the P0 invariants unavoidable. The independent counterexamples are reachable through shipped functions and real local application routes, produce durable false state or a mocked paid-dispatch attempt, and are not caught by the current 167-suite verification.

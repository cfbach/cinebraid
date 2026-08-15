# CineBraid Dogfood #2 — Repair Batch 1C Final Production-Trust Kernel Acceptance Audit

**Audit date:** 2026-08-14

**Repository:** `C:\CineBraid\CineBraid-Source`

**Branch:** `fix/dogfood2-production-trust-kernel`

**Audited HEAD:** `ee24dabf2f1cbfd8336f952ee4d6b74fef55bc45`

**Implementation tree:** `3c5fe9c769b3e0434efd243f3174f5dfd9ce1268`

**Baseline:** `b23d2313ae9d3cc789dfa09c91ac703c3580b55a`

## FINAL VERDICT

# HOLD — ARCHITECTURAL ISSUE REMAINS

Batch 1C is a substantial improvement, but its simplified production-truth model is still conceptually bypassable and internally contradictory. This is not a HOLD for enterprise identity, cryptography, distributed transactions, or harmless dead code. Ordinary shipped CineBraid boundaries can still manufacture or report human Canon without satisfying the intended rule, and the shipped lineage UI still performs reparenting.

The strongest green test receipt—624 focused assertions, 19 rewritten controls, and 167 full suites—does not disprove the findings below. Several current expectations expressly permit the counterexamples, and the new negative-control matrix omits them.

## 1. Executive decision

The target alpha explanation was:

> Human explicitly approves Canon. Automation only recommends. Supporting references are not Canon. Legacy pointers are historic. State ancestry is immutable. Preflight does not mutate.

The implementation presently needs these additional caveats:

1. Browser code can install the exported harness gesture source and mint a human receipt without a trusted user-agent event.
2. A manual capability is bound to the target key, but not to the value or asset the UI displayed when it was minted.
3. Entity ownership is a caller-supplied optional callback; both a generic exported writer and the entity writer's override path can omit or replace the veto.
4. Results and Inspector still turn an unreceipted legacy pointer into `approved`, `Approved by you`, and `production canon`.
5. A current receipt is accepted when either its filename or its asset identity matches, so a contradictory wrong value or wrong asset remains authoritative.
6. The “immutable” lineage module and creator UI explicitly expose `reparent-to-root`; normalization also fills ancestry after creation.
7. The transaction boundary cannot enforce its claimed isolation: an eligibility callback receives the live project, and an edge callback can mutate it through a closure before throwing.

Those are alternate authority and mutation paths, not finite polish leaks. The architecture is therefore not yet the single small trust kernel Batch 1C claims.

### Merge blockers

| ID | Blocker | Independently observed consequence |
|---|---|---|
| MB-1C-01 | Test-harness gesture installer ships as a browser export | Ordinary browser code installed `harness`, opened a synthetic gesture, minted a one-use capability, committed `VALUE-B`, and received an `actor: "human"` receipt without a trusted browser event. |
| MB-1C-02 | Capability does not bind the displayed value/asset | A capability minted while the UI target carried value `A` / asset `asset-A` committed value `B` / asset `asset-B` for the same target. |
| MB-1C-03 | Ownership veto is optional and caller-overridable | The real resolver rejected `SHARED.png` as contested between two entities; the exported generic writer and the entity writer with a supplied `eligibility: () => ({ok:true})` both established Canon anyway. |
| MB-1C-04 | Legacy pointer remains a second production-truth representation | With no authority ledger, a raw frame winner projected as disposition `approved` and human decision `approved`; Results/Inspector render it as human-approved production Canon. |
| MB-1C-05 | Receipt/live-edge agreement is disjunctive | A receipt with the wrong filename remained current if asset ID matched; a receipt with the wrong asset ID remained current if filename matched. |
| MB-1C-06 | Lineage remains mutable | The shipped UI offers “Delete it and attach … to the base reference”; `reparent-to-root` rewrote a grandchild's `parentStateId`. Load/runtime normalization also authors missing parents. |
| MB-1C-07 | Atomic callback isolation is not real | A throwing `applyEdge` closure changed the live edge without a ledger receipt; a refusing eligibility callback changed the live project before returning `ok:false`. |

MB-1C-01, 03, 04, and 06 independently require the architectural HOLD. The other three reinforce that the core contracts are not yet closed.

## 2. Scope, method, and safety

This was an independent defensive application-correctness audit. I used static source inspection, local Git history/diffs, existing tests, in-memory VM probes, mock provider boundaries, and synthetic project objects. I did not open or mutate the preserved Dogfood archive, contact a provider, use a real credential, call a local model, modify production project data, merge, or push.

The first foreground full-suite attempt was terminated by the audit runner's 60-second command limit and was treated as inconclusive. A fresh full run then completed successfully in 95.3 seconds. Two zero-byte temporary log files from an unsuccessful background-launch attempt were removed; the repository remained clean.

Python-backed real-browser commands reported a successful process exit but explicitly skipped because no Python 3 interpreter is installed. They are recorded as a limitation, not evidence. The portable Node browser/render tests and the independent browser-context VM probes ran.

## 3. Phase 0 — repository receipt

| Receipt | Observation | Result |
|---|---|---|
| Exact branch | `fix/dogfood2-production-trust-kernel` | Match |
| Exact HEAD | `ee24dabf2f1cbfd8336f952ee4d6b74fef55bc45` | Match |
| Local/remote | Local branch and `origin/fix/dogfood2-production-trust-kernel` had identical tips (`0/0`) | Match |
| Main relationship | `origin/main` = `afe1853…`; branch is 20 commits ahead, 0 behind | Recorded |
| Implementation tree | `3c5fe9c769b3e0434efd243f3174f5dfd9ce1268` | Match |
| Handoff-only tip | `3c5fe9c..ee24dab` changes only `CINEBRAID_DOGFOOD_2_REPAIR_BATCH_1C_TRUST_KERNEL_HANDOFF.md`, 10 insertions / 5 deletions | Pass |
| Baseline relationship | `b23d231..HEAD` is 14 commits, 0 behind | Match |
| Worktree at receipt | Clean; only inaccessible user-level Git-ignore warnings | Pass |
| Implementation scope | `b23d231..3c5fe9c`: 39 files, +4,884 / −1,904. Two are dogfood documents; 37 are implementation/test/golden files | Recorded |
| Handoff arithmetic | Handoff says 38 files, +4,823 / −1,902; Git reports 39, +4,884 / −1,904 because the range also includes the Batch 1B acceptance document | Documentation discrepancy, non-code |
| Project/media/config scope | No production project, generated media, credential, provider state, or environment configuration in diff | Pass |
| Canonical evidence | Pre-Batch-1C evidence blobs were unchanged; Batch 1B audit was added as its own evidence commit | Pass |
| Preserved Dogfood project | No diff touches it; audit did not open it | Pass |
| Implementation whitespace | `git diff --check b23d231..3c5fe9c` clean | Pass |

## 4. Acceptance results A–L

### A — manual human authority origin: FAIL

Positive properties independently confirmed:

- Supplying `{actor:"human", act:"explicit-approval"}` or a forged capability-shaped object cannot satisfy the identity check.
- The private `WeakMap`/identity credential is one-use per target.
- Replay fails with `MANUAL_ACTION_INVALID`.
- A credential for one target cannot approve a different target.
- Creator-facing writers now mint at the handler prologue and route through the kernel.

The origin boundary nevertheless fails A2 and A5.

`public/shared-authority-kernel.js:299` defines `installHarnessManualActionSource`. It is included in `AUTHORITY_KERNEL_EXPORTS` at line 889, placed on `window.CineBraidAuthorityKernel`, and also installed as a loose global at lines 924–927. It opens `TRUSTED_GESTURE` directly without checking `Event.isTrusted`. `beginManualAuthorityAction` checks only whether that module variable is open.

An in-memory browser-context probe (`window === global context`) produced:

```text
browserHarnessType: function
namespaceHarnessType: function
mintedSource: "harness"
committed: "VALUE-B"
receiptActor: "human"
receiptValue: "VALUE-B"
replay: "MANUAL_ACTION_INVALID"
```

This demonstrates both sides: replay protection works, but ordinary shipped browser code can acquire the harness helper and manufacture human provenance. The helper is not harmless Node-only test code because it is explicitly exported into the browser composition.

The capability record at lines 330–344 stores target keys only. A second probe minted with descriptive input value `A` / asset `asset-A`, then committed value `B` / asset `asset-B` for the same target. The commit succeeded and the receipt recorded the changed values. This permits a stale modal/action to approve bytes other than those displayed when the gesture minted the capability.

The trusted browser installer also leaves a synchronous macrotask-wide gate after any trusted click/keydown/change/submit. That may be proportionate for a single-user alpha once the harness escape is removed, but every synchronous internal handler during that window can mint. It deserves a focused application-boundary test, not a comment-only assumption.

### B — durable authority receipt validation: FAIL

The ledger validator is materially stronger than Batch 1B. It fails closed for blank IDs, invalid actor/action/command, command/kind mismatch, target-key/component mismatch, blank value, invalid status, sequence zero, duplicate IDs, duplicate sequences, multiple current receipts, non-object ledgers, and non-array receipt collections. Superseded and revoked rows are excluded from current authority. The focused save/reload cases passed.

The current-edge check is still too weak:

```js
const byName = live.value === receipt.value;
const byIdentity = receipt.assetId && receipt.assetId === live.assetId;
return byName || byIdentity ? receipt : null;
```

Independent mutations after a valid commit produced:

```text
receipt value WRONG + live asset right  -> accepted true, diagnostics []
receipt asset WRONG + live value right  -> accepted true, diagnostics []
both wrong                              -> rejected
```

The acceptance matrix explicitly requires wrong asset/value to fail. Rename repair already has a dedicated kernel operation; contradictory nonblank fields should not be silently accepted through `OR` semantics.

The ledger `version` is reported but not validated. An object with a malformed or unsupported version can remain `trusted` if its receipts pass. This is secondary to the edge-match blocker but should be resolved or deliberately removed from the schema.

### C — atomic Canon write: FAIL

The normal happy path is sensibly staged: the edge and receipt are applied to a cloned document, the complete ledger is validated, current authority is re-read, the clone is copied back once, and the live result is checked. Duplicate IDs are allocated from durable maximum sequence plus used-ID checks. Existing non-extensible-root and persistence-failure tests pass.

The generic transaction contract overstates what it enforces:

- `draftReadOnly(project)` at lines 865–869 returns the live mutable project; it neither clones nor freezes it. A refusing eligibility callback mutated a property on the live project and then returned `ok:false`. The authority write refused, but the mutation remained.
- `applyEdge(draft, target)` receives the draft, but JavaScript cannot stop the callback from closing over the live project. A probe callback wrote `live.edge = "NEW"` and threw. The command threw with no receipt, but `live.edge` remained `NEW`.

The source comment says a caller “physically cannot reach the live document”; that is false. Current production call sites generally use the supplied draft correctly, but atomicity is a kernel boundary claim and must not depend on every caller remembering a hidden closure rule. This is precisely the kind of optional convention the simplification brief rejects.

Document-level staging plus a single local persistence operation is otherwise an appropriate alpha durability model; no distributed transaction is required.

### D — repository-wide Canon writer audit: FAIL

The semantic writer sweep found that the former named leaks are routed:

- `confirmApproveTake` dispatches frame, delivery, and video approval through `writeFrameProductionAuthority`, `writeDeliveryProductionAuthority`, or `writeMotionProductionAuthority` (`public/library-tools.js:318`, 416–469).
- `markGuidedStillFinal` routes its frame and delivery choices through the named writers (`public/creation-studio.js:3400`, 3428, 3448).

Direct assignments were classified as follows:

| Class | Surviving representation / path | Assessment |
|---|---|---|
| CANON | `shot/keyframe.winner`, motion winner, delivery/final edge, entity-state `approvedFile` when written inside a named writer's staged `applyEdge` | Correctly routed at reviewed production call sites |
| HISTORIC | The same legacy pointers when no validated receipt exists; OFP `historicSelections` | Correct in OFP, incorrectly projected in production media |
| SUPPORTING REFERENCE | Coverage/expression slot `approvedFile`, status `selected`, non-authoritative assignment record | Data semantics improved; the field/UI vocabulary remains misleading |
| CACHE/PROJECTION | Candidate selection, generation result rows, delivery/motion convenience projections, server-side clear/reset paths | Not authority by themselves; no new mint found |
| BUG | Exported generic `writeProductionAuthority`; caller-overridable entity eligibility; raw-pointer approval in production media | These are alternate authority paths |

`writeProductionAuthority` is exported globally and forwards any request directly to `commitAuthorityTransaction`. The kernel runs eligibility only “if function”. `writeEntityStateProductionAuthority` further accepts a caller-provided eligibility callback instead of unconditionally composing the ownership veto. Therefore the rule “entity-state Canon must have one durable owner” is not owned by the authority boundary.

No inspected automation path directly assigned Canon outside a staged edge callback, but the generic boundary and alternate reader mean the repository still has more than one way to establish production truth.

### E — supporting references: PASS WITH REQUIRED SIMPLIFICATION

The central slot writer declares exactly `missing`, `selected`, and `retired`; writes `status: "selected"`; records `authoritative: false`; and emits supporting-view references. The reviewed writers—`setExpressionSlotField`, `seedCoverageFromPrimary`, `confirmPrimaryCoverageAssignment`, and `approveCoverageCandidate`—route assignments into this contract. Existing save/reload/normalization tests and the independently rerun coverage, intent-loss, manual-first, safety, production-media, alpha-loop, and OFP suites preserve `selected` rather than manufacturing slot Canon.

No named coverage/expression authority writer exists. OFP sends these rows to `coverageSelections`, not approved output. Generation and continuity can consume the references as context without a production receipt.

The simplification is incomplete in names and UI:

- The storage field is still `approvedFile`.
- `SLOT_SELECTION_DECISIONS` retains deprecated `approved-coverage` and `approved-expression` compatibility values.
- Coverage/entity UI still says “approve”, “approved reference”, “authority views”, “save authority”, and “Human approved” for records the writer marks non-authoritative.

Those words did not mint Canon in the tested save/reload path, so they are not by themselves the basis of this HOLD. They should be removed before alpha because they make the product explain two different meanings of “approved”.

### F — reconciliation: PASS, inherited reader caveat

`applyGateReconciliation` now requires the durable project, resolves the target again, calls `currentHumanAuthority` immediately before applying each transition, and refuses missing, malformed, wrong-target, stale, revoked, competing-current, or mismatched receipt IDs. Poll/reload/resume use the same durable reader. The focused positive and mutation controls passed.

This area still inherits B's disjunctive value/asset reader. A reconciliation plan can cite a receipt whose filename or asset field contradicts the live edge as long as the other field matches. The applier itself no longer trusts an arbitrary receipt ID.

### G — final dispatch / frame presence: PASS

The universal local gate is at the real `fal-generation.js` route before provider submission, paid accounting, durable job creation, and retry classification. Independent mock-boundary runs and the 63 focused assertions covered:

- unknown non-empty frame ID — refused;
- malformed declaration — refused;
- “not without X” — treated as presence, so a declared-absent X is refused;
- “no X is invisible” — double negative treated as presence and refused;
- valid positive and valid absence — proceed to the mock boundary;
- refused cases — zero provider attempts, zero paid accounting, zero job rows, zero retry scheduling.

Structured frame presence remains primary. The English fallback is deliberately bounded and is not being held to arbitrary language theorem proving.

### H — ownership at commit: FAIL

The resolver itself correctly distinguishes one durable owner, zero owners, inferred/prefix matches, and contested owners. Its focused 52 assertions pass. The authority commit does not make that resolver mandatory.

Synthetic fixture:

```text
file: SHARED.png
durable owners: [CHAR-A, CHAR-B]
resolver: ok=false, code=AUTHORITY_OWNERSHIP_CONTESTED
```

Against that same fixture:

1. Calling the exported generic writer with a valid manual capability committed the entity-state edge and a human receipt.
2. Calling `writeEntityStateProductionAuthority` with `eligibility: () => ({ok:true})` did the same.

Stale shortlist, batch, and honest single-approval paths can call the resolver correctly, but correctness cannot rest on those callers never using the exported escape. Zero/contested/inferred ownership must be a mandatory target-kind rule in the commit boundary, not an optional callback.

### I — immutable lineage: FAIL

Positive behavior confirmed:

- `base → Heavy soot → Dawn with burgundy scarf` and deeper chains can be created.
- Creation rejects duplicate IDs, missing parents, missing required parents, dangling collections, and cycles.
- Leaf deletion succeeds.
- Default deletion refuses.
- Navigation no longer contains the former direct reparent assignment.
- Valid ancestry survives normal save/reload tests.

The intended immutable model is nevertheless absent:

- `LINEAGE_DELETION_POLICIES` contains `reparent-to-root` and `cascade`.
- `applyStateDeletion` rewrites each direct child's `parentStateId` to the root.
- `removeContinuityState` presents a normal creator confirmation: “Delete it and attach … to the base reference instead?” and then calls `reparent-to-root`.
- `tests/state-lineage-safety.js` explicitly expects this rewrite to succeed, while simultaneously claiming reparenting was removed.
- `public/app.js` normalization fills a missing `parentStateId` at two sites. `entityStateList(entity, true)` can also create a default state and fill ancestry; it is called by ordinary runtime and preflight paths.

The independent deletion probe started with root → child → grandchild. Default deletion correctly returned `has-children`. The UI policy then removed child and changed grandchild's parent from child to root. That is reparenting in the exact helper and UI paths the brief required to be absent.

### J — pure correction preflight: PASS FOR CORRECTION; broader sweep finding remains

The focused 47 assertions and real runner mocks cover zero frames, malformed keyframes, missing target/frame, first/middle/last shot, single-shot scene, and deleted neighbor. For deterministic local failures, serialized project before and after remained equal; no frame insertion, normalization, job row, or dispatch occurred. The scene-correction preflight uses a read-only opening-frame lookup rather than `guidedFrames`.

The post-green repository sweep found a separate impurity: `v627EntityPreflight` calls `entityStateList(entity, true)`, which can insert a default state, fill `parentStateId`, migrate notes, add generation fields, and synchronize `entity.approvedFile`. It is not the repaired scene-correction preflight, so J's named correction boundary passes. It still violates the broader P requirement that `preflight/check/validate` functions not mutate and should be removed before alpha.

### K — OFP / export truth: PASS

The migration now consults the authority kernel before using the approved-output path. Independently rerun OFP tests passed 33 rules, 20 fixtures, 84 accounted values, and zero unaccounted values.

- Unreceipted legacy pointers become `historicSelections` plus `migration.authority.historic`, not approved output.
- Valid receipted Canon follows the authoritative output path.
- Coverage/expression selections become supporting `coverageSelections`.
- Malformed ledgers fail closed.
- No alternate inspected migration rule treated `selectedCandidate` or a slot pointer as approval.

The committed sanitized goldens measure 18 historical generations and 10 unreceipted pointers across 4 generations. The current golden removes those approved-output assets/references while preserving workflow evidence. The audit verified the documented goldens-only code/test path and did not open the preserved archive.

### L — post-load normalization: FAIL AS A REPOSITORY-WIDE TRUTH AREA

Slot normalization now derives `selected` from an existing supporting file, not `approved`; its targeted regression tests pass. It does not create a receipt.

Two repository-wide resurrection paths remain:

1. `shared-production-media` obtains raw edge disposition from the legacy partitions and calls `humanDecisionOf(row, disposition.role === "approved", ...)`. With a winner and no ledger, the projection returned:

   ```text
   ledger: null
   disposition: "approved"
   humanDecision: "approved"
   actor: { state: "not-recorded", value: "" }
   ```

   Results filters and badges it as `APPROVED`; Inspector prints “Approved by you”, “A person approved this. It is production canon”, and “This media is the authority for at least one target.” `tests/production-authority.js` currently pins the unreceipted case as an ordinary manual approval.

2. `app.js` and `entityStateList` author missing ancestry during normalization/runtime reads. This is not authority resurrection, but it violates the same load-does-not-invent-truth principle for immutable lineage.

Accordingly, the narrow supporting-slot load bug was fixed, but the full post-load/consumer truth audit fails.

## 5. M — fifteen changed legacy expectations

The handoff table actually contains 14 rows although the acceptance brief and change inventory say 15. The omitted fifteenth changed test file is `intent-loss-safety.js`; it is reviewed here explicitly.

| # | Test / expectation | Old behavior encoded | New expectation | Independent acceptance |
|---:|---|---|---|---|
| 1 | `production-authority.js` grant shape | Two caller strings act as credential | Identity capability behind gesture | Direction correct; test misses exported harness acquisition. |
| 2 | `production-authority.js` reconciliation | Plan's receipt ID was trusted | Revalidate durable receipt at apply | Accept; useful gate behavior preserved. |
| 3 | `state-lineage-safety.js` §4 | Reparenting exists and is validated | Claimed create-only collection integrity | **Reject.** Test still affirmatively executes and approves `reparent-to-root`. |
| 4 | `state-lineage-safety.js` §6 | Reparenting routing was asserted | Claimed no reparent / creation-only parent write | **Reject.** UI/helper and normalizer assignments remain; source-count assertion blesses normalization writes. |
| 5 | `alpha-production-loop.js` D2/D3 | Slot commit equals human approval | Slot commit equals selection | Accept; slot assignment behavior preserved without Canon claim. |
| 6 | `alpha-production-loop.js` state distinction | Three literal outcomes | Four outcomes through predicate | Accept; behavioral coverage is stronger than literal pin. |
| 7 | `alpha-production-loop-negative-controls.js` NC-D2 | Mutation anchor on old three-outcome expression | Updated anchor, same semantic mutation | Accept. |
| 8 | `real-browser-workflow.py` imported reference | `approved-coverage` | `selected-coverage` | Accept semantically; the test was skipped locally for lack of Python, so only source expectation was reviewed. |
| 9 | `manual-first-workflow.js` coverage | `humanApproved:true` on slot | human selection provenance, `authoritative:false` | Accept; no-AI/manual landing remains covered. |
| 10 | `coverage-workflow.js` absent stored status | Test pinned derived `approved` despite fixture storing no status | Derive `selected` | Accept; warning and state now agree. |
| 11 | `intent-loss-safety.js` absent stored status | Load derived approval from file presence | Load derives `selected` | Accept; authored content/duration behavior remains covered and load remains byte-preserving. |
| 12 | `ofp-migration.js` clean diagnostics | Zero diagnostics for legacy pointers | Exact historic-authority diagnostics | Accept; more precise, not merely greener. |
| 13 | `ofp-migration.js` accounting | `M030 mapped` into approved output | `M013 preserved` with destination | Accept; preserves evidence without unsupported authority. |
| 14 | Overfit golden | 10 unreceipted pointers materialized as approved output | Historic workflow evidence only | Accept; validation/statements unchanged and archive untouched. |
| 15 | `safety-integrity.js` expression inbox | Literal duplicated in `entities.js` | Shared selection predicate | Accept; unrelated queue behavior remains covered. |

Thirteen changes remove invalid approval semantics or make tests less textual. The two lineage changes are not acceptable because their new prose contradicts the executable behavior.

## 6. N — negative-control harness

### Harness quality

The rewritten harness is materially better. Each current control:

- executes a baseline outside any catch-as-success region;
- verifies its mutation anchor count;
- probes real and mutated modules;
- records checkpoint reach;
- requires `held === true` on real and `held === false` on mutation;
- compares an exact reason where declared;
- does not treat an unrelated assertion as success.

Representative manual reruns confirmed these mechanics, including multi-layer mutations and the real mock dispatch boundary. All 19 reported fired for their named reasons. The harness design passes.

### Reconciliation of 37 → 19

The Batch 1B source count reconciles to 31 synchronous mutation controls, 1 asynchronous final-gate control, and 5 explicit pre-repair reproduction controls = 37. Batch 1C has 19 mutation controls and no separately counted reproduction rows.

| Batch 1B controls / reproductions | Batch 1C disposition | Audit judgment |
|---|---|---|
| R1 auto-approve; C1 truthy grant; C1c actor; C1d edge-before-check | C1 identity, C2 actor, C6 edge-before-credential; production positive suite | Mostly consolidated, but no control proves the harness installer is unavailable to browser code or that capability value/asset is immutable. Accidental gap. |
| C1b raw-edge reader; C5 projection ignores automation | C3 target derivation, C4 competing current, C5 duplicate ID, production-media positives | Not equivalent. No control requires every “approved” projection to cite a valid receipt; the shipped production-media expectation preserves the defect. Accidental gap. |
| C2 recommendation carries winner | Product recommendation/decision split and architecture positives | Old writer removed/consolidated. Acceptable, subject to production-media raw-edge gap. |
| C2b fake reconciliation; C2c one-way; C2d cached resume | C7 persisted commit plus reconciliation positives | Fake ID and revalidation covered elsewhere; reopen/revoke behavior is positive-suite coverage. Acceptable consolidation. |
| C4 unidentifiable gate; C6 absence; C7/C8 mentions; C7b negation; C9 narrative; C10 short form; R2 whole-shot cast; CG final route | C8–C11 and CG plus 63 presence positives | Smaller structured contract plus boundary control. Acceptable. |
| C10b inferred, C10c contested, C11 prefix, C12 durable claim, C13 slots as claims; R3 prefix reproduction | C12 inferred and C13 contested plus ownership positives | Resolver covered, commit boundary not covered. No mutation removes/overrides eligibility at the exported writer. Accidental gap. |
| C14 navigation reparent, C14b navigation intent, C15 cycle, C15b resulting graph, C16 ancestor continuation; R4 cyclic rotation | C14 creation missing parent, C15 duplicate, C15b dangling, C16 delete descendants plus lineage positives | Mutation controls became stronger for creation, but none asserts that reparent capability is absent. C16's baseline treats default `refuse` as enough while shipped UI immediately invokes `reparent-to-root`. Accidental gap. |
| C17 finished-chain wrap | Current C17 | Preserved. |
| C18/C18b retry consumption; C19 authority classified provider fault | Architecture/dispatch positive tests and alpha negative suite | Protected behavior remains elsewhere; acceptable consolidation, though not in the 19-file count. |
| R5 first-shot boundary exception | Correction-boundary positives | Repaired operation covered; separate reproduction count removed. Acceptable. |

The lower count is not intrinsically a defect. The missing controls align exactly with live counterexamples, so the current 19 are insufficient as a production-trust regression set.

## 7. O — test matrix quality

### Executed focused matrix

| Suite | Reported assertions / controls | Result |
|---|---:|---|
| Production authority | 93 | Pass |
| Frame presence | 63 | Pass |
| Entity ownership | 52 | Pass |
| State lineage | 98 | Pass |
| Correction boundary | 47 | Pass |
| Architecture | 271 | Pass |
| **Focused positive total** | **624** | **Pass** |
| Trust-kernel negative controls | 19 | Pass |

Additional independently rerun suites passed: alpha production loop, coverage workflow, intent-loss safety, manual-first workflow, OFP migration, safety integrity, and production media. They made zero real provider calls.

The matrix represents the Batch 1B frame-presence and correction counterexamples well. It does not represent equivalent application-boundary regressions for:

- browser acquisition of the harness authority source;
- stale same-target value/asset changes;
- mandatory ownership at the exported commit boundary;
- unreceipted legacy pointer projection in Results/Inspector;
- wrong-value/right-asset and right-value/wrong-asset receipts;
- total absence of reparent helpers and UI;
- normalization/preflight ancestry mutation;
- live-project mutation by transaction callbacks.

Some tests encode the opposite invariant: production-media expects an unreceipted pointer to remain approved, and lineage expects explicit reparent-to-root to succeed. Counts therefore cannot support acceptance.

## 8. P — post-green semantic sweep

| Sweep | Finding |
|---|---|
| Authority writes bypassing kernel | Named production UI writers route through the kernel; exported generic writer plus optional eligibility still bypass target-kind policy. |
| Authority reads from raw pointer | **Found:** production-media disposition/human decision and Results/Inspector. |
| `humanApproved` as provenance | Still accepted by `humanDecisionOf` as a human decision without a receipt. |
| Slot states outside vocabulary | Writer vocabulary is closed; deprecated approval decision words and extensive approval UI vocabulary survive. |
| Derived approval from file presence | Slot normalizer now derives `selected`; production-media still derives approval from edge disposition. |
| Coverage/expression consumed as Canon | No export/authority writer leak found; they remain contextual references. |
| Parent mutation after creation | **Found:** deletion helper/UI and two normalization/runtime assignment sites. |
| Mutating preflight/check/validate | **Found:** `v627EntityPreflight` calls mutating `entityStateList(entity, true)`. Correction preflight itself is pure. |
| Legacy export authority | OFP path repaired; UI production-media path remains wrong. |
| Paid dispatch before local validation | No leak found; universal presence gate runs before job/accounting/provider operations. |

The sweep also found the callback-isolation and receipt `OR` issues described above. These were not in the handoff's semantic inventory.

## 9. Q — simplicity assessment

Batch 1C made several parts more maintainable:

- One receipt validator and durable reader replaced caller-shaped actor strings.
- Reconciliation now asks the durable reader again at commit time.
- Frame presence has one structured contract and one final local dispatch gate.
- Coverage/expression assignment has one supporting-reference writer and a closed stored status vocabulary.
- OFP export distinguishes receipted authority from historic pointers.
- State creation and collection validation are centralized and stronger.

But four “NOW” claims are not true across the product:

| Claimed simplification | Actual state |
|---|---|
| One Canon authority | Receipt truth coexists with raw-edge `approved` truth in production-media, and the generic writer can omit target policy. |
| Supporting references | Stored semantics are supporting, but old `approvedFile`, deprecated decision words, and authority/approval UI remain. |
| Immutable create-only lineage | Reparent-to-root and cascade deletion policies remain; normalizer/runtime readers write ancestry. |
| Pure preflight | Scene-correction is pure, but entity preflight calls a mutating hydrator. |

The rules were partly centralized, but several guards were moved into optional callbacks or honest named callers rather than made intrinsic to the kernel. A future maintainer cannot yet explain the architecture in the target few sentences without knowing which readers ignore receipts, which writers require an optional callback, which “approved” fields mean only “selected”, and which “immutable” deletion policy reparents.

## 10. SIMPLIFICATION VERDICT

### What complexity was genuinely removed?

Caller-asserted human actor strings, slot-level authority semantics in the central writer, OFP pointer-to-approved-output inference, cached reconciliation trust, most duplicated frame-presence guards, and several scattered slot status writers were genuinely removed or centralized.

### What obsolete machinery survives?

#### Merge blockers

- Browser-exported harness authority source.
- Generic/optional target-policy authority writer.
- Raw-pointer and `humanApproved` production-media authority projection.
- Disjunctive receipt/live-edge match.
- `reparent-to-root`/`cascade` lineage policies and creator UI.
- Mutating callback “read-only” transaction seam.

#### Recommended simplifications before alpha

- Replace supporting-slot `approvedFile` and approval/authority UI wording with selection/reference terms, or isolate one explicit legacy import field from the live model.
- Remove deprecated `approved-coverage` / `approved-expression` decision values after a bounded migration.
- Split `entityStateList` into a pure reader and an explicit migration/creation command; preflight must use the pure reader.
- Stop normalizers from assigning missing ancestry; report/migrate it explicitly once.
- Make receipt schema version either validated and meaningful or delete it.

#### Optional cleanup after merge

- Remove stale comments claiming physical callback isolation or that reparenting no longer exists.
- Rename remaining presentation-only “approved” counters/labels after production truth is fixed.
- Consolidate duplicate convenience aliases that merely forward to the durable reader.

### Are there remaining duplicate representations of production truth?

Yes. The validated receipt/edge pair and the raw legacy pointer/disposition projection both currently claim production approval. Supporting slots also retain authority-like vocabulary, though their stored semantics no longer create Canon.

### Did Batch 1C centralize rules or merely move guards?

Both. Receipt validation, reconciliation, frame presence, slots, and OFP were genuinely centralized. Ownership and callback isolation were moved into optional conventions; lineage mutation was hidden behind deletion policy and compatibility normalization rather than removed.

### Can a future maintainer explain it in a few sentences?

Not yet. Once every authority consumer requires a receipt, target-kind policy is intrinsic, harness authority cannot ship, and ancestry has no rewrite path, the target explanation becomes accurate and sufficient.

## 11. Validation receipt

| Command / probe | Result | Notes |
|---|---:|---|
| `npm.cmd run check:dogfood2-p0` | 0 | 624 focused positive assertions and 19 controls passed |
| `node tests/alpha-production-loop.js` | 0 | Pass; provider calls 0 |
| `node tests/coverage-workflow.js` | 0 | Pass |
| `node tests/intent-loss-safety.js` | 0 | Pass |
| `node tests/manual-first-workflow.js` | 0 | Pass |
| `node tests/ofp-migration.js` | 0 | 33 rules, 20 fixtures, 84 accounted values, 0 unaccounted |
| `node tests/safety-integrity.js` | 0 | Pass |
| `node tests/production-media.js` | 0 | Pass; current expectation permits raw-edge approval |
| `npm.cmd run check:browser-real` | 0 / skipped | No Python 3 interpreter; not counted as execution evidence |
| `npm.cmd run check` | 0 | 167 suites passed in 94.0s (95.3s process wall time) |
| Independent browser-context/capability probes | Counterexamples reproduced | In-memory only; no network |
| Independent ownership/lineage/media/atomicity/receipt probes | Counterexamples reproduced | Synthetic objects and VM/test doubles only |
| Real provider calls | 0 | No credentials or network providers used |
| Local-model calls | 0 | None used |
| Preserved project/evidence writes | 0 | Archive not opened; canonical evidence unchanged |
| Worktree after tests, before this report | Clean | No tracked or untracked test residue |

The full suite's expected simulated-composer-crash diagnostics and sandboxed Windows `Get-CimInstance: Access denied` diagnostics appeared, but the harness completed and reported all 167 suites passed. Python real-browser suites were skipped explicitly.

## 12. Required corrective direction

This report does not implement fixes. To make the alpha model coherent, the next batch should make these rules structural:

1. Do not place the harness installer in any shipped browser export; test composition should inject it only in Node/test context.
2. Bind a manual action to the exact target plus displayed value/asset, and reject stale commits.
3. Put entity ownership inside the target-kind commit policy; callers must not be able to omit or replace it. Remove or make private the policy-free generic writer.
4. Make every production-media disposition/human-decision/Inspector/Results authority claim receipt-aware. Unreceipted pointers are historic selections, never human decisions.
5. Define exact filename/asset consistency and fail on contradictory nonblank receipt fields.
6. Delete all reparent/cascade policies and UI; deletion with descendants must refuse. Treat missing historical ancestry as an explicit migration/reporting concern, not load-time authorship.
7. Give callbacks snapshots they cannot use to mutate the live document, or remove callback extensibility in favor of kernel-owned target-kind edge writers.
8. Add mutation controls at each of these real boundaries before relying on the focused count.

Until then, normal CineBraid operation can still lie about what the filmmaker approved, resurrect non-authority as authority, and rewrite supposedly immutable ancestry. That meets the brief's definition of an architectural HOLD.

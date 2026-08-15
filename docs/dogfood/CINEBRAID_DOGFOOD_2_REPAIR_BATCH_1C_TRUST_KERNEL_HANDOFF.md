# CineBraid Dogfood #2 — Repair Batch 1C Trust Kernel Handoff

## One Canon authority, one credential, one transaction — and four concepts fewer

**Date:** 2026-08-14
**Document type:** Handoff. Repairs implemented; **not merged.** Stopping for independent Codex acceptance.

---

# 1. Branch

`fix/dogfood2-production-trust-kernel`, created from `b23d231` (Batch 1B) plus the 1B acceptance-audit checkpoint.

Neither prior repair is rewritten, squashed or reverted. Batch 1's commits, Batch 1B's commits and both acceptance audits are ancestors of this branch and remain readable as the states they were judged in.

# 2. Baseline and final HEAD

| | |
|---|---|
| Batch 1B target the re-audit judged | `b23d2313ae9d3cc789dfa09c91ac703c3580b55a` |
| 1B acceptance-audit checkpoint | `58fc25998146ace5b2a146ab48a74b849666bc27` |
| `origin/main` | `afe1853ce2fa69f43489822c0e86d5a4c45ea3f6` |
| **Verified HEAD** | `3c5fe9c769b3` — the last code commit, and the tree the 167-suite run was executed against |
| **Branch HEAD** | this document, committed on top. Docs-only; no source or test file differs from the verified tree |

# 3. Commits

| SHA | Subject |
|---|---|
| `58fc259` | `docs: checkpoint repair batch 1B acceptance audit` |
| `5674b30` | `wip(kernel): authority kernel, create-only lineage, pure preflight, receipt-aware export` |
| `87d5ae6` | `fix(K1C): route every canonical selection writer through the kernel` |
| `edcff32` | `test(K8): rebuild the control harness on a seven-condition contract` |
| `553df53` | `test: extend the architecture suite into the full Codex regression matrix` |
| `7b64a5d` | `fix: stage every authority edge on the draft, and merge the commit in place` |
| `37413b1` | `fix(K6+K-alpha): pure automation preflight, and a fourth decision word` |
| `f981585` | `fix: mint the capability before the first await in async approval handlers` |
| `d00067b` | `test(K7): migrate the OFP clean-migration expectation to receipted export truth` |
| `bc95d9b` | `fix(K1C): close the four slot writers the post-green sweep found` |
| `db42438` | `fix: one slot-decision vocabulary, and stop deriving the withdrawn word` |
| `e17956a` | `test: follow the slot vocabulary out of entities.js` |
| `3c5fe9c` | `test: the load normaliser derives "selected", in intent-loss too` |
| *(this document)* | `docs: dogfood #2 repair batch 1C trust kernel handoff` |

**38 files, +4823 / −1902** against `b23d231`.

# 4. Files changed

**Two new modules:**

| File | Owns |
|---|---|
| `public/shared-authority-kernel.js` (+930) | The canonical target descriptor, full receipt-schema validation, the manual-action capability, and the one commit transaction |
| `public/shared-entity-slots.js` (+226) | What a coverage/expression slot *is* after the demotion: a supporting reference, its one writer, and the one decision vocabulary |

**Modified source (19):** `shared-production-authority.js` (+211 / −449; the batch deleted twice what it added), `shared-state-lineage.js`, `shared-frame-presence.js`, `shared-production-media.js`, `app.js`, `automation.js`, `scene-automation.js`, `library-tools.js`, `creation-studio.js`, `entities.js`, `review.js`, `review-provenance.js`, `coverage-automation.js`, `focused-workspaces.js`, `bootstrap.js`, `index.html`, `server.js`, `fal-generation.js`, `ofp/ofp-migrate*.js` (3).

**Modified tests (13) + 1 re-pinned golden:** `dogfood2-p0-negative-controls.js` *(rewritten)*, `dogfood2-p0-architecture.js`, `state-lineage-safety.js`, `production-authority.js`, `render-harness.js`, `alpha-production-loop.js`, `alpha-production-loop-negative-controls.js`, `real-browser-workflow.py`, `ofp-migration.js`, `manual-first-workflow.js`, `coverage-workflow.js`, `safety-integrity.js`, `intent-loss-safety.js`, `fixtures/ofp-migration/overfit/goldens/summary.json`.

No project data, generated media, provider state, credential or environment configuration is in the diff.

---

# 5. Architecture before and after

## Before (Batch 1B, as the re-audit found it)

```
credential      { actor: "human", act: "explicit-approval" }   — two strings, public builder on window
receipt reader  target string + filename match                 — no actor, act, id, sequence or uniqueness check
uniqueness      none                                            — two `current` rows silently resolved to the last
write           applyEdge(); then ledger                        — no rollback, no proof of persistence
targets         2 kinds                                         — video winners, coverage, expression, creation-final all outside
reconciliation  receiptId non-empty                             — completed a real gate against "not-a-real-receipt"
lineage         mutable graph + cycle check                     — add/remove outside the boundary; duplicate and dangling ids "acyclic"
presence        frame id non-empty                              — unknown ids and malformed declarations read as "declares nothing"
preflight       calls guidedFrames                              — created the frame it was checking for
export          non-empty pointer → approved output             — machine and unreceipted selections exported as canon
controls        catch(AssertionError) ⇒ passed                  — any assertion, including a broken baseline
```

## After (Batch 1C)

```
credential      a one-use object identity in a module-private registry, minted only
                inside a trusted user gesture, bound to the exact targets it may
                authorize. There are no right fields, because nothing is compared.

receipt reader  the whole schema, every read: actor, act, command, command/kind
                agreement, canonical target DERIVED from its parts, value, status,
                sequence, unique id, exactly one current per target. Malformed
                fails CLOSED with a deterministic diagnostic and is never repaired.

write           one transaction: resolve target → consume capability → ownership
                veto → DRAFT → edge on the draft → receipt on the draft → validate
                the draft → commit in place → RE-READ and prove it landed.

targets         4 kinds: shot-frame, shot-motion, shot-delivery, entity-state.

reconciliation  the applier re-verifies the cited receipt against the CURRENT
                project immediately before writing the step. A plan is a request.

lineage         create-only. A parent is chosen at creation and never changes, so
                a cycle is structurally impossible rather than checked. The
                collection is validated whole: unique ids, one root, every parent
                resolves. Deletion states its policy and never orphans.

presence        governed shot ⇒ frame id must RESOLVE and its declaration must
                PARSE. Structured compile assertions are compared as ids; text is
                the net, with a bounded double-negative rule and nothing cleverer.

preflight       pure structural reads. Nothing is created, normalised or hydrated.

export          only a valid current receipt produces an approved-output edge.
                Everything else is historic workflow evidence with a diagnostic.

controls        a probe returning {reached, held}, run against the real AND the
                mutated module, with the baseline outside any catch region.
```

---

# 6. K1–K8 disposition

| | Item | Disposition |
|---|---|---|
| **K1** | Unified authority kernel | **Done.** Four target kinds, canonical descriptor, full schema validation, fail-closed, deterministic diagnostics, no silent repair. |
| **K1A** | Manual action provenance | **Done.** Forgeable trio removed. Capability = object identity, gesture-gated, target-bound, one-use. Automation cannot mint. |
| **K1B** | Transactional write | **Done.** Draft-staged, validated, committed in place, then re-read to prove persistence. |
| **K1C** | Alternate writers | **Done.** Seven authority writers routed; **four more slot writers and a three-place normaliser found and closed by the post-green sweep**; five classified non-authoritative and named. |
| **K1D** | Authority readers | **Done.** Gates, reconciliation, resume, reuse, projections and export all go through the validated reader. |
| **K2** | Reconciliation | **Done.** The applier revalidates against the project; a fabricated receiptId closes nothing; no project ⇒ nothing completes. |
| **K3** | Dispatch fails closed | **Done.** Unknown frame id and malformed declaration are typed local refusals before accounting, commit and submit. |
| **K3A** | Structured intent | **Done.** Compile assertions compared as ids; bounded double-negative rule; no NLP engine. |
| **K4** | Ownership at commit | **Done.** Re-resolved inside the authority command and inside the single slot writer; batch, replacement, seeding and stale-modal paths all route. |
| **K5** | Lineage | **Done, by removal.** Create-only; add/remove validated against the whole collection; reparenting deleted. |
| **K6** | Pure preflight | **Done.** Correction preflight and the automation shot preflight are both non-mutating structural reads. |
| **K7** | Export truth | **Done.** Migration consults the authority model. Measured on the real corpus: ten pointers stopped exporting as approved output. |
| **K8** | Control harness | **Done.** Seven-condition contract; C15b repaired; C18/C19 replaced by probe-form controls; CG asserts both consequences. |

---

# 7. Every Codex counterexample and the regression that closes it

| # | Counterexample (Batch 1B re-audit) | Closure | Regression |
|---|---|---|---|
| 1 | `{actor:"human", act:"explicit-approval"}` accepted; winner + receipt written | credential is an identity | arch §1 forged-shape loop (10 shapes); control **C1** |
| 2 | receipt with blank id, seq 0, `actor:"automation"` accepted | full schema validation | arch §1; controls **C2**, **C5** |
| 3 | receipt whose `targetId` matched but component fields named another frame | key derived from parts | control **C3** (two-layer), **C3b** diagnostic |
| 4 | two `current` rows silently resolved to the last | exactly-one-current | control **C4** (two-layer) |
| 5 | duplicate `authority-000001` after a sequence reset | id allocated against durable maxima | control **C5** |
| 6 | non-extensible root ⇒ partial edge + phantom receipt | draft + post-commit proof | arch §1; controls **C6**, **C7** |
| 7 | `confirmApproveTake` video arm wrote `s.winner` directly | routed to shot-delivery | arch §7 writer inventory |
| 8 | `markGuidedStillFinal` fallback wrote `s.winner` directly | routed to shot-delivery | arch §7 |
| 9 | `applyGateReconciliation` completed a gate on `receiptId: "not-a-real-receipt"` | applier revalidates | production-authority §7 (fabricated id, no project, empty id) |
| 10 | unknown non-empty frame id reached the provider and committed a row | fails closed | arch §7 through the real FAL route; control **C8** |
| 11 | `{state:"absent"}` malformed declaration reached the provider | typed refusal | arch §7 real route; control **C9** |
| 12 | "The room is not without the Chimbley Sweep" | bounded double negative | arch §7 real route; control **C10** |
| 13 | "No Chimbley Sweep is invisible" | same | arch §7 real route |
| 14 | batch coverage writer approved contested `SHARED.png` | commit-time ownership in the one slot writer | arch §7 contested-commit block; control **C13** |
| 15 | `addContinuityState` created a first parent outside the boundary | create-only, validated | lineage §4; arch browser §K5; control **C14** |
| 16 | `removeContinuityState` orphaned a descendant | explicit policy, refuse by default | lineage §4; arch browser §K5; control **C16** |
| 17 | duplicate and dangling ids reported "acyclic" | collection integrity | lineage §4; controls **C15**, **C15b** |
| 18 | preflight created the missing opening frame and reached dispatch | pure reads | arch §6 (zero frames created, zero dispatch, project byte-identical) |
| 19 | OFP exported unreceipted pointers as approved output | receipt-aware `approve()` | arch §7 export block; ofp-migration §3 (both halves); overfit conformance |
| 20 | coverage slots consumed as five kinds of authority | demoted | arch §7 slot block; the source guard in §9 |

---

# 8. Direct writers: routed, or classified

## Routed through the kernel

| Writer | Target kind |
|---|---|
| `library-tools.js` `confirmApproveTake` — still arm | shot-frame |
| `library-tools.js` `confirmApproveTake` — **video arm** *(re-audit)* | shot-delivery |
| `library-tools.js` `confirmApproveTake` — segment arm | shot-motion |
| `creation-studio.js` `markGuidedStillFinal` — **both arms** *(re-audit)* | shot-frame / shot-delivery |
| `creation-studio.js` `useApprovedBaseAsShotImage` | shot-frame |
| `creation-studio.js` `approveGuidedMotion`, `queueGuidedVideoFinish` | shot-motion |
| `creation-studio.js` `markGuidedVideoFinal` | shot-delivery |
| `review-provenance.js` `promoteFinishJob` — all three arms | frame / delivery / motion |
| `library-tools.js` `confirmEntityApproval`, `review.js` batch, `automation.js` × 2 | entity-state |

## Classified non-authoritative, and named as such

| Writer | Why it may stay direct |
|---|---|
| `clips[i].winner` / `winnerEnd` | motion **interpolation endpoints** — they select which already-approved stills a unit runs between. The Canon is the frame authority that approved those stills; a receipt kind here would describe a pointer that decides nothing. |
| `canonicalName` | a derived copy of a winner, repaired by the rename resolver |
| `app.js` winner normalisation | propagates an existing edge between two records of one fact; mints no receipt, so it cannot create authority |
| `mutations.js` duplicate | clears on a **copy**; a new shot id has no receipts |
| `server.js` import clear | clears edges **and drops any imported ledger**, with a warning |

## Revocations routed

`resetGuidedFrameApproval` and `guidedInvalidateMotionAfterFrameChange` withdraw the receipts they reopen, with a reason.

---

# 9. Slot demotion: consumers, writers, and the vocabulary

## The consumers the re-audit's §9 listed

| Consumer | Before | After |
|---|---|---|
| `coverage-automation.js` reference builder | slots added as `"coverage"` authority refs | `"supporting-view"`, keyed `coverage-supporting-view:` |
| `server.js` entity review | *"approved alternate-view design authority"* | *"supporting alternate view (context only)"* |
| `shared-production-media.js` | `approved-coverage`/`approved-expression` in `ENTITY_APPROVED_DECISIONS` | moved to `ENTITY_SUPPORTING_DECISIONS` |
| `ofp-migrate-rules.js` M013 | `context.approve(slot.subject, …)` | `context.workflowPut(["coverageSelections", …])` |
| single / batch / manual-replacement writers | `humanApproved`, approval provenance, `status: "approved"` | one writer, `assignSlotReference`, `status: "selected"` |
| `review.js` decision renderer | **APPROVED BY YOU** | **SELECTED BY YOU**, a fourth distinct state |

## The four writers the post-green sweep found

| Writer | Defect |
|---|---|
| `entities.js` `setExpressionSlotField` | the coverage setter's twin, never routed: wrote `approvedFile` / `status:"approved"` / `approvedAt` with no ownership question |
| `coverage-automation.js` `seedCoverageFromPrimary` | `status = "approved"` |
| `coverage-automation.js` `confirmPrimaryCoverageAssignment` | `status = "approved"` |
| `entities.js` `approveCoverageCandidate` | the slot was demoted but the **candidate row** still wrote `humanApproved: true` and a human approval provenance — the two fields `shared-production-media.js` reads to call a file human-approved |

## And the one that made the rest moot

`app.js` project normalisation **derived** a slot's status from `approvedFile` presence, in three places, on every project load — and derived the word `"approved"`. A slot that a correctly-routed writer had saved as a selection came back an approval the next time the project was opened, with no writer at fault.

The tell was there to be read: `SLOT_ASSIGNMENT_STATES` declares exactly `missing | selected | retired`, and the normaliser was writing a fourth word that appears in no slot vocabulary at all.

This is why the rule is now a **test**, not a convention: no file but `shared-entity-slots.js` may produce that word for a slot's status, in either the **assigned** or the **derived** shape. Both shapes were negative-controlled by reintroducing the real defect and confirming the guard names the file and the expression.

## One vocabulary

Four readers each carried their own copy of the decision words, so each went on treating a just-selected candidate as unassigned: the AI badge's *NOT ASSIGNED* suffix, the passing-assignment queue, the reference inspector's outstanding count, and the decision renderer. There is one copy now — `SLOT_SELECTION_DECISIONS` in `shared-entity-slots.js`. The legacy words stay in the set deliberately: a pre-1C project has them on disk, nothing rewrites them, and they mean what the new words mean.

**No data was destroyed.** Every `approvedFile`, replacement-history entry and provenance record stays where it is.

---

# 10. The immutable-lineage contract

```
A continuity state is created as a child of an existing state.
Its ancestry is immutable thereafter. There is no reparent operation.
A state with descendants cannot be deleted until they are removed
  (or, on an explicit policy, reattached to the root).
Navigation never mutates ancestry.
```

**Validated on creation:** unique non-empty id · parent exists · no duplicate ids · no dangling ancestry · the exact resulting collection is valid.
**Validated on deletion:** target exists · target is not the root · target has no descendants (unless a policy says otherwise) · the exact resulting collection is valid.
**On refusal:** the collection is byte-identical.

**Multi-level inheritance is preserved.** The alpha direction asked whether ancestry could be flattened to base → named state. It cannot: the preserved Dogfood #2 project runs `Rooftop working → Heavy soot → Dawn with burgundy scarf`, and the closeout records that chain's inheritance as positive finding **P4**. Flattening would delete a working feature and rewrite real evidence. **The depth is kept; the mutability is what went** — which removes the entire A5 defect class without removing the capability.

---

# 11. OFP / export behaviour

`context.approve()` takes an authority target and asks `hasCurrentHumanAuthority` against the same project the migration is reading.

| Input | Export |
|---|---|
| frame/shot/state/delivery pointer **with** a valid current receipt | approved-output asset + reference edge |
| the same pointer **without** one | `historicSelections` workflow evidence + `migration.authority.historic` diagnostic |
| coverage slot selection | `coverageSelections` workflow evidence — never the approved-output path |
| malformed ledger | fails closed; nothing exports as approved |

**Measured on the real corpus.** Re-pinning the Overfit goldens quantified the defect: across 18 sanitized historical generations, **10 legacy pointers in 4 generations** were being materialised as approved-output assets and references with no receipt behind them. They are now preserved as workflow evidence, each accounting row naming the exact pointer its filename moved to. Nothing else moved — no generation's validation outcome changed, no statement changed, 0 unaccounted values, and still **0 approved statements** corpus-wide.

The goldens were re-pinned through the documented `--goldens-only` path, which reads the committed sanitized fixtures and **never opens the archive**.

---

# 12. Negative-control harness

A control is a **probe** returning `{reached, held}`, run against the real module and the mutated one. It passes only when: the baseline runs outside any catch region · the mutation is confirmed by anchor count · the checkpoint is reached under both · the invariant **holds** under the real module · it **fails** under the mutation · the failure matches its own named reason.

There is no `catch (AssertionError) ⇒ passed`, and **the file asserts that about itself.**

- **C15b repaired** exactly as required: it starts from a valid collection, proves it acyclic, and becomes invalid only through the intended break — a dangling parent, which is *not* a cycle.
- **C18/C19 replaced.** Their baselines sat inside the swallowed region; the probe form has no such region.
- **CG asserts both consequences**: zero provider attempts **and** zero committed job rows, with the real route loaded from a scratch copy and no network request.

**Five guards turned out to be two layers deep** — the shipped code was safer than the old controls could show. Those break both layers, which is the only honest way to prove a set is load-bearing when each member is covered by the others.

---

# 13. Changed legacy expectations

| Expectation | Old behaviour it encoded | Why invalid | New invariant | Why simpler |
|---|---|---|---|---|
| `production-authority.js` grant-shape suite | a credential is two strings | that shape is the forgery | a capability is an identity, gesture-gated | one credential concept, unforgeable by construction |
| `production-authority.js` reconciliation | applier trusts the plan | it completed a gate on a fake id | the applier revalidates | evidence lives in one place |
| `state-lineage-safety.js` §4 | reparenting exists and is validated | the operation is removed | create-only; collection integrity | one operation, no cycle check on the write path |
| `state-lineage-safety.js` §6 | reparenting is *routed* | nothing reparents | `parentStateId` written only at creation | an absence is checkable; a routing claim was not |
| `alpha-production-loop.js` D2/D3 | slot commit = human approval | the semantics alpha removed | slot commit = selection | one authority concept; the creator is not told a view is canon |
| `alpha-production-loop.js` states-stay-distinct | three outcomes, matched verbatim | a fourth exists, and the literal moved | four outcomes, asserted through the real predicate | behavioural, not textual |
| `alpha-production-loop-negative-controls.js` NC-D2 | anchored on the three-outcome expression | the expression changed | same control, new anchor | unchanged in intent |
| `real-browser-workflow.py` imported reference | `decision === "approved-coverage"` | asserts a view is authority | `selected-coverage` | assignment unchanged; only the claim |
| `manual-first-workflow.js` coverage | `humanApproved: true` on a slot assignment | the row half of the same claim | `selectionProvenance`, `authoritative: false` | manual-first still proven: the act lands, with no AI, recorded as human |
| `coverage-workflow.js` preserved status | *"the status it was stored with"* | the fixture stores no status — it pinned the **derivation**, and the next line requires a warning saying the angle was NOT CHOSEN | `selected` | the status and the warning finally agree |
| `ofp-migration.js` clean migration | `diagnostics.length === 0` | zero diagnostics ≠ nothing to say | exactly two `authority.historic`, plus both halves of the reproduced case | pins one set instead of allowing any empty one |
| `ofp-migration.js` accounting pin | 3 rows `M030 mapped` | the mapping made a claim the source could not support | `M013 preserved`, each naming where its filename went | the one time the direction this table guards is the right answer |
| Overfit goldens | 10 pointers minting approved output | same, on real data | preserved as workflow evidence | re-pinned by the documented path, archive untouched |
| `safety-integrity.js` expression inbox | matched a literal in `entities.js` | the literal moved to the shared predicate | the queue consults the predicate; the predicate knows both words | one vocabulary instead of four |

No unrelated behaviour was weakened, and no compatibility shim was created for any removed concept.

---

# 14. Post-green semantic source audit

Ten sweeps, every match classified. **This section found six genuine defects, all fixed before this document was written** — which is the reason it had to run after green rather than instead of it.

| # | Sweep | Findings |
|---|---|---|
| 1 | authority written without the kernel | routed writers accounted for; 5 **NON-AUTHORITATIVE / SUPPORTING** (§8); **3 BUGS** — `setExpressionSlotField`, `seedCoverageFromPrimary`, `confirmPrimaryCoverageAssignment`, each writing `status:"approved"` on a supporting reference. Fixed. |
| 2 | authority concluded from raw pointer existence | **1 BUG, the most consequential of the batch** — `app.js` normalisation derived slot status from `approvedFile` presence in 3 places, produced `"approved"` on every load, and silently reverted the demotion. Fixed, and both shapes are now guarded by test. Also 1 **SUPPORTING REFERENCE** (coverage-slot retirement) and 1 **SAFE** (a ZIP export reading a file path). |
| 3 | current receipt accepted without full validation | none — one reader, `currentHumanAuthority`, and it validates the whole ledger |
| 4 | `humanApproved` read as provenance | **1 BUG** — `approveCoverageCandidate` left `humanApproved: true` and a human `approvalProvenance` on the candidate row after demoting the slot, which is exactly what `shared-production-media.js` reads. Fixed. Remaining: 6 run-step and report reads (**SAFE**), 2 display strings (**SAFE**), the renderer, which tests for a selection first (**SAFE**). |
| 5 | coverage/expression treated as Canon | **1 BUG in 3 places** — the AI badge, the assignment queue and the inspector count each knew only the legacy words, so a just-selected candidate read as unassigned. Fixed by one shared vocabulary. |
| 6 | unreceipted pointer exported as approved output | none — all 5 `context.approve` sites pass a target descriptor (verified across line breaks) |
| 7 | `parentStateId` mutated after creation | 2 normalisers filling a missing key (**SAFE**); 1 reparent-to-root inside the deletion transaction (**SAFE**) |
| 8 | deletion that can orphan descendants | none — `removeContinuityState` is the only remover and goes through the transaction; the other matches are one schema repair and two read filters |
| 9 | preflight/validate/check that mutates | **1 BUG, found and fixed earlier in the batch** — `v626ShotPreflight` called `guidedFrames`, so opening the automation planner created a frame. Re-verified: none of the five preflights calls any mutating helper. |
| 10 | paid dispatch reachable before local validation | none — the gate precedes `submissionAccounting`, `commit()` and `submit()` |

**Three further defects were found by the suites, all introduced by this batch and all fixed:** `applyEdge` callbacks writing live objects instead of the draft (the transaction then refused for a mismatch it had caused); `applyDraftToProject` replacing top-level keys, which detached every reference a caller already held (the commit is a deep in-place merge now); and kernel exports shadowing their own callers into infinite recursion (namespaced under `window.CineBraidAuthorityKernel`).

**And one real product bug Playwright caught:** an async approval handler minting its capability *after* an `await` was asking for a gesture window that had already closed — every real click would have refused. Both such handlers mint in their prologue now.

---

# 15. Known limitations

1. **The gesture window is time-scoped, not call-scoped.** Any code running synchronously inside a trusted event's turn could mint. That is the proportionate boundary for a local single-user tool; a call-site-scoped capability would need a different language-level mechanism.
2. **`v626ShotPreflight` still reads `resolveShotEntities` and `capabilityState`.** Neither mutates the project, but neither is a pure function of the shot either.
3. **Legacy `approved-coverage` decision words remain on disk** in pre-1C projects and are read as selections. No migration rewrites them.
4. **A coverage slot stored as `retired` with a file** has its status recomputed by the normaliser, as it did before this batch. Retired *expression* slots are preserved explicitly; the coverage path has no equivalent. Pre-existing and out of scope, named here because sweep 2 walked past it.
5. **The `interrupted` run status is still overloaded** (carried from 1B, P1).
6. **Historic contaminated ownership rows are still not migrated** (carried from 1B, P1) — quarantined conservatively and surfaced.

---

# 16. Complexity intentionally removed

| BEFORE | ALPHA MODEL |
|---|---|
| Multiple authority-like pointers — winner, videoWinner, approvedFile, coverage approvedFile, expression approvedFile, creation-final, `humanApproved` | **One human Canon authority**, four target kinds, one command |
| Coverage/expression approval semantics across five consumers, four unrouted writers, a three-place normaliser and four private vocabularies | **Non-authoritative supporting references** — one writer, one predicate, one vocabulary, enforced by a source guard |
| Mutable state ancestry with a reparent operation, an intent parameter, a cycle validator on the write path, and an eligible-parent filter | **Create-only immutable ancestry** — cycles structurally impossible |
| Legacy pointer inferred as approval | **Historic / non-authoritative until an explicit human action** |
| Prompt-text interpretation as the primary safety | **Structured frame truth first; bounded textual safeguard second** |
| Preflight performing normalization | **Pure read-only preflight** |
| Credential as a caller-constructible shape, with a public builder on `window` | **One-use capability identity, minted only at a trusted gesture** |
| `catch(AssertionError) ⇒ control passed` | **Probe contract: held under real, failed under mutation, for its own reason** |

**Net:** 2 authority target kinds removed · 1 whole authority surface removed (slots) · 1 mutation operation removed (reparent) · 3 public functions removed (`isHumanAuthorityGrant`, `humanAuthorityGrant`, `assertHumanAuthority`) · 4 lineage functions removed (`planParentMutation`, `applyStateParentMutation`, `safeParentAssignment`, `eligibleParentIds`) · 1 UI control removed (the parent dropdown) · 4 duplicate decision vocabularies collapsed to 1 · `shared-production-authority.js` is 238 lines shorter than it was, having deleted 449 and added 211.

# 17. Deferred to Professional / Enterprise

Recorded as extension points, **not implemented**, and none is required to preserve current production truth:

| Deferred | Where it would attach |
|---|---|
| Authenticated multi-user identity | the capability mint — `provenance.actor` is a constant today |
| Roles and permissions | the eligibility hook already on `commitAuthorityTransaction` |
| Delegated approvals | a `delegatedBy` field on the receipt; the schema validator is the gate |
| Signed / cryptographic provenance | `provenance` is an open record; signing is additive |
| Simultaneous collaborative editing | `installAuthorityProjectCommitter` — the commit is one seam |
| Distributed worker concurrency / locking | same seam; the transaction is single-document by design |
| Complex authority migration policy | the historic-selection path, which currently only reports |
| Coverage/expression authority receipts | add two kinds to `AUTHORITY_TARGET_KINDS` and one writer; deliberately closed today |

---

# 18. Validation receipt

No paid provider calls. No local-model calls.

| Command | Result |
|---|---|
| `check:production-authority` | **93** assertions |
| `check:frame-presence` | **63** assertions |
| `check:entity-ownership` | **52** assertions |
| `check:state-lineage` | **98** assertions |
| `check:correction-boundary` | **47** assertions |
| `check:dogfood2-architecture` | **271** end-to-end boundary checks |
| **Focused positive total** | **624** |
| `check:dogfood2-p0-negative` | **19 controls**, each held under the real module and failed for its own named reason |
| `check:ofp-migration` | 33 rules, 20 fixtures, 84 accounted values, 0 unaccounted |
| `check:ofp-overfit` | 18 generations, 18431 values accounted, 0 unaccounted, **0 approved statements** |
| `npm.cmd run check` | **167 suites, 142.4s, all green.** Slowest: alpha-loop-browser 33.7s, focused-browser 23.4s, job-media-identity 18.3s, browser-real 17.6s, ui-state 16.9s |
| `git diff --check b23d231` | clean |
| worktree | clean at the recorded HEAD |

**How no paid call is possible.** The dispatch tests replace `globalThis.fetch` with a recorder that throws and register the FAL module against a scratch directory outside the repository; reaching the network is the failure condition. Browser paths run in the vm render harness, whose `fetch` is intercepted. The real-Chromium suites run against a locally launched CineBraid with provider access unconfigured.

# 19. Preserved evidence

**The Dogfood #2 project state was not modified.** No project directory, `project.json`, `automation-runs.json`, `generation-jobs.json` or generated media was read for mutation or written. The Overfit archive was not opened.

- No historic candidate ownership rewritten.
- No historic authority edge rewritten — a pre-repair winner is exactly where it was; what changed is that CineBraid no longer claims a person chose it.
- No lineage record repaired; damage is detected and named.
- No receipts fabricated for legacy selections.

All six canonical documents byte-identical to their committed blobs:

| Document | Blob |
|---|---|
| Pass #2 closeout | `d28b4e1e` |
| Forensic audit | `8d066f5b` |
| Batch 1 handoff | `f018740a` |
| Batch 1 acceptance audit | `13145e50` |
| Batch 1B architecture handoff | `f179f874` |
| Batch 1B acceptance audit | `778b3e2d` |

---

# 20. Status

- Branch `fix/dogfood2-production-trust-kernel`.
- **Not merged.**
- **Stopping for independent Codex acceptance.**

*Prior documents: the Pass #2 closeout, the forensic audit, the Batch 1 handoff and acceptance audit, and the Batch 1B architecture handoff and acceptance audit — all in `docs/dogfood/`.*

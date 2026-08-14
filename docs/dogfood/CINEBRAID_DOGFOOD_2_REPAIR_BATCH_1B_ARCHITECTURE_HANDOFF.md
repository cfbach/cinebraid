# CineBraid Dogfood #2 — Repair Batch 1B Architecture Handoff

## Centralized Trust Boundaries for the Six P0 Invariants

**Date:** 2026-08-14
**Batch:** Dogfood #2 Repair Batch 1B (architectural correction)
**Document type:** Handoff. Repairs implemented; **not merged.** Stopping for independent re-audit.

---

# 1. Starting SHA

`16701449f3b1a0639911029be50195d5ad1baafc` — `fix/dogfood2-production-trust`, the exact Repair Batch 1 HEAD both the handoff and the acceptance audit name.

| Phase 0 receipt | Observed |
|---|---|
| Repository root | `C:/CineBraid/CineBraid-Source` |
| Branch at start | `fix/dogfood2-production-trust` |
| HEAD | `16701449f3b1a0639911029be50195d5ad1baafc` |
| `origin/main` | `afe1853ce2fa69f43489822c0e86d5a4c45ea3f6` |
| Ahead / behind `origin/main` | `3 / 0` |
| Working tree | Clean except one untracked file |
| Untracked | `docs/dogfood/CINEBRAID_DOGFOOD_2_REPAIR_BATCH_1_ACCEPTANCE_AUDIT.md` |

The acceptance audit report was the only new file, exactly as predicted.

# 2. Acceptance-audit checkpoint SHA

`8b1606e25a2f9f23f89c84d0f58185b4a143e2c0` — `docs: checkpoint repair batch 1 acceptance audit`

One file, 388 insertions, no source changes. Committed on `fix/dogfood2-production-trust` before branching, so the corrective branch descends from the audit rather than sitting beside it.

# 3. Branch

`fix/dogfood2-production-trust-architecture`, created from `8b1606e`.

The first repair is **not** rewritten, squashed or reverted. Its two commits (`9e64137`, `8e34d1d`) and its handoff (`1670144`) are ancestors of this branch and remain readable as the state the audit judged.

# 4. Commits

| SHA | Subject |
|---|---|
| `8b1606e` | `docs: checkpoint repair batch 1 acceptance audit` |
| `3c98006` | `fix: centralize the six Dogfood #2 P0 invariants as mandatory boundaries` |
| *(this document)* | `docs: dogfood #2 repair batch 1B architecture handoff` |

# 5. Final HEAD

`3c980068bffd0cc3209547c76f83c274143dc0f6` plus this document.

Source commit scope: **29 files, 2,643 insertions, 316 deletions.** No project data, generated media, provider state, secrets or environment configuration is in the diff. `git diff --check` clean.

---

# 6. Architectural boundaries introduced

The audit's diagnosis was that safety was distributed across helpers and callers, so the correction is not six fixes — it is six places where a question can only be answered once.

| # | Boundary | Lives in | Answers |
|---|---|---|---|
| 1 | `commandProductionAuthority` (+ `writeFrame…` / `writeEntityState…` / `revoke…`) | `public/shared-production-authority.js` | Who may establish production authority, and what durable record proves it |
| 2 | `gateSatisfied` / `reconcileRunGates` / `resumeAuthority` | same | Whether a human gate is satisfied **right now**, in both directions |
| 3 | `finalDispatchPresenceGate`, installed in `POST /api/generation/fal/jobs` | `public/shared-frame-presence.js` + `fal-generation.js` | Whether the exact text about to be sent contradicts the frame's declared presence |
| 4 | `resolveMediaOwnership` (+ the veto inside boundary 1) | `public/shared-entity-ownership.js` | Which entity may make a file canon |
| 5 | `applyStateParentMutation` | `public/shared-state-lineage.js` | Whether a parentage change is permitted |
| 6 | Ordered preflight in `v640AutomateSceneCorrection` | `public/scene-automation.js` | Whether a correction package is usable, before anything is dereferenced |

## 6.1 The authority receipt

The shipped module reasoned: *only a human may write a winner, therefore a winner is a human decision.* That is sound for edges written after the guard existed and false for every edge that predates it — which is what a preserved dogfood project is made of.

**An edge is not a decision. A decision leaves a receipt.**

```
{ id, sequence, actor: "human", act: "explicit-approval",
  command:  "approve-shot-frame" | "approve-entity-state",
  targetType, targetId, shotId, frameId, list, entityId, stateId,
  value, assetId, via, at,
  status: "current" | "superseded" | "revoked",
  supersededBy, supersededAt, revokedAt, revocationReason, revokedVia }
```

Stored at `project.productionAuthority.receipts[]`, append-only in the sense that matters: a decision is superseded or revoked, never deleted, because "this was approved and then un-approved" is production history and a ledger that forgets it cannot explain why a gate reopened.

`currentHumanAuthority` requires **both** halves:

- the **receipt** — a person issued the command and it still stands;
- the **edge** — the project still carries what they approved.

The second half is what makes the invariant independent of writer discipline: a path that clears a winner without calling the revocation command still loses authority. **Fail closed.**

**NO MIGRATION IS REQUIRED, AND NONE IS PERFORMED.** A project with no ledger has no human authority. That is the honest answer for every pre-repair winner: it stays exactly where it is, stays visible, and is offered as a *historic selection* one human act away from becoming real. This is why the change needs no schema migration and destroys no evidence.

## 6.2 What the gate reads

```
gateSatisfied(requirement, project)
  = hasCurrentHumanAuthority(project, gateAuthorityTarget(requirement))
```

Nothing else. Every projection, badge, count, resume decision, browser predicate and server ledger read routes here.

---

# 7. Every former direct or bypass writer, removed or routed

## 7.1 Production authority (frame / shot winner, entity state approvedFile)

| File / function | Before | Now |
|---|---|---|
| `public/automation.js` `v626ApproveFrame` | guarded, then wrote the edge itself | writes **inside** `writeFrameProductionAuthority`; returns the receipt |
| `public/automation.js` `v626ApproveEntity` | guarded, then wrote the edge itself | writes inside `writeEntityStateProductionAuthority` |
| `public/automation.js` frame resume | read `prior.result?.humanApproved`, minted itself a grant, re-approved | reads `resumeAuthority`; **writes nothing** — a live receipt means the edge is already there |
| `public/automation.js` entity resume | same shape | same correction |
| `public/automation.js` frame reuse branch | reused any existing winner | reuses only under a current receipt; otherwise parks at the gate presenting the selection |
| `public/automation.js` entity reuse branch | reused any `approvedFile` | same correction |
| `public/scene-automation.js` correction approval | already grant-guarded | unchanged call, now routed through the command by `v626ApproveFrame` |
| `public/library-tools.js` `approveTake` | direct `s.winner` / `f.winner` / opening-frame writes | one `writeFrameProductionAuthority` per target, edge writes inside `applyEdge` |
| `public/library-tools.js` `confirmEntityApproval` | direct `targetState.approvedFile` / `x.approvedFile` | `writeEntityStateProductionAuthority`, and the ownership veto now applies |
| `public/review.js` `confirmEntityBatchApproval` | direct state/entity writes per shortlist row | one command per target; a vetoed row is skipped and reported, the rest still land |
| `public/review-provenance.js` `promoteFinishJob` | direct `s.winner` / `f.winner` | `writeFrameProductionAuthority` |
| `public/creation-studio.js` `useApprovedBaseAsShotImage` | direct `s.winner` + `opening.winner` | command |
| `public/creation-studio.js` `markGuidedStillFinal` | direct `s.winner` | command |
| `public/creation-studio.js` `resetGuidedFrameApproval` | cleared the winner field | `revokeFrameProductionAuthority` — a **revocation**, which reopens every dependent gate |
| `public/creation-studio.js` `ensureGuidedMotionUnit` | `frame.winner = currentName` as a side effect of opening the composer | **removed** |
| `public/v607-composer.js` guided motion unit | the live twin of the same line | **removed** |
| `public/app.js` normalisation (`s.keyframes[0].winner = s.winner`) | — | retained and documented: it propagates an existing edge between two records of the same fact and mints no receipt, so it cannot create authority |
| `server.js` `clearUnsupportedBuilderClaims` (import) | cleared edges only | also drops any imported `productionAuthority` ledger, with a warning — CineBraid cannot verify approvals made elsewhere |

**Deliberate scope boundary, stated rather than hidden.** Coverage-slot and expression-slot approvals (`public/entities.js`, `public/coverage-automation.js`, `public/review.js`) are approval *pointers*, not human-gate objects — the gate model covers shot frames and continuity states. They carry no receipt. They **are** durable ownership claims, so `approveCoverageCandidate` now applies the same ownership veto; without it, approving a contested file into a slot would silently change who owns those bytes. Extending the receipt model to coverage slots is a P1 contract decision, not a Batch 1B repair.

## 7.2 Lineage

| File / function | Before | Now |
|---|---|---|
| `public/library-tools.js` `confirmEntityApproval` | `safeParentAssignment` → wrote a first parent | **no lineage write of any kind** |
| `public/creation-studio.js` `setContinuityStateGeneration` | `state[key] = value` for `parentStateId`, no validation | `applyStateParentMutation`, intent `explicit-lineage-edit` |
| `public/creation-studio.js` parent `<select>` | every state except self — descendants included | built from `eligibleParentIds` |
| `public/entities.js` `openContinuityStateVariant` | direct assignment | routed |
| `public/entities.js` `correctContinuityStateFromParent` | direct assignment | routed |
| `public/entities.js` `setContinuityState` (generic setter) | `state[k] = v` accepted `parentStateId` from anywhere | routed for that one key |
| `public/automation.js` entity-state automation | `state.parentStateId = parent.id` | routed |
| `public/app.js` × 2 normalisers | filled the field directly | initialise to `""`, then route the inferred ancestry |

`safeParentAssignment` survives under its shipped name and now defaults to the **navigation** intent, which refuses every write — so a caller that did not think about intent gets the safe answer.

## 7.3 Ownership

| Site | Change |
|---|---|
| `public/entities.js` `entityMedia` | now the **approval-capable pool** only: unique durable claim required |
| `public/entities.js` | new `entityUnassignedMedia`, `entityContestedMedia`, `claimEntityMedia` |
| `public/entities.js` entity page | renders the conflict panel and the claimable quarantine |
| `public/coverage-automation.js` import mapper | offers owned **and** unassigned, labelled; confirming writes the claim |
| `public/shared-production-media.js` | raw `startsWith` fallback replaced by the authoritative resolver; **fails closed** (no rows) when unavailable |
| `public/automation.js` | new `v627ClaimGeneratedEntityCandidates` — a run records the claim for media it generated for a named entity, so ownership never depends on server-ingest timing |

## 7.4 Presence dispatch

`fal-generation.js` `POST /api/generation/fal/jobs`, immediately before `submissionAccounting`, `commit()` and `submit()`. Every client dispatcher (`generation-picker.js`, `public/fal-generation.js` × 4, `public/automation.js`, `public/scene-automation.js`, `public/coverage-automation.js`) posts here. There is no body, purpose or caller convention that skips it.

---

# 8. Tests added

| Suite | Content |
|---|---|
| `tests/dogfood2-p0-architecture.js` **(new, 690 lines)** | **186 end-to-end boundary checks.** Drives the real FAL dispatch route, the real UI setters, the real approval writer and the real correction runner |
| `tests/dogfood2-p0-negative-controls.js` | **24 → 37 controls.** 12 new, aimed at the central boundaries; probe-receipt mechanism repaired |
| `tests/production-authority.js` | 89 → 94 |
| `tests/entity-media-ownership.js` | 35 → 52 |
| `tests/state-lineage-safety.js` | 53 → 71 |
| `tests/frame-presence-authority.js` | 63, unchanged |
| `tests/continuity-correction-boundary.js` | 47, unchanged count |

**Positive assertions: 413 (was 287). Negative controls: 37 (was 24).**

Registered in all three registries: `package.json` (`check:dogfood2-architecture`, added to the `check:dogfood2-p0` aggregate), `tests/run-full-check.js`, and the filename manifest in `tests/current-behavior.js`.

## 8.1 The five pre-existing expectations that changed

Each encoded behaviour the audit required us to reverse. None was updated to match new output; each was rewritten to assert the correct invariant with the reasoning recorded in place.

1. **`tests/production-authority.js`** — asserted resume reads `prior.result?.humanApproved`. That read *is* the resurrection. Replaced by: resume calls `resumeAuthority`, never reads the cached boolean, and issues itself no grant.
2. **`tests/production-authority.js`** — fixtures hand-wrote a `winner` and asserted the gate was satisfied. That is the audit's counterexample stated as a requirement. Fixtures now **approve through the command**; the hand-written winner is retained and proves the opposite property.
3. **`tests/entity-media-ownership.js`** — asserted an unclaimed file returned by `filterEntityMedia` was "visible to its owner". That reader is the approval pool, so the expectation literally said *a guess is canon-eligible*. Split into eligibility (refused) and discoverability (kept).
4. **`tests/entity-media-ownership.js`** — asserted a contested file is `attributedTo` the child. Filename specificity is the reasoning that created the contamination; it may not be the reasoning that settles it. Now `attributedTo: ""`, with both claimants surfaced.
5. **`tests/state-lineage-safety.js`** — asserted navigation "may still acquire its first parent" and that a sibling is the only continuation after the deepest descendant. Both are the narrowed-exception defect. Now: navigation writes nothing; continuation is descendants-only.

## 8.2 A defect found in the control harness itself

`mutate()`'s probe receipt used `assert.strictEqual`. `control()` catches AssertionErrors and reads them as *the invariant broke, so the control fired* — so a control whose anchor had disappeared reported **success while mutating nothing**. The receipt that exists to prevent a silent no-op was producing one. It throws a plain `Error` now, which `control()` re-throws. Repairing it immediately exposed six stale controls (C3, C4, C12, C14, C16, C18), all retargeted at the current boundaries.

---

# 9. Adversarial counterexamples — the audit's own probes, as tests

| Audit finding | Counterexample now under test | Where |
|---|---|---|
| P0-1 A | preserved automatic winner satisfies a human gate | §1, plus missing/unknown/empty provenance |
| P0-1 A | reconciliation writes `humanApproved: true` | §1 — plan is empty; nothing is written |
| P0-1 B | revoke → resume restores authority | §1 — full approve/replace/revoke/forge sequence |
| P0-1 C | authority writes fragmented across callers | control C1c/C1d + writer inventory (§7.1) |
| P0-2 A | "The Chimbley Sweep stands before the chimney" | §2 + control C7b |
| P0-2 A | "moves without hesitation", "not only is X visible" | §2 |
| P0-2 A | true negatives still permitted (12 sentences) | §2 |
| P0-2 B | automation raw dispatch bypasses the compiler | §3 — real route, 4 real caller bodies |
| P0-2 B | correction raw dispatch bypasses | §3 |
| P0-2 B | `v626DerivativeBlockingBuild` dispatches with no `frameId` | §3 — fails closed |
| P0-2 C | local contradiction classified as a provider fault | §6 classifier checks + control C18b |
| P0-3 A | "actionable iff unsatisfied" rests on false authority | §1 + control C1b |
| P0-3 B | reconciliation is one-way | §1 invalidation + control C2c |
| P0-4 A | unclaimed prefix match enters the approval pool | §4 + control C10b |
| P0-4 B | contested file attributed to one claimant | §4 + control C10c |
| P0-4 C | raw prefix fallback in `shared-production-media` | resolver-unavailable check, §4 |
| P0-5 A | approval navigation writes a first parent | §5 — real `confirmEntityApproval` |
| P0-5 B | parent dropdown offers a descendant; setter closes a cycle | §5 — real `setContinuityStateGeneration` |
| P0-5 C | generic setter bypasses the validator | §5 — real `setContinuityState` |
| P0-6 | real runner throws unclassified `TypeError` before preflight | §6 — 4 cases through `v640AutomateSceneCorrection` |

Every test in the new suite fails on one of exactly two things: **durable false state**, or **an attempted provider dispatch**. Not on a helper's return value, and not on a source string.

## 9.1 Anti-vacuity evidence

Three independent proofs the suite is not passing against nothing:

1. **The provider trap fires on a legitimate request.** A shot with no presence contract reaches `https://queue.fal.run/openai/gpt-image-2` and the test asserts `providerAttempts === 1`. If the gate refused everything, this assertion would fail.
2. **Removing the gate breaks the suite.** With `if (!presenceGate.ok)` disabled, the first bypass caller returns **502** carrying `PROVIDER CONTACTED: https://queue.fal.run/openai/gpt-image-2` and a committed `UNRESOLVED` paid-job row. Restored immediately; `git diff` verified.
3. **All 37 negative controls fire**, including `CG`, which loads a mutated `fal-generation.js` through Node's real module system and proves the boundary is mandatory rather than conventional.

---

# 10. Authority receipt proof

| Claim | Evidence |
|---|---|
| A receipt records actor, command, target type, target id, value, timestamp, provenance and supersession state | §1 — asserted field by field |
| A legacy automatic winner satisfies no human gate | `gateSatisfied` false; `historicSelection.basis === "no-human-receipt"` |
| Missing, empty, unknown and machine provenance all fail identically | four fixtures, §1 |
| The selection is not hidden | `gateHistoricSelection` returns it with `requiresHumanApproval: true` |
| Every non-human grant shape is refused **and writes nothing** | 7 grant shapes × (throw + `applyEdge` never ran + zero receipts) |
| Replacement supersedes rather than overwrites | `["superseded", "current"]`, with `supersededBy` naming the successor |
| Revocation records why | `["superseded:replaced", "revoked:withdrawn"]` |
| A cleared edge loses authority even without a revocation call | control C2d — receipt **and** edge required |
| An imported ledger is not adopted | `clearUnsupportedBuilderClaims` drops it with a warning |

# 11. Bidirectional reconciliation proof

| Direction | Assertion |
|---|---|
| unsatisfied → satisfied | human approval → `plan.satisfied.length === 1`, step completes, run leaves `awaiting-review` |
| the citation | `result.authorityReceiptId` matches the minted receipt; a plan entry with no receipt id closes nothing |
| satisfied → unsatisfied | revoke → `plan.invalidated.length === 1`, step returns to `needs-review`, `humanApproved: false`, `authorityInvalidated: true`, run returns to `awaiting-review` |
| resume | `resumeAuthority` returns the receipt before, `null` after, and `null` against a forged `humanApproved: true` |
| replacement | resume answers with the **current** receipt, never a superseded one |
| surfaces converge | server `readReconciled` (now `awaiting-review` **and** `interrupted`), `runHasActionableGate`, browser `v670RunGateOutstanding` → the same `runHasActionableGate`, and `v670WaitingForHumanRun` reopening an `interrupted` run via `runHasRevokedAuthority` |
| no race | `running` runs are still never reconciled — a live orchestrator owns that record |

# 12. Universal final-prompt gate proof

| Caller | Result |
|---|---|
| full-shot automation frame generation | 409 `FRAME_PRESENCE_CONTRADICTION`, 0 provider attempts, 0 job rows |
| automation blocking generation | same |
| scene continuity correction | same |
| contradiction only in a reference instruction | same — labels and instructions are inspected too |
| blocking with no `frameId` on a shot that declares presence | 409 `FRAME_PRESENCE_TARGET_UNRESOLVED`, fails closed |
| a shot declaring no presence | passes; **reaches the provider** (trap fires) — the gate is not a blanket refusal |
| a frame declaring the entity **present** | passes |
| `entity-reference` | ungated; it carries no frame contract |

The gate reads `job.prompt` **after** `applyImageCompilationToJob` may have replaced it and after any filmmaker edit, and runs before accounting, before `commit()` and before `submit()`.

Negation: 7 must-catch and 12 must-permit sentences, mention-scoped. `narrativeForFrame` moves with the detector — the spatial-`before` sentence is now withheld, and a correctly-authored absence is kept in full.

# 13. Conservative ownership proof

| Case | `basis` | `authoritative` | Eligible? | Visible? |
|---|---|---|---|---|
| unique durable claim | `durable-claim` | true | yes | yes |
| unclaimed, prefix matches | `prefix-inference` | false | **no** | yes, in the quarantine, with a Claim button |
| unclaimed, no prefix match | `none` | false | no | no |
| two durable claimants | `contested` | false | **no, for either** | yes, as a blocking conflict on both pages |
| tie between identical prefixes | `none` | false | no | no |

- The veto lives **inside** the authority command, so no approval surface can route around it, and a refusal writes nothing.
- With no authoritative resolver, approval throws `AUTHORITY_OWNERSHIP_RESOLVER_UNAVAILABLE` — **fail closed**, verified in §4.
- Contaminated historic rows are **not migrated**. They are quarantined by the current read and surfaced as conflicts. §16 records what a migration would need.
- The repair names no dogfood entity; the existing test that forbids it still passes.

# 14. Centralized lineage proof

| Assertion | Evidence |
|---|---|
| navigation writes no parentage, including a first parent | `planParentMutation` refuses `navigation`; the approval path has no assignment at all |
| the real approval flow mutates nothing | §5 — `confirmEntityApproval(true)` executed; parent map byte-identical |
| the parent dropdown cannot offer a cycle | `entityStateParentOptions` from `eligibleParentIds`; asserted against the rendered options |
| the real selector cannot close a cycle | §5 — `setContinuityStateGeneration` with a descendant; parents unchanged, `lineageCycles === 0` |
| the generic setter cannot either | §5 — `setContinuityState` |
| legitimate reparents still work | §5 — an explicit edit the graph permits is applied |
| validation is atomic | the whole graph is simulated and re-checked; control C15b breaks that layer alone |
| a rejected mutation dirties nothing | asserted on the object, not the return value |
| every writer is routed | inventory assertion: no raw `.parentStateId =` outside the validator in any of the four writer files, except normalisation initialising the field to `""` |
| pre-existing damage is reported, not invented | `lineageCycles` on damaged data unchanged |

# 15. Correction ordering proof

Order in `v640AutomateSceneCorrection`: **identity → target validity → package shape → neighbours → omissions → hydrate → final preflight → submit.** Steps 1–7 contact nothing and create no job row.

| Case | Result |
|---|---|
| deleted target | typed `local-package`, "SH-99-DELETED no longer exists", remediation, **0 dispatches** |
| malformed package (no target) | typed, "names no target shot", 0 dispatches |
| target with no approved still | typed, 0 dispatches |
| package with no correction instruction | typed, 0 dispatches |
| single-shot scene / first shot | **builds**; previous omitted as `scene-boundary` |
| deleted neighbour | **builds**; omitted as `shot-no-longer-exists` |
| retry budget | `local-package` and `local-preflight` both deterministic; attempt counter not advanced |

Every case asserts **zero** provider dispatches, counted on the Node side of the harness where nothing in the page can reset the counter.

`v643HydrateSceneCorrectionPackage` now validates before each dereference and throws the typed error, so the bare `TypeError: Cannot read properties of undefined (reading 'clips')` the audit produced is unreachable.

---

# 16. Validation receipt

No paid provider call. No local model call.

| Command | Exit | Receipt |
|---|---:|---|
| `npm.cmd run check:dogfood2-p0` | `0` | Seven suites. Authority **94**, presence **63**, ownership **52**, lineage **71**, correction **47**, architecture **186** = **513 positive assertions**; **37 negative controls, all fired**. |
| `npm.cmd run check` | `0` | `CineBraid full verification passed: 167 suites in 144.6s.` — run against the exact committed tree at `3c98006` |
| `git diff --check` | `0` | No whitespace errors |

Earlier full runs during the batch, all green: 223.0s, 145.1s, 141.8s. The 166 → 167 suite increase is the new architecture suite.

`npm.cmd` is used throughout; PowerShell's execution policy blocks `npm.ps1` on this host, exactly as the acceptance audit recorded.

**How no paid call is possible.** The dispatch tests replace `globalThis.fetch` with a function that records the attempt and throws, and register the FAL module against a scratch project directory outside the repository. Reaching the network is the failure condition, not a side effect. Browser paths run in the vm render harness, whose `fetch` is intercepted. The real-browser Playwright suites run against a locally launched CineBraid with provider access unconfigured, as they do on `main`.

# 17. Remaining blockers

**None known against the eight merge blockers the acceptance audit listed.** Each is addressed above: 1 → §6.1/§10; 2 → §11; 3 → §12; 4 → §12/§15; 5 → §13; 6 → §14; 7 → §15; 8 → §8/§9.

Two things a re-audit should press on, stated because they are the weakest joints rather than because they are known to be broken:

1. **Coverage and expression slots carry no authority receipt** (§7.1). They are not gate objects and cannot satisfy a human gate, and the ownership veto now covers them — but if the product later treats a coverage slot as canon in its own right, the receipt model has to extend to it.
2. **`liveAuthorityValue` matches a receipt by filename or by `assetId`.** The rename path repairs both (`repairAuthorityReceiptIdentity`, called beside the two existing identity repairs). A rename route that repaired the edge without the receipt would silently revoke a real decision. There is exactly one rename route today.

# 18. Safe P1 deferrals

Unchanged from the audit's non-blocking list, and now safe to defer:

1. **The overloaded `interrupted` status.** Safe now: the predicate and revocation defects it depended on are corrected, so the label is presentation. Splitting it touches the dispatch path.
2. **Migration for historic contaminated rows.** Current reads quarantine them conservatively and surface the conflict, which is what the audit required before merge. A previewable migration tool remains follow-up. A migration would need: the contested set from `contestedOwnership`, a per-file human decision, removal of the losing claim, and a record of what was resolved and by whom.
3. **Presence declarations in OFP.** `readShotPresenceBindings` returns the shape a `continuity` extension would serialize; the format decision is P1.
4. **Python 3 for the optional real-browser audit layer.** Environment, not product.
5. **The rest of the closeout's P1/P2 tiers** — A7, A8, A9, A10, A11, A12, C2, B11, B12 and the three design briefs. Untouched, as instructed.

# 19. Provider-call confirmation

**No paid provider call was made.** No FAL, H3, GPT Image or other hosted generation endpoint was contacted at any point in this batch.

**No local model call was made.** No Qwen / Ollama endpoint was contacted.

The one moment a provider URL appeared was the deliberate anti-vacuity mutation in §9.1: with the gate disabled, the trap recorded `PROVIDER CONTACTED: https://queue.fal.run/openai/gpt-image-2` and **threw before any request left the machine**. The gate was restored immediately and `git diff` confirmed the file byte-identical.

# 20. Dogfood-evidence confirmation

**The preserved Dogfood #2 project state was not modified.** No project directory, `project.json`, `automation-runs.json`, `generation-jobs.json` or generated media was read for mutation or written.

- No historic candidate ownership was rewritten. Contaminated rows are reported and quarantined.
- No historic authority edge was rewritten. A pre-repair automation-written winner is exactly where it was; what changed is that CineBraid no longer claims a person chose it.
- No lineage record was repaired. An existing cycle is detected and named.
- No automation-run ledger was edited retroactively. Reconciliation acts only on `awaiting-review` and `interrupted` runs, and only to bring a gate into line with current durable authority.
- **All four canonical documents are byte-identical to their committed blobs**, verified by `git hash-object`:

| Document | Blob |
|---|---|
| `CINEBRAID_DOGFOOD_PASS_2_CLOSEOUT_2026-08-14.md` | `d28b4e1e` |
| `CINEBRAID_DOGFOOD_2_FORENSIC_AUDIT.md` | `8d066f5b` |
| `CINEBRAID_DOGFOOD_2_REPAIR_BATCH_1_HANDOFF.md` | `f018740a` |
| `CINEBRAID_DOGFOOD_2_REPAIR_BATCH_1_ACCEPTANCE_AUDIT.md` | `13145e50` |

The first two match the blob IDs the acceptance audit itself recorded.

---

# 21. Status

- Branch `fix/dogfood2-production-trust-architecture` at `3c98006` plus this document.
- **Not merged.**
- Full verification green: 167 suites.
- **Stopping for independent Codex re-audit.**

*Prior documents: `CINEBRAID_DOGFOOD_PASS_2_CLOSEOUT_2026-08-14.md`, `CINEBRAID_DOGFOOD_2_FORENSIC_AUDIT.md`, `CINEBRAID_DOGFOOD_2_REPAIR_BATCH_1_HANDOFF.md`, `CINEBRAID_DOGFOOD_2_REPAIR_BATCH_1_ACCEPTANCE_AUDIT.md`.*

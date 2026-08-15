# CineBraid Dogfood #2 — Repair Batch 1D Closure Handoff

## Seven escape hatches, closed by deleting them

**Date:** 2026-08-14
**Document type:** Handoff. Repairs implemented; **not merged.** Stopping for independent Codex acceptance.

---

# 1. Repository receipt

| Receipt | Observed |
|---|---|
| Branch at start | `fix/dogfood2-production-trust-kernel` |
| HEAD at start | `ee24dabf2f1cbfd8336f952ee4d6b74fef55bc45` ✅ matches the brief |
| Batch 1C implementation tree | `3c5fe9c769b3e0434efd243f3174f5dfd9ce1268` ✅ matches |
| `3c5fe9c..ee24dab` | docs-only, 1 file ✅ |
| 1C acceptance audit present | `docs/dogfood/CINEBRAID_DOGFOOD_2_REPAIR_BATCH_1C_ACCEPTANCE_AUDIT.md`, verdict **HOLD — ARCHITECTURAL ISSUE REMAINS**, seven merge blockers ✅ |
| Audit edited | **No.** Committed byte-for-byte as found. |
| Worktree at start | clean but for that untracked audit |

# 2. Exact base

Branched from `ee24dab`, the Batch 1C tip. No Batch 1C history is rewritten, squashed or reverted; every prior repair and both prior acceptance audits remain ancestors.

# 3. Branch and final SHA

| | |
|---|---|
| Branch | `fix/dogfood2-production-trust-closure` |
| Verified SHA | `4fa57e6343017894b08f56e37b9508ddcffe96a7` — the last code commit, and the tree the 167-suite run was executed against |
| Branch HEAD | this document, committed on top. Docs-only; no source or test file differs from the verified tree |
| Against `ee24dab` | **27 files, +2126 / −424** |

# 4. Batch 1C audit evidence checkpoint

`a43c105` — `docs: checkpoint repair batch 1C acceptance audit`. The audit alone, unedited, blob `e5b0386a`, committed before any code changed.

# 5. Pre-fix reproduction — MB-1C-01 … MB-1C-07

Every blocker was reproduced against the 1C tree **before** any repair. In-memory only: no network, no provider, no local model, no project data.

| ID | Reproduced | Observed |
|---|---|---|
| **MB-1C-01** | ✅ | Browser composition (`window === global`, no `require`). `installHarnessManualActionSource` present as a loose window global **and** on `window.CineBraidAuthorityKernel`. Ordinary page script installed it, opened a gesture with **no event of any kind**, and committed `VALUE-B` with `actor: "human"`, `act: "explicit-approval"`. |
| **MB-1C-02** | ✅ | Capability minted for `shot-frame:SH-1#fr-a` with value `A`/asset `asset-A` committed value `B`/asset `asset-B` against the same target. No error; the receipt recorded `B`. |
| **MB-1C-03** | ✅ | `SHARED.png` claimed by CHAR-A and CHAR-B; resolver `{authoritative:false, contested:true}`. `writeProductionAuthority` exported. `writeEntityStateProductionAuthority` with `eligibility: () => ({ok:true})` wrote `approvedFile = "SHARED.png"`. |
| **MB-1C-04** | ✅ | `productionAuthority: null`. A raw automatic winner projected `disposition.role: "approved"`, `humanDecision.state: "approved"`, `counts.approved: 1`, targets *"Approved shot image \| Frame A"*. |
| **MB-1C-05** | ✅ | After a valid commit, setting `receipt.assetId = "asset-WRONG"` left the receipt **current**. Separately, `ledger.version = "not-a-version-we-know"` was still **trusted**. |
| **MB-1C-06** | ✅ | `LINEAGE_DELETION_POLICIES = [refuse, reparent-to-root, cascade]`. `root→child→grand`: `applyStateDeletion(policy: "reparent-to-root")` removed `child` and rewrote `grand.parentStateId` to `root`. `entities.js` invokes that policy from a confirm dialog. `app.js` had 2 normaliser ancestry writes. The module simultaneously exported `reparentingUnsupported()` claiming derivation "does not change". |
| **MB-1C-07** | ✅ | Both halves. An `applyEdge` closing over the live project wrote `MUTATED-BY-CLOSURE` then threw: command threw, 0 receipts, **live edge stayed mutated**. And `eligibility` received `draftReadOnly(project)` — identity-equal to the live project, `isFrozen === false` — mutated it, returned `{ok:false}`, mutation remained. |

**Three did not reproduce on the first attempt, and all three were my own API misuse, not Codex errors.** The target descriptor is flat on the request rather than nested under `target:`; `productionMediaRecords({project, scan})` returns `{records, counts}` and needs `shots: { ID: { takes: [...] } }`; `planStateDeletion` takes the **states array**, not the entity. Corrected probes reproduced every case. That is recorded because the brief was right to demand it — the first run would have produced three false "Codex was wrong" claims.

---

# 6. Correction for each blocker

Every one is a **deletion**. Nothing here is a new configurable mechanism.

| ID | What was deleted | What remains |
|---|---|---|
| **1D-01** | `installHarnessManualActionSource`, from the module, the window globals and the namespace | One gesture source: a trusted event on the target the composition root installed on, install-once |
| **1D-02** | The assumption that a target is a decision | A capability binds target **and** value **and** asset; a changed selection is `MANUAL_ACTION_VALUE_STALE` / `_ASSET_STALE` |
| **1D-03** | The `eligibility` parameter, and the exported `writeProductionAuthority` | Target-kind policy inside the kernel; four named operations |
| **1D-04** | Four of the five ways to be "approved" | One: a valid current receipt. Everything else is `historic` |
| **1D-05** | The `byName \|\| byIdentity` disjunction, and a decorative version field | Exact agreement; a validated version |
| **1D-06** | `reparent-to-root`, `cascade`, the creator dialog that invoked one, and two normaliser ancestry writes | One deletion policy: `refuse` |
| **1D-07** | Twelve caller `applyEdge` callbacks and `draftReadOnly` | A kernel-installed edge writer; no caller code runs inside the transaction |

---

# 7. Architecture removed rather than added

| Removed | Count |
|---|---|
| Public functions deleted | `installHarnessManualActionSource`, `writeProductionAuthority`, `draftReadOnly` |
| Caller-supplied `applyEdge` callbacks | **12 → 0** |
| Caller-supplied `eligibility` callbacks | **7 → 0** (6 slot + 1 authority) |
| Lineage deletion policies | **3 → 1** |
| Ways to be "approved" in the projection | **5 → 1** |
| Load-time ancestry authors | **2 → 0** |
| Impure preflights | **1 → 0** |
| Gesture sources in the product | **2 → 1** |

Added: three installers (`installAuthorityEdgeWriter`, `installAuthorityOwnershipPolicy`, `installSlotOwnershipPolicy`) — module wiring done once at load, **not parameters**, which is the distinction the whole batch turns on; one disposition role (`historic`), which names an absence; and one test-only file outside `public/`.

---

# 8. Browser harness removal (1D-01)

The kernel has **one** way to open the gesture window: `installBrowserManualActionSource` registers capture-phase listeners that refuse anything whose `event.isTrusted !== true`. It **installs once** — every later caller is refused, so page script cannot install a competing source on an event target it controls and fire its own events at it.

Tests drive that same real path from **outside page scope**. `tests/authority-test-gesture.js` owns an event target whose listeners live in a Node closure; the render harness owns its document's listener registry the same way and delivers events from Node. Page script inside the vm can call `document.addEventListener` but cannot enumerate or invoke what is registered.

The boundary is **compositional, not conventional**: the ability to say "a person did this" belongs to whoever owns the event target, and in the product that is the user agent.

The render harness installs first, with a `schedule` that never closes the window — which also **exercises the install-once guard**, because bootstrap.js runs later in the same loop and is refused. If that guard regressed, bootstrap would win and the approval suites would start failing.

# 9. Exact manual-action binding (1D-02)

A capability means: **this gesture, approving this target, with these bytes.** Each target entry carries its own `value`/`assetId`, so one batch token binds four different files to four different targets.

At commit, a bound value or asset that does not match exactly is refused as stale — and a capability minted against a specific asset may not be spent on a request that has forgotten the identity. Regressions cover: target A/asset A succeeds · target A capability with asset B fails · changed filename fails · replay fails · another target fails.

# 10. Mandatory target-kind ownership (1D-03)

There is no `eligibility` parameter, so there is nothing to omit and nothing to replace. For `entity-state`, the file must have exactly one durable owner and it must be the entity being approved; zero owners, a prefix inference and two claimants all refuse. Shot kinds have no ownership concept — a shot's own take belongs to the shot.

**The generic path is not a bypass, and that is asserted rather than assumed.** The policy-free wrapper is gone. The kernel command is still reachable through the namespace, because the four named operations are built on it — and that is safe *only* because the policy moved **into the kernel** rather than into the wrappers. The architecture suite proves the two give the identical answer for a contested file, and that the answer is `AUTHORITY_OWNERSHIP_CONTESTED` with nothing written.

The same treatment was applied to the **supporting-reference** writer, where six call sites each passed their own copy of the ownership closure.

# 11. Raw-pointer projection removal (1D-04)

Every approved edge a P4 partition claims is put to the authority reader. Backed by a valid current receipt it stays `approved`; unbacked it becomes **`historic`** — a real selection nobody approved as Canon.

`humanDecisionOf` no longer derives approval at all. It was a disjunction of four — the edge, the decision word, `humanApproved`, and the mere presence of `approvedAt` — none of which is evidence and all of which a machine write leaves behind. The row's fields still travel as history; they no longer decide.

**Nothing is hidden.** The edges are still enumerated, `disposition.authority` states `{claimed, receiptBacked, backedTargets}`, `counts.historic` is reported, Results gives the card its own **HISTORIC** status word, and the Inspector says *"Something selected this for a target, but nobody has approved it. It is not production canon until you approve it."*

Historic rows sit under **Candidates** rather than getting a fifth tab: the tabs answer "is this canon", and historic and candidate share that answer.

# 12. Exact receipt / live-edge agreement (1D-05)

One rule: **the value must match exactly, and where both sides carry an asset identity that must match exactly too.** A side with no identity recorded is not a contradiction — plenty of legitimate edges predate identity stamping — but two identities that disagree are. A legitimate rename goes through `repairAuthorityValue`, the explicit operation that already exists.

**Half the rule was dead and this batch found it.** The reader looked for `record.approvalIdentity.winner`; nothing has ever written that — `stampShotApprovalIdentity` writes `record.winnerAssetId`, which is what the fixtures and the Results projection read. So every shot-side `live.assetId` came back blank and the receipt's identity was never compared against anything. The reader now reads the field the writer writes, the legacy shape is still accepted on read, and the architecture suite pins the name against the disposition module's own answer.

**The ledger version is validated**, not decorative: a version this build does not understand fails closed like any other unreadable ledger.

# 13. Immutable-lineage closure (1D-06)

```
LINEAGE_DELETION_POLICIES = ["refuse"]
```

`reparent-to-root` and `cascade` are gone. Asking for a removed policy by name reports `unsupported-deletion-policy` rather than being silently downgraded. The creator dialog that offered *"Delete it and attach those states to the base reference instead?"* is gone; the creator is told which states derive from this one and that CineBraid will not re-point them.

**Load does not author ancestry.** Both normalisers filled a missing `parentStateId` with the default state on every open — deciding, without asking, what a state derives from. An unrecorded derivation stays unrecorded, is reported to the creator by name through `dataIntegrityWarnings`, and is **not** an integrity failure: failing it would stop a legacy project from ever adding a state.

`entityStateList` is split. `entityStateListRead` is the pure reader and `v627EntityPreflight` uses it.

# 14. Transaction callback simplification (1D-07)

The kernel runs **no caller code inside the transaction**. `shared-production-authority.js` installs one edge writer at load which mirrors the reader field for field, so the post-commit agreement check compares like with like. Revocation clears through the same writer.

The brief's alternative — hand callbacks a deep-frozen snapshot — was rejected because it keeps the seam. The architecture no longer claims a caller "physically cannot reach the live document"; it runs no caller code, which is a claim JavaScript can actually keep.

What callers still do is everything that is **not** the Canon pointer: workflow status, delivery intent, angle bookkeeping. Those now run after the approval returns, which is where they belonged — they were never part of the atomic write, only sharing a callback with it.

**A real defect fell out of this.** `s.winner` is the opening frame's legacy authority location, and the new delivery writer was writing it too, so two target kinds shared one field and a motion/delivery revocation silently withdrew a frame approval nobody had withdrawn. Caught by `browser-workflow`'s frame-replacement test.

# 15. Supporting-reference wording cleanup

| Before | After |
|---|---|
| *"— no approved view assigned —"* | *"— no view selected —"* |
| *"Replace the approved image for this view"* | *"Replace the image selected for this view"* |
| *"Run and pass AI review before approving this coverage view"* | *"…before selecting this coverage view"* |
| *"Use this approved view to preserve construction…"* | *"Use this selected supporting view…"* |
| *"Approved view of…"* | *"Selected view of…"* |
| toast *"…coverage approved"* | *"…coverage selected"* |

`approvedFile` remains as **legacy storage naming whose semantic value is NON-AUTHORITATIVE** — renaming a persisted field across every reader is a data migration, not a wording change, and it is not worth the risk in a closure pass. `SLOT_SELECTION_DECISIONS` still recognises `approved-coverage` / `approved-expression` **on read only**: a pre-1C project has them on disk, nothing emits them, and they normalise to selection semantics without claiming Canon.

# 16. Entity-preflight purity

`v627EntityPreflight` called `entityStateList(entity, true)`, which inserts a default state, migrates notes, adds generation fields and syncs the entity's approved file — so opening the automation planner edited the project. It uses the pure reader now. Verified across all six preflights: none calls a mutating helper.

# 17. New negative controls

**27 controls** (19 carried forward, 8 new), all obeying the repaired K8 contract.

| Control | Reintroduces |
|---|---|
| **D1** | Batch 1C's `installHarnessManualActionSource`, verbatim, into a browser composition. Proves page script then mints `actor: "human"` with no event. *Not a source mutation — the property is that an export does not exist, so it restores the deleted code.* |
| **D2** | Both staleness checks removed; a capability for A/asset-A commits B/asset-B |
| **D3** | Target policy made optional; contested `SHARED.png` becomes canon. The caller's `eligibility:()=>({ok:true})` is passed too and is inert |
| **D4** | Raw-pointer approval in the projection; a winner with a null ledger reads APPROVED/approved |
| **D5** | The OR match; a receipt naming different bytes stays current |
| **D5b** | Version validation removed; version 99 is read anyway |
| **D6** | `reparent-to-root` across three layers; a grandchild is re-rooted |
| **D7** | The caller-callback seam; a throwing closure leaves the live document mutated after a refused write |

**Three existing controls were re-expressed, not deleted:** C1's synthesized record now mirrors the 1D `Map` shape, so the mutation reintroduces the defect instead of crashing — a control that "holds" because the broken code threw a `TypeError` proves nothing. C6 moves the kernel's own writer instead of a caller callback. C16 anchors on the unqualified refusal.

# 18. Changed legacy expectations

| # | Expectation | Old behaviour | Why invalid | New invariant |
|---|---|---|---|---|
| 1 | `production-authority` state fixture | `eligibility: () => ({ok:true})` skipped ownership | the escape the audit named — used by the suite itself | the fixture durably owns its files, which is the only way left |
| 2 | `production-authority` projection block | 4 raw pointers, no ledger, all `approved` | the audit's words: *"pins the unreceipted case as an ordinary manual approval"* | `historic`; edges, targets and provenance word all still reported; the receipted case now covered too |
| 3 | `state-lineage-safety` §4 | `reparent-to-root` succeeds, beneath prose claiming immutability | the contradiction the audit named | asserted as an absence, plus the sequence that does work |
| 4 | `dogfood2-p0-architecture` source honesty | `manualActionSourceInstalled() === "harness"` | true about a source that should not exist | no synthetic installer anywhere in the browser composition; install-once; no event ⇒ no mint |
| 5 | `production-media` fixture | declared approvals with no ledger | the projection had to call raw pointers approved for the suite to pass | receipts established through the **shipped writers** |
| 6 | `production-media` prop | edge-only approval read as `approved` | unattributable pointer; also **not approvable**, since PR-TOOL owns nothing | `historic`, surfaced and described |
| 7 | `production-media` partitions | 3 roles | a fourth exists | `historic` counted and placed |
| 8 | `production-media-negative` C6 | anchored on the removed disjunction | the anchor moved | same defect against the code that exists |
| 9 | `production-media-negative` C8 | anchored on the 3-word status map | ditto | 4-word map |
| 10 | `media-disposition-semantics` selector | *"— approved · Moonlit night · Master establishing"* | MB-1C-04's sentence, for a fixture with no ledger | both labels kept, honest word, plus an assertion that the approval claim is absent |
| 11 | `safety-integrity` review gate | matched *"before approving"* | wording change | *"before selecting"*; the gate itself is what is asserted |
| 12 | `current-behavior` manifest | did not know the new test file | new file | registered |
| 13 | `dogfood2-p0-negative` C1 / C6 / C16 | anchors and shapes from 1C | code moved | re-expressed (§17) |

No compatibility shim was created for any removed concept.

# 19. Post-green semantic sweep

Fourteen sweeps, run **after** green. **Four live violations found and fixed** — which is the answer to whether the sweep was worth running.

| # | Sweep | Finding |
|---|---|---|
| 1 | browser-accessible test authority helpers | none — matches are comments and unrelated modules |
| 2 | generic policy-free Canon writers | none. Four named operations; the kernel command grants nothing extra (§10, asserted) |
| 3 | caller-overridable mandatory policy | **BUG ×1** — the slot writer still took `eligibility`, duplicated across six call sites. Fixed: installed once, callers name the owner |
| 4 | authority from raw pointer presence | **BUG ×2** — the reference candidate card and the view picker labelled media "approved" from the raw partition. Fixed through the one exported predicate |
| 5 | `humanApproved` without a receipt | none deciding. Two reads name the ACTOR, one reports `approvedWithoutAI` — **SAFE**, reported not deciding |
| 6 | partial/disjunctive identity readers | none |
| 7 | coverage/expression as human Canon | none — the renderer tests for a selection first |
| 8 | reparent / cascade paths | none |
| 9 | `parentStateId` after creation | none. `addContinuityState` is creation (**SAFE**); `app.js` normalises the TYPE of an existing key only |
| 10 | normalizers inventing ancestry | none |
| 11 | preflight/check/validate mutating | none across all six |
| 12 | callbacks able to mutate live state | none |
| 13 | OFP inferring approval from pointers | none — all five `context.approve` sites carry a target |
| 14 | duplicate representations of truth | none — one predicate, one reader |
| — | stale comments | **BUG ×1** — a comment describing `draftReadOnly`, deleted this batch. Removed |

The Inspector also had no word for the fourth disposition; it would have rendered its own role token. Fixed.

# 20. Validation receipt

**No paid provider calls. No local-model calls.**

| Command | Result |
|---|---|
| `check:production-authority` | **100** assertions |
| `check:frame-presence` | **63** |
| `check:entity-ownership` | **52** |
| `check:state-lineage` | **107** |
| `check:correction-boundary` | **47** |
| `check:dogfood2-architecture` | **285** end-to-end boundary checks |
| **Focused positive total** | **654** |
| `check:dogfood2-p0-negative` | **27 controls** — 19 carried, 8 new, each held under the real module and failed for its own named reason |
| `npm.cmd run check` | **167 suites, 142.2s, PASS** |
| `git diff --check ee24dab` | clean |
| Worktree | clean |
| Scope | 27 files, +2126 / −424 |

**The Python real-browser suites RAN here.** The 1C audit had to record them as a limitation for lack of a Python 3 interpreter; this environment has one, and `check:browser-real`, `check:alpha-loop-browser`, `check:focused-browser`, `check:manual-first` and the MiniMax H3 audit all launched Chromium 151.0.7922.34 and passed. Nothing was installed or reconfigured to obtain that.

**How no paid call is possible.** Dispatch tests replace `globalThis.fetch` with a recorder that throws and register the FAL module against a scratch directory outside the repository; reaching the network is the failure condition. Browser paths run in the vm render harness, whose `fetch` is intercepted. The real-Chromium suites run against a locally launched CineBraid with provider access unconfigured.

# 21. Remaining non-blocking cleanup

1. **The gesture window is macrotask-scoped.** Any code running synchronously inside a trusted event's turn could mint. Proportionate for a local single-user tool; a call-site-scoped capability needs a different language-level mechanism.
2. **`approvedFile` is still the slot storage field name.** Documented as legacy naming with non-authoritative semantics; renaming it is a data migration.
3. **`revokeProductionAuthority` remains generic**, and revocation requires no gesture. Deliberate: withdrawing authority cannot manufacture it, and automatic invalidation on a frame change depends on it.
4. **A coverage slot stored as `retired` with a file** has its status recomputed by the normaliser, as it did before this batch. Pre-existing.
5. **`interrupted` run status is still overloaded** (carried from 1B).
6. **Historic contaminated ownership rows are still not migrated** (carried from 1B) — quarantined and surfaced.

# 22. Professional / Enterprise deferrals

Documented, **not implemented**; none is required to preserve current production truth.

| Deferred | Where it would attach |
|---|---|
| Authenticated multi-user identity | the capability mint — `provenance.actor` is a constant today |
| Roles and permissions | the target-policy table in the kernel |
| Delegated approvals | a `delegatedBy` field; the schema validator is the gate |
| Signed / cryptographic provenance | `provenance` is an open record; signing is additive |
| Simultaneous collaborative editing | `installAuthorityProjectCommitter` — the commit is one seam |
| Distributed locking / worker concurrency | same seam; the transaction is single-document by design |
| Sophisticated authority migration policy | the historic-selection path, which currently only reports |
| Coverage/expression authority receipts | add two kinds to `AUTHORITY_TARGET_KINDS`; deliberately closed today |

# 23. The six-sentence alpha model

1. **A human explicitly approves Canon through a manual action** — one gesture source, a trusted event, a one-use capability bound to the exact target, value and asset.
2. **The authority kernel owns Canon validation and persistence** — it validates the whole ledger on every read, owns the target-kind policy, writes the edge itself, commits once, and re-reads to prove it landed.
3. **Automation cannot create Canon** — it runs in async continuations and is never inside a trusted gesture.
4. **Supporting references and legacy pointers are not Canon** — slots are non-authoritative by construction, and any edge without a valid current receipt reads as `historic` in every surface.
5. **Continuity ancestry is immutable after state creation** — one deletion policy, no reparent, and load reports unrecorded derivation instead of inventing it.
6. **Preflight and read paths do not mutate production truth** — all six preflights are pure structural reads.

**No `except` clause is required for any of the six.** The three items that might look like exceptions are not: revocation is generic but withdraws authority rather than creating it; the kernel command is reachable but grants nothing the named operation does not, which is asserted; and the macrotask gesture window is a stated bound on sentence 1's strength, not an exception to it.

# 24. Confirmations

- **No paid provider calls.** ✅
- **No local-model calls.** ✅
- **Preserved Dogfood project unchanged.** ✅ No project directory, `project.json`, `automation-runs.json`, `generation-jobs.json` or generated media was read for mutation or written. The Overfit archive was not opened.
- **Canonical evidence unchanged.** ✅

| Document | Blob |
|---|---|
| Pass #2 closeout | `d28b4e1e` |
| Forensic audit | `8d066f5b` |
| Batch 1 handoff | `f018740a` |
| Batch 1 acceptance audit | `13145e50` |
| Batch 1B architecture handoff | `f179f874` |
| Batch 1B acceptance audit | `778b3e2d` |
| Batch 1C trust-kernel handoff | `f1afcbe6` |
| **Batch 1C acceptance audit** | `e5b0386a` — committed unedited at `a43c105` |

---

## Status

- Branch `fix/dogfood2-production-trust-closure`.
- **Not merged.**
- **Stopping for independent Codex acceptance.**

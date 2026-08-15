# CineBraid Dogfood #2 — Production Truth Simplification Handoff

**This is not Repair Batch 1E.** Batches 1B, 1C and 1D each added a guard to the
production-authority architecture and each failed independent acceptance. This
pass deletes the architecture the guards were guarding.

---

## 1. Branch

`fix/dogfood2-production-truth-simplification`

## 2. Baseline

| | |
|---|---|
| Branched from | `fix/dogfood2-production-trust-closure` |
| Baseline HEAD | `4eb6521390051ce683e71587c678365747e93e60` — verified before any change |
| Batch 1D implementation commit | `4fa57e6343017894b08f56e37b9508ddcffe96a7` — verified as an ancestor of the baseline |
| Source of truth for the remaining blockers | `docs/dogfood/CINEBRAID_DOGFOOD_2_REPAIR_BATCH_1D_ACCEPTANCE_AUDIT.md` (verdict: **HOLD — ARCHITECTURAL ISSUE REMAINS**) |

`main` was not modified. Nothing was merged.

## 3. Final HEAD

Implementation commit: `999cc9179e083192ec1ec1386bc9322b95db76ad`
Final HEAD is that commit plus the one documentation commit that adds this
line. The branch is pushed; **do not merge** — it is submitted for independent
Codex acceptance.

## 4. Commits

| Commit | Contents |
|---|---|
| `999cc91` | `fix(dogfood2): delete the production-authority architecture the guards were guarding` — the whole implementation, the test reset, and the simplification map and deferrals note |
| *(this one)* | `docs: dogfood #2 production truth simplification handoff` — records the implementation commit hash |

## 5. Files changed

45 files, **2,979 insertions / 3,751 deletions** — a net reduction of 772 lines
across 20 shipped modules and 25 suites, plus three new documents.

| Area | Files |
|---|---|
| Canon kernel | `public/shared-authority-kernel.js` |
| Gate reconciliation | `public/shared-production-authority.js` |
| Supporting references | `public/shared-entity-slots.js`, `public/shared-coverage.js`, `public/shared-media-disposition.js`, `public/shared-entity-ownership.js` |
| Approval surfaces | `public/library-tools.js`, `public/creation-studio.js`, `public/automation.js`, `public/review.js`, `public/review-provenance.js` |
| Projections | `public/app.js`, `public/entities.js`, `public/coverage-automation.js`, `public/fal-generation.js`, `public/shared-production-media.js`, `public/continuity-workspace.js`, `public/styles.css` |
| Server | `server.js` |
| Docs | `PRODUCTION_TRUTH_SIMPLIFICATION_MAP.md`, `PRODUCTION_TRUTH_DEFERRED_ARCHITECTURE.md`, this file |

## 6. Old architecture, in one paragraph

A Canon write required a **capability**: an object minted inside a trusted user
gesture and spent later by whatever code ran next. Binding the capability to a
value or an asset was optional, and all twelve shipped approval surfaces omitted
it. The gesture window closed on `setTimeout(0)`, so every Promise continuation
in the event's macrotask still saw it open. Meanwhile the rules themselves —
ownership policy, edge reader, edge writer, project committer — were **exported
installers**, none install-once, all replaceable by ordinary page script after
boot, and all executed inside the authority transaction. Downstream, three
surfaces each re-derived "approved" from raw fields and got three different
answers for the same entity.

## 7. The new model — three concepts, and there is no second page

| Concept | Means | Stored as | Never means |
|---|---|---|---|
| **CANON** | A creator explicitly approved these exact bytes as production truth. | A current receipt in `project.productionAuthority` **and** a live edge matching it exactly, in both value and asset identity. | "a pointer exists", "a run finished", "a status says APPROVED" |
| **REFERENCE** | Useful selected supporting media. May guide generation and review. | `coverageSlots[].selectedFile` / `expressionSlots[].selectedFile`, `status: selected`, `assignment.authoritative: false`. No receipt. | Canon |
| **HISTORIC** | An old pointer with no current Canon behind it. Visible, traceable, offered for confirmation. | Any live edge value with no current receipt. | Canon |

`APPROVED` as a product word is now reserved for the human Canon decision.

## 8. Old machinery deleted

```
beginManualApproval                  installAuthorityEdgeReader
beginManualAuthorityAction           installAuthorityEdgeWriter
manualActionCovers                   installAuthorityOwnershipPolicy
consumeManualAction                  installAuthorityProjectCommitter
MINTED_MANUAL_ACTIONS (registry)     installSlotOwnershipPolicy
openTrustedGesture / closeTrustedGesture (public)
commitAuthorityTransaction (exported, generic)
revokeAuthorityTransaction (exported, generic)
commitNamedAuthority                 useEntityOwnershipResolver
writeAuthorityEdge (exported)        entityOwnershipEligibility (exported)
readAuthorityEdge (exported)         entityApprovedReferenceCount
writeFrameProductionAuthority        coverageAuthorityReferences
writeMotionProductionAuthority       manualApprovalActive
writeDeliveryProductionAuthority     authorityLedgerTrusted
writeEntityStateProductionAuthority  sameAuthorityTarget
revokeProductionAuthority / revokeFrameProductionAuthority / revokeEntityStateProductionAuthority
the render harness's session-long gesture scheduler seam
```

Replaced by:

```
approveFrameCanon    revokeFrameCanon      entityProductionTruth   (one read-only projection)
approveMotionCanon   revokeMotionCanon     currentHumanAuthority / hasCurrentHumanAuthority
approveDeliveryCanon revokeDeliveryCanon   historicSelection / authorityHistory
approveEntityStateCanon revokeEntityStateCanon                    repairCanonValue
```

**Zero replaceable installers remain.** The only installer the kernel exposes is
`installBrowserManualActionSource`, which says what a human gesture *is* and is
refused after the first call.

## 9. Approval-flow simplification

**There is no capability.** A Canon write is one synchronous call, made inside
the trusted user event, that names the target, the exact value and the exact
asset identity in a single statement.

Getting the window right took three attempts and the middle one only failed in a
real browser, which is worth recording:

- Batch 1D closed the gesture on `setTimeout(0)`. Timers run after the microtask
  queue drains, so every `.then()` continuation still saw it open.
- Closing on a **microtask** is wrong the other way: the event loop runs a
  microtask checkpoint whenever the JS stack empties — after *every listener* —
  so a microtask queued in the capture phase runs before the target's own
  handler, and every approval in the product refused. Node suites passed; real
  Chromium did not.
- The window is therefore not a span of time. It is **the event dispatch**, and
  the question asked at the write is `window.event === the trusted event this
  gesture was opened for`, read through the user agent's own accessor captured
  at install time so a shadowing assignment cannot answer for it.

Three call sites were restructured rather than guarded:

| Surface | Was | Now |
|---|---|---|
| `confirmApproveTake` (shot take approval) | mint → `await` rename → commit whatever came back | **commit Canon on the displayed bytes → rename → `repairCanonValue`** |
| `confirmEntityApproval` (reference approval) | same | same |
| `approveAutomationCandidate` (run gate) | mint → `await` refresh → resolve candidate → spend | **commit Canon from the cached run the person is looking at → `await` for run-ledger bookkeeping only** |

`useApprovedBaseAsShot` is a **deliberate product change**: it copies a plate in
and then opens the product's ordinary approval modal, pre-filled. The file it
would have made Canon does not exist until after an `await`, so under this model
the app cannot approve it on the creator's behalf — and the creator could not
previously see the filename or image they were getting. One extra click, using
the confirmation the product already requires for every other still.

Ordinary approval is otherwise unchanged: one click, no tokens visible, no new
ceremony. Real-Chromium coverage proves it (§23).

## 10. Supporting-reference migration

`slot.approvedFile` → **`slot.selectedFile`**, through one accessor
(`slotSelectedFile`, which reads the legacy key as a fallback). Normalization
carries the value across on load — a rename, not a migration: no media touched,
no history dropped. Vocabulary is `missing | selected | retired`. Slots mint no
receipts, appear in no Canon count, and create no human-approval provenance.
The UI says "Selected", never "Approved".

## 11. Library changes

`entityApprovedReferenceCount` — which merged the entity pointer, every state's
pointer **and every coverage and expression slot** into one "approved" number —
is deleted. `libraryCard` and `libraryView` read the one projection and render
**CANON / REFERENCES / HISTORIC**. The *Approved* tab is now the **Canon** tab
and is receipt-backed; `#/library/approved` still resolves there for old
bookmarks. Its copy no longer tells the creator that supporting views "currently
define production truth".

## 12. Automation / reference package changes

Roles name a **purpose**:

| Was | Now |
|---|---|
| `identity-authority` (from a raw pointer) | `identity-canon` (receipt-backed only) |
| `approved-view` | `supporting-view` / `expression-reference` / `environment-reference` |
| `authorityManifest` | `referenceManifest` |
| "primary approved authority" | "canon identity" |
| "supplied approved authority package" | "supplied reference package" |

`primaryReference()` resolves receipt-backed Canon; a raw pointer is Historic and
`historicPrimaryPointer()` is how a surface offers it. `public/fal-generation.js`
got the same treatment, and so did the **server-side reviewer input builder**,
which was labelling unreceipted pointers "primary identity / design authority".

## 13. Exact identity and revocation

- **S5.** If the receipt records an asset identity, the live edge must record the
  same one. A live edge that has lost its identity **fails closed**; Batch 1D
  compared "only where both sides carry one" and rounded up on the filename.
- **S1A.** The `assetId` key must be *present* in every approval request. An
  explicit `""` is a legitimate answer ("no identity in this project"); silence
  is not. Batch 1D made it optional and all twelve surfaces omitted it.
- **S5A.** Delivery persists and reads `finalStillAssetId` /
  `approvedMotionAssetId`. Batch 1D returned a hard-coded `""`, so a delivery
  receipt could never be checked against the bytes it named.
- **S5B.** Revocation clears the edge its **target kind** names. The
  still-versus-video inference from the new value is deleted — on a revocation
  there is no new value, which is why every video revocation took the still
  branch and left `approvedMotionFile` behind. Revoking `shot-delivery` clears
  the deliverable in whichever form it took, with its identity, and never touches
  `s.winner`, which is the opening frame's edge.

## 14. Preflight purity

`entityStateList` is renamed **`ensureEntityStateList`** — the name now says it
writes — and `entityStateListRead` is the reader. `entityStateById` reads.
Twenty informational call sites (automation planners, review pools, entity and
library renderers, continuity workspace) moved to the reader. The legacy
`description → notes` delta migration moved out of the list builder and into
`normalizeProjectV5`, which is CineBraid's named, deliberate mutation of a
project it has just opened.

## 15. Lineage disposition

**Unchanged, on purpose.** `LINEAGE_DELETION_POLICIES` is `["refuse"]`,
ancestry is create-only, `reparentingUnsupported` remains a refusal.
`tests/state-lineage-safety.js` passes its 107 checks. One source-text expectation
was updated for the `ensureEntityStateList` rename; no invariant changed.

## 16. Dispatch disposition

**Unchanged.** `tests/frame-presence-authority.js` passes 63 checks. No text
parsing was expanded; structured production intent remains primary.

## 17. OFP disposition

**Unchanged.** `npm.cmd run check:ofp-core` passes, including 21 overfit negative
controls and **0 approved migration statements**. `ofp/` was not edited. OFP
migration reads historical fixtures, which legitimately carry `approvedFile`;
that is the Historic reading and is correct.

## 18. The eleven Batch 1D counterexamples

| # | Counterexample | Status | Regression |
|---|---|---|---|
| 1 | later Promise microtask uses the same trusted-event window | **CLOSED** | `dogfood2-p0-architecture.js` (harness, real `window.event`) + `production-authority.js` (Node consequence) + control **C1** |
| 2 | target-only approval turns `DISPLAYED.png`/`asset-A` into `CHANGED.png`/`asset-B` | **CLOSED** | `dogfood2-p0-architecture.js` drives the real modal through a rename; control **C2** |
| 3 | replace the exported ownership policy, approve contested bytes | **CLOSED** | absence assertions + page-scope probe + control **C5** |
| 4 | replace writer/committer, mutate live state | **CLOSED** | page-scope probe assigns both names and observes no effect; control **C6** |
| 5 | supporting coverage slot under the Approved Library | **CLOSED** | rendered Library assertions + control **C7** + **real Chromium** |
| 6 | unreceipted `LEGACY.png` becomes identity-authority | **CLOSED** | real dispatch boundary refuses and says why; control **C8** |
| 7 | supporting `SIDE.png` becomes `approved-view` | **CLOSED** | submitted job's roles/labels/manifest asserted |
| 8 | receipt asset present, live asset disappears | **CLOSED** | `production-authority.js` §1.6; control **C3** |
| 9 | delivery receipt cannot compare live asset identity | **CLOSED** | `production-authority.js` §1.7 |
| 10 | video revocation leaves `approvedMotionFile` | **CLOSED** | `production-authority.js` §1.8 (both directions); control **C4** |
| 11 | opening the entity automation modal creates continuity state | **CLOSED** | `dogfood2-p0-architecture.js` (entity added post-load, so the assertion is not vacuous); control **C9** |

## 19. Changed legacy expectations

Recorded because each is a deliberate contract change, not a test bent to pass:

| Suite | Was | Now | Why |
|---|---|---|---|
| `manual-first-real-browser.py` | a human-assigned coverage view reads "Approved" | reads "Selected", and **must not** read "Approved" | a selection is not an approval |
| `manual-first-real-browser.py` | `#/library/approved` | `#/library/canon`, asserting the reference-only entity is **absent** | the tab is receipt-backed |
| `manual-first-workflow.js` | slot `approvedFile` | slot `selectedFile`, and `approvedFile === undefined` | the field moved |
| `coverage-workflow.js`, `intent-loss-safety.js`, `media-disposition-semantics.js`, `real-browser-workflow.py` | slot `approvedFile` | value survives under `selectedFile` | the value is what "a project must not become less complete for being opened" protects |
| `reference-authority-deep-dive.js` | every location role is `location-geometry` | `identity-canon` then `environment-reference` | an approval and a selection were one word |
| `reference-workspace-ux.js` | warning says "The approval is kept as stored" | "The selection is kept as stored" | a slot holds a reference |
| `alpha-production-loop.js` | four decision outcomes | five — a cached `humanApproved` with no current receipt reads **APPROVED EARLIER · NOT CURRENT CANON** | a citation can go stale |
| `api-smoke.js` | reviewer input role "exact parent-state editable authority" | "…editable canon", and the fixture carries a real receipt | the reviewer is told which it is |
| `state-lineage-safety.js` | `entityStateList(x, true)` in source | `entityStateListRead(x, true)` | the reader/writer rename |
| Coverage automation fixtures | an `approvedFile` was enough to run | a receipt is required | S8A |

## 20. Post-green semantic sweep

Run after the suite was green, on the assumption that the tests were incomplete.
Thirteen sweeps; four real violations found and fixed **after** green:

| Finding | Class | Fix |
|---|---|---|
| `markGuidedStillFinal` wrote `s.winner` + identity stamp outside the kernel — and on the no-frame arm produced a frame pointer with no frame receipt | **BUG** | writes nothing; approves delivery Canon (and frame Canon when there is a frame) |
| `confirmApproveTake` wrote `creationBrief.approvedMotionFile` after a **motion** approval, fabricating an unreceipted **delivery** pointer | **BUG** | removed — approving a take is not deciding the deliverable |
| `server.js` derived slot `status = "approved"` from file presence on the builder-kit import | **BUG** | derives `"selected"` |
| the server-side reviewer input labelled raw pointers "primary identity / design authority" | **BUG** | receipt-aware: "canon reference" vs "historic reference … context only" |
| `entityReviewHumanDecisionMarkup` printed APPROVED BY YOU from a cached `humanApproved` | **BUG** | reads the projection; a claim no receipt supports reads as history |
| `markGuidedVideoFinal`'s `c.approvedMotionFile = name` | DEAD | removed (the kernel had already written it) |
| `manualApprovalActive`, `authorityLedgerTrusted`, `sameAuthorityTarget` | DEAD | deleted |
| stale header paragraph describing `isHumanAuthorityGrant` | DEAD | rewritten |
| `f.winner = files[i]` on legacy shot bootstrap; `app.js` pointer sync | HISTORIC | correct as-is — preserved, never promoted |
| `decisionActor` reading `humanApproved` | WORKFLOW-ONLY | never proves Canon; `humanDecisionOf` gates on the receipt |
| remaining `installAuthority*` / `commitAuthorityTransaction` hits | comments only | retained as historical rationale |

A separate scan confirmed **no `approve*Canon` call follows an `await`** in any
shipped handler, and **no top-level `const` collision** exists across
`public/*.js` (the class of bug that blanks the whole app and no Node suite sees).

## 21. Six-sentence self-audit, against shipped code

| # | Sentence | Verdict | Exception |
|---|---|---|---|
| 1 | **Human explicitly approves Canon.** | **PASS** | None. One private `commitCanon`; `requireTrustedGesture` is called on the single path into it; the four named commands are the whole public write surface; value and stated asset identity are required by construction. |
| 2 | **Automation only recommends.** | **PASS** | None. No token exists to carry into a continuation; `window.event` is not the gesture's event in any `await`, `.then()`, timer or run loop. `v626ApproveFrame`/`v626ApproveEntity` are reachable only from the run **approval modal**, synchronously inside the creator's click. |
| 3 | **Supporting references are not Canon.** | **PASS** | None. Slots have their own field, their own vocabulary, no receipt writer, no Canon count, and their own Library section. `shared-entity-slots.js` contains zero references to the ledger. |
| 4 | **Legacy pointers without current Canon are Historic.** | **PASS** | None found. One projection; Generated Media, the Library, coverage automation, `fal-generation`, the server reviewer and reconciliation all read it. |
| 5 | **State ancestry is immutable after creation.** | **PASS** | None. No path reassigns a valid state's parent; normalization string-normalizes an existing parent and clears an invalid root's, which authors nothing. |
| 6 | **Preflight does not mutate.** | **PASS** | None found. Opening any planner leaves the whole project byte-identical, asserted against an entity added *after* load so the assertion is not vacuous. |

No sentence requires a material exception.

## 22. Simplicity metrics

| Measure | Before | After |
|---|---|---|
| Replaceable installer functions | **5** | **0** |
| Public Canon write entry points | 5 wrappers + 1 generic transaction | **4 named commands** |
| Human-capability machinery (functions) | **5** | **0** |
| `beginManualApproval` invocations in shipped code | **12** | **0** |
| Slot writers using an `approved`-named key | **2** | **0** |
| Independent "is this approved?" readers | **3** (Library, coverage automation, Generated Media) | **1** projection |
| `shared-production-authority.js` exports | 45 | **41** |
| `shared-production-authority.js` lines | 912 | **677** |
| Dogfood #2 negative controls | **27** | **9** |
| Net lines across the change | — | **−772** |

The kernel grew (1,085 → 1,299 lines) because the document shape and the
ownership veto moved *into* it from behind installers. That is the point: the
lines are the same rules, no longer replaceable.

## 23. Real-browser evidence

**The Batch 1D audit's environment claim does not reproduce.** Python 3.13.14 is
available here and the Playwright/Chromium suites run:

| Suite | Result |
|---|---|
| `npm.cmd run check:manual-browser` | **PASS** — real Chromium 151.0.7922.34 |
| `npm.cmd run check:browser-real` | **PASS** — real Chromium |

This is load-bearing, not incidental: the microtask closing strategy passed every
Node suite and **failed in real Chromium**, because the event loop runs a
microtask checkpoint between listeners. Without real-browser coverage this pass
would have shipped a product in which no approval worked.

Counterexample 5 is asserted in real Chromium: the Canon tab excludes a
reference-only entity, nothing is badged APPROVED, and the slot stores
`selectedFile` with no `approvedFile`.

## 24. Professional / Enterprise deferrals

`docs/dogfood/PRODUCTION_TRUTH_DEFERRED_ARCHITECTURE.md`. Nine items recorded as
deliberate deferrals (multi-user identity, roles, delegation, signed provenance,
hostile-local-process security, distributed locks, concurrent editors, policy
engines, cross-version authority migration), plus the two things that must stay
implemented and the one limitation this alpha accepts.

## 25. Full validation receipt

| Command | Result |
|---|---|
| `npm.cmd run check` | **PASS — 167 suites in 135.3s** |
| `npm.cmd run check:production-authority` | PASS — **154 checks** (canon, references, historic, automation, lineage, preflight) |
| `npm.cmd run check:dogfood2-architecture` | PASS — **73 checks**, all eleven counterexamples |
| `npm.cmd run check:dogfood2-p0-negative` | PASS — **9 controls**, each with a live-defect receipt |
| `npm.cmd run check:production-media` | PASS |
| `npm.cmd run check:production-media-negative` | PASS — 27 controls |
| `npm.cmd run check:ofp-core` | PASS — incl. 21 overfit controls, 0 approved migration statements |
| `npm.cmd run check:state-lineage` | PASS — 107 checks |
| `npm.cmd run check:frame-presence` | PASS — 63 checks |
| `npm.cmd run check:correction-boundary` | PASS — 47 checks |
| `npm.cmd run check:entity-ownership` | PASS — 52 checks |
| `npm.cmd run check:manual-browser` | PASS — real Chromium |
| `npm.cmd run check:browser-real` | PASS — real Chromium |
| `git diff --check` | clean |
| Working tree | clean after commit; no path under `projects/` or `data/` touched |

**Focused positive count: 496** = 154 + 73 + 107 + 63 + 47 + 52.

## 26. Known limitations

1. **`window.event` scoping.** Page script that installs its own capture
   listener, retains the trusted event, and shadows the accessor could present a
   stale dispatch. That is deliberate forgery from inside the product — the
   hostile-local-process case that is explicitly out of scope. The accessor is
   read through the prototype descriptor captured at install time, so an ordinary
   reassignment cannot fool it.
2. **The Node microtask regression is a consequence test, not a mechanism test.**
   Node has no `window`, so it passes even with the dispatch check removed. This
   is stated in the suite itself, and the mechanism is asserted in the harness,
   where a window exists.
3. **`useApprovedBaseAsShot` costs one extra click** (§9). A product decision,
   made deliberately, in the direction of the creator seeing what they approve.
4. **Legacy `approvedFile` remains readable on slots** by design (S6: no
   destructive removal). New writes never use it, normalization moves it, and a
   value found there is a supporting selection.
5. **The `assetId`-present rule is a runtime refusal.** A future caller that
   forgets the key fails loudly rather than silently; a source scan in
   `dogfood2-p0-architecture.js` also catches it at review time.

## 27. Confirmations

- **No paid provider calls.** Every dispatch boundary was observed at a local
  fetch double. `Provider calls made: 0` is printed by the suites that reach one.
- **No local-model calls.**
- **The preserved Dogfood project is unchanged.** No changed path is under
  `projects/` or `data/`; `git status` carries no project-data entry.
- **Canonical evidence unchanged.** No file under `docs/dogfood/` was modified;
  three were added (the map, the deferrals note, this handoff).
- **`main` untouched. Nothing merged.** The branch is pushed for independent
  Codex acceptance.

# CineBraid — Production Truth Simplification Map

**Branch:** `fix/dogfood2-production-truth-simplification`
**Baseline:** `4eb6521390051ce683e71587c678365747e93e60` (audited Batch 1D HEAD)
**Date:** 2026-08-14

This map is the inspection that precedes the implementation. It enumerates every
mechanism that currently participates in production truth and classifies it
KEEP / SIMPLIFY / RENAME / DELETE / HISTORIC-ONLY against the six-sentence alpha
model:

1. Human explicitly approves Canon.
2. Automation only recommends.
3. Supporting references are not Canon.
4. Legacy pointers without current Canon are Historic.
5. State ancestry is immutable after creation.
6. Preflight does not mutate.

---

## 0. The three product concepts, locked

| Concept | Means | Storage | Never means |
|---|---|---|---|
| **CANON** | A creator explicitly approved these exact bytes as production truth. | A current receipt in `project.productionAuthority` **plus** a live edge that matches it exactly (value and asset identity). | "a pointer exists", "a run finished", "a status says APPROVED" |
| **REFERENCE** | Useful selected supporting media. May guide generation/review. | `coverageSlots[]` / `expressionSlots[]` `selectedFile` (+ legacy `approvedFile` read-only), `status: selected` | Canon |
| **HISTORIC** | An old workflow selection/pointer with no current valid Canon authority. | Any live edge value with no current receipt behind it. | Canon |

`APPROVED` as a product word is reserved for the human Canon decision.
Workflow-internal completion words stay, but never render as production truth.

---

## 1. Canon writers

| Mechanism | Where | Disposition | Note |
|---|---|---|---|
| `beginManualApproval(details)` | `shared-production-authority.js:260` | **DELETE** | The general-purpose human capability. 12 shipped call sites, all target-only. |
| `beginManualAuthorityAction(details)` | `shared-authority-kernel.js:334` | **DELETE** | Mints a reusable token that outlives the gesture into arbitrary later code. |
| `MINTED_MANUAL_ACTIONS` map + `consumeManualAction` + `manualActionCovers` | `shared-authority-kernel.js:241,377,386` | **DELETE** | The capability registry has no purpose once commit is synchronous. |
| `commitAuthorityTransaction(project, request)` (exported, generic) | `shared-authority-kernel.js:762,1062` | **DELETE (privatize)** | Becomes private `commitCanon`. No caller may name an arbitrary target kind. |
| `commitNamedAuthority(project, request, kind)` | `shared-production-authority.js:426` | **DELETE** | Its whole job was stripping `eligibility`/`applyEdge` out of a generic request. |
| `writeFrameProductionAuthority` / `writeMotion…` / `writeDelivery…` / `writeEntityState…` | `shared-production-authority.js:434-445` | **RENAME + SIMPLIFY** | Become `approveFrameCanon` / `approveMotionCanon` / `approveDeliveryCanon` / `approveEntityStateCanon` in the kernel; thin explicit commands into one private path; **value required, asset identity required where the media type has one**; require a live trusted gesture at the moment of the call. |
| `writeAuthorityEdge(draft, target, details)` (installed) | `shared-production-authority.js:331` | **SIMPLIFY (move private)** | Moves into the kernel as a private function. No installer. |
| `revokeAuthorityTransaction` | `shared-authority-kernel.js:906` | **SIMPLIFY** | Keep, but clear the exact field for the *target kind*, never inferred from the new (empty) value. |
| `repairAuthorityValue` | `shared-authority-kernel.js:937` | **KEEP** | The rename follow-through. Becomes load-bearing: approve-then-rename is now the shipped order. |
| Raw pointer assignment (`s.winner = …`, `state.approvedFile = …`, `c.approvedMotionFile = …`) outside the kernel | `creation-studio.js:3402,3488-3490`, `library-tools.js:451`, `automation.js` | **HISTORIC-ONLY** | Bookkeeping/mirror pointers. They never establish Canon; the projection reports them Historic when no receipt stands behind them. |

### Replaceable installers (all exported, all overwritable after boot)

| Installer | Where | Disposition |
|---|---|---|
| `installAuthorityEdgeReader` | `shared-authority-kernel.js:579` | **DELETE** — edge reading becomes private and fixed. |
| `installAuthorityEdgeWriter` | `shared-authority-kernel.js:1021` | **DELETE** — edge writing becomes private and fixed. |
| `installAuthorityOwnershipPolicy` | `shared-authority-kernel.js:985` | **DELETE** — the kernel calls the ownership resolver module directly. |
| `installAuthorityProjectCommitter` | `shared-authority-kernel.js:682` | **DELETE** — persistence is the kernel's fixed in-place merge. |
| `installSlotOwnershipPolicy` | `shared-entity-slots.js:127` | **DELETE** — same optional-policy shape on the supporting path; becomes an intrinsic, non-optional check. |
| `useEntityOwnershipResolver(api)` | `shared-production-authority.js:492` | **DELETE** — a second way to replace the ownership answer. |

---

## 2. Canon readers

| Mechanism | Where | Disposition |
|---|---|---|
| `currentHumanAuthority(project, target)` | `shared-authority-kernel.js:604` | **KEEP + TIGHTEN** — receipt asset identity must be matched by the live edge (S5); a missing live identity fails closed. |
| `hasCurrentHumanAuthority` | kernel `:637` | **KEEP** |
| `historicSelection(project, target)` | kernel `:654` | **KEEP** — the Historic reader. |
| `authorityHistory` | kernel `:643` | **KEEP** |
| `liveAuthorityEdge` | kernel `:583` | **SIMPLIFY** — reads the private edge reader directly. |
| `readAuthorityEdge` (exported document-shape reader) | `shared-production-authority.js:194` | **DELETE (privatize)** — moves into the kernel. |
| `gateSatisfied` / `reconcileRunGates` / `applyGateReconciliation` / `resumeAuthority` / `runHasActionableGate` / `runHasRevokedAuthority` | `shared-production-authority.js:637-857` | **KEEP** — already ask the one Canon reader; S16 satisfied by construction once the reader is exact. |
| `edgesAreReceiptBacked` / `receiptBackedEdges` | `shared-production-media.js:497,500` | **SIMPLIFY** — become consumers of the shared projection rather than a second implementation of the same question. |
| Per-screen re-interpretation of `approvedFile` / `winner` / `humanApproved` | `app.js`, `entities.js`, `coverage-automation.js`, `bible.js` | **DELETE** — replaced by S9's single projection. |

---

## 3. Authority receipt storage

| Mechanism | Where | Disposition |
|---|---|---|
| `project.productionAuthority` `{ version, receipts[] }` | kernel `:127,128` | **KEEP** — durable, boring, single ledger. |
| Full receipt schema validation on every read (`validateReceiptShape`, `validateAuthorityLedger`) | kernel `:447,491` | **KEEP** — fails closed, does not repair. |
| Ledger version gate | kernel `:509-518` | **KEEP** |
| One-current-per-target rule | kernel `:546-550` | **KEEP** |
| Receipt fields `roles`/`users`/signatures/delegation | — | **absent, and stays absent** (S4). |
| `receipt.assetId` | kernel `:846` | **KEEP + make load-bearing** (S5). |

---

## 4. Human gesture handling

| Mechanism | Where | Disposition |
|---|---|---|
| `installBrowserManualActionSource(target, schedule)` | kernel `:288` | **SIMPLIFY** — install-once stays; the `schedule` seam and the `setTimeout(0)` close window go. The gesture is scoped to the **synchronous dispatch of the trusted event** by closing it on the way out of the capture listener, so no later microtask sees it open. |
| `TRUSTED_GESTURE` / `openTrustedGesture` / `closeTrustedGesture` | kernel `:254-271` | **SIMPLIFY** — private; closed synchronously after dispatch. |
| `trustedGestureOpen()` / `manualApprovalActive()` | kernel `:272`, authority `:264` | **KEEP** — read-only predicates a surface may use to enable a button. |
| Token minted → carried across `await` → spent later | 12 call sites | **DELETE** — replaced by "commit Canon synchronously in the click; do async work after". |
| Test harness scheduler that never closes the window | `tests/render-harness.js:622-637` | **DELETE** — no scheduler parameter to inject any more. |

---

## 5. Coverage / expression / reference writers

| Mechanism | Where | Disposition |
|---|---|---|
| `assignSlotReference(slot, request)` | `shared-entity-slots.js:131` | **KEEP + SIMPLIFY** — ownership becomes intrinsic and non-optional (currently skipped when `owner.project` is absent). Writes `selectedFile`. |
| `clearSlotReference` | `shared-entity-slots.js:176` | **KEEP** |
| `slot.approvedFile` as the stored field | everywhere (42 read sites) | **RENAME → `selectedFile`** — new writes use `selectedFile`; `approvedFile` is read as a legacy alias only, through one accessor. |
| `slot.status` vocabulary `missing|selected|retired` | `shared-entity-slots.js:62` | **KEEP** |
| `SLOT_SELECTION_DECISIONS` incl. legacy `approved-coverage`/`approved-expression` | `shared-entity-slots.js:217` | **KEEP as HISTORIC-ONLY** — legacy words readable, never written. |
| `writeCoverageProductionAuthority` / `writeExpressionProductionAuthority` | absent | **STAYS ABSENT** |
| `entity-coverage` / `entity-expression` arms in `readAuthorityEdge` | `shared-production-authority.js:243-250` | **DELETE** — dead: not authority target kinds. |

---

## 6. Library projections

| Mechanism | Where | Disposition |
|---|---|---|
| `entityApprovedReferenceCount(entity)` | `app.js:3127` | **DELETE** — counts `approvedFile` on entity, states **and both slot groups**, so a supporting selection produces an "approved" count. |
| `libraryCard(list, x, approvedOnly)` status/badge/copy | `app.js:3136-3156` | **SIMPLIFY** — reads the S9 projection; renders **CANON / REFERENCES / HISTORIC**, never `APPROVED` for a supporting selection. |
| Library `approved` tab + "media that currently define production truth" copy | `app.js:3170-3188` | **RENAME** — becomes the **Canon** tab, filtered on receipt-backed Canon only. |

---

## 7. Generation-reference projections

| Mechanism | Where | Disposition |
|---|---|---|
| `primaryReference(list, entity)` | `coverage-automation.js:33` | **SIMPLIFY** — must resolve **receipt-backed Canon**. A raw `entity.approvedFile` with no receipt is Historic and is not the identity input. |
| `coverageAuthorityReferences(...)` incl. `kind: "approved-view"` default | `coverage-automation.js:45-72` | **RENAME** — `coverageReferencePackage`, roles by purpose. |
| `submitCoverageJob` roles `identity-authority` / `approved-view`, label "primary approved authority", `authorityManifest` | `coverage-automation.js:154-196` | **RENAME** — `identity-canon` / `supporting-view` / `expression-reference` / `environment-reference`; `referenceManifest`. |
| Prompt copy "supplied approved authority package" / "DESIGN AUTHORITY" | `coverage-automation.js:145-150` | **RENAME** — purpose wording; no approval claim for unreceipted media. |
| `SLOT_REFERENCE_ROLE = "supporting-view"` | `shared-entity-slots.js:203` | **KEEP** — already purpose-named; becomes the single source. |

---

## 8. Normalization / load paths

| Mechanism | Where | Disposition |
|---|---|---|
| `normalizeProjectV5` ancestry handling | `app.js:930-937` | **KEEP** — 1D closed this; clears an invalid root parent, invents nothing. |
| `entityStateList(entity, includeDefault)` (read + create + migrate hybrid) | `app.js:2461` | **SIMPLIFY** — becomes an explicitly-named mutation (`initializeEntityStates`); `entityStateListRead` is the reader every informational path uses. |
| `entityStateById` → calls the mutating hybrid | `app.js:2495` | **SIMPLIFY** — reads. |
| No approvedFile→receipt migration anywhere | — | **KEEP ABSENT** (S18). |

---

## 9. OFP / export projections

| Mechanism | Where | Disposition |
|---|---|---|
| OFP contract / migration / serialization boundary | `lib/ofp/*` | **KEEP UNCHANGED** — independently PASS in the 1D audit (0 approved migration statements). Touch only if the renamed slot field requires a read alias. |

---

## 10. Delivery / video authority

| Mechanism | Where | Disposition |
|---|---|---|
| `shot-delivery` edge read → always `assetId: ""` | `shared-production-authority.js:219-224` | **SIMPLIFY** — persist and read `finalStillAssetId` / `approvedMotionAssetId`. |
| Delivery edge write decides still-vs-video from the value's extension | `shared-production-authority.js:374-381` | **SIMPLIFY** — the *target* carries the delivery form; an empty value (revocation) clears the field the target names. |
| Video revocation leaving `creationBrief.approvedMotionFile` | kernel `:906-932` + authority `:369-389` | **DELETE the inference** (S5B). |

---

## 11. Preflight / read paths

| Mechanism | Where | Disposition |
|---|---|---|
| `v627EntityPreflight` | `automation.js:1121` | **KEEP** — already pure. |
| `openAssetAutomationModal` → `entityStateList(entity, true)` | `automation.js:1151` | **SIMPLIFY** — pure read; reports "default state not initialized" instead of creating one. |
| `openEntityStateAutomationModal` → `entityStateById` (mutating) | `automation.js:1159` | **SIMPLIFY** |
| `openEntityChainAutomationModal` → `entityStateList` | `automation.js:1168` | **SIMPLIFY** |
| `v626ExpandStateDependencies` / `v626StateOrder` | `automation.js:1177,1196` | **SIMPLIFY** — planners read. |
| Correction preflight | `automation.js` | **KEEP** — PASS in the 1D audit. |

---

## 12. Lineage paths

| Mechanism | Where | Disposition |
|---|---|---|
| `LINEAGE_DELETION_POLICIES = ["refuse"]`, create-only ancestry, leaf-only deletion | `shared-state-lineage.js` | **KEEP UNCHANGED** (S13). |
| `reparentingUnsupported` | `shared-state-lineage.js:373-382` | **KEEP** — refusal-only; deleting it is optional and not a blocker. Re-examined at S17. |

---

## 13. `humanApproved` inventory (S10)

43 occurrences in shipped source. Classification target:

| Class | Meaning | Rule |
|---|---|---|
| WORKFLOW-ONLY | An automation run step's cached completion flag. | May exist. Written **only** beside a re-verified `authorityReceiptId`. Never read as provenance. |
| DISPLAY | A candidate row's "a person chose this" note. | May exist. Never read as Canon. |
| PROVENANCE (violation) | Anything that concludes Canon from the boolean. | **BUG — fix.** |

---

## 14. What the implementation deletes, in one list

```
beginManualApproval                  installAuthorityEdgeReader
beginManualAuthorityAction           installAuthorityEdgeWriter
manualActionCovers                   installAuthorityOwnershipPolicy
consumeManualAction                  installAuthorityProjectCommitter
MINTED_MANUAL_ACTIONS                installSlotOwnershipPolicy
commitAuthorityTransaction (public)  useEntityOwnershipResolver
commitNamedAuthority                 readAuthorityEdge (public)
writeAuthorityEdge (public)          entityApprovedReferenceCount
writeFrameProductionAuthority        (+ the render harness gesture scheduler)
writeMotionProductionAuthority
writeDeliveryProductionAuthority
writeEntityStateProductionAuthority
```

replaced by:

```
approveFrameCanon         canonFor / hasCanon / historicFor
approveMotionCanon        productionTruthFor  (one read-only projection)
approveDeliveryCanon      revokeFrameCanon / revokeMotionCanon /
approveEntityStateCanon   revokeDeliveryCanon / revokeEntityStateCanon
```

## 15. Where the six sentences become literally true

| Sentence | Made true by |
|---|---|
| 1. Human explicitly approves Canon. | The four `approve*Canon` commands are the only Canon writers, each requires a live trusted gesture **at the moment of the write**, and each requires the exact value and asset identity. No token survives an `await`. |
| 2. Automation only recommends. | Automation runs in continuations; no gesture is open; there is no token to hold. `automationRecommendation()` is the only thing it may write. |
| 3. Supporting references are not Canon. | Slots have their own field (`selectedFile`), their own vocabulary, no receipt, no Canon count, and their own Library section. |
| 4. Legacy pointers are Historic. | One projection derives Canon/Reference/Historic; every consumer reads it. A pointer with no receipt is Historic everywhere. |
| 5. State ancestry is immutable. | Unchanged from Batch 1D. |
| 6. Preflight does not mutate. | Informational surfaces call readers; initialization is a separately named mutation. |

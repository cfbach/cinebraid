# CineBraid Dogfood #2 — Production Truth Simplification Final Acceptance Audit

**Audit date:** 2026-08-15  
**Audited branch:** `fix/dogfood2-production-truth-simplification`  
**Audited HEAD:** `070321cc84b1b899beb3745966845bc94f028348`  
**Implementation commit:** `999cc9179e083192ec1ec1386bc9322b95db76ad`  
**Verified base:** `4eb6521390051ce683e71587c678365747e93e60`

## FINAL VERDICT

# HOLD — CONCRETE PRODUCT VIOLATION

The simplification pass is substantially smaller and safer than the architecture it replaced, but production truth is not yet singular. Four reproducible ordinary application paths violate the required alpha model:

1. filename-only Canon repair rewrites receipts belonging to unrelated targets;
2. entity UI, Bible/server output, assistant compaction, and generation references still promote raw legacy pointers, status words, or file presence to Approved/Canon semantics;
3. opening the continuity-state variant flow mutates stored production state; and
4. compatibility parent resolution operationally reparents a state whose recorded parent is missing.

These findings are not hostile-script, multi-user, cryptographic-provenance, or enterprise-policy concerns. They are reachable through shipped application code with realistic local project state.

No implementation fixes, project-data changes, merges, pushes, provider calls, credential use, or network calls were performed. The only audit write is this report.

## 1. Scope and method

The audit independently challenged the six required statements:

- Human explicitly approves Canon.
- Automation only recommends.
- Supporting references are not Canon.
- Legacy pointers are Historic.
- State ancestry is immutable.
- Preflight does not mutate.

Evidence came from:

- static source and repository-history inspection;
- the existing unit, integration, architecture, and negative-control suites;
- in-memory execution of the real authority kernel;
- the repository render harness with synthetic projects and local test doubles;
- project normalization and projection inspection; and
- local browser interaction without external services.

The mandatory post-green semantic sweep searched both literal legacy names and equivalent concepts: `approvedFile`, `approvedMotionFile`, winners, approved statuses and badges, cached approval booleans, supporting-reference promotion, direct Canon writes, authority installers, capability/token mechanisms, committer abstractions, parent fallbacks, and read/open paths that write state.

## 2. Repository receipt

| Check | Independent result |
|---|---|
| Repository | `C:\CineBraid\CineBraid-Source` |
| Branch | Exact: `fix/dogfood2-production-truth-simplification` |
| HEAD | Exact: `070321cc84b1b899beb3745966845bc94f028348` |
| Implementation | Exact: `999cc9179e083192ec1ec1386bc9322b95db76ad` |
| Base | Exact: `4eb6521390051ce683e71587c678365747e93e60`; verified ancestor |
| Remote relationship | Branch and origin were `0 0` |
| Handoff relationship | `999cc91..070321c` contains documentation/handoff changes only |
| Worktree before audit | Clean |
| Production data | Not opened or modified |
| Current `git diff --check` | Clean before this report |

The total base-to-implementation commit is 49 files, 4,134 insertions and 3,751 deletions because it includes four documents. The reported source/test scope is exactly 45 files, 2,979 insertions and 3,751 deletions: net **−772 lines**.

`git diff --check 4eb6521..999cc91` reports trailing whitespace only in the already-committed Batch 1D audit document's Markdown hard breaks. This is unrelated to production behavior and is not a blocker.

## 3. Test receipt and browser limitation

`npm.cmd run check` completed successfully:

```text
CineBraid full verification passed: 167 suites in 91.6s.
```

Focused evidence included:

| Area | Result |
|---|---:|
| Production Truth | 154 passing assertions |
| Dogfood architecture | 73 passing assertions |
| Dogfood P0 negative controls | 9/9 passing |
| State lineage | 107 passing assertions |
| Frame | 63 passing assertions |
| Ownership | 52 passing assertions |
| Correction | 47 passing assertions |
| Production media | 27 negative controls |
| OFP approved-migration statements | 0 |
| Real provider calls | 0 |

The Python real-browser suites printed skip results because the full runner could not locate Python. When invoked with the installed system Python, the browser runtime reported that Playwright was not installed. The bundled Python likewise lacked Playwright.

A local Chromium fallback loaded the real kernel and exercised its event boundary. Browser automation events had `isTrusted: false`; synchronous and microtask Canon attempts were both refused. This independently confirms synthetic-event refusal but cannot prove trusted-human-click success or reproduce the reported trusted-click/microtask behavior. The missing trusted-event run is a coverage limitation, not the basis of this HOLD.

## 4. Implementation-claim verification

| Reported claim | Audit result |
|---|---|
| Replaceable installers: 5 → 0 | **Verified for authority policy/read/write/ownership/committer seams.** `installBrowserManualActionSource` remains as a fixed, install-once trusted-gesture source rather than a replaceable authority provider. |
| Human-capability functions: 5 → 0 | **Verified.** No shipped capability/token mechanism or renamed equivalent was found. |
| `beginManualApproval` call sites: 12 → 0 | **Verified.** Only non-executable historical/commentary references remain. |
| Independent “is approved?” readers: 3 → 1 | **Disproved.** Entity UI, Bible/server, assistant, and generation paths independently promote raw legacy fields or file presence. |
| Negative controls: 27 → 9 | **Verified narrowly.** The Dogfood P0 suite contains nine controls; the separate production-media suite contains 27. The nine do not cover the counterexamples in this report. |
| Net source change: −772 lines | **Verified** across the claimed 45 source/test files. |
| Full suite: 167 suites PASS | **Verified**, subject to the real-browser skips described above. |

## 5. Six-statement falsification matrix

| Required production truth | Result |
|---|---|
| Human explicitly approves Canon | **FAIL.** Global repair can retarget an unrelated receipt without a gesture, while raw UI/server paths present unreceipted data as approved. |
| Automation only recommends | **FAIL at the truth-consumption boundary.** Automation does not mint a receipt, but it consumes an unreceipted Historic parent as an “approved reference” base. |
| Supporting references are not Canon | **FAIL.** Bible fallback can include owned/supporting media using status or file presence and present it as approved. |
| Legacy pointers are Historic | **FAIL.** Entity UI, Bible, assistant output, and generation references still promote raw legacy pointers. |
| State ancestry is immutable | **FAIL operationally for damaged/legacy state.** Parent fallback substitutes the default state for a missing recorded parent. Direct reassignment on valid graphs was removed and valid lineage tests pass. |
| Preflight does not mutate | **FAIL for the required ordinary flow.** The narrow `v627EntityPreflight` function is pure, but opening the continuity-state variant flow writes `generationMode`. |

## 6. MB-PT-01 — filename-only Canon repair corrupts an unrelated target

### Exact path

- `public/shared-authority-kernel.js:1197` — `repairCanonValue(project, { from, to, assetId })`
- `public/library-tools.js:419` — ordinary shot-take rename caller
- `public/library-tools.js:687` — ordinary entity-media rename caller

The repair helper walks all authority receipts and changes every receipt for which `receipt.value === from`. Selection does not include the Canon target, the prior asset identity, or whether the receipt is the target's current live receipt.

### Reproduction

Using the real kernel and its real test gesture helper:

1. Shot A and Shot B each independently approved `FRAME.png`.
2. Their approvals had different Canon targets and different asset IDs (`asset-A` and `asset-B`).
3. Shot A's edge was changed by the ordinary rename model to `RENAMED.png` / `asset-A2`.
4. The shipped repair helper was invoked with `FRAME.png`, `RENAMED.png`, and `asset-A2`.
5. It reported both receipt IDs repaired and changed both receipts to `RENAMED.png` / `asset-A2`.
6. Shot A remained Canon; Shot B failed Canon projection and its unchanged live edge became Historic.

Observed result:

```text
repaired ["authority-000001","authority-000002"]
receipt A -> RENAMED.png / asset-A2
receipt B -> RENAMED.png / asset-A2
canon A -> true
canon B -> false
historic B -> FRAME.png / asset-B / no-human-receipt
```

Identical basenames in separate per-shot take directories are ordinary product data. This helper also changes durable approval history rather than limiting repair to the live receipt.

### Violated sentence

**Human explicitly approves Canon.** The application retargeted Shot B's receipt even though the human acted only on Shot A.

It also violates the required exact target + value + asset identity binding and changes what should be Historic evidence.

### Expected behavior

Only Shot A's exact current receipt may follow Shot A's renamed bytes. Shot B and all unrelated/historical receipts must remain unchanged.

### Smallest conceptual correction

Scope repair to the exact Canon target and expected prior asset identity. Pass the target from the approving UI. Never select approval receipts globally by basename.

## 7. MB-PT-02 — raw legacy pointers remain a second production-truth system

The receipt-backed projection is not the sole reader. Shipped UI, server, assistant, and generation paths still create Approved/Canon semantics from raw pointers, statuses, or file presence.

### 7.1 Entity UI path

Exact paths:

- `public/entities.js:652-662` — current approved hero/rail reads raw `approvedFile`
- `public/entities.js:1210-1229` — authority summary counts raw `approvedFile` and renders `APPROVED`
- `public/entities.js:1328` — overall workflow renders another `APPROVED` state

Reproduction:

1. A prop `PR-TOOL` was constructed with raw `approvedFile: "PR-TOOL-PLATE.png"`.
2. Its `productionAuthority` ledger was removed.
3. `entityProductionTruth(project, "props", "PR-TOOL")` returned `canonCount: 0` and classified the plate as Historic.
4. The ordinary `#/prop/PR-TOOL` page was rendered through the repository harness.
5. The page nevertheless displayed `APPROVED IMAGES`, `1/1 state has an approved image`, an `APPROVED` row, an `APPROVED` workflow state, and the raw file.

Expected behavior: the page may show the pointer as Historic, but it may not count, badge, or headline it as approved.

### 7.2 Generation-reference and automation path

Exact paths:

- `public/creation-studio.js:319-324` — raw parent media selection
- `public/fal-generation.js:229-237` — labels parent media `approved reference` with role `base`
- `public/automation.js:2434` and `public/automation.js:2465` — consumes raw parent media in automation/generation construction

Reproduction:

1. A default prop state contained a raw approved pointer but no receipt ledger.
2. A child state derived from the default state.
3. Production-truth projection returned zero Canon and the default plate as Historic.
4. `entityGenerationReferences("props", entity, { state: child, mode: "derive" })` returned:

```text
key        state-parent:props:PR-TOOL:state-default
label      Default approved reference
role       base
sourceFile PR-TOOL-PLATE.png
```

Automation does not establish a new Canon receipt, but it treats an unreceipted Historic pointer as an approved authoritative generation base.

Expected behavior: an unreceipted parent may be supplied only as explicitly Historic/supporting context. It cannot be named or ranked as an approved base.

### 7.3 Bible/server and assistant path

Exact paths:

- `server.js:7639-7724` — `/api/bible` construction
- `server.js:7642` — entity inclusion from raw `status === "APPROVED"`
- `server.js:7659` — falls back to all owned entity media when no raw approved pointer exists
- `server.js:7723-7724` — falls back to `locked[0]` based on file presence
- `public/bible.js:66` — labels the selected winner `APPROVED` and other items `Approved output`
- `server.js:1669` and `server.js:1681` — project-assistant compact uses winner presence as `approved`

This is an ordinary static server route: the Bible describes itself as containing only approved/locked Canon but can select from raw status, raw winner pointers, all entity media, or the first locked file. A supporting file can therefore enter a supposedly approved Bible without a receipt.

Expected behavior: Bible inclusion, approved badges, and assistant approval flags must derive from the receipt-backed production-truth projection. Mere file presence, a raw status word, or a legacy winner is insufficient.

### Violated sentences

- **Automation only recommends.** Automation consumes Historic material as an approved base.
- **Supporting references are not Canon.** Bible fallback can promote supporting media.
- **Legacy pointers are Historic.** Multiple shipped consumers promote them to Approved semantics.

### Smallest conceptual correction

Make entity UI, Bible/server output, assistant compaction, and generation-parent classification consume the existing current-receipt/production-truth projection. Preserve raw pointers only as Historic or supporting context. Delete `locked[0]`, raw-status, and file-presence promotion paths.

## 8. MB-PT-03 — opening a state-variant flow mutates production state

### Exact path

`public/entities.js:338-350`, in `openContinuityStateVariant()`:

```js
if (state.generationMode !== "derive") {
  state.generationMode = "derive";
  changed = true;
}
if (changed) dirty();
```

### Reproduction

1. A valid prop child state was stored with `generationMode: "independent"`.
2. The synthetic project was serialized.
3. The ordinary `openContinuityStateVariant(...)` path was called through the render harness.
4. The state changed to `generationMode: "derive"` and the serialized project changed.

Observed result:

```text
beforeMode     independent
afterMode      derive
projectMutated true
```

### Violated sentence

**Preflight does not mutate.** The specific `v627EntityPreflight` function remained pure, but the acceptance requirement covers opening automation, modal, read, and check paths. The ordinary opener writes project state before an explicit production action.

### Expected behavior

Opening or inspecting the flow changes only transient UI state. Production project data remains byte-identical until the user performs an explicit edit or generation action.

### Smallest conceptual correction

Remove the project write from the opener. Change `generationMode` only through an explicit edit/start action.

## 9. MB-PT-04 — compatibility parent fallback hides broken lineage

### Exact path

- `public/creation-studio.js:307-313` — `assetStateParent` resolves the declared parent, then default, then any other state
- `public/entities.js:328-336` — equivalent fallback
- `public/automation.js:1122+` — preflight consumes the fallback resolver

### Reproduction

1. The default state was `state-default`.
2. A child was stored with immutable `parentStateId: "ghost"`.
3. `validateStateCollection()` correctly reported `parent-missing`.
4. `assetStateParent()` nevertheless returned `state-default`.
5. `v627EntityPreflight()` did not report invalid lineage; its only error was that the local FAL generation provider was disabled.

Observed result:

```text
storedParent     ghost
resolvedParent   state-default
integrity        ["parent-missing"]
preflightErrors  ["FAL GPT Image 2 generation is not enabled."]
```

With a safely enabled provider test double, the chain can proceed against the default state despite the durable record naming `ghost`. This is realistic damaged or legacy alpha project state: normalization deliberately preserves the bad pointer and warns rather than repairing it.

### Violated sentence

**State ancestry is immutable.** Direct reparenting mutation is gone for valid graphs, but operational reads silently substitute a different parent for broken ancestry.

### Expected behavior

An existing state resolves only its recorded parent. A missing parent returns no parent, its integrity error blocks generation, and no default/other-state fallback hides the break.

### Smallest conceptual correction

Use exact parent resolution for existing states and fail closed on missing ancestry. Selecting a default parent may remain an explicit rule only while creating a new state.

## 10. What passed

The HOLD should not obscure genuine closure work:

- The generalized capability/token architecture is removed rather than renamed.
- There are no replaceable authority writer, reader, ownership, policy, or committer installers.
- The browser trusted-action source is fixed and install-once.
- Canon writes are private and concentrated behind four named approval commands, four revocation commands, and repair.
- The trusted-gesture source requires both a stored trusted event and the current native `window.event` to be the same object; there is no await-spanning approval token.
- Receipt-backed current authority fails closed when its asset identity is missing or differs from the live asset.
- Delivery identity and revocation paths passed their focused tests and source inspection.
- `markGuidedStillFinal` routes frame and delivery truth through the kernel rather than creating a receiptless winner.
- The stale `APPROVED BY YOU` reader was corrected to use `entityProductionTruth`.
- Import and normalization paths did not recreate migrated approval receipts; the OFP sweep found zero approved migration statements.
- Supporting Library/Generated paths inspected in the repaired projection correctly classify unreceipted pointers as Historic.
- `useApprovedBaseAsShot` waits for the copied asset, selects the new candidate, and then opens the ordinary approval modal; it does not carry Canon authority across the await.
- The narrow `v627EntityPreflight` and normal automation-modal preflight are pure.

## 11. SIMPLIFICATION VERDICT

### What complexity was genuinely removed?

- Generalized human-capability and token machinery.
- Replaceable authority providers and transaction/committer abstractions.
- Public `beginManualApproval` flows and their twelve call sites.
- Multiple indirect Canon mutation paths.
- A net 772 lines from the claimed source/test scope.

The resulting write kernel is materially smaller than Batch 1D.

### What obsolete machinery survives?

#### Merge blockers

- Global basename-based authority repair.
- Raw `approvedFile`, raw winner, raw status, and file-presence approval readers.
- Bible `locked[0]` promotion.
- Generation code that labels Historic parent media as an approved base.
- State-parent compatibility fallback.
- The open-flow `generationMode` mutation.

#### Recommended simplifications before alpha

- Delete or rename authority-like workflow `APPROVED` states that are not receipt-backed Canon.
- Route every entity, Bible, assistant, and generation consumer through the same production-truth projection.
- Remove obsolete raw-pointer approval readers after migration to the projection.

#### Optional cleanup

- Remove stale comments and historical wording that describe deleted capability machinery.
- Clean the pre-existing Markdown trailing whitespace noted by the range check.

These optional items are not reasons for HOLD.

### Are there duplicate representations of production truth?

Yes. The authority ledger and `entityProductionTruth` are authoritative in the kernel and selected Library/Generated views, while entity UI, Bible/server, assistant output, and generation construction still treat raw pointers and status words as a parallel truth system.

### Did the pass centralize rules or move guards around?

It genuinely centralized Canon writes. It did not centralize all Canon readers. Several consumers still route around the projection, so production truth remains duplicated despite the smaller kernel.

### Can a future maintainer explain it in a few sentences?

Not yet. The intended explanation is clear:

> Human explicitly approves Canon. Automation only recommends. Supporting references are not Canon. Legacy pointers are Historic. State ancestry is immutable. Preflight does not mutate.

The current implementation additionally requires a maintainer to know which screens, server routes, and generation paths still interpret raw fields as approved, plus when missing ancestry falls back. Those exceptions are precisely why the simplification is not accepted.

## FINAL ACCEPTANCE DECISION

# HOLD — CONCRETE PRODUCT VIOLATION

# CineBraid — P4-SEM-C2: approval disposition and durable approval identity

**Status: IMPLEMENTED.** This record states the contract that shipped, the dogfood evidence that shaped it, and the boundary it deliberately did not cross.

| | |
|---|---|
| Baseline SHA | `24da965` (`main`, working tree clean apart from the untracked dogfood report) |
| Application version | `6.7.0-private.1` |
| OFP contract revision | `1.0-draft.1` — **unchanged** |
| Predecessor | P4-SEM-C1, PR #61, `509044c` — MediaAsset identity activation |
| Primary evidence | `docs/dogfood/CINEBRAID_DOGFOOD_PASS_1_CHIMBLEY_SWEEP_2026-08-12.md` §4.3, §7.1, §7.2, §7.3 |

---

## 1. Where the C2 contract came from

There is no standalone "C2 reconnaissance" document, and this is worth recording because the next reader will look for one. The C2 boundary was written by C1, in three places:

- `media-asset-service.js:59-62` — *"It does not touch approval pointers, candidate rows, job records or any filename semantics; carrying assetId into those is P4-SEM-C2."*
- `tests/media-asset-activation.js:756-761` — *"the IDENTITY survived the rename, and the legacy link did not… inventing the link is what C2 will do properly, by carrying the assetId rather than by matching a string."*
- `CINEBRAID_OFP_P4_SEMANTIC_RECONCILIATION_2026-08-10.md` §7 — *"approvals must point at `assetId`, and the ledger must become the authority for location while remaining an authority for nothing else."*

That is the identity half. The dogfood supplied the other half.

---

## 2. What the dogfood changed, and what it did not

### 2.1 It confirmed a defect, and the mechanism was exact

Dogfood Pass #1 §7.2 reported an approved London Rooftops source that coverage automation resolved and the manual "Choose & approve" surface did not show. Traced to source, the report is accurate and the cause is a two-reader disagreement over one field:

| Reader | Reads | Does |
|---|---|---|
| `public/coverage-automation.js:32` `coverageAuthorityReferences()` | `approvedFile` | **includes** it, ranking the primary at score 1000 |
| `public/entities.js:1030-1031` (pre-C2) | the same `approvedFile` | **excludes** it — from the active list *and* from the rejected list |

The approved image did not lose a badge. It left the surface, and the creator could no longer reach the most important image in the workflow. The dogfood's own diagnosis — *"the authority existed; the manual candidate reader filtered it out"* — is correct.

### 2.2 It sharpened the contract without changing its boundary

C2's boundary was already right. The sharpening is one sentence: **C2 must deliver a resolvable semantic answer, not only a stable key.** Swapping filename for assetId inside the same boolean `has()` test at `entities.js:1031` would have left the approved image just as invisible, keyed differently. Identity and disposition are the same change seen from two ends — because two records name the same asset, a reader can ask what that media *is* and get an answer that survives a rename.

### 2.3 It exposed an edge nobody had named

`public/library-tools.js:539-543` repaired four things after the approval rename — continuity states, `entity.approvedFile`, the candidate row, `generatedCandidates[]` — and never `coverageSlots[]` or `expressionSlots[]`. Renaming a file that a coverage slot already approved left that slot pointing at a filename that no longer existed. This is the *"any edge it does not know about is silently broken"* case from reconciliation §7, still live at `24da965`. It is fixed here by enumerating edges rather than remembering them.

### 2.4 One dogfood finding's inferred cause is corrected

§14.3 — *"Review all with AI"* reporting no blocking attempts while three were visible — is a real reader mismatch and **is not an identity or approval problem.** `public/automation.js:613-615` partitions by frame:

```js
return blockingMediaRows(shot).filter(({ link }) =>
  target ? String(link.blockingFrameId || "") === target : !String(link.blockingFrameId || ""));
```

The default `frameId = ""` returns only *un-framed* attempts, so per-frame attempts are invisible to the un-framed batch review while the cards render all of them. **Not C2.** It belongs to the production-state honesty batch.

---

## 3. The contract that shipped

### 3.1 Disposition

`public/shared-media-disposition.js` owns one question: what is this piece of entity media?

```
approved    the item is the approved file of at least one approval target
rejected    not approved, and its candidate row says decision === "rejected"
candidate   everything else
```

**Approved outranks rejected**, inherited rather than invented: the pre-C2 reader excluded approved names from the rejected list too, so a rejected candidate later approved already read as approved. Re-deriving it would have changed live behaviour under cover of a refactor.

An approved item also carries `targets[]` — *what* it is authority for. `role` alone would reproduce the flat boolean the module exists to replace: approved is a relationship between an image and a target, not a property of an image, and one image may be authority for several.

**No UI wording.** The roles are tokens; the browser decides how to say them. **Nothing is mutated by a read** — the module never calls `entityStateList()`, which normalises the entity it is handed.

Two surfaces consume it, and they were the two the dogfood named:

- **§7.2, the "Choose & approve" grid.** The approved authority is returned by the partition and rendered, carrying `data-media-role`, `data-approved-for` and `data-asset-id`.
- **§7.1, the coverage/expression dropdown.** Each option carries `data-media-role` and, when approved, names *everything* it is already authority for — e.g. `LOC-HULL-A.png — approved · Moonlit night · Master establishing`. A creator replacing it can see that they are replacing two canon decisions, not picking a file.

### 3.2 Identity

Approval edges record the MediaAsset ledger's id alongside the filename:

| Record | Field |
|---|---|
| continuity state, coverage slot, expression slot, entity primary | `approvedAssetId` |
| entity candidate row | `assetId` |

The naming is deliberate. `P.mediaAssets[]` is the **project media library**, an older and different thing whose rows the shot surfaces already pass around as `assetId`; `approvedAssetId` cannot be mistaken for it.

**Identity is additive and optional.** `approvedFile` stays and keeps meaning what it meant. A project whose ledger has never run carries no `approvedAssetId` and resolves exactly as before — absence is legal, which is why `resolveApprovalMedia()` prefers identity and *falls back* to the filename rather than requiring it.

### 3.3 How identity reaches the browser

`MediaAssetService.identityIndex()` — a read-only projection, path → assetId, for live rows only. C1 made the service the single production importer of the ledger and pinned the count at one; server.js routes through it rather than reading the ledger a second time. `tests/media-asset-activation-boundary.js` was widened from two entry points to three, deliberately, with the argument recorded in the test itself.

The projection cannot throw into a response, skips rows marked `storage.missing`, and reads no media bytes — so it cannot hydrate a cloud-synced corpus, which is the constraint that shapes every read in that module.

`POST /api/media/rename` now returns the assetId it already anchored. It had proven the two filenames name the same media — by hashing the file before moving it, the only moment that can be proven — and kept the result to itself.

---

## 4. What C2 deliberately did not do

- **No OFP change.** `ASSET.storage` remains §18 Q2, unsettled and not needed here.
- **No shot, frame or job records.** C1 named three targets for C2; this batch takes the entity-reference path, where every piece of dogfood evidence lives. Shot-side edges (`keyframes[].winner`, `clips[].videoWinner`, `P.mediaAssets[]` links) are **C3**.
- **No UX redesign.** The approved authority is rendered with the existing card component; the one new CSS block is built from vocabulary already on the page (the rejected block's frame, the section header's type scale, the green the state reference already uses for "approved"). Whether approval should ultimately read as a pin, a chip or a section is the shot-workspace UX batch's call — C2 owes the surface the *information*, not the design.
- **No Media Inspector, no Generated Media browser.** Both are named in the dogfood (§8, §35) and both are the UX batch.
- **No new taxonomy** — no subject-kind, no B-roll record, no shot-purpose or style vocabulary.
- **No score-to-canon behaviour.** AI recommendation and human approval remain separate facts; an approved card offers inspection, never a one-click un-canon.

---

## 5. Invariants held

| Invariant | How |
|---|---|
| Human approval is canon authority | Identity is stamped only inside an explicit approval or the rename it performs. Never on load, never by a render. |
| AI recommendation ≠ human approval | Untouched. The disposition contract has no reviewer input and no score. |
| Candidate / approved / rejected not conflated | One role per item, from one resolver, with the precedence stated and tested. |
| Approval makes media *more* reachable | The approved authority is returned by the partition and rendered on the selector it used to vanish from. |
| A selector must carry enough semantics to distinguish | `data-media-role`, plus `targets[]` naming what the image is authority for. |
| Opening a project writes nothing | NC-F reintroduces a read that stamps identity and the compatibility guard fails. |
| No silent provider substitution / no paid work from navigation | No generation path touched. |

---

## 6. Evidence

| Suite | Result |
|---|---|
| `npm run check:media-disposition` | contract · repair · surfaces · compatibility · projection |
| `npm run check:media-disposition-negative` | 7/7 reintroduced defects detected, each with a probe receipt |
| `npm run check:mediaasset-core` | full composite, including the widened activation boundary |
| `npm run check:behavior`, `check:render` | pass |

The surface claim is asserted against the **rendered DOM** on the card (`data-candidate-file`), not against a helper the suite could reimplement, and not against a bare filename substring — the entity header prints the approved filename too, so a substring match would still pass with the image missing from the selector. That is precisely the state being guarded against.

---

## 7. Recommended next step

**C3** — the same contract extended to shot-side media edges, where filename identity has the same failure mode and no coverage yet.

Two things C3 should know. `P.mediaAssets[]` and the MediaAsset ledger wear one name and are different things; C1 already fixed two false-linkage defects caused by that collision. And the shot dialect's candidate vocabulary is deliberately *not* normalised into the entity dialect (`media-assets.js:244`) — C3 must extend the resolver, not merge the two vocabularies.

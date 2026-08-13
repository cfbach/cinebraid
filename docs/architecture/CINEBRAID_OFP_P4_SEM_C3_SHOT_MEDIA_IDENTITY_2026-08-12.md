# CineBraid — P4-SEM-C3: durable identity for shot-side media edges

**Status: IMPLEMENTED.** This record states the contract that shipped, the recon that shaped its boundary, and two corrections to the scope C2's closeout predicted.

| | |
|---|---|
| Baseline SHA | `df11a81` (`main` == `origin/main`, working tree clean, `check:quick` EXIT=0 / 92 suites) |
| Application version | `6.7.0-private.1` |
| OFP contract revision | `1.0-draft.1` — **unchanged** |
| Predecessor | P4-SEM-C2, PR #62, `13273a1` — media disposition and approval identity |

---

## 1. Where the C3 contract came from

There is still no standalone reconnaissance document, and that is now the established pattern rather than an oversight: each C-batch writes its successor's contract into its own closeout. C3's came from `CINEBRAID_OFP_P4_SEM_C2_DISPOSITION_2026-08-12.md` §4 and §7 — *"the same contract extended to shot-side media edges"*, with one binding constraint: **"C3 must extend the resolver, not merge the two vocabularies."**

---

## 2. What the recon found, including two corrections

### 2.1 The live defect

There are exactly **two** callers of `POST /api/media/rename`. C2 fixed the entity one. The shot one — `public/library-tools.js` — called `renameCandidateRecord()`, which moves the candidate row's `stored`, retargets `selectedCandidate`, and updates a UI Set.

**It repaired no winner edge at all.** Approving a take under a new filename could leave `s.winner`, another frame's `winner`, a clip's `videoWinner`/`winnerEnd`, or `canonicalName` naming a file that was no longer on disk. This is the same class as the coverage-slot miss C2 closed, and it was wider.

### 2.2 Correction 1 — the predicted list was over-inclusive

C2's closeout named `P.mediaAssets[]` links as a C3 target. **Source says otherwise.** Blocking and other library links are already keyed by the library row's own `asset.id`, with a filename fallback (`public/automation.js:1339`), and **no writer renames a library row's file**. They do not have this failure mode. Linking that library to the MediaAsset ledger is a real but larger question that belongs with the Generated Media work, not here.

A visible consequence: `activeBlockingAssetId`, `blockingRevisionSourceAssetId` and `automationBlockingAssetId` are pre-existing fields seeded by `ensureShotCreation()` and are **outside C3**. A test asserting "no field matching `/AssetId/` is written by a read" would fail on them, which is why the compatibility guard names the three C3 fields explicitly.

### 2.3 Correction 2 — and under-inclusive

The predicted list named `keyframes[].winner` and `clips[].videoWinner` and stopped. Recon found four more of the same class: **`s.winner`**, **`clips[].winner`**, **`clips[].winnerEnd`**, and the two derived copies **`s.canonicalName`** and **`creationBrief.approvedMotionFile`**.

### 2.4 Writers and readers

Four writers of a shot winner, none identity-aware before C3: `library-tools.js` (human approval), `automation.js` (`v626ApproveFrame`), `review-provenance.js` (`promoteFinishJob`), `creation-studio.js` (still delivery, motion approval, plate copy). Readers resolved by pure string match in `public/app.js` (`anyWinnerTake`, `takeBadges`).

**The browser already received shot identity.** C2's `listMedia` change covered `scanProject()`'s shot directories too, so `SCAN.shots[id].takes[].assetId` was already populated. C3 needed **no server change**.

---

## 3. The contract that shipped

### 3.1 Extended, not merged

`public/shared-media-disposition.js` gains a shot section. **Shared:** the role vocabulary (`approved` / `candidate` / `rejected`), the identity rules, and `resolveApprovalMedia()` reused verbatim. **Not shared:** which fields carry an approval — which is exactly what differs between an entity and a shot. The shot *decision* vocabulary is never routed through an entity normaliser or vice versa, per `media-assets.js:244`.

`shotApprovalEdges(shot)` enumerates all six edge kinds — `shot`, `frame`, `motion`, `clip-first`, `clip-last`, plus the two derived copies handled by the repair. Enumeration rather than recollection is the whole point: a repair that walks this list cannot have the bug that motivated the batch.

### 3.2 Identity

The id sits beside the field it identifies, mechanically: `winner → winnerAssetId`, `videoWinner → videoWinnerAssetId`, `winnerEnd → winnerEndAssetId`. Per-field rather than one id per record, because a single clip carries three separate approvals and one id could describe only one of them.

**Additive and optional.** Filenames stay and keep their meaning; resolution prefers identity and falls back to the filename. Absence is legal and is the state of every pre-C3 project. A malformed value is refused rather than stored, and identity is cleared when its edge is cleared so a stale id cannot silently re-resolve.

### 3.3 What `winner` does and does not mean

`winner` means *this edge points at that media*. It does **not** mean the media was creatively correct. Dogfood Pass #1 produced a good video from a Frame A that violated its own shot requirement, and nothing in C3 would have caught that. **Frame-intent validation is a different layer and is deliberately absent.** C3 only guarantees the system can say *which* media an authoritative edge refers to.

The distinctions between AI recommended, human approved, winner, candidate, rejected and generated history are preserved, not collapsed. Automation records identity on the same terms as a human writer — so downstream readers need not know which produced an edge — but that does **not** make automation an approving actor: the run still reaches a human gate and a score still never becomes canon.

---

## 4. Files changed

| File | Change |
|---|---|
| `public/shared-media-disposition.js` | the shot section: edges, disposition, partition, stamp/clear, repair, derived staleness |
| `public/library-tools.js` | shot approval repairs **all** edges on rename and records identity |
| `public/automation.js` | `v626ApproveFrame` records identity |
| `public/review-provenance.js` | `promoteFinishJob` records identity |
| `public/creation-studio.js` | still delivery, motion approval and plate copy record identity; reopening an approval clears it |
| `public/app.js` | `anyWinnerTake` and `takeBadges` resolve identity-first, order and wording unchanged |
| `tests/shot-media-identity.js`, `…-negative-controls.js` | new suites |
| `package.json`, `tests/run-full-check.js`, `tests/current-behavior.js` | registration |

---

## 5. Compatibility

| Case | Behaviour |
|---|---|
| Pre-C3 project (no ids anywhere) | Resolves by filename exactly as before. Nothing is written by a read. |
| Post-C2 project (ledger knows the files, document does not) | Renders unchanged; identity is written only by an explicit approval. |
| Unanchored rename (no ledger yet) | Filenames still repaired; no identity invented. |
| Malformed id | Refused, so the filename fallback still applies. |
| Out-of-band rename of an identified winner | Resolves through identity; the edge survives. |

---

## 6. Tests

```
npm run check:shot-media-identity
npm run check:shot-media-identity-negative     7/7 controls, each with a probe receipt
npm run check:quick
```

Controls: the rename repairing no winner edge (the pre-C3 behaviour); an edge kind dropped from the enumeration; identity ignored in favour of string matching; a non-id stored as one; identity surviving the clearing of its edge; a read writing identity into the document; a stale rejection outranking a live approval.

---

## 7. Dogfood mapping

- **§7.3** blocking recommendation vs human approval vs active authority — *semantically enabled*, presentation is the UX batch.
- **§3.2 / §30** Frame A/B endpoint authority — *which media* is now durable; whether Frame A was right is **not** C3.
- **§35** Generated Media / Results — shot provenance now resolvable; UX deferred.
- **§14.3** "Review all with AI" — **stays out**, per the C2 correction. Its cause is `blockingFrameId` partitioning in `automation.js:613-615`; no fresh evidence of a separate identity issue.

---

## 8. What remains for C4

- `P.mediaAssets[]` ↔ MediaAsset ledger linkage (§2.2), most naturally alongside the Generated Media surface.
- Job records — C1 named approval pointers, candidate rows and **job records**; the first two are now done and job records remain.
- Partial writers: identity is recorded by the four shot approval funnels above. Any writer added later must stamp, or its edge is filename-only — legal by contract, but a gap in coverage rather than a designed absence.

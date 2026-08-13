# CineBraid — P4-SEM-C4: durable identity for generation job records

**Status: IMPLEMENTED.** This record states the contract that shipped, the recon that fixed its boundary, and — importantly — why only **one** of the two items C3 named for C4 belongs to C4 at all.

| | |
|---|---|
| Baseline SHA | `b8fa3d3` (`main` == `origin/main`, working tree clean, `check:quick` EXIT=0 / 94 suites, C2 7/7, C3 7/7) |
| Application version | `6.7.0-private.1` — **unchanged** |
| OFP contract revision | `1.0-draft.1` — **unchanged** |
| Predecessor | P4-SEM-C3, PR #63, `3851577` — shot-side media identity |

---

## 1. Where the C4 contract came from

The established pattern holds: each C-batch writes its successor's contract into its own closeout, and there is still no standalone reconnaissance document. C4's boundary comes from **`CINEBRAID_OFP_P4_SEM_C3_SHOT_MEDIA_IDENTITY_2026-08-12.md` §8**, which named two remaining items and one caveat:

1. `P.mediaAssets[]` ↔ MediaAsset ledger linkage, *"most naturally alongside the Generated Media surface"*.
2. **Job records** — *"C1 named approval pointers, candidate rows and job records; the first two are now done and job records remain."*
3. (Caveat, not an item.) Partial writers: any shot approval writer added later must stamp identity or its edge is filename-only.

The root mandate is C1's, at `media-asset-service.js:59-62`: *"It does not touch approval pointers, candidate rows, job records or any filename semantics; carrying assetId into those is P4-SEM-C2."* C2 took the entity approval pointers and candidate rows. C3 took the shot-side ones. **Job records are the last of the three.**

---

## 2. Correction to the predicted scope: item 1 is not C4

C3's §8 lists item 1 under "What remains for C4". The **body of that same record**, its **commit message**, and the **source comment C3 shipped** all say something more specific, and they agree with each other:

- `shared-media-disposition.js:444-450` — *"`P.mediaAssets[]` IS NOT HERE, deliberately… linking that library to the MediaAsset ledger is a larger question that belongs with the Generated Media work rather than here."*
- C3 commit `3851577` — *"Linking that library to the MediaAsset ledger is a larger question and **belongs with the Generated Media work**."*
- C3 §2.2 — library links *"are already keyed by the library row's own `asset.id`, with a filename fallback… and **no writer renames a library row's file**. They do not have this failure mode."*

§8 enumerates what remains; the body rules on **where it lands**. The more specific and more recent statement wins, and it points out of P4: Generated Media is explicitly the UX batch (C2 §4, dogfood §35).

**This recon re-verified C3's factual claim rather than inheriting it.** The only `fs.renameSync` on a media file in the entire product is `server.js:1360`, inside `POST /api/media/rename`. That route's two callers rename `shots/<id>/takes/` (shot approval) and `anchors|plates|props|vehicles` (entity approval). Library rows live in `media/` and `shots/<id>/blocking/`. **No CineBraid writer renames a library row's file**, so the staleness this batch exists to end does not occur there.

There is a *different*, real question — an **out-of-band** rename (the user moves a blocking guide in Explorer) staling `asset.storagePath` — but closing it means giving library rows a ledger identity **and** a reverse assetId→path resolution for a surface that does not exist yet. That is substrate for the Generated Media browser, and building it now would land a stored field no live reader consumes.

**Verdict: item 1 is fully reconnoitred, deliberately not implemented, and handed to the Generated Media batch with its evidence.** See §12.

---

## 3. The defect, proven before a line was written

`fal-generation.js`'s `ingest()`, `ingestEntity()` and `ingestMotion()` record what a paid job delivered as:

```js
outputs.push({ type: "candidate", name, url: `/assets/shots/${shot.id}/takes/${name}`, ... })
```

A filename and a URL. The approval rename then rewrites that filename. C2 repairs every entity edge and C3 repairs every shot edge — **both from the browser**, because both records live in `project.json`. A job record does not: `generation-jobs.json` is server-owned and the browser has no write path to it. Nothing repaired it.

Run against a real server on `b8fa3d3`, before any C4 source existed:

```
ledger row before rename: asset-abff0e86… shots/S-01/takes/S-01_FRAME_A_FAL_1.png
rename response: { ok:true, name:"S-01_FRAME_A_APPROVED.png", assetId:"asset-abff0e86…" }

job output[0].name still points at: S-01_FRAME_A_FAL_1.png
does that file exist?  false
job output[0] carries a ledger identity?  []

ledger row after rename: asset-abff0e86… -> shots/S-01/takes/S-01_FRAME_A_APPROVED.png
```

The ledger tracked those bytes across the move perfectly. The job record did not. **The forward provenance edge — "which media did this paid job deliver" — breaks at exactly the moment the media becomes canon.** Same class as the coverage-slot miss C2 closed and the winner-edge miss C3 closed.

---

## 4. Reader / writer inventory

### Writers of `job.outputs[]`

| Site | Writes | Identity before C4 |
|---|---|---|
| `fal-generation.js:849` `ingestEntity` | `{ type:"entity-candidate", name, url, … }` | none |
| `fal-generation.js:892` `ingestMotion` | `{ type:"motion-candidate", name, url, … }` | none |
| `fal-generation.js:1001` `ingest` (frame/correction) | `{ type:"candidate", name, url, … }` | none |
| `fal-generation.js:953` `ingest` (blocking) | `{ type:"blocking", assetId, name, url, … }` | `assetId` is the **library** id, not the ledger's |

Every output carries a `url`, which is what makes path-scoped matching possible (§6).

### Readers

| Site | Resolves by | Status |
|---|---|---|
| `public/automation.js:1219` `v626BlockingRowsFromJob` | `outputs[].assetId` → `P.mediaAssets[]` row id | durable already; **unchanged by C4** |
| `public/automation.js:1229` `v626FrameRowsFromJob` | filename Set | **fixed** — identity-first |
| `public/automation.js:2102` entity-state reader | filename list | **fixed** — identity-first |
| `public/fal-generation.js:546` | `outputs[].assetId` (blocking) | durable already; unchanged |
| `public/entities.js:351`, `automation.js:1436/1454` | `candidate.generationJobId` → job | reverse direction, already durable |

The **reverse** pointer (media → job, via `generationJobId`) was already id-keyed and durable. Only the **forward** pointer was filename-keyed. That asymmetry is the whole batch.

---

## 5. Live-path proof

Mandatory after the Creator Reality audit's shadowing finding, and clean here:

| Target | Definitions | Verdict |
|---|---|---|
| `POST /api/media/rename` | 1 (`server.js:1321`) | LIVE CANONICAL |
| `registerFalGeneration` | 1 registration (`server.js:3536`) | LIVE CANONICAL |
| `shared-media-disposition.js` helpers | 1 each across all `public/*.js` | LIVE CANONICAL |
| `v626FrameRowsFromJob` / `v626BlockingRowsFromJob` | 1 each | LIVE CANONICAL |

Load order: `shared-media-disposition.js` is script 75 of 105 in `public/index.html`, before `app.js` (81), `library-tools.js` (89) and `automation.js` (97). The known `v607-composer.js` (102) shadowing of `creation-studio.js` (92) touches motion-reference building and defines none of the above, so it does not apply.

---

## 6. The contract that shipped

### 6.1 Extended, not merged — for the third time

`public/shared-media-disposition.js` gains a **job section**: **+183 lines, 0 removed.** C2's and C3's contracts are untouched at source level, not merely behaviourally, exactly as C3 was additive over C2.

**Shared:** the identity rules, `isLedgerAssetId()`, and `resolveApprovalMedia()` reused verbatim. **Not shared:** which fields carry a delivery — which is exactly what differs between an entity approval, a shot winner and a job output.

### 6.2 The name, and why it is not `assetId`

**`job.outputs[].mediaAssetId`.**

`outputs[].assetId` is **already taken**: every blocking output carries the `P.mediaAssets[]` **library** row id there (`fal-generation.js:953`). Writing the ledger's identity into that key would overwrite a live library link with a different kind of id — precisely the collision C2's identity note exists to prevent. A blocking output now legitimately carries **both**: `assetId` (library row) and `mediaAssetId` (ledger). NC-F guards this permanently.

### 6.3 Matched by path, never by bare filename

A rename is scoped to one directory, and two shots routinely hold same-named takes. An output is repaired only when **its own URL proves it is that file**, or when it **already carries the identity being repaired**. Matching on the basename alone is C1's false-linkage class — `shots/SH010/blocking/BLOCK.png` inheriting SH020's record — and it is the most dangerous defect available here, because it writes a *wrong* identity rather than merely failing to write one. NC-C guards it.

Identity is checked **first**, so a *second* rename finds the output even when the filename the first one wrote has since moved on.

### 6.4 Storage, additive and optional

`name` and `url` follow the bytes; `url` because it is a derived copy of the name, the way `canonicalName` is a derived copy of a shot winner — leaving it behind trades a stale pointer for a broken preview. Absence of `mediaAssetId` is legal and is the state of every pre-C4 project. A malformed value is refused rather than stored.

### 6.5 One writer, one commit chain

`registerFalGeneration()` now returns exactly one thing — `repairJobMediaIdentity` — and `POST /api/media/rename` calls it after the anchor and after the move.

**Why not in the route.** The generation ledger has exactly one writer and one per-project `commit()` chain, and that is load-bearing: an overlapping write from a second owner is the snapshot-clobbering defect `commit` was written to end. Repairing from inside that same turn keeps the count at one.

**Read before write.** `commit` reads a missing ledger as `[]` and writes it back, so an unconditional turn would make *renaming a file* mint a generation history for a project that has never generated. The ledger is examined first and a turn is opened only when a job actually names this file. NC-H guards it.

**It never throws.** The file has already moved by the time it runs; an unreadable sidecar must not turn a completed approval into an error the director sees. That is the trade `anchorBeforeRename` already refuses to make, for the same reason. NC-I guards it.

### 6.6 What is deliberately absent

- **No stamping at ingest.** At ingest the file is brand new and the ledger has never seen it, so there is no id to record. Identity is written at the rename — the one moment two names can be proven to be the same bytes — exactly as in C2 and C3.
- **No read-time projection into `publicJob()`.** It was considered and rejected: it would add a ledger read per job on a polled route, and it is not needed for the guarantee. A job whose output was never renamed resolves by filename, which is *correct* in that case.
- **No mutation on read.** Every job reader returns fresh values.

---

## 7. Files changed

| File | Change |
|---|---|
| `public/shared-media-disposition.js` | the job section: edges, path scoping, stamp, repair, resolver, matcher (+183 / −0) |
| `fal-generation.js` | `ownerForSlug()`; `repairJobMediaIdentity()` inside the existing commit chain; the module now returns that one handle |
| `server.js` | `POST /api/media/rename` awaits the repair; `registerFalGeneration` result captured |
| `public/automation.js` | the two filename-keyed job readers resolve identity-first |
| `tests/job-media-identity.js`, `…-negative-controls.js` | new suites |
| `package.json`, `tests/run-full-check.js`, `tests/current-behavior.js` | registration |

---

## 8. Compatibility

| Case | Behaviour |
|---|---|
| Pre-C4 project (no `mediaAssetId` anywhere) | Resolves by filename exactly as before. Nothing is written by a read. |
| Project that has never generated | No generation ledger exists and the rename does not create one. |
| Unanchored rename (no ledger yet) | Filenames and URLs still repaired; no identity invented. |
| Malformed id | Refused, so the filename fallback still applies. |
| Corrupt primary ledger **with** a `.bak` | `generation-job-store.js`'s recovery runs: the backup is read, repaired and promoted. Pinned in the suite, because "corrupt means refuse" is the intuitive but wrong expectation here. |
| Corrupt ledger **with no** backup | Typed refusal, contained. The rename succeeds; the ledger is left untouched, never replaced with an empty history. |
| Out-of-band rename of an identified output | Resolves through identity; the delivery edge survives. |
| Out-of-band rename with no prior CineBraid rename | Not resolvable. Honest gap, shared with C2 and C3 — identity can only be recorded at a moment CineBraid witnessed. |

---

## 9. Tests

```
npm run check:job-media-identity
npm run check:job-media-identity-negative      9/9 controls, each with a probe receipt
npm run check:quick                            EXIT=0, 96 suites (94 -> 96)
```

Final-tree verification, run against the exact uncommitted tree including this record: **`check:quick` EXIT=0, 96 suites, C2 7/7, C3 7/7, C4 9/9.** Additional suites justified by the changed surface, all EXIT=0: `check:fal` (fal-generation.js), `check:diagnostics` and `check:composer` (automation.js). No paid-provider suite was run and no provider was contacted.

Six positive sections: **contract** (enumeration with directories, the library id untouched, malformed identity refused, identity-first resolution, read purity) · **repair** (URL follows the name, another shot's rename refused, a second rename resolved by identity, unanchored rename invents nothing) · **readers** (the *live* `v626FrameRowsFromJob` inside the page's own context, plus a wiring assertion on the entity reader) · **ledger** (the real `repairJobMediaIdentity`, in process: read-before-write, no-match rewrites nothing, never throws) · **server** (a spawned `server.js`, the real route, twice over, plus the quiet-project and corrupt-ledger cases) · **compatibility** (pre-C4 render purity, C2 and C3 vocabularies intact).

**Nine negative controls**, not seven — C2's and C3's count is not a target. The extra two exist because C4 introduces a *server-side writer on a second ledger*, which C2 and C3 did not, and that writer's own rules (read-before-write, never-throw) need guarding.

| | Defect reintroduced |
|---|---|
| NC-A | the rename repairs no job record, as before C4 |
| NC-B | an output kind dropped from the enumeration |
| NC-C | outputs matched by bare filename instead of by path |
| NC-D | **the live browser reader** ignores identity and matches filenames only |
| NC-E | a non-identity stored as one |
| NC-F | the ledger id written into the media library's key |
| NC-G | the URL left behind when the name moves |
| NC-H | a rename mints a generation ledger for a project that never generated |
| NC-I | an unreadable ledger throws out of the rename |

The server-side controls (NC-H, NC-I) run **in process** against the real `repairJobMediaIdentity` rather than through a spawned server, because a child process reads the file from disk and would never see an in-memory patch. They sabotage the same live function the route calls, not a reimplementation of it.

---

## 10. Dogfood mapping (bounded to C4)

- **§35** Generated Media / Results — *"correction/review provenance lacking a stable place"*, *"provenance and lineage where available"*. C4 makes "which media did this paid job deliver" durably answerable. **Semantic substrate delivered; the surface is the UX batch.**
- **§4.3 / §7.x** approved-authority resolution in automated paths — a resumed automation run no longer loses a take because its own approval renamed it. **Directly fixed.**
- **§17 / §18** paid retry explainability — knowing exactly which bytes a paid job delivered is a precondition for explaining a retry. **Enabled, not built.**
- **§14.3** "Review all with AI" — **stays out**, per C2's correction. Its cause is `blockingFrameId` partitioning at `automation.js:615`, and C4 found no fresh evidence of an identity issue there.
- **§3.2 / §30** frame intent — **not C4.** `outputs[]` means "this job delivered that media", exactly as `winner` means "this edge points at that media". Whether Frame A was creatively right is a different layer and remains deliberately absent.

---

## 11. Schema / OFP / version decision

**No change to any of them.** Reasoning, question by question:

1. **Is persisted shape changing?** Yes — `generation-jobs.json` job outputs may now carry `mediaAssetId`.
2. **Is the new field optional?** Yes, and absent from every pre-C4 project.
3. **Can old projects resolve without migration?** Yes — resolution falls back to the filename, which is what pre-C4 projects have always used.
4. **Is the change internal-only?** Yes. `generation-jobs.json` is an **app ledger, not project format.** The reconciliation record settled this: *"OFP does not model jobs as first-class records… there is no job, execution, run or take record anywhere in the contract"* (`…SEMANTIC_RECONCILIATION_2026-08-10.md` §225-227). A film exported and reopened elsewhere is the same film whether or not CineBraid remembers which job delivered a frame.
5. **Does current OFP text permit it?** The question does not arise: OFP does not describe this file.
6. **Is C4 implementing an already-approved decision?** Yes — C1's `media-asset-service.js:59-62`.
7. **Is a formal bump required?** No. `ASSET.storage` remains §18 Q2, unsettled and not needed here — the same position C2 and C3 recorded.

No application version bump: the version is a release artifact, and C4 is not a release.

---

## 12. Explicit exclusions

- **`P.mediaAssets[]` ↔ ledger linkage** — see §2. Reconnoitred, evidence recorded, handed to the Generated Media batch.
- **The Generated Media / Results surface, and the universal Media Inspector** — dogfood §8 and §35, both the UX batch.
- **Frame-intent validation** — a different layer, as in C3.
- **`blockingFrameId` partitioning** — production-state honesty batch.
- **Everything in the generation-truth/routing batch** — v607 shadowing, H3 keyframe sequencing, T2V/R2V/FLF routing, model substitution, editorial vs generation duration, provider settings. C4 touched no route, no model, no provider and no prompt.
- **Read-time identity projection into `publicJob()`** — considered, rejected, reasons in §6.6.

---

## 13. Known limitations

1. **Identity is recorded only at a rename.** A job output whose file is never renamed carries no `mediaAssetId`. This is by design and consistent with C2 and C3 — but it means an out-of-band rename of a *never-approved* candidate still breaks its job link. The general fix is a ledger digest for every file, which C1's byte-read policy deliberately makes gradual.
2. **Partial writers, inherited from C3.** Any future writer of `job.outputs[]` gets filename-only identity unless the rename path repairs it. That is legal by contract, but a coverage gap rather than a designed absence — the same caveat C3 §8 recorded about shot approval writers.
3. **The repair is scoped to `generation-jobs.json`.** `automation-runs.js` step records also carry `files: [...]` copied from job outputs (`automation.js:1329` and four siblings). Those are **run history**, not authority, and no reader resolves media from them; they were left alone deliberately rather than overlooked.
4. **Visual verification** — see §15.

---

## 14. Relationship to C1–C4, and the P4 verdict

| Batch | Question it made answerable |
|---|---|
| **C1** | *What media is this?* — a durable assetId independent of filename. |
| **C2** | *What is this entity media authority for, and which exact bytes were approved?* |
| **C3** | *Which shot, frame or clip does an approval belong to, and which bytes?* |
| **C4** | *Which media did this generation job deliver?* |

Together these answer every question the P4 working principle names — *"What media is this? What is it authority for? Was it approved? Which exact asset was approved? Which shot/frame/clip does that authority belong to? Can old projects still resolve it?"* — with one durable answer each.

**Verdict: P4 SEMANTIC FOUNDATION COMPLETE WITH DOCUMENTED NON-BLOCKING GAPS.** The gaps are §13.1–13.3 and the deferred item 1. None of them blocks the creator-facing product, because each has a working filename path today and a named owner tomorrow. See the closeout audit in the session report for the per-stage proof.

---

## 15. Visual verification

**DEFERRED.** C4 changes no rendered surface. It adds a field to a server-side ledger, repairs two pointers, and changes the resolution order inside two automation readers that run only during a paid automation turn. There is no CSS, no markup and no new control, so there is nothing a screenshot could establish that the suites do not. The still-unverified C2 CSS block remains unverified and is unaffected.

---

## 16. Post-P4 prerequisites now unlocked

- **Generated Media / Results** can group by job and show real lineage, because a job's delivery is now durably identifiable — and it inherits item 1 with its recon done.
- **Paid retry explainability** (dogfood §18) can name exactly what the previous batch produced.
- **Production-state honesty** can reconcile a run against the media it actually produced rather than against filenames that may have moved.

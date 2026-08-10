# CineBraid — Canonical Project Format, Legacy Migration & Open Film Project Foundation Audit

**Read-only architecture audit. No files were edited, no branch created, no migration run.**
Date: 2026-08-09

---

# PART 23 — CURRENT-STATE ARCHITECTURE REPORT

## 23.1 Baseline

| Item | Value |
|---|---|
| Branch | `fix/login-logo-preauth` |
| HEAD | `6663bd5d0c228652fca3d6d2cf37bf79c6b5ee26` |
| `origin/main` | `f15cbd15b469c12713a42de9c3afe5c7ec1c3c8b` |
| local `main` | `f15cbd15b469c12713a42de9c3afe5c7ec1c3c8b` (same) |
| Working tree | **clean** |
| App version | `6.6.6-private.1` (`package.json`) |

**Deviation from the instruction to start from clean main, disclosed:** HEAD is one commit ahead of `main` (`6663bd5 Let the sign-in page load its own logo`). That commit touches `server.js` pre-auth path list, `tests/brand-logo-asset.js`, `tests/brand-logo-real-browser.py` only. It contains **no project-schema surface**. I did not check out `main`, because that would mutate the working tree; the audit is therefore effectively against `main` for every fact reported.

**Project schema markers as shipped:**
- `meta.hubVersion` = `"v6.0.0"`
- `meta.schemaVersion` = `"6.6"` baseline / `"6.7"` current-writable
- `meta.version` = `"6.6.4-studio.2"` in the shipped sample, `"v1"` on new projects (see §23.4 — this field is broken)

---

## 23.2 Current project format map

A CineBraid project is a **directory**, not a file. `projects/<slug>/`:

| File / dir | Purpose | Authoritative? | Persisted | Portable production data | CineBraid workflow | Execution/runtime | Legacy | Comments |
|---|---|---|---|---|---|---|---|---|
| `project.json` | Everything: Bible, scenes, shots, entities, approvals, prompt history, some job state | **Yes** | Yes | Mostly | Yes | Some | Partly | Single whole-document read/write |
| `project.json.bak` | Pre-write copy | No | Yes | — | — | — | — | Written by `atomicWriteJson` |
| `backups/` | Rotating named backups | No | Yes | — | — | — | — | `createProjectBackup(file, reason)` |
| `anchors/` | Character reference images | **Yes (by convention)** | Yes | Yes | — | — | — | Identity = bare filename |
| `plates/` | Location reference images | **Yes (by convention)** | Yes | Yes | — | — | — | |
| `props/`, `vehicles/`, `audio/`, `media/` | Entity + loose media | **Yes (by convention)** | Yes | Yes | — | — | — | |
| `shots/<shotId>/takes/` | Generated/imported candidates | **Yes (by convention)** | Yes | Yes | — | — | — | Directory name **is** the shot ID |
| `shots/<shotId>/locked/` | Approved output | **Yes** | Yes | Yes | — | — | — | |
| `shots/<shotId>/blocking/` | Blocking guide frames | **Yes** | Yes | Yes | — | — | — | |
| `docs/` | Exported Markdown Bible | No | Yes | — | Yes | — | — | Output only |
| `generation-jobs.json` | FAL job transport state, request IDs | Yes (for runtime) | Yes | No | No | **Yes** | No | `generation-job-store.js`; bare array, no schema version |
| `automation-runs.json` | Durable automation run/step ledger | Yes (for runtime) | Yes | No | **Yes** | Yes | No | `schemaVersion: 2` |
| `test-feedback.json` | Automation notes | No | Yes | No | Yes | No | No | `schemaVersion: 1` |
| `continuity-observations.json` | Content-addressed observation cache | No (derived) | Yes | No | No | **Yes** | No | `version: "continuity-observation-cache-v1"` |
| `media-assets.json` | MediaAsset identity ledger | Would be | **Not created** | Yes (design) | No | No | No | **Deliberately inert (Phase 2a)** |
| `agent-index.json`, `embeddings.json` | Local search index | No (derived) | Yes | No | No | Yes | No | Rebuildable |
| `data/config.json` | App settings **and all secrets** | Yes | Yes | **Never** | Yes | Yes | No | Outside every project dir — correct |

**Code that defines the shape** (this is the surprising part):

| File | Role | Notes |
|---|---|---|
| `public/app.js` `normalizeProjectV5()` (L803–979) | **The de facto schema contract** | Runs **in the browser**, on load |
| `public/app.js` `normalizeShotV5()` (L431–581) | Shot shape, keyframe/clip synthesis | Browser |
| `public/app.js` `normalizeReferenceCoverageData()` (L655–746) | Coverage slots; **destructive migration** | Browser; clears `approvedFile` in two cases |
| `public/review-provenance.js` | Candidate review + package history | Browser |
| `public/shared-build-history.js` | Prompt-build/snapshot interning | Browser + Node |
| `public/shared-entities.js` | Shot→entity resolution | Browser + Node |
| `public/shared-continuity.js` | Continuity manifest/observation/comparison | Browser + Node; **pure, deterministic** |
| `server.js` `BLANK()` (L668) | New-project template | Node |
| `server.js` `validateProjectForSave()` (L365) | The only server-side structural gate | Node; minimal |
| `server.js` `inspectProjectFile()` (L406) | Safe-open gate | Node |
| `server.js` L1807–2760 | Project Builder import normalize/validate/review | Node |
| `resources/project-builder/CINEBRAID_PROJECT_SCHEMA_v6.5.3.json` | The **only formal JSON Schema** | Ships to the LLM; already behind (6.5.3 vs 6.7) |

**Finding P1 — the schema lives in the browser.** The only comprehensive normalizer, and the only code that raises `schemaVersion`, is client-side JavaScript. The server accepts any document that passes a ~30-line structural check. A non-browser writer (agent runs, generation ingest, coordinator applies, a future CLI, any third-party tool) can persist a project the normalizer has never seen. There is no server-side canonical contract.

---

## 23.3 Current object model (reconstructed from executable behaviour)

### PROJECT (root)
`meta`, `qcChecklist` (exactly 5 strings, enforced only at import), `scenes[]`, `shots[]`, `characters[]`, `locations[]`, `props[]`, `vehicles[]`, `audio[]`, `mediaAssets[]`, `finishJobs[]`, `jobs[]`, `decisions[]`, `agentRuns[]`, `sessions[]`, `promptBuildsById{}`, `promptSnapshotsById{}`.

Required by `validateProjectForSave`: `meta` object; `scenes`/`shots`/`characters`/`locations`/`props` arrays; unique `id` within each collection; every `shot.scene` resolves to a scene.

### SCENE
`id` (uppercase-safe at import, unconstrained at save), `title`, `tier` ("A"|"B", defaulted to B), `whatHappens`, `howItFeels`, `stage`, `characters[]`, `notes`, `audio{}`, `continuityReview{}` ← **analysis output persisted on a production object**, `continuityReviewSettings.expectedChanges` ← **continuity intent stored as newline-delimited prose**.

Order: **array position only. There is no ordinal field.**

### SHOT
Identity/structure: `id`, `scene`, `title`, `desc`, `positioning`, `safe`, `route`, `risks[]`, `notes`.
Dependencies: `characters[]`, `codes[]` (**a union namespace — see F3**), `creationBrief.locationId`, `creationBrief.propIds[]`.
Duration: `dur` **and** `duration` **and** `sec` (three aliases; only `dur` is read by the prompt engine).
Status: `status` **and** `workflowStatus` **and** `reviewStatus` (three parallel state fields).
Frames: `keyframes[]` `{id, label, title, description, required, winner, selectedCandidate, generationPackages[]}`.
Motion: `clips[]` `{id, suffix, label, title, kind (i2v|flf|r2v|plan|post|reuse), dur, fromFrame, toFrame, motionPrompt, note, + 15 audio fields}`.
Duplicate frame model: `creationBrief.frames[]` mirrors `keyframes[]` (`id, label, title, action, selectedCandidate, promptBuilds`), plus `creationBrief.frameWorkflows{}` — **a third place a per-frame selection can live**.
Approval: `winner` (legacy single still), `keyframes[].winner`, `keyframes[].selectedCandidate`, `creationBrief.finalStillFile`, `creationBrief.finalVideoFile`, `creationBrief.approvedMotionFile`, `stageApprovals{}`, `candidateFiles[].decision`.
Continuity: `continuitySelections{entityId→stateId}` **and** `continuityStateSelections{}` (import alias), `continuityIntent{entityId→{expected[], allowPresenceChange, allowMovement, note}}` (6.7).
Generation: `promptBuilds[]`, `generationPackages[]`, `imagePromptPackages[]`, `promptOptions[]`, `referenceInstructions{}`, `referenceRoles{}`, `referenceSelection{}`, `packagePlanner`.
Provider: `stillModel`, `videoModel` ← **per-shot provider preference inside production data**.

### ENTITY (character | location | prop | vehicle)
Shared: `id`, `name`, `prefix`, `status`, `workflowStatus`, `approvedFile`, `candidateFiles[]`, `continuityStates[]`, `coverageSlots[]`, `assetPromptBuilds[]`, `creationDescription`, `tracking{}` (6.7), `sameObjectAs`, `role`, `coverageMigrationHistory[]`, `primaryAngleAssignment{}`.
Character-only: `block`, `driftNotes`, `expressions`, `expressionSlots[]`, `anchorPrefix`, `anchors`.
Location/prop: `notes`, `description`, `coveragePolicy`.

**Prose-description aliases: `block`, `notes`, `description`, `creationDescription`, `visualDescription`, `coverageDescription`, `coverageCharacteristics`.**

### CONTINUITY STATE
`{id, name, isDefault, parentStateId, generationMode: "derive"|"independent", approvedFile, appliesTo, notes, assetPromptProfile, assetPromptNotes, assetPromptBuilds[], tracking{}}`.
Legacy note aliases: `description`, `stateDelta`, `delta`, `changeOnly`, `change`, `changes`, `visualDescription`, `instructions`, `prompt`.

### COVERAGE SLOT
`{id, label, required (bool), requirement (enum: required|planned|not-required), approvedFile, notes, status, replacementHistory[], provenance{}}` — `required` and `requirement` are **two encodings of the same fact**.

### MEDIA REFERENCE
There is **no media reference type**. A reference is a **bare filename string** whose meaning comes from the field it sits in and the directory convention that field implies (`approvedFile` on a character → `anchors/`; `winner` on a keyframe → `shots/<id>/takes/` or `locked/`).

`P.mediaAssets[]` (project media library) is a *second*, partially-live model: `{id, links[{id, targetType, targetId, role, referenceKind, priority, order, angleTag, detailRegion, availableAngles, agentContext, generationInput, blockingVersion}]}`. Written today only by blocking-frame ingest (`fal-generation.js:825–866`).

`media-assets.json` (MediaAsset ledger, `media-assets.js`) is the **third** model — the well-designed one — and is **inert by decision**: 128-bit opaque `assetId`, nullable `contentHash` with a retention rule, project-relative `storage.path` enforced, `role`/`source`/`lifecycle`/`scope`/`legacy` vocabularies.

### PROVENANCE
`promptBuildsById{}` (content-addressed, interned, `revision`, `revisionReason`, `immutableAt`), `promptSnapshotsById{}`, `candidateFiles[]` (`stored`, `original`, `renamedFrom[]`, `renamedAt`, `addedAt`, `decision`, `labels[]`, `automationRunId`, `automationStepKey`, `automationReport`), `generationPackages[]`.

### READY-FOR-EDIT
Not a stored field. Computed on demand by `projectReadinessIssues(P)` (`server.js:914`) → `GET /api/project/readiness`. Emits `unresolved-reference`, `shot-description`, `shot-duration`, `entity-canon`, `entity-reference`, `missing-file`.

---

## 23.4 Current schema versioning

**Twelve independent version markers exist. None of them is a project format version.**

| Marker | Location | Meaning today |
|---|---|---|
| `meta.version` | project.json | **Broken.** `"v1"` on new projects, `"6.6.4-studio.2"` (an app version) in the shipped sample, `"v2.1"` (the film's own draft number) in Overfit. Three incompatible meanings; nothing increments it, nothing reads it. |
| `meta.hubVersion` | project.json | Tracked the **app** version through the anchor-hub/Stillhouse era (`v1 → v2.2 → v3.1 → v4 → v4.7 → v5.8.1`), then froze at `"v6.0.0"` and became a schema marker. |
| `meta.schemaVersion` | project.json | Introduced at CineBraid 6.6. Absent in every pre-6.6 project. Baseline `"6.6"`, current `"6.7"`. |
| `meta.v5.migratedAt` | project.json | v5 migration stamp |
| `meta.schemaMigrations.coverageV6533`, `.coverageAliasesV6602` | project.json | Ad-hoc named migration ledger with ISO timestamps — **the seed of a real migration record** |
| `meta.promptHistoryVersion` | project.json | `1` |
| `meta.promptProfilesVersion` | project.json | `"2026-07"` |
| composition `schemaVersion` | prompt-engine output | `1` |
| `schemaVersion` | media-assets.json | `1` |
| `schemaVersion` | automation-runs.json | `2` (notes file: `1`) |
| `version` | continuity-observations.json | `"continuity-observation-cache-v1"` |
| manifest/contract/comparison versions | shared-continuity.js | `"continuity-manifest-v1"`, `"declared_entities_final"`, `"continuity-comparison-v1"` |

`release-identity.js` already contains the right doctrine in a comment: schema markers "describe stored project data, not the application build, and must never follow this value." The doctrine is documented and **not yet enforced by a type**.

**Comparison logic:** `schemaVersionIsOlder()` extracts all digit-runs and compares numerically. A *missing* marker counts as older; a marker *ahead* is never downgraded. There is **no behaviour for "newer than I understand"** other than leaving it alone and editing it anyway.

---

## 23.5 Current import / Project Builder format

**Model A today: the LLM emits the canonical project document directly.** `normalizeImportedProject()` spreads the model's JSON over `BLANK()` and returns a full project.

Pipeline: `POST /api/projects/preview-import-json` → `importedProjectShape()` → `normalizeImportedProject()` → `validateImportedProject()` → `clearUnsupportedBuilderClaims()` → `projectBuilderReview()` → in-memory preview keyed by SHA-256, TTL-bounded, max 24 → `POST /api/projects/import-json` commits.

Import is stricter than save: IDs must match `/^[A-Z0-9_-]+$/`, entities need a name and exactly one default continuity state, `qcChecklist` must be exactly 5, cross-references must resolve. **None of this is enforced on ordinary save.**

`clearUnsupportedBuilderClaims()` is a genuine safety boundary — it refuses to let the model assert approval: clears every `approvedFile`, `winner`, `candidateFiles`, `stageApprovals`, all package/build arrays, and downgrades any "APPROVED/LOCKED/COMPLETE" workflow status to DRAFT.

**The review is transient.** `inferred[]`, `conflicts[]`, `missing[]`, `review[]`, `removed[]` are computed for a preview screen and **never persisted**. Once imported, the project cannot say which of its facts came from the script and which the model invented.

**There is no export.** `/api/export` writes a Markdown Bible; `/api/export/packages` zips generation packages. There is no route that emits a portable canonical project. Import and export are asymmetric.

---

## 23.6 Current sidecar model

Four durability classes exist side by side:

1. **Refuse-on-corruption** (correct): `media-asset-store.js`, `generation-job-store.js` — atomic write, `.bak`, read-side recovery, hard refusal when both copies are unreadable.
2. **Recover-and-warn**: `automation-runs.js`.
3. **Degrade-to-miss** (correct for derived data): `continuity-cache.js`.
4. **Silent empty**: the historical `catch { return []; }` in `fal-generation.js` — already identified and replaced.

The sidecars are correctly **outside** `project.json`, and every one of them is runtime or derived. This boundary is already right and should be preserved.

---

## 23.7 Duplicated / conflicting representations (consolidation matrix)

| # | Concept | Representations found | Consumers disagree? | Severity |
|---|---|---|---|---|
| D1 | Entity visual description | `block`, `notes`, `description`, `creationDescription`, `visualDescription`, `coverageDescription`, `coverageCharacteristics` | **Yes — five different resolution orders** (see F1) | **Critical** |
| D2 | Shot duration | `dur`, `duration`, `sec` | **Yes — proven loss** (see F2) | **Critical** |
| D3 | Shot dependencies | `codes[]` (union namespace), `characters[]`, `creationBrief.locationId`, `creationBrief.propIds[]` | **Yes** (see F3) | **Critical** |
| D4 | Shot state | `status`, `workflowStatus`, `reviewStatus` | Partly; legacy telemetry already tracks it | High |
| D5 | Frame record | `keyframes[]`, `creationBrief.frames[]`, `creationBrief.frameWorkflows{}` | Yes — three places hold `selectedCandidate` | High |
| D6 | Approved output | `shot.winner`, `keyframes[].winner`, `keyframes[].selectedCandidate`, `creationBrief.finalStillFile/finalVideoFile/approvedMotionFile`, `stageApprovals{}` | Yes | High |
| D7 | Coverage requirement | `required` (bool) + `requirement` (enum) | Latent | Medium |
| D8 | Continuity state delta text | `notes` + 9 aliases | Tracked by legacy telemetry | Medium |
| D9 | Continuity selection | `continuitySelections{}`, `continuityStateSelections{}`, per-frame selections | Yes | Medium |
| D10 | Media asset | filename strings, `P.mediaAssets[]`, `media-assets.json` ledger | Three models, one inert | High |
| D11 | Dialogue | `shot.audio.line` vs `shot.audio.vo`; also on every clip | Tracked | Medium |
| D12 | Dead collections | `P.jobs[]` (initialised, `delete`d in agent-suite, never written), `P.decisions[]` (read in 3 places, **never written**) | — | Low but pure debt |

### Fields written but never read
`meta.version`, `meta.promptProfilesVersion` (informational), `shot.duration` (no writer in current build, still read as a fallback by focused-workspaces).

### Fields read but never written
`P.decisions[]`, `shot.sec`, `shot.duration` (current build writes only `dur`).

### Defaults that became canon
`qcChecklist` — five sentences from `BLANK()` are baked into every project and shipped as production truth. `statusVocab: ["UNBUILT","BUILT","NEEDS POST","LOCKED"]` — a vocabulary in data that no longer matches the three status fields. `scene.tier` defaulting to `"B"` at import silently asserts a creative judgement.

---

### F1 — Critical: a filmmaker's visual description never reaches the image prompt

Five resolution orders exist for "what this entity looks like":

| Consumer | Order |
|---|---|
| `prompt-engine.js:322,340,421` — **what reaches the image model** | `block \|\| description` |
| `shared-continuity.js:286` — what the continuity observer is told | `creationDescription \|\| description \|\| block \|\| notes` |
| `coverage-automation.js:22` | `coverageDescription \|\| creationDescription \|\| (block\|notes) \|\| visualDescription` |
| `server.js:2746` (import review) | `creationDescription \|\| visualDescription \|\| (block\|notes)` |
| `entities.js:955` (completeness) | `block \|\| notes \|\| creationDescription` |

`creation-studio.js:448` writes `creationDescription`. `normalizeProjectV5` guarantees it exists.

**Proven executably against the shipped sample:**

```
--- baseline (block only) ---
canon: "Adult courier in a slate-blue work coat and dark trousers..."
--- set creationDescription, clear block ---
canon: ""
continuity identity_cues: "Weathered brass goggles pushed up on the forehead; a hand-stitched leather satchel."
```

The continuity system sees the description. The generation prompt compiler sees an empty string. This directly violates the stated core invariant that no meaningful director intent may silently disappear.

### F2 — Critical: shot duration is lost in the shipped sample

`prompt-engine.js:481` reads `shot.dur`. The sample's `SAMPLE-03` stores `"duration": 4` and no `"dur"`.

```
SAMPLE-01 | dur=4 duration=4 | engine=4s | defaulted=false
SAMPLE-02 | dur=4 duration=4 | engine=4s | defaulted=false
SAMPLE-03 | dur=undefined duration=4 | engine=5s | defaulted=TRUE
```

A declared 4-second shot becomes a defaulted 5-second shot. In the product's own shipped sample.

### F3 — Critical: `codes[]` is an undeclared union namespace resolved by prefix matching

`shotEntityTokenMatches` (`shared-entities.js:2`) matches when `token === id` **or** `token.startsWith(id + "-")` **or** `token.startsWith(id + "_")`, and `resolveShotEntities` feeds `codes[]` into the character, location, prop, vehicle **and** audio resolvers simultaneously. Consequences:

- The suffix is silently discarded — specificity is lost, not flagged.
- One token can resolve to several entities if IDs nest (`PROP-TIN` and `PROP-TIN-BOX`).
- Non-entity tokens resolve to nothing and vanish with no diagnostic.

Measured against the real Overfit project (§23.9): **28 of 45 tokens reinterpreted, 3 dropped.**

---

## 23.8 Legacy project inventory

`C:\CineBraid\CineBraid-Projects\` is **empty**. `D:\Projects\` is the real archive (via the `Projects.lnk` desktop shortcut → `D:\Projects`).

| Generation | Path | `hubVersion` | `schemaVersion` | Shots | Bytes |
|---|---|---|---|---|---|
| anchor-hub | `D:\Projects\Overfit\app_archive\anchor-hub\projects\the-overfit` | `v1` | absent | 11 | 23,327 |
| anchor-hub-18 | …`anchor-hub-18`… | `v1` | absent | 11 | 22,876 |
| anchor-hub-19, -21 | …  | v1–v2 | absent | — | — |
| anchor-hub-22 | … | `v2.2` | absent | 39 | 68,592 |
| anchor-hub-30, -32 | … | v3.x | absent | — | — |
| anchor-hub-33 | … | `v3.1` | absent | 22 | 79,220 |
| stillhouse-40 | … | `v4` | absent | 22 | 78,957 |
| stillhouse-41-gpt | … | v4.x | absent | — | — |
| STILLHOUSE v4.2/4.3/4.5/4.6 | `…\app_archive\STILLHOUSE_v4.x` | v4.x | absent | — | — |
| STILLHOUSE v4.7 | `D:\Projects\Overfit\STILLHOUSE_v4.7\projects\the-overfit` | `v4.7` | absent | 22 | 81,135 |
| **CineBraid v5.8.1** | `D:\Projects\CineBraid\app-581\CINEBRAID_v5.8.1\projects\the-overfit` | `v5.8.1` | absent | 22 | **106,510** |
| — | …`\projects\pandemonium-heights-e101` | `v5.8.1` | absent | 0 | 1,769 |
| community 0.1.0-rc.1 | `D:\Projects\CineBraid\app-community-010\…\projects\demo-project` | `community-0.1.0` | absent | 2 | 11,017 |
| Current sample | `projects\cinebraid-sample` | `v6.0.0` | `6.6` | 3 | 10,974 |
| QA fixtures (~20) | `C:\CineBraid\QA-Reviews\**` | `v6.0.0` | `6.6` | 1–3 | — |
| Dogfood | `C:\CineBraid\CineBraid-Dogfood\projects\dogfood-sample` | v6 | 6.6 | 3 | 13,132 |

Also present: `D:\Projects\CineBraid\app-581\…\CINEBRAID_PROJECT_SCHEMA_v5.8.json` — a historical formal builder schema, useful as a migration reference.

**Excluded:** `D:\Projects\Spy NF\NFSpy\projects\New Project*\project.json` — a different application (3D scene editor: `ambientLight`, `envMap`, `shadowQuality`, absolute `workspacePath`). Not CineBraid data. Do not migrate.

**Nothing was opened through CineBraid. Every file was read with `fs.readFileSync` in a scratchpad script outside the repository.**

---

## 23.9 Overfit findings

`THE OVERFIT` — the most valuable record in the archive: **18 successive snapshots of the same film across four application generations.** It is a schema-evolution corpus, not just a project.

**Structural evolution:**
- `hubVersion` climbs `v1 → v2.2 → v3.1 → v4 → v4.7 → v5.8.1`; `schemaVersion` never appears.
- `meta.version` stays `"v2.1"` for the entire history — it is **the film's draft number**, which is why it now collides with the app version the current sample stores there.
- Shot count goes 11 → 39 → 22: a genuine restructuring, not corruption.
- `atomic`, `parentShot`, `fallbackFor` appear at anchor-hub-22 and **vanish** by v5.8.1. Shot-to-shot structural relationships existed and were lost.
- `sameObjectAs` (entity identity aliasing) survives; `coveragePolicy`, `role` appear on locations/props.
- `iterations`, `iterBudget`, `targetRuntime`, `contextDoc` are workflow-era fields with no current consumer.
- Per-shot `stillModel` / `videoModel` are present throughout — provider preference embedded in production data since v1.

**Reference integrity under the current build:**

```
exact token matches: 14
REINTERPRETED (suffix silently discarded): 28
    KAI-ANCHOR-01  -> KAI
    KAI-ANCHOR-02  -> KAI
    KAI-HANDS-01   -> KAI
    LOC-CORRIDOR-A -> LOC-CORRIDOR
    LOC-GALLEY-A   -> LOC-GALLEY
    LOC-HULL-A     -> LOC-HULL
    LOC-LOGBAY-A   -> LOC-LOGBAY
    LOC-SERVER-A   -> LOC-SERVER
DROPPED (resolve to nothing): 3   STAGE-3
```

The `-A` suffix meant *"coverage view A of this location"*; `-ANCHOR-01` meant *"identity reference sheet 01"*; `STAGE-3` was a pipeline marker. Today CineBraid keeps the entity and throws away which view and which reference sheet the shot was built against — silently, with no warning and no readiness issue.

**Production semantics trapped in prose.** Overfit shot `L0-01`:

- `notes`: *"Shared-asset: L7-03 depends on this plate LOCKED first. Merge direction: — (clean)."*
- `risks[]`: *"LOCK this framing — L7-03 derives from it (bookend dependency)"*
- `desc`: *"This EXACT framing is mirrored at the end (L7-03) corrupted."*

A **shot-to-shot derivation/bookend dependency** — a first-class production relationship — exists three times as English and zero times as structure. Nothing can validate it, order work by it, or warn when L0-01 changes.

**Hazards:** none. No absolute paths, no URLs, no secrets in any Overfit generation. Media lives beside the project (`characters/`, `siteimages/`, `vids/`) with human-readable, versioned filenames (`OVERFIT-V2_L1-01_PRIMARY_V003.png`) — a de facto naming convention carrying `project_shot_role_version` that the schema knows nothing about.

**Overfit must not be opened by CineBraid during this work.** A sanitised derivative should become the golden migration fixture (§27).

---

## 23.10 Migration risks

| Risk | Evidence | Severity |
|---|---|---|
| **Opening a project mutates it destructively** | `normalizeReferenceCoverageData()` clears `approvedFile` for coverage-sheet and "silently seeded" character angles, logging to `coverageMigrationHistory[]`. This runs on **load**, in the browser, before any user action. | **Critical** |
| Migration happens client-side, unversioned | `normalizeProjectV5` has no migration identity, no ordering, no report, no rollback | Critical |
| No snapshot before migration | `.bak` is a *write*-side copy, not a *migration*-side snapshot | High |
| Pre-6.6 projects have no marker | 13 of 18 Overfit generations; migration must sniff shape, not read a version | High |
| `codes[]` cannot be migrated deterministically | `LOC-HULL-A` could be coverage slot A, a variant location, or a plate. **Requires human review.** | High |
| Newer-than-supported has no behaviour | `schemaVersionIsOlder` returns false and the build edits anyway | High |
| Sidecars are not migrated with the project | `generation-jobs.json` has no schema version at all | Medium |
| Whole-document save | A 1,000-shot feature at the measured 4.8–8.3 KB/shot is a 5–8 MB JSON document parsed, normalised and rewritten on every save | Medium |

---

## 23.11 Information at risk of loss

Ranked by production value:

1. **Coverage/reference specificity in `codes[]`** — 28 instances in Overfit alone, already being discarded on every read.
2. **Shot-to-shot derivation relationships** (bookends, plate dependencies, merge direction) — prose only.
3. **Entity visual descriptions written into `creationDescription`** — never reach the image compiler (F1).
4. **Declared shot durations stored as `duration`/`sec`** — silently defaulted (F2).
5. **`atomic` / `parentShot` / `fallbackFor`** — shot decomposition and fallback alternates, already dropped between generations.
6. **Import inference/conflict findings** — computed once, shown once, discarded.
7. **`[INFERRED FOR PLANNING]` markers** — survive only as long as nobody edits the prose they are embedded in.
8. **Filename-encoded semantics** (`OVERFIT_L2-02_A_LAST_V001` = project/shot/unit/**last frame**/version) — pure convention, invisible to the schema, destroyed by rename.
9. **`sameObjectAs`, `coveragePolicy`, `role`, `driftNotes`, `expressions`** — partially consumed, at risk in any cleanup.

---

## 23.12 Current provider/runtime leakage into project data

| Leak | Location | Verdict |
|---|---|---|
| `shot.stillModel`, `shot.videoModel` | project.json, since v1 | **Runtime preference in production data** |
| `meta.promptDefaults.{imageProfile, compositeProfile, videoProfile}` | e.g. `"gpt-image-2/t2i"`, `"seedance-2/i2v"` | Provider-model identifiers as project defaults |
| `meta.models[]`, `meta.defaults.{stillModel, videoModel}` | project.json | Same |
| `meta.promptProfilesVersion: "2026-07"` | project.json | Prompt-adapter release stamp |
| `generationPackages[]`, `imagePromptPackages[]`, `promptBuilds[]` | project.json | Compiled provider payloads — *some* is portable provenance, most is not |
| `candidateFiles[].automationReport` | project.json | Full automation run report embedded per candidate |
| `P.mediaAssets[].links[].blockingVersion` | project.json | Ingest bookkeeping |
| `P.jobs[]`, `P.finishJobs[]`, `P.agentRuns[]` | project.json | Job state (mostly dead, still validated) |
| `scene.continuityReview{}` | project.json | Model analysis output on a production object |

**Clean by contrast:** FAL request IDs, endpoints, retry state and concurrency live in `generation-jobs.json`; secrets live only in `data/config.json` behind a declared registry (`CONFIG_SECRETS`, masked/omitted/presence modes). That boundary is already correct.

---

## 23.13 Current path / portability problems

1. **Media identity is a bare filename.** `approvedFile: "CHAR-COURIER-FRONT.png"` — meaningless without knowing that characters live in `anchors/`.
2. **`shots/<shotId>/` — the shot ID is a directory name.** Renaming a shot ID orphans its takes, locked outputs and blocking frames.
3. **Renaming an approved file breaks pointers.** `renameCandidateRecord` + `retargetSelectedCandidates` patch a hand-maintained list of "semantic pointer" fields (`selectedCandidateSlots`); anything not on that list silently rots.
4. **Same-named files in different folders are indistinguishable** once lifted out of context.
5. No hash, no size, no logical asset ID on any reference in `project.json`.
6. `config.workspace.mediaRoot` / `outputRoot` are absolute machine paths — correctly outside the project, but assisted sync copies **into** the project by filename.

**Good news:** no absolute paths, URLs or secrets were found in **any** project.json across all 18 Overfit generations, the sample, the community demo or the QA fixtures. `media-assets.js:86` already enforces project-relative paths (`isProjectRelativePath` rejects absolute, drive-qualified, UNC and `..`). The rule exists; it just isn't applied to `project.json`.

---

## 23.14 Current canon vs inference model

**The current mechanism is prose string markers.**

- `[INFERRED FOR PLANNING] <explanation>` appended to a free-text `notes` field by `addBuilderMarker()`.
- `[SOURCE CONFLICT]` — recognised by the review walker, but **never written by CineBraid**; only an external Project Builder can emit it.
- `projectBuilderReview()` regex-walks every string in the document to collect them.

Properties: not typed, not queryable, editable by anyone, destroyed by ordinary prose editing, cannot mark a *field* (only whatever prose bucket happens to be nearby), and cannot express "approved by the filmmaker".

**What already exists and is better than it looks:**

| Concept | Existing support |
|---|---|
| Inferred | `[INFERRED FOR PLANNING]` prose marker; `durationWasDefaulted` (computed, not persisted) |
| Conflicting | `[SOURCE CONFLICT]` prose marker (read-only) |
| Approved by filmmaker | `workflowStatus`, `stageApprovals`, `candidateFiles[].decision`, coverage `status` |
| Observed from media | **Fully modelled** — `continuity-observations.json`, deterministic comparison, `presence/occlusion/identifiable/markings/colour` vocabularies with an explicit `uncertain` value |
| Needs review | `projectReadinessIssues()`, import `missing[]`/`review[]` (transient) |
| Unknown / intentionally unspecified | **Absent.** Empty string is overloaded: "not set", "not applicable", "deliberately unspecified" and "cleared by a migration" are all `""`. |
| Explicit source fact | **Absent.** No source documents, no anchors, no citations. |

**The continuity subsystem is the model to copy.** It already separates *declaration* (manifest, from the Bible), *observation* (what a model saw), and *finding* (deterministic comparison), keeps observations content-addressed in a sidecar, and refuses to let the browser reach into contract internals. Every other subsystem should be held to that standard.

---

# PART 24 — PROPOSED CANONICAL MODEL

## Guiding decisions

- **Evidence attaches to statements, not to values.** Do not wrap every primitive in `{value, derivation}`. That is the single biggest overengineering risk, and it is what the prior Open Film Format strategy note (§29) currently proposes.
- **Records stay flat and readable.** A filmmaker or a developer must be able to read a shot without a decoder ring.
- **Absence is not a value.** Add an explicit "unspecified" only where production genuinely distinguishes it.
- **One representation per concept.** Aliases become migrations, not permanent readers.

## Top-level shape

```
project
├── format          format id + version + profiles + extension declarations
├── meta            title, aspect ratio, style intent, workflow emphasis
├── sources[]       source documents (script, treatment, notes) + anchors
├── story
│   └── scenes[]    ordered narrative units
├── shots[]         ordered production units
├── entities        characters[] / locations[] / props[] / vehicles[] / voices[]
├── assets[]        logical media identity (project-relative, hashable)
├── references[]    (shot|entity|state) --purpose--> asset
├── continuity      intent lives on shots/entities; observations/findings do NOT
├── statements[]    the evidence/provenance sidebar (see below)
└── extensions{}    namespaced, round-trip preserved
```

### `format` — why it exists
The one place a reader looks to decide whether it can open the document, which profiles it must understand, and which extensions are present. Nothing else in the document carries a version.

```json
"format": {
  "id": "open-film-project",
  "version": "1.0",
  "profiles": ["core", "bible", "shot-planning", "continuity"],
  "extensions": { "com.cinebraid.workflow": "1" },
  "generator": { "name": "CineBraid", "version": "6.7.0" }
}
```
**Does not belong:** the application version anywhere else; per-collection version markers.

### `sources[]` — why it exists
Traceability requires something to point *at*. Without it "explicit source fact" is unrepresentable — which is exactly today's gap.

```
source: { id, kind: screenplay|treatment|outline|note|import|other,
          title, mediaId?, anchors[]: { id, label, page?, sceneHeading?, elementKind? } }
```
Cardinality 0..n. Anchors are stable IDs; page/line are supplemental, never the identity.

### `story.scenes[]`
Narrative truth. `id`, `title`, `synopsis` (was `whatHappens`), `tone` (was `howItFeels`), `tier`, `narrativeOrder` (**explicit integer**), `timeOfDay`, `sourceAnchors[]`.
**Does not belong:** `continuityReview` (analysis output), `continuityReviewSettings` (prose intent), style-block scoping.

### `shots[]`
Production intent, expressible **without any model-specific prompt**.

```
shot: {
  id, sceneId, slug?, title,
  order: { script: n, edit: n? },          // explicit; see Part 7
  action, intent,                           // what happens / why the shot exists
  framing: { size, angle, height, lens?, movement?, screenDirection? },
  staging,                                  // blocking prose + optional structured elements
  subjects[]: { entityId, role, stateId?, placement? },
  setting: { locationId, coverageId?, timeOfDay? },
  performance[]: { entityId, note, expressionId? },
  dialogue[]: { entityId, line, delivery?, language?, sourceAnchor? },
  audio: { ambience?, sfx[], music?, sync? },
  duration: { seconds, basis: authored|derived|unspecified },
  frames[]: { id, role: first|last|key, label, description,
              stateSelections{entityId: stateId}, approvedAssetId? },
  motion[]: { id, kind, fromFrameId, toFrameId?, seconds, direction },
  continuityIntent{entityId: {...}},
  relations[]: { kind: derives-from|bookend-of|alternate-of|fallback-for|part-of,
                 targetShotId, note },      // ← fixes the Overfit prose-only dependency
  editorial: { transitionIn?, transitionOut? },
  status: { production: <enum>, review: <enum> }   // ONE state pair, not three
}
```
**Does not belong:** `stillModel`/`videoModel`, `promptBuilds`, `generationPackages`, `referenceSelection`, `packagePlanner`, `candidateFiles`, `winner`, `dur`/`sec`, `codes`.

### `entities`
Keep **separate collections with a shared base**, not one polymorphic `Entity`. A location is not a character with a type tag; coverage, states and relationships mean different things.

Shared base: `id`, `name`, `aliases[]`, `description`, `identityCues`, `states[]`, `references[]`, `sourceAnchors[]`, `relations[]`, `tracking{}`.
Character adds: `role`, `expressions[]`, `driftNotes`, `voiceId`.
Location adds: `coverage[]`, `geometryNotes`, `parentLocationId` (sub-locations).
Prop/vehicle add: `coverage[]`, `heroLevel`.

**`description` is the single prose field.** `block`, `notes`, `creationDescription`, `visualDescription`, `coverageDescription` all migrate into it or into `identityCues`.
Extensibility: `entities.other[]` with a `kind` string, so animals/crowds/effects/wardrobe are representable without a schema change.

### `continuity`
Three facts, three homes — the distinction the current design already earns and then blurs:

| Fact | Home | Portable? |
|---|---|---|
| Declared production intent (`shot.continuityIntent`, `frame.stateSelections`, `entity.tracking`, `entity.states[]`) | **On the shot / entity, in core** | Yes |
| Observation (what a model saw in a frame) | **Sidecar / optional extension** | Optional |
| Finding (expected vs observed) | **Derived, never stored** | No |
| Human acceptance of a finding | On the shot as a small `continuityAcceptances[]` record | Yes |

Today `scene.continuityReview` puts analysis output on a production object and `continuityReviewSettings.expectedChanges` puts intent in prose. Both move.

### `assets[]` + `references[]`
Adopt the **existing, already-designed** MediaAsset model — do not invent a second one.

```
asset:     { id: "asset-<32hex>", mediaType, storage: { path (project-relative), bytes?, mtimeMs? },
             contentHash: "sha256:…"|null, hashState: unhashed|hashed|unavailable,
             source: generated|uploaded|imported|derived|extracted|unknown,
             derivedFrom[]: assetId, provenance?: { … see Part 12 } }
reference: { id, subject: {type: shot|frame|entity|state|coverage, id},
             assetId, purpose: <role vocabulary>, priority, order, approved: bool }
```
This is what makes *"this shot refers to this asset for this purpose"* expressible without `C:\Users\Cale\Desktop\foo.png` — the stated goal.

### `statements[]` — the evidence sidebar (the key design proposal)

The problem: mark canon-vs-inference **without** turning every value into an object.

The answer: **evidence is a sparse annotation keyed by JSON Pointer, held in one place.** Most fields carry no statement — which is correct, because most fields are ordinary authored production data.

```json
"statements": [
  {
    "target": "/entities/characters/char-mara/description",
    "status": "inferred",
    "by": { "kind": "model", "name": "claude-opus-5" },
    "at": "2026-08-09T10:02:11Z",
    "note": "Not stated in the screenplay; proposed during import."
  },
  {
    "target": "/entities/characters/char-mara/name",
    "status": "source-derived",
    "sourceId": "src-script",
    "anchors": ["sc-004-action-002"]
  },
  {
    "target": "/shots/sh-0120/framing/size",
    "status": "approved",
    "by": { "kind": "human", "name": "Director" },
    "at": "2026-08-09T11:40:00Z"
  }
]
```

Status vocabulary (six, deliberately small): `source-derived`, `observed`, `inferred`, `approved`, `conflicting`, `unspecified`.

Why this shape:
- **Zero cost when unused.** A hand-built traditional project has an empty array. Satisfies "AI provenance is optional".
- **Field-level precision** without field-level bloat.
- **Ignorable.** A tool that drops `statements[]` still has a valid, complete film.
- **Mergeable.** Append-only; conflicts are visible as two statements on one target rather than a lost edit.
- **Directly fixes the current failure**: today a Project Builder guess and a director's decision are the same string in the same field.

Rule (this is the whole point): **a value with an `inferred` statement is a proposal, not canon.** Approval is an explicit act that adds an `approved` statement. Ready-for-Edit requires no unresolved `inferred` or `conflicting` statement on any field a shot depends on.

Practical granularity: statements are written for **import-time inference, source citations, approvals and conflicts** — not for every keystroke. Expect tens to low hundreds per project, not thousands.

---

# PART 25 — REPRESENTATIVE CANONICAL EXAMPLE

Invented, neutral content. Readable enough that a human understands the film.

```json
{
  "format": {
    "id": "open-film-project",
    "version": "1.0",
    "profiles": ["core", "bible", "shot-planning", "continuity", "generative"],
    "extensions": { "com.cinebraid.workflow": "1" },
    "generator": { "name": "CineBraid", "version": "6.7.0" }
  },

  "meta": {
    "title": "The Last Ferry",
    "format": "Short film",
    "aspectRatio": "2.39:1",
    "styleIntent": "Overcast coastal realism; long lenses; no lens flare.",
    "world": { "setting": "A small island ferry terminal, off-season." }
  },

  "sources": [
    { "id": "src-script", "kind": "screenplay", "title": "The Last Ferry — draft 3",
      "anchors": [
        { "id": "sc-012-heading", "sceneHeading": "INT. FERRY TERMINAL - DAY", "page": 12 },
        { "id": "sc-012-action-004", "elementKind": "action", "page": 12 },
        { "id": "sc-013-action-001", "elementKind": "action", "page": 13 }
      ] }
  ],

  "story": {
    "scenes": [
      { "id": "sc-terminal", "narrativeOrder": 1, "title": "The waiting room",
        "synopsis": "MARA waits with a sealed courier case. The last ferry is delayed.",
        "tone": "Patient, then uneasy.", "tier": "A", "timeOfDay": "DAY",
        "sourceAnchors": ["sc-012-heading"] },
      { "id": "sc-pier", "narrativeOrder": 2, "title": "The pier",
        "synopsis": "Mara opens the case at the rail. What is inside is not what she was told.",
        "tone": "Quiet reversal.", "tier": "A", "timeOfDay": "DUSK",
        "sourceAnchors": ["sc-013-action-001"] }
    ]
  },

  "entities": {
    "characters": [
      { "id": "char-mara", "name": "Mara", "aliases": ["MARA"], "role": "lead",
        "description": "Late thirties. Weather-worn canvas coat, hair tied back. Carries herself like someone used to waiting.",
        "identityCues": "Canvas coat, hair tied back.",
        "states": [
          { "id": "st-mara-default", "name": "Coat on", "isDefault": true },
          { "id": "st-mara-soaked", "name": "Rain-soaked", "derivesFrom": "st-mara-default",
            "delta": "Coat darkened with rain; hair loose at the temples." }
        ],
        "tracking": { "presence": true, "state": true, "colour": false },
        "sourceAnchors": ["sc-012-action-004"] }
    ],
    "locations": [
      { "id": "loc-terminal", "name": "Ferry terminal waiting room",
        "description": "Twelve fixed benches, a departures board, tall salt-fogged windows facing the water.",
        "coverage": [
          { "id": "cov-master", "label": "Master establishing", "requirement": "required" },
          { "id": "cov-reverse", "label": "Reverse toward the doors", "requirement": "required" },
          { "id": "cov-window", "label": "Window detail", "requirement": "optional" }
        ],
        "states": [{ "id": "st-terminal-default", "name": "Off-season day", "isDefault": true }] }
    ],
    "props": [
      { "id": "prop-case", "name": "Courier case", "heroLevel": "hero",
        "description": "Grey polymer case, brass latches, a numbered seal across the seam.",
        "states": [
          { "id": "st-case-sealed", "name": "Sealed", "isDefault": true,
            "delta": "Seal intact and legible." },
          { "id": "st-case-open", "name": "Open", "derivesFrom": "st-case-sealed",
            "delta": "Seal cut; lid raised. Same case, same latches." }
        ],
        "tracking": { "presence": true, "state": true, "markings": true } }
    ]
  },

  "shots": [
    {
      "id": "sh-0100", "sceneId": "sc-terminal", "order": { "script": 1 },
      "title": "Mara waits",
      "action": "Mara sits on the third bench, the sealed case flat across her knees.",
      "intent": "Establish the wait, and that the case is never set down.",
      "framing": { "size": "wide", "angle": "eye", "movement": "static" },
      "staging": "Mara camera-left of centre; the departures board reads over her right shoulder.",
      "setting": { "locationId": "loc-terminal", "coverageId": "cov-master", "timeOfDay": "DAY" },
      "subjects": [{ "entityId": "char-mara", "role": "primary", "stateId": "st-mara-default" },
                   { "entityId": "prop-case",  "role": "featured", "stateId": "st-case-sealed" }],
      "duration": { "seconds": 6, "basis": "authored" },
      "frames": [
        { "id": "fr-a", "role": "first", "label": "A",
          "description": "Mara settled, case sealed across her knees.",
          "stateSelections": { "char-mara": "st-mara-default", "prop-case": "st-case-sealed" },
          "approvedAssetId": "asset-9f2c41ab77e0d3c58b16aa04ee9d1c2f" }
      ],
      "continuityIntent": { "prop-case": { "expected": ["seal intact"], "allowPresenceChange": "no" } },
      "status": { "production": "approved", "review": "passed" }
    },
    {
      "id": "sh-0110", "sceneId": "sc-terminal", "order": { "script": 2 },
      "title": "The board changes",
      "action": "The departures board flips. Mara looks up; the case does not move.",
      "framing": { "size": "medium", "angle": "eye", "lens": "85mm", "movement": "static" },
      "staging": "Clean single, board out of focus behind.",
      "setting": { "locationId": "loc-terminal", "coverageId": "cov-reverse" },
      "subjects": [{ "entityId": "char-mara", "role": "primary" }],
      "performance": [{ "entityId": "char-mara", "note": "Looks up before she reacts. No alarm yet." }],
      "duration": { "seconds": 4, "basis": "authored" },
      "frames": [{ "id": "fr-a", "role": "first", "label": "A", "description": "Mara mid-wait, eyes lifting." }],
      "status": { "production": "planned", "review": "pending" }
    },
    {
      "id": "sh-0200", "sceneId": "sc-pier", "order": { "script": 3 },
      "title": "She opens it",
      "action": "At the rail, Mara cuts the seal and raises the lid.",
      "intent": "The reversal. The case must read as the same object as sh-0100.",
      "framing": { "size": "close", "angle": "high", "movement": "static" },
      "setting": { "locationId": "loc-terminal", "timeOfDay": "DUSK" },
      "subjects": [{ "entityId": "char-mara", "role": "primary", "stateId": "st-mara-soaked" },
                   { "entityId": "prop-case",  "role": "primary" }],
      "duration": { "seconds": 5, "basis": "authored" },
      "frames": [
        { "id": "fr-a", "role": "first", "label": "A", "description": "Sealed case on the rail, hands entering.",
          "stateSelections": { "prop-case": "st-case-sealed" } },
        { "id": "fr-b", "role": "last",  "label": "B", "description": "Lid raised. Seal cut and hanging.",
          "stateSelections": { "prop-case": "st-case-open" } }
      ],
      "motion": [{ "id": "mo-a", "kind": "first-last", "fromFrameId": "fr-a", "toFrameId": "fr-b",
                   "seconds": 5, "direction": "Hands cut the seal and raise the lid. Camera static." }],
      "continuityIntent": { "prop-case": { "expected": ["seal cut", "lid open"], "allowStateChange": true } },
      "relations": [{ "kind": "bookend-of", "targetShotId": "sh-0100",
                      "note": "Same case, same latches. sh-0100 must lock first." }],
      "status": { "production": "planned", "review": "pending" }
    }
  ],

  "assets": [
    { "id": "asset-9f2c41ab77e0d3c58b16aa04ee9d1c2f", "mediaType": "image",
      "storage": { "path": "media/shots/sh-0100/fr-a-approved.png", "bytes": 2214870 },
      "contentHash": "sha256:4c1f…", "hashState": "hashed", "source": "generated",
      "provenance": { "tool": "MiniMax H3", "modelVersion": "h3-1.0",
                      "createdAt": "2026-08-08T19:22:04Z",
                      "inputs": ["asset-2b7d90f1cc4e11a6b0d3ff5581ae7c34"], "seed": 44117 } },
    { "id": "asset-2b7d90f1cc4e11a6b0d3ff5581ae7c34", "mediaType": "image",
      "storage": { "path": "media/entities/char-mara/front.png" },
      "contentHash": null, "hashState": "unhashed", "source": "uploaded" }
  ],

  "references": [
    { "id": "ref-001", "subject": { "type": "entity", "id": "char-mara" },
      "assetId": "asset-2b7d90f1cc4e11a6b0d3ff5581ae7c34",
      "purpose": "identity-front", "approved": true, "order": 0 },
    { "id": "ref-002", "subject": { "type": "frame", "id": "sh-0100/fr-a" },
      "assetId": "asset-9f2c41ab77e0d3c58b16aa04ee9d1c2f",
      "purpose": "frame-approved", "approved": true, "order": 0 }
  ],

  "statements": [
    { "target": "/entities/characters/char-mara/name", "status": "source-derived",
      "sourceId": "src-script", "anchors": ["sc-012-action-004"] },
    { "target": "/entities/characters/char-mara/description", "status": "inferred",
      "by": { "kind": "model", "name": "project-builder" }, "at": "2026-08-01T09:14:00Z",
      "note": "Wardrobe and hair are not described in the screenplay." },
    { "target": "/shots/sh-0110/framing/lens", "status": "inferred",
      "by": { "kind": "model", "name": "project-builder" }, "at": "2026-08-01T09:14:00Z",
      "note": "Suggested during planning; not a director decision." },
    { "target": "/shots/sh-0100/framing/size", "status": "approved",
      "by": { "kind": "human", "name": "Director" }, "at": "2026-08-03T16:20:00Z" },
    { "target": "/shots/sh-0200/setting/locationId", "status": "conflicting",
      "note": "Scene heading says EXT. PIER; the shot is bound to loc-terminal. Resolve before generation." }
  ],

  "extensions": {
    "com.cinebraid.workflow": {
      "version": "1",
      "readyForEdit": { "sh-0100": true },
      "promptDefaults": { "imageProfile": "gpt-image-2/t2i", "videoProfile": "minimax-h3/i2v" }
    }
  }
}
```

Note what the example demonstrates: Mara's *name* is a source fact, her *coat* is an inference, the 85mm lens is an inference, the wide on sh-0100 is an approved decision, and the pier/terminal mismatch is an unresolved conflict — none of which is expressible today.

---

# PART 26 — PROPOSED OFP CORE

| Concept | CineBraid canonical? | OFP core? | OFP optional extension? | CineBraid extension? | Runtime/sidecar only? | Why |
|---|---|---|---|---|---|---|
| Project metadata (title, format, aspect) | ✅ | ✅ | | | | Every film tool needs it |
| Format/version block | ✅ | ✅ | | | | The compatibility contract |
| Source documents + anchors | ✅ | ✅ | | | | Traceability is meaningless without a target |
| Scenes | ✅ | ✅ | | | | Universal |
| Shots (intent, framing, staging, action, dialogue) | ✅ | ✅ | | | | The heart of the format |
| Shot relations (bookend/derives-from/fallback) | ✅ | ✅ | | | | Real production relationships; today prose-only |
| Ordering (`narrativeOrder`, `order.script`) | ✅ | ✅ | | | | Must not depend on array position |
| Entities (character/location/prop/vehicle) | ✅ | ✅ | | | | Universal |
| Entity coverage slots | ✅ | | ✅ (bible profile) | | | Meaningful beyond AI, but not universal |
| Continuity states + `derivesFrom` | ✅ | | ✅ (continuity profile) | | | CineBraid's differentiator; genuinely portable |
| Continuity **intent** on shots/frames | ✅ | | ✅ (continuity profile) | | | Declared expectation is production truth |
| Continuity **observations** | ✅ | | ✅ (continuity profile, optional) | | ✅ preferred | Derived evidence; large; regenerable |
| Continuity **findings** | ❌ store | | | | ✅ | Always derived — never persist |
| Media asset identity (`assetId`, path, hash) | ✅ | ✅ | | | | Without it "portable" is a lie |
| References (subject → asset → purpose) | ✅ | ✅ | | | | The `C:\…\foo.png` problem |
| Approvals | ✅ | ✅ | | | | Which take is the film |
| Blocking frames | ✅ | | ✅ (shot-planning) | | | Previs-adjacent, not universal |
| First/last frame semantics | ✅ | ✅ | | | | `frame.role` is core |
| Evidence statements (canon vs inference) | ✅ | ✅ | | | | The stated design problem; must be core or it will be ignored |
| Generation provenance (tool, model, seed, inputs) | ✅ | | ✅ (generative profile) | | | Portable and valuable; must not be mandatory |
| **GenerationJob transport state** | ❌ | ❌ | ❌ | ❌ | ✅ | FAL request IDs, retries, concurrency |
| **Provider credentials** | ❌ | ❌ | ❌ | ❌ | ❌ **never serialised** | Already correctly isolated in `data/config.json` |
| UI state / active selection | ❌ | ❌ | | ✅ if needed | ✅ preferred | Not production truth |
| Automation runs / steps / leases | ❌ | ❌ | | ✅ | ✅ | Orchestration |
| Ready-for-Edit | ✅ (derived) | ✅ as a *rule*, not a stored flag | | ✅ cached | | Compute from core; cache in the extension |
| Project-local model preferences | ❌ | ❌ | | ✅ | | `promptDefaults`, `stillModel`, `videoModel` |
| Prompt builds / compiled packages | ❌ | ❌ | | ✅ | ✅ | Provider payloads; keep the *fact* of generation in provenance, not the payload |
| `qcChecklist` | ✅ | | ✅ (bible) | | | Genuinely useful; must not be a defaulted five |

---

# PART 27 — MIGRATION MATRIX

| From | To | Deterministic? | Data loss? | Human review? | Migration version | Test fixture | Notes |
|---|---|---|---|---|---|---|---|
| no `schemaVersion` (anchor-hub v1–v3) | `1.0` | Partly | Risk | **Yes** | M001 | `overfit-anchorhub-v1` | Sniff by shape; `hubVersion` is the only hint |
| `meta.version` = film draft (`"v2.1"`) | `meta.draft` | ✅ | No | No | M002 | overfit-* | Stop overloading `version` |
| `meta.version` = app version (`"6.6.4-studio.2"`) | drop → `format.generator.version` | ✅ | No | No | M002 | `cinebraid-sample` | |
| `meta.hubVersion` | drop | ✅ | No | No | M002 | all | Superseded by `format.version` |
| `dur` / `duration` / `sec` | `duration.seconds` + `basis` | ✅ | **Currently losing** (F2) | No | M010 | `sample-duration-alias` | Prefer any present value over the engine default; `basis:"derived"` when synthesised |
| `block` / `notes` / `description` / `creationDescription` / `visualDescription` | `description` + `identityCues` | ⚠ | **Possible** if two differ | **Yes when ≥2 non-empty differ** | M011 | `overfit-entity-prose` | Never concatenate silently; emit a review item |
| `codes[]` | `subjects[]` + `setting.coverageId` + `references[]` | ❌ | **Yes today** | **Yes** | M020 | **`overfit-codes`** | 28/45 Overfit tokens ambiguous; propose a mapping, require confirmation |
| `characters[]` on shot | `subjects[]` | ✅ | No | No | M020 | all | |
| `status` + `workflowStatus` + `reviewStatus` | `status.{production,review}` | ✅ | No | No | M012 | `overfit-status` | `workflowStatus` wins; `status` is the pre-6.x fallback |
| `winner` (shot) | `frames[0].approvedAssetId` | ✅ | No | No | M013 | `overfit-single-winner` | Already an adapter today |
| `keyframes[].winner` + `.selectedCandidate` | `approvedAssetId` + `candidateAssetId` | ✅ | No | No | M013 | `sample-frames` | |
| `creationBrief.frames[]` / `frameWorkflows{}` | merged into `frames[]` | ⚠ | Possible | **Yes on divergence** | M014 | `sample-creationbrief` | Three stores of one selection |
| `coverageSlots.required` + `requirement` | `requirement` enum | ✅ | No | No | M015 | `sample-coverage` | |
| continuity state `description`/`stateDelta`/`changeOnly`/`instructions` | `delta` | ✅ | No | No | M016 | `overfit-states` | Legacy telemetry already counts these |
| `approvedFile` (bare filename) | `assets[]` + `references[]` | ⚠ | **Yes if file missing** | **Yes on miss** | M030 | `overfit-assets` | Resolve by directory convention; mint `assetId`; unresolved → `hashState:"unavailable"` + review item |
| `shots/<shotId>/…` directories | `assets[].storage.path` | ✅ | No | No | M030 | `overfit-media-tree` | Do **not** move files in v1 |
| `P.mediaAssets[]` (library) | `assets[]` + `references[]` | ✅ | No | No | M031 | `blocking-ingest` | Two models collapse into one |
| `atomic`/`parentShot`/`fallbackFor` (pre-v5) | `relations[]` | ✅ | Recovers lost data | No | M021 | **`overfit-anchorhub-22`** | Restores information dropped between generations |
| prose dependencies in `notes`/`risks` | `relations[]` | ❌ | Stays as prose | **Yes** | M022 | `overfit-prose-deps` | Suggest, never auto-apply |
| `[INFERRED FOR PLANNING]` prose | `statements[] status:"inferred"` | ⚠ | Marker text preserved | Recommended | M040 | `import-inferred` | Target the containing field; keep the prose |
| `[SOURCE CONFLICT]` prose | `statements[] status:"conflicting"` | ⚠ | Preserved | **Yes** | M040 | `import-conflict` | |
| `scene.continuityReview` | extension / drop | ✅ | Derived | No | M041 | `scene-review` | Regenerable |
| `scene.continuityReviewSettings.expectedChanges` (prose) | `continuityIntent.expected[]` | ⚠ | No | **Yes** | M042 | `scene-expected` | One line → one expectation; needs confirmation |
| `stillModel`/`videoModel`/`promptDefaults`/`models` | `extensions["com.cinebraid.workflow"]` | ✅ | No | No | M050 | all | Out of core |
| `promptBuilds`/`generationPackages`/`promptBuildsById`/`promptSnapshotsById` | CineBraid extension; distil to `asset.provenance` | ⚠ | Payloads dropped by design | No | M051 | `overfit-packages` | Keep tool/model/seed/inputs; drop the payload |
| `jobs[]`, `finishJobs[]`, `agentRuns[]`, `decisions[]` | drop (`decisions` → `statements` if populated) | ✅ | No | No | M052 | all | Dead or runtime |
| `qcChecklist` = the `BLANK()` five | drop if byte-identical to default | ✅ | No | No | M053 | `sample-qc` | Don't ship a default as canon |
| NFSpy `New Project*.json` | **not migrated** | — | — | — | — | — | Different application |

### Migrations required for Overfit specifically
Taking `CINEBRAID_v5.8.1/projects/the-overfit` as the newest snapshot: **M001, M002, M010, M011, M012, M013, M016, M020, M021, M030, M050, M051, M052.**
Of these, **M011 (entity prose)**, **M020 (`codes[]`)** and **M030 (asset resolution)** cannot complete without human review. M021 should also be run against `anchor-hub-22` to *recover* `atomic`/`parentShot`/`fallbackFor` that later generations dropped.

**Do not execute any of this. Do not modify Overfit.** Produce a sanitised derivative (rename the film, characters, locations; keep structure, ID shapes, `codes[]` patterns and reference counts) as the golden fixture, so tests never depend on private production data.

---

# PART 28 — SCHEMA GOVERNANCE RECOMMENDATION

1. **One canonical JSON Schema per profile**, in-repo, versioned: `schema/ofp-core-1.0.json`, `schema/ofp-continuity-1.0.json`, etc. The current single `CINEBRAID_PROJECT_SCHEMA_v6.5.3.json` is already stale relative to `schemaVersion 6.7`; that must become impossible.
2. **Handwritten semantic validator, schema-driven structural validator.** JSON Schema catches shape; a hand-written pass catches reference integrity, exactly-one-default-state, ordering uniqueness, and dangling asset IDs. `validateMediaAsset` in `media-assets.js` is the model — typed error codes (`field`, `code`, `message`), not strings.
3. **The validator must run server-side.** Today the only comprehensive normalizer is in `public/app.js`. Move the contract to a shared module that both `server.js` and the browser require — exactly how `shared-continuity.js` and `shared-entities.js` already work.
4. **Examples validated in CI.** Every example in the docs and every fixture must validate on every commit.
5. **Golden fixtures**: sanitised Overfit at three generations (anchor-hub v1, v5.8.1, current 6.7), plus the shipped sample.
6. **Round-trip test**: `load → normalise → save` must be **byte-identical** for a current-version project. `normalizeProjectV5`'s existing "a load must still leave a current file byte-identical" doctrine is right; make it a test, at the format boundary.
7. **Semantic invariant tests**, e.g.: every `subjects[].entityId` resolves; every `assetId` referenced exists; exactly one default state per entity; no two shots share `order.script` within a scene; no `references[]` points at a missing asset without `hashState:"unavailable"`.
8. **Schema changelog** at `schema/CHANGELOG.md`, one entry per version, naming the migration ID.
9. **Version bump rules:**
   - **No bump**: docs, field descriptions, error wording, filenames, new *optional* extension.
   - **Minor bump**: new optional core field; new profile; widened enum where readers already tolerate unknowns.
   - **Major bump**: any field whose *persisted meaning* changes; removing a field; narrowing an enum; changing identity or reference semantics.
   - A rename is a **major** change, because a reader keyed on the old name silently sees absence.
10. **Extension registry** in-repo: `schema/extensions.md`, one row per namespace with owner and version.
11. **Deprecation rule**: a field is deprecated for **one major version** with an active reader and a migration, and only then removed. The existing `reportsLegacyCompatibilityUsage()` telemetry is the right gate — migrate representative projects, resave, verify the count reaches zero, then delete.

---

# PART 29 — OPEN FORMAT GOVERNANCE QUESTIONS

*Note: a substantial prior strategy document exists outside the repository at* `C:\Users\calef\OneDrive\Desktop\OPEN_FILM_FORMAT_INITIATIVE_STRATEGY_2026-08-07.md` *(profiles, evidence model, source anchoring, relationships to MovieLabs OMC, MovieLabs Creative Vocabulary, OpenTimelineIO, Fountain, JSON Schema). This audit is consistent with its design principles §7.1–7.9 and reaches the same conclusions independently from repository evidence. **This is external evidence, clearly separated from repository findings.***

- **Should the spec live separately?** Eventually yes — but not first. Extract the spec only after CineBraid has shipped one full load/save cycle through the canonical contract. A spec with no conformant implementation attracts no one.
- **Should CineBraid be the reference implementation?** Yes, and it should say so explicitly. The risk is CineBraid's convenience quietly becoming the definition; the mitigation is the conformance suite below, which CineBraid must pass without privileged knowledge.
- **Vendor extensions**: reverse-DNS namespaces (`com.cinebraid.workflow`, `org.openfilm.editorial`), declared in `format.extensions` with a version. Unknown extensions must round-trip untouched. An extension may never redefine a core field's meaning — a conformance test should assert that removing every extension leaves a valid, coherent project.
- **Backwards compatibility communication**: the changelog plus a machine-readable `minimumReaderVersion` per profile. A reader seeing a major version above its own must refuse to *write* while still being allowed to *read* and *report*.
- **Public fixtures**: yes. Neutral, invented content only. The sanitised Overfit derivative is well suited; the real one is not.
- **Conformance tests**: yes, and they are the main defence against CineBraid privately changing meaning. Three levels: structural (schema), semantic (reference integrity), behavioural (round-trip preservation of unknown extensions and unknown enum values).
- **The one specific hazard to guard**: statements/evidence semantics. It is the newest idea and the easiest to bend. Freeze the six-value status vocabulary early and require a major version to change it.

**Do not create a repository for this yet.**

---

# PART 30 — DECISION LOG

**1. Is current `project.json` salvageable as the basis for the canonical format?**
**Yes — as the source of the object model, no — as the document shape.** The domain concepts (scenes, shots, entities, continuity states with `derivesFrom`, coverage slots, tracking, intent) are good and hard-won. The document is not: three duration aliases, three status fields, three frame stores, five description fields, an undeclared union namespace, runtime state and provider preferences interleaved with production truth. Keep the ontology, re-cut the document.

**2. Should canonical CineBraid semantics and OFP core initially be the same model?**
**Yes — same model, layered, from day one.** Build the canonical CineBraid project *as* OFP core + profiles + one `com.cinebraid.*` extension. Two models maintained in parallel will diverge within a release. The layering is what keeps CineBraid from being awkward: anything that would distort the core goes in the extension.

**3. Should Project Builder return canonical project JSON or an import envelope?**
**An envelope around a canonical payload (model B).** The payload must be canonical project JSON — do not fork scene/shot/entity semantics into a second schema. The envelope carries what does not belong in the project permanently: source document registration, per-field inference/conflict claims, confidence, and importer warnings. On commit, the envelope's claims become `statements[]` and the warnings are discarded. This is the smallest change that stops import review findings from being thrown away.

**4. Should sidecars remain separate?**
**Yes.** The boundary is already correct and well-reasoned. Add one rule: every sidecar carries a schema version (`generation-jobs.json` currently has none), and no sidecar is required to open a project.

**5. Should execution/job state remain outside OFP?**
**Yes, absolutely.** FAL request IDs, retries, leases, concurrency and endpoints never enter the portable document. Also move `P.jobs[]`, `P.finishJobs[]`, `P.agentRuns[]` out — they are validated today and effectively dead.

**6. How should IDs work?**
- **Document-local, stable, opaque-ish, human-readable.** `sh-0100`, `char-mara`, `st-case-open`, `asset-<32hex>`.
- **Never** filenames, display names, array positions or paths. Renaming "The Warehouse" → "Abandoned Warehouse" must change only `name`.
- **Names are not identity**; `aliases[]` carries former names.
- Asset IDs use the existing 128-bit random `asset-<32hex>` scheme (collision is an assertion, not a branch) — already implemented in `media-assets.js`.
- Cross-project portability: a **document-local ID plus an optional `projectId` (UUID) in `meta`** is enough. Do not mint globally unique IDs for every object — it hurts readability and merge, and the qualifying pair `(projectId, localId)` is already globally unique.
- On import/merge, ID collisions are resolved by remapping the incoming document and recording the old ID in `aliases[]`; dangling references become `statements[] status:"conflicting"`, never silent drops.
- **Legacy IDs are preserved verbatim** where valid — Overfit's `L0-01`, `KAI`, `PROP-SPOON` must survive migration unchanged.

**7. How should canon vs inference work?**
**A sparse `statements[]` array keyed by JSON Pointer**, with six statuses: `source-derived`, `observed`, `inferred`, `approved`, `conflicting`, `unspecified`. Not a wrapper on every value. Rule: **an `inferred` value is a proposal until an `approved` statement exists.** Ready-for-Edit requires no unresolved `inferred`/`conflicting` statement on any field a shot depends on. Retire `[INFERRED FOR PLANNING]` prose markers, but preserve their text during migration.

**8. How should continuity intent vs observation vs finding be represented?**
Three separate things, and the current design almost gets there already:
- **Intent** → core, on shot/frame/entity (`continuityIntent`, `stateSelections`, `tracking`). Production truth.
- **Observation** → sidecar, content-addressed, optional profile. Evidence, regenerable.
- **Finding** → **never stored.** Always derived from intent + observation.
- **Human acceptance of a finding** → a small durable record on the shot.
Move `scene.continuityReview` (analysis output) out of the scene, and `continuityReviewSettings.expectedChanges` (prose) into structured `continuityIntent.expected[]`.

**9. How should assets/references work?**
**Adopt the dormant MediaAsset design as-is; do not invent a third model.** Logical `assetId`, project-relative `storage.path` (already enforced by `isProjectRelativePath`), nullable `contentHash` with the retention rule, `hashState` including `unavailable`. Add a separate `references[]` edge: `(subject, assetId, purpose, priority, order, approved)`. That makes *"this shot refers to this asset for this purpose"* expressible with no machine path. Collapse `P.mediaAssets[]` into it. **Do not activate the ledger during the audit or before the format work; activate it as part of P4.**

**10. How should project schema versioning work?**
- `format.version` = `MAJOR.MINOR`, **decoupled from the application version.** CineBraid 9.4.2 may write OFP 1.3. `release-identity.js` already documents this; make it structural.
- Minor = additive and readable by an older reader. Major = persisted meaning changed.
- **Forward compatibility**: unknown fields and unknown extensions round-trip untouched; unknown enum values are preserved and reported, never coerced.
- **Newer-than-supported**: **open read-only, refuse to write, say so plainly.** This behaviour does not exist today and is a real data-loss exposure.
- **Downgrade**: not supported. Export-to-older is an explicit, lossy, reported operation — never a silent save.
- Extensions version independently in `format.extensions`.
- Retire `meta.version`, `meta.hubVersion`, `meta.v5`, `meta.promptHistoryVersion` into the one `format` block; keep `meta.schemaMigrations` as the applied-migration ledger.

**11. How should legacy migrations work?**
Explicit, ordered, numbered, individually testable steps (M001…), each with an ID, a `from`/`to`, a pure function, a fixture and a report. Pipeline:
`load → identify (sniff shape when no marker) → validate enough to identify → snapshot → migrate a COPY in memory → validate target → produce report → atomic commit → retain recovery evidence.`
Chained (v1→…→current) rather than one giant jump; idempotent; restart-safe; a failure halfway leaves the original untouched. Record each applied migration in `meta.schemaMigrations` (extending the existing pattern). **Never rewrite the only copy before the target validates.** Migrate sidecars in the same transaction. A corrupt legacy project fails loudly — `inspectProjectFile` already does this correctly and must not be softened.

**12. Should migrations happen automatically or through explicit user action?**
**Explicit, and this is the highest-priority behavioural change in the report.**
Today, opening a project silently mutates it — `normalizeReferenceCoverageData()` *clears approved coverage files* on load. That is a destructive migration disguised as a read.
Recommendation: on open, CineBraid detects the older format and says so —
> *"This project was created with an older CineBraid project format. CineBraid needs to upgrade a copy before editing."*
— then upgrades a copy, shows the migration report (what changed, what needs review, what could not be mapped), and only writes on confirmation. The original stays untouched and recoverable. Read-only viewing of an un-migrated project should remain possible.

**13. How should Overfit be migrated/tested?**
Never in place. Sequence: copy the v5.8.1 snapshot to a sandbox → produce a **sanitised derivative** (renamed film/characters/locations, structure and `codes[]` patterns preserved) → commit *that* as the golden fixture → run the full chain → assert entity/shot/scene counts, that all 45 dependency tokens are either mapped or flagged (**zero silent drops**), and that no prose note is lost. Additionally run M021 against `anchor-hub-22` to recover `atomic`/`parentShot`/`fallbackFor`. The real Overfit is migrated last, by hand, with the report reviewed.

**14. Which current structures should be deprecated?**
Immediate: `meta.version`, `meta.hubVersion`, `shot.duration`, `shot.sec`, `shot.status` (in favour of `workflowStatus`), `shot.winner`, `coverageSlots.required`, continuity-state note aliases, `P.jobs[]`, `P.decisions[]`, `P.finishJobs[]`, `qcChecklist` when identical to the `BLANK()` default.
Next: `codes[]` (after M020), `creationBrief.frames[]`/`frameWorkflows{}` (after M014), the `block`/`notes`/`creationDescription`/`visualDescription` cluster (after M011), `scene.continuityReview`, `scene.continuityReviewSettings`, `stillModel`/`videoModel` (to the extension), `P.mediaAssets[]` (into `assets[]`).

**15. What belongs in OFP core?**
Project metadata, format block, source documents + anchors, scenes, shots (intent/framing/staging/action/dialogue/duration), shot relations, explicit ordering, entities, approvals, first/last frame roles, asset identity, references, and **evidence statements**. Small enough to implement in a weekend; complete enough to describe a film.

**16. What must remain a CineBraid extension?**
Prompt builds and compiled packages, prompt/model defaults, per-shot model preferences, automation configuration, cached Ready-for-Edit, coverage automation bookkeeping, UI/workflow flags, candidate review labels and automation reports.

**17. What should NEVER be serialised into an OFP project?**
API keys, OAuth tokens, `authSecret`, passcodes, account credentials, machine hostnames, absolute paths (Windows or POSIX), `localhost` endpoints, provider base URLs, temp/cache paths, FAL request IDs, retry/lease state, and any per-machine configuration. Enforce with a **hard export-time scanner** modelled on the existing `scripts/scan-secrets.js` and `CONFIG_SECRETS` registry — a failing scan blocks the write, it does not warn.

**18. Is a single JSON file sufficient as the semantic format?**
**Yes for the semantic model; no for the package.** Separate them explicitly:
- **Manifest**: one JSON document — the complete semantic model. `project.ofp.json`.
- **Package**: manifest + `media/` directory (`project.ofp/`), optionally zipped (`project.ofp.zip`).
The manifest must be valid standalone with assets marked `unavailable`. Caveat from measurement: real projects run **4.8–8.3 KB per shot** in `project.json` today (Overfit: 106 KB / 22 shots), so a 1,000-shot feature is a 5–8 MB document under a **whole-document save**. The single-file model is right; the whole-document save is not, and P4 should address it.

**19. What should the first canonical schema version be?**
**`1.0`.** Not `6.8` and not `0.1`. `6.x` inherits the app-version confusion this whole exercise exists to end; `0.x` signals instability to any external adopter. `format.version: "1.0"` with `format.id: "open-film-project"`. The final legacy CineBraid marker is `schemaVersion 6.7`, and M001 is defined as `6.7 → 1.0`.

**20. What should we implement FIRST after this audit?**
**Not the schema.** Three things, in this order, before any format work:

1. **Fix the two proven silent losses** (F1 and F2) — a filmmaker's `creationDescription` never reaching the image prompt, and `duration` being defaulted away in the shipped sample. These are live, today, in the shipped product, and they violate the core invariant the format is meant to protect. They are small fixes and they are the strongest argument for doing the rest.
2. **Make `codes[]` resolution honest** — when a token resolves by prefix and the suffix is discarded, or resolves to nothing, emit a readiness issue. Do not change the behaviour yet; just stop it being silent. This turns Overfit's 31 invisible losses into 31 visible ones.
3. **Stop load-time destructive normalization** — `normalizeReferenceCoverageData()` must not clear approved files during a read. Gate it behind explicit migration.

Then P0 (freeze architecture) can begin on a codebase that is no longer losing data while you design.

---

# PART 31 — RISK REVIEW (challenging the proposal above)

| # | Risk | Assessment | Mitigation |
|---|---|---|---|
| R1 | **`statements[]` becomes bloat** | Real. An enthusiastic importer could emit one per field, tripling document size. | Cap statements per import; only emit for inference, citation, approval and conflict. Add a lint: >1 statement per 3 fields is a warning. Statements are always droppable. |
| R2 | **JSON Pointer targets rot** | Real and serious. Renaming an ID orphans every pointer at it. | Pointers use **IDs, never array indices** (`/shots/sh-0100/...`, not `/shots/0/...`). Validator flags unresolvable targets. Reject index-based pointers at write time. |
| R3 | **Overengineering / premature generalization** | Genuine risk in `sources[]` + `statements[]` + `references[]` for a user who imports no script and generates nothing. | All three are **optional and empty by default**. A hand-built project is `format` + `meta` + `story` + `shots` + `entities`. Test that fixture explicitly. |
| R4 | **Accidental database design** | `assets[]`/`references[]` normalisation makes the document less readable. | Keep `subjects[]` and `frames[]` inline on the shot (denormalised, readable); normalise only assets, where identity genuinely requires it. Never normalise prose. |
| R5 | **Migration trap: `codes[]` is unresolvable** | Confirmed: 28/45 Overfit tokens ambiguous. | Do not guess. Propose a mapping, require confirmation, and **fail loudly rather than drop**. Zero-silent-drop is a test assertion. |
| R6 | **Performance: 5–8 MB documents** | Measured, not hypothetical. Whole-document parse + browser normalise + whole-document write. | Keep the single manifest as the *interchange* form; give CineBraid an internal incremental save (per-shot patch with the existing ETag concurrency). Do not solve this in the format. |
| R7 | **Impossible round trip** | If CineBraid drops unknown extensions on save, every other tool's data dies. | Round-trip conformance test with a synthetic unknown extension and an unknown enum value. This is the single most important test in the suite. |
| R8 | **Ambiguous null semantics** | Today `""` means four things. | `null` = never set. Omitted = not applicable to this profile. Explicit `"unspecified"` **only** where production distinguishes it (`duration.basis`, `framing.lens`). Do not add `unspecified` everywhere. |
| R9 | **IDs that won't survive interchange** | Document-local IDs collide on merge. | `(projectId, localId)` qualification; remap-with-alias on import; never silently overwrite. |
| R10 | **Inability to merge projects** | Two editors, one film. | ID-keyed collections (not positional), explicit `order` integers, append-only `statements[]`. Full merge is out of scope for 1.0 but must not be *designed out*. |
| R11 | **Too CineBraid-specific for OFP** | `coverageSlots`, `tracking`, `qcChecklist`, `tier` are CineBraid vocabulary. | All in profiles, none in core. Core must validate with every profile stripped. |
| R12 | **Too AI-specific** | `blocking-guide`, `frame-candidate`, `derive` states read as generative-only. | Reframe in production language: blocking frames are previs; continuity states are wardrobe/set-dressing continuity, which is a century old. Generative provenance is its own optional profile (matching the prior strategy's §7.8). |
| R13 | **Traditional filmmaking concepts omitted** | Currently absent: **timecode, slate/scene-take numbering, shooting order, day/night + INT/EXT as structure, script pages/eighths, cast numbers, unit, sound roll**. | Accept for 1.0 but **reserve the names** and document the omission. Do not repurpose these terms for other meanings. |
| R14 | **AI concepts conventional standards don't capture** | Seed, model version, first/last-frame interpolation, reference-image conditioning, candidate/take distinction for non-linear generation. | This is OFP's genuine contribution. Keep it in the generative profile and be precise. |
| R15 | **Provenance bloat** | Storing full prompt payloads per asset would dwarf the film. | `asset.provenance` keeps tool, model, version, inputs, seed, timestamp, derivation — **not** the payload. Payloads stay in the CineBraid extension. |
| R16 | **LLMs will produce this incorrectly** | Highest-frequency error modes: inventing IDs that don't resolve; emitting `statements[]` for everything or nothing; confusing `frames[]` with `motion[]`; omitting `order`. | Envelope validation with typed errors and a retry loop (the existing import validator already does this well); a minimal example in the kit; keep required fields few; make `order` derivable from array position **at import only**, then materialised. |
| R17 | **Pleasant for JSON Schema, unpleasant for filmmakers** | `statements[]` with JSON Pointers is developer-shaped. | Filmmakers never see it. The UI shows "Suggested by AI — approve?" badges. If the UI can't render a construct plainly, the construct is wrong. |
| R18 | **Works for 10 shots, fails on a feature** | Overfit is 22 shots; a feature is 1,000–2,000. | Test fixture at 1,500 shots. Validate parse, normalise, validate and save timings before freezing. R6's incremental save is the dependency. |
| R19 | **The evidence model is the newest idea and least proven** | It is the part most likely to be wrong. | Prototype `statements[]` against the real Overfit import **before** freezing 1.0. If it doesn't earn its place there, cut it to `inferred` + `approved` only. |
| R20 | **Two schemas diverge (CineBraid vs OFP)** | The classic failure of this exact project. | Decision 2: one model, layered. Enforced by a CI test that CineBraid's own save output validates against unmodified OFP core + declared profiles. |

---

# PART 32 — IMPLEMENTATION PLAN (proposed; nothing implemented)

### P-1 — Stop the bleeding *(before any format work)*
- **Purpose**: the product is losing director intent today.
- **Files**: `prompt-engine.js` (entity canon resolution, duration read), `public/shared-entities.js` (+ readiness reporting), `public/app.js` (gate destructive coverage normalization), `server.js` (`projectReadinessIssues`).
- **Migrations**: none.
- **Tests**: F1 regression (`creationDescription` reaches the compiler); F2 regression (`duration`/`sec` honoured, `basis` reported); `codes[]` reinterpretation emits a readiness issue; load-of-current-project is byte-identical.
- **Data-safety gate**: no project file may change on open.
- **Browser gate**: shot workspace and entity workspace render unchanged.
- **Stop condition**: shipped sample `SAMPLE-03` reports 4s; Overfit fixture reports 31 visible issues instead of 0.

### P0 — Freeze architecture
- **Purpose**: agree this report's decisions; nothing else proceeds until §30 is settled.
- **Deliverable**: signed decision log; reserved-terms list (R13); the six-value statement vocabulary.
- **Stop condition**: Decisions 2, 3, 7, 12 and 19 explicitly accepted or amended.

### P1 — Canonical schema + validation (no persistence change)
- **Files**: new `schema/ofp-*.json`; new shared `project-contract.js` (Node + browser, like `shared-continuity.js`); `server.js` validation wiring.
- **Migrations**: none — validator runs in **report-only** mode.
- **Tests**: schema self-validation; every example and fixture validates; typed error codes; round-trip preservation of unknown extensions/enums (R7).
- **Gate**: the validator must not reject any existing real project — including all 18 Overfit generations — without an explicit, reviewed reason.

### P2 — Migration framework
- **Files**: new `migrations/` (M001…), migration runner, report renderer; `server.js` open path.
- **Behaviour**: detect → snapshot → migrate copy → validate → report → confirm → atomic commit. **Explicit user action** (Decision 12).
- **Tests**: idempotency; interrupted-migration recovery; newer-than-supported opens read-only; corrupt legacy fails loudly; original untouched on every failure path.
- **Data-safety gate**: no path writes the original before the target validates.

### P3 — Legacy fixtures, including sanitised Overfit
- **Files**: `tests/fixtures/legacy/*`; sanitisation script (produces the derivative; never writes to `D:\Projects`).
- **Migrations**: M001–M053 exercised end to end.
- **Tests**: counts preserved; **zero silent drops**; every ambiguous mapping surfaces for review; M021 recovers `atomic`/`parentShot`/`fallbackFor` from `anchor-hub-22`.
- **Stop condition**: sanitised Overfit migrates with a complete report and no unreviewed loss.

### P4 — Load/save through the canonical contract
- **Files**: `server.js` (read/write path), `public/app.js` (normalizer retires), MediaAsset ledger **activated**, incremental save (R6/R18).
- **Migrations**: M030/M031 (assets) become live.
- **Tests**: 1,500-shot performance fixture; concurrency (existing ETag) under incremental save; media-rename pointer integrity.
- **Browser gate**: full workspace QA — shot, entity, continuity, review, reports.
- **Stop condition**: a current project round-trips byte-identically; a migrated project opens with no readiness regressions.

### P5 — Project Builder import envelope
- **Files**: `server.js` import path; `resources/project-builder/*` (prompt, template, schema, example) refreshed to the canonical payload.
- **Migrations**: M040/M042 (prose markers → `statements[]`).
- **Tests**: envelope validation; claims become statements; `clearUnsupportedBuilderClaims` still holds; malformed model output produces typed, retryable errors.
- **Stop condition**: an imported project can answer "which of these facts came from the script?" — the thing it cannot do today.

### P6 — Export / interchange
- **Files**: new export route (the current asymmetry — import exists, export does not); package writer; **hard secret/path scanner** (Decision 17).
- **Tests**: export → import round-trip preserves everything including unknown extensions; scanner blocks on a planted secret and on a planted absolute path.
- **Stop condition**: a project exports, moves to another machine, and opens with every reference intact.

### P7 — OFP specification extraction
- **Only after P6 ships.** Extract spec + conformance suite; publish neutral fixtures; keep CineBraid as the declared reference implementation.
- **Stop condition**: a deliberately naive second implementation can read the fixtures without CineBraid knowledge.

---

## HARD STOP

Nothing in this report has been implemented. No project file was edited, no schema changed, no migration run, no branch created, no `schemaVersion` bumped, the MediaAsset ledger was not activated, and Overfit was not touched. Every legacy project was read with `fs.readFileSync` from a scratchpad script outside the repository.

# CineBraid — OFP P4: semantic reconciliation of the UX-derived persistence requirements

**Status: ANALYSIS ONLY. Nothing here is implemented.**
No production code, no schema, no migration, no version marker was changed by the pass that produced this document.

| | |
|---|---|
| Baseline SHA | `d0285412572c079b1bb4ba09475d63d15aa89bfe` |
| Short SHA | `d028541` |
| Branch at baseline | `main`, equal to `origin/main`, working tree clean |
| Application version | `6.7.0-private.1` |
| OFP contract revision | `1.0-draft.1` (unchanged) |
| Latest merged B1 | PR #47 `e7f812e` (commit `042d973`, "Honor saved generation defaults in the paid frame and H3 dialogs") |
| Latest merged B2a | PR #48 `d028541` (commit `8dbeef9`, "Make candidate review honour declared state semantics") |
| This document's branch | `docs/p4-semantic-reconciliation` (documentation only) |

Naming note, settled below in §1.1: this document is filed under the `CINEBRAID_OFP_P{n}` convention used by the P0–P3 records rather than the `P4_SEMANTIC_RECONCILIATION` path the task suggested, because it is the fourth record in that series and belongs beside its predecessors.

---

## 1. What this pass found, in one page

The eight UX-derived requirements were traced against the frozen P0 contract, the P1 draft schema, the P2 migration framework and the P3 Overfit corpus. The headline result is that **the audit's eight headings are not eight schema features.** Measured against what already exists:

| | Requirement | Verdict |
|---|---|---|
| P4-1 | canonical coverage model | **Small OFP widening.** One enum on an existing record, plus coverage on `character`. Counts stay derived. |
| P4-2 | historical job cost | **No OFP change.** Cost is not part of a film's meaning. The contract to hold it already exists (`validateCostEstimate`) and the ledger to persist it already exists (`generation-jobs.json`). Nothing writes to either. |
| P4-3 | durable review decision | **No OFP change.** The record already exists — an `approved` statement with a human actor and `evidence.observationId`. P0 §5 case 6 designed exactly this. |
| P4-4 | immutable artefact identity | **Tiny OFP widening + activation.** Identity, content digest, location and display name are already four separate things across `ASSET`, the MediaAsset ledger and the legacy extension. Only `storage` on `ASSET` is missing, and only for export. |
| P4-5 | terminal candidate disposition | **No OFP change.** `deriveLifecycle()` already derives the five-value disposition and refuses to store it. One live defect makes rejection non-durable. |
| P4-6 | character ↔ voice | **No OFP change. Already frozen and already migrated.** P1 §14 settled the shape; M017 implements it. The duplication is entirely runtime-side. |
| P4-7 | canonical readiness | **No OFP change, by explicit design.** P0 §5 already defines Ready-for-Edit as derived. The problem is three divergent calculators, not a missing field. |
| P4-8 | per-frame continuity state | **The one genuine core widening.** The frame → shot → default rule is *already implemented and live* in CineBraid; OFP cannot represent any of it. |

**Reduction: eight requirements → five canonical primitives, of which three widen OFP core and two are consolidations that widen nothing.** Two further workstreams (cost, voice) leave OFP entirely. §16 states the final model.

The single most consequential finding is §9 (P4-8): the task brief describes per-frame state authority as a missing capability. It is not missing from the application — it is missing from the format. That inverts the work from "design a new relationship" to "canonicalise a proven one", and it materially lowers the risk of the only primitive that touches the shot record.

### 1.1 A naming collision that must be settled before any code

**`P4` already means something else in this repository, and the two meanings are not the same work.**

P1 §16, P2 §16 and P3 §14 all define P4 as **canonical persistence activation**: making INV-R2 and INV-R3 live behaviour, retiring `normalizeProjectV5`, switching runtime save and load, and activating MediaAsset. That is a plumbing phase with no new semantics.

The UX audit's `P4-1…P4-8` is a **semantic** input set. It shares a label and nothing else.

This matters practically, not cosmetically. Three of the primitives below (P4-A, P4-B, P4-C) are meaningless until documents are actually read and written canonically — you cannot migrate a `requirement` enum into a document nobody loads. So the roadmap P4 is a **hard prerequisite** of most of the audit P4, not a competing claim on the same slot.

**Recommendation:** keep `P4` for the frozen roadmap meaning (canonical persistence) and label this work **`P4-SEM`**, with primitives `P4-SEM-A` … `P4-SEM-E`. Every reference below uses that form. The alternative — renumbering the audit set — would falsify the UX audit's own record, which is the mistake P1 §17.4 already refused to make once.

---

## 2. Invariants P4-SEM must respect

Traced to owning source rather than restated from the brief. Every row was verified in code or in a test, not inferred from a document.

| Invariant | Owner / source | How enforced today | Tests / goldens | P4-SEM risk |
|---|---|---|---|---|
| **Opening a project writes nothing** (INV-R1) | P0 §8 `CINEBRAID_P0_ARCHITECTURE_DECISION_2026-08-09.md:426`; `ofp/ofp-fs-guard.js` | An `fs` wrapper asserts zero writes under the project root; hash + mtime compared before/after | `tests/ofp-read-invariant.js` (ten document classes, plus proof the guard is armed) | **High.** Every primitive adds a field that a loader will be tempted to default at load. P0 §8 rule 1 — *defaults are applied at use, never at load* — is the rule that breaks first. |
| **Migration is explicit and deterministic** | P0 §8 INV-R2; P2 framework | `ofp/ofp-migrate.js` + 30+ rules in `ofp-migrate-rules.js`; no migration runs on open, save, import or startup | `tests/ofp-migration.js`, `tests/ofp-overfit-conformance.js`, 18 pinned goldens under `tests/fixtures/ofp-migration/overfit/goldens/` | Medium. New rules must be deterministic and must be added to the frozen rule-ID space. |
| **Source is untouched during preview/migration** (R2.6) | P0 §8 | The migrator operates on a parsed copy; `scripts/preview-ofp-migration.js` writes nothing | Overfit corpus is asserted byte-identical after the run | Low. |
| **No silent field loss** (R2.3) | P0 §8 R2.3; P2 disposition model | Every source key is `MAPPED`, `PRESERVED`, `STATED`, `DROPPED` or `QUARANTINED` **by a named rule**, and the accounting is reported | `tests/ofp-migration.js` claim-completeness assertions; `summary.json` goldens | **High.** P4-SEM-A retires `coverageSlots.required`; that must be a named drop, not an omission. |
| **Statements are immutable acts** | P0 §2 (`:59`) — "a record of an act, by an actor, at a time, about one addressable claim" | Five frozen kinds (`cited`/`suggested`/`observed`/`approved`/`disputed`), `closedEnum: true` in `ofp/ofp-schema.js:364`; supersession is derived, never stored | `tests/ofp-contract.js`; diagnostic `statement.kind.unknown` is an **error** | **High.** P4-SEM-D lives entirely inside this rule. A mutable `reviewStatus` field would violate it. |
| **Approval is human, or it is not approval** | P0 §5; `ofp/ofp-diagnostics.js:69` | `statement.actor.missing` and `statement.actor.not-human` are both **errors** on `approved` | `tests/ofp-contract.js` | Medium. B2a's AI reviewer must never become an approving actor. NC-F already guards the live path. |
| **A stale approval confers no approval** | P0 §6 (`:343`) — "the single most important rule in this document" | Claim hash recomputed on every load; `statement.stale.approval` surfaced | `tests/ofp-contract.js` | Medium. |
| **Authored fields need no evidence wrapper** | P0 §2 (`:94`) — "ordinary authored production data carries **no statement at all**" | `statements[]` is sparse; measured at 1.25–1.82 per shot across the corpus (P3 §8) | `tests/ofp-overfit-conformance.js` guards ≤3.0/shot and ≤0.10/source value | **High.** The temptation in P4-SEM-D is to wrap every approval in a statement. The corpus says the array must stay sparse. |
| **Unknown extension semantics are preserved** | P0 §8 rules 11–12; P1 §10 | `passthrough: true` subtrees re-serialised deep-equal; unknown enums preserved verbatim and *reported*, never coerced (`schema.enum.unknown` is a **warning**) | `tests/ofp-serialization.js`; `tests/ofp-negative-controls.js` NC-16 and the G2 gate | Medium. Adding `requirement` to `COVERAGE` converts an unknown key into a known one — see §14. |
| **No parallel CineBraid canonical model beside OFP** | P0 §11 Decision 2 (`:670`) — "canonical CineBraid semantics and OFP core are one layered model" | CineBraid vocabulary lives in profiles/extensions; core must validate with every profile stripped (audit R11) | `tests/ofp-contract.js` containment-table pin | **VERY HIGH.** This is the invariant P4-SEM is most likely to break, and §13 is entirely about that. |
| **Migrations and goldens stay deterministic** | P2 §12; P3 §12 | Same input + same migration version ⇒ byte-identical output; golden drift is a deliberate, reviewed act | 18 goldens + `summary.json`; `tests/ofp-overfit-negative-controls.js` | Medium. |
| **Old projects remain readable or migrate explicitly** | P0 §11 Decision 12 (`:694`) | Legacy documents are detected (`ofp-migrate-detect.js`), never auto-converted; nothing runs migration on open | `tests/ofp-read-invariant.js` covers the legacy class | Low, if P4-SEM keeps every new field optional. |
| **Reserved filmmaking terminology** | P0 §12 | A test enforces the reserved list against `ofp/ofp-schema.js` | `tests/ofp-contract.js` reserved-terminology assertion | Low, but P4-SEM-B must not name anything `setup`, `slate` or `stage`. |

Two further invariants that the brief did not name but that P4-SEM touches:

- **The containment table is derived from the schema, never typed twice** (`ofp/ofp-schema.js:493` `deriveContainment()`, pinned to the frozen P0 §3 table by test). Any new addressable record type in P4-SEM changes that table and must change the frozen list deliberately.
- **The MediaAsset ledger decides nothing** (`media-assets.js:240` — "a projection cannot corrupt what it projects"). P4-SEM-C changes that ledger from a projection into an authority for *location*. That is a deliberate promotion and needs its own argument, made in §7.

---

## 3. The current canonical model, as it actually is

Three models exist simultaneously today. Confusing them is the main hazard in this whole exercise.

### 3.1 OFP core — `ofp/ofp-schema.js`, contract `1.0-draft.1`

Validated and serialised, but **nothing loads or saves a real project through it**. Relevant records:

```
ASSET       { id, kind: image|video|audio|other, mediaType, digest }        ← no storage path
REFERENCE   { id, purpose, subject: <subject-ref>, assetId, note }
COVERAGE    { id, name, description }                                        ← on location/prop/vehicle only
ENTITY_STATE{ id, name, isDefault, derivesFrom, delta }
CHARACTER   { id, name, description, role, aliases[], voices[], states[] }   ← no coverage[]
VOICE       { id, name, description, kind, language }                        ← entities.voices[]
VOICE_LINK  { voiceId, role, language }                                      ← character.voices[]
SHOT        { …, setting{locationId, coverageId}, subjects[]{entityId, role},
              frames[]{id, role, description}, motion[], relations[], risks[] }
STATEMENT   { id, target{subject,path}, kind, claim{hash,preview}, actor, at,
              evidence{sourceId,anchors[],assetId,observationId}, candidates[], note }
continuity  passthrough, profile "continuity" — interior not modelled
extensions  passthrough
```

Two absences do most of the work below: **`ASSET` has no storage path**, and **nothing anywhere binds an entity to a state on a shot or a frame.** `SHOT.subjects[]` carries `{entityId, role}` and stops there.

### 3.2 Legacy CineBraid `project.json` — the live model

What the running application reads and writes. The shapes P4-SEM must reconcile:

```
entity.coverageSlots[]     { id, label, required:bool, requirement:enum, approvedFile,
                             status, notes, approvedAt, replacementHistory[], provenance{} }
character.expressionSlots[]{ …same shape, plus retired }
entity.continuityStates[]  { id, name, isDefault, approvedFile, approvedAt, notes,
                             parentValidation, requirement… }
entity.candidateFiles[]    { stored, original, addedAt, decision, notes, labels[],
                             targetStateId, targetCoverageSlotId, coverageGroup,
                             referenceView, structuredReviews{stateId:…} }
entity.approvedFile        a FILENAME
P.audio[]                  an entity list carrying image-reference semantics
character.audio.voiceDesignPrompt   a TTS design string
character.voiceId          legacy pointer into P.audio[]
shot.continuityStateSelections{ entityId: stateId }              ← shot default
shot.creationBrief.frameWorkflows[frameId]
      .characterStateSelections{} .propStateSelections{}
      .vehicleStateSelections{}   .locationStateId                ← frame override
shot.keyframes[]           { id, label, winner, selectedCandidate, … }
```

### 3.3 The sidecars — outside `project.json`, outside OFP

| Sidecar | File | Status |
|---|---|---|
| MediaAsset ledger | `projects/<slug>/media-assets.json` | Schema, store, indexer and verifier all implemented and tested. **Inert** — nothing runs on project open, nothing is authoritative for approval. |
| Generation jobs | `projects/<slug>/generation-jobs.json` | Live and durable (`generation-job-store.js`). A bare JSON array; the record carries **no `accounting` block**. |
| Generation contracts | `generation-contracts.js` | `validateGenerationJob` / `validateCostEstimate` implemented and tested (`tests/generation-job-contract.js`). **Not applied** to the fal job path. |
| Continuity cache | `continuity-cache.js` | Observations, deliberately outside the document. |

**This is the reconciliation's most useful single observation:** four of the eight requirements are asking for capabilities that already exist in a tested, inert layer. The work is activation and wiring, not design.

---

## 4. P4-1 — canonical coverage model

### What exists

Coverage intent is expressed **three times in three collections that are not each other**: `coverageSlots[]` (angles), `expressionSlots[]` (characters only, with a `retired` flag), and `continuityStates[]` (which also carries an `approvedFile` and a requirement and is therefore also a coverage slot in everything but name). OFP core models only the first, and only on location/prop/vehicle.

Requirement intent is expressed **twice inside one record**. `public/entities.js:698`:

```js
function referenceRequirement(item, isDefault = false) {
  if (isDefault) return "required";
  const explicit = String(item?.referenceRequirement || item?.requirement || "").toLowerCase();
  if (["required", "planned", "not-required"].includes(explicit)) return explicit;
  return item?.required === false ? "planned" : "required";
}
```

Three spellings — `referenceRequirement`, `requirement`, `required` — resolved by precedence. The audit already named this at `CINEBRAID_CANONICAL_FORMAT_AUDIT_2026-08-09.md:112`: *"`required` and `requirement` are two encodings of the same fact."* The writer keeps them in sync (`entities.js:719-720` sets both), so data created through the UI is coherent; data from Project Builder import, hand-edited projects or older generations need not be.

### The divergence, concretely

Two readers disagree, and not hypothetically:

- `public/entities.js:764` `coverageStats()` classifies through `referenceRequirement()`, so `requirement` wins.
- `public/focused-workspaces.js:257` computes `coverage.filter((slot) => slot.required !== false)` — the legacy boolean alone, `requirement` never consulted.

A slot carrying `requirement: "not-required"` **without** a `required: false` twin is *excluded* from the required set by the coverage board and *included* by the Reference Inspector. Both surfaces then print a fraction. This is the "counts differ" symptom the audit reported, and its cause is a second encoding, not a second calculation.

### Answers to the section's questions

1. **What coverage/view structures exist?** Three, listed above, plus `REFERENCE.purpose` in OFP (`identity-front`, `location-view`, `prop-view`, …) which is a *view vocabulary* and a fourth partial expression of the same idea.
2. **Authored intent vs derived count?** `requirement` is authored. `approvedFile`, `status`, `approvedAt`, and every `n/m` fraction are derived or are approval edges that belong elsewhere.
3. **Are required/planned/not-required representable in OFP?** **No.** `COVERAGE` is `{id, name, description}`.
4. **Is primary image authority separate from view coverage?** In OFP, yes and cleanly: primary identity is `REFERENCE.purpose = "identity-front"` on the entity subject; a view is a `REFERENCE` whose subject is the `coverage:` record. In legacy, no — `entity.approvedFile` is a bare filename beside `coverageSlots[].approvedFile`, and `library-tools.js:555-559` *seeds a coverage slot from the primary approval*, which is the two concepts touching.
5. **Duplicated stored roll-ups?** None found in `project.json`. The counts are computed everywhere and stored nowhere. That half of the design is already right.
6. **Schema problem or multiple calculations?** **Schema problem**, per the divergence above. Consolidating the calculators without removing the second encoding would leave the defect one refactor away from returning.

### Conclusion — P4-1

Persist slot intent; derive counts; delete the duplicate encoding.

**Minimum canonical addition:**
- `COVERAGE.requirement` — enum `required` | `planned` | `not-required`. This is authored production intent and it fails the semantic test hard: a project reloaded without it cannot distinguish a gap from a deliberate non-requirement. It is precisely the argument P0 §5 makes for putting `unspecified` in the field's own enum rather than in evidence.
- `COVERAGE` added to `CHARACTER`. Characters have coverage today (`ensureCoverageSlots("characters", …)`) and OFP cannot hold it. Expressions become coverage records with a distinguishing `kind`, rather than a fourth collection.

**Explicitly not added:** `required` (retired by a named migration rule), `approvedFile`/`status`/`approvedAt` (these are `references[]` edges plus statements), `retired` (a disposition, see §8), any count.

**Migration:** `requirement` inferred from `requirement` → `referenceRequirement` → `required===false ? "planned" : "required"`, in the live precedence order so migration and runtime cannot disagree. Where a legacy slot carries **both** and they contradict, the migration must not choose silently — it writes a `disputed` statement on the coverage record, exactly as M020 does for ambiguous location codes.

---

## 5. P4-2 — historical job cost

### What exists

`generation-contracts.js:645` already defines a complete, generic, provider-neutral `CostEstimate`:

```
{ costClass: free_local|metered_api|metered_credits|metered_partner,
  unit: none|usd|buzz|…,
  amount: number,
  confidence: quoted|estimated|unknown,     ← "the load-bearing field"
  quotedAt: instant,                        ← required when quoted
  breakdown: [{label, amount}],
  balanceAfter: number|null }
```

with `GenerationJob.accounting = { costClass, estimate }` validated at `:371-383`, and `requiresExplicitAuthorization()` recorded at `:687`. All of it is tested by `tests/generation-job-contract.js`. **The fal dispatch path writes none of it.** The job literal at `fal-generation.js:1312` has 40-odd fields and no `accounting` key.

What the user actually sees is computed at display time from one global scalar:

```js
// public/reports.js:60
const rate = Math.max(0, Number(CONFIG?.generation?.fal?.estimatedCostPerImage || 0));
const estimated = rate ? Number(summary.totals?.imagesGenerated || 0) * rate : 0;
```

and the same pattern at `public/automation.js:434`. `estimatedCostPerImage` is a single user-editable USD number in Settings (`public/views.js:278`), clamped 0–100 (`config.js:336`). So the reported historical spend of a project is `today's_settings_number × image_count` — it changes retroactively when the setting changes, it is identical for a 512px draft and a 4K render, and it is `$0.00` for every project whose owner never filled the field in.

### Answers to the section's questions

1. **What cost/provenance is persisted?** For cost: nothing. Provenance is well covered — the job record holds provider, model/profile, mode, prompt, references, timestamps and provider request ids.
2. **Project format or app ledger?** **App ledger.** Apply the test the brief sets: *would the project be semantically wrong without it?* A film reloaded, exported and opened by another compliant client is the same film whether it cost $4 or $400. Cost describes the *production process*, not the *work*. It is real, durable, worth keeping — and it is not part of what OFP exists to make portable.
3. **Does OFP model jobs as first-class records?** **No.** There is no job, execution, run or take record anywhere in the contract, and P0 §12 deliberately *reserves* `take` so it cannot acquire a meaning before the profile that needs it exists. Introducing jobs into core to hang a cost off them would be the largest possible answer to the smallest question in this document.
4. **What does another client need?** Nothing from this. It needs the asset and the reference edge, both of which exist.
5. **Should recomputation ever be canonical history?** No, and this is the crisp rule: **a historical fact and a current policy are different objects.** `estimatedCostPerImage` is a policy. What a job cost on 3 August is a fact. A system that derives the second from the first has no history at all — it has a re-quote.
6. **Interoperability or accounting?** Accounting.
7. **Smallest stable representation, if it ever did belong in OFP?** `extensions["com.cinebraid.accounting"]`, which needs no contract change and is already preserved by rule.

### Conclusion — P4-2

**Zero OFP change.** Historical cost is `HISTORICAL PROVENANCE`, owned by the generation-job ledger.

The work is: populate `job.accounting` at submit time from the existing contract, record `confidence: "estimated"` (CineBraid computed it) versus `"quoted"` (the provider priced this job), add the provider-returned actual as a second, separately-labelled fact when one is available, and make every historical surface read the stored value and *never* recompute. Where a legacy job has no `accounting`, the surface must say **"not recorded"** — not `$0.00`, and not today's rate applied backwards. That is the same discipline B2a applied to reviewer attribution ("Not recorded for this review" rather than borrowing today's Settings value), and it should be cited as precedent rather than re-argued.

This is the lowest-risk item in the whole set and it does not depend on any other primitive.

---

## 6. P4-3 — durable review decision record

### What exists

**On the AI side**, `public/review.js:250` stores a rich structured review keyed by state:

```js
row.structuredReviews[target.stateId] = {
  ...data.review, contractVersion, authoritySignature, stateId, stateName,
  reviewedAt, inputLabels, reviewer: entityReviewReviewerRecord(data)   // ← B2a
};
```

**On the human side**, approval is a mutation, not a record. `public/library-tools.js:547-553`:

```js
if (targetState) {
  targetState.approvedFile = finalName;
  targetState.approvedAt   = new Date().toISOString();
  targetState.parentValidation = null;
}
```

The previous approval is overwritten. There is no actor, no reason, no link to the review it agreed with or overrode, and no trace that a decision was ever changed. `coverageSlots[].replacementHistory[]` is the only history of its kind and it is bounded to the last 20 entries (`entities.js:781`) — a display convenience, not a record of acts.

### The record OFP already has

P0 §5 designed this exact case and numbered it. Case 6 (`:315`): *"director accepts an intentional deviation — `approved` on the frame's continuity aspect, `evidence.observationId` naming what was accepted, `note` carrying why. Durable, and it survives the observation cache being cleared."*

Every field the audit asks for maps onto a field that exists:

| Audit requirement | OFP field |
|---|---|
| human verdict | `kind: "approved"` (or `disputed`), `actor: {kind: "human", name}` — both **required**, enforced by `statement.actor.missing` / `.not-human` as errors |
| optional human reason | `note` |
| AI verdict it agreed with or overrode | `evidence.observationId` — a *reference*, not an embedded copy |
| what it was about | `target: {subject, path}` + `claim.hash` |
| when | `at` |

### Answers to the section's questions

1. **What approval facts are stored?** A filename and a timestamp. No actor, no reason, no provenance link.
2. **Are approvals immutable statements?** In OFP, yes by construction. In the running app, no — they are overwritten fields.
3. **Traceable to an artefact?** Only by filename, and the approval act *renames the file* (`library-tools.js:530-545`). See §7.
4. **Can override/rejection be represented without mutable duplicate truth?** Yes — a later `approved` statement on the same target wins, and supersession is derived (P0 §2 `:95`). Nothing is mutated and nothing is lost.
5. **Should the AI verdict be embedded, referenced, or stay provenance?** **Referenced.** Embedding it would copy a model's advisory output into an authoritative human act and make the two indistinguishable after the fact — which is the precise failure B2a was opened to fix. `evidence.observationId` is the seam that already exists for this.
6. **Is rejection a statement, a candidate disposition, or both?** **Candidate disposition only.** See §8 — a rejected candidate is not a value in the document, so there is nothing for a statement to target.
7. **Does a changed decision append or mutate?** **Appends.** P0 §5 case 3 is explicit and is the case that kills every single-enum design.

### Conclusion — P4-3

**Zero OFP change.** The record exists, is frozen, and is the right shape. What is missing is that CineBraid does not write it.

Two constraints that must be carried into implementation:

- **Sparsity.** P3 §8 measured 1.25–1.82 statements per shot and the conformance suite guards a 3.0 ceiling. An `approved` statement per approval is fine (approvals are rare and deliberate); an `observed` statement per AI review is not. P0 §5 already fences this: *"routine model observations stay in the sidecar and are never promoted automatically."* B2a's `structuredReviews` must remain workflow state.
- **B2a's separation must survive.** AI analysis is advisory; human approval is authoritative. The statement model enforces that at the schema level via `statement.actor.not-human`, which is strictly stronger than the runtime guard NC-F. P4-SEM-D should be understood as *hardening* B2a, not revisiting it.

This closes the open question B2a left behind ("If P4 wants review provenance as a first-class canonical fact rather than workflow state, that is P4's call"): **the human decision becomes canonical; the AI review stays workflow provenance and is referenced by id.**

---

## 7. P4-4 — immutable artefact identity

### What exists

The four concepts the brief asks to separate **are already separated**, across three layers:

| Concept | Where it lives today | State |
|---|---|---|
| Logical artefact identity | `ASSET.id` in OFP; `assetId` (`asset-` + 128 random bits) in the MediaAsset ledger | Implemented |
| Content identity | `ASSET.digest`; ledger `contentHash`, **nullable**, with a three-state `hashState` contract | Implemented |
| Storage location | Ledger `storage.path`, project-relative and validated against absolute/UNC/`..` | Implemented — **absent from OFP `ASSET`** |
| Display filename | Legacy `approvedFile`; preserved by M030 into `extensions["com.cinebraid.legacy"].assetFiles` | Implemented |

`media-assets.js:36-56` is worth quoting on the identity decision because it forecloses a debate: *"assetId is independent of content. It is minted from randomness, so an asset has a complete identity before anything reads its bytes. Two assets may share a contentHash legitimately — the same image approved for two shots — and a content-derived id would make that state unrepresentable."* And `contentHash` is nullable by construction because a project may sit in a OneDrive Files-on-Demand folder where hashing would silently pull a media corpus over the network.

So the brief's warning — *"do not prematurely choose SHA-256 just because it is convenient"* — has already been heeded, in the opposite direction to what one might guess: identity is random, content is the *optional* digest.

### Answers to the section's questions

1. **How is media identified today?** In the running app: **by filename.** `entity.approvedFile`, `state.approvedFile`, `slot.approvedFile`, `candidateFiles[].stored`, `keyframes[].winner` are all filenames.
2. **Do IDs survive rename/move?** Ledger assetIds would. But the ledger is inert, so in practice **no**. `confirmEntityApproval` renames the file and then hand-patches every filename-keyed edge it knows about (`library-tools.js:539-543`) — states, `entity.approvedFile`, the candidate row, `generatedCandidates[]`. Any edge it does not know about is silently broken. This is exactly the failure `media-assets.js:5` names: *"the approval rename that breaks filename-keyed edges today."*
3. **Are job output references filename-only?** Yes — `fal-generation.js:765` writes `{stored: name, original: downloaded.originalName, …}`.
4. **Existing hashes / content IDs / UUIDs?** `media-hash.js`, ledger `contentHash`, ledger `assetId`, OFP `ASSET.id` + `digest`. All present.
5. **Content-addressed identity partly present?** Yes, as an *attribute*, deliberately never as the identifier.
6. **Same media under multiple paths?** Legal and expected — `validateLedger` explicitly does not check for duplicate `contentHash`: *"the same image approved for two shots is two production records of one content."*
7. **Bytes change at the same path?** `media-asset-verify.js` detects it on demand; `hashState: unavailable` retains the last known digest rather than erasing it, so a temporary read failure never looks like a new asset.
8. **How does approval point at an asset?** Today, by filename. In OFP, `REFERENCE.assetId` + `REFERENCE.subject`.

### Conclusion — P4-4

The canonical concept should be **all four, kept apart** — which is already the design. P4-SEM-C is therefore *activation plus one field*, not a new identity model.

**Minimum canonical addition:** `ASSET.storage = { path }`, optional. The justification is narrowly interoperability: an `ASSET` with neither a digest nor a path is a name for bytes nobody can find, so a round-tripped project is not openable by another client. P3 §10.1 correctly judged this *not blocking G4* for migration; it becomes load-bearing the moment export exists (P6). Keep it optional, project-relative, and validated by the same rule the ledger already uses.

**The larger work is not schema:** approvals must point at `assetId`, and the ledger must become the authority for *location* while remaining, as it says, an authority for nothing else. That is a genuine change of status for the ledger and is called out as such in the risk table.

---

## 8. P4-5 — terminal candidate disposition

### What exists

`media-assets.js:249` already derives disposition and refuses to store it:

```js
function deriveLifecycle(row, context = {}) {
  if (row.replacedAt || row.replacedBy) return "superseded";
  if (row.dismissedAt)                  return "dismissed";
  if (dialect === "entity-candidate") {
    if (key && pointers.includes(key))            return "approved";   // a LIVE pointer
    if (row.decision?.startsWith("approved-"))    return pointers.length ? "superseded" : "approved";
    if (row.decision === "rejected")              return "rejected";
    return "candidate";
  }
  …
}
const TERMINAL_LIFECYCLES = ["rejected", "dismissed", "superseded"];
```

Note `approved` requires a **live pointer**, not a timestamp — the comment explains why: *"supersede deletes the pointer and can leave a timestamp behind elsewhere."* This is derived-disposition done correctly, and it already exists.

### The one real defect

Rejection is **not durable**. `public/review.js:251`:

```js
row.decision = row.decision === "rejected" ? "unreviewed" : row.decision || "unreviewed";
```

Re-reviewing a rejected candidate silently clears the rejection. So a human "no" is erased by a subsequent AI pass — the same class of error as B2a's, in the opposite direction. Everything else the audit asks for is already representable.

### Answers to the section's questions

1. **Candidate lifecycle now?** Two vocabularies: the entity dialect (`unreviewed`, `approved-reference`, `approved-sheet-source`, `approved-coverage`, `approved-expression`, `rejected`) and the shot dialect. `media-assets.js:244` explicitly refuses to normalise one into the other, and is right to.
2. **Is approval an immutable act?** No — see §6.
3. **Is rejection persisted?** Yes, as `decision: "rejected"`, but reversibly (above).
4. **Does "archive" mean semantics or UI?** **UI.** It maps to ledger `dismissed`, which the ledger already defines as terminal-but-not-destructive. The `retired` flag on `expressionSlots[]` is the same idea and is likewise organisational.
5. **Does "alternate" affect project meaning?** **No.** An "alternate" is a candidate with no terminal act — the *absence* of a decision, not a decision. Modelling it as a stored state would make "nobody has decided" and "somebody decided it is an alternate" indistinguishable, which is exactly the collapse P0 §2 rejected in Option A.
6. **One mutable enum, or derived from acts?** **Derived.** The mechanism exists and is tested (`tests/asset-lifecycle.js`).
7. **Rejected candidate later approved?** With a live pointer, `approved` wins — because the pointer is the newer fact. Correct by construction.
8. **What should an external OFP client understand?** Only which asset is referenced for what purpose. Candidate churn is production process, not film.

### Conclusion — P4-5

**Zero OFP change, and the audit's four-state enum should be declined.** Candidates never enter OFP core; only the approved artefact does, as a `REFERENCE` edge.

Work: make rejection durable (an explicit `rejectedAt`/`rejectedBy` that a review pass cannot clear), let the ledger's derived lifecycle be the single disposition answer, and treat archive/hide as `APP-LOCAL`.

**Semantic disposition** (approved / rejected / superseded) is derived from acts and pointers. **"Hide this from my current UI"** is workspace state and must not enter `project.json` — the codebase already holds this line elsewhere (`creation-studio.js:737` deletes `motionBusy` with the comment *"request progress is browser-session state, never project data"*).

---

## 9. P4-6 — character ↔ voice, and audio semantics

### This was frozen in P1 and implemented in P2

`ofp/ofp-schema.js:223-250` and P1 §14 settled the shape, with the reasoning recorded in the schema itself:

- A voice is a first-class entity in `entities.voices[]`, addressable as `voice:<id>`.
- A character **points at** voices: `character.voices[] = [{voiceId, role?, language?}]`, roles `primary` / `alternate-language` / `adr` / `performance-variant` / `other`.
- **A voice carries no `characterId`** — that single decision is what makes several voices per character, one voice across several characters, and an unlinked narrator all valid simultaneously.

`M017` (`ofp-migrate-rules.js:646`) already maps legacy `P.audio[]` → `entities.voices[]` and `character.voiceId` → a `voices[]` link; a dangling `voiceId` becomes a `disputed` statement rather than an unresolvable link, so migration cannot turn one broken pointer into an unopenable project.

### What is actually duplicated

The duplication the audit found is entirely **runtime-side**, and it is four-way, not two-way:

| # | Where | What it holds |
|---|---|---|
| 1 | `P.audio[]` entity | name, description, `approvedFile`, **`coverageSlots[]`**, **`continuityStates[]`**, `cleanMaster`, `sameObjectAs` |
| 2 | `character.audio.voiceDesignPrompt` | an ElevenLabs-style natural-language voice-design string (`public/app.js:2597`) |
| 3 | `character.voiceId` | legacy pointer, migrated by M017 |
| 4 | `shot.audio.voiceEntityId` / `speakerId` | the dialogue binding (`server.js:4397`) |

(2) and (1) are what disagree about readiness: a character can carry a filled-in voice-design prompt while its audio entity has no approved recording, and vice versa.

### Answers to the section's questions

3. **Duplicate, overlapping, or distinct?** **Distinct concepts wearing one word.** "Voice" currently means at least four things: voice *identity* (which voice this is), voice *design* (a TTS prompt), a *recording asset*, and *provider config*. Only the first is canonical. Design is provider configuration; the recording is an `ASSET` + `REFERENCE`; provider config is app-local.
5. **Durable character↔audio relation?** In OFP yes (`VOICE_LINK`). In the runtime, only the legacy `voiceId` and the per-shot `voiceEntityId`.
6/7. **Many-to-many?** Both directions already supported, deliberately.
8. **Language/version/performance variants?** Yes — `VOICE_LINK.role` and `VOICE_LINK.language`, plus `VOICE.language`.
10. **Canonical vs workflow?** Canonical: voice identity, the link, role, language. Workflow: design prompt, provider/model selection, `cleanMaster`.

### The type-boundary defect

`P.audio[]` entities inherit image-reference semantics — `coverageSlots[]` and `continuityStates[]` are on them because they are entities, and a voice has neither angles nor visual continuity states. `server.js:7127` and `agent-suite.js:478` iterate audio alongside locations, props and vehicles. OFP's `VOICE` record correctly declares only `{id, name, description, kind, language}` and has no `states[]` or `coverage[]`. **The format already draws the boundary the UI does not.**

### Conclusion — P4-6

**Zero OFP change.** This requirement is already satisfied by the frozen contract; the work is converging the runtime onto it.

Scope split, because most of it is not P4-SEM's:
- **P4-SEM (small):** treat the audio entity as the owner of the voice record; make the character surface a *view* of the linked voice rather than a second store. This is what makes readiness (§10) answerable for voice at all.
- **B13 (UI):** the References surface, the voice-design editor, and removing the inherited image-coverage controls from audio entities.

The design must be done against save/reload/export, not against the current screen — but the design is already done and frozen, which is why this drops out of the critical path.

---

## 10. P4-7 — canonical readiness

### The rule already exists

P0 §5 (`:304`): *"a shot is not ready if any field it depends on resolves to `Conflict`, or to `Suggested` with no later `approved`. Stale statements never block."* P3 §9 tested it against the corpus and added nothing.

### The three calculators that disagree

| # | Surface | Inputs | What it misses |
|---|---|---|---|
| 1 | `server.js:924` `projectReadinessIssues()` | shot description/beat, defaulted duration, unresolved `codes[]`, entity canon text, `ref.approvedFile`, file-exists-on-disk | **Never reads `coverageSlots` or `requirement` at all.** A location missing every required view is "ready" if its primary approvedFile exists. |
| 2 | `public/entities.js:945` `boundedEntityTaskStatus()` | `coverageStats()` over coverage + expressions + non-default states, via `referenceRequirement()` | Does not consider canon text or disk presence. |
| 3 | `public/focused-workspaces.js:257` `entityInspector()` | `slot.required !== false` only | Reads the retired boolean; ignores `requirement`; ignores expressions and states entirely. |

They are not three renderings of one answer — they consume **different inputs** and answer **different questions**, which is why they can all be right and still disagree on screen. (1) is a project-level issue list; (2) is an entity-level workflow status; (3) is a coverage fraction. Only (2) and (3) are nominally computing the same fraction, and §4 shows they can differ on a single slot.

Additionally, none of the three consults `statements[]`, because no live project has any — so the P0 badge rule (`Conflict` / `Suggested`-without-`approved`) has no runtime consumer today.

### Answers to the section's questions

4. **Do they operate on incomplete data?** Yes, all three. None can see: a coverage requirement expressed only as `requirement` (surface 3), coverage at all (surface 1), or the statement-derived badge (all).
5. **Do other primitives supply the missing inputs?** Yes, and this is the dependency structure: **P4-SEM-A** supplies unambiguous requirement intent; **P4-SEM-D** supplies the approval badge; **P4-6 convergence** makes voice answerable; **P4-SEM-B** makes per-shot state coverage answerable.
6. **What would one canonical function consume?** Declared requirement per slot; the approval edge per slot/state; the derived statement badge for every field the answer depends on; entity canon presence; and — separately, as a *health* check, not a readiness fact — whether the referenced bytes are resolvable.

### The vocabulary question

The brief lists `not started / not required / planned / in progress / ready / blocked` and asks which are canonical. Sorting them by ownership:

| Word | Classification | Why |
|---|---|---|
| `not required` | **CANONICAL** | Authored intent. It is P4-SEM-A's enum member. |
| `planned` | **CANONICAL** | Same — a declared future need is a different fact from a current requirement. |
| `not started` | **DERIVED** | = required ∧ no approval edge ∧ no candidate. |
| `in progress` | **DERIVED** | = required ∧ no approval edge ∧ candidates exist. |
| `ready` | **DERIVED** | = every required slot has a live, non-stale approval edge. |
| `blocked` | **DERIVED** | = a dependent field's badge is `Conflict`, or `Suggested` with no later `approved`. |

Two are authored; four are computed from them. That is the whole answer, and it is why `entityReady` must not be stored: storing it would persist four derived words alongside the two facts they come from, and the two would drift the first time either changed.

### Conclusion — P4-7

**Zero schema change. One derived contract module** — call it a readiness contract by analogy with `reference-review-contract.js`, which is exactly this pattern done once already: a shared module that owns a vocabulary, with a test forbidding surfaces from re-deriving it.

The specification should be stated per entity type and stage (character / location / prop / vehicle / voice; identity, coverage, states, shots-affected), take the two authored facts as input, and expose the four derived words. **No UI wording in the contract** — B2a's precedent is the model: the contract emits outcome tokens and the browser renders words (`cinebraid-continuity-ui-renders-not-judges`).

---

## 11. P4-8 — per-frame continuity-state authority

### The brief's premise is outdated, and the correction is favourable

**Per-frame entity-state override already exists in CineBraid, is written, is read, and drives reference-authority resolution at generation time.**

The resolution rule, `public/shared-continuity.js:257-281`:

```js
/* frame-level selection, then shot-level, then the entity default. */
function resolveDeclaredStateId(shot, frameId, kind, entityId) {
  const workflow = shot?.creationBrief?.frameWorkflows?.[frameId];
  if (workflow) {
    const map = { character: workflow.characterStateSelections,
                  prop:      workflow.propStateSelections,
                  vehicle:   workflow.vehicleStateSelections,
                  location:  workflow.locationStateSelections }[kind];
    if (map?.[entityId]) return String(map[entityId]);
    if (kind === "location" && workflow.locationStateId) return String(workflow.locationStateId);
  }
  return String(shot?.continuityStateSelections?.[entityId] || "");
}
```

- **Writer:** `window.setFrameContinuityState(shotId, frameId, kind, entityId, stateId)` — `public/continuity-workspace.js:237`. Setting `""` deletes the key, so absence means inherit.
- **Consumer:** `server.js:5158-5161` selects each entity's approved authority image *per frame* from that resolution.
- **UI:** `continuityFrameStatePanelMarkup` renders `Follow the shot — <effective>` plus the explicit states, with the hint *"Set a frame-specific state when a change is intentional."*

So the brief's proposed rule — `shot/entity state = default; frame/entity state = optional override` — is not a proposal. It is the implemented behaviour, and Frame A `clean/dry` → Frame B `wet/injured` is representable today.

There is a real limitation, and it is narrower and different: **the panel is only reachable inside the continuity workspace's frame-pair comparison**, which requires `continuityApprovedFrames()` — frames that are already approved (`continuity-workspace.js:95-99`) — and it renders only for the two frames of the selected pair, and only for entities with ≥2 states. So the intent can be declared *after* the frames exist, and the authority that shaped generation is set through a surface that appears after generation. That is a workflow-ordering gap (B17), not a data-model gap.

### The actual format gap

**None of it reaches OFP.** `M060` (`ofp-migrate-rules.js:1313-1317`) preserves the whole thing verbatim:

```js
for (const key of ["continuityIntent", "continuitySelections", "continuityStateSelections"])
  if (context.exists(pointer))
    context.preserve(pointer, `shot.${key} belongs to the continuity profile,
                               whose interior this contract revision does not model`);
```

and `creationBrief.frameWorkflows` is preserved by M014's cluster (`:920`). In OFP core:
- `SHOT.subjects[]` is `{entityId, role}` — no `stateId`.
- `FRAME` is `{id, role, description}` — no state binding.
- `continuity` is `{ passthrough: true, profile: "continuity" }` — interior deliberately unmodelled.

So a migrated project keeps the bytes and loses the meaning: another client sees an opaque blob and cannot know which state each frame declares. **That is a genuine semantic-correctness failure and it is the strongest case in this document for widening core.**

The audit anticipated it — `CINEBRAID_CANONICAL_FORMAT_AUDIT_2026-08-09.md:489,496` proposed `subjects[]{entityId, role, stateId?}` and `frames[]{…, stateSelections{entityId: stateId}}`, with a worked example at `:714-716` showing `st-case-sealed` on one frame and `st-case-open` on the next. P0 and P1 did not carry it forward, and no record says the omission was deliberate.

### Determinations the brief asks for

| Question | Determination |
|---|---|
| **Required cardinality** | One optional state per (entity, frame). Shot level: one optional state per entity. |
| **Frame or binding?** | **On the frame, as a binding list**, mirroring `SHOT.subjects[]`: `FRAME.subjects[] = [{entityId, stateId}]`. Putting it on `SHOT.subjects[]` as a map keyed by frame would make the shot record grow with frame count and would break the P0 §3 rule that anything deserving individual evidence must be addressable. |
| **Null / inheritance** | **Key omitted = inherit.** P0 §5 already assigns that meaning ("not applicable to this profile → key omitted") and P0 §8 rule 9 forbids the writer from materialising an absent key. The runtime already uses `""`-means-inherit, so migration is a direct mapping. |
| **Explicit "same as shot" marker?** | **No.** It would be a third value meaning what absence already means, and P0 §5 admits an explicit member only where production genuinely distinguishes a deliberate non-decision — which it does not here, because the shot-level value *is* the decision. |
| **More than two frames** | Falls out for free: the binding is per frame, and `FRAME.role` already carries `first`/`last`/`intermediate`/`other`. No first/last special-casing anywhere. |
| **Legacy migration** | `shot.continuityStateSelections{entityId:stateId}` → `SHOT.subjects[].stateId`; `frameWorkflows[frameId].{character,prop,vehicle}StateSelections` and `.locationStateId` → `FRAME.subjects[]`. Deterministic, and it *narrows* the four legacy spellings into one — which must be a named mapping rule, not a silent normalisation. |
| **Validator constraints** | `stateId` must resolve to a state on the named entity (not merely to some state, which is why the subject grammar is type-specific); a frame binding must name an entity the shot lists in `subjects[]`; no duplicate `entityId` within one frame's bindings. |
| **Interaction with approved provenance** | This is the point of the whole primitive. A `REFERENCE` whose subject is `shot:sh-0100/frame:fr-b` records *which* asset was approved; the state binding records *what it was supposed to be*. Together they let a client verify an approval against its declared intent — which is precisely the labelled comparison B2b will need. |

### Conclusion — P4-8

Adopt the rule, because it is proven in the runtime rather than because it is elegant. The work is **canonicalisation of existing behaviour**, plus a decision on which of two homes it takes.

**Open architectural question (§18, Q1):** does the state binding go in **core** (`SHOT.subjects[].stateId` + `FRAME.subjects[]`) or become **the first interior of the `continuity` profile**? The audit argued core, on the grounds that declared production intent is production truth (`:523`). The counter-argument is that `continuity` was declared passthrough precisely so this could be designed deliberately later, and putting it in core commits every client to it. This document recommends **core**, for one reason: `server.js:5159` uses it to choose the *reference authority image*, which means it already determines what the film looks like. A tool that strips profiles must not silently lose it. But this is a genuine fork and it should be settled explicitly, by name, before P4-SEM-B is implemented.

Finally, per the brief's instruction: the audit verified a structural limitation and did **not** demonstrate visual failure. Nothing in this trace changes that. P4-SEM-B is justified as semantic correctness and export fidelity, not as a fix for observed damage.

---

## 12. The two P3 migration defects P4 must carry

### M080 — secret-token false positive

**Reproducible: yes, by construction.** `ofp-migrate-rules.js:147` puts `token` in `SECRET_WORDS` as a standalone word, and `keyLooksSecret()` (`:162`) consults the **key name only** — `valueLooksSensitive()` exists at `:170` but is never reached for the key-name branch. Any key tokenising to `token` is quarantined regardless of value.

**Affected path:** M080, which runs **first** by design so no later rule can carry a quarantined value.

**Observed:** `overfit-14-hub-v4-3`, at `/shots/0/promptBuilder/spec/references/0/token` and its `providerPayload` twin, both holding `"#image1"` — a prompt reference placeholder. Pinned: two `warning:migration.secret.quarantined` entries in `tests/fixtures/ofp-migration/overfit/goldens/summary.json:2855-2856`.

**Severity: LOW as data loss, MEDIUM as precedent.** The value is dropped by a named rule with an explicit disposition and a warning, so G4 holds and nothing is silent. But `#image1` is a prompt-reference token that P4-SEM-C will care about, and the pattern will recur.

**Interaction with P4-SEM:** genuine but indirect. Prompt reference tokens (`#image1`) are how a compiled prompt names its input images, so they sit adjacent to artefact identity.

**Recommendation:** fix **during migration work, before P4-SEM-C**, and prefer the *narrower* of the two options P3 offered — move `token` from `SECRET_WORDS` to `SECRET_WORD_PAIRS` (`access token`, `refresh token`, `bearer token`, `auth token`, `api token`). Consulting the value would make the quarantine data-dependent, and a security boundary that depends on the value it is inspecting is weaker than one that depends only on the key. **Required evidence:** the two golden warnings for `overfit-14` disappear and the value survives; every other quarantine count across all 18 goldens is unchanged; a negative control proves a genuine `apiToken` is still refused.

### M022 — mint with `sourcePath: null`

**Reproducible: yes, and asserted.** `tests/ofp-overfit-conformance.js:339-340`:

```js
if (!mint.sourcePath)
  assert.strictEqual(mint.rule, "M022", `${generation.id}: ${mint.rule} minted ${mint.mintedId} with no source path`);
```

The assertion is deliberately scoped to M022 so a second rule cannot join it quietly.

**Affected path:** M022, which reads production relationships out of English prose and mints `bookend-of` relations (`L0-01 → L7-03` and back). P2 §7 requires every mint to record its source path; these carry none, even though the accounting claim for the same relation names the sentence it came from.

**Severity: LOW.** Report-completeness, not data loss. The relation is written, is marked `suggested`, and blocks Ready-for-Edit until confirmed.

**Interaction with P4-SEM: none.** No primitive touches M022 or prose relations.

**Recommendation:** fix **separately**, at any time, in its own small PR. **Required evidence:** the conformance assertion inverts to "no mint anywhere lacks a source path"; the two relations and their two statements are otherwise byte-identical in the goldens.

**Neither defect was fixed in this pass.** This pass is documentation only.

---

## 13. Hidden duplicates, and the reduction

The brief asked whether the eight headings share roots. They do — five pairs collapse:

| Apparent pair | Shared root |
|---|---|
| P4-3 approval **vs** P4-5 candidate disposition | Both are *acts against an artefact*. Approval is a document-facing act (`approved` statement); rejection is a ledger-facing act (lifecycle). They are two sides of one decision record and must not become two mutable enums. |
| P4-4 artefact identity **vs** P4-3 job-output provenance | One root: **stable artefact identity**. Provenance is an edge from a job to an assetId. With filename identity, both are unsolvable; with assetId, both are trivial. |
| P4-6 voice ownership **vs** P4-7 readiness | Voice readiness is unanswerable *because* ownership is duplicated. Fixing ownership dissolves the readiness half. |
| P4-1 coverage model **vs** P4-7 readiness | Same shape: coverage supplies the authored input readiness consumes. Readiness needs no coverage field of its own. |
| P4-8 frame state authority **vs** P4-4 artefact provenance | Two halves of one question — *what was declared* and *what was approved*. They meet at the frame, and B2b needs both. |

**Duplicate-truth risks discovered** (existing, not proposed):

| # | Risk | Evidence | Severity |
|---|---|---|---|
| D1 | `required` (bool) and `requirement` (enum) both encode requirement | `entities.js:698-702`, `:719-720` | **High** — already produces divergent counts |
| D2 | Three readiness calculators over different inputs | §10 | **High** |
| D3 | Voice identity in four places | §9 | **High** |
| D4 | Approval as filename in ≥5 fields, resynchronised by hand on rename | `library-tools.js:539-543` | **High** |
| D5 | Cost recomputed from current policy and presented as history | `reports.js:60-61` | Medium |
| D6 | `structuredReviews` (AI) beside `approvedFile`/`approvedAt` (human), unlinked | §6 | Medium |
| D7 | Frame descriptive text in `keyframes[]`, `creationBrief.frames[]` and `frameWorkflows{}` | audit D5; M014 already reconciles it | Medium — migration handles it |
| D8 | `P.mediaAssets[]` (project media library) vs the MediaAsset ledger — different things, one name | `media-assets.js:27`; M031 collapses the first | Medium |

**Every one of these is pre-existing.** No proposed primitive introduces a new source of truth; three of them (D1, D2, D3) are *removed* by the proposal.

---

## 14. Canonical / derived / app-local classification

Grounded in CineBraid/OFP semantics, not in the categories the brief suggested. Where this document disagrees with the brief's implied category, the row is marked ⚠.

| Information | Class | Owner | Reasoning |
|---|---|---|---|
| Required-coverage slot **intent** (`required`/`planned`/`not-required`) | **CANONICAL** | `COVERAGE.requirement` | Authored. Without it a gap and a deliberate non-requirement are indistinguishable. |
| Coverage **count** / fraction | **DERIVED** | readiness contract | Never stored today; keep it that way. |
| Entity **readiness** | **DERIVED** | readiness contract | P0 §5 already defines it as folded, never stored. |
| Candidate hidden / collapsed / `retired` | **APP-LOCAL / UI** | workspace state | Precedent: `creation-studio.js:737`. |
| Human **approval** | **CANONICAL** | `approved` statement | Immutable act; actor required and must be human. |
| AI **recommendation** / verdict | **HISTORICAL PROVENANCE** ⚠ | `candidateFiles[].structuredReviews` (+ ledger) | *Not* canonical. Advisory; referenced from the human act by `evidence.observationId`. Promoting it would erase the B2a separation. |
| AI **score** | **RUNTIME / EPHEMERAL** ⚠ | review payload | B2a made score explicitly subordinate to the semantic verdict; persisting it as canonical would re-privilege it. |
| **Cost estimate at generation time** | **HISTORICAL PROVENANCE** ⚠ | `job.accounting.estimate` | Real and durable; not part of the film's meaning. Not OFP. |
| **Current provider price** | **APP-LOCAL** | `config.generation.fal.*` / provider surfaces | Policy, not fact. |
| Artefact **hash** | **CANONICAL (optional)** | `ASSET.digest`; ledger `contentHash` | Nullable by design — hashing can force a network hydration. |
| **Storage path** | **CANONICAL (optional)** ⚠ | `ASSET.storage.path`; ledger `storage.path` | Needed only for export/import; project-relative always. |
| **Filename** (display) | **APP-LOCAL** | `extensions["com.cinebraid.legacy"].assetFiles` | Mutable by the approval flow itself. Never identity. |
| **Voice relationship** (character → voice) | **CANONICAL** | `CHARACTER.voices[]` | Already frozen, P1 §14. |
| Voice **design prompt** | **APP-LOCAL** | extension | Provider configuration for a specific TTS vendor. |
| Voice **UI expansion state** | **APP-LOCAL / UI** | workspace state | |
| **Frame-specific continuity state** | **CANONICAL** | `FRAME.subjects[].stateId` (proposed) | Determines the reference authority image; changes what the film looks like. |
| Shot-level state default | **CANONICAL** | `SHOT.subjects[].stateId` (proposed) | Same. |
| **Currently selected tab** | **APP-LOCAL / UI** | workspace state | |
| Candidate **disposition** | **DERIVED** | `deriveLifecycle()` | From live pointers + terminal acts. |
| Candidate **rejection act** | **HISTORICAL PROVENANCE** ⚠ | ledger / candidate row | Durable, but not an OFP statement — the candidate is not a document value, so there is no target for a statement to address. |
| Statement **staleness** / badge | **DERIVED** | validator | P0 §6, never persisted. |
| Continuity **finding** | **DERIVED** | continuity contract | P0 §5 case 5. |
| Continuity **observation** | **HISTORICAL PROVENANCE** | `continuity-cache.js` | Sidecar; promoted to `observed` only by a human or a workflow step. |
| **Reviewer attribution** (provider/model) | **HISTORICAL PROVENANCE** | `structuredReviews[].reviewer` (B2a) | Already correct: recorded per review, never re-read from current Settings. |
| Coverage `replacementHistory[]` | **APP-LOCAL** ⚠ | slot | Bounded to 20 entries — a convenience log, not a record of acts. If history matters, it is statements. |
| Job **provider request id** | **HISTORICAL PROVENANCE** | job ledger | The only record that money was spent. |
| `entityReady` | **UNKNOWN → RESOLVED: DERIVED, must not exist** | — | The audit already concluded this and this pass confirms it. |

**UNKNOWN / NEEDS DECISION** — two rows this pass could not resolve on its own authority:

| Item | Question | §18 |
|---|---|---|
| Home of the state binding | core vs the `continuity` profile | Q1 |
| `ASSET.storage` | required for P4-SEM, or deferred to export (P6) | Q2 |

---

## 15. Compatibility, migration, validators, testing

### 15.1 Compatibility

Every proposed field is **optional**, which makes most of this table short.

| Direction | P4-SEM-A `COVERAGE.requirement` | P4-SEM-B state bindings | P4-SEM-C `ASSET.storage` |
|---|---|---|---|
| **Old project → new app** | Loads unmutated. Absence means *unknown*, and the readiness contract must treat "no declared requirement" as its own case rather than defaulting to `required` at load — defaulting at load breaks INV-R1 and INV-R3 rule 1. | Loads unmutated; absence = inherit, which is already the runtime meaning. | Loads unmutated; a pathless asset is resolvable via the ledger. |
| **New project → older app** | Safely ignorable **as a value**, but *not semantically free*: an older reader sees no requirement and may treat every slot as required. Degrades to over-reporting, never to data loss. | Safely ignorable → the older reader falls back to the shot default, i.e. the pre-P4-SEM behaviour. Graceful. | Fully ignorable. |
| **Unknown-extension preservation** | Helps only for *round-trip*, not for *understanding*. `schema.unknown-property` is a warning and the key survives (P1 §10). | Same. | Same. |
| **Migration required?** | **Explicit rule needed** — a legacy `required: false` must become `planned`, which no reader can infer later once the boolean is retired. | **Explicit rule needed** — four legacy spellings collapse into one. | Inference from the ledger; safe to leave absent. |
| **Export/import round-trip** | Preserved; `set` collection ordered by `id`. | Preserved; `FRAME.subjects[]` is `ordered`, so array order is data and is never sorted. | Preserved. |
| **Determinism** | Holds — the inference is a pure function of the source document. | Holds — likewise. | Holds. |

One compatibility subtlety worth naming: `COVERAGE.requirement` currently arrives as an **unknown property** on real data and is preserved with a warning. Declaring it converts a warning into structural validation. Any legacy value outside the enum then becomes `schema.enum.unknown` — still a warning, still never coerced (P0 §8 rule 12), but the diagnostic *changes* for existing documents. The Overfit goldens must be re-measured for that shift and it must be a reviewed golden change, not a surprise.

### 15.2 Migration strategy — not implemented

| | P4-SEM-A | P4-SEM-B | P4-SEM-C |
|---|---|---|---|
| **Source shape** | `coverageSlots[]{required, requirement, referenceRequirement}`, `expressionSlots[]`, `continuityStates[]` | `shot.continuityStateSelections{}`; `frameWorkflows[fid].{character,prop,vehicle}StateSelections`, `.locationStateId` | `approvedFile` filenames; ledger rows |
| **Target shape** | `COVERAGE.requirement` on character/location/prop/vehicle | `SHOT.subjects[].stateId`; `FRAME.subjects[]` | `ASSET.storage.path` |
| **Inference** | live precedence: `referenceRequirement` → `requirement` → `required===false ? planned : required` | direct mapping; `""`/absent → omit | ledger `storage.path` when present |
| **Loss risk** | Low. The retired boolean is fully recoverable from the enum. | Low. | None — additive. |
| **Ambiguity** | `required: true` **with** `requirement: "not-required"` | a frame naming an entity the shot does not list | an asset with no ledger row |
| **Human needed?** | Only for the contradiction case | Only for the orphan case | No |
| **On ambiguity** | `disputed` statement carrying both readings; `migration.review.required` | `disputed` statement; do **not** invent a `subjects[]` entry | leave `storage` absent |
| **Golden fixtures** | required — a slot of each requirement, both encodings, and the contradiction | required — a cross-state first/last pair, a 3-frame shot, a shot with no selections | required — an asset with and without a path |
| **Negative controls** | a control proving a contradiction is not silently resolved by precedence | a control proving an explicit override is not collapsed into inheritance | a control proving an absolute path is refused |
| **Read-old** | absent `requirement` stays absent | absent binding = inherit | absent `storage` = resolve via ledger |

**Governing principle, restated because it is the one most likely to be violated under schedule pressure:** where old data cannot determine a new fact, write nothing. Absence is a legal, meaningful value in this contract, and P0 §5 gives it a defined reading.

### 15.3 Validator invariants — specified, not implemented

Registered in `ofp/ofp-diagnostics.js` alongside the existing codes, respecting the existing severity philosophy (unknown ⇒ warning; broken reference ⇒ error).

| Proposed code | Severity | Invariant |
|---|---|---|
| `coverage.requirement.unknown` | warning | a `requirement` value outside the declared enum — preserved, reported, never coerced |
| `coverage.id.duplicate` | error | coverage ids unique within one owner (`id.duplicate` may already cover this via the collection rule — confirm before adding) |
| `state.binding.unresolved` | error | `subjects[].stateId` names no state on that entity |
| `state.binding.entity-unlisted` | error | a frame binding names an entity absent from `SHOT.subjects[]` |
| `state.binding.duplicate` | error | two bindings for one entity on one frame |
| `asset.storage.not-project-relative` | error | absolute, drive-qualified, UNC, or containing `..` |
| `asset.storage.unresolvable` | **warning** | path names nothing on disk — a *health* fact, not a document defect; a valid project may be opened without its media |
| `reference.asset.unresolved` | error | already covered by `ref.unresolved`; verify rather than duplicate |

**Deliberately not constrained:** anything inside `extensions` or `continuity` passthrough; the presence of `requirement` (absence is legal); whether every required slot has an approval (that is readiness, and readiness is derived, not validated).

### 15.4 Testing strategy — designed, not written

Minimum evidence per primitive before merge:

| Primitive | Minimum evidence |
|---|---|
| **A** coverage requirement | validator units for the enum; migration golden per requirement value + the contradiction case; round-trip; unknown-enum preservation; **negative control**: precedence silently resolves a contradiction; **regression**: all 18 Overfit goldens re-measured for the warning→structural shift |
| **B** state bindings | validator units for all three new codes; goldens for a cross-state FLF pair, a 3-frame shot, an unselected shot; migration determinism; **negative control**: an explicit override collapses into inheritance; **behavioural**: `server.js:5158-5161` picks the same authority image before and after canonicalisation, on a real project |
| **C** artefact identity | ledger→document identity round-trip; **rename/move test**: approve, rename, and assert the approval edge survives (the defect that motivates the primitive); path-shape negative controls; INV-R1 unchanged |
| **D** decision as act | statement units incl. `actor.not-human` on `approved`; append-not-mutate on a changed decision; `evidence.observationId` survives an observation-cache clear; **statement-volume regression** against the 3.0/shot ceiling; **negative control**: an AI pass performs the approval (extend B2a's NC-F) |
| **E** readiness contract | one contract, N surfaces; **negative control**: a surface re-derives readiness locally and the guard fires (mirroring `cinebraid-continuity-ui-renders-not-judges`); divergence fixture — the `requirement:"not-required"` slot with no `required:false` twin, asserted identical across all three surfaces |
| **cost** | job record carries `accounting` at submit; a Settings rate change does **not** alter a historical figure; a legacy job with no accounting reads "not recorded", never `$0.00` |
| **voice** | character surface and audio entity agree on voice readiness by construction; an audio entity exposes no image-coverage semantics |

Cross-cutting, every batch: `check:ofp-core` (8 suites), INV-R1 across all ten document classes, determinism, idempotency, unknown-extension preservation, and the full 18-generation Overfit corpus. Plus the two carried defects: **M080 regression** (the `#image1` value survives; genuine credentials still refused) and **M022 regression** (no mint lacks a source path).

Every negative control must follow the established two-part receipt — prove the defect is live with a probe, *then* require the guard to fail — compiled in memory and installed in the module cache, never reverted with `git checkout`. That rule exists because a broad checkout has already discarded unrelated unstaged work once in this repository.

---

## 16. The final P4-SEM canonical model

> **After reconciliation, the eight audit requirements reduce to five canonical primitives — three of which widen OFP core, and two of which widen nothing — plus two workstreams that leave OFP entirely.**

### P4-SEM-A — Coverage requirement semantics

- **Canonical responsibility:** the declared production need for one view/coverage slot.
- **Why persistence is necessary:** a reloaded project cannot otherwise distinguish "this view is missing" from "this view was never wanted". Authored intent, unrecoverable by derivation.
- **Owning object:** `COVERAGE.requirement`, on character/location/prop/vehicle.
- **Relation to existing OFP:** widens an existing record by one enum, and adds `coverage[]` to `CHARACTER`. No new record type, no containment-table change for `coverage` itself (character joins the existing scope list).
- **Migration:** required, deterministic, with a `disputed` statement on the contradiction case; retires `required`.
- **Validator:** `coverage.requirement.unknown` (warning); uniqueness within owner.
- **Dependencies:** none. **Unlocks:** B11.

### P4-SEM-B — Declared entity-state binding (shot default + frame override)

- **Canonical responsibility:** which state of an entity a shot, and optionally a specific frame, declares.
- **Why persistence is necessary:** it selects the reference authority image at generation time (`server.js:5158-5161`). It determines what the film looks like, and it currently survives migration only as an opaque blob.
- **Owning object:** `SHOT.subjects[].stateId` (default) and `FRAME.subjects[]` (override). Absence = inherit.
- **Relation to existing OFP:** widens `SHOT.subjects[]` by one optional field and adds one binding collection to `FRAME`. **The only primitive that changes the shot record.**
- **Migration:** required; collapses four legacy spellings into one.
- **Validator:** `state.binding.unresolved` / `.entity-unlisted` / `.duplicate`.
- **Dependencies:** none technically; **§18 Q1 must be settled first.** **Unlocks:** B17, and materially de-risks B2b.

### P4-SEM-C — Artefact identity activation

- **Canonical responsibility:** durable identity for a produced artefact, independent of its filename and location.
- **Why persistence is necessary:** approval renames the file, so filename-keyed edges break by design. Identity must outlive the rename.
- **Owning object:** `ASSET.id` (exists) + `ASSET.storage.path` (new, optional); the MediaAsset ledger becomes the location authority.
- **Relation to existing OFP:** one optional sub-object on `ASSET`. Everything else is activation of a tested, inert layer.
- **Migration:** none required — additive and inferable.
- **Validator:** path-shape error; unresolvable-path **warning**.
- **Dependencies:** roadmap-P4 canonical persistence. **Unlocks:** B12, and is a hard prerequisite of D.

### P4-SEM-D — Human decision as an immutable act

- **Canonical responsibility:** who approved what, when, why, and against which advisory analysis.
- **Why persistence is necessary:** approval currently overwrites its predecessor and records no actor or reason, so a project cannot answer "who decided this and did they know what the reviewer said".
- **Owning object:** an `approved` (or `disputed`) statement targeting the artefact reference, with `evidence.observationId`.
- **Relation to existing OFP:** **none — the record already exists.** No schema change.
- **Migration:** none. Legacy `approvedFile`/`approvedAt` become `references[]` edges with no statement — correctly, since P0 §2 says authored data carries no statement.
- **Validator:** already covered by `statement.actor.missing` / `.not-human` / `.stale.approval`.
- **Dependencies:** **C** (a statement must target a stable artefact). **Unlocks:** B12; hardens B2a.

### P4-SEM-E — Derived readiness contract

- **Canonical responsibility:** none. It owns a *derivation*, not a fact.
- **Why persistence is necessary:** **it is not, and it must not be.** Explicitly the negative primitive.
- **Owning object:** one shared contract module; a test forbids surfaces from re-deriving locally.
- **Relation to existing OFP:** consumes `requirement`, statement badges and reference edges. Adds nothing.
- **Migration / validator:** none.
- **Dependencies:** **A**, plus voice convergence for voice readiness; improved by **B** and **D**. **Unlocks:** B11.

### Two workstreams that leave OFP

- **Historical cost** (P4-2) — populate `job.accounting` using the existing validated `CostEstimate`; make every historical surface read stored values and never recompute; "not recorded" where absent. **No OFP change. No dependencies. Can start immediately.**
- **Voice convergence** (P4-6) — the audio entity owns the voice record; the character surfaces a view of the link. The OFP shape is already frozen (P1 §14) and already migrated (M017). **No OFP change.**

### Requirements that remain purely derived or UI-only

Entity readiness; every coverage count and fraction; candidate disposition; candidate hidden/collapsed/`retired`; selected tab, panel and pair; AI score; AI verdict as an authority; continuity findings; statement staleness and badges; "alternate" as a stored candidate state; current provider pricing.

---

## 17. Risk ranking, dependency graph, and batch sequence

### 17.1 Dependency graph

```
                    roadmap-P4 canonical persistence (prerequisite for A, B, C)
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        │                            │                            │
   P4-SEM-A                     P4-SEM-B                     P4-SEM-C
 coverage requirement        state bindings              artefact identity
        │                            │                            │
        │                            │                       P4-SEM-D
        │                            │                   decision as act
        │                            │                            │
        └──────────► P4-SEM-E derived readiness ◄─────────────────┘
                              ▲
                     voice convergence

  independent, no prerequisites:   historical cost   ·   M022 sourcePath
  before P4-SEM-C:                 M080 token
```

The brief's hypothesised chain — *artefact identity → review/disposition → readiness* — is **confirmed for the C → D edge** and **refuted for D → E**: readiness's hard prerequisite is A (requirement intent), not D. D improves readiness but does not gate it. And voice convergence *does* gate readiness, but only for the voice entity type.

### 17.2 Risk ranking

| Area | Risk | Drivers |
|---|---|---|
| **P4-SEM-B** state bindings | **VERY HIGH** | Touches the shot record — the most-read structure in the format. Changes the containment surface. Migration collapses four legacy spellings. Interacts with reference-authority selection, so a mapping error changes generated output. Unsettled core-vs-profile question. |
| **roadmap-P4** canonical persistence | **VERY HIGH** | Retiring `normalizeProjectV5` while INV-R1/R3 hold on every real project. Not this document's scope, but it gates three primitives and must be ranked with them. |
| **P4-SEM-C** artefact identity | **HIGH** | Promotes the ledger from projection to authority. Rename/move is the exact path that breaks today. Silent-loss potential if an edge is missed. |
| **P4-SEM-A** coverage requirement | **MEDIUM** | Small field, but retires a live boolean and shifts a diagnostic class across all 18 goldens. |
| **P4-SEM-D** decision as act | **MEDIUM** | No schema change, but touches approval — the most safety-critical flow — and risks statement-volume inflation. |
| **P4-SEM-E** readiness | **MEDIUM** | No persistence risk; broad surface count. Purely subtractive if done right. |
| **voice convergence** | **MEDIUM** | Two live lifecycles merging; the OFP target is already frozen, which removes the design risk. |
| **historical cost** | **LOW** | Additive, sidecar-only, contract already written and tested. |
| **M022 `sourcePath`** | **LOW** | One report field; one assertion inverts. |
| **M080 `token`** | **LOW–MEDIUM** | Small change; touches a security boundary, so it needs its own negative controls. |

**Changes that must get their own isolated PR and their own migration golden corpus:** P4-SEM-B (unconditionally — the shot record and reference-authority selection in one change is the highest-consequence edit in the set) and P4-SEM-C (the rename/move identity path). P4-SEM-A also needs its own golden corpus because of the diagnostic-class shift, though it can share a PR with nothing else.

### 17.3 Recommended batch sequence

Bounded PRs, smallest coherent unit each, in this order:

| # | Batch | Depends on | Risk |
|---|---|---|---|
| 0a | **Historical cost** — populate `job.accounting`; stop recomputing; "not recorded" for legacy | — | LOW |
| 0b | **M022 `sourcePath`** | — | LOW |
| 0c | **M080 `token` → pair** | — | LOW–MED |
| 1 | **Voice convergence** — one owned voice record, character surfaces a view | — | MED |
| 2 | *(roadmap-P4 canonical persistence — separate phase, not P4-SEM)* | — | VERY HIGH |
| 3 | **P4-SEM-A** coverage requirement + character coverage | 2 | MED |
| 4 | **P4-SEM-C** artefact identity + `ASSET.storage` | 2 | HIGH |
| 5 | **P4-SEM-D** approval as statement | 4 | MED |
| 6 | **P4-SEM-B** state bindings *(after §18 Q1 is settled)* | 2 | VERY HIGH |
| 7 | **P4-SEM-E** readiness contract | 3, 1 | MED |

Batches 0a–0c and 1 need nothing from the format and can start immediately, in parallel, while the core question in §18 is settled.

### 17.4 UX batches unlocked

| Primitive | Unlocks | Can that batch start earlier? |
|---|---|---|
| P4-SEM-A + E | **B11** coverage / readiness / status | No — B11 is the one batch that genuinely needs canonical work first |
| P4-SEM-C + D | **B12** candidate lifecycle / history | Partially — surfacing existing `structuredReviews` and derived lifecycle needs nothing new |
| voice convergence | **B13** voice | **Yes** — B13 can proceed on the frozen P1 shape without any P4-SEM primitive |
| historical cost | **B14** cost history | **Yes** — needs no canonical change at all |
| P4-SEM-B | **B17** per-frame continuity state | **Partially, and this is the surprise** — the runtime already supports per-frame states, so the UI work (making the panel reachable before frames are approved, and for all frames rather than the selected pair) can proceed now. Only *export fidelity* waits on B. |

**B13, B14 and most of B17 do not need to wait for P4.** Planning only — none of them is started here.

### 17.5 Relationship to B2b

**No B2b work was performed and none is proposed.** The working motion-readiness system is untouched. Recorded as a forward dependency only:

- **P4-SEM-C** gives a labelled frame-pair corpus stable artefact identity, so a comparison result can be attributed to specific bytes rather than to a filename that approval may since have renamed.
- **P4-SEM-B** supplies the declared state for each endpoint of a pair — which is precisely the missing input that let B2a's original defect happen at all (nowhere did CineBraid hold the requirement as data). A labelled comparison that knows Frame A declares `clean/dry` and Frame B declares `wet/injured` can distinguish intended change from drift; one that does not, cannot.
- **P4-SEM-D** makes "a human accepted this deviation" durable, so a corpus does not re-litigate settled pairs.

All three would make B2b easier and safer. **None of them is a reason to start B2b**, and B2b remains after the labelled corpus comparison, as B2a's follow-up #4 recorded.

---

## 18. Unresolved architectural questions

These are genuine forks that this pass declined to settle on its own authority. Each blocks a specific batch.

**Q1 — Where does the state binding live: OFP core, or the `continuity` profile's interior?**
Blocks batch 6 (P4-SEM-B). The audit argued core (`:523`, declared intent is production truth). The counter-argument is that `continuity` was declared passthrough precisely so its interior could be designed deliberately. This document recommends **core**, because `server.js:5159` already uses the binding to choose the reference authority image — so a tool that strips profiles would silently change what the film looks like. Must be settled by name before implementation.

> **SETTLED 2026-08-10 — the answer is the `continuity` profile, not core.**
> See `CINEBRAID_OFP_P4_SEM_Q1_DECISION_2026-08-10.md`, which **supersedes the recommendation in this section and the matching one in §11**.
>
> The core recommendation above does not survive examination. The authority image is a *generation input*, not the work; the film artefact is the approved asset, which is core and reachable without continuity semantics. Two further facts settle it: every `ref:` in the contract resolves through a **global flat index**, and state IDs are **not globally unique** — all 12 state records in `overfit-18` share the id `state-default` — so core could not express the reference without inventing a relative-reference mechanism; and `references[].subject` can already address a state (`prop:prop-case/state:st-case-open`), so putting bindings in the profile orphans nothing.
>
> Consequences recorded in the decision: **P4-SEM-B drops from VERY HIGH to MEDIUM–HIGH**, `SHOT` and `FRAME` are not touched at all, P4-SEM-C becomes the highest-risk P4-SEM batch, and synthetic continuity fixtures become a new prerequisite — the real Overfit corpus is entirely 6.6-era and exercises this path zero times.

**Q2 — Is `ASSET.storage` required for P4-SEM, or deferred to export (P6)?**
Blocks nothing immediately; P3 §10.1 judged it not blocking G4. It becomes load-bearing at export. Deferring it is defensible; deciding it late is not, because migration rules written without it would need revisiting.

**Q3 — Does `COVERAGE` gain a `kind`, or do expressions stay a separate collection?**
Blocks batch 3. Collapsing `expressionSlots[]` into `coverage[]` with a discriminator is tidier and reduces three slot collections to two; keeping them apart is more conservative and matches the existing UI. Not settled here.

**Q4 — Does `continuityStates[]` remain a third slot-like collection?**
A state carries an `approvedFile` and a requirement, so it behaves as a coverage slot while meaning something else entirely (a *variant of the thing*, not a *view of it*). OFP already separates them (`states[]` vs `coverage[]`) and that separation looks right — but the readiness contract has to consume both, so the relationship needs stating explicitly.

**Q5 — Should a rejection ever become an OFP statement?**
This document says no (the candidate is not a document value). If a future profile models candidates as addressable subjects, the answer changes. Worth revisiting only if that profile is ever proposed.

**Q6 — P0 Q2, statement-volume scaling at 1,500 shots.** Outstanding since P2 §16 and not settled by P3's one-film measurement. P4-SEM-D adds `approved` statements to the volume for the first time — sparse and human-paced, so unlikely to be the trigger, but it is the first primitive that adds statements at all.

---

## 19. Pass accounting

**Authoritative sources inspected**

Documents: `CINEBRAID_P0_ARCHITECTURE_DECISION_2026-08-09.md` (§2, §3, §5, §6, §8, §11, §12), `CINEBRAID_OFP_P1_DRAFT_CONTRACT_2026-08-10.md` (§14, §15, §16, §17), `CINEBRAID_OFP_P2_MIGRATION_FRAMEWORK_2026-08-10.md`, `CINEBRAID_OFP_P3_OVERFIT_GOLDEN_FIXTURES_2026-08-10.md` (§7, §9, §10, §14), `CINEBRAID_CANONICAL_FORMAT_AUDIT_2026-08-09.md` (Parts on entities, frames, continuity, Part 27 matrix).

Implementation: `ofp/ofp-schema.js`, `ofp/ofp-diagnostics.js`, `ofp/ofp-migrate-rules.js` (M017, M022, M030, M031, M060, M080), `media-assets.js`, `media-asset-store.js`, `generation-contracts.js`, `generation-job-store.js`, `fal-generation.js`, `server.js` (`projectReadinessIssues`, frame authority assembly), `public/entities.js`, `public/focused-workspaces.js`, `public/continuity-workspace.js`, `public/shared-continuity.js`, `public/shared-reference-views.js`, `public/review.js`, `public/library-tools.js`, `public/creation-studio.js`, `public/reports.js`, `public/automation.js`, `config.js`.

Tests and fixtures: `tests/ofp-overfit-conformance.js`, `tests/asset-lifecycle.js`, `tests/generation-job-contract.js`, `tests/run-full-check.js`, `tests/fixtures/ofp-migration/overfit/goldens/summary.json`, `package.json` script registry.

**Regression gates confirmed present**

| Gate | Scripts | Registered in |
|---|---|---|
| **B1** generation-default inheritance | `check:generation-defaults`, `-negative`, `-browser` | `tests/run-full-check.js:65-66` (full runner). *Not* in `check:ci`. |
| **B2a** candidate-review semantics | `check:candidate-review`, `-negative`, `-browser` | `tests/run-full-check.js:29-30` **and** `check:ci` |
| **OFP core** | `check:ofp-core` → 8 suites | `check:ci`, `check:quick`, full runner |

A note worth carrying: the B1 gate is in the full runner but not in `check:ci`, while B2a's is in both. That asymmetry is pre-existing and was not changed here.

**Files created by this pass**

- `docs/architecture/CINEBRAID_OFP_P4_SEMANTIC_RECONCILIATION_2026-08-10.md` (this document)
- `docs/architecture/CINEBRAID_OFP_P4_IMPLEMENTATION_PLAN_2026-08-10.md`

No machine-readable matrix was produced. §14 carries the classification in full, nothing in the repository would consume a JSON copy, and an unconsumed second copy of a table is a drift source rather than an asset.

**Files changed:** none.

**Final working tree:** clean, on `docs/p4-semantic-reconciliation`, two added documents, no other modification.

---

## 20. Declarations

```
Did this pass modify production code?        NO
Did this pass modify the OFP/schema?         NO
Did this pass begin P4 implementation?       NO
Did this pass begin B2b?                     NO
```

**Exact recommended next implementation task**

**Settle §18 Q1 — core versus the `continuity` profile for the declared entity-state binding.** It is the only question that blocks the highest-risk primitive, it cannot be answered by more code reading (this pass established every fact bearing on it), and answering it wrong is expensive to reverse once documents carry the field.

If implementation must begin before that is settled, begin with **batch 0a — historical job cost**. It has no dependencies, no OFP impact, no migration, an already-written and already-tested contract to populate, and it removes a live defect in which a Settings change silently rewrites a project's spending history.

---

## HARD STOP

No design was implemented. No production code, schema, migration, validator, test or version marker was changed. No P4 code batch was started, no B2b work was started, no UX batch was started, no PR was opened, and no project was migrated, opened or converted. The contract remains `1.0-draft.1`.

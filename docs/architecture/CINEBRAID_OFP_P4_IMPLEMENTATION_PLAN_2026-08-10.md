# CineBraid — OFP P4-SEM: implementation plan

**Companion to `CINEBRAID_OFP_P4_SEMANTIC_RECONCILIATION_2026-08-10.md`. Nothing here is implemented.**

Baseline `d028541` · application `6.7.0-private.1` · contract `1.0-draft.1`.

The reconciliation document establishes *what* P4-SEM means. This one is the forward work: batch boundaries, entry and exit conditions, and the evidence each batch must produce before it merges. It deliberately does not contain code, field spellings beyond those already argued, or rule IDs beyond the frozen ones — those are the implementing PR's to propose.

---

## 1. Reading order and prerequisites

Two things gate almost everything, and neither is a P4-SEM primitive:

1. **Roadmap-P4 canonical persistence.** INV-R2 and INV-R3 as live behaviour, retiring `normalizeProjectV5`, switching runtime save and load. Frozen as P4 scope since P1 §16 and restated in P3 §14. Three of the five primitives are inert without it — you cannot migrate a field into a document nobody loads. It is a separate phase with its own plan and its own risk profile.
2. **§18 Q1** — whether the declared entity-state binding lives in OFP core or becomes the first interior of the `continuity` profile. Blocks the highest-risk batch. Answerable now; more code reading will not help.

Everything in **Wave 0** below is free of both.

---

## 2. Batches

Each batch is sized to be reviewable in one sitting and to fail loudly on its own. No batch depends on a later one.

### Wave 0 — no format impact, may start immediately, parallelisable

#### 0a · Historical job cost
**Risk LOW · unlocks B14 · depends on nothing**

*Problem.* `job.accounting` is never written; every historical cost surface computes `imageCount × CONFIG.generation.fal.estimatedCostPerImage` (`public/reports.js:60-61`, `public/automation.js:434`). A Settings change silently rewrites a project's spending history, a 512px draft and a 4K render cost the same, and a project whose owner never filled the field reports `$0.00`.

*Change.* Populate `accounting` on the generation-job record at submit time using the already-written, already-tested `validateCostEstimate` contract (`generation-contracts.js:645`). Record `confidence` honestly — `estimated` when CineBraid computed it, `quoted` when the provider priced this job (with `quotedAt`), `unknown` when neither. Add the provider-returned actual as a separate labelled fact when one comes back; never overwrite the estimate with it. Make every historical surface read stored values only.

*Boundaries.* No OFP change. No provider pricing tables in project data. No new ledger — `generation-jobs.json` already exists and is already durable.

*Exit evidence.*
- A job submitted today carries `accounting` that validates against the existing contract.
- Changing `estimatedCostPerImage` in Settings does **not** alter any already-recorded figure.
- A legacy job with no `accounting` renders **"not recorded"**, never `$0.00` and never today's rate applied backwards. (Precedent: B2a's reviewer attribution — *"Not recorded for this review"* rather than borrowing today's Settings value.)
- Estimate and actual are distinguishable in the record and on screen.
- `check:generation-core`, `check:fal`, full runner green.

#### 0b · M022 mint `sourcePath`
**Risk LOW · unlocks nothing · depends on nothing**

*Problem.* P2 §7 requires every mint to record its source path. M022's prose-derived relations mint with `sourcePath: null`, though the accounting claim for the same relation names the sentence it came from. Pinned at `tests/ofp-overfit-conformance.js:339-340`, scoped to M022 so a second rule cannot join it quietly.

*Change.* Carry the sentence pointer the accounting claim already holds into the mint record.

*Exit evidence.* The scoped assertion inverts to "no mint anywhere lacks a source path"; the two `bookend-of` relations and their two `suggested` statements are otherwise byte-identical across all 18 goldens; golden drift is reviewed, not incidental.

#### 0c · M080 `token` false positive
**Risk LOW–MEDIUM · unlocks nothing · should land before batch 4 · depends on nothing**

*Problem.* `SECRET_WORDS` contains `token` as a standalone word and `keyLooksSecret()` consults the key name only, so `/shots/0/promptBuilder/spec/references/0/token` holding `"#image1"` — a prompt reference placeholder — is quarantined. Two `migration.secret.quarantined` warnings are pinned in the golden summary for `overfit-14-hub-v4-3`.

*Change.* Move `token` from `SECRET_WORDS` into `SECRET_WORD_PAIRS` (`access token`, `refresh token`, `bearer token`, `auth token`, `api token`).

*Rejected alternative.* Consulting the value's shape. A security boundary that depends on the value it is inspecting is weaker than one depending only on the key, and the value-shape branch (`valueLooksSensitive`) exists for a different purpose. P2 §8 already chose the safe side deliberately; this narrows the rule rather than softening it.

*Exit evidence.* The two `overfit-14` warnings disappear and `"#image1"` survives into the document; every other quarantine count across all 18 goldens is unchanged; a negative control proves `apiToken`, `falApiKey`, `api_key` and `API-KEY` are all still refused.

#### 1 · Voice convergence
**Risk MEDIUM · unlocks B13 · depends on nothing**

*Problem.* Four places hold voice-ish truth: `P.audio[]` entities, `character.audio.voiceDesignPrompt`, legacy `character.voiceId`, and per-shot `shot.audio.voiceEntityId`. The first two disagree about whether a character's voice is ready. Separately, audio entities inherit image-reference semantics (`coverageSlots[]`, `continuityStates[]`) that a voice has no use for.

*Change.* The audio entity owns the voice record; the character surface renders a **view** of the linked voice rather than a second store. Voice *design prompt* is provider configuration and moves to app-local/extension. Fix the type boundary so audio entities stop carrying image-coverage semantics.

*Why this needs no design work.* The OFP shape is already frozen (P1 §14: a voice is first-class, a character points at it, a voice carries no `characterId`) and already migrated (M017). This batch converges the runtime onto a settled target.

*Boundaries.* No OFP change. No References UI work beyond removing controls that were never meaningful for audio. B13 proper stays out.

*Exit evidence.*
- Character surface and audio entity agree on voice readiness **by construction**, not by a second calculation — a test asserts there is one reader.
- An audio entity exposes no image-coverage semantics.
- Multi-voice-per-character, multi-character-per-voice, and unlinked narrator all still work.
- `check:ofp-core` green; M017's migration behaviour unchanged.

### Wave 1 — after canonical persistence

#### 3 · P4-SEM-A · coverage requirement semantics
**Risk MEDIUM · unlocks B11 · own golden corpus required**

*Change.* `COVERAGE.requirement` enum (`required` | `planned` | `not-required`) on character/location/prop/vehicle; `coverage[]` added to `CHARACTER`; migration inferring from the live precedence order (`referenceRequirement` → `requirement` → `required===false ? planned : required`); `required` retired by a **named** rule.

*Settle first:* §18 Q3 — whether expressions collapse into `coverage[]` with a discriminator or stay a separate collection.

*The one non-obvious hazard.* `requirement` currently arrives as an **unknown property** and is preserved with a `schema.unknown-property` warning. Declaring it converts a warning into structural validation, and out-of-enum legacy values become `schema.enum.unknown` — still a warning, still never coerced, but the diagnostic changes for existing documents. **All 18 Overfit goldens must be re-measured for that shift and it must be a reviewed golden change.**

*Exit evidence.*
- Validator units for the enum, including an out-of-enum value that is preserved and reported, never coerced.
- Migration goldens: one slot per requirement value; one with both encodings agreeing; one where `required: true` contradicts `requirement: "not-required"` → a `disputed` statement plus `migration.review.required`, never a silent precedence win.
- Round-trip, determinism, idempotency.
- **Negative control:** precedence silently resolves the contradiction — probe proves the defect live, then the guard fires.
- **The divergence fixture:** the `requirement: "not-required"` slot with no `required: false` twin, asserted to classify identically everywhere.
- INV-R1 unchanged across all ten document classes.

#### 4 · P4-SEM-C · artefact identity activation
**Risk HIGH · unlocks B12 · prerequisite of batch 5 · own PR and own golden corpus**

*Change.* `ASSET.storage.path` (optional, project-relative, validated by the rule the ledger already uses). Approvals point at `assetId` rather than a filename. The MediaAsset ledger becomes the authority for **location** — and for nothing else. It continues to decide nothing about approval.

*Settle first:* §18 Q2 — whether `ASSET.storage` lands here or defers to export (P6). Deferring is defensible; deciding late is not, because migration rules written without it need revisiting.

*The hazard this batch exists to remove.* `confirmEntityApproval` renames the file and then hand-patches every filename-keyed edge it knows about (`public/library-tools.js:539-543`). Any edge it does not know about breaks silently.

*Exit evidence.*
- **The rename/move test, which is the whole point:** approve an artefact, rename it, move it, and assert the approval edge survives all three.
- Ledger → document identity round-trip.
- Path-shape negative controls: absolute, drive-qualified, UNC, `..`.
- Two assets legitimately sharing one `contentHash` remain two records.
- `hashState: unavailable` retains a previously established digest.
- INV-R1 unchanged — activation must not make opening a project write a ledger.
- Full `check:mediaasset-core` (9 suites) green.

#### 5 · P4-SEM-D · human decision as an immutable act
**Risk MEDIUM · unlocks B12 · hardens B2a · depends on batch 4**

*Change.* A human approval becomes an `approved` statement: human actor (required), `note` for the reason, `evidence.observationId` referencing the AI review it agreed with or overrode. A changed decision **appends** a new statement; nothing is mutated (P0 §5 case 3). AI verdicts stay workflow provenance and are referenced by id, never embedded into the authoritative act.

*Two constraints that must survive review.*
- **Sparsity.** P3 §8 measured 1.25–1.82 statements per shot against a guarded ceiling of 3.0. One statement per human approval is fine; one per AI review is not. P0 §5's fence — *routine model observations stay in the sidecar and are never promoted automatically* — is load-bearing here.
- **B2a's separation.** AI advisory, human authoritative. The schema enforces this via `statement.actor.not-human` as an **error**, which is strictly stronger than the runtime guard. This batch hardens B2a; it does not revisit it.

*Exit evidence.*
- Statement units including `actor.missing` and `actor.not-human` on `approved`.
- Append-not-mutate proven on a changed decision; the earlier act still readable.
- `evidence.observationId` survives an observation-cache clear (P0 §5 case 6's whole justification).
- Statement-volume regression against the 3.0/shot and 0.10/source-value ceilings on the full corpus.
- **Negative control:** an AI pass performs the approval — extend B2a's NC-F rather than writing a second one.
- Legacy `approvedFile`/`approvedAt` migrate to `references[]` edges with **no** statement, which is correct: authored data carries no statement.

#### 6 · P4-SEM-B · declared entity-state binding
**Risk VERY HIGH · unlocks B17 and de-risks B2b · own PR and own golden corpus, unconditionally**

*Blocked on §18 Q1.* Do not start until core-versus-profile is settled by name.

*Change.* `SHOT.subjects[].stateId` (shot default) and `FRAME.subjects[]` (per-frame override). **Key omitted = inherit** — no explicit same-as-shot marker. Migration collapses `shot.continuityStateSelections{}` and `frameWorkflows[fid].{character,prop,vehicle}StateSelections` / `.locationStateId` into the two canonical forms.

*Why the risk is lower than it looks.* The frame → shot → default rule is **already implemented, already written, already read, and already drives reference-authority selection** (`public/shared-continuity.js:257-281`; `public/server.js:5158-5161`). This batch canonicalises proven behaviour rather than inventing a relationship.

*Why the risk is still VERY HIGH.* It touches the shot record — the most-read structure in the format — changes the containment surface, collapses four legacy spellings into one, and a mapping error changes which authority image reaches a generation, i.e. it changes generated output.

*Exit evidence.*
- Validator units for `state.binding.unresolved`, `.entity-unlisted`, `.duplicate`.
- Goldens: a cross-state first/last pair (the Frame A `clean/dry` → Frame B `wet/injured` case); a 3-frame shot proving no first/last special-casing; a shot with no selections at all.
- Migration determinism and idempotency; the four legacy spellings collapse by a **named** rule.
- An orphan binding (a frame naming an entity the shot does not list) becomes a `disputed` statement — migration must not invent a `subjects[]` entry.
- **Negative control:** an explicit override collapses into inheritance.
- **Behavioural, not source-string:** drive the real authority assembly and assert the same image is selected for the same frame before and after canonicalisation, on a real project.

#### 7 · P4-SEM-E · derived readiness contract
**Risk MEDIUM · unlocks B11 · depends on batches 3 and 1**

*Change.* One shared contract module owning the derivation. Two authored inputs (`requirement`, and the approval edge / statement badge); four derived words (`not started`, `in progress`, `ready`, `blocked`). No stored `entityReady`, ever. No UI wording in the contract — it emits outcome tokens and the browser renders words, exactly as `shared-continuity.js` does.

*The three calculators it replaces.* `server.js:924` `projectReadinessIssues()` (never reads coverage at all), `public/entities.js:945` `boundedEntityTaskStatus()` (via `referenceRequirement`), `public/focused-workspaces.js:257` `entityInspector()` (reads the retired boolean only). They currently answer different questions over different inputs, which is why they can all be right and still disagree on screen.

*Exit evidence.*
- One contract, N surfaces, no local re-derivation.
- **Negative control:** a surface re-derives readiness locally and the guard fires — mirroring the existing test that forbids the browser reading continuity contract internals.
- The §4 divergence fixture classifies identically on every surface.
- Purely subtractive: no new persisted field anywhere.

---

## 3. Sequence

```
Wave 0   ── 0a cost ─────────────────────────────────────────────► B14
   (now)  ── 0b M022 ────────────────────────────────────────────►
          ── 0c M080 ───────────────────────────────┐
          ── 1  voice ──────────────────────────┐   │            ► B13
                                                │   │
         [ roadmap-P4 canonical persistence ]   │   │
                        │                       │   │
Wave 1   ── 3 P4-SEM-A ─┼───────────────────────┼───┼──┐         ► B11 (with 7)
          ── 4 P4-SEM-C ┼───────────────────────┼───┘  │         ► B12 (with 5)
                        │                       │      │
          ── 5 P4-SEM-D ┘ (needs 4)             │      │
          ── 6 P4-SEM-B   (needs Q1)            │      │         ► B17, de-risks B2b
          ── 7 P4-SEM-E   (needs 3 and 1) ◄─────┘──────┘         ► B11
```

**Parallelism.** 0a, 0b, 0c and 1 are mutually independent and independent of the format. In Wave 1, batches 3, 4 and 6 are mutually independent once their prerequisites hold; 5 waits on 4; 7 waits on 3 and 1.

**What must never share a PR:** batch 6 with anything (shot record plus reference-authority selection is the highest-consequence edit in the set), and batch 4 with anything (the rename/move identity path).

---

## 4. Cross-cutting gates

Every batch, without exception:

| Gate | Why |
|---|---|
| `check:ofp-core` — 8 suites | contract, serialization, INV-R1, negative controls, migration, migration negatives, Overfit conformance, Overfit negatives |
| INV-R1 across all ten document classes | opening a project must still write nothing; the wrapper asserting zero writes must still be armed |
| Determinism + idempotency | same input, same migration version ⇒ byte-identical output; re-migrating the output is a no-op |
| Unknown-extension and unknown-enum preservation | the G2 gate; the R7 catastrophe |
| Full 18-generation Overfit corpus | with any golden drift reviewed as a deliberate act, never incidental |
| Statement-volume ceilings | 3.0/shot, 0.10/source value |
| M080 and M022 regressions | once 0b/0c land, they stay landed |
| `check:ci` and the full runner | B1 and B2a gates included |

**Negative-control discipline**, non-negotiable and already established in this repository: every control reintroduces exactly one defect, **proves the defect is live with a probe**, and only then requires the guarded property to fail. Anchors match LF-normalised source, must be unique, and must actually change the text. The defect is compiled in memory and installed in the module cache — **nothing is written to disk and nothing is reverted with `git checkout`**, because a broad checkout has already discarded unrelated unstaged work in this repository once.

---

## 5. What this plan does not authorise

- Any change to the five frozen statement acts.
- A stored `entityReady`, a stored coverage count, or a stored candidate-disposition enum.
- Provider pricing tables inside project data.
- Promoting AI review output to an authoritative act, or letting an AI actor approve.
- A `characterId` on a voice.
- An explicit same-as-shot marker on a frame binding.
- Persisting archive/hide, panel expansion, selected tab or selected pair into `project.json`.
- Any B2b work.
- Starting B11 before batches 3 and 7. (B13, B14 and most of B17 are **not** blocked — see the reconciliation document §17.4.)

---

## HARD STOP

This plan is not an authorisation to implement. The next action is to settle §18 Q1, not to open a batch.

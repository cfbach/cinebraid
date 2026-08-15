# CineBraid — Entity-State Truth Surface Matrix

**Branch:** `fix/dogfood2-production-truth-simplification`
**Replaces:** `ENTITY_DERIVATION_DECISION_TABLE.md` (deleted)
**Date:** 2026-08-15

---

## Why this replaces the decision table

The decision table asked one question — *can this derive?* — and traced it well.
Codex accepted that answer and then found the next one: derivation was fixed
while **presentation and readiness** were still deciding for themselves. A state
could be refused derivation by the generator and, on the same screen, be captioned
"Approved", offered a VALIDATE button, and badged APPROVED VARIANT.

So the unit of the audit is no longer a decision. It is a **surface**, and every
surface answers four separate questions that were previously allowed to disagree:

| Column | The question | Who may answer it |
|---|---|---|
| **Truth classification** | what standing does this surface believe the state has? | `entityStateTruth` / `assetStateParentMedia` only |
| **Presentation** | what does it show and say? | must follow the classification |
| **Readiness** | what does it enable, offer, or un-disable? | must follow the classification |
| **Side effect** | what can it write, spend, or dispatch? | must follow the classification |

A surface is aligned when all four come from one standing. A surface is a defect
when any column is decided by a raw pointer — `state.approvedFile`,
`parentInfo.fileName`, `!!parentInfo.media`.

---

## How completeness was established

Not by grep. The last inventory was built by searching for names that look like
approval, and it missed the entire derivation subsystem because that subsystem
never used such a name — it asked `!!parentInfo.media`. A surface that infers
authority from raw media presence is, by construction, invisible to a search for
authority words.

This matrix was built by **tracing the finite render tree** of the entity route
and the finite set of entry points that name a state:

1. **`#/<type>/<id>` composes exactly four tasks** (`public/entities.js:1440`):
   `reference`, `review`, `coverage` ("Coverage & states"), `details`. Every
   state-bearing region on the page is reachable from one of the four.
   - `reference` → `referenceWorkspaceMarkup` → `entityAuthoritySummaryMarkup`,
     `referenceCreationHub`, `entityStateTruth`
   - `coverage` → `entityCoverageStatesMarkup` → `continuityStatesPanel`, which
     composes the focused state card: head actions, hero, validation workspace,
     scope/readout, prompt studio, candidate tray
   - `review` / `details` → candidate rows and records; they hold no state
     standing of their own
2. **Five modals** are opened from those tasks: `openContinuityStateVariant`,
   `openContinuityStateVariantHub`, `openStateReferenceUpload`,
   `openFalEntityGenerationModal`, `openAcceptStateDifference`.
3. **Every `window.*` entry point in `entities.js`, `creation-studio.js` and
   `fal-generation.js` whose parameters name a state** — enumerated from the
   function declarations, not searched for by keyword.
4. **Three automation entry points** in `automation.js` and **two server routes**
   in `server.js` that receive a state.

That is the boundary. Nothing outside those five groups can render or act on an
entity state, because nothing outside them is reachable with one.

---

## The one reader

`assetStateDerivation(list, entity, state)` — `public/creation-studio.js:425`,
over `assetStateParentMedia` → `entityProductionTruth`. Presentation-only
surfaces read `entityStateTruth(list, entity).of(state)` — `public/entities.js:339`
— which is the same projection with no derivation question attached.

| Field | Meaning | Authority |
|---|---|---|
| `standing` | `canon` / `historic` / `none` | the receipt ledger |
| `file` | the image, whatever its standing | none — it is a pointer |
| `canDerive` | **the only thing that may enable derivation** | `requested === "derive" && media && standing === "canon"` |
| `mode` | effective mode | `canDerive ? "derive" : "independent"` |
| `contextFile` | the parent image whatever its standing | none — display/context |
| `reason` | why derivation is unavailable | derived |

---

## The matrix

**T** = Truth classification · **P** = Presentation · **R** = Readiness ·
**S** = Side effect. Each cell states what the surface does **with a HISTORIC
state or a HISTORIC parent** — the case that was wrong.

### A. The reference task

| # | Surface | T | P | R | S |
|---|---|---|---|---|---|
| A1 | `entityAuthoritySummaryMarkup` row badge | `entityStateTruth` | `HISTORIC`, with "Historic, not approved" beside it | preview only | none |
| A2 | same row, a11y label | `entityStateTruth` | "Preview the historic … which has not been approved" | — | none |
| A3 | same row, inspector title | `entityStateTruth` | "historic image" | — | none |
| A4 | `referenceCreationHub` primary summary | `entityStateTruth` | reports the primary as work still to do | offers approval, not generation | none |
| A5 | `boundedEntityTaskStatus` tone | `entityStateTruth` | `attention`, not `complete` | — | none |

### B. The coverage & states task — the focused state card

| # | Surface | T | P | R | S |
|---|---|---|---|---|---|
| B1 | head action button | `entityStateTruth` on state **and** parent | `OPEN STATE WORKFLOW` (not EDIT / REGENERATE, not GENERATE FROM an unapproved parent) | opens the workflow | none |
| B2 | hero image `alt` | `entityStateTruth` | "Historic image for X, not approved" | — | none |
| B3 | hero theatre caption | `entityStateTruth` | "X historic image · file" | opens the theatre | none |
| B4 | hero derivation line | parent's `entityStateTruth` | "P is not approved as canon — this state cannot derive from it yet" | — | none |
| B5 | approved readout | `entityStateTruth` | label "Historic image · not approved", hint "Previously selected. Approve it to make it canon." | — | none |
| B6 | `continuityStateValidationCurrent` | both sides | a stored finding is **discarded** unless both sides are still canon and unchanged | — | none |
| B7 | `continuityStateValidationMarkup` heading | both sides | "Approve both sides before validating" | — | none |
| B8 | same, blocked reason | both sides | names the exact file and the exact fix | — | none |
| B9 | same, VALIDATE button | both sides | — | **disabled** | none |
| B10 | same, thumbnails + alt | both sides | "Historic parent image for P, not approved" | — | none |
| B11 | `continuityStateCandidateTray` copy | parent's `entityStateTruth` | "Generated independently — P has not been approved as canon" | — | none |
| B12 | `assetStatePromptStudio` card | `assetStateDerivation` | **PARENT NOT APPROVED**, naming the file | compile is offered; edit mode is not | none |
| B13 | `entityStateDerivationSummary` | `assetStateDerivation` | states the reason | — | none |
| B14 | `assetStatePromptMode` | `canDerive` | — | `t2i`, never `edit` | none |
| B15 | `assetStatePromptProfile` | `assetStatePromptMode` | — | a text-to-image profile | none |
| B16 | generation-mode `<select>` | — | the creator's choice is shown | — | **transient** — `PENDING_STATE_GENERATION`, committed only by `buildEntityStatePrompt` |

### C. The modals

| # | Surface | T | P | R | S |
|---|---|---|---|---|---|
| C1 | `openContinuityStateVariantHub` label | `entityStateTruth` | `HISTORIC · NOT APPROVED` / `PARENT NOT APPROVED` | — | none |
| C2 | same, card tone | `entityStateTruth` | `attention`, not `complete` | — | none |
| C3 | same, readiness line | parent's `entityStateTruth` | "file — not approved as canon" | **not** READY TO DERIVE | none |
| C4 | same, primary button | `entityStateTruth` | `OPEN STATE WORKFLOW`, not EDIT / REGENERATE | — | none |
| C5 | `openContinuityStateVariant` | — | opens the workspace | — | **none** — inspection does not write (C3 of the closure pass) |
| C6 | `openStateReferenceUpload` | — | upload UI | — | writes a pointer; **never** a receipt |
| C7 | `openFalEntityGenerationModal` | `assetStateDerivation` | shows the effective mode | opens independent | stashes a request; **binding on nothing** |
| C8 | `openAcceptStateDifference` | requires a current validation | — | unavailable without one | none |

### D. Actions the creator can take

| # | Surface | T | P | R | S |
|---|---|---|---|---|---|
| D1 | `approveEntityFile` | — | — | — | **the only path to Canon** — kernel `approveEntityStateCanon`, trusted gesture required |
| D2 | `validateContinuityStateAgainstParent` | both sides | refuses with the reason | — | **nothing submitted**, nothing written |
| D3 | `correctContinuityStateFromParent` | parent's standing | refuses with the reason | — | **writes nothing, dispatches nothing** |
| D4 | `acceptContinuityStateDifference` | the stored validation | — | — | writes an acceptance note; not a receipt |
| D5 | `buildEntityStatePrompt` | `assetStateGenerationMode` | — | — | **the commitment boundary** — commits the transient choice, then compiles |
| D6 | `generateMoreEntityStateCandidates` | `assetStateDerivation` | — | — | dispatches `independent`, `parentApprovedFile: ""` |
| D7 | `startFalEntityGeneration` | **re-reads** `assetStateDerivation` | — | — | dispatches `independent` even when the modal recorded `derive` |
| D8 | `setContinuityState*` | — | — | — | pointer/notes writes; never a receipt |
| D9 | `addContinuityState` / `removeContinuityState` | — | — | — | lineage writes by the creator only |

### E. Automation

| # | Surface | T | P | R | S |
|---|---|---|---|---|---|
| E1 | `v627EntityPreflight` | `assetStateParent` (exact) | reports invalid lineage | blocks the planner | **none** — preflight does not mutate |
| E2 | `v626EntityBuild` | `assetStateParent` + `standing === "canon"` | — | — | throws before any request, naming the file to approve |
| E3 | `v626AutomateEntityState` up-front check | `assetStateParentMedia` | — | — | throws before the run starts on this state |
| E4 | **the dispatch boundary** (`automation.js:2497`) | **re-reads** `assetStateDerivation` immediately before the body is built | — | — | refuses; **no paid request is constructed** |
| E5 | `approveAutomationCandidate` | — | — | — | commits Canon synchronously inside the creator's gesture |
| E6 | `v628AttachEntityAutomationProvenance` | — | — | — | records who asked; **never** an approval |

### F. Server

| # | Surface | T | P | R | S |
|---|---|---|---|---|---|
| F1 | `POST /api/prompt/asset-compile` | recorded parent + `entityProductionTruth` | — | — | 400 `STATE_ANCESTRY_UNRESOLVED` / 400 `PARENT_NOT_CANON` |
| F2 | `assetPromptContext.parentApprovedFile` | `entityProductionTruth` | — | — | `""` |

---

## Row E4 — why the boundary re-decides for itself

E3 refuses a historic parent before the run touches this state. It is a real
guard and it stays. It is also **not sufficient**, for a reason that has nothing
to do with code quality:

between E3 and E4 the run performs two network round trips — compile and improve
— and a creator can revoke an approval during them. A run resumed from a stored
step re-enters below E3 entirely. Before this pass, the request built at E4
hard-coded `derivationMode: "derive"` for any non-default state, so either
sequence produced a paid edit request against bytes nobody had approved.

E4 now reads the receipt-backed standing immediately before the request body is
constructed, through the same reader every other row uses. It does not recompute
derive from parent presence and it does not trust E3's earlier answer.

---

## What Historic media is still allowed to do

Preserved deliberately — a historic pointer is real work, not an error:

- it is **shown** — thumbnails, previews, the state hero, the candidate tray;
- it **travels to generation as context**, under `role: "historic-reference"`
  with an instruction saying it is not the decision;
- it is **named** in copy, so the creator can see exactly what is there;
- it is **one explicit click from Canon** — approving it is the whole upgrade
  path, and nothing migrates on its behalf.

---

## Regressions and mutation controls

`tests/entity-derivation-authority.js` — 69 checks, every one through a shipped
function; paid paths captured at the transport boundary. Fifteen source-mutation
controls, each of which reverts **one** shipped guard in memory, runs the same
shipped path, and requires the false claim to come back. A control that fails is
not a broken test — it means the assertion beside it is vacuous.

| Control | Guard reverted | Row | Proves |
|---|---|---|---|
| G1 | `standing === "canon"` in `canDerive` | one reader | derivation would open |
| G2 | `file: canDerive ? … : ""` | one reader | an unapproved file would be named approved |
| G3 | more-candidates reads the reader | D6 | a derive request would go out |
| G4 | dispatch re-decides for itself | D7 | the stale modal claim would be honoured |
| G5 | fal reference role by standing | B11/D6 | a historic parent would become `base` |
| G6 | validation requires canon both sides | D2 | the pair would be submitted as approved |
| G7 | correction requires a canon parent | D3 | it would write and dispatch |
| G8 | row badge reads standing | A1 | the pointer would badge APPROVED |
| G9 | a11y label reads standing | A2 | a screen reader would be told "approved authority" |
| H1 | hub label reads standing | C1 | `APPROVED VARIANT` returns |
| H2 | hub readiness reads parent standing | C3 | `READY TO DERIVE` returns |
| H3 | validation readiness reads both standings | B7/B9 | "Validate the approved state against its parent" returns and the button un-disables |
| H4 | hero `alt` reads standing | B2 | `alt="Approved Worn"` returns |
| H5 | head action reads both standings | B1 | `GENERATE FROM DEFAULT` returns on an unapproved parent |
| A1 | automation dispatch boundary (all three edits reverted together) | E4 | the revoked run reaches the transport with `derivationMode: "derive"` and the parent's bytes named as approved |

`tests/entity-truth-surfaces-real-browser.py` — the composed page in real
Chromium at `#/prop/PROP-PARCEL`, historic and canon, asserting rows A1–A2, B1–B3,
B5, B7–B9 and C1–C4 together. It carries its own source mutation: `entities.js`
is rewritten in flight, the readout's standing test is replaced with the raw
pointer, and the false `Approved image` label is proven to return.

Provider calls made by either suite: **0**.

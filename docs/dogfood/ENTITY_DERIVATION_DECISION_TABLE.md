# CineBraid — Entity-State Derivation Decision Table

**Branch:** `fix/dogfood2-production-truth-simplification`
**Scope:** every path from a stored parent pointer to a behaviour change, for entity continuity states.
**Date:** 2026-08-15

---

## A correction to the previous report, made first

The last handoff presented a **32-row "authority-sink inventory"** and claimed
each closure regression carried a mutation control. Both claims were weaker than
they read, and Codex was right to reject them:

1. **The inventory was produced by grep and reasoning, not by tracing execution.**
   It listed sinks I had found; it did not prove the list was closed. It missed
   the entire entity-derivation subsystem — five separate recomputations of
   "can this derive" in `fal-generation.js` and `creation-studio.js` that never
   appeared in it, because they ask `!!parentInfo.media` rather than naming any
   approval field a grep would match.

2. **One regression was falsely green.** The "historic parent cannot reach paid
   dispatch" test did not call the shipped dispatch path. It wrote its own
   `if (standing !== "canon") throw` inside the test body and asserted that its
   own throw occurred. It would have passed against a product with no guard at
   all — and it did exactly that, while `startFalEntityGeneration` was deriving
   from historic media the whole time. Its mutation control passed for the same
   reason: mutating the product could not affect a test that never called it.

Both are corrected here. The table below traces the graph rather than
enumerating names, and every regression in `tests/entity-derivation-authority.js`
invokes the shipped function, with paid paths captured at the transport
boundary.

---

## The invariant

> Only **Canon** parent media may enable derive/edit mode, approved/base
> authority, derivation readiness, validation authority, correction derivation,
> or paid dispatch.
>
> **Historic/Reference** media may remain visible and may travel as
> non-authoritative context. It may never independently produce any of them.

---

## The one reader

`assetStateDerivation(list, entity, state)` — `public/creation-studio.js`.

A thin reader over the existing receipt-backed projection; it adds no authority
architecture. `assetStateParentMedia` already resolves the parent's standing
through `entityProductionTruth`. This collapses five independent
re-derivations of one question into one answer:

| Field | Meaning | Authority |
|---|---|---|
| `requested` | what the creator chose (honours the transient draft) | none — a preference |
| `canDerive` | **the only thing that may enable derivation** | `requested === "derive" && media && standing === "canon"` |
| `mode` | the effective mode | `canDerive ? "derive" : "independent"` |
| `file` | the approved parent bytes — **populated only when Canon** | the receipt |
| `contextFile` | the parent image whatever its standing | none — display/context |
| `standing` | `canon` / `historic` / `none` | `entityProductionTruth` |
| `reason` | why derivation is unavailable | derived |

---

## The decision table

Every branch whose behaviour can change because a parent image exists.

| # | Stage | Site | Decision it makes | Gate | Historic parent result |
|---|---|---|---|---|---|
| 1 | stored pointer | `state.parentStateId` | which state is the parent | exact, no fallback (`assetStateParent`) | missing parent → `null`, everything below blocks |
| 2 | standing | `assetStateParentMedia` | canon / historic / none | `entityProductionTruth` | `standing: "historic"`, `media` still resolvable |
| 3 | **the one reader** | `assetStateDerivation` | `canDerive`, `mode`, `file` | `standing === "canon"` | `canDerive:false`, `mode:"independent"`, `file:""` |
| 4 | prompt mode | `assetStatePromptMode` | `edit` vs `t2i` | `canDerive` | `t2i` — the compiler never edits from it |
| 5 | profile default | `assetStatePromptProfile` | which image profile | `assetStatePromptMode` | text-to-image profile |
| 6 | readiness copy | `assetStateGenerationCard` | `DERIVE FROM X` vs warning | `canDerive` + `reason` | **PARENT NOT APPROVED**, naming the file and the fix |
| 7 | candidate tray copy | `entities.js` state tray | "Derived from approved X" | `entityStateTruth(parent)` | "Generated independently — X has not been approved as canon" |
| 8 | generation refs | `entityGenerationReferences` | `role: base` vs context | `parentInfo.standing` | `role: "historic-reference"`, never `base`, never "approved" |
| 9 | modal open | `openFalEntityGenerationModal` | `effectiveMode`, stashed request | `derivation.mode` | opens independent |
| 10 | more candidates | `generateMoreEntityStateCandidates` | request `derivationMode`, `parentApprovedFile` | `derivation.mode` / `derivation.file` | dispatches `independent`, `parentApprovedFile: ""` |
| 11 | **paid dispatch** | `startFalEntityGeneration` | the body sent to the provider | **re-reads `assetStateDerivation`**, ignores the stashed `requestedMode` | dispatches `independent` even when the modal recorded `derive` |
| 12 | validation | `validateContinuityStateAgainstParent` | submit the pair as approved | `entityStateTruth` on **both** target and parent | refuses; nothing is submitted |
| 13 | correction | `correctContinuityStateFromParent` | switch the state into `derive` | `entityStateTruth(parent)` | refuses; writes nothing, dispatches nothing |
| 14 | authority row | `entityAuthoritySummaryMarkup` | `CANON` / `HISTORIC` / `MISSING` badge | `entityStateTruth` | `HISTORIC`, matching the note beside it |
| 15 | a11y label | same row | what a screen reader is told | `entityStateTruth` | "Preview the historic … which has not been approved" |
| 16 | inspector title | same row | preview caption | `entityStateTruth` | "historic image" |
| 17 | server compiler | `/api/prompt/asset-compile` | exact ancestry, editable base | recorded parent + `entityProductionTruth` | 400 `STATE_ANCESTRY_UNRESOLVED` / 400 `PARENT_NOT_CANON` |
| 18 | server context | `assetPromptContext` | `parentApprovedFile` | `entityProductionTruth` | `""` |
| 19 | automation build | `v626EntityBuild` | paid entity-state run | `assetStateParent` + `standing === "canon"` | throws before dispatch, naming the file to approve |
| 20 | automation preflight | `v627EntityPreflight` | blocks the planner | `assetStateParent` (exact) | reports invalid lineage |

**Independent re-check at the boundary (row 11) is deliberate.** Rows 6, 9 and 10
are UI/preflight decisions and can go stale — a receipt may be revoked between
opening the modal and pressing generate. The dispatch path re-reads the
derivation rather than trusting `request.requestedMode`, and the regression
forges that stale claim to prove it.

---

## What Historic media is still allowed to do

Preserved deliberately, because a historic pointer is real work:

- it is **shown** — thumbnails, previews, the state hero, the candidate tray;
- it **travels to generation as context**, under `role: "historic-reference"`
  with an instruction saying it is not the decision;
- it is **named** in copy, so the creator can see what is there;
- it is **one explicit click from Canon** — approving it is the whole upgrade
  path, and nothing migrates on its behalf.

---

## Regressions

`tests/entity-derivation-authority.js` — 53 checks, every one through the
shipped function. Nine mutation controls, one per real product guard, each
confirmed to turn the suite red:

| Control | Guard removed | Went red on |
|---|---|---|
| G1 | `standing === "canon"` in `canDerive` | "but derivation is not available" |
| G2 | `file: canDerive ? … : ""` | "no approved parent file is produced" |
| G3 | more-candidates reads the reader | "it is dispatched independently" |
| G4 | dispatch re-decides for itself | "the DISPATCH BOUNDARY re-decided…" |
| G5 | fal reference role by standing | "a historic parent is never a base" |
| G6 | validation requires canon both sides | "never submitted to validation as approved" |
| G7 | correction requires a canon parent | "and writes nothing at all" |
| G8 | row badge reads standing | "does not simultaneously badge it APPROVED" |
| G9 | a11y label reads standing | "no accessibility label describes historic media as approved authority" |

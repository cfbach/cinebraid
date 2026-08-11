# CineBraid — OFP P4-SEM Q1: where the declared entity-state binding lives

**Architecture decision record.** Analysis and decision only — no production code, schema, migration or version marker is changed by the pass that produced this document.

| | |
|---|---|
| Question | §18 Q1 of `CINEBRAID_OFP_P4_SEMANTIC_RECONCILIATION_2026-08-10.md` |
| Status | **Settled** |
| Baseline | `42cda90` (PR #49 merged) · application `6.7.0-private.1` · contract `1.0-draft.1` |
| Supersedes | the provisional *core* recommendation in the reconciliation's §11 and §18 Q1 |

---

## DECISION

> **The declared entity-state binding belongs to the `continuity` profile, not to OFP core.**
>
> Core keeps entity identity, the catalogue of states, frame identity, and the approved-image edge. The continuity profile owns *which declared state a shot or a frame selects*, and owns the frame → shot → entity-default inheritance rule.

The working hypothesis that prompted this question — *generic frame/entity identity in core, frame-specific continuity-state binding in the profile* — is **upheld**, and upheld for stronger reasons than the hypothesis itself gives.

**This reverses the reconciliation's own provisional recommendation.** That document recommended core on the grounds that the binding "already determines what the film looks like", because `server.js` uses it to select the reference authority image. That argument does not survive examination: the authority image is a **generation input**, not the work. The film artefact is the approved asset, which is recorded in core and needs no continuity semantics to find. The earlier reasoning conflated production process with product — precisely the line the profile criterion draws.

---

## Plain-English reason

A frame already says what it is. In the contract's own representative document the frame reads:

```json
{ "id": "fr-a", "role": "first", "description": "Mara settled, case sealed across her knees." }
```

and once the frame is approved, the bytes that *show* the sealed case are reachable through `references[]` and `assets[]`, both in core.

The state binding does not add the fact that the case is sealed. It **restates that fact in a machine-checkable form** so continuity tooling can verify a candidate against a declared intent instead of parsing English. That is production behaviour, and production behaviour is what a profile is for.

A scheduler, a breakdown tool or an export viewer can read this film correctly — every shot, every frame, every cast member, every approved image — without ever knowing that `prop-case` has a sealed variant and an open one. Forcing all of them to implement entity-state semantics in order to read a shot's cast list is exactly the unnecessary requirement the profile criterion exists to prevent.

---

## The evidence that decided it

### 1. Core cannot express the reference, and the contract already says so

Every `ref:` in the contract resolves through one function:

```js
function recordExists(type, id) {
  if (type === "entity") return recordIndex.entityIds.has(id);
  const records = recordIndex.byType.get(type) || [];
  return records.some((entry) => entry.id === id);
}
```

That is a **global flat index by type**. `ref: "location"`, `ref: "shot"`, `ref: "voice"`, `ref: "asset"`, `ref: "source"` are all project-wide.

**State IDs are not globally unique**, and not marginally so. In `overfit-18-cinebraid-581.ofp.json`, a real migrated golden, all **12 state records across every entity carry the id `state-default`**. `state` is scoped by the containment table to character / location / prop / vehicle, and `id.duplicate` is defined as *"two records in **one collection** share an identifier"* — so this is legal, expected, and permanent.

A core `subjects[].stateId` therefore could not use `ref:` at all. It would need either a **relative reference resolved against a sibling field** — the first in the contract — or a compound subject-ref, which would force every reader to implement subject-ref resolution just to read `shots[].subjects[]`.

**The contract has already met this problem once and declined to solve it in core.** In `SHOT.setting`:

```js
locationId: { type: "string", ref: "location" },   // globally resolvable
coverageId: { type: "string" },                    // no ref — coverage is scoped to its owner
```

`coverageId` carries no `ref:` for exactly the reason `stateId` could not: coverage records are scoped to the entity that owns them. Core already holds one unvalidatable variant pointer. That is a precedent for the **problem**, not a licence to add two more.

### 2. Putting bindings in the profile does not orphan the states

The obvious objection to the split — *states in core, bindings in a profile, so core carries data nothing in core consumes* — does not hold. `resolveSubject()` walks scoped steps with containment checking, so a **core** `references[].subject` can address a state directly:

```
prop:prop-case/state:st-case-open
```

So *"this asset is the approved authority for the case in its open state"* is a core fact, expressible and validated without the continuity profile. Entity states have a first-class core consumer independent of any binding. The split is clean in both directions.

### 3. The strongest counter-argument, and why it loses

P0 §5 makes a decisive argument for keeping `unspecified` in a field's own enum rather than in evidence: *"`statements[]` is droppable by design — a tool that discards it must still hold a valid, complete film. If 'we have deliberately not specified the lens' lives only in evidence, dropping evidence converts a director's decision into an omission."*

Read quickly, that is an argument for core. It is not, and the difference is the mechanism of loss:

- `statements[]` is **droppable by design**. Evidence is optional; a conforming tool may discard it during an ordinary save, and the film must survive that. The loss is *silent and routine*.
- A **profile is not droppable**. It is declared in `format.profiles`, serialization rule 11 requires unknown subtrees to be preserved, and rule 9 forbids the writer from dropping a key that was present. A tool that ignores `continuity` is announcing non-participation, not quietly discarding data.

And the degradation is graceful rather than falsifying. A reader that ignores the binding falls back to shot default, then entity default — which is the pre-P4-SEM behaviour: **less specific, never wrong**. No director's decision becomes an omission, because the decision also survives in the frame's `description` and, once approved, in the asset itself.

### 4. What is actually lost if a client ignores the binding

| Fact | Survives without the profile? |
|---|---|
| which entities are in the shot | **Yes** — `SHOT.subjects[]`, core |
| the frame, its role, its prose | **Yes** — `FRAME`, core |
| which variants of an entity exist | **Yes** — `states[]`, core |
| which asset is approved for a state | **Yes** — `references[].subject` + `assetId`, core |
| what the approved frame looks like | **Yes** — the asset bytes and digest, core |
| *which declared variant this frame selects, as machine-readable data* | **No** — this is the profile's content |
| the ability to verify a candidate against declared intent | **No** — and that is continuity's job by definition |

Nothing in the first group depends on the second. That is the test, and it passes.

---

## What core owns

- `entities.*[].states[]` — the catalogue of variants, with `isDefault`, `derivesFrom`, `delta`.
- `shots[].subjects[]` `{entityId, role}` — who and what is present. **Unchanged; no `stateId` is added.**
- `shots[].frames[]` `{id, role, description}` — frame identity and prose. **Unchanged.**
- `references[]` — the approved-image edge, whose `subject` may address a state directly (`prop:prop-case/state:st-case-open`).
- `assets[]` — identity and digest.

## What the continuity profile owns

- the declared state binding at **shot** level (the default for the whole shot);
- the declared state binding at **frame** level (the override);
- the **inheritance rule** — frame → shot → entity default, with absence meaning inherit and no explicit same-as-shot marker;
- later, and out of scope here: tracking, declared intent prose, and continuity acceptances.

The profile references core (`entityId`, `stateId` resolved relative to that entity). Core never references the profile. That direction is the right one and must stay that way.

## What a client that does not understand continuity must do

1. **Preserve the `continuity` block deep-equal** and re-serialize it under rules 5–8 with keys in JCS order. This is serialization rule 11 and it already applies.
2. **Not act on it** — no reading, no interpreting, no partial honouring.
3. **Not delete it**, and not drop keys it does not recognise (rule 9).
4. **Fall back to the entity default** when resolving which state applies. It must **not infer** a state from prose, from asset filenames, or from anything else.
5. **Not claim continuity conformance** — `format.profiles` is where participation is declared.

---

## Migration of M060-era passthrough data

Today `M060` preserves `shot.continuityIntent`, `shot.continuitySelections` and `shot.continuityStateSelections` with the note *"belongs to the continuity profile, whose interior this contract revision does not model"*, and `creationBrief.frameWorkflows` is preserved by M014's cluster. Both land in `#/extensions/com.cinebraid.legacy/preserved` as `{sourcePath, rule, note, value}` entries.

The new rule **re-homes them from the legacy extension into the `continuity` block**, and `M001` must add `"continuity"` to `format.profiles` — the migrated goldens currently declare only `core, bible, shot-planning`, so that is a visible, reviewable golden change rather than a silent one.

**A finding that materially affects planning: no real-corpus data exercises this path.**

Measured across all 18 sanitized Overfit generations: **zero** occurrences of `continuityStateSelections`, frame-level `*StateSelections`, `frameWorkflows` state selections, or `continuityIntent`. The sanitizer does not strip them — there are no such rules — so the absence is real. Source detection confirms why: every generation is **6.6-era**, with `hubVersion` topping out at `v5.8.1`, and neither V6_7 marker (`shot.continuityIntent`, `entity.tracking`) fires anywhere.

So this migration path is in the same position as **M040 and the `INFERRED` marker** (P3 §7.8): specified, deterministic, and never exercised by real data. It needs **new synthetic fixtures** carrying a cross-state first/last pair, a three-frame shot, a shot with no selections, and an orphan binding. This is true of either home and is not an argument for one over the other — but it must not be discovered during implementation.

Migration rules, in outline:

| Source | Target | On ambiguity |
|---|---|---|
| `shot.continuityStateSelections{entityId: stateId}` | shot-level binding in `continuity` | a `stateId` naming no state on that entity → `disputed` statement, value retained, never written as a live binding |
| `frameWorkflows[fid].{character,prop,vehicle}StateSelections` | frame-level binding | as above |
| `frameWorkflows[fid].locationStateId` | frame-level binding for the location | as above |
| a binding naming an entity absent from `subjects[]` | **not written** | `disputed` statement; migration must not invent a `subjects[]` entry |

Absence stays absence. Where legacy data cannot determine a binding, none is written — inheritance already gives that case the correct reading.

---

## Validator implication

**The continuity profile's interior must be modelled, not left `passthrough`.** This is the one place the decision costs something and it should be paid deliberately:

```js
function checkRefs(spec, value, subject, pointer) {
  if (spec.type === "object") {
    if (spec.passthrough) return;   // ← reference checking stops here
```

A binding left inside a passthrough subtree gets **no reference validation at all** — a `stateId` naming nothing would be undetected. Declaring the interior is what "the first interior of the `continuity` profile" means, and it restores validation.

Proposed diagnostics, following the existing severity philosophy (unknown ⇒ warning, broken reference ⇒ error):

| Code | Severity | Invariant |
|---|---|---|
| `continuity.binding.state-unresolved` | error | `stateId` names no state on the bound entity |
| `continuity.binding.entity-unlisted` | error | the binding names an entity absent from the shot's `subjects[]` |
| `continuity.binding.duplicate` | error | two bindings for one entity on one frame |
| `continuity.binding.frame-unknown` | error | a frame-level binding names no frame on that shot |

Two notes for the implementing PR:

- Resolution is **relative** — `stateId` is checked against the states of the entity named in the same binding, never against a global index. The profile can define this because it owns its own resolution rule; core could not, without inventing a mechanism.
- Validation is not profile-scoped today (`MODES` are structural / semantic / portability / compatibility). Modelling the interior means the core validator will validate it. That is acceptable and arguably correct — declaring a shape and checking it is not the same as requiring clients to *act* on it — but if profile-scoped validation is ever wanted, this is the record that it did not exist at this revision.

---

## Compatibility implication

Better than core placement in both directions.

| Direction | Behaviour |
|---|---|
| **Old project → new app** | Loads unmutated. No binding = inherit, which is already the runtime meaning. INV-R1 holds; nothing is defaulted at load. |
| **New project → older app** | The older reader sees an unmodelled `continuity` interior, preserves it deep-equal, and falls back to shot/entity default. Degrades to *less specific*, never to *wrong*. Under core placement the same reader would see unknown keys inside `subjects[]` — a structure it believes it fully understands, which is a worse failure posture. |
| **Non-continuity client round-trip** | Preserved by rules 9 and 11; semantic (deep-equal) guarantee, not byte. |
| **Determinism** | Unaffected. The migration inference is a pure function of the source document. |
| **Core clients** | **Unchanged.** No core record gains a field, so no existing golden changes bytes and no simple client gains an obligation. |

That last row is the practical dividend: `SHOT` and `FRAME` — the structures present in all 18 goldens — are not touched at all.

---

## Does this change the P4-SEM implementation order?

**Yes, and favourably.**

1. **P4-SEM-B drops from VERY HIGH to MEDIUM–HIGH risk.** Its VERY HIGH rating came from touching the shot record, changing the containment surface, and the possibility that a mapping error would change generated output. The first two disappear entirely. The third remains — the binding still selects the authority image — so it keeps its own PR and its behavioural before/after test, but it no longer requires re-measuring 18 goldens for a core-record change.
2. **P4-SEM-C becomes the highest-risk P4-SEM batch**, behind roadmap-P4 itself. The rename/move identity path is now the sharpest edge in the set.
3. **P4-SEM-B is unblocked.** It was gated on this question. It still needs canonical persistence, so it stays in Wave 1, but it no longer contends with P4-SEM-A or P4-SEM-C for core schema surface and may run in parallel with them.
4. **One new prerequisite appears:** synthetic continuity fixtures must exist before P4-SEM-B, because the real corpus cannot exercise the path. Small, and better known now than mid-batch.
5. **Wave 0 is unaffected** — cost, M022, M080 and voice convergence never depended on this.

Recommended next task is unchanged in kind but no longer blocked: **batch 0a, historical job cost.** It remains the strongest first move — no dependencies, no OFP impact, no migration, a contract already written and tested, and it removes a live defect in which a Settings change silently rewrites a project's spending history.

---

## What this decision does not authorise

Implementing the binding, modelling the continuity interior, writing the migration rule, adding the diagnostics, changing `M001`/`M014`/`M060`, or starting any other P4-SEM batch or B2b. This is a decision record.

---

## HARD STOP

No production code, schema, migration, validator or version marker was changed. No P4-SEM batch was started. No B2b work was started. The contract remains `1.0-draft.1`.

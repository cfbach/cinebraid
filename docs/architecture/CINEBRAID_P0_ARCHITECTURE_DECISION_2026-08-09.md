# CineBraid — P0 Architecture Revision (Open Film Project)

**Read-only. No branch, no commit, no schema files, no implementation.**
Date: 2026-08-09
Basis document: `CINEBRAID_CANONICAL_FORMAT_AUDIT_2026-08-09.md`
Scope: resolve Issues 1–5 and re-decide Decisions 2, 3, 7, 12, 19 before P0 is frozen.

---

## STATUS — P0 FROZEN

**Accepted and frozen 2026-08-09.** This document is the authoritative P0 decision record for the CineBraid canonical project format / Open Film Project architecture. It is no longer a proposal.

Accepted in full: §3 addressing, §4 claim binding, §5 vocabulary, §6 staleness, §7 version lifecycle, §8 INV-R1/R2/R3 round-trip definitions, §11 revised Decisions 2/3/7/12/19, §12 reserved terminology, and the N1/N2/N4 P1 sequencing items.

The three freeze conditions from §14 were accepted as follows:

1. **Amended Decision 7** — sparse immutable `statements[]`; structured `{subject, path}` targeting; claim/value hash binding; five act kinds (`cited`, `suggested`, `observed`, `approved`, `disputed`); derived staleness; `unspecified` belongs to field semantics, not evidence.
2. **The `1.0-draft.N` development lane**, including the rule that real production projects **never** enter the draft lineage. Existing production projects remain on the legacy `6.7` lineage until stable OFP 1.0 ships.
3. **`observed` is provisional** — retained for the draft contract; **no automatic promotion from continuity observations**; the first evidence kind to reconsider if P1/P5 testing shows it unnecessary; changing the frozen vocabulary after public 1.0 requires the appropriate format-version change.

Also accepted: explicit migration rather than migration-on-open; the `id-portable` warning and deterministic ID-minting rules; the `.gitattributes` LF pin as P1 work.

Still open by decision, not by omission: **Q1** file key ordering (schema-derived vs JCS) remains a P1 empirical decision; **Q2** statement-volume scaling remains a later measured gate.

Nothing in this document has been implemented.

---

## 1. BASELINE

| Item | Value |
|---|---|
| Local branch | `main` |
| Local HEAD | `e34b819ec863f5fa3507b15e81a4d2a8433d51fc` |
| `origin/main` | `ecd6d52f6668e7830c8a41c7029e738351c12847` |
| Working tree | **clean** |
| App version | `6.6.6-private.1` (`package.json`) |
| P-1 / PR #38 | **Merged to `origin/main`** as `ecd6d52` ("Merge pull request #38 from cfbach/fix/p1-stop-silent-loss", commit `261791f`). **Not present in the local checkout** — local `main` is 1 commit behind. |

**Disclosure.** Every code fact below was read from the working tree, i.e. *without* P-1. I verified that this does not affect any of them: `git diff e34b819 origin/main` shows P-1 touches no hunk containing `atomicWriteJson`, `validateProjectForSave`, `JSON.stringify`, `public/shared-continuity.js`, or `projects/`. The four functions and one sample file this revision reasons about are byte-identical on both commits.

P-1 delivers what audit item 20 required: the `creationDescription` and duration losses are repaired, `codes[]` reinterpretation is now reported, and load-time coverage normalization no longer clears `approvedFile` or dirties the project. Those repairs are assumed present for everything that follows.

**New measurements taken for this pass** (read-only, `fs.readFileSync` from a scratchpad script, nothing opened through CineBraid, nothing modified):

- Shipped sample `projects/cinebraid-sample/project.json`, as checked out on this machine: 10,974 bytes, **372 CR bytes**, one trailing `\n`. `JSON.stringify(P, null, 2)` is 10,601 bytes. **The working-tree file differs from what `atomicWriteJson` would write by 373 bytes, before any edit.**
- Legacy ID census across four Overfit generations + the sample: 314 IDs scanned. **5 charset violations, all the same shape** — `INT-1->2` … `INT-5->6` in every generation from anchor-hub-22 onward. **Zero cross-collection entity-ID collisions. Zero nested-ID duplicates.** 32 empty `clips[].id` in the v4.7 generation.
- Overfit v5.8.1 dependency tokens: 35 in `codes[]` + 10 in `shot.characters[]` = **45**, confirming the audit's figure. Of the 35 `codes[]` tokens, **4 match an entity ID exactly and 31 do not** (= the audit's 28 reinterpreted + 3 dropped). Those 31 occurrences reduce to **9 distinct token patterns**.
- Overfit v5.8.1 entity prose: **0 of 12 entities have two differing non-empty description aliases.** M011's conflict case is latent in this corpus, not realized.
- Overfit v5.8.1 shots with prose dependency language: **7** (`L0-01, L1-01, L3-01, L4-01, L5-02, L7-01, L7-03`).

---

## 2. REVISED EVIDENCE / STATEMENT CONCEPTUAL MODEL

### The reframing

The six proposed statuses mixed origin with disposition because the record was modelled as *a status of a value*. It is not. **A statement is a record of an act, by an actor, at a time, about one addressable claim.**

Once the record is an act, the two dimensions collapse — a disposition *is* an act by a human, and an act already names its actor. There is one enum, and it is a verb, not an adjective.

Everything that looked like a second dimension is either the actor (`human` / `model` / `tool` / `source`) or a **derived** state that is never stored. This is the same discipline continuity already earns: intent is stored, observation is stored, **the finding is always computed**. Evidence gets the same rule.

### The record

```json
{
  "id": "stm-0007",
  "target": { "subject": "shot:sh-0100", "path": "/framing/size" },
  "kind": "approved",
  "claim": { "hash": "sha256:8f4c…", "preview": "wide" },
  "actor": { "kind": "human", "name": "Director" },
  "at": "2026-08-03T16:20:00Z",
  "evidence": { "sourceId": "src-script", "anchors": ["sc-012-action-004"] },
  "note": "Locked for the bookend."
}
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Document-local statement ID |
| `target` | yes | §3 |
| `kind` | yes | One of five acts, §5 |
| `claim` | yes (`hash`) | §4 — binds the statement to the value it was made about |
| `actor` | yes for `approved`, else optional | Who acted |
| `at` | yes | RFC 3339 UTC, `Z`, second precision |
| `evidence` | optional | `{sourceId?, anchors[]?, assetId?, observationId?}` — one block serving citations, observations and acceptances |
| `candidates[]` | only on `disputed`, required there | `[{value, note?, sourceId?, anchors[]?}]`, ≥1 |
| `note` | optional | Human prose |

### What is *not* in the model, deliberately

- **No `human-authored` kind.** Ordinary authored production data carries **no statement at all**. Absence is the common case and it costs zero bytes. This is what keeps the array sparse, and it is the direct answer to "a human-authored field may require no inference status at all" — correct, and load-bearing.
- **No `superseded` kind.** Supersession is derived: a later statement on the same target wins.
- **No stored staleness.** Derived, §6.
- **No `unspecified` kind.** Moved to field semantics, §5.
- **No wrapper on any value.** Unchanged from the audit, and still the single most important constraint.

### Compared with the alternatives

| Option | Verdict |
|---|---|
| **A. one combined status enum** | **Reject.** Cannot express "the script named her *and* the director approved it", or "inferred, then approved" — you would mutate the status and destroy the origin. Fails cases 1+3 and 2+3 outright. |
| **B. `basis` + `disposition` on one record** | **Reject.** Either approval mutates the inference record (destroys append-only, loses who proposed it), or approval is a new record and the old one's `disposition` stays `proposed` forever, which is then meaningless. Disposition is a property of a *review act*, not of a claim record. |
| **C. immutable claim/evidence records + separate approvals** | **Nearly right.** Correct semantics, but two record kinds and two arrays whose fields are identical except one. |
| **E. one immutable act record, one array (recommended)** | **Accept.** C's semantics with C's duplication removed. A citation, a suggestion, an observation, an approval and a dispute differ in exactly one field. |

---

## 3. STABLE TARGET ADDRESSING (Issue 1)

### Why the audit's proposal fails

`/shots/sh-0100/framing/size` is not a JSON Pointer — `shots` is an array and `sh-0100` is not an array index. `/shots/0/framing/size` is a valid pointer and an invalid identity. The fix is not a better pointer syntax; it is to **stop pointing at the document and start pointing at a record**.

### Grammar

```
target      := { "subject": <subject-ref>?, "path": <json-pointer>? }

subject-ref := step ( "/" step )*
step        := type ":" id
type        := a declared record type
id          := an OFP identifier

path        := RFC 6901 JSON Pointer, rooted at the resolved subject record
```

- `subject` **omitted** ⇒ the subject is the document root.
- `path` **omitted or `""`** ⇒ the target is the whole record.
- **Yes, `path` is RFC 6901**, unchanged, once the subject is resolved. No new pointer dialect.

### The one restriction that does all the work

> **Resolution MUST fail if traversing `path` would enter an array.**

Consequences, all desirable and all free:

- Array indexes can never be identity — the rule is structural, not a lint.
- Root-scoped targets are automatically safe: `/meta/title` and `/format/version` resolve; `/shots/…` cannot, because `shots` is an array. No special-casing of the root.
- Anything whose elements deserve individual evidence must be an identifiable collection, and is therefore reachable as a *subject*. The rule forces the modelling question at the right moment.
- A whole array is still addressable as a value (`path: "/risks"`), and §4's binding covers its contents deterministically. Reordering `risks[]` correctly invalidates a statement about `risks`; it cannot silently retarget one.

### Identifier rules

Measured against real data (§1): five legacy shot IDs contain `>` (`INT-1->2`). Decision 6 says legacy IDs are preserved verbatim. Both hold, with a two-tier rule:

| Tier | Rule | Enforcement |
|---|---|---|
| **OFP identifier** (portability floor) | Non-empty; NFC-normalized; MUST NOT contain `:` `/` `#`, whitespace, or C0/C1 controls | **Error.** These are the grammar's delimiters. |
| **`id-portable` profile** (recommended) | `^[A-Za-z0-9._-]+$` | **Warning.** Also filesystem-safe. |

`INT-1->2` satisfies the floor and fails the profile — so it round-trips verbatim and is *reported*. That report is worth having independently: `>` is illegal in a Windows path segment, and shot IDs are directory names today (`shots/<shotId>/takes/`), so those five shots have never been able to hold a take on this platform.

### Containment table

The complete resolver contract. One row per identifiable type; a new type is one row.

| `type` | Scope | Container |
|---|---|---|
| `scene` | project | `story.scenes[]` |
| `shot` | project | `shots[]` |
| `character` `location` `prop` `vehicle` `voice` | project | `entities.<plural>[]` |
| `source` | project | `sources[]` |
| `asset` | project | `assets[]` |
| `reference` | project | `references[]` |
| `statement` | project | `statements[]` |
| `frame` | `shot` | `frames[]` |
| `motion` | `shot` | `motion[]` |
| `relation` | `shot` | `relations[]` |
| `state` | character/location/prop/vehicle | `states[]` |
| `coverage` | location/prop/vehicle | `coverage[]` |
| `anchor` | `source` | `anchors[]` |

Subject types are **specific**, never a generic `entity` — `character:char-mara`, so validation catches "you said character, that is a prop". This also corrects `references[].subject` in the audit, which crammed a composite `"sh-0100/fr-a"` into a field named `id`.

### Two supporting invariants (both hold on real data)

1. **Entity IDs are unique across all entity collections.** Required anyway, because `shot.subjects[].entityId` is a bare ID with no type. Measured: **0 collisions across four Overfit generations and the sample.** Today's `validateProjectForSave` only enforces uniqueness *within* a collection — this is a genuine strengthening.
2. **Nested IDs are unique within their parent.** Measured: **0 duplicates.**

### Examples

```json
{ "subject": "shot:sh-0100",                 "path": "/framing/size" }
{ "subject": "shot:sh-0100/frame:fr-a",      "path": "/description" }
{ "subject": "character:char-mara",          "path": "/description" }
{ "subject": "prop:prop-case/state:st-case-open", "path": "/delta" }
{ "subject": "source:src-script/anchor:sc-012-heading" }
{ "subject": "shot:sh-0100" }
{ "path": "/meta/title" }
```

### Display / hash notation

One fused string, `subject + "#" + path`, used **only** in the claim hash (§4), UI text and logs:

```
shot:sh-0100#/framing/size
prop:prop-case/state:st-case-open#/delta
#/meta/title
```

It is deliberately *not* the stored form: two fields let JSON Schema validate `subject` and `path` with separate patterns, and `#` is RFC 6901's own URI-fragment marker, so a fused stored field would invite exactly one confusion too many.

### Against the requirements

| Requirement | How |
|---|---|
| stable IDs | subject steps are IDs |
| never array indexes | resolution fails on array traversal |
| covers project/meta, scene, shot, entity, state, frame, asset, reference, future types | containment table; new type = one row |
| whole record or a field | `path` omitted vs present |
| deterministic | one resolver, one table, uniqueness invariants proven on real data |
| easy to validate | regex on `subject`, regex on `path`, table lookup per step, resolve |
| survives array reordering | no positional information anywhere |
| no collection→object conversion | arrays stay arrays |
| readable | `shot:sh-0100#/framing/size` |

---

## 4. CLAIM / VALUE BINDING (Issue 2)

### Mechanism: hash (authoritative) + preview (advisory)

```
claimPayload := { "ofp": "claim/1", "t": <target string>, "v": <value> }
                 // "v" is OMITTED — not null — iff the target resolves to no value
claim.hash   := "sha256:" + lowercase-hex( sha256( utf8( JCS(claimPayload) ) ) )
claim.preview:= a short human rendering, ≤ 120 chars, advisory only, never compared
```

### Canonicalization rules

- **JCS = RFC 8785** (JSON Canonicalization Scheme). Do not invent one. Sorted object keys by UTF-16 code unit, no whitespace, ECMAScript number serialization, ECMAScript string escaping.
- `public/shared-continuity.js:94` `canonicalJson()` is already JCS-compatible for parsed-JSON input, is bundled for both runtimes, and is already tested against Node `crypto` (`tests/continuity-manifest.js:146`). **Reuse it — with one correction.**
- **Correction, and it is load-bearing:** the existing helper maps `undefined` → `"null"`. The claim payload must be built by *omitting* the `v` key, never by setting it to `undefined`, or "absent" and `null` hash identically and the model silently loses the distinction it exists to protect.
- Objects and arrays are handled by JCS alone — no special cases, no ordering ambiguity.

### Why the target is inside the hash

Without it, an approval of `framing.size = "wide"` could be retargeted to `framing.angle` and still verify if that field also held `"wide"`. Including the target string costs nothing and makes hash equality across fields meaningless, which is what we want.

### Why not store the value

`claim.preview` gives a human reading the JSON enough to debug. Storing full values would duplicate the project. The **one exception** is `disputed`: a conflict is *about* competing values, at least one of which is not in the document. Those live in `candidates[]`, and they are small — a wardrobe sentence, a location ID.

### What this buys, requirement by requirement

| Requirement | Satisfied by |
|---|---|
| approval cannot silently transfer to a changed value | value change ⇒ hash mismatch ⇒ statement is **stale** ⇒ **a stale `approved` confers nothing** |
| citation cannot silently attach to a replacement value | same mechanism; `cited` goes stale |
| conflict evidence stays attributable to the actual claim | `candidates[]` holds the values verbatim; a stale `disputed` is never auto-compacted (§6) |
| objects/arrays deterministic | JCS |
| no giant duplication | hash + ≤120-char preview; values only on `disputed` |
| human-readable debugging | `preview` sits beside the hash in the file |

---

## 5. VOCABULARY AND FILMMAKER-FACING INTERPRETATION (Issue 3)

### Five acts

| `kind` | Filmmaker phrase | Written when | Typical actor |
|---|---|---|---|
| `cited` | **From script** | a value is traceable to a source document | `source` |
| `suggested` | **Suggested** | a model or migration proposed a value | `model` / `tool` |
| `observed` | **Observed** | an observation was durably recorded as evidence about a document field | `model` |
| `approved` | **Approved** | a human decided | `human` (required) |
| `disputed` | **Conflict** | two or more readings compete and none is settled | any |

`observed` is retained rather than pushed entirely into the continuity sidecar because a model can observe things that are not continuity aspects — "this reads as a close-up, the shot says wide" has no sidecar home. It is fenced by rule: **routine model observations stay in the sidecar and are never promoted automatically.** Only a human or a workflow step promotes one.

### `unspecified` does **not** belong in evidence

It belongs to the production field. The reason is decisive: `statements[]` is droppable by design — a tool that discards it must still hold a valid, complete film. If "we have deliberately not specified the lens" lives only in evidence, dropping evidence converts a director's decision into an omission. That is the exact invariant the format exists to protect.

So, four distinguishable states of a field, none of them `""`:

| State | Encoding |
|---|---|
| not applicable to this profile | key **omitted** |
| never set | `null`, and only where the contract declares the field nullable |
| **deliberately left open** | an explicit `"unspecified"` **member of the field's own enum** |
| set | the value |

Add `"unspecified"` only where production genuinely distinguishes it — `duration.basis`, `framing.lens`. Not everywhere (audit R8 stands).

### The derived badge (never stored)

Fold the target's statements, newest `at` first, **ignoring stale and unresolvable ones**:

```
current disputed        -> Conflict
else current approved   -> Approved
else current cited      -> From script
else current suggested  -> Suggested        (a proposal, not canon)
else current observed   -> Observed
else (no statement)     -> Authored         (the default; costs nothing)
```

**Ready-for-Edit rule, restated:** a shot is not ready if any field it depends on resolves to `Conflict`, or to `Suggested` with no later `approved`. Stale statements never block — that is the point of staleness.

### The eight cases

| # | Case | Representation |
|---|---|---|
| 1 | screenplay names a character | `cited` on `character:char-mara#/name`, `evidence.sourceId` + `anchors` |
| 2 | Project Builder infers wardrobe | `suggested` on `character:char-mara#/description`, actor `model` |
| 3 | director approves that wardrobe | **a second statement**, `approved`, same target. Both retained. Case 2's origin is never overwritten — this is what kills Option A. |
| 4 | Nemotron observes a generated frame | sidecar observation. Promoted to an `observed` statement only if a workflow records it as evidence. |
| 5 | observation disagrees with intent | a **finding** — computed from intent + observation, **never stored**. Unchanged from Decision 8. |
| 6 | director accepts an intentional deviation | `approved` on the frame's continuity aspect, `evidence.observationId` naming what was accepted, `note` carrying why. Durable, and it survives the observation cache being cleared. |
| 7 | conflicting sources disagree | `disputed` with one `candidates[]` entry per source, each with its own `sourceId`/`anchors` |
| 8 | intentionally unspecified | **not a statement.** `"unspecified"` in the field's enum. |

Cases 3 and 8 are the two that break every single-enum design, and they break it in opposite directions — 3 needs two records where A allows one, 8 needs zero records where A demands one.

---

## 6. STALE-STATEMENT VALIDATION RULES (Issue 6)

### Computed state, per statement

```
resolve(target):
    subject missing / type mismatch / record not found        -> unresolvable
    path traverses an array                                    -> unresolvable
    otherwise                                                  -> a value, or ABSENT

statementState(doc, s):
    unresolvable                                               -> "unresolvable"
    recomputed claim hash != s.claim.hash                      -> "stale"
    otherwise                                                  -> "current"
```

Both states are **derived on every load and never persisted**, exactly as continuity findings are.

### Behavioural rules

1. **A stale `approved` confers no approval.** The single most important rule in this document.
2. **A stale statement is never silently dropped.** It is reported. Silent removal is the failure mode the whole audit exists to end.
3. **An `unresolvable` statement is a validation error**, not a warning — it means an ID was renamed or a record deleted without carrying its evidence. The migration/rename paths must maintain targets, exactly as `retargetSelectedCandidates` does today for candidate pointers.
4. **Validation reports, it does not repair.** Report-only in P1.

### Compaction (bounded growth without silent loss)

> A **stale `suggested`** statement MAY be dropped on save **iff** a later `approved` or `cited` statement exists on the same target.
> Nothing else is ever dropped automatically.

Rationale: `suggested` is the only kind that generates volume (Project Builder), and only when it has already been settled is it safe to lose. `disputed` is **never** auto-compacted — its `candidates[]` hold values that exist nowhere else in the document. Everything else is retained until a human clears it.

### Diagnostics the validator must emit

| Code | Meaning |
|---|---|
| `statement.target.unresolvable` | subject or path does not resolve |
| `statement.target.array-traversal` | `path` would index an array |
| `statement.stale` | value changed since the statement was made |
| `statement.stale.approval` | the above, on an `approved` — surfaced to the user, not just logged |
| `statement.candidates.missing` | `disputed` without `candidates[]` |
| `statement.actor.missing` | `approved` without an actor |
| `id.not-portable` | ID outside `id-portable` (warning) |

---

## 7. DEVELOPMENT → OFP 1.0 VERSION LIFECYCLE (Issue 4)

### Grammar

```
format.version := ^(\d+)\.(\d+)(-draft\.(\d+))?$
```

- Released contracts are **always** exactly `MAJOR.MINOR` — `"1.0"`.
- Unreleased contracts are `MAJOR.MINOR-draft.N` — `"1.0-draft.3"`.
- `format.id` is `"open-film-project"` **from the first draft byte**, and never changes. This alone ends the CineBraid-6.x confusion: the document says OFP, and `format.generator.version` says CineBraid 6.7.

### Rules for draft documents

1. A `-draft.N` document is **not interchange-safe**. Only the same generator at the same revision opens it for writing; any other revision opens it **read-only** and says so plainly.
2. Draft revisions carry **no migration guarantee to one another**. That is the entire point — P1–P6 must be free to restructure without writing throwaway migrations.
3. Draft documents are **never published** as fixtures, spec examples or public artifacts.
4. **CineBraid never converts a user's real project to a draft version.** Real projects stay on the legacy `schemaVersion 6.7` lineage until 1.0 is released.

Rule 4 is what makes the whole lifecycle safe, and it answers the "0.x becomes the permanent production lineage" fear directly: **production never enters the draft lane.** During P1–P6 the canonical format runs in a parallel, non-destructive lane — report-only validation (P1), migration to a copy (P2), fixtures (P3). The first time a user's project is *persisted* as OFP is P4, and P4's gate is 1.0's gate.

### Why not the alternatives

| Option | Verdict |
|---|---|
| `0.x` then `1.0` | Reject. Adopters key on the major; `0.x` reads as "unstable indefinitely", and there is a real chance it becomes the permanent lineage. |
| `1.0` immediately | Reject. It is the thing you asked not to do, and it is unrecoverable — you cannot un-publish a version number. |
| Schema-candidate metadata outside `format.version` | Reject. Two fields to check means one will be missed; a reader that ignores the side-channel treats a draft as stable. |
| `1.0-draft.N` inside `format.version` | **Accept.** One field, unmistakable, sorts correctly, and impossible to ignore. |

### Transition rule

> `1.0-draft.N` becomes `1.0` when **all** release gates pass, in one commit that changes the writer's emitted version and removes `-draft` from the grammar it will produce. Post-release development of the next contract resumes at `1.1-draft.1`.

**Release gates for `open-film-project 1.0`:**

| # | Gate | Phase |
|---|---|---|
| G1 | The validator accepts all golden fixtures and all 18 Overfit generations, with every rejection individually reviewed and justified | P1 |
| G2 | Round-trip conformance: a synthetic unknown extension **and** an unknown enum value survive load→save | P1 |
| G3 | INV-R1 proven by test on legacy, canonical, draft, newer-than-supported and invalid documents | P1 |
| G4 | M001–M053 run on the sanitised Overfit fixture with **zero silent drops** and a complete report | P3 |
| G5 | INV-R2 and INV-R3 proven by test | P4 |
| G6 | Project Builder envelope round-trips; an imported project can answer "which facts came from the script?" | P5 |
| G7 | Export → move machine → import, every reference intact, secret/path scanner blocking | P6 |
| G8 | A deliberately naive second reader reads the public fixtures without CineBraid knowledge | P7 (may be deferred past 1.0 by explicit decision) |

Migration IDs are stable across the transition: M001 is `6.7 → 1.0`, and targets `1.0-draft.N` while drafting. Only the target label moves.

---

## 8. ROUND-TRIP INVARIANTS (Issue 5)

### The measured problem this must survive

On this machine, the checked-out shipped sample is **already not in canonical byte form**: 372 CRLF line endings (from `* text=auto` + `core.autocrlf=true`) and a trailing newline that `atomicWriteJson` does not write. Loading and saving it with no user edit would change **373 bytes**. Any invariant stated without addressing this is false on a fresh Windows clone.

### INV-R1 — READ / OPEN (hard invariant)

> Opening a project **writes nothing**. `project.json` is byte-identical, no `.bak` is produced, and **no file is created inside the project directory**.

- Applies to legacy, canonical, draft, newer-than-supported and structurally invalid documents alike.
- Config bootstrap outside the project directory is not a violation.
- Test: hash + mtime before/after, plus an `fs` wrapper asserting zero writes under the project root.
- Code consequence: **normalization produces an in-memory view and must not set the dirty flag.** P-1 established exactly this for coverage normalization; INV-R1 generalizes it.

### INV-R2 — FIRST CANONICAL SAVE (migration)

> Semantic identity + deterministic serialization. **Not** byte comparison, and historical whitespace and key order are explicitly not a compatibility requirement.

Testable obligations:

| # | Obligation |
|---|---|
| R2.1 | **Deterministic** — same input, same migration version ⇒ byte-identical output |
| R2.2 | **Idempotent** — migrating the output again is a no-op |
| R2.3 | **No silent drop** — every source key is mapped, dropped by a *named* rule, or reported |
| R2.4 | **Counts preserved** — scenes, shots, entities, states, coverage slots, frames, references |
| R2.5 | **Identity preserved** — every legacy ID survives verbatim (`INT-1->2` included) |
| R2.6 | **Source untouched** — the original file is never written; INV-R1 still holds over it |

Historical formatting is preserved by keeping the original file, not by constraining the writer.

### INV-R3 — SUBSEQUENT CANONICAL SAVE

> For a canonical document `D` at the current contract version, `serialize(parse(D)) == D`, byte for byte.

With one honest caveat, stated rather than hidden: if `D` is canonical-*equivalent* but not canonical-*form* (hand-edited whitespace, CRLF from a checkout), the first save normalizes it **once** and is stable from then on. Both halves are testable.

Three code rules are what make INV-R3 achievable:

1. **Defaults are applied at use, never at load.** If the loader fills `tier: "B"`, the writer emits it and the bytes change. The document is the document. Today's `normalizeProjectV5` violates this pervasively; retiring it is P4 scope.
2. **Unknown extensions and unknown enum values ride on the in-memory model.** Dropping them is the R7 catastrophe.
3. **Derived data is never written back** — findings, staleness, readiness. And `claim.preview` is written once at statement creation and never recomputed on save, or a preview-formatter change would rewrite every file.

### INV-R4 — EDITED SAVE (goal, not a hard invariant)

> Changing one field changes only the lines carrying that change and any ordering it implies.

Diff-minimality is what makes git review of a project tractable. Worth testing; not worth blocking a release on.

### Canonical serialization rules

| # | Rule | Note |
|---|---|---|
| 1 | **UTF-8, no BOM** | Explicit because PowerShell redirection adds one on this platform |
| 2 | **LF line endings** in structure. `project.ofp.json` pinned `eol=lf` (or `-text`) in `.gitattributes` | **Required.** Without it, `core.autocrlf=true` breaks INV-R3 on every Windows clone — measured, §1. String *contents* are data; a CR inside prose is escaped as `\r` and preserved. |
| 3 | **2-space indent** | Matches `atomicWriteJson` today, so the change is not gratuitous |
| 4 | **Exactly one trailing `\n`** | The tracked sample already has one; `atomicWriteJson` does not write one. Align on having it. |
| 5 | **Object key order**: declared keys first, in the order the profile's JSON Schema declares its `properties`; then unknown/extension keys in JCS order | Deterministic *and* readable. Deriving order from the schema means one source of truth and no drift table. |
| 6 | **Collection order**: declared per collection. `ordered` — array order is data. `set` — canonical order sorts by `id`. | `shots`/`scenes` sort by explicit ordinal then `id`, so array order and ordinal can never disagree. `statements`/`assets`/`references`/`sources` sort by `id`. Within-record scalar arrays (`aliases`, `risks`, `expected`) are **ordered data and are never sorted**. |
| 7 | **Numbers**: ECMAScript `Number::toString`, i.e. exactly what `JSON.stringify` emits; identical to RFC 8785 | No `-0` (already normalized to `0`), no `NaN`/`Infinity`. Producers must not rely on precision beyond IEEE-754 double. |
| 8 | **Strings**: ECMAScript `JSON.stringify` escaping; well-formed stringify escapes lone surrogates | Matches RFC 8785. Nothing invented. |
| 9 | **Omitted vs `null` vs `"unspecified"`**: as §5. **The writer MUST NOT emit a key that was absent on load, and MUST NOT drop a key that was present** — even when its value equals the default | This single rule is the workhorse of INV-R3 |
| 10 | **Empty collections**: omitted if absent on load, retained as `[]` if present. The writer never adds `"statements": []` | |
| 11 | **Unknown extensions**: preserved as parsed; re-serialized under rules 5–8, keys in JCS order | **Guarantee is semantic (deep-equal), not byte.** Byte preservation of a foreign subtree is impossible once the file is canonically written; INV-R1 is what protects the byte case, and it protects it absolutely. |
| 12 | **Unknown enum values**: preserved verbatim, reported, never coerced | |
| 13 | **Duplicate object keys**: rejected at parse | |

**Two canonical forms, kept apart:** the *file form* (rules 1–13 — pretty, readable, deterministic) and the *hash form* (RFC 8785 JCS — compact, for claim binding and any digest). Conflating them is how formats acquire an unreadable serialization for no reason.

---

## 9. REPRESENTATIVE JSON

```json
{
  "format": {
    "id": "open-film-project",
    "version": "1.0-draft.1",
    "profiles": ["core", "bible", "shot-planning", "continuity"],
    "extensions": { "com.cinebraid.workflow": "1" },
    "generator": { "name": "CineBraid", "version": "6.7.0" }
  },

  "meta": { "title": "The Last Ferry", "draft": "v2.1", "aspectRatio": "2.39:1" },

  "sources": [
    { "id": "src-script", "kind": "screenplay", "title": "The Last Ferry — draft 3",
      "anchors": [ { "id": "sc-012-action-004", "elementKind": "action", "page": 12 } ] }
  ],

  "entities": {
    "characters": [
      { "id": "char-mara", "name": "Mara",
        "description": "Late thirties. Weather-worn canvas coat, hair tied back.",
        "states": [ { "id": "st-mara-default", "name": "Coat on", "isDefault": true } ] }
    ],
    "props": [
      { "id": "prop-case", "name": "Courier case",
        "states": [
          { "id": "st-case-sealed", "name": "Sealed", "isDefault": true, "delta": "Seal intact and legible." },
          { "id": "st-case-open", "name": "Open", "derivesFrom": "st-case-sealed", "delta": "Seal cut; lid raised." }
        ] }
    ]
  },

  "shots": [
    { "id": "sh-0100", "sceneId": "sc-terminal", "order": { "script": 1 },
      "title": "Mara waits",
      "framing": { "size": "wide", "angle": "eye", "lens": "unspecified", "movement": "static" },
      "duration": { "seconds": 6, "basis": "authored" },
      "frames": [ { "id": "fr-a", "role": "first", "description": "Mara settled, case sealed across her knees." } ] }
  ],

  "statements": [
    { "id": "stm-0001",
      "target": { "subject": "character:char-mara", "path": "/name" },
      "kind": "cited",
      "claim": { "hash": "sha256:1a9c…", "preview": "Mara" },
      "actor": { "kind": "source", "name": "src-script" },
      "at": "2026-08-01T09:14:00Z",
      "evidence": { "sourceId": "src-script", "anchors": ["sc-012-action-004"] } },

    { "id": "stm-0002",
      "target": { "subject": "character:char-mara", "path": "/description" },
      "kind": "suggested",
      "claim": { "hash": "sha256:77b0…", "preview": "Late thirties. Weather-worn canvas coat, hair tied back." },
      "actor": { "kind": "model", "name": "project-builder" },
      "at": "2026-08-01T09:14:00Z",
      "note": "Wardrobe and hair are not described in the screenplay." },

    { "id": "stm-0003",
      "target": { "subject": "shot:sh-0100", "path": "/framing/size" },
      "kind": "approved",
      "claim": { "hash": "sha256:c410…", "preview": "wide" },
      "actor": { "kind": "human", "name": "Director" },
      "at": "2026-08-03T16:20:00Z" },

    { "id": "stm-0004",
      "target": { "subject": "shot:sh-0100/frame:fr-a", "path": "/description" },
      "kind": "observed",
      "claim": { "hash": "sha256:5d21…", "preview": "Mara settled, case sealed across her knees." },
      "actor": { "kind": "model", "name": "nemotron" },
      "at": "2026-08-08T19:40:00Z",
      "evidence": { "assetId": "asset-9f2c41ab77e0d3c58b16aa04ee9d1c2f", "observationId": "obs-31c8" },
      "note": "Promoted from the observation cache: the seal is not legible at this size." }
  ]
}
```

Note `"lens": "unspecified"` — a deliberate production decision carried in the field, surviving any tool that discards `statements[]`. And note that `sh-0100`'s `title`, `order`, `duration` and `frames[0]` carry **no statements at all**. That is the common case.

---

## 10. OVERFIT STRESS TEST

Read-only. Nothing opened through CineBraid, nothing modified, no migrated project created.

### 10.1 `codes[]` suffix / reference specificity — **earns its complexity, decisively**

31 of 35 tokens do not match an entity ID; 9 distinct patterns. `LOC-HULL-A` may be coverage view A, a variant location, or a plate.

```json
{ "id": "stm-m020-0007",
  "target": { "subject": "shot:L1-01", "path": "/setting" },
  "kind": "disputed",
  "claim": { "hash": "sha256:…", "preview": "{\"locationId\":\"LOC-HULL\"}" },
  "candidates": [
    { "value": { "locationId": "LOC-HULL", "coverageId": "cov-a" }, "note": "'-A' read as coverage view A" },
    { "value": { "locationId": "LOC-HULL-A" }, "note": "'-A' read as a distinct location" }
  ],
  "actor": { "kind": "tool", "name": "migration/M020" },
  "at": "2026-08-09T00:00:00Z",
  "note": "Legacy codes[] token 'LOC-HULL-A'. Suffix meaning is not recoverable. Confirm before generation." }
```

`STAGE-3` (matches nothing) additionally keeps the raw token in `extensions["com.cinebraid.legacy"].unmappedCodes[]`, so the data survives in the document while the statement explains it. Verdict: **31 invisible losses become 31 addressable, blocking, resolvable items with the original token preserved.** This case alone justifies the mechanism.

*Volume note.* Statements bind per target, so 31 occurrences produce 31 statements — but only **9 distinct questions**. The UI batches by identical legacy token + identical candidates ("`LOC-HULL-A` appears in 5 shots — what does `-A` mean?"), answered once, writing 5 approvals. The ergonomics belong in the UI, not in the data model.

### 10.2 Bookend dependency trapped in prose — **earns its complexity**

Seven shots carry dependency language. `L0-01`: `notes` "Shared-asset: L7-03 depends on this plate LOCKED first"; `risks[]` "LOCK this framing — L7-03 derives from it (bookend dependency)"; `desc` "This EXACT framing is mirrored at the end (L7-03)".

```json
{ "id": "stm-m022-0002",
  "target": { "subject": "shot:L7-03", "path": "/relations" },
  "kind": "suggested",
  "claim": { "hash": "sha256:…",
             "preview": "[{\"kind\":\"bookend-of\",\"targetShotId\":\"L0-01\"}]" },
  "actor": { "kind": "tool", "name": "migration/M022" },
  "at": "2026-08-09T00:00:00Z",
  "note": "Read from L0-01 risks[]: \"LOCK this framing — L7-03 derives from it (bookend dependency)\". Prose retained." }
```

**This is the strongest argument in the whole model.** Without statements, M022 must choose between *losing a real production relationship* and *fabricating a director's decision*. With them it does neither: the structure is written, queryable and schedulable, and it is unmistakably a proposal that blocks Ready-for-Edit until a human confirms it. The audit's "suggest, never auto-apply" becomes "apply, marked as a suggestion" — strictly better.

### 10.3 `atomic` / `parentShot` / `fallbackFor` — **needs no evidence at all**

These are human-authored data from anchor-hub-22, mapping deterministically to `relations[]` (`part-of`, `fallback-for`). M021 emits **zero statements**. A `suggested` would be a lie (nobody suggested it) and a `cited` would be a lie (no source document). Absence of a statement *is* the correct representation of authored production data.

The fact that M021 *ran* belongs in `meta.schemaMigrations`, not in per-field evidence. **Rule: migrations emit statements only where they guess.** This is what keeps the array sparse, and it is why R1 (bloat) does not materialize.

### 10.4 Conflicting visual-description aliases — **designed for a hazard this corpus does not exhibit**

Measured: **0 of 12 entities** have two differing non-empty description aliases. M011 raises nothing on Overfit v5.8.1.

Reported plainly because it matters: D1 is Critical because five *readers* disagreed (F1, now repaired by P-1), **not** because the stored values diverged. If M011 fires elsewhere, the representation is a `disputed` with both texts in `candidates[]`, and the value binding does real work — a later human rewrite of `/description` stales the dispute (so the UI stops claiming an unresolved conflict about a value that no longer exists) while the losing text stays recoverable, because `disputed` is never auto-compacted.

### 10.5 Film draft metadata — **one root-scoped `suggested`**

`meta.version` is `"v2.1"` across all 18 generations while `hubVersion` climbs `v1 → v5.8.1`. M002 classifies by pattern: matches a CineBraid release ⇒ drop to `format.generator.version`, no statement; equals the `BLANK()` default `"v1"` ⇒ drop, no statement; otherwise ⇒ `meta.draft` **plus** a statement, because the classification is a heuristic.

```json
{ "id": "stm-m002-0001",
  "target": { "path": "/meta/draft" },
  "kind": "suggested",
  "claim": { "hash": "sha256:…", "preview": "v2.1" },
  "actor": { "kind": "tool", "name": "migration/M002" },
  "at": "2026-08-09T00:00:00Z",
  "note": "Legacy meta.version matched no CineBraid release and was stable across 18 saves; read as the film's own draft number." }
```

Note the omitted `subject` — the root-scoped form, and note that `/meta/draft` is reachable while `/shots/…` is not, with no special-casing.

### 10.6 `[INFERRED FOR PLANNING]` prose — **amendment to M040**

The audit's M040 says "target the containing field; **keep the prose**". If the marker stays inside the value, the claim hash binds prose-plus-marker: deleting just the marker — the intended cleanup — stales the statement and wrongly clears a suggestion that still applies to the surviving text.

**Amendment: M040 strips the marker from the field and moves it into `statement.note`.** Nothing is lost (the text is verbatim in the statement and named in the migration report), the claim binds the cleaned prose, and editing the prose stales the suggestion for the right reason. Leaving the marker in place would assert the same fact twice in two representations — the exact D1–D12 disease this work exists to end.

### 10.7 Census and verdict

| Source | Statements on Overfit v5.8.1 |
|---|---|
| M020 `codes[]` non-exact tokens | 31 (`disputed`, 9 distinct questions) |
| M022 prose dependencies | ≤7 (`suggested`) |
| M002 film draft | 1 (`suggested`) |
| M011 entity prose | **0** — measured |
| M021 `atomic`/`parentShot`/`fallbackFor`, M010 duration, M012 status, M013 winners, M016 state aliases, `characters[]`→`subjects[]` | **0** — all deterministic authored data |
| **Total** | **≈39 for 22 shots and 12 entities** |

≈1.8 statements per shot, all of it migration peak rather than steady state, against a document of well over a thousand fields. The audit's R1 lint threshold (>1 statement per 3 fields) is not remotely approached.

**Verdict: the evidence model earns its complexity, but only three of its five kinds do the earning on this corpus** — `disputed` (§10.1, §10.4), `suggested` (§10.2, §10.5, §10.6) and `approved` (the human answer to all of them). `cited` earns its place from P5's stop condition rather than from Overfit, which has no source documents. `observed` is the weakest and is the one to cut if the model must shrink further; it is retained under an explicit no-auto-promotion rule.

---

## 11. REVISED DECISIONS

### Decision 2 — canonical CineBraid semantics and OFP core are one layered model
**ACCEPT AS WRITTEN.**
Nothing in Issues 1–5 pressures it, and every issue resolved here made the layering *easier* to hold: the addressing model, the claim binding and the serialization rules are all core-level and contain no CineBraid vocabulary. The R20 enforcement test (CineBraid's own save output validates against unmodified core + declared profiles) must run from **P1 against the draft contract**, not from P4 — but that is implementation sequencing, not a change to the decision.

### Decision 3 — Project Builder returns an envelope around a canonical payload
**ACCEPT WITH AMENDMENT.** Three amendments, one of them a safety boundary:

1. **The importer computes `claim.hash` and `claim.preview`, never the model.** An LLM cannot be trusted to hash, and a wrong hash would silently mark every imported claim stale. The envelope carries `{target, kind, note, sourceId, anchors, candidates}`; the importer derives the binding from the payload it has just validated.
2. **The model may not emit `kind: "approved"`.** Approval is a human act. This extends `clearUnsupportedBuilderClaims()`, which already refuses to let the model assert approval — same boundary, now covering evidence.
3. **Every envelope target must resolve against the payload before commit**, with a typed error (`envelope.target.unresolvable`) and the existing retry loop. Unresolvable targets are the highest-probability LLM failure mode (audit R16) and must fail loudly at the door.

### Decision 7 — canon / inference / evidence architecture
**ACCEPT WITH AMENDMENT — and it is a heavy amendment. Read the delta.**

| Kept | Replaced |
|---|---|
| A sparse `statements[]` array | ~~keyed by JSON Pointer~~ → **structured target: `{subject, path}`, §3** |
| Not a wrapper on any value | ~~six statuses~~ → **five acts, §5** |
| "A suggestion is a proposal until approved" | ~~`source-derived`/`inferred`/`unspecified`~~ → `cited` / `suggested` / **moved to field semantics** |
| Ready-for-Edit gates on unresolved evidence | ~~status implies nothing about the value~~ → **claim binding, §4**, and **staleness, §6** |
| Retire `[INFERRED FOR PLANNING]` prose markers | ~~"keep the prose"~~ → **strip the marker into `statement.note`, §10.6** |

The decision's *intent* survives intact. Its *mechanism* is replaced, because as written it could not address a record in an array and could not stop an approval transferring to a value nobody approved.

### Decision 12 — legacy migration is explicit, not automatic
**ACCEPT WITH AMENDMENT.**
The decision is right and P-1 has already delivered the destructive-load fix that motivated it. The amendment strengthens "does not migrate" into **INV-R1: opening writes nothing at all** — no `project.json` byte, no `.bak`, no new file inside the project directory — and extends it to legacy, canonical, draft, newer-than-supported and invalid documents alike, with a test that wraps `fs` rather than merely comparing hashes. "Does not migrate on open" is a weaker claim than the product needs, and the weaker version is what allowed `normalizeReferenceCoverageData()` to exist for years.

### Decision 19 — first stable public schema version is OFP 1.0
**ACCEPT WITH AMENDMENT.**
`1.0` remains the first public version and `0.x`/`6.8` remain rejected. Added: the `1.0-draft.N` development lane (§7), the four draft rules, the eight release gates G1–G8, and — the load-bearing one — **CineBraid never converts a user's real project to a draft version**, so the draft lane cannot become the production lineage. M001 keeps its ID and targets `1.0-draft.N` until release.

---

## 12. RESERVED TRADITIONAL FILMMAKING SEMANTICS

Reserved, not implemented, in OFP 1.0. The purpose is to stop these industry terms acquiring a different meaning before the profiles that need them exist.

**The first four are live collisions in the current codebase or in the audit's own proposal, not hypotheticals.**

| Term | Likely future home | Why reserved | What must NOT use this name today |
|---|---|---|---|
| **take** | `production` profile — a numbered recorded performance of a setup | **Live collision.** `shots/<id>/takes/` and `review-provenance.js` already use "take" for a *generation candidate*. A generated candidate is not a take. | Generation candidates. Use `candidate`. Do not add `takeNumber` meaning a candidate index. |
| **slug** / **slugline** | `screenplay` profile — the scene heading | **Live collision, two ways.** `slug` is the project directory name in `server.js`; the audit proposes `shot.slug`. In screenwriting a slugline is the scene heading. | `shot.slug` — drop it or rename to `shortName`. Project directory naming stays internal and out of the format. |
| **stage** | `production` profile — a sound stage or shooting location | **Live collision.** `scene.stage` (read by `prompt-engine.js:350` for style-block scoping) and `stageApprovals{}` both mean *pipeline phase*. | Workflow phases. Use `phase` or `step`. Do not carry `scene.stage` into core with its current meaning. |
| **anchor** | `screenplay` profile — a stable citation point in a source document | **Collision inside the proposal.** `anchors/` is the character-reference image directory; `sources[].anchors[]` is a script citation. Two meanings, one format. | Media references. Identity images are `references[].purpose: "identity-*"`; `anchors/` remains a legacy directory name with no format meaning. |
| **plate** | `vfx` profile — a photographed background element | `plates/` today means location reference images. | Location reference images. Use `reference` + `purpose`. |
| **unit** | `production` profile — first/second/splinter unit | The Overfit filename convention already uses a positional token informally read as "unit". | Anything derived from filename conventions. Do not name a field `unit` for a coverage view. |
| **timecode** | `editorial` profile — SMPTE timecode | Unused today, and the single most likely term to be misapplied. | Generation durations (`duration.seconds`), frame indices, any elapsed-time field. |
| **slate** | `production` profile — the clapperboard record | Unused today. | Any UI card, header or summary block. |
| **scene number** | `production` profile — `1`, `1A`, `2` production identifiers | `scene.id` is a slug (`sc-terminal`); production scene numbers are a different namespace with their own re-numbering rules. | `scene.id`, `order`, or `narrativeOrder`. Reserve `sceneNumber`. |
| **setup** | `production` profile — a distinct camera position | An OFP `shot` is closest to a *setup*, not to a take. Naming this now prevents a later contradiction. | Anything else. |
| **shooting order** | `scheduling` profile | `order.script` and `order.edit` exist. A third ordinal must mean scheduling and nothing else. | Do not add `order.shoot` with a non-scheduling meaning. |
| **INT / EXT** | `screenplay` profile — `interiorExterior` | Currently prose inside scene headings. | Do not overload `scene.stage`, `setting.locationId` or `timeOfDay`. |
| **page / eighths** | `scheduling` profile — script length measure | The classic scheduling unit; meaningless if spent on something else. | Any pagination, ordering or progress field. |
| **cast number** | `production` profile — the numbered cast list | Distinct from character identity and from `role`. | `character.role`, `character.id`, `subjects[].role`. |
| **sound roll** / **roll** | `production` profile — recording media identifier | Unused today. | Any batch, run or generation-job identifier. |
| **board** / **stripboard** | `scheduling` profile | Unused today. | Any UI board, kanban or planner view name in the format. |
| **day** | `scheduling` profile — a shooting day | `timeOfDay` is story time, not schedule. | `timeOfDay`, `sceneOrder`, or any duration field. |

---

## 13. RISK REVIEW OF THE REVISED DESIGN

Risks **introduced or changed** by this revision. Audit risks R1–R20 stand except where noted.

| # | Risk | Assessment | Mitigation |
|---|---|---|---|
| N1 | **Legacy IDs violate the subject grammar** | **Real and measured** — 5 shot IDs contain `>` in three generations. | Two-tier rule (§3): the floor excludes only `: / #`, whitespace and controls, so `INT-1->2` survives verbatim; `id-portable` reports it as a warning. Zero renames required. |
| N2 | **Nested records with no ID cannot be subjects** | **Real and measured** — 32 empty `clips[].id` in Overfit v4.7. | Migration mints deterministic IDs for ID-less nested records. **Array position may be used to *mint* an identity, exactly once, and never to *be* one.** Assert non-empty IDs after migration. |
| N3 | **`claim.hash` computed from `undefined` conflates absent with null** | **Real** — `shared-continuity.js:94` maps `undefined` → `"null"`. | The claim payload omits the `v` key rather than setting it undefined. Reuse the helper for hashing; do not reuse it to build the payload. Test both cases explicitly. |
| N4 | **CRLF checkout breaks INV-R3** | **Real and measured** — 373 bytes on the shipped sample today. | `.gitattributes` pins the canonical document to `eol=lf`; INV-R3's "normalizes once, stable thereafter" caveat is stated, not hidden; a test asserts the second save is a no-op. |
| N5 | **Schema-derived key order drifts or is unstable** | Moderate. Depends on JS object key-insertion order surviving `JSON.parse` of the schema — true in V8 for non-integer keys, and OFP field names are never integers. | Test that the writer's key order equals the schema's `properties` order for every record type; fail CI on divergence. Fallback is pure JCS ordering everywhere, at a readability cost. |
| N6 | **Statement volume on the codes[] case** | Measured at 31 for Overfit (9 distinct questions), ≈39 total. Acceptable. | UI batches identical questions; compaction rule (§6) bounds the `suggested` steady state. Re-measure on a 1,500-shot fixture before 1.0 (audit R18). |
| N7 | **Staleness makes approvals look fragile to users** | Real UX risk: editing an approved field silently withdraws its approval badge. | The withdrawal must be *visible* — "Approved 3 Aug for a value that has since changed" — never silent. This is the entire point; it must read as a feature, not a bug. |
| N8 | **`observed` is the least-earned kind** | It contributes nothing on Overfit and duplicates a well-designed sidecar. | Retained under an explicit no-auto-promotion rule. **It is the first thing to cut** if the vocabulary must shrink. Freeze it as five and require a major version to change — the audit's own guard on this exact hazard. |
| N9 | **"Never write on open" is hard to hold as features accrete** | Real. Index rebuilds, caches and telemetry all want to write on open. | INV-R1 is enforced by an `fs` wrapper over the project root, not by discipline. Sidecars outside the project directory are unaffected. |
| N10 | **`disputed` is never auto-compacted, so it accumulates** | Bounded but unbounded in principle. | Resolving a dispute is a human act that writes an `approved`; the UI must offer "clear resolved conflicts" as an explicit action. Never automatic — `candidates[]` hold values that exist nowhere else. |
| R19 (audit) | *The evidence model is the newest idea and least proven* | **Discharged.** Prototyped against six real Overfit cases in §10. Three of five kinds earn their place on this corpus; the fallback to "`inferred` + `approved` only" is **rejected** — it would make P5's stop condition ("which facts came from the script?") unanswerable. | — |
| R2 (audit) | *JSON Pointer targets rot* | **Superseded** by §3. Index-based pointers are now structurally impossible rather than rejected at write time. | — |

---

## 14. RECOMMENDATION

### **READY TO FREEZE P0 — with three conditions and two questions that do not block the freeze.**

> **Outcome, 2026-08-09: accepted. All three conditions accepted, P0 frozen. See STATUS at the top of this document for the exact terms.**

Issues 1–5 are resolved with mechanisms that are specified exactly, tested conceptually against real legacy data, and grounded in code that already exists in this repository (`canonicalJson`, `sha256Hex`, `media-assets.js` validation, `isProjectRelativePath`, `atomicWriteJson`, the continuity intent/observation/finding split). Nothing here requires inventing a serialization standard, a hash, or an ID scheme.

**Three conditions, each a one-line acceptance rather than new design work:**

1. **Accept the amended Decision 7** knowing it replaces the mechanism, not just the vocabulary. §11 states the delta explicitly so the change is not absorbed silently.
2. **Accept `1.0-draft.N` and rule 4** — production projects never enter the draft lane. This is what makes the lifecycle safe, and it constrains P1–P6 sequencing.
3. **Accept `observed` as provisional** (N8), frozen at five kinds, first to be cut, requiring a major version to change.

**Two open questions, deliberately deferred — neither blocks the freeze, and neither can be answered well at a whiteboard:**

- **Q1 — key ordering.** Schema-derived order (readable) vs pure JCS order (zero contract coupling). Recommended: schema-derived, with N5's CI test. Settle it in **P1**, when the first schema exists and the difference is visible in a real file.
- **Q2 — statement volume at feature scale.** Measured at ≈39 for 22 shots. The 1,500-shot fixture (audit R18) must re-measure before **G5**. If statements scale linearly with `codes[]`-style ambiguity, the compaction rule may need widening.

**Two items that must be sequenced into P1 rather than deferred**, because they are cheap now and expensive later:

- `.gitattributes` pinning for the canonical document (N4). One line; without it INV-R3 is false on every Windows clone, and it is false on this machine today.
- The `id-portable` warning (N1) and the ID-minting rule (N2). Both are migration-gate behaviour, both were found by measurement rather than by reasoning, and both are silent data hazards if discovered during P4 instead.

**Not blocking, but worth stating:** local `main` is one commit behind `origin/main` and does not contain P-1. Sync before P1 begins so that the byte-identity work starts from the commit that made "opening a project changes nothing" true.

---

## HARD STOP

Nothing was implemented. No branch, no commit, no PR, no schema directory, no migration, no change to `project.json`, no schema-marker bump, no MediaAsset activation, no OFP file, no change to Project Builder. Overfit was read with `fs.readFileSync` from a scratchpad script outside the repository and was not opened through CineBraid, not modified, and not migrated.

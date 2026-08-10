# CineBraid — OFP P2: the explicit legacy migration framework

Date: 2026-08-10
Implements: `CINEBRAID_P0_ARCHITECTURE_DECISION_2026-08-09.md` (frozen)
Builds on: `CINEBRAID_OFP_P1_DRAFT_CONTRACT_2026-08-10.md`
Basis: `CINEBRAID_CANONICAL_FORMAT_AUDIT_2026-08-09.md` Part 27

This is implementation documentation. It records what P2 built and the decisions
P2 was asked to make. It does not restate P0 or P1 and it does not amend either.

**The contract is still `1.0-draft.1`. No real project has been migrated. No
project has been converted. Migration is not wired into the application.**

---

## 1. What P2 is, and what it deliberately is not

P2 builds the framework that can take a legacy CineBraid project and produce an
Open Film Project candidate, with a complete account of what happened to every
value on the way. It is a framework, a CLI and two test suites.

It is **not** a rollout. There is no route, no button, no startup path, no save
path and no import path that reaches any of it. The application still reads and
writes legacy `schemaVersion 6.7` documents exactly as it did before this branch.

The shape of the operation:

```
legacy project.json
        │
        ▼
  detectLegacyProject      what IS this, and how confident are we?
        │
        ▼
  buildMigrationPlan       which rules apply, and are they selected?
        │
        ▼
  migrateLegacyProject     execute IN MEMORY against a ledger
        │
        ▼
  validateMigrationResult  the P1 validator, over the candidate
        │
        ▼
  previewLegacyMigration   candidate + report + validation, no filesystem
```

`previewLegacyMigration` is the primary API and it is **pure**. It takes a parsed
document and returns a candidate, a report and a validation result. It cannot
write, because it has no filesystem to write to — which is a stronger form of
"preview writes nothing" than any amount of care.

---

## 2. Module layout

Everything lives under `ofp/`, beside the P1 modules and for the same reason:
P2 has no browser surface, and `public/*.js` share one global scope where a
duplicate top-level binding blanks the whole application.

| Module | Owns |
|---|---|
| `ofp-migrate-detect.js` | source family, generation, and keeping the five version markers apart |
| `ofp-migrate-accounting.js` | the source ledger: leaves, claims, dispositions, what is outstanding |
| `ofp-migrate-rules.js` | the rule registry — 32 rules, each with an ID, a determinism class and an implementation |
| `ofp-migrate-diagnostics.js` | the migration diagnostic registry and its severities |
| `ofp-migrate.js` | the engine: context primitives, statement binding, counts, identity, the report |
| `ofp-migrate-scan.js` | the independent output scan for credentials and machine-specific paths |
| `ofp-migrate-write.js` | migrate-to-copy: destination safety and the atomic write |
| `scripts/preview-ofp-migration.js` | the development CLI |

No dependency was added. The repository still has one (`express`).

**Nothing in P1 was modified.** The P1 contract, schema, validator, serializer,
identifier rules and fs guard are used exactly as merged. `ofp-migrate-scan.js`
reuses `isProjectRelativePath` from `media-assets.js` rather than reimplementing
it — the rule already existed and was simply never applied to `project.json`.

---

## 3. Source detection

Detection returns a classification with its evidence. It does not guess quietly.

```
{ ok, migratable, family, generation, confidence,
  schemaVersion, schemaVersionAt, hubVersion, metaVersion, metaVersionClass,
  formatVersion, shapeMarkers, collections, reason }
```

Families: `cinebraid-legacy`, `open-film-project`, `foreign-application`,
`unknown`. Generations: `6.7`, `6.6`, `pre-6.6`, `unknown`.

`ok` and `migratable` are separate fields because "I understood this document"
and "I should convert it" are different questions. An OFP document is understood
and is not a migration source; another application's scene file is recognised and
is refused by name, because the audit names that case and says do not migrate it.

### The five version markers, kept apart

The audit found twelve version-ish fields and no project format version among
them. Detection's most valuable job is refusing to conflate these:

| Marker | What it actually is |
|---|---|
| application version | `package.json` / release identity. **Never** a schema marker. Read only to be recognised and rejected as one. |
| `meta.hubVersion` | tracked the application across the pre-6.x generations (`v1 → v5.8.1`), then froze at `"v6.0.0"` and became a de-facto schema marker. Two meanings in one field, so it is evidence and never an answer alone. |
| `meta.version` | broken three ways: `"v1"` from `BLANK()`, an application version in the shipped sample, and the **film's own draft number** (`"v2.1"`) in every measured archive generation. |
| `meta.schemaVersion` | the only real schema marker — and it does not exist before 6.6, so it is absent in 13 of 18 measured generations. |
| `format.version` | the OFP **contract** version. A document carrying one is already OFP. |

`meta.version` is classified rather than copied: `absent`, `template-default`,
`application-version`, `film-draft`, or `unknown`. M002 acts on the class, and
only the `film-draft` reading — which is a heuristic — writes a statement.

### Sniffing when there is no marker

`SHAPE_MARKERS` is an ordered list of predicates, newest era first
(`shot.continuityIntent`, `entity.tracking`, `coverageSlots.requirement`,
`shot.creationBrief`, `entity.continuityStates`, `shot.keyframes`, `shot.clips`,
`atomic`/`parentShot`/`fallbackFor`, `shot.codes`). A declared marker always beats
shape; shape only decides when there is nothing to declare. Every marker that
fired is reported, and `confidence` says `sniffed` rather than `declared`.

Identifying a CineBraid project requires at least two legacy collections *plus* a
`meta` object or a schema marker. "Has a `shots` array" is deliberately not
enough: being wrong about what a file *is* is the worst failure available to a
migration tool.

---

## 4. The migration rule registry

32 rules, each with a stable ID, a name, a one-paragraph summary, the source
generations it applies to, a determinism class and an implementation function.
The registry's order **is** the execution order, and a test pins both ends of it.

### ID discipline

The audit's Part 27 matrix names M001, M002, M010–M016, M020–M022, M030, M031,
M040–M042 and M050–M053. **Those IDs are used here with the meanings the matrix
gives them and are not renumbered.** An ID that moved is an ID that can no longer
be traced back to the decision that created it.

The remainder are P2 assignments for work the matrix implies but does not number.
They sit inside the matrix's own numbering bands rather than above them, and each
declares `origin: "P2"` — a test asserts that an audit ID is never quietly
claimed by a rule the audit did not name.

| ID | Name | Determinism | Origin |
|---|---|---|---|
| M080 | runtime and credential quarantine | deterministic | P2 |
| M001 | legacy CineBraid project → Open Film Project | deterministic | audit |
| M002 | version marker classification | mixed | audit |
| M003 | project metadata | deterministic | P2 |
| M053 | default QC checklist | deterministic | audit |
| M060 | deterministic ID minting | deterministic | P2 (implements P0 N2) |
| M004 | scenes | deterministic | P2 |
| M006 | entities | deterministic | P2 |
| M011 | entity visual description | mixed | audit |
| M007 | continuity states | deterministic | P2 |
| M016 | continuity state delta text | deterministic | audit |
| M008 | coverage slots | deterministic | P2 |
| M015 | coverage requirement encodings | deterministic | audit |
| M017 | audio entities → voices | deterministic | P2 |
| M005 | shots | deterministic | P2 |
| M010 | shot duration aliases | mixed | audit |
| M009 | keyframes and clips | deterministic | P2 |
| M014 | duplicate frame stores | mixed | audit |
| M013 | frame approval selection | deterministic | audit |
| M012 | status fields | deterministic | audit |
| M020 | shot dependency codes | mixed | audit |
| M021 | authored shot relations | deterministic | audit |
| M022 | prose shot dependencies | **inferential** | audit |
| M040 | inferred-for-planning markers | **inferential** | audit, amended by P0 §10.6 |
| M041 | scene continuity review output | deterministic | audit |
| M042 | continuity intent prose | deterministic | audit |
| M030 | approved files → assets and references | deterministic | audit |
| M031 | media asset library | deterministic | audit |
| M050 | provider and workflow preferences | deterministic | audit |
| M051 | compiled generation payloads | deterministic | audit |
| M052 | runtime and dead collections | deterministic | audit |
| M070 | unknown legacy content | deterministic | P2 |

Two positions in that order carry meaning. **M080 runs first**, so that no rule
can carry a quarantined value — a cleanup pass that ran last would be a review
step, and a review step is what "we are careful" means. **M070 runs last**, after
every rule has claimed what it knows about.

### Deterministic versus inferential

P0 §10.3's rule stands, and it is what keeps `statements[]` sparse:

> **Migrations emit statements only where they guess.**

So M021, recovering `parentShot` into a `part-of` relation, emits **zero**
statements. A `suggested` would be a lie (nobody suggested it) and a `cited`
would be a lie (there is no source document). The absence of a statement *is* the
correct representation of authored production data, and the fact that a migration
ran belongs in the report rather than in per-field evidence.

Determinism is declared per rule but is decided **per application**. A `mixed`
rule maps deterministically in the ordinary case and guesses only where the
source is genuinely ambiguous: M010 writes a duration with no statement when the
aliases agree, and a dispute when they disagree.

---

## 5. Source-value accounting — the no-silent-loss mechanism

The central P2 invariant:

> For every meaningful source value there is exactly one disposition, chosen by a
> named rule, and there is no sixth category called "we forgot about it".

The five categories are frozen: `mapped`, `preserved`, `dropped`, `stated`,
`unmapped`.

The mechanism is an **inversion**. The ledger enumerates the source's meaningful
leaves *up front*, hands out claims, and reports at the end what nobody claimed.
A rule that forgets a field cannot make the ledger forget it too, because the
ledger was built from the source and not from the rules.

### What counts as a leaf

- every scalar, **including `null`** — "the slot exists and was never set" is a
  production fact that has to be disposed of, not skipped;
- an **empty** array or object — `"clips": []` is a deliberate empty collection,
  and losing it loses the fact that the collection was there;
- a non-empty container is **not** a leaf; its children are.

An **absent** key produces no leaf, which is exactly right: absence is not a
value, so there is nothing to dispose of.

### A claim names a leaf, never a container

This is a mechanism, and it exists because the alternative was a real hole that
the pinned table found during development. A rule claiming a record's own pointer
— `/shots/0`, to record that an ordinal came from the array position — counted as
covering every leaf beneath it, and the accounting for that whole shot was
satisfied by one call that inspected nothing. `SourceLedger.claim` now **throws**
on a non-leaf pointer. Rules that dispose of a whole block use `claimSubtree`,
which claims each leaf individually and can therefore say what was inside it.

One value may carry several claims, because one value legitimately reaches more
than one place: a suffixed `codes[]` token is *mapped* to its base entity **and**
*stated* as a dispute. Both are true and both are visible.

### Two independent checks, because each fails vacuously alone

- **The ledger check**: `unaccounted` must be empty, for every fixture.
- **The pinned accounting table**: the clean fixture's 84 source values are
  pinned as `(pointer, rule, disposition)` triples. The ledger check alone cannot
  tell a real mapping from the M070 sweep quietly preserving everything; the
  pinned table can, because a mapping that became a preservation changes a row.

Adding a field to the fixture is expected and the list moves with it. A mapping
that *silently became a preservation* is what it catches.

---

## 6. Statements created by migration

Migration may write `suggested`, `disputed` and `cited`. It may **not** write
`approved` — approval is a human act — and it does not write `observed`, which is
a model looking at a frame.

Three properties are structural rather than conventional:

1. **A rule's draft has no hash field.** There is nowhere for a rule, a tool or a
   model to put one, so `claim.hash` can only be computed by the engine, in
   `bindStatements`, after the value exists and resolves.
2. **The kind is checked before the draft is accepted**, and a `disputed` with no
   candidates is refused with a diagnostic rather than written.
3. **Every target must resolve in the result.** A migration-created statement
   whose target does not resolve is a *migration failure*, not a document
   warning, and it makes the whole result not `ok`.

Statement IDs are `stm-<ruleid>-<nnnn>`, assigned in a deterministic order
(rule, target string, kind) so the same input always produces the same IDs.

`at` is supplied **once**, as an input to the migration. Nothing reads a clock.
Tests pin it, and a run with a different instant differs from the pinned run in
exactly the instant and nothing else — which the suite asserts by substitution.

### Raw ambiguity is preserved in the document, not only in the report

- a suffixed `codes[]` token keeps its raw form in
  `extensions["com.cinebraid.legacy"].codes[]`, alongside the reading migration
  made;
- a token that matches nothing at all goes to `.unmappedCodes[]` and raises
  `migration.code.unresolved`. It is preserved, never dropped;
- a `disputed` statement's `candidates[]` retain every competing value, and P0
  §6 never auto-compacts a dispute — those values may exist nowhere else.

`LOC-HULL-A` is the case that earns all of it. Longest-prefix matching is what
the current build does, and it is what silently discards 28 of 45 measured
tokens — so here its answer becomes **one candidate of a dispute**, not the
answer. The canonical value asserts only what the document justifies: the
coverage view is written when that coverage record exists on that location, and
only the location is written when it does not. Migration does not invent a
coverage view to make the reading tidy.

---

## 7. Identity

### Minting

M060 uses P1's `mintNestedIdentifiers` unchanged.

> Array position may be used to **mint** an identity exactly once.
> Array position may never **be** an identity.

No clocks, no counters, no random sources: the same legacy input must always
mint the same IDs, or migration is not re-runnable. Every mint is recorded in the
report with its source path, its type, its parent and the ID it produced.

### Preservation

Existing legacy IDs survive **verbatim**. `INT-1->2` satisfies the identifier
floor and fails the `id-portable` profile, so it round-trips unchanged and is
reported as a warning by both the migration report and the P1 validator. Nothing
renames it. An error here is what would eventually tempt somebody to "fix" it,
and a rename destroys the only link between a shot and its history.

An ID that violates the **floor** is also preserved verbatim, and reported as an
error. The document will not validate until a human decides — which is correct,
because the alternative is migration silently choosing a new identity for a
record whose old one is a directory name on disk.

### Conservation

Counts are measured before and after for scenes, shots, characters, locations,
props, vehicles, voices, states, coverage, frames, motion, relations, references,
assets and statements. Every source identity is checked for presence in the
result. A change must be explained by a rule that **declared** it: M008 declares
the only structural one in this registry, because a character's coverage slots
are identity views rather than coverage of a place and become `references[]`.
An unexplained change is `migration.count.unexplained` or
`migration.identity.lost`, both errors.

---

## 8. Unknown legacy content

`extensions["com.cinebraid.legacy"]` is the declared preservation home:

```json
{
  "version": "1",
  "source": { "family": "…", "generation": "…", "schemaVersion": "…", "hubVersion": "…", "confidence": "…" },
  "preserved": [ { "sourcePath": "/shots/0/positioning", "rule": "M070", "note": "…", "value": … } ],
  "codes": [ { "shotId": "L1-01", "code": "LOC-HULL-A", "sourcePath": "…", "reading": "…", "rule": "M020" } ],
  "unmappedCodes": [ { "shotId": "L1-04", "code": "STAGE-3", "sourcePath": "…", "rule": "M020" } ],
  "assetFiles": { "asset-…": "CHAR-CLERK-FRONT.png" }
}
```

Each preserved entry answers all four questions: the original source path, the
original value, the rule that decided, and why it has no OFP representation.
It is precise preservation — a mapped value is never *also* preserved, so the
extension is not a second copy of the project.

`extensions["com.cinebraid.workflow"]` takes what the audit's Decision 16 says
belongs to CineBraid rather than to the film: collapsed status pairs, coverage
requirement, per-shot model preferences, prompt defaults, candidate review
bookkeeping and reference selection.

Two field names were chosen against the output scanner rather than around it:
the preserved entry's path is `sourcePath` (a key named `path` is a filesystem
path by contract, and an RFC 6901 pointer starts with `/`), and a legacy code is
`code` (a key named `token` is a credential in every other context a scanner
meets it). Naming the fields for what they hold avoided loosening the scanner.

---

## 9. Security and path handling

Two mechanisms, on purpose, because each fails vacuously in a different
direction — the same discipline P1 uses to prove INV-R1 twice.

**M080, the source-side quarantine**, runs first and refuses entry to
credential-named keys, absolute host paths of either flavour, UNC roots, local
endpoints and URLs carrying credentials. It is a mechanism rather than
discipline because the preservation rules are *designed* to carry any
unrecognised value into the extension — which is exactly the behaviour that would
carry a stored API key with it. `copyWithoutQuarantined` is what every
preservation path uses, so a quarantined leaf cannot ride along inside a
preserved parent.

Key names are **tokenised**, not pattern-matched: the real field names are
camelCase, and a separator-anchored regex reads `falApiKey` as ordinary prose
because there is no `.` or `_` in front of `apiKey`. Splitting on case boundaries
as well as punctuation makes `falApiKey`, `api_key` and `API-KEY` the same
question. Single words (`secret`, `token`, `password`, …) flag alone; `key` does
not, because `keyFrames` is a frame collection and flagging it would train
somebody to route around the scanner — so `api key` is a **pair**.

**`scanMigrationOutput`, the result-side scan**, is independent and runs over the
finished candidate, including anything a rule synthesised rather than copied.
Decision 17's instruction is that a failing scan *blocks*, so these are
error-severity and a migration carrying one is not `ok`.

`secret-traps.json` plants an API key, a FAL key, an `authSecret`, an editor
passcode, two absolute paths, a localhost endpoint and a credential URL. All
eight are quarantined and reported; the clean values in the same records are
untouched, which is what makes the quarantine precise rather than blunt.

---

## 10. Copy-only write behaviour

`ofp-migrate-write.js` is the only module in P2 that writes a byte.

- the destination is **supplied by the caller**. There is no default, and in
  particular none beside the source — "write it next to the original" is how a
  migration starts looking like a save;
- the destination may not **be** the source, may not be **inside** it, and may
  not **contain** it;
- the destination file may not already exist;
- a destination directory holding other content is refused unless the caller
  passes `allowExistingDirectory` in as many words;
- the read, the migration and the validation all run inside the **INV-R1 guard
  over the source root**, so a change that made migration write a cache fails
  there rather than in somebody's project directory;
- the write is **atomic**: a temporary file inside the destination, then a
  rename;
- nothing is written at all unless the candidate validated.

The functional audit proves the source tree is byte-identical afterwards —
contents and mtimes — with no `project.ofp.json` and no `.bak` inside it.

---

## 11. The migration report

A plain object, so it crosses a process boundary, an HTTP response or a CLI
unchanged, and is usable by a preview UI, an importer or P3 analysis without any
browser coupling. A test asserts the migration modules never reach for a DOM, a
server, or any model provider.

```
source      detectedFamily, detectedVersion, generation, confidence,
            hubVersion, metaVersion, metaVersionClass, markers,
            fingerprint (sha256 of the canonicalized source), reason
target      formatId, formatVersion, generator, experimental, at
rules[]     id, name, determinism, origin, status, sourceTargets,
            targetTargets[], statements, note        — every rule, including no-ops
counts      source{}, target{}, rows[], adjustments[], dropped[], reconciled
identity    source, preserved, lost[], minted
accounting  entries[] (pointer, rule, disposition, targets[], note, value),
            byDisposition{}, byRule{}, leaves, unaccounted[]
minted[]    rule, sourcePath, type, parentSubject, mintedId
statements[] id, kind, target, note
diagnostics[] code, severity, message, where, target, rule
summary     deterministicMappings, inferredMappings, disputes, preservedValues,
            droppedValues, unmappedValues, warnings, errors
```

Migration diagnostics live in **their own registry**, not in P1's. That registry
is the *validator's* contract — a caller switching on one of its codes is asking
"is this document legal", and a migration finding is a different question with a
different audience. Merging them would show every validator consumer codes that
can never appear in a document it reads.

---

## 12. An observed constraint, recorded rather than worked around

**The `1.0-draft.1` asset record declares no storage path.** It is
`{ id, kind, mediaType, digest }`. So M030 can mint stable asset *identity* and
the `references[]` edges that give it meaning — which is already strictly better
than a bare filename whose meaning comes from a directory convention — but it
cannot express *where* the file is in OFP core at this revision. The legacy
filename is therefore preserved in `extensions["com.cinebraid.legacy"].assetFiles`
rather than invented into a field the contract does not have.

This is **not** a P0/P1 contradiction and P2 did not stop for it. P0 §26's asset
row is the audit's proposal table; the frozen P0 decision record does not
re-specify the asset record, and P1 §16 explicitly defers MediaAsset activation
to P4/P5. Adding `storage.path` would widen a merged contract on P2's own
authority, and it would move the pinned key order of every project once P4 lands.
Flagged here for P4 to settle deliberately.

Two smaller consequences of using the merged contract as it stands:

- the `references[].purpose` enum has no member for "the approved output of this
  frame", so a frame approval is `other` and the meaning lives in the reference's
  *subject*, which is a frame. Inventing an enum member would be a widening the
  validator would correctly report as undeclared;
- a minted nested ID inherits its parent's stem, so a frame under `INT-1->2`
  mints `frame-INT-1->2-0001` — legal, deterministic, and outside `id-portable`,
  reported by the same mechanism that reports its parent. P1 defines the minting
  rule and P2 uses it unchanged; sanitising the stem would be exactly the
  cosmetic rename the two-tier identifier rule exists to prevent.

---

## 13. Fixtures

18 synthetic legacy fixtures in `tests/fixtures/ofp-legacy/`, documented in their
own README. No real user material. **Sanitised real-world fixtures are P3**, and
no archived generation has been opened by anything in this branch.

They cover, by the brief's numbering: a current-shape project (1), no
`schemaVersion` (2), the three duration aliases (3), the seven visual-description
aliases (4), exact entity codes (5), suffixed and ambiguous codes (6), a
completely unresolved code (7), authored `atomic`/`parentShot`/`fallbackFor` (8),
a prose dependency (9), film-draft versus application-version ambiguity (10),
`[INFERRED FOR PLANNING]` (11), missing nested IDs (12), the non-portable
`INT-1->2` (13), voice linkage including a dangling one (14), unknown legacy
fields (15), absent versus null (16), explicit empty collections (17), and state
and coverage aliases (18) — plus a secret/path trap fixture and another
application's document.

---

## 14. Tests

| Suite | Covers |
|---|---|
| `tests/ofp-migration.js` | registry integrity, detection, scenarios A–F, no-silent-loss and the pinned accounting table, statement rules, determinism, conservation, security, validation, INV-R1 over migration, report shape |
| `tests/ofp-migration-negative-controls.js` | 20 controls, each with a live-defect receipt |

Registered in `package.json` (`check:ofp-migration`,
`check:ofp-migration-negative`, both inside `check:ofp-core`), in
`tests/run-full-check.js`, and in the `tests/current-behavior.js` manifest. No
suite was skipped, quarantined or widened.

### Negative controls

Same two-part discipline as P1: every control reintroduces one defect, **proves
the defect is live with a probe**, and only then requires the guarded property to
fail. Anchors are matched against LF-normalized source, must be unique, and must
actually change the text. Nothing is written to disk and nothing is reverted with
git — the defect is compiled in memory and installed in the module cache, because
a broad `git checkout` is how unrelated unstaged work gets discarded.

| # | Defect reintroduced | Caught by |
|---|---|---|
| NC-P2-01 | writing a log file inside the source project during migration | the fs guard refuses any write under the source root |
| NC-P2-02 | stamping the draft format block onto the source while migrating it | the source document is not mutated |
| NC-P2-03 | letting the sweep skip what no rule claimed | every value has a disposition |
| NC-P2-04 | resolving a suffixed code by longest prefix and calling it the answer | a suffixed code produces a dispute and keeps the raw token |
| NC-P2-05 | promoting a suggestion to an approval by a human who never saw it | migration writes only suggested / disputed / cited |
| NC-P2-06 | binding a statement to something other than the value it resolves to | the claim hash binds the value at its target |
| NC-P2-07 | targeting a subject the migrated document does not contain | every migration target resolves before the result is accepted |
| NC-P2-08 | minting a nested identifier from a random source | the same input always mints the same identifiers |
| NC-P2-09 | sanitising a legacy identifier into `id-portable` | a non-portable legacy identifier survives verbatim |
| NC-P2-10 | leaving `[INFERRED FOR PLANNING]` in the canonical field | the marker is stripped and the evidence moves into the statement |
| NC-P2-11 | recording a preservation without preserving the value | unknown content survives in the document, not only in the report |
| NC-P2-12 | reporting success while the result fails the validator | a candidate that does not validate is not a successful migration |
| NC-P2-13 | accepting the source project as its own destination | a migration always has a separate source and target |
| NC-P2-14 | overwriting a document already at the destination | migration never overwrites an existing document |
| NC-P2-15 | carrying absolute host paths and local endpoints into the document | no machine-specific path survives into OFP |
| NC-P2-16 | carrying credential-named fields into the document | no key, secret or passcode survives into OFP |
| NC-P2-17 | dropping a continuity state with no rule to explain it | counts and identities are conserved or explained |
| NC-P2-18 | stamping a statement with a time read inside the migration | the same input produces byte-identical output |
| NC-P2-19 | writing `project.ofp.json` beside the source after the guard is released | the source tree is unchanged and carries no OFP document |
| NC-P2-20 | marking recovered authored structure as a migration suggestion | migrations emit statements only where they guess |

Three controls turned out to need **more than one edit**, and that is itself the
finding: the property is held by more than one mechanism, and removing one alone
leaves the other still catching it. NC-P2-12 removes both the failing-validation
diagnostic and the `ok` term; NC-P2-13 removes all three destination-identity
checks; NC-P2-05 both widens the permitted kinds and upgrades the draft.

**Two real defects were found by these mechanisms during development, not by
review.** The pinned accounting table caught a claim on a record container
silently covering its whole subtree, which is now structurally impossible. The
output scanner then caught the same class of mistake twice more in P2's own
output field names.

---

## 15. Functional audit

| Scenario | Result |
|---|---|
| **A** deterministic clean migration | `clean.json`: valid candidate, **0 statements**, 0 diagnostics, 84/84 values accounted, counts reconciled, no source writes |
| **B** ambiguous migration | `codes-ambiguous.json`: 3 disputes with both readings, raw tokens retained in the document, `STAGE-3` preserved and reported, candidate validates, `/setting` folds to **Conflict** so Ready-for-Edit stays blocked |
| **C** missing IDs / portability | `missing-ids.json`: 5 deterministic mints, `INT-1->2` and `INT-2->3` verbatim, portability reported as warnings by both the report and the validator, 0 identities lost |
| **D** unknown legacy content | `unknown-fields.json`: every unmodelled value in `preserved[]` with its source path, value, rule and reason; no mapped value duplicated there |
| **E** explicit migrate-to-copy | source tree byte-identical (contents and mtimes), destination holds exactly `project.ofp.json`, bytes equal the in-memory serialization, revalidates after a disk round trip, no temporary file survives |
| **F** unsafe output attempt | same path, inside-source, contains-source, existing file, and non-empty directory are all refused with typed codes and **zero writes**; there is no default destination at all |

---

## 16. What remains for P3+

- **Sanitised real-world fixtures** (P3). No archived generation has been opened.
  M021 against the generation that still carries `atomic`/`parentShot`/
  `fallbackFor` is P3 work, and so is release gate **G4**.
- **Migrating any real project.** P2 migrates synthetic fixtures only.
- **Canonical persistence** — INV-R2 and INV-R3 as live behaviour, retiring
  `normalizeProjectV5`, switching runtime save/load (P4).
- **`storage.path` on the asset record**, and MediaAsset activation (§12).
- **A `frame-approved` reference purpose**, if the contract wants one (§12).
- **Project Builder envelope** and `envelope.target.unresolvable` (P5).
- **Export / interchange and the public spec** (P6/P7).
- **The `continuity` profile's interior**, still passthrough; M042 preserves the
  prose rather than structuring it, because there is no core field to structure
  it into.
- **Compaction on save** (P0 §6) — specified, still unimplemented.
- **Statement-volume scaling** (P0 Q2) — the 1,500-shot re-measure.
- **Any migration UI.** No "Upgrade project to OFP" control exists, and nothing
  runs migration on open, on save, on import or at startup.

---

## HARD STOP

No real project was migrated. Overfit was not opened, read, copied or sanitised.
No project was converted to `1.0-draft.*`. Nothing was wired into project open,
project save, Project Builder import, startup or settings. No canonical
persistence. No MediaAsset activation. No export/import. No public spec
repository. No References UI work. No provider or installer work. The contract
remains `1.0-draft.1` and OFP 1.0 is not released.

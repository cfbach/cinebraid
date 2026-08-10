# CineBraid — OFP P3: the sanitized Overfit golden migration corpus

Date: 2026-08-10
Implements: `CINEBRAID_P0_ARCHITECTURE_DECISION_2026-08-09.md` (frozen)
Builds on: `CINEBRAID_OFP_P1_DRAFT_CONTRACT_2026-08-10.md`, `CINEBRAID_OFP_P2_MIGRATION_FRAMEWORK_2026-08-10.md`
Basis: `CINEBRAID_CANONICAL_FORMAT_AUDIT_2026-08-09.md` §23.8–23.9

This is an evidence record. It reports what happened when the merged P2 migration
framework was run against sanitized derivatives of real historical CineBraid
project data. It does not restate P0, P1 or P2 and it amends none of them.

**The contract is still `1.0-draft.1`. No real project was migrated in place, no
project was converted, migration is still not wired into the application, and the
archive was not modified.**

---

## 1. What P3 asked, and the answer

> Does the migration machinery survive actual historical CineBraid data?

Yes, with one measured exception that is a defect in the archive rather than in
the migrator, and three real-world findings the audit did not record.

Eighteen historical generations, **18,431 source values**, **0 unaccounted**,
**0 approvals**, **0 identities lost**, 524 statements, seventeen candidates that
pass the P1 validator and one that does not because the source document contains
28 dangling shot references.

Release gate **G4 — zero silent drops with a complete report — holds across the
whole corpus.**

---

## 2. Source inventory, and how the corpus was identified

### 2.1 The archive is in two places

The brief named `D:\Projects\Overfit`. That location exists and holds most of the
corpus, but the audit's own census (§23.8) puts the newest generation somewhere
else: `D:\Projects\CineBraid\app-581\CINEBRAID_v5.8.1\projects\the-overfit`. Both
roots were read; the build tool takes a single `--source` naming the directory
that contains them (`D:\Projects`), and every path it records is relative to that.

### 2.2 Eighteen is derived, not assumed

Enumerating every `project.json` and `PRE-V*_project_backup.json` for
`the-overfit` under both roots gives **58 files** carrying **18 distinct SHA-256
digests**. That is the corpus, and the count matches the audit's "eighteen
successive snapshots" exactly. The arithmetic:

- **16** directories hold a live `project.json`;
- `anchor-hub-21` re-observes `anchor-hub-19` byte for byte, so 16 − 1 = **15**
  distinct live documents;
- five `PRE-V<n>` backups are snapshots taken *before* the application upgraded
  the project to v<n>. Two of them duplicate a surviving `project.json`
  (`PRE-V3` = anchor-hub-22, `PRE-V31` = anchor-hub-30); **three** — `PRE-V32`,
  `PRE-V33`, `PRE-V40` — preserve a state no surviving `project.json` holds and
  are therefore generations in their own right;
- 15 + 3 = **18**.

The backup names also date those three precisely, which is what fixes the lineage
order. The build fails if the eighteen entries ever stop being eighteen distinct
documents.

### 2.3 The measurement reproduces the audit

Reading each document with `content.length` reproduces the audit's byte column
exactly — anchor-hub 23,327, anchor-hub-18 22,876, anchor-hub-22 68,592,
anchor-hub-33 79,220, the v4.0 build 78,957, v4.7 81,135, v5.8.1 106,510 — along
with its shot counts (11 → 39 → 22). The audit was counting UTF-16 code units;
on disk those files are 23,445 / 22,994 / 68,945 / 79,767 / 79,504 / 81,682 /
107,073 bytes. Same documents, different unit.

### 2.4 Nothing was opened through CineBraid

Every read is `fs.readFileSync` inside the build tool, wrapped in the INV-R1
guard over the source directory. No application loader, no project switch, no
normalizer, no save path and no migration UI touched the archive. `NC-P3-13`
proves the guard is a mechanism rather than a promise.

### 2.5 Immutability

A full tree snapshot was taken before any P3 work and again after all of it:
every entry under both roots with its relative path, size and mtime, plus a
SHA-256 for all 120 project-document JSON files outside `node_modules`.

| | |
|---|---|
| entries covered | 12,676 (`Overfit`) + 898 (`CineBraid/app-581`) |
| snapshot digest before | `8b0de597d485201a3284df29b9bcc5d41e8899cad0d8aca31782875894ecbd82` |
| snapshot digest after | `8b0de597d485201a3284df29b9bcc5d41e8899cad0d8aca31782875894ecbd82` |

Identical. Contents, sizes, modification times and tree shape are unchanged.

---

## 3. Sanitization

### 3.1 The principle

The corpus is only worth having because of the awkward things in it. So the
transform is **verbatim by default** and replaces only free prose:

> A string is rewritten only when it holds whitespace **and** its key is named on
> `PROSE_KEYS`. Everything else passes through untouched.

Both halves matter. The key list keeps the transform away from fields nobody
modelled — an unknown legacy field is exactly what M070 exists for, and a fixture
that quietly dropped one would test nothing. The whitespace test keeps it away
from the single-token values that share a key with prose: `role` holds both
`"location"` and a sentence, and rewriting the enum would change what M030 reads.

Preserved verbatim: every key in source order, every array at its source length
and order, the distinction between absent / `null` / `""` / `[]` / `{}`, every
identifier and `codes[]` token **including the broken ones**, every number,
boolean, enum, status, timestamp, model name and filename, the words M022 reads
dependencies out of, and `[INFERRED FOR PLANNING]`.

Replacement is word-for-word and **exact-length**, through a pure function of the
lowercased word: syllabic nonsense, obviously synthetic, and stable across the
whole corpus so a cross-generation diff still shows what actually changed.

Two decisions worth naming:

- **Filenames stay.** The archive's `project_shot_role_version.ext` convention is
  what M030 reads and it carries shot IDs that have to survive anyway; rewriting
  the descriptive half would break the cross-references between `winner`,
  `label`, `url` and `key` for no privacy gain. The exception is the
  provider-minted content-addressed names (`88XEYkt7hJH59fjoKNm2U_QTKBU63V.png`),
  which are an account's artefacts rather than the film's and are replaced by
  same-length deterministic tokens of the same alphabet class.
- **Timestamps stay.** `approvedAt`, `addedAt` and friends carry no identity, and
  their ordering is something a rule may legitimately read. Rewriting them would
  risk a semantic change to remove nothing.

### 3.2 The rules, as the manifest names them

| ID | Rule |
|---|---|
| S01 | identity vocabulary is inviolable — ids, prefixes, `codes[]` and cross-references, in the document and inside any prose that mentions them |
| S02 | verbatim by default |
| S03 | prose pseudonymization, exact-length, case-preserving, identifier- and keyword-protecting |
| S04 | filenames are preserved |
| S05 | opaque provider token replacement |
| S06 | structure is never touched |

### 3.3 The build gate

Sanitizing is only safe if it is provably shape-preserving, so the tool measures
both sides and refuses to write on any difference:

1. identical leaf pointers, in identical order;
2. identical types, and identical `null` / `""` / `[]` / `{}` positions;
3. every string exactly the same length;
4. at least one prose value changed, and **every** prose value of 24 characters
   or more changed — without this the gate passes on a fixture that is a copy of
   the film with one word moved;
5. the **equality partition of the prose is unchanged** — two fields that agreed
   still agree and two that differed still differ, because M011 turns on exactly
   that and a substitution that merged them would turn a dispute into a clean
   mapping;
6. the **hazard census is byte-identical** before and after;
7. no prose value contains an opaque provider token. The opaque-token rule
   short-circuits the prose rule, so a sentence with a provider filename embedded
   in it would come back with only the filename replaced — changed enough to
   satisfy check 4, and still carrying the film. No value in this archive is
   both, and this check is what makes that a measured fact rather than a lucky
   one;
8. the privacy scan passes over the serialized output.

The partition check is scoped to prose fields, and that scoping is a finding of
its own: `name` and `voiceTool` both hold `"ElevenLabs Voice Design"` in the
archive, only `name` is prose, and demanding a whole-document partition would be
demanding that the sanitizer do nothing.

Word-level injectivity is **not** required. 33 pairs of short source words land
on the same pseudo-word across the corpus, and that is recorded in the manifest
rather than fatal, because the property the corpus needs is the string-level
partition and check 5 tests it directly.

### 3.4 Determinism

`scripts/build-overfit-golden-fixtures.js --source <root>` run twice produces
byte-identical fixtures, manifest and goldens. `--goldens-only` run afterwards
changes nothing. Verified by hashing all 23 files across three runs. Nothing
reads a clock, a random source or the environment; the migration instant is
pinned at `2026-08-10T00:00:00Z` and supplied as an argument.

---

## 4. What was committed, and the tradeoff

```
tests/fixtures/ofp-migration/overfit/
    README.md
    manifest.json                       provenance, per generation
    generations/*.legacy.json           18 sanitized legacy documents
    goldens/summary.json                pinned migration result, all 18
    goldens/*.ofp.json                  full canonical output, 3 generations
```

2.0 MB on a 7.8 MB repository. The split:

| Part | Size | Why |
|---|---|---|
| 18 legacy fixtures | 1.38 MB | this *is* the deliverable; the cross-generation analysis needs all eighteen |
| `goldens/summary.json` | 0.09 MB | the drift gate — carries each candidate's SHA-256, so it catches any output change |
| 3 full `*.ofp.json` | 0.64 MB | reviewability |
| `manifest.json` | 0.07 MB | provenance |

Full canonical output is pinned for **three** generations rather than eighteen.
The summary already fails on any semantics change, so a full document buys a
diff a human can read rather than extra coverage — and it costs a diff nobody
reads on the fifteen generations that are structurally the same document a few
fields apart. Eighteen full goldens would have been roughly 4 MB. The three are
the ones a reviewer would actually open: the earliest shape
(`overfit-01-anchorhub-v1`), the only generation carrying authored relations
(`overfit-04-anchorhub-22`), and the newest and hardest
(`overfit-18-cinebraid-581`).

The whole tree is pinned to `eol=lf` in `.gitattributes`. Without that, a Windows
clone would rewrite the line endings and fail its own hash pins while CI passed.

---

## 5. The eighteen-generation census

| Fixture | Lineage | `hubVersion` | Shots | Leaves | Source SHA-256 | Fixture SHA-256 |
|---|---|---|---|---|---|---|
| `overfit-01-anchorhub-v1` | anchor-hub | `v1` | 11 | 406 | `88e160913543…` | `6adc3df9d7ca…` |
| `overfit-02-anchorhub-18` | anchor-hub-18 | `v1` | 11 | 413 | `34760d0916e4…` | `3cf6026e595d…` |
| `overfit-03-anchorhub-19` | anchor-hub-19 | `v1` | 11 | 400 | `d9c98ec162ec…` | `98da1b8040b0…` |
| `overfit-04-anchorhub-22` | anchor-hub-22 | `v2.2` | 39 | 1225 | `5dfe2991452a…` | `c0a03cccba83…` |
| `overfit-05-anchorhub-30` | anchor-hub-30 | `v3` | 16 | 1185 | `33ac3e928518…` | `6f773887105b…` |
| `overfit-06-pre-v32` | PRE-V32 backup | `v3.1` | 16 | 792 | `a5ad63ea42c9…` | `d81aab87e9f9…` |
| `overfit-07-anchorhub-32` | anchor-hub-32 | `v3.1` | 22 | 1062 | `04100cd7cfd0…` | `af640b66e95c…` |
| `overfit-08-pre-v33` | PRE-V33 backup | `v3.1` | 22 | 1048 | `7f6e4427fa0f…` | `0c6d650b2871…` |
| `overfit-09-anchorhub-33` | anchor-hub-33 | `v3.1` | 22 | 1071 | `474b25a3bd9b…` | `4b08a3a2fe3e…` |
| `overfit-10-pre-v40` | PRE-V40 backup | `v3.1` | 22 | 1053 | `278e5768b098…` | `60055493e99d…` |
| `overfit-11-hub-v4-0` | app_archive v4.0 build | `v4` | 22 | 1086 | `d7f7dee6ff6a…` | `d9a9724c7f68…` |
| `overfit-12-hub-v4-1` | app_archive v4.1 build | `v4` | 22 | 1088 | `c61c910f8b95…` | `bcf7e1d06149…` |
| `overfit-13-hub-v4-2` | app_archive v4.2 build | `v4` | 22 | 1157 | `2885d36d3143…` | `f47137e52dd9…` |
| `overfit-14-hub-v4-3` | app_archive v4.3 build | `v4.3` | 22 | 1254 | `ede522d5c27e…` | `afb8cf217183…` |
| `overfit-15-hub-v4-5` | app_archive v4.5 build | `v4.3` | 22 | 1127 | `3b939d8f6062…` | `e5d0acf65b56…` |
| `overfit-16-hub-v4-6` | app_archive v4.6 build | `v4.6` | 22 | 1129 | `c79580c51163…` | `e645545c0e80…` |
| `overfit-17-hub-v4-7` | top-level v4.7 build | `v4.7` | 22 | 1143 | `6d8cf83b9821…` | `97e414a1ef66…` |
| `overfit-18-cinebraid-581` | CINEBRAID_v5.8.1 | `v5.8.1` | 22 | 1792 | `8cea39af6cd1…` | `bf2e4dba2f94…` |

`meta.version` is `"v2.1"` in **all eighteen** and is classified `film-draft`
every time. **No generation declares a `schemaVersion`** — the audit's §23.9 says
"never appears" and that is what P3 measures; the risk table's looser "13 of 18"
phrasing does not match the Overfit corpus and should be read as covering the
wider inventory.

---

## 6. Migration results

| Fixture | Rules | Leaves | Unacc. | Mapped | Preserved | Dropped | Stated | Stmts | Sug | Disp | Mints | Validates | Candidate SHA-256 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `overfit-01-anchorhub-v1` | 16 | 406 | 0 | 159 | 223 | 24 | 20 | 20 | 1 | 19 | 0 | yes | `f0c867a308a4…` |
| `overfit-02-anchorhub-18` | 16 | 413 | 0 | 159 | 230 | 24 | 20 | 20 | 1 | 19 | 0 | yes | `d5420db9fc0e…` |
| `overfit-03-anchorhub-19` | 16 | 400 | 0 | 159 | 217 | 24 | 20 | 20 | 1 | 19 | 0 | yes | `5571e4550496…` |
| `overfit-04-anchorhub-22` | 18 | 1225 | 0 | 492 | 653 | 80 | 53 | 52 | 7 | 45 | 39 | **no** | `aa2ecd462ab0…` |
| `overfit-05-anchorhub-30` | 18 | 1185 | 0 | 307 | 818 | 60 | 20 | 20 | 1 | 19 | 0 | yes | `4b96ff57d63d…` |
| `overfit-06-pre-v32` | 19 | 792 | 0 | 249 | 483 | 60 | 20 | 20 | 1 | 19 | 29 | yes | `fceb5e4255be…` |
| `overfit-07-anchorhub-32` | 21 | 1062 | 0 | 343 | 637 | 82 | 31 | 31 | 3 | 28 | 33 | yes | `c13c34bda805…` |
| `overfit-08-pre-v33` | 21 | 1048 | 0 | 343 | 627 | 78 | 31 | 31 | 3 | 28 | 33 | yes | `805650240000…` |
| `overfit-09-anchorhub-33` | 21 | 1071 | 0 | 346 | 647 | 78 | 31 | 31 | 3 | 28 | 36 | yes | `228448b7b427…` |
| `overfit-10-pre-v40` | 21 | 1053 | 0 | 344 | 631 | 78 | 31 | 31 | 3 | 28 | 34 | yes | `a9efbb11a9cf…` |
| `overfit-11-hub-v4-0` | 21 | 1086 | 0 | 344 | 664 | 78 | 31 | 31 | 3 | 28 | 34 | yes | `a4ed561f6a7c…` |
| `overfit-12-hub-v4-1` | 21 | 1088 | 0 | 344 | 666 | 78 | 31 | 31 | 3 | 28 | 34 | yes | `6428a2e1f8bb…` |
| `overfit-13-hub-v4-2` | 22 | 1157 | 0 | 351 | 721 | 85 | 31 | 31 | 3 | 28 | 47 | yes | `23a0901bd282…` |
| `overfit-14-hub-v4-3` | 23 | 1254 | 0 | 347 | 804 | 103 | 31 | 31 | 3 | 28 | 39 | yes | `7fadad1f9637…` |
| `overfit-15-hub-v4-5` | 22 | 1127 | 0 | 345 | 680 | 102 | 31 | 31 | 3 | 28 | 36 | yes | `961cbb9e2364…` |
| `overfit-16-hub-v4-6` | 21 | 1129 | 0 | 342 | 685 | 102 | 31 | 31 | 3 | 28 | 32 | yes | `8459a6450411…` |
| `overfit-17-hub-v4-7` | 22 | 1143 | 0 | 345 | 684 | 114 | 31 | 31 | 3 | 28 | 36 | yes | `0b066d610938…` |
| `overfit-18-cinebraid-581` | 23 | 1792 | 0 | 534 | 1044 | 214 | 31 | 31 | 3 | 28 | 2 | yes | `2da1c0d94594…` |

### 6.1 Rule IDs the corpus reaches

**26 of the 32 merged rules fire against real data**: M001, M002, M003, M004,
M005, M006, M007, M009, M010, M011, M012, M013, M016, M017, M020, M021, M022,
M030, M031, M050, M051, M052, M053, M060, M070, M080.

The six that never fire are M008, M014, M015, M040, M041 and M042 — the archive
has no coverage slots, no duplicate frame stores, no coverage-requirement
encodings, no inferred markers, no scene continuity review output and no
continuity-intent prose. They remain covered by the synthetic P2 fixtures.

Frequency, where it is not all eighteen: M007 and M016 and M031 and M080 fire on
one generation each, M030 on four, M017 on twelve, M060 on twelve, M022 on
thirteen, M009 on fourteen, M021 on fifteen.

**On the G4 ID range.** P0's gate wording predates the merged registry. P2 kept
the audit's IDs with the audit's meanings and added its own inside the same bands
with `origin: "P2"`. P3 reports the IDs the corpus actually invokes and renumbers
nothing. There is no contradiction to resolve — only a gate written before six
rules had numbers.

### 6.2 Diagnostics across the corpus

| Code | Severity | Occurrences | Meaning here |
|---|---|---|---|
| `migration.id.minted` | info | 381 | every minted identifier, with its source path |
| `migration.id.not-portable` | warning | 75 | `INT-1->2` … `INT-5->6`, in fifteen generations |
| `migration.code.unresolved` | warning | 48 | `STAGE-1`, `STAGE-2`, `STAGE-3`, `SLATE-L1` |
| `migration.source.sniffed` | info | 18 | no generation declares a schema version |
| `migration.review.required` | warning | 12 | two location tokens on one shot (§7.6) |
| `migration.secret.quarantined` | warning | 2 | a field named `token` (§7.7) |
| `migration.validation.failed` | error | 1 | `overfit-04-anchorhub-22` (§7.1) |

---

## 7. Findings

### 7.1 28 dangling and 2 self-referential `parentShot` targets — new

`overfit-04-anchorhub-22` is the only generation with authored shot relations,
and 28 of its 31 `parentShot` values name a shot that **does not exist in that
document**. `L1-01a`, `L1-01b` and `L1-01c` all point at `L1-01`; the
decomposition replaced each parent with its lettered children and left the
pointers behind. Two more (`L2-02`, `L6-02`) point at themselves.

The audit did not record this. It was invisible in legacy CineBraid because
nothing ever resolved those strings.

What migration does is correct and is not changed here:

- M021 maps all 32 authored relations faithfully, including the self-references —
  deciding that a shot cannot be part of itself is a human's call, not a
  migrator's;
- the P1 validator reports 28 `ref.unresolved` **errors**;
- the migration report carries `migration.validation.failed`: *"the migrated
  document carries 28 contract error(s): ref.unresolved"*;
- the candidate is not `ok`, so nothing would be written.

Nothing is lost and nothing is silently repaired. This satisfies P0's gate that
the validator may not reject a real project "without an explicit, reviewed
reason" — the reason is explicit, measured and now reviewed. The outcome is
pinned as the golden for that generation, so it cannot change unnoticed.

### 7.2 Ambiguous code — `LOC-HULL-A`

Present in `overfit-17` and `overfit-18`. `LOC-HULL` exists as a location; it
carries a `coveragePolicy` string, a `sameObjectAs`, a `role` and one default
continuity state, and **no coverage record named `A`**. Longest-prefix matching —
what the live build does, and what silently discards 28 of 45 measured tokens —
would answer `LOC-HULL` and drop the suffix.

Measured behaviour: the raw token is retained in
`extensions["com.cinebraid.legacy"].codes[]` with its reading recorded
(`"LOC-HULL + A"`), the setting folds to a **dispute** whose candidates hold both
readings, and only the location is asserted — migration does not invent a
coverage view to make the reading tidy. `deriveTargetBadge` returns `conflict`,
so Ready-for-Edit stays blocked. Every location code in the archive is suffixed
this way, which is why disputes dominate the statement counts.

### 7.3 Unresolved token — `STAGE-3`

Resolves to nothing at all. Preserved in
`extensions["com.cinebraid.legacy"].unmappedCodes[]` and reported as
`migration.code.unresolved`. Never dropped. `STAGE-1`, `STAGE-2` and `SLATE-L1`
behave the same way in the earlier generations.

### 7.4 Prose dependency — the bookend

The archive states one production relationship three times in English and zero
times as structure. It first appears at `overfit-07-anchorhub-32` and survives to
v5.8.1:

- `L0-01.notes` — *"…the clean bookend… Shared-asset: L7-03 depends on this plate
  LOCKED first."*
- `L0-01.risks[2]` — *"LOCK this framing — L7-03 derives from it (bookend
  dependency)"*
- `L7-03.notes` — *"DEPENDS ON L0-01 LOCKED (shared-asset dependency)…"*

M022 produces two `bookend-of` relations, `L0-01 → L7-03` and `L7-03 → L0-01`,
each with **one** `suggested` statement quoting the sentence it was read from.
The prose is retained. No approval is fabricated. In `overfit-04-anchorhub-22` the
same rule reads six different relationships out of `Derive from …` notes.

### 7.5 Authored relations, and where they went — cross-generation

| Generation | `atomic` | `parentShot` | `fallbackFor` | M021 source values | part-of / fallback-for produced |
|---|---|---|---|---|---|
| 01–03 (anchor-hub, v1) | 0 | 0 | 0 | — (no-op) | 0 |
| **04 (anchor-hub-22, v2.2)** | 2 | **31** | **1** | 34 | **32** |
| 05–18 (v3 → v5.8.1) | 1 | **0** | **0** | 1 | 0 |

`parentShot` and `fallbackFor` appear at anchor-hub-22 and are gone from
anchor-hub-30 onward. **That loss happened inside CineBraid in July 2026, years
before this migrator existed.** The corpus can prove the distinction and the
conformance suite asserts it three ways:

1. where the source has them, all 32 reach `relations[]`;
2. where the source does not, migration produces none — it never reaches back
   into an earlier generation to refill a later one;
3. M021's reported `sourceTargets` equals exactly what the source generation
   still contains (the surviving `atomic` flag alone, from generation 05 on), and
   `identity.lost` is empty everywhere. The report claims no loss because from
   its point of view there was nothing there.

`NC-P3-08`, `NC-P3-09` and `NC-P3-19` are the controls for the three directions.

M021 emits **zero statements** in every generation, which is P0 §10.3 working:
recovering authored structure is not a guess.

### 7.6 Two locations on one shot — new

`shot:L0-02` carries both `LOC-LOGBAY-A` and `LOC-CORRIDOR-A`. From
`overfit-07-anchorhub-32` onward, M020 asserts the first, reports the second, and
raises `migration.review.required`. A second real ambiguity class the audit did
not name, handled by the mechanism that already existed.

### 7.7 M080 quarantines a value that is not a credential — new

`overfit-14-hub-v4-3` has
`/shots/0/promptBuilder/spec/references/0/token` (and its `providerPayload` twin)
holding the string `"#image1"` — a prompt reference placeholder. M080's
key tokeniser reads `token` as a credential name and refuses it entry.

The value is **dropped by a named rule with an explicit disposition and a
warning diagnostic**, so G4 holds and nothing is silent. But it is a real
false positive on real data: the key is a legacy field name, the value is
obviously not a secret, and the quarantine cost the document a value it could
have preserved. P2 §8 anticipated exactly this trade (`token` "is a credential in
every other context a document scanner meets it") and chose the safe side.
**Flagged for P4**: whether M080 should consider the value's shape, or whether
`token` should become a pair like `api key`. P3 changes nothing.

### 7.8 Two audit-named hazards the archive does not contain

Measured, not assumed:

- **`[INFERRED FOR PLANNING]` appears zero times in all eighteen generations** —
  the string `INFERRED` does not occur anywhere in the corpus. **M040 never
  fires against real data.** It stays covered by `tests/fixtures/ofp-legacy/inferred-marker.json`
  and by `NC-P3-02`, which brings its own document to prove the sanitizer would
  preserve the marker if one ever arrived.
- **Only the `dur` alias is used.** `duration` and `sec` appear nowhere, so
  M010's alias-disagreement branch is not exercised by the archive either.

Neither is a defect. Both are corrections to what the corpus can be claimed to
cover, and the conformance suite asserts them so a future fixture change cannot
quietly introduce one and make the coverage claim true by accident.

### 7.9 Identifier portability

`INT-1->2` … `INT-5->6` are present from `overfit-04` onward and **round-trip
verbatim** in all fifteen. They satisfy the identifier floor, fail the
`id-portable` profile, and are reported twice — `migration.id.not-portable` by
the migration report and `id.not-portable` by the validator, independently.
Nothing renames them. Minted nested identifiers inherit those stems, exactly as
P2 §12 said they would.

### 7.10 Version markers

`meta.version` is `"v2.1"` in every generation and is classified `film-draft`
every time; `meta.hubVersion` climbs `v1 → v2.2 → v3 → v3.1 → v4 → v4.3 → v4.6
→ v4.7 → v5.8.1`. The two never collide, and the film's draft number is never
read as an application version. M002 writes exactly one `suggested` statement on
`#/meta/draft` per generation, because that reading is a heuristic.

---

## 8. Statement volume — the first real measurement for P0 Q2

| Fixture | Shots | Source values | Statements | Per shot | Per source value |
|---|---|---|---|---|---|
| `overfit-01-anchorhub-v1` | 11 | 406 | 20 | 1.82 | 0.049 |
| `overfit-02-anchorhub-18` | 11 | 413 | 20 | 1.82 | 0.048 |
| `overfit-03-anchorhub-19` | 11 | 400 | 20 | 1.82 | 0.050 |
| `overfit-04-anchorhub-22` | 39 | 1225 | 52 | 1.33 | 0.042 |
| `overfit-05-anchorhub-30` | 16 | 1185 | 20 | 1.25 | 0.017 |
| `overfit-06-pre-v32` | 16 | 792 | 20 | 1.25 | 0.025 |
| `overfit-07` … `overfit-17` | 22 | 1048–1254 | 31 | 1.41 | 0.025–0.030 |
| `overfit-18-cinebraid-581` | 22 | 1792 | 31 | 1.41 | 0.017 |

**Worst case 1.82 statements per shot and 0.050 per source value.** Statements
are sparse and the ratio *falls* as documents get richer, because volume tracks
ambiguity rather than size — 45 of the 52 statements in the largest generation
are `codes[]` disputes, and every generation has the same handful of suffixed
location tokens no matter how much else it gains.

The kinds hold: **1–7 `suggested`, 19–45 `disputed`, 0 `cited`, 0 `observed` and
0 `approved`** across all eighteen. Migration never approves.

The suite guards a documented ceiling of **3.0 statements per shot** and **0.10
per source value** — roughly 2× headroom over the worst measured case — rather
than pinning the exact numbers, which the goldens already hold. `NC-P3-18` proves
the guard fires.

**P0 Q2 is not settled here**, and P3 does not settle it. This is one film at 11
to 39 shots. P2 §16's 1,500-shot re-measure remains outstanding, and what this
measurement supports is only that the design is not obviously pathological on
real data.

---

## 9. Ready-for-Edit

Tested, not extended. An unresolved migration dispute on `shot:*#/setting` folds
to `conflict` through `deriveTargetBadge`, which is the gate — so a project whose
ambiguous location tokens have not been resolved does not quietly read as ready.
P3 adds no readiness semantics.

---

## 10. P4-deferred issues, as the real corpus met them

P2 §12 recorded three deferred questions. All three were reached:

1. **`assets[]` has no `storage.path`.** M030 fires on four generations and mints
   asset identity from `approvedFile`; the filename goes to
   `extensions["com.cinebraid.legacy"].assetFiles`. Nothing is lost and the
   corpus does not force the question. **Not blocking G4.**
2. **No `frame-approved` reference purpose.** Reached on the same generations;
   the purpose is `other` and the meaning lives in the reference's subject.
   Cosmetic at this revision. **Not blocking G4.**
3. **Minted IDs inherit non-portable parent stems.** Confirmed on real data —
   frames minted under `INT-1->2` carry the stem. Legal, deterministic, reported
   by the same mechanism that reports the parent. **Not blocking G4.**

Two new ones from §7:

4. **M080's `token` false positive** (§7.7) — should the quarantine consider the
   value, or should `token` become a pair?
5. **M022's mints have no `sourcePath`.** P2 §7 says every mint records its
   source path; the relations M022 mints from prose carry `sourcePath: null`,
   even though the accounting claim for the same relation names the sentence it
   came from. Pinned by the conformance suite and scoped to M022 so a second rule
   cannot join it quietly. Report-completeness, not data loss.

**No frozen contradiction was found, and the P1 contract was not widened.**

---

## 11. Security and privacy

Every committed file in the fixture tree — the eighteen fixtures, the manifest,
the summary and the three full goldens — is scanned on every CI run against a
pattern list covering drive-qualified paths, UNC roots, POSIX home directories,
absolute URLs, credentials in URLs, loopback and LAN endpoints, IPv4 addresses,
and credential-named keys. Keys and values both. The build tool runs the same
scan before it writes anything, and again over each serialized candidate.

`node scripts/scan-secrets.js tests/fixtures/ofp-migration` passes, with the
scanner self-validating 9/9 rules against its synthetic positive control.

The manifest records source locations relative to the archive root, so it names
no drive and no home directory. The conformance suite additionally asserts that
neither `scripts/overfit-fixture-model.js` nor `scripts/overfit-sanitizer.js`
contains an absolute path — after P3 the repository is self-contained, and a
check that reached for somebody's `D:` drive would pass on exactly one machine.

No media of any kind is committed: no images, video, audio, caches, provider
payloads or credentials. Filenames are retained; files are not.

---

## 12. Golden drift, and how a golden changes

Normal CI **verifies** and never rewrites:

```
npm run fixtures:overfit:verify      # = check:ofp-overfit
```

Regeneration is a separate command that writes, has no default source, and is not
reachable from any `check:*` script — asserted by the conformance suite and by
`NC-P3-20`:

```
npm run fixtures:overfit:update -- --source <archive-root>
npm run fixtures:overfit:update -- --goldens-only
```

The drift gate has three layers, because each fails vacuously alone:

1. **fixture bytes** — each fixture's SHA-256 is pinned in the manifest, so a
   hand-edited fixture fails before anything is migrated;
2. **the pinned summary** — every generation is re-migrated and compared field
   for field against `goldens/summary.json`, including the candidate's SHA-256;
3. **the full documents** — three canonical outputs compared byte for byte.

`NC-P3-12` and `NC-P3-12b` prove that layers 2 and 3 catch different things: a
change the summary records, and a change only the serialization shows.

---

## 13. Tests

| Suite | Covers |
|---|---|
| `tests/ofp-overfit-conformance.js` | corpus integrity, manifest agreement, hazard survival, privacy, detection, the drift gate, G4, determinism, scenarios A–F, readiness, statement volume, verify/update separation |
| `tests/ofp-overfit-negative-controls.js` | 21 controls, each with a live-defect receipt |

Registered as `check:ofp-overfit` and `check:ofp-overfit-negative`, both inside
`check:ofp-core`, in `tests/run-full-check.js` and in the
`tests/current-behavior.js` manifest. No suite was skipped, quarantined or
widened, and no existing suite was modified.

### Functional audit

| Scenario | Result |
|---|---|
| **A** earliest generation | `overfit-01-anchorhub-v1`: valid candidate, 406/406 values accounted, 0 unaccounted, 0 minted (nothing nested to mint), 26 identities all preserved, no source writes |
| **B** representative middle | `overfit-11-hub-v4-0`: valid, deterministic, `hubVersion v4`, and the lineage checks out — `meta.aiPolicy` is absent here and present from v4.2 on |
| **C** latest v5.8.1 | `overfit-18-cinebraid-581`: ambiguous `LOC-HULL-A` → dispute with the raw token retained, `STAGE-3` → preserved and reported, bookend read out of prose → 2 relations and 2 suggestions, 5 non-portable IDs verbatim and warned twice, film draft kept apart from `hubVersion`, 1792/1792 accounted, valid |
| **D** cross-generation relation loss | 32 authored relations recovered where present, none fabricated where absent, M021's reported source values equal what each generation actually holds, `identity.lost` empty throughout |
| **E** regeneration | sanitizer run twice → byte-identical fixtures and manifest; migration run twice → byte-identical candidates and reports; `--goldens-only` afterwards changes nothing |
| **F** source archive | 13,574 entries across both roots, byte-identical contents, sizes, mtimes and tree shape; snapshot digest unchanged |

### Negative controls

Twenty-one, all detected, each with a receipt proving the defect was live before
the guarded property was allowed to fail. Nothing was written to disk and nothing
was reverted with git; every defect is compiled in memory and installed in the
module cache. Anchors are matched against LF-normalized source, must be unique,
and must actually change the text.

| # | Defect reintroduced | Caught by |
|---|---|---|
| NC-P3-01 | trimming the suffix off an ambiguous code | the hazard census is identical before and after |
| NC-P3-02 | rewriting `[INFERRED FOR PLANNING]` as ordinary prose | the hazard census is identical before and after |
| NC-P3-03 | normalising a non-portable identifier | exact-length sanitization |
| NC-P3-04 | discarding a legacy field the sanitizer does not model | identical leaf pointers, in order |
| NC-P3-05 | reordering an array | identical leaf pointers, in order |
| NC-P3-06 | resolving `LOC-HULL-A` by longest prefix and calling it the answer | a suffixed code produces a dispute |
| NC-P3-07 | dropping a code token that resolves to nothing | `STAGE-3` survives in the preservation block |
| NC-P3-08 | fabricating a relation the source generation does not contain | later generations produce no authored relations |
| NC-P3-09 | failing to recover an authored `parentShot` | all 32 reach `relations[]` |
| NC-P3-10 | migration promoting its own reading to an approval | no generation produces an approval |
| NC-P3-11 | letting the final sweep skip what no rule claimed | G4: every source value has a disposition |
| NC-P3-12 | migration output changing without the golden being re-pinned | the pinned summary |
| NC-P3-12b | a full golden document drifting from current output | the pinned bytes |
| NC-P3-13 | the fs guard letting a write through to the archive | INV-R1 over the source root |
| NC-P3-14 | the privacy scan no longer recognising an absolute path | a leaked path must be refused |
| NC-P3-15 | the privacy scan no longer recognising a credential key | a credential-named field must be refused |
| NC-P3-16 | the sanitizer drawing a pseudo-word from a random source | sanitizing twice produces the same bytes |
| NC-P3-17 | migration reading a clock instead of its given instant | migrating twice produces the same bytes |
| NC-P3-18 | a rule emitting a statement per mapping instead of per guess | the per-shot volume guard |
| NC-P3-19 | the report claiming a later generation had relations to lose | M021 accounts for exactly what the source holds |
| NC-P3-20 | a check script regenerating the fixtures it verifies | verify and update are separate commands |

Three of these were sharper than expected and the sharpening is the finding.
`NC-P3-12`'s first draft renamed a rule and was **not** caught — correctly, since
a rule's name is documentation and the golden records its ID; the control now
changes a value the document carries. `NC-P3-17`'s first draft injected
`new Date().toISOString()`, which `migrateLegacyProject` rejects as a malformed
instant and replaces with the default — so the defect never installed, and the
control had to emit the second-resolution form the contract accepts.
`NC-P3-08`'s first draft guessed relations from identifier stems and fired on
nothing, because of §7.1: in the one generation with lettered child shots, the
stems do not exist.

---

## 14. What remains for P4+

Unchanged from P2 §16, plus what §10 adds:

- **Canonical persistence** — INV-R2 and INV-R3 as live behaviour, retiring
  `normalizeProjectV5`, switching runtime save and load (P4).
- **Migrating any real project.** P3 migrated sanitized derivatives in memory.
  Nothing was converted.
- **`storage.path` on the asset record**, and MediaAsset activation.
- **A `frame-approved` reference purpose**, if the contract wants one.
- **M080's `token` false positive** (§7.7) and **M022's missing mint
  `sourcePath`** (§10.5).
- **The 28 dangling `parentShot` targets** (§7.1) — a human decision about
  anchor-hub-22, not a migrator change.
- **Statement-volume scaling** (P0 Q2) — the 1,500-shot re-measure.
- **Compaction on save** (P0 §6) — specified, still unimplemented.
- **Project Builder envelope** (P5), **export / interchange and the public
  spec** (P6/P7).
- **Any migration UI.** No control exists and nothing runs migration on open,
  save, import or startup.

---

## HARD STOP

No real project was migrated or converted. The archive was read only, and is
byte-identical afterwards. Nothing was wired into project open, project save,
Project Builder import, startup or settings. No canonical persistence. No
MediaAsset activation. No export/import. No public spec repository. No References
UI work. No provider or installer work. No P1 schema change. The contract remains
`1.0-draft.1` and OFP 1.0 is not released.

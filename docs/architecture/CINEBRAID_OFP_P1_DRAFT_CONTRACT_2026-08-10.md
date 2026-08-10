# CineBraid — OFP P1: draft contract and report-only validation

Date: 2026-08-10
Implements: `CINEBRAID_P0_ARCHITECTURE_DECISION_2026-08-09.md` (frozen)
Basis: `CINEBRAID_CANONICAL_FORMAT_AUDIT_2026-08-09.md`

This is implementation documentation. It records what P1 built and the decisions
P1 was asked to make. It does not restate P0 and it does not amend it.

**The contract is `1.0-draft.1`. OFP 1.0 is not released.**

---

## 1. Format identity

```json
{
  "format": {
    "id": "open-film-project",
    "version": "1.0-draft.1",
    "profiles": ["core", "bible", "shot-planning"],
    "extensions": { "com.cinebraid.workflow": "1" },
    "generator": { "name": "CineBraid", "version": "6.6.6-private.1" }
  }
}
```

`format.version` is the **contract** version. `format.generator.version` is the
**application** version. A document written by CineBraid 6.6.6 says
`1.0-draft.1`, never `6.6.6` — which is the confusion this lane exists to end.

Grammar: `^(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-draft\.(0|[1-9]\d*))?$`. A released
`MAJOR.MINOR` sorts **after** every draft of the same number, because that is
the order they happen in.

Classification is comparison against the revision this build implements:

| Document | Class | Access |
|---|---|---|
| `1.0-draft.1` | `supported-draft` | read-write |
| older draft, or an older stable | `older-draft` / `stable` | read-only |
| newer draft | `newer-draft` | read-only |
| newer stable, including `1.0` | `newer-unsupported-stable` | read-only |
| `schemaVersion` present, no `format` | `legacy-cinebraid` | read-only |
| missing/malformed `format`, or another `format.id` | `format-block-invalid` | none |

A revision this build cannot write is **not judged against this build's schema**
— structural, semantic and portability checks are reported as `skipped`. Checking
a `1.0-draft.7` document against the `1.0-draft.1` schema would report
differences with a contract nobody has written, which is noise dressed as
findings. The classification is the answer for those documents.

`1.0` classifies as *newer* and read-only. That is deliberate and honest: 1.0 has
not shipped, so a document claiming it is from the future.

---

## 2. Real projects never enter the draft lane

A legacy CineBraid document is classified, reported with `format.legacy` at
**info** severity, and then left alone. Deeper validation stops there. This is
not laziness:

- a legacy project judged against the OFP schema produces a page of diagnostics
  about a contract it never claimed to follow, and
- every one of those diagnostics reads as an invitation to convert it.

Proven by test and by the functional audit: opening a legacy project leaves
`schemaVersion` untouched, invents no `format` block, creates no
`project.ofp.json` beside it, and reports zero errors. `NC-09` reintroduces the
conversion and confirms the tests notice.

---

## 3. Module layout

Everything lives under `ofp/`, deliberately **not** under `public/`: P1 has no
browser surface, and `public/*.js` share one global scope, where a duplicate
top-level binding blanks the whole application.

| Module | Owns |
|---|---|
| `ofp-json.js` | strict parse — duplicate keys and BOM refused |
| `ofp-format.js` | format identity, version grammar, classification |
| `ofp-identifiers.js` | the two-tier ID rule and deterministic minting |
| `ofp-schema.js` | the declared contract: shape, key order, collection order, containment |
| `ofp-target.js` | subject grammar, RFC 6901 path, resolution |
| `ofp-claim.js` | claim payload, JCS, hash |
| `ofp-statements.js` | five acts, derived state, the badge fold |
| `ofp-diagnostics.js` | the diagnostic registry and its severities |
| `ofp-validate.js` | the report-only validator |
| `ofp-serialize.js` | file form and hash form |
| `ofp-fs-guard.js` | INV-R1, enforced over `fs` |
| `ofp-read.js` | the guarded read entry point; pins the canonical file name |
| `scripts/validate-ofp.js` | CLI |

None of this is wired into CineBraid's save/load. The runtime still reads and
writes legacy `schemaVersion 6.7` exactly as it did.

---

## 4. Schema and profiles

`ofp-schema.js` is one declaration serving four purposes that would otherwise
drift apart: structural shape, canonical key order, canonical collection order,
and **the resolver's containment table** — which is *walked out of the schema*
rather than typed a second time. `tests/ofp-contract.js` asserts the derived
table equals the frozen P0 §3 table exactly (17 types; `state` with four owners,
`coverage` with three).

The shape is JSON-Schema-compatible (`type`, `properties`, `required`, `enum`,
`items`) so it can become a real schema document later without a key moving. The
extra keys — `record`, `collection`, `ref`, `subjectRef`, `passthrough`,
`closedEnum`, `nullable` — are contract metadata JSON Schema has no vocabulary
for. No dependency was added; the repository has one (`express`).

Profiles are declared in `format.profiles`. `continuity` is declared as a
`passthrough` container: its interior belongs to the `continuity` profile, which
this revision does not model, so it is preserved verbatim and not reported key
by key. `extensions` and `format.extensions` are passthrough by definition.

### Two P1 contract choices worth naming

**`duration.seconds` is the only nullable field.** Production distinguishes three
states there: the key absent (no duration slot at all), `null` (the slot exists,
its length was never set), and a number. P0 §5 allows `null` only where the
contract declares it, so the declaration is in one place rather than everywhere.

**`"unspecified"` appears on exactly two enums** — `duration.basis` and
`framing.lens` — which are the two P0 §5 names. A case can be made for
`scene.setting.timeOfDay`, and P1 deliberately did **not** make it: widening a
frozen decision is not P1's call. A test pins the list at two.

---

## 5. Target addressing

```
target := { subject?: <subject-ref>, path?: <json-pointer> }
subject-ref := step ("/" step)*      step := type ":" id
path        := RFC 6901, rooted at the resolved subject record
```

`subject` omitted ⇒ the document root. `path` omitted or `""` ⇒ the whole record.
No new pointer dialect: once the subject resolves, `path` is ordinary RFC 6901.

**Resolution fails if traversing `path` would enter an array.** That single rule
makes array indexes structurally incapable of being identity, and it makes
root-scoped targets safe for free — `/meta/title` resolves, `/shots/0/...` cannot,
with no special case for the root. A whole array is still addressable as a value
(`/risks`); only entering one fails.

The asymmetry is the design: finding `shot:sh-0100` walks the `shots` array, and
that is fine, because the record is found by **ID** and the position is never
recorded. The prohibition is on `path`, where a position *would* become the
address.

Subject types are specific — `character:char-mara`, never a generic `entity:` —
so "you said character, that is a prop" is caught rather than accepted.

Resolution outcomes: a value, **ABSENT** (a valid address with no value there),
or a failure coded `unresolvable` / `array-traversal` / `malformed`.

---

## 6. Claim binding

```
claimPayload := { "ofp": "claim/1", "t": <subject#path>, "v": <value> }
claim.hash   := "sha256:" + lowercase-hex( sha256( utf8( JCS(payload) ) ) )
```

Two details carry the mechanism.

**The target is inside the hash.** Without it, an approval of
`framing.size = "wide"` could be retargeted to another field that also holds
`"wide"` and still verify. `NC-02` removes `t` and confirms two different fields
then hash identically.

**`v` is omitted, never set to `undefined`, when the target resolves to nothing.**
`canonicalJson` maps `undefined` → `"null"` — correct for the continuity manifest
it was written for, a silent catastrophe here, since "absent" and "present and
null" would hash alike. So the payload is built by key omission and the existing
helper is reused **only to hash it**. This is P0 N3, and `NC-04` reintroduces it.

JCS is RFC 8785 via `public/shared-continuity.js`'s `canonicalJson`, which is
already checked against Node's `crypto`. Nothing was reimplemented. Vectors for
code-unit key order, `-0`, `1e21` and ECMAScript number formatting are pinned in
`tests/ofp-contract.js`.

`claim.preview` is advisory, never compared, and **never recomputed on save** —
recomputing it would let a change to the preview formatter rewrite every file.

---

## 7. Statements and derived state

Five acts, frozen: `cited`, `suggested`, `observed`, `approved`, `disputed`.
Ordinary authored production data carries **no statement at all**, which is what
keeps the array sparse.

```
target does not resolve               -> unresolvable
recomputed hash != stored hash        -> stale
otherwise                             -> current
```

Derived on every read, **never persisted** — the same discipline continuity
already earns, where intent and observation are stored and the finding is always
computed.

The badge fold ignores stale and unresolvable statements, which is where the
single most important rule lives: **a stale `approved` confers no approval**. It
is not dropped, hidden or repaired — the validator still reports it, and a view
is expected to say "approved 3 Aug, for a value that has since changed". It
simply stops counting as approval, because it is an approval of something nobody
has now. Outcome words (`Conflict` / `Approved` / `From script` / `Suggested` /
`Observed` / `Authored`) live in the contract module, not in any renderer.

---

## 8. Identifiers

| Tier | Rule | Severity |
|---|---|---|
| floor | non-empty, NFC, no `:` `/` `#`, no whitespace, no C0/C1 | **error** |
| `id-portable` | `^[A-Za-z0-9._-]+$` | **warning** |

The gap is not an accident. `INT-1->2` — five real legacy shot IDs — satisfies the
floor, so it round-trips verbatim and **nothing renames it**; it fails the
profile, so it is reported. The report is worth having on its own: `>` is illegal
in a Windows path segment and shot IDs are directory names today.

`id.not-portable` must stay a **warning**. An error is what would eventually
tempt somebody to rename a legacy identifier, and a rename destroys the only link
between a shot and its history. `NC-15` promotes it to an error and confirms the
suites notice.

Also enforced: uniqueness within a collection, uniqueness scoped to the parent
for nested records, and **one namespace across all five entity collections** —
required because `shot.subjects[].entityId` carries no type.

### Deterministic ID minting

> Array position may be used to **mint** an identity exactly once.
> Array position may never **be** an identity.

`mintNestedIdentifiers` returns a report and mutates nothing. Minting reads the
position; the result is then stored and stable for the record's life, so
reordering afterwards changes nothing — records that already have an ID are never
touched. A colliding positional stem falls back to a content-addressed suffix,
also deterministic. No clocks, no counters, no UUIDs: migration must be
re-runnable and the same legacy input must always mint the same IDs.

**P1 defines and tests this rule. P1 migrates nothing.**

---

## 9. Validator

Report-only. It does not repair, coerce, default, migrate or write. **The
document is the document.** A default may be applied at *use*, later, by whoever
uses it; it must never appear because a document was inspected. This is the
direct answer to `normalizeProjectV5`.

Four separable modes, because they answer different questions and a caller should
act on them differently: `structural`, `semantic`, `portability`,
`compatibility`. Not every warning is fatal — treating them alike is how a
validator becomes something people route around.

Output is a plain object (`ok`, `documentClass`, `access`, `version`, `modes`,
`skipped`, `diagnostics[]`, `counts`, `statementStates[]`, `document`) so it can
cross a process boundary, an HTTP response or a CLI unchanged, and is usable by a
future importer, migration preview or Project Builder without any browser
coupling.

### Diagnostics

Every code is declared in a registry with its severity and owning mode, so a
caller can switch on a code, a test can assert nothing emits an unregistered one,
and severity is a property of the contract rather than of the call site.

`statement.target.unresolvable` · `statement.target.array-traversal` ·
`statement.target.malformed` · `statement.claim.malformed` ·
`statement.kind.unknown` · `statement.stale` · `statement.stale.approval` ·
`statement.candidates.missing` · `statement.actor.missing` ·
`statement.actor.not-human` · `id.invalid` · `id.duplicate` ·
`id.entity-collision` · `id.not-portable` · `ref.unresolved` ·
`subject.unresolvable` · `schema.type` · `schema.required.missing` ·
`schema.const` · `schema.pattern` · `schema.enum.unknown` ·
`schema.unknown-property` · `json.syntax` · `json.bom` · `json.duplicate-key` ·
`json.depth` · `format.invalid` · `format.unsupported` · `format.legacy` ·
`format.supported`

Both `statement.stale` and `statement.stale.approval` fire for a stale approval:
the first so a caller counting staleness sees every one, the second so the case
that must reach a human is separately addressable.

---

## 10. Unknown data

- **Unknown extension subtrees** are preserved as parsed and re-serialized with
  keys in JCS order. The guarantee is semantic (deep-equal), not byte — byte
  preservation of a foreign subtree is impossible once a file is canonically
  written, and INV-R1 is what protects the byte case absolutely.
- **Unknown enum values** are reported at warning severity and preserved
  verbatim. Never coerced. A reader that replaced an unrecognised value with a
  default would destroy production data to make itself comfortable.
- **Undeclared keys on declared records** are reported at warning severity and
  preserved. A newer revision may add fields.
- Declared passthrough containers are **not** picked over key by key.

`NC-07` and `NC-08` reintroduce dropping and coercion. This is gate **G2**.

---

## 11. INV-R1 — opening writes nothing

Enforced by an `fs` wrapper over the project root, not by discipline. Index
rebuilds, caches and telemetry all want to write on open, and each arrives with a
good reason.

Proven two independent ways, because each fails vacuously in a different
direction:

- the **guard** proves no write was *attempted*, including to files that did not
  exist before and would hash to nothing on the way in — and section 1 of
  `tests/ofp-read-invariant.js` proves the guard actually bites before anything
  else is asserted;
- the **tree snapshot** proves nothing changed and nothing appeared — but it
  cannot see a file written and then deleted.

Ten document classes are opened with zero writes attempted and zero tree
changes: valid draft, minimal draft, invalid draft, newer draft, newer stable,
unknown extension content, structurally invalid JSON, duplicate object key,
another format entirely, and a legacy project. Reads work inside the guard;
writes **outside** the project root are unaffected, because config bootstrap
elsewhere on disk is explicitly not a violation. `fs` is restored even when the
guarded work throws.

`NC-06a` writes a `.bak` and is refused by the guard; `NC-06b` creates a file
before the guard is armed and is caught by the snapshot.

---

## 12. Canonical serialization

Two forms, kept apart. **File form**: UTF-8, no BOM, LF, two-space indent,
exactly one trailing newline, deterministic key and collection order. **Hash
form**: RFC 8785 JCS. Conflating them is how a format acquires an unreadable
serialization for no reason.

Rule 9 is the workhorse and it is a rule about the *writer*: it must not emit a
key that was absent on load, and must not drop a key that was present, even when
the value equals the default. Empty collections are kept iff they were present.

Collection order: `sources`/`assets`/`references`/`statements`/entities/nested
sets sort by `id`; `shots`/`scenes` sort by ordinal then `id`, so array order and
the declared ordinal can never disagree; `frames`, `motion`, `subjects`,
`profiles` and scalar arrays (`risks`, `aliases`) are **ordered data and are
never sorted**. Sorting `risks` would silently reorder a director's priorities.

**P1 does not activate canonical persistence.** The serializer exists so the
rules are testable and so Q1 could be settled.

### Canonical file name — pinned

`project.ofp.json`. Pinned in `ofp-read.js` because `.gitattributes` has to name
it, and a name decided in two places is a name that will differ in two places.

### `.gitattributes`

```
*.ofp.json  text eol=lf
```

`core.autocrlf=true` on this machine; the shipped sample was measured at 372 CR
bytes. Without the pin, a canonical document that has only been *checked out*
already fails byte conformance. The pattern covers both the project file and the
fixtures, which are the same format and need the same guarantee. No unrelated
line-ending policy was touched. `NC-10` injects CRLF and confirms conformance
goes red — and shows the trap: a CRLF document still *parses* identically, so a
check comparing parsed values rather than bytes would miss it entirely.

---

## 13. P0 Q1 — settled: schema-derived key order for the file form

Measured on the representative fixture, both modes:

| Dimension | Schema-derived | Pure JCS |
|---|---|---|
| size | 8118 bytes | 8118 bytes |
| determinism (10 runs) | 1 output | 1 output |
| independent of producer key order | yes | yes |
| git diff for a one-field edit | 1 line | 1 line |
| extension subtrees | JCS-ordered | JCS-ordered |
| second serialization byte-identical | yes | yes |
| **a shot record opens with** | **`id`** | `duration` (`id` is key #4) |

Every dimension ties except one, and on that one the difference is not marginal:
in JCS order you read three blocks of a record before learning which record it
is, and `framing.size` sorts away from its neighbours for no reason a reader can
see.

So P0's recorded hypothesis is **confirmed by measurement rather than adopted by
preference** — and the main objection to schema-derived order turned out weaker
than it looked: the output does **not** depend on the parsed document's key
insertion order, only on the schema module's own, which is code under review
rather than data.

The coupling this accepts, stated plainly: a writer needs the schema to produce
byte-identical canonical files. That is a property of CineBraid's file form, not
an interchange requirement — JSON objects are unordered, every conforming reader
must accept any key order, and the normative form for digests is the hash form,
which is pure JCS and needs no schema at all.

**Drift guard (P0 N5).** Because schema order was chosen, reordering a
declaration silently rewrites the bytes of every project on disk. `PINNED_KEY_ORDER`
in `tests/ofp-serialization.js` pins all 19 record orders plus the document's, so
a reorder is a reviewed change. Adding a field is expected and the list is meant
to move with it; *shuffling* one is what this catches. A separate assertion
proves no property name is integer-like, which is the one case V8 would reorder.

---

## 14. Voice

Dogfood showed character-owned voices reading like peer-level audio references.
The frozen P1 direction is explicitly **not** to fix that by making voice a child
of character.

- A voice is a first-class entity in `entities.voices[]`, addressable as
  `voice:<id>`, scoped to the project.
- A **character points at voices**: `character.voices[] = [{ voiceId, role?, language? }]`
  with roles `primary` / `alternate-language` / `adr` / `performance-variant` /
  `other`.
- A voice carries **no** `characterId`.

That last point is what makes all the required cases work at once: one character
may link several voices; one voice may be linked by several characters, so a
voice is **reusable**; and a voice linked by nobody — narrator, announcer, a
non-visible voice — is an ordinary valid entity rather than an orphan. A
`characterId` would have destroyed all four properties simultaneously.

The links carry no `id` and are therefore not subjects: the containment table is
the frozen list of addressable types and a link is not on it. A statement
addresses the whole list (`path: "/voices"`), which the claim binding covers
deterministically.

`representative.ofp.json` carries Mara with three linked voices plus a standalone
narrator and a standalone announcer. `NC-16` removes the standalone collection
and confirms the tests notice. **No References UI work was done.**

---

## 15. Tests

| Suite | Covers |
|---|---|
| `tests/ofp-contract.js` | format lifecycle, legacy lane, identifiers, minting, addressing, claim binding, statements, unspecified, voice, unknown data, no-mutation, strict parse, diagnostics registry, reserved terminology, key-name stability |
| `tests/ofp-serialization.js` | byte rules, determinism, rules 9/10, collection order, file vs hash form, the Q1 experiment, the drift guard |
| `tests/ofp-read-invariant.js` | INV-R1 across ten document classes, plus proof the guard is armed |
| `tests/ofp-negative-controls.js` | 17 controls, each with a live-defect receipt |

Registered in `package.json` (`check:ofp-core`), `check:ci`, `check:quick`,
`tests/run-full-check.js` and the `tests/current-behavior.js` manifest. 24
synthetic fixtures in `tests/fixtures/ofp/`, documented in their own README. No
real user material; Overfit was not migrated or read.

### Negative controls

Every control reintroduces one defect, **proves the defect is live with a
probe**, and only then requires the guarded property to fail. That two-part
receipt exists because a recent incident had a control whose multiline anchor
silently failed to match under `core.autocrlf=true` while the harness counted the
resulting throw as success. Anchors are matched against LF-normalized source,
must be unique, and must actually change the text. Nothing is written to disk and
nothing is reverted with git — the defect is compiled in memory and installed in
the module cache, because a broad `git checkout` is how unrelated unstaged work
gets discarded.

**`NC-05` found a real gap rather than confirming a belief.** The no-mutation
test originally ran only against golden fixtures, which carry a value for nearly
every enum they declare — so a validator that filled in *absent* fields had
nothing to fill and the test passed while the defect was live. The real suite now
also validates an explicitly sparse document. That is the control doing its job.

---

## 16. Deferred to P2+

- **Migration of any legacy project**, including Overfit (P2). M001–M053 are
  unwritten. P1 only defines the ID-minting rule they will need.
- **Fixtures derived from real Overfit generations** (P3).
- **Canonical persistence**: INV-R2 and INV-R3 as live behaviour, retiring
  `normalizeProjectV5`, switching runtime save/load (P4). The serializer exists
  and is tested; nothing calls it on a real project.
- **MediaAsset activation**, Project Builder envelope and its
  `envelope.target.unresolvable` boundary (P4/P5).
- **Export/import and the public spec repository** (P6/P7).
- **The `continuity` profile's interior**, currently passthrough.
- **Compaction on save** (P0 §6): a stale `suggested` may be dropped iff a later
  `approved` or `cited` exists on the same target. P1 never drops anything, so
  the rule is specified and unimplemented.
- **Statement-volume scaling (P0 Q2)** — the 1,500-shot re-measure, still a
  later gate.
- **Durable re-review history.** Deliberately not invented. It is not in OFP core
  and no `row.reviewHistory` was added anywhere. If it needs a home, it is a
  CineBraid workflow extension or a sidecar; P1 validation did not need it.
- **References UI.** Untouched.

Release gates: P1 contributes to **G1** (validator accepts the golden fixtures;
the legacy corpus is P3), **G2** (unknown extension and unknown enum survive) and
**G3** (INV-R1 across document classes). G4–G8 are later phases.

---

## 17. Known risks and open items

1. **Schema key-order drift (P0 N5).** Mitigated by the pinned-order test, not
   eliminated. Adding a field in the wrong place changes bytes across every
   project once P4 lands. The measurement in §13 lowers this risk: the output
   does not depend on parsed-document order, only on the schema module's.
2. **The validator's schema is hand-rolled.** No JSON Schema dependency was
   added. It is the same declaration that drives ordering and containment, and a
   test pins it to the frozen containment table — but it is not a standards
   validator, and a real one may disagree at the edges when the schema is
   published in P7.
3. **`page` — an observed tension, not a blocking contradiction.** P0 §9's
   representative JSON shows `"page": 12` on a source anchor, while §12 reserves
   *page / eighths* for the scheduling profile and says no pagination field may
   use the name. §9 is illustrative and §12 is normative, so P1 resolved it by
   **needing neither**: the anchor schema is `id` / `elementKind` / `text`, with
   no page field, since no P1 invariant requires one. Flagged here for the
   screenplay profile to settle deliberately. This did not meet the bar to stop
   and report a P0 contradiction: nothing in P1 had to choose.
4. **Retired-name guard exemption.** `tests/current-behavior.js` forbids a
   retired product name anywhere in the tree. The frozen audit legitimately cites
   it as *data* — several measured legacy generation directories are named after
   it. Editing a frozen record to satisfy a lint would falsify the record other
   phases must be able to trust, so the two preserved architecture documents are
   exempted **by exact path**, with assertions that the guard still matches the
   name and that both exempt files exist. Every other file is still checked.
5. **`observed` remains the least-earned act** (P0 N8), retained under the
   no-auto-promotion rule and first to cut if the vocabulary must shrink.
6. **Draft revisions carry no migration guarantee to one another.** Bumping to
   `1.0-draft.2` makes every document written today read-only. That is the
   intended cost of the lane.

---

## HARD STOP

No migration. No Overfit. No canonical save of any real project. No MediaAsset
activation. No Project Builder change. No export/import. No public spec repo. No
References UI work. No provider or installer work. The contract remains
`1.0-draft.1` and OFP 1.0 is not released.

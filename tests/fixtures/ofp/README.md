# Open Film Project conformance fixtures (1.0-draft.1)

Every file here is **synthetic**. No real user material, no migrated Overfit
generation, no copy of anybody's project. `legacy-project.json` imitates the
*shape* of a legacy CineBraid document — a `schemaVersion`, a shot with a
`codes[]` token — so the "a real project stays legacy" path has something
realistic to run against, but its content is invented.

Draft documents are never published as spec examples or public artifacts
(P0 §7 rule 3). These are test inputs.

## How they were made

Written by a one-shot generator run from a scratchpad, not committed: the
fixtures are the artifact, and a committed generator would become a second
source of truth that could drift from the files the tests actually read. Claim
hashes were computed against the finished document, so a wrong hash shows up as
a `statement.stale` diagnostic — which makes the golden fixtures a real check
rather than a circular one.

All `*.ofp.json` files are in canonical **file form**: LF, no BOM, two-space
indent, exactly one trailing newline, schema-derived key order. `.gitattributes`
pins `*.ofp.json` to `eol=lf` so a checkout on a machine with
`core.autocrlf=true` does not quietly rewrite them — which was measured at 372
CR bytes on the shipped sample and is what `tests/ofp-serialization.js` guards.

Two files are written as raw text because no serializer can emit them:
`duplicate-key.ofp.json` and `malformed-json.ofp.json`.

## What each one is for

| Fixture | Exercises |
|---|---|
| `minimal.ofp.json` | the smallest valid document |
| `representative.ofp.json` | scene, shot, character, prop, states, coverage, voice links, source + anchor, asset, reference, and all five statement kinds — the golden document |
| `stale-approval.ofp.json` | a value changed after it was approved; `statement.stale` + `statement.stale.approval` |
| `unresolvable-target.ofp.json` | a statement pointing at a shot that no longer exists |
| `array-traversal-target.ofp.json` | a path that would enter an array — the restriction that makes array indexes structurally incapable of being identity |
| `malformed-target.ofp.json` | a subject that is not `type:id`, and a pointer that does not start with `/` |
| `id-not-portable.ofp.json` | the measured legacy shape `INT-1->2` — legal, preserved verbatim, reported as a warning |
| `invalid-id.ofp.json` | the four reserved delimiters `:` `/` `#` and whitespace |
| `duplicate-id.ofp.json` | two records in one collection sharing an id |
| `entity-id-collision.ofp.json` | one id used by two entity collections, which `shot.subjects[].entityId` could not disambiguate |
| `unresolved-reference.ofp.json` | a `sceneId` and a `references[].subject` that name nothing |
| `unknown-extension.ofp.json` | a foreign extension subtree and an undeclared field on a declared record |
| `unknown-enum.ofp.json` | an enum value this revision does not declare — reported, never coerced |
| `absent-vs-null.ofp.json` | the two states hashing differently, which is the whole point of omitting `v` rather than setting it undefined |
| `deliberately-unspecified.ofp.json` | `"unspecified"` as a member of the field's own enum, so it survives a tool that discards `statements[]` |
| `approved-non-human.ofp.json` | an approval by a model, and an approval with no actor |
| `disputed-without-candidates.ofp.json` | a conflict about nothing |
| `duplicate-key.ofp.json` | a duplicate object key, observable only at parse |
| `malformed-json.ofp.json` | a truncated document |
| `invalid-format.ofp.json` | a document declaring some other format |
| `older-draft.ofp.json`, `newer-draft.ofp.json`, `newer-stable.ofp.json` | the compatibility lane: read-only, no conversion |
| `legacy-project.json` | a legacy CineBraid document, which must stay legacy |

## Read by

- `tests/ofp-contract.js` — the contract itself
- `tests/ofp-serialization.js` — canonical file form and the P0 Q1 decision
- `tests/ofp-read-invariant.js` — INV-R1, opening writes nothing
- `tests/ofp-negative-controls.js` — proof those three would notice a regression

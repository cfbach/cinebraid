# Sanitized Overfit migration fixtures (OFP P3)

These are **sanitized derivatives of real historical CineBraid project data** —
eighteen successive snapshots of one short film across four application
generations, from the earliest `anchor-hub` build through two intermediate eras
to `CineBraid v5.8.1`.
Unlike `tests/fixtures/ofp-legacy/`, which is entirely synthetic, everything here
descends from documents somebody actually made.

They are **not OFP documents**. They are legacy `project.json` documents, the
input side of a migration. The OFP output lives in `goldens/`.

Nothing here is hand-written or hand-edited. Every file is produced by
`scripts/build-overfit-golden-fixtures.js` from the read-only archive, and
regenerating it is an explicit maintenance command — see below.

## Layout

| Path | What it is |
|---|---|
| `generations/*.legacy.json` | the eighteen sanitized legacy documents, in lineage order |
| `manifest.json` | provenance: source digest, fixture digest, version markers, counts, hazards and the sanitization rules applied, per generation |
| `goldens/summary.json` | the pinned migration result for all eighteen — rules applied, accounting, counts, diagnostics, statement kinds, validation and the candidate's SHA-256 |
| `goldens/*.ofp.json` | full canonical OFP output for three generations |

## No media, no host paths, no secrets

Project documents only. **No images, video, audio, caches, provider payloads or
credentials.** Where the legacy document references a media file, the filename
is kept — its `project_shot_role_version` shape is what M030 reads — but no file
is copied. Source paths in the manifest are relative to the archive root and
carry no drive letter or home directory; `tests/ofp-overfit-conformance.js`
re-checks every committed byte against a privacy pattern list on every run.

## What sanitization preserved, and why

The corpus is only worth having because of the awkward things in it, so
structure, identity and the prose migration actually reads are untouched:

- every key in source order, every array at its source length and order, and the
  distinction between absent, `null`, `""`, `[]` and `{}`;
- every identifier and `codes[]` token **including the broken ones** —
  `INT-1->2` is not portable and `LOC-HULL-A` is a suffix that names nothing;
- every number, boolean, enum, status, timestamp, model name and filename;
- the words M022 reads dependencies out of (`bookend`, `derive from`,
  `depends on`, `shared-asset`) and the shot IDs those sentences name.

Only free prose was replaced, word for word, at exactly the source length,
through a pure function of the lowercased word — so two fields that held the
same sentence still do, and two that differed still differ. The pseudo-words are
syllabic nonsense on purpose.

## What these exercise

| Invariant | Where |
|---|---|
| no `schemaVersion` anywhere; detection must sniff the shape | all eighteen |
| `meta.version` is the **film's draft number**, not an application version | all eighteen |
| `hubVersion` climbing `v1 → v2.2 → v3.1 → v4 → v4.7 → v5.8.1` | the lineage |
| the `dur` duration alias | all eighteen |
| authored `atomic` / `parentShot` / `fallbackFor` → `relations[]` (M021) | `overfit-04-anchorhub-22` |
| a production relationship that exists as English and not as structure (M022) | `overfit-07` onward |
| a suffixed code that names nothing → dispute, raw token retained (M020) | `overfit-18-cinebraid-581` |
| `STAGE-3`, which resolves to nothing → preserved and reported | most generations |
| non-portable `INT-1->2` … `INT-5->6` preserved verbatim, warned twice | `overfit-04` onward |
| **28 dangling and 2 self-referential `parentShot` targets** | `overfit-04-anchorhub-22` |
| unknown legacy fields with no OFP representation (M070) | all eighteen |

Two hazards the audit named are **not** here, and that is a measurement rather
than an omission: no archived generation contains `[INFERRED FOR PLANNING]`, and
none uses the `duration` or `sec` duration aliases. M040 and the alias-conflict
branch of M010 are exercised by the synthetic fixtures in
`tests/fixtures/ofp-legacy/` instead.

## Changing these files

Normal checks **verify** and never rewrite:

```bash
npm run fixtures:overfit:verify
```

Regenerating is a separate, deliberate command that writes. It needs the
read-only archive, which is not in this repository:

```bash
npm run fixtures:overfit:update -- --source <archive-root>
```

To re-pin only the migration goldens after an intended semantics change, without
the archive:

```bash
npm run fixtures:overfit:update -- --goldens-only
```

Either way the diff belongs in the pull request. A golden that changed without
anybody deciding it should is the failure this directory exists to prevent.

## Read by

- `tests/ofp-overfit-conformance.js` — the corpus, the drift gate and release gate G4
- `tests/ofp-overfit-negative-controls.js` — proof that suite would notice

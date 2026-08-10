# CineBraid 6.7.0 Private Test 1 — verification report

This release changes no application behaviour. It moves the application version
from `6.6.6-private.1` to `6.7.0-private.1` to mark the first build carrying the
Open Film Project 1.0-draft.1 contract, and re-stamps the surfaces derived from
it. The evidence below is therefore about two things: that the version identity
is coherent, and that nothing else moved with it.

## Version identity

`package.json` "version" is the only hand-edited version. The window title, the
36 asset cache-busting query strings and the lockfile were stamped by
`npm run sync:version` — no version literal was edited by hand — and
`npm run check:version` confirms the Git tag, the display name and the archive
names all derive from that one source.

| Surface | Owner | Value |
|---|---|---|
| `package.json` "version" | hand-edited, authoritative | `6.7.0-private.1` |
| `public/index.html` title | `sync-version.js` | CineBraid 6.7.0 Private Test 1 |
| `public/index.html` `?v=` stamps (36) | `sync-version.js` | `6.7.0-private.1` |
| `package-lock.json` (2 sites) | `sync-version.js` | `6.7.0-private.1` |
| Git tag | derived | `v6.7.0-private.1` |
| Archives | derived | `cinebraid-6.7.0-private.1-{windows.zip,runtime.tar.gz}` |

## What the version did not move

The three version concepts are separate, and only the application version
changed:

| Concept | Value | Status |
|---|---|---|
| CineBraid application | `6.7.0-private.1` | raised by this release |
| Legacy project schema (`PROJECT_SCHEMA_VERSION`) | 6.7 | unchanged |
| Legacy schema baseline (`server.js` `schemaVersion`) | 6.6 | unchanged |
| Legacy `hubVersion` | `v6.0.0` | unchanged |
| OFP contract `format.version` | `1.0-draft.1` | unchanged |
| OFP `format.id` | `open-film-project` | unchanged |

`tests/version-consistency.js` asserts this in both directions: the derived
surfaces must follow `package.json`, and the schema markers must **not**. It
fails the build if any marker is renumbered to the application version, and it
checks the shipped sample project was not rewritten to advertise it either.

The OFP fixtures were not touched. Their `format.generator.version` records which
build wrote each fixture document; it is fixture data, not a derived surface, and
nothing in the codebase computes it from `package.json`.

## Automated verification

Run at the new version on Windows (Node 24 Active LTS):

| Gate | Result |
|---|---|
| `npm run check:version` | pass |
| `npm run check:quick` | pass — 27 declared steps, 68 suite invocations |
| `npm run check:ci` | pass — 40 declared steps, 90 suite invocations |
| `npm run check` | pass — **112 suites in 87.8s** |
| `npm run check:browser-gate` | pass — 10 suites each launched a real Chromium; 3 quarantined suites launched and failed exactly as recorded; 27 files under `data/` and `projects/` byte-identical afterwards |
| `npm run check:release` | pass |

No suite was skipped, and the quarantine was not widened. `tests/run-browser-gate.js`
is byte-identical to the previous commit, and its three quarantined suites are the
same three, still failing for their same recorded reasons — the gate promotes a
quarantined suite that starts passing and fails on one that changes its failure,
so "3 failing as recorded" is an assertion, not a tolerance.

## Scope of the evidence

- No live acceptance test was run for this release, because it changes no
  runtime behaviour to acceptance-test. The live evidence backing the OFP
  contract itself is in the P1 implementation commit and
  `docs/architecture/CINEBRAID_OFP_P1_DRAFT_CONTRACT_2026-08-10.md`.
- OFP remains inert: it is reachable from the test suites and
  `scripts/validate-ofp.js` only, and no project is stored in that format.
- Image and video generation, provider and model configuration, and
  authentication are untouched by this release.

## Compatibility

No project schema change. `meta.hubVersion`, `meta.schemaVersion` and a project's
own `meta.version` are unchanged, and `npm run check:version` asserts they do not
track the application version.

# CineBraid 6.7.0-alpha.1 — verification report

**Scope: the identity change, not the alpha.** This report verifies one thing —
the identity, documentation and versioning commit that moved the release identity
from `6.7.0-dev.1` to `6.7.0-alpha.1`. That commit changes no application
behaviour: it corrects what a public checkout of CineBraid says about itself and
extends the existing brand-asset carve-out to Braidy's character art. The evidence
below is about two things: that those corrections are real, and that nothing else
moved with them.

It is **not** a description of the complete `6.7.0-alpha.1` delta. The product work
between `6.7.0-dev.1` and this identity is substantial, and
`CINEBRAID_v6.7.0-alpha.1_RELEASE_NOTES.md` is what describes it. Every "no
application behaviour changed" statement below is scoped to the identity commit
this report verifies.

## Version identity

`package.json` "version" is the only hand-edited version. It moved from
`6.7.0-dev.1` to `6.7.0-alpha.1`; the core version is unchanged.

`release-identity.js` was not modified. Its documented behaviour for a channel
that is not in `CHANNEL_LABELS` — "it simply displays its raw version rather than
an invented label" — is what produces the display name, so no label was invented
and `CHANNEL_LABELS` still reads `{ private: "Private Test" }`.

| Surface | Owner | Before | After |
|---|---|---|---|
| `package.json` "version" | hand-edited, authoritative | `6.7.0-dev.1` | `6.7.0-alpha.1` |
| `public/index.html` title | `sync-version.js` | CineBraid 6.7.0-dev.1 | CineBraid 6.7.0-alpha.1 |
| `public/index.html` `?v=` stamps (73) | `sync-version.js` | `6.7.0-dev.1` | `6.7.0-alpha.1` |
| `package-lock.json` (2 sites) | `sync-version.js` | `6.7.0-dev.1` | `6.7.0-alpha.1` |
| Git tag | derived | `v6.7.0-dev.1` | `v6.7.0-alpha.1` |
| Archives | derived | `cinebraid-6.7.0-dev.1-*` | `cinebraid-6.7.0-alpha.1-*` |

`npm run check:version` confirms the derived surfaces are in step and that the
project schema markers did not follow the application version:

```
version consistency: OK
  authoritative: package.json 6.7.0-alpha.1
  display name:  CineBraid 6.7.0-alpha.1
  git tag:       v6.7.0-alpha.1
  derived:       public/index.html title + 73 cache stamps, package-lock.json
  schema markers unchanged: hubVersion v6.0.0, schemaVersion 6.6, sample meta.version 6.6.4-studio.2
```

The only change to `public/index.html` is the title and the cache stamps. Every
changed line in that file carries a version literal and nothing else.

## Package metadata

`package.json` gained `author`, `homepage`, `repository` and `bugs`, all pointing
at `https://github.com/cfbach/cinebraid` — the public repository, not the private
engineering origin. `license` remains the SPDX identifier `Apache-2.0`, the
package is not marked private, and `engines.node` still reads `>=18`.

The runtime dependency set is unchanged: `express`, and nothing else.
`tests/public-exposure.js` asserts that set exactly, because changing it would
change the NOTICE obligation.

## Documentation truth

Each correction below was a direct contradiction between a public-facing document
and the build it describes. Old development history was not rewritten to make
every document sound current; only these contradictions were corrected.

| Document | Was | Now |
|---|---|---|
| `README.md` | "in development", `6.7.0-dev.1` | Public Alpha, `6.7.0-alpha.1` |
| `README.md` | generation "is dispatched to fal.ai" | local ComfyUI, fal.ai and Civitai, each named with what it costs and what it needs |
| `README.md` | assistant described by protocol; Braidy unnamed | Braidy named, and setup described as where a capability runs before which protocol |
| `README.md` | "if an assistant is not configured, the manual path is still there" | the same guarantee, stated for Braidy by name |
| `SETUP.md` | two of the four optional-service surfaces | Assistant, Generation, Integrations and Accounts |
| `docs/GETTING_STARTED.md` | "Project Readiness" | "Production readiness", which is what the surface is called |
| `docs/GETTING_STARTED.md` | "FAL generation" as the only route | Braidy named, and all three generation routes |
| `docs/SPARK_QA_SETUP.md` | clones `cfbach/cinebraid-app` (private) | clones `cfbach/cinebraid` |
| `CHANGELOG.md` | newest entry was `6.7.0-dev.1` | a `6.7.0-alpha.1 — Public Alpha` entry above it |

`npm run check:public-exposure` enforces most of this mechanically and passes: the
README names every runtime dependency, states the local-only posture and the
development status, carries no version literal that is not this version, points
only at documents that exist, and makes no claim the product does not support.

## Brand assets

`TRADEMARKS.md` covered `public/cinebraid-mark.svg` and
`public/cinebraid-logo-xs.png`. It now also covers the six Braidy character
exports the Assistant rail draws:

```
public/assets/assistant-character/braidy-idle-soft-v32.png
public/assets/assistant-character/braidy-listening-v32.png
public/assets/assistant-character/braidy-processing-v32.png
public/assets/assistant-character/braidy-acknowledge-v32.png
public/assets/assistant-character/braidy-needs-decision-v32.png
public/assets/assistant-character/braidy-front-v32.png
```

These are exactly the six files `tests/release-package-smoke.js` already names as
shipped media, so the carve-out and the release allowlist describe the same set.

Three properties were preserved deliberately:

- **The code licence did not move.** Apache 2.0 governs the application in full,
  and `TRADEMARKS.md` now says so in the same paragraph that removes these files
  from it.
- **No other asset was withdrawn.** "Every other tracked asset in this repository
  is covered by the repository licence" still stands.
- **No trademark term went near the licence.** `tests/public-exposure.js` asserts
  that `LICENSE` carries no trademark language past the appendix, and it passes.

The fork guidance names all eight files to replace, and a single defined-term
sentence makes the existing prohibitions cover the character art without
restating them four times.

## What did not change in the identity commit

Scoped, as above, to the identity commit — not to the alpha as a whole.

In that commit: no product code. No route, no persistence path, no authority rule,
no provider or model configuration, no generation behaviour, no authentication. Its
tracked diff is documentation, package metadata, and the version stamps
`npm run sync:version` derives from `package.json`.

For what did change across the alpha, read the release notes.

## Known limitations

- No archive has been published under this identity. The first public sharing is
  source-first; `npm run release:build` will produce one from any commit.
- `npm run check:ci` fails on a working checkout whose `projects/` directory holds
  projects other than the sample. That is a property of the developer's local
  workspace, not of this commit: `tests/release-package-smoke.js` reads the
  filesystem, while a release and a fresh clone contain only
  `projects/cinebraid-sample`. Verify against `git archive HEAD` rather than a
  working runtime directory.

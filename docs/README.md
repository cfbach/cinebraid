# CineBraid documentation

Start with the current user and contributor guides below. Dated design records,
owner decisions, and earlier release documents are retained as engineering
provenance; they do not override current setup, release status, or product behavior.

## Use CineBraid

| I want to... | Read |
|---|---|
| Install the source-only Public Alpha | [Setup](../SETUP.md) or the [frozen Alpha installation guide](releases/v6.7.0-alpha.1/CINEBRAID_v6.7.0-alpha.1_PATCH_INSTALL.md) |
| Finish a first shot without provider keys | [Getting started](GETTING_STARTED.md) |
| Configure optional services or LAN access | [Setup and network posture](../SETUP.md#network-posture) |
| Run on DGX Spark | [Spark setup](../SPARK_SETUP.md) |
| Turn existing planning material into a project | [Project Builder prompt kit](../resources/project-builder/README.md) |
| Configure MiniMax H3 | [H3 guide](guides/MINIMAX_H3.md) |

## Contribute and verify

- [Contributing](../CONTRIBUTING.md): focused changes, DCO sign-off, and validation.
- [Browser tests](qa/BROWSER_TESTS.md): runtime setup, command behavior, quarantine,
  and isolation. **Windows validation is required; Browser validation is advisory
  pending `BROWSER_GATE_RUNNER_STABILITY_V1`.**
- [Isolated Spark QA setup](SPARK_QA_SETUP.md): separate configuration and projects
  for a test installation.
- [Publication contract](PUBLICATION.md): maintainer procedure and the scans required
  before accepted work is published. It is not an installation guide.
- [Security](../SECURITY.md): private vulnerability reporting.
- [Brand terms](../TRADEMARKS.md): rights for the name, ribbon logo, and Braidy artwork.

## Architecture and integration references

These references describe specific contracts and implementation areas. They are
not a promise that every researched model or provider is integrated.

- [Generation model packs](architecture/GENERATION_MODEL_PACKS.md)
- [Model intelligence](architecture/MODEL_INTELLIGENCE.md)
- [Blocking-frame evaluation design](architecture/BLOCKING_FRAME_EVALUATION.md):
  a designed evaluation method, not a completed benchmark.
- [Open Film Project resources and tests](../ofp/)
- [Public Project Builder resources](../resources/project-builder/)

The root `server.js` starts the implementation under `src/`. See the
[repository layout](architecture/REPOSITORY_LAYOUT.md) for current source domains
and runtime-data boundaries.

## Releases

[`v6.7.0-alpha.1`](https://github.com/cfbach/cinebraid/releases/tag/v6.7.0-alpha.1)
is a released, source-only Public Alpha. It has no binary/native installer or
uploaded packaged application. GitHub's generated source downloads are source
archives, not installers. Ongoing work on main is separate from the frozen tag.

- [Alpha release notes](releases/v6.7.0-alpha.1/CINEBRAID_v6.7.0-alpha.1_RELEASE_NOTES.md)
- [Alpha installation](releases/v6.7.0-alpha.1/CINEBRAID_v6.7.0-alpha.1_PATCH_INSTALL.md)
- [Changelog](../CHANGELOG.md)
- [Earlier release documents](releases/): historical instructions and limitations
  apply to their named versions.

## Historical engineering provenance

The following are retained to explain decisions and past observations. Read their
dates, scope, and status before applying them to current work. A historical plan,
acceptance note, or model-evidence record is not a current support guarantee.

- [Dated architecture and OFP records](architecture/), including the
  [2026-08-09 architecture decision](architecture/CINEBRAID_P0_ARCHITECTURE_DECISION_2026-08-09.md).
- [Dogfood decisions and deferred work](dogfood/), including the
  [2026-09-01 owner-decision freeze](dogfood/CINEBRAID_POST_DOGFOOD_DECISION_FREEZE_V1_2026-09-01.md).
- [v6.6.2.0 workflow ownership report](architecture/CANONICAL_WORKFLOW_OWNERS.md).
- [Earlier dogfood QA observations](qa/DOGFOOD_PASS_1.md).
- [Coverage durability correction](coverage-durability-correction-note.md).

Return to the [product README](../README.md).

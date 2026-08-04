# CineBraid v6.6.3.1 — New Chat Handoff

## Current version

**v6.6.3.1 — Manual-First Production Workflow**

## Product direction

CineBraid is a local-first production workspace and database of approved production truth. Manual organization and human approval are the core workflow. AI review, prompt assistance, FAL still generation, and bounded automation are optional layers.

## What changed

- Manual-first production is the default workspace emphasis.
- Reference pages lead with Upload reference files, Map imported references, and Choose primary authority.
- Human approval no longer requires AI review.
- Human approval provenance records whether a current AI check existed.
- Coverage views, expressions, and non-default states support Required, Planned, and Not required.
- Added an approved-only reference library.
- Imported-reference mapping supports direct Map & assign; optional AI checking remains separate.
- Existing-image intake precedes frame prompt tools.
- Existing-video intake precedes motion prompting.
- Prompt tools and still automation are collapsed by default in manual-first projects.
- A provider-free real Chromium persona approved imported references, mapped a Profile view, approved a still and video, and finalized the shot.

## What remains from v6.6.3.0

- reference-authority-v2 hard gates;
- embedded-content locks for props;
- all-angle spatial authority for locations;
- exact state-delta enforcement;
- imported reference authority packages;
- review-contract versioning;
- automation correction feedback;
- dismissible Activity alerts;
- Reports, recovery, backups, migrations, safe mode, and all motion compilers.

## Recommended next step

Dogfood v6.6.3.1 on a real production using two deliberately different workflows:

1. a fully manual scene using externally created references, stills, video, and audio;
2. an assisted scene using strict reference generation and review.

Measure whether both users can identify the same approved authority package and whether the manual user can remain entirely outside prompt, score, and automation surfaces.

Larger video automation should remain paused until that production test confirms the manual-first hierarchy is stable.

# Generic OFP import and migration contract

Current maintenance reference. No external production is a fixture or compatibility authority.

- Parsing, validation and canonical serialization remain generic CineBraid capabilities.
- Inspecting an existing document writes nothing. Migration produces a separate candidate, never a destructive project rewrite or an approval.
- Legacy version detection, duration/prose aliases, explicit relationships, ambiguous references, state ownership, media identity and unknown-field accounting retain their existing rules.
- A migration must account for source values and preserve unresolved meaning for review. It must not invent authority or silently substitute another entity/state.
- Existing synthetic fixtures in tests/fixtures/ofp-legacy and the OFP contract fixtures cover these rules and their negative controls.
- tests/ofp-synthetic-conformance.js adds a small invented source with multiple legacy version markers, deterministic migration, source immutability, relationship/accounting checks and no approvals. No project-derived golden hashes are required.
- The import benchmark uses a two-shot invented sample. It retains scoring for IDs, dialogue, frame plans, continuity states and duration without importing production material.

Run check:ofp-core, check:benchmark, and the affected route/state checks. Product milestones require a version decision before final qualification. Test fixtures must be wholly synthetic and must not acquire private production content through sanitization.

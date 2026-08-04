# CineBraid v6.6.3.4 — Verification Report

## Result

All **31 registered suites** passed against the source tree and the exact cleanly extracted release archive.

The combined source and clean-archive runners each reached the external execution wrapper while entering the final UI-state Chromium suite. In both cases, `check:ui-state`, `check:environment`, and `check:package` were rerun independently and passed.

No paid FAL request was submitted.

## Readiness regression

The committed 22-shot fixture contains one shared location without canon and two shots with the same unresolved prop ID.

- Before entity deduplication: **24 rows**.
- After entity deduplication: **3 rows**.
- Shared entity-canon rows: **1**, carrying all 22 `shotIds`.
- Shot-scoped unresolved-reference rows: **2**.

The same rule reduces Claude's broader reported scale case from 132 repeated rows to its 27 distinct problems.

## Sample readiness

Pinned expected state:

- `entity-canon` for `PROP-PARCEL`, affecting SAMPLE-01, SAMPLE-02, and SAMPLE-03.
- `shot-duration` for SAMPLE-03.
- Missing-file issues: **0**.

The sample remains fully completable with every provider disabled.

## Feedback safety

A regression submits a fake API key, an absolute local path, and a token-bearing route. The following must contain none of those raw values:

- POST response;
- stored `test-feedback.json`;
- Markdown export.

The note records route, project slug, workflow emphasis, app version, shots, entities, approved references, and open readiness issues. Nothing is transmitted automatically.

## Preserved behavior

- Manual-first and assisted parity
- Same-route UI-state preservation
- Strict reference authority and spatial continuity
- Durable automation and recovery
- Loopback-only default networking with deliberate LAN opt-in
- Sanitized release packaging
- Existing project schema and saved histories

# CineBraid v6.6.2.1 — New Chat Handoff

## Current version

v6.6.2.1 — Error Semantics & Interface Polish

## Base release

v6.6.2.0 — Clarity & Consolidation

## What changed

### Error semantics

- Unknown prompt-compile shot IDs now return 404 rather than 500.
- Unknown profiles and unknown purposes return 400.
- Genuine internal errors remain 500.
- Purpose validation is derived from the compiler’s implemented branches.
- Composer/staging assist uses the same missing-shot semantics.

### UI polish

- Shared styled not-found screens for shots, scenes, and all entity types.
- Closest-ID suggestions and links back to the relevant list.
- Accessible labels and expanded-state semantics for glyph controls.
- Consistent sentence-case shot actions.
- One primary action per shot state.
- Rename, Duplicate shot, and Import existing moved into Shot actions without removing them.
- Continuity-state generation guidance rebuilt as semantic rows, fixing the overlapping text reported in the screenshot.

### Reports and readiness

- Production-summary export in Markdown and JSON using existing diagnostic redaction.
- Totals and per-shot iteration/cost-proxy history are retained for later analysis.
- Read-only Project readiness roll-up on Production reuses prompt compiler context rather than creating a second warning system.

## Enforced control budgets

- Default-visible shot: actual 9, ceiling 10
- Total reachable shot: actual 23, ceiling 24
- Global activity: actual/ceiling 4
- Automation console: actual/ceiling 1

No capability was removed.

## Constraints preserved

- Vanilla JavaScript and Express only.
- No new npm packages.
- No schema migration.
- v6.0.7.1 recovery guard untouched.
- Nine video motion compilers untouched.
- Existing projects and durable automation data remain compatible.

## Verification

Focused syntax, behavior, API, diagnostics, clarity, and real-Chromium suites passed. The wider combined suite passed through bounded rendering before an external wrapper timeout; remaining suites passed separately. No paid FAL generation request was made.

## Likely next work

Dogfood the production-summary export and Project readiness panel on a real active project. Keep further changes subtractive and preserve the ratcheted 10 / 24 / 4 / 1 control ceilings.

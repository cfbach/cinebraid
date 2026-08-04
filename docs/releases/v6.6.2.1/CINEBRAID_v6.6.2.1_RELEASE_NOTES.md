# CineBraid v6.6.2.1 — Error Semantics & Interface Polish

## Summary

This is a focused polish release on top of v6.6.2.0. It closes the Session 12 exploratory-audit findings without increasing the shot-workspace control budget, changing project schema, adding providers, or removing capabilities.

## Error semantics

- Prompt compilation now returns **404** when the requested shot does not exist.
- Unknown prompt profiles remain **400** responses.
- Unknown prompt purposes now return **400** and list the compiler-supported values.
- Genuine internal failures remain **500** responses.
- The same missing-shot treatment is applied to the staging/composer-assist compile path.
- Prompt purposes are derived from the compiler’s own supported branches so validation and compilation cannot silently drift apart.

## Interface polish

- Replaced bare `Shot not found`, `Scene not found`, and generic entity errors with a shared styled recovery screen.
- Not-found screens name the missing record and ID, link back to the correct list, and suggest the closest known ID when useful.
- Added accessible names and `aria-expanded` state to glyph-only navigator and collapse controls.
- Standardized shot-workspace action labels to sentence case.
- Moved rare administrative actions—Rename, Duplicate shot, and Import existing—into the existing **Shot actions** disclosure.
- Established exactly one visually primary action for the current shot state.
- Fixed the continuity-state generation guidance shown in the reported screenshot. **Manual generate** and **Automate state** now render as explicit label/description rows rather than overlapping inline fragments.
- The state-generation panel remains readable on desktop and 390 px mobile with zero horizontal overflow.

## Production intelligence

- Added **Export production summary** to Reports.
- Exports are available as Markdown and JSON.
- The export contains run totals, generated images, accepted provider requests, assistant/review calls, per-shot rounds and candidates, approvals, human overrides, failures, recurring review complaints, inefficient-run notes, date range, and app version.
- Existing diagnostic redaction is applied before export, preventing secret or absolute-path leakage.
- Added a read-only **Project readiness** roll-up to Production by reusing the compiler’s normalized shot/reference context.
- Readiness identifies missing shot descriptions or beats, missing duration, entities without canon, entities without approved references, and approved files missing from disk. Each item links to the relevant record.

## Control-budget ratchet

| Surface | Measured actual | Ceiling |
|---|---:|---:|
| Default-visible shot controls | 9 | 10 |
| Total reachable shot controls | 23 | 24 |
| Global activity controls | 4 | 4 |
| Automation-console controls | 1 | 1 |

For comparison, the shot surface measured 23 default-visible and 101 total reachable controls before the clarity consolidation.

## Compatibility

- No project-schema migration.
- Existing projects, automation runs, generation jobs, prompt history, and recovery data load unchanged.
- No provider, motion compiler, workflow, or user capability was removed.
- The v6.0.7.1 composer-recovery guard and all nine video-motion compilers remain unchanged.
- No new npm dependencies were added.

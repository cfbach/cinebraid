# CineBraid v6.6.2.1 — Verification Report

## Result

**PASS**

CineBraid v6.6.2.1 satisfies the Session 12 error-semantics, accessibility, control-ranking, export, readiness, and typography acceptance criteria.

## Verified behavior

### API semantics

- Unknown shot during prompt compilation: **404**
- Unknown shot during composer/staging assist: **404**
- Unknown profile: **400**
- Unknown purpose: **400**, with accepted purposes named
- Every purpose implemented by the compiler is accepted
- Deliberately induced internal project-read failure: **500**

Supported prompt purposes remain compiler-owned:

- `first-frame`
- `last-frame`
- `shot-still`
- `edit`
- `reference-sheet`
- `continuity-fix`
- `blocking`
- `motion`

### Interface

- Shot, scene, character, location, prop, vehicle, and audio missing-record routes render a styled recovery state with a navigation control.
- Navigator and scene-collapse glyph buttons have accessible names and expanded-state semantics.
- Rendered-route accessibility sweep found no empty or glyph-only unnamed controls.
- Shot route renders exactly one primary action.
- Rename, Duplicate shot, and Import existing remain available under Shot actions.
- Visible shot actions use a consistent sentence-case convention.
- State-generation guidance uses semantic label/description rows.
- Desktop and 390 px mobile state-generation checks found **0 px horizontal overflow**.

### Reports and Production

- Markdown production-summary export passed.
- JSON production-summary export passed.
- Export redaction removed secrets and absolute paths.
- Per-shot statistics, project totals, recurring complaints, inefficient-run notes, date range, and app version are present.
- Project readiness endpoint and Production rendering passed using shared compiler context.

### Control budgets

| Surface | Actual | Enforced ceiling |
|---|---:|---:|
| Default-visible shot controls | 9 | 10 |
| Total reachable shot controls | 23 | 24 |
| Global activity controls | 4 | 4 |
| Automation console | 1 | 1 |

No capability was removed to reach these figures.

## Test execution

The focused final verification ran successfully:

- `npm run check:syntax`
- `npm run check:behavior`
- `npm run check:api`
- `npm run check:diagnostics`
- `npm run check:clarity`
- `npm run check:browser-real`

The broader combined `npm run check` had previously passed all suites through bounded rendering before the external execution wrapper reached its time limit. The remaining clarity and real-Chromium suites were then run separately and passed. This was a wrapper timeout, not a test failure.

## Safety

- Paid FAL generation requests submitted by verification: **0**
- New runtime dependencies: **0**
- Schema migrations: **0**
- Capabilities removed: **0**

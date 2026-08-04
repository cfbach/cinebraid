# CineBraid v6.6.3.1 — Verification report

## Scope

Verification covered the new manual-first workflow plus all retained reference-authority, generation, recovery, rendering, and browser behavior.

## Manual-only Chromium persona

All assistant capabilities and FAL were disabled. The persona successfully:

1. opened an imported reference asset;
2. used the manual reference hub;
3. directly assigned an imported Front authority;
4. mapped and assigned an imported Profile authority;
5. confirmed Required, Planned, and Not required states;
6. opened the approved-only reference library;
7. approved an existing shot still;
8. approved an existing finished video;
9. finalized the video as shot delivery;
10. completed without AI review, prompt building, generation, or automation.

Responsive checks reported zero horizontal overflow.

## Automated suites

The following suites were run against the source tree:

- syntax;
- route rendering and guarded recovery;
- current behavior and repository hygiene;
- browser workflow;
- import benchmark;
- Project Builder kit;
- composer and motion compatibility;
- canonical build history;
- mocked FAL generation and idempotency;
- API smoke;
- automation diagnostics;
- live Activity;
- coverage workflow;
- safety and data integrity;
- focused workspaces;
- reference workspace UX;
- reference workflow repair and bounded batch review;
- continuity-state chain recovery;
- reference-authority deep dive;
- data recovery;
- bounded rendering;
- clarity consolidation;
- integrity and mobile usability;
- manual-first workflow;
- manual-only real Chromium;
- full real Chromium workflow.

## Control budgets

The existing shot-route budgets remain constrained:

- default-visible shot controls: **9 actual / 10 ceiling**;
- total reachable shot controls: **23 actual / 24 ceiling**;
- global Activity controls: **4 / 4**;
- automation console controls: **1 / 1**.

## Safety

- FAL was disabled during the manual-only persona.
- Provider submissions remained mocked or disabled in automated generation tests.
- No paid FAL request was submitted.
- Existing v6.6.3.0 hard authority gates continue to pass regression coverage.
- No capability or historical record was removed.

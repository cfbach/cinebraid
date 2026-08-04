# CineBraid v6.6.3.0 — New Chat Handoff

## Current version

**v6.6.3.0 — Reference Authority & Spatial Continuity**

## Why this release was needed

Real production dogfooding showed that reference candidates could look reviewed or approved while failing the intended authority contract:

- a prop continuity state replaced the photograph carried by the prop;
- new location angles did not preserve the original room geometry;
- passing character angle reviews did not necessarily fill Coverage slots;
- imported references lacked a clear path into state/coverage authority;
- old failed automation runs remained permanent Activity alerts.

## Core fixes

- Reference review now uses hard authority gates rather than trusting score/model pass alone.
- Major/blocking differences always fail.
- Props lock embedded photographs, murals, artwork, print, text, labels, maps, and screens.
- Locations are reviewed and generated from the primary plus every approved angle as one physical space.
- AI pass and human slot assignment are explicit separate steps.
- Passing unassigned coverage candidates are surfaced in Coverage.
- Existing images can be mapped to states, coverage views, or expressions.
- Approved imported images become authorities for generating the remaining missing references.
- State automation stores reviews on candidates and uses exact hard-gate failures for retry prompts.
- Obsolete failed alerts can be dismissed individually or in bulk while remaining in Reports.

## Recommended dogfooding focus

Use real imported and generated references for:

1. a photograph or artwork prop with two or more physical states;
2. a location with a master, reverse, and one newly generated side angle;
3. a character with externally created Front/Profile/Rear images;
4. a state-chain where one deliberately bad candidate changes identity/content;
5. batch review followed by explicit batch assignment;
6. dismissing old failure alerts after the issue has been resolved.

Confirm that generated outputs themselves improve under the stricter authority packages; the tests verify packaging, prompting, review semantics, and assignment, but visual-model quality still requires real provider dogfooding.

## Preserved behavior

- Four References workspaces and five shot stages remain.
- Project schema remains compatible.
- Deterministic prompt fallback, backups, migrations, safe mode, Reports, readiness checks, and Project Bible remain.
- FAL remains the optional still-image provider.
- Video generation remains manual and all nine motion compilers are unchanged.
- v6.0.7.1 composer recovery guards remain untouched.

## Likely next milestone

Dogfood this authority release before building the larger video-candidate review milestone. The next product work should be based on whether real generated location angles and prop states now pass human visual inspection, not only automated contract checks.

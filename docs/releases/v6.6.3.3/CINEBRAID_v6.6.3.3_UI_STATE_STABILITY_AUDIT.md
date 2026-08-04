# CineBraid v6.6.3.3 — UI state-stability audit

## Reported failure

On a Reference page, clicking **Build Prompt**, **Improve**, or **Generate** refreshed the route and collapsed the outer Optional assisted tools disclosure. The inner builder could remain technically open while becoming hidden by its collapsed parent, forcing the user to reopen the workflow after every action.

## Root causes

1. The outer reference assisted-tools disclosure had no persisted state in manual-first mode.
2. CineBraid replaced the complete route markup after many actions but restored only selected task state, not the browser's complete working context.
3. Replacing `<details>` elements fired toggle handlers that could persist false closed states.
4. An older asynchronous route render could finish after a newer navigation and overwrite the newer screen.

## Repair

The router now captures and restores same-route UI context:

- open/closed disclosures using stable keys;
- the active control and text selection;
- main and window scroll position;
- a visible disclosure anchor and its offset;
- the current project and route identity.

Route replacement is marked as an internal render so toggle persistence ignores synthetic close events. Route requests receive monotonically increasing tokens so stale async output is discarded.

## Real-browser acceptance

Chromium exercises:

- Reference Build Prompt through busy and completed states;
- Reference Improve;
- Reference Generate and queued provider submission with mocked endpoints;
- Continuity-state Build and Improve;
- same-route refreshes in prop, character coverage, shot Look, Frames, Motion, Deliver, Reports, and Settings;
- navigation away from a deliberately delayed shot route;
- viewport-anchor movement limited to 20 pixels;
- zero horizontal overflow.

No paid generation request is made by the audit.

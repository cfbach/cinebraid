# CineBraid v6.6.3.3 — UI State Stability

This release fixes disruptive interface movement during actions that refresh the current route.

## Fixed

- Building, improving, or generating a reference no longer closes **Optional assisted tools** or the nested reference builder.
- Building or improving a continuity-state prompt no longer closes the Continuity States editor or changes the selected state.
- Same-route updates preserve compatible disclosure state, keyboard focus, text selection, horizontal/vertical scroll, and a stable viewport anchor.
- Slow asynchronous route results are discarded when the user has already navigated elsewhere.
- Browser replacement of route markup no longer writes false collapsed states into persisted workspace preferences.
- The reference assisted-tools disclosure now has explicit per-entity persistence.

## Audited surfaces

- Reference creation and generation
- Continuity-state generation
- Coverage and view editors
- Shot blocking
- Shot frames
- Motion & sound
- Deliver
- Reports
- Settings

The stabilization layer only applies to same-route refreshes. Explicit navigation to another workspace remains intentional navigation.

No project schema, provider, prompt compiler, automation behavior, approval contract, or export was changed.

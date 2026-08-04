# CineBraid v6.6.2.2 — New Chat Handoff

## Current version

**v6.6.2.2 — Integrity & Mobile Usability**

## What this release fixed

- Explicit shot relationship IDs are no longer silently discarded when their target entity is missing.
- Shot Inputs shows unresolved characters, locations, props, vehicles, voices, speakers, continuity-state selections, and recognized relationship IDs as blocking repair rows.
- Relink and Remove update every field that still contains the stale ID.
- Project readiness reports unresolved relationships and opens the affected shot directly in Inputs.
- Activity is hidden while idle and docks into normal layout while active or needing attention, preventing mobile overlap.
- Approved Authority typography separates the label, count, and explanation on desktop and mobile.
- Settings fields and previous/next shot links have meaningful accessible names.
- Frequent mobile controls have larger touch targets without increasing control counts.
- Reference Library category selection persists.
- Release documents are organized under `docs/releases/`, and the final ZIP can verify itself after clean extraction.

## Preserved behavior

- Four References workspaces and five shot stages remain unchanged.
- Shot control budgets remain 9 visible / 23 reachable, with ceilings of 10 / 24.
- Global Activity and automation-console budgets remain 4 / 1.
- No provider, capability, workflow stage, schema field, migration, recovery path, Project Bible feature, or motion compiler was removed.
- v6.0.7.1 composer recovery guards remain untouched.

## Recommended dogfooding focus

Use a real active project and watch for:

1. stale references produced by imported or manually edited projects;
2. deletion and relinking across shot audio, clips, motion, and continuity selections;
3. Activity behavior during long local-model and FAL waits on a phone or tablet;
4. whether Project readiness gives enough context to repair each relationship quickly;
5. whether the persistent Library category helps or creates confusion when moving between asset types.

## Likely next milestone

After a real-production dogfood pass, the larger product milestone remains **video-candidate review and motion/audio continuity**. Avoid expanding that surface until v6.6.2.2 has proven that shot/reference integrity and long-running Activity remain dependable under production data.

## Verification summary

- Complete source `npm run check`: passed.
- Real Chromium desktop/tablet/mobile workflow: passed.
- Activity overlap across Production, Shot, Reference, Reports, and Settings: zero in tested viewports.
- Horizontal overflow in tested viewports: zero.
- Chromium unnamed Settings textbox/combobox count: zero.
- Paid FAL requests during tests: zero.

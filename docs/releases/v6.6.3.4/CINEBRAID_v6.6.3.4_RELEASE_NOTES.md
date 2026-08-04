# CineBraid v6.6.3.4 — Test Feedback & Readiness

## Summary

This is the final small pre-test release. It reduces readiness noise, makes the sample's first warnings deliberate and teachable, and gives manual-first testers a local feedback notepad available from every route.

## Project Readiness

Entity-scoped issues are now collected once per entity rather than repeated for every shot that references the entity. The existing `shotId` remains the first affected shot for compatibility, and a new `shotIds` array carries every affected shot.

The committed 22-shot regression falls from 24 rows before deduplication to 3 rows after it: one shared entity-canon issue and two genuinely shot-scoped unresolved-reference issues. Claude's broader 132-row reproduction reduces to its 27 distinct problems under the same rule.

## Sample posture

**CineBraid Sample — The Blue Parcel** is intentionally instructive. It opens with exactly two readiness items:

1. Blue parcel has no canon text — one entity issue affecting all three shots.
2. SAMPLE-03 has no explicit duration — one shot issue.

All approved sample files exist. Getting Started explains the intent and walks through clearing the prop-canon item.

## Manual feedback

The left rail now includes **Leave test note**. A note records:

- free-text feedback;
- current route;
- project slug;
- workflow emphasis;
- CineBraid version;
- counts for scenes, shots, entities, approved references, and open readiness issues.

Notes are redacted through the existing diagnostic path before local storage. They are never transmitted automatically and can be copied or downloaded as Markdown; the API also supports JSON export.

## Compatibility

No schema migration, provider, prompt compiler, automation behavior, approval contract, or production capability changed.

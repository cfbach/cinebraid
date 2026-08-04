# CineBraid v6.6.3.3 — New Chat Handoff

## Current release

v6.6.3.3 — UI State Stability

## Product direction

CineBraid remains a manual-first, local production workspace. Human-approved references and imported media are first-class; assisted generation is optional.

## This release

The complete route used to rerender after many actions and could collapse the user's current disclosure stack. v6.6.3.3 adds same-route UI-context capture and restoration for disclosures, focus, text selection, scroll position, and viewport anchors.

Reference Build/Improve/Generate and continuity-state Build/Improve now remain in place. Major shot and administration workspaces were swept with real Chromium. Slow old route renders can no longer overwrite newer navigation.

## Important retained behavior

- v6.0.7.1 composer recovery guard remains unchanged.
- Nine video motion compilers remain unchanged.
- Manual-first and assisted emphasis remain presentation-only.
- Reference Authority v2 hard gates remain intact.
- Loopback remains the default server posture; use `npm run start:lan` for Spark-to-desktop access.
- The external-test archive contains only the sanitized Blue Parcel sample.

## Suggested next step

Dogfood v6.6.3.3 through a full manual and assisted production session, specifically watching modal close behavior, file uploads, candidate review/assignment, pagination, and cross-route navigation. Treat any unrequested panel collapse, jump, lost focus, or stale render as a release-blocking UI-state defect.

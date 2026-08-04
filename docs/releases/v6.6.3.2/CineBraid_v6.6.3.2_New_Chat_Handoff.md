# CineBraid v6.6.3.2 — New Chat Handoff

## Current release

**v6.6.3.2 — Manual Parity & External Test Readiness**

## Product position

CineBraid is a local-first production workspace where approved references, continuity, shot media and final deliveries live. Manual production is the default. Assisted generation and automation are optional overlays.

## Main changes

- Shot workspaces now respect `meta.workflowEmphasis` in next actions, ordering, disclosure defaults and vocabulary.
- Manual projects do not default-display Build prompt or Improve, including after older prompt history exists.
- The ready-to-run archive contains only the sanitized Blue Parcel sample.
- Node.js 18+ is required and checked before startup.
- Server access is loopback-only by default; LAN access is deliberate.
- Current manual-first Getting Started, first-run state and portable check command are included.

## Important constraints retained

- No breaking schema migration.
- Do not modify the v6.0.7.1 composer recovery guard.
- Do not modify the nine motion compilers.
- Strict v6.6.3.0 reference authority remains intact.
- No provider or automation capability was removed.

## Recommended next step

Run a small external test with users who create media elsewhere. Observe onboarding, reference import/mapping, shot media intake, finalization and recovery. Avoid adding new assisted-generation capabilities until that test is complete.

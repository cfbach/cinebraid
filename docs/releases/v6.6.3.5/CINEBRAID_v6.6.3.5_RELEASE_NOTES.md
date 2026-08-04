# CineBraid v6.6.3.5 — Blocking Automation Discoverability

## Summary

Shot blocking now has an explicit, self-contained assisted workflow in **Look & blocking**.

## Changes

- Added **Automate Blocking** inside Optional assisted blocking.
- Added a durable blocking-only run: prompt build/improvement → FAL generation → vision review → bounded revision/retry → active-guide selection.
- Added configurable 1–3 rounds and 1–4 candidates per round with a confirmed maximum-image cap.
- Reuses an existing active guide when requested.
- Keeps blocking-only automation separate from finished still automation.
- Clarified that **Build Prompt** reveals the manual paid **Generate** action.
- Preserved manual-first behavior: the assisted blocking section remains collapsed by default.
- Fixed joined text in the blocking revision heading.
- Added regression coverage for visibility, planner scope, manual-first collapse, and runner dispatch.

No schema, provider, prompt compiler, review contract, motion compiler, or project data format changed.

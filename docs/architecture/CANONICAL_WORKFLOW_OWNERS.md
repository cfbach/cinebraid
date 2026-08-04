# CineBraid v6.6.2.0 — Code Ownership and Legacy Compatibility Report

## Purpose

The v6.6.1.3 audit found that CineBraid's browser code behaves partly like an inheritance stack: a base workflow loads, versioned composer code wraps or replaces it, and later feature modules replace selected pieces again. v6.6.2.0 removes definitions that were proven dead, establishes clearer ownership where it was safe to do so, and adds read-only compatibility telemetry before any destructive schema cleanup.

## Removed safely

The following definitions had no remaining runtime ownership role and were removed with regression coverage:

- `winnersProgress` from `public/app.js`;
- `planHolderForActiveUnit` from `public/v607-composer.js`;
- the obsolete `window.setWinner` implementation from `public/mutations.js`.

Winner assignment now remains owned by the current approval path in `public/library-tools.js`.

## Investigated but retained

The earlier `guidedFramePromptRefs` assignment in `public/v607-composer.js` looked redundant in a simple reference-count scan. Direct inspection showed that it is captured as the raw/base implementation and used by the later budget-aware wrapper. Removing it would change prompt-package behavior, so it remains.

The following duplicate global names are active adapters, guards, or fallback layers rather than confirmed dead definitions:

- `buildGuidedFramePrompt`
- `buildGuidedMotionPrompt`
- `guidedFramePromptRefs`
- `guidedMotionPanel`
- `guidedMotionPromptResult`
- `setComposerConstraint`
- `setGuidedMotionField`
- `setMotionPlanField`
- `setMotionSubject`
- `setMotionProp`
- `setSimpleMotionAudio`
- `structuredMotionSummary`
- `openFalGenerationModal`
- safe-mode/reload helpers

These should be consolidated only as a dedicated architecture change with fixture migration and prompt-package regression coverage. They were not deleted merely because more than one assignment exists.

## Current ownership boundaries

- `public/creation-studio.js`: guided shot stage structure and base frame/motion workflow.
- `public/motion-sound-composer.js`: current structured motion-and-sound presentation helpers.
- `public/library-tools.js`: approval and winning-take mutation path.
- `public/entities.js`: reference, review, coverage, expression, and continuity-state workspace orchestration.
- `public/v607-composer.js`: guarded compatibility/budget adapter and safe-mode recovery layer.
- `public/reports.js`: activity/report presentation plus read-only legacy-field usage telemetry.

## Legacy compatibility retained deliberately

v6.6.2.0 does not remove:

- legacy shot `status` conversion to current workflow status;
- legacy VO/audio normalization;
- older motion/clip data adapters;
- single-winner still compatibility;
- legacy continuity-state delta aliases;
- legacy FAL configuration migration;
- numeric focused-task migration;
- one-time project migration;
- deterministic prompt fallback;
- composer safe mode;
- rotating backups and restore;
- Project Bible and its separate read-only entry point.

Reports now exposes a read-only **Legacy compatibility usage** summary. This makes future deletion evidence-based: migrate representative projects, resave them, verify that the usage counts reach zero, then remove adapters with dedicated tests.

## Recommended later architecture work

A later release can replace the remaining wrapper stack with explicit subsystem APIs for inputs, blocking, frame workflow, motion/sound, approval, automation, and activity. That work is intentionally outside this subtractive UI release because it changes internal execution ownership even when the visible behavior is meant to remain identical.

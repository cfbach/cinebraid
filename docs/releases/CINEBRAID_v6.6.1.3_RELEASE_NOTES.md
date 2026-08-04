# CineBraid v6.6.1.3 — Continuity State Chain Recovery

## Summary
This hotfix repairs the state-chain failure reported while generating the mural continuity states. The run reached prompt compilation but stopped before any FAL image request because the browser selected a parent-derived reference-edit profile while the real server endpoint still accepted only text-to-image profiles.

## Root cause
- v6.6.1.2 correctly selected `gpt-image-2/edit` for a continuity state with an approved parent.
- `/api/prompt/asset-compile` rejected that edit profile with the internal error “Choose a text-to-image profile.”
- The state automation did not preserve that underlying error and reported only “prompt was not built.”
- Imported state records could also keep their visible delta in fields such as `description` while automation looked only at `notes`.
- Preflight incorrectly allowed `appliesTo` to stand in for a visual state delta even though it only identifies where the state is used.

## Fixed
- Parent-derived continuity states now compile through the real reference-edit API contract.
- The approved parent-state image is bound as the editable `#image1` base reference.
- The continuity-state delta is the primary edit action. Optional revision feedback is appended as secondary direction.
- Legacy/imported delta fields—including `description`, `stateDelta`, `delta`, `changeOnly`, `changes`, `visualDescription`, `instructions`, and `prompt`—are recovered into the canonical state delta.
- `Applies to scenes / shots` no longer satisfies preflight without an actual visible-change description.
- Manual state prompt builds return the compiled build to automation callers.
- Prompt failures retain the real server/advisor error in the operation and run report.
- If deterministic compilation succeeds but the local prompt advisor times out or fails, CineBraid continues with the valid deterministic prompt instead of discarding it.
- Existing failed state-chain runs can use **Retry Failed Step** after installing the patch.

## Recovery for the mural run
1. Install v6.6.1.3 and reopen the same project.
2. Open the mural’s **Continuity States** and confirm each non-default state has a concrete visual delta. `Applies to` alone is not enough.
3. Open the failed automation run and choose **Retry Failed Step**.
4. CineBraid will rebuild only the failed prompt step. A temporary local-advisor failure will now fall back to the deterministic compiled edit prompt.

## Verification
- Added a mural-specific regression using `PROP-MURAL`, an approved original state, a derived “Drifted further” state, and a deliberately missing-delta state.
- Added a real API smoke test proving `gpt-image-2/edit` binds the parent reference and includes the continuity delta in the compiled prompt.
- Verified migration, strict preflight, exact error preservation, retry-safe deterministic fallback, FAL idempotency, coverage workflows, reference UX, bounded rendering, and real Chromium desktop/tablet/mobile behavior.
- No paid FAL generation requests were submitted by the tests.

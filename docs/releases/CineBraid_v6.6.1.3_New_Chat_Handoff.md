# CineBraid v6.6.1.3 — New Chat Handoff

## Current version
v6.6.1.3 — Continuity State Chain Recovery

## Trigger for this patch
A real prop state-chain run for `PROP-MURAL` failed while building the first “Drifted further” prompt. It stopped before FAL generation with the generic report “prompt was not built.”

## Root cause
v6.6.1.2 selected GPT Image 2 Reference Edit for parent-derived states, but the real `/api/prompt/asset-compile` endpoint still allowed only text-to-image profiles. The previous browser regression mocked that endpoint, so the server/client mismatch was not exercised.

## What changed
- The real asset compiler accepts reference-edit profiles for non-default states derived from an approved parent.
- The approved parent becomes the editable `#image1` base reference.
- The continuity delta is the primary edit action.
- Imported delta aliases migrate into canonical state notes.
- `Applies to` no longer counts as a visual delta.
- Manual state compilation returns its build to the automation runner.
- Exact prompt errors persist in Activity/Reports.
- A local prompt-advisor failure falls back to the already-saved deterministic prompt.
- Added mural-specific state-chain and real API regression tests.

## Existing behavior retained
- v6.6.1.2 workflow filters and bounded batch review remain.
- Primary identity approval does not silently assign coverage angles.
- State/reference review gating and explicit human approval remain.
- No project-schema rewrite is required.

## Recovery path
Install v6.6.1.3, ensure each non-default mural state has a concrete visible-change delta, then use **Retry Failed Step** on the existing failed run.

## Suggested next work
Dogfood the complete mural chain—Drifted further, Partial, and Restored—through prompt, generation, review, revision, and approval. Then resume the larger video-candidate review and motion/audio continuity milestone.

# CineBraid v6.6.1.2 — New Chat Handoff

## Current version
v6.6.1.2 — Reference Workflow Repair & Batch Review

## What changed
- Fixed the continuity-state `x is not defined` prompt-builder crash.
- Parent-derived states select GPT Image 2 Reference Edit when the approved parent media is available.
- Continuity-state workspace focus, open disclosures, and scroll-oriented task context survive prompt actions.
- Imported angle aliases merge into standard coverage slots rather than creating duplicate requirements.
- Candidate inbox workflows are filtered and visibly typed.
- Approval is gated on the correct state/coverage/sheet review contract.
- Batch AI review supports visible/unreviewed/re-review scopes, concurrency two, partial-result survival, per-target ranking, Activity persistence, and explicit batch approval confirmation.

## Important behavior
- Primary identity approval still does not silently fill an angle slot.
- Reference sheets are reviewed in the batch but are not directly approved as angle coverage; they still proceed through Extract Views.
- Batch approval keeps existing filenames and assigns each selected image only to its listed state or coverage target.
- Paid FAL generation paths were not exercised by the regression suite.

## Suggested next work
Dogfood this release on The Last Thread with mixed primary, state, angle-crop, and sheet candidates. Once the reference workflow remains stable, continue into video-candidate review and motion/audio continuity.

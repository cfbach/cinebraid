# CineBraid v6.6.1.2 — Reference Workflow Repair & Batch Review

## Summary
This patch stabilizes character/reference continuity states and makes candidate review safer and easier to understand. It is a workflow repair release; it does not broaden paid generation automation.

## Fixed
- Continuity-state prompt building no longer crashes with `x is not defined`.
- A state derived from an approved parent now defaults to `gpt-image-2/edit` instead of text-to-image.
- The Continuity States panel and the exact state-generation disclosure preserve their open state during prompt actions and route refreshes.
- Imported descriptions such as “Front, full figure, neutral stance” merge into Front, while “Back, full figure at small scale” merges into Rear. The original detail is retained as a note.
- State automation title and explanation render as separate lines.
- Unreviewed coverage candidates no longer expose a misleading direct approval action. Review-required actions open review and continue into approval or extraction after a pass.

## Candidate inbox
The inbox now includes workflow filters for:
- Primary / State
- Coverage Views
- Sheets
- Expressions

Each card names its review contract. The top of the inbox includes:
- Review All Visible
- Review Unreviewed
- Re-review All

Batch review is presented as one run but uses independent calls with concurrency limited to two. Results persist as they return, one failure does not cancel the rest, and the final summary ranks the best passing candidate for each target. Approval remains an explicit human-confirmed step.

## Verification
A dedicated regression suite covers the original critical, high, and medium audit findings, including a simulated malformed vision result in the middle of a five-candidate batch. No paid FAL requests are submitted by the suite.

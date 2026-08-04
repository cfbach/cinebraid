# CineBraid v6.6.4-studio.repair.13 — Correction Dialog Clarity

## Focus
This update repairs the frame-sequence continuity correction dialog after the repair.12 workflow was functionally correct but visually oversized, horizontally clipped, and unclear about which steps belonged to the user versus CineBraid.

## Changes

- The outer modal now owns the responsive width and height instead of allowing the inner correction workspace to exceed the generic dialog shell.
- The dialog uses a fixed header, compact workflow summary, scrollable middle region, and fixed action footer.
- Long review findings wrap within the viewport instead of creating horizontal scrolling.
- Desktop, tablet, and mobile-specific containment rules were added.
- The workflow is now divided into explicit roles:
  - **You choose:** structural anchor and frame to repair.
  - **You edit:** intended change and optional surgical direction.
  - **CineBraid automates:** continuity locks, review-evidence conversion, and editable correction-prompt creation.
- Anchor and repair previews are visibly labelled and update live when the selects change.
- The primary action now says **Build editable correction prompt** and explains that no paid request is submitted yet.
- Upload, existing-candidate, and intentional-difference paths were moved into a clearly labelled alternatives section.

## Behaviour preserved

- The original approved target remains preserved until a replacement is approved.
- The correction package remains an immutable revision linked to the source prompt build.
- FAL generation is still a later explicit action.
- Accepting a difference as intentional still updates written progression and reruns review rather than bypassing validation.

# CineBraid v6.6.4-studio.4 — Workflow Simplification Side Branch

This side-branch update continues the studio UI redesign while simplifying three production workflows: shot management, reference intake and cropping, and project lifecycle management.

## Changes

- Added a compact shot command summary for references, required frames, motion, and current stage.
- Added direct shot deletion to the existing Shot actions menu while retaining rename, duplicate, and import.
- Reworked imported-reference mapping into two explicit paths: assign a single image or crop a multi-view sheet.
- Added a clearer three-step reference extraction workspace with previous/next panel navigation.
- Replaced native coverage confirmation dialogs with CineBraid’s accessible modal system.
- Added project archiving and in-app restoration, separate from recoverable deletion to `projects/.trash`.
- Preserved bounded shot-board sizes at 260, 340, and 460 pixels.

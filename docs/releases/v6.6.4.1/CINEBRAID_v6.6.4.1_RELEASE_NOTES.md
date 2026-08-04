# CineBraid v6.6.4.1 — Reference Sheet & Workspace Fit

## Summary

This patch improves three real production workflows without changing project schemas or provider configuration.

## Reference sheets

- The imported-reference mapper now fits inside the browser viewport instead of overflowing to the right.
- Any uploaded image can be opened as a reference sheet; CineBraid no longer requires it to have been generated or pre-recognized as a sheet.
- A visible **Crop reference sheet** action is available in the manual reference workspace and coverage board.
- The crop workspace supports common 3-column, 4-column, 2×2, and 3×2 layouts, explicit panel selection, direct drag adjustment, and optional human approval.
- The mapper offers direct paths to crop angles from the selected image or generate missing angles from the approved authority.
- Source sheets remain unchanged. Extracted angles retain source, layout, panel, and normalized crop provenance.

## Frames workspace

- Multiple frames no longer render as several full production editors at once.
- A compact frame strip shows every frame, its status, and an approved thumbnail.
- Only the selected frame editor is rendered.
- Candidate cards keep a bounded width so one returned image no longer stretches across the entire workspace.

## Project management

- Projects can be deleted from the project switcher.
- Deletion is recoverable: the complete project folder is moved to `projects/.trash`.
- When the active project is deleted, CineBraid selects the next available project or returns to first-run setup.

## Compatibility

No schema migration, provider change, paid generation request, or removal of existing production data is introduced.

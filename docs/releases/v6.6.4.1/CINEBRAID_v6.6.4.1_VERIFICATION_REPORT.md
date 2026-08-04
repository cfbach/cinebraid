# CineBraid v6.6.4.1 verification report

## Result

**Passed.** The release addresses the reference mapper overflow, direct reference-sheet angle extraction, oversized multi-frame editing, and recoverable project deletion while retaining the v6.6.4.0 manual-first and automation behavior.

## Focused acceptance

- Imported-reference mapping is viewport-bounded and responsive.
- Any uploaded image can be selected as a source sheet, including files not generated or previously classified by CineBraid.
- Crop presets cover 3-column, 4-column, 2×2, and 3×2 sheets, with explicit panel selection and adjustable drag/fine controls.
- Extracted crops retain source-sheet, layout, panel, and normalized-coordinate provenance; the source file remains unchanged.
- Crop actions are visible in the manual reference hub, angle coverage board, expression board, and imported-reference mapper.
- Missing views can still be generated deliberately from approved primary authority.
- Multi-frame shots render a compact frame strip and one selected full editor rather than all full editors simultaneously.
- Candidate cards remain width-bounded when only one or two results exist.
- Project deletion moves the complete project folder into `projects/.trash` and safely changes or clears the active project.

## Verification completed

- `npm run check:quick` — passed, including syntax, route rendering/recovery, behavior, browser workflow, API smoke, manual-first, manual parity, package, readiness, automation restoration, and the new v6.6.4.1 usability suite.
- `npm run check:browser-real` — passed in real Chromium, including desktop/tablet/mobile overflow checks and imported-reference mapping.
- `npm run check:ui-state` — passed disclosure and viewport-context stability.
- `npm run check:environment` — passed sanitized external-test packaging and local/LAN posture.
- `npm run check:package` — passed release structure checks.
- Untouched ready-to-run ZIP extraction followed by `npm run check:quick` — passed.
- v6.6.4.0 patch-overlay validation followed by `npm run check:quick` — passed.
- `projects/`, `data/`, and `node_modules/` produced identical combined SHA-256 tree hashes before and after applying the patch.

The render suite intentionally simulates a composer crash to verify guarded recovery; the resulting logged stack trace is expected, and the recovery assertions passed.

## Safety and compatibility

- Paid generation requests during verification: **0**
- Schema migration: **none**
- Existing project data removed or overwritten by patch: **none**
- Provider configuration changes: **none**
- Motion/video compiler changes: **none**
- Project deletion mode: **recoverable soft delete**

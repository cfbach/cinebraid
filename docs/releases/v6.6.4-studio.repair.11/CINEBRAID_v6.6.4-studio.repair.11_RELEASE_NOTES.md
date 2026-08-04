# CineBraid v6.6.4-studio.repair.11 — Continuity-Safe Frame Sequences

## Focus
This update addresses the remaining private-preview issues around continuity-state authority, oversized approved frames, full-shot automation controls, and first/last-frame continuity safety.

## Changes

### Approved frame previews stay bounded
- Approved Frame A/B previews are constrained to a compact 300 × 220 px working area on desktop.
- The source image remains available through the existing large in-app theatre preview.
- Mobile previews remain contained without horizontal overflow.
- The cache-busted repair.11 stylesheet prevents earlier oversized-preview CSS from surviving an update.

### First/last and multi-frame continuity gate
- Two or more approved frame anchors now require a sequence continuity review before motion can open.
- The review compares:
  - camera position and framing
  - fixed environment geometry
  - background practical lights and exposure
  - character identity, wardrobe, scale, and placement
  - prop construction and placement
  - intended state/action progression
- A major mismatch such as a practical light appearing only in Frame B blocks motion readiness.
- Individual frame approval is preserved, but the shot is not treated as fully approved or motion-ready until the frame sequence passes.
- The vision review starts automatically after the second required frame is approved when a vision assistant is available.
- Manual **Review frame sequence** and **Review again** controls remain available.

### Approved continuity-state authority is visible first
- The selected continuity-state editor now begins with a prominent **Current approved authority** panel.
- It shows the approved filename, state, lineage, and a clickable preview.
- Clicking an authority thumbnail opens the large media theatre instead of navigating away.
- State navigation remains available as a separate control.

### Image-generation settings in automation
- Full-shot automation now exposes:
  - images per pass
  - blocking quality
  - blocking resolution
  - frame/reference quality
  - frame/reference resolution
- Blocking-only automation exposes blocking quality and resolution alongside options per round.
- Entity and continuity-state automation expose images per pass plus frame/reference quality and resolution.
- Estimates and hard image caps now respond to the selected images-per-pass value.
- Settings are stored in the automation run and used by provider submissions.

### Automation layout cleanup
- Automation checkboxes use a consistent two-column layout and align with their descriptions.
- Frame/state selection rows use the same alignment system.
- Generation controls are grouped into one clearly labelled section.

## New API
- `POST /api/llm/review-frame-sequence`
  - accepts a shot ID and ordered frame IDs
  - reviews the approved files in temporal order
  - returns normalized pass/fail, score, category findings, blocking issues, and correction advice
  - rejects model-reported “pass” when a hard continuity category is below threshold or blocking issues are present

## Compatibility
The patch preserves:
- project folders and media
- `data/config.json`
- API keys and provider settings
- local model settings
- `node_modules`

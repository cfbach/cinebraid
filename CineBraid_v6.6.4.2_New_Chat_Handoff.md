# CineBraid v6.6.4-studio.4 — New Chat Handoff

## Current release

**v6.6.4-studio.4 — Shot Board Preview Density**

## Latest fix

The **Scenes & Shots** overview had regressed into oversized previews because its responsive grid allowed the few visible cards in a scene to consume all remaining row width. A scene with one shot became a nearly full-screen image; two shots became two very large panels.

v6.6.4-studio.4 changes the board to bounded card tracks and adds a visible persistent size choice:

- **Compact** — up to 260 px; default thumbnail overview.
- **Standard** — up to 340 px.
- **Large** — up to 460 px.

Sparse scene rows remain left-aligned. Mobile still uses a single responsive column. Scene collapse persistence was also repaired.

## Previous v6.6.4.1 work retained

### Reference organization

- Viewport-bounded imported-reference mapper.
- Direct cropping of turnaround/contact sheets into angle, view, expression, or state slots.
- Common grid presets, manual crop adjustment, optional immediate approval, and crop provenance.
- Missing-angle generation from approved authority remains available after extraction.

### Frames workspace

- Compact frame rail with only one full editor open at a time.
- Bounded candidate-card widths for sparse results.

### Projects

- Recoverable project deletion through the project switcher.
- Deleted projects move to `projects/.trash`.

## Product position

CineBraid remains local-first and manual-first. Upload, crop, map, approve, assign, review, and deliver without configuring a provider. Assisted prompting, review, generation, and automation remain optional.

## Verification

The dedicated v6.6.4-studio.4 real-browser test measured the three desktop widths at 260, 340, and 460 px and confirmed that one- and two-shot scenes remain bounded without horizontal overflow. Portable quick checks and untouched-ZIP verification also passed.

## Recommended next dogfood pass

Use the Scenes & Shots board on a production with a mixture of one-shot, two-shot, and five-shot scenes. Confirm Compact works as the everyday overview, Standard is useful for visual checking, Large is useful for closer inspection, and that the selected preference survives a restart.

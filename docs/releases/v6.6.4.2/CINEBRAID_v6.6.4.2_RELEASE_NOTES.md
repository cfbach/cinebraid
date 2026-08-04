# CineBraid v6.6.4-studio.4 — Shot Board Preview Density

## Summary

This patch fixes the **Scenes & Shots** overview so scenes with only one or two visible shots no longer expand those previews across the full workspace.

## Scenes & Shots board

- Adds a persistent **Card size** control with **Compact**, **Standard**, and **Large** options.
- Uses **Compact** by default for a thumbnail-oriented production overview.
- Caps card widths at approximately 260 px, 340 px, and 460 px respectively.
- Keeps one-shot and two-shot scenes aligned to the left instead of stretching cards to fill the row.
- Preserves the 16:9 preview ratio and the existing status, next-action, relationship, and version metadata.
- Returns to a single responsive column on narrow mobile layouts.

## Persistence repair

- The selected card size is remembered in the current browser.
- Scene expand/collapse choices now save under the intended stable local-storage key.

## Compatibility

The patch does not change project data, reference authority, media files, providers, automation behavior, or the project schema. It preserves the reference-sheet cropping, compact frame editor, recoverable project deletion, and shot/scene automation added in v6.6.4.1 and v6.6.4.0.

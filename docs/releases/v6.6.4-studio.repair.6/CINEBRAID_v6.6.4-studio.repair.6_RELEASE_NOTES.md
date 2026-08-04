# CineBraid v6.6.4-studio.repair.6 — Private Test Stabilization

## Purpose
This release follows the repair.5 MiniMax H3 implementation with a launch-readiness pass focused on provider validation, reference ordering, paid-request safety, accurate provenance, and current tester documentation.

## MiniMax H3 hardening
- H3 provider prompts are compacted and validated against the current fal queue schema maximum of 2,000 characters.
- All typed H3 references are normalized to `Image N`, `Video N`, and `Audio N`, even when an imported build contains legacy `#imageN` or `@imageN` tokens.
- CineBraid preserves the deliberate reference order constructed by the H3 workspace. Sequential frames remain Image 1–N across the UI, compiled prompt, provider payload, and provenance.
- New multi-frame plans start with only the first and last approved frames selected. Intermediate waypoints are explicit opt-ins.
- The H3 confirmation dialog now shows the actual provider image order, prompt-character usage, and an advisory spend estimate.
- H3 submissions include a stable client request ID and an in-dialog submission lock to prevent accidental duplicate paid requests.
- The server independently rejects over-limit prompts before FAL submission.
- I2V and first/last-frame provenance now records that aspect ratio follows the source image.

## Documentation and packaging
- Current README, setup, Spark setup, cache-busting, and version assertions now identify repair.6.
- Patch packages continue to exclude `data/config.json`, projects, uploaded media, keys, and local model settings.

## Known follow-up
Large local video/audio reference packages are still converted to Base64 data URIs for provider submission. This is valid but less efficient than uploading large files to FAL storage first. Use compact reference media for private demonstrations until a dedicated upload/cache layer is added.

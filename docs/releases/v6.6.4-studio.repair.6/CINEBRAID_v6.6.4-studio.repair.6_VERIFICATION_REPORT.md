# CineBraid v6.6.4-studio.repair.6 Verification Report

## Automated coverage
The release was checked through CineBraid's syntax, render-recovery, behavior, API, browser, manual-first, prompt/FAL, H3, reference-authority, persistence, mobile/integrity, package, and real-browser suites.

## H3-specific assertions
- 2,000-character provider-schema cap
- section-aware prompt compaction retaining Image 1–9 references
- legacy token normalization
- deterministic provider reference ordering
- first/last default selection for new multi-frame plans
- prompt-length and spend preflight display
- client request idempotency plumbing
- server-side over-limit rejection
- MP4 candidate ingestion and provenance

## Expected test output
The render harness deliberately simulates one composer crash to verify safe-mode recovery. The logged simulated exception is expected when the suite passes.

## External service boundary
Automated tests mock paid FAL submission and returned media. A real paid H3 generation depends on the tester's FAL account, current provider availability, account balance, and submitted media.

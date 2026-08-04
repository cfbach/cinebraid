# CineBraid v6.6.4-studio.repair.1 — Readability, Modal, and Assistant Repair

## Purpose
This repair branch stabilizes the Studio side branch after visual layering created inconsistent contrast and responsive-layout regressions.

## Repairs
- Replaces the stacked website-alignment/theme override layers with one consolidated application theme block.
- Restores near-black production surfaces and higher-contrast text for the default dark workspace.
- Keeps Website navy, Warm studio, and Light canvas as complete selectable surface modes.
- Keeps font selection and makes it propagate through the app shell.
- Removes the duplicate `CB` pseudo-logo treatment and keeps the CineBraid wordmark on one line.
- Fixes the test-note modal so its textarea and actions remain inside the modal at desktop and mobile widths.
- Adds resilient Ollama response extraction.
- Retries an empty `/api/chat` response through `/api/generate` before reporting a local assistant failure.

## Tested
- syntax
- repair regression suite
- render harness
- current behavior suite
- API smoke suite, including Ollama generate fallback
- browser workflow suite
- reference workspace UX suite
- release package smoke test

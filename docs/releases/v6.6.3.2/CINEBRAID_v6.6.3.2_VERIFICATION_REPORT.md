# CineBraid v6.6.3.2 — Verification report

## Result

The source tree passed `npm run check`: **29 suites in 28.3 seconds** through the fresh-process verification runner. The runner executes Node suites with bounded concurrency, runs the two real-browser personas independently, then performs environment and package checks.

The exact ready-to-run ZIP was extracted into a clean directory and passed the same **29-suite** `npm run check` command. The complete output is recorded in `CINEBRAID_v6.6.3.2_CLEAN_ARCHIVE_TEST_LOG.txt`.

## Manual-first parity

- Default shot route: **9 visible controls in manual emphasis / 11 in assisted emphasis**.
- Existing shot control budgets remain **9 visible / 23 reachable**.
- Global Activity budget remains **4 controls**.
- Default automation console budget remains **1 control**.
- Every primary route and all five shot tasks were tested with assistants and FAL disabled.
- No assisted-only action was default-visible in the manual column.
- Existing prompt and automation history did not reopen assisted tools after switching to manual emphasis.
- Assisted emphasis retained prompt building, improvement, generation and automation capabilities.

## External-test readiness

- Declared Node floor: **Node.js 18 or newer**.
- Unsupported Node versions fail before the server binds a port.
- Default bind address: **127.0.0.1**.
- LAN access requires deliberate `--lan` / `npm run start:lan` opt-in and prints an exposure warning.
- A zero-project installation renders a first-run Welcome state.
- Python browser checks skip clearly when Python 3 is unavailable; `npm run check:quick` remains the portable Node-only check.

## Release contents

The release contains one sanitized project only: **CineBraid Sample — The Blue Parcel**.

- 1 character
- 1 location
- 1 prop
- 1 scene
- 3 shots
- 9 simple placeholder PNG files
- manual workflow emphasis
- assistant, agents and FAL disabled by default

No unreleased production project, production canon, production reference, or production media is included. The package guard fails if another project directory or media outside the sample enters the archive.

## Provider-free proof

The manual Chromium persona completed reference organization and shot delivery with every assistant capability and FAL disabled. It assigned imported references, approved an existing still, approved an existing finished video and finalized the delivery without an AI review, prompt compile, generation request or automation start.

## Compatibility and safety

- No breaking schema migration.
- The v6.0.7.1 composer recovery guard remains unchanged.
- The nine motion compilers remain unchanged.
- Strict reference-authority and spatial-continuity checks remain intact for assisted work.
- Prompt compilation, automation behavior and exports are identical for manual and assisted projects with the same stored data.
- No capability was removed.
- No paid FAL request was submitted during verification.

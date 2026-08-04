# CineBraid v6.6.3.2 — Manual Parity & External Test Readiness

This release prepares the private mainline build for a small external test group whose primary use case is organizing references and media produced elsewhere.

## Manual-first shot parity

References already respected the project’s Workspace emphasis. Shots now do too.

In manual emphasis:

- described frames ask for **Add existing image**, not Build prompt;
- candidate counts say **to choose from**, not to review;
- existing-image, existing-video and existing-audio intake precede assisted tools;
- prompt Build/Improve controls remain reachable inside **Optional assisted creation**;
- prior prompt history remains visible without reopening the assisted tools;
- the board says **Ready for media**;
- Settings groups Assistant and Generation under **Optional assisted services**.

The default sample shot exposes 9 visible controls in manual emphasis and 11 in assisted emphasis. The underlying keys, project schema, prompt compilation, automation behavior and exports are unchanged.

## Safe external-test package

The release archive contains:

- CineBraid application files;
- bundled `node_modules`;
- documentation and release reports;
- one sanitized manual-first sample, **CineBraid Sample — The Blue Parcel**;
- only the simple placeholder media belonging to that sample.

It contains no real production project, unreleased script material, production reference, or production media.

## Runtime and network defaults

- Node.js 18 or newer is declared and checked before startup.
- The default server binds to `127.0.0.1` only.
- LAN access is an explicit opt-in through `npm run start:lan` or `node server.js --lan`.
- LAN startup prints an exposure warning and documentation instructs testers to set an Editor passcode first.

## First-run and documentation

- An empty projects folder displays a clear create/open first-run state rather than a blank app.
- README, Setup and Getting Started now lead with the provider-free sample workflow.
- `npm run check:quick` provides a portable Node-only verification path.
- Python browser checks skip with a clear message when Python 3 is not installed.

No provider, generation feature, prompt compiler, automation capability, report, recovery path, historical record, or motion compiler was removed.

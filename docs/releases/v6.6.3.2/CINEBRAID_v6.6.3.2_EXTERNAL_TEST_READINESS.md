# CineBraid v6.6.3.2 — External test readiness

## Archive contents

The package contains only one project: `projects/cinebraid-sample`. Its nine small PNG files are simple generated placeholders created for the sample. The package smoke test fails if another project directory or any media outside that sample appears.

## Node floor

The declared and tested floor is Node.js 18. Startup exits before binding a port when a lower version is detected.

## Network posture

The default bind address is `127.0.0.1`. A fresh install is not reachable through the machine’s LAN address. `--lan` or `npm run start:lan` deliberately binds all interfaces and prints a warning.

## Provider-free proof

The sample opens in manual emphasis with text assistance, vision assistance, agents and FAL disabled. Automated verification approves the existing third-shot image, finalizes all three sample shots and records completion without a prompt compile, provider request, AI review, or automation start.

## First run

When no projects exist, the app renders a Welcome state with Create project and available sample/open-project actions. It does not render a blank production workspace.

## Portable checks

`npm run check:quick` runs the main Node-based install verification. The full suite attempts Python browser checks when available and reports a clear skip otherwise.

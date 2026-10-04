# Getting started — CineBraid 7.0 Public Alpha

This guide follows the `7.0.0-alpha.1` source candidate, not an asserted release/
tag/download. Use the exact supplied source/package and [Setup](../SETUP.md).
Requires **Node.js 18 or newer**; Node.js 24 is the qualified Windows runtime.
Manual production needs no provider key.

## 1. Start the intended workspace

Run `npm ci`, then `npm start`. Open the printed URL, normally
`http://127.0.0.1:4477`. Verify active settings/projects paths; a second application
folder alone does not isolate an existing production. Use the
[Windows isolated trial](../SETUP.md#windows-isolated-manual-trial) for learning.
Keep the terminal open; Ctrl+C stops the server.

Choose **Add the CineBraid sample** to make an editable Blue Parcel copy.
The bundled sample is application content, not the editable project.

## 2. Inspect exact references and decisions

Open **References**, then the intended entity/state/view. Its contextual sidebar
categories appear only while References is active. Current approval receipts,
selected/provisional candidates and superseded history have different meanings.
A fresh sample's existing selections are not approvals.

Use the exact state's **Upload image** or reference import/enrollment controls;
choose the exact destination, inspect the candidate, then deliberately approve
only that target if acceptable. Existing current receipts need no repeat approval.
Coverage may be Required, Planned or Not required; it does not grant authority.

## 3. Move the shot forward

Open **Shots → SAMPLE-03**. Shots owns scene grouping, search and current-shot
navigation. Click a stage directly; its workspace opens below sticky chrome.

In **Frames**, inspect `SAMPLE-03-OPEN.png` in Results/Screening. Compare candidates;
use **Approve result…** and confirm only if accepting that image as Frame A.
Selection, Build and Screening do not approve it.

**Deliver** records a separate final decision when the chosen approved material
meets your intent. Confirm deliberately; do not finalize to clear a badge. The
manual still-only sample needs no generated video.

## 4. Define a production

Create scenes/shots and author Shot Intent / **Planned duration**, leaving it
undecided when appropriate. Planned timing is independent of provider clip duration.
Choose **Existing media / editorial** for imported work rather than a generative route.

Establish Project Bible/reference states/views, bind relevant approved inputs,
and import existing frames/video/audio. Review exact candidates, listen before
audio approval, and place sound with role/timing. Placement is not a mixed render.
Save normally and reopen to verify the same media/decisions.

## Optional generation and Braidy

Authoring direction is production intent. **Build** compiles the exact model/
provider/mode package; inspect ordered roles, coverage, settings and final prompt
in native request review before any paid submission. Returned media is a candidate.
An unapproved candidate can be an edit canvas; technical guides/base-bound masks
are not approved References and become durable dependencies when built.

Deterministic Build is the trusted baseline. Braidy is optional/advisory:
inspect omitted intent before Accept/Edit or Reject. A stale proposal/request
needs fresh review. Acceptance changes the package, never Canon or approvals.

[Optional services](guides/OPTIONAL_SERVICES.md) distinguishes qualified modes
from experimental/available tools. Assisted continuity repair and per-frame AI
critique remain unqualified; visible automation is not qualification or free spend.

## Handoff, backup and feedback

Copy physical media with identity/hash/decision records; there is no built-in
NLE/export pipeline. Back up entire project/media folders plus private config
separately. Restore into another destination, never over the sole original.

Desktop is primary; basic mobile behavior exists. [Open an issue](https://github.com/cfbach/cinebraid/issues)
for bugs/friction with version/build, OS, workflow, model/provider/mode,
expected/actual behavior and safe screenshots/logs. Never include secrets.
See [limitations and roadmap](../README.md).

LAN is opt-in: set an Editor passcode, then `npm run start:lan` on a trusted network.
Cloud work sends selected inputs externally and can incur cost.

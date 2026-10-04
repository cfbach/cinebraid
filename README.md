<p align="center"><img src="public/cinebraid-logo-xs.png" alt="CineBraid logo" width="80" height="103"></p>

<h1 align="center">CineBraid 7.0 Public Alpha</h1>

<p align="center"><strong>Open-source, local-first production software for conventional and AI-assisted filmmaking.</strong><br>Keep your Project Bible, references, shots, media and human decisions together.</p>

[Get started](#start) · [Documentation](docs/README.md) · [Give feedback](#give-feedback) · [Contribute](CONTRIBUTING.md)

**Source candidate: `7.0.0-alpha.1` · Apache License 2.0 · In development**

The production layer that keeps AI cinema tied together. **Your production, your control.**

This tree prepares CineBraid 7.0 Public Alpha. A version string is not a released
artifact: this source does not establish that a GitHub Release, tag or Windows
download exists. Install only an exact reviewed source commit or a supplied
package whose manifest/checksums identify it. Never substitute moving `main`
for a frozen package. Release publication is a separate owner decision.

For filmmakers building multi-shot productions, CineBraid keeps planning,
references, shot intent, candidate media and approval receipts connected.
Import media made anywhere; generation and assistance are optional.
This is not a stable release or a production-ready support guarantee.

## Working now

- **Production and Shot Desk:** organize scenes and shots, move directly between
  Inputs, Look & blocking, Frames, Motion & sound and Deliver. Shots owns its
  contextual scene/shot navigation in the single sidebar.
- **Project Bible and References:** author production context; manage exact
  entity/state/view assets, coverage and human approval history. Selected media
  is not approved media; a new decision can supersede a previous receipt for
  the same target without granting authority to another target.
- **Editorial work:** Existing media / editorial is a first-class shot production
  method. Planned duration belongs to Shot Intent, independently of provider clip duration.
- **Results and Screening:** compare attempts, inspect artwork, deliberately approve
  or reject the exact candidate. Revision may use an unapproved edit canvas without
  promoting it to approval authority.
- **Native candidate repair:** current approved appearance references, explicitly
  non-authoritative technical guides and a durable mask bound to the exact base
  flow through Build and normal exact request review.
- **Motion and sound:** review generation requests, ingest returned candidates,
  play video/imported or recorded audio, approve exact audio and place it with a
  role/timing. Placement is editorial intent, not a mixed render.
- **Provenance:** linked jobs retain submitted prompts, ordered inputs,
  provider/job/result identities and request fingerprints. Media Inspector reads
  the linked submitted prompt, not a newer draft.
- **Delivery:** record a deliberate Final/Delivered decision and download records.
  Physical handoff is manual copying of chosen media with identity, hash,
  provenance and decision records; there is no built-in NLE/export pipeline.

Human approval stays explicit. Build, selection, AI recommendations and returned
files do not approve a reference or frame. Do not mark Final merely to try a
feature. An unavailable provider does not block the manual workflow.

## Start

Requires **Node.js 18 or newer** and npm; Node.js 24 is the qualified Windows
runtime. Git is needed for cloning, not for an extracted source ZIP.
There is no frontend build step or bundled native installer.

For an already supplied, verified 7.0 source folder:

```powershell
npm ci
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
npm start
```

Open the printed URL, normally [http://127.0.0.1:4477](http://127.0.0.1:4477).
Keep the terminal open; Ctrl+C stops CineBraid. Use an unused `PORT` for a second instance.

`npm ci` uses the lockfile and needs network access. Runtime dependencies are
`express` and `pngjs` (pinned to 7.0.0). Source packages omit `node_modules`.
**No credential is needed** for installation, the sample or manual work.
**ffmpeg is optional**, separately installed for media inspection/proxy utilities.

[Setup](SETUP.md) covers exact-source installation, isolated trials, credentials,
backup and upgrades. Ordinary startup uses this account's existing settings and
projects; a second application folder alone does not isolate production data.

## Try a first shot

1. Choose **Add the CineBraid sample**. This makes an editable Blue Parcel copy;
   the bundled source remains unchanged.
2. Inspect **References** and an exact state/view. Fresh sample selections still
   need human decisions. Approve only inspected media you intend to authorize;
   do not repeatedly approve existing current receipts.
3. Open **Shots → SAMPLE-03 → Frames**. Review `SAMPLE-03-OPEN.png` in
   Results/Screening. **Approve result…** records a deliberate Frame A decision.
4. If the approved still is the intended delivered work, use **Deliver** and
   confirm the final decision. Generation is not required; approval and delivery differ.

Follow [Getting started](docs/GETTING_STARTED.md) for reference enrollment,
editorial duration, review and save/reopen. The bundled sample lives at
[`projects/cinebraid-sample/`](projects/cinebraid-sample/); work in its editable copy.

## Qualified generation targets

“Qualified” means the named compiler/request/authority path is qualified with
provider constraints. It does not guarantee artistic fidelity, uptime, future
pricing, or real paid execution of every mode.

| Exact target / provider | Qualified request modes |
|---|---|
| GPT Image 2 / fal `openai/gpt-image-2` | T2I, blocking |
| GPT Image 2 / fal `openai/gpt-image-2/edit` | Edit, multi-reference, explicit inpaint/mask mapping |
| MiniMax H3 FL2VA / fal | T2V, I2V, first/last frame |
| MiniMax H3 Ref2VA / fal | R2V with explicitly selected ordered inputs |

Read [Optional services](docs/guides/OPTIONAL_SERVICES.md) and the
[H3 guide](docs/guides/MINIMAX_H3.md) before configuring/paying for generation.
Catalogue entries may be **Experimental/available**, **In development** or
**Research/watchlist**. Catalogue presence or an old prompt profile is not
qualified native support. ComfyUI/Civitai and other assistant routes remain
optional, with workflow/model-specific limits, not blanket qualification.

## Known limitations / experimental

Desktop production is primary; basic responsive/mobile navigation exists.
Dedicated mobile polish is lower priority. This alpha is still in development.

**Deterministic model-specific Build is the trusted production baseline.** Braidy
is optional/advisory/experimental. Inspect coverage/omissions before Accept/Edit;
Reject leaves Build. Acceptance changes the generation package, not Canon or
approvals. Even stronger models can drop directed intent. Connection readiness
is not task qualification; choose the model in Settings rather than assuming a default.

Optional assisted continuity repair and per-frame AI critique remain unqualified.
Other automation/review controls may be available experimentally; a visible button
is not a qualification certificate. Manual production remains usable without AI.

Generated output may drift, even outside a mask. Paid dispatch is not artistic
approval. Inspect the exact request and current cost before submission. Audio
placement is not an automatic video mix; physical media handoff remains manual.

## Your data and network

CineBraid is **local-only by default**, bound to `127.0.0.1`. Its interface has no
third-party analytics, fonts, scripts or stylesheets. Requested external work
sends selected prompts/context/media and can incur cost. Model-list/health checks
can contact configured services too.

Projects normally live outside the app in `%USERPROFILE%\CineBraid Projects` on
Windows or `~/CineBraid Projects` elsewhere. Settings normally use
`%LOCALAPPDATA%\CineBraid\config.json`. Startup and **Settings → Files & storage**
identify actual paths; overrides/legacy roots may differ.

Settings/credentials are server-side **plaintext JSON**, not an encrypted vault.
Readbacks mask keys; local files/recovery backups require OS account protection.
Back up full project/media folders and config separately; a JSON backup alone is
not a complete media backup. Never share keys/private configs.

LAN is opt-in: set an Editor passcode first, then `npm run start:lan` on a trusted
network. Do not expose CineBraid directly to the internet. A self-hosted endpoint
label does not prove its operator never forwards data elsewhere.

## Coming next / 7.x

Real-production refinement, inherited production libraries, start from existing
production, model benchmarking/recommendations, broader evaluated provider/model
coverage and workflow/density polish. DF-04/05/06 remain deferred editorial
follow-ups, not new 7.0 features. These are plans, not shipped capabilities.

## Longer-term direction

Shared/series production systems, richer handoff/export, deeper local AI and
larger collaborative/automated production workflows. Direction, not commitments.

## Give feedback

[Open a GitHub issue](https://github.com/cfbach/cinebraid/issues) for bugs or workflow
friction. Include version/build, OS, workflow, model/provider/mode where relevant,
expected/actual behavior and safe screenshots/logs. Redact keys/private production
material. Report vulnerabilities privately using [SECURITY.md](SECURITY.md).

## Documentation and contributing

[Documentation index](docs/README.md) · [Setup](SETUP.md) ·
[Project Builder prompt kit](resources/project-builder/README.md) ·
[Model packs](docs/architecture/GENERATION_MODEL_PACKS.md).
The Project Builder feeds Project Bible, References and Shots; it is not the
queued start-from-existing-production feature.

Every pushed branch is public. Use DCO sign-off and the installed history-aware
pre-push gate. See [Contributing](CONTRIBUTING.md) and [Publication](docs/PUBLICATION.md).
Windows validation is required; browser CI is advisory pending runner stability.
Strict browser/release commands still require real browser execution.

```text
npm run check:quick
npm run check:ci-census
npm run check:release
npm run check:authority-browser
```

Code: **Apache License 2.0** ([LICENSE](LICENSE)); name/logo/Braidy artwork have
separate terms ([TRADEMARKS.md](TRADEMARKS.md)).

# CineBraid repository media

This directory holds durable guidance for public repository presentation. Runtime
artwork stays in `public/`. Three product screenshots are approved for README publication as recorded below.
Project Bible is held; social-preview activation remains deferred.

## Accepted README captures — Public Media Capture V1

Product-owner visual review approved the following three genuine captures for README publication. Originals remain outside Git under `C:/CineBraid/Codex-Reviews/public-media-capture-v1/originals/`. Source application SHA for every image: `022fe324c725a40b8cd89a6e0283cfd99527e7f6`. Disposable public demo: `cinebraid-sample-public-media-v1`, displayed as **CineBraid Sample — The Blue Parcel**, derived only from tracked `projects/cinebraid-sample`.

All captures are 1600 × 1000 CSS/pixel viewports, DPR 1, zoom 100%, dark theme. No crop, scaling, retouching, compositing or UI-state alteration. Repository PNGs preserve decoded RGB pixels exactly; lossless PNG optimization strips descriptive metadata and retains only an sRGB rendering-intent declaration. All are below 1 MB.

Public-safety review: no private productions, credentials, local filesystem paths, browser chrome, QA/debug overlays or private media appear. Capture used isolated projects/configuration/ComfyUI registry roots and fresh browser profiles. All nine sample artwork files remained byte-identical. Runtime normalization and approvals affected only the disposable project; tracked public sample was unchanged.

Rights/provenance: media came solely from the public sample at the source SHA above; `TRADEMARKS.md` places non-brand tracked assets under the repository Apache-2.0 licence. CineBraid branding remains subject to its separate Frombach Studios terms. These are owner-approved depictions of the genuine application, not generated substitutes.

### `production-overview.png`

- Published path: `screenshots/production-overview.png`.
- Route: `/#/production`.
- Source SHA-256: `cd323ed57dc29add9816c60b0fde4c853c45e433c938dd9b6aae9a2d4e3b4acf`.
- Optimization: 142,861 → 146,750 bytes; pixel-identical.
- Final SHA-256: `4d3c7e1eb77d82cb691945975c3a064211308fb798addc3ab5de3e09be54f14c`.
- Selected entity/shot: SAMPLE-03 â€” Parcel opened; overview also lists SAMPLE-01 and SAMPLE-02.
- UI state: One returned frame awaits review; 2/3 shots retain inherited signed-off workflow labels; 0/3 delivered. All four reference states have been confirmed.
- Disposable changes: Navigation plus four real reference approvals; no shot approval, delivery, generation or image edits. App performed its normal schema/authority normalization on the disposable copy.
- Captured: 2026-09-10T06:37:46.017642+00:00.
- Caption: See the production and the next shot that needs your attention.
- Alt text: CineBraid production overview showing the Blue Parcel demo's three shots and the next pending shot decision.
- Visual acceptance caveat: Visible UI says one result awaits review but zero decisions need you. Preserve this discrepancy; do not caption the first two shots as newly approved or delivered.

### `shot-workspace.png`

- Published path: `screenshots/shot-workspace.png`.
- Route: `/#/shot/SAMPLE-03`.
- Source SHA-256: `dbcd86123b9935f3922d97a8b005267968d1c95e5fa3f6558d13b79caf15dec3`.
- Optimization: 193,725 → 193,537 bytes; pixel-identical.
- Final SHA-256: `2b2eb8db8923d81e2fa7c1a3f2b73a477156baf2d0e458da16fe0aaf6ba1e732`.
- Selected entity/shot: SAMPLE-03 â€” Parcel opened; Frame A, SAMPLE-03-OPEN.png.
- UI state: Five linked references, zero of one frame approved, returned candidate and real review/use/revise/keep-looking controls. Production note describes the open parcel; production route remains undecided.
- Disposable changes: Same four reference approvals; opening the shot also triggered the appâ€™s normal shot-folder request. No candidate approved, route selected, media generated or imported.
- Captured: 2026-09-10T06:37:57.483009+00:00.
- Caption: Keep each shot connected to its references and chosen frames.
- Alt text: Parcel opened in CineBraid's Frames workspace, with a selected Frame A candidate awaiting human approval.
- Visual acceptance caveat: Production route genuinely remains undecided. Lower frame controls extend below the viewport. Do not imply this screenshot proves generation, delivery or completed approval.

### `reference-review.png`

- Published path: `screenshots/reference-review.png`.
- Route: `/#/character/CHAR-COURIER`.
- Source SHA-256: `b5705e66973f4dbd3593e4deb10f83f9852ad714525d217fcd104e2bebf916e0`.
- Optimization: 153,494 → 147,075 bytes; pixel-identical.
- Final SHA-256: `2d6514bace4ec114e52abd4770da8c24d9877de1b8f7fbe7376e3eda1ca21dca`.
- Selected entity/shot: CHAR-COURIER â€” The courier; CHAR-COURIER-FRONT.png; Travel coat.
- UI state: Approval dialog open before confirmation; selected candidate and primary project-wide state visible, with Approve, Cancel and Request changes controls.
- Disposable changes: Captured before the first confirmation. Navigation opened the real approval dialog; the four approvals occurred afterward.
- Captured: 2026-09-10T06:31:52.755780+00:00.
- Caption: Review a candidate before making an explicit approval.
- Alt text: CineBraid reference approval view for the courier, showing the selected reference target and explicit human approval controls.
- Visual acceptance caveat: Earlier point in the same demo timeline than the other three images. Background dimming/blur is the native modal, not retouching. Do not describe this frame as already approved.

### Held and deferred

`project-bible.png` is **held / not published** by product-owner decision: truthful but visually sparse. No fourth gallery image is included. The social-preview draft remains outside the repository; GitHub Social Preview activation is a separate `CINEBRAID_GITHUB_SOCIAL_PREVIEW_V1` task. Native 80 × 103 ribbon treatment is unchanged; higher-resolution master provenance remains separate.

## Existing authoritative assets

| Asset | Use |
|---|---|
| [Ribbon logo](../../public/cinebraid-logo-xs.png), 80 × 103 PNG | README identity at native size. Reference the existing file; do not duplicate, enlarge, trace, redraw, or recolor it. |
| [Favicon](../../public/cinebraid-mark.svg), 256 × 256 viewBox | A distinct legacy mark retained for favicon use. It is not a larger ribbon-logo master. |
| [Braidy sprites](../../public/assets/assistant-character/) | Runtime character artwork, not proof of a functioning assistant interaction. |
| [Public sample](../../projects/cinebraid-sample/) | Simple storyboard artwork for learning the workflow, not a curated marketing capture set. |

Use the native ribbon logo for now. Larger branding must wait for an authoritative
master supplied by the owner; never fabricate or upscale one. The
[brand terms](../../TRADEMARKS.md) are separate from the application code license.

## Future captures

For additional captures, begin only when a coherent, rights-cleared public demo set can support
strong images. It should include matching character views, locations, prop states,
shot frames, and useful production descriptions. The existing sample is useful for
learning and isolation, but is not automatically suitable marketing media.

Use a disposable public-source installation, fresh browser profile, separate demo
workspace, and empty local configuration. Never use a private production or alter
the tracked sample to prepare marketing material. Preserve real application states:
no composited interfaces, invented conversations, or retouched approval status.

When the demo set is accepted, prefer four complementary views:

| View | What the capture must show |
|---|---|
| Production overview | The production, its shots, actual progress, and the next human decision. |
| Project Bible | Recurring characters, places, and props with useful canonical descriptions and reference context. |
| Shot workspace | A recognizable shot with its intent, inputs, candidate media, and real decision controls. |
| Reference or candidate review | A legible relationship between the selected work and the explicit human review decision. |

Capture the actual running build and record the selected project, route, item, and
state. An approved item must not be captioned as awaiting approval. Add an assistant
or returned-results view only if it supplies distinct, authentic evidence.

## Capture and acceptance requirements

- Use 1600 × 1000 CSS pixels, device scale 1, browser zoom 100%, and a consistent
  application theme. Record any justified deviation.
- Capture the application viewport without browser chrome, developer tools,
  private names, filesystem paths, credentials, or unrelated notifications.
- Keep project/shot identity and the controls that substantiate the caption.
  Crop empty outer space only; never combine different UI states or upscale.
- Keep lossless masters outside Git. Publish accepted sRGB PNGs with metadata
  stripped and lossless optimization, targeting less than 1 MB each without
  sacrificing readable text.
- Inspect full size and approximately 800 CSS pixels wide. Reject clipped labels,
  unclear selection, misleading status, or weak production material.
- Record filename, application SHA, demo identity, route/state, capture date,
  viewport, crop, compression, SHA-256, media owner and redistribution rights,
  caption/alt text, and the visual/public-safety review.

Do not copy website artwork into the application repository without verifying its
rights. Website derivatives should refer to the same accepted media by commit/hash;
this directory does not own the website's implementation or publishing process.

## Social preview, after accepted captures

A future preview should be a 1280 × 640 sRGB PNG below 1 MB, with a 48 px safe
margin, restrained navy/cyan styling, concise product positioning, and one strong
real product capture. The current ribbon may be used only at native size. Inspect
at 640 × 320 as well as full size. Do not produce a blank card while media is pending.

After separate visual acceptance, a repository administrator can upload it in
**Settings → General → Social preview**. Committing an image does not set that field.

## Packaging

`.github/` is excluded from runtime archives by `.gitattributes`. The current
README logo references a runtime file and therefore works in source checkouts and
runtime archives. Future presentation images need exact filename allowances in
package checks as part of their separately reviewed media change; do not introduce
a blanket assets exception or classify marketing images as runtime media.

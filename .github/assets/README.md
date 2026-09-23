# CineBraid repository media

This directory holds durable guidance for public repository presentation. Runtime
artwork stays in `public/`. Three product screenshots are approved for README publication as recorded below.
Project Bible is held. The V2 captures and social preview below were approved by the
product owner on 2026-09-23 and replace the V1 set. GitHub keeps serving the V1
social preview until the owner uploads V2 in the repository settings.

## GitHub Social Preview V2 — approved

`social-preview.png` is product-owner approved (2026-09-23). It is rebuilt from the V2
production capture below, on the recorded V1 layout. Prepared from public main `bddf73834e8ed1df83493db380a5f6eafe6e3860` (6.9.0-alpha.1). GitHub setting
activation is a manual upload by the owner after approval; V1 (SHA-256
`8153421e1df485fe8bd553de6b2ffcfab2414188cad10fc93c2404b315861af5`, from
`5e8d998f9ebf94f73bba5e59472306eda87b9e54`) stays active until then.

- Dimensions: **1280 × 640** RGB PNG, sRGB rendering intent declared. Descriptive metadata stripped; the sRGB colour declaration is the only ancillary chunk. Lossless PNG encoding; 101,923 bytes.
- Final SHA-256: `bc6bee9338cef0d93c0bea43dd25849af2a91910a27fc542c2f066cfbf20f734`.
- Native ribbon source: `public/cinebraid-logo-xs.png`, SHA-256 `f29dd3d8ad3dbf8c2b4ff38e612d5e832e90fc8713a1c1c85687246c19afe8dc`, displayed at exactly **80 × 103** at (48, 50). No enlargement, recolouring, tracing or substitution.
- Screenshot source: `.github/assets/screenshots/production-overview.png` (V2), SHA-256 `cfcb4e1dcd3150852227fff484b3e3aa874439128306d17032971e7351b3c85f`, the entire 1600 × 1000 capture displayed proportionally at **864 × 540** at (368, 50). No crop, UI retouching, compositing of UI states, or added browser chrome.
- Layout: navy `#09121b`, cyan `#28d1df`, light text, 48 px outer safe margin. Text: **CineBraid** / **Local-first production software for filmmaking.** / **Public Alpha · Source-only**.
- Rendered by headless Chromium from an HTML layout at 1280 × 640, device scale 1; the layout and unencoded render remain outside Git.

## Accepted README captures — Public Media Capture V2

Product-owner visual review (2026-09-23) approved these three genuine captures of the
running 6.9.0-alpha.1 build at public main `bddf73834e8ed1df83493db380a5f6eafe6e3860`, all
in **one project state**. Disposable public demo `cinebraid-sample-public-media-v1`,
displayed as **CineBraid Sample — The Blue Parcel**, copied from the tracked
`projects/cinebraid-sample` into an isolated projects root with isolated settings,
loopback only, no provider credentials, and a fresh browser profile. The tracked
sample remained byte-identical.

The state: four real reference approvals, each made through the application's own
approval dialog once it reported the image ready, and each waited on until saved —
The courier · Travel coat, Rain platform · Rainy afternoon, Blue parcel · Closed and
Blue parcel · Opened. After that, navigation only: no shot approval, route choice,
delivery, generation, import or image edit. The three views were captured in
sequence after the application's own approval notification had dismissed itself.

All captures are 1600 × 1000 CSS pixels, device scale 1, zoom 100%, dark theme, with
no crop, scaling, retouching, compositing or UI-state alteration. Published PNGs
decode to exactly the captured pixels; only an sRGB rendering-intent chunk is added
and no descriptive metadata is kept. Originals remain outside Git, on the
maintainer's machine.

Public-safety review: no private production, credential, filesystem path, browser
chrome, QA/debug overlay or private media. Rights/provenance: sample media only;
`TRADEMARKS.md` places non-brand tracked assets under the repository Apache-2.0
licence, and CineBraid branding stays under its separate Frombach Studios terms.

### `production-overview.png`

- Route: `/#/production`. Captured: 2026-09-23T03:01:23.198Z.
- Capture SHA-256: `f0513a38246f274880de8eae1cb5bb7330387e90f439f1b45dbfa91dad9d2ae5`; final 115,045 bytes, SHA-256 `cfcb4e1dcd3150852227fff484b3e3aa874439128306d17032971e7351b3c85f`.
- UI state: next action SAMPLE-03 · Parcel opened, one frame candidate to review; one returned result waiting for review; 0/3 shots delivered, 2/3 signed off, 0 decisions need you, 0:12 planned; all three shots READY to produce Frame A.
- Caption: See the production and the next shot that needs your attention.
- Alt text: CineBraid production overview showing the Blue Parcel demo's three shots and the next pending shot decision.
- Visual acceptance caveat: the view says a returned result awaits review while "0 decisions need you". This is the application's real state, carried over from V1; do not caption the first two shots as newly approved or delivered.

### `shot-workspace.png`

- Route: `/#/shot/SAMPLE-03`. Captured: 2026-09-23T03:01:23.527Z.
- Capture SHA-256: `3f611e00a75759579b704786b465a074a2bf5ce067d2122bd192c5b98c758721`; final 113,913 bytes, SHA-256 `7f895b3f798ca469f20454e5f76a65e9e775e73b36991bfb6910387007e69e8a`.
- UI state: Parcel opened, SAMPLE-03, 4 seconds, In progress; stages Inputs complete, Frames needs review (0 of 1 approved), Motion & sound and Deliver blocked; generation mode Reference-led; shot intent not declared and production route not decided; returned Frame A result SAMPLE-03-OPEN.png awaiting review; Frame A has one new candidate and no approved image.
- Caption: Keep each shot connected to its references and chosen frames.
- Alt text: The Parcel opened shot in CineBraid, with its returned Frame A result waiting for a human decision and no image approved yet.
- Visual acceptance caveat: nothing on this shot is approved; the production route is genuinely undecided. Lower sections extend below the viewport.

### `reference-review.png`

- Route: `/#/character/CHAR-COURIER`. Captured: 2026-09-23T03:01:23.807Z.
- Capture SHA-256: `4cfe7b212d978cb5f2a269698f55494c7dc56a7011e341ce5563b18188fd529d`; final 79,001 bytes, SHA-256 `31f4abbdbaef4f6327495d12784bdf18dd41ca035e6748df1df79e21ed562db0`.
- UI state: The courier, continuity state Travel coat, **Approved** · Travel coat; needed now: none; coverage 1 of 2 planned views filled (Front filled, Three-quarter front missing); Approved reference panel.
- Caption: Keep an explicitly approved reference for each continuity state, and see what coverage remains.
- Alt text: CineBraid reference page for the courier, showing the explicitly approved Travel coat image and the planned views it still needs.
- Visual acceptance caveat: unlike V1, which showed the approval dialog before confirmation, V2 shows the reference after the approval, so all three images share one state. Do not describe it as awaiting approval.

### Held and deferred

`project-bible.png` is **held / not published** by product-owner decision: truthful but visually sparse. No fourth gallery image is included. Native 80 × 103 ribbon treatment is unchanged; higher-resolution master provenance remains separate. A later capture set from a real production is planned separately.

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

# CineBraid repository media

This directory holds durable guidance for public repository presentation. Runtime
artwork stays in `public/`. No curated product screenshots or social-preview
image are approved for publication yet; do not add placeholders or empty galleries.

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

## Public captures are deferred

Begin captures only when a coherent, rights-cleared public demo set can support
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

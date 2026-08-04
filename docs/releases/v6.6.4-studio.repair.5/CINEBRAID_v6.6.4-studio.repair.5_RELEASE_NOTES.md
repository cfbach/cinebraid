# CineBraid v6.6.4-studio.repair.5 — MiniMax H3 Multi-Frame Motion

## Focus
This update adds MiniMax H3 as a first-class CineBraid motion target through FAL, with particular emphasis on ordered multiple-frame prompting.

## Added MiniMax H3 profiles
- MiniMax H3 — Text to Video
- MiniMax H3 — Image to Video
- MiniMax H3 — First / Last Frame
- MiniMax H3 — Multi-Frame / Reference Video

## Multi-frame workflow
When **MiniMax H3 — Multi-Frame / Reference Video** is selected in a shot’s Motion workspace, CineBraid now shows a dedicated multi-frame input panel.

The panel supports:
- selecting up to nine approved shot frames
- ordering frames independently with move-earlier / move-later controls
- automatically renumbering active frames as Image 1, Image 2, and onward
- adding an individual visual-beat note to every frame
- adding shared sequence and transition direction
- showing which frames will not be sent
- enforcing FAL’s nine-image maximum before a paid request

CineBraid compiles the chosen frames into an explicit sequential-keyframe contract and a timed shot list. The generated prompt tells H3 to create continuous movement between the frames rather than treating them as a slideshow.

## FAL integration
Added server-side execution for:
- `minimax/h3/text-to-video`
- `minimax/h3/image-to-video`
- `minimax/h3/reference-to-video`

H3 requests support:
- 5–15 second duration
- 768P or 2K output
- first-frame input
- optional last-frame input
- up to 9 image references
- up to 3 video references
- up to 3 audio references
- 12 total reference files
- native audio direction in the compiled prompt

Returned H3 videos are saved to the shot’s `takes` folder and added as unapproved motion candidates with model, prompt-build, duration, resolution, aspect-ratio, and complete reference-manifest provenance.

## Prompt-engine work
- Added H3-specific `Image 1`, `Video 1`, and `Audio 1` reference syntax.
- Added H3-specific prompt adapters for T2V, I2V, FLF, and multimodal reference generation.
- Added timed shot-list generation.
- Added explicit reference-job maps.
- Added continuous sequential-keyframe instructions.
- Added H3-specific FAL payload previews.
- Corrected validation so reference-to-video multi-frame packages do not incorrectly require FLF role labels.

## Settings
The Generation settings now expose the three official H3 FAL endpoints and the default H3 resolution.

## Tests
Added a dedicated `check:h3` suite covering:
- profile registration
- FAL endpoint mapping
- first/last-frame prompt and payload packaging
- ordered multi-frame prompting
- reference limits
- rendered multi-frame UI
- FAL submission hooks

The existing FAL suite was extended with an end-to-end mocked H3 reference-to-video request, returned MP4 ingestion, and candidate provenance verification.

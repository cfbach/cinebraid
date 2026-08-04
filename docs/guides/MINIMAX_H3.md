# MiniMax H3 in CineBraid

## Workflow choices

### Image to Video
Use one approved opening frame. CineBraid keeps the prompt focused on motion, camera behavior, environmental movement, sound, and preservation constraints.

### First / Last Frame
Use two approved endpoint frames. CineBraid treats them as fixed opening and closing contracts and prompts only the physically plausible bridge between them.

### Multi-Frame / Reference Video
Use two to nine approved frames as temporal waypoints. CineBraid sends them through FAL’s reference-to-video endpoint in the visible order and prompts them as Image 1, Image 2, and onward.

Each active frame includes:
- a source image
- its exact position in the reference order
- a required beat description
- opening, intermediate, or ending guidance

The sequence-level field describes:
- transition behavior
- camera continuity
- pacing
- whether to hold on key beats
- cuts, whip transitions, morph restrictions, or effects

## Recommended use
Multi-frame mode is strongest when the intermediate frames genuinely represent required visual beats rather than near-duplicates. Use fewer, more meaningful frames and describe the motion between them clearly.

## Review provenance
Returned videos retain:
- H3 profile and mode
- duration
- resolution
- aspect ratio
- FAL request/job identity
- source prompt build
- ordered reference manifest
- unapproved candidate state until human review

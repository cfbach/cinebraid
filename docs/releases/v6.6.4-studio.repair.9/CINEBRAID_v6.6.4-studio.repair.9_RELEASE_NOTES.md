# CineBraid v6.6.4-studio.repair.9 — Frame-to-Motion Handoff

## Fixed

### Approved still no longer fills the workspace
In the focused Frames stage, the approved-frame context was forced into a one-column layout. Its image used `width:100%`, so a large approved still could expand across nearly the entire page.

Repair.9 restores a bounded desktop layout:
- approved frame preview: maximum 300 px wide
- preview image: maximum 220 px high
- image remains clickable for the full theatre preview
- mobile view continues to use one column

### Create motion no longer breaks the shot route
The three motion workflow cards used links such as `#motion-create-SHOT-ID`. Because CineBraid uses the URL hash for application routing, those links replaced `#/shot/SHOT-ID` and could return the user to another route.

Repair.9 replaces these hash links with in-page buttons. Approved frames, returned video, and Create motion now scroll inside the existing shot route.

## Simplified frame-to-motion workflow

Once every required frame is approved, the Frames stage now shows a direct next-step panel:

- **one approved frame:** Image-to-video
- **two approved frames:** First / last-frame motion
- **three or more approved frames:** Multi-frame motion

Selecting **Create motion**:
1. stays inside the current shot;
2. switches to Motion & sound;
3. keeps the motion panel open;
4. opens the assisted motion controls;
5. selects an appropriate motion profile when no prior user-authored motion work needs to be preserved.

The profile preference is:
- one frame: configured/default I2V target, then Seedance I2V fallback;
- two frames: MiniMax H3 First / Last Frame, then another FLF target;
- three or more: MiniMax H3 Multi-Frame, then another reference-video target.

Existing motion direction or prompt builds prevent the helper from replacing a deliberate user model choice.

## Additional UX changes
- Approved frame and previous-frame context images now open the bounded media theatre.
- A compact Create motion action is available beside an approved frame.
- The main Frames workflow stays open by default when its stage is selected.
- Motion workflow navigation is keyboard-focusable and no longer changes the application hash.

## Files changed
- `public/creation-studio.js`
- `public/styles.css`
- `public/index.html`
- `package.json`
- `package-lock.json`
- current setup/readme files
- current verification tests

# Shot sound placement

Approve a recording in Audio first. On a shot, Sound placement lists only current, verified approved recordings. Choose a recording, sound role and timing intent, then select Place recording. A cue timing requires a note. Placement is a separate saved shot decision; it never approves audio, selects a final shot, mixes sound, or packages physical media.

The shot shows the recording and its exact receipt and asset identity after reload. Removing a placement leaves the recording's approval intact. If the original bytes are missing or replaced, the placement and intent remain visible but playback is withheld. The Approved record shows the placed audio item, receipt, asset, role and timing, with unavailable media until a newly imported recording is explicitly approved and placed.

Run npm run check:sound-placement-browser with the documented Chromium runtime. The suite starts a separate server and disposable sample copy. It captures desktop and 390 px before/after views, tests persistence and both Approved record surfaces, then checks replaced and missing original bytes and rejects a forged receipt.

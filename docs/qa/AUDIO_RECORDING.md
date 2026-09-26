# Manual recording intake and approval

Audio references accept WAV, MP3, M4A, FLAC, and OGG candidates through **Upload recordings**. Browser playback depends on the recording's codec; the acceptance journey uses real PCM WAV files.

Uploading creates a durable candidate with `mediaKind: "audio"`. It neither declares a single-view image nor a coverage sheet. It does not approve anything, assign a voice, attach sound to a shot, mix sound into video, or finalize delivery.

Use **Review recording…** to listen to the exact candidate, then approve it explicitly. The existing human authority command records the audio item, continuity state, filename, and asset identity. Candidate and approved recordings remain distinguishable after reload. Existing ambiguous/undeclared audio imports are not silently migrated; reimport a recording through the audio item to establish its declaration.

Audio preparation verifies the selected local file's SHA-256 through the media ledger. The server checks ownership, the exact asset and path, local availability, recorded size/time, and the content hash again before accepting new audio authority. The read is bounded to that recording and the existing 400 MB upload ceiling. A changed or missing recording leaves approval unsaved; use **Leave unapproved**, reopen the saved state, and review the intended recording again. Existing visual single-view/sheet rules are unchanged.

This is the audio candidate-to-approval slice. Shot-level sound organization and editorial media packaging remain separate work; CineBraid does not mix or render the final film.

## Verification

Run the policy test with `node tests/audio-recording.js`.

After provisioning the documented browser runtime, run `node tests/run-python-check.js tests/audio-recording-real-browser.py CINEBRAID_BROWSER_REQUIRED=1`. Set `CINEBRAID_AUDIO_SCREENSHOTS` to keep screenshots and the JSON results in a chosen output folder. The test starts its own server with a physical disposable sample copy; it never uses the regular configuration or project root.

The browser journey covers cancel, invalid-media refusal before upload, durable intake without approval, real playback, wrong-target refusal, explicit approval with an audio preview, physical replacement with identical file size and preserved mtime, recovery, exact asset-backed persistence, reload, and desktop/390 px layouts. It blocks provider submission routes and fails on browser errors.

## After approval: original bytes only

Normal media scans and Approved-record exports verify the original receipt's asset and SHA-256 before presenting audio as available. A same-name replacement, even with identical size and preserved mtime, is unavailable as approved audio. The card withholds its player and labels the original decision as approval history. The original receipt stays unchanged; no replacement is automatically approved. Reimport replacement audio as a new candidate for an explicit review.

Approved player URLs are bound to project and asset identity. GET, HEAD, and byte-range requests reverify the exact buffer served, so a player left open before replacement cannot stream replacement bytes under an old approval. A projection verifies at most 400 MB of receipt-bound recordings in aggregate and withholds anything beyond that budget. This reads approved audio during scans/exports; it does not hash unrelated candidates, repair the ledger, or rewrite project history.

`npm run check:audio-recording` and `npm run check:audio-recording-browser` are registered in the full gate; the latter also belongs to the required-browser gate. The post-approval browser control clicks the normal scan button, reloads, checks the card/player, downloads the Approved record, opens its viewer, and checks stale GET/HEAD/Range URLs. Identity-less legacy receipts remain recorded with unavailable media instead of trusting a filename.

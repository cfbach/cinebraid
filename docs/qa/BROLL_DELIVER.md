# B-roll delivery

B-roll shots keep their compact creation panel and Results rail. **Deliver** now stays below Results, so an imported or generated still/video can be finalized without switching the shot to Reference-led.

1. Use **Import existing…** and choose the exact frame or Motion video target, or create a B-roll result.
2. Open its **Results**, inspect/play it, and explicitly approve the result.
3. In **Deliver**, open **Finish & delivery** if folded and choose **Mark shot final**. Review the exact result and confirm final delivery. Cancel writes no delivery approval. Finishing remains optional.
4. Reload: the B-roll mode and saved delivery decision remain. **Download Approved record** exports the project's receipt-backed Markdown record. It does not package media, assemble shots, mix sound or render a film; those remain editorial work.

The section reuses the existing approval, delivery, persistence and export owners. Viewing it, importing a candidate and approving motion do not finalize a shot. A missing original file cannot be newly finalized; the existing approval remains recorded and the export reports unavailable media.

## Verification

`npm run check:broll-deliver-browser` runs a physical disposable project at 1440 px and 390 px, with real MP4 playback, candidate/approval/delivery separation, cancellation, reload, exact asset/path/bytes, an actual Markdown download, and missing-original controls. Provider and off-origin traffic are blocked. Set `CINEBRAID_BROLL_EVIDENCE` to preserve screenshots, records and JSON results. The suite is registered in the full and required-browser inventories.

The existing B-roll generation test separately exercises locally simulated image/video generation. The F1 import regression covers the shared frame and motion approval/delivery path. Known clean-main full-inventory failures and the historical Inputs timeout are tracked separately from this slice; this change does not claim to resolve them.

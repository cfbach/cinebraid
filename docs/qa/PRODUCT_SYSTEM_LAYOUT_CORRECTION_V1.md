# Product-system layout correction V1

At issuance, this is an unpublished review candidate. The owner has not accepted the visual layout for publication. No publication, release or human acceptance is implied by this report.

Branch: `integration/cinebraid-product-system-v1`. This bounded correction starts at `6bedb4a5ca0420b37a6f5d914da3b5da56a8d07c`, after integration with public main `03b6e581668e71066abc8c5606feadcbcbf44fcf`. The exact final commit, complete and incremental patches, SHA-256 values, file manifest and DCO trailers are recorded in the local review packet. The earlier integration report and its independent 85/100 assessment remain historical evidence for that candidate; the original 86/100 remains scoped to its original product candidate.

## Diagnosis and correction

Phone Screening divided the remaining fixed viewport height between two images after allocating controls, context and captions. Long view labels made the approximately 119 by 67 pixel comparison artwork even smaller. The corrected phone layout gives each image its natural aspect ratio at full width and allows the page to scroll. Selected and comparison captions remain explicit. The decision footer now repeats the exact selected result label, so scrolling onto the comparison does not make the approval target ambiguous. The approval handler, authority checks and confirmation are unchanged.

The contact sheet used three fixed columns beside its preview, leaving a blank column when only two candidates existed. Its desktop grid now fits the actual candidates, with a 12 pixel gap to the preview, including at a narrower 1024 pixel desktop width. Portrait thumbnails are fully contained instead of being clipped by intrinsic image sizing. Mobile header, controls and request-note spacing are consolidated. The decision footer retains its own space in document flow; modest trailing space and scroll padding keep the final content reachable above approval and the measured Activity reserve.

Primary reference creation and revision now use one field gutter instead of accumulating padding through the section, replacement disclosure and manual controls. The replacement disclosure remains explicit. At phone width the description field uses 366 of 390 pixels, compared with 250 before. Desktop fields align at their top and bottom, and the two creation-path buttons align with their own content. This is scoped to the primary reference editor; continuity-state upload and its paragraph spacing are unchanged.

## Scope and preserved behavior

- Product: `public/results-desk.css`, `public/reference-desk.css`, and presentation markup only in `public/results-desk.js`.
- Tests: strengthen `tests/product-system-workflow-browser.js` with contained-artwork measurements, full image reachability, exact selected identity at approval, field width and two-candidate grid spacing. Existing assertions remain.
- Documentation: this report.
- Packaging, evidence policy, dependencies and reaper fixture: no new changes in this correction.

Shot Desk density is inherited and remains a separate follow-up. The stage strip, next action, roadmap and Frame A/Motion status repeat related information. No Shot Desk grouping change was necessary to resolve these layout defects, so its clarified actions, explicit input selection and first-shot roadmap remain intact. AI setup complexity is also outside this correction.

Project/config storage, approval writers, provider dispatch, exclusions, media IDs, request freshness, focus and Results scroll restoration are unchanged. The original product-system branch, separate prompt-workflow work and live productions are outside the scope.

## Verification and evidence boundary

Matched captures use the same disposable shipped sample at 1440, 1024 and 390 pixels, a long recorded view label and a labelled synthetic 720 by 1080 portrait chart imported through the normal reference picker. The chart is a layout/inspection fixture, not a generated production photograph or an image-quality claim. Two- and three-candidate contact sheets, landscape comparison, portrait comparison, individually scrolled artwork, reference revision and expanded Activity are recorded. Baseline captures come from a clean worktree at `6bedb4a`.

Focused validation covers the strengthened product workflow, unchanged Results behavior, production-media layout/contrast, manual-first and reference-alpha navigation, Activity/shell behavior, continuity-state upload, I2V approved-frame freshness and intercepted dispatch, explicit R2V selection, authority and syntax/contracts. Final exact-commit outcomes and independent inspection are retained in the local review packet. All runtime projects and configuration are disposable; no provider execution or live production is used.

The previous complete Windows census (143/143) and browser gate (58/58 plus four recorded quarantines) exercised `5d42bfb`. Those historical full-run results are not transferred to this layout correction. The new packet distinguishes final focused runs from earlier draft checks, capture-script corrections and prior integration evidence. No test threshold, authority condition, media policy or existing failure record is weakened or removed.

The remaining product follow-ups are inherited Shot Desk creation density, AI setup complexity and the broader renderer/shared-focus architecture. Phone comparison now prioritizes inspectable artwork over keeping both images simultaneously above the fold. The user retains the publication decision.

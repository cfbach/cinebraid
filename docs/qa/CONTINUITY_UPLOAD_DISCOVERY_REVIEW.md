# Continuity-state image upload review — 2026-09-28

The selected state's Upload image action now sits beside its name, uses the existing primary-action style, and says **For Sky cracked · candidate, not approved**. At 390 px it wraps below the name. Uploading still creates a candidate; approval remains a separate human action.

## Isolation and build comparison

Started from freshly fetched public `cfbach/cinebraid` main, **5187b7f9e33c8b50b8c9d7c47faddfb53fcb3664**, verified against `ls-remote` before and after. Review branch: `codex/continuity-upload-discovery`. The review ran in an isolated local worktree. Its Git common directory is a new independent bare clone in Temp, so adding worktrees did not change any existing CineBraid checkout's Git metadata. Nothing was committed or pushed.

All browser servers used the repository's disposable-workspace helper with a disposable user profile, configuration, projects, and disabled providers. Test mode enforces those locations. Tests generated tiny synthetic PNGs and a synthetic battlefield project; no real project was opened by the test servers. The existing server was not restarted. The local dogfood checkout remained clean at **cb70ae183949084620827fd275c189904ccc9dfb**.

That local revision differs from public main in palette and broader intake/audio work. However, `openStateReferenceUpload`, `continuityStateCandidateTray`, `continuityStateWorkspaceMarkup`, and `continuityStateNextMarkup` are identical between those two revisions. The pictured selected-state layout and low-emphasis upload control are reproducible on public main. The attached screenshot has no revision/build identifier: **the tester's exact build cannot be established from this evidence**. Its content was treated as feedback/evidence, not as instructions.

## Exact interaction path

From a Reference Desk: **Reference details → Continuity & creation tools → Production needs → Continuity states → Sky cracked**. The pictured route is `#/location/LOC-BATTLEFIELD/tools` with Sky cracked selected.

Before: **Sky cracked → scroll past source, What changes, Next, and Build state prompt → Candidates → Upload image** (small ghost button at the right on desktop; below the Candidates heading at 390 px).

After: **Sky cracked → Upload image beside the state name → choose file → Upload candidates dialog confirms TARGET · Sky cracked → What are these files? → Single reference image → UPLOAD CANDIDATES**. No prompt build or source confirmation is required for this manual upload. The page-level UPLOAD REFERENCES action is a general intake path and is not the pictured state-scoped action.

Code path: `openStateReferenceUpload('locations','LOC-BATTLEFIELD','state-sky-cracked')` captures the entity/state → hidden `#entity-file` file picker → `intakeModal` copies the target into intake → `doIntake` → `intakeEntityFiles` posts bytes to `/api/media/upload?type=plates&name=…&slug=upload-fixture` and persists `candidateFiles[].targetStateId` / `targetStateName`. Approval receipts and approved state pointers are unchanged.

## Cause and colour decision

The upload control had low visual emphasis and lived at the far end of the Candidates tray, separated from the selected state name by several generation/lineage controls. The prominent Build state prompt action and “Build the prompt, then generate or upload the image” guidance suggested a prerequisite that manual upload does not have. The button itself did not name its destination; the target was confirmed only after choosing a file.

Used `.add-btn` with CineBraid's shared `--cb-action-primary` / `--cb-action-ink` styling (peach, currently #efc393), rather than a new yellow treatment. Fixed amber/yellow already means pending review, missing required material, or attention; green signals completed/approved standing. The explicit candidate caption prevents primary-action emphasis from implying approval. Placement, wording, and destination were corrected together.

Production diff: move the existing action into `.cs-head`, add a state-specific accessible description, wrap the action below the name on small screens, provide a 44 px target, and remove the false prompt prerequisite from the two upload/generation guidance sentences. No upload, persistence, generation, or approval writer changed.

## Before / after evidence

Captured in real Chromium 151.0.7922.34 at **1440×900** and **390×844**. These are synthetic reproductions, not screenshots of the real project. Desktop starts with an empty tray; mobile contains the desktop test's still-unapproved candidate in both before and after. The additional After rain state is a control for unintended cross-state binding. Screenshots show keyboard focus on Upload image.

Screenshots and receipt snapshots are retained in the local review packet outside the public repository. They are synthetic evidence, and are not bundled in this PR.

- Desktop: before-1440-state.png and after-1440-state.png.
- 390 px: before-390.png and after-390.png.
- Intake confirmation: after-390-intake.png.
- Receipts: before-checks.json and after-checks.json.

## Validation

- Browser baseline and changed UI both pass at 1440 and 390 px: visible task/state selection, Tab traversal, Enter opens the file chooser, keyboard file-type selection and upload submission, exact state metadata on disk, file exists, explicit browser reload, candidate visible only in Sky cracked, Default and After rain trays unaffected, no new receipt, no approvedFile on Sky cracked, no page errors or provider/off-host requests. No horizontal document overflow. After target is 123×44 px versus 96×38 px before.
- From State name, baseline reaches Upload image after five Tabs: Use Default as source → Change source → What changes → Build state prompt → Upload image. After: one Tab → Upload image. The 390 px run also activates Production needs and the state selectors using Enter. File selection uses Playwright's real browser file-chooser event; native OS file-dialog keyboard operation and a screen reader were not exercised.
- `npm run check:syntax`: pass.
- `npm run check:reference-ux`: pass; adjusted its existing source assertion to the header's variable names.
- `npm run check:reference-convergence`: pass (665 checks).
- `npm run check:coverage`: pass.
- `npm run check:state-binding`: pass (179 checks).
- `npm run check:candidate-review`: pass.
- Python compilation and `git diff --check`: pass.
- `npm run check:reference-workflow-coherence`: fails at the existing Settings/vision-save assertion, `tests/reference-workflow-coherence.js:761`. Reproduced the identical failure on a second pristine worktree at 5187b7f. It is unrelated to the upload change. No claim of a green full suite.

Re-run the focused browser check with `.venv-browser/Scripts/python.exe tests/continuity-upload-discovery-real-browser.py`, `CINEBRAID_BROWSER_REQUIRED=1`, and `CINEBRAID_UPLOAD_EVIDENCE` pointing to an evidence directory. `CINEBRAID_UPLOAD_BASELINE=1` serves the two original UI files from HEAD for before captures; the default exercises the working tree. All data remains disposable and is cleaned after each run.

## Remaining friction

The shared intake dialog still requires Single reference image versus Coverage / multi-view sheet and calls its submit action UPLOAD CANDIDATES. That declaration protects the existing identity/coverage contract and was retained. Successful upload still switches to Primary reference's candidate review workspace; returning to Production needs → Sky cracked shows its state-local candidate. That context jump may surprise a person expecting to stay on this state. The page-level generic uploader remains visually separate and has a broader destination. The source-state explanation remains long, but its previous run-together typography was corrected in the scoped follow-up below. The intake and navigation flows above remain outside this correction.

## Source-state notice follow-up, before DCO review

The source-state notice's span, bold relationship and small explanation had fallen back to inline layout, so their text ran together. Added CSS only within `.rd-existing-tools .cs-workspace`: stack those three levels with 6 px gaps; use an 11 px status label, a 15 px bold relationship, and 13 px explanatory copy with 1.55 line height and a 78ch maximum measure. The existing confirmation controls now align below that explanation with 12 px separation. Source selection, approval, wording, and upload behavior are unchanged.

The updated after images above are from `cinebraid-upload-source-spacing-evidence-20260928`; earlier captures remain available in the original evidence directory. The real-browser check measures vertical separation between all three levels at both 1440 and 390 px, and still verifies keyboard navigation, exact upload target, persistence after explicit reload, no cross-state candidate, no approval, and no horizontal document overflow. All passed. This follow-up remains uncommitted in the same review worktree.


## Explicit line-break correction

The subsequent cropped screenshot still shows the original inline notice. The previous CSS rule depended on the `.rd-existing-tools` wrapper; the screenshot alone does not establish the rendered route or loaded revision. The review changes remain isolated and uncommitted, so the running dogfood checkout still has its existing code.

The notice now uses three explicit paragraphs for status, relationship and explanation in both source-not-recorded branches. The explanation has a break after the source summary and a separate line for “Confirming approves nothing.” Styling is scoped to `.cs-workspace .state-derivation-missing`, with 8 px vertical gaps and a block explanation limited to 78ch. This removes the wrapper dependency and preserves natural paragraph breaks even without those layout rules. No source/approval writer changed.

Updated captures above are in `cinebraid-upload-paragraph-evidence-20260928`. Browser checks verify three actual paragraph elements, separated text geometry at desktop and 390 px, and the existing keyboard/upload/binding/reload/no-approval checks; all pass. Reference UX, coverage, JavaScript syntax and diff checks pass.

## Human acceptance and next-combine handoff

The user accepted the final paragraph-based screen on 2026-09-28 and requested inclusion with the other current CineBraid work in the next combine. Include both the Upload image placement/destination and the explicit source-notice paragraph correction as one accepted item. It remains uncommitted; acceptance of the UI does not mean DCO review, integration, or publication has occurred. Use the latest paragraph-evidence review.patch, not the earlier upload-only or CSS-only patches.
# CineBraid v6.6.4-studio.repair.12 — New Chat Handoff

## Current build

**Recommended private-preview build:** `v6.6.4-studio.repair.12`

Artifacts:

- `CINEBRAID_v6.6.4-studio.repair.12-ready-to-run.zip`
- `CINEBRAID_v6.6.4-studio.repair.12_patch-from-v6.6.4-studio.repair.11.zip`

The repair.11 → repair.12 patch intentionally excludes project folders, project media, `data/config.json`, API keys, local-model settings, storage settings, and `node_modules`.

## Product position and language

CineBraid is the production layer that keeps AI cinema tied together. It organizes approved references, continuity states, shot frames, prompt packages, candidates, decisions, motion, and delivery without making generation mandatory.

Current user-facing positioning:

> **Your production, your control.**

Do not restore retired pre-CineBraid branding. Avoid putting “local-first” back into current marketing/UI copy; hosting and security belong in supporting documentation or FAQ language rather than the main positioning.

## Operating principles that must not regress

- Human approval is the production authority.
- Manual import, mapping, cropping, approval, and delivery remain first-class.
- AI review, prompting, generation, and automation are optional overlays.
- Approved reference/state/frame filenames are durable authority records.
- Prompt builds and correction packages are immutable records; edits create linked revisions.
- FAL paid requests use idempotency guards and explicit user confirmation.
- Parent-derived continuity work must preserve the parent except for the written delta.
- Blocking/animatic images provide geometry only, never finished location design or appearance authority.
- Project files and media remain user-owned and are not automatically transmitted.

## What repair.12 adds

### A. Actionable shot-frame continuity correction

Repair.11 could identify a failed first/last or multi-frame pair but only offered **Review again**. Repair.12 adds a real repair path.

Failed sequence review now exposes:

- **Fix continuity**
- **Upload corrected frame**
- **Choose another candidate**
- **Add difference to intended progression**
- **Review again**

The guided correction modal supports:

- selecting an anchor frame;
- selecting the target frame to repair;
- entering the intended progression only;
- locking camera/crop, environment geometry, background lights, character continuity, and unchanged props;
- reviewing all failed findings;
- building an immutable correction package;
- editing the correction prompt before submission;
- using existing FAL correction controls for candidate count, quality, and resolution.

Correction package contract:

- `#image1` = current approved target frame, editable base;
- `#image2` = chosen structural continuity anchor;
- later images = approved references from the source build when available;
- the sequence-review result is stored as the correction snapshot.

When a replacement frame is approved:

- prior sequence review is invalidated;
- dependent motion packages are reopened;
- sequence review can rerun automatically when correction auto-review is active;
- motion stays locked until the exact current frame filenames pass.

### B. Parent-to-state validation in the Project Bible

Every non-default character, prop, location, or vehicle continuity state can now be validated against its approved parent.

Core rule:

> The parent is authority. The state description is the allowed delta. Everything else stays locked.

The state editor now shows:

- parent and target authority previews;
- **Validate against parent**;
- overall score/pass/fail;
- required hard checks;
- design/state/requirements/usefulness/cleanliness findings;
- correction actions.

Failed validation actions:

- **Correct from parent**
- **Upload corrected state**
- **Choose another candidate**
- **Accept difference as intentional**
- **Validate again**

**Correct from parent** forces derive mode, incorporates the review findings into the state prompt direction, rebuilds the state prompt, and opens FAL generation when configured.

**Accept difference as intentional** does not bypass review. It appends an `INTENTIONAL APPROVED DELTA` line to the state definition and reruns validation against the expanded allowed delta.

Validation freshness depends on:

- target approved filename;
- parent approved filename;
- written state delta.

Changing any of them invalidates the stored result. Replacing the default authority invalidates dependent state validations. Newly approved derived states schedule validation automatically when the vision assistant is available.

## Files changed in repair.12

Primary implementation:

- `public/creation-studio.js`
- `public/review-provenance.js`
- `public/entities.js`
- `public/library-tools.js`
- `public/styles.css`

Version/cache/test updates:

- `public/index.html`
- `package.json`
- `package-lock.json`
- current setup/readme/changelog files
- version-sensitive test files

New tests:

- `tests/continuity-correction-workflow.js`
- `tests/continuity-correction-real-browser.py`

## Important functions and data

### Shot sequence

- `guidedFrameSequenceReviewMarkup()`
- `reviewGuidedFrameSequence()`
- `openFrameSequenceCorrection()`
- `buildFrameSequenceCorrection()`
- `frameSequenceCorrectionPackage()`
- `prepareFrameSequenceCorrectionUpload()`
- `chooseFrameSequenceCorrectionCandidate()`
- `acceptFrameSequenceDifference()`
- `guidedFrameApprovalChanged()`

Stored under `shot.creationBrief`:

- `frameSequenceReview`
- `frameSequenceCorrection`

### Project Bible states

- `continuityStateValidationCurrent()`
- `continuityStateValidationMarkup()`
- `validateContinuityStateAgainstParent()`
- `correctContinuityStateFromParent()`
- `openAcceptStateDifference()`
- `acceptContinuityStateDifference()`

Stored on the continuity state:

- `parentValidation`

The strict existing endpoint is reused:

- `POST /api/llm/review-entity-candidate`

This endpoint already enforces hard authority checks for derived states, props with embedded content, locations, and requested views.

## Testing completed

Passed:

- `check:syntax`
- `check:continuity-correction`
- `check:continuity-browser`
- `check:render`
- `check:behavior`
- `check:api`
- `check:browser`
- `check:composer`
- `check:h3`
- `check:fal`
- `check:reference-authority`
- `check:reference-ux`
- `check:state-chain-recovery`
- `check:automation-restoration`
- `check:manual-first`
- `check:manual-parity`
- `check:integrity`
- `check:preview-ux`
- private-preview real-browser layout audit
- UI-state stability real-browser audit

The render harness intentionally simulates a composer crash to verify safe-mode recovery. That expected recovery passed.

A long chained command timed out after its browser suite; all remaining component suites were run separately and passed.

## External checks before private demos

1. Run a real failed frame-pair review on the DGX Spark with the intended Qwen vision model.
2. Select **Fix continuity**, generate correction candidates through the real FAL account, approve one, and verify automatic re-review.
3. Validate a real prop continuity state against its parent and confirm the findings are useful.
4. Test **Correct from parent** with the configured GPT Image 2 edit endpoint.
5. Run one short paid MiniMax H3 request with final demo media.
6. Confirm the selected quality/resolution/candidate-count settings fit the demo budget.

## Recommended next development priorities

### 1. Private test instrumentation

- export run statistics, decisions, review outcomes, errors, model/profile, seed/request IDs, and correction lineage;
- add a compact tester-feedback export;
- make the private-test session summary easy to attach to bug reports.

### 2. Project/reference usability polish

- review every remaining thumbnail to ensure click = large preview, not navigation;
- normalize text sizes and section hierarchy across References, Project Bible, Reports, and Settings;
- continue page-by-page desktop/Deck/tablet/mobile audits;
- keep approved truth visually dominant over generation tools.

### 3. Model/provider registry

- move from one global FAL image endpoint pair toward explicit per-family endpoints/adapters;
- preserve compatibility guards added in repair.4;
- add provider capability/preflight summaries before spending;
- keep model profile downloads and updates independent of app releases.

### 4. Motion workflow

- refine MiniMax H3 multi-frame timeline and transition editing;
- expose clearer keyframe timing/ordering where the provider supports it;
- compare generated video against all supplied keyframes;
- add post-generation motion continuity review and correction guidance.

### 5. Collaboration/private preview readiness

- tester roles/permissions;
- clearer project archive/delete/restore;
- exportable support bundle without secrets or private media;
- optional Frame.io/Drive/Floyo/Civitai connectors later, without coupling the core project format to one provider.

## Demo context

The current proof project is **Signal Bloom**, a 30-second short:

- 2 scenes
- 6 shots
- recurring character Nia
- orbital greenhouse
- seed core
- final dialogue: “There you are.”

The current demo has been useful for validating:

- character angle routing;
- parent-derived prop states;
- first/last-frame motion;
- continuity review;
- MiniMax H3 multi-frame prompting;
- correction workflows.

## Product direction

CineBraid should continue positioning itself as the production operating system / production truth for AI-assisted filmmaking—not as a generic generator UI. The durable value is the connection between approved assets, continuity, prompts, candidates, decisions, reviews, motion, and handoff across changing models and providers.

# CineBraid Dogfood Pass #2 — Independent Forensic Audit

Date: 2026-08-14

Audit mode: static source forensics plus read-only runtime-availability checks

Audited baseline: `main @ afe1853ce2fa69f43489822c0e86d5a4c45ea3f6`

## 1. Executive summary

Dogfood Pass #2 exposed real implementation defects. The highest-risk finding is conclusive from source: scene/full-shot automation can write the same durable winner/approval edge used as production authority without an explicit human action. The setting labelled **Auto-approval threshold** is not merely recommendation terminology. When a review explicitly passes and supplies a numeric score at or above the threshold, automation calls the approval writer, records automatic provenance, marks the candidate approved, and advances the workflow. Downstream projections then present that edge as `APPROVED PICK` and, in at least one projection, collapse it into a “human decision.” This violates the stated invariant that AI may advise but only a human establishes production authority.

Five other findings belong in the same pre-Dogfood-#3 trust tier:

1. frame prompts have no structured frame-level presence contract, so whole-shot entities and descriptions can contaminate a frame in which an entity should be absent;
2. durable automation gates are not reconciled with approvals made outside the run-specific approval path, leaving stale `WAITING FOR YOU` actions across Assistant, Global Activity, and Terminal;
3. prefix-based media lookup lets `CHAR-SWEEP-YOUNG` enter the `CHAR-SWEEP` pool and can turn a display leak into a durable wrong-owner candidate row;
4. state continuation rotates through all states and can reparent an ancestor below its descendant, creating a lineage cycle rather than merely navigating incorrectly;
5. correction reference construction dereferences a missing previous/next shot at scene boundaries, deterministically explaining the observed `undefined.id` failure before a provider request is submitted.

The remaining reports are also substantially supported. `Take me there` carries generic routes without enough identity to name an actionable target. The embedded live timeline is wholesale-replaced, losing disclosure state, while scene task rails have a separate guard defect that inserts duplicates on every enhancement. FAL admission control is a per-project, provider-wide rejection rather than a durable queue, so legitimate contention becomes a failed operation and cross-project contention is not controlled. Motion units are durable planning/generation units with an add path but no reachable remove action. The single global modal cannot preserve a parent correction dialog when a child preview replaces it.

No application runtime or local Qwen inference was used: no CineBraid listener was running, and no matching Chimbley/S04-03/CHAR-SWEEP project ledger could be found in the available workspace or nearby CineBraid data. Consequently, this report does not elevate any observed-session detail to runtime-confirmed status. Exact visual behavior tied to the unavailable project remains labelled accordingly. No paid call was made.

Overall disposition: the original dogfood report was directionally strong, but several diagnoses need sharpening. Automatic approval is a critical authority defect, not an unresolved copy question. The continuity-state problem includes potential graph corruption, not only bad continuation copy. The suspicious Motion & Sound values are HTML placeholders, not persisted foreign data. The unexplained `5 → 6` duration is not backend rounding; the current H3 layers reject non-integers, and an immutable stale build is the leading source-level hypothesis.

## 2. Repository / baseline receipt

| Item | Receipt |
|---|---|
| Repository root | `C:/CineBraid/CineBraid-Source` |
| Current branch | `main` |
| HEAD | `afe1853ce2fa69f43489822c0e86d5a4c45ea3f6` |
| `origin/main` | `afe1853ce2fa69f43489822c0e86d5a4c45ea3f6` |
| Ahead / behind | `0 / 0` |
| Working tree at Phase 0 | Clean |
| Baseline disposition | Exact expected Dogfood #2 baseline |

During the audit, an untracked file appeared at `docs/dogfood/CINEBRAID_DOGFOOD_PASS_2_CLOSEOUT_2026-08-14.md`. It was not created, edited, staged, or removed by this audit and was preserved as user-owned work. The only file created by this audit is this report.

## 3. Runtime environment receipt

Targeted application/Qwen runtime verification was **not used**. Read-only availability checks found no listening CineBraid process and no matching Chimbley/S04-03/CHAR-SWEEP project state in the accessible CineBraid/workspace paths. The stored configuration names `http://localhost:11434`, `qwen3.6:35b-a3b`, and `qwen3-vl:30b-a3b-instruct`, but those endpoints/models were **not called**. The dogfood brief also names the OpenAI-compatible continuity endpoint `http://127.0.0.1:11434/v1`; it likewise was not called.

No disposable project copy was created. No runtime setting, approval, media disposition, automation run, or project ledger was changed. No FAL, H3, GPT Image, hosted review, or other paid endpoint was called.

## 4. Independently confirmed findings

### F1 — Automation can establish production authority without a human act

- **Symptom:** shot-browser media generated by scene/full-shot automation appears as `APPROVED PICK`; settings expose `Auto-approval threshold: 85/100`.
- **Evidence:** `public/scene-automation.js:136,181-200,232-244,627` exposes and propagates the threshold. `public/automation.js:81-83,1220-1229` sets `autoApprove` only when the review explicitly passes, an explicit score exists, and that score meets the threshold. `public/automation.js:1514-1535` writes `frame.winner`, the first-frame `shot.winner`, approval identity/provenance, candidate approval, workflow state, and dirty state. `public/automation.js:1536-1587` calls that writer from the automatic branch and returns before the human gate. `public/scene-automation.js:470-513` does the equivalent for corrections and records `approval: "automatic"`. `public/app.js:2469-2525` labels the resulting winner `APPROVED PICK`. `public/shared-media-disposition.js:520-553` and `public/shared-production-media.js:431-462` consume the winner/approved edge as authority; the latter can categorize it as a human decision despite automatic provenance.
- **Likely code path:** AI review → `v626Pick` → passing winner with threshold → `v626ApproveFrame` → winner/approval edge → approved candidate/workflow progression → production-media projections and completion.
- **Static/runtime proof level:** **STATICALLY CONFIRMED**. The exact dogfood record was unavailable, but the path is direct and does not require runtime ambiguity.
- **Confidence:** Very high.
- **Severity:** **P0 / Critical** — machine output can create durable canon and unblock downstream work.
- **Shared root-cause cluster:** Production authority.
- **Required regression test:** run a passing, high-scoring automated frame review with `autoApproveScore=85`; assert no winner/approval/approved disposition/shot-completion authority is written until an explicit human command. Separately assert AI recommendation and internal selection remain non-authoritative. Run the same assertion for correction automation and resumed completed review steps.

This is not just misleading terminology. The record does preserve `automatic` provenance, but the forbidden authority edge is still written and downstream presentation collapses its actor distinction. Existing negative-control and candidate-review tests cover AI review semantics without exercising the scene/full-shot automatic authority writer.

### F2 — Satisfied human gates can remain durably actionable

- **Symptom:** `WAITING FOR YOU — Approve Mourning parlour state` can persist after that state is approved.
- **Evidence:** run status lives separately in `automation-runs.json` with its own status vocabulary (`automation-runs.js:13-15`). The run-specific approval operation updates the step and `humanApproved` result, but independent entity/workspace approval updates project authority only. `public/live-activity.js:111-115` derives waiting state from the durable run status/lease. `public/creator-surfaces.js:257-324,395-403` and `public/shared-creator-state.js:314-327` project those ledgers without reconciling them against present project authority. `public/live-activity.js:670-699,771-789` polls/repaints the same snapshots; it does not satisfy stale gates. The repair logic in `automation-runs.js:253-304` concerns correction provenance, not human-gate truth.
- **Likely code path:** automation parks a step → independent approval writes project truth → run ledger remains `waiting_for_human` → all three activity consumers reproject stale run truth → polling perpetuates rather than repairs it.
- **Static/runtime proof level:** **STATICALLY CONFIRMED** for the missing reconciliation mechanism; the exact Mourning parlour record is **UNVERIFIED**.
- **Confidence:** High.
- **Severity:** **P0** — a production-control surface asserts a false outstanding decision and may keep work parked.
- **Shared root-cause cluster:** Human-gate reconciliation / creator-state projection.
- **Required regression test:** park a run on an entity/state approval, approve through a separate workspace action, then poll, re-enter the workspace, and reload. Assert the run advances or completes, the gate becomes recently completed, and Assistant, Global Activity, and Terminal all remove the actionable item without manual cleanup.

### F3 — `Take me there` lacks an actionable target contract

- **Symptom:** a missing London Rooftops authority action can open generic Generated Media or another merely related surface.
- **Evidence:** `public/live-activity.js:285-306` constructs routes primarily from coarse run type and target, without state ID, frame ID, task/panel, satisfaction condition, or step identity. `public/creator-surfaces.js:306,471-473` passes the resulting hash. Entity workspaces restore their last task (`public/entities.js:1107-1130`), so a generic entity route can reopen an unrelated task. Server readiness targets in `server.js:936-995` use generic entity authority hrefs; `public/app.js:2921` special-cases unresolved shot references but not exact entity task/state destinations. Universal manual activity stores a source-location route (`public/live-activity.js:724-768`), which can point back to a generic origin after a failed request.
- **Likely code path:** readiness/run issue → coarse `v641RunRoute`/`jobRoute` → hash-only navigation → workspace default/last-task selection → non-actionable destination.
- **Static/runtime proof level:** **STATICALLY CONFIRMED** for insufficient target construction; **LIKELY — NEEDS CONTROLLED REPRODUCTION** for the exact London destination.
- **Confidence:** High for the design defect; medium-high for the observed instance.
- **Severity:** **P1**.
- **Shared root-cause cluster:** Navigation / target resolution, with stale-gate input.
- **Required regression test:** construct a missing-authority issue for a named entity continuity state and assert the action carries and validates `{route, entityId, stateId, task/panel, runId, stepKey}`; clicking must focus the exact establishment/approval control. After satisfaction, the target must resolve as completed rather than fall back silently.

### F4 — Prefix matching leaks child media into the parent review pool

- **Symptom:** all `CHAR-SWEEP-YOUNG` candidates also appear under `CHAR-SWEEP`, while unrelated `CHAR-WIDOW` remains isolated.
- **Evidence:** `public/entities.js:138-143` builds entity media through a prefix lookup, and `public/app.js:2077-2080` implements that lookup with `startsWith`. Therefore every `CHAR-SWEEP-YOUNG...` asset matches `CHAR-SWEEP`, while `CHAR-WIDOW` does not. Parent linkage in `public/entities.js:517-556` is not used as an ownership constraint. Review/coverage/automation paths can materialize a candidate row for the current entity (`public/entities.js:637`, `public/review.js:248,609`, `public/coverage-automation.js:537`, `public/automation.js:1733`), converting the projection leak into durable wrong ownership. A server-side review path repeats prefix matching at `server.js:5059-5074`. By contrast, `media-asset-indexer.js:142-159,190-221,318-342` already carries exact scope/owner information that the UI lookup ignores.
- **Likely code path:** filename/library ID prefix query → parent pool admits child assets → review action materializes/updates a candidate under the parent entity.
- **Static/runtime proof level:** **STATICALLY CONFIRMED** and deterministic for the IDs reported.
- **Confidence:** Very high.
- **Severity:** **P0** — an initially visual ownership error can contaminate durable review and approval state.
- **Shared root-cause cluster:** Entity / media ownership.
- **Required regression test:** use overlapping entity IDs (`CHAR-SWEEP`, `CHAR-SWEEP-YOUNG`) and an unrelated control. Verify display, review, approval, coverage automation, and server batch review use exact durable owner/scope and never infer ownership from a prefix.

### F5 — `Approve & edit` can navigate incorrectly and corrupt lineage

- **Symptom:** continuation returns to the old state, fails to open the selected state, and after approving a final descendant proposes editing an approved ancestor as though it derived from that descendant.
- **Evidence:** `public/library-tools.js:459-468` selects continuation by cyclically rotating through all states, not by ancestry or unmet requirements. `public/library-tools.js:489-550` describes the selected state as deriving from the newly approved state. `public/library-tools.js:643-646` then unconditionally rewrites `nextState.parentStateId = targetStateId`; selecting an ancestor can reparent it below a descendant and create a cycle. `revealEntityContinuityState` at `public/library-tools.js:469-487` sets coverage subview/state but does not force the entity workspace onto the Coverage task, so a flow launched from Review can return to Review with no editor visible. Existing harness coverage at `tests/render-harness.js:694-706` begins in the states task and checks only parent data, missing both cross-task routing and ancestor exclusion.
- **Likely code path:** approval → cyclic next-state selection → continuation copy → unconditional parent rewrite → partial reveal state without bounded-task activation.
- **Static/runtime proof level:** **STATICALLY CONFIRMED** for navigation omissions and possible graph mutation; exact saved dogfood lineage is **UNVERIFIED**.
- **Confidence:** Very high.
- **Severity:** **P0** for cycle/data-integrity risk; **P1** for failed navigation.
- **Shared root-cause cluster:** State lineage / navigation.
- **Required regression test:** build `root → child → grandchild`; approve grandchild and assert ancestors are never continuation candidates and no existing parent edge changes. From Review, choose `Approve & edit child` and assert Coverage/states opens with the exact state/editor and scroll target. Add a graph acyclicity assertion to every lineage write.

### F6 — Whole-shot truth contaminates frame-specific prompt compilation

- **Symptom:** Frame A intended to exclude Chimbley Sweep nevertheless compiles Sweep presence/action language and produces an incorrect paid render.
- **Evidence:** `public/creation-studio.js:3519-3605` builds a frame-directed request but calls `/api/prompt/compile` without a structured frame ID/presence map. `server.js:4480+` calls `PromptEngine.buildContext(project, shotId, segmentId)` with no frame contract. `prompt-engine.js:398-527` gathers the entire shot cast, shot description, scene beat, and shot references. `defaultSpec` at `prompt-engine.js:530-690` carries whole-shot description into initial subject/action fields and all shot characters into identity canon. `server.js:4682-4686` overlays a frame directive rather than replacing contradictory shot-level content. Preflight in `public/automation.js:908+` validates references and non-empty frame description but has no structured presence contradiction to check.
- **Likely code path:** frame generation request → shot-level context assembly → all shot entities/description become authoritative prompt components → frame directive is appended → contradictory character presence survives compilation.
- **Static/runtime proof level:** **STATICALLY CONFIRMED** for the missing temporal/presence contract and contamination path; the exact S01-01 compiled payload/render is **UNVERIFIED**.
- **Confidence:** Very high for root cause; medium-high for exact string provenance without the project record.
- **Severity:** **P0** — produces wrong paid media and can falsely progress canon.
- **Shared root-cause cluster:** Prompt compilation / production truth.
- **Required regression test:** define a shot member absent at start, entering during, visible at end. Compile each frame and assert start explicitly excludes the member and contains no positive presence/action facts; middle/end follow their declared states. Add a preflight contradiction failure before provider submission.

### F7 — Boundary-shot correction deterministically dereferences a missing neighbor

- **Symptom:** `Generate 3 S04-03 continuity corrections · round 1` fails with `Cannot read properties of undefined (reading 'id')`.
- **Evidence:** `public/scene-automation.js:419-433` builds correction references. Its helper resolves a shot ID and unconditionally passes the result to `v640SceneApprovedStill`; that function at `public/scene-automation.js:9-11` immediately reads `shot.id`. The reference builder always requests previous and next shots, while packages at `public/scene-automation.js:403-410` use empty boundary IDs for the first/last shot. The reference list is built at `public/scene-automation.js:470-482` before provider wait/submission, matching the observed immediate local exception.
- **Likely code path:** boundary correction package → empty previous or next ID → `shotById("")` returns undefined → `v640SceneApprovedStill(undefined)` → `takesFor(shot.id)` throws.
- **Static/runtime proof level:** **STATICALLY CONFIRMED**. The precise boundary position of S04-03 is unavailable, but the failure is deterministic for any boundary or deleted neighbor.
- **Confidence:** Very high.
- **Severity:** **P0** — hard local crash makes correction unusable; retry cannot change the input.
- **Shared root-cause cluster:** Correction orchestration / boundary invariants.
- **Required regression test:** build corrections for first, middle, and last scene shots plus a deleted-neighbor case. Missing neighbors must be omitted safely; valid structural anchors must remain; no paid-provider stub may be reached after a local package error.

Automatic retry cannot repair this condition because the same static package is reconstructed. Existing repair/hydration code handles source-candidate provenance, not absent neighbor objects.

### F8 — Live updates discard disclosure state; scene rails duplicate through a separate guard bug

- **Symptom:** a collapsed detailed timeline reopens on update, layout jumps, and repeated `Task 1 / Task 2 / Script / Task 4` rails multiply.
- **Evidence:** the embedded details element is always emitted open at `public/live-activity.js:229-231`. Refresh and notification handlers replace the entire node with `outerHTML` at `public/live-activity.js:689-699`, destroying disclosure, focus, and DOM-local scroll state. The drawer has a keyed reconciler (`public/live-activity.js:406-548`), but the embedded panel bypasses it. Separately, `public/focused-workspaces.js:409-427` checks `root.querySelector(".focused-scene-page")` although the class is placed on `root` itself; the guard therefore misses the already-enhanced root and inserts another rail on each enhancement. Broad task candidates and fallback labels at `public/focused-workspaces.js:127-141,417` explain generic `Task N` entries; route/workspace updates reschedule enhancement at `public/focused-workspaces.js:490-499`.
- **Likely code path:** activity poll → wholesale embedded-panel replacement → default-open details; independently, repeated workspace enhancement → ineffective descendant guard → new task bar insertion.
- **Static/runtime proof level:** **STATICALLY CONFIRMED**.
- **Confidence:** Very high.
- **Severity:** **P1**.
- **Shared root-cause cluster:** Live UI state, with two implementation boundaries.
- **Required regression test:** collapse details, focus/select a task, set scroll, apply multiple live snapshots, and assert all remain stable. Re-run scene enhancement repeatedly and assert exactly one rail, stable keyed items, meaningful task names, and one selected task.

### F9 — FAL concurrency is rejection, not provider-aware scheduling

- **Symptom:** while H3 runs, a second legitimate FAL operation becomes `FAILED / NEEDS ATTENTION` instead of waiting.
- **Evidence:** `fal-generation.js:74` clamps concurrency to 1 by default and at most 2. Active statuses are counted at `fal-generation.js:369-370`. The admission guard at `fal-generation.js:1367` runs before purpose/resource classification, so image, correction, entity, and H3 work share the same project-local pool. The endpoint reads the current project's `generation-jobs.json`; it therefore does not enforce the same account limit across separate projects. Rejection is an untyped HTTP 409 and creates no durable queued job. `public/automation.js:1177-1184` records the request as rejected and throws, so the runner marks the step/run failed. Manual H3 similarly surfaces a failed activity/toast at `public/fal-generation.js:954-966`. Local vision review uses its own direct retry path (`server.js:4294-4323`) rather than this scheduler.
- **Likely code path:** submit second operation → project-local provider-wide active-count guard → 409 before durable job creation → automation/manual catch → failed state; later manual retry succeeds only if the slot has cleared.
- **Static/runtime proof level:** **STATICALLY CONFIRMED**.
- **Confidence:** High.
- **Severity:** **P1** — false operational failure, brittle automation, and incomplete account-level protection.
- **Shared root-cause cluster:** Provider scheduling.
- **Required regression test:** with an active H3 job, submit an image job and assert durable `queued` status, no failure, then dispatch after capacity frees. Test resource-class policy, cancellation, idempotent retry, and cross-project use of one provider account. Verify local review uses an explicitly separate capacity class if intended.

The appropriate boundary is a server-side, project-independent scheduler keyed by provider account plus backend/model/resource class, with durable queue state, operation idempotency, dependency/budget gates, and explicit admission policy. A browser-only queue would not survive reloads.

### F10 — Motion units are durable generation inputs with no reachable remove action

- **Symptom:** creators can add Motion Unit A/B/C but apparently cannot remove one.
- **Evidence:** guided Motion adds units in `public/v607-composer.js:795-796`; the live markup at `public/v607-composer.js:729-731` offers select/add/reset/use-defaults but no remove control. A legacy removal handler exists at `public/library-tools.js:192-203`, yet no call site invokes it. Units are stored as `shot.clips`; `prompt-engine.js:435-492` selects a unit by segment ID, and unit duration/motion fields feed built packages. Defaults are inherited/reset at `public/v607-composer.js:623-631,797-798`.
- **Likely code path:** add guided unit → persist `shot.clips` record → select/build by stable segment ID → no live UI command reaches legacy delete.
- **Static/runtime proof level:** **STATICALLY CONFIRMED**.
- **Confidence:** High.
- **Severity:** **P1**.
- **Shared root-cause cluster:** Motion state.
- **Required regression test:** create units A/B/C, build/reference each, remove B, and assert A/C stable IDs remain; active selection falls back predictably; existing builds/jobs retain historical provenance; no generated media is deleted; defaults inheritance remains correct.

Motion units are not themselves provider calls, but they are more than visual grouping: they become independently selectable executable packages. Any future redesign must preserve stable IDs and decide how removal affects active selection, frame links, immutable builds, job history, and provenance.

### F11 — A single replace-in-place modal cannot support nested previews

- **Symptom:** closing a child image preview also closes the correction parent instead of restoring it with the same selections, edits, and scroll.
- **Evidence:** there is one modal root (`public/index.html:78`). `openModal` at `public/app.js:1628-1663` overwrites its `innerHTML` and stores only one global focus/scroll context. `openMediaTheatre` at `public/app.js:1670-1685` calls that same function, replacing the parent dialog DOM. `closeModal` at `public/app.js:1687-1712` hides and clears the root. Backdrop and global Escape paths (`public/app.js:1648`; `public/review.js:758-774`) close the same root. Parent correction form state exists in the replaced DOM rather than in a modal stack/snapshot.
- **Likely code path:** correction modal → child preview calls `openModal` → parent DOM destroyed → child close hides sole modal → no parent state exists to restore.
- **Static/runtime proof level:** **STATICALLY CONFIRMED**.
- **Confidence:** Very high.
- **Severity:** **P1**.
- **Shared root-cause cluster:** Overlay ownership / live UI state.
- **Required regression test:** open a correction dialog, set anchor/frame/prompt edits and scroll, open preview, close by button/Escape/backdrop, and assert the exact parent is restored each time with focus contained in the topmost overlay.

### F12 — Local vision review treats free-form output as a transport/contract failure

- **Symptom:** `vision model returned an unstructured review after 3 attempts`.
- **Evidence:** `server.js:5001-5012` strips only outer code fences and performs strict JSON parsing. Candidate parsing at `server.js:5151-5194` throws on unstructured output. `requestVisionResult` at `server.js:4294-4323` retries three times with a recovery prompt but the same provider/model/token envelope, then reports the observed failure. Scene and correction review have equivalent terminal errors at `server.js:5520-5523,5583-5586`. Valid JSON with incomplete item shape is normalized into failure rows; the quoted error therefore indicates invalid/empty/truncated/non-JSON output or a request failure, not a disagreement over aesthetic reasoning.
- **Likely code path:** local vision response → fence stripping → strict JSON parse → retry prompt ×3 → terminal unstructured-review error.
- **Static/runtime proof level:** **STATICALLY CONFIRMED** for the parser/error contract; the original Qwen payload is **UNVERIFIED**.
- **Confidence:** High.
- **Severity:** **P1** for review reliability, not production authority.
- **Shared root-cause cluster:** Review contract / local model integration.
- **Required regression test:** replay fenced JSON, prose-prefixed JSON, truncated JSON, schema-incomplete JSON, and empty output. Assert deterministic normalization/retry diagnostics, captured non-sensitive response excerpts, and no authority write on parser failure.

Pairwise continuity is a meaningful structured contract rather than arbitrary aesthetic scoring: the scene-review prompt carries ordered shots/authorities and expected changes (`server.js:5360-5377,5441-5516`), while normalization validates IDs and score ranges (`server.js:5389-5439`). No local model call was needed to establish those semantics.

## 5. Runtime-confirmed findings

None. Runtime evidence was intentionally not claimed because the original dogfood project/logs were unavailable and no application listener was running. Static findings that deterministically explain an observation remain labelled **STATICALLY CONFIRMED**, not runtime-confirmed.

## 6. Likely findings needing controlled reproduction

### L1 — `5` seconds displayed/selected but immutable H3 build remains `6`

- **Symptom:** the creator selects duration 5, while a compiled H3 package/prompt says 6 seconds.
- **Evidence:** current guided duration flow preserves the supplied numeric value (`public/creation-studio.js:2221-2224,3170-3174,3191,3256`). H3 preview/submission prefers immutable `build.durationSeconds` (`public/fal-generation.js:835-843,950`). Both `h3-execution.js:195-230` and `fal-h3-backend.js:275-279` reject non-integer/mismatched duration rather than rounding it. Editing a unit after an older build exists can therefore show current unit value 5 while generation from the older build still truthfully carries 6.
- **Likely code path:** build unit at 6 → edit live unit to 5 without rebuilding → open/generate immutable old build → package remains 6 while surrounding UI reflects current 5.
- **Static/runtime proof level:** **LIKELY — NEEDS CONTROLLED REPRODUCTION**.
- **Confidence:** Medium-high.
- **Severity:** **P1** — duration/cost/output intent can diverge.
- **Shared root-cause cluster:** Motion state / immutable build provenance.
- **Required regression test:** build at 6, edit unit to 5 without rebuilding, then open the old build. The UI must either identify it unambiguously as immutable 6-second history or require a rebuild; it must never show a conflicting current 5 as the submitted duration.

### L2 — Exact dogfood route, frame prompt, and stale-gate instances

- **Symptom:** the exact London Rooftops destination, S01-01 compiled string set, and Mourning parlour stale item reported during dogfood were not available for replay.
- **Evidence:** F2, F3, and F6 prove the respective implementation gaps, but the original project ledgers, request payload, and live routes were not present in the accessible runtime.
- **Likely code path:** stale independent run ledger; coarse route target; shot-level context merged into a frame request.
- **Static/runtime proof level:** **LIKELY — NEEDS CONTROLLED REPRODUCTION** for those exact instances; their enabling defects are statically confirmed above.
- **Confidence:** Medium-high.
- **Severity:** inherits F2 P0, F3 P1, and F6 P0.
- **Shared root-cause cluster:** Human-gate reconciliation, navigation/target resolution, and prompt compilation.
- **Required regression test:** reconstruct each from a disposable copied fixture, record durable target/prompt/run state before and after, and make no paid call.

### L3 — Heavy-soot FLAG reasoning

- **Symptom:** concern that Qwen's FLAG may not correspond to missing Heavy-soot state requirements.
- **Evidence:** no original media, state requirement payload, or model response was available.
- **Likely code path:** state-specific review request → local vision response → normalized requirement items.
- **Static/runtime proof level:** **UNVERIFIED**.
- **Confidence:** Insufficient.
- **Severity:** Unassigned pending evidence.
- **Shared root-cause cluster:** Review contract.
- **Required regression test:** replay the original copied media and exact structured requirements against the configured local model, retain the raw response, and compare each finding to a named requirement. The result must remain advisory.

## 7. Presentation-only / user-misunderstanding findings

### P1 — Motion & Sound example nouns are placeholders, not foreign project data

- **Symptom:** `driver-side door`, `coupler`, `seedling`, `relay`, and `status light` look like populated values in a London rooftop shot.
- **Evidence:** the strings occur as HTML `placeholder=` attributes in `public/motion-sound-composer.js:216-223` and `public/v607-composer.js:704`; they are not assigned to persisted input values.
- **Likely code path:** empty form input → browser renders illustrative placeholder in value-like styling.
- **Static/runtime proof level:** **PRESENTATION ONLY**.
- **Confidence:** Very high.
- **Severity:** **P2**.
- **Shared root-cause cluster:** Presentation / copy.
- **Required regression test:** render empty Motion & Sound fields and assert placeholders are visually and accessibly labelled examples and are omitted from serialization/submission.

### P2 — Raw floating duration is a display-boundary defect

- **Symptom:** `9.030000000000001s` appears in creator-facing UI.
- **Evidence:** direct numeric interpolation occurs in `public/focused-workspaces.js:210`, `public/bible.js:63,67`, and `public/v607-composer.js:731` without display formatting. H3 rejects non-whole duration; thus the float is not evidence that the H3 backend rounded or accepted it.
- **Likely code path:** editorial/calculated duration stored as binary float → unformatted interpolation into label.
- **Static/runtime proof level:** **PRESENTATION ONLY** for the cited surfaces; provenance of the exact dogfood float is unverified.
- **Confidence:** High.
- **Severity:** **P2**.
- **Shared root-cause cluster:** Presentation / duration formatting.
- **Required regression test:** render representative integers and floating-point artifacts across all duration surfaces; assert a shared bounded display format while raw persisted/build values remain unchanged.

### P3 — Generic `Task N` labels are fallback copy; duplicated rails are not

- **Symptom:** `Task 1 / Task 2 / Script / Task 4`, with only one meaningful entry.
- **Evidence:** `public/focused-workspaces.js:127-141` falls back to `Task ${index+1}` when a candidate lacks a summary; broad candidate selection at line 417 admits heterogeneous children. That generic naming is presentation/incomplete mapping. The multiplication of whole rails is the independently confirmed F8 lifecycle defect.
- **Likely code path:** heterogeneous child → missing semantic label → positional fallback; repeated enhancer → duplicate rail.
- **Static/runtime proof level:** fallback labels are **PRESENTATION ONLY**; rail duplication is **STATICALLY CONFIRMED**.
- **Confidence:** High.
- **Severity:** **P2** for labels, **P1** for duplicates.
- **Shared root-cause cluster:** Presentation / live UI state.
- **Required regression test:** every admitted task type maps to a stable creator-facing name and actionable panel; positional fallback is never used for known production tasks.

No material observation was classified as **USER MISUNDERSTANDING**. Several user interpretations were incomplete, but the underlying symptoms were valid.

## 8. Source files and functions involved

| Boundary | Principal files/functions |
|---|---|
| Automatic authority | `public/automation.js` — `v626Pick`, `v626ApproveFrame`, review/resume flow; `public/scene-automation.js` — auto-approval settings and correction flow; `public/shared-media-disposition.js`; `public/shared-production-media.js`; `public/app.js` winner badge |
| Human gates/projections | `automation-runs.js`; `public/creator-surfaces.js` — run facts/projections; `public/shared-creator-state.js`; `public/live-activity.js` polling/repaint |
| Navigation | `public/live-activity.js` — `v641RunRoute`; `public/creator-surfaces.js` — `jobRoute`; `server.js` readiness issues; `public/entities.js` workspace task restoration |
| Exact media ownership | `public/entities.js` — entity media; `public/app.js` — prefix lookup; `public/review.js`; `public/coverage-automation.js`; `public/automation.js`; `media-asset-indexer.js`; server batch review in `server.js` |
| State lineage | `public/library-tools.js` — continuation selection, `revealEntityContinuityState`, parent rewrite; `tests/render-harness.js` |
| Prompt compilation | `public/creation-studio.js`; compile endpoint in `server.js`; `prompt-engine.js` — `buildContext`, `promptCharactersForContext`, `defaultSpec`; automation preflight |
| Corrections | `public/scene-automation.js` — `v640SceneCorrectionPackages`, `v640SceneCorrectionReferences`, `v640SceneApprovedStill` |
| Live UI | `public/live-activity.js` — embedded render/replacement and drawer reconciliation; `public/focused-workspaces.js` — scene enhancer/task labels |
| Provider scheduling | `fal-generation.js` admission guard/active count; `public/automation.js` FAL wait; `public/fal-generation.js` manual H3 handling; `h3-execution.js`; `fal-h3-backend.js` |
| Motion units/duration | `public/v607-composer.js`; legacy `delClip` in `public/library-tools.js`; `prompt-engine.js`; `public/creation-studio.js`; `public/fal-generation.js` |
| Modal ownership | `public/index.html`; `public/app.js` — `openModal`, `openMediaTheatre`, `closeModal`; `public/review.js` Escape handler |
| Local review | `server.js` — `requestVisionResult`, strict parse/normalization, candidate/scene/correction review prompts |
| Presentation | `public/motion-sound-composer.js`; `public/v607-composer.js`; `public/focused-workspaces.js`; `public/bible.js` |

## 9. Root-cause clusters

| Cluster | Symptoms | Shared implementation boundary | Highest-risk invariant | Best first test |
|---|---|---|---|---|
| Production authority | `APPROVED PICK`, auto threshold, automatic correction approval, misleading decision projection | winner/approval writer plus disposition/production projections | only an explicit human command may create or move production authority | high-score AI pass must remain recommendation-only across fresh and resumed runs |
| Human-gate reconciliation | stale Waiting for You across Assistant/Activity/Terminal | separate automation-run ledger projected without comparison to current authority | actionable gates must equal current unsatisfied production truth | approve outside run path and observe automatic convergence on every surface |
| Navigation / target resolution | generic Generated Media, stale/related destination, wrong restored task | coarse hash routes without structured target/satisfaction contract | an action must resolve to the exact live control or report target satisfaction/absence | named entity-state readiness action opens exact task/state/control |
| Entity / media ownership | young candidates in adult pool; possible wrong-owner rows | filename-prefix lookup ahead of exact indexed scope | media eligibility and authority are keyed by exact durable owner ID | overlapping-ID negative-control suite through display, review, and approval |
| State lineage | wrong state reopened, editor absent, ancestor offered after descendant | cyclic continuation selection and unconditional parent mutation | lineage is acyclic and existing ancestry is never rewritten by navigation | root/child/grandchild terminal continuation test plus cycle assertion |
| Prompt compilation | start-frame character contamination and wrong paid render | shot-level context merged without frame presence authority | frame presence/absence overrides whole-shot membership for that frame | absent→enters→present three-frame compile test |
| Correction orchestration | round-1 `undefined.id` | unguarded previous/next reference construction | missing optional neighbors never enter approved-still lookup | first/middle/last/deleted-neighbor package tests |
| Live UI state | disclosure reopens, jitter, scroll/focus loss, duplicate scene rails | wholesale DOM replacement plus independent enhancer guard error | server/live snapshots must not reset user-owned ephemeral UI state | repeated snapshots/enhancement preserve state and exactly one keyed rail |
| Provider scheduling | valid second job marked failed; account contention incomplete across projects | project-local, provider-wide admission guard without durable queue | capacity contention is queued/admitted explicitly, never misreported as execution failure | active H3 + queued image + cross-project account-capacity test |
| Motion state | add-only units, stale duration/build ambiguity | durable clip units and immutable builds with incomplete lifecycle UI | edits and removals preserve stable history and disclose immutable build inputs | remove middle unit and edit-after-build duration test |
| Overlay ownership | closing child destroys parent correction work | one replace-in-place modal root/global close state | closing topmost overlay restores exact parent state and focus | nested preview close by all mechanisms |
| Review contract | Qwen unstructured after retries | strict JSON parser and same-envelope retry | parser failure stays advisory, diagnosable, and never changes authority | malformed/truncated/fenced response fixture matrix |
| Presentation / copy | example nouns look populated, raw floats, Task N labels | placeholders and direct formatting/fallback labels | examples and derived displays must never masquerade as project truth | empty-state accessibility/serialization and formatting suite |

The most important cross-cluster relationship is that stale gates and weak routing are not one defect. Reconciliation decides **whether** work is still required; target resolution decides **where** valid work is performed. Likewise, timeline resets and duplicate scene rails share a live-update trigger but have separate implementation faults and require separate assertions.

## 10. Production-authority / data-integrity risk assessment

| Risk | Consequence | Current controls | Assessment |
|---|---|---|---|
| Automatic winner approval | AI-selected media becomes durable production authority and advances shot/scene work | automatic provenance is recorded, but it does not prevent the authority write | **Critical / unacceptable** |
| Machine approval shown as human decision | audit/presentation consumers cannot reliably distinguish actor | provenance exists in one record layer | **High**; semantic truth is collapsed downstream |
| Frame truth lost to shot context | wrong subject presence enters paid generations and may be approved | free-text frame directive and generic “avoid unrequested” language | **Critical**; no structured contradiction check |
| Prefix ownership | child media becomes eligible for parent review/approval | exact owner exists in index but is bypassed by lookup | **Critical** because projection error can become durable state |
| Lineage reparenting | ancestor/descendant cycles corrupt continuity inheritance | no ancestry restriction/acyclicity guard at continuation write | **Critical** for project data integrity |
| Stale gates | false outstanding work, parked automation, repeated or misdirected actions | polling only repeats ledger state | **High**; control-plane dishonesty |
| Boundary correction exception | correction cannot execute on boundary shots | retry/provenance repair does not address missing neighbor | **High availability**, low direct corruption |
| Generic target fallback | creator may approve/edit a related but wrong object | coarse route plus workspace defaults | **High interaction risk**, especially when combined with stale gates |
| Contention reported as failure | failed automation and unsafe manual retry behavior | active job count and later retry | **Moderate-high**; no durable queue and incomplete cross-project guard |
| Immutable duration ambiguity | submitted time/cost differs from visible current intent | backend refuses invalid values, but old valid build can remain selectable | **Moderate-high**, pending reproduction |

Two audit/reporting weaknesses amplify F1. `public/shared-production-media.js:431-462` can infer a human decision from an approved edge without checking for a human actor. Also, `automation-runs.js:483` counts completed approval steps as approvals even when automatic, which can make operational summaries conceal how authority was established. Repair must preserve and enforce actor identity from write through every projection/export, not only change a badge.

## 11. Recommended repair ordering

### P0 — before Dogfood #3

1. **Enforce human-only production authority (F1).** Freeze the invariant in tests first; separate AI pass/recommendation/internal winner from human-approved authority; audit every consumer/export for actor-aware semantics.
2. **Add frame-level temporal presence authority (F6).** Define absence/presence/entry/exit semantics and contradiction preflight before any paid request.
3. **Reconcile durable human gates with current project truth (F2).** Implement one shared reconciliation boundary consumed by Assistant, Global Activity, Terminal, run resume, poll, and workspace entry.
4. **Replace prefix ownership with exact durable scope (F4).** Repair both client projection and server review paths; audit already-created wrong-owner rows separately rather than silently rewriting evidence.
5. **Protect state lineage (F5).** Add acyclicity and valid-continuation rules before repairing navigation; never mutate ancestry as a side effect of “edit next.”
6. **Guard correction boundaries (F7).** Keep missing neighbors optional and assert package validity before provider code.

### P1 — next repair batch

1. structured, satisfaction-aware `Take me there` targets (F3);
2. durable provider/resource queue and typed contention result (F9);
3. preserve live disclosure/focus/scroll and make scene enhancement idempotent (F8);
4. add safe motion-unit removal and immutable-build disclosure (F10, L1);
5. introduce nested overlay ownership/stack behavior (F11);
6. harden local review structured-output diagnostics/recovery (F12);
7. preserve automatic-vs-human actor identity in production and automation summary projections.

### P2 — presentation cleanup

1. format durations through a shared display boundary;
2. restyle/relabel Motion & Sound examples so empty placeholders cannot look persisted;
3. replace known `Task N` fallbacks with semantic task names and filter non-task children.

Do not combine all clusters into one redesign. The smallest safe sequence is contract test → invariant repair at the authoritative writer/model boundary → projection/routing repair → presentation. Existing dogfood state should remain evidence; any migration or cleanup of contaminated authority/ownership/lineage records needs a separately reviewed plan.

## 12. Tests that should exist before each repair

| Repair area | Test to land first |
|---|---|
| Human authority | high-score PASS, low-score PASS, FLAG, missing score, resumed completed review, and correction review all prove no authority without a human command |
| Actor projections/export | automatic recommendation/winner never appears as human decision or human approval in UI, readiness, summaries, or export |
| Gate reconciliation | approval through run modal, entity workspace, generated-media workspace, and reload all converge to the same completed run truth |
| Target resolution | exact entity/state/frame/task navigation; satisfied, deleted, and stale target handling; no generic silent fallback |
| Media ownership | overlapping IDs across indexed assets, candidate rows, review pool, approval, coverage automation, and server batch review |
| State lineage | valid child continuation, terminal descendant, attempted ancestor selection, cycle detection, cross-task reveal, and no parent mutation from navigation |
| Frame presence | absent-at-start, present-throughout, enters, exits, end-only; contradictions fail before mocked provider dispatch |
| Correction references | first/middle/last shot, single-shot scene, missing/deleted neighbor, no approved neighbor still |
| Live timeline | disclosure/focus/scroll survive repeated polling and notification updates; technical detail does not force-open |
| Scene rail | enhancer called repeatedly after route/task/live events yields one rail and stable keyed entries |
| Provider scheduling | same-project and cross-project contention; image/video resource classes; queue/reload/cancel/retry/idempotency/budget behavior |
| Motion removal | remove active/non-active middle unit with stable IDs, existing build/job provenance, selection fallback, and media preservation |
| Duration/build | edit duration after immutable build; preview and submit disclose/use the same source and exact seconds |
| Nested modal | parent form values/scroll/focus restored after child close button, Escape, and backdrop |
| Review parser | fenced/prose-prefixed/truncated/empty/wrong-shape outputs and terminal diagnostic; never approve on failure |
| Presentation | placeholders serialize as empty; all duration labels use bounded formatting; known tasks never show positional fallback |

Tests should use free provider stubs or copied fixtures only. No repair test requires a paid generation.

## 13. Important issues Dogfood #2 appears to have missed

1. **Cross-project concurrency bypass:** the FAL active count is based on the current project's job ledger. Two projects using the same provider account can each admit work despite a nominal global account limit.
2. **Automatic approval reporting distortion:** a completed approval step is counted as an approval in automation summaries, while production-media projection can label any approved edge as a human decision. This hides machine authority even though lower-level provenance exists.
3. **Lineage mutation is worse than the visible continuation error:** choosing the offered ancestor can persist a cycle, making future inheritance and required-state reasoning unsafe.
4. **Prefix leakage exists on both sides of the client/server boundary:** fixing only the visible entity media selector would leave server batch review capable of the same ownership error.
5. **Correction boundaries are universally exposed:** first and last shots, single-shot scenes, and deleted neighbors can all trigger the same local exception; S04-03 is not a one-off provider failure.
6. **The modal problem is systemic:** any workflow that opens one modal from another can lose the parent, not just continuity correction.
7. **Generic activity source routes can become bad recovery targets:** manually tracked failed operations may navigate back to their origin rather than to the object that needs repair.
8. **Polling provides freshness of stale ledgers, not truth reconciliation:** a faster timer would make F2 update more often without making it correct.

## 14. Revisions to the original Dogfood diagnosis

| Original interpretation | Forensic revision |
|---|---|
| A1 required runtime verification and might be misleading copy | **Revised upward:** source conclusively shows automatic code writes the authority edge and advances workflow. This is a P0 contract violation. Runtime is needed only to attribute a particular dogfood asset, not to prove capability. |
| Stale Waiting for You is mainly UI staleness | **Revised:** the durable run ledger itself is not reconciled with current project authority; every projection faithfully repeats stale control truth. |
| Young Sweep leak may be parent/child expansion | **Revised:** it is exact string-prefix collision. The Widow control confirms why only overlapping IDs leak. Durable lineage is not the selector. |
| `Approve & edit` is navigation/copy trouble | **Revised upward:** navigation is incomplete, continuation selection is lineage-blind, and accepting it can rewrite an ancestor beneath a descendant. |
| Frame A failure is the image model's interpretation | **Confirmed as CineBraid compilation architecture:** frame requests lack structured temporal presence and inherit positive shot-level cast/description facts. The exact payload still needs a copied-project replay. |
| Correction failure may be provider/network or transient | **Revised:** it is a deterministic local null/boundary dereference before provider submission; automatic retry cannot repair it. |
| Live jitter and duplicate rails are one keyed-row issue | **Revised:** both are triggered by updates, but timeline state loss comes from wholesale replacement/default-open markup, while duplicate rails come from an ineffective root/descendant enhancement guard. |
| FAL is globally serialized | **Revised:** it is broad across purposes within one project, but not truly account-global across projects. It rejects rather than queues. |
| Motion units may be cosmetic organization | **Revised:** they are durable `shot.clips` selected by segment ID and feed executable build packages, although each unit is not itself a provider job. |
| Motion & Sound nouns may be stale/demo data | **Revised downward:** they are static placeholders. This is presentation only, with no evidence of persisted data leakage. |
| `5 → 6` may be float rounding | **Revised:** H3 layers reject invalid/non-integer duration. An older immutable 6-second build selected after a live edit to 5 is the leading hypothesis and needs controlled reproduction. |
| Qwen unstructured error reflects bad review reasoning | **Revised:** that exact message is a structured-output/parser failure after retries, not an aesthetic verdict. |
| Pairwise continuity may be synthetic scoring | **Revised:** its prompt/normalizer contract contains ordered authority, expected-change, ID, and per-pair semantics. Model quality remains empirical, but the contract is meaningful. |

## 15. Statement of non-implementation

No implementation changes were made during this forensic audit.

The audit did not modify source, schemas, fixtures, tests, configuration, documentation other than this requested report, generated media, project truth, or repository history. It made no commits and no paid or local-model inference calls.

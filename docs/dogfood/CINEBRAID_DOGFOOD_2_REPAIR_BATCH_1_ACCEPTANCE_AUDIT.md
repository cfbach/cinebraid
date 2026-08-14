# CineBraid Dogfood #2 — Repair Batch 1 Independent Acceptance / Adversarial Audit

Audit date: 2026-08-14  
Audit target: `fix/dogfood2-production-trust` at `16701449f3b1a0639911029be50195d5ad1baafc`  
Baseline: `origin/main` at `afe1853ce2fa69f43489822c0e86d5a4c45ea3f6`  
Method: read-only source forensics, production-path probes, test-source inspection, focused local checks, and the full local verification harness. No provider or local-model calls were made.

## 1. Executive verdict

**HOLD — ARCHITECTURAL ISSUE REMAINS**

The repair branch is cleanly scoped, all reported local checks pass, the focused repair suites exercise 287 positive assertions plus 24 negative controls, and the full harness passes 166 suites. Those facts do not establish the requested production-truth invariants.

Independent adversarial probes found unresolved P0 behavior in every acceptance area:

| P0 | Verdict | Highest-impact counterexample |
|---|---|---|
| P0-1 human-only authority | **FAIL** | A preserved pre-repair automatic winner satisfies a human gate; reconciliation then manufactures `result.humanApproved = true`. Revoking the winner does not invalidate the completed gate, and resume can restore it. |
| P0-2 frame presence | **FAIL** | The positive sentence “The Chimbley Sweep stands before the chimney” is treated as a negated mention because the detector matches the substring `before `. Automation and correction also retain raw paid-dispatch paths outside the repaired compiler boundary. |
| P0-3 gate reconciliation | **FAIL** | Reconciliation is one-way and rests on the incorrect winner-exists predicate. It can clear a gate that was never human-satisfied and does not reopen a completed gate after authority is revoked. |
| P0-4 ownership | **FAIL** | An unclaimed overlapping filename is guessed to belong to the most-specific entity and enters that entity's approval-capable pool. A contested file is likewise attributed to one claimant and is not surfaced by a production caller. |
| P0-5 lineage | **FAIL** | Approval navigation still writes a first parent, contrary to the stated invariant. More seriously, the exposed parent selector offers descendants and writes `parentStateId` without cycle validation. |
| P0-6 correction boundary | **FAIL** | The real correction runner hydrates before preflight. A deleted target throws an unclassified `TypeError`, is labelled a provider failure, and can consume provider retry policy. |

These are not isolated copy or presentation defects. They arise because authority, presence enforcement, ownership, lineage mutation, and correction validation do not each have one mandatory boundary used by all writers/dispatchers. A corrective commit that only expands the present source-pattern tests would not be sufficient.

## 2. Repository/branch receipt

| Receipt item | Observed value | Result |
|---|---|---|
| Repository root | `C:\CineBraid\CineBraid-Source` | Expected |
| Current branch | `fix/dogfood2-production-trust` | Expected |
| Current HEAD | `16701449f3b1a0639911029be50195d5ad1baafc` | Exact expected repair commit (`1670144`) |
| `origin/main` | `afe1853ce2fa69f43489822c0e86d5a4c45ea3f6` | Exact expected baseline |
| `origin/fix/dogfood2-production-trust` | `16701449f3b1a0639911029be50195d5ad1baafc` | Exact match to local HEAD |
| Baseline ahead/behind (`origin/main...HEAD`) | `0 / 3` | Repair branch is three commits ahead and not behind |
| Repair remote ahead/behind | `0 / 0` | Local and remote repair tips agree |
| Working tree before audit report | Clean | No checkout or reset performed |
| Audit worktree | None | Not required; target branch was already checked out and clean |

The only Git diagnostic was a sandbox warning that the process could not read `C:\Users\calef\.config\git\ignore`. It did not change the repository receipt or command exit status.

The required closeout, prior forensic audit, and implementation handoff were read before judging the branch. Their claims were treated as hypotheses, not proof.

## 3. Commit/diff hygiene

**Verdict: PASS for commit hygiene and scope.** The content is appropriately separated:

- `9e64137` is documentation-only: the closeout and forensic evidence documents.
- `8e34d1d` contains the source and test repair: 31 files, 3,944 insertions, 124 deletions.
- `1670144` is documentation-only: the repair handoff.
- The checkpoint-to-HEAD blobs for the two canonical evidence documents are identical. Observed blob IDs were `d28b4e1…` for the closeout and `8d066f5…` for the forensic audit at both points.
- No project data, generated media, provider state, secrets, environment configuration, or unrelated redesign entered the baseline-to-repair diff.
- `git diff --check` passed.
- No tracked deletion appeared in the branch diff. The handoff's forensic-audit root duplicate is not tracked at HEAD or represented as a deletion in this branch; no resulting source damage was found, and the full suite passes.

Every baseline-to-HEAD changed file is classified below.

| Classification | Files |
|---|---|
| Expected repair source | `automation-runs.js`; `package.json`; `prompt-engine.js`; `public/app.js`; `public/automation.js`; `public/creation-studio.js`; `public/entities.js`; `public/index.html`; `public/library-tools.js`; `public/live-activity.js`; `public/media-inspector.js`; `public/planning.js`; `public/reports.js`; `public/scene-automation.js`; `public/shared-entity-ownership.js`; `public/shared-frame-presence.js`; `public/shared-production-authority.js`; `public/shared-production-media.js`; `public/shared-state-lineage.js`; `public/styles.css`; `server.js` |
| Expected tests/harness | `tests/continuity-correction-boundary.js`; `tests/current-behavior.js`; `tests/dogfood2-p0-negative-controls.js`; `tests/entity-media-ownership.js`; `tests/frame-presence-authority.js`; `tests/production-authority.js`; `tests/reference-automation-closed-loop.js`; `tests/render-harness.js`; `tests/run-full-check.js`; `tests/state-lineage-safety.js` |
| Expected documentation | `docs/dogfood/CINEBRAID_DOGFOOD_PASS_2_CLOSEOUT_2026-08-14.md`; `docs/dogfood/CINEBRAID_DOGFOOD_2_FORENSIC_AUDIT.md`; `docs/dogfood/CINEBRAID_DOGFOOD_2_REPAIR_BATCH_1_HANDOFF.md` |
| Unexpected / requires explanation | None |

## 4. P0-1 authority verdict

**Verdict: FAIL — Critical severity, high confidence.**

The repair correctly removes the reported new automatic-approval branch, renames the threshold to a recommendation threshold, makes a strong AI result a non-authoritative recommendation, and adds grant checks to `v626ApproveFrame` and `v626ApproveEntity`. The two changed legacy expectations correctly stop demanding the old automatic approval contract. Those are real improvements.

They do not make human authority structurally impossible without an explicit human command.

### Finding A — legacy automatic winners satisfy human gates

- **File/function:** `public/shared-production-authority.js` — `gateSatisfied()` and `applyGateReconciliation()`.
- **Evidence:** `gateSatisfied()` accepts an existing frame `winner` or entity `approvedFile` without checking the actor or approval provenance. `applyGateReconciliation()` then completes the gate step and writes `result.humanApproved = true`. A direct fixture containing a pre-repair automation-created frame winner returned:

  ```json
  {
    "gateSatisfied": true,
    "status": "interrupted",
    "stepStatus": "completed",
    "humanApproved": true,
    "satisfiedByReconciliation": true
  }
  ```

  The fixture retained automatic generation provenance; no human approval command was added. `tests/production-authority.js` positively asserts this unsafe assumption: it permits the machine-originated media disposition to remain `approved`, then treats any winner as satisfying the gate on the rationale that only a human could have written one. That premise is false for preserved pre-repair state.
- **Severity:** Critical.
- **Confidence:** High; executed directly against the repaired shared module.
- **Exact required correction:** Represent human authority as a durable, actor-aware receipt/edge and require that receipt at every human gate. Legacy winners with automatic, machine, missing, or unknown provenance must remain visible but must not satisfy human authority. Reconciliation must never synthesize `humanApproved`; it may only cite a valid existing human approval receipt.

### Finding B — revocation can be undone by resume

- **File/function:** `public/creation-studio.js` — `resetGuidedFrameApproval()`; `public/automation.js` — completed-gate resume branches for frame/entity approval.
- **Evidence:** Reset clears the current winner but does not invalidate or reopen the already reconciled automation step. Resume trusts `completed + pass + winner + result.humanApproved`, creates a fresh in-memory grant, and calls the approval writer again. A reconciled legacy winner can therefore be cleared and later resurrected without a new human approval command. The entity path has the same shape.
- **Severity:** Critical.
- **Confidence:** High from writer/resume control flow.
- **Exact required correction:** Reconciliation must be bidirectional and revocation-aware. Revoking/replacing authority must invalidate dependent completed gate receipts. Resume must revalidate the current durable authority receipt and must never reconstruct authority from a stale step result.

### Finding C — authority remains convention-bound across writers

- **File/function:** approval writers in `public/library-tools.js`, `public/creation-studio.js`, `public/review-provenance.js`, `public/review.js`, and automation resume paths.
- **Evidence:** The new grant guard protects two automation-side helpers, but authority writes are still distributed. Several manual surfaces write winners, approval dispositions, and provenance directly rather than calling one authority command boundary. No additional active machine writer was proven in this audit, but the requested structural impossibility is absent: safety depends on each caller being correctly classified and maintained.
- **Severity:** High architectural risk.
- **Confidence:** High for the fragmented write topology; no claim is made that every direct writer is currently machine-triggered.
- **Exact required correction:** Route all frame, shot, entity, reference, Generated Media, import/reconciliation, and resume authority mutations through one command that requires an unforgeable-in-normal-flow human action receipt and records actor, command, target, value, and revocation/supersession.

### OFP export/migration claim

The handoff's narrow claim is **true**: migration is restricted to `suggested`, `disputed`, and `cited` statements, so it does not emit an OFP `approved` statement for a legacy winner. However, `ofp/ofp-migrate-rules.js` rule M013 passes every non-empty frame `winner` to `context.approve()` without provenance inspection, and M030 materializes it as an asset plus subject/reference edge. In `ofp/ofp-migrate.js`, `approve()` is only a misleadingly named pending-reference collector; it does not write an approval statement.

That distinction prevents a false human statement but does not preserve the full truth of an automatic winner: the export still maps it as the frame's approved-output reference. The required correction is to classify legacy winner provenance before exporting the edge, retain automatic/unknown selections as workflow or review evidence, and export an authoritative production-output edge only when backed by human authority.

## 5. P0-2 temporal-presence verdict

**Verdict: FAIL — Critical severity, high confidence.**

The new `entityPresence` model is meaningful, frame-specific compilation does remove declared-absent entities from CineBraid's positive lists, references can remain attached as non-compositional context, and `server.js` performs a 409 contradiction check before returning from `/api/prompt/compile`. The problem is that both the language check and the boundary coverage are incomplete.

### Finding A — the negation detector suppresses real positive contradictions

- **File/function:** `public/shared-frame-presence.js` — `clauseDeniesPresence()` and `framePresenceContradictions()`.
- **Evidence:** The denial markers are substring tests and include `before `, `without`, and `not `. A direct adversarial probe with a declared-absent Sweep and the sentence “The Chimbley Sweep stands before the chimney.” produced:

  ```json
  {
    "clauseDeniesPresence": true,
    "narrative": {
      "text": "The Chimbley Sweep stands before the chimney.",
      "withheldFor": []
    },
    "contradictions": []
  }
  ```

  `before` is spatial here, not a pre-appearance temporal qualifier. Similar false exemptions exist for phrases such as “without hesitation” and “not only”. The positive entity clause remains and the preflight calls it safe.
- **Severity:** Critical because contradictory prompt text can reach generation.
- **Confidence:** High; executed directly against the repaired detector.
- **Exact required correction:** Replace broad substring denial with mention-scoped, grammatical negation/temporal handling. Add adversarial positives (`stands before`, `without hesitation`, `not only`) and true negatives (`do not show`, `before X appears`) to final-payload tests.

### Finding B — the repaired compiler is not the mandatory paid-dispatch boundary

- **File/function:** `fal-generation.js` — POST `/api/generation/fal/jobs` and `submit()`; `public/automation.js` — `v626WaitFalJob()` and `v626DerivativeBlockingBuild()`; `public/scene-automation.js` — `v640AutomateSceneCorrection()`; `public/fal-generation.js` — `startCandidateCorrectionGeneration()`.
- **Evidence:** The final presence check exists in the `/api/prompt/compile` path in `server.js`, not at the universal provider boundary. The paid FAL route recompiles only requests carrying `imagePlan: true`, and only for `blocking` or `frame`. The automation dispatcher does not set `imagePlan`. `correction` is excluded from that compiled branch. These requests fall through `submit()`, which sends `job.prompt` directly to the provider. Consequently a prompt built elsewhere, edited after compilation, or assembled by scene/candidate correction can bypass `FramePresence.framePresenceContradictions()` entirely. The generation picker uses `imagePlan: true`; the automation/correction paths do not.

  In addition, `v626DerivativeBlockingBuild()` calls `/api/prompt/compile` without `frameId`, so the server cannot apply that frame's `entityPresence`; the opening blocking builder likewise omits a frame identity. Passing `frameId` later to the paid job only labels output and does not re-run presence enforcement.
- **Severity:** Critical.
- **Confidence:** High from the request-body and dispatcher branches.
- **Exact required correction:** Make a single pre-dispatch compiler/policy gate mandatory for every frame-specific paid image request, including automation, blocking, correction, retry, and legacy callers. Require a resolvable `shotId + frameId`; derive current frame presence from project state at dispatch; inspect the exact submitted prompt after edits; and refuse before durable paid-job creation/provider transmission when it contradicts presence.

### Finding C — local contradiction classification is lost

- **File/function:** `public/creation-studio.js` — `guidedPromptRequest()`; `public/automation.js` — `v626FailureClass()`.
- **Evidence:** The server returns code `FRAME_PRESENCE_CONTRADICTION`, but `guidedPromptRequest()` throws a new generic `Error` containing only the message. `v626FailureClass()` recognizes only explicit local-package/authority flags and otherwise returns `provider`. Thus an automation path that does encounter the repaired 409 can record a deterministic local contradiction as a provider-class failure.
- **Severity:** High.
- **Confidence:** High from error construction and classification.
- **Exact required correction:** Preserve HTTP status and structured error code through client helpers; classify `FRAME_PRESENCE_CONTRADICTION` as local-package/preflight; persist remediation; do not increment provider retry/usage.

## 6. P0-3 reconciliation verdict

**Verdict: FAIL — Critical severity, high confidence.**

The branch does establish a shared reconciliation helper and wires it through server ledger reads, browser predicates, Recheck Status, and several out-of-modal approval paths. For a valid current human approval, this substantially improves multi-surface convergence.

### Finding A — “actionable iff unsatisfied” is based on false authority

- **File/function:** `public/shared-production-authority.js` — `gateSatisfied()` / `applyGateReconciliation()`; consumers in `automation-runs.js`, `public/live-activity.js`, and approval surfaces.
- **Evidence:** The executed P0-1 legacy fixture proves an automatic winner clears the human gate and removes the waiting state. All surfaces can converge and still converge on false production truth. This is worse than a stale badge: downstream work is unblocked.
- **Severity:** Critical.
- **Confidence:** High.
- **Exact required correction:** Reconciliation's underlying predicate must require the actor-aware durable human authority receipt described in P0-1, not merely the presence of `winner`/`approvedFile`.

### Finding B — reconciliation is not bidirectional

- **File/function:** `applyGateReconciliation()` and automation resume/revocation paths.
- **Evidence:** Reconciliation scans unresolved/waiting gates and moves a satisfied one to completed/interrupted. It does not invalidate a previously completed gate when its winner is deleted, revoked, rejected, or replaced. Resume can therefore use stale gate results to restore authority. The invariant says “currently unsatisfied”, so current truth must be checked in both directions.
- **Severity:** Critical.
- **Confidence:** High.
- **Exact required correction:** Derive the gate state from current authority on every ledger read, poll, workspace entry, direct detail, badge/count projection, and resume. Reopen/invalidate dependent steps on revoke/delete/replacement. A cached reconciliation result may cite, but may not replace, the current predicate.

No separate raw-ledger projection was proven to create a second false “Waiting for You” count after the shared reads. Dismissing/archiving activity presentation does not itself mutate the project authority and is acceptable. The deliberate `interrupted` presentation remains a P1 only after the predicate and revocation defects are corrected.

## 7. P0-4 ownership verdict

**Verdict: FAIL — Critical severity, high confidence.**

The repair fixes the original first-prefix error for normally named overlapping IDs by choosing the most-specific ID. That is sufficient for display convenience, not for authority.

### Finding A — inferred ownership grants review and approval eligibility

- **File/function:** `public/shared-entity-ownership.js` — `mediaOwnerId()` and the shared eligibility predicate used by entity media selectors/review/approval/coverage/server paths.
- **Evidence:** For an unclaimed legacy file named `SWEEP_CHILD_UNCLAIMED.png`, the direct probe resolved the child as owner, marked `childEligible: true`, and placed it in the child's approval pool. There is no durable ownership claim. The same fallback predicate is intentionally reused for display, review, approval, automation, coverage, and server batch review, so a guess is promoted into canon eligibility.
- **Severity:** Critical.
- **Confidence:** High; executed against the shared production resolver.
- **Exact required correction:** Return a structured resolution (`ownerId`, basis, confidence, contested). Only a durable, unique claim may grant review, approval, automation, export, or canon eligibility. Prefix-inferred unclaimed media may be discoverable in a separate legacy/unassigned display, but must remain non-authoritative until a human claims it.

### Finding B — contested durable claims are attributed instead of quarantined

- **File/function:** `public/shared-entity-ownership.js` — `mediaOwnerId()` and `contestedOwnership()`; production callers.
- **Evidence:** A fixture durably claimed by both `CHAR-SWEEP` and `CHAR-SWEEP-YOUNG` is reported by `contestedOwnership()`, yet `mediaOwnerId()` selects the most-specific prefix, making it child-eligible and adult-ineligible. The positive test explicitly accepts this. Repository search found no production caller of `contestedOwnership()` outside its definition, so the conflict is not surfaced to the user at the decision boundary.
- **Severity:** Critical.
- **Confidence:** High.
- **Exact required correction:** Multiple durable claimants must produce no authoritative owner. Surface a blocking conflict in every affected review/approval/export surface and require explicit resolution; do not use filename specificity to break durable-claim conflicts.

### Finding C — an additional raw prefix fallback remains

- **File/function:** `public/shared-production-media.js` — entity association fallback around the legacy `startsWith` path.
- **Evidence:** When the shared/injected entity media helper is unavailable, this module still uses raw prefix matching. Normal browser composition appears to inject the helper, so this is not the primary demonstrated exploit, but it contradicts the claimed repository-wide removal and is a future/server/test-context bypass.
- **Severity:** Medium follow-on risk.
- **Confidence:** High for code existence, medium for current reachability.
- **Exact required correction:** Remove the fallback or make absence of the authoritative resolver a conservative “unresolved owner” result.

The deferral of historic contaminated rows is not safe in the current implementation. No silent migration was found, which is good, but existing contamination is neither quarantined nor honestly surfaced and can still become approval-eligible. A separate migration/reconciliation plan is required, and current reads must be conservative before merge.

## 8. P0-5 lineage verdict

**Verdict: FAIL — Critical severity, high confidence.**

The shared graph helper correctly recognizes ancestors/descendants and rejects a proposed parent that would create a cycle. The normal root → child → grandchild continuation sequence completes rather than wrapping to the root, and the original unconditional reparent of an already-parented state is removed.

### Finding A — approval navigation still mutates lineage

- **File/function:** `public/library-tools.js` — approval continuation path; `public/shared-state-lineage.js` — `continuationCandidates()` and `safeParentAssignment()`.
- **Evidence:** The acceptance invariant is categorical: navigation must never mutate lineage. The repaired path still assigns `nextState.parentStateId` when the selected next state has no parent, and `safeParentAssignment()` explicitly returns `write: true, reason: "establishing-first-parent"`. A direct orphan-state fixture was offered as a continuation and received the current state as parent. The positive test enshrines this behavior. `continuationCandidates()` includes unrelated/sibling/orphan states after direct children rather than limiting navigation to declared descendants.
- **Severity:** High, elevated to release-blocking by the explicit invariant and state mutation.
- **Confidence:** High; direct module probe plus the production writer.
- **Exact required correction:** Remove every lineage write from approval/navigation. Continuation may open an existing direct child/descendant editor or complete. Establishing parentage must be a distinct explicit edit command with validation and user intent.

### Finding B — the exposed parent editor can create a cycle

- **File/function:** `public/creation-studio.js` — `entityStateGenerationMarkup()` and `setContinuityStateGeneration()`.
- **Evidence:** The parent selector lists every state except the current state, including descendants. Its change handler directly executes `state[key] = value` for `parentStateId` without `safeParentAssignment()`. In root → child → grandchild, editing root's parent to grandchild creates root → … → grandchild → root. This is an exposed, generic ancestry writer, not a theoretical import-only risk.
- **Severity:** Critical.
- **Confidence:** High from the rendered options and direct writer.
- **Exact required correction:** Use one validated lineage mutation API for all UI, automation, import, duplication, recovery, and generic edits. Parent choices must exclude self and descendants; a rejected mutation must not dirty state.

### Finding C — other writers bypass the validator

- **File/function:** `public/entities.js` — `openContinuityStateVariant()`, `correctContinuityStateFromParent()`, and generic `setContinuityState()`; `public/automation.js` — state automation parent assignment; normalization/import writers in `public/app.js`.
- **Evidence:** Repository-wide writer inspection found direct `parentStateId` assignments in these paths. The only production use of `safeParentAssignment()` found was the library approval-navigation path. The generic setter permits arbitrary `parentStateId`, and normalization can preserve or create graph damage without a centralized validation receipt.
- **Severity:** High architectural risk.
- **Confidence:** High for bypass topology; individual reachability varies.
- **Exact required correction:** Centralize all ancestry writes, validate the entire resulting graph atomically, report pre-existing damaged graphs without silently inventing lineage, and test each exposed writer rather than only the pure helper.

## 9. P0-6 correction-boundary verdict

**Verdict: FAIL — Critical severity, high confidence.**

The repaired reference builder now safely handles first, middle, last, single-shot, deleted-neighbor, missing-neighbor, and neighbor-without-approved-still cases. Valid anchors are preserved and omissions are distinguished. The real runner orders its operations incorrectly.

### Finding — hydration dereferences bad state before classified preflight

- **File/function:** `public/scene-automation.js` — `v640AutomateSceneCorrection()`, `v643HydrateSceneCorrectionPackage()`, and frame/shot lookup helpers; `public/automation.js` — `v626FailureClass()`.
- **Evidence:** `v640AutomateSceneCorrection()` hydrates the package before calling its local preflight. Hydration can dereference the missing/deleted target while deriving the opening frame. Executing the actual runner with a stale target produced:

  ```json
  {
    "message": "Cannot read properties of undefined (reading 'clips')",
    "failureClass": "",
    "localPackageError": false
  }
  ```

  Because the error is a bare `TypeError`, `v626FailureClass()` defaults it to `provider`. It never reaches the new classified package error and can enter provider retry handling even though no retry can repair the project/package. The focused test calls the preflight directly and uses source-shape checks; it does not exercise this real order.
- **Severity:** Critical because deterministic local faults masquerade as provider faults and can consume authorized retry behavior.
- **Confidence:** High; executed through the actual repaired runner in the render harness.
- **Exact required correction:** Validate target shot/frame existence and correction package shape before any hydration/dereference. Alternatively, every hydrator failure must throw the typed local-package error, but no target-dependent dereference may precede validation. End-to-end runner tests must cover stale/deleted/malformed target IDs and no-base packages, instrument provider dispatch at zero, and assert persisted retry counts are unchanged.

## 10. Test-quality audit

**Verdict: FAIL as acceptance proof, despite a green and useful test batch.**

The tests are not tautological as a whole. The five reproduction controls do demonstrate that compact reimplementations of the reported old algorithms exhibit the reported failures, and all 19 mutations trip at least one load-bearing assertion. The weakness is boundary selection: several positive suites assert helper behavior or source text while bypassing the actual unsafe writer/dispatcher.

| Area | What is strong | Acceptance gap |
|---|---|---|
| Reproduction controls | All five reproduce the described old algorithm on synthetic fixtures. | They reimplement snippets rather than execute the baseline commit, so they can drift from actual pre-repair reachability. There is no P0-3 reproduction control. |
| Mutation controls | All 19 fire; they are not inert. | They mutate selected helpers, not end-to-end authority, paid dispatch, UI lineage writer, or actual correction runner boundaries. |
| P0-1 | Tests grant rejection, recommendation shape, removed branch text, and projections. | C5 tests a badge projection rather than the human-gate predicate. The positive suite expressly assumes any legacy winner could only be human and then manufactures `humanApproved`; it misses revocation/resume. |
| P0-2 | Tests absent/present/enters variants, withholding, simple negation, and a modeled refusal. | It does not call the real prompt endpoint plus paid job route, inspect the exact final provider payload, or instrument zero provider calls. It misses spatial `before`, `without hesitation`, `not only`, missing `frameId`, correction, and automation raw dispatch. |
| P0-3 | Source assertions verify broad shared-helper wiring. | No dedicated negative controls; no multi-surface legacy-automatic, revoke, replace, delete, reload, and resume convergence scenario. |
| P0-4 | Exact overlapping-ID selection and claim enumeration are exercised. | The expected result grants unclaimed and contested guesses eligibility. Client/server coverage is largely source-pattern verification rather than decision-boundary execution. |
| P0-5 | Pure graph helpers are exhaustively checked for permitted-write acyclicity and the normal chain no longer wraps. | The suite accepts a navigation first-parent write and never exercises the exposed parent dropdown/direct setter that can create a cycle. |
| P0-6 | Reference construction and direct preflight classification cover the enumerated neighbor shapes. | It does not execute `v640AutomateSceneCorrection()` with bad state, assert provider dispatch count zero, or assert persisted retry usage. The actual hydration-before-preflight defect survives. |

The two changed pre-existing expectations are logically required and are **not** improper weakening:

- `tests/current-behavior.js:269` no longer expects the old auto-approval threshold/contract.
- `tests/reference-automation-closed-loop.js:535` now expects a recommendation rather than an authoritative automatic winner.

Those old expectations encoded the unsafe automatic-approval contract and needed to change. The problem is the missing adversarial coverage around legacy consumption and alternate boundaries, not these two edits.

## 11. Full validation receipt

No paid provider calls and no local-model calls were made.

| Command | Exit | Receipt |
|---|---:|---|
| `npm.cmd run check:dogfood2-p0` | `0` | Six focused suites. Positive suite assertions: authority 89, presence 63, ownership 35, lineage 53, correction 47 — **287 total**. Negative suite: **24 controls**, all fired (5 reproduction, 19 mutation). Audit rerun wall time: 6.8s. |
| `npm.cmd run check` | `0` | `CineBraid full verification passed: 166 suites in 89.4s.` |
| `git diff --check` | `0` | No whitespace errors. |

Invoking `npm run …` through PowerShell initially hit the host execution policy for `npm.ps1`; rerunning the identical scripts through `npm.cmd` succeeded. This is a shell invocation issue, not a product test failure.

The full harness's Node browser/render checks ran. Optional Python real-browser checks were unavailable because Python 3 is not installed in this environment. The test shutdown helper printed a Windows process-inspection access warning, but the harness completed and its port-rebind check passed. The working tree remained clean after validation, before creation of this report.

## 12. Regression/scope findings

### Intended contract changes confirmed

- Strong AI scores stop further paid passes and nominate/recommend a candidate rather than invoking the removed automatic approval branch.
- Machine-selected candidates remain visible for review; they do not simply disappear.
- New automation-side approval helpers require a grant.
- Exact overlapping IDs select the most-specific declaration rather than the first prefix in the normal unclaimed case.
- Normal root → child → grandchild continuation no longer wraps to root.
- Correction reference construction no longer dereferences optional previous/next neighbors.
- Human approvals can trigger reconciliation and resume under the normal repaired fixture.

### Unintended or unresolved behavior

- Legacy automatic authority is promoted to gate-satisfying human authority and can be resurrected after revocation.
- The negation detector over-redacts/under-detects based on ordinary words, while alternate generation routes bypass presence enforcement.
- Unclaimed/contested legacy media remain visible by being granted the same eligibility used for review and approval, rather than a read-only compatibility status.
- Lineage navigation still mutates state and the editor can create cycles.
- The real correction runner still misclassifies deterministic local errors.

No unrelated regression was exposed by the 166-suite full run. Automation is not globally deadlocked by the recommendation-only change; the intended human approval/resume path exists. The release blockers concern false progress/authority and unguarded alternate paths, not a total loss of basic workflow.

## 13. Deferral safety assessment

### Reconciled gate represented as `interrupted`

**Safe to defer only after the P0 predicate/revocation corrections; unsafe as currently composed.** The overloaded label and placement under Needs Attention are presentation-level P1 issues if `Waiting for You` has truly been removed and production truth is correct. Today, the same transition can be triggered by a legacy automatic winner, so the deferral participates in false authority. Required now: fix actor-aware and bidirectional reconciliation. Non-blocking later: introduce an explicit resolved/continued terminal semantic instead of overloading `interrupted`.

### Historic contaminated candidate rows not migrated

**Not safe to defer in the current read path.** It is acceptable not to perform a destructive/silent migration in this batch. It is not acceptable to guess an owner for contaminated/unclaimed rows and let that guess enter approval/canon workflows. Required before merge: conservative quarantine/surfacing and no authority eligibility. A separate audited migration tool can remain follow-up work once present reads are safe.

## 14. Any new defects found

“New” here means newly identified by this acceptance audit, not necessarily introduced by commit `8e34d1d`.

1. **Authority revocation resurrection:** a completed/reconciled step can restore a cleared frame/entity winner on resume. Critical, high confidence. Correction: invalidate dependent gate receipts and re-check current durable authority before resume.
2. **Spatial `before` negation false positive:** “X stands before Y” suppresses both withholding and contradiction detection. Critical, high confidence. Correction: mention-scoped semantic negation.
3. **Raw paid-dispatch presence bypass:** automation/correction jobs without `imagePlan: true` send raw prompt text through `fal-generation.js::submit()`. Critical, high confidence. Correction: universal pre-dispatch frame-presence gate.
4. **Exposed lineage editor cycle:** the parent dropdown offers descendants and its setter performs no cycle check. Critical, high confidence. Correction: centralized validated mutation and filtered choices.
5. **Correction hydration-order failure:** stale targets throw a bare `clips` `TypeError` before typed preflight. Critical, high confidence. Correction: validate before hydrate and test the actual runner.
6. **Contested ownership is computed but unused:** conflict detection exists without a production surface, while eligibility still chooses a claimant. Critical, high confidence. Correction: conflict becomes a blocking resolver result consumed everywhere.
7. **OFP automatic-winner semantic loss:** no false human statement is created, but an automatic/unknown legacy winner is still exported as the frame's approved-output asset/reference edge. High, high confidence. Correction: provenance-aware export classification.

## 15. Exact blockers

The following are merge blockers:

1. Establish actor-aware durable authority and require it at every gate/export/consumer; never infer or synthesize human approval from a winner field.
2. Make reconciliation bidirectional and revocation/replacement-aware; remove stale gate-result authority restoration on resume.
3. Replace broad presence-negation substrings and enforce the current frame's presence against the exact final submitted prompt at one universal pre-provider boundary.
4. Preserve structured local-preflight codes through automation so presence/package failures cannot become provider failures or consume retry.
5. Separate legacy filename discoverability from ownership authority; quarantine unclaimed and contested media from review/approval/automation/canon until explicitly claimed.
6. Remove all lineage writes from navigation and route every ancestry mutation, including the exposed parent editor and generic setters, through one acyclic graph validator.
7. Move correction validation before hydration/dereference and prove the actual runner makes zero provider dispatches and consumes zero retry budget for every deterministic malformed/deleted/missing case.
8. Replace helper/source-pattern assertions with end-to-end boundary tests for the counterexamples in this report. Tests must fail on durable false state or attempted provider dispatch, not only on helper return values or source strings.

## 16. Exact non-blocking follow-ups

These items may remain after the blockers are corrected:

1. Replace the overloaded reconciled `interrupted` presentation with an explicit resolved/continued terminal state and place it consistently in Recent Completed.
2. Build an explicit, previewable migration/reconciliation workflow for historic contaminated media rows. The migration itself may be deferred if current reads quarantine them conservatively.
3. Remove the dormant `shared-production-media.js` raw prefix fallback even if the shared resolver is always injected in today's browser composition; fail closed when it is unavailable.
4. Add Python 3 to the audit environment if the optional Python real-browser layer is desired in addition to the Node browser/render harness. This is not evidence of a product defect.
5. Document `npm.cmd` as the Windows-safe invocation where PowerShell script execution policy blocks `npm.ps1`.

## 17. Merge recommendation

**Do not merge `fix/dogfood2-production-trust` at `1670144`.**

The correct disposition is **HOLD — ARCHITECTURAL ISSUE REMAINS**, not merely “corrective commit required”, because the surviving defects share a boundary-design cause: multiple writers and paid-dispatch routes remain capable of bypassing the newly introduced helpers. The next repair should centralize authority commands, ownership resolution, lineage mutation, exact final-prompt presence policy, and correction preflight, then add end-to-end adversarial tests at those centralized boundaries.

Re-audit all six P0s after that work. Green results from the current focused suites should be retained as regression evidence but cannot be reused as acceptance proof without the missing counterexamples.

## 18. Statement confirming no implementation changes were made

No implementation, test, project-data, configuration, provider-state, generated-media, or prior Dogfood-evidence file was modified. No branch was reset, rewritten, merged, or pushed. No provider or local model was called. The sole file created by this audit is this acceptance report:

`docs/dogfood/CINEBRAID_DOGFOOD_2_REPAIR_BATCH_1_ACCEPTANCE_AUDIT.md`

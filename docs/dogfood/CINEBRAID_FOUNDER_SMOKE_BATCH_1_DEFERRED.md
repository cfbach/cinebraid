# Founder Smoke — Batch 1 P0 Trust Repairs: what was deliberately NOT done

**Source:** `CINEBRAID_FOUNDER_SMOKE_FREEZE_2026-08-17.md`
**Branch:** `fix/founder-smoke-p0-trust`, from `5207da1c18077cf54fc3376906d2282fc58a91bd`

> **Correction pass, after the first independent HOLD.** Nothing below changed.
> The corrections were confined to the five named findings — FAL activity
> ownership, the `#/create` competing recommendation, the null-score comparison,
> the removed-consumed-reference freshness gap, and the mutation-control harness.
> Two rules that pass established, worth reading before touching either area:
>
> - **`nextProductionShot()` is deleted, not deprecated.** It was the media-presence
>   project-level answer, and leaving it dormant is what let it keep owning a
>   visible recommendation. The project has exactly one next-action derivation:
>   `projectNextProductionAction()`. `shotProductionNextAction()` remains and labels
>   ONE shot's board chip; it may never speak for the project.
> - **A mutation control is armed, executed and detected in three separate phases**,
>   and a setup failure can never be counted as a detection. See the header of
>   `tests/founder-smoke-p0-trust-negative-controls.js`.

Batch 1 was bounded to the reproduced P0 trust/correctness blockers. Two items
inside P0-7 were deliberately left alone, and this file is the record of why, so
neither is rediscovered as an oversight.

---

## HELD — the H3 target's prompt FORMATTING is unchanged

**Founder observation.** The compiled MiniMax H3 First/Last Frame prompt "looked
like an internal execution-contract dump rather than a well-formed H3-targeted
prompt."

**Why it is held.** The batch instruction is explicit: *"If current H3 formatting
requirements are already encoded in source/tests/docs, reconcile to those. If they
are not sufficiently defined to make a safe formatting change, fix only provable
duplication/freshness defects and explicitly HOLD the target-formatting portion
rather than inventing a new prompt architecture in this pass."*

They **are** encoded. `compileMinimaxH3()` in `prompt-engine.js` is the H3 format,
it has a distinct branch per mode, and the FLF branch already emits a
target-specific prompt: a duration-stamped header, an `ENDPOINT CONTRACT` naming
Image 1 and Image 2, then transition, camera, environment, audio, preserve and
avoid sections. `finalizeMinimaxH3Prompt()` then budgets those sections against
the profile's own character limit with per-section weights. `tests/composer-motion.js`
and `tests/launch-blockers.js` both assert against that shape.

So the founder's reading is a judgement about a **defined** format, not a defect in
it. Rewriting a defined, tested prompt format is a prompt-architecture change, not
a correctness repair, and doing it inside a trust batch would put an unmeasured
change to every H3 render behind a blocker fix. Held for a batch that can measure
it against real generations.

**What WAS fixed in this batch, and is not held:**

- **Duplicate instruction emission.** `minimaxH3DedupeSections()` refuses a section
  whose normalised body repeats an earlier one, and the motion directive parts are
  de-duplicated in `buildGuidedMotionPrompt()` before compilation. Covered by
  `tests/founder-smoke-p0-trust.js` and negative control N14.
- **Freshness.** A compiled package now records its duration, execution method and
  target, `packageStaleReasons()` compares all three, and the ready-to-use motion
  prompt states CURRENT / OUT OF DATE / NOT CHECKED on itself. Negative controls
  N12 and N13.

---

## RECORDED FOR BATCH 3 — the Edit Prompt modal layout

**Founder observation.** `Edit Prompt` opens a horizontally broken/clipped editor.

**Why it is deferred.** The batch instruction: *"The broken Edit Prompt layout may
be repaired only if it is tightly bounded and required to validate the corrected
compiled-prompt path. Otherwise record it for Batch 3."*

It is not required. The corrected compiled-prompt path — compilation,
de-duplication, dependency recording, staleness and the visible marker — is
validated without opening the editor at all, in `tests/founder-smoke-p0-trust.js`
(`testCompiledPromptEmitsOneInstructionOnce`, `testCompiledPackageGoesStale`).

**Where it lives** when Batch 3 picks it up:
`openGuidedMotionPromptEditor()` in `public/creation-studio.js` opens
`.motion-prompt-editor-modal`; the modal standard the freeze asks for (top-right
`×`, no horizontal overflow, sticky actions) is a P2 consistency item across every
modal, not a change to this one.

---

## Not in scope at all

Everything under sections 4 (P1 — structural UX reframe) and 5 (P2 —
consistency/polish) of the freeze. None of it was started. In particular: project
onboarding/import, the Reference workflow reframe, adaptive Shot Intent, Activity/
Braidy consolidation beyond the project isolation P0-1 required, model/provider
Simple vs Advanced, Finalize & Send, pagination and filter defaults, Project Bible
compaction, Generated Media role redesign, and Reports → Analytics.

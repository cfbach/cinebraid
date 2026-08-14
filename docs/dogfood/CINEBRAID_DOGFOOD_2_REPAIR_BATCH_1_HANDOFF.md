# CineBraid Dogfood #2 — Repair Batch 1 Handoff

## Production Trust / Authority / Data Integrity

**Date:** 2026-08-14
**Batch:** Dogfood #2 Repair Batch 1 (P0 trust cluster)
**Document type:** Handoff. Repairs implemented; **not merged to `main`.**

---

# 1. Branch

`fix/dogfood2-production-trust`

Created from the exact Dogfood #2 baseline. No history was rewritten.

# 2. Starting SHA

`afe1853ce2fa69f43489822c0e86d5a4c45ea3f6` — `main`, matching the baseline both
canonical reports name. Working tree at Phase 0 contained **no source
modifications**: the only entries were the two untracked Dogfood reports plus one
byte-identical duplicate of the forensic audit at the repository root.

| Phase 0 receipt | Value |
|---|---|
| Repository root | `C:/CineBraid/CineBraid-Source` |
| Branch at start | `main` |
| HEAD | `afe1853ce2fa69f43489822c0e86d5a4c45ea3f6` |
| `origin/main` | `afe1853ce2fa69f43489822c0e86d5a4c45ea3f6` |
| Ahead / behind | `0 / 0` |
| Modified source files | none |
| Untracked | `docs/dogfood/CINEBRAID_DOGFOOD_2_FORENSIC_AUDIT.md`, `docs/dogfood/CINEBRAID_DOGFOOD_PASS_2_CLOSEOUT_2026-08-14.md`, `CINEBRAID_DOGFOOD_2_FORENSIC_AUDIT.md` (root) |

# 3. Documentation-checkpoint SHA

`9e64137588d01c63716e9d785fc41f0b31f07fac` — `docs: checkpoint dogfood pass 2 evidence`

Contains exactly two files and **no source changes**:

```
docs/dogfood/CINEBRAID_DOGFOOD_2_FORENSIC_AUDIT.md            | 407 +++++
docs/dogfood/CINEBRAID_DOGFOOD_PASS_2_CLOSEOUT_2026-08-14.md  | 811 +++++
2 files changed, 1218 insertions(+)
```

**One file was moved, and it is worth stating plainly.** A third untracked file,
`CINEBRAID_DOGFOOD_2_FORENSIC_AUDIT.md` at the repository root, was a byte-identical
duplicate of the canonical copy (`SHA256 A90DE8F8…3FC17A0E`, verified equal before
and after). It tripped the repository-hygiene check in `tests/current-behavior.js`,
which caps root-level markdown. It was **moved, not deleted**, to the session
scratchpad at
`…/scratchpad/CINEBRAID_DOGFOOD_2_FORENSIC_AUDIT.root-duplicate.md`. The canonical
copy is committed and unmodified; no evidence was lost.

# 4. Final repair HEAD

`8e34d1d5c768311767f9e2b3454cafb72870b7a1`

# 5. Exact commits

| SHA | Subject |
|---|---|
| `9e64137` | `docs: checkpoint dogfood pass 2 evidence` |
| `8e34d1d` | `fix: enforce human-only production authority and close the Dogfood #2 P0 cluster` |
| *(this document)* | `docs: dogfood #2 repair batch 1 handoff` |

# 6. Files changed

## New shared boundaries (4)

| File | Owns |
|---|---|
| `public/shared-production-authority.js` | Who may establish production authority (P0-1); when a parked human gate is satisfied (P0-3) |
| `public/shared-frame-presence.js` | Frame-specific presence, and the contradiction check (P0-2) |
| `public/shared-entity-ownership.js` | Which entity owns a media file (P0-4) |
| `public/shared-state-lineage.js` | Continuity-state lineage and continuation (P0-5) |

## Modified source (17)

| File | Change |
|---|---|
| `public/automation.js` | Authority guard on `v626ApproveFrame` / `v626ApproveEntity`; auto-approval branch replaced by recommendation + gate; resumed-review path requires a human decision; `V627_AUTOMATION_RECOMMENDATION_SCORE`; failure classification; frame-presence preflight |
| `public/scene-automation.js` | Correction approval requires a human decision; optional neighbour anchors; correction preflight; classified package error; recommendation threshold relabelled |
| `public/library-tools.js` | Lineage-safe continuation and reveal; no reparent from navigation; reconciliation after both approval paths |
| `public/live-activity.js` | Gate-aware waiting predicate; `Recheck status`; `v670ReconcileAfterApproval` |
| `public/entities.js` | `entityMedia()` routed through exact ownership |
| `public/planning.js` | Prompt-provenance media reader routed through exact ownership |
| `public/app.js` | `mediaByPrefix` deleted; provenance-aware winner badge |
| `public/creation-studio.js` | Per-frame presence control and writer; frame id sent with every frame compile |
| `public/shared-production-media.js` | `machine-selected` decision state; actor resolution from automation provenance |
| `public/media-inspector.js` | Words for `machine-selected` |
| `public/reports.js` | "Human approvals" counts only human approvals |
| `public/styles.css` | Frame-presence panel; machine-pick badge |
| `public/index.html` | Four new module tags |
| `prompt-engine.js` | `buildContext` takes a frame; presence-aware `defaultSpec`; declaration is fallback-only in `validateSpec` |
| `server.js` | Frame id on `/api/prompt/compile`; contradiction refusal; exact ownership in batch review and Bible export |
| `automation-runs.js` | Gate reconciliation on read; `Recheck status` route; `shotId` / `failureClass` / `remediation` persisted; retry no longer consumed by deterministic faults; approval counting corrected |
| `package.json` | Six new scripts, `check:dogfood2-p0` aggregate, syntax checks, wired into `check:quick` and `check:ci` |

## Modified tests (4)

`tests/render-harness.js` (SCRIPT_ORDER), `tests/run-full-check.js` (registry),
`tests/current-behavior.js` (file manifest + one changed expectation),
`tests/reference-automation-closed-loop.js` (one changed expectation).

# 7. Tests added

| Suite | Checks | Covers |
|---|---|---|
| `tests/production-authority.js` | 89 | P0-1 + P0-3 |
| `tests/frame-presence-authority.js` | 63 | P0-2 |
| `tests/entity-media-ownership.js` | 35 | P0-4 |
| `tests/state-lineage-safety.js` | 53 | P0-5 |
| `tests/continuity-correction-boundary.js` | 47 | P0-6 |
| `tests/dogfood2-p0-negative-controls.js` | 24 controls | all six |

The negative-control suite uses two techniques deliberately:

- **19 mutation controls** rebuild a repaired module **in memory** from broken
  source and require the invariant to fail. Every mutation carries a probe
  receipt asserting the text it replaces was present, so a control cannot become
  a silent no-op after a refactor.
- **5 reproduction controls** run the **pre-repair implementations**, written out
  inline, against the same fixtures the positive suites use, and require them to
  exhibit the reported defect. These answer the question a mutation control
  cannot: *is the fixture capable of triggering the bug at all?*

Nothing on disk is modified by any control — the specific reason being that a
control "restored" by a checkout has, on this repository, silently discarded real
unstaged work before.

# 8. Tests run and results

**Full verification: `npm run check` — 166 suites, 144.2s, exit 0.** This
includes the real-browser Playwright harnesses (`check:browser-real`,
`check:alpha-loop-browser`, `check:focused-browser`, `check:ui-state`,
`check:state-honesty-browser`, `check:board-density-browser` and the rest).

Explicitly confirmed within that run:

| Category | Suites | Result |
|---|---|---|
| Syntax | `check:syntax` (all sources incl. 4 new modules) | pass |
| New P0 suites | the six above | pass |
| Existing state-honesty / authority negative controls | `check:state-honesty`, `check:state-honesty-negative`, `check:alpha-loop`, `check:alpha-loop-negative`, `check:candidate-review-negative`, `check:production-media-negative` | pass |
| Continuity & reference | `check:continuity-core` (10), `check:reference-loop`, `check:reference-contract`, `check:reference-authority`, `check:continuity-correction`, `check:correction-modal` | pass |
| OFP / authority contracts | `check:ofp-core` (8) | pass |
| Render & browser harnesses | `check:render`, `check:browser`, `check:browser-real`, `check:ui-state`, `check:focused-browser`, `check:alpha-loop-browser` | pass |
| Preflight & state authority | `check:frame-preflight(-negative)`, `check:state-authority(-negative)`, `check:state-binding(-negative)` | pass |

## The two expectations that changed, and why

Both encoded the unsafe behaviour rather than a property worth keeping. Neither
was updated to match new output; each was rewritten to assert the *correct*
invariant, with the reasoning recorded in place.

1. **`tests/current-behavior.js:269`** — asserted
   `V627_AUTOMATION_AUTO_APPROVE_SCORE = 85` under the message *"automatic
   approval must use the explicit strong-pass threshold"*. The finding is that
   the constant did not merely have that name — it **performed** an automatic
   approval. Asserting the old name would assert that CineBraid still calls that
   act an approval. Replaced by two assertions: the threshold still exists,
   explicitly, at 85 under `V627_AUTOMATION_RECOMMENDATION_SCORE`; **and** the
   old identifier must not be declared.
2. **`tests/reference-automation-closed-loop.js:535`** — same constant, same
   rename. That suite's own headline property (`testStrongPassStopsWithoutApproving`)
   is exactly the behaviour the entity chain has always had and the shot chain
   now has too; the assertion is unchanged apart from the name.

Both are covered by `tests/production-authority.js` §3 and negative controls
C1–C5.

# 9. P0-by-P0 implementation summary

## P0-1 — Human-only production authority *(A1 / F1)*

Four facts are now separable records and none may be read as another:
`ai-review`, `ai-recommendation`, `automation-selection`, `human-authority`.

- `v626ApproveFrame` and `v626ApproveEntity` take a **grant** and call
  `assertHumanAuthority`, which requires both `actor: "human"` and
  `act: "explicit-approval"`. An omitted argument — what every machine call site
  actually passed — throws.
- The auto-approve branch is **gone**. A strong pass calls
  `v627RecordFrameRecommendation`, which writes a nomination carrying file,
  score, threshold, rationale, run and step, and explicitly *not* a winner, an
  approval timestamp or a human mark. It then stops further paid passes and
  calls `v627PauseForHumanReview`.
- The **resumed completed review** path now requires `result.humanApproved`. A
  completed passing review nobody decided re-parks at the gate instead of being
  approved on resume.
- **Correction automation** approves only on `result.humanApproved`; the
  `autoApprove` disjunct is removed and the package records `director`.
- The threshold survives at **85** as `V627_AUTOMATION_RECOMMENDATION_SCORE`; the
  stored config key `autoApproveScore` is still read so saved runs keep their
  setting. The UI label is now *Recommendation threshold* with the sentence
  "Approval stays yours."

## P0-2 — Frame-specific temporal presence *(A3 / F6)*

- New declaration `shot.creationBrief.frameWorkflows[frameId].entityPresence`,
  sitting beside the per-frame **state** selections that already existed, with
  the same **absence-means-inherit** rule.
- Vocabulary `absent | present | enters | exits`. Only `absent` forbids positive
  presence — `enters` and `exits` describe moments in which the entity *is* on
  screen for part of the frame.
- `PromptEngine.buildContext(P, shotId, segmentId, { frameId })` resolves it.
  `defaultSpec` then excludes the absent entity from identity canon, drift
  restatements, visual grounding, must-preserve, blocking entities and prompt
  entities — **in both the primary and the fallback arm**, the fallback being the
  path that used every character reference on the shot.
- Whole-shot narrative naming an absent entity (`shot.desc`, `scene.whatHappens`,
  `shot.positioning`) is **withheld in full** and the withholding recorded and
  reported, because a partial redaction of authored prose produces a sentence
  nobody wrote.
- The absence is **stated**, not merely omitted: an explicit `mustAvoid` entry
  naming reflections, shadows, silhouettes and background figures.
- The reference **stays attached**. Attachment and presence are different facts.
- A minimal writer (`setFramePresence`) and a compact panel on the frame card
  make the contract reachable. Shot Setup as a whole was **not** redesigned.

## P0-3 — Human-gate reconciliation *(A2 / F2)*

One boundary — `reconcileRunGates` / `gateSatisfied` / `applyGateReconciliation` —
consumed from every entry point rather than filtered per surface:

| Entry point | Mechanism |
|---|---|
| Activity polling, reload, workspace entry | `readReconciled()` on `GET /api/automation/runs` and `/:id` — the durable ledger converges and is written back |
| Any render | `v670RunGateOutstanding` inside `v670WaitingForHumanRun`, using the same shared functions |
| Human approval / rejection elsewhere | `v670ReconcileAfterApproval` from both approval paths, flushing the project first |
| Run resume | reads the ledger, so it reconciles |
| Manual | `POST /api/automation/runs/recheck` behind a **Recheck status** control |

Only `awaiting-review` runs are reconciled, so a revision bump cannot race an
active runner. The write is best-effort; the answer is reconciled either way.

## P0-4 — Exact entity/media ownership *(A4 / F4)*

Ownership is decided in one order:

1. an **uncontested durable claim** — a candidate row or an approval pointer
   (entity primary, continuity state, coverage slot, expression slot);
2. a **contested claim falls through and is reported**, never silently resolved;
3. **no claim**: the **most specific** declared prefix, with a tie attributing to
   nobody.

Applied at `public/entities.js` (`entityMedia`, the reader every entity surface
uses), `public/planning.js`, `server.js` batch review, and `server.js` Bible
export. `mediaByPrefix` is **deleted** rather than deprecated. No filename
special-case exists anywhere in the repair, and a test asserts the repair does
not name the dogfood entities.

## P0-5 — State lineage safety *(A6 / F5)*

- Navigation **never** mutates lineage. `nextState.parentStateId = targetStateId`
  is replaced by `safeParentAssignment`, which permits exactly one write:
  establishing a **first** parent on a state that declares none, and only when
  the result stays acyclic.
- Continuation candidates exclude the current state **and every ancestor**.
- A finished chain returns `kind: "complete"` with a reason instead of wrapping
  to the root.
- Derivation copy is read from the graph, so the direction cannot be presented
  backwards.
- `revealEntityContinuityState` now selects the **Coverage** task as well as the
  subview and state, and re-renders — so a continuation launched from Review
  lands on the editor rather than back on Review.
- The requested next-state id is **re-validated at the writer**, so a stale form
  cannot move a creator onto an ancestor.

## P0-6 — Correction boundary safety *(A5 / F7)*

- `v640SceneApprovedStill` answers `null` for a missing shot instead of reading
  `.id` off `undefined`.
- Previous and next are **optional**; only the target is structurally required.
  Omissions are recorded with distinct reasons: `scene-boundary`,
  `shot-no-longer-exists`, `no-approved-still`.
- `v640SceneCorrectionPreflight` fails clearly, ahead of any provider code, with
  the missing thing named and a remediation.
- `v640CorrectionPackageError` marks the fault `local-package`; `v626FailStep`
  persists the class; the retry route **does not advance the attempt counter**
  for a deterministic fault. The step is still reset, because the creator may
  have repaired the project state — but nothing was attempted against a provider,
  so nothing was spent.

# 10. Authority invariant proof

**Claim:** no automated review, at any score, on any path, establishes production
authority.

| Evidence | Where |
|---|---|
| The grant requires actor **and** act; `undefined`, `{}`, `true`, actor-only, act-only and `actor: "automation"` are all refused | `production-authority.js` §1 |
| The refusal is a recognisable `HUMAN_AUTHORITY_REQUIRED` / `authorityViolation` error, so a runner cannot mistake it for a transient fault | §1 |
| A nomination carries no `winner`, no `approvedAt`, no `humanApproved`, and states `requiresHumanApproval` | §2 |
| No auto-approve branch remains on the frame path or the correction path | §3 |
| Every call of both authority writers, in both automation files, carries a grant — counted, not spot-checked | §3 |
| Resume re-states only an approval a human made | §3 |
| **Reproduction:** the pre-repair condition fires on a 92/100 explicit pass, so the branch was genuinely reachable | negative controls R1 |
| A truthy-accepting guard, a nomination carrying a winner, and an actor-blind projection each break the invariant | controls C1, C2, C5 |

**Projection half.** A winner edge whose only recorded actor is `automatic`
reports `humanDecision.state === "machine-selected"` with `actor === "automation"`;
`director` reports `approved` / `human`; `reused` reports `approved` /
`prior-human`; an unrecorded edge stays `approved` with the actor
**not-recorded** rather than assumed. The Inspector prints "Selected by
automation", never "Approved by you". The board badge reads provenance. The run
report and the per-shot operational summary count only `humanApproved`.

**Export.** `ofp/ofp-validate.js` already refuses an `approved` statement whose
actor is not human (`statement.actor.not-human`, severity error), and the
migration emits statements **only where it guesses** — it never converts a
`frame.winner` into an approval statement. So the contract layer was not
violated by the shipped defect: it was confined to the runtime writer and the
presentation, which is the narrower of the two dispositions the closeout
described. *(This answers forensic audit item 2's second and third questions.)*

# 11. Frame-presence invariant proof

**Claim:** an entity a frame declares absent contributes no positive subject or
action fact to that frame, and a surviving contradiction stops the request before
a provider sees it.

Fixture: three frames — `absent` → `enters` → `present` — for a named character,
alongside a second character present throughout and a location.

| Assertion | Result |
|---|---|
| Frame A identity canon naming the absent character | none |
| Frame A prompt entities | the other character only |
| Frame A visual grounding / blocking entities for the absent character | none |
| Shot description, scene beat and positioning naming him | all withheld, each recorded |
| Compiled subject / actions | no mention |
| `mustAvoid` | explicit "must not appear … including reflections, shadows, silhouettes and background figures" |
| Middle frame (`enters`) | descriptor present, description not withheld |
| End frame (`present`) | descriptor and identity canon intact, no absence requirement |
| A shot declaring nothing | compiles exactly as before — the contract is opt-in |
| The absent character's **reference** | still attached |

The contradiction detector is negation-aware and clause-level: "No Chimbley Sweep
visible", "not yet visible", "without", "off-screen" and "before … appears" are
all accepted, while a positive clause in the same passage is still caught. The
short form ("The Sweep") is derived from capitalised name parts — a lowercase
part such as "case" is deliberately **not** derived, so "in case of rain" cannot
false-positive. `/api/prompt/compile` returns **409 `FRAME_PRESENCE_CONTRADICTION`**
with the contradictions and the compiled prompt, and says nothing was sent to a
provider. `v626ShotPreflight` refuses the run earlier still.

# 12. Reconciliation proof

**Claim:** a gate is actionable only while the authority it waits for does not
exist, and every surface converges.

| Assertion | Result |
|---|---|
| Frame gate, entity-state gate and scene-correction gate identified from their own step records | pass |
| A gate whose object cannot be identified reports nothing rather than guessing | pass |
| Unapproved frame → outstanding; approved frame → satisfied; opening-frame authority on the shot also satisfies | pass |
| A declared non-default state is **not** satisfied by the entity's primary file | pass (control C3) |
| Planning mutates nothing — a render may ask the question | pass |
| Applying the plan completes the step, marks `humanApproved` and `satisfiedByReconciliation`, and moves the run off `awaiting-review` | pass |
| A gate that cannot be identified stays actionable in **both** the module and the browser predicate | pass (control C4) |
| Server reconciles on read, only for parked runs | pass |
| Browser predicate uses the same shared functions | pass |
| Both approval paths outside the run modal trigger reconciliation — exactly two call sites | pass |
| Dismissal writes no approval edge | pass |

**Known limitation, stated rather than hidden.** A reconciled run moves to
`interrupted`, which is the run ledger's existing word for "stopped; a person may
resume" and the same status an in-modal approval sets. It is **not** marked
`completed`, because the rest of the chain never ran and claiming completion
would replace one dishonesty with another. `interrupted` is currently classified
as *needs attention* rather than *recent completed* by `v670AttentionRun` — the
forensic audit and prior work both record that `interrupted` is overloaded, and
splitting it touches the dispatch path. The run's summary states plainly that the
approval was made elsewhere and the run can be resumed. **`Waiting for you` is
correct; the "briefly under Recent completed" placement is deferred** with the
`interrupted` split.

# 13. Exact-ownership proof

Fixture: `CHAR-SWEEP`, `CHAR-SWEEP-YOUNG` (three candidates, as reported) and the
unrelated control `CHAR-WIDOW`.

| Assertion | Result |
|---|---|
| Adult sees exactly its own two files | pass |
| Child sees all three of its own | pass |
| Unrelated control unaffected | pass |
| Each child file ineligible for the adult, eligible for the child | pass |
| Unclaimed hand-imported file resolves to the **most specific** prefix and is visible to its owner | pass |
| A project with no candidate rows at all still resolves correctly | pass |
| Two entities declaring an identical prefix attribute to nobody | pass |
| A contaminated project (adult holding a stale row for a child's file) reports the contest, attributes to the child, and does not give the adult the bytes back | pass |
| Every claim source enumerated, coverage and expression slots included | pass |
| Prefix reader removed from client selector, provenance reader, server batch review and Bible export | pass |
| The repair names no dogfood entity — ownership is a rule, not a special case | pass |
| **Reproduction:** the deleted prefix lookup leaks exactly three child candidates and leaves the Widow clean | pass |

**Migration is documented, not performed** — see §16.

# 14. Lineage acyclicity proof

Fixture: `root → child → grandchild`, plus a sibling.

| Assertion | Result |
|---|---|
| Approve root, edit child | offered, and it is a direct child |
| Approve child, edit grandchild | offered and suggested |
| Approve final grandchild | `kind: "complete"`, nothing suggested, reason `no-further-states` |
| Attempt ancestor continuation | not a candidate; `isValidContinuation` false; the writer refuses with `navigation-may-not-reparent` |
| Parent ids after any navigation | unchanged |
| Reparent that would close a cycle, even explicitly | refused with `would-create-cycle` |
| **Exhaustive:** every permitted write applied over every node pair | graph stays acyclic |
| A project that **already** carries a cycle | detected and named; ancestry terminates at the repeat rather than looping |
| Derivation copy | read from the graph, so direction cannot be reversed |
| Reveal | selects Coverage task, subview, state, and re-renders |
| **Reproduction:** the cyclic rotation offers the root after the grandchild, and the unconditional reparent closes a real cycle | pass |

# 15. Correction-boundary proof

| Case | Result |
|---|---|
| First shot (no previous) | builds; keeps the **next** anchor; omits previous as `scene-boundary` |
| Last shot (no next) | builds; keeps the **previous** anchor; omits next as `scene-boundary` |
| Middle shot | builds; keeps **both** — the ordinary case is unchanged |
| Single-shot scene | builds; target only; no continuity anchors |
| Deleted neighbour | builds; omits as `shot-no-longer-exists` |
| Neighbour exists but has no approved still | builds; omits as `no-approved-still`; the other neighbour still used |
| Missing / deleted **target** | preflight fails with the missing thing named and a remediation |
| Target with nothing approved | preflight fails — a correction edits an approved image |
| Deterministic fault | classified `local-package`; retry does **not** advance the attempt counter |
| Ordinary failure | still `provider`; retry path unchanged |
| **Reproduction:** the pre-repair path produces the exact reported `Cannot read properties of undefined (reading 'id')` | pass |

No test reaches a provider. The harness intercepts `fetch`, and the whole point
of the repair is that these paths resolve before provider code.

# 16. Known remaining P1/P2 findings

Everything below is **untouched by this batch**, as instructed.

## Discovered or confirmed during this batch

1. **Contaminated candidate rows need a migration plan.** A project where a
   creator reviewed a child's candidate from the parent's pool now carries a
   candidate row on the wrong entity. The repair **reports** these
   (`contestedOwnership`) and attributes the file correctly, but deliberately
   does **not** rewrite the stored rows — that is preserved Dogfood #2 evidence
   and needs a separately reviewed migration. No migration was written.
2. **`interrupted` is overloaded** (see §12). A reconciled gate, a
   director-approved resumable run and a genuinely interrupted run share one
   status. Splitting it touches the dispatch path.
3. **Presence declarations are not yet in OFP.** `entityPresence` lives in the
   runtime record beside the per-frame state selections, which OFP currently
   carries as an opaque legacy blob. A canonical `continuity` extension is a P1
   format decision; `readShotPresenceBindings` already returns the shape it would
   serialize.
4. **`framePresenceContradictions` errs toward flagging.** For creator prose, an
   unrecognised way of expressing absence produces a blocked compile with the
   exact clause quoted. That direction is deliberate — the other direction is a
   wrong paid render — but the marker list will need widening from real use.

## Carried forward from the closeout, unchanged

**P1:** A7 `Take me there` destination resolution · A8 provider contention
reported as failure · A9 Motion Units cannot be removed · A10 duration integrity
(float leak and the unexplained `5 → 6`) · A11 re-render destroys UI state and
duplicates keyed rows · A12 nested preview closes parent dialog · C2 verdict-led
scoring · B11 cost honesty in the Terminal · B12 provider-aware scheduler.

**P2:** C1, C4, C5, C6, C7, C8, C9 and the presentation half of B5.

**Design briefs (§10 of the closeout):** all three remain unwritten and unstarted,
as instructed.

## Forensic audit items now answered

- **Item 1 (A3):** the compilation site is `PromptEngine.buildContext` /
  `defaultSpec`, entered from `/api/prompt/compile`; the override point is the
  per-frame declaration resolved into the context. **Fixed.**
- **Item 2 (A1):** the branch fires under default config; **OFP export never
  emitted an automation-written winner as a human approval** (§10); the badge did
  not read provenance and now does. **Fixed.**
- **Item 3 (A4):** the review candidate list was filtered by filename prefix in
  `entityMedia()`; the Widow was unaffected because nothing overlaps her id.
  **Fixed.**
- **Item 4 (A5):** the undefined object is the neighbour shot resolved from an
  empty boundary id. **Fixed.**
- Items 5 (A10 duration), 6 (A11 live updates) and 7 (C4 live composer) are P1/P2
  and remain open.

# 17. Provider-call confirmation

**No paid provider call was made.** No FAL, H3, GPT Image, or other hosted
generation endpoint was contacted at any point in this batch.

**No local model call was made either.** No Qwen / Ollama endpoint was contacted.

Every new test is either a pure-function test over literals, a source assertion,
or an in-process render through the existing vm harness, which intercepts
`fetch`. The real-browser suites in `npm run check` run against a locally
launched CineBraid with provider access unconfigured, exactly as they do on
`main`. The contradiction refusal and the correction preflight are both
positioned so that the paths they guard resolve **before** any provider code is
reached — which is the property the tests assert.

# 18. Dogfood-evidence confirmation

**The preserved Dogfood #2 project state was not modified.** No file under a
project directory, no `project.json`, no `automation-runs.json`, no
`generation-jobs.json` and no generated media was read for mutation or written at
any point.

- No historic candidate ownership was rewritten.
- No historic authority edge was rewritten. A pre-repair automation-written
  winner remains exactly where it is; what changed is that every projection now
  reports **who** wrote it.
- No lineage record was repaired. An existing cycle is **detected and reported**
  by `lineageCycles`, not silently corrected.
- No automation-run ledger was edited retroactively. Gate reconciliation only
  ever acts on a run that is currently `awaiting-review`, and only to record that
  the authority it was waiting for now exists.
- **Neither canonical Dogfood report was modified after the documentation
  checkpoint.** Both are byte-identical to `9e64137`.

The single file that moved is described in §3: a byte-identical root-level
duplicate, moved to the scratchpad rather than deleted.

---

# 19. Status

- Branch `fix/dogfood2-production-trust` at `8e34d1d` plus this document.
- **Not merged to `main`.**
- Full verification green: 166 suites.
- **Stopping here for human review.**

*Prior documents: `docs/dogfood/CINEBRAID_DOGFOOD_PASS_2_CLOSEOUT_2026-08-14.md`,
`docs/dogfood/CINEBRAID_DOGFOOD_2_FORENSIC_AUDIT.md`.*

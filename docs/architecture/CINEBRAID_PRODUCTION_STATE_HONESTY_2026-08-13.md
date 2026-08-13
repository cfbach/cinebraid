# CineBraid — Production-State Honesty (Runtime Integrity Pass)

**Date:** 2026-08-13
**Batch:** Production-State Honesty, following Generation Truth / Routing
**Status:** implemented, verified, **uncommitted** on `main`

---

## 0. The question this batch answers

P4 made CineBraid truthful about **media**. Generation Truth made it truthful about
**what it would generate**. This batch makes it truthful about **what is happening right
now**.

A filmmaker looking at CineBraid must be able to tell these apart:

| The screen should say | When |
| --- | --- |
| **RUNNING** | machine or provider work is actually executing |
| **WAITING FOR YOU** | machine work has stopped and a person must act |
| **NEEDS ATTENTION** | the run failed, was interrupted or was cancelled |
| **COMPLETED** | the work finished |

Before this batch it said RUNNING for all four, kept a clock counting, and span a
spinner — because the aggregate readers asked "does an automation run exist?" rather
than "is anything happening?".

---

## 1. Baseline

Established before any edit, and proven from the repository rather than from chat.

| Fact | Value |
| --- | --- |
| Branch | `main` |
| HEAD | `b99469927ca5845e0809d20a5af3938b2753e3b0` |
| `main` == `origin/main` | yes (both `b994699`) |
| Working tree at start | clean |
| App version | `6.7.0-private.1` |
| OFP contract version | `1.0-draft.1` (`ofp/ofp-format.js`) |

Containment proven with `git merge-base --is-ancestor <sha> HEAD`:

| Required work | Commit | Contained |
| --- | --- | --- |
| P4-SEM C1 media asset activation | `a89f6db` | yes |
| P4-SEM C2 media disposition | `13273a1` | yes |
| P4-SEM C3 shot media identity | `3851577` | yes |
| P4-SEM C4 job media identity | `6408eeb` | yes |
| Project save revision race fix | `0517186` | yes |
| Generation Truth / routing | `f3830dae5490142919a0b651f0d2c247e11e5a7c` | yes |

Baseline gates, run before implementation:

* `npm run check:quick` — **exit 0**
* `npm run check:browser-gate` — **exit 0**: 16 gated suites each launched a real
  Chromium (151.0.7922.34) and passed; 3 quarantined suites launched and failed exactly
  as recorded; 29 files under `data/` and `projects/` byte-identical afterwards.

Baseline was green, so implementation proceeded.

---

## 2. The state model as it was

### 2.1 The vocabulary

`automation-runs.js` declares the durable vocabulary:

```
RUN_STATUSES  = running, interrupted, awaiting-review, completed, failed, cancelled, archived
STEP_STATUSES = pending, running, completed, needs-review, failed, cancelled, skipped
```

`ACTIVE_STATUSES` in that file (`running, interrupted, awaiting-review, failed,
cancelled`) is a **retention** predicate — it decides which runs survive pruning — and
is not, and never was, an "is it working" predicate. Nothing in the UI read it.

### 2.2 Writer / reader map (before)

| State | Written by | Read by | Timer | Counted active | Shown as |
| --- | --- | --- | --- | --- | --- |
| run `running` | `v626CreateRun` (`automation.js:191`) | 6 readers in `live-activity.js` | ticks | **yes** | spinner, "N active" |
| run `awaiting-review` | `v627PauseForHumanReview` (`automation.js:1188`) | same 6 readers | ticks | **yes** | spinner, "N active" |
| run `interrupted` | `approveAutomationCandidate` (2361), `requestAnotherRound` (2332), scene child gate (`scene-automation.js:294`) | attention readers | frozen | no | "need attention" |
| run `failed` / `cancelled` | run finishers | attention readers | frozen | no | "need attention" |
| run `completed` | `v626FinishRun` | completed readers | frozen | no | "✓" |
| step `running` | `v626BeginStep` (348) | `v641CurrentOperationMarkup`, `v641StepTimelineRow` | ticks | — | "WORKING" |
| step `needs-review` | `v627PauseForHumanReview` (1186), `scene-automation.js:293` | same | **ticks** | — | "APPROVAL" |
| step `completed` | `v626CompleteStep` (357, stamps `completedAt`) | same | frozen | — | "DONE" |

The literal `["running", "awaiting-review"]` appeared in **six** places in
`public/live-activity.js` — the drawer row spinner (208), the sort (221–222), the
toolbar/strip aggregate (254), the drawer sections (302), the toggle button (352) and
the poll gate (366). Six copies of one idea is how the idea drifted from its meaning.

### 2.3 The two predicates this batch introduces

One question, one answer, asked by every surface:

```js
v670MachineActiveRun(run)     // is machine work actually executing?
v670WaitingForHumanRun(run)   // has it stopped, waiting on a person?
v670RunUnsettled(run)         // still open (either of the above) — polling only
```

`v670MachineActiveRun` is `status === "running"` **and** somebody is driving it:

* this window holds it (`V626_ACTIVE_AUTOMATION_RUNS`), or
* the server lease is still in the future (`leaseExpiresAt`), or
* no runner has ever been recorded — the run is mid-claim.

That last clause exists so a run does not flash "waiting for you" between
`v626CreateRun` and `v627AcquireAutomationLease`. The lease is a 5-minute TTL with a
60-second heartbeat (`automation-runs.js:11-12`), so a genuinely live run has a 5×
margin, and it is **already** the authority `v626StatusLabel` uses to say
`ACTIVE IN ANOTHER WINDOW` / `READY TO RESUME`. This reuses that authority rather than
inventing a second opinion about the same fact.

**Deliberately not merged:** the poll gate. A run parked at an approval gate must keep
being refreshed, because the approval may arrive in another window. That is
`v670RunUnsettled`, and it is a different question from "is it active".

**Deliberately unchanged:** `v641StatusTone`. Its per-step presentation was already
correct — `needs-review` reads as `review` → "APPROVAL", not "WORKING". The brief asked
that it not be churned for aesthetics, and it was not.

---

## 3. Proven defects

Every one was reproduced in a real Chromium against merged `main` **before** any edit,
using a disposable sandbox (`scripts/qa-sandbox.js`) with seeded run records. Recon
findings were treated as claims to test, not as permission to patch.

### Runtime receipt — before

```
A/E  runs present: ['proof-awaiting=awaiting-review', 'proof-orphan=running', 'proof-failed=failed']
A/E  v6602ActivityStatus -> tone='active' label='Activity · 2 active'
A/E  activity button reads '◌2 activeFRAME REVIEW', spinner=True
A    drawer heading: '2 operations active'
A    ACTIVE NOW contains the awaiting-review run: True
E    ACTIVE NOW contains the lapsed-lease run: True
A/E  spinners inside ACTIVE NOW: 2
B    step status='needs-review' completedAt='(never stamped)'
B    elapsed at t0 10:06 -> at t0+3s 10:09
C    control under the pointer was 'DISMISS'; still attached after one 3.5s refresh: False
D    attempts the panel displays:  ['blocking-frame-b']
D    attempts the reader returns:  []
D    REVIEW ALL WITH AI answered: 'Add at least one blocking attempt first'
```

### A — `awaiting-review` counted as ACTIVE

**Confirmed** at `live-activity.js:254` and `:302` as the recon reported, **and at four
more sites** the recon did not name: `:208`, `:221-222`, `:352`, `:366`. A run parked
at a human gate raised the global Active count, sat in ACTIVE NOW, and span.

### B — the elapsed clock never stopped

**Confirmed, with a more precise cause than the recon stated.** `v641ElapsedLabel`
does fall back to `Date.now()` — but `v626CompleteStep` (`automation.js:357`) *does*
stamp `completedAt`, including for `needs-review` results. The leak is that
`v627PauseForHumanReview` (`automation.js:1186`) and the scene child-review gate
(`scene-automation.js:293`) set `status = "needs-review"` and `updatedAt` and **never
stamp `completedAt` at all**. Those two writers are the defect; the fallback merely
exposed it.

### C — the drawer refresh detached controls mid-interaction

**Confirmed.** `V641_ACTIVITY_REFRESH_MS = 3500` → `refreshGlobalAutomationActivity` →
`v641RenderActivityDrawer` → `drawer.innerHTML = …`, unconditionally, whether or not
anything changed. A `DISMISS` button held under the pointer was **not connected** after
a single tick. This is the proven cause of the intermittent `check:browser-real`
timeout recorded in memory.

### D — a visible blocking attempt was invisible to its reviewer

**Confirmed, and the recon's proposed reading was wrong in an important way.**

The recon suggested `v664BlockingRowsForReview` (`automation.js:615`) was at fault for
partitioning on `blockingFrameId`. It is not. The partition is **real and load-bearing**:

* an attempt with **no** `blockingFrameId` is a candidate for the shot-wide opening
  guide — what `useBlockingGuide` sets and what `v664ReviewExistingBlockingForRun`
  (`automation.js:1287`) promotes during automation;
* an attempt **bound to a frame** is a candidate for that frame's endpoint guide only,
  set by `useFrameBlockingGuide`.

Flattening them would let a Frame B endpoint image be recommended as the shot's opening
composition — a worse defect than the one being fixed. **The partition was kept.**

The actual defect is a reader/gate mismatch in the console, in
`creation-studio.js:1126` `guidedBlockingPanel`:

| Line | What it used | Should be |
| --- | --- | --- |
| 1127 | `rows = blockingMediaRows(s)` — **all** attempts | (display: correct) |
| 1136 | `blockingAttemptReviewSummary(s)` — **opening pool only** | correct |
| 1141 | `reviewed / rows.length` — **mixes both pools** | opening pool |
| 1143 | console gated on `rows.length` — **all** attempts | opening pool |
| 1143 | button calls `reviewBlockingAttempts(s.id, '')` — **opening pool** | correct |

So on a shot whose attempts all belonged to frames, the console rendered
`REVIEW ALL WITH AI` over an empty set and answered the click with *"Add at least one
blocking attempt first"* — the exact dogfood sentence — while the attempts sat visible
underneath it.

A second finding of the same shape: `blockingAttemptReviewFor` (the attempt card's
badge, `creation-studio.js:1008`) reads the review record keyed by the row's **own**
`blockingFrameId`, and **no caller anywhere passed a non-empty `frameId`**. The
per-frame review partition was a reader with no writer — the same shape as the
`frameWorkflows` defect recorded in memory. Every frame-bound attempt therefore read
`NOT REVIEWED` permanently.

### E — an abandoned run looked busy (found in Phase 1, beyond the four recon findings)

A run whose tab closed stays at `status: "running"` with a lapsed lease. Nobody is
driving it — which `v626StatusLabel` already knew and said as `READY TO RESUME` — yet
every aggregate counted it as live work and span a spinner over it **indefinitely**.
This is the purest instance of the batch's own rule ("must not say ACTIVE merely
because a run exists") and of the dogfood findings "stale elapsed timer/spinner" and
"global Active count wrong", so it was fixed with the rest and carries its own
regression test and negative control.

---

## 4. Implementation

Nine files modified, three added. No provider call, no project data touched.

### `public/live-activity.js` — the predicates and every reader

* Added `v670MachineActiveRun`, `v670WaitingForHumanRun`, `v670RunLeaseLapsed`,
  `v670RunUnsettled`, `v670MachineActiveStep`, `v670StepEndTimestamp`,
  `v670StepElapsedLabel`, `v670ManualElapsedLabel`, aliased on `window` so tests and
  other surfaces ask the same question. (Script-scope `const`/`let` bindings are not
  reachable from `page.evaluate` — see memory *"Browser globals are lexical"*.)
* Replaced all six `["running", "awaiting-review"]` literals with the predicates.
* `v6602ActivityStatus` gained a fourth tone, `waiting`, which outranks `attention`:
  a pending approval is the one thing the director can finish right now.
* The drawer gained a **WAITING FOR YOU** section between ACTIVE NOW and PREVIOUS
  FAILURES; `v670WaitingDetail` writes the row's sentence ("Waiting for you · …"), and
  `v670RunTone` gives an abandoned run the approval tone rather than the live one.
* The toolbar toggle shows `!` instead of a spinner when the tone is `waiting`.
* Elapsed labels now go through `v670StepElapsedLabel` / `v670ManualElapsedLabel`.
* **Drawer painting was replaced with reconciliation** — see §5.

### `public/automation.js` — the writer, and the blocking pools

* `v627PauseForHumanReview` now stamps `step.completedAt = step.completedAt || v626Now()`.
  The `||` preserves an earlier, more accurate boundary recorded by `v626CompleteStep`.
* Added `blockingAttemptPools(shot)` → `{ rows, opening, framed }` so a console can say
  what it is *not* reviewing instead of silently dropping it.
* `blockingAttemptReviewFor` now falls back from the frame's record to the shot-level
  one, so an attempt reviewed before it was bound to a frame keeps its badge.
* `shotAutomationHub`'s BLOCKING card counts every attempt on the shot and scores the
  opening pool; it used to report "No attempts yet" on a shot whose attempts were all
  frame-bound and plainly visible below it.
* `v664BlockingRowsForReview` is **unchanged** — deliberately, per §3D.

### `public/scene-automation.js`

* The scene child-review gate stamps `completedAt` for the same reason.

### `public/creation-studio.js` — the console that lied

* `guidedBlockingPanel` gates and counts on the **opening pool** it actually reviews.
* When frame-bound attempts exist, the console names them rather than ignoring them.
* When the opening pool is empty but attempts exist, the dead button is replaced with
  an explanation.
* Each frame with attempts gets its own review console, calling the already-supported
  `reviewBlockingAttempts(shotId, frameId)` and
  `useRecommendedBlockingAttempt(shotId, frameId)`. This supplies the missing **writer**
  for a partition that already had a reader end to end; it is completion of the
  existing design, not new UX.
* The auto-review scheduler is gated on the same pool.

### `public/styles.css`

* `state-waiting` tones for the strip and toggle; two small rules for the frame-scoped
  console and its note. No layout change.

---

## 5. The drawer refresh defect and its repair

The drawer re-rendered every 3500 ms whether or not anything had changed, by replacing
its whole `innerHTML`. Every control in it was therefore a **new element** every tick.

`v670PaintDrawer` reconciles instead:

1. Build the same markup — **the emitted HTML is unchanged**.
2. Patch the header in place (it holds no controls).
3. Reconcile each section's rows by `data-activity-key` (`run:<id>`, `manual:<id>`,
   `fal:<id>`). **A row whose markup is byte-identical is left untouched** — same node,
   same pending click, same focus.
4. Insert new rows, remove departed ones, and only move a row when its position
   actually changed.

Byte-identity matters because manual-activity rows carry a ticking elapsed label. Under
whole-`innerHTML` painting, one ticking timer destroyed *every* control in the drawer.
Under reconciliation, the ticking row updates and the failed run's `DISMISS` button
does not move.

The wholesale path is retained for exactly two cases: the first paint, and a DOM that
cannot parse `innerHTML`. `v670DomCanReconcile` probes the document itself
(`createElement` → set `innerHTML` → can it find the key?) rather than sniffing for a
test environment. The Node render harness's `FakeElement` fails that probe and takes
the wholesale path, which is why the existing `tests/render-harness.js` drawer
assertions still read a populated `drawer.innerHTML`.

**This is a rendering repair, not a redesign.** No Activity Terminal was built.

---

## 6. Tests

### Added

| File | npm script | What it guards |
| --- | --- | --- |
| `tests/production-state-honesty.js` | `check:state-honesty` | predicates, aggregates, drawer sections, clock freeze/tick, the pause-helper writer, keyed rows, blocking pools |
| `tests/production-state-honesty-negative-controls.js` | `check:state-honesty-negative` | 8 in-memory mutations of the live path |
| `tests/production-state-honesty-real-browser.py` | `check:state-honesty-browser` | node identity across real refresh ticks, wall-clock behaviour, the end-to-end frame reviewer |

Registered in all four places a new suite must appear: `package.json` (scripts and the
`check:quick` chain), `tests/run-full-check.js`, `tests/current-behavior.js`'s
filename manifest, and `tests/run-browser-gate.js`'s gated `SUITES` list.

### The eight regression requirements

| # | Requirement | Where |
| --- | --- | --- |
| 1 | `awaiting-review` does not increment Active | Node + browser |
| 2 | waiting-for-human appears distinctly | Node + browser |
| 3 | elapsed freezes at the human gate | Node + browser |
| 4 | active machine work still counts and ticks | Node + browser |
| 5 | drawer refresh does not detach controls | **browser** |
| 6 | repeated refresh preserves interaction | **browser** (3 ticks, then the control is clicked and must still act) |
| 7 | frame-bound attempts remain reviewable | Node + browser |
| 8 | irrelevant attempts stay excluded | Node + browser (`frame-a`'s reader sees nothing; the opening pool stays empty) |

Plus: E (abandoned run), and the writer stamping its own boundary.

### Negative controls

Repository practice is `mutateSource` in the render harness — in memory, so a control
can never be "restored" by a checkout that also discards real work (see memory
*"Negative controls: restore in memory"*). Each carries a **probe receipt**: the
mutation asserts the anchor text was present at an exact occurrence count, so a control
cannot quietly become a no-op and start passing against nothing.

```
· counting a human gate as active -> awaiting-review must not count as machine-active, got ["run-waiting","run-live"]
· counting an abandoned run as active -> a lapsed lease must not count as machine-active, got ["run-orphan","run-live"]
· merging the waiting section back into ACTIVE NOW -> an approval gate must stay out of ACTIVE NOW
· restarting the clock at the human gate -> the human-gate clock must not advance
· leaving the human gate unstamped -> the pause helper must stamp when machine work ended
· removing the drawer reconciliation keys -> every drawer run row must carry a reconciliation key
· gating REVIEW ALL on attempts it cannot read -> must not offer REVIEW ALL over an empty opening pool
· flattening frame-bound attempts into the opening pool -> the opening pool must stay free of frame-bound attempts
```

The drawer's element-survival repair cannot be controlled in Node — `FakeElement`
neither parses HTML nor tracks node identity. Its negative control lives in the browser
suite: `window.v670PaintDrawer` is replaced **in the running page** with the old
whole-`innerHTML` behaviour, and the suite requires the detachment to come back. Without
it, "the control survived" would also be satisfied by a drawer that stopped refreshing.

The controls suite normalises CRLF before matching, because this repository checks out
with `core.autocrlf=true` and a multi-line `\n` anchor would match nothing (memory:
*"CRLF checkout breaks byte-hash tests"*). That failure was observed and fixed during
authoring — the probe receipt is what caught it.

---

## 7. Verification

### Runtime receipt — after

Same fixture, assertions inverted, plus a genuinely leased run so the repair cannot
pass by calling everything idle:

```
A/E  machine-active runs: ['proof-live']
A/E  waiting-for-human runs: ['proof-awaiting', 'proof-orphan']
A/E  v6602ActivityStatus -> tone='active' label='Activity · 1 active'
A    ACTIVE NOW holds only the live run: True (awaiting=False, orphan=False)
A/E  WAITING FOR YOU holds both stopped runs: True, spinners inside it: 0
B    parked step elapsed 01:00 -> 01:00 (frozen)
B    running step elapsed 02:05 -> 02:08 (still counting)
C    DISMISS still attached across three 3.5s refreshes: [True, True, True]
C    clicking the long-hovered control still dismissed the run: True
D    displayed=['blocking-frame-b'] opening=[] framed=['frame-b']
D    panel offers a frame-B reviewer: True; still offers the empty REVIEW ALL: False
D    frame-B review posted: [{'kind':'blocking','id':'SAMPLE-01','frameId':'frame-b',
                              'fileNames':['SAMPLE-01_FRAME_B_BLOCKING.png']}]
D    the card's badge now reads: {score: 88, pass: True, notes: 'Clear endpoint.'}
```

### Repeated browser stability

`check:browser-real` — the suite whose `DISMISS` timeout was the proven symptom — was run
**10 consecutive times**:

```
run 1 PASS 18.8s   run 6  PASS 17.6s
run 2 PASS 17.8s   run 7  PASS 17.7s
run 3 PASS 17.7s   run 8  PASS 17.5s
run 4 PASS 17.8s   run 9  PASS 17.8s
run 5 PASS 17.6s   run 10 PASS 17.4s

pass=10 fail=0   mean 17.8s   max 18.8s   spread 1.4s
```

**No timeout was increased anywhere** to obtain this. The 1.4 s spread across ten runs is
the useful signal: an intermittent detachment would show as an outlier at the suite's
timeout, and none appeared. Ten clean runs is strong evidence, not proof — the original
flake was intermittent and its historical rate was never measured.

### Gates

| Gate | Result |
| --- | --- |
| `npm run check:quick` | **exit 0** — 102 npm scripts (100 before; +2 new) |
| `npm run check:browser-gate` | **exit 0** — 17 gated suites launched and passed (16 before; +1 new), 0 skipped, 0 failed; 3 quarantined launched and failed exactly as recorded; 20 browser launches; 29 files under `data/` and `projects/` byte-identical afterwards |

Regression families re-confirmed green individually after implementation:

```
PASS check:media-asset-activation           PASS check:media-asset-activation-negative   (C1)
PASS check:media-disposition                PASS check:media-disposition-negative        (C2)
PASS check:shot-media-identity              PASS check:shot-media-identity-negative      (C3)
PASS check:job-media-identity               PASS check:job-media-identity-negative       (C4)
PASS check:save-revision-race               PASS check:save-revision-race-negative       (save race)
PASS check:generation-truth                 PASS check:generation-truth-negative         (Generation Truth)
PASS check:state-honesty                    PASS check:state-honesty-negative            (this batch)
```

The browser gate's isolation check is the receipt that no project data was touched: it
hashes everything under `data/` and `projects/` before and after and found all 29 files
byte-identical. No paid provider route was called at any point; the browser suites abort
`POST /api/generation/fal/jobs` and anything off-loopback.

---

## 8. Dogfood mapping

| Dogfood finding | Classification | Note |
| --- | --- | --- |
| Activity says active while human review is required (20.1) | **FIXED** | `awaiting-review` is machine-inactive; row reads "Waiting for you"; no spinner |
| Stale elapsed timer / spinner (20.1) | **FIXED** | clock stops at the machine-stop boundary; both writers stamp it; spinner reserved for live work |
| Global Active count wrong (20.2) | **FIXED** | header and toolbar count only leased, running work |
| Human gate masquerades as machine processing (20.1) | **RUNTIME FIXED / UX STILL PENDING** | the state is now truthful and separately sectioned; the dogfood's fuller card ("AI work complete. 3 candidates ready for review. `Review candidates`") belongs to the Activity Terminal |
| Review all with AI sees no blocking attempts (14.3) | **FIXED** | console scoped to the pool it reviews; frame-bound attempts got the reviewer they lacked |
| Completion status ambiguity (20.2 status model) | **RUNTIME FIXED / UX STILL PENDING** | Running / Waiting-for-human / Needs attention / Completed / Cancelled are now distinct. **"Waiting on provider", "Waiting for AI result", "Retry planned" and "Retry started" are NOT yet distinct states** — see §9 |
| Reconciliation should be state-based not timeout-based (20.3) | **PARTIAL** | lease state is now read on every paint and on drawer open, so an abandoned run reconciles itself visually. An explicit "Recheck status" action and provider-lifecycle reconciliation are **not** built |
| Docked bottom Activity Terminal (19.2) | **CREATOR WORKSPACE OVERHAUL** | not built, not started |
| Right-rail Assistant (19.4, 34) | **CREATOR WORKSPACE OVERHAUL** | not started |
| Generated Media / Results (35) | **CREATOR WORKSPACE OVERHAUL** | not started |
| Universal Media Inspector (8) | **CREATOR WORKSPACE OVERHAUL** | not started |
| Persistent stage action strip (23) | **CREATOR WORKSPACE OVERHAUL** | not started |
| Provider-specific Settings (27.4) | **LATER** | out of scope by instruction |
| Motion / R2V directing layer (29–31) | **LATER** | out of scope by instruction |

**The Activity Terminal has not been built.** Nothing in this batch should be read as
delivering it.

---

## 9. Known risks and residual gaps

1. **The status model is coarser than the dogfood asked for.** Section 20.2 wants ten
   states. This batch delivers the machine/human split that was actively lying —
   `Running`, `Waiting for human`, `Needs attention`, `Completed`, `Cancelled`.
   *Waiting on provider*, *Waiting for AI result*, *Retry planned* and *Retry started*
   are still folded into `running`. The provider substate is already persisted
   (`v641ProviderMarkup` reads FAL job status) and could be surfaced without new
   plumbing; retry substates would need a writer.
2. **`interrupted` remains overloaded.** It means both "the director approved, resuming
   now" (`automation.js:2361`, immediately dispatched) and "a child run needs a
   director" (`scene-automation.js:294`, genuinely waiting). The second is
   waiting-for-human presented as needs-attention. It was **not** changed here: it is a
   distinct defect, it was not among the proven findings, and splitting it touches the
   dispatch path. It should be the first item of the next runtime batch.
3. **`v641TickElapsedLabels` is dead code.** It scans for `[data-live-start]` every
   3.5 s and no markup has ever emitted that attribute — a reader with no writer. Left
   in place as out of scope; it is harmless but should be removed or wired.
4. **Lease dependence.** `v670MachineActiveRun` trusts `leaseExpiresAt`. If a future
   runner drove work without maintaining the lease, its run would read as
   "waiting for you". The 5-minute TTL against a 60-second heartbeat makes this
   unlikely, and `v6211RevalidatePaidStepLease` re-asserts the lease before every paid
   step, so a run that can spend money always holds one.
5. **Node cannot test element survival.** By construction. The browser suite and its
   in-page negative control carry that guarantee; if the browser gate is ever skipped,
   that guarantee is unverified.
6. **A seventh copy of an activity-state list survives**, at
   `public/focused-workspaces.js:209`: the shot inspector picks a run with
   `["running", "awaiting-review", "failed"].includes(row.status)`. It was left alone
   because it answers a different question — "is there a run worth pointing at for this
   shot?" — and it renders the run's own stage text rather than asserting activity, so
   it was never part of the proven defect. It is nonetheless the last uncentralised
   copy, and it misses `interrupted`, so a shot with an interrupted run reads "No active
   operation for this shot" while the drawer lists it under NEEDS ATTENTION. It should
   adopt `v670RunUnsettled` in the next runtime batch.

---

## 10. Explicit exclusions

Not begun, by instruction: Activity Terminal redesign, Assistant right rail, Generated
Media, Media Inspector, creator-workspace overhaul, provider Settings, Motion/R2V UX,
paid-generation modal, stage action strip, broad notification redesign.

Not done, by safety rule: no commit, no branch, no push, no merge, no provider call, no
credential change, no project-data write. The implementation is left **uncommitted**.

---

## 11. Creator Workspace Overhaul — reconnaissance only

**Read-only. Nothing below is implemented, and nothing below should be started without
its own batch.** This section exists so the next batch can be scoped rather than
discovered.

### 11.1 The shell as it stands

```
#app
├── #rail            left nav: Production · Shots · References · Bible · Reports · Settings
└── #workspace
    ├── #topbar      project · view · ＋Add · Activity toggle · save state · search
    └── #main        every workspace renders here, one column, unbounded height
#automation-activity-drawer   right-side overlay, modal, covers the work
#modal  #toast
```

Three structural facts decide the overhaul's shape:

1. **There is no right rail and no bottom dock.** The Assistant and the Activity
   Terminal both need shell slots that do not exist. `#workspace` is a two-row grid;
   both are additive rather than invasive.
2. **Activity is an overlay, not a dock.** `#automation-activity-drawer` is
   `aria-modal="true"` and closes on Escape and backdrop click — it *covers* the work by
   design. The dogfood's terminal is the opposite: persistent, non-modal, fixed height,
   internally scrolled. These are different components that share a data source. The
   drawer's data layer (`v641ActiveAndRecentRuns`, the section split, the predicates
   this batch added) transfers; its shell does not.
3. **Stages are inferred, not declared.** `public/focused-workspaces.js:255` builds the
   stage taskbar by scanning `.guided-work-stack`'s DOM children for
   `details, section, .creation-card, .automation-card`. The stage list is whatever
   panels happened to render. **A persistent stage action strip and stage-completion
   handoffs cannot be built on an inferred stage list** — they need a declared stage
   model (id, label, prerequisites, primary actions, completion predicate). This is the
   single largest unstated dependency in the overhaul, and it is a prerequisite for
   dogfood §12, §13, §16 and §23.

### 11.2 Dependencies now satisfied

| Overhaul component | Needed | Supplied by |
| --- | --- | --- |
| Universal Media Inspector | one identity per media object surviving rename/move | **P4** (MediaAsset ledger, C1–C4) |
| Media Inspector provenance | which job produced this file | **P4 C4** (job media identity) |
| Generated Media / Results | project-wide media enumeration with disposition | **P4 C2** (disposition identity) |
| Generated Media provenance | what was actually sent to a provider | **Generation Truth** (compiled package is what dispatches) |
| Provider-generation UX | a route offered is a route that can run | **Generation Truth** (`execution.dispatchable`) |
| Activity Terminal | a true "is it happening now" state | **this batch** (`v670MachineActiveRun` / `v670WaitingForHumanRun`) |
| Activity Terminal | a stream that can update without destroying controls | **this batch** (keyed reconciliation) |
| Assistant right rail | one authoritative status to narrate, not a second source | **this batch** (single predicate pair) |
| Stage completion handoffs | truthful per-stage completion | **partial** — media/generation truth yes; declared stage model **no** |

The Assistant rail is the clearest win: dogfood §19.3 insists it must *summarise the
authoritative activity state, never invent separate status*. Before this batch there was
no single authoritative state to summarise — six readers disagreed. There is now.

### 11.3 A bounded overhaul plan — five batches, not hundreds of tickets

**O1 — Declare the stage model.** *Prerequisite for O4 and O5; no visual change.*
Replace DOM-inferred stages with a declared per-stage record (id, label, prerequisites,
primary actions, completion predicate) that `focused-workspaces.js` consumes instead of
scanning. Covers the substrate for dogfood §12, §13, §16, §23. Risk: `creation-studio.js`
is 3,824 lines and `v607-composer.js` shadows part of it (memory:
*"v607-composer shadows creation-studio"*) — the declaration must be authored where the
live renderer reads it, not where it appears to live.

**O2 — Shell slots.** Add a right rail and a bottom dock to `#workspace` as empty,
collapsible, persisted-height regions. No content. Proves the layout, the responsive
behaviour and the "page does not move" requirement before anything depends on them.

**O3 — Activity Terminal (bottom dock) + Assistant rail.** Move the technical stream
into the dock, reading the predicates and row data this batch established; keep the
existing drawer until the dock reaches parity, then retire it. The Assistant rail
renders three states only — *Working* / *Need your input* / *All quiet* — from the same
predicates. Delivers dogfood §19.1–19.4 and finishes §20.1's fuller card. Adds the
remaining status vocabulary (waiting-on-provider, waiting-for-AI, retry planned/started)
noted in §9 risk 1.

**O4 — Persistent stage action strip + completion handoffs.** Consumes O1. Actions
always visible, readiness changes not location, disabled actions explain the
prerequisite. Delivers §23, §12, §13, §16.

**O5 — Generated Media / Results + Universal Media Inspector.** One inspector component
opened from every media surface, reading the P4 ledger for identity, disposition,
provenance and review. Delivers §8 and §35.

Sequencing constraint: **O1 → O4** and **O2 → O3**. O5 depends only on P4 and can run in
parallel with O1/O2. O3 should not begin before this batch's predicates are merged.

### 11.4 Explicitly out of the overhaul

Per dogfood §38, and restated here so the next batch does not inherit them: no B-roll
record type, no shot-purpose taxonomy, no montage planner, no transition subsystem, no
agent console, no NLE integration, no replacement continuity schema, no autonomous AI
canon approval. Motion/R2V directing (§29–31) and provider-specific Settings (§27.4) are
real work but are their own batches, not part of the workspace overhaul.

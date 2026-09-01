# CineBraid Post-Dogfood Decision Freeze V1

**Date:** 2026-09-01
**Status:** OWNER DECISIONS FROZEN / NOT IMPLEMENTED
**Foundation:** `a2aff6778d61c78ea4c0d0bc53987bf3cef9493b`
**Branch:** `fix/post-dogfood-f0-v1`
**Evidence:** `planning/CINEBRAID_DOGFOOD_V1_FINDINGS_2026-09-01.md` (`DOGFOOD_RESULT: PRODUCT_MACHINERY_WORKS_BUT_LAUNCH_UX_NOT_CONVERGED`)

---

## 0. What this document is, and what it is not

This records **twelve owner decisions taken on 2026-09-01**, after a human-led dogfood of
the exact production tree named above.

These are **new decisions of that date**. Several of them **amend or reverse decisions that
were previously accepted, receipt-backed or test-pinned**. Where that is so, this document
names the prior authority, quotes it, and states plainly that the new dogfood evidence
supersedes it. It does not restate a 2026-09-01 decision as though it had been settled
earlier, and it does not describe a proposal as a freeze.

**Nothing in D1–D12 is implemented by the change that carries this document.** The only
executable change alongside it is the measurement repair in §14.

The original dogfood findings document is **not** rewritten. It stands as the evidence
this freeze reasons from.

### A note on how prior authority is graded here

Three strengths are distinguished, because the post-dogfood rehydration found them being
conflated:

| Grade | Meaning |
|---|---|
| **FROZEN** | An accepted decision or acceptance receipt, or a shipped contract pinned by a test |
| **SHIPPED** | Implemented behaviour, evidenced in source — strong, but not itself a decision |
| **PROPOSED** | A recommendation, audit verdict or findings-report "should" — never a freeze |

A recommendation in a findings report is **not** a frozen decision, however often it was
repeated. Two of the twelve decisions below exist precisely because that distinction was
lost.

---

## 1. Decision index

| # | Decision | Relation to prior authority | Owning slice |
|---|---|---|---|
| D1 | Global Activity drawer will be retired | **NEW** (discharges a PROPOSED condition) | S3 Shell |
| D2 | Operational surface budget | **PRESERVES** | S3 Shell |
| D3 | Fixed semantic status tokens | **AMENDS** presentation; preserves derivation | S2 Presentation |
| D4 | Assisted reference creation placement | **AMENDS** v6.6.3.1 manual-first | S5 References |
| D5 | Coverage vocabulary | **PRESERVES** semantics; **AMENDS** wording | S5 References |
| D6 | Braidy state boundary | **PRESERVES**; permits composition | S6 Braidy |
| D7 | Candidate primary click | **AMENDS** a test-pinned contract | S5 References |
| D8 | Review verdict / score hierarchy | **NEW** (synthesises two conflicting directions) | S5 References |
| D9 | ComfyUI / local generation scope | **NEW** | S4 Integrations |
| D10 | Setup & Connections scope | **NEW** | S4 Integrations |
| D11 | Persistent Braidy perch | **AMENDS** the quiet-shell default | S6 Braidy |
| D12 | Product version vs build identity | **PRESERVES**; adds build identity | S3 Shell |

---

## D1 — The Global Activity drawer will be retired

### Decision

The right-side Global Activity drawer is to be retired. There will be exactly one
interactive global activity owner.

Retirement means **the owner is gone**, not that the element is hidden.

### Relation to prior authority — NEW

This is a new decision. The dogfood ledger describes it as previously settled
("Previously settled ownership… There should be **no** separate right-side Global Activity
owner"). **The rehydration could not support that.** What exists is:

A **PROPOSED**, explicitly conditional retirement:

> `docs/architecture/CINEBRAID_PRODUCTION_STATE_HONESTY_2026-08-13.md:595`
> "existing drawer until the dock reaches parity, then retire it"

sitting under a section header that disclaims implementation:

> same file, `:525`
> "**Read-only. Nothing below is implemented, and nothing below should be started without**"

against a **SHIPPED** declaration that says the opposite for the interim:

> `public/shared-workspace-shell.js:81`
> "surface that reserves space and stays. They coexist deliberately — the drawer"

So the drawer's existence today is deliberate, and the condition attached to retiring it was
never discharged. The decision to retire it is taken **now**, on 2026-09-01 dogfood
evidence, and it inherits the condition.

### The parity condition must be discharged before deletion

Parity has **not** been reached. These affordances exist only inside the drawer, in
`public/live-activity.js`:

- `recheckAutomationGateStatus` — re-derives parked approval gates against current truth
- `archivePreviousAutomationFailures` — dismiss previous alerts
- `dismissAutomationActivityRun` — per-run dismiss
- per-run **VIEW REPORT**

Each must receive an explicit surviving owner before any deletion:

- **operational controls → the expanded bottom Activity Terminal**
- **deep diagnostics / history → Reports**

### Known dependency the correction plan must carry

The drawer has more entry points than the shell's "single gateway" description implies.
`openGlobalAutomationActivity` is called from `creator-surfaces.js`, `live-activity.js`,
`entities.js`, `focused-workspaces.js`, `scene-automation.js` and `shared-braidy.js`. Two of
those are **not user gestures** — `scene-automation.js` opens the drawer on a `setTimeout`
after a run is saved. A retirement that repoints only the obvious pointers leaves a live
call to a function that no longer exists.

`shared-braidy.js`'s `open-activity` entry is a member of a **closed** action table with a
negative control over it; changing it is a deliberate edit to that table, not a sweep.

### Reason from the Sept 1 dogfood

The same operational truth appeared simultaneously in the bottom Activity Terminal, the
right-side drawer, an inline automation console, the Braidy rail, the topbar indicator and
Reports. A filmmaker cannot tell which one is authoritative.

### Owning slice

**S3 — Shell and operational ownership.**

### Not implemented in F0

The drawer is not deleted, not hidden, not conditioned, and no affordance is relocated.

---

## D2 — Operational surface budget

### Decision

Frozen ownership:

| Surface | Owns |
|---|---|
| **Topbar activity indicator** | One compact global status indicator only |
| **Bottom Activity Terminal** | Canonical global live operational surface; eventual global run-control owner |
| **Main task workspace** | The filmmaking task and its human creative decision. May show **one** compact current-run summary/handoff. Not a full operational console |
| **Braidy / Assistant** | Concise interpretation, current attention, useful handoffs. Does not recreate the activity ledger |
| **Reports** | Deep history, diagnostics, audit evidence |

**Canonical creative decision surfaces — Candidate Review above all — still own their human
creative decision. That is not duplicate activity ownership.** This clause exists so that a
zealous reading of "one owner" does not strip Review of the decision it is supposed to own.

### Relation to prior authority — PRESERVES

This restates and holds the shipped four-owner architecture. It is the one part of the
dogfood's shell premise the rehydration confirmed rather than refuted.

### Reason from the Sept 1 dogfood

Findings 11, 12, 28, 29, 64: active automation replaced the main workspace with a process
dashboard; activity summaries repeated across owners.

### Owning slice

**S3 — Shell and operational ownership.**

### Not implemented in F0

No surface is added, removed or re-scoped.

---

## D3 — Fixed semantic status tokens

### Decision

Operational status must **not** reuse the user-theme accent as its semantic truth.

A dedicated semantic tone vocabulary is frozen:

`working` · `waiting` · `attention` · `done` · `idle`

Presentation direction (**exact colour values are not chosen in F0**):

| Tone | Family |
|---|---|
| working | blue / cyan |
| waiting | amber |
| attention / failure | red |
| done | green |
| idle | muted / neutral |

The existing derivation is to be **promoted, not replaced**.

### Relation to prior authority — AMENDS presentation, PRESERVES derivation

**A correction to the post-dogfood rehydration is recorded here.** That rehydration asserted
that five shipped tone values already travel from the v670 predicates to a CSS class on every
row. That is **half true, and the inaccurate half matters**:

- The **projection** vocabulary does exist. `public/creator-surfaces.js:752` reads
  `state.working`, `state.waiting`, `state.attention`, `state.recent`, and
  `public/live-activity.js:565` branches on `tone === "done"`. **This is the thing to promote.**
- A single consistent **CSS** vocabulary does **not** exist. `public/` declares roughly twenty
  distinct `tone-*` classes, including three synonym collisions where both members are defined
  in `public/styles.css`:

  | Pair | occurrences in `styles.css` |
  |---|---|
  | `tone-active` / `tone-working` | 6 / 2 |
  | `tone-complete` / `tone-done` | 8 / 1 |
  | `tone-pending` / `tone-waiting` | 4 / 3 |

  plus unrelated `tone-*` families (`tone-approved`, `tone-rejected`, `tone-optional`,
  `tone-covered`, `tone-not-needed`, `tone-regression`, `tone-improvement`, `tone-next`,
  `tone-stage`, `tone-quiet`, `tone-unknown`, `tone-positive`, `tone-no-improvement`).

So the work is to **collapse the synonym pairs onto the projection's five names**, not to
invent a sixth vocabulary and not to assume a clean one already exists.

The accent-versus-status collision is real and is a genuine decision conflict: the theme
accent currently carries both "this is the action" and "current / running". D3 resolves it in
favour of a **separate** semantic ramp.

### Reason from the Sept 1 dogfood

Findings 30, 63, 64: Activity's active, waiting, failed and completed states all read as one
monochrome blob.

### Owning slice

**S2 — Presentation primitives.**

### Not implemented in F0

No token is declared, no class is collapsed, no colour is chosen.

---

## D4 — Assisted reference creation placement

### Decision

When a reference has **no primary**, normal UI presents **both** paths as first-class and
visible:

- **Create with CineBraid**
- **Bring existing work**

Manual-first may determine which path receives **recommended / default emphasis**. It may
**not** hide the assisted path.

If no usable integration is connected, **Create with CineBraid remains visible** and degrades
honestly into a setup invitation or an honest refusal — never a dead button.

For an actual coverage gap, surface **Generate missing views** at the point of need.

General prompt / compiler / automation machinery remains progressively disclosed or Advanced.

### Relation to prior authority — AMENDS v6.6.3.1, does not discard it

The prior decision is **FROZEN** and receipt-backed:

> `docs/releases/v6.6.3.1/CINEBRAID_v6.6.3.1_RELEASE_NOTES.md:20`
> "Reference pages now open on the approved-reference workflow in manual-first projects."

> same file, `:74`
> "Existing projects without a saved workspace emphasis open manual-first; users may switch to Assisted generation at any time."

> `docs/releases/v6.6.3.1/CINEBRAID_v6.6.3.0_MANUAL_ONLY_PERSONA_AUDIT.md:128`
> "In manual-first projects, the mapper's primary action is **Map & assign**."

**What is amended:** manual-first may set *emphasis*; it may no longer determine *visibility*
of the assisted path.

**What is preserved, explicitly:** the manual-only persona guarantee. A provider-free project
must still import, choose, approve, organise and deliver the whole path, and human approval
alone must remain sufficient. **This decision does not revert the v6.6.3.1 manual-only persona
design.**

### Reason from the Sept 1 dogfood

Findings 06, 07, 27 (BLOCKER 3, BLOCKER 14): on an empty reference page the only obvious path
was "Upload reference files"; describe → improve → generate → review → approve was buried
under "Optional assisted tools". A user can reasonably conclude CineBraid only organises
references made elsewhere.

### Owning slice

**S5 — References workflow convergence.** Depends on S4, because a first-class create path on
an unconnected install must lead to setup rather than a dead panel.

### Not implemented in F0

No reference page changes.

---

## D5 — Coverage vocabulary

### Decision

The two semantic axes stay separate. The **authored coverage plan** and **current production
demand** are not merged.

- **`Planned`** is reserved for an authored coverage-plan value only.
- A structurally-required coverage item that production is not currently waiting on reads
  **`Not currently needed`** (the existing canonical wording), never `Planned`.
- User-facing counts must name their scope: *"Production is waiting on…"* versus
  *"Coverage plan…"*.

Explicitly unchanged: fail-closed requirement defaults; no seeding of `planned` to simplify
presentation; **coverage does not block shot readiness**.

### Relation to prior authority — PRESERVES semantics, AMENDS wording

Both axes and the canonical wording **already exist and are correct**:

> `public/entities.js:2133`
> "planned -> Recommended, not-required -> Not currently needed. An unauthored"

> `public/shared-coverage.js:367`
> `return value === "not-required" ? "Not required" : value === "planned" ? "Planned" : "Required";`

The defect is a **presentation collision**, not a semantic one — one sentence mixes a
plan-axis word with a demand-axis phrase:

> `public/entities.js:1267`
> `` : `${progress}${planned} · none needed now`; ``

which is what produced the dogfood's simultaneous "6 planned views · none needed now" and
"Required for this project".

The rehydration also warns that the obvious simplification is forbidden: re-collapsing the
requirement and demand axes would reinstate a fake required backlog that an independent audit
already found and that this separation was built to remove.

### Reason from the Sept 1 dogfood

Findings 19, 20 (BLOCKER 8): required / planned / recommended / needed-now were not coherent
to a reader, even though each was internally correct.

### Owning slice

**S5 — References workflow convergence.**

### Not implemented in F0

No wording, count or requirement default changes.

---

## D6 — Braidy state boundary

### Decision

**Preserved:** Braidy does not enumerate raw activity, does not poll raw runs, and does not
become production authority.

**Permitted:** composition. `creator-surfaces.js` may pass an **already-computed, read-only,
deterministic** state/recommendation projection into the rail presentation.
`braidy-rail.js` remains a **consumer** of that projection, never an independent enumerator.

Current deterministic state and attention must visually **outrank** stale advisory
conversation.

Any model handoff uses only deterministic bounded facts supplied **before** the request.
**Model prose is never parsed to create state or actions.**

### Relation to prior authority — PRESERVES

The prohibition is **FROZEN** by test, and D6 is written to stay inside it:

> `tests/braidy-rail.js:216-223`
> asserts `public/braidy-rail.js` contains none of `AUTOMATION_RUNS`, `FAL_GENERATION_JOBS`,
> `V641_MANUAL_ACTIVITIES`, `v670ManualActivityRows`, `v670MachineActiveRun`,
> `v670WaitingForHumanRun`, `falJobActive`, `creatorState`, with the reason:
> "Braidy interprets the production; enumerating activity is the Terminal's job and there must be exactly one enumerator"

Note that `creatorState` is on that list. **The composition route in D6 must therefore pass a
projection in without `braidy-rail.js` naming that symbol**, or S6 must deliberately amend this
test. S6 owns that call; it is flagged here so it is made on purpose rather than discovered.

### Reason from the Sept 1 dogfood

Findings 37, 38, 39, 43: stale advice remained visually primary after production state
changed; Braidy did not update strongly with changed state.

### Owning slice

**S6 — Braidy as a product.**

### Not implemented in F0

No projection is passed, no rendering changes, no test amended.

---

## D7 — Candidate primary click

### Decision

New semantic rule:

> **When a media card is presented as a human review / decision item, its primary card or
> image click opens the canonical Review dialog.**

Full-size image viewing becomes an explicit **secondary** action available from Review.

> **When media is presented as browsing / library material rather than a pending human
> decision, viewer- or inspector-first behaviour may remain.**

Therefore: reference candidates in *"Images waiting for your decision"* → **Review** on primary
click. **Do not globally change every media grid for visual uniformity.**

### Relation to prior authority — AMENDS a test-pinned contract

The prior rule is **FROZEN by test**:

> `tests/reference-automation-closed-loop.js:492`
> "/* The two actions are different actions. */"

The 2026-09-01 human dogfood **intentionally amends** it. The prior contract treats the
distinction as uniform across media; the new rule makes it conditional on whether the card is
a pending human decision.

### Contracts this will require amending in Slice S5 — recorded, not amended

- `tests/reference-automation-closed-loop.js` (the "different actions" contract, at and around `:492`)
- any candidate-card click assertion in `tests/candidate-review-semantics.js` and
  `tests/returned-media-ownership.js` that pins viewer-first behaviour for a decision card

S5 must confirm this list against the suites before editing, and amend deliberately with the
reason recorded — not by deleting assertions until green.

### Reason from the Sept 1 dogfood

Findings 15, 16 (BLOCKER 7): clicking a candidate thumbnail opened a generic lightbox, so the
score, the PASS/FLAG verdict, the reviewer and the target state — everything needed to decide —
were one navigation away from the thing being decided.

### Owning slice

**S5 — References workflow convergence.**

### Not implemented in F0

No click behaviour changed. **No test amended.**

---

## D8 — Review verdict / score hierarchy

### Decision

The two prior dogfood directions are synthesised into one new rule:

> **The declared verdict leads. The score is prominent supporting evidence.**

Expected hierarchy: `PASS · 92/100 · Suggested` — or `FLAG · 82/100`.

The number must be easy to see. But:

- score never overrides a failed declared requirement;
- score is never the sole judgement-sized signal;
- **a FLAG candidate is never styled as Suggested merely because an AI review exists;**
- human approval remains stronger than every AI signal.

### Relation to prior authority — NEW

This resolves a conflict between the Sept 1 ledger (§5.1: the score is under-emphasised) and
Dogfood Pass 2's verdict-over-score rule. Both were **PROPOSED**; neither was frozen. D8 takes
the decision that was missing.

The `Suggested` clause has a precise, verified anchor — the current condition tests whether a
review *exists*, not what it *concluded*:

> `public/media-results.js:165`
> `const recommended = row.aiRecommendation.state === "known" && row.disposition.role !== "approved"`

`state === "known"` is true for a FLAG. That is why all three dogfood candidates were badged
`AI SUGGESTED` when two of them were flagged. The correct reading is the recommendation's
**value**, which the projection already provides.

### Reason from the Sept 1 dogfood

Findings 17, 24 (BLOCKER 11): `AI-generated`, `AI-reviewed` and `AI-suggested` are distinct
states; collapsing them gave flagged assets decision weight they had not earned.

### Owning slice

**S5 — References workflow convergence.**

### Not implemented in F0

No badge condition or score treatment changed.

---

## D9 — ComfyUI / local generation scope

### Decision

**Do not build a ComfyUI execution runtime** as part of the post-dogfood recovery program.

For this convergence, ComfyUI / local generation becomes a **first-class concept in the
unified Integrations architecture and UI**, with **honest status**. With no working runtime it
reads *"Not available yet"* or equivalent — **no fake connection, no fake capability.**

The integration/provider architecture must not hard-code FAL such that adding a real local
runtime later requires another Settings redesign.

A working ComfyUI WorkflowRecipe / runtime is a **separate later pre-launch product slice and
decision**.

### Relation to prior authority — NEW

**A correction to the post-dogfood rehydration is recorded here.** That rehydration cited a
"2026-08-16 boundary decision" placing ComfyUI outside launch scope. **That citation could not
be substantiated.** Searching the 2026-08-16 Product-Wedge-Lab documents and `docs/` finds
ComfyUI only as a competitive comparable and a licence comparable, plus a **PROPOSED** list
inside Pass 1 §27.4 ("Provider-specific Settings should replace generic Accounts") — which a
later accepted architecture document dispositioned "**LATER** | out of scope by instruction".

So there was no prior ComfyUI launch-sequencing decision. **D9 is that decision, taken now.**

What *does* already exist is the honest product row this decision endorses and asks to be
rendered:

> `generation-options.js:185-190`
> ```
> "comfy-local": {
>   connected: false,
>   label: "Local ComfyUI",
>   reason: "CineBraid has no local generation runtime yet, so nothing can run on this machine.",
>   action: "",
> },
> ```

The backend already tells the truth. **No Settings surface renders it.** D9 is largely a
rendering decision, not a backend build.

The hard-coding risk is concrete and verified: `public/settings.js:258` gates the entire
Settings → Generation collector on `if (!$("#cfg-fal-enabled")) return {};`, so any non-FAL
generation setting added to that panel is silently dropped on save. S4 must not build on top
of that gate.

### Reason from the Sept 1 dogfood

Findings 04, 05 (BLOCKER 2): local generation was not first-class, and provider configuration
was raw and FAL-shaped.

### Owning slice

**S4 — Setup and Integrations.** The runtime itself is a later slice.

### Not implemented in F0

No Integrations surface, no adapter, no runtime.

---

## D10 — Setup & Connections scope

### Decision

Setup & Connections is a **machine / connections flow**. It may cover current setup health,
storage, local/network access, assistant/Braidy availability, generation integrations,
local vs cloud, privacy, cost implications, and skip / set up later where safe.

**It is not a product tour.** Teaching Canon / Reference / Historic, the references workflow,
shots and the production workflow belongs to **contextual first-project / sample-project
guidance**.

Braidy may participate in contextual teaching **after** it is configured. **Braidy is not a
dependency for completing machine setup.**

**Do not build hardware-detection-based "Recommended Local" / "Low-Memory Local" choices until
an actual hardware probe exists and gets its own bounded design.**

### Relation to prior authority — NEW

The Sept 1 ledger asks to "implement/recover the agreed Setup & Connections first-run flow".
**No such agreement exists.** The phrase, and all five named setup states, appear in no file
under `C:\CineBraid` except the dogfood document itself. The nearest real authority is an
alpha item that was accepted and never built:

> `C:\CineBraid\Alpha-Readiness-Audit\reports\CINEBRAID_ALPHA_BLOCKER_MATRIX_2026-08-11.md:108` (I-5, severity MEDIUM)
> "**No first-run orientation for the alpha's actual limits** — one screen stating what works, what is optional, what needs a provider, and that history export is not yet available."

That is a genuine accepted gap, but it is one screen of orientation, not a setup flow. **D10 is
a new product decision.**

The only thing currently named "first run" in code is `public/app.js:1292`
`showFirstRunWorkspace()` — a no-project-open empty state, entered whenever there is nothing to
open. It is **not** a device-setup flow and persists no "this machine has been set up" marker.

The last clause is deliberate: there is **no hardware probe anywhere in product code**, so
"Recommended Local" versus "Low-Memory Local" currently has nothing to decide on. Shipping that
choice without a probe would be the product guessing and calling it a recommendation.

### Reason from the Sept 1 dogfood

Finding 01 (BLOCKER 1): a filmmaker had to reverse-engineer CineBraid's infrastructure through
raw Settings pages before starting a production.

### Owning slice

**S4 — Setup and Integrations.**

### Not implemented in F0

No first-run surface, no setup health, no hardware probe.

---

## D11 — Persistent Braidy perch

### Decision

When Braidy is enabled and configured, a **small, quiet, persistent perch** may remain visible
at the top of the right-side area. When assistant capability is disabled or unconfigured, the
same compact location presents **"Assistant"** plus one setup/status action.

**Quiet is redefined.** It now means: no full rail until opened; no chatter; no permanent run
feed; small footprint. It **no longer means completely absent.**

Clicking the perch expands Braidy to own the full right column. Closing returns to the perch.

Because the perch remains mounted, **collapsing the expanded rail must not abort an in-flight
Braidy request.** Project switch and explicit assistant disable may still clear or abort,
according to the eventual lifecycle contract.

### Relation to prior authority — AMENDS the quiet-shell default

The prior behaviour is **FROZEN** by decision record and pinned by test:

> commit `7ace9ef` — "ux(batch2-s1): quiet the shell — one activity indicator, closed rail, collapsed dock, compact run state"
> "THE ASSISTANT RAIL DEFAULTS CLOSED… THE ACTIVITY TERMINAL DEFAULTS COLLAPSED."

Implemented at `public/creator-surfaces.js` `railOpen()` (opt-in key
`cinebraid-creator-rail-open`) and `terminalCollapsed()` (opt-out).

D11 amends the **rail default only**. The Activity Terminal's collapsed default is untouched,
and "one persistent global activity indicator" is untouched.

### Tests this will intentionally amend in Slice S6 — recorded, not amended

- `tests/quiet-shell.js` §5, the rail-defaults-closed assertions
- `tests/quiet-shell-real-browser.py`, wherever it asserts the rail is absent rather than compact
- any `tests/creator-state.js` assertion that the rail renders nothing when closed

S6 must confirm this list against the suites before editing.

**The perch is a real shell change, not a styling change:** closing the rail currently
unmounts it, which is what aborts an in-flight request. Keeping the perch mounted changes the
component's lifecycle.

### Reason from the Sept 1 dogfood

Findings 42, 43: the expanded Assistant felt inserted into leftover space, and there was no
persistent compact presence to return to.

### Owning slice

**S6 — Braidy as a product.**

### Not implemented in F0

**No perch.** No lifecycle change. No test amended.

---

## D12 — Product version vs build identity

### Decision

**Preserved:** `package.json` / `release-identity.js` remain the application product-version
authority. Project / schema / studio fields remain project and schema data and **must not
track the app version**.

**New:** development and dogfood builds expose an **additive build identity** — preferably a
short Git SHA, or deterministic supplied build metadata.

Constraints: **no new product version is chosen**, and **Git must not become a required
runtime dependency of a packaged production build.** Build identity must ultimately come from
supplied build/start metadata with a deterministic fallback.

### Relation to prior authority — PRESERVES, and adds

The separation is **FROZEN** in code and pinned by test:

> `release-identity.js:1-13`
> "`package.json` "version" is the only place a CineBraid release version is written by hand… Neither the project schema markers (`meta.hubVersion`, `meta.schemaVersion`, project `meta.version`) nor the API contract version live here: those describe stored project data, not the application build, and must never follow this value."

> `tests/version-consistency.js:84`
> asserts `sample.meta.version !== identity.version` — the suite actively *forbids* the sample
> from advertising the application version.

**The dogfood's version finding is therefore not an architecture failure.** `6.7.0-dev.1` is the
truthful product version. `6.6.4-studio.2` is stored project data — a field an audit already
recorded as broken in all three of its meanings, with a migration planned and not yet run. The
real defects are narrower:

1. `public/app.js:2220` prints that per-project string in shell chrome, where it reads as a
   product version.
2. There is **no build-identity seam at all**: `release-identity.js` is never required by
   `server.js`, there is no version endpoint, and the startup banner prints no version and no
   commit. A tester cannot discover the running build without a terminal.

`git describe --tags` currently reports the newest tag **401 commits behind HEAD**, which is why
a build identity is needed rather than a tag.

### Reason from the Sept 1 dogfood

Finding 44: the UI showed `CineBraid 6.7.0-dev.1` and `6.6.4-studio.2` while the running tree
was `a2aff677`.

### Owning slice

**S3 — Shell and operational ownership.**

### Not implemented in F0

No label changed, no endpoint added, no version chosen.

---

## 13. The `check:authority-server` contract question — reported, not resolved

The post-dogfood rehydration returned two incompatible statements about whether S1's fix makes
`check:authority-server` pass. This was run and read at the foundation. The answer is
definitive, and **one of those statements was wrong**.

### A. Which assertion currently fails

`tests/authority-write-seam-server.js`, review **F1-05**, third case
*"entity-to-motion by value and durable asset identity"*, at **`:794`** — inside the case's
`build()`, **not** in an assertion about what F1-05 exists to test.

Observed at the foundation, last passing control `[bounded review] F1-04 PASS`:

```
Error: CineBraid has no record of what kind of image ENTITY.png is, and it will not guess …
    at enforceTargetPolicy (shared-authority-kernel.js:875:11)
    at Object.approveEntityStateCanon (shared-authority-kernel.js:1405:66)
    at approveEntity (tests/authority-write-seam-server.js:118:10)
    at Object.build (tests/authority-write-seam-server.js:794:11)
```

F1-05 tests **laundered-removal refusal**. It never reaches that subject, because its fixture
can no longer create the legitimate approval it needs as a precondition. `F1-06` (`:829`) and
`F1-08` (`:920`) build from the same fixture and are unreached.

### B. Should S1's generated-candidate declaration make it green — **No**

The fixture is hand-built at `:105`:

```js
candidateFiles: [{ stored: value, decision: "unreviewed" }]
```

It never passes through the generation dispatch, `ingestEntity`, or any product writer. A
writer-side declaration in the FAL entity-reference path **cannot reach this row**. Any S1 plan
promising this suite goes green is wrong.

### C. Must a bare hand-drop row remain refused — **Yes, as a product rule**

This is the accepted fail-closed hardening, stated in the source itself:

> `public/shared-coverage.js:309-322`
> "`undeclared` does not mean "probably fine"; it means THE APPLICATION HAS NO EVIDENCE, and no evidence is not evidence of eligibility."

with the collection route named: manual intake asks the filmmaker, and the import mapper's
`importedMapping.kind` was already a single-view statement.

**But this fixture is not a product hand-drop.** `doIntake()` now collects the declaration and
writes it onto the candidate row:

> `public/library-tools.js:221`
> ```js
> original.push({ stored: d.name, original: f.name, coverageJobType: structure,
>   ...(targetStateId ? { targetStateId, targetStateName } : {}) });
> ```

so the shipped manual writer would not produce this row shape either. The fixture is stale
relative to **both** writers.

### A pointer S1 should not have to rediscover

The rehydration warned that S1 must not widen `coverageJobType`, because on the **server** it
doubles as the coverage-**run** membership marker — `fal-generation.js:1280` treats any
non-empty value as run membership, and setting it on a manual dispatch would mint a spurious
`coverageAutomation` projection and pull a manual paid job into run accounting.

That warning is about the **job row**. `doIntake` above writes the same field name onto the
**candidate row**, client-side, and never touches a job. The two are different objects that
happen to share a name.

**This is not a decision, and F0 takes none.** It is recorded so S1 evaluates both routes on
evidence — declaring on the candidate row as `doIntake` already does, versus a new field —
rather than discarding the first on a warning that applies to the second.

### D. Correct S1 acceptance expectation

- S1 **must not** claim `check:authority-server` goes green.
- S1's acceptance is a **new regression test on the generated-candidate path**: generate a
  Default candidate → returned media → AI review → human approval → primary authority written.
- The red F1-05/F1-06/F1-08 fixture remains red, attributed, and unchanged by S1.

### Why it was not repaired here

Adding a structural declaration to the frozen O8 acceptance matrix's fixture is a **contract
decision about what that matrix asserts**, not a factual correction. Per the F0 instruction, it
is reported rather than changed. **It needs an owner decision before any slice touches it.**

---

## 14. Measurement repair — the C31 stale version anchor

### The defect

`tests/stage-surfaces-negative-controls.js` C31 anchored on a typed release version:

```js
"<script src=\"shared-stage-actions.js?v=6.7.0-private.1\"></script>\n"
```

`public/index.html:131` has carried `?v=6.7.0-dev.1` since commit `407ee0a`. Because the
`mutate()` probe receipt is an **assertion**, the control did not go quiet — it **threw**, and
**C32, C33 and C34 never executed**. `npm run check` could not complete. CI stayed green
because this suite is not in the `check:ci` chain.

### The repair

The stamp is now **derived** from the same single source `tests/version-consistency.js` and
`tests/public-exposure.js` already use:

```js
const { releaseIdentity } = require("../release-identity.js");
const ASSET_STAMP = releaseIdentity().version;
```

One typed literal was **not** swapped for another. C31 is unchanged in strength and still fires.

### The guard against recurrence

`assetStampGuard()` runs with the controls and makes two assertions:

1. the derived stamp actually occurs in the shipped markup — proving the derivation is live,
   and failing with a message that names `sync:version` rather than surfacing as an
   unexplained probe-receipt miss;
2. **no control in the file types a release version into an asset stamp** — proving the defect
   class cannot return.

Both were proved to fire against deliberately broken copies: a **typed but correct** version is
caught by (2) — the defect is the typing, not the value — and a **typed and stale** version
reproduces the original `probe receipt: C31 expected 1 occurrence(s) of its anchor, found 0`.

### Result

34 controls run; all 9 exported checks driven to failure; C32–C34 execute for the first time
since `407ee0a`.

**No `public/` file was changed. No product behaviour was changed.**

---

## 14a. The foundation measurement, and what it says about CI visibility

`npm run check` cannot complete in this checkout: it aborts at `check:authority-browser`,
which refuses to skip when Python Playwright is absent. Provisioning that environment needs a
network download this work did not make. That is an **environment gap, not a code failure**,
and it is the same condition the v6.7.0-dev.1 verification report recorded under "Not runnable
here".

So the measurement was taken the way that report took its own: every pure-node leaf of
`tests/run-full-check.js` was run individually, so each reports its own exit code instead of
being cut off by the first failure.

**212 leaves run · 210 pass · 2 fail.**

`check:stage-surfaces` and `check:stage-surfaces-negative` both **pass**. The repaired suite is
green and complete for the first time since `407ee0a`.

### The two reds are inherited, and that was proved rather than assumed

Both were re-run in the pristine canonical tree at `a2aff677` with zero working-tree changes,
and both fail there identically:

| Leaf | Failure | In `check:ci`? |
|---|---|---|
| `check:authority-server` | `CineBraid has no record of what kind of image ENTITY.png is …` | **Yes** — this is the "2 of 167" the v6.7.0-dev.1 report attributed as inherited |
| `check:preview-ux` | `motion readiness must require the passed sequence review` | **No** |

Neither is caused by this change, which touches one test file and adds one document.

**Neither is patched here.** `check:authority-server` is the contract question in §13.
`check:preview-ux` is a separate inherited failure, named and attributed, and deliberately left
for its own owner — F0 is not an inherited-test cleanup.

### The measurement-coverage finding

Three suites in the broad chain are invisible to `check:ci`: `check:stage-surfaces`,
`check:stage-surfaces-negative` and `check:preview-ux`. That is precisely why C31 could abort
and `check:preview-ux` could fail while CI stayed green.

`check:ci` runs 95 leaves. `tests/run-full-check.js` runs 214. **The gap between those two
numbers is the measurement blind spot**, and it is what allowed a control file to stop running
entirely without anyone being told. Whether to close it — by extending `check:ci`, or by
running the full check in CI — is a decision for its own slice, not for F0.

---

## 15. What F0 did not do

- No product behaviour change of any kind.
- No `public/` file touched.
- No server or runtime file touched.
- D1–D12 recorded only; none implemented.
- `tests/authority-write-seam-server.js` not modified.
- No test amended in service of D7 or D11; both lists are recorded for their owning slices.
- No inherited failure patched.
- No merge, no push, no amend, no rebase.

# CineBraid Dogfood Pass #2 — Closeout

## Canonical Consolidation of Findings, Evidence, Priorities, and Post-Dogfood Design Direction

**Date:** 2026-08-14
**Pass:** Dogfood #2
**Project:** *The Chimbley Sweep* — painterly early-Victorian music video
**Baseline:** `main @ afe1853ce2fa69f43489822c0e86d5a4c45ea3f6`
**App:** CineBraid `6.7.0-private.1` · OFP `1.0-draft.1`
**Pass type:** Manual creator dogfood on real production work, with real paid fal generation and local Qwen vision review
**Document type:** Closeout / evidence consolidation. **No fixes were implemented in this pass or in this closeout.**

---

# 1. Executive Summary

Dogfood Pass #2 was materially more successful than Pass #1.

The Creator Workspace Overhaul (O1–O5) held. The persistent stage bar, the shot navigator, Generated Media, the Universal Inspector, and the docked Activity Terminal all survived contact with real production work, and the pass reached deeper into the product than Pass #1 did — through full-shot and full-scene automation, continuity correction, motion setup, H3 video generation, and returned-video review.

The pass also confirmed that **the AI layer is producing genuinely useful production judgement.** Local Qwen review correctly distinguished the Widow's teacup-present and teacup-absent cases across real generated candidates. Pairwise continuity review found real cross-frame production problems — lighting drift, focal changes, prop ambiguity, character presentation differences. Missing London Rooftops authority correctly blocked full-shot automation. These are not toy results.

Against that, the pass produced one finding that outranks everything else, and it is the same defect family that headlined Pass #1 — discovered one layer earlier.

> **Pass #1 finding:** an incorrect Frame A was *approved*, and continuity then preserved the mistake perfectly.
> **Pass #2 finding:** for shot S01-01, CineBraid *authored the wrong instruction in the first place.* Frame A was defined as "no Chimbley Sweep visible." The compiled Frame A blocking language explicitly included a tiny Sweep figure. GPT Image 2 then did exactly what it was told.

This moves the diagnosis. Pass #1 concluded that frame-level intent satisfaction must be checked before continuity becomes relevant — a *review* gap. Pass #2 shows the problem is upstream of review: **whole-shot entity membership is overriding frame-specific presence at prompt-compilation time.** A reviewer cannot rescue this, because the reviewer is checking a candidate against a requirement that was already corrupted. This is the highest-value finding of the pass.

The second-ranked issue is a class of production-state dishonesty:

> **`WAITING FOR YOU` can be false.** References and states were approved, and the Assistant and Global Activity continued to assert that approval was required. The right rail accumulated a large backlog of gates that no longer existed.

This is P1-5 from the pre-dogfood readiness audit, which was deliberately left open. It is now confirmed under real production load and is no longer deferrable — a production tool whose "what needs me" surface is stale is a tool the creator stops reading.

The third is a question rather than a verdict, and it is the most important open item in this document:

> **Full-scene automation produced shot cards labelled `APPROVED PICK` with no obvious human approval act, under a configuration exposing `Auto-approval threshold: 85/100`.**

Static source evidence gathered during closeout (§5, A1) is substantial and points one way, but it is not runtime proof, and the correct disposition is **critical verification required** — not a declared invariant violation. It is priority one for the forensic audit.

Beyond those, the pass produced a large, coherent body of workflow and information-architecture findings. Deduplicated, they collapse into a single sentence:

> **CineBraid now has a competent production engine and a credible semantic foundation, and a creator-facing surface that still exposes the machine before it explains the filmmaking decision.**

The three biggest expressions of that are entity establishment (implementation-first), the Review/Generated Media split (Review has silted up into a generation archive), and Motion (four overlapping vocabularies for one creative decision). Those become the three post-dogfood design briefs in §10.

The pass did **not** find that the architecture is wrong. Nothing here calls for a rewrite.

---

# 2. Exact Starting Baseline

| | |
|---|---|
| **Branch** | `main` |
| **Commit** | `afe1853ce2fa69f43489822c0e86d5a4c45ea3f6` |
| **Merge of** | PR #73 (`feature/pre-dogfood-truth-patch`), feature tip `2f6b236` |
| **Supersedes** | `b0f318b` — the Creator Workspace Overhaul close |
| **App version** | `6.7.0-private.1` |
| **OFP version** | `1.0-draft.1` |

### What was already true at the baseline

- **Creator Workspace Overhaul O1–O5 complete.** O1 declared stage model, Production-State Honesty, O2 shell, O3, O4 persistent stage bar, O5 Generated Media + Universal Inspector. There is deliberately no O6.
- **Pre-dogfood truth patch merged**, containing exactly two corrections:
  1. Motion readiness reflects real capability — readiness controls read `capabilityState("vision")` and expose the reason inline rather than appearing actionable and failing after the click.
  2. Untouched rubric defaults are no longer reported as PASS — at the Inspector/reporting boundary, a review is reported only where a review act is evidenced, and a category only where an observation was recorded.

### What was deliberately left open going in

`P1-1` (stale Look status), `P1-4` (Frames parked-run/status), `P1-5` (stale parked run / Assistant still waiting after delivery), and the whole P2/polish tier were knowingly carried into the pass on the expectation that they would surface.

**They surfaced.** P1-5 in particular is confirmed and escalated — see A2. This closeout treats the readiness-audit deferral as discharged: those items are now dogfood-evidenced, not predicted.

---

# 3. What Dogfood #2 Actually Exercised

This was a production pass, not a scripted regression run. Coverage reached:

**Project Bible and entities**
Characters, locations, props · continuity states · state inheritance chains · coverage/views

**Reference production**
Reference generation · reference AI review · approvals · candidate history

**Scene and shot setup**
Scene setup · shot setup · blocking

**Automation**
Full-shot automation · full-scene automation · iterative paid retry passes · automation configuration

**Frames**
Frame generation · frame continuity · pairwise continuity review · continuity correction packages

**Motion**
Motion setup · Motion & Sound Composer · structured motion controls · H3 generation · returned-video review

**System surfaces**
Activity · Terminal · Assistant · right-rail notifications · Generated Media · Universal Inspector · Take me there navigation

**Providers**
fal paid image generation · fal H3 paid video generation · local Qwen vision review · provider contention behaviour

Two things this pass reached that Pass #1 did not: **full-scene automation** and **continuity correction**. Both produced significant findings, and both are conceptually sound — the failures in each are implementation and presentation, not concept.

---

# 4. Positive Findings

These are load-bearing. Several validate expensive decisions and must not be lost in the volume of defects below.

### P1 — Local Qwen vision review is producing correct, discriminating production judgement
Qwen correctly distinguished **Widow teacup-present vs teacup-absent** across real generated candidates. This is exactly the class of fine-grained continuity discrimination the local-VLM investment was made for, and it worked on real material rather than a fixture.

### P2 — Pairwise continuity review finds real production problems
It identified lighting changes, camera/focal changes, prop ambiguity, character presentation differences, and intended-progression issues. The *findings* were strong. Only their presentation was weak (see C2).

### P3 — AI PASS remained visibly advisory in most manual review surfaces
The advisory/authoritative separation held where a human was making the decision. The open question (A1) is confined to the automation path, which makes it a bounded question rather than a foundational one.

### P4 — State inheritance is genuinely intelligent
`Rooftop working → Heavy soot → Dawn with burgundy scarf` produced a correct raw state delta: carry forward heavy soot, add the scarf. The reasoning was right. It was simply buried under the machinery that produced it (B5).

### P5 — CineBraid semantically packages image references
The H3 correction/generation path assembled `#image1` editable target, `#image2` continuity anchor, `#image5` character identity, `#image6` location — without the creator writing reference syntax by hand. This is a real product advantage and the correct division of labour.

### P6 — Missing authority correctly blocked automation
Absent approved **London Rooftops** authority stopped full-shot automation. The gate did its job. (The *navigation* from that gate failed — A7 — but the gate itself was correct.)

### P7 — The Activity Terminal earned its place
The docked bottom terminal was broadly useful throughout the pass. It is the right surface in the right location. Improvements requested (B11) are additive, not corrective.

### P8 — H3 followed the motion prompt
The returned video broadly did what the prompt asked. Where the result was aesthetically poor, that read as model quality, **not** as CineBraid misunderstanding the shot. The motion packaging layer is working.

### P9 — The continuity correction concept is right
Choose structural anchor → choose frame to repair → describe intended change → CineBraid builds the correction package. That is a good workflow. It is currently blocked by a crash (A5) and a dialog bug (A12), both repairable.

### P10 — "Take me there" is not globally broken
Several later instances routed correctly. The defect is destination resolution in specific cases (A7), not the mechanism.

---

# 5. Correctness / Trust Findings

**Evidence tags used below**
`[observed]` seen during the pass · `[source]` static source evidence gathered during closeout · `[verify]` requires runtime or forensic confirmation before action

---

## A1 — Automation writes production authority without a human act
**Severity: P0 · Disposition: CRITICAL VERIFICATION REQUIRED**

`[observed]` Full-scene automation produced shot cards labelled `APPROVED PICK` with no obvious explicit human approval action. Scene automation configuration exposed `Auto-approval threshold: 85/100`.

`[source]` Closeout source inspection found the following. It is presented as evidence, not as a verdict.

- `public/automation.js:3` — `V627_AUTOMATION_AUTO_APPROVE_SCORE = 85`. Matches the observed threshold exactly.
- `public/scene-automation.js:198,241,627` — scene automation reads `autoApproveScore` with a default of `85`.
- `public/automation.js:1228` — `autoApprove` is true when `pass && explicitPass && explicitScore && score >= threshold`.
- `public/automation.js:1574–1582` — on `autoApprove`, the run calls `v626ApproveFrame(shotId, frameId, winner)` and **returns**. `v627PauseForHumanReview` is at line 1583 and is reached only on the *non*-auto-approve path.
- `public/automation.js:1514` — `v626ApproveFrame` sets `frame.winner`, stamps approval identity, and propagates to `shot.winner`. This is the same authority edge a human approval writes.
- `public/app.js:2525` — the `APPROVED PICK` badge renders from the presence of `winner` alone. It does not read the provenance that distinguishes an automatic write from a director write.

**What the records do preserve.** `v628AttachShotAutomationProvenance` (`automation.js:1482`) writes `approval: "director" | "reused" | "automatic"`, and `humanApproved: true` is written only on the director-selected path (`automation.js:2404–2415`) and by `review.js:347`. So the distinction exists in the record layer — it is the badge that collapses it.

**What the documentation asserts.** `docs/architecture/CINEBRAID_OFP_P4_SEM_C3_SHOT_MEDIA_IDENTITY_2026-08-12.md:64` states that automation recording identity on the same terms as a human "does **not** make automation an approving actor: the run still reaches a human gate and a score still never becomes canon." The same claim appears as a code comment inside `v626ApproveFrame`. On the auto-approve branch, the run does not appear to reach that gate.

**Why this is not yet a declared violation.** Three things are unproven:
1. Whether the auto-approve branch actually executes under the configuration used in the pass — `explicitPass` and `explicitScore` must both be true, and their real-world frequency is unmeasured.
2. Whether any outer gate re-gates the run before the project is written.
3. Whether the OFP export treats an `approval: "automatic"` winner as a human statement. B2a enforces `statement.actor.not-human` as a **schema error**, so if an automation-written winner exports as a human approval, the violation is at the contract layer and is considerably more serious than a UI labelling issue. If it exports correctly, the defect narrows to presentation.

**Required verification, in order:** (1) does the branch fire with default config; (2) what does OFP export emit for an automation-written winner; (3) does the shot card read provenance. **Until (1) and (2) are answered, no automated approval from this pass should be treated as production authority.**

---

## A2 — `WAITING FOR YOU` is stale; there is no truth reconciliation
**Severity: P0 · Confirms and escalates readiness-audit P1-5**

`[observed]` References and states were approved, and both the Assistant and Global Activity continued to state that approval was required. The right rail accumulated a large volume of human gates that had already been resolved.

This is the single most corrosive class of defect in a production tool. A "what needs me" surface that can be wrong is a surface the creator stops trusting, and once they stop reading it, every other notification investment is dead.

**Required behaviour, consolidated from the pass:**
- **Event-driven re-evaluation** — approval or rejection immediately re-derives every gate that depended on it.
- **Periodic safety refresh** — a bounded sweep that catches gates missed by event propagation.
- **Manual `Recheck status`** — the creator can always force reconciliation.
- **Resolved items leave automatically** — a resolved gate exits `Waiting for you` without being dismissed.
- **Optional dismissal that does not falsify production state** — dismissing hides the *presentation*; it must never mark unresolved work as resolved.
- **`Recent completed`** — resolved gates move there briefly, so the creator sees that something was cleared rather than watching it vanish.

The invariant: **`Waiting for you` may never contain an item that is not waiting for you.**

---

## A3 — Frame-specific presence is overridden by whole-shot entity membership
**Severity: P0 · Highest-value finding of the pass**

`[observed]` Shot S01-01, *The Illustration Breathes*. Intended: **Frame A** = no Chimbley Sweep visible; **Frame B** = the Sweep revealed. The compiled Frame A blocking language explicitly included a tiny Sweep figure. GPT Image 2 generated a Frame A containing the character — correctly, because CineBraid instructed it to.

**This supersedes the Pass #1 diagnosis.** Pass #1 concluded that frame-level intent satisfaction must be evaluated before continuity becomes relevant, framing it as a review gap. Pass #2 shows the corruption occurs at prompt compilation, before any candidate exists. **A reviewer cannot fix this**, because the reviewer would be validating the candidate against an already-wrong requirement. Fixing only the reviewer would have left the defect fully intact.

**The rule the product needs:**

> Entities attached to a shot describe **what the shot is about**. They do not describe **what is visible in a given frame**. Frame-specific presence — including required *absence* — is authored per frame, and must override shot-level membership in every compiled prompt.

**The corollary, which matters for Motion (B15):** a character reference may legitimately be attached for identity continuity while the character is explicitly absent from the current frame. Reference attachment and frame presence are different facts and must be separately representable.

`[verify]` The compilation site where shot membership enters frame prompt text is not yet located. This is forensic audit item 1.

---

## A4 — Child-entity candidates leak into the parent entity's review
**Severity: P0**

`[observed]` Young Sweep (`CHAR-SWEEP-YOUNG`) had 3 candidates. They appeared correctly under Young Sweep. **The same 3 candidates also appeared under `CHAR-SWEEP`** — the adult Chimbley Sweep review.

The Widow remained clean. That is the diagnostic detail: the Widow has no child entity, so this is **parent/child ownership or filtering**, not general review-list contamination.

This is a trust issue, not a cosmetic one. A creator approving from the adult Sweep's review surface can approve a child's candidate as adult authority, and nothing in the surface warns them.

`[source]` `public/entities.js:521,533,556` show a `tracking.parentEntityId` relationship used for continuity tracking with `unit: "child"`. Whether the review candidate list filters on the same relationship is **not established** — forensic audit item 2.

---

## A5 — Continuity correction crashes on round 1
**Severity: P0**

`[observed]`
```
Generate 3 S04-03 continuity corrections - round 1
FAILED
Cannot read properties of undefined (reading 'id')
```

An unguarded `.id` read on an undefined object. The correction workflow — one of the strongest concepts in the product (P9) — is unusable until this is fixed. `[verify]` Forensic audit item 3.

---

## A6 — `Approve & edit <state>` continuation is unreliable
**Severity: P1**

Three distinct misbehaviours from one flow `[observed]`:

1. Approving **Rooftop working**, then asking to edit **Heavy soot**, returned to the original state.
2. Approving **London Rooftops**, then asking to edit **Moonlit night**, produced only a toast asking which state to edit next.
3. After approving the final Chimbley descendant state, the dialog suggested editing the already-approved **Rooftop working**, with copy implying Rooftop could derive from the newly approved descendant — i.e. **the inheritance direction was presented backwards.**

(3) is the serious one. The other two are navigation failures; (3) misrepresents the derivation graph, which is production truth. Pass #1 recorded a related single-state "Approve & Edit" dead-end (§6.5), so this is a **persisting** defect family, now with a worse symptom.

---

## A7 — `Take me there` resolves to generic destinations
**Severity: P1**

`[observed]` Some instances worked correctly (P10). Others routed to destinations too generic to act on.

Concrete case: a missing approved **London Rooftops** reference routed to generic **Generated Media** rather than to London Rooftops' actionable reference/establishment workspace.

The gate that produced the message knew the entity, the missing authority, and the required action. The navigation discarded all three. **A `Take me there` must resolve to the surface where the named blocker can be cleared** — not to the category of surface it belongs to. `[verify]` Forensic audit item 5.

---

## A8 — Known provider contention is reported as failure
**Severity: P1**

`[observed]`
```
FAL already has 1 active CineBraid job.  →  FAILED / NEEDS ATTENTION
```

In at least one case this was legitimate contention — an H3 video generation genuinely was active.

Nothing failed. A known, expected, self-clearing capacity condition is being presented as an error requiring human attention, which both trains the creator to ignore `NEEDS ATTENTION` and pollutes the same right rail that A2 is already filling with stale gates.

**Direction:** known provider concurrency becomes `QUEUED`. See B12 for the scheduler this implies.

---

## A9 — Added Motion Units cannot be removed
**Severity: P1**

`[observed]` Motion Units could be added and apparently not removed. An irreversible additive control in a paid-generation configuration surface. Note that B15 proposes removing Motion Unit A/B/C from normal creator vocabulary entirely — but **the removal defect must be fixed regardless**, since the underlying beat structure survives that redesign.

---

## A10 — Motion duration integrity
**Severity: P1 · Partly verified**

Two `[observed]` symptoms:

1. Floating-point garbage surfaced to the creator: `9.030000000000001s`.
2. A UI duration of `5` appeared to compile an H3 package/prompt of `6` seconds.

`[source]` Closeout inspection establishes that **neither symptom originates in the H3 backend**:

- `fal-h3-backend.js:60` — `durationSeconds: [5, 15]`, integers.
- `fal-h3-backend.js:275` — non-integer or out-of-range duration is **refused**, not rounded.
- `h3-execution.js:224–229` — a non-integer duration is blocked pre-flight with an explicit message; nothing is sent and nothing is charged.

So `9.030000000000001` cannot have reached a submission — it is an **editorial/UI-layer value leaking into creator-facing display**, which is exactly the editorial-duration vs generation-duration distinction Pass #1 raised (§25). It is unfixed and now visibly leaking.

The `5 → 6` observation is **not** explained by rounding at either layer and remains genuinely open. `[verify]` Forensic audit item 4.

**Rules:** creator-facing generation durations are provider-valid whole numbers. Exact edit timing is preserved separately and never rendered as a generation duration.

---

## A11 — Automation re-render destroys user UI state and duplicates keyed rows
**Severity: P1**

Three `[observed]` symptoms from one root:

1. Collapsing **Detailed timeline** lasted only until the next live update, which re-expanded it.
2. Automation caused layout jitter, page shaking, and large reflow.
3. Full-scene automation produced repeated duplicated `Task 1 / Task 2 / Script / Task 4` strips multiplying down the page.

(1) and (2) are a re-render that rebuilds rather than patches, discarding user-owned view state. (3) is a **keyed-row reconciliation failure** — duplicate rows appearing rather than existing rows updating.

**Invariant:** a live update may change the *content* of a row. It may not change the *count* of rows that represent one thing, and it may not reset a disclosure state the user set. `[verify]` Forensic audit item 6.

---

## A12 — A nested preview closes its parent correction dialog
**Severity: P1**

`[observed]` In the continuity correction flow, opening an image preview and then closing that preview closed the entire parent correction dialog — discarding the correction being composed.

Pass #1 recorded a structurally identical accordion/nesting defect (§21). **Modal and disclosure nesting is a recurring failure class in this codebase** and is worth one systemic fix rather than a third point repair.

---

# 6. Workflow / Information-Architecture Findings

Consolidated from ~30 observations into 19 systemic findings. These are **design inputs**, not repair tickets; the largest of them feed the three briefs in §10.

## Entity establishment and reference coverage

### B1 — Entity establishment is implementation-first
Fresh characters, locations, and props can land in downstream Coverage/States or other restored sub-workspaces **before primary authority exists**. The creator is asked to configure coverage for an entity that has no approved image yet.

**Shared entity entry logic required:**

| Entity condition | Entry action |
|---|---|
| No base authority | **Establish entity** |
| Real review decision waiting | **Review** |
| Authority exists, useful coverage missing | **Expand / Coverage** |
| Complete | Overview, or last meaningful workspace |

`Establish [character / location / prop]` must be creator-facing:

- **Characters** — Build reference sheet *(recommended for continuity-critical leads)* · Create one primary image · Use an existing approved image · Import an existing reference sheet · Choose from production media
- **Locations** — Create location reference pack · Create establishing image · Import existing reference material
- **Props** — One primary image by default, unless actual shots require more

### B2 — Coverage requirements do not follow production need
Props currently receive exhaustive default view expectations that the production does not need. Coverage should be driven by entity importance, actual shot angles, close-ups, state changes, and continuity needs.

**Coverage profiles** — Lead / continuity-critical · Supporting / recurring · Background / single-use · Custom. A profile sets **defaults, never hard locks**. CineBraid should eventually *infer* a recommendation from actual shot usage rather than asking the creator to declare it.

This continues Pass #1 §11 (usage-aware coverage), which remains unimplemented.

### B3 — Reference-sheet-first is not a first-class route
For major characters and many locations, a high-quality multi-angle reference sheet is a better starting asset than a single hero image. The product currently biases to the single image.

Reference-sheet prompting should prefer: high reference-asset quality and resolution · clearly separated views · crop-friendly layout · stable identity · optional simple labels. VLM assistance is covered in §11.

### B4 — State vocabulary and state creation are both overloaded
The Coverage tabs — **Angles / views**, **Expressions**, **Continuity states** — were visually quiet despite being important. Inside Continuity states, "Continuity tracking" exposed AI review rules and low-level attributes, **conflating state creation with review configuration.**

Cleaner concept: **Views · Expressions · State variants**, with AI review and continuity rules demoted to advanced settings.

State creation is separately too complex. The creator's goal is *"Create Heavy soot."* The UI simultaneously exposes approved-image requirements, parent validation, project applicability, raw state delta, generation mode, parent state, model, prompt target, additional direction, prompt build, automation, and candidate history.

**Target:** one concise state summary plus a recommended **Create state** action. Everything else under Advanced.

### B5 — State inheritance is intelligent and invisible
The reasoning was correct (P4) and buried. It should surface as:

> **Derived from Heavy soot**
> **Keeps:** identity, wardrobe, heavy-soot aftermath
> **Changes:** adds burgundy scarf
> **[ Create Dawn with burgundy scarf ]**

This is a presentation change over logic that already works — unusually high value for the effort.

## Review, media, and system surfaces

### B6 — Review has silted up into the generation archive
Reference/Review accumulated multiple states, multiple passes, old candidates, current candidates, approved authority, accidental child candidates (A4), and arbitrary pagination.

**Required hierarchy:** Entity → State → Current/latest run → Candidate.

Review defaults to **current human decisions**. Approved states show authority plus an optional **View alternatives**. Old runs and history move to Generated Media.

### B7 — Generated Media must become the complete archive, with real facets
It should be the one place where **all** generations, candidates, and history can be browsed — which requires facets it does not have:

image / video / audio · reference / frame / motion / blocking / planning · imported / generated · character / location / prop / shot / scene · approved / candidate / rejected · entity · shot/scene · state · provider/model · run/date · authority role

### B8 — Project Bible is a database inspector, not canon
Formatting is good; cards are extremely tall because they render full identity blocks, long continuity prose, full generation prompts, state descriptions, and filenames.

**Default card:** approved visual · short identity summary · critical continuity notes · state summary · **View details**. Provenance, prompts, and history belong in Generated Media and the Universal Inspector — which O5 already built.

### B9 — Returned media is not the focus after generation
After image generation the creator should land on candidates/review. After video generation the returned video should become a **large, media-first review surface**. Instead, after H3 returned a video, the page still foregrounded the giant prompt/package.

**Target for returned video:** large player · **Approve video** · **Request changes** · **Generate another** · AI review if requested · generation details collapsed. Prompts and packages become secondary provenance.

### B10 — The Assistant does not earn permanent screen width
It duplicates Activity and accumulates stale gates (A2).

**Direction:** a compact bottom-right Assistant/Braidy launcher → click opens a right overlay drawer → optional **Pin sidebar**. Role split: **Terminal/Activity owns technical execution**; **Assistant owns creator-facing** — what matters, what needs me, what should I do next.

### B11 — The Activity Terminal needs execution-grade columns and honest cost
It was a positive (P7). It needs consistent column alignment, provider/model, elapsed time, attempt, and cost.

**Cost must distinguish four states** — recorded cost · unknown/unrecorded · local compute · not priced. **Unknown must never render as `$0.00`.** This mirrors the four job/cost states O5 already established in the media projection; the Terminal should adopt the same discipline rather than inventing a second cost vocabulary.

### B12 — There is no provider- or resource-aware scheduler
Directly implied by A8. Needed: queueing across fal images, fal video, other hosted providers, and local review; dependency gates; budget controls. Known capacity limits produce `QUEUED`, never `FAILED`.

## Shot and scene workflow

### B13 — The shot workspace has no persistent Shot Intent
On opening a shot the creator should immediately see: what happens · how it should feel · start state · finish state · camera · critical continuity. **Intent is production truth, not a provider prompt**, and it should persist across every stage of the shot.

Two supporting failures:
- **Attached entity cards do not expose the required continuity state.** The Chimbley Sweep card did not make clear whether the shot required *Rooftop working*, *Heavy soot*, or *Dawn with burgundy scarf* — the exact ambiguity that A3 turns into a wrong paid render.
- **The Inputs stage is too passive** — it mainly lists attached references.

**Direction:** `Inputs` → **Shot Setup**, combining shot intent, exact reference/state selection, start/end entity presence, camera/blocking, and the recommended production route.

### B14 — Production route is chosen after canonical frame requirements, not before
The route determines what assets are needed, so it must be chosen first.

**Creator-facing routes:**

| Route | Use when | Advanced label |
|---|---|---|
| **Reference-led video** | Complex action, multi-reference/state, longer choreographed motion, strong continuity needs | R2V |
| **Animate one image** | Simple movement, talking head / lip sync, simple b-roll | I2V |
| **Start + end frames** | Simple transition where exact endpoints matter | FLF |
| **Text-led video** | Loose b-roll, low continuity | T2V |

**Not every shot needs canonical Frame A/B/C.** Blocking/storyboard frames must be distinct from finished production anchors. S01-01's progression — empty rooftops → reveal begins → Sweep readable — is probably better served by cheap storyboard/blocking plus reference-led motion than by multiple finished canonical stills. This directly extends Pass #1 §30–31, and A3 makes it urgent: fewer forced canonical frames means fewer opportunities to compile a wrong one.

### B15 — Motion is substantially overcomplicated
Overlapping concepts observed in one workflow: Motion Unit A/B/C · Motion packages · Direct Motion · Structured Controls · Motion & Sound Composer · legacy/supplemental direction · model/workflow selector · anchor selection · prompt builder · dialogue/voice · returned video.

**Target flow:** shot intent → recommended route → relevant references → visual motion plan → provider-specific prompt → generate → media-first review.

Three specific reductions:
- **Motion Unit A/B/C leaves normal creator vocabulary.** If multiple segments genuinely matter, call them **Motion beats**. If the shot is one continuous take, expose **no** beat abstraction at all.
- **Provider adapters own provider syntax.** P5 proves CineBraid can package references semantically; creators must never write `#image` syntax. The adapter must also carry frame-aware reference semantics — per A3, a character reference attached for identity while the character is absent from the frame.
- **Dialogue and voice were visually hidden.** Where lip sync or audio timing is relevant, Motion must foreground it.

### B16 — Structured motion controls lack a visual preview
Camera, subject, and environment controls were useful. The missing piece is showing the creator **what the selected motion means**: camera boxes/arrows · ghosted subject end position · START / MID / END schematic.

Label it explicitly as a **planning preview, not a prediction of the generated video.** An unlabelled schematic that a creator mistakes for a prediction is a new trust defect.

### B17 — Automation should be quieter, not louder
Current automation expands giant technical timelines, duplicates task rails (A11), jitters layout, obscures shot navigation, and runs shots out of apparent numerical order without explaining dependency or independence.

**Target:** automation runs in the background · the scene/shot browser stays primary · one stable progress summary — *shot 1 done · shot 2 generating · shot 3 review ready*. Technical chronology belongs in Activity/Terminal, which already exists and is already good (P7).

Two supporting failures:
- **The scene task rail is meaningless.** `Task 1 / Task 2 / Script — VO… / Task 4`, in multiple identical copies, only one of which opened meaningful content. Use real names, and make only genuinely actionable items look clickable.
- **Scene automation opens a giant advanced configuration modal.** The concept is right as *Advanced*. Normal automation should show what will be generated, selected shots, recommended strategy, first-pass images, estimated cost, and where human checkpoints occur. **Guided mode should likely be the default.**

### B18 — Paid iterative automation does not stop for human review by default
`[observed]` Heavy-soot automation generated candidates → AI rejected all → the prompt was revised → **paid generation repeated**, without the creator easily seeing why each candidate failed, the common failure reason, the exact prompt delta, or why another paid pass was justified.

This is Pass #1 §17–18 recurring. It was raised, and it is still spending money without explanation.

**Guided mode:** first pass → summary → human checkpoint → authorize next pass. Autonomous bounded retry remains available and **opt-in**.

### B19 — The correction flow needs compare and less scrolling
The concept is right (P9). It needs A/B compare, materially less scrolling, and the parent-dialog fix in A12 — on top of the crash in A5.

---

# 7. UI / Presentation Findings

### C1 — Review card hierarchy is wrong
`Approve / AI check / Reject` alignment is poor. Preferred: **image → concise AI finding → human decision footer.** AI pass remains visibly advisory.

### C2 — Numeric AI scores mislead; requirement verdicts should lead
`[observed]` `90 FLAG` · `90 PASS` · `85 FLAG` · `87 PASS`.

The underlying logic was coherent — a high overall match with one hard requirement missing is exactly a `90 FLAG`. The **synthetic overall score** is what destroys the explanation. The same defect appeared at scene scale: a full continuity score of **`0/100`** was far less useful than the findings it summarised, which were genuinely good (P2).

**Rule: lead with the requirement verdict and its explanation. Prefer categorised severity and findings over an opaque global score.** This is Pass #1 §9.1 (same score, different verdict) unresolved, now with a second instance.

### C3 — Multiple passing candidates deserve an optional comparative recommendation
When 2+ candidates pass, CineBraid may offer **Recommended primary reference**, with reasons: identity readability · coverage · neutral pose · crop usefulness. **The human still chooses.** See §11 — this is a VLM deliverable.

### C4 — Off-domain placeholder copy reads as project data
**Diagnosis corrected during closeout.** `[observed]` the Motion & Sound Composer displayed *driver-side door*, *coupler*, *seedling*, *relay*, *status light* — none related to a London rooftop shot.

`[source]` These are static `placeholder=` attributes on empty inputs, not project data:
- `public/motion-sound-composer.js:220–222` — "from the seedling to the relay", "right hand seats the coupler…", "a status light goes dark after she stops"
- `public/v607-composer.js:704` — "at the driver-side door"

**This is not a correctness or data-leak defect.** It is a UI copy defect: placeholder examples drawn from an automotive/industrial domain, rendered inside a Victorian rooftop shot, which read as data at a glance. Reclassified from A to C.

Two caveats worth carrying forward:
1. **Placeholders that read as data are still a trust hazard.** Examples should be domain-neutral, or drawn from the current project.
2. **These strings live in two composer files.** Per the known `v607-composer` / `creation-studio` shadowing hazard, whichever composer is inert will silently absorb any fix. Establish which surface is live before editing — forensic audit item 7.

### C5 — The shot header states the same thing three times
Stage strip (`Inputs / Look / Frames / Motion / Deliver`) → status-card row (`References / Required Frames / Motion / Open Stage`) → a large **Next Action** panel repeating the state again.

**Direction:** make the sticky stage strip smarter — green complete, cyan current, amber blocked, with counts and reasons — and delete the redundant cards.

### C6 — Completion cues are too weak
When required references are complete, show restrained green checks and **Ready**. CineBraid currently emphasises missing work far more than accomplishment. This is Pass #1 §12 unresolved.

### C7 — Control sizing is inflated
Consolidated: huge `Add/create shot image` cards consume space that should be compact and contextual inside the relevant frame/setup workspace · the approval stamp was fun but too large — keep a restrained professional success banner · the Shot Actions popover is oversized — keep the actions, use a conventional compact menu.

### C8 — Pagination cuts through the active decision set
The shots browser defaults to 5 per page, slicing through scene groupings. Candidate Review paginates the active comparison set.

**Rules:** show a scene's shots together, with collapsible scenes; use larger pages or virtualisation only where genuinely needed; **never paginate an active decision set** — comparison is the entire purpose of that surface.

### C9 — Frame selection and frame inspection are the same gesture
The approved Frame A/B strip needs clear large-preview and compare interactions, with **selecting a frame** and **inspecting a frame** as separate actions. This is the Pass #1 "inspection must not execute" principle applied to the frame strip.

---

# 8. Root Systemic Themes

Nine themes account for nearly every finding above.

### T1 — Frame-level truth is being overwritten by shot-level truth
A3, B13, B14, and part of B15. The shot knows its entities; the frame knows its presence. Shot-level facts are currently winning at compile time, and the result is wrong paid renders. **This is the theme to fix first.**

### T2 — Production state can be stale, and staleness is indistinguishable from truth
A2, A8, A11, and the readiness audit's P1-1/P1-4/P1-5. Nothing in the UI marks a claim as possibly-stale, so a stale claim and a true one look identical. Reconciliation must be a system property, not a per-surface patch.

### T3 — Authority attribution is preserved in records and collapsed in presentation
A1 and C2. The record layer distinguishes automatic from director approval, and AI recommendation from human decision; badges and scores flatten both. **The semantic foundation is doing its job and the presentation layer is undoing it.**

### T4 — Review became an archive; the archive has no facets
B6, B7, B8, C8. One surface accumulated two jobs. O5 already built the surface that should take the second one.

### T5 — Implementation vocabulary precedes creative vocabulary
B1, B4, B14, B15. Motion Units, prompt targets, generation modes, panel positions, and R2V/I2V/FLF/T2V all appear before the filmmaking decision that would let a creator choose between them. This is Pass #1's headline product insight, restated with more evidence.

### T6 — Completed work is not visibly handed forward
B5, C6, C5, and A6's broken continuations. Intelligence that exists is invisible; completion is unmarked; the next action is buried. This is the cheapest theme to improve — most of it is presentation over logic that already works.

### T7 — Automation is loud, unbounded, and spends money without explaining itself
A11, B17, B18. Automation currently competes with the workspace for attention while explaining less than the Terminal does.

### T8 — Modal and disclosure nesting is structurally unsafe
A12, plus Pass #1's accordion defect. Two passes, two instances, same class. Worth one systemic fix.

### T9 — Synthetic scores are displacing explanations
C2, and the `0/100` continuity score. The models are producing good reasoning (P1, P2). Compressing it to an integer is discarding the product's most valuable output.

---

# 9. Immediate Repair Priority

Repair items only. Design work is in §10. Nothing below was implemented.

## P0 — Blocks trust in production output; required before Dogfood #3

| ID | Finding | Nature |
|---|---|---|
| **A1** | Automation writes production authority without a human act | **Verification first**, then repair scoped by the answer |
| **A3** | Frame-specific presence overridden by shot-level membership | Compilation defect — produces wrong paid renders |
| **A2** | Stale `WAITING FOR YOU`; no truth reconciliation | Production-state dishonesty (confirms P1-5) |
| **A5** | Continuity correction crashes on round 1 | Hard crash; feature unusable |
| **A4** | Child-entity candidates leak into parent review | Authority contamination risk |

## P1 — Materially damages the production pass; fix before or during the next engineering batch

| ID | Finding |
|---|---|
| **A6** | `Approve & edit <state>` continuation, especially the reversed inheritance direction |
| **A7** | `Take me there` destination resolution |
| **A8** | Provider contention presented as failure *(pairs with B12)* |
| **A9** | Motion Units cannot be removed |
| **A10** | Duration integrity — float leak into UI, and the unexplained `5 → 6` |
| **A11** | Re-render destroys UI state and duplicates keyed rows |
| **A12** | Nested preview closes parent dialog *(fix as a class, per T8)* |
| **C2** | Requirement verdict must lead; retire the synthetic overall score |
| **B11** | Cost honesty in the Terminal — unknown must never render as `$0.00` |

## P2 — Real, deferred behind the design briefs

C1, C4, C5, C6, C7, C8, C9, and the presentation half of B5. Several are cheap and high-morale (C6, B5) and may be worth taking early even though they are P2.

## Explicitly not scheduled here

Everything in §10. Those are design briefs, not tickets, and turning them into tickets before they are designed is how the Pass #1 backlog got hard to read.

---

# 10. Post-Dogfood Design Briefs

Three briefs. Each should produce a design document before any implementation batch is scoped.

---

## Brief 1 — Entity Establishment and Reference Coverage

**Absorbs:** B1, B2, B3, B4, B5, B8 · **Supports:** A4, A6

**Problem.** Entity work is implementation-first. Creators are asked to configure coverage before authority exists, state creation exposes the entire machine at once, coverage defaults ignore what the production actually needs, and the reference-sheet route — often the right one for leads — is not first-class.

**Scope**
1. **Establish-first entry logic** — the four-state entry table in B1, shared by characters, locations, and props.
2. **Creator-facing establishment routes** — per-type, as enumerated in B1.
3. **Coverage profiles** — lead / supporting / background / custom, setting defaults without locking, with eventual inference from actual shot usage.
4. **Reference-sheet-first** — sheets as a first-class establishment route, with prompting tuned for separated views and crop-friendly layout.
5. **Vocabulary** — Views / Expressions / State variants; AI review and continuity rules demoted to advanced.
6. **State creation reduction** — one summary plus a recommended **Create state**; everything else under Advanced.
7. **Inheritance made visible** — the Derived-from / Keeps / Changes card.
8. **Project Bible as canon** — short cards with **View details**.

**Must not break**
- The parent/child entity relationship must become *more* explicit, not less — A4 shows it is already leaking.
- Inheritance direction must be presented correctly — A6(3) shows it currently can be reversed.
- Coverage requirement semantics are canonical and shared; a profile changes *defaults*, never the contract.

**Open question.** Does a coverage profile write a persisted requirement, or is it purely a default-generator? These have materially different implications for the OFP record.

---

## Brief 2 — Review, Generated Media, and Activity

**Absorbs:** B6, B7, B9, B10, B11, B12, C1, C2, C3, C8 · **Supports:** A2, A8

**Problem.** Review is doing two jobs and failing at both. Generated Media lacks the facets to take the second one. The Assistant duplicates Activity while accumulating stale gates. Provider contention reads as failure. Cost is not honest.

**Scope**
1. **Review = current decisions.** Entity → State → Current run → Candidate. Approved states show authority plus **View alternatives**.
2. **Generated Media = the complete archive**, with the full facet set in B7.
3. **Truth reconciliation** (A2) — event-driven, periodic safety refresh, manual `Recheck status`, automatic exit on resolve, presentation-only dismissal, `Recent completed`.
4. **Assistant/Activity role split** — compact launcher, overlay drawer, optional pin; Assistant answers *what matters / what needs me / what next*, Activity owns execution.
5. **Terminal columns and honest cost** — provider/model, elapsed, attempt, cost, with the four cost states kept distinct.
6. **Provider-aware scheduling** — queueing across fal images, fal video, other hosted providers, and local review, with dependency gates and budget controls.
7. **Review card hierarchy and verdict-led scoring** — C1, C2; comparative recommendation C3.
8. **No pagination of an active decision set.**

**Must not break**
- O5's read-only projection stays read-only and keeps its four distinctions — two identity domains, four job/cost states, human decision vs AI recommendation vs AI review, and the two review shapes. New surfaces are **consumers** of the projection, never new readers of disposition.
- The two media identity domains stay separate; a library id is never tried as a ledger id.
- Dismissal must never falsify production state.

**Open question.** Where does the queue live? A browser-side scheduler cannot survive a reload; a server-side one is a larger change than anything else in this brief.

---

## Brief 3 — Shot Setup and Motion

**Absorbs:** B13, B14, B15, B16, B17, B18, B19, C5, C9 · **Supports:** A3, A9, A10, A12

**Problem.** Motion presents four overlapping vocabularies for one creative decision. Production route is chosen after frame requirements, when it should determine them. Shot intent is nowhere persistent. Automation is loud and spends money without explanation. And most seriously, frame-specific intent is lost before generation (A3).

**Scope**
1. **Persistent Shot Intent** — what happens, how it should feel, start state, finish state, camera, critical continuity. Production truth, not a prompt.
2. **Inputs → Shot Setup** — intent, exact reference/state selection, start/end presence, camera/blocking, recommended route.
3. **Frame-specific presence authority** (A3) — per-frame presence, including required absence, overriding shot-level membership in every compiled prompt.
4. **Route-first** — reference-led / animate one image / start+end / text-led, with R2V/I2V/FLF/T2V as advanced labels; route chosen **before** canonical frame requirements.
5. **Blocking/storyboard frames distinct from canonical anchors** — not every shot needs Frame A/B/C.
6. **Motion vocabulary collapse** — Motion beats or nothing; provider adapters own `#image` syntax; frame-aware reference semantics; dialogue/voice foregrounded where relevant.
7. **Visual motion preview** — camera boxes/arrows, ghosted end position, START/MID/END, explicitly labelled as planning not prediction.
8. **Media-first returned-video review** — large player, Approve / Request changes / Generate another, details collapsed.
9. **Quiet automation** — background execution, stable progress summary, real task names, guided mode default, human checkpoint before repeat paid passes.
10. **Correction flow ergonomics** — A/B compare, less scrolling, safe dialog nesting.

**Must not break**
- The declared five-stage shot model stays authoritative; the rival seven-stage model in `app.js` stays inert.
- The persistent rail/dock identity and the fourth shell slot established by O4 survive; three suites already read the shot navigator there.
- Motion readiness continues to reflect real capability, per the pre-dogfood truth patch — a control whose capability cannot execute must not appear actionable and then fail after the click.
- H3 remains the only dispatching video family; nothing here widens that.

**Open question.** Does route selection persist as a shot-level record, and does it constrain which frames are *required*? If yes, it interacts directly with coverage requirement semantics and needs an OFP decision.

---

# 11. Spark / VLM Follow-Up Requirements

The pass produced the strongest evidence yet that the local-VLM investment is paying off (P1, P2), and it produced a clear list of what to ask the models for next.

### V1 — Frame-intent verification *(highest value; pairs with A3)*
A reviewer that answers **"does this candidate satisfy the defining intent of *this* frame?"** — including **required absence**, which is the exact case S01-01 failed. Distinct from pairwise continuity, which answers whether two frames belong to a plausible continuous shot. Pass #1 identified the need; Pass #2 shows it must sit alongside the compilation fix, not instead of it.

### V2 — Reference sheet analysis *(pairs with B3)*
Detect views · suggest crop regions · classify front / three-quarter / profile / rear · assess sheet quality · recommend a primary crop. **The human confirms every crop.** VLM proposes, human disposes.

### V3 — Comparative candidate recommendation *(C3)*
When 2+ candidates pass, recommend a primary reference with stated reasons — identity readability, coverage, neutral pose, crop usefulness. Advisory only; the human still chooses.

### V4 — Categorised severity in place of global scores *(C2, T9)*
Continuity and reference review should emit categorised findings with severity, not a synthetic integer. The `0/100` continuity result and the `90 FLAG` / `90 PASS` pairs both show the score discarding the model's actual reasoning.

### V5 — Failure-reason clustering for paid retry *(B18)*
Before a second paid pass, summarise **why each candidate failed**, the **common failure reason**, and the **prompt delta**. This is the explanation layer that makes a Guided-mode checkpoint meaningful rather than a speed bump.

### V6 — Coverage inference from actual shot usage *(B2)*
Given the shot list, recommend a coverage profile per entity rather than asking the creator to declare one.

**Constraint across all six.** Every VLM output stays advisory. None of these may write production authority, and V3 in particular must never auto-select. The A1 question is a live reminder of how narrow that boundary is.

---

# 12. Recommended Order of Work

### Step 0 — Freeze this closeout
This document is the canonical Dogfood #2 record. Later evidence supersedes earlier evidence *within* it; it is not amended by recollection.

### Step 1 — Forensic audit *(before any repair)*
Run the seven items in §13. **A1 and A3 gate everything else.** Repairing A1 before knowing what OFP export emits risks fixing a badge while a contract violation persists underneath; repairing A3 before locating the compilation site risks patching a symptom in the wrong layer.

### Step 2 — P0 repair batch
A3 first (it produces wrong paid output), then A1 as scoped by the audit, then A2, A5, A4. **A2 is the natural home for T2**, so scope it as reconciliation-as-a-system-property rather than a per-surface patch.

### Step 3 — P1 repair batch
A6, A7, A9, A10, A11, A12, C2, B11. Fix A12 as the class described in T8, not as a point repair. A8 lands here as a presentation fix (`QUEUED` not `FAILED`) even though the full scheduler (B12) belongs to Brief 2.

### Step 4 — Write the three design briefs
In order: **Brief 3 (Shot Setup and Motion)** first — it carries A3's product surface and the most creator pain; then **Brief 2 (Review / Generated Media / Activity)**, which is largely IA over surfaces O5 already built; then **Brief 1 (Entity Establishment)**, the largest and the one that most benefits from the other two being settled.

### Step 5 — Cheap morale batch, optionally in parallel
B5's inheritance card and C6's completion cues are presentation over working logic and disproportionately improve how the product feels.

### Step 6 — Implementation batches per brief
Scoped from the briefs, not from this document.

### Step 7 — Dogfood Pass #3
Entry criteria in §13.

**One warning carried from prior work.** Several targets here live in files with known shadowing — `v607-composer` vs `creation-studio`, and the two motion composers noted in C4. Establish which surface is live before editing, or the fix lands in dead code and the pass reports no change.

---

# 13. Dogfood Pass #3 Entry Criteria

## Forensic audit items — evidence insufficient in this pass

| # | Question | Blocks |
|---|---|---|
| **1** | Where does shot-level entity membership enter frame prompt text, and what is the correct override point for per-frame presence including required absence? | A3 — P0 |
| **2** | Does the auto-approve branch fire under default config (`explicitPass` **and** `explicitScore` both true), and **what does OFP export emit for a winner whose provenance is `approval: "automatic"`** — given B2a enforces `statement.actor.not-human` as a schema error? Third: does the `APPROVED PICK` badge read provenance at all? | A1 — P0 |
| **3** | Where is the review candidate list filtered by owning entity, and why is the Widow unaffected? | A4 — P0 |
| **4** | What is the undefined object in the correction round-1 `.id` read? | A5 — P0 |
| **5** | Where does a UI duration of `5` become `6` in the H3 package, given both `h3-execution.js` and `fal-h3-backend.js` require integers and refuse rather than round? Separately, where does the float editorial duration reach creator-facing display? | A10 — P1 |
| **6** | Why do live updates duplicate task strips rather than patch keyed rows, and why is disclosure state discarded on re-render? | A11 — P1 |
| **7** | Which motion composer surface is live — `motion-sound-composer.js` or `v607-composer.js` — and which other Motion targets sit in shadowed files? | C4 + all of Brief 3 |

## Entry criteria for Dogfood #3

**Hard gates**
1. Every P0 in §9 closed, or explicitly and deliberately deferred with a recorded reason.
2. **A1 answered** — the authority question resolved to a stated position, with automation's approval behaviour documented in whatever form it takes.
3. **A3 fixed and demonstrated** — a shot whose Frame A requires an absent character compiles a prompt that requires the absence, verified end to end on a real render.
4. **A2 fixed** — `Waiting for you` contains no resolved item after an approval, with `Recheck status` available.
5. **A5 fixed** — continuity correction completes round 1 on a real shot.

**Soft gates**
6. At least one of the three briefs written and its first implementation batch merged. Brief 3 is the recommended first.
7. P1 batch substantially complete, particularly A10 and B11 — cost and duration honesty, since Pass #3 will spend more money than Pass #2 did.
8. The dogfood sandbox rebuilt fresh, and the Pass #2 project state **preserved** as evidence rather than reset.

**Pass #3 should specifically re-exercise**
- Full-scene automation, with attention to what `APPROVED PICK` means after A1 is resolved.
- A shot with required per-frame absence — the S01-01 case.
- Continuity correction end to end.
- A long automation run, watching whether `Waiting for you` stays true across it.
- The reference-sheet route, if Brief 1 has landed.

---

# 14. Statement of Non-Implementation

**No fixes were implemented during Dogfood Pass #2 or during this closeout.**

Specifically:

- No source code was modified.
- No commits or merges were made.
- No paid provider calls were made during closeout.
- The dogfood project state was not erased, reset, or cleaned up, and is preserved as evidence.
- No redesign was performed. §10 contains briefs to be written, not designs that have been decided.

The only files written during closeout are this document.

Source citations in §5 and §7 come from **read-only inspection** performed to determine whether an observed symptom was already explained by existing code. That inspection changed two dispositions and is recorded as such:

- **C4** was reclassified from correctness/trust to UI copy, after the suspect strings were confirmed to be static `placeholder=` attributes rather than project data.
- **A10** was narrowed after both H3 layers were confirmed to refuse non-integer durations rather than round them, which relocates the float leak to the editorial/UI layer and leaves `5 → 6` genuinely unexplained.

**A1 was deliberately not resolved.** The static evidence is substantial and points in one direction. It is not runtime proof, and the correct disposition for a question about production authority is verification, not inference.

---

**End of Dogfood Pass #2 closeout.**

*Prior pass: `docs/dogfood/CINEBRAID_DOGFOOD_PASS_1_CHIMBLEY_SWEEP_2026-08-12.md`*

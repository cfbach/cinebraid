# CineBraid Dogfood Pass #1 — Chimbley Sweep
## In-Depth Production UX, Workflow, Automation, Review, and Launch Report

**Date:** 2026-08-12  
**Dogfood build:** CineBraid `6.7.0-private.1`  
**Source baseline:** `main @ 24da965`  
**Project:** *The Chimbley Sweep*  
**Pass type:** Manual creator dogfood, performed as an actual filmmaker rather than as a scripted QA operator  
**Outcome:** **End-to-end workflow succeeded and produced a good video, but the shot used an incorrect approved Frame A that should never have been accepted.**

---

# 1. Executive Summary

Dogfood Pass #1 achieved its main goal.

CineBraid successfully carried a real production shot through a substantial portion of its intended workflow:

1. project references and continuity states;
2. reference generation and approval;
3. coverage and alternate-view work;
4. blocking;
5. frame generation and review;
6. pair continuity review;
7. motion setup;
8. first/last-frame video generation;
9. final returned video.

The generated video itself came out well.

That is a major positive result: **the underlying production machinery is capable of completing the loop.**

However, the pass also exposed a large number of workflow, state-communication, review, navigation, and automation problems. Most of them do **not** indicate that CineBraid's core architecture is wrong. Instead, they show that the UI often:

- hides the creator's most important next action;
- exposes implementation details before explaining the filmmaking decision;
- loses semantic state when moving between views;
- fails to carry completed decisions visibly into the next stage;
- conflates AI recommendation, AI review, human approval, and production authority;
- makes background work look active when it is actually paused for human review;
- silently resumes paid work after a human approval;
- does not explain paid retries well enough;
- presents static-frame-first workflows too strongly even when modern reference-to-video workflows are a better fit.

The most important semantic failure was not that the final video failed. It was that **Frame A was wrong, yet the workflow accepted it and successfully propagated the mistake.**

Frame A was supposed to begin without the Chimbley Sweep visibly present/readable. The recommended and approved Frame A contained the character anyway. Frame B was supposed to contain the character. Pair continuity then correctly judged A and B as strongly continuous, and the video model successfully animated between them.

This produces the key conclusion of the pass:

> **Continuity can preserve a bad creative decision perfectly. CineBraid must verify that a candidate satisfies the defining intent of its own frame before that candidate becomes authority.**

A second major conclusion emerged from the motion workflow:

> **CineBraid should likely become reference-first and direction-heavy for modern video generation. Reference-to-video should be the preferred recommendation for many reference-rich shots, while first/last-frame generation should be an intentional endpoint-control workflow rather than the automatic result of having two approved frames.**

The current product is therefore best described as:

> **A strong production engine with an increasingly credible semantic foundation, but a creator-facing workflow that still behaves too much like a collection of implementation panels rather than a guided filmmaking system.**

---

# 2. Purpose of This Dogfood Pass

This pass intentionally did **not** behave like a scripted regression suite.

The goal was to use CineBraid as a filmmaker and notice moments such as:

- "Where do I do this?"
- "Why did it do that?"
- "What does this control mean?"
- "What do I need before I can proceed?"
- "Which image did I approve?"
- "Why is this still running?"
- "Why did it spend money again?"
- "Where did the result go?"
- "Which generation route should I use?"
- "Why does the next stage not show the work I just completed?"

This distinction matters.

The Creator Reality audit found many static source-level defects and hidden capabilities. The dogfood pass found something different: **workflow continuity, decision hierarchy, discoverability, trust, and creator mental-model failures** that are difficult or impossible to infer reliably from source inspection alone.

---

# 3. End-to-End Outcome

## 3.1 What worked

The shot successfully progressed through:

- approved production references;
- continuity-state work;
- location coverage;
- blocking candidates;
- Frame A creation;
- Frame B creation;
- AI candidate review;
- human approval;
- pair continuity review;
- motion prompt preparation;
- first/last-frame video generation;
- returned-video result.

The final motion generation completed successfully and the video itself was considered good.

This confirms that the central production loop is not merely theoretical.

## 3.2 What failed semantically

The wrong Frame A entered the workflow.

The intended shot progression required:

- **Frame A:** the Sweep absent or not yet visibly/readably present;
- **Frame B:** the Sweep present/readable.

Instead:

- Frame A contained the character;
- the frame was recommended/approved anyway;
- downstream pair continuity found the two images coherent;
- the motion generation successfully animated the wrong progression.

The lesson is not "pair continuity is broken."

The lesson is:

> **Frame-level intent satisfaction needs to be evaluated before continuity becomes relevant.**

The pair reviewer answered a different question:

> "Do these two approved images belong to a plausible continuous shot?"

It did not answer:

> "Does Frame A satisfy the creative/story requirement assigned to Frame A?"

Both questions are necessary.

---

# 4. High-Level Positive Findings

The pass exposed many problems, but it also provided strong positive evidence.

## 4.1 The overall production workflow can complete

This is the most important positive.

CineBraid can already connect:

**references → planning → still generation → review → approval → motion → video**

into a functioning production loop.

The work ahead is primarily about making that loop:

- understandable;
- truthful;
- predictable;
- more efficient;
- easier to navigate;
- safer around automated spend.

## 4.2 Pair continuity review can be useful

The pair continuity review produced a strong and understandable result when it ran correctly.

It separated concepts such as:

- camera;
- environment;
- lighting;
- character;
- props;
- intended progression.

The review recognized the intended camera progression and produced a high score consistent with its component results.

This is worth preserving.

The main problems were around how the review was triggered and surfaced, not the usefulness of the completed result.

## 4.3 Approved authority resolution still works in some automated paths

Although some manual selection surfaces hid approved references, the coverage automation path successfully found and used the approved London Rooftops source.

This is important diagnostic evidence:

> The authority was not necessarily lost from the project; different UI readers were disagreeing about what media should be exposed.

That points toward a semantic-reader/UI consistency problem rather than universal data loss.

## 4.4 Coverage-sheet generation can create usable source material

The generated location coverage sheet appeared potentially useful as raw source material.

The failure was not necessarily the generated sheet itself. The failure was that CineBraid did not make it easy to understand:

- which panel corresponded to which intended view;
- how panels were numbered;
- how the sheet grid mapped to crop controls;
- whether the generated viewpoints were truly spatially consistent or simply visually useful alternates.

## 4.5 Human approval remains meaningful

The dogfood repeatedly demonstrated why human approval should remain the production authority.

AI review could be useful, but:

- identical scores could yield different verdicts;
- candidates could satisfy generic continuity while violating the shot's defining intent;
- recommendation and approval state were often confused;
- high-scoring near misses deserved human intervention rather than blind regeneration.

This validates the product principle:

> **AI advises. Human approval establishes canon.**

---

# 5. Headline Product Insight: The Shot Workflow Needs a Creator-Facing Grammar

The current stage structure can probably survive:

1. Inputs
2. Look & Blocking
3. Frames
4. Motion & Sound
5. Deliver

The problem is not primarily the existence of these stages.

The problem is that each stage currently behaves too much like a container of controls.

The dogfood produced a clear umbrella requirement:

> **Every shot-creation stage must explain its purpose, visibly inherit prior decisions, present the valid ways forward, distinguish required from optional work, and clearly hand the creator into the next stage.**

Every stage should answer, immediately:

### What is this step for?
Plain filmmaking language.

### What has already been completed?
Actual visual references, blocking, frame authorities, continuity decisions, etc.

### What are my valid ways forward?
Manual, assisted, automated, upload-existing, skip-optional, alternate generation route.

### What does CineBraid recommend?
A recommendation with a reason, not a hidden default.

### What is required and what is optional?
No ambiguous prerequisites.

### What happens next?
Clear completion and next-stage handoff.

A filmmaker entering any stage should understand the next reasonable action within roughly five seconds, without knowing CineBraid's internal data model.

---

# 6. References and Continuity-State Findings

## 6.1 Responsive reference cards can break visually

At some viewport sizes/resolutions, approved-reference cards collapse into extremely narrow text columns while leaving large unused areas.

**Type:** UI bug  
**Priority:** Launch-relevant  
**Direction:** responsive layout regression coverage across common desktop widths.

## 6.2 Creating a second state has no clear primary workflow

Creating a state such as `Heavy soot` from an approved parent state exposed too many overlapping controls at once:

- Generate from parent
- Upload state reference
- Choose candidate
- Choose approved image
- Validate against parent
- State delta
- Generation mode
- Parent state
- Prompt target
- Additional direction
- Build prompt
- Improve
- Automate

The creator must infer which controls are steps, alternatives, advanced options, or post-generation actions.

### Desired model

1. **Approved parent authority**
2. **What changes in this state?**
3. **Generate from approved parent**
4. **Review candidates**
5. **Approve state**

Alternate paths such as upload-existing should be visible but secondary.

## 6.3 State Reference Generation is visually buried

The most important action for an incomplete state is displayed like an advanced configuration area.

If a state needs a reference, that should become the dominant task.

Example:

> **Dawn with burgundy scarf — Reference needed**  
> Based on: Rooftop working state ✓  
> **Create reference from approved parent**

Provider/model/prompt mechanics should be secondary or under Advanced.

## 6.4 Character-level reference automation would be valuable

Instead of requiring entity-by-entity, state-by-state setup, the character itself should offer:

> **Build Character References**

Possible scopes:

- Base character authority
- Required states
- Missing coverage
- Selected states

Automation should:

**generate → organize → advisory review → queue human approval**

It should not auto-establish canon.

## 6.5 Single-state "Approve & Edit" dead-ends

When an entity only has one continuity state, clicking an approval/edit path produced a self-referential workflow such as:

> "Choose the continuity state to edit next"

with nowhere to go.

This is a concrete functional edge-case bug.

### Desired behavior

For one-state entities:

- no "continue to another state" machinery;
- approve and close;
- or approve and edit the current state's details.

For multi-state entities:

- explicit next-state selector only when another state genuinely exists.

## 6.6 References overview should support selectable bulk automation

The top-level References page is a natural place for:

> **Automate selected references**

Selection could include:

- missing references;
- selected characters;
- selected scene entities;
- all required references.

A preflight should explain:

- entities selected;
- work required;
- already-approved authorities;
- generation request count;
- estimated spend when available;
- that human approval remains required.

This could reduce repetitive navigation substantially.

---

# 7. Approval and Media-State Consistency Findings

A recurring pattern throughout the pass was:

> CineBraid knows an approval somewhere, but a nearby reader presents all media as equivalent.

This is one of the strongest cross-cutting findings.

## 7.1 Approved media is not clearly identified in selectors

A coverage selector showed several candidate filenames with no visible marker indicating which one was already approved.

This makes it possible to choose an unapproved candidate while believing the user is working from canon.

### Product rule

> **Anywhere approved and unapproved media appear together, approval state must remain visible.**

## 7.2 Approved reference disappears from a downstream candidate list

London Rooftops had an approved source image, but the following manual "Choose & approve" surface showed only the other candidates.

The automation path later proved that CineBraid still knew the approved authority.

Therefore:

- the authority existed;
- the manual candidate reader filtered it out;
- the creator lost access to the most important image in the workflow.

### Desired behavior

Approved authority should be pinned and clearly separated:

> ✓ APPROVED AUTHORITY — Candidate 1  
> Candidate — Candidate 2  
> Candidate — Candidate 3

Approval should make media **more important and more reusable**, not less visible.

## 7.3 Approved blocking guide is not visibly identified

Blocking automation selected a best result and the creator manually approved it, but the blocking cards did not clearly show:

- AI recommended;
- human approved;
- active blocking authority.

These states need separate visual semantics.

Suggested chips:

- `★ AI Recommended · 93/100`
- `✓ Approved by you`
- `Alternate`
- `Rejected`

---

# 8. Universal Media Inspector Requirement

Thumbnail behavior was inconsistent:

- some thumbnails opened a plain enlarged image;
- some opened an AI review panel;
- some were unclickable;
- some approval gates exposed no review details at all.

This should become one universal interaction.

## Proposed rule

> **Thumbnail → Media Inspector**

The inspector adapts to context but always provides the same basic affordance.

### For reviewed media
- large image/video;
- score;
- PASS / FLAG / UNCERTAIN;
- requirement results;
- deciding issue;
- approval state;
- provenance;
- correction lineage.

### For unreviewed media
- same inspector;
- prominent **Run AI Review** action.

### For approved media
- approved/canon target clearly stated;
- existing review if available;
- provenance;
- optional re-review.

### Secondary action
- Clean preview / fullscreen lightbox.

AI review should be **accessible**, not **mandatory**.

---

# 9. AI Review Semantics Findings

## 9.1 Same score, different verdict is not explained

The dogfood produced:

- `91 → FLAG`
- `91 → PASS`

This can be valid if the score is overall quality and the verdict depends on a hard requirement.

The UI must explain that distinction.

Better:

> **91/100 — 1 required state issue remains**

versus:

> **91/100 — all declared state requirements observed**

The score should never be allowed to substitute for the actual gating logic.

## 9.2 High-scoring near misses should often trigger human review

A high-scoring candidate around 85–90+ should not automatically cause another paid regeneration simply because one hard requirement failed.

Better policy:

- clearly poor → automation may retry;
- strong near miss → human review;
- AI pass → ready for human approval;
- never auto-canon from score alone.

A candidate with one explicit remaining issue should surface:

> Approve anyway  
> Request correction  
> Generate another batch

## 9.3 "Review needed" can contradict all visible PASS rows

A frame candidate displayed:

> **REVIEW NEEDED**

while every visible rubric category showed PASS.

This is a review-summary semantics bug.

Top-level states need clearer meanings:

- **PASS — ready for human approval**
- **ISSUE — one or more checks failed**
- **UNCERTAIN — specific checks need judgment**
- **HUMAN DECISION REQUIRED — AI found no issue, but canon still requires you**

If review is needed, the reason must be visible immediately.

## 9.4 Human Review Gate candidates can be uninspectable

A Human Review Gate showed several candidate thumbnails and scores, but the thumbnails were not clickable and the primary action was approval.

No approval surface should ask for a human decision while hiding the evidence behind that decision.

Required flow:

> click candidate → inspect → see AI review → compare → approve/reject/correct.


# 10. Coverage-Sheet Workflow Findings

## 10.1 Quality is hidden in paid coverage generation

Coverage automation exposed Resolution but not Quality, even though quality materially affects the request.

A paid generation preflight should show the actual resolved:

- model;
- provider;
- quality;
- resolution;
- candidate count;
- number of requests;
- cost estimate if known.

If quality is intentionally fixed:

> `High — recommended for crop extraction`

is much better than silently choosing it.

## 10.2 Generated-sheet completion banner is not actionable

The UI said:

> **SHEET READY FOR REVIEW**

but the status itself did not navigate to the sheet.

A completed async workflow needs an actionable handoff:

> **Sheet ready for review**  
> `Review sheet`

The completion state should take the creator directly to the result.

## 10.3 It is hard to know which generated panel corresponds to which view

The generated coverage sheet may have been usable, but the creator could not confidently determine:

- which panel represented Master establishing;
- Reverse angle;
- Entrance/exit;
- etc.

CineBraid should not make the filmmaker reverse-engineer the intended mapping.

### Better workflow

1. detect/know the panel grid;
2. number panels visibly;
3. show suggested mapping:
   - Panel 1 → Master establishing
   - Panel 2 → Reverse angle
   - etc.
4. allow reassignment;
5. automatically extract cell thumbnails;
6. keep fine crop controls as advanced/recovery.

## 10.4 "Panel position" dropdown is the wrong interaction

Because the sheet is already visible, the natural interaction is:

> **Click the panel you want**

not:

> choose Panel 2 from a dropdown.

"Sheet layout" is also implementation detail that should be hidden unless auto-detection fails.

## 10.5 Incomplete coverage gets an excessively alarming status

Exiting before completing all views produced a strong red:

> **NEEDS ATTENTION**

style even though nothing had failed.

Normal unfinished work should use a neutral status:

> **Coverage paused**  
> 5 views remain  
> `Resume`

Danger styling should be reserved for actual errors, missing authorities, unresolved paid jobs, etc.

---

# 11. Coverage Requirements Should Become Usage-Aware

Location coverage exposed a deeper product question.

Generic slots such as:

- Master establishing
- Reverse angle
- Left-facing
- Right-facing
- Key action zone
- Entrance / exit
- Detail zone
- Overhead / layout

are not equally necessary for every production.

CineBraid should eventually derive recommendations from actual planned shot usage.

### Better hierarchy

**Required**
- explicit creator decision;
- or deterministic production requirement.

**Recommended**
- CineBraid sees likely need from the shot plan.

**Not currently needed**
- no planned shot suggests this view.

Example:

> Master establishing — Required  
> Used by shots 01, 04, 07

> Reverse angle — Recommended  
> Shot 08 looks back toward the chimney cluster

> Entrance / exit — Not currently needed  
> No planned shot uses an arrival/departure angle

The creator remains authoritative.

Do not let an LLM silently decide "required."

---

# 12. Stage Completion Should Feel Like Completion

When Inputs were complete, the visual change was too subtle.

A small green status did not communicate:

> "You have completed an important production stage."

CineBraid should use stronger positive handoff states without making them permanent or locked.

Example:

> **Inputs ready ✓**  
> 4 required references available  
> **Continue to Shot Planning**

Completed stages can collapse to summaries while remaining editable.

This is important because the product should feel like it is **guiding a production forward**, not merely exposing panels.

---

# 13. Inputs-Complete Should Surface Creation Immediately

Once all required inputs exist, CineBraid should visibly cash in that work.

Instead of generic:

> Add shot image

show:

> **Ready to create this shot**  
> 4 approved references are available.

Possible actions:

- **Generate from approved references**
- Plan composition first
- Upload existing frame
- Automate candidates

Blocking should be clearly optional when it is optional.

---

# 14. Blocking / Shot Planning Findings

## 14.1 Blocking is not explained well enough

The blocking page exposes controls before clearly explaining:

- what blocking is;
- what blocking will do for this shot;
- why the creator should use it;
- what happens if they skip it.

Before prompt construction, CineBraid should summarize the specific blocking goal.

Example:

> **Blocking plan**  
> Establish the Sweep against the rooftop skyline.  
> This guide controls camera, placement, scale, pose, depth and negative space.  
> It does not define final rendering, wardrobe detail or finished lighting.

The page should also list the actual authorities being used.

## 14.2 "Build prompt" is too implementation-centric

For blocking, something like:

> **Prepare blocking guide**

or:

> **Preview blocking plan**

is more creator-facing than "Build prompt."

The prompt can remain inspectable beneath that.

## 14.3 Review All with AI did not recognize existing blocking attempts

Three blocking attempts were visibly present, but clicking:

> **Review all with AI**

reported:

> Add at least one blocking attempt first.

This is a real reader/state mismatch.

Likely representations were diverging:

1. automation knew the attempts/review;
2. cards knew the files but not the review;
3. batch review did not recognize the attempts.

This belongs in the production-state/review consistency batch.

---

# 15. Static Blocking Is Not Enough for Modern Video Workflows

The dogfood increasingly showed that one static blocking image is not the only planning grammar CineBraid needs.

For still-first production:

> **Composition blocking**  
> camera · placement · scale · pose · depth

For motion/reference-to-video production:

> **Motion blocking / beat board**  
> starting situation · subject movement · camera movement · timing beats · ending condition

Possible Shot Planning choices:

- Composition guide
- Motion beat board
- Start/end-frame plan
- Direct reference-driven motion
- Skip planning

This suggests that **Look & Blocking** may eventually be better framed as **Shot Planning**, with blocking as one method.

---

# 16. Frames Stage Handoff Is Too Weak

After completing Inputs and Blocking, entering Frames did not clearly show:

- approved blocking guide;
- approved location authority;
- approved character authority;
- selected character view/state;
- ways to create Frame A;
- whether blocking was required or optional.

The next stage should visibly inherit prior work.

## Proposed "Build Frame A from" area

> **Composition guide:** Blocking 1 ✓  
> **Location authority:** London Rooftops — Moonlit night ✓  
> **Character authority:** Chimbley Sweep — Rooftop working ✓  
> **Character view:** selected rear/coverage view ✓

Then:

### How do you want to create this frame?
- **Generate using blocking + approved references**
- Generate from approved references only
- Use/edit the blocking image
- Upload an existing frame

Blocking is composition guidance.

Approved references are identity/design authority.

The UI should say that.

---

# 17. Paid Retry / Additional Pass Findings

This became one of the strongest trust-and-cost themes of the pass.

## 17.1 Additional paid passes can happen with too little visibility

When all candidates fail and automation begins another generation pass, the creator may not notice unless watching the local area.

There should be a minor global notification:

> **Starting pass 2 of 3**  
> Previous candidates failed review.  
> 3 more paid generations will be submitted.  
> `View details` · `Stop after this pass`

Notification frequency should be configurable.

## 17.2 User needs explicit retry policy

Suggested run/project preference:

### When a paid retry is needed
- Continue automatically
- Ask me before generating more
- Stop and wait for manual decision

This can exist at:

- per-run level;
- project default;
- global preference.

## 17.3 Approval should not silently authorize new spending

Approving Frame A immediately resumed downstream automation and began generating Frame B candidates.

Even if this was technically the authorized run continuing, the creator's mental model is:

> Approve Frame A

not necessarily:

> Approve Frame A and spend money on Frame B immediately.

Better approval actions:

> **Approve & continue automation**

versus:

> **Approve & pause**

If "always ask before new paid generation" is enabled, approving the current artifact should not automatically authorize the next spend.

---

# 18. Paid Retry Explainability

When CineBraid rejects an entire batch and wants to spend again, it should explain:

## Why the previous batch failed
Example:

- Sweep too small/readability failure
- modern landmark contamination
- camera framing inconsistent with target

## What CineBraid changed
Prefer a real prompt diff:

```diff
- tiny black Sweep shape barely distinguishable on a roof
+ adult Sweep clearly readable as the only moving figure,
+ occupying approximately 8–12% of frame height

+ exclude modern London landmarks
```

## Why another pass is expected to help
Do **not** invent fake percentages.

Use explainable qualitative outlook:

- **High** — failures are directly addressed by material prompt changes.
- **Medium** — some failure causes were addressed, some remain model-dependent.
- **Low** — previous prompt already clearly asked for the failed behavior; another pass may simply reroll randomness.

If no meaningful prompt improvement can be identified:

> **No meaningful prompt improvement found.**

The app should pause before spending again.

Core trust question:

> **Why are you spending my money again?**

CineBraid needs to answer it.

---

# 19. Activity, Terminal, and Assistant Findings

The dogfood strongly converged on a two-layer activity model.

## 19.1 Current embedded activity cards make pages grow

Automation feeds appear inside whichever long workspace started the job.

This leads to:

- pages expanding vertically;
- users chasing activity down the page;
- multiple slightly different activity surfaces;
- live work competing with creative controls.

## 19.2 Recommended architecture: docked bottom Activity Terminal

The full technical stream should live in a persistent bottom dock.

Characteristics:

- fixed height;
- internal scroll;
- newest events visible;
- page does not move;
- resize or select visible lines;
- can collapse to a one-line status bar.

Possible display settings:

- Hidden
- 3 lines
- 8 lines
- 16 lines
- Expanded
- or draggable height remembered per user.

Example:

```text
14:57:12  ✓ Prompt prepared · London Rooftops coverage
14:57:13  → GPT Image 2 · sheet · 4K · high · 1 image
14:57:13  → Paid request submitted · FAL
14:57:48  ✓ Image returned
14:57:49  → Extracting coverage views
14:57:52  ● Reviewing Master establishing
```

This should be boring, authoritative, complete, and auditable.

## 19.3 Assistant narration should be optional interpretation, not a second source of truth

The Assistant can translate the activity log into creator language.

Suggested modes:

- **Off** — terminal/status only
- **Quiet** — only needs-your-action events
- **Normal** — major starts/completions, paid retries, problems, human gates
- **Verbose** — narrates meaningful steps and reasoning

Examples:

> I’m generating three Frame B options.

> None passed because the Sweep remained too small. I changed the prompt to enlarge him and reduce skyline clutter.

> I’m having trouble with this shot. Two passes failed for the same reason; another generation may be low-value.

The Assistant should summarize the authoritative activity state, never invent separate status.

## 19.4 Right-rail Assistant presence is promising

A persistent right rail could show:

> **Working**  
> Generating Frame B · pass 2

or:

> **Need your input**  
> 3 candidates ready for review

or:

> **All quiet**  
> 0 actions needed

A richer conversational co-pilot can remain later scope.

---

# 20. False "Running" States and Reconciliation

This was a repeated problem.

## 20.1 Human-review gates looked like active AI work

A run had already reached:

> HUMAN REVIEW REQUIRED

but the interface still showed:

- Reviewing candidate...
- Pending
- spinners;
- elapsed time;
- active styling.

The creator waited several minutes assuming work was still happening.

### Correct state

> **WAITING FOR YOU**  
> AI work complete.  
> 3 candidates ready for review.  
> `Review candidates`

## 20.2 Global Activity showed operations active that were not active

The global drawer showed:

> 3 operations active

even though they were actually waiting/paused/completed.

This damages the authority of the activity system.

### Needed status model

- **Running**
- **Waiting on provider**
- **Waiting for AI result**
- **Waiting for human**
- **Retry planned**
- **Retry started**
- **Needs attention**
- **Unresolved**
- **Completed**
- **Cancelled**

The Global Activity header should count what is **actually happening now**, not what once started.

## 20.3 Reconciliation should be state-based, not timeout-based

Do not kill runs merely because they are old.

Instead reconcile against:

- provider request lifecycle;
- browser orchestration state;
- run step state;
- human gate state;
- unresolved lifecycle;
- completion/error/cancel state.

Possible action:

> **Recheck status**

and automatic reconciliation:

- on app load;
- when drawer opens;
- after a step transition;
- periodically while anything is marked active.

---

# 21. Accordion Interaction Bug

Opening the:

> Pair continuity review

accordion appeared to automatically start the review.

This is wrong interaction semantics.

## Product rule

> **Navigation, disclosure, inspection, and approval must never implicitly trigger generation or AI work.**

Expanding should show:

- not reviewed;
- previous result;
- running status;
- explanation.

Explicit button:

> **Run pair continuity review**

If the operation may cost money or use external APIs, explicit execution is even more important.

The `(v6.6)` user-facing label should also be removed.

---

# 22. Motion Stage Findings

The Motion & Sound stage was one of the clearest examples of implementation-first UI.

Upon entering Motion, the page exposed:

- approved frames;
- returned-video intake;
- assisted motion;
- motion/sound brief;
- motion units;
- package slots;
- direct motion;
- structured controls;
- legacy/supplemental direction;
- prompt/build controls.

Before clearly answering:

> "What should I do?"

## 22.1 Motion should begin with the recommended route

For the dogfood shot, the screen already knew:

- Frame A approved;
- Frame B approved;
- pair continuity passed;
- two-frame route available.

It should have said:

> **Ready to animate Frame A → Frame B**  
> Recommended route: First / Last Frame  
> `Plan motion & generate`

with alternatives:

- Upload finished video
- Animate from Frame A only
- Generate from references
- Change route

## 22.2 Returned-video review should not dominate before a video exists

The creator mental flow is:

> What am I making?  
> → how should it move?  
> → which model/settings?  
> → generate  
> → review returned video

The UI should follow that order.

## 22.3 Technical mode names should be secondary

Instead of:

> Proceed with I2V / FLF

use filmmaker language:

- Animate from Frame A
- Animate from Frame A to Frame B
- Generate from approved references
- Generate directly from description

Technical mode can appear secondarily:

> MiniMax H3 · First/Last Frame

---

# 23. Primary Stage Actions Should Always Have a Stable Location

CineBraid currently hides actions until prerequisites are met.

Example:

- Generate Video only becomes reachable after building a prompt.

The prerequisite is good.

The hiding is not.

## New rule

> **Primary stage actions are always visible. Their readiness changes; their location does not.**

A persistent action strip just below the stage tabs could show:

### Blocking
- Build blocking plan
- Generate blocking
- Upload blocking

### Frames
- Build frame prompt
- Generate frames
- Upload frame
- Review candidates

### Motion
- Build/update motion prompt
- Generate video
- Upload video
- Review results

### Deliver
- Approve final
- Repair/upscale
- Export

Disabled actions should explain why:

> **Generate video** — disabled  
> Build the motion prompt first.

This makes prerequisites discoverable without forcing the user to hunt.

---

# 24. First / Last Frame Is Poorly Explained

The FLF package currently presents implementation language:

- Motion unit A package
- Image 1
- first-frame
- Image 2
- last-frame

The creator should instead see:

> **Frame A — START**  
> → **7.95 seconds of motion** →  
> **Frame B — END**

with the images visibly compared.

Then:

> **What happens between these frames?**

The UI should clearly distinguish:

- Start composition — locked
- End composition — locked
- Duration — editable/model-normalized
- Subject motion — editable
- Camera motion — editable
- Sound/dialogue — optional
- Preserve constraints — visible

"Legacy / supplemental motion direction" should not contain the most important creative direction.

---

# 25. Editorial Duration vs Generation Duration

The shot carried a duration such as:

> `7.95 seconds`

likely from imported JSON/timeline logic.

That can be a valid editorial target but is awkward as a provider generation value.

CineBraid should distinguish:

## Editorial duration
Exact project/timeline duration.

> `7.95s`

## Generation duration
Provider-compatible requested clip length.

> `8s`

Recommended display:

> **Timeline target:** 7.95s  
> **Generate:** 8s  
> Returned clip can be trimmed to the timeline target.

Later, handles can become explicit:

> Add handles

The Project Builder/prompting kit should preserve precise editorial timing while avoiding arbitrary sub-second generation durations where the target model only supports integer/discrete durations.

The runtime should remain model-aware rather than encoding a universal duration assumption.

---

# 26. Prompt Notes Need Better Hierarchy

Important warnings were hidden under a collapsed:

> `2 prompt notes`

Examples included:

- prompt nearly at the model character limit;
- confusing character-reference grounding guidance that sounded like a recommendation to use another video route.

## New rule

> **Warnings that can change whether a paid generation will work or faithfully represent the shot belong next to the paid action.**

Example:

> ⚠ Prompt almost at model limit — 1,991 / 2,000  
> `Shorten prompt`

Reference-grounding warnings must also be mode-aware.

For FLF, CineBraid should not casually suggest adding references if:

- the mode cannot use them;
- the warning is irrelevant;
- or identity is already being carried by the endpoint images.


# 27. Provider / Model UX Direction

The current paid-generation modal exposes a long list of model/provider combinations, many of which cannot currently run.

The dogfood suggested a much cleaner provider architecture.

## 27.1 Hide non-viable options by default, but do not hide truth

Default view:

> **Ready now**

Show only routes that actually work for this task.

Collapsed:

> **Other models & providers**

Power users can inspect everything.

## 27.2 Availability vocabulary must be precise

Do not collapse everything into:

> Not available yet

Use distinct states:

- **Ready**
- **Connect**
- **Setup required**
- **Doesn't fit this shot**
- **CineBraid integration not implemented**
- **Provider/model unavailable**

A Connect button is only appropriate when connection is actually the missing step.

## 27.3 Provider logos/icons would improve scanning

Model remains primary.

Provider identity becomes a clear secondary line:

> MiniMax H3  
> [FAL logo] FAL · Connected  
> Estimated cost: $X

## 27.4 Provider-specific Settings should replace generic Accounts

Recommended Settings structure:

> **Providers**

Individual pages:

- FAL
- Runware
- Civitai
- ComfyCloud
- Local ComfyUI
- other future providers

Each can be tailored to:

- connection/auth;
- registration/API key instructions;
- test connection;
- supported CineBraid workloads;
- available model families;
- endpoint/region;
- pricing-estimate source;
- referral/partner link disclosure;
- privacy/data-routing information;
- disconnect/reconfigure.

This fits provider-neutral open-source positioning much better than a generic account panel.

## 27.5 Model and provider route should be conceptually separate

Instead of a flat list:

- H3 on FAL
- H3 on Runware
- Seedance on FAL
- Seedance on Runware

prefer:

> **MiniMax H3 — First/Last Frame**
> - FAL ✓
> - Runware — Connect

This scales better as providers multiply.

---

# 28. Paid Generation Modal Is Overloaded

The popup currently tries to be:

- model/provider picker;
- compatibility report;
- provider options;
- full prompt editor;
- prompt warning view;
- technical request preview;
- paid confirmation.

That is too much.

## Default modal should answer

- What am I generating?
- Which model/provider?
- What inputs?
- What duration/resolution/quality?
- What will it cost?
- Any blockers/warnings?
- Submit or cancel?

Example:

> **Generate Frame A → B motion**  
> MiniMax H3 · FAL · First/Last Frame  
> 8s · 2K · native audio  
> 2 approved frames  
> Estimated cost: $X  
> **Start generation**

Collapsed secondary detail:

- View/edit full prompt
- Other models/providers
- Advanced provider details
- Technical request/package

The prompt is important, but it should not dominate the default confirmation experience.

---

# 29. Major Product-Direction Finding: R2V Should Become First-Class and Often Preferred

The dogfood strongly challenged the current still-first routing philosophy.

The current implicit logic is too close to:

> if two approved frames exist → use FLF

That is not necessarily the best creative decision.

## Better routing philosophy

### Reference-to-video — preferred for many reference-rich shots
Use when:

- approved identity/location/state references are strong;
- motion/performance is the main creative problem;
- exact opening composition is not sacred;
- exact ending composition is not sacred.

### I2V
Use when:

- exact opening composition matters;
- endpoint can emerge naturally.

### FLF
Use when:

- both endpoints are genuine directorial constraints;
- transformation/reveal/match transition requires exact start/end;
- the motion is specifically about getting from A to B.

### T2V
Use when:

- visual authority is unnecessary;
- atmosphere/B-roll/abstract generation does not need reference matching.

The existence of two approved frames should not automatically make FLF "best."

---

# 30. Why R2V Better Fits the Chimbley Sweep Shot

The intended shot was fundamentally about **performance and timing**:

- wide rooftop view;
- Sweep initially absent/unreadable;
- smoke/painterly motion begins;
- Sweep becomes perceptible;
- measured camera push;
- Sweep becomes readable around a vocal entrance.

That is a temporal directing problem.

A reference-to-video route could instead use:

- approved Sweep identity/state;
- approved London Rooftops authority;
- style authority;
- shot description;
- performance direction;
- timing beats.

This avoids promoting an imperfect generated intermediate Frame A into the strongest authority.

The dogfood demonstrated the risk of the current path:

> Bad Frame A → approved → becomes endpoint authority → continuity preserves it → FLF animates it successfully.

---

# 31. R2V Requires a Strong Directing Layer

R2V should not mean:

> throw references at the model and hope.

If CineBraid makes R2V prominent, it must become **direction-heavy**.

A strong R2V motion plan should capture:

## Starting situation
What is visible and where.

## Performance
Exact character/object actions.

## Camera
Push, pan, track, hold, handheld, timing.

## Dialogue/performance sync
Who speaks what, when, lip/body performance, emotional delivery.

## Environment
Smoke, wind, cloth, lights, background activity.

## Beat timing
Example:

- 0–2s establish
- 2–5s movement begins
- 5–8s camera closes / dialogue lands

## Ending condition
What must be true by the end, without requiring an exact still.

## Preserve
Identity, state, wardrobe, location design, style.

## Avoid
Shot-specific failures, not generic anti-animation boilerplate.

This should compile into model-specific prompts so the creator does not need to learn provider-specific prompt dialects.

---

# 32. Saved / Storage / Cloud Sync Status

The top-bar `Saved` indicator currently behaves more like decorative reassurance than an actionable status.

It should be interactive.

## Local save popover

> **Project storage**  
> ✓ Saved locally · just now  
> Folder: ...  
> Open project folder  
> Storage settings

Cloud sync should remain a separate guarantee.

Possible second status:

- Synced
- Syncing
- Offline
- Paused
- Sync problem

If cloud is not configured, the second row can simply remain hidden.

Important rule:

> **Local Saved must never depend on cloud sync status.**

---

# 33. Stray "v" Disclosure Controls

Hanging `v` characters/disclosure chevrons appeared in places without clear labels or context.

They read as UI debris.

Rule:

> Every disclosure affordance must be visibly attached to a labelled section. Otherwise remove it.

This is straightforward visual cleanup but should be part of the overhaul consistency pass.

---

# 34. Proposed Creator-Facing Information Architecture

The pass converged toward a surprisingly coherent layout model.

## Center workspace
The current creative task.

## Right rail — Assistant
- what CineBraid is doing;
- what needs the creator;
- recommended next action;
- short explanations.

## Bottom dock — Activity Terminal
- technical source of truth;
- all calls;
- retries;
- timings;
- costs;
- files;
- warnings;
- status changes.

## Generated Media / Results
- stable place for produced media;
- candidate history;
- approved outputs;
- AI review;
- provenance;
- correction lineage.

## Reports
- project-level summary;
- spend;
- run/history overview;
- readiness/health.

This separation is significantly cleaner than allowing each workflow page to become generation UI + history + review + activity + storage.

---

# 35. Generated Media / Results Should Remain Under Active Launch Consideration

Static audit work had suggested a project-wide media browser could wait.

The dogfood supplied direct evidence that some version may be needed earlier.

Observed problems included:

- state candidates accumulating inside long Coverage & States pages;
- results landing in inconsistent page locations;
- approved/rejected/historical media being mixed;
- candidate thumbnails behaving differently across views;
- difficult "show me all Heavy Soot results" questions;
- results being hidden after workflow transitions;
- correction/review provenance lacking a stable place.

This does not require a giant DAM.

A bounded Generated Media / Results surface could be:

- read-first;
- grouped by entity/state/shot;
- approved media pinned;
- candidates/history visible;
- universal Media Inspector entry;
- provenance and lineage where available.

---

# 36. Severity / Priority Summary

## MUST / Trust-Breaking
These should not survive broad launch:

- wrong model can run despite selected image model;
- rejected candidate can render green PASS;
- dialogue has conflicting writers / speech decision can be overridden;
- first-run provider terminology dead-end;
- implicit provider/AI execution from navigation/disclosure;
- release/secret scanning gaps identified by audit;
- any route where CineBraid spends while implying a different operation.

## High / Launch-Relevant
Strong candidates for pre-launch or core overhaul:

- approval state disappears in downstream selectors;
- approved media not visually distinguished;
- stale active/run states;
- human-review pause looks like active processing;
- paid retries not visibly announced;
- approval silently resumes downstream paid generation;
- Frames stage fails to inherit visible Inputs/Blocking context;
- Motion stage does not explain recommended path;
- FLF not visually explained;
- Review Needed contradicts all visible PASS rows;
- Human Review Gate thumbnails unclickable;
- Review All with AI cannot see existing blocking attempts;
- state creation hierarchy;
- state generation buried;
- blocking recommendation/approval state hidden;
- paid modal overloaded;
- prompt-limit warning hidden;
- blocking not explained;
- additional paid-pass reasoning not explained;
- frame intent can fail while generic review/continuity passes.

## UX-Overhaul Core
- persistent stage action strip;
- strong completion handoffs;
- universal Media Inspector;
- Generated Media / Results;
- bottom Activity Terminal;
- optional Assistant narration;
- selectable reference automation;
- usage-aware coverage recommendations;
- motion beat-board / R2V shot-planning path;
- provider-specific Settings;
- responsive reference layout;
- direct manipulation for coverage sheet panels.

## Later / Carefully Scoped
- sophisticated AI-driven coverage inference;
- deep conversational production assistant;
- automatic model recommendation by style;
- advanced cloud conflict management;
- full team audit identity;
- cross-shot deterministic continuity engine.

---

# 37. Cross-Cutting Product Principles Derived From the Pass

## 37.1 Production truth must survive every view
If an image is approved, every selector/browser/review surface must know it is approved.

## 37.2 AI recommendation and human approval are different facts
Never collapse them.

## 37.3 Completion should create a visible handoff
The next stage should inherit the work visibly.

## 37.4 Primary actions should be predictable
Actions stay in stable locations; disabled state explains prerequisites.

## 37.5 Inspection must not execute
Opening, expanding, viewing, or navigating must not silently start provider work.

## 37.6 Spending needs explicit intent
Approval is not automatically authorization for a new paid operation unless the creator explicitly chose that policy.

## 37.7 Automation must explain retries
What failed? What changed? Why should another pass help?

## 37.8 Technical truth and creator explanation should be separate layers
Terminal = authoritative detail.  
Assistant = interpretation.

## 37.9 Reference authorities should stay first-class
Generated intermediates should not automatically outrank canonical references.

## 37.10 Video route should follow creative intent
Not merely the number of frames that happen to exist.

---

# 38. What Should Not Be Built Because of This Pass

Do not turn these findings into unnecessary subsystems.

Avoid:

- B-roll record type;
- broad shot-purpose taxonomy;
- subject species/kind taxonomy;
- montage planner;
- transition subsystem;
- giant agent console;
- new DAW;
- NLE integration before core workflow is stable;
- style taxonomy;
- uncalibrated AI confidence percentages;
- fabricated provider price table;
- giant revision browser;
- replacement continuity schema;
- new ingest architecture;
- autonomous AI canon approval.

Most problems can be fixed by making existing semantics visible, coherent, and creator-oriented.

---

# 39. Recommended Next Engineering Sequence

## Step 1 — Freeze this dogfood pass
Do not keep poking the same build indefinitely.

Preserve the Chimbley Sweep project as evidence/regression material.

## Step 2 — Reconcile all evidence into one master backlog
Inputs:

- Dogfood Pass #1
- Creator Reality audit
- Creator Scenario Matrix
- Creator Workflow Gaps
- Hidden Product Assumptions
- Launch/Later/No Action
- P4 C2 reconnaissance
- B-roll inquiry
- Night Lab v2
- current launch/status assessment

The purpose is **not another discovery audit**.

The purpose is:

> one backlog, one sequencing decision, no duplicated work.

## Step 3 — Finish P4 C2 → C3 → C4
Do not let UX findings derail the semantic/media-identity foundation halfway through.

## Step 4 — Generation truth / routing batch
After C4:

- address v607 shadowing;
- make H3 keyframe sequencing real or hide it;
- fix image-model silent substitution;
- enable T2V coherently;
- make R2V first-class;
- make motion gates mode-aware;
- stop selecting FLF merely because two frames exist;
- separate editorial vs generation duration;
- preserve provider/model choice truth.

## Step 5 — Production-state honesty batch
Fix:

- rejected/alternate/approved semantics;
- stale approval pointers;
- missing approved media;
- human-vs-AI state;
- run-state reconciliation;
- false Active counts;
- approval-to-paid-resume policy;
- retry authorization.

## Step 6 — Shot workspace UX overhaul
Apply the stage grammar from this report.

## Step 7 — Dogfood Pass #2
Use a different shot and deliberately prefer:

> **reference-to-video / direction-heavy workflow**

rather than FLF unless exact endpoints are genuinely required.

Measure whether the experience is materially simpler.

---

# 40. Acceptance Criteria for the Shot Workspace Overhaul

A shot-stage redesign should not be considered complete unless the following are true.

## Inputs
- creator understands what inputs are required;
- approved references are visually distinct;
- completion is obvious;
- generation/next-stage options appear immediately.

## Shot Planning
- blocking is explained;
- static composition and motion-planning paths are distinct;
- optional planning is visibly optional;
- approved guide is always identifiable.

## Frames
- previous authorities and blocking are shown visually;
- creation paths are explicit;
- candidate media is inspectable;
- AI review state is understandable;
- wrong story/frame intent cannot hide behind generic quality PASS.

## Motion
- recommended generation route is explained in filmmaker language;
- R2V/I2V/FLF/T2V are chosen by creative need;
- START → MOTION → END is visually clear for FLF;
- R2V gets a strong directing/performance plan;
- prompt warnings are visible beside the paid action;
- Generate remains visible even when disabled.

## Automation
- every paid pass is visible;
- retry plan is explainable;
- automatic-vs-ask policy is configurable;
- approval does not ambiguously authorize future spend;
- human gates are visibly idle/waiting, not running.

## Activity
- global active count reflects reality;
- false-running states reconcile;
- bottom terminal records technical truth;
- Assistant can narrate optionally.

## Results
- every thumbnail opens the same inspector model;
- approval/rejection/recommendation persists across views;
- Generated Media/Results provides a stable home.

## Deliver
- final state is obvious;
- decisions are reversible where appropriate;
- next production action is clear.

---

# 41. Launch Implications

Dogfood Pass #1 does **not** argue against launching CineBraid.

It argues against launching the current UI unchanged.

The strongest positive signal is that the complete workflow produced a good video.

The strongest negative signal is that CineBraid can presently guide the creator into approving the wrong intermediate and then faithfully propagate that mistake.

This is a solvable problem.

The launch work is now less about proving CineBraid can generate media and more about proving that CineBraid:

- explains its production model;
- preserves creator decisions;
- never lies about state;
- never quietly changes the operation;
- never spends without understandable authorization;
- does not bury results;
- carries work forward coherently;
- makes modern video routes first-class.

The current open-source launch remains viable.

A reasonable private-alpha threshold is:

> **One filmmaker can take a small production from project plan to references to finished shots without CineBraid lying, trapping them, losing their decisions, or making paid actions ambiguous.**

A reasonable public-open-source threshold is:

> **The same workflow is understandable without the founder sitting beside the user explaining what each stage means.**

---

# 42. Final Assessment

## What this pass proved

**CineBraid works.**

The shot was produced.

The video was good.

The semantic and generation machinery were capable of carrying the production through.

## What this pass also proved

**CineBraid does not yet explain itself well enough.**

The creator repeatedly had to ask:

- where is my approved image?
- what is blocking?
- what do I do next?
- is this still running?
- why is it spending again?
- which candidate did AI recommend?
- which one did I approve?
- why does Review Needed say everything passed?
- why did opening this panel start AI work?
- why am I using FLF?
- where is Generate?
- what exactly is Frame A controlling?
- why is the retry better?
- why is the approved authority missing from this list?

Those questions are not random UI complaints. They all point to the same product challenge:

> **CineBraid's internal production model is more coherent than its creator-facing workflow.**

That is the opportunity for the next phase.

The recommended path is therefore:

> **Finish P4 semantic foundations → repair truth-breaking generation/state seams → redesign the shot workflow around explicit creator decisions → dogfood again using a reference-first R2V workflow → launch hardening.**

---

# 43. One-Sentence Handoff

**Dogfood Pass #1 successfully produced a good Chimbley Sweep video, proving the production loop works, but exposed a broad creator-workflow problem: CineBraid must become much better at explaining each stage, preserving visible approval/review state, reconciling automation status, authorizing paid retries, and choosing modern reference-to-video routes based on creative intent rather than still-first mechanics.**

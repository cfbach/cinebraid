# Blocking-frame evaluation

The fixture set and scoring scheme that would let CineBraid fill the `blocking-frame`
recommendation slots with evidence instead of an opinion.

**Designed, not run.** No paid benchmark has been executed and none may be under this
phase — no test budget covers one. The guide in `data/model-definitions.json` therefore
carries `decision.state: "undecided-pending-evaluation"` with a shortlist per slot, and
`integrityProblems()` refuses to let a slot be filled while that state stands.

## What a blocking frame is for

Not a lesser hero still. A blocking frame exists to establish, quickly and cheaply:

composition · camera and framing · subject placement · blocking and staging · rough
character identity · current wardrobe and continuity state · location · important props ·
lighting and tone where useful

and then to be **iterated on**, **re-blocked**, and handed to a video model as a starting
frame.

> A beautiful frame that staged the two characters on the wrong sides has failed at this
> job. A plain one that got them right has not.

This is why the evaluation scores staging accuracy and identity adherence heavily and
does not score aesthetic quality at all. A model that wins on beauty and loses on
left/right placement is the wrong model for this category, and a benchmark that cannot
say so is worse than none.

## The fixtures

Ten shots, all buildable from CineBraid's own sample project so the entities, locations
and props are real approved records rather than prompt strings. Each names the CineBraid
concepts it exercises, so a failure points at something fixable.

| # | Fixture | What it isolates | Exercises |
|---|---|---|---|
| A | One character + location | The baseline. If this fails nothing else matters. | `identity`, `location` roles |
| B | Two characters + location | Does the model keep two identities apart, or blend them? | multiple `identity` refs; typed vs untyped reference budgets |
| C | Two characters + prop + location | Four approved references competing for attention. | `identity` ×2, `prop`, `location`; reference ceilings of 3 bite here |
| D | Specific left/right staging | "Kai enters camera-left and crosses to centre; Rae holds frame-right." | `stagingLines`; the single most common blocking failure |
| E | Wide / medium / close framing | The same shot at three framings. | `camera.framing`; scale consistency across a set |
| F | Low-angle / high-angle | Camera height as a directed value. | `camera.framing`; ControlNet substitution for local models |
| G | Re-block an existing frame, preserving identity | Change staging, keep the face. | `edit` / `inpaint` mode; `base` role; mask support |
| H | Continuity state change | Same character, torn cuff now bloodied. | `continuity-state` role; `continuity.drift` restatements |
| I | The same shot iterated five times | Does a re-run drift? | seed support, or its absence; iteration stability |
| J | Local LoRA character + location prompt | Identity from trained weights, not a reference. | the only path open to Z-Image Turbo and Krea 2 Turbo |

Fixtures A–I run on every candidate that can accept references. **J runs only on the
local candidates**, because it is the only way either of them can carry a production
identity at all — both open checkpoints are text-to-image with no reference input. Scoring
J against a hosted model would be comparing two different techniques and calling it a
model comparison.

G and H must **not** be run against a model that cannot edit. Recording "failed to
re-block" for a text-to-image checkpoint is a category error, not a result; the guide's
`canEditExistingFrame` column already answers it, and a scoring run should record
`not-applicable` and move on.

## The scoring record

Nine dimensions per fixture per model per surface. Kept separate rather than summed,
because a single score would hide exactly the trade-off the category exists to expose.

| Dimension | Scale | Notes |
|---|---|---|
| composition accuracy | 0–3 | Did the frame put things where the staging said? |
| identity adherence | 0–3 | Per character. B and C record one score each. |
| location adherence | 0–3 | Geometry, materials and lighting logic, not vibe. |
| prop adherence | 0–3 | Design, scale and placement. |
| instruction adherence | 0–3 | Everything else the brief asked for. |
| iteration stability | 0–3 | Fixture I only: how far five passes drift. |
| latency | seconds | Wall clock, recorded not scored. |
| cost | currency | Actual charged cost, recorded not scored. |
| suitability as a video starting frame | 0–3 | Would a motion pass accept this as frame one? |

Latency and cost are **recorded and never folded into a score**. A model that is twice as
good and four times slower is a decision for a filmmaker with a deadline, not for a
weighted average.

The last dimension is the one most benchmarks would omit and the one CineBraid most
needs: a blocking frame's real downstream job is to be `endpoints.firstFrame` on an
`i2v` or `flf` plan. A frame that is unusable there has failed regardless of how it
scores on the rest.

### Recording

One row per `(fixture, modelId, surfaceId, run)`. `surfaceId` is not optional — the same
model scored on two providers is two rows, because a provider's resolution ceiling or
reference limit is part of what produced the frame. Free-text `notes` alongside, since
the useful finding is usually "it swapped the two characters" rather than a number.

## Rules that keep the result honest

1. **Same brief, every model.** Compiled from the same shot through each model's own
   pack or profile. A hand-tuned prompt per model measures prompt engineering, not models.
2. **Approved references only.** Real entity records from the sample project. A reference
   pulled from somewhere else is not what production would send.
3. **Local and hosted are never merged.** Krea 2 Turbo scored locally and Krea 2 Large
   scored hosted are two entries, and neither inherits the other's result.
4. **No aesthetic score.** Deliberately absent. If a frame is unusable, that belongs in
   `notes` and in the suitability-as-a-starting-frame dimension.
5. **Blind scoring where practical**, or at minimum model identity hidden from the scorer
   until the sheet is complete.
6. **Every run records its cost**, whether or not anyone is watching the total.

## Cheapest way to start

The two local candidates cost nothing per frame. Once a WorkflowRecipe exists for
`z-image/turbo` or `krea-2/turbo`, fixtures A–F and I–J can be run repeatedly at zero
marginal cost, which is enough to answer the highest-value open question in the guide —
whether a ControlNet pose or depth input substitutes usefully for reference-carried
identity on a model that has no reference input at all.

The hosted comparison needs a budget and an explicit approval. It should be scoped to
fixtures B, C, D and G on the two or three cheapest hosted candidates, since those are
the four that separate the field and the rest can wait.

## Feeding the result back

A completed run fills `decision.recommended`, `decision.localOption` and
`decision.premiumAlternative` in the `blocking-frame` guide, moves `decision.state` to
`decided`, and records the evidence. Until it does, a screen must render the shortlist and
say the answer is pending — which is a better thing to show a filmmaker than a confident
guess.

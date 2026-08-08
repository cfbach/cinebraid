# Generation compilation and model packs

How CineBraid turns a directed shot into a request a specific model can answer, and how
to add a model without rewriting generation.

## The flow

```
PROJECT BIBLE + SHOT + APPROVED REFERENCES + DIRECTOR INTENT
    ->  prompt-engine spec          provider-neutral, already existed
    ->  planReferences()            semantic reference manifest
    ->  pack.compileMode()          model-specific wording and parameters
    ->  GenerationPlan              generation-contracts.js
    ->  GenerationJob               unchanged
```

`generation-compiler.js` owns everything that is true of every model.
`model-packs/<family>.js` owns everything that is true of one.

A **GenerationPlan is a compiled GenerationJob**, not a second intermediate
representation. It reuses the job's own blocks — `target`, `mode`, `outputType`, `model`,
`inputs`, `output`, `settings` — and adds only what compilation produces: `compiler`,
`endpoints`, `coverage`, `warnings`, `provenance`. A job is minted from a plan by adding
a `jobId`; nothing is translated, which is why nothing can be lost in the translation.

## Production intent versus model-specific syntax

**Production intent** is what the filmmaker decided: the action, who moves, the camera,
the performance, the timing, the dialogue, what must not change. It lives in the
prompt-engine spec and is the same whichever model runs.

**Model-specific syntax** is how one model wants to be told: `<Picture 1>` versus
`Image 1`, a three-part camera phrase versus a label, whether an aspect ratio is a
parameter or a sentence. It lives only in a pack.

The line is enforced, not merely described. `generation-contracts.js` refuses provider
transport and graph structure inside intent, so a pack that needs to record which model
input a reference fills puts it in `settings.extensions[modelId]` — namespaced by model
and deliberately opaque to core.

## Where objective capabilities live

In the pack, in one object, with every value traceable to
`docs/architecture/model-evidence/<family>.json`. Capabilities answer only "what is
possible" and never "what to write".

A pack contributes a **ModelCapability layer** to the existing four-layer resolver in
`public/shared-generation-capability.js`:

```
ModelCapability  ∩  BackendCapability  ∩  NodeCapability  ∩  RecipeCapability
```

The compiler consumes the resolved result. It does not compute capability itself, and a
pack must never widen one: if the intersection says a mode, a role, a resolution or a
seed is unavailable, that is the answer.

Three boundaries are easy to collapse and must not be:

| Boundary | Wrong | Right |
|---|---|---|
| model vs provider | "H3's prompt limit is 2,000" | H3 accepts 7,000; fal's queue schema accepts 2,000, declared by the backend layer |
| local vs hosted | "H3 does 2K" | open-weight H3-Base does 768p; 2K comes from a module that is not open-sourced |
| checkpoint vs family | "H3 takes video references" | Ref2VA does; FL2VA does not — which is why variant is part of identity |

## Where prompting rules live

In the pack's playbook, versioned separately from the facts. Improving wording must not
look like a capability change, and a capability correction must not be buried in an
editorial commit.

The two halves are kept apart by test: capability vocabulary may not appear in the
playbook, and prompting vocabulary may not appear in the facts.

## How reference roles are expressed

`planReferences()` produces a deterministic manifest. Each entry carries a semantic
production role (`identity`, `location`, `prop`, `continuity-state`, `motion-reference`,
`voice`, `first-frame`, `last-frame`, …), the media type, a resolved source, a
filmmaker-facing label and purpose, whether it is required, and its canonical order.

Two rules matter more than the rest:

- **Order is canonical, not arrival order.** Endpoints first, then identity and place,
  then the modalities that shape motion and sound. Reordering a selection must not change
  the result.
- **Endpoints bind by role, never by position.** `endpoints.firstFrame` and
  `endpoints.lastFrame` name a reference whose role matches. An array shuffled by a UI is
  not allowed to decide which frame ends the shot, and the contract refuses a first/last
  plan with no bound ending frame.

The planner mints no asset identity and imports nothing from the MediaAsset ledger.
MediaAsset remains dormant.

## How intent coverage works

Every piece of filmmaking intent the shot actually carries ends in exactly one state:

| State | Meaning | Must record |
|---|---|---|
| `represented` | in the prompt, a parameter, or a control | `via`: `prompt` \| `parameter` \| `control` |
| `anchored` | an input already establishes it — a frame, an approved reference | `via`: which input |
| `omitted-by-design` | deliberately left out | `reason` |
| `unsupported` | this model and mode cannot express it | `reason`, plus a warning naming it |

The inventory of what counts as intent is `INTENT_FIELDS` in `generation-compiler.js` —
one table, no second list. A field absent from the shot is not intent and needs no
explanation.

Two checks make this evidence rather than paperwork, and both exist because a pack
cannot be the only witness to its own omissions:

1. **Unaccounted intent.** Anything inventoried that the pack did not claim becomes
   `unsupported` with an `intent-unaccounted` warning.
2. **Unverified claims.** Anything claimed as `represented via prompt` is checked against
   the finished prompt by distinctive-word survival. A claim the prompt does not support
   is downgraded to `unsupported` with a `coverage-unverified` warning.

So the only way to lose intent silently is to remove both checks, and
`tests/generation-compiler-negative-controls.js` proves that removing either is caught.

There is a third rule that costs nothing and prevents the subtlest version of the same
failure: **an anchor may only name an input that is actually in the package.** "Anchored
by the supplied final frame" when no final frame was selected reads as accounted for while
nothing holds it — worse than the silence it replaced. A pack declares what each anchor
depends on and the anchor does not apply without it, so the intent falls through to check
1 and surfaces.

## How unsupported capability warns

Never by dropping a value. A refusal produces a coverage entry AND a warning carrying a
code, the field, what happened and what to do about it. The contract enforces the pairing:
an `unsupported` entry with no warning naming it is an invalid plan.

Over-limit references are refused one at a time, each by name, after a fixed priority —
required roles before influences, then canonical order.

## How determinism is preserved

Given the same production state, mode, capability and pack version, the plan is
byte-identical.

- No clock. A plan carries no timestamp, and a test asserts the serialised plan contains
  no date.
- No randomness. A seed is an input, generated by a caller, never by the compiler.
- No network and no assistant. Structurally: the compiler and packs import nothing that
  can reach either, and a test asserts the absence.
- Explicit ordering everywhere — reference order, coverage order, section order.

A baseline plan is valid with Local AI off and the machine offline. An optional LLM
reviewer may later read the plan's structured intent, prompt, endpoint bindings, reference
manifest, playbook identity, coverage and warnings — but it is never required to make a
plan valid.

## How model evidence is recorded

`docs/architecture/model-evidence/<family>.json`, following `minimax-h3.json`:

- `sources` — primary vendor sources only, each with a URL, a type and a checked date. No
  blogs, no community write-ups, no third-party provider docs standing in for the model
  spec.
- `capabilities` — every claim the pack relies on, each citing a source id and saying
  whether it applies locally, through the API, or both.
- `notEstablished` — claims no official source supports, with what the pack does instead.
  An absent fact is recorded as absent; it is never assumed.
- `conflicts` — disagreements preserved rather than silently resolved, with how each layer
  keeps its own number.

A test asserts that the pack's encoded facts match the evidence record claim for claim, so
the two cannot drift.

## Adding a model pack

1. Research primary vendor sources and write `docs/architecture/model-evidence/<family>.json` first.
   If a fact is not there, the pack may not assert it.
2. Create `model-packs/<family>.js` with two clearly separated objects: `FACTS` and
   `PLAYBOOK`.
3. Export `capabilityLayer(mode, surface)` returning a ModelCapability descriptor.
4. Implement `compileMode(context)` returning `{ prompt | sections, references,
   parameters, output, model }`. Record coverage as you go: `ctx.coverage.represent(...)`,
   `.anchor(...)`, `.omit(...)`, `.unsupported(...)`.
5. `registerModelPack({ packId, packVersion, playbook, models, capabilityLayer,
   compileMode, evidence })`.
6. Write a semantic suite. Assert what survived, not what the prompt string looks like.
7. Add negative controls proving each new regression test detects its defect.

Nothing in `generation-compiler.js`, `generation-contracts.js` or
`shared-generation-capability.js` should need to change. If it does, the change belongs in
core because it is true of every model — and if it is true of only one, it belongs in the
pack.

## What is deliberately not here

- **No model recommender.** No ranking, scoring or "best model" selection. That needs
  current capability data, current packs and evaluation evidence for more than one family.
- **No H3-Context-IR integration.** MiniMax's hosted preprocessor turns a casual prompt
  into a well-formed H3-Base prompt. CineBraid does that job itself, deterministically,
  from production state. That is the point of this layer.
- **No execution wiring.** The compiler stops at a validated plan. The existing FAL path
  still builds its own request bodies from the prompt-engine profile registry; adapting it
  to consume a plan is a separate, bounded change.

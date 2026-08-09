# Model and provider intelligence

How CineBraid knows what models exist, what they actually do, who serves them, and which
of them to put in front of a filmmaker — and how to keep all of that current when the
field moves again next month.

`GENERATION_MODEL_PACKS.md` covers compilation: turning a directed shot into a request a
specific model can answer. This document covers everything that has to be true *before*
that: the catalogue.

## The one rule

> A **model fact** is a property of the weights. It follows the model everywhere.
> A **surface fact** is a property of one provider's offering of that model. It follows
> the provider, and is true of nothing else.

Every file, field and test below exists to keep those apart. The worked example:

| Layer | Says about a MiniMax H3 seed | Where it lives |
|---|---|---|
| the model | not documented by MiniMax | `data/model-definitions.json` → `capabilities.flags.seed: false` |
| fal | not in fal's schema | `fal-h3-backend.js` (the shipped adapter, still the authority) |
| Runware | offers one | `data/provider-surfaces.json` → the Runware offering's `flags.seed: true` |

All three are recorded. The divergence is *reported*. And the capability a request is
checked against still refuses a seed, because **a provider may narrow a model and may
never widen one** — flag intersection requires every declaring layer to agree.

## The four files

| File | Job | Never contains |
|---|---|---|
| `data/model-definitions.json` | what a MODEL is, and what CineBraid will say about it | provider routes, prompt rules |
| `data/provider-surfaces.json` | what a PROVIDER offers, on what terms | claims about weights |
| `data/model-profiles.json` | how to WRITE for a model (pre-existing) | capability or execution metadata |
| `docs/architecture/model-evidence/*.json` | WHERE every claim came from | the vendor's documentation copied wholesale |

`model-intelligence.js` joins the first two. `public/shared-model-intelligence.js` holds
the vocabularies and the pure resolvers, so a browser screen and the server compute the
same answer — the pattern `shared-generation-capability.js` already established.

Provider-surface evidence files are prefixed `_provider-` so a directory listing shows at
a glance which records are about weights and which are about an API.

## Grades of evidence

`evidenceStrength` on a model definition says **who** established its capabilities:

| Grade | Meaning | May it be a launch recommendation? |
|---|---|---|
| `vendor` | the organisation that made the model documents it | yes |
| `vendor-partial` | the vendor documents some of it; the rest is a provider's | yes |
| `provider-only` | ONLY a provider's catalogue establishes it | **no** |
| `none` | nothing CineBraid has read establishes it | no — watchlist at best |

This is not bureaucracy. Kling 3.0 Pro is thoroughly documented by Runware and
`kling.ai` refused every request from this environment with HTTP 446. That is enough to
catalogue it and not enough to put a paid video path behind it, and
`tests/model-definition-registry.js` enforces the distinction rather than trusting a
comment.

## Catalogue status

| Status | Meaning |
|---|---|
| `launch` | show it, recommend it, keep it working |
| `next-up` | evidenced and wanted; something is still missing, usually execution or a prompt policy |
| `watchlist` | interesting and NOT established; assert nothing beyond a cited source |
| `not-recommended` | researched and declined, with the reason recorded |
| `deprecated` | it was launched and no longer should be; `supersededBy` says what replaced it |

`maturity` is orthogonal and is the *vendor's* account of the model, not CineBraid's.

## Recommendation is written, not inferred

`catalogue.priority` is an integer a human wrote, with the reasoning beside it in
`recommendation`. Ties break on `id`. Nothing sorts a capability list.

This is load-bearing. A longer resolution list is not a better model, and a recommender
that learns to rank on one changes its advice every time a definition gains a field —
with no edit anywhere near the recommendation. The rule that
`resolveCapability` alphabetises its output and position in it means nothing is the same
rule that once made "the best resolution" resolve to 768P.

## Use-case guides

A per-model `useCases` tag says "this model can do that job". It cannot answer the
question a screen actually asks — *for this job, what do we put in front of a filmmaker?*
That is a **use-case guide**, in `useCaseGuides` beside the models.

```
BLOCKING FRAME
Recommended:          (pending evaluation) — shortlist: GPT Image 2, Nano Banana 2
Local option:         (pending evaluation) — shortlist: Z-Image Turbo, Krea 2 Turbo
Premium alternative:  (pending evaluation) — shortlist: Nano Banana Pro, Seedream 5.0 Pro
```

Every slot may be `null`, and **null means undecided, not "none exists"**. An undecided
guide carries a `shortlist` per slot — candidates with reasons — so a screen can render
the state honestly instead of inventing a winner. `integrityProblems()` refuses to let a
slot be filled while `decision.state` is `undecided-pending-evaluation`, so an opinion
cannot become an answer by someone editing one field.

A guide also carries `candidates`: the comparison table, **per model and per surface**,
answering the questions that decide the category. `null` in any cell means not
established; it never means no.

### `blocking-frame`, and why a category can need its own scoring

A blocking frame establishes composition, framing, subject placement, staging, rough
identity, wardrobe state, location, props and tone — fast, cheaply, iterably, and well
enough to hand to a video model as a starting frame. It is **not** a cheaper hero still,
and the guide records `deprioritise: final-image aesthetic quality` for that reason.

Two rules fall out of it that generalise to any future category:

- **A hosted capability is never assumed to exist in an open checkpoint.** Krea 2's
  hosted endpoint takes ten weighted references; its published weights are text-to-image
  only. Those are two rows on two surfaces, and a test asserts the local row stays at
  zero references. Merging them would put an approved identity reference on a local
  render with nowhere to receive it.
- **A candidate is assessed on a surface, not in the abstract.** `surfaceId` is part of
  every comparison row, because a provider's resolution ceiling or reference limit is
  part of what would produce the frame.

`docs/architecture/BLOCKING_FRAME_EVALUATION.md` designs the fixture set that would let
the slots be filled with evidence. It is designed and **not run** — no budget covers a
paid benchmark — and the guide says so rather than implying a result.

## Implementation levels

A model in the catalogue has reached exactly one of these, and the catalogue says which:

| Level | Meaning | How to tell |
|---|---|---|
| 1 — inventory | researched, evidence recorded, not used | in `model-definitions.json`, `promptPolicy.state: not-established` |
| 2 — intelligence | capability, provider relationships and recommendation metadata encoded | plus an offering in `provider-surfaces.json` |
| 3 — compiler | a model pack exists; CineBraid can compile a plan for it | `promptPolicy.state: pack` |
| 4 — execution | a real submission path exists | an `execution` entry at state `available`, backed by an offering at state `available` |

Level 4 is a promise a filmmaker can press Generate. `integrityProblems()` refuses to let
a model claim it unless the surface agrees, so the promise cannot be made in one file and
broken in another.

## Adding a model when the next one lands

The whole point of the shape above is that this is a data change.

1. **Read primary sources first.** Write `docs/architecture/model-evidence/<family>.json`
   before anything else. Sources, then claims citing a source id, then `notEstablished`
   for what nobody documents, then `conflicts` for what two sources disagree about.
   If a fact is not in there, the definition may not assert it.
2. **Add the definition** to `data/model-definitions.json`: identity, capabilities,
   constraints, `catalogue`, `useCases`, `recommendation`, `evidenceStrength`,
   `promptPolicy`, `evidence`. Start at `watchlist` and move up as evidence arrives.
3. **Add the offering** to `data/provider-surfaces.json` under each surface that serves
   it. Record what that provider narrows or declares. Do **not** copy provider numbers
   into the model.
4. **Run `npm run check:model-intelligence`.** New divergences will appear. Read them:
   each one is either a real provider difference worth knowing, or a mistake in step 3.
5. **Only then** consider a pack (level 3) or an adapter (level 4).

New provider? Steps 3–4 with a `_provider-<id>.json` evidence file. New *modality*? Add
its modes to `CINEBRAID_GENERATION_MODES` and `MODE_OUTPUT_TYPES` — that is what C2a did
for `tts`, `music` and `sfx`, and no other code changed.

### Deprecating one

Set `catalogue.status` to `deprecated` and `supersededBy` to the model that replaced it.
Leave it in the catalogue. The next person to ask "what happened to X?" deserves an
answer rather than a silence, and a family whose variants differ only by supersession is
explicitly allowed by the registry test for exactly that reason.

## Staying honest about staleness

`reviewQueue({ asOf, maxAgeDays })` reports every model whose `catalogue.reviewedOn` is
older than the window. It takes the date as an **argument** — there is no clock in the
intelligence layer, for the same reason there is none in the compiler: a catalogue whose
answers depend on when it is asked cannot be tested.

Re-checking a model means re-reading its sources and moving `reviewedOn`. Moving the date
without re-reading is the one failure this cannot detect, and is the reason `evidence`
records carry their own `checkedOn` per source.

## Known gap: vocabulary mismatch between layers

Black Forest Labs documents FLUX 3 Video's resolutions as `hd` and `fhd`. Runware
documents the same tiers as `720P` and `1080P`. CineBraid does **not** translate between
them, because no vendor publishes the mapping and inventing one would be a capability
claim dressed as a convenience.

The consequence is visible and deliberate: `flux-3-video/pro` on the Runware surface
resolves to an **empty resolution intersection** and the configuration is blocked, naming
the field and the layer. The same model on `bfl-api` resolves cleanly.
`tests/model-intelligence.js` asserts both, so the behaviour stays a recorded decision
rather than becoming a mystery.

The fix, when it comes, is a documented mapping sourced from a vendor or provider
statement — recorded in an evidence file like any other claim. Not a lookup table someone
felt was obvious.

## What is deliberately not here

- **No recommender UI.** The data model supports "best for quick iteration", "best local
  option", "premium but expensive" and "deprecated". No screen reads it yet.
- **No Runware adapter.** Runware is modelled as both a catalogue and an execution
  surface, and CineBraid dispatches to neither. Nothing that can run today depends on it,
  and a test asserts that.
- **No audio execution.** Audio models are catalogued with real capability records and a
  mode vocabulary. Nothing generates sound: there is no dispatch path, no voice-casting
  concept and no way to attach a generated line to a shot.
- **No second limit system.** Effective capability is `resolveCapability` with a model
  layer and a surface layer. Node and recipe layers slot in unchanged when they exist.

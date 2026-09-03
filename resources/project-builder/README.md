# CineBraid Project Builder Prompt Kit

**PROJECT BUILDER CONTRACT 1.0**

Use ChatGPT, Claude or a capable local model to turn scripts, treatments, bibles, character notes, storyboards, shot lists and audio documents into a CineBraid project.

The kit produces **planning-only JSON**: characters, locations, props, vehicles, audio entities, scenes, shots, continuity states, keyframes, motion units, exact dialogue, speakers, voice identities, production notes, and five project-specific QC checks — all grounded in the material you supplied.

It does not claim that media has been generated, approved, reviewed, corrected or delivered. CineBraid creates that runtime state after import, and reports everything it had to infer, normalize, remove or flag.

## The contract, and why it is not a version number

The kit's identity is a **contract number**, not a CineBraid release. It says what an external model must produce and what it must leave unknown, and it changes only when that agreement changes — never because CineBraid shipped a release. All six files below state the same contract, and the build fails if they ever disagree.

## Files

| File | What it is |
| --- | --- |
| `CINEBRAID_PROJECT_SCHEMA.json` | The canonical planning-import JSON Schema. There is exactly one. |
| `CINEBRAID_PROJECT_BUILDER_SYSTEM_PROMPT.txt` | The complete instruction for the assistant |
| `CINEBRAID_PROJECT_BUILDER_USER_TEMPLATE.txt` | A reusable request template |
| `CINEBRAID_PROJECT_BUILDER_MINIMAL_EXAMPLE.json` | A small, deliberately conservative example |
| `QUICK_START.md` | The workflow, and what to check in the result |
| `README.md` | This file |

Earlier releases shipped five additional version-named schema files alongside the live one. Three were byte-identical copies and two were stale; all six looked equally authoritative. They are gone. If you have an older kit on disk, delete it — a version-named schema file beside this one is not a fallback, it is a different contract.

## What the builder is for

    your source material
      -> preserve the creative truth already in it
      -> structure what is known
      -> make what is unknown explicit
      -> a CineBraid project
      -> continue through References, Shots, Generate and Review

The builder plans the production. Anything it cannot ground in your material it leaves empty and says so, rather than filling the field with something plausible.

## After import

1. Read the normalized import warnings and the inferred values.
2. Refine the Project Bible.
3. Upload and approve visual and audio references.
4. Build or revise blocking for geometry.
5. Assign final appearance references.
6. Generate and review frame candidates.
7. Correct failed candidates where needed.
8. Plan motion, dialogue, audio and finishing.

The importer always creates a **separate** project. It never overwrites the project directory you have open.

## Rules worth knowing before you read the output

**Dialogue is only ever the words spoken.** Literal speech belongs in `shot.audio.line` or `clip.line`. Speaker, voice source, recording direction, editorial routing, clean-master instructions and post-processing notes each have their own field. CineBraid never treats `audio.note`, `clip.audioNote` or legacy `vo` text as words a character says.

**Fallbacks answer risks.** `shot.safe` is a simpler supported way to shoot a beat whose risk the shot has already named. A shot with `"risks": []` needs no fallback, should not have one, and is not asked for one.

**Absence is a real answer.** A missing `deliveryRoute` means nobody decided how the shot is delivered. A motion unit with no stated method imports as planning-only rather than being routed for you. An omitted `endpoints` means the shot's first and last frames are unconstrained. CineBraid reads all three as undecided and will not guess.

**Endpoints are not a generation method.** `endpoints.start` and `endpoints.end` record how fixed the shot's own opening and ending frames are — `free`, `approximate`, `exact`. That a shot must end on an exact frame does not make it a first/last-frame shot.

**Looks are planning, not references.** `meta.styleBlocks` and `scene.stage` express visual regimes the source authored, including one the film leaves and returns to. They describe intent. They are not approved references and not generated state.

**Nothing has been made yet.** Project Builder JSON cannot contain approved media, blocking images, candidate files, reference assignments, generation packages, provider jobs, reviews or corrections. Prepare that work instead:

- entity `visualDescription` defines what approved references must establish;
- shot `positioning` and keyframe descriptions define the blocking geometry;
- shot `risks` defines what must be checked during generation and review.

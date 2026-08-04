# CineBraid Project Builder Prompt Kit — Schema v6.5.3

Use ChatGPT, Claude, or a capable local LLM to convert scripts, treatments, project bibles, character notes, storyboards, shot lists, and audio documents into **planning-only JSON** for CineBraid v6.6.x using the stable v6.5.3 planning schema.

The kit creates source-grounded project structure: characters, locations, props, vehicles, audio entities, scenes, shots, continuity states, keyframes, motion units, exact dialogue, speakers, voice identities, production notes, and five project-specific QC checks.

It intentionally does **not** claim that media has been generated, approved, reviewed, corrected, or delivered. CineBraid creates runtime state after import and reports anything it had to infer, normalize, remove, or flag for review.

## Files

- `CINEBRAID_PROJECT_BUILDER_SYSTEM_PROMPT.txt` — complete system/project instruction for the LLM
- `CINEBRAID_PROJECT_BUILDER_USER_TEMPLATE.txt` — reusable request template
- `CINEBRAID_PROJECT_SCHEMA_v6.5.3.json` — canonical planning-import JSON Schema
- `CINEBRAID_PROJECT_BUILDER_MINIMAL_EXAMPLE.json` — small valid example
- `QUICK_START.md` — recommended workflow and review checklist

The application also retains the older schema filenames as compatibility aliases, but new work should use `CINEBRAID_PROJECT_SCHEMA_v6.5.3.json`.

## What happens after import

The JSON establishes planning canon, not finished production assets. In CineBraid, the normal next steps are:

1. Review normalized import warnings and inferred values.
2. Refine the Project Bible.
3. Upload and approve visual/audio references.
4. Build or revise blocking for geometry.
5. Assign final appearance references.
6. Generate and review frame candidates.
7. Correct failed candidates when needed.
8. Plan motion, dialogue, audio, and finishing.

## Critical audio rule

Literal spoken words belong only in `shot.audio.line` or `clip.line`. Speaker, voice source, recording direction, editorial routing, clean-master instructions, and post-processing notes belong in their own fields. CineBraid never treats `audio.note`, `clip.audioNote`, or legacy `vo` text as words a character should say.

## Critical reference/blocking rule

Project Builder JSON cannot contain approved media, blocking images, candidate files, reference assignments, generation packages, FAL jobs, reviews, or corrections. Use structured descriptions to prepare those later workflows:

- entity `visualDescription` defines what approved appearance references must establish;
- shot `positioning` and keyframe descriptions define blocking geometry;
- shot `risks` identifies what must be checked during generation and review.

The importer always creates a separate project. It never overwrites the currently active project directory.

## Motion & Sound Brief

The v6.3.0 schema accepts optional structured `clip.motionBrief` data for performance, camera, exact dialogue, timed SFX, ambience, music, and output intent. Older clip audio fields remain valid and are normalized into the same editable workspace.

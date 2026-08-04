# CineBraid Project Builder — Quick Start (Schema v6.5.3)

## 1. Prepare the LLM

Put `CINEBRAID_PROJECT_BUILDER_SYSTEM_PROMPT.txt` in the model's system prompt, project instructions, or first message. Attach `CINEBRAID_PROJECT_SCHEMA_v6.5.3.json` when the model supports schema-guided output.

The minimal example is illustrative only. Do not ask the model to copy its story content.

## 2. Provide source material

Attach the canonical production documents and identify:

- the final or controlling revision;
- older drafts and alternates;
- which document controls shot structure;
- which document controls dialogue;
- any non-negotiable visual, continuity, legal, brand, or audio restrictions.

Then send `CINEBRAID_PROJECT_BUILDER_USER_TEMPLATE.txt` with the desired planning depth.

## 3. Save raw JSON

Save or copy the model's raw JSON response. It must be one JSON object with no markdown fences or explanatory text.

Do not add approved filenames, generated prompts, candidates, reference assignments, blocking images, jobs, reviews, corrections, or delivery state by hand. Those are CineBraid runtime records.

## 4. Validate in CineBraid

Open **Create → Existing material**, paste or upload the JSON, and choose **Validate + review**.

Review:

- source conflicts;
- `[INFERRED FOR PLANNING]` decisions;
- missing visual or production detail;
- continuity states;
- scene/shot/keyframe/motion-unit counts;
- dialogue, speaker, and voice assignments;
- claims removed as unsupported runtime state.

Download the normalized preview when you need an exact record of what will be imported.

## 5. Import and continue production

Import the reviewed preview. CineBraid creates a separate project and fills safe runtime defaults.

Continue in this order:

**Project Bible → Approved references → Blocking → Final references → Frames → Candidate review/correction → Motion/audio → Finish**

The LLM import should prepare these workflows, not pretend they already happened.

## Planning depth

- **Conservative** — explicit structure plus only the minimum inferred visual beats.
- **Standard** — practical coverage without splitting every line or sentence into a shot.
- **Detailed** — production-useful shot planning where the source supports it, without generic filler coverage.

## Model/profile defaults

Usually omit `meta.promptDefaults`. CineBraid applies its installed defaults. Include profile IDs only when the user explicitly names valid CineBraid profile IDs and wants them stored with the project.

## Reference-led motion

Reference-led `r2v` motion units should be 4–15 seconds. Use chained units for longer continuous shots rather than one invalid 20–30 second unit.

## Audio review

Before import, verify every `shot.audio.line` and `clip.line` against the canonical dialogue source. Recording notes, clean-master instructions, editorial routing, and degradation-in-post direction belong in `audio.note`, `clip.audioNote`, character voice notes, or top-level audio records—never inside the spoken line.

Confirm that every non-empty `speakerId` resolves to a character and every non-empty `voiceEntityId` resolves to a top-level audio record.

For dialogue or sound-driven shots, include `clip.motionBrief` when the source supplies performance, camera, exact line delivery, SFX timing, ambience, music, or lip-sync requirements.

# CineBraid Project Builder — Quick Start

**PROJECT BUILDER CONTRACT 1.0**

You have written something. This kit turns it into a CineBraid project you can actually work in — without pretending any of the work has been done yet.

## What you will end up with

A project whose scenes, shots, characters, locations, props and continuity states came from your material, with everything your material did not decide left visibly undecided. From there you continue in CineBraid the normal way:

**Project Bible → Approved references → Blocking → Final references → Frames → Candidate review and correction → Motion and audio → Finish**

The builder prepares those steps. It does not perform them, and it must never claim it has.

## 1. Set the assistant up

Put `CINEBRAID_PROJECT_BUILDER_SYSTEM_PROMPT.txt` into the model's system prompt, project instructions, or first message. Attach `CINEBRAID_PROJECT_SCHEMA.json` if the model supports schema-guided output.

`CINEBRAID_PROJECT_BUILDER_MINIMAL_EXAMPLE.json` shows the shape and the tone. It is illustrative only — do not ask the model to reuse its story content.

## 2. Give it your material

Attach the real documents, and say which one wins:

- the final or controlling revision;
- older drafts and alternates;
- which document controls shot structure;
- which document controls dialogue;
- any non-negotiable visual, continuity, legal, brand or audio restriction.

Then send `CINEBRAID_PROJECT_BUILDER_USER_TEMPLATE.txt` with the planning depth you want.

**Depth**

- **Conservative** — keep your explicit structure; add only the minimum needed to represent the major beats.
- **Standard** — practical coverage of each visually distinct beat, without one shot per sentence.
- **Detailed** — production-useful planning where your source supports it, and no generic filler.

## 3. Save the raw JSON

One JSON object, no markdown fences, no explanation around it.

Do not hand-add approved filenames, generated prompts, candidates, reference assignments, blocking images, jobs, reviews, corrections or delivery state. Those are CineBraid runtime records and the importer will strip them.

## 4. Validate in CineBraid

Open **Create → Existing material**, paste or upload the JSON, and choose **Validate + review**.

Read the review before importing:

- source conflicts;
- `[INFERRED FOR PLANNING]` decisions the assistant made;
- missing visual or production detail;
- continuity states;
- scene, shot, keyframe and motion-unit counts;
- dialogue, speaker and voice assignments;
- claims removed as unsupported runtime state.

Download the normalized preview if you want an exact record of what will be imported.

## 5. Import and carry on

Import the reviewed preview. CineBraid creates a **separate** project — it never overwrites the one you have open — and fills safe runtime defaults.

## What to look for when you read the result

**Does it still sound like your film?** Terminology, names, dialogue and numbering should be yours.

**Is the uncertainty honest?** Empty fields where your source is silent are correct. If every shot has a confident framing size, a camera move and a fallback plan, the assistant has been writing rather than reading.

**Fallbacks.** `safe` should appear only on shots that declare a risk. A shot with `"risks": []` and no `safe` is complete, and CineBraid will not ask you for one.

**Delivery routes.** Most shots should carry no `deliveryRoute`. It belongs only on shots your source actually routes.

**Endpoints.** `endpoints.start` and `endpoints.end` say how fixed a shot's own first and last frames are — `free`, `approximate` or `exact`. That is a separate question from continuity, and it does not decide how the shot is generated.

**Visual regimes.** If your film deliberately changes look and changes back, that belongs in `meta.styleBlocks` with a `stage` on each block, and `scene.stage` on the scenes each regime governs. A regime that returns simply reuses the same `stage` value. If your film has one look, `meta.globalStylePrompt` is enough and there should be no style blocks at all.

**Motion units.** A unit whose method your source never decided should be `kind: "plan"` — not `i2v`. If CineBraid warns that a unit named no generation method, the assistant left the field out; that unit imports as planning-only rather than being routed for you.

**Reference-led motion.** Keep `r2v` units between 4 and 15 seconds; chain them for longer continuous shots.

**Dialogue.** Check every `shot.audio.line` and `clip.line` against your canonical source. Recording notes, clean-master instructions, editorial routing and degradation direction belong in `audio.note`, `clip.audioNote`, character voice notes or top-level audio records — never inside the spoken line. Confirm every non-empty `speakerId` resolves to a character and every `voiceEntityId` to a top-level audio record.

**Model defaults.** Normally omit `meta.promptDefaults` and let CineBraid apply its installed defaults. Include profile IDs only when you have deliberately named valid CineBraid ones.

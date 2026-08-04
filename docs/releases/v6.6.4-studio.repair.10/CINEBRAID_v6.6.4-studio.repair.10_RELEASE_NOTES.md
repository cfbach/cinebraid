# CineBraid v6.6.4-studio.repair.10 — Editable Motion Prompt Revisions

## Problem addressed
Motion prompts were presented as read-only compiled output. In the MiniMax H3 paid-generation preflight, users could review the provider prompt but could not make final wording, timing, camera, or exclusion adjustments before submission.

## What changed

### Edit any ready motion prompt
Every ready-to-use motion prompt now includes **Edit prompt** beside the generation, copy, and download actions.

Editing opens a large bounded editor with:
- the complete provider prompt;
- a live character count;
- a model-aware character limit;
- an optional revision note;
- reset-to-compiled behavior;
- save-as-new-revision behavior.

### Immutable prompt history
CineBraid does not overwrite the original compiled package. A manual edit creates a new prompt build that records:
- parent build ID;
- parent package ID;
- new package/revision number;
- edit timestamp;
- optional revision reason;
- manual-edit provenance.

The compiled source remains available in prompt history.

### Editable H3 preflight
The MiniMax H3 FAL confirmation dialog now includes a full editable textarea rather than a read-only preview.

It provides:
- live `x/2,000` validation;
- clear empty and over-limit errors;
- reset to the selected compiled revision;
- an optional revision note;
- generation from the exact edited text shown in the dialog.

When the prompt differs from the selected build, CineBraid creates a linked manual revision before submitting the paid FAL job. The job records the new build and package IDs.

## Data safety
The update does not alter:
- approved frames;
- shot or motion briefs;
- references;
- existing compiled prompt packages;
- local model settings;
- FAL keys;
- storage settings;
- project media.

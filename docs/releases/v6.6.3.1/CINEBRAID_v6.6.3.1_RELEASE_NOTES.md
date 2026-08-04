# CineBraid v6.6.3.1 — Manual-First Production Workflow

## Summary

v6.6.3.1 re-centers CineBraid on project organization, approved authority, and manual production. Users can import work made anywhere, approve it by human judgment, map it to exact states and views, attach existing stills and video to shots, and finalize delivery without configuring an assistant or generation provider.

AI review, prompt assistance, FAL still generation, and bounded automation remain available as optional tools.

## Manual-first project emphasis

**Settings → Project → Workspace emphasis** offers:

- **Manual-first production** — default;
- **Assisted generation** — shows prompt and generation tools more prominently.

This preference changes presentation only. Existing project data, authority, automation records, prompt builds, and generation jobs remain compatible.

## References

- Reference pages now open on the approved-reference workflow in manual-first projects.
- The primary actions are **Upload reference files**, **Map imported references**, and **Choose primary authority**.
- Prompt building and generation are collapsed under **Optional assisted tools**.
- The candidate task is labeled **Choose & approve**.
- Human approval is available without an AI pass.
- Approval provenance records whether the file was human-approved and whether it had a current AI check.
- Individual and batch AI checks are optional. They are hidden when vision assistance is unavailable.
- Imported-reference mapping uses **Map & assign** in manual-first projects; optional AI checking remains a separate action when available.

## Required, Planned, and Not required

Coverage views, expressions, and non-default continuity states now distinguish:

- **Required** — must be assigned for readiness;
- **Planned** — useful later but not blocking;
- **Not required** — intentionally omitted.

This prevents conventional reference templates from forcing unnecessary generation work.

## Approved reference library

**References → Approved** provides a clean authority-only library. Candidate queues, AI scores, and automation are hidden so producers and artists can inspect the current approved package directly.

## Shots

- Frames lead with existing-image intake and human approval.
- Prompt and generation controls are collapsed under **Optional assisted creation**.
- Still automation remains optional and collapsed.
- Motion & sound leads with existing video/audio intake.
- Existing video can be approved without building a motion prompt.
- Deliver can finalize a human-approved still or video.

## Assisted continuity remains strict

v6.6.3.0’s Reference Authority & Spatial Continuity protections remain installed:

- same underlying subject or asset;
- only the requested state delta;
- exact preservation of embedded photographs, artwork, labels, maps, screens, and text;
- shared physical geometry across location angles;
- requested-view correctness;
- current review-contract enforcement;
- deterministic prompt fallback;
- precise automation correction feedback.

AI review remains advisory evidence. Human assignment establishes authority.

## Compatibility

- No breaking schema migration.
- No provider removed.
- No prompt compiler removed.
- No automation record removed.
- No Project Bible, Reports, recovery, backup, safe-mode, or motion capability removed.
- Existing projects without a saved workspace emphasis open manual-first; users may switch to Assisted generation at any time.

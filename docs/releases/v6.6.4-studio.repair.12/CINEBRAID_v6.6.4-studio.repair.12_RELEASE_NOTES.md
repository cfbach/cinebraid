# CineBraid v6.6.4-studio.repair.12 — Guided Continuity Correction

## Focus
Repair.12 turns continuity review from a diagnostic dead end into a correction workflow. It covers both approved shot-frame sequences and Project Bible continuity states.

## Frame-sequence correction
When two or more approved shot frames fail sequence review, the failed review now provides:

- **Fix continuity** — opens a guided correction workflow.
- **Upload corrected frame** — jumps directly to the selected frame intake.
- **Choose another candidate** — returns to the selected frame candidate area.
- **Add difference to intended progression** — records a previously unspecified change in the frame description and reruns review.

The guided correction workflow lets the user:

- select the structural anchor frame;
- select the frame to repair;
- describe the intended progression only;
- lock camera, crop, environment geometry, baseline lighting, character continuity, and unchanged props;
- inspect the original review findings;
- build a persistent correction package;
- edit the correction prompt before FAL generation;
- choose output count, quality, and resolution through the existing correction-generation dialog.

Correction packages preserve immutable provenance:

- the current target frame is `#image1`, the editable base;
- the chosen anchor frame is `#image2`, the structural continuity authority;
- approved source references are retained when available;
- the failed sequence review is stored as the correction snapshot;
- the correction build is linked to its parent prompt build and frame.

Approving a replacement frame invalidates the old sequence review and can automatically rerun sequence review when the correction workflow requested it.

## Parent-to-state continuity validation
Every non-default continuity state can now be validated against its approved parent.

The rule is explicit:

> The parent is authority. The state description is the allowed delta. Everything else stays locked.

The selected state editor now shows a **Parent-to-state validation** panel that:

- previews the parent and target authority images;
- runs the strict entity-authority vision reviewer;
- checks same underlying asset, only requested delta, embedded content, spatial geometry, and requested view when applicable;
- shows factor findings for design, state, requirements, usefulness, and cleanliness;
- stores the validation against the exact parent filename, target filename, and current state delta;
- treats validation as stale when any of those inputs change.

A failed state validation provides:

- **Correct from parent** — forces parent-derived edit mode, incorporates review findings, rebuilds the state prompt, and opens FAL generation when configured;
- **Upload corrected state**;
- **Choose another candidate**;
- **Accept difference as intentional** — adds the difference to the written state delta, then reruns validation;
- **Validate again**.

Approving a new target authority clears stale validation. Replacing the default authority invalidates derived-state validations that depend on it. When vision is available, newly approved derived states schedule parent validation automatically.

## Responsive UI
New correction and validation surfaces are bounded on desktop and mobile:

- scroll-safe correction modal;
- bounded frame previews;
- responsive validation grids;
- mobile single-column actions;
- no full-page image expansion.

## Compatibility
The repair.11 → repair.12 patch excludes:

- project folders;
- project media;
- `data/config.json`;
- API keys;
- local-model configuration;
- storage configuration;
- `node_modules`.

# CineBraid v6.6.3.0 — Reference Authority & Spatial Continuity

## Summary

This release repairs the reference pipeline exposed by real character, prop, mural, photograph, and location workflows. Approved references now function as enforceable authority across generation, AI review, continuity-state automation, and coverage-slot assignment.

The central rule is now explicit: **a candidate may not pass merely because it looks plausible or receives a high score.** It must preserve the exact approved subject, exact embedded content, and exact spatial/design authority required for its target.

## Strict reference review

Reference review now uses the `reference-authority-v2` contract and hard gates selected for the candidate type:

- same underlying entity/design;
- only the requested continuity delta changed;
- embedded photograph, mural, artwork, print, label, map, screen, or text preserved;
- location spatial geometry/topology preserved;
- requested viewpoint is actually correct.

A final pass is impossible when:

- any required hard gate fails or is omitted;
- any category reports a major or blocking difference;
- the score is below 85;
- the reviewer does not explicitly pass the candidate.

The review modal shows the authority gates and their notes. Legacy reviews remain visible but are labelled as previous-contract results and cannot authorize a current approval.

## Prop and continuity-state integrity

Parent-derived states use the approved parent as the editable base. Prop prompts now lock content carried by the prop, including photographs, murals, paintings, printed pages, labels, maps, screens, and text.

A request such as “tape this photograph to the tile” may change the tape, position, handling, or explicitly written condition. It may not replace or reinterpret the photograph itself.

State automation stores each review on the corresponding candidate card. When a round fails, the exact hard-gate and major-category findings are used as the next-round correction prompt instead of a generic retry.

## Spatially consistent locations

Location coverage generation and review now receive the primary authority plus every approved viewpoint within the bounded reference package.

Each approved view is labelled as one angle of the same physical location. Prompts prohibit changes to:

- floorplan and topology;
- doors, windows, openings, railings, stairs, drains, and fixed fixtures;
- material boundaries and permanent landmarks;
- the relative position of established architecture.

Individual location viewpoints remain the recommended workflow. New views move the camera through the established shared space rather than inventing a different room.

## Coverage review and assignment

AI review and authority assignment are now clearly separate:

- passing coverage candidates show that they passed the current contract;
- they remain marked **not assigned** until a human confirms the named slot;
- Coverage displays a queue when passing views await assignment;
- candidate actions say **Assign to Front/Profile/Rear/etc.** rather than generic Approve;
- batch approval assigns each selected candidate only to its explicit target.

This repairs the confusing case where Front/Profile/Rear candidates appeared to be approved in Review but remained missing in Coverage.

## Imported-reference workflow

The Reference creation hub and Coverage board now provide **Map imported references**.

Existing project images can be mapped to:

- a continuity state;
- a character, prop, vehicle, or location coverage slot;
- a character expression slot.

Mapping adds workflow metadata without changing the file. The mapped image is reviewed against current authorities, then explicitly assigned. Once approved, imported references join the authority package used to generate only the missing views or states.

## Activity alert lifecycle

Failed, interrupted, and cancelled runs can be dismissed individually. A bulk **Dismiss previous alerts** action clears obsolete attention items from Global Activity while preserving their reports and diagnostics.

## Compatibility and safety

- No breaking project migration.
- No provider or workflow removed.
- No motion/video compiler changed.
- Existing recovery guards remain intact.
- Old projects and automation reports continue to load.
- No paid FAL request is submitted by the test suite.

# CineBraid Continuity Correction Workflow

## Core rule

**Parent/anchor authority + allowed delta = valid derived result.**

Everything not named in the allowed delta remains locked.

## Shot frame sequence

### Review
Two or more approved frames must pass sequence continuity before first/last-frame or multi-frame motion becomes ready.

### Failure response

1. Choose **Fix continuity**.
2. Select the structural anchor.
3. Select the target frame to repair.
4. Describe only the intended progression.
5. Keep unchanged categories locked.
6. Build the correction.
7. Edit the generated correction prompt when needed.
8. Generate correction options or upload/choose another frame.
9. Approve the replacement.
10. CineBraid invalidates the old sequence review and reruns it when auto-review is active.
11. Motion unlocks only after the exact current approved filenames pass.

### Intentional differences
A difference cannot be silently ignored. **Add difference to intended progression** writes it into the frame description and reruns the review.

## Project Bible continuity states

### Validation
A non-default state is compared to its approved parent using:

- target approved image;
- parent approved image;
- exact written state delta;
- entity canon and approved coverage authorities.

### Failure response

- **Correct from parent** — rebuilds a parent-derived edit prompt using the findings;
- **Upload corrected state**;
- **Choose another candidate**;
- **Accept difference as intentional** — expands the state delta and revalidates;
- **Validate again**.

### Validation freshness
Validation is current only when all three still match:

- target approved filename;
- parent approved filename;
- written state delta.

Changing any of them invalidates the prior result.

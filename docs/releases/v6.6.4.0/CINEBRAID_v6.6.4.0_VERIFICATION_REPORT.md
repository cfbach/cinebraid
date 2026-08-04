# CineBraid v6.6.4.0 verification

## Focused acceptance

- Assisted Look & blocking exposes AI review and recommendation for existing blocking attempts.
- Blocking review persists a score, pass/flag state, reason, and recommended guide.
- Full-shot automation reviews/reuses existing blocking before generating more.
- Full-shot automation continues through required still frames parent-first.
- Optional post-shot scene continuity review is wired into the durable run.
- Scene review receives approved stills, Project Bible context, and approved authority images.
- Whole-scene automation remains reachable from the scene workspace.
- Manual-first projects keep assisted shot and scene tools collapsed.
- Default-visible shot controls remain within 10; optional reachable controls are deliberately capped at 26.

## Safety

- No paid FAL request is issued by the regression suite.
- Existing durable run, lease, recovery, authority, and redaction behavior remains in place.
- No schema migration is required.

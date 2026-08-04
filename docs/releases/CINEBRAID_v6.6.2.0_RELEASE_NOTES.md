# CineBraid v6.6.2.0 — Clarity & Consolidation

## Summary

v6.6.2.0 is a subtractive workflow release based on the broad v6.6.1.3 bot audit. It reduces the number of decisions shown at once, fixes the Create overflow defect, makes long projects manageable on mobile, and removes only legacy definitions that were proven safe to delete.

No project schema is rewritten. Backups, restore, safe mode, deterministic prompt fallback, Project Bible, older-project migrations, and paid-generation safeguards remain intact.

## References

Reference pages now use four workspaces:

1. **Reference** — primary authority, creation, upload, and generation.
2. **Review** — candidates, workflow filters, batch review, and approval.
3. **Coverage & states** — angle views, expressions, and continuity variants.
4. **Details & history** — notes, planning media, reconciliation, provenance, saved prompts, and advanced actions.

Additional changes:

- Approved authority is shown as status rather than a peer workspace.
- Only one continuity-state editor renders at a time.
- Other states remain compact status rows.
- State selection and legacy saved task IDs migrate into the consolidated workspace.
- Approved multi-view sheets retain **Extract Views**.
- Destructive reference actions move into an advanced section instead of the primary header.

## Shots

Shot work now uses five stages:

1. **Inputs**
2. **Look & blocking**
3. **Frames**
4. **Motion & sound**
5. **Deliver**

Automation is an action within Frames rather than a separate stage. Reference authority/review is integrated into Inputs and Look & blocking. The full project shot navigator defaults collapsed, so a selected stage is no longer surrounded by dozens of unrelated controls.

## Production and Create

- Create no longer repeats the complete scene list for an existing project.
- The real horizontal overflow caused by long scene descriptions is removed at desktop, tablet, and mobile widths.
- The Shots board defaults to next-action work.
- Filters include Next actions, Needs review, Missing inputs, Ready to generate, Completed, and All shots.
- Shots are grouped by scene.
- The mobile board renders five cards per page.

## Settings and Reports

Settings is split into:

- Project
- Assistant
- Generation
- Recovery & advanced

Only the selected assistant provider form is rendered. Hidden provider values remain preserved when saving. Project Log moves to Reports.

Reports also includes read-only **Legacy compatibility usage** telemetry so old field adapters can be removed later based on real project evidence rather than static guesses.

## Clearer blocked and long-running actions

- Disabled primary actions now display the missing prerequisite and next step.
- Initiating panels show stronger local assistant progress/status instead of relying only on global Activity.

## Safe legacy cleanup

Removed:

- `winnersProgress`;
- `planHolderForActiveUnit`;
- the obsolete `window.setWinner` implementation from `mutations.js`.

Active prompt, motion, safe-mode, migration, and compatibility adapters were retained. Direct inspection showed that some apparently duplicated definitions are raw implementations captured by later wrappers and are not safe deletions.

## Measured results

Against the same disposable 22-shot project and four-state mural used in the audit:

- Create horizontal overflow: **0 px** at 390, 768, and 1600 px.
- Reference workspaces: **4**, down from 11 peer tasks.
- Expanded continuity-state editors: **1**.
- Mural workspace: **34 main controls and 2.42 desktop screens**, down from 88 controls and 5.79 screens.
- Shot stages: **5**, down from 7.
- Busiest selected shot stage: **34 main controls**, down from 63–81 visible controls.
- Settings: maximum **17 main controls per tab**, down from 75–77 on the combined page.
- Mobile 22-shot board: **5 cards and 3.58 screens** before pagination, down from 12.04 screens.
- Tested route overflow: **0 px**.

## Paid request safety

No paid FAL image-generation request was submitted during implementation or verification.

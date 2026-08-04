# CineBraid v6.6.3.0 — Manual-only persona audit

**Audit date:** 2026-07-31  
**Resulting release:** v6.6.3.1 — Manual-First Production Workflow

## Audit question

Can a user treat CineBraid primarily as a local production library and continuity system—importing existing work, choosing approved references, organizing views and states, assembling shots, approving existing media, and delivering a project—without using generation, AI review, prompt assistance, or automation?

## Audit setup

The audit used a disposable project and deliberately disabled every assistant capability and in-app generation provider:

- text assistance disabled;
- vision review disabled;
- prompt verification disabled;
- semantic search disabled;
- technical assistant disabled;
- FAL disabled;
- no automated run was started;
- no paid provider request was possible.

The persona began with references and shot media already made outside CineBraid. The test required the user to:

1. open and organize an imported character reference set;
2. choose a primary authority;
3. assign an imported Front image directly;
4. map another imported image to Profile;
5. mark conventional views as Required, Planned, or Not required;
6. browse only approved authorities;
7. open a shot and approve an existing still;
8. approve an existing finished video;
9. mark the video final;
10. complete the path without opening prompt, review, generation, or automation tools.

## Baseline findings in v6.6.3.0

### 1. Human approval existed but was presented as an override

The underlying functions could already assign an image without AI, but the main candidate action was disabled or redirected into review until a vision pass existed. The fallback language described human judgment as an override, which implied that the user was bypassing the correct workflow.

**Impact:** a filmmaker importing already approved artwork could reasonably believe CineBraid required an AI score before accepting their own production decision.

### 2. References opened on attention rather than authority

The four-workspace consolidation was structurally sound, but the default task favored whatever needed review. For a manual user, the first screen was often a candidate or automation problem rather than the approved reference pack.

**Impact:** CineBraid looked like a generation queue instead of the place where approved production truth lives.

### 3. “Missing” conflated conventional coverage with project need

Front, 3/4, Profile, Rear, detail, expressions, and alternate states were treated primarily as complete or missing. A production that did not need a Rear view still appeared incomplete.

**Impact:** users were pushed toward generating reference volume rather than defining the minimum authority their actual shots require.

### 4. Imported-reference mapping looked like recovery

The mapping tool added useful targeting metadata, but the prominent path said review first and treated direct assignment as a human override.

**Impact:** users who had already created references elsewhere could not tell that imports were a normal first-class workflow.

### 5. Approved references lacked a calm browsing view

The Library mixed approved authorities with status, candidates, review pressure, and generation readiness.

**Impact:** there was no simple way for a producer, artist, or collaborator to inspect the current approved reference package without also seeing unfinished generation work.

### 6. Shot stages led with creation assistance

Still and motion workflows contained upload paths, but prompt construction and automation had greater visual authority. Existing-image intake and existing-video intake did not clearly read as the standard first step.

**Impact:** a user attaching externally created frames or footage could feel as though they were entering results into an AI workflow rather than building the shot manually.

### 7. Optional AI occupied space even when unavailable

The batch-review surface could remain visible while vision assistance was disabled.

**Impact:** a provider-free project showed a large unusable assisted feature in the middle of the core manual workflow.

## Changes made in v6.6.3.1

### Manual-first workspace emphasis

Projects now default to **Manual-first production** unless they explicitly select **Assisted generation**. The setting changes hierarchy and defaults only; it does not fork the schema or remove any feature.

### Reference landing workspace

The primary Reference task now leads with:

- **Upload reference files**;
- **Map imported references**;
- **Choose primary authority**.

It states explicitly that human approval is enough. Generation, prompt building, and automation live under a collapsed **Optional assisted tools** disclosure.

### Human approval as first-class authority

Candidate cards expose direct human actions:

- Approve;
- Assign to Front/Profile/Rear or another named view;
- Use as sheet source;
- Reject.

AI checking is optional evidence. Human approvals record:

- approval source;
- approval timestamp;
- whether an AI review existed;
- whether the authority was approved without AI.

### Project-need states

Views, expressions, and non-default states can be:

- **Required** — readiness blocker;
- **Planned** — intended later, not blocking;
- **Not required** — intentionally unnecessary.

Only Required items contribute to missing-reference readiness.

### Approved reference library

A dedicated Approved view hides candidates, review queues, scores, and automation. It presents only entities with approved authority and counts the approved reference package.

### Manual imported-reference mapping

In manual-first projects, the mapper’s primary action is **Map & assign**. When vision is configured, **Map for optional AI check** remains available separately. With vision disabled, no AI action occupies the modal.

### Manual shot hierarchy

- Frames lead with imported/returned image intake and approval.
- Existing stills can become the approved opening frame without a prompt.
- Motion & sound leads with imported video/audio intake.
- Existing video can be approved and finalized without a motion prompt.
- Prompt tools and still automation remain available but collapsed.

## Automated acceptance result

The real Chromium manual-only persona completed the entire provider-free path:

- reference hub opened first;
- assisted reference tools remained collapsed;
- imported Front assigned directly;
- imported Profile mapped and assigned directly;
- Planned and Not required states displayed correctly;
- approved-only library opened without candidate or AI-review clutter;
- existing still selected and approved;
- existing video selected and approved;
- video marked final;
- all assisted creation and automation sections remained optional;
- horizontal overflow remained at zero.

## Product conclusion

CineBraid remains a production-management and approved-reference application. v6.6.3.1 restores that identity in the interface:

> **CineBraid is where the production’s approved truth lives. Generation is one optional way to create material for that truth.**

The assisted authority protections from v6.6.3.0 remain valuable and unchanged for users who generate inside CineBraid. They now sit on top of the manual system rather than defining it.

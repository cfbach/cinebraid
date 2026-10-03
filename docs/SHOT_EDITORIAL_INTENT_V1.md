# Editorial shot intent and planned duration

This bounded launch correction extends the existing Shot Intent vocabulary with
`editorial`, presented as **Existing media / editorial**. It is a production
definition, not a generation mode. Its generation-mode intersection is empty;
it requires no generated frame or video. Existing import, Results, human approval
and final-delivery owners remain responsible for their decisions. Import alone
does not approve a result or make a shot final. Existing reference, malformed
record, media-availability and provider refusal controls remain in force.

An editorial shot with no current approved result asks for existing media to be
imported and reviewed. Retained frames, motion units, candidates and receipts are
not deleted when the route changes. A current approved result remains subject to
the normal explicit final-delivery decision.

## Planned timing

`shot.plannedDuration` is the explicitly authored editorial length in seconds:

- a positive finite number is a declared plan, including fractional seconds;
- `null` is explicitly undecided;
- absence preserves the existing legacy timing interpretation.

New Shot and Shot Intent use the same parser. Invalid values are refused, never
clamped to provider limits. Editing this field does not change `dur`, historical
aliases, motion-unit lengths or generation settings. A cleared field stays
undecided on reopen, even when timed source material exists.

`shared-entities.js` owns the planned-duration read. Shot Desk, shot-board and
runtime summaries consume it; the Bible projection uses the same explicit plan
while retaining its existing incomplete-unit reporting for legacy projects.
`resolveShotDuration()` retains the existing unit-first provider/execution read.
The motion control labels that separate value **Generation duration**.
Build history includes the new canonical field in its source witness.

## Submitted-prompt provenance

Media Inspector reads the submitted prompt through the media's exact
`generationJobId` (or library generation-record job link). The existing job ledger
is the historical request source; current build wording and nearby jobs are not
fallbacks. Exact submitted text, including whitespace, is preserved. Older direct
candidate/library prompt records remain usable. A missing/unloaded linked job is
reported as unavailable; an available history with no prompt is reported as
unrecorded. No duplicate prompt storage or provenance writes are introduced.

Qualification covers route round trips, empty generation-mode intersection,
readiness/refusal boundaries, normal duration authoring and reopen, independent
unit timing, truthful Bible timing, exact linked prompt rendering and negative
controls. These changes do not qualify an optional assistant, provider or model.

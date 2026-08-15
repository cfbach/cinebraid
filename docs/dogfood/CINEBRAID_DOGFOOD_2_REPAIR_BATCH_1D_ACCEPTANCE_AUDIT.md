# CineBraid Dogfood #2 — Repair Batch 1D Final Production-Trust Closure Acceptance Audit

**Audit date:** 2026-08-14  
**Audited branch:** `fix/dogfood2-production-trust-closure`  
**Audited HEAD:** `4eb6521390051ce683e71587c678365747e93e60`  
**Implementation commit:** `4fa57e6343017894b08f56e37b9508ddcffe96a7`

## FINAL VERDICT

# HOLD — ARCHITECTURAL ISSUE REMAINS

Batch 1D contains real improvements, but the six-sentence alpha model still requires material exceptions. In particular:

- all twelve shipped `beginManualApproval` call sites mint target-only capabilities, so the new value/asset checks are optional on every ordinary approval surface;
- the ownership policy, edge reader/writer, and project committer remain exported, replaceable function seams, and installed functions still execute inside the authority operation;
- supporting slots still put entities in the **Approved** Library and render an **APPROVED** badge;
- coverage automation still accepts an unreceipted legacy pointer as its primary reference and submits it as `identity-authority`, while submitting a supporting selection as `approved-view`;
- receipt/live-edge identity remains permissive when a receipt has an asset ID and the live edge loses it; delivery edges do not persist/read an asset ID at all;
- opening the default-reference automation modal still creates and normalizes continuity-state structure before displaying preflight;
- a trusted event leaves the minting window open through all microtasks in the event's macrotask; and
- video-delivery revocation revokes the receipt but clears the still field, leaving `approvedMotionFile` behind.

These are not enterprise identity, hostile-local-process, or distributed-concurrency requirements. Each is an ordinary local application path or an exported application boundary. Because callers can still bypass or replace production-truth rules as a concept, and because UI/generation readers still maintain alternate meanings of “approved,” this is an architectural HOLD rather than a finite cosmetic cleanup HOLD.

No fixes were implemented. No merge, push, real provider request, local-model request, credential use, or preserved-project mutation was performed.

## 1. Scope and method

I read the Dogfood #2 evidence in sequence: Pass #2 closeout, the original forensic audit, Batch 1 handoff/acceptance, Batch 1B handoff/acceptance, Batch 1C handoff/acceptance, and the Batch 1D closure handoff. I did not accept the handoff's closure statements as proof.

The audit used:

- static source and repository-history inspection;
- existing Node suites and mutation controls;
- in-memory real-module probes;
- the repository render harness with synthetic projects and local fetch doubles; and
- local fixture normalization/round-trip checks.

All counterexamples below used the checked-out code. The coverage request evidence came from the local render harness's fetch double; no network request or provider was made.

## 2. Phase 0 — repository receipt

| Check | Independent result |
|---|---|
| Repository | `C:\CineBraid\CineBraid-Source` |
| Branch | Exact: `fix/dogfood2-production-trust-closure` |
| HEAD | Exact: `4eb6521390051ce683e71587c678365747e93e60` |
| Implementation | Exact: `4fa57e6343017894b08f56e37b9508ddcffe96a7` |
| Handoff relationship | `4fa57e6..4eb6521` is one commit and adds only `docs/dogfood/CINEBRAID_DOGFOOD_2_REPAIR_BATCH_1D_CLOSURE_HANDOFF.md` |
| Remote relationship | `origin/fix/dogfood2-production-trust-closure...HEAD` = `0 0` |
| Clean tree before audit | Yes |
| Implementation diff from Batch 1C base | 27 files, 2,126 insertions, 424 deletions; `git diff --check` clean |
| Batch 1C audit evidence | Blob at prior evidence commit and HEAD both `e5b0386a87c87c9e294a20e371e7b20f3288bcb1` |
| Preserved Dogfood project | No changed-file path touches it; the audit did not open it. No independent project path/hash was supplied, so this is a non-access/no-write receipt rather than a fresh byte hash. |

The implementation diff includes no project data, generated media, credential, or provider configuration. The only audit write is this report.

## 3. Seven-blocker closure matrix

| Batch 1C blocker | Batch 1D result | Finding |
|---|---|---|
| MB-1C-01 manual gesture backdoor | **PARTIAL / FAIL** | The harness-only installer is deleted and the browser installer refuses a second installation. However, the production source closes on `setTimeout(0)`, so a later Promise microtask in the same event macrotask can mint. The test harness deliberately supplies a scheduler that does not close the gesture for the session. |
| MB-1C-02 value/asset binding | **FAIL** | Binding fields are optional, and all twelve production call sites omit them. A target-only token committed a different filename and asset. |
| MB-1C-03 ownership policy | **FAIL** | Per-request `eligibility` and the public wrapper are removed, but the globally exported policy installer overwrites the real policy. A contested entity file then committed as Canon. |
| MB-1C-04 legacy second truth | **FAIL** | Generated Media correctly downgrades unreceipted pointers to historic, but the Library and coverage automation still elevate supporting/raw legacy data to approved/authority semantics. |
| MB-1C-05 exact identity | **FAIL** | Name and two-present-ID mismatches fail, and ledger version is enforced. Missing live identity is still accepted despite an identity-bearing receipt; delivery edges never expose an asset ID. |
| MB-1C-06 mutable lineage | **PASS WITH CLEANUP** | Reparent/cascade paths are gone, creation and deletion enforce the immutable graph, and a valid three-level chain survived normalization/round-trip exactly. A refusal helper named `reparentingUnsupported` remains, but it cannot rewrite ancestry. |
| MB-1C-07 callback isolation | **FAIL** | Request fields are removed, but installed ownership, edge-writer, and optional committer functions remain callbacks. They are exported and replaceable; a replacement writer mutated live state through its closure and threw. |

Five prior blockers therefore remain failed, one remains partially failed, and lineage is the one blocker closed at the production invariant.

## 4. 1D-01 — manual gesture source

### What passed

- `installHarnessManualActionSource` is absent from executable source, CommonJS exports, globals, and `CineBraidAuthorityKernel`.
- `public/bootstrap.js:17` has the sole normal product installation call.
- `installBrowserManualActionSource` refuses a second installation at `public/shared-authority-kernel.js:288-300`.
- synthetic events are ignored unless `event.isTrusted === true` (`public/shared-authority-kernel.js:294-297`).
- minted capabilities are identity objects stored in a private `Map`, are target-scoped, and are consumed once (`public/shared-authority-kernel.js:386-434`). Forged shapes, target changes, replay, and post-consumption reuse fail closed in the committed suites.

### What failed

The comment says the gesture covers only the synchronous handler prologue, but the implementation schedules closure with `setTimeout(fn, 0)` (`public/shared-authority-kernel.js:279-297`). JavaScript drains Promise microtasks before that timer. A real-installer probe produced:

```json
{"microtask":"MINTED","nextMacrotask":"MANUAL_ACTION_REQUIRED"}
```

Thus an unrelated later Promise continuation in the same macrotask can reuse the event window. This is precisely the requested “unrelated later operation” case.

Test execution also does not model the production expiry. `tests/render-harness.js:622-637` installs the real source from outside page scope, which is positive, but injects a scheduler that captures and never runs the close callback so one event holds the gesture open for the test session. That is not a separate authority API, but it leaves expiry behavior uncovered by most UI tests.

## 5. 1D-02 — capability binds the decision

The kernel can store `value` and `assetId`, but explicitly permits a bare target (`public/shared-authority-kernel.js:323-355`). Consumption checks only run when those optional fields are truthy (`public/shared-authority-kernel.js:406-425`).

A complete production call-site inventory found twelve `beginManualApproval` invocations outside the wrapper:

- `public/automation.js:2710`
- `public/creation-studio.js:3054,3396,3426,3451,3472,3485`
- `public/library-tools.js:335,668`
- `public/review-provenance.js:437,462`
- `public/review.js:368`

All twelve pass only target descriptors. None binds the filename or asset being confirmed. Several mint before an `await`; for example, automation mints at `public/automation.js:2710-2715`, refreshes the run at line 2716, then resolves the candidate afterward.

Using the real kernel and named frame writer, a target-only token minted while the fixture carried `DISPLAYED.png` / `asset-A` committed a changed decision:

```json
{"committed":"CHANGED.png","asset":"asset-B","receiptValue":"CHANGED.png","receiptAsset":"asset-B"}
```

The durable receipt accurately describes what the software eventually wrote, but it does not describe what the person confirmed. Target changes and replay are closed; selected-value changes, asset changes, stale-modal changes, and another-candidate-before-commit remain open on every shipped approval surface.

This directly disproves the handoff statement that every creator-facing approval binds value.

## 6. 1D-03 and 1D-07 — policy and transaction ownership

### Genuine reduction

`commitNamedAuthority` deletes request fields `eligibility` and `applyEdge`, and the four public named writers fix the target kind (`public/shared-production-authority.js:426-444`). The old public `writeProductionAuthority` export is gone. Unsupported target kinds are rejected by target normalization. These are worthwhile reductions.

### Remaining replacement seams

The rule is not internal to the kernel. The kernel exports all of the following in `AUTHORITY_KERNEL_EXPORTS` (`public/shared-authority-kernel.js:1026-1064`) and exposes the bag as `window.CineBraidAuthorityKernel`:

- `installAuthorityEdgeReader`
- `installAuthorityEdgeWriter`
- `installAuthorityOwnershipPolicy`
- `installAuthorityProjectCommitter`
- `commitAuthorityTransaction`

None of the installers is install-once. Each assignment replaces or clears the prior function (`public/shared-authority-kernel.js:579-587,682-684,985-997,1021-1023`). The production ownership/writer wiring at `public/shared-production-authority.js:464-479` can therefore be overwritten after installation.

The real ownership resolver first returned the contested answer, then ordinary code replaced the exported policy and committed:

```json
{
  "honestOk": false,
  "honestCode": "AUTHORITY_OWNERSHIP_CONTESTED",
  "afterOverwrite": "COMMITTED",
  "approvedFile": "SHARED.png"
}
```

The transaction also still executes installed functions:

1. `OWNERSHIP_POLICY(project, target, value)` receives the live project before drafting (`public/shared-authority-kernel.js:989-997`).
2. `AUTHORITY_EDGE_WRITER(draft, target, details)` runs while staging (`public/shared-authority-kernel.js:788-804`).
3. an optional `PROJECT_COMMITTER(project, draft)` receives both live and staged documents (`public/shared-authority-kernel.js:682-738`).

JavaScript closures can reach the live project regardless of the argument passed. Replacing the exported writer with a closure that mutated the live fixture and threw produced:

```json
{"outcome":"boom","sideEffect":"MUTATED-LIVE","receiptCount":0}
```

This is the MB-1C-07 partial-live-mutation counterexample through the new installer seam. Per-call callbacks went to zero; caller-executable code inside the operation did not.

The supporting-slot equivalent is also not intrinsic. `installSlotOwnershipPolicy` overwrites its function, and `assignSlotReference` enforces ownership only if both `owner.project` and a policy exist (`public/shared-entity-slots.js:127-145`). A caller omitting `owner.project` assigns without the check. This is not a Canon writer, but it is the same optional-policy architecture on the supporting path.

## 7. 1D-04 — one meaning of approved; purpose versus approval

### What passed

`public/shared-production-media.js` now distinguishes a pointer claim from receipt-backed authority. Its Results/Inspector projection downgrades an unreceipted claimed approval to `historic`, does not report a human decision, keeps historic media discoverable, and offers no paid action from that projection. The positive and negative production-media suites pass.

Coverage/expression assignment records now use `status: "selected"` and `assignment.authoritative: false` (`public/shared-entity-slots.js:151-161`). No coverage/expression authority writer exists.

### Approved Library still elevates supporting slots

`entityApprovedReferenceCount` includes every coverage and expression `slot.approvedFile` (`public/app.js:3127-3134`). `libraryCard` turns any nonzero count into:

- CSS status `approved`;
- badge `APPROVED`; and
- copy such as `1 approved file`

at `public/app.js:3136-3156`. The Approved tab filters with the same count and describes its contents as media that “currently define production truth” (`public/app.js:3170-3188`).

Rendering the real Approved Library for an entity with no entity/state Canon and one selected, explicitly non-authoritative coverage slot produced:

```json
{"inApprovedTab":true,"approvedBadge":true,"approvedCopy":true}
```

The actual card was `class="library-card approved"`, contained `<span class="library-status approved">APPROVED</span>`, and said `1 approved file`.

### Coverage automation still turns legacy/support into authority

`primaryReference` reads raw `entity.approvedFile` or a default state's raw `approvedFile`, with no receipt predicate (`public/coverage-automation.js:33-39`). It explicitly falls back to filename when there is no ledger.

The real module, loaded through the render harness with no authority ledger, returned:

```json
{
  "ledger": null,
  "primary": "LEGACY.png",
  "refs": [
    {"name":"LEGACY.png","kind":"primary","storedStatus":""},
    {"name":"SIDE.png","kind":"supporting-view","storedStatus":"selected","authoritative":false}
  ]
}
```

That first half looks purpose-aware, but submission then relabels the values. `submitCoverageJob` uses `identity-authority` for the raw primary and `approved-view` for the supporting row, labels the first “primary approved authority,” and writes both into `authorityManifest` (`public/coverage-automation.js:154-196`). The prompt calls the package an “approved authority package” (`public/coverage-automation.js:145-150`).

A local fetch double reached that exact dispatch boundary without network traffic:

```json
{
  "requestAttempted": true,
  "roles": ["identity-authority", "approved-view"],
  "labels": ["Legacy primary approved authority", "Profile of Legacy"],
  "sources": ["LEGACY.png", "SIDE.png"]
}
```

Purpose and approval are therefore still conflated in two shipped surfaces. The raw legacy pointer is visible as more than history: it is used as current identity authority. The supporting selection is more than context: it is serialized with an approval-like role.

## 8. 1D-05 — exact identity and revocation

### What passed

- Receipt value must exactly equal the live value (`public/shared-authority-kernel.js:630`).
- If both receipt and live edge have nonempty asset IDs, mismatch refuses (`public/shared-authority-kernel.js:631-634`).
- frame reads now use `winnerAssetId` with the legacy identity fallback through the shared helper (`public/shared-production-authority.js:199-210`).
- unsupported, missing, zero, or future ledger versions fail closed (`public/shared-authority-kernel.js:491-518`).
- malformed receipts, duplicate IDs/sequences, competing current receipts, revoked receipts, and wrong target/value cases are rejected by the existing suites.

### Missing identity is accepted

The identity predicate compares asset IDs only “where both sides carry” one. Starting with a valid frame receipt for `asset-A`, deleting the live identity fields while leaving the same filename produced:

```json
{"before":true,"afterIdentityRemoved":true,"liveValue":"A.png","liveAsset":""}
```

An identity-bearing receipt has therefore not established an exact two-part contract. A stale/missing live identity can be rounded up by the filename alone.

Delivery is structurally worse: `readAuthorityEdge` always returns `assetId: ""` for `shot-delivery` (`public/shared-production-authority.js:219-224`), while normal approval callers pass an asset ID into the receipt (`public/library-tools.js:390-426`). Delivery authority can never re-check the receipt's stored asset against the live edge.

### Video revocation clears the wrong field

Revocation calls the installed writer with `value: ""` (`public/shared-authority-kernel.js:906-932`). The delivery writer decides still versus video from the new value's extension; an empty value enters the still branch, clears `finalStillFile`, and never clears `creationBrief.approvedMotionFile` (`public/shared-production-authority.js:369-389`).

Real-module result:

```json
{
  "before":{"motion":"MOVIE.mp4","frame":"FRAME.png","current":true},
  "after":{"motion":"MOVIE.mp4","finalStill":"","frame":"FRAME.png","current":false}
}
```

The good part is that frame authority remains untouched. The failed part is that the revoked delivery pointer remains. Receipt-aware readers call it historic, but raw delivery/workflow readers still encounter the stale `approvedMotionFile`; the exact target edge was not cleared as claimed.

## 9. 1D-06 — immutable lineage

This area is substantially closed.

- `LINEAGE_DELETION_POLICIES` is exactly `["refuse"]` (`public/shared-state-lineage.js:218`).
- state creation validates a complete parent, duplicate IDs, collection integrity, and appends the chosen parent once;
- parent edits in generic setters return a refusal;
- reparent-to-root and cascade requests are unsupported;
- leaf deletion succeeds, while a state with descendants refuses;
- navigation and approval continuation no longer assign a parent;
- missing non-default ancestry is reported rather than filled;
- duplicate IDs and dangling nonempty parent IDs fail collection validation; and
- the 107-check lineage suite passes.

An independent three-level fixture retained exactly:

```text
state-default -> child -> grand
```

before normalization, after `normalizeProjectV5`, and after a JSON save/load round-trip.

Two simplification caveats do not independently block merge:

1. `reparentingUnsupported` remains exported and is asserted by tests (`public/shared-state-lineage.js:373-382,475-493`). It is a refusal-only compatibility helper, not a writer.
2. normalization clears a nonempty parent from an invalid default/root state and string-normalizes an existing parent (`public/app.js:930-937`). It no longer invents a missing parent for a non-default state, but it is not literally a zero-write ancestry normalizer for already-invalid root data.

## 10. Preflight purity

### Correction preflight: PASS

The 47-check correction boundary suite passes first, middle, last, single-shot, deleted-neighbor, and no-approved-still cases. It distinguishes scene-boundary, deleted-neighbor, and no-approved-still omissions, classifies deterministic package errors locally, and reaches no provider code for refusal. The architecture suite separately covers missing target/unresolvable target and confirms no provider attempt or paid-job commit.

### Entity automation preflight: FAIL

`v627EntityPreflight` itself now calls the pure `entityStateListRead` (`public/automation.js:1117-1127`), which is a genuine improvement. The actual modal wrapper still calls mutating `entityStateList` before it invokes preflight (`public/automation.js:1150-1156`). `entityStateList` creates a default state, fills generation fields, migrates notes, and synchronizes the entity pointer (`public/app.js:2461-2493`). Other automation planners at `public/automation.js:1168,1177,1196` do the same.

With a synthetic entity containing only `id`, `name`, and `approvedFile`, merely opening the default-reference automation modal changed it from:

```json
{"id":"E","name":"E","approvedFile":"A.png"}
```

to a record containing a new `continuityStates` array, a new `state-default`, `generationMode`, prompt fields, and build array. No Start action was taken.

The guard moved into a pure helper, but the reachable preflight surface still mutates before calling it.

## 11. OFP / export

**PASS for the audited OFP boundary.** `npm.cmd run check:ofp-core` passed:

- 26 contract fixtures and 35 diagnostics;
- 25 canonical serialization fixtures;
- 10 read classes with zero writes and 41 guarded write entry points;
- 17 OFP negative controls;
- 33 migration rules, 20 synthetic legacy fixtures, and 0 unaccounted values;
- 30 migration negative controls;
- 18 sanitized historical generations, 18,431 accounted values, 524 statements, and **0 approved** migration statements; and
- 21 overfit negative controls.

The migration negative control that promotes a suggestion to human approval is caught. Historic source values remain accounted/preserved/cited rather than being reconstructed as approval. The current UI/coverage defects in section 7 are outside the OFP module and do not invalidate this positive result.

## 12. Reconciliation / resume

The receipt-shape and direction mechanics pass: arbitrary IDs are revalidated, malformed and revoked rows do not close gates, stale rows reopen completed gates, duplicate current receipts fail closed, and reconciliation cites rather than manufactures authority. `tests/production-authority.js` passed 100 checks; `tests/dogfood2-p0-architecture.js` passed 285 end-to-end checks.

Overall reconciliation still inherits section 8's reader defect. A receipt with a stored asset ID remains current if the live identity disappears, and delivery receipts cannot compare asset identity because the live reader always reports blank. Such a receipt can therefore satisfy a gate despite failure of the requested exact identity contract.

## 13. Paid dispatch and frame presence

**PASS.** The defensive mock-based boundary remains intact:

- unknown frame refuses;
- malformed presence refuses;
- mention-scoped contradiction/double-negative cases behave as expected;
- valid presence and valid declared absence proceed through their intended local logic;
- four real bypass callers and an unresolvable target refuse before provider dispatch; and
- refusal creates no provider attempt, paid accounting commit, provider job row, or retry.

`tests/frame-presence-authority.js` passed 63 checks, and the architecture control `CG` demonstrated that removing the universal gate reaches the provider mock and commit checkpoint, so the gate test is non-vacuous. No real provider was contacted.

## 14. Negative-control quality

The control harness mechanics are sound for the invariants it actually targets. The 27-control suite verified baseline operation, confirmed source mutation anchors, reached named checkpoints, asserted specific failure causes, and restored the real module in memory. All controls passed.

Coverage is nevertheless incomplete in ways that explain the green suite versus the live counterexamples:

| Control | What it proves | What it misses |
|---|---|---|
| D1 | deleted harness installer would be dangerous if restored | Promise-microtask reuse of the real production gesture window; most render tests intentionally prevent expiry |
| D2 | a *bound* token rejects changed value/asset | all twelve production call sites create *unbound* tokens |
| D3 | the per-request `eligibility` field is inert and mandatory policy executes | the exported installer can replace that policy after boot |
| D4 | `shared-production-media` downgrades raw legacy pointers | Approved Library and coverage automation use different readers and still elevate them |
| D5 | direct filename contradiction fails; D5b enforces version | receipt identity present/live identity missing; delivery has no live identity |
| D6 | reparent-to-root cannot return as a deletion policy | adequately protects the core lineage rule |
| D7 | a reintroduced per-request `applyEdge` field is ignored | the existing installed writer/policy/committer remain executable closure seams |

There is also no closure control for video-delivery revocation clearing `approvedMotionFile`, nor for the reachable modal calling mutating `entityStateList` before pure preflight.

The suite is therefore non-vacuous but not acceptance-complete.

## 15. Full validation receipt

| Command | Actual result |
|---|---|
| `npm.cmd run check:dogfood2-p0` | PASS |
| Focused positive count | 654 = 100 authority + 63 frame presence + 52 ownership + 107 lineage + 47 correction + 285 architecture |
| `tests/dogfood2-p0-negative-controls.js` | PASS, 27 controls |
| `tests/dogfood2-p0-architecture.js` | PASS, 285 checks |
| `npm.cmd run check:production-media` | PASS |
| `npm.cmd run check:production-media-negative` | PASS, 27 controls |
| `npm.cmd run check:ofp-core` | PASS |
| `npm.cmd run check` | PASS, 167 suites in **90.7s** |
| `python --version` | FAIL: command not found |
| `npm.cmd run check:browser-real` | Exit 0 but **SKIPPED**: no Python 3 interpreter found |

The handoff statement that Python browser suites run in this environment is not reproduced. The full runner prints the same skip for its Python real-browser entries. This is an acceptance-evidence limitation, not the reason for the architectural HOLD; the decisive failures were reproduced in real JavaScript modules and the real render harness.

The worktree was clean after all test/probe execution, before this report was added.

## 16. SIMPLIFICATION VERDICT

### What complexity was genuinely removed?

- Twelve per-request `applyEdge` arguments are gone.
- Per-request `eligibility` is stripped by the named boundary.
- The exported production-authority wrapper is gone.
- Coverage/expression no longer have authority-writer APIs.
- Reparent-to-root and cascade are gone; deletion has one refusal policy.
- Missing non-default parents are no longer authored on load.
- Correction and `v627EntityPreflight` have pure reader helpers.
- Generated Media has an explicit historic disposition for raw pointers.

These reductions are real and materially improve the code.

### What obsolete machinery survives?

#### Merge blockers

- optional bare-target capabilities and twelve unbound call sites;
- replaceable/exported policy, reader, writer, and committer installers;
- a globally exported generic `commitAuthorityTransaction` coupled to those replaceable functions;
- `approvedFile`-based supporting-slot counts rendered as Approved;
- raw-pointer `primaryReference` and `approved-view` serialization;
- mutating `entityStateList` on a preflight-opening path;
- incomplete identity agreement and type-blind delivery clearing.

#### Recommended simplifications before alpha

- make value/asset binding structurally required for every approval instead of an optional field callers must remember;
- make target-kind policy and edge mutation private/fixed module behavior, with no post-boot replacement API;
- give supporting selection a purpose-named field/reader instead of making every consumer reinterpret `approvedFile`;
- separate migration/repair from `entityStateList` so a function used as a reader cannot write; and
- remove or narrow raw-pointer readers so “historic” is derived once and shared.

#### Optional cleanup after merge

- delete `reparentingUnsupported` once no generic setter needs the compatibility refusal;
- remove comments that describe deleted per-request callback APIs except where retained as historical rationale;
- rename local collections such as `approvedNames` when they also contain selected supporting files; and
- reduce the test harness's session-long gesture convention once focused event-expiry tests exist.

### Are there duplicate representations of production truth?

Yes. At least three operational meanings survive:

1. receipt-backed Canon in the authority ledger;
2. supporting/raw pointer presence rendered or serialized as approved authority; and
3. workflow status `APPROVED`, which is intentionally separate but shares the same product word.

Generated Media now handles the first two correctly; the Library and coverage automation do not.

### Did Batch 1D centralize rules or move guards?

Both. Lineage deletion and the receipt ledger are genuinely centralized. Capability binding and transaction ownership mainly moved guards: binding is optional at mint time, while callback choice moved from request fields to exported installers. Preflight purity moved into a helper while a reachable wrapper still calls the mutating reader first.

### Can a future maintainer explain the architecture in a few sentences?

Not truthfully without exceptions. They would have to explain which “approved” UI means workflow, supporting selection, raw legacy pointer, or receipt Canon; which installer currently owns kernel behavior; when a token did or did not bind the selected bytes; and which nominal readers normalize state. That is more conceptual surface than the alpha model requires.

## 17. Six-sentence test

| Sentence | Result | Required exception in the shipped application |
|---|---|---|
| Human explicitly approves Canon. | **FAIL** | A gesture token usually binds only a target, not the decision; the policy/writer may also be replaced through exported installers. |
| Automation only recommends. | **PARTIAL** | Direct automation writers no longer mint Canon, but a Promise continuation in the trusted-event macrotask can still mint, and coverage automation treats raw/supporting media as approval-like authority input. |
| Supporting references are not Canon. | **FAIL at product semantics** | Ledger writes agree, but Approved Library and coverage request roles/copy say otherwise. |
| Legacy pointers are historic. | **FAIL product-wide** | Generated Media agrees; coverage `primaryReference` promotes a no-ledger raw pointer to current identity authority. |
| State ancestry is immutable. | **PASS** | No ordinary path reassigns a valid state's parent after creation. The surviving helper only refuses. |
| Preflight does not mutate. | **FAIL product-wide** | Correction preflight and `v627EntityPreflight` are pure, but opening the entity automation modal mutates through `entityStateList` first. |

## 18. Merge blockers and non-blocking follow-up

### Merge blockers

1. Require the manual capability to bind the exact displayed value and available asset identity, and update every production minting surface.
2. Remove or make immutable/private the replaceable authority policy/writer/committer seams; no application-callable function may redefine the kernel's truth rules.
3. Make Approved Library and coverage automation consume receipt-aware Canon and purpose-aware supporting/history projections.
4. Enforce receipt/live identity symmetry when the receipt records an asset ID; persist/read delivery identity consistently.
5. Clear the correct delivery field on revocation without touching frame authority.
6. Remove mutation from the reachable entity preflight-opening path.
7. Close or explicitly scope the gesture window so later unrelated microtasks cannot mint.

### Non-blocking follow-up

- delete refusal-only/stale compatibility helpers and historical comments once callers/tests no longer need them;
- add real-browser coverage when Python is actually present; and
- rename workflow-only `APPROVED` copy where product context does not make its non-Canon meaning unmistakable.

## FINAL VERDICT

# HOLD — ARCHITECTURAL ISSUE REMAINS

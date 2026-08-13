# CineBraid — Generation Truth / Routing: runtime integrity pass

**Status: IMPLEMENTED.** P4 made CineBraid truthful about **media**. This batch makes it truthful about **generation**: what it says it will send, and what it would actually send.

| | |
|---|---|
| Baseline SHA | `da6aadd` (`main` == `origin/main`, working tree clean) |
| Application version | `6.7.0-private.1` — **unchanged** |
| OFP contract revision | `1.0-draft.1` — **unchanged** |
| Node / OS | v25.6.0 / Windows 11 Pro 10.0.26200 |
| Predecessor | P4-SEM-C4, PR #64, `6408eeb` — job media identity |

---

## 1. Executive verdict

Four defects were confirmed against the live runtime and repaired. Three widely-suspected defects were **disproven** — the product was already correct, and the record says so rather than quietly dropping them.

The headline finding is that **the MiniMax H3 multi-frame keyframe sequencer was decorative**. A filmmaker could activate approved frames, reorder them, and write the beat each one represents, under an on-screen promise that those images are *"sent to FAL in this exact order as Image 1, Image 2, and onward"*. None of it reached the request. The panel's author — `public/creation-studio.js` — is the only producer of the `sequential-keyframe` role in the browser, and `public/v607-composer.js` replaces that collector wholesale. It captured the original on one line and never called it.

That was not inferred from source. It was proven end to end: a three-beat shot, driven through the shipped UI writers in a real Chromium, compiled through the real `/api/prompt/compile` with **zero** sequential keyframes and two of its three approved frames absent from the package entirely.

---

## 2. Starting baseline

`npm run check:quick` — **EXIT=0, 98 suites.** C2 7/7 · C3 7/7 · C4 9/9 · project-save revision race 3/3.

`npm run check:browser-gate` — **FAILED.** 15 gated suites launched, 14 executed, **1 failed**; 3 quarantined suites launched and failed for their exact pinned reasons; isolation clean (29 files under `data/` and `projects/` byte-identical).

### 2.1 The red baseline, root-caused before anything was written

`check:browser-real` timed out clicking `DISMISS` on an injected activity run. Per the C4 closeout's standard, it was diagnosed rather than re-run until green.

`public/live-activity.js` polls every `V641_ACTIVITY_REFRESH_MS = 3500`. `refreshGlobalAutomationActivity()` replaces `AUTOMATION_RUNS` with the **server's** list and rebuilds the drawer's `innerHTML`. `tests/real-browser-workflow.py:321` injects a client-only run, then must land its click inside whatever remains of the poll window.

Measured directly with an instrumented probe against the shipped page:

```
V641_ACTIVITY_REFRESH_MS = 3500, timer armed
t=1759..3798ms   runs contain the injected id: true   node present: true   DISMISS present: true
t=4303ms         runs contain the injected id: FALSE  runCount 1 -> 0      node destroyed
```

~2.5 s of clickable window, then the node is gone for good — exactly Playwright's *"element was detached from the DOM, retrying"* followed by a 30 s timeout. **4/4 passes standalone**; it failed once under the loaded full gate, where 17 other browser suites have already run.

**Verdict: a pre-existing, mechanically-proven timing flake with no relationship to generation, routing, models, providers, prompts or references.** It was not fixed here and its expectations were not edited. The underlying product observation — a drawer that rebuilds its entire markup every 3.5 s, detaching whatever control is under the cursor — is real, user-facing, and belongs to **Production-State Honesty** (§16), which this batch is explicitly forbidden to implement.

---

## 3. Methodology

Static source was treated as hypothesis and nothing else. Every finding below has a live receipt:

1. the exact runtime operation named;
2. the live implementation identified **by execution**, not by reading;
3. behaviour proven in a real Chromium against isolated fixtures;
4. root cause separated from symptom;
5. the smallest coherent repair;
6. a negative control that reintroduces the defect and must be caught.

Temporary instrumentation lived outside tracked source and is not in the tree. **No provider was contacted. No paid route was called.** Every browser probe aborted `POST /api/generation/fal/jobs` and asserted zero paid calls and zero off-host requests.

**One deviation from the prescribed order, recorded plainly:** the test matrix was written *after* the repairs rather than before them. Each defect had already been proven live and reduced to a specific reader/writer disagreement, so the tests were derived from those proofs rather than from a prediction. The negative controls are what make that acceptable — every guard was shown to fail when its defect is put back, so none of them is a test written to fit code that already passed.

---

## 4. Script load order and global ownership

39 scripts load from `public/index.html`. The generation-relevant tail, in execution order:

| # | Script | Role in generation |
|---|---|---|
| 11 | `shared-generation-capability.js` | mode / role vocabulary, four-layer capability intersection |
| 13 | `shared-generation-options.js` | the pure availability resolver |
| 26 | `creation-studio.js` | guided frames, motion panel, **H3 keyframe panel**, profile filter |
| 28 | `fal-generation.js` | paid dialogs (image + H3) |
| 29 | `generation-picker.js` | capability-aware option list |
| 36 | `v607-composer.js` | **replaces 18 creation-studio functions** |
| 37 | `motion-sound-composer.js` | **wraps 5 more**, filters the profile list |

The two composers run inside IIFEs and assign `name = window.name = …`. Because the definitions they replace are top-level *function declarations*, they live on the global object — so the assignment changes what `creation-studio.js`'s **own internal calls** resolve to. The shadow is total, and the browser confirmed it: for all 30 probed names `window[name] === <bare identifier>`.

---

## 5. Function ownership census

Counted mechanically, then confirmed by executing the page.

| Measure | Count |
|---|---|
| `v607-composer.js` dual reassignments (`name = window.name = …`) | **19** statements over **18** distinct names |
| `v607-composer.js` window-only overrides of creation-studio definitions | 3 (`buildGuidedFramePrompt`, `buildGuidedMotionPrompt`, `setGuidedMotionField`) |
| `motion-sound-composer.js` overrides of earlier definitions | 5 |
| Distinct generation-relevant names with a non-original owner | **23** |

**The C4 closeout's "approximately 19" estimate was exactly right** — 19 reassignment statements. It is recorded here as confirmed, not corrected.

### 5.1 LIVE / SHADOWED, after this batch

Derived mechanically: for each of the 21 names `v607-composer.js` replaces, is the captured predecessor **called** anywhere in the file?

**Captured and called — 10:** `ensureShotCreation` · `guidedFrameCard` · `guidedFramePromptResult` · `guidedMotionPanel` · `guidedMotionPromptResult` · `setGuidedMotionField` · `buildGuidedFramePrompt` · `buildGuidedMotionPrompt` · **`guidedMotionReferences` (newly — §7)** · `guidedFramePromptRefs`

**Captured and never called — 11:** `shotCreationPromptReferences` · `compositionSummary` · `compositionAugmentedReferences` · `guidedShotComposerPanel` · `ensureGuidedMotionUnit` · `motionSubjectPlan` · `motionPropPlan` · `structuredMotionSummary` · `motionSubjectControls` · `motionPropControls` · `motionDirectorMap`

One correction the raw count hides: `guidedFramePromptRefs` calls `guidedFramePromptRefsRaw607`, which captured **v607's own line-379 layer**, not `creation-studio.js`'s definition. So by the question that matters — *is the creation-studio definition still reached?* — it is not.

| | Count |
|---|---|
| creation-studio definitions still reached through a v607 wrapper | **9** |
| creation-studio definitions **SHADOWED** (never reached) | **12** |
| `motion-sound-composer.js` wrappers that call what they replaced | 5 (all of them) |

**LIVE CANONICAL** — one definition, creation-studio owns it: `h3ApprovedFrameRows` · `guidedH3KeyframePanel` · `preferredGuidedVideoProfile` · `suggestedMotionProfileForApprovedFrames` · `guidedVideoProfileOptions` · `guidedVideoProfileDispatchable` · `guidedDispatchableVideoProfiles` · `motionPromptCharacterLimit`

**DEAD: none found.** `restoreComposerOriginals607` is reachable through `window.disableComposerEnhancements` and the `?safe=1` path, so the captured originals are a live rollback mechanism rather than dead weight.

### 5.2 Real-browser ownership receipts

```
composer607: { ready: true, disabled: false, error: "" }
ensureShotCreation        -> ensureShotCreation607          window === bare: YES
guidedMotionReferences    -> guidedMotionReferences607      window === bare: YES
guidedVideoProfiles       -> guidedVideoProfiles630         window === bare: YES
guidedMotionPanel         -> guidedMotionPanel630           window === bare: YES
h3ApprovedFrameRows       -> h3ApprovedFrameRows            (unshadowed)
```

`PROMPT_LIBRARY` is a **lexical** global and is not on `window`; a first probe reading `window.PROMPT_LIBRARY` returned nothing and was corrected. Recorded because it is a standing trap for any future browser assertion.

---

## 6. Generation mode truth matrix

Dispatchability is the server's own annotation (`generation-options.js:annotateProfileLibraryExecution`), not a judgement made here.

| Mode | Catalogue | Adapter | In guided picker | Verdict |
|---|---|---|---|---|
| **T2I / edit / multi-reference / blocking** (image) | 6 families | `gpt-image-2/standard` only | n/a (image dialogs) | **FULLY EXECUTABLE** for GPT Image 2; every other family PROMPT-ONLY and honestly refused |
| **T2V** | 5 profiles | `minimax-h3/t2v` → `fal-h3-fl2va` | **was hidden → now reachable** | **FULLY EXECUTABLE** (repaired) |
| **I2V** | 6 profiles | `minimax-h3/i2v` | yes | **FULLY EXECUTABLE** (H3 only) |
| **FLF** | 5 profiles | `minimax-h3/flf` | yes | **FULLY EXECUTABLE** (H3 only) |
| **R2V / multi-frame** | 5 profiles | `minimax-h3/multi-frame` → `fal-h3-ref2va` | yes | **FULLY EXECUTABLE**; sequencing repaired (§7) |
| `audio-video` | `ltx-2.3` | none | yes, disabled | **CATALOGUE-ONLY** |
| `video-edit`, `retake` | `wan-2.7`, `ltx-2.3` | none | no | **CATALOGUE-ONLY** |

Of 24 video profiles, **4 are dispatchable and all 4 are now reachable** — asserted against the server's annotation rather than against a list restated in the test.

---

## 7. H3 sequential keyframes — the headline repair

**Verdict: REPAIRED into the live path.**

`creation-studio.js:2419` builds an ordered `sequential-keyframe` package from `h3ApprovedFrameRows(s)` — the panel's enable flags, its stored order, and the beat note written against each frame. Every downstream layer already understood it: `generation-compiler.js:163/177/270`, `model-packs/minimax-h3.js:843` (`waypointRoles`), `shared-generation-capability.js:77`, and the `ref2va` checkpoint, which declares `sequential-keyframe` and `waypoint` among its accepted roles with `maxReferenceImages: 9`.

`v607-composer.js:749` replaced that collector with `gatherMotionReferences607`, which knows exactly two visual anchors and emits no waypoint role at all. Line 733 captured the original as `guidedMotionReferencesRaw607` **and never used it**.

### Before, proven live

```
LIVE   guidedMotionReferences607   -> 4 refs: first-frame, alternate-view, identity, prop
                                     sequential-keyframe: 0     beat notes carried: false
SHADOWED guidedMotionReferences    -> 8 refs including 3 sequential-keyframe
                                     sequential-keyframe: 3     beat notes carried: true
```

Through the **real** `/api/prompt/compile`, a three-beat shot compiled with `sequentialKeyframes: 0`; Frames B and C were absent from the package. The free-text *"Sequence / transition direction"* field did reach the prompt — so the panel was **partly** live, which is what made it convincing.

### After

The repair is a delegation, not a reimplementation: the multi-frame case is handed to its own author, and the composer's budgeting still applies on top. Through the real plan route:

```
reference_image_urls[0] <- sequential-keyframe  h3-keyframe:SAMPLE-01:frame-a
reference_image_urls[1] <- sequential-keyframe  h3-keyframe:SAMPLE-01:frame-b
reference_image_urls[2] <- sequential-keyframe  h3-keyframe:SAMPLE-01:frame-c
dispatch: minimax/h3/reference-to-video     refusal: null
```

Consecutive provider slots, in the panel's order, each carrying its directed beat — which is exactly what the panel promised.

---

## 8. T2V reachability

**Verdict: A — executable but accidentally hidden. Made reachable.**

`minimax-h3/t2v` resolves to the wired `fal-h3-fl2va` adapter, the same checkpoint and serializer as i2v and flf. `guidedVideoProfiles()` filtered modes to `["i2v","flf","r2v","audio-video"]`, so the only prompt-only route CineBraid can run had no way to be selected. It was the **only** dispatchable video route hidden from the picker.

Repaired by adding the mode, plus the two things truthfulness requires:

- **it carries nothing.** `fal-h3-backend.js` declares `t2v: { referenceMedia: [], firstFrame: false, lastFrame: false }`. A package preview listing references the request has no field for is the same lie as a picker offering a model that cannot run. (A second, independent enforcer already existed: the profile declares `maxReferences: 0`, so the reference budget assigns nothing. Both are now pinned, and the negative control has to defeat both.)
- **it is not gated on an approved still.** Two gates in `buildGuidedMotionPrompt` exist to guarantee a visual anchor; t2v has none by construction, so they are asked of the target rather than of every shot.

Live receipt: the option renders `Text to Video · prompt only, no reference images`, **not disabled**, and compiles a 656-character prompt with zero references.

---

## 9. Image model / provider truth — hypothesis DISPROVEN

`IMAGE_MODEL_ID = "gpt-image-2/standard"` is hard-coded in `image-execution.js:45`. The suspicion was silent substitution. **It is not happening.**

`public/generation-picker.js:225` computes `mismatch = chosen.modelId !== request.planModelId` and **disables the paid button** with a named refusal: *"CineBraid cannot compile for X yet — the compiled request on this screen was written for GPT Image 2. Choose that option to submit."*

So the guarantee this batch was to establish is already met on the compiled image paths: **compile exactly what was selected, or refuse with a reason.** Never substitute. The hard-coded constant is the honest single-adapter reality, and `generation-options.js` declares exactly three adapters beside their serializers.

**Residual, recorded not fixed:** blocking *revision*, candidate *correction* and entity-reference generation still run the pre-C2b path and are deliberately not claimed in the adapter inventory. They compile no plan, so they cannot mis-compile one; they are named in `generation-options.js:57-60` as out of scope.

---

## 10. Video routing truth

**`approvedCount === 2 → FLF` is a DEFAULT, not a lock — hypothesis partly disproven.** `suggestedMotionProfileForApprovedFrames` runs only from the Frames→Motion handoff, writes the *shot-level* field, and the *unit-level* choice wins at build time. Proven: with an explicit multi-frame choice, the effective profile stayed `minimax-h3/multi-frame` through the handoff.

**But its creator-choice guard was dead code — confirmed and repaired.** The guard exists so *"a shot the filmmaker has already directed keeps its own target"*. It read `c.motionProfileId` and `c.motionDirection` / `s.motionPrompt` — where the *pre-composer* writer put them. The live `setGuidedMotionField` (`v607-composer.js:779`) stores both on the **active motion unit** and returns before the shot-level fields are touched. Proven: after an explicit choice **and** typed direction through the app's own writer, `guardSeesCurrent: false`, `guardSeesWork: false`. The guard could never fire.

Same shape as the alpha-loop batch: **a reader that survived while its writer moved.** It now consults the unit first and falls back to the shot-level fields for projects written before units. Negative control receipt: `chose minimax-h3/multi-frame, guard suggested minimax-h3/flf`.

**Deferred:** whether a bare profile selection with *no* typed direction should also be protected is a recommendation-policy question and belongs with the route-recommendation UX, which this batch does not build.

---

## 10a. R2V readiness contract

The current contract, not the future workspace. One route is READY; the rest are prompt-only.

| Route | Verdict |
|---|---|
| `minimax-h3/multi-frame` → `fal-h3-ref2va` | **READY** |
| `seedance-2/r2v`, `kling-3/r2v`, `happy-horse-1.1/r2v`, `wan-2.7/r2v` | **ADAPTER MISSING** — prompt-only. `wan-2.7` is additionally hidden from the picker (§18). |

For the one READY route, read from the `ref2va` checkpoint and the fal backend:

| Question | Answer |
|---|---|
| Image / video / audio references | 9 / 3 / 3, **12 total** (fal documents the combined ceiling explicitly) |
| Audio without a visual | Refused — `audioRequiresVisual: true` |
| Reference clip length | 2–15s each, 15s total |
| Roles preserved into the request | **Yes** — proven live: `reference_image_urls[0..7]` each bound to its own role (`sequential-keyframe` ×3, `identity` ×2, `prop`, `base`, `alternate-view`) |
| Character / location / prop distinction | **Preserved** — bound by production role, not list order |
| Ordered waypoints | **Yes, as of this batch** (§7) |
| Performance direction | Yes — the Motion & Sound brief compiles performance, camera, dialogue and sound |
| Camera direction | Yes |
| Timing beats | Partly — waypoints, SFX event timing and dialogue start/end carry; **`dialogue delivery` does not.** The compiler says so rather than dropping it silently: *"dialogue delivery is set on this shot but the minimax-h3 r2v compiler does not carry it."* |
| Reachable from the UI | Yes |
| Reachable from automation | **No, by design** — motion is never submitted by the still-automation runner |

**What a future directing workspace can build on:** an ordered waypoint sequence with per-beat direction that provably reaches consecutive provider slots, role-preserving reference binding, and a compiler that names what it cannot carry.

---

## 11. Reference grounding

**Verdict: MUST FIX, repaired — and the first attempt was wrong.**

`prompt-engine.js:1208` appended *"Attach an approved character image to use the story name in the model prompt"* whenever a character name went ungrounded. In i2v and flf the H3 `fl2va` checkpoint declares `referenceRoles: ["first-frame","last-frame"]` and nothing else; its one (i2v) or two (flf) image slots are already spent on the approved endpoints. The advice could not be followed. The dogfood read it during an FLF shot and took it for a recommendation to change reference strategy.

**The correction that failed.** The first repair suppressed the whole warning when an endpoint image was present. `tests/composer-motion.js:1299` caught it, and it was right to: the **disclosure** — *your character's story name was replaced in the prompt* — is owed in every case, and only the **instruction** is conditional. Those had been one sentence. They are now two, and both are pinned:

| Case | Sentence |
|---|---|
| a slot is free | *Attach an approved character image…* (unchanged, still actionable) |
| grounded by the approved endpoint | *Identity is carried by the approved starting image in this workflow…* |
| no slot left | *…has no image reference slot left in this workflow…* |

The "carried by the endpoint" case also stopped being restricted to single-character shots — a two-hander standing in its own opening frame read as ungrounded while that frame carried both identities. `NC-I` guards the over-correction permanently, because telling someone to do something impossible and failing to tell them their character's name was replaced are opposite failures of the same sentence.

---

## 12. Duration — hypothesis DISPROVEN

The dogfood's editorial `7.95s` is **not** silently shortened. `h3-execution.js:229` refuses with a named replacement:

> *"This shot asks for 7.95 seconds. MiniMax H3 renders whole seconds only. Choose 8 seconds and generate again — nothing was sent and nothing was charged."*

The paid dialog states both layers separately — *"MiniMax H3 itself renders 4–15s; this backend renders 5–15s"* — and says in words that submitting the original *"is refused, not adjusted"*. Editorial and generation duration are already distinct and already honest. **No change made, and none needed.**

Recorded gap: `shotDur(s)` returned `5` for a shot storing `dur: 7.95`. That is a **planning-side** reader, not a generation one; it did not affect any request in this batch and is left to whoever owns timeline duration.

---

## 13. Prompt limits

**Verdict: MUST FIX, repaired.** The dogfood's `1,991 / 2,000` versus `4,894 / 7,000` was two different numbers for the same prompt, and the tighter one was **enforced as a hard refusal**.

`fal-h3-backend.js:78-84` is unambiguous and predates this batch:

> *"fal's queue schema documents no maxLength on `prompt` for any of the three H3 endpoints… CineBraid previously refused at 2,000… That is no longer what the schema says, so the number is retired rather than carried forward: a stale refusal costs a filmmaker the direction they wrote, and does it silently at the moment of dispatch."*

Two survivors of the retired number:

1. `public/creation-studio.js` `motionPromptCharacterLimit()` returned `family === "minimax-h3" ? 2000 : 12000`, labelled *"current MiniMax H3 FAL limit"*, and **threw** above it. It now reads the profile's own declared ceiling (`publishedGuidePromptCharacters`, 7,000 — a field that existed in `data/model-profiles.json` with no reader) and branches on no family name.
2. `prompt-engine.js` called its own compaction budget *"the provider schema limit"* — contradicting line 2579 of the same file, which says the 2,000 is *"CineBraid's own budget for this written package, not a provider ceiling"*. The **number keeps its value**; only the claim it was never entitled to make is gone.

`tests/minimax-h3.js:125` pinned the false phrase. It was updated with the reasoning in-place, and a second assertion added forbidding the old claim — the property (warn near the budget) is unchanged.

Live receipt: the prompt editor and the paid dialog now both state **7,000**.

---

## 14. Provider / model availability — hypothesis largely DISPROVEN

The underlying state model already distinguishes exactly what the dogfood asked for. Run against the real resolver:

```
ready            gpt-image-2/standard   adapter + connected
not-implemented  krea-2/large           "Runware serves Krea 2 Large, but CineBraid has no way to send a request to it yet."
incompatible     gemini-image/3-pro     "CineBraid knows Nano Banana Pro, but no provider it can reach offers it."
```

*"You need to connect this provider"* and *"CineBraid has no adapter"* are already separate states with separate sentences, and the sentence renders beneath the chip.

**One-line change made:** the `not-implemented` chip read *"Not available yet"*, which sounds like a statement about the provider and invites someone to go looking for a connection. It now reads **"No CineBraid adapter"**, agreeing with the sentence underneath it. No Settings pages, no referral links, no price data.

---

## 15. Implementation

| File | Change |
|---|---|
| `public/v607-composer.js` | multi-frame delegated to its author; t2v gathers nothing (+25 / −1) |
| `public/creation-studio.js` | `t2v` in the profile filter; `guidedVideoModeNeedsApprovedStill`; two anchor gates asked of the target; `motionPromptCharacterLimit` reads declared ceilings; route guard reads the active unit; option suffix for t2v; safe-mode collector t2v guard |
| `prompt-engine.js` | grounding disclosure separated from grounding advice, advice chosen from declared limits; length report names its own budget |
| `public/generation-picker.js` | the `not-implemented` chip label |
| `tests/minimax-h3.js` | the retired-claim assertion corrected, with a new assertion forbidding its return |
| `tests/generation-truth-routing.js` | **new** — 11 properties |
| `tests/generation-truth-routing-negative-controls.js` | **new** — 11 controls |
| `tests/generation-truth-real-browser.py` | **new** — gated real-browser suite |
| `package.json`, `tests/run-full-check.js`, `tests/current-behavior.js`, `tests/run-browser-gate.js` | registration |

**Not changed, deliberately:** no schema, no OFP, no version bump, no adapter added, no provider capability invented, no model catalogue edit, no duration behaviour, no Settings surface, no Activity drawer, no recommendation UX, no `wan-2.7` visibility change (§18).

---

## 16. Tests

```
npm run check:generation-truth            11 properties
npm run check:generation-truth-negative   11/11 controls, each with a live-defect receipt
npm run check:generation-truth-browser    gated real-browser suite, 0 paid calls
npm run check:quick                       EXIT=0, 100 suites (98 -> 100)
```

C2 7/7 · C3 7/7 · C4 9/9 · save-race 3/3 — all unchanged.

The Node suite runs against the render harness, which evaluates `v607-composer.js` and `motion-sound-composer.js` in shipped order, and **asserts the live owner by name before anything else** — a suite that silently tested the shadowed implementation would have passed against the defect.

Two controls are worth naming. **NC-E** could not bite at first: a t2v package is kept empty by *two* independent mechanisms, and the control had only defeated one. It now defeats both, including the falsy-zero bug (`+limit || rows.length` reading a real limit of 0 as "no limit stated") — and the positive suite pins the second enforcer explicitly. **NC-I** guards a mistake made during this batch rather than one found in the product.

---

## 17. Dogfood Pass #1 mapping

| Finding | Outcome |
|---|---|
| §29 T2V reachability | **FIXED** |
| §26 prompt limit mismatch (1,991/2,000 vs 4,894/7,000) | **FIXED** |
| §26 confusing character-grounding note in FLF | **FIXED** |
| H3 keyframe / waypoint controls | **FIXED** — repaired into the live path, not hidden |
| §27.2 availability vocabulary | **RUNTIME ALREADY CORRECT**; one chip label corrected |
| §25 editorial 7.95s vs generation duration | **NO ACTION — source invalidated the assumption**; already refuses with a named replacement |
| §29 FLF chosen because two frames exist | **PARTIALLY FIXED** — the dead creator-choice guard now fires; the recommendation UX is deferred |
| §29–31 R2V first-class + directing layer | **SUBSTRATE DELIVERED** — ordered waypoints with per-beat direction now reach the provider. The directing workspace is the creator-workspace batch. |
| §24 FLF not visually explained, §23 hidden Generate | **CREATOR WORKSPACE** |
| §14.3 "Review all with AI" sees no attempts | **PRODUCTION-STATE HONESTY** — cause confirmed at `automation.js:615` (§19) |
| §17/§18 paid retry explainability | **PRODUCTION-STATE HONESTY** |

**No visual redesign was performed.** Only runtime truth changed; where a surface still reads badly, it still reads badly.

---

## 18. Explicit exclusions and known risks

- **`wan-2.7` is hidden from the motion picker** by `motion-sound-composer.js`'s `SUPPORTED_FAMILIES` filter, contradicting `guidedVideoProfileOptions`' documented rule that an unwired target *"stays VISIBLE and stops being SELECTABLE"*. None of `wan-2.7` is dispatchable, so this is a **catalogue-visibility** inconsistency and not an execution-truth defect. Recorded, not fixed, to keep this batch to execution truth.
- **The preview and the package cannot diverge**, by construction: the delegation was placed *inside* `gatherMotionReferences607`, which is the single function both `motionReferenceBudget` (the on-screen package preview) and `guidedMotionReferences607` (the compiled package) call. Placing it one level up, in `guidedMotionReferences607` alone, would have left the preview showing a different package from the one that ships — worth stating because that was the tempting one-line version of this fix.
- **12 functions remain SHADOWED** (§5.1). Each was inspected; none was found to consume state a live control writes. That is an inspection result, not a proof — the same class of defect could exist in one of them and this batch did not exhaustively drive all twelve.
- **`shotDur(s)` returns 5 for a shot storing 7.95** (§12). Planning-side, untouched.
- **The `check:browser-real` flake is unfixed** (§2.1) and will fail intermittently under a loaded gate until the Activity drawer stops rebuilding its markup on every poll.
- Blocking revision, candidate correction and entity-reference image generation still run the pre-C2b path (§9).

---

## 19. Production-State Honesty reconnaissance (read-only)

No source was modified for this. Four findings, each with an owner:

1. **`awaiting-review` is counted as ACTIVE.** `live-activity.js:254` and `:302` — `["running","awaiting-review"].includes(run.status)` drives both the global *"Activity · N active"* count and the drawer's **"ACTIVE NOW"** section. A run paused for a human decision is reported as work in progress. One predicate conflates *machine running* with *waiting for a human*.
2. **Elapsed timers keep counting on human-gated steps.** `v641ElapsedLabel(startedAt, completedAt)` falls back to `Date.now()` when `completedAt` is absent, and `V641_ACTIVITY_TIMER` re-ticks every 3.5 s. A run waiting overnight reports hours "elapsed" as though it were working. Same root cause as (1).
3. **The per-step markup is already honest.** `v641StatusTone` maps `needs-review`/`awaiting-review` → `review` (`!`) and only `running` → `active` (spinner). The defect is in the *aggregate* and the *section header*, not the step — which makes it a small, well-bounded repair.
4. **`blockingFrameId` partitioning confirmed.** `automation.js:615` returns only rows with **no** `blockingFrameId` when no target is given, and `:1391` sets that field on assignment. Once a blocking guide is assigned to a frame it leaves the unpartitioned view — the cause C2 named for "Review all with AI sees no attempts", with no identity component, exactly as C4 found.

Plus the drawer-churn defect from §2.1, which lives in the same file as (1)–(3) and would be repaired alongside them.

**Proposed boundary:** one predicate for *machine-active* versus *waiting-for-human*, applied to the count, the section header and the elapsed label; a drawer that patches rather than rebuilds; and the `blockingFrameId` partition. That is a contained batch in two files.

---

## 20. Product-direction consequences

1. **A creator can now direct a multi-frame shot and have it obeyed.** Activating beats, ordering them and writing what each represents produces a provider request that carries exactly that. Before, it produced a one-frame request.
2. **R2V is a real substrate now, not an aspiration.** Ordered waypoints with per-beat direction reach `reference_image_urls[0..n]`. The directing workspace the dogfood asked for can be built on something that works.
3. **Text-to-video exists.** A shot needing no visual authority has a route, and it does not demand an approved still first.
4. **A prompt is no longer refused at a limit that was retired.** Direction between 2,000 and 7,000 characters is now sendable, which is most of a detailed motion brief.
5. **Grounding advice can be followed.** No creator is told to attach a reference the selected route cannot hold, and none is left unaware that their character's name was replaced.
6. **Dogfood Pass #2 should specifically test:** a three-beat H3 multi-frame shot end to end; a T2V shot with no approved frames; a motion prompt deliberately pushed past 2,000 characters; and an FLF shot with two named characters, checking the grounding note.

---

## 21. Recommended next batch

**Production-State Honesty**, scoped by §19. It is the last thing between the current build and a creator who can trust what the interface tells them about work in flight — and it is a two-file repair with its root causes already identified.

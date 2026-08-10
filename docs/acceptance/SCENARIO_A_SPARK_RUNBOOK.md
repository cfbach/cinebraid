# Scenario A — live paid acceptance on the Spark

**Runbook for the Claude Code instance running on the Spark.** Written 2026-08-09 by the
session that produced PR #41 (`fix/reference-review-contract`), for a successor that will not
have that conversation. Everything needed is here.

This is a **real-money run against real providers.** Read the whole document before the first
command. Nothing in it is optional, and several steps are stop gates: if one fails, you stop and
report, you do not work around it.

Delete this file before merging the PR, or keep it under `docs/acceptance/` as the record — the
operator's call, not yours.

---

## 1. What this run is for

PR #41 repairs the reference-review contract. Four defects were found in a real dogfood run of
Mara Venn / "Rain-soaked arrival · Exterior arrival" that scored 45/72/58, then 35/78/82, then
42/78/68:

- **A — circular authority bootstrap.** The workflow whose purpose was to create Mara's first
  approved reference was blocked for having no approved reference to compare against.
- **B — workflow prerequisites in the generation loop.** "No approved authority was supplied",
  which no prompt can repair, entered the correction plan and bought another paid pass.
- **C — state semantics not reaching review or generation.** A candidate standing *inside* the
  cinema scored 82 against a state whose whole point is the exterior arrival.
- **D — rubric ownership leak.** A missing analog projector — a fact about the cinema — came
  back as a MAJOR failure under "Anatomy & required details" on a character portrait.

Deterministic coverage already exists (`npm run check:reference-contract`, plus eight negative
controls). **This run exists only to confirm the repaired contract behaves the same way against
real images and a real vision model.** If you find yourself about to spend money proving
something a deterministic test already proves, stop.

---

## 2. Hard limits — non-negotiable

| Limit | Value |
|---|---|
| Maximum FAL images | **6** |
| Maximum generation batches | **2** (3 images each) |
| Maximum vision reviews | **6** |
| FAL quality | **exactly `"low"`** |
| Video / H3 | **none** |
| Scenario B | **do not run** |
| Provider / model / config changes | **none** |

**Fail closed before POST** if any outbound FAL request has: quality missing, quality other than
`low`, an unknown quality, more than 3 images, or a pass number beyond 2. Refuse the request,
stop the run, report.

The operator authorized Scenario A **only**. When it finishes — pass or fail — you stop and
report. You do not start Scenario B. You do not "just check one more thing" with a paid call.

---

## 3. Prerequisites

- CineBraid running on the Spark, reachable on loopback (was `:3399` on the LAN as
  `192.168.68.116`; prefer `http://127.0.0.1:3399` from the Spark itself).
- The checkout serving that instance is on `fix/reference-review-contract`. **Phase 0 verifies
  this and it is the single most important gate** — the LAN instance was found serving `main`,
  which has none of the fixes and no quality guard.
- A FAL key and a vision-provider key configured in Settings.

**Credentials are never yours to enter.** If the instance asks for a LAN passcode, the operator
signs in — you do not type a password into a field, even when asked to. On loopback the passcode
may not apply; check rather than assume.

---

## 4. Phase 0 — verify the build (STOP GATE)

Run this in the page context (Browser pane `javascript_tool`, or any authenticated context):

```js
(async () => {
  const t = async (u) => (await fetch(u, {credentials:'same-origin'})).text();
  const auto = await t('/automation.js'), rev = await t('/review.js'), ent = await t('/entities.js');
  return JSON.stringify({
    PR41_qualityGuard:  auto.includes('v667AssertRequestQuality'),
    PR41_champion:      auto.includes('v666Champion'),
    PR41_requiredPin:   auto.includes('requiredQuality: String(generationSettings.frameQuality'),
    PR41_actionability: auto.includes('V666_ACTIONABILITY'),
    PR41_contextFactor: rev.includes('Setting & context'),
    PR41_contractV3:    ent.includes('reference-authority-v3'),
    MAIN_oldAnatomy:    rev.includes('Anatomy & required details'),
    MAIN_contractV2:    ent.includes('reference-authority-v2')
  }, null, 2);
})()
```

**Required:** every `PR41_*` is `true` and every `MAIN_*` is `false`.

Anything else → **STOP.** The server is serving the wrong build. Report it and ask the operator
to deploy the branch and restart. Do not spend money against `main`: it will reproduce all four
defects, it has no `v667AssertRequestQuality`, and the instance default quality was observed as
`medium` — so nothing would refuse a medium-tier paid request.

---

## 5. Phase 1 — verify the paid path (STOP GATE)

```js
(async () => {
  const r = await fetch('/api/generation/fal/status', {credentials:'same-origin'});
  return JSON.stringify({status: r.status, body: await r.json()}, null, 2);
})()
```

**Required:** `enabled: true`, `configured: true`, `keySource` present, `textModel:
"openai/gpt-image-2"`.

Note `defaults.frameQuality` in the response. On the LAN instance it was **`medium`** at `2k`.
That is fine — Phase 4 overrides it explicitly — but you must *see* it, because it is exactly
what would leak into a request if the override silently failed.

Also confirm a vision provider is configured. If reviews cannot run, the run answers nothing:
stop before generating.

---

## 6. Phase 2 — the Mara Venn fixture

The run needs a character with a base state carrying a **name**, a **scene/shot scope**, and a
**real delta**, plus a **sibling state deriving from it**. Without the sibling, questions 4 and 5
are unanswerable.

Check first:

```js
(async () => {
  const p = await (await fetch('/api/project', {credentials:'same-origin'})).json();
  const m = (p.characters||[]).find(c => /mara/i.test(c.name||'') || c.id==='MARA');
  return JSON.stringify(m ? {
    id:m.id, name:m.name, approvedFile:m.approvedFile,
    states:(m.continuityStates||[]).map(s=>({id:s.id,name:s.name,appliesTo:s.appliesTo,isDefault:!!s.isDefault,parentStateId:s.parentStateId||'',approvedFile:s.approvedFile||'',notes:s.notes}))
  } : {missing:true}, null, 2);
})()
```

Required shape — create or complete it if it differs. **`approvedFile` must be empty everywhere**
for Mara: that emptiness *is* the first-authority condition under test.

```jsonc
{
  "id": "MARA",
  "name": "Mara Venn",
  "block": "Field investigator, late thirties, close-cropped dark hair, long dark raincoat, thin pale scar through the left eyebrow.",
  "creationDescription": "Mara Venn, field investigator, arriving soaked at night in heavy rain outside the cinema.",
  "driftNotes": "The scar through the left eyebrow must stay visible.",
  "approvedFile": "",
  "continuityStates": [
    {
      "id": "state-default",
      "name": "Rain-soaked arrival",
      "appliesTo": "Exterior arrival",
      "isDefault": true,
      "approvedFile": "",
      "notes": "Outside the cinema in heavy rain: raincoat visibly soaked and beaded, hair wet and flat to the head, exterior rainy street readable behind her."
    },
    {
      "id": "state-damp-inside",
      "name": "Damp inside",
      "appliesTo": "Interior lobby",
      "parentStateId": "state-default",
      "generationMode": "derive",
      "approvedFile": "",
      "notes": "Now inside the cinema lobby. Coat and hair remain wet; the interior lobby dominates and rain is only visible through the doors behind her."
    }
  ]
}
```

The project also needs `meta.world.include` set to something location-scoped so defect D is
observable. Use `"period analog projection equipment"`, with
`meta.world.setting = "A failing 1970s repertory cinema in a rain-soaked northern town."`

**Use a disposable project.** Do not run this against real work. See
`CINEBRAID_CONFIG_PATH` / `CINEBRAID_PROJECTS_ROOT` if you need a sandbox instance.

**Trap — `SAVE_CHAIN` latches.** One rejected `PUT /api/projects/<slug>/project` (422/409/428)
makes every later save throw "Project validation failed", including from inside generation
dialogs. Only a genuine `location.reload()` clears it — a `#hash` navigation does not reload.
If you edit the project, verify the save returned 200 before going further.

---

## 7. Phase 3 — install the paid-safety interceptor (MANDATORY)

Install this **before** opening the automation modal, and never reload the page afterwards —
a reload removes it. It is both the hard guard and the receipt log.

```js
(() => {
  if (window.__A) return 'already installed';
  const A = window.__A = {
    MAX_IMAGES: 6, MAX_BATCHES: 2, PER_BATCH: 3, QUALITY: 'low',
    images: 0, batches: 0, reviews: 0, receipts: [], reviewLog: [], refusals: []
  };
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = ((init && init.method) || 'GET').toUpperCase();

    if (url.includes('/api/generation/fal/jobs') && method === 'POST') {
      let body = {};
      try { body = JSON.parse((init && init.body) || '{}'); } catch {}
      const count = Number(body.outputCount || 0);
      const stop = (why) => {
        A.refusals.push({ why, at: new Date().toISOString(), quality: body.quality, count, batchWouldBe: A.batches + 1 });
        throw new Error('PAID SAFETY REFUSAL — ' + why);
      };
      if (body.quality !== A.QUALITY) stop(`quality is ${JSON.stringify(body.quality)}, must be "${A.QUALITY}"`);
      if (!(count > 0 && count <= A.PER_BATCH)) stop(`outputCount ${count}, must be 1..${A.PER_BATCH}`);
      if (A.batches + 1 > A.MAX_BATCHES) stop(`this would be batch ${A.batches + 1}, max ${A.MAX_BATCHES}`);
      if (A.images + count > A.MAX_IMAGES) stop(`this would reach ${A.images + count} images, max ${A.MAX_IMAGES}`);
      if (/h3|video/i.test(String(body.purpose || '') + String(body.model || ''))) stop('video/H3 is not authorized');

      A.batches += 1; A.images += count;
      A.receipts.push({
        pass: A.batches, at: new Date().toISOString(),
        endpoint: '/api/generation/fal/jobs', model: 'openai/gpt-image-2', purpose: body.purpose,
        entity: body.entityId, state: body.continuityStateName || body.continuityStateId,
        count, quality: body.quality, resolution: body.resolution, aspectRatio: body.aspectRatio,
        cumulativeImages: A.images, promptChars: String(body.prompt || '').length,
        prompt: String(body.prompt || '')
      });
      console.log('[ACCEPTANCE RECEIPT]', JSON.stringify(A.receipts.at(-1), null, 2));
    }

    if (url.includes('/api/llm/review-entity-candidate') && method === 'POST') {
      A.reviews += 1;
      if (A.reviews > A.MAX_IMAGES) {
        A.refusals.push({ why: `review ${A.reviews} exceeds max ${A.MAX_IMAGES}`, at: new Date().toISOString() });
        throw new Error('PAID SAFETY REFUSAL — review cap exceeded');
      }
      let b = {}; try { b = JSON.parse((init && init.body) || '{}'); } catch {}
      const res = await realFetch(input, init);
      const clone = res.clone();
      clone.json().then((d) => {
        A.reviewLog.push({
          n: A.reviews, file: b.fileName, stateId: b.stateId,
          authorityMode: d && (d.authorityMode || (d.review && d.review.authorityMode)),
          requiredHardChecks: d && d.requiredHardChecks,
          relatedStates: d && d.relatedStates && d.relatedStates.map(r => r.name),
          review: d && d.review
        });
      }).catch(() => {});
      return res;
    }

    return realFetch(input, init);
  };
  return 'installed';
})()
```

Verify it took: `window.__A && typeof window.fetch === 'function'` and `window.__A.MAX_IMAGES === 6`.

---

## 8. Phase 4 — configure the run and verify the pin (STOP GATE)

`stateRounds` is hard-coded to 3 in `startPlannedEntityAutomation`, and the default-reference
modal does **not** set `draft.maxImages` — it falls back to `states × 3 × outputs = 9`. Nine is
more than authorized. Setting `maxImages = 6` makes the product's own credit guard refuse the
third batch, which is how "max 2 passes" is enforced by the shipped code rather than by you.

```js
(() => {
  openAssetAutomationModal('characters', 'MARA');           // scope: default-only
  const q = document.getElementById('entity-auto-frame-quality');
  const o = document.getElementById('entity-auto-outputs');
  const r = document.getElementById('entity-auto-frame-resolution');
  if (!q || !o) return 'MODAL CONTROLS NOT FOUND — stop';
  q.value = 'low';
  o.value = '3';
  if (r) r.value = '1k';
  v6211SyncGenerationControls('entity');                     // pushes the controls into the draft
  const d = window._v626EntityAutomationDraft;
  d.maxImages = 6;                                           // authorized ceiling, not the modal's 9
  return JSON.stringify({
    scope: d.scope, list: d.list, id: d.id, stateIds: d.stateIds,
    outputsPerRequest: d.outputsPerRequest, maxImages: d.maxImages,
    frameQuality: d.generationSettings.frameQuality,
    frameResolution: d.generationSettings.frameResolution
  }, null, 2);
})()
```

**Required before START:** `frameQuality: "low"`, `outputsPerRequest: 3`, `maxImages: 6`,
`stateIds: ["state-default"]`, `scope: "default-only"`.

Anything else → **STOP**, do not click START.

---

## 9. Phase 5 — pre-flight receipt, then start

Record and report, before the first paid request:

```
pass 1 of max 2 | endpoint /api/generation/fal/jobs | model openai/gpt-image-2
images 3 | quality low | resolution 1k | cumulative 0 -> 3 | ceiling 6
```

Then start:

```js
startPlannedEntityAutomation()
```

Immediately confirm the run pinned the tier — this is the PR #41 guarantee:

```js
(() => {
  const runs = v626Runs().filter(r => r.type === 'entity-chain');
  const r = runs.at(-1);
  return JSON.stringify({ id: r.id, requiredQuality: r.config.requiredQuality,
    frameQuality: r.config.generationSettings.frameQuality,
    maxImages: r.config.maxImages, outputsPerRequest: r.config.outputsPerRequest,
    stateRounds: r.config.stateRounds }, null, 2);
})()
```

`requiredQuality` must be `"low"`. If it is empty or anything else, **stop the run
immediately** (`archiveAutomationRun(<id>)`) and report.

---

## 10. Phase 6 — observe, do not interfere

Poll; do not click anything in the run UI. The loop is client-side and will pause itself at the
human gate.

```js
(() => {
  const r = v626Runs().filter(x => x.type === 'entity-chain').at(-1);
  const passes = (r.result && r.result.referencePasses) || [];
  return JSON.stringify({
    status: r.status, stage: r.stage,
    images: window.__A.images, batches: window.__A.batches, reviews: window.__A.reviews,
    refusals: window.__A.refusals,
    passes: passes.map(p => ({
      pass: p.passNumber, best: p.bestScore, passed: p.passed,
      authorityMode: p.authorityMode, readyToEstablish: p.readyToEstablish,
      candidates: (p.candidates||[]).map(c => c.file + ' ' + c.score + (c.pass?' PASS':' FLAG')),
      correct: (p.correct||[]).map(c => c.label),
      prerequisites: (p.prerequisites||[]).map(c => c.label),
      decisions: (p.decisions||[]).map(c => c.label)
    })),
    champions: r.result && r.result.referenceChampions,
    exhaustion: r.result && r.result.referenceExhaustion,
    prerequisitesBlock: r.result && r.result.referencePrerequisites,
    approvedFile: (P.characters.find(c=>c.id==='MARA')||{}).approvedFile
  }, null, 2);
})()
```

The run is finished when `status === 'awaiting-review'`.

**`approvedFile` must stay `""` throughout.** If automation ever approves on its own, that is a
severe failure — record it and report.

---

## 11. The ten questions this run must answer

1. Does first-authority review operate in `ESTABLISH_AUTHORITY` mode?
   → `reviewLog[].authorityMode === 'establish'`, `requiredHardChecks === []`.
2. Is the absence of an approved Mara authority treated as expected — no score penalty, no
   correction? → no blocker with `actionability: 'generation-correctable'` mentioning authority;
   nothing about authority in `passes[].correct`.
3. Does the generation prompt carry the full state intent? → the captured
   `receipts[].prompt` must contain **`Rain-soaked arrival`**, **`Exterior arrival`**, and the
   delta text. *(On `main` all three are absent — verified 2026-08-09 against a live `main`
   server. Their presence is the fix working.)*
4. Does the reviewer distinguish Exterior arrival from the sibling Damp inside?
   → `reviewLog[].relatedStates` contains `Damp inside`; `review.stateMatch` is populated.
5. An interior-but-wet candidate must **not** strong-pass, should ideally name `Damp inside` in
   `stateMatch.closerState`, and must never be silently reassigned (`targetStateId` unchanged).
6. Is setting/context judged under `context`, never under `requirements`/anatomy?
   → inspect `review.categories`.
7. A genuine correctable fault must enter `passes[1].correct` and be addressed in pass 2.
8. If the only thing left is a human decision or a prerequisite, the run **stops** rather than
   buying pass 2.
9. A ready-to-establish candidate → generation stops, human gate, no auto-approve, remaining
   pass unspent.
10. If pass 2 runs: pass-1 best preserved, correction plan shown, exactly 3 new images, exactly
    3 reviews, champion retained across both.

---

## 12. Evidence to report

- **A.** Every receipt: pass, endpoint/model, count, quality, resolution, cumulative.
  (`window.__A.receipts`)
- **B.** Pass 1: all scores/statuses, review reasons, authority mode, state/context reading.
- **C.** If pass 2 ran: aggregated correctable findings, the correction plan, the pass-1 → pass-2
  prompt delta (`passes[].promptDelta`), all pass-2 scores.
- **D.** Best-so-far candidate and why (`referenceChampions`).
- **E.** Whether an interior/Damp-inside-looking candidate was correctly refused for Exterior
  arrival.
- **F.** Whether missing prior authority caused **any** penalty, FLAG, correction, or paid retry.
- **G.** Whether any location/context requirement appeared under an anatomy criterion.
- **H.** Totals: batches, images, reviews.
- **I.** **VERDICT: PASS / FAIL.**

Report honestly. A defect found here is the run doing its job. Do not soften a FAIL, and do not
report a question as answered if the evidence does not answer it.

---

## 13. Known traps

- **Reload kills the interceptor.** Reinstall and restart from Phase 3 if the page reloads. Any
  images already generated still count against the 6.
- **`#hash` navigation does not reload.** Use `location.reload()` when you genuinely need one.
- **`SAVE_CHAIN` latches on one rejected save.** See Phase 2.
- **Screenshots / `read_page` may be blocked** on a plain-`http` LAN origin; `javascript_tool`
  still works and is sufficient. On loopback this may not apply.
- **Rendered casing** is CSS `text-transform` — match on the DOM's real text, not what you see.
- **Capability lists are alphabetised, not ranked** — never read `[length-1]` as "best".

## 14. Never

- Enter a passcode, API key, or token into any field. The operator does that.
- Change provider, model, or configuration to make something work.
- Generate video or H3.
- Run Scenario B.
- Exceed 6 images or 6 reviews.
- Retry at medium or high quality.

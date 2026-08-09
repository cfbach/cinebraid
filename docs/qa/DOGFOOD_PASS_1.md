# Dogfood pass 1 — one scene, three or four shots

The first hands-on run of the capability-aware generation slice, on a disposable
build, by the person the product is for.

This is not a test plan to be passed. It is a record of what it is like to make a
scene in CineBraid today. A step that works but feels wrong is a finding. A step you
had to think about twice is a finding.

**Budget it at 90 minutes.** One real paid image (a few cents) and one real paid
video. Nothing else costs money.

---

## Before you start

### 1. Build the disposable environment

```bash
npm run dogfood:sandbox
```

That creates `../CineBraid-Dogfood` beside the repository: a copy of the sample
project, its own `config.json`, and nothing else. It is a copy — editing it cannot
reach your real projects, and the script refuses to build inside the repository.

### 2. Start it

```powershell
$env:CINEBRAID_CONFIG_PATH="C:\CineBraid\CineBraid-Dogfood\config.json"
$env:CINEBRAID_PROJECTS_ROOT="C:\CineBraid\CineBraid-Dogfood\projects"
$env:PORT=3399
npm start
```

Open **http://127.0.0.1:3399**. Stop with **Ctrl+C** in that terminal.

Both environment variables must be set. `CINEBRAID_PROJECTS_ROOT` sets a *default*
that a saved `workspace.projectRoot` overrides — the separate config path is what
makes the isolation hold.

### 3. Reset at any point

```bash
node scripts/qa-sandbox.js --out ../CineBraid-Dogfood --demo --force
```

Deletes and rebuilds it. Nothing is preserved, which is the point.

### 4. Turn on what this pass needs

In **Settings**:

- **fal image generation** — on, with your key. This is the only paid thing here.
- **Assistant provider** — leave at `none` unless you are also exercising Nemotron
  (see the last section).

Leave every other provider off. If a model claims to be unavailable, that claim is
part of what is being tested.

### 5. Keep this open

A notes file, or paper. Write as you go, not afterwards — the friction you notice
in the moment is the finding, and it is gone ten minutes later.

---

## Recording what you find

Four buckets. Put every observation in exactly one:

| | |
|---|---|
| **BROKEN** | It did not work, or it did the wrong thing. |
| **CONFUSING** | It worked, and I could not tell what it was going to do, or why. |
| **ANNOYING** | It worked, I understood it, and it was tedious or repetitive. |
| **MISSING** | I wanted to do something and there was no way to. |

For each one, record:

- **What I expected**
- **What happened**
- **Screenshot** (Win+Shift+S) if it is visual
- **Severity** — blocks / slows / irritates
- **Does this stop me making the film?** — yes / no

That last question is the one that decides what gets fixed next. Answer it honestly
even when the answer is "no, but I hated it".

---

## The pass

### 1. Launch

Start the disposable build and open it.

> Before you click anything: **do you know what CineBraid wants you to do next?**
> Write down what you think the first step is, then find out whether you were right.

### 2. Open real project material

Open the dogfood sample, or import your own scene. If you import, note how long it
took and what you had to fix by hand afterwards.

### 3. Inspect the Project Bible

Open **Project Bible** from the rail.

> Does this look like *your* production? Is anything in it wrong, stale, or invented?

### 4. Open one scene

Pick a scene with three or four shots. Work only in that scene for the rest of this
pass.

### 5. Shot 1 — a blocking frame with no references

Open the shot → **Look & blocking** → build the blocking prompt → **GENERATE**.

Stop at the dialog. Do not generate yet.

> - Does the compiled prompt resemble the shot you intended?
> - **Nine blocking choices — helpful, or clutter?**
> - Do you understand why exactly one of them is usable?
> - Would you rather close CineBraid and use fal directly right now? Why?

Close the dialog.

### 6. Shot 2 — one character reference

Attach one approved character reference. Open the blocking dialog again.

> - Did the reference CineBraid selected make sense?
> - Does the dialog say what that reference is *for*?

### 7. Shot 3 — two characters and a location

Same again with more attached.

> - Are the references in a sensible order, and does order appear to mean anything?
> - Is anything you attached missing from the dialog?

### 8. Shot 4 — characters, location and a prop

The fullest case.

> - Is the compiled prompt still readable at this size?
> - **Are you entering the same information twice** anywhere in steps 5–8?

### 9–10. Verify, then generate one real image

Pick whichever of the four shots you would actually want to see. Open its dialog and
**read it properly before spending anything**:

- the compiled prompt says what you meant
- the reference list is the one you intended
- size and quality are what you want — **try `quality: low`**
- the number of options is what you want

> - **Is `quality: low` good enough for blocking?** This decides whether blocking is
>   cheap enough to use freely, which is the whole premise.
> - Are the sizes understandable? Do you know which to pick, and why?

Then press **GENERATE**. Once.

### 11–12. Review and approve

Look at what came back. Approve one.

> - Did you get what the prompt described?
> - **Do you trust the approval state?** After approving, is it obvious which image
>   is now canon and which are discarded?

### 13–14. Animate the approved frame with H3

Go to **Motion & sound** and animate the frame you approved. Review the result.

> - **Does H3 animation feel connected to the frame workflow**, or like a separate
>   tool that happens to be in the same app?
> - Did it use the frame you approved, or did you have to tell it which one?

### 15. Run Nemotron continuity

Only if the Nemotron endpoint is configured and running (see below). Otherwise skip
and record it as skipped.

> - **Are the findings actionable, or noise?**
> - **Can you dismiss a finding you do not care about?** Try. Does it stay dismissed?

### 16. Switch projects and come back

Deliberately switch to another project, then return to this scene.

> - Are you where you left off?
> - Is anything lost, reset, or silently changed?

### 17. Close CineBraid

Ctrl+C in the terminal. Note anything alarming on the way out.

### 18. Come back later

**Leave it at least an hour.** Ideally the next morning — the point is to arrive
without the working memory you had during the pass.

Reopen it and answer, before clicking anything:

> - **Can you tell where you left off?**
> - Which shots are finished? Which are waiting for you? What is next?
> - **Can you recover the thread** — or do you have to reconstruct it?

If you cannot answer those in under a minute, that is the single most important
finding in this document.

---

## Nemotron continuity, if you want step 15

The integration path has not changed and has not been exercised by hand yet. It is
configured in **Settings → Assistant**, in the *Continuity analysis* block near the
bottom of that section — not in a continuity screen of its own, which is the first
place most people look:

| Field | Value |
|---|---|
| Continuity provider | `Custom / OpenAI-compatible server` |
| Continuity endpoint | your vLLM base URL, e.g. `http://127.0.0.1:8000/v1` |
| Continuity model | the served model name, e.g. `nemotron_3_nano_omni` |

It is configured separately from general vision on purpose: continuity sends exactly
one image per request, and it does not require the main assistant to be a custom
server. You can leave **AI provider** at `none` and still run continuity.

Blank endpoint means it inherits the general custom provider's URL and key. Set it
explicitly if continuity is pointed somewhere different from the general assistant —
which is the intended Spark arrangement.

On the DGX Spark, the vLLM server must be serving the Nemotron weights on an
OpenAI-compatible `/v1` endpoint before CineBraid can use it, and if CineBraid is on
your desktop the port needs forwarding:

```bash
ssh -N -L 8000:127.0.0.1:8000 <your-spark-ssh-target>
```

Then **Settings → Test connection**. CineBraid sends `enable_thinking: false` to
custom providers, which is what stops a reasoning server spending its whole token
budget on reasoning and returning empty content — you do not need to configure that.

`/v1/embeddings` returning 404 from the Nemotron deployment is expected and
harmless; semantic search asks Ollama separately.

---

## When you are done

1. Save your notes next to the screenshots.
2. Stop the server.
3. Delete `../CineBraid-Dogfood`, or leave it — nothing outside it was touched.

Then answer one last question:

> **After this pass, is CineBraid something you would use to make your next scene —
> or something you would work around?**

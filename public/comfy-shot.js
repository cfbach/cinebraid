/* Local ComfyUI, on a shot.
 *
 * This adds ONE control and ONE state strip to the generation area a frame prompt
 * already has — beside the paid GENERATE button, in the same card, under the same
 * heading. There is deliberately no ComfyUI workspace, no ComfyUI tab and no second
 * place a filmmaker generates from: a shot has one place where work is ordered, and a
 * backend is a choice made there rather than a room you go to.
 *
 * WHAT THE FILMMAKER MUST BE ABLE TO SEE BEFORE PRESSING ANYTHING
 *
 *   which workflow will run, and that they may change it;
 *   whether its inputs are still valid, in words, before it can be pressed;
 *   that this costs nothing at a provider, stated rather than implied by absence;
 *   what the run is doing — queued, running, returned or failed;
 *   the result, through the Returned Result path they already use.
 *
 * The last one is the point of the whole integration and is why nothing here renders a
 * result: a delivered candidate is an ordinary CineBraid candidate on an ordinary shot,
 * and the review surface must not be able to tell which backend produced it.
 */

/* Everything the shot side needs to know, fetched rather than guessed, and refreshed on
   the actions that could change it. Held here so a render is never blocked on a folder
   read or a network probe. */
const COMFY_SHOT = { workflows: [], jobs: [], loadedWorkflows: false, loadedJobs: false, polling: null };

function comfyShotConfigured() {
  const comfy = (typeof CONFIG === "object" && CONFIG && CONFIG.generation && CONFIG.generation.comfy) || {};
  return comfy.enabled === true && Boolean(String(comfy.workflowFolder || "").trim());
}

/* Workflows a shot may actually run: registered, executable, and either matching the
   mapping they were confirmed against or changed in a way that still fits. A `broken`
   workflow is deliberately absent from this list — the Settings panel is where it is
   repaired, and offering it here would be offering a press that must then refuse. */
function comfyRunnableWorkflows() {
  return (COMFY_SHOT.workflows || []).filter((row) => row.executable && (row.state === "ready" || row.state === "changed"));
}

async function loadComfyWorkflows(force = false) {
  if (COMFY_SHOT.loadedWorkflows && !force) return COMFY_SHOT.workflows;
  try {
    const response = await fetch("/api/generation/comfy/workflows");
    const data = await response.json().catch(() => ({}));
    COMFY_SHOT.workflows = response.ok && Array.isArray(data.workflows) ? data.workflows : [];
  } catch {
    COMFY_SHOT.workflows = [];
  }
  COMFY_SHOT.loadedWorkflows = true;
  return COMFY_SHOT.workflows;
}

async function loadComfyJobs() {
  try {
    const response = await fetch("/api/generation/comfy/jobs");
    const data = await response.json().catch(() => ({}));
    COMFY_SHOT.jobs = response.ok && Array.isArray(data.jobs) ? data.jobs : [];
  } catch {
    COMFY_SHOT.jobs = [];
  }
  COMFY_SHOT.loadedJobs = true;
  return COMFY_SHOT.jobs;
}
window.loadComfyJobs = loadComfyJobs;

function comfyJobFor(shotId, frameId) {
  const rows = (COMFY_SHOT.jobs || []).filter((job) => String(job.shotId) === String(shotId) && String(job.frameId || "") === String(frameId || ""));
  return rows.length ? rows[rows.length - 1] : null;
}

const COMFY_ACTIVE_STATUSES = ["SUBMITTING", "SUBMITTED", "IN_QUEUE", "IN_PROGRESS"];
function comfyJobActive(job) {
  return COMFY_ACTIVE_STATUSES.includes(String(job?.status || ""));
}
/* Filmmaker words for a machine's state. "IN_QUEUE" is a status; "Waiting in ComfyUI's
   queue" is what is happening. */
function comfyJobWords(job) {
  const status = String(job?.status || "");
  if (status === "COMPLETED") return job.ingestedAt ? "Returned — ready to review" : "Finished";
  if (status === "FAILED") return "Failed";
  if (status === "IN_PROGRESS") return "Running in ComfyUI";
  if (status === "IN_QUEUE") return Number(job?.queuePosition) > 0 ? `Waiting in ComfyUI's queue · position ${job.queuePosition}` : "Queued in ComfyUI";
  return "Sending to ComfyUI";
}

/* ---------------------------------------------------------------------------
   The two things the frame card renders. */

/* The action, beside the paid one. A chip by default, because on the surfaces that draw
   both the shot's established path is the primary one and this is an alternative.
   `options.primary` is for the frame execution block, where the filmmaker has already
   CHOSEN local and the chosen path owns the leading action — and where `options.workflow`
   carries the workflow the card was previewing, so the dialog opens on the same one
   rather than resetting to whatever sits first in the list. */
window.comfyPromptAction = (shotId, frameId, buildId, options = {}) => {
  if (!comfyShotConfigured()) return "";
  if (!COMFY_SHOT.loadedWorkflows) setTimeout(() => loadComfyWorkflows().then(() => { if (typeof route === "function") route(); }), 0);
  const runnable = comfyRunnableWorkflows();
  if (!runnable.length) return "";
  const workflow = String(options.workflow || "");
  const classes = options.primary ? "approve-btn comfy-generate-btn" : "chip comfy-generate-btn";
  return `<button class="${classes}" onclick="openComfyGenerationModal('${attr(shotId)}','${attr(frameId || "")}','${attr(buildId || "")}','${attr(workflow)}')">GENERATE LOCALLY</button>`;
};

/* ---------------------------------------------------------------------------
   WHAT THIS BACKEND IS, IN THE GENERIC SLOTS A FRAME'S EXECUTION BLOCK DRAWS.
 *
 * The frame card asks every available backend the same four questions — who runs it,
 * what will it run, is that ready, and what will a provider charge — and draws the
 * answers in one scan. This answers them for local ComfyUI out of the registry the
 * shot side already holds, and invents nothing: `unit` is the workflow's own
 * `relativePath`, because no friendly-name field exists on it and a prompt profile's
 * name is not this workflow's name.
 *
 * IT RESOLVES NOTHING BY POSITION. With one confirmed workflow there is no choice to
 * make and it is named. With several, `unresolved` is true and the card says so rather
 * than promoting `[0]` into a claim about what is going to run — and it never reads the
 * last job's workflow, which is a record of what already ran and not a request.
 *
 * A DESCRIPTOR, NOT A PROVIDER ABSTRACTION. Nothing dispatches from here and no other
 * backend is required to fill the same fields: a backend with no mappings, no local
 * address and no workflow file answers the same four questions differently. */
window.comfyFrameExecutionPath = (chosenWorkflow = "") => {
  if (!comfyShotConfigured()) return null;
  if (!COMFY_SHOT.loadedWorkflows) setTimeout(() => loadComfyWorkflows().then(() => { if (typeof route === "function") route(); }), 0);
  const runnable = comfyRunnableWorkflows();
  if (!runnable.length) return null;
  const requested = String(chosenWorkflow || "");
  const chosen = runnable.find((row) => row.relativePath === requested)
    || (runnable.length === 1 ? runnable[0] : null);
  return {
    id: "comfy",
    backend: "Local ComfyUI",
    where: "This machine",
    paid: false,
    /* The shipped words for this route's cost, from the constant this file already
       holds — sentence-cased for a line it now starts, and not reworded. A local
       render is not free; nobody is going to bill for it, and that is all this says. */
    costWords: COMFY_SHOT_COST_WORDS.charAt(0).toUpperCase() + COMFY_SHOT_COST_WORDS.slice(1),
    unitLabel: "Workflow",
    unit: chosen ? chosen.relativePath : "",
    unresolved: !chosen,
    chooseWords: `Choose one of ${runnable.length} confirmed workflows`,
    options: runnable.map((row) => ({
      value: row.relativePath,
      label: row.relativePath,
      changed: row.state === "changed",
    })),
    /* The registry's own readiness, with the registry's own reason. A card may not
       claim "ready" over a mapping the settings panel is still calling changed. */
    readiness: chosen
      ? chosen.state === "changed"
        ? { tone: "attention", words: "Workflow changed — review mappings", detail: String(chosen.reason || "") }
        : { tone: "ready", words: "Inputs confirmed", detail: "" }
      : null,
  };
};

window.comfyGenerationInline = (shotId, frameId) => {
  if (!comfyShotConfigured()) return "";
  if (!COMFY_SHOT.loadedJobs) setTimeout(() => loadComfyJobs().then(() => { if (typeof route === "function") route(); }), 0);
  const job = comfyJobFor(shotId, frameId);
  if (!job) return "";
  const active = comfyJobActive(job);
  const done = job.status === "COMPLETED";
  const failed = job.status === "FAILED";
  if (active) comfyStartPolling(job.id);
  return `<div class="fal-job-strip comfy-job-strip ${active ? "active" : done ? "done" : failed ? "failed" : ""}" data-comfy-job="${attr(job.id)}" data-comfy-status="${attr(job.status)}">
    <div><span>${active ? '<i class="spin">◌</i>' : done ? "✓" : failed ? "!" : "·"}</span>
      <div><b>${esc(comfyJobWords(job))}</b><small>${esc(`Local ComfyUI · ${job.model || "workflow"}`)} · ${esc(COMFY_SHOT_COST_WORDS)}${job.error ? ` · ${esc(job.error)}` : ""}</small></div>
    </div>
    <div>${active ? `<button class="chip" onclick="refreshComfyGeneration('${attr(job.id)}',true)">Refresh</button>` : failed ? `<button class="chip" onclick="openComfyGenerationModal('${attr(shotId)}','${attr(frameId || "")}','')">Try again</button>` : ""}</div>
  </div>`;
};

const COMFY_SHOT_COST_WORDS = "no provider charge";

/* A local render finishes in seconds, so the strip follows it rather than waiting to be
   asked. One timer for the whole page, cleared the moment nothing is active — a poll
   that outlives its reason is the defect the activity drawer already taught this
   codebase about. */
function comfyStartPolling(jobId) {
  if (COMFY_SHOT.polling) return;
  COMFY_SHOT.polling = setInterval(async () => {
    const job = (COMFY_SHOT.jobs || []).find((row) => row.id === jobId);
    if (!job || !comfyJobActive(job)) {
      clearInterval(COMFY_SHOT.polling);
      COMFY_SHOT.polling = null;
      return;
    }
    await refreshComfyGeneration(jobId, false);
  }, 4000);
}

window.refreshComfyGeneration = async (jobId, announce = true) => {
  try {
    const response = await fetch(`/api/generation/comfy/jobs/${encodeURIComponent(jobId)}/refresh`, { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "CineBraid could not check that generation.");
    await loadComfyJobs();
    const job = data.job || {};
    if (job.ingestedAt) {
      /* The result is now an ordinary candidate on an ordinary shot. Reloading the
         project is what puts it in front of the existing review path — this file does
         not render it and must not. */
      if (typeof loadProject === "function") await loadProject();
      if (announce !== false) toast("ComfyUI returned a candidate — review it below");
    } else if (job.status === "FAILED" && announce !== false) {
      toast(job.error || "ComfyUI could not run that workflow");
    }
  } catch (error) {
    if (announce !== false) toast(error.message || "CineBraid could not check that generation.");
  }
  if (typeof route === "function") route();
};

/* ---------------------------------------------------------------------------
   The dispatch dialog. */
let COMFY_REQUEST = null;

window.openComfyGenerationModal = async (shotId, frameId = "", buildId = "", workflowPath = "") => {
  const shot = typeof shotById === "function" ? shotById(shotId) : null;
  if (!shot) return toast("That shot is no longer open");
  const frames = typeof guidedFrames === "function" ? guidedFrames(shot) : [];
  const frame = frameId ? frames.find((row) => row.id === frameId) : null;
  const build = buildId && typeof resolvePromptBuild === "function" ? resolvePromptBuild(P, buildId) : null;
  const prompt = String(build?.prompt || "").trim();
  if (!prompt) return toast("Build the prompt first");

  await loadComfyWorkflows(true);
  const runnable = comfyRunnableWorkflows();
  if (!runnable.length) {
    return openModal(`<h3>No ComfyUI workflow is set up</h3><p class="modal-confirm-message">CineBraid can reach your workflow folder, but no workflow in it has had its inputs confirmed yet. Open Settings → Integrations and tell CineBraid which node carries the prompt.</p><div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button><button class="approve-btn" onclick="closeModal();location.hash='#/settings'">OPEN SETTINGS</button></div>`);
  }

  COMFY_REQUEST = {
    shotId,
    frameId: frameId || "",
    frameLabel: frame?.label || "A",
    buildId: build?.id || "",
    prompt,
    /* THE CHOICE THE CARD WAS ALREADY SHOWING. A filmmaker who picked a workflow on
       the frame's execution block read its name, its readiness and its cost there;
       reopening the dialog on a different one would dispatch something they had not
       been shown. Honoured only when it is still runnable — a workflow that has since
       broken falls back to the list rather than to a stale press. */
    workflow: runnable.some((row) => row.relativePath === String(workflowPath || "")) ? String(workflowPath) : "",
  };
  openModal(comfyDispatchMarkup(shot, runnable, COMFY_REQUEST));
  comfyRenderWorkflowInputs();
};

/* Every image on this shot a workflow could be given, each named the way the filmmaker
   named it. All of them are CineBraid media identities; the server re-derives and
   re-contains every one before a byte is read, so this list is a convenience and never
   an authority. */
function comfyShotImages(shot) {
  const rows = [];
  const frames = typeof guidedFrames === "function" ? guidedFrames(shot) : [];
  for (const frame of frames)
    if (frame.winner)
      rows.push({ url: `/assets/shots/${shot.id}/takes/${frame.winner}`, label: `Approved frame ${frame.label} — ${frame.winner}` });
  for (const candidate of Array.isArray(shot.candidateFiles) ? shot.candidateFiles : []) {
    const name = candidate.stored || candidate.name;
    if (!name) continue;
    const url = `/assets/shots/${shot.id}/takes/${name}`;
    if (rows.some((row) => row.url === url)) continue;
    rows.push({ url, label: `${name}${candidate.decision && candidate.decision !== "unreviewed" ? ` · ${candidate.decision}` : ""}` });
  }
  return rows;
}

function comfyDispatchMarkup(shot, runnable, request) {
  const options = runnable.map((row) => `<option value="${attr(row.relativePath)}" ${row.relativePath === request.workflow ? "selected" : ""}>${esc(row.relativePath)}${row.state === "changed" ? " · changed since confirmed" : ""}</option>`).join("");
  return `<h3>Generate with local ComfyUI</h3>
    <div class="modal-sub">${esc(`${shot.id} · Frame ${request.frameLabel}`)}</div>
    <p class="modal-confirm-message">CineBraid sends this shot's prompt into a workflow you have set up, on the ComfyUI running on this machine, and brings the result back as a candidate to review.</p>
    <div class="candidate-evidence-facts">
      <article><span>Where it runs</span><b>This machine</b></article>
      <article><span>Cost</span><b>Local ComfyUI · no provider charge</b></article>
      <article><span>Result</span><b>An unapproved candidate</b></article>
    </div>
    <label class="wide"><span>Workflow</span>
      <select id="comfy-dispatch-workflow" onchange="comfyRenderWorkflowInputs()">${options}</select>
    </label>
    <div id="comfy-dispatch-state" class="hint"></div>
    <details><summary>The prompt this sends</summary><pre>${esc(request.prompt)}</pre></details>
    <div id="comfy-dispatch-inputs" class="comfy-dispatch-inputs"></div>
    <div class="modal-actions">
      <button class="cancel" onclick="closeModal()">Cancel</button>
      <button class="approve-btn" id="comfy-dispatch-go" onclick="startComfyGeneration()">GENERATE LOCALLY</button>
    </div>`;
}

/* Redrawn whenever the chosen workflow changes, because which inputs exist is a
   property of THAT workflow and of nothing else. A workflow with no image input draws
   no image control at all — an empty dropdown labelled "Start Image" would be inviting
   someone to fill in a value that has nowhere to go. */
window.comfyRenderWorkflowInputs = () => {
  const select = document.getElementById("comfy-dispatch-workflow");
  const host = document.getElementById("comfy-dispatch-inputs");
  const state = document.getElementById("comfy-dispatch-state");
  if (!select || !host || !COMFY_REQUEST) return;
  const chosen = (COMFY_SHOT.workflows || []).find((row) => row.relativePath === select.value);
  const bindings = chosen?.bindings || {};
  const shot = typeof shotById === "function" ? shotById(COMFY_REQUEST.shotId) : null;
  const images = shot ? comfyShotImages(shot) : [];

  if (state)
    state.innerHTML = chosen?.state === "changed"
      ? `<span class="settings-state-chip" data-tone="attention">Workflow changed — review mappings</span> ${esc(String(chosen.reason || ""))}`
      : `<span class="settings-state-chip" data-tone="ready">Inputs confirmed</span>`;

  const imageRow = (key, label) => {
    if (!bindings[key]) return "";
    if (!images.length)
      return `<p class="hint">This workflow takes ${esc(label)}, and this shot has no image to give it yet. It will run with whatever the workflow itself holds.</p>`;
    return `<label class="wide"><span>${esc(label)}</span><select id="comfy-input-${attr(key)}"><option value="">Leave the workflow's own image</option>${images.map((row) => `<option value="${attr(row.url)}">${esc(row.label)}</option>`).join("")}</select></label>`;
  };

  host.innerHTML = `
    ${bindings.negativePrompt ? `<label class="wide"><span>Negative prompt</span><input id="comfy-input-negativePrompt" placeholder="Leave empty to keep the workflow's own"></label>` : ""}
    ${imageRow("startImage", "Start Image")}
    ${imageRow("endImage", "End Image")}
    ${imageRow("referenceImage", "Reference Image")}
    ${bindings.seed ? `<label class="wide"><span>Seed</span><input id="comfy-input-seed" type="number" placeholder="Leave empty for the workflow's own seed"></label>` : ""}
    ${!bindings.negativePrompt && !bindings.seed && !bindings.startImage && !bindings.endImage && !bindings.referenceImage ? `<p class="hint">This workflow takes the prompt and nothing else.</p>` : ""}`;
};

window.startComfyGeneration = async () => {
  const request = COMFY_REQUEST;
  if (!request) return;
  const relativePath = String(document.getElementById("comfy-dispatch-workflow")?.value || "");
  if (!relativePath) return toast("Choose a workflow first");
  const value = (id) => String(document.getElementById(id)?.value || "").trim();
  const body = {
    shotId: request.shotId,
    frameId: request.frameId,
    frameLabel: request.frameLabel,
    buildId: request.buildId,
    relativePath,
    prompt: request.prompt,
    negativePrompt: value("comfy-input-negativePrompt"),
    seed: value("comfy-input-seed") ? Number(value("comfy-input-seed")) : null,
    references: {
      startImage: value("comfy-input-startImage"),
      endImage: value("comfy-input-endImage"),
      referenceImage: value("comfy-input-referenceImage"),
    },
  };
  const go = document.getElementById("comfy-dispatch-go");
  if (go) { go.disabled = true; go.textContent = "SENDING…"; }
  try {
    const response = await fetch("/api/generation/comfy/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "ComfyUI would not take that workflow.");
    closeModal();
    await loadComfyJobs();
    toast("Sent to local ComfyUI");
    if (typeof route === "function") route();
  } catch (error) {
    if (go) { go.disabled = false; go.textContent = "GENERATE LOCALLY"; }
    toast(error.message || "ComfyUI would not take that workflow.");
  }
};

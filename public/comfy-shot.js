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

/* The action, beside the paid one. A chip rather than the primary button, because the
   shot's established path is the primary one and this is an alternative, not a
   replacement. */
window.comfyPromptAction = (shotId, frameId, buildId) => {
  if (!comfyShotConfigured()) return "";
  if (!COMFY_SHOT.loadedWorkflows) setTimeout(() => loadComfyWorkflows().then(() => { if (typeof route === "function") route(); }), 0);
  const runnable = comfyRunnableWorkflows();
  if (!runnable.length) return "";
  return `<button class="chip comfy-generate-btn" onclick="openComfyGenerationModal('${attr(shotId)}','${attr(frameId || "")}','${attr(buildId || "")}')">GENERATE LOCALLY</button>`;
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

window.openComfyGenerationModal = async (shotId, frameId = "", buildId = "") => {
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
  const options = runnable.map((row) => `<option value="${attr(row.relativePath)}">${esc(row.relativePath)}${row.state === "changed" ? " · changed since confirmed" : ""}</option>`).join("");
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

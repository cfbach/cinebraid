/* Civitai, on a shot.
 *
 * The mirror of comfy-shot.js, and deliberately the same shape: ONE control and ONE state
 * strip in the generation area a frame prompt already has, under the same heading, in the
 * same card. There is no Civitai workspace, no Civitai tab and no second place a filmmaker
 * generates from — a shot has one place where work is ordered, and a backend is a choice
 * made there rather than a room you go to.
 *
 * WHAT IS DIFFERENT FROM COMFYUI, AND WHY IT MUST BE
 *
 * ComfyUI runs on the filmmaker's own machine and nobody bills for it. Civitai spends the
 * filmmaker's Buzz. So this file adds exactly one thing ComfyUI's has no reason to have:
 *
 *     A REAL PRICE, OBTAINED FROM THE PROVIDER, FOR THIS EXACT REQUEST,
 *     SHOWN BEFORE THE BUTTON THAT SPENDS IT, AND SITTING BESIDE THAT BUTTON.
 *
 * The dialog quotes before it can be confirmed. The confirm button is disabled until a
 * quote exists and prints the Buzz figure on its own face, so there is no press whose cost
 * the presser has not read. And the two paths keep separate controls, separate handlers
 * and separate dialogs: there is no button anywhere whose press could change from local to
 * paid.
 *
 * WHAT IT DOES NOT DO, on purpose: render a result. A delivered candidate is an ordinary
 * CineBraid candidate on an ordinary shot, and the review surface must not be able to tell
 * which backend produced it.
 */

const CIVITAI_SHOT = { status: null, loadedStatus: false, jobs: [], loadedJobs: false, polling: null };

/* The one sentence this route's cost is described by before a quote exists. It never says
   "free", never says a number, and never implies one is coming for nothing: what it says
   is where the number comes from. */
const CIVITAI_SHOT_COST_WORDS = "Paid in Buzz · priced before you confirm";

function civitaiShotConfigured() {
  const row = (typeof CONFIG === "object" && CONFIG && CONFIG.generation && CONFIG.generation.civitai) || {};
  return row.enabled === true;
}

async function loadCivitaiStatus(force = false) {
  if (CIVITAI_SHOT.loadedStatus && !force) return CIVITAI_SHOT.status;
  try {
    const response = await fetch("/api/generation/civitai/status");
    const data = await response.json().catch(() => ({}));
    CIVITAI_SHOT.status = response.ok ? data : null;
  } catch {
    CIVITAI_SHOT.status = null;
  }
  CIVITAI_SHOT.loadedStatus = true;
  return CIVITAI_SHOT.status;
}
window.loadCivitaiStatus = loadCivitaiStatus;

async function loadCivitaiJobs() {
  try {
    const response = await fetch("/api/generation/civitai/jobs");
    const data = await response.json().catch(() => ({}));
    CIVITAI_SHOT.jobs = response.ok && Array.isArray(data.jobs) ? data.jobs : [];
  } catch {
    CIVITAI_SHOT.jobs = [];
  }
  CIVITAI_SHOT.loadedJobs = true;
  return CIVITAI_SHOT.jobs;
}
window.loadCivitaiJobs = loadCivitaiJobs;

function civitaiJobFor(shotId, frameId) {
  const rows = (CIVITAI_SHOT.jobs || []).filter((job) => String(job.shotId) === String(shotId) && String(job.frameId || "") === String(frameId || ""));
  return rows.length ? rows[rows.length - 1] : null;
}

const CIVITAI_ACTIVE_STATUSES = ["SUBMITTING", "SUBMITTED", "IN_QUEUE", "IN_PROGRESS"];
function civitaiJobActive(job) {
  return CIVITAI_ACTIVE_STATUSES.includes(String(job?.status || ""));
}

/* Filmmaker words for a machine's state, and one of them is doing real work.
 *
 * UNRESOLVED is not "failed". It is the state a paid job is in when Civitai was contacted
 * and the outcome is not known — the request may have been accepted, may be rendering, and
 * may already have been charged for. Saying "failed" there invites the one action that
 * costs money twice, which is exactly why the ledger has a separate word for it. */
function civitaiJobWords(job) {
  const status = String(job?.status || "");
  if (status === "COMPLETED") return job.ingestedAt ? "Returned — ready to review" : "Finished at Civitai";
  if (status === "FAILED") return "Failed";
  if (status === "UNRESOLVED") return "Outcome not confirmed — check before generating again";
  if (status === "IN_PROGRESS") return job?.civitai?.remoteStatus === "succeeded" ? "Finished at Civitai — collecting the image" : "Running at Civitai";
  if (status === "IN_QUEUE") return "Queued at Civitai";
  return "Sending to Civitai";
}

/* What this generation cost, from the row's own recorded estimate. Buzz, said as Buzz. */
function civitaiJobCostWords(job) {
  const estimate = job?.accounting?.estimate;
  const amount = Number(estimate?.amount);
  if (!estimate || !Number.isFinite(amount)) return "Cost not recorded";
  return `${amount} Buzz`;
}

/* ---------------------------------------------------------------------------
   The two things the frame card renders. */

/* The paid action. Never the default press anywhere: on the frame execution block the
   filmmaker has already chosen Civitai, and `options.primary` is what says so. */
window.civitaiPromptAction = (shotId, frameId, buildId, options = {}) => {
  if (!civitaiShotConfigured()) return "";
  if (!CIVITAI_SHOT.loadedStatus) setTimeout(() => loadCivitaiStatus().then(() => { if (typeof route === "function") route(); }), 0);
  const status = CIVITAI_SHOT.status;
  if (!status || !status.ready) return "";
  const classes = options.primary ? "approve-btn civitai-generate-btn" : "chip civitai-generate-btn";
  return `<button class="${classes}" onclick="openCivitaiGenerationModal('${attr(shotId)}','${attr(frameId || "")}','${attr(buildId || "")}')">REVIEW PAID REQUEST</button>`;
};

/* ---------------------------------------------------------------------------
   WHAT THIS BACKEND IS, IN THE GENERIC SLOTS A FRAME'S EXECUTION BLOCK DRAWS.
 *
 * The frame card asks every available backend the same four questions — who runs it, what
 * will it run, is that ready, and what will a provider charge — and draws the answers in
 * one scan. This answers them for Civitai and invents nothing.
 *
 * THE CARD DOES NOT QUOTE. A quote is a provider call, and a card that priced itself on
 * every render would contact a paid provider because a filmmaker scrolled past a frame.
 * So `costWords` names the currency and says where the number comes from; the number
 * itself is obtained once, in the dialog, when a person has actually asked. That is the
 * same discipline the fal path keeps when it says the model is "Chosen in the paid request
 * review" rather than guessing it here.
 *
 * IT RETURNS A PATH EVEN WHEN NOT READY, so the card can say WHY. A backend that
 * disappears when its account lacks permission is a backend the filmmaker cannot discover
 * they need to fix. */
window.civitaiFrameExecutionPath = () => {
  if (!civitaiShotConfigured()) return null;
  if (!CIVITAI_SHOT.loadedStatus) setTimeout(() => loadCivitaiStatus().then(() => { if (typeof route === "function") route(); }), 0);
  const status = CIVITAI_SHOT.status;
  if (!status) return null;
  const resource = status.resourceAir || "";
  return {
    id: "civitai",
    backend: "Hosted provider · Civitai",
    where: "At Civitai",
    paid: true,
    costWords: CIVITAI_SHOT_COST_WORDS,
    costDetail: "Civitai prices this exact request before anything is submitted, and nothing is spent until you confirm that figure.",
    costKind: "quoted",
    unitLabel: "Model",
    /* The resource's own AIR, which is what Civitai calls these weights. No prompt
       profile's name is borrowed here: a compiler target is not an execution identity. */
    unit: status.resourceValid ? resource : "",
    unresolved: false,
    unitPending: status.resourceValid ? "" : "No Civitai model is set in Settings → Generation",
    options: [],
    readiness: status.ready
      ? { tone: "ready", words: "Account authorized to generate", detail: status.displayName ? `Paid by ${status.displayName}` : "" }
      : { tone: "attention", words: "Not ready", detail: String(status.reason || "") },
  };
};

/* The state strip. Identical in role to ComfyUI's, with one row it does not have: what
   this generation was quoted at, kept beside its state so the money and the outcome are
   never read separately. */
window.civitaiGenerationInline = (shotId, frameId) => {
  if (!civitaiShotConfigured()) return "";
  if (!CIVITAI_SHOT.loadedJobs) setTimeout(() => loadCivitaiJobs().then(() => { if (typeof route === "function") route(); }), 0);
  const job = civitaiJobFor(shotId, frameId);
  if (!job) return "";
  const active = civitaiJobActive(job);
  const done = job.status === "COMPLETED";
  const failed = job.status === "FAILED";
  const unresolved = job.status === "UNRESOLVED";
  if (active) civitaiStartPolling(job.id);
  /* A failed job may be tried again; an UNRESOLVED one may NOT be re-dispatched from
     here. It offers a check instead, because the request may already have been paid for
     and pressing Generate is what turns an uncertainty into a certain second bill. */
  const action = active || unresolved
    ? `<button class="chip" onclick="refreshCivitaiGeneration('${attr(job.id)}',true)">Check Civitai</button>`
    : failed
      ? `<button class="chip" onclick="openCivitaiGenerationModal('${attr(shotId)}','${attr(frameId || "")}','${attr(job.sourceBuildId || "")}')">Try again</button>`
      : "";
  return `<div class="fal-job-strip civitai-job-strip ${active ? "active" : done ? "done" : failed ? "failed" : unresolved ? "unresolved" : ""}" data-civitai-job="${attr(job.id)}" data-civitai-status="${attr(job.status)}">
    <div><span>${active ? '<i class="spin">◌</i>' : done ? "✓" : failed ? "!" : unresolved ? "?" : "·"}</span>
      <div><b>${esc(civitaiJobWords(job))}</b><small>${esc(`Civitai · ${job.model || "model"}`)} · ${esc(civitaiJobCostWords(job))}${job.error ? ` · ${esc(job.error)}` : ""}</small></div>
    </div>
    <div>${action}</div>
  </div>`;
};

/* A hosted render takes longer than a local one and the poll is correspondingly slower.
   One timer for the whole page, cleared the moment nothing is active — a poll that outlives
   its reason is the defect the activity drawer already taught this codebase about. */
function civitaiStartPolling(jobId) {
  if (CIVITAI_SHOT.polling) return;
  CIVITAI_SHOT.polling = setInterval(async () => {
    const job = (CIVITAI_SHOT.jobs || []).find((row) => row.id === jobId);
    if (!job || !civitaiJobActive(job)) {
      clearInterval(CIVITAI_SHOT.polling);
      CIVITAI_SHOT.polling = null;
      return;
    }
    await refreshCivitaiGeneration(jobId, false);
  }, 6000);
}

window.refreshCivitaiGeneration = async (jobId, announce = true) => {
  try {
    const response = await fetch(`/api/generation/civitai/jobs/${encodeURIComponent(jobId)}/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      /* A short server-side long poll. Civitai holds the connection open until the
         workflow is terminal or the budget runs out, so a render that finishes inside it
         saves the filmmaker a second press. */
      body: JSON.stringify({ waitSeconds: announce ? 10 : 0 }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "CineBraid could not check that generation.");
    await loadCivitaiJobs();
    const job = data.job || {};
    if (job.ingestedAt) {
      /* The result is now an ordinary candidate on an ordinary shot. Reloading the project
         is what puts it in front of the existing review path — this file does not render
         it and must not. */
      if (typeof loadProject === "function") await loadProject();
      if (announce !== false) toast("Civitai returned a candidate — review it below");
    } else if ((job.status === "FAILED" || job.status === "UNRESOLVED") && announce !== false) {
      toast(job.error || "Civitai could not complete that generation");
    }
  } catch (error) {
    if (announce !== false) toast(error.message || "CineBraid could not check that generation.");
  }
  if (typeof route === "function") route();
};

/* ---------------------------------------------------------------------------
   The paid request review.

   THE ORDER OF THIS DIALOG IS THE ORDER THE QUESTIONS ARE ASKED IN, and it is the order
   the money boundary needs: what will run, on whose account, at what price, and only then
   a button. The button cannot be pressed before the price exists. */
let CIVITAI_REQUEST = null;

window.openCivitaiGenerationModal = async (shotId, frameId = "", buildId = "") => {
  const shot = typeof shotById === "function" ? shotById(shotId) : null;
  if (!shot) return toast("That shot is no longer open");
  const frames = typeof guidedFrames === "function" ? guidedFrames(shot) : [];
  const frame = frameId ? frames.find((row) => row.id === frameId) : null;
  const build = buildId && typeof resolvePromptBuild === "function" ? resolvePromptBuild(P, buildId) : null;
  const prompt = String(build?.prompt || "").trim();
  if (!prompt) return toast("Build the prompt first");

  const status = await loadCivitaiStatus(true);
  if (!status || !status.ready) {
    /* A refusal that names the fix, and a route to it. A person who cannot generate
       because their account is connected for identity only must be told that, in those
       words, rather than shown a button that fails. */
    return openModal(`<h3>Civitai cannot generate yet</h3><p class="modal-confirm-message">${esc(status?.reason || "CineBraid is not set up to generate with Civitai.")}</p><div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button><button class="approve-btn" onclick="closeModal();location.hash='#/settings'">OPEN SETTINGS</button></div>`);
  }

  CIVITAI_REQUEST = {
    shotId,
    frameId: frameId || "",
    frameLabel: frame?.label || "A",
    buildId: build?.id || "",
    prompt,
    negativePrompt: "",
    /* Filled by the quote, and nothing may be confirmed until they are. */
    requestId: "",
    fingerprint: "",
    amount: null,
  };
  openModal(civitaiDispatchMarkup(shot, status, CIVITAI_REQUEST));
  civitaiRequestQuote();
};

function civitaiDispatchMarkup(shot, status, request) {
  return `<h3>Review paid request — Civitai</h3>
    <div class="modal-sub">${esc(`${shot.id} · Frame ${request.frameLabel}`)}</div>
    <p class="modal-confirm-message">CineBraid asks Civitai what this exact request costs, shows you that figure, and submits nothing until you confirm it. The result comes back as a candidate to review — it is not approved by arriving.</p>
    <div class="candidate-evidence-facts">
      <article><span>Where it runs</span><b>Civitai</b></article>
      <article><span>Model</span><b>${esc(status.resourceAir || "—")}</b></article>
      <article><span>Paid by</span><b>${esc(status.displayName || "your Civitai account")}</b></article>
      <article><span>Result</span><b>An unapproved candidate</b></article>
    </div>
    <label class="wide"><span>Negative prompt</span>
      <input id="civitai-dispatch-negative" placeholder="Optional — what this image must not contain" oninput="civitaiInvalidateQuote()">
    </label>
    <details><summary>The prompt this sends</summary><pre>${esc(request.prompt)}</pre></details>
    <div id="civitai-quote" class="civitai-quote hint">Asking Civitai what this costs…</div>
    <div class="modal-actions">
      <button class="cancel" onclick="closeModal()">Cancel</button>
      <button class="chip" id="civitai-requote" onclick="civitaiRequestQuote()" hidden>GET A NEW QUOTE</button>
      <button class="approve-btn" id="civitai-dispatch-go" disabled onclick="startCivitaiGeneration()">WAITING FOR PRICE…</button>
    </div>`;
}

/* CHANGING THE REQUEST INVALIDATES THE PRICE, IMMEDIATELY AND VISIBLY.
 *
 * The server would refuse a submission whose body no longer matches the quoted one — that
 * is what the permit's request fingerprint is for, and it is the guarantee. This is the
 * courtesy that goes with it: the button stops offering to spend a figure that no longer
 * describes what is in the box, rather than letting a person press it and read a refusal. */
window.civitaiInvalidateQuote = () => {
  if (!CIVITAI_REQUEST) return;
  CIVITAI_REQUEST.requestId = "";
  CIVITAI_REQUEST.fingerprint = "";
  CIVITAI_REQUEST.amount = null;
  const go = document.getElementById("civitai-dispatch-go");
  const requote = document.getElementById("civitai-requote");
  const quote = document.getElementById("civitai-quote");
  if (go) { go.disabled = true; go.textContent = "WAITING FOR PRICE…"; }
  if (requote) requote.hidden = false;
  if (quote) quote.innerHTML = `<span class="settings-state-chip" data-tone="attention">The request changed</span> Get a new quote before confirming.`;
};

window.civitaiRequestQuote = async () => {
  const request = CIVITAI_REQUEST;
  if (!request) return;
  const quote = document.getElementById("civitai-quote");
  const go = document.getElementById("civitai-dispatch-go");
  const requote = document.getElementById("civitai-requote");
  request.negativePrompt = String(document.getElementById("civitai-dispatch-negative")?.value || "").trim();
  if (quote) quote.textContent = "Asking Civitai what this costs…";
  if (go) { go.disabled = true; go.textContent = "WAITING FOR PRICE…"; }
  try {
    const response = await fetch("/api/generation/civitai/estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shotId: request.shotId,
        frameId: request.frameId,
        buildId: request.buildId,
        prompt: request.prompt,
        negativePrompt: request.negativePrompt,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Civitai would not price this request.");
    request.requestId = String(data.requestId || "");
    request.fingerprint = String(data.fingerprint || "");
    request.amount = Number(data.cost?.amount);
    if (!request.requestId || !request.fingerprint || !Number.isFinite(request.amount))
      throw new Error("Civitai did not return a price for this request.");
    if (requote) requote.hidden = true;
    if (quote)
      quote.innerHTML = `<span class="settings-state-chip" data-tone="ready">Quoted by Civitai</span> <b>${esc(String(request.amount))} Buzz</b> for this exact request. Nothing has been spent — asking the price costs nothing.`;
    /* THE FIGURE IS ON THE BUTTON. A confirmation whose cost is somewhere else on the
       screen is a confirmation somebody can give without reading it. */
    if (go) { go.disabled = false; go.textContent = `GENERATE — ${request.amount} BUZZ`; }
  } catch (error) {
    if (quote)
      quote.innerHTML = `<span class="settings-state-chip" data-tone="attention">No price</span> ${esc(error.message || "Civitai would not price this request.")} CineBraid will not offer to pay for a request it cannot price.`;
    if (go) { go.disabled = true; go.textContent = "NO PRICE — CANNOT GENERATE"; }
    if (requote) requote.hidden = false;
  }
};

/* Authorize, then dispatch. Two calls rather than one because they are two different acts:
   the first mints a permit bound to the digest of this exact request and spends nothing,
   and the second is the only call in this product that can spend Buzz. */
window.startCivitaiGeneration = async () => {
  const request = CIVITAI_REQUEST;
  if (!request) return;
  if (!request.fingerprint || !Number.isFinite(request.amount)) return toast("Get a price for this request first");
  const go = document.getElementById("civitai-dispatch-go");
  const label = go ? go.textContent : "";
  if (go) { go.disabled = true; go.textContent = "AUTHORIZING…"; }
  const body = {
    shotId: request.shotId,
    frameId: request.frameId,
    frameLabel: request.frameLabel,
    buildId: request.buildId,
    requestId: request.requestId,
    prompt: request.prompt,
    negativePrompt: request.negativePrompt,
    fingerprint: request.fingerprint,
  };
  try {
    const authorized = await fetch("/api/generation/civitai/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const permit = await authorized.json().catch(() => ({}));
    if (!authorized.ok) throw new Error(permit.error || "CineBraid could not authorize that request.");
    if (go) go.textContent = "SUBMITTING…";
    const response = await fetch("/api/generation/civitai/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, paidPermitId: permit.paidPermitId, authorizedAmount: request.amount }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Civitai would not take that request.");
    closeModal();
    await loadCivitaiJobs();
    toast(`Submitted to Civitai — ${request.amount} Buzz`);
    if (typeof route === "function") route();
  } catch (error) {
    if (go) { go.disabled = false; go.textContent = label || "GENERATE"; }
    toast(error.message || "Civitai would not take that request.");
  }
};

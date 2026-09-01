/* ---------- optional fal image generation ---------- */
function falGenerationConfig() {
  return CONFIG?.generation?.fal || {};
}

function falResolutionValue(kind = "frame") {
  const cfg = falGenerationConfig();
  return kind === "blocking" ? (cfg.blockingResolution || "1k") : (cfg.frameResolution || "1k");
}
/* The saved MiniMax H3 resolution. Read here rather than written into each dialog so
   the "H3 default resolution" field in Settings is the only thing that decides what the
   paid motion dialog opens at. */
function falH3ResolutionValue() {
  const saved = String(falGenerationConfig().h3Resolution || "").toUpperCase();
  return ["768P", "2K"].includes(saved) ? saved : "2K";
}
function falResolutionOptions(selected = "1k") {
  return [["1k", "1K"], ["2k", "2K"], ["4k", "4K"]].map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
}
function falGenerationReady() {
  const cfg = falGenerationConfig();
  return cfg.enabled === true && Boolean(cfg.apiKey || cfg.keySource === "environment");
}
function falGenerationJob(shotId, purpose, frameId = "") {
  return [...(FAL_GENERATION_JOBS || [])]
    .filter((job) => job.shotId === shotId && job.purpose === purpose && (!frameId || job.frameId === frameId))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0] || null;
}
function falJobActive(job) {
  return !!job && ["SUBMITTING", "SUBMITTED", "IN_QUEUE", "IN_PROGRESS"].includes(job.status);
}
/* THE PROVIDER'S HANDLE, from the field the durable ledger persists. Mirrors
   generation-lifecycle.js providerRequestId() on the server, and exists because
   several screens read `job.providerRequestId` and `job.requestId` — names no writer
   in CineBraid has ever produced. Every one of them silently rendered nothing, and
   the activity record they fed carried an empty id onwards. */
function falJobProviderRequestId(job) {
  return String(job?.externalId || "");
}
function falJobStatusLabel(job) {
  const map = {
    SUBMITTING: "Submitting",
    SUBMITTED: "Queued",
    IN_QUEUE: job?.queuePosition != null ? `Queued · position ${job.queuePosition}` : "Queued",
    IN_PROGRESS: "Generating",
    COMPLETED: "Results returned",
    FAILED: "Generation failed",
    CANCELLED: "Cancelled",
    /* Deliberately not a variety of "failed". The filmmaker's next move after a failure
       is to generate again, and that is the one move that can buy this shot twice. */
    UNRESOLVED: "Submission status unknown",
    ORPHANED: "Ran at the provider · not collected here",
  };
  return map[job?.status] || String(job?.status || "");
}
/* WHERE CINEBRAID DOES NOT KNOW WHAT HAPPENED TO A PAID REQUEST — read from the server,
   which is the only thing that gets to decide it.
   This asked whether the status was UNRESOLVED, which is one of the two ways a
   submission becomes uncertain. The other is a durable SUBMITTING row with no request
   id, and this screen drew those as ordinary running jobs: it offered Cancel, which the
   route refuses, and never offered the reconciliation dialog, which is their only way
   out. Every job on this screen arrives through publicJob(), so the flag is always
   present and the answer is always the lifecycle's. */
function falJobUnresolved(job) {
  return job?.uncertain === true;
}
/* Plain language, no jargon, no stack traces, and no reassurance CineBraid cannot give.
   It says what was done, what is unknown, and what to do about it. */
function falUnresolvedExplanation(job) {
  const where = job?.model ? ` (${job.model})` : "";
  /* TWO UNCERTAINTIES, AND THEY ARE NOT THE SAME SENTENCE. With a request id, CineBraid
     knows the provider took the request and lost the answer. Without one it does not even
     know that much — the process may have stopped before the request went out — and
     saying "CineBraid sent this" would be the confident falsehood this whole state exists
     to avoid. Both end at the same instruction, because both are settled the same way. */
  if (!String(job?.externalId || "")) {
    return `CineBraid started this request${where} and stopped before it recorded a request id, so it cannot tell whether the provider ever received it. The generation may be running and may have been charged. Check the provider before generating this shot again.`;
  }
  return `CineBraid sent this request to the provider${where} but lost contact before it could confirm whether it was accepted. The generation may be running and may have been charged. Check the provider before generating this shot again.`;
}
/* The only exit, and it needs a person who has actually looked. CineBraid never guesses
   and never times this out — waiting is not evidence that a request was refused. */
window.reconcileFalGeneration = async (jobId, outcome) => {
  try {
    const response = await fetch(`/api/generation/fal/jobs/${jobId}/reconcile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not record what you found.");
    FAL_GENERATION_JOBS = [...(FAL_GENERATION_JOBS || []).filter((job) => job.id !== data.job.id), data.job];
    /* RECONCILE WRITES NO PROJECT DOCUMENT. It records what the filmmaker found at
       the provider onto the job row in generation-jobs.json and nothing else — it
       never reaches updateEntityCoverageRun() or commitProject(). Declaring a
       durable advance here discarded a refresh that was reading the CURRENT record
       and left the window stale for a change the project never received. */
    closeModal();
    route();
    toast(outcome === "not-accepted" ? "Recorded as not accepted — you can generate this again" : "Recorded as accepted at the provider");
  } catch (error) {
    toast("Could not record the outcome: " + error.message);
  }
};
window.openFalUnresolvedModal = (jobId) => {
  const job = (FAL_GENERATION_JOBS || []).find((row) => row.id === jobId);
  if (!job) return toast("That generation is no longer listed");
  const fact = (label, value) => (value ? `<span>${esc(label)}: ${esc(String(value))}</span>` : "");
  openModal(`<h3>Submission status unknown</h3><p class="modal-confirm-message">${esc(falUnresolvedExplanation(job))}</p><div class="candidate-evidence-facts">${fact("Provider", job.provider || "fal")}${fact("Model", job.model)}${fact("Backend", job.backendId)}${fact("Sent", job.createdAt)}${fact("Request id", job.externalId || "never received")}${fact("Shot", job.shotId)}</div><p class="hint">Open the provider's dashboard and look for this request. Then record what you found — CineBraid will not decide this for you, and it will not let you generate this shot again until you do.</p><div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button><button class="chip" onclick="reconcileFalGeneration('${attr(job.id)}','accepted')">It was accepted</button><button class="approve-btn" onclick="reconcileFalGeneration('${attr(job.id)}','not-accepted')">It was NOT accepted — safe to retry</button></div>`);
};
function falGenerationInline(shotId, purpose, frameId = "") {
  const job = falGenerationJob(shotId, purpose, frameId);
  if (!job) return "";
  const active = falJobActive(job), done = job.status === "COMPLETED", failed = job.status === "FAILED";
  const unknown = falJobUnresolved(job);
  /* An unresolved job gets its own class, its own icon and its own action. What it must
     never get is a "Try again" button sitting where a failure's would be. */
  return `<div class="fal-job-strip ${unknown ? "unresolved" : active ? "active" : done ? "done" : failed ? "failed" : ""}"><div><span>${unknown ? "?" : active ? '<i class="spin">◌</i>' : done ? "✓" : failed ? "!" : "·"}</span><div><b>${esc(falJobStatusLabel(job))}</b><small>${unknown ? esc(falUnresolvedExplanation(job)) : `${esc(job.model || "GPT Image 2")}${job.outputCount ? ` · ${job.outputCount} option${job.outputCount === 1 ? "" : "s"}` : ""}${job.error ? ` · ${esc(job.error)}` : ""}`}</small></div></div><div>${unknown ? `<button class="chip" onclick="openFalUnresolvedModal('${attr(job.id)}')">Check and resolve</button>` : active ? `<button class="chip" onclick="refreshFalGeneration('${job.id}',true)">Refresh</button><button class="chip danger" onclick="cancelFalGeneration('${job.id}')">Cancel</button>` : failed ? `<button class="chip" onclick="openFalGenerationModal('${purpose}','${shotId}','${frameId}')">Try again</button>` : ""}</div></div>`;
}
function falPromptAction(shotId, purpose, frameId, buildId, fallbackDownload) {
  if (!falGenerationReady()) return fallbackDownload || "";
  return `<button class="approve-btn fal-generate-btn" onclick="openFalGenerationModal('${purpose}','${shotId}','${frameId || ""}','${buildId || ""}')">GENERATE</button>`;
}
function falBlockingRevisionPrompt(s, build, sourceAssetId, request) {
  const base = String(build?.prompt || "").trim();
  if (!request) return base;
  const source = sourceAssetId ? "Edit the supplied blocking attempt." : "Create a new blocking attempt.";
  const alreadyCompiled = String(build?.revisionRequest || "").trim() === String(request || "").trim();
  const changes = alreadyCompiled
    ? "The prompt above already incorporates the requested structural changes; preserve them exactly."
    : `Apply these requested structural changes exactly: ${request}`;
  return `${base}\n\nBLOCKING REVISION\n${source} ${changes}\nPreserve all unaffected shot relationships. Keep the result a flat grayscale storyboard scaffold. Do not introduce finished identity, colour, materials, lighting, location design, texture, or production style.`;
}
/* The route these two dialogs actually dispatch to, read from the configuration the
   DISPATCHER reads rather than written into the screen. `textModel` is the exact model id
   that will be sent, so naming it here is reporting the request, not asserting a choice.
   Neither dialog resolves a picker, so neither gets a recommendation — and there is no
   guide for these jobs anyway, so there would be none to render. */
function falFixedImageRoute() {
  const cfg = falGenerationConfig();
  const model = String(cfg.textModel || "").trim();
  if (!model) return null;
  return {
    modelId: model,
    modelName: model,
    surfaceId: "fal",
    surfaceName: "fal",
    surfaceKind: "api",
    where: "API",
  };
}

/* The control plan for a fixed-route image dialog. Quality and size are CineBraid's own
   request vocabulary for this path rather than a per-model intersection, so they are
   declared as the lists these dialogs have always offered — and the four machine settings
   are evaluated against a capability that declares none of them, which is why none of
   them renders and none of them can reach the body. */
/* Both the vocabulary AND the capability now come from the surface table in
   public/shared-generation-presentation.js. They were a literal here, which was the
   right answer for a route with no capability resolver to ask - the configured fal
   text/edit endpoints are not reached through a compiled plan - and the wrong PLACE for
   it: POST /api/generation/fal/jobs could not see the literal, so it could not enforce
   what these dialogs had decided. The values are unchanged; only their address is. */
function falFixedImageControlPlan(mode, request) {
  return generationRequestPlan({ surface: CINEBRAID_REQUEST_SURFACE_IDS.fixedImage, mode });
}

function falFixedImageControlsMarkup(plan, ids, current) {
  const rendered = new Set(plan.rendered || []);
  /* A REQUEST ALREADY AT THE PROVIDER FREEZES THE CONTROLS, and that is a fact about this
     RUN rather than about the model — so it is a pass-through here and never folded into
     capability. An unsupported control is still absent; a supported one is still drawn,
     just not changeable while the request it would describe is in flight. Collapsing the
     two would put "this model cannot" and "not right now" behind the same greyed box. */
  const lock = current.disabled === true ? " disabled" : "";
  /* EVERY CONTROL ANNOUNCES ITSELF, because the block above it is DERIVED from these
     values. The candidate count is multiplied by the configured rate to produce the quote
     a filmmaker reads before paying; a count that changes without redrawing leaves the
     price describing a request nobody is about to send. The compiled frame and motion
     dialogs have always re-rendered on change — through refreshFalFramePlan() and
     refreshFalH3Plan(), which recompile — and these three had no handler at all. */
  const onchange = ` onchange="refreshFalFixedImageView()"`;
  const parts = [];
  if (rendered.has("outputCount"))
    parts.push(`<label><span>Number of options</span><select id="${attr(ids.count)}"${lock}${onchange}>${
      [1, 2, 3, 4].map((n) => `<option value="${n}" ${n === Number(current.count) ? "selected" : ""}>${n}</option>`).join("")
    }</select></label>`);
  if (rendered.has("quality"))
    parts.push(`<label><span>Quality</span><select id="${attr(ids.quality)}"${lock}${onchange}>${
      ["low", "medium", "high"].map((value) => `<option value="${value}" ${value === current.quality ? "selected" : ""}>${value[0].toUpperCase() + value.slice(1)}</option>`).join("")
    }</select></label>`);
  if (rendered.has("resolution"))
    parts.push(`<label><span>Resolution</span><select id="${attr(ids.resolution)}"${lock}${onchange}>${falResolutionOptions(current.resolution)}</select></label>`);
  return parts.length ? `<div class="h3-settings-grid">${parts.join("")}</div>` : "";
}

/* One renderer for every fixed-route image dialog, so "Simple" means the same thing on a
   blocking revision, on a continuity-state reference and on a candidate correction as it
   does on the compiled frame dialog. Three callers now; the correction dialog was the last
   paid image surface still drawing its own grid and posting its own body.
 *
 * `limits` may be a FUNCTION of the candidate count. The row beneath the price says how
 * many candidates come back, which is the same number the price multiplies — passing it as
 * a fixed object froze it to whatever the dialog opened at, so a filmmaker who chose four
 * read a quote for two above a promise of two below, and got four. Either shape is
 * accepted; a function is the one that stays true. */
function renderFalFixedImageView(hostId, ids, current, limits, mode) {
  const host = document.getElementById(hostId);
  if (!host) return;
  const view = generationViewMode(mode || generationViewPreference());
  const plan = falFixedImageControlPlan(view, current);
  const quantity = Math.max(1, Number(current.count) || 1);
  /* WHAT THIS DIALOG IS, so a control change can redraw it from the values the filmmaker
     has actually chosen rather than from the ones it opened with. One slot, because one
     paid dialog is open at a time — the same reasoning as _generationViewRefresh. */
  window._falFixedImageView = { hostId, ids, current: { ...current }, limits };
  host.innerHTML = generationViewMarkup({
    mode: view,
    plan,
    option: falFixedImageRoute(),
    recommendation: generationRecommendation({ guide: null, options: [] }),
    rate: generationRateFor("image"),
    quantity,
    limits: typeof limits === "function" ? limits(quantity) : limits,
    controlsMarkup: falFixedImageControlsMarkup(plan, ids, current),
  });
}

/* THE QUOTE FOLLOWS THE CONTROLS.
 *
 * Re-reads what the controls hold RIGHT NOW and redraws the block from that. It is the
 * one path both the Simple/Advanced switch and every control change go through, so the
 * price, the candidate row and the selected values can never describe three different
 * requests — and it reads the same DOM the submission reads, which is what makes
 * "the number on screen" and "the number in the body" the same number by construction
 * rather than by review.
 *
 * A control the active view does not render falls back to the stored value: switching to
 * Simple must not lose the size a filmmaker chose under Advanced, and switching back must
 * show it again. What Simple SENDS is still decided by restrictPayloadToPlan(), which
 * strips it regardless — a remembered preference is not a payload. */
window.refreshFalFixedImageView = (mode) => {
  const state = window._falFixedImageView;
  if (!state) return;
  const read = (id, fallback) => {
    const value = document.getElementById(id)?.value;
    return value === undefined || value === null || value === "" ? fallback : value;
  };
  const count = Number(read(state.ids.count, state.current.count));
  renderFalFixedImageView(state.hostId, state.ids, {
    ...state.current,
    count: Number.isFinite(count) && count > 0 ? Math.max(1, Math.min(4, Math.round(count))) : state.current.count,
    quality: read(state.ids.quality, state.current.quality),
    resolution: read(state.ids.resolution, state.current.resolution),
  }, state.limits, mode);
};

window.openFalGenerationModal = (purpose, shotId, frameId = "", buildId = "") => {
  const s = shotById(shotId);
  if (!s) return;
  const cfg = falGenerationConfig();
  /* A fresh blocking frame and a frame pass both compile through the GenerationPlan
     architecture now, and open the capability-aware dialog. A blocking REVISION edits
     an existing attempt, which the compiled path does not carry yet — blocking mode
     takes no references at all — so it stays on the path it has always used rather
     than being half-converted into an edit that would write production identity into
     a frame whose whole contract is that it carries none. */
  const revising = purpose === "blocking"
    && String(ensureShotCreation(s).blockingRevisionRequest || "").trim()
    && String(ensureShotCreation(s).blockingRevisionSourceAssetId || "");
  if (!revising && typeof openFalFrameGenerationModal === "function")
    return openFalFrameGenerationModal(purpose, shotId, frameId, buildId);
  if (!falGenerationReady()) {
    openModal(`<h3>Connect FAL first</h3><p class="modal-confirm-message">Enable FAL image generation and add the API key in Settings. The key remains on the CineBraid server.</p><div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button><button class="approve-btn" onclick="closeModal();location.hash='#/settings'">OPEN SETTINGS</button></div>`);
    return;
  }
  const blocking = purpose === "blocking";
  const frame = frameId ? guidedFrames(s).find((item) => item.id === frameId) : null;
  const state = frame ? guidedFrameState(s, frame, guidedFrames(s).indexOf(frame)) : null;
  const build = blocking
    ? ensureShotCreation(s).blockingBuilds.find((item) => item.id === buildId) || ensureShotCreation(s).blockingBuilds.at(-1)
    : resolvePromptBuild(P, buildId) || latestPromptBuild(P, state?.promptBuilds || []);
  if (!build?.prompt) return toast("Build the prompt first");
  const count = blocking ? Number(cfg.blockingOutputs || 2) : Number(cfg.frameOutputs || 2);
  const quality = blocking ? cfg.blockingQuality || "low" : cfg.frameQuality || "high";
  const resolution = blocking ? falResolutionValue("blocking") : falResolutionValue("frame");
  const revision = blocking ? String(ensureShotCreation(s).blockingRevisionRequest || "").trim() : "";
  const sourceId = blocking ? String(ensureShotCreation(s).blockingRevisionSourceAssetId || "") : "";
  const sourceRow = sourceId ? blockingMediaRows(s).find(({ asset }) => asset.id === sourceId) : null;
  const profile = typeof profileById === "function" ? profileById(build.profileId || "") : null;
  window._falGenerationRequest = { purpose, shotId, frameId, buildId: build.id, packageId: build.packageId || "", prompt: build.prompt, frameLabel: frame?.label || "A", revision, sourceId, profileId: build.profileId || "", profileName: build.profileName || profile?.name || build.profileId || "", profileFamily: profile?.family || "" };
  const legacyIds = { count: "fal-output-count", quality: "fal-quality", resolution: "fal-resolution" };
  const legacyCurrent = { count, quality, resolution };
  const drawLegacyView = (mode) => renderFalFixedImageView("fal-legacy-generation-view", legacyIds, legacyCurrent, (n) => ({
    rows: [{ value: n, label: n === 1 ? "candidate returned" : "candidates returned" }],
    stopEarly: "Every returned image is an unapproved candidate. Nothing becomes canon until you approve one.",
  }), mode);
  /* Through the refresher, not the opening closure: the switch must redraw what the
     filmmaker has chosen, and a closure over the opening values would quietly reset the
     count every time somebody looked at Advanced. */
  window._generationViewRefresh = (mode) => refreshFalFixedImageView(mode);
  openModal(`<h3>${blocking ? revision && sourceRow ? "Revise blocking attempt" : "Generate blocking options" : `Generate Frame ${esc(frame?.label || "A")} options`}</h3><div class="modal-sub">FAL · ${esc((build.profileName || build.profileId || "Prompt build").toUpperCase())}${blocking && revision && sourceRow ? " · EDIT" : ""}</div>${blocking && revision ? `<div class="fal-revision-summary"><b>Requested changes</b><p>${esc(revision)}</p>${sourceRow ? `<small>Using ${esc(sourceRow.asset.title || sourceRow.asset.file)} as the editable grayscale scaffold.</small>` : `<small>Generating a fresh blocking attempt from the revised prompt.</small>`}</div>` : ""}<div id="fal-legacy-generation-view"></div><p class="hint">This submits a paid FAL request. CineBraid will store returned images in this shot and link them to the prompt build.</p><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="approve-btn large" onclick="startFalGeneration()">START GENERATION</button></div>`);
  setTimeout(() => drawLegacyView(), 0);
};
/* THE PERMIT A DIRECT PRESS DISPATCHES ON.
 *
 * Every dialog in CineBraid that spends money is one filmmaker action, and that action is
 * an authorization in its own right — manual generation stays legitimate while an
 * automation run is live on the same shot, which is why the server does not try to guess
 * whether a request is manual. It knows because this route minted a `direct` permit for it.
 *
 * A round trip inside the Generate press the filmmaker already made. Nothing is shown, no
 * choice is asked for, and a refusal here surfaces as the same toast every other
 * pre-provider refusal on this path does. The scope sent is the paid-relevant identity of
 * the request about to be submitted; the server hashes it and refuses a dispatch that is
 * not that work. */
async function paidDispatchPermitFor(body) {
  const source = body && typeof body === "object" ? body : {};
  const response = await fetch("/api/generation/paid-permit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generationRequest: source.generationRequest,
      purpose: source.purpose,
      shotId: source.shotId,
      frameId: source.frameId,
      entityList: source.entityList,
      entityId: source.entityId,
      sourceBuildId: source.sourceBuildId,
      outputCount: source.outputCount,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.paidPermitId)
    throw new Error(data.error || "CineBraid could not authorize this paid request, so nothing was submitted.");
  return { ...source, paidPermitId: data.paidPermitId };
}

window.startFalGeneration = async () => {
  const request = window._falGenerationRequest;
  if (!request) return;
  const s = shotById(request.shotId), blocking = request.purpose === "blocking";
  const frame = request.frameId ? guidedFrames(s).find((item) => item.id === request.frameId) : null;
  const build = blocking
    ? ensureShotCreation(s).blockingBuilds.find((item) => item.id === request.buildId)
    : resolvePromptBuild(P, request.buildId);
  if (!build) return toast("Prompt build is no longer available");
  let references = [];
  let prompt = build.prompt;
  if (blocking) {
    const c = ensureShotCreation(s), source = request.sourceId ? blockingMediaRows(s).find(({ asset }) => asset.id === request.sourceId) : null;
    prompt = falBlockingRevisionPrompt(s, build, source?.asset.id || "", request.revision);
    if (source && request.revision) references = [{ key: `blocking-revision:${source.asset.id}`, label: source.asset.title || source.asset.file, role: "composition", url: mediaAssetUrl(source.asset) }];
    c.blockingLastRevisionRequest = request.revision || "";
  } else {
    references = (build.references || []).filter((ref) => ref.url).map((ref) => ({ key: ref.key, label: ref.label, role: ref.role, url: ref.url }));
  }
  const body = {
    purpose: request.purpose,
    shotId: request.shotId,
    frameId: request.frameId,
    frameLabel: request.frameLabel,
    sourceBuildId: build.id,
    packageId: build.packageId || "",
    profileId: request.profileId || build.profileId || "",
    profileName: request.profileName || build.profileName || build.profileId || "",
    profileFamily: request.profileFamily || (typeof profileById === "function" ? (profileById(build.profileId || "")?.family || "") : ""),
    prompt,
    references,
    outputCount: Number(document.getElementById("fal-output-count")?.value || 1),
    quality: document.getElementById("fal-quality")?.value || (blocking ? "low" : "high"),
    resolution: document.getElementById("fal-resolution")?.value || (blocking ? falResolutionValue("blocking") : falResolutionValue("frame")),
    aspectRatio: shotAspectLabel(P, s),
    revisionRequest: request.revision || "",
    revisedFromAssetId: request.sourceId || "",
    /* WHAT THIS SCREEN WAS SHOWING. The gate below restricts the body; this is what
       lets POST /api/generation/fal/jobs restrict it the same way instead of trusting
       whatever arrives. */
    generationRequest: generationRequestDeclaration({
      surface: CINEBRAID_REQUEST_SURFACE_IDS.fixedImage,
      viewMode: generationViewPreference(),
    }),
  };
  /* Same gate as every other generation surface: a control the active view does not
     render does not travel, and a machine setting no model declares can never travel. */
  const gatedBody = restrictPayloadToPlan(body, falFixedImageControlPlan(generationViewPreference(), request)).payload;
  closeModal();
  keepGuidedPanelOpen(s, blocking ? "blocking" : "");
  try {
    const response = await fetch("/api/generation/fal/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(await paidDispatchPermitFor(gatedBody)) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not start generation");
    FAL_GENERATION_JOBS = [...(FAL_GENERATION_JOBS || []).filter((job) => job.id !== data.job.id), data.job];
    route();
    toast("FAL generation queued");
    pollFalGeneration(data.job.id);
  } catch (error) { toast("FAL generation failed: " + error.message); route(); }
};

function falEntityGenerationJob(list, entityId, stateId = "") {
  return [...(FAL_GENERATION_JOBS || [])]
    .filter((job) => job.purpose === "entity-reference" && job.entityList === list && job.entityId === entityId && (stateId ? job.continuityStateId === stateId : !job.continuityStateId))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0] || null;
}
/* THE SAME STRIP THE FRAME AND H3 PATHS DRAW, for reference and coverage work.
 *
 * This one had no uncertainty branch at all. It read `falJobActive()`, which counts
 * SUBMITTING, so a submission CineBraid could not account for was drawn here as an
 * ordinary running job: "Submitting", a Refresh, and a Cancel the route now correctly
 * refuses. The one control that state has — the reconciliation dialog — was never
 * offered, so on this screen the way out did not exist.
 *
 * `unknown` is checked FIRST for the same reason it is in falGenerationInline(): an
 * uncertain job is still "active" by status, and whichever branch is tested first is the
 * one the filmmaker gets. No new control, no new copy, no second recovery flow — the
 * unknown branch here is the frame renderer's, verbatim. */
function falEntityGenerationInline(list, entityId, stateId = "") {
  const job = falEntityGenerationJob(list, entityId, stateId);
  if (!job) return "";
  const active = falJobActive(job), done = job.status === "COMPLETED", failed = job.status === "FAILED";
  const unknown = falJobUnresolved(job);
  return `<div class="fal-job-strip ${unknown ? "unresolved" : active ? "active" : done ? "done" : failed ? "failed" : ""}"><div><span>${unknown ? "?" : active ? '<i class="spin">◌</i>' : done ? "✓" : failed ? "!" : "·"}</span><div><b>${esc(falJobStatusLabel(job))}</b><small>${unknown ? esc(falUnresolvedExplanation(job)) : `${job.continuityStateName ? `${esc(job.continuityStateName)} · ` : ""}${esc(job.model || "GPT Image 2")}${job.outputCount ? ` · ${job.outputCount} candidate${job.outputCount === 1 ? "" : "s"}` : ""}${job.error ? ` · ${esc(job.error)}` : ""}`}</small></div></div><div>${unknown ? `<button class="chip" onclick="openFalUnresolvedModal('${attr(job.id)}')">Check and resolve</button>` : active ? `<button class="chip" onclick="refreshFalGeneration('${job.id}',true)">Refresh</button><button class="chip danger" onclick="cancelFalGeneration('${job.id}')">Cancel</button>` : failed ? `<button class="chip" onclick="openFalEntityGenerationModal('${list}','${entityId}','','${stateId}')">Try again</button>` : ""}</div></div>`;
}
function falEntityPromptAction(list, entityId, buildId, fallbackDownload = "") {
  if (!falGenerationReady()) return fallbackDownload;
  return `<button class="approve-btn fal-generate-btn" onclick="openFalEntityGenerationModal('${list}','${entityId}','${buildId}')">GENERATE</button>`;
}
function falEntityStatePromptAction(list, entityId, stateId, buildId, fallbackDownload = "") {
  if (!falGenerationReady()) return fallbackDownload;
  return `<div class="inline-action-cluster"><button class="approve-btn fal-generate-btn" onclick="openFalEntityGenerationModal('${list}','${entityId}','${buildId}','${stateId}')">GENERATE STATE</button><button class="chip" onclick="generateMoreEntityStateCandidates('${list}','${entityId}','${stateId}','${buildId}',false)">GENERATE 3 MORE</button><button class="chip" onclick="generateMoreEntityStateCandidates('${list}','${entityId}','${stateId}','${buildId}',true)"${aiDisabledAttrs("text")}>IMPROVE + GENERATE 3</button>${fallbackDownload}</div>`;
}
function entityGenerationAuthorityRefs(list, entity, state = null, mode = "independent") {
  const media = typeof entityMedia === "function" ? entityMedia(list, entity) : [];
  const byName = new Map(media.map((item) => [item.name, item]));
  const refs = [];
  const add = (fileName, key, label, role, instruction) => {
    const item = byName.get(String(fileName || ""));
    if (!item?.url || refs.some((ref) => ref.url === item.url)) return;
    refs.push({ key, label, role, url: item.url, instruction, sourceFile: item.name });
  };
  if (state && !state.isDefault && mode === "derive") {
    const parentInfo = typeof assetStateParentMedia === "function" ? assetStateParentMedia(list, entity, state) : { parent: null, media: null, file: "" };
    /* MB-PT-02: an unreceipted parent is not an approved base. It still
       travels — it is the image the creator has been working from — under a
       role and a label that say what it actually is. */
    const parentIsCanon = parentInfo.standing === "canon";
    if (parentInfo.media) refs.push({
      key: `state-parent:${list}:${entity.id}:${parentInfo.parent?.id || "parent"}`,
      label: `${parentInfo.parent?.name || "Parent state"} ${parentIsCanon ? "canon reference" : "historic reference"}`,
      role: parentIsCanon ? "base" : "historic-reference",
      url: parentInfo.media.url,
      sourceFile: parentInfo.file || parentInfo.media.name || "",
      instruction: parentIsCanon
        ? `Exact editable parent for ${state.name || "the target state"}. Preserve the whole image and change only the written state delta.`
        : `Previously selected for ${parentInfo.parent?.name || "the parent state"} but never approved as canon. Treat it as context for ${state.name || "the target state"}, not as the decision about what this asset looks like.`,
    });
  }
  /* S8A — THE PRIMARY IDENTITY INPUT IS RECEIPT-BACKED, HERE TOO.
     This read `entity.approvedFile` and labelled it "primary approved
     authority" with no receipt behind it, exactly as coverage automation did.
     A pointer nobody approved is HISTORIC, and it still travels — as context,
     under a role that does not claim it decides what this entity looks like. */
  const entityTruth = typeof entityProductionTruth === "function" ? entityProductionTruth(P, list, entity.id) : { canon: [], historic: [] };
  const canonRow = entityTruth.canon.find((row) => row.isDefault) || entityTruth.canon[0] || null;
  const historicRow = canonRow ? null : (entityTruth.historic.find((row) => row.isDefault) || entityTruth.historic[0] || null);
  if (canonRow) {
    add(canonRow.value, `canon:${list}:${entity.id}`, `${entity.name || entity.id} canon identity`, list === "characters" ? "identity" : list === "locations" ? "location" : list === "vehicles" ? "vehicle" : "prop", list === "locations"
      ? "Exact location identity and spatial canon. Preserve fixed architecture, topology, openings, fixtures, landmark placement and proportions."
      : list === "props"
        ? "Exact prop canon. Preserve dimensions, materials, wear and any embedded photograph, artwork, printing, label, screen or document content."
        : "Exact canon identity and design. Preserve it.");
  } else if (historicRow) {
    add(historicRow.value, `historic:${list}:${entity.id}`, `${entity.name || entity.id} historic reference`, "historic-reference",
      "This image was previously selected for this reference but nobody has approved it as canon. Treat it as context, not as the decision about what this asset looks like.");
  }
  const coverage = [...(entity.coverageSlots || []), ...(entity.expressionSlots || [])]
    .filter((slot) => slotSelectedFile(slot) && !(typeof entityCandidateIsCoverageSheet === "function" && entityCandidateIsCoverageSheet(entity, slotSelectedFile(slot))))
    .sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
  /* S8 — PURPOSE, NOT APPROVAL. A slot is a supporting view the creator chose;
     it is not an authority and the role it travels under must not say it is.
     `approved-view` / "approved authority" were the words a 1D counterexample
     read back out of the submitted job. */
  for (const slot of coverage) add(slotSelectedFile(slot), `supporting-view:${slot.id}`, `${slot.label || slot.id} selected view`, list === "locations" ? "environment-reference" : "supporting-view", list === "locations"
    ? `This is another view of the same physical location. Use it to preserve shared geometry and reveal only what the requested camera angle would naturally see.`
    : `Selected ${slot.label || slot.id} view. Context only — preserve design details visible from this side.`);
  return refs;
}
function entityGenerationReferences(list, entity, options = {}) {
  const type = { characters: "character", locations: "location", props: "prop", vehicles: "vehicle" }[list];
  const state = options.state || null;
  const mode = options.mode || "independent";
  const refs = entityGenerationAuthorityRefs(list, entity, state, mode);
  const linked = typeof mediaLinksForTarget === "function" ? mediaLinksForTarget(type, entity.id) : [];
  for (const { asset, link } of linked) {
    if (!link.generationInput || !mediaIsImage(asset)) continue;
    const url = mediaAssetUrl(asset);
    if (!url || refs.some((ref) => ref.url === url)) continue;
    refs.push({
      key: `entity-media:${asset.id}`,
      label: asset.title || asset.originalName || asset.file,
      role: mediaPromptRole(link.role),
      url,
      instruction: referenceMetadataInstruction(link),
    });
  }
  return refs.slice(0, 16);
}
function entityGenerationIntegrityContract(list, entity, state, mode) {
  const lines = [
    "AUTHORITY CONTRACT — FAIL THE GENERATION RATHER THAN IMPROVISE",
    "Every supplied approved image depicts the same canonical asset. Treat them as one authority package, not as loose inspiration.",
  ];
  if (state && !state.isDefault && mode === "derive") {
    lines.push("#image1 is the exact editable parent image. Keep its camera, crop, perspective, dimensions, composition and all pixels outside the requested change as stable as the model permits.");
    lines.push(`CHANGE ONLY: ${String(state.notes || "No concrete state delta supplied").trim()}`);
    lines.push("Do not improve, reinterpret, replace, restyle or regenerate unaffected content.");
  }
  if (list === "locations") lines.push("SPATIAL LOCK: preserve the same walls, floor plan, openings, doors, windows, fixed fixtures, structural landmarks, topology, scale relationships, materials and set dressing. A plausible different room is incorrect.");
  if (list === "props") lines.push("OBJECT/CONTENT LOCK: preserve exact object shape, crop, proportions, material, wear and all embedded content. Any photograph, mural, artwork, text, label, map, document, screen image or printed design must remain the exact same content unless the delta explicitly names that content.");
  if (list === "characters") lines.push("IDENTITY LOCK: preserve face, body proportions, anatomy, hair, wardrobe construction, accessories and all unrequested continuity details.");
  if (list === "vehicles") lines.push("VEHICLE LOCK: preserve body construction, silhouette, wheel placement, openings, windows, panels, materials and functional components.");
  return lines.join("\n");
}
function entityGenerationPrompt(list, entity, build, refs, options = {}) {
  const state = options.state || null;
  const mode = options.mode || "independent";
  const legend = refs.map((ref, i) => `#image${i + 1} — ${ref.label}${ref.instruction ? `: ${ref.instruction}` : ""}`).join("\n");
  const contract = entityGenerationIntegrityContract(list, entity, state, mode);
  if (state && !state.isDefault) {
    if (mode === "derive" && refs[0]?.role === "base") {
      const delta = String(state.notes || "").trim();
      const extra = String(state.assetPromptNotes || "").trim();
      const target = build?.profileName || build?.profileId || "image edit";
      return `${contract}

REFERENCE PACKAGE
${legend}

DERIVED STATE EDIT
Edit #image1 directly. The parent image is the source of truth. Apply only the continuity delta below and preserve every unmentioned pixel, object, material, light source, camera choice, crop, and spatial relationship as closely as the model allows.

TARGET STATE
${state.name || "Continuity state"}${state.appliesTo ? `
SCENE / SHOT SCOPE: ${String(state.appliesTo).trim()} — honour any setting, location or moment this names.` : ""}

REQUIRED DELTA
${delta || "No concrete delta supplied. Do not generate until the state delta is defined."}${extra ? `

ADDITIONAL DIRECTION
${extra}` : ""}

OUTPUT
Return a single clean ${target} production frame at the source aspect ratio. Do not re-describe or re-create the parent state. Do not carry forward exclusions that contradict the required delta.`;
    }
    return `${contract}

${refs.length ? `REFERENCE PACKAGE
${legend}

` : ""}${build.prompt}

Create this state independently only because an approved parent image was unavailable. Preserve all unaffected canon exactly.`;
  }
  if (!refs.length) return build.prompt;
  return `${contract}\n\nREFERENCE PACKAGE\n${legend}\n\nCOMPILED REFERENCE INSTRUCTION\n${build.prompt}`;
}
/* THE ONE PREFLIGHT FOR EVERY PAID ENTITY REFERENCE, including the state shortcuts.
 *
 * `options.candidateCount` exists so "generate three more" can mean three without
 * needing a dispatch path of its own. That was the whole shape of the bypass: a second
 * route to the same paid endpoint, carrying its own hard-coded quantity, its own
 * settings and no disclosure at all. */
window.openFalEntityGenerationModal = (list, entityId, buildId = "", stateId = "", options = {}) => {
  const entity = (P[list] || []).find((item) => item.id === entityId);
  if (!entity) return toast("Entity is unavailable");
  if (!falGenerationReady()) {
    openModal(`<h3>Connect FAL first</h3><p class="modal-confirm-message">Enable FAL image generation and add the API key in Settings. The key remains on the CineBraid server.</p><div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button><button class="approve-btn" onclick="closeModal();location.hash='#/settings'">OPEN SETTINGS</button></div>`);
    return;
  }
  const state = stateId ? entityStateById(entity, stateId) : null;
  const builds = state ? assetStatePromptBuilds(state) : assetPromptBuilds(entity);
  const build = builds.find((item) => item.id === buildId) || builds.at(-1);
  if (!build?.prompt) return toast("Build the reference prompt first");
  /* ONE READER. This asked `parentInfo?.media` — does the parent HAVE an image —
     so a historic parent opened the modal in derive mode and everything
     downstream inherited it. */
  const derivation = state ? assetStateDerivation(list, entity, state) : null;
  const requestedMode = derivation ? derivation.requested : "independent";
  const parentInfo = state ? assetStateParentMedia(list, entity, state) : null;
  const effectiveMode = derivation ? derivation.mode : "independent";
  const refs = entityGenerationReferences(list, entity, { state, mode: effectiveMode });
  const cfg = falGenerationConfig();
  /* The caller's intended quantity where it has one, bounded to what the control can
     actually offer, and the saved default otherwise. */
  const count = Math.max(1, Math.min(4, Number(options.candidateCount) || Number(cfg.frameOutputs || 2)));
  const quality = cfg.frameQuality || "high", resolution = falResolutionValue("frame");
  const typeLabel = { characters: "character", locations: "location", props: "prop", vehicles: "vehicle" }[list] || "entity";
  const workspaceAnchor = document.querySelector("details.asset-creation-card");
  window._falEntityGenerationRequest = { list, entityId, buildId: build.id, stateId: state?.id || "", requestedMode, effectiveMode, anchorTop: workspaceAnchor?.getBoundingClientRect?.().top };
  const entityIds = { count: "fal-entity-output-count", quality: "fal-entity-quality", resolution: "fal-entity-resolution" };
  const entityCurrent = { count, quality, resolution };
  const drawEntityView = (mode) => renderFalFixedImageView("fal-entity-generation-view", entityIds, entityCurrent, (n) => ({
    rows: [{ value: n, label: n === 1 ? "candidate returned" : "candidates returned" }],
    stopEarly: `Every returned file is an unapproved ${typeLabel} candidate. Nothing becomes canon until you approve one.`,
  }), mode);
  window._generationViewRefresh = (mode) => refreshFalFixedImageView(mode);
  /* Shown, not chosen. The prompt in `build` was compiled at this ratio minutes ago;
     a picker here could only disagree with it, and when it did the request won and the
     prompt was left describing a frame nobody was going to get. */
  const aspectLabel = referenceAspectLabel(list);
  const stateSummary = state ? `<div class="fal-revision-summary"><b>${esc(state.name || "Continuity state")}</b><p>${esc(state.notes || "No state delta entered.")}</p><small>${effectiveMode === "derive" ? `Editing from ${esc(parentInfo?.parent?.name || "parent state")} · ${esc(parentInfo?.file || "")}` : requestedMode === "derive" ? `The selected parent has no approved image, so this run will create independently.` : "Creating independently from entity canon and the state delta."}</small></div>` : "";
  openModal(`<h3>Generate ${state ? `${esc(state.name || "state")} ` : ""}${esc(typeLabel)} reference candidates</h3><div class="modal-sub">FAL · GPT IMAGE 2${refs.length ? " EDIT / REFERENCE-GUIDED" : " TEXT-TO-IMAGE"}</div>${stateSummary}<div class="candidate-evidence-facts"><span>${esc(entity.id)}</span>${state ? `<span>Target · ${esc(state.name || "State")}</span>` : ""}<span>${refs.length} input${refs.length === 1 ? "" : "s"}</span><span>Candidate only · approval required</span></div><div id="fal-entity-generation-view"></div><div class="candidate-evidence-facts" data-fal-entity-aspect="${attr(aspectLabel)}"><span>Aspect ratio · ${esc(aspectLabel)}</span><span>${esc(typeLabel)} reference format · matches the compiled prompt</span></div><p class="hint">This submits a paid FAL image request. Returned files are added as unapproved ${esc(typeLabel)} candidates${state ? ` targeted to ${esc(state.name || "this state")}` : ""}. They do not become canon until you explicitly approve one.</p><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="approve-btn large" onclick="startFalEntityGeneration()">START GENERATION</button></div>`);
  setTimeout(() => drawEntityView(), 0);
};

/* GENERATE 3 MORE · IMPROVE + GENERATE 3.
 *
 * These two buttons used to build a request body themselves and POST it straight to
 * /api/generation/fal/jobs. That was a paid provider dispatch with no preflight, no
 * provider or cost disclosure, no Simple/Advanced plan and no payload gate — a second
 * road to the same charge, and the only one on which a filmmaker never saw the price.
 * Every guarantee the slice added was reachable from the other entity button and not
 * from these.
 *
 * They now do what they always said and nothing more: improve the prompt where asked,
 * then OPEN the preflight the paid dispatch already lives behind, pre-set to three
 * candidates. There is no second plan authority here and no second dispatch — the
 * submission is startFalEntityGeneration(), which restricts its payload through the
 * accepted plan like every other generation surface.
 *
 * THE IMPROVED BUILD IS THE ONE THAT GENERATES. The old path passed the button's
 * ORIGINAL buildId into a lookup that ran after the improvement, so it found the
 * pre-improvement build and generated from that — "improve and generate" improved a
 * prompt and then paid to render the one it had replaced. buildEntityStatePrompt()
 * returns the build it appended, so the improved id is what travels. */
window.generateMoreEntityStateCandidates = async (list, entityId, stateId, buildId = "", improve = false) => {
  const entity = (P[list] || []).find((item) => item.id === entityId);
  const state = entity && stateId ? entityStateById(entity, stateId) : null;
  if (!entity || !state) return toast("Continuity state is unavailable");
  if (!falGenerationReady()) return toast("Enable FAL generation first");

  let targetBuildId = buildId;
  if (improve) {
    if (!capabilityState("text").ready) return toast(capabilityState("text").message || "The text assistant is unavailable.");
    const improved = await buildEntityStatePrompt(list, entityId, stateId, true);
    /* A refused or failed improvement has already said why. Opening a paid preflight on
       the prompt it did not replace would be the same substitution in the other
       direction. */
    if (!improved) return;
    targetBuildId = improved.id;
  }

  const builds = assetStatePromptBuilds(state);
  const build = (targetBuildId && builds.find((item) => item.id === targetBuildId)) || builds.at(-1);
  if (!build?.prompt) return toast("Build the state prompt first");
  return openFalEntityGenerationModal(list, entityId, build.id, state.id, { candidateCount: 3 });
};

window.startFalEntityGeneration = async () => {
  const request = window._falEntityGenerationRequest || {};
  const stableAnchorTop = Number.isFinite(request.anchorTop) ? request.anchorTop : document.querySelector("details.asset-creation-card")?.getBoundingClientRect?.().top;
  const entity = (P[request.list] || []).find((item) => item.id === request.entityId);
  const state = entity && request.stateId ? entityStateById(entity, request.stateId) : null;
  const builds = entity ? (state ? assetStatePromptBuilds(state) : assetPromptBuilds(entity)) : [];
  const build = builds.find((item) => item.id === request.buildId);
  if (!entity || !build?.prompt) return toast("Reference prompt is unavailable");
  const derivation = state ? assetStateDerivation(request.list, entity, state) : null;
  const parentInfo = state ? assetStateParentMedia(request.list, entity, state) : null;
  /* THE DISPATCH BOUNDARY DECIDES FOR ITSELF. `request.requestedMode` was
     captured when the modal opened; the receipt behind the parent may have been
     revoked since, and a paid request must not inherit a stale readiness. */
  const effectiveMode = derivation ? derivation.mode : "independent";
  const references = entityGenerationReferences(request.list, entity, { state, mode: effectiveMode });
  const body = {
    purpose: "entity-reference",
    entityList: request.list,
    entityId: entity.id,
    entityType: { characters: "character", locations: "location", props: "prop", vehicles: "vehicle" }[request.list] || "entity",
    /* WHAT CINEBRAID IS ASKING FOR, declared by the caller that knows.
       `continuityStateId` below is WHERE the image is going; this is WHAT it is,
       and library-tools.js:165 already establishes that those are two different
       facts — a filmmaker can drop a turnaround onto a state slot, which is why
       intake asks even when a state is the target.
       CineBraid is not being asked here: this dispatch composes one prompt for one
       continuity state and requests single images from it, so the answer is known
       at the point of the request rather than guessed from the bytes that come
       back. Without it the candidate CineBraid itself generated arrives
       `undeclared` and the authority kernel refuses it, which is the defect the
       2026-09-01 dogfood recorded.
       The vocabulary is INTAKE_STRUCTURES', because this value is copied verbatim
       into the candidate row's existing declaration field at ingest, so nothing new
       has to be taught to read it. */
    artifactStructure: "single-reference",
    continuityStateId: state?.id || "",
    continuityStateName: state?.name || "",
    parentStateId: parentInfo?.parent?.id || "",
    parentStateName: parentInfo?.parent?.name || "",
    /* CANON ONLY. `parentInfo.file` is the parent image whatever its standing;
       `derivation.file` is populated only when a receipt stands behind it. */
    parentApprovedFile: derivation ? derivation.file : "",
    derivationMode: effectiveMode,
    sourceBuildId: build.id,
    profileId: build.profileId || "",
    profileName: build.profileName || build.profileId || "",
    profileFamily: typeof profileById === "function" ? (profileById(build.profileId || "")?.family || "") : "",
    prompt: entityGenerationPrompt(request.list, entity, build, references, { state, mode: effectiveMode }),
    references,
    outputCount: Number(document.getElementById("fal-entity-output-count")?.value || 1),
    quality: document.getElementById("fal-entity-quality")?.value || "high",
    resolution: document.getElementById("fal-entity-resolution")?.value || falResolutionValue("frame"),
    /* From the resolver, not from the modal. The compiled prompt already committed to
       this shape; reading a control here is what let the two disagree. */
    aspectRatio: referenceAspectLabel(request.list),
    /* WHAT THIS SCREEN WAS SHOWING. The gate below restricts the body; this is what
       lets POST /api/generation/fal/jobs restrict it the same way instead of trusting
       whatever arrives. */
    generationRequest: generationRequestDeclaration({
      surface: CINEBRAID_REQUEST_SURFACE_IDS.fixedImage,
      viewMode: generationViewPreference(),
    }),
  };
  /* The same gate every generation surface passes through. */
  const gatedBody = restrictPayloadToPlan(body, falFixedImageControlPlan(generationViewPreference(), request)).payload;
  try {
    await flushPendingProjectSave();
    closeModal();
    const response = await fetch("/api/generation/fal/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(await paidDispatchPermitFor(gatedBody)) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not start entity generation");
    FAL_GENERATION_JOBS = [...(FAL_GENERATION_JOBS || []).filter((job) => job.id !== data.job.id), data.job];
    // Keep the open reference builder stable; polling will refresh job state without collapsing or shifting the workspace.
    toast("FAL entity reference generation queued");
    const restoreReferenceBuilderPosition = () => {
      if (!Number.isFinite(stableAnchorTop)) return;
      const anchor = document.querySelector("details.asset-creation-card");
      if (!anchor) return;
      const delta = anchor.getBoundingClientRect().top - stableAnchorTop;
      if (Math.abs(delta) > 1) window.scrollBy?.(0, delta);
    };
    setTimeout(restoreReferenceBuilderPosition, 80);
    setTimeout(restoreReferenceBuilderPosition, 420);
    pollFalGeneration(data.job.id);
  } catch (error) {
    toast("Entity generation failed: " + error.message);
    route();
  }
};

window.startCandidateCorrectionGeneration = async () => {
  const draft = window._candidateCorrectionDraft || {};
  const s = shotById(draft.shotId), frame = s ? frameById(s, draft.frameId) : null;
  if (!s || !frame) return toast("Correction source is unavailable");
  const build = typeof finalizeCandidateCorrectionDraft === "function" ? finalizeCandidateCorrectionDraft() : resolvePromptBuild(P, draft.buildId);
  if (!build || build.missing || !build.prompt) return toast("Correction instructions are unavailable");
  const references = (build.references || []).filter((ref) => ref.url).slice(0, 16).map((ref, index) => ({
    key: ref.key || `image-${index + 1}`,
    token: `#image${index + 1}`,
    originalToken: ref.originalToken || "",
    label: ref.label || `Image ${index + 1}`,
    role: ref.role || "reference",
    instruction: ref.instruction || "",
    url: ref.url,
  }));
  if (!references.length || references[0].role !== "base") return toast("The editable candidate input is missing from the correction package");
  const body = {
    purpose: "correction",
    shotId: s.id,
    frameId: frame.id,
    frameLabel: frame.label || "A",
    sourceBuildId: build.id,
    packageId: build.packageId || "",
    profileId: build.profileId || "",
    profileName: build.profileName || build.profileId || "",
    profileFamily: typeof profileById === "function" ? (profileById(build.profileId || "")?.family || "") : "",
    parentBuildId: build.parentBuildId || "",
    parentPackageId: build.parentPackageId || "",
    sourceCandidate: build.sourceCandidate || draft.name || "",
    guideAssetId: build.guideAssetId || "",
    prompt: build.prompt,
    references,
    outputCount: Number(document.getElementById("candidate-correction-output-count")?.value || falGenerationConfig().frameOutputs || 1),
    quality: document.getElementById("candidate-correction-quality")?.value || falGenerationConfig().frameQuality || "high",
    resolution: document.getElementById("candidate-correction-resolution")?.value || falResolutionValue("frame"),
    aspectRatio: shotAspectLabel(P, s),
    /* WHAT THIS SCREEN WAS SHOWING. The gate below restricts the body; this is what
       lets POST /api/generation/fal/jobs restrict it the same way instead of trusting
       whatever arrives. */
    generationRequest: generationRequestDeclaration({
      surface: CINEBRAID_REQUEST_SURFACE_IDS.fixedImage,
      viewMode: generationViewPreference(),
    }),
  };
  /* THE SAME GATE EVERY OTHER PAID GENERATION SURFACE PASSES THROUGH, recomputed against
     the view that is actually showing. This dialog used to POST `body` directly: it drew
     count, quality and resolution together whatever the model supported, showed no plan
     and no price, and shipped whatever its selects happened to hold. The correction's own
     semantics are untouched — the package, the references, the provenance and the
     revision behaviour are all still the ones candidateCorrectionPackage() built. */
  const gatedBody = restrictPayloadToPlan(body, falFixedImageControlPlan(generationViewPreference(), draft)).payload;
  try {
    await flushPendingProjectSave();
    closeModal();
    const response = await fetch("/api/generation/fal/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(await paidDispatchPermitFor(gatedBody)) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not start correction generation");
    FAL_GENERATION_JOBS = [...(FAL_GENERATION_JOBS || []).filter((job) => job.id !== data.job.id), data.job];
    route();
    toast("FAL correction queued");
    pollFalGeneration(data.job.id);
  } catch (error) {
    toast("Correction generation failed: " + error.message);
    route();
  }
};

window.refreshCandidateCorrectionGeneration = async (jobId) => {
  const job = await refreshFalGeneration(jobId, true);
  if (!job) return;
  const buildId = job.sourceBuildId || "";
  setTimeout(() => openCandidateCorrectionModal(job.shotId, job.frameId, job.sourceCandidate || "", buildId), 0);
};

window.cancelCandidateCorrectionGeneration = async (jobId) => {
  await cancelFalGeneration(jobId);
  const job = (FAL_GENERATION_JOBS || []).find((item) => item.id === jobId);
  if (job) setTimeout(() => openCandidateCorrectionModal(job.shotId, job.frameId, job.sourceCandidate || "", job.sourceBuildId || ""), 0);
};

window.refreshFalGeneration = async (jobId, manual = false) => {
  try {
    /* PERSIST BEFORE THE SERVER INGESTS. The refresh route commits the finished
       generation INTO the project document and advances the stored revision, and
       the re-read that follows is a refresh: it declines to replace a record
       holding unsaved authored work. Flushing first means the filmmaker's edit
       is on disk before the ingest, so the re-read comes back carrying both. */
    await flushPendingProjectSave();
    /* The project this refresh is being made FOR, captured before the request
       goes out — a switch during the round-trip must not redirect the freshness
       advance below onto whatever is open when it lands. */
    const owner = ACTIVE_PROJECT_SLUG;
    const response = await fetch(`/api/generation/fal/jobs/${encodeURIComponent(jobId)}/refresh`, { method: "POST" });
    const data = await response.json();
    /* A FAILED COLLECTION CAN STILL HAVE WRITTEN. The route sets the entity's
       coverage-automation status to needs-attention before answering 502, on the
       same condition a cancel writes under, and says so. */
    if (!response.ok) {
      await applyProjectMutationResult(owner, data);
      throw new Error(data.error || "Could not refresh generation");
    }
    FAL_GENERATION_JOBS = [...(FAL_GENERATION_JOBS || []).filter((job) => job.id !== jobId), data.job];
    if (data.job.status === "COMPLETED") {
      const blockingIds = (data.job.outputs || []).filter((out) => out.type === "blocking").map((out) => out.assetId);
      /* THE INGEST DEFINITELY RAN. A COMPLETED job that this route answered has
         had its results committed into the project document, which advanced the
         stored revision without this window writing anything. Declared BEFORE the
         refresh below, so that refresh captures the new generation and commits
         normally while every snapshot prepared before the ingest is recognised as
         behind the record — including if the refresh below fails outright. */
      /* AND THE RE-READ IS GATED ON THAT ANSWER. A SAME-PROJECT RE-READ, NOT A
         RECORD REPLACEMENT: the filmmaker has not left the project they are
         editing, and the server merely committed results into it. If they HAVE
         left it, the project on screen did not change because of this ingest and
         there is nothing here for a refresh to collect. */
      if (noteCurrentProjectDurableAdvance(owner)) await load({ intent: "refresh" });
      toast(`${(data.job.outputs || []).length} FAL image${(data.job.outputs || []).length === 1 ? "" : "s"} returned`);
      if (blockingIds.length) setTimeout(() => openBlockingNamingModal(data.job.shotId, blockingIds), 0);
      return data.job;
    }
    if (manual) route();
    if (manual) toast(falJobStatusLabel(data.job));
    return data.job;
  } catch (error) { if (manual) toast("Could not refresh generation: " + error.message); return null; }
};
window.pollFalGeneration = async (jobId) => {
  const job = await refreshFalGeneration(jobId, false);
  if (job && falJobActive(job)) setTimeout(() => pollFalGeneration(jobId), 3500);
};
window.cancelFalGeneration = async (jobId) => {
  /* Captured before the request, so a switch during the round-trip cannot
     redirect the declaration onto whatever is open when it lands. */
  const owner = ACTIVE_PROJECT_SLUG;
  const response = await fetch(`/api/generation/fal/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
  const data = await response.json();
  if (!response.ok) return toast(data.error || "Could not cancel generation");
  /* A cancel writes the project document only for an entity-reference job whose
     entity has coverage automation configured. The route says which happened; this
     is not inferred from the 2xx. */
  await applyProjectMutationResult(owner, data);
  FAL_GENERATION_JOBS = [...(FAL_GENERATION_JOBS || []).filter((job) => job.id !== jobId), data.job];
  route(); toast("Generation cancelled");
};
window.resumeFalGenerationPolling = () => {
  for (const job of FAL_GENERATION_JOBS || []) if (falJobActive(job)) pollFalGeneration(job.id);
};

/* ---------- MiniMax H3 motion generation on FAL ---------- */
function falH3MotionJob(shotId) {
  return [...(FAL_GENERATION_JOBS || [])]
    .filter((job) => job.purpose === "motion-h3" && job.shotId === shotId)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0] || null;
}
function falH3MotionInline(shotId) {
  const job = falH3MotionJob(shotId);
  if (!job) return "";
  const active = falJobActive(job), done = job.status === "COMPLETED", failed = job.status === "FAILED";
  const unknown = falJobUnresolved(job);
  return `<div class="fal-job-strip h3 ${unknown ? "unresolved" : active ? "active" : done ? "done" : failed ? "failed" : ""}"><div><span>${unknown ? "?" : active ? '<i class="spin">◌</i>' : done ? "✓" : failed ? "!" : "·"}</span><div><b>${esc(falJobStatusLabel(job))}</b><small>${unknown ? esc(falUnresolvedExplanation(job)) : `${esc(job.profileName || "MiniMax H3")} · ${esc(String(job.profileMode || "motion").toUpperCase())}${job.durationSeconds ? ` · ${job.durationSeconds}s` : ""}${job.error ? ` · ${esc(job.error)}` : ""}`}</small></div></div><div>${unknown ? `<button class="chip" onclick="openFalUnresolvedModal('${attr(job.id)}')">Check and resolve</button>` : active ? `<button class="chip" onclick="refreshFalGeneration('${job.id}',true)">Refresh</button><button class="chip danger" onclick="cancelFalGeneration('${job.id}')">Cancel</button>` : failed ? `<button class="chip" onclick="openFalH3MotionModal('${job.shotId}','${job.sourceBuildId || ""}')">Try again</button>` : ""}</div></div>`;
}
function falH3MotionPromptAction(shotId, buildId, profile) {
  if (!falGenerationReady() || profile?.family !== "minimax-h3") return "";
  /* SLICE 5b EXECUTION GATE — PAID-ACTION CREATION.

     A package compiled BEFORE the shot's intent changed is still sitting in the shot's
     build list, and this is the function that turns one into a paid button. So the
     question is asked again from current truth rather than remembered from compile time:
     an intent that now excludes this target draws the reason instead of the button.

     The rule is public/creation-studio.js's single execution predicate, called rather
     than reproduced — there is no second compatibility answer in this file. */
  const shot = typeof shotById === "function" ? shotById(shotId) : null;
  const refusal = typeof guidedMotionIntentRefusal === "function" ? guidedMotionIntentRefusal(shot, profile) : "";
  if (refusal)
    return `<p class="prompt-check warn h3-generate-intent-blocked" data-h3-intent-blocked="${attr(shotId)}">${esc(refusal)}</p>`;
  /* DOGFOOD SLICE 0 — AN OUT-OF-DATE PACKAGE DOES NOT GET A PAID BUTTON.

     packageFreshness() already knew. The verdict was printed directly above this
     control — OUT OF DATE — REBUILD BEFORE GENERATING — and GENERATE H3 VIDEO sat
     beside it, enabled, in the primary style, as the obvious thing to press. The
     Aug 26 pass pressed it. A compiled package is a frozen sentence about inputs
     that have since moved; sending it spends money to render something the shot no
     longer says.

     REBUILD BECOMES THE PRIMARY ACTION and the reason travels with it, so the
     filmmaker is not sent to look for what changed. Nothing is deleted: the
     package, its prompt, its history and its Copy/Download controls are all
     untouched, and one rebuild restores the paid action IF the shot's current
     preconditions still allow one — this function is re-entered from scratch, so
     the intent refusal above is asked again too.

     "NOT RECORDED" IS NOT STALE. A package compiled before dependencies were
     captured cannot be checked either way, and refusing generation on an absence
     would block every pre-existing package on evidence nobody has. It keeps its
     button and its own NOT CHECKED verdict. */
  /* The SAME list the paid dialog resolves the build from, so the button and the
     dialog behind it can never be looking at different packages. */
  const builds = shot && typeof resolvePromptBuildList === "function"
    ? resolvePromptBuildList(P, ensureShotCreation(shot).motionPromptBuilds || [])
    : [];
  const build = builds.find((item) => item.id === buildId) || builds.at(-1) || null;
  const freshness = shot && build && typeof packageFreshness === "function" ? packageFreshness(shot, build) : null;
  /* The control stays VISIBLE and disabled rather than disappearing: principle 8 —
     a primary action explains its prerequisite instead of vanishing. The rebuild
     that lifts it is the primary button in the freshness block directly beneath
     this header, where the reasons already are, so the action and the explanation
     are not in two places. */
  if (freshness && freshness.recorded && !freshness.current)
    return `<button class="approve-btn h3-generate-btn" disabled data-h3-generate-blocked="${attr(shotId)}" data-h3-stale-reasons="${attr(freshness.reasons.join("; "))}" title="${attr(`This compiled package is out of date: ${freshness.reasons.join("; ")}. Rebuild it before generating.`)}">GENERATE H3 VIDEO</button>`;
  return `<button class="approve-btn h3-generate-btn" onclick="openFalH3MotionModal('${shotId}','${buildId}')">GENERATE H3 VIDEO</button>`;
}
/* THE PRE-FLIGHT QUOTE, from the same configured rate the ledger will record.
 *
 * This function used to BE the price authority for motion: $0.26 per second and $0.08
 * per reference image beyond the first five, typed into the browser, multiplied here,
 * and printed as "about $2.60 USD" beside the paid button. The server meanwhile recorded
 * `confidence: "unknown"` for the identical job, because generation-cost.js had no motion
 * rate to read and rightly refused to multiply a per-IMAGE rate by a video. Two
 * authorities, two answers, and the filmmaker only ever saw one of them.
 *
 * Now there is one rate in configuration and one function that multiplies it, and this
 * calls that function. Two consequences worth stating:
 *
 *   - An install that has not configured a motion rate quotes UNAVAILABLE rather than a
 *     number, and the job it submits records `unknown`. The screen and the row agree
 *     about not knowing, which is the honest version of agreeing.
 *   - The per-reference-image surcharge is GONE rather than moved. It was a second
 *     hard-coded rate that no CineBraid source establishes, and configuration holds the
 *     per-second rate this slice was scoped to. Inventing a config field to preserve an
 *     unverified number would have carried the guess forward wearing better clothes. */
function falH3MotionQuote(durationSeconds) {
  const rate = configuredMotionRate(typeof CONFIG === "object" ? CONFIG : {});
  return generationPriceLine({ rate, quantity: Number(durationSeconds) || 0, local: false });
}
/* The dialog shows the COMPILED PLAN, because the compiled plan is what is sent.
 *
 * It used to show the prompt-engine's own text and the server used to dispatch that
 * same string, so "what you confirmed" and "what was sent" matched by coincidence. Now
 * the server compiles the shot's approved package into a GenerationPlan and serialises
 * that; this dialog asks for the identical compilation and renders it. The compiler is
 * deterministic — no clock, no network, no assistant — so the preview and the dispatch
 * cannot drift apart.
 *
 * Every number here comes from that response. Nothing about MiniMax H3 or about fal is
 * hard-coded on this screen any more, which is why a stale 2,000-character limit could
 * sit in the interface for as long as it did. */
window.updateFalH3CostEstimate = () => {
  const request = window._falH3MotionRequest || {};
  const duration = Number(document.getElementById("fal-h3-duration")?.value || request.durationSeconds || 5);
  const quote = falH3MotionQuote(duration);
  const target = document.getElementById("fal-h3-cost-estimate");
  if (!target) return;
  /* The provenance rides with the figure rather than sitting in Settings. A filmmaker
     about to spend money should be able to see, without leaving the dialog, whether the
     number came from somebody who read the provider's page last week or from a field
     nobody has ever filled in. */
  const provenance = (quote.provenance && quote.provenance.line) || "";
  target.innerHTML = `<b>${esc(quote.headline)}</b><span>${esc(quote.detail)}</span>${provenance ? `<em class="gen-view-provenance">${esc(provenance)}</em>` : ""}`;
  /* The whole Simple/Advanced block re-renders with it: duration is the quantity the
     quote multiplies, so a duration change that moved the price and left the panel
     showing the previous one would be the same disagreement in miniature. */
  renderFalH3GenerationView();
};
/* The effective ceiling: MiniMax H3's own limit intersected with fal's. The dialog is
   told the number rather than deciding it, and says which layer set it. */
function falH3PromptLimit() {
  return Number(window._falH3MotionRequest?.maxPromptCharacters) || 7000;
}
/* What an edit removed, checked against the compiler's own record with the same
   deterministic test the compiler uses on its own output. Not a review and not a
   refusal — the words are the filmmaker's — but the cost of the change is stated before
   it is paid for rather than discovered in the result. */
window.reviewFalH3PromptEdit = async () => {
  const request = window._falH3MotionRequest;
  const panel = document.getElementById("fal-h3-edit-coverage");
  if (!request || !panel) return;
  const prompt = String(document.getElementById("fal-h3-prompt-editor")?.value ?? "");
  if (prompt.trim() === String(request.compiledPrompt || "").trim()) {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }
  const gate = falH3AspectGate();
  const preview = await fetchFalH3Plan(request.shotId, request.buildId, {
    durationSeconds: Number(document.getElementById("fal-h3-duration")?.value || request.durationSeconds),
    resolution: document.getElementById("fal-h3-resolution")?.value || request.resolution,
    aspectRatio: gate.carriesAspectRatio ? gate.value : "",
    profileMode: request.profileMode,
    prompt,
  });
  if (!preview) return;
  const lost = preview.editedCoverage?.lost || [];
  const checked = preview.editedCoverage?.checked || [];
  panel.hidden = false;
  panel.innerHTML = lost.length
    ? `<div><b>Your edit drops ${lost.length} of ${checked.length} directed element${lost.length === 1 ? "" : "s"}</b><small>${esc(lost.map((row) => row.label).join(", "))}. That may be exactly what you intended — CineBraid is recording it, not blocking it. The compiled original is preserved either way.</small></div>`
    : `<div class="ok"><b>Your edit keeps all ${checked.length} directed elements</b><small>Every piece of direction CineBraid wrote into the prompt is still present in your version.</small></div>`;
};
window.updateFalH3PromptEditor = () => {
  const request = window._falH3MotionRequest || {};
  const editor = document.getElementById("fal-h3-prompt-editor");
  const prompt = String(editor?.value ?? request.prompt ?? "");
  request.prompt = prompt;
  const limit = falH3PromptLimit();
  const count = document.getElementById("fal-h3-prompt-count");
  const fact = document.getElementById("fal-h3-prompt-fact");
  const warning = document.getElementById("fal-h3-prompt-warning");
  const changed = prompt.trim() !== String(request.compiledPrompt || "").trim();
  if (count) {
    count.textContent = `${prompt.length.toLocaleString()}/${limit.toLocaleString()}`;
    count.classList.toggle("over", prompt.length > limit);
  }
  if (fact) fact.textContent = `${prompt.length.toLocaleString()}/${limit.toLocaleString()} prompt characters${changed ? " · edited" : ""}`;
  if (warning) {
    warning.hidden = !!prompt.trim() && prompt.length <= limit;
    /* Guarded: the counter is not worth losing the whole dialog over if the panel's
       markup ever changes underneath it. */
    const detail = warning.querySelector && warning.querySelector("small");
    if (detail) detail.textContent = !prompt.trim()
      ? "Enter a prompt before submitting a paid request."
      : `Shorten this prompt to ${limit.toLocaleString()} characters before a paid submission. CineBraid will not trim it for you — a prompt cut to fit is a shot you did not direct.`;
  }
  updateFalH3AspectGuard();
};
/* The format this dialog would actually send, checked against MiniMax H3's own list.
   The same resolver runs on the server, so the screen and the dispatch cannot disagree. */
window.falH3AspectGate = () => {
  const request = window._falH3MotionRequest || {};
  const select = document.getElementById("fal-h3-aspect");
  const requested = select ? select.value : request.aspectRatio || (request.profileMode === "r2v" ? "adaptive" : "16:9");
  return h3AspectSupport(request.profileMode, requested);
};
/* Shown in place, next to the control that caused it, and it takes the submit button
   with it. Nothing is dispatched, nothing is charged, and every prompt, frame,
   keyframe and setting in this dialog is left exactly as the user left it. */
window.updateFalH3AspectGuard = () => {
  const panel = document.getElementById("fal-h3-aspect-warning");
  const gate = falH3AspectGate();
  if (panel) {
    panel.hidden = gate.ok;
    if (!gate.ok) panel.innerHTML = `<div><b>MiniMax H3 cannot deliver ${esc(gate.requested || "this format")}</b><small>${esc(gate.message)}</small></div>`;
  }
  /* The full submit condition rather than a one-way disable: choosing a format H3 does
     accept has to give the button back, or the refusal becomes a dead end. A backend
     refusal from the compiled plan holds the button down on its own. */
  const submit = document.getElementById("fal-h3-submit");
  if (submit) {
    const prompt = String(document.getElementById("fal-h3-prompt-editor")?.value ?? "");
    submit.disabled = !gate.ok
      || !prompt.trim()
      || prompt.length > falH3PromptLimit()
      || !!window._falH3MotionRequest?.refusal
      || !!window._falH3Submitting;
  }
};
window.resetFalH3PromptEditor = () => {
  const request = window._falH3MotionRequest || {};
  const editor = document.getElementById("fal-h3-prompt-editor");
  if (editor) editor.value = request.compiledPrompt || "";
  const panel = document.getElementById("fal-h3-edit-coverage");
  if (panel) { panel.hidden = true; panel.innerHTML = ""; }
  updateFalH3PromptEditor();
};
/* Re-compiles when an output setting changes, because duration and format are compiler
   inputs: a different duration is a different plan, and showing the old prompt beside a
   new duration would put the dialog back to guessing. */
window.refreshFalH3Plan = async () => {
  const request = window._falH3MotionRequest;
  if (!request || window._falH3Submitting) return;
  const duration = Number(document.getElementById("fal-h3-duration")?.value || request.durationSeconds);
  const resolution = document.getElementById("fal-h3-resolution")?.value || request.resolution;
  const gate = falH3AspectGate();
  const edited = String(document.getElementById("fal-h3-prompt-editor")?.value ?? "");
  const keepEdit = edited.trim() && edited.trim() !== String(request.compiledPrompt || "").trim();
  const preview = await fetchFalH3Plan(request.shotId, request.buildId, {
    durationSeconds: duration,
    resolution,
    aspectRatio: gate.carriesAspectRatio ? gate.value : "",
    profileMode: request.profileMode,
  });
  if (!preview) return;
  Object.assign(request, preview, { prompt: keepEdit ? edited : preview.compiledPrompt });
  const editor = document.getElementById("fal-h3-prompt-editor");
  if (editor && !keepEdit) editor.value = preview.compiledPrompt;
  renderFalH3PlanPanels();
  updateFalH3CostEstimate();
  updateFalH3PromptEditor();
};
async function fetchFalH3Plan(shotId, buildId, extra = {}) {
  try {
    const response = await fetch("/api/generation/fal/h3/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shotId, sourceBuildId: buildId, ...extra }),
    });
    const data = await response.json();
    if (!response.ok) {
      toast(data.error || "CineBraid could not compile this MiniMax H3 package");
      return null;
    }
    return data;
  } catch (error) {
    toast("Could not compile the MiniMax H3 request: " + error.message);
    return null;
  }
}
/* The provider input order, read from the plan's own bindings rather than renumbered
   here. "Image 1" on this screen is the reference the request will actually carry in
   that slot — which is the whole point of binding by role instead of array position. */
function falH3BindingRows(request) {
  const bindings = request?.dispatch?.bindings || [];
  if (!bindings.length) return "";
  const byRef = new Map((request.references || []).map((ref) => [ref.refId, ref]));
  const FIELD_LABELS = {
    image_url: "Opening frame",
    end_image_url: "Final frame",
    reference_image_urls: "Image",
    reference_video_urls: "Video",
    reference_audio_urls: "Audio",
  };
  return bindings.map((binding) => {
    const ref = byRef.get(binding.refId) || {};
    const label = FIELD_LABELS[binding.field] || binding.field;
    const slot = binding.index == null ? label : `${label} ${binding.index + 1}`;
    return `<li><b>${esc(slot)}</b><span>${esc(ref.label || binding.refId)} · ${esc(String(binding.role || "reference").replace(/-/g, " "))}${ref.purpose ? ` · ${esc(ref.purpose)}` : ""}</span></li>`;
  }).join("");
}
/* What the compiler could not carry, in the compiler's own words. A shot that loses a
   piece of direction now says so on the way in rather than silently. */
function falH3WarningRows(request) {
  const rows = (request?.warnings || []).filter((row) => row && row.message);
  if (!rows.length) return "";
  return `<section class="h3-plan-warnings"><b>${rows.length} note${rows.length === 1 ? "" : "s"} about this request</b><ul>${rows.map((row) => `<li><span>${esc(row.message)}</span>${row.action ? `<small>${esc(row.action)}</small>` : ""}</li>`).join("")}</ul></section>`;
}
function renderFalH3PlanPanels() {
  const request = window._falH3MotionRequest || {};
  /* The same honest option list the frame dialog shows, read-only here. MiniMax H3 is
     the only executable motion path today and this is where a filmmaker finds that
     out — beside the models that cannot yet generate and the sentence saying why. */
  const options = document.getElementById("fal-h3-options");
  if (options && typeof renderGenerationOptions === "function")
    options.innerHTML = renderGenerationOptions(request.options, "animate-shot", request.selectedOptionId);
  const sequence = document.getElementById("fal-h3-sequence");
  if (sequence) {
    const rows = falH3BindingRows(request);
    sequence.innerHTML = rows ? `<b>Exact provider inputs</b><small>Each approved reference and the request field it fills. Bound by its production role, not by list order.</small><ol>${rows}</ol>` : "";
    sequence.hidden = !rows;
  }
  const notes = document.getElementById("fal-h3-plan-warnings");
  if (notes) notes.innerHTML = falH3WarningRows(request);
  const refusalPanel = document.getElementById("fal-h3-refusal");
  if (refusalPanel) {
    const refusal = request.refusal;
    refusalPanel.hidden = !refusal;
    if (refusal) refusalPanel.innerHTML = `<div><b>This package cannot be submitted as it stands</b><small>${esc(refusal.error)}</small></div>`;
  }
}
window.openFalH3MotionModal = async (shotId, buildId = "") => {
  const s = shotById(shotId), c = s && ensureShotCreation(s);
  if (!s || !c) return toast("Shot is unavailable");
  if (!falGenerationReady()) {
    openModal(`<h3>Connect FAL first</h3><p class="modal-confirm-message">Enable FAL generation and add the API key in Settings. The key remains on the CineBraid server.</p><div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button><button class="approve-btn" onclick="closeModal();location.hash='#/settings'">OPEN SETTINGS</button></div>`);
    return;
  }
  const builds = resolvePromptBuildList(P, c.motionPromptBuilds || []);
  const build = builds.find((item) => item.id === buildId) || builds.at(-1);
  if (!build?.prompt) return toast("Build the MiniMax H3 prompt first");
  const profile = typeof profileById === "function" ? profileById(build.profileId || "") : (PROMPT_LIBRARY?.profiles || []).find((item) => item.id === build.profileId);
  if (profile?.family !== "minimax-h3") return toast("Select and build a MiniMax H3 motion profile first");
  /* SLICE 5b EXECUTION GATE — THE PAID DIALOG WILL NOT OPEN.

     Reached by direct programmatic invocation, by a "Try again" chip on an older job, and
     by any caller that bypassed the rendered surface entirely. It is asked of the SHOT
     RECORD and the BUILD'S OWN PROFILE, so a stale build, a restored selection, a
     re-enabled option or a hand-called opener all fail closed here — before the plan is
     fetched and long before anything is submitted. */
  const intentRefusal = typeof guidedMotionIntentRefusal === "function" ? guidedMotionIntentRefusal(s, profile) : "";
  if (intentRefusal) return toast(intentRefusal);
  /* Unsaved edits reach the server through the project document, and the plan is
     compiled from the stored package — so the save has to land before the compile. */
  if (typeof flushPendingProjectSave === "function") await flushPendingProjectSave();
  const requestedDuration = Math.max(1, Math.min(60, Number(build.durationSeconds || c.motionDuration || 5) || 5));
  const ratio = profile.mode === "r2v" ? (productionAspect(P)?.label || "adaptive") : projectAspectLabel(P);
  const aspectGate = h3AspectSupport(profile.mode, ratio);
  const preview = await fetchFalH3Plan(shotId, build.id, {
    durationSeconds: requestedDuration,
    resolution: falH3ResolutionValue(),
    aspectRatio: aspectGate.carriesAspectRatio && aspectGate.ok ? aspectGate.value : ratio,
    profileMode: profile.mode,
  });
  if (!preview) return;

  const clientRequestId = `h3-${shotId}-${build.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
  /* Resolved from the plan's own references, so the option list answers the question
     for the shot as compiled rather than for a hypothetical one. */
  const motionOptions = typeof fetchGenerationOptions === "function"
    ? await fetchGenerationOptions("animate-shot", (preview.references || []).map((row) => ({ role: row.role, mediaType: row.mediaType })), { durationSeconds: Number(preview.durationSeconds) || undefined })
    : null;
  const readyMotion = (motionOptions?.options || []).filter((option) => option.actionable);
  window._falH3MotionRequest = {
    ...preview,
    options: motionOptions,
    /* The four things the shared Simple/Advanced view needs and the plan payload does not
       carry: the legal aspect list for this mode, the ratio the production actually asked
       for, whether this model can deliver it, and the note explaining a narrowed duration
       range. Stored rather than recomputed on every redraw, because they are decided once
       when the dialog opens. */
    aspectSupported: aspectGate.supported || [],
    aspectRequested: ratio,
    aspectOk: aspectGate.ok !== false,
    selectedOptionId: readyMotion.find((option) => option.modelId.startsWith("minimax-h3/"))?.optionId || readyMotion[0]?.optionId || "",
    shotId,
    buildId: build.id,
    profileId: preview.profile?.id || profile.id,
    profileName: preview.profile?.name || profile.name,
    profileMode: preview.mode || profile.mode,
    packageId: build.packageId || "",
    prompt: preview.compiledPrompt,
    clientRequestId,
  };
  window._falH3Submitting = false;
  const request = window._falH3MotionRequest;
  const images = (preview.references || []).filter((ref) => ref.mediaType === "image");
  const videos = (preview.references || []).filter((ref) => ref.mediaType === "video");
  const audio = (preview.references || []).filter((ref) => ref.mediaType === "audio");
  const limit = Number(preview.maxPromptCharacters) || 7000;
  const promptReady = preview.compiledPrompt.length <= limit;
  const [durationLow, durationHigh] = Array.isArray(preview.durationRange) && preview.durationRange.length === 2
    ? preview.durationRange
    : [5, 15];
  const durationOptions = Array.from({ length: Math.max(1, durationHigh - durationLow + 1) }, (_, i) => durationLow + i);
  const resolutions = Array.isArray(preview.resolutions) && preview.resolutions.length ? preview.resolutions : ["2K", "768P"];
  /* Named honestly: where the effective ceiling is tighter than MiniMax H3's own, the
     screen says which layer narrowed it instead of asserting either number as "the
     H3 limit". */
  const limitNote = limit < Number(preview.modelMaxPromptCharacters || 7000)
    ? `MiniMax H3 reads ${Number(preview.modelMaxPromptCharacters).toLocaleString()} characters; this backend accepts ${limit.toLocaleString()}.`
    : `MiniMax H3 and this backend both accept ${limit.toLocaleString()} characters.`;
  const durationNote = Array.isArray(preview.modelDurationRange) && (durationLow !== preview.modelDurationRange[0] || durationHigh !== preview.modelDurationRange[1])
    ? `MiniMax H3 itself renders ${preview.modelDurationRange[0]}–${preview.modelDurationRange[1]}s; this backend renders ${durationLow}–${durationHigh}s.`
    : `${durationLow}–${durationHigh} seconds.`;
  /* The shot asked for a length this backend cannot render. Said plainly, next to the
     picker, BEFORE the paid action — because submitting will refuse it rather than
     quietly render a different length, and the filmmaker is the one who chooses the
     replacement. */
  const askedDuration = Number(preview.durationRequested) || 0;
  const durationChanged = askedDuration > 0 && askedDuration !== Number(preview.durationSeconds);
  /* IS THE PACKAGE ABOUT TO BE SENT STILL ABOUT THIS SHOT?
   *
   * Same reasoning as the duration banner directly below, applied to the compiled
   * package as a whole. The ready-to-use prompt surface already marks itself OUT OF
   * DATE, but this dialog is the last screen before money is spent and it must not
   * let a stale package proceed silently. It refuses nothing: sending an older
   * package is a legitimate choice, and the filmmaker makes it knowing what changed.
   */
  const freshness = typeof packageFreshness === "function" ? packageFreshness(s, build) : { current: true, recorded: true, reasons: [] };
  /* DOGFOOD SLICE 0. This banner used to end "…or continue to send this package as
     compiled", and the paid button below it stayed enabled — a warning the screen
     itself invited the filmmaker past, on the last surface before money is spent.
     Generation is refused while the package is stale; REBUILD is the action offered,
     and the exact reasons stay on screen so nobody has to go looking for what moved. */
  const packageStale = freshness.recorded && !freshness.current;
  const freshnessBanner = packageStale
    ? `<div id="fal-h3-stale-notice" class="guided-prompt-error" data-h3-package-stale="1"><div><b>This compiled package is out of date</b><small>${esc(freshness.reasons.join("; "))}. Generation is unavailable until it is rebuilt from what the shot says now.</small></div><button class="approve-btn" onclick="closeModal();buildGuidedMotionPrompt('${attr(s.id)}',false)">REBUILD MOTION PROMPT</button></div>`
    : "";
  /* Assigned here rather than in the literal above: `durationNote` is computed from the
     preview a few lines up, and reading it before its `const` is a temporal-dead-zone
     ReferenceError that takes the whole dialog with it. */
  request.durationNote = durationNote;
  const durationBanner = durationChanged
    ? `<div id="fal-h3-duration-notice" class="guided-prompt-error"><div><b>This shot is written as ${esc(String(askedDuration))} seconds, which this backend cannot render</b><small>MiniMax H3 renders from ${preview.modelDurationRange[0]}s, but fal accepts ${durationLow}–${durationHigh}s. ${preview.durationSeconds}s is selected below — confirm it or choose another length. CineBraid will not change the length of your shot for you: submitting ${esc(String(askedDuration))}s is refused, not adjusted.</small></div></div>`
    : "";

  openModal(`<div class="h3-generation-modal"><header class="h3-generation-head"><div><span>MINIMAX H3 · PAID GENERATION</span><h3>Generate with ${esc(request.profileName)}</h3><p>This is the request CineBraid compiled from the approved package. Confirm the inputs, the prompt and the estimated spend before submission.</p></div><button class="cancel" onclick="closeModal()">Close</button></header><div class="h3-generation-scroll"><div class="modal-sub">FAL · ${esc(preview.dispatch?.model || "minimax/h3")} · compiled by ${esc(preview.compiler?.packId || "minimax-h3")} ${esc(preview.compiler?.packVersion || "")}</div><div class="candidate-evidence-facts"><span>${images.length} image${images.length === 1 ? "" : "s"}</span><span>${videos.length} video${videos.length === 1 ? "" : "s"}</span><span>${audio.length} audio</span><span id="fal-h3-prompt-fact">${preview.compiledPrompt.length.toLocaleString()}/${limit.toLocaleString()} prompt characters</span><span>Native stereo audio</span></div><div id="fal-h3-refusal" class="guided-prompt-error" hidden></div><div id="fal-h3-options"></div><section id="fal-h3-sequence" class="h3-submit-sequence" hidden></section>${freshnessBanner}${durationBanner}<div id="fal-h3-generation-view"></div><div id="fal-h3-aspect-warning" class="guided-prompt-error" ${aspectGate.ok ? "hidden" : ""}>${aspectGate.ok ? "" : `<div><b>MiniMax H3 cannot deliver ${esc(ratio)}</b><small>${esc(aspectGate.message)}</small></div>`}</div><div id="fal-h3-cost-estimate" class="h3-cost-estimate"></div><div id="fal-h3-plan-warnings"></div><div id="fal-h3-prompt-warning" class="guided-prompt-error" ${promptReady ? "hidden" : ""}><div><b>Prompt is not ready for submission</b><small>${promptReady ? "" : `Shorten this prompt to ${limit.toLocaleString()} characters before a paid submission.`}</small></div></div><section class="h3-prompt-editor"><header><div><b>Edit prompt before generation</b><small>This is the prompt CineBraid compiled and the exact text that will be sent. ${esc(limitNote)} The compiled package is preserved; any change is saved as a linked manual revision and recorded beside the compiled original.</small></div><span id="fal-h3-prompt-count">${preview.compiledPrompt.length.toLocaleString()}/${limit.toLocaleString()}</span></header><textarea id="fal-h3-prompt-editor" oninput="updateFalH3PromptEditor()" onchange="reviewFalH3PromptEdit()">${esc(preview.compiledPrompt)}</textarea><div id="fal-h3-edit-coverage" class="h3-edit-coverage" hidden></div><div class="h3-prompt-editor-actions"><label><span>Revision note · optional</span><input id="fal-h3-prompt-edit-reason" placeholder="Clarified timing, removed duplicate action…"></label><button class="ghost-btn" onclick="resetFalH3PromptEditor()">Reset compiled prompt</button></div></section><p class="hint">This submits one paid MiniMax H3 request through FAL. The returned MP4 is saved as an unapproved video candidate in this shot. The request uses an idempotency key to prevent an accidental double submission from this dialog.</p></div><footer class="modal-actions h3-generation-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button id="fal-h3-submit" class="approve-btn large" onclick="startFalH3MotionGeneration()" ${promptReady && aspectGate.ok && !preview.refusal && !packageStale ? "" : "disabled"}>START H3 GENERATION</button></footer></div>`);
  /* One slot, and this dialog now owns it: switching Simple/Advanced redraws THIS view.
     Registered before the first paint so the very first toggle has somewhere to go. */
  window._generationViewRefresh = () => renderFalH3GenerationView();
  setTimeout(() => { renderFalH3PlanPanels(); updateFalH3CostEstimate(); updateFalH3PromptEditor(); }, 0);
};

/* The H3 dialog's own controls, drawn from the plan rather than from a fixed grid.
 *
 * Duration and resolution come out of the effective capability the server already
 * computed - `durationRange` IS capability.durationSeconds and `resolutions` IS the
 * model-intersect-backend resolution list - so a value this configuration cannot render
 * has no option to select. There is no seed control because no H3 endpoint has a seed and
 * no candidate-count control because H3 returns one clip: both absences are derived from
 * the capability rather than from this function knowing anything about MiniMax. */
function falH3ControlsMarkup(plan, request) {
  const rendered = new Set(plan.rendered || []);
  const parts = [];
  if (rendered.has("durationSeconds")) {
    const [low, high] = Array.isArray(request.durationRange) && request.durationRange.length === 2
      ? request.durationRange
      : [5, 15];
    const options = Array.from({ length: Math.max(1, high - low + 1) }, (_, i) => low + i);
    parts.push(`<label><span>Duration</span><select id="fal-h3-duration" onchange="refreshFalH3Plan()">${
      options.map((n) => `<option value="${n}" ${n === Number(request.durationSeconds) ? "selected" : ""}>${n} seconds</option>`).join("")
    }</select><small>${esc(String(request.durationNote || ""))}</small></label>`);
  }
  if (rendered.has("resolution")) {
    const values = Array.isArray(request.resolutions) && request.resolutions.length ? request.resolutions : [];
    parts.push(`<label><span>Resolution</span><select id="fal-h3-resolution" onchange="refreshFalH3Plan()">${
      values.map((value) => `<option value="${attr(value)}" ${value === request.resolution ? "selected" : ""}>${esc(value)}</option>`).join("")
    }</select></label>`);
  }
  if (rendered.has("aspectRatio")) {
    const supported = Array.isArray(request.aspectSupported) ? request.aspectSupported : [];
    /* The production's own ratio stays selectable and labelled as unsupported when it is,
       because removing it would silently reframe the shot to something nobody chose. */
    const unsupportedRow = request.aspectOk === false
      ? `<option value="${attr(request.aspectRequested || "")}" selected>${esc(String(request.aspectRequested || ""))} - not supported</option>`
      : "";
    parts.push(`<label><span>Aspect ratio</span><select id="fal-h3-aspect" onchange="refreshFalH3Plan()">${unsupportedRow}${
      supported.map((value) => `<option value="${attr(value)}" ${value === request.aspectRatio ? "selected" : ""}>${esc(value)}</option>`).join("")
    }</select></label>`);
  }
  return parts.length ? `<div class="h3-settings-grid">${parts.join("")}</div>` : "";
}

/* What this dialog may draw, and - the same answer read differently - what
   startFalH3MotionGeneration() is allowed to put in the body. */
function falH3ControlPlan(mode) {
  const request = window._falH3MotionRequest || {};
  return generationRequestPlan({
    surface: CINEBRAID_REQUEST_SURFACE_IDS.motionH3,
    mode,
    capability: capabilityFromPlan(request, {
      aspectRatios: request.carriesAspectRatio
        ? [...(request.aspectSupported || []), ...(request.aspectOk === false && request.aspectRequested ? [request.aspectRequested] : [])]
        /* The mode carries no aspect_ratio field at all - i2v and flf do not - so the
           legal set is genuinely empty and the control does not exist. An empty ARRAY,
           never null: null would mean "nobody constrained it" and would draw a picker for
           a field the request has no room for. */
        : [],
      /* H3 renders one clip per request and declares no candidateBatching, so there is no
         "number of options" control to draw. */
      candidateBatching: false,
      referenceWeights: false,
    }),
    /* A format this model cannot deliver disables the paid button, and the control that
       fixes it must not sit behind a panel the filmmaker has not opened. */
    force: request.aspectOk === false ? ["aspectRatio"] : [],
  });
}

function renderFalH3GenerationView(mode) {
  const host = document.getElementById("fal-h3-generation-view");
  if (!host) return;
  const request = window._falH3MotionRequest || {};
  const view = generationViewMode(mode || generationViewPreference());
  const plan = falH3ControlPlan(view);
  const resolved = request.options || null;
  host.innerHTML = generationViewMarkup({
    mode: view,
    plan,
    option: selectedGenerationOption(resolved, request.selectedOptionId),
    recommendation: generationRecommendationFor(resolved),
    rate: generationRateFor("video"),
    /* Seconds, because the motion rate is per second. The quantity a price multiplies and
       the quantity the record keeps are the same number by construction. */
    quantity: Number(request.durationSeconds) || 0,
    limits: {
      rows: [{ value: 1, label: "clip per request" }],
      /* Truthful about THIS path and nothing more: a running H3 job can genuinely be
         cancelled, so the dialog says that. It claims no unattended retry policy and no
         early-stop heuristic, because this path has neither. */
      stopEarly: "One clip is returned as an unapproved candidate. A request already at the provider can be cancelled from the shot while it runs.",
    },
    controlsMarkup: falH3ControlsMarkup(plan, request),
    /* The compiler's own coverage record, rendered by the shared shell. */
    coverage: request.coverage,
  });
}
window.startFalH3MotionGeneration = async () => {
  const request = window._falH3MotionRequest;
  if (!request || window._falH3Submitting) return;
  /* SLICE 5b EXECUTION GATE — THE PAID POST ITSELF, and the last one there is.

     A dialog opened while the intent still matched, left open, and submitted after the
     intent changed is the one path the two gates above cannot see. The request carries
     the shot and the profile it was built for, so the question is re-asked here from the
     record as it is NOW. This is the boundary that spends money; it fails closed. */
  const gateShot = typeof shotById === "function" ? shotById(request.shotId) : null;
  /* Resolved exactly as openFalH3MotionModal resolves it — `profileById` is a LOCAL
     function inside public/v607-composer.js's IIFE and is not a global, so a lookup that
     trusted it would resolve `null`, and a null profile refuses nothing. */
  const gateProfile = typeof profileById === "function"
    ? profileById(request.profileId || "")
    : (PROMPT_LIBRARY?.profiles || []).find((item) => item.id === request.profileId) || null;
  const gateRefusal = typeof guidedMotionIntentRefusal === "function" ? guidedMotionIntentRefusal(gateShot, gateProfile) : "";
  if (gateRefusal) return toast(gateRefusal);
  /* DOGFOOD SLICE 0 — THE FRESHNESS GATE, AT THE BOUNDARY THAT SPENDS MONEY.

     falH3MotionPromptAction() already withholds the button and the footer already
     disables its own, but neither is the boundary: this dialog can be opened
     programmatically, and an input can go stale while it sits open. The package is
     re-checked against the shot AS IT IS NOW, for the same reason the intent gate
     directly above is re-asked here.

     A package with no recorded dependency snapshot is NOT refused — see
     falH3MotionPromptAction. Refusing on an absence would block every package
     compiled before dependencies were captured, on evidence nobody has. */
  const gateBuilds = gateShot && typeof resolvePromptBuildList === "function"
    ? resolvePromptBuildList(P, ensureShotCreation(gateShot).motionPromptBuilds || [])
    : [];
  const gateBuild = gateBuilds.find((item) => item.id === request.buildId) || null;
  const gateFreshness = gateShot && gateBuild && typeof packageFreshness === "function" ? packageFreshness(gateShot, gateBuild) : null;
  if (gateFreshness && gateFreshness.recorded && !gateFreshness.current)
    return toast(`This compiled package is out of date: ${gateFreshness.reasons.join("; ")}. Rebuild the motion prompt before generating.`);
  const limit = falH3PromptLimit();
  const editedPrompt = String(document.getElementById("fal-h3-prompt-editor")?.value ?? request.prompt ?? "").trim();
  if (!editedPrompt) return toast("Enter a MiniMax H3 prompt before generation");
  if (editedPrompt.length > limit) return toast(`MiniMax H3 prompt exceeds this configuration's ${limit.toLocaleString()}-character limit`);
  if (request.refusal) return toast(request.refusal.error);
  /* Checked again at the moment of dispatch rather than only when the dialog opened,
     so a retry, a resumed dialog or a changed picker cannot walk past the refusal.
     Returning here leaves the dialog, the prompt and every setting untouched. */
  const gate = falH3AspectGate();
  if (!gate.ok) {
    updateFalH3AspectGuard();
    return toast(gate.message);
  }
  request.prompt = editedPrompt;
  const revisionReason = String(document.getElementById("fal-h3-prompt-edit-reason")?.value || "Edited in the MiniMax H3 generation preflight").trim();
  /* An edit is recorded as its own revision of the package, so the compiled original
     and the text the filmmaker chose to send both survive. The build the SERVER
     compiles from is deliberately left as the original: an edit changes the prompt
     that is dispatched, never the structured direction it was compiled from. */
  if (editedPrompt !== String(request.compiledPrompt || "").trim() && typeof createManualMotionPromptRevision === "function") {
    try {
      const revised = createManualMotionPromptRevision(request.shotId, request.buildId, editedPrompt, revisionReason);
      if (revised?.id) request.revisionBuildId = revised.id;
    } catch (error) {
      return toast("Could not preserve the edited prompt revision: " + error.message);
    }
  }
  window._falH3Submitting = true;
  const button = document.getElementById("fal-h3-submit");
  if (button) { button.disabled = true; button.textContent = "SUBMITTING…"; }
  /* THE PLAN THE SCREEN IS ACTUALLY SHOWING, recomputed at the moment of dispatch rather
     than remembered from when the dialog opened. A filmmaker who set a size under
     Advanced and returned to Simple is submitting a Simple request, and this is where
     that becomes true of the payload rather than only of the screen. */
  const dispatchPlan = falH3ControlPlan(generationViewPreference());
  const body = {
    purpose: "motion-h3",
    clientRequestId: request.clientRequestId,
    shotId: request.shotId,
    /* The package the server compiles. References, endpoints, roles and settings all
       come from it; this request body carries no reference list of its own, because a
       second list is a second chance to disagree with the one that was approved. */
    sourceBuildId: request.buildId,
    packageId: request.packageId,
    profileId: request.profileId,
    profileName: request.profileName,
    profileFamily: "minimax-h3",
    profileMode: request.profileMode,
    /* The text to send. Identical to the compiled prompt unless it was edited above, in
       which case the server records both. */
    prompt: request.prompt,
    /* `outputCount` is deliberately absent. The server forces 1 for motion-h3 and ignores
       whatever the body says, so asserting a number here would be the browser claiming a
       decision it does not make — and H3 declares no candidateBatching, so there is no
       control behind it either. */
    durationSeconds: Number(document.getElementById("fal-h3-duration")?.value || request.durationSeconds || 5),
    resolution: document.getElementById("fal-h3-resolution")?.value || request.resolution || falH3ResolutionValue(),
    aspectRatio: gate.carriesAspectRatio ? gate.value : request.aspectRatio || "",
    /* WHAT THIS SCREEN WAS SHOWING. The motion dialog resolves its model from the
       package's own profile rather than from a picker, so it names no option id - and
       says nothing rather than claiming one. */
    generationRequest: generationRequestDeclaration({
      surface: CINEBRAID_REQUEST_SURFACE_IDS.motionH3,
      viewMode: generationViewPreference(),
    }),
  };
  /* THE GATE. Every control key the active view does not render is removed here, so a
     value can only reach the provider if the screen offered it and this model supports
     it. Nothing else in the body is touched: the prompt, the package identity and the
     profile are the request itself, not settings. */
  const gated = restrictPayloadToPlan(body, dispatchPlan);
  try {
    await flushPendingProjectSave();
    closeModal();
    const response = await fetch("/api/generation/fal/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(await paidDispatchPermitFor(gated.payload)) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not start MiniMax H3 generation");
    FAL_GENERATION_JOBS = [...(FAL_GENERATION_JOBS || []).filter((job) => job.id !== data.job.id), data.job];
    route();
    toast(data.reused ? "Reattached to the existing MiniMax H3 request; no duplicate charge was submitted" : "MiniMax H3 video queued on FAL");
    pollFalGeneration(data.job.id);
  } catch (error) {
    toast("MiniMax H3 generation failed: " + error.message);
    route();
  } finally {
    window._falH3Submitting = false;
  }
};


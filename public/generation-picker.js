/* The capability-aware generation picker.
 *
 * One presentation for every filmmaker task — create a blocking frame, create or edit
 * a frame, animate a shot — driven entirely by what /api/generation/options resolves.
 * Nothing on this screen decides what is available: it renders six answers the server
 * computed from the model catalogue, this installation's connections and CineBraid's
 * own adapter inventory.
 *
 * WHAT THIS FIXES. The audit finding was a picker whose choices could be selected and
 * then could not generate. So the rule here is that a row is pressable only when the
 * server said `actionable`, every other row carries the sentence explaining why not,
 * and the reason is visible BEFORE the paid button rather than after it.
 *
 * NO RANKING. The order is the server's, which is availability band then the
 * catalogue's own written priority. This file never sorts, never scores and never
 * calls anything "best" — and where a use-case guide has not taken a decision it says
 * "awaiting evaluation", because the blocking-frame winner genuinely has not been
 * chosen and inventing a label for it would be the recommendation nobody made.
 */

/* ---------------------------------------------------------------------------
   The option list. */

/* The four states, named for what they actually are.
 *
 * `not-implemented` read "Not available yet", which sounds like a statement about the
 * PROVIDER and invites a filmmaker to go looking for a connection to make. The state
 * means something narrower and entirely CineBraid's own: the provider serves this
 * model, and CineBraid owns no adapter that can build the request. The resolver has
 * always said so in the sentence beneath the chip; the chip now agrees with it, so
 * "you need to connect this" and "we cannot send this" stop sharing a label. */
const GENERATION_STATE_LABELS = {
  ready: "Available",
  "setup-required": "Needs setup",
  "not-implemented": "No CineBraid adapter",
  incompatible: "Does not fit this shot",
};

async function fetchGenerationOptions(task, references = [], extra = {}) {
  try {
    const response = await fetch("/api/generation/options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task, references, ...extra }),
    });
    const data = await response.json();
    if (!response.ok) return null;
    return data;
  } catch { return null; }
}

/* What a model is good FOR, in the filmmaker's terms, taken from the catalogue's own
   use-case tags. A job, never a compliment: "blocking frames" is a task this model can
   do, not a claim that it does it best. */
const GENERATION_USE_CASE_WORDS = {
  "blocking-frame": "blocking frames",
  "fast-image-iteration": "fast iteration",
  "hero-still": "finished frames",
  "image-editing": "editing frames",
  "local-image": "running locally",
  "text-in-image": "readable text and signage",
  "style-reference": "carrying a look",
  "cinematic-ref2vid": "shots built from references",
  "prompt-adherent-video": "doing what the prompt says",
  "image-to-video": "moving an approved frame",
  "keyframe-video": "passing through approved beats",
  "long-form-video": "long single takes",
  "audio-native-video": "picture with sound",
  "local-video": "running locally",
};
function generationUseCaseWords(option, task) {
  const words = (option.detail?.useCases || [])
    .filter((useCase) => useCase !== "local-image" && useCase !== "local-video")
    .map((useCase) => GENERATION_USE_CASE_WORDS[useCase])
    .filter(Boolean);
  if (!words.length) return "";
  /* The task's own use case first where the model carries it, because that is the
     reason this row is on this screen at all. */
  const lead = GENERATION_USE_CASE_WORDS[task];
  const ordered = lead && words.includes(lead) ? [lead, ...words.filter((word) => word !== lead)] : words;
  return ordered.slice(0, 3).join(", ");
}

function generationOptionRow(option, task, selectedId) {
  const state = GENERATION_STATE_LABELS[option.availability] || option.availability;
  const where = [option.where, option.surfaceName].filter(Boolean).join(" · ");
  const good = generationUseCaseWords(option, task);
  const reason = (option.reasons || [])[0];
  /* One sentence, and it is either the reason it cannot be used or what it is for.
     Never both: a row that explains itself twice explains itself badly. */
  const note = option.actionable
    ? (good ? `Good for: <em>${esc(good)}</em>` : "")
    : `${esc(reason?.message || "")}${reason?.action ? ` <em>${esc(reason.action)}</em>` : ""}`;
  const selected = option.optionId === selectedId;
  const action = option.actionable
    ? `<button class="chip${selected ? " primary" : ""}" onclick="selectGenerationOption('${attr(option.optionId)}')"${selected ? " disabled" : ""}>${selected ? "Selected" : "Use this"}</button>`
    : `<button class="chip" disabled>${esc(state)}</button>`;
  return `<div class="gen-option is-${esc(option.availability)}${selected ? " is-selected" : ""}"><div class="gen-option-main"><div class="gen-option-name"><b>${esc(option.modelName)}</b><span class="gen-option-where">${esc(where)}</span><span class="gen-option-state">${esc(state)}</span></div>${note ? `<div class="gen-option-note">${note}</div>` : ""}</div><div>${action}</div></div>`;
}

/* The advanced view. Everything the normal one deliberately leaves out: the exact
   model id, the exact provider surface, the exact mode, and the catalogue's own
   status — plus the rows a normal picker hides because nothing establishes what they
   do or CineBraid has decided against them. */
function generationAdvancedRows(resolved) {
  const rows = (resolved.options || []).map((option) => {
    const facts = [
      option.modelId,
      option.surfaceId || "no provider",
      option.mode,
      option.detail?.catalogueStatus,
      option.detail?.offeringState || "not offered",
      option.dispatchable ? `adapter ${option.detail?.adapterId}` : "no adapter",
      option.connected ? "connected" : "not connected",
    ].filter(Boolean).join(" · ");
    return `<li><span class="gen-option-detail">${esc(facts)}</span></li>`;
  });
  if (!rows.length) return "";
  return `<details class="gen-options-advanced"><summary>Technical detail · ${rows.length} model and provider combination${rows.length === 1 ? "" : "s"}</summary><ul>${rows.join("")}</ul></details>`;
}

/* The use-case guide, rendered honestly. An undecided guide says so and names its
   shortlist; it never promotes a candidate into a recommendation. */
function generationGuidePanel(guide) {
  if (!guide) return "";
  if (guide.decisionState !== "decided")
    return `<div class="gen-options-guide"><b>No recommended model yet</b><span>CineBraid has not evaluated which model is best for this job, so it is not telling you. Every option below is offered on capability and availability alone.</span></div>`;
  return "";
}

function renderGenerationOptions(resolved, task, selectedId) {
  if (!resolved) return "";
  const normal = new Set(resolved.normal || []);
  const shown = (resolved.options || []).filter((option) => normal.has(option.optionId));
  const ready = shown.filter((option) => option.actionable).length;
  const rows = shown.map((option) => generationOptionRow(option, task, selectedId)).join("");
  return `<section class="gen-options"><header><b>Generate with</b><small>${ready} available · ${shown.length} shown</small></header>${generationGuidePanel(resolved.guide)}${rows || `<div class="gen-option is-not-implemented"><div class="gen-option-main"><div class="gen-option-name"><b>Nothing can generate this yet</b></div></div></div>`}${generationAdvancedRows(resolved)}</section>`;
}

window.selectGenerationOption = (optionId) => {
  const request = window._falFrameRequest;
  if (!request) return;
  request.selectedOptionId = optionId;
  renderFalFramePanels();
};

/* ---------------------------------------------------------------------------
   Create blocking frame · Create frame · Edit frame.

   The compiled still-image dialog. It shows what CineBraid intends to create, the
   approved references it will use, the honest option list, the compiled prompt, and
   the output settings — then submits ONE paid request built from the plan it just
   displayed. */

async function fetchFalImagePlan(purpose, shotId, buildId, extra = {}) {
  try {
    const response = await fetch("/api/generation/fal/image/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purpose, shotId, sourceBuildId: buildId, ...extra }),
    });
    const data = await response.json();
    if (!response.ok) {
      toast(data.error || "CineBraid could not compile this frame");
      return null;
    }
    return data;
  } catch (error) {
    toast("Could not compile the frame request: " + error.message);
    return null;
  }
}

/* Which approved references travel, and what each one is FOR. Read from the plan's
   own manifest rather than from the shot, because the plan is what will be sent. */
function falFrameReferenceRows(request) {
  const references = request?.references || [];
  if (!references.length) return `<section class="h3-submit-sequence"><b>No approved references</b><small>This frame will be created from the written direction alone.</small></section>`;
  const rows = references.map((ref) => `<li><b>${esc(String(ref.role || "reference").replace(/-/g, " "))}</b><span>${esc(ref.label || ref.refId)}${ref.purpose ? ` · ${esc(ref.purpose)}` : ""}</span></li>`).join("");
  return `<section class="h3-submit-sequence"><b>Approved references CineBraid will use</b><small>Each one and what it is carrying. Bound by its production role, not by list order.</small><ol>${rows}</ol></section>`;
}

function falFrameWarningRows(request) {
  const rows = (request?.warnings || []).filter((row) => row && row.message);
  if (!rows.length) return "";
  return `<section class="h3-plan-warnings"><b>${rows.length} note${rows.length === 1 ? "" : "s"} from compilation</b><ul>${rows.map((row) => `<li><span>${esc(row.message)}</span>${row.action ? `<small>${esc(row.action)}</small>` : ""}</li>`).join("")}</ul></section>`;
}

/* The one-line summary of what is about to be asked for. Re-rendered rather than
   written once, because size, quality and reference count are all compiler inputs: a
   dialog that showed 2048x1152 beside a picker set to 1024x1024 would be stating the
   previous request as though it were this one. */
function falFrameFacts(request) {
  const references = request.references || [];
  return [
    `${references.length} approved reference${references.length === 1 ? "" : "s"}`,
    request.size || "auto",
    request.aspectRatio || "",
    `${String(request.compiledPrompt || "").length.toLocaleString()} characters`,
    "Candidate only · approval required",
  ].filter(Boolean).map((fact) => `<span>${esc(fact)}</span>`).join("");
}

function renderFalFramePanels() {
  const request = window._falFrameRequest || {};
  const facts = document.getElementById("fal-frame-facts");
  if (facts) facts.innerHTML = falFrameFacts(request);
  const options = document.getElementById("fal-frame-options");
  if (options) options.innerHTML = renderGenerationOptions(request.options, request.task, request.selectedOptionId);
  const references = document.getElementById("fal-frame-references");
  if (references) references.innerHTML = falFrameReferenceRows(request);
  const notes = document.getElementById("fal-frame-warnings");
  if (notes) notes.innerHTML = falFrameWarningRows(request);
  renderFalFrameGenerationView();
  const refusalPanel = document.getElementById("fal-frame-refusal");
  if (refusalPanel) {
    refusalPanel.hidden = !request.refusal;
    if (request.refusal) refusalPanel.innerHTML = `<div><b>This frame cannot be submitted as it stands</b><small>${esc(request.refusal.error)}</small></div>`;
  }
  updateFalFrameSubmitState();
}

/* The full submit condition, recomputed rather than a one-way disable: fixing the
   problem has to give the button back, or a refusal becomes a dead end. */
window.updateFalFrameSubmitState = () => {
  const request = window._falFrameRequest || {};
  const submit = document.getElementById("fal-frame-submit");
  if (!submit) return;
  const prompt = String(document.getElementById("fal-frame-prompt-editor")?.value ?? "");
  const chosen = (request.options?.options || []).find((option) => option.optionId === request.selectedOptionId);
  /* A chosen model CineBraid cannot compile for is refused here rather than
     discovered at dispatch. Only one image model has a pack today; this is what stops
     that from being an assumption. */
  const mismatch = chosen && chosen.modelId !== request.planModelId;
  submit.disabled = !prompt.trim() || !!request.refusal || !!window._falFrameSubmitting || !chosen || mismatch;
  const note = document.getElementById("fal-frame-model-note");
  if (note) {
    note.hidden = !mismatch;
    if (mismatch) note.innerHTML = `<div><b>CineBraid cannot compile for ${esc(chosen.modelName)} yet</b><small>The compiled request on this screen was written for ${esc(request.planModelName || request.planModelId)}. Choose that option to submit.</small></div>`;
  }
};

window.updateFalFramePrompt = () => {
  const request = window._falFrameRequest || {};
  const editor = document.getElementById("fal-frame-prompt-editor");
  const prompt = String(editor?.value ?? request.prompt ?? "");
  request.prompt = prompt;
  const count = document.getElementById("fal-frame-prompt-count");
  const changed = prompt.trim() !== String(request.compiledPrompt || "").trim();
  if (count) count.textContent = `${prompt.length.toLocaleString()} characters${changed ? " · edited" : ""}`;
  updateFalFrameSubmitState();
};

window.resetFalFramePrompt = () => {
  const request = window._falFrameRequest || {};
  const editor = document.getElementById("fal-frame-prompt-editor");
  if (editor) editor.value = request.compiledPrompt || "";
  const panel = document.getElementById("fal-frame-edit-coverage");
  if (panel) { panel.hidden = true; panel.innerHTML = ""; }
  updateFalFramePrompt();
};

/* What an edit removed, checked against the compiler's own record with the same
   deterministic test the compiler uses on its own output. Not a review and not a
   refusal — the words are the filmmaker's — but the cost of the change is stated
   before it is paid for rather than discovered in the result. */
window.reviewFalFramePromptEdit = async () => {
  const request = window._falFrameRequest;
  const panel = document.getElementById("fal-frame-edit-coverage");
  if (!request || !panel) return;
  const prompt = String(document.getElementById("fal-frame-prompt-editor")?.value ?? "");
  if (prompt.trim() === String(request.compiledPrompt || "").trim()) {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }
  const preview = await fetchFalImagePlan(request.purpose, request.shotId, request.buildId, {
    ...falFrameOutputSettings(),
    aspectRatio: request.aspectRatio,
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

function falFrameOutputSettings() {
  return {
    resolution: document.getElementById("fal-frame-size")?.value || "",
    quality: document.getElementById("fal-frame-quality")?.value || "",
    outputCount: Number(document.getElementById("fal-frame-count")?.value || 1),
  };
}

/* Re-compiles when an output setting changes, because size and quality are compiler
   inputs: a different size is a different plan, and showing the old prompt beside a
   new size would put the dialog back to guessing. */
window.refreshFalFramePlan = async () => {
  const request = window._falFrameRequest;
  if (!request || window._falFrameSubmitting) return;
  const edited = String(document.getElementById("fal-frame-prompt-editor")?.value ?? "");
  const keepEdit = edited.trim() && edited.trim() !== String(request.compiledPrompt || "").trim();
  const preview = await fetchFalImagePlan(request.purpose, request.shotId, request.buildId, {
    ...falFrameOutputSettings(),
    aspectRatio: request.aspectRatio,
  });
  if (!preview) return;
  Object.assign(request, preview, { prompt: keepEdit ? edited : preview.compiledPrompt });
  const editor = document.getElementById("fal-frame-prompt-editor");
  if (editor && !keepEdit) editor.value = preview.compiledPrompt;
  renderFalFramePanels();
  updateFalFramePrompt();
};

const FAL_FRAME_TASK_TITLES = {
  blocking: { task: "blocking-frame", title: "Create blocking frame", lead: "A fast, cheap layout that fixes composition, framing, staging and who is where. It is not meant to be beautiful — it is meant to be right." },
  frame: { task: "create-frame", title: "Create frame", lead: "A production still for this shot, built from the approved references." },
};

window.openFalFrameGenerationModal = async (purpose, shotId, frameId = "", buildId = "") => {
  const shot = shotById(shotId);
  if (!shot) return toast("Shot is unavailable");
  if (!falGenerationReady()) {
    openModal(`<h3>Connect fal first</h3><p class="modal-confirm-message">Enable fal image generation and add the API key in Settings. The key remains on the CineBraid server.</p><div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button><button class="approve-btn" onclick="closeModal();location.hash='#/settings'">OPEN SETTINGS</button></div>`);
    return;
  }
  /* Unsaved edits reach the server through the project document, and the plan is
     compiled from the stored package — so the save has to land before the compile. */
  if (typeof flushPendingProjectSave === "function") await flushPendingProjectSave();

  const kind = FAL_FRAME_TASK_TITLES[purpose] || FAL_FRAME_TASK_TITLES.frame;
  const aspectRatio = typeof shotAspectLabel === "function" ? shotAspectLabel(P, shot) : "16:9";
  const cfg = falGenerationConfig();
  const defaultCount = Number(purpose === "blocking" ? cfg.blockingOutputs || 2 : cfg.frameOutputs || 2);
  const preview = await fetchFalImagePlan(purpose, shotId, buildId, { aspectRatio, outputCount: defaultCount });
  if (!preview) return;

  const task = preview.mode === "edit" || preview.mode === "inpaint" ? "edit-frame" : kind.task;
  const options = await fetchGenerationOptions(task, (preview.references || []).map((row) => ({ role: row.role, mediaType: row.mediaType })));
  const ready = (options?.options || []).filter((option) => option.actionable);
  const planOption = ready.find((option) => option.modelId === (preview.compiler?.packId === "gpt-image-2" ? "gpt-image-2/standard" : ""));

  window._falFrameRequest = {
    ...preview,
    purpose,
    task,
    shotId,
    frameId,
    buildId: preview.source?.buildId || buildId,
    packageId: preview.source?.packageId || "",
    aspectRatio,
    prompt: preview.compiledPrompt,
    options,
    planModelId: "gpt-image-2/standard",
    planModelName: "GPT Image 2",
    selectedOptionId: (planOption || ready[0])?.optionId || "",
    clientRequestId: `img-${shotId}-${preview.source?.buildId || buildId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  };
  window._falFrameSubmitting = false;

  const sizes = Array.isArray(preview.sizes) && preview.sizes.length ? preview.sizes : ["auto"];
  const qualities = Array.isArray(preview.qualityTiers) && preview.qualityTiers.length ? preview.qualityTiers : ["auto", "low", "medium", "high"];
  /* The two lists the shared view draws from, resolved on the same terms the dialog has
     always used: the capability's own sizes where it has them, and the model's quality
     tiers where it declares them. Assigned after their `const`s rather than inside the
     literal above — reading a `const` before its declaration is a temporal-dead-zone
     ReferenceError that takes the whole dialog with it. */
  window._falFrameRequest.sizes = sizes;
  window._falFrameRequest.qualityTiers = qualities;
  const frameLabel = preview.source?.frameLabel ? ` ${preview.source.frameLabel}` : "";
  openModal(`<div class="h3-generation-modal"><header class="h3-generation-head"><div><span>PAID GENERATION</span><h3>${esc(kind.title)}${esc(frameLabel)}</h3><p>${esc(kind.lead)}</p></div><button class="cancel" onclick="closeModal()">Close</button></header><div class="h3-generation-scroll"><div class="modal-sub">${esc(preview.dispatch?.model || "fal")} · compiled by ${esc(preview.compiler?.packId || "gpt-image-2")} ${esc(preview.compiler?.packVersion || "")}</div><div id="fal-frame-facts" class="candidate-evidence-facts"></div><div class="gen-prompt-count" id="fal-frame-prompt-count">${preview.compiledPrompt.length.toLocaleString()} characters</div><div id="fal-frame-refusal" class="guided-prompt-error" hidden></div><div id="fal-frame-model-note" class="guided-prompt-error" hidden></div><div id="fal-frame-options"></div><div id="fal-frame-references"></div><div id="fal-frame-generation-view"></div><div id="fal-frame-warnings"></div><section class="h3-prompt-editor"><header><div><b>Edit prompt before generation</b><small>This is the prompt CineBraid compiled and the exact text that will be sent. The compiled package is preserved; any change is recorded beside the compiled original.</small></div></header><textarea id="fal-frame-prompt-editor" oninput="updateFalFramePrompt()" onchange="reviewFalFramePromptEdit()">${esc(preview.compiledPrompt)}</textarea><div id="fal-frame-edit-coverage" class="h3-edit-coverage" hidden></div><div class="h3-prompt-editor-actions"><button class="ghost-btn" onclick="resetFalFramePrompt()">Reset compiled prompt</button></div></section><p class="hint">This submits one paid fal request. Returned images are saved as unapproved candidates in this shot and do not become canon until you approve one. The request uses an idempotency key to prevent an accidental double submission from this dialog.</p></div><footer class="modal-actions h3-generation-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button id="fal-frame-submit" class="approve-btn large" onclick="startFalFrameGeneration()" disabled>GENERATE</button></footer></div>`);
  window._generationViewRefresh = () => renderFalFrameGenerationView();
  setTimeout(() => { renderFalFramePanels(); updateFalFramePrompt(); }, 0);
};

/* The frame dialog's own controls, drawn from the plan rather than from a fixed grid.
 *
 * Size comes from `capability.resolutions` — the sizes this model and this provider BOTH
 * document, already intersected server-side — and quality from the model's own declared
 * tiers. The candidate count exists because GPT Image 2 declares `candidateBatching`; a
 * model that did not would lose the picker rather than gain a disabled one. */
function falFrameControlsMarkup(plan, request) {
  const rendered = new Set(plan.rendered || []);
  const parts = [];
  if (rendered.has("outputCount"))
    parts.push(`<label><span>Number of options</span><select id="fal-frame-count" onchange="refreshFalFramePlan()">${
      [1, 2, 3, 4].map((n) => `<option value="${n}" ${n === Number(request.outputCount) ? "selected" : ""}>${n}</option>`).join("")
    }</select></label>`);
  if (rendered.has("quality")) {
    const tiers = Array.isArray(request.qualityTiers) && request.qualityTiers.length ? request.qualityTiers : [];
    parts.push(`<label><span>Quality</span><select id="fal-frame-quality" onchange="refreshFalFramePlan()">${
      tiers.map((value) => `<option value="${attr(value)}" ${value === request.quality ? "selected" : ""}>${esc(value[0].toUpperCase() + value.slice(1))}</option>`).join("")
    }</select></label>`);
  }
  if (rendered.has("resolution")) {
    const values = Array.isArray(request.sizes) && request.sizes.length ? request.sizes : [];
    parts.push(`<label><span>Size</span><select id="fal-frame-size" onchange="refreshFalFramePlan()">${
      values.map((value) => `<option value="${attr(value)}" ${value === request.size ? "selected" : ""}>${esc(value)}</option>`).join("")
    }</select><small>Sizes this model and provider both document. CineBraid picks the smallest at this shot's format unless you choose otherwise.</small></label>`);
  }
  return parts.length ? `<div class="h3-settings-grid">${parts.join("")}</div>` : "";
}

/* What this dialog may draw, and what startFalFrameGeneration() may put in the body.
 *
 * ASPECT RATIO IS NOT IN THE VOCABULARY, deliberately. This dialog SHOWS the shot's
 * format and does not offer a picker for it — the compiled prompt was written at that
 * ratio, and a control here could only disagree with it. Leaving the key ungoverned is
 * what lets the production's real ratio travel untouched; declaring it and then hiding it
 * would strip it and hand the server its literal "16:9" fallback. */
function falFrameControlPlan(mode) {
  const request = window._falFrameRequest || {};
  return generationControlPlan({
    capability: capabilityFromPlan(request, {
      /* Still-image plans return a candidate count, so the batching capability is real
         here in a way it is not for a one-clip motion request. */
      candidateBatching: true,
      referenceWeights: false,
    }),
    mode,
    only: ["outputCount", "quality", "resolution", "seed", "cfgScale", "steps", "referenceStrength"],
  });
}

function renderFalFrameGenerationView(mode) {
  const host = document.getElementById("fal-frame-generation-view");
  if (!host) return;
  const request = window._falFrameRequest || {};
  const view = generationViewMode(mode || generationViewPreference());
  const plan = falFrameControlPlan(view);
  const resolved = request.options || null;
  const count = Math.max(1, Number(request.outputCount) || 1);
  host.innerHTML = generationViewMarkup({
    mode: view,
    plan,
    option: selectedGenerationOption(resolved, request.selectedOptionId),
    recommendation: generationRecommendationFor(resolved),
    rate: generationRateFor("image"),
    /* Images, because the image rate is per image — and the count the PLAN settled on
       rather than the one the picker asked for, which is the same quantity the ledger
       will record at submission. */
    quantity: count,
    limits: {
      rows: [{ value: count, label: count === 1 ? "candidate returned" : "candidates returned" }],
      /* No early stop is claimed: this is a single request, not a run. Saying otherwise
         would invent a policy this path does not have. */
      stopEarly: "Every returned image is an unapproved candidate. Nothing becomes canon until you approve one.",
    },
    controlsMarkup: falFrameControlsMarkup(plan, request),
  });
}

window.startFalFrameGeneration = async () => {
  const request = window._falFrameRequest;
  if (!request || window._falFrameSubmitting) return;
  const prompt = String(document.getElementById("fal-frame-prompt-editor")?.value ?? request.prompt ?? "").trim();
  if (!prompt) return toast("Enter a prompt before generation");
  if (request.refusal) return toast(request.refusal.error);
  request.prompt = prompt;
  window._falFrameSubmitting = true;
  const button = document.getElementById("fal-frame-submit");
  if (button) { button.disabled = true; button.textContent = "SUBMITTING…"; }
  const settings = falFrameOutputSettings();
  const body = {
    purpose: request.purpose,
    /* The marker that selects the compiled path. Without it the server takes the
       pre-C2b route, which is what the blocking-revision and correction flows still
       need — so this is opt-in per request rather than a mode the server infers. */
    imagePlan: true,
    clientRequestId: request.clientRequestId,
    shotId: request.shotId,
    frameId: request.frameId,
    frameLabel: request.source?.frameLabel || "A",
    /* The package the server compiles. References, roles and settings all come from
       it; this request body carries no reference list of its own, because a second
       list is a second chance to disagree with the one that was approved. */
    sourceBuildId: request.buildId,
    packageId: request.packageId,
    profileId: request.profile?.id || "",
    profileName: request.profile?.name || "",
    prompt: request.prompt,
    aspectRatio: request.aspectRatio,
    ...settings,
  };
  /* THE GATE, recomputed at dispatch against the view that is actually showing. A size
     chosen under Advanced and abandoned by a return to Simple does not travel. */
  const gated = restrictPayloadToPlan(body, falFrameControlPlan(generationViewPreference()));
  try {
    await flushPendingProjectSave();
    closeModal();
    const response = await fetch("/api/generation/fal/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(gated.payload) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not start generation");
    FAL_GENERATION_JOBS = [...(FAL_GENERATION_JOBS || []).filter((job) => job.id !== data.job.id), data.job];
    route();
    toast(data.reused ? "Reattached to the existing request; no duplicate charge was submitted" : "Frame generation queued on fal");
    pollFalGeneration(data.job.id);
  } catch (error) {
    toast("Generation failed: " + error.message);
    route();
  } finally {
    window._falFrameSubmitting = false;
  }
};

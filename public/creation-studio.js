/* ---------- creation-first project / asset / shot workflow ---------- */
const CREATION_IMAGE_FAMILIES = [
  "nano-banana-2",
  "gpt-image-2",
  "krea-2",
  "flux-2",
];

const CREATION_START_PATH_KEY = "cinebraid-creation-start-path";

const GUIDED_PROMPT_TIMEOUTS = { compile: 30000, improve: 570000 };
const GUIDED_PROMPT_OPS = window.__cinebraidPromptOps || (window.__cinebraidPromptOps = new Map());
function guidedPromptOpKey(kind, shotId, frameId = "") {
  return `${kind}:${shotId}:${frameId}`;
}
function guidedPromptOp(kind, shotId, frameId = "") {
  return GUIDED_PROMPT_OPS.get(guidedPromptOpKey(kind, shotId, frameId)) || null;
}
function setGuidedPromptOp(kind, shotId, frameId, value) {
  const key = guidedPromptOpKey(kind, shotId, frameId);
  if (value) GUIDED_PROMPT_OPS.set(key, value);
  else GUIDED_PROMPT_OPS.delete(key);
}
async function guidedPromptRequest(url, options, timeoutMs, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let activityId = "";
  try {
    let payload = {};
    try { payload = typeof options?.body === "string" ? JSON.parse(options.body) : {}; } catch {}
    const usesAssistant = payload.useLLM === true || /improv|assistant|advisor/i.test(String(label || ""));
    const automationPromptActive = typeof V626_ACTIVE_AUTOMATION_RUNS !== "undefined" && [...V626_ACTIVE_AUTOMATION_RUNS].some((runId) => { const run = typeof v641RunById === "function" ? v641RunById(runId) : (AUTOMATION_RUNS || []).find((item) => item.id === runId); return run?.steps?.[run?.current?.stepKey || ""]?.kind === "prompt"; });
    if (usesAssistant && !automationPromptActive && typeof v641StartManualActivity === "function") activityId = v641StartManualActivity("LOCAL AI · PROMPT ADVISOR", label || "Improving prompt", "Preparing context and sending the prompt to the configured local AI. Automatic recovery remains enabled.", { url });
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data = {};
    if (text) {
      try { data = JSON.parse(text); }
      catch { throw new Error(`${label} returned an unreadable response.`); }
    }
    if (!response.ok) {
      /* BATCH 1B: THE STRUCTURED CODE SURVIVES THE THROW.

         This used to construct a bare `new Error(data.error)`, which discarded
         the HTTP status and the server's typed code. A deterministic local
         refusal — a frame-presence contradiction, an unresolvable frame target
         — then arrived at `v626FailureClass()` as an anonymous error and was
         classified `provider`, so a fault no retry can repair was recorded as a
         provider fault and could consume the run's retry budget. */
      const failure = new Error(data.error || `${label} failed (${response.status})`);
      failure.httpStatus = response.status;
      if (data.code) failure.code = data.code;
      if (data.classification) failure.classification = data.classification;
      if (data.contradictions) failure.contradictions = data.contradictions;
      if (data.classification === "local-preflight" || data.code === "FRAME_PRESENCE_CONTRADICTION" || data.code === "FRAME_PRESENCE_TARGET_UNRESOLVED") {
        failure.localPreflightError = true;
        failure.providerContacted = false;
      }
      throw failure;
    }
    if (activityId && typeof v641FinishManualActivity === "function") v641FinishManualActivity(activityId, "completed", data.llmUsed === false ? "The assistant was unavailable after recovery attempts; CineBraid returned the deterministic fallback." : "The local AI response was received, validated, and applied.");
    return data;
  } catch (error) {
    if (activityId && typeof v641FinishManualActivity === "function") v641FinishManualActivity(activityId, "failed", error?.message || "The local AI request failed.");
    if (error?.name === "AbortError") {
      const seconds = Math.round(timeoutMs / 1000);
      throw new Error(`${label} timed out after ${seconds} seconds. The request was stopped; check the AI connection or retry.`);
    }
    if (error instanceof TypeError) throw new Error(`${label} could not reach the CineBraid server. Check that it is still running, then retry.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
function guidedPromptErrorMarkup(message, retryCall) {
  return `<div class="guided-prompt-error"><div><b>Prompt build stopped</b><small>${esc(message || "The request did not finish.")}</small></div><button class="ghost-btn" onclick="${retryCall}">Retry</button></div>`;
}
function assistantWorkingCard(title, detail, options = {}) {
  const mode = options.mode || "assistant";
  const deterministic = mode === "compile";
  const eyebrow = deterministic ? "CINEBRAID COMPILER" : "CINEBRAID ASSISTANT";
  const recovery = deterministic ? "No assistant call · deterministic build" : "Recovery enabled · up to 3 total attempts";
  const startedAt = Number(options.startedAt || Date.now());
  return `<div class="assistant-working-card mode-${attr(mode)}" role="status" aria-live="polite" data-working-start="${startedAt}"><div class="assistant-portrait" aria-hidden="true"><span class="assistant-antenna"></span><div class="assistant-face"><i></i><i></i><b></b></div><span class="assistant-scan"></span></div><div class="assistant-working-copy"><span>${esc(eyebrow)}</span><b>${esc(title)}</b><small>${esc(detail)}</small><div class="assistant-working-local-status"><span>Started now</span><span>Safe to switch workspaces while this tab stays open</span><a href="#/reports">Activity & reports →</a></div><div class="assistant-attempt-track"><i></i><i></i><i></i><em>${esc(recovery)}</em></div></div><div class="assistant-thinking-dots" aria-hidden="true"><i></i><i></i><i></i></div></div>`;
}
function creationStartPath() {
  return localStorage.getItem(CREATION_START_PATH_KEY) || "manual";
}
window.setCreationStartPath = (path) => {
  localStorage.setItem(CREATION_START_PATH_KEY, path === "import" ? "import" : "manual");
  route();
  setTimeout(() =>
    document.getElementById(path === "import" ? "creation-import" : "creation-manual")?.scrollIntoView({ behavior: "smooth", block: "start" }),
  30);
};
function creationSourceRows(rows) {
  const present = rows.filter((row) => String(row.value || "").trim());
  if (!present.length) return `<div class="prompt-origin-empty">No structured source details were recorded for this build.</div>`;
  return `<div class="prompt-origin-grid">${present.map((row) => `<div><span>${esc(row.label)}</span><p>${esc(row.value)}</p></div>`).join("")}</div>`;
}
function promptOriginDetails(build) {
  const inputs = build.inputs || {};
  const rows = [
    { label: "Global style", value: inputs.globalStyle },
    { label: "World / setting", value: inputs.world },
    { label: "Asset or shot description", value: inputs.description || inputs.action },
    { label: "Placement and contact", value: inputs.staging },
    { label: "Camera and framing", value: inputs.camera },
    { label: "Extra direction", value: inputs.direction || inputs.notes },
    { label: "Exclusions", value: inputs.exclusions },
    { label: "Model adapter", value: build.profileName || build.profileId },
    { label: "Workflow", value: build.mode },
    { label: "References", value: (build.references || []).map((ref, index) => `#image${index + 1}: ${ref.label || ref.key || ref.role} — ${ref.instruction || ref.role || "reference"}`).join("\n") },
  ];
  const canonical = P.promptBuildsById?.[build.id];
  const retained = !!(canonical?.pinned || build.pinned);
  return `<details class="prompt-origin"><summary>What shaped this prompt</summary>${creationSourceRows(rows)}${build.id ? `<label class="checkline prompt-retain"><input type="checkbox" ${retained ? "checked" : ""} onchange="togglePromptBuildPin('${attr(build.id)}',this.checked)"> Retain this build beyond the history limit</label>` : ""}</details>`;
}
window.togglePromptBuildPin = (buildId, pinned) => {
  const build = P.promptBuildsById?.[buildId];
  if (!build) return toast("Prompt build is no longer available");
  build.pinned = !!pinned;
  dirty();
  toast(build.pinned ? "Prompt build retained" : "Prompt build follows normal retention");
};

function creationSlug(v) {
  return String(v || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
function nextCreationId(list, prefix) {
  let n = (P[list] || []).length + 1;
  let id = `${prefix}-${String(n).padStart(2, "0")}`;
  while ((P[list] || []).some((x) => x.id === id)) {
    n++;
    id = `${prefix}-${String(n).padStart(2, "0")}`;
  }
  return id;
}
function globalStylePrompt() {
  return String(P.meta?.globalStylePrompt || "").trim();
}
function syncGlobalStyleBlock() {
  P.meta = P.meta || {};
  P.meta.styleBlocks = Array.isArray(P.meta.styleBlocks)
    ? P.meta.styleBlocks
    : [];
  const text = globalStylePrompt();
  const i = P.meta.styleBlocks.findIndex((b) => b.id === "global-style");
  if (text) {
    const block = {
      id: "global-style",
      name: "Global visual style",
      text,
      stage: "",
    };
    if (i >= 0) P.meta.styleBlocks[i] = block;
    else P.meta.styleBlocks.unshift(block);
  } else if (i >= 0) P.meta.styleBlocks.splice(i, 1);
}
window.setGlobalCreationField = (key, value) => {
  P.meta = P.meta || {};
  P.meta[key] = value;
  if (key === "globalStylePrompt") syncGlobalStyleBlock();
  if (key === "globalNegativePrompt") {
    P.meta.world = P.meta.world || { setting: "", include: "", reject: "" };
    P.meta.world.reject = value;
  }
  if (key === "worldSetting") {
    P.meta.world = P.meta.world || { setting: "", include: "", reject: "" };
    P.meta.world.setting = value;
  }
  dirty();
};

function creationImageProfiles(mode = "t2i") {
  const profiles = (PROMPT_LIBRARY?.profiles || []).filter(
    (p) =>
      p.mediaType === "image" &&
      (CREATION_IMAGE_FAMILIES.includes(p.family) || (mode === "blocking" && p.family === "nano-banana-pro")),
  );
  const exact = profiles.filter((p) => p.mode === mode);
  if (mode === "edit") {
    if (exact.some((p) => p.family === "krea-2")) return exact;
    const krea = profiles.filter(
      (p) => p.family === "krea-2" && p.mode === "style-reference",
    );
    return [...exact, ...krea];
  }
  if (mode === "multi-reference") {
    if (exact.some((p) => p.family === "krea-2")) return exact;
    const krea = profiles.filter(
      (p) => p.family === "krea-2" &&
        ["style-reference", "moodboard"].includes(p.mode),
    );
    return [...exact, ...krea];
  }
  return exact;
}
function creationProfileOptions(mode, selected = "") {
  const profiles = creationImageProfiles(mode);
  return profiles
    .map(
      (p) =>
        `<option value="${attr(p.id)}" ${p.id === selected ? "selected" : ""}>${esc(p.name)}</option>`,
    )
    .join("");
}
function preferredCreationProfile(mode, selected = "") {
  const profiles = creationImageProfiles(mode);
  if (profiles.some((p) => p.id === selected)) return selected;
  const preferred = [
    `gpt-image-2/${mode}`,
    `nano-banana-2/${mode}`,
    `flux-2/${mode}`,
    "krea-2/t2i",
    "krea-2/style-reference",
  ];
  return preferred.find((id) => profiles.some((p) => p.id === id)) || profiles[0]?.id || "";
}
function creationAssetDescription(list, x) {
  return entityVisualDescription(x, list);
}
function assetPromptBuilds(x) {
  x.assetPromptBuilds = Array.isArray(x.assetPromptBuilds)
    ? x.assetPromptBuilds
    : [];
  return x.assetPromptBuilds;
}
function creationAssetMedia(list, x) {
  const file = entityApprovedFileForState(x, "");
  if (!file) return null;
  const media = entityMedia(list, x).find((m) => m.name === file);
  return media ? { ...media, file } : null;
}
function assetPromptStudio(list, x) {
  if (list === "audio") return "";
  const builds = assetPromptBuilds(x);
  const latest = builds.at(-1);
  const operation = guidedPromptOp("asset", `${list}:${x.id}`, "");
  const busy = operation?.status === "busy";
  const busyAction = operation?.action || "compile";
  const progress = busy
    ? assistantWorkingCard(busyAction === "improve" ? `Improving the ${creationTargetType(list)} reference prompt…` : `Compiling the ${creationTargetType(list)} reference prompt…`, busyAction === "improve" ? "The assistant may take up to three minutes per attempt. It is shaping the asset description, validating the response, and will retry automatically if needed." : "The rules-based compiler is assembling the prompt without calling the assistant.", { mode: busyAction === "improve" ? "assistant" : "compile" })
    : operation?.status === "error"
      ? guidedPromptErrorMarkup(operation.error, `buildAssetCreationPrompt('${list}','${x.id}',${busyAction === "improve" ? "true" : "false"})`)
      : "";
  const selected = preferredCreationProfile(
    "t2i",
    x.assetPromptProfile || P.meta?.promptDefaults?.imageProfile || "",
  );
  const approved = creationAssetMedia(list, x);
  const label =
    list === "characters"
      ? "character anchor"
      : list === "locations"
        ? "empty base plate"
        : list === "vehicles"
          ? "vehicle reference"
          : "prop reference";
  const sectionKey = `asset-prompt:${list}:${x.id}`;
  const needsAttention = operation?.status === "error";
  const statusTone = needsAttention ? "attention" : busy ? "active" : approved ? "complete" : latest ? "pending" : "optional";
  const statusLabel = needsAttention ? "Needs attention" : busy ? "Working" : approved ? "Approved" : latest ? "Prompt ready" : "Not started";
  const openDefault = busy || needsAttention || !approved;
  return `<details class="creation-card asset-creation-card compact-work-section" ${workspaceSectionOpen(sectionKey, openDefault) ? "open" : ""} ontoggle="rememberWorkspaceSection('${attr(sectionKey)}',this.open)">
    <summary class="compact-section-summary"><div><span class="creation-kicker">CREATE REFERENCE</span><h3>Describe the ${esc(label)}</h3><p>Build or improve the approved reference prompt and manage its automation.</p></div>${workspaceStatusPill(statusLabel, statusTone)}<i class="compact-chevron">⌄</i></summary>
    <div class="compact-section-body">
      <div class="creation-card-head compact-inner-head"><div><b>${esc(x.name || x.id)}</b><p>Write what it must look like. CineBraid combines this with the project-wide visual style and compiles a target-specific text-to-image prompt.</p></div>${approved ? `<a class="reference-download" href="${attr(approved.url)}" download>Download approved reference ↓</a>` : `<span class="creation-state">No approved reference yet</span>`}</div>
      <div class="creation-grid asset-prompt-grid">
        ${field(
          "Visual description",
          `<textarea class="creation-description" placeholder="${list === "characters" ? "Appearance, age, wardrobe, proportions, materials, distinguishing details…" : list === "locations" ? "Architecture, layout, materials, age, lighting, atmosphere, important geometry…" : list === "vehicles" ? "Vehicle class, silhouette, proportions, materials, finish, functional details, wear, identifying features…" : "Shape, materials, scale, wear, construction, identifying details…"}" onchange="setAssetCreationDescription('${list}','${x.id}',this.value)">${esc(creationAssetDescription(list, x))}</textarea>`,
        )}
        <div class="creation-side-fields">
          ${field(
            "Text-to-image target",
            `<select onchange="setAssetPromptProfile('${list}','${x.id}',this.value)">${creationProfileOptions("t2i", selected)}</select>`,
          )}
          ${field(
            "Asset-specific direction",
            `<textarea placeholder="Optional framing, pose, coverage, or output direction" onchange="setAssetCreationNotes('${list}','${x.id}',this.value)">${esc(x.assetPromptNotes || "")}</textarea>`,
          )}
        </div>
      </div>
      <div class="creation-actions"><button class="assemble-btn" ${busy ? "disabled" : ""} onclick="buildAssetCreationPrompt('${list}','${x.id}',false)">${busy && busyAction === "compile" ? `<span class="spin">◌</span> Compiling…` : "Build Prompt"}</button><button class="ghost-btn" ${busy ? "disabled" : ""} onclick="buildAssetCreationPrompt('${list}','${x.id}',true)"${aiDisabledAttrs("text")}>${busy && busyAction === "improve" ? `<span class="spin">◌</span> Improving…` : "Improve"}</button></div>
      ${typeof assetAutomationPanel === "function" ? assetAutomationPanel(list, x) : ""}
      ${progress}
      ${latest ? assetPromptResult(list, x, latest) : `<div class="creation-empty-result">No prompt compiled yet. The rules-based compiler works without an AI assistant.</div>`}
    </div>
  </details>`;
}
function assetPromptResult(list, x, build) {
  const manual = `<button class="chip" onclick="downloadAssetPrompt('${list}','${x.id}','${build.id}')">Download</button>`;
  const generate = typeof falEntityPromptAction === "function" ? falEntityPromptAction(list, x.id, build.id, manual) : manual;
  const job = typeof falEntityGenerationInline === "function" ? falEntityGenerationInline(list, x.id) : "";
  return `<article class="creation-result"><header><div><b>${esc(build.profileName || build.profileId)}</b><small>${esc(build.llmUsed ? "assistant-shaped · model-compiled" : "rules-compiled")}${build.date ? ` · ${esc(new Date(build.date).toLocaleString())}` : ""}</small></div><div><button class="copy-btn" onclick="copyText(${JSON.stringify(build.prompt || "").replace(/"/g, "&quot;")})">COPY</button>${generate}</div></header><pre>${esc(build.prompt || "")}</pre>${build.warnings?.length ? `<div class="prompt-check warn">${build.warnings.map(esc).join(" · ")}</div>` : ""}${promptOriginDetails(build)}${job}</article>`;
}

function assetStatePromptBuilds(state) {
  state.assetPromptBuilds = Array.isArray(state.assetPromptBuilds) ? state.assetPromptBuilds : [];
  return state.assetPromptBuilds;
}
/* AN EXISTING STATE HAS THE PARENT IT RECORDS, OR IT HAS NONE.
 *
 * This used to fall back to the default state, and then to any other state at
 * all. So a state carrying `parentStateId: "ghost"` — which collection
 * validation correctly reports as `parent-missing` — was OPERATIONALLY
 * REPARENTED onto the default: it built prompts from the default's image,
 * previewed against it, and passed a preflight that had already been told the
 * lineage was broken.
 *
 * Ancestry is immutable after creation, and a substitution made at read time is
 * a reparent nobody authored. There is no fallback. A missing parent resolves to
 * null, every caller sees "no valid parent", and preflight blocks — which is
 * what `parent-missing` was always supposed to mean.
 *
 * Choosing a DEFAULT parent is still legitimate, but only as an explicit rule
 * when a state is CREATED. public/shared-state-lineage.js owns that; nothing
 * here may do it on the way past. */
function assetStateParent(entity, state) {
  if (!entity || !state || state.isDefault) return null;
  const parentId = String(state.parentStateId || "");
  if (!parentId) return null;
  return entityStateListRead(entity, true).find((item) => item.id === parentId && item.id !== state.id) || null;
}
/* MB-PT-03 — A GENERATION CHOICE IS TRANSIENT UNTIL THE CREATOR GENERATES.
 *
 * Opening the flow was made pure, and Codex then found that CHANGING the
 * generation-mode control still wrote `state.generationMode` and dirtied the
 * project. Inspecting options, comparing them, and then cancelling left the
 * project changed — a pre-commit inspection with a durable side effect.
 *
 * Pending choices live here, in page memory, keyed by entity and state. They are
 * never saved, never survive a reload, and are discarded by closing the flow.
 * `buildEntityStatePrompt` — the actual generation action — is the one place
 * that commits them, because that is the point at which the choice becomes part
 * of a real request. */
const PENDING_STATE_GENERATION = new Map();
const pendingGenerationKey = (entity, state) => `${(entity && entity.id) || ""}:${(state && state.id) || ""}`;
function pendingStateGeneration(entity, state) {
  return PENDING_STATE_GENERATION.get(pendingGenerationKey(entity, state)) || null;
}
function setPendingStateGeneration(entity, state, key, value) {
  const id = pendingGenerationKey(entity, state);
  const draft = { ...(PENDING_STATE_GENERATION.get(id) || {}) };
  draft[key] = value;
  PENDING_STATE_GENERATION.set(id, draft);
}
/* THE COMMITMENT BOUNDARY. Returns whether anything was actually written, so a
   caller does not dirty a project it did not change. */
function commitPendingStateGeneration(entity, state) {
  const id = pendingGenerationKey(entity, state);
  const draft = PENDING_STATE_GENERATION.get(id);
  if (!draft || !state) return false;
  let changed = false;
  for (const key of ["generationMode", "assetPromptProfile"]) {
    if (draft[key] !== undefined && state[key] !== draft[key]) { state[key] = draft[key]; changed = true; }
  }
  PENDING_STATE_GENERATION.delete(id);
  return changed;
}
function discardPendingStateGeneration(entity, state) {
  PENDING_STATE_GENERATION.delete(pendingGenerationKey(entity, state));
}
function assetStateGenerationMode(entity, state) {
  if (!state || state.isDefault) return "independent";
  const pending = pendingStateGeneration(entity, state);
  const mode = pending && pending.generationMode !== undefined ? pending.generationMode : state.generationMode;
  return mode === "independent" ? "independent" : "derive";
}
/* MB-PT-02 — THE PARENT CARRIES ITS STANDING, AND EVERY CONSUMER MUST READ IT.
 *
 * This resolved the parent's file from a raw pointer, so a default state with
 * no receipt was handed to generation as an editable base and labelled an
 * "approved reference". An unreceipted parent is HISTORIC: it may still travel
 * as context, because it is genuinely the image the creator has been working
 * from, but nothing may call it approved and a paid run may not derive from it. */
function assetStateParentMedia(list, entity, state) {
  const parent = assetStateParent(entity, state);
  if (!parent) return { parent: null, file: "", media: null, standing: "none" };
  const truth = typeof entityProductionTruth === "function"
    ? entityProductionTruth(P, list, entity && entity.id)
    : { canon: [], historic: [] };
  const canonRow = truth.canon.find((row) => row.stateId === parent.id) || null;
  const historicRow = canonRow ? null : (truth.historic.find((row) => row.stateId === parent.id) || null);
  const file = (canonRow || historicRow || {}).value || "";
  if (!file) return { parent, file: "", media: null, standing: "none" };
  const media = entityMedia(list, entity).find((item) => item.name === file) || null;
  return { parent, file, media, standing: canonRow ? "canon" : "historic" };
}
/* DERIVATION NEEDS A CANON PARENT, NOT MERELY A PARENT IMAGE.
 *
 * "edit" means "take the parent's exact bytes and change only the delta". Doing
 * that from a HISTORIC parent silently makes an unapproved image the base of
 * production output — the pointer becomes authority by being edited. A historic
 * parent still travels as context (public/fal-generation.js sends it under
 * `historic-reference`); it does not put the compiler into edit mode. */
/* ============================================================================
 * THE ONE DERIVATION READER.
 *
 * "May this state derive from its parent, and from which bytes" was recomputed
 * in five places — the state card, the generation modal, the more-candidates
 * path, the paid dispatch, and the compiler — and every one of them asked
 * `!!parentInfo.media`: does the parent HAVE an image. A historic parent has
 * one, so a pointer nobody approved became the editable base of production
 * output, populated `parentApprovedFile`, and shipped as `role: "base"`.
 *
 * There is one answer now, and it is a thin reader over the receipt-backed
 * projection — `assetStateParentMedia` already resolves the parent's standing
 * from `entityProductionTruth`. This adds no authority architecture; it removes
 * four independent re-derivations of one question.
 *
 *   canDerive    the ONLY thing that may enable derive/edit, an approved base,
 *                validation-as-approval, correction-into-derive, or dispatch
 *   file         the parent bytes, POPULATED ONLY WHEN CANON. This is what
 *                `parentApprovedFile` is allowed to be.
 *   contextFile  the parent image whatever its standing, for display and for
 *                non-authoritative context. Never an approved base.
 *   reason       why derivation is unavailable, so a surface can say it
 * ========================================================================== */
function assetStateDerivation(list, entity, state) {
  if (!state || state.isDefault) {
    return { requested: "independent", mode: "independent", canDerive: false, parent: null, standing: "none", file: "", contextFile: "", media: null, reason: "default-state" };
  }
  const requested = assetStateGenerationMode(entity, state);
  const info = assetStateParentMedia(list, entity, state);
  const canDerive = requested === "derive" && !!info.media && info.standing === "canon";
  return {
    requested,
    mode: canDerive ? "derive" : "independent",
    canDerive,
    parent: info.parent,
    standing: info.standing,
    file: canDerive ? info.file : "",
    contextFile: info.file,
    media: info.media,
    reason: !info.parent ? "no-parent"
      : !info.media ? "parent-has-no-image"
        : info.standing !== "canon" ? "parent-not-canon"
          : requested !== "derive" ? "independent-by-choice" : "",
  };
}
function assetStatePromptMode(list, entity, state) {
  return assetStateDerivation(list, entity, state).canDerive ? "edit" : "t2i";
}
function assetStatePromptProfile(list, entity, state) {
  const mode = assetStatePromptMode(list, entity, state);
  const pending = pendingStateGeneration(entity, state);
  const selected = (pending && pending.assetPromptProfile !== undefined ? pending.assetPromptProfile : state.assetPromptProfile)
    || entity.assetPromptProfile || P.meta?.promptDefaults?.imageProfile || "";
  return preferredCreationProfile(mode, selected);
}
/* WHAT THIS STATE DERIVES FROM. A STATEMENT, NOT A CONTROL.

   BATCH 1C: there was a dropdown here, and choosing a descendant from it closed
   a cycle in the derivation graph. Rather than filter the list and validate the
   write, alpha removes the operation — a state's derivation is chosen when the
   state is created and does not change afterwards. The creator still sees what
   it derives from, because that is production truth and belongs on screen; they
   simply cannot rewrite it here. To derive differently, create a state from the
   parent you want. */
function entityStateDerivationSummary(entity, state) {
  const states = entityStateListRead(entity, true);
  const parent = states.find((item) => item.id === state.parentStateId && item.id !== state.id) || null;
  if (state.isDefault) {
    return `<div class="entity-state-derivation is-root"><span>BASE REFERENCE</span><b>The root of this chain</b><small>Every other state derives from this one, directly or through another.</small></div>`;
  }
  return `<div class="entity-state-derivation"><span>DERIVES FROM</span><b>${esc(parent?.name || "No declared parent")}</b><small>${parent
    ? "Chosen when this state was created. To derive from a different reference, create a new state from that one."
    : "This state records no parent. Create a new state from the reference it should derive from."}</small></div>`;
}
function assetStatePromptStudio(list, entity, state) {
  if (!state || list === "audio") return "";
  const builds = assetStatePromptBuilds(state);
  const latest = builds.at(-1);
  const operation = guidedPromptOp("asset-state", `${list}:${entity.id}`, state.id);
  const busy = operation?.status === "busy";
  const action = operation?.action || "compile";
  const derivation = assetStateDerivation(list, entity, state);
  const mode = derivation.requested;
  const parentInfo = assetStateParentMedia(list, entity, state);
  const deriveReady = derivation.canDerive;
  const effectiveMode = derivation.mode;
  const promptMode = assetStatePromptMode(list, entity, state);
  const selected = assetStatePromptProfile(list, entity, state);
  const sectionKey = `entity:${list}:${entity.id}:state-generation:${state.id}`;
  const progress = busy
    ? assistantWorkingCard(action === "improve" ? `Improving the ${state.name || "continuity"} state prompt…` : `Compiling the ${state.name || "continuity"} state prompt…`, action === "improve" ? "The assistant may take up to three minutes per attempt. It is checking the state delta against the parent reference and validating a complete response." : "The rules-based compiler is assembling the state prompt without calling the assistant.", { mode: action === "improve" ? "assistant" : "compile" })
    : operation?.status === "error"
      ? guidedPromptErrorMarkup(operation.error, `buildEntityStatePrompt('${list}','${entity.id}','${state.id}',${action === "improve" ? "true" : "false"})`)
      : "";
  const derivationNote = state.isDefault
    ? `<div class="entity-state-generation-status independent"><b>BASE REFERENCE</b><span>Creates the main approved design from the reference’s canon description.</span></div>`
    : deriveReady
      ? `<div class="entity-state-generation-status derive"><b>DERIVE FROM ${esc((parentInfo.parent?.name || "PARENT").toUpperCase())}</b><span>${esc(parentInfo.file)} is used as the editable identity/design base.</span></div>`
      : mode === "derive" && derivation.reason === "parent-not-canon"
        ? `<div class="entity-state-generation-status warning"><b>PARENT NOT APPROVED</b><span>${esc(derivation.contextFile)} is on ${esc(parentInfo.parent?.name || "the parent state")} but nobody has approved it as canon, so CineBraid will create independently. Approve it to derive from it.</span></div>`
      : mode === "derive"
        ? `<div class="entity-state-generation-status warning"><b>PARENT REFERENCE MISSING</b><span>CineBraid will create independently until ${esc(parentInfo.parent?.name || "the parent state")} has an approved image.</span></div>`
        : `<div class="entity-state-generation-status independent"><b>CREATE INDEPENDENTLY</b><span>Uses the reference’s canon description and this state’s changes, with no parent image to edit.</span></div>`;
  const modeNote = `<div class="state-generation-guidance"><div><b>Manual generate</b><span>Returns one candidate batch only.</span></div><div><b>Automate state</b><span>Runs review → revise → retry. Quick actions can also generate three more candidates or improve the prompt and regenerate.</span></div></div>`;
  const explicitlyOpened = workspaceSectionOpen(sectionKey, false);
  const assistedOpen = busy || operation?.status === "error" || explicitlyOpened || (!manualFirstWorkflow() && !!(latest || !state.approvedFile));
  const heading = manualFirstWorkflow() ? `Optional assisted creation for ${state.name || "this state"}` : `Build, improve and generate ${state.name || "this state"}`;
  return `<details class="entity-state-generation" data-entity-state-generation="${attr(state.id)}" ${assistedOpen ? "open" : ""} ontoggle="rememberWorkspaceSection('${attr(sectionKey)}',this.open)"><summary><div><span>STATE REFERENCE GENERATION</span><b>${esc(heading)}</b></div><span>${effectiveMode === "derive" ? "PARENT EDIT" : "INDEPENDENT"}</span></summary><div class="entity-state-generation-body">${derivationNote}${modeNote}<div class="two-col">${state.isDefault ? "" : `<label><span>Generation mode</span><select onchange="setContinuityStateGeneration('${list}','${entity.id}','${state.id}','generationMode',this.value)"><option value="derive" ${mode === "derive" ? "selected" : ""}>Derive from approved state</option><option value="independent" ${mode === "independent" ? "selected" : ""}>Create independently</option></select></label>${entityStateDerivationSummary(entity, state)}`}${field("Prompt target", `<select onchange="setContinuityStateGeneration('${list}','${entity.id}','${state.id}','assetPromptProfile',this.value)">${creationProfileOptions(promptMode, selected)}</select>`)}${field("Additional state direction", `<textarea placeholder="Optional framing or state-specific instructions beyond the delta above" onchange="setContinuityStateGeneration('${list}','${entity.id}','${state.id}','assetPromptNotes',this.value)">${esc(state.assetPromptNotes || "")}</textarea>`)}</div><div class="creation-actions"><button class="assemble-btn" ${busy ? "disabled" : ""} onclick="buildEntityStatePrompt('${list}','${entity.id}','${state.id}',false)">${busy && action === "compile" ? `<span class="spin">◌</span> Compiling…` : "Build state prompt"}</button><button class="ghost-btn" ${busy ? "disabled" : ""} onclick="buildEntityStatePrompt('${list}','${entity.id}','${state.id}',true)"${aiDisabledAttrs("text")}>${busy && action === "improve" ? `<span class="spin">◌</span> Improving…` : "Improve"}</button></div>${typeof entityStateAutomationPanel === "function" ? entityStateAutomationPanel(list, entity, state) : ""}${progress}${latest ? assetStatePromptResult(list, entity, state, latest) : `<div class="creation-empty-result">No ${esc(state.name || "state")} prompt compiled yet. The state changes above are combined with the reference’s canon description.</div>`}</div></details>`;
}
function assetStatePromptResult(list, entity, state, build) {
  const manual = `<button class="chip" onclick="downloadAssetStatePrompt('${list}','${entity.id}','${state.id}','${build.id}')">Download</button>`;
  const generate = typeof falEntityStatePromptAction === "function"
    ? falEntityStatePromptAction(list, entity.id, state.id, build.id, manual)
    : manual;
  const job = typeof falEntityGenerationInline === "function"
    ? falEntityGenerationInline(list, entity.id, state.id)
    : "";
  return `<article class="creation-result entity-state-prompt-result"><header><div><b>${esc(build.profileName || build.profileId)}</b><small>${esc(build.llmUsed ? "assistant-shaped · state-specific" : "rules-compiled · state-specific")}${build.date ? ` · ${esc(new Date(build.date).toLocaleString())}` : ""}</small></div><div><button class="copy-btn" onclick="copyText(${JSON.stringify(build.prompt || "").replace(/"/g, "&quot;")})">COPY</button>${generate}</div></header><pre>${esc(build.prompt || "")}</pre>${build.warnings?.length ? `<div class="prompt-check warn">${build.warnings.map(esc).join(" · ")}</div>` : ""}${promptOriginDetails(build)}${job}</article>`;
}
window.setContinuityStateGeneration = (list, id, stateId, key, value) => {
  const entity = P[list]?.find((item) => item.id === id);
  const state = entityStateById(entity, stateId);
  if (!state || !["generationMode", "parentStateId", "assetPromptProfile", "assetPromptNotes"].includes(key)) return;
  /* BATCH 1B: THIS IS THE EXPOSED CYCLE WRITER THE AUDIT FOUND.

     `state[key] = value` for `parentStateId`, from a dropdown that listed every
     state except the current one — descendants included. Editing the root's
     parent to point at its own grandchild closed a real cycle from the UI, with
     no validator anywhere in the path. It is an explicit lineage edit, so it is
     allowed to reparent — through the one mutation API, which refuses the moves
     that damage the graph and leaves the project untouched when it does. */
  /* BATCH 1C: REPARENTING IS NOT AN OPERATION. The control that reached this
     branch is gone; the refusal stays, because a stale page or a future caller
     must get a clear answer rather than a silent write. */
  if (key === "parentStateId") return toast(reparentingUnsupported().detail);
  /* GENERATION CHOICES ARE TRANSIENT. `generationMode` and the profile it
     implies are held in page memory until the creator actually generates; a
     cancelled comparison leaves the project byte-identical. `assetPromptNotes`
     is authored content, not a choice about how to run, so it persists — losing
     what someone typed would be the opposite of the property being protected. */
  if (key === "generationMode" || key === "assetPromptProfile") {
    setPendingStateGeneration(entity, state, key, value);
    if (key === "generationMode") {
      const desiredMode = assetStatePromptMode(list, entity, state);
      const current = assetStatePromptProfile(list, entity, state);
      if (!creationImageProfiles(desiredMode).some((profile) => profile.id === current)) {
        setPendingStateGeneration(entity, state, "assetPromptProfile", preferredCreationProfile(desiredMode, ""));
      }
    }
    return route();
  }
  state[key] = value;
  dirty();
  route();
};
window.buildEntityStatePrompt = async (list, id, stateId, useLLM = false) => {
  const entity = P[list]?.find((item) => item.id === id);
  const state = entityStateById(entity, stateId);
  if (!entity || !state) { toast("Continuity state is unavailable"); return null; }
  if (!creationAssetDescription(list, entity).trim()) { toast("Describe the reference first"); return null; }
  const stateDelta = continuityStateDeltaText(state);
  if (!state.isDefault && !stateDelta) { toast("Describe the state change / delta first. ‘Applies to scenes / shots’ does not describe the visual change."); return null; }
  if (!String(state.notes || "").trim() && stateDelta) state.notes = stateDelta;
  if (useLLM && !capabilityState("text").ready) { toast(capabilityState("text").message); return null; }
  /* THE COMMITMENT BOUNDARY. The creator asked for a generation, so the choices
     they were comparing become part of the project now — and only now. */
  const profileId = assetStatePromptProfile(list, entity, state);
  if (commitPendingStateGeneration(entity, state)) dirty();
  const action = useLLM ? "improve" : "compile";
  setGuidedPromptOp("asset-state", `${list}:${id}`, state.id, { status: "busy", action, startedAt: Date.now() });
  route();
  try {
    const d = await guidedPromptRequest("/api/prompt/asset-compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        list,
        id,
        stateId: state.id,
        generationMode: assetStateGenerationMode(entity, state),
        parentStateId: assetStateParent(entity, state)?.id || "",
        profileId,
        directive: [state.assetPromptNotes || "", state.assetAutomationRevisionRequest ? `AUTOMATION REVISION\n${state.assetAutomationRevisionRequest}` : ""].filter(Boolean).join("\n\n"),
        useLLM,
      }),
    }, GUIDED_PROMPT_TIMEOUTS[action], useLLM ? `${state.name || "continuity"} state prompt improvement` : `${state.name || "continuity"} state prompt compilation`);
    const build = {
      id: "asset-state-prompt-" + Date.now().toString(36),
      date: new Date().toISOString(),
      stateId: state.id,
      stateName: state.name || "State",
      parentStateId: d.state?.parentStateId || "",
      parentStateName: d.state?.parentStateName || "",
      generationMode: d.state?.generationMode || assetStateGenerationMode(entity, state),
      profileId,
      profileName: d.profile?.name || profileId,
      profileVersion: d.profile?.profileVersion || "",
      prompt: enforceLockedAssetSheetPrompt(list, entity, d.compiledPrompt),
      spec: d.spec,
      warnings: [...(d.warnings || []), ...(assetPromptRequestsReferenceSheet(list, entity) && !/multi[- ]view|four[- ]panel|4[- ]panel|turnaround/i.test(String(d.compiledPrompt || "")) ? ["The assistant dropped the locked sheet structure; CineBraid restored it automatically."] : [])],
      confirmations: d.confirmations || [],
      providerPayload: d.providerPayload || null,
      llmUsed: !!d.llmUsed,
      inputs: {
        globalStyle: globalStylePrompt(),
        world: P.meta?.world?.setting || "",
        description: creationAssetDescription(list, entity),
        stateDelta: state.notes || "",
        direction: [state.assetPromptNotes || "", state.assetAutomationRevisionRequest || ""].filter(Boolean).join(" | "),
        exclusions: P.meta?.globalNegativePrompt || P.meta?.world?.reject || "",
      },
    };
    assetStatePromptBuilds(state).push(build);
    setGuidedPromptOp("asset-state", `${list}:${id}`, state.id, null);
    dirty();
    toast(useLLM ? `${state.name || "State"} prompt improved` : `${state.name || "State"} prompt compiled`);
    route();
    return build;
  } catch (error) {
    setGuidedPromptOp("asset-state", `${list}:${id}`, state.id, { status: "error", action, error: error.message, failedAt: Date.now() });
    toast("State prompt failed: " + error.message);
    route();
    return null;
  }
};
window.setAssetCreationDescription = (list, id, value) => {
  const x = P[list].find((e) => e.id === id);
  if (!x) return;
  x.creationDescription = value;
  dirty();
};
window.setAssetCreationNotes = (list, id, value) => {
  const x = P[list].find((e) => e.id === id);
  if (!x) return;
  x.assetPromptNotes = value;
  dirty();
};
window.setAssetPromptProfile = (list, id, value) => {
  const x = P[list].find((e) => e.id === id);
  if (!x) return;
  x.assetPromptProfile = value;
  dirty();
};
function assetPromptRequestsReferenceSheet(list, entity) {
  const text = [entity?.assetPromptNotes, entity?.coverageGenerationNotes, entity?.creationDescription].filter(Boolean).join(" ").toLowerCase();
  return /reference sheet|turnaround|multi[- ]view|multiple angles|front.*profile.*rear|four[- ]panel|4[- ]panel/.test(text);
}
function lockedAssetSheetDirective(list, entity) {
  if (!assetPromptRequestsReferenceSheet(list, entity)) return "";
  const panelOrder = list === "characters" ? "Front, front three-quarter, left profile, rear" : list === "vehicles" ? "Front, front three-quarter, side, rear" : list === "props" ? "Hero/front, three-quarter, side, rear" : "Master establishing, reverse angle, left-facing coverage, right-facing coverage";
  return [
    "OUTPUT TYPE — LOCKED",
    "Create one high-resolution four-panel multi-view reference sheet, not a single view.",
    `PANEL ORDER — LOCKED: ${panelOrder}.`,
    "SHEET STRUCTURE — LOCKED",
    "Repeat the exact same subject or location in every panel. Keep consistent scale, baseline, lighting, proportions, design, wardrobe/materials, and rendering style. Use generous gutters, no overlap, no labels, no generated text, and no decorative framing.",
    list === "characters" ? "Every panel must show the full body from head to boots in a neutral readable pose." : "Every panel must be a clear production reference rather than a dramatic composition.",
    "The assistant may improve descriptive specificity but must not remove, replace, or collapse these locked sheet requirements.",
  ].join("\n\n");
}
function enforceLockedAssetSheetPrompt(list, entity, prompt) {
  const locked = lockedAssetSheetDirective(list, entity);
  if (!locked) return String(prompt || "");
  const result = String(prompt || "");
  const hasSheet = /four[- ]panel|4[- ]panel|multi[- ]view reference sheet|turnaround sheet/i.test(result);
  const hasAngles = /front/i.test(result) && /profile|side/i.test(result) && /rear|back/i.test(result);
  return hasSheet && hasAngles ? result : `${locked}\n\nMODEL-ADAPTED CREATIVE DIRECTION\n${result}`.trim();
}

window.buildAssetCreationPrompt = async (list, id, useLLM = false) => {
  const x = P[list].find((e) => e.id === id);
  if (!x) return;
  if (!creationAssetDescription(list, x).trim())
    return toast("Describe the asset first");
  if (useLLM && !capabilityState("text").ready)
    return toast(capabilityState("text").message);
  const profileId = preferredCreationProfile(
    "t2i",
    x.assetPromptProfile || P.meta?.promptDefaults?.imageProfile || "",
  );
  const action = useLLM ? "improve" : "compile";
  setGuidedPromptOp("asset", `${list}:${id}`, "", { status: "busy", action, startedAt: Date.now() });
  route();
  try {
    const d = await guidedPromptRequest("/api/prompt/asset-compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        list,
        id,
        profileId,
        directive: [lockedAssetSheetDirective(list, x), x.assetPromptNotes || "", x.assetAutomationRevisionRequest ? `AUTOMATION REVISION\n${x.assetAutomationRevisionRequest}` : ""].filter(Boolean).join("\n\n"),
        useLLM,
      }),
    }, GUIDED_PROMPT_TIMEOUTS[action], useLLM ? `${creationTargetType(list)} prompt improvement` : `${creationTargetType(list)} prompt compilation`);
    const build = {
      id: "asset-prompt-" + Date.now().toString(36),
      date: new Date().toISOString(),
      profileId,
      profileName: d.profile?.name || profileId,
      profileVersion: d.profile?.profileVersion || "",
      prompt: d.compiledPrompt,
      spec: d.spec,
      warnings: d.warnings || [],
      confirmations: d.confirmations || [],
      providerPayload: d.providerPayload || null,
      llmUsed: !!d.llmUsed,
      inputs: {
        globalStyle: globalStylePrompt(),
        world: P.meta?.world?.setting || "",
        description: creationAssetDescription(list, x),
        direction: [lockedAssetSheetDirective(list, x), x.assetPromptNotes || "", x.assetAutomationRevisionRequest || ""].filter(Boolean).join(" | "),
        exclusions: P.meta?.globalNegativePrompt || P.meta?.world?.reject || "",
      },
    };
    assetPromptBuilds(x).push(build);
    setGuidedPromptOp("asset", `${list}:${id}`, "", null);
    dirty();
    toast(useLLM ? "Reference prompt improved" : "Reference prompt compiled");
  } catch (error) {
    setGuidedPromptOp("asset", `${list}:${id}`, "", { status: "error", action, error: error.message, failedAt: Date.now() });
    toast("Prompt compile failed: " + error.message);
  }
  route();
};

window.compareAssetCreationPrompts = async (list, id) => {
  const x = P[list].find((e) => e.id === id);
  if (!x || !creationAssetDescription(list, x).trim())
    return toast("Describe the asset first");
  const profiles = creationImageProfiles("t2i").filter((p, i, all) =>
    all.findIndex((q) => q.family === p.family) === i,
  );
  openModal(`<h3>Compiling model comparison…</h3><div class="modal-sub">SAME ASSET BRIEF · FOUR TARGET-SPECIFIC PROMPTS</div>`);
  try {
    const results = await Promise.all(
      profiles.map(async (p) => {
        const r = await fetch("/api/prompt/asset-compile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            list,
            id,
            profileId: p.id,
            directive: [x.assetPromptNotes || "", x.assetAutomationRevisionRequest ? `AUTOMATION REVISION\n${x.assetAutomationRevisionRequest}` : ""].filter(Boolean).join("\n\n"),
            useLLM: false,
          }),
        });
        const d = await r.json();
        return r.ok ? d : { profile: p, error: d.error || "compile failed" };
      }),
    );
    window._assetPromptComparison = { list, id, results };
    openModal(`<div class="prompt-compare"><h3>Reference prompt comparison — ${esc(x.name || x.id)}</h3><div class="modal-sub">ONE CANONICAL DESCRIPTION · FOUR MODEL ADAPTERS</div><div class="prompt-compare-grid">${results.map((d, i) => `<article><header><b>${esc(d.profile?.name || profiles[i].name)}</b><button onclick="saveAssetComparedPrompt(${i})">SAVE</button></header>${d.error ? `<div class="prompt-check warn">${esc(d.error)}</div>` : `<pre>${esc(d.compiledPrompt || "")}</pre>`}</article>`).join("")}</div><div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button></div></div>`);
  } catch (e) {
    closeModal();
    toast("Comparison failed: " + e.message);
  }
};
window.saveAssetComparedPrompt = (index) => {
  const state = window._assetPromptComparison;
  const d = state?.results?.[index];
  const x = state ? P[state.list].find((e) => e.id === state.id) : null;
  if (!d || d.error || !x) return;
  assetPromptBuilds(x).push({
    id: "asset-prompt-" + Date.now().toString(36),
    date: new Date().toISOString(),
    profileId: d.profile.id,
    profileName: d.profile.name,
    profileVersion: d.profile.profileVersion || "",
    prompt: d.compiledPrompt,
    spec: d.spec,
    warnings: d.warnings || [],
    confirmations: d.confirmations || [],
    providerPayload: d.providerPayload || null,
    llmUsed: false,
    inputs: {
      globalStyle: globalStylePrompt(),
      world: P.meta?.world?.setting || "",
      description: creationAssetDescription(state.list, x),
      direction: [x.assetPromptNotes || "", x.assetAutomationRevisionRequest || ""].filter(Boolean).join(" | "),
      exclusions: P.meta?.globalNegativePrompt || P.meta?.world?.reject || "",
    },
  });
  dirty();
  closeModal();
  route();
  toast("Compared prompt saved");
};
window.downloadAssetPrompt = (list, id, buildId) => {
  const x = P[list].find((e) => e.id === id);
  const build = assetPromptBuilds(x).find((b) => b.id === buildId);
  if (!build) return;
  downloadCreationText(
    `${id}_${build.profileId.replace(/\//g, "-")}_prompt.txt`,
    build.prompt || "",
  );
};
window.downloadAssetStatePrompt = (list, id, stateId, buildId) => {
  const entity = P[list]?.find((item) => item.id === id);
  const state = entityStateById(entity, stateId);
  const build = state ? assetStatePromptBuilds(state).find((item) => item.id === buildId) : null;
  if (!build) return;
  const stateName = String(state.name || state.id || "state").replace(/[^a-z0-9_.-]+/gi, "-");
  downloadCreationText(
    `${id}_${stateName}_${build.profileId.replace(/\//g, "-")}_prompt.txt`,
    build.prompt || "",
  );
};
function downloadCreationText(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  a.download = name.replace(/[^a-z0-9_.-]+/gi, "-");
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}

function ensureShotCreation(s) {
  s.creationBrief = s.creationBrief || {};
  const c = s.creationBrief;
  c.propIds = Array.isArray(c.propIds) ? c.propIds : [];
  c.promptBuilds = Array.isArray(c.promptBuilds) ? c.promptBuilds : [];
  c.motionPromptBuilds = Array.isArray(c.motionPromptBuilds) ? c.motionPromptBuilds : [];
  c.frameWorkflows = c.frameWorkflows && typeof c.frameWorkflows === "object" ? c.frameWorkflows : {};
  c.mode = c.mode || "auto";
  c.locationId = c.locationId || "";
  c.disabledInputKeys = Array.isArray(c.disabledInputKeys) ? c.disabledInputKeys : [];
  c.motionIntensity = c.motionIntensity || "subtle";
  c.preserveComposition = c.preserveComposition !== false;
  c.motionAudioMode = c.motionAudioMode || "auto";
  c.motionAudioNotes = c.motionAudioNotes || "";
  c.motionSync = c.motionSync || "natural";
  c.composition = c.composition && typeof c.composition === "object" ? c.composition : {};
  /* Deliberately not defaulted. Stamping the project's format onto every shot the first
     time its workspace opened made "follow the project" unrepresentable: the shot froze
     whatever the project happened to say that day and stopped tracking later changes.
     Every reader already falls back through project → 16:9, so an unset value means
     inherit. Values already stored by the old stamp are left exactly as they are — the
     user clears them through the control, nothing is rewritten on load. */
  if (c.composition.aspectRatio == null) c.composition.aspectRatio = "";
  c.composition.camera = c.composition.camera && typeof c.composition.camera === "object" ? c.composition.camera : {};
  c.composition.camera.shotSize = c.composition.camera.shotSize || "wide";
  c.composition.camera.height = c.composition.camera.height || "eye-level";
  c.composition.camera.angle = c.composition.camera.angle || "level";
  c.composition.camera.lens = c.composition.camera.lens || "normal";
  c.composition.camera.view = c.composition.camera.view || "front";
  c.composition.camera.layout = c.composition.camera.layout || "rule-of-thirds";
  c.composition.camera.crop = c.composition.camera.crop || "full-scene";
  c.composition.camera.reframe = c.composition.camera.reframe || "preserve-loosely";
  c.composition.elements = Array.isArray(c.composition.elements) ? c.composition.elements : [];
  const boundedCompositionNumber = (value, fallback, min, max) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  };
  c.composition.elements = c.composition.elements
    .filter((element) => element && typeof element === "object")
    .map((element, index) => ({
      ...element,
      id: element.id || `${s.id}-composition-${index + 1}`,
      referenceKey: String(element.referenceKey || ""),
      x: boundedCompositionNumber(element.x, 0.5, 0, 1),
      y: boundedCompositionNumber(element.y, 0.5, 0, 1),
      w: boundedCompositionNumber(element.w, 0.25, 0.08, 1),
      h: boundedCompositionNumber(element.h, 0.25, 0.08, 1),
      depth: element.depth || "midground",
      facing: element.facing || "camera",
      view: element.view || "reference-view",
      crop: element.crop || "none",
      notes: element.notes || "",
    }));
  c.composition.mustInclude = c.composition.mustInclude || "";
  c.composition.mustAvoid = c.composition.mustAvoid || "";
  c.motionPlan = c.motionPlan && typeof c.motionPlan === "object" ? c.motionPlan : {};
  c.motionPlan.camera = c.motionPlan.camera && typeof c.motionPlan.camera === "object" ? c.motionPlan.camera : {};
  c.motionPlan.camera.move = c.motionPlan.camera.move || "locked";
  c.motionPlan.camera.direction = c.motionPlan.camera.direction || "";
  c.motionPlan.camera.intensity = c.motionPlan.camera.intensity || "subtle";
  c.motionPlan.camera.style = c.motionPlan.camera.style || "smooth";
  c.motionPlan.camera.framing = c.motionPlan.camera.framing || "preserve";
  c.motionPlan.subjects = c.motionPlan.subjects && typeof c.motionPlan.subjects === "object" ? c.motionPlan.subjects : {};
  c.motionPlan.props = c.motionPlan.props && typeof c.motionPlan.props === "object" ? c.motionPlan.props : {};
  c.motionPlan.environment = c.motionPlan.environment && typeof c.motionPlan.environment === "object" ? c.motionPlan.environment : {};
  c.motionPlan.environment.action = c.motionPlan.environment.action || "static";
  c.motionPlan.environment.intensity = c.motionPlan.environment.intensity || "subtle";
  c.motionPlan.environment.notes = c.motionPlan.environment.notes || "";
  c.motionPlan.timing = c.motionPlan.timing && typeof c.motionPlan.timing === "object" ? c.motionPlan.timing : {};
  c.motionPlan.timing.onset = c.motionPlan.timing.onset || "immediate";
  c.motionPlan.timing.pacing = c.motionPlan.timing.pacing || "natural";
  c.motionPlan.timing.holdEnd = c.motionPlan.timing.holdEnd !== false;
  c.motionPlan.timing.secondary = c.motionPlan.timing.secondary || "";
  c.motionPlan.audio = c.motionPlan.audio && typeof c.motionPlan.audio === "object" ? c.motionPlan.audio : {};
  c.motionPlan.audio.referenceKey = c.motionPlan.audio.referenceKey || "";
  c.motionPlan.audio.speakerId = c.motionPlan.audio.speakerId || s.audio?.speakerId || "";
  c.motionPlan.audio.voiceEntityId = c.motionPlan.audio.voiceEntityId || s.audio?.voiceEntityId || "";
  c.motionPlan.audio.mode = ["none","generate-voice","lip-sync-reference"].includes(c.motionPlan.audio.mode)
    ? c.motionPlan.audio.mode
    : c.motionPlan.audio.lipSync
      ? "lip-sync-reference"
      : s.audio?.line
        ? "generate-voice"
        : "none";
  c.motionPlan.audio.lipSync = c.motionPlan.audio.mode === "lip-sync-reference";
  c.motionPlan.audio.direction = c.motionPlan.audio.direction || "";
  c.approvedMotionFile = c.approvedMotionFile || "";
  c.finalVideoFile = c.finalVideoFile || "";
  c.finalStillFile = c.finalStillFile || "";
  c.deliveryIntent = c.deliveryIntent || "auto";
  c.openPanels = c.openPanels && typeof c.openPanels === "object" ? c.openPanels : {};
  c.lastInputPackageId = c.lastInputPackageId || "";
  c.activeGuidedFrameId = c.activeGuidedFrameId || "";
  c.blockingBuilds = Array.isArray(c.blockingBuilds) ? c.blockingBuilds : [];
  c.blockingProfileId = c.blockingProfileId || "gpt-image-2/blocking";
  c.blockingIncludeLabels = c.blockingIncludeLabels !== false;
  c.blockingEmphasis = ["auto","full-scene","balanced","action-insert"].includes(c.blockingEmphasis) ? c.blockingEmphasis : "auto";
  c.blockingRevisionRequest = c.blockingRevisionRequest || "";
  c.blockingRevisionSourceAssetId = c.blockingRevisionSourceAssetId || "";
  c.blockingLastRevisionRequest = c.blockingLastRevisionRequest || "";
  c.activeBlockingAssetId = c.activeBlockingAssetId || "";
  c.blockingGuideAdherence = c.blockingGuideAdherence || "strict";
  c.composition.blockingGuideAdherence = c.composition.blockingGuideAdherence || c.blockingGuideAdherence;
  // v6.0.1: request progress is browser-session state, never project data.
  delete c.motionBusy;
  delete c.motionBusyLabel;
  return c;
}

function guidedFrames(s) {
  normalizeShotV5(s);
  if (!(s.keyframes || []).length) s.keyframes = [newKeyframe(0, "Opening frame")];
  return s.keyframes;
}
function guidedFrameState(s, frame, index = 0) {
  const c = ensureShotCreation(s);
  const existing = c.frameWorkflows[frame.id] || {};
  const isFirst = index === 0;
  /* `...existing` first, because this rebuilds the record on every render and a
     literal without it silently deleted every key it did not name. That is why
     the per-frame continuity state selections had readers and no writer: a
     saved selection survived only until the next frame card rendered. Spreading
     first keeps this a normalizer of the keys below and nothing more. */
  const state = c.frameWorkflows[frame.id] = {
    ...existing,
    action: existing.action ?? (isFirst ? c.action || frame.description || s.desc || "" : frame.description || ""),
    staging: existing.staging ?? (isFirst ? c.staging || s.positioning || "" : ""),
    camera: existing.camera ?? (isFirst ? c.camera || "" : ""),
    notes: existing.notes ?? (isFirst ? c.notes || "" : ""),
    mode: existing.mode || (isFirst ? c.mode || "auto" : "auto"),
    profileId: existing.profileId || (isFirst ? c.profileId || "" : ""),
    usePreviousFrame: isFirst ? false : existing.usePreviousFrame !== false,
    selectedCandidate: existing.selectedCandidate || "",
    automationRevisionRequest: existing.automationRevisionRequest || "",
    automationBlockingAssetId: existing.automationBlockingAssetId || "",
    promptBuilds: Array.isArray(existing.promptBuilds) ? existing.promptBuilds : [],
  };
  if (isFirst) {
    state.promptBuilds = c.promptBuilds;
    state.action = c.action || state.action;
    state.staging = c.staging || state.staging;
    state.camera = c.camera || state.camera;
    state.notes = c.notes || state.notes;
    state.mode = c.mode || state.mode;
    state.profileId = c.profileId || state.profileId;
  }
  return state;
}
/* THE FRAME IMAGE THAT IS SITTING THERE, whoever put it there. Display,
   diagnostics and "what am I looking at" — never authority. */
function guidedFrameImage(s, frame, takes = takesFor(s.id), index = 0) {
  const name = frame.winner || (index === 0 ? s.winner : "");
  if (!name) return null;
  const take = takes.find((item) => item.name === name && !isVideo(item.name) && !isAudio(item.name));
  return take ? { ...take, name: take.name, url: take.url } : null;
}
/* IS THIS FRAME APPROVED — THE AUTHORITY SINK.
 *
 * This is the single most consumed approval question in the product: frame
 * completeness, motion readiness, the prompt reference picker, automation
 * planning and the continuity workspace all ask it. It answered from
 * `frame.winner || shot.winner` — a raw pointer — so every one of those
 * decisions treated a selection nobody approved as production truth, and a
 * legacy project unlocked paid motion generation on the strength of it.
 *
 * It asks the ledger. The image is still THERE and `guidedFrameImage` returns
 * it, because a historic selection is real work a creator can approve in one
 * act; what it no longer does is decide anything. */
function guidedFrameApproved(s, frame, takes = takesFor(s.id), index = 0) {
  if (!s || !frame) return null;
  if (typeof hasCurrentHumanAuthority !== "function") return null;
  if (!hasCurrentHumanAuthority(P, { kind: "shot-frame", shotId: s.id, frameId: frame.id })) return null;
  return guidedFrameImage(s, frame, takes, index);
}
function guidedFrameCandidateRows(s, frame, takes = takesFor(s.id), index = 0) {
  return takes.filter((take) => {
    if (isVideo(take.name) || isAudio(take.name)) return false;
    const row = candidateRecord(s, take.name);
    if (row.frameId) return row.frameId === frame.id;
    return index === 0;
  });
}
function guidedPreviousFrame(s, index) {
  return index > 0 ? guidedFrames(s)[index - 1] : null;
}
function guidedFramePromptRefs(s, frame, index, state) {
  /* The frame's id, not the shot's silence: this is the one caller that knows
     which frame is being generated, and a frame may declare its own entity
     states. Everything downstream resolves them through the canonical rule. */
  const refs = index === 0
    ? shotCreationPromptReferences(s, frame?.id || "")
    : shotCreationReferences(s, frame?.id || "").filter((ref) => shotInputEnabled(s, ref.key));
  const out = [...refs];
  if (index > 0 && state.usePreviousFrame) {
    const prev = guidedPreviousFrame(s, index);
    const prevTake = prev ? guidedFrameApproved(s, prev, takesFor(s.id), index - 1) : null;
    if (prevTake && !out.some((ref) => ref.file === prevTake.name)) {
      out.unshift({
        key: `previous-frame:${prev.id}:${prevTake.name}`,
        entityId: s.id,
        label: `Approved Frame ${prev.label}`,
        file: prevTake.name,
        url: prevTake.url,
        role: "base",
        mediaType: "image",
        approved: true,
        missing: false,
        instruction: `Use approved Frame ${prev.label} as the exact starting composition and identity reference. Change only what the new frame description requires.`,
      });
    }
  }
  if (state.automationBlockingAssetId) {
    const row = blockingMediaRows(s).find(({ asset }) => String(asset.id) === String(state.automationBlockingAssetId));
    if (row && !out.some((ref) => ref.key === `frame-blocking:${frame.id}:${row.asset.id}`)) {
      out.push({
        key: `frame-blocking:${frame.id}:${row.asset.id}`,
        entityId: s.id,
        assetId: row.asset.id,
        label: `${frame.label || "Frame"} derivative blocking guide`,
        file: row.asset.file,
        url: mediaAssetUrl(row.asset),
        role: "composition",
        mediaType: "image",
        approved: true,
        missing: false,
        blocking: true,
        blockingAdherence: "strict",
        instruction: `Use only for Frame ${frame.label || ""} camera, crop, pose, spacing, scale, depth order and contact points. Preserve identity and visual design from approved references and the previous frame.`,
      });
    }
  }
  return compositionAugmentedReferences(s, out);
}
function guidedFrameMode(state, refs) {
  if (state.mode && state.mode !== "auto") return state.mode;
  if (refs.some((ref) => ["base", "composition"].includes(ref.role) && ref.url)) return "edit";
  if (refs.some((ref) => ref.url)) return "multi-reference";
  return "t2i";
}
function guidedFrameStepState(s, frame, index, takes) {
  const state = guidedFrameState(s, frame, index);
  const approved = guidedFrameApproved(s, frame, takes, index);
  const candidates = guidedFrameCandidateRows(s, frame, takes, index);
  const latest = latestPromptBuild(P, state.promptBuilds);
  const manual = manualFirstWorkflow();
  if (approved) return { key: "approved", label: "Approved", approved, candidates, latest };
  if (candidates.length) return { key: "review", label: manual ? `${candidates.length} to choose from` : `${candidates.length} to review`, approved, candidates, latest };
  if (latest) return { key: "return", label: manual ? "Add the image" : "Return candidates", approved, candidates, latest };
  if (String(state.action || "").trim()) return { key: "prompt", label: manual ? "Add existing image" : "Build prompt", approved, candidates, latest };
  return { key: "describe", label: "Describe frame", approved, candidates, latest };
}
function guidedFrameProgress(s, takes) {
  const frames = guidedFrames(s);
  const firstApproved = !!guidedFrameApproved(s, frames[0], takes, 0);
  const requiredApproved = frames.filter((f) => f.required !== false).every((f, i) => !!guidedFrameApproved(s, f, takes, i));
  return { frames, firstApproved, requiredApproved };
}

function creationTargetType(list) {
  return list === "characters" ? "character" : list === "locations" ? "location" : list === "props" ? "prop" : list === "vehicles" ? "vehicle" : list;
}
function supplementalInstruction(role, label) {
  const map = {
    expression: "Use only for facial expression and emotional performance; preserve identity from the primary anchor.",
    body: "Use only for body proportions, anatomy, silhouette, and physical features.",
    outfit: "Use only for wardrobe, costume construction, layers, accessories, and materials.",
    pose: "Use only for pose, gesture, weight distribution, and performance energy.",
    turnaround: "Use only for multi-angle design continuity and hidden-side details.",
    detail: "Use only for close design details, texture, face, hair, or material treatment.",
    "alternate-view": "Use only for alternate-angle spatial continuity; follow the shot brief for final framing.",
    lighting: "Use only for lighting, atmosphere, color response, and exposure intent.",
    "continuity-state": "Use only for this approved continuity condition or state.",
    scale: "Use only for exact scale and interaction relationships.",
  };
  return map[role] || `Use only for the approved ${label || role} reference role.`;
}
function assetSupplementalReferences(list, entity, s) {
  const targetType = creationTargetType(list);
  return mediaLinksForTarget(targetType, entity.id)
    .filter(({ asset, link }) => link.generationInput && link.role !== "do-not-use" && mediaIsImage(asset))
    .map(({ asset, link }) => {
      const role = mediaPromptRole(link.role);
      return {
        key: `media:${asset.id}:${link.id}`,
        entityId: entity.id,
        entityName: entity.name || entity.id,
        sourceType: targetType,
        assetId: asset.id,
        linkId: link.id,
        label: `${entity.name || entity.id} · ${asset.title || asset.originalName || asset.file || role}`,
        file: asset.file || "",
        url: mediaAssetUrl(asset),
        role,
        approved: true,
        missing: !asset.file,
        supplemental: true,
        angleTag: link.angleTag || "",
        referenceKind: link.referenceKind || (typeof defaultReferenceKind === "function" ? defaultReferenceKind(link.role) : "general"),
        detailRegion: link.detailRegion || "",
        availableAngles: link.availableAngles || "",
        priority: link.priority || "supporting",
        instruction: [typeof referenceMetadataInstruction === "function" ? referenceMetadataInstruction(link) : "", link.notes || supplementalInstruction(role, link.role)].filter(Boolean).join(" "),
      };
    });
}
function planningGenerationReferences(rows, ownerId, mediaTypes = ["image"], scope = "shot") {
  return rows
    .filter(({ asset, link }) => link.generationInput && link.role !== "do-not-use")
    .filter(({ asset }) => {
      const name = asset.file || asset.originalName || "";
      const kind = isAudio(name) ? "audio" : isVideo(name) ? "video" : "image";
      return mediaTypes.includes(kind);
    })
    .map(({ asset, link }) => {
      const name = asset.file || asset.originalName || "";
      const mediaType = isAudio(name) ? "audio" : isVideo(name) ? "video" : "image";
      const role = mediaPromptRole(link.role);
      return {
        key: `media:${asset.id}:${link.id}`,
        entityId: ownerId,
        assetId: asset.id,
        linkId: link.id,
        label: asset.title || asset.originalName || asset.file || `${scope} input`,
        file: asset.file || "",
        url: mediaAssetUrl(asset),
        role,
        mediaType,
        approved: true,
        missing: !asset.file,
        planning: true,
        scope,
        angleTag: link.angleTag || "",
        referenceKind: link.referenceKind || (typeof defaultReferenceKind === "function" ? defaultReferenceKind(link.role) : "general"),
        detailRegion: link.detailRegion || "",
        availableAngles: link.availableAngles || "",
        priority: link.priority || "supporting",
        instruction: [typeof referenceMetadataInstruction === "function" ? referenceMetadataInstruction(link) : "", link.notes || `Use this ${role} input only for its assigned ${scope} planning job.`].filter(Boolean).join(" "),
        blocking: ["blocking-frame", "storyboard", "animatic-frame"].includes(link.role),
        blockingState: link.blockingState || "",
        blockingAdherence: link.blockingAdherence || "strict",
        sourceRole: link.role || "",
      };
    });
}
function shotPlanningGenerationReferences(s, mediaTypes = ["image"]) {
  const shotRows = planningGenerationReferences(shotMediaLinks(s), s.id, mediaTypes, "shot");
  const sceneRows = planningGenerationReferences(mediaLinksForTarget("scene", s.scene), s.scene, mediaTypes, "scene");
  const seen = new Set();
  return [...sceneRows, ...shotRows].filter((ref) => !seen.has(ref.key) && seen.add(ref.key));
}

function blockingMediaRows(s) {
  return shotMediaLinks(s).filter(({ link, asset }) =>
    ["blocking-frame", "storyboard", "animatic-frame"].includes(link.role) && mediaIsImage(asset),
  );
}
function activeBlockingRow(s) {
  const c = ensureShotCreation(s);
  const rows = blockingMediaRows(s);
  return rows.find(({ asset, link }) => asset.id === c.activeBlockingAssetId || link.blockingState === "active") || null;
}
function blockingSettingsSummary(build) {
  const settings = build?.providerPayload?.recommendedSettings || {};
  return [settings.qualityLevel, settings.outputSize, settings.aspectRatio, settings.note].filter(Boolean).join(" · ");
}
function blockingPromptResult(s, build) {
  const plan = build.blockingPlan || build.spec?.blockingPlan || {};
  const resolved = build.blockingImprovementNotes?.length || plan.conflictsResolved?.length
    ? `<details class="blocking-improvement-notes"><summary>Review resolved framing conflicts</summary><ul>${(build.blockingImprovementNotes?.length ? build.blockingImprovementNotes : plan.conflictsResolved).map((note) => `<li>${esc(note)}</li>`).join("")}</ul></details>`
    : "";
  const source = build.llmUsed ? "Assistant-refined structural plan" : "Deterministic structural plan";
  return `<article class="guided-prompt-result blocking-prompt-result"><header><div><span>BLOCKING PROMPT READY</span><b>${esc(build.profileName || build.profileId)}</b><small>${esc(blockingSettingsSummary(build) || "Disposable greyscale composition scaffold")} · ${esc(source)}</small></div><div><button class="copy-btn" onclick="copyText(${JSON.stringify(build.prompt || "").replace(/"/g, "&quot;")})">COPY</button>${typeof falPromptAction === "function" ? falPromptAction(s.id,"blocking","",build.id,`<button class="chip" onclick="downloadBlockingPrompt('${s.id}','${build.id}')">Download</button>`) : `<button class="chip" onclick="downloadBlockingPrompt('${s.id}','${build.id}')">Download</button>`}</div></header>${build.warnings?.length ? `<ul class="guided-prompt-warnings">${build.warnings.map((warning) => `<li>${esc(warning)}</li>`).join("")}</ul>` : ""}${resolved}<details open><summary>View blocking prompt</summary><pre>${esc(build.prompt || "")}</pre>${typeof falGenerationReady === "function" && falGenerationReady() ? `<button class="text-link-btn" onclick="downloadBlockingPrompt('${s.id}','${build.id}')">Download prompt file</button>` : ""}</details>${typeof falGenerationInline === "function" ? falGenerationInline(s.id,"blocking") : ""}</article>`;
}
function blockingFrameBrief(s) {
  const frame = guidedFrames(s)[0], state = guidedFrameState(s, frame, 0);
  return String(state.action || frame.description || s.desc || "").trim();
}
function blockingAdditionalDirection(s) {
  const frame = guidedFrames(s)[0], state = guidedFrameState(s, frame, 0), c = ensureShotCreation(s);
  return [state.staging, state.camera, state.notes, c.blockingRevisionRequest ? `Requested blocking changes: ${c.blockingRevisionRequest}` : ""].filter(Boolean).join("\n").trim();
}
function blockingDefaultTitle(s, index = 0) {
  const brief = String(s.title || blockingFrameBrief(s) || s.desc || "Blocking frame")
    .replace(/\s+/g, " ").trim().replace(/[.!?]+$/g, "");
  const short = brief.length > 54 ? brief.slice(0, 51).trim() + "…" : brief;
  return `${s.id} — ${short} B${String(index + 1).padStart(2, "0")}`;
}
function blockingFrameCard(s, row) {
  const c = ensureShotCreation(s), { asset, link } = row, frameId = link.blockingFrameId || "", frame = frameId ? guidedFrames(s).find((item) => item.id === frameId) : null;
  const frameState = frame ? guidedFrameState(s, frame, guidedFrames(s).indexOf(frame)) : null;
  const frameActive = !!frame && frameState?.automationBlockingAssetId === asset.id;
  const active = asset.id === c.activeBlockingAssetId || link.blockingState === "active" || frameActive;
  const version = link.blockingVersion ? ` · ${link.blockingVersion}` : "";
  const title = asset.title || asset.originalName || asset.file;
  const stateText = frameActive ? `Active Frame ${frame.label} guide` : active ? "Active composition guide" : "Returned planning frame";
  const review = typeof blockingAttemptReviewFor === "function" ? blockingAttemptReviewFor(s, asset.id, frameId) : null;
  const reviewMarkup = review ? `<span class="blocking-review-pill ${review.pass ? "pass" : "flag"}">${Number(review.score || 0)} · ${review.pass ? "PASS" : "FLAG"}</span><small class="blocking-review-note">${esc(review.notes || "AI blocking review completed.")}</small>` : `<span class="blocking-review-pill pending">NOT REVIEWED</span>`;
  const action = frame ? (frameActive ? `<button class="chip danger" onclick="removeFrameBlockingGuide('${s.id}','${frame.id}','${asset.id}')">Remove Frame ${esc(frame.label)} guide</button>` : `<button class="approve-btn" onclick="useFrameBlockingGuide('${s.id}','${frame.id}','${asset.id}')">Use for frame ${esc(frame.label)}</button>`) : (active ? `<button class="chip danger" onclick="removeBlockingGuide('${s.id}','${asset.id}')">Remove guide</button>` : `<button class="approve-btn" onclick="useBlockingGuide('${s.id}','${asset.id}')">Use as guide</button>`);
  return `<article class="blocking-frame-card ${active ? "active" : ""} ${frame ? "frame-specific" : ""}"><button type="button" class="blocking-frame-thumb" onclick="openBlockingAttemptViewer('${s.id}','${asset.id}')" title="View ${attr(title)} full size" aria-label="View ${attr(title)} full size"><img loading="lazy" decoding="async" src="${attr(mediaAssetUrl(asset))}" alt="${attr(title)}"><span>View blocking</span><i>full size</i></button><div><b>${esc(title)}</b><small>${esc(stateText)}${esc(version)}</small>${frame ? `<span class="frame-blocking-target">FRAME ${esc(frame.label)} ENDPOINT</span>` : ""}${reviewMarkup}${asset.generationRecord ? `<small>${esc(asset.generationRecord.model || "")}${asset.generationRecord.date ? ` · ${esc(asset.generationRecord.date.slice(0,10))}` : ""}</small>` : ""}</div><div class="blocking-frame-actions"><button class="chip" onclick="openBlockingNamingModal('${s.id}', ['${asset.id}'])">Rename</button>${action}</div></article>`;
}
function blockingAttemptViewerMarkup(s, row) {
  const c = ensureShotCreation(s), rows = blockingMediaRows(s), { asset, link } = row;
  const index = Math.max(0, rows.findIndex((item) => item.asset.id === asset.id));
  const previous = rows[index - 1], next = rows[index + 1];
  const frameId = link.blockingFrameId || "";
  const frame = frameId ? guidedFrames(s).find((item) => item.id === frameId) : null;
  const frameIndex = frame ? guidedFrames(s).indexOf(frame) : -1;
  const frameState = frame ? guidedFrameState(s, frame, frameIndex) : null;
  const frameActive = !!frame && frameState?.automationBlockingAssetId === asset.id;
  const active = frame ? frameActive : asset.id === c.activeBlockingAssetId || link.blockingState === "active";
  const title = asset.title || asset.originalName || asset.file;
  const version = link.blockingVersion || `B${String(index + 1).padStart(2, "0")}`;
  const generation = asset.generationRecord || {};
  const revision = !frame && c.blockingRevisionSourceAssetId === asset.id ? c.blockingRevisionRequest || "" : "";
  const canGenerate = typeof falGenerationReady === "function" && falGenerationReady();
  const improveAttrs = typeof aiDisabledAttrs === "function" ? aiDisabledAttrs("text") : "";
  const headerState = frame
    ? frameActive ? `Active Frame ${frame.label} endpoint guide` : `Frame ${frame.label} endpoint attempt`
    : active ? "Active composition guide" : "Returned planning frame";
  const statusTitle = frame
    ? frameActive ? `ACTIVE FRAME ${frame.label} ENDPOINT GUIDE` : `NOT SELECTED FOR FRAME ${frame.label}`
    : active ? "ACTIVE COMPOSITION GUIDE" : "NOT SELECTED";
  const statusNote = frame
    ? frameActive
      ? `Frame ${frame.label} uses this image for endpoint camera, crop, pose, spacing, scale, depth and contact points while the previous approved frame remains the editable continuity base.`
      : `Choose this as the geometry guide for Frame ${frame.label} if it best describes the changed endpoint. It never replaces the previous approved frame or finished references.`
    : active
      ? "Final-frame prompts use this image for crop, camera, broad placement, scale, depth, pose and contact points only."
      : "Select this attempt as the geometry guide when its camera and layout are the best match.";
  const revisionPanel = frame
    ? `<section class="blocking-attempt-revision frame-specific"><span>FRAME ${esc(frame.label)} DERIVATIVE BLOCKING</span><b>Edit the frame brief before another automated retry</b><p>This attempt belongs only to Frame ${esc(frame.label)}. The durable still-automation run creates revisions from the approved previous frame plus Frame ${esc(frame.label)}'s action, camera and additional direction.</p><small>Finished identity, materials, lighting and location design still come from approved references—not this grayscale guide.</small></section>`
    : `<section class="blocking-attempt-revision"><span>REVISE THIS ATTEMPT</span><label for="blocking-viewer-revision">Changes for the next blocking attempt</label><textarea id="blocking-viewer-revision" placeholder="Example: Move the subject left, lower the camera, make the object larger and show less background.">${esc(revision)}</textarea><small>Only describe structural changes. The selected attempt becomes the editable grayscale scaffold; finished references and visual style remain excluded.</small><div class="blocking-attempt-revision-actions"><button class="ghost-btn" onclick="buildBlockingRevisionFromViewer('${s.id}','${asset.id}',false,false)">Build revised prompt</button><button class="ghost-btn" onclick="buildBlockingRevisionFromViewer('${s.id}','${asset.id}',true,false)"${improveAttrs}>Improve + build</button>${canGenerate ? `<button class="approve-btn" onclick="buildBlockingRevisionFromViewer('${s.id}','${asset.id}',false,true)">Build + generate</button>` : ""}</div></section>`;
  const guideAction = frame
    ? frameActive
      ? `<button class="chip danger" onclick="closeModal();removeFrameBlockingGuide('${s.id}','${frame.id}','${asset.id}')">Remove frame ${esc(frame.label)} guide</button>`
      : `<button class="approve-btn large" onclick="closeModal();useFrameBlockingGuide('${s.id}','${frame.id}','${asset.id}')">Use for frame ${esc(frame.label)}</button>`
    : active
      ? `<button class="chip danger" onclick="closeModal();removeBlockingGuide('${s.id}','${asset.id}')">Remove guide</button>`
      : `<button class="approve-btn large" onclick="closeModal();useBlockingGuide('${s.id}','${asset.id}')">Use as guide</button>`;
  return `<div class="blocking-attempt-viewer"><header class="blocking-attempt-viewer-title"><div><span>BLOCKING ATTEMPT ${index + 1} OF ${rows.length}${frame ? ` · FRAME ${esc(frame.label)} ENDPOINT` : ""}</span><h3>${esc(title)}</h3><p>${esc(headerState)} · ${esc(version)}${generation.model ? ` · ${esc(generation.model)}` : ""}</p></div><div class="blocking-attempt-viewer-navigation">${previous ? `<button class="chip" onclick="openBlockingAttemptViewer('${s.id}','${previous.asset.id}')" aria-label="Previous blocking attempt">‹</button>` : `<button class="chip" disabled aria-label="No previous blocking attempt">‹</button>`}${next ? `<button class="chip" onclick="openBlockingAttemptViewer('${s.id}','${next.asset.id}')" aria-label="Next blocking attempt">›</button>` : `<button class="chip" disabled aria-label="No next blocking attempt">›</button>`}<button class="cancel" onclick="closeModal()" aria-label="Close blocking attempt viewer">Close</button></div></header><div class="blocking-attempt-viewer-layout"><section class="blocking-attempt-viewer-visual"><div class="blocking-attempt-viewer-stage" role="button" tabindex="0" aria-pressed="false" aria-label="Toggle full-size image zoom" onclick="toggleBlockingAttemptZoom(this)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleBlockingAttemptZoom(this)}"><img src="${attr(mediaAssetUrl(asset))}" alt="${attr(title)}"></div><div class="blocking-attempt-viewer-image-tools"><span class="blocking-attempt-viewer-zoom-label">Click image to zoom</span><a class="chip" href="${attr(mediaAssetUrl(asset))}" target="_blank" rel="noopener">Open original</a></div></section><aside class="blocking-attempt-viewer-sidebar"><section class="blocking-attempt-status ${active ? "active" : ""}"><span>GUIDE STATUS</span><b>${esc(statusTitle)}</b><p>${esc(statusNote)}</p></section>${revisionPanel}</aside></div><footer class="blocking-attempt-viewer-actions"><div><button class="chip" onclick="closeModal();openBlockingNamingModal('${s.id}',['${asset.id}'])">Rename</button><button class="chip" onclick="closeModal();inspectMediaFile('${attr(encodeURIComponent(mediaAssetUrl(asset)))}','','${attr(encodeURIComponent(title))}','image')">Inspect</button></div><div>${guideAction}<button class="cancel" onclick="closeModal()">Close</button></div></footer></div>`;
}

window.openBlockingAttemptViewer = (id, assetId) => {
  const s = shotById(id), row = s ? blockingMediaRows(s).find(({ asset }) => asset.id === assetId) : null;
  if (!row) return toast("Blocking attempt is no longer available");
  openModal(blockingAttemptViewerMarkup(s, row));
};
window.toggleBlockingAttemptZoom = (stage) => {
  if (!stage) return;
  const zoomed = stage.classList.toggle("zoomed");
  stage.setAttribute?.("aria-pressed", zoomed ? "true" : "false");
  const label = document.querySelector?.(".blocking-attempt-viewer-zoom-label");
  if (label) label.textContent = zoomed ? "Click image to fit" : "Click image to zoom";
};
window.buildBlockingRevisionFromViewer = async (id, assetId, improve = false, generate = false) => {
  const s = shotById(id), row = s ? blockingMediaRows(s).find(({ asset }) => asset.id === assetId) : null;
  if (!row) return toast("Blocking attempt is no longer available");
  const request = String(document.getElementById("blocking-viewer-revision")?.value || "").trim();
  if (!request) return toast("Describe the structural changes for the next attempt");
  const c = ensureShotCreation(s);
  c.blockingRevisionRequest = request;
  c.blockingRevisionSourceAssetId = assetId;
  dirty();
  closeModal();
  const build = await window.buildBlockingPrompt(id, improve);
  if (build && generate && typeof window.openFalGenerationModal === "function") {
    setTimeout(() => window.openFalGenerationModal("blocking", id, "", build.id), 0);
  }
};
window.openBlockingNamingModal = (id, assetIds) => {
  const s = shotById(id), ids = Array.isArray(assetIds) ? assetIds : [assetIds];
  const rows = ids.map((assetId, index) => {
    const row = blockingMediaRows(s).find(({ asset }) => asset.id === assetId);
    if (!row) return "";
    const { asset, link } = row;
    return `<fieldset class="blocking-name-row"><legend>Blocking frame ${index + 1}</legend><div class="project-media-control-grid"><label class="wide"><span>Name</span><input id="blocking-name-${index}" value="${attr(asset.title || blockingDefaultTitle(s, index))}" placeholder="${attr(blockingDefaultTitle(s, index))}"></label><label><span>Version</span><input id="blocking-version-${index}" value="${attr(link.blockingVersion || `B${String(index + 1).padStart(2, "0")}`)}" placeholder="B01"></label><label class="wide"><span>Notes</span><input id="blocking-notes-${index}" value="${attr(asset.notes || "")}" placeholder="What this layout establishes…"></label><label class="checkline"><input type="radio" name="blocking-active-guide" value="${attr(asset.id)}" ${link.blockingState === "active" ? "checked" : ""}> Use as active guide</label></div></fieldset>`;
  }).filter(Boolean).join("");
  if (!rows) return;
  window._blockingNamingQueue = { id, assetIds: ids };
  openModal(`<h3>Name returned blocking frames</h3><div class="modal-sub">USE A READABLE SHOT NAME INSTEAD OF THE GENERATED FILE ID</div><div class="blocking-name-list">${rows}</div><div class="modal-actions"><button class="cancel" onclick="closeModal()">Later</button><button class="approve-btn" onclick="saveBlockingNames()">SAVE BLOCKING FRAMES</button></div>`);
};
window.saveBlockingNames = () => {
  const queue = window._blockingNamingQueue;
  if (!queue) return;
  const s = shotById(queue.id), c = ensureShotCreation(s);
  let activeId = "";
  queue.assetIds.forEach((assetId, index) => {
    const row = blockingMediaRows(s).find(({ asset }) => asset.id === assetId);
    if (!row) return;
    row.asset.title = document.getElementById(`blocking-name-${index}`)?.value.trim() || blockingDefaultTitle(s, index);
    row.link.blockingVersion = document.getElementById(`blocking-version-${index}`)?.value.trim() || `B${String(index + 1).padStart(2, "0")}`;
    row.asset.notes = document.getElementById(`blocking-notes-${index}`)?.value.trim() || "Blocking frame — planning scaffold, not canon.";
    const active = document.querySelector('input[name="blocking-active-guide"]:checked')?.value;
    if (active === assetId) activeId = assetId;
  });
  if (activeId) {
    for (const { asset, link } of blockingMediaRows(s)) {
      const active = asset.id === activeId;
      link.blockingState = active ? "active" : "returned";
      link.generationInput = active;
      link.priority = active ? "primary" : "supporting";
      link.blockingAdherence = c.blockingGuideAdherence;
    }
    c.activeBlockingAssetId = activeId;
    const active = blockingMediaRows(s).find(({ asset }) => asset.id === activeId);
    if (active) c.composition.baseFrame.source = `ref:media:${active.asset.id}:${active.link.id}`;
  }
  delete window._blockingNamingQueue;
  dirty();
  closeModal();
  route();
  toast(activeId ? "Blocking frames named and active guide selected" : "Blocking frame names saved");
};
function guidedBlockingPanel(s) {
  const c = ensureShotCreation(s), builds = c.blockingBuilds, latest = builds.at(-1), rows = blockingMediaRows(s), active = activeBlockingRow(s), operation = guidedPromptOp("blocking", s.id, ""), busy = operation?.status === "busy", busyAction = operation?.action || "compile";
  if (c.blockingRevisionSourceAssetId && !rows.some(({ asset }) => asset.id === c.blockingRevisionSourceAssetId)) c.blockingRevisionSourceAssetId = "";
  const result = busy
    ? assistantWorkingCard(busyAction === "improve" ? "Improving the blocking plan around the primary action…" : "Compiling a reference-free blocking prompt…", busyAction === "improve" ? "The assistant may take up to three minutes per attempt. It is proposing camera and layout fields; CineBraid validates each response and retries automatically before deterministic fallback." : "This uses shot text and structural corrections only. No full-colour anchors are sent.", { mode: busyAction === "improve" ? "assistant" : "compile" })
    : operation?.status === "error"
      ? guidedPromptErrorMarkup(operation.error, `buildBlockingPrompt('${s.id}',${busyAction === "improve" ? "true" : "false"})`)
      : latest ? blockingPromptResult(s, latest) : `<div class="guided-next-note"><b>Optional assisted blocking:</b> build a cheap greyscale layout when you want CineBraid to help plan camera, scale, pose and contact points.</div>`;
  const revisionOptions = rows.map(({ asset }) => `<option value="${attr(asset.id)}" ${c.blockingRevisionSourceAssetId === asset.id ? "selected" : ""}>${esc(asset.title || asset.file)}</option>`).join("");
  const revision = `<section class="blocking-revision-box"><header><div><b>Changes for the next blocking attempt</b><small>Describe only structural corrections: pose, hand/object contact, size, screen position, crop, camera height, angle or lens width.</small></div></header><textarea placeholder="Example: Make the wheel much larger, move the skull directly under the tire, lower the camera and show less background." onchange="setBlockingField('${s.id}','blockingRevisionRequest',this.value)">${esc(c.blockingRevisionRequest)}</textarea>${rows.length ? `<label><span>Optionally revise an existing attempt</span><select onchange="setBlockingField('${s.id}','blockingRevisionSourceAssetId',this.value)"><option value="">Generate a fresh revised blocking frame</option>${revisionOptions}</select></label>` : ""}<p>Blocking remains flat grayscale. Full-colour references and finished location design are intentionally excluded.</p></section>`;
  /* THE CONSOLE REVIEWS THE OPENING POOL, AND NOW SAYS SO.

     It used to gate itself on every attempt on the shot and then act on the unassigned
     ones alone, so a shot whose attempts were all bound to frames showed REVIEW ALL
     WITH AI and answered a click with "Add at least one blocking attempt first". Both
     the gate and the count now come from the pool this console actually reviews, and
     frame-bound attempts are named with their own reviewer rather than disappearing. */
  const pools = typeof blockingAttemptPools === "function" ? blockingAttemptPools(s) : { rows, opening: rows, framed: new Map() };
  const blockingReview = typeof blockingAttemptReviewSummary === "function" ? blockingAttemptReviewSummary(s) : { rows: pools.opening, reviewed:0, recommended:null, recommendation:null, stale:false };
  const openingRows = blockingReview.rows || pools.opening;
  const reviewBusy = c.blockingReviewBusy === "opening";
  const reviewStatus = reviewBusy
    ? "Vision assistant is scoring every option…"
    : blockingReview.reviewed
      ? `${blockingReview.reviewed}/${openingRows.length} scored${blockingReview.stale ? " · new options need review" : " · review current"}`
      : "No AI scores yet";
  const framedNote = pools.framed.size
    ? `<small class="blocking-review-framed-note">${plural(pools.rows.length - openingRows.length, "attempt")} belong${pools.rows.length - openingRows.length === 1 ? "s" : ""} to a specific frame and ${pools.rows.length - openingRows.length === 1 ? "is" : "are"} reviewed with that frame below, not against the shot's opening composition.</small>`
    : "";
  const reviewConsole = openingRows.length ? `<section class="blocking-review-console"><div class="blocking-review-console-copy"><span>BLOCKING QUALITY REVIEW</span><b>Score every opening composition option together</b><small>${esc(reviewStatus)} · AI scores are advisory; you still choose the guide.</small>${framedNote}</div><div class="blocking-review-console-actions"><button class="ghost-btn" onclick="reviewBlockingAttempts('${s.id}','',false)" ${reviewBusy ? "disabled" : ""}${typeof aiDisabledAttrs === "function" ? aiDisabledAttrs("vision") : ""}>${reviewBusy ? "REVIEWING ALL…" : blockingReview.reviewed ? "REVIEW ALL AGAIN" : "REVIEW ALL WITH AI"}</button>${blockingReview.recommended && blockingReview.recommendation?.pass ? `<button class="approve-btn" onclick="useRecommendedBlockingAttempt('${s.id}')">USE RECOMMENDED · ${Number(blockingReview.recommendation.score || 0)}</button>` : ""}<label class="blocking-auto-review-toggle"><input type="checkbox" ${c.autoReviewBlocking ? "checked" : ""} onchange="setAutoBlockingReview('${s.id}',this.checked)"><span>Automatically review new options</span></label></div></section>` : pools.rows.length ? `<section class="blocking-review-console"><div class="blocking-review-console-copy"><span>BLOCKING QUALITY REVIEW</span><b>No opening composition options yet</b><small>${plural(pools.rows.length, "attempt")} on this shot ${pools.rows.length === 1 ? "belongs" : "belong"} to a specific frame. Review ${pools.rows.length === 1 ? "it" : "them"} with ${pools.rows.length === 1 ? "its" : "their"} frame below, or add an unassigned attempt to compare opening compositions.</small></div></section>` : "";
  const frameReviewConsoles = [...pools.framed.entries()].map(([frameId, frameRows]) => {
    const frame = guidedFrames(s).find((item) => item.id === frameId);
    if (!frame) return "";
    const summary = typeof blockingAttemptReviewSummary === "function" ? blockingAttemptReviewSummary(s, frameId) : { rows: frameRows, reviewed: 0, recommended: null, recommendation: null, stale: false };
    const busy = c.blockingReviewBusy === frameId;
    const status = busy ? "Vision assistant is scoring this frame's options…" : summary.reviewed ? `${summary.reviewed}/${frameRows.length} scored${summary.stale ? " · new options need review" : " · review current"}` : "No AI scores yet";
    return `<section class="blocking-review-console frame-scoped"><div class="blocking-review-console-copy"><span>FRAME ${esc(frame.label)} BLOCKING REVIEW</span><b>Score this frame's endpoint options together</b><small>${esc(status)} · these are compared as ${esc(frame.label)} endpoints, never as the shot's opening guide.</small></div><div class="blocking-review-console-actions"><button class="ghost-btn" onclick="reviewBlockingAttempts('${s.id}','${attr(frameId)}',false)" ${busy ? "disabled" : ""}${typeof aiDisabledAttrs === "function" ? aiDisabledAttrs("vision") : ""}>${busy ? "REVIEWING…" : summary.reviewed ? `REVIEW FRAME ${esc(frame.label)} AGAIN` : `REVIEW FRAME ${esc(frame.label)} WITH AI`}</button>${summary.recommended && summary.recommendation?.pass ? `<button class="approve-btn" onclick="useRecommendedBlockingAttempt('${s.id}','${attr(frameId)}')">USE RECOMMENDED · ${Number(summary.recommendation.score || 0)}</button>` : ""}</div></section>`;
  }).join("");
  const intake = `<div class="blocking-intake"><header><div><b>Blocking attempts</b><small>Upload boards or layout frames made anywhere. Generated or uploaded planning images stay outside production takes and can never become final winners.</small></div><div class="blocking-intake-actions"><button class="ghost-btn" onclick="document.getElementById('blocking-file-${attr(s.id)}').click()">Upload</button></div><input id="blocking-file-${attr(s.id)}" type="file" multiple accept="image/*" hidden onchange="uploadBlockingFrames('${s.id}',this.files);this.value=''" /></header><div class="blocking-dropzone" ondragover="event.preventDefault();this.classList.add('dragover')" ondragleave="this.classList.remove('dragover')" ondrop="event.preventDefault();this.classList.remove('dragover');uploadBlockingFrames('${s.id}',event.dataTransfer.files)"><b>Drop external blocking images here</b><span>PNG, JPG, JPEG or WebP · optional in-app results arrive here too</span></div>${reviewConsole}${frameReviewConsoles}${rows.length ? `<div class="blocking-frame-list">${rows.map((row) => blockingFrameCard(s, row)).join("")}</div>` : `<div class="guided-empty-inline"><b>No blocking attempts yet.</b><span>Upload a board, sketch or layout frame, or open Optional assisted blocking to build one.</span></div>`}</div>`;
  const reviewTools = "";
  /* Gated on the pool the automatic pass actually reviews, so a shot with only
     frame-bound attempts no longer schedules a review that finds nothing. */
  if (c.autoReviewBlocking && openingRows.length && blockingReview.stale && !reviewBusy && typeof maybeAutoReviewBlockingAttempts === "function")
    setTimeout(() => maybeAutoReviewBlockingAttempts(s.id, ""), 0);
  const assistedOpen = !manualFirstWorkflow() || busy || operation?.status === "error";
  const historyNote = manualFirstWorkflow() && latest ? `<div class="guided-assisted-history-note"><b>Assisted history available</b><span>A previous blocking prompt is preserved inside Optional assisted blocking.</span></div>` : "";
  const assisted = `${historyNote}<details class="guided-assisted-tools blocking-assisted-tools" ${assistedOpen ? "open" : ""}><summary><div><span>OPTIONAL ASSISTED BLOCKING</span><b>Build, generate, or automate a greyscale composition guide</b><small>Build a prompt to generate options manually, or run bounded blocking automation. Uploaded frames remain first-class.</small></div></summary><div class="guided-assisted-tools-body">${reviewTools}${typeof shotAutomationHub === "function" ? shotAutomationHub(s,"look") : ""}<div class="blocking-setup"><details class="guided-inline-defaults blocking-defaults"><summary>Adjust blocking defaults · auto emphasis · labels on</summary><div><label><span>Blocking target</span><select onchange="setBlockingField('${s.id}','blockingProfileId',this.value)">${creationProfileOptions("blocking", c.blockingProfileId)}</select></label><label><span>Emphasis</span><select onchange="setBlockingField('${s.id}','blockingEmphasis',this.value)"><option value="auto" ${c.blockingEmphasis === "auto" ? "selected" : ""}>Auto from shot</option><option value="full-scene" ${c.blockingEmphasis === "full-scene" ? "selected" : ""}>Full scene</option><option value="balanced" ${c.blockingEmphasis === "balanced" ? "selected" : ""}>Balanced</option><option value="action-insert" ${c.blockingEmphasis === "action-insert" ? "selected" : ""}>Action insert</option></select></label><label class="checkline"><input type="checkbox" ${c.blockingIncludeLabels ? "checked" : ""} onchange="setBlockingField('${s.id}','blockingIncludeLabels',this.checked)"> Include element labels</label></div></details><div class="blocking-build-actions"><button class="assemble-btn" ${busy ? "disabled" : ""} onclick="buildBlockingPrompt('${s.id}',false)">${busy && busyAction === "compile" ? "Compiling…" : latest ? "Rebuild prompt" : "Build prompt"}</button><button class="ghost-btn" ${busy ? "disabled" : ""} onclick="buildBlockingPrompt('${s.id}',true)"${aiDisabledAttrs("text")}>${busy && busyAction === "improve" ? "Improving…" : "Improve"}</button></div></div><p class="guided-assisted-action-note">Build Prompt reveals the paid Generate action. Automate Blocking below runs build → generate → review → revise → retry and selects the best passing guide.</p>${revision}${result}${typeof blockingAutomationPanel === "function" ? blockingAutomationPanel(s) : ""}</div></details>`;
  return `<details class="guided-work-panel blocking-work-panel" data-guided-panel="blocking" ${guidedPanelOpen(s, "blocking", !!active) ? "open" : ""} ontoggle="rememberGuidedPanel('${s.id}','blocking',this.open)"><summary><div><span>BLOCKING</span><b>${active ? "Composition guide active" : rows.length ? `${rows.length} blocking frame${rows.length === 1 ? "" : "s"} available` : "Add a board or simple layout frame"}</b><small>Plan camera, spacing, scale, pose and depth without borrowing finished visual design.</small></div><span class="guided-mode-pill ${active ? "ready" : ""}">${active ? "GUIDE ACTIVE" : "PLANNING"}</span><i>⌄</i></summary><div class="guided-work-panel-body">${intake}${assisted}${active ? `<div class="blocking-guide-controls"><div><b>Active guide: ${esc(active.asset.title || active.asset.file)}</b><small>Geometry only: camera, crop, relative positions, scale, depth, pose and contact points. It does not define architecture, fence patterns, set layout, materials, lighting or style.</small></div><details class="guided-inline-defaults"><summary>Guide adherence: ${esc(c.blockingGuideAdherence || "strict")}</summary><label><span>Structure adherence</span><select onchange="setBlockingGuideAdherence('${s.id}',this.value)"><option value="strict" ${c.blockingGuideAdherence === "strict" ? "selected" : ""}>Strict structure</option><option value="balanced" ${c.blockingGuideAdherence === "balanced" ? "selected" : ""}>Balanced</option><option value="loose" ${c.blockingGuideAdherence === "loose" ? "selected" : ""}>Loose inspiration</option></select></label></details></div>` : ""}</div></details>`;
}

window.setBlockingField = (id, key, value) => {
  const s = shotById(id), c = ensureShotCreation(s);
  c[key] = value;
  keepGuidedPanelOpen(s, "blocking");
  dirty();
};
window.downloadBlockingPrompt = (id, buildId) => {
  const build = ensureShotCreation(shotById(id)).blockingBuilds.find((item) => item.id === buildId);
  if (build) downloadCreationText(`${id}_${String(build.profileId || "blocking").replace(/\//g,"-")}_blocking.txt`, build.prompt || "");
};
window.buildBlockingPrompt = async (id, improve = false) => {
  const s = shotById(id), c = ensureShotCreation(s), profileId = preferredCreationProfile("blocking", c.blockingProfileId);
  c.blockingProfileId = profileId;
  keepGuidedPanelOpen(s, "blocking");
  if (improve && !capabilityState("text").ready) return toast(capabilityState("text").message);
  const action = improve ? "improve" : "compile";
  setGuidedPromptOp("blocking", id, "", { status: "busy", action, startedAt: Date.now() });
  route();
  try {
    const data = await guidedPromptRequest("/api/prompt/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shotId: id, profileId, purpose: "blocking", references: [], useLLM: false, improveBlocking: improve, blockingLabels: c.blockingIncludeLabels, blockingEmphasis: c.blockingEmphasis, blockingFrameBrief: blockingFrameBrief(s), blockingDirection: blockingAdditionalDirection(s), composition: c.composition }),
    }, GUIDED_PROMPT_TIMEOUTS[improve ? "improve" : "compile"], improve ? "Blocking prompt improvement" : "Blocking prompt compilation");
    const build = {
      id: `blocking-${Date.now().toString(36)}`,
      packageId: `${id}-BLOCKING-R${String(c.blockingBuilds.length + 1).padStart(2,"0")}`,
      date: new Date().toISOString(),
      profileId,
      profileName: data.profile?.name || profileId,
      profileVersion: data.profile?.profileVersion || "",
      prompt: data.compiledPrompt,
      spec: data.spec,
      warnings: data.warnings || [],
      confirmations: data.confirmations || [],
      providerPayload: data.providerPayload || null,
      references: [],
      blockingPlan: data.blockingPlan || data.spec?.blockingPlan || null,
      blockingImprovementNotes: data.blockingImprovementNotes || [],
      llmUsed: !!data.llmUsed,
      inputBrief: blockingFrameBrief(s),
      additionalDirection: blockingAdditionalDirection(s),
      revisionRequest: c.blockingRevisionRequest || "",
      revisedFromAssetId: c.blockingRevisionSourceAssetId || "",
      kind: "blocking-frame",
      revision: c.blockingBuilds.length + 1,
    };
    c.blockingBuilds.push(build);
    setGuidedPromptOp("blocking", id, "", null);
    dirty();
    toast(improve ? "Blocking plan improved and compiled" : "Blocking prompt compiled");
    return build;
  } catch (error) {
    setGuidedPromptOp("blocking", id, "", { status: "error", action, error: error.message, failedAt: Date.now() });
    toast("Blocking prompt failed: " + error.message);
  } finally { route(); }
};

window.uploadBlockingFrames = async (id, fileList) => {
  const s = shotById(id), c = ensureShotCreation(s), files = [...(fileList || [])], latest = c.blockingBuilds.at(-1);
  let added = 0;
  const newAssetIds = [];
  const existingCount = blockingMediaRows(s).length;
  for (let i = 0; i < files.length; i++) {
    const file = files[i], ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : ".png", storedName = `${id}_BLOCKING_${Date.now().toString(36)}_${i + 1}${ext}`;
    try {
      const r = await fetch(`/api/shots/${encodeURIComponent(id)}/blocking?name=${encodeURIComponent(storedName)}`, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Upload failed");
      const link = newProjectMediaLink("shot", id, "blocking-frame", mediaLinksForTarget("shot", id).length + added);
      link.blockingState = "returned";
      link.blockingAdherence = c.blockingGuideAdherence;
      link.blockingVersion = `B${String(existingCount + i + 1).padStart(2, "0")}`;
      link.generationInput = false;
      const asset = {
        id: `blocking-media-${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`,
        file: data.name,
        storagePath: data.storagePath,
        originalName: file.name,
        title: blockingDefaultTitle(s, existingCount + i),
        kind: "image",
        notes: "Blocking frame — planning scaffold, not canon.",
        provenance: latest?.packageId || "",
        generationRecord: latest ? { model: latest.profileName || latest.profileId, profileId: latest.profileId, prompt: latest.prompt, settings: latest.providerPayload?.recommendedSettings || {}, date: new Date().toISOString(), packageId: latest.packageId } : { model: "Not recorded", prompt: "", settings: {}, date: new Date().toISOString() },
        createdAt: new Date().toISOString(),
        links: [link],
      };
      projectMediaAssets().push(asset);
      newAssetIds.push(asset.id);
      added++;
    } catch (error) { toast(`Could not upload ${file.name}: ${error.message}`); }
  }
  if (added) {
    SCAN = await fetch("/api/scan").then((response) => response.json());
    dirty(); route(); toast(`${added} blocking frame${added === 1 ? "" : "s"} stored`);
    setTimeout(() => openBlockingNamingModal(id, newAssetIds), 0);
  }
};
window.useFrameBlockingGuide = (id, frameId, assetId) => {
  const s = shotById(id), frames = guidedFrames(s), index = frames.findIndex((frame) => frame.id === frameId), frame = frames[index];
  const row = blockingMediaRows(s).find(({ asset }) => asset.id === assetId);
  if (!frame || !row) return toast("Frame blocking guide is unavailable");
  const state = guidedFrameState(s, frame, index);
  state.automationBlockingAssetId = assetId;
  for (const item of blockingMediaRows(s)) if (item.link.blockingFrameId === frameId) {
    item.link.blockingState = item.asset.id === assetId ? "frame-active" : "returned";
    item.link.generationInput = item.asset.id === assetId;
  }
  row.link.blockingFrameId = frameId;
  dirty(); route(); toast(`Frame ${frame.label} blocking guide selected`);
};
window.removeFrameBlockingGuide = (id, frameId, assetId) => {
  const s = shotById(id), frames = guidedFrames(s), index = frames.findIndex((frame) => frame.id === frameId), frame = frames[index];
  if (!frame) return;
  const state = guidedFrameState(s, frame, index);
  if (state.automationBlockingAssetId === assetId) state.automationBlockingAssetId = "";
  for (const item of blockingMediaRows(s)) if (item.asset.id === assetId) { item.link.blockingState = "returned"; item.link.generationInput = false; }
  dirty(); route(); toast(`Frame ${frame.label} blocking guide removed`);
};
window.useBlockingGuide = (id, assetId) => {
  const s = shotById(id), c = ensureShotCreation(s), rows = blockingMediaRows(s), selected = rows.find(({ asset }) => asset.id === assetId);
  if (!selected) return toast("Blocking frame is no longer available");
  for (const { asset, link } of rows) {
    const active = asset.id === assetId;
    link.blockingState = active ? "active" : "returned";
    link.generationInput = active;
    link.priority = active ? "primary" : "supporting";
    link.blockingAdherence = c.blockingGuideAdherence;
  }
  c.activeBlockingAssetId = assetId;
  c.composition.blockingGuideAdherence = c.blockingGuideAdherence;
  c.composition.baseFrame = c.composition.baseFrame && typeof c.composition.baseFrame === "object" ? c.composition.baseFrame : {};
  c.composition.baseFrame.source = `ref:media:${selected.asset.id}:${selected.link.id}`;
  dirty(); route(); toast("Blocking frame is now the composition guide for final still prompts");
};
window.removeBlockingGuide = (id, assetId) => {
  const s = shotById(id), c = ensureShotCreation(s);
  for (const { asset, link } of blockingMediaRows(s)) if (asset.id === assetId) { link.blockingState = "returned"; link.generationInput = false; }
  if (c.activeBlockingAssetId === assetId) c.activeBlockingAssetId = "";
  if (String(c.composition?.baseFrame?.source || "").includes(assetId)) c.composition.baseFrame.source = "auto";
  dirty(); route(); toast("Blocking guide removed; the planning image remains stored");
};
window.setBlockingGuideAdherence = (id, value) => {
  const s = shotById(id), c = ensureShotCreation(s);
  c.blockingGuideAdherence = ["strict","balanced","loose"].includes(value) ? value : "strict";
  c.composition.blockingGuideAdherence = c.blockingGuideAdherence;
  const active = activeBlockingRow(s);
  if (active) active.link.blockingAdherence = c.blockingGuideAdherence;
  dirty();
};

function shotInputEnabled(s, key) {
  return !ensureShotCreation(s).disabledInputKeys.includes(key);
}
window.toggleGuidedShotInput = (id, key) => {
  const s = shotById(id), c = ensureShotCreation(s);
  c.disabledInputKeys = c.disabledInputKeys.includes(key)
    ? c.disabledInputKeys.filter((item) => item !== key)
    : [...c.disabledInputKeys, key];
  dirty();
  route();
};
/* The kind name the canonical binding contract uses for each entity list. */
const CREATION_REFERENCE_KIND = { characters: "character", locations: "location", props: "prop", vehicles: "vehicle" };
/* The state this shot — or one named FRAME of it — declares for an entity, as a
   record on THAT entity. Resolved through resolveDeclaredStateId(), the P4-SEM-B
   canonical rule (frame, then shot, then the entity's default) and the same
   entry point the continuity manifest, the automation preflight and server.js's
   authority selection use. State ids are owner-scoped, so the record is looked
   up on this entity and nowhere else. With frameId "" the question is the
   shot's, which is exactly what every non-frame caller has always asked. */
function creationDeclaredState(s, entity, list, frameId = "") {
  if (!entity) return null;
  const stateId = resolveDeclaredStateId(s, frameId, CREATION_REFERENCE_KIND[list] || "", entity.id);
  return entityStateById(entity, stateId) || entityStateById(entity, "");
}
/* `frameId` is the narrow half of this repair. selectedEntityStateForShot()
   reads the SHOT map and has no frame parameter, so a frame that explicitly
   declared its own state still had its design-authority image chosen from the
   shot's — an explicitly frame-bound generation running against the wrong
   state. Frames pass their id; every other caller passes nothing and resolves
   exactly what it always did.

   `key` stays SHOT-scoped on purpose. It is this reference's stored identity —
   composition.referenceSets[].primaryKey, element.referenceKey and
   disabledInputKeys are all persisted against it — so making it vary per frame
   would quietly drop a director's composer selections on any frame that
   declares its own state. The key says WHICH reference slot; the file says
   which approved image currently answers for it. */
function creationEntityReference(list, entity, s, role, frameId = "") {
  if (!entity) return null;
  const state = creationDeclaredState(s, entity, list, frameId);
  const keyState = frameId ? creationDeclaredState(s, entity, list, "") : state;
  const file = entityApprovedFileForState(entity, state?.id || "");
  const pool = entityMedia(list, entity);
  let media = file ? pool.find((m) => m.name === file) : null;
  if (file && !media) {
    const bucket = { characters: "anchors", locations: "plates", props: "props", vehicles: "vehicles" }[list];
    media = (SCAN[bucket] || []).find((m) => m.name === file) || null;
  }
  return {
    key: `${list}:${entity.id}:${keyState?.id || "default"}`,
    entityId: entity.id,
    entityName: entity.name || entity.id,
    label: `${entity.name || entity.id}${state && !state.isDefault ? ` · ${state.name}` : ""}`,
    file,
    url: media?.url || "",
    role,
    approved: !!file,
    missing: !media,
    instruction:
      role === "base"
        ? "Use as the exact environment, framing starting point, and base plate."
        : role === "identity"
          ? "Use only for this character's approved identity, wardrobe, materials, and proportions; follow the shot brief for pose and placement."
          : "Use for this exact prop design, material, scale, and wear; place it only where the shot brief specifies.",
  };
}

function coverageSlotReferenceView(slot) {
  const map = {
    front: "front", "front-three-quarter": "front-three-quarter-left", profile: "left-profile", rear: "rear",
    hero: "front", "three-quarter": "front-three-quarter-left", side: "left-profile", top: "top", detail: "detail",
    "left-side": "left-profile", "right-side": "right-profile", "front-three-quarter": "front-three-quarter-left",
    "rear-three-quarter": "rear-three-quarter-left", interior: "interior", establishing: "front-three-quarter-left",
    reverse: "rear-three-quarter-left", "left-coverage": "left-profile", "right-coverage": "right-profile",
    "action-zone": "detail", "entrance-exit": "detail", "detail-zone": "detail", overhead: "top",
    "detail-face": "detail", expression: "detail"
  };
  return map[slot?.id] || "custom";
}
function desiredCoverageViewForShot(s, list = "", entity = null) {
  const c = ensureShotCreation(s);
  const cameraView = String(c.composition?.camera?.view || "").trim();
  const fullText = [c.camera, c.action, c.staging, s.positioning, s.desc, ...(guidedFrames(s) || []).map((frame) => frame?.description || frame?.title || "")].filter(Boolean).join(" ");
  const entityName = String(entity?.name || entity?.id || "").trim().toLowerCase();
  const specific = entityName ? fullText.split(/(?<=[.!?])\s+|\n+/).filter((part) => part.toLowerCase().includes(entityName)).join(" ") : "";
  const onlyCharacter = list === "characters" && (s.characters || []).length === 1;
  const contextualText = specific || (onlyCharacter ? fullText : "");
  const inferred = contextualText && typeof inferReferenceViewFromText === "function" ? inferReferenceViewFromText(contextualText, "") : "";
  // Older projects defaulted every shot to `front`, even when the written shot
  // explicitly staged the sole character from behind. Context wins over that legacy default.
  if (inferred) return inferred;
  if (cameraView && !["reference-view", "front"].includes(cameraView)) return cameraView;
  return "front-three-quarter-left";
}
function coverageSlotReferences(list, entity, s) {
  const slots = Array.isArray(entity?.coverageSlots) ? entity.coverageSlots : [];
  if (!slots.length) return [];
  const media = entityMedia(list, entity);
  const desiredView = desiredCoverageViewForShot(s, list, entity);
  const desiredRegion = [ensureShotCreation(s).action, ensureShotCreation(s).staging, s.positioning, s.desc].filter(Boolean).join(" ");
  const candidates = slots.filter((slot) => slotSelectedFile(slot) && slotSelectedFile(slot) !== entity.approvedFile).map((slot) => {
    const item = media.find((row) => row.name === slotSelectedFile(slot));
    if (!item) return null;
    const role = list === "characters" ? "identity" : list === "locations" ? "alternate-view" : "prop";
    const angleTag = coverageSlotReferenceView(slot);
    const referenceKind = /detail|expression|action-zone|detail-zone/i.test(slot.id) ? "detail" : "single-angle";
    const score = typeof referenceViewScore === "function" ? referenceViewScore(desiredView, angleTag, {
      referenceKind,
      desiredRegion,
      detailRegion: /face/.test(slot.id) ? "face" : /detail|action-zone|detail-zone/.test(slot.id) ? slot.label : "",
      priority: isRequiredCoverage(slot) ? "primary" : "supporting",
    }) : 0;
    return {
      key: `coverage:${list}:${entity.id}:${slot.id}`,
      entityId: entity.id,
      entityName: entity.name || entity.id,
      label: `${entity.name || entity.id} · ${slot.label}`,
      file: item.name,
      url: item.url,
      role,
      approved: true,
      missing: false,
      supplemental: true,
      coverageSlotId: slot.id,
      coverageSlotName: slot.label,
      angleTag,
      referenceKind,
      detailRegion: /face/.test(slot.id) ? "face" : /detail|action-zone|detail-zone/.test(slot.id) ? slot.label : "",
      availableAngles: slot.label,
      priority: isRequiredCoverage(slot) ? "primary" : "supporting",
      coverageScore: score,
      instruction: slot.notes || `Use this approved ${slot.label} coverage only when its angle or visible-side details match the requested shot. Preserve final pose and composition from the shot brief.`
    };
  }).filter(Boolean).sort((a,b)=>b.coverageScore-a.coverageScore);
  const chosen = candidates.slice(0, 1);
  const detailWanted = /close[- ]up|insert|detail|hands|face|connector|screen|panel|cockpit/i.test(desiredRegion);
  if (detailWanted) {
    const detail = candidates.find((ref) => ref.referenceKind === "detail" && !chosen.some((item) => item.key === ref.key));
    if (detail) chosen.push(detail);
  }
  return chosen;
}

/* `frameId` is optional and defaults to the shot's own declared states, so every
   display, picker and count surface reads exactly what it always did. Only the
   frame prompt package passes a frame, and only so an entity whose state that
   frame overrides is answered with THAT state's authority image. */
function shotCreationReferences(s, frameId = "") {
  const c = ensureShotCreation(s);
  const refs = [];
  const location = P.locations.find((x) => x.id === c.locationId);
  if (location) {
    refs.push(creationEntityReference("locations", location, s, "base", frameId));
    refs.push(...coverageSlotReferences("locations", location, s));
    refs.push(...assetSupplementalReferences("locations", location, s));
  }
  for (const id of s.characters || []) {
    const x = P.characters.find((e) => e.id === id);
    if (x) {
      refs.push(creationEntityReference("characters", x, s, "identity", frameId));
      refs.push(...coverageSlotReferences("characters", x, s));
      refs.push(...assetSupplementalReferences("characters", x, s));
    }
  }
  for (const id of c.propIds || []) {
    const prop = (P.props || []).find((e) => e.id === id);
    const vehicle = (P.vehicles || []).find((e) => e.id === id);
    if (prop) {
      refs.push(creationEntityReference("props", prop, s, "prop", frameId));
      refs.push(...coverageSlotReferences("props", prop, s));
      refs.push(...assetSupplementalReferences("props", prop, s));
    } else if (vehicle) {
      refs.push(creationEntityReference("vehicles", vehicle, s, "prop", frameId));
      refs.push(...coverageSlotReferences("vehicles", vehicle, s));
      refs.push(...assetSupplementalReferences("vehicles", vehicle, s));
    }
  }
  refs.push(...shotPlanningGenerationReferences(s, ["image"]));
  for (const ref of c.sceneAutomationReferences || []) if (ref?.url) refs.push(ref);
  const deduped = [];
  const seen = new Set();
  for (const ref of refs.filter(Boolean)) {
    if (seen.has(ref.key)) continue;
    seen.add(ref.key);
    deduped.push(ref);
  }
  return deduped;
}
/* THE SHOT'S CURRENT STILL, and whether anybody approved it.
 *
 * `source` used to read "Approved shot image" from a raw pointer, and the
 * composer put that string on a prompt reference. The image is unchanged — it is
 * what the shot is currently showing — but the word waits on the receipt, and
 * `isCanon` lets a caller refuse to treat it as a base. */
function guidedCurrentShotStill(s, takes = takesFor(s.id)) {
  normalizeShotV5(s);
  const openingFrame = (s.keyframes || [])[0];
  const openingIsCanon = !!openingFrame && typeof hasCurrentHumanAuthority === "function"
    && hasCurrentHumanAuthority(P, { kind: "shot-frame", shotId: s.id, frameId: openingFrame.id });
  const names = [s.winner, openingFrame?.winner].filter(Boolean);
  for (const name of [...new Set(names)]) {
    if (isVideo(name) || isAudio(name)) continue;
    const take = takes.find((item) => item.name === name);
    if (take)
      return {
        name: take.name,
        url: take.url,
        isCanon: openingIsCanon,
        source: openingIsCanon
          ? (s.winner === take.name ? "Approved shot image" : "Approved opening frame")
          : "Historic shot image — not approved",
      };
  }
  return null;
}
function guidedBaseReference(s) {
  return shotCreationReferences(s).find((ref) => ref.role === "base" && ref.url) || null;
}
function shotCreationPromptReferences(s, frameId = "") {
  const refs = shotCreationReferences(s, frameId).filter((ref) => shotInputEnabled(s, ref.key));
  const current = guidedCurrentShotStill(s);
  if (!current) return refs;
  const currentRef = {
    key: `shot-current:${s.id}:${current.name}`,
    entityId: s.id,
    label: "Current approved shot image",
    file: current.name,
    url: current.url,
    role: "base",
    mediaType: "image",
    approved: true,
    missing: false,
    instruction: "Use as the exact current shot image and edit only the requested still-image changes.",
  };
  const other = refs
    .filter((ref) => ref.url !== current.url)
    .map((ref) =>
      ref.role === "base"
        ? {
            ...ref,
            role: "location",
            instruction: "Use only for approved location geometry, materials, and environmental continuity; the current shot image remains the composition base.",
          }
        : ref,
    );
  return [currentRef, ...other];
}
function guidedReferenceRoleLabel(ref) {
  if (ref?.blocking) return "Blocking composition";
  return {
    base: "Composition base",
    location: "Location continuity",
    identity: "Character identity",
    expression: "Expression",
    body: "Body / anatomy",
    outfit: "Outfit / costume",
    pose: "Pose / performance",
    turnaround: "Turnaround",
    detail: "Design detail",
    prop: "Prop design",
    scale: "Scale / interaction",
    composition: "Animatic composition",
    reference: "Planning reference",
    "reference-sheet": "Reference sheet",
    "alternate-view": "Alternate view",
    lighting: "Lighting",
    "continuity-state": "Continuity state",
  }[ref.role] || ref.role || "Reference";
}
function guidedEntityPickerButton(list, x, s, selected) {
  const role = list === "characters" ? "identity" : "prop";
  const ref = creationEntityReference(list, x, s, role);
  return `<button class="guided-asset-choice ${selected ? "on" : ""} ${ref?.url ? "approved" : "missing"}" onclick="${list === "characters" ? `toggleShotCreationCharacter('${s.id}','${x.id}')` : `toggleShotCreationProp('${s.id}','${x.id}')`}">${ref?.url ? `<img src="${attr(ref.url)}" alt="" loading="lazy" decoding="async">` : `<span>${esc((x.name || x.id).slice(0, 1))}</span>`}<b>${esc(x.name || x.id)}</b><small>${ref?.url ? "approved" : ref?.approved ? "approved image missing" : "no approved image"}</small></button>`;
}
function guidedLocationPickerButton(x, s, status = "") {
  const ref = creationEntityReference("locations", x, s, "base");
  const primary = status === "primary";
  const supporting = status === "supporting";
  const statusText = primary
    ? "primary plate"
    : supporting
      ? "supporting location · select to make primary"
      : ref?.url
        ? "approved plate"
        : ref?.approved
          ? "approved plate missing"
          : "no approved plate";
  return `<button class="guided-asset-choice ${primary ? "on" : ""} ${supporting ? "supporting-location" : ""} ${ref?.url ? "approved" : "missing"}" onclick="setShotCreationLocation('${s.id}','${x.id}')">${ref?.url ? `<img src="${attr(ref.url)}" alt="" loading="lazy" decoding="async">` : `<span>${esc((x.name || x.id).slice(0, 1))}</span>`}<b>${esc(x.name || x.id)}</b><small>${esc(statusText)}</small></button>`;
}

function shotDependencyTypeLabel(type) {
  return {
    character: "Character",
    location: "Location plate",
    prop: "Prop",
    vehicle: "Vehicle",
    "prop-or-vehicle": "Prop or vehicle",
    audio: "Audio / voice",
  }[type] || String(type || "Reference").replace(/-/g, " ");
}
function shotDependencyCandidateRows(type) {
  if (type === "character") return (P.characters || []).map((entity) => ({ type: "character", entity }));
  if (type === "location") return (P.locations || []).map((entity) => ({ type: "location", entity }));
  if (type === "audio") return (P.audio || []).map((entity) => ({ type: "audio", entity }));
  if (type === "vehicle") return (P.vehicles || []).map((entity) => ({ type: "vehicle", entity }));
  if (type === "prop") return (P.props || []).map((entity) => ({ type: "prop", entity }));
  if (type === "prop-or-vehicle") return [
    ...(P.props || []).map((entity) => ({ type: "prop", entity })),
    ...(P.vehicles || []).map((entity) => ({ type: "vehicle", entity })),
  ];
  return [];
}
function replaceShotDependencyToken(value, rawId, nextId) {
  const token = String(value || "");
  const raw = String(rawId || "");
  if (!raw || token === raw) return nextId || "";
  if (token.startsWith(raw + "-") || token.startsWith(raw + "_")) return nextId ? nextId + token.slice(raw.length) : "";
  return token;
}
function updateShotDependencyRelationship(shot, rawId, nextId = "") {
  const replaceArray = (rows) => [...new Set((Array.isArray(rows) ? rows : []).map((value) => replaceShotDependencyToken(value, rawId, nextId)).filter(Boolean))];
  shot.characters = replaceArray(shot.characters);
  shot.codes = replaceArray(shot.codes);
  const creation = ensureShotCreation(shot);
  if (String(creation.locationId || "") === String(rawId)) creation.locationId = nextId;
  creation.propIds = replaceArray(creation.propIds);
  creation.vehicleIds = replaceArray(creation.vehicleIds);
  const replaceField = (object, key) => {
    if (object && String(object[key] || "") === String(rawId)) object[key] = nextId;
  };
  replaceField(shot.audio, "speakerId");
  replaceField(shot.audio, "voiceEntityId");
  replaceField(creation.motionPlan?.audio, "speakerId");
  replaceField(creation.motionPlan?.audio, "voiceEntityId");
  for (const clip of shot.clips || []) {
    replaceField(clip, "speakerId");
    replaceField(clip, "voiceEntityId");
  }
  if (shot.continuityStateSelections && Object.prototype.hasOwnProperty.call(shot.continuityStateSelections, rawId)) {
    const stateId = shot.continuityStateSelections[rawId];
    delete shot.continuityStateSelections[rawId];
    if (nextId) shot.continuityStateSelections[nextId] = stateId;
  }
  for (const workflow of Object.values(creation.frameWorkflows || {})) {
    for (const key of ["characterStateSelections", "locationStateSelections", "propStateSelections", "vehicleStateSelections"]) {
      if (!workflow?.[key] || !Object.prototype.hasOwnProperty.call(workflow[key], rawId)) continue;
      const stateId = workflow[key][rawId];
      delete workflow[key][rawId];
      if (nextId) workflow[key][nextId] = stateId;
    }
  }
  /* Declared continuity intent is keyed by entity id like every other relation
     above, so it has to move with the entity. Left out, a rename would orphan
     the record that says a change was planned, and the next continuity run
     would report an intended change as a break. */
  if (shot.continuityIntent && Object.prototype.hasOwnProperty.call(shot.continuityIntent, rawId)) {
    const intent = shot.continuityIntent[rawId];
    delete shot.continuityIntent[rawId];
    if (nextId) shot.continuityIntent[nextId] = intent;
  }
}
window.updateShotDependencyRelationship = updateShotDependencyRelationship;
window.removeShotDependency = (shotId, rawId) => {
  const shot = shotById(shotId);
  if (!shot) return;
  confirmModal(`Remove the unresolved reference ${rawId} from this shot?`, () => {
    updateShotDependencyRelationship(shot, rawId, "");
    dirty();
    route();
    toast("Unresolved reference removed");
  }, { title: "Remove unresolved reference", confirmLabel: "REMOVE" });
};
window.openShotDependencyRelink = (shotId, type, rawId) => {
  const rows = shotDependencyCandidateRows(type);
  if (!rows.length) {
    const target = type === "prop-or-vehicle" ? "prop or vehicle" : shotDependencyTypeLabel(type).toLowerCase();
    return openModal(`<div class="dependency-relink-modal"><h3>Relink ${esc(rawId)}</h3><p>No ${esc(target)} records are available. Create the replacement in References, then return to this shot.</p><div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button><a class="add-btn" href="#/library/${type === "prop-or-vehicle" ? "props" : type === "character" ? "characters" : type === "location" ? "locations" : type === "audio" ? "audio" : type + "s"}" onclick="closeModal()">Open References</a></div></div>`);
  }
  const options = rows.map(({ type: candidateType, entity }) => `<option value="${attr(entity.id)}">${esc(entity.name || entity.id)} · ${esc(entity.id)}${type === "prop-or-vehicle" ? ` · ${esc(shotDependencyTypeLabel(candidateType))}` : ""}</option>`).join("");
  openModal(`<div class="dependency-relink-modal"><h3>Relink ${esc(rawId)}</h3><p>Choose the ${esc(shotDependencyTypeLabel(type).toLowerCase())} that this stale ID should point to. CineBraid updates every matching relationship in this shot.</p><label class="field"><span>Replacement</span><select id="shot-dependency-replacement" aria-label="Replacement for ${attr(rawId)}">${options}</select></label><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="approve-btn" onclick="confirmShotDependencyRelink('${attr(shotId)}','${attr(rawId)}')">Relink</button></div></div>`);
};
window.confirmShotDependencyRelink = (shotId, rawId) => {
  const shot = shotById(shotId), nextId = document.getElementById("shot-dependency-replacement")?.value || "";
  if (!shot || !nextId) return;
  updateShotDependencyRelationship(shot, rawId, nextId);
  closeModal();
  dirty();
  route();
  toast(`Relinked ${rawId} to ${nextId}`);
};
function guidedUnresolvedDependenciesMarkup(s) {
  const unresolved = typeof unresolvedShotDependencies === "function" ? unresolvedShotDependencies(P, s) : [];
  if (!unresolved.length) return "";
  return `<section class="guided-unresolved-dependencies" aria-label="Unresolved shot references"><header><div><span>BLOCKING REFERENCE ISSUES</span><b>${unresolved.length} unresolved relationship${unresolved.length === 1 ? "" : "s"}</b><small>These IDs are still stored in the shot. Relink or remove them before building production prompts.</small></div></header><div>${unresolved.map((row) => `<article data-unresolved-dependency="${attr(row.id)}"><div><span>${esc(shotDependencyTypeLabel(row.type))}</span><b>${esc(row.id)}</b><small>${esc(row.sources.join(" · "))}</small></div><div class="guided-unresolved-actions"><button class="ghost-btn" onclick="openShotDependencyRelink('${attr(s.id)}','${attr(row.type)}','${attr(row.id)}')">Relink</button><button class="chip danger" onclick="removeShotDependency('${attr(s.id)}','${attr(row.id)}')">Remove</button></div></article>`).join("")}</div></section>`;
}

function guidedShotAttachmentPicker(s) {
  const c = ensureShotCreation(s);
  const resolved = resolveShotEntities(P, s);
  const attachedLocationIds = new Set(resolved.locations.map((x) => x.id));
  const characterIds = new Set(s.characters || []);
  const propIds = new Set(c.propIds || []);
  const selectedCount = characterIds.size + propIds.size + attachedLocationIds.size;
  const locationNote = attachedLocationIds.size > 1
    ? `<small class="guided-location-disclosure">${attachedLocationIds.size} locations are attached. The primary plate drives the composer base; supporting locations remain available to prompting.</small>`
    : "";
  return `<details class="guided-source-manager guided-cast-assets" ${selectedCount ? "" : "open"}><summary>Cast and assets attached to this shot <span>${selectedCount}</span></summary><div class="guided-asset-picker-section"><b>LOCATION PLATE</b>${locationNote}<div class="guided-asset-picker-grid">${(P.locations || []).map((x) => guidedLocationPickerButton(x, s, c.locationId === x.id ? "primary" : attachedLocationIds.has(x.id) ? "supporting" : "")).join("") || `<div class="guided-empty-inline"><b>No location records yet.</b><span>Add a location in References first.</span></div>`}</div></div><div class="guided-asset-picker-section"><b>CHARACTERS</b><div class="guided-asset-picker-grid">${(P.characters || []).map((x) => guidedEntityPickerButton("characters", x, s, characterIds.has(x.id))).join("") || `<div class="guided-empty-inline"><b>No character records yet.</b><span>Add a character in References first.</span></div>`}</div></div><div class="guided-asset-picker-section"><b>PROPS & VEHICLES</b><div class="guided-asset-picker-grid">${[...(P.props || []).map((x) => guidedEntityPickerButton("props", x, s, propIds.has(x.id))), ...(P.vehicles || []).map((x) => guidedEntityPickerButton("vehicles", x, s, propIds.has(x.id)))].join("") || `<div class="guided-empty-inline"><b>No prop or vehicle records yet.</b><span>Add one in References first.</span></div>`}</div></div></details>`;
}

function guidedPromptModeLabel(mode) {
  return {
    t2i: "Create a new still",
    edit: "Edit the approved shot or plate",
    "multi-reference": "Compose approved references",
  }[mode] || "Create shot image";
}
function guidedApprovedMotion(s, takes = takesFor(s.id)) {
  const c = ensureShotCreation(s);
  const names = [c.finalVideoFile, c.approvedMotionFile, ...(s.clips || []).map((clip) => clip.videoWinner)].filter(Boolean);
  for (const name of [...new Set(names)]) {
    const take = takes.find((item) => item.name === name && isVideo(item.name));
    if (take) return { ...take, final: c.finalVideoFile === name };
  }
  return null;
}
function guidedShotLifecycle(s, takes = takesFor(s.id)) {
  const c = ensureShotCreation(s);
  const current = guidedCurrentShotStill(s, takes);
  const motion = guidedApprovedMotion(s, takes);
  const images = takes.filter((take) => !isVideo(take.name) && !isAudio(take.name));
  const videos = takes.filter((take) => isVideo(take.name));
  const finalStill = c.finalStillFile && images.find((take) => take.name === c.finalStillFile);
  const finalVideo = c.finalVideoFile && videos.find((take) => take.name === c.finalVideoFile);
  const motionPlanned = !!String(c.motionDirection || s.motionPrompt || "").trim() || (s.clips || []).length > 0;
  const intent = c.deliveryIntent === "auto" ? (motionPlanned ? "motion" : "undecided") : c.deliveryIntent;
  if (finalVideo || finalStill) return { key: "final", label: "Final", title: "Shot delivered", note: finalVideo ? "The final video is locked for delivery." : "The final still is locked for delivery.", panel: "finish", current, motion, finalStill, finalVideo, intent, images, videos };
  if (motion) return { key: "motion-approved", label: "Motion approved", title: "Finish the approved video", note: "The motion take is approved. Upscale, clean up, or mark it final.", panel: "finish", current, motion, intent, images, videos };
  if (videos.length) return { key: "review-motion", label: "Video returned", title: "Review the returned video", note: "Choose the motion take to approve, or upload another version.", panel: "motion", current, motion, intent, images, videos };
  if (current && intent === "motion") return { key: "animate", label: "Still approved", title: "Animate the approved still", note: "The opening image is ready. Add movement and audio only if this shot needs video.", panel: "motion", current, motion, intent, images, videos };
  if (current) return { key: "still-ready", label: "Still approved", title: "Choose what happens next", note: "Keep this as a finished still, animate it, or reopen the image tools for a revision.", panel: "finish", current, motion, intent, images, videos };
  if (images.length) return { key: "review-still", label: "Image returned", title: "Review the returned still", note: "Choose the image that should become the approved shot still.", panel: "review", current, motion, intent, images, videos };
  return { key: "needs-image", label: "Needs image", title: "Add or create the shot image", note: "Upload a still made elsewhere, use an approved plate, or open the image builder.", panel: "still", current, motion, intent, images, videos };
}
function guidedPanelOpen(s, key, fallback = false) {
  const c = ensureShotCreation(s);
  return Object.prototype.hasOwnProperty.call(c.openPanels, key) ? !!c.openPanels[key] : fallback;
}
function keepGuidedPanelOpen(s, panel, subpanel = "") {
  const c = ensureShotCreation(s);
  c.openPanels[panel] = true;
  if (subpanel) c.openPanels[subpanel] = true;
  return c;
}
window.rememberGuidedPanel = (id, key, open) => {
  if (typeof ROUTE_RENDER_IN_PROGRESS !== "undefined" && ROUTE_RENDER_IN_PROGRESS) return;
  const s = shotById(id), c = ensureShotCreation(s);
  c.openPanels[key] = !!open;
  dirty();
};
async function focusGuidedWorkspaceTarget(selector, attempts = 12) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const target = document.querySelector(selector);
    if (target) {
      if (target.tagName === "DETAILS") target.open = true;
      target.classList.add("guided-scroll-focus");
      target.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus?.({ preventScroll: true });
      setTimeout(() => target.classList.remove("guided-scroll-focus"), 1400);
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}
/* WHICH SHOT STAGE A PANEL LIVES IN.
 *
 * The bounded shot workspace renders exactly ONE stage, chosen by
 * boundedShotSelectedTask(). A cross-panel action therefore has to change that
 * selection: writing the legacy `openPanels` map alone left the target panel out of
 * the DOM entirely, and the scroll poll below then reported "Could not find the
 * motion workspace" for a panel nothing had asked the workspace to build.
 *
 * The translation used to be a local literal here, one of five separate statements
 * of the same five stages inside this file. It is now a question asked of the
 * declared stage model, which owns the panel list per stage — so a panel moved to a
 * different stage moves in exactly one place. */
function guidedPanelTaskId(key) {
  return shotStageForPanel(key)?.id || "";
}
/* Selects the bounded focused task a panel lives in, through the canonical
   task-selection state rather than a second copy of it. Returns the task id it
   selected so a caller can check the outcome from state instead of from the DOM. */
function selectGuidedPanelTask(s, key) {
  const taskId = guidedPanelTaskId(key);
  if (!s || !taskId || typeof boundedWriteFocusedTask !== "function") return "";
  boundedWriteFocusedTask(SHOT_STAGE_SCOPE, s.id, taskId);
  const view = shotStagePanelView(key);
  if (view) boundedWriteState("selected:shot-look-view", s.id, view);
  return taskId;
}
window.openGuidedPanel = async (id, key) => {
  const s = shotById(id), c = ensureShotCreation(s);
  const task = selectGuidedPanelTask(s, key);
  if (["still", "review", "frames"].includes(key)) {
    const first = guidedFrames(s)[0];
    await Promise.resolve(route());
    await focusGuidedWorkspaceTarget(`[data-frame-id="${first.id}"]`);
    return;
  }
  c.openPanels[key] = true;
  dirty();
  await Promise.resolve(route());
  /* The semantic answer is "is the workspace showing the task this panel lives in",
     read from the task state. The poll below only scrolls to it; a slow paint is not
     evidence that a workspace is missing, and treating it as such is what produced a
     refusal for a panel that had simply never been selected. */
  if (task && boundedShotSelectedTask(s, takesFor(s.id)) !== task)
    return toast(`Could not open the ${key} workspace.`);
  await focusGuidedWorkspaceTarget(`[data-guided-panel="${key}"]`);
};
window.scrollGuidedFrame = (id, frameId = "") => {
  const s = shotById(id), frame = guidedFrames(s).find((item) => item.id === frameId) || guidedFrames(s)[0];
  document.querySelector(`[data-frame-id="${frame.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
};
window.clickGuidedUpload = (id, kind) => {
  const s = shotById(id), c = ensureShotCreation(s);
  if (kind === "video") {
    /* The video file input only exists inside the motion task, so importing an
       existing video from anywhere else has to select that task first. */
    selectGuidedPanelTask(s, "motion");
    c.openPanels.motion = true;
    dirty();
    route();
    setTimeout(() => document.getElementById("motion-file")?.click(), 30);
    return;
  }
  const first = guidedFrames(s)[0];
  setTimeout(() => document.getElementById(`frame-file-${first.id}`)?.click(), 20);
};
window.openRenameShotModal = (id) => {
  const shot = shotById(id);
  if (!shot) return;
  openModal(`<div class="automation-plan-modal compact"><h3>Rename shot</h3><div class="modal-sub">${esc(shot.id)} · ADMINISTRATIVE ACTION</div><label><span>Shot title</span><input id="rename-shot-title" value="${attr(shot.title || "")}" onkeydown="if(event.key==='Enter'){event.preventDefault();confirmRenameShot('${attr(id)}')}"></label><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="approve-btn" onclick="confirmRenameShot('${attr(id)}')">Save title</button></div></div>`);
  setTimeout(() => document.getElementById("rename-shot-title")?.focus(), 30);
};
window.confirmRenameShot = (id) => {
  const shot = shotById(id), input = document.getElementById("rename-shot-title");
  if (!shot || !input) return;
  const title = String(input.value || "").trim();
  if (!title) return toast("Shot title cannot be empty");
  shot.title = title;
  dirty(); closeModal(); route(); toast("Shot renamed");
};
window.setGuidedDeliveryIntent = (id, value) => {
  const s = shotById(id), c = ensureShotCreation(s);
  c.deliveryIntent = value;
  if (value === "motion") c.openPanels.motion = true;
  if (value === "still") c.openPanels.finish = true;
  dirty();
  route();
};
function guidedShotStatusCard(s, takes, neighbors) {
  const life = guidedShotLifecycle(s, takes);
  const preview = life.finalVideo || life.motion || life.finalStill || life.current || life.videos.at(-1) || life.images.at(-1);
  const previewTitle = preview?.name || `Shot ${s.id} preview`;
  const previewUrl = preview?.url || "";
  /* O5: the shot's current result — the approved motion, the final still, or the
     newest take. "What created this and is it approved" is the whole reason a
     filmmaker clicks it, so it inspects rather than merely enlarging. */
  const previewAction = preview ? `inspectMediaFile('${attr(encodeURIComponent(previewUrl))}','${attr(preview.assetId || "")}','${attr(encodeURIComponent(previewTitle))}','${isVideo(previewTitle) ? "video" : "image"}')` : "";
  const media = preview
    ? isVideo(preview.name)
      ? `<div class="guided-lifecycle-media"><video controls muted preload="metadata" src="${attr(preview.url)}#t=0.1"></video><button class="media-enlarge-btn" onclick="${previewAction}">Larger preview</button></div>`
      : `<button class="guided-lifecycle-media image" onclick="${previewAction}" aria-label="View ${attr(previewTitle)} larger"><img src="${attr(preview.url)}" alt=""><span>View larger</span></button>`
    : `<div class="guided-lifecycle-empty"><span>NO SHOT MEDIA</span></div>`;
  const ready = ["still-ready", "animate", "motion-approved", "final"].includes(life.key);
  const kicker = life.key === "final" ? "✓ SHOT COMPLETE" : ready ? "✓ PREVIOUS STEP COMPLETE · NEXT ACTION" : "NEXT ACTION";
  let action = `<button class="assemble-btn shot-primary-action" onclick="scrollGuidedFrame('${s.id}')">Add shot image</button>`;
  if (life.key === "review-still") action = `<button class="assemble-btn shot-primary-action" onclick="scrollGuidedFrame('${s.id}')">Choose frame</button>`;
  else if (life.key === "still-ready" || life.key === "animate") action = `<button class="assemble-btn shot-primary-action" onclick="openGuidedPanel('${s.id}','motion')">Add motion</button>`;
  else if (life.key === "review-motion") action = `<button class="assemble-btn shot-primary-action" onclick="openGuidedPanel('${s.id}','motion')">Choose video</button>`;
  else if (["motion-approved","final"].includes(life.key)) action = `<button class="assemble-btn shot-primary-action" onclick="openGuidedPanel('${s.id}','finish')">${life.key === "final" ? "View final" : "Finish shot"}</button>`;
  return `<section class="guided-next-action state-${life.key} ${ready ? "is-ready" : ""}" style="${attr(shotCanvasStyle(s))}"><div class="guided-lifecycle-preview">${media}</div><div><span>${kicker}</span><h2>${esc(life.title)}</h2><p>${esc(life.note)}</p><div class="guided-next-actions">${action}</div></div><nav>${neighbors.prev ? `<a href="#/shot/${neighbors.prev.id}">← Previous</a>` : ""}${neighbors.next ? `<a href="#/shot/${neighbors.next.id}">Next →</a>` : ""}</nav></section>`;
}
function guidedInputThumb(ref) {
  if (!ref.url) return `<span class="guided-input-placeholder">${esc((ref.role || "?").slice(0, 1).toUpperCase())}</span>`;
  if (ref.mediaType === "audio" || isAudio(ref.file || "")) return `<span class="guided-input-placeholder audio">AUDIO</span>`;
  const title = ref.label || ref.file || ref.name || "Reference preview";
  const video = ref.mediaType === "video" || isVideo(ref.file || "");
  return `<button type="button" class="guided-thumb-preview" onclick="openMediaTheatre('${attr(encodeURIComponent(ref.url))}','${attr(encodeURIComponent(title))}','${video ? "video" : "image"}')" aria-label="View ${attr(title)} larger">${video ? `<video muted preload="metadata" src="${attr(ref.url)}#t=0.1"></video>` : `<img src="${attr(ref.url)}" alt="">`}<span>View larger</span></button>`;
}
function composerAspectStyle(value) {
  /* Delegates to the one aspect model rather than parsing a ratio string again here. */
  return (resolveAspect(value) || resolveAspect(CINEBRAID_ASPECT_FALLBACK)).css;
}
function compositionReferenceByKey(s, key) {
  return shotCreationReferences(s).find((ref) => ref.key === key) || null;
}
function compositionElementLabel(s, element) {
  return compositionReferenceByKey(s, element.referenceKey)?.label || element.label || "Shot element";
}
function compositionElementInstruction(s, element) {
  const label = compositionElementLabel(s, element);
  const horizontal = element.x < 0.34 ? "camera-left" : element.x > 0.66 ? "camera-right" : "center frame";
  const vertical = element.y < 0.35 ? "upper frame" : element.y > 0.68 ? "lower frame" : "mid-height";
  return `${label}: place in the ${element.depth || "midground"}, ${horizontal}, ${vertical}; occupy roughly ${Math.round((element.w || 0.25) * 100)}% of frame width and ${Math.round((element.h || 0.25) * 100)}% of frame height; face ${String(element.facing || "camera").replace(/-/g, " ")}; show ${String(element.view || "reference-view").replace(/-/g, " ")}${element.crop && element.crop !== "none" ? `; crop ${element.crop.replace(/-/g, " ")}` : ""}${element.notes ? `; ${element.notes}` : ""}.`;
}
function compositionSummary(s) {
  const c = ensureShotCreation(s), plan = c.composition, camera = plan.camera || {};
  const pieces = [
    `Frame setup: ${camera.shotSize?.replace(/-/g," ") || "wide"}, ${camera.height?.replace(/-/g," ") || "eye level"}, ${camera.angle?.replace(/-/g," ") || "level"}, ${camera.lens?.replace(/-/g," ") || "normal lens"}, ${camera.view?.replace(/-/g," ") || "front view"}, ${camera.layout?.replace(/-/g," ") || "rule of thirds"}, ${camera.crop?.replace(/-/g," ") || "full scene"}.`,
    camera.reframe === "preserve-exact" ? "Preserve the source framing exactly." : camera.reframe === "reinterpret" ? "The source framing may be reinterpreted to satisfy this composition." : "Preserve the source framing loosely while matching this composition.",
    ...(plan.elements || []).map((element) => compositionElementInstruction(s, element)),
    plan.mustInclude ? `Must include: ${plan.mustInclude}.` : "",
    plan.mustAvoid ? `Must avoid: ${plan.mustAvoid}.` : "",
  ];
  return pieces.filter(Boolean).join("\n");
}
function compositionAugmentedReferences(s, refs) {
  return (refs || []).map((ref) => ({ ...ref }));
}
function composerOptions(values, selected) {
  return values.map(([value,label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
}
function guidedShotComposerPanel(s, open = false) {
  const c = ensureShotCreation(s), plan = c.composition;
  const usable = shotCreationReferences(s).filter((ref) => ref.url && shotInputEnabled(s, ref.key));
  return `<details class="guided-work-panel shot-composer-card" data-guided-panel="composer" ${guidedPanelOpen(s, "composer", open) ? "open" : ""} ontoggle="rememberGuidedPanel('${s.id}','composer',this.open)"><summary><div><span>FINAL REFERENCES · REVIEW</span><b>${usable.length ? `${usable.length} enabled reference${usable.length === 1 ? "" : "s"}` : "Choose production references"}</b><small>Approved references control appearance. Stored legacy composition data remains available to prompt compilation but is no longer edited here.</small></div><i>⌄</i></summary><div class="guided-work-panel-body shot-composer-body"><div class="guided-next-note"><b>Reference review is running in compatibility mode.</b> Manage enabled images in Source & References. Reload normally to restore guided reference assignment.</div><div class="composer-constraints"><label><span>Must include</span><input value="${attr(plan.mustInclude || "")}" onchange="setComposerConstraint('${s.id}','mustInclude',this.value)" placeholder="Required relationships, signs, contact points…"></label><label><span>Must avoid</span><input value="${attr(plan.mustAvoid || "")}" onchange="setComposerConstraint('${s.id}','mustAvoid',this.value)" placeholder="Wrong angle, duplicate prop, blocked face…"></label></div></div></details>`;
}
function guidedSourceInputsPanel(s, current, open = false) {
  const imageRefs = shotCreationReferences(s);
  const motionRefs = shotPlanningGenerationReferences(s, ["video", "audio"]);
  const planningCount = shotMediaLinks(s).length;
  const rows = [...imageRefs, ...motionRefs];
  const ready = rows.filter((row) => row.url).length;
  return `<details class="guided-work-panel guided-inputs-card" data-guided-panel="inputs" ${guidedPanelOpen(s, "inputs", open) ? "open" : ""} ontoggle="rememberGuidedPanel('${s.id}','inputs',this.open)"><summary><div><span>SOURCE & REFERENCES</span><b>${ready ? `${ready} usable input${ready === 1 ? "" : "s"}` : "Attach cast, assets, or source media"}</b><small>Choose the shot's location, cast, props, plates, audio, and motion references.</small></div><i>⌄</i></summary><div class="guided-work-panel-body">${guidedUnresolvedDependenciesMarkup(s)}${guidedShotAttachmentPicker(s)}<div class="guided-input-tray">${rows.length ? rows.map((ref) => {
    const enabled = shotInputEnabled(s, ref.key);
    const route = ref.role === "identity" ? "character" : ref.role === "prop" ? "prop" : ["base","location"].includes(ref.role) ? "location" : "";
    const blocked = !ref.url;
    const status = ref.url ? (ref.file || "ready") : ref.approved ? "approved file missing from local folder" : "approval needed";
    return `<article class="${enabled ? "enabled" : "disabled-input"} ${blocked ? "blocked-input" : ""}"><div class="guided-input-thumb">${guidedInputThumb(ref)}</div><div><b>${esc(ref.label || "Input")}</b><small>${esc(guidedReferenceRoleLabel(ref))} · ${esc(status)}</small></div>${blocked && route && ref.entityId ? `<a class="chip" href="#/${route}/${attr(ref.entityId)}">OPEN</a>` : `<button class="guided-input-toggle ${enabled ? "on" : ""}" onclick="toggleGuidedShotInput('${s.id}','${attr(ref.key)}')">${enabled ? "Use" : "Add"}</button>`}</article>`;
  }).join("") : `<div class="guided-empty-inline"><b>No cast, assets, or source media are attached.</b><span>Choose the shot location, characters, and props above, or add supplemental media below.</span></div>`}</div><details class="guided-source-manager" ${!rows.length ? "open" : ""}><summary>Add supplemental source media <span>${planningCount}</span></summary>${shotMediaPanel(s)}</details></div></details>`;
}


function guidedProductionRisksMarkup(risks) {
  const items = [...new Set((Array.isArray(risks) ? risks : []).map((risk) => String(risk || "").trim()).filter(Boolean))];
  if (!items.length) return "";
  return `<details class="guided-review-checks guided-production-risks"><summary><b>${items.length} review check${items.length === 1 ? "" : "s"}</b><span>Open before approval</span></summary><ul>${items.map((risk) => `<li>${esc(risk)}</li>`).join("")}</ul></details>`;
}
function concisePromptWarning(value) {
  const warning = String(value || "").trim();
  if (!warning) return "";
  if (/Assistant motion rewrite unavailable/i.test(warning)) return "Assistant improvement was unavailable; CineBraid used the deterministic structured motion plan instead.";
  if (/Local planning model unavailable/i.test(warning)) return "Assistant planning was unavailable; CineBraid used deterministic project data instead.";
  return warning;
}
function guidedPromptWarningsMarkup(warnings) {
  const items = [...new Set((Array.isArray(warnings) ? warnings : []).map(concisePromptWarning).filter(Boolean))];
  if (!items.length) return "";
  return `<details class="guided-prompt-notes"><summary><b>${items.length} prompt note${items.length === 1 ? "" : "s"}</b><span>Details</span></summary><ul>${items.map((warning) => `<li>${esc(warning)}</li>`).join("")}</ul></details>`;
}
function guidedFramePromptResult(s, frame, build) {
  return `<article class="guided-prompt-result guided-frame-prompt-result"><header><div><span>FRAME ${esc(frame.label)} PROMPT READY</span><b>${esc(build.profileName || build.profileId)}</b><small>${esc(guidedPromptModeLabel(build.mode))}${build.references?.length ? ` · ${build.references.length} input${build.references.length === 1 ? "" : "s"}` : ""}${build.packageId ? ` · ${esc(build.packageId)}` : ""}</small></div><div><button class="copy-btn" onclick="copyText(${JSON.stringify(build.prompt || "").replace(/"/g, "&quot;")})">COPY</button>${typeof falPromptAction === "function" ? falPromptAction(s.id,"frame",frame.id,build.id,`<button class="chip" onclick="downloadGuidedFramePrompt('${s.id}','${frame.id}','${build.id}')">Download</button>`) : `<button class="chip" onclick="downloadGuidedFramePrompt('${s.id}','${frame.id}','${build.id}')">Download</button>`}</div></header>${guidedPromptWarningsMarkup(build.warnings)}${guidedProductionRisksMarkup(build.productionRisks)}<details><summary>View full model prompt</summary><pre>${esc(build.prompt || "")}</pre>${typeof falGenerationReady === "function" && falGenerationReady() ? `<button class="text-link-btn" onclick="downloadGuidedFramePrompt('${s.id}','${frame.id}','${build.id}')">Download prompt file</button>` : ""}</details>${promptOriginDetails(build)}${typeof falGenerationInline === "function" ? falGenerationInline(s.id,"frame",frame.id) : ""}</article>`;
}
function guidedFrameCandidateCard(s, frame, take, approved, selectedName) {
  const row = candidateRecord(s, take.name);
  const current = approved?.name === take.name;
  const selected = selectedName === take.name;
  const ai = row.aiReview;
  return `<article role="option" style="${attr(shotWellStyle(s))}" aria-selected="${selected ? "true" : "false"}" tabindex="${selected ? "0" : "-1"}" class="guided-frame-candidate ${current ? "approved" : ""} ${selected ? "selected" : ""}" onclick="selectGuidedFrameCandidate('${s.id}','${frame.id}','${attr(take.name)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectGuidedFrameCandidate('${s.id}','${frame.id}','${attr(take.name)}')}"><div class="guided-candidate-preview"><img src="${attr(take.url)}" alt="Frame ${esc(frame.label)} candidate">${ai ? `<span class="guided-ai-score ${ai.pass ? "pass" : "flag"}">AI ${Math.round(+ai.score || 0)}</span>` : ""}</div><div><b>${esc(take.name)}</b><small>${current ? `Approved Frame ${esc(frame.label)}` : row.sourcePackageId ? `From ${esc(row.sourcePackageLabel || row.sourcePackageId)}` : selected ? "Selected candidate" : "Returned image"}</small>${typeof candidateReviewBadge === "function" ? candidateReviewBadge(row) : ""}${ai?.notes ? `<p class="guided-ai-note">${esc(ai.notes)}</p>` : ""}</div><div class="guided-candidate-actions">${current ? `<span>✓ APPROVED</span>` : ""}${selected ? `<span>SELECTED</span>` : ""}<a class="chip" href="#" onclick="event.preventDefault();event.stopPropagation();openCandidateReview('${s.id}','${frame.id}','${attr(take.name)}')">Review candidate</a><button type="button" class="chip candidate-enlarge" onclick="event.preventDefault();event.stopPropagation();openMediaTheatre('${attr(encodeURIComponent(take.url))}','${attr(encodeURIComponent(`Frame ${frame.label} candidate · ${take.name}`))}','image')" aria-label="View the ${attr(take.name)} candidate larger">View larger</button></div></article>`;
}
function guidedFrameCandidatesPanel(s, frame, index, takes, step) {
  const promptReady = !!step.latest;
  const state = guidedFrameState(s, frame, index);
  const candidateNames = step.candidates.map((take) => take.name);
  if (!candidateNames.includes(state.selectedCandidate)) state.selectedCandidate = step.approved?.name || candidateNames[0] || "";
  const changingWinner = !!(step.approved && state.selectedCandidate && state.selectedCandidate !== step.approved.name);
  const message = changingWinner
    ? `A different Frame ${frame.label} candidate is selected. Approving it will replace the current winner and reopen downstream motion.`
    : step.approved
      ? `Frame ${frame.label} is approved. Select another candidate to replace it, or reset the winner.`
      : step.candidates.length
        ? `Select the best Frame ${frame.label} candidate, review it if useful, then approve it.`
        : promptReady
          ? "Import existing images here, or use the optional prompt tools below to create more choices."
          : "Drop or choose existing images here. Optional prompt tools are available below.";
  const candidatePage = boundedPage(step.candidates, "candidates", `shot:${s.id}:frame:${frame.id}`, BOUNDED_PAGE_SIZES.candidates);
  const candidateGallery = step.candidates.length
    ? `<div class="guided-frame-candidate-grid bounded-source-section" role="listbox" aria-label="Frame ${esc(frame.label)} candidates">${candidatePage.rows.map((take) => guidedFrameCandidateCard(s, frame, take, step.approved, state.selectedCandidate)).join("")}</div>${boundedPagerMarkup("candidates",`shot:${s.id}:frame:${frame.id}`,candidatePage,`Frame ${frame.label} candidates`)}`
    : `<div class="guided-frame-candidate-grid"><div class="guided-empty-inline"><b>No Frame ${esc(frame.label)} images yet.</b><span>Drop finished artwork, a storyboard frame, a photograph, a render, or any other existing image. Generation is optional.</span></div></div>`;
  const actions = [];
  if (state.selectedCandidate && (!step.approved || changingWinner)) actions.push(`<button class="approve-btn guided-approve-selected" onclick="approveGuidedFrame('${s.id}','${frame.id}','${attr(state.selectedCandidate)}')">APPROVE</button>`);
  if (step.approved) actions.push(`<details class="guided-inline-actions"><summary>Frame options</summary><button class="chip danger" onclick="resetGuidedFrameApproval('${s.id}','${frame.id}')">Reset approval</button></details>`);
  const complete = !!step.approved && !changingWinner;
  const kicker = complete ? "✓ FRAME COMPLETE" : "RETURN RESULTS";
  return `<section class="guided-frame-return ${step.candidates.length ? "has-candidates" : "needs-candidates"} ${complete ? "is-approved" : ""}"><header><div><span>${kicker}</span><b>${esc(message)}</b></div>${actions.length ? `<div class="guided-frame-return-actions">${actions.join("")}</div>` : ""}</header>${candidateGallery}<div class="dropzone dropzone-lg guided-frame-dropzone" data-frame-dropzone="${attr(frame.id)}">DROP OR CHOOSE FRAME ${esc(frame.label)} CANDIDATES<input type="file" id="frame-file-${attr(frame.id)}" multiple accept="image/*" style="display:none"></div></section>`;
}
/* WHO IS IN THIS FRAME — the smallest control that makes the contract reachable.

   Dogfood #2 A3. The shot's cast said the Chimbley Sweep belonged to S01-01, and
   nothing in the product could say he is not in FRAME A. This is the writer for
   that fact; public/shared-frame-presence.js is the rule and prompt-engine.js is
   the enforcement.

   Deliberately small. Shot Setup as a whole is a design brief, not this batch:
   what is needed here is the authoritative declaration, in the place a creator
   is already describing the frame. */
function guidedFramePresencePanel(s, frame) {
  const resolved = typeof resolveShotEntities === "function" ? resolveShotEntities(P, s) : null;
  if (!resolved) return "";
  const members = [
    ...(resolved.characters || []).map((entity) => ({ entity, kind: "Character" })),
    ...(resolved.props || []).map((entity) => ({ entity, kind: "Prop" })),
    ...(resolved.vehicles || []).map((entity) => ({ entity, kind: "Vehicle" })),
  ].filter((row) => row.entity && row.entity.id);
  if (!members.length) return "";
  const declared = members.filter((row) => resolveFramePresence(s, frame.id, row.entity.id)).length;
  const rows = members.map((row) => {
    const current = resolveFramePresence(s, frame.id, row.entity.id);
    const options = [["", "Follows the shot"], ...FRAME_PRESENCE_VALUES.map((value) => [value, {
      absent: "Not in this frame",
      present: "Visible in this frame",
      enters: "Enters during this frame",
      exits: "Leaves during this frame",
    }[value] || value])];
    return `<label class="frame-presence-row"><span><b>${esc(row.entity.name || row.entity.id)}</b><small>${esc(row.kind)}</small></span><select onchange="setFramePresence('${attr(s.id)}','${attr(frame.id)}','${attr(row.entity.id)}',this.value)">${options.map(([value, label]) => `<option value="${attr(value)}" ${value === current ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>`;
  }).join("");
  return `<details class="fold frame-presence-panel" ${declared ? "open" : ""}><summary>Who is in this frame <span>${declared ? `${declared} declared` : "follows the shot"}</span></summary><p class="hint">The shot's references say what the shot is about. This says what is visible in <b>this frame</b>. A reference stays attached for identity even when its subject is not in the frame — a frame marked <b>Not in this frame</b> compiles a prompt that requires the absence.</p><div class="frame-presence-rows">${rows}</div></details>`;
}
window.setFramePresence = (shotId, frameId, entityId, value) => {
  const s = shotById(shotId);
  if (!s) return;
  const creation = ensureShotCreation(s);
  creation.frameWorkflows = creation.frameWorkflows && typeof creation.frameWorkflows === "object" ? creation.frameWorkflows : {};
  const workflow = creation.frameWorkflows[frameId] = creation.frameWorkflows[frameId] || {};
  const map = workflow[RUNTIME_FRAME_PRESENCE_KEY] = workflow[RUNTIME_FRAME_PRESENCE_KEY] || {};
  const presence = normalizeFramePresence(value);
  /* ABSENCE MEANS INHERIT. Clearing a declaration deletes the key rather than
     storing "follows the shot", so a frame that declares nothing is
     indistinguishable from one that never did. */
  if (presence) map[entityId] = presence; else delete map[entityId];
  if (!Object.keys(map).length) delete workflow[RUNTIME_FRAME_PRESENCE_KEY];
  dirty();
  route();
};
function guidedFrameCard(s, frame, index, takes) {
  const state = guidedFrameState(s, frame, index), step = guidedFrameStepState(s, frame, index, takes);
  const refs = guidedFramePromptRefs(s, frame, index, state), mode = guidedFrameMode(state, refs);
  const profileId = preferredCreationProfile(mode, state.profileId || P.meta?.promptDefaults?.imageProfile || "");
  state.profileId = profileId;
  const previous = guidedPreviousFrame(s, index), previousApproved = previous ? guidedFrameApproved(s, previous, takes, index - 1) : null;
  const approved = step.approved;
  const title = index === 0 ? "First frame" : index === 1 ? "End frame" : `Frame ${frame.label}`;
  const statusClass = step.key;
  const operation = guidedPromptOp("frame", s.id, frame.id);
  const busy = operation?.status === "busy";
  const busyLabel = operation?.action || "";
  const error = operation?.status === "error";
  const openKey = `frame:${frame.id}`;
  const openDefault = busy || error || !approved;
  const statusTone = error ? "attention" : busy ? "active" : approved ? "complete" : step.candidates?.length ? "attention" : "pending";
  const statusLabel = error ? "Needs attention" : busy ? "Working" : approved ? "Complete" : step.label;
  const operationBody = busy
    ? assistantWorkingCard(busyLabel === "improve" ? "Improving the frame prompt for this model…" : "Compiling the frame prompt…", busyLabel === "improve" ? "The assistant may take up to three minutes per attempt. It is checking the shot, numbered references, camera, staging, and model-specific format." : "The deterministic compiler is assembling the approved inputs and production constraints.", { mode: busyLabel === "improve" ? "assistant" : "compile" })
    : error
      ? guidedPromptErrorMarkup(operation.error, `buildGuidedFramePrompt('${s.id}','${frame.id}',${busyLabel === "improve" ? "true" : "false"})`)
      : step.latest ? guidedFramePromptResult(s, frame, step.latest) : `<div class="guided-next-note"><b>Optional:</b> build a prompt when you need CineBraid to help create another candidate.</div>`;
  // Prompt history remains available in manual-first projects, but history alone
  // must not reopen the assisted toolset every time the frame is visited.
  const assistedOpen = !manualFirstWorkflow() || busy || error;
  const manualPromptHistory = manualFirstWorkflow() && step.latest
    ? `<div class="guided-assisted-history-note"><b>Assisted history available</b><span>A previous prompt build is preserved inside Optional assisted creation.</span></div>`
    : "";
  const assistedTools = `<details class="guided-assisted-tools frame-assisted-tools" ${assistedOpen ? "open" : ""}><summary><div><span>OPTIONAL ASSISTED CREATION</span><b>Build a prompt or generate another candidate</b><small>Your imported and manually approved images remain the authority.</small></div></summary><div class="guided-assisted-tools-body">${index > 0 ? `<label class="guided-previous-frame-toggle"><input type="checkbox" ${state.usePreviousFrame ? "checked" : ""} ${previousApproved ? "" : "disabled"} onchange="setGuidedFrameField('${s.id}','${frame.id}','usePreviousFrame',this.checked)"><span><b>Use approved Frame ${esc(previous?.label || "A")} as an image input</b><small>${previousApproved ? "Useful for controlled endpoint changes and first/last-frame workflows." : `Approve Frame ${esc(previous?.label || "A")} first.`}</small></span></label>` : ""}<div class="guided-frame-input-summary"><button onclick="openGuidedPanel('${s.id}','inputs')"><b>${refs.filter((ref) => ref.url).length}</b><span>approved input${refs.filter((ref) => ref.url).length === 1 ? "" : "s"}</span></button>${refs.filter((ref) => !ref.url).length ? `<span class="warn">${refs.filter((ref) => !ref.url).length} selected input${refs.filter((ref) => !ref.url).length === 1 ? " needs" : "s need"} approval</span>` : `<span>Inputs ready</span>`}</div><details class="guided-shot-options" ${(state.staging || state.camera || state.notes) ? "open" : ""}><summary>Additional prompt direction</summary>${field("Optional direction", `<textarea placeholder="Placement, camera, contact points, or anything that must stay unchanged." onchange="setGuidedFrameAdditionalDirection('${s.id}','${frame.id}',this.value)">${esc([state.staging,state.camera,state.notes].filter(Boolean).join("\n"))}</textarea>`)}</details><div class="guided-compile-bar guided-frame-compile"><details class="guided-inline-defaults"><summary>Target: ${esc((PROMPT_LIBRARY?.profiles || []).find((item) => item.id === profileId)?.name || profileId)}</summary><label><span>Image target</span><select ${busy ? "disabled" : ""} onchange="setGuidedFrameField('${s.id}','${frame.id}','profileId',this.value)">${creationProfileOptions(mode, profileId)}</select></label></details><div><button class="assemble-btn" ${busy ? "disabled" : ""} onclick="buildGuidedFramePrompt('${s.id}','${frame.id}',false)">${busy && busyLabel === "compile" ? `<span class="spin">◌</span> Compiling…` : "Build prompt"}</button><button class="ghost-btn" ${busy ? "disabled" : ""} onclick="buildGuidedFramePrompt('${s.id}','${frame.id}',true)"${aiDisabledAttrs("text")}>${busy && busyLabel === "improve" ? `<span class="spin">◌</span> Improving…` : "Improve"}</button></div></div>${operationBody}</div></details>`;
  const sequenceInputsForCard = guidedFrameSequenceInputs(s, takes);
  const sequenceReviewForCard = guidedFrameSequenceReviewState(s, sequenceInputsForCard);
  const motionAllowedForCard = sequenceInputsForCard.length < 2 || !!sequenceReviewForCard?.pass;
  const approvedPreview = approved ? `<button type="button" class="guided-frame-approved-preview guided-thumb-preview" onclick="openMediaTheatre('${attr(encodeURIComponent(approved.url))}','${attr(encodeURIComponent(`Approved Frame ${frame.label} · ${approved.name}`))}','image')" aria-label="View approved Frame ${esc(frame.label)} larger"><img src="${attr(approved.url)}" alt="Approved Frame ${esc(frame.label)}"><span>View larger</span></button><b>Approved Frame ${esc(frame.label)}</b><div class="guided-frame-context-actions"><a href="${attr(approved.url)}" download>Download image ↓</a>${motionAllowedForCard ? `<button type="button" class="approve-btn" onclick="openGuidedMotionFromFrames('${attr(s.id)}','create')">Create motion →</button>` : `<button type="button" class="chip" onclick="reviewGuidedFrameSequence('${attr(s.id)}')"${aiDisabledAttrs("vision")}>Review sequence first</button>`}</div>` : "";
  return `<details class="guided-frame-card state-${statusClass} compact-work-section" data-frame-id="${attr(frame.id)}" ${workspaceSectionOpen(`${s.id}:${openKey}`, openDefault) ? "open" : ""} ontoggle="rememberWorkspaceSection('${attr(s.id)}:${attr(openKey)}',this.open)"><summary class="guided-frame-head"><div class="guided-frame-number">${esc(frame.label)}</div><div><span>${index === 0 ? "START FRAME" : index === 1 ? "OPTIONAL END FRAME" : "ADDITIONAL FRAME"}</span><h3>${esc(frame.title || title)}</h3><small>${approved ? `Approved · ${esc(approved.name)}` : step.label}</small></div>${approved ? `<img class="guided-frame-summary-thumb" src="${attr(approved.url)}" alt="">` : ""}${workspaceStatusPill(statusLabel, statusTone)}<i class="compact-chevron">⌄</i></summary><div class="guided-frame-collapse-body">${index > 0 ? `<div class="compact-section-actions"><button class="chip danger" onclick="removeGuidedFrame('${s.id}','${frame.id}')">Remove frame</button></div>` : ""}<div class="guided-frame-body"><aside class="guided-frame-context">${approved ? approvedPreview : previousApproved && index > 0 ? `<button type="button" class="guided-frame-approved-preview guided-thumb-preview" onclick="openMediaTheatre('${attr(encodeURIComponent(previousApproved.url))}','${attr(encodeURIComponent(`Frame ${previous.label} input · ${previousApproved.name}`))}','image')"><img src="${attr(previousApproved.url)}" alt="Previous approved frame"><span>View larger</span></button><b>Frame ${esc(previous.label)} input</b><small>${state.usePreviousFrame ? "Included as a starting reference" : "Available for optional assisted creation"}</small>` : `<div class="guided-frame-placeholder"><span>FRAME ${esc(frame.label)}</span><p>${index === 0 ? "Import or choose the shot's first approved image." : "Add another composition only when the shot needs it."}</p></div>`}</aside><div class="guided-frame-work">${field(index === 0 ? "Frame description / production note" : `Frame ${frame.label} description / production note`, `<textarea class="guided-primary-brief" placeholder="Describe what the approved image should show. This remains useful even when the image was made elsewhere." onchange="setGuidedFrameField('${s.id}','${frame.id}','action',this.value,true)">${esc(state.action)}</textarea>`)}${guidedFramePresencePanel(s, frame)}${guidedFrameCandidatesPanel(s, frame, index, takes, step)}${manualPromptHistory}${assistedTools}</div></div></div></details>`;
}

function guidedFrameRailMarkup(s, frames, takes, selectedId) {
  return `<nav class="guided-frame-rail" aria-label="Shot frames">${frames.map((frame, index) => {
    const step = guidedFrameStepState(s, frame, index, takes);
    const operation = guidedPromptOp("frame", s.id, frame.id);
    const busy = operation?.status === "busy", error = operation?.status === "error";
    /* MB-PT-02, shot side: the stage label said "Approved" from a raw winner
       pointer, exactly as the entity page did from a raw approvedFile. The image
       still shows — it is real work — but a pointer nobody approved reads as
       HISTORIC and still owes the creator a decision. */
    const frameIsCanon = !!step.approved && typeof hasCurrentHumanAuthority === "function"
      && hasCurrentHumanAuthority(P, { kind: "shot-frame", shotId: s.id, frameId: frame.id });
    const frameIsHistoric = !!step.approved && !frameIsCanon;
    const tone = error ? "attention" : busy ? "active" : frameIsCanon ? "complete" : frameIsHistoric ? "pending" : step.candidates?.length ? "attention" : "pending";
    const state = error ? "Needs attention" : busy ? "Working" : frameIsCanon ? "Approved" : frameIsHistoric ? "Historic · approve it" : step.candidates?.length ? `${step.candidates.length} candidate${step.candidates.length === 1 ? "" : "s"}` : step.label;
    return `<button type="button" class="tone-${tone} ${frame.id === selectedId ? "selected" : ""}" onclick="selectBoundedItem('shot-frame','${attr(s.id)}','${attr(frame.id)}')"><i></i><span><b>Frame ${esc(frame.label)}</b><small>${esc(frame.title || (index === 0 ? "Start frame" : index === 1 ? "End frame" : "Additional frame"))}</small></span><small>${esc(state)}</small>${step.approved ? `<img src="${attr(step.approved.url)}" alt="">` : ""}</button>`;
  }).join("")}</nav>`;
}

function guidedFrameSequenceInputs(s, takes = takesFor(s.id)) {
  const frames = guidedFrames(s);
  return frames.map((frame, index) => {
    const approved = guidedFrameApproved(s, frame, takes, index);
    return approved ? { frame, approved } : null;
  }).filter(Boolean);
}
function guidedFrameSequenceReviewState(s, inputs = guidedFrameSequenceInputs(s)) {
  const review = ensureShotCreation(s).frameSequenceReview || null;
  if (!review || !Array.isArray(review.files)) return null;
  const files = inputs.map((row) => row.approved.name);
  return review.files.length === files.length && review.files.every((name, index) => name === files[index]) ? review : null;
}
function guidedFrameSequenceReviewMarkup(s, inputs, review) {
  if (inputs.length < 2) return "";
  const vision = typeof capabilityState === "function" ? capabilityState("vision") : { ready: false, message: "Vision assistant unavailable" };
  /* O5: these are the APPROVED Frame A / Frame B anchors, which is precisely the
     "where did that Frame A go, and is it really approved" question the Inspector
     exists for. The clean preview is still one click further in. */
  const preview = `<div class="frame-sequence-thumbs" style="${attr(shotWellStyle(s))}">${inputs.map(({frame,approved}) => `<button type="button" onclick="inspectMediaFile('${attr(encodeURIComponent(approved.url))}','${attr(approved.assetId || "")}','${attr(encodeURIComponent(`Frame ${frame.label} · ${approved.name}`))}','image')"><img src="${attr(approved.url)}" alt="Frame ${esc(frame.label)}"><span>Frame ${esc(frame.label)}</span></button>`).join("")}</div>`;
  if (review?.status === "working") return `<section class="frame-sequence-review state-working"><header><div><span>PAIR CONTINUITY REVIEW</span><b>Reviewing the approved anchors together…</b><small>The vision assistant is checking camera, environment, background lights, character, and prop continuity.</small></div><i class="spin">◌</i></header>${preview}</section>`;
  if (!review) return `<section class="frame-sequence-review state-pending"><header><div><span>PAIR CONTINUITY CHECK REQUIRED</span><b>Review these approved anchors together before motion</b><small>Individual approval is not enough for first/last-frame or multi-frame motion. CineBraid checks camera, environment, background lights, character, and prop continuity.</small></div><button class="approve-btn" onclick="reviewGuidedFrameSequence('${attr(s.id)}')" ${vision.ready ? "" : "disabled"}>REVIEW FRAME SEQUENCE</button></header>${preview}${!vision.ready ? `<p class="prompt-check warn">${esc(vision.message || "Connect a vision assistant to review this frame sequence.")}</p>` : ""}</section>`;
  const categories = Object.entries(review.categories || {}).map(([key,row]) => `<li class="${Number(row.score||0) >= 80 ? "pass" : "flag"}"><span>${esc(key.replace(/([A-Z])/g," $1"))}</span><b>${Math.round(Number(row.score||0))}</b><small>${esc(row.note || "")}</small></li>`).join("");
  const issues = (review.blockingIssues || []).map((item) => `<li>${esc(item)}</li>`).join("");
  const failedActions = review.pass ? "" : `<div class="frame-sequence-fix-actions"><button class="approve-btn large" onclick="openFrameSequenceCorrection('${attr(s.id)}')">FIX CONTINUITY</button><button class="ghost-btn" onclick="prepareFrameSequenceCorrectionUpload('${attr(s.id)}')">UPLOAD CORRECTED FRAME</button><button class="ghost-btn" onclick="chooseFrameSequenceCorrectionCandidate('${attr(s.id)}')">CHOOSE ANOTHER CANDIDATE</button></div>`;
  return `<section class="frame-sequence-review ${review.pass ? "state-pass" : "state-fail"}"><header><div><span>${review.pass ? "PAIR CONTINUITY PASSED" : "PAIR CONTINUITY FAILED"}</span><b>${esc(review.summary || "Frame sequence review complete")}</b><small>${esc(review.nextAction || "")}</small></div><div class="frame-sequence-review-score"><strong>${Math.round(Number(review.score||0))}</strong><span>/100</span></div></header>${preview}<ul class="frame-sequence-category-grid">${categories}</ul>${issues ? `<div class="frame-sequence-issues"><b>Blocking mismatches</b><ul>${issues}</ul></div>` : ""}${failedActions}<footer><small>Reviewed ${esc(String(review.reviewedAt || "").slice(0,16).replace("T"," "))}</small><button class="ghost-btn" onclick="reviewGuidedFrameSequence('${attr(s.id)}')">REVIEW AGAIN</button></footer></section>`;
}
window.reviewGuidedFrameSequence = async (shotId) => {
  const s = shotById(shotId);
  if (!s) return toast("Shot is unavailable");
  const vision = typeof capabilityState === "function" ? capabilityState("vision") : { ready: false };
  if (!vision.ready) return toast(vision.message || "Vision assistant is unavailable");
  const inputs = guidedFrameSequenceInputs(s);
  if (inputs.length < 2) return toast("Approve at least two frames first");
  const c = ensureShotCreation(s);
  c.frameSequenceReview = { status: "working", files: inputs.map((row)=>row.approved.name), reviewedAt: new Date().toISOString() };
  dirty(); route();
  try {
    if (typeof flushPendingProjectSave === "function") await flushPendingProjectSave();
    const response = await fetch("/api/llm/review-frame-sequence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shotId, frameIds: inputs.map((row)=>row.frame.id) }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Frame sequence review failed");
    c.frameSequenceReview = { ...data.review, frameIds: data.frameIds || inputs.map((row)=>row.frame.id), files: data.files || inputs.map((row)=>row.approved.name) };
    dirty(); route();
    toast(c.frameSequenceReview.pass ? "Frame sequence passed continuity review" : "Frame sequence needs continuity correction");
  } catch (error) {
    c.frameSequenceReview = null;
    dirty(); route();
    toast("Frame sequence review failed: " + error.message);
  }
};

function guidedFrameWorkflowPanel(s, takes) {
  const progress = guidedFrameProgress(s, takes);
  const approvedCount = progress.frames.filter((f, i) => guidedFrameApproved(s, f, takes, i)).length;
  const complete = approvedCount === progress.frames.length && progress.frames.length > 0;
  const attention = progress.frames.some((frame, index) => {
    const step = guidedFrameStepState(s, frame, index, takes);
    const operation = guidedPromptOp("frame", s.id, frame.id);
    return operation?.status === "error" || (!step.approved && step.candidates?.length);
  });
  const tone = attention ? "attention" : complete ? "complete" : "pending";
  const label = attention ? "Needs attention" : complete ? `${approvedCount}/${progress.frames.length} complete` : `${approvedCount}/${progress.frames.length} approved`;
  // This is the primary content of the bounded Frames stage. Keep it open by
  // default even after approval so the user can inspect the approved anchors
  // and continue directly into motion without reopening a collapsed shell.
  const openDefault = true;
  const ids = progress.frames.map((frame) => frame.id);
  const fallback = progress.frames.find((frame, index) => !guidedFrameApproved(s, frame, takes, index))?.id || ids[0] || "";
  const selectedId = boundedSelected("shot-frame", s.id, ids, fallback);
  const selectedIndex = Math.max(0, progress.frames.findIndex((frame) => frame.id === selectedId));
  const selectedFrame = progress.frames[selectedIndex] || progress.frames[0];
  ensureShotCreation(s).activeGuidedFrameId = selectedFrame?.id || "";
  const sequenceInputs = guidedFrameSequenceInputs(s, takes);
  const approvedAnchors = sequenceInputs.map((row) => row.approved);
  const sequenceReview = guidedFrameSequenceReviewState(s, sequenceInputs);
  const motionMode = approvedAnchors.length >= 3 ? "Multi-frame motion" : approvedAnchors.length === 2 ? "First / last-frame motion" : "Image-to-video";
  /* P1-2. THE READINESS CHECK IS A VISION CALL, so the control that starts it answers to
     the vision capability BEFORE it is clicked, the way the pending pair-review button in
     guidedFrameSequenceReviewMarkup already did. A primary, enabled, visually-dominant
     button that refuses in a toast afterwards is the same refusal stated later, in the
     one place a filmmaker cannot act on it — and it reads as "CineBraid tried and
     something went wrong" rather than "this is switched off in Settings".

     aiDisabledAttrs is the shipped helper for exactly this and it carries the reason as a
     title; the visible paragraph is what makes the reason readable without hovering,
     which is the part a disabled control cannot do on its own.

     The per-frame "Review sequence first" chip in guidedFrameCard runs the SAME handler
     and was fixed with it, in this same patch — leaving the identical defect one panel
     away is how a corrected surface gets re-raised by the next audit. */
  const motionReadinessCapability = typeof capabilityState === "function" ? capabilityState("vision") : { ready: false, message: "Vision assistance is unavailable." };
  const motionReadinessReason = [motionReadinessCapability.message, motionReadinessCapability.action].filter(Boolean).join(" ") || "Vision assistance is unavailable.";
  const motionReadinessReasonId = `motion-readiness-unavailable-${s.id}`;
  const motionReadinessNote = motionReadinessCapability.ready ? "" : `<p class="prompt-check warn" id="${attr(motionReadinessReasonId)}">${esc(motionReadinessReason)}</p>`;
  const motionReadinessDescribedBy = motionReadinessCapability.ready ? "" : ` aria-describedby="${attr(motionReadinessReasonId)}"`;
  let motionCta = "";
  if (progress.requiredApproved && approvedAnchors.length === 1) {
    motionCta = `<section class="frames-to-motion-cta"><div><span>NEXT STEP</span><b>${motionMode} is ready</b><small>1 approved visual anchor. Open Motion & sound without leaving this shot.</small></div><button type="button" class="approve-btn large" onclick="openGuidedMotionFromFrames('${attr(s.id)}','create')">CREATE MOTION →</button></section>`;
  } else if (progress.requiredApproved && approvedAnchors.length >= 2 && sequenceReview?.pass) {
    motionCta = `<section class="frames-to-motion-cta state-pass"><div><span>NEXT STEP · MOTION READINESS ${Math.round(Number(sequenceReview.score||0))}/100</span><b>${motionMode} is ready</b><small>${approvedAnchors.length} approved anchors passed the motion readiness check.</small></div><button type="button" class="approve-btn large" onclick="openGuidedMotionFromFrames('${attr(s.id)}','create')">CREATE MOTION →</button></section>`;
  } else if (progress.requiredApproved && approvedAnchors.length >= 2 && sequenceReview?.status === "working") {
    motionCta = `<section class="frames-to-motion-cta state-blocked"><div><span>MOTION READINESS CHECK IN PROGRESS</span><b>Checking whether these anchors are motion-ready</b><small>This hand-off waits for the check to finish. Motion & sound itself stays open in the stage bar.</small></div><button type="button" class="approve-btn large" disabled><span class="spin">◌</span> REVIEWING</button></section>`;
  } else if (progress.requiredApproved && approvedAnchors.length >= 2) {
    /* Motion readiness, not continuity. The declared-entity continuity check
       below is the continuity instrument; this gate only decides whether these
       anchors can drive a first/last or multi-frame generation, and naming it
       "continuity" put two competing continuity buttons on one screen.

       AND IT GATES THIS HAND-OFF, NOT THE MOTION STAGE. The copy here used to say
       first/last and multi-frame motion "stay locked until … continuity pass", which
       the shipped runtime does not do: public/shared-stage-model.js declares exactly
       one motion prerequisite — required-frames-approved — and motionState() opens the
       stage on it, so the stage bar reaches Motion, FLF is selectable and Generate is
       present with this check never run. What is really true is the narrower thing:
       openGuidedMotionFromFrames refuses THIS route until the anchors it verified pass.
       Say that instead. A gate that overstates itself teaches a filmmaker to distrust
       the gates that are real. */
    motionCta = `<section class="frames-to-motion-cta state-blocked"><div><span>${sequenceReview ? "MOTION HAND-OFF BLOCKED" : "MOTION READINESS CHECK REQUIRED"}</span><b>${sequenceReview ? "These anchors are not motion-ready" : "Check the approved anchors together"}</b><small>${sequenceReview?.summary ? esc(sequenceReview.summary) : "This check compares the approved anchors before they drive a first/last or multi-frame generation. It does not lock Motion & sound: that stage opens once the required frames are approved."}</small>${motionReadinessNote}</div><button type="button" class="approve-btn large" onclick="reviewGuidedFrameSequence('${attr(s.id)}')"${motionReadinessDescribedBy}${aiDisabledAttrs("vision")}>${sequenceReview ? "CHECK AGAIN" : "CHECK MOTION READINESS"}</button></section>`;
  }
  const sequenceReviewMarkup = progress.requiredApproved && sequenceInputs.length >= 2 ? guidedFrameSequenceReviewMarkup(s, sequenceInputs, sequenceReview) : "";
  /* The v6.6 pair review is a model scoring two images together. The declared-
     entity check above is the current continuity instrument, so the older panel
     is kept for the results already stored against it and folded away rather
     than competing with it for the same decision. Its scores are never mixed
     into the deterministic findings. */
  const legacyReviewMarkup = sequenceReviewMarkup
    ? `<details class="fold legacy-continuity-review" ${workspaceSectionOpen(`${s.id}:legacy-sequence-review`, false) ? "open" : ""} ontoggle="rememberWorkspaceSection('${attr(s.id)}:legacy-sequence-review',this.open)"><summary>Pair continuity review (v6.6) <span>${sequenceReview ? (sequenceReview.pass ? "passed" : sequenceReview.status === "working" ? "running" : "failed") : "not run"}</span></summary><p class="hint">The earlier whole-image review, kept for its stored results and for motion readiness. Continuity findings above come from the declared-entity check and do not use these scores.</p>${sequenceReviewMarkup}</details>`
    : "";
  const continuityMarkup = typeof guidedContinuityPanel === "function" ? guidedContinuityPanel(s, takes) : "";
  return `<details class="guided-frame-workflow compact-work-section ${complete ? "is-complete" : ""}" ${workspaceSectionOpen(`${s.id}:frames-workflow`, openDefault) ? "open" : ""} ontoggle="rememberWorkspaceSection('${attr(s.id)}:frames-workflow',this.open)"><summary class="guided-workflow-title"><div><span>FRAMES</span><h2>Import, choose, and approve images</h2><span class="sr-only">Create and choose the images</span><p>Edit one frame at a time. Use the compact frame strip to move between start, end, and additional compositions.</p></div>${workspaceStatusPill(label, tone)}<i class="compact-chevron">⌄</i></summary><div class="guided-frame-workflow-body">${guidedFrameRailMarkup(s,progress.frames,takes,selectedId)}${motionCta}${continuityMarkup}${legacyReviewMarkup}${selectedFrame ? guidedFrameCard(s, selectedFrame, selectedIndex, takes) : ""}<button class="guided-add-frame" onclick="addGuidedFrame('${s.id}')"><b>＋ Add frame</b><span>Add an end frame or another required composition only when the motion needs it.</span></button></div></details>`;
}
function profileSupportsGuidedAudio(profile) {
  return !!(profile && (profile.mode === "audio-video" || profile.mode === "r2v" && (profile.limits?.maxAudio || profile.family === "happy-horse-1.1")));
}
/* Every written-up video workflow, INCLUDING the ones that need no approved still.
 *
 * `t2v` was missing from this list, and it was the only executable route CineBraid
 * hid from its own picker: `minimax-h3/t2v` resolves to the wired `fal-h3-fl2va`
 * adapter exactly as i2v and flf do — same checkpoint, same serializer — so the
 * filmmaker had a working text-to-video path and no way to select it. Reaching it
 * meant a route that exists, refuses nothing, and simply never appeared.
 *
 * Listing a mode here is not a claim that it can run: `guidedVideoProfileOptions`
 * still disables anything without an adapter and says why. */
function guidedVideoProfiles() {
  return (PROMPT_LIBRARY?.profiles || []).filter((profile) => profile.mediaType === "video" && ["t2v", "i2v", "flf", "r2v", "audio-video"].includes(profile.mode));
}
/* The modes that have no visual anchor by construction, so the gates that exist to
   guarantee one must not be applied to them. Read from the mode, never from a family. */
function guidedVideoModeNeedsApprovedStill(mode) {
  return String(mode || "") !== "t2v";
}
function guidedMotionDurationBounds(profile) {
  const range = profile?.limits?.durationSeconds;
  if (Array.isArray(range) && range.length >= 2) return [Math.max(1, Number(range[0]) || 1), Math.max(1, Number(range[1]) || 30)];
  return [1, 30];
}
function guidedClampedMotionDuration(value, profile) {
  const [min, max] = guidedMotionDurationBounds(profile);
  return Math.max(min, Math.min(max, Number(value) || Math.min(5, max)));
}
/* CAN CINEBRAID ACTUALLY RUN THIS TARGET TODAY.
 *
 * The answer is not derived here and is not guessed from a family name: the server
 * annotates every profile in /api/prompt/profiles from the adapter inventory declared
 * beside the serializers (generation-options.js). A profile with no annotation is
 * treated as not dispatchable, which is the safe direction — it produces a stated
 * refusal instead of a Generate button with nothing behind it. */
function guidedVideoProfileDispatchable(profile) {
  return profile?.execution?.dispatchable === true;
}
function guidedDispatchableVideoProfiles() {
  return guidedVideoProfiles().filter(guidedVideoProfileDispatchable);
}
function preferredGuidedVideoProfile(selected = "") {
  const profiles = guidedVideoProfiles();
  /* An explicit, valid selection is never replaced — not even one this build cannot
     dispatch. Quietly swapping it is the silent fall-through that lets someone
     believe an unsupported choice worked; the refusal says so instead. */
  if (profiles.some((profile) => profile.id === selected)) return selected;
  /* The DEFAULT is a different question, and it has to be something CineBraid can
     really execute: a default nobody chose that cannot generate is a dead end handed
     to every new shot. The project default is honoured when it is dispatchable, then
     the wired image-to-video target, which is what a first motion pass needs. */
  const dispatchable = profiles.filter(guidedVideoProfileDispatchable);
  const projectDefault = P.meta?.promptDefaults?.videoProfile || "";
  return (projectDefault && dispatchable.some((profile) => profile.id === projectDefault) ? projectDefault : "")
    || dispatchable.find((profile) => profile.mode === "i2v")?.id
    || dispatchable[0]?.id
    /* Nothing is wired at all: keep the old behaviour rather than returning nothing,
       so the picker still shows a target and the refusal explains it. */
    || (projectDefault && profiles.some((profile) => profile.id === projectDefault) ? projectDefault : "")
    || profiles[0]?.id
    || "";
}
/* The one-line description of a target's availability, in the picker's own words. */
function guidedVideoProfileOptionSuffix(profile) {
  if (!guidedVideoProfileDispatchable(profile)) return " · not available in this build";
  if (profile.mode === "t2v") return " · prompt only, no reference images";
  if (profile.mode === "flf") return " · first + last frame";
  if (profile.mode === "r2v") return profile.family === "minimax-h3" ? " · multi-frame + references" : " · reference performance";
  return profileSupportsGuidedAudio(profile) ? " · native audio" : "";
}
function guidedVideoProfileOptions(selected = "") {
  const profiles = guidedVideoProfiles();
  const families = [
    ["minimax-h3", "MiniMax H3"],
    ["seedance-2", "Seedance 2"],
    ["kling-3", "Kling 3"],
    ["ltx-2.3", "LTX 2.3"],
    ["happy-horse-1.1", "Happy Horse 1.1"],
  ];
  /* An unwired target stays VISIBLE and stops being SELECTABLE. Hiding it would lose
     the catalogue a filmmaker is entitled to see; leaving it pressable is what made a
     dead end reachable. A stored selection keeps rendering either way, so a project
     that already names one is never silently moved onto another model. */
  const option = (profile) => `<option value="${attr(profile.id)}" ${profile.id === selected ? "selected" : ""} ${guidedVideoProfileDispatchable(profile) || profile.id === selected ? "" : "disabled"}>${esc(profile.name.replace(/^.*?—\s*/, ""))}${esc(guidedVideoProfileOptionSuffix(profile))}</option>`;
  const rendered = [];
  for (const [family, label] of families) {
    const rows = profiles.filter((profile) => profile.family === family);
    if (!rows.length) continue;
    rendered.push(`<optgroup label="${attr(label)}">${rows.map(option).join("")}</optgroup>`);
  }
  const other = profiles.filter((profile) => !families.some(([family]) => family === profile.family));
  if (other.length) rendered.push(`<optgroup label="Other compatible targets">${other.map((profile) => `<option value="${attr(profile.id)}" ${profile.id === selected ? "selected" : ""} ${guidedVideoProfileDispatchable(profile) || profile.id === selected ? "" : "disabled"}>${esc(profile.name)}${esc(guidedVideoProfileOptionSuffix(profile))}</option>`).join("")}</optgroup>`);
  return rendered.join("");
}
/* The refusal, in the standard CineBraid uses everywhere it declines to spend: plain
   language, before the paid action, a specific reason and a specific next step naming
   a target that really is wired. Never a substitution — the choice stays the
   filmmaker's. */
function guidedVideoProfileRefusalMarkup(profile) {
  if (!profile || guidedVideoProfileDispatchable(profile)) return "";
  const execution = profile.execution || {};
  const alternative = (execution.alternatives || [])[0];
  const action = execution.action || (alternative ? `Use ${alternative.name} for this step.` : "");
  return `<div class="guided-prompt-error guided-video-unsupported" data-video-profile-unsupported="${attr(profile.id)}"><div><b>CineBraid cannot generate with ${esc(profile.name)} yet</b><small>${esc(execution.reason || `No adapter for ${profile.family || "this model"} ships in this build.`)} ${esc(action)}</small>${alternative ? `<em>Working alternative: ${esc(alternative.name)}</em>` : ""}</div></div>`;
}
function guidedVideoProfileCount() {
  return guidedDispatchableVideoProfiles().length;
}
function ensureGuidedMotionUnit(s, currentName = "", profile = null) {
  normalizeShotV5(s);
  const frames = guidedFrames(s);
  let frame = frames[0];
  /* BATCH 1B: the shadowed twin of the same defect removed in v607-composer.js —
     motion-unit setup wrote the opening frame's winner. Authority is established
     by an approval command, never by opening a composer. */
  let unit = (s.clips || [])[0];
  if (!unit) {
    unit = { id: "seg-guided-" + Date.now().toString(36), suffix: "a", label: "A", title: "Primary motion", dur: 5, kind: "i2v", note: "", motionPrompt: "", fromFrame: frame.id, toFrame: "", generationPackages: [] };
    s.clips = [unit];
  }
  unit.fromFrame = frame.id;
  const lastApproved = [...frames].reverse().find((f, reverseIndex) => {
    const index = frames.length - 1 - reverseIndex;
    return index > 0 && guidedFrameApproved(s, f, takesFor(s.id), index);
  });
  unit.toFrame = profile?.mode === "flf" && lastApproved ? lastApproved.id : "";
  if (profile?.mode) unit.kind = profile.mode === "audio-video" ? "r2v" : profile.mode;
  unit.generationPackages = unit.generationPackages || [];
  return unit;
}
function motionSubjectPlan(c, id) {
  c.motionPlan.subjects[id] = c.motionPlan.subjects[id] && typeof c.motionPlan.subjects[id] === "object" ? c.motionPlan.subjects[id] : { action: "still", direction: "", intensity: "subtle", look: "", notes: "" };
  return c.motionPlan.subjects[id];
}
function motionPropPlan(c, id) {
  c.motionPlan.props[id] = c.motionPlan.props[id] && typeof c.motionPlan.props[id] === "object" ? c.motionPlan.props[id] : { action: "static", direction: "", notes: "" };
  return c.motionPlan.props[id];
}
function structuredMotionSummary(s) {
  const c = ensureShotCreation(s), plan = c.motionPlan, camera = plan.camera || {}, lines = [];
  if (camera.move && camera.move !== "none") lines.push(`Camera: ${camera.move.replace(/-/g," ")}${camera.direction ? ` ${camera.direction.replace(/-/g," ")}` : ""}, ${camera.intensity || "subtle"}, ${camera.style || "smooth"}; ${camera.framing === "allow-reframe" ? "reframing allowed" : "preserve the staged composition"}.`);
  for (const id of s.characters || []) {
    const x = P.characters.find((item) => item.id === id), p = motionSubjectPlan(c, id);
    if (p.action && p.action !== "still") lines.push(`${x?.name || id}: ${p.action.replace(/-/g," ")}${p.direction ? ` toward ${p.direction.replace(/-/g," ")}` : ""}, ${p.intensity || "natural"}${p.look ? `; looks ${p.look.replace(/-/g," ")}` : ""}${p.notes ? `; ${p.notes}` : ""}.`);
    else lines.push(`${x?.name || id} remains still except for natural breathing and blinking${p.notes ? `; ${p.notes}` : ""}.`);
  }
  for (const id of c.propIds || []) {
    const x = [...(P.props || []), ...(P.vehicles || [])].find((item) => item.id === id), p = motionPropPlan(c, id);
    lines.push(`${x?.name || id}: ${String(p.action || "static").replace(/-/g," ")}${p.direction ? ` ${p.direction.replace(/-/g," ")}` : ""}${p.notes ? `; ${p.notes}` : ""}.`);
  }
  const env = plan.environment || {};
  if (env.action && env.action !== "static") lines.push(`Environment: ${env.action.replace(/-/g," ")}, ${env.intensity || "subtle"}${env.notes ? `; ${env.notes}` : ""}.`);
  else lines.push("Environment remains stable unless explicitly animated above.");
  const timing = plan.timing || {};
  lines.push(`Timing: ${timing.onset || "immediate"} onset, ${timing.pacing || "natural"} pacing${timing.holdEnd ? "; settle and hold the final state" : ""}${timing.secondary ? `; secondary action: ${timing.secondary}` : ""}.`);
  const audio = plan.audio || {};
  if (audio.lipSync && audio.referenceKey) {
    const ref = shotPlanningGenerationReferences(s, ["audio"]).find((item) => item.key === audio.referenceKey);
    const speaker = P.characters.find((item) => item.id === audio.speakerId);
    lines.push(`${speaker?.name || audio.speakerId || "The selected character"} is the only speaking character and lip-syncs the dialogue from ${ref?.label || "the linked audio reference"}${audio.direction ? ` with ${audio.direction}` : ""}.`);
  }
  return lines.join("\n");
}
function motionSubjectControls(s, c) {
  return (s.characters || []).map((id) => { const x = P.characters.find((item) => item.id === id), p = motionSubjectPlan(c,id); return `<article class="motion-director-subject"><header><b>${esc(x?.name || id)}</b><span>CHARACTER</span></header><div class="motion-director-grid"><label><span>Action</span><select onchange="setMotionSubject('${s.id}','${id}','action',this.value)">${composerOptions([["still","Remain still"],["idle","Subtle idle"],["head-turn","Head turn"],["look","Eye / gaze move"],["gesture","Gesture"],["walk","Walk"],["run","Run"],["sit","Sit"],["stand","Stand"],["enter-frame","Enter frame"],["exit-frame","Exit frame"],["interact-prop","Interact with prop"]], p.action)}</select></label><label><span>Direction</span><select onchange="setMotionSubject('${s.id}','${id}','direction',this.value)">${composerOptions([["","Not specified"],["screen-left","Screen left"],["screen-right","Screen right"],["toward-camera","Toward camera"],["away-camera","Away from camera"]], p.direction)}</select></label><label><span>Intensity</span><select onchange="setMotionSubject('${s.id}','${id}','intensity',this.value)">${composerOptions([["subtle","Subtle"],["natural","Natural"],["energetic","Energetic"]], p.intensity)}</select></label><label><span>Look</span><select onchange="setMotionSubject('${s.id}','${id}','look',this.value)">${composerOptions([["","Unspecified"],["camera-left","Camera left"],["camera-right","Camera right"],["toward-camera","Toward camera"],["away-camera","Away from camera"],["at-prop","At prop"]], p.look)}</select></label><label class="wide"><span>Custom direction</span><input value="${attr(p.notes || "")}" onchange="setMotionSubject('${s.id}','${id}','notes',this.value)" placeholder="Turns toward the parked car and reaches for the handle…"></label></div></article>`; }).join("") || `<div class="guided-empty-inline"><b>No character assigned to this shot.</b><span>Add characters in Source & References before directing character movement.</span></div>`;
}
function motionPropControls(s, c) {
  return (c.propIds || []).map((id) => { const x=[...(P.props||[]),...(P.vehicles||[])].find((item)=>item.id===id), p=motionPropPlan(c,id); return `<article class="motion-director-subject"><header><b>${esc(x?.name || id)}</b><span>PROP / VEHICLE</span></header><div class="motion-director-grid"><label><span>Action</span><select onchange="setMotionProp('${s.id}','${id}','action',this.value)">${composerOptions([["static","Static"],["move","Move"],["picked-up","Picked up"],["set-down","Set down"],["open","Open"],["close","Close"],["start","Start"],["stop","Stop"],["pass-frame","Pass through frame"]],p.action)}</select></label><label><span>Direction</span><select onchange="setMotionProp('${s.id}','${id}','direction',this.value)">${composerOptions([["","Not specified"],["screen-left","Screen left"],["screen-right","Screen right"],["toward-camera","Toward camera"],["away-camera","Away from camera"]],p.direction)}</select></label><label class="wide"><span>Custom direction</span><input value="${attr(p.notes || "")}" onchange="setMotionProp('${s.id}','${id}','notes',this.value)" placeholder="Car remains parked; headlights turn on…"></label></div></article>`; }).join("");
}
function motionDirectionGlyph(direction) {
  return { "screen-left": "←", "screen-right": "→", "toward-camera": "↙", "away-camera": "↗", left: "←", right: "→", up: "↑", down: "↓", clockwise: "↻", counterclockwise: "↺" }[direction] || "•";
}
function motionDirectorMap(s, c) {
  const plan = c.composition, camera = c.motionPlan.camera || {};
  const current = guidedCurrentShotStill(s);
  const refs = shotCreationReferences(s);
  const markers = (plan.elements || []).filter((element) => !element.hidden).map((element) => {
    const ref = refs.find((item) => item.key === element.referenceKey);
    const entityId = ref?.entityId || "";
    const subject = c.motionPlan.subjects[entityId], prop = c.motionPlan.props[entityId];
    const direction = subject?.direction || prop?.direction || "";
    const action = subject?.action || prop?.action || "";
    return `<div class="motion-map-marker depth-${attr(element.depth || "midground")}" style="left:${Number.isFinite(+element.x) ? +element.x * 100 : 50}%;top:${Number.isFinite(+element.y) ? +element.y * 100 : 50}%;width:${(+element.w||.25)*100}%;height:${(+element.h||.25)*100}%"><span>${esc(ref?.entityName || ref?.label || element.label || "Element")}</span>${direction ? `<i>${motionDirectionGlyph(direction)}</i>` : `<i class="locked">•</i>`}${action && !["still","static"].includes(action) ? `<small>${esc(action.replace(/-/g," "))}</small>` : ""}</div>`;
  }).join("");
  const base = current?.url
    ? `<img class="motion-map-base" src="${attr(current.url)}" alt="Approved opening frame">`
    : `<div class="motion-map-no-base"><b>No approved opening image available</b><span>Approve Frame A before directing motion.</span></div>`;
  return `<div class="motion-map-wrap"><div class="motion-map" style="aspect-ratio:${composerAspectStyle(plan.aspectRatio)}">${base}${markers}<div class="motion-camera-glyph"><b>CAMERA</b><span>${motionDirectionGlyph(camera.direction)} ${esc((camera.move || "locked").replace(/-/g," "))}</span></div></div><small>The approved opening frame is the actual video input. Outlines show motion assignments only; source-reference thumbnails are never composited into the preview.</small></div>`;
}

function motionAudioSummary(s, c) {
  const audio = [
    s.audio?.line ? `Spoken line (${P.characters.find((item) => item.id === s.audio.speakerId)?.name || s.audio.speakerId || "speaker unassigned"}): ${s.audio.line}` : "",
    s.audio?.note || s.audio?.vo ? `Production note: ${s.audio.note || s.audio.vo}` : "",
    s.audio?.sfx ? `SFX / ambience: ${s.audio.sfx}` : "",
    c.motionAudioNotes ? `Audio direction: ${c.motionAudioNotes}` : "",
  ].filter(Boolean);
  const simpleAudio = c.motionPlan?.audio || {};
  if (simpleAudio.mode === "lip-sync-reference" && simpleAudio.referenceKey) {
    const speaker = P.characters.find((item) => item.id === simpleAudio.speakerId);
    audio.push(`${speaker?.name || simpleAudio.speakerId || "Selected character"} lip-syncs to the assigned recording${simpleAudio.direction ? ` (${simpleAudio.direction})` : ""}; do not generate a second voice.`);
  } else if (simpleAudio.mode === "generate-voice" && s.audio?.line) {
    const speaker = P.characters.find((item) => item.id === simpleAudio.speakerId || item.id === s.audio?.speakerId);
    audio.push(`${speaker?.name || simpleAudio.speakerId || s.audio?.speakerId || "Selected character"} generates the locked spoken line${simpleAudio.direction ? ` (${simpleAudio.direction})` : ""}.`);
  }
  if (!audio.length) return "";
  if (c.motionSync && !["none", "natural"].includes(c.motionSync))
    audio.push(`Synchronization: ${c.motionSync}`);
  return audio.join("\n");
}
function ensureH3KeyframePlan(s) {
  const c = ensureShotCreation(s);
  c.h3Keyframes = c.h3Keyframes && typeof c.h3Keyframes === "object" ? c.h3Keyframes : {};
  c.h3KeyframeOrder = Array.isArray(c.h3KeyframeOrder) ? c.h3KeyframeOrder.map(String) : [];
  c.h3SequenceNote = String(c.h3SequenceNote || "");
  return c;
}
function h3ApprovedFrameRows(s) {
  const c = ensureH3KeyframePlan(s), frames = guidedFrames(s), takes = takesFor(s.id);
  const rows = frames.map((frame, index) => {
    const take = guidedFrameApproved(s, frame, takes, index);
    if (!take) return null;
    const state = guidedFrameState(s, frame, index);
    const saved = c.h3Keyframes[frame.id] && typeof c.h3Keyframes[frame.id] === "object" ? c.h3Keyframes[frame.id] : {};
    const defaultNote = String(state?.action || frame.description || frame.title || "").trim();
    return { frame, take, state, saved, note: String(saved.note ?? defaultNote), sourceIndex: index };
  }).filter(Boolean);
  const validIds = new Set(rows.map((row) => String(row.frame.id)));
  const order = c.h3KeyframeOrder.filter((id) => validIds.has(id));
  for (const row of rows) if (!order.includes(String(row.frame.id))) order.push(String(row.frame.id));
  c.h3KeyframeOrder = order;
  const orderIndex = new Map(order.map((id, index) => [id, index]));
  const ordered = rows.sort((a, b) => orderIndex.get(String(a.frame.id)) - orderIndex.get(String(b.frame.id)));
  return ordered.map((row, index) => ({
    ...row,
    index,
    // New sequences start conservatively with the first and last approved
    // frames. Testers opt into intermediate waypoints deliberately instead of
    // silently sending every approved still (and potentially incurring extra
    // reference charges).
    enabled: row.saved.enabled == null ? (index === 0 || index === ordered.length - 1) : row.saved.enabled !== false,
  }));
}
function guidedH3KeyframePanel(s, profile) {
  if (profile?.family !== "minimax-h3" || profile.mode !== "r2v") return "";
  const c = ensureH3KeyframePlan(s), rows = h3ApprovedFrameRows(s);
  const enabled = rows.filter((row) => row.enabled).slice(0, 9);
  const activeNumbers = new Map(enabled.map((row, index) => [String(row.frame.id), index + 1]));
  return `<section class="h3-keyframe-panel"><header><div><span>MINIMAX H3 · MULTI-FRAME INPUT</span><b>${enabled.length} sequential keyframe${enabled.length === 1 ? "" : "s"}</b><small>CineBraid starts with the first and last approved frames selected. Add intermediate waypoints deliberately, reorder up to nine, and describe the beat each frame represents. Active images are sent to FAL in this exact order as Image 1, Image 2, and onward.</small></div><span class="guided-mode-pill ${enabled.length > 1 ? "ready" : ""}">${enabled.length}/9 ACTIVE</span></header><div class="h3-keyframe-sequence">${rows.map((row, index) => { const activeNumber = activeNumbers.get(String(row.frame.id)); return `<article class="${row.enabled && activeNumber ? "enabled" : "disabled"}"><div class="h3-keyframe-image"><img src="${attr(row.take.url)}" alt="Frame ${esc(row.frame.label)}"><span>${activeNumber ? `IMAGE ${activeNumber}` : "NOT SENT"}</span></div><div><div class="h3-keyframe-row-head"><label class="checkline"><input type="checkbox" ${row.enabled && activeNumber ? "checked" : ""} onchange="setH3KeyframeEnabled('${s.id}','${row.frame.id}',this.checked)"> Use as sequential keyframe</label><div class="h3-order-actions"><button class="chip" onclick="moveH3Keyframe('${s.id}','${row.frame.id}',-1)" ${index === 0 ? "disabled" : ""} aria-label="Move Frame ${esc(row.frame.label)} earlier">↑</button><button class="chip" onclick="moveH3Keyframe('${s.id}','${row.frame.id}',1)" ${index === rows.length - 1 ? "disabled" : ""} aria-label="Move Frame ${esc(row.frame.label)} later">↓</button></div></div><b>Frame ${esc(row.frame.label)}</b><textarea placeholder="What exact beat should this keyframe represent?" onchange="setH3KeyframeNote('${s.id}','${row.frame.id}',this.value)">${esc(row.note)}</textarea></div></article>`; }).join("") || `<div class="guided-empty-inline"><b>No approved frames yet.</b><span>Approve at least two frames to build a multi-frame H3 sequence.</span></div>`}</div><label class="h3-sequence-note"><span>Sequence / transition direction</span><textarea placeholder="How should H3 move between the frames? Mention transition language, pacing, holds, cuts, camera continuity, or effects." onchange="setH3SequenceNote('${s.id}',this.value)">${esc(c.h3SequenceNote || "")}</textarea></label><div class="h3-keyframe-note"><b>How this works on FAL</b><span>H3 Reference to Video accepts up to 9 images. CineBraid sends only active frames, renumbers them continuously by the order above, and writes an explicit sequential-keyframe contract into the prompt.</span></div></section>`;
}
window.setH3KeyframeEnabled = (shotId, frameId, enabled) => {
  const s = shotById(shotId), c = s && ensureH3KeyframePlan(s);
  if (!s || !c) return;
  c.h3Keyframes[frameId] = c.h3Keyframes[frameId] && typeof c.h3Keyframes[frameId] === "object" ? c.h3Keyframes[frameId] : {};
  if (enabled && h3ApprovedFrameRows(s).filter((row) => row.enabled && String(row.frame.id) !== String(frameId)).length >= 9) {
    c.h3Keyframes[frameId].enabled = false;
    toast("MiniMax H3 accepts up to 9 image references. Disable another keyframe first.");
  } else c.h3Keyframes[frameId].enabled = !!enabled;
  dirty(); route();
};
window.moveH3Keyframe = (shotId, frameId, direction) => {
  const s = shotById(shotId), c = s && ensureH3KeyframePlan(s);
  if (!s || !c) return;
  h3ApprovedFrameRows(s);
  const from = c.h3KeyframeOrder.indexOf(String(frameId));
  const to = Math.max(0, Math.min(c.h3KeyframeOrder.length - 1, from + Number(direction || 0)));
  if (from < 0 || from === to) return;
  const [moved] = c.h3KeyframeOrder.splice(from, 1);
  c.h3KeyframeOrder.splice(to, 0, moved);
  dirty(); route();
};
window.setH3KeyframeNote = (shotId, frameId, note) => {
  const s = shotById(shotId), c = s && ensureH3KeyframePlan(s);
  if (!s || !c) return;
  c.h3Keyframes[frameId] = c.h3Keyframes[frameId] && typeof c.h3Keyframes[frameId] === "object" ? c.h3Keyframes[frameId] : {};
  c.h3Keyframes[frameId].note = String(note || "");
  dirty();
};
window.setH3SequenceNote = (shotId, note) => {
  const s = shotById(shotId), c = s && ensureH3KeyframePlan(s);
  if (!s || !c) return;
  c.h3SequenceNote = String(note || "");
  dirty();
};

function guidedMotionReferences(s, current, profile) {
  const frames = guidedFrames(s), takes = takesFor(s.id);
  if (profile?.family === "minimax-h3" && profile.mode === "r2v") {
    const keyframes = h3ApprovedFrameRows(s).filter((row) => row.enabled).slice(0, 9);
    const refs = keyframes.map((row, index) => ({
      key: `h3-keyframe:${s.id}:${row.frame.id}:${row.take.name}`,
      label: `Sequential keyframe ${index + 1} · Frame ${row.frame.label}`,
      url: row.take.url,
      role: "sequential-keyframe",
      mediaType: "image",
      approved: true,
      instruction: [`Temporal waypoint ${index + 1} of ${keyframes.length}.`, row.note ? `Required beat: ${row.note}.` : "Preserve this frame's approved visual state.", index === 0 ? "Use as the opening visual anchor." : index === keyframes.length - 1 ? "Resolve into this final visual beat." : "Pass through this beat naturally without freezing into a slideshow."].join(" "),
    }));
    const usedUrls = new Set(refs.map((ref) => ref.url));
    const imageRefs = compositionAugmentedReferences(s, shotCreationReferences(s))
      .filter((ref) => ref.url && !usedUrls.has(ref.url) && shotInputEnabled(s, ref.key))
      .map((ref) => ({ ...ref, mediaType: "image" }));
    const audioPlan = ensureShotCreation(s).motionPlan.audio || {};
    const linkedRefs = shotPlanningGenerationReferences(s, ["video", "audio"])
      .filter((ref) => ref.url && shotInputEnabled(s, ref.key))
      .map((ref) => ref.key === audioPlan.referenceKey && audioPlan.mode === "lip-sync-reference" ? { ...ref, role: "audio-timing", priority: "primary", instruction: [`Dialogue recording for ${P.characters.find((item) => item.id === audioPlan.speakerId)?.name || audioPlan.speakerId || "the selected character"}.`, "Use this file for direct lip synchronization; preserve its recorded voice and timing, and do not generate a second voice.", ref.instruction].filter(Boolean).join(" ") } : ref);
    const selected = [...refs];
    let images = refs.length, videos = 0, audio = 0;
    for (const ref of [...imageRefs, ...linkedRefs]) {
      const kind = ref.mediaType || (isVideo(ref.url || "") ? "video" : /\.(wav|mp3|m4a|ogg)(?:$|[?#])/i.test(ref.url || "") ? "audio" : "image");
      if (selected.length >= 12) break;
      if (kind === "image" && images < 9) { selected.push({ ...ref, mediaType: "image" }); images++; }
      else if (kind === "video" && videos < 3) { selected.push({ ...ref, mediaType: "video" }); videos++; }
      else if (kind === "audio" && audio < 3) { selected.push({ ...ref, mediaType: "audio" }); audio++; }
    }
    return selected;
  }
  /* Text-to-video carries no reference media on any H3 endpoint, so there is nothing
     to gather and no opening frame to require. */
  if (profile?.mode === "t2v" || !current) return [];
  const first = { key: `shot-start:${s.id}:${current.name}`, label: "Approved first frame", url: current.url, role: "first-frame", mediaType: "image", approved: true, instruction: "Use as the approved opening composition. Preserve its geometry, identity, lighting, and continuity unless the motion direction explicitly changes them." };
  const refs = [first];
  const lastFrameIndex = [...frames.keys()].reverse().find((index) => index > 0 && guidedFrameApproved(s, frames[index], takes, index));
  if (lastFrameIndex != null && ["flf", "r2v", "audio-video"].includes(profile?.mode)) {
    const take = guidedFrameApproved(s, frames[lastFrameIndex], takes, lastFrameIndex);
    refs.push({ key: `shot-last:${frames[lastFrameIndex].id}:${take.name}`, label: `Approved Frame ${frames[lastFrameIndex].label}`, url: take.url, role: "last-frame", mediaType: "image", approved: true, instruction: `Use as the approved endpoint composition when the selected model supports endpoint guidance. Preserve identity and environment continuity.` });
  }
  if (!profile || ["i2v", "flf"].includes(profile.mode)) return refs;
  const imageRefs = compositionAugmentedReferences(s, shotCreationReferences(s))
    .filter((ref) => ref.url && ref.url !== current.url && shotInputEnabled(s, ref.key))
    .map((ref) => ({ ...ref, mediaType: "image" }));
  const audioPlan = ensureShotCreation(s).motionPlan.audio || {};
  const linkedRefs = shotPlanningGenerationReferences(s, ["video", "audio"])
    .filter((ref) => ref.url && shotInputEnabled(s, ref.key))
    .map((ref) => ref.key === audioPlan.referenceKey && audioPlan.mode === "lip-sync-reference" ? { ...ref, role: "audio-timing", priority: "primary", instruction: [`Dialogue recording for ${P.characters.find((item) => item.id === audioPlan.speakerId)?.name || audioPlan.speakerId || "the selected character"}.`, "Use this file for direct lip synchronization; preserve its recorded voice and timing, and do not generate a second voice.", ref.instruction].filter(Boolean).join(" ") } : ref)
    .sort((a,b) => (a.key === audioPlan.referenceKey ? -1 : 0) - (b.key === audioPlan.referenceKey ? -1 : 0));
  const max = profile.limits?.maxReferences || 8;
  const maxImages = profile.limits?.maxImages ?? max;
  const maxAudio = profile.limits?.maxAudio ?? (profileSupportsGuidedAudio(profile) ? 3 : 0);
  const maxVideo = profile.limits?.maxVideos ?? 3;
  let images = refs.filter((ref) => ref.mediaType === "image").length, audio = 0, video = 0;
  return [...refs, ...imageRefs, ...linkedRefs].filter((ref, index) => {
    if (index < refs.length) return true;
    if (ref.mediaType === "audio") return audio++ < maxAudio;
    if (ref.mediaType === "video") return video++ < maxVideo;
    return images++ < maxImages;
  }).slice(0, max);
}
/* THE CEILING THIS EDITOR MAY REFUSE AT.
 *
 * This modal edits the text that will be DISPATCHED, so the number it enforces has to
 * be the one the request is really held to — not CineBraid's own budget for the
 * written package, and never a number keyed on a family name.
 *
 * It used to return a hard-coded 2,000 for `minimax-h3` and label it "current MiniMax
 * H3 FAL limit". That number is retired: `fal-h3-backend.js` records that fal's queue
 * schema documents no prompt maxLength on any of the three H3 endpoints and that both
 * fal and MiniMax state 7,000 characters. So the same prompt read 1,991/2,000 here and
 * 4,894/7,000 in the paid dialog, and this editor THREW on direction the provider
 * would have accepted — a stale refusal costing the filmmaker the words they wrote.
 *
 * The model's published ceiling is declared per profile in data/model-profiles.json
 * and agrees with the model ∩ backend capability the paid dialog resolves. Read it
 * from there; fall back to the written-package budget only where no ceiling is
 * recorded. */
function motionPromptCharacterLimit(build) {
  const limits = guidedVideoProfiles().find((item) => item.id === build?.profileId)?.limits || {};
  const published = Number(limits.publishedGuidePromptCharacters);
  if (Number.isFinite(published) && published > 0) return published;
  const budget = Number(limits.maxPromptCharacters);
  return Number.isFinite(budget) && budget > 0 ? budget : 12000;
}
function createManualMotionPromptRevision(shotId, buildId, prompt, reason = "") {
  const s = shotById(shotId), c = s && ensureShotCreation(s);
  if (!s || !c) throw new Error("Shot is unavailable");
  const source = resolvePromptBuildList(P, c.motionPromptBuilds || []).find((item) => item.id === buildId);
  if (!source?.prompt) throw new Error("Source motion prompt is unavailable");
  const edited = String(prompt || "").trim();
  if (!edited) throw new Error("Motion prompt cannot be empty");
  const limit = motionPromptCharacterLimit(source);
  if (edited.length > limit) throw new Error(`${source.profileName || source.profileId || "This model"} allows a maximum of ${limit.toLocaleString()} prompt characters in CineBraid.`);
  if (edited === String(source.prompt || "").trim()) return source;
  const sequence = (c.motionPromptBuilds || []).length + 1;
  const packageId = `${shotId}-MOTION-R${String(sequence).padStart(2, "0")}`;
  const revised = JSON.parse(JSON.stringify(source));
  revised.id = `guided-motion-manual-${Date.now().toString(36)}`;
  revised.packageId = packageId;
  revised.date = new Date().toISOString();
  revised.prompt = edited;
  revised.parentBuildId = source.id;
  revised.parentPackageId = source.packageId || "";
  revised.revision = sequence;
  revised.manualEdited = true;
  revised.editReason = String(reason || "Manual prompt adjustment before generation").trim();
  revised.llmUsed = false;
  revised.providerPayload = revised.providerPayload && typeof revised.providerPayload === "object"
    ? { ...revised.providerPayload, prompt: edited, parentBuildId: source.id, manualEdited: true }
    : revised.providerPayload;
  const revisionNote = `Manual revision of ${source.packageId || source.id}. The compiled source prompt remains preserved in history.`;
  revised.confirmations = [...(source.confirmations || []), revisionNote];
  const revisedId = registerPromptBuild(P, revised);
  c.motionPromptBuilds = Array.isArray(c.motionPromptBuilds) ? c.motionPromptBuilds : [];
  c.motionPromptBuilds.push(promptBuildRef(revisedId, { kind: "guided-motion", revisionReason: "manual-edit" }));
  c.lastMotionPackageId = packageId;
  const unit = (s.clips || []).find((item) => Array.isArray(item.generationPackages) && item.generationPackages.some((entry) => entryBuildId(entry) === source.id));
  if (unit) {
    unit.generationPackages = Array.isArray(unit.generationPackages) ? unit.generationPackages : [];
    unit.generationPackages.push(promptBuildRef(revisedId, { kind: "guided-motion", scope: `segment:${unit.id || unit.suffix || ""}`, revisionReason: "manual-edit" }));
  }
  applyPromptBuildRetention(P);
  dirty();
  return resolvePromptBuild(P, promptBuildRef(revisedId, { kind: "guided-motion" }));
}
window.createManualMotionPromptRevision = createManualMotionPromptRevision;
window.updateGuidedMotionPromptEditor = () => {
  const draft = window._guidedMotionPromptEditDraft || {};
  const value = String(document.getElementById("guided-motion-prompt-editor")?.value || "");
  const limit = Number(draft.limit || 12000);
  const count = document.getElementById("guided-motion-prompt-editor-count");
  const save = document.getElementById("guided-motion-prompt-editor-save");
  if (count) {
    count.textContent = `${value.length.toLocaleString()}/${limit.toLocaleString()}`;
    count.classList.toggle("over", value.length > limit);
  }
  if (save) save.disabled = !value.trim() || value.length > limit || value.trim() === String(draft.originalPrompt || "").trim();
};
window.resetGuidedMotionPromptEditor = () => {
  const draft = window._guidedMotionPromptEditDraft || {};
  const editor = document.getElementById("guided-motion-prompt-editor");
  if (editor) editor.value = draft.originalPrompt || "";
  updateGuidedMotionPromptEditor();
};
window.openGuidedMotionPromptEditor = (shotId, buildId) => {
  const s = shotById(shotId), c = s && ensureShotCreation(s);
  const build = c && resolvePromptBuildList(P, c.motionPromptBuilds || []).find((item) => item.id === buildId);
  if (!build?.prompt) return toast("Motion prompt is unavailable");
  const limit = motionPromptCharacterLimit(build);
  window._guidedMotionPromptEditDraft = { shotId, buildId, originalPrompt: build.prompt, limit };
  openModal(`<div class="motion-prompt-editor-modal"><header><div><span>MANUAL PROMPT REVISION</span><h3>Edit motion prompt</h3><p>The compiled prompt remains preserved. Saving creates a new revision linked to ${esc(build.packageId || build.id)}.</p></div><button class="cancel" onclick="closeModal()">Close</button></header><label class="motion-prompt-editor-field"><span>Prompt sent to the video model</span><textarea id="guided-motion-prompt-editor" oninput="updateGuidedMotionPromptEditor()">${esc(build.prompt)}</textarea><small><b id="guided-motion-prompt-editor-count">${build.prompt.length.toLocaleString()}/${limit.toLocaleString()}</b> characters${build.profileName ? ` · ${esc(String(build.profileName).replace(/^.*?—\s*/, ""))} accepts ${limit.toLocaleString()}` : ""}</small></label><label class="motion-prompt-edit-reason"><span>Revision note · optional</span><input id="guided-motion-prompt-edit-reason" placeholder="Adjusted timing, removed duplicate action, clarified camera move…"></label><p class="hint">This does not change the shot brief, approved frames, or original compiled package. It creates a traceable prompt revision that can be copied, downloaded, or generated.</p><footer class="modal-actions"><button class="ghost-btn" onclick="resetGuidedMotionPromptEditor()">Reset compiled prompt</button><button class="cancel" onclick="closeModal()">Cancel</button><button id="guided-motion-prompt-editor-save" class="approve-btn large" onclick="saveGuidedMotionPromptRevision()" disabled>SAVE AS NEW REVISION</button></footer></div>`);
  setTimeout(updateGuidedMotionPromptEditor, 0);
};
window.saveGuidedMotionPromptRevision = () => {
  const draft = window._guidedMotionPromptEditDraft || {};
  const prompt = document.getElementById("guided-motion-prompt-editor")?.value || "";
  const reason = document.getElementById("guided-motion-prompt-edit-reason")?.value || "";
  try {
    const revised = createManualMotionPromptRevision(draft.shotId, draft.buildId, prompt, reason);
    closeModal();
    route();
    toast(revised?.manualEdited ? "Manual motion prompt revision saved" : "Prompt is unchanged");
  } catch (error) {
    toast("Could not save motion prompt revision: " + error.message);
  }
};
function guidedMotionPromptResult(s, build) {
  const changed = build.improvedDirective && build.improvedDirective.trim() !== (build.originalDirective || "").trim();
  const profile = guidedVideoProfiles().find((item) => item.id === build.profileId);
  const inputSummary = profile?.family === "minimax-h3" && profile.mode === "r2v"
    ? `${(build.references || []).filter((ref) => ref.role === "sequential-keyframe").length} sequential keyframe${(build.references || []).filter((ref) => ref.role === "sequential-keyframe").length === 1 ? "" : "s"} · ${build.references?.length || 0} total input${build.references?.length === 1 ? "" : "s"}`
    : profile?.mode === "r2v"
      ? `${build.references?.length || 0} assigned reference${build.references?.length === 1 ? "" : "s"}`
      : `Approved frame${(build.references?.length || 1) > 1 ? "s" : ""} packaged · ${build.references?.length || 1} input${build.references?.length === 1 ? "" : "s"}`;
  const revision = changed
    ? `<details class="guided-motion-revision-details"><summary>Review revised motion direction</summary><div class="guided-motion-revision"><div><span>CLEAN SOURCE DIRECTION</span><p>${esc(build.originalDirective || "")}</p></div><div><span>REVISED MOTION DIRECTION</span><p>${esc(build.improvedDirective || "")}</p>${build.improvementNotes?.length ? `<ul>${build.improvementNotes.map((note) => `<li>${esc(note)}</li>`).join("")}</ul>` : ""}<button class="chip" onclick="acceptGuidedMotionRevision('${s.id}','${build.id}')">REPLACE MOTION BRIEF</button></div></div></details>`
    : build.sourceDirectiveSanitized
      ? `<div class="guided-prompt-recovery">Legacy compiler boilerplate was removed from the saved motion brief before this prompt was built.</div>`
      : "";
  const h3Action = typeof falH3MotionPromptAction === "function" ? falH3MotionPromptAction(s.id, build.id, profile) : "";
  const h3Job = typeof falH3MotionInline === "function" && profile?.family === "minimax-h3" ? falH3MotionInline(s.id) : "";
  /* A built prompt for a target CineBraid cannot send used to arrive with no Generate
     button and no sentence — the dead end the audit found. The prompt is still
     genuinely useful somewhere else, so it is kept and the refusal is stated beside
     it, naming a target that is wired. */
  const unsupported = guidedVideoProfileRefusalMarkup(profile);
  return `<article class="guided-prompt-result motion ${profile?.family === "minimax-h3" ? "h3" : ""}"><header><div><span>READY-TO-USE MOTION PROMPT</span><b>${esc(build.profileName || build.profileId)}</b><small>${esc(inputSummary)}${build.durationSeconds ? ` · ${build.durationSeconds}s` : ""}${build.packageId ? ` · ${esc(build.packageId)}` : ""}${build.manualEdited ? " · MANUAL REVISION" : ""}</small></div><div>${h3Action}<button class="ghost-btn motion-prompt-edit-btn" onclick="openGuidedMotionPromptEditor('${s.id}','${build.id}')">EDIT PROMPT</button><button class="copy-btn" onclick="copyText(${JSON.stringify(build.prompt || "").replace(/"/g, "&quot;")})">COPY</button><button class="chip" onclick="downloadGuidedMotionPrompt('${s.id}','${build.id}')">Download</button></div></header>${unsupported}${h3Job}<pre class="guided-ready-motion-prompt">${esc(build.prompt || "")}</pre>${revision}${guidedPromptWarningsMarkup(build.warnings)}${guidedProductionRisksMarkup(build.productionRisks)}</article>`;
}
function guidedMotionCandidatePanel(s, takes, approved) {
  const videos = takes.filter((take) => isVideo(take.name));
  const videoPage = boundedPage(videos, "candidates", `shot:${s.id}:videos`, BOUNDED_PAGE_SIZES.candidates);
  return `<section class="guided-motion-results motion-workflow-section" id="motion-results-${attr(s.id)}"><div class="motion-section-heading"><span>2 · RETURNED VIDEO</span><div><b>Review and approve the motion result</b><small>Upload generated footage or a video completed elsewhere. Open any result in the larger in-app player before approval.</small></div><i>${videos.length} VIDEO${videos.length === 1 ? "" : "S"}</i></div><div class="guided-video-grid bounded-source-section">${videoPage.rows.map((take) => { const active = approved?.name === take.name; const row = candidateRecord(s, take.name); const previewCall = `openMediaTheatre('${attr(encodeURIComponent(take.url))}','${attr(encodeURIComponent(take.name))}','video')`; return `<article class="${active ? "approved" : ""}"><div class="guided-video-player"><video controls preload="metadata" src="${attr(take.url)}#t=0.1"></video><button class="media-enlarge-btn" onclick="${previewCall}">Larger preview</button></div><div><b>${esc(take.name)}</b><small>${active ? "Approved motion" : row.sourcePackageId ? `Linked to ${esc(row.sourcePackageLabel || row.sourcePackageId)}` : "Imported video"}</small></div><div>${active ? `<span>✓ APPROVED</span>` : `<button class="approve-btn" onclick="approveGuidedMotion('${s.id}','${attr(take.name)}')">APPROVE VIDEO</button>`}<button class="chip" onclick="queueGuidedVideoFinish('${s.id}','${attr(take.name)}')">UPSCALE / FINISH</button></div></article>`; }).join("") || `<div class="guided-empty-inline"><b>No video uploaded.</b><span>Motion prompting is optional. Drop an existing finished video here at any time.</span></div>`}</div>${boundedPagerMarkup("candidates",`shot:${s.id}:videos`,videoPage,"video candidates")}<div class="dropzone dropzone-lg guided-dropzone" id="motion-dropzone">DROP OR CHOOSE A VIDEO<input type="file" id="motion-file" multiple accept="video/*" style="display:none"></div></section>`;
}

function guidedProfileAcceptsAudioReference(profile) {
  return !!profile?.supports?.audio && (
    profile.refSyntax === "typed-omni" ||
    profile.mode === "audio-video" ||
    Number(profile.limits?.maxAudio || 0) > 0
  );
}
function guidedAudioPanel(s, c, profile, audioRefs) {
  s.audio = s.audio && typeof s.audio === "object" ? s.audio : {};
  const plan = c.motionPlan.audio || {};
  const mode = plan.mode || (plan.lipSync ? "lip-sync-reference" : s.audio.line ? "generate-voice" : "none");
  const acceptsReference = guidedProfileAcceptsAudioReference(profile);
  const supportsAudio = !!profile?.supports?.audio;
  const legacySuggestion = !s.audio.line ? quotedLineSuggestion(s.audio.vo) : "";
  const speakerOptions = (s.characters || []).map((charId) => {
    const char = P.characters.find((item) => item.id === charId);
    return `<option value="${attr(charId)}" ${String(plan.speakerId || s.audio.speakerId || "") === String(charId) ? "selected" : ""}>${esc(char?.name || charId)}</option>`;
  }).join("");
  const voiceOptions = (P.audio || []).map((voice) => `<option value="${attr(voice.id)}" ${String(plan.voiceEntityId || s.audio.voiceEntityId || "") === String(voice.id) ? "selected" : ""}>${esc(voice.name || voice.id)}${voice.cleanMaster ? " · clean master" : ""}${voice.sameObjectAs ? ` · same source as ${esc(voice.sameObjectAs)}` : ""}</option>`).join("");
  const profileNote = !supportsAudio
    ? `${profile?.name || "This target"} does not support native dialogue audio. CineBraid will warn that post-production lip sync is required.`
    : mode === "lip-sync-reference" && !acceptsReference
      ? `${profile?.name || "This target"} can generate audio but cannot consume the selected recording as a native timing reference.`
      : mode === "lip-sync-reference"
        ? "The assigned recording drives the voice, words, cadence, and mouth timing. CineBraid will not ask the model to generate a second voice."
        : mode === "generate-voice"
          ? "The literal Spoken line is locked. Improve may refine delivery direction, but it cannot rewrite the words or change the speaker/audio mode."
          : "No speech-generation instruction will be added.";
  return `<details class="guided-audio-block" ${guidedPanelOpen(s, "motionAudio", false) ? "open" : ""} ontoggle="rememberGuidedPanel('${s.id}','motionAudio',this.open)"><summary>Dialogue & voice <span>${audioRefs.length} linked</span></summary>
    <div class="guided-dialogue-grid">
      <label class="wide"><span>Spoken line — exact words</span><textarea onchange="setShotAudioField('${s.id}','line',this.value)" placeholder="Only the literal words the character says. Production notes never belong here.">${esc(s.audio.line || "")}</textarea></label>
      ${legacySuggestion ? `<div class="legacy-line-suggestion wide"><span>Legacy VO note contains a quoted line: “${esc(legacySuggestion)}”</span><button class="chip" onclick="acceptLegacyShotLineSuggestion('${s.id}')">COPY TO SPOKEN LINE</button></div>` : ""}
      <label><span>Who says it?</span><select onchange="setShotAudioField('${s.id}','speakerId',this.value);setSimpleMotionAudio('${s.id}','speakerId',this.value)"><option value="">Select character</option>${speakerOptions}</select></label>
      <label><span>Voice recording / identity</span><select onchange="setShotAudioField('${s.id}','voiceEntityId',this.value);setSimpleMotionAudio('${s.id}','voiceEntityId',this.value)"><option value="">No voice reference selected</option>${voiceOptions}</select></label>
      <label class="wide"><span>Production note — never quoted</span><textarea onchange="setShotAudioField('${s.id}','note',this.value)" placeholder="Clean master, degradation in post, editorial routing, line-read context…">${esc(s.audio.note || s.audio.vo || "")}</textarea></label>
      <label class="wide"><span>SFX / ambience</span><input value="${attr(s.audio.sfx || "")}" onchange="setShotAudioField('${s.id}','sfx',this.value)" placeholder="Room tone, effects, ambience, synchronization cues…"></label>
    </div>
    <div class="guided-audio-grid">
      <label><span>Speech workflow</span><select onchange="setSimpleMotionAudio('${s.id}','mode',this.value)">
        <option value="none" ${mode === "none" ? "selected" : ""}>No generated speech</option>
        <option value="generate-voice" ${mode === "generate-voice" ? "selected" : ""}>Generate voice from spoken line</option>
        <option value="lip-sync-reference" ${mode === "lip-sync-reference" ? "selected" : ""}>Lip-sync to an audio reference</option>
      </select></label>
      <label><span>Dialogue recording</span><select ${mode !== "lip-sync-reference" || !acceptsReference ? "disabled" : ""} onchange="setSimpleMotionAudio('${s.id}','referenceKey',this.value)"><option value="">None</option>${audioRefs.map((ref) => `<option value="${attr(ref.key)}" ${plan.referenceKey === ref.key ? "selected" : ""}>${esc(ref.label)}</option>`).join("")}</select></label>
      <label class="wide"><span>Delivery direction</span><input value="${attr(plan.direction || "")}" onchange="setSimpleMotionAudio('${s.id}','direction',this.value)" placeholder="restrained, urgent, whispered…"></label>
    </div>
    <div class="guided-audio-mode-note">${esc(profileNote)}</div>
  </details>`;
}

function guidedMotionPanel(s, current, takes, open = false) {
  const c = ensureShotCreation(s), approved = guidedApprovedMotion(s, takes), progress = guidedFrameProgress(s, takes), frames = progress.frames;
  const unit = (s.clips || [])[0], supportedKinds = ["i2v", "flf", "r2v", "audio-video"], complex = (s.clips || []).length > 1 || (unit && !supportedKinds.includes(unit.kind));
  const direction = c.motionDirection || unit?.motionPrompt || s.motionPrompt || "";
  const profileId = preferredGuidedVideoProfile(c.motionProfileId || ""), profile = guidedVideoProfiles().find((item) => item.id === profileId);
  const duration = guidedClampedMotionDuration(c.motionDuration || unit?.dur || 5, profile);
  const [durationMin, durationMax] = guidedMotionDurationBounds(profile);
  const latest = latestPromptBuild(P, c.motionPromptBuilds), audioRefs = shotPlanningGenerationReferences(s, ["audio"]).filter((ref) => shotInputEnabled(s, ref.key));
  const videos = takes.filter((take) => isVideo(take.name));
  const approvedFrames = frames.map((frame, index) => ({ frame, take: guidedFrameApproved(s, frame, takes, index) })).filter((item) => item.take);
  if (!progress.requiredApproved && !videos.length) return `<details class="guided-work-panel guided-motion-card locked" data-guided-panel="motion"><summary><div><span>MOTION · OPTIONAL</span><b>Approve required frames first</b><small>Motion opens after the first frame and any required additional frames are approved.</small></div><span class="guided-mode-pill">LOCKED</span><i>⌄</i></summary></details>`;
  const label = approved ? "Approved video ready" : videos.length ? `${videos.length} video${videos.length === 1 ? "" : "s"} to review` : approvedFrames.length > 1 ? `Animate between ${approvedFrames.length} approved frames` : "Animate the approved first frame";
  const operation = guidedPromptOp("motion", s.id);
  const busy = operation?.status === "busy";
  const busyLabel = operation?.action || "";
  const operationBody = busy
    ? assistantWorkingCard(busyLabel === "improve" ? `Adapting motion and audio for ${profile?.name || profileId}…` : "Compiling the motion prompt…", busyLabel === "improve" ? "The assistant may take up to three minutes per attempt. It is preserving the approved frame while cleaning chronology, motion, and supplied audio intent." : "The deterministic compiler is formatting the motion plan for the selected video target.", { mode: busyLabel === "improve" ? "assistant" : "compile" })
    : operation?.status === "error"
      ? guidedPromptErrorMarkup(operation.error, `buildGuidedMotionPrompt('${s.id}',${busyLabel === "improve" ? "true" : "false"})`)
      : `<div class="guided-motion-result-slot">${latest ? guidedMotionPromptResult(s, latest) : `<div class="guided-next-note"><b>Optional:</b> build a motion prompt when you need help creating another video.</div>`}</div>`;
  return `<details id="guided-motion-workspace-${attr(s.id)}" class="guided-work-panel guided-motion-card" data-guided-panel="motion" ${guidedPanelOpen(s, "motion", open) ? "open" : ""} ontoggle="rememberGuidedPanel('${s.id}','motion',this.open)"><summary><div><span>MOTION · OPTIONAL</span><b>${esc(label)}</b><small>Attach an existing video or audio first; assisted motion tools remain optional.</small></div><span class="guided-mode-pill ${approved ? "ready" : ""}">${approved ? "APPROVED" : approvedFrames.length > 1 ? `${approvedFrames.length} FRAMES READY` : "START FRAME READY"}</span><i>⌄</i></summary><div class="guided-work-panel-body">${c.automationReadyForMotion ? `<div class="automation-motion-ready"><span>STILL AUTOMATION COMPLETE</span><b>${approvedFrames.length > 1 ? `${approvedFrames.length} approved frames are ready for a first/last-frame or multi-frame video.` : "The approved start frame is ready for image-to-video."}</b><small>Choose the video target, direct motion, build or improve the motion prompt, then generate the video manually. Motion is never submitted by the still-automation runner.</small></div>` : ""}<nav class="motion-workflow-map" aria-label="Motion workflow sections"><button type="button" onclick="scrollGuidedMotionSection('${attr(s.id)}','frames')"><span>1</span><b>Approved frames</b><small>${approvedFrames.length} ready</small></button><button type="button" onclick="scrollGuidedMotionSection('${attr(s.id)}','results')"><span>2</span><b>Returned video</b><small>${videos.length} result${videos.length === 1 ? "" : "s"}</small></button><button type="button" onclick="scrollGuidedMotionSection('${attr(s.id)}','create')"><span>3</span><b>Create motion</b><small>${esc(profile?.name || profileId)}</small></button></nav><section class="motion-workflow-section approved-motion-frames" id="motion-frames-${attr(s.id)}"><div class="motion-section-heading"><span>1 · APPROVED FRAMES</span><div><b>Choose the visual anchors for motion</b><small>Click any frame to inspect it at a useful size. H3 keyframes and first/last-frame packages use these approved images.</small></div><i>${approvedFrames.length} READY</i></div><div class="guided-motion-frame-strip">${approvedFrames.map(({frame,take}, index) => { const title = `Frame ${frame.label} · ${take.name}`; return `<article><button type="button" class="guided-motion-frame-preview" onclick="openMediaTheatre('${attr(encodeURIComponent(take.url))}','${attr(encodeURIComponent(title))}','image')" aria-label="View approved Frame ${esc(frame.label)} larger"><img src="${attr(take.url)}" alt="Approved Frame ${esc(frame.label)}"><span>${index === 0 ? "START" : index === approvedFrames.length - 1 ? "END" : `FRAME ${esc(frame.label)}`}</span><em>View larger</em></button><b>Frame ${esc(frame.label)}</b></article>`; }).join("")}</div>${guidedH3KeyframePanel(s, profile)}</section>${guidedMotionCandidatePanel(s, takes, approved)}<section class="motion-workflow-section motion-create-section" id="motion-create-${attr(s.id)}"><div class="motion-section-heading"><span>3 · ASSISTED MOTION</span><div><b>Direct movement and build the provider prompt</b><small>Open only the part you need. Existing finished video can skip this entire section.</small></div><i>OPTIONAL</i></div><details class="guided-assisted-tools motion-assisted-tools" ${guidedPanelOpen(s, "motionCreate", !manualFirstWorkflow()) ? "open" : ""} ontoggle="rememberGuidedPanel('${s.id}','motionCreate',this.open)"><summary><div><span>OPTIONAL ASSISTED CREATION</span><b>Direct motion or build a video prompt</b><small>Imported video and audio can be approved without using these tools.</small></div></summary><div class="guided-motion-main"><details class="motion-director" ${guidedPanelOpen(s, "motionDirector", false) ? "open" : ""} ontoggle="rememberGuidedPanel('${s.id}','motionDirector',this.open)"><summary>Direct motion <span>structured controls</span></summary>${motionDirectorMap(s,c)}<div class="motion-director-camera"><label><span>Camera move</span><select onchange="setMotionPlanField('${s.id}','camera','move',this.value)">${composerOptions([["locked","Locked off"],["static-handheld","Static handheld"],["pan","Pan"],["tilt","Tilt"],["push-in","Push in"],["pull-back","Pull back"],["dolly","Dolly / truck"],["arc","Arc"],["follow-subject","Follow subject"],["subtle-drift","Subtle drift"]], c.motionPlan.camera.move)}</select></label><label><span>Direction</span><select onchange="setMotionPlanField('${s.id}','camera','direction',this.value)">${composerOptions([["","Not specified"],["left","Left"],["right","Right"],["up","Up"],["down","Down"],["clockwise","Clockwise"],["counterclockwise","Counterclockwise"]], c.motionPlan.camera.direction)}</select></label><label><span>Strength</span><select onchange="setMotionPlanField('${s.id}','camera','intensity',this.value)">${composerOptions([["subtle","Subtle"],["moderate","Moderate"],["strong","Strong"]], c.motionPlan.camera.intensity)}</select></label><label><span>Style</span><select onchange="setMotionPlanField('${s.id}','camera','style',this.value)">${composerOptions([["smooth","Smooth"],["handheld","Handheld"],["documentary","Documentary"],["mechanical","Mechanical"],["floating","Floating"],["abrupt","Abrupt"]], c.motionPlan.camera.style)}</select></label><label><span>Framing</span><select onchange="setMotionPlanField('${s.id}','camera','framing',this.value)">${composerOptions([["preserve","Preserve composition"],["preserve-loosely","Preserve loosely"],["allow-reframe","Allow reframing"]], c.motionPlan.camera.framing)}</select></label></div><div class="motion-director-subjects">${motionSubjectControls(s,c)}${motionPropControls(s,c)}</div><div class="motion-director-environment"><label><span>Environment</span><select onchange="setMotionPlanField('${s.id}','environment','action',this.value)">${composerOptions([["static","Static"],["wind","Wind / fabric"],["rain","Rain"],["smoke","Smoke / steam"],["traffic","Traffic"],["crowd","Crowd background"],["light-flicker","Light flicker"],["water","Water / ripple"],["dust","Dust / atmosphere"]], c.motionPlan.environment.action)}</select></label><label><span>Intensity</span><select onchange="setMotionPlanField('${s.id}','environment','intensity',this.value)">${composerOptions([["subtle","Subtle"],["moderate","Moderate"],["strong","Strong"]], c.motionPlan.environment.intensity)}</select></label><label class="wide"><span>Environment note</span><input value="${attr(c.motionPlan.environment.notes || "")}" onchange="setMotionPlanField('${s.id}','environment','notes',this.value)" placeholder="Only distant traffic moves; foreground remains still…"></label></div><div class="motion-director-timing"><label><span>Onset</span><select onchange="setMotionPlanField('${s.id}','timing','onset',this.value)">${composerOptions([["immediate","Immediate"],["delayed","Delayed"],["gradual","Gradual"]], c.motionPlan.timing.onset)}</select></label><label><span>Pacing</span><select onchange="setMotionPlanField('${s.id}','timing','pacing',this.value)">${composerOptions([["slow","Slow"],["natural","Natural"],["brisk","Brisk"]], c.motionPlan.timing.pacing)}</select></label><label class="checkline"><input type="checkbox" ${c.motionPlan.timing.holdEnd ? "checked" : ""} onchange="setMotionPlanField('${s.id}','timing','holdEnd',this.checked)"> Hold final state</label><label class="wide"><span>Optional secondary action</span><input value="${attr(c.motionPlan.timing.secondary || "")}" onchange="setMotionPlanField('${s.id}','timing','secondary',this.value)" placeholder="A light flickers once after the character stops…"></label></div></details>${field("Additional motion direction", `<textarea class="guided-motion-editor" placeholder="Only add details not covered by the controls above." onchange="setGuidedMotionField('${s.id}','motionDirection',this.value)">${esc(direction)}</textarea>`)}<details class="guided-inline-defaults motion-defaults"><summary>Motion defaults: ${esc(String(c.motionIntensity || "subtle").replace(/-/g," "))}${c.preserveComposition ? " · preserve composition" : ""}</summary><div class="guided-motion-detail-grid"><label><span>Overall intensity</span><select onchange="setGuidedMotionField('${s.id}','motionIntensity',this.value)">${["nearly-still","subtle","moderate","active","highly-dynamic"].map((x) => `<option value="${x}" ${c.motionIntensity === x ? "selected" : ""}>${x.replace(/-/g," ")}</option>`).join("")}</select></label><label class="checkline"><input type="checkbox" ${c.preserveComposition ? "checked" : ""} onchange="setGuidedMotionField('${s.id}','preserveComposition',this.checked)"> Preserve composition and identity</label></div></details>${guidedAudioPanel(s,c,profile,audioRefs)}<div class="guided-motion-controls"><label><span>Duration</span><input type="number" min="${durationMin}" max="${durationMax}" value="${duration}" onchange="setGuidedMotionField('${s.id}','motionDuration',+this.value)"><small>${durationMin}–${durationMax}s for this target${profile?.mode === "r2v" ? "; use chained clips for longer shots" : ""}</small></label><label class="guided-video-target-control"><span>Video model and workflow</span><select ${busy ? "disabled" : ""} onchange="setGuidedMotionField('${s.id}','motionProfileId',this.value)">${guidedVideoProfileOptions(profileId)}</select><small>${guidedVideoProfileCount()} of ${guidedVideoProfiles().length} written-up targets can be generated from CineBraid today. The rest stay listed, and say why they cannot run.</small></label>${guidedVideoProfileRefusalMarkup(profile)}<div><button class="assemble-btn" ${busy ? "disabled" : ""} onclick="buildGuidedMotionPrompt('${s.id}',false)">${busy ? `<span class="spin">◌</span> WORKING…` : "Build prompt"}</button><button class="ghost-btn" ${busy ? "disabled" : ""} onclick="buildGuidedMotionPrompt('${s.id}',true)"${aiDisabledAttrs("text")}>${busy ? `<span class="spin">◌</span> Improving…` : "Improve"}</button></div></div>${operationBody}</div></details></section></div></details>`;
}
function guidedFinishPanel(s, approved, current, open = false) {
  const c = ensureShotCreation(s), source = approved || current;
  const jobs = shotFinishJobs(s.id).filter((job) => !source || job.sourceFile === source.name || (approved && isVideo(job.sourceFile || "")));
  const isFinal = !!(c.finalVideoFile || c.finalStillFile), media = approved || current;
  return `<details class="guided-work-panel guided-finish-card" data-guided-panel="finish" ${guidedPanelOpen(s, "finish", open) ? "open" : ""} ontoggle="rememberGuidedPanel('${s.id}','finish',this.open)"><summary><div><span>FINISH & DELIVERY</span><b>${isFinal ? "Final delivery locked" : approved ? "Approved video ready to finish" : current ? "Approved still ready" : "No approved result yet"}</b><small>Upscale, repair, or mark the approved still or video final.</small></div><span class="guided-mode-pill ${isFinal ? "ready" : ""}">${isFinal ? "FINAL" : jobs.length ? `${jobs.length} JOB${jobs.length === 1 ? "" : "S"}` : "OPTIONAL"}</span><i>⌄</i></summary><div class="guided-work-panel-body">${media ? `<div class="guided-finish-current"><div class="guided-finish-preview">${isVideo(media.name) ? `<video controls preload="metadata" src="${attr(media.url)}#t=0.1"></video>` : `<button class="guided-thumb-preview" onclick="openMediaTheatre('${attr(encodeURIComponent(media.url))}','${attr(encodeURIComponent(media.name))}','image')"><img src="${attr(media.url)}" alt=""><span>View larger</span></button>`}<button class="media-enlarge-btn" onclick="openMediaTheatre('${attr(encodeURIComponent(media.url))}','${attr(encodeURIComponent(media.name))}','${isVideo(media.name) ? "video" : "image"}')">Larger preview</button></div><div><b>${esc(media.name)}</b><small>${approved ? "Approved motion take" : "Approved shot still"}</small><div><button class="ghost-btn" onclick="${approved ? `queueGuidedVideoFinish('${s.id}','${attr(media.name)}')` : `markCandidateForFinish('${s.id}','${attr(media.name)}')`}">Finish</button>${isFinal ? `<span class="prompt-check ok">Marked final</span>` : approved ? `<button class="approve-btn" onclick="markGuidedVideoFinal('${s.id}','${attr(media.name)}')">Finalize</button>` : `<button class="approve-btn" onclick="markGuidedStillFinal('${s.id}','${attr(media.name)}')">Finalize</button>`}</div></div></div>` : `<div class="guided-empty-inline"><b>No approved result yet.</b><span>Upload and approve a still or video first.</span></div>`}${jobs.length ? `<div class="guided-finish-jobs">${jobs.map((job) => `<button onclick="editFinishJob('${job.id}')"><b>${esc(job.type || "finish")}</b><span>${esc(job.status || "ready")} · ${esc(job.targetResolution || "no target set")}</span></button>`).join("")}</div>` : ""}</div></details>`;
}

/* THE AUTHORITATIVE PROJECT TRUTHS A STAGE IS DERIVED FROM, and the only thing this
   file hands the declared stage model. Every field is read fresh from the shot,
   its takes and the live automation runs; nothing is cached and nothing is stored.
   Keeping the assembly here and the judgement in public/shared-stage-model.js is
   what lets Node exercise representative shot states without a project on disk. */
function shotStageModelFacts(s, takes) {
  const progress = guidedFrameProgress(s, takes), life = guidedShotLifecycle(s, takes);
  const references = shotCreationReferences(s);
  const automationRows = (typeof AUTOMATION_RUNS !== "undefined" ? AUTOMATION_RUNS : window.AUTOMATION_RUNS) || [];
  const activeRun = automationRows.find((row) => row.targetId === s.id && ["running","awaiting-review","failed","interrupted"].includes(row.status));
  const frameStates = progress.frames.map((frame,index) => guidedFrameStepState(s,frame,index,takes));
  return {
    referenceCount: references.length,
    missingReferenceCount: references.filter((row) => !row.url).length,
    blockingGuideActive: !!activeBlockingRow(s),
    blockingGuideCandidateCount: blockingMediaRows(s).length,
    frameTotal: frameStates.length,
    frameApprovedCount: frameStates.filter((row) => row.key === "approved").length,
    frameNeedsReview: frameStates.some((row) => row.key === "review"),
    requiredFramesApproved: !!progress.requiredApproved,
    motionCandidateCount: takes.filter((take) => isVideo(take.name)).length,
    activityStatus: activeRun ? activeRun.status : "",
    lifecycleKey: life.key,
    deliveryIntent: life.intent,
  };
}
/* The strip's view of a stage. The judgement is the declared model's; this
   function's whole job is turning the model's status key into the shipped STAGE_STATUS
   wording and its note TOKEN into count-aware English. Wording stays here on purpose —
   the stage model declares what is true, not how CineBraid says it.

   ITS CALLER MOVED IN O4 and its behaviour did not. The five-stage navigator is now
   built by public/stage-surfaces.js into the shell's persistent bar rather than by
   guidedShotWorkspaceView() into `#main`, because `#main` is replaced wholesale on
   every render and a workflow navigator that is destroyed by moving through the
   workflow is not one. The strip calls THIS function, so the words on it are the same
   words the taskbar showed. */
function boundedShotTaskStatus(s, takes, taskId, facts = shotStageModelFacts(s, takes)) {
  const state = shotStageState(taskId, facts);
  if (!state) return { tone:"pending", label:STAGE_STATUS.notStarted };
  const note = state.note;
  const text = !note ? "" :
    note.key === "references-missing" ? `${plural(note.count, "reference")} missing` :
    note.key === "references-linked" ? plural(note.count, "reference") :
    note.key === "blocking-guides-to-choose" ? `${plural(note.count, "guide")} to choose from` :
    note.key === "frames-approved" ? `${note.count} of ${plural(note.total, "frame")} approved` :
    note.key === "blocked-reason" ? note.reason : "";
  return { tone:state.tone, label:STAGE_STATUS[state.statusKey] || STAGE_STATUS.notStarted, ...(text ? { note:text } : {}) };
}
function boundedShotSelectedTask(s, takes) {
  const facts = shotStageModelFacts(s, takes);
  /* The stored value is read once and resolved once, by the declared model: a
     current stage id is honoured, a stage an older build called something else is
     translated, a bare number is resolved against the DECLARED order, and anything
     else falls through to the model's recommendation. The previous version asked
     boundedFocusedTask first and then overrode it from a local legacy map, which
     meant two answers existed and the second one silently won. */
  let stored = "";
  try {
    stored = localStorage.getItem(`cinebraid-focused:${((typeof ACTIVE_PROJECT_SLUG !== "undefined" && ACTIVE_PROJECT_SLUG) || window.ACTIVE_PROJECT_SLUG || P.meta?.id || "project")}:${SHOT_STAGE_SCOPE}:${s.id}`) || "";
  } catch {}
  const selected = resolveShotStageId(stored, facts);
  /* A legacy look target still has to say which of the stage's two tabs it meant. */
  const view = shotStagePanelView(stored);
  if (view) { try { boundedWriteState("selected:shot-look-view",s.id,view); } catch {} }
  return selected;
}
/* The production format a shot is delivered in. The field already existed in the record
   and was already read by every generation path — it simply had no control, so a shot
   could never be given a format of its own. An empty value means "follow the project",
   which is what most shots do. */
function shotAspectControl(s) {
  const stored = String(ensureShotCreation(s).composition?.aspectRatio || "").trim();
  const presets = CINEBRAID_ASPECT_PRESETS.map(([value]) => value);
  /* Custom is either what the shot already stores, or what the user just asked for. The
     free-text field is rendered only in that state, so the shot workspace keeps the
     control budget it was deliberately given — most shots never leave the presets. */
  const custom = (!!stored && !presets.includes(stored)) || boundedSelected("shot-aspect-mode", s.id, ["preset", "custom"], "preset") === "custom";
  const options = [
    `<option value="" ${stored ? "" : "selected"}>Use the project format (${esc(projectAspectLabel(P))})</option>`,
    ...CINEBRAID_ASPECT_PRESETS.map(([value, label]) => `<option value="${attr(value)}" ${stored === value ? "selected" : ""}>${esc(label)}</option>`),
    `<option value="custom" ${custom ? "selected" : ""}>Custom…</option>`,
  ].join("");
  const effective = shotAspectLabel(P, s);
  /* Collapsed by default. The shot's working format is stated in the summary, so it is
     always readable, while the controls stay out of the shot workspace's deliberate
     default-visible budget — most shots are delivered in the project's format. */
  return `<details class="shot-aspect-control" data-ui-state-key="shot-aspect-${attr(s.id)}"><summary><b>Shot format</b><span>${esc(effective)}${stored ? "" : " · from the project"}</span></summary>
    <div class="shot-aspect-fields"><label for="shot-aspect-${attr(s.id)}">Shot aspect ratio</label>
    <select id="shot-aspect-${attr(s.id)}" onchange="setShotAspectRatio('${attr(s.id)}',this.value)">${options}</select>
    ${custom ? `<input id="shot-aspect-custom-${attr(s.id)}" type="text" inputmode="text" placeholder="e.g. 2:1" value="${attr(presets.includes(stored) ? "" : stored)}" autofocus aria-label="Custom aspect ratio for ${attr(s.id)}" onchange="setShotAspectRatio('${attr(s.id)}',this.value)">` : ""}
    <small id="shot-aspect-hint-${attr(s.id)}" class="hint shot-aspect-hint">${custom && !stored ? "Type a ratio as width:height, for example 2:1." : ""}</small>
    <small class="hint">Every image this shot is judged in uses this ratio, and so does every generation request it makes.</small></div></details>`;
}
window.setShotAspectRatio = (shotId, value) => {
  const s = shotById(shotId);
  if (!s) return;
  const hint = document.getElementById(`shot-aspect-hint-${shotId}`);
  const raw = String(value == null ? "" : value).trim();
  if (raw === "custom") {
    /* "Custom…" opens a real field rather than storing a placeholder — an option that
       cannot accept a value is not a choice. Nothing is written until a ratio is typed. */
    boundedWriteState("selected:shot-aspect-mode", s.id, "custom");
    if (hint) hint.textContent = "Type a ratio as width:height, for example 2:1.";
    /* The re-render brings the field in, autofocused. */
    route();
    return;
  }
  const parsed = raw ? parseAspectRatio(raw) : "";
  if (raw && !parsed) {
    /* Nothing is stored: an unreadable entry must not overwrite a good saved format. */
    if (hint) hint.textContent = `“${raw}” is not a usable aspect ratio. Use width:height, for example 2:1.`;
    return;
  }
  ensureShotCreation(s).composition.aspectRatio = parsed;
  boundedWriteState("selected:shot-aspect-mode", s.id, "preset");
  if (hint) hint.textContent = "";
  dirty();
  route();
};
function shotLookWorkspace(s) {
  const ids=["blocking","authority"], selected=boundedSelected("shot-look-view",s.id,ids,"blocking");
  return `<section class="shot-subworkspace">${shotAspectControl(s)}<nav class="entity-subworkspace-tabs"><button class="${selected==="blocking"?"selected":""}" onclick="selectBoundedItem('shot-look-view','${attr(s.id)}','blocking')">Blocking & camera</button><button class="${selected==="authority"?"selected":""}" onclick="selectBoundedItem('shot-look-view','${attr(s.id)}','authority')">Approved references</button></nav>${selected === "authority" ? guidedShotComposerPanel(s,false) : guidedBlockingPanel(s)}</section>`;
}
function shotFramesWorkspace(s,takes) {
  const run = typeof v626LatestRun === "function" ? v626LatestRun("shot-chain",s.id,"stills") : null;
  const open = !manualFirstWorkflow() || (run && ["running","awaiting-review","failed","interrupted"].includes(run.status));
  const automation = `<details class="shot-stage-automation" ${open ? "open" : ""}><summary><div><b>Full shot automation</b><small>${run ? esc(run.stage || run.summary || run.status) : "Blocking → review → required frames → optional scene continuity"}</small></div><span>${run ? esc(String(run.status).replace(/-/g," ").toUpperCase()) : "OPTIONAL"}</span></summary>${typeof shotAutomationPanel === "function" ? shotAutomationPanel(s) : ""}</details>`;
  return `${guidedFrameWorkflowPanel(s,takes)}${automation}`;
}
function guidedShotWorkspaceView(s, takes, sc, state, refs, planningMedia, neighbors) {
  const current = guidedCurrentShotStill(s, takes), approvedMotion = guidedApprovedMotion(s, takes), life = guidedShotLifecycle(s, takes);
  const progress = guidedFrameProgress(s, takes), selectedTask = boundedShotSelectedTask(s, takes);
  const openInputs = !progress.firstApproved && (shotMediaLinks(s).length || shotCreationReferences(s).length);
  const motionOpen = progress.requiredApproved && (life.panel === "motion" || ensureShotCreation(s).deliveryIntent === "motion");
  /* One renderer per DECLARED stage. The keys are not a fourth statement of the
     stage list — tests/stage-model.js requires this map's keys to equal
     SHOT_STAGE_IDS exactly, so a declared stage with no workspace, or a workspace
     with no declaration, is a failing test rather than a silent fall-through to
     Frames. */
  const renderers = {
    inputs: () => guidedSourceInputsPanel(s,current,openInputs),
    look: () => shotLookWorkspace(s),
    frames: () => shotFramesWorkspace(s,takes),
    motion: () => guidedMotionPanel(s,current,takes,motionOpen),
    deliver: () => guidedFinishPanel(s,approvedMotion,current,life.panel === "finish"),
  };
  /* NO STAGE NAVIGATOR IS BUILT HERE, and that is O4.

     This workspace used to render the five-stage taskbar itself, between the status
     card and the work stack. `#main` is replaced wholesale on every render, so every
     stage change destroyed and rebuilt the surface whose entire job was telling the
     filmmaker where they were. The navigator now lives in the shell's persistent bar
     and is built by public/stage-surfaces.js from the same declared model this
     function reads for `selectedTask`.

     What remains here is `data-selected-task`, which is still the workspace's own
     statement of which stage it rendered — public/focused-workspaces.js reads it, and
     so does every suite that checks the two agree. A second navigator built here
     would fail tests/stage-surfaces.js rather than merely look redundant. */
  const selectedMarkup = (renderers[selectedTask] || renderers.frames)();
  const requiredFrames = progress.frames.filter((frame) => frame.required !== false);
  const approvedFrames = requiredFrames.filter((frame, index) => guidedFrameApproved(s, frame, takes, progress.frames.indexOf(frame))).length;
  const referenceCount = shotCreationReferences(s).filter((row) => row.url).length;
  const videos = takes.filter((take) => isVideo(take.name)).length;
  const commandSummary = `<section class="shot-command-summary"><article><span>References</span><b>${referenceCount}</b><small>${referenceCount ? "linked and available" : "none linked yet"}</small></article><article><span>Required frames</span><b>${approvedFrames}/${requiredFrames.length || 1}</b><small>${approvedFrames === requiredFrames.length && requiredFrames.length ? "approved" : "still to approve"}</small></article><article><span>Motion</span><b>${videos || "—"}</b><small>${videos ? plural(videos, "video file") : progress.requiredApproved ? "ready when needed" : "waiting for frames"}</small></article><article><span>Open stage</span><b>${esc(String(selectedTask).replace(/^./, (c) => c.toUpperCase()))}</b><small>Shot status: ${esc(state?.label || life.label || "In progress")}</small></article></section>`;
  return `<div class="shot-shell guided-shot-shell focused-workspace-shell bounded-shot-workspace clarity-shot-workspace" data-bounded="1" data-selected-task="${attr(selectedTask)}">${projectNavigator(s)}<div class="shot-main"><div class="crumb"><a href="#/shots/board">Shots</a> / <a href="#/scene/${s.scene}">${esc(sc ? sc.title : s.scene)}</a> / ${esc(s.id)}</div><header class="shot-workspace-head guided-shot-head"><div class="shot-head-nav">${neighbors.prev ? `<a href="#/shot/${neighbors.prev.id}" title="Previous shot" aria-label="Previous shot: ${attr(neighbors.prev.title || neighbors.prev.id)}">‹</a>` : '<span aria-hidden="true">‹</span>'}${neighbors.next ? `<a href="#/shot/${neighbors.next.id}" title="Next shot" aria-label="Next shot: ${attr(neighbors.next.title || neighbors.next.id)}">›</a>` : '<span aria-hidden="true">›</span>'}</div><div class="shot-head-main"><h1 class="shot-title-display">${esc(s.title || "Untitled shot")}</h1><div class="record-meta">${esc(s.id)} · ${takes.length} returned file${takes.length === 1 ? "" : "s"}</div></div><div class="shot-head-controls"><details class="guided-inline-actions"><summary>Shot actions</summary><button class="ghost-btn" onclick="openRenameShotModal('${s.id}')">Rename shot</button><button class="ghost-btn" onclick="duplicateShot('${s.id}')">Duplicate shot</button><button class="ghost-btn" onclick="clickGuidedUpload('${s.id}','${life.key.includes("motion") || life.key === "final" ? "video" : "still"}')">Import existing ${life.key.includes("motion") || life.key === "final" ? "video" : "still"}</button><button class="danger-btn" onclick="delShot('${s.id}')">Delete shot</button></details></div></header>${commandSummary}${guidedShotStatusCard(s,takes,neighbors)}${typeof v642RelatedShotActivityMarkup === "function" ? v642RelatedShotActivityMarkup(s.id) : ""}<div class="guided-work-stack bounded-selected-task" data-bounded-task="${attr(selectedTask)}">${selectedMarkup}</div></div></div>`;
}

window.setComposerConstraint = (id, key, value) => {
  const s = shotById(id), c = ensureShotCreation(s);
  c.composition[key] = value;
  dirty();
};
window.openComposerReferenceModal = (shotId) => {
  const s = shotById(shotId), linked = new Set([...shotMediaLinks(s), ...mediaLinksForTarget("scene", s.scene)].map((row) => row.asset.id));
  const available = projectMediaAssets().filter((asset) => !linked.has(asset.id) && mediaIsImage(asset));
  openModal(`<h3>Add a reference to this shot</h3><div class="modal-sub">LINK AN EXISTING PROJECT IMAGE TO THE SHOT OR THE WHOLE SCENE</div><div class="link-media-list">${available.length ? available.map((asset) => `<div class="composer-link-row"><span>${mediaPreview(asset)}</span><div><b>${esc(asset.title || asset.originalName || asset.file)}</b><small>Reusable project media</small></div><button onclick="linkComposerReference('${shotId}','${asset.id}','shot')">SHOT</button><button class="ghost-btn" onclick="linkComposerReference('${shotId}','${asset.id}','scene')">SCENE</button></div>`).join("") : `<div class="reference-empty"><b>No unlinked project images</b><span>Upload new images in Source & References, then enable Use in prompts.</span></div>`}</div><div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button></div>`);
};
window.linkComposerReference = (shotId, assetId, scope) => {
  const s = shotById(shotId), asset = mediaAssetById(assetId), targetType = scope === "scene" ? "scene" : "shot", targetId = scope === "scene" ? s.scene : s.id;
  if (!asset) return;
  asset.links = asset.links || [];
  const link = newProjectMediaLink(targetType, targetId, "planning-reference", mediaLinksForTarget(targetType, targetId).length);
  link.generationInput = true; link.priority = "supporting";
  asset.links.push(link);
  dirty(); closeModal(); route(); toast(`Reference added to ${scope === "scene" ? "the scene" : "this shot"}`);
};
window.approveGuidedStill = (id, name) => {
  const suggested = canonicalSuggestion(id, name, "shot");
  window._approval = { id, name };
  openModal(`<h3>Use as the current shot image?</h3><div class="modal-sub">THIS ALSO BECOMES THE OPENING FRAME FOR OPTIONAL MOTION</div><div class="approval-preview"><b>${esc(name)}</b><span>Approved shot still</span></div><input type="hidden" id="approve-target" value="shot"><div class="form-field"><label>Canonical filename</label><input id="approve-name" value="${attr(suggested)}"></div><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="approve-btn large" onclick="confirmApproveTake()">APPROVE SHOT IMAGE</button></div>`);
};
window.useApprovedBaseAsShot = async (id) => {
  const s = shotById(id);
  const base = guidedBaseReference(s);
  if (!base?.url) return toast("Select an approved location plate first");
  try {
    const r = await fetch(`/api/shots/${encodeURIComponent(id)}/use-reference`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectSlug: ACTIVE_PROJECT_SLUG, url: base.url, name: `${id}_APPROVED_BASE` }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Could not copy the plate");
    SCAN = await (await fetch("/api/scan")).json();
    const opening = (s.keyframes || [])[0] || newKeyframe(0, "Opening frame");
    if (!(s.keyframes || []).length) s.keyframes = [opening];
    const c = ensureShotCreation(s);
    c.baseUsedUnchangedAt = new Date().toISOString();
    /* THIS COPIES A PLATE IN. IT DOES NOT APPROVE ONE.
     *
     * The file being made Canon here does not exist until the server has copied
     * it, which is after an `await`, which is after the creator's click has
     * finished. Batch 1D bridged that gap with a capability minted in the
     * prologue and spent on whatever filename came back — a decision the person
     * never saw, on bytes that did not exist when they decided.
     *
     * There is no bridge any more, and the honest reading is that the app is
     * acting on its own here: it selects the copied plate and shows the creator
     * the ordinary approval modal, pre-filled, with the exact filename and image
     * they are about to make Canon. That is the product's existing confirmation
     * for every other still — one click, no new ceremony — and it is the only
     * way the person can see what they are approving. */
    c.selectedCandidate = d.name;
    dirty();
    route();
    if (typeof approveGuidedStill === "function") approveGuidedStill(s.id, d.name);
    else toast("Approved plate copied into the shot — approve it as the shot image to make it canon");
  } catch (e) {
    toast("Could not use plate: " + e.message);
  }
};
window.setMotionPlanField = (id, group, key, value) => {
  const s = shotById(id), c = ensureShotCreation(s);
  c.motionPlan[group] = c.motionPlan[group] && typeof c.motionPlan[group] === "object" ? c.motionPlan[group] : {};
  c.motionPlan[group][key] = value;
  c.deliveryIntent = "motion";
  keepGuidedPanelOpen(s, "motion", "motionDirector");
  dirty(); route();
};
window.setMotionSubject = (id, subjectId, key, value) => {
  const s = shotById(id), c = ensureShotCreation(s);
  motionSubjectPlan(c, subjectId)[key] = value;
  c.deliveryIntent = "motion";
  keepGuidedPanelOpen(s, "motion", "motionDirector");
  dirty(); route();
};
window.setMotionProp = (id, propId, key, value) => {
  const s = shotById(id), c = ensureShotCreation(s);
  motionPropPlan(c, propId)[key] = value;
  c.deliveryIntent = "motion";
  keepGuidedPanelOpen(s, "motion", "motionDirector");
  dirty(); route();
};
window.setSimpleMotionAudio = (id, key, value) => {
  const s = shotById(id), c = ensureShotCreation(s), audio = c.motionPlan.audio;
  audio[key] = value;
  if (key === "mode") {
    audio.lipSync = value === "lip-sync-reference";
    if (value !== "lip-sync-reference") audio.referenceKey = "";
  }
  if (key === "referenceKey" && !value && audio.mode === "lip-sync-reference") audio.lipSync = false;
  if (key === "speakerId") s.audio = { ...(s.audio || {}), speakerId: value };
  if (key === "voiceEntityId") s.audio = { ...(s.audio || {}), voiceEntityId: value };
  c.deliveryIntent = "motion";
  keepGuidedPanelOpen(s, "motion", "motionAudio");
  dirty(); route();
};
function suggestedMotionProfileForApprovedFrames(s, approvedCount) {
  const c = ensureShotCreation(s), profiles = guidedVideoProfiles();
  /* READ WHERE THE LIVE WRITER WRITES.
   *
   * This guard exists so a shot the filmmaker has already directed keeps its own
   * target instead of being moved by a frame count. It was reading `c.motionProfileId`
   * and `c.motionDirection`, which is where the pre-composer `setGuidedMotionField`
   * put them — but the live composer replaced that writer, and the replacement stores
   * both on the ACTIVE MOTION UNIT and returns before the shot-level fields are ever
   * touched. So both of the guard's inputs were permanently empty and the guard could
   * never fire: a reader that survived while its writer moved.
   *
   * The unit is consulted first because that is what the build path resolves from;
   * the shot-level fields remain the fallback for a project written before units. */
  const unit = (s.clips || []).find((item) => item.id === c.activeMotionUnitId) || (s.clips || [])[0] || null;
  const current = profiles.find((profile) => profile.id === (unit?.motionProfileId || c.motionProfileId));
  const hasUserMotionWork = !!String(unit?.motionPrompt || c.motionDirection || s.motionPrompt || "").trim() || !!(c.motionPromptBuilds || []).length;
  if (current && hasUserMotionWork) return current.id;
  /* Suggested, so it must be runnable: a suggestion CineBraid cannot dispatch is the
     same dead end as an undispatchable default. A shot the filmmaker has already
     directed keeps its own target above. */
  const dispatchable = guidedDispatchableVideoProfiles();
  if (approvedCount >= 3) return dispatchable.find((profile) => profile.mode === "r2v")?.id || profiles.find((profile) => profile.mode === "r2v")?.id || current?.id || preferredGuidedVideoProfile("");
  if (approvedCount === 2) return dispatchable.find((profile) => profile.mode === "flf")?.id || profiles.find((profile) => profile.mode === "flf")?.id || current?.id || preferredGuidedVideoProfile("");
  return dispatchable.find((profile) => profile.id === P.meta?.promptDefaults?.videoProfile && profile.mode === "i2v")?.id || dispatchable.find((profile) => profile.mode === "i2v")?.id || profiles.find((profile) => profile.mode === "i2v")?.id || current?.id || preferredGuidedVideoProfile("");
}
window.scrollGuidedMotionSection = (id, section = "create") => {
  const panel = document.getElementById(`guided-motion-workspace-${id}`);
  if (panel) {
    panel.open = true;
    if (section === "create") {
      const assisted = panel.querySelector(".motion-assisted-tools");
      if (assisted) assisted.open = true;
    }
  }
  const s = shotById(id);
  if (s) {
    keepGuidedPanelOpen(s, "motion");
    if (section === "create") keepGuidedPanelOpen(s, "motion", "motionCreate");
  }
  const target = document.getElementById(`motion-${section}-${id}`);
  target?.scrollIntoView?.({ behavior: "smooth", block: "start" });
};
window.openGuidedMotionFromFrames = (id, section = "create") => {
  const s = shotById(id);
  if (!s) return;
  const takes = takesFor(id), progress = guidedFrameProgress(s, takes);
  if (!progress.requiredApproved) return toast("Approve every required frame before creating motion");
  const sequenceInputs = guidedFrameSequenceInputs(s, takes);
  const approvedCount = sequenceInputs.length;
  const sequenceReview = guidedFrameSequenceReviewState(s, sequenceInputs);
  if (approvedCount >= 2 && !sequenceReview?.pass) return toast(sequenceReview ? "Correct the frame-sequence continuity issues before creating motion" : "Run the frame-sequence continuity review before creating motion");
  const c = ensureShotCreation(s), suggested = suggestedMotionProfileForApprovedFrames(s, approvedCount);
  if (suggested) c.motionProfileId = suggested;
  c.deliveryIntent = "motion";
  keepGuidedPanelOpen(s, "motion", section === "create" ? "motionCreate" : "");
  selectGuidedPanelTask(s, "motion");
  dirty();
  route();
  setTimeout(() => window.scrollGuidedMotionSection(id, section), 40);
  setTimeout(() => window.scrollGuidedMotionSection(id, section), 180);
};

window.setGuidedMotionField = (id, key, value) => {
  const s = shotById(id), c = ensureShotCreation(s);
  c[key] = value;
  if (["motionDirection", "motionProfileId", "motionDuration", "motionIntensity", "preserveComposition"].includes(key)) c.deliveryIntent = "motion";
  keepGuidedPanelOpen(s, "motion");
  if (key === "motionDirection") s.motionPrompt = value;
  if (key === "motionProfileId") {
    const profile = guidedVideoProfiles().find((item) => item.id === value);
    const before = Number(c.motionDuration || (s.clips || [])[0]?.dur || 5);
    const after = guidedClampedMotionDuration(before, profile);
    c.motionDuration = after;
    if (before !== after) toast(`${profile?.name || "This target"} supports ${guidedMotionDurationBounds(profile).join("–")} second clips; duration changed to ${after}s.`);
    dirty();
    route();
    return;
  }
  if (key === "motionDuration") {
    const profile = guidedVideoProfiles().find((item) => item.id === preferredGuidedVideoProfile(c.motionProfileId || ""));
    c.motionDuration = guidedClampedMotionDuration(value, profile);
  }
  dirty();
};
window.setShotAudioField = (id, key, value) => {
  const s = shotById(id);
  keepGuidedPanelOpen(s, "motion", "motionAudio");
  s.audio = s.audio || {};
  s.audio[key] = value;
  if (key === "speakerId" && s.creationBrief?.motionPlan?.audio) s.creationBrief.motionPlan.audio.speakerId = value;
  if (key === "voiceEntityId" && s.creationBrief?.motionPlan?.audio) s.creationBrief.motionPlan.audio.voiceEntityId = value;
  dirty();
};
function quotedLineSuggestion(value) {
  const match = String(value || "").match(/[“"']([^“”"']{2,220})[”"']/);
  return match ? match[1].trim() : "";
}
window.acceptLegacyShotLineSuggestion = (id) => {
  const s = shotById(id), suggestion = quotedLineSuggestion(s.audio?.vo);
  if (!suggestion) return toast("No quoted line was found in the legacy VO note");
  s.audio = { ...(s.audio || {}), line: suggestion };
  keepGuidedPanelOpen(s, "motion", "motionAudio");
  dirty(); route(); toast("Quoted line copied into Spoken line; the original note was preserved");
};
window.acceptLegacyClipLineSuggestion = (id, index) => {
  const s = shotById(id), clip = (s.clips || [])[index], suggestion = quotedLineSuggestion(clip?.vo);
  if (!clip || !suggestion) return toast("No quoted line was found in the legacy VO note");
  clip.line = suggestion;
  dirty(); route(); toast("Quoted line copied into the motion unit; the original note was preserved");
};
window.acceptGuidedMotionRevision = (id, buildId) => {
  const s = shotById(id), c = ensureShotCreation(s);
  const build = resolvePromptBuildList(P, c.motionPromptBuilds).find((item) => item.id === buildId);
  if (!build?.improvedDirective) return;
  c.motionDirection = build.improvedDirective;
  s.motionPrompt = build.improvedDirective;
  keepGuidedPanelOpen(s, "motion");
  dirty();
  route();
  toast("Revised motion brief applied");
};
window.buildGuidedMotionPrompt = async (id, useLLM = false) => {
  const s = shotById(id), c = ensureShotCreation(s), current = guidedCurrentShotStill(s);
  /* The two approval gates in this function exist to guarantee a VISUAL ANCHOR, so
     they are asked of the target rather than of every shot. Text-to-video has no
     anchor by construction, and refusing it for a missing approved still would leave
     the one wired prompt-only route unreachable for exactly the shots it suits. */
  const intendedProfile = guidedVideoProfiles().find((item) => item.id === preferredGuidedVideoProfile(c.motionProfileId || ""));
  const needsApprovedStill = guidedVideoModeNeedsApprovedStill(intendedProfile?.mode);
  if (!current && needsApprovedStill) return toast("Approve a shot image first");
  const writtenDirection = String(c.motionDirection || s.motionPrompt || "").trim();
  const structuredDirection = structuredMotionSummary(s);
  const direction = writtenDirection;
  // Structured controls are the primary motion brief. Free text supplements
  // them instead of replacing them.
  const h3SequenceDirection = String(c.h3SequenceNote || "").trim();
  const directiveForRequest = useLLM ? [structuredDirection, writtenDirection, h3SequenceDirection].filter(Boolean).join("\n") : [writtenDirection, h3SequenceDirection].filter(Boolean).join("\n");
  if (!structuredDirection && !writtenDirection) return toast("Choose at least one motion direction");
  if (useLLM && !capabilityState("text").ready) return toast(capabilityState("text").message);
  const progress = guidedFrameProgress(s, takesFor(id));
  if (!progress.requiredApproved && needsApprovedStill) return toast("Approve all required frames before building motion");
  let profileId = preferredGuidedVideoProfile(c.motionProfileId || "");
  if (!c.motionProfileId && progress.frames.length > 1) {
    const frameAware = guidedVideoProfiles().find((item) => item.mode === "flf") || guidedVideoProfiles().find((item) => ["r2v", "audio-video"].includes(item.mode));
    if (frameAware) profileId = frameAware.id;
  }
  const profile = guidedVideoProfiles().find((item) => item.id === profileId);
  if (!profileId || !profile) return toast("No compatible video profile is configured");
  const unit = ensureGuidedMotionUnit(s, current?.name || "", profile);
  const duration = guidedClampedMotionDuration(c.motionDuration || unit.dur || 5, profile);
  c.motionDuration = duration;
  unit.motionPrompt = writtenDirection;
  unit.note = writtenDirection || structuredDirection;
  unit.dur = duration;
  c.motionProfileId = profileId;
  const motionBrief = typeof motionSoundBriefPayload === "function" ? motionSoundBriefPayload(s, unit, c) : null;
  const audioContext = motionAudioSummary(s, c);
  const directive = direction;
  const payloadRefs = guidedMotionReferences(s, current, profile);
  const action = useLLM ? "improve" : "compile";
  keepGuidedPanelOpen(s, "motion");
  setGuidedPromptOp("motion", id, "", { status: "busy", action, startedAt: Date.now() });
  route();
  try {
    const d = await guidedPromptRequest("/api/prompt/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shotId: id,
        segmentId: unitKey(unit),
        durationSeconds: duration,
        profileId,
        purpose: "motion",
        directive: directiveForRequest,
        references: payloadRefs,
        useLLM,
        improveMotion: useLLM,
        audioContext,
        audio: {
          dialogue: motionBrief?.dialogue?.line || unit.line || s.audio?.line || "",
          speakerId: motionBrief?.dialogue?.speakerId || unit.speakerId || s.audio?.speakerId || c.motionPlan.audio.speakerId || "",
          speakerName: motionBrief?.dialogue?.speakerName || "",
          note: unit.audioNote || unit.vo || s.audio?.note || s.audio?.vo || "",
          voiceEntityId: unit.voiceEntityId || s.audio?.voiceEntityId || c.motionPlan.audio.voiceEntityId || "",
          voiceDesign: motionBrief?.dialogue?.voiceDesign || "",
          language: motionBrief?.dialogue?.language || "",
          emotion: motionBrief?.dialogue?.emotion || "",
          delivery: motionBrief?.dialogue?.delivery || "",
          pace: motionBrief?.dialogue?.pace || "",
          volume: motionBrief?.dialogue?.volume || "",
          mode: motionBrief?.output?.nativeAudio === false ? "none" : (c.motionPlan.audio.mode || (motionBrief?.dialogue?.line ? "generate-voice" : "none")),
          sfx: unit.sfx || s.audio?.sfx || "",
          ambience: motionBrief?.sound?.ambience || c.motionAudioNotes || s.audio?.ambience || "",
          music: motionBrief?.sound?.music || unit.music || s.audio?.music || "",
        },
        motionBrief,
        motionSync: audioContext ? c.motionSync || "natural" : "none",
        motionIntensity: c.motionIntensity,
        preserveComposition: c.preserveComposition,
        allowAdditionalReferences: profile.mode === "r2v" || profile.mode === "audio-video",
        motionPlan: c.motionPlan,
        composition: c.composition,
      }),
    }, GUIDED_PROMPT_TIMEOUTS[action], useLLM ? "Motion prompt improvement" : "Motion prompt compilation");
    if (d.sourceDirectiveSanitized && d.originalDirective && writtenDirection) {
      c.motionDirection = writtenDirection;
      s.motionPrompt = writtenDirection;
      unit.motionPrompt = writtenDirection;
    }
    const sequence = c.motionPromptBuilds.length + 1;
    const packageId = `${id}-MOTION-R${String(sequence).padStart(2, "0")}`;
    const build = {
      id: "guided-motion-" + Date.now().toString(36),
      packageId,
      date: new Date().toISOString(),
      profileId,
      profileName: d.profile?.name || profile.name || profileId,
      profileVersion: d.profile?.profileVersion || "",
      prompt: d.compiledPrompt,
      spec: d.spec,
      references: d.references || payloadRefs,
      warnings: [...(d.warnings || []), ...(typeof motionSoundWarnings === "function" ? motionSoundWarnings(s, unit, profile) : [])],
      confirmations: d.confirmations || [],
      productionRisks: d.productionRisks || d.spec?.productionRisks || [],
      providerPayload: d.providerPayload || null,
      llmUsed: !!d.llmUsed,
      originalDirective: d.originalDirective || writtenDirection || structuredDirection,
      sourceDirectiveSanitized: !!d.sourceDirectiveSanitized,
      improvedDirective: d.improvedDirective || "",
      improvementNotes: d.improvementNotes || [],
      lockedFields: d.lockedFields || [],
      motionBrief: d.motionBrief || motionBrief || null,
      audioContext,
      motionPlan: JSON.parse(JSON.stringify(c.motionPlan)),
      composition: JSON.parse(JSON.stringify(c.composition)),
      durationSeconds: duration,
      revision: (unit.generationPackages || []).length + 1,
      kind: "guided-motion",
    };
    const buildId = registerPromptBuild(P, build);
    c.motionPromptBuilds.push(promptBuildRef(buildId, { kind: "guided-motion" }));
    c.lastMotionPackageId = packageId;
    unit.generationPackages.push(promptBuildRef(buildId, { kind: "guided-motion", scope: `segment:${unit.id || unit.suffix || ""}` }));
    applyPromptBuildRetention(P);
    dirty();
    route();
    toast(useLLM ? "Motion direction improved and compiled for the selected model" : "Motion prompt compiled from the approved still");
    setGuidedPromptOp("motion", id, "", null);
  } catch (e) {
    setGuidedPromptOp("motion", id, "", { status: "error", action, error: e.message, failedAt: Date.now() });
    toast("Motion prompt failed: " + e.message);
  } finally {
    dirty();
    route();
  }
};
window.downloadGuidedMotionPrompt = (id, buildId) => {
  const s = shotById(id), c = ensureShotCreation(s);
  const build = resolvePromptBuildList(P, c.motionPromptBuilds).find((item) => item.id === buildId);
  if (!build) return;
  downloadCreationText(`${build.packageId || id}_${build.profileId.replace(/\//g, "-")}_motion-prompt.txt`, build.prompt || "");
};
window.markGuidedStillFinal = (id, name) => {
  const s = shotById(id), c = ensureShotCreation(s);
  if (!name) return toast("Approve a still first");
  const stillOpening = (s.keyframes || [])[0];
  /* WORKFLOW BOOKKEEPING ONLY. Every pointer this used to write —
     `s.winner`, its identity stamp, `finalStillFile` on both records — IS a
     canon edge, and the kernel owns all of them. Writing them here produced a
     second, unreceipted copy of the same decision, and on the no-frame arm it
     produced a `s.winner` with no frame receipt behind it at all. */
  const markStillFinal = () => {
    c.deliveryIntent = "still";
    s.workflowStatus = "APPROVED";
    s.status = "APPROVED";
  };
  /* BATCH 1B: marking a still final IS a shot-winner write, so it goes through
     the authority command. The receipt is what makes a later gate read agree
     with what this screen just did. */
  /* K1C — BOTH ARMS ROUTE. The fallback used to write `s.winner` directly when
     a shot had no opening frame, which is a canonical selection with no receipt
     behind it. There is no un-routed arm now: with a frame it is frame
     authority, without one it is the shot's delivery pointer. */
  const stillAt = new Date().toISOString();
  const stillAssetId = (takesFor(s.id).find((item) => item.name === name) || {}).assetId || "";
  /* MARKING A STILL FINAL IS A DELIVERY DECISION, and when the shot has an
     opening frame it is also a frame decision. Both are canon, both are made in
     this one click, and both go through the kernel — which is what stops the
     delivery half from being a raw pointer nobody approved. */
  try {
    if (stillOpening) approveFrameCanon(P, { shotId: s.id, frameId: stillOpening.id, value: name, assetId: stillAssetId, at: stillAt, via: "guided-final-still" });
    approveDeliveryCanon(P, { shotId: s.id, value: name, assetId: stillAssetId, at: stillAt, via: "guided-final-still" });
  } catch (error) {
    return toast(error.message || "That still could not be approved");
  }
  markStillFinal();
  const row = candidateRecord(s, name, true);
  row.approvedAt = row.approvedAt || new Date().toISOString();
  row.finalAt = new Date().toISOString();
  row.decision = "shortlist";
  dirty();
  route();
  stampCeremony("FINAL STILL");
  toast("Still marked as the final shot delivery");
};
window.approveGuidedMotion = (id, name) => {
  const s = shotById(id), c = ensureShotCreation(s), current = guidedCurrentShotStill(s);
  const profile = guidedVideoProfiles().find((item) => item.id === c.motionProfileId);
  const unit = ensureGuidedMotionUnit(s, current?.name || "", profile);
  /* K1C — A MOTION WINNER IS CANON, so it goes through the kernel like every
     other canonical selection. This wrote videoWinner and approvedMotionFile
     directly, outside the receipt model. */
  const motionAssetId = (takesFor(s.id).find((item) => item.name === name) || {}).assetId || "";
  const motionUnitKey = unit.id || unitKey(unit);
  try {
    approveMotionCanon(P, { shotId: s.id, unitKey: motionUnitKey, value: name, assetId: motionAssetId, at: new Date().toISOString(), via: "guided-motion-approval" });
  } catch (error) {
    return toast(error.message || "That video could not be approved");
  }
  const row = candidateRecord(s, name, true);
  row.approvedAt = new Date().toISOString();
  row.approvedTarget = `segment:${unitKey(unit)}`;
  row.decision = "shortlist";
  dirty();
  route();
  stampCeremony("MOTION APPROVED");
  toast("Video approved as the current motion take");
};
window.queueGuidedVideoFinish = (id, name) => {
  const s = shotById(id), c = ensureShotCreation(s);
  if (c.approvedMotionFile !== name) {
    const current = guidedCurrentShotStill(s), profile = guidedVideoProfiles().find((item) => item.id === c.motionProfileId), unit = ensureGuidedMotionUnit(s, current?.name || "", profile);
    /* K1C: queueing for finish establishes the motion winner, so it routes. */
    const queueAssetId = (takesFor(s.id).find((item) => item.name === name) || {}).assetId || "";
    const queueUnitKey = unit.id || unitKey(unit);
    try {
      approveMotionCanon(P, { shotId: s.id, unitKey: queueUnitKey, value: name, assetId: queueAssetId, at: new Date().toISOString(), via: "guided-motion-finish-queue" });
    } catch (error) {
      return toast(error.message || "That video could not be approved");
    }
    markCandidateApproved(s, name, `segment:${unitKey(unit)}`);
    dirty();
  }
  markCandidateForFinish(id, name);
};
window.markGuidedVideoFinal = (id, name) => {
  const s = shotById(id), c = ensureShotCreation(s);
  /* K1C: the shot's final video IS its delivery Canon. */
  try {
    approveDeliveryCanon(P, {
      shotId: s.id, value: name,
      assetId: (takesFor(s.id).find((item) => item.name === name) || {}).assetId || "",
      at: new Date().toISOString(), via: "guided-final-video",
    });
  } catch (error) {
    return toast(error.message || "That video could not be approved as the final delivery");
  }
  /* `approvedMotionFile` is the delivery edge and the kernel just wrote it. */
  c.finalVideoFile = name;
  s.finalVideoFile = name;
  const row = candidateRecord(s, name, true);
  row.approvedAt = row.approvedAt || new Date().toISOString();
  row.finalAt = new Date().toISOString();
  row.decision = "shortlist";
  dirty();
  route();
  stampCeremony("FINAL");
  toast("Video marked as the final shot delivery");
};
window.setGuidedFrameField = (id, frameId, key, value, mirror = false) => {
  const s = shotById(id), frames = guidedFrames(s), index = frames.findIndex((frame) => frame.id === frameId);
  if (index < 0) return;
  const frame = frames[index], state = guidedFrameState(s, frame, index);
  state[key] = value;
  if (key === "action") frame.description = value;
  if (index === 0) {
    const c = ensureShotCreation(s);
    c[key] = value;
    if (mirror && key === "action") s.desc = value;
    if (mirror && key === "staging") s.positioning = value;
  }
  dirty();
};
window.setGuidedFrameAdditionalDirection = (id, frameId, value) => {
  const s = shotById(id), frames = guidedFrames(s), index = frames.findIndex((frame) => frame.id === frameId);
  if (index < 0) return;
  const state = guidedFrameState(s, frames[index], index);
  state.staging = "";
  state.camera = "";
  state.notes = value;
  if (index === 0) {
    const c = ensureShotCreation(s);
    c.staging = "";
    c.camera = "";
    c.notes = value;
  }
  dirty();
};
window.addGuidedFrame = (id) => {
  const s = shotById(id), frames = guidedFrames(s);
  const title = frames.length === 1 ? "End frame" : `Additional frame ${alphaLabel(frames.length)}`;
  const frame = newKeyframe(frames.length, title);
  frames.push(frame);
  const state = guidedFrameState(s, frame, frames.length - 1);
  state.usePreviousFrame = true;
  ensureShotCreation(s).activeGuidedFrameId = frame.id;
  if (typeof boundedWriteState === "function") boundedWriteState("selected:shot-frame", id, frame.id);
  dirty();
  route();
  setTimeout(() => document.querySelector(`[data-frame-id="${frame.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
};
window.removeGuidedFrame = (id, frameId) => {
  const s = shotById(id), frames = guidedFrames(s), index = frames.findIndex((frame) => frame.id === frameId);
  if (index <= 0) return;
  const frame = frames[index];
  confirmModal(
    `Remove Frame ${frame.label}? Uploaded files remain available in Advanced review.`,
    () => {
      frames.splice(index, 1);
      delete ensureShotCreation(s).frameWorkflows[frameId];
      for (const row of s.candidateFiles || []) if (row.frameId === frameId) delete row.frameId;
      normalizeShotV5(s);
      const nextFrame = frames[Math.max(0, index - 1)] || frames[0];
      ensureShotCreation(s).activeGuidedFrameId = nextFrame?.id || "";
      if (nextFrame && typeof boundedWriteState === "function") boundedWriteState("selected:shot-frame", id, nextFrame.id);
      dirty();
      route();
    },
    { title: `Remove Frame ${frame.label}`, confirmLabel: "REMOVE" },
  );
};
function guidedClearApprovalTarget(s, target, exceptName = "") {
  for (const row of s.candidateFiles || []) {
    const rowName = row.stored || row.name || row.original || "";
    if (row.approvedTarget !== target || rowName === exceptName) continue;
    row.replacedAt = new Date().toISOString();
    if (exceptName) row.replacedBy = exceptName;
    delete row.approvedAt;
    delete row.approvedTarget;
    delete row.finalAt;
  }
}
function guidedInvalidateMotionAfterFrameChange(s, previousName = "", nextName = "") {
  const c = ensureShotCreation(s);
  c.frameSequenceReview = null;
  const activeMotion = c.approvedMotionFile || c.finalVideoFile || (s.clips || []).some((clip) => clip.videoWinner);
  for (const build of resolvePromptBuildList(P, c.motionPromptBuilds || [])) {
    build.supersededAt = build.supersededAt || new Date().toISOString();
    build.supersededReason = `Frame input changed from ${previousName || "the previous winner"} to ${nextName || "unapproved"}.`;
  }
  c.motionPromptBuilds = [];
  c.lastMotionPackageId = "";
  /* K1C — CLEARING A CANONICAL EDGE IS A REVOCATION.
     The motion approvals being reopened here are Canon, so the receipts behind
     them are withdrawn rather than left standing beside an emptied pointer. A
     receipt with no edge already fails closed, so this is the honest record
     rather than the safety net — but a project should be able to say WHY a
     decision stopped standing, and "the frame it was built on changed" is the
     reason. */
  if (typeof revokeDeliveryCanon === "function") {
    revokeDeliveryCanon(P, { shotId: s.id, at: new Date().toISOString(), via: "frame-input-changed", reason: "target-cleared" });
    for (const clip of s.clips || []) {
      if (!clip.videoWinner) continue;
      revokeMotionCanon(P, { shotId: s.id, unitKey: clip.id || unitKey(clip), at: new Date().toISOString(), via: "frame-input-changed", reason: "target-cleared" });
    }
  }
  c.approvedMotionFile = "";
  c.finalVideoFile = "";
  s.finalVideoFile = "";
  for (const clip of s.clips || []) {
    const target = `segment:${unitKey(clip)}`;
    if (clip.videoWinner) guidedClearApprovalTarget(s, target);
    clip.videoWinner = "";
    /* P4-SEM-C3: identity is cleared with the edge it identified. A retained id
       beside an emptied winner would silently re-resolve to media this approval
       has just been reopened away from. */
    clearShotApprovalIdentity(clip, "videoWinner");
  }
  if (activeMotion) toast("Frame changed; the previous motion approval was reopened because it used the old frame.");
}
window.guidedFrameApprovalChanged = (id, target, previousName, nextName) => {
  if (previousName === nextName) return;
  const s = shotById(id);
  if (!s) return;
  const c = ensureShotCreation(s);
  const shouldAutoReview = !!(c.frameSequenceCorrection?.autoReviewOnApproval && nextName);
  c.frameSequenceReview = null;
  if (previousName) {
    guidedInvalidateMotionAfterFrameChange(s, previousName, nextName);
    if (c.finalStillFile === previousName) c.finalStillFile = "";
    if (s.finalStillFile === previousName) s.finalStillFile = "";
  }
  if (shouldAutoReview) {
    c.frameSequenceCorrection.lastApprovedFile = nextName;
    c.frameSequenceCorrection.updatedAt = new Date().toISOString();
    setTimeout(() => {
      const vision = typeof capabilityState === "function" ? capabilityState("vision") : { ready: false };
      if (vision.ready && guidedFrameSequenceInputs(s).length >= 2) reviewGuidedFrameSequence(id);
    }, 220);
  }
};
window.resetGuidedFrameApproval = (id, frameId) => {
  const s = shotById(id), frames = guidedFrames(s), index = frames.findIndex((frame) => frame.id === frameId);
  if (index < 0) return;
  /* RESET ACTS ON WHATEVER IMAGE IS SITTING THERE, canon or historic. Reading
     it through the canon predicate meant a creator could not clear a stale
     historic selection at all — the one case where clearing is most obviously
     wanted. `revokeFrameCanon` below withdraws the receipt if there is one. */
  const frame = frames[index], previous = guidedFrameImage(s, frame, takesFor(id), index);
  if (!previous) return;
  const warning = `Reset approved Frame ${frame.label}? Motion approvals built from this frame will be reopened. Returned files will stay available.`;
  confirmModal(
    warning,
    () => {
      const target = index === 0 ? "shot" : `frame:${frameId}`;
      guidedClearApprovalTarget(s, target);
      /* BATCH 1B: RESETTING AN APPROVAL IS A REVOCATION, not a field clear.

         The audit's counterexample lived here: clearing the winner left the
         reconciled automation step still claiming a person had approved it, and
         resume rebuilt authority from that step. Withdrawing the receipt is what
         reopens every dependent gate on the next read, and it records that the
         decision was withdrawn rather than never made. */
      revokeFrameCanon(P, {
        shotId: s.id, frameId, at: new Date().toISOString(), via: "guided-frame-approval-reset", reason: "withdrawn",
      });
      const state = guidedFrameState(s, frame, index);
      state.selectedCandidate = previous.name;
      const c = ensureShotCreation(s);
      if (c.finalStillFile === previous.name) c.finalStillFile = "";
      if (s.finalStillFile === previous.name) s.finalStillFile = "";
      guidedInvalidateMotionAfterFrameChange(s, previous.name, "");
      s.workflowStatus = "IN PROGRESS";
      s.status = "BUILT";
      dirty();
      route();
      toast(`Frame ${frame.label} approval reset. Select and approve the correct candidate.`);
    },
    { title: `Reset Frame ${frame.label} approval`, confirmLabel: "RESET" },
  );
};

window.selectGuidedFrameCandidate = (id, frameId, name) => {
  const s = shotById(id), frames = guidedFrames(s), index = frames.findIndex((frame) => frame.id === frameId);
  if (index < 0) return;
  guidedFrameState(s, frames[index], index).selectedCandidate = name;
  dirty();
  route();
};
window.approveGuidedFrame = (id, frameId, name) => {
  const s = shotById(id), frames = guidedFrames(s), index = frames.findIndex((frame) => frame.id === frameId);
  if (index < 0) return;
  if (index === 0) return approveGuidedStill(id, name);
  window._approval = { id, name };
  const target = `frame:${frameId}`;
  const suggested = canonicalSuggestion(id, name, target);
  openModal(`<h3>Approve Frame ${esc(frames[index].label)}?</h3><div class="modal-sub">THIS BECOMES AN APPROVED INPUT FOR MOTION</div><div class="approval-preview"><b>${esc(name)}</b><span>${esc(frames[index].title || `Frame ${frames[index].label}`)}</span></div><input type="hidden" id="approve-target" value="${attr(target)}"><div class="form-field"><label>Canonical filename</label><input id="approve-name" value="${attr(suggested)}"></div><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="approve-btn large" onclick="confirmApproveTake()">APPROVE FRAME ${esc(frames[index].label)}</button></div>`);
};
window.downloadGuidedFramePrompt = (id, frameId, buildId) => {
  const s = shotById(id), frames = guidedFrames(s), index = frames.findIndex((frame) => frame.id === frameId);
  if (index < 0) return;
  const build = resolvePromptBuildList(P, guidedFrameState(s, frames[index], index).promptBuilds).find((item) => item.id === buildId);
  if (!build) return;
  downloadCreationText(`${build.packageId || `${id}_FRAME_${frames[index].label}`}_${String(build.profileId || "image").replace(/\//g, "-")}.txt`, build.prompt || "");
};
window.buildGuidedFramePrompt = async (id, frameId, useLLM = false) => {
  const s = shotById(id), frames = guidedFrames(s), index = frames.findIndex((frame) => frame.id === frameId);
  if (index < 0) return;
  const frame = frames[index], state = guidedFrameState(s, frame, index);
  const action = String(state.action || frame.description || "").trim();
  if (!action) return toast(`Describe Frame ${frame.label} first`);
  if (useLLM && !capabilityState("text").ready) return toast(capabilityState("text").message);
  const refs = guidedFramePromptRefs(s, frame, index, state);
  let mode = guidedFrameMode(state, refs);
  const readyRefs = refs.filter((ref) => ref.url);
  if (mode === "edit" && !readyRefs.some((ref) => ["base", "composition"].includes(ref.role))) mode = readyRefs.length ? "multi-reference" : "t2i";
  if (mode === "multi-reference" && !readyRefs.length) mode = "t2i";
  const profileId = preferredCreationProfile(mode, state.profileId || P.meta?.promptDefaults?.imageProfile || "");
  state.profileId = profileId;
  const requestAction = useLLM ? "improve" : "compile";
  ensureShotCreation(s).activeGuidedFrameId = frameId;
  setGuidedPromptOp("frame", id, frameId, { status: "busy", action: requestAction, startedAt: Date.now() });
  route();
  try {
    const directive = [
      action,
      state.staging ? `Placement and interactions: ${state.staging}` : "",
      state.camera ? `Camera and framing: ${state.camera}` : "",
      state.notes || "",
      state.automationRevisionRequest ? `Automation revision: ${state.automationRevisionRequest}` : "",
      compositionSummary(s),
      index > 0 && state.usePreviousFrame ? `This is Frame ${frame.label}. Preserve continuity from approved Frame ${frames[index - 1].label} while creating the described new composition.` : "",
    ].filter(Boolean).join("\n");
    const payloadRefs = readyRefs.map((ref, i) => ({
      key: ref.key,
      entityId: ref.entityId || "",
      entityName: ref.entityName || ref.displayName || "",
      assetId: ref.assetId || "",
      label: ref.label,
      file: ref.file || "",
      url: ref.url,
      role: ref.role,
      sourceType: ref.sourceType || "",
      sourceRole: ref.sourceRole || "",
      mediaType: "image",
      approved: true,
      blocking: !!ref.blocking,
      blockingAdherence: ref.blockingAdherence || "",
      index: i + 1,
      instruction: ref.instruction,
      angleTag: ref.angleTag || "",
      priority: ref.priority || "supporting",
    }));
    const data = await guidedPromptRequest("/api/prompt/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shotId: id,
        /* WHICH FRAME IS BEING BUILT. Without it the server compiles the whole
           shot's cast and description and then appends this frame's directive —
           the Dogfood #2 A3 path that put an explicitly absent character into
           Frame A of S01-01. */
        frameId,
        profileId,
        purpose: mode === "edit" ? "edit" : "shot-still",
        references: payloadRefs,
        directive,
        useLLM,
        allowAdditionalReferences: true,
        composition: ensureShotCreation(s).composition,
      }),
    }, GUIDED_PROMPT_TIMEOUTS[requestAction], useLLM ? `Frame ${frame.label} prompt improvement` : `Frame ${frame.label} prompt compilation`);
    const sequence = state.promptBuilds.length + 1;
    const packageId = `${id}-FRAME-${frame.label}-R${String(sequence).padStart(2, "0")}`;
    const build = {
      id: "guided-frame-" + Date.now().toString(36),
      packageId,
      date: new Date().toISOString(),
      frameId: frame.id,
      frameLabel: frame.label,
      mode,
      profileId,
      profileName: data.profile?.name || profileId,
      profileVersion: data.profile?.profileVersion || "",
      prompt: data.compiledPrompt,
      spec: data.spec,
      references: data.references || payloadRefs,
      warnings: data.warnings || [],
      confirmations: data.confirmations || [],
      productionRisks: data.productionRisks || data.spec?.productionRisks || [],
      providerPayload: data.providerPayload || null,
      llmUsed: !!data.llmUsed,
      inputs: {
        globalStyle: globalStylePrompt(),
        world: P.meta?.world?.setting || "",
        action,
        staging: state.staging || "",
        camera: state.camera || "",
        notes: state.notes || "",
        previousFrame: index > 0 && state.usePreviousFrame ? frames[index - 1].id : "",
        composition: JSON.parse(JSON.stringify(ensureShotCreation(s).composition)),
      },
      kind: "guided-frame",
      revision: sequence,
    };
    const buildId = registerPromptBuild(P, build);
    state.promptBuilds.push(promptBuildRef(buildId, { kind: "guided-frame" }));
    if (index === 0) {
      const c = ensureShotCreation(s);
      c.lastImagePackageId = packageId;
      c.profileId = profileId;
      c.mode = state.mode;
    }
    frame.generationPackages = Array.isArray(frame.generationPackages) ? frame.generationPackages : [];
    frame.generationPackages.push(promptBuildRef(buildId, { kind: "guided-frame", scope: `frame:${frame.id}` }));
    s.promptBuilds = Array.isArray(s.promptBuilds) ? s.promptBuilds : [];
    s.promptBuilds.push(promptBuildRef(buildId, { kind: "guided-frame" }));
    s.generationPackages = Array.isArray(s.generationPackages) ? s.generationPackages : [];
    s.generationPackages.push(promptBuildRef(buildId, { kind: "guided-frame", scope: `frame:${frame.id}` }));
    applyPromptBuildRetention(P);
    setGuidedPromptOp("frame", id, frameId, null);
    toast(useLLM ? `Frame ${frame.label} prompt improved and compiled` : `Frame ${frame.label} prompt compiled`);
  } catch (error) {
    setGuidedPromptOp("frame", id, frameId, { status: "error", action: requestAction, error: error.message, failedAt: Date.now() });
    toast(`Frame ${frame.label} prompt failed: ${error.message}`);
  } finally {
    dirty();
    route();
  }
};
window.visionReviewFrame = async (id, frameId) => {
  const s = shotById(id), frames = guidedFrames(s), index = frames.findIndex((frame) => frame.id === frameId);
  if (index < 0) return;
  const files = guidedFrameCandidateRows(s, frames[index], takesFor(id), index).map((take) => take.name);
  if (files.length < 2) return toast("Upload at least two candidates first");
  if (!capabilityState("vision").ready) return toast(capabilityState("vision").message);
  openModal(`<h3>Reviewing Frame ${esc(frames[index].label)} candidates</h3><div class="modal-sub"><span class="spin">◌</span> THE VISION ASSISTANT IS COMPARING ${files.length} IMAGES</div><div class="hint">This is a recommendation only. You approve the final frame.</div>`);
  try {
    const response = await fetch("/api/llm/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "shot", id, frameId, fileNames: files }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Review failed");
    const review = data.review || {};
    if (typeof storeCandidateAIReview === "function") storeCandidateAIReview(id, data);
    const fileName = (n) => data.files?.[Number(n) - 1] || "";
    const ordered = (review.ranking || []).map(Number).filter(Boolean);
    const suggested = fileName(review.suggested || ordered[0]);
    const rows = (review.reviews || []).sort((a, b) => (+b.score || 0) - (+a.score || 0));
    if (suggested) guidedFrameState(s, frames[index], index).selectedCandidate = suggested;
    dirty();
    openModal(`<div class="review-modal-compact"><h3>Frame ${esc(frames[index].label)} assistant review</h3><div class="modal-sub">SUGGESTED: <b style="color:var(--green)">${esc(suggested || "No clear pick")}</b> · ${esc(review.rationale || "")}</div><div class="review-scroll">${rows.map((item) => `<div class="block-row"><div class="block-row-head"><b>${esc(fileName(item.n))}</b><span class="dur-chip">${Math.round(+item.score || 0)}/100</span></div><div class="opt-refs">${esc(item.notes || "")}</div></div>`).join("")}</div><div class="modal-actions"><button class="cancel" onclick="closeModal();route()">Close</button>${suggested ? `<button class="approve-btn" onclick="closeModal();route()">CONTINUE</button>` : ""}</div></div>`);
  } catch (error) {
    openModal(`<h3>Review failed</h3><div class="import-review" style="color:var(--red)">${esc(error.message)}</div><div class="modal-actions"><button class="cancel" onclick="closeModal()">Close</button></div>`);
  }
};




window.setShotCreationField = (id, key, value, mirror = false) => {
  const s = shotById(id), c = ensureShotCreation(s);
  c[key] = value;
  if (mirror && key === "action") s.desc = value;
  if (mirror && key === "staging") s.positioning = value;
  dirty();
};
window.setShotCreationLocation = (id, value) => {
  const s = shotById(id), c = ensureShotCreation(s), previous = c.locationId || "";
  s.codes = Array.isArray(s.codes) ? s.codes : [];
  const attachedBefore = resolveShotEntities(P, s).locations;
  const selectingAttachedLocation = attachedBefore.some((location) => location.id === value);
  if (previous && previous !== value && !selectingAttachedLocation)
    s.codes = s.codes.filter((code) => !shotEntityTokenMatches(code, previous));
  c.locationId = value;
  if (value && !s.codes.some((code) => shotEntityTokenMatches(code, value))) s.codes.push(value);
  dirty();
  route();
};
window.toggleShotCreationCharacter = (id, charId) => {
  toggleShotChar(id, charId);
};
window.toggleShotCreationProp = (id, propId) => {
  const s = shotById(id), c = ensureShotCreation(s), selected = c.propIds.includes(propId);
  s.codes = Array.isArray(s.codes) ? s.codes : [];
  if (selected) {
    c.propIds = c.propIds.filter((x) => x !== propId);
    s.codes = s.codes.filter((code) => !shotEntityTokenMatches(code, propId));
  } else {
    c.propIds = [...c.propIds, propId];
    if (!s.codes.some((code) => shotEntityTokenMatches(code, propId))) s.codes.push(propId);
  }
  dirty();
  route();
};
function creationStartChooser() {
  const selected = creationStartPath();
  return `<section class="creation-start-choice"><div><span class="creation-kicker">HOW DO YOU WANT TO START?</span><h2>Two paths, one production-ready project</h2><p>Start manually for a blank canvas, or use an external LLM to structure an existing script, story, character bible, or shot list.</p></div><div class="creation-path-buttons"><button class="${selected === "manual" ? "on" : ""}" onclick="setCreationStartPath('manual')"><span>FROM SCRATCH</span><b>Build manually</b><small>Best for a new idea or a project you want to shape inside CineBraid.</small></button><button class="${selected === "import" ? "on" : ""}" onclick="setCreationStartPath('import')"><span>EXISTING MATERIAL</span><b>Import with an LLM</b><small>Best when you already have a script, story document, character notes, or shot list.</small></button></div></section>`;
}
function creationImportCard() {
  return `<section id="creation-import" class="creation-card creation-import-card">
    <div class="creation-card-head"><div><span class="creation-kicker">IMPORT EXISTING MATERIAL</span><h3>Turn documents into a reviewable CineBraid project</h3><p>Use the Project Builder prompt with ChatGPT, Claude, or a capable local LLM. CineBraid validates the returned JSON, normalizes safe planning defaults, and shows marked inference, missing production detail, unsupported runtime claims, and anything needing human review before it creates a separate project.</p></div><div class="creation-import-actions"><a class="ghost-btn" href="/api/project-builder/kit" download>Download prompt kit</a><button class="ghost-btn" onclick="copyProjectBuilderSystemPrompt()">Copy system prompt</button></div></div>
    <div class="import-steps"><span><b>1</b> Give the prompt and your documents to an LLM</span><span><b>2</b> Paste or upload the returned JSON</span><span><b>3</b> Validate, review, then import</span></div>
    <textarea id="project-builder-json" class="project-builder-json" placeholder='{"meta":{"title":"My Project"}, ...}'></textarea>
    <div class="creation-import-footer"><input type="file" accept=".json,application/json" id="project-builder-file" onchange="readProjectBuilderFile(this)"><button class="assemble-btn" onclick="importProjectBuilderJSON()">Validate + review</button></div>
    <div id="project-builder-result"></div>
  </section>`;
}
function creationManualWorkspace() {
  const approvedCount = (list) => (P[list] || []).filter((x) => entityWorkflowState(x).key === "APPROVED" && entityApprovedFileForState(x, "")).length;
  const sceneCount = P.scenes.length;
  const shotCount = P.shots.length;
  return `<div id="creation-manual">
  <section id="creation-global-style" class="creation-card global-style-card"><div class="creation-card-head"><div><span class="creation-kicker">STEP 1 · PROJECT LOOK</span><h3>Set the visual rules once</h3><p>These details automatically shape new location, character, prop, and shot-image prompts. Plain language works.</p></div><span class="creation-state ${globalStylePrompt() ? "ready" : "warn"}">${globalStylePrompt() ? "Style set" : "Start here"}</span></div><div class="creation-grid">${field("Global style prompt", `<textarea placeholder="Cinematic naturalism, damp medieval textures, smoke-softened torchlight, muted earth palette, practical grime…" onchange="setGlobalCreationField('globalStylePrompt',this.value)">${esc(P.meta?.globalStylePrompt || "")}</textarea>`)}${field("World / setting", `<textarea placeholder="Late-medieval border town in winter; poor river district; practical candle and hearth light…" onchange="setGlobalCreationField('worldSetting',this.value)">${esc(P.meta?.world?.setting || "")}</textarea>`)}${field("World / period exclusions", `<textarea placeholder="No modern objects, no clean fantasy theme-park surfaces, no legible text unless requested…" onchange="setGlobalCreationField('globalNegativePrompt',this.value)">${esc(P.meta?.globalNegativePrompt || P.meta?.world?.reject || "")}</textarea>`)}</div></section>
  <div class="creation-quick-grid">
    <button onclick="addEntity('locations')"><span>STEP 2</span><b>Create a location plate</b><small>Describe an empty environment and compile a reusable base-plate prompt.</small></button>
    <button onclick="addEntity('characters')"><span>STEP 3</span><b>Create a character anchor</b><small>Lock identity, wardrobe, proportions, and materials before placing the character in shots.</small></button>
    <button onclick="addEntity('props')"><span>OPTIONAL</span><b>Create a prop reference</b><small>Lock an object's shape, materials, scale, and wear when continuity matters.</small></button>
    <button onclick="addShot()"><span>STEP 4</span><b>Create the first shot</b><small>Add a scene automatically if needed, then describe the visible action and staging.</small></button>
  </div>
  <section class="creation-progress"><header><div><span class="creation-kicker">PROJECT AT A GLANCE</span><h3>${esc(P.meta.title)}</h3></div><a class="ghost-btn" href="#/production/scenes">Open scenes & shots →</a></header><div class="creation-metrics"><div><b>${sceneCount}</b><span>scenes</span></div><div><b>${shotCount}</b><span>shots</span></div><div><b>${approvedCount("locations")}/${P.locations.length}</b><span>approved locations</span></div><div><b>${approvedCount("characters")}/${P.characters.length}</b><span>approved characters</span></div><div><b>${approvedCount("props")}/${P.props.length}</b><span>approved props</span></div><div><b>${approvedCount("vehicles")}/${(P.vehicles || []).length}</b><span>approved vehicles</span></div></div>${!sceneCount ? `<div class="creation-empty-project"><h3>Your project is ready for its first scene</h3><p>Create a scene and shot now, or create the location and character references first.</p><button class="add-btn" onclick="addShot()">Create scene + first shot</button><button class="ghost-btn" onclick="addEntity('locations')">Create first location</button></div>` : `<div class="creation-project-actions"><article><span>RECOMMENDED</span><b>${esc(nextProductionShot()?.next?.label || "Continue production")}</b><small>${nextProductionShot() ? `${esc(nextProductionShot().shot.id)} · ${esc(nextProductionShot().shot.title)}` : "All current shots are final"}</small><button class="assemble-btn" onclick="continueProduction()">CONTINUE PRODUCTION →</button></article><article><span>PROJECT STRUCTURE</span><b>${sceneCount} scenes · ${shotCount} shots</b><small>Scene beats and the complete shot list now live in Production, where they can be filtered and paginated.</small><a class="ghost-btn" href="#/shots/board">OPEN SHOTS</a></article></div>`}</section>
  </div>`;
}
function creationStudioView() {
  const path = creationStartPath();
  return `<div class="view-head creation-view-head"><div><div class="eyebrow">Guided creation</div><span class="view-title">Build the first usable shot</span><div class="view-sub">CineBraid keeps the beginner path short while using the same workflow throughout.</div></div><button class="add-btn" onclick="newProject()">+ Project</button></div>
  ${creationStartChooser()}
  ${path === "import" ? `${creationImportCard()}<details class="alternate-start"><summary>Or continue manually</summary>${creationManualWorkspace()}</details>` : `${creationManualWorkspace()}<details class="alternate-start"><summary>Import an existing script or story instead</summary>${creationImportCard()}</details>`}`;
}


window.copyProjectBuilderSystemPrompt = async () => {
  try {
    const r = await fetch("/api/project-builder/system-prompt");
    if (!r.ok) throw new Error("Prompt kit unavailable");
    await navigator.clipboard.writeText(await r.text());
    toast("Project Builder system prompt copied");
  } catch (error) {
    toast("Could not copy prompt: " + error.message);
  }
};
window.readProjectBuilderFile = (input) => {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const box = document.getElementById("project-builder-json");
    if (box) box.value = reader.result;
  };
  reader.readAsText(file);
};
function projectBuilderReviewColumn(title, css, items, emptyText) {
  const row = (item) =>
    item && typeof item === "object"
      ? `<li class="import-review-value"><code>${esc(item.path || item.label || "Value")}</code><span>${esc(item.value || item.notes || "")}</span></li>`
      : `<li>${esc(item)}</li>`;
  return `<section class="import-review-column ${css}"><header><span>${esc(title)}</span><b>${items.length}</b></header>${items.length ? `<ul>${items.slice(0, 18).map(row).join("")}</ul>${items.length > 18 ? `<small>+ ${items.length - 18} more</small>` : ""}` : `<p>${esc(emptyText)}</p>`}</section>`;
}
function projectBuilderCountComparison(review) {
  const keys = [
    ["characters", "characters"],
    ["locations", "locations"],
    ["props", "props"],
    ["vehicles", "vehicles"],
    ["scenes", "scenes"],
    ["shots", "shots"],
    ["keyframes", "frames"],
    ["motionUnits", "motion units"],
  ];
  return `<div class="import-count-comparison">${keys
    .map(([key, label]) => {
      const before = Number(review.sourceCounts?.[key] || 0),
        after = Number(review.counts?.[key] || 0),
        changed = before !== after;
      return `<div class="${changed ? "changed" : ""}"><span>${esc(label)}</span><b>${before}${changed ? ` → ${after}` : ""}</b></div>`;
    })
    .join("")}</div>`;
}
function projectBuilderContinuityReview(states = []) {
  if (!states.length)
    return `<p class="import-outline-empty">No default or inferred continuity states require special attention.</p>`;
  return `<div class="import-continuity-list">${states
    .map(
      (state) => `<article class="${state.inferred ? "inferred" : ""}"><header><b>${esc(state.entityId)} · ${esc(state.entityName || state.kind)}</b><span>${state.isDefault ? "DEFAULT" : "STATE"}</span></header><strong>${esc(state.stateId)} · ${esc(state.stateName)}</strong>${state.notes ? `<p>${esc(state.notes)}</p>` : ""}</article>`,
    )
    .join("")}</div>`;
}
function projectBuilderOutline(outline = []) {
  if (!outline.length)
    return `<p class="import-outline-empty">No scene outline was produced.</p>`;
  return `<div class="import-project-outline">${outline
    .map(
      (scene, sceneIndex) => `<details ${sceneIndex === 0 ? "open" : ""}><summary><span>${esc(scene.id)} · ${esc(scene.title)}</span><b>${esc(scene.tier || "B")} · ${(scene.shots || []).length} shots</b></summary><div class="import-scene-summary"><p><strong>Story beat</strong>${esc(scene.whatHappens || "Missing")}</p><p><strong>Tone</strong>${esc(scene.howItFeels || "Missing")}</p></div><div class="import-shot-outline">${(scene.shots || [])
        .map(
          (shot) => `<article><header><div><span>${esc(shot.id)}</span><b>${esc(shot.title)}</b></div><i>${esc(shot.route || "GENERATE")} · ${esc(shot.duration || 0)}s</i></header><p>${esc(shot.description || "No visible action supplied.")}</p><small>${esc(shot.positioning || "No framing or contact guidance supplied.")}</small>${shot.risks?.length ? `<div class="import-shot-tags">${shot.risks.map((risk) => `<span>${esc(risk)}</span>`).join("")}</div>` : ""}<div class="import-shot-units">${(shot.keyframes || []).map((frame) => `<span><b>FRAME ${esc(frame.label || frame.id)}</b>${esc(frame.description || frame.title || "Needs description")}</span>`).join("")}${(shot.motionUnits || []).map((unit) => `<span><b>${esc((unit.kind || "motion").toUpperCase())} · ${esc(unit.duration || 0)}s</b>${esc(unit.motionPrompt || unit.title || "Needs motion direction")}</span>`).join("")}</div></article>`,
        )
        .join("")}</div></details>`,
    )
    .join("")}</div>`;
}
function renderProjectBuilderReview(data) {
  const review = data.review;
  const counts = review.counts;
  return `<div class="project-builder-review"><header><div><span class="creation-kicker">NORMALIZED IMPORT PREVIEW</span><h3>${esc(data.title)}</h3><p>${counts.scenes} scenes · ${counts.shots} shots · ${counts.characters} characters · ${counts.locations} locations · ${counts.props} props · ${counts.vehicles || 0} vehicles</p></div><span class="creation-state ready">Exact preview locked</span></header>${projectBuilderCountComparison(review)}<div class="import-preview-proof"><span>PREVIEW SHA-256</span><code>${esc(data.previewHash)}</code><button class="ghost-btn" onclick="downloadNormalizedProjectBuilderJSON()">Download normalized JSON</button></div><div class="import-review-legend"><span class="inferred">INFERRED</span><span class="missing">MISSING</span><span class="removed">REMOVED</span><span>REVIEW</span></div><div class="import-review-grid">${projectBuilderReviewColumn("Inferred values", "inferred", review.inferred, "No [INFERRED FOR PLANNING] values were found.")}${projectBuilderReviewColumn("Source conflicts", "review", review.conflicts || [], "No [SOURCE CONFLICT] values were found.")}${projectBuilderReviewColumn("Missing before production", "missing", review.missing, "No important descriptive gaps detected.")}${projectBuilderReviewColumn("Removed during import", "removed", review.removed, "No unsupported generated or approval claims detected.")}${projectBuilderReviewColumn("Needs human review", "review", review.review, "No additional warnings.")}</div><details class="import-normalized-section" open><summary>Normalized scene and shot plan</summary>${projectBuilderOutline(review.outline)}</details><details class="import-normalized-section"><summary>Continuity states CineBraid will import</summary>${projectBuilderContinuityReview(review.continuity)}</details><div class="creation-next-step"><div><span>SAFE EXACT IMPORT</span><b>The button imports this exact normalized preview into a separate project. Editing the source JSON requires a new validation.</b></div><button class="assemble-btn" onclick="commitProjectBuilderImport()">Import this exact preview →</button></div></div>`;
}
window.importProjectBuilderJSON = async () => {
  const out = document.getElementById("project-builder-result");
  try {
    const raw = document.getElementById("project-builder-json")?.value.trim();
    if (!raw) throw new Error("Paste or choose a JSON file first.");
    const project = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, ""));
    const r = await fetch("/api/projects/preview-import-json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Validation failed");
    window._projectBuilderCandidate = {
      previewToken: d.previewToken,
      previewHash: d.previewHash,
      normalizedProject: d.normalizedProject,
    };
    if (out) out.innerHTML = renderProjectBuilderReview(d);
  } catch (error) {
    window._projectBuilderCandidate = null;
    if (out) out.innerHTML = `<div class="prompt-check warn">${esc(error.message)}</div>`;
  }
};
window.downloadNormalizedProjectBuilderJSON = () => {
  const candidate = window._projectBuilderCandidate;
  if (!candidate?.normalizedProject)
    return toast("Validate the Project Builder JSON first");
  const project = candidate.normalizedProject,
    blob = new Blob([JSON.stringify(project, null, 2)], {
      type: "application/json",
    }),
    link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${String(project.meta?.title || "cinebraid-project")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "cinebraid-project"}_normalized.json`;
  link.click();
  URL.revokeObjectURL(link.href);
};
window.commitProjectBuilderImport = async () => {
  const candidate = window._projectBuilderCandidate;
  if (!candidate) return toast("Validate the Project Builder JSON first");
  const out = document.getElementById("project-builder-result");
  try {
    await flushPendingProjectSave();
    const r = await fetch("/api/projects/import-json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        previewToken: candidate.previewToken,
        previewHash: candidate.previewHash,
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Import failed");
    if (out) out.innerHTML = `<div class="prompt-check ok">Imported ${esc(d.counts.scenes)} scenes, ${esc(d.counts.shots)} shots, and ${esc(d.counts.characters + d.counts.locations + d.counts.props)} reusable references as a separate project.</div>`;
    window._projectBuilderCandidate = null;
    localStorage.setItem(CREATION_START_PATH_KEY, "manual");
    await load();
    location.hash = "#/create";
    toast("Reviewed Project Builder JSON imported");
  } catch (error) {
    if (out) out.innerHTML += `<div class="prompt-check warn">${esc(error.message)}</div>`;
  }
};

/* v5.8.2 regression labels retained: STEP 1 · SHOT IMAGE | STEP 2 · CHOOSE THE IMAGE | STEP 3 · OPTIONAL MOTION */

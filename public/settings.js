/* ---------- settings / import / export ---------- */

/* ---------- one honest save-state for every editable Settings subsection ----------
   The three storage domains behind Settings stay as they are: appearance and the
   assistant/generation configuration live in config.json, storage paths and naming
   rules go through the workspace endpoint that also creates and checks the folders,
   and project details ride the project record's own autosave. What was missing was a
   single, truthful way of saying which of those a panel is using and where a change
   currently stands, so a preview could never be mistaken for something stored. */
const SETTINGS_PANEL_STATE_COPY = {
  manual: {
    clean: "No unsaved changes.",
    dirty: "Unsaved changes — nothing is stored until you save.",
    saving: "Saving…",
    saved: "Saved.",
    error: "Could not save.",
  },
  apply: {
    clean: "No unsaved changes.",
    dirty: "Unsaved changes — nothing is applied until you apply them.",
    saving: "Applying…",
    saved: "Applied.",
    error: "Could not apply.",
  },
  preview: {
    clean: "No unsaved changes.",
    dirty: "Previewing unsaved changes — nothing is stored until you save.",
    saving: "Saving…",
    saved: "Saved.",
    error: "Could not save.",
  },
};
let SETTINGS_PANEL_BASELINE = null;
function settingsPanelStateElement() {
  return document.getElementById("settings-panel-state");
}
function settingsPanelControls() {
  const panel = document.querySelector(".settings-selected-tab");
  if (!panel) return [];
  return Array.from(panel.querySelectorAll("input, select, textarea"));
}
function settingsPanelValues() {
  return settingsPanelControls().map((el) => (el.type === "checkbox" ? String(el.checked) : String(el.value ?? "")));
}
window.setSettingsPanelState = (state, detail = "") => {
  const el = settingsPanelStateElement();
  if (!el) return;
  const copy = SETTINGS_PANEL_STATE_COPY[el.dataset.saveModel || "manual"] || SETTINGS_PANEL_STATE_COPY.manual;
  el.dataset.state = state;
  el.textContent = detail ? `${copy[state] || ""} ${detail}`.trim() : copy[state] || "";
};
/* Re-reads the panel and reports clean or dirty against the values it was rendered
   with, so reverting an edit by hand takes the panel back to "No unsaved changes". */
window.refreshSettingsPanelState = () => {
  const el = settingsPanelStateElement();
  if (!el || !SETTINGS_PANEL_BASELINE) return;
  const now = settingsPanelValues();
  const changed = now.length !== SETTINGS_PANEL_BASELINE.length
    || now.some((value, index) => value !== SETTINGS_PANEL_BASELINE[index]);
  setSettingsPanelState(changed ? "dirty" : "clean");
};
window.initSettingsPanel = () => {
  const panel = document.querySelector(".settings-selected-tab");
  if (!panel) return;
  SETTINGS_PANEL_BASELINE = settingsPanelValues();
  settingsPanelControls().forEach((el) => {
    el.addEventListener("input", refreshSettingsPanelState);
    el.addEventListener("change", refreshSettingsPanelState);
  });
  if (settingsPanelStateElement()) setSettingsPanelState("clean");
  if (panel.dataset.settingsTab === "naming" && typeof updateFilenameTemplatePreview === "function") updateFilenameTemplatePreview();
  if (panel.dataset.settingsTab === "appearance") {
    setAppearancePreview(null);
    updateInterfaceScaleReadout();
  }
};
/* Accepts the values the server confirmed as the new baseline, so a saved panel
   reports itself clean without being re-rendered from scratch. */
function settingsPanelSaved(detail = "") {
  SETTINGS_PANEL_BASELINE = settingsPanelValues();
  setSettingsPanelState("saved", detail);
}

async function persistPassSettings(body) {
  const r = await fetch("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const note = $("#pass-note");
  if (note) note.textContent = r.ok
    ? "saved — sign in at /login.html once auth is on"
    : "save failed";
}
window.finishBlankEditorPass = async (mode) => {
  const body = window._pendingPassSettings || {};
  window._pendingPassSettings = null;
  if (mode === "clear") body.editorPass = "";
  closeModal();
  await persistPassSettings(body);
};
window.savePass = async () => {
  const body = {};
  const e = $("#cfg-epass").value, v = $("#cfg-vpass").value;
  if (e !== "") body.editorPass = e;
  if (v !== "") body.viewerPass = v;
  if (e === "") {
    window._pendingPassSettings = body;
    openModal(`<h3>Editor passcode is blank</h3><p class="modal-confirm-message">Choose whether to leave the existing editor passcode unchanged or turn editor authentication off.</p><div class="modal-actions"><button class="cancel" onclick="window._pendingPassSettings=null;closeModal()">Cancel</button><button class="ghost-btn" onclick="finishBlankEditorPass('keep')">KEEP UNCHANGED</button><button class="danger-btn" onclick="finishBlankEditorPass('clear')">TURN AUTH OFF</button></div>`);
    return;
  }
  await persistPassSettings(body);
};
window.setAssistantProvider = async (v) => {
  const r = await fetch("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assistant: { provider: v } }),
  });
  if (r.ok) {
    CONFIG.assistant = { ...(CONFIG.assistant || {}), provider: v };
    toast("AI assistant updated");
    route();
  } else toast("Could not update assistant");
};
window.testAssistantConnection = async () => {
  const note = $("#assistant-test-note");
  if (note) note.textContent = "testing…";
  try {
    const r = await fetch("/api/assistant/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: CONFIG.assistant?.provider || "ollama",
        }),
      }),
      d = await r.json();
    if (!r.ok) throw new Error(d.error);
    if (note) note.textContent = "Connected: " + (d.message || d.provider);
    toast("Assistant connected");
  } catch (e) {
    if (note) note.textContent = "Connection failed: " + e.message;
    toast("Assistant test failed");
  }
};
/* Only the fields the open panel actually shows are sent. Assistant and Generation
   share one configuration document, and sending every field from whichever panel
   happened to be open overwrote the other panel's settings with placeholder
   defaults — saving Generation silently reset the vision assistant to "Same as main
   assistant". A panel now patches its own settings and nothing else. */
function assistantConfigPatch() {
  const v = (id, fallback = "") => $(id)?.value ?? fallback;
  const patch = {};
  if ($("#assistant-vision-provider")) {
    patch.assistant = { provider: CONFIG.assistant?.provider || "ollama", visionProvider: v("#assistant-vision-provider", "same") };
  }
  if ($("#cfg-continuity-provider")) {
    patch.continuity = {
      visionProvider: v("#cfg-continuity-provider", CONFIG.continuity?.visionProvider || ""),
      /* Blank keeps continuity on the chosen provider's own connection, which is
         how every install written before this field behaved. */
      baseUrl: v("#cfg-continuity-base", CONFIG.continuity?.baseUrl || "").trim(),
      visionModel: v("#cfg-continuity-model", CONFIG.continuity?.visionModel || "").trim(),
    };
  }
  if ($("#cfg-key")) {
    patch.anthropicKey = v("#cfg-key", CONFIG.anthropicKey || "");
    patch.anthropicModel = v("#cfg-model", CONFIG.anthropicModel || "claude-sonnet-4-6");
    patch.anthropicVisionModel = v("#cfg-model", CONFIG.anthropicModel || "claude-sonnet-4-6");
  }
  if ($("#cfg-openai-key")) {
    patch.openaiKey = v("#cfg-openai-key", CONFIG.openaiKey || "");
    patch.openaiModel = v("#cfg-openai-model", CONFIG.openaiModel || "gpt-5.2");
    patch.openaiVisionModel = v("#cfg-openai-vision", CONFIG.openaiVisionModel || CONFIG.openaiModel || "gpt-5.2");
  }
  if ($("#cfg-custom-url")) {
    patch.customBaseUrl = v("#cfg-custom-url", CONFIG.customBaseUrl || "http://127.0.0.1:8000/v1");
    patch.customKey = v("#cfg-custom-key", CONFIG.customKey || "");
    patch.customModel = v("#cfg-custom-model", CONFIG.customModel || "");
    patch.customVisionModel = v("#cfg-custom-vision", CONFIG.customVisionModel || "");
    /* Blank stays blank: the server treats an empty optional request setting as
       "do not send this field to the custom endpoint at all". */
    patch.customTemperature = String(v("#cfg-custom-temperature", "")).trim();
    patch.customTopK = String(v("#cfg-custom-top-k", "")).trim();
    patch.customThinking = v("#cfg-custom-thinking", CONFIG.customThinking || "auto");
  }
  if ($("#cfg-ollama")) {
    patch.ollamaUrl = v("#cfg-ollama", CONFIG.ollamaUrl || "http://localhost:11434").trim();
    patch.ollamaModel = v("#cfg-omodel", CONFIG.ollamaModel || "").trim();
    patch.ollamaVisionModel = v("#cfg-vmodel", CONFIG.ollamaVisionModel || "").trim();
  }
  return patch;
}
function generationConfigPatch() {
  const v = (id, fallback = "") => $(id)?.value ?? fallback;
  if (!$("#cfg-fal-enabled")) return {};
  return {
    generation: {
      fal: {
        enabled: !!$("#cfg-fal-enabled").checked,
        apiKey: v("#cfg-fal-key", CONFIG.generation?.fal?.apiKey || ""),
        textModel: v("#cfg-fal-text-model", CONFIG.generation?.fal?.textModel || "openai/gpt-image-2").trim(),
        editModel: v("#cfg-fal-edit-model", CONFIG.generation?.fal?.editModel || "openai/gpt-image-2/edit").trim(),
        h3TextModel: v("#cfg-fal-h3-text-model", CONFIG.generation?.fal?.h3TextModel || "minimax/h3/text-to-video").trim(),
        h3ImageModel: v("#cfg-fal-h3-image-model", CONFIG.generation?.fal?.h3ImageModel || "minimax/h3/image-to-video").trim(),
        h3ReferenceModel: v("#cfg-fal-h3-reference-model", CONFIG.generation?.fal?.h3ReferenceModel || "minimax/h3/reference-to-video").trim(),
        h3Resolution: v("#cfg-fal-h3-resolution", CONFIG.generation?.fal?.h3Resolution || "2K"),
        blockingOutputs: Number(v("#cfg-fal-blocking-outputs", CONFIG.generation?.fal?.blockingOutputs || "2")) || 2,
        frameOutputs: Number(v("#cfg-fal-frame-outputs", CONFIG.generation?.fal?.frameOutputs || "2")) || 2,
        blockingQuality: v("#cfg-fal-blocking-quality", CONFIG.generation?.fal?.blockingQuality || "low"),
        frameQuality: v("#cfg-fal-frame-quality", CONFIG.generation?.fal?.frameQuality || "high"),
        blockingResolution: v("#cfg-fal-blocking-resolution", CONFIG.generation?.fal?.blockingResolution || "1k"),
        frameResolution: v("#cfg-fal-frame-resolution", CONFIG.generation?.fal?.frameResolution || "1k"),
        estimatedCostPerImage: Math.max(0, Number(v("#cfg-fal-cost-per-image", CONFIG.generation?.fal?.estimatedCostPerImage || "0")) || 0),
        maxConcurrent: Number(CONFIG.generation?.fal?.maxConcurrent || 1),
        requireConfirmation: true,
      },
    },
  };
}
window.saveConfig = async (scope = "assistant") => {
  const generation = scope === "generation";
  const body = generation ? generationConfigPatch() : assistantConfigPatch();
  const failed = generation ? "Could not save generation settings" : "Could not save assistant settings";
  setSettingsPanelState("saving");
  let r;
  try {
    r = await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch (error) {
    setSettingsPanelState("error", "The CineBraid server did not respond — check that it is still running.");
    return toast(failed);
  }
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    setSettingsPanelState("error", data.error || "The server rejected the change.");
    return toast(failed);
  }
  CONFIG = await fetch("/api/config").then((response) => response.json()).catch(() => ({ ...CONFIG, ...body, generation: { ...(CONFIG.generation || {}), ...(body.generation || {}), fal: { ...(CONFIG.generation?.fal || {}), ...(body.generation?.fal || {}), apiKey: body.generation?.fal?.apiKey ? "••••saved" : "" } } }));
  /* Capability readiness is derived from this configuration, so it is stale the
     moment the configuration changes. Ask once, here, on the save the user just
     made — the workspace then shows a newly configured provider as available
     without a page reload, and a removed one as unavailable. Deliberately one
     request on an explicit action rather than any kind of polling. */
  if (typeof refreshAgentStatus === "function") await refreshAgentStatus(false);
  settingsPanelSaved();
  toast(generation ? "Generation settings saved" : "Assistant settings saved");
  route();
};
window.testFalGenerationConnection = async () => {
  const note = $("#fal-test-note");
  const state = (tone, text) => { if (!note) return; note.dataset.tone = tone; note.textContent = text; };
  state("checking", "Checking setup…");
  try {
    const response = await fetch("/api/generation/fal/test", { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "FAL setup check failed");
    state("ready", data.message || "FAL generation is set up");
    toast("FAL generation is configured");
  } catch (error) {
    state("attention", error.message);
    toast("FAL setup is incomplete");
  }
};
window.doExport = async () => {
  const note = $("#export-note");
  if (note) note.textContent = "Exporting…";
  const r = await (await fetch("/api/export", { method: "POST" })).json();
  if (note) note.textContent = r.ok
    ? "Exported to docs/" + r.name
    : "Export failed: " + r.error;
};
window.downloadJSON = () => {
  const blob = new Blob([JSON.stringify(P, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download =
    (P.meta.title || "project").replace(/\W+/g, "_") +
    "_data_" +
    new Date().toISOString().slice(0, 10) +
    ".json";
  a.click();
};


/* ---------- project recovery ---------- */
window.createManualProjectBackup = async () => {
  const slug = activeProjectSlug();
  if (!slug) return toast("No active project");
  const note = document.getElementById("project-backup-note");
  if (note) note.textContent = "Creating backup…";
  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/backups`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Backup failed");
    if (note) note.textContent = `Backup created: ${data.name}`;
    toast("Project backup created");
    route();
  } catch (error) {
    if (note) note.textContent = error.message;
    toast("Could not create project backup");
  }
};
window.restoreProjectBackup = (name) => {
  const slug = activeProjectSlug();
  if (!slug || !name) return toast("No active project to restore into");
  confirmModal(`Restore ${name}? CineBraid will first create a safety backup of the current project.`, async () => {
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Restore failed");
      toast("Project restored — reloading");
      setTimeout(() => location.reload(), 350);
    } catch (error) {
      toast(error.message || "Could not restore project");
    }
  }, { title: "Restore project backup", confirmLabel: "RESTORE", danger: false });
};


/* ---------- studio appearance / workspace settings ---------- */
function filenameTemplatePreviewValue(template, config = CONFIG) {
  const naming = config?.naming || {};
  const versionPadding = Math.max(2, Math.min(5, Number(naming.versionPadding || 3) || 3));
  const tokens = {
    project: "SIGNAL_BLOOM",
    scene: "SC04",
    shot: "SH013",
    slot: "PRIMARY",
    stage: "SHOT",
    state: "DEFAULT",
    version: String(3).padStart(versionPadding, "0"),
    ext: "png",
  };
  let out = String(template || "{project}_{shot}_{slot}_V{version}.{ext}");
  Object.entries(tokens).forEach(([key, value]) => {
    out = out.replaceAll(`{${key}}`, value);
  });
  return out;
}
window.updateFilenameTemplatePreview = () => {
  const template = $("#cfg-filename-template")?.value || CONFIG?.naming?.filenameTemplate || "{project}_{shot}_{slot}_V{version}.{ext}";
  const target = $("#cfg-filename-preview");
  if (target) target.textContent = filenameTemplatePreviewValue(template, {
    ...CONFIG,
    naming: {
      ...(CONFIG?.naming || {}),
      versionPadding: $("#cfg-version-padding")?.value || CONFIG?.naming?.versionPadding || 3,
    },
  });
};
/* Keeps the percentage readout and the filled part of the track in step with the
   handle, so the control reads as one CineBraid component rather than an OS widget. */
window.updateInterfaceScaleReadout = () => {
  const slider = $("#cfg-ui-scale");
  if (!slider) return;
  const min = Number(slider.min || 90), max = Number(slider.max || 110);
  const value = Number(slider.value || 100);
  const readout = $("#cfg-ui-scale-readout");
  if (readout) readout.textContent = `${value}%`;
  if (slider.style?.setProperty) slider.style.setProperty("--range-fill", `${max > min ? ((value - min) / (max - min)) * 100 : 50}%`);
};
function appearanceFormValues() {
  return {
    accent: $("#cfg-theme-accent")?.value || "blue",
    surface: $("#cfg-theme-surface")?.value || "night",
    scale: Number($("#cfg-ui-scale")?.value || 100) || 100,
    density: $("#cfg-ui-density")?.value || "comfortable",
    helpMode: $("#cfg-help-mode")?.value || "guided",
    font: $("#cfg-ui-font")?.value || "studio",
  };
}
/* Changing a control repaints the workspace so the choice can be judged at full size,
   but the preview is held in memory only. Nothing is written until Save. */
window.previewAppearanceSettings = () => {
  updateInterfaceScaleReadout();
  setAppearancePreview(appearanceFormValues());
  refreshSettingsPanelState();
};
window.discardAppearancePreview = () => {
  setAppearancePreview(null);
  route();
  toast("Preview discarded — the saved appearance is back");
};
/* Loads the CineBraid defaults into the form as a preview like any other change, so
   "Reset" is reviewable and still requires Save to take effect. */
window.resetAppearanceSettings = () => {
  const defaults = { accent: "blue", surface: "night", scale: 100, density: "comfortable", font: "studio" };
  const set = (id, value) => { const el = $(id); if (el) el.value = String(value); };
  set("#cfg-theme-accent", defaults.accent);
  set("#cfg-theme-surface", defaults.surface);
  set("#cfg-ui-scale", defaults.scale);
  set("#cfg-ui-density", defaults.density);
  set("#cfg-ui-font", defaults.font);
  const readout = $("#cfg-ui-scale-readout");
  if (readout) readout.textContent = `${defaults.scale}%`;
  previewAppearanceSettings();
};
window.saveAppearanceSettings = async () => {
  const body = { appearance: appearanceFormValues() };
  setSettingsPanelState("saving");
  let r;
  try {
    r = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    setSettingsPanelState("error", "The CineBraid server did not respond — check that it is still running.");
    return toast("Could not save appearance settings");
  }
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    setSettingsPanelState("error", data.error || "The server rejected the change.");
    return toast("Could not save appearance settings");
  }
  /* Saved on the server first, then in this browser, so the stored theme can never
     claim an appearance the server does not hold. */
  commitWorkspaceAppearance(body.appearance);
  setHelpMode(body.appearance.helpMode);
  CONFIG = await fetch("/api/config").then((response) => response.json()).catch(() => ({ ...CONFIG, ...body }));
  settingsPanelSaved();
  toast("Appearance saved");
  route();
};

/* Storage paths and naming rules share one endpoint because the server has to create
   the folders and check write access before it records either. They no longer share a
   request body: a panel sends only the fields it is showing, so saving naming rules
   cannot blank the storage paths it never displayed. */
async function persistWorkspaceSettings(scope) {
  const present = (id, read = (el) => el.value) => { const el = $(id); return el ? read(el) : undefined; };
  const compact = (entries) => Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined));
  const workspace = compact({
    projectRoot: present("#cfg-project-root"),
    mediaRoot: present("#cfg-media-root"),
    outputRoot: present("#cfg-output-root"),
    backupRoot: present("#cfg-backup-root"),
    fileStrategy: present("#cfg-file-strategy"),
    syncMode: present("#cfg-sync-mode"),
  });
  const naming = compact({
    filenameTemplate: present("#cfg-filename-template"),
    exportTemplate: present("#cfg-export-template"),
    versionPadding: present("#cfg-version-padding", (el) => Number(el.value || 3) || 3),
    collisionBehavior: present("#cfg-collision-behavior"),
  });
  const body = {};
  if (Object.keys(workspace).length) body.workspace = workspace;
  if (Object.keys(naming).length) body.naming = naming;

  const storage = scope === "workspace";
  const note = $("#workspace-settings-note");
  setSettingsPanelState("saving");
  if (note) note.textContent = "Applying paths and checking write access…";
  let r;
  try {
    r = await fetch("/api/workspace/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    setSettingsPanelState("error", "The CineBraid server did not respond — check that it is still running.");
    if (note) note.textContent = "The CineBraid server did not respond — check that it is still running.";
    return toast(storage ? "Could not apply storage paths" : "Could not save naming rules");
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const reason = data.error || "The server rejected the change.";
    setSettingsPanelState("error", reason);
    if (note) note.textContent = reason;
    return toast(storage ? "Could not apply storage paths" : "Could not save naming rules");
  }
  CONFIG = await fetch("/api/config").then((response) => response.json()).catch(() => ({ ...CONFIG, ...body }));
  updateFilenameTemplatePreview();
  const applied = data.migration?.movedRoot
    ? `Copied ${data.migration.copied || 0} files into the new project folder; ${data.migration.skipped || 0} existing files were kept.`
    : storage ? "These folders exist and are writable." : "";
  settingsPanelSaved(applied);
  if (note && storage) note.textContent = applied;
  toast(data.migration?.movedRoot ? "Project folder moved safely" : storage ? "Storage paths applied" : "Naming rules saved");
}
window.saveStorageSettings = () => persistWorkspaceSettings("workspace");
window.saveNamingSettings = () => persistWorkspaceSettings("naming");
window.refreshWorkspaceStatus = async () => {
  const note = $("#workspace-settings-note");
  if (note) note.textContent = "Checking effective paths…";
  try {
    const r = await fetch("/api/workspace/status");
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Status check failed");
    if (note) note.textContent = `Active project root: ${data.projectRoot}${data.outputRoot ? ` · exports: ${data.outputRoot}` : ""}${data.backupRoot ? ` · backups: ${data.backupRoot}` : ""}`;
  } catch (error) {
    if (note) note.textContent = error.message;
  }
};

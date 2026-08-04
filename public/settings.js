/* ---------- settings / import / export ---------- */
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
window.saveConfig = async () => {
  const v = (id, fallback = "") => $(id)?.value ?? fallback;
  const body = {
    assistant: { provider: CONFIG.assistant?.provider || "ollama", visionProvider: v("#assistant-vision-provider", "same") },
    anthropicKey: v("#cfg-key", CONFIG.anthropicKey || ""), anthropicModel: v("#cfg-model", CONFIG.anthropicModel || "claude-sonnet-4-6"), anthropicVisionModel: v("#cfg-model", CONFIG.anthropicModel || "claude-sonnet-4-6"),
    openaiKey: v("#cfg-openai-key", CONFIG.openaiKey || ""), openaiModel: v("#cfg-openai-model", CONFIG.openaiModel || "gpt-5.2"), openaiVisionModel: v("#cfg-openai-vision", CONFIG.openaiVisionModel || CONFIG.openaiModel || "gpt-5.2"),
    customBaseUrl: v("#cfg-custom-url", CONFIG.customBaseUrl || "http://127.0.0.1:8000/v1"), customKey: v("#cfg-custom-key", CONFIG.customKey || ""), customModel: v("#cfg-custom-model", CONFIG.customModel || ""), customVisionModel: v("#cfg-custom-vision", CONFIG.customVisionModel || ""),
    ollamaUrl: v("#cfg-ollama", CONFIG.ollamaUrl || "http://localhost:11434").trim(), ollamaModel: v("#cfg-omodel", CONFIG.ollamaModel || "").trim(), ollamaVisionModel: v("#cfg-vmodel", CONFIG.ollamaVisionModel || "").trim(),
    generation: {
      fal: {
        enabled: $("#cfg-fal-enabled") ? !!$("#cfg-fal-enabled").checked : !!CONFIG.generation?.fal?.enabled,
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
  const r = await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) return toast("Could not save AI settings");
  CONFIG = await fetch("/api/config").then((response) => response.json()).catch(() => ({ ...CONFIG, ...body, generation: { ...(CONFIG.generation || {}), ...(body.generation || {}), fal: { ...(CONFIG.generation?.fal || {}), ...(body.generation?.fal || {}), apiKey: body.generation?.fal?.apiKey ? "••••saved" : "" } } }));
  toast("Settings saved");
  route();
};
window.testFalGenerationConnection = async () => {
  const note = $("#fal-test-note");
  if (note) note.textContent = "checking…";
  try {
    const response = await fetch("/api/generation/fal/test", { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "FAL setup check failed");
    if (note) note.textContent = data.message || "FAL configured";
    toast("FAL generation is configured");
  } catch (error) {
    if (note) note.textContent = error.message;
    toast("FAL setup is incomplete");
  }
};
window.doExport = async () => {
  const r = await (await fetch("/api/export", { method: "POST" })).json();
  $("#export-note").textContent = r.ok
    ? "exported → docs/" + r.name
    : "export failed: " + r.error;
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
window.previewAppearanceSettings = () => {
  previewWorkspaceAppearance({
    accent: $("#cfg-theme-accent")?.value || "blue",
    surface: $("#cfg-theme-surface")?.value || "night",
    scale: $("#cfg-ui-scale")?.value || 100,
    density: $("#cfg-ui-density")?.value || "comfortable",
    font: $("#cfg-ui-font")?.value || "studio",
  });
};
window.resetAppearanceSettings = () => {
  localStorage.setItem("ahub-acc", "blue");
  localStorage.setItem("ahub-surf", "night");
  localStorage.setItem("cinebraid-ui-scale", "100");
  localStorage.setItem("cinebraid-ui-density", "comfortable");
  localStorage.setItem("cinebraid-ui-font", "studio");
  applyTheme();
  route();
};
window.saveAppearanceSettings = async () => {
  const body = {
    appearance: {
      accent: $("#cfg-theme-accent")?.value || "blue",
      surface: $("#cfg-theme-surface")?.value || "night",
      scale: Number($("#cfg-ui-scale")?.value || 100) || 100,
      density: $("#cfg-ui-density")?.value || "comfortable",
      helpMode: $("#cfg-help-mode")?.value || "guided",
      font: $("#cfg-ui-font")?.value || "studio",
    },
  };
  previewWorkspaceAppearance(body.appearance);
  setHelpMode(body.appearance.helpMode);
  const r = await fetch("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) return toast("Could not save appearance settings");
  CONFIG = await fetch("/api/config").then((response) => response.json()).catch(() => ({ ...CONFIG, ...body }));
  toast("Appearance settings saved");
  route();
};
window.saveWorkspaceSettings = async () => {
  const body = {
    workspace: {
      projectRoot: $("#cfg-project-root")?.value || "",
      mediaRoot: $("#cfg-media-root")?.value || "",
      outputRoot: $("#cfg-output-root")?.value || "",
      backupRoot: $("#cfg-backup-root")?.value || "",
      fileStrategy: $("#cfg-file-strategy")?.value || "project/scene/shot",
      syncMode: $("#cfg-sync-mode")?.value || "manual",
    },
    naming: {
      filenameTemplate: $("#cfg-filename-template")?.value || "{project}_{shot}_{slot}_V{version}.{ext}",
      exportTemplate: $("#cfg-export-template")?.value || "{project}_{scene}_{shot}_{stage}_V{version}.{ext}",
      versionPadding: Number($("#cfg-version-padding")?.value || 3) || 3,
      collisionBehavior: $("#cfg-collision-behavior")?.value || "increment",
    },
  };
  const note = $("#workspace-settings-note");
  if (note) note.textContent = "Applying paths and checking write access…";
  const r = await fetch("/api/workspace/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (note) note.textContent = data.error || "Could not apply workspace settings";
    return toast("Could not save workspace settings");
  }
  CONFIG = await fetch("/api/config").then((response) => response.json()).catch(() => ({ ...CONFIG, ...body }));
  updateFilenameTemplatePreview();
  if (note) note.textContent = data.migration?.movedRoot
    ? `Applied. Copied ${data.migration.copied || 0} files into the new project root; ${data.migration.skipped || 0} existing files were kept.`
    : "Applied. Paths are writable and active.";
  toast(data.migration?.movedRoot ? "Workspace moved safely" : "Workspace settings saved");
  setTimeout(route, 500);
};
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

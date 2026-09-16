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
let SETTINGS_CONFIG_REFRESH_REQUIRED = false;
let SETTINGS_CONFIG_STALE_DISPLAY = null;
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
function settingsPanelHasUnsavedChanges() {
  if (!SETTINGS_PANEL_BASELINE) return false;
  const now = settingsPanelValues();
  return now.length !== SETTINGS_PANEL_BASELINE.length
    || now.some((value, index) => value !== SETTINGS_PANEL_BASELINE[index]);
}
window.refreshSettingsPanelState = () => {
  if (!settingsPanelStateElement() || !SETTINGS_PANEL_BASELINE) return;
  setSettingsPanelState(settingsPanelHasUnsavedChanges() ? "dirty" : "clean");
};
function settingsCheckBlocked(note) {
  if (SETTINGS_CONFIG_REFRESH_REQUIRED && CONFIG !== SETTINGS_CONFIG_STALE_DISPLAY)
    SETTINGS_CONFIG_REFRESH_REQUIRED = false;
  const reason = settingsPanelHasUnsavedChanges()
    ? "Save or discard these changes first. This check uses saved settings."
    : SETTINGS_CONFIG_REFRESH_REQUIRED
      ? "Settings were saved, but their safe display could not be refreshed. Reload Settings before checking."
      : "";
  if (reason) {
    if (note) note.textContent = reason;
    toast(reason);
  }
  return Boolean(reason);
}
window.initSettingsPanel = () => {
  const panel = document.querySelector(".settings-selected-tab");
  if (!panel) return;
  if (typeof studioDraftKey === "function") studioDraftKey(panel);
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
  if (typeof window.studioRestoreSettingsDraft === "function") {
    window.studioRestoreSettingsDraft();
    if (settingsPanelStateElement()?.dataset.state !== "error") refreshSettingsPanelState();
  }
};
/* Accepts the values the server confirmed as the new baseline, so a saved panel
   reports itself clean without being re-rendered from scratch. */
function settingsPanelSaved(detail = "", savedValues = null) {
  SETTINGS_PANEL_BASELINE = savedValues || settingsPanelValues();
  setSettingsPanelState("saved", detail);
  if (typeof window.studioClearSettingsDraft === "function") window.studioClearSettingsDraft();
  if (settingsPanelHasUnsavedChanges()) {
    setSettingsPanelState("dirty", `Earlier changes were saved; newer edits still need saving. ${detail}`.trim());
    if (typeof window.studioCaptureSettingsDraft === "function") window.studioCaptureSettingsDraft();
  }
}

/* Save completion belongs to the panel that initiated it, even when navigation
   replaces that panel while the request is pending. Snapshots live only for the
   request; the draft manager receives a masked saved baseline on success. */
function settingsWriteOwner() {
  const panel = document.querySelector(".settings-selected-tab");
  return {
    panel,
    key: typeof studioDraftKey === "function" ? studioDraftKey(panel) : panel?.dataset?.settingsTab || "",
    fields: settingsPanelControls().map((input, index) => ({
      id: input.id || "", index, input,
      value: input.type === "checkbox" ? String(input.checked) : String(input.value ?? ""),
    })),
  };
}
function settingsWriteIsCurrent(owner) {
  const panel = document.querySelector(".settings-selected-tab");
  return !!panel && (typeof studioDraftKey === "function"
    ? studioDraftKey(panel) === owner.key : panel === owner.panel);
}
function settingsWriteFailed(owner, reason) {
  if (settingsWriteIsCurrent(owner)) setSettingsPanelState("error", reason);
  else if (typeof window.studioSettingsDraftError === "function") window.studioSettingsDraftError(owner.key, reason);
}
function settingsWriteSaved(owner, { body = {}, config = null, detail = "", passcodes = false } = {}) {
  const saved = owner.fields.map(({ id, index, value }) => ({ id, index, value }));
  for (const [selector, parts] of SETTINGS_SECRET_INPUTS) {
    const submitted = settingsValueAt(body, parts);
    const field = saved.find((row) => row.id === selector.slice(1));
    if (field && submitted !== undefined) {
      field.secret = true;
      field.value = config ? String(settingsValueAt(config, parts) || "") : submitted ? "••••saved" : "";
    }
  }
  if (passcodes) {
    for (const field of saved) if (["cfg-epass", "cfg-vpass"].includes(field.id)) field.value = "";
  }
  const current = settingsWriteIsCurrent(owner);
  const activeControls = current ? settingsPanelControls() : [];
  for (const field of saved) {
    const original = owner.fields[field.index];
    const targets = new Set([original.input, activeControls.find((input, index) => field.id ? input.id === field.id : index === field.index)]);
    for (const input of targets) {
      if (!input || input.type === "checkbox" || field.value === original.value) continue;
      if (String(input.value) === original.value || String(input.value) === "••••saved") {
        input.value = field.value;
        if (SETTINGS_SECRET_INPUTS.some(([selector]) => selector.slice(1) === field.id)) input.type = "password";
      }
    }
  }
  if (typeof window.studioReconcileSettingsDraft === "function")
    window.studioReconcileSettingsDraft(owner.key, saved, owner.fields);
  if (current) {
    const values = activeControls.map((input, index) => {
      const field = saved.find((row) => input.id ? row.id === input.id : row.index === index);
      return field ? field.value : input.type === "checkbox" ? String(input.checked) : String(input.value ?? "");
    });
    settingsPanelSaved(detail, values);
  }
  /* The request snapshot must not retain a submitted credential after settlement. */
  owner.fields.forEach((field, index) => { field.value = saved[index].value; });
  return current;
}

/* ---------- LAN access passcodes ----------
   The editor and viewer passcodes are stored settings like any other, but they are
   the only ones whose current value the browser is never given: the config secret
   registry replaces each with a set/unset marker. So the two boxes are write-only,
   they always start empty, and a blank box means "leave the stored one alone".

   For three phases these functions had no controls to read. Settings rendered no
   passcode panel at all, so savePass() dereferenced a null input and died with a
   bare TypeError — while the product told LAN users to set an editor passcode.
   Missing controls are now a stated failure that sends nothing, rather than a
   stack trace that looks like a save which quietly did not happen. */
function passcodeInputs() {
  const editor = $("#cfg-epass"), viewer = $("#cfg-vpass");
  return editor && viewer ? { editor, viewer } : null;
}
function passcodeSaveFailed(reason) {
  const note = $("#pass-note");
  if (note) note.textContent = reason;
  setSettingsPanelState("error", reason);
  toast("Could not save passcodes");
}
async function persistPassSettings(body) {
  const fields = passcodeInputs();
  if (!fields) return passcodeSaveFailed("The passcode fields are not on screen — open Settings → Access & security and try again.");
  const owner = settingsWriteOwner();
  setSettingsPanelState("saving");
  let r;
  try {
    r = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const reason = "The CineBraid server did not respond — check that it is still running.";
    settingsWriteFailed(owner, reason);
    if (settingsWriteIsCurrent(owner)) { const note = $("#pass-note"); if (note) note.textContent = reason; }
    return toast("Could not save passcodes");
  }
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    const reason = data.error || "The server rejected the change.";
    settingsWriteFailed(owner, reason);
    if (settingsWriteIsCurrent(owner)) { const note = $("#pass-note"); if (note) note.textContent = reason; }
    return toast("Could not save passcodes");
  }
  /* A passcode that has been stored does not stay sitting in the page, and the
     stored one is never read back to replace it. */
  const current = settingsWriteIsCurrent(owner);
  const held = Object.prototype.hasOwnProperty.call(body, "editorPass") ? !!body.editorPass : !!CONFIG?.editorPass;
  const state = (id, on) => { const el = current ? $(id) : null; if (el) el.textContent = on ? "Set" : "Not set"; };
  if (Object.prototype.hasOwnProperty.call(body, "editorPass")) state("#cfg-epass-state", !!body.editorPass);
  if (Object.prototype.hasOwnProperty.call(body, "viewerPass")) state("#cfg-vpass-state", !!body.viewerPass);
  if (CONFIG) {
    if (Object.prototype.hasOwnProperty.call(body, "editorPass")) CONFIG.editorPass = body.editorPass ? "(set)" : "";
    if (Object.prototype.hasOwnProperty.call(body, "viewerPass")) CONFIG.viewerPass = body.viewerPass ? "(set)" : "";
  }
  settingsWriteSaved(owner, { body, passcodes: true });
  /* Deliberately no re-render. The moment an editor passcode exists the server gates
     every request, so this browser's next call is answered with "Sign in" until it
     has been through /login.html — re-reading the configuration here would replace a
     working panel with the empty defaults of a refused response. */
  const note = current ? $("#pass-note") : null;
  if (note) note.textContent = !Object.keys(body).length
    ? "Nothing changed — both boxes were left blank, so the stored passcodes are untouched."
    : held
      ? "Saved. This browser and every other device must now sign in at /login.html."
      : body.editorPass === ""
        ? "Saved. Editor authentication is off — CineBraid no longer asks anyone for a passcode."
        : "Saved. A viewer passcode only takes effect once an editor passcode is set.";
  toast("Passcodes saved");
}
window.finishBlankEditorPass = async (mode) => {
  const body = window._pendingPassSettings || {};
  window._pendingPassSettings = null;
  if (mode === "clear") body.editorPass = "";
  closeModal();
  await persistPassSettings(body);
};
window.savePass = async () => {
  const fields = passcodeInputs();
  if (!fields) return passcodeSaveFailed("The passcode fields are not on screen — open Settings → Access & security and try again.");
  const body = {};
  const e = fields.editor.value, v = fields.viewer.value;
  if (e !== "") body.editorPass = e;
  if (v !== "") body.viewerPass = v;
  /* A blank editor box is ambiguous only while there is a passcode to lose, so that
     is the only time it is worth a question. The choice is preserved exactly as it
     was written: KEEP UNCHANGED omits editorPass, TURN AUTH OFF sends "". With no
     passcode stored, both branches produce the same request, and asking would offer
     to switch off something that is already off. */
  if (e === "" && CONFIG?.editorPass) {
    window._pendingPassSettings = body;
    openModal(`<h3>Editor passcode is blank</h3><p class="modal-confirm-message">Choose whether to leave the existing editor passcode unchanged or turn editor authentication off. Turning it off lets anyone who can reach this address edit the production.</p><div class="modal-actions"><button class="cancel" onclick="window._pendingPassSettings=null;closeModal()">Cancel</button><button class="ghost-btn" onclick="finishBlankEditorPass('keep')">KEEP UNCHANGED</button><button class="danger-btn" onclick="finishBlankEditorPass('clear')">TURN AUTH OFF</button></div>`);
    return;
  }
  await persistPassSettings(body);
};
window.setAssistantProvider = async (v) => {
  if (!["none", "ollama", "custom", "openai", "anthropic"].includes(v)) return;
  const owner = settingsWriteOwner();
  try {
    const response = await fetch("/api/config", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assistant: { provider: v } }),
    });
    if (!response.ok) throw new Error("Provider choice not saved");
  } catch {
    settingsWriteFailed(owner, "The assistant choice could not be saved. Check the CineBraid server and try again; your other edits are still here.");
    toast("Could not update assistant");
    return;
  }
  CONFIG.assistant = { ...(CONFIG.assistant || {}), provider: v };
  if (settingsWriteIsCurrent(owner) && typeof window.studioCaptureSettingsDraft === "function") window.studioCaptureSettingsDraft();
  if (typeof refreshAgentStatus === "function") {
    try { await refreshAgentStatus(false); } catch { /* selection saved; readiness unknown */ }
  }
  toast("AI assistant updated");
  if (!settingsWriteIsCurrent(owner)) return;
  await route();
  /* A provider switch redraws the provider choices. Restore the equivalent button,
     not the detached node from before the request. */
  const choice = Array.from(document.querySelectorAll("button[onclick]")).find(
    (button) => button.getAttribute("onclick") === `setAssistantProvider('${v}')`,
  );
  choice?.focus();
};
function assistantTestEndpoint(provider) {
  const raw = provider === "anthropic" ? "https://api.anthropic.com/v1/messages"
    : provider === "openai" ? CONFIG.openaiBaseUrl || "https://api.openai.com/v1"
      : provider === "custom" ? CONFIG.customBaseUrl : CONFIG.ollamaUrl;
  try {
    const url = new URL(raw);
    /* Endpoints can be user-entered. Do not echo credentials or query material. */
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch { return "invalid or missing saved endpoint — correct it before testing"; }
}
window.testAssistantConnection = async () => {
  const note = $("#assistant-test-note");
  if (settingsCheckBlocked(note)) return;
  const provider = CONFIG.assistant?.provider || "ollama";
  if (provider === "none") {
    if (note) note.textContent = "Braidy is off. No test request was sent.";
    return;
  }
  const labels = { ollama: "Ollama", custom: "OpenAI-compatible server", openai: "OpenAI", anthropic: "Anthropic" };
  const model = CONFIG[provider === "ollama" ? "ollamaModel" : provider === "custom" ? "customModel" : provider === "openai" ? "openaiModel" : "anthropicModel"] || "provider default";
  const hosted = provider === "openai" || provider === "anthropic";
  const disclosure = hosted
    ? "This sends a short test prompt to the saved cloud service. The provider may charge for the request."
    : "This sends a short test prompt to the saved runtime endpoint. An endpoint on another computer receives that text; a remote service may charge.";
  confirmModal(
    `Saved target: ${labels[provider] || provider} · ${model}. Saved endpoint: ${assistantTestEndpoint(provider)}. ${disclosure} No project material is included. A successful response does not test image generation or grant approval.`,
    async () => {
      if (settingsCheckBlocked(note)) return;
      if (note) note.textContent = `Sending test prompt to ${labels[provider] || provider} · ${model}…`;
      try {
        const response = await fetch("/api/assistant/test", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "The test request failed.");
        if (note) note.textContent = `Test prompt answered by ${labels[provider] || provider} · ${model}. Generation and billing availability were not checked.`;
        toast("Assistant test prompt answered");
      } catch (error) {
        if (note) note.textContent = "Test prompt failed. Check the saved endpoint, model and authorization, then retry. A failure does not prove that a provider made no charge.";
        toast("Assistant test failed");
      }
    },
    { title: "Send a test prompt?", confirmLabel: "SEND TEST PROMPT", danger: false },
  );
};
/* Only the fields the open panel actually shows are sent. Assistant and Generation
   share one configuration document, and sending every field from whichever panel
   happened to be open overwrote the other panel's settings with placeholder
   defaults — saving Generation silently reset the vision assistant to "Same as main
   assistant". A panel now patches its own settings and nothing else. */
/* Collect each rendered control independently. Moving credentials to a connection
   detail must not fill missing model controls from stale CONFIG, nor switch providers. */
function settingsPresentFields(definitions) {
  const patch = {};
  for (const [field, id, kind = "text"] of definitions) {
    const input = $(id);
    if (!input || input.disabled) continue;
    patch[field] = kind === "checked" ? !!input.checked
      : kind === "outputs" ? Number(input.value) || 2
        : kind === "cost" ? Math.max(0, Number(input.value) || 0)
          : kind === "raw" ? String(input.value || "")
            : String(input.value || "").trim();
  }
  return patch;
}
function assistantConfigPatch() {
  const patch = settingsPresentFields([
    ["anthropicKey", "#cfg-key", "raw"], ["anthropicModel", "#cfg-model"],
    ["anthropicVisionModel", "#cfg-model"],
    ["openaiKey", "#cfg-openai-key", "raw"], ["openaiModel", "#cfg-openai-model"],
    ["openaiVisionModel", "#cfg-openai-vision"],
    ["customBaseUrl", "#cfg-custom-url"], ["customKey", "#cfg-custom-key", "raw"],
    ["customModel", "#cfg-custom-model"], ["customVisionModel", "#cfg-custom-vision"],
    ["customTemperature", "#cfg-custom-temperature"], ["customTopK", "#cfg-custom-top-k"],
    ["customThinking", "#cfg-custom-thinking"], ["ollamaUrl", "#cfg-ollama"],
    ["ollamaModel", "#cfg-omodel"], ["ollamaVisionModel", "#cfg-vmodel"],
  ]);
  const assistant = settingsPresentFields([["visionProvider", "#assistant-vision-provider"]]);
  if (Object.keys(assistant).length) patch.assistant = assistant;
  const continuity = settingsPresentFields([
    ["visionProvider", "#cfg-continuity-provider"], ["baseUrl", "#cfg-continuity-base"],
    ["visionModel", "#cfg-continuity-model"],
  ]);
  if (Object.keys(continuity).length) patch.continuity = continuity;
  return patch;
}
function falCredentialPatch() {
  if (CONFIG.generation?.fal?.keySource === "environment") return {};
  return settingsPresentFields([["apiKey", "#cfg-fal-key", "raw"]]);
}
function generationConfigPatch() {
  const fal = {
    ...settingsPresentFields([
      ["enabled", "#cfg-fal-enabled", "checked"], ["textModel", "#cfg-fal-text-model"],
      ["editModel", "#cfg-fal-edit-model"], ["h3TextModel", "#cfg-fal-h3-text-model"],
      ["h3ImageModel", "#cfg-fal-h3-image-model"], ["h3ReferenceModel", "#cfg-fal-h3-reference-model"],
      ["h3Resolution", "#cfg-fal-h3-resolution"], ["blockingOutputs", "#cfg-fal-blocking-outputs", "outputs"],
      ["frameOutputs", "#cfg-fal-frame-outputs", "outputs"], ["blockingQuality", "#cfg-fal-blocking-quality"],
      ["frameQuality", "#cfg-fal-frame-quality"], ["blockingResolution", "#cfg-fal-blocking-resolution"],
      ["frameResolution", "#cfg-fal-frame-resolution"], ["estimatedCostPerImage", "#cfg-fal-cost-per-image", "cost"],
    ]),
    ...falCredentialPatch(),
  };
  const motionRate = settingsPresentFields([
    ["usdPerSecond", "#cfg-fal-motion-rate", "cost"], ["source", "#cfg-fal-motion-rate-source"],
    ["asOf", "#cfg-fal-motion-rate-asof"],
  ]);
  if (Object.keys(motionRate).length) fal.motionRate = motionRate;
  const civitai = settingsPresentFields([
    ["enabled", "#cfg-civitai-enabled", "checked"], ["connectionId", "#cfg-civitai-connection"],
    ["resourceAir", "#cfg-civitai-resource"],
  ]);
  const generation = {};
  if (Object.keys(fal).length) generation.fal = fal;
  if (Object.keys(civitai).length) generation.civitai = civitai;
  return Object.keys(generation).length ? { generation } : {};
}
/* The Integrations panel. Three fields, sent only when the panel that owns them is the
   one on screen — the same `if (!$(...)) return {}` guard every other collector uses,
   for the reason tests/settings-consistency.js exists to hold: a save must not carry a
   value read from a control the open panel did not render. */
function integrationsConfigPatch() {
  const enabled = $("#cfg-comfy-enabled");
  if (!enabled) return {};
  const v = (id, fallback = "") => $(id)?.value ?? fallback;
  return {
    generation: {
      comfy: {
        enabled: !!enabled.checked,
        baseUrl: String(v("#cfg-comfy-base-url", CONFIG.generation?.comfy?.baseUrl || "")).trim(),
        workflowFolder: String(v("#cfg-comfy-workflow-folder", CONFIG.generation?.comfy?.workflowFolder || "")).trim(),
      },
    },
  };
}
/* The Accounts panel holds exactly one setting: the public application id Civitai
   uses to recognise CineBraid. The connections themselves are not settings and are
   never patched through here — /api/config refuses to touch `accounts` at all, so
   a credential cannot be created, changed or blanked by a configuration save. */
function accountsConfigPatch() {
  const input = $("#cfg-civitai-client-id");
  if (!input) return {};
  return { accountProviders: { civitai: { clientId: String(input.value || "").trim() } } };
}
/* A successful write must never put an entered secret into the cached display if
   the subsequent safe GET fails. Only the server's masked response replaces CONFIG. */
const SETTINGS_SECRET_INPUTS = [
  ["#cfg-key", ["anthropicKey"]], ["#cfg-openai-key", ["openaiKey"]],
  ["#cfg-custom-key", ["customKey"]], ["#cfg-fal-key", ["generation", "fal", "apiKey"]],
];
function settingsValueAt(object, parts) {
  return parts.reduce((value, key) => value && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined, object);
}
window.saveConfig = async (scope = "assistant") => {
  const generation = scope === "generation", accounts = scope === "accounts";
  const integrations = scope === "integrations", falConnection = scope === "fal-connection";
  const falCredential = falConnection ? falCredentialPatch() : {};
  const body = integrations ? integrationsConfigPatch()
    : accounts ? accountsConfigPatch()
      : generation ? generationConfigPatch()
        : falConnection ? (Object.keys(falCredential).length ? { generation: { fal: falCredential } } : {})
          : assistantConfigPatch();
  if (!Object.keys(body).length) return toast("No editable settings to save on this panel.");
  const label = integrations ? "ComfyUI settings" : accounts ? "account settings"
    : generation ? "generation settings" : falConnection ? "Fal connection" : "assistant settings";
  const owner = settingsWriteOwner();
  setSettingsPanelState("saving");
  let response;
  try {
    response = await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    settingsWriteFailed(owner, "The CineBraid server did not respond — check that it is still running.");
    return toast(`Could not save ${label}`);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    settingsWriteFailed(owner, data.error || "The server rejected the change.");
    return toast(`Could not save ${label}`);
  }
  /* Remove successfully submitted raw values from their original nodes now.
     A newly mounted panel is reconciled by owner after the safe read. */
  for (const [selector, parts] of SETTINGS_SECRET_INPUTS) {
    const submitted = settingsValueAt(body, parts);
    const field = owner.fields.find((row) => row.id === selector.slice(1));
    if (field && submitted !== undefined && String(field.input.value) === String(submitted)) {
      field.input.type = "password";
      field.input.value = submitted ? "••••saved" : "";
    }
  }
  let refreshed = null;
  try {
    const safeResponse = await fetch("/api/config");
    if (!safeResponse.ok) throw new Error("Settings display unavailable");
    const safe = await safeResponse.json();
    if (!safe || typeof safe !== "object" || safe.error) throw new Error("Settings display unavailable");
    CONFIG = safe;
    refreshed = safe;
    SETTINGS_CONFIG_REFRESH_REQUIRED = false;
    SETTINGS_CONFIG_STALE_DISPLAY = null;
  } catch {
    SETTINGS_CONFIG_REFRESH_REQUIRED = true;
    SETTINGS_CONFIG_STALE_DISPLAY = CONFIG;
  }
  const detail = SETTINGS_CONFIG_REFRESH_REQUIRED
    ? "The change is stored, but its display could not be refreshed. Reload Settings before checking setup."
    : "";
  settingsWriteSaved(owner, { body, config: refreshed, detail });
  toast(`${label[0].toUpperCase() + label.slice(1)} saved`);
  /* This refresh updates readiness only; saving never redraws the panel or moves
     keyboard focus. Its failure cannot turn a successful save into a failed one. */
  if (!SETTINGS_CONFIG_REFRESH_REQUIRED && typeof refreshAgentStatus === "function") {
    try { await refreshAgentStatus(false); } catch { /* readiness remains unverified */ }
  }
};

/* ---------- account connections ----------
   Every credential-bearing exchange below happens between this CineBraid server
   and the provider. The browser starts a connection and pastes a key; it never
   receives a token, a refresh token or an authorization code back. */
function accountProviderId(value) {
  /* The panel only ever passes an id this server registered, but an onclick is a
     string in a page, so it is re-checked rather than trusted. */
  return /^[a-z0-9][a-z0-9-]*$/.test(String(value || "")) ? String(value) : "";
}
window.startAccountConnection = async (providerId) => {
  const id = accountProviderId(providerId);
  if (!id) return toast("That account service is not available");
  try {
    const response = await fetch(`/api/accounts/${encodeURIComponent(id)}/oauth/start`, { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.authorizationUrl) throw new Error(data.error || "Could not start the connection");
    /* A full-page navigation rather than a popup: the sign-in page belongs to the
       provider, and a blocked popup is indistinguishable from a broken button. */
    window.location.assign(data.authorizationUrl);
  } catch (error) {
    toast(error.message || "Could not start the connection");
  }
};
window.openAccountApiKeyPrompt = (providerId) => {
  const id = accountProviderId(providerId);
  if (!id) return toast("That account service is not available");
  openModal(`<h3>Use a Civitai API key</h3><p class="modal-confirm-message">Paste a personal API key from your Civitai account settings. CineBraid checks it with Civitai and keeps it on this server — it is never shown in the browser again.</p><label class="account-key-field"><span>Civitai API key</span><input id="account-api-key-input" type="password" autocomplete="off" spellcheck="false"></label><p id="account-api-key-note" class="hint" role="status"></p><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button class="approve-btn" onclick="submitAccountApiKey('${id}')">Connect</button></div>`);
};
window.submitAccountApiKey = async (providerId) => {
  const id = accountProviderId(providerId);
  const input = $("#account-api-key-input");
  const note = $("#account-api-key-note");
  const apiKey = String(input?.value || "").trim();
  if (!id || !apiKey) { if (note) note.textContent = "Enter the API key first."; return; }
  if (note) note.textContent = "Checking the key with Civitai…";
  try {
    const response = await fetch(`/api/accounts/${encodeURIComponent(id)}/api-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Civitai rejected this credential.");
    if (input) input.value = "";
    closeModal();
    toast("Civitai connected");
    route();
  } catch (error) {
    if (note) note.textContent = error.message || "Civitai rejected this credential.";
  }
};
window.recheckAccountConnection = async (connectionId) => {
  const note = $("#account-note");
  if (note) note.textContent = "Checking with Civitai…";
  try {
    const response = await fetch(`/api/accounts/${encodeURIComponent(String(connectionId || ""))}/verify`, { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not check the connection");
    if (note) note.textContent = "";
    toast("Connection checked");
    route();
  } catch (error) {
    if (note) note.textContent = error.message || "Could not check the connection";
  }
};
window.disconnectAccount = (connectionId) => {
  confirmModal(
    "Disconnect this account? CineBraid removes its local authorization. Local results, project history and recorded provider/model details remain. This does not revoke the grant at the provider or cancel active jobs. Reconcile existing jobs before making another paid request.",
    async () => {
      try {
        const response = await fetch(`/api/accounts/${encodeURIComponent(String(connectionId || ""))}`, { method: "DELETE" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Could not disconnect the account");
        toast("Account disconnected — local history retained");
        route();
      } catch (error) {
        const note = $("#account-note");
        if (note) note.textContent = error.message || "Could not disconnect the account";
        toast(error.message || "Could not disconnect the account");
      }
    },
    { title: "Disconnect account", confirmLabel: "DISCONNECT" },
  );
};
window.testFalGenerationConnection = async () => {
  const note = $("#fal-test-note");
  if (settingsCheckBlocked(note)) return;
  const state = (tone, text) => { if (!note) return; note.dataset.tone = tone; note.textContent = text; };
  state("checking", "Checking saved local configuration only — no provider request…");
  try {
    const response = await fetch("/api/generation/fal/test", { method: "POST" });
    const data = await response.json();
    if (!response.ok) {
      const fal = CONFIG.generation?.fal || {};
      if (fal.enabled !== true) {
        const source = fal.keySource === "environment" ? "present · server environment"
          : fal.apiKey ? "present · saved settings" : "not present";
        state("off", `Generation is off. Saved credential: ${source}. Provider reachability and balance were not checked. You do not need to enable generation to inspect this setup.`);
        return;
      }
      throw new Error(data.error || "FAL setup check failed");
    }
    state("configured", "Saved Fal configuration is complete. Provider reachability, model availability and balance were not checked. No paid request was made.");
    toast("Fal configuration checked locally");
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
/* WHICH PROJECT A RESTORE IS FOR, AND WHICH DOCUMENT IT REPLACES.
 *
 * Ordinarily both come from the open project: the active slug, and the revision
 * this view loaded. A QUARANTINED project has neither — nothing was loaded, so
 * there is no active slug and no PROJECT_REVISION — and yet it is the project
 * that most needs restoring. The server sent both in its refusal, so Recovery
 * mode answers with those instead.
 *
 * This is the whole of the reuse. Everything below is the shipped restore: the
 * same route, the same preview, the same authority-delta review, the same
 * resurrection confirmation, the same exact If-Match, the same restore-first
 * checkpoint on the server. Recovery mode is a front door to it, not a second
 * copy of it. */
function projectRestoreIdentity() {
  if (typeof PROJECT_QUARANTINE !== "undefined" && PROJECT_QUARANTINE)
    return { slug: PROJECT_QUARANTINE.slug, revision: PROJECT_QUARANTINE.revision };
  return { slug: activeProjectSlug(), revision: PROJECT_REVISION };
}
window.restoreProjectBackup = async (name) => {
  if (window.CineBraidWorkingBible?.blocked()) return toast(window.CineBraidWorkingBible.refuse());
  const { slug, revision } = projectRestoreIdentity();
  if (!slug || !name) return toast("No active project to restore into");
  /* Without the exact revision of the document being replaced the server answers
     428 and nothing is written — which is correct, but it is worth saying so on
     the screen that asked rather than only in the network tab. */
  if (!revision) {
    if (typeof noteProjectRecoveryOutcome === "function")
      noteProjectRecoveryOutcome("CineBraid could not identify the stored project file, so nothing was restored.");
    return toast("Could not identify the project file to restore into");
  }
  try {
    const headers = { "Content-Type": "application/json", "If-Match": revision };
    const previewResponse = await fetch("/api/projects/" + encodeURIComponent(slug) + "/restore", {
      method: "POST", headers, body: JSON.stringify({ name }),
    });
    const preview = await previewResponse.json();
    if (!previewResponse.ok) throw new Error(preview.error || "Restore preview failed");
    const delta = preview.authorityDelta || [];
    const trust = preview.trust?.trusted
      ? "The snapshot's production-authority ledger is structurally trusted."
      : "The snapshot's production-authority ledger is NOT trusted: " + (preview.trust?.diagnostics || []).map((row) => row.code).join(", ");
    const deltaMarkup = delta.length
      ? "<ul>" + delta.map((row) => "<li><b>" + esc(row.targetKey) + "</b> · " + (row.beforeCurrent ? "current" : "non-Canon") + " → " + (row.afterCurrent ? "current" : "non-Canon") + "</li>").join("") + "</ul>"
      : "<p>No resolved production-authority target changes.</p>";
    const perform = async (resurrectionConfirmed) => {
      if (window.CineBraidWorkingBible?.blocked()) return toast(window.CineBraidWorkingBible.refuse());
      const response = await fetch("/api/projects/" + encodeURIComponent(slug) + "/restore", {
        method: "POST", headers,
        body: JSON.stringify({ name, confirm: true, previewHash: preview.previewHash, resurrectionConfirmed }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Restore failed");
      /* A confirmed restore replaces the open project's document. The reload
         below settles it, but a refresh prepared before this point is stale from
         the moment the restore is accepted and must not commit in the meantime. */
      noteCurrentProjectDurableAdvance(slug);
      /* A RESTORE DOES NOT ITSELF LEAVE RECOVERY MODE. It replaced the bytes; only
         an open can say whether what is there now is a project CineBraid will
         serve, and the reload below is that open. Until it commits, the latch and
         every guard behind it stay exactly where they are. */
      if (typeof noteProjectRecoveryOutcome === "function")
        noteProjectRecoveryOutcome("Backup restored. Re-opening the project to check it…");
      toast("Project restored — reloading");
      setTimeout(() => location.reload(), 350);
    };
    /* A RESTORE THAT FAILED CHANGED NOTHING, AND MUST SAY SO WHERE IT WAS ASKED
       FOR. On the Recovery screen this is the only sentence between "my project is
       broken" and "my project is broken and I have just been told it is fine" —
       so the failure lands in the note line as well as in a toast, and nothing
       about the protected state moves. */
    const restoreFailed = (error) => {
      const message = error?.message || "Could not restore project";
      if (typeof noteProjectRecoveryOutcome === "function")
        noteProjectRecoveryOutcome(message + " Nothing was restored and the original project is unchanged.");
      toast(message);
    };
    const confirmRestore = () => {
      if (!preview.resurrection) return perform(false).catch(restoreFailed);
      confirmModal(
        "This snapshot would resurrect previously non-current production authority. Restore it as current Canon?",
        () => perform(true).catch(restoreFailed),
        { title: "Confirm Canon resurrection", confirmLabel: "RESURRECT & RESTORE", danger: true },
      );
    };
    /* A quarantined project's stored document could not be read, so CineBraid
       cannot say which of its authorities were current before this restore. The
       server already treats that as "none", which makes every current authority in
       the snapshot a resurrection needing explicit confirmation; the review says so
       rather than presenting an empty delta as though nothing changed. */
    const unreadable = preview.currentUnreadable
      ? "<p><b>CineBraid could not read the project this would replace</b>, so it cannot show what changes. The current file is preserved before anything is written.</p>"
      : "";
    confirmModal(
      "<p>" + esc(trust) + "</p>" + unreadable + deltaMarkup + "<p>CineBraid will first preserve the current project and write a restore audit beside the backups.</p>",
      confirmRestore,
      { title: "Review restore authority change", confirmLabel: preview.resurrection ? "CONTINUE" : "RESTORE", danger: false, html: true },
    );
  } catch (error) {
    const message = error?.message || "Could not preview project restore";
    if (typeof noteProjectRecoveryOutcome === "function")
      noteProjectRecoveryOutcome(message + " Nothing was restored and the original project is unchanged.");
    toast(message);
  }
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
  SETTINGS_PANEL_BASELINE = settingsPanelValues();
  if (typeof window.studioClearSettingsDraft === "function") window.studioClearSettingsDraft();
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
  const owner = settingsWriteOwner();
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
    settingsWriteFailed(owner, "The CineBraid server did not respond — check that it is still running.");
    return toast("Could not save appearance settings");
  }
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    settingsWriteFailed(owner, data.error || "The server rejected the change.");
    return toast("Could not save appearance settings");
  }
  /* Saved on the server first, then in this browser, so the stored theme can never
     claim an appearance the server does not hold. */
  commitWorkspaceAppearance(body.appearance);
  setHelpMode(body.appearance.helpMode);
  CONFIG = await fetch("/api/config").then((response) => response.json()).catch(() => ({ ...CONFIG, ...body }));
  const current = settingsWriteSaved(owner);
  toast("Appearance saved");
  if (current) route();
};

/* What a completed migration actually says, in the order a person needs it.
 *
 * The counts alone were never enough, and one defect proved it: an archived project
 * whose document was silently dropped produced a perfectly accurate "copied N,
 * skipped M" line, because both numbers came from the loop that dropped it. The
 * server now measures the new location against the old one afterwards, and this
 * reports THAT — including the project records, which are the files a person would
 * most like to be told about and the ones the old line never mentioned.
 *
 * A failed check never reads as a failed migration, because it is not one. The copies
 * are create-only and the originals are untouched under every outcome, so the honest
 * sentence names what did not line up and says the old location is still intact. */
function describeMigration(migration) {
  const records = Number(migration.projectDocuments || 0) + Number(migration.carriedDocuments || 0);
  const head = `Copied ${migration.copied || 0} files into the new project folder, including ${records} project ${records === 1 ? "record" : "records"}; ${migration.skipped || 0} existing files were kept.`;
  const verification = migration.verification;
  if (!verification) return head;
  if (verification.ok) return `${head} Everything at the old location is present at the new one, at the same size.`;
  const problems = [];
  if (verification.missingCount) problems.push(`${verification.missingCount} did not arrive`);
  if (verification.mismatchedCount) problems.push(`${verification.mismatchedCount} already existed at the new location with different contents`);
  if (verification.unsupportedCount) problems.push(`${verification.unsupportedCount} could not be read`);
  const detail = [...(verification.missing || []), ...(verification.mismatched || [])].slice(0, 5);
  return `${head} Checking the new location against the old one found problems: ${problems.join("; ")}.${detail.length ? ` For example: ${detail.join(", ")}.` : ""} The copies were kept and nothing at the old location was changed.`;
}
/* Storage paths and naming rules share one endpoint because the server has to create
   the folders and check write access before it records either. They no longer share a
   request body: a panel sends only the fields it is showing, so saving naming rules
   cannot blank the storage paths it never displayed. */
async function persistWorkspaceSettings(scope) {
  const owner = settingsWriteOwner();
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
  /* THE OWNER, CAPTURED BEFORE THE REQUEST. Moving the projects root rewrites every
     project document at the new location, this window's included — and a switch
     while that is in flight must not redirect the declaration onto the project the
     migration did not write from this window's point of view. */
  const migrationOwner = ACTIVE_PROJECT_SLUG;
  let r;
  try {
    r = await fetch("/api/workspace/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    settingsWriteFailed(owner, "The CineBraid server did not respond — check that it is still running.");
    if (note) note.textContent = "The CineBraid server did not respond — check that it is still running.";
    return toast(storage ? "Could not apply storage paths" : "Could not save naming rules");
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const reason = data.error || "The server rejected the change.";
    settingsWriteFailed(owner, reason);
    if (note) note.textContent = reason;
    return toast(storage ? "Could not apply storage paths" : "Could not save naming rules");
  }
  /* The route says whether it actually rewrote anything. */
  if (data.migration?.movedRoot) noteCurrentProjectDurableAdvance(migrationOwner);
  CONFIG = await fetch("/api/config").then((response) => response.json()).catch(() => ({ ...CONFIG, ...body }));
  if (settingsWriteIsCurrent(owner)) updateFilenameTemplatePreview();
  const applied = data.migration?.movedRoot
    ? describeMigration(data.migration)
    : storage ? "These folders exist and are writable." : "";
  settingsWriteSaved(owner, { detail: applied });
  if (note && storage) note.textContent = applied;
  /* "moved safely" was the one line here that was not true. Migration copies into the
     new location and leaves the old one exactly as it was — deliberately, and the
     note directly above already says so in the same breath. A failure never reaches
     this line at all: a non-ok response returns above, so a partly-copied destination
     can never be announced as a workspace that moved. */
  if (!data.migration?.movedRoot) return toast(storage ? "Storage paths applied" : "Naming rules saved");
  /* The toast is the only part a person reads without looking, so a check that did not
     pass may not be announced as a plain success. The note beside it carries the detail. */
  toast(data.migration.verification && !data.migration.verification.ok
    ? "Projects copied — the check found differences"
    : "Projects copied to the new folder");
}
window.saveStorageSettings = () => persistWorkspaceSettings("workspace");
window.saveNamingSettings = () => persistWorkspaceSettings("naming");
/* Where the projects ACTUALLY are, in one sentence, in the words that fit the case.
 *
 * Four situations and they are not interchangeable. A saved choice is settled and
 * needs no comment. An environment default is somebody's deliberate isolation and
 * should say so, or a QA sandbox looks like a lost workspace. The per-user default is
 * the ordinary case. And the legacy install root is the one that matters: the user's
 * productions are inside the application folder, nothing has been moved, and they are
 * one update away from a folder that gets replaced. */
const WORKSPACE_ROOT_STATE = {
  configured: (data) => `Projects are kept in ${data.projectRoot}, the folder saved below.`,
  environment: (data) => `Projects are kept in ${data.projectRoot}, set by CINEBRAID_PROJECTS_ROOT for this CineBraid. A folder saved below would override it.`,
  default: (data) => `Projects are kept in ${data.projectRoot}, CineBraid's default folder.`,
  "legacy-install": (data) => {
    const held = [
      data.legacyInstallRoot.productions ? `${data.legacyInstallRoot.productions} project${data.legacyInstallRoot.productions === 1 ? "" : "s"}` : "",
      data.legacyInstallRoot.archived ? `${data.legacyInstallRoot.archived} archived` : "",
      data.legacyInstallRoot.trashed ? `${data.legacyInstallRoot.trashed} in the trash` : "",
    ].filter(Boolean).join(", ");
    return `Your projects are still inside the CineBraid application folder — ${data.projectRoot} (${held}). CineBraid is still opening them from there and has changed nothing. Updating or reinstalling CineBraid can overwrite that folder. Set the project root below to move them; the originals stay where they are.`;
  },
};
function describeWorkspaceRoot(data) {
  /* A status that could not say where the root is has nothing to tell anyone, and a
     sentence reading "Projects are kept in undefined" is worse than no sentence. */
  if (!data || !data.projectRoot) return "CineBraid did not report where projects are kept.";
  const say = (data.legacyInstallRoot && WORKSPACE_ROOT_STATE[data.projectRootSource]) || WORKSPACE_ROOT_STATE.default;
  const line = say(data);
  /* Said as well as, not instead of: a root deliberately pointed back inside the
     application is a different act from never having moved one, and it carries the
     same hazard. */
  return data.rootInsideInstall && data.projectRootSource !== "legacy-install"
    ? `${line} This folder is inside the CineBraid application, so updating CineBraid can overwrite it.`
    : line;
}
/* WHERE THE SETTINGS FILE IS, said quietly and only when asked. The server decides what may be
   shown: the exact path to a browser on the CineBraid computer, the symbolic location to anyone
   else. The file's contents — keys, passcodes — are never part of the answer. */
function describeSettingsLocation(location) {
  if (!location || !location.symbolic) return "CineBraid did not report where its settings are kept.";
  if (location.mode === "explicit override") {
    return `Settings are read from the file named by CINEBRAID_CONFIG_PATH${location.path ? `: ${location.path}` : ""}. Saved keys stay in that file and are never shown here.`;
  }
  return `Settings are kept in your user profile, outside the application folder: ${location.path || location.symbolic}. Saved keys stay in that file and are never shown here.`;
}
window.refreshWorkspaceStatus = async () => {
  const note = $("#workspace-settings-note"), state = $("#workspace-root-state"), settingsLocation = $("#settings-location-detail");
  if (note) note.textContent = "Checking effective paths…";
  try {
    const r = await fetch("/api/workspace/status");
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Status check failed");
    if (note) note.textContent = `Active project root: ${data.projectRoot}${data.outputRoot ? ` · exports: ${data.outputRoot}` : ""}${data.backupRoot ? ` · backups: ${data.backupRoot}` : ""}`;
    if (state) {
      state.textContent = describeWorkspaceRoot(data);
      state.dataset.workspaceState = data.projectRootSource || "default";
      state.dataset.rootInsideInstall = String(Boolean(data.rootInsideInstall));
    }
    WORKSPACE_RECOMMENDED_ROOT = data.userDefaultRoot || "";
    if (settingsLocation) settingsLocation.textContent = describeSettingsLocation(data.settingsLocation);
  } catch (error) {
    if (note) note.textContent = error.message;
    if (state) state.textContent = error.message;
  }
};
/* Filled by the status read, so the button offers the path the SERVER would pick and
   not one this file guessed. Empty until then, and the button says so rather than
   writing a wrong path into the box. */
let WORKSPACE_RECOMMENDED_ROOT = "";
window.useRecommendedProjectRoot = () => {
  const field = $("#cfg-project-root");
  if (!field) return;
  if (!WORKSPACE_RECOMMENDED_ROOT) return toast("CineBraid has not reported its default folder yet — press Check active paths.");
  field.value = WORKSPACE_RECOMMENDED_ROOT;
  field.focus();
  toast("Recommended folder filled in — press Apply storage paths to use it.");
};
/* The panel is static markup, so the state line has to be filled after it renders.
   The route already announces itself; listening is cheaper and less invasive than a
   settings-shaped branch inside the render pipeline. */
if (typeof window.addEventListener === "function")
  window.addEventListener("cinebraid:route-rendered", (event) => {
    if (event?.detail?.view === "settings") window.refreshWorkspaceStatus();
  });

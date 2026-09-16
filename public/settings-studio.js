/* EV2-5: presentation over existing Settings owners. No new persisted state. */
const STUDIO_SETTINGS_SECTIONS = [
  ["overview", "Studio overview"], ["connections", "Connections"],
  ["generation", "Generation defaults"], ["assistant", "Braidy & assistance"],
  ["appearance", "Appearance"], ["files", "Files & storage"],
  ["naming", "Naming & organization"], ["access", "Access & security"],
  ["recovery", "Recovery & advanced"],
];
const STUDIO_SETTINGS_DETAILS = ["integrations", "accounts", "fal", "assistant-ollama", "assistant-openai", "assistant-anthropic", "assistant-custom", "project", "project-recovery", "setup"];
function studioSettingsSelection() {
  const valid = [...STUDIO_SETTINGS_SECTIONS.map(([id]) => id), ...STUDIO_SETTINGS_DETAILS];
  const requested = String(location.hash || "").split("/")[2];
  if (valid.includes(requested)) return requested;
  return boundedFocusedTask("settings-task", "settings", valid, "overview");
}
window.settingsGo = (id) => {
  if (![...STUDIO_SETTINGS_SECTIONS.map(([key]) => key), ...STUDIO_SETTINGS_DETAILS].includes(id)) return;
  if (location.hash === `#/settings/${id}`) route();
  else location.hash = `#/settings/${id}`;
};
const STUDIO_SETTINGS_DRAFTS = new Map();
function studioDraftKey(panel) {
  if (panel?.dataset && panel.dataset.settingsProject === undefined)
    panel.dataset.settingsProject = typeof activeProjectSlug === "function" ? activeProjectSlug() : "";
  return `${panel?.dataset?.settingsProject || ""}:${panel?.dataset?.settingsTab || ""}`;
}
window.studioCaptureSettingsDraft = () => {
  const panel = document.querySelector(".settings-selected-tab");
  if (!panel || panel.dataset.settingsTab === "project") return;
  const state = document.getElementById("settings-panel-state");
  if (!state) return;
  const controls = settingsPanelControls();
  const values = settingsPanelValues();
  const dirty = SETTINGS_PANEL_BASELINE && values.some((value, i) => value !== SETTINGS_PANEL_BASELINE[i]);
  if (!dirty) { STUDIO_SETTINGS_DRAFTS.delete(studioDraftKey(panel)); return; }
  STUDIO_SETTINGS_DRAFTS.set(studioDraftKey(panel), {
    values: controls.map((el, i) => ({ id: el.id, index: i, type: el.type, value: el.value, checked: el.checked })),
    baseline: SETTINGS_PANEL_BASELINE.slice(),
    focus: controls.includes(document.activeElement) ? document.activeElement.id : "",
    open: Array.from(panel.querySelectorAll("details[open]")).map((el) => el.id || el.dataset.uiStateKey).filter(Boolean),
  });
};
window.studioClearSettingsDraft = () => {
  const panel = document.querySelector(".settings-selected-tab");
  if (panel) STUDIO_SETTINGS_DRAFTS.delete(studioDraftKey(panel));
};
window.studioSettingsDraftError = (key, reason) => {
  const draft = STUDIO_SETTINGS_DRAFTS.get(key);
  if (draft) draft.error = reason;
};
window.studioReconcileSettingsDraft = (key, saved, submitted) => {
  const draft = STUDIO_SETTINGS_DRAFTS.get(key);
  if (!draft) return;
  for (const field of saved) {
    const value = draft.values.find((row) => field.id ? row.id === field.id : row.index === field.index);
    const before = submitted[field.index];
    if (value && (String(value.value) === before.value || (field.secret && value.value === "••••saved"))) value.value = field.value;
  }
  draft.baseline = saved.map((field) => field.value);
  delete draft.error;
  const changed = draft.values.some((value, index) => {
    const before = saved.find((field) => value.id ? field.id === value.id : field.index === index);
    const effective = value.type === "checkbox"
      ? String(value.checked) : String(value.value);
    return !before || effective !== before.value;
  });
  if (!changed) STUDIO_SETTINGS_DRAFTS.delete(key);
};
window.studioRestoreSettingsDraft = () => {
  const panel = document.querySelector(".settings-selected-tab");
  const draft = STUDIO_SETTINGS_DRAFTS.get(studioDraftKey(panel));
  if (!draft || !panel) return;
  const controls = settingsPanelControls();
  draft.values.forEach((saved) => {
    const el = saved.id ? document.getElementById(saved.id) : controls[saved.index];
    if (!el || el.disabled) return;
    if (el.tagName === "SELECT" && !Array.from(el.options || []).some((o) => o.value === saved.value)) {
      const option = document.createElement("option"); option.value = saved.value; option.textContent = "Saved draft choice — availability unknown"; el.appendChild(option);
    }
    el.value = saved.value;
    if (el.type === "checkbox") el.checked = saved.checked;
    if (el.id === "cfg-civitai-connection") el.dataset.userChoice = "1";
  });
  SETTINGS_PANEL_BASELINE = draft.baseline;
  Array.from(panel.querySelectorAll("details")).forEach((el) => { if (draft.open.includes(el.id || el.dataset.uiStateKey)) el.open = true; });
  refreshSettingsPanelState();
  if (panel.dataset.settingsTab === "appearance" && typeof previewAppearanceSettings === "function") previewAppearanceSettings();
  if (draft.error) setSettingsPanelState("error", draft.error);
  if (draft.focus) document.getElementById(draft.focus)?.focus();
};
function studioConnectionFields(c, kind) {
  const input = (label, id, value, secret = false) => field(label, `<input id="${id}" ${secret ? 'type="password" autocomplete="new-password" spellcheck="false"' : ''} value="${attr(value || "")}">`);
  if (kind === "ollama") return input("Ollama endpoint", "cfg-ollama", c.ollamaUrl || "http://localhost:11434") + input("Text model", "cfg-omodel", c.ollamaModel) + input("Vision model", "cfg-vmodel", c.ollamaVisionModel);
  if (kind === "anthropic") return input("Claude API key · saved value masked", "cfg-key", c.anthropicKey, true) + input("Claude model", "cfg-model", c.anthropicModel);
  if (kind === "openai") return input("OpenAI API key · saved value masked", "cfg-openai-key", c.openaiKey, true) + input("Text model", "cfg-openai-model", c.openaiModel) + input("Vision model", "cfg-openai-vision", c.openaiVisionModel);
  return input("OpenAI-compatible base URL · include /v1", "cfg-custom-url", c.customBaseUrl) + input("API key · optional, saved value masked", "cfg-custom-key", c.customKey, true) + input("Text model", "cfg-custom-model", c.customModel) + input("Vision model", "cfg-custom-vision", c.customVisionModel) + `<details class="studio-wide"><summary>Advanced request options</summary><div class="two-col">${input("Temperature · blank uses server default", "cfg-custom-temperature", c.customTemperature === 0 ? "0" : c.customTemperature)}${input("Top-K · blank omits the field", "cfg-custom-top-k", c.customTopK)}${field("Model thinking", `<select id="cfg-custom-thinking"><option value="auto">Server default</option><option value="disabled" ${c.customThinking === "disabled" ? "selected" : ""}>Ask server to skip thinking</option></select>`)}</div><p class="hint">Use only options this endpoint supports.</p></details>`;
}
function studioSettingsRender({ selected, panels, config: c, health, accountData, panelState }) {
  const fal = c.generation?.fal || {}, comfy = c.generation?.comfy || {};
  const assistant = c.assistant?.provider || "ollama";
  const project = selected === "project" || selected === "project-recovery";
  const connection = ["integrations", "accounts", "fal"].includes(selected) || selected.startsWith("assistant-");
  const active = connection ? "connections" : selected;
  const link = (id, label, cls = "ghost-btn") => `<a class="${cls}" href="#/settings/${id}">${esc(label)}</a>`;
  const card = (id, title, subtype, state, detail) => `<a class="studio-connection" href="#/settings/${id}"><span class="studio-kicker">${esc(subtype)}</span><h3>${esc(title)}</h3><b>${esc(state)}</b><p>${esc(detail)}</p><span class="studio-link">Open details →</span></a>`;
  const accountCount = (accountData.accounts || []).filter((a) => a.providerId === "civitai").length;
  const names = { ollama: "Ollama", openai: "OpenAI", anthropic: "Anthropic / Claude", custom: "OpenAI-compatible server", none: "Off" };
  const cloudText = "No generation runs when you save. Using this service can send prompts or images to the configured provider and may cost money. Retention, rights, regional access and billing depend on your provider agreement; they are not verified here.";
  const connectionCards = card("integrations", "ComfyUI", "Local runtime · loopback only", "Reachability not checked", `${comfy.enabled ? "Generation enabled" : "Generation off"}. Workflows and model support are checked separately.`)
    + card("accounts", "Civitai", "Account identity & authorization", accountData.error ? "Account status unknown" : accountCount ? `${accountCount} saved account${accountCount === 1 ? "" : "s"}` : "Needs account setup", accountData.error ? "Account status could not be read. Open connection details to retry; saved accounts have not been removed." : "Last verification is not live availability. Generation permission and a paying account are separate choices.")
    + card("fal", "Fal", "Saved API-key service", fal.keySource === "environment" ? "Environment-managed credential" : fal.apiKey ? "Saved credential present" : "Needs credential", "Provider reachability, model availability and balance are unknown. Image and motion defaults are separate.")
    + ["ollama", "openai", "anthropic", "custom"].map((id) => card(`assistant-${id}`, names[id], id === "ollama" ? "Assistant runtime" : id === "custom" ? "Assistant endpoint" : "Assistant API-key service", assistant === id ? "Selected for Braidy" : "Not selected for Braidy", "Text and image-reading models are configured independently of image generation. Reachability not checked.")).join("");
  const overview = `<section class="settings-block studio-overview"><span class="studio-kicker">Application-wide scope</span><h2>Your studio, your choices.</h2><p class="studio-lead">Set up tools once. Choose how to use them when you work. Your local project remains the authority.</p><div class="studio-overview-grid"><article><span>Connections</span><h3>Know what is configured</h3><p>Accounts, saved API-key services and runtimes. A saved connection is not a successful generation.</p>${link("connections", "Manage connections")}</article><article><span>Generation</span><h3>Keep defaults deliberate</h3><p>Existing Fal and Civitai preferences. Jobs retain their own provider choices and results retain their provenance.</p>${link("generation", "Generation defaults")}</article><article><span>Braidy</span><h3>${esc(names[assistant] || assistant)}</h3><p>Assistant selection, image reading and continuity are separate from image and motion generation.</p>${link("assistant", "Braidy & assistance")}</article></div><div class="studio-callout"><div><h3>Start with the tools you have</h3><p>Optional setup takes you to these same controls. Skip any step and keep working.</p></div>${link("setup", "Open guided setup")}</div><p class="hint">Project: <b>${esc(P.meta.title)}</b> · ${link("project", "Project preferences", "text-link-btn")} · ${link("project-recovery", "Project backups", "text-link-btn")}</p></section>`;
  const connections = `<section class="settings-block"><span class="studio-kicker">Implemented connections</span><h3>Connections</h3><p class="studio-lead">Set up a service. Understand what it can do.</p><p class="hint">Connection identity, authorization, reachability and capability are different facts. Neither connecting nor receiving a result grants production approval.</p><div class="studio-connections">${connectionCards}</div></section>`;
  const falPanel = `<section class="settings-block"><span class="studio-kicker">API-key service · cloud</span><h3>Fal connection</h3><p class="hint">Credential source: <b>${esc(fal.keySource || "none")}</b>. The existing environment source takes precedence over a saved key. Account identity, reachability and balance are unknown.</p><div class="two-col">${field("Fal API key · saved value masked", `<input id="cfg-fal-key" type="password" autocomplete="new-password" value="${attr(fal.apiKey || "")}" ${fal.keySource === "environment" ? 'disabled aria-describedby="fal-source-note"' : ''}><span id="fal-source-note" class="hint">${fal.keySource === "environment" ? "Managed by the server environment. This page cannot replace it." : "Saved on this CineBraid server through the existing configuration owner."}</span>`)}</div><div class="settings-actions"><button class="add-btn" onclick="saveConfig('fal-connection')" ${fal.keySource === "environment" ? "disabled" : ""}>Save Fal credential</button><button class="ghost-btn" onclick="testFalGenerationConnection()">Inspect saved Fal configuration</button>${panelState("manual", "Save changes setup only; it does not enable generation.")}</div><p id="fal-test-note" role="status" class="hint">Local configuration inspection only. No provider request, generation or billing. Reachability and balance remain unknown.</p><div class="studio-callout"><div><h4>Capabilities through Fal</h4><p>Image generation and editing; configured motion endpoints. A model such as OpenAI image is routed through Fal here. Current availability is checked by the operation, not by key presence.</p>${link("generation", "Open provider defaults")}</div></div><p class="hint">${cloudText}</p></section>`;
  let assistantConnection = "";
  if (selected.startsWith("assistant-")) {
    const kind = selected.slice(10), local = kind === "ollama" || kind === "custom";
    assistantConnection = `<section class="settings-block"><span class="studio-kicker">${local ? "Assistant runtime / endpoint" : "Assistant API-key service"}</span><h3>${esc(names[kind])} connection</h3><p class="hint">${assistant === kind ? "Selected for Braidy." : "Saving this connection does not select it for Braidy."} Saving does not send a test prompt. The existing readiness refresh may read Ollama or selected custom/continuity model inventories with their stored credentials; it sends no project material. Cloud reachability and billing remain unverified. ${local ? "Check the address: a self-hosted endpoint can still be remote or proxy a paid service." : "Credential source: CineBraid server configuration. Saved secrets remain masked."}</p><div class="two-col">${studioConnectionFields(c, kind)}</div><div class="settings-actions"><button class="add-btn" onclick="saveConfig('assistant')">Save connection & models</button>${panelState("manual", "Save uses the existing assistant owner; runtime inventory may refresh, but no test prompt or generation is sent.")}</div><div class="studio-callout"><div><h4>Text and image reading</h4><p>Text powers Braidy; image reading needs a supported vision model and its own selection. These are not image-generation capabilities. Continuity retains its existing separate settings.</p>${link("assistant", "Choose assistance & test Braidy")}</div></div><p class="hint">${cloudText}</p></section>`;
  }
  const recovery = `<section class="settings-block"><h3>Recovery & advanced</h3><p class="studio-lead">Find the next useful check.</p><div class="studio-callout"><div><h4>CineBraid server: ${health.ok === true ? "responding" : health.ok === false ? "needs attention" : "status unknown"}</h4><p>${esc(health.message || health.status || "No verified health detail available.")}</p><p class="hint">This page reads local server health. It does not contact a generation provider.</p></div><button class="ghost-btn" onclick="route()">Read server health again</button></div><p>${link("files", "Active files & settings paths")} ${link("access", "Access & security")}</p><div class="studio-callout"><div><h4>${esc(P.meta.title)} · project recovery</h4><p>Backups, restore and production reports belong to this project. A restore uses the existing recovery flow.</p>${link("project-recovery", "Open project backups & recovery")}</div></div><details><summary>Advanced · retained compatibility values</summary><p class="hint">These saved options are not currently used by an operational consumer. They are retained without changing their stored values.</p><dl class="studio-facts"><dt>Folder strategy</dt><dd>${esc(c.workspace?.fileStrategy || "Not set")}</dd><dt>Export filename template</dt><dd>${esc(c.naming?.exportTemplate || "Not set")}</dd><dt>Collision behavior</dt><dd>${esc(c.naming?.collisionBehavior || "Not set")}</dd></dl></details></section>`;
  const setup = `<section class="settings-block"><span class="studio-kicker">Optional · no completion requirement</span><h3>Set up your studio</h3><p class="studio-lead">Use only the tools your work needs.</p><p class="hint">Every step opens the normal Settings control. Saving setup never generates, enables an unrelated provider or grants approval.</p><ol class="studio-steps"><li><h4>Start locally</h4><p>Manual workflows need no cloud account. Connect a runtime when you want local generation.</p>${link("integrations", "Set up local ComfyUI")}</li><li><h4>Add a cloud service only if needed</h4><p>Read credential source, capability and request disclosures first. You can leave all cloud services unused.</p>${link("connections", "Review connections")}</li><li><h4>Choose how you work</h4><p>Set existing provider defaults or Braidy's provider. Confirm the actual job separately.</p>${link("generation", "Generation defaults")} ${link("assistant", "Braidy & assistance")}</li></ol>${link("overview", "Skip setup / return to studio", "add-btn")}</section>`;
  let body = ({ overview, connections, fal: falPanel, recovery, setup })[selected] || assistantConnection || panels[selected] || overview;
  if (connection) body = `<p class="studio-breadcrumb">${link("connections", "← All connections", "text-link-btn")}</p>` + body;
  const navigation = project ? `<nav aria-label="Project settings"><p class="hint">${esc(P.meta.title)}</p>${link("project", "Project preferences")} ${link("project-recovery", "Backups & recovery")} ${link("overview", "Application Settings")}</nav>` : `<nav class="studio-nav" aria-label="Settings sections"><label class="studio-compact-nav">Section<select aria-label="Settings section" onchange="settingsGo(this.value)">${STUDIO_SETTINGS_SECTIONS.map(([id, label]) => `<option value="${id}" ${active === id ? "selected" : ""}>${esc(label)}</option>`).join("")}${selected === "setup" ? '<option value="setup" selected>Guided setup</option>' : ''}</select></label><div class="studio-nav-links">${STUDIO_SETTINGS_SECTIONS.map(([id, label]) => `<a href="#/settings/${id}" ${active === id ? 'aria-current="page"' : ''}>${esc(label)}</a>`).join("")}<span class="studio-nav-scope">Current project</span>${link("project", "Project preferences", "studio-project-link")}</div></nav>`;
  return `<div class="view-head"><div><div class="eyebrow">${project ? "Project context" : "Studio preferences"}</div><span class="view-title">${project ? esc(P.meta.title) : "Settings"}</span><div class="view-sub">${project ? "These preferences and recovery actions belong to this project." : "Application-wide preferences · connection setup is separate from use, spending and approval."}</div></div></div><div class="studio-settings-layout ${project ? 'studio-project-context' : ''}">${navigation}<div class="settings-selected-tab" data-settings-tab="${attr(selected)}">${body}</div></div>`;
}

/* Project emphasis retains its existing writer/rerender, then restores the control. */
window.studioSetProjectEmphasis = async (value) => {
  const project = activeProjectSlug();
  await setProjectWorkflowEmphasis(value);
  if (location.hash === "#/settings/project" && activeProjectSlug() === project) document.getElementById("cfg-project-emphasis")?.focus();
};

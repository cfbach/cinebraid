/* ---------- views ---------- */
/* ACTIVE_PROJECT_SLUG is a script-scoped binding shared across the classic scripts (app.js).
   It is deliberately not a window property, matching how coverage-automation.js, entities.js
   and bounded-rendering.js read it. Reading it off `window` yields undefined and silently
   requests /api/projects//backups, so always resolve it through this helper. */
function activeProjectSlug() {
  return (typeof ACTIVE_PROJECT_SLUG !== "undefined" && ACTIVE_PROJECT_SLUG) || "";
}
/* Distinguishes "this project genuinely has no backups yet" from "the list could not be
   loaded", so a recovery failure is never rendered as an empty, reassuring list. */
async function projectBackupList() {
  const slug = activeProjectSlug();
  if (!slug) return { backups: [], error: "No project is open, so backups cannot be listed." };
  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/backups`);
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      return { backups: [], error: detail.error || `Backups could not be loaded (${response.status}).` };
    }
    const data = await response.json();
    return { backups: data.backups || [] };
  } catch {
    return { backups: [], error: "Could not reach the CineBraid server to list backups." };
  }
}
const ROUTES = {
  production() { return productionHomeView(); },
  create() { return creationStudioView(); },
  shots(tab) { return productionView(tab || "board"); },
  library(tab) { return libraryView(tab || LIBRARY_TAB); },
  reports(id) { return reportsView(id || ""); },
  scene(id) {
    const sc = sceneById(id);
    if (!sc) return sharedNotFoundView("Scene", id, "#/shots/scenes", "Scenes", (P.scenes || []).map((row) => row.id), "#/scene");
    const shots = P.shots.filter((s) => s.scene === sc.id);
    const shotPage = boundedPage(shots, "shots", `scene:${sc.id}`, BOUNDED_PAGE_SIZES.shots);
    return `<div class="crumb"><a href="#/shots/scenes">Shots</a> / ${esc(sc.id)}</div>
    <input class="page-title-input" value="${attr(sc.title)}" onchange="setVal('scenes','${sc.id}','title',this.value)">
    <div class="chip-row" style="margin:10px 0 4px">
      ${["A", "B"].map((t) => `<button class="tier-badge ${t}" style="${sc.tier === t ? "" : "opacity:.35"}" onclick="setVal('scenes','${sc.id}','tier','${t}');route()">TIER ${t}</button>`).join("")}
      <input class="status-select" style="width:130px" placeholder="stage (optional)" value="${attr(sc.stage ?? "")}" onchange="setVal('scenes','${sc.id}','stage',this.value)">
      <span class="hint">${mmss(shots.reduce((a, s) => a + shotDur(s), 0))} planned in this scene</span>
    </div>
    <div class="section-label">Scene reference package <span class="section-count">${sceneReferenceRecords(sc).length}</span></div>
    <div class="reference-package">${
      sceneReferenceRecords(sc)
        .map(
          (x) =>
            `<a href="#/${x.route}/${x.id}" class="reference-item"><span class="reference-type">${esc(x.type)}</span><b>${esc(x.name || x.id)}</b><small>${esc(x.id)}</small>${workflowChip(entityWorkflowState(x))}</a>`,
        )
        .join("") ||
      '<div class="reference-empty"><b>No linked references yet</b><span>Scene references are inferred from its shots.</span></div>'
    }</div>
    <div class="two-col" style="margin-top:16px">
      ${field("What happens — the beat (locked)", ta(sc, "whatHappens", "scenes", sc.id))}
      ${field("How it should feel", ta(sc, "howItFeels", "scenes", sc.id))}
    </div>
    ${sceneAudioPanel(sc)}
    ${typeof renderSceneAutomationPanel === "function" ? renderSceneAutomationPanel(sc, shots) : ""}
    ${typeof renderSceneContinuityPanel === "function" ? renderSceneContinuityPanel(sc, shots) : ""}
    <details class="fold"><summary>Script — VO in scene order (the recording read-sheet)</summary>
    ${
      shots
        .map((s) => {
          const lines = [];
          if (s.audio?.line) lines.push({ who: s.id, t: s.audio.line });
          (s.clips || []).forEach((c) => {
            if (c.line) lines.push({ who: s.id + c.suffix, t: c.line });
          });
          return lines.length
            ? `<div style="margin-bottom:10px">${lines.map((l) => `<div class="script-line"><span class="opt-id">${esc(l.who)}</span><span>${esc(l.t)}</span></div>`).join("")}</div>`
            : "";
        })
        .join("") ||
      '<div class="canon-notes">No VO written in this scene yet.</div>'
    }</details>
    <div class="section-label">Shots — order is edit order</div>
    ${boundedPagerMarkup("shots",`scene:${sc.id}`,shotPage,"scene shots")}
    <div class="shot-row bounded-shot-page">${shotPage.rows.map((s) => slate(s, sc.id)).join("")}</div>
    ${boundedPagerMarkup("shots",`scene:${sc.id}`,shotPage,"scene shots")}
    <div style="margin-top:16px;display:flex;gap:10px">
      <button class="add-btn" onclick="addShot('${sc.id}')">+ Add shot to scene</button>
      <button class="danger-btn" onclick="delScene('${sc.id}')">Delete scene</button>
    </div>`;
  },

  async shot(id) {
    const s = shotById(id);
    if (!s) return sharedNotFoundView("Shot", id, "#/shots/board", "Shots", (P.shots || []).map((row) => row.id), "#/shot");
    await fetch("/api/shots/" + id + "/folder", { method: "POST" });
    const takes = takesFor(id), sc = sceneById(s.scene), state = workflowState(s, takes), refs = referenceRecordsForShot(s), planningMedia = shotMediaLinks(s), neighbors = shotNeighbors(s);
    return guidedShotWorkspaceView(s, takes, sc, state, refs, planningMedia, neighbors);
  },

  character(id) {
    return entityPage(
      "characters",
      id,
      (c) => `
    ${field("Identity block (LOCKED — paste verbatim)", ta(c, "block", "characters", c.id))}
    ${field("Drift notes", ta(c, "driftNotes", "characters", c.id))}
    ${field("Blocking label (optional)", inp(c, "blockingNote", "characters", c.id, "e.g. a seated figure labelled KAI"))}
    ${field("Expression set (for the sheet builder)", inp(c, "expressions", "characters", c.id))}
    ${voicePanel(c)}`,
    );
  },
  location(id) {
    return entityPage("locations", id, (l) =>
      `${field("Canon description", ta(l, "description", "locations", l.id))}${field("Notes", ta(l, "notes", "locations", l.id))}${field("Blocking label (optional)", inp(l, "blockingNote", "locations", l.id, "e.g. narrow industrial galley interior"))}`,
    );
  },
  prop(id) {
    return entityPage("props", id, (p) =>
      `${field("Canon description", ta(p, "description", "props", p.id))}${field("Notes", ta(p, "notes", "props", p.id))}${field("Blocking label (optional)", inp(p, "blockingNote", "props", p.id, "e.g. a small radio labelled PROP-RADIO"))}`,
    );
  },
  vehicle(id) {
    return entityPage("vehicles", id, (v) =>
      `${field("Canon description", ta(v, "description", "vehicles", v.id))}${field("Notes", ta(v, "notes", "vehicles", v.id))}${field("Blocking label (optional)", inp(v, "blockingNote", "vehicles", v.id, "e.g. a parked utility truck labelled VEH-TRUCK"))}`,
    );
  },
  characters() {
    return entityView(
      "Characters",
      "characters",
      SCAN.anchors,
      (c) => `
    <div class="block-quote">${esc(c.block || "")}</div>
    <button class="copy-btn" onclick="copyText(this.previousElementSibling.textContent)">COPY IDENTITY BLOCK</button>
    ${field("Identity block (LOCKED — paste verbatim)", ta(c, "block", "characters", c.id))}
    ${field("Drift notes", ta(c, "driftNotes", "characters", c.id))}
    ${field("Blocking label (optional)", inp(c, "blockingNote", "characters", c.id, "e.g. a seated figure labelled KAI"))}
    ${field("Expression set (for the sheet builder)", inp(c, "expressions", "characters", c.id))}
    ${voicePanel(c)}`,
    );
  },
  locations() {
    return entityView("Locations", "locations", SCAN.plates, (l) =>
      field("Notes", ta(l, "notes", "locations", l.id)),
    );
  },
  props() {
    return entityView("Props", "props", SCAN.props, (p) =>
      field("Notes", ta(p, "notes", "props", p.id)),
    );
  },
  vehicles() {
    return entityView("Vehicles", "vehicles", SCAN.vehicles || [], (v) =>
      field("Notes", ta(v, "notes", "vehicles", v.id)),
    );
  },
  audio() {
    return entityView("Audio", "audio", SCAN.audio || [], (x) =>
      field("Notes", ta(x, "notes", "audio", x.id)),
    );
  },
  sound(id) {
    return entityPage("audio", id, (x) =>
      `${field("Notes / mix intent", ta(x, "notes", "audio", x.id))}
      <label class="checkline"><input type="checkbox" ${x.cleanMaster ? "checked" : ""} onchange="setVal('audio','${x.id}','cleanMaster',this.checked)"> Clean master — generate once; later degradation or variants are derived from this recording</label>`,
    );
  },


  async settings() {
    const [c, health, backupData] = await Promise.all([
      fetch("/api/config").then((r) => r.json()),
      fetch("/api/system/health").then((r) => r.json()).catch(() => ({})),
      projectBackupList(),
    ]);
    CONFIG = c || {};
    applyTheme();
    const appearance = c.appearance || {}, workspace = c.workspace || {}, naming = c.naming || {};
    const fal = c.generation?.fal || {}, provider = c.assistant?.provider || "ollama";
    const tabs = [
      ["appearance", "Appearance", "Brand styling and layout density"],
      ["files", "Files & storage", "Project roots and sync behavior"],
      ["naming", "Naming & organization", "Filenames and version rules"],
      ["project", "Project", "Title, prompts and exports"],
      ["assistant", "Assistant", "AI provider configuration"],
      ["generation", "Generation", "Optional FAL image defaults"],
      ["recovery", "Recovery & advanced", "Backups and diagnostics"],
    ];
    const selected = boundedFocusedTask("settings-task", "settings", tabs.map((row) => row[0]), "appearance");
    const tabButton = ([id, label, detail]) => `<button type="button" class="${selected === id ? "selected" : ""}" onclick="selectBoundedTask('settings-task','settings','${id}')"><b>${label}</b><small>${detail}</small></button>`;
    /* Backups, server status and diagnostics are not AI-assisted services, so they no
       longer sit under a heading that says they are. */
    const tabGroup = (heading, rows) => `<section><span>${heading}</span><div class="settings-tabs">${rows.map(tabButton).join("")}</div></section>`;
    const tabbar = `<nav class="settings-nav-shell" aria-label="Settings sections">${tabGroup("WORKSPACE", tabs.slice(0, 4))}${tabGroup("OPTIONAL ASSISTED SERVICES", tabs.slice(4, 6))}${tabGroup("BACKUPS & DIAGNOSTICS", tabs.slice(6))}</nav>`;
    /* One statement per subsection about how it stores changes, in the same place on
       every panel. "Save" records the setting; "Apply" records it and acts on the
       folders on disk straight away; the project record saves itself. */
    const panelState = (model, verb) => `<div class="settings-save-line"><span class="settings-save-state" id="settings-panel-state" data-save-model="${attr(model)}" data-state="clean" role="status">No unsaved changes.</span><small class="settings-save-model">${verb}</small></div>`;
    const appearancePanel = `<section class="settings-block brand-settings"><div class="settings-title-row"><div><h3>Appearance</h3><p class="hint">Changing any control below repaints the workspace immediately so you can judge it at full size. That is a preview only — it is kept for this browser and this project when you save, and dropped if you leave Settings without saving.</p></div><div class="settings-inline-actions"><button class="ghost-btn" onclick="resetAppearanceSettings()">Load defaults</button><button class="ghost-btn" onclick="discardAppearancePreview()">Discard preview</button></div></div><div class="two-col">
      ${field("Accent color", `<select id="cfg-theme-accent" onchange="previewAppearanceSettings()"><option value="blue" ${(appearance.accent || "blue") === "blue" ? "selected" : ""}>CineBraid cyan</option><option value="green" ${appearance.accent === "green" ? "selected" : ""}>Signal green</option><option value="amber" ${appearance.accent === "amber" ? "selected" : ""}>Warm amber</option><option value="rust" ${appearance.accent === "rust" ? "selected" : ""}>Rust</option></select>`)}
      ${field("Surface theme", `<select id="cfg-theme-surface" onchange="previewAppearanceSettings()"><option value="night" ${(appearance.surface || "night") === "night" ? "selected" : ""}>Dark studio</option><option value="cool" ${appearance.surface === "cool" ? "selected" : ""}>Website navy</option><option value="warm" ${appearance.surface === "warm" ? "selected" : ""}>Warm studio</option><option value="light" ${appearance.surface === "light" ? "selected" : ""}>Light canvas</option></select>`)}
      ${field("Interface density", `<select id="cfg-ui-density" onchange="previewAppearanceSettings()"><option value="comfortable" ${(appearance.density || "comfortable") === "comfortable" ? "selected" : ""}>Comfortable</option><option value="compact" ${appearance.density === "compact" ? "selected" : ""}>Compact</option></select>`)}
      ${field("Interface scale", `<input id="cfg-ui-scale" type="range" min="90" max="110" step="5" value="${attr(Number(appearance.scale || 100))}" oninput="previewAppearanceSettings()"><div class="range-readout" id="cfg-ui-scale-readout">${esc(String(Number(appearance.scale || 100)))}%</div>`)}
      ${field("Font system", `<select id="cfg-ui-font" onchange="previewAppearanceSettings()"><option value="studio" ${(appearance.font || "studio") === "studio" ? "selected" : ""}>Studio sans</option><option value="system" ${appearance.font === "system" ? "selected" : ""}>System UI</option><option value="editorial" ${appearance.font === "editorial" ? "selected" : ""}>Editorial / condensed</option></select>`)}
      ${field("Help mode", `<select id="cfg-help-mode"><option value="guided" ${(appearance.helpMode || HELP_MODE || "guided") === "guided" ? "selected" : ""}>Guided</option><option value="minimal" ${(appearance.helpMode || HELP_MODE) === "minimal" ? "selected" : ""}>Minimal</option></select>`)}
      <div class="settings-preview-card"><span>Brand preview</span><b>Keep every shot tied to the approved truth.</b><small>Accent, surface, density, scale and font are shown here exactly as they will look once saved.</small></div>
    </div><div class="settings-actions"><button class="add-btn" onclick="saveAppearanceSettings()">Save appearance</button>${panelState("preview", "Save keeps this appearance for this browser.")}</div></section>`;
    const filesPanel = `<section class="settings-block"><div class="settings-title-row"><div><h3>Files & storage</h3><p class="hint">These folders control where your project records, media, exports and backups are kept. Changing the project folder copies any missing project files across before it switches.</p></div><button class="ghost-btn settings-head-button" onclick="refreshWorkspaceStatus()">Check active paths</button></div><div class="two-col">
      ${field("Project root", `<input id="cfg-project-root" value="${attr(workspace.projectRoot || "")}" placeholder="C:\\CineBraid\\Projects">`)}
      ${field("Media root", `<input id="cfg-media-root" value="${attr(workspace.mediaRoot || "")}" placeholder="C:\\CineBraid\\Projects\\media">`)}
      ${field("Output folder", `<input id="cfg-output-root" value="${attr(workspace.outputRoot || "")}" placeholder="C:\\CineBraid\\Projects\\exports">`)}
      ${field("Backup folder", `<input id="cfg-backup-root" value="${attr(workspace.backupRoot || "")}" placeholder="C:\\CineBraid\\Projects\\backups">`)}
      ${field("Folder strategy", `<select id="cfg-file-strategy"><option value="project/scene/shot" ${(workspace.fileStrategy || "project/scene/shot") === "project/scene/shot" ? "selected" : ""}>By project / scene / shot</option><option value="project/type" ${workspace.fileStrategy === "project/type" ? "selected" : ""}>By project / asset type</option><option value="stage" ${workspace.fileStrategy === "stage" ? "selected" : ""}>By workflow stage</option></select>`)}
      ${field("Sync mode", `<select id="cfg-sync-mode"><option value="manual" ${(workspace.syncMode || "manual") === "manual" ? "selected" : ""}>Manual sync</option><option value="assisted" ${workspace.syncMode === "assisted" ? "selected" : ""}>Assisted / watch for changes</option></select><span class="hint">Your production stays under your control. Manual sync is still the safest default.</span>`)}
    </div><div id="workspace-settings-note" class="workspace-settings-note">Project root controls all project records and media. Assisted sync copies new files from the configured media root without overwriting existing files.</div><div class="settings-actions"><button class="add-btn" onclick="saveStorageSettings()">Apply storage paths</button>${panelState("apply", "Apply because CineBraid also creates these folders and checks it can write to them.")}</div></section>`;
    const namingPanel = `<section class="settings-block"><div class="settings-title-row"><div><h3>Naming & organization</h3><p class="hint">Set the filenames CineBraid gives to approved frames and exports.</p></div></div><div class="two-col">
      ${field("Approval filename template", `<input id="cfg-filename-template" value="${attr(naming.filenameTemplate || '{project}_{shot}_{slot}_V{version}.{ext}')}" oninput="updateFilenameTemplatePreview()"><span class="hint">Tokens: {project} {scene} {shot} {slot} {stage} {state} {version} {ext}</span>`)}
      ${field("Export filename template", `<input id="cfg-export-template" value="${attr(naming.exportTemplate || '{project}_{scene}_{shot}_{stage}_V{version}.{ext}')}" >`)}
      ${field("Version padding", `<input id="cfg-version-padding" type="number" min="2" max="5" value="${attr(Number(naming.versionPadding || 3))}" oninput="updateFilenameTemplatePreview()">`)}
      ${field("Collision behavior", `<select id="cfg-collision-behavior"><option value="increment" ${(naming.collisionBehavior || 'increment') === 'increment' ? 'selected' : ''}>Increment version</option><option value="keep-original" ${naming.collisionBehavior === 'keep-original' ? 'selected' : ''}>Keep original filename</option><option value="ask" ${naming.collisionBehavior === 'ask' ? 'selected' : ''}>Ask on collision</option></select>`)}
    </div><div class="filename-preview"><span>Example preview</span><code id="cfg-filename-preview">${esc(["SIGNAL_BLOOM","SH013","PRIMARY","V003.png"].join("_"))}</code></div><div class="settings-actions"><button class="add-btn" onclick="saveNamingSettings()">Save naming rules</button>${panelState("manual", "Save records the rules; existing filenames are left alone.")}</div></section>`;
    const projectPanel = `<section class="settings-block"><div class="settings-title-row"><div><h3>Project</h3><p class="hint">These details belong to the project record, which saves itself a moment after every edit — the same way the rest of CineBraid saves your work. There is nothing to press, and the line below always states where the last edit stands.</p></div></div><div class="two-col">
      ${field("Title", `<input value="${attr(P.meta.title)}" onchange="setProjectTitle(this.value)">`)}
      ${field("Format", `<input value="${attr(P.meta.format || "")}" onchange="P.meta.format=this.value;dirty()">`)}
      ${field("Default aspect ratio", `<input list="cinebraid-aspect-presets" value="${attr(P.meta.aspectRatio || "")}" placeholder="2.39:1" onchange="setGlobalCreationField('aspectRatio',this.value)"><datalist id="cinebraid-aspect-presets">${CINEBRAID_ASPECT_PRESETS.map(([value, label]) => `<option value="${attr(value)}">${esc(label)}</option>`).join("")}</datalist><span class="hint">The format every shot is judged and generated in unless a shot overrides it. Any width:height is accepted.</span>`)}
      ${field("Workspace emphasis", `<select onchange="setProjectWorkflowEmphasis(this.value)"><option value="manual" ${projectWorkflowEmphasis() === "manual" ? "selected" : ""}>Manual-first production</option><option value="assisted" ${projectWorkflowEmphasis() === "assisted" ? "selected" : ""}>Assisted generation</option></select><span class="hint">This changes hierarchy and defaults, not project data.</span>`)}
      ${field("Prompt versions kept per shot", `<input type="number" min="1" max="100" value="${attr(P.meta.promptBuildRetention || 12)}" onchange="P.meta.promptBuildRetention=Math.max(1,Math.round(Number(this.value)||12));applyPromptBuildRetention(P);dirty();route()"><span class="hint">Older prompt versions are trimmed past this number. Approved and linked prompts are never trimmed.</span>`)}
      ${field("World / setting", `<textarea onchange="setGlobalCreationField('worldSetting',this.value)">${esc(P.meta.world?.setting || "")}</textarea>`)}
      ${field("Global visual style", `<textarea id="cfg-global-visual-style" aria-label="Global visual style" onchange="setGlobalCreationField('globalStylePrompt',this.value)">${esc(P.meta.globalStylePrompt || "")}</textarea>`)}
      ${field("Global exclusions", `<textarea onchange="setGlobalCreationField('globalNegativePrompt',this.value)">${esc(P.meta.globalNegativePrompt || P.meta.world?.reject || "")}</textarea>`)}
    </div><div class="settings-save-line"><span class="settings-save-state" data-mirror-save-state="1" data-state="saved" role="status">Saved automatically</span><small class="settings-save-model">Project details save themselves; the two buttons below only produce copies.</small></div><div class="settings-actions"><button class="add-btn" onclick="doExport()">Export project</button><button class="ghost-btn" onclick="downloadJSON()">Download JSON backup</button><span id="export-note" class="hint"></span></div></section>`;
    const providerFields = provider === "ollama"
      ? `${field("Local endpoint", `<input id="cfg-ollama" value="${attr(c.ollamaUrl || "http://localhost:11434")}">`)}${field("Local text model", `<input id="cfg-omodel" value="${attr(c.ollamaModel || "")}">`)}${field("Local vision model", `<input id="cfg-vmodel" value="${attr(c.ollamaVisionModel || "")}">`)}`
      : provider === "anthropic"
        ? `${field("Claude API key", `<input id="cfg-key" value="${attr(c.anthropicKey || "")}">`)}${field("Claude model", `<input id="cfg-model" value="${attr(c.anthropicModel || "claude-sonnet-4-6")}">`)}`
        : provider === "openai"
          ? `${field("OpenAI API key", `<input id="cfg-openai-key" value="${attr(c.openaiKey || "")}">`)}${field("OpenAI model", `<input id="cfg-openai-model" value="${attr(c.openaiModel || "gpt-5.2")}">`)}${field("OpenAI vision model", `<input id="cfg-openai-vision" value="${attr(c.openaiVisionModel || c.openaiModel || "gpt-5.2")}">`)}`
          : provider === "custom"
            ? `${field("Custom base URL", `<input id="cfg-custom-url" value="${attr(c.customBaseUrl || "http://127.0.0.1:8000/v1")}">`)}${field("Custom API key", `<input id="cfg-custom-key" value="${attr(c.customKey || "")}">`)}${field("Custom text model", `<input id="cfg-custom-model" value="${attr(c.customModel || "")}">`)}${field("Custom vision model", `<input id="cfg-custom-vision" value="${attr(c.customVisionModel || "")}">`)}`
            : `<div class="settings-disabled-provider"><b>AI assistance is off</b><span>Deterministic prompt building and all manual workflows remain available.</span></div>`;
    const assistantPanel = `<section class="settings-block"><div class="settings-title-row"><div><h3>Assistant</h3><p class="hint">Choose one provider. Only that provider's settings are shown, and AI stays off until you choose one.</p></div><button class="ghost-btn" ${provider === "none" ? "disabled" : ""} onclick="testAssistantConnection()">Test connection</button></div><div class="policy-options assistant-options">${[["ollama","Local AI"],["anthropic","Claude API"],["openai","OpenAI API"],["custom","Custom server"],["none","No AI"]].map(([v,l]) => `<button class="policy-option ${provider === v ? "on" : ""}" onclick="setAssistantProvider('${v}')"><b>${l}</b></button>`).join("")}</div><div class="two-col">${field("Vision assistant", `<select id="assistant-vision-provider"><option value="same" ${(c.assistant?.visionProvider || "same") === "same" ? "selected" : ""}>Same as main assistant</option><option value="ollama" ${c.assistant?.visionProvider === "ollama" ? "selected" : ""}>Local vision</option><option value="anthropic" ${c.assistant?.visionProvider === "anthropic" ? "selected" : ""}>Claude vision</option><option value="openai" ${c.assistant?.visionProvider === "openai" ? "selected" : ""}>OpenAI vision</option><option value="custom" ${c.assistant?.visionProvider === "custom" ? "selected" : ""}>Custom vision</option><option value="none" ${c.assistant?.visionProvider === "none" ? "selected" : ""}>Disabled</option></select>`)}${providerFields}</div><div class="settings-actions"><button class="add-btn" onclick="saveConfig('assistant')">Save assistant settings</button><span id="assistant-test-note" class="hint"></span>${panelState("manual", "Choosing a provider above takes effect at once; the fields below are saved here.")}</div></section>`;
    const generationPanel = `<section class="settings-block fal-settings"><div class="settings-title-row"><div><h3>Generation</h3><p class="hint">Optional in-app FAL implementation. Manual external generation remains first-class.</p></div><button class="ghost-btn" onclick="testFalGenerationConnection()">Check setup</button></div><label class="checkline"><input id="cfg-fal-enabled" type="checkbox" ${fal.enabled ? "checked" : ""}> Enable FAL image and video generation</label><div class="two-col">
      ${field("FAL API key", `<input id="cfg-fal-key" type="password" autocomplete="off" value="${attr(fal.apiKey || "")}" placeholder="stored on this CineBraid server"><span class="hint">Key source: ${esc(fal.keySource || "none")}</span>`)}
      ${field("Text-to-image model", `<input id="cfg-fal-text-model" value="${attr(fal.textModel || "openai/gpt-image-2")}">`)}
      ${field("Edit model", `<input id="cfg-fal-edit-model" value="${attr(fal.editModel || "openai/gpt-image-2/edit")}">`)}
      <div class="settings-subheading"><span>MiniMax H3 video endpoints</span><small>Official FAL defaults; change only if FAL renames or versions the endpoints.</small></div>
      ${field("H3 text to video", `<input id="cfg-fal-h3-text-model" value="${attr(fal.h3TextModel || "minimax/h3/text-to-video")}">`)}
      ${field("H3 first / last frame", `<input id="cfg-fal-h3-image-model" value="${attr(fal.h3ImageModel || "minimax/h3/image-to-video")}">`)}
      ${field("H3 reference / multi-frame", `<input id="cfg-fal-h3-reference-model" value="${attr(fal.h3ReferenceModel || "minimax/h3/reference-to-video")}">`)}
      ${field("H3 default resolution", `<select id="cfg-fal-h3-resolution"><option value="2K" ${(fal.h3Resolution || "2K") === "2K" ? "selected" : ""}>2K</option><option value="768P" ${fal.h3Resolution === "768P" ? "selected" : ""}>768P</option></select>`)}
      ${field("Blocking options", `<select id="cfg-fal-blocking-outputs">${[1,2,3,4].map((n) => `<option value="${n}" ${Number(fal.blockingOutputs || 2) === n ? "selected" : ""}>${n}</option>`).join("")}</select>`)}
      ${field("Blocking quality", `<select id="cfg-fal-blocking-quality">${["low","medium","high"].map((v) => `<option value="${v}" ${(fal.blockingQuality || "low") === v ? "selected" : ""}>${v[0].toUpperCase()+v.slice(1)}</option>`).join("")}</select>`)}
      ${field("Blocking resolution", `<select id="cfg-fal-blocking-resolution">${[["1k","1K"],["2k","2K"],["4k","4K"]].map(([v,l]) => `<option value="${v}" ${(fal.blockingResolution || "1k") === v ? "selected" : ""}>${l}</option>`).join("")}</select>`)}
      ${field("Frame options", `<select id="cfg-fal-frame-outputs">${[1,2,3,4].map((n) => `<option value="${n}" ${Number(fal.frameOutputs || 2) === n ? "selected" : ""}>${n}</option>`).join("")}</select>`)}
      ${field("Frame quality", `<select id="cfg-fal-frame-quality">${["low","medium","high"].map((v) => `<option value="${v}" ${(fal.frameQuality || "high") === v ? "selected" : ""}>${v[0].toUpperCase()+v.slice(1)}</option>`).join("")}</select>`)}
      ${field("Frame resolution", `<select id="cfg-fal-frame-resolution">${[["1k","1K"],["2k","2K"],["4k","4K"]].map(([v,l]) => `<option value="${v}" ${(fal.frameResolution || "1k") === v ? "selected" : ""}>${l}</option>`).join("")}</select>`)}
      ${field("Estimated cost per image (USD)", `<input id="cfg-fal-cost-per-image" type="number" min="0" max="100" step="0.001" value="${attr(Number(fal.estimatedCostPerImage || 0))}" placeholder="0.00">`)}
    </div><div class="settings-actions"><button class="add-btn" onclick="saveConfig('generation')">Save generation settings</button><span id="fal-test-note" class="settings-state-chip" data-tone="${fal.enabled ? (fal.apiKey || fal.keySource === "environment" ? "ready" : "attention") : "off"}">${fal.enabled ? (fal.apiKey || fal.keySource === "environment" ? "FAL generation is set up" : "FAL generation is on, but needs a key") : "FAL generation is off"}</span>${panelState("manual", "Save records these defaults; nothing is generated and nothing is charged.")}</div><p class="hint fal-security-note">Paid generation is only submitted after confirmation.</p></section>`;
    const recoveryPanel = `<section class="settings-block project-recovery"><div class="settings-title-row"><div><h3>Recovery & advanced</h3><p class="hint">Rotating backups, diagnostics and support records.</p></div><button class="ghost-btn" onclick="createManualProjectBackup()">Create backup now</button></div><div class="settings-health-grid"><article><span>Server</span><b>${health.ok === false ? "Needs attention" : "Running"}</b><small>${esc(health.message || health.status || "Local CineBraid service")}</small></article><article><span>Project folder</span><b>${esc(activeProjectSlug() || "—")}</b><small>The folder name this project is stored under. Use Reports for integrity checks and the project log.</small></article></div><div id="project-backup-note" class="hint"></div>${backupData.error ? `<p class="hint backup-list-error" role="alert">${esc(backupData.error)}</p>` : (backupData.backups || []).length ? `<div class="project-backup-list">${backupData.backups.map((item) => `<article><div><b title="${attr(item.name)}">${esc(item.name)}</b><small>${esc(new Date(item.modifiedAt).toLocaleString())} · ${Math.max(1,Math.round(Number(item.size || 0) / 1024))} KB</small></div><button class="ghost-btn backup-restore-btn" onclick="restoreProjectBackup('${attr(item.name)}')">Restore</button></article>`).join("")}</div>` : `<p class="hint">No rotating backups yet. A backup is created before each validated save.</p>`}<div class="settings-save-line"><span class="settings-save-state" data-state="none" role="status">Nothing on this panel is a setting.</span><small class="settings-save-model">Every control here acts as soon as you use it, so there is nothing to save.</small></div><div class="settings-actions"><a class="ghost-btn" href="#/reports">Open project log & reports</a><button class="ghost-btn" onclick="downloadJSON()">Download JSON backup</button></div></section>`;
    const body = { appearance: appearancePanel, files: filesPanel, naming: namingPanel, project: projectPanel, assistant: assistantPanel, generation: generationPanel, recovery: recoveryPanel }[selected] || appearancePanel;
    setTimeout(() => { if (typeof initSettingsPanel === "function") initSettingsPanel(); }, 0);
    return `<div class="view-head"><div><div class="eyebrow">Settings</div><span class="view-title">Settings</span><div class="view-sub">Appearance, where files are kept, how they are named, and the optional services CineBraid may use.</div></div></div>${tabbar}<div class="settings-selected-tab" data-settings-tab="${attr(selected)}">${body}</div>`;
  },
};

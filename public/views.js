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
  /* O5. The project-level production-media destination. Its tab lives in the hash
     rather than in localStorage, unlike LIBRARY_TAB, so a link to
     #/results/rejected opens on rejected for the person who received it. */
  results(tab) { return resultsView(tab || "current"); },
  reports(id) { return reportsView(id || ""); },
  scene(id) {
    const sc = sceneById(id);
    if (!sc) return sharedNotFoundView("Scene", id, "#/shots/scenes", "Scenes", (P.scenes || []).map((row) => row.id), "#/scene");
    const shots = P.shots.filter((s) => s.scene === sc.id);
    const shotPage = boundedPage(shots, "shots", `scene:${sc.id}`, BOUNDED_PAGE_SIZES.shots);
    return `<div class="crumb"><a href="#/shots/scenes">Shots</a> / ${esc(sc.id)}</div>
    ${typeof actionRefusalMarkup === "function" ? actionRefusalMarkup(`scene-delete:${sc.id}`) : ""}
    <input class="page-title-input" value="${attr(sc.title)}" onchange="setVal('scenes','${sc.id}','title',this.value)">
    <div class="chip-row" style="margin:10px 0 4px">
      ${["A", "B"].map((t) => `<button class="tier-badge ${t}" style="${sc.tier === t ? "" : "opacity:.35"}" onclick="setVal('scenes','${sc.id}','tier','${t}');route()">TIER ${t}</button>`).join("")}
      <input class="status-select" style="width:130px" placeholder="stage (optional)" value="${attr(sc.stage ?? "")}" onchange="setVal('scenes','${sc.id}','stage',this.value)">
      <span class="hint">${mmss(plannedRuntimeOf(shots).seconds)} planned in this scene${esc(unplannedRuntimeNote(plannedRuntimeOf(shots)))}</span>
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
      /* R23 — THE NORMAL DETAILS OF A CHARACTER, AND ONLY THOSE.
       *
       * Two changes, both presentational. The identity block keeps its rule and
       * loses the shout: "LOCKED — PASTE VERBATIM" is an instruction about how
       * to use the text, so it reads as one under the field rather than as a
       * heading in the app's internal voice.
       *
       * And the voice panel is gone from here — not removed, MOVED. It is eight
       * fields about a completely different craft, and entityDetailsHistoryMarkup
       * now renders it as its own collapsed section carrying the shipped voice
       * outcome word. Every field, writer and value is identical. */
      (c) => `
    ${field("Identity block", ta(c, "block", "characters", c.id))}
    <p class="hint">Paste this verbatim into a prompt. It is the locked description of who this character is, and editing it changes every prompt built from it.</p>
    ${field("Drift notes", ta(c, "driftNotes", "characters", c.id))}
    ${field("Blocking label (optional)", inp(c, "blockingNote", "characters", c.id, "e.g. a seated figure labelled KAI"))}
    ${field("Expression set (for the sheet builder)", inp(c, "expressions", "characters", c.id))}`,
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
    const [c, health, backupData, accountData] = await Promise.all([
      fetch("/api/config").then((r) => r.json()),
      fetch("/api/system/health").then((r) => r.json()).catch(() => ({})),
      projectBackupList(),
      fetch("/api/accounts").then((r) => r.json()).catch(() => ({})),
    ]);
    CONFIG = c || {};
    applyTheme();
    const appearance = c.appearance || {}, workspace = c.workspace || {}, naming = c.naming || {};
    const fal = c.generation?.fal || {}, provider = c.assistant?.provider || "ollama";
    const tabs = [
      ["appearance", "Appearance", "Brand styling and layout density"],
      ["files", "Files & storage", "Project roots and sync behavior"],
      ["access", "Access & security", "Passcodes for other devices on your network"],
      ["naming", "Naming & organization", "Filenames and version rules"],
      ["project", "Project", "Title, prompts and exports"],
      ["assistant", "Assistant", "AI provider configuration"],
      ["generation", "Generation", "Optional FAL image defaults"],
      ["accounts", "Accounts", "Connect the services you have an account with"],
      ["recovery", "Recovery & advanced", "Backups and diagnostics"],
    ];
    const selected = boundedFocusedTask("settings-task", "settings", tabs.map((row) => row[0]), "appearance");
    const tabButton = ([id, label, detail]) => `<button type="button" class="${selected === id ? "selected" : ""}" onclick="selectBoundedTask('settings-task','settings','${id}')"><b>${label}</b><small>${detail}</small></button>`;
    /* Backups, server status and diagnostics are not AI-assisted services, so they no
       longer sit under a heading that says they are. */
    const tabGroup = (heading, rows) => `<section><span>${heading}</span><div class="settings-tabs">${rows.map(tabButton).join("")}</div></section>`;
    const tabbar = `<nav class="settings-nav-shell" aria-label="Settings sections">${tabGroup("WORKSPACE", tabs.slice(0, 5))}${tabGroup("OPTIONAL ASSISTED SERVICES", tabs.slice(5, 8))}${tabGroup("BACKUPS & DIAGNOSTICS", tabs.slice(8))}</nav>`;
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
    const filesPanel = `<section class="settings-block"><div class="settings-title-row"><div><h3>Files & storage</h3><p class="hint">These folders control where your project records, media, exports and backups are kept. Changing the project folder copies any missing project files across before it switches.</p></div><button class="ghost-btn settings-head-button" onclick="refreshWorkspaceStatus()">Check active paths</button><button class="ghost-btn settings-head-button" onclick="openCineBraidProjectFolder()">Open project folder</button></div><div class="two-col">
      ${field("Project root", `<input id="cfg-project-root" value="${attr(workspace.projectRoot || "")}" placeholder="C:\\CineBraid\\Projects">`)}
      ${field("Media root", `<input id="cfg-media-root" value="${attr(workspace.mediaRoot || "")}" placeholder="C:\\CineBraid\\Projects\\media">`)}
      ${field("Output folder", `<input id="cfg-output-root" value="${attr(workspace.outputRoot || "")}" placeholder="C:\\CineBraid\\Projects\\exports">`)}
      ${field("Backup folder", `<input id="cfg-backup-root" value="${attr(workspace.backupRoot || "")}" placeholder="C:\\CineBraid\\Projects\\backups">`)}
      ${field("Folder strategy", `<select id="cfg-file-strategy"><option value="project/scene/shot" ${(workspace.fileStrategy || "project/scene/shot") === "project/scene/shot" ? "selected" : ""}>By project / scene / shot</option><option value="project/type" ${workspace.fileStrategy === "project/type" ? "selected" : ""}>By project / asset type</option><option value="stage" ${workspace.fileStrategy === "stage" ? "selected" : ""}>By workflow stage</option></select>`)}
      ${field("Sync mode", `<select id="cfg-sync-mode"><option value="manual" ${(workspace.syncMode || "manual") === "manual" ? "selected" : ""}>Manual sync</option><option value="assisted" ${workspace.syncMode === "assisted" ? "selected" : ""}>Assisted / watch for changes</option></select><span class="hint">Your production stays under your control. Manual sync is still the safest default.</span>`)}
    </div><div id="workspace-settings-note" class="workspace-settings-note">Project root controls all project records and media. Assisted sync copies new files from the configured media root without overwriting existing files.</div><div class="settings-actions"><button class="add-btn" onclick="saveStorageSettings()">Apply storage paths</button>${panelState("apply", "Apply because CineBraid also creates these folders and checks it can write to them.")}</div></section>`;
    /* Access & security. The server has supported an editor and a viewer passcode
       since the first commit — /api/login checks them and the gate in front of every
       route re-reads them on each request — but no Settings panel ever rendered the
       two fields savePass() reads, so the only way to set one was to hand-edit
       config.json. CineBraid could therefore warn a LAN user to set an editor
       passcode while offering nowhere to set it.

       Neither passcode is sent to a browser: the config secret registry replaces
       both with a set/unset marker, so this panel can say WHETHER one exists and
       nothing more. The two boxes are always empty, and a value typed into one
       replaces the stored passcode rather than editing it. */
    const accessPanel = `<section class="settings-block access-settings"><div class="settings-title-row"><div><h3>Access &amp; security</h3><p class="hint">CineBraid needs no passcode while this computer is the only one that can reach it. Use an editor passcode when CineBraid is accessible to other devices on your network — until one is set, anyone who can reach this address has full editing access.</p></div></div><div class="settings-health-grid"><article><span>Editor passcode</span><b id="cfg-epass-state">${c.editorPass ? "Set" : "Not set"}</b><small>Full access to the whole workspace.</small></article><article><span>Viewer passcode</span><b id="cfg-vpass-state">${c.viewerPass ? "Set" : "Not set"}</b><small>Read-only access to the Project Bible. Optional — with an editor passcode set and no viewer passcode, the Bible stays open to anyone who can reach this address.</small></article></div><div class="two-col">
      ${field("New editor passcode", `<input id="cfg-epass" type="password" autocomplete="new-password" spellcheck="false" placeholder="${c.editorPass ? "leave blank to keep the current passcode" : "choose an editor passcode"}"><span class="hint">A value typed here becomes the editor passcode when you save. Leave it blank to keep ${c.editorPass ? "the one already set" : "editor authentication off"}.</span>`)}
      ${field("New viewer passcode", `<input id="cfg-vpass" type="password" autocomplete="new-password" spellcheck="false" placeholder="${c.viewerPass ? "leave blank to keep the current passcode" : "optional"}"><span class="hint">A value typed here becomes the viewer passcode when you save. Leave it blank to keep whatever is stored.</span>`)}
    </div><div class="settings-actions"><button class="add-btn" onclick="savePass()">Save passcodes</button><span id="pass-note" class="hint" role="status"></span>${panelState("manual", "Save records the passcodes on this CineBraid server; nothing changes until you press it.")}</div><p class="hint access-security-note">A stored passcode is never sent back to the browser, so both boxes always start empty. After a change, sign in again at <code>/login.html</code>.</p></section>`;
    const namingPanel = `<section class="settings-block"><div class="settings-title-row"><div><h3>Naming & organization</h3><p class="hint">Set the filenames CineBraid gives to approved frames and exports.</p></div></div><div class="two-col">
      ${field("Approval filename template", `<input id="cfg-filename-template" value="${attr(naming.filenameTemplate || '{project}_{shot}_{slot}_V{version}.{ext}')}" oninput="updateFilenameTemplatePreview()"><span class="hint">Tokens: {project} {scene} {shot} {slot} {stage} {state} {version} {ext}</span>`)}
      ${field("Export filename template", `<input id="cfg-export-template" value="${attr(naming.exportTemplate || '{project}_{scene}_{shot}_{stage}_V{version}.{ext}')}" >`)}
      ${field("Version padding", `<input id="cfg-version-padding" type="number" min="2" max="5" value="${attr(Number(naming.versionPadding || 3))}" oninput="updateFilenameTemplatePreview()">`)}
      ${field("Collision behavior", `<select id="cfg-collision-behavior"><option value="increment" ${(naming.collisionBehavior || 'increment') === 'increment' ? 'selected' : ''}>Increment version</option><option value="keep-original" ${naming.collisionBehavior === 'keep-original' ? 'selected' : ''}>Keep original filename</option><option value="ask" ${naming.collisionBehavior === 'ask' ? 'selected' : ''}>Ask on collision</option></select>`)}
    </div><div class="filename-preview"><span>Example preview</span><code id="cfg-filename-preview">${esc(["SIGNAL_BLOOM","SH013","PRIMARY","V003.png"].join("_"))}</code></div><div class="settings-actions"><button class="add-btn" onclick="saveNamingSettings()">Save naming rules</button>${panelState("manual", "Save records the rules; existing filenames are left alone.")}</div></section>`;
    const projectPanel = `<section class="settings-block"><div class="settings-title-row"><div><h3>Project</h3><p class="hint">These details belong to the project record, which saves itself a moment after every edit — the same way the rest of CineBraid saves your work. There is nothing to press, and the line below always states where the last edit stands.</p></div></div><div class="two-col">
      ${field("Title", `<input value="${attr(P.meta.title)}" onchange="setProjectTitle(this.value)">`)}
      ${field("Format", `<input list="cinebraid-format-presets" value="${attr(P.meta.format || "")}" placeholder="Short film" onchange="P.meta.format=this.value;dirty()"><datalist id="cinebraid-format-presets">${PROJECT_FORMAT_PRESETS.filter(([value]) => value).map(([value, label]) => `<option value="${attr(value)}">${esc(label)}</option>`).join("")}</datalist><span class="hint">What this project is being made as. The same suggestions the new-project screen offers, and any other wording is still accepted.</span>`)}
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
            ? `${field("Custom base URL", `<input id="cfg-custom-url" value="${attr(c.customBaseUrl || "http://127.0.0.1:8000/v1")}">`)}${field("Custom API key", `<input id="cfg-custom-key" value="${attr(c.customKey || "")}">`)}${field("Custom text model", `<input id="cfg-custom-model" value="${attr(c.customModel || "")}">`)}${field("Custom vision model", `<input id="cfg-custom-vision" value="${attr(c.customVisionModel || "")}">`)}${field("Sampling temperature", `<input id="cfg-custom-temperature" type="number" min="0" max="2" step="0.1" value="${attr(c.customTemperature === "" || c.customTemperature === undefined ? "" : Number(c.customTemperature))}" placeholder="server default"><span class="hint">Leave blank to send nothing. Low values such as 0.2 keep structured answers repeatable.</span>`)}${field("Top-K sampling", `<input id="cfg-custom-top-k" type="number" min="1" max="1000" step="1" value="${attr(c.customTopK === "" || c.customTopK === undefined ? "" : Number(c.customTopK))}" placeholder="server default"><span class="hint">Leave blank unless your server accepts top_k. Not every OpenAI-compatible server does.</span>`)}${field("Model thinking", `<select id="cfg-custom-thinking"><option value="auto" ${(c.customThinking || "auto") === "auto" ? "selected" : ""}>Server default</option><option value="disabled" ${c.customThinking === "disabled" ? "selected" : ""}>Ask the server to skip thinking</option></select><span class="hint">Reasoning servers can spend the whole token budget thinking and return an empty answer. Only choose the second option if your server understands it.</span>`)}`
            : `<div class="settings-disabled-provider"><b>AI assistance is off</b><span>Deterministic prompt building and all manual workflows remain available.</span></div>`;
    /* Continuity observation resolves separately from general vision because it
       is the one consumer that sends exactly one image per request, against a
       frozen schema. Two fields only: where it goes and which model answers.
       Everything else about that request is the qualified contract and is not a
       preference. */
    const continuityConfig = c.continuity || {};
    const continuityInherited = continuityConfig.visionProvider === "openai" ? (c.openaiBaseUrl || "") : continuityConfig.visionProvider === "custom" ? (c.customBaseUrl || "") : "";
    const continuityProviderFields = `<div class="two-col"><div class="settings-subheading"><span>Continuity analysis</span><small>Checks declared references frame by frame. Configured on its own because it sends exactly one image per request — general vision settings do not apply to it, and it does not need the main assistant to be a custom server.</small></div>${field("Continuity provider", `<select id="cfg-continuity-provider"><option value="" ${continuityConfig.visionProvider ? "" : "selected"}>Not configured — continuity checks stay off</option><option value="custom" ${continuityConfig.visionProvider === "custom" ? "selected" : ""}>Custom / OpenAI-compatible server</option><option value="openai" ${continuityConfig.visionProvider === "openai" ? "selected" : ""}>OpenAI API</option></select>`)}${field("Continuity endpoint", `<input id="cfg-continuity-base" value="${attr(continuityConfig.baseUrl || "")}" placeholder="${attr(continuityInherited || "http://127.0.0.1:8000/v1")}"><span class="hint">The OpenAI-compatible base URL, including <code>/v1</code>.${continuityInherited ? ` Leave blank to use ${esc(continuityInherited)}.` : " Leave blank to use the chosen provider's own address."}</span>`)}${field("Continuity model", `<input id="cfg-continuity-model" value="${attr(continuityConfig.visionModel || "")}" placeholder="the model this server serves"><span class="hint">Leave blank to use the provider's configured vision model.</span>`)}</div>`;
    const assistantPanel = `<section class="settings-block"><div class="settings-title-row"><div><h3>Assistant</h3><p class="hint">Choose one provider. Only that provider's settings are shown, and AI stays off until you choose one.</p></div><button class="ghost-btn" ${provider === "none" ? "disabled" : ""} onclick="testAssistantConnection()">Test connection</button></div><div class="policy-options assistant-options">${[["ollama","Local AI"],["anthropic","Claude API"],["openai","OpenAI API"],["custom","Custom server"],["none","No AI"]].map(([v,l]) => `<button class="policy-option ${provider === v ? "on" : ""}" onclick="setAssistantProvider('${v}')"><b>${l}</b></button>`).join("")}</div><div class="two-col">${field("Vision assistant", `<select id="assistant-vision-provider"><option value="same" ${(c.assistant?.visionProvider || "same") === "same" ? "selected" : ""}>Same as main assistant</option><option value="ollama" ${c.assistant?.visionProvider === "ollama" ? "selected" : ""}>Local vision</option><option value="anthropic" ${c.assistant?.visionProvider === "anthropic" ? "selected" : ""}>Claude vision</option><option value="openai" ${c.assistant?.visionProvider === "openai" ? "selected" : ""}>OpenAI vision</option><option value="custom" ${c.assistant?.visionProvider === "custom" ? "selected" : ""}>Custom vision</option><option value="none" ${c.assistant?.visionProvider === "none" ? "selected" : ""}>Disabled</option></select>`)}${providerFields}</div>${continuityProviderFields}<div class="settings-actions"><button class="add-btn" onclick="saveConfig('assistant')">Save assistant settings</button><span id="assistant-test-note" class="hint"></span>${panelState("manual", "Choosing a provider above takes effect at once; the fields below are saved here.")}</div></section>`;
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
      ${field("Estimated cost per second of motion (USD)", `<input id="cfg-fal-motion-rate" type="number" min="0" max="100" step="0.001" value="${attr(Number(fal.motionRate?.usdPerSecond || 0))}" placeholder="0.00"><small>Video is billed by the second, not by the image. Left at zero, CineBraid shows motion cost as unavailable rather than guessing — it ships no prices of its own.</small>`)}
      ${field("Where that motion price came from", `<input id="cfg-fal-motion-rate-source" type="text" maxlength="200" value="${attr(String(fal.motionRate?.source || ""))}" placeholder="fal pricing page"><small>Your own note, shown beside the estimate. CineBraid cannot check a provider's pricing page and will not claim it did.</small>`)}
      ${field("Date you read it", `<input id="cfg-fal-motion-rate-asof" type="date" value="${attr(String(fal.motionRate?.asOf || ""))}"><small>Left empty, the estimate says its freshness is unknown — which is better than a date nobody checked.</small>`)}
    </div><div class="settings-actions"><button class="add-btn" onclick="saveConfig('generation')">Save generation settings</button><span id="fal-test-note" class="settings-state-chip" data-tone="${fal.enabled ? (fal.apiKey || fal.keySource === "environment" ? "ready" : "attention") : "off"}">${fal.enabled ? (fal.apiKey || fal.keySource === "environment" ? "FAL generation is set up" : "FAL generation is on, but needs a key") : "FAL generation is off"}</span>${panelState("manual", "Save records these defaults; nothing is generated and nothing is charged.")}</div><p class="hint fal-security-note">Paid generation is only submitted after confirmation.</p></section>`;
    /* Accounts. Deliberately plain: an account is either connected to a named
       person or it is not, and everything a user can do about it is one button.
       None of the machinery behind it — the grant type, the redirect, the token
       lifetime, the scope bitmask — is a setting, so none of it is shown.

       There is no balance row. Civitai's public API exposes no balance, and a
       confident "0" would be a wrong number in a currency field. */
    const accountRows = Array.isArray(accountData?.accounts) ? accountData.accounts : [];
    const accountProviders = Array.isArray(accountData?.providers) ? accountData.providers : [];
    /* A browser on another machine may read the status; it cannot establish a
       credential, because the routes that receive one answer only this computer. */
    const onLocalMachine = accountData?.localMachine !== false;
    const accountStateWords = (row) => (
      row.status === "connected" ? (row.stale ? "Connected — not checked recently" : "Connected")
        : row.status === "expired" ? "Connection expired"
          : row.status === "connecting" ? "Connecting…"
            : row.status === "error" ? "Needs attention"
              : "Not connected");
    const accountConnectedRow = (row) => `<article class="account-row" data-account-status="${attr(row.status)}"><div><b>${esc(row.providerLabel || row.providerId)}</b><span class="account-identity">${esc(row.identity?.displayName ? `@${row.identity.displayName}` : "Connected account")}</span><small>${esc(accountStateWords(row))}${row.identity?.tier ? ` · ${esc(row.identity.tier)}` : ""}${row.identity?.accountStatus && row.identity.accountStatus !== "active" ? ` · ${esc(row.identity.accountStatus)}` : ""}</small>${row.lastError ? `<small class="account-note" role="status">${esc(row.lastError.message)}</small>` : ""}</div><div class="account-row-actions"><button class="ghost-btn" onclick="recheckAccountConnection('${attr(row.connectionId)}')">Recheck</button><button class="ghost-btn" onclick="disconnectAccount('${attr(row.connectionId)}')">Disconnect</button></div></article>`;
    /* The service is named from its own label rather than written in, so this row
       is still correct the day a second provider is registered. Today that renders
       exactly "Connect Civitai". */
    const accountOfferRow = (provider) => {
      const name = esc(provider.label || provider.providerId);
      return `<article class="account-row" data-account-status="disconnected"><div><b>${name}</b><span class="account-identity">Not connected</span><small>${provider.oauthConfigured ? `Sign in with your ${name} account, or use an API key instead.` : `Add the ${name} application ID below before signing in, or use an API key.`}</small></div><div class="account-row-actions">${onLocalMachine ? `${provider.supportsOAuth && provider.oauthConfigured ? `<button class="add-btn" onclick="startAccountConnection('${attr(provider.providerId)}')">Connect ${name}</button>` : ""}${provider.supportsApiKey ? `<button class="ghost-btn" onclick="openAccountApiKeyPrompt('${attr(provider.providerId)}')">Use API key</button>` : ""}` : `<small class="account-note" role="status">${name} account connection must be completed on the computer running CineBraid.</small>`}</div></article>`;
    };
    const accountsPanel = `<section class="settings-block account-settings"><div class="settings-title-row"><div><h3>Accounts</h3><p class="hint">Connect the services you already have an account with. The connection is kept on this CineBraid server and is never sent to the browser. Connecting an account generates nothing and spends nothing.</p></div></div><div class="account-list">${accountProviders.map((provider) => {
      const connected = accountRows.filter((row) => row.providerId === provider.providerId);
      return connected.length
        ? connected.map(accountConnectedRow).join("") + (onLocalMachine ? accountOfferRow(provider) : "")
        : accountOfferRow(provider);
    }).join("") || `<p class="hint">No account services are available in this build.</p>`}</div><div class="two-col">
      ${field("Civitai application ID", `<input id="cfg-civitai-client-id" value="${attr(c.accountProviders?.civitai?.clientId || "")}" placeholder="from your Civitai account's application list"><span class="hint">Not a secret. It is how Civitai recognises CineBraid when you sign in.</span>`)}
    </div><div class="settings-actions"><button class="add-btn" onclick="saveConfig('accounts')">Save account settings</button><span id="account-note" class="hint"></span>${panelState("manual", "Save records the application ID; connecting an account is the button above.")}</div></section>`;
    const recoveryPanel = `<section class="settings-block project-recovery"><div class="settings-title-row"><div><h3>Recovery & advanced</h3><p class="hint">Rotating backups, diagnostics and support records.</p></div><button class="ghost-btn" onclick="createManualProjectBackup()">Create backup now</button></div><div class="settings-health-grid"><article><span>Server</span><b>${health.ok === false ? "Needs attention" : "Running"}</b><small>${esc(health.message || health.status || "Local CineBraid service")}</small></article><article><span>Project folder</span><b>${esc(activeProjectSlug() || "—")}</b><small>The folder name this project is stored under. Use Reports for integrity checks and the project log.</small></article></div><div id="project-backup-note" class="hint"></div>${backupData.error ? `<p class="hint backup-list-error" role="alert">${esc(backupData.error)}</p>` : (backupData.backups || []).length ? `<div class="project-backup-list">${backupData.backups.map((item) => `<article><div><b title="${attr(item.name)}">${esc(item.name)}</b><small>${esc(new Date(item.modifiedAt).toLocaleString())} · ${Math.max(1,Math.round(Number(item.size || 0) / 1024))} KB</small></div><button class="ghost-btn backup-restore-btn" onclick="restoreProjectBackup('${attr(item.name)}')">Restore</button></article>`).join("")}</div>` : `<p class="hint">No rotating backups yet. A backup is created before each validated save.</p>`}<div class="settings-save-line"><span class="settings-save-state" data-state="none" role="status">Nothing on this panel is a setting.</span><small class="settings-save-model">Every control here acts as soon as you use it, so there is nothing to save.</small></div><div class="settings-actions"><a class="ghost-btn" href="#/reports">Open project log & reports</a><button class="ghost-btn" onclick="downloadJSON()">Download JSON backup</button></div></section>`;
    const body = { appearance: appearancePanel, files: filesPanel, access: accessPanel, naming: namingPanel, project: projectPanel, assistant: assistantPanel, generation: generationPanel, accounts: accountsPanel, recovery: recoveryPanel }[selected] || appearancePanel;
    setTimeout(() => { if (typeof initSettingsPanel === "function") initSettingsPanel(); }, 0);
    return `<div class="view-head"><div><div class="eyebrow">Settings</div><span class="view-title">Settings</span><div class="view-sub">Appearance, where files are kept, how they are named, and the optional services CineBraid may use.</div></div></div>${tabbar}<div class="settings-selected-tab" data-settings-tab="${attr(selected)}">${body}</div>`;
  },
};

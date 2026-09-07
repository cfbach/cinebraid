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
      `${field("Canon description", ta(l, "description", "locations", l.id))}${field("Notes", notesField(l, "notes", "locations", l.id))}${field("Blocking label (optional)", inp(l, "blockingNote", "locations", l.id, "e.g. narrow industrial galley interior"))}`,
    );
  },
  prop(id) {
    return entityPage("props", id, (p) =>
      `${field("Canon description", ta(p, "description", "props", p.id))}${field("Notes", notesField(p, "notes", "props", p.id))}${field("Blocking label (optional)", inp(p, "blockingNote", "props", p.id, "e.g. a small radio labelled PROP-RADIO"))}`,
    );
  },
  vehicle(id) {
    return entityPage("vehicles", id, (v) =>
      `${field("Canon description", ta(v, "description", "vehicles", v.id))}${field("Notes", notesField(v, "notes", "vehicles", v.id))}${field("Blocking label (optional)", inp(v, "blockingNote", "vehicles", v.id, "e.g. a parked utility truck labelled VEH-TRUCK"))}`,
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
      ["integrations", "Integrations", "Generation tools running on this machine"],
      ["accounts", "Accounts", "Connect the services you have an account with"],
      ["recovery", "Recovery & advanced", "Backups and diagnostics"],
    ];
    const selected = boundedFocusedTask("settings-task", "settings", tabs.map((row) => row[0]), "appearance");
    const tabButton = ([id, label, detail]) => `<button type="button" class="${selected === id ? "selected" : ""}" onclick="selectBoundedTask('settings-task','settings','${id}')"><b>${label}</b><small>${detail}</small></button>`;
    /* Backups, server status and diagnostics are not AI-assisted services, so they no
       longer sit under a heading that says they are. */
    const tabGroup = (heading, rows) => `<section><span>${heading}</span><div class="settings-tabs">${rows.map(tabButton).join("")}</div></section>`;
    /* The slices are POSITIONAL, so a tab added anywhere before the end moves every
       later boundary. Integrations sits with the other optional services, which is why
       that group is now 5..9 rather than 5..8. */
    const tabbar = `<nav class="settings-nav-shell" aria-label="Settings sections">${tabGroup("WORKSPACE", tabs.slice(0, 5))}${tabGroup("OPTIONAL ASSISTED SERVICES", tabs.slice(5, 9))}${tabGroup("BACKUPS & DIAGNOSTICS", tabs.slice(9))}</nav>`;
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
    /* U1 - A PROVIDER IS NAMED FOR THE SERVER IT ACTUALLY TALKS TO.
     *
     * "Local AI" and "Custom server" described where a server sits and how much
     * CineBraid knows about it. Neither says which WIRE PROTOCOL it speaks, and
     * that is the only thing the choice decides: `ollama` posts Ollama's own
     * /api/chat with Ollama's request shape (llm.js callOllamaText), `custom`
     * posts OpenAI /v1/chat/completions. A filmmaker running vLLM on this
     * machine reads "Local AI", picks it, and gets a 404 from an endpoint their
     * server was never going to serve - which is the detour dogfood hit.
     *
     * The ids are unchanged, so nothing stored has to move. Only the words that
     * were wrong are corrected, and each carries the servers it covers. */
    /* A1-A5 — WHAT BRAIDY USES, WHETHER IT IS CONNECTED, AND WHAT IT CAN SEE.
     *
     * The panel that shipped in the first pass told the truth about provider
     * names but still opened on five provider tiles and a column of endpoint,
     * key, model and sampling fields — configuration first, status second. A
     * filmmaker had to read a form to learn whether Braidy was working.
     *
     * Three capability cards now lead: Braidy, Vision, Continuity analysis. Each
     * states what it resolves to and whether it is on, and each owns the
     * disclosure that configures it. Provider choice and every technical field
     * moved INSIDE those disclosures; nothing was deleted, renamed, re-keyed or
     * re-routed, and `assistantConfigPatch()` sees the identical document —
     * every input it reads by id is still rendered, because a closed <details>
     * is still in the DOM. Saving from this screen produces the same PUT body
     * it produced before this change. */
    const ASSISTANT_PROVIDERS = [
      ["ollama", "Ollama", "Ollama's own API on this machine"],
      ["anthropic", "Claude API", "Anthropic, over the internet"],
      ["openai", "OpenAI API", "OpenAI, over the internet"],
      ["custom", "OpenAI-compatible server", "vLLM, LM Studio, llama.cpp, or any /v1 server"],
    ];
    /* A2 — "No AI" is not a fifth runtime, it is Braidy switched off, so it is
       not a peer tile. The id is untouched and `setAssistantProvider('none')` is
       still exactly what turns it off. */
    const providerLabel = (id) => id === "none"
      ? "Off"
      : (ASSISTANT_PROVIDERS.find((row) => row[0] === id) || [])[1] || id;
    /* The model the CHOSEN provider would use for text, read from that
       provider's own stored field rather than from a status request, so the
       line is true before anything is contacted. */
    const providerTextModel = { ollama: c.ollamaModel, anthropic: c.anthropicModel || "claude-sonnet-4-6", openai: c.openaiModel || "gpt-5.2", custom: c.customModel }[provider] || "";
    /* A1 — THE ADDRESS, WHEN THERE IS ONE WORTH SHOWING. Host and port identify a
       server a filmmaker started themselves; a hosted API is identified by its
       name and adding "api.openai.com" under it would be noise, not identity. */
    const endpointHost = (url) => {
      const raw = String(url || "").trim();
      if (!raw) return "";
      const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(raw);
      return match ? match[1] : raw.replace(/[/?#].*$/, "");
    };
    const braidyEndpoint = provider === "ollama"
      ? endpointHost(c.ollamaUrl || "http://localhost:11434")
      : provider === "custom" ? endpointHost(c.customBaseUrl) : "";
    /* A1 — CONNECTED, OR NOT, OR NOT ASKED YET, AND THE THREE ARE DIFFERENT.
     *
     * This READS the readiness the workspace already holds. `AGENT_STATUS` is
     * app.js's lexical binding, refreshed on load and after every save; nothing
     * here starts a request, and a build that has not answered yet reports
     * "Checking" rather than borrowing "not reachable" from a question nobody
     * has asked. The `typeof` guard is braidy-rail.js's, for the same reason:
     * the binding is simply absent outside the shell. */
    const agentCapabilities = typeof AGENT_STATUS === "undefined" || !AGENT_STATUS
      ? null : (AGENT_STATUS.capabilities || null);
    const textReady = agentCapabilities ? !!agentCapabilities.text?.ready : null;
    const braidyState = provider === "none" ? "off"
      : !providerTextModel ? "incomplete"
      : textReady === null ? "checking"
      : textReady ? "on" : "unreachable";
    const braidyStatus = { off: "Off", incomplete: "Needs a model", checking: "Checking…", on: "Connected", unreachable: "Not reachable" }[braidyState];
    const braidyDetail = braidyState === "off"
      ? "Prompt building stays rules-based and every manual workflow still runs."
      : braidyState === "incomplete"
        ? `${providerLabel(provider)} is selected but no text model is named yet.`
        : braidyState === "unreachable"
          ? String(agentCapabilities?.text?.message || "").trim() || `CineBraid could not reach ${providerLabel(provider)}.`
          : braidyState === "checking" ? "Asking the server whether this provider answers." : "";
    /* WHAT VISION IS, RESOLVED THE WAY THE SERVER RESOLVES IT.
       "Same as the text assistant" is not an answer, it is a pointer; a panel
       that prints the pointer cannot say whether a model exists. This follows it
       once and then asks the resolved provider for its own vision model, so
       "configured" means a model was actually named. */
    const visionChoice = c.assistant?.visionProvider || "same";
    const visionProvider = visionChoice === "same" ? provider : visionChoice;
    const visionModel = { ollama: c.ollamaVisionModel, anthropic: c.anthropicModel || "claude-sonnet-4-6", openai: c.openaiVisionModel || c.openaiModel, custom: c.customVisionModel }[visionProvider] || "";
    const visionOff = visionProvider === "none" || visionProvider === "never";
    const visionConfigured = !visionOff && !!visionModel;
    /* A1 — A BLANK MODEL IS NOT AN ACTIVE PROVIDER. The status line reads Off in
       both the disabled and the nothing-named case, because in both cases no
       image is read; which of the two it is belongs in the detail line under it,
       not in the word a filmmaker scans for. */
    const visionStatus = visionConfigured ? "On" : "Off";
    /* WHERE THE MISSING VISION MODEL WOULD BE TYPED. This panel only ever holds
       the SELECTED ASSISTANT's model fields, so when vision resolves to a
       different provider there is no box on this screen that feeds it. */
    const visionFieldIsHere = visionProvider === provider;
    const visionDetail = visionOff
      ? "No image is sent for reading."
      : visionConfigured
        ? `${providerLabel(visionProvider)} · ${visionModel}`
        : visionFieldIsHere
          ? `${providerLabel(visionProvider)} is selected but no vision model is named, so image reading cannot run.`
          : `${providerLabel(visionProvider)} has no vision model saved. Its fields appear when ${providerLabel(visionProvider)} is Braidy's provider; until then image reading cannot run.`;

    /* Continuity observation resolves separately from general vision because it
       is the one consumer that sends exactly one image per request, against a
       frozen schema. Two fields only: where it goes and which model answers.
       Everything else about that request is the qualified contract and is not a
       preference. */
    const continuityConfig = c.continuity || {};
    const continuityInherited = continuityConfig.visionProvider === "openai" ? (c.openaiBaseUrl || "") : continuityConfig.visionProvider === "custom" ? (c.customBaseUrl || "") : "";
    const continuityOn = !!continuityConfig.visionProvider;
    const continuityDetail = continuityOn
      ? `${continuityConfig.visionProvider === "openai" ? "OpenAI API" : "OpenAI-compatible server"} · ${continuityConfig.visionModel || "the provider's vision model"}`
      : "Frame-by-frame reference checks are not configured.";

    /* A2/A3/A4 — ONE DISCLOSURE SHAPE, REMEMBERED.
       `saveConfig` re-renders the panel, so a Configure that forgot it was open
       would slam shut on every save. This is the same remembered-section
       mechanism the reference workspace folds already use. */
    const sectionOpen = (key, fallback) => (typeof workspaceSectionOpen === "function" ? workspaceSectionOpen(key, fallback) : fallback);
    const disclosure = (cls, key, label, note, inner, fallbackOpen = false) => `<details class="${attr(cls)}" data-ui-state-key="${attr(key)}" ${sectionOpen(key, fallbackOpen) ? "open" : ""} ontoggle="rememberWorkspaceSection('${attr(key)}',this.open)"><summary><b>${esc(label)}</b>${note ? `<small>${esc(note)}</small>` : ""}</summary><div class="capability-configure-body">${inner}</div></details>`;

    /* A3 — THE MINIMUM CONNECTION, AND THE TUNING BELOW IT.
       Every field here is the same input, with the same id and the same stored
       value, that the previous panel rendered in one flat column. Only which
       disclosure it sits in changed, so a field moving under Advanced is saved
       exactly as it was and nothing new is sent. */
    const braidyConnectionFields = provider === "ollama"
      ? `${field("Ollama endpoint", `<input id="cfg-ollama" value="${attr(c.ollamaUrl || "http://localhost:11434")}"><span class="hint">Ollama's own address. CineBraid posts <code>/api/chat</code> here — an OpenAI-compatible server belongs under OpenAI-compatible server instead.</span>`)}${field("Ollama text model", `<input id="cfg-omodel" value="${attr(c.ollamaModel || "")}" placeholder="the name shown by ollama list">`)}`
      : provider === "anthropic"
        ? `${field("Claude API key", `<input id="cfg-key" value="${attr(c.anthropicKey || "")}">`)}${field("Claude model", `<input id="cfg-model" value="${attr(c.anthropicModel || "claude-sonnet-4-6")}">`)}`
        : provider === "openai"
          ? `${field("OpenAI API key", `<input id="cfg-openai-key" value="${attr(c.openaiKey || "")}">`)}${field("OpenAI model", `<input id="cfg-openai-model" value="${attr(c.openaiModel || "gpt-5.2")}">`)}`
          : provider === "custom"
            ? `${field("Server base URL", `<input id="cfg-custom-url" value="${attr(c.customBaseUrl || "http://127.0.0.1:8000/v1")}"><span class="hint">The OpenAI-compatible base URL, including <code>/v1</code>.</span>`)}${field("API key", `<input id="cfg-custom-key" value="${attr(c.customKey || "")}" placeholder="blank if this server needs none">`)}${field("Text model", `<input id="cfg-custom-model" value="${attr(c.customModel || "")}">`)}`
            : "";
    const braidyAdvancedFields = provider === "custom"
      ? `${field("Sampling temperature", `<input id="cfg-custom-temperature" type="number" min="0" max="2" step="0.1" value="${attr(c.customTemperature === "" || c.customTemperature === undefined ? "" : Number(c.customTemperature))}" placeholder="server default"><span class="hint">Leave blank to send nothing. Low values such as 0.2 keep structured answers repeatable.</span>`)}${field("Top-K sampling", `<input id="cfg-custom-top-k" type="number" min="1" max="1000" step="1" value="${attr(c.customTopK === "" || c.customTopK === undefined ? "" : Number(c.customTopK))}" placeholder="server default"><span class="hint">Leave blank unless your server accepts top_k. Not every OpenAI-compatible server does.</span>`)}${field("Model thinking", `<select id="cfg-custom-thinking"><option value="auto" ${(c.customThinking || "auto") === "auto" ? "selected" : ""}>Server default</option><option value="disabled" ${c.customThinking === "disabled" ? "selected" : ""}>Ask the server to skip thinking</option></select><span class="hint">Reasoning servers can spend the whole token budget thinking and return an empty answer. Only choose the second option if your server understands it.</span>`)}`
      : "";
    const braidyProviderChoice = `<div class="policy-options assistant-options" role="radiogroup" aria-label="Braidy's provider">${ASSISTANT_PROVIDERS.map(([v,l,note]) => `<button class="policy-option ${provider === v ? "on" : ""}" role="radio" aria-checked="${provider === v ? "true" : "false"}" onclick="setAssistantProvider('${v}')"><b>${esc(l)}</b><span>${esc(note)}</span></button>`).join("")}</div>`;
    const braidyConfigure = `${provider === "none" ? `<p class="hint capability-off-hint">Braidy is off. Choose a provider to turn it on.</p>` : ""}${braidyProviderChoice}${braidyConnectionFields ? `<div class="two-col">${braidyConnectionFields}</div>` : ""}${braidyAdvancedFields ? disclosure("capability-advanced", "assistant-advanced:braidy", "Advanced", "Tuning this server accepts. Blank means CineBraid sends nothing.", `<div class="two-col">${braidyAdvancedFields}</div>`) : ""}${provider === "none" ? "" : `<div class="capability-off-switch"><button class="ghost-btn" onclick="setAssistantProvider('none')">Turn Braidy off</button><small>Prompt building stays rules-based and every manual workflow still runs.</small></div>`}`;

    /* A4 — VISION CONFIGURES ITSELF, and the model box it owns is the one this
       panel can actually save. `assistantConfigPatch()` reads a provider's
       vision model only inside that provider's own block, so rendering some
       other provider's box here would collect a value the save would drop. The
       resolved provider is named in the status line above instead. */
    const visionModelField = provider === "ollama"
      ? field("Ollama vision model", `<input id="cfg-vmodel" value="${attr(c.ollamaVisionModel || "")}">`)
      : provider === "openai"
        ? field("OpenAI vision model", `<input id="cfg-openai-vision" value="${attr(c.openaiVisionModel || c.openaiModel || "gpt-5.2")}">`)
        : provider === "custom"
          ? field("Vision model", `<input id="cfg-custom-vision" value="${attr(c.customVisionModel || "")}"><span class="hint">Served by the same base URL as Braidy. Leave blank if this server answers text only.</span>`)
          : "";
    const visionConfigure = `<div class="two-col">${field("Vision assistant", `<select id="assistant-vision-provider"><option value="same" ${visionChoice === "same" ? "selected" : ""}>Same as Braidy${provider === "none" ? "" : ` (${esc(providerLabel(provider))})`}</option><option value="ollama" ${visionChoice === "ollama" ? "selected" : ""}>Ollama vision</option><option value="anthropic" ${visionChoice === "anthropic" ? "selected" : ""}>Claude vision</option><option value="openai" ${visionChoice === "openai" ? "selected" : ""}>OpenAI vision</option><option value="custom" ${visionChoice === "custom" ? "selected" : ""}>OpenAI-compatible vision</option><option value="none" ${visionChoice === "none" ? "selected" : ""}>Disabled</option></select>`)}${visionModelField}</div>${visionFieldIsHere || visionOff ? "" : `<p class="hint capability-off-hint">${esc(visionDetail)}</p>`}`;

    const continuityConfigure = `<p class="hint">Checks declared references frame by frame. Configured on its own because it sends exactly one image per request — Vision's settings do not apply to it, and it does not need Braidy to be an OpenAI-compatible server.</p><div class="two-col">${field("Continuity provider", `<select id="cfg-continuity-provider"><option value="" ${continuityConfig.visionProvider ? "" : "selected"}>Not configured — continuity checks stay off</option><option value="custom" ${continuityConfig.visionProvider === "custom" ? "selected" : ""}>OpenAI-compatible server</option><option value="openai" ${continuityConfig.visionProvider === "openai" ? "selected" : ""}>OpenAI API</option></select>`)}${field("Continuity endpoint", `<input id="cfg-continuity-base" value="${attr(continuityConfig.baseUrl || "")}" placeholder="${attr(continuityInherited || "http://127.0.0.1:8000/v1")}"><span class="hint">The OpenAI-compatible base URL, including <code>/v1</code>.${continuityInherited ? ` Leave blank to use ${esc(continuityInherited)}.` : " Leave blank to use the chosen provider's own address."}</span>`)}${field("Continuity model", `<input id="cfg-continuity-model" value="${attr(continuityConfig.visionModel || "")}" placeholder="the model this server serves"><span class="hint">Leave blank to use the provider's configured vision model.</span>`)}</div>`;

    /* A5 — TEST BELONGS TO BRAIDY. It sits inside Braidy's own card, under
       Braidy's own identity line, so what it checks cannot be mistaken for
       Vision or Continuity. The action, the endpoint and the note element are
       the ones that already shipped. */
    /* Test sits on the status row, beside the word it re-checks, so which
       capability it belongs to is a matter of position rather than of reading a
       label — and the three cards fit one screen instead of two. */
    const braidyCard = `<article class="capability-card" data-capability="braidy" data-state="${attr(braidyState)}"><header><span class="capability-name">Braidy</span><span class="capability-status-row"><b class="capability-status">${esc(braidyStatus)}</b><button class="ghost-btn capability-test" ${provider === "none" ? "disabled" : ""} onclick="testAssistantConnection()" aria-label="${attr(provider === "none" ? "Test Braidy" : `Test Braidy's connection to ${providerLabel(provider)}`)}">Test</button></span></header><div class="capability-identity">${provider === "none" ? `<b>No provider selected</b>` : `<b>${esc(providerTextModel || "No model named yet")}</b><small>${esc(providerLabel(provider))}</small>${braidyEndpoint ? `<code>${esc(braidyEndpoint)}</code>` : ""}`}</div>${braidyDetail ? `<p class="capability-detail">${esc(braidyDetail)}</p>` : ""}<p id="assistant-test-note" class="capability-detail capability-test-note" role="status"></p>${disclosure("capability-configure", "assistant-configure:braidy", "Configure", "Provider, connection and tuning", braidyConfigure)}</article>`;
    const visionCard = `<article class="capability-card" data-capability="vision" data-state="${attr(visionConfigured ? "on" : "off")}"><header><span class="capability-name">Vision</span><b class="capability-status">${esc(visionStatus)}</b></header><p class="capability-detail">${esc(visionDetail)}</p>${disclosure("capability-configure", "assistant-configure:vision", "Configure", "Which provider reads images, and with which model", visionConfigure)}</article>`;
    const continuityCard = `<article class="capability-card" data-capability="continuity" data-state="${attr(continuityOn ? "on" : "off")}"><header><span class="capability-name">Continuity analysis</span><b class="capability-status">${esc(continuityOn ? "On" : "Off")}</b></header><p class="capability-detail">${esc(continuityDetail)}</p>${disclosure("capability-configure", "assistant-configure:continuity", "Configure", "Its own endpoint and model", continuityConfigure)}</article>`;

    const assistantPanel = `<section class="settings-block assistant-settings"><div class="settings-title-row"><div><h3>Assistant</h3><p class="hint">What Braidy runs on, what it can see, and what checks continuity. Each capability states where it stands; the settings behind it open one step deeper.</p></div></div><div class="capability-cards">${braidyCard}${visionCard}${continuityCard}</div><div class="settings-actions"><button class="add-btn" onclick="saveConfig('assistant')">Save assistant settings</button>${panelState("manual", "Choosing a provider takes effect at once; the fields inside Configure are saved here.")}</div></section>`;
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
    </div>${(() => {
      /* CIVITAI SITS ON THE GENERATION PANEL, BESIDE FAL, AND NOT ON INTEGRATIONS.
       *
       * Integrations is "Generation tools running on this machine" and states in words
       * that "Nothing on this panel can spend money". Civitai spends Buzz, so putting it
       * there would make that sentence false — and moving it would be a settings-tab
       * change this slice has no reason to make. Generation is already the panel that
       * configures a hosted provider that bills, which is exactly what this is.
       *
       * THREE FIELDS AND NO CREDENTIAL. The account is referenced by connection, and the
       * connection lives in Accounts with its tokens in the config secret registry. There
       * is no address field either: Civitai's endpoints are constants inside the adapter,
       * so there is nothing here to point somewhere else. */
      const civ = c.generation?.civitai || {};
      return `<section class="settings-subblock civitai-settings" data-integration="civitai"><div class="settings-title-row"><div><h4>Civitai</h4><p class="hint">Generate a frame on Civitai, paid from your own Civitai account in Buzz. CineBraid asks Civitai what each request costs and shows you that figure before anything is submitted — nothing here spends on its own.</p></div></div><label class="checkline"><input id="cfg-civitai-enabled" type="checkbox" ${civ.enabled ? "checked" : ""}> Generate with Civitai</label><div class="two-col">
      ${field("Civitai account that pays", `<select id="cfg-civitai-connection" data-configured="${attr(String(civ.connectionId || ""))}" onchange="civitaiConnectionChosen(this)">${typeof civitaiConnectionOptions === "function" ? civitaiConnectionOptions(String(civ.connectionId || "")) : ""}</select><small>Connect the account in Settings → Accounts first, and allow generation on it there.</small>`)}
      ${field("Model (Civitai AIR)", `<input id="cfg-civitai-resource" value="${attr(String(civ.resourceAir || ""))}" placeholder="urn:air:sdxl:checkpoint:civitai:101055@128078"><small>Civitai's own identifier for a model version. Open the model on Civitai and copy its AIR. CineBraid generates with SDXL checkpoints in this version.</small>`)}
    </div><div class="settings-actions"><button class="ghost-btn" onclick="checkCivitaiResource()">Check model</button><span id="civitai-resource-note" class="settings-state-chip" data-tone="${civ.enabled ? "attention" : "off"}">${civ.enabled ? "Not checked yet — press Check model" : "Civitai generation is off"}</span></div></section>`;
    })()}<div class="settings-actions"><button class="add-btn" onclick="saveConfig('generation')">Save generation settings</button><span id="fal-test-note" class="settings-state-chip" data-tone="${fal.enabled ? (fal.apiKey || fal.keySource === "environment" ? "ready" : "attention") : "off"}">${fal.enabled ? (fal.apiKey || fal.keySource === "environment" ? "FAL generation is set up" : "FAL generation is on, but needs a key") : "FAL generation is off"}</span>${panelState("manual", "Save records these defaults; nothing is generated and nothing is charged.")}</div><p class="hint fal-security-note">Paid generation is only submitted after confirmation.</p></section>`;
    /* Integrations — generation tools running on this machine.
     *
     * Separate from Generation, which configures a HOSTED provider that bills. Nothing
     * on this panel can spend money, and the panel says so in words rather than leaving
     * the reader to infer it from an absent price field.
     *
     * The workflow folder is a typed path rather than a folder picker, and that is a
     * recorded choice: CineBraid ships no directory chooser, and local-file-affordance.js
     * — the module that reveals a known file — is built on the rule that the browser
     * never names a filesystem path. Extending it to accept one would break the
     * guarantee it exists to hold, so a validated field is used and the folder is
     * checked when it is read. Project root and Media root above are typed the same way
     * for the same reason. */
    const comfy = c.generation?.comfy || {};
    const integrationsPanel = `<section class="settings-block comfy-settings" data-integration="comfyui"><div class="settings-title-row"><div><h3>Local ComfyUI</h3><p class="hint">Run your own ComfyUI workflows from a shot. CineBraid connects to a ComfyUI on this machine, sends the shot's prompt and reference images into a workflow you have mapped, and brings the result back as a candidate to review. Nothing here contacts a paid service.</p></div><button class="ghost-btn" onclick="testComfyConnection()">Test connection</button></div><label class="checkline"><input id="cfg-comfy-enabled" type="checkbox" ${comfy.enabled ? "checked" : ""}> Generate with a local ComfyUI</label><div class="two-col">
      ${field("ComfyUI server address", `<input id="cfg-comfy-base-url" value="${attr(comfy.baseUrl || "http://127.0.0.1:8188")}" placeholder="http://127.0.0.1:8188"><small>CineBraid connects only to a ComfyUI on this machine. An address on your network or on the internet is refused, and says so.</small>`)}
      ${field("Workflow folder", `<input id="cfg-comfy-workflow-folder" value="${attr(comfy.workflowFolder || "")}" placeholder="D:\\ComfyUI\\user\\default\\workflows"><small>The full path to the folder holding your workflow files. CineBraid reads this folder and never writes to it.</small>`)}
    </div><div class="settings-actions"><button class="add-btn" onclick="saveConfig('integrations')">Save ComfyUI settings</button><span id="comfy-test-note" class="settings-state-chip" data-tone="${comfy.enabled ? "attention" : "off"}">${comfy.enabled ? "Not checked yet — press Test connection" : "Local ComfyUI is off"}</span>${panelState("manual", "Save records the address and folder; nothing is generated and nothing is charged.")}</div>
    <div class="settings-subheading"><span>Workflows</span><small>A workflow becomes available to a shot once you have told CineBraid which of its nodes carry the prompt and the images.</small></div>
    <div id="comfy-workflow-list" class="comfy-workflow-list" data-state="idle"><p class="hint">Save a workflow folder, then press Test connection or reload this panel to list what is in it.</p></div>
    <p class="hint comfy-cost-note">Local ComfyUI · no provider charge. A workflow that runs here uses your own machine, so no hosted service is contacted and none can bill for it.</p></section>`;
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
    /* THE SPEND GRANT, ON THE ROW, AND ONLY WHERE IT IS TRUE.
     *
     * Connecting an account is identity only and this panel's own heading promises that
     * connecting "generates nothing and spends nothing". Permission to spend Buzz is
     * therefore a SECOND, separate authorization, asked for here and never folded into
     * Connect — which is what keeps that sentence true rather than nearly true.
     *
     * What appears here is CineBraid's own boolean from /api/generation/civitai/grants,
     * never the provider's scope value: safeConnection deliberately does not project the
     * bitmask, and a bitmask is not something to put in front of a person.
     *
     * THESE ARE EMPTY CONTAINERS, FILLED AFTERWARDS, and that is not a style choice. The
     * answer comes from the server, so drawing it needs an async read — and a read that
     * asked the router to redraw once it arrived turned this panel into a render loop that
     * detached inputs mid-keystroke. paintCivitaiGrants() writes into exactly these nodes
     * and nothing else, which is the same shape refreshComfyWorkflowList() already uses on
     * the Integrations panel. */
    const accountGrantMarkup = (row) => (
      row.providerId === "civitai"
        ? `<small class="account-note" data-civitai-grant-note="${attr(row.connectionId)}"></small>`
        : ""
    );
    const accountGrantAction = (row) => (
      row.providerId === "civitai" && onLocalMachine
        ? `<span class="account-grant-action" data-civitai-grant-action="${attr(row.connectionId)}"></span>`
        : ""
    );
    const accountConnectedRow = (row) => `<article class="account-row" data-account-status="${attr(row.status)}"><div><b>${esc(row.providerLabel || row.providerId)}</b><span class="account-identity">${esc(row.identity?.displayName ? `@${row.identity.displayName}` : "Connected account")}</span><small>${esc(accountStateWords(row))}${row.identity?.tier ? ` · ${esc(row.identity.tier)}` : ""}${row.identity?.accountStatus && row.identity.accountStatus !== "active" ? ` · ${esc(row.identity.accountStatus)}` : ""}</small>${accountGrantMarkup(row)}${row.lastError ? `<small class="account-note" role="status">${esc(row.lastError.message)}</small>` : ""}</div><div class="account-row-actions">${accountGrantAction(row)}<button class="ghost-btn" onclick="recheckAccountConnection('${attr(row.connectionId)}')">Recheck</button><button class="ghost-btn" onclick="disconnectAccount('${attr(row.connectionId)}')">Disconnect</button></div></article>`;
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
    const body = { appearance: appearancePanel, files: filesPanel, access: accessPanel, naming: namingPanel, project: projectPanel, assistant: assistantPanel, generation: generationPanel, integrations: integrationsPanel, accounts: accountsPanel, recovery: recoveryPanel }[selected] || appearancePanel;
    setTimeout(() => { if (typeof initSettingsPanel === "function") initSettingsPanel(); }, 0);
    /* The workflow list is fetched rather than rendered, because it reads a folder on
       disk and a Settings render must not block on one. The panel draws its own empty
       state above and this replaces it when the answer arrives. */
    if (selected === "integrations")
      setTimeout(() => { if (typeof refreshComfyWorkflowList === "function") refreshComfyWorkflowList(); }, 0);
    /* Which Civitai connections may generate is a server answer, so it is fetched rather
       than rendered — the same reason the workflow list above is. Both panels draw their
       own honest empty state first and are redrawn when the answer arrives. */
    if (selected === "accounts" || selected === "generation")
      setTimeout(() => { if (typeof refreshCivitaiGrants === "function") refreshCivitaiGrants(); }, 0);
    return `<div class="view-head"><div><div class="eyebrow">Settings</div><span class="view-title">Settings</span><div class="view-sub">Appearance, where files are kept, how they are named, and the optional services CineBraid may use.</div></div></div>${tabbar}<div class="settings-selected-tab" data-settings-tab="${attr(selected)}">${body}</div>`;
  },
};

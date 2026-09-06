/* Settings consistency and persistence — regression coverage.
 *
 * Settings used four different save models across seven subsections and explained
 * none of them: Appearance said styling "update[s] immediately" while also offering
 * a Save button, Project offered no save control at all, and the two panels that
 * shared one endpoint overwrote each other's settings with placeholder defaults.
 * Two of those were silent data loss:
 *
 *   - saving naming rules blanked every storage path, because the naming panel sent
 *     a full workspace object built from fields it was not showing;
 *   - saving generation settings reset the vision assistant to "Same as main
 *     assistant" for the same reason;
 *   - editing the project title called load(), which re-read the project from disk
 *     and threw the edit away before the queued save ran — while the indicator still
 *     read "Saved";
 *   - and the appearance "preview" wrote this browser's stored theme on every
 *     keystroke, so a preview the user never saved outlived a reload and then
 *     outranked the appearance actually recorded on the server.
 *
 * These checks lock in the repaired model: every editable subsection states how it
 * stores changes, a panel patches only the settings it displays, and a preview stays
 * a preview until it is saved.
 *
 * CI runs headless on Windows with no browser, so behaviour is asserted through the
 * render harness and the layout contract against the declared CSS.
 */
const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const { render, buildFixture } = require("./render-harness");

const ROOT = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(ROOT, "public", "styles.css"), "utf8");
const views = fs.readFileSync(path.join(ROOT, "public", "views.js"), "utf8");
const settingsSource = fs.readFileSync(path.join(ROOT, "public", "settings.js"), "utf8");
const appSource = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");

const TABS = ["appearance", "files", "access", "naming", "project", "assistant", "generation", "integrations", "recovery"];
/* Subsections holding editable settings that are stored only on an explicit action. */
const EXPLICIT = ["appearance", "files", "access", "naming", "assistant", "generation", "integrations"];

/* The desktop column model lives outside any @media block; a narrow-width override
   must never be able to stand in for the rule these checks are about. */
function stripAtRules(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "@") { out += text[i]; continue; }
    const open = text.indexOf("{", i);
    if (open === -1) { out += text.slice(i); break; }
    let depth = 0;
    let j = open;
    for (; j < text.length; j++) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}" && --depth === 0) break;
    }
    i = j;
  }
  return out;
}
const baseCss = stripAtRules(css);

function declaration(selector, property, source = baseCss) {
  /* last declaration wins, matching cascade order at equal specificity */
  const css = source;
  let found = null;
  let from = 0;
  while (true) {
    const at = css.indexOf(selector, from);
    if (at === -1) break;
    from = at + selector.length;
    const before = css[at - 1];
    const after = css[from];
    if (before && !/[\s,}{>+~]/.test(before)) continue;
    if (after && !/[\s,{:>+~[]/.test(after)) continue;
    const open = css.indexOf("{", from);
    const close = css.indexOf("}", open);
    if (open === -1 || close === -1) break;
    const match = css.slice(open + 1, close).match(new RegExp(`(?:^|;)\\s*${property}\\s*:([^;]+)`));
    if (match) found = match[1].trim();
  }
  return found;
}

/* The render harness's document hands back an element for any id that is asked for,
   which is exactly the condition these checks exist to rule out: a save that reads a
   field the open panel is not showing. So the panel that was actually rendered is
   mounted into that document — the controls it declares exist with the values it
   declared, and everything else answers null the way a browser would. */
const CHROME_IDS = new Set([
  "app", "project-title", "project-format", "topbar-project", "topbar-view",
  "save-state", "main", "modal", "toast", "tally",
]);

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? match[1] : null;
}
function selectedOptionValue(html, from) {
  const close = html.indexOf("</select>", from);
  const body = html.slice(from, close === -1 ? undefined : close);
  const selected = body.match(/<option value="([^"]*)"[^>]*\bselected\b/);
  if (selected) return selected[1];
  const first = body.match(/<option value="([^"]*)"/);
  return first ? first[1] : "";
}
function mountPanel(view, tab) {
  const { html, document, map } = view;
  const presentIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const controls = [];
  for (const match of html.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
    const [, tagName, rest] = match;
    const tag = `<${tagName}${rest}>`;
    const id = attribute(tag, "id");
    const type = attribute(tag, "type") || "text";
    const control = {
      id: id || "",
      tagName: tagName.toUpperCase(),
      type: tagName === "select" || tagName === "textarea" ? tagName : type,
      value: tagName === "select"
        ? selectedOptionValue(html, match.index + match[0].length)
        : attribute(tag, "value") || "",
      checked: /\bchecked\b/.test(tag),
      min: attribute(tag, "min") || "",
      max: attribute(tag, "max") || "",
      dataset: {},
      style: { setProperty() {} },
      addEventListener() {},
      setAttribute() {},
    };
    controls.push(control);
    if (id) map.set(id, control);
  }
  const mirrors = [...html.matchAll(/<[^>]*data-mirror-save-state="1"[^>]*>/g)].map(() => {
    const el = { dataset: { state: "saved" }, textContent: "Saved automatically" };
    return el;
  });
  const panel = {
    dataset: { settingsTab: tab },
    querySelectorAll: (selector) => (/input|select|textarea/.test(selector) ? controls : []),
  };
  const realQuery = document.querySelector.bind(document);
  const realGetById = document.getElementById.bind(document);
  document.getElementById = (id) => {
    if (map.has(id)) return map.get(id);
    return CHROME_IDS.has(id) || presentIds.has(id) ? realGetById(id) : null;
  };
  document.querySelector = (selector) => {
    if (selector === ".settings-selected-tab") return panel;
    if (selector.startsWith("#")) return document.getElementById(selector.slice(1));
    return realQuery(selector);
  };
  document.querySelectorAll = (selector) =>
    (selector === "[data-mirror-save-state]" ? mirrors : []);
  return { panel, controls, mirrors };
}

async function settingsView(tab, options = {}) {
  const view = await render("#/settings", options.project || buildFixture(), {
    ...options,
    storage: { "cinebraid-focused:fixture:settings-task:settings": tab, ...(options.storage || {}) },
  });
  view.mounted = mountPanel(view, tab);
  view.context.initSettingsPanel();
  return view;
}

async function main() {
  /* ---- 1. every subsection says how it stores changes ---- */
  const panels = {};
  for (const tab of TABS) {
    const view = await settingsView(tab);
    panels[tab] = view;
    assert(
      view.html.includes(`data-settings-tab="${tab}"`),
      `${tab}: the selected subsection must render`,
    );
    assert(
      /class="settings-save-state"/.test(view.html),
      `${tab}: every subsection must state how it stores changes`,
    );
    assert(
      view.html.includes('role="status"'),
      `${tab}: the save-state line must be announced as a status`,
    );
  }

  /* An explicit-save panel declares its save model so the shared state line can use
     the right words; Project and Recovery never claim a save button they do not have. */
  for (const tab of EXPLICIT) {
    assert(
      /id="settings-panel-state" data-save-model="(manual|apply|preview)"/.test(panels[tab].html),
      `${tab}: an explicitly saved subsection must declare its save model`,
    );
    assert(
      /class="settings-actions"[^>]*>[\s\S]*?class="add-btn"/.test(panels[tab].html),
      `${tab}: an explicitly saved subsection must offer the action that saves it`,
    );
  }
  assert(
    !panels.project.html.includes('id="settings-panel-state"'),
    "project: an autosaving subsection must not pretend to have a save button",
  );
  assert(
    panels.project.html.includes('data-mirror-save-state="1"'),
    "project: the panel must mirror the real project save chain",
  );
  assert(
    /saves? (itself|themselves)/i.test(panels.project.html),
    "project: the panel must say in words that it saves automatically",
  );
  assert(
    /nothing to save/i.test(panels.recovery.html),
    "recovery: a panel with no settings must say so rather than stay silent",
  );

  /* ---- 2. Appearance separates preview from persistence ---- */
  assert(
    /preview only/i.test(panels.appearance.html),
    "appearance: the copy must name the live repaint as a preview",
  );
  assert(
    !/update immediately in this session/i.test(panels.appearance.html),
    "appearance: the copy must not describe an unsaved preview as something in effect",
  );
  assert(
    panels.appearance.html.includes("discardAppearancePreview()"),
    "appearance: an unsaved preview must be discardable",
  );
  assert(
    /data-save-model="preview"/.test(panels.appearance.html),
    "appearance: the save-state line must use the preview wording",
  );

  /* A preview repaints the workspace and writes nothing. */
  {
    const { context, document } = panels.appearance;
    const stored = [];
    const realSetItem = context.localStorage.setItem;
    context.localStorage.setItem = (key, value) => { stored.push(key); return realSetItem(key, value); };
    document.getElementById("cfg-theme-accent").value = "amber";
    context.previewAppearanceSettings();
    assert.strictEqual(
      document.getElementById("app").dataset.acc,
      "amber",
      "appearance: a preview must actually repaint the workspace",
    );
    assert.deepStrictEqual(
      stored,
      [],
      "appearance: a preview must not write anything — a discarded preview cannot become permanent",
    );
    /* Leaving Settings drops it; the saved appearance comes back. */
    context.setAppearancePreview(null);
    assert.notStrictEqual(
      document.getElementById("app").dataset.acc,
      "amber",
      "appearance: dropping the preview must restore the saved appearance",
    );
    context.localStorage.setItem = realSetItem;
  }
  assert(
    /commitWorkspaceAppearance/.test(settingsSource) && !/previewWorkspaceAppearance/.test(settingsSource),
    "appearance: this browser's stored theme may only be written once a save has succeeded",
  );
  assert(
    /if \(view !== "settings" && APPEARANCE_PREVIEW\)/.test(appSource),
    "appearance: leaving Settings must drop an unsaved preview rather than let it stand",
  );

  /* ---- 3. a panel patches only the settings it displays ---- */
  {
    /* Naming shows no storage-path field, so a naming save must not send one. */
    const { context } = panels.naming;
    let sent = null;
    const realFetch = context.fetch;
    context.fetch = async (url, options = {}) => {
      if (url === "/api/workspace/settings") sent = JSON.parse(options.body);
      return realFetch(url, options);
    };
    await context.saveNamingSettings();
    context.fetch = realFetch;
    assert(sent, "naming: saving must reach the workspace endpoint");
    assert(
      !sent.workspace,
      "naming: saving naming rules must not send storage paths it never displayed",
    );
    assert(
      sent.naming && sent.naming.filenameTemplate,
      "naming: saving must send the naming rules it does display",
    );
  }
  {
    const { context } = panels.files;
    let sent = null;
    const realFetch = context.fetch;
    context.fetch = async (url, options = {}) => {
      if (url === "/api/workspace/settings") sent = JSON.parse(options.body);
      return realFetch(url, options);
    };
    await context.saveStorageSettings();
    context.fetch = realFetch;
    assert(sent && sent.workspace, "files: applying must send the storage paths");
    assert(
      !sent.naming,
      "files: applying storage paths must not reset naming rules it never displayed",
    );
  }
  {
    /* Generation and Assistant share one configuration document. */
    const { context } = panels.generation;
    let sent = null;
    const realFetch = context.fetch;
    context.fetch = async (url, options = {}) => {
      if (url === "/api/config" && options.method === "PUT") sent = JSON.parse(options.body);
      return realFetch(url, options);
    };
    await context.saveConfig("generation");
    context.fetch = realFetch;
    assert(sent && sent.generation, "generation: saving must send the generation settings");
    assert(
      !sent.assistant,
      "generation: saving generation settings must not overwrite the vision assistant",
    );
  }
  {
    const { context } = panels.assistant;
    let sent = null;
    const realFetch = context.fetch;
    context.fetch = async (url, options = {}) => {
      if (url === "/api/config" && options.method === "PUT") sent = JSON.parse(options.body);
      return realFetch(url, options);
    };
    await context.saveConfig("assistant");
    context.fetch = realFetch;
    assert(sent && sent.assistant, "assistant: saving must send the assistant settings");
    assert(
      !sent.generation,
      "assistant: saving assistant settings must not overwrite the generation defaults",
    );
  }

  /* ---- 4. a failed save says so and never reports success ---- */
  {
    const view = await settingsView("files", {
      fetch: async (url, options, response) =>
        url === "/api/workspace/settings"
          ? response({ error: "CineBraid cannot write to that folder." }, 400)
          : null,
    });
    await view.context.saveStorageSettings();
    const state = view.document.getElementById("settings-panel-state");
    assert.strictEqual(state.dataset.state, "error", "a rejected save must report an error state");
    assert(
      /cannot write to that folder/i.test(state.textContent),
      "a rejected save must report the reason the server gave",
    );
    assert(
      !/applied\.|saved\./i.test(state.textContent),
      "a rejected save must never claim the change was stored",
    );
  }

  /* ---- 5. zero-change, changed and saved states are distinct ---- */
  {
    const view = await settingsView("naming");
    const state = view.document.getElementById("settings-panel-state");
    assert.strictEqual(state.dataset.state, "clean", "an untouched panel must report no unsaved changes");
    view.document.getElementById("cfg-version-padding").value = "4";
    view.context.refreshSettingsPanelState();
    assert.strictEqual(state.dataset.state, "dirty", "an edited panel must report unsaved changes");
    view.document.getElementById("cfg-version-padding").value = "3";
    view.context.refreshSettingsPanelState();
    assert.strictEqual(state.dataset.state, "clean", "reverting an edit by hand must clear the unsaved state");
    view.document.getElementById("cfg-version-padding").value = "4";
    view.context.refreshSettingsPanelState();
    await view.context.saveNamingSettings();
    assert.strictEqual(state.dataset.state, "saved", "a completed save must report the change as stored");
  }

  /* ---- 6. project details reach the project record ---- */
  assert(
    views.includes("setProjectTitle(this.value)"),
    "project: the title must take the same autosave path as every other project field",
  );
  assert(
    !/P\.meta\.title=this\.value;dirty\(\);load\(\)/.test(views),
    "project: the title must not reload the project over the edit that was just made",
  );
  {
    const { context } = panels.project;
    let saved = null;
    const realFetch = context.fetch;
    context.fetch = async (url, options = {}) => {
      if (/\/api\/projects\/.+\/project$/.test(String(url)) && options.method === "PUT") saved = JSON.parse(options.body);
      return realFetch(url, options);
    };
    context.setProjectTitle("Renamed in settings");
    assert.strictEqual(
      context.document.getElementById("project-title").textContent,
      "Renamed in settings",
      "project: the title on screen must follow the edit",
    );
    /* The autosave is debounced; the point of the check is that the edit is still
       there when it fires, which is exactly what the old load() call destroyed. */
    await new Promise((resolve) => setTimeout(resolve, 900));
    context.fetch = realFetch;
    assert(saved, "project: an edited field must reach the project record on its own");
    assert.strictEqual(
      saved.meta.title,
      "Renamed in settings",
      "project: a title edit must survive long enough to be saved",
    );
    const [mirror] = panels.project.mounted.mirrors;
    context.setSaveState("dirty", "Unsaved changes");
    assert.strictEqual(mirror.dataset.state, "dirty", "project: the panel must show work that is not yet saved");
    context.setSaveState("error", "Save failed");
    assert.strictEqual(mirror.dataset.state, "error", "project: the panel must show a failed save");
    assert(
      /could not save/i.test(mirror.textContent),
      "project: a failed save must be stated in words, not only in colour",
    );
    context.setSaveState("saved", "Saved");
    assert.strictEqual(mirror.dataset.state, "saved", "project: the panel must show a completed save");
  }

  /* ---- 7. save verbs match what the action does ---- */
  assert(
    /Apply storage paths/.test(views) && /creates these folders/.test(views),
    "files: Apply is only justified if the panel explains that it also acts on disk",
  );
  for (const [tab, label] of [["appearance", "Save appearance"], ["access", "Save passcodes"], ["naming", "Save naming rules"], ["assistant", "Save assistant settings"], ["generation", "Save generation settings"]]) {
    assert(panels[tab].html.includes(label), `${tab}: must offer "${label}"`);
  }
  assert(!views.includes("Apply storage settings"), "the old mixed storage verb must be gone");

  /* ---- 8. grouping and units ---- */
  assert(
    /BACKUPS & DIAGNOSTICS/.test(panels.recovery.html),
    "backups and diagnostics are not AI-assisted services and must not be filed as such",
  );
  {
    const services = panels.recovery.html.indexOf("OPTIONAL ASSISTED SERVICES");
    const backups = panels.recovery.html.indexOf("BACKUPS &amp; DIAGNOSTICS") >= 0
      ? panels.recovery.html.indexOf("BACKUPS &amp; DIAGNOSTICS")
      : panels.recovery.html.indexOf("BACKUPS & DIAGNOSTICS");
    const recoveryTab = panels.recovery.html.indexOf("Recovery &amp; advanced") >= 0
      ? panels.recovery.html.indexOf("Recovery &amp; advanced")
      : panels.recovery.html.indexOf("Recovery & advanced");
    assert(services !== -1 && backups > services, "the backups group must follow the assisted-services group");
    assert(recoveryTab > backups, "Recovery must sit inside the backups group");
  }
  /* The LAN passcodes are a setting like any other and belong in a subsection that
     says so. The panel that reads them existed for three phases with nowhere to
     render, which is what tests/lan-passcode-settings.js exists for; the claim here
     is narrower — Access & security is a real Settings subsection, filed with the
     rest of this workspace's own settings rather than among the optional services. */
  {
    const nav = panels.access.html;
    const workspace = nav.indexOf("WORKSPACE");
    const services = nav.indexOf("OPTIONAL ASSISTED SERVICES");
    const access = nav.indexOf("<b>Access & security</b>");
    assert(workspace !== -1 && access > workspace && access < services,
      "Access & security must sit with this workspace's own settings, not among the optional services");
    assert(/id="cfg-epass"[^>]*type="password"/.test(nav) && /id="cfg-vpass"[^>]*type="password"/.test(nav),
      "the passcode subsection must render both write-only controls");
  }
  assert(
    /Prompt versions kept per shot/.test(panels.project.html),
    "the prompt-history limit must name its unit rather than showing a bare number",
  );

  /* ---- 9. the layout contract behind the listed visual defects ---- */
  assert.strictEqual(
    declaration(".settings-preview-card>*", "display"),
    "block",
    "the preview card's three statements must not render as one run-on string",
  );
  assert.strictEqual(
    declaration(".brand-settings input[type=\"range\"]", "appearance"),
    "none",
    "the interface-scale slider must not fall back to the OS control",
  );
  assert(
    /accent-color:\s*var\(--acc\)/.test(css.slice(css.indexOf('.brand-settings input[type="range"]'))),
    "the interface-scale slider must use the CineBraid accent",
  );
  assert.strictEqual(
    declaration(".settings-actions>button,.settings-actions>a", "flex"),
    "0 0 auto",
    "action buttons must be sized by their labels, not stretched across the card",
  );
  assert.strictEqual(
    declaration(".settings-actions>button,.settings-actions>a", "white-space"),
    "nowrap",
    "an action button must not wrap its own label onto two lines",
  );
  assert.strictEqual(
    declaration(".settings-inline-actions>button,.settings-block>.settings-title-row>button,.settings-head-button", "width"),
    "auto",
    "panel-level actions must be sized by their labels; .ghost-btn is full-width by default",
  );
  assert(
    /\.settings-block>\.settings-title-row>div:not\(\.settings-inline-actions\)/.test(baseCss),
    "the panel description must take the flexible track without dragging the action group with it",
  );
  assert.strictEqual(
    declaration(".checkline>input[type=\"checkbox\"]", "flex"),
    "0 0 auto",
    "a checkbox must sit beside its label instead of stretching away from it",
  );
  assert.strictEqual(
    declaration(".project-backup-list article", "grid-template-columns"),
    "minmax(0,1fr) auto",
    "the backup filename must take the space and Restore only what it needs",
  );
  assert.strictEqual(
    declaration(".project-backup-list article b", "white-space"),
    "normal",
    "the filename needed to choose a backup must not be truncated",
  );
  assert(
    /\.policy-options\.assistant-options\{[^}]*margin-bottom/.test(css),
    "the provider tiles must clear the label of the field beneath them",
  );
  assert(
    /\.settings-state-chip/.test(css) && /FAL generation is off/.test(views),
    "a disabled feature must be named, not left as bare text beside a bright button",
  );
  assert(!views.includes(">Disabled</span>"), "the unattributed \"Disabled\" text must be gone");

  /* -------------------------------------------------------------------------
     A BACKGROUND READ MUST NOT REBUILD THE PANEL IT REPORTS INTO.

     Settings schedules refreshCivitaiGrants() every time the Accounts or Generation panel
     is drawn. That function used to end in `route()`, which made the pair a loop: render →
     fetch → route() → render → fetch. Measured against the running build it ran about 26
     times a second, and because every iteration replaces the settings subtree the panel
     was unusable — an input was detached from the document before a keystroke could land,
     focus fell back to <body>, and a click on a tab was released over a node that no
     longer existed.

     This asserts the repaired shape BEHAVIOURALLY rather than by grepping for `route(`:
     the module is executed against a minimal DOM, and what is checked is that a refresh
     paints its own containers, leaves everything else alone, and asks nobody to redraw.
     A future edit that reintroduced the loop under a different name would still fail. */
  {
    const civitaiSettings = fs.readFileSync(path.join(ROOT, "public", "civitai-settings.js"), "utf8");
    const CONNECTION = "conn-0123456789abcdef0123456789abcdef";

    function element(dataset = {}) {
      return { dataset, textContent: "", innerHTML: "", value: "", options: [] };
    }
    const note = element({ civitaiGrantNote: CONNECTION });
    const action = element({ civitaiGrantAction: CONNECTION });
    /* A picker the person has already changed and NOT saved. The configured value is the
       other account; the unsaved choice must outrank it. */
    const picker = element({ configured: "conn-ffffffffffffffffffffffffffffffff" });
    picker.value = CONNECTION;
    picker.options = [{ value: CONNECTION }];

    let routeCalls = 0;
    let elementsCreated = 0;
    const context = {
      console,
      /* If the module ever calls this again, the count is the failure. */
      route: () => { routeCalls++; },
      esc: (value) => String(value ?? ""),
      attr: (value) => String(value ?? ""),
      fetch: async () => ({
        ok: true,
        json: async () => ({ grants: [{ connectionId: CONNECTION, displayName: "fixture", tokenSource: "oauth", generationAuthorized: false }] }),
      }),
      document: {
        querySelectorAll: (selector) => {
          elementsCreated++;
          if (selector === "[data-civitai-grant-note]") return [note];
          if (selector === "[data-civitai-grant-action]") return [action];
          return [];
        },
        getElementById: (id) => (id === "cfg-civitai-connection" ? picker : null),
      },
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(civitaiSettings, context, { filename: "civitai-settings.js" });

    await context.refreshCivitaiGrants();

    assert.strictEqual(routeCalls, 0,
      "a Civitai grants refresh must never ask the router to redraw — that is the render loop that made Settings uneditable");
    assert(elementsCreated > 0, "the refresh must actually have looked for its containers");
    assert(/identity only/i.test(note.textContent),
      "the grant line must be painted into its own container from the server's answer");
    assert(/Allow generation/.test(action.innerHTML),
      "the contextual spend authorization must be offered on a connection that lacks it");
    assert.strictEqual(picker.value, CONNECTION,
      "a repaint must preserve an unsaved account choice rather than resetting it to the configured one");

    /* The other half of the contract: the panel renders EMPTY containers, so nothing on
       screen depends on an async answer having already arrived. */
    assert(/data-civitai-grant-note=/.test(views) && /data-civitai-grant-action=/.test(views),
      "the Accounts row must render containers for the grant rather than requiring the answer at render time");
    assert(!/civitaiGrantFor\(/.test(views),
      "views.js must not read the grants cache while rendering; the painter owns those nodes");
  }

  console.log("settings consistency and persistence assertions passed, including that a Civitai grants refresh paints its own containers and never re-renders Settings");
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});

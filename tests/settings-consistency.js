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

const TABS = ["overview", "connections", "appearance", "files", "access", "naming", "project", "assistant", "generation", "integrations", "accounts", "fal", "assistant-ollama", "assistant-openai", "assistant-anthropic", "assistant-custom", "recovery", "project-recovery"];
const READ_ONLY = ["overview", "connections", "recovery"];
/* Subsections holding editable settings that are stored only on an explicit action. */
const EXPLICIT = ["appearance", "files", "access", "naming", "assistant", "generation", "integrations", "accounts", "fal", "assistant-ollama", "assistant-openai", "assistant-anthropic", "assistant-custom"];

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
      disabled: /\bdisabled\b/.test(tag),
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
    if (READ_ONLY.includes(tab)) {
      const body = view.html.slice(view.html.indexOf('class="settings-selected-tab"'));
      assert(!/id="settings-panel-state"|<input|<textarea|onclick="save/.test(body),
        `${tab}: read-only navigation and diagnostics must not acquire a preference writer`);
      continue;
    }
    assert(
      /class="settings-save-state"/.test(view.html),
      `${tab}: every subsection must state how it stores changes`,
    );
    assert(
      view.html.includes('role="status"'),
      `${tab}: the save-state line must be announced as a status`,
    );
  }


  /* Provider setup and operational defaults have distinct owners, with legacy
     integrations/accounts/naming destinations still reachable by their old IDs. */
  {
    const generation = panels.generation.html;
    for (const id of ["cfg-fal-text-model", "cfg-fal-h3-text-model", "cfg-fal-motion-rate", "cfg-civitai-resource"])
      assert(generation.includes(`id="${id}"`), `generation retains ${id}`);
    assert(generation.includes("Generation defaults") && /provider-specific defaults/.test(generation));
    assert(!generation.includes('id="cfg-fal-key"'), "generation must not render the credential owned by Fal connection setup");
    assert(panels.fal.html.includes('id="cfg-fal-key"'), "Fal connection must retain the credential control");
    assert(generation.includes('href="#/settings/fal"'), "defaults must link to the owning connection");
    const nav = generation.match(/<div class="studio-nav-links">([\s\S]*?)<\/div>/)[1];
    const targets = [...nav.matchAll(/href="#\/settings\/([^"]+)"/g)].map((row) => row[1]);
    assert.deepStrictEqual(targets, ["overview", "appearance", "generation", "assistant", "naming", "access", "setup", "connections", "files", "project", "project-recovery", "recovery"],
      "one Settings index lists every group in order (Studio, Connections, Storage, Project, Recovery & export), separating connection setup from use, with connection details collapsed outside Connections");
    assert(panels.connections.html.includes('href="#/settings/integrations"'));
    assert(panels.connections.html.includes('href="#/settings/accounts"'));
    for (const kind of ["ollama", "openai", "anthropic", "custom"])
      assert(panels.connections.html.includes(`href="#/settings/assistant-${kind}"`), `${kind} has its own connection route`);
    for (const id of ["cfg-ollama", "cfg-key", "cfg-openai-key", "cfg-custom-url"])
      assert(!panels.assistant.html.includes(`id="${id}"`), `assistance selection must not render ${id}'s connection control`);
    assert(panels["assistant-ollama"].html.includes('id="cfg-ollama"'));
    assert(panels["assistant-openai"].html.includes('id="cfg-openai-key"'));
    assert(panels["assistant-anthropic"].html.includes('id="cfg-key"'));
    assert(panels["assistant-custom"].html.includes('id="cfg-custom-url"'));
    for (const [tab, id] of [["files", "cfg-file-strategy"], ["naming", "cfg-export-template"], ["naming", "cfg-collision-behavior"]])
      assert(!panels[tab].html.includes(`id="${id}"`), `${tab}: inert stored option ${id} must not pretend to change behavior`);
    assert(/retained compatibility values/.test(panels.recovery.html), "inert values remain available as read-only compatibility information");
    const env = await settingsView("fal", { fetch: async (url, options, response) => url === "/api/config"
      ? response({ generation: { fal: { keySource: "environment", apiKey: "masked-fixture" } } }) : null });
    assert(/id="cfg-fal-key"[^>]*disabled/.test(env.html), "environment credential cannot be replaced in the form");
    assert(/onclick="saveConfig\('fal-connection'\)"[^>]*disabled/.test(env.html), "environment-managed credential cannot offer an effective save");
    assert(/Managed by the server environment/.test(env.html));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(env.context.falCredentialPatch())), {},
      "an environment-owned key must also be omitted by the writer, not merely disabled visually");
    const direct = await render("#/settings/accounts", buildFixture());
    assert(direct.html.includes('data-settings-tab="accounts"'), "direct legacy detail route must win over default selection");
  }

  /* EV2-7: ONE SETTINGS INDEX. Project and project recovery used to replace the index
     with a second navigation of stacked full-width links, connection details stacked a
     breadcrumb above their own return link, and the project title was repeated as the
     view title. Every destination now shares one grouped index that sits outside and
     before the single mounted panel, and the index itself reads nothing. */
  {
    const ALL = [...TABS, "setup"];
    const CONNECTION_IDS = ["integrations", "accounts", "fal", "assistant-ollama", "assistant-openai", "assistant-anthropic", "assistant-custom"];
    const title = buildFixture().meta.title;
    const GROUP_OF = { connections: "Connections", files: "Storage", project: "Project", "project-recovery": "Recovery &amp; export", recovery: "Recovery &amp; export" };
    for (const id of CONNECTION_IDS) GROUP_OF[id] = "Connections";
    const setupView = await settingsView("setup");
    const views = { ...panels, setup: setupView };
    for (const tab of ALL) {
      const html = views[tab].html;
      const panelAt = html.indexOf('class="settings-selected-tab"');
      const head = html.slice(0, panelAt);
      assert.strictEqual(html.split('class="settings-selected-tab"').length - 1, 1, `${tab}: exactly one Settings panel is mounted`);
      assert.strictEqual(html.split("<nav").length - 1, 1, `${tab}: exactly one Settings index`);
      assert(head.includes('<nav class="studio-nav" aria-label="Settings sections">'), `${tab}: the index renders before, and outside, the panel`);
      assert(!/<(input|textarea|button)\b/.test(head) && head.split("<select").length - 1 === 1, `${tab}: the only control outside the panel is the compact section select`);
      const headings = [...head.matchAll(/<p class="studio-nav-heading"[^>]*>([^<]+)<\/p>/g)].map((m) => m[1]);
      assert.deepStrictEqual(headings, ["Studio", "Connections", "Storage", "Project", "Recovery &amp; export"], `${tab}: group headings keep their order`);
      const select = head.slice(head.indexOf("<select"), head.indexOf("</select>"));
      const options = [...select.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
      assert.deepStrictEqual([...options].sort(), [...ALL].sort(), `${tab}: the compact select lists every destination exactly once`);
      assert.deepStrictEqual([...select.matchAll(/<option value="([^"]+)" selected>/g)].map((m) => m[1]), [tab], `${tab}: the compact select shows the open destination`);
      assert.deepStrictEqual([...head.matchAll(/href="#\/settings\/([^"]+)" aria-current="page"/g)].map((m) => m[1]), [tab], `${tab}: exactly the open destination is current in the index`);
      assert.strictEqual(head.includes('class="studio-nav-details"'), CONNECTION_IDS.includes(tab) || tab === "connections", `${tab}: connection details are listed only while a connection is open`);
      assert(!html.includes("studio-breadcrumb") && !html.includes('aria-label="Project settings"'), `${tab}: no breadcrumb or second navigation stacked on the index`);
      assert.deepStrictEqual([...head.matchAll(/<h1 class="view-title">([^<]*)<\/h1>/g)].map((m) => m[1]), [GROUP_OF[tab] || "Studio"], `${tab}: the one view title names the open group; the project title is never repeated as a heading`);
      assert(head.includes('<div class="eyebrow">Settings</div>') && head.split("view-title").length - 1 === 1, `${tab}: the eyebrow says Settings once, above the group title`);
      const scopeTitles = [...head.matchAll(/<b data-settings-project-title>([^<]*)<\/b>/g)].map((m) => m[1]);
      assert.strictEqual(scopeTitles.length, tab === "project" || tab === "project-recovery" ? 1 : 0, `${tab}: the scope line marks its project title so an in-progress edit can follow it`);
      for (const [, attrs] of head.matchAll(/<a ([^>]*)href="#\/settings\/[^"]+"(?! aria-current)/g))
        assert(/^onclick="studioSettingsIndexIntent\(event,'[^']+'\)" onkeydown="studioSettingsIndexIntent\(event,'[^']+'\)" $/.test(attrs), `${tab}: an index link records only a keyboard intent, never focus on its own`);
      assert(!/STUDIO_SETTINGS_INDEX_FOCUS/.test(head), `${tab}: the index never sets the focus hint unconditionally`);
      const projectScoped = tab === "project" || tab === "project-recovery";
      assert(head.includes(`data-settings-scope="${projectScoped ? "project" : "application"}"`), `${tab}: the head states its scope`);
      assert.strictEqual(head.split(title).length - 1, projectScoped ? 1 : 0, `${tab}: the project is named once for project scope and not at all for application settings`);
    }
    const detailHrefs = (html) => [...html.slice(0, html.indexOf('class="settings-selected-tab"')).matchAll(/<ul class="studio-nav-details"[^>]*>([\s\S]*?)<\/ul>/g)].flatMap((m) => [...m[1].matchAll(/href="#\/settings\/([^"]+)"/g)].map((row) => row[1]));
    assert.deepStrictEqual(detailHrefs(panels.fal.html), CONNECTION_IDS, "connection details list every implemented connection in index order");
    assert(!/Export project|Download JSON backup/.test(panels.project.html), "project preferences hold no copy or export actions");
    const exportPanel = panels["project-recovery"].html;
    assert(/onclick="doExport\(\)">Write saved project as Markdown/.test(exportPanel) && /onclick="downloadJSON\(\)">Download this window's project JSON/.test(exportPanel),
      "project backups & export offers both copies under accurate names");
    assert(/not a restore point/.test(exportPanel) && /id="export-note"[^>]*role="status"/.test(exportPanel), "the JSON download is not presented as a backup, and export status is announced");

    /* The index adds no reads. Every request is recorded in order with its method, so an
       extra read on the shared route shows up as a changed list, not a set that still matches.
       The Settings route itself reads exactly config and accounts; only project recovery adds
       its health and backup reads. Rendering the index and running its hooks read nothing. */
    const reads = async (tab) => {
      const urls = [];
      const view = await settingsView(tab, { fetch: async (url, options = {}) => { urls.push(`${options.method || "GET"} ${url.split("?")[0]}`); return null; } });
      return { urls, view };
    };
    const overviewReads = await reads("overview"), projectReads = await reads("project"), falReads = await reads("fal"), recoveryReads = await reads("project-recovery");
    assert.deepStrictEqual(projectReads.urls, overviewReads.urls, "the project destination reads exactly what the overview reads, in order");
    assert.deepStrictEqual(falReads.urls, overviewReads.urls, "a connection detail reads exactly what the overview reads, in order");
    assert(overviewReads.urls.every((url) => url.startsWith("GET ")), "opening Settings sends no write");
    assert.deepStrictEqual(overviewReads.urls.slice(-2), ["GET /api/config", "GET /api/accounts"], "the Settings route reads exactly config and accounts");
    assert.deepStrictEqual(recoveryReads.urls, [...overviewReads.urls.slice(0, -1), "GET /api/system/health", "GET /api/projects/fixture/backups", "GET /api/accounts"],
      "project recovery adds only its own health and backup reads");
    {
      const { view } = falReads, before = falReads.urls.length;
      const again = view.context.studioSettingsRender({ selected: "assistant-custom", panels: {}, config: {}, health: {}, accountData: {}, panelState: () => "" });
      assert(again.includes('<nav class="studio-nav"') && again.includes('class="studio-nav-details"'), "the index renders on its own");
      vm.runInContext("studioSettingsIndexIntent({type:'keydown',key:'Enter'},'fal');initSettingsPanel()", view.context);
      assert.strictEqual(falReads.urls.length, before, "rendering the index and running its focus and title hooks sends no request");
    }

    /* The scope line follows a project title edit that has not been committed yet, and the
       follow-up neither writes nor reads. The existing autosave owner is untouched. */
    {
      const listeners = {}, requests = [], writes = [];
      const titleInput = { id: "cfg-project-title", type: "text", value: title, dataset: {}, addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); } };
      const scopeTitle = { textContent: title };
      const panel = { dataset: { settingsTab: "project", settingsProject: "fixture" }, querySelectorAll: (selector) => /input/.test(selector) ? [titleInput] : [] };
      const context = {
        document: { activeElement: null, getElementById: (id) => id === "cfg-project-title" ? titleInput : null,
          querySelector: (selector) => selector === ".settings-selected-tab" ? panel : selector === "[data-settings-project-title]" ? scopeTitle : null, querySelectorAll: () => [] },
        fetch: async (url) => { requests.push(url); return {}; }, setProjectTitle: (value) => writes.push(value), dirty: () => writes.push("dirty"),
      };
      context.window = context;
      vm.createContext(context);
      vm.runInContext(settingsSource, context, { filename: "public/settings.js" });
      context.initSettingsPanel();
      titleInput.value = "Retitled while typing";
      listeners.input.forEach((fn) => fn());
      assert.strictEqual(scopeTitle.textContent, "Retitled while typing", "the scope line follows the project title while it is edited");
      titleInput.value = "";
      listeners.change.forEach((fn) => fn());
      assert.strictEqual(scopeTitle.textContent, "Untitled project", "a cleared title reads as an untitled project, as the head renders it");
      assert.deepStrictEqual([requests, writes], [[], []], "following the title sends no request and calls no writer");
    }

    const studioCss = fs.readFileSync(path.join(ROOT, "public", "settings-studio.css"), "utf8").replace(/\r\n/g, "\n");
    assert(studioCss.includes("@media(max-width:900px){\n  .studio-settings-layout .settings-block>.settings-title-row>div:not(.settings-inline-actions){flex-basis:auto}\n}"),
      "the accepted mobile header correction is kept verbatim");
    assert(/\.studio-nav-links a\{[^}]*min-height:44px/.test(studioCss), "index links are 44px targets");
    assert(/\.studio-settings-layout>\.settings-selected-tab\{[^}]*max-width:1040px/.test(studioCss), "the panel keeps a readable measure on wide displays");
    assert(/\.studio-settings-layout \.capability-configure>summary,\.studio-settings-layout \.capability-advanced>summary\{[^}]*min-height:44px/.test(studioCss), "capability disclosures are 44px targets in Settings");
    assert(/\.studio-settings-layout \.capability-configure>summary::after,\.studio-settings-layout \.capability-advanced>summary::after\{font:600 13px\/1\.4 var\(--body\)/.test(studioCss)
      && /\.studio-settings-layout \.capability-configure>summary small,\.studio-settings-layout \.capability-advanced>summary small\{font:400 13px/.test(studioCss), "capability Show/Hide and notes use readable 13px sans");
    assert(/\.studio-settings-layout \.capability-name,\.studio-settings-layout \.settings-subheading span\{font:600 12px/.test(studioCss) && /\.studio-settings-layout \.capability-detail,[^{]*\{font:400 13px/.test(studioCss),
      "capability names, details and settings subheadings are readable sans in Settings");
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
    /nothing to save/i.test(panels["project-recovery"].html),
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

  /* The newly separated connection pages still patch the existing owner with
     exactly the visible fields. Saving setup must not select Braidy's provider. */
  {
    const expected = {
      "assistant-ollama": ["ollamaModel", "ollamaUrl", "ollamaVisionModel"],
      "assistant-openai": ["openaiKey", "openaiModel", "openaiVisionModel"],
      "assistant-anthropic": ["anthropicKey", "anthropicModel", "anthropicVisionModel"],
      "assistant-custom": ["customBaseUrl", "customKey", "customModel", "customVisionModel", "customTemperature", "customTopK", "customThinking"],
    };
    for (const [tab, fields] of Object.entries(expected)) {
      const { context } = panels[tab];
      const patch = context.assistantConfigPatch();
      assert.deepStrictEqual(Object.keys(patch).sort(), fields.sort(), `${tab}: omitted consumers must never be filled from cached CONFIG`);
      assert(!patch.assistant && !patch.continuity && !patch.generation, `${tab}: setup is not selection, continuity or generation`);
    }
    const fal = panels.fal.context.generationConfigPatch();
    assert.deepStrictEqual(Object.keys(fal.generation.fal), ["apiKey"], "credential detail cannot overwrite model defaults or enable generation");
    const defaults = panels.generation.context.generationConfigPatch();
    for (const key of ["apiKey", "maxConcurrent", "requireConfirmation"])
      assert(!Object.hasOwn(defaults.generation.fal, key), `generation save must not carry unrendered ${key}`);
    const selection = panels.assistant.context.assistantConfigPatch();
    assert.deepStrictEqual(Object.keys(selection).sort(), ["assistant", "continuity"], "assistance saves only its selection and continuity controls");
    assert(!Object.hasOwn(selection.assistant, "provider"), "saving image-reading selection cannot replay Braidy's immediate provider selection");
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

  /* ---- 8. project recovery is separate from application connection setup ---- */
  {
    const recovery = panels["project-recovery"].html;
    const recoveryHead = recovery.slice(0, recovery.indexOf('class="settings-selected-tab"'));
    assert(recoveryHead.includes('data-settings-scope="project"'), "project recovery must name its project scope");
    assert.strictEqual(recoveryHead.split(buildFixture().meta.title).length - 1, 1,
      "project recovery names its project exactly once before the panel, not as a repeated heading");
    assert(!recovery.includes('aria-label="Project settings"'), "project recovery must not replace the Settings index with a second project navigation");
    assert(recovery.includes("Project backups & recovery"));
    assert(panels.recovery.html.includes('href="#/settings/project-recovery"'), "application diagnostics link to the named project's recovery owner");
    const access = panels.access.html;
    assert(access.includes('href="#/settings/access" aria-current="page"'), "Access remains a named application destination");
    assert(/id="cfg-epass"[^>]*type="password"/.test(access) && /id="cfg-vpass"[^>]*type="password"/.test(access),
      "the passcode subsection must retain both write-only controls");
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
    const OTHER = "conn-ffffffffffffffffffffffffffffffff";

    /* A picker that behaves like a real <select>: rewriting innerHTML rebuilds its options
       and resets `value` to whichever option carries `selected`, which is exactly the
       mechanism a repaint has to survive. A stub that ignored innerHTML would let a broken
       repaint pass. */
    function makePicker(dataset) {
      const picker = { dataset, value: "", options: [], textContent: "" };
      Object.defineProperty(picker, "innerHTML", {
        get() { return picker._html || ""; },
        set(value) {
          picker._html = value;
          picker.options = [...String(value).matchAll(/value="([^"]*)"/g)].map((match) => ({ value: match[1] }));
          const selected = String(value).match(/value="([^"]*)"[^>]*selected/);
          picker.value = selected ? selected[1] : (picker.options[0] ? picker.options[0].value : "");
        },
      });
      return picker;
    }

    /* One refresh against a fresh context, returning everything the assertions need. */
    async function refreshWith({ picker, grants } = {}) {
      const note = element({ civitaiGrantNote: CONNECTION });
      const action = element({ civitaiGrantAction: CONNECTION });
      let routeCalls = 0;
      let lookups = 0;
      const context = {
        console,
        /* If the module ever calls this again, the count is the failure. */
        route: () => { routeCalls++; },
        esc: (value) => String(value ?? ""),
        attr: (value) => String(value ?? ""),
        fetch: async () => ({
          ok: true,
          json: async () => ({
            grants: grants || [{ connectionId: CONNECTION, displayName: "fixture", tokenSource: "oauth", generationAuthorized: false }],
          }),
        }),
        document: {
          querySelectorAll: (selector) => {
            lookups++;
            if (selector === "[data-civitai-grant-note]") return [note];
            if (selector === "[data-civitai-grant-action]") return [action];
            return [];
          },
          getElementById: (id) => (id === "cfg-civitai-connection" ? (picker || null) : null),
        },
      };
      context.window = context;
      vm.createContext(context);
      vm.runInContext(civitaiSettings, context, { filename: "civitai-settings.js" });
      await context.refreshCivitaiGrants();
      return { note, action, routeCalls, lookups, context };
    }

    const bothGrants = [
      { connectionId: CONNECTION, displayName: "fixture", tokenSource: "oauth", generationAuthorized: true },
      { connectionId: OTHER, displayName: "other", tokenSource: "oauth", generationAuthorized: true },
    ];

    /* 5. THE RENDER LOOP MUST NOT RETURN, and 4. the grant contents still refresh. */
    {
      const touched = makePicker({ configured: OTHER, userChoice: "1" });
      touched.innerHTML = `<option value=""></option><option value="${CONNECTION}"></option>`;
      touched.value = CONNECTION;
      const { note, action, routeCalls, lookups } = await refreshWith({ picker: touched });
      assert.strictEqual(routeCalls, 0,
        "a Civitai grants refresh must never ask the router to redraw — that is the render loop that made Settings uneditable");
      assert(lookups > 0, "the refresh must actually have looked for its containers");
      assert(/identity only/i.test(note.textContent),
        "the grant line must be painted into its own container from the server's answer");
      assert(/Allow generation/.test(action.innerHTML),
        "the contextual spend authorization must be offered on a connection that lacks it");
      /* 1. A NONEMPTY UNSAVED SELECTION SURVIVES. */
      assert.strictEqual(touched.value, CONNECTION,
        "a repaint must preserve an unsaved account choice rather than resetting it to the configured one");
    }

    /* 2. AN EXPLICITLY CLEARED SELECTION SURVIVES — the C1 defect.
     *
     * This read `picker.value || picker.dataset.configured`, which cannot tell an
     * intentional clear from an untouched control: both are "", so `||` fell through and a
     * background refresh silently put back the account somebody had just removed. "" is a
     * choice, and the mark on the element is what says a person made it. */
    {
      const cleared = makePicker({ configured: OTHER, userChoice: "1" });
      cleared.innerHTML = `<option value=""></option><option value="${OTHER}"></option>`;
      cleared.value = "";
      await refreshWith({ picker: cleared, grants: bothGrants });
      assert.strictEqual(cleared.value, "",
        "an intentionally cleared account selection must survive a background grant refresh, not be refilled from the configured value");
    }

    /* 3. AN UNTOUCHED CONTROL STILL INITIALISES FROM THE CONFIGURED VALUE. Without the
       mark there is no live choice to protect, so the saved account is what belongs there. */
    {
      const untouched = makePicker({ configured: OTHER });
      untouched.innerHTML = `<option value=""></option>`;
      untouched.value = "";
      await refreshWith({ picker: untouched, grants: bothGrants });
      assert.strictEqual(untouched.value, OTHER,
        "an untouched picker must still be initialised from the configured connection");
    }

    /* And the mark is only ever set by the control's own change handler, which the rendered
       markup carries — so it cannot appear on a control nobody touched. */
    {
      const fresh = makePicker({ configured: OTHER });
      const { context } = await refreshWith({ picker: fresh, grants: bothGrants });
      assert.strictEqual(fresh.dataset.userChoice, undefined, "a repaint must not mark the control as user-chosen");
      context.civitaiConnectionChosen(fresh);
      assert.strictEqual(fresh.dataset.userChoice, "1", "the change handler is what marks a live choice");
      assert(/onchange="civitaiConnectionChosen\(this\)"/.test(views),
        "the rendered picker must carry the handler that marks a live choice");
    }

    /* The other half of the contract: the panel renders EMPTY containers, so nothing on
       screen depends on an async answer having already arrived. */
    assert(/data-civitai-grant-note=/.test(views) && /data-civitai-grant-action=/.test(views),
      "the Accounts row must render containers for the grant rather than requiring the answer at render time");
    assert(!/civitaiGrantFor\(/.test(views),
      "views.js must not read the grants cache while rendering; the painter owns those nodes");
  }

  console.log("settings consistency and persistence assertions passed, including that a Civitai grants refresh paints its own containers, never re-renders Settings, and preserves a live account choice — an intentional clear included");
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});

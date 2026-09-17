"use strict";
/* The Settings writer is evaluated against a small DOM and a request recorder.
   No application modules, config files, projects, servers or providers are loaded. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const source = fs.readFileSync(path.join(__dirname, "..", "public", "settings.js"), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));
function fixture(fields = {}, config = {}) {
  const controls = new Map(Object.entries(fields).map(([id, value]) => [id, {
    id, type: typeof value === "boolean" ? "checkbox" : "text", value: String(value), checked: value === true,
    disabled: false, dataset: {}, addEventListener() {}, setAttribute(name, v) { this[name] = v; },
  }]));
  const state = { dataset: { saveModel: "manual" }, textContent: "" };
  const notes = new Map(["assistant-test-note", "fal-test-note", "account-note"].map(id => [id, { dataset: {}, textContent: "" }]));
  const panel = { dataset: { settingsTab: "assistant" }, querySelectorAll: () => [...controls.values()] };
  const requests = [], confirmations = [], messages = [];
  let routes = 0, cleared = 0;
  const response = data => ({ ok: true, json: async () => data });
  const context = {
    URL, CONFIG: config, document: {
      activeElement: controls.values().next().value,
      getElementById: id => id === "settings-panel-state" ? state : controls.get(id) || notes.get(id) || null,
      querySelector: selector => selector === ".settings-selected-tab" ? panel : selector[0] === "#" ? context.document.getElementById(selector.slice(1)) : null,
      querySelectorAll: () => [],
    },
    fetch: async (url, options = {}) => { requests.push({ url, ...options }); return response(config); },
    toast: text => messages.push(text), route: () => { routes++; },
    confirmModal: (message, action, options) => confirmations.push({ message, action, options }),
    studioClearSettingsDraft: () => { cleared++; },
  };
  context.window = context;
  context.$ = selector => context.document.querySelector(selector);
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "public/settings.js" });
  context.initSettingsPanel();
  return { context, controls, state, notes, requests, confirmations, messages, response,
    routes: () => routes, cleared: () => cleared,
    call: expression => vm.runInContext(expression, context),
  };
}
function navigationFixture(initial, config, tab = "assistant-openai") {
  const f = fixture(initial, config);
  const studio = fs.readFileSync(path.join(__dirname, "..", "public", "settings-studio.js"), "utf8");
  f.context.activeProjectSlug = () => "fixture";
  f.context.setAppearancePreview = () => {};
  f.context.previewAppearanceSettings = () => {};
  f.context.updateInterfaceScaleReadout = () => {};
  let active;
  function mount(fields, selected) {
    const controls = new Map(Object.entries(fields).map(([id, value]) => [id, {
      id, tagName: "INPUT", type: typeof value === "boolean" ? "checkbox" : "text",
      value: String(value), checked: value === true, disabled: false, dataset: {},
      addEventListener() {}, setAttribute() {}, focus() { f.context.document.activeElement = this; },
    }]));
    const state = { dataset: { saveModel: "manual" }, textContent: "" };
    const panel = { dataset: { settingsTab: selected }, querySelectorAll: selector => selector.startsWith("details") ? [] : [...controls.values()] };
    active = { controls, state, panel };
    f.context.document.activeElement = controls.values().next().value;
    f.context.document.getElementById = id => id === "settings-panel-state" ? state : controls.get(id) || f.notes.get(id) || null;
    f.context.document.querySelector = selector => selector === ".settings-selected-tab" ? panel : selector[0] === "#" ? f.context.document.getElementById(selector.slice(1)) : null;
    f.context.initSettingsPanel();
    return active;
  }
  vm.runInContext(studio, f.context, { filename: "public/settings-studio.js" });
  f.context.route = () => f.context.studioCaptureSettingsDraft();
  mount(initial, tab);
  return { ...f, active: () => active, navigate(fields, selected) { f.context.studioCaptureSettingsDraft(); return mount(fields, selected); } };
}
/* A Settings mount with focus on the page body, the index's current link and compact select,
   and optionally a stored draft whose focused field the restore puts back first. */
function indexFocusFixture({ tab, flag = "", draftFocus = false, activeIsControl = false, noPanel = false }) {
  const studio = fs.readFileSync(path.join(__dirname, "..", "public", "settings-studio.js"), "utf8");
  const focusCalls = [], requests = [];
  const body = { tagName: "BODY" };
  const target = name => ({ focus(options) { focusCalls.push(options === undefined ? [name] : [name, options]); context.document.activeElement = this; } });
  const control = { ...target("control"), id: "cfg-index-draft", tagName: "INPUT", type: "text", value: "saved", checked: false, disabled: false, dataset: {}, addEventListener() {}, setAttribute() {} };
  const link = target("link"), select = target("select");
  const state = { dataset: { saveModel: "manual" }, textContent: "" };
  const panel = { dataset: { settingsTab: tab }, querySelectorAll: selector => selector.startsWith("details") ? [] : [control] };
  let mounted = !noPanel;
  const context = {
    URL, CONFIG: {}, location: { hash: `#/settings/${tab}` },
    document: {
      body, activeElement: activeIsControl ? control : body,
      getElementById: id => id === "settings-panel-state" ? state : id === control.id ? control : null,
      querySelector: selector => selector === ".settings-selected-tab" ? (mounted ? panel : null)
        : selector === ".studio-nav-links a[aria-current=page]" ? link : selector === ".studio-compact-nav select" ? select : null,
      querySelectorAll: () => [],
    },
    fetch: async (url, options = {}) => { requests.push({ url, ...options }); return { ok: true, json: async () => ({}) }; },
    activeProjectSlug: () => "fixture", toast() {}, route() {},
  };
  context.window = context;
  context.$ = selector => context.document.querySelector(selector);
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "public/settings.js" });
  vm.runInContext(studio, context, { filename: "public/settings-studio.js" });
  if (draftFocus) vm.runInContext(`STUDIO_SETTINGS_DRAFTS.set('fixture:${tab}', { values: [{ id: 'cfg-index-draft', index: 0, type: 'text', value: 'draft', checked: false }], baseline: ['saved'], focus: 'cfg-index-draft', open: [] })`, context);
  context.STUDIO_SETTINGS_INDEX_FOCUS = flag;
  context.initSettingsPanel();
  return { context, focusCalls, requests, mountPanel() { mounted = true; context.document.activeElement = body; context.initSettingsPanel(); } };
}
async function main() {
  {
    const f = fixture({ "cfg-fal-text-model": "chosen-model" }, { generation: { fal: { apiKey: "••••saved", enabled: true, keySource: "settings" } } });
    assert.deepStrictEqual(plain(f.call("generationConfigPatch()")), { generation: { fal: { textModel: "chosen-model" } } },
      "A defaults panel must not echo credentials, enablement, concurrency or unrendered defaults");
  }
  {
    const f = fixture({ "cfg-fal-enabled": true, "cfg-fal-key": "••••saved", "cfg-civitai-resource": "chosen-resource" }, { generation: { fal: { keySource: "environment" } } });
    assert.deepStrictEqual(plain(f.call("generationConfigPatch()")), { generation: { fal: { enabled: true }, civitai: { resourceAir: "chosen-resource" } } });
    await f.context.saveConfig("fal-connection");
    assert.strictEqual(f.requests.length, 0, "Environment-managed Fal credentials must never be patched by this field");
  }
  {
    const f = fixture({ "cfg-fal-key": "replacement input", "cfg-fal-enabled": true, "cfg-fal-text-model": "ignored-model" }, { generation: { fal: { keySource: "settings" } } });
    await f.context.saveConfig("fal-connection");
    assert.deepStrictEqual(JSON.parse(f.requests[0].body), { generation: { fal: { apiKey: "replacement input" } } }, "Connection save owns only the rendered credential");
    assert.strictEqual(f.routes(), 0, "Saving must retain the current panel and keyboard focus");
  }
  {
    const f = fixture({ "cfg-openai-key": "replacement input" }, { assistant: { provider: "custom" }, openaiModel: "existing-model" });
    assert.deepStrictEqual(plain(f.call("assistantConfigPatch()")), { openaiKey: "replacement input" });
    const v = fixture({ "assistant-vision-provider": "openai" }, { assistant: { provider: "custom" } });
    assert.deepStrictEqual(plain(v.call("assistantConfigPatch()")), { assistant: { visionProvider: "openai" } }, "Vision save must not echo or switch the main provider");
  }
  {
    const f = fixture({ "cfg-custom-key": "replacement input" }, { customKey: "••••saved" });
    const focus = f.context.document.activeElement;
    f.context.fetch = async () => ({ ok: false, json: async () => ({ error: "Fixture write refused" }) });
    await f.context.saveConfig();
    assert.strictEqual(f.controls.get("cfg-custom-key").value, "replacement input");
    assert.strictEqual(f.context.document.activeElement, focus);
    assert.strictEqual(f.state.dataset.state, "error");
    assert.match(f.state.textContent, /Fixture write refused/);
    assert.strictEqual(f.routes(), 0);
    assert.strictEqual(f.cleared(), 0, "A failed save must retain the unsaved draft");
  }
  {
    const old = { assistant: { provider: "openai" }, openaiModel: "saved-model", openaiKey: "••••saved" };
    const f = fixture({ "cfg-openai-key": "replacement input" }, old);
    f.context.fetch = async (url, options = {}) => {
      f.requests.push({ url, ...options });
      if (options.method === "PUT") return f.response({ ok: true });
      throw new Error("Fixture read failed");
    };
    await f.context.saveConfig();
    assert.strictEqual(f.context.CONFIG, old, "A failed safe reread must retain only the prior safe display object");
    assert(!JSON.stringify(f.context.CONFIG).includes("replacement input"));
    assert.strictEqual(f.controls.get("cfg-openai-key").type, "password");
    assert.strictEqual(f.controls.get("cfg-openai-key").value, "••••saved");
    assert.strictEqual(f.state.dataset.state, "saved");
    assert.match(f.state.textContent, /stored.*display could not be refreshed/);
    assert.strictEqual(f.cleared(), 1);
    await f.context.testAssistantConnection();
    assert.strictEqual(f.confirmations.length, 0, "An unrefreshed saved target must not be tested using stale CONFIG");
    assert.strictEqual(f.requests.length, 2, "Only the write and attempted safe read occurred");
  }
  {
    const f = fixture({ "cfg-openai-model": "saved-model" }, { assistant: { provider: "openai" }, openaiModel: "saved-model" });
    f.controls.get("cfg-openai-model").value = "draft-model";
    await f.context.testAssistantConnection();
    assert.strictEqual(f.requests.length, 0);
    assert.strictEqual(f.confirmations.length, 0);
    assert.match(f.notes.get("assistant-test-note").textContent, /Save or discard/);
    f.controls.get("cfg-openai-model").value = "saved-model";
    await f.context.testAssistantConnection();
    assert.strictEqual(f.requests.length, 0, "The disclosure must precede the model request");
    assert.match(f.confirmations[0].message, /OpenAI · saved-model/);
    assert.match(f.confirmations[0].message, /cloud.*may charge/);
    assert.match(f.confirmations[0].message, /Saved endpoint: https:\/\/api.openai.com\/v1/);
    await f.confirmations[0].action();
    assert.strictEqual(f.requests[0].url, "/api/assistant/test");
    assert.deepStrictEqual(JSON.parse(f.requests[0].body), { provider: "openai" });
  }
  {
    const f = fixture({}, { assistant: { provider: "none" } });
    await f.context.testAssistantConnection();
    assert.strictEqual(f.requests.length, 0);
    assert.strictEqual(f.confirmations.length, 0);
  }
  {
    const f = fixture({ "cfg-fal-text-model": "saved-model" });
    f.controls.get("cfg-fal-text-model").value = "draft-model";
    await f.context.testFalGenerationConnection();
    assert.strictEqual(f.requests.length, 0);
    f.controls.get("cfg-fal-text-model").value = "saved-model";
    await f.context.testFalGenerationConnection();
    assert.strictEqual(f.requests[0].url, "/api/generation/fal/test");
    assert.strictEqual(f.notes.get("fal-test-note").dataset.tone, "configured");
    assert.match(f.notes.get("fal-test-note").textContent, /reachability, model availability and balance were not checked/);
  }
  {
    const f = fixture();
    f.context.fetch = async () => ({ ok: false, json: async () => ({ error: "Fixture provider unavailable" }) });
    await f.context.recheckAccountConnection("fixture-connection");
    assert.strictEqual(f.routes(), 0, "A failed account recheck must retain its inline error");
    assert.match(f.notes.get("account-note").textContent, /Fixture provider unavailable/);
    f.context.disconnectAccount("fixture-connection");
    assert.match(f.confirmations[0].message, /history.*remain/);
    assert.match(f.confirmations[0].message, /does not revoke.*or cancel active jobs/);
  }
  {
    const f = fixture({ "cfg-custom-model": "stored" });
    f.context.studioRestoreSettingsDraft = () => { f.controls.get("cfg-custom-model").value = "restored draft"; };
    f.context.initSettingsPanel();
    assert.strictEqual(f.state.dataset.state, "dirty", "Restoring after the baseline must preserve unsaved-state truth");
  }
  {
    const f = fixture({ "cfg-custom-model": "draft retained" }, { assistant: { provider: "ollama" } });
    const focus = f.context.document.activeElement;
    f.context.fetch = async () => { throw new Error("network unavailable"); };
    await f.context.setAssistantProvider("custom");
    assert.strictEqual(f.context.CONFIG.assistant.provider, "ollama");
    assert.strictEqual(f.controls.get("cfg-custom-model").value, "draft retained");
    assert.strictEqual(f.context.document.activeElement, focus);
    assert.strictEqual(f.state.dataset.state, "error");
    assert.strictEqual(f.routes(), 0);
    let restored = false;
    f.context.document.querySelectorAll = () => [{ getAttribute: () => "setAssistantProvider('custom')", focus: () => { restored = true; } }];
    f.context.fetch = async () => f.response({ ok: true });
    await f.context.setAssistantProvider("custom");
    assert.strictEqual(f.context.CONFIG.assistant.provider, "custom");
    assert.strictEqual(f.routes(), 1);
    assert(restored, "Successful immediate selection restores the replacement button after redraw");
  }
  {
    const f = fixture({}, { assistant: { provider: "custom" }, customModel: "saved model", customBaseUrl: "http://127.0.0.1:8123/v1?private=hidden" });
    await f.context.testAssistantConnection();
    assert.match(f.confirmations[0].message, /Saved endpoint: http:\/\/127.0.0.1:8123\/v1/);
    assert(!f.confirmations[0].message.includes("private=hidden"), "Endpoint disclosure omits query material");
    f.context.fetch = async () => ({ ok: false, json: async () => ({ error: "unsafe provider response fixture" }) });
    await f.confirmations[0].action();
    assert(!f.notes.get("assistant-test-note").textContent.includes("unsafe provider response fixture"));
    assert.match(f.notes.get("assistant-test-note").textContent, /Check the saved endpoint, model and authorization/);
  }
  {
    const f = fixture({ "cfg-custom-model": "submitted model", "cfg-custom-key": "submitted input" }, { customModel: "previous model", customKey: "••••saved" });
    let finishWrite;
    f.context.fetch = async (url, options = {}) => options.method === "PUT"
      ? new Promise(resolve => { finishWrite = resolve; })
      : f.response({ customModel: "submitted model", customKey: "••••saved" });
    const saving = f.context.saveConfig();
    f.controls.get("cfg-custom-model").value = "newer model edit";
    f.controls.get("cfg-custom-key").value = "newer input edit";
    finishWrite(f.response({ ok: true }));
    await saving;
    assert.strictEqual(f.state.dataset.state, "dirty", "Typing during PUT remains unsaved after the earlier snapshot succeeds");
    assert.strictEqual(f.controls.get("cfg-custom-model").value, "newer model edit");
    assert.strictEqual(f.controls.get("cfg-custom-key").value, "newer input edit", "Masking a saved credential must not erase newer replacement input");
    assert.strictEqual(f.context.CONFIG.customModel, "submitted model");
    assert(!JSON.stringify(f.context.CONFIG).includes("newer input edit"));
  }
  {
    const f = navigationFixture({ "cfg-openai-key": "••••saved", "cfg-openai-model": "old model" }, { openaiKey: "••••saved", openaiModel: "old model" });
    f.active().controls.get("cfg-openai-key").value = "submitted input";
    let release;
    f.context.fetch = async (url, options = {}) => options.method === "PUT"
      ? new Promise(resolve => { release = resolve; })
      : f.response({ openaiKey: "••••updated", openaiModel: "old model" });
    const saving = f.context.saveConfig();
    const files = f.navigate({ "cfg-output-root": "original folder" }, "files");
    files.controls.get("cfg-output-root").value = "new folder draft";
    f.context.refreshSettingsPanelState();
    const baseline = plain(f.call("SETTINGS_PANEL_BASELINE"));
    release(f.response({ ok: true }));
    await saving;
    assert.deepStrictEqual(plain(f.call("SETTINGS_PANEL_BASELINE")), baseline, "A detached save cannot replace the current panel baseline");
    assert.strictEqual(files.state.dataset.state, "dirty");
    assert.strictEqual(files.controls.get("cfg-output-root").value, "new folder draft");
    assert.strictEqual(f.call("STUDIO_SETTINGS_DRAFTS.has('fixture:assistant-openai')"), false, "A saved credential must be removed from its old draft");
    const returned = f.navigate({ "cfg-openai-key": "••••updated", "cfg-openai-model": "old model" }, "assistant-openai");
    assert.strictEqual(returned.controls.get("cfg-openai-key").value, "••••updated");
    assert.strictEqual(returned.state.dataset.state, "clean");
  }
  {
    const f = navigationFixture({ "cfg-openai-key": "••••saved", "cfg-openai-model": "old model" }, { openaiKey: "••••saved", openaiModel: "old model" });
    f.active().controls.get("cfg-openai-key").value = "submitted input";
    f.active().controls.get("cfg-openai-model").value = "submitted model";
    let release;
    f.context.fetch = async (url, options = {}) => options.method === "PUT"
      ? new Promise(resolve => { release = resolve; })
      : f.response({ openaiKey: "••••updated", openaiModel: "submitted model" });
    const saving = f.context.saveConfig();
    f.navigate({ "cfg-output-root": "folder" }, "files");
    const returned = f.navigate({ "cfg-openai-key": "••••saved", "cfg-openai-model": "old model" }, "assistant-openai");
    assert.strictEqual(returned.controls.get("cfg-openai-model").value, "submitted model");
    returned.controls.get("cfg-openai-model").value = "newer model draft";
    release(f.response({ ok: true }));
    await saving;
    assert.strictEqual(returned.controls.get("cfg-openai-key").value, "••••updated");
    assert.strictEqual(returned.controls.get("cfg-openai-model").value, "newer model draft");
    assert.strictEqual(returned.state.dataset.state, "dirty");
    assert.deepStrictEqual(plain(f.call("SETTINGS_PANEL_BASELINE")), ["••••updated", "submitted model"]);
    const draft = f.call("STUDIO_SETTINGS_DRAFTS.get('fixture:assistant-openai')");
    assert(!JSON.stringify(draft).includes("submitted input"), "The reconciled draft cannot retain a successfully saved raw credential");
  }
  {
    const f = navigationFixture({ "cfg-openai-model": "old model" }, {});
    f.active().controls.get("cfg-openai-model").value = "unsaved model";
    let release;
    f.context.fetch = async () => new Promise(resolve => { release = resolve; });
    const saving = f.context.saveConfig();
    const files = f.navigate({ "cfg-output-root": "folder" }, "files");
    release({ ok: false, json: async () => ({ error: "Fixture rejected original save" }) });
    await saving;
    assert.strictEqual(files.state.dataset.state, "clean", "An old save failure must not mark another panel failed");
    const returned = f.navigate({ "cfg-openai-model": "old model" }, "assistant-openai");
    assert.strictEqual(returned.controls.get("cfg-openai-model").value, "unsaved model");
    assert.strictEqual(returned.state.dataset.state, "error");
    assert.match(returned.state.textContent, /Fixture rejected original save/);
  }
  {
    const f = navigationFixture({ "cfg-theme-accent": "blue" }, { appearance: { accent: "blue" } }, "appearance");
    f.active().controls.get("cfg-theme-accent").value = "green";
    f.context.studioCaptureSettingsDraft();
    assert(f.call("STUDIO_SETTINGS_DRAFTS.has('fixture:appearance')"));
    f.context.discardAppearancePreview();
    assert(!f.call("STUDIO_SETTINGS_DRAFTS.has('fixture:appearance')"), "Discard must survive route's automatic draft capture");
    const returned = f.navigate({ "cfg-theme-accent": "blue" }, "appearance");
    assert.strictEqual(returned.controls.get("cfg-theme-accent").value, "blue");
    assert.strictEqual(returned.state.dataset.state, "clean");
  }
  {
    const f = fixture({}, { generation: { fal: { enabled: false, apiKey: "••••saved", keySource: "settings" } } });
    f.context.fetch = async () => ({ ok: false, json: async () => ({ error: "Enable generation first" }) });
    await f.context.testFalGenerationConnection();
    assert.match(f.notes.get("fal-test-note").textContent, /Generation is off.*credential: present/);
    assert.match(f.notes.get("fal-test-note").textContent, /do not need to enable generation/);
  }
  for (const kind of ["passcodes", "appearance", "workspace"]) {
    const fields = kind === "passcodes" ? { "cfg-epass": "", "cfg-vpass": "" }
      : kind === "appearance" ? { "cfg-theme-accent": "blue" } : { "cfg-output-root": "old folder" };
    const tab = kind === "passcodes" ? "access" : kind === "appearance" ? "appearance" : "files";
    const f = navigationFixture(fields, {}, tab);
    f.context.commitWorkspaceAppearance = () => {};
    f.context.setHelpMode = () => {};
    f.context.ACTIVE_PROJECT_SLUG = "fixture";
    f.active().controls.values().next().value.value = kind === "appearance" ? "green" : "submitted value";
    let release;
    f.context.fetch = async (url, options = {}) => options.method === "PUT" || options.method === "POST"
      ? new Promise(resolve => { release = resolve; }) : f.response({});
    const saving = kind === "passcodes" ? f.context.persistPassSettings({ editorPass: "submitted value" })
      : kind === "appearance" ? f.context.saveAppearanceSettings() : f.context.saveStorageSettings();
    const other = f.navigate({ "cfg-custom-model": "other model" }, "assistant-custom");
    const baseline = plain(f.call("SETTINGS_PANEL_BASELINE"));
    release(f.response({ ok: true }));
    await saving;
    assert.deepStrictEqual(plain(f.call("SETTINGS_PANEL_BASELINE")), baseline, `${kind}: navigation must preserve the new panel baseline`);
    assert.strictEqual(other.state.dataset.state, "clean", `${kind}: completion must not change the new panel state`);
    assert(!f.call(`STUDIO_SETTINGS_DRAFTS.has('fixture:${tab}')`), `${kind}: the originating saved draft is settled`);
  }
  {
    const f = navigationFixture({ "cfg-openai-key": "••••saved" }, { openaiKey: "••••saved" });
    f.active().controls.get("cfg-openai-key").value = "submitted input";
    let finishRead;
    f.context.fetch = async (url, options = {}) => options.method === "PUT" ? f.response({ ok: true })
      : new Promise(resolve => { finishRead = resolve; });
    const saving = f.context.saveConfig();
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(f.active().controls.get("cfg-openai-key").value, "••••saved");
    f.navigate({ "cfg-output-root": "folder" }, "files");
    finishRead(f.response({ openaiKey: "••••updated" }));
    await saving;
    assert(!f.call("STUDIO_SETTINGS_DRAFTS.has('fixture:assistant-openai')"), "Navigation during the safe GET must not retain an obsolete saved placeholder draft");
  }
  {
    const f = navigationFixture({ "cfg-openai-model": "saved" }, {});
    f.active().controls.get("cfg-openai-model").value = "draft";
    f.context.activeProjectSlug = () => "another-project";
    f.context.studioCaptureSettingsDraft();
    assert(f.call("STUDIO_SETTINGS_DRAFTS.has('fixture:assistant-openai')"), "A project switch cannot relabel the still-mounted panel's draft owner");
    assert(!f.call("STUDIO_SETTINGS_DRAFTS.has('another-project:assistant-openai')"));
  }
  /* EV2-7: the index focus hook. It only answers a recorded keyboard intent for the panel
     that intent opened, never scrolls, never takes focus from a restored draft, and the
     hint is spent by the first Settings mount whether or not a panel is there. */
  {
    const intent = indexFocusFixture({ tab: "fal" });
    const record = (event, id, kind) => { intent.context.STUDIO_SETTINGS_INDEX_FOCUS = ""; intent.context.studioSettingsIndexIntent(event, id, kind); return intent.context.STUDIO_SETTINGS_INDEX_FOCUS; };
    assert.strictEqual(record({ type: "click", detail: 1 }, "fal"), "", "A pointer click leaves focus where the pointer put it");
    assert.strictEqual(record({ type: "click", detail: 0 }, "fal"), "link:fal", "A keyboard-generated click records its destination");
    assert.strictEqual(record({ type: "keydown", key: "Enter" }, "fal"), "link:fal", "Enter records its destination");
    assert.strictEqual(record({ type: "keydown", key: "Tab" }, "fal"), "", "Moving through the index records nothing");
    for (const modifier of ["ctrlKey", "metaKey", "shiftKey", "altKey"])
      assert.strictEqual(record({ type: "keydown", key: "Enter", [modifier]: true }, "fal"), "", `A ${modifier} activation opens elsewhere and records nothing`);
    assert.strictEqual(record({ type: "change" }, "fal", "select"), "select:fal", "The compact select always records its destination");
  }
  for (const [kind, target] of [["link", "link"], ["select", "select"]]) {
    const f = indexFocusFixture({ tab: "fal", flag: `${kind}:fal` });
    assert.deepStrictEqual(plain(f.focusCalls), [[target, { preventScroll: true }]], `${kind}: focus returns to the index without scrolling the new panel`);
    assert.strictEqual(f.context.STUDIO_SETTINGS_INDEX_FOCUS, "", `${kind}: the focus hint is one-shot`);
  }
  {
    const f = indexFocusFixture({ tab: "generation", flag: "link:generation", draftFocus: true });
    assert.deepStrictEqual(f.focusCalls.map(([name]) => name), ["control"], "A restored draft keeps its focus; the index does not take it");
    assert.strictEqual(f.context.document.activeElement.id, "cfg-index-draft");
    assert.strictEqual(f.context.STUDIO_SETTINGS_INDEX_FOCUS, "", "The hint is spent even when a draft placed focus");
  }
  {
    const f = indexFocusFixture({ tab: "fal", flag: "link:accounts" });
    assert.deepStrictEqual(f.focusCalls, [], "A hint for another destination never moves focus on this panel");
    assert.strictEqual(f.context.STUDIO_SETTINGS_INDEX_FOCUS, "", "A mismatched hint is discarded");
    const legacy = indexFocusFixture({ tab: "fal", flag: "link" });
    assert.deepStrictEqual(legacy.focusCalls, [], "A hint without a destination is ignored");
    const elsewhere = indexFocusFixture({ tab: "fal", flag: "link:fal", activeIsControl: true });
    assert.deepStrictEqual(elsewhere.focusCalls, [], "Focus the user already placed is left alone");
    const missing = indexFocusFixture({ tab: "fal", flag: "link:fal", noPanel: true });
    assert.deepStrictEqual(missing.focusCalls, [], "No panel, no focus move");
    assert.strictEqual(missing.context.STUDIO_SETTINGS_INDEX_FOCUS, "", "A mount without a panel still spends the hint, so it cannot pull focus later");
    missing.mountPanel();
    assert.deepStrictEqual(missing.focusCalls, [], "A later Settings render does not act on a hint left by a navigation that never mounted");
    assert.strictEqual(missing.requests.length, 0, "The focus hook sends no request");
  }
  /* EV2-7: doExport names what the server wrote, or why nothing was written. */
  {
    const exportNote = async (reply) => {
      const f = fixture();
      const note = { textContent: "" };
      f.notes.set("export-note", note);
      let pending = "";
      f.context.fetch = async (url, options = {}) => { f.requests.push({ url, ...options }); pending = note.textContent; return reply(); };
      await f.context.doExport();
      assert.deepStrictEqual(f.requests.map(({ url, method }) => [url, method]), [["/api/export", "POST"]], "Export uses the existing endpoint once");
      assert.strictEqual(pending, "Exporting…", "Export announces that it is running");
      return note.textContent;
    };
    const answer = (status, body) => ({ ok: status < 400, status, json: async () => body });
    const unreadable = status => ({ ok: status < 400, status, json: async () => { throw new SyntaxError("Unexpected token <"); } });
    assert.strictEqual(await exportNote(() => answer(200, { ok: true, name: "signal-house.md", path: "D:\\Output\\signal-house\\signal-house.md" })), "Markdown export written to D:\\Output\\signal-house\\signal-house.md");
    assert.strictEqual(await exportNote(() => answer(200, { ok: true, name: "signal-house.md" })), "Markdown export written to signal-house.md");
    assert.strictEqual(await exportNote(() => answer(500, { error: "Output folder is not writable" })), "Export failed: Output folder is not writable");
    assert.strictEqual(await exportNote(() => answer(500, {})), "Export failed: the CineBraid server answered 500");
    assert.strictEqual(await exportNote(() => unreadable(502)), "Export failed: the CineBraid server answered 502");
    assert.strictEqual(await exportNote(() => unreadable(200)), "Export failed: the CineBraid server's answer could not be read");
    assert.strictEqual(await exportNote(() => { throw new TypeError("Failed to fetch"); }), "Export failed: the CineBraid server did not respond");
  }
  console.log("EV2-5 Settings writers: granular ownership, environment key precedence, safe reread failure, preserved errors/focus, test disclosure, draft hooks, index focus hook and export result passed.");
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

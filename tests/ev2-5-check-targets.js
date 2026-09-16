"use strict";
/* UI scripts only: no application/server imports, settings files or network calls. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function harness() {
  const nodes = new Map();
  const calls = [];
  const notices = [];
  const context = {
    CONFIG: { generation: {
      comfy: { baseUrl: "http://127.0.0.1:8188", workflowFolder: "fixture-workflows" },
      civitai: { connectionId: "saved-account", resourceAir: "saved-air" },
    } },
    document: {
      activeElement: null,
      getElementById: (id) => nodes.get(id) || null,
      querySelectorAll: (selector) => [...nodes.values()].filter((node) =>
        selector === "[data-civitai-grant-note]" ? "civitaiGrantNote" in node.dataset
          : selector === "[data-civitai-grant-action]" && "civitaiGrantAction" in node.dataset),
    },
    toast: (text) => notices.push(text),
    esc: (text) => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;"),
    attr: (text) => String(text).replaceAll("&", "&amp;").replaceAll('"', "&quot;"),
    fetch: async (url, options) => { calls.push({ url, options }); return context.reply(url, options); },
    reply: async () => { throw new Error("No mock response configured"); },
  };
  context.$ = (selector) => nodes.get(selector.replace(/^#/, "")) || null;
  context.window = context;
  function field(id, value = "", dataset = {}) {
    let html = "";
    const node = { id, value, dataset, textContent: "", options: [], focus() { context.document.activeElement = node; } };
    Object.defineProperty(node, "innerHTML", {
      get() { return html; },
      set(value) {
        html = value;
        if (id !== "cfg-civitai-connection") return;
        node.options = [...value.matchAll(/<option value="([^"]*)"([^>]*)>/g)]
          .map((match) => ({ value: match[1], selected: /\bselected\b/.test(match[2]) }));
        node.value = (node.options.find((option) => option.selected) || node.options[0] || {}).value || "";
      },
    });
    nodes.set(id, node);
    return node;
  }
  vm.createContext(context);
  for (const name of ["comfy-settings.js", "civitai-settings.js"])
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "public", name), "utf8"), context, { filename: name });
  return { context, field, calls, notices };
}
const response = (data, ok = true) => ({ ok, json: async () => data });

async function main() {
  const h = harness();
  const { context: c, field, calls } = h;
  const endpoint = field("cfg-comfy-base-url", "http://127.0.0.1:9999");
  const folder = field("cfg-comfy-workflow-folder", "fixture-workflows");
  const comfyNote = field("comfy-test-note");
  const configBefore = JSON.stringify(c.CONFIG);
  await c.testComfyConnection();
  assert.strictEqual(calls.length, 0, "a draft endpoint must not probe the old target");
  assert.strictEqual(c.document.activeElement, endpoint);
  assert.match(comfyNote.textContent, /Save ComfyUI settings/);
  assert.strictEqual(endpoint.value, "http://127.0.0.1:9999");
  endpoint.value = "  http://127.0.0.1:8188  ";
  folder.value = "different-fixture-folder";
  await c.testComfyConnection();
  assert.strictEqual(calls.length, 0, "a draft workflow folder must block the saved-target check");
  assert.strictEqual(c.document.activeElement, folder);
  folder.value = "fixture-workflows";
  c.reply = async () => response({ connected: true, version: "fixture" });
  await c.testComfyConnection();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, "/api/generation/comfy/test");
  assert.strictEqual(calls[0].options.body, undefined, "keep the existing saved-target API");
  assert.match(comfyNote.textContent, /Saved runtime answered/);
  assert.match(comfyNote.textContent, /Generation was not tested/);

  const account = field("cfg-civitai-connection", "draft-account", { configured: "saved-account", userChoice: "1" });
  const resource = field("cfg-civitai-resource", "draft-air");
  const modelNote = field("civitai-resource-note");
  await c.checkCivitaiResource();
  assert.strictEqual(calls.length, 1, "a changed paying account must block the resource call");
  assert.strictEqual(c.document.activeElement, account);
  assert.strictEqual(account.value, "draft-account");
  assert.strictEqual(resource.value, "draft-air");
  assert.match(modelNote.textContent, /saved paying account/);
  account.value = "";
  await c.checkCivitaiResource();
  assert.strictEqual(calls.length, 1, "an intentional account clear is also unsaved");
  account.value = "saved-account";
  resource.value = "";
  await c.checkCivitaiResource();
  assert.strictEqual(calls.length, 1, "empty AIR must not invisibly check the saved resource fallback");
  assert.strictEqual(c.document.activeElement, resource);
  resource.value = "draft-air";
  c.reply = async () => response({ resource: { canGenerate: true, modelName: "Fixture model" } });
  await c.checkCivitaiResource();
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[1].url, "/api/generation/civitai/resource");
  assert.deepStrictEqual(JSON.parse(calls[1].options.body), { resourceAir: "draft-air" });
  assert.match(modelNote.textContent, /Unsaved model checked with the saved paying account/);
  assert.match(modelNote.textContent, /No generation submitted/);

  c.reply = async () => response({ resource: { canGenerate: false, checkPermission: true } });
  await c.checkCivitaiResource();
  assert.match(modelNote.textContent, /gated/);
  assert.match(modelNote.textContent, /Unsaved model checked with the saved paying account/);
  c.reply = async () => response({ error: "PRIVATE_PROVIDER_ERROR_FIXTURE" }, false);
  await c.checkCivitaiResource();
  assert.doesNotMatch(modelNote.textContent, /PRIVATE_PROVIDER_ERROR_FIXTURE/);
  assert.match(modelNote.textContent, /Your edits are preserved/);
  await c.testComfyConnection();
  assert.doesNotMatch(comfyNote.textContent, /PRIVATE_PROVIDER_ERROR_FIXTURE/);
  assert.match(comfyNote.textContent, /No generation submitted/);

  const readNote = field("civitai-grants-note");
  const grantNote = field("grant-note", "", { civitaiGrantNote: "saved-account" });
  const grantAction = field("grant-action", "", { civitaiGrantAction: "saved-account" });
  account.value = "draft-account";
  c.reply = async () => { throw new Error("fixture network failure"); };
  await c.refreshCivitaiGrants();
  assert.strictEqual(account.value, "draft-account", "first failed read must preserve selected account even without cached options");
  assert.match(account.innerHTML, /Could not read accounts/);
  assert.doesNotMatch(account.innerHTML, /Loading/);
  assert.match(readNote.innerHTML, /Retry account check/);
  assert.match(grantNote.textContent, /Could not read/);
  assert.strictEqual(c.civitaiGrantFor("saved-account"), null);
  assert.strictEqual(grantAction.innerHTML, "");
  const grants = [
    { connectionId: "saved-account", displayName: "Saved fixture", generationAuthorized: true },
    { connectionId: "draft-account", displayName: "Draft fixture", generationAuthorized: false },
  ];
  c.reply = async () => response({ grants });
  await c.refreshCivitaiGrants();
  assert.strictEqual(account.value, "draft-account", "retry may not restore the configured account over a draft");
  assert.strictEqual(readNote.innerHTML, "");
  assert.strictEqual(c.civitaiGrantFor("saved-account").generationAuthorized, true);
  c.reply = async () => response({ error: "fixture failure" }, false);
  await c.refreshCivitaiGrants();
  assert.strictEqual(account.value, "draft-account");
  assert.strictEqual(c.civitaiGrantFor("saved-account"), null, "cached authorization cannot claim current permission after a failure");
  assert.match(account.innerHTML, /last read; recheck needed/);
  account.value = "";
  c.reply = async () => response({ grants });
  await c.refreshCivitaiGrants();
  assert.strictEqual(account.value, "", "explicit None survives failure and retry");
  account.value = "draft-account";
  c.reply = async () => response({ grants: [grants[0]] });
  await c.refreshCivitaiGrants();
  assert.strictEqual(account.value, "draft-account", "removal is represented rather than silently changing a draft");
  assert.match(account.innerHTML, /no longer connected/);
  c.reply = async () => response({});
  await c.refreshCivitaiGrants();
  assert.match(readNote.innerHTML, /Could not read/, "malformed success is a read failure, not an empty accounts list");
  assert.strictEqual(JSON.stringify(c.CONFIG), configBefore, "checks and retry never save settings");
  console.log("EV2-5 check targets passed: saved targets, explicit draft model, no unexpected requests, preserved grant choices and retryable read failures.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

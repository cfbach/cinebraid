/* Assistant Settings must describe the existing capability observations.
 * All settings and projects are disposable; the render harness mocks every request.
 * This exercises contradictory status/configuration and unavailable services without
 * adding a provider check or modifying any stored configuration contract. */
const assert = require("assert");
const fs = require("fs");
const { disposableRoot } = require("./helpers/disposable-root");
const workspace = disposableRoot("assistant-capability-presentation");
process.env.CINEBRAID_CONFIG_PATH = workspace.configPath;
process.env.CINEBRAID_PROJECTS_ROOT = workspace.projectsRoot;
const { render, buildFixture } = require("./render-harness");

const initial = {
  assistant: { provider: "custom", visionProvider: "custom" },
  customBaseUrl: "https://remote-runtime.example/v1",
  customModel: "configured-text",
  customVisionModel: "",
  continuity: { visionProvider: "custom", baseUrl: "https://continuity.example/v1", visionModel: "configured-continuity" },
  generation: { fal: { enabled: false } },
  agents: { enabled: false },
};
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
function card(html, name) {
  const start = html.indexOf(`<article class="capability-card" data-capability="${name}"`);
  assert.ok(start >= 0, `Missing ${name} capability card`);
  return html.slice(start, html.indexOf("</article>", start) + "</article>".length);
}
async function panel(capabilities, patch = {}) {
  fs.writeFileSync(workspace.configPath, JSON.stringify({ ...initial, ...patch }));
  const { html } = await render("#/settings/assistant", buildFixture(), { agentStatus: { capabilities } });
  return html;
}

async function main() {
  // An explicit capability standing outranks the legacy ready flag and form contents.
  for (const [standing, expectedState, expectedLabel] of [
    ["off", "off", "Off"], ["ready", "on", "Configured"],
    ["configured-unavailable", "unreachable", "Needs attention"], ["checking", "checking", "Status unknown"],
  ]) {
    const html = await panel({ text: { standing, ready: standing !== "ready", model: "resolved-text",
      message: "The selected service rejected its key.", action: "Replace the saved key in its connection." } });
    const text = card(html, "braidy");
    check(text.includes(`data-state="${expectedState}"`), `Text standing ${standing} controls its visible state`);
    check(text.includes(`<b class="capability-status">${expectedLabel}</b>`), `Text standing ${standing} has an honest label`);
    if (standing === "configured-unavailable") {
      check(text.includes("The selected service rejected its key.") && text.includes("Replace the saved key in its connection."),
        "Text failure preserves the authoritative diagnosis and recovery action");
    }
    if (standing === "ready") {
      check(text.includes("<b>resolved-text</b>"), "Text identity names the resolved model");
      check(text.includes("not a live provider or billing check"), "Configured does not claim live cloud readiness");
    }
  }
  for (const text of [undefined, { ready: true }, { standing: "unexpected", ready: true }]) {
    const html = await panel(text ? { text } : {});
    check(card(html, "braidy").includes('data-state="checking"'), "Missing or unrecognized standing remains unknown");
  }
  const missingModel = card(await panel({ text: { standing: "configured-unavailable", ready: false,
    message: "Text assistance provider custom is not configured.", action: "Complete the provider connection in Settings." } },
    { customModel: "" }), "braidy");
  check(missingModel.includes("Complete the provider connection in Settings."), "A blank text field cannot replace the provider's diagnostic");
  check(!missingModel.includes('<b class="capability-status">Needs a model</b>'), "Text configuration does not invent a capability verdict");

  // General vision remains independent, and exposes the resolved fallback model.
  const vision = card(await panel({ text: { standing: "off", ready: false },
    vision: { standing: "ready", ready: false, model: "resolved-vision-fallback" } }), "vision");
  check(vision.includes('data-state="ready"') && vision.includes("resolved-vision-fallback"),
    "Vision keeps its own standing and names the resolved model even when the explicit vision field is blank");

  // Continuity's actual API record has no standing. Its ready observation and
  // diagnostic are sufficient; a selected provider alone is not readiness.
  const unavailable = card(await panel({ continuity: { ready: false,
    message: "Continuity observation cannot reach its AI server.", action: "Correct its address in Settings, then retry." } }), "continuity");
  check(unavailable.includes('data-state="unreachable"') && unavailable.includes(">Needs attention</b>"),
    "A configured but unavailable continuity service must not read Configured");
  check(unavailable.includes("cannot reach its AI server") && unavailable.includes("Correct its address in Settings, then retry."),
    "Continuity preserves the service diagnostic and recovery action");
  const unknown = card(await panel({}), "continuity");
  check(unknown.includes('data-state="checking"') && unknown.includes(">Status unknown</b>"),
    "Continuity with no observation is unknown");
  const configured = card(await panel({ continuity: { ready: true, model: "resolved-continuity" } },
    { continuity: { visionProvider: "custom", visionModel: "" } }), "continuity");
  check(configured.includes('data-state="on"') && configured.includes("resolved-continuity"),
    "Continuity displays its existing successful inventory observation and resolved model");
  check(configured.includes("a continuity review has not been tested here"), "An inventory response is not presented as a successful review");
  const off = card(await panel({ continuity: { ready: true } }, { continuity: {} }), "continuity");
  check(off.includes('data-state="off"'), "No continuity selection stays off independently of a stale observation");

  // User-supplied diagnostic content remains text, and choosing the compatible
  // adapter makes no promise about hosting, privacy, or who owns the hardware.
  const escaped = card(await panel({ text: { standing: "configured-unavailable", ready: false,
    message: "<script>bad()</script>", action: "Use <saved> credentials." } }), "braidy");
  check(!escaped.includes("<script>bad()") && escaped.includes("&lt;script&gt;"), "Provider diagnostic text is escaped");
  const remote = await panel({ text: { standing: "ready", ready: true } });
  check(remote.includes("How Braidy connects") && remote.includes("Local / custom endpoint"), "Connection groups preserve local discoverability");
  check(remote.includes("on this computer, your network, or a remote service"), "Compatible endpoints may be remote");
  check(!remote.includes("Runs on hardware you control") && !remote.includes("Ollama&#39;s own API on this machine"),
    "Selecting an adapter makes no unsupported hardware or locality claim");
  const ollama = await panel({ text: { standing: "ready", ready: true } },
    { assistant: { provider: "ollama", visionProvider: "same" }, ollamaUrl: "http://192.0.2.10:11434" });
  check(ollama.includes("own API at the saved endpoint"), "Ollama wording also permits a network endpoint");
  for (const id of ["assistant-vision-provider", "cfg-continuity-provider", "cfg-continuity-base", "cfg-continuity-model"])
    check(remote.includes(`id="${id}"`), `Existing saved field ${id} is retained`);
  check(remote.includes('onclick="saveConfig(\'assistant\')"') && remote.includes('onclick="testAssistantConnection()"'),
    "Save and deliberate test continue to use their existing actions");
  console.log(`Assistant capability presentation passed ${checks} checks; provider calls: 0.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => workspace.cleanup());

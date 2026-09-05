/* Settings → Integrations → Local ComfyUI: connection, workflow list, mapping editor.
 *
 * Kept beside public/settings.js rather than inside it because this panel does one
 * thing the other Settings panels do not: it reads a folder of files CineBraid does not
 * own, and it has to say something true and specific about each one. That is a screen's
 * worth of state — format, hash, mapping, staleness — and none of it belongs in a file
 * whose job is to collect form fields and save them.
 *
 * WHAT THIS FILE MAY NOT DO, and does not.
 *
 * It never decides a mapping. CineBraid's suggestions arrive from the server already
 * ranked and already carrying their evidence, and this file renders them as PRE-SELECTED
 * OPTIONS IN A CONTROL A PERSON MUST SAVE. Nothing is written until Save is pressed, and
 * the server mints the confirmation stamp — so a suggestion that is never saved has no
 * storage anywhere, which is what makes "a suggestion silently became a confirmation"
 * impossible rather than merely unlikely.
 *
 * It never names a filesystem path of its own. A workflow is addressed by its place
 * inside the configured folder, and the server re-derives and re-contains that on every
 * request.
 */

/* The vocabulary a filmmaker reads. One sentence per state, and each one says what to
   do next rather than only what is wrong. */
const COMFY_STATE_WORDS = {
  ready: { tone: "ready", label: "Ready", detail: "" },
  changed: { tone: "attention", label: "Workflow changed — review mappings", detail: "This file changed since its inputs were confirmed. Every confirmed input still fits, so it can still run." },
  broken: { tone: "attention", label: "Needs attention", detail: "" },
  unmapped: { tone: "off", label: "Not set up", detail: "" },
  "not-executable": { tone: "off", label: "Not runnable", detail: "" },
  unreadable: { tone: "attention", label: "Unreadable", detail: "" },
};

function comfyStateWords(state) {
  return COMFY_STATE_WORDS[String(state || "")] || { tone: "off", label: String(state || "Unknown"), detail: "" };
}

function comfyChip(id, tone, words) {
  const node = document.getElementById(id);
  if (!node) return;
  node.dataset.tone = tone;
  node.textContent = words;
}

window.testComfyConnection = async () => {
  comfyChip("comfy-test-note", "checking", "Checking…");
  try {
    const response = await fetch("/api/generation/comfy/test", { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "CineBraid could not reach ComfyUI.");
    if (!data.connected) {
      comfyChip("comfy-test-note", "attention", data.reason || "CineBraid could not reach ComfyUI.");
      toast("ComfyUI did not answer");
    } else {
      const where = [data.version ? `ComfyUI ${data.version}` : "ComfyUI", data.device].filter(Boolean).join(" · ");
      comfyChip("comfy-test-note", "ready", `Connected — ${where}`);
      toast("ComfyUI is connected");
    }
  } catch (error) {
    comfyChip("comfy-test-note", "attention", error.message || "CineBraid could not reach ComfyUI.");
    toast("ComfyUI did not answer");
  }
  refreshComfyWorkflowList();
};

/* ---------------------------------------------------------------------------
   The workflow list.

   Every file in the folder appears, including the ones that cannot run. A folder that
   silently listed only the four workflows CineBraid happens to support would leave a
   filmmaker looking for the other sixty and finding nothing — and the reason those
   sixty are missing is the single most useful thing this screen can say. */
window.refreshComfyWorkflowList = async () => {
  const host = document.getElementById("comfy-workflow-list");
  if (!host) return;
  host.dataset.state = "loading";
  host.innerHTML = `<p class="hint">Reading the workflow folder…</p>`;
  let data;
  try {
    const response = await fetch("/api/generation/comfy/workflows");
    data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "CineBraid could not read the workflow folder.");
  } catch (error) {
    host.dataset.state = "error";
    host.innerHTML = `<p class="hint comfy-workflow-problem">${esc(error.message || "CineBraid could not read the workflow folder.")}</p>`;
    return;
  }
  if (!data.configured) {
    host.dataset.state = "unconfigured";
    host.innerHTML = `<p class="hint">Set a workflow folder above and save, then this list shows what is in it.</p>`;
    return;
  }
  const rows = Array.isArray(data.workflows) ? data.workflows : [];
  if (!rows.length) {
    host.dataset.state = "empty";
    host.innerHTML = `<p class="hint">${esc(data.folder)} holds no .json workflow files.</p>`;
    return;
  }
  host.dataset.state = "listed";
  const runnable = rows.filter((row) => row.executable).length;
  host.innerHTML = `<p class="hint comfy-workflow-summary">${esc(`${rows.length} file${rows.length === 1 ? "" : "s"} in ${data.folder} · ${runnable} CineBraid can run`)}${data.truncated ? " · list truncated" : ""}</p>
    <ul class="comfy-workflow-rows">${rows.map(comfyWorkflowRow).join("")}</ul>`;
};

function comfyWorkflowRow(row) {
  const words = comfyStateWords(row.state);
  const detail = String(row.reason || words.detail || "");
  const action = String(row.action || "");
  /* A file CineBraid cannot run gets no Set up button. Offering one that opens an
     editor which then refuses would be a worse answer than the sentence beside it. */
  const control = row.executable
    ? `<button class="ghost-btn" onclick="openComfyMappingEditor('${attr(row.relativePath)}')">${row.registered ? "Review inputs" : "Set up inputs"}</button>`
    : "";
  const forget = row.registered
    ? `<button class="ghost-btn" onclick="forgetComfyWorkflow('${attr(row.relativePath)}')">Remove</button>`
    : "";
  return `<li class="comfy-workflow-row" data-workflow="${attr(row.relativePath)}" data-state="${attr(row.state)}" data-format="${attr(row.format)}">
    <div class="comfy-workflow-identity"><b>${esc(row.relativePath)}</b><span class="settings-state-chip" data-tone="${attr(words.tone)}">${esc(words.label)}</span></div>
    ${detail ? `<p class="hint comfy-workflow-problem">${esc(detail)}</p>` : ""}
    ${action ? `<p class="hint comfy-workflow-action">${esc(action)}</p>` : ""}
    ${Array.isArray(row.problems) && row.problems.length ? `<ul class="comfy-workflow-problems">${row.problems.map((problem) => `<li>${esc(problem.message)}${problem.action ? ` <em>${esc(problem.action)}</em>` : ""}</li>`).join("")}</ul>` : ""}
    <div class="comfy-workflow-actions">${control}${forget}</div>
  </li>`;
}

window.forgetComfyWorkflow = async (relativePath) => {
  try {
    const response = await fetch("/api/generation/comfy/workflow/forget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relativePath: String(relativePath || "") }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not remove that workflow's setup.");
    toast("Workflow setup removed");
  } catch (error) {
    toast(error.message || "Could not remove that workflow's setup.");
  }
  refreshComfyWorkflowList();
};

/* ---------------------------------------------------------------------------
   The mapping editor.

   One row per production input, each a single dropdown over EVERY settable input in the
   graph. The dropdown is pre-selected from CineBraid's suggestion when there is one, and
   the reason is printed beside it in the suggestion's own words — "because node title
   'Negative Prompt'" — so the filmmaker is agreeing to something they can check rather
   than accepting a default they cannot see the basis for.

   A confirmed binding wins over a suggestion. Re-opening the editor on a workflow that
   is already set up must show what was agreed, not what CineBraid would guess today. */
let COMFY_MAPPING_WORKFLOW = null;

window.openComfyMappingEditor = async (relativePath) => {
  let data;
  try {
    const response = await fetch("/api/generation/comfy/workflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relativePath: String(relativePath || "") }),
    });
    data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "CineBraid could not read that workflow.");
  } catch (error) {
    return toast(error.message || "CineBraid could not read that workflow.");
  }
  COMFY_MAPPING_WORKFLOW = data;
  openModal(comfyMappingMarkup(data));
};

/* The semantic inputs, in the order a filmmaker thinks about them. Mirrors
   comfy-workflow.js's COMFY_SEMANTIC_INPUTS; the server is the authority and refuses
   anything this list gets wrong. */
const COMFY_EDITOR_INPUTS = [
  ["positivePrompt", "Positive Prompt", "The shot's prompt goes here. Required."],
  ["negativePrompt", "Negative Prompt", "What the shot must not contain. Leave unset to keep the workflow's own."],
  ["startImage", "Start Image", "An approved CineBraid image the workflow starts from."],
  ["endImage", "End Image", "An approved CineBraid image the workflow ends on."],
  ["referenceImage", "Reference Image", "An approved CineBraid image the workflow refers to."],
  ["seed", "Seed", "The number that makes a render repeatable."],
];

function comfyMappingMarkup(data) {
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const suggestions = data.suggestions || {};
  const bindings = data.bindings || {};
  const options = [];
  for (const node of nodes)
    for (const input of node.inputs) {
      if (input.linked) continue;
      const title = node.title ? `${node.title} · ` : "";
      options.push({
        value: `${node.nodeId}::${input.name}`,
        label: `${title}${node.classType} (node ${node.nodeId}) — ${input.name}${input.preview ? ` = ${input.preview}` : ""}`,
        valueType: input.valueType,
      });
    }

  const row = ([key, label, help]) => {
    const confirmed = bindings[key];
    const suggested = Array.isArray(suggestions[key]) ? suggestions[key][0] : null;
    const chosen = confirmed
      ? `${confirmed.nodeId}::${confirmed.input}`
      : suggested ? `${suggested.nodeId}::${suggested.input}` : "";
    /* WHY THIS VALUE IS PRE-SELECTED, in one sentence, always. A pre-filled control with
       no stated basis is CineBraid quietly deciding. */
    const basis = confirmed
      ? `You confirmed this${confirmed.confirmedAt ? ` on ${esc(String(confirmed.confirmedAt).slice(0, 10))}` : ""}.`
      : suggested ? `CineBraid suggests this because of the ${esc(suggested.because)}. Nothing is saved until you press Save.`
        : "";
    return `<div class="comfy-map-row" data-input="${attr(key)}">
      <label for="comfy-map-${attr(key)}"><b>${esc(label)}</b><small>${esc(help)}</small></label>
      <select id="comfy-map-${attr(key)}" data-comfy-map="${attr(key)}">
        <option value="">Not used by this workflow</option>
        ${options.map((option) => `<option value="${attr(option.value)}" ${option.value === chosen ? "selected" : ""}>${esc(option.label)}</option>`).join("")}
      </select>
      ${basis ? `<p class="hint comfy-map-basis" data-basis="${confirmed ? "confirmed" : "suggested"}">${basis}</p>` : ""}
    </div>`;
  };

  const words = comfyStateWords(data.state);
  return `<h3>${esc(data.relativePath)}</h3>
    <p class="modal-confirm-message">Tell CineBraid which node input carries each part of a shot. Nothing is saved until you press Save, and CineBraid never changes your workflow file.</p>
    <div class="candidate-evidence-facts">
      <article><span>State</span><b>${esc(words.label)}</b></article>
      <article><span>Nodes</span><b>${esc(String(data.nodeCount))}</b></article>
      <article><span>Format</span><b>API workflow</b></article>
      <article><span>File fingerprint</span><b>${esc(String(data.contentHash || "").replace("sha256:", "").slice(0, 12))}</b></article>
    </div>
    ${data.state === "changed" ? `<p class="hint comfy-workflow-problem">Workflow changed — review mappings. ${esc(String(data.reason || ""))}</p>` : ""}
    ${Array.isArray(data.problems) && data.problems.length ? `<ul class="comfy-workflow-problems">${data.problems.map((problem) => `<li>${esc(problem.message)}${problem.action ? ` <em>${esc(problem.action)}</em>` : ""}</li>`).join("")}</ul>` : ""}
    ${!data.outputNodes || !data.outputNodes.length ? `<p class="hint comfy-workflow-problem">CineBraid did not recognise a node in this workflow that saves a picture. It will still run it, but if nothing is saved there will be no result to bring back.</p>` : ""}
    <div class="comfy-map-rows">${COMFY_EDITOR_INPUTS.map(row).join("")}</div>
    <div class="modal-actions">
      <button class="cancel" onclick="closeModal()">Cancel</button>
      <button class="approve-btn" onclick="saveComfyMapping()">Save inputs</button>
    </div>`;
}

/* THE ONLY THING THAT ASKS THE SERVER TO CONFIRM. It reads the controls a person just
   looked at and posts them; the server stamps the confirmation and validates it against
   the file's current bytes. */
window.saveComfyMapping = async () => {
  const workflow = COMFY_MAPPING_WORKFLOW;
  if (!workflow) return;
  const bindings = {};
  for (const [key] of COMFY_EDITOR_INPUTS) {
    const control = document.getElementById(`comfy-map-${key}`);
    const value = String(control?.value || "");
    if (!value) continue;
    const [nodeId, input] = value.split("::");
    bindings[key] = { nodeId, input };
  }
  try {
    const response = await fetch("/api/generation/comfy/workflow/mapping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relativePath: workflow.relativePath, bindings }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "CineBraid could not save those inputs.");
    closeModal();
    toast("Workflow inputs saved");
  } catch (error) {
    return toast(error.message || "CineBraid could not save those inputs.");
  }
  refreshComfyWorkflowList();
};

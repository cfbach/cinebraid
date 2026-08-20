const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { render, buildFixture, withFixtureCanon, withCanon } = require("./render-harness");

const ROOT = path.resolve(__dirname, "..");
const SAMPLE = JSON.parse(fs.readFileSync(path.join(ROOT, "projects", "cinebraid-sample", "project.json"), "utf8"));
const SAMPLE_SCAN = {
  anchors: ["CHAR-COURIER-FRONT.png", "CHAR-COURIER-PROFILE.png"].map((name) => ({ name, url: `/assets/anchors/${name}` })),
  plates: ["LOC-PLATFORM-MASTER.png", "LOC-PLATFORM-REVERSE.png"].map((name) => ({ name, url: `/assets/plates/${name}` })),
  props: ["PROP-PARCEL-CLOSED.png", "PROP-PARCEL-OPEN.png"].map((name) => ({ name, url: `/assets/props/${name}` })),
  vehicles: [], audio: [], media: [],
  shots: {
    "SAMPLE-01": { takes: [{ name: "SAMPLE-01-ARRIVAL.png", url: "/assets/shots/SAMPLE-01/takes/SAMPLE-01-ARRIVAL.png" }], locked: [], blocking: [] },
    "SAMPLE-02": { takes: [{ name: "SAMPLE-02-BENCH.png", url: "/assets/shots/SAMPLE-02/takes/SAMPLE-02-BENCH.png" }], locked: [], blocking: [] },
    "SAMPLE-03": { takes: [{ name: "SAMPLE-03-OPEN.png", url: "/assets/shots/SAMPLE-03/takes/SAMPLE-03-OPEN.png" }], locked: [], blocking: [{ name: "SAMPLE-03-BLOCKING.png", url: "/assets/shots/SAMPLE-03/blocking/SAMPLE-03-BLOCKING.png" }] },
  },
};

// Deliberate contract: these actions may exist in the DOM under a closed optional
// disclosure, but they must never be default-visible in a manual-first project.
const ASSISTED_ONLY = [
  /^Build prompt$/i,
  /^Rebuild prompt$/i,
  /^Build state prompt$/i,
  /^Improve$/i,
  /^Plan automation$/i,
  /^Automate full shot$/i,
  /^Review blocking attempts$/i,
  /^AI review & recommend$/i,
  /^Review scene continuity$/i,
  /^Automate entire scene$/i,
  /^Start still automation$/i,
  /^Generate(?:\s|$)/i,
  /^Automate(?:\s|$)/i,
  /^Review all visible$/i,
  /^Review unreviewed$/i,
  /^Re-review all$/i,
  /^Map for optional AI check$/i,
];

function disabledAgents() {
  const unavailable = (label) => ({ ready: false, label, provider: "none", model: "", message: `${label} is disabled.`, action: "" });
  return {
    enabled: false,
    manualMode: true,
    capabilities: {
      text: unavailable("Text assistance"),
      verifier: unavailable("Prompt verification"),
      vision: unavailable("Vision assistance"),
      embedding: unavailable("Semantic search"),
      technical: unavailable("Technical analysis"),
    },
    agents: [],
  };
}

function visibleButtonLabels(html) {
  const labels = [];
  const details = [];
  const token = /<details\b[^>]*>|<\/details\s*>|<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  let match;
  while ((match = token.exec(html))) {
    const raw = match[0];
    if (/^<details/i.test(raw)) {
      details.push(/\sopen(?:\s|>|=)/i.test(raw));
      continue;
    }
    if (/^<\/details/i.test(raw)) {
      details.pop();
      continue;
    }
    if (details.some((open) => !open)) continue;
    const attrs = match[1] || "";
    if (/\sdisabled(?:\s|>|=)/i.test(attrs) || /aria-hidden=["']true/i.test(attrs)) continue;
    const label = (attrs.match(/aria-label=["']([^"']+)["']/i)?.[1] || match[2] || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&(?:#\d+|#x[0-9a-f]+|[a-z]+);/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (label) labels.push(label);
  }
  return labels;
}

function assistedViolations(labels) {
  return labels.filter((label) => ASSISTED_ONLY.some((pattern) => pattern.test(label)));
}
function allButtonLabels(html) {
  return [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)].map((match) => match[1]
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:#\d+|#x[0-9a-f]+|[a-z]+);/gi, " ")
    .replace(/\s+/g, " ")
    .trim()).filter(Boolean);
}

function withHistory(source) {
  const project = structuredClone(source);
  project.meta.workflowEmphasis = "manual";
  const shot = project.shots.find((row) => row.id === "SAMPLE-03") || project.shots[0];
  shot.creationBrief = shot.creationBrief || {};
  shot.creationBrief.promptBuilds = [{
    id: "sample-frame-build",
    profileId: "gpt-image-2/t2i",
    profileName: "GPT Image 2",
    prompt: "Archived sample prompt build.",
    date: "2026-07-31T12:00:00Z",
  }];
  shot.creationBrief.blockingBuilds = [{
    id: "sample-blocking-build",
    profileId: "gpt-image-2/blocking",
    profileName: "Blocking",
    prompt: "Archived blocking prompt.",
    date: "2026-07-31T12:00:00Z",
  }];
  shot.creationBrief.motionPromptBuilds = [{
    id: "sample-motion-build",
    profileId: "seedance-2/i2v",
    profileName: "Seedance 2",
    prompt: "Archived motion prompt.",
    date: "2026-07-31T12:00:00Z",
  }];
  const prop = project.props?.[0];
  const state = prop?.continuityStates?.find((row) => !row.isDefault) || prop?.continuityStates?.[0];
  if (state) state.assetPromptBuilds = [{ id: "sample-state-build", profileId: "gpt-image-2/edit", profileName: "GPT Image 2 — Edit", prompt: "Archived state prompt.", date: "2026-07-31T12:00:00Z" }];
  return project;
}

const ROUTES = [
  { name: "production", hash: "#/production" },
  { name: "create", hash: "#/create" },
  { name: "shot board", hash: "#/shots/board" },
  { name: "scene list", hash: "#/shots/scenes" },
  { name: "scene", hash: "#/scene/SC-SAMPLE" },
  { name: "shot inputs", hash: "#/shot/SAMPLE-03", storage: { "cinebraid-focused:fixture:shot-task:SAMPLE-03": "inputs" } },
  { name: "shot look", hash: "#/shot/SAMPLE-03", storage: { "cinebraid-focused:fixture:shot-task:SAMPLE-03": "look", "cinebraid-guided-panel:fixture:SAMPLE-03:blocking": "1" } },
  { name: "shot frames", hash: "#/shot/SAMPLE-03", storage: { "cinebraid-focused:fixture:shot-task:SAMPLE-03": "frames" } },
  { name: "shot motion", hash: "#/shot/SAMPLE-02", storage: { "cinebraid-focused:fixture:shot-task:SAMPLE-02": "motion", "cinebraid-guided-panel:fixture:SAMPLE-02:motion": "1" } },
  { name: "shot deliver", hash: "#/shot/SAMPLE-02", storage: { "cinebraid-focused:fixture:shot-task:SAMPLE-02": "deliver", "cinebraid-guided-panel:fixture:SAMPLE-02:finish": "1" } },
  { name: "library", hash: "#/library" },
  { name: "approved library", hash: "#/library/approved" },
  { name: "character", hash: "#/character/CHAR-COURIER" },
  { name: "location coverage", hash: "#/location/LOC-PLATFORM", storage: { "cinebraid-focused:fixture:entity-task:locations:LOC-PLATFORM": "coverage" } },
  { name: "prop states", hash: "#/prop/PROP-PARCEL", storage: { "cinebraid-focused:fixture:entity-task:props:PROP-PARCEL": "states", "cinebraid-bounded:fixture:selected:entity-coverage-view:props:PROP-PARCEL": "states", "cinebraid-bounded:fixture:selected:continuity-state:props:PROP-PARCEL": "state-open" } },
  { name: "reports", hash: "#/reports" },
  { name: "settings", hash: "#/settings" },
];

async function renderSet(project, emphasis) {
  const rows = [];
  for (const spec of ROUTES) {
    /* THE SHIPPED SAMPLE IS LEGACY DATA — pointers, no receipts — and this suite
       is about which CONTROLS each workflow emphasis exposes, not about whether
       the sample has been approved. Motion and delivery are canon-gated since
       the closure pass, so the in-memory copy carries the receipts a creator
       who had approved those frames would have left. The file on disk is not
       touched; `structuredClone` above is the copy this stamps. */
    const copy = withFixtureCanon(structuredClone(project));
    /* The Motion parity row is about assisted-control exposure, so it declares an
       image-to-video route and carries the receipt-backed inputs that make that route
       canonically available. Other rows retain the legacy sample unchanged. */
    if (spec.name === "shot motion") {
      const motionShot = copy.shots.find((row) => row.id === "SAMPLE-02");
      motionShot.deliveryRoute = "i2v";
      motionShot.creationBrief = { ...(motionShot.creationBrief || {}), deliveryIntent: "motion" };
      withCanon(copy, [
        { kind: "entity-state", list: "characters", entityId: "CHAR-COURIER", stateId: "state-default", value: "CHAR-COURIER-FRONT.png" },
        { kind: "entity-state", list: "locations", entityId: "LOC-PLATFORM", stateId: "state-default", value: "LOC-PLATFORM-MASTER.png" },
        { kind: "entity-state", list: "props", entityId: "PROP-PARCEL", stateId: "state-closed", value: "PROP-PARCEL-CLOSED.png" },
      ]);
    }
    copy.meta.workflowEmphasis = emphasis;
    copy.mediaAssets = Array.isArray(copy.mediaAssets) ? copy.mediaAssets : [];
    if (!copy.mediaAssets.some((asset) => asset.id === "manual-parity-blocking")) copy.mediaAssets.push({
      id: "manual-parity-blocking",
      file: "SAMPLE-03-BLOCKING.png",
      storagePath: "shots/SAMPLE-03/blocking/SAMPLE-03-BLOCKING.png",
      title: "Sample blocking attempt",
      kind: "image",
      notes: "Synthetic blocking attempt for manual/assisted parity coverage.",
      links: [{ id: "manual-parity-blocking-link", targetType: "shot", targetId: "SAMPLE-03", role: "blocking-frame", blockingState: "returned", generationInput: false, order: 1 }],
    });
    const rendered = await render(spec.hash, copy, { storage: spec.storage || {}, scan: SAMPLE_SCAN, agentStatus: disabledAgents() });
    const labels = visibleButtonLabels(rendered.html);
    rows.push({ route: spec.name, labels, allLabels: allButtonLabels(rendered.html), violations: assistedViolations(labels) });
  }
  return rows;
}

async function main() {
  const fixture = buildFixture();
  fixture.meta.workflowEmphasis = "manual";
  const described = fixture.shots[0];
  for (const frame of described.keyframes || []) frame.winner = "";
  const stateRender = await render("#/shot/L1-01", fixture, { storage: { "cinebraid-focused:fixture:shot-task:L1-01": "frames" }, agentStatus: disabledAgents() });
  assert(stateRender.html.includes("Add existing image"), "manual next-action engine must request existing-image intake");
  assert(!stateRender.html.includes("<small>Build prompt</small>"), "manual frame summary must not instruct the user to build a prompt");
  fixture.meta.workflowEmphasis = "assisted";
  const assistedState = await render("#/shot/L1-01", fixture, { storage: { "cinebraid-focused:fixture:shot-task:L1-01": "frames" }, agentStatus: disabledAgents() });
  assert(assistedState.html.includes("<small>Build prompt</small>"), "assisted next-action engine must retain Build prompt");

  for (const dataset of [{ name: "sample", project: SAMPLE }, { name: "sample-with-history", project: withHistory(SAMPLE) }]) {
    const manual = await renderSet(dataset.project, "manual");
    for (const row of manual) assert.deepStrictEqual(row.violations, [], `${dataset.name} ${row.route} exposed assisted-only controls: ${row.violations.join(", ")}`);
    const assisted = await renderSet(dataset.project, "assisted");
    const assistedFrame = assisted.find((row) => row.route === "shot frames");
    const assistedLook = assisted.find((row) => row.route === "shot look");
    const assistedMotion = assisted.find((row) => row.route === "shot motion");
    assert(assistedFrame.allLabels.some((label) => /^Build prompt$/i.test(label)), "assisted frames must retain Build prompt");
    assert(assistedFrame.allLabels.some((label) => /^Improve$/i.test(label)), "assisted frames must retain Improve");
    assert(assistedFrame.allLabels.some((label) => /^Automate full shot$/i.test(label)), "assisted frames must expose full-shot automation");
    assert(assistedLook.allLabels.some((label) => /^(?:Rebuild|Build) prompt$/i.test(label)), "assisted blocking must retain prompt building");
    assert(assistedLook.allLabels.some((label) => /^(?:Review blocking attempts|AI review & recommend|Review all with AI|Review all again)$/i.test(label)), "assisted blocking must expose blocking review");
    assert(assistedMotion.allLabels.some((label) => /^Build prompt$/i.test(label)), "assisted motion must retain Build prompt");
    if (dataset.name.includes("history")) {
      const manualFrame = manual.find((row) => row.route === "shot frames");
      const manualLook = manual.find((row) => row.route === "shot look");
      assert(!manualFrame.labels.some((label) => /^Build prompt$/i.test(label)), "prior frame prompt history must not reopen manual tools");
      assert(!manualLook.labels.some((label) => /^(?:Rebuild|Build) prompt$/i.test(label)), "prior blocking history must not reopen manual tools");
    }
    console.log(`${dataset.name}: ${manual.map((row) => `${row.route}=${row.labels.length}`).join(" | ")}`);
  }

  const manualSettings = await render("#/settings", { ...structuredClone(SAMPLE), meta: { ...SAMPLE.meta, workflowEmphasis: "manual" } }, { agentStatus: disabledAgents() });
  assert(manualSettings.html.includes("OPTIONAL ASSISTED SERVICES"), "manual settings must group Assistant and Generation as optional services");
  const manualBoard = await render("#/shots/board", { ...structuredClone(SAMPLE), meta: { ...SAMPLE.meta, workflowEmphasis: "manual" } }, { agentStatus: disabledAgents() });
  assert(manualBoard.html.includes("Ready for media"), "manual shot board vocabulary must describe media intake");
  const assistedBoard = await render("#/shots/board", { ...structuredClone(SAMPLE), meta: { ...SAMPLE.meta, workflowEmphasis: "assisted" } }, { agentStatus: disabledAgents() });
  assert(assistedBoard.html.includes("Ready to generate"), "assisted shot board vocabulary must remain unchanged");

  console.log("Manual-first parity suite passed every primary route, all five shot tasks, scene and coverage workspaces, the deliver panel, Settings grouping, history-bearing projects, and complementary assisted-emphasis capability checks.");
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });

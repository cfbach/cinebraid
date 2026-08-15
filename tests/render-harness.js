const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { readConfig } = require("../config");
const PromptEngine = require("../prompt-engine");
const { annotateProfileLibraryExecution } = require("../generation-options");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const SCRIPT_ORDER = [
  "shared-entities.js",
  "shared-continuity-binding.js",
  "shared-frame-presence.js",
  "shared-state-lineage.js",
  "shared-entity-slots.js",
  "shared-continuity.js",
  "shared-voice.js",
  "shared-camera.js",
  "shared-aspect.js",
  "shared-reference-views.js",
  "shared-coverage.js",
  "shared-entity-ownership.js",
  "shared-media-disposition.js",
  "shared-production-media.js",
  "shared-authority-kernel.js",
  "shared-production-authority.js",
  "shared-build-history.js",
  "shared-generation-capability.js",
  "shared-stage-model.js",
  "bounded-rendering.js",
  "app.js",
  "media.js",
  "review-provenance.js",
  "views.js",
  "planning.js",
  "entities.js",
  "mutations.js",
  "settings.js",
  "library-tools.js",
  "review.js",
  "scene-review.js",
  "creation-studio.js",
  "continuity-workspace.js",
  "fal-generation.js",
  "coverage-automation.js",
  "automation.js",
  "scene-automation.js",
  "live-activity.js",
  "reports.js",
  "audio-prompt-builder.js",
  "v607-composer.js",
  "motion-sound-composer.js",
  /* O5. The Inspector and the Generated Media destination both render into `#main`
     (the destination) or into the shipped modal (the Inspector), so this harness has
     to load them to exercise either. */
  "media-inspector.js",
  "media-results.js",
  "bootstrap.js",
];

class FakeClassList {
  constructor() {
    this.values = new Set();
  }
  add(...names) {
    names.forEach((name) => this.values.add(name));
  }
  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }
  toggle(name, force) {
    if (force === true) {
      this.values.add(name);
      return true;
    }
    if (force === false) {
      this.values.delete(name);
      return false;
    }
    if (this.values.has(name)) {
      this.values.delete(name);
      return false;
    }
    this.values.add(name);
    return true;
  }
  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.innerHTML = "";
    this.textContent = "";
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.dataset = {};
    this.style = {};
    this.classList = new FakeClassList();
    this.children = [];
    this.files = [];
    this.tagName = "DIV";
  }
  addEventListener() {}
  removeEventListener() {}
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  remove() {}
  focus() {}
  blur() {}
  click() {}
  closest() {
    return this;
  }
  querySelector(selector) {
    /* Stable so callers that write into a child (the save-state label) can be observed. */
    if (selector === "span:last-child") {
      this._lastSpan = this._lastSpan || new FakeElement();
      return this._lastSpan;
    }
    return null;
  }
  scrollIntoView() {}
  querySelectorAll() {
    return [];
  }
  setAttribute(name, value) {
    this[name] = value;
  }
}

function buildFixture() {
  return {
    meta: {
      title: "Render Harness Project",
      format: "Short film",
      version: "test",
      hubVersion: "v5.5.0",
      aiPolicy: "project-default",
      models: [],
      defaults: { stillModel: "", videoModel: "" },
      promptDefaults: {
        imageProfile: "gpt-image-2/t2i",
        videoProfile: "seedance-2/i2v",
      },
      world: { setting: "Industrial station", include: "", reject: "" },
      styleBlocks: [],
      refSyntax: "@imageN",
    },
    qcChecklist: ["Identity", "Geometry", "Tone", "Continuity", "Text"],
    scenes: [
      {
        id: "SC-01",
        title: "Maintenance Bay",
        tier: "A",
        whatHappens: "A worker checks the hull.",
        howItFeels: "Quiet and procedural.",
      },
    ],
    shots: [
      {
        id: "L1-01",
        scene: "SC-01",
        title: "Hull check",
        desc: "A worker checks the hull and moves away.",
        positioning: "Locked wide composition.",
        workflowStatus: "IN PROGRESS",
        status: "BUILT",
        reviewStatus: "PENDING",
        characters: ["KAI"],
        codes: ["LOC-HULL", "PR-TOOL"],
        risks: [],
        notes: "",
        keyframes: [
          {
            id: "frame-a",
            label: "A",
            title: "Opening frame",
            winner: "FRAME_A.png",
            description: "Worker at panel.",
            required: true,
            generationPackages: [],
          },
          {
            id: "frame-b",
            label: "B",
            title: "Ending frame",
            winner: "FRAME_B.png",
            description: "Worker leaving.",
            required: true,
            generationPackages: [],
          },
        ],
        clips: [
          {
            id: "motion-a",
            label: "A",
            suffix: "a",
            title: "Panel check",
            kind: "i2v",
            fromFrame: "frame-a",
            toFrame: "",
            dur: 5,
            motionPrompt: "He checks the panel.",
            generationPackages: [],
          },
          {
            id: "motion-b",
            label: "B",
            suffix: "b",
            title: "Move away",
            kind: "flf",
            fromFrame: "frame-a",
            toFrame: "frame-b",
            dur: 4,
            motionPrompt: "He steps away from the panel.",
            generationPackages: [],
          },
        ],
        promptBuilds: [],
        promptOptions: [],
      },
    ],
    characters: [
      {
        id: "KAI",
        name: "Kai",
        status: "APPROVED",
        workflowStatus: "APPROVED",
        block: "Maintenance worker.",
        approvedFile: "KAI-ANCHOR.png",
        continuityStates: [],
      },
    ],
    locations: [
      {
        id: "LOC-HULL",
        name: "Hull exterior",
        status: "APPROVED",
        workflowStatus: "APPROVED",
        notes: "Docking camera.",
        approvedFile: "LOC-HULL-PLATE.png",
        continuityStates: [],
      },
    ],
    props: [
      {
        id: "PR-TOOL",
        name: "Panel tool",
        status: "APPROVED",
        workflowStatus: "APPROVED",
        notes: "Handheld maintenance tool.",
        approvedFile: "PR-TOOL-PLATE.png",
        continuityStates: [],
      },
    ],
    vehicles: [
      {
        id: "VEH-CART",
        name: "Maintenance cart",
        status: "IN PROGRESS",
        workflowStatus: "IN PROGRESS",
        notes: "Compact service cart.",
        creationDescription: "Compact industrial maintenance cart with a blunt cab and open tool bed.",
        assetPromptBuilds: [{ id: "vehicle-build", profileId: "gpt-image-2/t2i", profileName: "GPT Image 2", prompt: "Clear production reference of the maintenance cart." }],
        approvedFile: "",
        continuityStates: [],
      },
    ],
    audio: [],
    mediaAssets: [
      {
        id: "media-animatic-a",
        file: "animatic-opening.png",
        title: "Animatic opening beat",
        originalName: "animatic-opening.png",
        links: [
          {
            id: "link-animatic-shot",
            targetType: "shot",
            targetId: "L1-01",
            role: "animatic-frame",
            beat: "start",
            timecode: "00:03.2",
            notes: "Composition guide for the opening beat.",
            agentContext: true,
            generationInput: false,
            order: 0,
          },
          {
            id: "link-animatic-prop",
            targetType: "prop",
            targetId: "PR-TOOL",
            role: "prop-reference",
            notes: "Shows the tool silhouette in the animatic.",
            agentContext: true,
            generationInput: false,
            order: 0,
          },
        ],
      },
    ],
    jobs: [],
    agentRuns: [],
    decisions: [],
    sessions: [
      {
        n: 1,
        date: "2026-07-21",
        summary: "Harness fixture.",
        carryForward: [],
      },
    ],
  };
}

function emptyFixture() {
  const project = buildFixture();
  project.meta.title = "Empty Harness Project";
  project.scenes = [];
  project.shots = [];
  project.characters = [];
  project.locations = [];
  project.props = [];
  project.vehicles = [];
  return project;
}

function scanFor(project) {
  return {
    anchors: (project.characters || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/anchors/${x.approvedFile}` })),
    plates: (project.locations || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/plates/${x.approvedFile}` })),
    props: (project.props || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/props/${x.approvedFile}` })),
    vehicles: (project.vehicles || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/vehicles/${x.approvedFile}` })),
    audio: [],
    media: (project.mediaAssets || []).map((asset) => ({
      name: asset.file,
      url: `/assets/media/${asset.file}`,
    })),
    shots: Object.fromEntries(
      project.shots.map((shot) => [
        shot.id,
        {
          takes: [
            {
              name: "FRAME_A.png",
              url: `/assets/shots/${shot.id}/takes/FRAME_A.png`,
            },
            {
              name: "FRAME_B.png",
              url: `/assets/shots/${shot.id}/takes/FRAME_B.png`,
            },
          ],
          locked: [],
        },
      ]),
    ),
  };
}

function response(data, status = 200, headers = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) =>
        normalizedHeaders[String(name || "").toLowerCase()] ||
        (String(name || "").toLowerCase() === "content-type"
          ? "application/json"
          : null),
    },
    async json() {
      return structuredClone(data);
    },
    async text() {
      return typeof data === "string" ? data : JSON.stringify(data);
    },
    async arrayBuffer() {
      return Buffer.from(
        typeof data === "string" ? data : JSON.stringify(data),
      );
    },
  };
}

function createDocument() {
  const ids = [
    "app",
    "project-title",
    "project-format",
    "topbar-project",
    "topbar-view",
    "save-state",
    "main",
    "modal",
    "toast",
    "tally",
    "rescan",
    "mobile-nav",
    "global-search",
    "production-nav-count",
    "automation-activity-toggle",
    "automation-activity-drawer",
    "project-switcher-error",
  ];
  const map = new Map(ids.map((id) => [id, new FakeElement(id)]));
  const navViews = ["production", "shots", "library", "reports", "settings"];
  const nav = navViews.map((view) => {
    const element = new FakeElement();
    element.dataset.view = view;
    element.dataset.label = view;
    return element;
  });
  const body = new FakeElement("body");
  const document = {
    body,
    activeElement: new FakeElement(),
    getElementById(id) {
      if (!map.has(id)) map.set(id, new FakeElement(id));
      return map.get(id);
    },
    querySelector(selector) {
      if (selector.startsWith("#"))
        return this.getElementById(selector.slice(1));
      const navMatch = selector.match(/^\.nav-btn\[data-view="([^"]+)"\]$/);
      if (navMatch)
        return nav.find((item) => item.dataset.view === navMatch[1]) || null;
      if (selector === ".doc-tab") return new FakeElement();
      return null;
    },
    querySelectorAll(selector) {
      if (selector === ".nav-btn[data-view]") return nav;
      return [];
    },
    createElement(tagName) {
      const element = new FakeElement();
      element.tagName = String(tagName || "div").toUpperCase();
      return element;
    },
    addEventListener() {},
  };
  return { document, map };
}

async function render(hash, project, options = {}) {
  const renderOptions = options;
  const { document, map } = createDocument();
  const storage = new Map(Object.entries(options.storage || {}));
  const localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  const location = { hash, href: `http://127.0.0.1/${hash}` };
  const config = readConfig();
  const scan = options.scan || scanFor(project);
  const readyCapability = (label) => ({
    ready: true,
    label,
    provider: "ollama",
    model: "fixture-model",
    message: `${label} is ready.`,
    action: "",
  });
  const readyAgent = (id, label) => ({
    id,
    label,
    enabled: true,
    readiness: { status: "ready", label: "READY", detail: `${label} is ready.`, action: "" },
  });
  const agentStatus = {
    enabled: true,
    manualMode: false,
    active: 0,
    queued: 0,
    maxConcurrent: 1,
    capabilities: {
      text: readyCapability("Text assistance"),
      verifier: readyCapability("Prompt verification"),
      vision: readyCapability("Vision assistance"),
      /* Its own capability, deliberately not derived from vision: the intended
         runtime has continuity ready while generic multi-image vision is not. */
      continuity: readyCapability("Continuity observation"),
      embedding: readyCapability("Local semantic search"),
      technical: readyCapability("Technical analysis"),
    },
    agents: [
      readyAgent("coordinator", "Production Coordinator"),
      readyAgent("continuity", "Continuity Inspector"),
      readyAgent("librarian", "Project Librarian"),
      readyAgent("reviewer", "Candidate Reviewer"),
      readyAgent("promptGuardian", "Prompt Guardian"),
      readyAgent("system", "System Assistant"),
    ],
    runs: [],
    index: { ready: false, stale: true },
    ...(options.agentStatus || {}),
  };
  const health = {
    assistant: { provider: "ollama", configured: true, label: "Local AI" },
    ollama: {
      ok: true,
      models: [
        "qwen3.6:35b-a3b",
        "qwen3-vl:30b-a3b-instruct",
        "qwen3-embedding:4b",
        "qwen3-coder:30b",
      ],
      plannerReady: true,
      visionReady: true,
      embeddingReady: true,
    },
    ffmpeg: { ok: true },
  };
  /* The safe AccountConnection projection, in exactly the shape the real route
     emits: no credential of any kind, and `balance.supported:false` rather than a
     zero. `localMachine` defaults true because the harness stands in for a browser
     on the CineBraid computer; a suite that wants the LAN copy overrides it. */
  const accounts = {
    accounts: [],
    providers: [{
      providerId: "civitai",
      label: "Civitai",
      supportsOAuth: true,
      supportsApiKey: true,
      balanceSupported: false,
      oauthConfigured: true,
    }],
    localMachine: true,
    ...(options.accounts || {}),
  };

  async function fetchStub(input, options = {}) {
    const url = String(input);
    if (typeof renderOptions.fetch === "function") {
      const custom = await renderOptions.fetch(url, options, response);
      if (custom) return custom;
    }
    if (url === "/api/project")
      return response(project, 200, { "x-cinebraid-project-slug": "fixture" });
    if (url === "/api/scan") return response(scan);
    if (url === "/api/prompt/profiles")
      /* Annotated exactly as the route annotates it, so a rendered page sees the same
         dispatchability the running server serves rather than a bare catalogue. */
      return response(annotateProfileLibraryExecution(PromptEngine.profileLibrary()));
    if (url === "/api/config") return response(config);
    if (url === "/api/accounts") return response(accounts);
    if (url === "/api/agents/status") return response(agentStatus);
    if (url === "/api/system/health") return response(health);
    if (url === "/api/docs") return response([]);
    if (url === "/api/projects")
      return response({ active: "fixture", projects: [] });
    if (options.method === "PUT" || options.method === "POST")
      return response({ ok: true });
    return response({});
  }

  const context = {
    AbortController,
    Blob,
    Buffer,
    URL,
    URLSearchParams,
    clearInterval: () => {},
    clearTimeout,
    confirm: () => false,
    console,
    document,
    fetch: fetchStub,
    FileReader: class {
      readAsText() {}
    },
    Intl,
    localStorage,
    location,
    navigator: { userAgent: "CineBraid render harness" },
    setInterval: () => 0,
    setTimeout,
    structuredClone,
  };
  context.window = context;
  context.window.addEventListener = () => {};
  context.window.removeEventListener = () => {};
  context.window.location = location;
  context.window.localStorage = localStorage;
  context.window.document = document;

  vm.createContext(context);
  /* options.mutateSource lets a negative control break a guarantee IN MEMORY and
     prove the suite goes red for it. Nothing on disk is touched, so a control
     can never be "restored" by a checkout that also discards real work. */
  const mutate = typeof options.mutateSource === "function" ? options.mutateSource : null;
  for (const file of SCRIPT_ORDER) {
    const original = fs.readFileSync(path.join(PUBLIC, file), "utf8");
    const source = mutate ? String(mutate(file, original) ?? original) : original;
    vm.runInContext(source, context, { filename: file });
  }

  const deadline = Date.now() + 4000;
  while (
    !document.body.dataset.renderReady &&
    !document.body.dataset.renderError
  ) {
    if (Date.now() > deadline) throw new Error(`Timed out rendering ${hash}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (document.body.dataset.renderError && !options.allowRenderError) {
    throw new Error(`${hash}: ${document.body.dataset.renderError}`);
  }

  return { html: map.get("main").innerHTML, context, document, map };
}

async function main() {
  const fixture = buildFixture();
  const cases = [
    ["#/production", fixture, ["Production", "CONTINUE PRODUCTION", "RETURNED RESULTS"]],
    ["#/create", fixture, ["Build the first usable shot", "Set the visual rules once", "Create the first shot"]],
    ["#/shots/board", fixture, ["Shots", "Hull check", "CARD BADGES"]],
    /* The five stage labels used to be expected here because the shot workspace rendered
       the stage taskbar itself. Since O4 the navigator is built by public/stage-surfaces.js
       into the shell's persistent bar — outside `#main`, which is all this harness renders —
       so what remains expected of the workspace is its own content. The navigator's labels
       and order are asserted against the shipped renderer in tests/stage-surfaces.js and in
       a live document in tests/stage-surfaces-real-browser.py. */
    ["#/shot/L1-01", fixture, ["Hull check", "NEXT ACTION", "Shot actions", "data-selected-task="]],
    ["#/library", fixture, ["References", "Kai"]],
    ["#/prop/PR-TOOL", fixture, ["Panel tool", "UPLOAD & ORGANIZE", "Map imported references"]],
    ["#/vehicle/VEH-CART", fixture, ["Maintenance cart", "UPLOAD & ORGANIZE", "Upload reference files"]],
    ["#/reports", fixture, ["Reports", "RUN HISTORY"]],
    ["#/settings", fixture, ["Settings", "Project", "Recovery & advanced"]],
    ["#/production", emptyFixture(), ["Production", "This project has no shots"]],
    ["#/shots/board", emptyFixture(), ["Shots"]],
  ];
  for (const [hash, project, expected] of cases) {
    const { html, context } = await render(hash, project);
    for (const text of expected) assert(html.includes(text), `${hash} did not render expected text: ${text}`);
    for (const fn of ["route","productionHomeView","productionView","creationStudioView","buildGuidedFramePrompt","guidedShotWorkspaceView","projectDecisionItems"]) {
      assert.strictEqual(typeof context[fn], "function", `${fn} is not available after script load`);
    }
  }
  const reportRun = { id: "report-run-1", revision: 3, type: "shot-chain", targetId: "L1-01", scope: "stills", label: "Hull check automation", status: "completed", stage: "Completed", summary: "Approved in one round.", usage: { imagesGenerated: 3, imageRequests: 1, reviewCalls: 1 }, createdAt: "2026-07-29T20:00:00Z", updatedAt: "2026-07-29T20:02:00Z", completedAt: "2026-07-29T20:02:00Z", steps: { "frame:a:approval": { key: "frame:a:approval", kind: "frame-approval", status: "completed", label: "Frame A approved", winner: "FRAME_A.png", score: 91, result: { humanApproved: true }, completedAt: "2026-07-29T20:02:00Z" } }, logs: [{ at: "2026-07-29T20:02:00Z", tone: "success", message: "Approved." }] };
  const reportsRender = await render("#/reports/report-run-1", fixture, { fetch: async (url, options, respond) => {
    if (String(url).startsWith("/api/automation/runs?view=history")) return respond({ runs: [reportRun], page: 0, pages: 1, pageSize: 50, total: 1, targetOptions: [] });
    if (url === "/api/automation/reports/summary") return respond({ summary: { runCount: 1, totals: { imagesGenerated: 3, providerRequestsAccepted: 1 }, quality: { firstPassSuccessRate: 100, failedBeforeAcceptance: 0, failedAfterAcceptance: 0, humanApprovals: 1 }, highestEffortTargets: [{ targetId: "L1-01", label: "Hull check automation", runs: 1, highestPassUsed: 1, images: 3 }], repeatedComplaints: [], inefficientFeedback: [] } });
    if (url === "/api/automation/runs/report-run-1/report") return respond({ report: { run: reportRun, analysis: { providerRequestsAccepted: 1, highestPassUsed: 1, classification: "passed", warnings: [] }, prompts: [{ key: "frame:a:prompt", label: "Frame A prompt", prompt: "Approved prompt." }], reviews: [], referenceManifest: [], providerJobs: [] } });
    return null;
  } });
  assert(reportsRender.html.includes("RUN DETAIL"), "selected Reports routes must lazy-load full run detail inline");
  assert(reportsRender.html.includes("DOWNLOAD DIAGNOSTIC BUNDLE"), "Reports must retain diagnostic bundle export");
  assert(reportsRender.html.includes("WHERE EFFORT WENT"), "Reports must expose the project-wide effort summary");

  const stateFixture = buildFixture();
  const stateProp = stateFixture.props.find((item) => item.id === "PR-TOOL");
  stateProp.approvedFile = "PR-TOOL_PRIMARY_V001.png";
  stateProp.continuityStates = [
    { id: "state-default", name: "Default", isDefault: true, approvedFile: "PR-TOOL_PRIMARY_V001.png", notes: "Clean tool." },
    { id: "state-damaged", name: "Damaged", isDefault: false, approvedFile: "PR-TOOL_PRIMARY_DAMAGED_V001.png", appliesTo: "SC-01", notes: "Chipped grip and scratched casing.", parentStateId: "state-default", generationMode: "derive", assetPromptBuilds: [] },
  ];
  stateProp.candidateFiles = [
    { stored: "PR-TOOL-CANDIDATE-A.png", decision: "unreviewed", targetStateId: "state-damaged", targetStateName: "Damaged", derivationMode: "derive", structuredReviews: { "state-damaged": { contractVersion: "reference-authority-v3", score: 84, pass: true, stateName: "Damaged", reviewedAt: "2026-07-27T20:00:00Z" } } },
    { stored: "PR-TOOL-CANDIDATE-B.png", decision: "rejected" },
  ];
  const stateScan = scanFor(stateFixture);
  stateScan.props = [
    { name: "PR-TOOL_PRIMARY_V001.png", url: "/assets/props/PR-TOOL_PRIMARY_V001.png" },
    { name: "PR-TOOL_PRIMARY_DAMAGED_V001.png", url: "/assets/props/PR-TOOL_PRIMARY_DAMAGED_V001.png" },
    { name: "PR-TOOL-CANDIDATE-A.png", url: "/assets/props/PR-TOOL-CANDIDATE-A.png" },
    { name: "PR-TOOL-CANDIDATE-B.png", url: "/assets/props/PR-TOOL-CANDIDATE-B.png" },
  ];
  const stateApprovedRender = await render("#/prop/PR-TOOL", stateFixture, { scan: stateScan, storage: { "cinebraid-focused:fixture:entity-task:props:PR-TOOL": "approved" } });
  assert(stateApprovedRender.html.includes("APPROVED IMAGES"), "reference page must expose the compact approved-image map");
  assert(/entity-authority-status[^>]*>\s*<strong>2\/2<\/strong>\s*<span>states have an approved image<\/span>/.test(stateApprovedRender.html), "approved-image summary must report continuity coverage with separated label/value markup and correct plural agreement");
  assert(stateApprovedRender.html.includes("Default") && stateApprovedRender.html.includes("Damaged"), "approved-image summary must name both approved states");
  const stateCandidateRender = await render("#/prop/PR-TOOL", stateFixture, { scan: stateScan, storage: { "cinebraid-focused:fixture:entity-task:props:PR-TOOL": "candidates" } });
  assert(stateCandidateRender.html.includes("CHOOSE & APPROVE"), "candidate task must separate unapproved media from canon");
  assert(stateCandidateRender.html.includes("AI 84 · PASS · Damaged"), "stored state-specific vision review must appear on the candidate card");
  assert(stateCandidateRender.html.includes("AI CHECK DETAILS") || stateCandidateRender.html.includes("OPTIONAL AI CHECK"), "active entity candidates must expose optional structured vision review when vision is available");
  assert(stateCandidateRender.html.includes("Rejected candidates"), "rejected generations must collapse outside the active candidate grid");
  assert(stateCandidateRender.html.includes("CONTINUITY · DAMAGED"), "state-generated candidates must visibly name their intended approval target");
  const stateRender = await render("#/prop/PR-TOOL", stateFixture, { scan: stateScan, storage: { "cinebraid-focused:fixture:entity-task:props:PR-TOOL": "states", "cinebraid-bounded:fixture:selected:continuity-state:props:PR-TOOL": "state-damaged" } });
  assert(stateRender.html.includes("STATE REFERENCE GENERATION"), "state task must expose each continuity-state generation workflow");
  assert(stateRender.html.includes("GENERATED FOR THIS STATE") && stateRender.html.includes("Damaged candidates"), "continuity-state tab must show candidates targeted to the selected state");
  assert(stateRender.html.includes("Build state prompt"), "continuity-state workflow must expose prompt compilation");
  assert(stateRender.html.includes("DERIVE FROM DEFAULT"), "non-default continuity states should visibly derive from their approved parent");
  assert(stateRender.html.includes("Continuity-state chain"), "entity pages must expose durable continuity-state chain automation");
  assert(stateRender.html.includes("PLAN STATE CHAIN"), "entity state chains must have an explicit planning action");
  const dependencyOrder = vm.runInContext(`(() => { const e=P.props.find((item)=>item.id==='PR-TOOL'); const d=e.continuityStates.find((state)=>state.isDefault); e.approvedFile=''; d.approvedFile=''; return v626StateOrder(e,['state-damaged']); })()`, stateRender.context);
  assert(dependencyOrder.includes("state-default") && dependencyOrder.at(-1) === "state-damaged", "state-chain planning must insert an unapproved parent before a selected child");
  assert(stateRender.html.includes('data-continuity-state-id="state-damaged"'), "continuity state cards must expose a stable focus target for approve-and-continue");
  stateRender.context.approveEntityFile("props", "PR-TOOL", "PR-TOOL-CANDIDATE-A.png", "state-default");
  const entityApprovalModalHtml = stateRender.context.document.getElementById("modal").innerHTML;
  assert(entityApprovalModalHtml.includes("entity-approval-continuation"), "entity approval must expose a continuation selector");
  assert(entityApprovalModalHtml.includes("APPROVE & EDIT NEXT STATE"), "entity approval must expose the approve-and-edit action");
  stateRender.context.document.getElementById("entity-approve-file").value = "PR-TOOL-CANDIDATE-A.png";
  stateRender.context.document.getElementById("entity-approve-target").value = "state-default";
  stateRender.context.document.getElementById("entity-approve-name").value = "PR-TOOL-CANDIDATE-A.png";
  stateRender.context.document.getElementById("entity-approve-next").value = "state-damaged";
  await stateRender.context.confirmEntityApproval(true);
  const approvalContinuation = vm.runInContext(`(() => { const x=P.props.find((item)=>item.id==='PR-TOOL'); const next=x.continuityStates.find((state)=>state.id==='state-damaged'); return { approved:x.approvedFile, parent:next.parentStateId, mode:next.generationMode }; })()`, stateRender.context);
  assert.strictEqual(approvalContinuation.approved, "PR-TOOL-CANDIDATE-A.png", "approve-and-continue must approve the selected candidate");
  assert.strictEqual(approvalContinuation.parent, "state-default", "approve-and-continue must set the selected next state's parent to the approved state");
  assert.strictEqual(approvalContinuation.mode, "derive", "approve-and-continue must default the next state to parent-edit generation");

  const stateBusyRender = await render("#/prop/PR-TOOL", stateFixture, { scan: stateScan, storage: { "cinebraid-focused:fixture:entity-task:props:PR-TOOL": "states" } });
  stateBusyRender.context.setGuidedPromptOp("asset-state", "props:PR-TOOL", "state-damaged", { status: "busy", action: "improve", startedAt: Date.now() });
  await stateBusyRender.context.route();
  const stateBusyHtml = stateBusyRender.context.document.getElementById("main").innerHTML;
  assert(stateBusyHtml.includes("Improving the Damaged state prompt…"), "continuity-state Improve must show persistent progress");
  assert(stateBusyHtml.includes("Improving…"), "continuity-state Improve must expose a visible busy button label");

  for (const [routeHash, operationKey, targetLabel] of [
    ["#/character/KAI", "characters:KAI", "character"],
    ["#/location/LOC-HULL", "locations:LOC-HULL", "location"],
    ["#/prop/PR-TOOL", "props:PR-TOOL", "prop"],
    ["#/vehicle/VEH-CART", "vehicles:VEH-CART", "vehicle"],
  ]) {
    const routeParts = routeHash.split("/");
    const view = routeParts[1], entityId = routeParts[2];
    const list = ({character:"characters",location:"locations",prop:"props",vehicle:"vehicles"})[view];
    const assetImproveBusy = await render(routeHash, fixture, { storage: { [`cinebraid-focused:fixture:entity-task:${list}:${entityId}`]: "primary" } });
    assetImproveBusy.context.setGuidedPromptOp("asset", operationKey, "", { status: "busy", action: "improve", startedAt: Date.now() });
    await assetImproveBusy.context.route();
    const assetImproveHtml = assetImproveBusy.context.document.getElementById("main").innerHTML;
    assert(assetImproveHtml.includes("Improving…"), `${targetLabel} Improve must expose a visible busy button label`);
    assert(assetImproveHtml.includes(`Improving the ${targetLabel} reference prompt…`), `${targetLabel} Improve must render persistent progress feedback`);
    assert(assetImproveHtml.includes("The assistant may take up to three minutes"), `${targetLabel} Improve should explain that the assistant can take time`);
    assert(/<button class="ghost-btn" disabled[^>]*>.*Improving…/s.test(assetImproveHtml), `${targetLabel} Improve must be disabled while its request is running`);
    assetImproveBusy.context.setGuidedPromptOp("asset", operationKey, "", null);
  }

  const blockingFixture = buildFixture();
  blockingFixture.shots[0].creationBrief = blockingFixture.shots[0].creationBrief || {};
  blockingFixture.shots[0].creationBrief.frameWorkflows = { "frame-b": { automationBlockingAssetId: "blocking-test-b" } };
  blockingFixture.mediaAssets.push({
    id: "blocking-test-a",
    file: "L1-01_BLOCKING_B01.png",
    storagePath: "shots/L1-01/blocking/L1-01_BLOCKING_B01.png",
    title: "L1-01 — Hull check B01",
    kind: "image",
    notes: "Blocking frame — planning scaffold, not canon.",
    generationRecord: { model: "GPT Image 2", date: "2026-07-27T21:00:00Z" },
    links: [{
      id: "blocking-link-a",
      targetType: "shot",
      targetId: "L1-01",
      role: "blocking-frame",
      blockingState: "returned",
      blockingVersion: "B01",
      generationInput: false,
      order: 1,
    }],
  });
  blockingFixture.mediaAssets.push({
    id: "blocking-test-b",
    file: "L1-01_FRAME_B_BLOCKING.png",
    storagePath: "shots/L1-01/blocking/L1-01_FRAME_B_BLOCKING.png",
    title: "L1-01 · Frame B — endpoint blocking",
    kind: "image",
    notes: "Derivative Frame B blocking guide.",
    generationRecord: { model: "GPT Image 2", date: "2026-07-28T21:00:00Z" },
    links: [{ id: "blocking-link-b", targetType: "shot", targetId: "L1-01", role: "blocking-frame", blockingState: "frame-active", blockingVersion: "B02", blockingFrameId: "frame-b", generationInput: true, order: 2 }],
  });
  const blockingRender = await render("#/shot/L1-01", blockingFixture);
  assert(blockingRender.html.includes("View blocking") && blockingRender.html.includes("full size"), "blocking thumbnails must clearly expose full-size inspection");
  assert(blockingRender.html.includes("openBlockingAttemptViewer('L1-01','blocking-test-a')"), "clicking a blocking thumbnail must open its viewer");
  blockingRender.context.openBlockingAttemptViewer("L1-01", "blocking-test-a");
  const blockingModalHtml = blockingRender.context.document.getElementById("modal").innerHTML;
  assert(blockingModalHtml.includes("blocking-attempt-viewer"), "blocking attempts must open in the large viewer modal");
  assert(blockingModalHtml.includes("Click image to zoom"), "blocking viewer must expose in-modal image zoom");
  assert(blockingModalHtml.includes("REVISE THIS ATTEMPT"), "blocking viewer must support in-context reprompting");
  assert(blockingModalHtml.includes("Build revised prompt"), "blocking viewer must compile requested structural changes");
  assert(blockingModalHtml.includes("Use as guide"), "blocking viewer must allow guide approval without returning to the thumbnail list");
  assert(blockingRender.html.includes("FRAME B ENDPOINT"), "frame-specific derivative blocking must name its exact target frame");
  assert(blockingRender.html.includes("Remove Frame B guide"), "active derivative blocking must remain independently removable from the global guide");
  blockingRender.context.openBlockingAttemptViewer("L1-01", "blocking-test-b");
  const frameBlockingModalHtml = blockingRender.context.document.getElementById("modal").innerHTML;
  assert(frameBlockingModalHtml.includes("FRAME B ENDPOINT"), "full-size derivative-blocking viewer must retain the target-frame label");
  assert(frameBlockingModalHtml.includes("ACTIVE FRAME B ENDPOINT GUIDE"), "derivative-blocking viewer must report state separately from the global guide");
  assert(frameBlockingModalHtml.includes("Remove frame B guide"), "derivative-blocking viewer must remove only the target-frame guide");
  assert(!frameBlockingModalHtml.includes("Build revised prompt"), "frame-specific blocking must not accidentally launch the global blocking revision path");
  blockingRender.context.closeModal();

  const motionReadyFixture = buildFixture();
  motionReadyFixture.shots[0].creationBrief = motionReadyFixture.shots[0].creationBrief || {};
  motionReadyFixture.shots[0].creationBrief.automationReadyForMotion = true;
  motionReadyFixture.shots[0].creationBrief.automationCompletedFrameIds = ["frame-a", "frame-b"];
  const motionReadyRender = await render("#/shot/L1-01", motionReadyFixture, { storage: { "cinebraid-focused:fixture:shot-task:L1-01": "motion" } });
  assert(motionReadyRender.html.includes("STILL AUTOMATION COMPLETE"), "completed still chains must expose a clear manual-motion handoff");
  assert(motionReadyRender.html.includes("Motion is never submitted by the still-automation runner"), "motion handoff must explicitly keep video generation manual");

  const interactive = await render("#/shot/L1-01", fixture, { storage: { "cinebraid-focused:fixture:shot-task:L1-01": "automation" } });
  interactive.context.openModal('<h3>Accessible confirmation</h3><button>Continue</button>');
  const modalHtml = interactive.context.document.getElementById("modal").innerHTML;
  assert(modalHtml.includes('role="dialog"'), "modals should expose dialog semantics");
  assert(modalHtml.includes('aria-modal="true"'), "modals should identify themselves as modal");
  assert(modalHtml.includes('id="cinebraid-modal-title"'), "modals should label the visible title");
  interactive.context.closeModal();
  const shot = vm.runInContext(`P.shots.find((x) => x.id === "L1-01")`, interactive.context);
  assert(shot, "fixture shot should load");
  assert(!interactive.html.includes("Workflow override"), "frame workflow override must not be visible");
  assert(!interactive.html.includes("Intended output"), "intended-output selector must not be visible");
  assert(!interactive.html.includes("ADVANCED"), "mode toggle / advanced workspace must not be visible");
  assert(interactive.html.includes("Full shot still automation"), "shot workspace must expose durable full-shot still automation");
  assert(interactive.html.includes("AUTOMATE FULL SHOT"), "shot automation must open a bounded full-shot planning step");
  assert(interactive.html.includes("Video generation remains manual") || interactive.html.includes("Motion generation remains"), "shot automation must explicitly stop before motion generation");

  interactive.context.selectGuidedFrameCandidate("L1-01", "frame-a", "FRAME_B.png");
  await new Promise((resolve) => setTimeout(resolve, 25));
  const selected = vm.runInContext(`guidedFrameState(P.shots.find((x) => x.id === "L1-01"), P.shots.find((x) => x.id === "L1-01").keyframes[0], 0).selectedCandidate`, interactive.context);
  assert.strictEqual(selected, "FRAME_B.png", "candidate choice must survive a route rerender");

  interactive.context.confirmModal = (message, action) => action();
  interactive.context.resetGuidedFrameApproval("L1-01", "frame-a");
  await new Promise((resolve) => setTimeout(resolve, 25));
  const resetState = vm.runInContext(`(() => { const s=P.shots.find((x)=>x.id==="L1-01"); return { shotWinner:s.winner||"", frameWinner:s.keyframes[0].winner||"", motionWinners:(s.clips||[]).map((x)=>x.videoWinner||"") }; })()`, interactive.context);
  assert.strictEqual(resetState.shotWinner, "", "reset must clear the active shot winner");
  assert.strictEqual(resetState.frameWinner, "", "reset must clear the opening-frame winner");
  assert(resetState.motionWinners.every((name) => !name), "reset must reopen downstream motion approvals");

  const resumable = await render("#/shot/L1-01", fixture);
  vm.runInContext(`AUTOMATION_RUNS=[{id:'run-resume-1',type:'shot-chain',targetId:'L1-01',scope:'stills',status:'running',stage:'Frame B review',summary:'Refresh-safe run.',createdAt:'2026-07-28T20:00:00Z',config:{maxImages:21},usage:{imagesGenerated:9,imageRequests:3,reviewCalls:2},steps:{'frame:frame-a:approval':{status:'completed',kind:'frame-approval',label:'Frame A approved',winner:'FRAME_A.png',score:91,completedAt:'2026-07-28T20:01:00Z'}},logs:[]}];`, resumable.context);
  await resumable.context.route();
  const resumableHtml = resumable.context.document.getElementById("main").innerHTML;
  assert(resumableHtml.includes("READY TO RESUME"), "persisted running automation must visibly become resumable after reload");
  assert(resumableHtml.includes("RESUME RUN"), "durable runs must expose an explicit resume action");
  assert(resumableHtml.includes("<b>9</b> / 21 images"), "durable run reports must preserve image usage against the confirmed cap");
  assert(resumableHtml.includes("FRAME_A.png"), "durable run reports must preserve completed winners");

  const reviewGate = await render("#/shot/L1-01", fixture);
  vm.runInContext(`AUTOMATION_RUNS=[{id:'run-review-1',revision:4,type:'shot-chain',targetId:'L1-01',scope:'stills',status:'awaiting-review',stage:'Approve Frame B',summary:'Director approval required.',createdAt:'2026-07-28T20:00:00Z',config:{frameRounds:2,maxImages:21},usage:{imagesGenerated:6,imageRequests:2,reviewCalls:1},current:{stepKey:'frame:frame-b:round-2:review'},steps:{'frame:frame-b:round-2:review':{key:'frame:frame-b:round-2:review',status:'needs-review',kind:'frame-review',label:'Frame B review',frameId:'frame-b',attempt:2,maxAttempts:2,winner:'FRAME_B.png',score:79,files:['FRAME_A.png','FRAME_B.png'],review:{reviews:[{n:1,pass:false,explicitPass:true,explicitScore:true,score:55,notes:'Identity drift.'},{n:2,pass:true,explicitPass:true,explicitScore:true,score:79,notes:'Promising endpoint; director confirmation required.'}]},result:{autoApprove:false,threshold:85}}},logs:[]}];`, reviewGate.context);
  await reviewGate.context.route();
  const reviewGateHtml = reviewGate.context.document.getElementById("main").innerHTML;
  assert(reviewGateHtml.includes("HUMAN REVIEW REQUIRED"), "borderline automation results must visibly pause for a director");
  assert(reviewGateHtml.includes("HUMAN REVIEW GATE"), "director review must expose the returned candidate chooser");
  assert(reviewGateHtml.includes("APPROVE SUGGESTED"), "the suggested candidate must remain an explicit human action");
  assert(reviewGateHtml.includes("START A FRESH RUN"), "a final review gate must offer a bounded fresh-run exit");

  const drawerSeparation = await render("#/shot/L1-01", fixture);
  vm.runInContext(`AUTOMATION_RUNS=[{id:'drawer-run',revision:1,type:'scene-chain',targetId:'SC-01',scope:'correction:pkg',label:'Drawer separation',status:'failed',stage:'Needs attention',summary:'Correction failed.',createdAt:'2026-07-29T20:00:00Z',updatedAt:'2026-07-29T20:01:00Z',current:{stepKey:'scene-correction:pkg:round-1:generate'},config:{maxImages:9},usage:{imagesGenerated:0,imageRequests:0,reviewCalls:0},steps:{'scene-correction:pkg:round-1:generate':{key:'scene-correction:pkg:round-1:generate',kind:'generation',status:'failed',label:'Generate correction',error:'Missing source provenance.'}},logs:[]}]; V641_ACTIVITY_DRAWER_OPEN=true; v641RenderActivityDrawer();`, drawerSeparation.context);
  const drawerHtml = drawerSeparation.context.document.getElementById("automation-activity-drawer").innerHTML;
  assert(drawerHtml.includes("VIEW REPORT"), "activity drawer rows must link to Reports");
  assert(drawerHtml.includes("REPAIR & RETRY"), "failed corrections must keep recovery on the work surface");
  for (const label of ["DIAGNOSTIC ZIP", "COPY SUMMARY", "FLAG INEFFICIENT", "DOWNLOAD DIAGNOSTIC BUNDLE"]) assert(!drawerHtml.includes(label), `activity drawer retained diagnostic control: ${label}`);

  const planner = await render("#/shot/L1-01", fixture);
  planner.context.openShotAutomationModal("L1-01");
  const plannerModal = planner.context.document.getElementById("modal").innerHTML;
  assert(plannerModal.includes("automation-plan-modal"), "shot planning must use the viewport-safe automation modal shell");
  assert(plannerModal.includes("START FULL SHOT AUTOMATION"), "the responsive planner must retain its primary action");

  const recovery = await render("#/library", fixture);
  assert.strictEqual(recovery.context.__CINEBRAID_COMPOSER_607_READY, true, "composer enhancement should initialize in the normal path");
  recovery.context.guidedFrameCard = () => { throw new Error("simulated composer crash"); };
  recovery.context.localStorage.setItem("cinebraid-focused:fixture:shot-task:L1-01", "frames");
  recovery.context.location.hash = "#/shot/L1-01";
  await recovery.context.route();
  assert.strictEqual(recovery.context.__CINEBRAID_COMPOSER_607_DISABLED, true, "a composer render failure must restore the stable workspace");
  assert(recovery.context.document.getElementById("main").innerHTML.includes("Hull check"), "Shots must remain available after composer recovery");

  const safe = await render("#/shot/L1-01", fixture, { storage: { "cinebraid-disable-v607-composer": "1" } });
  assert.strictEqual(safe.context.__CINEBRAID_COMPOSER_607_DISABLED, true, "safe mode must skip composer enhancements");
  assert(safe.html.includes("Hull check"), "safe mode must retain the stable shot workspace");

  console.log(`Render harness passed ${cases.length} current views, state-specific entity approval/review, entity prompt busy feedback, candidate selection persistence, approval reset, guarded composer recovery, safe mode, and the single guided shot workflow.`);
}

module.exports = { render, buildFixture, emptyFixture };
if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});

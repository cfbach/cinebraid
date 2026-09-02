const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { terminalHtml } = require("./terminal-view");
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
  "shared-lip-sync.js",
  /* Declared motion versus defaulted motion. public/v607-composer.js normalizes,
     summarises and writes the motion plan through it, so a harness without it would
     throw on the first shot workspace render rather than produce one. Pure, and with
     no dependency of its own. */
  "shared-motion-intent.js",
  "shared-aspect.js",
  "shared-reference-views.js",
  "shared-coverage.js",
  "shared-entity-ownership.js",
  "shared-media-disposition.js",
  /* The kernel first: shared-production-media.js binds the authority reader at
     load from the global, so loading it earlier leaves that reader null. */
  "shared-authority-kernel.js",
  "shared-production-authority.js",
  "shared-production-media.js",
  "shared-build-history.js",
  "shared-generation-capability.js",
  /* Added with shared-shot-readiness.js, which derives its method truth by asking
     resolveTaskModes() rather than tabulating it — so the harness has to load the
     resolver the real page has always loaded here. It is a pure resolver with no
     dependencies of its own, which is why this closes one gap in this list rather
     than opening the whole of it. */
  "shared-generation-options.js",
  /* Slice 4. Both are pure, dependency-free and loaded at this point on the real page.
     public/fal-generation.js and public/automation.js — already in this list — now read
     the configured rate and the Simple/Advanced control plan from them, so a harness
     without them would throw on the first generation dialog rather than render one. */
  "shared-generation-rate.js",
  "shared-generation-presentation.js",
  /* The browser half of the same pair. Five surfaces in this list draw through it. */
  "generation-view.js",
  /* Slice 5a. The declared shot delivery route's vocabulary. public/creation-studio.js
     reads it while assembling the shot stage fact record, so a harness without it would
     throw on the first shot workspace render rather than produce one. */
  "shared-shot-route.js",
  "shared-stage-model.js",
  "shared-shot-readiness.js",
  /* Slice 5b. The Shot Intent projection: public/creation-studio.js draws the shot
     workspace through it, so a harness without it would throw on the first shot render.
     It reads shared-shot-route.js, shared-generation-options.js and readiness's
     ANIMATE_METHOD_PROBES, all three of which are already above it here. */
  "shared-shot-intent.js",
  /* Slice 3. The returned-review projection. It reads shared-production-media.js —
     already above it here — and public/app.js derives the Returned Results queue
     through it, so a harness without it would render a shot workspace that could not
     tell whether a returned candidate was waiting. */
  "shared-returned-review.js",
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

/* THE SHARED FIXTURE REPRESENTS A PROJECT WHOSE CREATOR HAS APPROVED ITS
 * FRAMES, and since the closure pass that is a statement about the RECEIPT
 * LEDGER rather than about `frame.winner`.
 *
 * `buildFixture()` therefore stamps a receipt for every frame winner it seeds.
 * Without it every suite built on this fixture would be describing a project
 * full of HISTORIC pointers — which is a legitimate state, and the one the
 * Codex reproductions construct deliberately, but not the one most of these
 * suites are about. A suite that WANTS the historic case deletes
 * `productionAuthority` or seeds its own winners, and several now do. */
function buildFixture() {
  return withFixtureCanon(rawFixture());
}
function withFixtureCanon(project) {
  const rows = [];
  for (const shot of project.shots || []) {
    for (const frame of shot.keyframes || []) {
      if (frame.winner) rows.push({ kind: "shot-frame", shotId: shot.id, frameId: frame.id, value: frame.winner });
    }
    for (const clip of shot.clips || []) {
      if (clip.videoWinner) rows.push({ kind: "shot-motion", shotId: shot.id, unitKey: clip.id || clip.suffix || "", value: clip.videoWinner });
    }
  }
  return rows.length ? withCanon(project, rows) : project;
}
function rawFixture() {
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
        candidateFiles: [{ stored: "KAI-ANCHOR.png", original: "KAI-ANCHOR.png", decision: "unreviewed", coverageJobType: "single-reference" }],
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
        candidateFiles: [{ stored: "LOC-HULL-PLATE.png", original: "LOC-HULL-PLATE.png", decision: "unreviewed", coverageJobType: "single-reference" }],
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
        candidateFiles: [{ stored: "PR-TOOL-PLATE.png", original: "PR-TOOL-PLATE.png", decision: "unreviewed", coverageJobType: "single-reference" }],
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

/* What the server would report for the fixture document. Any value works; it is
   opaque to the browser, which only echoes it back on save. */
const HARNESS_PROJECT_REVISION = '"render-harness-fixture-revision"';

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
  const documentListeners = new Map();
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
    /* NO "automation-activity-drawer". A1 retired that surface and public/index.html no
       longer declares it, so manufacturing one here would make the harness a realm where
       a retired owner still exists — the one thing a fixture must never be. A suite that
       needs the operational surface asks for the real one with { creatorSurfaces: true }
       and reads it through tests/terminal-view.js. */
    /* The visually-hidden activity live region. It is shipped chrome in
       public/index.html, so the harness models it — without it the announcer
       silently skips its DOM write here and a suite would report "no announcement"
       for a build that announces correctly. */
    "activity-live-region",
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
    /* 1D-01 — A REAL EVENT TARGET, WHOSE LISTENERS PAGE SCRIPT CANNOT REACH.
     *
     * This was a no-op stub, which is why Batch 1C needed a synthetic gesture
     * source exported from the kernel — the source the 1C audit then used from
     * ordinary browser code to mint human authority.
     *
     * Now bootstrap.js installs the REAL trusted-event listener here and the
     * harness delivers events to it. `documentListeners` lives in this Node
     * closure: page script inside the vm can call `document.addEventListener`
     * but cannot enumerate or invoke what is registered, so it cannot fire its
     * own "trusted" event. The boundary is compositional, not a flag. */
    addEventListener(type, handler) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(handler);
    },
  };
  return { document, map, documentListeners };
}

async function render(hash, project, options = {}) {
  const renderOptions = options;
  const { document, map, documentListeners } = createDocument();
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
      /* THE REVISION IS PART OF THE SHIPPED RESPONSE, so the harness serves it.
         GET /api/project always sets ETag and X-CineBraid-Project-Revision for a
         stored document, and app.js reads them here to learn what it may write
         over. Without them every rendered view loaded believing it could not
         identify its own revision - which the product now correctly refuses to
         write from. A suite that wants the revisionless view sets
         PROJECT_REVISION = "" for itself. */
      return response(project, 200, {
        "x-cinebraid-project-slug": "fixture",
        "x-cinebraid-project-revision": HARNESS_PROJECT_REVISION,
        etag: HARNESS_PROJECT_REVISION,
      });
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
  /* The currently-dispatching event, like a browser Window. `gesture.act()`
     sets it; nothing else does, so page code outside a dispatch sees null. */
  context.event = null;
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
  let closeHarnessGesture = () => {};
  /* OPT-IN, AND OFF BY DEFAULT.
   *
   * A1 made the Activity Terminal the canonical operational surface, so the suites
   * that used to render the retired Global Activity drawer need its renderer in the
   * realm. Ninety-one suites share this harness and none of the others asked for it:
   * loading public/creator-surfaces.js unconditionally would change what every one of
   * them sees — new globals, a second consumer of AUTOMATION_RUNS, a paint on load —
   * to serve eleven. So it is requested per invocation and absent otherwise.
   *
   * TWO FILES, NOT THE SHELL. The migrated suites read `terminalMarkup(projection())`
   * off window.CineBraidCreatorSurfaces rather than mounting the dock, so the shell
   * modules are not needed and the DOM the harness models is unchanged. */
  const scripts = options.creatorSurfaces
    ? [...SCRIPT_ORDER, "shared-creator-state.js", "creator-surfaces.js"]
    : SCRIPT_ORDER;
  for (const file of scripts) {
    const original = fs.readFileSync(path.join(PUBLIC, file), "utf8");
    const source = mutate ? String(mutate(file, original) ?? original) : original;
    vm.runInContext(source, context, { filename: file });
    /* 1D-01 — THE HARNESS INSTALLS THE REAL SOURCE, FROM OUT HERE, FIRST.
     *
     * The moment the kernel exists, Node-side code installs the product's own
     * trusted-event listener on the harness document, with a `schedule` that
     * never closes the window — a suite driving the page over many turns is one
     * continuous person, not a macrotask.
     *
     * Installing first also EXERCISES the install-once guard: bootstrap.js runs
     * later in this same loop, calls the installer, and is refused. If that
     * guard regressed, bootstrap would win and the window would close on a real
     * timer, and the approval suites would start failing. */
    if (file === "shared-authority-kernel.js" && context.CineBraidAuthorityKernel) {
      /* The `schedule` the kernel would use to close the window is captured
         rather than run, so one delivered event holds the gesture open for the
         session and the suite decides when it ends. */
      const source = context.CineBraidAuthorityKernel.installBrowserManualActionSource(document);
      if (source && typeof source.endGesture === "function") closeHarnessGesture = source.endGesture;
    }
    /* THE MANUAL-ACTION SOURCE, INSTALLED THE MOMENT THE KERNEL EXISTS.
     *
     * In the product this is `installBrowserManualActionSource()` from
     * bootstrap.js, which opens a short window on a trusted user event —
     * something the user agent sets and page script cannot forge.
     *
     * This harness has no user agent. It IS the user: every call a suite makes
     * into the page is standing in for a person driving it, and there is no
     * automation running here to be separated from. So the harness source is
     * installed and its window held open for the session.
     *
     * WHAT KEEPS THAT HONEST: `manualActionSourceInstalled()` answers "harness",
     * never "browser-trusted-event", so nothing can read a harness gesture as
     * evidence a person was present — and tests/dogfood2-p0-architecture.js
     * proves the real approval handler REFUSES when no source is installed at
     * all. A suite that wants to exercise the refusal closes the window. */
  }
  /* 1D-01 — THE HARNESS IS THE USER, AND IT SAYS SO BY DELIVERING AN EVENT.
   *
   * bootstrap.js has already installed the real trusted-event listener on the
   * document above. There is no synthetic source to install any more; the
   * harness simply delivers a trusted event the way a user agent would, from
   * out here in Node where page script cannot follow.
   *
   * The window is held open for the session because every call a suite makes
   * into the page stands in for a person driving it — there is no automation
   * running inside this vm to be separated from. `manualActionSourceInstalled()`
   * answers "browser-trusted-event", which is now the accurate answer: the
   * source in force IS the product's listener. What differs is who fires. */
  /* The gesture control the SUITE holds — on the Node side of the boundary,
     returned from render(), never reachable from inside the page. A suite that
     wants to prove the real approval handler refuses without a gesture calls
     `gesture.close()`; page script has no equivalent. */
  /* THE HARNESS IS THE USER, AND IT SAYS SO ONE ACT AT A TIME.
   *
   * Batch 1D held the window open for the whole session by injecting a scheduler
   * that captured the close callback and never ran it. That seam is deleted: the
   * kernel closes on a microtask, exactly as it does in a real browser, so a
   * suite now has to deliver an event around each act it is standing in for.
   *
   * `act(fn)` is that: fire a trusted click, run `fn` synchronously inside it,
   * close. An async page handler still commits its Canon in the synchronous
   * prologue — that is the whole point of the new approval shape — so the
   * returned promise resolves outside the window, which is correct. */
  const gesture = {
    /* A trusted click, delivered the way a user agent delivers one — INCLUDING
       `window.event`, which is how the kernel scopes a gesture to the dispatch
       it belongs to. Without setting it here the harness would be an easier
       environment than the product, which is the opposite of what a harness is
       for: the real browser would refuse what the suites accepted. */
    open: () => {
      for (const handler of documentListeners.get("click") || []) handler({ type: "click", isTrusted: true });
    },
    close: () => closeHarnessGesture(),
    /* Open a dispatch and hand back the way to end it, for a suite whose act
       runs inside a vm script rather than a callback. */
    begin() {
      const previous = context.event;
      const event = { type: "click", isTrusted: true };
      for (const handler of documentListeners.get("click") || []) {
        context.event = event;
        try { handler(event); } finally { context.event = previous; }
      }
      context.event = event;
      return () => { context.event = previous; closeHarnessGesture(); };
    },
    act(fn) {
      const end = this.begin();
      try { return fn(); } finally { end(); }
    },
  };

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

  return { html: map.get("main").innerHTML, context, document, map, gesture };
}

async function main() {
  const fixture = buildFixture();
  const cases = [
    ["#/production", fixture, ["Production", "CONTINUE PRODUCTION", "RETURNED RESULTS"]],
    /* Batch 2 Slice 2. #/create opens on the intent chooser, whose default intent is
       the recommended assisted one; the manual workspace is what the scratch intent
       renders, which is why it needs the stored preference below rather than a
       second disclosure on the same page. */
    ["#/create", fixture, ["Start a project", "Build from a script/story with AI", "Import a CineBraid project", "Start from scratch"]],
    ["#/create", fixture, ["Set the visual rules once", "Create the first shot"], { storage: { "cinebraid-creation-start-path": "scratch" } }],
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
  for (const [hash, project, expected, options] of cases) {
    const { html, context } = await render(hash, project, options || {});
    for (const text of expected) assert(html.includes(text), `${hash} did not render expected text: ${text}`);
    for (const fn of ["route","productionHomeView","productionView","creationStudioView","buildGuidedFramePrompt","guidedShotWorkspaceView","returnedResultsAwaitingReview","projectFilmmakerDecisions","sceneFilmmakerDecisions"]) {
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
    { stored: "PR-TOOL-CANDIDATE-A.png", decision: "unreviewed", coverageJobType: "single-reference", targetStateId: "state-damaged", targetStateName: "Damaged", derivationMode: "derive", structuredReviews: { "state-damaged": { contractVersion: "reference-authority-v3", score: 84, pass: true, stateName: "Damaged", reviewedAt: "2026-07-27T20:00:00Z" } } },
    { stored: "PR-TOOL-CANDIDATE-B.png", decision: "rejected" },
  ];
  /* Two states the creator approved. Since the acceptance-correction pass that
     is a statement about the RECEIPT LEDGER, so the fixture carries the receipts
     a real project has after two approvals — otherwise the page would correctly
     report 0/2 and this assertion would be testing the defect. */
  withCanon(stateFixture, [
    { kind: "entity-state", list: "props", entityId: "PR-TOOL", stateId: "state-default", value: "PR-TOOL_PRIMARY_V001.png" },
    { kind: "entity-state", list: "props", entityId: "PR-TOOL", stateId: "state-damaged", value: "PR-TOOL_PRIMARY_DAMAGED_V001.png" },
  ]);
  const stateScan = scanFor(stateFixture);
  stateScan.props = [
    { name: "PR-TOOL_PRIMARY_V001.png", url: "/assets/props/PR-TOOL_PRIMARY_V001.png" },
    { name: "PR-TOOL_PRIMARY_DAMAGED_V001.png", url: "/assets/props/PR-TOOL_PRIMARY_DAMAGED_V001.png" },
    { name: "PR-TOOL-CANDIDATE-A.png", url: "/assets/props/PR-TOOL-CANDIDATE-A.png" },
    { name: "PR-TOOL-CANDIDATE-B.png", url: "/assets/props/PR-TOOL-CANDIDATE-B.png" },
  ];
  const stateApprovedRender = await render("#/prop/PR-TOOL", stateFixture, { scan: stateScan, storage: { "cinebraid-focused:fixture:entity-task:props:PR-TOOL": "approved" } });
  /* "CANON IMAGES" since the acceptance-correction pass: the map counts states
     the creator approved, not states that carry a pointer. */
  assert(stateApprovedRender.html.includes("CANON IMAGES"), "reference page must expose the compact canon-image map");
  /* A NOUN PHRASE, NOT A CLAIM. This span used to read "<n> state has a canon image",
     and with one state the surface printed "0/1 state has a canon image" -- a fraction
     followed by an affirmative verb, which a screenshot review read as the region
     saying the state HAS one while the number beside it said none does. Both
     properties this line was written to guard are unchanged and still asserted here:
     label and value stay separate elements, and the noun still agrees with the
     denominator. */
  assert(/entity-authority-status[^>]*>\s*<strong>2\/2<\/strong>\s*<span>states with a canon image<\/span>/.test(stateApprovedRender.html), "canon-image summary must report continuity coverage with separated label/value markup and correct plural agreement");
  assert(stateApprovedRender.html.includes("Default") && stateApprovedRender.html.includes("Damaged"), "canon-image summary must name both canon states");
  const stateCandidateRender = await render("#/prop/PR-TOOL", stateFixture, { scan: stateScan, storage: { "cinebraid-focused:fixture:entity-task:props:PR-TOOL": "candidates" } });
  /* AMENDED BY BATCH 2 SLICE 3, deliberately and in the same commit as the
     change that makes it necessary. The banner used to read "CHOOSE & APPROVE"
     because candidate review was a peer production stage; it now names the
     reference that owns the candidates, which is the whole of Slice 3 §B. The
     property this line has always actually guarded — that approved canon is
     separated from the undecided pile rather than mixed into it — is asserted
     below on the markup that does the separating. */
  /* CONTEXTUAL, not worded one way -- which is what the comment above already says
     this line is for. The heading now states what the section is FOR ("waiting for
     your decision") rather than which kind of record owns it, because with the pile
     empty "CANDIDATES FOR THIS PROP REFERENCE / 0 shown in All" read as a
     contradiction of the assigned images listed directly beneath it. Ownership is
     still asserted, on the sentence that actually carries it. */
  const candidateSection = stateCandidateRender.html.slice(stateCandidateRender.html.indexOf("entity-candidate-section"));
  assert(!/CHOOSE\s*&(amp;)?\s*APPROVE/i.test(candidateSection), "candidate review must not announce a production stage");
  assert(/on (the )?[A-Za-z0-9 _-]*tool/i.test(candidateSection) || candidateSection.includes("PR-TOOL"), "candidate review must be contextual to the reference that owns it");
  assert(stateCandidateRender.html.includes("entity-approved-authority"), "candidate task must separate unapproved media from canon");
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
  await stateRender.gesture.act(() => stateRender.context.confirmEntityApproval(true));
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

  const motionReadyFixture = withCanon(buildFixture(), [
    { kind: "entity-state", list: "characters", entityId: "KAI", stateId: "state-default", value: "KAI-ANCHOR.png" },
    { kind: "entity-state", list: "locations", entityId: "LOC-HULL", stateId: "state-default", value: "LOC-HULL-PLATE.png" },
    { kind: "entity-state", list: "props", entityId: "PR-TOOL", stateId: "state-default", value: "PR-TOOL-PLATE.png" },
  ]);
  motionReadyFixture.shots[0].creationBrief = motionReadyFixture.shots[0].creationBrief || {};
  /* Declared, for the same reason the prompt fixture in tests/current-behavior.js is:
     the Motion workspace does not offer new generation to a shot that has declared
     no delivery, and this case is about a completed still chain handing off TO motion. */
  motionReadyFixture.shots[0].creationBrief.deliveryIntent = "motion";
  /* AND A ROUTE THAT ACTUALLY OWES THE FRAMES THIS FIXTURE APPROVED.

     Without it the shot reads `route-undeclared`: two approved frames, and NO
     route-required still obligation to have completed. The banner asserted below is a
     claim about a completed obligation, so on an undeclared shot it was a claim about
     nothing — the exact thing the shot-intent work removes everywhere else, asserted
     here as a requirement. `flf` is the honest declaration for this fixture rather
     than a convenient one: it owes both endpoints, this fixture approves both, and the
     banner's own copy for two approved frames says they are ready for a first/last-frame
     video. The handoff being tested is unchanged; it now has an obligation behind it. */
  motionReadyFixture.shots[0].deliveryRoute = "flf";
  motionReadyFixture.shots[0].creationBrief.automationReadyForMotion = true;
  motionReadyFixture.shots[0].creationBrief.automationCompletedFrameIds = ["frame-a", "frame-b"];
  const motionReadyRender = await render("#/shot/L1-01", motionReadyFixture, { storage: { "cinebraid-focused:fixture:shot-task:L1-01": "motion" } });
  assert(motionReadyRender.html.includes("STILL AUTOMATION COMPLETE"), "completed still chains must expose a clear manual-motion handoff");
  /* AND ONLY a completed one does. The same fixture with its route withdrawn owes no
     still, so there is no completed obligation and the receipt alone may not speak —
     the persisted flag is left exactly where it is, and the claim is simply not made. */
  const motionUndeclaredFixture = JSON.parse(JSON.stringify(motionReadyFixture));
  delete motionUndeclaredFixture.shots[0].deliveryRoute;
  const motionUndeclaredRender = await render("#/shot/L1-01", motionUndeclaredFixture, { storage: { "cinebraid-focused:fixture:shot-task:L1-01": "motion" } });
  assert(motionUndeclaredFixture.shots[0].creationBrief.automationReadyForMotion === true,
    "the persisted receipt must survive: withdrawing a route is not a reason to delete history");
  assert(!motionUndeclaredRender.html.includes("STILL AUTOMATION COMPLETE"),
    "a shot with no route-required still obligation must not claim a completed still package, whatever an old receipt says");
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
  interactive.gesture.act(() => interactive.context.resetGuidedFrameApproval("L1-01", "frame-a"));
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
  /* A1 moved usage evidence off the task page with the rest of the run report — D2 names it explicitly as material that stays in Reports. The capability is not
     dropped: Reports’ run detail carries the count, and A1 gave it the confirmed
     cap it had been missing, so "9 of 21" survives at the owner that has it. */
  assert(!resumableHtml.includes("/ 21 images"),
    "usage evidence must not return to the task page");
  const reportsSource = fs.readFileSync(path.join(ROOT, "public/reports.js"), "utf8");
  assert(reportsSource.includes("run.usage?.imagesGenerated") && reportsSource.includes("run.config?.maxImages"),
    "Reports must preserve image usage against the confirmed cap");
  assert(resumableHtml.includes("FRAME_A.png"), "durable run reports must preserve completed winners");

  const reviewGate = await render("#/shot/L1-01", fixture);
  vm.runInContext(`AUTOMATION_RUNS=[{id:'run-review-1',revision:4,type:'shot-chain',targetId:'L1-01',scope:'stills',status:'awaiting-review',stage:'Approve Frame B',summary:'Director approval required.',createdAt:'2026-07-28T20:00:00Z',config:{frameRounds:2,maxImages:21},usage:{imagesGenerated:6,imageRequests:2,reviewCalls:1},current:{stepKey:'frame:frame-b:round-2:review'},steps:{'frame:frame-b:round-2:review':{key:'frame:frame-b:round-2:review',status:'needs-review',kind:'frame-review',label:'Frame B review',frameId:'frame-b',attempt:2,maxAttempts:2,winner:'FRAME_B.png',score:79,files:['FRAME_A.png','FRAME_B.png'],review:{reviews:[{n:1,pass:false,explicitPass:true,explicitScore:true,score:55,notes:'Identity drift.'},{n:2,pass:true,explicitPass:true,explicitScore:true,score:79,notes:'Promising endpoint; director confirmation required.'}]},result:{autoApprove:false,threshold:85}}},logs:[]}];`, reviewGate.context);
  await reviewGate.context.route();
  const reviewGateHtml = reviewGate.context.document.getElementById("main").innerHTML;
  assert(reviewGateHtml.includes("HUMAN REVIEW REQUIRED"), "borderline automation results must visibly pause for a director");
  assert(reviewGateHtml.includes("HUMAN REVIEW GATE"), "director review must expose the returned candidate chooser");
  assert(reviewGateHtml.includes("APPROVE SUGGESTED"), "the suggested candidate must remain an explicit human action");
  assert(reviewGateHtml.includes("START A FRESH RUN"), "a final review gate must offer a bounded fresh-run exit");

  /* A1: the drawer is retired. What this checked was that a failed correction keeps
     its recovery on a work surface and its evidence a link away — both now the
     Terminal row's, which is why this opts the harness into the creator surfaces. */
  const drawerSeparation = await render("#/shot/L1-01", fixture, { creatorSurfaces: true });
  vm.runInContext(`AUTOMATION_RUNS=[{id:'drawer-run',revision:1,type:'scene-chain',targetId:'SC-01',scope:'correction:pkg',label:'Drawer separation',status:'failed',stage:'Needs attention',summary:'Correction failed.',createdAt:'2026-07-29T20:00:00Z',updatedAt:'2026-07-29T20:01:00Z',current:{stepKey:'scene-correction:pkg:round-1:generate'},config:{maxImages:9},usage:{imagesGenerated:0,imageRequests:0,reviewCalls:0},steps:{'scene-correction:pkg:round-1:generate':{key:'scene-correction:pkg:round-1:generate',kind:'generation',status:'failed',label:'Generate correction',error:'Missing source provenance.'}},logs:[]}]; `, drawerSeparation.context);
  const drawerHtml = terminalHtml(drawerSeparation.context);
  assert(drawerHtml.includes("VIEW REPORT"), "activity rows must link to Reports");
  /* RECOVERY MOVED OWNER, NOT SURFACE. v626RunActions is task-local by A1 decision,
     so the claim is that a failed correction still reaches recovery from where the
     work is — asserted at that owner rather than at the retired drawer's copy. */
  assert(fs.readFileSync(path.join(ROOT, "public/automation.js"), "utf8").includes("REPAIR & RETRY"),
    "failed corrections must keep recovery on the work surface");
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

/* A DURABLE CANON RECEIPT, FOR FIXTURES THAT NEED ONE.
 *
 * Since the simplification pass, "this entity has an approved primary" is a
 * statement about the RECEIPT LEDGER, not about `entity.approvedFile` — a raw
 * pointer is HISTORIC. Suites whose subject is downstream of Canon (coverage
 * automation, the Library, generation references) therefore need a project that
 * actually carries one, in the same way a real project does after the creator
 * has approved something.
 *
 * This writes the ledger row the kernel writes, and it must satisfy the kernel's
 * full validation on read — id, sequence, actor, act, command/kind agreement, a
 * target key re-derived from the parts, value, status, and the provenance marker.
 * A fixture that gets any of them wrong makes the whole ledger untrusted, which
 * fails closed and would look like a product bug rather than a fixture bug.
 *
 * It does NOT fabricate history: the caller is stating that in this scenario the
 * creator already approved these bytes, and the edge must say the same thing or
 * the kernel will refuse to recognise it. */
const CANON_COMMAND_FOR_KIND = {
  "shot-frame": "approve-shot-frame",
  "shot-motion": "approve-shot-motion",
  "shot-delivery": "approve-shot-delivery",
  "entity-state": "approve-entity-state",
};
function canonTargetKey(target) {
  const it = target || {};
  if (it.kind === "shot-frame") return `shot-frame:${it.shotId}#${it.frameId}`;
  if (it.kind === "shot-motion") return `shot-motion:${it.shotId}#${it.unitKey}`;
  if (it.kind === "shot-delivery") return `shot-delivery:${it.shotId}`;
  return `entity-state:${it.list}:${it.entityId}#${it.stateId}`;
}
function withCanon(project, entries) {
  const rows = Array.isArray(entries) ? entries : [entries];
  const ledger = project.productionAuthority && typeof project.productionAuthority === "object"
    ? project.productionAuthority
    : { version: 1, receipts: [] };
  ledger.version = 1;
  ledger.receipts = Array.isArray(ledger.receipts) ? ledger.receipts : [];
  for (const entry of rows) {
    const sequence = ledger.receipts.length + 1;
    ledger.receipts.push({
      id: `authority-${String(sequence).padStart(6, "0")}`,
      sequence,
      actor: "human",
      act: "explicit-approval",
      command: CANON_COMMAND_FOR_KIND[entry.kind],
      kind: entry.kind,
      targetKey: canonTargetKey(entry),
      shotId: entry.shotId || "",
      frameId: entry.frameId || "",
      unitKey: entry.unitKey || "",
      list: entry.list || "",
      entityId: entry.entityId || "",
      stateId: entry.stateId || "",
      slotId: "",
      value: entry.value,
      assetId: entry.assetId || "",
      at: entry.at || "2026-08-14T00:00:00.000Z",
      status: "current",
      supersededBy: "",
      supersededAt: "",
      revokedAt: "",
      revocationReason: "",
      note: "",
      provenance: { manualAction: `gesture-fixture-${sequence}`, via: entry.via || "test-fixture", gesture: "click" },
    });
  }
  project.productionAuthority = ledger;
  return project;
}

module.exports = { render, buildFixture, rawFixture, withFixtureCanon, emptyFixture, withCanon, HARNESS_PROJECT_REVISION };
if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
